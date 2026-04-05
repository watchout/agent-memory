#!/usr/bin/env node
/**
 * SessionStart hook script for agent-memory.
 * Outputs integrated recovery context to stdout.
 * Runs standalone (not as MCP server) — exits after output.
 */
import { createStore } from "./stores/index.js";
import { DEFAULT_RECOVERY_CONFIG, buildRecoveryOutput, estimateTokens } from "./constants.js";
import { ensureMemoryTags } from "./ensure-tags.js";
import { fetchDiscordHistory } from "./discord-history.js";

const AGENT_ID = process.env.AGENT_MEMORY_AGENT_ID || "default";
const PROJECT = process.env.AGENT_MEMORY_PROJECT || undefined;

async function boot() {
  // FEAT-029: Ensure memory-tags.md is installed in ~/.claude/rules/
  await ensureMemoryTags();

  const store = await createStore();

  try {
    // FEAT-037: Expire stale in_progress tasks (7+ days old)
    try {
      const expired = await store.expireStaleTaskStates({ agent_id: AGENT_ID, max_age_days: 7 });
      if (expired > 0) {
        process.stderr.write(`[boot] Expired ${expired} stale tasks\n`);
      }
    } catch {
      // Non-fatal — table or column may not exist yet
    }

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

    // FEAT-026: Fetch Discord history if agent-comms is available
    let discordHistory: string[] = [];
    if (cfg.discord_history_limit > 0 && cfg.discord_channels.length > 0) {
      discordHistory = await fetchDiscordHistory(cfg.discord_channels, cfg.discord_history_limit);
    }

    const output = buildRecoveryOutput({
      agentId: AGENT_ID, project: PROJECT, config: cfg,
      inProgressTasks, completedTasks, decisions, knowledgeItems, messages,
      discordHistory,
    });

    // FEAT-036: Log recovery quality metrics
    const recoveredTokens = estimateTokens(output);
    try {
      await store.logRecoveryQuality({
        agent_id: AGENT_ID,
        session_id: process.env.CLAUDE_SESSION_ID ?? undefined,
        recovered_tokens: recoveredTokens,
      });
    } catch {
      // Non-fatal — table may not exist yet
    }

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
