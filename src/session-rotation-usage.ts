/**
 * Context-volume measurement and hand-off text extraction for session rotation
 * (FR1, FR3.2). Pure over transcript lines: no clock, environment or file reads
 * (standard S4). Missing data is "unmeasured", never a quiet pass (standard S5).
 */
import { measureCodexContextFromTranscriptLines } from "./codex-context-measurement.js";

export type RotationHost = "claude_code" | "codex";

export type ContextMeasurement =
  | { status: "measured"; tokens: number }
  | { status: "unmeasured"; reason: "no_usage_record" | "usage_field_missing" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseLine(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** A visible assistant record of the main conversation (not a sub-agent, not a synthetic error stub). */
function claudeAssistantMessage(record: Record<string, unknown>): Record<string, unknown> | null {
  if (record.type !== "assistant" || record.isSidechain === true) return null;
  const message = record.message;
  if (!isRecord(message) || message.model === "<synthetic>") return null;
  return message;
}

function measureClaude(lines: Iterable<string>): ContextMeasurement {
  let latest: ContextMeasurement = { status: "unmeasured", reason: "no_usage_record" };
  for (const line of lines) {
    const record = parseLine(line);
    const message = record ? claudeAssistantMessage(record) : null;
    if (!message) continue;
    const usage = message.usage;
    const input = isRecord(usage) ? count(usage.input_tokens) : null;
    const created = isRecord(usage) ? (usage.cache_creation_input_tokens === undefined ? 0 : count(usage.cache_creation_input_tokens)) : null;
    const read = isRecord(usage) ? (usage.cache_read_input_tokens === undefined ? 0 : count(usage.cache_read_input_tokens)) : null;
    latest = input === null || created === null || read === null
      ? { status: "unmeasured", reason: "usage_field_missing" }
      : { status: "measured", tokens: input + created + read };
  }
  return latest;
}

function measureCodex(lines: Iterable<string>): ContextMeasurement {
  const measured = measureCodexContextFromTranscriptLines(lines);
  if (measured.measured_context_tokens !== null) {
    return { status: "measured", tokens: measured.measured_context_tokens };
  }
  return {
    status: "unmeasured",
    reason: measured.reason === "no_token_count_record" ? "no_usage_record" : "usage_field_missing",
  };
}

/**
 * The latest response's input volume. The last record wins, so a record with
 * missing fields never falls back to an earlier measurement.
 */
export function measureContextTokens(host: RotationHost, lines: Iterable<string>): ContextMeasurement {
  return host === "claude_code" ? measureClaude(lines) : measureCodex(lines);
}

function claudeText(message: Record<string, unknown>): string | null {
  const content = message.content;
  if (typeof content === "string") return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const parts = content
    .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text));
  const text = parts.join("\n").trim();
  return text || null;
}

function codexText(record: Record<string, unknown>): string | null {
  const payload = record.payload;
  if (!isRecord(payload)) return null;
  if (record.type === "response_item" && payload.type === "message" && payload.role === "assistant" && Array.isArray(payload.content)) {
    const parts = payload.content
      .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === "output_text" && typeof block.text === "string")
      .map((block) => String(block.text));
    return parts.join("\n").trim() || null;
  }
  if (payload.type === "agent_message" && typeof payload.message === "string") return payload.message.trim() || null;
  return null;
}

/** The seat's last visible assistant text, or null when there is none. */
export function extractLastAssistantText(host: RotationHost, lines: Iterable<string>): string | null {
  let latest: string | null = null;
  for (const line of lines) {
    const record = parseLine(line);
    if (!record) continue;
    const message = host === "claude_code" ? claudeAssistantMessage(record) : null;
    const text = host === "claude_code" ? (message ? claudeText(message) : null) : codexText(record);
    if (text !== null) latest = text;
  }
  return latest;
}
