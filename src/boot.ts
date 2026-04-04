#!/usr/bin/env node
/**
 * SessionStart hook script for agent-memory.
 * Outputs integrated recovery context to stdout.
 * Runs standalone (not as MCP server) — exits after output.
 */
import { createStore } from "./stores/index.js";
import { DEFAULT_RECOVERY_CONFIG, buildRecoveryOutput } from "./constants.js";
import { ensureMemoryTags } from "./ensure-tags.js";

const AGENT_ID = process.env.AGENT_MEMORY_AGENT_ID || "default";
const PROJECT = process.env.AGENT_MEMORY_PROJECT || undefined;

async function boot() {
  // FEAT-029: Ensure memory-tags.md is installed in ~/.claude/rules/
  await ensureMemoryTags();

  const store = await createStore();

  try {
    // Load per-agent config from DB, fall back to defaults
    const dbConfig = await store.getRecoveryConfig(AGENT_ID);
    const cfg = dbConfig ?? { ...DEFAULT_RECOVERY_CONFIG, agent_id: AGENT_ID };

    const [inProgressTasks, completedTasks, decisions, knowledgeItems, messages] = await Promise.all([
      store.getTaskStates({ agent_id: AGENT_ID, project: PROJECT, limit: 1, status: "in_progress" }),
      store.getTaskStates({ agent_id: AGENT_ID, project: PROJECT, limit: Math.max(cfg.task_states_limit - 1, 0), status: "completed" }),
      store.getDecisions({ agent_id: AGENT_ID, project: PROJECT, limit: cfg.decisions_limit, status: "active" }),
      store.getKnowledge({ agent_id: AGENT_ID, project: PROJECT, limit: cfg.knowledge_limit, status: "active" }),
      store.getRecentMessages({ agent_id: AGENT_ID, project: PROJECT, limit: cfg.messages_limit }),
    ]);

    const output = buildRecoveryOutput({
      agentId: AGENT_ID, project: PROJECT, config: cfg,
      inProgressTasks, completedTasks, decisions, knowledgeItems, messages,
    });

    // Output to stdout — hook output is injected into session context
    console.log(output);
  } finally {
    await store.close();
  }
}

boot().catch((err) => {
  console.error("[agent-memory boot] Error:", err);
  process.exit(1);
});
