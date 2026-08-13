import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  installClaudeSessionStartHook,
  mergeClaudeSessionStartHook,
  parseClaudeHookCommand,
  parseClaudeSettings,
} from "./claude-hook-installer.js";
import {
  CLAUDE_SESSION_START_ADAPTER_VERSION,
  type ClaudeSessionStartBinding,
} from "./claude-session-start.js";
import {
  installCodexSessionStartHook,
  mergeCodexSessionStartHook,
  parseCodexHookCommand,
  parseHooksFile,
} from "./codex-hook-installer.js";
import {
  CODEX_SESSION_START_ADAPTER_VERSION,
  type CodexSessionStartBinding,
} from "./codex-session-start.js";
import {
  installGeminiSessionStartHook,
  mergeGeminiSessionStartHooks,
  parseGeminiHookCommand,
  parseGeminiSettings,
} from "./gemini-hook-installer.js";
import {
  GEMINI_SESSION_START_ADAPTER_VERSION,
  type GeminiSessionStartBinding,
} from "./gemini-session-start.js";
import {
  assertKusabiFleetManifest,
  kusabiFleetManifestSha256,
  kusabiFleetTargetKey,
  validateKusabiFleetStatus,
  type KusabiFleetBuildIdentity,
  type KusabiFleetDeploymentIdentity,
  type KusabiFleetIdentity,
  type KusabiFleetManifest,
  type KusabiFleetStatusSnapshot,
  type KusabiHostRuntime,
} from "./kusabi-fleet-status.js";

const SHA256_RE = /^[a-f0-9]{64}$/;
const GIT_SHA_RE = /^[a-f0-9]{40}$/;
const BOUNDED_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STAGE_ORDER = { r1: 1, r2: 2, r3: 3 } as const;

const KUSABI_FLEET_INVENTORY_QUERY_CONTRACT = {
  schema_version: "kusabi-fleet-inventory-query-contract/v1",
  database: "agent_comms",
  canonical_identity_tables: ["agent_aliases", "agents"],
  workspace_binding_table: "agent_workspace_bindings",
  primary_predicates: [
    "agent_type_non_human",
    "agent_active",
    "profile_enabled",
    "runtime_supported",
    "production_workspace",
    "workspace_binding_active",
    "new_work_allowed",
  ],
  secondary_binding_source: "owner_approved_secondary",
} as const;

export const KUSABI_FLEET_INVENTORY_QUERY_CONTRACT_SHA256 = sha256(
  canonicalJson(KUSABI_FLEET_INVENTORY_QUERY_CONTRACT),
);

export type KusabiFleetRolloutStage = keyof typeof STAGE_ORDER;

export interface KusabiFleetRolloutBatch {
  batch_id: string;
  stage: KusabiFleetRolloutStage;
  ordinal: number;
  minimum_soak_seconds: number;
  target_keys: string[];
}

export interface KusabiFleetRolloutPlan {
  schema_version: "kusabi-fleet-rollout-plan/v1";
  rollout_id: string;
  manifest: {
    manifest_id: string;
    version: number;
    manifest_sha256: string;
    target_count: number;
  };
  implementation: {
    commit_sha: string;
    tree_sha: string;
  };
  inventory: KusabiFleetInventorySummary;
  batches: KusabiFleetRolloutBatch[];
  rollout_plan_sha256: string;
}

export type KusabiFleetInventoryBindingSource = "agent_comms_primary" | "owner_approved_secondary";

export interface KusabiFleetInventoryEligibility {
  canonical_identity_verified: true;
  agent_type_non_human: true;
  agent_active: true;
  profile_enabled: true;
  runtime_supported: true;
  production_workspace: true;
  workspace_binding_active: true;
  new_work_allowed: true;
}

export interface KusabiFleetInventoryBinding {
  binding_key: string;
  registered_agent_id: string;
  canonical_agent_id: string;
  project: string;
  host_runtime: KusabiHostRuntime;
  workspace_sha256: string;
  binding_source: KusabiFleetInventoryBindingSource;
  binding_source_ref_sha256: string;
  eligibility: KusabiFleetInventoryEligibility;
}

export type KusabiFleetInventoryBindingInput = Omit<KusabiFleetInventoryBinding, "binding_key">;

export interface KusabiFleetInventorySnapshot {
  schema_version: "kusabi-fleet-inventory-snapshot/v1";
  source: {
    kind: "agent_comms_postgres";
    query_contract_id: "kusabi-fleet-eligibility/v1";
    query_contract_sha256: string;
    primary_result_sha256: string;
    captured_at: string;
  };
  primary_binding_count: number;
  secondary_binding_count: number;
  bindings: KusabiFleetInventoryBinding[];
  snapshot_sha256: string;
}

export interface KusabiFleetInventorySnapshotInput {
  schema_version: "kusabi-fleet-inventory-snapshot/v1";
  source: Omit<KusabiFleetInventorySnapshot["source"], "primary_result_sha256">;
  bindings: KusabiFleetInventoryBindingInput[];
}

export interface KusabiFleetInventorySummary {
  snapshot_sha256: string;
  query_contract_sha256: string;
  primary_result_sha256: string;
  primary_binding_count: number;
  secondary_binding_count: number;
  target_count: number;
}

export interface KusabiFleetRolloutTargetInput {
  agent_id: string;
  project: string;
  host_runtime: KusabiHostRuntime;
  workspace: string;
  binding_source_ref: string;
  storage: KusabiFleetDeploymentIdentity["storage"];
  trust_source: KusabiFleetTrustSource;
  stage: KusabiFleetRolloutStage;
  batch_id: string;
  maintenance_windows?: Array<{ started_at: string; ended_at: string }>;
}

export type KusabiFleetTrustSource =
  | { kind: "codex_hook_state"; config_toml: string }
  | { kind: "claude_project_state"; claude_state_json: string }
  | { kind: "gemini_hook_state"; trusted_folders_json: string; trusted_hooks_json: string };

export interface KusabiFleetR0Options {
  manifest_id: string;
  manifest_version: number;
  rollout_id: string;
  runtime_root: string;
  commit_sha: string;
  tree_sha: string;
  activation_at: string;
  durable_evidence_deadline_at: string;
  stale_after_seconds: number;
  captured_at: string;
  batch_order: Array<{
    batch_id: string;
    stage: KusabiFleetRolloutStage;
    ordinal: number;
    minimum_soak_seconds: number;
  }>;
  inventory_snapshot: KusabiFleetInventorySnapshot;
  targets: KusabiFleetRolloutTargetInput[];
}

export interface KusabiFleetR0TargetEvidence {
  target_key: string;
  host_runtime: KusabiHostRuntime;
  batch_id: string;
  config_locator_sha256: string;
  preimage_state: "absent" | "file";
  preimage_sha256: string | null;
  preimage_mode: string | null;
  expected_postimage_sha256: string;
  artifact_sha256: string;
  trust_source_locator_sha256: string;
  preimage_trust_fingerprint_sha256: string;
  expected_trust_fingerprint_sha256: string;
  preimage_trust_exact: boolean;
  rollback_required: boolean;
}

export interface KusabiFleetR0Report {
  schema_version: "kusabi-fleet-r0-report/v1";
  captured_at: string;
  manifest: KusabiFleetRolloutPlan["manifest"];
  inventory: KusabiFleetInventorySummary;
  rollout_plan_sha256: string;
  target_count: number;
  targets: KusabiFleetR0TargetEvidence[];
  forbidden_value_count: 0;
  production_mutation_count: 0;
  report_sha256: string;
}

export interface KusabiFleetR0Result {
  inventory_snapshot: KusabiFleetInventorySnapshot;
  manifest: KusabiFleetManifest;
  rollout_plan: KusabiFleetRolloutPlan;
  report: KusabiFleetR0Report;
}

export interface KusabiFleetRolloutAuthorization {
  schema_version: "kusabi-fleet-rollout-authorization/v1";
  decision_id: string;
  approved: true;
  implementation_head_sha: string;
  implementation_tree_sha: string;
  manifest_sha256: string;
  rollout_plan_sha256: string;
  decision_ref_sha256: string;
  authorization_sha256: string;
}

export interface KusabiFleetObservedTarget {
  schema_version: "kusabi-fleet-observed-target/v1";
  observed_at: string;
  target_key: string;
  deployment: KusabiFleetDeploymentIdentity;
  config_locator_sha256: string;
  managed_binding_exact: boolean;
  config_exact: boolean;
  build_exact: boolean;
  trust_exact: boolean;
  storage_exact: boolean;
  exact: boolean;
  observation_sha256: string;
}

export interface KusabiFleetDeploymentObservationInput {
  target: KusabiFleetManifest["targets"][number];
  workspace: string;
  runtime_root: string;
  binding_source_ref: string;
  trust_source: KusabiFleetTrustSource;
  observed_storage: KusabiFleetDeploymentIdentity["storage"];
  /** False when no live store-binding probe was performed. */
  storage_observed?: boolean;
  observed_commit_sha: string;
  observed_tree_sha: string;
  observed_at: string;
}

export interface KusabiFleetBatchGateReport {
  schema_version: "kusabi-fleet-batch-gate/v1";
  rollout_plan_sha256: string;
  manifest_sha256: string;
  batch_id: string;
  stage: KusabiFleetRolloutStage;
  target_count: number;
  exact_observed_count: number;
  healthy_durable_count: number;
  soak_elapsed_seconds: number;
  minimum_soak_seconds: number;
  open_p0_count: number;
  open_p1_count: number;
  verdict: "PASS" | "BLOCKED";
  blockers: string[];
  report_sha256: string;
}

/**
 * A direct-delivery sequencing receipt. Unlike a durable health gate, this
 * proves only that the preceding batch was placed and read back exactly. It
 * must never be presented as soak, runtime-health, or durable-delivery proof.
 */
export interface KusabiFleetPlacementGateReport {
  schema_version: "wasurezu-fleet-placement-gate/v1";
  rollout_plan_sha256: string;
  manifest_sha256: string;
  batch_id: string;
  stage: KusabiFleetRolloutStage;
  target_count: number;
  exact_observed_count: number;
  verdict: "PASS" | "BLOCKED";
  blockers: string[];
  report_sha256: string;
}

export interface KusabiFleetApplyBatchOptions {
  plan: KusabiFleetRolloutPlan;
  manifest: KusabiFleetManifest;
  inventory_snapshot: KusabiFleetInventorySnapshot;
  authorization: KusabiFleetRolloutAuthorization;
  batch_id: string;
  runtime_root: string;
  targets: KusabiFleetRolloutTargetInput[];
  prior_gate_reports?: Array<KusabiFleetBatchGateReport | KusabiFleetPlacementGateReport>;
}

export interface KusabiFleetApplyBatchReport {
  schema_version: "kusabi-fleet-apply-batch-report/v1";
  rollout_plan_sha256: string;
  manifest_sha256: string;
  batch_id: string;
  attempted_count: number;
  placed_count: number;
  rolled_back: boolean;
  target_results: Array<{
    target_key: string;
    preimage_sha256: string | null;
    postimage_sha256: string;
    wrote_config: boolean;
  }>;
  report_sha256: string;
}

export class KusabiFleetRolloutError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "KusabiFleetRolloutError";
    this.code = code;
  }
}

interface ConfigSnapshot {
  state: "absent" | "file";
  raw: string | null;
  sha256: string | null;
  mode: string | null;
  configPath: string;
}

interface PreparedTarget {
  input: KusabiFleetRolloutTargetInput;
  workspace: string;
  targetKey: string;
  snapshot: ConfigSnapshot;
  desiredRaw: string;
  desiredSha256: string;
  artifactSha256: string;
  adapterVersion: string;
  expectedTrustFingerprint: string;
  observedTrustFingerprint: string;
  observedTrustExact: boolean;
  trustSourceLocatorSha256: string;
}

export function kusabiFleetInventoryBindingKey(
  binding: Pick<KusabiFleetInventoryBinding,
    "canonical_agent_id" | "project" | "host_runtime" | "workspace_sha256" | "binding_source_ref_sha256">,
): string {
  return sha256([
    binding.canonical_agent_id,
    binding.project,
    binding.host_runtime,
    binding.workspace_sha256,
    binding.binding_source_ref_sha256,
  ].join("\n"));
}

export function kusabiFleetInventorySnapshotSha256(snapshot: KusabiFleetInventorySnapshot): string {
  return sha256(canonicalJson({
    schema_version: snapshot.schema_version,
    source: snapshot.source,
    primary_binding_count: snapshot.primary_binding_count,
    secondary_binding_count: snapshot.secondary_binding_count,
    bindings: snapshot.bindings,
  }));
}

export function sealKusabiFleetInventorySnapshot(
  input: KusabiFleetInventorySnapshotInput,
): KusabiFleetInventorySnapshot {
  const bindings = input.bindings.map((binding) => ({
    ...binding,
    binding_key: kusabiFleetInventoryBindingKey(binding),
  })).sort((left, right) => left.binding_key.localeCompare(right.binding_key));
  const snapshot: KusabiFleetInventorySnapshot = {
    schema_version: input.schema_version,
    source: {
      ...input.source,
      primary_result_sha256: sha256(canonicalJson(
        bindings.filter(({ binding_source }) => binding_source === "agent_comms_primary"),
      )),
    },
    primary_binding_count: bindings.filter(({ binding_source }) => binding_source === "agent_comms_primary").length,
    secondary_binding_count: bindings.filter(({ binding_source }) => binding_source === "owner_approved_secondary").length,
    bindings,
    snapshot_sha256: "0".repeat(64),
  };
  snapshot.snapshot_sha256 = kusabiFleetInventorySnapshotSha256(snapshot);
  assertKusabiFleetInventorySnapshot(snapshot);
  return snapshot;
}

export function assertKusabiFleetInventorySnapshot(
  value: unknown,
): asserts value is KusabiFleetInventorySnapshot {
  if (!isRecord(value) || !exactKeys(value, [
    "schema_version", "source", "primary_binding_count", "secondary_binding_count", "bindings", "snapshot_sha256",
  ])) fail("KUSABI_FLEET_INVENTORY_INVALID");
  if (
    value.schema_version !== "kusabi-fleet-inventory-snapshot/v1" || !isRecord(value.source) ||
    !exactKeys(value.source, [
      "kind", "query_contract_id", "query_contract_sha256", "primary_result_sha256", "captured_at",
    ]) ||
    value.source.kind !== "agent_comms_postgres" ||
    value.source.query_contract_id !== "kusabi-fleet-eligibility/v1" ||
    value.source.query_contract_sha256 !== KUSABI_FLEET_INVENTORY_QUERY_CONTRACT_SHA256 ||
    !sha256Value(value.source.primary_result_sha256) ||
    !nonNegativeInteger(value.primary_binding_count) || !nonNegativeInteger(value.secondary_binding_count) ||
    !Array.isArray(value.bindings) || value.bindings.length < 1 || !sha256Value(value.snapshot_sha256)
  ) fail("KUSABI_FLEET_INVENTORY_INVALID");
  requireTimestamp(value.source.captured_at, "KUSABI_FLEET_INVENTORY_INVALID");

  const eligibilityKeys = [
    "canonical_identity_verified", "agent_type_non_human", "agent_active", "profile_enabled",
    "runtime_supported", "production_workspace", "workspace_binding_active", "new_work_allowed",
  ];
  const seen = new Set<string>();
  let primaryCount = 0;
  let secondaryCount = 0;
  let previousKey = "";
  for (const rawBinding of value.bindings) {
    const eligibility = isRecord(rawBinding) && isRecord(rawBinding.eligibility)
      ? rawBinding.eligibility
      : null;
    if (!isRecord(rawBinding) || !exactKeys(rawBinding, [
      "binding_key", "registered_agent_id", "canonical_agent_id", "project", "host_runtime", "workspace_sha256",
      "binding_source", "binding_source_ref_sha256", "eligibility",
    ]) || !boundedId(rawBinding.registered_agent_id) || !boundedId(rawBinding.canonical_agent_id) ||
      rawBinding.registered_agent_id !== rawBinding.canonical_agent_id || !boundedId(rawBinding.project) ||
      !(rawBinding.host_runtime === "codex" || rawBinding.host_runtime === "claude_code" ||
        rawBinding.host_runtime === "gemini_cli") || !sha256Value(rawBinding.workspace_sha256) ||
      !(rawBinding.binding_source === "agent_comms_primary" ||
        rawBinding.binding_source === "owner_approved_secondary") ||
      !sha256Value(rawBinding.binding_source_ref_sha256) || !sha256Value(rawBinding.binding_key) ||
      eligibility === null || !exactKeys(eligibility, eligibilityKeys) ||
      !eligibilityKeys.every((key) => eligibility[key] === true)) {
      fail("KUSABI_FLEET_INVENTORY_BINDING_INVALID");
    }
    const binding = rawBinding as unknown as KusabiFleetInventoryBinding;
    if (binding.binding_key !== kusabiFleetInventoryBindingKey(binding)) {
      fail("KUSABI_FLEET_INVENTORY_BINDING_KEY_MISMATCH");
    }
    if (seen.has(binding.binding_key)) fail("KUSABI_FLEET_INVENTORY_DUPLICATE_BINDING");
    if (previousKey !== "" && binding.binding_key <= previousKey) fail("KUSABI_FLEET_INVENTORY_ORDER_INVALID");
    seen.add(binding.binding_key);
    previousKey = binding.binding_key;
    if (binding.binding_source === "agent_comms_primary") primaryCount++;
    else secondaryCount++;
  }
  if (primaryCount !== value.primary_binding_count || secondaryCount !== value.secondary_binding_count ||
    primaryCount + secondaryCount !== value.bindings.length) {
    fail("KUSABI_FLEET_INVENTORY_COUNT_MISMATCH");
  }
  const primaryResultSha256 = sha256(canonicalJson(
    (value.bindings as unknown as KusabiFleetInventoryBinding[])
      .filter(({ binding_source }) => binding_source === "agent_comms_primary"),
  ));
  if (value.source.primary_result_sha256 !== primaryResultSha256) {
    fail("KUSABI_FLEET_INVENTORY_PRIMARY_RESULT_MISMATCH");
  }
  const snapshot = value as unknown as KusabiFleetInventorySnapshot;
  if (kusabiFleetInventorySnapshotSha256(snapshot) !== snapshot.snapshot_sha256) {
    fail("KUSABI_FLEET_INVENTORY_HASH_MISMATCH");
  }
}

function inventorySummary(snapshot: KusabiFleetInventorySnapshot): KusabiFleetInventorySummary {
  return {
    snapshot_sha256: snapshot.snapshot_sha256,
    query_contract_sha256: snapshot.source.query_contract_sha256,
    primary_result_sha256: snapshot.source.primary_result_sha256,
    primary_binding_count: snapshot.primary_binding_count,
    secondary_binding_count: snapshot.secondary_binding_count,
    target_count: snapshot.bindings.length,
  };
}

function assertInventoryMatchesManifest(
  snapshot: KusabiFleetInventorySnapshot,
  manifest: KusabiFleetManifest,
): void {
  assertKusabiFleetInventorySnapshot(snapshot);
  assertKusabiFleetManifest(manifest);
  const inventoryKeys = snapshot.bindings.map(({ binding_key }) => binding_key).sort();
  const manifestKeys = manifest.targets.map((target) => kusabiFleetInventoryBindingKey({
    canonical_agent_id: target.identity.agent_id,
    project: target.identity.project,
    host_runtime: target.identity.host_runtime,
    workspace_sha256: target.identity.workspace_sha256,
    binding_source_ref_sha256: target.expected.configuration.binding_source_ref_sha256,
  })).sort();
  if (canonicalJson(inventoryKeys) !== canonicalJson(manifestKeys)) {
    fail("KUSABI_FLEET_INVENTORY_MANIFEST_MISMATCH");
  }
}

export function kusabiFleetRolloutPlanSha256(plan: KusabiFleetRolloutPlan): string {
  return sha256(canonicalJson({
    schema_version: plan.schema_version,
    rollout_id: plan.rollout_id,
    manifest: plan.manifest,
    implementation: plan.implementation,
    inventory: plan.inventory,
    batches: plan.batches,
  }));
}

export function kusabiFleetRolloutAuthorizationSha256(
  authorization: KusabiFleetRolloutAuthorization,
): string {
  return sha256(canonicalJson({
    schema_version: authorization.schema_version,
    decision_id: authorization.decision_id,
    approved: authorization.approved,
    implementation_head_sha: authorization.implementation_head_sha,
    implementation_tree_sha: authorization.implementation_tree_sha,
    manifest_sha256: authorization.manifest_sha256,
    rollout_plan_sha256: authorization.rollout_plan_sha256,
    decision_ref_sha256: authorization.decision_ref_sha256,
  }));
}

export function sealKusabiFleetRolloutAuthorization(
  value: Omit<KusabiFleetRolloutAuthorization, "authorization_sha256">,
): KusabiFleetRolloutAuthorization {
  const authorization = { ...value, authorization_sha256: "0".repeat(64) };
  authorization.authorization_sha256 = kusabiFleetRolloutAuthorizationSha256(authorization);
  assertKusabiFleetRolloutAuthorization(authorization);
  return authorization;
}

export function assertKusabiFleetRolloutAuthorization(
  value: unknown,
): asserts value is KusabiFleetRolloutAuthorization {
  if (!isRecord(value) || !exactKeys(value, [
    "schema_version", "decision_id", "approved", "implementation_head_sha",
    "implementation_tree_sha", "manifest_sha256", "rollout_plan_sha256",
    "decision_ref_sha256", "authorization_sha256",
  ])) fail("KUSABI_FLEET_AUTHORIZATION_INVALID");
  if (
    value.schema_version !== "kusabi-fleet-rollout-authorization/v1" ||
    !boundedId(value.decision_id) || value.approved !== true ||
    !gitSha(value.implementation_head_sha) || !gitSha(value.implementation_tree_sha) ||
    !sha256Value(value.manifest_sha256) || !sha256Value(value.rollout_plan_sha256) ||
    !sha256Value(value.decision_ref_sha256) || !sha256Value(value.authorization_sha256)
  ) fail("KUSABI_FLEET_AUTHORIZATION_INVALID");
  const authorization = value as unknown as KusabiFleetRolloutAuthorization;
  if (kusabiFleetRolloutAuthorizationSha256(authorization) !== authorization.authorization_sha256) {
    fail("KUSABI_FLEET_AUTHORIZATION_HASH_MISMATCH");
  }
}

export function assertKusabiFleetRolloutPlan(
  value: unknown,
  manifest?: KusabiFleetManifest,
  inventorySnapshot?: KusabiFleetInventorySnapshot,
): asserts value is KusabiFleetRolloutPlan {
  if (!isRecord(value) || !exactKeys(value, [
    "schema_version", "rollout_id", "manifest", "implementation", "inventory", "batches", "rollout_plan_sha256",
  ])) fail("KUSABI_FLEET_ROLLOUT_PLAN_INVALID");
  if (
    value.schema_version !== "kusabi-fleet-rollout-plan/v1" || !boundedId(value.rollout_id) ||
    !sha256Value(value.rollout_plan_sha256) || !isRecord(value.manifest) ||
    !exactKeys(value.manifest, ["manifest_id", "version", "manifest_sha256", "target_count"]) ||
    !boundedId(value.manifest.manifest_id) || !positiveInteger(value.manifest.version) ||
    !sha256Value(value.manifest.manifest_sha256) || !positiveInteger(value.manifest.target_count) ||
    !isRecord(value.implementation) || !exactKeys(value.implementation, ["commit_sha", "tree_sha"]) ||
    !gitSha(value.implementation.commit_sha) || !gitSha(value.implementation.tree_sha) ||
    !isRecord(value.inventory) || !exactKeys(value.inventory, [
      "snapshot_sha256", "query_contract_sha256", "primary_result_sha256",
      "primary_binding_count", "secondary_binding_count", "target_count",
    ]) || !sha256Value(value.inventory.snapshot_sha256) ||
    value.inventory.query_contract_sha256 !== KUSABI_FLEET_INVENTORY_QUERY_CONTRACT_SHA256 ||
    !sha256Value(value.inventory.primary_result_sha256) ||
    !nonNegativeInteger(value.inventory.primary_binding_count) ||
    !nonNegativeInteger(value.inventory.secondary_binding_count) ||
    !positiveInteger(value.inventory.target_count) ||
    Number(value.inventory.primary_binding_count) + Number(value.inventory.secondary_binding_count) !==
      Number(value.inventory.target_count) ||
    !Array.isArray(value.batches) || value.batches.length < 1
  ) fail("KUSABI_FLEET_ROLLOUT_PLAN_INVALID");

  const seenBatchIds = new Set<string>();
  const seenTargets = new Set<string>();
  let previousRank = 0;
  let previousOrdinal = 0;
  for (const rawBatch of value.batches) {
    if (!isRecord(rawBatch) || !exactKeys(rawBatch, [
      "batch_id", "stage", "ordinal", "minimum_soak_seconds", "target_keys",
    ])) fail("KUSABI_FLEET_ROLLOUT_PLAN_INVALID");
    if (
      !boundedId(rawBatch.batch_id) || !(rawBatch.stage === "r1" || rawBatch.stage === "r2" || rawBatch.stage === "r3") ||
      !positiveInteger(rawBatch.ordinal) || !nonNegativeInteger(rawBatch.minimum_soak_seconds) ||
      !Array.isArray(rawBatch.target_keys) || rawBatch.target_keys.length < 1 ||
      !rawBatch.target_keys.every(sha256Value)
    ) fail("KUSABI_FLEET_ROLLOUT_PLAN_INVALID");
    if (seenBatchIds.has(rawBatch.batch_id)) fail("KUSABI_FLEET_ROLLOUT_DUPLICATE_BATCH");
    seenBatchIds.add(rawBatch.batch_id);
    const rank = STAGE_ORDER[rawBatch.stage];
    if (rank < previousRank || (rank === previousRank && rawBatch.ordinal <= previousOrdinal)) {
      fail("KUSABI_FLEET_ROLLOUT_BATCH_ORDER_INVALID");
    }
    if (!strictlySorted(rawBatch.target_keys as string[])) fail("KUSABI_FLEET_ROLLOUT_TARGET_ORDER_INVALID");
    for (const targetKey of rawBatch.target_keys as string[]) {
      if (seenTargets.has(targetKey)) fail("KUSABI_FLEET_ROLLOUT_DUPLICATE_TARGET");
      seenTargets.add(targetKey);
    }
    previousRank = rank;
    previousOrdinal = rawBatch.ordinal as number;
  }
  if (![...(["r1", "r2", "r3"] as const)].every((stage) =>
    (value.batches as unknown as KusabiFleetRolloutBatch[]).some((batch) => batch.stage === stage))) {
    fail("KUSABI_FLEET_ROLLOUT_STAGE_MISSING");
  }
  if (seenTargets.size !== value.manifest.target_count || seenTargets.size !== value.inventory.target_count) {
    fail("KUSABI_FLEET_ROLLOUT_TARGET_COUNT_MISMATCH");
  }
  const plan = value as unknown as KusabiFleetRolloutPlan;
  if (kusabiFleetRolloutPlanSha256(plan) !== plan.rollout_plan_sha256) {
    fail("KUSABI_FLEET_ROLLOUT_PLAN_HASH_MISMATCH");
  }
  if (manifest) {
    assertKusabiFleetManifest(manifest);
    const manifestKeys = [...manifest.targets.map(({ target_key }) => target_key)].sort();
    const planKeys = [...seenTargets].sort();
    if (
      manifest.manifest_id !== plan.manifest.manifest_id || manifest.version !== plan.manifest.version ||
      manifest.manifest_sha256 !== plan.manifest.manifest_sha256 || manifest.targets.length !== plan.manifest.target_count ||
      canonicalJson(manifestKeys) !== canonicalJson(planKeys)
    ) fail("KUSABI_FLEET_ROLLOUT_MANIFEST_MISMATCH");
  }
  if (inventorySnapshot) {
    assertKusabiFleetInventorySnapshot(inventorySnapshot);
    if (canonicalJson(plan.inventory) !== canonicalJson(inventorySummary(inventorySnapshot))) {
      fail("KUSABI_FLEET_ROLLOUT_INVENTORY_MISMATCH");
    }
    if (!manifest) fail("KUSABI_FLEET_ROLLOUT_INVENTORY_MANIFEST_REQUIRED");
    assertInventoryMatchesManifest(inventorySnapshot, manifest);
  }
}

export async function prepareKusabiFleetR0(options: KusabiFleetR0Options): Promise<KusabiFleetR0Result> {
  validateR0Options(options);
  const runtimeRoot = await safeRealpath(options.runtime_root, "KUSABI_FLEET_RUNTIME_ROOT_INVALID");
  const prepared = await Promise.all(options.targets.map((target) => prepareTarget(target, runtimeRoot)));
  const targetKeys = new Set(prepared.map(({ targetKey }) => targetKey));
  if (targetKeys.size !== prepared.length) fail("KUSABI_FLEET_R0_DUPLICATE_TARGET");

  const manifest: KusabiFleetManifest = {
    schema_version: "kusabi-fleet-manifest/v1",
    manifest_id: options.manifest_id,
    version: options.manifest_version,
    manifest_sha256: "0".repeat(64),
    targets: prepared.map((target) => ({
      target_key: target.targetKey,
      identity: {
        agent_id: target.input.agent_id,
        project: target.input.project,
        host_runtime: target.input.host_runtime,
        workspace_sha256: sha256(target.workspace),
      },
      expected: {
        build: {
          commit_sha: options.commit_sha,
          tree_sha: options.tree_sha,
          artifact_sha256: target.artifactSha256,
          adapter_version: target.adapterVersion,
        },
        configuration: {
          config_sha256: target.desiredSha256,
          trust_fingerprint_sha256: target.expectedTrustFingerprint,
          binding_source_ref_sha256: sha256(target.input.binding_source_ref),
        },
        storage: target.input.storage,
      },
      activation_at: options.activation_at,
      durable_evidence_deadline_at: options.durable_evidence_deadline_at,
      stale_after_seconds: options.stale_after_seconds,
      maintenance_windows: target.input.maintenance_windows ?? [],
    })).sort((left, right) => left.target_key.localeCompare(right.target_key)),
  };
  manifest.manifest_sha256 = kusabiFleetManifestSha256(manifest);
  assertKusabiFleetManifest(manifest);
  assertInventoryMatchesManifest(options.inventory_snapshot, manifest);

  const assignments = new Map(prepared.map(({ targetKey, input }) => [targetKey, input.batch_id]));
  const batches: KusabiFleetRolloutBatch[] = options.batch_order.map((batch) => ({
    ...batch,
    target_keys: [...assignments.entries()]
      .filter(([, batchId]) => batchId === batch.batch_id)
      .map(([targetKey]) => targetKey)
      .sort(),
  }));
  if (batches.some(({ target_keys }) => target_keys.length === 0)) fail("KUSABI_FLEET_R0_EMPTY_BATCH");
  for (const target of prepared) {
    const batch = options.batch_order.find(({ batch_id }) => batch_id === target.input.batch_id);
    if (!batch || batch.stage !== target.input.stage) fail("KUSABI_FLEET_R0_BATCH_ASSIGNMENT_MISMATCH");
  }
  const rolloutPlan: KusabiFleetRolloutPlan = {
    schema_version: "kusabi-fleet-rollout-plan/v1",
    rollout_id: options.rollout_id,
    manifest: {
      manifest_id: manifest.manifest_id,
      version: manifest.version,
      manifest_sha256: manifest.manifest_sha256,
      target_count: manifest.targets.length,
    },
    implementation: { commit_sha: options.commit_sha, tree_sha: options.tree_sha },
    inventory: inventorySummary(options.inventory_snapshot),
    batches,
    rollout_plan_sha256: "0".repeat(64),
  };
  rolloutPlan.rollout_plan_sha256 = kusabiFleetRolloutPlanSha256(rolloutPlan);
  assertKusabiFleetRolloutPlan(rolloutPlan, manifest, options.inventory_snapshot);

  const evidenceTargets: KusabiFleetR0TargetEvidence[] = prepared.map((target) => ({
    target_key: target.targetKey,
    host_runtime: target.input.host_runtime,
    batch_id: target.input.batch_id,
    config_locator_sha256: sha256(target.snapshot.configPath),
    preimage_state: target.snapshot.state,
    preimage_sha256: target.snapshot.sha256,
    preimage_mode: target.snapshot.mode,
    expected_postimage_sha256: target.desiredSha256,
    artifact_sha256: target.artifactSha256,
    trust_source_locator_sha256: target.trustSourceLocatorSha256,
    preimage_trust_fingerprint_sha256: target.observedTrustFingerprint,
    expected_trust_fingerprint_sha256: target.expectedTrustFingerprint,
    preimage_trust_exact: target.observedTrustExact,
    rollback_required: target.snapshot.raw !== target.desiredRaw,
  })).sort((left, right) => left.target_key.localeCompare(right.target_key));
  const report: KusabiFleetR0Report = {
    schema_version: "kusabi-fleet-r0-report/v1",
    captured_at: options.captured_at,
    manifest: rolloutPlan.manifest,
    inventory: rolloutPlan.inventory,
    rollout_plan_sha256: rolloutPlan.rollout_plan_sha256,
    target_count: evidenceTargets.length,
    targets: evidenceTargets,
    forbidden_value_count: 0,
    production_mutation_count: 0,
    report_sha256: "0".repeat(64),
  };
  report.report_sha256 = sha256(canonicalJson({ ...report, report_sha256: undefined }));
  return { inventory_snapshot: options.inventory_snapshot, manifest, rollout_plan: rolloutPlan, report };
}

export async function observeKusabiFleetDeployment(
  input: KusabiFleetDeploymentObservationInput,
): Promise<KusabiFleetObservedTarget> {
  assertKusabiFleetManifest({
    schema_version: "kusabi-fleet-manifest/v1",
    manifest_id: "observation-validation",
    version: 1,
    manifest_sha256: kusabiFleetManifestSha256({
      schema_version: "kusabi-fleet-manifest/v1",
      manifest_id: "observation-validation",
      version: 1,
      manifest_sha256: "0".repeat(64),
      targets: [input.target],
    }),
    targets: [input.target],
  });
  requireTimestamp(input.observed_at, "KUSABI_FLEET_OBSERVATION_TIME_INVALID");
  requireGitSha(input.observed_commit_sha, "KUSABI_FLEET_OBSERVED_BUILD_INVALID");
  requireGitSha(input.observed_tree_sha, "KUSABI_FLEET_OBSERVED_BUILD_INVALID");
  requireStorage(input.observed_storage);
  const workspace = await safeRealpath(input.workspace, "KUSABI_FLEET_WORKSPACE_INVALID");
  const runtimeRoot = await safeRealpath(input.runtime_root, "KUSABI_FLEET_RUNTIME_ROOT_INVALID");
  const identity: KusabiFleetIdentity = {
    agent_id: input.target.identity.agent_id,
    project: input.target.identity.project,
    host_runtime: input.target.identity.host_runtime,
    workspace_sha256: sha256(workspace),
  };
  if (kusabiFleetTargetKey(identity) !== input.target.target_key) fail("KUSABI_FLEET_OBSERVED_TARGET_MISMATCH");
  const snapshot = await readConfigSnapshot(workspace, input.target.identity.host_runtime);
  if (snapshot.raw === null || snapshot.sha256 === null) fail("KUSABI_FLEET_OBSERVED_CONFIG_ABSENT");
  const expectedBinding = bindingFor(input.target.identity, workspace, input.binding_source_ref);
  const managedBindingExact = managedBindingMatches(
    input.target.identity.host_runtime,
    snapshot.raw,
    runtimeRoot,
    expectedBinding,
  );
  const artifactSha256 = await readArtifactSha256(runtimeRoot, input.target.identity.host_runtime);
  const trust = await observeTrustFingerprint(
    input.target.identity.host_runtime,
    input.target.target_key,
    identity.workspace_sha256,
    snapshot.configPath,
    snapshot.raw,
    input.trust_source,
  );
  const deployment: KusabiFleetDeploymentIdentity = {
    build: {
      commit_sha: input.observed_commit_sha,
      tree_sha: input.observed_tree_sha,
      artifact_sha256: artifactSha256,
      adapter_version: adapterVersion(input.target.identity.host_runtime),
    },
    configuration: {
      config_sha256: snapshot.sha256,
      trust_fingerprint_sha256: trust.fingerprint,
      binding_source_ref_sha256: sha256(input.binding_source_ref),
    },
    storage: input.observed_storage,
  };
  const configExact = deployment.configuration.config_sha256 === input.target.expected.configuration.config_sha256;
  const buildExact = canonicalJson(deployment.build) === canonicalJson(input.target.expected.build);
  const trustExact = trust.verified && deployment.configuration.trust_fingerprint_sha256 ===
    input.target.expected.configuration.trust_fingerprint_sha256;
  const storageExact = input.storage_observed !== false &&
    canonicalJson(deployment.storage) === canonicalJson(input.target.expected.storage);
  const withoutHash = {
    schema_version: "kusabi-fleet-observed-target/v1" as const,
    observed_at: input.observed_at,
    target_key: input.target.target_key,
    deployment,
    config_locator_sha256: sha256(snapshot.configPath),
    managed_binding_exact: managedBindingExact,
    config_exact: configExact,
    build_exact: buildExact,
    trust_exact: trustExact,
    storage_exact: storageExact,
    exact: managedBindingExact && configExact && buildExact && trustExact && storageExact &&
      deployment.configuration.binding_source_ref_sha256 === input.target.expected.configuration.binding_source_ref_sha256,
  };
  return { ...withoutHash, observation_sha256: sha256(canonicalJson(withoutHash)) };
}

export function evaluateKusabiFleetBatchGate(
  plan: KusabiFleetRolloutPlan,
  manifest: KusabiFleetManifest,
  batchId: string,
  observations: KusabiFleetObservedTarget[],
  status: KusabiFleetStatusSnapshot,
  priorGateReports: KusabiFleetBatchGateReport[] = [],
  batchStartedAt?: string,
): KusabiFleetBatchGateReport {
  assertKusabiFleetRolloutPlan(plan, manifest);
  const batch = plan.batches.find(({ batch_id }) => batch_id === batchId);
  if (!batch) fail("KUSABI_FLEET_BATCH_UNKNOWN");
  if (!validateKusabiFleetStatus(status).valid) fail("KUSABI_FLEET_GATE_STATUS_INVALID");
  const manifestKeys = manifest.targets.map(({ target_key }) => target_key).sort();
  const statusKeys = status.targets.map(({ target_key }) => target_key).sort();
  if (
    status.manifest.manifest_id !== manifest.manifest_id || status.manifest.version !== manifest.version ||
    status.manifest.manifest_sha256 !== manifest.manifest_sha256 ||
    status.manifest.target_count !== manifest.targets.length ||
    canonicalJson(manifestKeys) !== canonicalJson(statusKeys)
  ) fail("KUSABI_FLEET_GATE_STATUS_MANIFEST_MISMATCH");
  const openP0 = status.alerts.filter((alert) => alert.severity === "P0" &&
    (alert.status === "open" || alert.status === "acknowledged")).length;
  const openP1 = status.alerts.filter((alert) => alert.severity === "P1" &&
    (alert.status === "open" || alert.status === "acknowledged")).length;
  if (openP0 !== status.summary.open_p0_count || openP1 !== status.summary.open_p1_count) {
    fail("KUSABI_FLEET_GATE_STATUS_SUMMARY_MISMATCH");
  }
  const blockers: string[] = [];
  let soakElapsedSeconds = 0;
  if (batch.minimum_soak_seconds > 0) {
    if (batchStartedAt === undefined) {
      blockers.push("batch_start_not_observed");
    } else {
      requireTimestamp(batchStartedAt, "KUSABI_FLEET_GATE_BATCH_START_INVALID");
      requireTimestamp(status.generated_at, "KUSABI_FLEET_GATE_STATUS_TIME_INVALID");
      soakElapsedSeconds = Math.max(0, Math.floor((Date.parse(status.generated_at) - Date.parse(batchStartedAt)) / 1000));
      if (soakElapsedSeconds < batch.minimum_soak_seconds) blockers.push("minimum_soak_not_met");
    }
  }
  const observationMap = uniqueByTarget(observations, "KUSABI_FLEET_GATE_DUPLICATE_OBSERVATION");
  const statusMap = new Map(status.targets.map((target) => [target.target_key, target]));
  let exactObservedCount = 0;
  let healthyDurableCount = 0;
  for (const targetKey of batch.target_keys) {
    const observation = observationMap.get(targetKey);
    const targetStatus = statusMap.get(targetKey);
    if (observation?.exact) exactObservedCount++;
    else blockers.push(`target_not_exact:${targetKey}`);
    const observerStatusIdentityExact = observation !== undefined && targetStatus?.observed !== null &&
      targetStatus?.observed !== undefined &&
      canonicalJson(observation.deployment) === canonicalJson(targetStatus.observed.deployment);
    if (!observerStatusIdentityExact) blockers.push(`observer_status_identity_mismatch:${targetKey}`);
    if (targetStatus?.state === "healthy" && targetStatus.observed?.evidence_delivery === "durable") {
      healthyDurableCount++;
    } else blockers.push(`target_not_healthy_durable:${targetKey}`);
  }
  const earlierBatches = plan.batches.slice(0, plan.batches.findIndex(({ batch_id }) => batch_id === batchId));
  const priorMap = new Map(priorGateReports.map((report) => [report.batch_id, report]));
  for (const earlier of earlierBatches) {
    const report = priorMap.get(earlier.batch_id);
    if (!report || report.verdict !== "PASS" || report.rollout_plan_sha256 !== plan.rollout_plan_sha256 ||
      report.manifest_sha256 !== manifest.manifest_sha256) {
      blockers.push(`prior_batch_not_passed:${earlier.batch_id}`);
    }
  }
  if (status.summary.open_p0_count > 0) blockers.push("open_p0");
  if (status.summary.open_p1_count > 0) blockers.push("open_p1");
  blockers.sort();
  const withoutHash = {
    schema_version: "kusabi-fleet-batch-gate/v1" as const,
    rollout_plan_sha256: plan.rollout_plan_sha256,
    manifest_sha256: manifest.manifest_sha256,
    batch_id: batch.batch_id,
    stage: batch.stage,
    target_count: batch.target_keys.length,
    exact_observed_count: exactObservedCount,
    healthy_durable_count: healthyDurableCount,
    soak_elapsed_seconds: soakElapsedSeconds,
    minimum_soak_seconds: batch.minimum_soak_seconds,
    open_p0_count: status.summary.open_p0_count,
    open_p1_count: status.summary.open_p1_count,
    verdict: blockers.length === 0 ? "PASS" as const : "BLOCKED" as const,
    blockers,
  };
  return { ...withoutHash, report_sha256: sha256(canonicalJson(withoutHash)) };
}

export async function applyKusabiFleetRolloutBatch(
  options: KusabiFleetApplyBatchOptions,
): Promise<KusabiFleetApplyBatchReport> {
  assertKusabiFleetRolloutPlan(options.plan, options.manifest, options.inventory_snapshot);
  assertKusabiFleetRolloutAuthorization(options.authorization);
  assertAuthorizationMatches(options.authorization, options.plan, options.manifest);
  const batch = options.plan.batches.find(({ batch_id }) => batch_id === options.batch_id);
  if (!batch) fail("KUSABI_FLEET_BATCH_UNKNOWN");
  const earlierBatches = options.plan.batches.slice(0,
    options.plan.batches.findIndex(({ batch_id }) => batch_id === options.batch_id));
  const priorMap = new Map((options.prior_gate_reports ?? []).map((report) => [report.batch_id, report]));
  for (const earlier of earlierBatches) {
    const report = priorMap.get(earlier.batch_id);
    if (!report || report.verdict !== "PASS" || report.rollout_plan_sha256 !== options.plan.rollout_plan_sha256 ||
      report.manifest_sha256 !== options.manifest.manifest_sha256) {
      fail("KUSABI_FLEET_PRIOR_BATCH_GATE_REQUIRED");
    }
  }
  const runtimeRoot = await safeRealpath(options.runtime_root, "KUSABI_FLEET_RUNTIME_ROOT_INVALID");
  const manifestMap = new Map(options.manifest.targets.map((target) => [target.target_key, target]));
  const preparedInputs = await Promise.all(options.targets.map((target) => prepareTarget(target, runtimeRoot)));
  const inputMap = new Map(preparedInputs.map((target) => [target.targetKey, target]));
  const rollbacks: Array<{ snapshot: ConfigSnapshot; expectedPostimageSha256: string }> = [];
  const targetResults: KusabiFleetApplyBatchReport["target_results"] = [];
  try {
    for (const targetKey of batch.target_keys) {
      const prepared = inputMap.get(targetKey);
      const manifestTarget = manifestMap.get(targetKey);
      if (!prepared || !manifestTarget || prepared.input.batch_id !== batch.batch_id ||
        prepared.desiredSha256 !== manifestTarget.expected.configuration.config_sha256 ||
        prepared.artifactSha256 !== manifestTarget.expected.build.artifact_sha256) {
        fail("KUSABI_FLEET_APPLY_TARGET_MISMATCH");
      }
      rollbacks.push({ snapshot: prepared.snapshot, expectedPostimageSha256: prepared.desiredSha256 });
      const report = await installForHost(prepared.input, runtimeRoot, prepared.workspace, "apply");
      if (prepared.snapshot.mode !== null) {
        await chmod(prepared.snapshot.configPath, Number.parseInt(prepared.snapshot.mode, 8));
      }
      const postimage = await readConfigSnapshot(prepared.workspace, prepared.input.host_runtime);
      if (postimage.raw === null || postimage.sha256 !== prepared.desiredSha256) {
        fail("KUSABI_FLEET_APPLY_POSTIMAGE_MISMATCH");
      }
      targetResults.push({
        target_key: targetKey,
        preimage_sha256: prepared.snapshot.sha256,
        postimage_sha256: postimage.sha256,
        wrote_config: wroteConfig(report),
      });
    }
  } catch (error) {
    for (const rollback of [...rollbacks].reverse()) {
      await restoreConfigSnapshot(rollback.snapshot, rollback.expectedPostimageSha256);
    }
    if (error instanceof KusabiFleetRolloutError) throw error;
    fail("KUSABI_FLEET_APPLY_FAILED_ROLLED_BACK");
  }
  const withoutHash = {
    schema_version: "kusabi-fleet-apply-batch-report/v1" as const,
    rollout_plan_sha256: options.plan.rollout_plan_sha256,
    manifest_sha256: options.manifest.manifest_sha256,
    batch_id: batch.batch_id,
    attempted_count: batch.target_keys.length,
    placed_count: targetResults.length,
    rolled_back: false,
    target_results: targetResults,
  };
  return { ...withoutHash, report_sha256: sha256(canonicalJson(withoutHash)) };
}

async function prepareTarget(input: KusabiFleetRolloutTargetInput, runtimeRoot: string): Promise<PreparedTarget> {
  validateTargetInput(input);
  const workspace = await safeRealpath(input.workspace, "KUSABI_FLEET_WORKSPACE_INVALID");
  const identity: KusabiFleetIdentity = {
    agent_id: input.agent_id,
    project: input.project,
    host_runtime: input.host_runtime,
    workspace_sha256: sha256(workspace),
  };
  const snapshot = await readConfigSnapshot(workspace, input.host_runtime);
  const desiredRaw = desiredConfigRaw(input.host_runtime, snapshot.raw,
    runtimeRoot, bindingFor(identity, workspace, input.binding_source_ref));
  const expectedTrust = expectedTrustFingerprint(
    input.host_runtime,
    kusabiFleetTargetKey(identity),
    identity.workspace_sha256,
    desiredRaw,
  );
  const observedTrust = await observeTrustFingerprint(
    input.host_runtime,
    kusabiFleetTargetKey(identity),
    identity.workspace_sha256,
    snapshot.configPath,
    desiredRaw,
    input.trust_source,
  );
  return {
    input,
    workspace,
    targetKey: kusabiFleetTargetKey(identity),
    snapshot,
    desiredRaw,
    desiredSha256: sha256(desiredRaw),
    artifactSha256: await readArtifactSha256(runtimeRoot, input.host_runtime),
    adapterVersion: adapterVersion(input.host_runtime),
    expectedTrustFingerprint: expectedTrust,
    observedTrustFingerprint: observedTrust.fingerprint,
    observedTrustExact: observedTrust.verified,
    trustSourceLocatorSha256: trustSourceLocatorSha256(input.trust_source),
  };
}

function trustSourceLocatorSha256(source: KusabiFleetTrustSource): string {
  if (source.kind === "codex_hook_state") {
    return sha256(canonicalCompactJson({ kind: source.kind, config_toml_sha256: sha256(source.config_toml) }));
  }
  if (source.kind === "claude_project_state") {
    return sha256(canonicalCompactJson({
      kind: source.kind,
      claude_state_json_sha256: sha256(source.claude_state_json),
    }));
  }
  return sha256(canonicalCompactJson({
    kind: source.kind,
    trusted_folders_json_sha256: sha256(source.trusted_folders_json),
    trusted_hooks_json_sha256: sha256(source.trusted_hooks_json),
  }));
}

function desiredConfigRaw(
  host: KusabiHostRuntime,
  raw: string | null,
  runtimeRoot: string,
  binding: CodexSessionStartBinding | ClaudeSessionStartBinding | GeminiSessionStartBinding,
): string {
  if (host === "codex") {
    const parsed = raw === null
      ? parseHooksFile('{"description":"Lifecycle hooks for this workspace.","hooks":{}}')
      : parseHooksFile(raw);
    const desired = canonicalJson(
      mergeCodexSessionStartHook(parsed, runtimeRoot, binding as CodexSessionStartBinding).hooksFile,
    );
    return raw !== null && canonicalJson(parsed) === desired ? raw : desired;
  }
  if (host === "claude_code") {
    const parsed = raw === null ? parseClaudeSettings('{"hooks":{}}') : parseClaudeSettings(raw);
    const desired = canonicalJson(
      mergeClaudeSessionStartHook(parsed, runtimeRoot, binding as ClaudeSessionStartBinding).settings,
    );
    return raw !== null && canonicalJson(parsed) === desired ? raw : desired;
  }
  const parsed = raw === null ? parseGeminiSettings('{"hooks":{}}') : parseGeminiSettings(raw);
  const desired = canonicalJson(
    mergeGeminiSessionStartHooks(parsed, runtimeRoot, binding as GeminiSessionStartBinding).settings,
  );
  return raw !== null && canonicalJson(parsed) === desired ? raw : desired;
}

function expectedTrustFingerprint(
  host: KusabiHostRuntime,
  targetKey: string,
  workspaceSha256: string,
  configRaw: string,
): string {
  if (host === "codex") {
    const entries = codexHookTrustEntries(configRaw);
    if (entries.length !== 1) fail("KUSABI_FLEET_CODEX_TRUST_IDENTITY_INVALID");
    return sha256(canonicalCompactJson({
      schema_version: "kusabi-codex-hook-trust/v1",
      target_key: targetKey,
      hook_hash: entries[0].currentHash,
    }));
  }
  if (host === "claude_code") {
    return sha256(canonicalCompactJson({
      schema_version: "kusabi-claude-project-trust/v1",
      target_key: targetKey,
      workspace_sha256: workspaceSha256,
      trusted: true,
    }));
  }
  const commandHashes = geminiManagedCommands(configRaw).map(sha256).sort();
  if (commandHashes.length !== 1) fail("KUSABI_FLEET_GEMINI_TRUST_IDENTITY_INVALID");
  return sha256(canonicalCompactJson({
    schema_version: "kusabi-gemini-hook-trust/v1",
    target_key: targetKey,
    workspace_sha256: workspaceSha256,
    trusted_command_sha256: commandHashes,
  }));
}

async function observeTrustFingerprint(
  host: KusabiHostRuntime,
  targetKey: string,
  workspaceSha256: string,
  configPath: string,
  configRaw: string,
  source: KusabiFleetTrustSource,
): Promise<{ fingerprint: string; verified: boolean }> {
  const expected = expectedTrustFingerprint(host, targetKey, workspaceSha256, configRaw);
  let verified = false;
  if (host === "codex") {
    if (source.kind !== "codex_hook_state") fail("KUSABI_FLEET_TRUST_SOURCE_MISMATCH");
    const state = await readTrustFile(source.config_toml, "KUSABI_FLEET_CODEX_TRUST_STATE_INVALID");
    const entries = codexHookTrustEntries(configRaw);
    verified = entries.length === 1 && entries.every((entry) => {
      const key = `${configPath}:session_start:${entry.groupIndex}:${entry.handlerIndex}`;
      return codexTrustedHash(state, key) === entry.currentHash;
    });
  } else if (host === "claude_code") {
    if (source.kind !== "claude_project_state") fail("KUSABI_FLEET_TRUST_SOURCE_MISMATCH");
    const state = parseJsonObject(await readTrustFile(
      source.claude_state_json,
      "KUSABI_FLEET_CLAUDE_TRUST_STATE_INVALID",
    ), "KUSABI_FLEET_CLAUDE_TRUST_STATE_INVALID");
    const projects = state.projects;
    const workspace = isRecord(projects) ? projects[dirname(dirname(configPath))] : undefined;
    verified = isRecord(workspace) && workspace.hasTrustDialogAccepted === true;
  } else {
    if (source.kind !== "gemini_hook_state") fail("KUSABI_FLEET_TRUST_SOURCE_MISMATCH");
    const folders = parseJsonObject(await readTrustFile(
      source.trusted_folders_json,
      "KUSABI_FLEET_GEMINI_TRUST_STATE_INVALID",
    ), "KUSABI_FLEET_GEMINI_TRUST_STATE_INVALID");
    const trustedHooks = parseJsonObject(await readTrustFile(
      source.trusted_hooks_json,
      "KUSABI_FLEET_GEMINI_TRUST_STATE_INVALID",
    ), "KUSABI_FLEET_GEMINI_TRUST_STATE_INVALID");
    const workspace = dirname(dirname(configPath));
    const commands = geminiManagedCommands(configRaw);
    const observedCommands = trustedHooks[workspace];
    verified = folders[workspace] === "TRUST_FOLDER" && Array.isArray(observedCommands) &&
      commands.every((command) => observedCommands.includes(command));
  }
  return {
    fingerprint: verified ? expected : sha256(canonicalCompactJson({
      schema_version: "kusabi-untrusted-observation/v1",
      target_key: targetKey,
      host_runtime: host,
    })),
    verified,
  };
}

interface CodexHookTrustEntry {
  groupIndex: number;
  handlerIndex: number;
  currentHash: string;
}

export function kusabiCodexHookTrustRecords(configRaw: string): Array<{
  group_index: number;
  handler_index: number;
  current_hash: string;
}> {
  return codexHookTrustEntries(configRaw).map((entry) => ({
    group_index: entry.groupIndex,
    handler_index: entry.handlerIndex,
    current_hash: entry.currentHash,
  }));
}

function codexHookTrustEntries(configRaw: string): CodexHookTrustEntry[] {
  // Pinned reproduction of OpenAI Codex command_hook_hash/version_for_toml at
  // commit 6751b54cae32b23786001e2414d749a9916201e1. Read-only verification only.
  const parsed = parseHooksFile(configRaw);
  const entries: CodexHookTrustEntry[] = [];
  for (const [groupIndex, group] of (parsed.hooks.SessionStart ?? []).entries()) {
    for (const [handlerIndex, handler] of group.hooks.entries()) {
      if (!isRecord(handler) || typeof handler.command !== "string" ||
        parseCodexHookCommand(handler.command) === null) continue;
      const normalizedHandler: Record<string, unknown> = {
        type: "command",
        command: handler.command,
        timeout: Math.max(1, Number.isInteger(handler.timeout) ? Number(handler.timeout) : 600),
        async: handler.async === true,
      };
      if (typeof handler.statusMessage === "string") normalizedHandler.statusMessage = handler.statusMessage;
      if (Number.isInteger(handler.additionalContextLimit) && Number(handler.additionalContextLimit) !== 2_500) {
        normalizedHandler.additionalContextLimit = Number(handler.additionalContextLimit);
      }
      const identity: Record<string, unknown> = {
        event_name: "session_start",
        hooks: [normalizedHandler],
      };
      if (typeof group.matcher === "string") identity.matcher = group.matcher;
      entries.push({
        groupIndex,
        handlerIndex,
        currentHash: `sha256:${sha256(canonicalCompactJson(identity))}`,
      });
    }
  }
  return entries;
}

function geminiManagedCommands(configRaw: string): string[] {
  const parsed = parseGeminiSettings(configRaw);
  const commands = new Set<string>();
  for (const group of parsed.hooks.SessionStart ?? []) {
    for (const handler of group.hooks) {
      if (isRecord(handler) && typeof handler.command === "string" &&
        parseGeminiHookCommand(handler.command) !== null) commands.add(handler.command);
    }
  }
  return [...commands].sort();
}

function codexTrustedHash(configToml: string, expectedKey: string): string | null {
  let active = false;
  let result: string | null = null;
  for (const line of configToml.split(/\r?\n/)) {
    const header = line.match(/^\s*\[hooks\.state\."((?:[^"\\]|\\.)*)"\]\s*$/);
    if (header) {
      let key: string;
      try {
        key = JSON.parse(`"${header[1]}"`) as string;
      } catch {
        fail("KUSABI_FLEET_CODEX_TRUST_STATE_INVALID");
      }
      active = key === expectedKey;
      continue;
    }
    if (/^\s*\[/.test(line)) {
      active = false;
      continue;
    }
    if (!active) continue;
    const trusted = line.match(/^\s*trusted_hash\s*=\s*"(sha256:[a-f0-9]{64})"\s*$/);
    if (trusted) {
      if (result !== null) fail("KUSABI_FLEET_CODEX_TRUST_STATE_INVALID");
      result = trusted[1];
    }
  }
  return result;
}

async function readTrustFile(path: string, code: string): Promise<string> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) fail(code);
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof KusabiFleetRolloutError) throw error;
    fail(code);
  }
}

function parseJsonObject(raw: string, code: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) fail(code);
    return value;
  } catch (error) {
    if (error instanceof KusabiFleetRolloutError) throw error;
    fail(code);
  }
}

function managedBindingMatches(
  host: KusabiHostRuntime,
  raw: string,
  runtimeRoot: string,
  expectedBinding: CodexSessionStartBinding | ClaudeSessionStartBinding | GeminiSessionStartBinding,
): boolean {
  const parsed = host === "codex" ? parseHooksFile(raw) :
    host === "claude_code" ? parseClaudeSettings(raw) : parseGeminiSettings(raw);
  const hooks = (parsed.hooks.SessionStart ?? []).flatMap((group) => group.hooks);
  const commands = hooks.flatMap((hook) => typeof hook.command === "string" ? [hook.command] : []);
  const managed = commands.flatMap((command) => {
    const result = host === "codex" ? parseCodexHookCommand(command) :
      host === "claude_code" ? parseClaudeHookCommand(command) : parseGeminiHookCommand(command);
    return result === null ? [] : [result];
  });
  const expectedCount = host === "gemini_cli" ? 3 : 1;
  return managed.length === expectedCount && managed.every((result) =>
    result.runtime_root === runtimeRoot && canonicalJson(result.binding) === canonicalJson(expectedBinding));
}

function bindingFor(
  identity: Pick<KusabiFleetIdentity, "agent_id" | "project" | "host_runtime">,
  workspace: string,
  bindingSourceRef: string,
): CodexSessionStartBinding | ClaudeSessionStartBinding | GeminiSessionStartBinding {
  const common = {
    agent_id: identity.agent_id,
    project: identity.project,
    workspace,
    binding_source_ref: bindingSourceRef,
  };
  if (identity.host_runtime === "codex") return { ...common, max_tokens: 1_800, max_bytes: 8_192, timeout_ms: 7_000 };
  return { ...common, max_tokens: 1_800, max_bytes: 8_192, timeout_ms: 7_000 };
}

async function readConfigSnapshot(workspace: string, host: KusabiHostRuntime): Promise<ConfigSnapshot> {
  const configPath = join(workspace, configRelativePath(host));
  await assertDirectoryOrAbsent(dirname(configPath));
  try {
    const info = await lstat(configPath);
    if (!info.isFile() || info.isSymbolicLink()) fail("KUSABI_FLEET_CONFIG_PATH_UNSAFE");
    const raw = await readFile(configPath, "utf8");
    // Parse now so malformed input never reaches an apply operation.
    if (host === "codex") parseHooksFile(raw);
    else if (host === "claude_code") parseClaudeSettings(raw);
    else parseGeminiSettings(raw);
    return {
      state: "file",
      raw,
      sha256: sha256(raw),
      mode: (info.mode & 0o777).toString(8).padStart(4, "0"),
      configPath,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: "absent", raw: null, sha256: null, mode: null, configPath };
    }
    if (error instanceof KusabiFleetRolloutError) throw error;
    fail("KUSABI_FLEET_CONFIG_INVALID");
  }
}

async function assertDirectoryOrAbsent(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) fail("KUSABI_FLEET_CONFIG_DIRECTORY_UNSAFE");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function readArtifactSha256(runtimeRoot: string, host: KusabiHostRuntime): Promise<string> {
  const path = join(runtimeRoot, "dist", `${host === "codex" ? "codex" : host === "claude_code" ? "claude" : "gemini"}-session-start.js`);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) fail("KUSABI_FLEET_ARTIFACT_UNSAFE");
    return sha256(await readFile(path));
  } catch (error) {
    if (error instanceof KusabiFleetRolloutError) throw error;
    fail("KUSABI_FLEET_ARTIFACT_UNAVAILABLE");
  }
}

async function installForHost(
  target: KusabiFleetRolloutTargetInput,
  runtimeRoot: string,
  workspace: string,
  mode: "apply",
): Promise<unknown> {
  const options = {
    mode,
    workspace,
    runtime_root: runtimeRoot,
    agent_id: target.agent_id,
    project: target.project,
    binding_source_ref: target.binding_source_ref,
    create_backup: false,
  } as const;
  if (target.host_runtime === "codex") return installCodexSessionStartHook(options);
  if (target.host_runtime === "claude_code") return installClaudeSessionStartHook(options);
  return installGeminiSessionStartHook(options);
}

function wroteConfig(report: unknown): boolean {
  if (!isRecord(report)) return false;
  return report.wrote_hooks_file === true || report.wrote_settings_file === true;
}

async function restoreConfigSnapshot(snapshot: ConfigSnapshot, expectedPostimageSha256: string): Promise<void> {
  let currentInfo;
  let currentRaw: string | null = null;
  try {
    currentInfo = await lstat(snapshot.configPath);
    if (!currentInfo.isFile() || currentInfo.isSymbolicLink()) fail("KUSABI_FLEET_ROLLBACK_CONFLICT");
    currentRaw = await readFile(snapshot.configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const currentSha256 = currentRaw === null ? null : sha256(currentRaw);
  const currentMode = currentInfo === undefined ? null : (currentInfo.mode & 0o777).toString(8).padStart(4, "0");
  if ((snapshot.state === "absent" && currentRaw === null) ||
    (snapshot.state === "file" && currentSha256 === snapshot.sha256 && currentMode === snapshot.mode)) return;
  if (currentSha256 !== expectedPostimageSha256) fail("KUSABI_FLEET_ROLLBACK_CONFLICT");
  if (snapshot.state === "absent") {
    await rm(snapshot.configPath);
    return;
  }
  if (snapshot.raw === null || snapshot.mode === null) fail("KUSABI_FLEET_ROLLBACK_PREIMAGE_INVALID");
  await mkdir(dirname(snapshot.configPath), { recursive: true });
  const temporary = join(dirname(snapshot.configPath), `.wasurezu-rollback-${randomUUID()}.tmp`);
  await writeFile(temporary, snapshot.raw, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, snapshot.configPath);
  await chmod(snapshot.configPath, Number.parseInt(snapshot.mode, 8));
}

function assertAuthorizationMatches(
  authorization: KusabiFleetRolloutAuthorization,
  plan: KusabiFleetRolloutPlan,
  manifest: KusabiFleetManifest,
): void {
  if (
    authorization.implementation_head_sha !== plan.implementation.commit_sha ||
    authorization.implementation_tree_sha !== plan.implementation.tree_sha ||
    authorization.manifest_sha256 !== manifest.manifest_sha256 ||
    authorization.rollout_plan_sha256 !== plan.rollout_plan_sha256
  ) fail("KUSABI_FLEET_AUTHORIZATION_SUBJECT_MISMATCH");
}

function validateR0Options(options: KusabiFleetR0Options): void {
  if (!boundedId(options.manifest_id) || !positiveInteger(options.manifest_version) || !boundedId(options.rollout_id) ||
    !gitSha(options.commit_sha) || !gitSha(options.tree_sha) || !positiveInteger(options.stale_after_seconds) ||
    !Array.isArray(options.targets) || options.targets.length < 1 ||
    !Array.isArray(options.batch_order) || options.batch_order.length < 1) fail("KUSABI_FLEET_R0_INPUT_INVALID");
  requireTimestamp(options.activation_at, "KUSABI_FLEET_R0_INPUT_INVALID");
  requireTimestamp(options.durable_evidence_deadline_at, "KUSABI_FLEET_R0_INPUT_INVALID");
  requireTimestamp(options.captured_at, "KUSABI_FLEET_R0_INPUT_INVALID");
  assertKusabiFleetInventorySnapshot(options.inventory_snapshot);
  if (options.inventory_snapshot.source.captured_at !== options.captured_at) {
    fail("KUSABI_FLEET_R0_INVENTORY_CAPTURE_MISMATCH");
  }
  if (Date.parse(options.activation_at) >= Date.parse(options.durable_evidence_deadline_at)) {
    fail("KUSABI_FLEET_R0_DEADLINE_INVALID");
  }
  const batchIds = new Set<string>();
  let previousRank = 0;
  let previousOrdinal = 0;
  for (const batch of options.batch_order) {
    if (!boundedId(batch.batch_id) || !(batch.stage in STAGE_ORDER) || !positiveInteger(batch.ordinal) ||
      !nonNegativeInteger(batch.minimum_soak_seconds) || batchIds.has(batch.batch_id)) {
      fail("KUSABI_FLEET_R0_BATCH_INVALID");
    }
    const rank = STAGE_ORDER[batch.stage];
    if (rank < previousRank || (rank === previousRank && batch.ordinal <= previousOrdinal)) {
      fail("KUSABI_FLEET_R0_BATCH_INVALID");
    }
    batchIds.add(batch.batch_id);
    previousRank = rank;
    previousOrdinal = batch.ordinal;
  }
}

function validateTargetInput(input: KusabiFleetRolloutTargetInput): void {
  if (!boundedId(input.agent_id) || !boundedId(input.project) ||
    !(input.host_runtime === "codex" || input.host_runtime === "claude_code" || input.host_runtime === "gemini_cli") ||
    !canonicalText(input.binding_source_ref) || !boundedId(input.batch_id) || !(input.stage in STAGE_ORDER)) {
    fail("KUSABI_FLEET_TARGET_INPUT_INVALID");
  }
  requireStorage(input.storage);
  requireTrustSource(input.trust_source, input.host_runtime);
  for (const window of input.maintenance_windows ?? []) {
    requireTimestamp(window.started_at, "KUSABI_FLEET_TARGET_INPUT_INVALID");
    requireTimestamp(window.ended_at, "KUSABI_FLEET_TARGET_INPUT_INVALID");
    if (Date.parse(window.started_at) >= Date.parse(window.ended_at)) fail("KUSABI_FLEET_TARGET_INPUT_INVALID");
  }
}

function requireTrustSource(source: KusabiFleetTrustSource, host: KusabiHostRuntime): void {
  if (!isRecord(source) ||
    (host === "codex" && (!exactKeys(source, ["kind", "config_toml"]) ||
      source.kind !== "codex_hook_state" || !canonicalText(source.config_toml))) ||
    (host === "claude_code" && (!exactKeys(source, ["kind", "claude_state_json"]) ||
      source.kind !== "claude_project_state" || !canonicalText(source.claude_state_json))) ||
    (host === "gemini_cli" && (!exactKeys(source, ["kind", "trusted_folders_json", "trusted_hooks_json"]) ||
      source.kind !== "gemini_hook_state" || !canonicalText(source.trusted_folders_json) ||
      !canonicalText(source.trusted_hooks_json)))) {
    fail("KUSABI_FLEET_TRUST_SOURCE_MISMATCH");
  }
}

function requireStorage(storage: KusabiFleetDeploymentIdentity["storage"]): void {
  if (!isRecord(storage) || !exactKeys(storage, ["backend", "binding_sha256"]) ||
    !(storage.backend === "sqlite" || storage.backend === "postgres") || !sha256Value(storage.binding_sha256)) {
    fail("KUSABI_FLEET_STORAGE_INVALID");
  }
}

function configRelativePath(host: KusabiHostRuntime): string {
  if (host === "codex") return ".codex/hooks.json";
  if (host === "claude_code") return ".claude/settings.json";
  return ".gemini/settings.json";
}

function adapterVersion(host: KusabiHostRuntime): string {
  if (host === "codex") return CODEX_SESSION_START_ADAPTER_VERSION;
  if (host === "claude_code") return CLAUDE_SESSION_START_ADAPTER_VERSION;
  return GEMINI_SESSION_START_ADAPTER_VERSION;
}

async function safeRealpath(path: string, code: string): Promise<string> {
  try {
    const supplied = await lstat(path);
    if (supplied.isSymbolicLink() || !supplied.isDirectory()) fail(code);
    const resolved = await realpath(path);
    const info = await lstat(resolved);
    if (!info.isDirectory()) fail(code);
    return resolved;
  } catch (error) {
    if (error instanceof KusabiFleetRolloutError) throw error;
    fail(code);
  }
}

function uniqueByTarget(
  observations: KusabiFleetObservedTarget[],
  duplicateCode: string,
): Map<string, KusabiFleetObservedTarget> {
  const result = new Map<string, KusabiFleetObservedTarget>();
  for (const observation of observations) {
    if (result.has(observation.target_key)) fail(duplicateCode);
    result.set(observation.target_key, observation);
  }
  return result;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, (_key, item) => item === undefined ? undefined : item, 2)}\n`;
}

function canonicalCompactJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) result[key] = sortJson(value[key]);
  return result;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return [...Object.keys(value)].sort().join("\n") === [...keys].sort().join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256Value(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

function gitSha(value: unknown): value is string {
  return typeof value === "string" && GIT_SHA_RE.test(value);
}

function boundedId(value: unknown): value is string {
  return typeof value === "string" && BOUNDED_ID_RE.test(value);
}

function canonicalText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value && !value.includes("\0");
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function strictlySorted(values: string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}

function requireHash(value: unknown, code: string): asserts value is string {
  if (!sha256Value(value)) fail(code);
}

function requireGitSha(value: unknown, code: string): asserts value is string {
  if (!gitSha(value)) fail(code);
}

function requireTimestamp(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(code);
}

function fail(code: string): never {
  throw new KusabiFleetRolloutError(code);
}
