#!/usr/bin/env node
/**
 * Basic integration tests for agent-memory JSON store.
 * Run: tsx src/test.ts
 */
import { JsonStore } from "./stores/json-store.js";
import { rmSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const TEST_DIR = join(homedir(), ".agent-memory");
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

async function cleanup() {
  const files = ["decisions.json", "task-states.json", "knowledge.json", "conversation-events.json"];
  for (const f of files) {
    const path = join(TEST_DIR, f);
    if (existsSync(path)) rmSync(path);
  }
}

async function testDecisions() {
  console.log("\n── Decision Tests ──");
  const store = new JsonStore();
  await store.initialize();

  // Log a decision
  const d1 = await store.logDecision({
    agent_id: "test-agent",
    decision: "Use JWT with 7-day refresh token",
    context: "Considered session cookies vs JWT. JWT chosen for API-first design.",
    tags: ["auth", "architecture"],
    project: "hotel-app",
  });
  assert(d1.id.length > 0, "log_decision returns valid ID");
  assert(d1.status === "active", "new decision status is active");
  assert(d1.tags.length === 2, "tags preserved");

  // Log another
  const d2 = await store.logDecision({
    agent_id: "test-agent",
    decision: "PostgreSQL as primary DB",
    context: "SQLite considered but ruled out for multi-agent access.",
    tags: ["database", "architecture"],
    project: "hotel-app",
  });

  // Get decisions
  const active = await store.getDecisions({
    agent_id: "test-agent",
    project: "hotel-app",
  });
  assert(active.length === 2, "get_decisions returns 2 active decisions");
  assert(active[0].created_at >= active[1].created_at, "sorted by newest first");

  // Filter by tags
  const authDecisions = await store.getDecisions({
    agent_id: "test-agent",
    tags: ["auth"],
  });
  assert(authDecisions.length === 1, "tag filter works");
  assert(authDecisions[0].decision.includes("JWT"), "correct decision returned");

  // Supersede
  const result = await store.supersedeDecision({
    agent_id: "test-agent",
    old_decision_id: d1.id,
    new_decision: "Use session cookies with CSRF protection",
    context: "JWT refresh token flow too complex for MVP. Switching to cookies.",
    tags: ["auth", "architecture", "mvp"],
  });
  assert(result.old.status === "superseded", "old decision marked superseded");
  assert(result.old.superseded_by === result.new.id, "superseded_by linked");
  assert(result.new.status === "active", "new decision is active");

  // Verify only active decisions returned
  const afterSupersede = await store.getDecisions({
    agent_id: "test-agent",
    project: "hotel-app",
  });
  assert(afterSupersede.length === 2, "still 2 active decisions (1 superseded, 1 new + 1 original)");
  assert(
    !afterSupersede.find((d) => d.id === d1.id),
    "superseded decision not in active list"
  );

  // Get all including superseded
  const all = await store.getDecisions({
    agent_id: "test-agent",
    status: "all",
  });
  assert(all.length === 3, "all=3 including superseded");

  // Agent isolation
  const otherAgent = await store.getDecisions({
    agent_id: "other-agent",
  });
  assert(otherAgent.length === 0, "agent isolation works");

  await store.close();
}

async function testTaskStates() {
  console.log("\n── Task State Tests ──");
  const store = new JsonStore();
  await store.initialize();

  // Save task state. AM-023: a second save with the same task text now
  // collapses onto this row via hash-keyed UPSERT, so the basic CRUD
  // case below uses *distinct* task texts. The UPSERT-specific
  // behaviour gets its own test (testTaskStatesUpsert).
  const t1 = await store.saveTaskState({
    agent_id: "test-agent",
    task: "Implement auth middleware",
    status: "in_progress",
    progress: "JWT verification done, RBAC pending",
    files_modified: ["src/middleware/auth.ts", "src/types.ts"],
    next_steps: "Add role-based access control",
    project: "hotel-app",
  });
  assert(t1.id.length > 0, "save_task_state returns valid ID");
  assert(t1.status === "in_progress", "status preserved");
  assert(t1.files_modified.length === 2, "files_modified preserved");

  // Save a *different* task so we end up with two distinct rows.
  await store.saveTaskState({
    agent_id: "test-agent",
    task: "Run smoke tests",
    status: "completed",
    progress: "All passing",
    files_modified: [],
    project: "hotel-app",
  });

  // Get all task states
  const states = await store.getTaskStates({
    agent_id: "test-agent",
    status: "all",
  });
  assert(states.length === 2, "both task states returned");
  assert(states[0].status === "completed", "most recent first");

  // Filter by status
  const inProgress = await store.getTaskStates({
    agent_id: "test-agent",
    status: "in_progress",
  });
  assert(inProgress.length === 1, "status filter works");

  await store.close();
}

async function testTaskStatesUpsert() {
  console.log("\n── Task State UPSERT Tests (AM-023) ──");
  const store = new JsonStore();
  await store.initialize();

  const upsertAgent = "test-agent-upsert";

  // Explicit task_id UPSERT
  const a = await store.saveTaskState({
    agent_id: upsertAgent,
    task_id: "AM-999",
    task: "Hypothetical refactor",
    status: "in_progress",
    progress: "started",
    project: "hotel-app",
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
    project: "hotel-app",
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

  // Hash-derived collapse: same task text, no explicit task_id
  const hashAgent = "test-agent-hash";
  const h1 = await store.saveTaskState({
    agent_id: hashAgent,
    task: "Refactor logging layer",
    status: "in_progress",
    project: "hotel-app",
  });
  const h2 = await store.saveTaskState({
    agent_id: hashAgent,
    task: "Refactor logging layer",
    status: "completed",
    project: "hotel-app",
  });
  assert(h1.task_id === h2.task_id, "hash-derived task_id is stable for same text");
  assert(h1.id === h2.id, "hash-keyed UPSERT preserves row id");
  const hashAll = await store.getTaskStates({
    agent_id: hashAgent,
    status: "all",
  });
  assert(hashAll.length === 1, "hash-keyed UPSERT keeps row count at 1");

  await store.close();
}

async function testRecoverContext() {
  console.log("\n── Recover Context Tests ──");
  const store = new JsonStore();
  await store.initialize();

  // Get decisions and task states together (simulating recover_context)
  const [decisions, taskStates] = await Promise.all([
    store.getDecisions({
      agent_id: "test-agent",
      project: "hotel-app",
      limit: 10,
      status: "active",
    }),
    store.getTaskStates({
      agent_id: "test-agent",
      project: "hotel-app",
      limit: 5,
      status: "all",
    }),
  ]);

  assert(decisions.length > 0, "recover finds decisions");
  assert(taskStates.length > 0, "recover finds task states");
  assert(
    decisions.every((d) => d.status === "active"),
    "only active decisions in recovery"
  );

  await store.close();
}

async function testSearchMemory() {
  console.log("\n── Search Memory Tests ──");
  const store = new JsonStore();
  await store.initialize();

  // Setup: log some decisions and tasks
  await store.logDecision({
    agent_id: "test-agent",
    decision: "Use JWT with 7-day refresh token",
    context: "Considered session cookies vs JWT. JWT chosen for API-first design.",
    tags: ["auth", "architecture"],
    project: "hotel-app",
  });
  await store.logDecision({
    agent_id: "test-agent",
    decision: "PostgreSQL as primary database",
    context: "SQLite considered but ruled out for multi-agent access.",
    tags: ["database", "architecture"],
    project: "hotel-app",
  });
  await store.saveTaskState({
    agent_id: "test-agent",
    task: "Implement JWT authentication middleware",
    status: "completed",
    progress: "JWT verification and RBAC fully implemented",
    files_modified: ["src/middleware/auth.ts"],
    project: "hotel-app",
  });

  // Search decisions by keyword
  const authResults = await store.searchMemory({
    agent_id: "test-agent",
    query: "JWT",
  });
  assert(authResults.decisions.length >= 1, "search finds JWT decision");
  assert(authResults.task_states.length >= 1, "search finds JWT task");

  // Search with scope filter
  const decisionsOnly = await store.searchMemory({
    agent_id: "test-agent",
    query: "database",
    scope: "decisions",
  });
  assert(decisionsOnly.decisions.length >= 1, "scope=decisions finds database decision");
  assert(decisionsOnly.task_states.length === 0, "scope=decisions returns no tasks");

  const tasksOnly = await store.searchMemory({
    agent_id: "test-agent",
    query: "authentication",
    scope: "tasks",
  });
  assert(tasksOnly.task_states.length >= 1, "scope=tasks finds auth task");
  assert(tasksOnly.decisions.length === 0, "scope=tasks returns no decisions");

  // Search with project filter
  const projectResults = await store.searchMemory({
    agent_id: "test-agent",
    query: "JWT",
    project: "nonexistent-project",
  });
  assert(
    projectResults.decisions.length === 0 && projectResults.task_states.length === 0,
    "project filter excludes non-matching results"
  );

  // Agent isolation in search
  const otherAgentResults = await store.searchMemory({
    agent_id: "other-agent",
    query: "JWT",
  });
  assert(
    otherAgentResults.decisions.length === 0 && otherAgentResults.task_states.length === 0,
    "search respects agent isolation"
  );

  // No results for unrelated query
  const noResults = await store.searchMemory({
    agent_id: "test-agent",
    query: "kubernetes",
  });
  assert(
    noResults.decisions.length === 0 && noResults.task_states.length === 0,
    "no results for unrelated query"
  );

  // Limit parameter
  const limitResults = await store.searchMemory({
    agent_id: "test-agent",
    query: "architecture",
    scope: "decisions",
    limit: 1,
  });
  assert(limitResults.decisions.length <= 1, "limit parameter works");

  await store.close();
}

async function testRecoverContextBoot() {
  console.log("\n── Recover Context (Boot) Tests ──");
  const store = new JsonStore();
  await store.initialize();

  // Save an in_progress task
  await store.saveTaskState({
    agent_id: "test-agent",
    task: "Implement search feature",
    status: "in_progress",
    progress: "DB query done, API pending",
    next_steps: "Add REST endpoint",
    files_modified: ["src/search.ts"],
    project: "hotel-app",
  });

  // Save a completed task (should NOT appear in boot)
  await store.saveTaskState({
    agent_id: "test-agent",
    task: "Setup project",
    status: "completed",
    progress: "All done",
    project: "hotel-app",
  });

  // Simulate boot: only in_progress, limit 1
  const tasks = await store.getTaskStates({
    agent_id: "test-agent",
    project: "hotel-app",
    limit: 1,
    status: "in_progress",
  });
  assert(tasks.length === 1, "boot returns exactly 1 task");
  assert(tasks[0].status === "in_progress", "boot returns in_progress task only");
  assert(tasks[0].task === "Implement search feature", "boot returns correct task");

  await store.close();
}

async function testJapaneseSearchJson() {
  console.log("\n── Japanese Search Tests (JsonStore) ──");
  const store = new JsonStore();
  await store.initialize();

  // Log Japanese decision
  await store.logDecision({
    agent_id: "test-agent",
    decision: "認証方式をJWTに決定",
    context: "セッションCookieも検討したが、API設計の一貫性を優先",
    tags: ["認証", "アーキテクチャ"],
    project: "hotel-app",
  });

  // Save Japanese task
  await store.saveTaskState({
    agent_id: "test-agent",
    task: "認証ミドルウェアの実装",
    status: "in_progress",
    progress: "JWT検証完了、RBAC未実装",
    next_steps: "ロールベースアクセス制御を追加",
    project: "hotel-app",
  });

  // Search with Japanese keyword
  const authResults = await store.searchMemory({
    agent_id: "test-agent",
    query: "認証",
  });
  assert(authResults.decisions.length >= 1, "Japanese search finds 認証 decision");
  assert(authResults.task_states.length >= 1, "Japanese search finds 認証 task");

  // Mixed Japanese/English
  const mixedResults = await store.searchMemory({
    agent_id: "test-agent",
    query: "JWT認証",
  });
  assert(mixedResults.decisions.length >= 1, "mixed JP/EN search works");

  // Japanese tag in search text
  const tagResults = await store.searchMemory({
    agent_id: "test-agent",
    query: "アーキテクチャ",
    scope: "decisions",
  });
  assert(tagResults.decisions.length >= 1, "Japanese tag search works");

  // Partial Japanese keyword
  const partialResults = await store.searchMemory({
    agent_id: "test-agent",
    query: "ミドルウェア",
    scope: "tasks",
  });
  assert(partialResults.task_states.length >= 1, "partial Japanese keyword works");

  await store.close();
}

async function testEmptyDbBoot() {
  console.log("\n── Empty DB Boot Test ──");
  // Simulate boot.ts with no data
  const store = new JsonStore();
  await store.initialize();

  const tasks = await store.getTaskStates({
    agent_id: "fresh-agent-never-used",
    limit: 1,
    status: "in_progress",
  });
  assert(tasks.length === 0, "empty DB returns 0 tasks without error");

  // Simulate the boot output format
  const parts: string[] = [];
  parts.push(`⚡ SESSION BOOT — agent-memory (fresh-agent)`);
  parts.push("");
  if (tasks.length > 0) {
    parts.push("── CURRENT WORK ──");
  } else {
    parts.push("No in-progress tasks.");
  }
  parts.push("");
  parts.push("Use search_memory to find past decisions when needed.");
  const output = parts.join("\n");
  assert(output.includes("No in-progress tasks."), "boot output shows no tasks message");
  assert(!output.includes("CURRENT WORK"), "boot output omits CURRENT WORK section");

  await store.close();
}

async function testKnowledgeCRUD() {
  console.log("\n── Knowledge CRUD Tests (JsonStore) ──");
  const store = new JsonStore();
  await store.initialize();

  const KA = "knowledge-crud-agent";

  // Save knowledge
  const k1 = await store.saveKnowledge({
    agent_id: KA,
    title: "hotel-kanri DB設計方針",
    content: "PostgreSQLを採用。理由はagent-comと共有可能なため。",
    source_type: "decisions",
    source_ids: ["uuid-1", "uuid-2"],
    tags: ["postgresql", "hotel-kanri", "database"],
    project: "hotel-app",
  });
  assert(k1.id.length > 0, "saveKnowledge returns valid ID");
  assert(k1.status === "active", "new knowledge is active");
  assert(k1.tags.length === 3, "tags preserved");
  assert(k1.source_ids.length === 2, "source_ids preserved");

  // Save another
  await store.saveKnowledge({
    agent_id: KA,
    title: "認証方式の決定経緯",
    content: "JWTを採用。セッションCookieも検討したがAPI設計の一貫性を優先。",
    source_type: "decisions",
    tags: ["auth", "jwt"],
    project: "hotel-app",
  });

  // Get knowledge
  const all = await store.getKnowledge({
    agent_id: KA,
    project: "hotel-app",
  });
  assert(all.length === 2, "getKnowledge returns 2 entries");
  assert(all[0].updated_at >= all[1].updated_at, "sorted by newest first");

  // Filter by tags
  const dbKnowledge = await store.getKnowledge({
    agent_id: KA,
    tags: ["database"],
  });
  assert(dbKnowledge.length === 1, "tag filter works");
  assert(dbKnowledge[0].title.includes("DB設計"), "correct knowledge returned");

  // Agent isolation
  const other = await store.getKnowledge({ agent_id: "other-agent" });
  assert(other.length === 0, "agent isolation works");

  await store.close();
}

async function testKnowledgeSearch() {
  console.log("\n── Knowledge Search Tests (JsonStore) ──");
  const store = new JsonStore();
  await store.initialize();

  const KA = "knowledge-crud-agent";

  // Search knowledge by keyword
  const dbResults = await store.searchMemory({
    agent_id: KA,
    query: "PostgreSQL",
    scope: "knowledge",
  });
  assert(dbResults.knowledge.length >= 1, "search finds PostgreSQL knowledge");
  assert(dbResults.decisions.length === 0, "scope=knowledge returns no decisions");

  // Search all scopes
  const allResults = await store.searchMemory({
    agent_id: KA,
    query: "認証",
  });
  assert(allResults.knowledge.length >= 1, "all-scope search finds knowledge");

  // Japanese knowledge search
  const jpResults = await store.searchMemory({
    agent_id: KA,
    query: "DB設計",
    scope: "knowledge",
  });
  assert(jpResults.knowledge.length >= 1, "Japanese knowledge search works");

  // Agent isolation in search
  const otherResults = await store.searchMemory({
    agent_id: "other-agent",
    query: "PostgreSQL",
    scope: "knowledge",
  });
  assert(otherResults.knowledge.length === 0, "knowledge search respects agent isolation");

  await store.close();
}

async function testKnowledgeSupersede() {
  console.log("\n── Knowledge Supersede Tests (JsonStore) ──");
  const store = new JsonStore();
  await store.initialize();

  const KA = "knowledge-supersede-agent";

  // 1. Normal supersede
  const old = await store.saveKnowledge({
    agent_id: KA,
    title: "PG より SQLite が軽い",
    content: "SQLite は軽量で手軽に使える。",
    source_type: "manual",
    tags: ["database"],
    project: "test-project",
  });
  const result = await store.supersedeKnowledge({
    agent_id: KA,
    old_id: old.id,
    new_title: "PG の方がスケールする",
    new_content: "長期的には PostgreSQL が適切。スケール・機能ともに優位。",
    reason: "実運用で SQLite の限界が明らかになった",
    project: "test-project",
  });
  assert(result.old.status === "superseded", "old knowledge marked superseded");
  assert(result.new.supersedes === old.id, "new knowledge points to old id");
  assert(result.new.supersede_reason === "実運用で SQLite の限界が明らかになった", "supersede_reason preserved");
  assert(result.new.status === "active", "new knowledge is active");

  // 2. Session Boot excludes superseded
  const active = await store.getKnowledge({ agent_id: KA, status: "active" });
  assert(!active.find((k) => k.id === old.id), "superseded knowledge excluded from active list");
  assert(active.find((k) => k.id === result.new.id) !== undefined, "new knowledge in active list");

  // 3. Not found error
  let notFoundErr: Error | null = null;
  try {
    await store.supersedeKnowledge({
      agent_id: KA,
      old_id: "00000000-0000-0000-0000-000000000000",
      new_title: "x",
      new_content: "x",
      reason: "x",
    });
  } catch (err) {
    notFoundErr = err as Error;
  }
  assert(notFoundErr !== null, "throws on non-existent old_id");
  assert(notFoundErr!.message.includes("Knowledge not found"), "error message correct");

  // 4. Agent isolation
  let isoErr: Error | null = null;
  try {
    await store.supersedeKnowledge({
      agent_id: "other-agent",
      old_id: old.id,
      new_title: "x",
      new_content: "x",
      reason: "x",
    });
  } catch (err) {
    isoErr = err as Error;
  }
  assert(isoErr !== null, "agent isolation: cannot supersede another agent's knowledge");

  await store.close();
}

/**
 * AM-024 follow-up (#66 item 1): the JsonStore has no transactions,
 * so `supersedeKnowledge` mutates the in-memory arrays before
 * persisting them. If `saveKnowledgeFile` throws (disk full /
 * permission glitch / fs error), we have to roll the in-memory
 * mutation back so the next call observes a consistent snapshot.
 *
 * This test injects a synthetic persist failure by monkey-patching
 * the (private) `saveKnowledgeFile` method, drives `supersedeKnowledge`
 * through the failure path, and asserts:
 *
 *   1. the call rejects with the injected error
 *   2. the old item's status is still `active` (rollback)
 *   3. the new item is NOT in the in-memory active list (popped)
 *   4. a fresh `supersedeKnowledge` after restoring the persist
 *      method completes successfully — i.e. the rollback left
 *      the store in a re-runnable state, not a poisoned one.
 */
async function testKnowledgeSupersedeRollback() {
  console.log("\n── Knowledge Supersede Rollback (#66 item 1) ──");
  const store = new JsonStore();
  await store.initialize();

  const KA = "knowledge-supersede-rollback-agent";

  const original = await store.saveKnowledge({
    agent_id: KA,
    title: "rollback fixture",
    content: "this row will be the supersede target",
    source_type: "manual",
  });
  assert(original.status === "active", "fixture knowledge starts active");

  const beforeCount = (
    await store.getKnowledge({ agent_id: KA, status: "all" })
  ).length;

  // Inject a synthetic persist failure on the next saveKnowledgeFile
  // call. We restore the original implementation immediately after
  // the supersede call so subsequent assertions can use the store
  // normally.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const injected = new Error("INJECTED: simulated disk write failure");
  const storeAny = store as any;
  const realPersist = storeAny.saveKnowledgeFile.bind(store);
  let persistCalls = 0;
  storeAny.saveKnowledgeFile = async () => {
    persistCalls++;
    throw injected;
  };

  let caught: Error | null = null;
  try {
    await store.supersedeKnowledge({
      agent_id: KA,
      old_id: original.id,
      new_title: "would supersede",
      new_content: "this insert must be rolled back when persist fails",
      reason: "rollback path test",
    });
  } catch (err) {
    caught = err as Error;
  } finally {
    storeAny.saveKnowledgeFile = realPersist;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  assert(caught !== null, "supersedeKnowledge rejects when persist fails");
  assert(
    caught?.message === injected.message,
    "the rejection propagates the underlying persist error"
  );
  assert(persistCalls === 1, "saveKnowledgeFile was attempted exactly once");

  // The old item must still be active — rollback restored its status.
  const allAfterFailure = await store.getKnowledge({ agent_id: KA, status: "all" });
  const oldAfter = allAfterFailure.find((k) => k.id === original.id);
  assert(oldAfter !== undefined, "old item still present");
  assert(
    oldAfter?.status === "active",
    "old item.status reverted from 'superseded' back to 'active'"
  );

  // The new item must not be in the in-memory list — `pop()` removed it.
  assert(
    allAfterFailure.length === beforeCount,
    "knowledge count unchanged after rollback (new item was popped)"
  );
  const anySupersedeRef = allAfterFailure.find((k) => k.supersedes === original.id);
  assert(
    anySupersedeRef === undefined,
    "no knowledge entry references the rolled-back supersede"
  );

  // After restoring the persist method, supersede must work again —
  // proves the rollback left the store re-runnable, not poisoned.
  const retry = await store.supersedeKnowledge({
    agent_id: KA,
    old_id: original.id,
    new_title: "now succeeds after restore",
    new_content: "second attempt with the real persist",
    reason: "verify state is not poisoned after rollback",
  });
  assert(retry.old.status === "superseded", "retry marks old as superseded");
  assert(retry.new.supersedes === original.id, "retry's new entry points at the original");

  await store.close();
}

async function testErrorHandling() {
  console.log("\n── Error Handling Tests ──");
  const store = new JsonStore();
  await store.initialize();

  // Supersede non-existent decision
  try {
    await store.supersedeDecision({
      agent_id: "test-agent",
      old_decision_id: "non-existent-uuid",
      new_decision: "something",
    });
    assert(false, "should throw for non-existent decision");
  } catch (err) {
    assert(true, "throws for non-existent decision");
  }

  // Supersede with wrong agent
  const d = await store.logDecision({
    agent_id: "agent-a",
    decision: "test decision",
  });
  try {
    await store.supersedeDecision({
      agent_id: "agent-b",
      old_decision_id: d.id,
      new_decision: "hijacked",
    });
    assert(false, "should throw for wrong agent");
  } catch {
    assert(true, "agent isolation in supersede works");
  }

  await store.close();
}

async function testConversationEvents() {
  console.log("\n── Conversation Event Tests (JsonStore) ──");
  const store = new JsonStore();
  await store.initialize();

  const first = await store.saveConversationEvent({
    agent_id: "test-agent",
    project: "hotel-app",
    source: "codex",
    source_event_id: "codex-event-1",
    role: "assistant",
    content: "We should continue AM-031 from the raw event storage PR.",
    metadata: { file: "src/stores/types.ts" },
    occurred_at: "2026-05-19T00:00:00.000Z",
  });
  const duplicate = await store.saveConversationEvent({
    agent_id: "test-agent",
    project: "hotel-app",
    source: "codex",
    source_event_id: "codex-event-1",
    role: "assistant",
    content: "We should continue AM-031 from the raw event storage PR.",
    occurred_at: "2026-05-19T00:00:00.000Z",
  });
  await store.saveConversationEvent({
    agent_id: "test-agent",
    project: "hotel-app",
    source: "claude_code",
    source_event_id: "claude-event-1",
    role: "user",
    content: "Session restart should recover the active task.",
    occurred_at: "2026-05-19T00:01:00.000Z",
  });

  assert(first.id === duplicate.id, "source_event_id deduplicates raw events");
  const all = await store.getConversationEvents({ agent_id: "test-agent" });
  assert(all.length === 2, "getConversationEvents returns unique raw events");
  assert(all[0].source === "claude_code", "events sorted newest first");
  const codexOnly = await store.getConversationEvents({ agent_id: "test-agent", source: "codex" });
  assert(codexOnly.length === 1, "source filter works");
  assert(codexOnly[0].metadata.file === "src/stores/types.ts", "metadata round-trips");

  await store.close();
}

// Run all tests
async function run() {
  console.log("agent-memory test suite\n");
  await cleanup();

  await testDecisions();
  await testTaskStates();
  await testTaskStatesUpsert();
  await testRecoverContext();
  await testSearchMemory();
  await testJapaneseSearchJson();
  await testRecoverContextBoot();
  await testEmptyDbBoot();
  await testKnowledgeCRUD();
  await testKnowledgeSearch();
  await testKnowledgeSupersede();
  await testKnowledgeSupersedeRollback();
  await testErrorHandling();
  await testConversationEvents();

  await cleanup();

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
