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
import { generateRestartPack } from "./restart-pack.js";

const AGENT_ID = process.env.AGENT_MEMORY_AGENT_ID || "default";
const PROJECT = process.env.AGENT_MEMORY_PROJECT || undefined;
const SESSION_ID = process.env.CLAUDE_SESSION_ID || `boot-${Date.now()}`;

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

    // Load per-agent config from DB. AM-015: if no row exists yet, persist
    // a default row so future admin operations (set_recovery_config etc.)
    // see a real record instead of NULL. The DEFAULT_RECOVERY_CONFIG values
    // are the OSS baseline; watchout-internal seeds live in
    // scripts/seed-watchout.sql.
    let cfg = await store.getRecoveryConfig(AGENT_ID);
    if (!cfg) {
      try {
        cfg = await store.upsertRecoveryConfig({
          agent_id: AGENT_ID,
          max_tokens: DEFAULT_RECOVERY_CONFIG.max_tokens,
          task_states_limit: DEFAULT_RECOVERY_CONFIG.task_states_limit,
          decisions_limit: DEFAULT_RECOVERY_CONFIG.decisions_limit,
          knowledge_limit: DEFAULT_RECOVERY_CONFIG.knowledge_limit,
          messages_limit: DEFAULT_RECOVERY_CONFIG.messages_limit,
        });
        process.stderr.write(
          `[boot] Initialized default recovery_config for ${AGENT_ID}\n`
        );
      } catch (err) {
        // Non-fatal — fall back to in-memory default. Stores that don't
        // persist recovery_config (json-store) will hit this path on every
        // boot, which is fine.
        process.stderr.write(
          `[boot] recovery_config auto-init failed (non-fatal): ${err}\n`
        );
        cfg = { ...DEFAULT_RECOVERY_CONFIG, agent_id: AGENT_ID };
      }
    }

    if (process.env.AGENT_MEMORY_BOOT_MODE === "restart_pack") {
      try {
        const output = await generateRestartPack(store, {
          agent_id: AGENT_ID,
          project: PROJECT,
          max_tokens: cfg.max_tokens,
        });
        await store.logRecoveryQuality({
          agent_id: AGENT_ID,
          session_id: SESSION_ID,
          recovered_tokens: estimateTokens(output),
          task_continued: false,
          notes: JSON.stringify({ source: "restart_pack_boot" }),
        }).catch((err) => {
          process.stderr.write(`[boot] restart_pack logRecoveryQuality failed (non-fatal): ${err}\n`);
          return "";
        });
        console.log(output);
        return;
      } catch (err) {
        process.stderr.write(`[boot] restart_pack failed, falling back to recover_context format: ${err}\n`);
      }
    }

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

    // AM-002 Stage 1: log recovery quality with summary in notes JSON.
    // task_continued is initially false; AM-018 may revise it once we
    // know whether the bot actually picked up the in-progress task.
    try {
      const notes = JSON.stringify({
        source: "boot",
        decisions: decisions.length,
        tasks_in_progress: inProgressTasks.length,
        tasks_completed: completedTasks.length,
        knowledge: knowledgeItems.length,
        messages: messages.length,
        discord_history: discordHistory.length,
      });
      await store.logRecoveryQuality({
        agent_id: AGENT_ID,
        session_id: SESSION_ID,
        recovered_tokens: estimateTokens(output),
        task_continued: false,
        notes,
      });
    } catch (err) {
      // Non-fatal — recovery_quality_log is best-effort
      process.stderr.write(`[boot] logRecoveryQuality failed (non-fatal): ${err}\n`);
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
