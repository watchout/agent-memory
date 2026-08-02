import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import pg from "pg";
import { JsonStore } from "./stores/json-store.js";
import { SqliteStore } from "./stores/sqlite-store.js";
import { PgStore } from "./stores/pg-store.js";
import type { Store } from "./stores/types.js";
import {
  kusabiFleetManifestSha256,
  kusabiFleetTargetKey,
  type KusabiFleetManifest,
} from "./kusabi-fleet-status.js";
import {
  assertNotMutableWorkspaceDist,
  authoritativeManifestBindingKeys,
  normalizedRawCaptureEvidenceSha256,
  reconcileRawCaptureRegistry,
  runRawCaptureService,
  type InstalledCaptureRegistryRow,
  type RawCaptureRuntimeCandidate,
  type RawCaptureServiceReport,
} from "./raw-capture-service.js";

const FIXED_AT = "2026-08-02T01:00:00.000Z";
const SINCE = "2026-08-01T00:00:00.000Z";
const AGENT_ID = "capture-agent-00";

async function main(): Promise<void> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "kusabi-capture-service-fixtures-"));
  const storageRoot = await mkdtemp(join(tmpdir(), "kusabi-capture-service-stores-"));
  let pgStore: PgStore | undefined;
  let pgAdmin: pg.Pool | undefined;
  let pgSchema: string | undefined;
  try {
    const roots = await createSourceFixtures(fixtureRoot);
    const manifest = buildManifest();
    const bindingKeys = authoritativeManifestBindingKeys(manifest);
    const registryRows = buildRegistryRows(bindingKeys);
    const reconciliation = reconcileRawCaptureRegistry(manifest, registryRows);
    assert.equal(reconciliation.authoritative_target_count, 35);
    assert.equal(reconciliation.unique_authoritative_binding_key_count, 35);
    assert.equal(reconciliation.reconciled_target_count, 35);
    assert.equal(reconciliation.installed_registry_observation_count, 47);
    assert.equal(reconciliation.unmatched_registry_row_count, 24);
    assert.equal(reconciliation.unmatched_registry_row_unique_count, 24);
    assert.equal(reconciliation.missing_manifest_binding_count, 11);
    assert.equal(reconciliation.missing_manifest_binding_unique_count, 11);
    assert.equal(reconciliation.arithmetic_net_difference, 12);
    assert.equal(reconciliation.arithmetic_net_difference_is_enumerable_row_set, false);
    assert.notDeepEqual(
      reconciliation.unmatched_registry_row_sha256.slice(0, 12),
      reconciliation.missing_manifest_binding_keys,
      "net 12 is arithmetic only and is never materialized as a registry-row set",
    );

    const runtimeCandidate: RawCaptureRuntimeCandidate = {
      commit: "1".repeat(40),
      tree: "2".repeat(40),
      built_artifact_sha256: h("raw-capture-artifact"),
      build_command: "npm run build",
      artifact_path_relative_to_repository: "artifacts/kusabi/raw-capture-service.js",
      runtime_source_kind: "immutable_release_artifact",
    };

    const jsonStore = new JsonStore(join(storageRoot, "json"));
    await jsonStore.initialize();
    const sqliteStore = new SqliteStore(join(storageRoot, "sqlite", "memory.db"));
    await sqliteStore.initialize();
    const reports: RawCaptureServiceReport[] = [];
    try {
      reports.push(await exerciseBackend(jsonStore, manifest, registryRows, roots, runtimeCandidate));
      reports.push(await exerciseBackend(sqliteStore, manifest, registryRows, roots, runtimeCandidate));
    } finally {
      await jsonStore.close();
      await sqliteStore.close();
    }

    const pgUrl = process.env.AGENT_MEMORY_DATABASE_URL
      ?? process.env.DATABASE_URL
      ?? "postgresql:///agent_comms?host=/tmp";
    pgSchema = `obs05_capture_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    pgAdmin = new pg.Pool({ connectionString: pgUrl });
    await pgAdmin.query(`CREATE SCHEMA ${pgSchema}`);
    pgStore = new PgStore(withPgSearchPath(pgUrl, pgSchema));
    await pgStore.initialize();
    reports.push(await exerciseBackend(pgStore, manifest, registryRows, roots, runtimeCandidate));

    assert.equal(reports.length, 3);
    const parityDigests = reports.map(normalizedRawCaptureEvidenceSha256);
    assert.equal(new Set(parityDigests).size, 1, "JSON/SQLite/PostgreSQL normalized parity is 1.0");

    const schemaRaw = JSON.parse(await readFile(
      join(process.cwd(), "docs", "design", "schemas", "kusabi-raw-capture-service-v1.schema.json"),
      "utf8",
    ));
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(schemaRaw);
    for (const report of reports) assert(validate(report), JSON.stringify(validate.errors));
    const missingCapability = structuredClone(reports[0]) as Record<string, unknown>;
    delete missingCapability.store_capability;
    assert.equal(validate(missingCapability), false);
    const wrongNet = structuredClone(reports[0]);
    wrongNet.reconciliation.arithmetic_net_difference = 24;
    assert.equal(validate(wrongNet), false);
    const enumerableNet = structuredClone(reports[0]);
    (enumerableNet.reconciliation as RawCaptureServiceReport["reconciliation"] & { net_rows?: string[] }).net_rows = [];
    assert.equal(validate(enumerableNet), false);

    assert.throws(
      () => reconcileRawCaptureRegistry(manifest, registryRows.slice(0, 46)),
      /INSTALLED_REGISTRY_COUNT_MISMATCH/,
    );
    const duplicateRegistryHash = structuredClone(registryRows);
    duplicateRegistryHash[1].registry_row_sha256 = duplicateRegistryHash[0].registry_row_sha256;
    assert.throws(
      () => reconcileRawCaptureRegistry(manifest, duplicateRegistryHash),
      /HASH_INVALID_OR_DUPLICATE/,
    );
    assert.throws(
      () => authoritativeManifestBindingKeys({ ...manifest, targets: manifest.targets.slice(0, 34) }),
      /MANIFEST_(?:INVALID|HASH_MISMATCH)|TARGET_COUNT_MISMATCH/,
    );
    assert.throws(
      () => assertNotMutableWorkspaceDist(
        join(process.cwd(), "dist", "raw-capture-service.js"),
        process.cwd(),
      ),
      /MUTABLE_WORKSPACE_DIST_FORBIDDEN/,
    );
    assert.doesNotThrow(() => assertNotMutableWorkspaceDist(
      join(storageRoot, "immutable", h("release"), "raw-capture-service.js"),
      process.cwd(),
    ));

    const productionSource = await readFile(join(process.cwd(), "src", "raw-capture-service.ts"), "utf8");
    assert.equal(/\.recordRawEvent\s*\(/.test(productionSource), false, "obsolete recordRawEvent ABI is absent");
    assert(/\.saveRawEvent\s*\(/.test(await readFile(
      join(process.cwd(), "src", "gemini-conversation-ingest.ts"), "utf8",
    )), "canonical saveRawEvent ABI is invoked");
    console.log(`Raw capture service tests passed; normalized parity sha256=${parityDigests[0]}`);
  } finally {
    if (pgStore) await pgStore.close();
    if (pgAdmin && pgSchema) {
      await pgAdmin.query(`DROP SCHEMA IF EXISTS ${pgSchema} CASCADE`);
      await pgAdmin.end();
    }
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(storageRoot, { recursive: true, force: true });
  }
}

async function exerciseBackend(
  store: Store,
  manifest: KusabiFleetManifest,
  registryRows: InstalledCaptureRegistryRow[],
  roots: Record<"codex" | "claude_code" | "gemini_cli", string>,
  runtimeCandidate: RawCaptureRuntimeCandidate,
): Promise<RawCaptureServiceReport> {
  const input = {
    store,
    manifest,
    target_key: manifest.targets[0].target_key,
    registry_rows: registryRows,
    source_roots: roots,
    runtime_candidate: runtimeCandidate,
    sources: ["codex", "claude_code", "gemini_cli"] as const,
    since: SINCE,
    run_id: "raw-capture-parity-run",
    generated_at: FIXED_AT,
  };
  const first = await runRawCaptureService(input);
  assert.deepEqual(first.source_results.map((source) => source.events_saved), [1, 1, 1]);
  assert(first.source_results.every((source) => source.coverage_status === "clean"));
  const raw = await store.getRawEvents({ agent_id: AGENT_ID, limit: 100 });
  const native = raw.filter((event) => ["codex", "claude_code", "gemini_cli"].includes(event.source));
  assert.equal(native.length, 3, `${store.backend} save/readback returns three native events`);
  assert(native.every((event) => event.private_reasoning === false));
  const second = await runRawCaptureService(input);
  assert.deepEqual(second.source_results.map((source) => source.events_saved), [0, 0, 0]);
  assert.deepEqual(second.source_results.map((source) => source.events_duplicate), [1, 1, 1]);
  const replay = await store.getRawEvents({ agent_id: AGENT_ID, limit: 100 });
  assert.equal(
    replay.filter((event) => ["codex", "claude_code", "gemini_cli"].includes(event.source)).length,
    3,
    `${store.backend} duplicate source refs create no duplicate native event`,
  );
  return first;
}

async function createSourceFixtures(root: string): Promise<Record<"codex" | "claude_code" | "gemini_cli", string>> {
  const codex = join(root, "codex");
  const claude = join(root, "claude");
  const gemini = join(root, "gemini");
  await Promise.all([mkdir(codex, { recursive: true }), mkdir(claude, { recursive: true }), mkdir(gemini, { recursive: true })]);
  await writeFile(join(codex, "session-codex.jsonl"), `${JSON.stringify({
    timestamp: "2026-08-02T00:01:00.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Codex parity fixture" }],
    },
  })}\n`);
  await writeFile(join(claude, "session-claude.jsonl"), `${JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-02T00:02:00.000Z",
    sessionId: "session-claude",
    message: { content: [{ type: "text", text: "Claude parity fixture" }] },
  })}\n`);
  await writeFile(join(gemini, "session-gemini.json"), JSON.stringify({
    kind: "chat",
    lastUpdated: "2026-08-02T00:03:00.000Z",
    messages: [{
      content: "Gemini parity fixture",
      id: "gemini-parity-1",
      timestamp: "2026-08-02T00:03:00.000Z",
      type: "gemini",
    }],
    sessionId: "session-gemini",
    startTime: "2026-08-02T00:03:00.000Z",
  }));
  return { codex, claude_code: claude, gemini_cli: gemini };
}

function buildManifest(): KusabiFleetManifest {
  const hosts = ["codex", "claude_code", "gemini_cli"] as const;
  const targets = Array.from({ length: 35 }, (_, index) => {
    const identity = {
      agent_id: `capture-agent-${String(index).padStart(2, "0")}`,
      project: `capture-project-${String(index).padStart(2, "0")}`,
      host_runtime: hosts[index % hosts.length],
      workspace_sha256: h(`workspace-${index}`),
    };
    return {
      target_key: kusabiFleetTargetKey(identity),
      identity,
      expected: {
        build: {
          commit_sha: "1".repeat(40),
          tree_sha: "2".repeat(40),
          artifact_sha256: h(`artifact-${index}`),
          adapter_version: "1.0.0",
        },
        configuration: {
          config_sha256: h(`config-${index}`),
          trust_fingerprint_sha256: h(`trust-${index}`),
          binding_source_ref_sha256: h(`binding-source-${index}`),
        },
        storage: {
          backend: "postgres" as const,
          binding_sha256: h(`storage-${index}`),
        },
      },
      activation_at: "2026-08-02T00:00:00.000Z",
      durable_evidence_deadline_at: "2026-08-02T02:00:00.000Z",
      stale_after_seconds: 600,
      maintenance_windows: [],
    };
  });
  const manifest: KusabiFleetManifest = {
    schema_version: "kusabi-fleet-manifest/v1",
    manifest_id: "kusabi-capture-fixture-v1",
    version: 1,
    manifest_sha256: "0".repeat(64),
    targets,
  };
  manifest.manifest_sha256 = kusabiFleetManifestSha256(manifest);
  return manifest;
}

function buildRegistryRows(bindingKeys: string[]): InstalledCaptureRegistryRow[] {
  const rows: InstalledCaptureRegistryRow[] = [];
  rows.push({ registry_row_sha256: h("registry-row-0"), matched_manifest_binding_keys: bindingKeys.slice(0, 2) });
  for (let index = 1; index < 23; index++) {
    rows.push({
      registry_row_sha256: h(`registry-row-${index}`),
      matched_manifest_binding_keys: [bindingKeys[index + 1]],
    });
  }
  for (let index = 23; index < 47; index++) {
    rows.push({ registry_row_sha256: h(`registry-row-${index}`), matched_manifest_binding_keys: [] });
  }
  return rows;
}

function withPgSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const option = `-c search_path=${schema},public`;
  const existing = url.searchParams.get("options");
  url.searchParams.set("options", existing ? `${existing} ${option}` : option);
  return url.toString();
}

function h(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
