#!/usr/bin/env node
/**
 * Gate 0 test: SqliteStore.initialize() is idempotent.
 *
 * Verifies that calling initialize() multiple times on the same DB path
 * does not throw, does not corrupt existing data, and that all expected
 * tables are present after initialization.
 *
 * Run: HOME=$(mktemp -d) npx tsx tests/gate0/migration-idempotency.ts
 */
import { SqliteStore } from "../../src/stores/sqlite-store.js";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗  ${msg}`);
    failed++;
  }
}

const AGENT = "gate0-migration-test";
const PROJECT = "gate0";

async function runTests(): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), "gate0-migration-"));
  const dbPath = join(tmpDir, "test.db");

  try {
    console.log("\n── Gate 0: migration-idempotency ──");

    // ── Test 1: DB file is created after first initialize() ──
    const store = new SqliteStore(dbPath);
    await store.initialize();
    assert(existsSync(dbPath), "DB file exists after initialize()");

    // ── Test 2: Seed data survives a second initialize() ──
    const d1 = await store.logDecision({
      agent_id: AGENT,
      project: PROJECT,
      decision: "Use idempotent migrations",
      context: "Ensures safe re-initialization",
      tags: ["migration"],
    });
    assert(d1.id.length > 0, "logDecision succeeds before second initialize()");

    // Second call must not throw (CREATE TABLE IF NOT EXISTS is safe)
    let initError: unknown = null;
    try {
      await store.initialize();
    } catch (err) {
      initError = err;
    }
    assert(initError === null, "second initialize() does not throw");

    // ── Test 3: Seeded data is still present after second initialize() ──
    const decisions = await store.getDecisions({ agent_id: AGENT, project: PROJECT });
    assert(decisions.length === 1, "seeded decision still present after second initialize()");
    assert(decisions[0].id === d1.id, "seeded decision id matches after second initialize()");

    // ── Test 4: Core tables are accessible (decisions, task_states, knowledge, raw_events) ──
    const tableChecks: Array<{ name: string; probe: () => Promise<unknown> }> = [
      {
        name: "decisions",
        probe: () => store.getDecisions({ agent_id: AGENT }),
      },
      {
        name: "task_states",
        probe: () => store.getTaskStates({ agent_id: AGENT }),
      },
      {
        name: "knowledge",
        probe: () => store.getKnowledge({ agent_id: AGENT }),
      },
      {
        name: "raw_events",
        probe: () => store.getRawEvents({ agent_id: AGENT }),
      },
    ];

    for (const { name, probe } of tableChecks) {
      let tableError: unknown = null;
      try {
        await probe();
      } catch (err) {
        tableError = err;
      }
      assert(tableError === null, `table '${name}' is accessible after initialization`);
    }

    await store.close();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

runTests()
  .then(() => {
    console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
  });
