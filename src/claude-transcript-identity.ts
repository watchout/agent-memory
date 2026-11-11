/**
 * Which Claude Code transcript counts as "this seat's this conversation" (FR8).
 * Rule: aidlc .../construction/code-generation/capture-identity-design.md, R1-R9
 * (arc-sec ARCSEC-KUSABI-FR8-TRANSCRIPT-IDENTITY-20261111-001).
 *
 * The hook's own cwd is never an identity source: identity is the hook's
 * session_id plus the transcript's place (a regular file `<session_id>.jsonl`
 * directly inside the projects dir named after the seat's declared workspace)
 * plus the sessionId of every record inside. Per-record cwd is only counted.
 * This checks attribution; it is not a defence against a hostile same-uid process.
 */
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Record kinds the ingest never turns into events, so they may carry no sessionId (R4). */
export const CLAUDE_NON_INGESTED_KINDS: readonly string[] = [
  "file-history-snapshot",
  "file-history-delta",
  "summary",
];

export type ClaudeIdentityReason =
  | "path_outside_projects"
  | "not_regular_file_or_symlink"
  | "basename_mismatch"
  | "projects_dir_mismatch"
  | "record_session_mismatch"
  | "record_session_missing"
  | "parse_error";

export type ReceiptOutcome = "ingested" | "refused" | "unobserved";

/** Claude Code names a project dir after the launch dir with every non-alphanumeric as `-`. */
export function encodeClaudeProjectDir(workspace: string): string {
  return resolve(workspace).replace(/[^A-Za-z0-9]/g, "-");
}

export interface ClaudePlacementInput {
  transcript_path: string;
  projects_root: string;
  session_id: string;
  declared_workspace: string;
  /** The current user's uid; null where the platform has none (owner check skipped). */
  uid: number | null;
}

export type ClaudePlacement =
  | { ok: true; real_path: string }
  | { ok: false; reason: Exclude<ClaudeIdentityReason, "record_session_mismatch" | "record_session_missing" | "parse_error"> | "transcript_unavailable" };

const reject = (reason: Extract<ClaudePlacement, { ok: false }>["reason"]): ClaudePlacement => ({ ok: false, reason });

/** R1-R3: the place of the file. Reads only file metadata. */
export function checkClaudeTranscriptPlacement(input: ClaudePlacementInput): ClaudePlacement {
  const requested = resolve(input.transcript_path);
  let stat;
  let real: string;
  try {
    stat = lstatSync(requested);
    real = realpathSync(requested);
  } catch {
    return reject("transcript_unavailable");
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return reject("not_regular_file_or_symlink");
  if (input.uid !== null && stat.uid !== input.uid) return reject("path_outside_projects");
  let root: string;
  try {
    root = realpathSync(resolve(input.projects_root));
  } catch {
    return reject("path_outside_projects");
  }
  const rel = relative(root, real);
  const parts = rel.split(sep);
  if (rel === "" || isAbsolute(rel) || parts.includes("..") || parts.length !== 2) {
    return reject("path_outside_projects");
  }
  if (parts[1] !== `${input.session_id}.jsonl`) return reject("basename_mismatch");
  if (parts[0] !== encodeClaudeProjectDir(input.declared_workspace)) return reject("projects_dir_mismatch");
  return { ok: true, real_path: real };
}

export type ClaudeRecordsJudgement =
  | { ok: true; cwd_kinds: number; records_outside_workspace: number }
  | { ok: false; reason: "record_session_mismatch" | "record_session_missing" | "parse_error" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function within(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** R4-R5: every record must belong to the session; cwd values are only counted. Pure. */
export function judgeClaudeRecords(raw: string, sessionId: string, workspaceRoots: string[]): ClaudeRecordsJudgement {
  let parsed = 0;
  let matching = 0;
  let outside = 0;
  const cwds = new Set<string>();
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(value)) continue;
    parsed += 1;
    let carriesId = false;
    for (const key of ["sessionId", "session_id"]) {
      if (!(key in value)) continue;
      if (value[key] !== sessionId) return { ok: false, reason: "record_session_mismatch" };
      carriesId = true;
    }
    if (carriesId) {
      matching += 1;
    } else if (typeof value.type !== "string" || !CLAUDE_NON_INGESTED_KINDS.includes(value.type)) {
      return { ok: false, reason: "record_session_missing" };
    }
    if (typeof value.cwd === "string" && value.cwd !== "") {
      cwds.add(value.cwd);
      if (!workspaceRoots.some((workspaceRoot) => within(workspaceRoot, String(value.cwd)))) outside += 1;
    }
  }
  if (parsed === 0) return { ok: false, reason: "parse_error" };
  if (matching === 0) return { ok: false, reason: "record_session_missing" };
  return { ok: true, cwd_kinds: cwds.size, records_outside_workspace: outside };
}

const REFUSED_REASONS: ReadonlySet<string> = new Set([
  "path_outside_projects",
  "not_regular_file_or_symlink",
  "basename_mismatch",
  "projects_dir_mismatch",
  "record_session_mismatch",
  "record_session_missing",
  "session_mismatch",
  "workspace_mismatch",
  "transcript_invalid",
  "identity_binding_invalid",
]);

/** R7: three values. Anything that is not a capture or a refusal is "could not observe", never success. */
export function receiptOutcome(result: { status: string; reason: string }): ReceiptOutcome {
  if (result.status === "captured") return "ingested";
  return REFUSED_REASONS.has(result.reason) ? "refused" : "unobserved";
}
