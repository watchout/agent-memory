/**
 * AM-031 PR B: Claude Code redacted full-text conversation event ingest.
 *
 * This deliberately stores only redacted visible conversation/tool context.
 * Structured extraction into decisions/task_states/knowledge remains a later
 * phase.
 */
import { readFileSync, readdirSync, statSync, existsSync, type Dirent } from "fs";
import { basename, join } from "path";
import { homedir } from "os";
import type { Store } from "./stores/types.js";
import { normalizeHomePath, redactText } from "./redact.js";
import { inspectRawCaptureCoverage, type RawCaptureCoverageReport } from "./raw-capture-coverage.js";

export const CLAUDE_PROJECTS_MAX_DEPTH = 3;
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface ClaudeConversationIngestInput {
  project?: string;
  since?: string;
  root?: string;
  max_files?: number;
}

export interface ClaudeConversationIngestResult {
  source: "claude_code";
  files_scanned: number;
  lines_seen: number;
  events_saved: number;
  events_duplicate: number;
  events_skipped: number;
  since: string;
  coverage: RawCaptureCoverageReport;
}

export function getClaudeProjectsDir(): string {
  return process.env.CLAUDE_PROJECTS_DIR || join(homedir(), ".claude", "projects");
}

export function findClaudeJsonlFiles(
  since: Date,
  root: string = getClaudeProjectsDir(),
  maxDepth: number = CLAUDE_PROJECTS_MAX_DEPTH
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
          // Ignore races with files removed during a sweep.
        }
      }
    }
  };

  walk(root, 1);
  return out.sort();
}

export async function ingestClaudeConversationEvents(
  store: Store,
  agentId: string,
  input: ClaudeConversationIngestInput = {}
): Promise<ClaudeConversationIngestResult> {
  const since = input.since ? new Date(input.since) : new Date(Date.now() - DEFAULT_LOOKBACK_MS);
  if (Number.isNaN(since.getTime())) {
    throw new Error(`Invalid since timestamp: ${input.since}`);
  }

  const root = input.root ?? getClaudeProjectsDir();
  const maxFiles = input.max_files ?? 200;
  const files = findClaudeJsonlFiles(since, root).slice(0, maxFiles);
  const coverage = inspectRawCaptureCoverage({
    source: "claude_code",
    project: input.project,
    root,
    since: since.toISOString(),
    max_files: maxFiles,
    max_depth: CLAUDE_PROJECTS_MAX_DEPTH,
  });
  const result: ClaudeConversationIngestResult = {
    source: "claude_code",
    files_scanned: files.length,
    lines_seen: 0,
    events_saved: 0,
    events_duplicate: 0,
    events_skipped: 0,
    since: since.toISOString(),
    coverage,
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

      const event = extractClaudeRawEvent(record as Record<string, unknown>, {
        file,
        lineNumber: i + 1,
        sessionId,
        project: input.project,
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
        source: "claude_code",
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

async function hasExistingConversationEvent(
  store: Store,
  agentId: string,
  event: ExtractedClaudeRawEvent
): Promise<boolean> {
  const existing = await store.getConversationEvents({
    agent_id: agentId,
    source: "claude_code",
    since: event.occurred_at,
    limit: 1000,
  });
  return existing.some((item) => item.source_event_id === event.source_event_id);
}

interface ExtractContext {
  file: string;
  lineNumber: number;
  sessionId: string;
  project?: string;
}

interface ExtractedClaudeRawEvent {
  source_event_id: string;
  source_path: string;
  role: "user" | "assistant" | "tool" | "system" | "event";
  content: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

export function extractClaudeRawEvent(
  record: Record<string, unknown>,
  context: ExtractContext
): ExtractedClaudeRawEvent | null {
  const occurredAt = getTimestamp(record);
  if (!occurredAt) return null;

  const role = mapClaudeRole(record);
  const rawContent = extractClaudeContent(record);
  if (!rawContent) return null;

  const redacted = redactText(rawContent);
  const normalizedPath = normalizeHomePath(context.file);
  const sessionId = getString(record.sessionId) ?? getString(record.session_id) ?? context.sessionId;
  const uuid = getString(record.uuid);
  const sourceEventId = uuid ? `${sessionId}:${uuid}` : `${sessionId}:${context.lineNumber}`;

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
      uuid,
      cwd: getString(record.cwd) ? normalizeHomePath(getString(record.cwd)!) : undefined,
      redaction_version: redacted.redaction_version,
      redaction_count: redacted.redaction_count,
      ingested_at: new Date().toISOString(),
    },
  };
}

function inferSessionId(file: string): string {
  return basename(file).replace(/\.jsonl$/, "");
}

function getTimestamp(record: Record<string, unknown>): string | null {
  const ts = getString(record.timestamp) ?? getString(record.created_at);
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function mapClaudeRole(record: Record<string, unknown>): ExtractedClaudeRawEvent["role"] {
  const type = getString(record.type);
  if (type === "user") return "user";
  if (type === "assistant") return "assistant";
  if (type === "system") return "system";

  const content = (record.message as { content?: unknown } | undefined)?.content;
  if (Array.isArray(content) && content.some((block) => isBlockType(block, "tool_result"))) {
    return "tool";
  }
  return "event";
}

function extractClaudeContent(record: Record<string, unknown>): string {
  const type = getString(record.type) ?? "unknown";
  const message = record.message as { content?: unknown } | undefined;
  if (message && "content" in message) {
    return contentToText(message.content);
  }
  if (typeof record.content === "string") return record.content;
  if (type === "summary" && typeof record.summary === "string") return record.summary;
  return `[${type}] ${safeCompactJson(record)}`;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return safeCompactJson(content);

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      parts.push(String(block));
      continue;
    }
    const item = block as Record<string, unknown>;
    const type = getString(item.type) ?? "unknown";
    if (type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    } else if (type === "tool_use") {
      const name = getString(item.name) ?? "unknown";
      parts.push(`[tool_use:${name}] ${safeCompactJson(item.input ?? {})}`);
    } else if (type === "tool_result") {
      parts.push(`[tool_result] ${contentToText(item.content)}`);
    } else {
      parts.push(`[${type}] ${safeCompactJson(item)}`);
    }
  }
  return parts.join("\n").trim();
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

function isBlockType(value: unknown, type: string): boolean {
  return !!value && typeof value === "object" && (value as { type?: unknown }).type === type;
}
