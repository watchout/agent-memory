#!/usr/bin/env node
/**
 * Integration tests for agent-memory SqliteStore.
 * Run: tsx src/test-sqlite.ts
 *
 * Uses a temporary DB file in the OS temp dir for isolation.
 */
import { SqliteStore } from "./stores/sqlite-store.js";
import { rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DB_PATH = join(tmpdir(), `agent-memory-test-sqlite-${Date.now()}.db`);
const AGENT = "test-sqlite";
const PROJECT = "test-project";

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

let store: SqliteStore;

async function setup() {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  store = new SqliteStore(TEST_DB_PATH);
  await store.initialize();
}

async function testMigration() {
  console.log("\n── Migration & Init ──");
  assert(existsSync(TEST_DB_PATH), "DB file created on initialize");
  // initialize is idempotent
  await store.initialize();
  assert(true, "initialize is idempotent");
}

async function testDecisionCRUD() {
  console.log("\n── SqliteStore Decision CRUD ──");

  const d1 = await store.logDecision({
    agent_id: AGENT,
    decision: "Use JWT with 7-day refresh token",
    context: "Considered session cookies vs JWT. JWT chosen for API-first design.",
    tags: ["auth", "architecture"],
    project: PROJECT,
  });
  assert(d1.id.length > 0, "logDecision returns valid UUID");
  assert(d1.status === "active", "new decision is active");
  assert(d1.tags.length === 2, "tags preserved");
  assert(d1.agent_id === AGENT, "agent_id preserved");

  await store.logDecision({
    agent_id: AGENT,
    decision: "PostgreSQL as primary database",
    context: "SQLite ruled out for multi-agent access.",
    tags: ["database", "architecture"],
    project: PROJECT,
  });

  const active = await store.getDecisions({
    agent_id: AGENT,
    project: PROJECT,
  });
  assert(active.length === 2, "getDecisions returns 2 active decisions");
  assert(active[0].created_at >= active[1].created_at, "sorted newest first");

  const authOnly = await store.getDecisions({
    agent_id: AGENT,
    tags: ["auth"],
  });
  assert(authOnly.length === 1, "tag filter works");
  assert(authOnly[0].decision.includes("JWT"), "correct decision returned by tag");

  const all = await store.getDecisions({
    agent_id: AGENT,
    status: "all",
  });
  assert(all.length === 2, "status=all returns all");
}

async function testSupersede() {
  console.log("\n── SqliteStore Supersede ──");

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
  assert(result.old.superseded_by === result.new.id, "superseded_by linked");
  assert(result.new.status === "active", "new decision is active");
  assert(result.new.tags.length === 2, "new tags preserved");

  const activeApi = await store.getDecisions({
    agent_id: AGENT,
    tags: ["api"],
    status: "active",
  });
  assert(!activeApi.find((d) => d.id === d1.id), "superseded excluded from active");
  assert(
    activeApi.find((d) => d.id === result.new.id) !== undefined,
    "new decision in active list"
  );

  // Error: non-existent
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
}

async function testTaskStates() {
  console.log("\n── SqliteStore Task States ──");

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

  await store.saveTaskState({
    agent_id: AGENT,
    task: "Implement auth middleware",
    status: "completed",
    progress: "JWT + RBAC fully implemented",
    files_modified: ["src/middleware/auth.ts", "src/middleware/rbac.ts"],
    project: PROJECT,
  });

  const all = await store.getTaskStates({
    agent_id: AGENT,
    status: "all",
  });
  assert(all.length >= 2, "getTaskStates returns both states");

  const inProgress = await store.getTaskStates({
    agent_id: AGENT,
    status: "in_progress",
  });
  assert(inProgress.length === 1, "status filter works");
  assert(inProgress[0].status === "in_progress", "correct status returned");
}

async function testKnowledge() {
  console.log("\n── SqliteStore Knowledge ──");

  const k1 = await store.saveKnowledge({
    agent_id: AGENT,
    project: PROJECT,
    title: "JWT refresh token rotation",
    content: "Use single-use refresh tokens with rotation on each refresh.",
    source_type: "manual",
    tags: ["auth", "security"],
  });
  assert(k1.id.length > 0, "saveKnowledge returns valid UUID");
  assert(k1.status === "active", "new knowledge is active");
  assert(k1.tags.length === 2, "tags preserved");

  const k2 = await store.saveKnowledge({
    agent_id: AGENT,
    project: PROJECT,
    title: "Database connection pooling",
    content: "Use a pool size of 10-20 for typical web apps.",
    source_type: "decisions",
    source_ids: [k1.id], // not a real link, just exercising the field
    tags: ["database"],
  });

  const all = await store.getKnowledge({ agent_id: AGENT });
  assert(all.length === 2, "getKnowledge returns 2 active items");

  const tagged = await store.getKnowledge({
    agent_id: AGENT,
    tags: ["security"],
  });
  assert(tagged.length === 1, "tag filter works");
  assert(tagged[0].title.includes("JWT"), "correct knowledge returned");

  // Update status
  const archived = await store.updateKnowledgeStatus({
    id: k2.id,
    agent_id: AGENT,
    status: "archived",
  });
  assert(archived.status === "archived", "status updated to archived");

  const activeAfter = await store.getKnowledge({ agent_id: AGENT });
  assert(activeAfter.length === 1, "archived excluded from active");

  // Merge into another
  const k3 = await store.saveKnowledge({
    agent_id: AGENT,
    project: PROJECT,
    title: "JWT short-lived access tokens",
    content: "Short access token lifetime + refresh token rotation",
    source_type: "manual",
    tags: ["auth"],
  });
  const merged = await store.updateKnowledgeStatus({
    id: k3.id,
    agent_id: AGENT,
    status: "active", // ignored when merged_into present
    merged_into: k1.id,
  });
  assert(merged.status === "merged", "status set to merged when merged_into present");
  assert(merged.merged_into === k1.id, "merged_into linked");

  // Cannot merge into self
  try {
    await store.updateKnowledgeStatus({
      id: k1.id,
      agent_id: AGENT,
      status: "active",
      merged_into: k1.id,
    });
    assert(false, "should throw on self-merge");
  } catch {
    assert(true, "rejects self-merge");
  }

  // Cannot merge into non-existent target
  try {
    await store.updateKnowledgeStatus({
      id: k1.id,
      agent_id: AGENT,
      status: "active",
      merged_into: "00000000-0000-0000-0000-000000000000",
    });
    assert(false, "should throw on missing merge target");
  } catch {
    assert(true, "rejects missing merge target");
  }
}

async function testSearchMemory() {
  console.log("\n── SqliteStore Search Memory ──");

  const jwtResults = await store.searchMemory({
    agent_id: AGENT,
    query: "JWT",
  });
  assert(jwtResults.decisions.length >= 1, "search finds JWT decision");

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

  const wrongProject = await store.searchMemory({
    agent_id: AGENT,
    query: "JWT",
    project: "nonexistent",
  });
  assert(
    wrongProject.decisions.length === 0 && wrongProject.task_states.length === 0,
    "project filter excludes non-matching"
  );

  const otherAgent = await store.searchMemory({
    agent_id: "completely-different-agent",
    query: "JWT",
  });
  assert(
    otherAgent.decisions.length === 0 && otherAgent.task_states.length === 0,
    "search respects agent isolation"
  );

  const noResults = await store.searchMemory({
    agent_id: AGENT,
    query: "kubernetes",
  });
  assert(
    noResults.decisions.length === 0 && noResults.task_states.length === 0,
    "no results for unrelated query"
  );

  const limited = await store.searchMemory({
    agent_id: AGENT,
    query: "architecture",
    scope: "decisions",
    limit: 1,
  });
  assert(limited.decisions.length <= 1, "limit parameter works");
}

async function testJapaneseSearch() {
  console.log("\n── SqliteStore Japanese Search ──");

  await store.logDecision({
    agent_id: AGENT,
    decision: "認証方式をJWTに決定",
    context: "セッションCookieも検討したが、API設計の一貫性を優先",
    tags: ["認証", "アーキテクチャ"],
    project: PROJECT,
  });

  await store.saveTaskState({
    agent_id: AGENT,
    task: "認証ミドルウェアの実装",
    status: "in_progress",
    progress: "JWT検証完了、RBAC未実装",
    next_steps: "ロールベースアクセス制御を追加",
    project: PROJECT,
  });

  const authResults = await store.searchMemory({
    agent_id: AGENT,
    query: "認証",
  });
  assert(authResults.decisions.length >= 1, "Japanese search finds 認証 decision");
  assert(authResults.task_states.length >= 1, "Japanese search finds 認証 task");

  const mixedResults = await store.searchMemory({
    agent_id: AGENT,
    query: "JWT認証",
  });
  assert(
    mixedResults.decisions.length >= 1,
    "mixed Japanese/English search finds results"
  );

  const partialResults = await store.searchMemory({
    agent_id: AGENT,
    query: "ミドルウェア",
    scope: "tasks",
  });
  assert(partialResults.task_states.length >= 1, "partial Japanese keyword search works");
}

async function testRecoveryConfig() {
  console.log("\n── SqliteStore Recovery Config ──");

  const noneYet = await store.getRecoveryConfig(AGENT);
  assert(noneYet === null, "no recovery_config initially");

  const inserted = await store.upsertRecoveryConfig({
    agent_id: AGENT,
    max_tokens: 2500,
    task_states_limit: 4,
  });
  assert(inserted.max_tokens === 2500, "insert max_tokens applied");
  assert(inserted.task_states_limit === 4, "insert task_states_limit applied");
  assert(inserted.knowledge_limit === 3, "insert default knowledge_limit");

  const fetched = await store.getRecoveryConfig(AGENT);
  assert(fetched !== null, "config retrievable after insert");
  assert(fetched!.max_tokens === 2500, "fetched max_tokens matches");

  const updated = await store.upsertRecoveryConfig({
    agent_id: AGENT,
    decisions_limit: 7,
  });
  assert(updated.decisions_limit === 7, "update decisions_limit applied");
  assert(updated.max_tokens === 2500, "untouched fields preserved on update");
}

async function testRecoveryQualityLog() {
  console.log("\n── SqliteStore Recovery Quality Log ──");

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

  // Verify the row was written with the new fields by inspecting the DB directly
  const sqlitePrivate = store as unknown as {
    db: { prepare: (sql: string) => { bind: (p: unknown[]) => void; step: () => boolean; getAsObject: () => Record<string, unknown>; free: () => void } };
  };
  const stmt = sqlitePrivate.db.prepare(
    "SELECT agent_id, session_id, recovered_tokens, task_continued, quality_score, notes, search_memory_count_10min FROM recovery_quality_log WHERE id = ?"
  );
  stmt.bind([fullId]);
  let row: Record<string, unknown> | null = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  assert(row !== null, "logRecoveryQuality row retrievable");
  assert(row?.recovered_tokens === 2048, "recovered_tokens persisted");
  assert(row?.task_continued === 1, "task_continued persisted as 1");
  assert(Math.abs((row?.quality_score as number) - 0.85) < 1e-9, "quality_score persisted");
  assert(row?.notes === notes, "notes JSON persisted verbatim");
  assert(row?.search_memory_count_10min === 7, "search_memory_count_10min persisted");

  // task_continued explicit false should be stored as 0, not NULL
  const falseId = await store.logRecoveryQuality({
    agent_id: AGENT,
    session_id: "test-session-tc-false",
    recovered_tokens: 100,
    task_continued: false,
  });
  const stmt2 = sqlitePrivate.db.prepare(
    "SELECT task_continued FROM recovery_quality_log WHERE id = ?"
  );
  stmt2.bind([falseId]);
  let row2: Record<string, unknown> | null = null;
  if (stmt2.step()) row2 = stmt2.getAsObject();
  stmt2.free();
  assert(row2?.task_continued === 0, "task_continued=false stored as 0 (not NULL)");

  await store.updateSearchMemoryCount(fullId, 12);
  const stmt3 = sqlitePrivate.db.prepare(
    "SELECT search_memory_count_10min FROM recovery_quality_log WHERE id = ?"
  );
  stmt3.bind([fullId]);
  let row3: Record<string, unknown> | null = null;
  if (stmt3.step()) row3 = stmt3.getAsObject();
  stmt3.free();
  assert(row3?.search_memory_count_10min === 12, "updateSearchMemoryCount overwrites");

  // Empty log_id is a no-op (matches PgStore behavior)
  await store.updateSearchMemoryCount("", 99);
  assert(true, "updateSearchMemoryCount with empty id is no-op");
}

async function testExpireStaleTaskStates() {
  console.log("\n── SqliteStore Expire Stale Task States ──");

  // Nothing should expire when max_age_days is huge
  const noneExpired = await store.expireStaleTaskStates({
    agent_id: AGENT,
    max_age_days: 365,
  });
  assert(noneExpired === 0, "nothing expires with huge max_age_days");

  // Insert an in_progress task with a backdated created_at, then expire it
  const oldId = "00000000-0000-0000-0000-000000000999";
  // We use the underlying handle via a fresh saveTaskState then UPDATE for the timestamp
  const fresh = await store.saveTaskState({
    agent_id: AGENT,
    task: "stale task for expire test",
    status: "in_progress",
    project: PROJECT,
  });
  // Backdate via direct SQL (test-only side door, equivalent to PG transaction-rollback tests)
  const sqlitePrivate = store as unknown as { db: { run: (sql: string, params: unknown[]) => void } };
  sqlitePrivate.db.run(
    "UPDATE task_states SET created_at = ? WHERE id = ?",
    ["2020-01-01T00:00:00.000Z", fresh.id]
  );
  const expired = await store.expireStaleTaskStates({
    agent_id: AGENT,
    max_age_days: 30,
  });
  assert(expired >= 1, "expireStaleTaskStates returns count of expired rows");

  const refetched = await store.getTaskStates({
    agent_id: AGENT,
    status: "all",
  });
  const target = refetched.find((t) => t.id === fresh.id);
  assert(target?.status === "expired", "target task is now expired");

  void oldId; // not used; placeholder kept for clarity
}

async function testGetRecentMessages() {
  console.log("\n── SqliteStore Recent Messages ──");
  const msgs = await store.getRecentMessages({ agent_id: AGENT });
  assert(Array.isArray(msgs) && msgs.length === 0, "getRecentMessages returns empty array");
}

async function testPersistence() {
  console.log("\n── SqliteStore Persistence ──");

  // Close the current store, reopen on the same path, verify data survives
  await store.close();
  const reopened = new SqliteStore(TEST_DB_PATH);
  await reopened.initialize();

  const decisions = await reopened.getDecisions({ agent_id: AGENT, status: "all" });
  assert(decisions.length > 0, "decisions persist across reopen");

  const tasks = await reopened.getTaskStates({ agent_id: AGENT, status: "all" });
  assert(tasks.length > 0, "task_states persist across reopen");

  const config = await reopened.getRecoveryConfig(AGENT);
  assert(config !== null, "recovery_config persists across reopen");

  await reopened.close();

  // Reassign so cleanup() at end of run() can close cleanly
  store = reopened;
}

async function cleanup() {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
}

async function run() {
  console.log("agent-memory SqliteStore test suite\n");
  console.log(`Using DB path: ${TEST_DB_PATH}`);

  try {
    await setup();
    await testMigration();
    await testDecisionCRUD();
    await testSupersede();
    await testTaskStates();
    await testKnowledge();
    await testSearchMemory();
    await testJapaneseSearch();
    await testRecoveryConfig();
    await testRecoveryQualityLog();
    await testExpireStaleTaskStates();
    await testGetRecentMessages();
    await testPersistence();
  } finally {
    await cleanup();
  }

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
