import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  ONE_SEAT_FIXTURE_IDS,
  ONE_SEAT_MANIFEST,
  ONE_SEAT_PROBE_DIMENSION_IDS,
  ONE_SEAT_ROOT_GOAL,
  ONE_SEAT_ZERO_EFFECTS,
  buildDeterministicOneSeatCanaryEvidence,
  buildOneSeatCanaryPlan,
  canonicalOneSeatCanaryPlanDigest,
  canonicalOneSeatProbeReceiptDigest,
  evaluateOneSeatCycleTwoGate,
  exactOneSeatCanaryInput,
  exactOneSeatRecoveryExpectation,
  verifyOneSeatCanaryEvidence,
  verifyOneSeatProbeReceipt,
  verifyOneSeatRecoveryContext,
  type OneSeatProbeReceipt,
  type OneSeatRecoveryContextReadback,
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
  machine_probe_receipt_required: boolean;
  deterministic_fixture_eligible_for_live_acceptance: boolean;
  cycle_2_authorized: boolean;
  counters: typeof ONE_SEAT_ZERO_EFFECTS;
};
assert.equal(shellStopOutput.status, "stopped");
assert.equal(shellStopOutput.live_execution_performed, false);
assert.equal(shellStopOutput.machine_probe_receipt_required, true);
assert.equal(shellStopOutput.deterministic_fixture_eligible_for_live_acceptance, false);
assert.equal(shellStopOutput.cycle_2_authorized, false);
assert.deepEqual(shellStopOutput.counters, ONE_SEAT_ZERO_EFFECTS);

// R2 post-run correction: machine context read-back must bind every current tuple field.
const recoveryExpectation = exactOneSeatRecoveryExpectation("1".repeat(40), "2".repeat(40));
const exactContext = (): OneSeatRecoveryContextReadback => ({
  schema_version: "kusabi-one-seat-recovery-context/v1",
  evidence_kind: "machine_readback",
  current_task: {
    status: "current",
    cell_id: recoveryExpectation.cell_id,
  },
  exact_head_sha: recoveryExpectation.exact_head_sha,
  exact_head_tree: recoveryExpectation.exact_head_tree,
  manifest: structuredClone(recoveryExpectation.manifest),
  root_goal: structuredClone(recoveryExpectation.root_goal),
  target: structuredClone(recoveryExpectation.target),
  selected_restart_pack: {
    pack_ref: "selected_restart_pack:machine-receipt-vector",
    content_sha256: "3".repeat(64),
  },
  source_refs: [
    "https://github.com/watchout/agent-memory/issues/180",
    "https://github.com/watchout/agent-memory/pull/257",
  ],
});
assert.equal(verifyOneSeatRecoveryContext(exactContext(), recoveryExpectation).ok, true);

const contextDriftCases: Array<[string, (copy: OneSeatRecoveryContextReadback) => void]> = [
  ["stale-task", (copy) => { copy.current_task.status = "stale"; }],
  ["wrong-cell", (copy) => { copy.current_task.cell_id = "CELL-OLD"; }],
  ["wrong-head", (copy) => { copy.exact_head_sha = "4".repeat(40); }],
  ["wrong-tree", (copy) => { copy.exact_head_tree = "5".repeat(40); }],
  ["wrong-manifest", (copy) => { copy.manifest.canonical_sha256 = "6".repeat(64); }],
  ["wrong-goal", (copy) => { copy.root_goal.goal_id = "wrong-goal"; }],
  ["wrong-objective", (copy) => { copy.root_goal.objective_sha256 = "7".repeat(64); }],
  ["wrong-agent", (copy) => { copy.target.agent_id = "arc"; }],
  ["wrong-project", (copy) => { copy.target.memory_project = "other"; }],
  ["wrong-workspace", (copy) => { copy.target.workspace_ref = "watchout/other"; }],
  ["missing-pack-ref", (copy) => { copy.selected_restart_pack.pack_ref = ""; }],
  ["wrong-pack-hash", (copy) => { copy.selected_restart_pack.content_sha256 = "invalid"; }],
  ["missing-source-refs", (copy) => { copy.source_refs = []; }],
];
for (const [label, mutate] of contextDriftCases) {
  const copy = exactContext();
  mutate(copy);
  assert.equal(verifyOneSeatRecoveryContext(copy, recoveryExpectation).ok, false, label);
}
assert.equal(verifyOneSeatRecoveryContext(undefined, recoveryExpectation).ok, false);
assert.equal(verifyOneSeatRecoveryContext(exactContext(), exactOneSeatRecoveryExpectation("short", "2".repeat(40))).ok, false);
const extraContextField = exactContext() as unknown as Record<string, unknown>;
extraContextField.untrusted_extra = true;
assert.equal(verifyOneSeatRecoveryContext(extraContextField, recoveryExpectation).ok, false);

const liveEffects = () => ({ ...ONE_SEAT_ZERO_EFFECTS, live_launch_count: 1 });
const exactReceipt = (ordinal: 1 | 2 = 1): OneSeatProbeReceipt => ({
  schema_version: "kusabi-one-seat-probe-receipt/v1",
  evidence_kind: "machine_probe_receipt",
  cycle_ordinal: ordinal,
  cycle_kind: ordinal === 1 ? "normal_exit" : "planned_crash_safe_boundary",
  fresh_session_id: `machine-session-${ordinal}`,
  context: exactContext(),
  probe_answers: ONE_SEAT_PROBE_DIMENSION_IDS.map((dimension_id, index) => ({
    dimension_id,
    score: index < 3 ? 5 : 4,
    rationale: `machine rationale ${dimension_id}`,
    source_refs: [`recovery_quality_log:vector-${dimension_id}`],
  })),
  reported_total_score: 27,
  first_recovery_outcome: "full",
  task_continued: true,
  safe_boundary_reached: ordinal === 2,
  automatic_failure_count: 0,
  user_context_restatement_count: 0,
  required_manifest_field_match_rate: 1,
  correct_identity_rate: 1,
  duplicate_effect_count: 0,
  protected_effects: liveEffects(),
});

const firstReceipt = exactReceipt(1);
const firstReceiptVerification = verifyOneSeatProbeReceipt(firstReceipt, recoveryExpectation);
assert.equal(firstReceiptVerification.ok, true);
assert.equal(firstReceiptVerification.total_score, 27);
assert.equal(firstReceiptVerification.receipt_contract_verified, true);
assert.equal(firstReceiptVerification.live_acceptance_verified, false);
assert.equal(firstReceiptVerification.post_run_audit_required, true);
assert.equal(evaluateOneSeatCycleTwoGate(firstReceipt, recoveryExpectation).authorized_by_cycle_one_receipt, true);
assert.equal(evaluateOneSeatCycleTwoGate(firstReceipt, recoveryExpectation).live_execution_authorized, false);

const secondReceipt = exactReceipt(2);
assert.equal(verifyOneSeatProbeReceipt(secondReceipt, recoveryExpectation, firstReceipt).ok, true);
const reusedSession = exactReceipt(2);
reusedSession.fresh_session_id = firstReceipt.fresh_session_id;
assert.equal(verifyOneSeatProbeReceipt(reusedSession, recoveryExpectation, firstReceipt).ok, false);

const scoreBelowThreshold = exactReceipt(1);
scoreBelowThreshold.probe_answers[0].score = 3;
scoreBelowThreshold.reported_total_score = 25;
const belowThresholdVerification = verifyOneSeatProbeReceipt(scoreBelowThreshold, recoveryExpectation);
assert.equal(belowThresholdVerification.ok, false);
assert(belowThresholdVerification.errors.includes("total_score_below_26"));
const stoppedCycleTwo = evaluateOneSeatCycleTwoGate(scoreBelowThreshold, recoveryExpectation);
assert.equal(stoppedCycleTwo.authorized_by_cycle_one_receipt, false);
assert.equal(stoppedCycleTwo.live_execution_authorized, false);
assert(stoppedCycleTwo.errors.includes("cycle_2_blocked_by_cycle_1"));

const receiptNegativeCases: Array<[string, (copy: OneSeatProbeReceipt) => void]> = [
  ["stale-context", (copy) => { copy.context.current_task.status = "stale"; }],
  ["reported-score-mismatch", (copy) => { copy.reported_total_score = 30; }],
  ["missing-dimension", (copy) => { copy.probe_answers.pop(); }],
  ["fractional-score", (copy) => { copy.probe_answers[0].score = 4.5; }],
  ["missing-rationale", (copy) => { copy.probe_answers[0].rationale = ""; }],
  ["missing-probe-source", (copy) => { copy.probe_answers[0].source_refs = []; }],
  ["task-not-continued", (copy) => { copy.task_continued = false; }],
  ["automatic-failure", (copy) => { copy.automatic_failure_count = 1; }],
  ["context-restatement", (copy) => { copy.user_context_restatement_count = 1; }],
  ["manifest-rate", (copy) => { copy.required_manifest_field_match_rate = 0.99; }],
  ["identity-rate", (copy) => { copy.correct_identity_rate = 0; }],
  ["duplicate-effect", (copy) => { copy.duplicate_effect_count = 1; }],
  ["protected-effect", (copy) => { copy.protected_effects.queue_mutation_count = 1; }],
  ["launch-count", (copy) => { copy.protected_effects.live_launch_count = 0; }],
];
for (const [label, mutate] of receiptNegativeCases) {
  const copy = exactReceipt(1);
  mutate(copy);
  assert.equal(verifyOneSeatProbeReceipt(copy, recoveryExpectation).ok, false, label);
}
assert.equal(verifyOneSeatProbeReceipt(undefined, recoveryExpectation).ok, false);
assert.equal(verifyOneSeatProbeReceipt(evidence, recoveryExpectation).ok, false, "fixture cannot become live receipt");
const extraReceiptField = exactReceipt(1) as unknown as Record<string, unknown>;
extraReceiptField.self_asserted_pass = true;
assert.equal(verifyOneSeatProbeReceipt(extraReceiptField, recoveryExpectation).ok, false);

const missingPriorForCycleTwo = verifyOneSeatProbeReceipt(exactReceipt(2), recoveryExpectation);
assert.equal(missingPriorForCycleTwo.ok, false);
assert(missingPriorForCycleTwo.errors.includes("cycle_2_blocked_by_cycle_1"));
const missingSafeBoundary = exactReceipt(2);
missingSafeBoundary.safe_boundary_reached = false;
assert.equal(verifyOneSeatProbeReceipt(missingSafeBoundary, recoveryExpectation, firstReceipt).ok, false);

const receiptDigest = canonicalOneSeatProbeReceiptDigest(firstReceipt);
assert.match(receiptDigest, /^[a-f0-9]{64}$/);
const tamperedReceipt = structuredClone(firstReceipt);
tamperedReceipt.task_continued = false;
assert.notEqual(canonicalOneSeatProbeReceiptDigest(tamperedReceipt), receiptDigest);

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
console.log("KUI-MACHINE-CONTEXT-001 PASS exact current tuple and selected-pack fail-closed validation");
console.log("KUI-MACHINE-RECEIPT-001 PASS S1-S6 score/provenance receipt validation");
console.log("KUI-CYCLE2-STOP-001 PASS stale/missing/below-threshold Cycle 1 blocks Cycle 2");
console.log("KUI-FIXTURE-LIVE-SEPARATION-001 PASS deterministic fixtures cannot become live receipts");
console.log("kusabi one-seat canary tests passed");
