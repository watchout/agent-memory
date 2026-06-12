/**
 * search_memory output formatting + output-boundary redaction.
 *
 * Extracted from the inline MCP tool handler (src/index.ts) so the
 * formatted output can be probed directly by Gate 0 tests. Structured
 * memory (decisions/knowledge/task states) is NOT redacted at ingest,
 * so this output boundary must apply redactText before the text leaves
 * the server. Spec: docs/impl/IMPL-2026-06-12-search-output-redaction.md
 */
import type { SearchMemoryResult } from "./stores/types.js";
import { redactText } from "./redact.js";

export function formatSearchMemoryOutput(
  query: string,
  result: SearchMemoryResult
): string {
  const total =
    result.knowledge.length +
    result.decisions.length +
    result.task_states.length +
    result.messages.length +
    result.conversation_events.length;

  if (total === 0) {
    return redactText(`🔍 search_memory: "${query}" — no results`).text;
  }

  const parts: string[] = [];
  parts.push(`🔍 search_memory: "${query}" — ${total} results\n`);

  if (result.knowledge.length > 0) {
    parts.push("── KNOWLEDGE ──");
    for (const k of result.knowledge) {
      parts.push(`• ${k.title}`);
      parts.push(`  ${k.content}`);
      if (k.tags.length) parts.push(`  Tags: ${k.tags.join(", ")} | ${k.updated_at.slice(0, 10)}`);
    }
    parts.push("");
  }

  if (result.decisions.length > 0) {
    parts.push("── DECISIONS ──");
    for (const d of result.decisions) {
      parts.push(`• [${d.status}] ${d.decision}`);
      if (d.context) parts.push(`  ↳ ${d.context}`);
      if (d.tags.length) parts.push(`  Tags: ${d.tags.join(", ")} | ${d.created_at.slice(0, 10)}`);
    }
    parts.push("");
  }

  if (result.task_states.length > 0) {
    parts.push("── TASK STATES ──");
    for (const t of result.task_states) {
      const emoji =
        t.status === "completed"
          ? "✅"
          : t.status === "blocked"
            ? "🚫"
            : "🔧";
      parts.push(`• ${emoji} [${t.status}] ${t.task}`);
      if (t.progress) parts.push(`  Progress: ${t.progress}`);
      if (t.files_modified.length)
        parts.push(`  Files: ${t.files_modified.join(", ")}`);
      parts.push(`  ${t.created_at.slice(0, 10)}`);
    }
    parts.push("");
  }

  if (result.messages.length > 0) {
    parts.push("── MESSAGES ──");
    for (const m of result.messages) {
      parts.push(`• [${m.source}] ${m.author_id}: ${m.content.slice(0, 100)}${m.content.length > 100 ? '...' : ''}`);
      parts.push(`  ${m.created_at.slice(0, 10)}`);
    }
    parts.push("");
  }

  if (result.conversation_events.length > 0) {
    parts.push("── CONVERSATION EVENTS ──");
    for (const event of result.conversation_events) {
      const source = `${event.source}/${event.role ?? "event"}`;
      const excerpt = event.content.slice(0, 220);
      parts.push(`• [${source}] ${excerpt}${event.content.length > 220 ? "..." : ""}`);
      parts.push(`  ${event.occurred_at.slice(0, 10)}`);
    }
  }

  // Single pass over the assembled string so cross-field adjacency
  // cannot reassemble a secret around section boundaries.
  return redactText(parts.join("\n")).text;
}
