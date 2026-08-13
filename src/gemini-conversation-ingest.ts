/**
 * Privacy-first Gemini CLI visible-event adapter.
 *
 * The parser is deliberately default-deny. It recognizes the complete field
 * surface frozen by OBS-05 A1, persists only visible user/Gemini text and
 * redacted tool identity, and rejects records containing any unknown field.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from "fs";
import { basename, join, relative, sep } from "path";
import { homedir } from "os";
import type { Store } from "./stores/types.js";
import { normalizeHomePath, redactText } from "./redact.js";
import { inspectRawCaptureCoverage, type RawCaptureCoverageReport } from "./raw-capture-coverage.js";

export const GEMINI_CHATS_MAX_DEPTH = 6;
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export const GEMINI_OBSERVED_TOP_FIELDS = [
  "directories", "kind", "lastUpdated", "messages", "projectHash", "sessionId", "startTime", "summary",
] as const;
export const GEMINI_OBSERVED_MESSAGE_FIELDS = [
  "content", "displayContent", "id", "model", "thoughts", "timestamp", "tokens", "toolCalls", "type",
] as const;
export const GEMINI_OBSERVED_JSONL_FIELDS = [
  "$set", "content", "id", "kind", "lastUpdated", "model", "projectHash", "sessionId", "startTime",
  "thoughts", "timestamp", "tokens", "toolCalls", "type",
] as const;
export const GEMINI_OBSERVED_SET_PATCH_FIELDS = ["lastUpdated", "messages"] as const;
export const GEMINI_OBSERVED_TOOL_CALL_FIELDS = [
  "args", "description", "displayName", "id", "name", "renderOutputAsMarkdown", "result", "resultDisplay",
  "status", "timestamp",
] as const;

const TOP_FIELDS = new Set<string>(GEMINI_OBSERVED_TOP_FIELDS);
const MESSAGE_FIELDS = new Set<string>(GEMINI_OBSERVED_MESSAGE_FIELDS);
const JSONL_FIELDS = new Set<string>(GEMINI_OBSERVED_JSONL_FIELDS);
const TOOL_CALL_FIELDS = new Set<string>(GEMINI_OBSERVED_TOOL_CALL_FIELDS);
const DENIED_TOP_FIELDS = new Set(["directories", "kind", "projectHash", "summary"]);
const DENIED_MESSAGE_FIELDS = new Set(["model", "thoughts", "tokens"]);
const DENIED_TOOL_FIELDS = new Set([
  "args", "description", "id", "renderOutputAsMarkdown", "result", "resultDisplay", "timestamp",
]);

export type GeminiPathShape =
  | "session_snapshot_json"
  | "session_append_patch_jsonl"
  | "nested_session_fragment_json";

export interface GeminiConversationIngestInput {
  project?: string;
  since?: string;
  root?: string;
  max_files?: number;
  /** Exact, pre-validated transcript paths for bounded SessionStart ingest. */
  files?: string[];
  /** Exact bytes from a securely opened transcript; avoids path re-open TOCTOU. */
  contents?: ReadonlyMap<string, string>;
}

export interface GeminiPrivacyCounters {
  denied_field_count: number;
  thought_bearing_records_denied: number;
  protected_instruction_records_denied: number;
  unknown_field_records_denied: number;
  malformed_records_denied: number;
}

export interface GeminiConversationIngestResult {
  source: "gemini_cli";
  files_scanned: number;
  records_seen: number;
  events_saved: number;
  events_duplicate: number;
  events_skipped: number;
  since: string;
  path_shapes: Record<GeminiPathShape, number>;
  privacy: GeminiPrivacyCounters;
  coverage: RawCaptureCoverageReport;
}

interface GeminiSessionContext {
  file: string;
  pathShape: GeminiPathShape;
  sessionId: string;
  startTime?: string;
  lastUpdated?: string;
  ordinal: number;
}

interface GeminiVisibleEvent {
  session_id: string;
  source_event_id: string;
  source_path: string;
  role: "user" | "assistant";
  event_type: "user_message" | "assistant_message";
  content: string;
  occurred_at: string;
  metadata: Record<string, unknown>;
}

export function getGeminiChatsDir(): string {
  return process.env.GEMINI_CHATS_DIR || join(homedir(), ".gemini", "tmp");
}

export function findGeminiConversationFiles(
  since: Date,
  root: string = getGeminiChatsDir(),
  maxDepth: number = GEMINI_CHATS_MAX_DEPTH,
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
      } else if (entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".jsonl"))) {
        try {
          if (statSync(path).mtimeMs >= sinceMs) out.push(path);
        } catch {
          // Files can disappear during a bounded sweep.
        }
      }
    }
  };
  walk(root, 1);
  return out.sort();
}

export function classifyGeminiPathShape(file: string, root: string): GeminiPathShape {
  if (file.endsWith(".jsonl")) return "session_append_patch_jsonl";
  const depth = relative(root, file).split(sep).filter(Boolean).length;
  return depth >= 5 ? "nested_session_fragment_json" : "session_snapshot_json";
}

export async function ingestGeminiConversationEvents(
  store: Store,
  agentId: string,
  input: GeminiConversationIngestInput = {},
): Promise<GeminiConversationIngestResult> {
  const since = input.since ? new Date(input.since) : new Date(Date.now() - DEFAULT_LOOKBACK_MS);
  if (Number.isNaN(since.getTime())) throw new Error(`Invalid since timestamp: ${input.since}`);
  const root = input.root ?? getGeminiChatsDir();
  const maxFiles = input.max_files ?? 200;
  const files = (input.files ?? findGeminiConversationFiles(since, root)).slice(0, maxFiles);
  const result: GeminiConversationIngestResult = {
    source: "gemini_cli",
    files_scanned: files.length,
    records_seen: 0,
    events_saved: 0,
    events_duplicate: 0,
    events_skipped: 0,
    since: since.toISOString(),
    path_shapes: {
      session_snapshot_json: 0,
      session_append_patch_jsonl: 0,
      nested_session_fragment_json: 0,
    },
    privacy: emptyPrivacyCounters(),
    coverage: inspectRawCaptureCoverage({
      source: "gemini_cli",
      project: input.project,
      root,
      since: since.toISOString(),
      max_files: maxFiles,
      max_depth: GEMINI_CHATS_MAX_DEPTH,
      files: input.files,
    }),
  };

  for (const file of files) {
    const pathShape = classifyGeminiPathShape(file, root);
    result.path_shapes[pathShape]++;
    let raw: string;
    try {
      raw = input.contents?.get(file) ?? readFileSync(file, "utf8");
    } catch {
      result.events_skipped++;
      result.privacy.malformed_records_denied++;
      continue;
    }
    const events = file.endsWith(".jsonl")
      ? parseGeminiJsonl(raw, file, pathShape, result)
      : parseGeminiSnapshot(raw, file, pathShape, result);
    for (const event of events) {
      if (Date.parse(event.occurred_at) < since.getTime()) {
        result.events_skipped++;
        continue;
      }
      const duplicate = await hasExistingGeminiRawEvent(store, agentId, event);
      await store.saveRawEvent({
        agent_id: agentId,
        session_id: event.session_id,
        project: input.project,
        host: "gemini_cli",
        source: "gemini_cli",
        event_type: event.event_type,
        role: event.role,
        content: event.content,
        source_ref: {
          source: "gemini_cli",
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
      // Preserve the same compatibility projection used by the Codex and
      // Claude adapters so restart packs and recover_context can consume it.
      await store.saveConversationEvent({
        agent_id: agentId,
        project: input.project,
        source: "gemini_cli",
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

function parseGeminiSnapshot(
  raw: string,
  file: string,
  pathShape: GeminiPathShape,
  result: GeminiConversationIngestResult,
): GeminiVisibleEvent[] {
  result.records_seen++;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    result.events_skipped++;
    result.privacy.malformed_records_denied++;
    return [];
  }
  if (!isRecord(value) || hasUnknownKeys(value, TOP_FIELDS)) {
    result.events_skipped++;
    result.privacy.unknown_field_records_denied++;
    return [];
  }
  countDeniedPresent(value, DENIED_TOP_FIELDS, result.privacy);
  const sessionId = stringValue(value.sessionId) ?? inferSessionId(file);
  const messages = Array.isArray(value.messages) ? value.messages : [];
  const events: GeminiVisibleEvent[] = [];
  for (let index = 0; index < messages.length; index++) {
    result.records_seen++;
    const event = visibleEventFromMessage(messages[index], {
      file,
      pathShape,
      sessionId,
      startTime: validTimestamp(value.startTime),
      lastUpdated: validTimestamp(value.lastUpdated),
      ordinal: index,
    }, result);
    if (event) events.push(event);
  }
  return uniqueEvents(events);
}

function parseGeminiJsonl(
  raw: string,
  file: string,
  pathShape: GeminiPathShape,
  result: GeminiConversationIngestResult,
): GeminiVisibleEvent[] {
  let sessionId = inferSessionId(file);
  let startTime: string | undefined;
  let lastUpdated: string | undefined;
  let ordinal = 0;
  const events: GeminiVisibleEvent[] = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    result.records_seen++;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      result.events_skipped++;
      result.privacy.malformed_records_denied++;
      continue;
    }
    if (!isRecord(value) || hasUnknownKeys(value, JSONL_FIELDS)) {
      result.events_skipped++;
      result.privacy.unknown_field_records_denied++;
      continue;
    }
    sessionId = stringValue(value.sessionId) ?? sessionId;
    startTime = validTimestamp(value.startTime) ?? startTime;
    lastUpdated = validTimestamp(value.lastUpdated) ?? lastUpdated;
    countDeniedPresent(value, new Set(["kind", "model", "projectHash", "thoughts", "tokens"]), result.privacy);

    if (hasOwn(value, "$set")) {
      if (hasOwn(value, "thoughts")) result.privacy.thought_bearing_records_denied++;
      if (!isRecord(value.$set)) {
        result.events_skipped++;
        result.privacy.malformed_records_denied++;
        continue;
      }
      const patch = value.$set;
      const patchKeys = Object.keys(patch);
      if (patchKeys.some((key) => key !== "lastUpdated" && key !== "messages" && !/^messages\.\d+$/.test(key))) {
        result.events_skipped++;
        result.privacy.unknown_field_records_denied++;
        continue;
      }
      lastUpdated = validTimestamp(patch.lastUpdated) ?? lastUpdated;
      const patchMessages: unknown[] = [];
      if (Array.isArray(patch.messages)) patchMessages.push(...patch.messages);
      else if (isRecord(patch.messages)) {
        for (const key of Object.keys(patch.messages).sort(numericKeyOrder)) patchMessages.push(patch.messages[key]);
      } else if (hasOwn(patch, "messages")) {
        result.events_skipped++;
        result.privacy.malformed_records_denied++;
      }
      for (const key of patchKeys.filter((item) => /^messages\.\d+$/.test(item)).sort(dottedMessageOrder)) {
        patchMessages.push(patch[key]);
      }
      for (const message of patchMessages) {
        const event = visibleEventFromMessage(message, {
          file, pathShape, sessionId, startTime, lastUpdated, ordinal: ordinal++,
        }, result);
        if (event) events.push(event);
      }
      continue;
    }

    if (hasOwn(value, "type") || hasOwn(value, "content") || hasOwn(value, "displayContent")) {
      const message: Record<string, unknown> = {};
      for (const key of GEMINI_OBSERVED_MESSAGE_FIELDS) {
        if (hasOwn(value, key)) message[key] = value[key];
      }
      const event = visibleEventFromMessage(message, {
        file, pathShape, sessionId, startTime, lastUpdated, ordinal: ordinal++,
      }, result);
      if (event) events.push(event);
    }
  }
  return uniqueEvents(events);
}

function visibleEventFromMessage(
  value: unknown,
  context: GeminiSessionContext,
  result: GeminiConversationIngestResult,
): GeminiVisibleEvent | null {
  if (!isRecord(value)) {
    result.events_skipped++;
    result.privacy.malformed_records_denied++;
    return null;
  }
  if (hasUnknownKeys(value, MESSAGE_FIELDS)) {
    result.events_skipped++;
    result.privacy.unknown_field_records_denied++;
    return null;
  }
  countDeniedPresent(value, DENIED_MESSAGE_FIELDS, result.privacy);
  if (hasOwn(value, "thoughts")) result.privacy.thought_bearing_records_denied++;
  const type = stringValue(value.type)?.toLowerCase();
  if (type !== "user" && type !== "gemini") {
    result.events_skipped++;
    result.privacy.protected_instruction_records_denied++;
    return null;
  }
  const toolCalls = deriveToolCalls(value.toolCalls, result);
  if (toolCalls === null) return null;
  const contentValues = [stringValue(value.content), stringValue(value.displayContent)]
    .filter((item): item is string => Boolean(item));
  const uniqueContent = Array.from(new Set(contentValues));
  if (uniqueContent.length === 0 && toolCalls.length > 0) {
    uniqueContent.push(toolCalls.map((tool) => `[tool:${tool.name ?? tool.displayName ?? "unknown"} status=${tool.status ?? "unknown"}]`).join("\n"));
  }
  if (uniqueContent.length === 0) {
    result.events_skipped++;
    return null;
  }
  const redacted = redactText(uniqueContent.join("\n"));
  const occurredAt = validTimestamp(value.timestamp) ?? context.lastUpdated ?? context.startTime;
  if (!occurredAt) {
    result.events_skipped++;
    result.privacy.malformed_records_denied++;
    return null;
  }
  const normalizedPath = normalizeHomePath(context.file);
  const stableMessageId = stringValue(value.id) ?? sha256([
    context.sessionId, type, occurredAt, redacted.text,
  ].join("\n"));
  return {
    session_id: context.sessionId,
    source_event_id: `${context.sessionId}:${stableMessageId}`,
    source_path: normalizedPath,
    role: type === "user" ? "user" : "assistant",
    event_type: type === "user" ? "user_message" : "assistant_message",
    content: redacted.text,
    occurred_at: occurredAt,
    metadata: {
      source_format: context.pathShape === "session_append_patch_jsonl" ? "jsonl" : "json",
      path_shape: context.pathShape,
      message_ordinal: context.ordinal,
      redaction_version: redacted.redaction_version,
      redaction_count: redacted.redaction_count,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    },
  };
}

function deriveToolCalls(value: unknown, result: GeminiConversationIngestResult): Array<Record<string, string>> | null {
  if (value === undefined) return [];
  result.privacy.denied_field_count++;
  if (!Array.isArray(value)) {
    result.events_skipped++;
    result.privacy.malformed_records_denied++;
    return null;
  }
  const derived: Array<Record<string, string>> = [];
  for (const rawTool of value) {
    if (!isRecord(rawTool)) {
      result.events_skipped++;
      result.privacy.malformed_records_denied++;
      return null;
    }
    if (hasUnknownKeys(rawTool, TOOL_CALL_FIELDS)) {
      result.events_skipped++;
      result.privacy.unknown_field_records_denied++;
      return null;
    }
    countDeniedPresent(rawTool, DENIED_TOOL_FIELDS, result.privacy);
    const item: Record<string, string> = {};
    for (const key of ["name", "displayName", "status"] as const) {
      const field = stringValue(rawTool[key]);
      if (field) item[key] = redactText(field).text;
    }
    if (Object.keys(item).length > 0) derived.push(item);
  }
  return derived;
}

async function hasExistingGeminiRawEvent(
  store: Store,
  agentId: string,
  event: GeminiVisibleEvent,
): Promise<boolean> {
  const existing = await store.getRawEvents({
    agent_id: agentId,
    source: "gemini_cli",
    since: event.occurred_at,
    limit: 1000,
  });
  return existing.some((item) => item.source_event_id === event.source_event_id);
}

function uniqueEvents(events: GeminiVisibleEvent[]): GeminiVisibleEvent[] {
  const byId = new Map<string, GeminiVisibleEvent>();
  for (const event of events) if (!byId.has(event.source_event_id)) byId.set(event.source_event_id, event);
  return Array.from(byId.values());
}

function inferSessionId(file: string): string {
  return basename(file).replace(/\.jsonl?$/, "");
}

function validTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function emptyPrivacyCounters(): GeminiPrivacyCounters {
  return {
    denied_field_count: 0,
    thought_bearing_records_denied: 0,
    protected_instruction_records_denied: 0,
    unknown_field_records_denied: 0,
    malformed_records_denied: 0,
  };
}

function countDeniedPresent(
  value: Record<string, unknown>,
  denied: ReadonlySet<string>,
  counters: GeminiPrivacyCounters,
): void {
  for (const key of denied) if (hasOwn(value, key)) counters.denied_field_count++;
}

function hasUnknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).some((key) => !allowed.has(key));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function numericKeyOrder(left: string, right: string): number {
  return Number(left) - Number(right);
}

function dottedMessageOrder(left: string, right: string): number {
  return Number(left.slice(left.lastIndexOf(".") + 1)) - Number(right.slice(right.lastIndexOf(".") + 1));
}
