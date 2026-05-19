/**
 * AM-031 PR C: Codex raw conversation event ingest.
 *
 * Supports ~/.codex/sessions/YYYY/MM/DD/*.jsonl. The adapter excludes
 * base/system/developer instruction bodies and hidden reasoning traces.
 */
import { readFileSync, readdirSync, statSync, existsSync, type Dirent } from "fs";
import { basename, join } from "path";
import { homedir } from "os";
import type { Store } from "./stores/types.js";
import { normalizeHomePath, redactText } from "./redact.js";

export const CODEX_SESSIONS_MAX_DEPTH = 4;
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface CodexConversationIngestInput {
  project?: string;
  since?: string;
  root?: string;
  max_files?: number;
}

export interface CodexConversationIngestResult {
  source: "codex";
  files_scanned: number;
  lines_seen: number;
  events_saved: number;
  events_duplicate: number;
  events_skipped: number;
  since: string;
}

export function getCodexSessionsDir(): string {
  return process.env.CODEX_SESSIONS_DIR || join(homedir(), ".codex", "sessions");
}

export function findCodexJsonlFiles(
  since: Date,
  root: string = getCodexSessionsDir(),
  maxDepth: number = CODEX_SESSIONS_MAX_DEPTH
): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const sinceMs = since.getTime();

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          if (statSync(path).mtimeMs >= sinceMs) out.push(path);
        } catch {
          // Ignore files that disappear during a sweep.
        }
      }
    }
  };

  walk(root, 1);
  return out.sort();
}

export async function ingestCodexConversationEvents(
  store: Store,
  agentId: string,
  input: CodexConversationIngestInput = {}
): Promise<CodexConversationIngestResult> {
  const since = input.since ? new Date(input.since) : new Date(Date.now() - DEFAULT_LOOKBACK_MS);
  if (Number.isNaN(since.getTime())) {
    throw new Error(`Invalid since timestamp: ${input.since}`);
  }

  const files = findCodexJsonlFiles(since, input.root).slice(0, input.max_files ?? 200);
  const result: CodexConversationIngestResult = {
    source: "codex",
    files_scanned: files.length,
    lines_seen: 0,
    events_saved: 0,
    events_duplicate: 0,
    events_skipped: 0,
    since: since.toISOString(),
  };

  for (const file of files) {
    let raw = "";
    try {
      raw = readFileSync(file, "utf-8");
    } catch {
      result.events_skipped++;
      continue;
    }

    const sessionId = inferSessionId(file);
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      result.lines_seen++;

      let record: unknown;
      try {
        record = JSON.parse(line);
      } catch {
        result.events_skipped++;
        continue;
      }
      if (!record || typeof record !== "object") {
        result.events_skipped++;
        continue;
      }

      const event = extractCodexRawEvent(record as Record<string, unknown>, {
        file,
        lineNumber: i + 1,
        sessionId,
      });
      if (!event) {
        result.events_skipped++;
        continue;
      }
      if (new Date(event.occurred_at).getTime() < since.getTime()) {
        result.events_skipped++;
        continue;
      }

      const wasDuplicate = await hasExistingConversationEvent(store, agentId, event);
      await store.saveConversationEvent({
        agent_id: agentId,
        project: input.project,
        source: "codex",
        source_event_id: event.source_event_id,
        source_path: event.source_path,
        role: event.role,
        content: event.content,
        metadata: event.metadata,
        occurred_at: event.occurred_at,
      });
      if (wasDuplicate) {
        result.events_duplicate++;
      } else {
        result.events_saved++;
      }
    }
  }

  return result;
}

interface ExtractContext {
  file: string;
  lineNumber: number;
  sessionId: string;
}

interface ExtractedCodexRawEvent {
  source_event_id: string;
  source_path: string;
  role: "user" | "assistant" | "tool" | "system" | "event";
  content: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

export function extractCodexRawEvent(
  record: Record<string, unknown>,
  context: ExtractContext
): ExtractedCodexRawEvent | null {
  const occurredAt = getTimestamp(record);
  if (!occurredAt) return null;

  const payload = isRecord(record.payload) ? record.payload : {};
  const payloadType = getString(payload.type);
  if (isHiddenOrInstructionPayload(payload)) return null;

  const role = mapCodexRole(record, payload);
  const rawContent = extractCodexContent(record, payload);
  if (!rawContent) return null;

  const redacted = redactText(rawContent);
  const normalizedPath = normalizeHomePath(context.file);
  const sessionId = getSessionId(record, payload, context.sessionId);
  const stableId = getStablePayloadId(payload);
  const sourceEventId = stableId ? `${sessionId}:${stableId}` : `${sessionId}:${context.lineNumber}`;

  return {
    source_event_id: sourceEventId,
    source_path: normalizedPath,
    role,
    content: redacted.text,
    occurred_at: occurredAt,
    metadata: {
      session_id: sessionId,
      line_number: context.lineNumber,
      source_path: normalizedPath,
      event_type: getString(record.type) ?? "unknown",
      payload_type: payloadType,
      turn_id: getString(payload.turn_id),
      item_id: getString(payload.id),
      call_id: getString(payload.call_id),
      cwd: getString(payload.cwd) ? normalizeHomePath(getString(payload.cwd)!) : undefined,
      model_provider: getString(payload.model_provider),
      model: getString(payload.model),
      cli_version: getString(payload.cli_version),
      redaction_version: redacted.redaction_version,
      redaction_count: redacted.redaction_count,
      ingested_at: new Date().toISOString(),
    },
  };
}

async function hasExistingConversationEvent(
  store: Store,
  agentId: string,
  event: ExtractedCodexRawEvent
): Promise<boolean> {
  const existing = await store.getConversationEvents({
    agent_id: agentId,
    source: "codex",
    since: event.occurred_at,
    limit: 1000,
  });
  return existing.some((item) => item.source_event_id === event.source_event_id);
}

function inferSessionId(file: string): string {
  return basename(file).replace(/\.jsonl$/, "");
}

function getTimestamp(record: Record<string, unknown>): string | null {
  const ts = getString(record.timestamp);
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function getSessionId(record: Record<string, unknown>, payload: Record<string, unknown>, fallback: string): string {
  if (getString(record.type) === "session_meta" && getString(payload.id)) {
    return getString(payload.id)!;
  }
  return getString(payload.session_id) ?? fallback;
}

function getStablePayloadId(payload: Record<string, unknown>): string | undefined {
  return getString(payload.id) ?? getString(payload.call_id) ?? getString(payload.turn_id);
}

function isHiddenOrInstructionPayload(payload: Record<string, unknown>): boolean {
  const type = getString(payload.type);
  const role = getString(payload.role);
  if (role === "developer" || role === "system") return true;
  if (type && /reasoning|thought|chain_of_thought/i.test(type)) return true;
  const content = payload.content;
  return Array.isArray(content) && content.some((item) => isReasoningBlock(item));
}

function mapCodexRole(
  record: Record<string, unknown>,
  payload: Record<string, unknown>
): ExtractedCodexRawEvent["role"] {
  if (getString(record.type) === "session_meta") return "system";
  const role = getString(payload.role);
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  const payloadType = getString(payload.type);
  if (payloadType === "function_call" || payloadType === "function_call_output") return "tool";
  if (payloadType === "agent_message") return "assistant";
  if (payloadType === "task_started" || payloadType === "token_count") return "event";
  return "event";
}

function extractCodexContent(record: Record<string, unknown>, payload: Record<string, unknown>): string {
  if (getString(record.type) === "session_meta") {
    const parts = [
      "Codex session started",
      getString(payload.source) ? `source=${payload.source}` : "",
      getString(payload.model_provider) ? `provider=${payload.model_provider}` : "",
      getString(payload.model) ? `model=${payload.model}` : "",
      getString(payload.cwd) ? `cwd=${normalizeHomePath(getString(payload.cwd)!)}` : "",
    ].filter(Boolean);
    return parts.join(" ");
  }

  const payloadType = getString(payload.type);
  if (payloadType === "agent_message" && typeof payload.message === "string") {
    return payload.message;
  }
  if (Array.isArray(payload.content)) {
    return codexContentBlocksToText(payload.content);
  }
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.message === "string") return payload.message;
  if (payloadType === "function_call") {
    return `[function_call:${getString(payload.name) ?? "unknown"}] ${safeCompactJson(payload.arguments ?? {})}`;
  }
  if (payloadType === "function_call_output") {
    return `[function_call_output] ${safeCompactJson(payload.output ?? {})}`;
  }
  return `[${payloadType ?? getString(record.type) ?? "unknown"}] ${safeCompactJson(stripForbiddenFields(payload))}`;
}

function codexContentBlocksToText(content: unknown[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      parts.push(String(block));
      continue;
    }
    if (isReasoningBlock(block)) continue;
    const item = block as Record<string, unknown>;
    const type = getString(item.type) ?? "unknown";
    if ((type === "input_text" || type === "output_text") && typeof item.text === "string") {
      parts.push(item.text);
    } else {
      parts.push(`[${type}] ${safeCompactJson(stripForbiddenFields(item))}`);
    }
  }
  return parts.join("\n").trim();
}

function stripForbiddenFields(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripForbiddenFields);
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (key === "base_instructions" || key === "base_instructions_text") continue;
    if (/reasoning|thought|chain_of_thought/i.test(key)) continue;
    out[key] = stripForbiddenFields(val);
  }
  return out;
}

function safeCompactJson(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 4000);
  } catch {
    return String(value);
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isReasoningBlock(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const type = getString(value.type) ?? "";
  return /reasoning|thought|chain_of_thought/i.test(type);
}
