/**
 * Bounded, fail-open transcript receive for native SessionStart hooks.
 *
 * The hook-supplied transcript is accepted only when it is a regular file in
 * the current host's transcript root and its session/workspace identity
 * matches the already-verified SessionStart input. No directory sweep occurs.
 */
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  checkClaudeTranscriptPlacement,
  judgeClaudeRecords,
  type ClaudeIdentityReason,
} from "./claude-transcript-identity.js";
import {
  getAntigravityBrainDir,
  ingestAntigravityConversationEvents,
  isAntigravityConversationId,
  isCanonicalAbsoluteAntigravityPath,
  readSelectedFullLines,
  secureAntigravityTranscriptPath,
  truncatedAntigravityLineNumbers,
} from "./antigravity-conversation-ingest.js";
import {
  getClaudeProjectsDir,
  ingestClaudeConversationEvents,
} from "./claude-conversation-ingest.js";
import {
  getCodexSessionsDir,
  ingestCodexConversationEvents,
} from "./codex-conversation-ingest.js";
import {
  getGeminiChatsDir,
  ingestGeminiConversationEvents,
} from "./gemini-conversation-ingest.js";
import { currentUid } from "./process-uid.js";
import type { Store } from "./stores/types.js";

export const SESSION_START_TRANSCRIPT_MAX_BYTES = 8 * 1024 * 1024;
const INGEST_FROM_EPOCH = "1970-01-01T00:00:00.000Z";

export type SessionStartTranscriptHost = "antigravity_cli" | "codex" | "claude_code" | "gemini_cli";

export interface SessionStartAutoReceiveInput {
  host: SessionStartTranscriptHost;
  agent_id: string;
  project: string;
  workspace: string;
  cwd: string;
  session_id: string;
  transcript_path: string | null;
  roots?: Partial<Record<SessionStartTranscriptHost, string>>;
  max_bytes?: number;
  snapshot_mode?: "full" | "tail";
  tail_bytes?: number;
}

export interface SessionStartAutoReceiveResult {
  status: "captured" | "skipped" | "failed_open";
  reason:
    | "captured"
    | "transcript_unavailable"
    | "transcript_invalid"
    | "transcript_too_large"
    | "transcript_unstable"
    | "workspace_mismatch"
    | "session_mismatch"
    | "ingest_failed"
    | ClaudeIdentityReason;
  events_saved: number;
  events_duplicate: number;
  /** Claude only (R5): number of distinct record cwd values, kept as a number, not a gate. */
  cwd_kinds?: number;
  /** Claude only (R5): records whose cwd is outside the seat's declared workspace. */
  records_outside_workspace?: number;
}

export async function receiveCurrentSessionTranscript(
  store: Store,
  input: SessionStartAutoReceiveInput,
): Promise<SessionStartAutoReceiveResult> {
  if (input.host === "claude_code") return receiveClaudeTranscript(store, input);
  try {
    if (!input.transcript_path) return skipped("transcript_unavailable");
    if (input.host === "antigravity_cli" &&
      (!isCanonicalAbsoluteAntigravityPath(input.transcript_path) || !isAntigravityConversationId(input.session_id))) {
      return skipped("transcript_invalid");
    }
    const requestedRoot = rootForHost(input);
    const transcript = input.snapshot_mode === "tail" && input.host === "codex"
      ? readBoundedTranscriptTailSnapshot(input.host, input.transcript_path, input.tail_bytes)
      : readBoundedTranscriptSnapshot(
        input.host,
        input.transcript_path,
        input.max_bytes,
        input.host === "antigravity_cli" ? requestedRoot : undefined,
      );
    if (transcript.status !== "valid") return skipped(transcript.reason);

    const workspace = realpathSync(resolve(input.workspace));
    const cwd = realpathSync(resolve(input.cwd));
    if (!isWithin(workspace, cwd)) return skipped("workspace_mismatch");

    const root = realpathSync(resolve(requestedRoot));
    if (!isWithin(root, transcript.path)) return skipped("transcript_invalid");

    const raw = transcript.raw;
    if (!matchesCurrentSession(input, transcript.path, transcript.validation_raw ?? raw, workspace, cwd, root)) {
      return skipped("session_mismatch");
    }

    const common = {
      project: input.project,
      since: INGEST_FROM_EPOCH,
      root,
      max_files: 1,
      files: [transcript.path],
      contents: new Map([[transcript.path, raw]]),
    };
    const result = input.host === "codex"
      ? await ingestCodexConversationEvents(store, input.agent_id, common)
      : input.host === "gemini_cli"
        ? await ingestGeminiConversationEvents(store, input.agent_id, common)
        : await ingestAntigravityConversationEvents(store, input.agent_id, {
            project: input.project,
            root,
            files: [transcript.path],
            contents: new Map([[transcript.path, raw]]),
            full_lines: new Map([[
              transcript.path,
              readSelectedFullLines(transcript.path, truncatedAntigravityLineNumbers(raw), root),
            ]]),
            fallback_occurred_at: new Date(transcript.mtime_ms).toISOString(),
          });
    return {
      status: "captured",
      reason: "captured",
      events_saved: result.events_saved,
      events_duplicate: result.events_duplicate,
    };
  } catch {
    return {
      status: "failed_open",
      reason: "ingest_failed",
      events_saved: 0,
      events_duplicate: 0,
    };
  }
}

/**
 * Claude Code (FR8, capture-identity-design.md): identity comes from the hook's
 * session_id and transcript_path, the file's place, and every record's sessionId.
 * The hook's cwd is not consulted (R1); record cwd values are only counted (R5).
 */
async function receiveClaudeTranscript(
  store: Store,
  input: SessionStartAutoReceiveInput,
): Promise<SessionStartAutoReceiveResult> {
  try {
    if (!input.transcript_path) return skipped("transcript_unavailable");
    const requestedRoot = rootForHost(input);
    const placement = checkClaudeTranscriptPlacement({
      transcript_path: input.transcript_path,
      projects_root: requestedRoot,
      session_id: input.session_id,
      declared_workspace: input.workspace,
      uid: currentUid(),
    });
    if (!placement.ok) return skipped(placement.reason);

    const transcript = input.snapshot_mode === "tail"
      ? readBoundedTranscriptTailSnapshot("claude_code", placement.real_path, input.tail_bytes)
      : readBoundedTranscriptSnapshot("claude_code", placement.real_path, input.max_bytes);
    if (transcript.status !== "valid") return skipped(transcript.reason);

    const workspaceRoots = [resolve(input.workspace), realpathSync(resolve(input.workspace))];
    const judged = judgeClaudeRecords(transcript.validation_raw ?? transcript.raw, input.session_id, workspaceRoots);
    if (!judged.ok) {
      return judged.reason === "parse_error"
        ? { status: "failed_open", reason: "parse_error", events_saved: 0, events_duplicate: 0 }
        : skipped(judged.reason);
    }

    const result = await ingestClaudeConversationEvents(store, input.agent_id, {
      project: input.project,
      since: INGEST_FROM_EPOCH,
      root: realpathSync(resolve(requestedRoot)),
      max_files: 1,
      files: [transcript.path],
      contents: new Map([[transcript.path, transcript.raw]]),
    });
    return {
      status: "captured",
      reason: "captured",
      events_saved: result.events_saved,
      events_duplicate: result.events_duplicate,
      cwd_kinds: judged.cwd_kinds,
      records_outside_workspace: judged.records_outside_workspace,
    };
  } catch {
    return { status: "failed_open", reason: "ingest_failed", events_saved: 0, events_duplicate: 0 };
  }
}

export interface BoundedTranscriptSnapshot {
  status: "valid";
  path: string;
  raw: string;
  device: number;
  inode: number;
  size: number;
  mtime_ms: number;
  validation_raw?: string;
}

export function readBoundedTranscriptTailSnapshot(
  host: "codex" | "claude_code",
  transcriptPath: string,
  tailBytes: number = 1024 * 1024,
): BoundedTranscriptSnapshot | { status: "invalid"; reason: SessionStartAutoReceiveResult["reason"] } {
  let descriptor: number | undefined;
  try {
    const requested = resolve(transcriptPath);
    const supplied = lstatSync(requested);
    if (supplied.isSymbolicLink() || !supplied.isFile()) {
      return { status: "invalid", reason: "transcript_invalid" };
    }
    descriptor = openSync(requested, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.dev !== supplied.dev || before.ino !== supplied.ino) {
      return { status: "invalid", reason: "transcript_unstable" };
    }
    if (before.size <= 0) return { status: "invalid", reason: "transcript_unavailable" };
    const boundedTailBytes = Math.max(1, Math.min(tailBytes, 8 * 1024 * 1024));
    if (before.size <= boundedTailBytes) {
      closeSync(descriptor);
      descriptor = undefined;
      return readBoundedTranscriptSnapshot(host, requested, boundedTailBytes);
    }
    const path = realpathSync(requested);
    const pathBefore = lstatSync(path);
    if (pathBefore.isSymbolicLink() || pathBefore.dev !== before.dev || pathBefore.ino !== before.ino ||
      !path.endsWith(".jsonl")) {
      return { status: "invalid", reason: "transcript_unstable" };
    }
    const headSize = Math.min(before.size, 256 * 1024);
    const head = Buffer.alloc(headSize);
    if (readSync(descriptor, head, 0, head.length, 0) !== head.length) {
      return { status: "invalid", reason: "transcript_unstable" };
    }
    const tail = Buffer.alloc(boundedTailBytes);
    const tailOffset = before.size - boundedTailBytes;
    if (readSync(descriptor, tail, 0, tail.length, tailOffset) !== tail.length) {
      return { status: "invalid", reason: "transcript_unstable" };
    }
    const after = fstatSync(descriptor);
    const pathAfter = lstatSync(path);
    if (after.size !== before.size || after.dev !== before.dev || after.ino !== before.ino ||
      pathAfter.dev !== before.dev || pathAfter.ino !== before.ino) {
      return { status: "invalid", reason: "transcript_unstable" };
    }
    const tailText = tail.toString("utf8");
    const firstNewline = tailText.indexOf("\n");
    const alignedTail = firstNewline < 0 ? "" : tailText.slice(firstNewline + 1);
    const headText = head.toString("utf8");
    return {
      status: "valid",
      path,
      raw: alignedTail,
      validation_raw: `${headText}\n${alignedTail}`,
      device: before.dev,
      inode: before.ino,
      size: before.size,
      mtime_ms: before.mtimeMs,
    };
  } catch {
    return { status: "invalid", reason: "transcript_unavailable" };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function readBoundedTranscriptSnapshot(
  host: SessionStartTranscriptHost,
  transcriptPath: string,
  maxBytes: number = SESSION_START_TRANSCRIPT_MAX_BYTES,
  antigravityRoot?: string,
): BoundedTranscriptSnapshot | { status: "invalid"; reason: SessionStartAutoReceiveResult["reason"] } {
  let descriptor: number | undefined;
  try {
    if (host === "antigravity_cli" && !isCanonicalAbsoluteAntigravityPath(transcriptPath)) {
      return { status: "invalid", reason: "transcript_invalid" };
    }
    const requested = host === "antigravity_cli" ? transcriptPath : resolve(transcriptPath);
    const secureAntigravityPath = host === "antigravity_cli"
      ? secureAntigravityTranscriptPath(antigravityRoot ?? getAntigravityBrainDir(), requested)
      : null;
    if (host === "antigravity_cli" && secureAntigravityPath === null) {
      return { status: "invalid", reason: "transcript_invalid" };
    }
    const supplied = lstatSync(requested);
    if (supplied.isSymbolicLink() || !supplied.isFile()) {
      return { status: "invalid", reason: "transcript_invalid" };
    }
    descriptor = openSync(requested, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.dev !== supplied.dev || before.ino !== supplied.ino) {
      return { status: "invalid", reason: "transcript_unstable" };
    }
    if (before.size <= 0) return { status: "invalid", reason: "transcript_unavailable" };
    if (before.size > Math.max(1, maxBytes)) {
      return { status: "invalid", reason: "transcript_too_large" };
    }
    const path = realpathSync(requested);
    if (host === "antigravity_cli" && path !== secureAntigravityPath) {
      return { status: "invalid", reason: "transcript_unstable" };
    }
    const pathBefore = lstatSync(path);
    if (pathBefore.isSymbolicLink() || pathBefore.dev !== before.dev || pathBefore.ino !== before.ino) {
      return { status: "invalid", reason: "transcript_unstable" };
    }
    const allowedExtension = path.endsWith(".jsonl") || (host === "gemini_cli" && path.endsWith(".json"));
    if (!allowedExtension) {
      return { status: "invalid", reason: "transcript_invalid" };
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor);
    const pathAfter = lstatSync(path);
    const secureAntigravityPathAfter = host === "antigravity_cli"
      ? secureAntigravityTranscriptPath(antigravityRoot ?? getAntigravityBrainDir(), requested)
      : null;
    if (offset !== before.size || after.size !== before.size || after.dev !== before.dev || after.ino !== before.ino ||
      pathAfter.dev !== before.dev || pathAfter.ino !== before.ino ||
      (host === "antigravity_cli" && secureAntigravityPathAfter !== path)) {
      return { status: "invalid", reason: "transcript_unstable" };
    }
    return {
      status: "valid",
      path,
      raw: bytes.toString("utf8"),
      device: before.dev,
      inode: before.ino,
      size: before.size,
      mtime_ms: before.mtimeMs,
    };
  } catch {
    return { status: "invalid", reason: "transcript_unavailable" };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function rootForHost(input: SessionStartAutoReceiveInput): string {
  return input.roots?.[input.host] ?? (
    input.host === "codex"
      ? getCodexSessionsDir()
      : input.host === "claude_code"
        ? getClaudeProjectsDir()
        : input.host === "gemini_cli"
          ? getGeminiChatsDir()
          : getAntigravityBrainDir()
  );
}

function matchesCurrentSession(
  input: SessionStartAutoReceiveInput,
  transcript: string,
  raw: string,
  workspace: string,
  cwd: string,
  root: string,
): boolean {
  if (input.host === "codex") return matchesCodexSession(raw, input.session_id, workspace, cwd);
  if (input.host === "antigravity_cli") {
    const expected = join(root, input.session_id, ".system_generated", "logs", "transcript.jsonl");
    return transcript === expected;
  }
  const expectedProjectDir = join(root, basename(resolve(input.cwd)));
  if (!isWithin(expectedProjectDir, transcript)) return false;
  return matchesGeminiSession(raw, input.session_id, workspace, cwd);
}


export function matchesCodexSession(raw: string, sessionId: string, workspace: string, cwd: string): boolean {
  for (const record of jsonlRecords(raw)) {
    if (record.type !== "session_meta" || !isRecord(record.payload)) continue;
    if (stringValue(record.payload.id) !== sessionId) continue;
    const recordCwd = canonicalExistingPath(stringValue(record.payload.cwd));
    if (recordCwd && recordCwd === cwd && isWithin(workspace, recordCwd)) return true;
  }
  return false;
}

function matchesGeminiSession(
  raw: string,
  sessionId: string,
  workspace: string,
  cwd: string,
): boolean {
  for (const record of jsonRecords(raw)) {
    if (stringValue(record.sessionId) !== sessionId || !Array.isArray(record.directories)) continue;
    const directories = record.directories
      .map((value) => canonicalExistingPath(stringValue(value)))
      .filter((value): value is string => Boolean(value));
    if (directories.some((directory) => directory === cwd && isWithin(workspace, directory))) return true;
  }
  return false;
}

function jsonlRecords(raw: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isRecord(value)) records.push(value);
    } catch {
      // The host ingesters account for malformed records after identity binds.
    }
  }
  return records;
}

function jsonRecords(raw: string): Record<string, unknown>[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{")) {
    try {
      const value: unknown = JSON.parse(trimmed);
      if (isRecord(value)) return [value];
    } catch {
      // A JSONL transcript is handled below.
    }
  }
  return jsonlRecords(raw);
}

function canonicalExistingPath(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return realpathSync(resolve(value));
  } catch {
    return null;
  }
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function skipped(reason: SessionStartAutoReceiveResult["reason"]): SessionStartAutoReceiveResult {
  return { status: "skipped", reason, events_saved: 0, events_duplicate: 0 };
}
