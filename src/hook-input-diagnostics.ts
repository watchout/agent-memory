/**
 * Diagnostic record of the key names a hook input carried that the entry does not know (FR10.3, FR10.4).
 * A record holds names, event names, counts and times only: never a value, a path or a session id.
 * It is not part of any evidence contract and it never decides a hook's answer. Everything here is
 * asynchronous, so the timer in finishAfterAnswer always fires and a stuck disk cannot hold a hook open.
 */
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROTATION_SEAT_SEGMENT } from "./constants.js";
import { hookInputRoot } from "./session-rotation-files.js";

export const HOOK_INPUT_DIAGNOSTIC_SCHEMA = "kusabi-hook-input-diagnostics/v1" as const;
export const HOOK_DIAGNOSTIC_MAX_ENTRIES = 32;
export const HOOK_DIAGNOSTIC_MAX_FILE_BYTES = 64 * 1024;
/** The longest a hook is held open for the diagnostic after its answer is written. */
export const HOOK_DIAGNOSTIC_MAX_WAIT_MS = 200;
/** The diagnostic is not started when less than this is left of the hook's budget. */
export const HOOK_DIAGNOSTIC_MIN_REMAINING_MS = 2000;

export type HookInputDiagnosticEvent = "SessionStart" | "Stop" | "UserPromptSubmit";

export interface HookInputDiagnosticEntry {
  event: HookInputDiagnosticEvent;
  name: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

export interface HookInputDiagnostic {
  schema_version: typeof HOOK_INPUT_DIAGNOSTIC_SCHEMA;
  adapter_id: string;
  entries: HookInputDiagnosticEntry[];
  dropped_names: number;
  invalid_names: number;
}

export interface HookDiagnosticRequest {
  env: NodeJS.ProcessEnv;
  agent_id: string;
  project: string;
  adapter_id: string;
  event: HookInputDiagnosticEvent;
  names: readonly string[];
  now: Date;
  pid: number;
}

const EVENTS: readonly string[] = ["SessionStart", "Stop", "UserPromptSubmit"];
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const ADAPTER = /^[a-z][a-z0-9-]{0,63}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RECORD_KEYS = ["adapter_id", "dropped_names", "entries", "invalid_names", "schema_version"];
const ENTRY_KEYS = ["count", "event", "first_seen", "last_seen", "name"];

// Plain code-unit order, so the same inputs make the same file on every machine and locale.
const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byOldest = (a: HookInputDiagnosticEntry, b: HookInputDiagnosticEntry): number =>
  order(a.last_seen, b.last_seen) || a.count - b.count || order(a.name, b.name) || order(a.event, b.event);
const byName = (a: HookInputDiagnosticEntry, b: HookInputDiagnosticEntry): number =>
  order(a.name, b.name) || order(a.event, b.event);

export function applyIgnoredNames(
  state: HookInputDiagnostic | null,
  adapterId: string,
  event: HookInputDiagnosticEvent,
  names: readonly string[],
  nowIso: string,
): HookInputDiagnostic {
  const distinct = [...new Set(names)];
  const valid = distinct.filter((name) => NAME.test(name)).sort();
  const used = valid.slice(0, HOOK_DIAGNOSTIC_MAX_ENTRIES);
  let entries = (state?.entries ?? []).map((entry) => ({ ...entry }));
  let dropped = (state?.dropped_names ?? 0) + (valid.length - used.length);
  for (const name of used) {
    const known = entries.find((entry) => entry.event === event && entry.name === name);
    if (known) {
      known.count += 1;
      known.last_seen = nowIso;
      continue;
    }
    if (entries.length >= HOOK_DIAGNOSTIC_MAX_ENTRIES) {
      const victim = [...entries].sort(byOldest)[0];
      entries = entries.filter((entry) => entry !== victim);
      dropped += 1;
    }
    entries.push({ event, name, count: 1, first_seen: nowIso, last_seen: nowIso });
  }
  return {
    schema_version: HOOK_INPUT_DIAGNOSTIC_SCHEMA,
    adapter_id: adapterId,
    entries: entries.sort(byName),
    dropped_names: dropped,
    invalid_names: (state?.invalid_names ?? 0) + (distinct.length - valid.length),
  };
}

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(value).sort();
  return own.length === keys.length && own.every((key, index) => key === keys[index]);
};
const counter = (value: unknown, minimum: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;

function parseEntry(value: unknown): HookInputDiagnosticEntry | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (
    !exactKeys(entry, ENTRY_KEYS) ||
    typeof entry.event !== "string" || !EVENTS.includes(entry.event) ||
    typeof entry.name !== "string" || !NAME.test(entry.name) ||
    !counter(entry.count, 1) ||
    typeof entry.first_seen !== "string" || !TIME.test(entry.first_seen) ||
    typeof entry.last_seen !== "string" || !TIME.test(entry.last_seen)
  ) {
    return null;
  }
  return {
    event: entry.event as HookInputDiagnosticEvent,
    name: entry.name,
    count: entry.count,
    first_seen: entry.first_seen,
    last_seen: entry.last_seen,
  };
}

/** Returns the record only when every field is exactly what this module writes; anything else is null. */
export function parseHookInputDiagnostic(text: string): HookInputDiagnostic | null {
  if (Buffer.byteLength(text, "utf8") > HOOK_DIAGNOSTIC_MAX_FILE_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    !exactKeys(record, RECORD_KEYS) ||
    record.schema_version !== HOOK_INPUT_DIAGNOSTIC_SCHEMA ||
    typeof record.adapter_id !== "string" || !ADAPTER.test(record.adapter_id) ||
    !Array.isArray(record.entries) || record.entries.length > HOOK_DIAGNOSTIC_MAX_ENTRIES ||
    !counter(record.dropped_names, 0) || !counter(record.invalid_names, 0)
  ) {
    return null;
  }
  const entries = record.entries.map(parseEntry);
  if (entries.some((entry) => entry === null)) return null;
  const parsed = entries as HookInputDiagnosticEntry[];
  if (new Set(parsed.map((entry) => `${entry.event}\0${entry.name}`)).size !== parsed.length) return null;
  return {
    schema_version: HOOK_INPUT_DIAGNOSTIC_SCHEMA,
    adapter_id: record.adapter_id,
    entries: parsed,
    dropped_names: record.dropped_names,
    invalid_names: record.invalid_names,
  };
}

export function hookInputDiagnosticFolder(env: NodeJS.ProcessEnv, agentId: string, project: string): string {
  if (!ROTATION_SEAT_SEGMENT.test(agentId) || !ROTATION_SEAT_SEGMENT.test(project)) {
    throw new Error("hook_input_diagnostic_seat_invalid");
  }
  return join(hookInputRoot(env), agentId, project);
}

export function hookInputDiagnosticPath(
  env: NodeJS.ProcessEnv,
  agentId: string,
  project: string,
  adapterId: string,
): string {
  if (!ADAPTER.test(adapterId)) throw new Error("hook_input_diagnostic_adapter_invalid");
  return join(hookInputDiagnosticFolder(env, agentId, project), `${adapterId}.json`);
}

/** What the trust checks need from an lstat result (a Stats object satisfies it). */
export interface FileInfo {
  isDirectory(): boolean;
  isFile(): boolean;
  uid: number;
  mode: number;
  size: number;
}

/** A real folder (not a link), owned by this user and closed to group and others. Takes an lstat result. */
export function isPrivateFolderInfo(info: FileInfo): boolean {
  return info.isDirectory() && info.uid === process.getuid?.() && (info.mode & 0o077) === 0;
}

/** A real file (not a link), owned by this user, closed to group and others, within the read limit. Takes an lstat result. */
export function isPrivateRecordInfo(info: FileInfo): boolean {
  return info.isFile() && info.uid === process.getuid?.() && (info.mode & 0o077) === 0 && info.size <= HOOK_DIAGNOSTIC_MAX_FILE_BYTES;
}

async function ensurePrivateFolder(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  if (!isPrivateFolderInfo(await lstat(path))) throw new Error("hook_input_diagnostic_folder_untrusted");
}

async function readCurrent(target: string, adapterId: string): Promise<HookInputDiagnostic | null> {
  try {
    if (!isPrivateRecordInfo(await lstat(target))) return null;
    const parsed = parseHookInputDiagnostic(await readFile(target, "utf8"));
    return parsed !== null && parsed.adapter_id === adapterId ? parsed : null;
  } catch {
    return null;
  }
}

/** Adds the names to the record of this adapter. Never throws: a diagnostic that cannot be written is dropped. */
export async function writeHookInputDiagnostic(request: HookDiagnosticRequest): Promise<void> {
  let temporary: string | null = null;
  try {
    if (request.names.length === 0 || !EVENTS.includes(request.event) || !Number.isFinite(request.now.getTime())) return;
    if (!Number.isSafeInteger(request.pid) || request.pid < 0) return;
    const folder = hookInputDiagnosticFolder(request.env, request.agent_id, request.project);
    const target = hookInputDiagnosticPath(request.env, request.agent_id, request.project, request.adapter_id);
    const root = hookInputRoot(request.env);
    await mkdir(root, { recursive: true, mode: 0o700 });
    for (const path of [root, join(root, request.agent_id), folder]) await ensurePrivateFolder(path);
    const next = applyIgnoredNames(
      await readCurrent(target, request.adapter_id),
      request.adapter_id,
      request.event,
      request.names,
      request.now.toISOString(),
    );
    temporary = `${target}.${request.pid}.${request.now.getTime()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, target);
    temporary = null;
  } catch {
    if (temporary !== null) await rm(temporary, { force: true }).catch(() => undefined);
  }
}

/**
 * Called once the hook's answer and evidence are fully written. Starts the diagnostic only when at least
 * HOOK_DIAGNOSTIC_MIN_REMAINING_MS of the budget is left, then calls exit when the diagnostic ends or after
 * min(remaining, HOOK_DIAGNOSTIC_MAX_WAIT_MS), whichever is first. The diagnostic's result is dropped.
 */
export function finishAfterAnswer(options: {
  remaining_ms: number;
  run_diagnostic: () => Promise<unknown> | void;
  exit: () => void;
}): void {
  let finished = false;
  let timer: NodeJS.Timeout | undefined;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    options.exit();
  };
  if (!(options.remaining_ms >= HOOK_DIAGNOSTIC_MIN_REMAINING_MS)) {
    finish();
    return;
  }
  timer = setTimeout(finish, Math.min(options.remaining_ms, HOOK_DIAGNOSTIC_MAX_WAIT_MS));
  try {
    void Promise.resolve(options.run_diagnostic()).then(finish, finish);
  } catch {
    finish();
  }
}
