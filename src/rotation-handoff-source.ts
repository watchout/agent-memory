import { ROTATION_HANDOFF_SOURCE_LIST_LIMIT } from "./constants.js";
import { readMarker, rotationHandoffTaskId, seatDirectory, sha256Hex } from "./session-rotation-files.js";
import type { Store } from "./stores/types.js";

export const HANDOFF_SOURCE_SCHEMA = "kusabi-rotation-handoff-source/v1" as const;

export interface HandoffSourceInput {
  agent_id: string;
  project: string;
  rotation_root: string;
}

/**
 * What the read found. Only "found" carries text, and only text whose SHA-256 is the marker's. The others say why not:
 * - no_marker: the seat has no valid marker (or the seat name is not a valid folder name)
 * - other_seat: the marker belongs to another agent or project
 * - not_seat_text: the lost text was the fixed sentence (the seat's own text was not taken), so there is nothing to bring back
 * - absent: the task state is not among the seat's task states
 * - overwritten: the task state holds some other body (a later hand-off of the same seat replaced it, or it was edited)
 * - unreadable: the store failed, or the list was cut before it showed the task state - not the same as absent
 */
export type HandoffSourceResult =
  | { schema_version: typeof HANDOFF_SOURCE_SCHEMA; result: "found"; marker_id: string; sha256: string; text: string; marker_saved_at: string; task_updated_at: string }
  | { schema_version: typeof HANDOFF_SOURCE_SCHEMA; result: "no_marker" | "other_seat" | "not_seat_text" | "absent" | "overwritten" | "unreadable"; reason: string; marker_id: string | null };

function notFound(result: Exclude<HandoffSourceResult["result"], "found">, reason: string, markerId: string | null): HandoffSourceResult {
  return { schema_version: HANDOFF_SOURCE_SCHEMA, result, reason, marker_id: markerId } as HandoffSourceResult;
}

/**
 * Read-only: brings back the hand-off text of the seat's current marker from the task state the stop side keeps, when
 * the bundle was used up but the host did not take the text (handoff-commit-order-design.md 4.7 R-b). It writes nothing
 * and consumes nothing. The task state is found by its task id, never by its rank among the seat's tasks.
 */
export async function readHandoffSource(store: Pick<Store, "getTaskStates">, input: HandoffSourceInput): Promise<HandoffSourceResult> {
  let directory: string;
  try {
    directory = seatDirectory(input.rotation_root, input.agent_id, input.project);
  } catch {
    return notFound("no_marker", "the seat name is not a valid folder name", null);
  }
  const marker = readMarker(directory);
  if (marker === null) return notFound("no_marker", "the seat has no valid marker", null);
  if (marker.agent_id !== input.agent_id || marker.project !== input.project) {
    return notFound("other_seat", "the marker belongs to another agent or project", marker.marker_id);
  }
  if (marker.handoff_source !== "seat_text") {
    return notFound("not_seat_text", "the seat's own text was not taken for this marker; the lost text was a fixed sentence", marker.marker_id);
  }
  let tasks;
  try {
    tasks = await store.getTaskStates({
      agent_id: input.agent_id,
      project: input.project,
      status: "all",
      limit: ROTATION_HANDOFF_SOURCE_LIST_LIMIT,
    });
  } catch {
    return notFound("unreadable", "the task states could not be read", marker.marker_id);
  }
  const task = tasks.find((candidate) => candidate.task_id === rotationHandoffTaskId(input.project));
  if (task === undefined) {
    return tasks.length >= ROTATION_HANDOFF_SOURCE_LIST_LIMIT
      ? notFound("unreadable", `the task states were cut at ${ROTATION_HANDOFF_SOURCE_LIST_LIMIT} before the hand-off showed; it is not known to be absent`, marker.marker_id)
      : notFound("absent", "the seat has no hand-off task state", marker.marker_id);
  }
  const text = task.progress ?? "";
  const digest = sha256Hex(text);
  if (digest !== marker.pack_content_sha256) {
    return notFound("overwritten", "the task state holds a body other than this marker's (a later hand-off replaced it, or it was edited)", marker.marker_id);
  }
  return {
    schema_version: HANDOFF_SOURCE_SCHEMA,
    result: "found",
    marker_id: marker.marker_id,
    sha256: digest,
    text,
    marker_saved_at: marker.saved_at,
    task_updated_at: task.updated_at ?? task.created_at,
  };
}
