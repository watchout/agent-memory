#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  applyKusabiFleetRolloutBatch,
  assertKusabiFleetInventorySnapshot,
  assertKusabiFleetRolloutAuthorization,
  assertKusabiFleetRolloutPlan,
  evaluateKusabiFleetBatchGate,
  KUSABI_FLEET_INVENTORY_QUERY_CONTRACT_SHA256,
  kusabiCodexHookTrustRecords,
  observeKusabiFleetDeployment,
  prepareKusabiFleetR0,
  sealKusabiFleetInventorySnapshot,
  sealKusabiFleetRolloutAuthorization,
  type KusabiFleetInventoryBindingInput,
  type KusabiFleetInventorySnapshot,
  type KusabiFleetInventorySnapshotInput,
  type KusabiFleetObservedTarget,
  type KusabiFleetR0Options,
  type KusabiFleetRolloutTargetInput,
} from "./kusabi-fleet-rollout.js";
import type {
  KusabiFleetManifest,
  KusabiFleetStatusSnapshot,
  KusabiHostRuntime,
} from "./kusabi-fleet-status.js";

const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const STORAGE = { backend: "sqlite" as const, binding_sha256: digest("sqlite-binding") };
const ACTIVATION = "2026-08-01T05:00:00.000Z";
const DEADLINE = "2026-08-01T05:05:00.000Z";
let assertions = 0;

function check(condition: unknown, message: string): void {
  assert(condition, message);
  assertions++;
}

async function expectCode(code: string, operation: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error: any) {
    assert.equal(error?.code, code);
    assertions++;
    return;
  }
  assert.fail(`expected ${code}`);
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "kusabi-fleet-rollout-"));
  try {
    const runtimeRoot = join(root, "runtime");
    await mkdir(join(runtimeRoot, "dist"), { recursive: true });
    await writeFile(join(runtimeRoot, "dist", "codex-session-start.js"), "codex-artifact-v1\n");
    await writeFile(join(runtimeRoot, "dist", "claude-session-start.js"), "claude-artifact-v1\n");
    await writeFile(join(runtimeRoot, "dist", "gemini-session-start.js"), "gemini-artifact-v1\n");
    await writeFile(join(root, "codex-config.toml"), "[hooks.state]\n");
    await writeFile(join(root, "claude-state.json"), '{"projects":{}}');
    await writeFile(join(root, "gemini-trusted-folders.json"), "{}");
    await writeFile(join(root, "gemini-trusted-hooks.json"), "{}");

    const targets: KusabiFleetRolloutTargetInput[] = [];
    const hosts: KusabiHostRuntime[] = ["codex", "claude_code", "gemini_cli", "codex", "claude_code"];
    for (let index = 0; index < hosts.length; index++) {
      const workspaceInput = join(root, `workspace-${index + 1}`);
      await mkdir(workspaceInput, { recursive: true });
      const workspace = await realpath(workspaceInput);
      const stage = index < 3 ? "r1" as const : index === 3 ? "r2" as const : "r3" as const;
      const batchId = stage === "r1" ? "r1-01" : stage === "r2" ? "r2-01" : "r3-01";
      targets.push({
        agent_id: index < 3 ? "kusabi" : `agent-${index + 1}`,
        project: `project-${index + 1}`,
        host_runtime: hosts[index],
        workspace,
        binding_source_ref: `binding-source-${index + 1}`,
        storage: STORAGE,
        trust_source: trustSourceFor(root, hosts[index]),
        stage,
        batch_id: batchId,
      });
    }
    await seedUnrelatedConfig(targets[0]);
    await seedUnrelatedConfig(targets[1]);
    await seedUnrelatedConfig(targets[2]);

    const before = await Promise.all(targets.map(readRawConfig));
    const options = r0Options(runtimeRoot, targets);
    const r0 = await prepareKusabiFleetR0(options);
    const after = await Promise.all(targets.map(readRawConfig));
    check(JSON.stringify(before) === JSON.stringify(after), "R0 is read-only byte-for-byte");
    check(r0.manifest.targets.length === 5 && r0.report.target_count === 5, "R0 freezes the exact denominator");
    check(r0.inventory_snapshot.bindings.length === 5 &&
      r0.rollout_plan.inventory.snapshot_sha256 === r0.inventory_snapshot.snapshot_sha256 &&
      r0.report.inventory.snapshot_sha256 === r0.inventory_snapshot.snapshot_sha256,
    "R0 binds the authoritative inventory snapshot into plan and report");
    check(r0.inventory_snapshot.source.query_contract_sha256 === KUSABI_FLEET_INVENTORY_QUERY_CONTRACT_SHA256 &&
      r0.inventory_snapshot.source.primary_result_sha256 === r0.rollout_plan.inventory.primary_result_sha256 &&
      r0.inventory_snapshot.primary_binding_count + r0.inventory_snapshot.secondary_binding_count === 5,
    "R0 pins the shared-DB query contract and primary/secondary denominator");
    assertKusabiFleetInventorySnapshot(r0.inventory_snapshot);
    assertions++;
    check(new Set(r0.manifest.targets.map((target) => target.target_key)).size === 5,
      "R0 target keys are unique");
    check(r0.rollout_plan.batches.map((batch) => batch.target_keys.length).join(",") === "3,1,1",
      "R1/R2/R3 memberships are deterministic");
    check(r0.report.production_mutation_count === 0 && r0.report.forbidden_value_count === 0,
      "R0 reports zero mutation and forbidden values");
    check(r0.report.targets.every((target) =>
      !target.preimage_trust_exact && target.preimage_trust_fingerprint_sha256.length === 64 &&
      target.expected_trust_fingerprint_sha256.length === 64 && target.trust_source_locator_sha256.length === 64),
    "R0 records credential-safe native trust preimages for every target");
    const persisted = JSON.stringify(r0);
    check(!targets.some((target) => persisted.includes(target.workspace)), "R0 artifacts contain no raw workspace paths");
    check(!targets.some((target) => persisted.includes(target.binding_source_ref)),
      "R0 artifacts contain no raw binding refs");
    check(!targets.some((target) => {
      const source = target.trust_source;
      return Object.values(source).some((value) => typeof value === "string" && value !== source.kind &&
        persisted.includes(value));
    }), "R0 artifacts contain no raw trust-state locators");

    const schema = JSON.parse(await readFile(
      join(process.cwd(), "docs/design/schemas/kusabi-fleet-rollout-plan-v1.schema.json"), "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validatePlan = ajv.compile(schema);
    check(validatePlan(r0.rollout_plan), "rollout plan validates against the normative schema");
    check(!validatePlan({ ...r0.rollout_plan, unexpected: true }),
      "normative schema rejects unknown rollout-plan fields");
    assertKusabiFleetRolloutPlan(r0.rollout_plan, r0.manifest, r0.inventory_snapshot);
    assertions++;

    const staleAliasTargets = structuredClone(targets);
    staleAliasTargets[0].agent_id = "legacy-agent-id";
    await expectCode("KUSABI_FLEET_INVENTORY_MANIFEST_MISMATCH",
      () => prepareKusabiFleetR0(r0Options(runtimeRoot, staleAliasTargets, r0.inventory_snapshot)));
    const missingTarget = targets.slice(0, -1);
    await expectCode("KUSABI_FLEET_INVENTORY_MANIFEST_MISMATCH",
      () => prepareKusabiFleetR0(r0Options(runtimeRoot, missingTarget, r0.inventory_snapshot)));
    const tamperedInventory = structuredClone(r0.inventory_snapshot);
    tamperedInventory.snapshot_sha256 = "f".repeat(64);
    await expectCode("KUSABI_FLEET_INVENTORY_HASH_MISMATCH",
      () => prepareKusabiFleetR0(r0Options(runtimeRoot, targets, tamperedInventory)));
    const unsortedInventory = structuredClone(r0.inventory_snapshot);
    unsortedInventory.bindings.reverse();
    await expectCode("KUSABI_FLEET_INVENTORY_ORDER_INVALID",
      () => assertKusabiFleetInventorySnapshot(unsortedInventory));
    const ineligibleBindings = inventoryBindingsFor(targets);
    ineligibleBindings[0].eligibility = {
      ...ineligibleBindings[0].eligibility,
      new_work_allowed: false,
    } as KusabiFleetInventoryBindingInput["eligibility"];
    await expectCode("KUSABI_FLEET_INVENTORY_BINDING_INVALID", () => sealKusabiFleetInventorySnapshot({
      schema_version: "kusabi-fleet-inventory-snapshot/v1",
      source: inventorySource(),
      bindings: ineligibleBindings,
    }));
    const aliasBindings = inventoryBindingsFor(targets);
    aliasBindings[0].registered_agent_id = "legacy-alias";
    await expectCode("KUSABI_FLEET_INVENTORY_BINDING_INVALID", () => sealKusabiFleetInventorySnapshot({
      schema_version: "kusabi-fleet-inventory-snapshot/v1",
      source: inventorySource(),
      bindings: aliasBindings,
    }));

    const unsorted = structuredClone(r0.rollout_plan);
    unsorted.batches[0].target_keys.reverse();
    await expectCode("KUSABI_FLEET_ROLLOUT_TARGET_ORDER_INVALID",
      () => assertKusabiFleetRolloutPlan(unsorted, r0.manifest));
    const forged = structuredClone(r0.rollout_plan);
    forged.rollout_plan_sha256 = "f".repeat(64);
    await expectCode("KUSABI_FLEET_ROLLOUT_PLAN_HASH_MISMATCH",
      () => assertKusabiFleetRolloutPlan(forged, r0.manifest));

    const authorization = sealKusabiFleetRolloutAuthorization({
      schema_version: "kusabi-fleet-rollout-authorization/v1",
      decision_id: "ODR-KUSABI-FLEET-TEST-001",
      approved: true,
      implementation_head_sha: COMMIT,
      implementation_tree_sha: TREE,
      manifest_sha256: r0.manifest.manifest_sha256,
      rollout_plan_sha256: r0.rollout_plan.rollout_plan_sha256,
      decision_ref_sha256: digest("owner-decision-ref"),
    });
    assertKusabiFleetRolloutAuthorization(authorization);
    assertions++;
    const badAuthorization = { ...authorization, manifest_sha256: "9".repeat(64) };
    await expectCode("KUSABI_FLEET_AUTHORIZATION_HASH_MISMATCH",
      () => assertKusabiFleetRolloutAuthorization(badAuthorization));

    await expectCode("KUSABI_FLEET_ROLLOUT_INVENTORY_MISMATCH", () => applyKusabiFleetRolloutBatch({
      plan: r0.rollout_plan,
      manifest: r0.manifest,
      inventory_snapshot: inventorySnapshotFor(targets.slice(0, -1)),
      authorization,
      batch_id: "r1-01",
      runtime_root: runtimeRoot,
      targets,
    }));

    const r1Apply = await applyKusabiFleetRolloutBatch({
      plan: r0.rollout_plan,
      manifest: r0.manifest,
      inventory_snapshot: r0.inventory_snapshot,
      authorization,
      batch_id: "r1-01",
      runtime_root: runtimeRoot,
      targets,
    });
    check(r1Apply.placed_count === 3 && r1Apply.attempted_count === 3, "R1 applies the three-host canary");
    check(r1Apply.target_results.every((target) => target.postimage_sha256.length === 64),
      "R1 returns only hashed config evidence");
    for (const target of targets.slice(0, 3)) {
      const mode = (await lstat(configPath(target))).mode & 0o777;
      check(mode === 0o600, `${target.host_runtime} config is mode 0600`);
      const raw = await readFile(configPath(target), "utf8");
      check(raw.includes("unrelated-hook"), `${target.host_runtime} unrelated hook is preserved`);
    }
    const untrustedInput = targets[0];
    const untrustedObservation = await observeKusabiFleetDeployment({
      target: manifestTargetFor(r0.manifest, untrustedInput),
      workspace: untrustedInput.workspace,
      runtime_root: runtimeRoot,
      binding_source_ref: untrustedInput.binding_source_ref,
      trust_source: trustSourceFor(root, untrustedInput.host_runtime),
      observed_storage: STORAGE,
      observed_commit_sha: COMMIT,
      observed_tree_sha: TREE,
      observed_at: "2026-08-01T05:00:30.000Z",
    });
    check(!untrustedObservation.trust_exact && !untrustedObservation.exact,
      "expected trust cannot be copied into observed identity before native trust exists");
    await writeTrustFixtures(root, targets.slice(0, 3));

    const observations: KusabiFleetObservedTarget[] = [];
    for (const input of targets.slice(0, 3)) {
      const target = manifestTargetFor(r0.manifest, input);
      observations.push(await observeKusabiFleetDeployment({
        target,
        workspace: input.workspace,
        runtime_root: runtimeRoot,
        binding_source_ref: input.binding_source_ref,
        trust_source: trustSourceFor(root, input.host_runtime),
        observed_storage: STORAGE,
        observed_commit_sha: COMMIT,
        observed_tree_sha: TREE,
        observed_at: "2026-08-01T05:01:00.000Z",
      }));
    }
    check(observations.every((observation) => observation.exact),
      "observer independently reads exact build/config/binding/trust/storage identity");
    check(!observations.some((observation) => JSON.stringify(observation).includes(runtimeRoot)),
      "observation evidence contains no runtime path");

    const healthyStatus = statusFor(r0.manifest, observations.map(({ target_key }) => target_key));
    const r1Gate = evaluateKusabiFleetBatchGate(
      r0.rollout_plan, r0.manifest, "r1-01", observations, healthyStatus);
    check(r1Gate.verdict === "PASS" && r1Gate.exact_observed_count === 3 && r1Gate.healthy_durable_count === 3,
      "R1 gate passes only exact and durable 3/3");
    const p1Status = structuredClone(healthyStatus);
    p1Status.summary.open_p1_count = 1;
    const blockingAction = {
      actor_agent_id: "kusabi",
      active_function: "implementation_executor",
      action: "stop current stage",
      deliver_via: "local",
      exact_input_refs: [digest("p1-input")],
      scope: "current batch only",
      deliverable: "resolved P1",
      completion_evidence: "exact readback",
      blocking: true,
    };
    p1Status.alerts = [{
      alert_id: "00000000-0000-4000-8000-000000000099",
      severity: "P1",
      code: "runtime_failure",
      target_key: r0.manifest.targets.at(-1)!.target_key,
      first_seen_at: "2026-08-01T05:00:30.000Z",
      last_seen_at: "2026-08-01T05:00:30.000Z",
      occurrence_count: 1,
      fingerprint_sha256: digest("runtime-failure"),
      status: "open",
      evidence_refs: [{
        kind: "local_store",
        locator_sha256: digest("locator"),
        content_sha256: digest("content"),
      }],
      next_action: blockingAction,
    }];
    p1Status.next_action = blockingAction;
    const p1Gate = evaluateKusabiFleetBatchGate(
      r0.rollout_plan, r0.manifest, "r1-01", observations, p1Status);
    check(p1Gate.verdict === "BLOCKED" && p1Gate.blockers.includes("open_p1"), "open P1 blocks stage progress");

    await expectCode("KUSABI_FLEET_PRIOR_BATCH_GATE_REQUIRED", () => applyKusabiFleetRolloutBatch({
      plan: r0.rollout_plan,
      manifest: r0.manifest,
      inventory_snapshot: r0.inventory_snapshot,
      authorization,
      batch_id: "r2-01",
      runtime_root: runtimeRoot,
      targets,
    }));
    const r2Apply = await applyKusabiFleetRolloutBatch({
      plan: r0.rollout_plan,
      manifest: r0.manifest,
      inventory_snapshot: r0.inventory_snapshot,
      authorization,
      batch_id: "r2-01",
      runtime_root: runtimeRoot,
      targets,
      prior_gate_reports: [r1Gate],
    });
    check(r2Apply.placed_count === 1, "R2 advances automatically after the exact R1 gate");
    await writeTrustFixtures(root, targets.slice(0, 4));
    const r2Input = targets[3];
    const r2Observation = await observeKusabiFleetDeployment({
      target: manifestTargetFor(r0.manifest, r2Input),
      workspace: r2Input.workspace,
      runtime_root: runtimeRoot,
      binding_source_ref: r2Input.binding_source_ref,
      trust_source: trustSourceFor(root, r2Input.host_runtime),
      observed_storage: STORAGE,
      observed_commit_sha: COMMIT,
      observed_tree_sha: TREE,
      observed_at: "2026-08-01T05:02:00.000Z",
    });
    const r2Status = statusFor(r0.manifest, [r2Observation.target_key]);
    r2Status.generated_at = "2026-08-01T06:01:00.000Z";
    r2Status.window.ended_at = r2Status.generated_at;
    const r2NoStart = evaluateKusabiFleetBatchGate(
      r0.rollout_plan, r0.manifest, "r2-01", [r2Observation], r2Status, [r1Gate]);
    check(r2NoStart.verdict === "BLOCKED" && r2NoStart.blockers.includes("batch_start_not_observed"),
      "a nonzero soak cannot pass without an observed batch start");
    const r2Early = evaluateKusabiFleetBatchGate(
      r0.rollout_plan, r0.manifest, "r2-01", [r2Observation], r2Status, [r1Gate],
      "2026-08-01T05:30:00.000Z");
    check(r2Early.verdict === "BLOCKED" && r2Early.blockers.includes("minimum_soak_not_met"),
      "R2 cannot advance before the one-hour soak");
    const r2Gate = evaluateKusabiFleetBatchGate(
      r0.rollout_plan, r0.manifest, "r2-01", [r2Observation], r2Status, [r1Gate],
      "2026-08-01T05:01:00.000Z");
    check(r2Gate.verdict === "PASS" && r2Gate.soak_elapsed_seconds === 3_600,
      "R2 advances at the exact one-hour healthy threshold");

    const tamperTarget = targets[0];
    await writeFile(configPath(tamperTarget), `${await readFile(configPath(tamperTarget), "utf8")}\n`);
    const drifted = await observeKusabiFleetDeployment({
      target: manifestTargetFor(r0.manifest, tamperTarget),
      workspace: tamperTarget.workspace,
      runtime_root: runtimeRoot,
      binding_source_ref: tamperTarget.binding_source_ref,
      trust_source: trustSourceFor(root, tamperTarget.host_runtime),
      observed_storage: STORAGE,
      observed_commit_sha: COMMIT,
      observed_tree_sha: TREE,
      observed_at: "2026-08-01T05:02:00.000Z",
    });
    check(drifted.managed_binding_exact && !drifted.config_exact && !drifted.exact,
      "byte drift cannot be false-accepted even when the managed command still parses");

    const symlinkWorkspace = join(root, "unsafe-workspace");
    await mkdir(symlinkWorkspace);
    await symlink(join(root, "missing-config-dir"), join(symlinkWorkspace, ".codex"));
    const unsafeTargets = structuredClone(targets);
    unsafeTargets[0] = { ...unsafeTargets[0], workspace: symlinkWorkspace };
    await expectCode("KUSABI_FLEET_CONFIG_DIRECTORY_UNSAFE",
      () => prepareKusabiFleetR0(r0Options(runtimeRoot, unsafeTargets)));

    console.log(`Kusabi fleet rollout tests passed (${assertions} assertions).`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function r0Options(
  runtimeRoot: string,
  targets: KusabiFleetRolloutTargetInput[],
  inventorySnapshot: KusabiFleetInventorySnapshot = inventorySnapshotFor(targets),
): KusabiFleetR0Options {
  return {
    manifest_id: "kusabi-fleet-test-20260801",
    manifest_version: 1,
    rollout_id: "kusabi-rollout-test-20260801",
    runtime_root: runtimeRoot,
    commit_sha: COMMIT,
    tree_sha: TREE,
    activation_at: ACTIVATION,
    durable_evidence_deadline_at: DEADLINE,
    stale_after_seconds: 120,
    captured_at: "2026-08-01T04:59:00.000Z",
    batch_order: [
      { batch_id: "r1-01", stage: "r1", ordinal: 1, minimum_soak_seconds: 0 },
      { batch_id: "r2-01", stage: "r2", ordinal: 2, minimum_soak_seconds: 3_600 },
      { batch_id: "r3-01", stage: "r3", ordinal: 3, minimum_soak_seconds: 0 },
    ],
    inventory_snapshot: inventorySnapshot,
    targets,
  };
}

function inventorySource(): KusabiFleetInventorySnapshotInput["source"] {
  return {
    kind: "agent_comms_postgres",
    query_contract_id: "kusabi-fleet-eligibility/v1",
    query_contract_sha256: KUSABI_FLEET_INVENTORY_QUERY_CONTRACT_SHA256,
    captured_at: "2026-08-01T04:59:00.000Z",
  };
}

function inventoryBindingsFor(targets: KusabiFleetRolloutTargetInput[]): KusabiFleetInventoryBindingInput[] {
  return targets.map((target) => ({
    registered_agent_id: target.agent_id,
    canonical_agent_id: target.agent_id,
    project: target.project,
    host_runtime: target.host_runtime,
    workspace_sha256: digest(target.workspace),
    binding_source: target.host_runtime === "codex" ? "agent_comms_primary" : "owner_approved_secondary",
    binding_source_ref_sha256: digest(target.binding_source_ref),
    eligibility: {
      canonical_identity_verified: true,
      agent_type_non_human: true,
      agent_active: true,
      profile_enabled: true,
      runtime_supported: true,
      production_workspace: true,
      workspace_binding_active: true,
      new_work_allowed: true,
    },
  }));
}

function inventorySnapshotFor(targets: KusabiFleetRolloutTargetInput[]): KusabiFleetInventorySnapshot {
  return sealKusabiFleetInventorySnapshot({
    schema_version: "kusabi-fleet-inventory-snapshot/v1",
    source: inventorySource(),
    bindings: inventoryBindingsFor(targets),
  });
}

async function seedUnrelatedConfig(target: KusabiFleetRolloutTargetInput): Promise<void> {
  const path = configPath(target);
  await mkdir(join(target.workspace, target.host_runtime === "codex" ? ".codex" :
    target.host_runtime === "claude_code" ? ".claude" : ".gemini"), { recursive: true });
  const group = target.host_runtime === "gemini_cli"
    ? { matcher: "startup", sequential: true, hooks: [{ type: "command", name: "unrelated-hook", command: "true" }] }
    : { matcher: "startup", hooks: [{ type: "command", command: "unrelated-hook" }] };
  const value = target.host_runtime === "codex"
    ? { description: "existing", hooks: { SessionStart: [group] }, unrelated: true }
    : { hooks: { SessionStart: [group] }, unrelated: true };
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
}

function configPath(target: KusabiFleetRolloutTargetInput): string {
  if (target.host_runtime === "codex") return join(target.workspace, ".codex", "hooks.json");
  if (target.host_runtime === "claude_code") return join(target.workspace, ".claude", "settings.json");
  return join(target.workspace, ".gemini", "settings.json");
}

async function readRawConfig(target: KusabiFleetRolloutTargetInput): Promise<string | null> {
  try {
    return await readFile(configPath(target), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeTrustFixtures(root: string, targets: KusabiFleetRolloutTargetInput[]): Promise<void> {
  const codexTables: string[] = [];
  const claudeProjects: Record<string, unknown> = {};
  const geminiFolders: Record<string, unknown> = {};
  const geminiHooks: Record<string, unknown> = {};
  for (const target of targets) {
    const workspace = await realpath(target.workspace);
    const raw = await readFile(configPath({ ...target, workspace }), "utf8");
    if (target.host_runtime === "codex") {
      for (const record of kusabiCodexHookTrustRecords(raw)) {
        const key = `${configPath({ ...target, workspace })}:session_start:${record.group_index}:${record.handler_index}`;
        codexTables.push(`[hooks.state.${JSON.stringify(key)}]\ntrusted_hash = ${JSON.stringify(record.current_hash)}`);
      }
    } else if (target.host_runtime === "claude_code") {
      claudeProjects[workspace] = { hasTrustDialogAccepted: true };
    } else {
      const parsed = JSON.parse(raw);
      const commands = new Set<string>();
      for (const group of parsed.hooks.SessionStart) {
        for (const hook of group.hooks) {
          if (typeof hook.command === "string" && hook.command.includes("wasurezu-gemini-session-start")) {
            commands.add(hook.command);
          }
        }
      }
      geminiFolders[workspace] = "TRUST_FOLDER";
      geminiHooks[workspace] = [...commands];
    }
  }
  await writeFile(join(root, "codex-config.toml"), `${codexTables.join("\n\n")}\n`);
  await writeFile(join(root, "claude-state.json"), JSON.stringify({ projects: claudeProjects }));
  await writeFile(join(root, "gemini-trusted-folders.json"), JSON.stringify(geminiFolders));
  await writeFile(join(root, "gemini-trusted-hooks.json"), JSON.stringify(geminiHooks));
}

function trustSourceFor(root: string, host: KusabiHostRuntime) {
  if (host === "codex") return {
    kind: "codex_hook_state" as const,
    config_toml: join(root, "codex-config.toml"),
  };
  if (host === "claude_code") return {
    kind: "claude_project_state" as const,
    claude_state_json: join(root, "claude-state.json"),
  };
  return {
    kind: "gemini_hook_state" as const,
    trusted_folders_json: join(root, "gemini-trusted-folders.json"),
    trusted_hooks_json: join(root, "gemini-trusted-hooks.json"),
  };
}

function manifestTargetFor(
  manifest: KusabiFleetManifest,
  input: KusabiFleetRolloutTargetInput,
): KusabiFleetManifest["targets"][number] {
  const found = manifest.targets.find((target) =>
    target.identity.agent_id === input.agent_id && target.identity.project === input.project &&
    target.identity.host_runtime === input.host_runtime);
  assert(found);
  return found;
}

function statusFor(manifest: KusabiFleetManifest, healthyTargetKeys: string[]): KusabiFleetStatusSnapshot {
  const healthy = new Set(healthyTargetKeys);
  const targets = manifest.targets.map((target, index) => ({
    target_key: target.target_key,
    identity: target.identity,
    state: healthy.has(target.target_key) ? "healthy" as const : "not_observed" as const,
    state_reasons: healthy.has(target.target_key) ? [] : ["no_observation" as const],
    expected: target.expected,
    observed: healthy.has(target.target_key) ? {
      deployment: target.expected,
      last_event_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      last_event_at: "2026-08-01T05:01:00.000Z",
      evidence_delivery: "durable" as const,
    } : null,
    last_seen_at: healthy.has(target.target_key) ? "2026-08-01T05:01:00.000Z" : null,
    stale_after_seconds: target.stale_after_seconds,
    event_count: healthy.has(target.target_key) ? 1 : 0,
    consecutive_degraded: 0,
    maintenance_active: false,
    evidence_refs: [],
  }));
  return {
    schema_version: "kusabi-fleet-status/v1",
    snapshot_id: "00000000-0000-4000-8000-000000000001",
    generated_at: "2026-08-01T05:01:00.000Z",
    manifest: {
      manifest_id: manifest.manifest_id,
      version: manifest.version,
      manifest_sha256: manifest.manifest_sha256,
      target_count: manifest.targets.length,
    },
    window: { started_at: ACTIVATION, ended_at: "2026-08-01T05:01:00.000Z" },
    summary: {
      target_count: targets.length,
      healthy_count: healthy.size,
      degraded_count: 0,
      failed_count: 0,
      stale_count: 0,
      not_observed_count: targets.length - healthy.size,
      drifted_count: 0,
      open_p0_count: 0,
      open_p1_count: 0,
      open_p2_count: 0,
      open_p3_count: 0,
      exact_observation_rate: healthy.size / targets.length,
      durable_evidence_rate: healthy.size / targets.length,
    },
    targets,
    alerts: [],
    next_action: "none",
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

void main();
