#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  KusabiDirectFleetRolloutError,
  readImmutableKusabiCasRoot,
  runKusabiDirectFleetRollout,
  sealKusabiDirectRolloutAuthorization,
  type KusabiDirectFleetDatabase,
  type KusabiDirectTrustPaths,
} from "./kusabi-direct-fleet-rollout.js";
import { kusabiRuntimeEventSha256 } from "./kusabi-runtime-event-store.js";
import {
  getKusabiAntigravitySettingsPath,
  testOnlyVerifyKusabiAntigravityWorkspaceTrust,
  verifyKusabiAntigravityWorkspaceTrust,
} from "./kusabi-fleet-rollout.js";

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
  "dist/antigravity-session-start.js", "dist/antigravity-hook-installer.js",
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

function fixtureUuid(value: string): string {
  const hex = sha256(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
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

function fleetEvidenceJson(value: unknown): string {
  return `${JSON.stringify(value, (_key, item) => item === undefined ? undefined : item, 2)}\n`;
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

interface GateFixtureRows {
  events: unknown[];
  quality: unknown[];
  raw: unknown[];
}

async function createFleet(root: string): Promise<{
  rows: FixtureRow[];
  database: KusabiDirectFleetDatabase;
  setGateFixture(value: GateFixtureRows): void;
}> {
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
  let gateFixture: GateFixtureRows = { events: [], quality: [], raw: [] };
  const database: KusabiDirectFleetDatabase = {
    async query<T>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("FROM kusabi_runtime_events")) return { rows: gateFixture.events as T[] };
      if (sql.includes("FROM recovery_quality_log")) return { rows: gateFixture.quality as T[] };
      if (sql.includes("FROM raw_events")) return { rows: gateFixture.raw as T[] };
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim())) return { rows: [] };
      return { rows: rows as unknown as T[] };
    },
  };
  return { rows, database, setGateFixture: (value) => { gateFixture = value; } };
}

function configPath(row: FixtureRow, host = row.runtime_engine_preference): string {
  if (host === "antigravity_cli") return join(row.workspace, ".agents", "hooks.json");
  if (host === "codex") return join(row.workspace, ".codex", "hooks.json");
  if (host === "claude-code" || host === "claude_code") return join(row.workspace, ".claude", "settings.json");
  return join(row.workspace, ".gemini", "settings.json");
}

async function seedUnrelated(row: FixtureRow, host = row.runtime_engine_preference): Promise<void> {
  const path = configPath(row, host);
  await mkdir(join(path, ".."), { recursive: true });
  if (host === "antigravity_cli") {
    await writeFile(path, `${JSON.stringify({ unrelated: { preserve: true }, "unrelated-hook": { PreInvocation: [{ type: "command", command: "true" }] } }, null, 2)}\n`, { mode: 0o640 });
    return;
  }
  const group = host === "gemini_cli"
    ? { matcher: "startup", sequential: true, hooks: [{ type: "command", name: "unrelated-hook", command: "true" }] }
    : { matcher: "startup", hooks: [{ type: "command", command: "unrelated-hook" }] };
  const value = host === "codex"
    ? { description: "existing", hooks: { SessionStart: [group] }, unrelated: { preserve: true } }
    : { hooks: { SessionStart: [group] }, unrelated: { preserve: true } };
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o640 });
}

async function createTrust(
  root: string,
  antigravityWorkspace: string,
): Promise<{ paths: KusabiDirectTrustPaths; antigravitySettingsJson: string }> {
  const paths = {
    codex_config_toml: join(root, "codex-config.toml"),
    claude_state_json: join(root, "claude-state.json"),
    gemini_trusted_folders_json: join(root, "gemini-folders.json"),
    gemini_trusted_hooks_json: join(root, "gemini-hooks.json"),
  };
  const antigravitySettingsJson = getKusabiAntigravitySettingsPath();
  await mkdir(dirname(antigravitySettingsJson), { recursive: true });
  await writeFile(antigravitySettingsJson, JSON.stringify({ trustedWorkspaces: [antigravityWorkspace] }));
  await writeFile(paths.codex_config_toml, "");
  await writeFile(paths.claude_state_json, '{"projects":{}}');
  await writeFile(paths.gemini_trusted_folders_json, "{}");
  await writeFile(paths.gemini_trusted_hooks_json, "{}");
  return { paths, antigravitySettingsJson };
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

async function expectFleetCode(code: string, operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error: any) {
    assert.equal(error?.code, code);
    assertions++;
    return;
  }
  assert.fail(`expected ${code}`);
}

async function readAllConfigs(rows: FixtureRow[]): Promise<Map<string, Buffer>> {
  const paths = rows.map((row) => configPath(row));
  const kusabi = rows.find(({ agent_id }) => agent_id === "kusabi")!;
  paths.push(configPath(kusabi, "claude_code"), configPath(kusabi, "antigravity_cli"));
  return new Map(await Promise.all(paths.map(async (path) => [path, await readFile(path)] as const)));
}

async function main(): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kusabi-direct-rollout-test-")));
  const originalHome = process.env.HOME;
  process.env.HOME = root;
  try {
    const casRoot = await createCas(root);
    const cas = await readImmutableKusabiCasRoot(casRoot);
    check(cas.exact && cas.release_descriptor_sha256 === basename(casRoot), "immutable CAS exact readback passes");
    await chmod(join(casRoot, ENTRYPOINTS[0]), 0o644);
    await expectCode("KUSABI_DIRECT_CAS_FILE_MODE", () => readImmutableKusabiCasRoot(casRoot));
    await chmod(join(casRoot, ENTRYPOINTS[0]), 0o444);

    const { rows, database, setGateFixture } = await createFleet(root);
    for (const row of rows) await seedUnrelated(row);
    const kusabi = rows.find(({ agent_id }) => agent_id === "kusabi")!;
    await seedUnrelated(kusabi, "claude_code");
    await seedUnrelated(kusabi, "antigravity_cli");
    const { paths: trustPaths, antigravitySettingsJson } = await createTrust(root, kusabi.workspace);
    check(await verifyKusabiAntigravityWorkspaceTrust(kusabi.workspace),
      "Antigravity trust requires the canonical workspace in official settings");
    check(await testOnlyVerifyKusabiAntigravityWorkspaceTrust(kusabi.workspace, root),
      "Antigravity test seam derives the official locator from an explicit test home");
    await writeFile(antigravitySettingsJson, JSON.stringify({ trustedWorkspaces: [join(root, "other-workspace")] }));
    check(!(await verifyKusabiAntigravityWorkspaceTrust(kusabi.workspace)),
      "Antigravity trust rejects a different workspace");
    await writeFile(antigravitySettingsJson, JSON.stringify({ trustedWorkspaces: false }));
    check(!(await verifyKusabiAntigravityWorkspaceTrust(kusabi.workspace)),
      "Antigravity trust rejects false or non-array trustedWorkspaces");
    await writeFile(antigravitySettingsJson, "{malformed");
    await expectFleetCode("KUSABI_FLEET_ANTIGRAVITY_TRUST_STATE_INVALID", () =>
      verifyKusabiAntigravityWorkspaceTrust(kusabi.workspace)
    );
    await rm(antigravitySettingsJson);
    await expectFleetCode("KUSABI_FLEET_ANTIGRAVITY_TRUST_STATE_INVALID", () =>
      verifyKusabiAntigravityWorkspaceTrust(kusabi.workspace)
    );
    const arbitrarySettings = join(root, "arbitrary-antigravity-settings.json");
    await writeFile(arbitrarySettings, JSON.stringify({ trustedWorkspaces: [kusabi.workspace] }));
    await expectFleetCode("KUSABI_FLEET_ANTIGRAVITY_TRUST_STATE_INVALID", () =>
      verifyKusabiAntigravityWorkspaceTrust(kusabi.workspace)
    );
    await writeFile(antigravitySettingsJson, JSON.stringify({ trustedWorkspaces: [kusabi.workspace] }));
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
    const dryManifest = JSON.parse(await readFile(join(planDir, "fleet-manifest.json"), "utf8"));
    const kusabiSecondaryHosts = dryManifest.targets
      .filter((target: any) => target.identity.agent_id === "kusabi" && target.identity.host_runtime !== "codex")
      .map((target: any) => target.identity.host_runtime).sort();
    check(canonicalJson(kusabiSecondaryHosts) === canonicalJson(["antigravity_cli", "claude_code"]),
      "35-target inventory replaces the Gemini secondary with canonical Antigravity CLI identity");
    check(dryManifest.targets.every((target: any) => target.identity.host_runtime !== "gemini_cli"),
      "direct 35-target manifest contains no masquerading Gemini identity");

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
    const outputDir = join(root, "r1-evidence");
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
    check(applied.status === "phase_gate_required" && applied.summary.placed_count === 3 &&
      applied.summary.postimage_exact_count === 3 && applied.summary.storage_observed_count === 0,
    "initial apply places only R1 and stops for its durable gate");
    check(applied.apply_reports.length === 1 && applied.apply_reports[0].batch_id === "r1-kusabi",
      "an initial invocation cannot cross from R1 placement into R2");
    check(applied.phase_receipt?.batch_id === "r1-kusabi" && applied.phase_receipt.effect_targets.length === 3 &&
      applied.phase_receipt.durable_gate_reports.length === 0,
      "R1 phase receipt binds only its three placed effects and no fabricated durable gate");
    check(applied.summary.trust_exact_count === 1 && applied.trust_blockers.length === 2,
      "Antigravity hook state is exact while Codex and Claude native trust remain user-owned");
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
      evidenceFiles.includes("phase-receipt.json") && evidenceFiles.includes("direct-rollout-report.json") &&
      evidenceFiles.filter((name) => name.startsWith("apply-")).length === 1 &&
      ((await lstat(outputDir)).mode & 0o777) === 0o500,
    "R1 phase evidence is complete and immutable");

    const manifest = JSON.parse(await readFile(join(planDir, "fleet-manifest.json"), "utf8"));
    const rolloutPlan = JSON.parse(await readFile(join(planDir, "rollout-plan.json"), "utf8"));
    for (const targetKey of rolloutPlan.batches[0].target_keys as string[]) {
      const target = manifest.targets.find((item: any) => item.target_key === targetKey);
      const row = rows.find((item) => item.agent_id === target.identity.agent_id)!;
      const raw = await readFile(configPath(row, target.identity.host_runtime), "utf8");
      const manifestFlagCount = raw.split("--runtime-event-manifest").length - 1;
      check(raw.includes(join(planDir, "fleet-manifest.json")) &&
        manifestFlagCount === (target.identity.host_runtime === "gemini_cli" ? 3 : target.identity.host_runtime === "antigravity_cli" ? 2 : 1),
      "each R1 native hook pins the immutable audited fleet manifest without ambient activation");
    }
    async function writeGateEvidence(
      priorDir: string,
      suffix: string,
      elapsedSeconds: number,
      statusDeploymentDrift = false,
      databaseElapsedSeconds = elapsedSeconds,
      autoReceiveCaptured = true,
      rawProvenanceDrift = false,
    ): Promise<{ observationsFile: string; statusFile: string }> {
      const receipt = JSON.parse(await readFile(join(priorDir, "phase-receipt.json"), "utf8"));
      const batch = rolloutPlan.batches.find((item: any) => item.batch_id === receipt.batch_id);
      const observedAt = new Date(Date.parse(receipt.batch_placed_at) + elapsedSeconds * 1_000).toISOString();
      const observations = batch.target_keys.map((targetKey: string) => {
        const target = manifest.targets.find((item: any) => item.target_key === targetKey);
        const withoutHash = {
          schema_version: "kusabi-fleet-observed-target/v1",
          observed_at: observedAt,
          target_key: targetKey,
          deployment: target.expected,
          config_locator_sha256: sha256(`config:${targetKey}`),
          managed_binding_exact: true,
          config_exact: true,
          build_exact: true,
          trust_exact: true,
          storage_exact: true,
          exact: true,
        };
        return { ...withoutHash, observation_sha256: sha256(fleetEvidenceJson(withoutHash)) };
      });
      const healthyKeys = new Set(receipt.effect_targets.map((target: any) => target.target_key));
      const eventRows: any[] = [];
      const qualityRows: any[] = [];
      const rawRows: any[] = [];
      const latestEventIdByTarget = new Map<string, string>();
      for (const target of manifest.targets.filter((item: any) => healthyKeys.has(item.target_key))) {
        const phases = batch.target_keys.includes(target.target_key) && batch.minimum_soak_seconds > 0
          ? [
            { name: "t0", at: receipt.batch_placed_at },
            { name: "t1", at: new Date(
              Date.parse(receipt.batch_placed_at) + databaseElapsedSeconds * 1_000,
            ).toISOString() },
          ]
          : [{ name: "t0", at: observedAt }];
        for (const phase of phases) {
          const sessionId = `fixture-${target.target_key.slice(0, 12)}-${phase.name}-${suffix}`;
          const qualityId = fixtureUuid(`quality:${sessionId}`);
          const eventId = fixtureUuid(`event:${sessionId}`);
          const event = {
            schema_version: "kusabi-runtime-event/v1",
            event_id: eventId,
            event_type: "session_start",
            occurred_at: phase.at,
            manifest_id: manifest.manifest_id,
            target_key: target.target_key,
            producer: {
              ...target.identity,
              adapter_id: "fixture-adapter",
              adapter_version: target.expected.build.adapter_version,
              session_ref_sha256: sha256(sessionId),
            },
            build: {
              commit_sha: target.expected.build.commit_sha,
              tree_sha: target.expected.build.tree_sha,
              artifact_sha256: target.expected.build.artifact_sha256,
            },
            configuration: target.expected.configuration,
            storage: target.expected.storage,
            outcome: {
              status: "full",
              reason_code: null,
              elapsed_ms: 1,
              evidence_delivery: "durable",
              normalized_error_code: null,
              error_fingerprint_sha256: null,
            },
            health: {
              recovered_tokens: 1,
              task_continued: null,
              recovery_quality_score: null,
              search_memory_count_10min: null,
            },
            privacy: { policy_version: "fixture-v1", redaction_count: 0, forbidden_field_count: 0 },
            evidence_refs: [{
              kind: "local_store",
              locator_sha256: sha256(`recovery_quality_log:${qualityId}`),
              content_sha256: sha256(`evidence:${sessionId}`),
            }],
          };
          eventRows.push({
            event_id: eventId,
            target_key: target.target_key,
            event_sha256: kusabiRuntimeEventSha256(event),
            event_json: event,
            ingested_at: phase.at,
          });
          qualityRows.push({
            quality_id: qualityId,
            agent_id: target.identity.agent_id,
            session_id: sessionId,
            notes: JSON.stringify({
              auto_receive: autoReceiveCaptured
                ? { status: "captured", reason: "captured", events_saved: 1, events_duplicate: 0 }
                : { status: "skipped", reason: "transcript_unavailable", events_saved: 0, events_duplicate: 0 },
            }),
            created_at: phase.at,
          });
          const sourceEventId = `source-${sha256(sessionId).slice(0, 16)}`;
          const sourcePath = `/private/fixture/${sha256(sessionId)}.jsonl`;
          const sourceRef = {
            source: target.identity.host_runtime,
            source_event_id: sourceEventId,
            source_path: sourcePath,
          };
          rawRows.push({
            fixture_target_key: target.target_key,
            agent_id: target.identity.agent_id,
            session_id: sessionId,
            project: target.identity.project,
            host: target.identity.host_runtime,
            source: target.identity.host_runtime,
            source_ref: sourceRef,
            source_ref_hash: sha256(JSON.stringify(sourceRef)),
            source_event_id: sourceEventId,
            source_path: sourcePath,
            redaction_level: "complete",
            private_reasoning: false,
          });
          latestEventIdByTarget.set(target.target_key, eventId);
        }
      }
      if (rawProvenanceDrift && rawRows.length > 0) {
        const driftedRaw = rawRows.find((row: any) => row.fixture_target_key === batch.target_keys[0]) as any;
        driftedRaw.source_ref_hash = "0".repeat(64);
        driftedRaw.source_ref.source = "foreign_host";
      }
      setGateFixture({ events: eventRows, quality: qualityRows, raw: rawRows });
      const targets = manifest.targets.map((target: any, index: number) => {
        const active = healthyKeys.has(target.target_key);
        const deployment = structuredClone(target.expected);
        if (statusDeploymentDrift && target.target_key === batch.target_keys[0]) {
          deployment.configuration.config_sha256 = "f".repeat(64);
        }
        return {
          target_key: target.target_key,
          identity: target.identity,
          state: active ? "healthy" : "not_observed",
          state_reasons: active ? [] : ["no_observation"],
          expected: target.expected,
          observed: active ? {
            deployment,
            last_event_id: latestEventIdByTarget.get(target.target_key),
            last_event_at: observedAt,
            evidence_delivery: "durable",
          } : null,
          last_seen_at: active ? observedAt : null,
          stale_after_seconds: target.stale_after_seconds,
          event_count: active ? 1 : 0,
          consecutive_degraded: 0,
          maintenance_active: false,
          evidence_refs: [],
        };
      });
      const status = {
        schema_version: "kusabi-fleet-status/v1",
        snapshot_id: `00000000-0000-4000-8000-${String(receipt.batch_ordinal).padStart(12, "0")}`,
        generated_at: observedAt,
        manifest: {
          manifest_id: manifest.manifest_id,
          version: manifest.version,
          manifest_sha256: manifest.manifest_sha256,
          target_count: manifest.targets.length,
        },
        window: { started_at: manifest.targets[0].activation_at, ended_at: observedAt },
        summary: {
          target_count: 35,
          healthy_count: healthyKeys.size,
          degraded_count: 0,
          failed_count: 0,
          stale_count: 0,
          not_observed_count: 35 - healthyKeys.size,
          drifted_count: 0,
          open_p0_count: 0,
          open_p1_count: 0,
          open_p2_count: 0,
          open_p3_count: 0,
          exact_observation_rate: healthyKeys.size / 35,
          durable_evidence_rate: healthyKeys.size / 35,
        },
        targets,
        alerts: [],
        next_action: "none",
      };
      const observationsFile = join(root, `${suffix}-observations.json`);
      const statusFile = join(root, `${suffix}-status.json`);
      await writeFile(observationsFile, JSON.stringify(observations), { mode: 0o400 });
      await writeFile(statusFile, JSON.stringify(status), { mode: 0o400 });
      return { observationsFile, statusFile };
    }

    await expectCode("KUSABI_DIRECT_RESUME_EVIDENCE_REQUIRED", () => runKusabiDirectFleetRollout({
      ...fixed,
      apply: true,
      resume_batch: "r2-pilot",
      output_dir: join(root, "resume-missing-evidence"),
      plan_dir: planDir,
      authorization_file: authorizationFile,
    }));

    const r1Gate = await writeGateEvidence(outputDir, "r1", 0);
    await expectCode("KUSABI_DIRECT_RESUME_BATCH_NOT_NEXT", () => runKusabiDirectFleetRollout({
      ...fixed,
      apply: true,
      resume_batch: "r3-wave-01",
      output_dir: join(root, "wrong-next-batch"),
      plan_dir: planDir,
      authorization_file: authorizationFile,
      prior_apply_dir: outputDir,
      gate_observations_file: r1Gate.observationsFile,
      gate_status_file: r1Gate.statusFile,
    }));

    const firstFutureKey: string = rolloutPlan.batches[2].target_keys[0];
    const firstFutureTarget = manifest.targets.find((target: any) => target.target_key === firstFutureKey);
    const firstFutureRow = rows.find((row) => row.agent_id === firstFutureTarget.identity.agent_id)!;
    const firstFuturePath = configPath(firstFutureRow);
    const firstFutureRaw = await readFile(firstFuturePath);
    const driftedConfig = JSON.parse(firstFutureRaw.toString("utf8"));
    driftedConfig.foreign_concurrent_drift = true;
    await writeFile(firstFuturePath, JSON.stringify(driftedConfig));
    await expectCode("KUSABI_DIRECT_FROZEN_PLAN_REPRODUCTION_MISMATCH", () => runKusabiDirectFleetRollout({
      ...fixed,
      apply: true,
      resume_batch: "r2-pilot",
      output_dir: join(root, "future-preimage-drift"),
      plan_dir: planDir,
      authorization_file: authorizationFile,
      prior_apply_dir: outputDir,
      gate_observations_file: r1Gate.observationsFile,
      gate_status_file: r1Gate.statusFile,
    }));
    await writeFile(firstFuturePath, firstFutureRaw);

    const r2Dir = join(root, "r2-evidence");
    const r2Applied = await runKusabiDirectFleetRollout({
      ...fixed,
      apply: true,
      resume_batch: "r2-pilot",
      output_dir: r2Dir,
      plan_dir: planDir,
      authorization_file: authorizationFile,
      prior_apply_dir: outputDir,
      gate_observations_file: r1Gate.observationsFile,
      gate_status_file: r1Gate.statusFile,
    });
    check(r2Applied.apply_reports.length === 1 && r2Applied.apply_reports[0].batch_id === "r2-pilot" &&
      r2Applied.summary.placed_count === 11 && r2Applied.phase_receipt?.durable_gate_reports.length === 1,
      "R1 3/3 exact healthy durable gate permits exactly R2 and then stops");
    const r2Receipt = r2Applied.phase_receipt!;
    const { receipt_sha256: r2ReceiptSha, ...r2ReceiptWithoutHash } = r2Receipt;
    check(r2ReceiptSha === sha256(canonicalJson(r2ReceiptWithoutHash)), "R2 phase receipt seal is exact");
    const { report_sha256: r1GateSha, ...r1GateWithoutHash } = r2Receipt.durable_gate_reports[0];
    check(r1GateSha === sha256(fleetEvidenceJson(r1GateWithoutHash)), "R1 durable gate seal is exact");

    const r2EarlyGate = await writeGateEvidence(r2Dir, "r2-early", 3_599);
    await expectCode("KUSABI_DIRECT_GATE_OBSERVATION_TOO_EARLY", () => runKusabiDirectFleetRollout({
      ...fixed,
      apply: true,
      resume_batch: "r3-wave-01",
      output_dir: join(root, "r2-too-early"),
      plan_dir: planDir,
      authorization_file: authorizationFile,
      prior_apply_dir: r2Dir,
      gate_observations_file: r2EarlyGate.observationsFile,
      gate_status_file: r2EarlyGate.statusFile,
    }));

    const callerSpoofedR2Gate = await writeGateEvidence(r2Dir, "r2-caller-time-spoof", 3_600, false, 3_599);
    await expectCode("KUSABI_DIRECT_DB_GATE_BLOCKED", () => runKusabiDirectFleetRollout({
      ...fixed,
      apply: true,
      resume_batch: "r3-wave-01",
      output_dir: join(root, "r2-caller-time-spoof-reject"),
      plan_dir: planDir,
      authorization_file: authorizationFile,
      prior_apply_dir: r2Dir,
      gate_observations_file: callerSpoofedR2Gate.observationsFile,
      gate_status_file: callerSpoofedR2Gate.statusFile,
    }));

    const missingAutoReceiveR2Gate = await writeGateEvidence(r2Dir, "r2-auto-receive-missing", 3_600, false, 3_600, false);
    await expectCode("KUSABI_DIRECT_DB_GATE_BLOCKED", () => runKusabiDirectFleetRollout({
      ...fixed,
      apply: true,
      resume_batch: "r3-wave-01",
      output_dir: join(root, "r2-auto-receive-missing-reject"),
      plan_dir: planDir,
      authorization_file: authorizationFile,
      prior_apply_dir: r2Dir,
      gate_observations_file: missingAutoReceiveR2Gate.observationsFile,
      gate_status_file: missingAutoReceiveR2Gate.statusFile,
    }));

    const rawProvenanceDriftGate = await writeGateEvidence(
      r2Dir, "r2-raw-provenance-drift", 3_600, false, 3_600, true, true,
    );
    await expectCode("KUSABI_DIRECT_DB_GATE_BLOCKED", () => runKusabiDirectFleetRollout({
      ...fixed,
      apply: true,
      resume_batch: "r3-wave-01",
      output_dir: join(root, "r2-raw-provenance-drift-reject"),
      plan_dir: planDir,
      authorization_file: authorizationFile,
      prior_apply_dir: r2Dir,
      gate_observations_file: rawProvenanceDriftGate.observationsFile,
      gate_status_file: rawProvenanceDriftGate.statusFile,
    }));

    const driftedR2Gate = await writeGateEvidence(r2Dir, "r2-gate-drift", 3_600, true);
    await expectCode("KUSABI_DIRECT_BATCH_GATE_BLOCKED", () => runKusabiDirectFleetRollout({
      ...fixed,
      apply: true,
      resume_batch: "r3-wave-01",
      output_dir: join(root, "r2-gate-drift-reject"),
      plan_dir: planDir,
      authorization_file: authorizationFile,
      prior_apply_dir: r2Dir,
      gate_observations_file: driftedR2Gate.observationsFile,
      gate_status_file: driftedR2Gate.statusFile,
    }));

    let priorDir = r2Dir;
    const appliedR3Batches: string[] = [];
    for (const [index, batchId] of ["r3-wave-01", "r3-wave-02", "r3-wave-03", "r3-wave-04", "r3-wave-05"].entries()) {
      const gate = await writeGateEvidence(priorDir, `r3-gate-${index}`, index === 0 ? 3_600 : 0);
      const phaseDir = join(root, `r3-phase-${index + 1}`);
      const phase = await runKusabiDirectFleetRollout({
        ...fixed,
        apply: true,
        resume_batch: batchId,
        output_dir: phaseDir,
        plan_dir: planDir,
        authorization_file: authorizationFile,
        prior_apply_dir: priorDir,
        gate_observations_file: gate.observationsFile,
        gate_status_file: gate.statusFile,
      });
      check(phase.apply_reports.length === 1 && phase.apply_reports[0].batch_id === batchId &&
        phase.status === "phase_gate_required", `${batchId} applies alone and stops`);
      appliedR3Batches.push(phase.apply_reports[0].batch_id);
      priorDir = phaseDir;
    }
    check(appliedR3Batches.join(",") === "r3-wave-01,r3-wave-02,r3-wave-03,r3-wave-04,r3-wave-05",
      "all five R3 waves advance one immutable durable-gated phase at a time");

    const finalGate = await writeGateEvidence(priorDir, "r3-final-gate", 0);
    await expectCode("KUSABI_DIRECT_FINALIZE_PHASE_INVALID", () => runKusabiDirectFleetRollout({
      ...fixed,
      apply: true,
      finalize: true,
      output_dir: join(root, "premature-finalize"),
      plan_dir: planDir,
      authorization_file: authorizationFile,
      prior_apply_dir: r2Dir,
      gate_observations_file: finalGate.observationsFile,
      gate_status_file: finalGate.statusFile,
    }));
    const finalDir = join(root, "final-closure");
    const finalized = await runKusabiDirectFleetRollout({
      ...fixed,
      apply: true,
      finalize: true,
      output_dir: finalDir,
      plan_dir: planDir,
      authorization_file: authorizationFile,
      prior_apply_dir: priorDir,
      gate_observations_file: finalGate.observationsFile,
      gate_status_file: finalGate.statusFile,
    });
    check(finalized.status === "applied" && finalized.apply_reports.length === 0 &&
      finalized.final_durable_gate_reports.length === 7 &&
      finalized.final_durable_gate_reports.every(({ verdict }) => verdict === "PASS"),
    "gate-only finalize seals all seven durable gates without another configuration effect");
    check(finalized.phase_receipt?.batch_id === "r3-wave-05" && finalized.summary.placed_count === 0 &&
      (await readdir(finalDir)).includes("final-closure-report.json") &&
      ((await lstat(finalDir)).mode & 0o777) === 0o500,
    "final closure remains bound to the last phase and persists immutable zero-effect evidence");

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

    const evidenceFailurePlan = join(root, "evidence-failure-plan");
    const evidenceFailureFixed = {
      ...fixed,
      captured_at: "2026-08-13T11:01:30.000Z",
      activation_at: "2026-08-13T11:01:30.000Z",
    };
    const beforeEvidenceFailure = await readAllConfigs(rows);
    await runKusabiDirectFleetRollout({ ...evidenceFailureFixed, output_dir: evidenceFailurePlan });
    const evidenceFailureSeal = JSON.parse(await readFile(join(evidenceFailurePlan, "plan-seal.json"), "utf8"));
    const evidenceFailureAuthorizationFile = join(root, "evidence-failure-authorization.json");
    await writeFile(evidenceFailureAuthorizationFile, JSON.stringify(sealKusabiDirectRolloutAuthorization({
      expected_head: "1".repeat(40),
      plan_seal_sha256: evidenceFailureSeal.plan_seal_sha256,
      decision_id: "owner-direct-test-evidence-failure-20260813",
      decision_ref_sha256: sha256("owner-directive:test-fixture-evidence-failure"),
      independent_audit_sha256: sha256("independent-audit:fixture-evidence-failure-pass"),
    })), { mode: 0o400 });
    const evidenceFailureOutput = join(root, "evidence-failure-output");
    let evidenceApplyAttemptCount = 0;
    try {
      await runKusabiDirectFleetRollout({
        ...evidenceFailureFixed,
        apply: true,
        output_dir: evidenceFailureOutput,
        plan_dir: evidenceFailurePlan,
        authorization_file: evidenceFailureAuthorizationFile,
        test_before_target_apply: async () => {
          evidenceApplyAttemptCount++;
          if (evidenceApplyAttemptCount !== 2) return;
          await mkdir(join(evidenceFailureOutput, "apply-r1-kusabi.json"));
          throw new Error("fixture partial R1 failure with blocked evidence path");
        },
      });
      assert.fail("expected evidence-write failure rollback");
    } catch (error) {
      assert(error instanceof KusabiDirectFleetRolloutError);
      check(error.report?.status === "failed_rolled_back" && error.report.summary.rollback_count === 2,
        "evidence write failure cannot prevent rollback of partial current-batch effects");
      check(error.report?.evidence_errors.some(({ artifact, code }) =>
        artifact === "apply-r1-kusabi.json" && code.length > 0),
      "partial-report write failure is aggregated separately from configuration rollback");
    }
    const afterEvidenceFailure = await readAllConfigs(rows);
    check([...beforeEvidenceFailure].every(([path, raw]) => afterEvidenceFailure.get(path)?.equals(raw)),
      "partial batch is restored before failed evidence persistence is attempted");
    const evidenceFailureReport = JSON.parse(await readFile(
      join(evidenceFailureOutput, "direct-rollout-failure-report.json"), "utf8"));
    check(evidenceFailureReport.status === "failed_rolled_back" &&
      evidenceFailureReport.evidence_errors.some((item: any) => item.artifact === "apply-r1-kusabi.json"),
    "available failure evidence persists the separate evidence-write error");

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
          const host = target.identity.host_runtime as "antigravity_cli" | "codex" | "claude_code" | "gemini_cli";
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
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await chmodTree(root, 0o700, 0o600).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
