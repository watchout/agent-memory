#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  KusabiDirectFleetRolloutError,
  readImmutableKusabiCasRoot,
  runKusabiDirectFleetRollout,
  sealKusabiDirectRolloutAuthorization,
  type KusabiDirectFleetDatabase,
  type KusabiDirectTrustPaths,
} from "./kusabi-direct-fleet-rollout.js";

const FIXTURE_ROWS = [
  "adf-lead|ai-dev-framework|codex", "arc|iyasaka-arc|codex", "aun|codex-aun|codex",
  "check|check|claude-code", "codex-audit|codex-audit|codex", "codex-cto|codex|codex",
  "design|design|codex", "dev-001|dev-001|codex", "devauditor|dev-auditor|codex",
  "haishin-dev|haishin-puls-hub|claude-code", "hotel-dev|hotel-saas-rebuild|codex",
  "hotel-lead|hotel-lead|codex", "kodama|kodama|codex", "kusabi|agent-memory|codex",
  "marketing-bot|marketing-bot|claude-code", "misell|misell|codex", "nyusatsu-dev|nyusatsu|codex",
  "org-build-dev|org-build|claude-code", "pfaun|pfaun|codex", "qa|qa|codex",
  "research-lead|research-lead|codex", "sales-bot|sales-bot|claude-code", "secretary|secretary|codex",
  "spec|spec|claude-code", "suite-lead|iyasaka-arc-suite-lead|codex", "takumi|takumi|codex",
  "upwork-dev|upwork-automation|claude-code", "versa|versa|codex", "vice|iyasaka-org|claude-code",
  "wbs-dev|wbs|claude-code", "webb-dev|webb-dev|claude-code",
  "xmarketing-dev|x-marketing-engine|claude-code", "zumen|zumen|claude-code",
] as const;
const ENTRYPOINTS = [
  "dist/claude-session-start.js", "dist/codex-session-start.js", "dist/gemini-session-start.js",
  "dist/kusabi-direct-fleet-rollout.js", "dist/kusabi-fleet-rollout.js", "dist/raw-capture-service.js",
] as const;
let assertions = 0;

function check(value: unknown, message: string): void {
  assert(value, message);
  assertions++;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalValue(source[key])]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function byteCompare(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

async function treeHash(root: string, excludeRelease = false): Promise<string> {
  const files: Array<{ path: string; mode: string; size: number; digest: string }> = [];
  async function visit(current: string): Promise<void> {
    const info = await lstat(current);
    if (info.isDirectory()) {
      for (const child of (await readdir(current)).sort(byteCompare)) await visit(join(current, child));
      return;
    }
    const path = relative(root, current).split(sep).join("/");
    if (excludeRelease && path === "release.json") return;
    files.push({
      path,
      mode: (info.mode & 0o777).toString(8).padStart(4, "0"),
      size: info.size,
      digest: sha256(await readFile(current)),
    });
  }
  await visit(root);
  files.sort((left, right) => byteCompare(left.path, right.path));
  return sha256(files.map(({ path, mode, size, digest }) =>
    `${path}\t${mode}\t${size}\t${digest}\n`
  ).join(""));
}

async function chmodTree(root: string, directoryMode: number, fileMode: number): Promise<void> {
  const info = await lstat(root);
  if (!info.isDirectory()) {
    await chmod(root, fileMode);
    return;
  }
  for (const child of await readdir(root)) await chmodTree(join(root, child), directoryMode, fileMode);
  await chmod(root, directoryMode);
}

async function createCas(root: string): Promise<string> {
  const shaParent = join(root, "sha256");
  const stage = join(root, "stage");
  await mkdir(join(stage, "dist"), { recursive: true });
  for (const entrypoint of ENTRYPOINTS) await writeFile(join(stage, entrypoint), `${entrypoint}:fixture\n`, { mode: 0o444 });
  await chmod(join(stage, "dist"), 0o555);
  await chmod(stage, 0o555);
  const entrypointMap = Object.fromEntries(await Promise.all(ENTRYPOINTS.map(async (path) => [path, sha256(await readFile(join(stage, path)))])));
  const descriptor = {
    schema_version: "wasurezu-content-addressed-runtime-release/v1",
    repository: "watchout/agent-memory",
    source_commit: "1".repeat(40),
    source_tree: "2".repeat(40),
    runtime_tree_sha256: await treeHash(stage, true),
    dist_tree_sha256: await treeHash(join(stage, "dist")),
    required_entrypoint_sha256_map: entrypointMap,
    normalized_file_mode: "0444",
    normalized_directory_mode: "0555",
  };
  await chmod(stage, 0o755);
  const descriptorRaw = canonicalJson(descriptor);
  const descriptorSha = sha256(descriptorRaw);
  await writeFile(join(stage, "release.json"), descriptorRaw, { mode: 0o444 });
  await mkdir(shaParent);
  const casRoot = join(shaParent, descriptorSha);
  await rename(stage, casRoot);
  await chmodTree(casRoot, 0o555, 0o444);
  return casRoot;
}

interface FixtureRow {
  agent_id: string;
  project: string;
  workspace: string;
  workspace_id: string;
  profile_revision: string;
  profile_source: string;
  runtime_engine_preference: "codex" | "claude-code";
}

async function createFleet(root: string): Promise<{ rows: FixtureRow[]; database: KusabiDirectFleetDatabase }> {
  const rows: FixtureRow[] = [];
  for (const [index, tuple] of FIXTURE_ROWS.entries()) {
    const [agentId, project, runtime] = tuple.split("|") as [string, string, "codex" | "claude-code"];
    const workspace = join(root, `workspace-${String(index + 1).padStart(2, "0")}`);
    await mkdir(workspace);
    rows.push({
      agent_id: agentId,
      project,
      workspace: await realpath(workspace),
      workspace_id: `fixture-${index + 1}`,
      profile_revision: "1",
      profile_source: "fixture",
      runtime_engine_preference: runtime,
    });
  }
  const database: KusabiDirectFleetDatabase = {
    async query<T>(_sql: string): Promise<{ rows: T[] }> {
      return { rows: rows as unknown as T[] };
    },
  };
  return { rows, database };
}

function configPath(row: FixtureRow, host = row.runtime_engine_preference): string {
  if (host === "codex") return join(row.workspace, ".codex", "hooks.json");
  if (host === "claude-code" || host === "claude_code") return join(row.workspace, ".claude", "settings.json");
  return join(row.workspace, ".gemini", "settings.json");
}

async function seedUnrelated(row: FixtureRow, host = row.runtime_engine_preference): Promise<void> {
  const path = configPath(row, host);
  await mkdir(join(path, ".."), { recursive: true });
  const group = host === "gemini_cli"
    ? { matcher: "startup", sequential: true, hooks: [{ type: "command", name: "unrelated-hook", command: "true" }] }
    : { matcher: "startup", hooks: [{ type: "command", command: "unrelated-hook" }] };
  const value = host === "codex"
    ? { description: "existing", hooks: { SessionStart: [group] }, unrelated: { preserve: true } }
    : { hooks: { SessionStart: [group] }, unrelated: { preserve: true } };
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o640 });
}

async function createTrust(root: string): Promise<KusabiDirectTrustPaths> {
  const paths = {
    codex_config_toml: join(root, "codex-config.toml"),
    claude_state_json: join(root, "claude-state.json"),
    gemini_trusted_folders_json: join(root, "gemini-folders.json"),
    gemini_trusted_hooks_json: join(root, "gemini-hooks.json"),
  };
  await writeFile(paths.codex_config_toml, "");
  await writeFile(paths.claude_state_json, '{"projects":{}}');
  await writeFile(paths.gemini_trusted_folders_json, "{}");
  await writeFile(paths.gemini_trusted_hooks_json, "{}");
  return paths;
}

async function expectCode(code: string, operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof KusabiDirectFleetRolloutError);
    assert.equal(error.code, code);
    assertions++;
    return;
  }
  assert.fail(`expected ${code}`);
}

async function readAllConfigs(rows: FixtureRow[]): Promise<Map<string, Buffer>> {
  const paths = rows.map((row) => configPath(row));
  const kusabi = rows.find(({ agent_id }) => agent_id === "kusabi")!;
  paths.push(configPath(kusabi, "claude_code"), configPath(kusabi, "gemini_cli"));
  return new Map(await Promise.all(paths.map(async (path) => [path, await readFile(path)] as const)));
}

async function main(): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kusabi-direct-rollout-test-")));
  try {
    const casRoot = await createCas(root);
    const cas = await readImmutableKusabiCasRoot(casRoot);
    check(cas.exact && cas.release_descriptor_sha256 === basename(casRoot), "immutable CAS exact readback passes");
    await chmod(join(casRoot, ENTRYPOINTS[0]), 0o644);
    await expectCode("KUSABI_DIRECT_CAS_FILE_MODE", () => readImmutableKusabiCasRoot(casRoot));
    await chmod(join(casRoot, ENTRYPOINTS[0]), 0o444);

    const { rows, database } = await createFleet(root);
    for (const row of rows) await seedUnrelated(row);
    const kusabi = rows.find(({ agent_id }) => agent_id === "kusabi")!;
    await seedUnrelated(kusabi, "claude_code");
    await seedUnrelated(kusabi, "gemini_cli");
    const trustPaths = await createTrust(root);
    const beforeDryRun = await readAllConfigs(rows);
    const fixed = {
      cas_root: casRoot,
      database,
      trust_paths: trustPaths,
      captured_at: "2026-08-13T11:00:00.000Z",
      activation_at: "2026-08-13T11:00:00.000Z",
      durable_evidence_deadline_at: "2026-08-13T17:00:00.000Z",
      workspace_root: root,
      expected_head: "1".repeat(40),
      decision_id: "owner-direct-test-20260813",
      decision_ref: "owner-directive:test-fixture",
      test_allow_external_deployer: true,
    };
    const planDir = join(root, "frozen-plan");
    const dryRun = await runKusabiDirectFleetRollout({ ...fixed, output_dir: planDir });
    check(dryRun.mode === "dry-run" && dryRun.status === "planned", "dry-run is the default");
    check(dryRun.target_snapshot.primary_count === 33 && dryRun.target_snapshot.secondary_count === 2 &&
      dryRun.target_snapshot.target_count === 35, "snapshot is exactly primary 33 plus Kusabi secondary 2");
    check(dryRun.rollout.batch_count === 7 && dryRun.summary.placed_count === 0, "dry-run plans seven staged batches and writes no configs");
    const afterDryRun = await readAllConfigs(rows);
    check([...beforeDryRun].every(([path, raw]) => afterDryRun.get(path)?.equals(raw)), "dry-run preserves every config byte");

    const planSeal = JSON.parse(await readFile(join(planDir, "plan-seal.json"), "utf8"));
    check(((await lstat(planDir)).mode & 0o777) === 0o500 &&
      ((await lstat(join(planDir, "plan-seal.json"))).mode & 0o777) === 0o400,
    "plan and artifacts are immutable before independent audit");
    const authorizationFile = join(root, "authorization.json");
    const directAuthorization = sealKusabiDirectRolloutAuthorization({
      expected_head: "1".repeat(40),
      plan_seal_sha256: planSeal.plan_seal_sha256,
      decision_id: "owner-direct-test-20260813",
      decision_ref_sha256: sha256("owner-directive:test-fixture"),
      independent_audit_sha256: sha256("independent-audit:fixture-pass"),
    });
    await writeFile(authorizationFile, JSON.stringify(directAuthorization), { mode: 0o400 });
    const outputDir = join(root, "apply-evidence");
    await expectCode("KUSABI_DIRECT_FROZEN_PLAN_AND_AUTHORIZATION_REQUIRED", () =>
      runKusabiDirectFleetRollout({ ...fixed, apply: true, output_dir: join(root, "unsafe-single-phase") })
    );
    const applied = await runKusabiDirectFleetRollout({
      ...fixed,
      apply: true,
      output_dir: outputDir,
      plan_dir: planDir,
      authorization_file: authorizationFile,
    });
    check(applied.status === "configuration_placed_untrusted" && applied.summary.placed_count === 35 &&
      applied.summary.postimage_exact_count === 35 && applied.summary.storage_observed_count === 0,
    "apply places and exact-readbacks all 35 configs without fabricating trust or storage observation");
    check(applied.apply_reports.map(({ placed_count }) => placed_count).join(",") === "3,11,5,5,5,5,1",
      "apply uses the frozen staged batch sizes");
    check(applied.summary.trust_exact_count === 0 && applied.trust_blockers.length === 35,
      "native trust remains user-owned and is reported separately");
    for (const [, raw] of await readAllConfigs(rows)) {
      const parsed = JSON.parse(raw.toString("utf8"));
      check(parsed.unrelated?.preserve === true, "unrelated user hook configuration is preserved");
    }
    for (const row of rows) check(((await lstat(configPath(row))).mode & 0o777) === 0o640,
      "successful merge preserves existing config mode");
    for (const row of rows) {
      const files = await readdir(join(configPath(row), ".."));
      check(!files.some((name) => name.includes(".bak.wasurezu-")),
        "direct transaction leaves no installer-local backup copy");
    }
    const backupManifest = JSON.parse(await readFile(join(outputDir, "preimage-backup-manifest.json"), "utf8"));
    check(backupManifest.target_count === 35 && backupManifest.file_preimage_count === 35,
      "durable preimage backup manifest covers every config");
    const evidenceFiles = await readdir(outputDir);
    check(evidenceFiles.includes("fleet-manifest.json") && evidenceFiles.includes("rollout-plan.json") &&
      evidenceFiles.includes("direct-rollout-report.json") && evidenceFiles.filter((name) => name.startsWith("apply-")).length === 7,
    "manifest, report, and per-batch JSON evidence are emitted");

    await writeFile(configPath(kusabi), beforeDryRun.get(configPath(kusabi))!);
    const beforeRollback = await readAllConfigs(rows);
    const rollbackPlan = join(root, "rollback-plan");
    const rollbackFixed = {
      ...fixed,
      captured_at: "2026-08-13T11:01:00.000Z",
      activation_at: "2026-08-13T11:01:00.000Z",
    };
    await runKusabiDirectFleetRollout({ ...rollbackFixed, output_dir: rollbackPlan });
    const rollbackSeal = JSON.parse(await readFile(join(rollbackPlan, "plan-seal.json"), "utf8"));
    const rollbackAuthorizationFile = join(root, "rollback-authorization.json");
    await writeFile(rollbackAuthorizationFile, JSON.stringify(sealKusabiDirectRolloutAuthorization({
      expected_head: "1".repeat(40),
      plan_seal_sha256: rollbackSeal.plan_seal_sha256,
      decision_id: "owner-direct-test-rollback-20260813",
      decision_ref_sha256: sha256("owner-directive:test-fixture-rollback"),
      independent_audit_sha256: sha256("independent-audit:fixture-rollback-pass"),
    })), { mode: 0o400 });
    const rollbackOutput = join(root, "rollback-evidence");
    try {
      await runKusabiDirectFleetRollout({
        ...rollbackFixed,
        apply: true,
        output_dir: rollbackOutput,
        plan_dir: rollbackPlan,
        authorization_file: rollbackAuthorizationFile,
        on_batch_applied: () => { throw new Error("fixture forced failure after placement"); },
      });
      assert.fail("expected rollback failure");
    } catch (error) {
      assert(error instanceof KusabiDirectFleetRolloutError);
      check(error.report?.status === "failed_rolled_back" && error.report.summary.rollback_count === 3,
        "failure rolls back only the batch that was actually placed");
    }
    const afterRollback = await readAllConfigs(rows);
    check([...beforeRollback].every(([path, raw]) => afterRollback.get(path)?.equals(raw)),
      "automatic rollback restores every preimage byte");
    const failureReport = JSON.parse(await readFile(join(rollbackOutput, "direct-rollout-failure-report.json"), "utf8"));
    check(failureReport.status === "failed_rolled_back", "rollback result is persisted as JSON evidence");

    const conflictPlan = join(root, "conflict-plan");
    const conflictFixed = {
      ...fixed,
      captured_at: "2026-08-13T11:02:00.000Z",
      activation_at: "2026-08-13T11:02:00.000Z",
    };
    await runKusabiDirectFleetRollout({ ...conflictFixed, output_dir: conflictPlan });
    const conflictSeal = JSON.parse(await readFile(join(conflictPlan, "plan-seal.json"), "utf8"));
    const conflictManifest = JSON.parse(await readFile(join(conflictPlan, "fleet-manifest.json"), "utf8"));
    const conflictAuthorizationFile = join(root, "conflict-authorization.json");
    await writeFile(conflictAuthorizationFile, JSON.stringify(sealKusabiDirectRolloutAuthorization({
      expected_head: "1".repeat(40),
      plan_seal_sha256: conflictSeal.plan_seal_sha256,
      decision_id: "owner-direct-test-conflict-20260813",
      decision_ref_sha256: sha256("owner-directive:test-fixture-conflict"),
      independent_audit_sha256: sha256("independent-audit:fixture-conflict-pass"),
    })), { mode: 0o400 });
    let firstEffectTarget = "";
    const conflictOutput = join(root, "conflict-evidence");
    try {
      await runKusabiDirectFleetRollout({
        ...conflictFixed,
        apply: true,
        output_dir: conflictOutput,
        plan_dir: conflictPlan,
        authorization_file: conflictAuthorizationFile,
        test_before_target_apply: (targetKey, index) => {
          if (index === 0) firstEffectTarget = targetKey;
          if (index === 1) throw new Error("fixture mid-batch apply failure");
        },
        test_before_target_rollback: async (targetKey) => {
          if (targetKey !== firstEffectTarget) return;
          const target = conflictManifest.targets.find((item: any) => item.target_key === targetKey);
          const host = target.identity.host_runtime as "codex" | "claude_code" | "gemini_cli";
          await writeFile(configPath(kusabi, host), '{"foreign":"concurrent-drift"}\n');
        },
      });
      assert.fail("expected incomplete rollback failure");
    } catch (error) {
      assert(error instanceof KusabiDirectFleetRolloutError);
      const partial = error.report?.apply_reports.at(-1);
      check(error.report?.status === "failed_rollback_incomplete" &&
        error.report.summary.rollback_error_count >= 1,
      "rollback conflict cannot be reported as failed_rolled_back");
      check(partial?.placed_count === 1 && partial.effect_targets.length === 2 &&
        partial.failure_code === "KUSABI_FLEET_APPLY_FAILED",
      "mid-batch failure propagates successful and potentially effected targets to the direct layer");
    }
    const conflictFailureReport = JSON.parse(await readFile(
      join(conflictOutput, "direct-rollout-failure-report.json"), "utf8"));
    check(conflictFailureReport.status === "failed_rollback_incomplete" &&
      conflictFailureReport.apply_reports.at(-1).effect_targets.length === 2,
    "persisted evidence records partial apply and incomplete rollback");

    process.stdout.write(`kusabi direct fleet rollout tests passed (${assertions} assertions)\n`);
  } finally {
    await chmodTree(root, 0o700, 0o600).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
