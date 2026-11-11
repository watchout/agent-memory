/**
 * Rotation watcher settings (watcher-design.md 2.3). The file is written at
 * installation time under an Owner decision; this module only validates it and
 * fails closed: a seat with an invalid entry is never acted on (standard S5).
 * Pure functions: file contents, owner id and file modes are passed in (S4).
 */
import { isAbsolute } from "node:path";
import {
  ROTATION_CONFIRM_WAIT_SECONDS,
  ROTATION_MARKER_TTL_SECONDS,
  ROTATION_WATCHER_HUMAN_QUIET_SECONDS,
  ROTATION_WATCHER_MAX_PER_HOUR,
  ROTATION_WATCHER_MIN_INTERVAL_SECONDS,
  ROTATION_WATCHER_NO_PROGRESS_HALT_LIMIT,
  ROTATION_WATCHER_QUIET_SECONDS,
} from "./constants.js";
import type { RotationHost } from "./session-rotation-usage.js";

export const WATCHER_CONFIG_SCHEMA = "kusabi-rotation-watcher-config/v1" as const;

/** Characters allowed in a launch command: it is placed inside a tmux condition (design 2.3). */
const LAUNCH_COMMAND_CHARS = /^[A-Za-z0-9 "_./:=;@+~-]+$/;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TMUX_TARGET = /^[A-Za-z0-9_.-]+:[0-9]+\.[0-9]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DECISION_URL = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/(issues|pull)\/[0-9]+#issuecomment-[0-9]+$/;
const COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface OwnerDecisionRef {
  url: string;
  sha256: string;
  names_aun_supervised_relaunch: boolean;
}

export interface WatcherSeat {
  agent_id: string;
  project: string;
  host: RotationHost;
  tmux_target: string;
  expected_command: string;
  launch_command: string;
  launch_script: { path: string; sha256: string };
  owner_decision_ref: OwnerDecisionRef;
  aun_supervised: boolean;
  prompt_markers: string[];
  placeholder_patterns: string[];
  drain_commands: string[];
  human_quiet_seconds: number;
  quiet_seconds: number;
  marker_ttl_seconds: number;
  min_interval_seconds: number;
  max_per_hour: number;
  confirm_wait_seconds: number;
}

export interface WatcherConfig {
  seats: WatcherSeat[];
  no_progress_halt_limit: number;
}

export type ConfigResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringList(value: unknown, minimum: number): string[] | null {
  if (!Array.isArray(value) || value.length < minimum) return null;
  return value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 200) ? (value as string[]) : null;
}

function positiveInteger(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function parseDecisionRef(value: unknown): OwnerDecisionRef | null {
  const raw = record(value);
  if (!raw || typeof raw.url !== "string" || !DECISION_URL.test(raw.url)) return null;
  if (typeof raw.sha256 !== "string" || !SHA256.test(raw.sha256)) return null;
  return {
    url: raw.url,
    sha256: raw.sha256,
    names_aun_supervised_relaunch: raw.names_aun_supervised_relaunch === true,
  };
}

function parseSeat(value: unknown): ConfigResult<WatcherSeat> {
  const raw = record(value);
  if (!raw) return fail("seat_not_object");
  const { agent_id: agent, project, host } = raw;
  if (typeof agent !== "string" || !SEGMENT.test(agent)) return fail("agent_id_invalid");
  if (typeof project !== "string" || !SEGMENT.test(project)) return fail("project_invalid");
  if (host !== "claude_code" && host !== "codex") return fail("host_invalid");
  if (typeof raw.tmux_target !== "string" || !TMUX_TARGET.test(raw.tmux_target)) return fail("tmux_target_invalid");
  if (typeof raw.expected_command !== "string" || !COMMAND_NAME.test(raw.expected_command)) return fail("expected_command_invalid");
  const launch = raw.launch_command;
  if (typeof launch !== "string" || launch.length === 0 || launch.length > 1_024 || !LAUNCH_COMMAND_CHARS.test(launch)) {
    return fail("launch_command_invalid");
  }
  const script = record(raw.launch_script);
  if (!script || typeof script.path !== "string" || !isAbsolute(script.path) || typeof script.sha256 !== "string" || !SHA256.test(script.sha256)) {
    return fail("launch_script_invalid");
  }
  const decision = parseDecisionRef(raw.owner_decision_ref);
  if (!decision) return fail("owner_decision_ref_missing");
  const aun = raw.aun_supervised === true;
  if (aun && !decision.names_aun_supervised_relaunch) return fail("aun_supervised_without_named_decision");
  const markers = stringList(raw.prompt_markers, 1);
  if (!markers) return fail("prompt_markers_invalid");
  const placeholders = stringList(raw.placeholder_patterns ?? [], 0);
  if (!placeholders) return fail("placeholder_patterns_invalid");
  const drains = stringList(raw.drain_commands ?? [], 0);
  if (!drains || !drains.every((name) => COMMAND_NAME.test(name))) return fail("drain_commands_invalid");
  const numbers = {
    human_quiet_seconds: positiveInteger(raw.human_quiet_seconds, ROTATION_WATCHER_HUMAN_QUIET_SECONDS),
    quiet_seconds: positiveInteger(raw.quiet_seconds, ROTATION_WATCHER_QUIET_SECONDS),
    marker_ttl_seconds: positiveInteger(raw.marker_ttl_seconds, ROTATION_MARKER_TTL_SECONDS),
    min_interval_seconds: positiveInteger(raw.min_interval_seconds, ROTATION_WATCHER_MIN_INTERVAL_SECONDS),
    max_per_hour: positiveInteger(raw.max_per_hour, ROTATION_WATCHER_MAX_PER_HOUR),
    confirm_wait_seconds: positiveInteger(raw.confirm_wait_seconds, ROTATION_CONFIRM_WAIT_SECONDS),
  };
  for (const [name, number] of Object.entries(numbers)) {
    if (number === null) return fail(`${name}_invalid`);
  }
  return {
    ok: true,
    value: {
      agent_id: agent,
      project,
      host,
      tmux_target: raw.tmux_target,
      expected_command: raw.expected_command,
      launch_command: launch,
      launch_script: { path: script.path, sha256: script.sha256 },
      owner_decision_ref: decision,
      aun_supervised: aun,
      prompt_markers: markers,
      placeholder_patterns: placeholders,
      drain_commands: drains,
      ...(numbers as { [K in keyof typeof numbers]: number }),
    },
  };
}

/** The file must be ours and not writable by anyone else (design 2.3); a bad file starts nothing. */
export function checkConfigPermissions(input: {
  uid: number;
  file: { uid: number; mode: number };
  folder: { uid: number; mode: number };
}): ConfigResult<true> {
  for (const [label, stat] of [["file", input.file], ["folder", input.folder]] as const) {
    if (stat.uid !== input.uid) return fail(`config_${label}_not_ours`);
    if ((stat.mode & 0o022) !== 0) return fail(`config_${label}_writable_by_others`);
  }
  return { ok: true, value: true };
}

/**
 * Seats that fail validation are returned in `rejected` with the reason, so the
 * run records why they are left alone; the valid seats are still served.
 */
export function parseWatcherConfig(rawText: string): ConfigResult<{
  config: WatcherConfig;
  rejected: Array<{ index: number; reason: string }>;
}> {
  let value: unknown;
  try {
    value = JSON.parse(rawText);
  } catch {
    return fail("config_not_json");
  }
  const raw = record(value);
  if (!raw || raw.schema_version !== WATCHER_CONFIG_SCHEMA || !Array.isArray(raw.seats)) return fail("config_shape_invalid");
  const limit = positiveInteger(raw.no_progress_halt_limit, ROTATION_WATCHER_NO_PROGRESS_HALT_LIMIT);
  if (limit === null) return fail("no_progress_halt_limit_invalid");
  const parsed: Array<{ index: number; seat: WatcherSeat }> = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  raw.seats.forEach((item, index) => {
    const result = parseSeat(item);
    if (result.ok) parsed.push({ index, seat: result.value });
    else rejected.push({ index, reason: result.reason });
  });
  const keyOf = (seat: WatcherSeat) => `${seat.agent_id}/${seat.project}`;
  const counts = new Map<string, number>();
  for (const { seat } of parsed) counts.set(keyOf(seat), (counts.get(keyOf(seat)) ?? 0) + 1);
  const seats: WatcherSeat[] = [];
  for (const { index, seat } of parsed) {
    // A seat named twice is ambiguous, so neither entry is served.
    if (counts.get(keyOf(seat)) === 1) seats.push(seat);
    else rejected.push({ index, reason: "seat_duplicated" });
  }
  rejected.sort((a, b) => a.index - b.index);
  return { ok: true, value: { config: { seats, no_progress_halt_limit: limit }, rejected } };
}
