#!/usr/bin/env node
/**
 * Basic integration tests for agent-memory JSON store.
 * Run: tsx src/test.ts
 */
import { JsonStore } from "./stores/json-store.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { homedir, tmpdir } from "os";
import { ingestClaudeConversationEvents } from "./claude-conversation-ingest.js";
import { ingestCodexConversationEvents } from "./codex-conversation-ingest.js";
import { buildRestartPack, generateRestartPack } from "./restart-pack.js";
import { redactText } from "./redact.js";
import {
  CODEX_STARTUP_BRIDGE_ENV,
  buildCodexLaunchArgs,
  buildCodexLaunchEnv,
  buildCodexStartupPrompt,
  isMainEntrypoint,
  logCodexStartupQuality,
  parseArgs,
} from "./codex-start.js";
import type { LogRecoveryQualityInput } from "./stores/types.js";

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
  await store.saveConversationEvent({
    agent_id: "test-agent",
    project: "hotel-app",
    source: "codex",
    source_event_id: "codex-token-count-noise",
    role: "event",
    content: '{"type":"token_count","info":{"note":"restart"}}',
    occurred_at: "2026-05-19T00:02:00.000Z",
  });

  assert(first.id === duplicate.id, "source_event_id deduplicates raw events");
  const all = await store.getConversationEvents({ agent_id: "test-agent" });
  assert(all.length === 3, "getConversationEvents returns unique raw events");
  assert(all[0].source_event_id === "codex-token-count-noise", "events sorted newest first");
  const codexOnly = await store.getConversationEvents({ agent_id: "test-agent", source: "codex" });
  assert(codexOnly.length === 2, "source filter works");
  assert(codexOnly.some((event) => event.metadata.file === "src/stores/types.ts"), "metadata round-trips");
  const search = await store.searchMemory({
    agent_id: "test-agent",
    project: "hotel-app",
    query: "restart",
    scope: "conversation",
  });
  assert(search.conversation_events.length >= 1, "search finds conversation event");
  assert(search.decisions.length === 0 && search.task_states.length === 0, "scope=conversation excludes structured memory");
  assert(search.conversation_events[0].source_event_id !== "codex-token-count-noise", "conversation search ranks content above token_count noise");

  await store.close();
}

function testRedaction() {
  console.log("\n── Redaction Tests ──");
  const compound = redactText("secret sk-test-AKIAIOSFODNN7EXAMPLE");
  assert(!compound.text.includes("sk-test"), "compound secret redacts sk-test prefix");
  assert(!compound.text.includes("sk-"), "compound secret redacts sk- prefix");
  assert(!compound.text.includes("AKIAIOSFODNN7EXAMPLE"), "compound secret redacts AWS suffix");

  const standalone = redactText("aws AKIAIOSFODNN7EXAMPLE openai sk-abcdefghijklmnopqrstuvwxyz123456");
  assert(!standalone.text.includes("AKIAIOSFODNN7EXAMPLE"), "standalone AWS key redacted");
  assert(!standalone.text.includes("sk-abcdefghijklmnopqrstuvwxyz123456"), "standalone OpenAI-style key redacted");
}

async function testClaudeConversationIngest() {
  console.log("\n── Claude Conversation Ingest Tests (JsonStore) ──");
  const store = new JsonStore();
  await store.initialize();

  const root = mkdtempSync(join(tmpdir(), "am031-claude-ingest-"));
  const projectDir = join(root, "project-a");
  mkdirSync(projectDir, { recursive: true });
  const logPath = join(projectDir, "session-abc.jsonl");
  const home = homedir();
  const lines = [
    JSON.stringify({
      type: "user",
      timestamp: "2026-05-19T00:00:00.000Z",
      sessionId: "session-abc",
      cwd: `${home}/Developer/agent-memory`,
      message: {
        content:
          `Please continue. TOKEN=gho_abcdefghijklmnopqrstuvwxyz123456 email dev@example.com path ${home}/Developer/agent-memory/src/index.ts ` +
          "slack xoxb-123456789012-abcdefghijk AWS AKIAIOSFODNN7EXAMPLE google AIzaSyA123456789012345678901234567890123 webhook https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXXXXXXXXXX",
      },
    }),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-05-19T00:01:00.000Z",
      sessionId: "session-abc",
      message: {
        content: [{ type: "text", text: "Continuing AM-031 PR B from raw Claude ingest." }],
      },
    }),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-05-19T00:02:00.000Z",
      sessionId: "session-abc",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Write",
            input: { file_path: `${home}/Developer/agent-memory/src/claude-conversation-ingest.ts` },
          },
        ],
      },
    }),
    JSON.stringify({
      type: "summary",
      timestamp: "2026-05-19T00:03:00.000Z",
      sessionId: "session-abc",
      summary: "Session summarized before restart.",
    }),
    "{not-json",
  ];
  writeFileSync(logPath, lines.join("\n") + "\n");

  const agentId = "test-claude-ingest-agent";
  const first = await ingestClaudeConversationEvents(store, agentId, {
    project: "hotel-app",
    root,
    since: "2026-05-18T00:00:00.000Z",
  });
  const second = await ingestClaudeConversationEvents(store, agentId, {
    project: "hotel-app",
    root,
    since: "2026-05-18T00:00:00.000Z",
  });

  assert(first.files_scanned === 1, "ingest scans fixture file");
  assert(first.events_saved === 4, "ingest saves four valid raw events");
  assert(first.events_skipped === 1, "ingest skips malformed line");
  assert(second.events_saved === 0, "second ingest saves no duplicates");
  assert(second.events_duplicate === 4, "second ingest reports duplicates");

  const events = await store.getConversationEvents({ agent_id: agentId, source: "claude_code" });
  assert(events.length === 4, "stored Claude events are unique");
  assert(events.every((e) => e.source === "claude_code"), "events use claude_code source");
  assert(events.some((e) => e.role === "user"), "user role mapped");
  assert(events.some((e) => e.role === "assistant"), "assistant role mapped");
  assert(events.some((e) => e.role === "event"), "summary/event role mapped");
  const combined = events.map((e) => e.content).join("\n");
  assert(!combined.includes("gho_"), "GitHub token redacted before persistence");
  assert(!combined.includes("xoxb-"), "Slack token redacted before persistence");
  assert(!combined.includes("AKIAIOSFODNN7EXAMPLE"), "AWS access key redacted before persistence");
  assert(!combined.includes("AIza"), "Google API key redacted before persistence");
  assert(!combined.includes("hooks.slack.com/services"), "webhook URL redacted before persistence");
  assert(!combined.includes("dev@example.com"), "email redacted before persistence");
  assert(combined.includes("~/Developer/agent-memory"), "home path normalized to ~");
  assert(events.some((e) => e.metadata.redaction_version === "am031-redaction-v1"), "redaction version recorded");

  rmSync(root, { recursive: true, force: true });
  await store.close();
}

async function testCodexConversationIngest() {
  console.log("\n── Codex Conversation Ingest Tests (JsonStore) ──");
  const store = new JsonStore();
  await store.initialize();

  const root = mkdtempSync(join(tmpdir(), "am031-codex-ingest-"));
  const sessionDir = join(root, "2026", "05", "19");
  mkdirSync(sessionDir, { recursive: true });
  const logPath = join(sessionDir, "rollout-2026-05-19T00-00-00-session-codex.jsonl");
  const home = homedir();
  const lines = [
    JSON.stringify({
      timestamp: "2026-05-19T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "session-codex",
        cwd: `${home}/Developer/agent-memory`,
        cli_version: "0.120.0",
        model_provider: "openai",
        model: "gpt-5",
        base_instructions: { text: "DO NOT PERSIST BASE INSTRUCTIONS" },
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-19T00:01:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `Continue Codex adapter. API_KEY=sk-abcdefghijklmnopqrstuvwxyz ${home}/Developer/agent-memory/src/index.ts` }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-19T00:02:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Implementing Codex raw ingest." }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-19T00:03:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "DO NOT PERSIST DEVELOPER BODY" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-19T00:04:00.000Z",
      type: "response_item",
      payload: { type: "reasoning", summary: "DO NOT PERSIST REASONING" },
    }),
    JSON.stringify({
      timestamp: "2026-05-19T00:05:00.000Z",
      type: "response_item",
      payload: { type: "function_call", call_id: "call-1", name: "shell", arguments: { cmd: "npm test" } },
    }),
    JSON.stringify({
      timestamp: "2026-05-19T00:05:30.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        call_id: "call-2",
        name: "shell",
        arguments: {
          cmd: "echo safe",
          base_instructions: { text: "DO NOT PERSIST FUNCTION ARG BASE" },
          thinking_trace: "DO NOT PERSIST FUNCTION ARG THINKING",
        },
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-19T00:05:45.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-2",
        output: {
          text: "safe output",
          thought_summary: "DO NOT PERSIST FUNCTION OUTPUT THOUGHT",
          base_instructions: { text: "DO NOT PERSIST FUNCTION OUTPUT BASE" },
        },
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-19T00:06:00.000Z",
      type: "event_msg",
      payload: { type: "task_started", turn_id: "turn-1", model_context_window: 258400 },
    }),
    "{not-json",
  ];
  writeFileSync(logPath, lines.join("\n") + "\n");

  const agentId = "test-codex-ingest-agent";
  const first = await ingestCodexConversationEvents(store, agentId, {
    project: "hotel-app",
    root,
    since: "2026-05-18T00:00:00.000Z",
  });
  const second = await ingestCodexConversationEvents(store, agentId, {
    project: "hotel-app",
    root,
    since: "2026-05-18T00:00:00.000Z",
  });

  assert(first.files_scanned === 1, "Codex ingest scans YYYY/MM/DD fixture file");
  assert(first.events_saved === 7, "Codex ingest saves visible raw events");
  assert(first.events_skipped === 3, "Codex ingest skips developer/reasoning/malformed records");
  assert(second.events_saved === 0, "Codex second ingest saves no duplicates");
  assert(second.events_duplicate === 7, "Codex second ingest reports duplicates");

  const events = await store.getConversationEvents({ agent_id: agentId, source: "codex" });
  assert(events.length === 7, "stored Codex events are unique");
  assert(events.some((e) => e.role === "user"), "Codex user role mapped");
  assert(events.some((e) => e.role === "assistant"), "Codex assistant role mapped");
  assert(events.some((e) => e.role === "tool"), "Codex tool role mapped");
  assert(events.some((e) => e.role === "system"), "Codex session_meta role mapped");
  const combined = events.map((e) => e.content).join("\n");
  assert(!combined.includes("DO NOT PERSIST BASE INSTRUCTIONS"), "base instructions excluded");
  assert(!combined.includes("DO NOT PERSIST DEVELOPER BODY"), "developer body excluded");
  assert(!combined.includes("DO NOT PERSIST REASONING"), "reasoning trace excluded");
  assert(!combined.includes("DO NOT PERSIST FUNCTION ARG BASE"), "function_call base instructions stripped");
  assert(!combined.includes("DO NOT PERSIST FUNCTION ARG THINKING"), "function_call thinking stripped");
  assert(!combined.includes("DO NOT PERSIST FUNCTION OUTPUT THOUGHT"), "function_call_output thought stripped");
  assert(!combined.includes("DO NOT PERSIST FUNCTION OUTPUT BASE"), "function_call_output base instructions stripped");
  assert(!combined.includes("sk-"), "OpenAI-style key redacted");
  assert(combined.includes("~/Developer/agent-memory"), "Codex home path normalized");
  assert(events.some((e) => e.metadata.cli_version === "0.120.0"), "Codex metadata includes cli_version");

  rmSync(root, { recursive: true, force: true });
  await store.close();
}

async function testRestartPack() {
  console.log("\n── Restart Pack Tests (JsonStore) ──");
  const store = new JsonStore();
  await store.initialize();
  const agentId = "test-restart-pack-agent";
  const project = "hotel-app";
  const home = homedir();

  await store.saveTaskState({
    agent_id: agentId,
    project,
    task: "AM-031 implement restart_pack PR #84 and issue #12",
    status: "in_progress",
    progress: "PR #83 is ready; PR D is in progress",
    files_modified: [`${home}/Developer/agent-memory/src/restart-pack.ts`],
    next_steps: "Open PR D and verify restart output",
  });
  await store.saveTaskState({
    agent_id: agentId,
    project,
    task: "AM-031 resolve blocked validation item",
    status: "blocked",
    progress: "Needs CEO validation after one cycle",
  });
  await store.logDecision({
    agent_id: agentId,
    project,
    decision: "restart_pack remains opt-in during PR D",
    context: "CEO decision for AM-031",
  });
  await store.logDecision({
    agent_id: agentId,
    project,
    decision: "AM-026 catch_up uses per-event ledger",
    context: "Older unrelated catch-up work",
  });
  await store.saveKnowledge({
    agent_id: agentId,
    project,
    title: "Codex transcript source",
    content: "~/.codex/sessions/YYYY/MM/DD/*.jsonl is canonical; history.jsonl is not.",
    source_type: "manual",
  });
  await store.saveKnowledge({
    agent_id: agentId,
    project,
    title: "AM-026 catch-up source",
    content: "Older unrelated catch-up notes should not dominate a restart pack.",
    source_type: "manual",
  });
  await store.saveKnowledge({
    agent_id: agentId,
    project,
    title: "AM-031 safety fixture",
    content: "Do not leak sk-test-AKIAIOSFODNN7EXAMPLE through restart_pack output.",
    source_type: "manual",
    tags: ["AM-031", "security"],
  });
  await store.saveConversationEvent({
    agent_id: agentId,
    project,
    source: "codex",
    source_event_id: "codex-session:1",
    role: "assistant",
    content: "Continue PR D with restart_pack tests and docs.",
    occurred_at: "2026-05-19T00:01:00.000Z",
  });
  await store.saveConversationEvent({
    agent_id: agentId,
    project,
    source: "claude_code",
    source_event_id: "claude-session:1",
    role: "user",
    content: "Session refresh should continue from memory.",
    occurred_at: "2026-05-19T00:00:00.000Z",
  });
  await store.saveConversationEvent({
    agent_id: agentId,
    project,
    source: "manual",
    source_event_id: "manual-unsafe:1",
    role: "user",
    content: `raw leak sk-abcdefghijklmnopqrstuvwxyz dev@example.com ${home}/Developer/agent-memory/private.txt`,
    occurred_at: "2026-05-19T00:02:00.000Z",
  });

  const output = await generateRestartPack(store, {
    agent_id: agentId,
    project,
    max_tokens: 1500,
  });
  assert(output.includes("SESSION RESTART PACK"), "restart_pack has header");
  assert(output.includes("CURRENT OBJECTIVE"), "restart_pack includes objective");
  assert(output.includes("NEXT CONCRETE ACTION"), "restart_pack includes next action");
  assert(output.includes("BLOCKERS / NEEDS INFO"), "restart_pack includes blockers");
  assert(output.includes("RECOVERY CONTROL"), "restart_pack includes adaptive recovery control section");
  assert(output.includes("Before architectural/design decisions"), "restart_pack tells agents when to search memory");
  assert(output.includes("scope=conversation"), "restart_pack tells agents to use conversation search before asking user");
  assert(output.includes("restart_pack remains opt-in"), "restart_pack includes decisions");
  assert(!output.includes("AM-026 catch_up uses per-event ledger"), "restart_pack suppresses stale unrelated decisions");
  assert(output.includes("STRUCTURED MEMORY CAUTION"), "restart_pack explains suppressed stale structured memory");
  assert(output.includes("src/restart-pack.ts") || output.includes("~/Developer/agent-memory/src/restart-pack.ts"), "restart_pack includes relevant file");
  assert(output.includes("AM-031"), "restart_pack includes refs");
  assert(output.includes("PR#84"), "restart_pack normalizes and includes space-separated PR refs");
  assert(output.includes("issue#12") || output.includes("ISSUE#12"), "restart_pack normalizes and includes space-separated issue refs");
  assert(!output.includes("Build/tests"), "restart_pack does not emit generic ref tokens");
  assert(output.includes("codex/assistant"), "restart_pack summarizes Codex-derived conversation metadata");
  assert(output.includes("claude_code/user"), "restart_pack summarizes Claude-derived conversation metadata");
  assert(!output.includes("Session refresh should continue from memory."), "restart_pack does not emit raw conversation excerpt");
  assert(!output.includes("sk-"), "restart_pack redacts secrets at output boundary");
  assert(!output.includes("sk-test"), "restart_pack redacts compound secret prefixes");
  assert(!output.includes("dev@example.com"), "restart_pack redacts email at output boundary");
  assert(!output.includes(`${home}/Developer`), "restart_pack does not emit full home path");

  const conversationOnlyAgent = "test-restart-pack-conversation-only-agent";
  await store.saveConversationEvent({
    agent_id: conversationOnlyAgent,
    project,
    source: "codex",
    source_event_id: "codex-conversation-only:1",
    role: "user",
    content: "Please continue the restart recovery evaluation.",
    occurred_at: "2026-05-19T00:03:00.000Z",
  });
  const conversationOnly = await generateRestartPack(store, {
    agent_id: conversationOnlyAgent,
    project,
  });
  assert(conversationOnly.includes("search_memory scope=conversation"), "restart_pack directs fallback conversation search when structured memory is sparse");
  assert(!conversationOnly.includes("Please continue the restart recovery evaluation."), "conversation fallback does not emit raw user request");

  const sparse = await generateRestartPack(store, {
    agent_id: "test-restart-pack-empty-agent",
    project,
  });
  assert(sparse.includes("SPARSE DATA NOTICE"), "restart_pack has sparse fallback");
  assert(sparse.includes("No active task recorded"), "restart_pack handles no active task");

  const truncated = buildRestartPack({
    agentId: agentId,
    project,
    maxTokens: 80,
    activeTasks: [],
    blockedTasks: [],
    completedTasks: [],
    decisions: Array.from({ length: 20 }, (_, i) => ({
      id: `decision-${i}`,
      agent_id: agentId,
      project,
      decision: `Decision ${i} ${"x".repeat(80)}`,
      tags: [],
      status: "active",
      created_at: "2026-05-19T00:00:00.000Z",
    })),
    knowledge: [],
    conversationEvents: [],
  });
  assert(truncated.length < 700, "restart_pack enforces token budget truncation");

  await store.close();
}

async function testCodexStartupBridge() {
  console.log("\n── Codex Startup Bridge Tests ──");
  const prompt = buildCodexStartupPrompt({
    agentId: "codex-cto",
    project: "codex",
    restartPack: [
      "SESSION RESTART PACK",
      "CURRENT OBJECTIVE",
      "Stabilize queue consumer",
      "NEXT CONCRETE ACTION",
      "Verify DB row 74155 and GitHub SSOT before merge. Never leak sk-test-AKIAIOSFODNN7EXAMPLE.",
    ].join("\n"),
    extraInstruction: "Use the canonical ~/Developer/codex workspace.",
  });

  assert(prompt.includes("agent_id=codex-cto, project=codex"), "Codex startup prompt names memory namespace");
  assert(prompt.includes("Before claiming that prior context is unavailable"), "Codex startup prompt prevents generic no-context response");
  assert(prompt.includes("search_memory scope=conversation"), "Codex startup prompt requires conversation fallback");
  assert(prompt.includes("Before architectural/design decisions"), "Codex startup prompt includes adaptive retrieval trigger");
  assert(prompt.includes("Treat this boot context as Layer 1 recovery only"), "Codex startup prompt labels boot context as Layer 1");
  assert(prompt.includes("verify with the external SSOT"), "Codex startup prompt requires external SSOT for PR/status");
  assert(prompt.includes("SESSION RESTART PACK"), "Codex startup prompt embeds restart_pack");
  assert(prompt.includes("Use the canonical ~/Developer/codex workspace."), "Codex startup prompt includes extra instruction");
  assert(!prompt.includes("sk-test"), "Codex startup prompt applies secondary redaction to compound secret prefix");
  assert(!prompt.includes("AKIAIOSFODNN7EXAMPLE"), "Codex startup prompt applies secondary redaction to AWS-shaped suffix");

  const parsed = parseArgs(["--launch", "--cd", "/tmp/work", "--codex-bin", "codex-dev", "--max-tokens", "900", "--extra", "Probe R1 first."]);
  assert(parsed.launch === true, "Codex startup parser enables launch mode");
  assert(parsed.cd === "/tmp/work", "Codex startup parser reads --cd");
  assert(parsed.codexBin === "codex-dev", "Codex startup parser reads --codex-bin");
  assert(parsed.maxTokens === 900, "Codex startup parser reads --max-tokens");
  assert(parsed.extraInstruction === "Probe R1 first.", "Codex startup parser reads --extra");

  const printAfterLaunch = parseArgs(["--launch", "--print"]);
  assert(printAfterLaunch.launch === false, "Codex startup parser lets later --print disable launch");
  assert(printAfterLaunch.launch !== true, "Codex --print does not count as launched startup evidence");

  const qualityLogs: LogRecoveryQualityInput[] = [];
  await logCodexStartupQuality(
    {
      async logRecoveryQuality(input: LogRecoveryQualityInput) {
        qualityLogs.push(input);
        return `log-${qualityLogs.length}`;
      },
    },
    "SESSION RESTART PACK\nCURRENT OBJECTIVE\nProbe launch telemetry",
    { launchRequested: true }
  );
  await logCodexStartupQuality(
    {
      async logRecoveryQuality(input: LogRecoveryQualityInput) {
        qualityLogs.push(input);
        return `log-${qualityLogs.length}`;
      },
    },
    "SESSION RESTART PACK\nCURRENT OBJECTIVE\nProbe launch telemetry",
    { launchRequested: true, launchedCodex: true }
  );
  const requestedNotes = JSON.parse(qualityLogs[0].notes ?? "{}");
  const launchedNotes = JSON.parse(qualityLogs[1].notes ?? "{}");
  assert(requestedNotes.launch_requested === true, "Codex startup telemetry records launch request");
  assert(requestedNotes.launched_codex === false, "Codex startup telemetry does not mark launch before spawn success");
  assert(launchedNotes.launched_codex === true, "Codex startup telemetry marks launched only after successful launch");

  const launchArgs = buildCodexLaunchArgs({ cd: "/tmp/work" }, "hello");
  assert(launchArgs[0] === "--cd" && launchArgs[1] === "/tmp/work" && launchArgs[2] === "hello", "Codex launch args pass --cd before prompt");

  const launchEnv = buildCodexLaunchEnv({ EXISTING_ENV: "kept" });
  assert(launchEnv.EXISTING_ENV === "kept", "Codex launch env preserves existing values");
  assert(launchEnv.AGENT_MEMORY_STARTUP_BRIDGE === CODEX_STARTUP_BRIDGE_ENV, "Codex launch env marks bridge usage");
  assert(CODEX_STARTUP_BRIDGE_ENV === "codex_startup_bridge_v1", "Codex startup bridge env has stable adapter marker");

  const distEntrypoint = join(process.cwd(), "dist/codex-start.js");
  const symlinkDir = mkdtempSync(join(tmpdir(), "am032-codex-bin-"));
  const symlinkPath = join(symlinkDir, "wasurezu-codex-start");
  if (existsSync(distEntrypoint)) {
    symlinkSync(distEntrypoint, symlinkPath);
    assert(isMainEntrypoint(symlinkPath, `file://${distEntrypoint}`), "Codex startup entrypoint resolves npm bin symlinks");
    const help = execFileSync(process.execPath, [symlinkPath, "--help"], { encoding: "utf8" });
    assert(help.includes("wasurezu-codex-start"), "Codex startup bin symlink executes CLI help");
    assert(help.includes("/exit"), "Codex startup help documents exit-before-reentry UX");
    assert(help.includes("does not kill or replace"), "Codex startup help avoids claiming session lifecycle ownership");
  } else {
    assert(true, "Codex startup bin symlink test skipped because dist/codex-start.js is absent");
  }
  rmSync(symlinkDir, { recursive: true, force: true });

  try {
    parseArgs(["--max-tokens", "-1"]);
    assert(false, "Codex startup parser rejects negative --max-tokens");
  } catch {
    assert(true, "Codex startup parser rejects negative --max-tokens");
  }

  try {
    parseArgs(["--cd"]);
    assert(false, "Codex startup parser rejects missing --cd value");
  } catch {
    assert(true, "Codex startup parser rejects missing --cd value");
  }
}

function testHostAdapterPackagingBoundary() {
  console.log("\n── Host Adapter Packaging Boundary Tests ──");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert(packageJson.files.includes("docs/operations/HOST_ADAPTERS.md"), "npm package includes host adapter docs");
  assert(!packageJson.files.includes("scripts/host-adapters"), "npm package does not claim host runtime restart scripts");

  const hostAdapters = readFileSync("docs/operations/HOST_ADAPTERS.md", "utf8");
  const normalizedHostAdapters = hostAdapters.replace(/\s+/g, " ");
  const lowerHostAdapters = normalizedHostAdapters.toLowerCase();
  assert(normalizedHostAdapters.includes("With AUN or another supervisor installed"), "host adapter docs separate AUN/supervisor mode");
  assert(lowerHostAdapters.includes("does not mutate aun queue state"), "host adapter docs forbid wasurezu AUN queue lifecycle mutation");
  assert(normalizedHostAdapters.includes("Without AUN, wasurezu may execute local session refresh"), "host adapter docs allow standalone pre-authorized refresh");
  assert(normalizedHostAdapters.includes("Pure MCP-only"), "host adapter docs distinguish pure MCP-only mode");
  assert(normalizedHostAdapters.includes("auto_restart"), "host adapter docs list auto_restart continuity guard mode");
  assert(normalizedHostAdapters.includes("pre-authorized at install/config time"), "host adapter docs require pre-authorization for auto_restart");
}

function testConversationScopeSchemaRegression() {
  console.log("\n── MCP Schema Regression Tests ──");
  const source = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
  assert(source.includes('"conversation"'), "source search_memory schema includes conversation scope");
  const constants = readFileSync(join(process.cwd(), "src/constants.ts"), "utf8");
  assert(constants.includes("adaptive retrieval layer"), "source search_memory description includes adaptive retrieval trigger");
  assert(constants.includes("before making architectural or design decisions"), "source search_memory description says when to search");

  const distPath = join(process.cwd(), "dist/index.js");
  if (existsSync(distPath)) {
    const dist = readFileSync(distPath, "utf8");
    assert(dist.includes('"conversation"'), "built MCP schema includes conversation scope");
    const distConstants = readFileSync(join(process.cwd(), "dist/constants.js"), "utf8");
    assert(distConstants.includes("adaptive retrieval layer"), "built MCP schema includes adaptive retrieval trigger");
  } else {
    assert(true, "built MCP schema check skipped because dist/index.js is absent");
  }
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
  testRedaction();
  await testConversationEvents();
  await testClaudeConversationIngest();
  await testCodexConversationIngest();
  await testRestartPack();
  await testCodexStartupBridge();
  testHostAdapterPackagingBoundary();
  testConversationScopeSchemaRegression();

  await cleanup();

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
