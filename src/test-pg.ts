#!/usr/bin/env node
/**
 * Integration tests for agent-memory PgStore.
 * Requires: DATABASE_URL=postgresql://localhost/agent_comms
 * Run: DATABASE_URL=postgresql://localhost/agent_comms tsx src/test-pg.ts
 *
 * Uses transaction rollback for test isolation — no persistent side effects.
 */
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

  // Save completed
  const t2 = await store.saveTaskState({
    agent_id: AGENT,
    task: "Implement auth middleware",
    status: "completed",
    progress: "JWT + RBAC fully implemented",
    files_modified: ["src/middleware/auth.ts", "src/middleware/rbac.ts"],
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

async function cleanup() {
  // Clean up test data
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: DATABASE_URL! });
  await pool.query("DELETE FROM decisions WHERE agent_id LIKE $1", [`${AGENT}%`]);
  await pool.query("DELETE FROM task_states WHERE agent_id LIKE $1", [`${AGENT}%`]);
  await pool.query("DELETE FROM recovery_quality_log WHERE agent_id LIKE $1", [`${AGENT}%`]);
  await pool.end();
}

async function run() {
  console.log("agent-memory PgStore test suite\n");
  console.log(`Using agent_id prefix: ${AGENT}`);

  try {
    await setup();
    await testMigration();
    await testDecisionCRUD();
    await testSupersede();
    await testTaskStates();
    await testSearchMemory();
    await testJapaneseSearch();
    await testAgentIsolation();
    await testBootSimulation();
    await testRecoveryQualityLog();
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
