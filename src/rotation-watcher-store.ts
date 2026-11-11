/**
 * Files the rotation watcher writes: the one-per-marker claim, the append-only
 * evidence ledger, and the HALT files (watcher-design.md 5, 6, 7). All file
 * access goes through `WatcherFs` so a test can make a write fail. Every
 * write reports failure instead of throwing, and the caller treats a failed
 * write before a respawn as "do not respawn".
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { writeJsonAtomic } from "./session-rotation-files.js";

export const CLAIM_SCHEMA = "kusabi-rotation-claim/v1" as const;
export const LEDGER_SCHEMA = "kusabi-rotation-watcher-evidence/v1" as const;

export interface WatcherFs {
  exists(path: string): boolean;
  readText(path: string): string | null;
  stat(path: string): { uid: number; mode: number } | null;
  /** Creates the file only if it does not exist (O_EXCL), then makes it and its folder durable. */
  createExclusive(path: string, text: string): "created" | "exists";
  replace(path: string, value: unknown): void;
  appendDurable(path: string, text: string): void;
}

function syncFolder(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export const nodeWatcherFs: WatcherFs = {
  exists: (path) => existsSync(path),
  readText: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  stat: (path) => {
    try {
      const { uid, mode } = statSync(path);
      return { uid, mode };
    } catch {
      return null;
    }
  },
  createExclusive: (path, text) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    let descriptor: number;
    try {
      descriptor = openSync(path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return "exists";
      throw error;
    }
    try {
      writeSync(descriptor, text);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    syncFolder(dirname(path));
    return "created";
  },
  replace: (path, value) => writeJsonAtomic(path, value),
  appendDurable: (path, text) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const descriptor = openSync(path, "a", 0o600);
    try {
      writeSync(descriptor, text);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  },
};

export type ClaimState = "claimed" | "respawning" | "done" | "unconfirmed" | "aborted_before_respawn" | "unknown_quarantined";

const TERMINAL: readonly ClaimState[] = ["done", "unconfirmed", "aborted_before_respawn", "unknown_quarantined"];
const IN_PROGRESS: readonly ClaimState[] = ["claimed", "respawning"];

export interface ClaimRecord {
  schema_version: typeof CLAIM_SCHEMA;
  marker_id: string;
  launch_command_sha256: string;
  attempt_id: string;
  watcher_pid: number;
  claimed_at: string;
  state: ClaimState;
  respawn_started_at: string | null;
  pane_pid_before: number | null;
  resolution: string | null;
}

export const isTerminalClaim = (claim: ClaimRecord): boolean => TERMINAL.includes(claim.state);

export const claimPath = (seatDir: string, markerId: string): string => join(seatDir, "claims", `${markerId}.json`);

export type ClaimRead = { kind: "none" } | { kind: "unreadable" } | { kind: "found"; claim: ClaimRecord };

export function readClaimRecord(fs: WatcherFs, seatDir: string, markerId: string): ClaimRead {
  const path = claimPath(seatDir, markerId);
  if (!fs.exists(path)) return { kind: "none" };
  const text = fs.readText(path);
  let raw: Record<string, unknown> | null = null;
  try {
    const value: unknown = text === null ? null : JSON.parse(text);
    raw = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    raw = null;
  }
  const state = raw?.state;
  const valid =
    raw !== null &&
    raw.schema_version === CLAIM_SCHEMA &&
    raw.marker_id === markerId &&
    typeof raw.attempt_id === "string" &&
    typeof raw.watcher_pid === "number" &&
    typeof state === "string" &&
    [...TERMINAL, ...IN_PROGRESS].includes(state as ClaimState);
  return valid ? { kind: "found", claim: { respawn_started_at: null, pane_pid_before: null, resolution: null, ...(raw as object) } as ClaimRecord } : { kind: "unreadable" };
}

export function createClaim(
  fs: WatcherFs,
  seatDir: string,
  fields: Pick<ClaimRecord, "marker_id" | "launch_command_sha256" | "attempt_id" | "watcher_pid" | "claimed_at">,
): { result: "created"; claim: ClaimRecord } | { result: "exists" } | { result: "failed" } {
  const claim: ClaimRecord = {
    schema_version: CLAIM_SCHEMA,
    ...fields,
    state: "claimed",
    respawn_started_at: null,
    pane_pid_before: null,
    resolution: null,
  };
  try {
    const result = fs.createExclusive(claimPath(seatDir, fields.marker_id), `${JSON.stringify(claim, null, 2)}\n`);
    return result === "created" ? { result: "created", claim } : { result: "exists" };
  } catch {
    return { result: "failed" };
  }
}

/** Moves a claim forward; returns the new record, or null when it could not be written. */
export function advanceClaim(
  fs: WatcherFs,
  seatDir: string,
  claim: ClaimRecord,
  patch: Partial<Pick<ClaimRecord, "state" | "respawn_started_at" | "pane_pid_before" | "resolution">>,
): ClaimRecord | null {
  const next: ClaimRecord = { ...claim, ...patch };
  try {
    fs.replace(claimPath(seatDir, claim.marker_id), next);
    return next;
  } catch {
    return null;
  }
}

export type LedgerKind = "intent" | "respawn_issued" | "confirmed" | "unconfirmed" | "outcome_unknown" | "skipped";

/** Fields the ledger may carry. Screen text, conversation text and environment values have no field. */
export interface LedgerFields {
  at: string;
  attempt_id: string | null;
  marker_id: string;
  host: string;
  agent_id: string;
  project: string;
  old_session_id?: string;
  pane_id?: string | null;
  pane_pid?: number;
  host_pid?: number | null;
  host_started_at?: string | null;
  launch_command_sha256?: string;
  launch_script_sha256?: string;
  input_row_sha256?: string;
  input_empty?: boolean;
  client_activity_max?: number | null;
  reason?: string;
  detail?: string;
}

export const ledgerPath = (rotationRoot: string): string => join(rotationRoot, "watcher-ledger.jsonl");

export function appendLedger(fs: WatcherFs, rotationRoot: string, kind: LedgerKind, fields: LedgerFields): boolean {
  try {
    fs.appendDurable(ledgerPath(rotationRoot), `${JSON.stringify({ schema_version: LEDGER_SCHEMA, kind, ...fields })}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * What the ledger says about one seat's respawns. "Unreadable" is its own answer:
 * a ledger that exists but cannot be read in full is not an empty history (S5), and
 * the caller must not respawn on it.
 */
export type LedgerSummary =
  | { readable: true; last_respawn_ms: number | null; respawns_in_last_hour: number }
  | { readable: false; reason: string };

const HOUR_MS = 3_600_000;

/** Lines that mean a respawn was issued, may have been, or was found to have happened. */
const COUNTING_KINDS: readonly string[] = ["respawn_issued", "outcome_unknown", "confirmed"];

/**
 * Respawn history for one seat. One attempt counts once, at the latest time of its
 * counting lines - a respawn that was only found by the later inquiry has no
 * `respawn_issued` line and still counts. A missing ledger is an empty history; a
 * ledger that is unreadable, or has a line that cannot be understood, is unreadable.
 */
export function summarizeLedger(
  fs: WatcherFs,
  rotationRoot: string,
  agentId: string,
  project: string,
  nowMs: number,
): LedgerSummary {
  const path = ledgerPath(rotationRoot);
  if (!fs.exists(path)) return { readable: true, last_respawn_ms: null, respawns_in_last_hour: 0 };
  const text = fs.readText(path);
  if (text === null) return { readable: false, reason: "ledger_unreadable" };
  const attempts = new Map<string, number>();
  for (const row of text.split("\n")) {
    if (row === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(row);
    } catch {
      return { readable: false, reason: "ledger_line_unparsable" };
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { readable: false, reason: "ledger_line_not_an_object" };
    }
    const line = entry as Record<string, unknown>;
    if (line.agent_id !== agentId || line.project !== project) continue;
    if (typeof line.kind !== "string" || !COUNTING_KINDS.includes(line.kind)) continue;
    const at = typeof line.at === "string" ? Date.parse(line.at) : Number.NaN;
    if (Number.isNaN(at)) return { readable: false, reason: "ledger_line_time_invalid" };
    if (typeof line.attempt_id !== "string" || line.attempt_id === "") {
      return { readable: false, reason: "ledger_line_attempt_missing" };
    }
    attempts.set(line.attempt_id, Math.max(attempts.get(line.attempt_id) ?? at, at));
  }
  const times = [...attempts.values()];
  return {
    readable: true,
    last_respawn_ms: times.length === 0 ? null : Math.max(...times),
    respawns_in_last_hour: times.filter((at) => nowMs - at < HOUR_MS).length,
  };
}

export const globalHaltPath = (rotationRoot: string): string => join(rotationRoot, "HALT");
export const seatHaltPath = (seatDir: string): string => join(seatDir, "HALT");

/** HALT files are plain markers: the watcher writes them, a person deletes them. */
export function writeHalt(fs: WatcherFs, path: string, reason: string, atIso: string): boolean {
  try {
    fs.replace(path, { reason, at: atIso });
    return true;
  } catch {
    return false;
  }
}
