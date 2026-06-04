#!/usr/bin/env node
/**
 * Integration tests for agent-memory PgStore.
 * Requires: DATABASE_URL=postgresql://localhost/agent_comms
 * Run: DATABASE_URL=postgresql://localhost/agent_comms tsx src/test-pg.ts
 *
 * Uses transaction rollback for test isolation — no persistent side effects.
 */
import { readFileSync } from "fs";
import { PgStore } from "./stores/pg-store.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set. Skipping PgStore tests.");
  console.error("Usage: DATABASE_URL=postgresql://localhost/agent_comms tsx src/test-pg.ts");
  process.exit(0);
}

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

// Use a unique agent_id per test run to avoid collisions
const AGENT = `test-pg-${Date.now()}`;
const PROJECT = "test-project";

let store: PgStore;

async function setup() {
  store = new PgStore(DATABASE_URL!);
  await store.initialize();
}

async function testMigration() {
  console.log("\n── Migration & Connection Tests ──");
  // initialize() runs migrations; if we get here, it succeeded
  assert(true, "PgStore connects and runs migrations");

  // Run initialize again — should be idempotent
  await store.initialize();
  assert(true, "migrations are idempotent (IF NOT EXISTS)");
}

function withPgSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const option = `-c search_path=${schema},public`;
  const existing = url.searchParams.get("options");
  url.searchParams.set("options", existing ? `${existing} ${option}` : option);
  return url.toString();
}

function testKnowledgeSupersedeUpdateSqlGuard() {
  console.log("\n── PgStore knowledge supersede SQL guard ──");
  const pgStoreSource = readFileSync("src/stores/pg-store.ts", "utf8").replace(/\s+/g, " ");
  assert(
    pgStoreSource.includes(
      "UPDATE knowledge SET status = 'superseded', updated_at = now() WHERE id = $1 AND agent_id = $2 RETURNING *",
    ),
    "supersedeKnowledge UPDATE keeps id + agent_id guard",
  );
  assert(
    !pgStoreSource.includes(
      "UPDATE knowledge SET status = 'superseded', updated_at = now() WHERE id = $1 RETURNING *",
    ),
    "supersedeKnowledge UPDATE does not regress to id-only guard",
  );
}

async function testRawEventsLegacyOccurredAtMigration() {
  console.log("\n── PgStore raw_events legacy occurred_at migration ──");

  const pg = await import("pg");
  const schema = `am124_legacy_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const legacyId = "00000000-0000-4000-8000-000000000124";
  const duplicateLegacyId = "00000000-0000-4000-8000-000000001124";
  const admin = new pg.default.Pool({ connectionString: DATABASE_URL! });

  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(
      `CREATE TABLE ${schema}.raw_events (
        id UUID PRIMARY KEY,
        agent_id TEXT NOT NULL,
        source TEXT NOT NULL,
        event_type TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        event_at TIMESTAMPTZ,
        ingested_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ
      )`,
    );
    await admin.query(
      `INSERT INTO ${schema}.raw_events
         (id, agent_id, source, event_type, content_hash, event_at, ingested_at, created_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, NULL, NULL),
         ($7, $2, $3, $4, $5, $6, NULL, NULL)`,
      [
        legacyId,
        `${AGENT}-legacy-raw`,
        "legacy",
        "host_event",
        "legacy-hash",
        "2026-05-19T00:04:00.000Z",
        duplicateLegacyId,
      ],
    );

    const legacyStore = new PgStore(withPgSearchPath(DATABASE_URL!, schema));
    try {
      await legacyStore.initialize();
    } finally {
      await legacyStore.close();
    }

    const row = await admin.query(
      `SELECT occurred_at, source_event_id
         FROM ${schema}.raw_events
        WHERE id IN ($1, $2)
        ORDER BY id`,
      [legacyId, duplicateLegacyId],
    );
    assert(
      row.rows.length === 2 &&
        row.rows.every(
          (record) =>
            record.occurred_at instanceof Date &&
            record.occurred_at.toISOString() === "2026-05-19T00:04:00.000Z",
        ),
      "raw_events legacy rows backfill occurred_at from event_at",
    );
    assert(
      row.rows.every((record) =>
        String(record.source_event_id).startsWith("legacy-raw-event:"),
      ),
      "raw_events legacy duplicate hash/time rows get synthesized source_event_id",
    );

    const column = await admin.query(
      `SELECT is_nullable
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'raw_events'
          AND column_name = 'occurred_at'`,
      [schema],
    );
    assert(
      column.rows[0]?.is_nullable === "NO",
      "raw_events occurred_at is enforced NOT NULL after migration",
    );
    const contentHashColumn = await admin.query(
      `SELECT is_nullable
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'raw_events'
          AND column_name = 'content_hash'`,
      [schema],
    );
    assert(
      contentHashColumn.rows[0]?.is_nullable === "YES",
      "raw_events content_hash is nullable for source_ref-only events after migration",
    );
  } finally {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}

async function testMigrationRerunSafetyInIsolatedSchema() {
  console.log("\n── PgStore isolated schema migration rerun safety ──");

  const pg = await import("pg");
  const schema = `am076_rerun_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const admin = new pg.default.Pool({ connectionString: DATABASE_URL! });

  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const isolatedStore = new PgStore(withPgSearchPath(DATABASE_URL!, schema));
    try {
      await isolatedStore.initialize();
      await isolatedStore.initialize();
      assert(true, "isolated schema migrations can run twice");
    } finally {
      await isolatedStore.close();
    }

    const tables = await admin.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name = ANY($2::text[])
        ORDER BY table_name`,
      [
        schema,
        [
          "conversation_events",
          "decisions",
          "knowledge",
          "raw_events",
          "recovery_config",
          "recovery_quality_log",
          "selected_restart_packs",
          "task_states",
        ],
      ],
    );
    assert(tables.rows.length === 8, "isolated migration creates the expected PG tables");

    const rawOccurredAt = await admin.query(
      `SELECT is_nullable
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'raw_events'
          AND column_name = 'occurred_at'`,
      [schema],
    );
    assert(
      rawOccurredAt.rows[0]?.is_nullable === "NO",
      "isolated migration rerun preserves raw_events occurred_at NOT NULL",
    );

    const indexes = await admin.query(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = $1
          AND indexname = ANY($2::text[])`,
      [
        schema,
        [
          "uq_task_states_agent_task_id",
          "uq_raw_events_source_event",
          "uq_raw_events_hash_time",
          "idx_selected_restart_packs_agent",
        ],
      ],
    );
    assert(indexes.rows.length === 4, "isolated migration rerun keeps required indexes present");
  } finally {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}

async function testDecisionCRUD() {
  console.log("\n── PgStore Decision CRUD ──");

  // Log a decision
  const d1 = await store.logDecision({
    agent_id: AGENT,
    decision: "Use JWT with 7-day refresh token",
    context: "Considered session cookies vs JWT. JWT chosen for API-first design.",
    tags: ["auth", "architecture"],
    project: PROJECT,
  });
  assert(d1.id.length > 0, "logDecision returns valid UUID");
  assert(d1.status === "active", "new decision status is active");
  assert(d1.tags.length === 2, "tags preserved");
  assert(d1.agent_id === AGENT, "agent_id preserved");

  // Log another
  const d2 = await store.logDecision({
    agent_id: AGENT,
    decision: "PostgreSQL as primary database",
    context: "SQLite ruled out for multi-agent access.",
    tags: ["database", "architecture"],
    project: PROJECT,
  });

  // Get decisions
  const active = await store.getDecisions({
    agent_id: AGENT,
    project: PROJECT,
  });
  assert(active.length === 2, "getDecisions returns 2 active decisions");
  assert(active[0].created_at >= active[1].created_at, "sorted by newest first");

  // Filter by tags
  const authOnly = await store.getDecisions({
    agent_id: AGENT,
    tags: ["auth"],
  });
  assert(authOnly.length === 1, "tag filter works");
  assert(authOnly[0].decision.includes("JWT"), "correct decision returned by tag");

  // Get all statuses
  const all = await store.getDecisions({
    agent_id: AGENT,
    status: "all",
  });
  assert(all.length === 2, "status=all returns all");
}

async function testSupersede() {
  console.log("\n── PgStore Supersede Decision ──");

  const d1 = await store.logDecision({
    agent_id: AGENT,
    decision: "Use REST API",
    context: "Initial choice",
    tags: ["api"],
    project: PROJECT,
  });

  const result = await store.supersedeDecision({
    agent_id: AGENT,
    old_decision_id: d1.id,
    new_decision: "Use GraphQL instead of REST",
    context: "REST too verbose for nested data",
    tags: ["api", "graphql"],
  });

  assert(result.old.status === "superseded", "old decision marked superseded");
  assert(result.old.superseded_by === result.new.id, "superseded_by linked correctly");
  assert(result.new.status === "active", "new decision is active");

  // Verify superseded not in active list
  const active = await store.getDecisions({
    agent_id: AGENT,
    tags: ["api"],
    status: "active",
  });
  assert(!active.find((d) => d.id === d1.id), "superseded decision excluded from active");
  assert(active.find((d) => d.id === result.new.id) !== undefined, "new decision in active list");

  // Error: supersede non-existent
  try {
    await store.supersedeDecision({
      agent_id: AGENT,
      old_decision_id: "00000000-0000-0000-0000-000000000000",
      new_decision: "nope",
    });
    assert(false, "should throw for non-existent decision");
  } catch {
    assert(true, "throws for non-existent decision");
  }

  // Error: wrong agent
  const otherD = await store.logDecision({
    agent_id: `${AGENT}-other`,
    decision: "other agent decision",
  });
  try {
    await store.supersedeDecision({
      agent_id: AGENT,
      old_decision_id: otherD.id,
      new_decision: "hijack attempt",
    });
    assert(false, "should throw for wrong agent");
  } catch {
    assert(true, "agent isolation in supersede works");
  }
  // Cleanup other agent's decision
  await store.logDecision({ agent_id: `${AGENT}-other`, decision: "cleanup" });
}

async function testTaskStates() {
  console.log("\n── PgStore Task States ──");

  // AM-023: each save with the same task text and *no* explicit
  // task_id collapses onto the same row (UPSERT). Use distinct
  // task texts here to keep the legacy two-row expectations valid.
  const t1 = await store.saveTaskState({
    agent_id: AGENT,
    task: "Implement auth middleware",
    status: "in_progress",
    progress: "JWT verification done, RBAC pending",
    files_modified: ["src/middleware/auth.ts", "src/types.ts"],
    next_steps: "Add role-based access control",
    project: PROJECT,
  });
  assert(t1.id.length > 0, "saveTaskState returns valid UUID");
  assert(t1.status === "in_progress", "status preserved");
  assert(t1.files_modified.length === 2, "files_modified preserved");
  assert(t1.task_id !== undefined, "task_id auto-derived when not supplied");
  assert(t1.updated_at !== undefined, "updated_at populated");

  // Save a *different* task to keep the row count distinct from
  // the UPSERT scenario tested below.
  await store.saveTaskState({
    agent_id: AGENT,
    task: "Run smoke tests",
    status: "completed",
    progress: "All passing",
    files_modified: [],
    project: PROJECT,
  });

  // Get all
  const all = await store.getTaskStates({
    agent_id: AGENT,
    status: "all",
  });
  assert(all.length >= 2, "getTaskStates returns both states");
  assert(all[0].created_at >= all[1].created_at, "sorted newest first");

  // Filter by status
  const inProgress = await store.getTaskStates({
    agent_id: AGENT,
    status: "in_progress",
  });
  assert(inProgress.length === 1, "status filter works");
  assert(inProgress[0].status === "in_progress", "correct status returned");
}

async function testTaskIdUpsert() {
  console.log("\n── PgStore task_id UPSERT (AM-023) ──");

  const upsertAgent = `${AGENT}-upsert`;

  // First save with explicit task_id
  const a = await store.saveTaskState({
    agent_id: upsertAgent,
    task_id: "AM-999",
    task: "Hypothetical refactor",
    status: "in_progress",
    progress: "started",
    project: PROJECT,
  });
  assert(a.task_id === "AM-999", "task_id stored verbatim");
  const firstId = a.id;
  const firstCreated = a.created_at;

  // Second save with the *same* task_id should UPDATE the same row
  const b = await store.saveTaskState({
    agent_id: upsertAgent,
    task_id: "AM-999",
    task: "Hypothetical refactor (renamed)",
    status: "completed",
    progress: "finished",
    project: PROJECT,
  });
  assert(b.id === firstId, "UPSERT preserves row id");
  assert(b.status === "completed", "status overwritten");
  assert(b.task === "Hypothetical refactor (renamed)", "task description overwritten");
  assert(b.progress === "finished", "progress overwritten");
  assert(b.created_at === firstCreated, "created_at preserved across UPSERT");
  assert(
    b.updated_at !== undefined && b.updated_at >= firstCreated,
    "updated_at advanced on UPSERT"
  );

  // Total rows for this agent_id should be exactly 1
  const all = await store.getTaskStates({
    agent_id: upsertAgent,
    status: "all",
  });
  assert(all.length === 1, "UPSERT keeps row count at 1");

  // Different task_id under the same agent → distinct row
  await store.saveTaskState({
    agent_id: upsertAgent,
    task_id: "AM-1000",
    task: "Another task",
    status: "in_progress",
    project: PROJECT,
  });
  const all2 = await store.getTaskStates({
    agent_id: upsertAgent,
    status: "all",
  });
  assert(all2.length === 2, "different task_id creates a separate row");

  // Same agent isolation: another agent with the same task_id is unaffected
  const otherAgent = `${upsertAgent}-other`;
  const c = await store.saveTaskState({
    agent_id: otherAgent,
    task_id: "AM-999",
    task: "Different agent, same ticket",
    status: "in_progress",
    project: PROJECT,
  });
  assert(c.id !== firstId, "different agent gets its own row");

  // Implicit (hash-based) task_id: two saves with the same `task`
  // text but no explicit task_id should also collapse to a single row.
  const hashAgent = `${upsertAgent}-hash`;
  const h1 = await store.saveTaskState({
    agent_id: hashAgent,
    task: "Refactor logging layer",
    status: "in_progress",
    project: PROJECT,
  });
  const h2 = await store.saveTaskState({
    agent_id: hashAgent,
    task: "Refactor logging layer",
    status: "completed",
    project: PROJECT,
  });
  assert(h1.task_id === h2.task_id, "hash-derived task_id is stable for same text");
  assert(h1.id === h2.id, "hash-keyed UPSERT preserves row id");
  const hashAll = await store.getTaskStates({
    agent_id: hashAgent,
    status: "all",
  });
  assert(hashAll.length === 1, "hash-keyed UPSERT keeps row count at 1");

  // Cleanup just this isolated agent
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: DATABASE_URL! });
  try {
    await pool.query("DELETE FROM task_states WHERE agent_id LIKE $1", [
      `${upsertAgent}%`,
    ]);
  } finally {
    await pool.end();
  }
}

async function testSearchMemory() {
  console.log("\n── PgStore Search Memory ──");

  // Search for JWT (English, should hit via tsvector)
  const jwtResults = await store.searchMemory({
    agent_id: AGENT,
    query: "JWT",
  });
  assert(jwtResults.decisions.length >= 1, "search finds JWT decision");

  // Search with scope filter
  const decisionsOnly = await store.searchMemory({
    agent_id: AGENT,
    query: "database",
    scope: "decisions",
  });
  assert(decisionsOnly.decisions.length >= 1, "scope=decisions finds database decision");
  assert(decisionsOnly.task_states.length === 0, "scope=decisions returns no tasks");

  const tasksOnly = await store.searchMemory({
    agent_id: AGENT,
    query: "auth",
    scope: "tasks",
  });
  assert(tasksOnly.task_states.length >= 1, "scope=tasks finds auth task");
  assert(tasksOnly.decisions.length === 0, "scope=tasks returns no decisions");

  // Project filter
  const wrongProject = await store.searchMemory({
    agent_id: AGENT,
    query: "JWT",
    project: "nonexistent",
  });
  assert(
    wrongProject.decisions.length === 0 && wrongProject.task_states.length === 0,
    "project filter excludes non-matching"
  );

  // Agent isolation
  const otherAgent = await store.searchMemory({
    agent_id: "completely-different-agent",
    query: "JWT",
  });
  assert(
    otherAgent.decisions.length === 0 && otherAgent.task_states.length === 0,
    "search respects agent isolation"
  );

  // No results
  const noResults = await store.searchMemory({
    agent_id: AGENT,
    query: "kubernetes",
  });
  assert(
    noResults.decisions.length === 0 && noResults.task_states.length === 0,
    "no results for unrelated query"
  );

  // Limit
  const limited = await store.searchMemory({
    agent_id: AGENT,
    query: "architecture",
    scope: "decisions",
    limit: 1,
  });
  assert(limited.decisions.length <= 1, "limit parameter works");

  await store.saveConversationEvent({
    agent_id: `${AGENT}-conversation-search`,
    project: PROJECT,
    source: "codex",
    source_event_id: "search-conversation-event",
    role: "assistant",
    content: "Restart pack validation should continue from conversation memory.",
    occurred_at: "2026-05-19T00:02:00.000Z",
  });
  const conversationOnly = await store.searchMemory({
    agent_id: `${AGENT}-conversation-search`,
    query: "restart",
    scope: "conversation",
  });
  assert(conversationOnly.conversation_events.length >= 1, "search finds conversation event");
  assert(conversationOnly.decisions.length === 0 && conversationOnly.task_states.length === 0, "scope=conversation excludes structured memory");
}

async function testJapaneseSearch() {
  console.log("\n── PgStore Japanese Search ──");

  // Log Japanese decision
  await store.logDecision({
    agent_id: AGENT,
    decision: "認証方式をJWTに決定",
    context: "セッションCookieも検討したが、API設計の一貫性を優先",
    tags: ["認証", "アーキテクチャ"],
    project: PROJECT,
  });

  // Save Japanese task
  await store.saveTaskState({
    agent_id: AGENT,
    task: "認証ミドルウェアの実装",
    status: "in_progress",
    progress: "JWT検証完了、RBAC未実装",
    next_steps: "ロールベースアクセス制御を追加",
    project: PROJECT,
  });

  // Search with Japanese keyword
  const authResults = await store.searchMemory({
    agent_id: AGENT,
    query: "認証",
  });
  assert(authResults.decisions.length >= 1, "Japanese search finds 認証 decision");
  assert(authResults.task_states.length >= 1, "Japanese search finds 認証 task");

  // Search with mixed Japanese/English
  const mixedResults = await store.searchMemory({
    agent_id: AGENT,
    query: "JWT認証",
  });
  assert(
    mixedResults.decisions.length >= 1,
    "mixed Japanese/English search finds results"
  );

  // Search with Japanese tag
  const tagResults = await store.searchMemory({
    agent_id: AGENT,
    query: "アーキテクチャ",
    scope: "decisions",
  });
  assert(tagResults.decisions.length >= 1, "Japanese tag search works");

  // Partial Japanese keyword
  const partialResults = await store.searchMemory({
    agent_id: AGENT,
    query: "ミドルウェア",
    scope: "tasks",
  });
  assert(partialResults.task_states.length >= 1, "partial Japanese keyword search works");
}

async function testAgentIsolation() {
  console.log("\n── PgStore Agent Isolation ──");

  const otherAgent = `${AGENT}-isolated`;

  // Create data for other agent
  await store.logDecision({
    agent_id: otherAgent,
    decision: "Isolated agent decision",
    project: PROJECT,
  });

  // Original agent should not see it
  const results = await store.getDecisions({
    agent_id: AGENT,
    status: "all",
  });
  assert(
    !results.find((d) => d.decision === "Isolated agent decision"),
    "getDecisions respects agent isolation"
  );

  // Search should also be isolated
  const searchResults = await store.searchMemory({
    agent_id: AGENT,
    query: "Isolated",
  });
  assert(
    searchResults.decisions.length === 0,
    "searchMemory respects agent isolation"
  );
}

async function testBootSimulation() {
  console.log("\n── PgStore Boot Simulation ──");

  // Simulate boot: get latest in_progress task
  const tasks = await store.getTaskStates({
    agent_id: AGENT,
    project: PROJECT,
    limit: 1,
    status: "in_progress",
  });
  assert(tasks.length === 1, "boot returns exactly 1 in_progress task");
  assert(tasks[0].status === "in_progress", "boot returns in_progress only");
}

async function testRecoveryQualityLog() {
  console.log("\n── PgStore Recovery Quality Log (AM-002) ──");

  // Stage 0 (existing): minimal call still works (backward compat)
  const minimalId = await store.logRecoveryQuality({
    agent_id: AGENT,
    session_id: "test-session-minimal",
    recovered_tokens: 1234,
  });
  assert(minimalId.length > 0, "logRecoveryQuality (minimal) returns id");

  // AM-002: full call with all optional fields
  const notes = JSON.stringify({ source: "test", decisions: 3, tasks_in_progress: 1 });
  const fullId = await store.logRecoveryQuality({
    agent_id: AGENT,
    session_id: "test-session-full",
    recovered_tokens: 2048,
    task_continued: true,
    quality_score: 0.85,
    notes,
    search_memory_count_10min: 7,
  });
  assert(fullId.length > 0, "logRecoveryQuality (full) returns id");

  // Verify the row by querying directly
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: DATABASE_URL! });
  try {
    const r = await pool.query(
      `SELECT recovered_tokens, task_continued, quality_score, notes, search_memory_count_10min
         FROM recovery_quality_log WHERE id = $1`,
      [fullId]
    );
    assert(r.rows.length === 1, "row written");
    assert(r.rows[0].recovered_tokens === 2048, "recovered_tokens persisted");
    assert(r.rows[0].task_continued === true, "task_continued persisted");
    assert(Math.abs(r.rows[0].quality_score - 0.85) < 1e-9, "quality_score persisted");
    assert(r.rows[0].notes === notes, "notes JSON persisted verbatim");
    assert(r.rows[0].search_memory_count_10min === 7, "search_memory_count_10min persisted");

    // task_continued explicit false should be stored as false (not NULL)
    const falseId = await store.logRecoveryQuality({
      agent_id: AGENT,
      session_id: "test-session-tc-false",
      recovered_tokens: 100,
      task_continued: false,
    });
    const r2 = await pool.query(
      `SELECT task_continued FROM recovery_quality_log WHERE id = $1`,
      [falseId]
    );
    assert(r2.rows[0].task_continued === false, "task_continued=false stored as false");

    await store.updateSearchMemoryCount(fullId, 12);
    const r3 = await pool.query(
      `SELECT search_memory_count_10min FROM recovery_quality_log WHERE id = $1`,
      [fullId]
    );
    assert(r3.rows[0].search_memory_count_10min === 12, "updateSearchMemoryCount overwrites");

    // Empty log_id is a no-op (matches PgStore behavior)
    await store.updateSearchMemoryCount("", 99);
    assert(true, "updateSearchMemoryCount with empty id is no-op");
  } finally {
    await pool.end();
  }
}

async function testKnowledgeSupersede() {
  console.log("\n── PgStore Knowledge Supersede ──");

  const old = await store.saveKnowledge({
    agent_id: AGENT,
    project: PROJECT,
    title: "PG より SQLite が軽い",
    content: "SQLite は軽量で手軽に使える。",
    source_type: "manual",
    tags: ["database"],
  });

  // 1. Normal supersede
  const result = await store.supersedeKnowledge({
    agent_id: AGENT,
    old_id: old.id,
    new_title: "PG の方がスケールする",
    new_content: "長期的には PostgreSQL が適切。",
    reason: "実運用で SQLite の限界が明らかになった",
    project: PROJECT,
  });
  assert(result.old.status === "superseded", "old knowledge marked superseded");
  assert(result.new.supersedes === old.id, "new knowledge points to old id");
  assert(result.new.supersede_reason === "実運用で SQLite の限界が明らかになった", "supersede_reason preserved");
  assert(result.new.status === "active", "new knowledge is active");

  // 2. Boot excludes superseded
  const active = await store.getKnowledge({ agent_id: AGENT, status: "active" });
  assert(!active.find((k) => k.id === old.id), "superseded excluded from active list");
  assert(active.find((k) => k.id === result.new.id) !== undefined, "new knowledge in active list");

  // 3. Not found error
  try {
    await store.supersedeKnowledge({
      agent_id: AGENT,
      old_id: "00000000-0000-0000-0000-000000000000",
      new_title: "x",
      new_content: "x",
      reason: "x",
    });
    assert(false, "should throw for non-existent knowledge");
  } catch (err) {
    assert((err as Error).message.includes("Knowledge not found"), "throws on non-existent old_id");
  }

  // 4. Agent isolation
  const otherK = await store.saveKnowledge({
    agent_id: `${AGENT}-other`,
    title: "other agent knowledge",
    content: "test",
    source_type: "manual",
  });
  try {
    await store.supersedeKnowledge({
      agent_id: AGENT,
      old_id: otherK.id,
      new_title: "hijack",
      new_content: "x",
      reason: "x",
    });
    assert(false, "should throw for wrong agent's knowledge");
  } catch {
    assert(true, "agent isolation in knowledge supersede works");
  }
  const otherAfter = await store.getKnowledge({ agent_id: `${AGENT}-other`, status: "all" });
  const untouchedOther = otherAfter.find((k) => k.id === otherK.id);
  assert(
    untouchedOther?.status === "active",
    "wrong-agent knowledge supersede leaves target row active",
  );
  assert(
    otherAfter.filter((k) => k.supersedes === otherK.id).length === 0,
    "wrong-agent knowledge supersede creates no superseding row",
  );
}

async function testConversationEvents() {
  console.log("\n── PgStore Conversation Events ──");

  const first = await store.saveConversationEvent({
    agent_id: AGENT,
    project: PROJECT,
    source: "codex",
    source_event_id: "codex-event-1",
    source_path: "~/.codex/sessions/session.jsonl",
    role: "assistant",
    content: "Continue AM-031 from redacted event persistence.",
    metadata: { tool: "codex" },
    occurred_at: "2026-05-19T00:00:00.000Z",
  });
  const duplicate = await store.saveConversationEvent({
    agent_id: AGENT,
    project: PROJECT,
    source: "codex",
    source_event_id: "codex-event-1",
    content: "Continue AM-031 from redacted event persistence.",
    occurred_at: "2026-05-19T00:00:00.000Z",
  });
  await store.saveConversationEvent({
    agent_id: AGENT,
    project: PROJECT,
    source: "claude_code",
    source_event_id: "claude-event-1",
    role: "user",
    content: "Recover this after a session restart.",
    occurred_at: "2026-05-19T00:01:00.000Z",
  });

  assert(first.id === duplicate.id, "source_event_id deduplicates redacted events");
  const all = await store.getConversationEvents({ agent_id: AGENT, project: PROJECT });
  assert(all.length === 2, "getConversationEvents returns unique redacted events");
  assert(all[0].source === "claude_code", "events sorted newest first");
  const rawConversationEvents = await store.getRawEvents({ agent_id: AGENT, source: "conversation_event" });
  assert(rawConversationEvents.length === 2, "conversation_events are mirrored into raw_events");
  const firstRawEvent = rawConversationEvents.find((event) => event.source_event_id === first.id);
  assert(firstRawEvent !== undefined, "raw_events includes conversation event provenance");
  if (!firstRawEvent) throw new Error("missing raw event for first conversation event");
  assert(firstRawEvent.event_type === "assistant_message", "raw_events maps assistant conversation role");
  assert(firstRawEvent.content_hash === first.content_hash, "raw_events preserves conversation content hash");
  assert(firstRawEvent.metadata.compatibility_table === "conversation_events", "raw_events records compatibility provenance");
  const duplicateRawEvents = await store.getRawEvents({ agent_id: AGENT, source: "conversation_event" });
  assert(duplicateRawEvents.length === 2, "duplicate conversation ingest does not duplicate raw_events");
  const manualRaw = await store.saveRawEvent({
    agent_id: AGENT,
    session_id: "pg-session-raw-1",
    project: PROJECT,
    source: "manual",
    source_event_id: "pg-manual-raw-1",
    event_type: "host_event",
    content: "PG host observed prepare band.",
    metadata: { band: "prepare" },
    occurred_at: "2026-05-19T00:03:00.000Z",
  });
  const duplicateManualRaw = await store.saveRawEvent({
    agent_id: AGENT,
    session_id: "pg-session-raw-1",
    project: PROJECT,
    source: "manual",
    source_event_id: "pg-manual-raw-1",
    event_type: "host_event",
    content: "PG host observed prepare band.",
    occurred_at: "2026-05-19T00:03:00.000Z",
  });
  assert(manualRaw.id === duplicateManualRaw.id, "raw_events deduplicate by source_event_id");
  const sourceRefRaw = await store.saveRawEvent({
    agent_id: AGENT,
    session_id: "pg-session-raw-ref-1",
    project: PROJECT,
    source: "host_context",
    event_type: "context_ref",
    source_ref: { kind: "context_health", ref: "claude-context-ratio" },
    metadata: { ratio: 0.91 },
    occurred_at: "2026-05-19T00:04:00.000Z",
  });
  const duplicateSourceRefRaw = await store.saveRawEvent({
    agent_id: AGENT,
    session_id: "pg-session-raw-ref-1",
    project: PROJECT,
    source: "host_context",
    event_type: "context_ref",
    source_ref: { kind: "context_health", ref: "claude-context-ratio" },
    occurred_at: "2026-05-19T00:04:00.000Z",
  });
  const distinctSourceRefRaw = await store.saveRawEvent({
    agent_id: AGENT,
    session_id: "pg-session-raw-ref-1",
    project: PROJECT,
    source: "host_context",
    event_type: "context_ref",
    source_ref: { kind: "context_health", ref: "codex-context-ratio" },
    occurred_at: "2026-05-19T00:04:00.000Z",
  });
  assert(sourceRefRaw.id === duplicateSourceRefRaw.id, "raw_events deduplicate source_ref-only events by source_ref_hash");
  assert(sourceRefRaw.id !== distinctSourceRefRaw.id, "raw_events do not collapse distinct source_ref-only events with same timestamp");
  assert(sourceRefRaw.content_hash === undefined, "source_ref-only raw_events do not require content_hash");
  assert(sourceRefRaw.source_ref_hash?.length === 64, "source_ref-only raw_events keep source_ref_hash identity");
  const sessionRaw = await store.getRawEvents({ agent_id: AGENT, session_id: "pg-session-raw-1" });
  assert(sessionRaw.length === 1 && sessionRaw[0].metadata.band === "prepare", "raw_events filters by session_id");
  const codexOnly = await store.getConversationEvents({ agent_id: AGENT, source: "codex" });
  assert(codexOnly.length === 1, "source filter works");
  assert(codexOnly[0].metadata.tool === "codex", "metadata round-trips");
}

async function cleanup() {
  // Clean up test data
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: DATABASE_URL! });
  await pool.query("DELETE FROM raw_events WHERE agent_id LIKE $1", [`${AGENT}%`]);
  await pool.query("DELETE FROM conversation_events WHERE agent_id LIKE $1", [`${AGENT}%`]);
  await pool.query("DELETE FROM decisions WHERE agent_id LIKE $1", [`${AGENT}%`]);
  await pool.query("DELETE FROM task_states WHERE agent_id LIKE $1", [`${AGENT}%`]);
  await pool.query("DELETE FROM knowledge WHERE agent_id LIKE $1", [`${AGENT}%`]);
  await pool.query("DELETE FROM recovery_quality_log WHERE agent_id LIKE $1", [`${AGENT}%`]);
  await pool.end();
}

async function run() {
  console.log("agent-memory PgStore test suite\n");
  console.log(`Using agent_id prefix: ${AGENT}`);

  try {
    await setup();
    await testMigration();
    await testMigrationRerunSafetyInIsolatedSchema();
    await testRawEventsLegacyOccurredAtMigration();
    await testDecisionCRUD();
    await testSupersede();
    await testTaskStates();
    await testTaskIdUpsert();
    await testSearchMemory();
    await testJapaneseSearch();
    await testAgentIsolation();
    await testBootSimulation();
    await testRecoveryQualityLog();
    testKnowledgeSupersedeUpdateSqlGuard();
    await testKnowledgeSupersede();
    await testConversationEvents();
  } finally {
    await cleanup();
    await store.close();
  }

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
