#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createStore } from "./stores/index.js";
import type { Store } from "./stores/types.js";
import { DEFAULT_RECOVERY_CONFIG, buildRecoveryOutput, estimateTokens } from "./constants.js";
import { fetchDiscordHistory } from "./discord-history.js";

const AGENT_ID = process.env.AGENT_MEMORY_AGENT_ID || "default";
const PROJECT = process.env.AGENT_MEMORY_PROJECT || undefined;
const SESSION_ID = process.env.CLAUDE_SESSION_ID || `session-${Date.now()}`;

const LOG_DIR = join(homedir(), ".agent-memory");

// Recovery quality tracking (FEAT-024)
let recoveryLogId = "";
let searchMemoryCountSinceRecovery = 0;
let searchMemoryTimer: ReturnType<typeof setTimeout> | null = null;
const LOG_FILE = join(LOG_DIR, "calls.log");

async function logCall(tool: string, params: string): Promise<void> {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    const line = `${new Date().toISOString()}  ${tool}  ${params}\n`;
    await appendFile(LOG_FILE, line);
  } catch {
    // Logging failure should never break tool execution
  }
}

/**
 * Strip orphaned UTF-16 surrogate code units from a string so the
 * MCP transport can serialize it through a strict JSON parser
 * (e.g. the Anthropic API) without `no low surrogate` errors.
 *
 * Background:
 *   - JS strings are UTF-16 internally. Code points above U+FFFF
 *     (most emoji, some CJK extensions) are encoded as surrogate
 *     pairs: a high surrogate (D800–DBFF) followed by a low
 *     surrogate (DC00–DFFF).
 *   - `String.prototype.slice` operates on UTF-16 code units, so
 *     `"😀hi".slice(0, 1)` returns just the high surrogate, leaving
 *     it orphaned.
 *   - `JSON.stringify` will happily emit `\uD83D` for that orphan,
 *     and lenient parsers (V8) accept it. But strict RFC 8259
 *     parsers (e.g. the Anthropic API request validator) reject it
 *     with `no low surrogate in string`.
 *
 * Strategy: walk the string code-unit by code-unit and drop any
 * surrogate that doesn't have its mate in the right position.
 * Well-formed pairs pass through untouched.
 *
 * This is a defense-in-depth boundary fix. Upstream call sites
 * should also avoid `slice()`-ing non-BMP text mid-pair, but as
 * long as a sanitizer runs at the MCP output boundary, slice
 * accidents stop reaching the API.
 */
function stripOrphanSurrogates(input: string): string {
  if (typeof input !== "string") return input;
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    // High surrogate: must be followed by a low surrogate
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i] + input[i + 1];
        i++;
        continue;
      }
      // Orphan high surrogate — drop it
      continue;
    }
    // Lone low surrogate (no preceding high) — drop it
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }
    out += input[i];
  }
  return out;
}

/**
 * Wrap an MCP tool's text payload to guarantee JSON-clean output.
 * Use at every `text` field returned from a tool handler so a
 * surrogate orphan can never slip through to the transport.
 */
function safeText(text: string): { type: "text"; text: string } {
  return { type: "text" as const, text: stripOrphanSurrogates(text) };
}

// Exported for unit tests.
export { stripOrphanSurrogates };

async function main() {
  const store = await createStore();

  const server = new McpServer({
    name: "agent-memory",
    version: "0.3.0",
  });

  // ─── log_decision ───────────────────────────────────────────────
  server.tool(
    "log_decision",
    "Save an important decision to persistent storage. Use this when you make architectural choices, resolve trade-offs, or establish conventions. Decisions survive compaction and session restarts.",
    {
      decision: z.string().describe("What was decided"),
      context: z
        .string()
        .optional()
        .describe("Why this decision was made — alternatives considered, reasoning"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Classification tags (e.g. ['auth', 'architecture'])"),
      project: z
        .string()
        .optional()
        .describe("Project identifier (defaults to AGENT_MEMORY_PROJECT env var)"),
    },
    async ({ decision, context, tags, project }) => {
      await logCall("log_decision", `decision="${decision}"`);
      try {
        const result = await store.logDecision({
          agent_id: AGENT_ID,
          decision,
          context,
          tags,
          project: project || PROJECT,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Decision logged (id: ${result.id})\n\n` +
                `Decision: ${result.decision}\n` +
                (result.context ? `Context: ${result.context}\n` : "") +
                (result.tags.length ? `Tags: ${result.tags.join(", ")}\n` : "") +
                (result.project ? `Project: ${result.project}\n` : ""),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed to log decision: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ─── get_decisions ──────────────────────────────────────────────
  server.tool(
    "get_decisions",
    "Retrieve stored decisions. Use to review past architectural choices and avoid contradicting them. Returns active decisions by default.",
    {
      project: z.string().optional().describe("Filter by project"),
      tags: z.array(z.string()).optional().describe("Filter by tags (any match)"),
      limit: z.number().optional().describe("Max results (default: 10)"),
      status: z
        .enum(["active", "superseded", "all"])
        .optional()
        .describe("Filter by status (default: active)"),
    },
    async ({ project, tags, limit, status }) => {
      await logCall("get_decisions", `project="${project || PROJECT || ""}" status="${status || "active"}"`);
      try {
        const decisions = await store.getDecisions({
          agent_id: AGENT_ID,
          project: project || PROJECT,
          tags,
          limit,
          status,
        });

        if (decisions.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No decisions found." }],
          };
        }

        const text = decisions
          .map(
            (d, i) =>
              `${i + 1}. [${d.status}] ${d.decision}` +
              (d.context ? `\n   Context: ${d.context}` : "") +
              (d.tags.length ? `\n   Tags: ${d.tags.join(", ")}` : "") +
              `\n   ID: ${d.id} | ${d.created_at}`
          )
          .join("\n\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `📋 ${decisions.length} decision(s):\n\n${text}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed to get decisions: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ─── supersede_decision ─────────────────────────────────────────
  server.tool(
    "supersede_decision",
    "Replace an old decision with a new one. The old decision is marked as superseded and linked to the new one. Use when requirements change or a better approach is found.",
    {
      old_decision_id: z.string().describe("UUID of the decision being superseded"),
      new_decision: z.string().describe("The new decision"),
      context: z.string().optional().describe("Why the decision changed"),
      tags: z.array(z.string()).optional().describe("Tags for the new decision"),
      project: z.string().optional().describe("Project identifier"),
    },
    async ({ old_decision_id, new_decision, context, tags, project }) => {
      await logCall("supersede_decision", `old_id="${old_decision_id}" new="${new_decision}"`);
      try {
        const result = await store.supersedeDecision({
          agent_id: AGENT_ID,
          old_decision_id,
          new_decision,
          context,
          tags,
          project: project || PROJECT,
        });
        return {
          content: [
            {
              type: "text" as const,
              text:
                `🔄 Decision superseded\n\n` +
                `Old: ${result.old.decision} (now superseded)\n` +
                `New: ${result.new.decision}\n` +
                (context ? `Reason: ${context}\n` : "") +
                `New ID: ${result.new.id}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `❌ Failed to supersede decision: ${err}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── save_task_state ────────────────────────────────────────────
  server.tool(
    "save_task_state",
    "Save your current work state. Call this at natural breakpoints, before long operations, or when explicitly asked. This state survives compaction and session restarts.",
    {
      task: z.string().describe("Current task name"),
      status: z
        .enum(["in_progress", "completed", "blocked"])
        .describe("Task status"),
      progress: z.string().optional().describe("What has been done so far"),
      files_modified: z
        .array(z.string())
        .optional()
        .describe("Files changed in this task"),
      next_steps: z.string().optional().describe("What should be done next"),
      project: z.string().optional().describe("Project identifier"),
    },
    async ({ task, status, progress, files_modified, next_steps, project }) => {
      await logCall("save_task_state", `task="${task}" status="${status}"`);
      try {
        const result = await store.saveTaskState({
          agent_id: AGENT_ID,
          task,
          status,
          progress,
          files_modified,
          next_steps,
          project: project || PROJECT,
        });
        return {
          content: [
            {
              type: "text" as const,
              text:
                `💾 Task state saved (id: ${result.id})\n\n` +
                `Task: ${result.task}\n` +
                `Status: ${result.status}\n` +
                (result.progress ? `Progress: ${result.progress}\n` : "") +
                (result.files_modified.length
                  ? `Files: ${result.files_modified.join(", ")}\n`
                  : "") +
                (result.next_steps ? `Next: ${result.next_steps}\n` : ""),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `❌ Failed to save task state: ${err}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── search_memory ──────────────────────────────────────────────
  server.tool(
    "search_memory",
    "Search agent's knowledge base using semantic similarity. Call this tool when you need context about past decisions, project architecture, or any information that may have been discussed in previous sessions. IMPORTANT: Call this proactively when starting a new task or when you are uncertain about project-specific details. Do not wait for the user to ask.",
    {
      query: z.string().describe("Search keywords or natural language query"),
      scope: z
        .enum(["decisions", "tasks", "knowledge", "messages", "all"])
        .optional()
        .describe("Search scope (default: all)"),
      limit: z.number().optional().describe("Max results (default: 5)"),
      project: z.string().optional().describe("Filter by project"),
    },
    async ({ query, scope, limit, project }) => {
      await logCall("search_memory", `query="${query}"`);
      searchMemoryCountSinceRecovery++;
      try {
        const result = await store.searchMemory({
          agent_id: AGENT_ID,
          query,
          scope,
          limit,
          project: project || PROJECT,
        });

        const total = result.knowledge.length + result.decisions.length + result.task_states.length + result.messages.length;
        if (total === 0) {
          return {
            content: [safeText(`🔍 search_memory: "${query}" — no results`)],
          };
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
        }

        return {
          content: [safeText(parts.join("\n"))],
        };
      } catch (err) {
        return {
          content: [safeText(`❌ Failed to search memory: ${err}`)],
          isError: true,
        };
      }
    }
  );

  // ─── recover_context ───────────────────────────────────────────
  server.tool(
    "recover_context",
    "Restore full session context at startup. Returns current task + recent completed tasks, active decisions, key knowledge, and recent messages (if agent-comms is installed). Limits are per-agent via recovery_config table. Called automatically by SessionStart hook.",
    {
      project: z.string().optional().describe("Filter by project"),
    },
    async ({ project }) => {
      await logCall("recover_context", `project="${project || PROJECT || ""}"`);
      try {
        const proj = project || PROJECT;

        // Load per-agent config from DB, fall back to defaults
        const dbConfig = await store.getRecoveryConfig(AGENT_ID);
        const cfg = dbConfig ?? { ...DEFAULT_RECOVERY_CONFIG, agent_id: AGENT_ID };

        const [inProgressTasks, completedTasks, decisions, knowledgeItems, messages] = await Promise.all([
          store.getTaskStates({ agent_id: AGENT_ID, project: proj, limit: 1, status: "in_progress" }),
          store.getTaskStates({ agent_id: AGENT_ID, project: proj, limit: Math.max(cfg.task_states_limit - 1, 0), status: "completed" }),
          store.getDecisions({ agent_id: AGENT_ID, project: proj, limit: cfg.decisions_limit, status: "active" }),
          store.getKnowledge({ agent_id: AGENT_ID, project: proj, limit: cfg.knowledge_limit, status: "active" }),
          store.getRecentMessages({ agent_id: AGENT_ID, project: proj, limit: cfg.messages_limit }),
        ]);

        // FEAT-026: Fetch Discord history if agent-comms is available
        let discordHistory: string[] = [];
        if (cfg.discord_history_limit > 0 && cfg.discord_channels.length > 0) {
          discordHistory = await fetchDiscordHistory(cfg.discord_channels, cfg.discord_history_limit);
        }

        const output = buildRecoveryOutput({
          agentId: AGENT_ID, project: proj, config: cfg,
          inProgressTasks, completedTasks, decisions, knowledgeItems, messages,
          discordHistory,
        });

        // Log recovery quality (FEAT-024 / AM-002 Stage 1).
        // Notes carries a JSON summary of what was actually restored,
        // so we can reconstruct recovery quality offline without needing
        // the original output text.
        const recoveredTokens = estimateTokens(output);
        searchMemoryCountSinceRecovery = 0;
        if (searchMemoryTimer) clearTimeout(searchMemoryTimer);

        const notes = JSON.stringify({
          source: "recover_context",
          decisions: decisions.length,
          tasks_in_progress: inProgressTasks.length,
          tasks_completed: completedTasks.length,
          knowledge: knowledgeItems.length,
          messages: messages.length,
          discord_history: discordHistory.length,
        });

        recoveryLogId = await store.logRecoveryQuality({
          agent_id: AGENT_ID,
          session_id: SESSION_ID,
          recovered_tokens: recoveredTokens,
          task_continued: false,
          notes,
        });

        // Schedule 10-minute update of search_memory count
        if (recoveryLogId) {
          searchMemoryTimer = setTimeout(async () => {
            try {
              await store.updateSearchMemoryCount(recoveryLogId, searchMemoryCountSinceRecovery);
            } catch {
              // Non-fatal
            }
          }, 10 * 60 * 1000);
        }

        return {
          content: [{ type: "text" as const, text: output }],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `❌ Failed to recover context: ${err}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── set_recovery_config ─────────────────────────────────────────
  server.tool(
    "set_recovery_config",
    "Update recovery configuration for an agent. Only specified fields are updated; unspecified fields retain their current values. Use this to tune how much context is restored on session restart.",
    {
      agent_id: z.string().describe("Agent ID to configure"),
      max_tokens: z.number().optional().describe("Max tokens for recovery output"),
      task_states_limit: z.number().optional().describe("Number of task states to restore"),
      decisions_limit: z.number().optional().describe("Number of decisions to restore"),
      knowledge_limit: z.number().optional().describe("Number of knowledge items to restore"),
      messages_limit: z.number().optional().describe("Number of recent messages to restore"),
    },
    async ({ agent_id, max_tokens, task_states_limit, decisions_limit, knowledge_limit, messages_limit }) => {
      await logCall("set_recovery_config", `agent_id="${agent_id}"`);
      try {
        const config = await store.upsertRecoveryConfig({
          agent_id,
          max_tokens,
          task_states_limit,
          decisions_limit,
          knowledge_limit,
          messages_limit,
        });
        return {
          content: [
            {
              type: "text" as const,
              text:
                `✅ Recovery config updated for ${agent_id}\n\n` +
                `max_tokens: ${config.max_tokens}\n` +
                `task_states_limit: ${config.task_states_limit}\n` +
                `decisions_limit: ${config.decisions_limit}\n` +
                `knowledge_limit: ${config.knowledge_limit}\n` +
                `messages_limit: ${config.messages_limit}\n` +
                `discord_history_limit: ${config.discord_history_limit}\n` +
                `discord_channels: ${JSON.stringify(config.discord_channels)}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed to set recovery config: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ─── save_knowledge ─────────────────────────────────────────────
  server.tool(
    "save_knowledge",
    "Save a knowledge entry for future reference. Use for facts, patterns, or lessons learned that should persist across sessions.",
    {
      title: z.string().min(1).describe("Short title for the knowledge"),
      content: z.string().min(1).describe("Detailed content"),
      source_type: z.enum(["manual", "decisions", "messages"]).default("manual").describe("Source type"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      project: z.string().optional().describe("Project identifier"),
    },
    async ({ title, content, source_type, tags, project }) => {
      await logCall("save_knowledge", `title="${title}"`);
      try {
        const result = await store.saveKnowledge({
          agent_id: AGENT_ID,
          title,
          content,
          source_type,
          tags,
          project: project || PROJECT,
        });
        return {
          content: [
            {
              type: "text" as const,
              text:
                `✅ Knowledge saved (id: ${result.id})\n\n` +
                `Title: ${result.title}\n` +
                `Content: ${result.content.slice(0, 200)}${result.content.length > 200 ? "..." : ""}\n` +
                (result.tags.length ? `Tags: ${result.tags.join(", ")}\n` : "") +
                (result.project ? `Project: ${result.project}\n` : ""),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed to save knowledge: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ─── get_knowledge ─────────────────────────────────────────────
  server.tool(
    "get_knowledge",
    "Retrieve knowledge entries. Filter by status, tags, or project.",
    {
      status: z.enum(["active", "merged", "archived", "all"]).optional().describe("Filter by status (default: active)"),
      tags: z.array(z.string()).optional().describe("Filter by tags (any match)"),
      project: z.string().optional().describe("Filter by project"),
      limit: z.number().min(1).max(100).optional().describe("Max results (default: 10)"),
    },
    async ({ status, tags, project, limit }) => {
      await logCall("get_knowledge", `status="${status || "active"}" limit=${limit || 10}`);
      try {
        const items = await store.getKnowledge({
          agent_id: AGENT_ID,
          status: status as "active" | "merged" | "archived" | "all" | undefined,
          tags,
          project: project || PROJECT,
          limit,
        });

        if (items.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No knowledge entries found." }],
          };
        }

        const text = items
          .map(
            (k, i) =>
              `${i + 1}. [${k.status}] ${k.title}\n` +
              `   ${k.content.slice(0, 150)}${k.content.length > 150 ? "..." : ""}\n` +
              (k.tags.length ? `   Tags: ${k.tags.join(", ")}\n` : "") +
              `   ID: ${k.id} | ${k.updated_at.slice(0, 10)}`
          )
          .join("\n\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `📚 ${items.length} knowledge entry(ies):\n\n${text}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed to get knowledge: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ─── supersede_knowledge ───────────────────────────────────────
  server.tool(
    "supersede_knowledge",
    "Replace an outdated or incorrect knowledge entry with a corrected one. The old entry is marked as superseded. Use when a previously saved fact turns out to be wrong or needs updating.",
    {
      old_id: z.string().uuid().describe("ID of the knowledge entry being superseded"),
      new_title: z.string().describe("Title for the new knowledge entry"),
      new_content: z.string().describe("Content of the new knowledge entry"),
      reason: z.string().describe("Why the old knowledge entry is being superseded"),
      tags: z.array(z.string()).optional().describe("Tags for the new entry (defaults to old entry's tags)"),
      project: z.string().optional().describe("Project identifier"),
    },
    async ({ old_id, new_title, new_content, reason, tags, project }) => {
      await logCall("supersede_knowledge", `old_id="${old_id}" new_title="${new_title}"`);
      try {
        const result = await store.supersedeKnowledge({
          agent_id: AGENT_ID,
          old_id,
          new_title,
          new_content,
          reason,
          tags,
          project: project || PROJECT,
        });
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Knowledge superseded\n\n` +
                `Old: ${result.old.title} (now superseded)\n` +
                `New: ${result.new.title}\n` +
                `Reason: ${reason}\n` +
                `New ID: ${result.new.id}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Failed to supersede knowledge: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ─── update_knowledge_status ───────────────────────────────────
  server.tool(
    "update_knowledge_status",
    "Update status of a knowledge entry (e.g. archive old knowledge or mark as merged).",
    {
      id: z.string().uuid().describe("Knowledge entry ID"),
      status: z.enum(["active", "merged", "archived"]).describe("New status"),
      merged_into: z.string().uuid().optional().describe("ID of the knowledge entry this was merged into"),
    },
    async ({ id, status, merged_into }) => {
      await logCall("update_knowledge_status", `id="${id}" status="${status}"`);
      try {
        const result = await store.updateKnowledgeStatus({
          id,
          agent_id: AGENT_ID,
          status,
          merged_into,
        });
        return {
          content: [
            {
              type: "text" as const,
              text:
                `✅ Knowledge status updated\n\n` +
                `Title: ${result.title}\n` +
                `Status: ${result.status}\n` +
                (result.merged_into ? `Merged into: ${result.merged_into}\n` : "") +
                `ID: ${result.id}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed to update knowledge status: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ─── Start server ──────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[agent-memory] MCP server running on stdio");

  // Graceful shutdown
  const shutdown = async () => {
    // Flush search_memory count before exit
    if (recoveryLogId && searchMemoryCountSinceRecovery > 0) {
      await store.updateSearchMemoryCount(recoveryLogId, searchMemoryCountSinceRecovery).catch(() => {});
    }
    if (searchMemoryTimer) clearTimeout(searchMemoryTimer);
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[agent-memory] Fatal error:", err);
  process.exit(1);
});
