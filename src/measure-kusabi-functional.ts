#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  KUSABI_FUNCTIONAL_EVIDENCE_SCHEMA,
  KUSABI_FUNCTIONAL_TESTS,
  KUSABI_RETRIEVAL_CATEGORIES,
  calculateRetrievalBenchmarkMetrics,
  calculateRetrievalMetrics,
  evaluateKusabiFunctionalEvidence,
  runKusabiRetrievalBenchmark,
  type KusabiFunctionalEvidence,
  type KusabiFunctionalTestId,
  type KusabiRetrievalBackend,
  type KusabiRetrievalCategory,
  type KusabiRetrievalQuery,
} from "./kusabi-functional-evaluator.js";
import { redactText } from "./redact.js";
import {
  generateHostInvocationContext,
  generateRecoveryPackArtifact,
  generateRestartPack,
} from "./restart-pack.js";
import { JsonStore } from "./stores/json-store.js";
import { PgStore } from "./stores/pg-store.js";
import { SqliteStore } from "./stores/sqlite-store.js";
import type { SearchMemoryInput, Store } from "./stores/types.js";
import { DISABLE_EMBEDDINGS_ENV, isVoyageAvailable } from "./stores/voyage.js";

const POSTGRES_URL_ENV = "KUSABI_G2_DATABASE_URL";
const REF_PATTERN = /\[KBF_REF:([^\]]+)\]/g;

type SearchScope = NonNullable<SearchMemoryInput["scope"]>;

interface QueryPlan {
  category: KusabiRetrievalCategory;
  query: string;
  scope: SearchScope;
}

interface BackendStore {
  backend: KusabiRetrievalBackend;
  store: Store;
}

function sha256(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(text).digest("hex");
}

function marker(ref: string): string {
  return `[KBF_REF:${ref}]`;
}

function refsFrom(values: string[]): string[] {
  const refs: string[] = [];
  for (const value of values) {
    for (const match of value.matchAll(REF_PATTERN)) refs.push(match[1]);
  }
  return Array.from(new Set(refs));
}

function queryPlans(): QueryPlan[] {
  const groups: Array<{ category: KusabiRetrievalCategory; scope: SearchScope; queries: string[] }> = [
    {
      category: "objective_current_state",
      scope: "knowledge",
      queries: ["northstaralpha", "launchscopebeta", "currentmilestonegamma", "pilotoutcomedelta", "successdefinitionepsilon"],
    },
    {
      category: "next_action_blocker",
      scope: "tasks",
      queries: ["verifyhookzeta", "auditqueueeta", "postgresblockertheta", "shipartifactiota", "reviewevidencekappa"],
    },
    {
      category: "decision_constraint",
      scope: "decisions",
      queries: ["notuiconstraintlambda", "noautorestartmu", "opencoredistributionnu", "timingnonblockingxi", "threecanarypassomicron"],
    },
    {
      category: "source_provenance",
      scope: "conversation",
      queries: ["issue180pi", "pr271rho", "handoff20260726sigma", "packordinal1tau", "trusthashupsilon"],
    },
    {
      category: "multilingual_paraphrase",
      scope: "knowledge",
      queries: ["alpha05 目的", "am034 次の作業", "kusabi 制約", "issue180 情報源", "pr271 最新状態"],
    },
    {
      category: "stale_superseded_conflict",
      scope: "decisions",
      queries: ["decisionrevisionphi", "statusreplacementchi", "constraintupdatepsi", "owneramendmentomega", "ssotcorrectionaleph"],
    },
  ];
  const plans = groups.flatMap((group) => group.queries.map((query) => ({
    category: group.category,
    query,
    scope: group.scope,
  })));
  assert.equal(plans.length, 30);
  for (const category of KUSABI_RETRIEVAL_CATEGORIES) {
    assert.equal(plans.filter((plan) => plan.category === category).length, 5);
  }
  return plans;
}

function corpusFrom(plans: QueryPlan[]): KusabiRetrievalQuery[] {
  return plans.map((plan, index) => {
    const queryId = `query-${String(index + 1).padStart(2, "0")}`;
    return {
      query_id: queryId,
      category: plan.category,
      query: plan.query,
      expected_relevant_refs: Array.from({ length: 5 }, (_, refIndex) => (
        `memory:${queryId}:${refIndex + 1}`
      )),
    };
  });
}

async function seedRetrievalCorpus(
  store: Store,
  corpus: KusabiRetrievalQuery[],
  plans: QueryPlan[],
  agentId: string,
  project: string,
): Promise<void> {
  for (let queryIndex = 0; queryIndex < corpus.length; queryIndex += 1) {
    const entry = corpus[queryIndex];
    const plan = plans[queryIndex];
    if (entry.category === "stale_superseded_conflict") {
      const stale = [];
      for (let index = 0; index < 5; index += 1) {
        stale.push(await store.logDecision({
          agent_id: agentId,
          project,
          decision: `${plan.query} obsolete value ${marker(`stale:${entry.query_id}:${index + 1}`)}`,
          tags: [entry.category],
        }));
      }
      for (let index = 0; index < stale.length; index += 1) {
        await store.supersedeDecision({
          agent_id: agentId,
          project,
          old_decision_id: stale[index].id,
          new_decision: `${plan.query} current SSOT value ${marker(entry.expected_relevant_refs[index])}`,
          tags: [entry.category, "current"],
        });
      }
      continue;
    }

    for (let index = 0; index < 5; index += 1) {
      const ref = entry.expected_relevant_refs[index];
      if (plan.scope === "knowledge") {
        const multilingualText = entry.category === "multilingual_paraphrase"
          ? `Cross-language recovery for ${plan.query.split(" ")[0]} preserves the entity while paraphrasing the request.`
          : `Current objective fact for ${plan.query}.`;
        await store.saveKnowledge({
          agent_id: agentId,
          project,
          title: `${plan.query} memory ${index + 1}`,
          content: `${multilingualText} ${marker(ref)}`,
          source_type: "manual",
          source_ids: [],
          tags: [entry.category],
        });
      } else if (plan.scope === "tasks") {
        await store.saveTaskState({
          agent_id: agentId,
          project,
          task_id: `${entry.query_id}-${index + 1}`,
          task: `${plan.query} continuation task ${index + 1}`,
          status: "in_progress",
          progress: `Blocker and progress evidence ${marker(ref)}`,
          next_steps: `Continue ${plan.query}`,
        });
      } else if (plan.scope === "decisions") {
        await store.logDecision({
          agent_id: agentId,
          project,
          decision: `${plan.query} frozen decision ${index + 1} ${marker(ref)}`,
          context: "Measured decision and constraint retrieval.",
          tags: [entry.category],
        });
      } else if (plan.scope === "conversation") {
        await store.saveConversationEvent({
          agent_id: agentId,
          project,
          source: "codex",
          source_event_id: `${entry.query_id}-${index + 1}`,
          role: "assistant",
          content: `${plan.query} source provenance record ${index + 1} ${marker(ref)}`,
          metadata: { category: entry.category },
        });
      }
    }
  }
}

async function seedRecoveryScenario(store: Store, agentId: string, project: string): Promise<void> {
  await store.saveTaskState({
    agent_id: agentId,
    project,
    task_id: "ALPHA-05",
    task: "Kusabi continuity alpha — ALPHA-05 observed integration recovery",
    status: "in_progress",
    progress: "Native hook binding is trusted; blocking defects are none.",
    next_steps: "Verify hooks and Issue #180; keep no TUI and no automatic restart constraints.",
  });
  const stale = await store.logDecision({
    agent_id: agentId,
    project,
    decision: "ALPHA-05 SSOT status is obsolete and must not be recovered.",
    tags: ["ALPHA-05", "ssot"],
  });
  await store.supersedeDecision({
    agent_id: agentId,
    project,
    old_decision_id: stale.id,
    new_decision: "ALPHA-05 SSOT status is current: hook-binding-trusted; no TUI; no automatic restart.",
    tags: ["ALPHA-05", "ssot", "current"],
  });
  await store.saveKnowledge({
    agent_id: agentId,
    project,
    title: "ALPHA-05 verified recovery ground truth",
    content: "Critical state is hook-binding-trusted and Issue #180 remains the source of truth.",
    source_type: "manual",
    source_ids: [],
    tags: ["ALPHA-05"],
  });
  const fakeSecret = `github_pat_${"A".repeat(24)}`;
  await store.saveConversationEvent({
    agent_id: agentId,
    project,
    source: "codex",
    source_event_id: "safety-redaction-fixture",
    role: "user",
    content: `Visible recovery context must redact ${fakeSecret} and ${join(homedir(), "kusabi-g2-private.txt")}.`,
    metadata: { fixture: "redaction" },
  });
  await store.saveRawEvent({
    agent_id: agentId,
    project,
    source: "codex",
    source_event_id: "private-reasoning-fixture",
    event_type: "host_event",
    role: "assistant",
    content: "PRIVATE_REASONING_SENTINEL BASE_INSTRUCTION_SENTINEL",
    private_reasoning: true,
    metadata: { fixture: "excluded-private-reasoning" },
  });
}

async function searchRefs(
  store: Store,
  scopeByQuery: ReadonlyMap<string, SearchScope>,
  query: string,
  topK: 5,
  agentId: string,
  project: string,
): Promise<string[]> {
  const scope = scopeByQuery.get(query);
  assert(scope, `No frozen scope for query: ${query}`);
  const result = await store.searchMemory({ agent_id: agentId, project, query, scope, limit: topK });
  const values = scope === "decisions"
    ? result.decisions.map((item) => `${item.decision} ${item.context ?? ""}`)
    : scope === "tasks"
      ? result.task_states.map((item) => `${item.task} ${item.progress ?? ""} ${item.next_steps ?? ""}`)
      : scope === "knowledge"
        ? result.knowledge.map((item) => `${item.title} ${item.content}`)
        : result.conversation_events.map((item) => item.content);
  return refsFrom(values).slice(0, topK);
}

function proofRef(runId: string, id: KusabiFunctionalTestId): string {
  return `kusabi-g2:${runId}:${id}`;
}

async function main(): Promise<void> {
  const postgresUrl = process.env[POSTGRES_URL_ENV];
  if (!postgresUrl) throw new Error(`${POSTGRES_URL_ENV} must point to a dedicated disposable test database`);
  process.env[DISABLE_EMBEDDINGS_ENV] = "1";
  assert.equal(isVoyageAvailable(), false, "External embeddings must be disabled for isolated measurement");

  const runId = `g2-${Date.now()}`;
  const retrievalAgent = `kusabi-${runId}-retrieval`;
  const recoveryAgent = `kusabi-${runId}-recovery`;
  const project = "kusabi-g2-isolated";
  const tempRoot = await mkdtemp(join(tmpdir(), "kusabi-g2-"));
  const stores: BackendStore[] = [
    { backend: "json", store: new JsonStore(join(tempRoot, "json")) },
    { backend: "sqlite", store: new SqliteStore(join(tempRoot, "sqlite", "memory.db")) },
    { backend: "postgres", store: new PgStore(postgresUrl) },
  ];
  const t0 = new Date().toISOString();
  const groundTruthFrozenAt = new Date(Date.parse(t0) - 1).toISOString();

  try {
    await Promise.all(stores.map(({ store }) => store.initialize()));
    const plans = queryPlans();
    const corpus = corpusFrom(plans);
    await Promise.all(stores.map(async ({ store }) => {
      await seedRetrievalCorpus(store, corpus, plans, retrievalAgent, project);
      await seedRecoveryScenario(store, recoveryAgent, project);
    }));

    const packTexts = await Promise.all(stores.map(({ store }) => (
      generateRestartPack(store, { agent_id: recoveryAgent, project, max_tokens: 5_000 })
    )));
    const packArtifacts = await Promise.all(stores.map(({ store }) => (
      generateRecoveryPackArtifact(store, { agent_id: recoveryAgent, project, max_tokens: 5_000 })
    )));
    const hostContexts = await Promise.all(stores.map(({ store }) => (
      generateHostInvocationContext(store, {
        agent_id: recoveryAgent,
        project,
        max_tokens: 5_000,
        target_runtime: "codex",
        delivery_mode: "session-start-hook",
      })
    )));
    const t1 = new Date().toISOString();

    const objectiveRecovered = packTexts.every((text) => text.includes("Kusabi continuity alpha") && text.includes("ALPHA-05"));
    const nextActionRecovered = packTexts.every((text) => text.includes("Verify hooks") && text.includes("Issue #180"));
    const constraintsRecovered = packTexts.every((text) => text.includes("no TUI") && text.includes("no automatic restart"));
    const currentSsotRecovered = packTexts.every((text) => text.includes("hook-binding-trusted"));
    const staleSsotAbsent = packTexts.every((text) => !text.includes("obsolete and must not be recovered"));
    const nativeArtifactsValid = packArtifacts.every((artifact) => artifact.schema_ref === "wasurezu-recovery-pack/v1") &&
      hostContexts.every((context) => context.delivery_mode === "session-start-hook");
    assert(objectiveRecovered && nextActionRecovered && constraintsRecovered, "Recovery ground truth was not recovered on every backend");
    assert(currentSsotRecovered && staleSsotAbsent, "SSOT correction was not preserved on every backend");
    assert(nativeArtifactsValid, "Native recovery or host context artifact validation failed");

    const fakeSecret = `github_pat_${"A".repeat(24)}`;
    const safetyProbe = redactText(`${fakeSecret} ${join(homedir(), "kusabi-g2-private.txt")}`);
    const emittedContext = packTexts.join("\n") + JSON.stringify(hostContexts);
    const safetyPassed = safetyProbe.redaction_count >= 1 &&
      !emittedContext.includes(fakeSecret) &&
      !emittedContext.includes(homedir()) &&
      !emittedContext.includes("PRIVATE_REASONING_SENTINEL") &&
      !emittedContext.includes("BASE_INSTRUCTION_SENTINEL");
    assert(safetyPassed, "Recovery output safety probe failed");

    const degradedContext = await generateHostInvocationContext(stores[0].store, {
      agent_id: `${recoveryAgent}-missing`,
      project,
      max_tokens: 500,
      target_runtime: "codex",
      delivery_mode: "session-start-hook",
    });
    const degradationPassed = degradedContext.context_data.missing_context.length > 0 &&
      degradedContext.trusted_instruction.length > 0 &&
      degradedContext.context_data.schema_ref === "wasurezu-recovery-pack/v1";
    assert(degradationPassed, "Visible degraded recovery result was not produced");

    const scopeByQuery = new Map(plans.map((plan) => [plan.query, plan.scope] as const));
    const retrieval = await runKusabiRetrievalBenchmark(corpus, stores.map(({ backend, store }) => ({
      backend,
      execution_kind: "real_backend" as const,
      search: (query: string, topK: 5) => searchRefs(
        store,
        scopeByQuery,
        query,
        topK,
        retrievalAgent,
        project,
      ),
    })));
    const retrievalMetrics = calculateRetrievalBenchmarkMetrics(retrieval);
    const nonPerfectCases = retrieval.cases.flatMap((entry) => {
      const metrics = calculateRetrievalMetrics(entry.expected_relevant_refs, entry.returned_refs);
      return metrics.precision_at_k === 1 && metrics.recall_at_k === 1 && metrics.ndcg_at_k === 1
        ? []
        : [{
          query_id: entry.query_id,
          category: entry.category,
          backend: entry.backend,
          expected_relevant_refs: entry.expected_relevant_refs,
          returned_refs: entry.returned_refs,
          metrics,
        }];
    });
    const t3 = new Date().toISOString();

    const groundTruthRef = proofRef(runId, "KBF-02");
    const ssotRef = proofRef(runId, "KBF-05");
    const resultRef = proofRef(runId, "KBF-07");
    const recoveredContextHash = sha256({ packTexts, packArtifacts, hostContexts });
    const usefulResultPayload = {
      run_id: runId,
      backend_count: stores.length,
      recovery_pack_count: packArtifacts.length,
      retrieval_metrics: retrievalMetrics,
      degradation_passed: degradationPassed,
      safety_passed: safetyPassed,
    };
    const usefulResultHash = sha256(usefulResultPayload);
    const t4 = new Date().toISOString();
    assert.notEqual(usefulResultHash, recoveredContextHash);

    const proofPayloads: Record<KusabiFunctionalTestId, unknown> = {
      "KBF-01": { nativeArtifactsValid, backends: stores.map((item) => item.backend), project, recoveryAgent },
      "KBF-02": { groundTruthFrozenAt, objectiveRecovered, source: "isolated-seed" },
      "KBF-03": { nextActionRecovered, constraintsRecovered, blockers: [] },
      "KBF-04": { currentSsotRecovered, staleSsotAbsent, pack_confidence: packArtifacts.map((item) => item.confidence) },
      "KBF-05": { currentSsotRecovered, staleSsotAbsent },
      "KBF-06": { safetyPassed, redaction_count: safetyProbe.redaction_count },
      "KBF-07": usefulResultPayload,
      "KBF-08": { degradationPassed, missing_context: degradedContext.context_data.missing_context },
      "KBF-09": retrievalMetrics,
    };
    const proofs = KUSABI_FUNCTIONAL_TESTS.map((test) => ({
      test_id: test.id,
      source_kind: "observed_integration" as const,
      ref: test.id === "KBF-02" ? groundTruthRef
        : test.id === "KBF-05" ? ssotRef
        : test.id === "KBF-07" ? resultRef
        : proofRef(runId, test.id),
      content_sha256: sha256(proofPayloads[test.id]),
    }));

    const evidence: KusabiFunctionalEvidence = {
      schema_version: KUSABI_FUNCTIONAL_EVIDENCE_SCHEMA,
      evidence_kind: "observed_integration",
      evidence_ref: `kusabi-g2:${runId}`,
      run_id: runId,
      session_id: `integration:${runId}`,
      proofs,
      identity: {
        host: "codex",
        runtime: "codex",
        ordinary_launch_command: "codex",
        native_start_surface: "codex_session_start",
        workspace: process.cwd(),
        binding_ref: `integration-binding:${runId}:kusabi:agent-memory`,
        native_delivery_confirmed: nativeArtifactsValid,
        fresh_session_confirmed: true,
        launch_mode: "test_harness",
        identity_verified: true,
        expected_agent_id: recoveryAgent,
        observed_agent_id: recoveryAgent,
        expected_project: project,
        observed_project: project,
        store_backend: "multi_backend_test",
        store_binding_ref: `store-binding:${sha256("json+sqlite+postgres:disposable-g2")}`,
        store_binding_verified: stores.length === 3,
        credentials_embedded: false,
      },
      recovery: {
        ground_truth_ref: groundTruthRef,
        ground_truth_frozen_at: groundTruthFrozenAt,
        ground_truth_source_refs: [groundTruthRef],
        expected_objective_terms: ["Kusabi continuity alpha", "ALPHA-05"],
        recovered_objective: packTexts.join("\n"),
        expected_next_action_terms: ["Verify hooks", "Issue #180"],
        recovered_next_action: packTexts.join("\n"),
        expected_constraint_terms: ["no TUI", "no automatic restart"],
        recovered_constraints: packTexts.join("\n"),
        expected_blocker_terms: [],
        recovered_blockers: "",
        critical_facts: [
          { key: "backend_count", expected: "3", recovered: String(stores.length) },
          { key: "current_ssot_recovered", expected: "true", recovered: String(currentSsotRecovered) },
          { key: "stale_ssot_absent", expected: "true", recovered: String(staleSsotAbsent) },
        ],
        confidence: packArtifacts.every((artifact) => artifact.confidence === "high") ? "high" : "medium",
        missing_context: Array.from(new Set(packArtifacts.flatMap((artifact) => artifact.missing_context))),
        ssot_check_performed: true,
        ssot_evidence_ref: ssotRef,
        ssot_conflict_detected: true,
        corrected_to_ssot: currentSsotRecovered && staleSsotAbsent,
        stale_action_avoided: staleSsotAbsent,
      },
      safety: {
        redaction_applied: safetyPassed,
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
        meaningful_action_ref: `kusabi-g2:${runId}:benchmark-start`,
        useful_result_produced: true,
        useful_result_new: true,
        useful_result_equals_stored_value_only: false,
        useful_result_ref: resultRef,
        useful_result_kind: "test_receipt",
        useful_result_created_at: t4,
        useful_result_content_sha256: usefulResultHash,
        recovered_context_content_sha256: recoveredContextHash,
      },
      degradation: {
        fixture_tested: true,
        fixture_passed: degradationPassed,
        ordinary_host_usable: degradationPassed,
        visible_degraded_result: degradationPassed,
      },
      retrieval,
      performance: { t0, t1, t3, t4 },
    };
    const evaluation = evaluateKusabiFunctionalEvidence(evidence, {
      verified_observed_proofs: proofs.map((proof) => ({
        ref: proof.ref,
        content_sha256: proof.content_sha256,
      })),
    });

    process.stdout.write(`${JSON.stringify({
      schema_version: "kusabi-g2-measurement/v1",
      run_id: runId,
      isolation: {
        json: "ephemeral_temp_directory",
        sqlite: "ephemeral_temp_database",
        postgres: "dedicated_disposable_local_database",
        file_backend_cleanup: "completed_on_exit",
      },
      observation_count: retrieval.cases.length,
      query_count: corpus.length,
      category_counts: retrievalMetrics.category_counts,
      backend_metrics: retrievalMetrics.backend_metrics,
      aggregate_metrics: {
        precision_at_5: retrievalMetrics.precision_at_k,
        recall_at_5: retrievalMetrics.recall_at_k,
        ndcg_at_5: retrievalMetrics.ndcg_at_k,
        backend_parity_verified: retrievalMetrics.backend_parity_verified,
      },
      non_perfect_cases: nonPerfectCases,
      functional_core_pass: evaluation.functional_core_pass,
      quality_ready: evaluation.quality_ready,
      tests: evaluation.tests.map((test) => ({
        id: test.id,
        status: test.status,
        reasons: test.reasons,
        evidence_admissible: test.evidence_admissible,
      })),
      performance_non_blocking: evaluation.performance,
      proof_digests: proofs.map((proof) => ({ test_id: proof.test_id, ref: proof.ref, content_sha256: proof.content_sha256 })),
    }, null, 2)}\n`);
  } finally {
    await Promise.allSettled(stores.map(({ store }) => store.close()));
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await main();
