#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, "..");
const GOAL_ID = "GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804";
const GOAL_PATH = ".shirube/goal-runs/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.json";
const GOAL_HISTORY_DIR = ".shirube/goal-runs/history";
const BINDING_PATH = ".shirube/execution-goal-bindings/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.kusabi.json";
const WORK_ITEM_DIR = ".shirube/work-items/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804";
const EVIDENCE_PATH = ".shirube/evidence/SHIRUBE-V4-GOALRUN-ADOPTION-20260804.json";
const R0_PATH = ".shirube/evidence/KUSABI-ALPHA-OBS05-R0-CANDIDATE-20260801.json";
const HANDOFF_PATH = ".shirube/control-handoffs/CH-AGENT-MEMORY-SHIRUBE-V4-GOALRUN-ACTIVATION-20260804-001.yaml";
const EXPECTED_TREE = "acda601dbb5ea14d7ef5db955b638eaece6cda50";
const EXPECTED_VERSION = `git-tree:${EXPECTED_TREE}`;
const EXPECTED_TARGET_SET_SHA256 = "69be7fb005847676dd8821154508b9764716287226b7560ce274ef499dc1e2ec";
const CANONICAL_CONTRACT_PR = "https://github.com/watchout/ai-dev-framework/pull/564";
const EXACT_MERGE = {
  head: "85c852cb527fc1c5f96deb0c2ebec35737dcd2c1",
  tree: EXPECTED_TREE,
  merge_commit: "867b7be7feed82ebb8c57334867858f16b8da341",
  merged_at: "2026-08-03T22:41:12Z",
  evidence_ref: "https://github.com/watchout/agent-memory/issues/280#issuecomment-5172517192",
};
const ALL_OPERATIONS = [
  "WORK_ITEM_DISPATCH", "INDEPENDENT_AUDIT", "INDEPENDENT_REAUDIT", "PARENT_RETURN",
  "EVIDENCE_RECORD", "INTERNAL_REPLY", "GITHUB_WRITEBACK", "DEPENDENCY_BYPASS",
  "LOCAL_DIRECT_ADAPTER", "EXACT_CONTROL_HANDOFF_ACQUISITION", "DESIGN_GAP_RETURN",
  "FINAL_MERGE", "CONTROL_DOC_MERGE", "PROTECTED_OWNER_DECISION", "SCHEMA_MIGRATION",
  "RUNTIME_RUNNER_ACTIVATION", "PROVIDER_AUN_ACTIVATION", "WORKFLOW_PROTECTION",
  "SECRET_MUTATION", "DEPLOY", "EXTERNAL_SEND", "ENROLLMENT_FLEET_CUTOVER",
  "AUTHORITY_MUTATION", "ROOT_CANCEL", "ROOT_SUPERSEDE",
];

const ACCEPTANCE = [
  {
    acceptance_id: "A-01-PR281-EXACT-MERGE",
    ordinal: 1,
    predicate: "PR 281 approved head 85c852cb and tree acda601d are normally merged, the merge tree equals acda601d, and the merge commit is an ancestor of main.",
    evidence_classes: ["owner_decision_readback", "exact_merge_readback", "main_ancestry_readback"],
  },
  {
    acceptance_id: "A-02-IMMUTABLE-RUNTIME-RELEASE",
    ordinal: 2,
    predicate: "A clean detached post-merge build is published once to the content-addressed runtime store with exact release, dist-tree, entrypoint, mode, and provenance readback.",
    evidence_classes: ["clean_build_readback", "content_addressed_release_readback", "entrypoint_digest_readback"],
  },
  {
    acceptance_id: "A-03-R0-V3-HEARTBEAT-REPRODUCTION",
    ordinal: 3,
    predicate: "Two read-only R0 v3 captures separated by ordinary heartbeat advance reproduce the same 35 target identities, stable binding refs, manifest, plan, expected postimages, rollback preimages, batch topology, and release descriptor.",
    evidence_classes: ["r0_v3_capture_a", "ordinary_heartbeat_separation", "r0_v3_capture_b", "r0_v3_equality_matrix"],
  },
  {
    acceptance_id: "A-04-R0-V3-INDEPENDENT-AUDIT",
    ordinal: 4,
    predicate: "An independent exact-ref audit verifies the immutable release and R0 v3 pack with zero blocking findings and zero protected rollout effects.",
    evidence_classes: ["independent_audit_pass", "audit_blocker_count_zero", "protected_effect_count_zero"],
  },
  {
    acceptance_id: "A-05-R0-V3-OWNER-GO",
    ordinal: 5,
    predicate: "A new authenticated owner decision binds the exact merge, release, stable-binding contracts, manifest, plan, R0 hashes, 35-target set, batch topology, audit PASS, and explicit R1/R2/R3 grants.",
    evidence_classes: ["owner_exact_subject_readback", "owner_r1_r2_r3_grant"],
  },
  {
    acceptance_id: "A-06-R1-CANARY-3-OF-3",
    ordinal: 6,
    predicate: "The frozen Codex, Claude Code, and Gemini CLI canary targets pass exact deployment, durable event, identity, recovery, alert, privacy, and ordinary-use checks 3 of 3.",
    evidence_classes: ["r1_stage_report", "r1_exact_durable_readback", "r1_alert_privacy_recovery_smoke"],
  },
  {
    acceptance_id: "A-07-R2-PILOT-11-OF-11",
    ordinal: 7,
    predicate: "All 11 frozen R2 targets are exact and durable with zero failed, drifted, not_observed, or open P0/P1, backend parity 100 percent, and one hour without repeated degradation.",
    evidence_classes: ["r2_stage_report", "r2_one_hour_observation", "r2_backend_parity_readback"],
  },
  {
    acceptance_id: "A-08-R3-FLEET-35-OF-35",
    ordinal: 8,
    predicate: "All 21 frozen R3 targets complete in deterministic batches and the cumulative frozen manifest is exact and durable 35 of 35 with registry equality and zero blockers or privacy violations.",
    evidence_classes: ["r3_batch_reports", "full_manifest_obs04_readback", "registry_manifest_equality_35_of_35"],
  },
  {
    acceptance_id: "A-09-POSTIMPLEMENTATION-AUDIT",
    ordinal: 9,
    predicate: "Independent postimplementation verification accepts the exact merged runtime and all rollout, rollback, privacy, parity, alert, and failure-isolation evidence with zero blockers.",
    evidence_classes: ["postimplementation_audit_pass", "postimplementation_blocker_count_zero"],
  },
  {
    acceptance_id: "A-10-OBS06-24H-96-CHECKPOINTS",
    ordinal: 10,
    predicate: "For 24 continuous hours and all 96 checkpoints, all 35 targets remain exact and durable with zero failed, drifted, not_observed, privacy escape, open P0/P1, or repeated degradation and with backend parity 100 percent.",
    evidence_classes: ["obs06_96_checkpoint_packet", "obs06_final_exact_snapshot", "obs06_alert_latency_and_backend_parity"],
  },
  {
    acceptance_id: "A-11-FINAL-OWNER-CLOSURE",
    ordinal: 11,
    predicate: "Independent closure review passes with zero blockers and the authenticated owner closes the exact 96-checkpoint packet with next_action none.",
    evidence_classes: ["independent_closure_review_pass", "authenticated_owner_closure", "next_action_none"],
  },
];

const WORK_ITEM_DEFINITIONS = [
  ["PR281-EXACT-MERGE", "A-01-PR281-EXACT-MERGE", "FINAL_MERGE", ["owner_decision_readback", "exact_merge_readback", "main_ancestry_readback"], ["B-01-PR281-EXACT-MERGE"], "aun://queue/147691/CH-KUSABI-OBS05-ORDER90-EXACT-HEAD-MERGE-20260803-001"],
  ["IMMUTABLE-RUNTIME-RELEASE", "A-02-IMMUTABLE-RUNTIME-RELEASE", "LOCAL_DIRECT_ADAPTER", ["clean_build_readback", "content_addressed_release_readback", "entrypoint_digest_readback"], [], "https://github.com/watchout/agent-memory/issues/280#issuecomment-5165228243"],
  ["R0-V3-HEARTBEAT-REPRODUCTION", "A-03-R0-V3-HEARTBEAT-REPRODUCTION", "LOCAL_DIRECT_ADAPTER", ["r0_v3_capture_a", "ordinary_heartbeat_separation", "r0_v3_capture_b", "r0_v3_equality_matrix"], [], "https://github.com/watchout/agent-memory/issues/280#issuecomment-5165228243"],
  ["R0-V3-INDEPENDENT-AUDIT", "A-04-R0-V3-INDEPENDENT-AUDIT", "INDEPENDENT_AUDIT", ["independent_audit_pass", "audit_blocker_count_zero", "protected_effect_count_zero"], [], "https://github.com/watchout/agent-memory/issues/280#issuecomment-5165228243"],
  ["R0-V3-OWNER-GO", "A-05-R0-V3-OWNER-GO", "PROTECTED_OWNER_DECISION", ["owner_exact_subject_readback", "owner_r1_r2_r3_grant"], [], "https://github.com/watchout/agent-memory/issues/280#issuecomment-5165228243"],
  ["R1-CANARY-3-OF-3", "A-06-R1-CANARY-3-OF-3", "DEPLOY", ["r1_stage_report", "r1_exact_durable_readback", "r1_alert_privacy_recovery_smoke"], [], "https://github.com/watchout/agent-memory/issues/280"],
  ["R2-PILOT-11-OF-11", "A-07-R2-PILOT-11-OF-11", "DEPLOY", ["r2_stage_report", "r2_one_hour_observation", "r2_backend_parity_readback"], [], "https://github.com/watchout/agent-memory/issues/280"],
  ["R3-FLEET-35-OF-35", "A-08-R3-FLEET-35-OF-35", "DEPLOY", ["r3_batch_reports", "full_manifest_obs04_readback", "registry_manifest_equality_35_of_35"], [], "https://github.com/watchout/agent-memory/issues/280"],
  ["POSTIMPLEMENTATION-AUDIT", "A-09-POSTIMPLEMENTATION-AUDIT", "INDEPENDENT_AUDIT", ["postimplementation_audit_pass", "postimplementation_blocker_count_zero"], [], "https://github.com/watchout/agent-memory/issues/280"],
  ["OBS06-24H-96-CHECKPOINTS", "A-10-OBS06-24H-96-CHECKPOINTS", "EVIDENCE_RECORD", ["obs06_96_checkpoint_packet", "obs06_final_exact_snapshot", "obs06_alert_latency_and_backend_parity"], [], "https://github.com/watchout/agent-memory/issues/280"],
  ["FINAL-OWNER-CLOSURE", "A-11-FINAL-OWNER-CLOSURE", "PROTECTED_OWNER_DECISION", ["independent_closure_review_pass", "authenticated_owner_closure", "next_action_none"], [], "https://github.com/watchout/agent-memory/issues/280"],
];

const ROUTE_BY_ACCEPTANCE_ID = {
  "A-01-PR281-EXACT-MERGE": {
    actor_agent_id: "ceo",
    active_function: "owner_decision",
    blocking: true,
    action: "API-read the approved PR 281 head/tree, perform the normal protected Ready/merge as the human merge actor, and return the immutable merge receipt.",
    deliver_via: "GitHub PR 281 normal protected workflow plus GoalRun terminal evidence",
  },
  "A-02-IMMUTABLE-RUNTIME-RELEASE": {
    actor_agent_id: "kusabi",
    active_function: "implementation_executor",
    blocking: false,
  },
  "A-03-R0-V3-HEARTBEAT-REPRODUCTION": {
    actor_agent_id: "kusabi",
    active_function: "implementation_executor",
    blocking: false,
  },
  "A-04-R0-V3-INDEPENDENT-AUDIT": {
    actor_agent_id: "codex-audit",
    active_function: "evidence_audit_gate",
    blocking: true,
  },
  "A-05-R0-V3-OWNER-GO": {
    actor_agent_id: "ceo",
    active_function: "owner_decision",
    blocking: true,
  },
  "A-06-R1-CANARY-3-OF-3": {
    actor_agent_id: "kusabi",
    active_function: "implementation_executor",
    blocking: false,
  },
  "A-07-R2-PILOT-11-OF-11": {
    actor_agent_id: "kusabi",
    active_function: "implementation_executor",
    blocking: false,
  },
  "A-08-R3-FLEET-35-OF-35": {
    actor_agent_id: "kusabi",
    active_function: "implementation_executor",
    blocking: false,
  },
  "A-09-POSTIMPLEMENTATION-AUDIT": {
    actor_agent_id: "devauditor",
    active_function: "scenario_verification_gate",
    blocking: true,
  },
  "A-10-OBS06-24H-96-CHECKPOINTS": {
    actor_agent_id: "kusabi",
    active_function: "implementation_executor",
    blocking: false,
  },
  "A-11-FINAL-OWNER-CLOSURE": {
    actor_agent_id: "ceo",
    active_function: "owner_decision",
    blocking: true,
  },
};

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function digestValue(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function sha256Raw(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseOptions(argv) {
  const command = argv[0] ?? "status";
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) options[key.slice(2)] = true;
    else { options[key.slice(2)] = value; index += 1; }
  }
  return { command, options };
}

function absolute(root, relativePath) {
  return isAbsolute(relativePath) ? relativePath : join(root, relativePath);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function targetKeys(sourceRoot) {
  const pack = readJson(absolute(sourceRoot, R0_PATH));
  const keys = pack?.result?.manifest?.targets?.map((target) => target.target_key).sort();
  if (!Array.isArray(keys) || keys.length !== 35 || new Set(keys).size !== 35) {
    throw new Error("frozen R0 target set is not exact 35/35");
  }
  const digest = sha256Raw(`${keys.join("\n")}\n`);
  if (digest !== EXPECTED_TARGET_SET_SHA256) {
    throw new Error(`target set digest mismatch: ${digest}`);
  }
  return keys;
}

export function computeGoalRunStateDigest(document) {
  return digestValue({
    root_goal_run_id: document.root_goal_run_id,
    objective_digest: document.objective_digest,
    acceptance_digest: document.acceptance_digest,
    target_digest: document.target_digest,
    status: document.status,
    blocker_set: document.blocker_set,
    acceptance_states: document.acceptance_states,
    target_states: document.target_states,
    active_work_item_id: document.active_work_item_id,
    checkpoint: document.checkpoint,
    generation: document.generation,
    verified_completion_evidence: document.verified_completion_evidence,
  });
}

function computeWorkItemStateDigest(document) {
  const { state_digest: _ignored, ...digestible } = document;
  return digestValue(digestible);
}

function computeDispatchIdempotencyKey(document, rootGeneration) {
  return digestValue({
    root_goal_run_id: document.root_goal_run_id,
    generation: rootGeneration,
    unmet_condition_id: document.unmet_condition_id,
    handoff_digest: document.handoff_digest,
    checkpoint: document.checkpoint,
  });
}

function computeBindingDigest(document) {
  return digestValue({
    root_goal_run_id: document.root_goal_run_id,
    contract_digest: document.contract_digest,
    objective_digest: document.objective_digest,
    target_digest: document.target_digest,
    generation: document.generation,
    active_work_item_id: document.active_work_item_id,
    unmet_acceptance_ids: document.unmet_acceptance_ids,
    checkpoint: document.checkpoint,
    state_digest: document.state_digest,
    adapter: document.adapter,
  });
}

function buildGoalRun(keys) {
  const objective = "Distribute the exact PR 281 Kusabi implementation to all 35 frozen eligible production bindings, prove exact durable live and rollback state through R1/R2/R3, sustain OBS-06 for 24 continuous hours and 96 checkpoints, and close only with independent verification and authenticated owner closure; Shirube V4 application itself is control infrastructure, not completion evidence.";
  const targetStates = keys.map((targetId) => ({
    target_id: targetId,
    expected_version: EXPECTED_VERSION,
    live_exact_version: null,
    rollback_exact_version: null,
    live_evidence_ref: null,
    rollback_evidence_ref: null,
    live_observed_at: null,
    rollback_observed_at: null,
    evidence_fresh_until: null,
  }));
  const document = {
    schema_version: "shirube-goal-run/v1",
    root_goal_run_id: GOAL_ID,
    objective,
    objective_digest: digestValue(objective).replace(/^sha256:/, "sha256:"),
    acceptance_set: ACCEPTANCE,
    acceptance_digest: digestValue([...ACCEPTANCE].sort((a, b) => a.ordinal - b.ordinal || a.acceptance_id.localeCompare(b.acceptance_id))),
    target_manifest_ref: "file:.shirube/evidence/KUSABI-ALPHA-OBS05-R0-CANDIDATE-20260801.json#pending",
    target_digest: digestValue(targetStates.map(({ target_id, expected_version }) => ({ target_id, expected_version })).sort((a, b) => a.target_id.localeCompare(b.target_id))),
    status: "BLOCKED",
    generation: 0,
    state_digest: "sha256:pending",
    active_work_item_id: null,
    blocker_set: [{
      blocker_id: "B-01-PR281-EXACT-MERGE",
      ordinal: 1,
      evidence_refs: ["https://github.com/watchout/agent-memory/pull/281", "aun://queue/147691"],
      removal_predicate: "Exact approved PR 281 head is normally merged, merge tree equals acda601d, and main ancestry is verified.",
    }],
    acceptance_states: ACCEPTANCE.map(({ acceptance_id }) => ({ acceptance_id, status: "UNMET", evidence_refs: [] })),
    target_states: targetStates,
    checkpoint: { event_sequence: 0, last_event_id: null, last_idempotency_key: null },
    verified_completion_evidence: [],
  };
  document.objective_digest = `sha256:${sha256Raw(objective)}`;
  document.target_manifest_ref = `file:${R0_PATH}#${document.target_digest}`;
  document.state_digest = computeGoalRunStateDigest(document);
  return document;
}

function buildWorkItems(goalRun, handoffBytes) {
  return WORK_ITEM_DEFINITIONS.map(([suffix, acceptanceId, operation, evidence, blockers, handoffRef], index) => {
    const controlHandoffRef = index === 0 ? handoffRef : handoffRef;
    const handoffDigest = index === 0
      ? digestValue({ control_handoff_ref: controlHandoffRef })
      : digestValue({ control_handoff_ref: controlHandoffRef, adoption_handoff_sha256: sha256Raw(handoffBytes) });
    const item = {
      schema_version: "shirube-work-item/v2",
      work_item_id: `WORK-ITEM-KUSABI-${suffix}`,
      root_goal_run_id: GOAL_ID,
      parent_work_item_id: null,
      control_handoff_ref: controlHandoffRef,
      handoff_digest: handoffDigest,
      allowed_operations: [operation],
      forbidden_operations: ALL_OPERATIONS.filter((candidate) => candidate !== operation),
      required_operation: operation,
      required_evidence: evidence,
      advances_acceptance_ids: [acceptanceId],
      removes_blocker_ids: blockers,
      unmet_condition_id: acceptanceId,
      acceptance_ordinal: index + 1,
      blocker_ordinal: blockers.length ? 1 : 0,
      status: "READY",
      dispatch_idempotency_key: "sha256:pending",
      generation: goalRun.generation,
      state_digest: "sha256:pending",
      checkpoint: { ...goalRun.checkpoint },
      terminal_evidence: [],
    };
    item.dispatch_idempotency_key = computeDispatchIdempotencyKey(item, goalRun.generation);
    item.state_digest = computeWorkItemStateDigest(item);
    return item;
  });
}

function buildBinding(goalRun, observedAt) {
  const adapter = {
    family: "codex",
    version: "agent-memory-shirube-v4-goal-control/v1",
    mode: "trusted_structured_binding",
    conformance_digest: digestValue({ canonical_contract_pr: CANONICAL_CONTRACT_PR, adapter: "agent-memory-shirube-v4-goal-control/v1" }),
  };
  const binding = {
    schema_version: "shirube-execution-goal-binding/v1",
    root_goal_run_id: GOAL_ID,
    contract_digest: digestValue({ goal_run: "shirube-goal-run/v1", work_item: "shirube-work-item/v2", execution_binding: "shirube-execution-goal-binding/v1", canonical_contract_pr: CANONICAL_CONTRACT_PR }),
    objective_digest: goalRun.objective_digest,
    target_digest: goalRun.target_digest,
    generation: goalRun.generation,
    active_work_item_id: goalRun.active_work_item_id,
    unmet_acceptance_ids: goalRun.acceptance_states.filter((state) => state.status !== "VERIFIED_PASS").map((state) => state.acceptance_id).sort(),
    checkpoint: { event_sequence: goalRun.checkpoint.event_sequence, last_event_id: goalRun.checkpoint.last_event_id },
    state_digest: goalRun.state_digest,
    adapter,
    readback: {
      observed_at: observedAt,
      observed_binding_digest: "sha256:pending",
      evidence_ref: EVIDENCE_PATH,
    },
  };
  binding.readback.observed_binding_digest = computeBindingDigest(binding);
  return binding;
}

function initialize(repoRoot, sourceRoot, observedAt) {
  const keys = targetKeys(sourceRoot);
  const goalRun = buildGoalRun(keys);
  const handoffBytes = readFileSync(absolute(repoRoot, HANDOFF_PATH));
  const workItems = buildWorkItems(goalRun, handoffBytes);
  const binding = buildBinding(goalRun, observedAt);
  writeJson(absolute(repoRoot, GOAL_PATH), goalRun);
  for (const item of workItems) writeJson(absolute(repoRoot, `${WORK_ITEM_DIR}/${item.work_item_id}.json`), item);
  writeJson(absolute(repoRoot, BINDING_PATH), binding);
  return { goalRun, workItems, binding };
}

function advanceExactMerge(repoRoot, observedAt) {
  const goalPath = absolute(repoRoot, GOAL_PATH);
  const previous = readJson(goalPath);
  if (previous.generation !== 0 || previous.acceptance_states.find((state) => state.acceptance_id === "A-01-PR281-EXACT-MERGE")?.status !== "UNMET") {
    throw new Error("exact merge advancement requires the unadvanced generation-0 GoalRun");
  }
  const previousPath = absolute(repoRoot, `${GOAL_HISTORY_DIR}/${GOAL_ID}.generation-0.json`);
  writeJson(previousPath, previous);

  const eventId = `EVENT-KUSABI-PR281-EXACT-MERGE-${EXACT_MERGE.merge_commit}`;
  const idempotencyKey = digestValue({
    event_id: eventId,
    head: EXACT_MERGE.head,
    tree: EXACT_MERGE.tree,
    merge_commit: EXACT_MERGE.merge_commit,
    evidence_ref: EXACT_MERGE.evidence_ref,
  });
  const checkpoint = { event_sequence: 1, last_event_id: eventId, last_idempotency_key: idempotencyKey };
  const goalRun = structuredClone(previous);
  goalRun.status = "ACTIVE";
  goalRun.generation = 1;
  goalRun.active_work_item_id = "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE";
  goalRun.blocker_set = [];
  goalRun.acceptance_states = goalRun.acceptance_states.map((state) => state.acceptance_id === "A-01-PR281-EXACT-MERGE"
    ? { ...state, status: "VERIFIED_PASS", evidence_refs: [EXACT_MERGE.evidence_ref, `git-commit:${EXACT_MERGE.merge_commit}`, `git-tree:${EXACT_MERGE.tree}`] }
    : state);
  goalRun.checkpoint = checkpoint;
  goalRun.state_digest = computeGoalRunStateDigest(goalRun);

  const evidenceByClass = {
    owner_decision_readback: "conversation:2026-08-04:explicit-merge-approval",
    exact_merge_readback: `git-commit:${EXACT_MERGE.merge_commit}`,
    main_ancestry_readback: EXACT_MERGE.evidence_ref,
  };
  const workItems = loadWorkItems(repoRoot).map(({ path, document }) => {
    const item = structuredClone(document);
    item.generation = goalRun.generation;
    item.checkpoint = { ...checkpoint };
    if (item.unmet_condition_id === "A-01-PR281-EXACT-MERGE") {
      item.status = "VERIFIED_TERMINAL";
      item.terminal_evidence = item.required_evidence.map((evidenceClass, index) => ({
        evidence_ref: evidenceByClass[evidenceClass],
        evidence_class: evidenceClass,
        subject_work_item_id: item.work_item_id,
        actor_id: "watchout",
        active_function: "owner_decision",
        provenance_ref: EXACT_MERGE.evidence_ref,
        acceptance_id: "A-01-PR281-EXACT-MERGE",
        blocker_id: index === 0 ? "B-01-PR281-EXACT-MERGE" : null,
        exact_version: `git-tree:${EXACT_MERGE.tree}`,
        predicate_verified: true,
      }));
    }
    item.dispatch_idempotency_key = computeDispatchIdempotencyKey(item, goalRun.generation);
    item.state_digest = computeWorkItemStateDigest(item);
    writeJson(path, item);
    return item;
  });
  writeJson(goalPath, goalRun);
  const binding = buildBinding(goalRun, observedAt);
  writeJson(absolute(repoRoot, BINDING_PATH), binding);
  return { goalRun, workItems, binding, previousPath };
}

function frameworkRoot(repoRoot, explicit) {
  const candidates = [
    explicit,
    process.env.SHIRUBE_FRAMEWORK_ROOT,
    resolve(repoRoot, "../ai-dev-framework"),
    resolve(repoRoot, "../ai-dev-framework-v4-integration"),
  ].filter(Boolean);
  const required = ["validate-goal-run.mjs", "validate-work-item-v2.mjs", "validate-execution-goal-binding.mjs"];
  const found = candidates.find((candidate) => required.every((name) => existsSync(join(candidate, "scripts/shirube", name))));
  if (!found) throw new Error("canonical Shirube V4 validators not found; set SHIRUBE_FRAMEWORK_ROOT");
  return resolve(found);
}

function portableLocator(value, repoRoot, frameworkRoot) {
  if (typeof value !== "string" || !isAbsolute(value)) return value;
  const repoRelative = relative(repoRoot, value);
  if (!repoRelative.startsWith("..")) return `repo:${repoRelative}`;
  const frameworkRelative = relative(frameworkRoot, value);
  if (!frameworkRelative.startsWith("..")) return `canonical-shirube:${frameworkRelative}`;
  return `locator-sha256:${sha256Raw(value)}`;
}

function portableValidatorReport(report, repoRoot, frameworkRoot) {
  return {
    ...report,
    file: portableLocator(report.file, repoRoot, frameworkRoot),
    previous_file: portableLocator(report.previous_file, repoRoot, frameworkRoot),
    goal_run_file: portableLocator(report.goal_run_file, repoRoot, frameworkRoot),
  };
}

function runValidator(root, name, args, repoRoot) {
  const script = join(root, "scripts/shirube", name);
  const result = spawnSync(process.execPath, [script, ...args, "--format", "json"], { encoding: "utf8" });
  const report = portableValidatorReport(JSON.parse(result.stdout || "{}"), repoRoot, root);
  return { script: `canonical-shirube:scripts/shirube/${name}`, script_sha256: sha256Raw(readFileSync(script)), exit_code: result.status, report };
}

function loadWorkItems(repoRoot) {
  const dir = absolute(repoRoot, WORK_ITEM_DIR);
  return readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => ({ path: join(dir, name), document: readJson(join(dir, name)) }));
}

export function buildStatus(goalRun, workItems) {
  const definitions = [...goalRun.acceptance_set].sort((a, b) => a.ordinal - b.ordinal || a.acceptance_id.localeCompare(b.acceptance_id));
  const stateById = new Map(goalRun.acceptance_states.map((state) => [state.acceptance_id, state]));
  const unmet = definitions.find((definition) => stateById.get(definition.acceptance_id)?.status !== "VERIFIED_PASS");
  const candidates = workItems.filter((item) => item.status === "READY" && item.unmet_condition_id === unmet?.acceptance_id)
    .sort((a, b) => a.acceptance_ordinal - b.acceptance_ordinal || a.blocker_ordinal - b.blocker_ordinal || a.work_item_id.localeCompare(b.work_item_id));
  const next = candidates[0] ?? null;
  const route = next ? ROUTE_BY_ACCEPTANCE_ID[next.unmet_condition_id] : null;
  if (next && !route) throw new Error(`missing deterministic route for ${next.unmet_condition_id}`);
  const acceptancePassed = goalRun.acceptance_states.filter((state) => state.status === "VERIFIED_PASS").length;
  const targetLiveExact = goalRun.target_states.filter((target) => target.live_exact_version === target.expected_version && target.live_evidence_ref).length;
  const targetRollbackExact = goalRun.target_states.filter((target) => target.rollback_exact_version === target.expected_version && target.rollback_evidence_ref).length;
  return {
    schema_version: "shirube-v4/goal-status/v1",
    root_goal_run_id: goalRun.root_goal_run_id,
    status: goalRun.status,
    generation: goalRun.generation,
    state_digest: goalRun.state_digest,
    acceptance: { passed: acceptancePassed, total: goalRun.acceptance_states.length, percent: Math.floor((acceptancePassed / goalRun.acceptance_states.length) * 100) },
    targets: { live_exact: targetLiveExact, rollback_exact: targetRollbackExact, total: goalRun.target_states.length },
    blockers: goalRun.blocker_set,
    next_work_item: next ? {
      work_item_id: next.work_item_id,
      required_operation: next.required_operation,
      required_evidence: next.required_evidence,
      control_handoff_ref: next.control_handoff_ref,
      dispatch_idempotency_key: next.dispatch_idempotency_key,
    } : null,
    can_continue: Boolean(next),
    next_action: next ? {
      blocking: route.blocking,
      actor_agent_id: route.actor_agent_id,
      active_function: route.active_function,
      action: route.action || `Execute ${next.work_item_id} within its exact control handoff and return all required evidence.`,
      deliver_via: route.deliver_via || "WorkItem terminal evidence and GoalRun generation update",
      exact_input_refs: [next.control_handoff_ref, GOAL_PATH, `${WORK_ITEM_DIR}/${next.work_item_id}.json`],
      scope: `Only operation ${next.required_operation}; forbidden operations remain denied by WorkItem v2.`,
      deliverable: next.required_evidence,
      completion_evidence: "Canonical WorkItem v2 terminal-evidence validation and GoalRun readback.",
    } : "none",
  };
}

function check(repoRoot, explicitFrameworkRoot, writeEvidence) {
  const root = frameworkRoot(repoRoot, explicitFrameworkRoot);
  const goalPath = absolute(repoRoot, GOAL_PATH);
  const bindingPath = absolute(repoRoot, BINDING_PATH);
  const goalDocument = readJson(goalPath);
  const previousPath = absolute(repoRoot, `${GOAL_HISTORY_DIR}/${GOAL_ID}.generation-${goalDocument.generation - 1}.json`);
  const goalArgs = ["--file", goalPath, ...(goalDocument.generation > 0 && existsSync(previousPath) ? ["--previous", previousPath] : [])];
  const goal = runValidator(root, "validate-goal-run.mjs", goalArgs, repoRoot);
  const workItems = loadWorkItems(repoRoot);
  const workItemReports = workItems.map(({ path, document }) => runValidator(
    root,
    "validate-work-item-v2.mjs",
    ["--file", path, ...(document.status === "VERIFIED_TERMINAL" ? [] : ["--goal-run", goalPath])],
    repoRoot,
  ));
  const binding = runValidator(root, "validate-execution-goal-binding.mjs", ["--file", bindingPath, "--goal-run", goalPath], repoRoot);
  const status = buildStatus(readJson(goalPath), workItems.map(({ document }) => document));
  const pass = goal.report.verdict === "PASS" && binding.report.verdict === "PASS" && workItemReports.every((entry) => entry.report.verdict === "PASS") && status.targets.total === 35 && status.next_work_item !== null;
  const report = {
    schema_version: "shirube-v4/goalrun-adoption-check/v1",
    verdict: pass ? "PASS" : "BLOCKED",
    canonical_framework: {
      contract_pr: CANONICAL_CONTRACT_PR,
      validator_set_digest: digestValue([goal.script_sha256, workItemReports[0]?.script_sha256, binding.script_sha256]),
    },
    goal_validator: goal,
    work_item_validators: workItemReports,
    execution_binding_validator: binding,
    status,
    frozen_target_set_sha256: EXPECTED_TARGET_SET_SHA256,
    production_effect_count: 0,
  };
  if (writeEvidence) writeJson(absolute(repoRoot, EVIDENCE_PATH), report);
  return report;
}

function main() {
  const { command, options } = parseOptions(process.argv.slice(2));
  const repoRoot = resolve(options.root || DEFAULT_REPO_ROOT);
  const sourceRoot = resolve(options["source-root"] || repoRoot);
  const observedAt = options["observed-at"] || new Date().toISOString();
  if (command === "init") {
    initialize(repoRoot, sourceRoot, observedAt);
    const report = check(repoRoot, options["framework-root"], true);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.verdict === "PASS" ? 0 : 1;
    return;
  }
  if (command === "advance-exact-merge") {
    advanceExactMerge(repoRoot, options["observed-at"] || EXACT_MERGE.merged_at);
    const report = check(repoRoot, options["framework-root"], true);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.verdict === "PASS" ? 0 : 1;
    return;
  }
  if (command === "check") {
    const report = check(repoRoot, options["framework-root"], options["write-evidence"] === true);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.verdict === "PASS" ? 0 : 1;
    return;
  }
  if (command === "status" || command === "next") {
    const goalRun = readJson(absolute(repoRoot, GOAL_PATH));
    const status = buildStatus(goalRun, loadWorkItems(repoRoot).map(({ document }) => document));
    process.stdout.write(`${JSON.stringify(command === "next" ? status.next_action : status, null, 2)}\n`);
    process.exitCode = status.can_continue || status.status === "VERIFIED_COMPLETE" ? 0 : 1;
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
