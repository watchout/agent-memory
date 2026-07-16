import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  ONE_SEAT_FIXTURE_IDS,
  ONE_SEAT_MANIFEST,
  ONE_SEAT_ROOT_GOAL,
  ONE_SEAT_ZERO_EFFECTS,
  buildDeterministicOneSeatCanaryEvidence,
  buildOneSeatCanaryPlan,
  canonicalOneSeatCanaryPlanDigest,
  exactOneSeatCanaryInput,
  verifyOneSeatCanaryEvidence,
} from "./kusabi-one-seat-canary.js";

const plan = buildOneSeatCanaryPlan(exactOneSeatCanaryInput());
assert.equal(plan.status, "ready_dry_run");
assert.equal(plan.mode, "dry-run");
assert.equal(plan.errors.length, 0);
assert.equal(plan.live_execution_authorized, false);
assert.equal(plan.live_execution_performed, false);
assert.equal(plan.live_acceptance_claimed, false);
assert.equal(plan.protected_effect_boundary_reached, false);
assert.deepEqual(plan.counters, ONE_SEAT_ZERO_EFFECTS);
assert.equal(plan.bindings.manifest.canonical_sha256, ONE_SEAT_MANIFEST.canonical_sha256);
assert.equal(plan.bindings.manifest.utf8_bytes, 1855);
assert.equal(plan.bindings.manifest.enabled_row_count, 1);
assert.equal(plan.bindings.manifest.wildcard_target_count, 0);
assert.equal(plan.bindings.manifest.inferred_target_count, 0);
assert.equal(plan.bindings.root_goal.goal_id, ONE_SEAT_ROOT_GOAL.goal_id);
assert.equal(plan.bindings.root_goal.objective_sha256, ONE_SEAT_ROOT_GOAL.objective_sha256);
assert.deepEqual(plan.fixture_contracts.map((item) => item.fixture_id), [...ONE_SEAT_FIXTURE_IDS]);
assert.equal(plan.gate_separation.one_seat_fixture_ids.includes("KUI-020"), false);
assert.deepEqual(plan.gate_separation.fleet_fixture_ids, ["KUI-020"]);
assert.equal(plan.gate_separation.parent_goal_completion_effect, "none");

const repeatedPlan = buildOneSeatCanaryPlan(exactOneSeatCanaryInput());
assert.equal(plan.plan_id, repeatedPlan.plan_id);
assert.equal(canonicalOneSeatCanaryPlanDigest(plan), canonicalOneSeatCanaryPlanDigest(repeatedPlan));

const evidence = buildDeterministicOneSeatCanaryEvidence(plan);
const verification = verifyOneSeatCanaryEvidence(evidence);
assert.equal(verification.ok, true);
assert.equal(verification.status, "pass");
assert.equal(verification.repository_harness_verified, true);
assert.equal(verification.live_acceptance_verified, false);

// KUI-005: normal-exit fresh-session evidence contract.
assert.equal(evidence.cycles[0].kind, "normal_exit");
assert.equal(evidence.cycles[0].user_context_restatement_count, 0);
assert.equal(evidence.cycles[0].required_manifest_field_match_rate, 1);
assert.equal(evidence.cycles[0].score, 26);
assert.equal(evidence.cycles[0].first_recovery_outcome, "full");
assert.equal(evidence.cycles[0].task_continued_recorded, true);

// KUI-006: planned-crash safe-boundary evidence contract.
assert.equal(evidence.cycles[1].kind, "planned_crash_safe_boundary");
assert.equal(evidence.cycles[1].supported_source_backlog_after_sync, 0);
assert.equal(evidence.cycles[1].duplicate_effect_count, 0);
assert.equal(evidence.cycles[1].safe_boundary_declared, true);

// KUI-015: exact two-cycle internal-gate thresholds.
assert.equal(verification.consecutive_run_count, 2);
assert.equal(verification.minimum_score, 26);
assert.equal(verification.user_context_restatement_count, 0);
assert.equal(verification.required_manifest_field_match_rate, 1);
assert(evidence.cycles.every((cycle) => cycle.correct_identity_rate === 1));

// KUI-017: only the existing Kusabi root Goal is bound; no Goal API mutation occurs.
assert.equal(evidence.root_goal.goal_id, ONE_SEAT_ROOT_GOAL.goal_id);
assert.equal(evidence.root_goal.objective_sha256, ONE_SEAT_ROOT_GOAL.objective_sha256);
assert.equal(evidence.root_goal.durable_goal_readback_present, true);
assert.equal(evidence.counters.other_agent_goal_api_mutation_count, 0);
assert.equal(evidence.counters.child_goal_overwrite_count, 0);

// KUI-018: a terminal child returns to the active parent without fake progress/completion.
assert.equal(evidence.root_goal.parent_goal_completed, false);
assert.equal(evidence.root_goal.parent_goal_reloaded, true);
assert.equal(evidence.root_goal.next_unmet_acceptance_selected, true);
assert.equal(evidence.counters.sent_queued_pending_progress_increment, 0);

// KUI-019: two fresh-session records retain the same root and next-action digests.
assert.notEqual(evidence.cycles[0].fresh_session_id, evidence.cycles[1].fresh_session_id);
assert.equal(verification.root_goal_id_match, true);
assert.equal(verification.root_objective_digest_match, true);
assert.equal(evidence.cycles[0].unmet_acceptance_set_digest, evidence.cycles[1].unmet_acceptance_set_digest);
assert.equal(
  evidence.cycles[0].active_child_or_next_action_digest,
  evidence.cycles[1].active_child_or_next_action_digest,
);

// Manifest, root, audit and target drift all fail before protected effects.
const invalidInputs = [
  (input: ReturnType<typeof exactOneSeatCanaryInput>) => { input.manifest.canonical_sha256 = "0".repeat(64); },
  (input: ReturnType<typeof exactOneSeatCanaryInput>) => { input.manifest.utf8_bytes = 1854; },
  (input: ReturnType<typeof exactOneSeatCanaryInput>) => { input.manifest.enabled_row_count = 2; },
  (input: ReturnType<typeof exactOneSeatCanaryInput>) => { input.manifest.wildcard_target_count = 1; },
  (input: ReturnType<typeof exactOneSeatCanaryInput>) => { input.manifest.inferred_target_count = 1; },
  (input: ReturnType<typeof exactOneSeatCanaryInput>) => { input.manifest.row.agent_id = "arc"; },
  (input: ReturnType<typeof exactOneSeatCanaryInput>) => { input.manifest.row.memory_project = "spec"; },
  (input: ReturnType<typeof exactOneSeatCanaryInput>) => { input.manifest.row.workspace_ref = "watchout/spec"; },
  (input: ReturnType<typeof exactOneSeatCanaryInput>) => { input.manifest.row.aun_supervised = true; },
  (input: ReturnType<typeof exactOneSeatCanaryInput>) => { input.manifest.row.auto_restart = true; },
  (input: ReturnType<typeof exactOneSeatCanaryInput>) => { input.root_goal.goal_id = "wrong-goal"; },
  (input: ReturnType<typeof exactOneSeatCanaryInput>) => { input.root_goal.objective_sha256 = "0".repeat(64); },
  (input: ReturnType<typeof exactOneSeatCanaryInput>) => { input.root_goal.terminal = true; },
  (input: ReturnType<typeof exactOneSeatCanaryInput>) => { input.prior_audits.cell_2_verdict = "BLOCK"; },
  (input: ReturnType<typeof exactOneSeatCanaryInput>) => { input.requested_target.agent_id = "arc"; },
];
for (const mutate of invalidInputs) {
  const input = exactOneSeatCanaryInput();
  mutate(input);
  const stopped = buildOneSeatCanaryPlan(input);
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.live_execution_performed, false);
  assert.equal(stopped.protected_effect_boundary_reached, false);
  assert.deepEqual(stopped.counters, ONE_SEAT_ZERO_EFFECTS);
}

// Any live request is stopped under this non-activated handoff.
for (const mode of ["normal-exit", "planned-crash"] as const) {
  const stopped = buildOneSeatCanaryPlan(exactOneSeatCanaryInput(mode));
  assert.equal(stopped.status, "stopped");
  assert(stopped.errors.includes("live_mode_requires_separate_protected_owner_go"));
  assert.equal(stopped.live_execution_performed, false);
  assert.equal(stopped.protected_effect_boundary_reached, false);
  assert.deepEqual(stopped.counters, ONE_SEAT_ZERO_EFFECTS);
}

// Evidence tampering fails closed without turning fixture evidence into a live claim.
const tamperCases: Array<(copy: typeof evidence) => void> = [
  (copy) => { copy.cycles[0].score = 25; },
  (copy) => { copy.cycles[0].user_context_restatement_count = 1; },
  (copy) => { copy.cycles[1].required_manifest_field_match_rate = 0.99; },
  (copy) => { copy.cycles[0].first_recovery_outcome = "blocked" as "full"; },
  (copy) => { copy.cycles[1].safe_boundary_declared = false; },
  (copy) => { copy.cycles[1].root_goal_id = "wrong-goal"; },
  (copy) => { copy.root_goal.parent_goal_completed = true as false; },
  (copy) => { copy.live_execution_performed = true as false; },
  (copy) => { copy.counters = { ...copy.counters, queue_mutation_count: 1 }; },
  (copy) => { copy.plan.gate_separation.one_seat_fixture_ids.push("KUI-020"); },
];
for (const tamper of tamperCases) {
  const copy = structuredClone(evidence);
  tamper(copy);
  assert.equal(verifyOneSeatCanaryEvidence(copy).ok, false);
}

// Independent audit regression: all protected counters are an exact, numeric, zero-valued schema.
const missingCounters = structuredClone(evidence);
missingCounters.plan.counters = {} as typeof missingCounters.plan.counters;
missingCounters.counters = {} as typeof missingCounters.counters;
missingCounters.plan_digest = canonicalOneSeatCanaryPlanDigest(missingCounters.plan);
assert.equal(verifyOneSeatCanaryEvidence(missingCounters).ok, false);

const extraCounter = structuredClone(evidence);
(extraCounter.plan.counters as Record<string, number>).unapproved_effect_count = 0;
(extraCounter.counters as Record<string, number>).unapproved_effect_count = 0;
extraCounter.plan_digest = canonicalOneSeatCanaryPlanDigest(extraCounter.plan);
assert.equal(verifyOneSeatCanaryEvidence(extraCounter).ok, false);

const nonnumericCounter = structuredClone(evidence);
(nonnumericCounter.plan.counters as unknown as Record<string, unknown>).queue_mutation_count = "0";
(nonnumericCounter.counters as unknown as Record<string, unknown>).queue_mutation_count = "0";
nonnumericCounter.plan_digest = canonicalOneSeatCanaryPlanDigest(nonnumericCounter.plan);
assert.equal(verifyOneSeatCanaryEvidence(nonnumericCounter).ok, false);

// Independent audit regression: nested live/protected flags cannot contradict dry-run evidence.
const protectedFlags = structuredClone(evidence);
const mutableProtectedPlan = protectedFlags.plan as unknown as Record<string, unknown>;
mutableProtectedPlan.live_execution_authorized = true;
mutableProtectedPlan.live_execution_performed = true;
mutableProtectedPlan.protected_effect_boundary_reached = true;
protectedFlags.plan_digest = canonicalOneSeatCanaryPlanDigest(protectedFlags.plan);
assert.equal(verifyOneSeatCanaryEvidence(protectedFlags).ok, false);

// Independent audit regression: exact gate identities and fixture memberships cannot collapse.
const collapsedGates = structuredClone(evidence);
const mutableGate = collapsedGates.plan.gate_separation as unknown as Record<string, unknown>;
mutableGate.one_seat_gate_id = collapsedGates.plan.gate_separation.fleet_gate_id;
mutableGate.one_seat_fixture_ids = [];
collapsedGates.plan_digest = canonicalOneSeatCanaryPlanDigest(collapsedGates.plan);
assert.equal(verifyOneSeatCanaryEvidence(collapsedGates).ok, false);

// Independent audit regression: the root Goal stays bound to its exact durable active tuple.
const terminalRoot = structuredClone(evidence);
terminalRoot.plan.bindings.root_goal.lifecycle_state = "TERMINAL";
terminalRoot.plan.bindings.root_goal.terminal = true;
terminalRoot.plan.bindings.root_goal.durable_readback_url = "https://github.com/forged/ref";
terminalRoot.plan_digest = canonicalOneSeatCanaryPlanDigest(terminalRoot.plan);
assert.equal(verifyOneSeatCanaryEvidence(terminalRoot).ok, false);

// The exact wrapper defaults to dry-run and stops live modes before invoking TypeScript.
const shellDryRun = spawnSync("bash", [
  "scripts/kusabi-one-seat-canary.sh",
  "--mode", "dry-run",
  "--manifest-sha256", ONE_SEAT_MANIFEST.canonical_sha256,
  "--agent-id", "kusabi",
  "--project", "agent-memory",
  "--workspace-ref", "watchout/agent-memory",
], { encoding: "utf8" });
assert.equal(shellDryRun.status, 0, shellDryRun.stderr);
const shellDryRunOutput = JSON.parse(shellDryRun.stdout) as { verification: { ok: boolean; live_acceptance_verified: boolean } };
assert.equal(shellDryRunOutput.verification.ok, true);
assert.equal(shellDryRunOutput.verification.live_acceptance_verified, false);

const shellLiveStop = spawnSync("bash", [
  "scripts/kusabi-one-seat-canary.sh",
  "--mode", "planned-crash",
  "--manifest-sha256", ONE_SEAT_MANIFEST.canonical_sha256,
  "--agent-id", "kusabi",
  "--project", "agent-memory",
  "--workspace-ref", "watchout/agent-memory",
], { encoding: "utf8" });
assert.equal(shellLiveStop.status, 3);
const shellStopOutput = JSON.parse(shellLiveStop.stdout) as {
  status: string;
  live_execution_performed: boolean;
  counters: typeof ONE_SEAT_ZERO_EFFECTS;
};
assert.equal(shellStopOutput.status, "stopped");
assert.equal(shellStopOutput.live_execution_performed, false);
assert.deepEqual(shellStopOutput.counters, ONE_SEAT_ZERO_EFFECTS);

console.log("KUI-005 PASS normal-exit deterministic fresh-session contract");
console.log("KUI-006 PASS planned-crash safe-boundary deterministic contract");
console.log("KUI-015 PASS two-cycle score/restatement/identity thresholds");
console.log("KUI-017 PASS exact Kusabi root Goal binding with zero Goal API mutation");
console.log("KUI-018 PASS child terminal returns to active parent without fake progress");
console.log("KUI-019 PASS session/provider-switch root tuple preservation contract");
console.log("KUI-EVIDENCE-COUNTER-COMPLETENESS-001 BLOCK missing/extra/nonnumeric counters");
console.log("KUI-PROTECTED-PLAN-FLAGS-001 BLOCK contradictory protected plan flags");
console.log("KUI-GATE-SEPARATION-VERIFIER-001 BLOCK collapsed gate identities and fixture set");
console.log("KUI-ROOT-GOAL-LIFECYCLE-001 BLOCK terminal/substituted root tuple");
console.log("PROTECTED STOP PASS live modes exit before every effect");
console.log("kusabi one-seat canary tests passed");
