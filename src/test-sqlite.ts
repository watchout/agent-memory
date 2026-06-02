#!/usr/bin/env node
/**
 * Integration tests for agent-memory SqliteStore.
 * Run: tsx src/test-sqlite.ts
 *
 * Uses a temporary DB file in the OS temp dir for isolation.
 */
import { SqliteStore } from "./stores/sqlite-store.js";
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { stripOrphanSurrogates } from "./sanitize.js";
import { ingestClaudeConversationEvents } from "./claude-conversation-ingest.js";
import { ingestCodexConversationEvents } from "./codex-conversation-ingest.js";

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

async function testConversationEvents() {
  console.log("\n── SqliteStore Conversation Events ──");

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
    session_id: "sqlite-session-raw-1",
    project: PROJECT,
    source: "manual",
    source_event_id: "sqlite-manual-raw-1",
    event_type: "host_event",
    content: "SQLite host observed prepare band.",
    metadata: { band: "prepare" },
    occurred_at: "2026-05-19T00:03:00.000Z",
  });
  const duplicateManualRaw = await store.saveRawEvent({
    agent_id: AGENT,
    session_id: "sqlite-session-raw-1",
    project: PROJECT,
    source: "manual",
    source_event_id: "sqlite-manual-raw-1",
    event_type: "host_event",
    content: "SQLite host observed prepare band.",
    occurred_at: "2026-05-19T00:03:00.000Z",
  });
  assert(manualRaw.id === duplicateManualRaw.id, "raw_events deduplicate by source_event_id");
  const sessionRaw = await store.getRawEvents({ agent_id: AGENT, session_id: "sqlite-session-raw-1" });
  assert(sessionRaw.length === 1 && sessionRaw[0].metadata.band === "prepare", "raw_events filters by session_id");
  const codexOnly = await store.getConversationEvents({ agent_id: AGENT, source: "codex" });
  assert(codexOnly.length === 1, "source filter works");
  assert(codexOnly[0].metadata.tool === "codex", "metadata round-trips");
}

async function testSelectedRestartPacks() {
  console.log("\n── SqliteStore Selected Restart Packs ──");

  const saved = await store.saveSelectedRestartPack({
    agent_id: AGENT,
    project: PROJECT,
    content: "SESSION RESTART PACK\nContinue AM-039.",
    metadata: { action: "pack_update_needed" },
  });
  assert(saved.pack_ref.startsWith("selected_restart_pack:"), "selected restart pack has stable ref prefix");
  assert(saved.content_hash.length === 64, "selected restart pack has sha256 content hash");

  const fetched = await store.getSelectedRestartPack({ agent_id: AGENT, project: PROJECT, pack_ref: saved.pack_ref });
  assert(fetched?.content.includes("AM-039") === true, "selected restart pack can be fetched");
  assert(fetched?.metadata.action === "pack_update_needed", "selected restart pack metadata round-trips");

  const consumed = await store.consumeSelectedRestartPack({ agent_id: AGENT, project: PROJECT, pack_ref: saved.pack_ref });
  assert(consumed?.status === "consumed", "selected restart pack can be consumed");

  const afterConsume = await store.getSelectedRestartPack({ agent_id: AGENT, project: PROJECT, pack_ref: saved.pack_ref });
  assert(afterConsume === null, "consumed selected restart pack is no longer active");

  const concurrent = await store.saveSelectedRestartPack({
    agent_id: AGENT,
    project: PROJECT,
    content: "SESSION RESTART PACK\nConcurrent consume canary.",
  });
  const [firstConsume, secondConsume] = await Promise.all([
    store.consumeSelectedRestartPack({ agent_id: AGENT, project: PROJECT, pack_ref: concurrent.pack_ref }),
    store.consumeSelectedRestartPack({ agent_id: AGENT, project: PROJECT, pack_ref: concurrent.pack_ref }),
  ]);
  const consumedCount = [firstConsume, secondConsume].filter((item) => item !== null).length;
  assert(consumedCount === 1, "concurrent selected restart pack consume is single-use");
}

async function testClaudeConversationIngest() {
  console.log("\n── SqliteStore Claude Conversation Ingest ──");

  const root = mkdtempSync(join(tmpdir(), "am031-sqlite-claude-ingest-"));
  const projectDir = join(root, "project-a");
  mkdirSync(projectDir, { recursive: true });
  const logPath = join(projectDir, "session-sqlite.jsonl");
  const home = homedir();
  writeFileSync(
    logPath,
    [
      JSON.stringify({
        type: "user",
        timestamp: "2026-05-19T00:00:00.000Z",
        sessionId: "session-sqlite",
        message: { content: `DATABASE_URL=postgres://user:pass@localhost/db ${home}/Developer/agent-memory xoxp-123456789012-abcdefghijkl https://discord.com/api/webhooks/123456/secret-token` },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-05-19T00:01:00.000Z",
        sessionId: "session-sqlite",
        message: { content: [{ type: "text", text: "Persist this Claude event." }] },
      }),
    ].join("\n") + "\n"
  );

  const agentId = `${AGENT}-claude-ingest`;
  const first = await ingestClaudeConversationEvents(store, agentId, {
    project: PROJECT,
    root,
    since: "2026-05-18T00:00:00.000Z",
  });
  const second = await ingestClaudeConversationEvents(store, agentId, {
    project: PROJECT,
    root,
    since: "2026-05-18T00:00:00.000Z",
  });

  assert(first.events_saved === 2, "ingest saves SQLite redacted events");
  assert(second.events_duplicate === 2, "ingest is idempotent in SQLite");
  const events = await store.getConversationEvents({ agent_id: agentId, source: "claude_code" });
  assert(events.length === 2, "SQLite stores unique Claude events");
  const combined = events.map((e) => e.content).join("\n");
  assert(!combined.includes("postgres://user:pass"), "DATABASE_URL redacted");
  assert(!combined.includes("xoxp-"), "Slack token redacted in SQLite ingest");
  assert(!combined.includes("discord.com/api/webhooks"), "Discord webhook URL redacted in SQLite ingest");
  assert(combined.includes("~/Developer/agent-memory"), "home path normalized in SQLite ingest");

  rmSync(root, { recursive: true, force: true });
}

async function testCodexConversationIngest() {
  console.log("\n── SqliteStore Codex Conversation Ingest ──");

  const root = mkdtempSync(join(tmpdir(), "am031-sqlite-codex-ingest-"));
  const sessionDir = join(root, "2026", "05", "19");
  mkdirSync(sessionDir, { recursive: true });
  const logPath = join(sessionDir, "rollout-session-codex.jsonl");
  const home = homedir();
  writeFileSync(
    logPath,
    [
      JSON.stringify({
        timestamp: "2026-05-19T00:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "session-sqlite-codex",
          cwd: `${home}/Developer/agent-memory`,
          base_instructions: { text: "DO NOT STORE" },
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-19T00:01:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "github_pat_abcdefghijklmnopqrstuvwxyz1234567890" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-19T00:02:00.000Z",
        type: "response_item",
        payload: { type: "thinking", text: "DO NOT STORE THINKING" },
      }),
      JSON.stringify({
        timestamp: "2026-05-19T00:03:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-sqlite",
          output: {
            text: "safe",
            reasoning_trace: "DO NOT STORE OUTPUT REASONING",
            base_instructions: { text: "DO NOT STORE OUTPUT BASE" },
          },
        },
      }),
    ].join("\n") + "\n"
  );

  const agentId = `${AGENT}-codex-ingest`;
  const first = await ingestCodexConversationEvents(store, agentId, {
    project: PROJECT,
    root,
    since: "2026-05-18T00:00:00.000Z",
  });
  const second = await ingestCodexConversationEvents(store, agentId, {
    project: PROJECT,
    root,
    since: "2026-05-18T00:00:00.000Z",
  });

  assert(first.events_saved === 3, "Codex ingest saves SQLite redacted events");
  assert(first.events_skipped === 1, "Codex ingest skips reasoning in SQLite");
  assert(second.events_duplicate === 3, "Codex ingest is idempotent in SQLite");
  const events = await store.getConversationEvents({ agent_id: agentId, source: "codex" });
  const combined = events.map((e) => e.content).join("\n");
  assert(!combined.includes("DO NOT STORE"), "Codex base/reasoning/thinking content excluded");
  assert(!combined.includes("github_pat_"), "GitHub PAT redacted in Codex ingest");

  rmSync(root, { recursive: true, force: true });
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
    await testConversationEvents();
    await testSelectedRestartPacks();
    await testClaudeConversationIngest();
    await testCodexConversationIngest();
    await testStripOrphanSurrogates();
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
