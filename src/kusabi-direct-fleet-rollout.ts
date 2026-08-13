#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  KUSABI_FLEET_INVENTORY_QUERY_CONTRACT_SHA256,
  applyKusabiFleetRolloutBatch,
  observeKusabiFleetDeployment,
  prepareKusabiFleetR0,
  sealKusabiFleetInventorySnapshot,
  sealKusabiFleetRolloutAuthorization,
  type KusabiFleetApplyBatchReport,
  type KusabiFleetPlacementGateReport,
  type KusabiFleetInventoryBindingInput,
  type KusabiFleetObservedTarget,
  type KusabiFleetRolloutTargetInput,
  type KusabiFleetTrustSource,
} from "./kusabi-fleet-rollout.js";
import type { KusabiHostRuntime } from "./kusabi-fleet-status.js";

const EXPECTED_PRIMARY_COUNT = 33;
const EXPECTED_SECONDARY_COUNT = 2;
const EXPECTED_TARGET_COUNT = EXPECTED_PRIMARY_COUNT + EXPECTED_SECONDARY_COUNT;
const DEFAULT_STORAGE_BINDING_SHA256 = "a1330147bbb614ff7c4670c7bea004a16d7b7a5d7f7055374cb3ef1522db4869";
const SHA256_RE = /^[a-f0-9]{64}$/;
const GIT_SHA_RE = /^[a-f0-9]{40}$/;
const REQUIRED_ENTRYPOINTS = [
  "dist/claude-session-start.js",
  "dist/codex-session-start.js",
  "dist/gemini-session-start.js",
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
  { batch_id: "r2-pilot", stage: "r2" as const, ordinal: 2, minimum_soak_seconds: 0 },
  { batch_id: "r3-wave-01", stage: "r3" as const, ordinal: 3, minimum_soak_seconds: 0 },
  { batch_id: "r3-wave-02", stage: "r3" as const, ordinal: 4, minimum_soak_seconds: 0 },
  { batch_id: "r3-wave-03", stage: "r3" as const, ordinal: 5, minimum_soak_seconds: 0 },
  { batch_id: "r3-wave-04", stage: "r3" as const, ordinal: 6, minimum_soak_seconds: 0 },
  { batch_id: "r3-wave-05", stage: "r3" as const, ordinal: 7, minimum_soak_seconds: 0 },
];

export interface KusabiDirectFleetDatabase {
  query<T>(sql: string): Promise<{ rows: T[] }>;
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
  expected_head?: string;
  output_dir?: string;
  plan_dir?: string;
  authorization_file?: string;
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
    "failed_rolled_back" | "failed_rollback_incomplete";
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
  failure: { code: string; message: string } | null;
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

function trustSource(host: KusabiHostRuntime, paths: KusabiDirectTrustPaths): KusabiFleetTrustSource {
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
    tuple === "kusabi/agent-memory/gemini_cli") return { stage: "r1", batch_id: "r1-kusabi" };
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
        trust_source: trustSource(host, trustPaths),
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
  for (const host of ["claude_code", "gemini_cli"] as const) {
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
        trust_source: trustSource(host, trustPaths),
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
  if (apply && options.output_dir === undefined) fail("KUSABI_DIRECT_APPLY_OUTPUT_DIR_REQUIRED");
  if (apply && (!options.plan_dir || !options.authorization_file)) {
    fail("KUSABI_DIRECT_FROZEN_PLAN_AND_AUTHORIZATION_REQUIRED");
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
    canonicalJson(r0.report) !== canonicalJson(loadedPlan.r0Report)
  )) fail("KUSABI_DIRECT_FROZEN_PLAN_REPRODUCTION_MISMATCH");

  let outputDir: string | undefined;
  if (options.output_dir !== undefined) {
    outputDir = await createOutputDirectory(options.output_dir);
    await writeBaseArtifacts(outputDir, r0, cas);
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
    r0_report_sha256: r0.report.report_sha256,
  };
  const targetKeyByTuple = new Map(r0.manifest.targets.map((target) => [
    targetTuple(target.identity.agent_id, target.identity.project, target.identity.host_runtime),
    target.target_key,
  ]));
  const targets = collected.descriptors.map(({ target }) => target);
  const preimages = await readConfigPreimages(targets, targetKeyByTuple);
  const r0ByKey = new Map(r0.report.targets.map((target) => [target.target_key, target]));
  for (const preimage of preimages) {
    const evidence = r0ByKey.get(preimage.target_key);
    if (!evidence || evidence.preimage_state !== preimage.state || evidence.preimage_sha256 !== preimage.sha256 ||
      evidence.preimage_mode !== preimage.mode) fail("KUSABI_DIRECT_PREIMAGE_DRIFT", preimage.target_key);
  }
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
      failure: null,
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
  await writeJson(join(outputDir, "direct-authorization.json"), directAuthorization);
  await writeJson(join(outputDir, "rollout-authorization.json"), authorization);

  const applyReports: KusabiFleetApplyBatchReport[] = [];
  const placementGates: KusabiFleetPlacementGateReport[] = [];
  const observations: KusabiFleetObservedTarget[] = [];
  let rollbackCount = 0;
  const rollbackErrors: string[] = [];
  try {
    const manifestByKey = new Map(r0.manifest.targets.map((target) => [target.target_key, target]));
    const inputByKey = new Map(targets.map((target) => [targetKeyByTuple.get(targetIdentityTuple(target)), target]));
    const preimageByKey = new Map(preimages.map((preimage) => [preimage.target_key, preimage]));
    for (const batch of r0.rollout_plan.batches) {
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
        prior_gate_reports: placementGates,
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
        });
        const placementExact = observation.managed_binding_exact && observation.config_exact && observation.build_exact &&
          observation.deployment.configuration.binding_source_ref_sha256 ===
            manifestTarget.expected.configuration.binding_source_ref_sha256;
        if (!placementExact) fail("KUSABI_DIRECT_POSTIMAGE_NOT_EXACT", targetKey);
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
    }
    const trustBlockers = observations.filter(({ trust_exact }) => !trust_exact).map((observation) => ({
      target_key: observation.target_key,
      host_runtime: r0.manifest.targets.find(({ target_key }) => target_key === observation.target_key)!.identity.host_runtime,
    }));
    const report = sealDirectReport({
      schema_version: "kusabi-direct-fleet-rollout-report/v1",
      ...reportBase,
      status: trustBlockers.length === 0 && observations.every(({ storage_exact }) => storage_exact)
        ? "applied"
        : "configuration_placed_untrusted",
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
      failure: null,
    });
    await writeJson(join(outputDir, "observations.json"), report.observations);
    await writeJson(join(outputDir, "direct-rollout-report.json"), report);
    return report;
  } catch (error) {
    const appliedPostimages = new Map(applyReports.flatMap((report) =>
      report.target_results.map((target) => [target.target_key, target.postimage_sha256] as const)
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
    const failure = failureDetails(error);
    const report = sealDirectReport({
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
      failure: rollbackErrors.length === 0 ? failure : {
        code: "KUSABI_DIRECT_ROLLBACK_INCOMPLETE",
        message: `${failure.message}; ${rollbackErrors.join(";")}`,
      },
    });
    await writeJson(join(outputDir, "direct-rollout-failure-report.json"), report);
    throw new KusabiDirectFleetRolloutError(report.failure!.code, report.failure!.message, report);
  }
}

interface CliArgs {
  cas_root?: string;
  expected_head?: string;
  output_dir?: string;
  plan_dir?: string;
  authorization_file?: string;
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
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { apply: false, help: false };
  const valueKeys = new Set([
    "cas-root", "expected-head", "output-dir", "plan-dir", "authorization-file", "database-url",
    "captured-at", "activation-at", "deadline-at",
    "manifest-id", "rollout-id", "decision-id", "decision-ref", "storage-binding-sha256",
  ]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--apply") {
      parsed.apply = true;
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
    "  --expected-head <40-hex>        Exact authorized release HEAD (required with --apply)",
    "  --output-dir <absolute-path>    New evidence/backup directory (required with --apply)",
    "  --plan-dir <absolute-path>      Immutable plan directory (required with --apply)",
    "  --authorization-file <path>     Exact external authorization artifact (required with --apply)",
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
    expected_head: args.expected_head,
    output_dir: args.output_dir,
    plan_dir: args.plan_dir,
    authorization_file: args.authorization_file,
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
