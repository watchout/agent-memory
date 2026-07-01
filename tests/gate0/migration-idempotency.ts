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
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import initSqlJs from "sql.js";

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

    // ── Test 5: legacy event tables migrate before current indexes reference new columns ──
    const legacyPath = join(tmpDir, "legacy-events.db");
    const SQL = await initSqlJs();
    const legacyDb = new SQL.Database();
    legacyDb.run(`
      CREATE TABLE conversation_events (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        project TEXT,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    legacyDb.run(
      `INSERT INTO conversation_events
        (id, agent_id, project, source, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        "legacy-conversation-1",
        AGENT,
        PROJECT,
        "manual",
        "legacy conversation content",
        "2026-06-01T00:00:00.000Z",
      ]
    );
    legacyDb.run(`
      CREATE TABLE raw_events (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        project TEXT,
        session_id TEXT,
        host TEXT NOT NULL,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        role TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        source_ref_hash TEXT NOT NULL,
        event_at TEXT NOT NULL,
        ingested_at TEXT NOT NULL,
        content_text TEXT,
        content_json TEXT,
        redaction_level TEXT NOT NULL,
        private_reasoning INTEGER NOT NULL DEFAULT 0
      )
    `);
    legacyDb.run(
      `INSERT INTO raw_events
        (id, agent_id, project, session_id, host, source, event_type, role,
         source_ref, source_ref_hash, event_at, ingested_at, content_text,
         content_json, redaction_level, private_reasoning)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "legacy-raw-1",
        AGENT,
        PROJECT,
        "legacy-session",
        "codex",
        "manual",
        "host_event",
        "event",
        "{}",
        "legacy-source-ref-hash",
        "2026-06-01T00:00:00.000Z",
        "2026-06-01T00:00:01.000Z",
        "legacy raw content",
        null,
        "basic",
        0,
      ]
    );
    writeFileSync(legacyPath, Buffer.from(legacyDb.export()));
    legacyDb.close();

    const legacyStore = new SqliteStore(legacyPath);
    await legacyStore.initialize();

    const legacyConversations = await legacyStore.getConversationEvents({
      agent_id: AGENT,
      project: PROJECT,
      source: "manual",
      limit: 10,
    });
    assert(
      legacyConversations.some((event) => event.id === "legacy-conversation-1"),
      "legacy conversation event remains readable after compatibility migration"
    );

    const newRawEvent = await legacyStore.saveRawEvent({
      agent_id: AGENT,
      project: PROJECT,
      host: "codex",
      source: "manual",
      event_type: "host_event",
      content: "new raw event after compatibility migration",
      source_event_id: "gate0-legacy-raw-source-event",
      metadata: { gate0: true },
    });
    assert(
      newRawEvent.source_event_id === "gate0-legacy-raw-source-event",
      "legacy raw_events table accepts current source_event_id writes"
    );

    const newConversation = await legacyStore.saveConversationEvent({
      agent_id: AGENT,
      project: PROJECT,
      source: "manual",
      source_event_id: "gate0-legacy-conversation-source-event",
      role: "user",
      content: "new conversation event after compatibility migration",
      metadata: { gate0: true },
    });
    assert(
      newConversation.source_event_id === "gate0-legacy-conversation-source-event",
      "legacy conversation_events table accepts current source_event_id writes"
    );

    const legacyRawEvents = await legacyStore.getRawEvents({
      agent_id: AGENT,
      project: PROJECT,
      source: "manual",
      limit: 10,
    });
    assert(
      legacyRawEvents.some((event) => event.id === "legacy-raw-1"),
      "legacy raw event remains readable after compatibility migration"
    );
    assert(
      legacyRawEvents.some((event) => event.id === newRawEvent.id),
      "new raw event remains readable after compatibility migration"
    );

    let legacyReinitError: unknown = null;
    try {
      await legacyStore.initialize();
    } catch (err) {
      legacyReinitError = err;
    }
    assert(legacyReinitError === null, "legacy event DB initialize() remains idempotent");

    await legacyStore.close();
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
