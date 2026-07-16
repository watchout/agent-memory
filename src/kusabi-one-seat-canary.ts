import { createHash } from "node:crypto";

export const ONE_SEAT_MANIFEST = Object.freeze({
  schema_version: "shirube-v3/explicit_enrollment_target_manifest/v1",
  manifest_id: "TARGET-MANIFEST-SPEC-KUSABI-001-GEN-1",
  generation: 1,
  canonical_sha256: "873f1915720604383ab4779d26d3f3aecfe2a3d26aac97cf408b4b3ce9a09612",
  utf8_bytes: 1855,
  enabled_row_count: 1,
  wildcard_target_count: 0,
  inferred_target_count: 0,
  explicit_enrollment_source_ref_count: 4,
  acceptance_sha256: "64a7ee2c5ef009f16de8eaaef0932c21e3121b275809aae34260fdc6ac99723c",
  row: {
    enrollment_id: "ENROLL-SPEC-KUSABI-001-KUSABI-ONE-SEAT-20260716",
    enabled: true,
    enrollment_valid: true,
    enrollment_status: "explicit_internal_canary",
    agent_id: "kusabi",
    active_function: "implementation_executor",
    registered_profile_revision: 9,
    memory_project: "agent-memory",
    workspace_ref: "watchout/agent-memory",
    host: "codex",
    adapter: "verified_codex_startup_bridge",
    guard_mode: "pack_only",
    lifecycle_owner: "user_host",
    aun_supervised: false,
    auto_restart: false,
    external_send_enabled: false,
    provider_dispatch_enabled: false,
    queue_mutation_enabled: false,
  },
} as const);

export const ONE_SEAT_ROOT_GOAL = Object.freeze({
  goal_id: "019f6357-72f0-7a90-8478-8698f99afc3b",
  objective_sha256: "a48b4fbf1192c5e5f288bab61020f2ad0d605fab642d8b58e144cadab9a33682",
} as const);

const ONE_SEAT_ROOT_GOAL_DURABLE_READBACK_URL =
  "https://github.com/watchout/agent-memory/issues/180#issuecomment-4978795231";
const ONE_SEAT_ROOT_GOAL_LIFECYCLE_STATE = "ACTIVE_WAITING_FOR_EXACT_HANDOFF";
const ONE_SEAT_GATE_ID = "KUSABI-ONE-SEAT-INTERNAL-OPT-IN-GATE-001";
const FLEET_GATE_ID = "KUSABI-ENABLED-FLEET-COMPLETION-GATE-001";

export const ONE_SEAT_PRIOR_AUDITS = Object.freeze({
  cell_1: "https://github.com/watchout/agent-memory/pull/255#issuecomment-4989935147",
  cell_2: "https://github.com/watchout/agent-memory/pull/256#issuecomment-4996642810",
} as const);

export const ONE_SEAT_FIXTURE_IDS = Object.freeze([
  "KUI-005",
  "KUI-006",
  "KUI-015",
  "KUI-017",
  "KUI-018",
  "KUI-019",
] as const);

export interface OneSeatEffectCounters {
  live_launch_count: number;
  automatic_restart_count: number;
  aun_mutation_count: number;
  queue_mutation_count: number;
  external_send_count: number;
  provider_dispatch_count: number;
  schema_mutation_count: number;
  fleet_rollout_count: number;
  other_agent_goal_api_mutation_count: number;
  child_goal_overwrite_count: number;
  sent_queued_pending_progress_increment: number;
}

export const ONE_SEAT_ZERO_EFFECTS: Readonly<OneSeatEffectCounters> = Object.freeze({
  live_launch_count: 0,
  automatic_restart_count: 0,
  aun_mutation_count: 0,
  queue_mutation_count: 0,
  external_send_count: 0,
  provider_dispatch_count: 0,
  schema_mutation_count: 0,
  fleet_rollout_count: 0,
  other_agent_goal_api_mutation_count: 0,
  child_goal_overwrite_count: 0,
  sent_queued_pending_progress_increment: 0,
});

const ONE_SEAT_EFFECT_COUNTER_KEYS = Object.freeze(Object.keys(ONE_SEAT_ZERO_EFFECTS).sort());

export type OneSeatCanaryMode = "dry-run" | "normal-exit" | "planned-crash";

export interface OneSeatManifestBinding {
  schema_version: string;
  manifest_id: string;
  generation: number;
  canonical_sha256: string;
  utf8_bytes: number;
  enabled_row_count: number;
  wildcard_target_count: number;
  inferred_target_count: number;
  explicit_enrollment_source_ref_count: number;
  acceptance_sha256: string;
  row: {
    enrollment_id: string;
    enabled: boolean;
    enrollment_valid: boolean;
    enrollment_status: string;
    agent_id: string;
    active_function: string;
    registered_profile_revision: number;
    memory_project: string;
    workspace_ref: string;
    host: string;
    adapter: string;
    guard_mode: string;
    lifecycle_owner: string;
    aun_supervised: boolean;
    auto_restart: boolean;
    external_send_enabled: boolean;
    provider_dispatch_enabled: boolean;
    queue_mutation_enabled: boolean;
  };
}

export interface OneSeatCanaryInput {
  mode: OneSeatCanaryMode;
  manifest: OneSeatManifestBinding;
  root_goal: {
    goal_id: string;
    objective_sha256: string;
    durable_readback_url: string;
    lifecycle_state: string;
    terminal: boolean;
  };
  prior_audits: {
    cell_1_url: string;
    cell_1_verdict: "PASS" | "BLOCK";
    cell_2_url: string;
    cell_2_verdict: "PASS" | "BLOCK";
  };
  requested_target: {
    agent_id: string;
    memory_project: string;
    workspace_ref: string;
  };
}

export interface OneSeatCanaryPlan {
  schema_version: "kusabi-one-seat-canary-plan/v1";
  plan_id: string;
  status: "ready_dry_run" | "stopped";
  mode: OneSeatCanaryMode;
  errors: string[];
  stop_reason?: string;
  live_execution_authorized: false;
  live_execution_performed: false;
  live_acceptance_claimed: false;
  protected_effect_boundary_reached: false;
  bindings: {
    manifest: OneSeatManifestBinding;
    root_goal: OneSeatCanaryInput["root_goal"];
    prior_audits: OneSeatCanaryInput["prior_audits"];
    requested_target: OneSeatCanaryInput["requested_target"];
  };
  fixture_contracts: Array<{
    fixture_id: typeof ONE_SEAT_FIXTURE_IDS[number];
    disposition: "deterministic_dry_run_contract";
  }>;
  planned_cycles: Array<{
    ordinal: 1 | 2;
    kind: "normal_exit" | "planned_crash_safe_boundary";
    minimum_score: 26;
    required_manifest_field_match_rate: 1;
    user_context_restatement_count: 0;
    correct_identity_rate: 1;
    automatic_failure_count: 0;
    duplicate_effect_count: 0;
  }>;
  gate_separation: {
    one_seat_gate_id: "KUSABI-ONE-SEAT-INTERNAL-OPT-IN-GATE-001";
    one_seat_fixture_ids: string[];
    fleet_gate_id: "KUSABI-ENABLED-FLEET-COMPLETION-GATE-001";
    fleet_fixture_ids: ["KUI-020"];
    kui_020_inferred: false;
    parent_goal_completion_effect: "none";
  };
  counters: Readonly<OneSeatEffectCounters>;
  next_action: {
    blocking: true;
    action: "independent_exact_head_audit_before_any_live_go";
  };
}

export interface OneSeatCycleEvidence {
  ordinal: 1 | 2;
  kind: "normal_exit" | "planned_crash_safe_boundary";
  fresh_session_id: string;
  score: number;
  first_recovery_outcome: "full";
  task_continued_recorded: true;
  safe_boundary_declared: boolean;
  automatic_failure_count: number;
  user_context_restatement_count: number;
  required_manifest_field_match_rate: number;
  correct_identity_rate: number;
  duplicate_effect_count: number;
  supported_source_backlog_after_sync: number;
  root_goal_id: string;
  root_objective_sha256: string;
  unmet_acceptance_set_digest: string;
  active_child_or_next_action_digest: string;
}

export interface OneSeatCanaryEvidence {
  schema_version: "kusabi-one-seat-canary-evidence/v1";
  evidence_kind: "deterministic_fixture";
  plan: OneSeatCanaryPlan;
  plan_digest: string;
  fixture_receipts: Record<typeof ONE_SEAT_FIXTURE_IDS[number], "PASS">;
  cycles: [OneSeatCycleEvidence, OneSeatCycleEvidence];
  root_goal: {
    goal_id: string;
    objective_sha256: string;
    durable_goal_readback_present: boolean;
    parent_goal_completed: false;
    parent_goal_reloaded: true;
    next_unmet_acceptance_selected: true;
  };
  live_execution_performed: false;
  live_acceptance_claimed: false;
  counters: Readonly<OneSeatEffectCounters>;
}

export interface OneSeatEvidenceVerification {
  ok: boolean;
  status: "pass" | "blocked";
  errors: string[];
  repository_harness_verified: boolean;
  live_acceptance_verified: false;
  required_manifest_field_match_rate: number;
  consecutive_run_count: number;
  minimum_score: number;
  user_context_restatement_count: number;
  root_goal_id_match: boolean;
  root_objective_digest_match: boolean;
  counters: Readonly<OneSeatEffectCounters>;
}

const UNMET_ACCEPTANCE_SET_DIGEST = sha256("KUI-005,KUI-006,KUI-015,KUI-017,KUI-018,KUI-019,KUI-020");
const ACTIVE_NEXT_ACTION_DIGEST = sha256("CELL-ONE-SEAT-CANARY:independent_exact_head_audit_before_any_live_go");

export function exactOneSeatCanaryInput(mode: OneSeatCanaryMode = "dry-run"): OneSeatCanaryInput {
  return {
    mode,
    manifest: structuredClone(ONE_SEAT_MANIFEST),
    root_goal: {
      ...ONE_SEAT_ROOT_GOAL,
      durable_readback_url: ONE_SEAT_ROOT_GOAL_DURABLE_READBACK_URL,
      lifecycle_state: ONE_SEAT_ROOT_GOAL_LIFECYCLE_STATE,
      terminal: false,
    },
    prior_audits: {
      cell_1_url: ONE_SEAT_PRIOR_AUDITS.cell_1,
      cell_1_verdict: "PASS",
      cell_2_url: ONE_SEAT_PRIOR_AUDITS.cell_2,
      cell_2_verdict: "PASS",
    },
    requested_target: {
      agent_id: ONE_SEAT_MANIFEST.row.agent_id,
      memory_project: ONE_SEAT_MANIFEST.row.memory_project,
      workspace_ref: ONE_SEAT_MANIFEST.row.workspace_ref,
    },
  };
}

export function buildOneSeatCanaryPlan(input: OneSeatCanaryInput): OneSeatCanaryPlan {
  const errors = validateCanaryInput(input);
  if (input.mode !== "dry-run") errors.push("live_mode_requires_separate_protected_owner_go");
  const bindingDigest = sha256(canonicalJson({
    manifest: input.manifest,
    root_goal: input.root_goal,
    prior_audits: input.prior_audits,
    requested_target: input.requested_target,
    mode: input.mode,
  }));
  const stopped = errors.length > 0;
  return {
    schema_version: "kusabi-one-seat-canary-plan/v1",
    plan_id: `one_seat_canary_plan:${bindingDigest}`,
    status: stopped ? "stopped" : "ready_dry_run",
    mode: input.mode,
    errors,
    ...(stopped ? { stop_reason: errors[0] } : {}),
    live_execution_authorized: false,
    live_execution_performed: false,
    live_acceptance_claimed: false,
    protected_effect_boundary_reached: false,
    bindings: {
      manifest: structuredClone(input.manifest),
      root_goal: structuredClone(input.root_goal),
      prior_audits: structuredClone(input.prior_audits),
      requested_target: structuredClone(input.requested_target),
    },
    fixture_contracts: ONE_SEAT_FIXTURE_IDS.map((fixture_id) => ({
      fixture_id,
      disposition: "deterministic_dry_run_contract" as const,
    })),
    planned_cycles: [
      cycleContract(1, "normal_exit"),
      cycleContract(2, "planned_crash_safe_boundary"),
    ],
    gate_separation: {
      one_seat_gate_id: ONE_SEAT_GATE_ID,
      one_seat_fixture_ids: [...ONE_SEAT_FIXTURE_IDS],
      fleet_gate_id: FLEET_GATE_ID,
      fleet_fixture_ids: ["KUI-020"],
      kui_020_inferred: false,
      parent_goal_completion_effect: "none",
    },
    counters: ONE_SEAT_ZERO_EFFECTS,
    next_action: {
      blocking: true,
      action: "independent_exact_head_audit_before_any_live_go",
    },
  };
}

export function canonicalOneSeatCanaryPlanDigest(plan: OneSeatCanaryPlan): string {
  return sha256(canonicalJson(plan));
}

export function buildDeterministicOneSeatCanaryEvidence(plan: OneSeatCanaryPlan): OneSeatCanaryEvidence {
  const root = plan.bindings.root_goal;
  return {
    schema_version: "kusabi-one-seat-canary-evidence/v1",
    evidence_kind: "deterministic_fixture",
    plan,
    plan_digest: canonicalOneSeatCanaryPlanDigest(plan),
    fixture_receipts: {
      "KUI-005": "PASS",
      "KUI-006": "PASS",
      "KUI-015": "PASS",
      "KUI-017": "PASS",
      "KUI-018": "PASS",
      "KUI-019": "PASS",
    },
    cycles: [
      cycleEvidence(1, "normal_exit", root),
      cycleEvidence(2, "planned_crash_safe_boundary", root),
    ],
    root_goal: {
      goal_id: root.goal_id,
      objective_sha256: root.objective_sha256,
      durable_goal_readback_present: root.durable_readback_url.startsWith("https://github.com/"),
      parent_goal_completed: false,
      parent_goal_reloaded: true,
      next_unmet_acceptance_selected: true,
    },
    live_execution_performed: false,
    live_acceptance_claimed: false,
    counters: ONE_SEAT_ZERO_EFFECTS,
  };
}

export function verifyOneSeatCanaryEvidence(evidence: OneSeatCanaryEvidence): OneSeatEvidenceVerification {
  const errors: string[] = [];
  if (!hasEvidenceShape(evidence)) {
    return blockedEvidence(["evidence_shape_invalid"]);
  }
  const plan = evidence.plan;
  if (!plan || plan.schema_version !== "kusabi-one-seat-canary-plan/v1") errors.push("plan_schema_invalid");
  if (plan?.status !== "ready_dry_run" || plan.mode !== "dry-run") errors.push("dry_run_plan_not_ready");
  if (plan && evidence.plan_digest !== canonicalOneSeatCanaryPlanDigest(plan)) errors.push("plan_digest_mismatch");
  if (plan) errors.push(...validatePlanBindings(plan));
  if (!sameStrings(Object.keys(evidence.fixture_receipts).sort(), [...ONE_SEAT_FIXTURE_IDS].sort())) {
    errors.push("fixture_receipt_set_mismatch");
  }
  if (Object.values(evidence.fixture_receipts).some((value) => value !== "PASS")) {
    errors.push("fixture_receipt_nonpass");
  }
  if (!Array.isArray(evidence.cycles) || evidence.cycles.length !== 2) errors.push("two_cycles_required");
  const cycles = Array.isArray(evidence.cycles) ? evidence.cycles : [];
  if (cycles[0]?.kind !== "normal_exit" || cycles[1]?.kind !== "planned_crash_safe_boundary") {
    errors.push("cycle_order_mismatch");
  }
  if (new Set(cycles.map((cycle) => cycle.fresh_session_id)).size !== cycles.length) {
    errors.push("fresh_session_ids_not_distinct");
  }
  for (const cycle of cycles) {
    if (cycle.score < 26) errors.push(`cycle_${cycle.ordinal}_score_below_26`);
    if (cycle.first_recovery_outcome !== "full") errors.push(`cycle_${cycle.ordinal}_recovery_not_full`);
    if (!cycle.task_continued_recorded) errors.push(`cycle_${cycle.ordinal}_task_not_continued`);
    if (cycle.kind === "planned_crash_safe_boundary" && !cycle.safe_boundary_declared) {
      errors.push(`cycle_${cycle.ordinal}_safe_boundary_missing`);
    }
    if (cycle.automatic_failure_count !== 0) errors.push(`cycle_${cycle.ordinal}_automatic_failure`);
    if (cycle.user_context_restatement_count !== 0) errors.push(`cycle_${cycle.ordinal}_context_restatement`);
    if (cycle.required_manifest_field_match_rate !== 1) errors.push(`cycle_${cycle.ordinal}_manifest_mismatch`);
    if (cycle.correct_identity_rate !== 1) errors.push(`cycle_${cycle.ordinal}_identity_mismatch`);
    if (cycle.duplicate_effect_count !== 0) errors.push(`cycle_${cycle.ordinal}_duplicate_effect`);
    if (cycle.supported_source_backlog_after_sync !== 0) errors.push(`cycle_${cycle.ordinal}_source_backlog`);
    if (cycle.root_goal_id !== ONE_SEAT_ROOT_GOAL.goal_id) errors.push(`cycle_${cycle.ordinal}_root_goal_mismatch`);
    if (cycle.root_objective_sha256 !== ONE_SEAT_ROOT_GOAL.objective_sha256) {
      errors.push(`cycle_${cycle.ordinal}_root_objective_mismatch`);
    }
    if (cycle.unmet_acceptance_set_digest !== UNMET_ACCEPTANCE_SET_DIGEST) {
      errors.push(`cycle_${cycle.ordinal}_unmet_acceptance_mismatch`);
    }
    if (cycle.active_child_or_next_action_digest !== ACTIVE_NEXT_ACTION_DIGEST) {
      errors.push(`cycle_${cycle.ordinal}_next_action_mismatch`);
    }
  }
  if (evidence.root_goal.goal_id !== ONE_SEAT_ROOT_GOAL.goal_id) errors.push("root_goal_id_mismatch");
  if (evidence.root_goal.objective_sha256 !== ONE_SEAT_ROOT_GOAL.objective_sha256) {
    errors.push("root_objective_digest_mismatch");
  }
  if (!evidence.root_goal.durable_goal_readback_present) errors.push("durable_goal_readback_missing");
  if (evidence.root_goal.parent_goal_completed) errors.push("parent_goal_must_remain_active");
  if (!evidence.root_goal.parent_goal_reloaded) errors.push("parent_goal_not_reloaded");
  if (!evidence.root_goal.next_unmet_acceptance_selected) errors.push("next_unmet_acceptance_not_selected");
  if (evidence.live_execution_performed || evidence.live_acceptance_claimed) errors.push("dry_run_claimed_live_acceptance");
  errors.push(...validateZeroEffectCounters(evidence.counters, "evidence"));
  const minScore = cycles.length > 0 ? Math.min(...cycles.map((cycle) => cycle.score)) : 0;
  const restatements = cycles.reduce((sum, cycle) => sum + cycle.user_context_restatement_count, 0);
  const fieldMatch = cycles.length === 2 && cycles.every((cycle) => cycle.required_manifest_field_match_rate === 1) ? 1 : 0;
  const rootIdMatch = cycles.length === 2 && cycles.every((cycle) => cycle.root_goal_id === ONE_SEAT_ROOT_GOAL.goal_id);
  const objectiveMatch = cycles.length === 2 && cycles.every(
    (cycle) => cycle.root_objective_sha256 === ONE_SEAT_ROOT_GOAL.objective_sha256,
  );
  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? "pass" : "blocked",
    errors,
    repository_harness_verified: errors.length === 0,
    live_acceptance_verified: false,
    required_manifest_field_match_rate: fieldMatch,
    consecutive_run_count: cycles.length,
    minimum_score: minScore,
    user_context_restatement_count: restatements,
    root_goal_id_match: rootIdMatch,
    root_objective_digest_match: objectiveMatch,
    counters: evidence.counters,
  };
}

function validateCanaryInput(input: OneSeatCanaryInput): string[] {
  const errors: string[] = [];
  compareRecord(input.manifest, ONE_SEAT_MANIFEST, "manifest", errors);
  if (input.root_goal.goal_id !== ONE_SEAT_ROOT_GOAL.goal_id) errors.push("root_goal_id_mismatch");
  if (input.root_goal.objective_sha256 !== ONE_SEAT_ROOT_GOAL.objective_sha256) {
    errors.push("root_objective_digest_mismatch");
  }
  if (input.root_goal.durable_readback_url !== ONE_SEAT_ROOT_GOAL_DURABLE_READBACK_URL) {
    errors.push("root_goal_readback_mismatch");
  }
  if (input.root_goal.lifecycle_state !== ONE_SEAT_ROOT_GOAL_LIFECYCLE_STATE) errors.push("root_goal_not_active");
  if (input.root_goal.terminal) errors.push("root_goal_terminal_forbidden");
  if (input.prior_audits.cell_1_verdict !== "PASS" || input.prior_audits.cell_1_url !== ONE_SEAT_PRIOR_AUDITS.cell_1) {
    errors.push("cell_1_independent_pass_mismatch");
  }
  if (input.prior_audits.cell_2_verdict !== "PASS" || input.prior_audits.cell_2_url !== ONE_SEAT_PRIOR_AUDITS.cell_2) {
    errors.push("cell_2_independent_pass_mismatch");
  }
  if (input.requested_target.agent_id !== input.manifest.row.agent_id) errors.push("requested_agent_mismatch");
  if (input.requested_target.memory_project !== input.manifest.row.memory_project) errors.push("requested_project_mismatch");
  if (input.requested_target.workspace_ref !== input.manifest.row.workspace_ref) errors.push("requested_workspace_mismatch");
  return uniqueStrings(errors);
}

function validatePlanBindings(plan: OneSeatCanaryPlan): string[] {
  const errors: string[] = [];
  compareRecord(plan.bindings.manifest, ONE_SEAT_MANIFEST, "manifest", errors);
  if (plan.bindings.root_goal.goal_id !== ONE_SEAT_ROOT_GOAL.goal_id) errors.push("plan_root_goal_id_mismatch");
  if (plan.bindings.root_goal.objective_sha256 !== ONE_SEAT_ROOT_GOAL.objective_sha256) {
    errors.push("plan_root_objective_mismatch");
  }
  if (plan.bindings.root_goal.durable_readback_url !== ONE_SEAT_ROOT_GOAL_DURABLE_READBACK_URL) {
    errors.push("plan_root_goal_readback_mismatch");
  }
  if (plan.bindings.root_goal.lifecycle_state !== ONE_SEAT_ROOT_GOAL_LIFECYCLE_STATE) {
    errors.push("plan_root_goal_lifecycle_mismatch");
  }
  if (plan.bindings.root_goal.terminal !== false) errors.push("plan_root_goal_terminal_forbidden");
  if (plan.bindings.prior_audits.cell_1_url !== ONE_SEAT_PRIOR_AUDITS.cell_1 ||
      plan.bindings.prior_audits.cell_1_verdict !== "PASS") errors.push("plan_cell_1_pass_mismatch");
  if (plan.bindings.prior_audits.cell_2_url !== ONE_SEAT_PRIOR_AUDITS.cell_2 ||
      plan.bindings.prior_audits.cell_2_verdict !== "PASS") errors.push("plan_cell_2_pass_mismatch");
  if (plan.live_execution_authorized !== false) errors.push("plan_live_execution_authorized_forbidden");
  if (plan.live_execution_performed !== false) errors.push("plan_live_execution_performed_forbidden");
  if (plan.live_acceptance_claimed !== false) errors.push("plan_live_acceptance_claimed_forbidden");
  if (plan.protected_effect_boundary_reached !== false) errors.push("plan_protected_effect_boundary_reached_forbidden");
  if (plan.gate_separation.one_seat_gate_id !== ONE_SEAT_GATE_ID) errors.push("one_seat_gate_id_mismatch");
  if (!sameStrings(plan.gate_separation.one_seat_fixture_ids, [...ONE_SEAT_FIXTURE_IDS])) {
    errors.push("one_seat_gate_fixture_mismatch");
  }
  if (plan.gate_separation.fleet_gate_id !== FLEET_GATE_ID) errors.push("fleet_gate_id_mismatch");
  if (!sameStrings(plan.gate_separation.fleet_fixture_ids, ["KUI-020"])) errors.push("fleet_gate_fixture_mismatch");
  if (String(plan.gate_separation.one_seat_gate_id) === String(plan.gate_separation.fleet_gate_id)) {
    errors.push("one_seat_fleet_gate_identity_collapsed");
  }
  if (plan.gate_separation.kui_020_inferred !== false) errors.push("fleet_fixture_inferred_into_one_seat_gate");
  if (plan.gate_separation.parent_goal_completion_effect !== "none") errors.push("parent_goal_completion_effect_forbidden");
  if (!sameStrings(
    plan.fixture_contracts.map((contract) => contract.fixture_id),
    [...ONE_SEAT_FIXTURE_IDS],
  ) || plan.fixture_contracts.some((contract) => contract.disposition !== "deterministic_dry_run_contract")) {
    errors.push("plan_fixture_contract_mismatch");
  }
  if (plan.next_action.blocking !== true ||
      plan.next_action.action !== "independent_exact_head_audit_before_any_live_go") {
    errors.push("plan_next_action_mismatch");
  }
  errors.push(...validateZeroEffectCounters(plan.counters, "plan"));
  return errors;
}

function validateZeroEffectCounters(value: unknown, prefix: "plan" | "evidence"): string[] {
  if (!isRecord(value)) return [`${prefix}_counter_object_invalid`];
  const errors: string[] = [];
  const observedKeys = Object.keys(value).sort();
  if (!sameStrings(observedKeys, [...ONE_SEAT_EFFECT_COUNTER_KEYS])) {
    errors.push(`${prefix}_counter_key_set_mismatch`);
  }
  for (const counter of ONE_SEAT_EFFECT_COUNTER_KEYS) {
    const observed = value[counter];
    if (typeof observed !== "number" || !Number.isFinite(observed)) {
      errors.push(`${prefix}_counter_nonnumeric:${counter}`);
    } else if (observed !== 0) {
      errors.push(`${prefix}_protected_effect_nonzero:${counter}`);
    }
  }
  return errors;
}

function compareRecord(observed: unknown, expected: unknown, prefix: string, errors: string[]): void {
  if (canonicalJson(observed) !== canonicalJson(expected)) errors.push(`${prefix}_tuple_mismatch`);
}

function cycleContract(ordinal: 1 | 2, kind: "normal_exit" | "planned_crash_safe_boundary") {
  return {
    ordinal,
    kind,
    minimum_score: 26 as const,
    required_manifest_field_match_rate: 1 as const,
    user_context_restatement_count: 0 as const,
    correct_identity_rate: 1 as const,
    automatic_failure_count: 0 as const,
    duplicate_effect_count: 0 as const,
  };
}

function cycleEvidence(
  ordinal: 1 | 2,
  kind: "normal_exit" | "planned_crash_safe_boundary",
  root: OneSeatCanaryInput["root_goal"],
): OneSeatCycleEvidence {
  return {
    ordinal,
    kind,
    fresh_session_id: `deterministic-fixture-session-${ordinal}`,
    score: 26,
    first_recovery_outcome: "full",
    task_continued_recorded: true,
    safe_boundary_declared: kind === "planned_crash_safe_boundary",
    automatic_failure_count: 0,
    user_context_restatement_count: 0,
    required_manifest_field_match_rate: 1,
    correct_identity_rate: 1,
    duplicate_effect_count: 0,
    supported_source_backlog_after_sync: 0,
    root_goal_id: root.goal_id,
    root_objective_sha256: root.objective_sha256,
    unmet_acceptance_set_digest: UNMET_ACCEPTANCE_SET_DIGEST,
    active_child_or_next_action_digest: ACTIVE_NEXT_ACTION_DIGEST,
  };
}

function blockedEvidence(errors: string[]): OneSeatEvidenceVerification {
  return {
    ok: false,
    status: "blocked",
    errors,
    repository_harness_verified: false,
    live_acceptance_verified: false,
    required_manifest_field_match_rate: 0,
    consecutive_run_count: 0,
    minimum_score: 0,
    user_context_restatement_count: 0,
    root_goal_id_match: false,
    root_objective_digest_match: false,
    counters: ONE_SEAT_ZERO_EFFECTS,
  };
}

function hasEvidenceShape(value: unknown): value is OneSeatCanaryEvidence {
  if (!isRecord(value) || value.schema_version !== "kusabi-one-seat-canary-evidence/v1") return false;
  if (!isRecord(value.plan) || !isRecord(value.plan.bindings) || !isRecord(value.plan.gate_separation)) return false;
  if (!isRecord(value.plan.bindings.manifest) || !isRecord(value.plan.bindings.root_goal) ||
      !isRecord(value.plan.bindings.prior_audits) || !isRecord(value.plan.bindings.requested_target) ||
      !isRecord(value.plan.counters)) return false;
  if (!Array.isArray(value.plan.errors) || !Array.isArray(value.plan.fixture_contracts) ||
      !value.plan.fixture_contracts.every(isRecord) || !Array.isArray(value.plan.planned_cycles) ||
      !value.plan.planned_cycles.every(isRecord) || !isRecord(value.plan.next_action) ||
      !Array.isArray(value.plan.gate_separation.one_seat_fixture_ids) ||
      !Array.isArray(value.plan.gate_separation.fleet_fixture_ids)) return false;
  return isRecord(value.fixture_receipts) && Array.isArray(value.cycles) && value.cycles.every(isRecord) &&
    isRecord(value.root_goal) && isRecord(value.counters);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseCli(argv: string[]): OneSeatCanaryInput {
  const values = new Map<string, string>();
  const allowed = new Set(["mode", "manifest-sha256", "agent-id", "project", "workspace-ref"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--cli") continue;
    if (!token.startsWith("--") || !argv[index + 1]) throw new Error(`INVALID_ARGUMENT:${token}`);
    const key = token.slice(2);
    if (!allowed.has(key)) throw new Error(`UNKNOWN_ARGUMENT:${token}`);
    values.set(key, argv[index + 1]);
    index += 1;
  }
  const mode = values.get("mode") as OneSeatCanaryMode | undefined;
  if (!mode || !["dry-run", "normal-exit", "planned-crash"].includes(mode)) throw new Error("INVALID_MODE");
  const input = exactOneSeatCanaryInput(mode);
  input.manifest.canonical_sha256 = values.get("manifest-sha256") ?? "";
  input.requested_target.agent_id = values.get("agent-id") ?? "";
  input.requested_target.memory_project = values.get("project") ?? "";
  input.requested_target.workspace_ref = values.get("workspace-ref") ?? "";
  return input;
}

if (process.argv.includes("--cli")) {
  try {
    const plan = buildOneSeatCanaryPlan(parseCli(process.argv.slice(2)));
    const evidence = buildDeterministicOneSeatCanaryEvidence(plan);
    const verification = verifyOneSeatCanaryEvidence(evidence);
    console.log(JSON.stringify({ plan, evidence, verification }));
    process.exitCode = verification.ok ? 0 : 2;
  } catch (error) {
    console.log(JSON.stringify({
      schema_version: "kusabi-one-seat-canary-stop/v1",
      status: "stopped",
      stop_reason: error instanceof Error ? error.message : "unknown_error",
      live_execution_performed: false,
      protected_effect_boundary_reached: false,
      counters: ONE_SEAT_ZERO_EFFECTS,
    }));
    process.exitCode = 2;
  }
}
