#!/usr/bin/env node
/**
 * SessionStart hook script for agent-memory.
 * Outputs integrated recovery context to stdout.
 * Runs standalone (not as MCP server) — exits after output.
 */
import { createStore } from "./stores/index.js";

const AGENT_ID = process.env.AGENT_MEMORY_AGENT_ID || "default";
const PROJECT = process.env.AGENT_MEMORY_PROJECT || undefined;

// Default limits (FEAT-015 will make these configurable via recovery_config table)
const RECOVERY_LIMITS = {
  task_states: 3,   // in_progress 1 + completed 2
  decisions: 5,
  knowledge: 5,
  messages: 10,
};

async function boot() {
  const store = await createStore();

  try {
    const [inProgressTasks, completedTasks, decisions, knowledgeItems, messages] = await Promise.all([
      store.getTaskStates({
        agent_id: AGENT_ID,
        project: PROJECT,
        limit: 1,
        status: "in_progress",
      }),
      store.getTaskStates({
        agent_id: AGENT_ID,
        project: PROJECT,
        limit: 2,
        status: "completed",
      }),
      store.getDecisions({
        agent_id: AGENT_ID,
        project: PROJECT,
        limit: RECOVERY_LIMITS.decisions,
        status: "active",
      }),
      store.getKnowledge({
        agent_id: AGENT_ID,
        project: PROJECT,
        limit: RECOVERY_LIMITS.knowledge,
        status: "active",
      }),
      store.getRecentMessages({
        agent_id: AGENT_ID,
        project: PROJECT,
        limit: RECOVERY_LIMITS.messages,
      }),
    ]);

    const parts: string[] = [];
    parts.push(`⚡ SESSION BOOT — agent-memory (${AGENT_ID})`);
    if (PROJECT) parts.push(`Project: ${PROJECT}`);
    parts.push("");

    // Task states: in_progress + recent completed
    if (inProgressTasks.length > 0 || completedTasks.length > 0) {
      parts.push("── CURRENT WORK ──");
      for (const t of inProgressTasks) {
        parts.push(`🔧 [${t.status}] ${t.task}`);
        if (t.progress) parts.push(`  Progress: ${t.progress}`);
        if (t.next_steps) parts.push(`  Next: ${t.next_steps}`);
        if (t.files_modified.length)
          parts.push(`  Files: ${t.files_modified.join(", ")}`);
      }
      for (const t of completedTasks) {
        parts.push(`✅ [completed] ${t.task}`);
      }
      parts.push("");
    } else {
      parts.push("No in-progress tasks.");
      parts.push("");
    }

    // Decisions (Layer 1)
    if (decisions.length > 0) {
      parts.push("── ACTIVE DECISIONS ──");
      for (const d of decisions) {
        parts.push(`• ${d.decision}`);
      }
      parts.push("");
    }

    // Knowledge (Layer 2)
    if (knowledgeItems.length > 0) {
      parts.push("── KEY KNOWLEDGE ──");
      for (const k of knowledgeItems) {
        parts.push(`• ${k.title}`);
      }
      parts.push("");
    }

    // Messages (com integration)
    if (messages.length > 0) {
      parts.push("── RECENT MESSAGES ──");
      for (const m of messages) {
        const ts = m.created_at.replace(/T/, " ").replace(/\.\d+Z$/, "");
        parts.push(`[${ts}] ${m.author_id}: ${m.content.slice(0, 200)}`);
      }
      parts.push("");
    }

    parts.push("Use search_memory to find past decisions when needed.");

    // Output to stdout — hook output is injected into session context
    console.log(parts.join("\n"));
  } finally {
    await store.close();
  }
}

boot().catch((err) => {
  console.error("[agent-memory boot] Error:", err);
  process.exit(1);
});
