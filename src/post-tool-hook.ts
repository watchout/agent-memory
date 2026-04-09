#!/usr/bin/env node
/**
 * FEAT-025 / AM-016: PostToolUse hook — Tag auto-detection.
 *
 * Fires after a tool call. Detects memory tags in the outgoing
 * Discord message text and inserts into the agent-memory DB.
 *
 * Supported tool paths:
 *   1. mcp__agent-comms__reply / send_message — original MCP path
 *   2. Bash + curl POST to discord.com/api/v\d+/channels/.../messages
 *      (added by AM-016 because several bots had to fall back to
 *       direct Discord REST while the agent-comms reply tool's
 *       mentions bug was being fixed)
 *
 * stdin: JSON { tool_name, tool_input: {...}, tool_result: ... }
 * Tags : [TASK:start], [TASK:done], [TASK:block], [DECISION], [KNOWLEDGE]
 * No tag → exit 0 (no-op).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createStore } from "./stores/index.js";
import type { Store } from "./stores/types.js";

// --- Config file support ---
// Load ~/.agent-memory/config.json to avoid inlining env vars in settings.json.
// Falls back to environment variables for backward compatibility.
function loadConfig(): Record<string, string> {
  const configPath = join(homedir(), ".agent-memory", "config.json");
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}
const config = loadConfig();

if (!process.env.DATABASE_URL && config.database_url) {
  process.env.DATABASE_URL = config.database_url;
}
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[agent-memory hook] DATABASE_URL is not set (env nor config.json), skipping");
  process.exit(0);
}

const AGENT_ID = process.env.AGENT_MEMORY_AGENT_ID || config.agent_id || "default";
const PROJECT = process.env.AGENT_MEMORY_PROJECT || config.default_project || undefined;

if (!process.env.AGENT_MEMORY_AGENT_ID && !config.agent_id) {
  console.error("[agent-memory hook] AGENT_MEMORY_AGENT_ID is not set, using default: 'default'");
}

// ─── Tag patterns ────────────────────────────────────────────────
const TAG_PATTERN = /\[(TASK:(start|done|block)|DECISION|KNOWLEDGE)\]/i;
const TICKET_PATTERN = /(?:FEAT-\d+|AM-\d+|PR[#＃]\d+|ISSUE[#＃]\d+|#\d+)/i;

// ─── Bash + curl detection (AM-016) ──────────────────────────────
//
// We only consider POSTs to the Discord channels endpoint to avoid
// false positives from other curl commands (GitHub API, internal
// services, telemetry, etc.).
const BASH_DISCORD_URL_RE =
  /https?:\/\/(?:[^/\s'"]*\.)?discord\.com\/api\/v\d+\/channels\/(\d+)\/messages/i;
//
// JSON-aware "content": "..." extractor. Works for both inline
// (-d '{"content":"..."}') and heredoc (--data @- <<'EOF' ... EOF)
// curl forms because the regex scans the entire command string and
// allows JSON escape sequences inside the value.
const BASH_CONTENT_RE = /"content"\s*:\s*"((?:[^"\\]|\\.)*)"/;

interface HookInput {
  tool_name: string;
  tool_input: {
    text?: string;
    chat_id?: string;
    command?: string;
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

/**
 * AM-023: split the (post-tag-strip) content into a stable task_id and
 * a human-readable description.
 *
 *   "AM-023 task_id UPSERT 着手"  → { taskId: "AM-023", taskDescription: "task_id UPSERT 着手" }
 *   "Build the API"               → { taskId: undefined, taskDescription: "Build the API" }
 *
 * When `taskId` is undefined the store layer falls back to a SHA-256
 * prefix of `taskDescription`. We deliberately do not pre-hash here so
 * that callers passing a real ticket id keep the readable text intact.
 */
export function splitTaskFromContent(
  content: string,
  ticketId: string | null
): { taskId: string | undefined; taskDescription: string } {
  if (!ticketId) {
    return { taskId: undefined, taskDescription: content };
  }
  // Strip the *first* occurrence of the ticket id from the content so
  // the description doesn't double-print it. Anchor on word boundaries
  // and tolerate optional surrounding whitespace.
  const escaped = ticketId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = content
    .replace(new RegExp(`\\s*${escaped}\\s*`, "i"), " ")
    .trim();
  // Cap to 200 chars so the `task` column stays readable on a single
  // log line. Full text is still preserved in `progress`.
  const taskDescription = stripped.slice(0, 200) || ticketId;
  return { taskId: ticketId, taskDescription };
}

/**
 * AM-016: extract Discord message content from a Bash command string.
 *
 * Returns null when the command is not a Discord channels POST or when
 * the content field cannot be located. Both inline and heredoc curl
 * forms are supported because the regex scans the whole command.
 */
export function extractDiscordContentFromBash(
  command: string
): { content: string; channel_id: string } | null {
  const channelMatch = command.match(BASH_DISCORD_URL_RE);
  if (!channelMatch) return null;
  const channel_id = channelMatch[1];

  const contentMatch = command.match(BASH_CONTENT_RE);
  if (!contentMatch) return null;

  // Unescape JSON string by re-parsing as a JSON literal.
  let content: string;
  try {
    content = JSON.parse('"' + contentMatch[1] + '"');
  } catch {
    return null;
  }
  if (!content) return null;

  return { content, channel_id };
}

/**
 * Shared content processor — refactored out of main() so the new Bash
 * branch can reuse the existing tag detection + DB write path.
 *
 * `source` is recorded for future debugging (which path produced the
 * row). It is not currently persisted anywhere, but the parameter
 * keeps the seam for AM-018 / future metadata work.
 */
async function processContent(
  store: Store,
  text: string,
  source: { channel: "mcp" | "bash"; chat_id?: string }
): Promise<void> {
  const tag = parseTag(text);
  if (!tag) return;

  const content = extractContent(text);
  const ticketId = extractTicketId(text);

  if (tag.type === "TASK") {
    const statusMap: Record<string, "in_progress" | "completed" | "blocked"> = {
      start: "in_progress",
      done: "completed",
      block: "blocked",
    };
    const status = statusMap[tag.subtype!];
    // AM-023: split the message into a stable task_id (used for the
    // UPSERT key) and a human-readable task description. With a ticket
    // id like "AM-023" the description is the rest of the line; without
    // one, the store derives a hash-based fallback id internally.
    const { taskId, taskDescription } = splitTaskFromContent(content, ticketId);

    await store.saveTaskState({
      agent_id: AGENT_ID,
      project: PROJECT,
      task_id: taskId,
      task: taskDescription,
      status,
      progress: content,
      next_steps: status === "blocked" ? content : undefined,
    });
    console.error(
      `[agent-memory hook] TASK:${tag.subtype} (${source.channel}) → ${taskId ?? "(hash)"} :: ${taskDescription.slice(0, 60)}`
    );
    return;
  }

  if (tag.type === "DECISION") {
    await store.logDecision({
      agent_id: AGENT_ID,
      project: PROJECT,
      decision: content,
      context: `Auto-detected from Discord message via ${source.channel} (chat_id: ${source.chat_id ?? "unknown"})`,
      tags: ticketId ? [ticketId] : [],
    });
    console.error(`[agent-memory hook] DECISION (${source.channel}) → ${content.slice(0, 80)}`);
    return;
  }

  if (tag.type === "KNOWLEDGE") {
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
    console.error(`[agent-memory hook] KNOWLEDGE (${source.channel}) → ${title}`);
    return;
  }
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

  const toolName = input.tool_name || "";

  // ─── Path 1: existing MCP agent-comms reply / send_message ─────
  if (toolName.match(/^mcp__agent-comms__(reply|send_message)$/)) {
    const text = input.tool_input?.text || "";
    if (!text) process.exit(0);
    if (!parseTag(text)) process.exit(0);

    const store = await createStore();
    try {
      await processContent(store, text, {
        channel: "mcp",
        chat_id: input.tool_input?.chat_id,
      });
    } finally {
      await store.close();
    }
    return;
  }

  // ─── Path 2 (AM-016): Bash + curl direct Discord REST ──────────
  if (toolName === "Bash") {
    const command = input.tool_input?.command || "";
    if (!command) process.exit(0);

    const extracted = extractDiscordContentFromBash(command);
    if (!extracted) process.exit(0);
    if (!parseTag(extracted.content)) process.exit(0);

    const store = await createStore();
    try {
      await processContent(store, extracted.content, {
        channel: "bash",
        chat_id: extracted.channel_id,
      });
    } finally {
      await store.close();
    }
    return;
  }

  // Unrelated tool — no-op
  process.exit(0);
}

// Only run main() when invoked as a script, not when imported by tests.
// (ESM equivalent of `if __name__ == '__main__'`.)
const isCli =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  main().catch((err) => {
    console.error("[agent-memory hook] Error:", err.message);
    process.exit(0); // Non-fatal: don't block the tool
  });
}
