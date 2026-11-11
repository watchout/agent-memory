/**
 * Local state files shared between the seat hooks and the rotation watcher
 * (watcher-design.md 2.1 / 2.2). Files hold ids, digests and times only: never
 * conversation text or secrets. Folders are 0700, files 0600, writes are
 * temp-file + rename so a reader never sees a half-written file.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ROTATION_SEAT_SEGMENT } from "./constants.js";
import type { RotationHost } from "./session-rotation-usage.js";

export const ROTATION_MARKER_SCHEMA = "kusabi-rotation-marker/v1" as const;
export const ROTATION_TURN_SCHEMA = "kusabi-rotation-turn/v1" as const;
export const ROTATION_HOOK_STATE_SCHEMA = "kusabi-rotation-hook-state/v1" as const;

export interface HostIdentity {
  pane_id: string | null;
  tmux_socket: string | null;
  host_pid: number | null;
  host_started_at: string | null;
}

export type HandoffSource = "seat_text" | "existing_records";

export interface RotationMarker extends HostIdentity {
  schema_version: typeof ROTATION_MARKER_SCHEMA;
  agent_id: string;
  project: string;
  host: RotationHost;
  session_id: string;
  pack_ref: string;
  pack_content_sha256: string;
  measured_tokens: number;
  threshold_tokens: number;
  saved_at: string;
  handoff_source: HandoffSource;
  marker_id: string;
}

export type TurnState = "busy" | "idle" | "started";

export interface RotationTurn extends HostIdentity {
  schema_version: typeof ROTATION_TURN_SCHEMA;
  agent_id: string;
  project: string;
  host: RotationHost;
  session_id: string;
  state: TurnState;
  source: string | null;
  rotation_marker_id: string | null;
  at: string;
}

export interface RotationHookState {
  schema_version: typeof ROTATION_HOOK_STATE_SCHEMA;
  session_id: string;
  blocked_at: string;
  measured_tokens: number;
  threshold_tokens: number;
}

/** The watcher-written claim, as far as the seat hooks read it (read-only here). */
export interface RotationClaim {
  state: string;
  marker_id: string;
  respawn_started_at: string | null;
}

const PANE_ID = /^%[0-9]+$/;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** JSON with object keys sorted, so the same fields always give the same digest. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The one place that decides where the seat's local state lives (shared by rotation and hook-input files). */
export function agentMemoryHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENT_MEMORY_HOME && env.AGENT_MEMORY_HOME.trim() !== ""
    ? env.AGENT_MEMORY_HOME
    : join(env.HOME && env.HOME.trim() !== "" ? env.HOME : homedir(), ".agent-memory");
}

export function rotationRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(agentMemoryHome(env), "rotation");
}

export function hookInputRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(agentMemoryHome(env), "hook-input");
}

export function seatDirectory(root: string, agentId: string, project: string): string {
  if (!ROTATION_SEAT_SEGMENT.test(agentId) || !ROTATION_SEAT_SEGMENT.test(project)) throw new Error("rotation_seat_name_invalid");
  return join(root, agentId, project);
}

export function normalizeStartedAt(value: string): string | null {
  const text = value.trim().replace(/\s+/g, " ");
  return text === "" ? null : text;
}

export type PsRunner = (pid: number) => string;

/** `lstart` is printed in the user's locale; the C locale keeps the hooks and the watcher comparing the same text. */
export const PS_ENV = { LC_ALL: "C" } as const;

export function runPsStartedAt(pid: number): string {
  return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    timeout: 2_000,
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, ...PS_ENV },
  });
}

/**
 * The pane and process this hook runs in. Outside tmux, or when the process
 * start time cannot be read, the missing parts are null and the watcher will
 * not act on this seat (watcher-design.md 2.2).
 */
export function resolveHostIdentity(
  env: NodeJS.ProcessEnv,
  parentPid: number,
  runPs: PsRunner = runPsStartedAt,
): HostIdentity {
  const pane = env.TMUX_PANE ?? "";
  const tmux = env.TMUX ?? "";
  const comma = tmux.indexOf(",");
  const socket = comma < 0 ? tmux : tmux.slice(0, comma);
  if (!PANE_ID.test(pane) || socket === "") {
    return { pane_id: null, tmux_socket: null, host_pid: null, host_started_at: null };
  }
  let startedAt: string | null = null;
  try {
    startedAt = normalizeStartedAt(runPs(parentPid));
  } catch {
    startedAt = null;
  }
  return {
    pane_id: pane,
    tmux_socket: socket,
    host_pid: startedAt === null ? null : parentPid,
    host_started_at: startedAt,
  };
}

export function buildMarker(fields: Omit<RotationMarker, "schema_version" | "marker_id">): RotationMarker {
  const base = { schema_version: ROTATION_MARKER_SCHEMA, ...fields };
  return { ...base, marker_id: sha256Hex(canonicalJson(base)) };
}

function syncPath(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

let tempCounter = 0;

/** Durable atomic replace: write a temp file, fsync it, rename, fsync the folder. */
export function writeJsonAtomic(path: string, value: unknown): void {
  const folder = dirname(path);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  tempCounter += 1;
  const temp = `${path}.${process.pid}.${tempCounter}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  syncPath(temp);
  renameSync(temp, path);
  syncPath(folder);
}

export function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function readMarker(directory: string): RotationMarker | null {
  const raw = readJsonFile(join(directory, "marker.json"));
  if (!raw || raw.schema_version !== ROTATION_MARKER_SCHEMA) return null;
  const { marker_id: markerId, ...rest } = raw;
  if (typeof markerId !== "string" || sha256Hex(canonicalJson(rest)) !== markerId) return null;
  return raw as unknown as RotationMarker;
}

export function readTurn(directory: string): RotationTurn | null {
  const raw = readJsonFile(join(directory, "turn.json"));
  return raw && raw.schema_version === ROTATION_TURN_SCHEMA ? (raw as unknown as RotationTurn) : null;
}

export function readHookState(directory: string): RotationHookState | null {
  const raw = readJsonFile(join(directory, "hook-state.json"));
  return raw && raw.schema_version === ROTATION_HOOK_STATE_SCHEMA ? (raw as unknown as RotationHookState) : null;
}

export function readClaim(directory: string, markerId: string): RotationClaim | null {
  if (!/^[0-9a-f]{64}$/.test(markerId)) return null;
  const raw = readJsonFile(join(directory, "claims", `${markerId}.json`));
  const state = text(raw?.state);
  if (!raw || state === null || raw.marker_id !== markerId) return null;
  return {
    state,
    marker_id: markerId,
    respawn_started_at: text(raw.respawn_started_at),
  };
}

export function writeTurn(directory: string, turn: Omit<RotationTurn, "schema_version">): void {
  writeJsonAtomic(join(directory, "turn.json"), { schema_version: ROTATION_TURN_SCHEMA, ...turn });
}

export function writeMarker(directory: string, marker: RotationMarker): void {
  writeJsonAtomic(join(directory, "marker.json"), marker);
}

export function writeHookState(directory: string, state: Omit<RotationHookState, "schema_version">): void {
  writeJsonAtomic(join(directory, "hook-state.json"), { schema_version: ROTATION_HOOK_STATE_SCHEMA, ...state });
}
