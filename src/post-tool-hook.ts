#!/usr/bin/env node
/**
 * FEAT-025: PostToolUse hook — Tag auto-detection for agent-comms reply/send
 *
 * Fires after agent-comms reply or send_message completes.
 * Detects memory tags in the message text and inserts into DB.
 *
 * stdin: JSON { tool_name, tool_input: { text, chat_id }, tool_result: ... }
 * Tags: [TASK:start], [TASK:done], [TASK:block], [DECISION], [KNOWLEDGE]
 * No tag → exit 0 (no-op)
 */
import { createStore } from "./stores/index.js";

// --- Environment variable validation ---
// PostToolUse hooks run as child processes of the Claude SDK and do NOT inherit
// .mcp.json env vars. These must be inlined in the hook command (see templates/hooks-example.jsonc).
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[agent-memory hook] DATABASE_URL is not set, skipping");
  process.exit(0);
}

const AGENT_ID = process.env.AGENT_MEMORY_AGENT_ID || "default";
const PROJECT = process.env.AGENT_MEMORY_PROJECT || undefined;

if (!process.env.AGENT_MEMORY_AGENT_ID) {
  console.error("[agent-memory hook] AGENT_MEMORY_AGENT_ID is not set, using default: 'default'");
}

// Tag patterns
const TAG_PATTERN = /\[(TASK:(start|done|block)|DECISION|KNOWLEDGE)\]/i;
const TICKET_PATTERN = /(?:FEAT-\d+|PR[#＃]\d+|ISSUE[#＃]\d+|#\d+)/i;

interface HookInput {
  tool_name: string;
  tool_input: {
    text?: string;
    chat_id?: string;
    [key: string]: unknown;
  };
  tool_result?: unknown;
}

function parseTag(text: string): { type: string; subtype?: string } | null {
  const match = text.match(TAG_PATTERN);
  if (!match) return null;

  const fullTag = match[1].toUpperCase();
  if (fullTag.startsWith("TASK:")) {
    return { type: "TASK", subtype: fullTag.split(":")[1].toLowerCase() };
  }
  return { type: fullTag };
}

function extractTicketId(text: string): string | null {
  const match = text.match(TICKET_PATTERN);
  return match ? match[0] : null;
}

function extractContent(text: string): string {
  // Remove the tag itself from the content
  return text.replace(TAG_PATTERN, "").trim();
}

async function main() {
  // Read hook input from stdin
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
  }

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    // Not valid JSON — skip silently
    process.exit(0);
  }

  // Only process agent-comms reply/send tools
  const toolName = input.tool_name || "";
  if (!toolName.match(/^mcp__agent-comms__(reply|send_message)$/)) {
    process.exit(0);
  }

  const text = input.tool_input?.text || "";
  if (!text) process.exit(0);

  // Detect tag
  const tag = parseTag(text);
  if (!tag) process.exit(0);

  const content = extractContent(text);
  const ticketId = extractTicketId(text);

  const store = await createStore();
  try {
    if (tag.type === "TASK") {
      const statusMap: Record<string, "in_progress" | "completed" | "blocked"> = {
        start: "in_progress",
        done: "completed",
        block: "blocked",
      };
      const status = statusMap[tag.subtype!];
      const taskName = ticketId || content.slice(0, 100);

      await store.saveTaskState({
        agent_id: AGENT_ID,
        project: PROJECT,
        task: taskName,
        status,
        progress: content,
        next_steps: status === "blocked" ? content : undefined,
      });
      console.error(`[agent-memory hook] TASK:${tag.subtype} → ${taskName}`);
    } else if (tag.type === "DECISION") {
      await store.logDecision({
        agent_id: AGENT_ID,
        project: PROJECT,
        decision: content,
        context: `Auto-detected from Discord message (chat_id: ${input.tool_input?.chat_id || "unknown"})`,
        tags: ticketId ? [ticketId] : [],
      });
      console.error(`[agent-memory hook] DECISION → ${content.slice(0, 80)}`);
    } else if (tag.type === "KNOWLEDGE") {
      const title = ticketId
        ? `${ticketId}: ${content.slice(0, 80)}`
        : content.slice(0, 80);
      await store.saveKnowledge({
        agent_id: AGENT_ID,
        project: PROJECT,
        title,
        content,
        source_type: "messages",
        tags: ticketId ? [ticketId] : [],
      });
      console.error(`[agent-memory hook] KNOWLEDGE → ${title}`);
    }
  } finally {
    await store.close();
  }
}

main().catch((err) => {
  console.error("[agent-memory hook] Error:", err.message);
  process.exit(0); // Non-fatal: don't block the tool
});
