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

export interface LedgerSummary {
  last_respawn_ms: number | null;
  respawns_in_last_hour: number;
}

const HOUR_MS = 3_600_000;

/** Respawn history for one seat: lines that mean a respawn was issued or may have been. */
export function summarizeLedger(
  fs: WatcherFs,
  rotationRoot: string,
  agentId: string,
  project: string,
  nowMs: number,
): LedgerSummary {
  const text = fs.readText(ledgerPath(rotationRoot)) ?? "";
  let last: number | null = null;
  let recent = 0;
  for (const row of text.split("\n")) {
    if (row === "") continue;
    try {
      const entry = JSON.parse(row) as Record<string, unknown>;
      if (entry.agent_id !== agentId || entry.project !== project) continue;
      if (entry.kind !== "respawn_issued" && entry.kind !== "outcome_unknown") continue;
      const at = typeof entry.at === "string" ? Date.parse(entry.at) : Number.NaN;
      if (Number.isNaN(at)) continue;
      last = last === null ? at : Math.max(last, at);
      if (nowMs - at < HOUR_MS) recent += 1;
    } catch {
      continue;
    }
  }
  return { last_respawn_ms: last, respawns_in_last_hour: recent };
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
