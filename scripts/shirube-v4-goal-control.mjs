#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, "..");
const GOAL_ID = "GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804";
const GOAL_PATH = ".shirube/goal-runs/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.json";
const GOAL_HISTORY_DIR = ".shirube/goal-runs/history";
const BINDING_PATH = ".shirube/execution-goal-bindings/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.kusabi.json";
const WORK_ITEM_DIR = ".shirube/work-items/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804";
const EVIDENCE_PATH = ".shirube/evidence/SHIRUBE-V4-GOALRUN-ADOPTION-20260804.json";
const R0_PATH = ".shirube/evidence/KUSABI-ALPHA-OBS05-R0-CANDIDATE-20260801.json";
const R0_V3_PATH = ".shirube/evidence/KUSABI-ALPHA-OBS05-R0-CANDIDATE-V3-20260803.json";
const RELEASE_PATH = ".shirube/evidence/KUSABI-ALPHA-OBS05-RUNTIME-RELEASE-V1-20260803.json";
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
const PRE_ROLLOUT_RECONCILIATION = {
  generation: 2,
  merge_commit: "8f9e4649e5bd40dd43a510bb3913cf690c428c80",
  merge_tree: "91a9bd882f53f92c9d2c9635ccb2a3f4dcf91ac9",
  merged_at: "2026-08-05T00:03:04Z",
  merge_evidence_ref: "https://github.com/watchout/agent-memory/issues/280#issuecomment-5185960713",
  audit_ref: "https://github.com/watchout/agent-memory/pull/283#issuecomment-5185937756",
  owner_decision_ref: "https://github.com/watchout/agent-memory/pull/283#issuecomment-5185949544",
  owner_control_ref: "https://github.com/watchout/agent-memory/pull/283#issuecomment-5185828057",
  release_file_sha256: "4051f677b70472cbdf5ad902ff8d885c8df4e6cb63a79a472531a34d30855525",
  release_payload_sha256: "671dbdd4c9decc0845c3b46a985c48561106fb58c828113abbf185f751801057",
  release_descriptor_sha256: "4d1535eafb362398d2baf30c306057b37341013baa5255939f4ad97f69af7ae7",
  dist_tree_sha256: "6c8b380f14814d2456db6b1afedafa8eea99223974919176d81d602e9cea508a",
  r0_v3_file_sha256: "ca795ae1028af8c6a1028103415ce4151c56ffec0cd9ab1ac714fc9b7d61e5ed",
  r0_v3_payload_sha256: "12d9a0b33978dcd49d22eb723baff3f1ee00980c2849dc0827fa31c824ddd8a4",
  capture_a_sha256: "7185ddc04cd9124a68593b227c5b8722f2fb5410fcd51d4b28759864badc50a4",
  capture_b_sha256: "5e6d81a30ddf564e54489b3593dd8fc798ffedcc327f6977785e4f78ec5cb975",
};
const RELEASE_R0_SUCCESSOR = {
  generation: 3,
  release_handoff_ref: "https://github.com/watchout/agent-memory/issues/280#issuecomment-5186287466",
  release_handoff_body_sha256: "1a40fb0bd6b4f6ede3aae8c2d60f55640117f903d8a5873d0695bc8857318099",
  amendment_ref: "https://github.com/watchout/agent-memory/issues/280#issuecomment-5186307680",
  amendment_body_sha256: "9d79ba783c1ad3bf9db3d352b2f1a7850e76b3dfe3f0e7383a9daa78b80c7594",
  predecessor_head: "00504ca75f731e253e006db7a4a7390bb93afeb9",
  predecessor_tree: "da07136f9cb32b45bc3c8be285d52f004ee50733",
  failed_release_descriptor_sha256: "4d1535eafb362398d2baf30c306057b37341013baa5255939f4ad97f69af7ae7",
  release_file_sha256: "99bd980c7112b5090b4756c08d44c2b7e106af1a4744befb80700cb1a77b9f81",
  release_payload_sha256: "034f0caad747bac3137e46e5d1b0083c7fdefffa80dd67ad2197af98964d4456",
  release_descriptor_sha256: "f58fbfe30ac29867fecdb338b294efb02eeb5a4f1688d0bcbf3a48f5a6b13626",
  runtime_tree_sha256: "95456b97362f06c38a6202e838b0d5eb07c2e925283c279257195b6d3a240436",
  dependency_inventory_sha256: "d47e6ce7f5808dec56585e07e852e4596b8f8ebee59221cbecaadbc498740ffa",
  import_smoke_results_sha256: "b952d57c5272b7e0ed4659045f6094ec14869b52b74793c82e1bb4617b6535d8",
  r0_v3_file_sha256: "97f30a94ee4caa2ed215605ca6b3021ee5d4fe98e8b5e20d5b0baa9e54953a89",
  r0_v3_payload_sha256: "3216ee051ea2d9ba89cab6717acdf2feba8799ae9f85d6bf9be5d46f51824b12",
  capture_a_sha256: "620370c8df347335fd632f0e498409ce90876cfcb2f0b0775ad1e2293bb2c76b",
  capture_b_sha256: "ce6107b65b938c9cdb86db4d69177e4392b26b782e223729df85075abb96ca41",
};
const CAS_B01_AUDIT_RECONCILIATION = {
  generation: 5,
  predecessor_head: "43724e69a3b40a2088cb4b0149c9ba618f1d4e65",
  predecessor_tree: "10a3c1c5633743914082abddaec0cae20ee51f04",
  predecessor_goal_file_sha256: "eed53588c7efaf328c02d03fd1c79429ebae55b8bd4f66515f2cd1a5eee89501",
  release_descriptor_sha256: "ceb74adfd032aabfece0feb2cb50978551a68686c69bdbfd69649b367d07e9d4",
  evidence_path: ".shirube/evidence/KUSABI-PR286-B03-AUDIT-HARD-GATE-RECONCILIATION-20260810.json",
  handoff_path: ".shirube/control-handoffs/CH-KUSABI-PR286-GOALRUN-B03-B04-RECONCILIATION-20260810-001.yaml",
  audit_ref: "https://github.com/watchout/agent-memory/issues/285#issuecomment-5230368349",
  audit_body_sha256: "9016e826418c9c22234b821065c4cc1f6821a6c30eb1fdc37b2ddf5a31c100f9",
  owner_exact_head_ref: "https://github.com/watchout/agent-memory/pull/286#issuecomment-5230551020",
  owner_exact_head_body_sha256: "83ca2be538bb9f6e3039f6aca20d6f3a491ff8bdc25d07cc855b40f6f7af82af",
  hard_gate_run_ref: "https://github.com/watchout/agent-memory/actions/runs/31303252529",
  hard_gate_report_sha256: "5f488ded2bc28e4215e003f4d7f76eedef722ef9cf8ec897cdf37d1a1a15cb90",
  hard_gate_receipt_ref: "https://github.com/watchout/agent-memory/issues/285#issuecomment-5230557950",
  hard_gate_receipt_body_sha256: "37f6fa0b2d14bc82fd569748b3a5d166dca09acfbdbb88a0c839c01d806cfbd7",
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

const ROUTE_BY_EFFECTIVE_BLOCKER_ID = {
  "B-03-KUSABI-CAS-B01-AUTHENTICATED-PUBLICATION-GATE": {
    actor_agent_id: "codex-audit",
    active_function: "evidence_audit_gate",
    blocking: true,
    action: "Independently audit the exact PR 286 successor head/tree and the authenticated final-CAS publication verifier, including the one positive and seven protected-effect-zero negative receipt fixtures; return PASS with blocker_count 0 or exact findings.",
    deliver_via: "Immutable Issue 285 audit comment and official AUN reply to kusabi.",
    scope: "Read-only exact-head audit only; no implementation, final CAS publication, rollout, Ready transition, approval, or merge.",
    deliverable: [
      "independent_exact_head_audit",
      "authenticated_gate_positive_fixture",
      "seven_fail_closed_negative_fixtures",
      "final_CAS_absence_readback",
      "protected_effect_count_zero",
    ],
    completion_evidence: "Immutable audit URL/body digest, exact head/tree and CAS/R0 subject, PASS or exact blockers, and official AUN receipt.",
  },
  "B-04-PR286-EXACT-CORRECTION-MERGE": {
    actor_agent_id: "codex-audit",
    active_function: "evidence_audit_gate",
    blocking: true,
    action: "Independently audit the new exact PR 286 GoalRun-reconciliation head/tree, including the generation-4 B-03 to generation-5 B-04 fail-closed transition; return PASS with blocker_count 0 or exact findings.",
    deliver_via: "Immutable Issue 285 audit comment and official AUN reply to kusabi.",
    scope: "Read-only exact-head audit only; no implementation, final CAS publication, rollout, Ready transition, approval, or merge.",
    deliverable: [
      "independent_exact_head_audit",
      "generation_4_to_5_transition_readback",
      "B03_removed_B04_only",
      "A02_through_A11_unmet",
      "final_CAS_absence_readback",
      "protected_effect_count_zero",
    ],
    completion_evidence: "Immutable audit URL/body digest, exact head/tree and cumulative path lineage, blocker_count 0, final CAS absent, and official AUN receipt.",
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

function requireExactOption(options, name, expected) {
  const observed = options[name];
  if (observed !== expected) {
    throw new Error(`${name} must equal the authenticated exact value ${expected}; observed ${observed ?? "missing"}`);
  }
}

function assertCasB01AuditReconciliationEvidence(repoRoot, options) {
  requireExactOption(options, "subject-head", CAS_B01_AUDIT_RECONCILIATION.predecessor_head);
  requireExactOption(options, "subject-tree", CAS_B01_AUDIT_RECONCILIATION.predecessor_tree);
  requireExactOption(options, "audit-ref", CAS_B01_AUDIT_RECONCILIATION.audit_ref);
  requireExactOption(options, "audit-body-sha256", CAS_B01_AUDIT_RECONCILIATION.audit_body_sha256);
  requireExactOption(options, "hard-gate-run-ref", CAS_B01_AUDIT_RECONCILIATION.hard_gate_run_ref);
  requireExactOption(options, "hard-gate-report-sha256", CAS_B01_AUDIT_RECONCILIATION.hard_gate_report_sha256);
  requireExactOption(options, "hard-gate-receipt-ref", CAS_B01_AUDIT_RECONCILIATION.hard_gate_receipt_ref);
  requireExactOption(options, "hard-gate-receipt-body-sha256", CAS_B01_AUDIT_RECONCILIATION.hard_gate_receipt_body_sha256);

  const evidencePath = absolute(repoRoot, CAS_B01_AUDIT_RECONCILIATION.evidence_path);
  const handoffPath = absolute(repoRoot, CAS_B01_AUDIT_RECONCILIATION.handoff_path);
  if (!existsSync(evidencePath) || !existsSync(handoffPath)) {
    throw new Error("B-03 reconciliation evidence and bounded control handoff must both exist");
  }
  const evidence = readJson(evidencePath);
  const subject = evidence?.exact_subject;
  const audit = evidence?.independent_audit;
  const owner = evidence?.owner_exact_head_decision;
  const hardGate = evidence?.authenticated_hard_gate;
  const protectedEffects = Object.values(evidence?.protected_effects ?? {});
  const pass =
    evidence?.schema_version === "kusabi-pr286-b03-audit-reconciliation/v1" &&
    evidence?.lifecycle_state === "AUDIT_AND_AUTHENTICATED_HARD_GATE_VERIFIED_AWAITING_PR286_MERGE" &&
    subject?.repository === "watchout/agent-memory" && subject?.pull_request === 286 &&
    subject?.head_sha === CAS_B01_AUDIT_RECONCILIATION.predecessor_head &&
    subject?.tree_sha === CAS_B01_AUDIT_RECONCILIATION.predecessor_tree &&
    subject?.release_descriptor_sha256 === CAS_B01_AUDIT_RECONCILIATION.release_descriptor_sha256 &&
    subject?.target_set_sha256 === EXPECTED_TARGET_SET_SHA256 &&
    audit?.ref === CAS_B01_AUDIT_RECONCILIATION.audit_ref &&
    audit?.raw_body_sha256 === CAS_B01_AUDIT_RECONCILIATION.audit_body_sha256 &&
    audit?.reviewer_agent_id === "codex-audit" && audit?.active_function === "evidence_audit_gate" &&
    audit?.verdict === "PASS_EXACT_SUBJECT" && audit?.blocker_count === 0 && audit?.protected_effect_count === 0 &&
    owner?.ref === CAS_B01_AUDIT_RECONCILIATION.owner_exact_head_ref &&
    owner?.raw_body_sha256 === CAS_B01_AUDIT_RECONCILIATION.owner_exact_head_body_sha256 &&
    owner?.actor === "watchout" && owner?.verdict === "APPROVED_EXACT_HEAD" &&
    hardGate?.run_ref === CAS_B01_AUDIT_RECONCILIATION.hard_gate_run_ref &&
    hardGate?.report_sha256 === CAS_B01_AUDIT_RECONCILIATION.hard_gate_report_sha256 &&
    hardGate?.receipt_ref === CAS_B01_AUDIT_RECONCILIATION.hard_gate_receipt_ref &&
    hardGate?.receipt_raw_body_sha256 === CAS_B01_AUDIT_RECONCILIATION.hard_gate_receipt_body_sha256 &&
    hardGate?.workflow_name === "Shirube Rapid/Lite Gate" && hardGate?.workflow_event === "issue_comment" &&
    hardGate?.job_name === "rapid-lite-gate" && hardGate?.resolved_pr_head_sha === CAS_B01_AUDIT_RECONCILIATION.predecessor_head &&
    hardGate?.verdict === "SUCCESS" && hardGate?.blocker_count === 0 && hardGate?.protected_effect_count === 0 &&
    evidence?.final_CAS?.status === "ABSENT" &&
    evidence?.gate_result?.verdict === "PASS_B03_REMOVAL_PREDICATE" &&
    evidence?.gate_result?.B04_required === true && evidence?.gate_result?.final_CAS_publication_authorized === false &&
    protectedEffects.length >= 6 && protectedEffects.every((value) => value === 0);
  if (!pass) throw new Error("B-03 audit/hard-gate reconciliation evidence is not exact PASS with zero protected effects");
  return {
    evidence,
    evidence_sha256: sha256Raw(readFileSync(evidencePath)),
    handoff_sha256: sha256Raw(readFileSync(handoffPath)),
  };
}

function reconcileCasB01Audit(repoRoot, observedAt, options) {
  const verified = assertCasB01AuditReconciliationEvidence(repoRoot, options);
  const goalPath = absolute(repoRoot, GOAL_PATH);
  const previous = readJson(goalPath);
  const passed = previous.acceptance_states.filter((state) => state.status === "VERIFIED_PASS").map((state) => state.acceptance_id);
  const eventId = `EVENT-KUSABI-PR286-B03-AUDIT-RECONCILED-${CAS_B01_AUDIT_RECONCILIATION.predecessor_head}`;
  const exactReplay =
    previous.generation === CAS_B01_AUDIT_RECONCILIATION.generation &&
    previous.status === "BLOCKED" && previous.active_work_item_id === "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE" &&
    previous.blocker_set.length === 1 && previous.blocker_set[0]?.blocker_id === "B-04-PR286-EXACT-CORRECTION-MERGE" &&
    previous.checkpoint?.last_event_id === eventId && canonicalJson(passed) === canonicalJson(["A-01-PR281-EXACT-MERGE"]);
  const exactPredecessor =
    previous.generation === 4 && previous.status === "BLOCKED" &&
    previous.active_work_item_id === "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE" &&
    previous.blocker_set.length === 1 && previous.blocker_set[0]?.blocker_id === "B-03-KUSABI-CAS-B01-AUTHENTICATED-PUBLICATION-GATE" &&
    canonicalJson(passed) === canonicalJson(["A-01-PR281-EXACT-MERGE"]);
  if (!exactReplay && !exactPredecessor) {
    throw new Error("B-03 reconciliation requires the exact blocked generation-4 predecessor or exact generation-5 B-04 replay");
  }
  const previousPath = absolute(repoRoot, `${GOAL_HISTORY_DIR}/${GOAL_ID}.generation-4.json`);
  let predecessor = previous;
  if (exactReplay) {
    if (!existsSync(previousPath)) throw new Error("generation-5 replay requires immutable generation-4 history");
    predecessor = readJson(previousPath);
    const predecessorPassed = predecessor.acceptance_states
      .filter((state) => state.status === "VERIFIED_PASS")
      .map((state) => state.acceptance_id);
    const historyIsExactPredecessor =
      predecessor.generation === 4 && predecessor.status === "BLOCKED" &&
      predecessor.active_work_item_id === "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE" &&
      predecessor.blocker_set.length === 1 &&
      predecessor.blocker_set[0]?.blocker_id === "B-03-KUSABI-CAS-B01-AUTHENTICATED-PUBLICATION-GATE" &&
      canonicalJson(predecessorPassed) === canonicalJson(["A-01-PR281-EXACT-MERGE"]);
    if (!historyIsExactPredecessor) {
      throw new Error("generation-5 replay requires the exact immutable generation-4 B-03 predecessor");
    }
  } else {
    if (existsSync(previousPath) && canonicalJson(readJson(previousPath)) !== canonicalJson(previous)) {
      throw new Error("existing generation-4 history does not equal the exact predecessor");
    }
    if (!existsSync(previousPath)) writeJson(previousPath, previous);
  }
  if (sha256Raw(readFileSync(previousPath)) !== CAS_B01_AUDIT_RECONCILIATION.predecessor_goal_file_sha256) {
    throw new Error("immutable generation-4 history raw SHA-256 mismatch");
  }
  const idempotencyKey = digestValue({
    event_id: eventId,
    subject_head: CAS_B01_AUDIT_RECONCILIATION.predecessor_head,
    subject_tree: CAS_B01_AUDIT_RECONCILIATION.predecessor_tree,
    audit_ref: CAS_B01_AUDIT_RECONCILIATION.audit_ref,
    audit_body_sha256: CAS_B01_AUDIT_RECONCILIATION.audit_body_sha256,
    hard_gate_run_ref: CAS_B01_AUDIT_RECONCILIATION.hard_gate_run_ref,
    hard_gate_report_sha256: CAS_B01_AUDIT_RECONCILIATION.hard_gate_report_sha256,
    evidence_sha256: verified.evidence_sha256,
    handoff_sha256: verified.handoff_sha256,
  });
  const checkpoint = {
    event_sequence: predecessor.checkpoint.event_sequence + 1,
    last_event_id: eventId,
    last_idempotency_key: idempotencyKey,
  };
  const evidenceRef = `file:${CAS_B01_AUDIT_RECONCILIATION.evidence_path}#sha256:${verified.evidence_sha256}`;
  const goalRun = structuredClone(predecessor);
  goalRun.generation = CAS_B01_AUDIT_RECONCILIATION.generation;
  goalRun.status = "BLOCKED";
  goalRun.active_work_item_id = "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE";
  goalRun.blocker_set = [{
    blocker_id: "B-04-PR286-EXACT-CORRECTION-MERGE",
    ordinal: 2,
    evidence_refs: [
      evidenceRef,
      CAS_B01_AUDIT_RECONCILIATION.audit_ref,
      CAS_B01_AUDIT_RECONCILIATION.hard_gate_run_ref,
      "https://github.com/watchout/agent-memory/pull/286",
    ],
    removal_predicate: "PR #286 independently audited exact head/tree has authenticated Owner exact-head approval, all required checks SUCCESS, normal merge without bypass, merge result contains the approved head as parent, final tree/provenance readback passes, and merge commit is an ancestor of main.",
  }];
  goalRun.checkpoint = checkpoint;
  goalRun.state_digest = computeGoalRunStateDigest(goalRun);

  const workItems = loadWorkItems(repoRoot).map(({ path, document }) => {
    const item = structuredClone(document);
    item.generation = goalRun.generation;
    item.checkpoint = { ...checkpoint };
    if (item.unmet_condition_id === "A-02-IMMUTABLE-RUNTIME-RELEASE") {
      item.control_handoff_ref = `file:${CAS_B01_AUDIT_RECONCILIATION.handoff_path}`;
      item.handoff_digest = `sha256:${verified.handoff_sha256}`;
      item.removes_blocker_ids = [];
      item.blocker_ordinal = 2;
      item.status = "BLOCKED";
      item.terminal_evidence = [];
    }
    item.dispatch_idempotency_key = computeDispatchIdempotencyKey(item, goalRun.generation);
    item.state_digest = computeWorkItemStateDigest(item);
    writeJson(path, item);
    return item;
  });
  writeJson(goalPath, goalRun);
  const binding = buildBinding(goalRun, observedAt);
  writeJson(absolute(repoRoot, BINDING_PATH), binding);
  return { goalRun, workItems, binding, previousPath, replayed: exactReplay };
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

function assertPreRolloutEvidence(repoRoot) {
  const releaseBytes = readFileSync(absolute(repoRoot, RELEASE_PATH));
  const r0Bytes = readFileSync(absolute(repoRoot, R0_V3_PATH));
  if (sha256Raw(releaseBytes) !== PRE_ROLLOUT_RECONCILIATION.release_file_sha256) {
    throw new Error("immutable runtime release file digest mismatch");
  }
  if (sha256Raw(r0Bytes) !== PRE_ROLLOUT_RECONCILIATION.r0_v3_file_sha256) {
    throw new Error("R0 v3 evidence file digest mismatch");
  }

  const release = JSON.parse(releaseBytes);
  const r0 = JSON.parse(r0Bytes);
  const entrypoints = Object.values(release?.release?.required_entrypoint_readback ?? {});
  const protectedEffects = Object.values(r0?.protected_effects ?? {});
  const releasePass =
    release?.schema_version === "kusabi-content-addressed-runtime-release-evidence/v1" &&
    release?.build?.source_tree_sha256 === EXPECTED_TREE &&
    release?.build?.source_status_before_install === "CLEAN" &&
    release?.release?.release_descriptor_sha256 === PRE_ROLLOUT_RECONCILIATION.release_descriptor_sha256 &&
    release?.release?.dist_tree_sha256 === PRE_ROLLOUT_RECONCILIATION.dist_tree_sha256 &&
    release?.release?.publication === "PASS_ATOMIC_RENAME_FROM_SIBLING_STAGING" &&
    release?.release?.final_tree_exact === "PASS_224_OF_224" &&
    entrypoints.length === 5 && entrypoints.every((entry) => entry?.verdict === "PASS" && entry?.actual_sha256 === entry?.expected_sha256) &&
    release?.gate_result?.verdict === "PASS" &&
    release?.evidence_payload_sha256 === PRE_ROLLOUT_RECONCILIATION.release_payload_sha256;
  if (!releasePass) throw new Error("immutable runtime release predicates are not all PASS");
  const importSmokes = inspectReleaseRuntime(release);
  if (!importSmokes.every((smoke) => smoke.pass)) {
    throw new Error("immutable runtime release is not self-contained and import-executable");
  }

  const r0Pass =
    r0?.schema_version === "kusabi-fleet-r0-candidate-pack/v3" &&
    r0?.exact_subject?.approved_tree === EXPECTED_TREE &&
    r0?.exact_subject?.merged_tree_sha === EXPECTED_TREE &&
    r0?.exact_subject?.release_descriptor_sha256 === PRE_ROLLOUT_RECONCILIATION.release_descriptor_sha256 &&
    r0?.capture_a?.internal_digest_sha256 === PRE_ROLLOUT_RECONCILIATION.capture_a_sha256 &&
    r0?.capture_b?.internal_digest_sha256 === PRE_ROLLOUT_RECONCILIATION.capture_b_sha256 &&
    r0?.heartbeat_separation?.verdict === "PASS_PARTITIONED_33_OF_33" &&
    r0?.heartbeat_separation?.primary_binding_count === 33 &&
    r0?.heartbeat_separation?.emitter_count === 29 &&
    r0?.heartbeat_separation?.offline_non_emitter_count === 4 &&
    r0?.heartbeat_separation?.ambiguous_count === 0 &&
    r0?.equality_matrix?.verdict === "PASS" &&
    r0?.equality_matrix?.pass_count === r0?.equality_matrix?.total_count &&
    r0?.equality_matrix?.total_count === 13 &&
    r0?.topology?.target_count === 35 &&
    r0?.topology?.sorted_target_keys_lf_sha256 === EXPECTED_TARGET_SET_SHA256 &&
    r0?.gate_result?.verdict === "PASS_R0_V3_HEARTBEAT_REPRODUCTION" &&
    protectedEffects.length === 6 && protectedEffects.every((value) => value === 0) &&
    r0?.evidence_payload_sha256 === PRE_ROLLOUT_RECONCILIATION.r0_v3_payload_sha256;
  if (!r0Pass) throw new Error("R0 v3 reproduction predicates are not all PASS");
}

function assertReleaseR0SuccessorEvidence(repoRoot) {
  const releaseBytes = readFileSync(absolute(repoRoot, RELEASE_PATH));
  const r0Bytes = readFileSync(absolute(repoRoot, R0_V3_PATH));
  if (sha256Raw(releaseBytes) !== RELEASE_R0_SUCCESSOR.release_file_sha256) {
    throw new Error("successor immutable runtime release file digest mismatch");
  }
  if (sha256Raw(r0Bytes) !== RELEASE_R0_SUCCESSOR.r0_v3_file_sha256) {
    throw new Error("successor R0 v3 evidence file digest mismatch");
  }

  const release = JSON.parse(releaseBytes);
  const r0 = JSON.parse(r0Bytes);
  const entrypoints = Object.values(release?.release?.required_entrypoint_readback ?? {});
  const dependencies = release?.release?.production_dependency_inventory;
  const stageImports = release?.release?.import_smoke_before_publish;
  const finalImports = release?.release?.import_smoke_after_publish;
  const releaseProtectedEffects = Object.values(release?.protected_effects ?? {});
  const importPhasePass = (phase) =>
    phase?.pass_count === 5 && phase?.total_count === 5 &&
    phase?.sha256 === RELEASE_R0_SUCCESSOR.import_smoke_results_sha256 &&
    phase?.results?.length === 5 && phase.results.every((result) =>
      result.status === 0 && result.timed_out === false && result.isolated_path_effect_count === 0);
  const releasePass =
    release?.schema_version === "kusabi-content-addressed-runtime-release-evidence/v1" &&
    release?.control_source?.ref === RELEASE_R0_SUCCESSOR.amendment_ref &&
    release?.control_source?.body_sha256 === RELEASE_R0_SUCCESSOR.amendment_body_sha256 &&
    release?.control_source?.release_handoff_ref === RELEASE_R0_SUCCESSOR.release_handoff_ref &&
    release?.build?.source_tree_sha256 === EXPECTED_TREE &&
    release?.build?.source_status_before_install === "CLEAN" &&
    release?.build?.tracked_source_diff_before_and_after === "CLEAN" &&
    release?.release?.release_descriptor_sha256 === RELEASE_R0_SUCCESSOR.release_descriptor_sha256 &&
    release?.release?.runtime_tree_sha256 === RELEASE_R0_SUCCESSOR.runtime_tree_sha256 &&
    release?.release?.production_dependency_inventory_sha256 === RELEASE_R0_SUCCESSOR.dependency_inventory_sha256 &&
    release?.release?.import_smoke_results_sha256 === RELEASE_R0_SUCCESSOR.import_smoke_results_sha256 &&
    release?.release?.complete_runtime_path_mode_sha256_ledger?.runtime_tree_sha256 === RELEASE_R0_SUCCESSOR.runtime_tree_sha256 &&
    release?.release?.complete_runtime_path_mode_sha256_ledger?.files?.length === 4073 &&
    dependencies?.canonical_sha256 === RELEASE_R0_SUCCESSOR.dependency_inventory_sha256 &&
    dependencies?.installed_count === 107 && dependencies?.extraneous_missing_invalid_count === 0 &&
    importPhasePass(stageImports) && importPhasePass(finalImports) &&
    release?.release?.publication?.initial === "ATOMIC_RENAME_NEW_CAS" &&
    release?.release?.publication?.final_conformance_readback === "IDEMPOTENT_SUCCESS_NO_WRITE" &&
    entrypoints.length === 5 && entrypoints.every((entry) => entry?.verdict === "PASS" && entry?.actual_sha256 === entry?.expected_sha256) &&
    releaseProtectedEffects.length >= 8 && releaseProtectedEffects.every((value) => value === 0) &&
    release?.gate_result?.verdict === "PASS_SELF_CONTAINED_RELEASE_5_OF_5" &&
    release?.gate_result?.blocker_count === 0 && release?.gate_result?.protected_effect_count === 0 &&
    release?.evidence_payload_sha256 === RELEASE_R0_SUCCESSOR.release_payload_sha256;
  if (!releasePass) throw new Error("successor immutable runtime release predicates are not all PASS");
  const importSmokes = inspectReleaseRuntime(release);
  if (!importSmokes.every((smoke) => smoke.pass)) {
    throw new Error("successor immutable runtime release is not self-contained and import-executable");
  }

  const r0ProtectedEffects = Object.values(r0?.protected_effects ?? {});
  const heartbeat = r0?.heartbeat_separation;
  const r0Pass =
    r0?.schema_version === "kusabi-fleet-r0-candidate-pack/v3" &&
    r0?.control_source?.ref === RELEASE_R0_SUCCESSOR.amendment_ref &&
    r0?.control_source?.body_sha256 === RELEASE_R0_SUCCESSOR.amendment_body_sha256 &&
    r0?.exact_subject?.approved_tree === EXPECTED_TREE &&
    r0?.exact_subject?.merged_tree_sha === EXPECTED_TREE &&
    r0?.exact_subject?.release_descriptor_sha256 === RELEASE_R0_SUCCESSOR.release_descriptor_sha256 &&
    r0?.exact_subject?.runtime_tree_sha256 === RELEASE_R0_SUCCESSOR.runtime_tree_sha256 &&
    r0?.exact_subject?.production_dependency_inventory_sha256 === RELEASE_R0_SUCCESSOR.dependency_inventory_sha256 &&
    r0?.exact_subject?.import_smoke_results_sha256 === RELEASE_R0_SUCCESSOR.import_smoke_results_sha256 &&
    r0?.capture_a?.internal_digest_sha256 === RELEASE_R0_SUCCESSOR.capture_a_sha256 &&
    r0?.capture_b?.internal_digest_sha256 === RELEASE_R0_SUCCESSOR.capture_b_sha256 &&
    heartbeat?.verdict === "PASS_PARTITIONED_33_OF_33" &&
    heartbeat?.primary_binding_count === 33 &&
    heartbeat?.emitter_count + heartbeat?.offline_non_emitter_count === 33 &&
    heartbeat?.ambiguous_count === 0 &&
    r0?.equality_matrix?.verdict === "PASS" &&
    r0?.equality_matrix?.pass_count === r0?.equality_matrix?.total_count &&
    r0?.equality_matrix?.total_count === 13 &&
    r0?.topology?.target_count === 35 && r0?.topology?.primary_binding_count === 33 && r0?.topology?.approved_secondary_binding_count === 2 &&
    r0?.topology?.stage_counts?.r1 === 3 && r0?.topology?.stage_counts?.r2 === 11 && r0?.topology?.stage_counts?.r3 === 21 &&
    r0?.topology?.sorted_target_keys_lf_sha256 === EXPECTED_TARGET_SET_SHA256 &&
    r0?.gate_result?.verdict === "PASS_R0_V3_HEARTBEAT_REPRODUCTION" && r0?.gate_result?.R1_authorized === false &&
    r0ProtectedEffects.length >= 7 && r0ProtectedEffects.every((value) => value === 0) &&
    r0?.evidence_payload_sha256 === RELEASE_R0_SUCCESSOR.r0_v3_payload_sha256;
  if (!r0Pass) throw new Error("successor R0 v3 reproduction predicates are not all PASS");
  return { release, r0, importSmokes };
}

function inspectReleaseRuntime(release) {
  const runtimeRoot = release?.release?.runtime_root_realpath;
  const entrypoints = Object.keys(release?.release?.required_entrypoint_readback ?? {}).sort();
  if (typeof runtimeRoot !== "string" || entrypoints.length !== 5) {
    return [{ entrypoint: "release-runtime-root", pass: false, exit_code: null, error_code: "RELEASE_RUNTIME_METADATA_INVALID" }];
  }
  return entrypoints.map((entrypoint) => {
    const locator = pathToFileURL(join(runtimeRoot, entrypoint)).href;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", "await import(process.argv[1])", locator],
      { encoding: "utf8", timeout: 10_000 },
    );
    const diagnostic = `${result.stderr ?? ""}\n${result.error?.message ?? ""}`;
    const errorCode = diagnostic.match(/ERR_[A-Z_]+/)?.[0] ?? (result.error ? "SPAWN_ERROR" : null);
    return { entrypoint, pass: result.status === 0, exit_code: result.status, error_code: errorCode };
  });
}

function recordPreRolloutBlocker(repoRoot, observedAt) {
  const goalPath = absolute(repoRoot, GOAL_PATH);
  const previous = readJson(goalPath);
  const passed = previous.acceptance_states.filter((state) => state.status === "VERIFIED_PASS").map((state) => state.acceptance_id);
  if (
    previous.generation !== 1 ||
    previous.status !== "ACTIVE" ||
    previous.active_work_item_id !== "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE" ||
    canonicalJson(passed) !== canonicalJson(["A-01-PR281-EXACT-MERGE"])
  ) {
    throw new Error("release blocker recording requires the exact generation-1 post-merge GoalRun");
  }
  const release = readJson(absolute(repoRoot, RELEASE_PATH));
  const importSmokes = inspectReleaseRuntime(release);
  if (importSmokes.every((smoke) => smoke.pass)) {
    throw new Error("release import smoke is already PASS; no blocker may be recorded");
  }
  const previousPath = absolute(repoRoot, `${GOAL_HISTORY_DIR}/${GOAL_ID}.generation-1.json`);
  writeJson(previousPath, previous);
  const eventId = `EVENT-KUSABI-IMMUTABLE-RUNTIME-NOT-SELF-CONTAINED-${PRE_ROLLOUT_RECONCILIATION.release_descriptor_sha256}`;
  const idempotencyKey = digestValue({
    event_id: eventId,
    release_file_sha256: PRE_ROLLOUT_RECONCILIATION.release_file_sha256,
    import_smokes: importSmokes,
  });
  const checkpoint = {
    event_sequence: previous.checkpoint.event_sequence + 1,
    last_event_id: eventId,
    last_idempotency_key: idempotencyKey,
  };
  const blockerId = "B-02-IMMUTABLE-RUNTIME-NOT-SELF-CONTAINED";
  const goalRun = structuredClone(previous);
  goalRun.status = "BLOCKED";
  goalRun.generation = 2;
  goalRun.active_work_item_id = "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE";
  goalRun.blocker_set = [{
    blocker_id: blockerId,
    ordinal: 2,
    evidence_refs: [
      `file:${RELEASE_PATH}#sha256:${PRE_ROLLOUT_RECONCILIATION.release_file_sha256}`,
      "command:node-esm-import-smoke#ERR_MODULE_NOT_FOUND",
    ],
    removal_predicate: "Publish a new content-addressed runtime release whose five required entrypoints pass side-effect-free ESM import smoke with all production dependencies resolved; regenerate exact R0 v3, independent audit, and owner GO before R1.",
  }];
  goalRun.checkpoint = checkpoint;
  goalRun.state_digest = computeGoalRunStateDigest(goalRun);

  const workItems = loadWorkItems(repoRoot).map(({ path, document }) => {
    const item = structuredClone(document);
    item.generation = goalRun.generation;
    item.checkpoint = { ...checkpoint };
    if (item.unmet_condition_id === "A-02-IMMUTABLE-RUNTIME-RELEASE") item.status = "BLOCKED";
    item.dispatch_idempotency_key = computeDispatchIdempotencyKey(item, goalRun.generation);
    item.state_digest = computeWorkItemStateDigest(item);
    writeJson(path, item);
    return item;
  });
  writeJson(goalPath, goalRun);
  const binding = buildBinding(goalRun, observedAt);
  writeJson(absolute(repoRoot, BINDING_PATH), binding);
  return { goalRun, workItems, binding, previousPath, importSmokes };
}

function successorTerminalEvidence(item) {
  const releaseRef = `file:${RELEASE_PATH}#sha256:${RELEASE_R0_SUCCESSOR.release_file_sha256}`;
  const r0Ref = `file:${R0_V3_PATH}#sha256:${RELEASE_R0_SUCCESSOR.r0_v3_file_sha256}`;
  const evidenceByAcceptance = {
    "A-02-IMMUTABLE-RUNTIME-RELEASE": {
      provenance_ref: RELEASE_R0_SUCCESSOR.release_handoff_ref,
      refs: {
        clean_build_readback: `${releaseRef}/build`,
        content_addressed_release_readback: `release:sha256:${RELEASE_R0_SUCCESSOR.release_descriptor_sha256}`,
        entrypoint_digest_readback: `${releaseRef}/release/import_smoke_before_publish#sha256:${RELEASE_R0_SUCCESSOR.import_smoke_results_sha256}`,
      },
    },
    "A-03-R0-V3-HEARTBEAT-REPRODUCTION": {
      provenance_ref: RELEASE_R0_SUCCESSOR.amendment_ref,
      refs: {
        r0_v3_capture_a: `${r0Ref}/capture_a#sha256:${RELEASE_R0_SUCCESSOR.capture_a_sha256}`,
        ordinary_heartbeat_separation: `${r0Ref}/heartbeat_separation`,
        r0_v3_capture_b: `${r0Ref}/capture_b#sha256:${RELEASE_R0_SUCCESSOR.capture_b_sha256}`,
        r0_v3_equality_matrix: `${r0Ref}/equality_matrix`,
      },
    },
  };
  const definition = evidenceByAcceptance[item.unmet_condition_id];
  if (!definition) return null;
  return item.required_evidence.map((evidenceClass) => ({
    evidence_ref: definition.refs[evidenceClass],
    evidence_class: evidenceClass,
    subject_work_item_id: item.work_item_id,
    actor_id: "kusabi",
    active_function: "implementation_executor",
    provenance_ref: definition.provenance_ref,
    acceptance_id: item.unmet_condition_id,
    blocker_id: item.unmet_condition_id === "A-02-IMMUTABLE-RUNTIME-RELEASE" ? "B-02-IMMUTABLE-RUNTIME-NOT-SELF-CONTAINED" : null,
    exact_version: EXPECTED_VERSION,
    predicate_verified: true,
  }));
}

function advanceReleaseR0Successor(repoRoot, observedAt) {
  const goalPath = absolute(repoRoot, GOAL_PATH);
  const previous = readJson(goalPath);
  const passed = previous.acceptance_states.filter((state) => state.status === "VERIFIED_PASS").map((state) => state.acceptance_id);
  const eventId = `EVENT-KUSABI-SELF-CONTAINED-RELEASE-R0-SUCCESSOR-${RELEASE_R0_SUCCESSOR.release_descriptor_sha256}`;
  const expectedPassed = [
    "A-01-PR281-EXACT-MERGE",
    "A-02-IMMUTABLE-RUNTIME-RELEASE",
    "A-03-R0-V3-HEARTBEAT-REPRODUCTION",
  ];
  const isExactReplay =
    previous.generation === RELEASE_R0_SUCCESSOR.generation &&
    previous.status === "ACTIVE" && previous.blocker_set.length === 0 &&
    previous.active_work_item_id === "WORK-ITEM-KUSABI-R0-V3-INDEPENDENT-AUDIT" &&
    previous.checkpoint?.last_event_id === eventId && canonicalJson(passed) === canonicalJson(expectedPassed);
  const exactPredecessor =
    previous.generation === 2 && previous.status === "BLOCKED" &&
    previous.active_work_item_id === "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE" &&
    previous.blocker_set.length === 1 && previous.blocker_set[0]?.blocker_id === "B-02-IMMUTABLE-RUNTIME-NOT-SELF-CONTAINED" &&
    canonicalJson(passed) === canonicalJson(["A-01-PR281-EXACT-MERGE"]);
  if (!isExactReplay && !exactPredecessor) {
    throw new Error("release/R0 successor requires the exact blocked generation-2 predecessor or its exact generation-3 replay");
  }
  assertReleaseR0SuccessorEvidence(repoRoot);

  const idempotencyKey = digestValue({
    event_id: eventId,
    predecessor_head: RELEASE_R0_SUCCESSOR.predecessor_head,
    predecessor_tree: RELEASE_R0_SUCCESSOR.predecessor_tree,
    release_file_sha256: RELEASE_R0_SUCCESSOR.release_file_sha256,
    release_descriptor_sha256: RELEASE_R0_SUCCESSOR.release_descriptor_sha256,
    runtime_tree_sha256: RELEASE_R0_SUCCESSOR.runtime_tree_sha256,
    dependency_inventory_sha256: RELEASE_R0_SUCCESSOR.dependency_inventory_sha256,
    import_smoke_results_sha256: RELEASE_R0_SUCCESSOR.import_smoke_results_sha256,
    r0_v3_file_sha256: RELEASE_R0_SUCCESSOR.r0_v3_file_sha256,
    amendment_ref: RELEASE_R0_SUCCESSOR.amendment_ref,
  });
  const checkpoint = {
    event_sequence: isExactReplay ? previous.checkpoint.event_sequence : previous.checkpoint.event_sequence + 1,
    last_event_id: eventId,
    last_idempotency_key: idempotencyKey,
  };
  const releaseRef = `file:${RELEASE_PATH}#sha256:${RELEASE_R0_SUCCESSOR.release_file_sha256}`;
  const r0Ref = `file:${R0_V3_PATH}#sha256:${RELEASE_R0_SUCCESSOR.r0_v3_file_sha256}`;
  const goalRun = structuredClone(previous);
  goalRun.status = "ACTIVE";
  goalRun.generation = RELEASE_R0_SUCCESSOR.generation;
  goalRun.active_work_item_id = "WORK-ITEM-KUSABI-R0-V3-INDEPENDENT-AUDIT";
  goalRun.blocker_set = [];
  goalRun.acceptance_states = goalRun.acceptance_states.map((state) => {
    if (state.acceptance_id === "A-02-IMMUTABLE-RUNTIME-RELEASE") {
      return {
        ...state,
        status: "VERIFIED_PASS",
        evidence_refs: [
          releaseRef,
          `release:sha256:${RELEASE_R0_SUCCESSOR.release_descriptor_sha256}`,
          `${releaseRef}/release/import_smoke_after_publish#sha256:${RELEASE_R0_SUCCESSOR.import_smoke_results_sha256}`,
        ],
      };
    }
    if (state.acceptance_id === "A-03-R0-V3-HEARTBEAT-REPRODUCTION") {
      return { ...state, status: "VERIFIED_PASS", evidence_refs: [r0Ref, RELEASE_R0_SUCCESSOR.amendment_ref] };
    }
    return state;
  });
  goalRun.checkpoint = checkpoint;
  goalRun.state_digest = computeGoalRunStateDigest(goalRun);

  const successorHandoffDigest = digestValue({
    control_handoff_ref: RELEASE_R0_SUCCESSOR.amendment_ref,
    amendment_body_sha256: RELEASE_R0_SUCCESSOR.amendment_body_sha256,
    release_handoff_ref: RELEASE_R0_SUCCESSOR.release_handoff_ref,
    release_handoff_body_sha256: RELEASE_R0_SUCCESSOR.release_handoff_body_sha256,
  });
  const successorIds = new Set([
    "A-02-IMMUTABLE-RUNTIME-RELEASE",
    "A-03-R0-V3-HEARTBEAT-REPRODUCTION",
    "A-04-R0-V3-INDEPENDENT-AUDIT",
    "A-05-R0-V3-OWNER-GO",
  ]);
  const workItems = loadWorkItems(repoRoot).map(({ path, document }) => {
    const item = structuredClone(document);
    item.generation = goalRun.generation;
    item.checkpoint = { ...checkpoint };
    if (successorIds.has(item.unmet_condition_id)) {
      item.control_handoff_ref = RELEASE_R0_SUCCESSOR.amendment_ref;
      item.handoff_digest = successorHandoffDigest;
    }
    if (item.unmet_condition_id === "A-02-IMMUTABLE-RUNTIME-RELEASE") {
      item.removes_blocker_ids = ["B-02-IMMUTABLE-RUNTIME-NOT-SELF-CONTAINED"];
      item.blocker_ordinal = 2;
    }
    const terminalEvidence = successorTerminalEvidence(item);
    if (terminalEvidence) {
      item.status = "VERIFIED_TERMINAL";
      item.terminal_evidence = terminalEvidence;
    } else if (item.unmet_condition_id === "A-04-R0-V3-INDEPENDENT-AUDIT") {
      item.status = "READY";
      item.terminal_evidence = [];
    }
    item.dispatch_idempotency_key = computeDispatchIdempotencyKey(item, goalRun.generation);
    item.state_digest = computeWorkItemStateDigest(item);
    writeJson(path, item);
    return item;
  });
  writeJson(goalPath, goalRun);
  const binding = buildBinding(goalRun, observedAt);
  writeJson(absolute(repoRoot, BINDING_PATH), binding);
  return {
    goalRun,
    workItems,
    binding,
    predecessor_history_ref: `git-commit:${RELEASE_R0_SUCCESSOR.predecessor_head}`,
    replayed: isExactReplay,
  };
}

function preRolloutTerminalEvidence(item) {
  const acceptanceId = item.unmet_condition_id;
  const releaseRef = `file:${RELEASE_PATH}#sha256:${PRE_ROLLOUT_RECONCILIATION.release_file_sha256}`;
  const r0Ref = `file:${R0_V3_PATH}#sha256:${PRE_ROLLOUT_RECONCILIATION.r0_v3_file_sha256}`;
  const evidenceByAcceptance = {
    "A-02-IMMUTABLE-RUNTIME-RELEASE": {
      actor_id: "kusabi",
      active_function: "implementation_executor",
      provenance_ref: releaseRef,
      refs: {
        clean_build_readback: `${releaseRef}/build`,
        content_addressed_release_readback: `release:sha256:${PRE_ROLLOUT_RECONCILIATION.release_descriptor_sha256}`,
        entrypoint_digest_readback: `${releaseRef}/release/required_entrypoint_readback`,
      },
    },
    "A-03-R0-V3-HEARTBEAT-REPRODUCTION": {
      actor_id: "kusabi",
      active_function: "implementation_executor",
      provenance_ref: r0Ref,
      refs: {
        r0_v3_capture_a: `${r0Ref}/capture_a#sha256:${PRE_ROLLOUT_RECONCILIATION.capture_a_sha256}`,
        ordinary_heartbeat_separation: `${r0Ref}/heartbeat_separation`,
        r0_v3_capture_b: `${r0Ref}/capture_b#sha256:${PRE_ROLLOUT_RECONCILIATION.capture_b_sha256}`,
        r0_v3_equality_matrix: `${r0Ref}/equality_matrix`,
      },
    },
    "A-04-R0-V3-INDEPENDENT-AUDIT": {
      actor_id: "devauditor",
      active_function: "evidence_audit_gate",
      provenance_ref: PRE_ROLLOUT_RECONCILIATION.audit_ref,
      refs: {
        independent_audit_pass: PRE_ROLLOUT_RECONCILIATION.audit_ref,
        audit_blocker_count_zero: `${PRE_ROLLOUT_RECONCILIATION.audit_ref}#blocker_count=0`,
        protected_effect_count_zero: `${PRE_ROLLOUT_RECONCILIATION.audit_ref}#protected_effect_count=0`,
      },
    },
    "A-05-R0-V3-OWNER-GO": {
      actor_id: "watchout",
      active_function: "owner_decision",
      provenance_ref: PRE_ROLLOUT_RECONCILIATION.owner_decision_ref,
      refs: {
        owner_exact_subject_readback: PRE_ROLLOUT_RECONCILIATION.owner_decision_ref,
        owner_r1_r2_r3_grant: PRE_ROLLOUT_RECONCILIATION.owner_decision_ref,
      },
    },
  };
  const definition = evidenceByAcceptance[acceptanceId];
  if (!definition) return null;
  return item.required_evidence.map((evidenceClass) => ({
    evidence_ref: definition.refs[evidenceClass],
    evidence_class: evidenceClass,
    subject_work_item_id: item.work_item_id,
    actor_id: definition.actor_id,
    active_function: definition.active_function,
    provenance_ref: definition.provenance_ref,
    acceptance_id: acceptanceId,
    blocker_id: null,
    exact_version: EXPECTED_VERSION,
    predicate_verified: true,
  }));
}

function reconcilePreRollout(repoRoot, observedAt) {
  const goalPath = absolute(repoRoot, GOAL_PATH);
  const previous = readJson(goalPath);
  const passed = previous.acceptance_states.filter((state) => state.status === "VERIFIED_PASS").map((state) => state.acceptance_id);
  const eventId = `EVENT-KUSABI-PREROLLOUT-RECONCILED-${PRE_ROLLOUT_RECONCILIATION.merge_commit}`;
  const isExactReplay =
    previous.generation === PRE_ROLLOUT_RECONCILIATION.generation &&
    previous.status === "ACTIVE" &&
    previous.active_work_item_id === "WORK-ITEM-KUSABI-R1-CANARY-3-OF-3" &&
    previous.checkpoint?.last_event_id === eventId &&
    canonicalJson(passed) === canonicalJson([
      "A-01-PR281-EXACT-MERGE",
      "A-02-IMMUTABLE-RUNTIME-RELEASE",
      "A-03-R0-V3-HEARTBEAT-REPRODUCTION",
      "A-04-R0-V3-INDEPENDENT-AUDIT",
      "A-05-R0-V3-OWNER-GO",
    ]);
  if (
    !isExactReplay && (
      previous.generation !== 1 ||
      previous.status !== "ACTIVE" ||
      previous.active_work_item_id !== "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE" ||
      canonicalJson(passed) !== canonicalJson(["A-01-PR281-EXACT-MERGE"])
    )
  ) {
    throw new Error("pre-rollout reconciliation requires the exact generation-1 input or its exact generation-2 checkpoint");
  }
  assertPreRolloutEvidence(repoRoot);

  const previousPath = absolute(repoRoot, `${GOAL_HISTORY_DIR}/${GOAL_ID}.generation-1.json`);
  if (!isExactReplay) writeJson(previousPath, previous);
  const idempotencyKey = digestValue({
    event_id: eventId,
    merge_commit: PRE_ROLLOUT_RECONCILIATION.merge_commit,
    merge_tree: PRE_ROLLOUT_RECONCILIATION.merge_tree,
    release_file_sha256: PRE_ROLLOUT_RECONCILIATION.release_file_sha256,
    r0_v3_file_sha256: PRE_ROLLOUT_RECONCILIATION.r0_v3_file_sha256,
    audit_ref: PRE_ROLLOUT_RECONCILIATION.audit_ref,
    owner_decision_ref: PRE_ROLLOUT_RECONCILIATION.owner_decision_ref,
  });
  const checkpoint = {
    event_sequence: isExactReplay ? previous.checkpoint.event_sequence : previous.checkpoint.event_sequence + 1,
    last_event_id: eventId,
    last_idempotency_key: idempotencyKey,
  };
  const reconciledIds = new Set([
    "A-02-IMMUTABLE-RUNTIME-RELEASE",
    "A-03-R0-V3-HEARTBEAT-REPRODUCTION",
    "A-04-R0-V3-INDEPENDENT-AUDIT",
    "A-05-R0-V3-OWNER-GO",
  ]);
  const evidenceRefs = {
    "A-02-IMMUTABLE-RUNTIME-RELEASE": [
      `file:${RELEASE_PATH}#sha256:${PRE_ROLLOUT_RECONCILIATION.release_file_sha256}`,
      `release:sha256:${PRE_ROLLOUT_RECONCILIATION.release_descriptor_sha256}`,
    ],
    "A-03-R0-V3-HEARTBEAT-REPRODUCTION": [
      `file:${R0_V3_PATH}#sha256:${PRE_ROLLOUT_RECONCILIATION.r0_v3_file_sha256}`,
      PRE_ROLLOUT_RECONCILIATION.merge_evidence_ref,
    ],
    "A-04-R0-V3-INDEPENDENT-AUDIT": [PRE_ROLLOUT_RECONCILIATION.audit_ref],
    "A-05-R0-V3-OWNER-GO": [PRE_ROLLOUT_RECONCILIATION.owner_decision_ref, PRE_ROLLOUT_RECONCILIATION.owner_control_ref],
  };
  const goalRun = structuredClone(previous);
  if (!isExactReplay) {
    goalRun.generation = PRE_ROLLOUT_RECONCILIATION.generation;
    goalRun.active_work_item_id = "WORK-ITEM-KUSABI-R1-CANARY-3-OF-3";
    goalRun.acceptance_states = goalRun.acceptance_states.map((state) => reconciledIds.has(state.acceptance_id)
      ? { ...state, status: "VERIFIED_PASS", evidence_refs: evidenceRefs[state.acceptance_id] }
      : state);
    goalRun.checkpoint = checkpoint;
    goalRun.state_digest = computeGoalRunStateDigest(goalRun);
  }

  const workItems = loadWorkItems(repoRoot).map(({ path, document }) => {
    const item = structuredClone(document);
    item.generation = goalRun.generation;
    item.checkpoint = { ...checkpoint };
    const terminalEvidence = preRolloutTerminalEvidence(item);
    if (terminalEvidence) {
      item.status = "VERIFIED_TERMINAL";
      item.terminal_evidence = terminalEvidence;
    }
    item.dispatch_idempotency_key = computeDispatchIdempotencyKey(item, goalRun.generation);
    item.state_digest = computeWorkItemStateDigest(item);
    writeJson(path, item);
    return item;
  });
  writeJson(goalPath, goalRun);
  const binding = buildBinding(goalRun, observedAt);
  writeJson(absolute(repoRoot, BINDING_PATH), binding);
  return { goalRun, workItems, binding, previousPath, replayed: isExactReplay };
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

function buildGenerationHistory(repoRoot, goalDocument) {
  const history = {
    generation_1: {
      evidence_ref: `file:${GOAL_HISTORY_DIR}/${GOAL_ID}.generation-1.json`,
      file_sha256: existsSync(absolute(repoRoot, `${GOAL_HISTORY_DIR}/${GOAL_ID}.generation-1.json`))
        ? sha256Raw(readFileSync(absolute(repoRoot, `${GOAL_HISTORY_DIR}/${GOAL_ID}.generation-1.json`)))
        : null,
    },
    generation_2: goalDocument.generation >= 3 ? {
      evidence_ref: `git-commit:${RELEASE_R0_SUCCESSOR.predecessor_head}:${GOAL_PATH}`,
      predecessor_tree: RELEASE_R0_SUCCESSOR.predecessor_tree,
      file_sha256: "6f39518dba6953f17b843ea2696611c3aaa5c360a6cfe8c3085cfdc1bac1f66c",
      state_digest: "sha256:ad2029be0715d9d720fe513da1f6909af3df3756c87556b1a467391053f82e43",
      retention: "IMMUTABLE_GIT_PREDECESSOR_AND_AUDIT_HISTORY",
    } : null,
  };
  for (let generation = 3; generation < goalDocument.generation; generation++) {
    const historyPath = absolute(repoRoot, `${GOAL_HISTORY_DIR}/${GOAL_ID}.generation-${generation}.json`);
    if (!existsSync(historyPath)) continue;
    const document = readJson(historyPath);
    history[`generation_${generation}`] = {
      evidence_ref: `file:${GOAL_HISTORY_DIR}/${GOAL_ID}.generation-${generation}.json`,
      file_sha256: sha256Raw(readFileSync(historyPath)),
      state_digest: document.state_digest,
      checkpoint: document.checkpoint,
      retention: "IMMUTABLE_FILE_BACKED_PREDECESSOR",
    };
  }
  history[`generation_${goalDocument.generation}`] = {
    evidence_ref: `file:${GOAL_PATH}`,
    state_digest: goalDocument.state_digest,
    checkpoint: goalDocument.checkpoint,
    retention: "CURRENT_MUTABLE_GOALRUN_STATE",
  };
  return history;
}

export function buildStatus(goalRun, workItems) {
  const definitions = [...goalRun.acceptance_set].sort((a, b) => a.ordinal - b.ordinal || a.acceptance_id.localeCompare(b.acceptance_id));
  const stateById = new Map(goalRun.acceptance_states.map((state) => [state.acceptance_id, state]));
  const unmet = definitions.find((definition) => stateById.get(definition.acceptance_id)?.status !== "VERIFIED_PASS");
  const candidates = workItems.filter((item) => item.status === "READY" && item.unmet_condition_id === unmet?.acceptance_id)
    .sort((a, b) => a.acceptance_ordinal - b.acceptance_ordinal || a.blocker_ordinal - b.blocker_ordinal || a.work_item_id.localeCompare(b.work_item_id));
  const effectiveBlocker = goalRun.blocker_set[0] ?? null;
  const effectiveBlocked = goalRun.status === "BLOCKED" || Boolean(effectiveBlocker);
  const blocked = effectiveBlocked
    ? workItems.find((item) => item.work_item_id === goalRun.active_work_item_id) ?? null
    : null;
  const next = effectiveBlocked ? blocked : candidates[0] ?? null;
  const route = next
    ? ROUTE_BY_EFFECTIVE_BLOCKER_ID[effectiveBlocker?.blocker_id] ?? ROUTE_BY_ACCEPTANCE_ID[next.unmet_condition_id]
    : null;
  if (next && !route) throw new Error(`missing deterministic route for ${next.unmet_condition_id}`);
  const acceptancePassed = goalRun.acceptance_states.filter((state) => state.status === "VERIFIED_PASS").length;
  const targetLiveExact = goalRun.target_states.filter((target) => target.live_exact_version === target.expected_version && target.live_evidence_ref).length;
  const targetRollbackExact = goalRun.target_states.filter((target) => target.rollback_exact_version === target.expected_version && target.rollback_evidence_ref).length;
  return {
    schema_version: "shirube-v4/goal-status/v1",
    root_goal_run_id: goalRun.root_goal_run_id,
    status: effectiveBlocked ? "BLOCKED" : goalRun.status,
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
      status: effectiveBlocked ? "BLOCKED" : next.status,
    } : null,
    can_continue: Boolean(!effectiveBlocked && next && next.status === "READY"),
    next_action: next ? {
      blocking: effectiveBlocked ? true : route.blocking,
      actor_agent_id: route.actor_agent_id,
      active_function: route.active_function,
      action: effectiveBlocked
        ? route.action || effectiveBlocker?.removal_predicate || `Resolve the effective blocker for ${next.work_item_id}.`
        : route.action || `Execute ${next.work_item_id} within its exact control handoff and return all required evidence.`,
      deliver_via: route.deliver_via || "WorkItem terminal evidence and GoalRun generation update",
      exact_input_refs: [...new Set([
        next.control_handoff_ref,
        ...(effectiveBlocker?.evidence_refs ?? []),
        GOAL_PATH,
        `${WORK_ITEM_DIR}/${next.work_item_id}.json`,
      ])],
      scope: route.scope || `Only operation ${next.required_operation}; forbidden operations remain denied by WorkItem v2.`,
      deliverable: route.deliverable || next.required_evidence,
      completion_evidence: route.completion_evidence || "Canonical WorkItem v2 terminal-evidence validation and GoalRun readback.",
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
    generation_history: buildGenerationHistory(repoRoot, goalDocument),
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
  if (command === "reconcile-prerollout") {
    reconcilePreRollout(repoRoot, options["observed-at"] || PRE_ROLLOUT_RECONCILIATION.merged_at);
    const report = check(repoRoot, options["framework-root"], true);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.verdict === "PASS" ? 0 : 1;
    return;
  }
  if (command === "record-prerollout-blocker") {
    recordPreRolloutBlocker(repoRoot, options["observed-at"] || new Date().toISOString());
    const report = check(repoRoot, options["framework-root"], true);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.verdict === "PASS" ? 0 : 1;
    return;
  }
  if (command === "advance-release-r0-successor") {
    advanceReleaseR0Successor(repoRoot, options["observed-at"] || new Date().toISOString());
    const report = check(repoRoot, options["framework-root"], true);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.verdict === "PASS" ? 0 : 1;
    return;
  }
  if (command === "reconcile-cas-b01-audit") {
    reconcileCasB01Audit(repoRoot, observedAt, options);
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
