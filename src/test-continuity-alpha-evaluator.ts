import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  CONTINUITY_ALPHA_EVALUATOR_VERSION,
  CONTINUITY_ALPHA_HOST_CONTRACT,
  CONTINUITY_ALPHA_HOSTS,
  CONTINUITY_ALPHA_P0_AGENTS,
  CONTINUITY_ALPHA_SCENARIOS,
  CONTINUITY_ALPHA_ZERO_EFFECTS,
  S15_FIXTURE_ID,
  evaluateCanonicalS15Fixture,
  evaluateContinuityAlphaRun,
  evaluateContinuityAlphaSuite,
  type ContinuityAlphaHost,
  type ContinuityAlphaRunEvidence,
  type ContinuityAlphaScenarioFacts,
  type ContinuityAlphaSuiteInput,
  type CountedContinuityScenarioId,
} from "./continuity-alpha-evaluator.js";

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

function validRun(
  scenarioId: CountedContinuityScenarioId,
  host: ContinuityAlphaHost = "codex",
  suffix = "1",
): ContinuityAlphaRunEvidence {
  const fallbackScenario = scenarioId === "S13";
  return {
    schema_version: "continuity-alpha-run-evidence/v1",
    run_ref: `evidence:${scenarioId}:${host}:${suffix}`,
    scenario_id: scenarioId,
    host,
    ordinary_launch_command: CONTINUITY_ALPHA_HOST_CONTRACT[host].command,
    native_start_surface: CONTINUITY_ALPHA_HOST_CONTRACT[host].start_surface,
    fresh_process_started: true,
    startup_path_kind: "ordinary_native",
    source_refs: [`source:${scenarioId}:${host}`],
    ground_truth_ref: `ground-truth:${scenarioId}`,
    identity: {
      agent_id: "kusabi",
      project: "agent-memory",
      workspace: "/Users/fixture/Developer/agent-memory",
      runtime: host,
      verified: true,
      binding_ref: `identity:${host}`,
    },
    delivery: {
      first_context_delivered: !fallbackScenario,
      verified: !fallbackScenario,
      placed_only: false,
      evidence_ref: fallbackScenario ? "fallback:hook-failure" : `delivery:${scenarioId}:${host}`,
    },
    timing: {
      t0: "2026-07-24T00:00:00.000Z",
      t1: "2026-07-24T00:00:05.000Z",
      t2: "2026-07-24T00:00:08.000Z",
      t3: "2026-07-24T00:00:20.000Z",
      t4: "2026-07-24T00:00:50.000Z",
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

function validSuite(): ContinuityAlphaSuiteInput {
  const singleRuns = ([
    "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12", "S13",
  ] as CountedContinuityScenarioId[]).map((id) => validRun(id));
  const hostRuns = CONTINUITY_ALPHA_HOSTS.map((host, index) => validRun("S14", host, String(index + 1)));
  return {
    schema_version: "continuity-alpha-suite-input/v1",
    suite_id: "suite:deterministic:alpha04",
    evidence_kind: "deterministic_fixture",
    s15: {
      fixture_id: S15_FIXTURE_ID,
      fixture_ref: "fixture:S15:source-contract",
      expected_evaluator_version: CONTINUITY_ALPHA_EVALUATOR_VERSION,
    },
    runs: [...singleRuns, ...hostRuns],
    p0_sequence: {
      stop_on_first_failure: true,
      aggregate_ref: "fixture:p0:aggregate",
      results: CONTINUITY_ALPHA_P0_AGENTS.map((agentId) => ({
        agent_id: agentId,
        passed: true,
        evidence_ref: `fixture:p0:${agentId}`,
      })),
    },
    consecutive_passes: {
      count: 2,
      evidence_refs: ["fixture:sequence:1", "fixture:sequence:2"],
    },
    effects: { ...CONTINUITY_ALPHA_ZERO_EFFECTS },
  };
}

assert.deepEqual(CONTINUITY_ALPHA_SCENARIOS.map((scenario) => scenario.id), [
  "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12", "S13", "S14", "S15",
]);
assert.deepEqual(CONTINUITY_ALPHA_HOSTS, ["codex", "claude_code", "gemini_cli"]);
assert.equal(CONTINUITY_ALPHA_P0_AGENTS.length, 10);

const s15 = evaluateCanonicalS15Fixture();
assert.equal(s15.passed, true);
assert.equal(s15.candidate_status, "fail");
assert(s15.observed_failure_codes.includes("AUTO_FAIL_STORED_VALUE_ECHO_PROMPT"));
assert(s15.observed_failure_codes.includes("AUTO_FAIL_STORED_VALUE_ECHO_RESULT"));

const passResult = evaluateContinuityAlphaSuite(validSuite());
assert.equal(passResult.status, "pass");
assert.equal(passResult.scoring_performed, true);
assert.equal(passResult.harness_verified, true);
assert.equal(passResult.continuity_alpha_candidate, false);
assert.equal(passResult.claim_boundary, "deterministic_evaluator_only");
assert.deepEqual(passResult.scenario_coverage, CONTINUITY_ALPHA_SCENARIOS.map((scenario) => scenario.id));
assert.equal(passResult.scenario_results.length, 16);
assert(passResult.scenario_results.every((result) => result.status === "pass"));
assert.equal(passResult.host_matrix.passed, true);
assert.equal(passResult.p0_sequence.passed, true);
assert.equal(passResult.consecutive_passes.passed, true);
assert.equal(passResult.automatic_failure_count, 0);
assert.deepEqual(passResult.effects, CONTINUITY_ALPHA_ZERO_EFFECTS);

const liveSuite = validSuite();
liveSuite.evidence_kind = "observed_live_canary";
const liveResult = evaluateContinuityAlphaSuite(liveSuite);
assert.equal(liveResult.status, "pass");
assert.equal(liveResult.continuity_alpha_candidate, true);
assert.equal(liveResult.claim_boundary, "live_candidate_evidence");

const badS15 = validSuite();
badS15.s15.expected_evaluator_version = "weakened-evaluator/0";
const stopped = evaluateContinuityAlphaSuite(badS15);
assert.equal(stopped.status, "stopped");
assert.equal(stopped.scoring_performed, false);
assert.equal(stopped.scenario_results.length, 0);
assert.equal(stopped.scenario_coverage.length, 0);
assert.equal(stopped.next_action, "fix_evaluator_before_scoring");
assert(stopped.errors.includes("AUTO_FAIL_S15_PREREQUISITE"));

const echoRun = validRun("S1");
echoRun.continuation.probe_supplied_expected_values = true;
echoRun.continuation.useful_result.equals_stored_value_only = true;
const echoResult = evaluateContinuityAlphaRun(echoRun);
assert.equal(echoResult.status, "fail");
assert.equal(echoResult.score_admissible, false);
assert(echoResult.automatic_failures.includes("AUTO_FAIL_STORED_VALUE_ECHO_PROMPT"));
assert(echoResult.automatic_failures.includes("AUTO_FAIL_STORED_VALUE_ECHO_RESULT"));

const noReceipt = validRun("S1");
noReceipt.continuation.meaningful_action.action_receipt_ref = "";
assert(evaluateContinuityAlphaRun(noReceipt).automatic_failures.includes("AUTO_FAIL_NO_MEANINGFUL_ACTION_RECEIPT"));
const noNewResult = validRun("S1");
noNewResult.continuation.useful_result.newly_produced = false;
assert(evaluateContinuityAlphaRun(noNewResult).automatic_failures.includes("AUTO_FAIL_NO_NEW_USEFUL_RESULT"));

const slow = validRun("S1");
slow.timing.t4 = "2026-07-24T00:01:00.001Z";
assert(evaluateContinuityAlphaRun(slow).automatic_failures.includes("AUTO_FAIL_T4_THRESHOLD"));
const declaredIdentity = validRun("S1");
declaredIdentity.identity.verified = false;
assert(evaluateContinuityAlphaRun(declaredIdentity).automatic_failures.includes("AUTO_FAIL_IDENTITY_DECLARED_NOT_VERIFIED"));
const wrapper = validRun("S1");
wrapper.startup_path_kind = "wrapper";
assert(evaluateContinuityAlphaRun(wrapper).automatic_failures.includes("AUTO_FAIL_WRAPPER_OR_MANUAL_STARTUP"));
const tuiWrite = validRun("S1");
tuiWrite.effects.tui_write_count = 1;
assert(evaluateContinuityAlphaRun(tuiWrite).automatic_failures.includes("AUTO_FAIL_FORBIDDEN_EFFECT"));

const safeFallback = evaluateContinuityAlphaRun(validRun("S13"));
assert.equal(safeFallback.status, "pass");
const silentFallback = validRun("S13");
silentFallback.fallback.visible_degraded_result = false;
assert(evaluateContinuityAlphaRun(silentFallback).automatic_failures.includes("AUTO_FAIL_S13_SILENT_DEGRADATION"));

const wrongP0 = validSuite();
wrongP0.p0_sequence.results.reverse();
assert(evaluateContinuityAlphaSuite(wrongP0).errors.includes("FAIL_APPROVED_P0_SEQUENCE"));
const missingHost = validSuite();
missingHost.runs = missingHost.runs.filter((run) => !(run.scenario_id === "S14" && run.host === "gemini_cli"));
assert(evaluateContinuityAlphaSuite(missingHost).errors.includes("FAIL_S14_EXACT_NATIVE_HOST_MATRIX"));
const onePass = validSuite();
onePass.consecutive_passes = { count: 1, evidence_refs: ["fixture:sequence:1"] };
assert(evaluateContinuityAlphaSuite(onePass).errors.includes("FAIL_CONSECUTIVE_PASS_EVIDENCE"));

const schema = JSON.parse(readFileSync(
  "docs/design/schemas/continuity-alpha-evaluation-v1.schema.json",
  "utf8",
));
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
assert.equal(validate(passResult), true, JSON.stringify(validate.errors));
assert.equal(validate(liveResult), true, JSON.stringify(validate.errors));
assert.equal(validate(stopped), true, JSON.stringify(validate.errors));
const falseLiveClaim = structuredClone(passResult);
falseLiveClaim.continuity_alpha_candidate = true;
assert.equal(validate(falseLiveClaim), false);
const stoppedWithResults = structuredClone(stopped);
stoppedWithResults.scenario_results.push(passResult.scenario_results[0]);
assert.equal(validate(stoppedWithResults), false);

console.log("continuity alpha evaluator tests passed");
