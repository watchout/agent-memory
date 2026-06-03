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
import Ajv2020 from "ajv/dist/2020.js";
import { validateHostInvocationContextJsonSchema, validateRecoveryPackJsonSchema } from "./artifact-schema-validator.js";
import { ingestClaudeConversationEvents } from "./claude-conversation-ingest.js";
import { ingestCodexConversationEvents } from "./codex-conversation-ingest.js";
import {
  HOST_INVOCATION_CONTEXT_ALLOWED_KEYS,
  RECOVERY_PACK_ALLOWED_KEYS,
  RECOVERY_PACK_ITEM_ALLOWED_KEYS,
  RECOVERY_PACK_REVIEW_PROMPT_ALLOWED_KEYS,
  buildHostInvocationContextArtifact,
  buildRecoveryPackArtifact,
  buildRestartPack,
  estimateRecoveryPackContentTokens,
  generateHostInvocationContext,
  generateRecoveryPackArtifact,
  generateRestartPack,
  validateHostInvocationContextArtifact,
  validateRecoveryPackArtifact,
} from "./restart-pack.js";
import { prepareRestart } from "./restart-prepare.js";
import {
  isMainEntrypoint as isRestartCliMainEntrypoint,
  parseRestartCliArgs,
} from "./restart-cli.js";
import { redactText } from "./redact.js";
import {
  CODEX_STARTUP_BRIDGE_ENV,
  buildCodexLaunchArgs,
  buildCodexLaunchEnv,
  buildCodexStartupPrompt,
  isMainEntrypoint as isCodexMainEntrypoint,
  logCodexStartupQuality,
  parseArgs,
} from "./codex-start.js";
import {
  CLAUDE_RESESSION_RUNNER_ENV,
  buildClaudeLaunchArgs,
  buildClaudeLaunchEnv,
  buildClaudeRunnerResult,
  isMainEntrypoint as isClaudeMainEntrypoint,
  launchBlockersFor,
  parseClaudeStartArgs,
  prepareClaudeResession,
} from "./claude-start.js";
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

function sameStringSet(actual: string[], expected: readonly string[]): boolean {
  return actual.slice().sort().join("\n") === Array.from(expected).sort().join("\n");
}

function mcpToolNamesFromSource(source: string): string[] {
  return Array.from(source.matchAll(/server\.tool\(\s*\n\s*"([^"]+)"/g), (match) => match[1]);
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
    content: "We should continue AM-031 from the redacted event storage PR.",
    metadata: { file: "src/stores/types.ts" },
    occurred_at: "2026-05-19T00:00:00.000Z",
  });
  const duplicate = await store.saveConversationEvent({
    agent_id: "test-agent",
    project: "hotel-app",
    source: "codex",
    source_event_id: "codex-event-1",
    role: "assistant",
    content: "We should continue AM-031 from the redacted event storage PR.",
    occurred_at: "2026-05-19T00:00:00.000Z",
  });
  const second = await store.saveConversationEvent({
    agent_id: "test-agent",
    project: "hotel-app",
    source: "claude_code",
    source_event_id: "claude-event-1",
    role: "user",
    content: "Session restart should recover the active task.",
    occurred_at: "2026-05-19T00:01:00.000Z",
  });
  const third = await store.saveConversationEvent({
    agent_id: "test-agent",
    project: "hotel-app",
    source: "codex",
    source_event_id: "codex-token-count-noise",
    role: "event",
    content: '{"type":"token_count","info":{"note":"restart"}}',
    occurred_at: "2026-05-19T00:02:00.000Z",
  });

  assert(first.id === duplicate.id, "source_event_id deduplicates redacted events");
  const all = await store.getConversationEvents({ agent_id: "test-agent" });
  assert(all.length === 3, "getConversationEvents returns unique redacted events");
  assert(all[0].source_event_id === "codex-token-count-noise", "events sorted newest first");
  const rawConversationEvents = await store.getRawEvents({ agent_id: "test-agent", source: "conversation_event" });
  const mirroredConversationEventIds = new Set(rawConversationEvents.map((event) => event.source_event_id));
  assert([first.id, second.id, third.id].every((id) => mirroredConversationEventIds.has(id)), "conversation_events are mirrored into raw_events");
  const firstRawEvent = rawConversationEvents.find((event) => event.source_event_id === first.id);
  assert(firstRawEvent !== undefined, "raw_events includes conversation event provenance");
  if (!firstRawEvent) throw new Error("missing raw event for first conversation event");
  assert(firstRawEvent.event_type === "assistant_message", "raw_events maps assistant conversation role");
  assert(firstRawEvent.content_hash === first.content_hash, "raw_events preserves conversation content hash");
  assert(firstRawEvent.metadata.compatibility_table === "conversation_events", "raw_events records compatibility provenance");
  assert(firstRawEvent.metadata.conversation_source === "codex", "raw_events records original conversation source");
  assert(firstRawEvent.metadata.conversation_source_event_id === "codex-event-1", "raw_events records original source event id");
  const codexOnly = await store.getConversationEvents({ agent_id: "test-agent", source: "codex" });
  assert(codexOnly.length === 2, "source filter works");
  assert(codexOnly.some((event) => event.metadata.file === "src/stores/types.ts"), "metadata round-trips");
  const duplicateRawEvents = await store.getRawEvents({ agent_id: "test-agent", source: "conversation_event" });
  const duplicateMirrors = duplicateRawEvents.filter((event) => [first.id, second.id, third.id].includes(event.source_event_id ?? ""));
  assert(duplicateMirrors.length === 3, "duplicate conversation ingest does not duplicate raw_events");
  const manualRaw = await store.saveRawEvent({
    agent_id: "test-agent",
    session_id: "session-raw-1",
    project: "hotel-app",
    source: "manual",
    source_event_id: "manual-raw-1",
    event_type: "host_event",
    content: "Host observed prepare band.",
    metadata: { band: "prepare" },
    occurred_at: "2026-05-19T00:03:00.000Z",
  });
  const duplicateManualRaw = await store.saveRawEvent({
    agent_id: "test-agent",
    session_id: "session-raw-1",
    project: "hotel-app",
    source: "manual",
    source_event_id: "manual-raw-1",
    event_type: "host_event",
    content: "Host observed prepare band.",
    occurred_at: "2026-05-19T00:03:00.000Z",
  });
  assert(manualRaw.id === duplicateManualRaw.id, "raw_events deduplicate by source_event_id");
  const sourceRefRaw = await store.saveRawEvent({
    agent_id: "test-agent",
    session_id: "session-raw-ref-1",
    project: "hotel-app",
    source: "host_context",
    event_type: "context_ref",
    source_ref: { kind: "context_health", ref: "claude-context-ratio" },
    metadata: { ratio: 0.91 },
    occurred_at: "2026-05-19T00:04:00.000Z",
  });
  const duplicateSourceRefRaw = await store.saveRawEvent({
    agent_id: "test-agent",
    session_id: "session-raw-ref-1",
    project: "hotel-app",
    source: "host_context",
    event_type: "context_ref",
    source_ref: { kind: "context_health", ref: "claude-context-ratio" },
    occurred_at: "2026-05-19T00:04:00.000Z",
  });
  const distinctSourceRefRaw = await store.saveRawEvent({
    agent_id: "test-agent",
    session_id: "session-raw-ref-1",
    project: "hotel-app",
    source: "host_context",
    event_type: "context_ref",
    source_ref: { kind: "context_health", ref: "codex-context-ratio" },
    occurred_at: "2026-05-19T00:04:00.000Z",
  });
  assert(sourceRefRaw.id === duplicateSourceRefRaw.id, "raw_events deduplicate source_ref-only events by source_ref_hash");
  assert(sourceRefRaw.id !== distinctSourceRefRaw.id, "raw_events do not collapse distinct source_ref-only events with same timestamp");
  assert(sourceRefRaw.content_hash === undefined, "source_ref-only raw_events do not require content_hash");
  assert(sourceRefRaw.source_ref_hash?.length === 64, "source_ref-only raw_events keep source_ref_hash identity");
  const sessionRaw = await store.getRawEvents({ agent_id: "test-agent", session_id: "session-raw-1" });
  assert(sessionRaw.length === 1 && sessionRaw[0].metadata.band === "prepare", "raw_events filters by session_id");
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
  assert(first.events_saved === 4, "ingest saves four valid redacted events");
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
  assert(first.events_saved === 7, "Codex ingest saves visible redacted events");
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
  assert(!output.includes("Session refresh should continue from memory."), "restart_pack does not emit transcript excerpts");
  assert(!output.includes("sk-"), "restart_pack redacts secrets at output boundary");
  assert(!output.includes("sk-test"), "restart_pack redacts compound secret prefixes");
  assert(!output.includes("dev@example.com"), "restart_pack redacts email at output boundary");
  assert(!output.includes(`${home}/Developer`), "restart_pack does not emit full home path");

  const recoveryPack = await generateRecoveryPackArtifact(store, {
    agent_id: agentId,
    project,
    max_tokens: 1500,
  });
  assert(validateRecoveryPackArtifact(recoveryPack).valid, "recovery-pack/v1 validates generated artifact");
  assert(validateRecoveryPackJsonSchema(recoveryPack).valid, "recovery-pack/v1 validates against canonical JSON Schema");
  assert(recoveryPack.pack_id.startsWith("restart_pack:"), "recovery-pack/v1 has stable pack id prefix");
  assert(recoveryPack.project === project, "recovery-pack/v1 includes project");
  assert(recoveryPack.confidence === "high", "recovery-pack/v1 reports high confidence when task and context exist");
  assert(recoveryPack.missing_context.length === 0, "recovery-pack/v1 reports no missing context for coherent pack");
  assert(recoveryPack.items.some((item) => item.kind === "current_task"), "recovery-pack/v1 includes current task item");
  assert(recoveryPack.items.some((item) => item.kind === "decision"), "recovery-pack/v1 includes decision item");
  assert(recoveryPack.items.some((item) => item.kind === "knowledge"), "recovery-pack/v1 includes knowledge item");
  assert(recoveryPack.items.some((item) => item.kind === "recent_message"), "recovery-pack/v1 includes recent message evidence item");
  assert(recoveryPack.items.some((item) => item.trust_level === "external"), "recovery-pack/v1 marks conversation-derived context as external");
  assert(recoveryPack.items.some((item) => item.source_ref.startsWith("conversation_event:")), "recovery-pack/v1 item includes conversation provenance");
  assert(recoveryPack.items.some((item) => item.sensitivity === "secret_redacted"), "recovery-pack/v1 records secret redaction status");
  const recoveryJson = JSON.stringify(recoveryPack);
  assert(!recoveryJson.includes("sk-test"), "recovery-pack/v1 redacts compound secret prefixes before emit");
  assert(!recoveryJson.includes("dev@example.com"), "recovery-pack/v1 redacts emails before emit");
  assert(estimateRecoveryPackContentTokens(recoveryPack) <= recoveryPack.token_budget, "recovery-pack/v1 enforces aggregate content token budget");

  const codexHostContext = await generateHostInvocationContext(store, {
    agent_id: agentId,
    project,
    max_tokens: 1500,
    target_runtime: "codex",
  });
  assert(validateHostInvocationContextArtifact(codexHostContext).valid, "host-invocation-context/v1 validates generated Codex artifact");
  assert(validateHostInvocationContextJsonSchema(codexHostContext).valid, "host-invocation-context/v1 validates against canonical JSON Schema");
  assert(codexHostContext.target_runtime === "codex", "host-invocation-context/v1 supports Codex target runtime");
  assert(codexHostContext.delivery_mode === "stdin-json", "host-invocation-context/v1 defaults Codex to stdin-json");
  assert(codexHostContext.untrusted_context_policy === "quote-as-data-only", "host-invocation-context/v1 defaults contextual content to data-only");
  assert(codexHostContext.context_data.pack_id === codexHostContext.pack_id, "host-invocation-context/v1 embeds matching recovery pack");
  assert(!codexHostContext.trusted_instruction.includes("codex exec"), "host-invocation-context/v1 does not embed Codex shell commands");

  const claudeHostContext = buildHostInvocationContextArtifact(recoveryPack, { target_runtime: "claude" });
  assert(validateHostInvocationContextArtifact(claudeHostContext).valid, "host-invocation-context/v1 validates Claude profile");
  assert(claudeHostContext.delivery_mode === "session-start-hook", "host-invocation-context/v1 defaults Claude to session-start-hook");

  const strictPack = validateRecoveryPackArtifact({ ...recoveryPack, unexpected: true });
  assert(!strictPack.valid, "recovery-pack/v1 validation rejects additional properties");
  const strictPackSchema = validateRecoveryPackJsonSchema({ ...recoveryPack, unexpected: true });
  assert(!strictPackSchema.valid, "recovery-pack/v1 canonical schema rejects additional properties");
  const invalidGeneratedAtSchema = validateRecoveryPackJsonSchema({ ...recoveryPack, generated_at: "not-a-date" });
  assert(!invalidGeneratedAtSchema.valid, "recovery-pack/v1 canonical schema rejects invalid date-time");
  const invalidTokenBudgetSchema = validateRecoveryPackJsonSchema({ ...recoveryPack, token_budget: 0 });
  assert(!invalidTokenBudgetSchema.valid, "recovery-pack/v1 canonical schema enforces token budget minimum");
  const strictHostContext = validateHostInvocationContextArtifact({ ...codexHostContext, unexpected: true });
  assert(!strictHostContext.valid, "host-invocation-context/v1 validation rejects additional properties");
  const strictHostContextSchema = validateHostInvocationContextJsonSchema({ ...codexHostContext, unexpected: true });
  assert(!strictHostContextSchema.valid, "host-invocation-context/v1 canonical schema rejects additional properties");
  const invalidHostRuntimeSchema = validateHostInvocationContextJsonSchema({ ...codexHostContext, target_runtime: "terminal" });
  assert(!invalidHostRuntimeSchema.valid, "host-invocation-context/v1 canonical schema rejects invalid target runtime");
  const invalidNestedPackSchema = validateHostInvocationContextJsonSchema({
    ...codexHostContext,
    context_data: { ...codexHostContext.context_data, token_budget: 0 },
  });
  assert(!invalidNestedPackSchema.valid, "host-invocation-context/v1 canonical schema resolves recovery-pack $ref");
  for (const trusted_instruction of ["codex exec -", "bash -c echo hi", "$ npm test", "> npm test", "$ rm -rf /tmp/example"]) {
    const shellCommandContext = validateHostInvocationContextArtifact({
      ...codexHostContext,
      trusted_instruction,
    });
    assert(!shellCommandContext.valid, `host-invocation-context/v1 rejects raw shell command: ${trusted_instruction}`);
  }

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
  const sparseStructured = await generateRecoveryPackArtifact(store, {
    agent_id: "test-restart-pack-empty-agent",
    project,
  });
  assert(sparseStructured.confidence === "low", "recovery-pack/v1 reports low confidence when context is sparse");
  assert(sparseStructured.missing_context.includes("active_task"), "recovery-pack/v1 reports missing active task");
  assert(sparseStructured.missing_context.includes("supporting_context"), "recovery-pack/v1 reports missing supporting context");

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

  const structuredTruncated = buildRecoveryPackArtifact({
    agentId: agentId,
    project,
    maxTokens: 80,
    activeTasks: [{
      id: "task-long",
      agent_id: agentId,
      project,
      task: `AM-110 implement structured recovery artifacts ${"x".repeat(600)} sk-test-AKIAIOSFODNN7EXAMPLE`,
      status: "in_progress",
      progress: `Large progress note ${"y".repeat(600)}`,
      files_modified: [],
      next_steps: `Validate schema output ${"z".repeat(600)}`,
      created_at: "2026-05-19T00:00:00.000Z",
    }],
    blockedTasks: [],
    completedTasks: [],
    decisions: [],
    knowledge: [],
    conversationEvents: [],
  }, { generated_at: "2026-05-19T00:00:00.000Z", pack_id: "restart_pack:test:bounded" });
  assert(estimateRecoveryPackContentTokens(structuredTruncated) <= structuredTruncated.token_budget, "structured recovery-pack content is bounded by token budget");
  assert(JSON.stringify(structuredTruncated).includes("(truncated)"), "structured recovery-pack truncates oversized summaries");
  assert(!JSON.stringify(structuredTruncated).includes("sk-test"), "structured recovery-pack redacts before truncation emit");

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
    assert(isCodexMainEntrypoint(symlinkPath, `file://${distEntrypoint}`), "Codex startup entrypoint resolves npm bin symlinks");
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

async function testClaudeResessionRunner() {
  console.log("\n── Claude Resession Runner Tests ──");
  const store = new JsonStore();
  await store.initialize();
  const agentId = "test-claude-runner-agent";
  const project = "claude-runner";

  await store.saveTaskState({
    agent_id: agentId,
    project,
    task: "AM-125 implement Claude host resession runner",
    status: "in_progress",
    progress: "Runner tests are preparing selected packs.",
    next_steps: "Verify standalone launch gating.",
  });
  await store.logDecision({
    agent_id: agentId,
    project,
    decision: "Claude SessionStart loads selected packs but does not own restart policy.",
    tags: ["AM-125", "claude"],
  });

  const prepareBand = await prepareClaudeResession(store, {
    agentId,
    project,
    contextUsedRatio: 0.72,
    launch: false,
  });
  assert(prepareBand.prepare.context_signal.source === "host_metrics", "Claude runner uses host-provided context metrics");
  assert(prepareBand.prepare.context_signal.band === "prepare", "Claude runner maps 72% context to prepare band");
  assert(prepareBand.prepare.action === "pack_update_needed", "Claude runner prepare band updates pack without recommending restart");
  assert(prepareBand.prepare.restart_pack_format === "host-invocation-context-v1", "Claude runner persists structured host invocation packs");
  assert(prepareBand.prepare.restart_pack_schema_ref === "host-invocation-context/v1", "Claude runner records host invocation schema ref");

  const warnBand = await prepareClaudeResession(store, {
    agentId,
    project,
    contextUsedRatio: 0.83,
    launch: false,
  });
  assert(warnBand.prepare.context_signal.band === "warn", "Claude runner maps 83% context to warn band");
  assert(warnBand.prepare.action === "pack_update_needed", "Claude runner warn band does not force restart");

  const recommendBand = await prepareClaudeResession(store, {
    agentId,
    project,
    contextUsedRatio: 0.91,
    launch: false,
  });
  assert(recommendBand.prepare.context_signal.band === "recommend", "Claude runner maps 91% context to recommend band");
  assert(recommendBand.prepare.action === "restart_recommended", "Claude runner recommend band emits restart recommendation");

  const requireBand = await prepareClaudeResession(store, {
    agentId,
    project,
    contextUsedRatio: 0.96,
    launch: false,
  });
  assert(requireBand.prepare.context_signal.band === "require", "Claude runner maps 96% context to require band");
  assert(requireBand.prepare.action === "restart_required", "Claude runner require band emits restart_required");
  assert(requireBand.prepare.pack_ref?.startsWith("selected_restart_pack:") === true, "Claude runner returns selected pack ref");
  const selected = await store.getSelectedRestartPack({ agent_id: agentId, project, pack_ref: requireBand.prepare.pack_ref! });
  assert(selected !== null, "Claude runner persists selected restart pack");
  const selectedContent = JSON.parse(selected!.content);
  assert(validateHostInvocationContextArtifact(selectedContent).valid, "Claude runner selected pack validates as host invocation context");
  assert(selectedContent.target_runtime === "claude", "Claude runner targets Claude");
  assert(selectedContent.delivery_mode === "session-start-hook", "Claude runner uses SessionStart delivery");
  assert(selectedContent.untrusted_context_policy === "quote-as-data-only", "Claude runner keeps context data-only");

  const runtimeError = await prepareClaudeResession(store, {
    agentId,
    project,
    runtimeContextError: true,
    launch: false,
  });
  assert(runtimeError.prepare.action === "restart_required", "Claude runner treats runtime context error as restart_required");
  assert(runtimeError.prepare.context_signal.source === "estimated", "Claude runner marks metric-absent signal as estimated");

  const sparse = await prepareClaudeResession(store, {
    agentId: "test-claude-runner-sparse",
    project,
    launch: false,
  });
  assert(sparse.prepare.recovery_confidence.level === "low", "Claude runner reports low confidence for sparse pack");
  assert(sparse.prepare.recovery_confidence.missing_context.includes("active_task"), "Claude runner reports missing active task");

  const pureMcpLaunch = buildClaudeRunnerResult(requireBand.prepare, true);
  assert(pureMcpLaunch.launch_blockers.includes("restart_prepare_can_auto_restart_false"), "Claude runner launch fails closed without auto_restart authorization");

  const aunBlocked = await prepareClaudeResession(store, {
    agentId,
    project,
    continuityGuardMode: "auto_restart",
    aunInstalled: true,
    supervisorAvailable: true,
    restartPreauthorized: true,
    contextUsedRatio: 0.96,
    launch: true,
  });
  assert(aunBlocked.prepare.can_auto_restart === false, "Claude runner does not auto restart in AUN-supervised mode");
  assert(aunBlocked.launch_blockers.includes("aun_installed"), "Claude runner exposes AUN launch blocker");

  const preauthorized = await prepareClaudeResession(store, {
    agentId,
    project,
    continuityGuardMode: "auto_restart",
    aunAbsentConfirmed: true,
    supervisorAvailable: true,
    restartPreauthorized: true,
    contextUsedRatio: 0.96,
    launch: true,
  });
  assert(preauthorized.prepare.can_auto_restart === true, "Claude runner allows pre-authorized standalone auto_restart");
  assert(launchBlockersFor(preauthorized.prepare).length === 0, "Claude runner has no launch blockers when standalone gates pass");
  assert(preauthorized.launch_blockers.length === 0, "Claude runner result has no launch blockers for valid standalone launch");

  const prepareOnlyLaunch = await prepareClaudeResession(store, {
    agentId,
    project,
    continuityGuardMode: "auto_restart",
    aunAbsentConfirmed: true,
    supervisorAvailable: true,
    restartPreauthorized: true,
    contextUsedRatio: 0.72,
    launch: true,
  });
  assert(prepareOnlyLaunch.launch_blockers.includes("restart_not_recommended_or_required"), "Claude runner does not launch for prepare-only band");

  const launchEnv = buildClaudeLaunchEnv({ EXISTING_ENV: "kept" }, preauthorized.prepare);
  assert(launchEnv.EXISTING_ENV === "kept", "Claude runner launch env preserves existing values");
  assert(launchEnv.AGENT_MEMORY_STARTUP_BRIDGE === CLAUDE_RESESSION_RUNNER_ENV, "Claude runner marks startup bridge env");
  assert(launchEnv.AGENT_MEMORY_BOOT_MODE === "restart_pack", "Claude runner launch env enables restart_pack boot");
  assert(launchEnv.AGENT_MEMORY_SELECTED_PACK_REF === preauthorized.prepare.pack_ref, "Claude runner passes selected pack ref to next session");

  const launchArgs = buildClaudeLaunchArgs({ mcpConfig: ".mcp.json", claudeArgs: ["--dangerously-skip-permissions"] });
  assert(launchArgs[0] === "--mcp-config" && launchArgs[1] === ".mcp.json", "Claude runner launch args pass mcp config");
  assert(launchArgs.includes("--dangerously-skip-permissions"), "Claude runner launch args preserve explicit argv items");

  const parsed = parseClaudeStartArgs([
    "--launch",
    "--agent-id",
    "auditor",
    "--project",
    "dev-auditor",
    "--mode",
    "auto_restart",
    "--context-used-ratio",
    "0.96",
    "--aun-absent",
    "--supervisor-available",
    "--restart-preauthorized",
    "--cd",
    "/tmp/dev-auditor",
    "--mcp-config",
    ".mcp.json",
    "--claude-bin",
    "claude-dev",
    "--claude-arg",
    "--dangerously-skip-permissions",
  ]);
  assert(parsed.launch === true, "Claude runner parser enables launch");
  assert(parsed.agentId === "auditor", "Claude runner parser reads agent id");
  assert(parsed.project === "dev-auditor", "Claude runner parser reads project");
  assert(parsed.continuityGuardMode === "auto_restart", "Claude runner parser reads guard mode");
  assert(parsed.contextUsedRatio === 0.96, "Claude runner parser reads context ratio");
  assert(parsed.aunAbsentConfirmed === true, "Claude runner parser reads AUN absence evidence");
  assert(parsed.supervisorAvailable === true, "Claude runner parser reads supervisor availability");
  assert(parsed.restartPreauthorized === true, "Claude runner parser reads restart preauthorization");
  assert(parsed.cd === "/tmp/dev-auditor", "Claude runner parser reads working directory");
  assert(parsed.mcpConfig === ".mcp.json", "Claude runner parser reads mcp config");
  assert(parsed.claudeBin === "claude-dev", "Claude runner parser reads Claude bin");
  assert(parsed.claudeArgs.includes("--dangerously-skip-permissions"), "Claude runner parser reads repeated Claude args");

  const printAfterLaunch = parseClaudeStartArgs(["--launch", "--print"]);
  assert(printAfterLaunch.launch === false, "Claude runner parser lets later --print disable launch");

  try {
    parseClaudeStartArgs(["--context-used-ratio", "1.2"]);
    assert(false, "Claude runner parser rejects invalid context ratio");
  } catch {
    assert(true, "Claude runner parser rejects invalid context ratio");
  }

  try {
    parseClaudeStartArgs(["--max-tokens", "0"]);
    assert(false, "Claude runner parser rejects zero max tokens");
  } catch {
    assert(true, "Claude runner parser rejects zero max tokens");
  }

  const distEntrypoint = join(process.cwd(), "dist/claude-start.js");
  const symlinkDir = mkdtempSync(join(tmpdir(), "am125-claude-bin-"));
  const symlinkPath = join(symlinkDir, "wasurezu-claude-start");
  if (existsSync(distEntrypoint)) {
    symlinkSync(distEntrypoint, symlinkPath);
    assert(isClaudeMainEntrypoint(symlinkPath, `file://${distEntrypoint}`), "Claude runner entrypoint resolves npm bin symlinks");
    const help = execFileSync(process.execPath, [symlinkPath, "--help"], { encoding: "utf8" });
    assert(help.includes("wasurezu-claude-start"), "Claude runner bin symlink executes CLI help");
    assert(help.includes("does not kill or replace"), "Claude runner help avoids claiming process replacement");
    assert(help.includes("TUI input remains fallback only"), "Claude runner help keeps TUI fallback-only boundary");
  } else {
    assert(true, "Claude runner bin symlink test skipped because dist/claude-start.js is absent");
  }
  rmSync(symlinkDir, { recursive: true, force: true });

  await store.close();
}

async function testRestartPrepare() {
  console.log("\n── Restart Prepare Tests ──");
  const store = new JsonStore();
  await store.initialize();
  const agentId = "test-restart-prepare-agent";
  const project = "restart-prepare";

  await store.saveTaskState({
    agent_id: agentId,
    project,
    task: "AM-038 implement restart_prepare",
    status: "in_progress",
    progress: "Core prepare path under test.",
    next_steps: "Wire MCP tool and CLI.",
  });
  await store.logDecision({
    agent_id: agentId,
    project,
    decision: "Wasurezu does not mutate AUN queue lifecycle during restart_prepare.",
    tags: ["AM-038", "AUN"],
  });

  const prepared = await prepareRestart(store, {
    agent_id: agentId,
    project,
    context_used_ratio: 0.91,
    emit_pack: false,
  });
  assert(prepared.action === "restart_recommended", "restart_prepare recommends restart at host metrics recommend band");
  assert(prepared.context_signal.source === "host_metrics", "restart_prepare labels host metric source");
  assert(prepared.context_signal.band === "recommend", "restart_prepare maps 91% context to recommend band");
  assert(prepared.recovery_confidence.level === "high", "restart_prepare reports high confidence for coherent pack");
  assert(prepared.pack_ref !== null && prepared.pack_ref.startsWith("selected_restart_pack:"), "restart_prepare returns selected pack reference");
  assert(prepared.restart_pack === undefined, "restart_prepare can omit restart_pack text");
  assert(prepared.notes.some((note) => note.includes("does not mutate AUN queue state")), "restart_prepare declares AUN lifecycle non-mutation");
  const selected = await store.getSelectedRestartPack({ agent_id: agentId, project, pack_ref: prepared.pack_ref! });
  assert(selected !== null, "restart_prepare persists selected restart pack");
  assert(selected?.content.includes("SESSION RESTART PACK") === true, "selected restart pack stores pack content");
  const consumed = await store.consumeSelectedRestartPack({ agent_id: agentId, project, pack_ref: prepared.pack_ref! });
  assert(consumed?.status === "consumed", "selected restart pack can be consumed");
  const afterConsume = await store.getSelectedRestartPack({ agent_id: agentId, project, pack_ref: prepared.pack_ref! });
  assert(afterConsume === null, "consumed selected restart pack is no longer active");

  const structuredPrepared = await prepareRestart(store, {
    agent_id: agentId,
    project,
    pack_format: "host-invocation-context-v1",
    emit_pack: false,
  });
  assert(structuredPrepared.restart_pack_format === "host-invocation-context-v1", "restart_prepare records structured selected pack format");
  assert(structuredPrepared.restart_pack_schema_ref === "host-invocation-context/v1", "restart_prepare records host invocation schema ref");
  assert(structuredPrepared.restart_pack === undefined, "restart_prepare can omit structured restart_pack JSON from output");
  const selectedStructured = await store.getSelectedRestartPack({ agent_id: agentId, project, pack_ref: structuredPrepared.pack_ref! });
  assert(selectedStructured !== null, "restart_prepare persists structured selected restart pack");
  const selectedStructuredContent = JSON.parse(selectedStructured!.content);
  assert(validateHostInvocationContextArtifact(selectedStructuredContent).valid, "structured selected restart pack content validates as host invocation context");
  assert(selectedStructuredContent.target_runtime === "codex", "structured selected restart pack targets Codex");
  assert(selectedStructuredContent.delivery_mode === "stdin-json", "structured selected restart pack defaults Codex to stdin-json");
  assert(selectedStructuredContent.untrusted_context_policy === "quote-as-data-only", "structured selected restart pack defaults contextual content to data-only");
  assert(selectedStructured!.metadata.pack_format === "host-invocation-context-v1", "structured selected restart pack metadata records pack format");
  assert(selectedStructured!.metadata.pack_schema_ref === "host-invocation-context/v1", "structured selected restart pack metadata records schema ref");
  assert(selectedStructured!.metadata.target_runtime === "codex", "structured selected restart pack metadata records default target runtime");
  assert(selectedStructured!.metadata.delivery_mode === "stdin-json", "structured selected restart pack metadata records default delivery mode");
  assert(selectedStructured!.metadata.untrusted_context_policy === "quote-as-data-only", "structured selected restart pack metadata records default untrusted context policy");

  const explicitStructured = await prepareRestart(store, {
    agent_id: agentId,
    project,
    pack_format: "host-invocation-context-v1",
    target_runtime: "claude",
    delivery_mode: "session-start-hook",
    untrusted_context_policy: "summarize-only",
    emit_pack: false,
  });
  const selectedExplicit = await store.getSelectedRestartPack({ agent_id: agentId, project, pack_ref: explicitStructured.pack_ref! });
  assert(selectedExplicit !== null, "restart_prepare persists explicit structured selected restart pack");
  const selectedExplicitContent = JSON.parse(selectedExplicit!.content);
  assert(validateHostInvocationContextArtifact(selectedExplicitContent).valid, "explicit structured selected restart pack content validates");
  assert(selectedExplicitContent.target_runtime === "claude", "explicit structured selected restart pack targets Claude");
  assert(selectedExplicitContent.delivery_mode === "session-start-hook", "explicit structured selected restart pack records session-start delivery");
  assert(selectedExplicitContent.untrusted_context_policy === "summarize-only", "explicit structured selected restart pack records untrusted context policy");
  assert(selectedExplicit!.metadata.target_runtime === "claude", "structured selected restart pack metadata round-trips explicit target runtime");
  assert(selectedExplicit!.metadata.delivery_mode === "session-start-hook", "structured selected restart pack metadata round-trips explicit delivery mode");
  assert(selectedExplicit!.metadata.untrusted_context_policy === "summarize-only", "structured selected restart pack metadata round-trips explicit untrusted context policy");

  const recoveryPrepared = await prepareRestart(store, {
    agent_id: agentId,
    project,
    pack_format: "recovery-pack-v1",
    pack_injection_mode: "off",
  });
  assert(recoveryPrepared.restart_pack_format === "recovery-pack-v1", "restart_prepare supports recovery-pack selected format");
  assert(recoveryPrepared.restart_pack_schema_ref === "recovery-pack/v1", "restart_prepare records recovery-pack schema ref");
  assert(JSON.parse(recoveryPrepared.restart_pack ?? "{}").confidence === "high", "restart_prepare emits recovery-pack JSON when requested");
  assert(recoveryPrepared.pack_ref === null, "structured restart_prepare still honors pack injection off");

  const downgraded = await prepareRestart(store, {
    agent_id: agentId,
    project,
    continuity_guard_mode: "auto_restart",
    aun_installed: true,
    supervisor_available: true,
    restart_preauthorized: true,
    emit_pack: false,
  });
  assert(downgraded.requested_continuity_guard_mode === "auto_restart", "restart_prepare records requested auto_restart");
  assert(downgraded.continuity_guard_mode === "recommend", "restart_prepare downgrades invalid auto_restart when AUN is installed");
  assert(downgraded.auto_restart_blockers.includes("aun_installed"), "restart_prepare explains AUN auto_restart blocker");
  assert(downgraded.can_auto_restart === false, "restart_prepare does not allow auto_restart with AUN installed");

  const allowedAuto = await prepareRestart(store, {
    agent_id: agentId,
    project,
    continuity_guard_mode: "auto_restart",
    aun_absent_confirmed: true,
    supervisor_available: true,
    restart_preauthorized: true,
    emit_pack: false,
  });
  assert(allowedAuto.continuity_guard_mode === "auto_restart", "restart_prepare keeps valid standalone auto_restart");
  assert(allowedAuto.can_auto_restart === true, "restart_prepare allows pre-authorized standalone auto_restart");

  const unknownAunAuto = await prepareRestart(store, {
    agent_id: agentId,
    project,
    continuity_guard_mode: "auto_restart",
    supervisor_available: true,
    restart_preauthorized: true,
    emit_pack: false,
  });
  assert(unknownAunAuto.continuity_guard_mode === "recommend", "restart_prepare downgrades auto_restart when AUN absence is unknown");
  assert(unknownAunAuto.auto_restart_blockers.includes("aun_absence_not_confirmed"), "restart_prepare requires explicit AUN absence confirmation");
  assert(unknownAunAuto.can_auto_restart === false, "restart_prepare does not allow auto_restart for unknown AUN status");

  const sparse = await prepareRestart(store, {
    agent_id: "test-restart-prepare-sparse-agent",
    project,
    emit_pack: false,
  });
  assert(sparse.context_signal.source === "estimated", "restart_prepare marks metric-absent signal as estimated");
  assert(sparse.recovery_confidence.missing_context.includes("active_task"), "restart_prepare reports missing active task");
  assert(sparse.action === "restart_recommended", "restart_prepare recommends restart on sparse semantic continuity");

  const contradictionAgentId = "test-restart-prepare-contradictory-agent";
  await store.saveTaskState({
    agent_id: contradictionAgentId,
    project,
    task: "AM-101 restart pack and continuity guard foundation",
    status: "in_progress",
    progress: "Contradictory-memory regression is under test.",
    next_steps: "Resolve the decision conflict before relying on recovery output.",
  });
  const positiveDecision = await store.logDecision({
    agent_id: contradictionAgentId,
    project,
    decision: "Use SQLite as the default backend for AM-101 continuity guard tests.",
    tags: ["AM-101", "continuity"],
  });
  const negativeDecision = await store.logDecision({
    agent_id: contradictionAgentId,
    project,
    decision: "Do not use SQLite as the default backend for AM-101 continuity guard tests.",
    tags: ["AM-101", "continuity"],
  });
  await store.saveKnowledge({
    agent_id: contradictionAgentId,
    project,
    title: "AM-101 continuity evidence",
    content: "Restart recovery must expose confidence, missing context, and provenance without runtime restart authority.",
    source_type: "manual",
    tags: ["AM-101"],
  });
  const contradictory = await prepareRestart(store, {
    agent_id: contradictionAgentId,
    project,
    pack_format: "recovery-pack-v1",
  });
  assert(contradictory.context_signal.source === "estimated", "restart_prepare labels contradictory-memory signal as estimated when metrics are absent");
  assert(contradictory.context_signal.band === "unknown", "restart_prepare does not invent context band for contradictory memory");
  assert(contradictory.action === "restart_recommended", "restart_prepare recommends restart for unresolved contradictory memory");
  assert(contradictory.recovery_confidence.missing_context.includes("contradictory_decisions"), "restart_prepare reports contradictory decisions as missing context");
  assert(contradictory.recovery_confidence.level === "medium", "restart_prepare lowers confidence for contradictory decisions");
  assert(contradictory.provenance.decision_ids.includes(positiveDecision.id), "restart_prepare provenance includes positive contradictory decision");
  assert(contradictory.provenance.decision_ids.includes(negativeDecision.id), "restart_prepare provenance includes negative contradictory decision");
  assert(contradictory.notes.some((note) => note.includes("contradictory_decisions")), "restart_prepare notes contradictory semantic degradation");
  const contradictoryPack = JSON.parse(contradictory.restart_pack ?? "{}");
  assert(validateRecoveryPackArtifact(contradictoryPack).valid, "contradictory recovery-pack/v1 remains valid");
  assert(contradictoryPack.missing_context.includes("contradictory_decisions"), "recovery-pack/v1 exposes contradictory decision missing context");
  assert(
    contradictoryPack.items.some((item: any) =>
      item.kind === "risk" &&
      item.source_ref.startsWith("decision:") &&
      item.summary.includes("Active decisions disagree")
    ),
    "recovery-pack/v1 includes provenance-bearing contradictory decision risk"
  );

  const packOnly = await prepareRestart(store, {
    agent_id: agentId,
    project,
    continuity_guard_mode: "pack_only",
    context_used_ratio: 0.99,
    emit_pack: false,
  });
  assert(packOnly.action === "pack_update_needed", "restart_prepare pack_only never emits restart_required");

  const offMode = await prepareRestart(store, {
    agent_id: agentId,
    project,
    continuity_guard_mode: "off",
    context_used_ratio: 0.99,
    emit_pack: false,
  });
  assert(offMode.context_signal.source === "host_metrics", "restart_prepare off mode still reports host metric provenance");
  assert(offMode.context_signal.band === "require", "restart_prepare off mode still reports observed require band");
  assert(offMode.action === "off", "restart_prepare off mode suppresses continuity recommendations");

  const packOff = await prepareRestart(store, {
    agent_id: agentId,
    project,
    pack_injection_mode: "off",
    emit_pack: false,
  });
  assert(packOff.pack_ref === null, "restart_prepare omits selected pack ref when pack injection is off");

  const parsed = parseRestartCliArgs([
    "prepare",
    "--agent-id",
    "agent",
    "--project",
    "proj",
    "--mode",
    "auto_restart",
    "--pack-injection-mode",
    "on_demand",
    "--context-used-ratio",
    "0.9",
    "--aun-installed",
    "--aun-absent",
    "--pack-format",
    "host-invocation-context-v1",
    "--target-runtime",
    "claude",
    "--delivery-mode",
    "session-start-hook",
    "--untrusted-context-policy",
    "quote-as-data-only",
    "--no-pack",
  ]);
  assert(parsed.command === "prepare", "wasurezu-restart parser reads prepare command");
  assert(parsed.agent_id === "agent", "wasurezu-restart parser reads agent id");
  assert(parsed.continuity_guard_mode === "auto_restart", "wasurezu-restart parser reads guard mode");
  assert(parsed.pack_injection_mode === "on_demand", "wasurezu-restart parser reads pack injection mode");
  assert(parsed.context_used_ratio === 0.9, "wasurezu-restart parser reads context ratio");
  assert(parsed.aun_installed === true, "wasurezu-restart parser reads AUN installed flag");
  assert(parsed.aun_absent_confirmed === true, "wasurezu-restart parser reads AUN absent confirmation flag");
  assert(parsed.pack_format === "host-invocation-context-v1", "wasurezu-restart parser reads selected pack format");
  assert(parsed.target_runtime === "claude", "wasurezu-restart parser reads target runtime");
  assert(parsed.delivery_mode === "session-start-hook", "wasurezu-restart parser reads delivery mode");
  assert(parsed.untrusted_context_policy === "quote-as-data-only", "wasurezu-restart parser reads untrusted context policy");
  assert(parsed.emit_pack === false, "wasurezu-restart parser reads no-pack flag");

  const parsedFetch = parseRestartCliArgs(["fetch", "--agent-id", "agent", "--pack-ref", "selected_restart_pack:abc", "--consume"]);
  assert(parsedFetch.command === "fetch", "wasurezu-restart parser reads fetch command");
  assert(parsedFetch.pack_ref === "selected_restart_pack:abc", "wasurezu-restart parser reads selected pack ref");
  assert(parsedFetch.consume === true, "wasurezu-restart parser reads consume flag");

  const distEntrypoint = join(process.cwd(), "dist/restart-cli.js");
  const symlinkDir = mkdtempSync(join(tmpdir(), "am038-restart-bin-"));
  const symlinkPath = join(symlinkDir, "wasurezu-restart");
  if (existsSync(distEntrypoint)) {
    symlinkSync(distEntrypoint, symlinkPath);
    assert(isRestartCliMainEntrypoint(symlinkPath, `file://${distEntrypoint}`), "wasurezu-restart entrypoint resolves npm bin symlinks");
    const help = execFileSync(process.execPath, [symlinkPath, "--help"], { encoding: "utf8" });
    assert(help.includes("wasurezu-restart"), "wasurezu-restart bin symlink executes CLI help");
    assert(help.includes("prepare"), "wasurezu-restart help documents prepare command");
    assert(help.includes("--pack-format"), "wasurezu-restart help documents selected pack format");
  } else {
    assert(true, "wasurezu-restart bin symlink test skipped because dist/restart-cli.js is absent");
  }
  rmSync(symlinkDir, { recursive: true, force: true });

  await store.close();
}

function testHostAdapterPackagingBoundary() {
  console.log("\n── Host Adapter Packaging Boundary Tests ──");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert(packageJson.files.includes("docs/operations/HOST_ADAPTERS.md"), "npm package includes host adapter docs");
  assert(packageJson.files.includes("docs/design/schemas"), "npm package includes structured artifact schemas");
  assert(packageJson.bin["wasurezu-restart"] === "dist/restart-cli.js", "npm package exposes wasurezu-restart CLI");
  assert(packageJson.bin["wasurezu-claude-start"] === "dist/claude-start.js", "npm package exposes wasurezu-claude-start CLI");
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
  assert(normalizedHostAdapters.includes("host-invocation-context/v1"), "host adapter docs require structured host invocation artifact");
  assert(lowerHostAdapters.includes("external/contextual content must remain data only"), "host adapter docs preserve data-only context boundary");
  assert(normalizedHostAdapters.includes("AUN, Shirube, or another installed runner owns lifecycle policy"), "host adapter docs preserve external runner lifecycle ownership");
  assert(normalizedHostAdapters.includes("The artifacts must not embed raw shell commands"), "host adapter docs keep raw shell commands out of recovery artifacts");
  assert(normalizedHostAdapters.includes("AUN CP-40D Runtime Invocation Alignment"), "host adapter docs include AUN CP-40D alignment");
  assert(normalizedHostAdapters.includes("not an AUN `RuntimeRunnerInvocation/v1`"), "host adapter docs keep Wasurezu artifact separate from AUN runner invocation");
  assert(normalizedHostAdapters.includes("RuntimeInvocationProfile/v1"), "host adapter docs reference AUN runtime profile ownership");
  assert(normalizedHostAdapters.includes("RuntimeRunnerResult/v1"), "host adapter docs reference AUN runner result evidence");
  assert(normalizedHostAdapters.includes("context_pack_refs"), "host adapter docs map recovery pack to AUN context pack refs");
  assert(normalizedHostAdapters.includes("scheduler activation, recovery success, merge authorization, final delivery proof"), "host adapter docs keep TUI fallback degraded under CP-40D");
  assert(normalizedHostAdapters.includes("`wasurezu-claude-start` prepares a selected `host-invocation-context/v1` pack"), "host adapter docs define Claude runner primary path");
  assert(normalizedHostAdapters.includes("SessionStart is a load hook, not the restart policy owner"), "host adapter docs keep Claude SessionStart as load hook");
  assert(normalizedHostAdapters.includes("`--launch` is fail-closed"), "host adapter docs document Claude runner launch fail-closed behavior");
  assert(normalizedHostAdapters.includes("The runner does not kill or replace existing Claude sessions"), "host adapter docs avoid claiming Claude process replacement");

  const ssot6 = readFileSync("docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md", "utf8");
  assert(ssot6.includes("top-level Wasurezu continuity"), "SSOT-6 is the top-level continuity authority");
  assert(ssot6.includes("TUI input, SessionStart self-kick"), "SSOT-6 marks TUI and SessionStart self-kick as fallback");
  assert(ssot6.includes("Wasurezu must not independently restart an AUN-supervised runtime"), "SSOT-6 preserves AUN suite boundary");
  assert(ssot6.includes("Lifecycle bands"), "SSOT-6 defines typed lifecycle bands");
  assert(ssot6.includes("recovery-pack/v1"), "SSOT-6 defines recovery-pack artifact");
  assert(ssot6.includes("host-invocation-context/v1"), "SSOT-6 defines host invocation artifact");

  const ssot7 = readFileSync("docs/design/core/SSOT-7_RUNTIME_AGENT_BINDING.md", "utf8");
  const normalizedSsot7 = ssot7.replace(/\s+/g, " ");
  assert(normalizedSsot7.includes("identity and runtime-binding SSOT"), "SSOT-7 owns runtime identity binding");
  assert(normalizedSsot7.includes("does not own restart policy"), "SSOT-7 does not own restart policy");
  assert(normalizedSsot7.includes("session_id` must not become the memory namespace"), "SSOT-7 keeps session_id out of memory namespace");
  assert(ssot7.includes("AUN Adapter Identity"), "SSOT-7 covers optional AUN adapter identity");

  const legacySsot = readFileSync("docs/SSOT.md", "utf8");
  assert(legacySsot.includes("Legacy v0.2 design reference"), "legacy SSOT is marked superseded");
  assert(legacySsot.includes("SSOT-6_LIVING_MEMORY_CONTROL.md"), "legacy SSOT points to SSOT-6");

  const apiContract = readFileSync("docs/design/core/SSOT-3_API_CONTRACT.md", "utf8");
  const normalizedApiContract = apiContract.replace(/\s+/g, " ");
  assert(normalizedApiContract.includes("mirrors the required API / runner shape only"), "SSOT-3 is limited to API/runner shape");
  assert(normalizedApiContract.includes("does not redefine lifecycle ownership or restart policy independently"), "SSOT-3 does not redefine lifecycle policy");
  assert(normalizedApiContract.includes("docs/design/schemas/recovery-pack-v1.schema.json"), "SSOT-3 points to recovery pack schema");
  assert(normalizedApiContract.includes("docs/design/schemas/host-invocation-context-v1.schema.json"), "SSOT-3 points to host invocation schema");
  assert(normalizedApiContract.includes("Cross-repo boundary with AUN CP-40D"), "SSOT-3 documents AUN CP-40D boundary");
  assert(normalizedApiContract.includes("Wasurezu `host-invocation-context/v1` is a recovery/context artifact, not an AUN `RuntimeRunnerInvocation/v1`"), "SSOT-3 keeps host invocation artifact out of AUN runner invocation ownership");
  assert(normalizedApiContract.includes("AUN runner code owns `RuntimeInvocationProfile/v1`"), "SSOT-3 assigns AUN runtime profile ownership");
  assert(normalizedApiContract.includes("Wasurezu `context_data` may be referenced by AUN as `context_pack_refs`"), "SSOT-3 maps context data to AUN context pack refs");
  assert(normalizedApiContract.includes("`wasurezu-claude-start` is the Claude host runner entrypoint"), "SSOT-3 documents Claude runner API boundary");
  assert(normalizedApiContract.includes("SessionStart remains the selected-pack load hook, not the restart policy owner"), "SSOT-3 pins Claude SessionStart boundary");

  const dataModel = readFileSync("docs/design/core/SSOT-4_DATA_MODEL.md", "utf8");
  const normalizedDataModel = dataModel.replace(/\s+/g, " ");
  assert(normalizedDataModel.includes("this file owns schema/data-model contracts"), "SSOT-4 is limited to schema/data-model contracts");
  assert(normalizedDataModel.includes("`raw_events` is implemented as the first AM-103 ledger slice"), "SSOT-4 marks raw_events implemented");
  assert(normalizedDataModel.includes("conversation events are mirrored into `raw_events`"), "SSOT-4 documents conversation-to-raw bridge");
  assert(normalizedDataModel.includes("Runtime adapters may append structured evidence, but they must not own lifecycle policy"), "SSOT-4 preserves adapter policy boundary");
  assert(normalizedDataModel.includes("API serialization should conform to `recovery-pack/v1`"), "SSOT-4 maps recovery pack schema to data model");
  assert(normalizedDataModel.includes("mark fallback delivery as `tui-fallback`"), "SSOT-4 maps fallback delivery evidence");

  const codexRecovery = readFileSync("docs/operations/CODEX_RECOVERY_CONTROL.md", "utf8");
  const normalizedCodexRecovery = codexRecovery.replace(/\s+/g, " ");
  assert(normalizedCodexRecovery.includes("launcher-controlled"), "Codex recovery docs prefer launcher-controlled recovery");
  assert(normalizedCodexRecovery.includes("soft fallback controls only"), "Codex recovery docs mark AGENTS/tool fallback as soft");
  assert(normalizedCodexRecovery.includes("target_runtime=codex"), "Codex recovery docs bind host invocation target runtime");
  assert(normalizedCodexRecovery.includes("delivery_mode=tui-fallback"), "Codex recovery docs label TUI fallback delivery");

  const hostContextHealth = readFileSync("docs/operations/HOST_CONTEXT_HEALTH_DESIGN.md", "utf8");
  const normalizedHostContextHealth = hostContextHealth.replace(/\s+/g, " ");
  assert(normalizedHostContextHealth.includes("not primarily an LLM prompt decision"), "host context health docs reject prompt-primary decisions");
  assert(normalizedHostContextHealth.includes("must not pretend to know actual context percentage"), "host context health docs require metric-source discipline");

  const recoveryPackSchema = JSON.parse(readFileSync("docs/design/schemas/recovery-pack-v1.schema.json", "utf8"));
  assert(recoveryPackSchema.$id.includes("recovery-pack-v1.schema.json"), "recovery-pack schema has stable id");
  assert(recoveryPackSchema.additionalProperties === false, "recovery-pack schema rejects additional properties");
  assert(sameStringSet(Object.keys(recoveryPackSchema.properties), RECOVERY_PACK_ALLOWED_KEYS), "recovery-pack validator keys match schema properties");
  assert(recoveryPackSchema.required.includes("pack_id"), "recovery-pack schema requires pack id");
  assert(recoveryPackSchema.required.includes("confidence"), "recovery-pack schema requires confidence");
  assert(recoveryPackSchema.required.includes("missing_context"), "recovery-pack schema requires missing context");
  assert(recoveryPackSchema.properties.token_budget.minimum === 1, "recovery-pack schema pins token budget minimum");
  assert(recoveryPackSchema.properties.confidence.enum.includes("low"), "recovery-pack schema has low confidence enum");
  assert(sameStringSet(Object.keys(recoveryPackSchema.properties.review_prompt.properties), RECOVERY_PACK_REVIEW_PROMPT_ALLOWED_KEYS), "recovery-pack review_prompt validator keys match schema properties");
  const recoveryItem = recoveryPackSchema.$defs.recovery_pack_item;
  assert(recoveryItem.additionalProperties === false, "recovery-pack item schema rejects additional properties");
  assert(sameStringSet(Object.keys(recoveryItem.properties), RECOVERY_PACK_ITEM_ALLOWED_KEYS), "recovery-pack item validator keys match schema properties");
  assert(recoveryItem.required.includes("source_ref"), "recovery-pack items require provenance source");
  assert(recoveryItem.properties.trust_level.enum.includes("external"), "recovery-pack items support external trust level");
  assert(recoveryItem.properties.sensitivity.enum.includes("secret_redacted"), "recovery-pack items record redaction status");

  const hostInvocationSchema = JSON.parse(readFileSync("docs/design/schemas/host-invocation-context-v1.schema.json", "utf8"));
  assert(hostInvocationSchema.$id.includes("host-invocation-context-v1.schema.json"), "host-invocation schema has stable id");
  assert(hostInvocationSchema.additionalProperties === false, "host-invocation schema rejects additional properties");
  assert(sameStringSet(Object.keys(hostInvocationSchema.properties), HOST_INVOCATION_CONTEXT_ALLOWED_KEYS), "host-invocation validator keys match schema properties");
  assert(hostInvocationSchema.required.includes("trusted_instruction"), "host-invocation schema requires trusted instruction");
  assert(hostInvocationSchema.properties.target_runtime.enum.includes("codex"), "host-invocation schema supports Codex");
  assert(hostInvocationSchema.properties.target_runtime.enum.includes("claude"), "host-invocation schema supports Claude");
  assert(hostInvocationSchema.properties.delivery_mode.enum.includes("stdin-json"), "host-invocation schema supports structured stdin delivery");
  assert(hostInvocationSchema.properties.delivery_mode.enum.includes("tui-fallback"), "host-invocation schema labels TUI fallback");
  assert(hostInvocationSchema.properties.untrusted_context_policy.enum.includes("quote-as-data-only"), "host-invocation schema requires data-only policy");
  const recoveryPackRef = hostInvocationSchema.properties.context_data.$ref;
  assert(readFileSync(join("docs/design/schemas", recoveryPackRef), "utf8").includes("Wasurezu Recovery Pack v1"), "host-invocation schema relative $ref resolves to recovery-pack schema");
}

function testConversationScopeSchemaRegression() {
  console.log("\n── MCP Schema Regression Tests ──");
  const source = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
  assert(source.includes('"conversation"'), "source search_memory schema includes conversation scope");
  assert(source.includes('"host-invocation-context-v1"'), "source restart_pack schema includes structured host invocation format");
  assert(source.includes("target_runtime"), "source restart_pack schema includes target runtime");
  assert(source.includes('"restart_prepare"'), "source MCP schema includes restart_prepare tool");
  assert(source.includes("pack_format"), "source restart_prepare schema includes selected pack format");
  assert(source.includes('"restart_pack_fetch"'), "source MCP schema includes restart_pack_fetch tool");
  assert(source.includes("does not stop, restart, requeue"), "source restart_prepare description preserves lifecycle boundary");
  assert(source.includes("aun_absent_confirmed"), "source restart_prepare schema exposes explicit AUN absence evidence");
  assert(source.includes("unknown AUN status downgrades to recommend"), "source restart_prepare description documents AUN-unknown fail-closed behavior");
  assert(source.includes("redacted full-text conversation event storage"), "source conversation ingest description avoids raw transcript claim");
  const constants = readFileSync(join(process.cwd(), "src/constants.ts"), "utf8");
  assert(constants.includes("adaptive retrieval layer"), "source search_memory description includes adaptive retrieval trigger");
  assert(constants.includes("before making architectural or design decisions"), "source search_memory description says when to search");

  const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
  assert(readme.includes("redacted full-text event storage"), "README documents conversation memory as redacted full-text storage");
  assert(readme.includes("does not emit raw transcript excerpts"), "README documents restart_pack transcript boundary");
  assert(readme.includes("host-invocation-context/v1"), "README documents structured restart_pack automation output");
  assert(readme.includes("`pack_format`"), "README documents structured selected-pack persistence");
  assert(readme.includes("wasurezu-claude-start"), "README documents Claude resession runner");
  assert(readme.includes("SessionStart self-kick"), "README keeps Claude self-kick fallback-only boundary");
  const apiContract = readFileSync(join(process.cwd(), "docs/design/core/SSOT-3_API_CONTRACT.md"), "utf8");
  assert(apiContract.includes("restart_prepare"), "API contract documents restart_prepare");
  assert(apiContract.includes("does not stop, restart, requeue"), "API contract preserves restart_prepare lifecycle boundary");
  assert(apiContract.includes("restart_pack_fetch"), "API contract documents restart_pack_fetch");
  assert(apiContract.includes("pack_format=recovery-pack-v1"), "API contract documents structured selected-pack format");
  assert(apiContract.includes("published JSON Schema"), "API contract documents canonical schema validation");
  assert(apiContract.includes("selected_restart_pack:<id>"), "API contract documents selected restart pack refs");
  assert(apiContract.includes("AGENT_MEMORY_SELECTED_PACK_REF"), "API contract documents boot selected-pack consume");
  assert(apiContract.includes("wasurezu-claude-start"), "API contract documents Claude runner");
  const dataModel = readFileSync(join(process.cwd(), "docs/design/core/SSOT-4_DATA_MODEL.md"), "utf8");
  assert(dataModel.includes("redacted full-text conversation event"), "data model documents redacted full-text conversation events");
  assert(dataModel.includes("exclude hidden reasoning"), "data model documents conversation event filtering boundary");
  assert(dataModel.includes("selected_restart_packs"), "data model documents selected restart packs");

  const distPath = join(process.cwd(), "dist/index.js");
  if (existsSync(distPath)) {
    const dist = readFileSync(distPath, "utf8");
    assert(dist.includes('"conversation"'), "built MCP schema includes conversation scope");
    assert(dist.includes('"host-invocation-context-v1"'), "built MCP schema includes structured host invocation format");
    assert(dist.includes("target_runtime"), "built MCP schema includes target runtime");
    assert(dist.includes('"restart_prepare"'), "built MCP schema includes restart_prepare tool");
    assert(dist.includes("pack_format"), "built MCP schema includes selected pack format");
    assert(dist.includes('"restart_pack_fetch"'), "built MCP schema includes restart_pack_fetch tool");
    assert(dist.includes("aun_absent_confirmed"), "built MCP schema exposes explicit AUN absence evidence");
    const distConstants = readFileSync(join(process.cwd(), "dist/constants.js"), "utf8");
    assert(distConstants.includes("adaptive retrieval layer"), "built MCP schema includes adaptive retrieval trigger");
  } else {
    assert(true, "built MCP schema check skipped because dist/index.js is absent");
  }
}

function testGovernedActionProfiles() {
  console.log("\n── Governed Action Profile Tests ──");
  const profileDoc = readFileSync("docs/design/governance/WASUREZU_GOVERNED_ACTION_PROFILES.md", "utf8");
  const profileJson = JSON.parse(readFileSync("docs/design/governance/wasurezu-governed-action-profiles.v1.json", "utf8"));
  const source = readFileSync("src/index.ts", "utf8");
  const apiContract = readFileSync("docs/design/core/SSOT-3_API_CONTRACT.md", "utf8");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  assert(packageJson.files.includes("docs/design/governance"), "npm package includes governed action profiles");
  assert(profileDoc.includes("Aun Gate-ready"), "governed action profile docs state Aun Gate readiness purpose");
  assert(profileDoc.includes("Private reasoning is excluded by default"), "governed action profile docs exclude private reasoning by default");
  assert(profileDoc.includes("set_recovery_config` is critical"), "governed action profile docs mark recovery config as critical");
  assert(apiContract.includes("wasurezu-governed-action-profiles.v1.json"), "SSOT-3 points to governed action profiles");

  const arcSchema = JSON.parse(readFileSync("docs/design/governance/governed-action-surface-profile.schema.json", "utf8"));
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(arcSchema);
  assert(validate(profileJson), `governed action profile validates against ARC schema: ${JSON.stringify(validate.errors ?? [])}`);
  assert(profileJson.profile_version === "0.1.0", "governed action profile pins ARC profile version");
  assert(Array.isArray(profileJson.surfaces), "governed action profile contains surfaces array");

  const sourceToolNames = mcpToolNamesFromSource(source);
  const profileToolNames = profileJson.surfaces.map((surface: any) => String(surface.surface_id).replace(/^wasurezu\./, ""));
  assert(sameStringSet(profileToolNames, sourceToolNames), "every MCP tool has exactly one governed action profile");

  const allowedClasses = ["read", "reveal", "write", "delete", "action", "external_send", "admin", "execute_code"];
  const allowedRisks = ["low", "medium", "high", "critical"];
  for (const surface of profileJson.surfaces) {
    assert(surface.surface_type === "mcp_tool", `${surface.surface_id} profile is an MCP tool`);
    assert(Array.isArray(surface.capability_classes) && surface.capability_classes.length > 0, `${surface.surface_id} declares capability classes`);
    assert(surface.capability_classes.every((klass: string) => allowedClasses.includes(klass)), `${surface.surface_id} uses known capability classes`);
    assert(allowedRisks.includes(surface.risk_level), `${surface.surface_id} declares known risk level`);
    assert(surface.boundary?.standalone_required === true, `${surface.surface_id} declares standalone boundary`);
    assert(surface.boundary?.state_owner === "wasurezu", `${surface.surface_id} assigns Wasurezu state ownership`);
    assert(surface.boundary?.direct_db_access_to_other_products === false, `${surface.surface_id} forbids direct DB access to other products`);
    assert(Array.isArray(surface.boundary?.forbidden_dependencies), `${surface.surface_id} declares forbidden dependencies`);
    assert(surface.boundary.forbidden_dependencies.includes("shared_credentials"), `${surface.surface_id} forbids shared credentials`);
    assert(surface.identity_requirements?.actor_required === true, `${surface.surface_id} requires actor evidence`);
    assert(surface.identity_requirements?.agent_id_required === true, `${surface.surface_id} requires agent id evidence`);
    assert(Array.isArray(surface.context_requirements?.denied_labels), `${surface.surface_id} declares denied context labels`);
    assert(surface.context_requirements.denied_labels.includes("private_reasoning"), `${surface.surface_id} denies private reasoning by default`);
    assert(typeof surface.approval_policy?.approval_required === "boolean", `${surface.surface_id} declares approval policy`);
    assert(surface.audit_policy?.audit_required === true, `${surface.surface_id} requires audit`);
    assert(surface.audit_policy?.redaction_required === true, `${surface.surface_id} requires redaction`);
    assert(typeof surface.rollback_policy?.rollback_kind === "string", `${surface.surface_id} declares rollback policy`);
    assert(typeof surface.notes === "string" && surface.notes.includes("redaction_requirements="), `${surface.surface_id} records redaction requirements in notes`);
    assert(surface.notes.includes("retention_requirements="), `${surface.surface_id} records retention requirements in notes`);
  }

  const byId = new Map(profileJson.surfaces.map((surface: any) => [surface.surface_id, surface]));
  const setConfig = byId.get("wasurezu.set_recovery_config") as any;
  assert(setConfig.risk_level === "critical", "set_recovery_config is critical risk");
  assert(setConfig.capability_classes.includes("admin"), "set_recovery_config is an admin surface");
  assert(setConfig.approval_policy.approval_required === true, "set_recovery_config requires approval");
  assert(setConfig.memory_requirements.approval_note_required === true, "set_recovery_config requires approval-note evidence");
  assert(setConfig.memory_requirements.human_intent_ref_required === true, "set_recovery_config requires human intent evidence");
  assert(setConfig.notes.includes("critical_admin_surface"), "set_recovery_config notes explain critical admin surface");

  for (const id of ["wasurezu.search_memory", "wasurezu.recover_context", "wasurezu.restart_pack", "wasurezu.restart_pack_fetch", "wasurezu.restart_prepare"]) {
    const profile = byId.get(id) as any;
    assert(profile.risk_level === "high", `${id} is high risk read/reveal`);
    assert(profile.capability_classes.includes("reveal"), `${id} declares reveal capability`);
    assert(profile.context_requirements.required_labels.includes("redaction_evidence"), `${id} requires redaction evidence label`);
  }

  const ingest = byId.get("wasurezu.ingest_conversation_events") as any;
  assert(ingest.capability_classes.includes("action"), "ingest_conversation_events is an action surface");
  assert(ingest.context_requirements.denied_labels.includes("developer_instruction"), "ingest_conversation_events excludes developer instructions");
  assert(ingest.context_requirements.denied_labels.includes("base_instruction"), "ingest_conversation_events excludes base instructions");
  assert(ingest.notes.includes("redact_before_persistence_and_hashing"), "ingest_conversation_events redacts before persistence and hashing");
  assert(ingest.notes.includes("transcript_events_are_source_data_not_approved_memory_by_default"), "ingest_conversation_events keeps transcripts as source data");

  const restartPrepare = byId.get("wasurezu.restart_prepare") as any;
  assert(restartPrepare.context_requirements.denied_labels.includes("aun_queue_mutation"), "restart_prepare profile forbids AUN queue mutation");
  assert(restartPrepare.context_requirements.denied_labels.includes("runtime_restart_authority"), "restart_prepare profile forbids runtime restart authority");
  assert(restartPrepare.boundary.receiving_product_revalidates === true, "restart_prepare artifact consumers revalidate");

  const restartPack = byId.get("wasurezu.restart_pack") as any;
  assert(restartPack.notes.includes("shell_free_trusted_instruction"), "restart_pack profile requires shell-free trusted instruction");
}

function testAunGateEvidenceRefs() {
  console.log("\n── Aun Gate Evidence Ref Tests ──");
  const schema = JSON.parse(readFileSync("docs/design/schemas/aun-gate-evidence-refs-v1.schema.json", "utf8"));
  const evidenceDoc = readFileSync("docs/design/governance/WASUREZU_AUN_GATE_EVIDENCE_REFS.md", "utf8");
  const normalizedEvidenceDoc = evidenceDoc.replace(/\s+/g, " ");
  const apiContract = readFileSync("docs/design/core/SSOT-3_API_CONTRACT.md", "utf8");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  assert(packageJson.files.includes("docs/design/schemas"), "npm package includes Aun Gate evidence schema directory");
  assert(packageJson.files.includes("docs/design/governance"), "npm package includes Aun Gate evidence governance docs");
  assert(normalizedEvidenceDoc.includes("does not authorize action execution"), "Aun Gate evidence docs keep Wasurezu out of execution authorization");
  assert(evidenceDoc.includes("AUN owns approval lifecycle"), "Aun Gate evidence docs preserve AUN approval ownership");
  assert(evidenceDoc.includes("Private reasoning is excluded by default"), "Aun Gate evidence docs exclude private reasoning by default");
  assert(evidenceDoc.includes("missing_evidence` must contain that exact field name"), "Aun Gate evidence docs require missing field names");
  assert(apiContract.includes("Aun Gate Evidence Refs (AM-119)"), "SSOT-3 documents Aun Gate evidence refs");
  assert(apiContract.includes("wasurezu-aun-gate-evidence-refs/v1"), "SSOT-3 points to Aun Gate evidence schema ref");
  assert(apiContract.includes("missing_evidence` must contain that exact field name"), "SSOT-3 requires missing field names");

  const requiredRefs = [
    "recovery_pack_id",
    "memory_event_ids",
    "human_intent_ref",
    "approval_note_ref",
    "redaction_summary",
    "retention_policy_ref",
    "resume_ref",
    "rollback_context_ref",
  ];
  for (const field of requiredRefs) {
    assert(schema.required.includes(field), `Aun Gate evidence schema requires ${field}`);
    assert(apiContract.includes(field), `SSOT-3 documents ${field}`);
    assert(evidenceDoc.includes(field), `Aun Gate evidence docs document ${field}`);
  }

  const sample = {
    schema_ref: "wasurezu-aun-gate-evidence-refs/v1",
    contract_version: "0.1.0",
    provider_product: "wasurezu",
    owner_repo: "watchout/agent-memory",
    evidence_owner: "wasurezu",
    execution_owner: "aun",
    authorizes_execution: false,
    mutates_aun_lifecycle: false,
    recovery_pack_id: "restart_pack:aun:test:123",
    memory_event_ids: ["conversation_event:abc", "decision:def"],
    human_intent_ref: "human_intent:github-issue-119",
    approval_note_ref: "approval_note:manual-review-123",
    redaction_summary: {
      mode: "redacted-before-emit",
      status: "full",
      private_reasoning_excluded: true,
      redacted_counts: {
        secret: 1,
        pii: 2,
      },
      omitted_counts: {
        private_reasoning: 3,
      },
      notes: ["raw transcript remains source data"],
    },
    retention_policy_ref: "retention_policy:memory-default",
    resume_ref: "selected_restart_pack:abc",
    rollback_context_ref: "rollback_context:manual-reconcile-123",
    private_reasoning_included: false,
    source_refs: ["docs/design/core/SSOT-3_API_CONTRACT.md", "docs/design/schemas/recovery-pack-v1.schema.json"],
    missing_evidence: [],
  };
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(schema);
  assert(validate(sample), `Aun Gate evidence ref sample validates: ${JSON.stringify(validate.errors ?? [])}`);

  const withExtra = { ...sample, execution_allowed: true };
  assert(!validate(withExtra), "Aun Gate evidence schema rejects additional properties");

  const executionAuthority = { ...sample, authorizes_execution: true };
  assert(!validate(executionAuthority), "Aun Gate evidence schema rejects Wasurezu execution authorization");

  const lifecycleMutation = { ...sample, mutates_aun_lifecycle: true };
  assert(!validate(lifecycleMutation), "Aun Gate evidence schema rejects AUN lifecycle mutation");

  const privateReasoning = { ...sample, private_reasoning_included: true };
  assert(!validate(privateReasoning), "Aun Gate evidence schema rejects private reasoning inclusion");

  const weakRedaction = {
    ...sample,
    redaction_summary: {
      ...sample.redaction_summary,
      private_reasoning_excluded: false,
    },
  };
  assert(!validate(weakRedaction), "Aun Gate evidence schema requires redaction summary to exclude private reasoning");

  const emptyEvidence = {
    ...sample,
    recovery_pack_id: null,
    memory_event_ids: [],
    human_intent_ref: null,
    approval_note_ref: null,
    retention_policy_ref: null,
    resume_ref: null,
    rollback_context_ref: null,
    source_refs: [],
    missing_evidence: [],
  };
  assert(!validate(emptyEvidence), "Aun Gate evidence schema rejects null/empty refs without missing_evidence");

  const explicitMissingEvidence = {
    ...emptyEvidence,
    missing_evidence: [
      "recovery_pack_id",
      "memory_event_ids",
      "human_intent_ref",
      "approval_note_ref",
      "retention_policy_ref",
      "resume_ref",
      "rollback_context_ref",
      "source_refs",
    ],
  };
  assert(validate(explicitMissingEvidence), `Aun Gate evidence schema allows explicit missing evidence: ${JSON.stringify(validate.errors ?? [])}`);
}

function testMemorySafetyGovernance() {
  console.log("\n── Memory Safety Governance Tests ──");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const memorySafety = readFileSync("docs/design/governance/WASUREZU_MEMORY_SAFETY_GOVERNANCE.md", "utf8");
  const normalizedMemorySafety = memorySafety.replace(/\s+/g, " ");
  const ssot6 = readFileSync("docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md", "utf8");
  const dataModel = readFileSync("docs/design/core/SSOT-4_DATA_MODEL.md", "utf8");
  const recoveryPackSchema = JSON.parse(readFileSync("docs/design/schemas/recovery-pack-v1.schema.json", "utf8"));
  const evidenceRefsSchema = JSON.parse(readFileSync("docs/design/schemas/aun-gate-evidence-refs-v1.schema.json", "utf8"));

  assert(packageJson.files.includes("docs/design/governance"), "npm package includes memory safety governance docs");
  assert(ssot6.includes("WASUREZU_MEMORY_SAFETY_GOVERNANCE.md"), "SSOT-6 delegates memory safety governance");
  assert(ssot6.includes("#117 maps to `WASUREZU_MEMORY_SAFETY_GOVERNANCE.md`"), "SSOT-6 maps AM-117 to memory safety governance");
  assert(dataModel.includes("WASUREZU_MEMORY_SAFETY_GOVERNANCE.md"), "SSOT-4 references memory safety governance");

  for (const memoryClass of ["raw_event_source", "candidate_memory", "approved_memory", "trusted_instruction", "untrusted_context"]) {
    assert(memorySafety.includes(memoryClass), `memory safety taxonomy defines ${memoryClass}`);
  }

  assert(normalizedMemorySafety.includes("Raw events and imported transcripts are source data by default, not approved memory"), "raw events and transcripts are source data by default");
  assert(normalizedMemorySafety.includes("Candidate memory is not a trusted instruction"), "candidate memory is not trusted instruction");
  assert(normalizedMemorySafety.includes("Approved memory requires human or policy promotion evidence"), "approved memory requires promotion evidence");
  assert(normalizedMemorySafety.includes("`trusted_instruction` is control-plane-authored text, not memory content"), "trusted instruction is not memory content");
  assert(normalizedMemorySafety.includes("Conversation events must not become approved memory merely because they were stored, searched, summarized, or included in a recovery pack"), "conversation events are not auto-approved memory");
  assert(normalizedMemorySafety.includes("Do not claim full enterprise enforcement until structured recovery output emits or links explicit `policy_version`, redaction summary, omission counts, and promotion evidence"), "docs avoid overclaiming full enterprise enforcement");

  for (const evidence of ["policy_version", "redaction summary", "omission counts", "retention policy", "promotion evidence", "missing-context indicators"]) {
    assert(normalizedMemorySafety.includes(evidence), `memory safety governance documents ${evidence}`);
  }

  assert(normalizedMemorySafety.includes("AUN owns approval lifecycle, policy decisions, execution attempts"), "memory safety docs preserve AUN boundary");
  assert(normalizedMemorySafety.includes("Shirube owns Work Order authority"), "memory safety docs preserve Shirube boundary");
  assert(normalizedMemorySafety.includes("Kodama owns source permission labels"), "memory safety docs preserve Kodama boundary");

  assert(recoveryPackSchema.properties.confidence, "recovery-pack schema exposes confidence");
  assert(recoveryPackSchema.properties.missing_context, "recovery-pack schema exposes missing context");
  const recoveryItem = recoveryPackSchema.$defs.recovery_pack_item;
  assert(recoveryItem.properties.source_ref, "recovery-pack item exposes source refs");
  assert(recoveryItem.properties.trust_level, "recovery-pack item exposes trust classification");
  assert(recoveryItem.properties.sensitivity, "recovery-pack item exposes sensitivity/redaction state");
  assert(evidenceRefsSchema.properties.redaction_summary, "Aun Gate evidence refs expose redaction summary");
  assert(evidenceRefsSchema.properties.retention_policy_ref, "Aun Gate evidence refs expose retention policy ref");
  assert(evidenceRefsSchema.properties.approval_note_ref, "Aun Gate evidence refs expose approval-note evidence");
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
  await testClaudeResessionRunner();
  await testRestartPrepare();
  testHostAdapterPackagingBoundary();
  testConversationScopeSchemaRegression();
  testGovernedActionProfiles();
  testAunGateEvidenceRefs();
  testMemorySafetyGovernance();

  await cleanup();

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
