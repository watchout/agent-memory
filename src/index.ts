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
import { summarizeRawCaptureCoverage } from "./raw-capture-coverage.js";
import { generateHostInvocationContext, generateRecoveryPackArtifact, generateRestartPack } from "./restart-pack.js";
import { prepareRestart } from "./restart-prepare.js";
import { catchUp } from "./catch-up.js";

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
    "Generate a concise session restart pack optimized for continuing work after context refresh. Default format is human-readable text. For automation, set format=recovery-pack-v1 or format=host-invocation-context-v1 to receive schema-shaped JSON with provenance, confidence, missing_context, trust, and redaction metadata. Use it as Layer 1 recovery, then use search_memory scope=conversation when the pack is incomplete before asking the user to restate context. Keeps recover_context backward-compatible while prioritizing objective, active task, next action, blockers, files, refs, decisions, knowledge, and recent conversation summary.",
    {
      project: z.string().optional().describe("Filter by project"),
      max_tokens: z.number().optional().describe("Output token budget. Minimum floor is 500; default comes from recovery_config or 1500."),
      format: z
        .enum(["text", "recovery-pack-v1", "host-invocation-context-v1"])
        .optional()
        .describe("Output format. text is backward-compatible; structured formats are the automation contract."),
      target_runtime: z
        .enum(["codex", "claude", "generic-mcp-host"])
        .optional()
        .describe("Required for host-invocation-context-v1 unless defaulting to codex."),
      delivery_mode: z
        .enum(["stdin-json", "system-prompt-fragment", "append-system-prompt-fragment", "session-start-hook", "tui-fallback"])
        .optional()
        .describe("Host delivery mode. tui-fallback must be treated as degraded compatibility."),
      trusted_instruction: z.string().optional().describe("Trusted wrapper instruction for host invocation. Must not embed raw shell commands."),
      untrusted_context_policy: z
        .enum(["quote-as-data-only", "omit", "summarize-only"])
        .optional()
        .describe("How the host adapter treats contextual content. Default is quote-as-data-only."),
    },
    async ({ project, max_tokens, format, target_runtime, delivery_mode, trusted_instruction, untrusted_context_policy }) => {
      await logCall("restart_pack", `project="${project || PROJECT || ""}" max_tokens=${max_tokens ?? ""} format=${format ?? "text"}`);
      try {
        if (format === "recovery-pack-v1") {
          const output = await generateRecoveryPackArtifact(store, {
            agent_id: AGENT_ID,
            project: project || PROJECT,
            max_tokens,
          });
          return {
            content: [safeText(JSON.stringify(output, null, 2))],
          };
        }
        if (format === "host-invocation-context-v1") {
          const output = await generateHostInvocationContext(store, {
            agent_id: AGENT_ID,
            project: project || PROJECT,
            max_tokens,
            target_runtime: target_runtime ?? "codex",
            delivery_mode,
            trusted_instruction,
            untrusted_context_policy,
          });
          return {
            content: [safeText(JSON.stringify(output, null, 2))],
          };
        }
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

  // ─── restart_pack_fetch (AM-039) ──────────────────────────────
  server.tool(
    "restart_pack_fetch",
    "Fetch a selected restart pack by pack_ref for host/AUN boot consume. Set consume=true to mark it consumed atomically. This tool does not restart the host or mutate AUN queue lifecycle.",
    {
      pack_ref: z.string().describe("selected_restart_pack reference returned by restart_prepare"),
      project: z.string().optional().describe("Filter by project"),
      consume: z.boolean().optional().describe("Mark the selected pack as consumed after fetching."),
    },
    async ({ pack_ref, project, consume }) => {
      await logCall("restart_pack_fetch", `pack_ref="${pack_ref}" consume=${consume === true}`);
      try {
        const pack = consume
          ? await store.consumeSelectedRestartPack({ agent_id: AGENT_ID, project: project || PROJECT, pack_ref })
          : await store.getSelectedRestartPack({ agent_id: AGENT_ID, project: project || PROJECT, pack_ref });
        if (!pack) {
          return {
            content: [safeText(`Selected restart pack not found or already consumed: ${pack_ref}`)],
            isError: true,
          };
        }
        return {
          content: [safeText(JSON.stringify(pack, null, 2))],
        };
      } catch (err) {
        return {
          content: [safeText(`Failed to fetch selected restart pack: ${err}`)],
          isError: true,
        };
      }
    }
  );

  // ─── restart_prepare (AM-038) ──────────────────────────────────
  server.tool(
    "restart_prepare",
    "Prepare a bounded restart pack and structured continuity signal for host/AUN restart orchestration. This tool does not stop, restart, requeue, finalize, reply, close, or mutate AUN queue lifecycle. auto_restart requires explicit aun_absent_confirmed=true plus supervisor availability and restart preauthorization; unknown AUN status downgrades to recommend.",
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
      aun_absent_confirmed: z
        .boolean()
        .optional()
        .describe("True only when the caller has explicitly verified AUN is absent. Required for standalone auto_restart."),
      supervisor_available: z.boolean().optional().describe("True when a supported wasurezu supervisor/host hook is available."),
      restart_preauthorized: z.boolean().optional().describe("True when restart lifecycle was pre-authorized at install/config time."),
      context_used_ratio: z.number().optional().describe("Host-provided context usage ratio from 0.0 to 1.0. Omit when unknown."),
      context_tokens: z.number().optional().describe("Host-provided used tokens. Requires context_window_tokens."),
      context_window_tokens: z.number().optional().describe("Host-provided context window size. Requires context_tokens."),
      runtime_context_error: z.boolean().optional().describe("True when host/AUN observed a compaction or runtime context error."),
      emit_pack: z.boolean().optional().describe("Set false to omit restart_pack text from JSON output."),
      pack_format: z
        .enum(["text", "recovery-pack-v1", "host-invocation-context-v1"])
        .optional()
        .describe("Selected pack format. Defaults to text; structured formats persist schema-shaped JSON selected packs."),
      target_runtime: z
        .enum(["codex", "claude", "generic-mcp-host"])
        .optional()
        .describe("Target runtime for host-invocation-context-v1 selected packs."),
      delivery_mode: z
        .enum(["stdin-json", "system-prompt-fragment", "append-system-prompt-fragment", "session-start-hook", "tui-fallback"])
        .optional()
        .describe("Delivery mode for host-invocation-context-v1 selected packs."),
      trusted_instruction: z.string().optional().describe("Trusted wrapper instruction for host invocation. Must not embed raw shell commands."),
      untrusted_context_policy: z
        .enum(["quote-as-data-only", "omit", "summarize-only"])
        .optional()
        .describe("How the host adapter treats contextual content. Default is quote-as-data-only."),
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
          aun_absent_confirmed: args.aun_absent_confirmed,
          supervisor_available: args.supervisor_available,
          restart_preauthorized: args.restart_preauthorized,
          context_used_ratio: args.context_used_ratio,
          context_tokens: args.context_tokens,
          context_window_tokens: args.context_window_tokens,
          runtime_context_error: args.runtime_context_error,
          emit_pack: args.emit_pack,
          pack_format: args.pack_format,
          target_runtime: args.target_runtime,
          delivery_mode: args.delivery_mode,
          trusted_instruction: args.trusted_instruction,
          untrusted_context_policy: args.untrusted_context_policy,
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
                `Since: ${result.since}\n` +
                `Coverage: ${result.coverage.status}\n` +
                `Coverage missing context: ${result.coverage.missing_context.join(", ") || "none"}\n` +
                `Coverage notes:\n- ${summarizeRawCaptureCoverage(result.coverage).join("\n- ")}`
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

  // ─── catch_up (AM-026) ─────────────────────────────────────────
  server.tool(
    "catch_up",
    "Sweep recent Claude Code conversation logs (~/.claude/projects/*.jsonl) for tag/tool-use events the PostToolUse hook may have missed. Inserts new task_states / decisions / knowledge with ±60s dedup against the catch_up_log ledger. Use this when you suspect the hook was offline or after onboarding a new bot. Source A = jsonl conversation logs only; Source B (Discord history) is reserved for a future PR and not yet exposed in the source enum.",
    {
      since: z
        .string()
        .optional()
        .describe(
          "ISO8601 lower bound. Defaults to the previous sweep's last event_at, or 24h ago if none."
        ),
      source: z
        .enum(["conversation"])
        .optional()
        .describe("Which source to sweep. Only 'conversation' is implemented in AM-026."),
      dry_run: z
        .boolean()
        .optional()
        .describe("True = report counts but do not insert into target tables. Default false."),
    },
    async ({ since, source, dry_run }) => {
      await logCall("catch_up", `since="${since ?? ""}" source="${source ?? "conversation"}" dry_run=${dry_run ?? false}`);
      try {
        const result = await catchUp(store, AGENT_ID, { since, source, dry_run });
        return {
          content: [
            safeText(
              `Catch-up complete (source=${source ?? "conversation"}${dry_run ? ", dry_run" : ""})\n\n` +
                `Caught:\n` +
                `  decisions:   ${result.caught.decisions}\n` +
                `  task_states: ${result.caught.task_states}\n` +
                `  knowledge:   ${result.caught.knowledge}\n` +
                `Skipped (dedup): ${result.skipped}\n` +
                `Last checked:    ${result.last_checked}`
            ),
          ],
        };
      } catch (err) {
        return {
          content: [safeText(`Failed catch_up: ${err}`)],
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
