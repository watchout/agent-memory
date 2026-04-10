#!/usr/bin/env node
/**
 * Integration tests for agent-memory SqliteStore.
 * Run: tsx src/test-sqlite.ts
 *
 * Uses a temporary DB file in the OS temp dir for isolation.
 */
import { SqliteStore } from "./stores/sqlite-store.js";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stripOrphanSurrogates } from "./sanitize.js";
import {
  catchUp,
  contentHash,
  findJsonlFiles,
  parseJsonl,
  extractFromRecord,
  MAX_PROJECTS_GLOB_DEPTH,
} from "./catch-up.js";

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

  // AM-023: same task text now collapses to a single row via hash-keyed
  // UPSERT, so use distinct task texts to retain the legacy two-row
  // expectation. The dedicated UPSERT test below covers the collapse.
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
  assert(t1.task_id !== undefined, "task_id auto-derived");
  assert(t1.updated_at !== undefined, "updated_at populated");

  await store.saveTaskState({
    agent_id: AGENT,
    task: "Run smoke tests",
    status: "completed",
    progress: "All passing",
    files_modified: [],
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

async function testTaskIdUpsert() {
  console.log("\n── SqliteStore task_id UPSERT (AM-023) ──");

  const upsertAgent = `${AGENT}-upsert`;

  // Explicit task_id UPSERT
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

  const all = await store.getTaskStates({
    agent_id: upsertAgent,
    status: "all",
  });
  assert(all.length === 1, "UPSERT keeps row count at 1");

  // Different task_id under same agent → distinct row
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

  // Same task_id under a different agent → distinct row (agent isolation)
  const otherAgent = `${upsertAgent}-other`;
  const c = await store.saveTaskState({
    agent_id: otherAgent,
    task_id: "AM-999",
    task: "Different agent, same ticket",
    status: "in_progress",
    project: PROJECT,
  });
  assert(c.id !== firstId, "different agent gets its own row");

  // Hash-derived task_id: same task text collapses to one row
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

async function testKnowledgeSupersede() {
  console.log("\n── SqliteStore Knowledge Supersede ──");

  const old = await store.saveKnowledge({
    agent_id: AGENT,
    project: PROJECT,
    title: "SQLite is lighter",
    content: "SQLite is easy to set up.",
    source_type: "manual",
    tags: ["database"],
  });

  // 1. Normal supersede
  const result = await store.supersedeKnowledge({
    agent_id: AGENT,
    old_id: old.id,
    new_title: "PG scales better",
    new_content: "PostgreSQL is better for production.",
    reason: "SQLite showed limits in practice",
    project: PROJECT,
  });
  assert(result.old.status === "superseded", "old knowledge marked superseded");
  assert(result.new.supersedes === old.id, "new knowledge points to old id");
  assert(result.new.supersede_reason === "SQLite showed limits in practice", "supersede_reason preserved");
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

async function testStripOrphanSurrogates() {
  console.log("\n── stripOrphanSurrogates (search_memory bug fix) ──");

  // ── pure ASCII passes through ──
  assert(stripOrphanSurrogates("hello world") === "hello world", "ASCII unchanged");
  assert(stripOrphanSurrogates("") === "", "empty string unchanged");

  // ── well-formed surrogate pairs pass through (😀 = U+1F600) ──
  const grin = "😀";
  assert(grin.length === 2, "smiley occupies 2 UTF-16 code units (surrogate pair)");
  assert(
    stripOrphanSurrogates(`hi ${grin} there`) === `hi ${grin} there`,
    "well-formed surrogate pair preserved"
  );

  // ── orphan high surrogate is dropped (the actual bug) ──
  const slicedAtPair = grin.slice(0, 1); // U+D83D alone
  assert(slicedAtPair.length === 1, "smiley.slice(0,1) leaves a 1-codeunit orphan");
  const sanitized = stripOrphanSurrogates(`text${slicedAtPair}rest`);
  assert(sanitized === "textrest", "orphan high surrogate stripped between text");

  // ── lone low surrogate is dropped ──
  const loneLow = String.fromCharCode(0xdc00);
  assert(stripOrphanSurrogates(`a${loneLow}b`) === "ab", "lone low surrogate stripped");

  // ── adjacent orphans don't merge into a fake pair ──
  const loneHigh = String.fromCharCode(0xd83d);
  const fakePair = `${loneHigh}x${loneLow}`;
  assert(stripOrphanSurrogates(fakePair) === "x", "two orphans separated by text both stripped");

  // ── the integration scenario: slicing a string at a surrogate boundary ──
  // Simulates `m.content.slice(0, 100)` landing in the middle of an emoji.
  const content = "x".repeat(99) + grin; // total length 101 (99 + 2)
  const sliced = content.slice(0, 100); // length 100, last unit is the orphan high surrogate
  assert(sliced.length === 100 && sliced.charCodeAt(99) >= 0xd800 && sliced.charCodeAt(99) <= 0xdbff,
    "slice(0,100) leaves an orphan high surrogate at the end");
  const fixed = stripOrphanSurrogates(sliced);
  assert(fixed.length === 99, "sanitized output has the orphan removed");
  // and most importantly: JSON.stringify followed by JSON.parse round-trips cleanly
  let roundtripOk = true;
  try {
    JSON.parse(JSON.stringify({ text: fixed }));
  } catch {
    roundtripOk = false;
  }
  assert(roundtripOk, "sanitized text round-trips through JSON.stringify + JSON.parse");

  // ── unsanitized input would NOT round-trip via a strict parser ──
  // (V8 JSON.parse is lenient and tolerates lone surrogates, so we
  // can't directly demonstrate the API rejection here. We instead
  // assert the byte-level invariant that no surrogate code unit
  // remains in the sanitized output.)
  const hasSurrogate = (s: string): boolean => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
        if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
        i++;
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        return true;
      }
    }
    return false;
  };
  assert(hasSurrogate(sliced) === true, "sliced input contains an orphan (sanity check)");
  assert(hasSurrogate(fixed) === false, "sanitized output contains no orphans");
}

// ─── AM-026: catch-up Source A ────────────────────────────────────

/**
 * Build a Claude Code-style assistant jsonl line. Mirrors the shape
 * documented in the issue + verified against
 * `~/.claude/projects/.../*.jsonl` real files.
 */
function buildJsonlAssistantToolUse(timestamp: string, name: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: `tu-${Math.random()}`, name, input }],
    },
  });
}

function buildJsonlAssistantText(timestamp: string, text: string): string {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  });
}

async function testCatchUpSourceA() {
  console.log("\n── SqliteStore catch-up Source A (AM-026) ──");

  const fixtureRoot = join(tmpdir(), `catch-up-fixture-${Date.now()}`);
  const projectDir = join(fixtureRoot, "test-project-slug");
  const deepDir = join(projectDir, "deep1", "deep2", "deep3"); // depth 4 from fixtureRoot
  mkdirSync(deepDir, { recursive: true });

  const CATCH_AGENT = `catchup-test-${Date.now()}`;

  // Pure-function smoke (parser primitives)
  assert(MAX_PROJECTS_GLOB_DEPTH === 3, "MAX_PROJECTS_GLOB_DEPTH is 3 (ARC #4)");
  assert(contentHash("hello") === contentHash("hello"), "contentHash is deterministic");
  assert(contentHash("a") !== contentHash("b"), "contentHash discriminates inputs");

  // Fixture A: jsonl in the project root with three event types
  const ts1 = new Date(Date.now() - 3 * 60_000).toISOString();
  const ts2 = new Date(Date.now() - 2 * 60_000).toISOString();
  const ts3 = new Date(Date.now() - 1 * 60_000).toISOString();
  const ts4 = new Date(Date.now() - 30_000).toISOString();

  const lines = [
    buildJsonlAssistantToolUse(ts1, "Edit", { file_path: "/repo/src/foo.ts" }),
    buildJsonlAssistantToolUse(ts2, "Bash", { command: "git commit -m \"feat(AM-026): wire catch-up\"" }),
    buildJsonlAssistantText(ts3, "[TASK:start] AM-026 catch-up Source A 検証中"),
    buildJsonlAssistantText(ts4, "[KNOWLEDGE] catch-up jsonl parser handles tool_use, text, dedup"),
  ];
  writeFileSync(join(projectDir, "session-1.jsonl"), lines.join("\n") + "\n");

  // Fixture B: an extra jsonl 4 levels deep — should be IGNORED by maxDepth=3
  const tooDeep = join(deepDir, "session-too-deep.jsonl");
  writeFileSync(
    tooDeep,
    buildJsonlAssistantToolUse(ts4, "Edit", { file_path: "/repo/should-be-ignored.ts" }) + "\n"
  );

  // Override projects dir to the fixture root so the live ~/.claude/projects
  // tree doesn't leak into this test.
  const prevDir = process.env.CLAUDE_PROJECTS_DIR;
  process.env.CLAUDE_PROJECTS_DIR = fixtureRoot;

  try {
    // ── Test 1 (NORMAL): findJsonlFiles respects maxDepth=3 ──
    const lookback = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const files = findJsonlFiles(lookback, fixtureRoot);
    assert(
      files.some((f) => f.endsWith("session-1.jsonl")),
      "findJsonlFiles surfaces session-1.jsonl (depth 2)"
    );
    assert(
      !files.some((f) => f.endsWith("session-too-deep.jsonl")),
      "findJsonlFiles excludes file at depth 4 (maxDepth=3 ARC #4)"
    );

    // ── Test 2 (NORMAL): parseJsonl + extractFromRecord rule coverage ──
    const events = parseJsonl(join(projectDir, "session-1.jsonl"), lookback);
    assert(events.length === 4, "parseJsonl yields all 4 in-window events");
    const tables = events.map((e) => e.target_table).sort();
    assert(
      tables.includes("task_states") && tables.includes("knowledge"),
      "parser produces both task_states and knowledge target tables"
    );
    const editEvent = events.find((e) => e.files_modified?.length);
    assert(
      editEvent?.files_modified?.[0] === "/repo/src/foo.ts",
      "Edit tool_use → files_modified populated"
    );

    // pure-fn: extractFromRecord on a non-assistant record returns []
    const userRecord = { type: "user", timestamp: ts1, message: { role: "user", content: "hi" } };
    assert(extractFromRecord(userRecord).length === 0, "user records skipped");

    // ── Test 3 (NORMAL): catchUp inserts new rows + writes ledger ──
    const r1 = await catchUp(store, CATCH_AGENT, { source: "conversation" });
    const totalCaught =
      r1.caught.decisions + r1.caught.task_states + r1.caught.knowledge;
    assert(totalCaught === 4, "first sweep caught all 4 fixture events");
    assert(r1.skipped === 0, "first sweep skipped 0 events");
    assert(typeof r1.last_checked === "string", "last_checked is set");

    // verify rows were written
    const tasksAfter = await store.getTaskStates({ agent_id: CATCH_AGENT, status: "all" });
    assert(tasksAfter.length >= 1, "task_states row(s) inserted");
    const knowledgeAfter = await store.getKnowledge({ agent_id: CATCH_AGENT, status: "active" });
    assert(knowledgeAfter.length >= 1, "knowledge row(s) inserted");

    // ── Test 4 (ABNORMAL): re-running same sweep dedups everything ──
    const r2 = await catchUp(store, CATCH_AGENT, { source: "conversation", since: ts1 });
    const r2Caught =
      r2.caught.decisions + r2.caught.task_states + r2.caught.knowledge;
    assert(r2Caught === 0, "second sweep caught 0 (all dedup-skipped)");
    assert(r2.skipped >= 4, `second sweep skipped >= 4 (got ${r2.skipped})`);

    // ── Test 5 (NORMAL): same content but >60s away → INSERTed ──
    const farFutureTs = new Date(Date.now() + 5 * 60 * 60_000).toISOString();
    const dupAway = await store.isCatchUpDuplicate({
      agent_id: CATCH_AGENT,
      content_hash: contentHash("Edit /repo/src/foo.ts"),
      event_at: farFutureTs,
    });
    assert(dupAway === false, "dedup window (±60s) does NOT match a >60s-away event");

    // ── Test 6 (ABNORMAL): dry_run reports counts but writes nothing new ──
    const tasksBeforeDry = (await store.getTaskStates({ agent_id: CATCH_AGENT, status: "all" })).length;
    const knowledgeBeforeDry = (await store.getKnowledge({ agent_id: CATCH_AGENT, status: "active" })).length;

    // make a brand-new fixture with a unique event so dedup doesn't kill it
    const ts5 = new Date(Date.now() - 10_000).toISOString();
    writeFileSync(
      join(projectDir, "session-2.jsonl"),
      buildJsonlAssistantText(ts5, "[KNOWLEDGE] dry_run smoke from AM-026 test " + Date.now()) + "\n"
    );

    const r3 = await catchUp(store, CATCH_AGENT, { source: "conversation", since: ts5, dry_run: true });
    const r3Caught =
      r3.caught.decisions + r3.caught.task_states + r3.caught.knowledge;
    assert(r3Caught === 0, "dry_run reports caught=0 in counters (no inserts)");

    const tasksAfterDry = (await store.getTaskStates({ agent_id: CATCH_AGENT, status: "all" })).length;
    const knowledgeAfterDry = (await store.getKnowledge({ agent_id: CATCH_AGENT, status: "active" })).length;
    assert(tasksAfterDry === tasksBeforeDry, "dry_run did not insert into task_states");
    assert(
      knowledgeAfterDry === knowledgeBeforeDry,
      "dry_run did not insert into knowledge"
    );

    // ── Test 7 (ABNORMAL): unset CLAUDE_PROJECTS_DIR falls back to default ──
    delete process.env.CLAUDE_PROJECTS_DIR;
    // We don't actually run a sweep without the override here (the live
    // ~/.claude/projects tree would create noise). We just check that
    // findJsonlFiles is callable without the env var without throwing.
    const filesDefault = findJsonlFiles(new Date(0), undefined, 0);
    assert(Array.isArray(filesDefault), "findJsonlFiles tolerates default root + maxDepth=0");

    // ── Test 8 (ABNORMAL): explicit since in the future skips everything ──
    process.env.CLAUDE_PROJECTS_DIR = fixtureRoot;
    const futureSince = new Date(Date.now() + 60 * 60_000).toISOString();
    const r4 = await catchUp(store, CATCH_AGENT, { source: "conversation", since: futureSince });
    const r4Caught =
      r4.caught.decisions + r4.caught.task_states + r4.caught.knowledge;
    assert(r4Caught === 0, "future since yields 0 caught");
    assert(r4.skipped === 0, "future since yields 0 skipped");

    // ── Test 9 (NORMAL): getLastCatchUpLog returns most recent event ──
    const last = await store.getLastCatchUpLog(CATCH_AGENT, "conversation");
    assert(last !== null, "getLastCatchUpLog returns a row after a sweep");
    assert(last?.source === "conversation", "ledger row has source=conversation");
  } finally {
    if (prevDir === undefined) delete process.env.CLAUDE_PROJECTS_DIR;
    else process.env.CLAUDE_PROJECTS_DIR = prevDir;
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
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
    await testTaskIdUpsert();
    await testKnowledge();
    await testKnowledgeSupersede();
    await testSearchMemory();
    await testJapaneseSearch();
    await testRecoveryConfig();
    await testRecoveryQualityLog();
    await testExpireStaleTaskStates();
    await testGetRecentMessages();
    await testStripOrphanSurrogates();
    await testCatchUpSourceA();
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
