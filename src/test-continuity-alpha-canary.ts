import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  CONTINUITY_ALPHA_EVALUATOR_VERSION,
  CONTINUITY_ALPHA_HOST_CONTRACT,
  CONTINUITY_ALPHA_HOSTS,
  CONTINUITY_ALPHA_P0_AGENTS,
  CONTINUITY_ALPHA_ZERO_EFFECTS,
  S15_FIXTURE_ID,
  type ContinuityAlphaHost,
  type ContinuityAlphaRunEvidence,
  type ContinuityAlphaScenarioFacts,
  type ContinuityAlphaSuiteInput,
  type CountedContinuityScenarioId,
} from "./continuity-alpha-evaluator.js";
import {
  CONTINUITY_ALPHA_CANARY_CONTROL_SOURCE_REF,
  CONTINUITY_ALPHA_CANARY_DEPENDENCY_REFS,
  CONTINUITY_ALPHA_CANARY_OWNER_ENVELOPE_REF,
  CONTINUITY_ALPHA_CANARY_PLAN_REF,
  CONTINUITY_ALPHA_CANARY_ZERO_EFFECTS,
  CONTINUITY_ALPHA_OBSERVATION_RECEIPT_VERSION,
  buildContinuityAlphaCanaryPlan,
  continuityAlphaCanaryPlanDigest,
  continuityAlphaObservationReceiptComment,
  continuityAlphaObservedRunDigest,
  verifyObservedContinuityAlphaCanary,
  type ContinuityAlphaCanaryPlan,
  type ContinuityAlphaCanarySuiteInput,
  type ContinuityAlphaHostCanaryTarget,
  type ContinuityAlphaCanaryPlanInput,
  type ContinuityAlphaCanaryTarget,
  type ContinuityAlphaObservedRunEvidence,
} from "./continuity-alpha-canary.js";

const WORKSPACE = "/Users/fixture/Developer/agent-memory";

function scenarioFacts(id: CountedContinuityScenarioId): ContinuityAlphaScenarioFacts {
  switch (id) {
    case "S1": return { termination_kind: "normal_exit", real_work: true };
    case "S2": return { termination_kind: "planned_crash", real_work: true };
    case "S3": return { termination_kind: "sudden_death", cursor_lag_ms: 9_500 };
    case "S4": return { compaction_occurred: true, resumed_after_compaction: true };
    case "S5": return { long_gap_days: 7 };
    case "S6": return { memory_overflow: true, missing_context_complete: true };
    case "S7": return { active_task_count: 3, primary_task_selected: true, primary_task_ground_truth_match: true };
    case "S8": return { ssot_conflict_detected: true, corrected_to_ssot: true, stale_action_avoided: true };
    case "S9": return { dirty_worktree_detected: true, failed_test_present: true, failed_test_recovery_safe: true };
    case "S10": return { restart_generation_count: 4, generation_quality_degraded: false };
    case "S11": return { isolation_checked: true };
    case "S12": return { contamination_chain_depth: 3, contamination_blocked: true };
    case "S13": return { hook_state: "failed" };
    case "S14": return {};
  }
}

function targets(): ContinuityAlphaCanaryTarget[] {
  const runtimes: ContinuityAlphaHost[] = [
    "codex", "claude_code", "codex", "codex", "codex",
    "claude_code", "claude_code", "codex", "codex", "codex",
  ];
  return CONTINUITY_ALPHA_P0_AGENTS.map((agentId, index) => ({
    agent_id: agentId,
    runtime: runtimes[index],
    project: "agent-memory",
    workspace_ref: WORKSPACE,
    binding_ref: `binding:${agentId}:${runtimes[index]}`,
  }));
}

function hostCanaries(): ContinuityAlphaHostCanaryTarget[] {
  return [
    {
      agent_id: "kusabi",
      runtime: "codex",
      project: "agent-memory",
      workspace_ref: WORKSPACE,
      binding_ref: "binding:kusabi:codex",
      use: "alpha-canary-only",
      normal_work_queue: false,
    },
    {
      agent_id: "spec",
      runtime: "claude_code",
      project: "agent-memory",
      workspace_ref: WORKSPACE,
      binding_ref: "binding:spec:claude_code",
      use: "alpha-canary-only",
      normal_work_queue: false,
    },
    {
      agent_id: "kusabi-gemini",
      runtime: "gemini_cli",
      project: "agent-memory",
      workspace_ref: "/Users/yuji/Developer/agent-memory",
      binding_ref: "binding:kusabi-gemini:gemini_cli",
      use: "alpha-canary-only",
      normal_work_queue: false,
    },
  ];
}

function planInput(): ContinuityAlphaCanaryPlanInput {
  return {
    schema_version: "continuity-alpha-canary-plan-input/v1",
    plan_ref: CONTINUITY_ALPHA_CANARY_PLAN_REF,
    exact_head: "1".repeat(40),
    exact_tree: "2".repeat(40),
    control_source_ref: CONTINUITY_ALPHA_CANARY_CONTROL_SOURCE_REF,
    owner_envelope_ref: CONTINUITY_ALPHA_CANARY_OWNER_ENVELOPE_REF,
    dependency_refs: [...CONTINUITY_ALPHA_CANARY_DEPENDENCY_REFS],
    targets: targets(),
    host_canaries: hostCanaries(),
  };
}

function validRun(
  scenarioId: CountedContinuityScenarioId,
  agentId = "kusabi",
  host: ContinuityAlphaHost = "codex",
  suffix = "1",
): ContinuityAlphaRunEvidence {
  const fallbackScenario = scenarioId === "S13";
  return {
    schema_version: "continuity-alpha-run-evidence/v1",
    run_ref: `observed:${scenarioId}:${host}:${suffix}`,
    scenario_id: scenarioId,
    host,
    ordinary_launch_command: CONTINUITY_ALPHA_HOST_CONTRACT[host].command,
    native_start_surface: CONTINUITY_ALPHA_HOST_CONTRACT[host].start_surface,
    fresh_process_started: true,
    startup_path_kind: "ordinary_native",
    source_refs: [`source:${scenarioId}:${host}`],
    ground_truth_ref: `ground-truth:${scenarioId}`,
    identity: {
      agent_id: agentId,
      project: "agent-memory",
      workspace: agentId === "kusabi-gemini" ? "/Users/yuji/Developer/agent-memory" : WORKSPACE,
      runtime: host,
      verified: true,
      binding_ref: `binding:${agentId}:${host}`,
    },
    delivery: {
      first_context_delivered: !fallbackScenario,
      verified: !fallbackScenario,
      placed_only: false,
      evidence_ref: fallbackScenario ? "fallback:hook-failure" : `delivery:${scenarioId}:${host}`,
    },
    timing: {
      t0: "2026-07-25T00:00:00.000Z",
      t1: "2026-07-25T00:00:05.000Z",
      t2: "2026-07-25T00:00:08.000Z",
      t3: "2026-07-25T00:00:20.000Z",
      t4: "2026-07-25T00:00:50.000Z",
    },
    recovery: {
      restart_pack_present: !fallbackScenario,
      fallback_attempted: fallbackScenario,
      missing_context_declared: scenarioId === "S6",
      required_search_used: scenarioId === "S6",
    },
    operator: { path_hidden: true, blind_score: 4.8, restatement_class: "RI0", restatement_count: 0 },
    continuation: {
      probe_supplied_expected_values: false,
      meaningful_action: {
        kind: "verification",
        started: true,
        task_relevant: true,
        selected_from_recovered_state: true,
        evidence_ref: `action:${scenarioId}:${host}`,
        action_receipt_ref: `receipt:${scenarioId}:${host}`,
      },
      useful_result: {
        produced: true,
        task_relevant: true,
        newly_produced: true,
        equals_stored_value_only: false,
        evidence_ref: `result:${scenarioId}:${host}`,
      },
    },
    safety: {
      secret_leak_count: 0,
      private_reasoning_leak_count: 0,
      base_instruction_leak_count: 0,
      raw_transcript_leak_count: 0,
      full_home_path_leak_count: 0,
      cross_agent_leak_count: 0,
      contamination_instruction_follow_count: 0,
    },
    output_bounds: {
      redaction_applied: true,
      byte_cap: 8_192,
      token_cap: 1_800,
      redaction_count: 1,
      truncation_count: 0,
      omitted_section_count: 0,
    },
    fallback: {
      recovery_failed: fallbackScenario,
      ordinary_host_usable: true,
      visible_degraded_result: fallbackScenario,
      evidence_ref: fallbackScenario ? "fallback:visible-and-usable" : "fallback:not-needed",
    },
    scorecard: { S1: 5, S2: 5, S3: 5, S4: 5, S5: 4, S6: 4 },
    scenario: scenarioFacts(scenarioId),
    effects: { ...CONTINUITY_ALPHA_ZERO_EFFECTS },
  };
}

function observedRun(run: ContinuityAlphaRunEvidence, plan: ContinuityAlphaCanaryPlan, index: number): ContinuityAlphaObservedRunEvidence {
  const receiptRef = "https://github.com/watchout/agent-memory/issues/180#issuecomment-9000000001";
  const observed: ContinuityAlphaObservedRunEvidence = {
    ...run,
    observation_receipt: {
      schema_version: CONTINUITY_ALPHA_OBSERVATION_RECEIPT_VERSION,
      capture_id: `capture-${String(index + 1).padStart(2, "0")}-${run.run_ref}`,
      captured_at: new Date(Date.UTC(2026, 6, 25, 0, 0, index)).toISOString(),
      observer_actor: "operator",
      receipt_ref: receiptRef,
      plan_id: plan.plan_id,
      run_ref: run.run_ref,
      exact_head: plan.exact_subject.head,
      exact_tree: plan.exact_subject.tree,
      agent_id: run.identity.agent_id,
      runtime: run.host,
      project: run.identity.project,
      workspace: run.identity.workspace,
      binding_ref: run.identity.binding_ref,
      ordinary_launch_command: run.ordinary_launch_command,
      native_start_surface: run.native_start_surface,
      identity_receipt_ref: receiptRef,
      first_context_receipt_ref: receiptRef,
      action_receipt_ref: receiptRef,
      result_receipt_ref: receiptRef,
      evidence_sha256: "0".repeat(64),
    },
  };
  observed.observation_receipt.evidence_sha256 = continuityAlphaObservedRunDigest(observed);
  return observed;
}

function liveSuite(plan: ContinuityAlphaCanaryPlan): ContinuityAlphaCanarySuiteInput {
  const counted = ([
    "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12", "S13",
  ] as CountedContinuityScenarioId[]).map((scenario) => validRun(scenario));
  const hostRuns = [
    validRun("S14", "kusabi", "codex", "codex"),
    validRun("S14", "spec", "claude_code", "claude"),
    validRun("S14", "kusabi-gemini", "gemini_cli", "gemini"),
  ];
  const runs = [...counted, ...hostRuns].map((run, index) => observedRun(run, plan, index));
  return {
    schema_version: "continuity-alpha-suite-input/v1",
    suite_id: "observed:alpha05:sequential:1",
    evidence_kind: "observed_live_canary",
    s15: {
      fixture_id: S15_FIXTURE_ID,
      fixture_ref: "fixture:S15:source-contract",
      expected_evaluator_version: CONTINUITY_ALPHA_EVALUATOR_VERSION,
    },
    runs,
    p0_sequence: {
      stop_on_first_failure: true,
      aggregate_ref: "observed:p0:aggregate",
      results: CONTINUITY_ALPHA_P0_AGENTS.map((agentId) => ({
        agent_id: agentId,
        passed: true,
        evidence_ref: `observed:p0:${agentId}`,
      })),
    },
    consecutive_passes: {
      count: 2,
      evidence_refs: ["observed:sequence:1", "observed:sequence:2"],
    },
    effects: { ...CONTINUITY_ALPHA_CANARY_ZERO_EFFECTS },
  };
}

const input = planInput();
const plan = buildContinuityAlphaCanaryPlan(input);
assert.equal(plan.status, "ready_for_operator");
assert.equal(plan.evaluator.s15_checked_first, true);
assert.equal(plan.evaluator.s15_passed, true);
assert.deepEqual(plan.contract.p0_order, CONTINUITY_ALPHA_P0_AGENTS);
assert.deepEqual(plan.contract.host_matrix.map((item) => item.runtime), CONTINUITY_ALPHA_HOSTS);
assert.deepEqual(plan.contract.initial_sudden_death_agents, ["kusabi", "spec"]);
assert.equal(plan.host_canary_steps[0].ordinary_command, "codex");
assert.equal(plan.host_canary_steps[1].ordinary_command, "claude");
assert.equal(plan.host_canary_steps[2].ordinary_command, "gemini");
assert(Object.values(plan.preflight_effects).every((count) => count === 0));
assert.equal(plan.claims.live_execution_performed, false);
assert.equal(plan.claims.continuity_alpha_candidate, false);
assert.equal(continuityAlphaCanaryPlanDigest(plan).length, 64);
assert.equal(continuityAlphaCanaryPlanDigest(plan), continuityAlphaCanaryPlanDigest(structuredClone(plan)));

input.targets[0].agent_id = "mutated-after-build";
input.dependency_refs[0] = "mutated-after-build";
assert.equal(plan.targets[0].agent_id, "kusabi");
assert.equal(plan.exact_subject.dependency_refs[0], CONTINUITY_ALPHA_CANARY_DEPENDENCY_REFS[0]);

const canonicalReceiptSuite = liveSuite(plan);
const canonicalReceiptCommentBody = canonicalReceiptSuite.runs
  .map((run) => continuityAlphaObservationReceiptComment(run.observation_receipt))
  .join("\n\n");
let resolvedReceiptCommentBody = canonicalReceiptCommentBody;
let resolvedReceiptCommentAuthor = "operator";
let resolvedReceiptCommentUpdatedAt = "2026-07-25T00:30:00.000Z";
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const id = Number(url.match(/\/issues\/comments\/(\d+)$/)?.[1]);
  if (id === 9_000_000_001) {
    return new Response(JSON.stringify({
      id,
      html_url: "https://github.com/watchout/agent-memory/issues/180#issuecomment-9000000001",
      body: resolvedReceiptCommentBody,
      created_at: "2026-07-25T00:30:00.000Z",
      updated_at: resolvedReceiptCommentUpdatedAt,
      user: { login: resolvedReceiptCommentAuthor },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (id === 5_054_279_853) {
    return new Response(JSON.stringify({
      id,
      html_url: "https://github.com/watchout/agent-memory/issues/180#issuecomment-5054279853",
      body: "owner envelope without a continuity observation receipt",
      created_at: "2026-07-23T00:00:00.000Z",
      updated_at: "2026-07-23T00:00:00.000Z",
      user: { login: "watchout" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("not found", { status: 404 });
};

const pass = await verifyObservedContinuityAlphaCanary(plan, liveSuite(plan));
assert.equal(pass.status, "pass", JSON.stringify(pass, null, 2));
assert.equal(pass.operator_boundary_verified, true);
assert.equal(pass.target_binding_verified, true);
assert.equal(pass.receipt_provenance_verified, true);
assert.equal(pass.verified_receipt_refs.length, 1);
assert.equal(pass.sudden_death_scope_verified, true);
assert.equal(pass.continuity_alpha_candidate, true);
assert.equal(pass.next_action, "none");

const wrongOrder = planInput();
wrongOrder.targets.reverse();
assert(buildContinuityAlphaCanaryPlan(wrongOrder).errors.includes("FAIL_EXACT_P0_ORDER"));
const missingHost = planInput();
missingHost.host_canaries.pop();
assert(buildContinuityAlphaCanaryPlan(missingHost).errors.includes("FAIL_EXACT_HOST_CANARY_COUNT"));
const p0Gemini = planInput();
p0Gemini.targets[2].runtime = "gemini_cli";
assert(buildContinuityAlphaCanaryPlan(p0Gemini).errors.includes("FAIL_P0_GEMINI_REQUIRES_DEDICATED_CANARY:arc"));
const wrongDedicatedGemini = planInput();
wrongDedicatedGemini.host_canaries[2].agent_id = "arc";
assert(buildContinuityAlphaCanaryPlan(wrongDedicatedGemini).errors.includes("FAIL_DEDICATED_GEMINI_CANARY_IDENTITY"));
const badSha = planInput();
badSha.exact_head = "not-a-sha";
assert(buildContinuityAlphaCanaryPlan(badSha).errors.includes("FAIL_EXACT_HEAD"));
const missingDependency = planInput();
missingDependency.dependency_refs.pop();
assert(buildContinuityAlphaCanaryPlan(missingDependency).errors.includes("FAIL_EXACT_DEPENDENCY_REFS"));
const reorderedDependency = planInput();
reorderedDependency.dependency_refs.reverse();
assert(buildContinuityAlphaCanaryPlan(reorderedDependency).errors.includes("FAIL_EXACT_DEPENDENCY_REFS"));
const wrongPlanRef = planInput();
wrongPlanRef.plan_ref = "https://github.com/watchout/agent-memory/issues/180#issuecomment-1";
assert(buildContinuityAlphaCanaryPlan(wrongPlanRef).errors.includes("FAIL_PLAN_REF"));
const wrongControlSource = planInput();
wrongControlSource.control_source_ref = "https://github.com/watchout/agent-memory/issues/180#issuecomment-1";
assert(buildContinuityAlphaCanaryPlan(wrongControlSource).errors.includes("FAIL_CONTROL_SOURCE_REF"));
const wrongOwnerEnvelope = planInput();
wrongOwnerEnvelope.owner_envelope_ref = "https://github.com/watchout/agent-memory/issues/180#issuecomment-1";
assert(buildContinuityAlphaCanaryPlan(wrongOwnerEnvelope).errors.includes("FAIL_OWNER_ENVELOPE_REF"));

const deterministic = liveSuite(plan);
deterministic.evidence_kind = "deterministic_fixture";
const deterministicResult = await verifyObservedContinuityAlphaCanary(plan, deterministic);
assert.equal(deterministicResult.status, "fail");
assert.equal(deterministicResult.operator_boundary_verified, false);
assert(deterministicResult.errors.includes("FAIL_OBSERVED_LIVE_EVIDENCE_REQUIRED"));

const wrongBinding = liveSuite(plan);
wrongBinding.runs[0].identity.binding_ref = "binding:wrong";
assert((await verifyObservedContinuityAlphaCanary(plan, wrongBinding)).errors.some((error) => error.startsWith("FAIL_RUN_BINDING_REF")));
const wrongWorkspace = liveSuite(plan);
wrongWorkspace.runs[0].identity.workspace = "/wrong/workspace";
assert((await verifyObservedContinuityAlphaCanary(plan, wrongWorkspace)).errors.some((error) => error.startsWith("FAIL_RUN_WORKSPACE_BINDING")));
const wrongProject = liveSuite(plan);
wrongProject.runs[0].identity.project = "wrong-project";
assert((await verifyObservedContinuityAlphaCanary(plan, wrongProject)).errors.some((error) => error.startsWith("FAIL_RUN_PROJECT_BINDING")));
const wrongSurface = liveSuite(plan);
wrongSurface.runs[0].native_start_surface = "manual";
assert((await verifyObservedContinuityAlphaCanary(plan, wrongSurface)).errors.some((error) => error.startsWith("FAIL_RUN_NATIVE_START_SURFACE")));
const outsideSuddenDeath = liveSuite(plan);
outsideSuddenDeath.runs.find((run) => run.scenario_id === "S3")!.identity.agent_id = "arc";
outsideSuddenDeath.runs.find((run) => run.scenario_id === "S3")!.identity.runtime = "gemini_cli";
outsideSuddenDeath.runs.find((run) => run.scenario_id === "S3")!.host = "gemini_cli";
assert((await verifyObservedContinuityAlphaCanary(plan, outsideSuddenDeath)).errors.includes("FAIL_INITIAL_SUDDEN_DEATH_SCOPE"));
const wrapper = liveSuite(plan);
wrapper.runs[0].startup_path_kind = "wrapper";
const wrapperResult = await verifyObservedContinuityAlphaCanary(plan, wrapper);
assert.equal(wrapperResult.operator_boundary_verified, false);
assert(wrapperResult.errors.includes("FAIL_OPERATOR_BOUNDARY"));
const storedValueEcho = liveSuite(plan);
storedValueEcho.runs[0].continuation.probe_supplied_expected_values = true;
storedValueEcho.runs[0].continuation.useful_result.equals_stored_value_only = true;
assert.equal((await verifyObservedContinuityAlphaCanary(plan, storedValueEcho)).continuity_alpha_candidate, false);

const missingReceipt = liveSuite(plan);
delete (missingReceipt.runs[0] as Partial<ContinuityAlphaObservedRunEvidence>).observation_receipt;
const missingReceiptResult = await verifyObservedContinuityAlphaCanary(plan, missingReceipt);
assert.equal(missingReceiptResult.receipt_provenance_verified, false);
assert(missingReceiptResult.errors.some((error) => error.startsWith("FAIL_RUN_OBSERVATION_RECEIPT_MISSING")));
const fixtureReceipt = liveSuite(plan);
fixtureReceipt.runs[0].observation_receipt.receipt_ref = "fixture:claimed-live-receipt";
assert((await verifyObservedContinuityAlphaCanary(plan, fixtureReceipt)).errors.some((error) => error.startsWith("FAIL_RUN_OBSERVATION_RECEIPT_REF")));
const unrelatedDurableReceipt = liveSuite(plan);
unrelatedDurableReceipt.runs[0].observation_receipt.receipt_ref = "https://github.com/watchout/agent-memory/issues/180#issuecomment-5054279853";
assert((await verifyObservedContinuityAlphaCanary(plan, unrelatedDurableReceipt)).errors.some((error) => error.startsWith("FAIL_RUN_OBSERVATION_RECEIPT_RESOLUTION")));
resolvedReceiptCommentUpdatedAt = "2026-07-25T00:31:00.000Z";
assert((await verifyObservedContinuityAlphaCanary(plan, liveSuite(plan))).errors.some((error) => error.startsWith("FAIL_RUN_OBSERVATION_RECEIPT_RESOLUTION")));
resolvedReceiptCommentUpdatedAt = "2026-07-25T00:30:00.000Z";
resolvedReceiptCommentAuthor = "unrelated-author";
assert((await verifyObservedContinuityAlphaCanary(plan, liveSuite(plan))).errors.some((error) => error.startsWith("FAIL_RUN_OBSERVATION_RECEIPT_RESOLUTION")));
resolvedReceiptCommentAuthor = "operator";
resolvedReceiptCommentBody = "durable comment without the embedded exact receipt";
assert((await verifyObservedContinuityAlphaCanary(plan, liveSuite(plan))).errors.some((error) => error.startsWith("FAIL_RUN_OBSERVATION_RECEIPT_RESOLUTION")));
resolvedReceiptCommentBody = canonicalReceiptCommentBody;
const forgedReceiptDigest = liveSuite(plan);
forgedReceiptDigest.runs[0].observation_receipt.evidence_sha256 = "f".repeat(64);
const forgedReceiptResult = await verifyObservedContinuityAlphaCanary(plan, forgedReceiptDigest);
assert(forgedReceiptResult.errors.some((error) => error.startsWith("FAIL_RUN_OBSERVATION_RECEIPT_DIGEST")));
assert(forgedReceiptResult.errors.some((error) => error.startsWith("FAIL_RUN_OBSERVATION_RECEIPT_RESOLUTION")));
const missingDeployCounter = liveSuite(plan);
delete (missingDeployCounter.effects as Partial<typeof missingDeployCounter.effects>).deploy_count;
assert((await verifyObservedContinuityAlphaCanary(plan, missingDeployCounter)).errors.includes("FAIL_OPERATOR_BOUNDARY"));
const externalSend = liveSuite(plan);
externalSend.effects.external_send_count = 1;
assert((await verifyObservedContinuityAlphaCanary(plan, externalSend)).errors.includes("FAIL_OPERATOR_BOUNDARY"));

const mutatedPlan = structuredClone(plan);
mutatedPlan.operator_steps[0].ordinary_command = "claude";
const mutatedPlanResult = await verifyObservedContinuityAlphaCanary(mutatedPlan, liveSuite(plan));
assert.equal(mutatedPlanResult.status, "stopped");
assert(mutatedPlanResult.errors.includes("AUTO_FAIL_PLAN_INTEGRITY"));
const forgedPlanId = structuredClone(plan);
forgedPlanId.plan_id = `alpha05:${"f".repeat(64)}`;
assert((await verifyObservedContinuityAlphaCanary(forgedPlanId, liveSuite(plan))).errors.includes("AUTO_FAIL_PLAN_INTEGRITY"));

const stoppedPlan = buildContinuityAlphaCanaryPlan(badSha);
assert.equal(stoppedPlan.next_action.responsible_actor, "implementation_executor");
assert.equal(stoppedPlan.next_action.action, "fix_plan_before_operator_run");
assert.equal((await verifyObservedContinuityAlphaCanary(stoppedPlan, liveSuite(stoppedPlan))).status, "stopped");

const evaluationSchema = JSON.parse(readFileSync(
  "docs/design/schemas/continuity-alpha-evaluation-v1.schema.json",
  "utf8",
));
const canarySchema = JSON.parse(readFileSync(
  "docs/design/schemas/continuity-alpha-canary-v1.schema.json",
  "utf8",
));
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
ajv.addSchema(evaluationSchema);
const validate = ajv.compile(canarySchema);
assert.equal(validate(plan), true, JSON.stringify(validate.errors));
assert.equal(validate(pass), true, JSON.stringify(validate.errors));
assert.equal(validate(stoppedPlan), true, JSON.stringify(validate.errors));
const falseClaim = structuredClone(pass);
falseClaim.continuity_alpha_candidate = false;
assert.equal(validate(falseClaim), false);
const failedFalseClaim = structuredClone(pass);
failedFalseClaim.status = "fail";
failedFalseClaim.errors = ["FAIL_SYNTHETIC"];
failedFalseClaim.continuity_alpha_candidate = true;
failedFalseClaim.next_action = "none";
assert.equal(validate(failedFalseClaim), false);
const stoppedUnsafeAction = structuredClone(stoppedPlan);
stoppedUnsafeAction.next_action = {
  blocking: true,
  responsible_actor: "operator",
  action: "place_and_review_exact_hook_then_run_first_sequential_operator_canary",
};
assert.equal(validate(stoppedUnsafeAction), false);

globalThis.fetch = nativeFetch;
console.log("continuity alpha canary tests passed");
