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
  getAntigravityBrainDir,
  ingestAntigravityConversationEvents,
  readSelectedFullLines,
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
    | "ingest_failed";
  events_saved: number;
  events_duplicate: number;
}

export async function receiveCurrentSessionTranscript(
  store: Store,
  input: SessionStartAutoReceiveInput,
): Promise<SessionStartAutoReceiveResult> {
  try {
    if (!input.transcript_path) return skipped("transcript_unavailable");
    const transcript = readBoundedTranscriptSnapshot(input.host, input.transcript_path, input.max_bytes);
    if (transcript.status !== "valid") return skipped(transcript.reason);

    const workspace = realpathSync(resolve(input.workspace));
    const cwd = realpathSync(resolve(input.cwd));
    if (!isWithin(workspace, cwd)) return skipped("workspace_mismatch");

    const root = realpathSync(resolve(rootForHost(input)));
    if (!isWithin(root, transcript.path)) return skipped("transcript_invalid");

    const raw = transcript.raw;
    if (!matchesCurrentSession(input, transcript.path, raw, workspace, cwd, root)) {
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
      : input.host === "claude_code"
        ? await ingestClaudeConversationEvents(store, input.agent_id, common)
        : input.host === "gemini_cli"
          ? await ingestGeminiConversationEvents(store, input.agent_id, common)
          : await ingestAntigravityConversationEvents(store, input.agent_id, {
            project: input.project,
            root,
            files: [transcript.path],
            contents: new Map([[transcript.path, raw]]),
            full_lines: new Map([[
              transcript.path,
              readSelectedFullLines(transcript.path, truncatedAntigravityLineNumbers(raw)),
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

export interface BoundedTranscriptSnapshot {
  status: "valid";
  path: string;
  raw: string;
  device: number;
  inode: number;
  size: number;
  mtime_ms: number;
}

export function readBoundedTranscriptSnapshot(
  host: SessionStartTranscriptHost,
  transcriptPath: string,
  maxBytes: number = SESSION_START_TRANSCRIPT_MAX_BYTES,
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
    if (before.size > Math.max(1, maxBytes)) {
      return { status: "invalid", reason: "transcript_too_large" };
    }
    const path = realpathSync(requested);
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
    if (offset !== before.size || after.size !== before.size || after.dev !== before.dev || after.ino !== before.ino ||
      pathAfter.dev !== before.dev || pathAfter.ino !== before.ino) {
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
  if (input.host === "claude_code") {
    // Claude encodes the lexical hook cwd in the projects directory name;
    // record-level cwd comparison below uses the canonical path.
    const expectedProjectDir = join(root, encodeClaudeProjectPath(resolve(input.cwd)));
    if (!isWithin(expectedProjectDir, transcript)) return false;
    return matchesClaudeSession(raw, transcript, input.session_id, workspace, cwd);
  }
  if (input.host === "antigravity_cli") {
    const expected = join(root, input.session_id, ".system_generated", "logs", "transcript.jsonl");
    return transcript === expected;
  }
  const expectedProjectDir = join(root, basename(resolve(input.cwd)));
  if (!isWithin(expectedProjectDir, transcript)) return false;
  return matchesGeminiSession(raw, input.session_id, workspace, cwd);
}


function matchesCodexSession(raw: string, sessionId: string, workspace: string, cwd: string): boolean {
  for (const record of jsonlRecords(raw)) {
    if (record.type !== "session_meta" || !isRecord(record.payload)) continue;
    if (stringValue(record.payload.id) !== sessionId) continue;
    const recordCwd = canonicalExistingPath(stringValue(record.payload.cwd));
    if (recordCwd && recordCwd === cwd && isWithin(workspace, recordCwd)) return true;
  }
  return false;
}

function matchesClaudeSession(
  raw: string,
  transcript: string,
  sessionId: string,
  workspace: string,
  cwd: string,
): boolean {
  if (basename(transcript, ".jsonl") !== sessionId) return false;
  let sawMatchingIdentity = false;
  for (const record of jsonlRecords(raw)) {
    const recordSession = stringValue(record.sessionId) ?? stringValue(record.session_id);
    if (recordSession && recordSession !== sessionId) return false;
    const recordCwd = canonicalExistingPath(stringValue(record.cwd));
    if (recordCwd && (recordCwd !== cwd || !isWithin(workspace, recordCwd))) return false;
    if (recordSession === sessionId && recordCwd === cwd) sawMatchingIdentity = true;
  }
  return sawMatchingIdentity;
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

function encodeClaudeProjectPath(cwd: string): string {
  return cwd.replaceAll("/", "-");
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
