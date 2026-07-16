import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildContinuationCheckpoint,
  buildContinuationRecoveryPack,
  canonicalCheckpointDigest,
  consumeVerifiedContinuationPack,
  verifyContinuationCheckpoint,
  verifyContinuationRecoveryPack,
  type ContinuationCheckpointInput,
} from "./kusabi-checkpoint-recovery.js";
import { SqliteStore } from "./stores/sqlite-store.js";
import { prepareRestart } from "./restart-prepare.js";

const priorSessionId = "session-prior-001";
const baseInput: ContinuationCheckpointInput = {
  identity: {
    agent_id: "kusabi",
    memory_project: "agent-memory",
    workspace_ref: "watchout/agent-memory",
    workspace_path_hash: "1".repeat(64),
    host: "codex",
    adapter: "verified_codex_startup_bridge",
    lifecycle_owner: "user_host",
    runtime_commit_sha: "6e85144e4ec22f24d51cf1975c7d0448485df4b7",
    runtime_artifact_digest: "2".repeat(64),
    config_digest: "3".repeat(64),
  },
  tasks: [
    {
      id: "task-current",
      status: "in_progress",
      task: "Implement checkpoint recovery",
      next_steps: "Verify and consume exactly once",
      files_modified: ["src/restart-prepare.ts"],
      updated_at: "2026-07-16T00:03:00.000Z",
    },
    {
      id: "task-blocked",
      status: "blocked",
      task: "Await external evidence",
      progress: "Independent audit required",
      files_modified: [],
      updated_at: "2026-07-16T00:02:00.000Z",
    },
  ],
  decisions: [
    {
      id: "decision-current",
      status: "active",
      decision: "Use selected_restart_packs CAS",
      created_at: "2026-07-16T00:03:00.000Z",
    },
  ],
  knowledge: [
    {
      id: "knowledge-current",
      status: "active",
      updated_at: "2026-07-16T00:03:00.000Z",
    },
  ],
  artifact_refs: ["issue:180", "pr:255"],
  visible_events: [
    {
      id: "event-2",
      content_digest: "4".repeat(64),
      occurred_at: "2026-07-16T00:02:00.000Z",
    },
    {
      id: "event-1",
      content_digest: "5".repeat(64),
      occurred_at: "2026-07-16T00:01:00.000Z",
    },
  ],
  repo: {
    repository: "watchout/agent-memory",
    branch: "agent/kusabi-checkpoint-recovery-20260716",
    head_sha: "6e85144e4ec22f24d51cf1975c7d0448485df4b7",
    dirty_paths: ["src/restart-prepare.ts", "src/test-kusabi-checkpoint-recovery.ts"],
    diff_material: "diff --git a/src/restart-prepare.ts b/src/restart-prepare.ts\n",
  },
  effects: [],
  recovery: {
    prior_session_id: priorSessionId,
    saved_source_cursor: "2026-07-16T00:00:00.000Z",
    supported_source_backlog_after_sync: 0,
    duplicate_raw_events: 0,
    confidence: 1,
    missing_context: [],
    pack_content_digest: "6".repeat(64),
  },
  suite: {
    aun_supervised: false,
    queue_refs: [],
    mutation_allowed: false,
  },
};

async function run(): Promise<void> {
  // KUI-003: append-only visible source projection is current and duplicate-free.
  const incremental = buildContinuationCheckpoint({
    ...baseInput,
    visible_events: [...baseInput.visible_events, baseInput.visible_events[0]],
  });
  assert.deepEqual(incremental.work.recent_visible_event_ids, ["event-2", "event-1"]);
  assert.deepEqual(incremental.recovery.source_event_ids, ["event-2", "event-1"]);
  assert.equal(incremental.recovery.source_cursor, "2026-07-16T00:02:00.000Z");
  assert.equal(incremental.recovery.source_cursor_before, "2026-07-16T00:00:00.000Z");
  assert.equal(new Set(incremental.recovery.source_event_ids).size, 2);
  assert.equal(verifyContinuationCheckpoint(incremental).supported_source_backlog_after_sync, 0);
  const backlogCheckpoint = buildContinuationCheckpoint({
    ...baseInput,
    recovery: { ...baseInput.recovery, supported_source_backlog_after_sync: 1 },
  });
  const backlogVerification = verifyContinuationCheckpoint(backlogCheckpoint);
  assert.equal(backlogVerification.ok, false);
  assert.equal(backlogVerification.supported_source_backlog_after_sync, 1);

  // KUI-004: every required continuation field is present and digest-stable.
  const checkpoint = buildContinuationCheckpoint(baseInput);
  const complete = verifyContinuationCheckpoint(checkpoint, {
    expected_digest: canonicalCheckpointDigest(checkpoint),
    expected_dirty_paths: baseInput.repo.dirty_paths,
    expected_diff_digest: checkpoint.repo.diff_digest,
  });
  assert.equal(complete.ok, true);
  assert.equal(complete.required_manifest_field_match_rate, 1);
  assert.equal(complete.source_refs_nonempty, true);
  assert.equal(complete.dirty_path_set_match_rate, 1);
  assert.equal(complete.diff_digest_match, true);
  assert.match(checkpoint.recovery.checkpoint_id, /^checkpoint:[0-9a-f]{64}$/);
  assert.match(checkpoint.recovery.pack_id, /^continuation_pack:[0-9a-f]{64}$/);

  const persistRoot = mkdtempSync(join(tmpdir(), "kusabi-checkpoint-persist-"));
  const persistStore = new SqliteStore(join(persistRoot, "memory.db"));
  await persistStore.initialize();
  try {
    await persistStore.saveTaskState({
      agent_id: "kusabi",
      project: "agent-memory",
      task_id: "task-current",
      task: "Implement checkpoint recovery",
      status: "in_progress",
      next_steps: "Verify and consume exactly once",
      files_modified: ["src/restart-prepare.ts"],
    });
    await persistStore.logDecision({
      agent_id: "kusabi",
      project: "agent-memory",
      decision: "Use selected_restart_packs CAS",
    });
    await persistStore.saveKnowledge({
      agent_id: "kusabi",
      project: "agent-memory",
      title: "Checkpoint boundary",
      content: "No schema or migration change",
      source_type: "manual",
    });
    await persistStore.saveConversationEvent({
      agent_id: "kusabi",
      project: "agent-memory",
      source: "codex",
      source_event_id: "event-current",
      role: "user",
      content: "Continue the exact checkpoint cell",
      occurred_at: "2026-07-16T00:04:00.000Z",
    });
    const prepared = await prepareRestart(persistStore, {
      agent_id: "kusabi",
      project: "agent-memory",
      continuity_guard_mode: "pack_only",
      emit_pack: false,
      continuation_checkpoint: {
        identity: baseInput.identity,
        repo: baseInput.repo,
        effects: [],
        prior_session_id: priorSessionId,
        saved_source_cursor: "2026-07-16T00:00:00.000Z",
        source_sync: {
          supported_source_backlog_after_sync: 0,
          duplicate_raw_events: 0,
        },
        suite: baseInput.suite,
        artifact_refs: ["issue:180", "pr:255"],
      },
    });
    assert(prepared.pack_ref);
    assert(prepared.continuation_checkpoint);
    const persisted = await persistStore.getSelectedRestartPack({
      agent_id: "kusabi",
      project: "agent-memory",
      pack_ref: prepared.pack_ref,
    });
    assert(persisted);
    const persistedVerification = verifyContinuationRecoveryPack(persisted.content, persisted.metadata);
    assert.equal(persistedVerification.ok, true);
    assert.equal(
      persistedVerification.pack?.checkpoint.recovery.checkpoint_id,
      prepared.continuation_checkpoint.checkpoint_id,
    );
  } finally {
    await persistStore.close();
    rmSync(persistRoot, { recursive: true, force: true });
  }

  // KUI-007: stale completed and superseded records are never selected current.
  const filtered = buildContinuationCheckpoint({
    ...baseInput,
    tasks: [
      ...baseInput.tasks,
      {
        id: "task-newer-completed",
        status: "completed",
        task: "Unrelated completed task",
        files_modified: [],
        updated_at: "2026-07-16T00:05:00.000Z",
      },
      {
        id: "task-stale",
        status: "expired",
        task: "Stale task",
        files_modified: [],
        updated_at: "2026-06-01T00:00:00.000Z",
      },
    ],
    decisions: [
      ...baseInput.decisions,
      {
        id: "decision-superseded",
        status: "superseded",
        decision: "Old decision",
        created_at: "2026-07-16T00:04:00.000Z",
      },
    ],
  });
  assert.deepEqual(filtered.work.active_task_ids, ["task-current"]);
  assert.deepEqual(filtered.work.decisions.map((item) => item.id), ["decision-current"]);
  assert(filtered.work.suppression_reasons.some((item) => item.id === "task-newer-completed"));
  assert(filtered.work.suppression_reasons.some((item) => item.id === "decision-superseded"));

  // KUI-008: exact dirty path set and diff digest are retained without file content.
  assert.deepEqual(checkpoint.repo.dirty_paths, [
    "src/restart-prepare.ts",
    "src/test-kusabi-checkpoint-recovery.ts",
  ]);
  assert.match(checkpoint.repo.diff_digest, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(checkpoint).includes("diff --git"), false);
  assert.equal(
    verifyContinuationCheckpoint(checkpoint, { expected_dirty_paths: ["wrong-path"] }).ok,
    false,
  );

  // KUI-009: an unknown in-flight effect can never auto-replay.
  const unknownEffect = buildContinuationCheckpoint({
    ...baseInput,
    effects: [
      {
        effect_id: "effect-unknown",
        status: "unknown",
        source_ref: "tool:external-send",
      },
    ],
  });
  const unknownVerification = verifyContinuationCheckpoint(unknownEffect);
  assert.equal(unknownVerification.ok, true);
  assert.equal(unknownEffect.effects.replay_policy.unknown, "never_auto_replay");
  assert.equal(unknownVerification.counters.automatic_replay_count, 0);
  assert(unknownVerification.operator_warnings.includes("unknown_effect:effect-unknown"));
  const replayTamper = structuredClone(unknownEffect);
  replayTamper.effects.replay_policy.unknown = "operator_or_next_action_may_start" as "never_auto_replay";
  assert.equal(verifyContinuationCheckpoint(replayTamper).ok, false);

  // KUI-010: the existing selected_restart_packs CAS permits one consumer only.
  const dbRoot = mkdtempSync(join(tmpdir(), "kusabi-checkpoint-cas-"));
  const store = new SqliteStore(join(dbRoot, "memory.db"));
  await store.initialize();
  try {
    const recoveryPack = buildContinuationRecoveryPack(checkpoint, "verified recovery payload");
    assert.equal(verifyContinuationRecoveryPack(recoveryPack.canonical_json, {}).ok, false);
    const selected = await store.saveSelectedRestartPack({
      agent_id: "kusabi",
      project: "agent-memory",
      content: recoveryPack.canonical_json,
      metadata: recoveryPack.metadata,
    });
    const results = await Promise.all([
      consumeVerifiedContinuationPack(store, {
        agent_id: "kusabi",
        project: "agent-memory",
        pack_ref: selected.pack_ref,
      }),
      consumeVerifiedContinuationPack(store, {
        agent_id: "kusabi",
        project: "agent-memory",
        pack_ref: selected.pack_ref,
      }),
    ]);
    assert.equal(results.filter((item) => item.outcome === "full").length, 1);
    assert.equal(results.filter((item) => item.outcome === "blocked").length, 1);
    assert.equal(results.reduce((sum, item) => sum + item.counters.duplicate_launch_effect_count, 0), 0);
  } finally {
    await store.close();
    rmSync(dbRoot, { recursive: true, force: true });
  }

  // KUI-012: database failure is blocked/degraded and never claims continuity PASS.
  const unavailable = await consumeVerifiedContinuationPack(
    {
      consumeSelectedRestartPack: async () => {
        throw new Error("database unavailable");
      },
    },
    { agent_id: "kusabi", project: "agent-memory", pack_ref: "selected_restart_pack:missing" },
  );
  assert.equal(unavailable.outcome, "blocked");
  assert.equal(unavailable.continuity_pass_claimed, false);
  assert.equal(unavailable.counters.automatic_effect_count, 0);

  // KUI-013: AUN-owned lifecycle is evidence only; no queue or restart mutation occurs.
  const aunOwned = buildContinuationCheckpoint({
    ...baseInput,
    identity: { ...baseInput.identity, lifecycle_owner: "aun" },
    suite: {
      aun_supervised: true,
      queue_refs: ["queue:128113"],
      mutation_allowed: false,
    },
  });
  const aunVerification = verifyContinuationCheckpoint(aunOwned);
  assert.equal(aunVerification.ok, true);
  assert.equal(aunOwned.identity.lifecycle_owner, "aun");
  assert.equal(aunVerification.counters.kusabi_queue_mutation_count, 0);
  assert.equal(aunVerification.counters.kusabi_runtime_restart_count, 0);

  console.log("KUI-003 PASS incremental source sync");
  console.log("KUI-004 PASS checkpoint completeness");
  console.log("KUI-007 PASS stale and superseded suppression");
  console.log("KUI-008 PASS dirty worktree digest-only recovery");
  console.log("KUI-009 PASS unknown effect never auto-replays");
  console.log("KUI-010 PASS selected pack single consume CAS");
  console.log("KUI-012 PASS database unavailable blocks continuity claim");
  console.log("KUI-013 PASS AUN supervision boundary is mutation-free");
  console.log("kusabi checkpoint recovery tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
