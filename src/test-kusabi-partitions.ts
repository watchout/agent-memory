#!/usr/bin/env node
/**
 * CELL-4MCP-KUSABI-001 — fixtures for the agent memory partition lane.
 * Run: tsx src/test-kusabi-partitions.ts
 *
 * Coverage (required evidence per dispatch anchor #247):
 *   - standalone: partition CRUD + resolution works with ZERO peer MCPs,
 *     against both the OSS-default SqliteStore and the JsonStore.
 *   - negative: partition inference from shared identity metadata FAILS
 *     CLOSED — the resolver ignores identity_metadata and, absent an
 *     own-table row, returns the most restrictive visibility.
 *
 * Isolation: HOME is redirected to a temp dir BEFORE the stores are
 * imported (JsonStore fixes its data dir from homedir() at import time),
 * and SqliteStore uses an explicit temp db path.
 */
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP_HOME = mkdtempSync(join(tmpdir(), "kusabi-partitions-home-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;

const TEST_DB_PATH = join(tmpdir(), `kusabi-partitions-sqlite-${process.pid}.db`);

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

async function run() {
  console.log("agent-memory Kusabi partition lane test suite (CELL-4MCP-KUSABI-001)\n");

  // Dynamic import AFTER HOME is redirected so JsonStore's data dir lands
  // in the sandbox, not the real ~/.agent-memory.
  const { SqliteStore } = await import("./stores/sqlite-store.js");
  const { JsonStore } = await import("./stores/json-store.js");
  const { resolvePartition, FAIL_CLOSED_VISIBILITY } = await import(
    "./kusabi-partitions.js"
  );
  const { createStore } = await import("./stores/index.js");
  type Store = import("./stores/types.js").Store;

  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);

  // Shared identity metadata that a peer MCP might hold. The resolver must
  // NEVER read this — it is the bait for the negative fixture.
  const IDENTITY_METADATA_BAIT = {
    partition_key: "identity-inferred-partition",
    default_visibility: "shared",
    tenant: "peer-mcp-tenant",
  };

  async function testStandalone(store: Store, label: string) {
    console.log(`\n── Standalone (zero peer MCPs): ${label} ──`);
    const AGENT = `kusabi-standalone-${label}`;
    const PROJECT = "agent-memory";

    // No row yet → fail-closed.
    const before = await store.getKusabiPartition({
      agent_id: AGENT,
      memory_project: PROJECT,
    });
    assert(before === null, "no own-table row before upsert");

    const created = await store.upsertKusabiPartition({
      agent_id: AGENT,
      memory_project: PROJECT,
      partition_key: "am-core",
      default_visibility: "shared",
      retention_policy_ref: "retention/default",
      recovery_config_ref: "recovery/default",
      source_capture_policy_ref: "capture/default",
    });
    assert(created.agent_id === AGENT, "upsert returns the agent_id (identity key)");
    assert(created.partition_key === "am-core", "partition_key persisted");
    assert(created.default_visibility === "shared", "explicit shared visibility persisted");
    assert(!!created.updated_at, "updated_at stamped");

    const fetched = await store.getKusabiPartition({
      agent_id: AGENT,
      memory_project: PROJECT,
    });
    assert(fetched?.partition_key === "am-core", "getKusabiPartition round-trips the row");
    assert(
      fetched?.retention_policy_ref === "retention/default" &&
        fetched?.recovery_config_ref === "recovery/default" &&
        fetched?.source_capture_policy_ref === "capture/default",
      "all policy refs round-trip"
    );

    // Upsert is idempotent on (agent_id, memory_project) — updates, no dup.
    const updated = await store.upsertKusabiPartition({
      agent_id: AGENT,
      memory_project: PROJECT,
      partition_key: "am-core-v2",
      default_visibility: "private",
    });
    assert(updated.partition_key === "am-core-v2", "upsert updates existing row");
    assert(updated.default_visibility === "private", "visibility updated to private");
    const list = await store.listKusabiPartitions(AGENT);
    assert(list.length === 1, "upsert is keyed on (agent_id, memory_project) — no duplicate row");

    // Resolver reads from the own table.
    const resolved = await resolvePartition(store, {
      agent_id: AGENT,
      memory_project: PROJECT,
    });
    assert(resolved.resolved === true, "resolver resolves from own table");
    assert(resolved.source === "own_table", "resolution provenance = own_table");
    assert(resolved.partition_key === "am-core-v2", "resolver returns own-table partition_key");
    assert(resolved.visibility === "private", "resolver returns own-table visibility");
  }

  async function testNegative(store: Store, label: string) {
    console.log(`\n── Negative (identity-metadata inference fails closed): ${label} ──`);
    const AGENT = `kusabi-negative-${label}`;
    const PROJECT = "agent-memory";

    // NO own-table row exists for this agent. Pass the identity-metadata
    // bait that "says" partition=identity-inferred-partition / shared.
    const resolved = await resolvePartition(store, {
      agent_id: AGENT,
      memory_project: PROJECT,
      identity_metadata: IDENTITY_METADATA_BAIT,
    });
    assert(resolved.resolved === false, "no own-table row → not resolved");
    assert(resolved.source === "fail_closed", "provenance = fail_closed (not identity metadata)");
    assert(
      resolved.visibility === FAIL_CLOSED_VISIBILITY && resolved.visibility === "private",
      "fails closed to most-restrictive visibility (private), NOT the metadata's 'shared'"
    );
    assert(
      resolved.partition_key === null,
      "partition_key is NOT inferred from identity metadata"
    );
    assert(
      resolved.partition_key !== IDENTITY_METADATA_BAIT.partition_key,
      "resolver did not adopt the identity-metadata partition_key"
    );

    // Even WITH an own-table row, identity metadata must not override it.
    await store.upsertKusabiPartition({
      agent_id: AGENT,
      memory_project: PROJECT,
      partition_key: "own-table-partition",
      default_visibility: "private",
    });
    const resolvedWithRow = await resolvePartition(store, {
      agent_id: AGENT,
      memory_project: PROJECT,
      identity_metadata: IDENTITY_METADATA_BAIT,
    });
    assert(
      resolvedWithRow.partition_key === "own-table-partition",
      "own-table value wins over conflicting identity metadata"
    );
    assert(
      resolvedWithRow.visibility === "private",
      "own-table visibility wins; identity metadata's 'shared' is ignored"
    );
  }

  const sqlite = new SqliteStore(TEST_DB_PATH);
  await sqlite.initialize();
  const json = new JsonStore();
  await json.initialize();

  try {
    await testStandalone(sqlite, "sqlite");
    await testStandalone(json, "json");
    await testNegative(sqlite, "sqlite");
    await testNegative(json, "json");

    // The OSS default backend (SqliteStore) must satisfy the lane with no
    // peer MCP configured — createStore() with a clean env.
    console.log("\n── Standalone default backend (createStore, zero peers) ──");
    delete process.env.AGENT_MEMORY_DB_TYPE;
    delete process.env.AGENT_MEMORY_DATABASE_URL;
    delete process.env.DATABASE_URL;
    process.env.AGENT_MEMORY_DB_PATH = TEST_DB_PATH;
    const def = await createStore();
    const defResolved = await resolvePartition(def, {
      agent_id: "kusabi-standalone-sqlite",
      memory_project: "agent-memory",
    });
    assert(defResolved.resolved === true, "default backend resolves an existing own-table row");
    await def.close();
  } finally {
    await sqlite.close();
    await json.close();
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
    rmSync(TMP_HOME, { recursive: true, force: true });
  }

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
