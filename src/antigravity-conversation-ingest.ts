/** Privacy-first Antigravity CLI visible transcript ingester. */
import { createHash } from "node:crypto";
import {
  closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, openSync, readSync,
  readdirSync, realpathSync, type Dirent,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Store } from "./stores/types.js";
import { normalizeHomePath, redactText } from "./redact.js";

export const ANTIGRAVITY_TRANSCRIPT_FIELDS = [
  "content", "is_truncated", "source", "status", "step_index", "tool_calls", "type",
] as const;
export const ANTIGRAVITY_TRANSCRIPT_MAX_BYTES = 8 * 1024 * 1024;
const TRANSCRIPT_FIELDS = new Set<string>(ANTIGRAVITY_TRANSCRIPT_FIELDS);

export interface AntigravityConversationIngestInput {
  project?: string;
  root?: string;
  files?: string[];
  contents?: ReadonlyMap<string, string>;
  /** Compact-file line number (zero based) to a securely read full-transcript line. */
  full_lines?: ReadonlyMap<string, ReadonlyMap<number, string>>;
  fallback_occurred_at?: string;
  since?: Date;
}

export interface AntigravityConversationIngestResult {
  source: "antigravity_cli";
  files_scanned: number;
  records_seen: number;
  events_saved: number;
  events_duplicate: number;
  events_skipped: number;
  full_line_fallback_count: number;
  privacy: {
    unknown_field_records_denied: number;
    malformed_records_denied: number;
    protected_records_denied: number;
    tool_payloads_denied: number;
  };
}

interface VisibleEvent {
  session_id: string;
  source_event_id: string;
  source_path: string;
  role: "user" | "assistant";
  event_type: "user_message" | "assistant_message";
  content: string;
  occurred_at: string;
  metadata: Record<string, unknown>;
}

export function getAntigravityBrainDir(): string {
  return process.env.ANTIGRAVITY_BRAIN_DIR || join(homedir(), ".gemini", "antigravity-cli", "brain");
}

export function findAntigravityConversationFiles(
  since: Date,
  root: string = getAntigravityBrainDir(),
  maxFiles: number = 200,
): string[] {
  if (!existsSync(root)) return [];
  const result: string[] = [];
  let conversations: Dirent[];
  try { conversations = readdirSync(root, { withFileTypes: true }) as Dirent[]; } catch { return []; }
  for (const entry of conversations) {
    if (!entry.isDirectory()) continue;
    const transcript = join(root, entry.name, ".system_generated", "logs", "transcript.jsonl");
    try {
      const info = lstatSync(transcript);
      if (!info.isFile() || info.isSymbolicLink() || info.mtimeMs < since.getTime()) continue;
      const resolved = realpathSync(transcript);
      const expectedSessionRoot = realpathSync(join(root, entry.name));
      if (!resolved.startsWith(`${expectedSessionRoot}/`)) continue;
      result.push(resolved);
    } catch { /* A transcript can disappear during a bounded inventory. */ }
  }
  return result.sort().slice(0, maxFiles);
}

export function truncatedAntigravityLineNumbers(raw: string): number[] {
  const result: number[] = [];
  for (const [lineNumber, line] of raw.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isRecord(value) && value.is_truncated === true) result.push(lineNumber);
    } catch {
      // The parser accounts for malformed compact records.
    }
  }
  return result;
}

export async function ingestAntigravityConversationEvents(
  store: Store,
  agentId: string,
  input: AntigravityConversationIngestInput,
): Promise<AntigravityConversationIngestResult> {
  const files = input.files ?? findAntigravityConversationFiles(input.since ?? new Date(0), input.root);
  const result: AntigravityConversationIngestResult = {
    source: "antigravity_cli",
    files_scanned: files.length,
    records_seen: 0,
    events_saved: 0,
    events_duplicate: 0,
    events_skipped: 0,
    full_line_fallback_count: 0,
    privacy: {
      unknown_field_records_denied: 0,
      malformed_records_denied: 0,
      protected_records_denied: 0,
      tool_payloads_denied: 0,
    },
  };
  for (const file of files) {
    let raw = input.contents?.get(file);
    let fileOccurredAt = validTimestamp(input.fallback_occurred_at);
    if (raw === undefined) {
      const snapshot = readSecureCompactTranscript(file);
      raw = snapshot?.raw;
      fileOccurredAt ??= snapshot ? new Date(snapshot.mtimeMs).toISOString() : undefined;
    }
    if (raw === undefined) {
      result.events_skipped++;
      result.privacy.malformed_records_denied++;
      continue;
    }
    const sessionId = inferSessionId(file);
    const fullLines = input.full_lines?.get(file) ?? readSelectedFullLines(file, truncatedAntigravityLineNumbers(raw));
    for (const [lineNumber, compactLine] of raw.split("\n").entries()) {
      if (!compactLine.trim()) continue;
      result.records_seen++;
      let line = compactLine;
      let usedFullLine = false;
      const compact = parseRecord(compactLine);
      if (compact?.is_truncated === true) {
        const replacement = fullLines?.get(lineNumber);
        if (replacement === undefined) {
          result.events_skipped++;
          result.privacy.malformed_records_denied++;
          continue;
        }
        line = replacement;
        usedFullLine = true;
        result.full_line_fallback_count++;
      }
      const event = visibleEvent(line, lineNumber, sessionId, file, fileOccurredAt ?? new Date(0).toISOString(), usedFullLine, result);
      if (!event) continue;
      const duplicate = await hasExistingRawEvent(store, agentId, event.source_event_id, event.occurred_at);
      await store.saveRawEvent({
        agent_id: agentId,
        session_id: event.session_id,
        project: input.project,
        host: "antigravity_cli",
        source: "antigravity_cli",
        event_type: event.event_type,
        role: event.role,
        content: event.content,
        source_ref: {
          source: "antigravity_cli",
          source_event_id: event.source_event_id,
          source_path: event.source_path,
        },
        source_event_id: event.source_event_id,
        source_path: event.source_path,
        redaction_level: "complete",
        private_reasoning: false,
        metadata: event.metadata,
        occurred_at: event.occurred_at,
      });
      await store.saveConversationEvent({
        agent_id: agentId,
        project: input.project,
        source: "antigravity_cli",
        source_event_id: event.source_event_id,
        source_path: event.source_path,
        role: event.role,
        content: event.content,
        metadata: event.metadata,
        occurred_at: event.occurred_at,
      });
      if (duplicate) result.events_duplicate++;
      else result.events_saved++;
    }
  }
  return result;
}

function readSecureCompactTranscript(path: string): { raw: string; mtimeMs: number } | null {
  let descriptor: number | undefined;
  try {
    const supplied = lstatSync(path);
    if (!supplied.isFile() || supplied.isSymbolicLink() || supplied.size < 1 || supplied.size > ANTIGRAVITY_TRANSCRIPT_MAX_BYTES) return null;
    descriptor = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.dev !== supplied.dev || before.ino !== supplied.ino || before.size !== supplied.size) return null;
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (offset !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) return null;
    return { raw: bytes.toString("utf8"), mtimeMs: before.mtimeMs };
  } catch { return null; }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

/** Securely reads only selected physical lines from the full sibling transcript. */
export function readSelectedFullLines(compactPath: string, selectedLineNumbers: number[]): ReadonlyMap<number, string> {
  const selected = new Set(selectedLineNumbers);
  const found = new Map<number, string>();
  if (selected.size === 0) return found;
  const fullPath = join(compactPath, "..", "transcript_full.jsonl");
  let descriptor: number | undefined;
  try {
    const canonicalCompact = realpathSync(compactPath);
    if (canonicalCompact !== compactPath) return found;
    const supplied = lstatSync(fullPath);
    if (!supplied.isFile() || supplied.isSymbolicLink()) return found;
    const canonicalFull = realpathSync(fullPath);
    if (canonicalFull !== fullPath || join(canonicalFull, "..") !== join(canonicalCompact, "..")) return found;
    descriptor = openSync(fullPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.dev !== supplied.dev || before.ino !== supplied.ino) return found;
    const chunk = Buffer.alloc(64 * 1024);
    let position = 0; let lineNumber = 0; let pending = ""; let scannedBytes = 0;
    const maxSelected = Math.max(...selected);
    while (lineNumber <= maxSelected) {
      const count = readSync(descriptor, chunk, 0, chunk.length, position);
      if (count === 0) break;
      position += count; scannedBytes += count;
      if (scannedBytes > 64 * 1024 * 1024) return new Map();
      pending += chunk.subarray(0, count).toString("utf8");
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        if (selected.has(lineNumber)) {
          if (Buffer.byteLength(line) > 8 * 1024 * 1024) return new Map();
          found.set(lineNumber, line);
        }
        pending = pending.slice(newline + 1); lineNumber++;
        if (lineNumber > maxSelected) break;
        newline = pending.indexOf("\n");
      }
    }
    if (lineNumber <= maxSelected && pending && selected.has(lineNumber)) found.set(lineNumber, pending);
    const after = fstatSync(descriptor);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) return new Map();
    return found;
  } catch { return new Map(); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function visibleEvent(
  raw: string,
  lineNumber: number,
  sessionId: string,
  file: string,
  fallbackOccurredAt: string,
  usedFullLine: boolean,
  result: AntigravityConversationIngestResult,
): VisibleEvent | null {
  const value = parseRecord(raw);
  if (!value) {
    result.events_skipped++;
    result.privacy.malformed_records_denied++;
    return null;
  }
  if (Object.keys(value).some((key) => !TRANSCRIPT_FIELDS.has(key))) {
    result.privacy.unknown_field_records_denied++;
  }
  if (value.tool_calls !== undefined) result.privacy.tool_payloads_denied++;
  const type = stringValue(value.type);
  const source = stringValue(value.source);
  const role = type === "USER_INPUT" && source === "USER_EXPLICIT"
    ? "user" as const
    : type === "PLANNER_RESPONSE" && source === "MODEL"
      ? "assistant" as const
      : null;
  if (!role) {
    result.events_skipped++;
    result.privacy.protected_records_denied++;
    return null;
  }
  if (typeof value.content !== "string" || value.content.length === 0) {
    result.events_skipped++;
    result.privacy.malformed_records_denied++;
    return null;
  }
  const stepIndex = Number.isInteger(value.step_index) && Number(value.step_index) >= 0
    ? Number(value.step_index)
    : lineNumber;
  const redacted = redactText(value.content);
  const sourceEventId = `${sessionId}:${stepIndex}:${sha256(`${type}\n${redacted.text}`)}`;
  return {
    session_id: sessionId,
    source_event_id: sourceEventId,
    source_path: normalizeHomePath(file),
    role,
    event_type: role === "user" ? "user_message" : "assistant_message",
    content: redacted.text,
    occurred_at: fallbackOccurredAt,
    metadata: {
      source_format: "antigravity_transcript_jsonl",
      step_index: stepIndex,
      status: stringValue(value.status) ?? null,
      full_line_fallback: usedFullLine,
      redaction_version: redacted.redaction_version,
      redaction_count: redacted.redaction_count,
    },
  };
}

function inferSessionId(file: string): string {
  const match = file.replaceAll("\\", "/").match(/\/brain\/([^/]+)\/\.system_generated\/logs\/transcript\.jsonl$/);
  return match?.[1] ?? `unknown:${sha256(file).slice(0, 16)}`;
}

async function hasExistingRawEvent(store: Store, agentId: string, sourceEventId: string, occurredAt: string): Promise<boolean> {
  const existing = await store.getRawEvents({
    agent_id: agentId,
    source: "antigravity_cli",
    since: "1970-01-01T00:00:00.000Z",
    limit: 1_000,
  });
  return existing.some((event) => event.source_event_id === sourceEventId);
}

function parseRecord(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function validTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
