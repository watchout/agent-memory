#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createStore } from "./stores/index.js";
import type { Store } from "./stores/types.js";
import {
  DEFAULT_RECOVERY_CONFIG,
  SEARCH_MEMORY_TOOL_DESCRIPTION,
  buildRecoveryOutput,
  estimateTokens,
} from "./constants.js";
import { fetchDiscordHistory } from "./discord-history.js";
import { safeText } from "./sanitize.js";
import { ingestClaudeConversationEvents } from "./claude-conversation-ingest.js";
import { ingestCodexConversationEvents } from "./codex-conversation-ingest.js";
import { generateRestartPack } from "./restart-pack.js";
import { prepareRestart } from "./restart-prepare.js";

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

async function main() {
  const store = await createStore();

  const server = new McpServer({
    name: "wasurezu",
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
            safeText(
              `✅ Decision logged (id: ${result.id})\n\n` +
                `Decision: ${result.decision}\n` +
                (result.context ? `Context: ${result.context}\n` : "") +
                (result.tags.length ? `Tags: ${result.tags.join(", ")}\n` : "") +
                (result.project ? `Project: ${result.project}\n` : "")
            ),
          ],
        };
      } catch (err) {
        return {
          content: [safeText(`❌ Failed to log decision: ${err}`)],
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
            content: [safeText("No decisions found.")],
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
          content: [safeText(`📋 ${decisions.length} decision(s):\n\n${text}`)],
        };
      } catch (err) {
        return {
          content: [safeText(`❌ Failed to get decisions: ${err}`)],
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
            safeText(
              `🔄 Decision superseded\n\n` +
                `Old: ${result.old.decision} (now superseded)\n` +
                `New: ${result.new.decision}\n` +
                (context ? `Reason: ${context}\n` : "") +
                `New ID: ${result.new.id}`
            ),
          ],
        };
      } catch (err) {
        return {
          content: [safeText(`❌ Failed to supersede decision: ${err}`)],
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
            safeText(
              `💾 Task state saved (id: ${result.id})\n\n` +
                `Task: ${result.task}\n` +
                `Status: ${result.status}\n` +
                (result.progress ? `Progress: ${result.progress}\n` : "") +
                (result.files_modified.length
                  ? `Files: ${result.files_modified.join(", ")}\n`
                  : "") +
                (result.next_steps ? `Next: ${result.next_steps}\n` : "")
            ),
          ],
        };
      } catch (err) {
        return {
          content: [safeText(`❌ Failed to save task state: ${err}`)],
          isError: true,
        };
      }
    }
  );

  // ─── search_memory ──────────────────────────────────────────────
  server.tool(
    "search_memory",
    SEARCH_MEMORY_TOOL_DESCRIPTION,
    {
      query: z.string().describe("Search keywords or natural language query"),
      scope: z
        .enum(["decisions", "tasks", "knowledge", "messages", "conversation", "all"])
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

        const total =
          result.knowledge.length +
          result.decisions.length +
          result.task_states.length +
          result.messages.length +
          result.conversation_events.length;
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
          content: [safeText(output)],
        };
      } catch (err) {
        return {
          content: [safeText(`❌ Failed to recover context: ${err}`)],
          isError: true,
        };
      }
    }
  );

  // ─── restart_pack (AM-031 PR D) ───────────────────────────────
  server.tool(
    "restart_pack",
    "Generate a concise session restart pack optimized for continuing work after context refresh. Use it as Layer 1 recovery, then use search_memory scope=conversation when the pack is incomplete before asking the user to restate context. Keeps recover_context backward-compatible while prioritizing objective, active task, next action, blockers, files, refs, decisions, knowledge, and recent conversation summary.",
    {
      project: z.string().optional().describe("Filter by project"),
      max_tokens: z.number().optional().describe("Output token budget. Minimum floor is 500; default comes from recovery_config or 1500."),
    },
    async ({ project, max_tokens }) => {
      await logCall("restart_pack", `project="${project || PROJECT || ""}" max_tokens=${max_tokens ?? ""}`);
      try {
        const output = await generateRestartPack(store, {
          agent_id: AGENT_ID,
          project: project || PROJECT,
          max_tokens,
        });
        return {
          content: [safeText(output)],
        };
      } catch (err) {
        return {
          content: [safeText(`Failed to generate restart_pack: ${err}`)],
          isError: true,
        };
      }
    }
  );

  // ─── restart_prepare (AM-038) ──────────────────────────────────
  server.tool(
    "restart_prepare",
    "Prepare a bounded restart pack and structured continuity signal for host/AUN restart orchestration. This tool does not stop, restart, requeue, finalize, reply, close, or mutate AUN queue lifecycle. Use it to produce pack_update_needed, restart_recommended, recovery_confidence, missing_context, and provenance.",
    {
      project: z.string().optional().describe("Filter by project"),
      max_tokens: z.number().optional().describe("restart_pack token budget override"),
      continuity_guard_mode: z
        .enum(["auto_restart", "recommend", "pack_only", "off"])
        .optional()
        .describe("Continuity guard mode. auto_restart is valid only without AUN, with supported hook, and pre-authorization."),
      pack_injection_mode: z
        .enum(["auto_attach", "on_demand", "off"])
        .optional()
        .describe("Whether the prepared restart pack should be attached automatically, on demand, or not at all."),
      aun_installed: z.boolean().optional().describe("True when AUN/supervisor owns runtime lifecycle."),
      supervisor_available: z.boolean().optional().describe("True when a supported wasurezu supervisor/host hook is available."),
      restart_preauthorized: z.boolean().optional().describe("True when restart lifecycle was pre-authorized at install/config time."),
      context_used_ratio: z.number().optional().describe("Host-provided context usage ratio from 0.0 to 1.0. Omit when unknown."),
      context_tokens: z.number().optional().describe("Host-provided used tokens. Requires context_window_tokens."),
      context_window_tokens: z.number().optional().describe("Host-provided context window size. Requires context_tokens."),
      runtime_context_error: z.boolean().optional().describe("True when host/AUN observed a compaction or runtime context error."),
      emit_pack: z.boolean().optional().describe("Set false to omit restart_pack text from JSON output."),
    },
    async (args) => {
      await logCall("restart_prepare", `project="${args.project || PROJECT || ""}" mode="${args.continuity_guard_mode ?? "recommend"}"`);
      try {
        const output = await prepareRestart(store, {
          agent_id: AGENT_ID,
          project: args.project || PROJECT,
          max_tokens: args.max_tokens,
          continuity_guard_mode: args.continuity_guard_mode,
          pack_injection_mode: args.pack_injection_mode,
          aun_installed: args.aun_installed,
          supervisor_available: args.supervisor_available,
          restart_preauthorized: args.restart_preauthorized,
          context_used_ratio: args.context_used_ratio,
          context_tokens: args.context_tokens,
          context_window_tokens: args.context_window_tokens,
          runtime_context_error: args.runtime_context_error,
          emit_pack: args.emit_pack,
        });
        return {
          content: [safeText(JSON.stringify(output, null, 2))],
        };
      } catch (err) {
        return {
          content: [safeText(`Failed to prepare restart continuity signal: ${err}`)],
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
            safeText(
              `✅ Recovery config updated for ${agent_id}\n\n` +
                `max_tokens: ${config.max_tokens}\n` +
                `task_states_limit: ${config.task_states_limit}\n` +
                `decisions_limit: ${config.decisions_limit}\n` +
                `knowledge_limit: ${config.knowledge_limit}\n` +
                `messages_limit: ${config.messages_limit}\n` +
                `discord_history_limit: ${config.discord_history_limit}\n` +
                `discord_channels: ${JSON.stringify(config.discord_channels)}`
            ),
          ],
        };
      } catch (err) {
        return {
          content: [safeText(`❌ Failed to set recovery config: ${err}`)],
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
            safeText(
              `✅ Knowledge saved (id: ${result.id})\n\n` +
                `Title: ${result.title}\n` +
                `Content: ${result.content.slice(0, 200)}${result.content.length > 200 ? "..." : ""}\n` +
                (result.tags.length ? `Tags: ${result.tags.join(", ")}\n` : "") +
                (result.project ? `Project: ${result.project}\n` : "")
            ),
          ],
        };
      } catch (err) {
        return {
          content: [safeText(`❌ Failed to save knowledge: ${err}`)],
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
            content: [safeText("No knowledge entries found.")],
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
          content: [safeText(`📚 ${items.length} knowledge entry(ies):\n\n${text}`)],
        };
      } catch (err) {
        return {
          content: [safeText(`❌ Failed to get knowledge: ${err}`)],
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
            safeText(
              `Knowledge superseded\n\n` +
                `Old: ${result.old.title} (now superseded)\n` +
                `New: ${result.new.title}\n` +
                `Reason: ${reason}\n` +
                `New ID: ${result.new.id}`
            ),
          ],
        };
      } catch (err) {
        return {
          content: [safeText(`Failed to supersede knowledge: ${err}`)],
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
            safeText(
              `✅ Knowledge status updated\n\n` +
                `Title: ${result.title}\n` +
                `Status: ${result.status}\n` +
                (result.merged_into ? `Merged into: ${result.merged_into}\n` : "") +
                `ID: ${result.id}`
            ),
          ],
        };
      } catch (err) {
        return {
          content: [safeText(`❌ Failed to update knowledge status: ${err}`)],
          isError: true,
        };
      }
    }
  );

  // ─── ingest_conversation_events (AM-031 PR B) ─────────────────
  server.tool(
    "ingest_conversation_events",
    "Sweep local AI-client transcript files into redacted full-text conversation event storage. Supports Claude Code and Codex JSONL logs. Hidden reasoning and developer/base instruction bodies are excluded; redaction is applied before persistence and hashing.",
    {
      source: z
        .enum(["claude_code", "codex"])
        .optional()
        .describe("Transcript source to ingest. Supports 'claude_code' and 'codex'."),
      project: z.string().optional().describe("Project identifier (defaults to AGENT_MEMORY_PROJECT env var)"),
      since: z.string().optional().describe("ISO timestamp lower bound. Defaults to the last 24 hours."),
      root: z.string().optional().describe("Override transcript root. Defaults to CLAUDE_PROJECTS_DIR/~/.claude/projects or CODEX_SESSIONS_DIR/~/.codex/sessions."),
      max_files: z.number().optional().describe("Maximum JSONL files to scan (default: 200)"),
    },
    async ({ source, project, since, root, max_files }) => {
      const actualSource = source ?? "claude_code";
      await logCall("ingest_conversation_events", `source="${actualSource}" since="${since ?? ""}"`);
      try {
        const result =
          actualSource === "codex"
            ? await ingestCodexConversationEvents(store, AGENT_ID, {
                project: project || PROJECT,
                since,
                root,
                max_files,
              })
            : await ingestClaudeConversationEvents(store, AGENT_ID, {
                project: project || PROJECT,
                since,
                root,
                max_files,
              });
        return {
          content: [
            safeText(
              `Conversation ingest complete (source=${result.source})\n\n` +
                `Files scanned: ${result.files_scanned}\n` +
                `Lines seen: ${result.lines_seen}\n` +
                `Events saved: ${result.events_saved}\n` +
                `Duplicates: ${result.events_duplicate}\n` +
                `Skipped: ${result.events_skipped}\n` +
                `Since: ${result.since}`
            ),
          ],
        };
      } catch (err) {
        return {
          content: [safeText(`Failed to ingest conversation events: ${err}`)],
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
