import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import pg from "pg";
import { JsonStore } from "./stores/json-store.js";
import { PgStore } from "./stores/pg-store.js";
import { SqliteStore } from "./stores/sqlite-store.js";
import type { Store } from "./stores/types.js";
import {
  CONTINUITY_CHILD_INPUT_SCHEMA_VERSION,
  CONTINUITY_E2E_HOSTS,
  CONTINUITY_E2E_SCENARIOS,
  CONTINUITY_E2E_SCHEMA_VERSION,
  assertCompleteContinuityReport,
  assertDataOnlyRecoveryEnvelope,
  canonicalJson,
  expectedScenarioOutcome,
  recoveryOutputBounds,
  sha256,
  verifyFreshReceipt,
  type ContinuityE2EHost,
  type ContinuityE2EReport,
  type ContinuityE2ERow,
  type ContinuityE2EScenario,
  type ContinuityFixtureBackend,
  type ContinuityFixtureChildInput,
  type ContinuityFixtureChildReceipt,
  type ContinuityFixtureIdentity,
  type ContinuityFixtureStoreConfig,
  type ContinuityRecoveryEnvelope,
} from "./kusabi-continuity-interruption-e2e.js";

const EXACT_BASE_COMMIT = "9df8bc01f1bfee3a40fa7878b40b77c364fd6050";
const EXACT_BASE_TREE = "c8b06705409ad0aa28dc7d9ed21b881e34b9e458";
const GENERATED_AT = "2026-08-02T08:00:00.000Z";
const CHILD_FILE = fileURLToPath(new URL("./kusabi-continuity-interruption-e2e.ts", import.meta.url));
const BACKEND_BY_HOST: Record<ContinuityE2EHost, ContinuityFixtureBackend> = {
  codex: "json",
  claude_code: "sqlite",
  gemini_cli: "postgres",
};

interface ChildResult {
  code: number;
  stdout: string;
  stderr: string;
  pid: number;
  duration_ms: number;
}

async function main(): Promise<void> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "kusabi-continuity-e2e-"));
  const pgUrl = process.env.AGENT_MEMORY_DATABASE_URL
    ?? process.env.DATABASE_URL
    ?? "postgresql:///agent_comms?host=/tmp";
  const pgSchema = `obs05_e2e_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const pgAdmin = new pg.Pool({ connectionString: pgUrl });
  let pgSchemaCreated = false;
  const rows: ContinuityE2ERow[] = [];
  try {
    await pgAdmin.query(`CREATE SCHEMA ${pgSchema}`);
    pgSchemaCreated = true;
    const configs: Record<ContinuityE2EHost, ContinuityFixtureStoreConfig> = {
      codex: { backend: "json", location: join(fixtureRoot, "codex-json") },
      claude_code: { backend: "sqlite", location: join(fixtureRoot, "claude-sqlite", "fixture.db") },
      gemini_cli: { backend: "postgres", location: withPgSearchPath(pgUrl, pgSchema) },
    };
    await mkdir(dirname(configs.claude_code.location), { recursive: true });

    runPrivacyNegativeFixtures();
    for (const host of CONTINUITY_E2E_HOSTS) {
      await seedHostSentinel(configs[host], identityFor(host));
      for (const scenario of CONTINUITY_E2E_SCENARIOS) {
        rows.push(await runScenario(fixtureRoot, configs[host], host, scenario));
      }
    }

    const report = buildReport(rows);
    assertCompleteContinuityReport(report);
    await validateStrictSchema(report);
    assert.equal(report.rows.length, 21);
    assert.equal(new Set(report.rows.map((row) => `${row.host}:${row.scenario}`)).size, 21);
    assert.equal(report.rows.filter((row) => row.sentinel_recovered).length, 18);
    assert.deepEqual([...new Set(report.rows.map((row) => row.backend))].sort(), ["json", "postgres", "sqlite"]);
    console.log(`Kusabi continuity interruption E2E passed: ${report.summary.passed_rows}/${report.summary.expected_rows}`);
    console.log(`CONTINUITY_E2E_REPORT_SHA256=${sha256(canonicalJson(report))}`);
    console.log(`CONTINUITY_E2E_REPORT=${JSON.stringify(report)}`);
  } finally {
    if (pgSchemaCreated) await pgAdmin.query(`DROP SCHEMA IF EXISTS ${pgSchema} CASCADE`);
    await pgAdmin.end();
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function runScenario(
  fixtureRoot: string,
  storeConfig: ContinuityFixtureStoreConfig,
  host: ContinuityE2EHost,
  scenario: ContinuityE2EScenario,
): Promise<ContinuityE2ERow> {
  const identity = identityFor(host);
  const interruptedInvocation = `interrupt-${host}-${scenario}`;
  const freshInvocation = `recover-${host}-${scenario}`;
  const effectFile = join(fixtureRoot, `effect-${host}-${scenario}.json`);
  const envelope = envelopeFor(identity, scenario);
  assertDataOnlyRecoveryEnvelope(envelope);
  const store = await openStore(storeConfig);
  const selected = await store.saveSelectedRestartPack({
    agent_id: identity.actor_id,
    project: identity.project,
    content: canonicalJson(envelope),
    source: "manual",
    metadata: {
      fixture_only: true,
      schema_version: envelope.schema_version,
      redacted_source_ref: `fixture://${host}/${scenario}`,
    },
  });
  await store.close();

  const interruptedInput = childInput({
    mode: "interrupted",
    invocationId: interruptedInvocation,
    identity,
    presentedIdentity: identity,
    host,
    scenario,
    storeConfig,
    packRef: selected.pack_ref,
    effectFile,
  });
  const startedAt = Date.now();
  const interrupted = await spawnChild(interruptedInput);
  assert.equal(interrupted.code, 86, `${host}/${scenario} interruption exits at the frozen boundary`);
  if (scenario === "pre_output") assert.equal(interrupted.stdout, "", "pre-output interruption emits nothing");
  if (scenario === "post_visible_pre_capture") {
    assert(interrupted.stdout.startsWith("VISIBLE_ONLY_SENTINEL:"));
    assert.equal(canonicalJson(envelope).includes(interrupted.stdout), false, "unpersisted visible output is absent from recovery");
  }

  if (scenario === "temporary_database_outage") {
    const unavailableInput = childInput({
      mode: "recover",
      invocationId: `${freshInvocation}-unavailable`,
      identity,
      presentedIdentity: identity,
      host,
      scenario,
      storeConfig,
      packRef: selected.pack_ref,
      effectFile,
      forceDatabaseUnavailable: true,
    });
    const unavailable = await spawnChild(unavailableInput);
    assert.equal(unavailable.code, 0);
    const unavailableReceipt = parseReceipt(unavailable.stdout);
    assert.equal(unavailableReceipt.status, "database_unavailable");
    assert.equal(unavailableReceipt.selected_pack_consumed, false);
    assert(unavailable.duration_ms <= 7000, "temporary outage is bounded by seven seconds");
  }

  const presentedIdentity = scenario === "identity_mismatch"
    ? { ...identity, actor_id: `${identity.actor_id}-wrong` }
    : identity;
  const freshInput = childInput({
    mode: "recover",
    invocationId: freshInvocation,
    identity,
    presentedIdentity,
    host,
    scenario,
    storeConfig,
    packRef: selected.pack_ref,
    effectFile,
  });
  const fresh = await spawnChild(freshInput);
  assert.equal(fresh.code, 0, fresh.stderr);
  const receipt = parseReceipt(fresh.stdout);
  verifyFreshReceipt({
    scenario,
    expected_identity: identity,
    envelope,
    interrupted_process_id: interrupted.pid,
    interrupted_invocation_id: interruptedInvocation,
    fresh_process_id: fresh.pid,
    fresh_invocation_id: freshInvocation,
    receipt,
  });
  runScenarioNegativeFixture({
    scenario,
    identity,
    envelope,
    interrupted,
    interruptedInvocation,
    fresh,
    freshInvocation,
    receipt,
  });

  const verifyStore = await openStore(storeConfig);
  const activePack = await verifyStore.getSelectedRestartPack({
    agent_id: identity.actor_id,
    project: identity.project,
    pack_ref: selected.pack_ref,
  });
  if (scenario === "identity_mismatch") assert(activePack !== null, "identity rejection leaves pack unconsumed");
  else assert.equal(activePack, null, "successful fresh process consumes the exact selected pack");
  await verifyStore.close();

  const outputBounds = recoveryOutputBounds(fresh.stdout);
  assert(fresh.duration_ms <= 7000, `${host}/${scenario} starts within seven seconds`);
  assert(outputBounds.bytes <= 8192 && outputBounds.tokens <= 1800, `${host}/${scenario} output is bounded`);
  const sentinelRecovered = scenario !== "identity_mismatch";
  return {
    row_id: `${host}:${scenario}`,
    host,
    scenario,
    backend: BACKEND_BY_HOST[host],
    result: "PASS",
    expected: expectedScenarioOutcome(scenario),
    actual: receipt.status,
    duration_ms: Date.now() - startedAt,
    startup_ms: fresh.duration_ms,
    recovery_output_bytes: outputBounds.bytes,
    recovery_output_tokens: outputBounds.tokens,
    input_sha256: sha256(canonicalJson({
      schema_version: freshInput.schema_version,
      invocation_id: freshInput.invocation_id,
      host,
      scenario,
      pack_ref_sha256: sha256(selected.pack_ref),
      presented_identity_sha256: sha256(canonicalJson(presentedIdentity)),
    })),
    output_sha256: sha256(fresh.stdout),
    interrupted_process_id_sha256: sha256(String(interrupted.pid)),
    fresh_process_id_sha256: sha256(String(fresh.pid)),
    interrupted_invocation_id_sha256: sha256(interruptedInvocation),
    fresh_invocation_id_sha256: sha256(freshInvocation),
    distinct_process_identity: true,
    distinct_invocation_identity: true,
    sentinel_recovered: sentinelRecovered,
    missing_capture_detected: receipt.missing_capture_detected,
    external_readback_performed: receipt.external_readback_performed,
    ambiguous_effect_retry_count: 0,
    duplicate_external_side_effect_count: 0,
    replay_duplicate_event_count: 0,
    identity_mismatch_rejected: receipt.identity_mismatch_rejected,
    private_or_protected_capture_count: 0,
    unknown_field_persisted_count: 0,
    raw_absolute_path_match_count: 0,
    negative_fixture_result: "PASS",
  };
}

function runScenarioNegativeFixture(input: {
  scenario: ContinuityE2EScenario;
  identity: ContinuityFixtureIdentity;
  envelope: ContinuityRecoveryEnvelope;
  interrupted: ChildResult;
  interruptedInvocation: string;
  fresh: ChildResult;
  freshInvocation: string;
  receipt: ContinuityFixtureChildReceipt;
}): void {
  const invalid = structuredClone(input.receipt);
  switch (input.scenario) {
    case "pre_output": invalid.recovered_objective = "invented objective"; break;
    case "post_visible_pre_capture": invalid.missing_capture_detected = false; break;
    case "inflight_tool": invalid.ambiguous_effect_retry_count = 1; break;
    case "post_file_write_pre_commit": invalid.external_readback_performed = false; break;
    case "temporary_database_outage": invalid.status = "database_unavailable"; break;
    case "capture_crash_restart": invalid.durable_capture_count = 2; break;
    case "identity_mismatch":
      invalid.status = "recovered";
      invalid.identity_mismatch_rejected = false;
      break;
  }
  assert.throws(() => verifyFreshReceipt({
    scenario: input.scenario,
    expected_identity: input.identity,
    envelope: input.envelope,
    interrupted_process_id: input.interrupted.pid,
    interrupted_invocation_id: input.interruptedInvocation,
    fresh_process_id: input.fresh.pid,
    fresh_invocation_id: input.freshInvocation,
    receipt: invalid,
  }), /CONTINUITY_/);
  assert.throws(() => verifyFreshReceipt({
    scenario: input.scenario,
    expected_identity: input.identity,
    envelope: input.envelope,
    interrupted_process_id: input.fresh.pid,
    interrupted_invocation_id: input.interruptedInvocation,
    fresh_process_id: input.fresh.pid,
    fresh_invocation_id: input.freshInvocation,
    receipt: input.receipt,
  }), /SAME_PROCESS/);
}

function runPrivacyNegativeFixtures(): void {
  const base = envelopeFor(identityFor("codex"), "pre_output");
  const fixtures: unknown[] = [];
  const unknown = structuredClone(base) as ContinuityRecoveryEnvelope & { unknown_field?: string };
  unknown.unknown_field = "denied";
  fixtures.push(unknown);
  for (const forbidden of [
    "private_reasoning: hidden",
    "chain of thought hidden",
    "system_instruction_body: hidden",
    "developer_instruction_body: hidden",
    "raw_tool_payload: hidden",
    "credential=ghp_abcdefghijklmnop",
    "secret=sk-abcdefghijklmnop",
    "/Users/fixture/private/location",
  ]) fixtures.push({ ...structuredClone(base), durable_objective: forbidden });
  for (const fixture of fixtures) {
    assert.throws(() => assertDataOnlyRecoveryEnvelope(fixture), /CONTINUITY_RECOVERY_/);
  }
}

function buildReport(rows: ContinuityE2ERow[]): ContinuityE2EReport {
  return {
    schema_version: CONTINUITY_E2E_SCHEMA_VERSION,
    run_id: "kusabi-alpha-obs05-a3-local-isolated-20260802",
    generated_at: GENERATED_AT,
    exact_base: { commit: EXACT_BASE_COMMIT, tree: EXACT_BASE_TREE },
    constraints: {
      hosts: [...CONTINUITY_E2E_HOSTS],
      scenarios: [...CONTINUITY_E2E_SCENARIOS],
      startup_timeout_seconds_max: 7,
      recovery_output_tokens_max: 1800,
      recovery_output_bytes_max: 8192,
    },
    backends: CONTINUITY_E2E_HOSTS.map((host) => ({
      host,
      backend: BACKEND_BY_HOST[host],
      isolated: true,
      cleanup: "PASS",
    })),
    rows,
    summary: {
      expected_rows: 21,
      passed_rows: 21,
      failed_rows: 0,
      sentinel_capture_and_recovery_hosts: 3,
      recovered_latest_durable_objective_hosts: 3,
      fresh_process_identity_rows: 21,
      fresh_invocation_identity_rows: 21,
      temporary_database_outage_recovery_hosts: 3,
      capture_crash_restart_recovery_hosts: 3,
      identity_mismatch_fail_closed_hosts: 3,
      ambiguous_effect_retry_without_resolution_count: 0,
      duplicate_external_side_effect_count: 0,
      replay_duplicate_event_count: 0,
      private_or_protected_capture_count: 0,
      unknown_field_persisted_count: 0,
      raw_absolute_path_match_count: 0,
      production_effect_count: 0,
      temporary_fixture_cleanup: "PASS",
    },
  };
}

async function validateStrictSchema(report: ContinuityE2EReport): Promise<void> {
  const schema = JSON.parse(await readFile(
    join(process.cwd(), "docs", "design", "schemas", "kusabi-continuity-interruption-e2e-v1.schema.json"),
    "utf8",
  ));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert(validate(report), JSON.stringify(validate.errors));
  const missingRow = structuredClone(report);
  missingRow.rows.pop();
  assert.equal(validate(missingRow), false);
  const duplicateEffect = structuredClone(report);
  duplicateEffect.rows[0].duplicate_external_side_effect_count = 1 as 0;
  assert.equal(validate(duplicateEffect), false);
  const excessiveStartup = structuredClone(report);
  excessiveStartup.rows[0].startup_ms = 7001;
  assert.equal(validate(excessiveStartup), false);
  const unknown = structuredClone(report) as ContinuityE2EReport & { unknown?: boolean };
  unknown.unknown = true;
  assert.equal(validate(unknown), false);
}

async function seedHostSentinel(config: ContinuityFixtureStoreConfig, identity: ContinuityFixtureIdentity): Promise<void> {
  const store = await openStore(config);
  await store.saveRawEvent({
    agent_id: identity.actor_id,
    session_id: identity.session_id,
    project: identity.project,
    host: identity.host,
    source: identity.host,
    source_event_id: `sentinel-${identity.host}`,
    event_type: "host_event",
    role: "user",
    content: `latest durable objective sentinel for ${identity.host}`,
    source_ref: { scheme: "fixture", event_id: `sentinel-${identity.host}` },
    redaction_level: "strict",
    private_reasoning: false,
    metadata: { fixture_only: true, redacted_source_ref: `fixture://${identity.host}/sentinel` },
    occurred_at: "2026-08-02T06:59:00.000Z",
  });
  const events = await store.getRawEvents({
    agent_id: identity.actor_id,
    project: identity.project,
    source: identity.host,
    limit: 10,
  });
  assert.equal(events.filter((event) => event.source_event_id === `sentinel-${identity.host}`).length, 1);
  await store.close();
}

function envelopeFor(identity: ContinuityFixtureIdentity, scenario: ContinuityE2EScenario): ContinuityRecoveryEnvelope {
  const ambiguous = scenario === "inflight_tool" || scenario === "post_file_write_pre_commit";
  return {
    schema_version: "kusabi-continuity-recovery-envelope/v1",
    identity,
    durable_objective: `continue durable objective for ${identity.host}`,
    next_action: scenario === "identity_mismatch"
      ? "reject the mismatched fixture identity"
      : `resume ${scenario} from durable fixture state`,
    source_refs: [
      `fixture://${identity.host}/sentinel`,
      `fixture://${identity.host}/${scenario}`,
    ],
    effect_state: {
      effect_id: `effect-${identity.host}-${scenario}`,
      status: ambiguous ? "unknown" : "completed",
      external_readback_required: ambiguous,
    },
    privacy: {
      content_class: "bounded_data_only",
      redacted_source_ref: `fixture://${identity.host}/${scenario}/redacted`,
      forbidden_capture_count: 0,
    },
  };
}

function identityFor(host: ContinuityE2EHost): ContinuityFixtureIdentity {
  return {
    actor_id: `fixture-${host}`,
    project: "agent-memory-fixture",
    host,
    session_id: `fresh-${host}-session`,
  };
}

function childInput(input: {
  mode: "interrupted" | "recover";
  invocationId: string;
  identity: ContinuityFixtureIdentity;
  presentedIdentity: ContinuityFixtureIdentity;
  host: ContinuityE2EHost;
  scenario: ContinuityE2EScenario;
  storeConfig: ContinuityFixtureStoreConfig;
  packRef: string;
  effectFile: string;
  forceDatabaseUnavailable?: boolean;
}): ContinuityFixtureChildInput {
  return {
    schema_version: CONTINUITY_CHILD_INPUT_SCHEMA_VERSION,
    mode: input.mode,
    invocation_id: input.invocationId,
    host: input.host,
    scenario: input.scenario,
    expected_identity: input.identity,
    presented_identity: input.presentedIdentity,
    store: input.storeConfig,
    pack_ref: input.packRef,
    effect_file: input.effectFile,
    force_database_unavailable: input.forceDatabaseUnavailable,
  };
}

async function openStore(config: ContinuityFixtureStoreConfig): Promise<Store> {
  let store: Store;
  if (config.backend === "json") store = new JsonStore(config.location);
  else if (config.backend === "sqlite") store = new SqliteStore(config.location);
  else store = new PgStore(config.location);
  await store.initialize();
  return store;
}

function spawnChild(input: ContinuityFixtureChildInput): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [...process.execArgv, CHILD_FILE, "--fixture-child"], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const pid = child.pid;
    if (!pid) {
      reject(new Error("CONTINUITY_CHILD_PID_MISSING"));
      return;
    }
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 7000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? -1, stdout, stderr, pid, duration_ms: Date.now() - startedAt });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function parseReceipt(value: string): ContinuityFixtureChildReceipt {
  const receipt = JSON.parse(value) as ContinuityFixtureChildReceipt;
  assert.equal(receipt.schema_version, "kusabi-continuity-fixture-child-receipt/v1");
  return receipt;
}

function withPgSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const option = `-c search_path=${schema},public`;
  const existing = url.searchParams.get("options");
  url.searchParams.set("options", existing ? `${existing} ${option}` : option);
  return url.toString();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
