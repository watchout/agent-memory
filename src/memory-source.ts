import { createHash } from "node:crypto";
import { safeText } from "./sanitize.js";
import type { ConversationEvent, Store } from "./stores/types.js";

export const MEMORY_SOURCE_DEFAULT_CHARS = 2000;
export const MEMORY_SOURCE_MAX_CHARS = 8000;
const SOURCE_REF = /^conversation_event:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export class MemorySourceError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function isReadableConversation(event: ConversationEvent): boolean {
  return event.metadata.private_reasoning !== true && event.metadata.hidden !== true &&
    !["analysis", "thinking", "reasoning", "developer", "system"].includes(event.role ?? "");
}

// Protect the whole record BEFORE slicing: a secret spanning a page boundary
// must not escape redaction. Hash and offsets refer to this public text only.
function publicConversation(event: ConversationEvent) {
  const text = safeText(event.content).text;
  return { text, chars: Array.from(text), hash: createHash("sha256").update(text).digest("hex") };
}

export function conversationSourcePreview(event: ConversationEvent) {
  const { chars, hash } = publicConversation(event);
  const length = Math.min(220, chars.length);
  return {
    source_ref: `conversation_event:${event.id}`,
    project: event.project === undefined ? null : safeText(event.project).text,
    source_time: safeText(event.occurred_at).text,
    content_hash: hash,
    content: chars.slice(0, length).join(""),
    truncated: length < chars.length,
    next_offset: length < chars.length ? length : null,
  };
}

export interface ReadMemorySourceInput {
  agent_id: string;
  project?: string;
  source_ref: string;
  offset?: number;
  max_chars?: number;
  expected_content_hash?: string;
}

export async function readMemorySource(store: Store, input: ReadMemorySourceInput) {
  const id = SOURCE_REF.exec(input.source_ref)?.[1];
  if (!id) throw new MemorySourceError("MEMORY_SOURCE_INVALID_REF");
  if (!input.project?.trim()) throw new MemorySourceError("MEMORY_SOURCE_PROJECT_REQUIRED");
  const offset = input.offset ?? 0;
  const maxChars = input.max_chars ?? MEMORY_SOURCE_DEFAULT_CHARS;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maxChars) ||
      maxChars < 1 || maxChars > MEMORY_SOURCE_MAX_CHARS) {
    throw new MemorySourceError("MEMORY_SOURCE_INVALID_RANGE");
  }
  if (input.expected_content_hash !== undefined && !/^[0-9a-f]{64}$/.test(input.expected_content_hash)) {
    throw new MemorySourceError("MEMORY_SOURCE_INVALID_HASH");
  }
  if (offset > 0 && !input.expected_content_hash) throw new MemorySourceError("MEMORY_SOURCE_HASH_REQUIRED");

  // The ID predicate is applied in every backend before LIMIT; never scan a
  // recent-record window or fall back to a different agent/project/backend.
  const [event] = await store.getConversationEvents({
    agent_id: input.agent_id, project: input.project, id, limit: 1,
  });
  if (!event || event.id !== id || event.agent_id !== input.agent_id ||
      event.project !== input.project || !isReadableConversation(event)) {
    throw new MemorySourceError("MEMORY_SOURCE_NOT_FOUND");
  }
  const { chars, hash } = publicConversation(event);
  if (input.expected_content_hash && input.expected_content_hash !== hash) {
    throw new MemorySourceError("MEMORY_SOURCE_CHANGED");
  }
  if (offset > chars.length) throw new MemorySourceError("MEMORY_SOURCE_INVALID_RANGE");
  const end = Math.min(offset + maxChars, chars.length);
  return {
    schema_version: "memory-source/v1" as const,
    source_ref: input.source_ref,
    project: safeText(event.project).text,
    source_time: safeText(event.occurred_at).text,
    content_hash: hash,
    offset_unit: "unicode_code_point" as const,
    offset,
    content: chars.slice(offset, end).join(""),
    total_chars: chars.length,
    truncated: end < chars.length,
    next_offset: end < chars.length ? end : null,
  };
}

/** Serialize only readMemorySource's protected result. Re-redacting serialized
 * JSON can break its syntax; re-redacting a page can reinterpret a UUID fragment
 * as a phone number and invalidate offsets/hash. All text was protected before
 * pagination (metadata individually), so preserve those exact public bytes. */
export function memorySourceText(result: Awaited<ReturnType<typeof readMemorySource>>) {
  return { type: "text" as const, text: JSON.stringify(result) };
}
