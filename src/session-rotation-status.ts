#!/usr/bin/env node
/**
 * Read-only view of one seat's rotation files (FR4.2): the "safe to cut" marker,
 * the turn file, the hook state and the watcher's claim for that marker. It
 * writes nothing, calls neither tmux nor ps, and prints ids, states, counts and
 * times only: never conversation text, never a path. A file that exists but
 * cannot be trusted is shown as "unreadable", not as missing (standard S5).
 */
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readClaim,
  readHookState,
  readMarker,
  readTurn,
  rotationRoot,
  seatDirectory,
} from "./session-rotation-files.js";

export const ROTATION_STATUS_SCHEMA = "kusabi-rotation-status/v1" as const;

export type FileState = "none" | "unreadable" | "valid";

export interface RotationStatus {
  schema_version: typeof ROTATION_STATUS_SCHEMA;
  agent_id: string;
  project: string;
  marker: { file: FileState; session_id?: string; host?: string; marker_id?: string; saved_at?: string; handoff_source?: string; measured_tokens?: number; threshold_tokens?: number; pane_id?: string | null };
  turn: { file: FileState; state?: string; session_id?: string; at?: string; source?: string | null; rotation_marker_id?: string | null };
  hook_state: { file: FileState; session_id?: string; blocked_at?: string; measured_tokens?: number };
  claim: { file: FileState; state?: string; respawn_started_at?: string | null };
}

function fileState(directory: string, name: string, valid: boolean): FileState {
  if (valid) return "valid";
  return existsSync(join(directory, name)) ? "unreadable" : "none";
}

/** Builds the view from the seat's folder. Reads only. */
export function buildRotationStatus(directory: string, agentId: string, project: string): RotationStatus {
  const marker = readMarker(directory);
  const turn = readTurn(directory);
  const hook = readHookState(directory);
  const claim = marker === null ? null : readClaim(directory, marker.marker_id);
  const claimFile = marker === null
    ? "none"
    : fileState(join(directory, "claims"), `${marker.marker_id}.json`, claim !== null);
  return {
    schema_version: ROTATION_STATUS_SCHEMA,
    agent_id: agentId,
    project,
    marker: marker === null
      ? { file: fileState(directory, "marker.json", false) }
      : {
          file: "valid",
          session_id: marker.session_id,
          host: marker.host,
          marker_id: marker.marker_id,
          saved_at: marker.saved_at,
          handoff_source: marker.handoff_source,
          measured_tokens: marker.measured_tokens,
          threshold_tokens: marker.threshold_tokens,
          pane_id: marker.pane_id,
        },
    turn: turn === null
      ? { file: fileState(directory, "turn.json", false) }
      : {
          file: "valid",
          state: turn.state,
          session_id: turn.session_id,
          at: turn.at,
          source: turn.source,
          rotation_marker_id: turn.rotation_marker_id,
        },
    hook_state: hook === null
      ? { file: fileState(directory, "hook-state.json", false) }
      : { file: "valid", session_id: hook.session_id, blocked_at: hook.blocked_at, measured_tokens: hook.measured_tokens },
    claim: claim === null
      ? { file: claimFile }
      : { file: "valid", state: claim.state, respawn_started_at: claim.respawn_started_at },
  };
}

const USAGE = "usage: session-rotation-status --agent-id ID --project NAME (both may come from AGENT_MEMORY_AGENT_ID and AGENT_MEMORY_PROJECT)";

/** Exit code 0 with one JSON line, or 2 with a one-line reason. */
export function runRotationStatusCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  write: (line: string) => void,
): number {
  let agentId = env.AGENT_MEMORY_AGENT_ID ?? "";
  let project = env.AGENT_MEMORY_PROJECT ?? "";
  for (let index = 0; index < argv.length; index += 2) {
    const value = argv[index + 1];
    if (argv[index] === "--agent-id" && value !== undefined) agentId = value;
    else if (argv[index] === "--project" && value !== undefined) project = value;
    else {
      write(`${USAGE}\n`);
      return 2;
    }
  }
  let directory: string;
  try {
    directory = seatDirectory(rotationRoot(env), agentId, project);
  } catch {
    write(`${USAGE}\nthe agent id and project must be plain names\n`);
    return 2;
  }
  write(`${JSON.stringify(buildRotationStatus(directory, agentId, project))}\n`);
  return 0;
}

let invokedPath = "";
try {
  invokedPath = process.argv[1] ? realpathSync(resolve(process.argv[1])) : "";
} catch {
  invokedPath = "";
}
if (invokedPath === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = runRotationStatusCli(process.argv.slice(2), process.env, (line) => {
    process.stdout.write(line);
  });
}
