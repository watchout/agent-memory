import {
  CONTINUITY_ALPHA_HOST_CONTRACT,
  CONTINUITY_ALPHA_HOSTS,
  type ContinuityAlphaHost,
} from "./continuity-alpha-evaluator.js";

export const KUSABI_FUNCTIONAL_EVIDENCE_SCHEMA = "kusabi-functional-evidence/v1" as const;
export const KUSABI_FUNCTIONAL_EVALUATION_SCHEMA = "kusabi-functional-evaluation/v1" as const;
export const KUSABI_V1_ACCEPTANCE_SCHEMA = "kusabi-v1-acceptance/v1" as const;
export const KUSABI_G3_NATIVE_HOSTS = CONTINUITY_ALPHA_HOSTS;
export const KUSABI_G3_HOST_CONTRACT = CONTINUITY_ALPHA_HOST_CONTRACT;

export const KUSABI_FUNCTIONAL_TESTS = [
  { id: "KBF-01", name: "native_delivery_identity_store_binding" },
  { id: "KBF-02", name: "objective_recovery_accuracy" },
  { id: "KBF-03", name: "next_action_recovery_accuracy" },
  { id: "KBF-04", name: "critical_status_freshness_and_confidence_calibration" },
  { id: "KBF-05", name: "external_ssot_conflict_correction" },
  { id: "KBF-06", name: "safety_redaction_and_isolation" },
  { id: "KBF-07", name: "real_continuation_utility" },
  { id: "KBF-08", name: "safe_degradation" },
  { id: "KBF-09", name: "retrieval_quality_and_backend_parity" },
] as const;

export type KusabiFunctionalTestId = typeof KUSABI_FUNCTIONAL_TESTS[number]["id"];
export type KusabiFunctionalEvidenceKind =
  "deterministic_fixture" | "observed_integration" | "observed_live_canary";
export type KusabiFunctionalTestStatus = "pass" | "fail" | "not_measured";
export type KusabiRetrievalBackend = "json" | "sqlite" | "postgres";
export type KusabiNativeHost = ContinuityAlphaHost;
export type KusabiUsefulResultKind =
  "code_diff" | "test_receipt" | "verified_status" | "document_artifact" | "root_cause_evidence";

export const KUSABI_RETRIEVAL_CATEGORIES = [
  "objective_current_state",
  "next_action_blocker",
  "decision_constraint",
  "source_provenance",
  "multilingual_paraphrase",
  "stale_superseded_conflict",
] as const;

export type KusabiRetrievalCategory = typeof KUSABI_RETRIEVAL_CATEGORIES[number];

export interface KusabiFunctionalEvidenceProof {
  test_id: KusabiFunctionalTestId;
  source_kind: KusabiFunctionalEvidenceKind;
  ref: string;
  content_sha256: string;
}

export interface KusabiRetrievalCase {
  query_id: string;
  category: KusabiRetrievalCategory;
  query: string;
  backend: KusabiRetrievalBackend;
  expected_relevant_refs: string[];
  returned_refs: string[];
}

export interface KusabiRetrievalQuery {
  query_id: string;
  category: KusabiRetrievalCategory;
  query: string;
  expected_relevant_refs: string[];
}

export interface KusabiRetrievalBackendAdapter {
  backend: KusabiRetrievalBackend;
  execution_kind: "real_backend";
  search(query: string, topK: 5): Promise<string[]>;
}

export interface KusabiFunctionalCriticalFact {
  key: string;
  expected: string;
  recovered?: string | null;
}

export interface KusabiFunctionalEvidence {
  schema_version: typeof KUSABI_FUNCTIONAL_EVIDENCE_SCHEMA;
  evidence_kind: KusabiFunctionalEvidenceKind;
  evidence_ref: string;
  run_id: string;
  session_id: string;
  proofs: KusabiFunctionalEvidenceProof[];
  identity: {
    host: KusabiNativeHost;
    runtime: KusabiNativeHost;
    ordinary_launch_command: string;
    native_start_surface: string;
    workspace: string;
    binding_ref: string;
    native_delivery_confirmed: boolean;
    fresh_session_confirmed: boolean;
    launch_mode: "ordinary_command" | "test_harness" | "wrapper";
    identity_verified: boolean;
    expected_agent_id: string;
    observed_agent_id: string;
    expected_project: string;
    observed_project: string;
    store_binding_verified: boolean;
    credentials_embedded: boolean;
  };
  recovery: {
    ground_truth_ref: string;
    ground_truth_frozen_at: string;
    ground_truth_source_refs: string[];
    expected_objective_terms: string[];
    recovered_objective: string;
    expected_next_action_terms: string[];
    recovered_next_action: string;
    expected_constraint_terms: string[];
    recovered_constraints: string;
    expected_blocker_terms: string[];
    recovered_blockers: string;
    critical_facts: KusabiFunctionalCriticalFact[];
    confidence: "high" | "medium" | "low";
    missing_context: string[];
    ssot_check_performed: boolean;
    ssot_evidence_ref: string;
    ssot_conflict_detected: boolean;
    corrected_to_ssot: boolean;
    stale_action_avoided: boolean;
  };
  safety: {
    redaction_applied: boolean;
    secret_leak_count: number;
    private_reasoning_leak_count: number;
    base_instruction_leak_count: number;
    full_home_path_leak_count: number;
    forbidden_effect_count: number;
  };
  continuation: {
    restatement_class: "RI0" | "RI1" | "RI2";
    restatement_count: number;
    meaningful_action_started: boolean;
    meaningful_action_ref: string;
    useful_result_produced: boolean;
    useful_result_new: boolean;
    useful_result_equals_stored_value_only: boolean;
    useful_result_ref: string;
    useful_result_kind: KusabiUsefulResultKind;
    useful_result_created_at: string;
    useful_result_content_sha256: string;
    recovered_context_content_sha256: string;
  };
  degradation: {
    fixture_tested: boolean;
    fixture_passed: boolean;
    ordinary_host_usable: boolean;
    visible_degraded_result: boolean;
  };
  retrieval: {
    ground_truth_frozen: boolean;
    execution_kind: "deterministic_fixture" | "real_backend";
    top_k: 5;
    cases: KusabiRetrievalCase[];
  };
  performance: {
    t0: string;
    t1: string;
    t3: string;
    t4: string;
  };
}

export interface KusabiFunctionalTestResult {
  id: KusabiFunctionalTestId;
  name: string;
  status: KusabiFunctionalTestStatus;
  reasons: string[];
  evidence_refs: string[];
  evidence_admissible: boolean;
}

export interface KusabiRetrievalMetrics {
  measured: boolean;
  precision_at_k: number | null;
  recall_at_k: number | null;
  ndcg_at_k: number | null;
  k: number;
}

export interface KusabiRetrievalBackendMetrics {
  backend: KusabiRetrievalBackend;
  case_count: number;
  precision_at_k: number | null;
  recall_at_k: number | null;
  ndcg_at_k: number | null;
}

export interface KusabiRetrievalBenchmarkMetrics {
  measured: boolean;
  benchmark_ready: boolean;
  execution_kind: "deterministic_fixture" | "real_backend";
  top_k: 5;
  precision_at_k: number | null;
  recall_at_k: number | null;
  ndcg_at_k: number | null;
  case_count: number;
  query_count: number;
  backends: KusabiRetrievalBackend[];
  category_counts: Record<KusabiRetrievalCategory, number>;
  backend_parity_verified: boolean;
  backend_metrics: KusabiRetrievalBackendMetrics[];
}

export interface KusabiFunctionalEvaluationOptions {
  verified_observed_proofs?: ReadonlyArray<Pick<KusabiFunctionalEvidenceProof, "ref" | "content_sha256">>;
  verified_live_proofs?: ReadonlyArray<Pick<KusabiFunctionalEvidenceProof, "ref" | "content_sha256">>;
}

export interface KusabiPerformanceObservation {
  measured: boolean;
  t1_ms: number | null;
  t3_ms: number | null;
  t4_ms: number | null;
  blocking: false;
}

export interface KusabiFunctionalEvaluation {
  schema_version: typeof KUSABI_FUNCTIONAL_EVALUATION_SCHEMA;
  evidence_kind: KusabiFunctionalEvidenceKind;
  evidence_ref: string;
  run_id: string;
  session_id: string;
  host: KusabiNativeHost;
  tests: KusabiFunctionalTestResult[];
  retrieval_metrics: KusabiRetrievalBenchmarkMetrics;
  performance: KusabiPerformanceObservation;
  functional_core_pass: boolean;
  quality_ready: boolean;
  live_evidence_admissible: boolean;
  live_claim_eligible: boolean;
  errors: string[];
}

export type KusabiV1Verdict = "PASS" | "FAIL" | "INCOMPLETE";
export type KusabiV1GateStatus = "pass" | "fail" | "incomplete";
export type KusabiBlockingDefectKind =
  "secret_exposure" | "destructive_operation" | "data_loss_or_corruption" |
  "false_live_acceptance" | "verified_functional_core_failure" | "retrieval_threshold_failure";

export interface KusabiGateProof {
  ref: string;
  content_sha256: string;
}

export interface KusabiBlockingDefect {
  kind: KusabiBlockingDefectKind;
  evidence_ref: string;
}

export interface KusabiV1AcceptanceInput {
  g1: {
    suite_id: "kbf-v1-fixed";
    passed: boolean;
    proof: KusabiGateProof;
  };
  g2: KusabiFunctionalEvidence;
  g3: KusabiFunctionalEvidence[];
  blocking_defects: KusabiBlockingDefect[];
  independent_audit: {
    completed: boolean;
    blocking_finding_count: number;
    proof: KusabiGateProof;
  };
}

export interface KusabiV1AcceptanceOptions {
  verified_gate_proofs?: readonly KusabiGateProof[];
  verified_observed_proofs?: ReadonlyArray<Pick<KusabiFunctionalEvidenceProof, "ref" | "content_sha256">>;
}

export interface KusabiV1Acceptance {
  schema_version: typeof KUSABI_V1_ACCEPTANCE_SCHEMA;
  verdict: KusabiV1Verdict;
  kusabi_v1_pass: boolean;
  gates: {
    g1_evaluator_contract: KusabiV1GateStatus;
    g2_integration: KusabiV1GateStatus;
    g3_live_canary: KusabiV1GateStatus;
    independent_r2_audit: KusabiV1GateStatus;
  };
  live_pass_count: number;
  required_live_pass_count: 3;
  g3_native_host_matrix: {
    required_hosts: KusabiNativeHost[];
    observed_hosts: KusabiNativeHost[];
    pass_by_host: Record<KusabiNativeHost, boolean>;
    exact: boolean;
  };
  blocking_defect_count: number;
  reasons: string[];
}

const FUNCTIONAL_CORE_IDS = new Set<KusabiFunctionalTestId>([
  "KBF-01",
  "KBF-02",
  "KBF-03",
  "KBF-04",
  "KBF-05",
  "KBF-06",
  "KBF-07",
  "KBF-08",
]);

const RETRIEVAL_THRESHOLDS = {
  precision_at_k: 0.8,
  recall_at_k: 0.8,
  ndcg_at_k: 0.8,
} as const;

const RETRIEVAL_BACKENDS: readonly KusabiRetrievalBackend[] = ["json", "sqlite", "postgres"];
const RETRIEVAL_QUERY_COUNT = 30;
const RETRIEVAL_QUERIES_PER_CATEGORY = 5;
const RETRIEVAL_TOP_K = 5 as const;
const MAX_BACKEND_METRIC_SPREAD = 0.05;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function hasAllTerms(text: string, terms: string[]): boolean {
  const candidate = normalized(text);
  return terms.length > 0 && terms.every((term) => candidate.includes(normalized(term)));
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

export function calculateRetrievalMetrics(
  expectedRelevantRefs: string[],
  returnedRefs: string[],
  topK: 5 = RETRIEVAL_TOP_K,
): KusabiRetrievalMetrics {
  const expected = new Set(unique(expectedRelevantRefs));
  const returned = unique(returnedRefs).slice(0, topK);
  const k = topK;
  if (expected.size === 0 || returned.length === 0) {
    return { measured: false, precision_at_k: null, recall_at_k: null, ndcg_at_k: null, k };
  }

  const relevances = returned.map((ref) => expected.has(ref) ? 1 : 0);
  const hitCount = relevances.reduce<number>((sum, relevance) => sum + relevance, 0);
  const precision = hitCount / k;
  const recall = hitCount / expected.size;
  const dcg = relevances.reduce<number>((sum, relevance, index) => (
    sum + (relevance / Math.log2(index + 2))
  ), 0);
  const idealHitCount = Math.min(expected.size, k);
  const idealDcg = Array.from({ length: idealHitCount }, (_, index) => 1 / Math.log2(index + 2))
    .reduce((sum, value) => sum + value, 0);

  return {
    measured: true,
    precision_at_k: rounded(precision),
    recall_at_k: rounded(recall),
    ndcg_at_k: rounded(idealDcg === 0 ? 0 : dcg / idealDcg),
    k,
  };
}

export async function runKusabiRetrievalBenchmark(
  corpus: readonly KusabiRetrievalQuery[],
  adapters: readonly KusabiRetrievalBackendAdapter[],
): Promise<KusabiFunctionalEvidence["retrieval"]> {
  const adapterBackends = adapters.map((adapter) => adapter.backend);
  const hasExactBackends = adapters.length === RETRIEVAL_BACKENDS.length &&
    RETRIEVAL_BACKENDS.every((backend) => adapterBackends.filter((value) => value === backend).length === 1);
  if (!hasExactBackends) {
    throw new Error("KBF09_EXACT_BACKEND_ADAPTER_SET_REQUIRED");
  }

  const cases = await Promise.all(corpus.flatMap((entry) => adapters.map(async (adapter) => ({
    query_id: entry.query_id,
    category: entry.category,
    query: entry.query,
    backend: adapter.backend,
    expected_relevant_refs: [...entry.expected_relevant_refs],
    returned_refs: await adapter.search(entry.query, RETRIEVAL_TOP_K),
  }))));

  return {
    ground_truth_frozen: true,
    execution_kind: "real_backend",
    top_k: RETRIEVAL_TOP_K,
    cases,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return rounded(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function metricValues(
  metrics: KusabiRetrievalMetrics[],
  key: "precision_at_k" | "recall_at_k" | "ndcg_at_k",
): number[] {
  return metrics.flatMap((metric) => metric[key] === null ? [] : [metric[key] as number]);
}

function withinBackendSpread(values: Array<number | null>): boolean {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length === RETRIEVAL_BACKENDS.length &&
    Math.max(...measured) - Math.min(...measured) <= MAX_BACKEND_METRIC_SPREAD;
}

function emptyCategoryCounts(): Record<KusabiRetrievalCategory, number> {
  return Object.fromEntries(KUSABI_RETRIEVAL_CATEGORIES.map((category) => [category, 0])) as
    Record<KusabiRetrievalCategory, number>;
}

function sameRefs(left: string[], right: string[]): boolean {
  return JSON.stringify(unique(left).sort()) === JSON.stringify(unique(right).sort());
}

export function calculateRetrievalBenchmarkMetrics(
  retrieval: KusabiFunctionalEvidence["retrieval"],
): KusabiRetrievalBenchmarkMetrics {
  const caseMetrics = retrieval.cases.map((entry) => calculateRetrievalMetrics(
    entry.expected_relevant_refs,
    entry.returned_refs,
    RETRIEVAL_TOP_K,
  ));
  const queryIds = unique(retrieval.cases.map((entry) => entry.query_id.trim()).filter(Boolean));
  const categoryCounts = emptyCategoryCounts();
  for (const queryId of queryIds) {
    const firstCase = retrieval.cases.find((entry) => entry.query_id.trim() === queryId);
    if (firstCase) categoryCounts[firstCase.category] += 1;
  }
  const backends = RETRIEVAL_BACKENDS.filter((backend) => (
    retrieval.cases.some((entry) => entry.backend === backend)
  ));
  const completeMatrix = queryIds.length === RETRIEVAL_QUERY_COUNT &&
    retrieval.cases.length === queryIds.length * RETRIEVAL_BACKENDS.length &&
    KUSABI_RETRIEVAL_CATEGORIES.every((category) => (
      categoryCounts[category] === RETRIEVAL_QUERIES_PER_CATEGORY
    )) &&
    queryIds.every((queryId) => {
      const queryCases = retrieval.cases.filter((entry) => entry.query_id.trim() === queryId);
      const firstCase = queryCases[0];
      return firstCase !== undefined &&
        firstCase.query.trim().length > 0 &&
        firstCase.expected_relevant_refs.length > 0 &&
        queryCases.every((entry) => (
          entry.category === firstCase.category &&
          entry.query === firstCase.query &&
          sameRefs(entry.expected_relevant_refs, firstCase.expected_relevant_refs) &&
          unique(entry.returned_refs).length >= RETRIEVAL_TOP_K
        )) &&
        RETRIEVAL_BACKENDS.every((backend) => (
          queryCases.filter((entry) => entry.backend === backend).length === 1
        ));
    });
  const measured = caseMetrics.length > 0 && caseMetrics.every((metric) => metric.measured);
  const benchmarkReady = retrieval.ground_truth_frozen &&
    retrieval.top_k === RETRIEVAL_TOP_K && completeMatrix && measured;
  const backendMetrics = RETRIEVAL_BACKENDS.map((backend): KusabiRetrievalBackendMetrics => {
    const metrics = retrieval.cases.flatMap((entry, index) => entry.backend === backend ? [caseMetrics[index]] : []);
    return {
      backend,
      case_count: metrics.length,
      precision_at_k: average(metricValues(metrics, "precision_at_k")),
      recall_at_k: average(metricValues(metrics, "recall_at_k")),
      ndcg_at_k: average(metricValues(metrics, "ndcg_at_k")),
    };
  });
  const backendParityVerified = benchmarkReady &&
    withinBackendSpread(backendMetrics.map((metric) => metric.precision_at_k)) &&
    withinBackendSpread(backendMetrics.map((metric) => metric.recall_at_k)) &&
    withinBackendSpread(backendMetrics.map((metric) => metric.ndcg_at_k));

  return {
    measured,
    benchmark_ready: benchmarkReady,
    execution_kind: retrieval.execution_kind,
    top_k: RETRIEVAL_TOP_K,
    precision_at_k: average(metricValues(caseMetrics, "precision_at_k")),
    recall_at_k: average(metricValues(caseMetrics, "recall_at_k")),
    ndcg_at_k: average(metricValues(caseMetrics, "ndcg_at_k")),
    case_count: retrieval.cases.length,
    query_count: queryIds.length,
    backends: [...backends],
    category_counts: categoryCounts,
    backend_parity_verified: backendParityVerified,
    backend_metrics: backendMetrics,
  };
}

function durationMs(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const started = Date.parse(start);
  const ended = Date.parse(end);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return null;
  return ended - started;
}

function performanceObservation(
  performance: KusabiFunctionalEvidence["performance"],
): KusabiPerformanceObservation {
  const t1 = durationMs(performance?.t0, performance?.t1);
  const t3 = durationMs(performance?.t0, performance?.t3);
  const t4 = durationMs(performance?.t0, performance?.t4);
  return {
    measured: t1 !== null || t3 !== null || t4 !== null,
    t1_ms: t1,
    t3_ms: t3,
    t4_ms: t4,
    blocking: false,
  };
}

function validSha256(value: string | null | undefined): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function requiredRefsForTest(
  id: KusabiFunctionalTestId,
  evidence: KusabiFunctionalEvidence,
): string[] {
  if (id === "KBF-02") return unique(evidence.recovery.ground_truth_source_refs);
  if (id === "KBF-05") return evidence.recovery.ssot_evidence_ref ? [evidence.recovery.ssot_evidence_ref] : [];
  if (id === "KBF-07") return evidence.continuation.useful_result_ref ? [evidence.continuation.useful_result_ref] : [];
  return [];
}

function testResult(
  id: KusabiFunctionalTestId,
  status: KusabiFunctionalTestStatus,
  reasons: string[],
  evidence: KusabiFunctionalEvidence,
  verifiedLiveProofs: ReadonlySet<string>,
): KusabiFunctionalTestResult {
  const definition = KUSABI_FUNCTIONAL_TESTS.find((test) => test.id === id);
  const matchingProofs = evidence.proofs.filter((proof) => (
    proof.test_id === id &&
    proof.source_kind === evidence.evidence_kind &&
    proof.ref.trim().length > 0 &&
    validSha256(proof.content_sha256)
  ));
  const evidenceRefs = unique(matchingProofs.map((proof) => proof.ref));
  const requiredRefs = requiredRefsForTest(id, evidence);
  const requiredProofsPresent = requiredRefs.length === 0
    ? matchingProofs.length > 0
    : requiredRefs.every((ref) => matchingProofs.some((proof) => proof.ref === ref));
  const requiredProofsVerified = requiredRefs.length === 0
    ? matchingProofs.some((proof) => verifiedLiveProofs.has(`${proof.ref}\u0000${proof.content_sha256}`))
    : requiredRefs.every((ref) => matchingProofs.some((proof) => (
      proof.ref === ref && verifiedLiveProofs.has(`${proof.ref}\u0000${proof.content_sha256}`)
    )));
  const evidenceAdmissible = requiredProofsPresent && (
    evidence.evidence_kind === "deterministic_fixture" || requiredProofsVerified
  );
  const finalizedReasons = [...reasons];
  let finalizedStatus = status;
  if (!evidenceAdmissible) {
    finalizedReasons.push(`${id.replace("-", "")}_EVIDENCE_NOT_VERIFIED`);
    if (status === "pass") finalizedStatus = "not_measured";
  }
  return {
    id,
    name: definition?.name ?? id,
    status: finalizedStatus,
    reasons: unique(finalizedReasons),
    evidence_refs: evidenceRefs,
    evidence_admissible: evidenceAdmissible,
  };
}

export function evaluateKusabiFunctionalEvidence(
  evidence: KusabiFunctionalEvidence,
  options: KusabiFunctionalEvaluationOptions = {},
): KusabiFunctionalEvaluation {
  const tests: KusabiFunctionalTestResult[] = [];
  const verifiedObservedProofs = new Set([
    ...(options.verified_observed_proofs ?? []),
    ...(options.verified_live_proofs ?? []),
  ].map((proof) => (
    `${proof.ref}\u0000${proof.content_sha256}`
  )));

  const identityReasons: string[] = [];
  const hostContract = KUSABI_G3_HOST_CONTRACT[evidence.identity.host];
  if (!evidence.run_id.trim()) identityReasons.push("KBF01_RUN_ID_MISSING");
  if (!evidence.session_id.trim()) identityReasons.push("KBF01_SESSION_ID_MISSING");
  if (!hostContract) identityReasons.push("KBF01_NATIVE_HOST_UNSUPPORTED");
  if (evidence.identity.runtime !== evidence.identity.host) identityReasons.push("KBF01_RUNTIME_HOST_MISMATCH");
  if (hostContract && evidence.identity.ordinary_launch_command !== hostContract.command) {
    identityReasons.push("KBF01_ORDINARY_COMMAND_MISMATCH");
  }
  if (hostContract && evidence.identity.native_start_surface !== hostContract.start_surface) {
    identityReasons.push("KBF01_NATIVE_START_SURFACE_MISMATCH");
  }
  if (!evidence.identity.workspace.trim()) identityReasons.push("KBF01_WORKSPACE_MISSING");
  if (!evidence.identity.binding_ref.trim()) identityReasons.push("KBF01_BINDING_REF_MISSING");
  if (!evidence.identity.native_delivery_confirmed) identityReasons.push("KBF01_NATIVE_DELIVERY_MISSING");
  if (!evidence.identity.fresh_session_confirmed) identityReasons.push("KBF01_FRESH_SESSION_NOT_CONFIRMED");
  if (
    evidence.evidence_kind === "observed_live_canary" &&
    evidence.identity.launch_mode !== "ordinary_command"
  ) {
    identityReasons.push("KBF01_ORDINARY_COMMAND_REQUIRED");
  }
  if (!evidence.identity.identity_verified) identityReasons.push("KBF01_IDENTITY_NOT_VERIFIED");
  if (evidence.identity.expected_agent_id !== evidence.identity.observed_agent_id) identityReasons.push("KBF01_AGENT_MISMATCH");
  if (evidence.identity.expected_project !== evidence.identity.observed_project) identityReasons.push("KBF01_PROJECT_MISMATCH");
  if (!evidence.identity.store_binding_verified) identityReasons.push("KBF01_STORE_BINDING_NOT_VERIFIED");
  if (evidence.identity.credentials_embedded) identityReasons.push("KBF01_CREDENTIALS_EMBEDDED");
  tests.push(testResult("KBF-01", identityReasons.length === 0 ? "pass" : "fail", identityReasons, evidence, verifiedObservedProofs));

  const objectiveReasons = hasAllTerms(
    evidence.recovery.recovered_objective,
    evidence.recovery.expected_objective_terms,
  ) ? [] : ["KBF02_OBJECTIVE_GROUND_TRUTH_MISMATCH"];
  if (!evidence.recovery.ground_truth_ref.trim()) objectiveReasons.push("KBF02_GROUND_TRUTH_REF_MISSING");
  const frozenAt = Date.parse(evidence.recovery.ground_truth_frozen_at);
  const runStartedAt = Date.parse(evidence.performance?.t0 ?? "");
  if (!Number.isFinite(frozenAt) || !Number.isFinite(runStartedAt) || frozenAt > runStartedAt) {
    objectiveReasons.push("KBF02_GROUND_TRUTH_NOT_FROZEN_BEFORE_RUN");
  }
  if (evidence.recovery.ground_truth_source_refs.length === 0) {
    objectiveReasons.push("KBF02_GROUND_TRUTH_SOURCE_REFS_MISSING");
  } else if (evidence.recovery.ground_truth_source_refs.some((ref) => !ref.trim())) {
    objectiveReasons.push("KBF02_GROUND_TRUTH_SOURCE_REF_INVALID");
  }
  if (!evidence.recovery.ground_truth_source_refs.includes(evidence.recovery.ground_truth_ref)) {
    objectiveReasons.push("KBF02_GROUND_TRUTH_REF_NOT_IN_SOURCE_REFS");
  }
  tests.push(testResult("KBF-02", objectiveReasons.length === 0 ? "pass" : "fail", objectiveReasons, evidence, verifiedObservedProofs));

  const nextActionReasons = hasAllTerms(
    evidence.recovery.recovered_next_action,
    evidence.recovery.expected_next_action_terms,
  ) ? [] : ["KBF03_NEXT_ACTION_GROUND_TRUTH_MISMATCH"];
  if (!hasAllTerms(evidence.recovery.recovered_constraints, evidence.recovery.expected_constraint_terms)) {
    nextActionReasons.push("KBF03_CONSTRAINTS_GROUND_TRUTH_MISMATCH");
  }
  const blockersMatch = evidence.recovery.expected_blocker_terms.length === 0
    ? evidence.recovery.recovered_blockers.trim().length === 0
    : hasAllTerms(evidence.recovery.recovered_blockers, evidence.recovery.expected_blocker_terms);
  if (!blockersMatch) nextActionReasons.push("KBF03_BLOCKERS_GROUND_TRUTH_MISMATCH");
  tests.push(testResult("KBF-03", nextActionReasons.length === 0 ? "pass" : "fail", nextActionReasons, evidence, verifiedObservedProofs));

  const mismatchedFacts = evidence.recovery.critical_facts.filter((fact) => (
    !fact.recovered || normalized(fact.expected) !== normalized(fact.recovered)
  ));
  const freshnessReasons: string[] = [];
  const staleCheckpointReported = evidence.recovery.missing_context.includes("task_checkpoint_stale");
  const unknownCheckpointFreshnessReported = evidence.recovery.missing_context.includes(
    "task_checkpoint_freshness_unknown",
  );
  if (evidence.recovery.critical_facts.length === 0) freshnessReasons.push("KBF04_CRITICAL_FACTS_NOT_PROVIDED");
  if (mismatchedFacts.length > 0 || staleCheckpointReported || unknownCheckpointFreshnessReported) {
    freshnessReasons.push("KBF04_STALE_OR_MISSING_CRITICAL_FACT");
  }
  if (
    evidence.recovery.confidence === "high" &&
    (
      mismatchedFacts.length > 0 ||
      staleCheckpointReported ||
      unknownCheckpointFreshnessReported
    )
  ) {
    freshnessReasons.push("KBF04_CONFIDENCE_OVERCLAIM");
  }
  tests.push(testResult("KBF-04", freshnessReasons.length === 0 ? "pass" : "fail", freshnessReasons, evidence, verifiedObservedProofs));

  const ssotReasons: string[] = [];
  if (!evidence.recovery.ssot_check_performed) ssotReasons.push("KBF05_SSOT_CHECK_MISSING");
  if (!evidence.recovery.ssot_evidence_ref?.trim()) ssotReasons.push("KBF05_SSOT_EVIDENCE_REF_MISSING");
  if (mismatchedFacts.length > 0) {
    if (!evidence.recovery.ssot_conflict_detected) ssotReasons.push("KBF05_SSOT_CONFLICT_NOT_DETECTED");
    if (!evidence.recovery.corrected_to_ssot) ssotReasons.push("KBF05_SSOT_CORRECTION_MISSING");
    if (!evidence.recovery.stale_action_avoided) ssotReasons.push("KBF05_STALE_ACTION_NOT_AVOIDED");
  }
  tests.push(testResult("KBF-05", ssotReasons.length === 0 ? "pass" : "fail", ssotReasons, evidence, verifiedObservedProofs));

  const safetyReasons: string[] = [];
  if (!evidence.safety.redaction_applied) safetyReasons.push("KBF06_REDACTION_NOT_APPLIED");
  const safetyCounts = [
    evidence.safety.secret_leak_count,
    evidence.safety.private_reasoning_leak_count,
    evidence.safety.base_instruction_leak_count,
    evidence.safety.full_home_path_leak_count,
    evidence.safety.forbidden_effect_count,
  ];
  if (safetyCounts.some((count) => !finiteNonNegative(count))) safetyReasons.push("KBF06_INVALID_SAFETY_COUNT");
  if (safetyCounts.some((count) => count > 0)) safetyReasons.push("KBF06_SAFETY_OR_ISOLATION_LEAK");
  tests.push(testResult("KBF-06", safetyReasons.length === 0 ? "pass" : "fail", safetyReasons, evidence, verifiedObservedProofs));

  const continuationReasons: string[] = [];
  if (evidence.continuation.restatement_class !== "RI0" || evidence.continuation.restatement_count !== 0) {
    continuationReasons.push("KBF07_USER_RESTATEMENT_REQUIRED");
  }
  if (!evidence.continuation.meaningful_action_started || !evidence.continuation.meaningful_action_ref?.trim()) {
    continuationReasons.push("KBF07_MEANINGFUL_ACTION_MISSING");
  }
  const meaningfulActionAt = Date.parse(evidence.performance.t3);
  if (!Number.isFinite(runStartedAt) || !Number.isFinite(meaningfulActionAt) || meaningfulActionAt < runStartedAt) {
    continuationReasons.push("KBF07_MEANINGFUL_ACTION_NOT_AFTER_T0");
  }
  if (
    !evidence.continuation.useful_result_produced ||
    !evidence.continuation.useful_result_new ||
    evidence.continuation.useful_result_equals_stored_value_only ||
    !evidence.continuation.useful_result_ref?.trim()
  ) {
    continuationReasons.push("KBF07_NEW_USEFUL_RESULT_MISSING");
  }
  if (!evidence.continuation.useful_result_kind) {
    continuationReasons.push("KBF07_USEFUL_RESULT_KIND_MISSING");
  }
  const resultCreatedAt = Date.parse(evidence.continuation.useful_result_created_at ?? "");
  if (!Number.isFinite(runStartedAt) || !Number.isFinite(resultCreatedAt) || resultCreatedAt < runStartedAt) {
    continuationReasons.push("KBF07_USEFUL_RESULT_NOT_CREATED_AFTER_T0");
  }
  if (
    !validSha256(evidence.continuation.useful_result_content_sha256) ||
    !validSha256(evidence.continuation.recovered_context_content_sha256) ||
    evidence.continuation.useful_result_content_sha256 === evidence.continuation.recovered_context_content_sha256
  ) {
    continuationReasons.push("KBF07_USEFUL_RESULT_CONTENT_NOT_NEW");
  }
  tests.push(testResult("KBF-07", continuationReasons.length === 0 ? "pass" : "fail", continuationReasons, evidence, verifiedObservedProofs));

  const degradationReasons: string[] = [];
  if (!evidence.degradation.fixture_tested) degradationReasons.push("KBF08_DEGRADATION_NOT_TESTED");
  if (!evidence.degradation.fixture_passed) degradationReasons.push("KBF08_DEGRADATION_FIXTURE_FAILED");
  if (!evidence.degradation.ordinary_host_usable) degradationReasons.push("KBF08_ORDINARY_HOST_NOT_USABLE");
  if (!evidence.degradation.visible_degraded_result) degradationReasons.push("KBF08_DEGRADED_RESULT_NOT_VISIBLE");
  tests.push(testResult("KBF-08", degradationReasons.length === 0 ? "pass" : "fail", degradationReasons, evidence, verifiedObservedProofs));

  const retrieval = calculateRetrievalBenchmarkMetrics(evidence.retrieval);
  const retrievalReasons: string[] = [];
  let retrievalStatus: KusabiFunctionalTestStatus = "pass";
  if (!retrieval.benchmark_ready) {
    retrievalStatus = "not_measured";
    retrievalReasons.push("KBF09_BENCHMARK_NOT_READY");
  } else {
    if ((retrieval.precision_at_k ?? 0) < RETRIEVAL_THRESHOLDS.precision_at_k) retrievalReasons.push("KBF09_PRECISION_BELOW_THRESHOLD");
    if ((retrieval.recall_at_k ?? 0) < RETRIEVAL_THRESHOLDS.recall_at_k) retrievalReasons.push("KBF09_RECALL_BELOW_THRESHOLD");
    if ((retrieval.ndcg_at_k ?? 0) < RETRIEVAL_THRESHOLDS.ndcg_at_k) retrievalReasons.push("KBF09_NDCG_BELOW_THRESHOLD");
    if (!retrieval.backend_parity_verified) retrievalReasons.push("KBF09_BACKEND_PARITY_NOT_VERIFIED");
    if (retrievalReasons.length > 0) retrievalStatus = "fail";
  }
  tests.push(testResult("KBF-09", retrievalStatus, retrievalReasons, evidence, verifiedObservedProofs));

  const functionalCorePass = tests
    .filter((test) => FUNCTIONAL_CORE_IDS.has(test.id))
    .every((test) => test.status === "pass");
  const qualityReady = functionalCorePass && tests.every((test) => test.status === "pass");
  const liveEvidenceAdmissible = evidence.evidence_kind === "observed_live_canary" &&
    tests.every((test) => test.evidence_admissible);
  const errors = tests.flatMap((test) => test.reasons);

  return {
    schema_version: KUSABI_FUNCTIONAL_EVALUATION_SCHEMA,
    evidence_kind: evidence.evidence_kind,
    evidence_ref: evidence.evidence_ref,
    run_id: evidence.run_id,
    session_id: evidence.session_id,
    host: evidence.identity.host,
    tests,
    retrieval_metrics: retrieval,
    performance: performanceObservation(evidence.performance),
    functional_core_pass: functionalCorePass,
    quality_ready: qualityReady,
    live_evidence_admissible: liveEvidenceAdmissible,
    live_claim_eligible: qualityReady && liveEvidenceAdmissible,
    errors,
  };
}

function gateProofKey(proof: KusabiGateProof): string {
  return `${proof.ref}\u0000${proof.content_sha256}`;
}

function gateProofVerified(proof: KusabiGateProof, verified: ReadonlySet<string>): boolean {
  return proof.ref.trim().length > 0 && validSha256(proof.content_sha256) && verified.has(gateProofKey(proof));
}

function coreTests(evaluation: KusabiFunctionalEvaluation): KusabiFunctionalTestResult[] {
  return evaluation.tests.filter((test) => FUNCTIONAL_CORE_IDS.has(test.id));
}

function hasVerifiedFailure(tests: KusabiFunctionalTestResult[]): boolean {
  return tests.some((test) => test.status === "fail" && test.evidence_admissible);
}

function allAdmissiblePass(tests: KusabiFunctionalTestResult[]): boolean {
  return tests.length > 0 && tests.every((test) => test.status === "pass" && test.evidence_admissible);
}

export function evaluateKusabiV1Acceptance(
  input: KusabiV1AcceptanceInput,
  options: KusabiV1AcceptanceOptions = {},
): KusabiV1Acceptance {
  const verifiedGateProofs = new Set((options.verified_gate_proofs ?? []).map(gateProofKey));
  const observedOptions: KusabiFunctionalEvaluationOptions = {
    verified_observed_proofs: options.verified_observed_proofs,
  };
  const g2Evaluation = evaluateKusabiFunctionalEvidence(input.g2, observedOptions);
  const g3Evaluations = input.g3.map((evidence) => (
    evaluateKusabiFunctionalEvidence(evidence, observedOptions)
  ));
  const reasons: string[] = [];

  let g1: KusabiV1GateStatus = "incomplete";
  if (
    input.g1.suite_id === "kbf-v1-fixed" &&
    gateProofVerified(input.g1.proof, verifiedGateProofs)
  ) {
    g1 = input.g1.passed ? "pass" : "fail";
    if (!input.g1.passed) reasons.push("G1_EVALUATOR_CONTRACT_FAILED");
  } else {
    reasons.push("G1_FIXED_SUITE_PROOF_NOT_VERIFIED");
  }

  let g2: KusabiV1GateStatus = "incomplete";
  const g2VerifiedFailure = hasVerifiedFailure(g2Evaluation.tests);
  if (g2VerifiedFailure) {
    g2 = "fail";
    reasons.push("G2_VERIFIED_TEST_FAILURE");
  } else if (
    g2Evaluation.evidence_kind === "observed_integration" &&
    g2Evaluation.retrieval_metrics.execution_kind === "real_backend" &&
    g2Evaluation.retrieval_metrics.benchmark_ready &&
    g2Evaluation.retrieval_metrics.top_k === RETRIEVAL_TOP_K &&
    allAdmissiblePass(g2Evaluation.tests)
  ) {
    g2 = "pass";
  } else {
    reasons.push("G2_INTEGRATION_INCOMPLETE");
  }

  const requiredHosts = [...KUSABI_G3_NATIVE_HOSTS];
  const observedHosts = input.g3.map((evidence) => evidence.identity.host);
  const distinctLiveSessions = new Set(g3Evaluations.map((evaluation) => evaluation.session_id));
  const livePassCount = g3Evaluations.filter((evaluation) => (
    evaluation.evidence_kind === "observed_live_canary" &&
    evaluation.session_id.trim().length > 0 &&
    allAdmissiblePass(coreTests(evaluation))
  )).length;
  const passByHost = Object.fromEntries(requiredHosts.map((host) => {
    const hostEvaluations = g3Evaluations.filter((evaluation) => evaluation.host === host);
    return [host, hostEvaluations.length === 1 && (
      hostEvaluations[0].evidence_kind === "observed_live_canary" &&
      hostEvaluations[0].session_id.trim().length > 0 &&
      allAdmissiblePass(coreTests(hostEvaluations[0]))
    )];
  })) as Record<KusabiNativeHost, boolean>;
  const exactHostMatrix = input.g3.length === requiredHosts.length &&
    requiredHosts.every((host) => observedHosts.filter((observed) => observed === host).length === 1);
  const liveVerifiedFailure = g3Evaluations.some((evaluation) => hasVerifiedFailure(coreTests(evaluation)));
  let g3: KusabiV1GateStatus = "incomplete";
  if (liveVerifiedFailure) {
    g3 = "fail";
    reasons.push("G3_VERIFIED_FUNCTIONAL_CORE_FAILURE");
  } else if (
    exactHostMatrix &&
    distinctLiveSessions.size === requiredHosts.length &&
    requiredHosts.every((host) => passByHost[host])
  ) {
    g3 = "pass";
  } else {
    if (!exactHostMatrix) reasons.push("G3_EXACT_NATIVE_HOST_MATRIX_REQUIRED");
    if (distinctLiveSessions.size !== input.g3.length) {
      reasons.push("G3_DISTINCT_SESSION_PER_NATIVE_HOST_REQUIRED");
    }
    if (livePassCount !== requiredHosts.length || requiredHosts.some((host) => !passByHost[host])) {
      reasons.push("G3_NATIVE_HOST_PASSES_INCOMPLETE");
    }
  }

  let audit: KusabiV1GateStatus = "incomplete";
  if (
    input.independent_audit.completed &&
    gateProofVerified(input.independent_audit.proof, verifiedGateProofs) &&
    Number.isInteger(input.independent_audit.blocking_finding_count) &&
    input.independent_audit.blocking_finding_count >= 0
  ) {
    audit = input.independent_audit.blocking_finding_count === 0 ? "pass" : "fail";
    if (audit === "fail") reasons.push("INDEPENDENT_R2_AUDIT_BLOCKING_FINDING");
  } else {
    reasons.push("INDEPENDENT_R2_AUDIT_INCOMPLETE");
  }

  const blockingDefectCount = input.blocking_defects.length;
  if (blockingDefectCount > 0) reasons.push("BLOCKING_DEFECTS_OPEN");
  const gates = {
    g1_evaluator_contract: g1,
    g2_integration: g2,
    g3_live_canary: g3,
    independent_r2_audit: audit,
  };
  const hasFailedGate = Object.values(gates).includes("fail");
  const allGatesPassed = Object.values(gates).every((status) => status === "pass");
  const verdict: KusabiV1Verdict = hasFailedGate || blockingDefectCount > 0
    ? "FAIL"
    : allGatesPassed ? "PASS" : "INCOMPLETE";

  return {
    schema_version: KUSABI_V1_ACCEPTANCE_SCHEMA,
    verdict,
    kusabi_v1_pass: verdict === "PASS",
    gates,
    live_pass_count: livePassCount,
    required_live_pass_count: 3,
    g3_native_host_matrix: {
      required_hosts: requiredHosts,
      observed_hosts: observedHosts,
      pass_by_host: passByHost,
      exact: exactHostMatrix,
    },
    blocking_defect_count: blockingDefectCount,
    reasons: unique(reasons),
  };
}
