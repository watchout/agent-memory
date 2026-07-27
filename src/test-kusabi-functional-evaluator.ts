import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  KUSABI_FUNCTIONAL_EVIDENCE_SCHEMA,
  KUSABI_FUNCTIONAL_TESTS,
  KUSABI_G3_HOST_CONTRACT,
  KUSABI_G3_NATIVE_HOSTS,
  KUSABI_RETRIEVAL_CATEGORIES,
  KUSABI_V1_ACCEPTANCE_SCHEMA,
  calculateRetrievalMetrics,
  evaluateKusabiFunctionalEvidence,
  evaluateKusabiV1Acceptance,
  runKusabiRetrievalBenchmark,
  type KusabiFunctionalEvidence,
  type KusabiNativeHost,
  type KusabiRetrievalCase,
  type KusabiRetrievalQuery,
} from "./kusabi-functional-evaluator.js";
import {
  buildRecoveryPackArtifact,
  buildRestartPack,
  RESTART_PACK_TASK_FRESHNESS_WINDOW_MS,
  taskCheckpointIsStale,
  type RestartPackData,
} from "./restart-pack.js";

const FIXTURE_SHA256 = "a".repeat(64);

process.env.AGENT_MEMORY_DISABLE_EMBEDDINGS = "1";
const { isVoyageAvailable } = await import("./stores/voyage.js");
assert.equal(isVoyageAvailable(), false);

function perfectRetrievalCorpus(): KusabiRetrievalQuery[] {
  return Array.from({ length: 30 }, (_, index) => {
    const queryId = `query-${String(index + 1).padStart(2, "0")}`;
    const category = KUSABI_RETRIEVAL_CATEGORIES[Math.floor(index / 5)];
    const expectedRefs = Array.from({ length: 5 }, (_, refIndex) => (
      `memory:${queryId}:${refIndex + 1}`
    ));
    return {
      query_id: queryId,
      category,
      query: `Recover ${category} for ${queryId}`,
      expected_relevant_refs: expectedRefs,
    };
  });
}

function perfectRetrievalCases(): KusabiRetrievalCase[] {
  return perfectRetrievalCorpus().flatMap((entry) => (
    (["json", "sqlite", "postgres"] as const).map((backend) => ({
      ...entry,
      backend,
      returned_refs: [...entry.expected_relevant_refs],
    }))
  ));
}

function validEvidence(
  kind: KusabiFunctionalEvidence["evidence_kind"] = "deterministic_fixture",
  runId = "fixture-run-1",
  host: KusabiNativeHost = "codex",
  sharedGroundTruthRef?: string,
):
KusabiFunctionalEvidence {
  const groundTruthRef = sharedGroundTruthRef ?? `ground_truth:${runId}`;
  const ssotRef = `ssot:${runId}`;
  const usefulResultRef = `result:${runId}`;
  return {
    schema_version: KUSABI_FUNCTIONAL_EVIDENCE_SCHEMA,
    evidence_kind: kind,
    evidence_ref: `evidence:${runId}`,
    run_id: runId,
    session_id: `session:${runId}`,
    proofs: KUSABI_FUNCTIONAL_TESTS.map((test) => ({
      test_id: test.id,
      source_kind: kind,
      ref: test.id === "KBF-02" ? groundTruthRef
        : test.id === "KBF-05" ? ssotRef
        : test.id === "KBF-07" ? usefulResultRef
        : `proof:${runId}:${test.id}`,
      content_sha256: FIXTURE_SHA256,
    })),
    identity: {
      host,
      runtime: host,
      ordinary_launch_command: KUSABI_G3_HOST_CONTRACT[host].command,
      native_start_surface: KUSABI_G3_HOST_CONTRACT[host].start_surface,
      workspace: "/Users/yuji/Developer/agent-memory",
      binding_ref: `binding:${host}:kusabi:agent-memory`,
      native_delivery_confirmed: true,
      fresh_session_confirmed: true,
      launch_mode: kind === "deterministic_fixture" ? "test_harness" : "ordinary_command",
      identity_verified: true,
      expected_agent_id: "kusabi",
      observed_agent_id: "kusabi",
      expected_project: "agent-memory",
      observed_project: "agent-memory",
      store_backend: "postgres",
      store_binding_ref: `store-binding:${"9".repeat(64)}`,
      store_binding_verified: true,
      credentials_embedded: false,
    },
    recovery: {
      ground_truth_ref: groundTruthRef,
      ground_truth_frozen_at: "2026-07-25T23:35:00.000Z",
      ground_truth_source_refs: [groundTruthRef],
      expected_objective_terms: ["Kusabi continuity alpha", "ALPHA-05"],
      recovered_objective: "Kusabi continuity alpha — ALPHA-05 observed live canary",
      expected_next_action_terms: ["verify", "hooks", "Issue #180"],
      recovered_next_action: "Verify hooks and the latest Issue #180 evidence before continuing.",
      expected_constraint_terms: ["no TUI", "no automatic restart"],
      recovered_constraints: "No TUI and no automatic restart are allowed.",
      expected_blocker_terms: [],
      recovered_blockers: "",
      critical_facts: [
        { key: "hooks_sha256", expected: "a7ce8e", recovered: "a7ce8e" },
        { key: "trusted_hash", expected: "f7c568", recovered: "f7c568" },
        { key: "pr_272", expected: "merged", recovered: "merged" },
      ],
      confidence: "high",
      missing_context: [],
      ssot_check_performed: true,
      ssot_evidence_ref: ssotRef,
      ssot_conflict_detected: false,
      corrected_to_ssot: false,
      stale_action_avoided: true,
    },
    safety: {
      redaction_applied: true,
      secret_leak_count: 0,
      private_reasoning_leak_count: 0,
      base_instruction_leak_count: 0,
      full_home_path_leak_count: 0,
      forbidden_effect_count: 0,
    },
    continuation: {
      restatement_class: "RI0",
      restatement_count: 0,
      meaningful_action_started: true,
      meaningful_action_ref: "transcript:action-1",
      useful_result_produced: true,
      useful_result_new: true,
      useful_result_equals_stored_value_only: false,
      useful_result_ref: usefulResultRef,
      useful_result_kind: "test_receipt",
      useful_result_created_at: "2026-07-25T23:39:36.091Z",
      useful_result_content_sha256: "b".repeat(64),
      recovered_context_content_sha256: "c".repeat(64),
    },
    degradation: {
      fixture_tested: true,
      fixture_passed: true,
      ordinary_host_usable: true,
      visible_degraded_result: true,
    },
    retrieval: {
      ground_truth_frozen: true,
      execution_kind: "deterministic_fixture",
      top_k: 5,
      cases: perfectRetrievalCases(),
    },
    performance: {
      t0: "2026-07-25T23:35:38.585Z",
      t1: "2026-07-25T23:38:50.811Z",
      t3: "2026-07-25T23:38:56.554Z",
      t4: "2026-07-25T23:39:36.091Z",
    },
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function verifiedObservedProofs(...evidenceItems: KusabiFunctionalEvidence[]) {
  return evidenceItems.flatMap((evidence) => evidence.proofs.map((proof) => ({
    ref: proof.ref,
    content_sha256: proof.content_sha256,
  })));
}

const valid = evaluateKusabiFunctionalEvidence(validEvidence());
assert.equal(valid.tests.length, 9);
assert.deepEqual(valid.tests.map((test) => test.id), KUSABI_FUNCTIONAL_TESTS.map((test) => test.id));
assert(valid.tests.every((test) => test.evidence_admissible));
assert.equal(valid.functional_core_pass, true);
assert.equal(valid.quality_ready, true);
assert.equal(valid.live_evidence_admissible, false);
assert.equal(valid.live_claim_eligible, false);
assert.equal(valid.retrieval_metrics.benchmark_ready, true);
assert.equal(valid.retrieval_metrics.case_count, 90);
assert.equal(valid.retrieval_metrics.query_count, 30);
assert.equal(valid.retrieval_metrics.top_k, 5);
assert.deepEqual(
  Object.values(valid.retrieval_metrics.category_counts),
  [5, 5, 5, 5, 5, 5],
);
assert.equal(valid.retrieval_metrics.precision_at_k, 1);
assert.equal(valid.retrieval_metrics.recall_at_k, 1);
assert.equal(valid.retrieval_metrics.ndcg_at_k, 1);
assert.equal(valid.retrieval_metrics.backend_parity_verified, true);
assert.equal(valid.performance.blocking, false);
assert.equal(valid.performance.t1_ms, 192_226);
assert.equal(valid.performance.t3_ms, 197_969);
assert.equal(valid.performance.t4_ms, 237_506);

const invalidHostBindings: Array<{
  reason: string;
  mutate: (evidence: KusabiFunctionalEvidence) => void;
}> = [
  {
    reason: "KBF01_RUNTIME_HOST_MISMATCH",
    mutate: (evidence) => { evidence.identity.runtime = "claude_code"; },
  },
  {
    reason: "KBF01_ORDINARY_COMMAND_MISMATCH",
    mutate: (evidence) => { evidence.identity.ordinary_launch_command = "codex-wrapper"; },
  },
  {
    reason: "KBF01_NATIVE_START_SURFACE_MISMATCH",
    mutate: (evidence) => { evidence.identity.native_start_surface = "manual_mcp"; },
  },
  {
    reason: "KBF01_WORKSPACE_MISSING",
    mutate: (evidence) => { evidence.identity.workspace = ""; },
  },
  {
    reason: "KBF01_BINDING_REF_MISSING",
    mutate: (evidence) => { evidence.identity.binding_ref = ""; },
  },
  {
    reason: "KBF01_STORE_BINDING_REF_INVALID",
    mutate: (evidence) => { evidence.identity.store_binding_ref = "store-binding:not-a-sha256"; },
  },
];
for (const fixture of invalidHostBindings) {
  const evidence = validEvidence();
  fixture.mutate(evidence);
  const result = evaluateKusabiFunctionalEvidence(evidence);
  const kbf01 = result.tests.find((test) => test.id === "KBF-01");
  assert.equal(kbf01?.status, "fail");
  assert(kbf01?.reasons.includes(fixture.reason));
  assert.equal(result.functional_core_pass, false);
}

const callerLabeledLive = validEvidence("observed_live_canary");
const callerLabeledLiveResult = evaluateKusabiFunctionalEvidence(callerLabeledLive);
assert(callerLabeledLiveResult.tests.every((test) => test.status === "not_measured"));
assert(callerLabeledLiveResult.tests.every((test) => !test.evidence_admissible));
assert.equal(callerLabeledLiveResult.functional_core_pass, false);
assert.equal(callerLabeledLiveResult.quality_ready, false);
assert.equal(callerLabeledLiveResult.live_evidence_admissible, false);
assert.equal(callerLabeledLiveResult.live_claim_eligible, false);

const mismatchedLiveDigestResult = evaluateKusabiFunctionalEvidence(callerLabeledLive, {
  verified_live_proofs: callerLabeledLive.proofs.map((proof) => ({
    ref: proof.ref,
    content_sha256: "b".repeat(64),
  })),
});
assert(mismatchedLiveDigestResult.tests.every((test) => test.status === "not_measured"));
assert.equal(mismatchedLiveDigestResult.live_evidence_admissible, false);

const invalidFixtureProof = validEvidence();
invalidFixtureProof.proofs[0].content_sha256 = "not-a-sha256";
const invalidFixtureProofResult = evaluateKusabiFunctionalEvidence(invalidFixtureProof);
assert.equal(invalidFixtureProofResult.tests[0].status, "not_measured");
assert.equal(invalidFixtureProofResult.tests[0].evidence_admissible, false);
assert(invalidFixtureProofResult.errors.includes("KBF01_EVIDENCE_NOT_VERIFIED"));

const currentCanary = validEvidence("observed_live_canary");
currentCanary.evidence_ref = "recovery_quality_log:99114c0a-7316-491e-9871-974e2476be19";
currentCanary.recovery.ground_truth_ref =
  "https://github.com/watchout/agent-memory/issues/180#issuecomment-5077690360";
currentCanary.recovery.ground_truth_source_refs = [currentCanary.recovery.ground_truth_ref];
currentCanary.recovery.ssot_evidence_ref = currentCanary.recovery.ground_truth_ref;
currentCanary.proofs = currentCanary.proofs.map((proof) => (
  proof.test_id === "KBF-02" || proof.test_id === "KBF-05"
    ? { ...proof, ref: currentCanary.recovery.ground_truth_ref }
    : proof
));
currentCanary.recovery.critical_facts = [
  {
    key: "hooks_sha256",
    expected: "a7ce8e895ac62dac905ec6449d6447732c16b4cced967b29d5f0ac68693563a2",
    recovered: "3eb330716851732d5be9c673073a7f56ce8da3e33d6347bc0acf972f7e34aef9",
  },
  {
    key: "trusted_hash",
    expected: "sha256:f7c5688d4fb2115b74e415d7eb0b5b87d5189e726ece111761cbe79956a797c2",
    recovered: "sha256:339043d1938333c95d7cdbe0cff5fb3de014c07021301dcd0002eb9abdd34ffe",
  },
  { key: "pr_272", expected: "merged", recovered: null },
];
currentCanary.recovery.confidence = "high";
currentCanary.recovery.missing_context = [];
currentCanary.recovery.ssot_conflict_detected = true;
currentCanary.recovery.corrected_to_ssot = true;
currentCanary.retrieval.ground_truth_frozen = false;
currentCanary.retrieval.cases = [];
const currentCanaryResult = evaluateKusabiFunctionalEvidence(currentCanary);
assert.deepEqual(
  currentCanaryResult.tests.map((test) => [test.id, test.status]),
  [
    ["KBF-01", "not_measured"],
    ["KBF-02", "not_measured"],
    ["KBF-03", "not_measured"],
    ["KBF-04", "fail"],
    ["KBF-05", "not_measured"],
    ["KBF-06", "not_measured"],
    ["KBF-07", "not_measured"],
    ["KBF-08", "not_measured"],
    ["KBF-09", "not_measured"],
  ],
);
assert(currentCanaryResult.errors.includes("KBF04_STALE_OR_MISSING_CRITICAL_FACT"));
assert(currentCanaryResult.errors.includes("KBF04_CONFIDENCE_OVERCLAIM"));
assert(currentCanaryResult.errors.includes("KBF01_EVIDENCE_NOT_VERIFIED"));
assert.equal(currentCanaryResult.functional_core_pass, false);
assert.equal(currentCanaryResult.quality_ready, false);
assert.equal(currentCanaryResult.live_evidence_admissible, false);
assert.equal(currentCanaryResult.live_claim_eligible, false);

const highConfidenceStaleMarker = validEvidence();
highConfidenceStaleMarker.recovery.missing_context = ["task_checkpoint_stale"];
const highConfidenceStaleMarkerResult = evaluateKusabiFunctionalEvidence(highConfidenceStaleMarker);
assert.equal(highConfidenceStaleMarkerResult.tests.find((test) => test.id === "KBF-04")?.status, "fail");
assert(highConfidenceStaleMarkerResult.errors.includes("KBF04_CONFIDENCE_OVERCLAIM"));
assert.equal(highConfidenceStaleMarkerResult.functional_core_pass, false);

const failClosedFreshnessMarkers = [
  "task_checkpoint_stale",
  "task_checkpoint_freshness_unknown",
] as const;
for (const marker of failClosedFreshnessMarkers) {
  const mediumConfidenceEvidence = validEvidence();
  mediumConfidenceEvidence.recovery.confidence = "medium";
  mediumConfidenceEvidence.recovery.missing_context = [marker];
  const result = evaluateKusabiFunctionalEvidence(mediumConfidenceEvidence);
  const kbf04 = result.tests.find((test) => test.id === "KBF-04");
  assert.equal(kbf04?.status, "fail");
  assert(kbf04?.reasons.includes("KBF04_STALE_OR_MISSING_CRITICAL_FACT"));
  assert(!kbf04?.reasons.includes("KBF04_CONFIDENCE_OVERCLAIM"));
  assert.equal(result.functional_core_pass, false);
}

const missingCriticalFacts = validEvidence();
missingCriticalFacts.recovery.critical_facts = [];
const missingCriticalFactsResult = evaluateKusabiFunctionalEvidence(missingCriticalFacts);
assert.equal(missingCriticalFactsResult.tests.find((test) => test.id === "KBF-04")?.status, "fail");
assert(missingCriticalFactsResult.errors.includes("KBF04_CRITICAL_FACTS_NOT_PROVIDED"));
assert.equal(missingCriticalFactsResult.functional_core_pass, false);

const groundTruthFrozenTooLate = validEvidence();
groundTruthFrozenTooLate.recovery.ground_truth_frozen_at = "2026-07-25T23:35:39.000Z";
const groundTruthFrozenTooLateResult = evaluateKusabiFunctionalEvidence(groundTruthFrozenTooLate);
assert.equal(groundTruthFrozenTooLateResult.tests.find((test) => test.id === "KBF-02")?.status, "fail");
assert(groundTruthFrozenTooLateResult.errors.includes("KBF02_GROUND_TRUTH_NOT_FROZEN_BEFORE_RUN"));

const missingConstraints = validEvidence();
missingConstraints.recovery.recovered_constraints = "";
const missingConstraintsResult = evaluateKusabiFunctionalEvidence(missingConstraints);
assert.equal(missingConstraintsResult.tests.find((test) => test.id === "KBF-03")?.status, "fail");
assert(missingConstraintsResult.errors.includes("KBF03_CONSTRAINTS_GROUND_TRUTH_MISMATCH"));

const reusedResult = validEvidence();
reusedResult.continuation.useful_result_content_sha256 =
  reusedResult.continuation.recovered_context_content_sha256;
const reusedResultResult = evaluateKusabiFunctionalEvidence(reusedResult);
assert.equal(reusedResultResult.tests.find((test) => test.id === "KBF-07")?.status, "fail");
assert(reusedResultResult.errors.includes("KBF07_USEFUL_RESULT_CONTENT_NOT_NEW"));

const preexistingResult = validEvidence();
preexistingResult.continuation.useful_result_created_at = "2026-07-25T23:35:00.000Z";
const preexistingResultResult = evaluateKusabiFunctionalEvidence(preexistingResult);
assert.equal(preexistingResultResult.tests.find((test) => test.id === "KBF-07")?.status, "fail");
assert(preexistingResultResult.errors.includes("KBF07_USEFUL_RESULT_NOT_CREATED_AFTER_T0"));

const uncorrected = clone(currentCanary);
uncorrected.recovery.ssot_conflict_detected = false;
uncorrected.recovery.corrected_to_ssot = false;
uncorrected.recovery.stale_action_avoided = false;
const uncorrectedResult = evaluateKusabiFunctionalEvidence(uncorrected);
assert.equal(uncorrectedResult.tests.find((test) => test.id === "KBF-05")?.status, "fail");
assert.equal(uncorrectedResult.functional_core_pass, false);

const safetyLeak = validEvidence();
safetyLeak.safety.secret_leak_count = 1;
const safetyLeakResult = evaluateKusabiFunctionalEvidence(safetyLeak);
assert.equal(safetyLeakResult.tests.find((test) => test.id === "KBF-06")?.status, "fail");
assert.equal(safetyLeakResult.functional_core_pass, false);

const storedEcho = validEvidence();
storedEcho.continuation.useful_result_equals_stored_value_only = true;
const storedEchoResult = evaluateKusabiFunctionalEvidence(storedEcho);
assert.equal(storedEchoResult.tests.find((test) => test.id === "KBF-07")?.status, "fail");
assert.equal(storedEchoResult.functional_core_pass, false);

const retrievalNotMeasured = validEvidence();
retrievalNotMeasured.retrieval.ground_truth_frozen = false;
retrievalNotMeasured.retrieval.cases = [];
const retrievalNotMeasuredResult = evaluateKusabiFunctionalEvidence(retrievalNotMeasured);
assert.equal(retrievalNotMeasuredResult.tests.find((test) => test.id === "KBF-09")?.status, "not_measured");
assert.equal(retrievalNotMeasuredResult.functional_core_pass, true);
assert.equal(retrievalNotMeasuredResult.quality_ready, false);
assert.equal(retrievalNotMeasuredResult.retrieval_metrics.benchmark_ready, false);

const incompleteRetrieval = validEvidence();
incompleteRetrieval.retrieval.cases = incompleteRetrieval.retrieval.cases.slice(0, 3);
const incompleteRetrievalResult = evaluateKusabiFunctionalEvidence(incompleteRetrieval);
assert.equal(incompleteRetrievalResult.retrieval_metrics.measured, true);
assert.equal(incompleteRetrievalResult.retrieval_metrics.benchmark_ready, false);
assert.equal(incompleteRetrievalResult.tests.find((test) => test.id === "KBF-09")?.status, "not_measured");

const unbalancedCategories = validEvidence();
unbalancedCategories.retrieval.cases = unbalancedCategories.retrieval.cases.map((entry) => (
  entry.query_id === "query-01" ? { ...entry, category: "next_action_blocker" } : entry
));
const unbalancedCategoriesResult = evaluateKusabiFunctionalEvidence(unbalancedCategories);
assert.equal(unbalancedCategoriesResult.retrieval_metrics.benchmark_ready, false);
assert.equal(unbalancedCategoriesResult.tests.find((test) => test.id === "KBF-09")?.status, "not_measured");

const shallowResults = validEvidence();
shallowResults.retrieval.cases = shallowResults.retrieval.cases.map((entry) => ({
  ...entry,
  returned_refs: entry.returned_refs.slice(0, 4),
}));
const shallowResultsResult = evaluateKusabiFunctionalEvidence(shallowResults);
assert.equal(shallowResultsResult.retrieval_metrics.benchmark_ready, false);
assert.equal(shallowResultsResult.tests.find((test) => test.id === "KBF-09")?.status, "not_measured");

const weakBenchmark = validEvidence();
weakBenchmark.retrieval.cases = weakBenchmark.retrieval.cases.map((entry) => ({
  ...entry,
  returned_refs: Array.from({ length: 5 }, (_, index) => `irrelevant:${entry.query_id}:${index}`),
}));
const weakBenchmarkResult = evaluateKusabiFunctionalEvidence(weakBenchmark);
assert.equal(weakBenchmarkResult.retrieval_metrics.benchmark_ready, true);
assert.equal(weakBenchmarkResult.tests.find((test) => test.id === "KBF-09")?.status, "fail");
assert(weakBenchmarkResult.errors.includes("KBF09_PRECISION_BELOW_THRESHOLD"));
assert(weakBenchmarkResult.errors.includes("KBF09_RECALL_BELOW_THRESHOLD"));
assert(weakBenchmarkResult.errors.includes("KBF09_NDCG_BELOW_THRESHOLD"));

const divergentBackends = validEvidence();
divergentBackends.retrieval.cases = divergentBackends.retrieval.cases.map((entry) => entry.backend === "json" ? {
  ...entry,
  returned_refs: Array.from({ length: 5 }, (_, index) => `irrelevant:${entry.query_id}:${index}`),
} : entry);
const divergentBackendsResult = evaluateKusabiFunctionalEvidence(divergentBackends);
assert.equal(divergentBackendsResult.retrieval_metrics.benchmark_ready, true);
assert.equal(divergentBackendsResult.retrieval_metrics.backend_parity_verified, false);
assert(divergentBackendsResult.errors.includes("KBF09_BACKEND_PARITY_NOT_VERIFIED"));

const corpusByQuery = new Map(perfectRetrievalCorpus().map((entry) => (
  [entry.query, entry.expected_relevant_refs] as const
)));
let realBackendCallCount = 0;
const realBackendRetrieval = await runKusabiRetrievalBenchmark(
  perfectRetrievalCorpus(),
  (["json", "sqlite", "postgres"] as const).map((backend) => ({
    backend,
    execution_kind: "real_backend" as const,
    search: async (query: string, topK: 5) => {
      realBackendCallCount += 1;
      assert.equal(topK, 5);
      return [...(corpusByQuery.get(query) ?? [])];
    },
  })),
);
assert.equal(realBackendCallCount, 90);
assert.equal(realBackendRetrieval.execution_kind, "real_backend");
assert.equal(realBackendRetrieval.top_k, 5);
assert.equal(realBackendRetrieval.cases.length, 90);
await assert.rejects(
  runKusabiRetrievalBenchmark(perfectRetrievalCorpus(), [{
    backend: "json",
    execution_kind: "real_backend",
    search: async () => [],
  }]),
  /KBF09_EXACT_BACKEND_ADAPTER_SET_REQUIRED/,
);

const integrationEvidence = validEvidence("observed_integration", "integration-run-1");
integrationEvidence.retrieval = realBackendRetrieval;
const liveEvidenceRuns = KUSABI_G3_NATIVE_HOSTS.map((host, index) => (
  validEvidence("observed_live_canary", `live-run-${index + 1}`, host, "ground_truth:g3-shared")
));
const g1Proof = { ref: "ci:kbf-v1-fixed", content_sha256: "d".repeat(64) };
const auditProof = { ref: "audit:kbf-v1", content_sha256: "e".repeat(64) };
const acceptanceInput = {
  g1: { suite_id: "kbf-v1-fixed" as const, passed: true, proof: g1Proof },
  g2: integrationEvidence,
  g3: liveEvidenceRuns,
  blocking_defects: [],
  independent_audit: { completed: true, blocking_finding_count: 0, proof: auditProof },
};
const acceptanceOptions = {
  verified_gate_proofs: [g1Proof, auditProof],
  verified_observed_proofs: verifiedObservedProofs(integrationEvidence, ...liveEvidenceRuns),
};
const acceptance = evaluateKusabiV1Acceptance(acceptanceInput, acceptanceOptions);
assert.equal(acceptance.schema_version, KUSABI_V1_ACCEPTANCE_SCHEMA);
assert.equal(acceptance.verdict, "PASS");
assert.equal(acceptance.kusabi_v1_pass, true);
assert.deepEqual(acceptance.gates, {
  g1_evaluator_contract: "pass",
  g2_integration: "pass",
  g3_live_canary: "pass",
  independent_r2_audit: "pass",
});
assert.equal(acceptance.live_pass_count, 3);
assert.equal(acceptance.required_live_pass_count, 3);
assert.deepEqual(acceptance.g3_native_host_matrix, {
  required_hosts: ["codex", "claude_code", "gemini_cli"],
  observed_hosts: ["codex", "claude_code", "gemini_cli"],
  pass_by_host: { codex: true, claude_code: true, gemini_cli: true },
  exact: true,
});
assert.deepEqual(acceptance.g3_agent_continuity, {
  canonical_agent_id: "kusabi",
  observed_agent_ids: ["kusabi", "kusabi", "kusabi"],
  observed_projects: ["agent-memory", "agent-memory", "agent-memory"],
  observed_workspaces: [
    "/Users/yuji/Developer/agent-memory",
    "/Users/yuji/Developer/agent-memory",
    "/Users/yuji/Developer/agent-memory",
  ],
  binding_refs: [
    "binding:codex:kusabi:agent-memory",
    "binding:claude_code:kusabi:agent-memory",
    "binding:gemini_cli:kusabi:agent-memory",
  ],
  observed_store_backends: ["postgres", "postgres", "postgres"],
  store_binding_refs: [
    `store-binding:${"9".repeat(64)}`,
    `store-binding:${"9".repeat(64)}`,
    `store-binding:${"9".repeat(64)}`,
  ],
  same_agent_id: true,
  same_project: true,
  same_workspace: true,
  distinct_runtime_bindings: true,
  same_ground_truth: true,
  same_store_binding: true,
  exact: true,
});
assert.equal(acceptance.blocking_defect_count, 0);

// A three-host run over different agent namespaces used to false-pass G3.
// Kusabi continuity follows the canonical agent_id across runtime/profile swaps.
const differentAgentIds = clone(liveEvidenceRuns);
differentAgentIds[1].identity.expected_agent_id = "spec";
differentAgentIds[1].identity.observed_agent_id = "spec";
differentAgentIds[2].identity.expected_agent_id = "kusabi-gemini";
differentAgentIds[2].identity.observed_agent_id = "kusabi-gemini";
const differentAgentIdsResult = evaluateKusabiV1Acceptance({
  ...acceptanceInput,
  g3: differentAgentIds,
}, acceptanceOptions);
assert.equal(differentAgentIdsResult.verdict, "FAIL");
assert.equal(differentAgentIdsResult.gates.g3_live_canary, "fail");
assert.equal(differentAgentIdsResult.g3_agent_continuity.same_agent_id, false);
assert(differentAgentIdsResult.reasons.includes("G3_CANONICAL_AGENT_ID_MISMATCH"));

// Individually valid runs cannot pass when they recover different frozen work.
const differentGroundTruth = clone(liveEvidenceRuns);
differentGroundTruth[2].recovery.ground_truth_ref = "ground_truth:other-work";
differentGroundTruth[2].recovery.ground_truth_source_refs = ["ground_truth:other-work"];
const differentGroundTruthResult = evaluateKusabiV1Acceptance({
  ...acceptanceInput,
  g3: differentGroundTruth,
}, acceptanceOptions);
assert.equal(differentGroundTruthResult.verdict, "FAIL");
assert.equal(differentGroundTruthResult.g3_agent_continuity.same_ground_truth, false);
assert(differentGroundTruthResult.reasons.includes("G3_FROZEN_GROUND_TRUTH_MISMATCH"));

// Host/profile bindings must change while the canonical continuity identity stays fixed.
const duplicateRuntimeBindings = clone(liveEvidenceRuns);
duplicateRuntimeBindings[1].identity.binding_ref = duplicateRuntimeBindings[0].identity.binding_ref;
const duplicateRuntimeBindingsResult = evaluateKusabiV1Acceptance({
  ...acceptanceInput,
  g3: duplicateRuntimeBindings,
}, acceptanceOptions);
assert.equal(duplicateRuntimeBindingsResult.verdict, "FAIL");
assert.equal(duplicateRuntimeBindingsResult.g3_agent_continuity.distinct_runtime_bindings, false);
assert(duplicateRuntimeBindingsResult.reasons.includes("G3_DISTINCT_RUNTIME_BINDINGS_REQUIRED"));

// SQLite and PostgreSQL are both valid choices, but a single G3 run may not drift between them.
const differentStoreBackends = clone(liveEvidenceRuns);
differentStoreBackends[1].identity.store_backend = "sqlite";
differentStoreBackends[1].identity.store_binding_ref = `store-binding:${"8".repeat(64)}`;
const differentStoreBackendsResult = evaluateKusabiV1Acceptance({
  ...acceptanceInput,
  g3: differentStoreBackends,
}, acceptanceOptions);
assert.equal(differentStoreBackendsResult.verdict, "FAIL");
assert.equal(differentStoreBackendsResult.g3_agent_continuity.same_store_binding, false);
assert(differentStoreBackendsResult.reasons.includes("G3_STORE_BINDING_MISMATCH"));

const sqliteLiveRuns = clone(liveEvidenceRuns);
for (const evidence of sqliteLiveRuns) {
  evidence.identity.store_backend = "sqlite";
  evidence.identity.store_binding_ref = `store-binding:${"7".repeat(64)}`;
}
const sqliteAcceptance = evaluateKusabiV1Acceptance({
  ...acceptanceInput,
  g3: sqliteLiveRuns,
}, acceptanceOptions);
assert.equal(sqliteAcceptance.verdict, "PASS");
assert.equal(sqliteAcceptance.g3_agent_continuity.same_store_binding, true);

const onlyTwoLiveRuns = evaluateKusabiV1Acceptance({
  ...acceptanceInput,
  g3: liveEvidenceRuns.slice(0, 2),
}, acceptanceOptions);
assert.equal(onlyTwoLiveRuns.verdict, "INCOMPLETE");
assert.equal(onlyTwoLiveRuns.kusabi_v1_pass, false);
assert.equal(onlyTwoLiveRuns.gates.g3_live_canary, "incomplete");

const duplicateLiveSessions = clone(liveEvidenceRuns);
duplicateLiveSessions[2].session_id = duplicateLiveSessions[1].session_id;
const duplicateLiveSessionsResult = evaluateKusabiV1Acceptance({
  ...acceptanceInput,
  g3: duplicateLiveSessions,
}, acceptanceOptions);
assert.equal(duplicateLiveSessionsResult.verdict, "INCOMPLETE");
assert.equal(duplicateLiveSessionsResult.gates.g3_live_canary, "incomplete");
assert(duplicateLiveSessionsResult.reasons.includes("G3_DISTINCT_SESSION_PER_NATIVE_HOST_REQUIRED"));

const duplicateNativeHosts = clone(liveEvidenceRuns);
duplicateNativeHosts[2].identity.host = "codex";
duplicateNativeHosts[2].identity.runtime = "codex";
duplicateNativeHosts[2].identity.ordinary_launch_command = "codex";
duplicateNativeHosts[2].identity.native_start_surface = "codex_session_start";
const duplicateNativeHostsResult = evaluateKusabiV1Acceptance({
  ...acceptanceInput,
  g3: duplicateNativeHosts,
}, acceptanceOptions);
assert.equal(duplicateNativeHostsResult.verdict, "INCOMPLETE");
assert.equal(duplicateNativeHostsResult.gates.g3_live_canary, "incomplete");
assert.equal(duplicateNativeHostsResult.g3_native_host_matrix.exact, false);
assert.deepEqual(duplicateNativeHostsResult.g3_native_host_matrix.pass_by_host, {
  codex: false,
  claude_code: true,
  gemini_cli: false,
});
assert(duplicateNativeHostsResult.reasons.includes("G3_EXACT_NATIVE_HOST_MATRIX_REQUIRED"));

const wrongNativeSurface = clone(liveEvidenceRuns);
wrongNativeSurface[1].identity.native_start_surface = "codex_session_start";
const wrongNativeSurfaceResult = evaluateKusabiV1Acceptance({
  ...acceptanceInput,
  g3: wrongNativeSurface,
}, acceptanceOptions);
assert.equal(wrongNativeSurfaceResult.verdict, "FAIL");
assert(wrongNativeSurfaceResult.reasons.includes("G3_VERIFIED_FUNCTIONAL_CORE_FAILURE"));

const wrongOrdinaryCommand = clone(liveEvidenceRuns);
wrongOrdinaryCommand[2].identity.ordinary_launch_command = "gemini-wrapper";
const wrongOrdinaryCommandResult = evaluateKusabiV1Acceptance({
  ...acceptanceInput,
  g3: wrongOrdinaryCommand,
}, acceptanceOptions);
assert.equal(wrongOrdinaryCommandResult.verdict, "FAIL");
assert(wrongOrdinaryCommandResult.reasons.includes("G3_VERIFIED_FUNCTIONAL_CORE_FAILURE"));

const deterministicIntegration = clone(integrationEvidence);
deterministicIntegration.retrieval.execution_kind = "deterministic_fixture";
const deterministicIntegrationResult = evaluateKusabiV1Acceptance({
  ...acceptanceInput,
  g2: deterministicIntegration,
}, acceptanceOptions);
assert.equal(deterministicIntegrationResult.verdict, "INCOMPLETE");
assert.equal(deterministicIntegrationResult.gates.g2_integration, "incomplete");

const blockingDefectResult = evaluateKusabiV1Acceptance({
  ...acceptanceInput,
  blocking_defects: [{
    kind: "secret_exposure" as const,
    evidence_ref: "evidence:secret-exposure-1",
  }],
}, acceptanceOptions);
assert.equal(blockingDefectResult.verdict, "FAIL");
assert.equal(blockingDefectResult.blocking_defect_count, 1);

const failedLiveRuns = clone(liveEvidenceRuns);
failedLiveRuns[1].safety.secret_leak_count = 1;
const failedLiveResult = evaluateKusabiV1Acceptance({
  ...acceptanceInput,
  g3: failedLiveRuns,
}, acceptanceOptions);
assert.equal(failedLiveResult.verdict, "FAIL");
assert.equal(failedLiveResult.gates.g3_live_canary, "fail");

const wrapperLiveRuns = clone(liveEvidenceRuns);
wrapperLiveRuns[0].identity.launch_mode = "wrapper";
const wrapperLiveResult = evaluateKusabiV1Acceptance({
  ...acceptanceInput,
  g3: wrapperLiveRuns,
}, acceptanceOptions);
assert.equal(wrapperLiveResult.verdict, "FAIL");
assert.equal(wrapperLiveResult.gates.g3_live_canary, "fail");

const auditIncompleteResult = evaluateKusabiV1Acceptance({
  ...acceptanceInput,
  independent_audit: {
    ...acceptanceInput.independent_audit,
    completed: false,
  },
}, acceptanceOptions);
assert.equal(auditIncompleteResult.verdict, "INCOMPLETE");
assert.equal(auditIncompleteResult.gates.independent_r2_audit, "incomplete");

const currentV1Result = evaluateKusabiV1Acceptance({
  g1: acceptanceInput.g1,
  g2: validEvidence("deterministic_fixture", "current-g2-unmeasured"),
  g3: [currentCanary],
  blocking_defects: [],
  independent_audit: {
    completed: false,
    blocking_finding_count: 0,
    proof: auditProof,
  },
}, {
  verified_gate_proofs: [g1Proof],
  verified_observed_proofs: [],
});
assert.equal(currentV1Result.verdict, "INCOMPLETE");
assert.equal(currentV1Result.kusabi_v1_pass, false);
assert.deepEqual(currentV1Result.gates, {
  g1_evaluator_contract: "pass",
  g2_integration: "incomplete",
  g3_live_canary: "incomplete",
  independent_r2_audit: "incomplete",
});

const weakRetrieval = calculateRetrievalMetrics(
  ["relevant:1", "relevant:2"],
  ["irrelevant:1", "relevant:1", "irrelevant:2"],
);
assert.equal(weakRetrieval.measured, true);
assert.equal(weakRetrieval.precision_at_k, 0.2);
assert.equal(weakRetrieval.recall_at_k, 0.5);
assert.equal(weakRetrieval.k, 5);
assert((weakRetrieval.ndcg_at_k ?? 1) < 0.8);

const observedAt = "2026-07-26T00:00:00.000Z";
const staleCheckpointData: RestartPackData = {
  agentId: "kusabi",
  project: "agent-memory",
  maxTokens: 1500,
  observedAt,
  activeTasks: [{
    id: "task-alpha-05",
    agent_id: "kusabi",
    project: "agent-memory",
    task: "Kusabi continuity alpha — ALPHA-05 observed live canary",
    status: "in_progress",
    progress: "Old hook hash 3eb330 and old trust hash 339043",
    files_modified: [],
    next_steps: "Verify hooks and Issue #180",
    created_at: "2026-07-25T06:00:00.000Z",
    updated_at: "2026-07-25T07:00:00.000Z",
  }],
  blockedTasks: [],
  completedTasks: [],
  decisions: [{
    id: "decision-alpha-05",
    agent_id: "kusabi",
    project: "agent-memory",
    decision: "Verify external SSOT before status claims.",
    tags: ["ALPHA-05"],
    status: "active",
    created_at: "2026-07-25T07:00:00.000Z",
  }],
  knowledge: [{
    id: "knowledge-alpha-05",
    agent_id: "kusabi",
    project: "agent-memory",
    title: "Kusabi continuity canary",
    content: "Native recovery must not overclaim stale status.",
    source_type: "manual",
    source_ids: [],
    tags: ["ALPHA-05"],
    status: "active",
    created_at: "2026-07-25T07:00:00.000Z",
    updated_at: "2026-07-25T07:00:00.000Z",
  }],
  conversationEvents: [],
};
assert(RESTART_PACK_TASK_FRESHNESS_WINDOW_MS < Date.parse(observedAt) - Date.parse("2026-07-25T07:00:00.000Z"));
assert.equal(taskCheckpointIsStale(staleCheckpointData), true);
const stalePack = buildRecoveryPackArtifact(staleCheckpointData, {
  generated_at: observedAt,
  pack_id: "restart_pack:kusabi:agent-memory:stale-fixture",
});
assert.equal(stalePack.confidence, "medium");
assert(stalePack.missing_context.includes("task_checkpoint_stale"));
assert(stalePack.confidence_reasons.includes("missing task_checkpoint_stale"));
assert(buildRestartPack(staleCheckpointData).includes("FRESHNESS CAUTION"));

const freshCheckpointData = clone(staleCheckpointData);
freshCheckpointData.activeTasks[0].updated_at = "2026-07-25T23:30:00.000Z";
assert.equal(taskCheckpointIsStale(freshCheckpointData), false);
const freshPack = buildRecoveryPackArtifact(freshCheckpointData, {
  generated_at: observedAt,
  pack_id: "restart_pack:kusabi:agent-memory:fresh-fixture",
});
assert.equal(freshPack.confidence, "high");
assert(!freshPack.missing_context.includes("task_checkpoint_stale"));

const unknownFreshnessCases: Array<{
  name: string;
  mutate: (data: RestartPackData) => void;
}> = [
  {
    name: "missing observedAt",
    mutate: (data) => { delete data.observedAt; },
  },
  {
    name: "invalid observedAt",
    mutate: (data) => { data.observedAt = "not-a-date"; },
  },
  {
    name: "invalid checkpoint timestamp",
    mutate: (data) => { data.activeTasks[0].updated_at = "not-a-date"; },
  },
  {
    name: "future-skewed checkpoint timestamp",
    mutate: (data) => { data.activeTasks[0].updated_at = "2026-07-27T00:00:00.000Z"; },
  },
];
for (const fixture of unknownFreshnessCases) {
  const data = clone(freshCheckpointData);
  fixture.mutate(data);
  assert.equal(taskCheckpointIsStale(data), true, fixture.name);
  const pack = buildRecoveryPackArtifact(data, {
    generated_at: observedAt,
    pack_id: `restart_pack:kusabi:agent-memory:unknown-${fixture.name.replaceAll(" ", "-")}`,
  });
  assert.notEqual(pack.confidence, "high", fixture.name);
  assert(pack.missing_context.includes("task_checkpoint_freshness_unknown"), fixture.name);
  assert(pack.confidence_reasons.includes("missing task_checkpoint_freshness_unknown"), fixture.name);
  assert(buildRestartPack(data).includes("FRESHNESS UNKNOWN"), fixture.name);
}

const schemaPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "design",
  "schemas",
  "kusabi-functional-evaluation-v1.schema.json",
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const evidenceSchemaPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "design",
  "schemas",
  "kusabi-functional-evidence-v1.schema.json",
);
const evidenceSchema = JSON.parse(readFileSync(evidenceSchemaPath, "utf8"));
const validateEvidence = ajv.compile(evidenceSchema);
assert.equal(validateEvidence(validEvidence()), true, JSON.stringify(validateEvidence.errors));
assert.equal(validateEvidence(currentCanary), true, JSON.stringify(validateEvidence.errors));
assert.equal(validateEvidence(integrationEvidence), true, JSON.stringify(validateEvidence.errors));
assert.equal(validateEvidence(liveEvidenceRuns[0]), true, JSON.stringify(validateEvidence.errors));

const validate = ajv.compile(schema);
assert.equal(validate(valid), true, JSON.stringify(validate.errors));
assert.equal(validate(currentCanaryResult), true, JSON.stringify(validate.errors));

const acceptanceSchemaPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "design",
  "schemas",
  "kusabi-v1-acceptance-v1.schema.json",
);
const acceptanceSchema = JSON.parse(readFileSync(acceptanceSchemaPath, "utf8"));
const validateAcceptance = ajv.compile(acceptanceSchema);
assert.equal(validateAcceptance(acceptance), true, JSON.stringify(validateAcceptance.errors));
assert.equal(validateAcceptance(sqliteAcceptance), true, JSON.stringify(validateAcceptance.errors));
assert.equal(validateAcceptance(differentStoreBackendsResult), true, JSON.stringify(validateAcceptance.errors));
assert.equal(validateAcceptance(onlyTwoLiveRuns), true, JSON.stringify(validateAcceptance.errors));
assert.equal(validateAcceptance(blockingDefectResult), true, JSON.stringify(validateAcceptance.errors));
assert.equal(validateAcceptance(currentV1Result), true, JSON.stringify(validateAcceptance.errors));
const inconsistentPass = { ...acceptance, blocking_defect_count: 1 };
assert.equal(validateAcceptance(inconsistentPass), false);

console.log("kusabi functional evaluator tests passed");
