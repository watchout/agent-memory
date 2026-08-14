#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  KUSABI_FLEET_INVENTORY_QUERY_CONTRACT_SHA256,
  KusabiFleetRolloutError,
  applyKusabiFleetRolloutBatch,
  evaluateKusabiFleetBatchGate,
  observeKusabiFleetDeployment,
  prepareKusabiFleetR0,
  sealKusabiFleetInventorySnapshot,
  sealKusabiFleetRolloutAuthorization,
  type KusabiFleetApplyBatchReport,
  type KusabiFleetBatchGateReport,
  type KusabiFleetPlacementGateReport,
  type KusabiFleetInventoryBindingInput,
  type KusabiFleetObservedTarget,
  type KusabiFleetRolloutTargetInput,
  type KusabiFleetTrustSource,
} from "./kusabi-fleet-rollout.js";
import { validateKusabiFleetStatus, type KusabiFleetStatusSnapshot, type KusabiHostRuntime } from "./kusabi-fleet-status.js";
import {
  verifyKusabiDirectDbGate,
  type KusabiDirectDbGateProof,
} from "./kusabi-direct-db-gate.js";

const EXPECTED_PRIMARY_COUNT = 33;
const EXPECTED_SECONDARY_COUNT = 2;
const EXPECTED_TARGET_COUNT = EXPECTED_PRIMARY_COUNT + EXPECTED_SECONDARY_COUNT;
const DEFAULT_STORAGE_BINDING_SHA256 = "a1330147bbb614ff7c4670c7bea004a16d7b7a5d7f7055374cb3ef1522db4869";
const SHA256_RE = /^[a-f0-9]{64}$/;
const GIT_SHA_RE = /^[a-f0-9]{40}$/;
const REQUIRED_ENTRYPOINTS = [
  "dist/claude-session-start.js",
  "dist/codex-session-start.js",
  "dist/transcript-stop-capture.js",
  "dist/fleet-conversation-backfill.js",
  "dist/gemini-session-start.js",
  "dist/antigravity-session-start.js",
  "dist/antigravity-hook-installer.js",
  "dist/kusabi-direct-fleet-rollout.js",
  "dist/kusabi-fleet-rollout.js",
  "dist/raw-capture-service.js",
] as const;

const ELIGIBLE_PRIMARY_SQL = `
SELECT
  a.agent_id,
  aw.name AS project,
  aw.local_path AS workspace,
  aw.workspace_id,
  a.profile_revision,
  a.profile_source,
  a.runtime_engine_preference
FROM agents a
JOIN agent_workspace_bindings awb
  ON awb.agent_id = a.agent_id
  AND awb.binding_role = 'primary'
  AND awb.active = true
JOIN agent_workspaces aw ON aw.workspace_id = awb.workspace_id
WHERE a.agent_type <> 'human'
  AND a.agent_id <> 'pdca-ops'
  AND a.disabled_at IS NULL
  AND COALESCE(a.profile_enabled, true) = true
  AND a.runtime_engine_preference IN ('codex', 'claude-code')
  AND a.home_directory LIKE '/Users/yuji/Developer/%'
  AND a.agent_id !~ '(^__|test|ephemeral)'
ORDER BY a.agent_id, aw.name, aw.local_path
`;

const R2_PILOT_TUPLES = new Set([
  "arc/iyasaka-arc/codex",
  "spec/spec/claude_code",
  "codex-audit/codex-audit/codex",
  "devauditor/dev-auditor/codex",
  "codex-cto/codex/codex",
  "qa/qa/codex",
  "dev-001/dev-001/codex",
  "hotel-lead/hotel-lead/codex",
  "check/check/claude_code",
  "org-build-dev/org-build/claude_code",
  "secretary/secretary/codex",
]);

const BATCH_ORDER = [
  { batch_id: "r1-kusabi", stage: "r1" as const, ordinal: 1, minimum_soak_seconds: 0 },
  { batch_id: "r2-pilot", stage: "r2" as const, ordinal: 2, minimum_soak_seconds: 3_600 },
  { batch_id: "r3-wave-01", stage: "r3" as const, ordinal: 3, minimum_soak_seconds: 0 },
  { batch_id: "r3-wave-02", stage: "r3" as const, ordinal: 4, minimum_soak_seconds: 0 },
  { batch_id: "r3-wave-03", stage: "r3" as const, ordinal: 5, minimum_soak_seconds: 0 },
  { batch_id: "r3-wave-04", stage: "r3" as const, ordinal: 6, minimum_soak_seconds: 0 },
  { batch_id: "r3-wave-05", stage: "r3" as const, ordinal: 7, minimum_soak_seconds: 0 },
];

export interface KusabiDirectFleetDatabase {
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  end?(): Promise<void>;
}

interface EligiblePrimaryRow {
  agent_id: string;
  project: string;
  workspace: string;
  workspace_id: string;
  profile_revision: string | number | null;
  profile_source: string | null;
  runtime_engine_preference: "codex" | "claude-code";
}

export interface KusabiDirectTrustPaths {
  codex_config_toml: string;
  claude_state_json: string;
  gemini_trusted_folders_json: string;
  gemini_trusted_hooks_json: string;
}

export interface KusabiImmutableCasReadback {
  schema_version: "kusabi-immutable-cas-readback/v1";
  runtime_root: string;
  release_descriptor_sha256: string;
  source_commit: string;
  source_tree: string;
  runtime_tree_sha256: string;
  dist_tree_sha256: string;
  required_entrypoint_sha256_map: Record<string, string>;
  file_count: number;
  directory_count: number;
  normalized_file_mode: "0444";
  normalized_directory_mode: "0555";
  root_device: number;
  root_inode: number;
  descriptor_device: number;
  descriptor_inode: number;
  exact: true;
  readback_sha256: string;
}

export interface KusabiDirectFleetRolloutOptions {
  cas_root: string;
  apply?: boolean;
  finalize?: boolean;
  expected_head?: string;
  output_dir?: string;
  plan_dir?: string;
  authorization_file?: string;
  resume_batch?: string;
  prior_apply_dir?: string;
  gate_observations_file?: string;
  gate_status_file?: string;
  database?: KusabiDirectFleetDatabase;
  database_url?: string;
  captured_at?: string;
  activation_at?: string;
  durable_evidence_deadline_at?: string;
  manifest_id?: string;
  rollout_id?: string;
  decision_id?: string;
  decision_ref?: string;
  storage_binding_sha256?: string;
  trust_paths?: KusabiDirectTrustPaths;
  /** Test seam; the production CLI always uses /Users/yuji/Developer. */
  workspace_root?: string;
  /** Test-only seam; production CLI never exposes this override. */
  test_allow_external_deployer?: boolean;
  /** Test-only effect seams; production CLI never exposes these callbacks. */
  test_before_target_apply?: (targetKey: string, index: number) => void | Promise<void>;
  test_before_target_rollback?: (targetKey: string, index: number) => void | Promise<void>;
  on_batch_applied?: (batchId: string, report: KusabiFleetApplyBatchReport) => void | Promise<void>;
}

export interface KusabiDirectPlanSeal {
  schema_version: "wasurezu-direct-rollout-plan-seal/v1";
  cas_readback_sha256: string;
  inventory_snapshot_sha256: string;
  manifest_sha256: string;
  rollout_plan_sha256: string;
  r0_report_sha256: string;
  preimage_backup_manifest_sha256: string;
  plan_seal_sha256: string;
}

export interface KusabiDirectPhaseReceipt {
  schema_version: "wasurezu-direct-rollout-phase-receipt/v1";
  plan_seal_sha256: string;
  cas_readback_sha256: string;
  direct_authorization_sha256: string;
  rollout_authorization_sha256: string;
  initial_preimage_backup_manifest_sha256: string;
  prior_phase_receipt_sha256: string | null;
  prior_gate_evidence_sha256: string | null;
  completed_batch_ids: string[];
  batch_id: string;
  batch_ordinal: number;
  batch_target_count: number;
  batch_placed_at: string;
  minimum_soak_seconds: number;
  apply_report_sha256: string;
  placement_gate_sha256: string;
  durable_gate_reports: KusabiFleetBatchGateReport[];
  effect_targets: Array<{ target_key: string; expected_postimage_sha256: string }>;
  receipt_sha256: string;
}

export interface KusabiDirectBatchGateEvidence {
  schema_version: "wasurezu-direct-batch-gate-evidence/v1";
  plan_seal_sha256: string;
  prior_phase_receipt_sha256: string;
  observations_file_sha256: string;
  status_file_sha256: string;
  database_proof: KusabiDirectDbGateProof;
  gate: KusabiFleetBatchGateReport;
  evidence_sha256: string;
}

export interface KusabiDirectRolloutAuthorization {
  schema_version: "wasurezu-direct-rollout-authorization/v1";
  approved: true;
  expected_head: string;
  plan_seal_sha256: string;
  decision_id: string;
  decision_ref_sha256: string;
  independent_audit_sha256: string;
  authorization_sha256: string;
}

interface LoadedPlanArtifacts {
  directory: string;
  cas: KusabiImmutableCasReadback;
  inventory: Awaited<ReturnType<typeof prepareKusabiFleetR0>>["inventory_snapshot"];
  manifest: Awaited<ReturnType<typeof prepareKusabiFleetR0>>["manifest"];
  rolloutPlan: Awaited<ReturnType<typeof prepareKusabiFleetR0>>["rollout_plan"];
  r0Report: Awaited<ReturnType<typeof prepareKusabiFleetR0>>["report"];
  preimageManifest: Record<string, unknown>;
  seal: KusabiDirectPlanSeal;
}

interface LoadedPhaseApplyArtifacts {
  directory: string;
  receipt: KusabiDirectPhaseReceipt;
  directAuthorization: KusabiDirectRolloutAuthorization;
  rolloutAuthorization: { authorization_sha256: string };
  applyReport: KusabiFleetApplyBatchReport;
  placementGate: KusabiFleetPlacementGateReport;
  report: KusabiDirectFleetRolloutReport;
}

interface DirectTargetDescriptor {
  target: KusabiFleetRolloutTargetInput;
  inventory: KusabiFleetInventoryBindingInput;
  binding_source: "agent_comms_primary" | "owner_approved_secondary";
}

interface ConfigPreimage {
  target_key: string;
  config_path: string;
  state: "absent" | "file";
  raw: Buffer | null;
  sha256: string | null;
  mode: string | null;
  backup_file: string | null;
}

export interface KusabiDirectFleetRolloutReport {
  schema_version: "kusabi-direct-fleet-rollout-report/v1";
  mode: "dry-run" | "apply";
  status: "planned" | "configuration_placed_untrusted" | "applied" |
    "phase_gate_required" | "failed_rolled_back" | "failed_rollback_incomplete";
  captured_at: string;
  cas_readback: KusabiImmutableCasReadback;
  target_snapshot: {
    primary_count: number;
    secondary_count: number;
    target_count: number;
    snapshot_sha256: string;
  };
  rollout: {
    manifest_sha256: string;
    rollout_plan_sha256: string;
    batch_count: number;
  };
  r0_report_sha256: string;
  apply_reports: KusabiFleetApplyBatchReport[];
  placement_gate_reports: KusabiFleetPlacementGateReport[];
  observations: KusabiFleetObservedTarget[];
  summary: {
    planned_count: number;
    placed_count: number;
    postimage_exact_count: number;
    trust_exact_count: number;
    automatic_receive_ready_count: number;
    storage_observed_count: number;
    rollback_count: number;
    rollback_error_count: number;
  };
  trust_blockers: Array<{ target_key: string; host_runtime: KusabiHostRuntime }>;
  evidence_errors: Array<{ artifact: string; code: string }>;
  failure: { code: string; message: string } | null;
  phase_receipt: KusabiDirectPhaseReceipt | null;
  prior_batch_gate: KusabiDirectBatchGateEvidence | null;
  final_durable_gate_reports: KusabiFleetBatchGateReport[];
  report_sha256: string;
}

export class KusabiDirectFleetRolloutError extends Error {
  readonly code: string;
  readonly report?: KusabiDirectFleetRolloutReport;

  constructor(code: string, message = code, report?: KusabiDirectFleetRolloutReport) {
    super(message);
    this.name = "KusabiDirectFleetRolloutError";
    this.code = code;
    this.report = report;
  }
}

function fail(code: string, message = code): never {
  throw new KusabiDirectFleetRolloutError(code, message);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source).sort().flatMap((key) => source[key] === undefined ? [] : [[key, canonicalValue(source[key])]]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function fleetEvidenceJson(value: unknown): string {
  return `${JSON.stringify(value, (_key, item) => item === undefined ? undefined : item, 2)}\n`;
}

function byteCompare(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function modeOf(mode: number): string {
  return (mode & 0o777).toString(8).padStart(4, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireTimestamp(value: string, code: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(code);
  }
}

async function walkImmutableTree(
  root: string,
  options: { excludeRelease?: boolean } = {},
): Promise<{ tree_sha256: string; file_count: number; directory_count: number }> {
  const files: Array<{ path: string; mode: string; size: number; sha256: string }> = [];
  let directoryCount = 0;

  async function visit(current: string): Promise<void> {
    const info = await lstat(current);
    if (info.isSymbolicLink()) fail("KUSABI_DIRECT_CAS_SYMLINK", current);
    if (info.isDirectory()) {
      if (modeOf(info.mode) !== "0555") fail("KUSABI_DIRECT_CAS_DIRECTORY_MODE", current);
      directoryCount++;
      const children = (await readdir(current)).sort(byteCompare);
      for (const child of children) await visit(join(current, child));
      return;
    }
    if (!info.isFile()) fail("KUSABI_DIRECT_CAS_SPECIAL_FILE", current);
    const rel = relative(root, current).split(sep).join("/");
    const mode = modeOf(info.mode);
    if (mode !== "0444") fail("KUSABI_DIRECT_CAS_FILE_MODE", current);
    if (options.excludeRelease === true && rel === "release.json") return;
    files.push({ path: rel, mode, size: info.size, sha256: sha256(await readFile(current)) });
  }

  await visit(root);
  files.sort((left, right) => byteCompare(left.path, right.path));
  const preimage = files.map((entry) =>
    `${entry.path}\t${entry.mode}\t${entry.size}\t${entry.sha256}\n`
  ).join("");
  return { tree_sha256: sha256(preimage), file_count: files.length, directory_count: directoryCount };
}

async function readEntrypointMap(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const path of REQUIRED_ENTRYPOINTS) {
    const fullPath = join(root, path);
    const info = await lstat(fullPath).catch(() => fail("KUSABI_DIRECT_CAS_ENTRYPOINT_MISSING", path));
    if (!info.isFile() || info.isSymbolicLink() || modeOf(info.mode) !== "0444") {
      fail("KUSABI_DIRECT_CAS_ENTRYPOINT_INVALID", path);
    }
    result[path] = sha256(await readFile(fullPath));
  }
  return result;
}

export async function readImmutableKusabiCasRoot(inputRoot: string): Promise<KusabiImmutableCasReadback> {
  if (!isAbsolute(inputRoot) || resolve(inputRoot) !== inputRoot || basename(dirname(inputRoot)) !== "sha256" ||
    !SHA256_RE.test(basename(inputRoot))) {
    fail("KUSABI_DIRECT_CAS_PATH_INVALID", inputRoot);
  }
  const runtimeRoot = await realpath(inputRoot).catch(() => fail("KUSABI_DIRECT_CAS_ROOT_MISSING", inputRoot));
  if (runtimeRoot !== inputRoot) fail("KUSABI_DIRECT_CAS_ROOT_NOT_EXACT", inputRoot);
  const rootInfo = await lstat(runtimeRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || modeOf(rootInfo.mode) !== "0555") {
    fail("KUSABI_DIRECT_CAS_ROOT_NOT_IMMUTABLE", runtimeRoot);
  }

  const descriptorPath = join(runtimeRoot, "release.json");
  const descriptorInfo = await lstat(descriptorPath).catch(() => fail("KUSABI_DIRECT_CAS_DESCRIPTOR_MISSING"));
  if (!descriptorInfo.isFile() || descriptorInfo.isSymbolicLink() || modeOf(descriptorInfo.mode) !== "0444") {
    fail("KUSABI_DIRECT_CAS_DESCRIPTOR_INVALID");
  }
  const descriptorBytes = await readFile(descriptorPath).catch(() => fail("KUSABI_DIRECT_CAS_DESCRIPTOR_MISSING"));
  const descriptorSha256 = sha256(descriptorBytes);
  if (descriptorSha256 !== basename(runtimeRoot)) fail("KUSABI_DIRECT_CAS_DESCRIPTOR_PATH_MISMATCH");
  let parsed: unknown;
  try {
    parsed = JSON.parse(descriptorBytes.toString("utf8"));
  } catch {
    fail("KUSABI_DIRECT_CAS_DESCRIPTOR_INVALID");
  }
  if (!isRecord(parsed) || canonicalJson(parsed) !== descriptorBytes.toString("utf8") ||
    parsed.schema_version !== "wasurezu-content-addressed-runtime-release/v1" ||
    parsed.repository !== "watchout/agent-memory" || typeof parsed.source_commit !== "string" ||
    !GIT_SHA_RE.test(parsed.source_commit) || typeof parsed.source_tree !== "string" || !GIT_SHA_RE.test(parsed.source_tree) ||
    typeof parsed.runtime_tree_sha256 !== "string" || !SHA256_RE.test(parsed.runtime_tree_sha256) ||
    typeof parsed.dist_tree_sha256 !== "string" || !SHA256_RE.test(parsed.dist_tree_sha256) ||
    parsed.normalized_file_mode !== "0444" || parsed.normalized_directory_mode !== "0555" ||
    !isRecord(parsed.required_entrypoint_sha256_map)) {
    fail("KUSABI_DIRECT_CAS_DESCRIPTOR_INVALID");
  }

  const runtime = await walkImmutableTree(runtimeRoot, { excludeRelease: true });
  const dist = await walkImmutableTree(join(runtimeRoot, "dist"));
  const entrypoints = await readEntrypointMap(runtimeRoot);
  if (runtime.tree_sha256 !== parsed.runtime_tree_sha256 || dist.tree_sha256 !== parsed.dist_tree_sha256 ||
    canonicalJson(entrypoints) !== canonicalJson(parsed.required_entrypoint_sha256_map)) {
    fail("KUSABI_DIRECT_CAS_EXACT_READBACK_MISMATCH");
  }
  const withoutHash = {
    schema_version: "kusabi-immutable-cas-readback/v1" as const,
    runtime_root: runtimeRoot,
    release_descriptor_sha256: descriptorSha256,
    source_commit: parsed.source_commit,
    source_tree: parsed.source_tree,
    runtime_tree_sha256: runtime.tree_sha256,
    dist_tree_sha256: dist.tree_sha256,
    required_entrypoint_sha256_map: entrypoints,
    file_count: runtime.file_count,
    directory_count: runtime.directory_count,
    normalized_file_mode: "0444" as const,
    normalized_directory_mode: "0555" as const,
    root_device: rootInfo.dev,
    root_inode: rootInfo.ino,
    descriptor_device: descriptorInfo.dev,
    descriptor_inode: descriptorInfo.ino,
    exact: true as const,
  };
  return { ...withoutHash, readback_sha256: sha256(canonicalJson(withoutHash)) };
}

function hostRuntime(preference: EligiblePrimaryRow["runtime_engine_preference"]): KusabiHostRuntime {
  if (preference === "codex") return "codex";
  if (preference === "claude-code") return "claude_code";
  fail("KUSABI_DIRECT_PRIMARY_RUNTIME_INVALID");
}

function targetTuple(agentId: string, project: string, host: KusabiHostRuntime): string {
  return `${agentId}/${project}/${host}`;
}

function trustSource(host: KusabiHostRuntime, paths: KusabiDirectTrustPaths, workspace: string): KusabiFleetTrustSource {
  if (host === "antigravity_cli") return {
    kind: "antigravity_hook_state",
    hooks_json: join(workspace, ".agents", "hooks.json"),
  };
  if (host === "codex") return { kind: "codex_hook_state", config_toml: paths.codex_config_toml };
  if (host === "claude_code") return { kind: "claude_project_state", claude_state_json: paths.claude_state_json };
  return {
    kind: "gemini_hook_state",
    trusted_folders_json: paths.gemini_trusted_folders_json,
    trusted_hooks_json: paths.gemini_trusted_hooks_json,
  };
}

function defaultTrustPaths(): KusabiDirectTrustPaths {
  const home = homedir();
  return {
    codex_config_toml: join(home, ".codex", "config.toml"),
    claude_state_json: join(home, ".claude.json"),
    gemini_trusted_folders_json: join(home, ".gemini", "trustedFolders.json"),
    gemini_trusted_hooks_json: join(home, ".gemini", "trusted_hooks.json"),
  };
}

function eligibility(): KusabiFleetInventoryBindingInput["eligibility"] {
  return {
    canonical_identity_verified: true,
    agent_type_non_human: true,
    agent_active: true,
    profile_enabled: true,
    runtime_supported: true,
    production_workspace: true,
    workspace_binding_active: true,
    new_work_allowed: true,
  };
}

function batchAssignment(tuple: string, r3Tuples: string[]): { stage: "r1" | "r2" | "r3"; batch_id: string } {
  if (tuple === "kusabi/agent-memory/codex" || tuple === "kusabi/agent-memory/claude_code" ||
    tuple === "kusabi/agent-memory/antigravity_cli") return { stage: "r1", batch_id: "r1-kusabi" };
  if (R2_PILOT_TUPLES.has(tuple)) return { stage: "r2", batch_id: "r2-pilot" };
  const index = r3Tuples.indexOf(tuple);
  if (index < 0) fail("KUSABI_DIRECT_BATCH_ASSIGNMENT_MISSING", tuple);
  return { stage: "r3", batch_id: `r3-wave-${String(Math.floor(index / 5) + 1).padStart(2, "0")}` };
}

async function collectDirectTargets(
  database: KusabiDirectFleetDatabase,
  trustPaths: KusabiDirectTrustPaths,
  storageBindingSha256: string,
  workspaceRoot: string,
): Promise<{ descriptors: DirectTargetDescriptor[]; primary_count: number; secondary_count: number }> {
  const exactWorkspaceRoot = await realpath(workspaceRoot).catch(() =>
    fail("KUSABI_DIRECT_WORKSPACE_ROOT_MISSING", workspaceRoot)
  );
  if (exactWorkspaceRoot !== workspaceRoot) fail("KUSABI_DIRECT_WORKSPACE_ROOT_NOT_EXACT", workspaceRoot);
  const { rows } = await database.query<EligiblePrimaryRow>(ELIGIBLE_PRIMARY_SQL);
  if (rows.length !== EXPECTED_PRIMARY_COUNT) {
    fail("KUSABI_DIRECT_PRIMARY_COUNT_MISMATCH", `expected ${EXPECTED_PRIMARY_COUNT}, got ${rows.length}`);
  }
  const primary = await Promise.all(rows.map(async (row) => {
    if (typeof row.agent_id !== "string" || typeof row.project !== "string" || typeof row.workspace !== "string" ||
      typeof row.workspace_id !== "string" ||
      !(row.runtime_engine_preference === "codex" || row.runtime_engine_preference === "claude-code")) {
      fail("KUSABI_DIRECT_PRIMARY_ROW_INVALID");
    }
    const workspace = await realpath(row.workspace).catch(() => fail("KUSABI_DIRECT_WORKSPACE_MISSING", row.workspace));
    if (workspace !== row.workspace || workspace === exactWorkspaceRoot || !isWithin(exactWorkspaceRoot, workspace)) {
      fail("KUSABI_DIRECT_WORKSPACE_BOUNDARY_INVALID", row.workspace);
    }
    const host = hostRuntime(row.runtime_engine_preference);
    const bindingSourceRef = canonicalJson({
      schema_version: "kusabi-direct-binding-source-ref/v1",
      binding_source: "agent_comms_primary",
      canonical_agent_id: row.agent_id,
      project: row.project,
      host_runtime: host,
      workspace_id_sha256: sha256(row.workspace_id),
      workspace_sha256: sha256(workspace),
      profile_revision: row.profile_revision === null ? null : String(row.profile_revision),
      profile_source: row.profile_source,
    });
    return { row, workspace, host, bindingSourceRef };
  }));
  const tupleSet = new Set(primary.map(({ row, host }) => targetTuple(row.agent_id, row.project, host)));
  if (tupleSet.size !== primary.length) fail("KUSABI_DIRECT_PRIMARY_DUPLICATE");
  if (!tupleSet.has("kusabi/agent-memory/codex")) fail("KUSABI_DIRECT_KUSABI_PRIMARY_MISSING");
  const missingPilots = [...R2_PILOT_TUPLES].filter((tuple) => !tupleSet.has(tuple));
  if (missingPilots.length > 0) fail("KUSABI_DIRECT_R2_PILOT_MISSING", missingPilots.join(","));

  const r3Tuples = [...tupleSet]
    .filter((tuple) => tuple !== "kusabi/agent-memory/codex" && !R2_PILOT_TUPLES.has(tuple))
    .sort(byteCompare);
  if (r3Tuples.length !== 21) fail("KUSABI_DIRECT_R3_COUNT_MISMATCH");
  const storage = { backend: "postgres" as const, binding_sha256: storageBindingSha256 };
  const descriptors: DirectTargetDescriptor[] = primary.map(({ row, workspace, host, bindingSourceRef }) => {
    const tuple = targetTuple(row.agent_id, row.project, host);
    const batch = batchAssignment(tuple, r3Tuples);
    return {
      target: {
        agent_id: row.agent_id,
        project: row.project,
        host_runtime: host,
        workspace,
        binding_source_ref: bindingSourceRef,
        storage,
        trust_source: trustSource(host, trustPaths, workspace),
        ...batch,
      },
      inventory: {
        registered_agent_id: row.agent_id,
        canonical_agent_id: row.agent_id,
        project: row.project,
        host_runtime: host,
        workspace_sha256: sha256(workspace),
        binding_source: "agent_comms_primary",
        binding_source_ref_sha256: sha256(bindingSourceRef),
        eligibility: eligibility(),
      },
      binding_source: "agent_comms_primary",
    };
  });

  const kusabi = primary.find(({ row, host }) => row.agent_id === "kusabi" && row.project === "agent-memory" && host === "codex");
  if (!kusabi) fail("KUSABI_DIRECT_KUSABI_PRIMARY_MISSING");
  for (const host of ["claude_code", "antigravity_cli"] as const) {
    const bindingSourceRef = canonicalJson({
      schema_version: "kusabi-direct-binding-source-ref/v1",
      binding_source: "owner_approved_secondary",
      canonical_agent_id: "kusabi",
      project: "agent-memory",
      host_runtime: host,
      primary_binding_source_ref_sha256: sha256(kusabi.bindingSourceRef),
      owner_directive: "direct-fleet-rollout-20260813",
      workspace_sha256: sha256(kusabi.workspace),
    });
    descriptors.push({
      target: {
        agent_id: "kusabi",
        project: "agent-memory",
        host_runtime: host,
        workspace: kusabi.workspace,
        binding_source_ref: bindingSourceRef,
        storage,
        trust_source: trustSource(host, trustPaths, kusabi.workspace),
        stage: "r1",
        batch_id: "r1-kusabi",
      },
      inventory: {
        registered_agent_id: "kusabi",
        canonical_agent_id: "kusabi",
        project: "agent-memory",
        host_runtime: host,
        workspace_sha256: sha256(kusabi.workspace),
        binding_source: "owner_approved_secondary",
        binding_source_ref_sha256: sha256(bindingSourceRef),
        eligibility: eligibility(),
      },
      binding_source: "owner_approved_secondary",
    });
  }
  if (descriptors.length !== EXPECTED_TARGET_COUNT) fail("KUSABI_DIRECT_TARGET_COUNT_MISMATCH");
  return { descriptors, primary_count: EXPECTED_PRIMARY_COUNT, secondary_count: EXPECTED_SECONDARY_COUNT };
}

function configRelativePath(host: KusabiHostRuntime): string {
  if (host === "antigravity_cli") return ".agents/hooks.json";
  if (host === "codex") return ".codex/hooks.json";
  if (host === "claude_code") return ".claude/settings.json";
  return ".gemini/settings.json";
}

function targetIdentityTuple(target: Pick<KusabiFleetRolloutTargetInput, "agent_id" | "project" | "host_runtime">): string {
  return targetTuple(target.agent_id, target.project, target.host_runtime);
}

async function readConfigPreimages(
  targets: KusabiFleetRolloutTargetInput[],
  targetKeyByTuple: Map<string, string>,
): Promise<ConfigPreimage[]> {
  const result: ConfigPreimage[] = [];
  for (const target of targets) {
    const targetKey = targetKeyByTuple.get(targetIdentityTuple(target));
    if (!targetKey) fail("KUSABI_DIRECT_TARGET_KEY_MISSING");
    const configPath = join(target.workspace, configRelativePath(target.host_runtime));
    await assertSafeConfigParent(target.workspace, configPath);
    try {
      const info = await lstat(configPath);
      if (!info.isFile() || info.isSymbolicLink()) fail("KUSABI_DIRECT_CONFIG_PATH_UNSAFE", configPath);
      const raw = await readFile(configPath);
      result.push({
        target_key: targetKey,
        config_path: configPath,
        state: "file",
        raw,
        sha256: sha256(raw),
        mode: modeOf(info.mode),
        backup_file: null,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      result.push({
        target_key: targetKey,
        config_path: configPath,
        state: "absent",
        raw: null,
        sha256: null,
        mode: null,
        backup_file: null,
      });
    }
  }
  return result.sort((left, right) => byteCompare(left.target_key, right.target_key));
}

async function assertSafeConfigParent(workspace: string, configPath: string): Promise<void> {
  const parent = dirname(configPath);
  const rel = relative(workspace, parent);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail("KUSABI_DIRECT_CONFIG_PARENT_BOUNDARY", configPath);
  }
  let current = workspace;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) fail("KUSABI_DIRECT_CONFIG_PARENT_UNSAFE", current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function currentConfig(preimage: ConfigPreimage): Promise<{
  state: "absent" | "file";
  raw: Buffer | null;
  sha256: string | null;
  mode: string | null;
}> {
  await assertSafeConfigParent(dirname(dirname(preimage.config_path)), preimage.config_path);
  try {
    const currentInfo = await lstat(preimage.config_path);
    if (!currentInfo.isFile() || currentInfo.isSymbolicLink()) {
      fail("KUSABI_DIRECT_CONFIG_PATH_UNSAFE", preimage.config_path);
    }
    const raw = await readFile(preimage.config_path);
    return { state: "file", raw, sha256: sha256(raw), mode: modeOf(currentInfo.mode) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: "absent", raw: null, sha256: null, mode: null };
    }
    throw error;
  }
}

async function assertPreimageStillCurrent(preimage: ConfigPreimage): Promise<void> {
  const current = await currentConfig(preimage);
  if (current.state !== preimage.state || current.sha256 !== preimage.sha256 || current.mode !== preimage.mode) {
    fail("KUSABI_DIRECT_PREIMAGE_DRIFT", preimage.target_key);
  }
}

async function restorePreimage(preimage: ConfigPreimage, expectedPostimageSha256: string): Promise<void> {
  let current = await currentConfig(preimage);
  const alreadyRestored = current.state === preimage.state && current.sha256 === preimage.sha256 &&
    current.mode === preimage.mode;
  if (alreadyRestored) return;
  if (current.state !== "file" || current.sha256 !== expectedPostimageSha256) {
    fail("KUSABI_DIRECT_ROLLBACK_CONFLICT", preimage.target_key);
  }
  if (preimage.state === "absent") {
    // Compare again immediately before unlink so a concurrent edit is not
    // removed based on an earlier read.
    current = await currentConfig(preimage);
    if (current.state !== "file" || current.sha256 !== expectedPostimageSha256) {
      fail("KUSABI_DIRECT_ROLLBACK_CONFLICT", preimage.target_key);
    }
    await rm(preimage.config_path);
    return;
  }
  if (preimage.raw === null || preimage.mode === null) fail("KUSABI_DIRECT_ROLLBACK_PREIMAGE_INVALID");
  await mkdir(dirname(preimage.config_path), { recursive: true });
  const temporary = join(dirname(preimage.config_path), `.kusabi-direct-rollback-${randomUUID()}.tmp`);
  await writeFile(temporary, preimage.raw, { mode: 0o600, flag: "wx" });
  current = await currentConfig(preimage);
  if (current.state !== "file" || current.sha256 !== expectedPostimageSha256) {
    await rm(temporary, { force: true });
    fail("KUSABI_DIRECT_ROLLBACK_CONFLICT", preimage.target_key);
  }
  await rename(temporary, preimage.config_path);
  await chmod(preimage.config_path, Number.parseInt(preimage.mode, 8));
}

async function createOutputDirectory(path: string): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path) fail("KUSABI_DIRECT_OUTPUT_PATH_INVALID");
  try {
    await lstat(path);
    fail("KUSABI_DIRECT_OUTPUT_ALREADY_EXISTS", path);
  } catch (error) {
    if (error instanceof KusabiDirectFleetRolloutError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(path, { mode: 0o700 });
  return await realpath(path);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

async function writeBaseArtifacts(
  outputDir: string,
  r0: Awaited<ReturnType<typeof prepareKusabiFleetR0>>,
  cas: KusabiImmutableCasReadback,
): Promise<void> {
  await writeJson(join(outputDir, "cas-readback.json"), cas);
  await writeJson(join(outputDir, "inventory-snapshot.json"), r0.inventory_snapshot);
  await writeJson(join(outputDir, "fleet-manifest.json"), r0.manifest);
  await writeJson(join(outputDir, "rollout-plan.json"), r0.rollout_plan);
  await writeJson(join(outputDir, "r0-report.json"), r0.report);
}

async function persistPreimages(outputDir: string, preimages: ConfigPreimage[]): Promise<Record<string, unknown>> {
  const backupDir = join(outputDir, "preimages");
  await mkdir(backupDir, { mode: 0o700 });
  for (const preimage of preimages) {
    if (preimage.raw === null) continue;
    const backupFile = join(backupDir, `${preimage.target_key}.config`);
    await writeFile(backupFile, preimage.raw, { mode: 0o600, flag: "wx" });
    preimage.backup_file = backupFile;
  }
  const withoutHash = {
    schema_version: "kusabi-direct-preimage-backup-manifest/v1",
    target_count: preimages.length,
    file_preimage_count: preimages.filter(({ state }) => state === "file").length,
    absent_preimage_count: preimages.filter(({ state }) => state === "absent").length,
    preimages: preimages.map(({ raw: _raw, ...preimage }) => preimage),
  };
  const manifest = {
    ...withoutHash,
    manifest_sha256: sha256(canonicalJson(withoutHash)),
  };
  await writeJson(join(outputDir, "preimage-backup-manifest.json"), manifest);
  return manifest;
}

function sealPlan(
  input: Omit<KusabiDirectPlanSeal, "schema_version" | "plan_seal_sha256">,
): KusabiDirectPlanSeal {
  const withoutHash = { schema_version: "wasurezu-direct-rollout-plan-seal/v1" as const, ...input };
  return { ...withoutHash, plan_seal_sha256: sha256(canonicalJson(withoutHash)) };
}

function sealPhaseReceipt(
  input: Omit<KusabiDirectPhaseReceipt, "schema_version" | "receipt_sha256">,
): KusabiDirectPhaseReceipt {
  const withoutHash = { schema_version: "wasurezu-direct-rollout-phase-receipt/v1" as const, ...input };
  return { ...withoutHash, receipt_sha256: sha256(canonicalJson(withoutHash)) };
}

function sealBatchGateEvidence(
  input: Omit<KusabiDirectBatchGateEvidence, "schema_version" | "evidence_sha256">,
): KusabiDirectBatchGateEvidence {
  const withoutHash = { schema_version: "wasurezu-direct-batch-gate-evidence/v1" as const, ...input };
  return { ...withoutHash, evidence_sha256: sha256(canonicalJson(withoutHash)) };
}

export function sealKusabiDirectRolloutAuthorization(
  input: Omit<KusabiDirectRolloutAuthorization, "schema_version" | "approved" | "authorization_sha256">,
): KusabiDirectRolloutAuthorization {
  if (!GIT_SHA_RE.test(input.expected_head) || !SHA256_RE.test(input.plan_seal_sha256) ||
    !SHA256_RE.test(input.decision_ref_sha256) || !SHA256_RE.test(input.independent_audit_sha256) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(input.decision_id)) {
    fail("KUSABI_DIRECT_AUTHORIZATION_INVALID");
  }
  const withoutHash = {
    schema_version: "wasurezu-direct-rollout-authorization/v1" as const,
    approved: true as const,
    ...input,
  };
  return { ...withoutHash, authorization_sha256: sha256(canonicalJson(withoutHash)) };
}

function assertAuthorization(
  value: unknown,
  seal: KusabiDirectPlanSeal,
  cas: KusabiImmutableCasReadback,
): KusabiDirectRolloutAuthorization {
  if (!isRecord(value)) fail("KUSABI_DIRECT_AUTHORIZATION_INVALID");
  const expectedKeys = [
    "schema_version", "approved", "expected_head", "plan_seal_sha256", "decision_id",
    "decision_ref_sha256", "independent_audit_sha256", "authorization_sha256",
  ].sort().join("\n");
  if (Object.keys(value).sort().join("\n") !== expectedKeys) fail("KUSABI_DIRECT_AUTHORIZATION_INVALID");
  const authorization = value as unknown as KusabiDirectRolloutAuthorization;
  const sealed = sealKusabiDirectRolloutAuthorization({
    expected_head: authorization.expected_head,
    plan_seal_sha256: authorization.plan_seal_sha256,
    decision_id: authorization.decision_id,
    decision_ref_sha256: authorization.decision_ref_sha256,
    independent_audit_sha256: authorization.independent_audit_sha256,
  });
  if (authorization.schema_version !== sealed.schema_version || authorization.approved !== true ||
    canonicalJson(authorization) !== canonicalJson(sealed) || authorization.plan_seal_sha256 !== seal.plan_seal_sha256 ||
    authorization.expected_head !== cas.source_commit) fail("KUSABI_DIRECT_AUTHORIZATION_INVALID");
  return authorization;
}

async function readJsonFile(path: string, code: string): Promise<unknown> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || modeOf(info.mode) !== "0400") fail(code, path);
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof KusabiDirectFleetRolloutError) throw error;
    fail(code, path);
  }
}

async function readJsonFileWithHash(path: string, code: string): Promise<{ value: unknown; sha256: string }> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || modeOf(info.mode) !== "0400") fail(code, path);
    const raw = await readFile(path);
    return { value: JSON.parse(raw.toString("utf8")), sha256: sha256(raw) };
  } catch (error) {
    if (error instanceof KusabiDirectFleetRolloutError) throw error;
    fail(code, path);
  }
}

function assertPhaseReceipt(value: unknown): KusabiDirectPhaseReceipt {
  if (!isRecord(value)) fail("KUSABI_DIRECT_PHASE_RECEIPT_INVALID");
  const expectedKeys = [
    "schema_version", "plan_seal_sha256", "cas_readback_sha256", "direct_authorization_sha256",
    "rollout_authorization_sha256", "initial_preimage_backup_manifest_sha256", "prior_phase_receipt_sha256",
    "prior_gate_evidence_sha256", "completed_batch_ids", "batch_id", "batch_ordinal", "batch_target_count",
    "batch_placed_at", "minimum_soak_seconds", "apply_report_sha256", "placement_gate_sha256",
    "durable_gate_reports", "effect_targets", "receipt_sha256",
  ];
  if (Object.keys(value).sort().join("\n") !== expectedKeys.sort().join("\n")) {
    fail("KUSABI_DIRECT_PHASE_RECEIPT_INVALID");
  }
  const receipt = value as unknown as KusabiDirectPhaseReceipt;
  if (!Array.isArray(receipt.completed_batch_ids) || !Array.isArray(receipt.durable_gate_reports) ||
    !Array.isArray(receipt.effect_targets)) fail("KUSABI_DIRECT_PHASE_RECEIPT_INVALID");
  const sealed = sealPhaseReceipt({
    plan_seal_sha256: receipt.plan_seal_sha256,
    cas_readback_sha256: receipt.cas_readback_sha256,
    direct_authorization_sha256: receipt.direct_authorization_sha256,
    rollout_authorization_sha256: receipt.rollout_authorization_sha256,
    initial_preimage_backup_manifest_sha256: receipt.initial_preimage_backup_manifest_sha256,
    prior_phase_receipt_sha256: receipt.prior_phase_receipt_sha256,
    prior_gate_evidence_sha256: receipt.prior_gate_evidence_sha256,
    completed_batch_ids: receipt.completed_batch_ids,
    batch_id: receipt.batch_id,
    batch_ordinal: receipt.batch_ordinal,
    batch_target_count: receipt.batch_target_count,
    batch_placed_at: receipt.batch_placed_at,
    minimum_soak_seconds: receipt.minimum_soak_seconds,
    apply_report_sha256: receipt.apply_report_sha256,
    placement_gate_sha256: receipt.placement_gate_sha256,
    durable_gate_reports: receipt.durable_gate_reports,
    effect_targets: receipt.effect_targets,
  });
  requireTimestamp(receipt.batch_placed_at, "KUSABI_DIRECT_PHASE_RECEIPT_INVALID");
  if (canonicalJson(receipt) !== canonicalJson(sealed) ||
    !Number.isInteger(receipt.batch_ordinal) || receipt.batch_ordinal < 1 || receipt.batch_ordinal > BATCH_ORDER.length ||
    !Number.isInteger(receipt.batch_target_count) || receipt.batch_target_count < 1 ||
    !Number.isInteger(receipt.minimum_soak_seconds) || receipt.minimum_soak_seconds < 0 ||
    receipt.completed_batch_ids.length !== receipt.batch_ordinal ||
    receipt.durable_gate_reports.length !== receipt.batch_ordinal - 1 ||
    !SHA256_RE.test(receipt.plan_seal_sha256) || !SHA256_RE.test(receipt.cas_readback_sha256) ||
    !SHA256_RE.test(receipt.direct_authorization_sha256) || !SHA256_RE.test(receipt.rollout_authorization_sha256) ||
    !SHA256_RE.test(receipt.initial_preimage_backup_manifest_sha256) || !SHA256_RE.test(receipt.apply_report_sha256) ||
    !SHA256_RE.test(receipt.placement_gate_sha256) ||
    !(receipt.prior_phase_receipt_sha256 === null || SHA256_RE.test(receipt.prior_phase_receipt_sha256)) ||
    !(receipt.prior_gate_evidence_sha256 === null || SHA256_RE.test(receipt.prior_gate_evidence_sha256)) ||
    new Set(receipt.effect_targets.map(({ target_key }) => target_key)).size !== receipt.effect_targets.length ||
    receipt.effect_targets.some(({ target_key, expected_postimage_sha256 }) =>
      !SHA256_RE.test(target_key) || !SHA256_RE.test(expected_postimage_sha256))) {
    fail("KUSABI_DIRECT_PHASE_RECEIPT_INVALID");
  }
  for (const gate of receipt.durable_gate_reports) assertFleetSealedRecord(
    gate as unknown as Record<string, unknown>, "report_sha256", "KUSABI_DIRECT_PHASE_RECEIPT_INVALID");
  return receipt;
}

async function loadPhaseApplyArtifacts(path: string): Promise<LoadedPhaseApplyArtifacts> {
  if (!isAbsolute(path) || resolve(path) !== path) fail("KUSABI_DIRECT_PRIOR_APPLY_DIR_INVALID");
  const directory = await realpath(path).catch(() => fail("KUSABI_DIRECT_PRIOR_APPLY_DIR_INVALID"));
  const info = await lstat(directory);
  if (directory !== path || !info.isDirectory() || info.isSymbolicLink() || modeOf(info.mode) !== "0500") {
    fail("KUSABI_DIRECT_PRIOR_APPLY_DIR_INVALID");
  }
  const receipt = assertPhaseReceipt(await readJsonFile(
    join(directory, "phase-receipt.json"), "KUSABI_DIRECT_PRIOR_APPLY_INVALID"));
  const [directAuthorization, rolloutAuthorization, applyReport, placementGateValue, report] = await Promise.all([
      readJsonFile(join(directory, "direct-authorization.json"), "KUSABI_DIRECT_PRIOR_APPLY_INVALID"),
      readJsonFile(join(directory, "rollout-authorization.json"), "KUSABI_DIRECT_PRIOR_APPLY_INVALID"),
      readJsonFile(join(directory, `apply-${receipt.batch_id}.json`), "KUSABI_DIRECT_PRIOR_APPLY_INVALID"),
      readJsonFile(join(directory, `placement-gate-${receipt.batch_id}.json`), "KUSABI_DIRECT_PRIOR_APPLY_INVALID"),
      readJsonFile(join(directory, "direct-rollout-report.json"), "KUSABI_DIRECT_PRIOR_APPLY_INVALID"),
    ]);
  if (!isRecord(directAuthorization) || !isRecord(rolloutAuthorization) || !isRecord(applyReport) ||
    !isRecord(placementGateValue) || !isRecord(report) || !isRecord(placementGateValue.placement_gate)) {
    fail("KUSABI_DIRECT_PRIOR_APPLY_INVALID");
  }
  const apply = applyReport as unknown as KusabiFleetApplyBatchReport;
  const placementGate = placementGateValue.placement_gate as unknown as KusabiFleetPlacementGateReport;
  const priorReport = report as unknown as KusabiDirectFleetRolloutReport;
  let priorGateEvidence: KusabiDirectBatchGateEvidence | null = null;
  if (receipt.prior_gate_evidence_sha256 !== null) {
    const value = await readJsonFile(join(directory, "prior-batch-gate.json"), "KUSABI_DIRECT_PRIOR_APPLY_INVALID");
    if (!isRecord(value) || !isRecord(value.database_proof)) fail("KUSABI_DIRECT_PRIOR_APPLY_INVALID");
    assertSealedRecord(value.database_proof, "proof_sha256", "KUSABI_DIRECT_PRIOR_APPLY_INVALID");
    assertSealedRecord(value, "evidence_sha256", "KUSABI_DIRECT_PRIOR_APPLY_INVALID");
    priorGateEvidence = value as unknown as KusabiDirectBatchGateEvidence;
    if (priorGateEvidence.evidence_sha256 !== receipt.prior_gate_evidence_sha256) {
      fail("KUSABI_DIRECT_PRIOR_APPLY_INVALID");
    }
  }
  const { report_sha256: _reportSha256, ...reportWithoutHash } = priorReport;
  if (priorReport.status !== "phase_gate_required" || priorReport.report_sha256 !==
    sealDirectReport(reportWithoutHash).report_sha256 ||
    canonicalJson(priorReport.phase_receipt) !== canonicalJson(receipt) || priorReport.apply_reports.length !== 1 ||
    canonicalJson(priorReport.apply_reports[0]) !== canonicalJson(apply) ||
    canonicalJson(priorReport.placement_gate_reports[0]) !== canonicalJson(placementGate) ||
    priorReport.summary.placed_count !== receipt.batch_target_count ||
    receipt.direct_authorization_sha256 !== directAuthorization.authorization_sha256 ||
    receipt.rollout_authorization_sha256 !== rolloutAuthorization.authorization_sha256 ||
    receipt.apply_report_sha256 !== apply.report_sha256 || receipt.placement_gate_sha256 !== placementGate.report_sha256) {
    fail("KUSABI_DIRECT_PRIOR_APPLY_INVALID");
  }
  if (canonicalJson(priorReport.prior_batch_gate) !== canonicalJson(priorGateEvidence)) {
    fail("KUSABI_DIRECT_PRIOR_APPLY_INVALID");
  }
  return {
    directory,
    receipt,
    directAuthorization: directAuthorization as unknown as KusabiDirectRolloutAuthorization,
    rolloutAuthorization: rolloutAuthorization as { authorization_sha256: string },
    applyReport: apply,
    placementGate,
    report: priorReport,
  };
}

async function loadFrozenPreimages(plan: LoadedPlanArtifacts): Promise<ConfigPreimage[]> {
  const value = plan.preimageManifest;
  if (value.schema_version !== "kusabi-direct-preimage-backup-manifest/v1" || value.target_count !== 35 ||
    !Array.isArray(value.preimages) || value.preimages.length !== 35) fail("KUSABI_DIRECT_FROZEN_PREIMAGE_INVALID");
  const result: ConfigPreimage[] = [];
  for (const raw of value.preimages) {
    if (!isRecord(raw) || typeof raw.target_key !== "string" || !SHA256_RE.test(raw.target_key) ||
      typeof raw.config_path !== "string" || !(raw.state === "file" || raw.state === "absent") ||
      !(raw.sha256 === null || typeof raw.sha256 === "string" && SHA256_RE.test(raw.sha256)) ||
      !(raw.mode === null || typeof raw.mode === "string" && /^[0-7]{4}$/.test(raw.mode))) {
      fail("KUSABI_DIRECT_FROZEN_PREIMAGE_INVALID");
    }
    let bytes: Buffer | null = null;
    let backupFile: string | null = null;
    if (raw.state === "file") {
      if (typeof raw.sha256 !== "string" || typeof raw.mode !== "string") {
        fail("KUSABI_DIRECT_FROZEN_PREIMAGE_INVALID");
      }
      const filePath = join(plan.directory, "preimages", `${raw.target_key}.config`);
      backupFile = filePath;
      const backup = await readJsonFileWithHash(filePath, "KUSABI_DIRECT_FROZEN_PREIMAGE_INVALID").catch(async (error) => {
        // Preimages are arbitrary JSON configuration documents; read their exact bytes after the same mode/type check.
        if (!(error instanceof KusabiDirectFleetRolloutError)) throw error;
        const info = await lstat(filePath);
        if (!info.isFile() || info.isSymbolicLink() || modeOf(info.mode) !== "0400") throw error;
        return { value: null, sha256: sha256(await readFile(filePath)) };
      });
      bytes = await readFile(filePath);
      if (backup.sha256 !== raw.sha256) fail("KUSABI_DIRECT_FROZEN_PREIMAGE_INVALID");
    } else if (raw.sha256 !== null || raw.mode !== null) fail("KUSABI_DIRECT_FROZEN_PREIMAGE_INVALID");
    result.push({
      target_key: raw.target_key,
      config_path: raw.config_path,
      state: raw.state,
      raw: bytes,
      sha256: raw.sha256,
      mode: raw.mode,
      backup_file: backupFile,
    });
  }
  if (new Set(result.map(({ target_key }) => target_key)).size !== 35) fail("KUSABI_DIRECT_FROZEN_PREIMAGE_INVALID");
  return result.sort((left, right) => byteCompare(left.target_key, right.target_key));
}

function assertSealedRecord(value: Record<string, unknown>, hashKey: string, code: string): void {
  const observed = value[hashKey];
  const withoutHash = { ...value, [hashKey]: undefined };
  if (typeof observed !== "string" || !SHA256_RE.test(observed) || sha256(canonicalJson(withoutHash)) !== observed) {
    fail(code);
  }
}

function assertFleetSealedRecord(value: Record<string, unknown>, hashKey: string, code: string): void {
  const observed = value[hashKey];
  const withoutHash = { ...value };
  delete withoutHash[hashKey];
  if (typeof observed !== "string" || !SHA256_RE.test(observed) || sha256(fleetEvidenceJson(withoutHash)) !== observed) {
    fail(code);
  }
}

function validatePhaseBindings(
  phase: LoadedPhaseApplyArtifacts,
  plan: LoadedPlanArtifacts,
  cas: KusabiImmutableCasReadback,
  authorization: KusabiDirectRolloutAuthorization,
): void {
  const receipt = phase.receipt;
  if (receipt.plan_seal_sha256 !== plan.seal.plan_seal_sha256 ||
    receipt.cas_readback_sha256 !== cas.readback_sha256 ||
    receipt.initial_preimage_backup_manifest_sha256 !== plan.seal.preimage_backup_manifest_sha256 ||
    canonicalJson(phase.directAuthorization) !== canonicalJson(authorization)) {
    fail("KUSABI_DIRECT_PHASE_BINDING_MISMATCH");
  }
  assertFleetSealedRecord(
    phase.applyReport as unknown as Record<string, unknown>, "report_sha256", "KUSABI_DIRECT_PRIOR_APPLY_INVALID");
  assertSealedRecord(
    phase.placementGate as unknown as Record<string, unknown>, "report_sha256", "KUSABI_DIRECT_PRIOR_APPLY_INVALID");
  const batchIndex = receipt.batch_ordinal - 1;
  const batch = plan.rolloutPlan.batches[batchIndex];
  const expectedBatchIds = plan.rolloutPlan.batches.slice(0, receipt.batch_ordinal).map(({ batch_id }) => batch_id);
  if (!batch || receipt.batch_id !== batch.batch_id || receipt.batch_target_count !== batch.target_keys.length ||
    receipt.minimum_soak_seconds !== batch.minimum_soak_seconds ||
    canonicalJson(receipt.completed_batch_ids) !== canonicalJson(expectedBatchIds) ||
    phase.applyReport.batch_id !== batch.batch_id || phase.placementGate.batch_id !== batch.batch_id ||
    phase.applyReport.failure_code !== null || phase.applyReport.rollback_error_count !== 0 ||
    phase.applyReport.placed_count !== phase.applyReport.attempted_count || phase.placementGate.verdict !== "PASS") {
    fail("KUSABI_DIRECT_PRIOR_APPLY_INVALID");
  }
  const expectedEffects = plan.rolloutPlan.batches.slice(0, receipt.batch_ordinal).flatMap((item) =>
    item.target_keys.map((targetKey) => ({
    target_key: targetKey,
    expected_postimage_sha256: plan.manifest.targets.find(({ target_key }) => target_key === targetKey)!
      .expected.configuration.config_sha256,
    }))).sort((left, right) => byteCompare(left.target_key, right.target_key));
  const observedEffects = receipt.effect_targets.slice().sort((left, right) => byteCompare(left.target_key, right.target_key));
  if (canonicalJson(expectedEffects) !== canonicalJson(observedEffects) ||
    canonicalJson(phase.applyReport.effect_targets.slice().sort((left, right) => byteCompare(left.target_key, right.target_key))) !==
      canonicalJson(expectedEffects.filter(({ target_key }) => batch.target_keys.includes(target_key)))) {
    fail("KUSABI_DIRECT_PHASE_EFFECT_SET_MISMATCH");
  }
  const expectedGateBatchIds = expectedBatchIds.slice(0, -1);
  if (canonicalJson(receipt.durable_gate_reports.map(({ batch_id }) => batch_id)) !== canonicalJson(expectedGateBatchIds) ||
    receipt.durable_gate_reports.some(({ verdict, rollout_plan_sha256, manifest_sha256 }) => verdict !== "PASS" ||
      rollout_plan_sha256 !== plan.rolloutPlan.rollout_plan_sha256 || manifest_sha256 !== plan.manifest.manifest_sha256)) {
    fail("KUSABI_DIRECT_PHASE_GATE_HISTORY_INVALID");
  }
}

function assertExactBatchObservation(
  value: unknown,
  target: LoadedPlanArtifacts["manifest"]["targets"][number],
): KusabiFleetObservedTarget {
  if (!isRecord(value)) fail("KUSABI_DIRECT_GATE_OBSERVATION_INVALID");
  const observation = value as unknown as KusabiFleetObservedTarget;
  requireTimestamp(observation.observed_at, "KUSABI_DIRECT_GATE_OBSERVATION_INVALID");
  assertFleetSealedRecord(value, "observation_sha256", "KUSABI_DIRECT_GATE_OBSERVATION_INVALID");
  if (observation.target_key !== target.target_key || observation.exact !== true ||
    observation.managed_binding_exact !== true || observation.config_exact !== true || observation.build_exact !== true ||
    observation.trust_exact !== true || observation.storage_exact !== true ||
    canonicalJson(observation.deployment) !== canonicalJson(target.expected) ||
    !SHA256_RE.test(observation.config_locator_sha256)) {
    fail("KUSABI_DIRECT_GATE_OBSERVATION_NOT_EXACT", target.target_key);
  }
  return observation;
}

async function validatePriorBatchGateEvidence(
  plan: LoadedPlanArtifacts,
  phase: LoadedPhaseApplyArtifacts,
  observationsPath: string,
  statusPath: string,
  database: KusabiDirectFleetDatabase,
): Promise<{ evidence: KusabiDirectBatchGateEvidence; observations: KusabiFleetObservedTarget[] }> {
  const [observationFile, statusFile] = await Promise.all([
    readJsonFileWithHash(observationsPath, "KUSABI_DIRECT_GATE_OBSERVATIONS_INVALID"),
    readJsonFileWithHash(statusPath, "KUSABI_DIRECT_GATE_STATUS_INVALID"),
  ]);
  if (!Array.isArray(observationFile.value)) fail("KUSABI_DIRECT_GATE_OBSERVATIONS_INVALID");
  const batch = plan.rolloutPlan.batches[phase.receipt.batch_ordinal - 1];
  if (!batch || batch.batch_id !== phase.receipt.batch_id) fail("KUSABI_DIRECT_GATE_BATCH_INVALID");
  const manifestByKey = new Map(plan.manifest.targets.map((target) => [target.target_key, target]));
  const observationMap = new Map<string, KusabiFleetObservedTarget>();
  for (const raw of observationFile.value) {
    const targetKey = isRecord(raw) && typeof raw.target_key === "string" ? raw.target_key : "";
    const target = manifestByKey.get(targetKey);
    if (!target || !batch.target_keys.includes(targetKey) || observationMap.has(targetKey)) {
      fail("KUSABI_DIRECT_GATE_OBSERVATIONS_INVALID");
    }
    observationMap.set(targetKey, assertExactBatchObservation(raw, target));
  }
  const observations = batch.target_keys.map((targetKey) => observationMap.get(targetKey) ??
    fail("KUSABI_DIRECT_GATE_OBSERVATIONS_INCOMPLETE", targetKey));
  const minimumObservationAt = Date.parse(phase.receipt.batch_placed_at) + batch.minimum_soak_seconds * 1_000;
  if (observations.some(({ observed_at }) => Date.parse(observed_at) < minimumObservationAt)) {
    fail("KUSABI_DIRECT_GATE_OBSERVATION_TOO_EARLY");
  }
  if (!isRecord(statusFile.value) || !validateKusabiFleetStatus(statusFile.value).valid) {
    fail("KUSABI_DIRECT_GATE_STATUS_INVALID");
  }
  const status = statusFile.value as unknown as KusabiFleetStatusSnapshot;
  const activeRepeated = status.alerts.filter(({ code, status: alertStatus }) => code === "repeated_degradation" &&
    (alertStatus === "open" || alertStatus === "acknowledged"));
  if (status.summary.open_p0_count !== 0 || status.summary.open_p1_count !== 0) {
    fail("KUSABI_DIRECT_FLEET_STATUS_UNHEALTHY");
  }
  const statusByKey = new Map(status.targets.map((target) => [target.target_key, target]));
  const placedTargetKeys = phase.receipt.effect_targets.map(({ target_key }) => target_key);
  if (placedTargetKeys.some((targetKey) => {
    const target = statusByKey.get(targetKey);
    return !target || target.state === "failed" || target.state === "drifted" || target.state === "not_observed" ||
      target.state !== "healthy" || target.consecutive_degraded !== 0 || target.observed === null ||
      target.observed.evidence_delivery !== "durable" || Date.parse(target.observed.last_event_at) < minimumObservationAt ||
      target.last_seen_at === null || Date.parse(target.last_seen_at) < minimumObservationAt;
  }) || activeRepeated.length !== 0) fail("KUSABI_DIRECT_GATE_STATUS_UNHEALTHY");
  const gate = evaluateKusabiFleetBatchGate(
    plan.rolloutPlan,
    plan.manifest,
    batch.batch_id,
    observations,
    status,
    phase.receipt.durable_gate_reports,
    phase.receipt.batch_placed_at,
  );
  if (gate.verdict !== "PASS" || gate.exact_observed_count !== batch.target_keys.length ||
    gate.healthy_durable_count !== batch.target_keys.length || gate.soak_elapsed_seconds < batch.minimum_soak_seconds ||
    gate.open_p0_count !== 0 || gate.open_p1_count !== 0 || gate.blockers.length !== 0) {
    fail("KUSABI_DIRECT_BATCH_GATE_BLOCKED", gate.blockers.join(","));
  }
  let databaseProof: KusabiDirectDbGateProof;
  try {
    databaseProof = await verifyKusabiDirectDbGate({
      database,
      manifest: plan.manifest,
      batch_id: batch.batch_id,
      batch_target_keys: batch.target_keys,
      placed_target_keys: phase.receipt.effect_targets.map(({ target_key }) => target_key),
      minimum_soak_seconds: batch.minimum_soak_seconds,
      status,
    });
  } catch (error) {
    fail("KUSABI_DIRECT_DB_GATE_BLOCKED", error instanceof Error ? error.message : String(error));
  }
  return {
    evidence: sealBatchGateEvidence({
      plan_seal_sha256: plan.seal.plan_seal_sha256,
      prior_phase_receipt_sha256: phase.receipt.receipt_sha256,
      observations_file_sha256: observationFile.sha256,
      status_file_sha256: statusFile.sha256,
      database_proof: databaseProof,
      gate,
    }),
    observations,
  };
}

async function validatePriorBatchGateWithDatabase(
  options: KusabiDirectFleetRolloutOptions,
  plan: LoadedPlanArtifacts,
  phase: LoadedPhaseApplyArtifacts,
): Promise<{ evidence: KusabiDirectBatchGateEvidence; observations: KusabiFleetObservedTarget[] }> {
  if (options.database) {
    return validatePriorBatchGateEvidence(
      plan,
      phase,
      options.gate_observations_file!,
      options.gate_status_file!,
      options.database,
    );
  }
  const database = new Client({
    connectionString: options.database_url ?? process.env.DATABASE_URL ?? "postgresql:///agent_comms?host=/tmp",
  });
  await database.connect();
  try {
    return await validatePriorBatchGateEvidence(
      plan,
      phase,
      options.gate_observations_file!,
      options.gate_status_file!,
      database,
    );
  } finally {
    await database.end();
  }
}

async function loadPlanArtifacts(path: string): Promise<LoadedPlanArtifacts> {
  if (!isAbsolute(path) || resolve(path) !== path) fail("KUSABI_DIRECT_PLAN_DIR_INVALID");
  const directory = await realpath(path).catch(() => fail("KUSABI_DIRECT_PLAN_DIR_INVALID"));
  const directoryInfo = await lstat(directory);
  if (directory !== path || !directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || modeOf(directoryInfo.mode) !== "0500") {
    fail("KUSABI_DIRECT_PLAN_DIR_INVALID");
  }
  const names = {
    cas: "cas-readback.json",
    inventory: "inventory-snapshot.json",
    manifest: "fleet-manifest.json",
    rolloutPlan: "rollout-plan.json",
    r0Report: "r0-report.json",
    preimageManifest: "preimage-backup-manifest.json",
    seal: "plan-seal.json",
  } as const;
  const loaded = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, name]) => [
    key, await readJsonFile(join(directory, name), "KUSABI_DIRECT_PLAN_ARTIFACT_INVALID"),
  ]))) as unknown as Omit<LoadedPlanArtifacts, "directory">;
  const expectedSeal = sealPlan({
    cas_readback_sha256: (loaded.cas as KusabiImmutableCasReadback).readback_sha256,
    inventory_snapshot_sha256: (loaded.inventory as LoadedPlanArtifacts["inventory"]).snapshot_sha256,
    manifest_sha256: (loaded.manifest as LoadedPlanArtifacts["manifest"]).manifest_sha256,
    rollout_plan_sha256: (loaded.rolloutPlan as LoadedPlanArtifacts["rolloutPlan"]).rollout_plan_sha256,
    r0_report_sha256: (loaded.r0Report as LoadedPlanArtifacts["r0Report"]).report_sha256,
    preimage_backup_manifest_sha256: String((loaded.preimageManifest as Record<string, unknown>).manifest_sha256),
  });
  if (canonicalJson(loaded.seal) !== canonicalJson(expectedSeal)) fail("KUSABI_DIRECT_PLAN_SEAL_MISMATCH");
  return { directory, ...loaded } as LoadedPlanArtifacts;
}

async function makePlanImmutable(outputDir: string): Promise<void> {
  async function visit(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) fail("KUSABI_DIRECT_PLAN_SYMLINK");
    if (info.isDirectory()) {
      for (const child of await readdir(path)) await visit(join(path, child));
      await chmod(path, 0o500);
    } else if (info.isFile()) {
      await chmod(path, 0o400);
    } else fail("KUSABI_DIRECT_PLAN_NODE_INVALID");
  }
  await visit(outputDir);
}

function normalizedPreimageManifest(value: Record<string, unknown>): unknown {
  const preimages = Array.isArray(value.preimages) ? value.preimages.map((item) => {
    if (!isRecord(item)) return item;
    const { backup_file: _backupFile, ...rest } = item;
    return rest;
  }) : value.preimages;
  return {
    schema_version: value.schema_version,
    target_count: value.target_count,
    file_preimage_count: value.file_preimage_count,
    absent_preimage_count: value.absent_preimage_count,
    preimages,
  };
}

function sealPlacementGate(
  planSha256: string,
  manifestSha256: string,
  batch: { batch_id: string; stage: "r1" | "r2" | "r3"; target_keys: string[] },
): KusabiFleetPlacementGateReport {
  const withoutHash = {
    schema_version: "wasurezu-fleet-placement-gate/v1" as const,
    rollout_plan_sha256: planSha256,
    manifest_sha256: manifestSha256,
    batch_id: batch.batch_id,
    stage: batch.stage,
    target_count: batch.target_keys.length,
    exact_observed_count: batch.target_keys.length,
    verdict: "PASS" as const,
    blockers: [],
  };
  return { ...withoutHash, report_sha256: sha256(canonicalJson(withoutHash)) };
}

function sealDirectReport(
  value: Omit<KusabiDirectFleetRolloutReport, "report_sha256">,
): KusabiDirectFleetRolloutReport {
  return { ...value, report_sha256: sha256(canonicalJson(value)) };
}

async function assertCasUnchanged(expected: KusabiImmutableCasReadback): Promise<void> {
  const observed = await readImmutableKusabiCasRoot(expected.runtime_root);
  if (observed.readback_sha256 !== expected.readback_sha256 ||
    observed.root_device !== expected.root_device || observed.root_inode !== expected.root_inode ||
    observed.descriptor_device !== expected.descriptor_device || observed.descriptor_inode !== expected.descriptor_inode) {
    fail("KUSABI_DIRECT_CAS_DRIFT");
  }
}

function failureDetails(error: unknown): { code: string; message: string } {
  if (error instanceof KusabiDirectFleetRolloutError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: "KUSABI_DIRECT_APPLY_FAILED", message: error.message };
  return { code: "KUSABI_DIRECT_APPLY_FAILED", message: String(error) };
}

export async function runKusabiDirectFleetRollout(
  options: KusabiDirectFleetRolloutOptions,
): Promise<KusabiDirectFleetRolloutReport> {
  const apply = options.apply === true;
  const finalize = options.finalize === true;
  const resumeBatch = options.resume_batch;
  if (finalize && !apply) fail("KUSABI_DIRECT_FINALIZE_REQUIRES_APPLY");
  if (finalize && resumeBatch !== undefined) fail("KUSABI_DIRECT_FINALIZE_WITH_RESUME_INVALID");
  if (resumeBatch !== undefined && !apply) fail("KUSABI_DIRECT_RESUME_REQUIRES_APPLY");
  if (apply && options.output_dir === undefined) fail("KUSABI_DIRECT_APPLY_OUTPUT_DIR_REQUIRED");
  if (apply && (!options.plan_dir || !options.authorization_file)) {
    fail("KUSABI_DIRECT_FROZEN_PLAN_AND_AUTHORIZATION_REQUIRED");
  }
  if ((resumeBatch !== undefined || finalize) &&
    (!options.prior_apply_dir || !options.gate_observations_file || !options.gate_status_file)) {
    fail("KUSABI_DIRECT_RESUME_EVIDENCE_REQUIRED");
  }
  if (options.storage_binding_sha256 !== undefined && !SHA256_RE.test(options.storage_binding_sha256)) {
    fail("KUSABI_DIRECT_STORAGE_BINDING_INVALID");
  }
  const loadedPlan = apply ? await loadPlanArtifacts(options.plan_dir!) : undefined;
  const capturedAt = loadedPlan?.inventory.source.captured_at ?? options.captured_at ?? new Date().toISOString();
  const activationAt = loadedPlan?.manifest.targets[0]?.activation_at ?? options.activation_at ?? capturedAt;
  const deadlineAt = loadedPlan?.manifest.targets[0]?.durable_evidence_deadline_at ??
    options.durable_evidence_deadline_at ?? new Date(Date.parse(activationAt) + 6 * 60 * 60 * 1000).toISOString();
  requireTimestamp(capturedAt, "KUSABI_DIRECT_CAPTURE_TIME_INVALID");
  requireTimestamp(activationAt, "KUSABI_DIRECT_ACTIVATION_TIME_INVALID");
  requireTimestamp(deadlineAt, "KUSABI_DIRECT_DEADLINE_INVALID");
  if (Date.parse(activationAt) >= Date.parse(deadlineAt)) fail("KUSABI_DIRECT_DEADLINE_INVALID");

  const cas = await readImmutableKusabiCasRoot(options.cas_root);
  if (apply && options.test_allow_external_deployer !== true) {
    const expectedDeployer = join(cas.runtime_root, "dist", "kusabi-direct-fleet-rollout.js");
    const actualDeployer = await realpath(fileURLToPath(import.meta.url));
    if (actualDeployer !== expectedDeployer ||
      sha256(await readFile(actualDeployer)) !== cas.required_entrypoint_sha256_map["dist/kusabi-direct-fleet-rollout.js"]) {
      fail("KUSABI_DIRECT_DEPLOYER_NOT_EXACT_CAS");
    }
  }
  if (loadedPlan && canonicalJson(cas) !== canonicalJson(loadedPlan.cas)) {
    fail("KUSABI_DIRECT_PLAN_CAS_MISMATCH");
  }
  if (apply && options.expected_head !== undefined && cas.source_commit !== options.expected_head) {
    fail("KUSABI_DIRECT_AUTHORIZATION_HEAD_MISMATCH");
  }
  const directAuthorization = apply
    ? assertAuthorization(
      await readJsonFile(options.authorization_file!, "KUSABI_DIRECT_AUTHORIZATION_INVALID"),
      loadedPlan!.seal,
      cas,
    )
    : undefined;
  const priorPhase = resumeBatch === undefined && !finalize
    ? undefined
    : await loadPhaseApplyArtifacts(options.prior_apply_dir!);
  if (priorPhase) validatePhaseBindings(priorPhase, loadedPlan!, cas, directAuthorization!);
  const ownedDatabase = options.database === undefined;
  const database = options.database ?? new Client({
    connectionString: options.database_url ?? process.env.DATABASE_URL ?? "postgresql:///agent_comms?host=/tmp",
  });
  if (ownedDatabase) await (database as Client).connect();
  let collected: Awaited<ReturnType<typeof collectDirectTargets>>;
  try {
    collected = await collectDirectTargets(
      database,
      options.trust_paths ?? defaultTrustPaths(),
      options.storage_binding_sha256 ?? DEFAULT_STORAGE_BINDING_SHA256,
      options.workspace_root ?? "/Users/yuji/Developer",
    );
  } finally {
    if (ownedDatabase && database.end) await database.end();
  }

  // The installed SessionStart command pins the immutable R0 manifest rather
  // than relying on an ambient environment variable. This path participates
  // in the desired configuration hash, so apply must reproduce the exact
  // audited plan directory.
  const runtimeEventManifestPath = loadedPlan
    ? join(loadedPlan.directory, "fleet-manifest.json")
    : options.output_dir === undefined
      ? undefined
      : join(resolve(options.output_dir), "fleet-manifest.json");
  for (const descriptor of collected.descriptors) {
    if (runtimeEventManifestPath !== undefined) {
      descriptor.target.runtime_event_manifest_path = runtimeEventManifestPath;
    }
  }

  const inventorySnapshot = sealKusabiFleetInventorySnapshot({
    schema_version: "kusabi-fleet-inventory-snapshot/v1",
    source: {
      kind: "agent_comms_postgres",
      query_contract_id: "kusabi-fleet-eligibility/v1",
      query_contract_sha256: KUSABI_FLEET_INVENTORY_QUERY_CONTRACT_SHA256,
      captured_at: capturedAt,
    },
    bindings: collected.descriptors.map(({ inventory }) => inventory),
  });
  const r0 = await prepareKusabiFleetR0({
    manifest_id: loadedPlan?.manifest.manifest_id ?? options.manifest_id ??
      `kusabi-direct-${capturedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    manifest_version: 1,
    rollout_id: loadedPlan?.rolloutPlan.rollout_id ?? options.rollout_id ??
      `direct-${capturedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    runtime_root: cas.runtime_root,
    commit_sha: cas.source_commit,
    tree_sha: cas.source_tree,
    activation_at: activationAt,
    durable_evidence_deadline_at: deadlineAt,
    stale_after_seconds: 900,
    captured_at: capturedAt,
    batch_order: BATCH_ORDER,
    inventory_snapshot: inventorySnapshot,
    targets: collected.descriptors.map(({ target }) => target),
  });
  if (loadedPlan && (
    canonicalJson(r0.inventory_snapshot) !== canonicalJson(loadedPlan.inventory) ||
    canonicalJson(r0.manifest) !== canonicalJson(loadedPlan.manifest) ||
    canonicalJson(r0.rollout_plan) !== canonicalJson(loadedPlan.rolloutPlan) ||
    (priorPhase === undefined && canonicalJson(r0.report) !== canonicalJson(loadedPlan.r0Report))
  )) fail("KUSABI_DIRECT_FROZEN_PLAN_REPRODUCTION_MISMATCH");

  const nextBatch = priorPhase
    ? loadedPlan!.rolloutPlan.batches[priorPhase.receipt.batch_ordinal]
    : undefined;
  if (priorPhase && finalize !== (nextBatch === undefined)) {
    fail("KUSABI_DIRECT_FINALIZE_PHASE_INVALID");
  }
  if (priorPhase && !finalize && nextBatch?.batch_id !== resumeBatch) {
    fail("KUSABI_DIRECT_RESUME_BATCH_NOT_NEXT", `${resumeBatch}:${nextBatch?.batch_id ?? "complete"}`);
  }
  const priorBatchGate = priorPhase
    ? await validatePriorBatchGateWithDatabase(options, loadedPlan!, priorPhase)
    : undefined;

  let outputDir: string | undefined;
  if (options.output_dir !== undefined) {
    outputDir = await createOutputDirectory(options.output_dir);
    await writeBaseArtifacts(outputDir, apply ? {
      inventory_snapshot: loadedPlan!.inventory,
      manifest: loadedPlan!.manifest,
      rollout_plan: loadedPlan!.rolloutPlan,
      report: loadedPlan!.r0Report,
    } as Awaited<ReturnType<typeof prepareKusabiFleetR0>> : r0, cas);
  }
  const reportBase = {
    mode: apply ? "apply" as const : "dry-run" as const,
    captured_at: capturedAt,
    cas_readback: cas,
    target_snapshot: {
      primary_count: collected.primary_count,
      secondary_count: collected.secondary_count,
      target_count: collected.descriptors.length,
      snapshot_sha256: inventorySnapshot.snapshot_sha256,
    },
    rollout: {
      manifest_sha256: r0.manifest.manifest_sha256,
      rollout_plan_sha256: r0.rollout_plan.rollout_plan_sha256,
      batch_count: r0.rollout_plan.batches.length,
    },
    r0_report_sha256: loadedPlan?.r0Report.report_sha256 ?? r0.report.report_sha256,
  };
  const targetKeyByTuple = new Map(r0.manifest.targets.map((target) => [
    targetTuple(target.identity.agent_id, target.identity.project, target.identity.host_runtime),
    target.target_key,
  ]));
  const targets = collected.descriptors.map(({ target }) => target);
  const currentPreimages = await readConfigPreimages(targets, targetKeyByTuple);
  const frozenPreimages = loadedPlan ? await loadFrozenPreimages(loadedPlan) : currentPreimages;
  const r0ByKey = new Map((loadedPlan?.r0Report ?? r0.report).targets.map((target) => [target.target_key, target]));
  const completedEffects = new Map(priorPhase?.receipt.effect_targets.map((target) =>
    [target.target_key, target.expected_postimage_sha256]) ?? []);
  const frozenByKey = new Map(frozenPreimages.map((preimage) => [preimage.target_key, preimage]));
  for (const current of currentPreimages) {
    const frozen = frozenByKey.get(current.target_key);
    const evidence = r0ByKey.get(current.target_key);
    if (!frozen || !evidence || evidence.preimage_state !== frozen.state || evidence.preimage_sha256 !== frozen.sha256 ||
      evidence.preimage_mode !== frozen.mode) fail("KUSABI_DIRECT_FROZEN_PREIMAGE_INVALID", current.target_key);
    const expectedCompletedPostimage = completedEffects.get(current.target_key);
    if (expectedCompletedPostimage !== undefined) {
      if (current.state !== "file" || current.sha256 !== expectedCompletedPostimage) {
        fail("KUSABI_DIRECT_RESUME_CONFIG_DRIFT", current.target_key);
      }
    } else if (current.state !== frozen.state || current.sha256 !== frozen.sha256 || current.mode !== frozen.mode) {
      fail("KUSABI_DIRECT_PREIMAGE_DRIFT", current.target_key);
    }
  }
  const preimages = frozenPreimages;
  if (!apply) {
    const report = sealDirectReport({
      schema_version: "kusabi-direct-fleet-rollout-report/v1",
      ...reportBase,
      status: "planned",
      apply_reports: [],
      placement_gate_reports: [],
      observations: [],
      summary: {
        planned_count: collected.descriptors.length,
        placed_count: 0,
        postimage_exact_count: 0,
        trust_exact_count: r0.report.targets.filter(({ preimage_trust_exact }) => preimage_trust_exact).length,
        automatic_receive_ready_count: 0,
        storage_observed_count: 0,
        rollback_count: 0,
        rollback_error_count: 0,
      },
      trust_blockers: r0.report.targets.filter(({ preimage_trust_exact }) => !preimage_trust_exact).map((target) => ({
        target_key: target.target_key,
        host_runtime: target.host_runtime,
      })),
      evidence_errors: [],
      failure: null,
      phase_receipt: null,
      prior_batch_gate: null,
      final_durable_gate_reports: [],
    });
    if (outputDir) {
      const preimageManifest = await persistPreimages(outputDir, preimages);
      const planSeal = sealPlan({
        cas_readback_sha256: cas.readback_sha256,
        inventory_snapshot_sha256: r0.inventory_snapshot.snapshot_sha256,
        manifest_sha256: r0.manifest.manifest_sha256,
        rollout_plan_sha256: r0.rollout_plan.rollout_plan_sha256,
        r0_report_sha256: r0.report.report_sha256,
        preimage_backup_manifest_sha256: String(preimageManifest.manifest_sha256),
      });
      await writeJson(join(outputDir, "plan-seal.json"), planSeal);
      await writeJson(join(outputDir, "direct-rollout-report.json"), report);
      await makePlanImmutable(outputDir);
    }
    return report;
  }

  if (!outputDir) fail("KUSABI_DIRECT_APPLY_OUTPUT_DIR_REQUIRED");
  const applyPreimageManifest = await persistPreimages(outputDir, preimages);
  if (canonicalJson(normalizedPreimageManifest(applyPreimageManifest)) !==
    canonicalJson(normalizedPreimageManifest(loadedPlan!.preimageManifest))) {
    fail("KUSABI_DIRECT_FROZEN_PREIMAGE_MISMATCH");
  }
  const authorization = sealKusabiFleetRolloutAuthorization({
    schema_version: "kusabi-fleet-rollout-authorization/v1",
    decision_id: directAuthorization!.decision_id,
    approved: true,
    implementation_head_sha: cas.source_commit,
    implementation_tree_sha: cas.source_tree,
    manifest_sha256: r0.manifest.manifest_sha256,
    rollout_plan_sha256: r0.rollout_plan.rollout_plan_sha256,
    decision_ref_sha256: directAuthorization!.decision_ref_sha256,
  });
  if (priorPhase && priorPhase.receipt.rollout_authorization_sha256 !== authorization.authorization_sha256) {
    fail("KUSABI_DIRECT_PHASE_BINDING_MISMATCH");
  }
  await writeJson(join(outputDir, "direct-authorization.json"), directAuthorization);
  await writeJson(join(outputDir, "rollout-authorization.json"), authorization);
  if (priorBatchGate) await writeJson(join(outputDir, "prior-batch-gate.json"), priorBatchGate.evidence);

  if (finalize) {
    const durableGateReports = [
      ...priorPhase!.receipt.durable_gate_reports,
      priorBatchGate!.evidence.gate,
    ];
    if (durableGateReports.length !== r0.rollout_plan.batches.length ||
      durableGateReports.some((gate, index) => gate.batch_id !== r0.rollout_plan.batches[index].batch_id ||
        gate.verdict !== "PASS")) {
      fail("KUSABI_DIRECT_FINALIZE_GATE_HISTORY_INVALID");
    }
    await assertCasUnchanged(cas);
    const report = sealDirectReport({
      schema_version: "kusabi-direct-fleet-rollout-report/v1",
      ...reportBase,
      status: "applied",
      apply_reports: [],
      placement_gate_reports: [],
      observations: priorBatchGate!.observations,
      summary: {
        planned_count: targets.length,
        placed_count: 0,
        postimage_exact_count: priorBatchGate!.observations.length,
        trust_exact_count: priorBatchGate!.observations.filter(({ trust_exact }) => trust_exact).length,
        automatic_receive_ready_count: priorBatchGate!.observations.filter(({ exact }) => exact).length,
        storage_observed_count: priorBatchGate!.observations.filter(({ storage_exact }) => storage_exact).length,
        rollback_count: 0,
        rollback_error_count: 0,
      },
      trust_blockers: [],
      evidence_errors: [],
      failure: null,
      phase_receipt: priorPhase!.receipt,
      prior_batch_gate: priorBatchGate!.evidence,
      final_durable_gate_reports: durableGateReports,
    });
    await writeJson(join(outputDir, "final-closure-report.json"), report);
    await writeJson(join(outputDir, "direct-rollout-report.json"), report);
    await makePlanImmutable(outputDir);
    return report;
  }

  const applyReports: KusabiFleetApplyBatchReport[] = [];
  const placementGates: KusabiFleetPlacementGateReport[] = [];
  const observations: KusabiFleetObservedTarget[] = [];
  let rollbackCount = 0;
  const rollbackErrors: string[] = [];
  try {
    const manifestByKey = new Map(r0.manifest.targets.map((target) => [target.target_key, target]));
    const inputByKey = new Map(targets.map((target) => [targetKeyByTuple.get(targetIdentityTuple(target)), target]));
    const preimageByKey = new Map(preimages.map((preimage) => [preimage.target_key, preimage]));
    const priorGateReports: KusabiFleetBatchGateReport[] = priorPhase
      ? [...priorPhase.receipt.durable_gate_reports, priorBatchGate!.evidence.gate]
      : [];
    const batchIndex = priorPhase?.receipt.batch_ordinal ?? 0;
    const batch = r0.rollout_plan.batches[batchIndex] ?? fail("KUSABI_DIRECT_ROLLOUT_ALREADY_COMPLETE");
    if (resumeBatch !== undefined && resumeBatch !== batch.batch_id) {
      fail("KUSABI_DIRECT_RESUME_BATCH_NOT_NEXT", `${resumeBatch}:${batch.batch_id}`);
    }
      await assertCasUnchanged(cas);
      for (const targetKey of batch.target_keys) {
        const preimage = preimageByKey.get(targetKey) ?? fail("KUSABI_DIRECT_PREIMAGE_MISSING", targetKey);
        await assertPreimageStillCurrent(preimage);
      }
      const batchInputs = batch.target_keys.map((targetKey) => inputByKey.get(targetKey) ?? fail(
        "KUSABI_DIRECT_BATCH_TARGET_INPUT_MISSING",
        targetKey,
      ));
      const applyReport = await applyKusabiFleetRolloutBatch({
        plan: r0.rollout_plan,
        manifest: r0.manifest,
        inventory_snapshot: r0.inventory_snapshot,
        authorization,
        batch_id: batch.batch_id,
        runtime_root: cas.runtime_root,
        targets: batchInputs,
        prior_gate_reports: priorGateReports,
        test_before_target_apply: options.test_before_target_apply,
        test_before_target_rollback: options.test_before_target_rollback,
      });
      applyReports.push(applyReport);
      await writeJson(join(outputDir, `apply-${batch.batch_id}.json`), applyReport);
      await options.on_batch_applied?.(batch.batch_id, applyReport);

      const batchObservations: KusabiFleetObservedTarget[] = [];
      for (const targetKey of batch.target_keys) {
        const input = inputByKey.get(targetKey) ?? fail("KUSABI_DIRECT_OBSERVATION_INPUT_MISSING", targetKey);
        const manifestTarget = manifestByKey.get(targetKey) ?? fail("KUSABI_DIRECT_MANIFEST_TARGET_MISSING", targetKey);
        const observation = await observeKusabiFleetDeployment({
          target: manifestTarget,
          workspace: input.workspace,
          runtime_root: cas.runtime_root,
          binding_source_ref: input.binding_source_ref,
          trust_source: input.trust_source,
          observed_storage: input.storage,
          storage_observed: false,
          observed_commit_sha: cas.source_commit,
          observed_tree_sha: cas.source_tree,
          observed_at: new Date().toISOString(),
          runtime_event_manifest_path: input.runtime_event_manifest_path,
        });
        const placementExact = observation.managed_binding_exact && observation.config_exact && observation.build_exact &&
          observation.deployment.configuration.binding_source_ref_sha256 ===
            manifestTarget.expected.configuration.binding_source_ref_sha256;
        if (!placementExact) fail("KUSABI_DIRECT_POSTIMAGE_NOT_EXACT", [
          targetKey,
          `managed_binding_exact=${observation.managed_binding_exact}`,
          `config_exact=${observation.config_exact}`,
          `build_exact=${observation.build_exact}`,
          `binding_source_exact=${observation.deployment.configuration.binding_source_ref_sha256 ===
            manifestTarget.expected.configuration.binding_source_ref_sha256}`,
        ].join(":"));
        batchObservations.push(observation);
      }
      observations.push(...batchObservations);
      await assertCasUnchanged(cas);
      const placementGate = sealPlacementGate(
        r0.rollout_plan.rollout_plan_sha256,
        r0.manifest.manifest_sha256,
        batch,
      );
      placementGates.push(placementGate);
      await writeJson(join(outputDir, `placement-gate-${batch.batch_id}.json`), {
        schema_version: "kusabi-direct-placement-gate/v1",
        basis: "configuration_postimage_exact_without_trust_or_durable_evidence",
        placement_gate: placementGate,
        trust_exact_count: batchObservations.filter(({ trust_exact }) => trust_exact).length,
        target_count: batch.target_keys.length,
      });
    const effectTargets = [
      ...(priorPhase?.receipt.effect_targets ?? []),
      ...applyReport.effect_targets,
    ].sort((left, right) => byteCompare(left.target_key, right.target_key));
    const receipt = sealPhaseReceipt({
      plan_seal_sha256: loadedPlan!.seal.plan_seal_sha256,
      cas_readback_sha256: cas.readback_sha256,
      direct_authorization_sha256: directAuthorization!.authorization_sha256,
      rollout_authorization_sha256: authorization.authorization_sha256,
      initial_preimage_backup_manifest_sha256: loadedPlan!.seal.preimage_backup_manifest_sha256,
      prior_phase_receipt_sha256: priorPhase?.receipt.receipt_sha256 ?? null,
      prior_gate_evidence_sha256: priorBatchGate?.evidence.evidence_sha256 ?? null,
      completed_batch_ids: r0.rollout_plan.batches.slice(0, batchIndex + 1).map(({ batch_id }) => batch_id),
      batch_id: batch.batch_id,
      batch_ordinal: batchIndex + 1,
      batch_target_count: batch.target_keys.length,
      batch_placed_at: new Date().toISOString(),
      minimum_soak_seconds: batch.minimum_soak_seconds,
      apply_report_sha256: applyReport.report_sha256,
      placement_gate_sha256: placementGate.report_sha256,
      durable_gate_reports: priorGateReports,
      effect_targets: effectTargets,
    });
    const trustBlockers = observations.filter(({ trust_exact }) => !trust_exact).map((observation) => ({
      target_key: observation.target_key,
      host_runtime: r0.manifest.targets.find(({ target_key }) => target_key === observation.target_key)!.identity.host_runtime,
    }));
    const report = sealDirectReport({
      schema_version: "kusabi-direct-fleet-rollout-report/v1",
      ...reportBase,
      status: "phase_gate_required",
      apply_reports: applyReports,
      placement_gate_reports: placementGates,
      observations: observations.sort((left, right) => byteCompare(left.target_key, right.target_key)),
      summary: {
        planned_count: targets.length,
        placed_count: applyReports.reduce((sum, report) => sum + report.placed_count, 0),
        postimage_exact_count: observations.filter((observation) => observation.managed_binding_exact &&
          observation.config_exact && observation.build_exact).length,
        trust_exact_count: observations.filter(({ trust_exact }) => trust_exact).length,
        automatic_receive_ready_count: observations.filter(({ exact }) => exact).length,
        storage_observed_count: observations.filter(({ storage_exact }) => storage_exact).length,
        rollback_count: 0,
        rollback_error_count: 0,
      },
      trust_blockers: trustBlockers,
      evidence_errors: [],
      failure: null,
      phase_receipt: receipt,
      prior_batch_gate: priorBatchGate?.evidence ?? null,
      final_durable_gate_reports: [],
    });
    await writeJson(join(outputDir, "phase-receipt.json"), receipt);
    await writeJson(join(outputDir, "observations.json"), report.observations);
    await writeJson(join(outputDir, "direct-rollout-report.json"), report);
    await makePlanImmutable(outputDir);
    return report;
  } catch (error) {
    let partialApplyReport: KusabiFleetApplyBatchReport | undefined;
    if (error instanceof KusabiFleetRolloutError && error.apply_report !== undefined &&
      !applyReports.some(({ batch_id }) => batch_id === error.apply_report!.batch_id)) {
      partialApplyReport = error.apply_report;
      applyReports.push(partialApplyReport);
    }
    const appliedPostimages = new Map(applyReports.flatMap((report) =>
      report.effect_targets.map((target) => [target.target_key, target.expected_postimage_sha256] as const)
    ));
    const preimageByKey = new Map(preimages.map((preimage) => [preimage.target_key, preimage]));
    for (const [targetKey, postimageSha256] of [...appliedPostimages].reverse()) {
      try {
        const preimage = preimageByKey.get(targetKey) ?? fail("KUSABI_DIRECT_PREIMAGE_MISSING", targetKey);
        await restorePreimage(preimage, postimageSha256);
        rollbackCount++;
      } catch (rollbackError) {
        rollbackErrors.push(`${targetKey}:${failureDetails(rollbackError).message}`);
      }
    }
    const failure = error instanceof KusabiFleetRolloutError && error.apply_report?.failure_code
      ? { code: error.apply_report.failure_code, message: error.apply_report.failure_code }
      : failureDetails(error);
    const evidenceErrors: KusabiDirectFleetRolloutReport["evidence_errors"] = [];
    const partialArtifact = partialApplyReport === undefined ? null : `apply-${partialApplyReport.batch_id}.json`;
    if (partialApplyReport !== undefined && partialArtifact !== null) {
      try {
        await writeJson(join(outputDir, partialArtifact), partialApplyReport);
      } catch (evidenceError) {
        evidenceErrors.push({
          artifact: partialArtifact,
          code: typeof (evidenceError as NodeJS.ErrnoException).code === "string"
            ? String((evidenceError as NodeJS.ErrnoException).code)
            : "KUSABI_DIRECT_EVIDENCE_WRITE_FAILED",
        });
      }
    }
    const buildFailureReport = () => sealDirectReport({
      schema_version: "kusabi-direct-fleet-rollout-report/v1",
      ...reportBase,
      status: rollbackErrors.length === 0 ? "failed_rolled_back" : "failed_rollback_incomplete",
      apply_reports: applyReports,
      placement_gate_reports: placementGates,
      observations,
      summary: {
        planned_count: targets.length,
        placed_count: applyReports.reduce((sum, report) => sum + report.placed_count, 0),
        postimage_exact_count: observations.filter((observation) => observation.managed_binding_exact &&
          observation.config_exact && observation.build_exact).length,
        trust_exact_count: observations.filter(({ trust_exact }) => trust_exact).length,
        automatic_receive_ready_count: observations.filter(({ exact }) => exact).length,
        storage_observed_count: observations.filter(({ storage_exact }) => storage_exact).length,
        rollback_count: rollbackCount,
        rollback_error_count: rollbackErrors.length,
      },
      trust_blockers: observations.filter(({ trust_exact }) => !trust_exact).map((observation) => ({
        target_key: observation.target_key,
        host_runtime: r0.manifest.targets.find(({ target_key }) => target_key === observation.target_key)!.identity.host_runtime,
      })),
      evidence_errors: evidenceErrors,
      failure: rollbackErrors.length === 0 ? failure : {
        code: "KUSABI_DIRECT_ROLLBACK_INCOMPLETE",
        message: `${failure.message}; ${rollbackErrors.join(";")}`,
      },
      phase_receipt: priorPhase?.receipt ?? null,
      prior_batch_gate: priorBatchGate?.evidence ?? null,
      final_durable_gate_reports: [],
    });
    // Configuration recovery above never depends on evidence-directory
    // availability. Persist only after every rollback attempt has completed.
    let report = buildFailureReport();
    try {
      await writeJson(join(outputDir, "direct-rollout-failure-report.json"), report);
    } catch (evidenceError) {
      evidenceErrors.push({
        artifact: "direct-rollout-failure-report.json",
        code: typeof (evidenceError as NodeJS.ErrnoException).code === "string"
          ? String((evidenceError as NodeJS.ErrnoException).code)
          : "KUSABI_DIRECT_EVIDENCE_WRITE_FAILED",
      });
      report = buildFailureReport();
    }
    throw new KusabiDirectFleetRolloutError(report.failure!.code, report.failure!.message, report);
  }
}

interface CliArgs {
  cas_root?: string;
  expected_head?: string;
  output_dir?: string;
  plan_dir?: string;
  authorization_file?: string;
  resume_batch?: string;
  prior_apply_dir?: string;
  gate_observations_file?: string;
  gate_status_file?: string;
  database_url?: string;
  captured_at?: string;
  activation_at?: string;
  deadline_at?: string;
  manifest_id?: string;
  rollout_id?: string;
  decision_id?: string;
  decision_ref?: string;
  storage_binding_sha256?: string;
  apply: boolean;
  finalize: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { apply: false, finalize: false, help: false };
  const valueKeys = new Set([
    "cas-root", "expected-head", "output-dir", "plan-dir", "authorization-file", "database-url",
    "resume-batch", "prior-apply-dir", "gate-observations-file", "gate-status-file",
    "captured-at", "activation-at", "deadline-at",
    "manifest-id", "rollout-id", "decision-id", "decision-ref", "storage-binding-sha256",
  ]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }
    if (arg === "--finalize") {
      parsed.finalize = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (!arg.startsWith("--") || !valueKeys.has(arg.slice(2))) fail("KUSABI_DIRECT_ARGUMENT_INVALID", arg);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail("KUSABI_DIRECT_ARGUMENT_VALUE_MISSING", arg);
    (parsed as unknown as Record<string, string | boolean>)[arg.slice(2).replace(/-/g, "_")] = value;
    index++;
  }
  return parsed;
}

function usage(): string {
  return [
    "Usage: kusabi-direct-fleet-rollout --cas-root <absolute-CAS-path> [options]",
    "",
    "Plan is the default. Apply consumes an immutable, independently audited plan.",
    "",
    "  --apply                         Apply the frozen plan in staged configuration batches",
    "  --finalize                      Gate and seal the final phase without applying another batch",
    "  --expected-head <40-hex>        Exact authorized release HEAD (required with --apply)",
    "  --output-dir <absolute-path>    New evidence/backup directory (required with --apply)",
    "  --plan-dir <absolute-path>      Immutable plan directory (required with --apply)",
    "  --authorization-file <path>     Exact external authorization artifact (required with --apply)",
    "  --resume-batch <batch-id>        Apply exactly the next batch after its prior durable gate",
    "  --prior-apply-dir <path>         Immutable immediately-prior phase evidence directory",
    "  --gate-observations-file <path>  Immutable exact observations for the prior batch",
    "  --gate-status-file <path>        Immutable durable activated-target status JSON",
    "  --database-url <postgres-url>   Defaults to DATABASE_URL or local agent_comms",
    "  --captured-at <ISO-UTC>         Inventory capture timestamp",
    "  --activation-at <ISO-UTC>       Manifest activation timestamp",
    "  --deadline-at <ISO-UTC>         Durable evidence deadline",
    "  --decision-id <id>              Explicit owner decision ID (required with --apply)",
    "  --decision-ref <text>           Exact owner decision reference (required with --apply)",
    "  --storage-binding-sha256 <hex>  Override the pinned production storage identity",
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.cas_root) fail("KUSABI_DIRECT_CAS_ROOT_REQUIRED");
  const report = await runKusabiDirectFleetRollout({
    cas_root: args.cas_root,
    apply: args.apply,
    finalize: args.finalize,
    expected_head: args.expected_head,
    output_dir: args.output_dir,
    plan_dir: args.plan_dir,
    authorization_file: args.authorization_file,
    resume_batch: args.resume_batch,
    prior_apply_dir: args.prior_apply_dir,
    gate_observations_file: args.gate_observations_file,
    gate_status_file: args.gate_status_file,
    database_url: args.database_url,
    captured_at: args.captured_at,
    activation_at: args.activation_at,
    durable_evidence_deadline_at: args.deadline_at,
    manifest_id: args.manifest_id,
    rollout_id: args.rollout_id,
    decision_id: args.decision_id,
    decision_ref: args.decision_ref,
    storage_binding_sha256: args.storage_binding_sha256,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const details = failureDetails(error);
    process.stderr.write(`${JSON.stringify({ ok: false, ...details }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
