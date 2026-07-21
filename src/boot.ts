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
import { redactText } from "./redact.js";
import {
  consumeVerifiedContinuationPack,
  isContinuationRecoveryPack,
} from "./kusabi-checkpoint-recovery.js";

const AGENT_ID = process.env.AGENT_MEMORY_AGENT_ID || "default";
const PROJECT = process.env.AGENT_MEMORY_PROJECT || undefined;
const SESSION_ID = process.env.CLAUDE_SESSION_ID || `boot-${Date.now()}`;
const STARTUP_BRIDGE = process.env.AGENT_MEMORY_STARTUP_BRIDGE;
const CLAUDE_HOOK_JSON = process.env.AGENT_MEMORY_CLAUDE_HOOK_JSON === "1";

function emitRecoveryOutput(output: string): void {
  if (CLAUDE_HOOK_JSON) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: output,
      },
    }));
    return;
  }
  console.log(output);
}

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
      const selectedPackRef = process.env.AGENT_MEMORY_SELECTED_PACK_REF;
      try {
        const selectedCandidate = selectedPackRef
          ? await store.getSelectedRestartPack({
              agent_id: AGENT_ID,
              project: PROJECT,
              pack_ref: selectedPackRef,
            })
          : null;
        let selectedPack = null;
        let continuationCheckpointDigest: string | undefined;
        let rawOutput: string;
        if (selectedCandidate && isContinuationRecoveryPack(selectedCandidate.content, selectedCandidate.metadata)) {
          const consumed = await consumeVerifiedContinuationPack(store, {
            agent_id: AGENT_ID,
            project: PROJECT,
            pack_ref: selectedPackRef!,
          });
          if (consumed.outcome !== "full" || consumed.payload === undefined) {
            throw new Error(`CONTINUATION_RECOVERY_BLOCKED:${consumed.error ?? "verification_failed"}`);
          }
          selectedPack = selectedCandidate;
          continuationCheckpointDigest = consumed.checkpoint_digest;
          rawOutput = consumed.payload;
        } else if (selectedPackRef) {
          selectedPack = await store.consumeSelectedRestartPack({
            agent_id: AGENT_ID,
            project: PROJECT,
            pack_ref: selectedPackRef,
          });
          if (!selectedPack) throw new Error("SELECTED_RESTART_PACK_MISSING_OR_CONSUMED");
          rawOutput = selectedPack.content;
        } else {
          rawOutput = await generateRestartPack(store, {
            agent_id: AGENT_ID,
            project: PROJECT,
            max_tokens: cfg.max_tokens,
          });
        }
        const output = redactText(rawOutput).text;
        await store.logRecoveryQuality({
          agent_id: AGENT_ID,
          session_id: SESSION_ID,
          recovered_tokens: estimateTokens(output),
          notes: JSON.stringify({
            source: "restart_pack_boot",
            host_adapter: "claude_code_session_start",
            host_adapter_level: 2,
            fresh_session_id: SESSION_ID,
            startup_bridge: STARTUP_BRIDGE,
            recovery_deadline_ms: 60_000,
            automatic_restart: false,
            selected_pack_ref: selectedPack?.pack_ref,
            selected_pack_consumed: selectedPack ? true : undefined,
            continuation_checkpoint_digest: continuationCheckpointDigest,
          }),
        }).catch((err) => {
          process.stderr.write(redactText(`[boot] restart_pack logRecoveryQuality failed (non-fatal): ${err}\n`).text);
          return "";
        });
        emitRecoveryOutput(output);
        return;
      } catch (err) {
        if (selectedPackRef) {
          process.stderr.write(redactText(`[boot] continuation recovery blocked: ${err}\n`).text);
          emitRecoveryOutput(JSON.stringify({
            schema_version: "kusabi-continuation-recovery-readback/v1",
            recovery_outcome: "blocked",
            continuity_pass_claimed: false,
            fresh_session_id: SESSION_ID,
            selected_pack_ref: selectedPackRef,
            automatic_effect_count: 0,
            queue_mutation_count: 0,
            runtime_restart_count: 0,
          }));
          return;
        }
        process.stderr.write(redactText(`[boot] restart_pack failed, falling back to recover_context format: ${err}\n`).text);
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

    // Log recovery quality with summary in notes JSON. Continuation is
    // unknown at boot time and must be filled by a later host observation;
    // writing false here would turn "not observed yet" into a failure.
    try {
      const notes = JSON.stringify({
        source: "boot",
        host_adapter: "claude_code_session_start",
        host_adapter_level: 2,
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
        notes,
      });
    } catch (err) {
      // Non-fatal — recovery_quality_log is best-effort
      process.stderr.write(redactText(`[boot] logRecoveryQuality failed (non-fatal): ${err}\n`).text);
    }

    // Output to stdout — hook output is injected into session context
    emitRecoveryOutput(output);
  } finally {
    await store.close();
  }
}

boot().catch((err) => {
  console.error(redactText(`[agent-memory boot] Error: ${err}`).text);
  process.exit(1);
});
