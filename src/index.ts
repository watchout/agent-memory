#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createStore } from "./stores/index.js";
import type { Store } from "./stores/types.js";

const AGENT_ID = process.env.AGENT_MEMORY_AGENT_ID || "default";
const PROJECT = process.env.AGENT_MEMORY_PROJECT || undefined;

const LOG_DIR = join(homedir(), ".agent-memory");
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
    name: "agent-memory",
    version: "0.2.0",
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
    "Search past decisions and task context by keyword. IMPORTANT: Before making any architectural or design decision, search first to check if a related decision already exists. Contradicting a past decision without checking is a common failure mode after compaction or context loss. Also useful when you encounter unfamiliar project context, file structures, or naming conventions that may have been established in prior sessions.",
    {
      query: z.string().describe("Search keywords"),
      scope: z
        .enum(["decisions", "tasks", "all"])
        .optional()
        .describe("Search scope (default: all)"),
      limit: z.number().optional().describe("Max results (default: 5)"),
      project: z.string().optional().describe("Filter by project"),
    },
    async ({ query, scope, limit, project }) => {
      await logCall("search_memory", `query="${query}"`);
      try {
        const result = await store.searchMemory({
          agent_id: AGENT_ID,
          query,
          scope,
          limit,
          project: project || PROJECT,
        });

        const total = result.decisions.length + result.task_states.length;
        if (total === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `🔍 search_memory: "${query}" — no results`,
              },
            ],
          };
        }

        const parts: string[] = [];
        parts.push(`🔍 search_memory: "${query}" — ${total} results\n`);

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
        }

        return {
          content: [{ type: "text" as const, text: parts.join("\n") }],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `❌ Failed to search memory: ${err}` },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── recover_context ───────────────────────────────────────────
  server.tool(
    "recover_context",
    "Restore current task at session start. Returns only the most recent in-progress task (~100 tokens). Called automatically by SessionStart hook. Use search_memory to look up past decisions as needed during work.",
    {
      project: z.string().optional().describe("Filter by project"),
    },
    async ({ project }) => {
      await logCall("recover_context", `project="${project || PROJECT || ""}"`);
      try {
        const taskStates = await store.getTaskStates({
          agent_id: AGENT_ID,
          project: project || PROJECT,
          limit: 1,
          status: "in_progress",
        });

        const parts: string[] = [];

        parts.push(`⚡ SESSION BOOT — agent-memory (${AGENT_ID})`);
        if (project || PROJECT) parts.push(`Project: ${project || PROJECT}`);
        parts.push("");

        if (taskStates.length > 0) {
          parts.push("── CURRENT WORK ──");
          const t = taskStates[0];
          parts.push(`🔧 [${t.status}] ${t.task}`);
          if (t.progress) parts.push(`  Progress: ${t.progress}`);
          if (t.next_steps) parts.push(`  Next: ${t.next_steps}`);
          if (t.files_modified.length)
            parts.push(`  Files: ${t.files_modified.join(", ")}`);
        } else {
          parts.push("No in-progress tasks.");
        }

        parts.push("");
        parts.push("Use search_memory to find past decisions when needed.");

        return {
          content: [{ type: "text" as const, text: parts.join("\n") }],
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

  // ─── Start server ──────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[agent-memory] MCP server running on stdio");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await store.close();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await store.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[agent-memory] Fatal error:", err);
  process.exit(1);
});
