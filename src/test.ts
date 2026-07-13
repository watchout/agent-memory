#!/usr/bin/env node
/**
 * Basic integration tests for agent-memory JSON store.
 * Run: tsx src/test.ts
 */
import { JsonStore } from "./stores/json-store.js";
import { SqliteStore } from "./stores/sqlite-store.js";
import { createStore } from "./stores/index.js";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { homedir, tmpdir } from "os";
import { createHash } from "crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Ajv2020 from "ajv/dist/2020.js";
import { validateHostInvocationContextJsonSchema, validateRecoveryPackJsonSchema } from "./artifact-schema-validator.js";
import { buildCatchUpSourceADryRunManifest } from "./catch-up.js";
import { ingestClaudeConversationEvents } from "./claude-conversation-ingest.js";
import { ingestCodexConversationEvents } from "./codex-conversation-ingest.js";
import {
  inspectRawCaptureCoverage,
  rawCaptureMissingContext,
  summarizeRawCaptureCoverage,
} from "./raw-capture-coverage.js";
import { PG_MIGRATIONS } from "./stores/pg-migrations.js";
import {
  HOST_INVOCATION_CONTEXT_ALLOWED_KEYS,
  RECOVERY_PACK_POLICY_VERSION,
  RECOVERY_PACK_SCHEMA_REF,
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
  validateRecoveryPackCl2Profile,
  validateRecoveryPackArtifact,
} from "./restart-pack.js";
import { prepareRestart } from "./restart-prepare.js";
import {
  isMainEntrypoint as isRestartCliMainEntrypoint,
  parseRestartCliArgs,
} from "./restart-cli.js";
import { preflightRestartCommand } from "./restart-command-preflight.js";
import { runSupervisorPreflight } from "./restart-cli.js";
import { writeRestartMarker } from "./context-restart-marker.js";
import { runRestartBridge, type QueueDrainCheckResult } from "./restart-bridge.js";
import { redactText } from "./redact.js";
import {
  CODEX_ARGV_VISIBILITY_NOTE,
  CODEX_POSITIONAL_PROMPT_CONTRACT,
  CODEX_STARTUP_BRIDGE_ENV,
  buildCodexDoctorReport,
  buildCodexLaunchArgs,
  buildCodexLaunchEnv,
  buildCodexLaunchPreview,
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
import { controlClaudeRestartMarker } from "./claude-marker-controller.js";
import type { LogRecoveryQualityInput, SaveRestartHostAdapterInput, SaveRestartRuntimeAuthorityInput } from "./stores/types.js";

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

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function canonicalJsonForTest(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonForTest).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonForTest(record[key])}`)
    .join(",")}}`;
}

function mcpToolNamesFromSource(source: string): string[] {
  return Array.from(source.matchAll(/server\.tool\(\s*\n\s*"([^"]+)"/g), (match) => match[1]);
}

function toolResultText(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
}

function inheritedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

async function cleanup() {
  const files = [
    "decisions.json",
    "task-states.json",
    "knowledge.json",
    "conversation-events.json",
    "raw-events.json",
    "restart-events.json",
  ];
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

async function assertCreateStoreFailsClosed(label: string) {
  let failedClosed = false;
  try {
    await createStore();
  } catch {
    failedClosed = true;
  }
  assert(failedClosed, label);
}

async function testPostgresStoreIntentFailsClosed() {
  console.log("\n── PostgreSQL Store Intent Tests ──");
  const originalDbType = process.env.AGENT_MEMORY_DB_TYPE;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAgentMemoryDatabaseUrl = process.env.AGENT_MEMORY_DATABASE_URL;
  const originalAgentMemoryDbPath = process.env.AGENT_MEMORY_DB_PATH;
  const originalPgConnectTimeout = process.env.PGCONNECT_TIMEOUT;
  const sqliteDefaultRoot = mkdtempSync(join(tmpdir(), "am-store-selection-"));
  try {
    delete process.env.AGENT_MEMORY_DB_TYPE;
    delete process.env.DATABASE_URL;
    delete process.env.AGENT_MEMORY_DATABASE_URL;
    process.env.AGENT_MEMORY_DB_PATH = join(sqliteDefaultRoot, "memory.db");
    const defaultStore = await createStore();
    assert(defaultStore instanceof SqliteStore, "no PostgreSQL URL uses SQLite default");
    await defaultStore.close();

    process.env.AGENT_MEMORY_DB_TYPE = "sqlite";
    process.env.DATABASE_URL = "postgresql://127.0.0.1:1/agent_memory_explicit_sqlite";
    const explicitSqliteStore = await createStore();
    assert(explicitSqliteStore instanceof SqliteStore, "explicit sqlite mode overrides inherited PostgreSQL URL");
    await explicitSqliteStore.close();

    process.env.AGENT_MEMORY_DB_TYPE = "postgres";
    process.env.DATABASE_URL = "postgresql://127.0.0.1:1/agent_memory_fail_closed";
    delete process.env.AGENT_MEMORY_DATABASE_URL;
    process.env.PGCONNECT_TIMEOUT = "1";
    await assertCreateStoreFailsClosed("explicit postgres mode refuses SQLite fallback on connection failure");

    delete process.env.AGENT_MEMORY_DB_TYPE;
    delete process.env.DATABASE_URL;
    process.env.AGENT_MEMORY_DATABASE_URL = "postgresql://127.0.0.1:1/agent_memory_fail_closed";
    await assertCreateStoreFailsClosed("AGENT_MEMORY_DATABASE_URL refuses SQLite fallback on connection failure");

    delete process.env.AGENT_MEMORY_DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://127.0.0.1:1/agent_memory_fail_closed";
    await assertCreateStoreFailsClosed("legacy DATABASE_URL refuses SQLite fallback on connection failure");
  } finally {
    restoreEnv("AGENT_MEMORY_DB_TYPE", originalDbType);
    restoreEnv("DATABASE_URL", originalDatabaseUrl);
    restoreEnv("AGENT_MEMORY_DATABASE_URL", originalAgentMemoryDatabaseUrl);
    restoreEnv("AGENT_MEMORY_DB_PATH", originalAgentMemoryDbPath);
    restoreEnv("PGCONNECT_TIMEOUT", originalPgConnectTimeout);
    rmSync(sqliteDefaultRoot, { recursive: true, force: true });
  }
}

function testRawCaptureCoverage() {
  console.log("\n── Raw Capture Coverage Tests ──");
  const since = "2026-05-18T00:00:00.000Z";

  const unknownRoot = mkdtempSync(join(tmpdir(), "am139-unknown-"));
  writeFileSync(join(unknownRoot, "session-a.jsonl"), "{}\n");
  writeFileSync(join(unknownRoot, "dev@example.com.txt"), "do not ingest this content sk-test-secret\n");
  const unknown = inspectRawCaptureCoverage({
    source: "claude_code",
    project: "dev-auditor",
    root: unknownRoot,
    since,
  });
  const unknownSource = unknown.sources[0];
  assert(unknown.status === "degraded", "raw capture unknown files degrade coverage");
  assert(unknown.project === "dev-auditor", "raw capture coverage reports project");
  assert(unknownSource.known_files === 1, "raw capture counts known transcript files");
  assert(unknownSource.unknown_files === 1, "raw capture counts unknown transcript files");
  assert(unknown.missing_context.includes("raw_capture_unknown_files"), "unknown files become missing context");
  const unknownRef = unknownSource.source_refs.find((ref) => ref.type === "unknown_file")?.ref ?? "";
  assert(!unknownRef.includes("dev@example.com"), "unknown file refs are redacted");
  assert(!unknownRef.includes("sk-test-secret"), "unknown file contents are not exposed");

  const staleRoot = mkdtempSync(join(tmpdir(), "am139-stale-"));
  writeFileSync(join(staleRoot, "session-b.jsonl"), "{}\n");
  const stale = inspectRawCaptureCoverage({
    source: "codex",
    root: staleRoot,
    since,
    cursor_updated_at: new Date(Date.now() - 60_000).toISOString(),
    stale_after_ms: 1,
  });
  assert(stale.status === "degraded", "stale raw capture cursor degrades coverage");
  assert(stale.missing_context.includes("raw_capture_cursor_stale"), "stale cursor becomes missing context");

  const backlogRoot = mkdtempSync(join(tmpdir(), "am139-backlog-"));
  writeFileSync(join(backlogRoot, "session-1.jsonl"), "{}\n");
  writeFileSync(join(backlogRoot, "session-2.jsonl"), "{}\n");
  writeFileSync(join(backlogRoot, "session-3.jsonl"), "{}\n");
  const backlog = inspectRawCaptureCoverage({
    source: "claude_code",
    root: backlogRoot,
    since,
    max_files: 1,
    pending_events: 2,
  });
  assert(backlog.status === "degraded", "pending raw capture backlog degrades coverage");
  assert(backlog.sources[0].pending_files === 2, "raw capture reports pending transcript files");
  assert(backlog.sources[0].pending_events === 2, "raw capture reports pending backlog events separately");
  assert(backlog.missing_context.includes("raw_capture_backlog_pending"), "pending backlog becomes missing context");
  assert(rawCaptureMissingContext(backlog).includes("raw_capture_backlog_pending"), "raw capture missing-context helper reports backlog");
  assert(
    summarizeRawCaptureCoverage(backlog).some((note) => note.includes("pending_files=2")),
    "raw capture coverage notes distinguish pending backlog"
  );

  const cleanRoot = mkdtempSync(join(tmpdir(), "am139-clean-"));
  writeFileSync(join(cleanRoot, "session-clean.jsonl"), "{}\n");
  const clean = inspectRawCaptureCoverage({
    source: "codex",
    root: cleanRoot,
    since,
    cursor_updated_at: new Date().toISOString(),
    stale_after_ms: 60_000,
  });
  assert(clean.status === "clean", "clean raw capture coverage passes");
  assert(clean.missing_context.length === 0, "clean raw capture has no missing context");

  rmSync(unknownRoot, { recursive: true, force: true });
  rmSync(staleRoot, { recursive: true, force: true });
  rmSync(backlogRoot, { recursive: true, force: true });
  rmSync(cleanRoot, { recursive: true, force: true });
}

function testCatchUpSourceADryRun() {
  console.log("\n── Catch-Up Source A Dry-Run Tests ──");
  const since = "2026-05-18T00:00:00.000Z";
  const until = "2026-05-20T00:00:00.000Z";
  const inRange = new Date("2026-05-19T00:00:00.000Z");
  const old = new Date("2026-05-17T00:00:00.000Z");

  const claudeRoot = mkdtempSync(join(tmpdir(), "am058-claude-"));
  const claudeProject = join(claudeRoot, "project-dev@example.com");
  mkdirSync(claudeProject, { recursive: true });
  const claudeCandidate = join(claudeProject, "session-a.jsonl");
  const claudeOld = join(claudeProject, "session-old.jsonl");
  writeFileSync(claudeCandidate, JSON.stringify({ type: "user", timestamp: since }) + "\n");
  writeFileSync(claudeOld, JSON.stringify({ type: "user", timestamp: "2026-05-17T00:00:00.000Z" }) + "\n");
  utimesSync(claudeCandidate, inRange, inRange);
  utimesSync(claudeOld, old, old);

  const codexRoot = mkdtempSync(join(tmpdir(), "am058-codex-"));
  const codexDir = join(codexRoot, "2026", "05", "19");
  mkdirSync(codexDir, { recursive: true });
  const codexOne = join(codexDir, "rollout-one.jsonl");
  const codexTwo = join(codexDir, "rollout-two.jsonl");
  writeFileSync(codexOne, JSON.stringify({ type: "session_meta", timestamp: since }) + "\n");
  writeFileSync(codexTwo, JSON.stringify({ type: "response_item", timestamp: since }) + "\n");
  utimesSync(codexOne, inRange, inRange);
  utimesSync(codexTwo, inRange, inRange);

  const manifest = buildCatchUpSourceADryRunManifest({
    source: "all",
    project: "dev-auditor",
    since,
    until,
    roots: {
      claude_code: claudeRoot,
      codex: codexRoot,
    },
    max_files: 1,
  });

  assert(manifest.dry_run === true, "catch-up Source A manifest is dry-run");
  assert(manifest.writes_performed === false, "catch-up Source A dry-run performs no writes");
  assert(manifest.approved_memory_promoted === false, "catch-up Source A dry-run promotes no approved memory");
  assert(manifest.policy_version === "catch-up-source-a-dry-run-v1", "catch-up Source A manifest records policy version");
  assert(manifest.project === "dev-auditor", "catch-up Source A manifest reports project");
  assert(manifest.totals.candidate_files === 3, "catch-up Source A manifest counts bounded candidates before max-file truncation");
  assert(manifest.totals.emitted_refs === 2, "catch-up Source A manifest emits bounded refs per source");
  assert(manifest.totals.skipped_files === 1, "catch-up Source A manifest reports skipped over-limit files");
  assert(manifest.notes.some((note) => note.includes("source data only")), "catch-up Source A manifest keeps logs as source data");

  const claude = manifest.sources.find((source) => source.source === "claude_code");
  const codex = manifest.sources.find((source) => source.source === "codex");
  assert(claude?.status === "ready", "catch-up Source A reports Claude discovery ready");
  assert(claude?.candidate_files === 1, "catch-up Source A filters Claude files by since/until");
  assert(claude?.candidate_refs.length === 1, "catch-up Source A emits Claude candidate ref");
  assert(!(claude?.candidate_refs[0].source_ref ?? "").includes("dev@example.com"), "catch-up Source A redacts email in provenance refs");
  assert(codex?.candidate_files === 2, "catch-up Source A discovers Codex session files");
  assert(codex?.emitted_refs === 1, "catch-up Source A bounds Codex emitted refs");
  assert(codex?.skipped_reasons.includes("max_files_exceeded") === true, "catch-up Source A reports max file bound as skipped reason");

  const missing = buildCatchUpSourceADryRunManifest({
    source: "claude_code",
    roots: { claude_code: join(claudeRoot, "missing") },
    since,
    until,
  });
  assert(missing.sources[0].status === "degraded", "catch-up Source A missing root is degraded evidence");
  assert(missing.sources[0].skipped_reasons.includes("root_missing"), "catch-up Source A reports missing root");

  const emptyWindow = buildCatchUpSourceADryRunManifest({
    source: "codex",
    roots: { codex: codexRoot },
    since: "2026-05-21T00:00:00.000Z",
    until: "2026-05-22T00:00:00.000Z",
  });
  assert(emptyWindow.sources[0].candidate_files === 0, "catch-up Source A respects since/until window");
  assert(emptyWindow.sources[0].skipped_reasons.includes("no_candidate_files"), "catch-up Source A reports no candidates explicitly");

  let invalidRangeRejected = false;
  try {
    buildCatchUpSourceADryRunManifest({
      since: "2026-05-22T00:00:00.000Z",
      until: "2026-05-21T00:00:00.000Z",
    });
  } catch {
    invalidRangeRejected = true;
  }
  assert(invalidRangeRejected, "catch-up Source A rejects invalid since/until ranges");

  rmSync(claudeRoot, { recursive: true, force: true });
  rmSync(codexRoot, { recursive: true, force: true });
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
  assert(first.coverage.status === "clean", "Claude ingest reports clean raw capture coverage");
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
  assert(first.coverage.status === "clean", "Codex ingest reports clean raw capture coverage");
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
  assert(validateRecoveryPackCl2Profile(recoveryPack).valid, "recovery-pack/v1 generated artifact satisfies CL2 evidence profile with explicit missing evidence");
  assert(recoveryPack.pack_id.startsWith("restart_pack:"), "recovery-pack/v1 has stable pack id prefix");
  assert(recoveryPack.project === project, "recovery-pack/v1 includes project");
  assert(recoveryPack.schema_ref === RECOVERY_PACK_SCHEMA_REF, "recovery-pack/v1 emits cross-MCP schema_ref");
  assert(recoveryPack.policy_version === RECOVERY_PACK_POLICY_VERSION, "recovery-pack/v1 emits policy_version");
  assert(recoveryPack.retention_policy_ref === null, "recovery-pack/v1 can emit nullable retention policy ref");
  assert(recoveryPack.missing_evidence?.includes("retention_policy_ref") === true, "recovery-pack/v1 records missing nullable retention policy evidence");
  assert((recoveryPack.source_refs?.length ?? 0) > 0, "recovery-pack/v1 emits pack-level source refs");
  assert(recoveryPack.redaction_summary?.private_reasoning_excluded === true, "recovery-pack/v1 excludes private reasoning in redaction summary");
  assert(recoveryPack.redaction_summary?.mode === "redacted-before-emit", "recovery-pack/v1 reports redaction-before-emit when secrets are redacted");
  assert(recoveryPack.confidence === "high", "recovery-pack/v1 reports high confidence when task and context exist");
  assert(recoveryPack.missing_context.length === 0, "recovery-pack/v1 reports no missing context for coherent pack");
  assert(recoveryPack.items.some((item) => item.kind === "current_task"), "recovery-pack/v1 includes current task item");
  assert(recoveryPack.items.some((item) => item.kind === "decision"), "recovery-pack/v1 includes decision item");
  assert(recoveryPack.items.some((item) => item.kind === "knowledge"), "recovery-pack/v1 includes knowledge item");
  assert(recoveryPack.items.some((item) => item.kind === "recent_message"), "recovery-pack/v1 includes recent message evidence item");
  assert(recoveryPack.items.some((item) => item.trust_level === "external"), "recovery-pack/v1 marks conversation-derived context as external");
  assert(recoveryPack.items.some((item) => item.source_ref.startsWith("conversation_event:")), "recovery-pack/v1 item includes conversation provenance");
  assert(recoveryPack.items.some((item) => item.sensitivity === "secret_redacted"), "recovery-pack/v1 records secret redaction status");
  assert(recoveryPack.items.every((item) => item.memory_safety_class !== undefined), "recovery-pack/v1 emits item memory safety classes");
  assert(recoveryPack.items.every((item) => item.redaction_state !== undefined), "recovery-pack/v1 emits item redaction states");
  assert(recoveryPack.items.some((item) => item.memory_safety_class === "raw_event_source"), "recovery-pack/v1 marks conversation evidence as raw event source");
  assert(recoveryPack.items.every((item) => item.memory_safety_class !== "approved_memory"), "recovery-pack/v1 does not claim approved memory without promotion evidence");
  const recoveryJson = JSON.stringify(recoveryPack);
  assert(!recoveryJson.includes("sk-test"), "recovery-pack/v1 redacts compound secret prefixes before emit");
  assert(!recoveryJson.includes("dev@example.com"), "recovery-pack/v1 redacts emails before emit");
  assert(!recoveryJson.includes("Session refresh should continue from memory."), "recovery-pack/v1 does not emit raw transcript excerpts");
  assert(estimateRecoveryPackContentTokens(recoveryPack) <= recoveryPack.token_budget, "recovery-pack/v1 enforces aggregate content token budget");

  const oldStyleItems = recoveryPack.items.map(({ memory_safety_class: _memorySafetyClass, redaction_state: _redactionState, promotion_evidence: _promotionEvidence, ...item }) => item);
  const {
    schema_ref: _schemaRef,
    policy_version: _policyVersion,
    redaction_summary: _redactionSummary,
    retention_policy_ref: _retentionPolicyRef,
    source_refs: _sourceRefs,
    missing_evidence: _missingEvidence,
    ...oldStylePack
  } = { ...recoveryPack, items: oldStyleItems };
  assert(validateRecoveryPackArtifact(oldStylePack).valid, "old-style recovery-pack/v1 remains implementation-valid without CL2 fields");
  assert(validateRecoveryPackJsonSchema(oldStylePack).valid, "old-style recovery-pack/v1 remains JSON-Schema-valid without CL2 fields");
  assert(!validateRecoveryPackCl2Profile(oldStylePack).valid, "old-style recovery-pack/v1 cannot claim CL2 without missing_evidence");

  const fullCl2Pack = {
    ...recoveryPack,
    retention_policy_ref: "retention_policy:wasurezu-default",
    missing_evidence: [],
  };
  assert(validateRecoveryPackCl2Profile(fullCl2Pack).valid, "recovery-pack/v1 CL2 profile passes when all evidence is present");
  const { policy_version: _missingPolicyVersion, ...packWithoutPolicyVersion } = fullCl2Pack;
  const policyVersionListedMissing = {
    ...packWithoutPolicyVersion,
    missing_evidence: ["policy_version"],
  };
  assert(validateRecoveryPackCl2Profile(policyVersionListedMissing).valid, "CL2 profile allows absent policy_version only when missing_evidence lists it");
  const retentionMissingUnlisted = {
    ...recoveryPack,
    retention_policy_ref: null,
    missing_evidence: [],
  };
  assert(!validateRecoveryPackCl2Profile(retentionMissingUnlisted).valid, "CL2 profile rejects null retention_policy_ref without missing_evidence");
  const sourceRefsMissingListed = {
    ...fullCl2Pack,
    source_refs: [],
    missing_evidence: ["source_refs"],
  };
  assert(validateRecoveryPackCl2Profile(sourceRefsMissingListed).valid, "CL2 profile allows empty source_refs only when missing_evidence lists it");
  const approvedWithoutPromotion = {
    ...fullCl2Pack,
    items: [
      {
        ...fullCl2Pack.items[0],
        memory_safety_class: "approved_memory",
      },
      ...fullCl2Pack.items.slice(1),
    ],
  };
  assert(!validateRecoveryPackCl2Profile(approvedWithoutPromotion).valid, "CL2 profile rejects approved_memory without promotion_evidence");
  const privateReasoningPack = {
    ...fullCl2Pack,
    items: [
      {
        ...fullCl2Pack.items[0],
        summary: "private reasoning: do not persist reasoning",
      },
      ...fullCl2Pack.items.slice(1),
    ],
  };
  assert(!validateRecoveryPackCl2Profile(privateReasoningPack).valid, "CL2 profile rejects private reasoning text in pack items");

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
  assert(validateRecoveryPackCl2Profile(codexHostContext.context_data).valid, "host-invocation-context/v1 embeds CL2-compatible recovery pack");
  const rawContextItem = codexHostContext.context_data.items.find((item) => item.memory_safety_class === "raw_event_source");
  if (rawContextItem) {
    assert(
      !codexHostContext.trusted_instruction.includes(rawContextItem.summary),
      "host-invocation-context/v1 keeps raw event source content out of trusted_instruction"
    );
    assert(
      !validateHostInvocationContextArtifact({ ...codexHostContext, trusted_instruction: rawContextItem.summary }).valid,
      "host-invocation-context/v1 rejects raw event source content copied into trusted_instruction"
    );
  }

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

  const dryRunParsed = parseArgs(["--launch", "--dry-run", "--doctor", "--codex-bin", "codex-dev"]);
  assert(dryRunParsed.dryRun === true, "Codex startup parser reads --dry-run");
  assert(dryRunParsed.doctor === true, "Codex startup parser reads --doctor");

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

  const preview = buildCodexLaunchPreview({ launch: true, cd: "/tmp/work", codexBin: "codex-dev" }, prompt);
  assert(preview.live_launch_performed === false, "Codex dry-run preview does not perform live launch");
  assert(preview.args_preview.includes("[restart_pack prompt omitted]"), "Codex dry-run preview omits restart_pack prompt content");
  assert(!JSON.stringify(preview).includes("SESSION RESTART PACK"), "Codex dry-run preview does not leak restart_pack text");
  assert(preview.positional_prompt_contract === CODEX_POSITIONAL_PROMPT_CONTRACT, "Codex dry-run preview reports positional prompt contract");
  assert(preview.argv_visibility_risk === CODEX_ARGV_VISIBILITY_NOTE, "Codex dry-run preview reports argv visibility risk");

  const doctor = buildCodexDoctorReport(
    { codexBin: "codex-dev" },
    (_bin, args) => {
      if (args[0] === "--help") {
        return {
          status: 0,
          stdout: "Usage: codex [OPTIONS] [PROMPT]\n",
          stderr: "",
        };
      }
      return {
        status: 0,
        stdout: "codex 0.99.0-test\n",
        stderr: "",
      };
    }
  );
  assert(doctor.codex_help_available === true, "Codex doctor records help availability");
  assert(doctor.help_mentions_prompt_argument === true, "Codex doctor detects prompt argument contract");
  assert(doctor.live_launch_performed === false, "Codex doctor does not launch Codex");
  assert(doctor.argv_visibility_risk === CODEX_ARGV_VISIBILITY_NOTE, "Codex doctor reports argv visibility limitation");

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
    assert(help.includes("--doctor"), "Codex startup help documents doctor mode");
    assert(help.includes("--dry-run"), "Codex startup help documents dry-run mode");
    assert(help.includes(CODEX_POSITIONAL_PROMPT_CONTRACT), "Codex startup help documents positional prompt contract");
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

async function testClaudeMarkerController() {
  console.log("\n── Claude Marker Controller Tests (AM-138 Cell B) ──");
  const store = new JsonStore();
  await store.initialize();
  const agentId = "test-claude-marker-agent";
  const project = "/Users/yuji/Developer/dev-auditor";

  await store.saveTaskState({
    agent_id: agentId,
    project,
    task: "Recover dev-auditor after Claude context exhaustion",
    status: "in_progress",
    progress: "Controller tests are preparing marker evidence.",
    next_steps: "Delegate to wasurezu-claude-start without live restart.",
  });
  await store.logDecision({
    agent_id: agentId,
    project,
    decision: "restart-required.json is input evidence only; the controller owns deterministic gating.",
    tags: ["AM-138", "claude-marker"],
  });

  const root = mkdtempSync(join(tmpdir(), "am138-claude-marker-"));
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const trustedBin = join(binDir, "wasurezu-claude-start");
  writeFileSync(trustedBin, "#!/usr/bin/env sh\nexit 0\n");
  chmodSync(trustedBin, 0o755);
  const markerPath = join(root, "restart-required.json");
  writeFileSync(markerPath, JSON.stringify({
    status: "restart_required",
    reason: "claude_precompact_auto",
    project,
    host: "claude-code",
    session_id: "claude-session-1",
    measured_context_tokens: 960000,
    context_window_tokens: 1000000,
  }));

  const ready = await controlClaudeRestartMarker({
    store,
    agentId,
    markerPath,
    restartCommand: "wasurezu-claude-start --launch",
    env: { PATH: binDir },
    launchRequested: true,
    aunAbsentConfirmed: true,
    supervisorAvailable: true,
    restartPreauthorized: true,
  });
  assert(ready.marker_path === markerPath, "Claude marker controller records marker path");
  assert(ready.marker_status === "restart_required", "Claude marker controller consumes restart_required marker");
  assert(ready.reason === "claude_precompact_auto", "Claude marker controller records marker reason");
  assert(ready.project === project, "Claude marker controller records marker project");
  assert(ready.host === "claude-code", "Claude marker controller records marker host");
  assert(ready.runner === "wasurezu-claude-start", "Claude marker controller delegates to Claude runner");
  assert(ready.command.status === "fail", "Claude marker controller fails closed without registered adapter authority");
  assert(ready.command.reasons.includes("restart_adapter_id_missing"), "Claude marker controller exposes missing adapter authority");
  assert(ready.prepare.context_signal.source === "host_metrics", "Claude marker controller passes marker metrics to restart preparation");
  assert(ready.prepare.context_signal.band === "require", "Claude marker controller maps high marker metrics to require band");
  assert(ready.prepare.action === "restart_required", "Claude marker controller preserves restart_required action");
  assert(ready.selected_pack_ref?.startsWith("selected_restart_pack:") === true, "Claude marker controller records selected pack ref");
  assert(ready.confidence.level !== "low", "Claude marker controller reports recovery confidence");
  assert(ready.launch_permitted === false, "Claude marker controller blocks launch without registered adapter authority");
  assert(ready.executed_restart === false, "Claude marker controller does not execute live restart");
  assert(ready.outcome === "blocked", "Claude marker controller reports blocked outcome when adapter authority is missing");
  assert(ready.notes.some((note) => note.includes("does not execute a live restart")), "Claude marker controller documents no-live-restart behavior");
  assert(ready.notes.some((note) => note.includes("SessionStart remains")), "Claude marker controller keeps SessionStart as load hook only");

  const metricAbsent = await controlClaudeRestartMarker({
    store,
    agentId,
    marker: {
      status: "restart_required",
      reason: "claude_precompact_auto",
      project,
      host: "claude-code",
    },
    restartCommand: "wasurezu-claude-start --launch",
    env: { PATH: binDir },
    launchRequested: true,
    aunAbsentConfirmed: true,
    supervisorAvailable: true,
    restartPreauthorized: true,
  });
  assert(metricAbsent.prepare.context_signal.source === "estimated", "Claude marker controller marks metric-absent marker as estimated");
  assert(metricAbsent.outcome === "blocked", "Claude marker controller blocks metric-absent restart without adapter authority");
  assert(metricAbsent.notes.some((note) => note.includes("did not provide host context metrics")), "Claude marker controller explains missing marker metrics");

  const aunBlocked = await controlClaudeRestartMarker({
    store,
    agentId,
    marker: {
      status: "restart_required",
      reason: "claude_precompact_auto",
      project,
      context_used_ratio: 0.96,
    },
    restartCommand: "wasurezu-claude-start --launch",
    env: { PATH: binDir },
    launchRequested: true,
    aunInstalled: true,
    supervisorAvailable: true,
    restartPreauthorized: true,
  });
  assert(aunBlocked.launch_permitted === false, "Claude marker controller blocks launch when AUN is present");
  assert(aunBlocked.launch_blockers.includes("aun_installed"), "Claude marker controller exposes AUN blocker");
  assert(aunBlocked.outcome === "blocked", "Claude marker controller reports AUN-present marker as blocked");
  assert(aunBlocked.executed_restart === false, "Claude marker controller never mutates AUN-supervised runtime");

  const relative = await controlClaudeRestartMarker({
    store,
    agentId,
    marker: {
      status: "restart_required",
      reason: "claude_precompact_auto",
      project,
      context_used_ratio: 0.96,
    },
    restartCommand: "scripts/restart-from-context-marker.sh",
    env: { PATH: binDir },
    launchRequested: true,
    aunAbsentConfirmed: true,
    supervisorAvailable: true,
    restartPreauthorized: true,
  });
  assert(relative.command.status === "fail", "Claude marker controller fails closed for relative restart commands");
  assert(relative.command.reasons.includes("restart_adapter_id_missing"), "Claude marker controller reports missing adapter authority before relative command authorization");
  assert(relative.launch_permitted === false, "Claude marker controller does not permit launch after command preflight failure");
  assert(relative.failure_class === "restart_adapter_id_missing", "Claude marker controller records command failure class");

  const ignored = await controlClaudeRestartMarker({
    store,
    agentId,
    marker: { status: "restart_not_required", project },
    restartCommand: "wasurezu-claude-start --launch",
    env: { PATH: binDir },
    launchRequested: true,
    aunAbsentConfirmed: true,
    supervisorAvailable: true,
    restartPreauthorized: true,
  });
  assert(ignored.marker_status === "ignored", "Claude marker controller ignores non-restart markers");
  assert(ignored.outcome === "skipped", "Claude marker controller skips non-restart markers");
  assert(ignored.executed_restart === false, "Claude marker controller skip path does not execute restart");

  rmSync(root, { recursive: true, force: true });
  await store.close();
}

function testRestartCommandPreflight() {
  console.log("\n── Restart Command Preflight Tests (AM-138 Cell A) ──");
  const root = mkdtempSync(join(tmpdir(), "am138-restart-command-"));
  const executable = join(root, "restart-controller.sh");
  writeFileSync(executable, "#!/usr/bin/env sh\nexit 0\n");
  chmodSync(executable, 0o755);
  const digest = createHash("sha256").update(readFileSync(executable)).digest("hex");
  const hostAdapter = {
    schema_version: "restart_host_adapter/v1" as const,
    host_adapter_id: "claude-adapter",
    runtime: "claude",
    canonical_path: executable,
    executable_sha256: digest,
    allowed_argv: ["--launch"],
    state: "active" as const,
    owner_decision_ref: "KUSABI-DEC-ADAPTER-ALLOWLIST",
    provenance_ref: "owner_decision:KUSABI-DEC-ADAPTER-ALLOWLIST",
    created_at: "2026-07-09T00:00:00.000Z",
    updated_at: "2026-07-09T00:00:00.000Z",
  };

  const absolute = preflightRestartCommand({
    command: `${executable} --dry-run`,
    restartPreauthorized: true,
    env: { PATH: "" },
  });
  assert(absolute.status === "fail", "KR-005: restart command preflight rejects arbitrary absolute executable paths without adapter registration");
  assert(absolute.reasons.includes("restart_adapter_id_missing"), "KR-005: preflight reports missing adapter id for absolute paths");

  const registered = preflightRestartCommand({
    command: `${executable} --launch`,
    restartPreauthorized: true,
    env: { PATH: "" },
    hostAdapterId: "claude-adapter",
    hostAdapter,
  });
  assert(registered.status === "pass", "KR-005: restart command preflight accepts only registered host adapters");
  assert(registered.command_kind === "registered_host_adapter", "KR-005: restart command preflight classifies registered adapters");
  assert(registered.cwd_independent === true, "KR-005: registered adapter command is cwd-independent");
  assert(registered.resolved_path === realpathSync(executable), "KR-005: registered adapter preflight records canonical realpath");
  assert(registered.argv.join(" ") === "--launch", "KR-005: registered adapter preflight records immutable argv");

  const missingAbsolute = preflightRestartCommand({
    command: `${join(root, "missing-controller.sh")} --dry-run`,
    restartPreauthorized: true,
    env: { PATH: "" },
  });
  assert(missingAbsolute.status === "fail", "restart command preflight fails closed when an absolute command is missing");
  assert(missingAbsolute.reasons.includes("restart_adapter_id_missing"), "restart command preflight reports missing adapter id before executable lookup");

  const markerRunDir = join(root, "marker-run");
  const relativeScriptsDir = join(markerRunDir, "scripts");
  mkdirSync(relativeScriptsDir, { recursive: true });
  const relativeTarget = join(relativeScriptsDir, "restart-from-context-marker.sh");
  writeFileSync(relativeTarget, "#!/usr/bin/env sh\nexit 0\n");
  chmodSync(relativeTarget, 0o755);
  const relative = preflightRestartCommand({
    command: "scripts/restart-from-context-marker.sh",
    restartPreauthorized: true,
    env: { PATH: "" },
  });
  assert(relative.status === "fail", "restart command preflight rejects relative script commands");
  assert(relative.reasons.includes("restart_adapter_id_missing"), "restart command preflight requires adapter id before relative command authorization");
  assert(relative.cwd_independent === false, "restart command preflight does not treat marker-run relative commands as cwd-independent");

  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const trustedBin = join(binDir, "wasurezu-claude-start");
  writeFileSync(trustedBin, "#!/usr/bin/env sh\nexit 0\n");
  chmodSync(trustedBin, 0o755);
  const packageBin = preflightRestartCommand({
    command: "wasurezu-claude-start --launch",
    restartPreauthorized: true,
    env: { PATH: binDir },
  });
  assert(packageBin.status === "fail", "KR-005: restart command preflight rejects PATH lookup package/bin commands");
  assert(packageBin.reasons.includes("restart_adapter_id_missing"), "KR-005: PATH lookup cannot replace adapter registry");

  const missingTrustedBin = preflightRestartCommand({
    command: "wasurezu-claude-start --launch",
    restartPreauthorized: true,
    env: { PATH: join(root, "empty-bin") },
  });
  assert(missingTrustedBin.status === "fail", "restart command preflight fails closed when trusted bin is missing");
  assert(missingTrustedBin.reasons.includes("restart_adapter_id_missing"), "restart command preflight reports missing adapter id for trusted bin lookup");

  const disallowedBin = preflightRestartCommand({
    command: "claude --mcp-config .mcp.json",
    restartPreauthorized: true,
    env: { PATH: binDir },
  });
  assert(disallowedBin.status === "fail", "restart command preflight rejects non-allowlisted bare commands");
  assert(disallowedBin.reasons.includes("restart_adapter_id_missing"), "restart command preflight reports missing adapter id for bare commands");

  const notPreauthorized = preflightRestartCommand({
    command: `${executable} --launch`,
    env: { PATH: "" },
    hostAdapterId: "claude-adapter",
    hostAdapter,
  });
  assert(notPreauthorized.status === "fail", "restart command preflight requires explicit restart preauthorization");
  assert(notPreauthorized.reasons.includes("restart_lifecycle_not_preauthorized"), "restart command preflight reports missing preauthorization");

  const shellControl = preflightRestartCommand({
    command: `${executable} && echo unsafe`,
    restartPreauthorized: true,
    env: { PATH: "" },
    hostAdapterId: "claude-adapter",
    hostAdapter,
  });
  assert(shellControl.status === "fail", "restart command preflight rejects shell control operators");
  assert(shellControl.reasons.includes("restart_command_shell_control_rejected"), "restart command preflight reports shell control rejection");

  const argvDrift = preflightRestartCommand({
    command: `${executable} --unsafe`,
    restartPreauthorized: true,
    env: { PATH: "" },
    hostAdapterId: "claude-adapter",
    hostAdapter,
  });
  assert(argvDrift.status === "fail", "KR-005: restart command preflight rejects argv outside adapter schema");
  assert(argvDrift.reasons.includes("restart_command_args_rejected"), "KR-005: preflight reports argv drift");

  writeFileSync(executable, "#!/usr/bin/env sh\nexit 1\n");
  chmodSync(executable, 0o755);
  const digestDrift = preflightRestartCommand({
    command: `${executable} --launch`,
    restartPreauthorized: true,
    env: { PATH: "" },
    hostAdapterId: "claude-adapter",
    hostAdapter,
  });
  assert(digestDrift.status === "fail", "KR-005: restart command preflight rejects digest drift");
  assert(digestDrift.reasons.includes("restart_adapter_digest_mismatch"), "KR-005: preflight reports digest drift");

  writeFileSync(executable, "#!/usr/bin/env sh\nexit 0\n");
  chmodSync(executable, 0o777);
  const permissionDrift = preflightRestartCommand({
    command: `${executable} --launch`,
    restartPreauthorized: true,
    env: { PATH: "" },
    hostAdapterId: "claude-adapter",
    hostAdapter,
  });
  assert(permissionDrift.status === "fail", "KR-005: restart command preflight rejects group/world writable adapters");
  assert(permissionDrift.reasons.includes("restart_adapter_path_writable_rejected"), "KR-005: preflight reports permission drift");

  rmSync(root, { recursive: true, force: true });
}

function testSupervisorPreflight() {
  console.log("\n── Supervisor Preflight Tests (Issue #138) ──");
  const root = mkdtempSync(join(tmpdir(), "am138-supervisor-preflight-"));
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const trustedBin = join(binDir, "wasurezu-claude-start");
  writeFileSync(trustedBin, "#!/usr/bin/env sh\nexit 0\n");
  chmodSync(trustedBin, 0o755);

  const CHECKED_AT = "2026-01-01T00:00:00.000Z";

  // Registry-less supervisor config is now diagnostic-only and fails closed.
  const pass = runSupervisorPreflight("wasurezu-claude-start --launch", true, CHECKED_AT, { PATH: binDir });
  assert(pass.status === "fail", "supervisor preflight fails closed without a registered adapter");
  assert(pass.reasons.includes("restart_adapter_id_missing"), "supervisor preflight reports missing adapter authority");
  assert(pass.cwd_independent === false, "supervisor preflight does not mark PATH lookup commands cwd-independent");

  // Legacy broken config: relative script path (the original bug from issue #138)
  const relativeResult = runSupervisorPreflight(
    "scripts/restart-from-context-marker.sh",
    true,
    CHECKED_AT,
    { PATH: binDir }
  );
  assert(relativeResult.status === "fail", "supervisor preflight fails for legacy relative script command");
  assert(
    relativeResult.reasons.includes("restart_command_relative_rejected"),
    "supervisor preflight reports relative command rejection for legacy config"
  );
  assert(relativeResult.remediation.length > 0, "supervisor preflight provides remediation for relative command");
  assert(
    relativeResult.remediation[0].includes("wasurezu-claude-start"),
    "supervisor preflight remediation names the correct trusted bin"
  );

  // Missing command — reads from WASUREZU_RESTART_COMMAND env var
  const fromEnv = runSupervisorPreflight(undefined, true, CHECKED_AT, {
    PATH: binDir,
    WASUREZU_RESTART_COMMAND: "wasurezu-claude-start --launch",
  });
  assert(fromEnv.status === "fail", "supervisor preflight reads env command but still requires registered adapter authority");

  // Not preauthorized
  const noAuth = runSupervisorPreflight("wasurezu-claude-start --launch", false, CHECKED_AT, { PATH: binDir });
  assert(noAuth.status === "fail", "supervisor preflight fails when restart lifecycle not preauthorized");
  assert(
    noAuth.reasons.includes("restart_lifecycle_not_preauthorized"),
    "supervisor preflight reports missing preauthorization"
  );
  assert(
    noAuth.remediation.some((r) => r.includes("WASUREZU_RESTART_PREAUTHORIZED")),
    "supervisor preflight remediation mentions WASUREZU_RESTART_PREAUTHORIZED env var"
  );

  rmSync(root, { recursive: true, force: true });
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
  assert(prepared.context_signal.thresholds.require === 0.95, "restart_prepare uses out-of-box require threshold by default");
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

  const overridePrepared = await prepareRestart(store, {
    agent_id: agentId,
    project,
    context_used_ratio: 0.91,
    thresholds: { prepare: 0.6, warn: 0.7, recommend: 0.8, require: 0.9 },
    emit_pack: false,
  });
  assert(overridePrepared.context_signal.band === "require", "restart_prepare applies validated threshold overrides");
  assert(overridePrepared.action === "restart_required", "restart_prepare can require restart via threshold override");
  assert(overridePrepared.context_signal.thresholds.require === 0.9, "restart_prepare exposes applied threshold values");

  const rawCoverageRoot = mkdtempSync(join(tmpdir(), "am139-prepare-coverage-"));
  writeFileSync(join(rawCoverageRoot, "session-prepare.jsonl"), "{}\n");
  writeFileSync(join(rawCoverageRoot, "unclassified.log"), "not imported by the raw capture policy\n");
  const rawCaptureCoverage = inspectRawCaptureCoverage({
    source: "claude_code",
    project,
    root: rawCoverageRoot,
    since: "2026-05-18T00:00:00.000Z",
  });
  const coveragePrepared = await prepareRestart(store, {
    agent_id: agentId,
    project,
    emit_pack: false,
    raw_capture_coverage: rawCaptureCoverage,
  });
  assert(
    coveragePrepared.recovery_confidence.missing_context.includes("raw_capture_unknown_files"),
    "restart_prepare includes raw capture coverage gaps in missing context"
  );
  assert(
    coveragePrepared.notes.some((note) => note.includes("raw capture claude_code degraded")),
    "restart_prepare notes raw capture coverage degradation"
  );
  const selectedCoverage = await store.getSelectedRestartPack({ agent_id: agentId, project, pack_ref: coveragePrepared.pack_ref! });
  const selectedCoverageMetadata = selectedCoverage?.metadata.raw_capture_coverage as { status?: string } | undefined;
  assert(selectedCoverageMetadata?.status === "degraded", "selected restart pack metadata records raw capture coverage");
  rmSync(rawCoverageRoot, { recursive: true, force: true });

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

async function testRestartMarkerBridge() {
  console.log("\n── Restart Marker/Bridge Tests (CELL-KUSABI-CTX-RESTART-001) ──");
  const store = new JsonStore();
  await store.initialize();
  const root = mkdtempSync(join(tmpdir(), "am250-restart-bridge-"));
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const trustedBin = join(binDir, "wasurezu-claude-start");
  const invocationLog = join(root, "invocations.log");
  writeFileSync(trustedBin, `#!/usr/bin/env bash\necho fake-adapter >> "${invocationLog}"\nexit 0\n`);
  chmodSync(trustedBin, 0o755);
  const trustedBinDigest = createHash("sha256").update(readFileSync(trustedBin)).digest("hex");
  const hostAdapterId = "claude-adapter";
  const env = { ...inheritedEnv(), PATH: `${binDir}:${process.env.PATH ?? ""}` };
  delete env.AGENT_COMMS_DATABASE_URL;
  const agentId = "test-restart-bridge-agent";
  const project = "restart-bridge";
  const hostId = "host-a";
  const seatId = "seat-a";
  const now = "2026-07-09T00:01:00.000Z";
  const issuedAt = "2026-07-09T00:00:00.000Z";
  const expiresAt = "2026-07-09T00:10:00.000Z";
  const markerPath = join(root, "restart-required.json");

  const saveAdapter = async (overrides: Partial<SaveRestartHostAdapterInput> = {}) => store.saveRestartHostAdapter({
    host_adapter_id: hostAdapterId,
    runtime: "claude",
    canonical_path: trustedBin,
    executable_sha256: trustedBinDigest,
    allowed_argv: ["--launch"],
    state: "active",
    owner_decision_ref: "KUSABI-DEC-ADAPTER-ALLOWLIST",
    provenance_ref: "owner_decision:KUSABI-DEC-ADAPTER-ALLOWLIST",
    ...overrides,
  });

  const saveAuthority = async (
    sessionId: string,
    lifecycle_mode: "standalone_supervisor" | "aun_supervised" | "pure_mcp" = "standalone_supervisor",
    overrides: Partial<SaveRestartRuntimeAuthorityInput> = {}
  ): Promise<string> => {
    const authority_ref = overrides.authority_ref ?? `restart-authority:${sessionId}`;
    await store.saveRestartRuntimeAuthority({
      authority_ref,
      lifecycle_mode,
      agent_id: agentId,
      project,
      seat_id: seatId,
      host_id: hostId,
      session_id: sessionId,
      host_adapter_id: hostAdapterId,
      supervisor_id: "supervisor-a",
      supervisor_available: true,
      restart_preauthorized: true,
      issued_at: issuedAt,
      expires_at: expiresAt,
      row_version: 1,
      aun_absent_confirmed: true,
      provenance_ref: "owner_decision:KUSABI-DEC-STANDALONE-DETECTION",
      ...overrides,
    });
    return authority_ref;
  };

  await saveAdapter();

  const writeMarker = (
    path: string,
    sessionId: string,
    generated_at = "2026-07-09T00:00:30.000Z",
    adapterId = hostAdapterId
  ) => writeRestartMarker({
    agent_id: agentId,
    project,
    host: "claude",
    host_id: hostId,
    host_adapter_id: adapterId,
    seat_id: seatId,
    session_id: sessionId,
    context_tokens: 950,
    context_window_tokens: 1000,
    thresholds: { prepare: 0.5, warn: 0.7, recommend: 0.8, require: 0.94 },
    marker_path: path,
    generated_at,
  });

  const written = writeMarker(markerPath, "session-a");
  assert(written.marker.status === "restart_required", "marker writer emits restart_required at require band");
  assert(written.marker.schema_version === "wasurezu-restart-marker/v2", "KR-001: marker writer emits executable v2 schema");
  assert(/^[-0-9a-f]{36}$/i.test(written.marker.marker_id) && written.marker.marker_id.split("-")[2].startsWith("7"), "KR-001: marker writer mints UUIDv7-like marker id");
  assert(written.marker.host_id === hostId, "KR-001: marker writer records host id");
  assert(written.marker.host_adapter_id === hostAdapterId, "KR-001: marker writer records host adapter id");
  assert(written.marker.context_used_ratio === 0.95, "marker writer records measured context ratio");
  assert(written.marker.thresholds.require === 0.94, "marker writer records applied threshold values");
  const markerText = readFileSync(markerPath, "utf8");
  assert(markerText.includes('"seat_id": "seat-a"'), "marker writer records seat id");
  assert(!markerText.includes("SESSION RESTART PACK"), "marker writer does not expose restart pack or conversation text");

  const standalone = await runRestartBridge({
    store,
    agentId,
    project,
    markerPath,
    restartCommand: `${trustedBin} --launch`,
    runtimeAuthorityRef: await saveAuthority("session-a"),
    hostAdapterId,
    execute: false,
    env,
    now,
  });
  assert(standalone.action === "restart_dry_run", "restart bridge dry-runs by default when execute=false");
  assert(standalone.executed_restart === false, "restart bridge dry-run does not execute live restart");
  assert(standalone.command?.status === "pass", "KR-005: restart bridge performs registered adapter preflight");
  assert(standalone.command?.command_kind === "registered_host_adapter", "KR-005: restart bridge uses registered adapter command record");
  assert(standalone.queue_check?.mode === "standalone_supervisor", "KR-006: restart bridge allows only explicit standalone supervisor authority");
  assert(standalone.event.queue_check_mode === "standalone_supervisor", "restart event records standalone supervisor mode");
  assert(standalone.event.preflight_status === "pass", "restart event records preflight result");
  assert(standalone.event.executed_restart === false, "restart event records no live restart");

  const missingAuthorityPath = join(root, "missing-authority.json");
  writeMarker(missingAuthorityPath, "session-missing-authority");
  const missingAuthority = await runRestartBridge({
    store,
    agentId,
    project,
    markerPath: missingAuthorityPath,
    restartCommand: `${trustedBin} --launch`,
    runtimeAuthorityRef: "restart-authority:missing",
    hostAdapterId,
    execute: false,
    env,
    now,
  });
  assert(missingAuthority.action === "restart_blocked", "KR-006: bridge requires persisted runtime authority");
  assert(missingAuthority.failure_reason === "runtime_authority_not_found", "KR-006: missing persisted authority fails closed before command preflight");
  assert(missingAuthority.command === null, "KR-006: missing persisted authority cannot authorize command preflight");

  const invalidIssuedAtPath = join(root, "invalid-issued-at.json");
  writeMarker(invalidIssuedAtPath, "session-invalid-issued-at");
  const invalidIssuedAt = await runRestartBridge({
    store,
    agentId,
    project,
    markerPath: invalidIssuedAtPath,
    restartCommand: `${trustedBin} --launch`,
    runtimeAuthorityRef: await saveAuthority("session-invalid-issued-at", "standalone_supervisor", {
      issued_at: "2026-07-09 00:00:00Z",
    }),
    hostAdapterId,
    execute: false,
    env,
    now,
  });
  assert(invalidIssuedAt.action === "restart_blocked", "KR-006: bridge rejects non-strict issued_at authority provenance");
  assert(invalidIssuedAt.failure_reason === "runtime_authority_issued_at_invalid", "KR-006: invalid issued_at reports typed authority failure");

  const missingProvenancePath = join(root, "missing-provenance.json");
  writeMarker(missingProvenancePath, "session-missing-provenance");
  const missingProvenance = await runRestartBridge({
    store,
    agentId,
    project,
    markerPath: missingProvenancePath,
    restartCommand: `${trustedBin} --launch`,
    runtimeAuthorityRef: await saveAuthority("session-missing-provenance", "standalone_supervisor", {
      provenance_ref: "",
    }),
    hostAdapterId,
    execute: false,
    env,
    now,
  });
  assert(missingProvenance.action === "restart_blocked", "KR-006: bridge rejects authority without provenance_ref");
  assert(missingProvenance.failure_reason === "runtime_authority_provenance_invalid", "KR-006: missing provenance reports typed authority failure");

  const missingRuntimeAdapterId = "adapter-missing-runtime";
  await saveAdapter({ host_adapter_id: missingRuntimeAdapterId, runtime: "" });
  const missingRuntimePath = join(root, "missing-runtime-adapter.json");
  writeMarker(missingRuntimePath, "session-missing-runtime-adapter", "2026-07-09T00:00:30.000Z", missingRuntimeAdapterId);
  const missingRuntime = await runRestartBridge({
    store,
    agentId,
    project,
    markerPath: missingRuntimePath,
    restartCommand: `${trustedBin} --launch`,
    runtimeAuthorityRef: await saveAuthority("session-missing-runtime-adapter", "standalone_supervisor", {
      host_adapter_id: missingRuntimeAdapterId,
    }),
    hostAdapterId: missingRuntimeAdapterId,
    execute: false,
    env,
    now,
  });
  assert(missingRuntime.failure_reason === "restart_adapter_runtime_missing", "KR-005: adapter runtime is mandatory");

  const missingStateAdapterId = "adapter-missing-state";
  await saveAdapter({ host_adapter_id: missingStateAdapterId, state: undefined as unknown as "active" });
  const missingStatePath = join(root, "missing-state-adapter.json");
  writeMarker(missingStatePath, "session-missing-state-adapter", "2026-07-09T00:00:30.000Z", missingStateAdapterId);
  const missingState = await runRestartBridge({
    store,
    agentId,
    project,
    markerPath: missingStatePath,
    restartCommand: `${trustedBin} --launch`,
    runtimeAuthorityRef: await saveAuthority("session-missing-state-adapter", "standalone_supervisor", {
      host_adapter_id: missingStateAdapterId,
    }),
    hostAdapterId: missingStateAdapterId,
    execute: false,
    env,
    now,
  });
  assert(missingState.failure_reason === "restart_adapter_state_invalid", "KR-005: adapter active state is mandatory");

  const missingOwnerAdapterId = "adapter-missing-owner";
  await saveAdapter({ host_adapter_id: missingOwnerAdapterId, owner_decision_ref: "" });
  const missingOwnerPath = join(root, "missing-owner-adapter.json");
  writeMarker(missingOwnerPath, "session-missing-owner-adapter", "2026-07-09T00:00:30.000Z", missingOwnerAdapterId);
  const missingOwner = await runRestartBridge({
    store,
    agentId,
    project,
    markerPath: missingOwnerPath,
    restartCommand: `${trustedBin} --launch`,
    runtimeAuthorityRef: await saveAuthority("session-missing-owner-adapter", "standalone_supervisor", {
      host_adapter_id: missingOwnerAdapterId,
    }),
    hostAdapterId: missingOwnerAdapterId,
    execute: false,
    env,
    now,
  });
  assert(missingOwner.failure_reason === "restart_adapter_owner_decision_missing", "KR-005: adapter owner_decision_ref is mandatory");

  const legacyMarkerPath = join(root, "legacy-v1.json");
  writeFileSync(legacyMarkerPath, JSON.stringify({
    schema_version: "wasurezu-restart-marker/v1",
    status: "restart_required",
    restart_required: true,
    reason: "legacy",
    agent_id: agentId,
    project,
    host: "claude",
    seat_id: seatId,
    session_id: "session-legacy",
    generated_at: "2026-07-09T00:00:30.000Z",
    context_used_ratio: 0.95,
    runtime_context_error: false,
    band: "require",
    thresholds: { prepare: 0.5, warn: 0.7, recommend: 0.8, require: 0.94 },
  }, null, 2));
  const legacy = await runRestartBridge({
    store,
    agentId,
    project,
    markerPath: legacyMarkerPath,
    restartCommand: `${trustedBin} --launch`,
    runtimeAuthorityRef: await saveAuthority("session-legacy"),
    hostAdapterId,
    execute: false,
    env,
    now,
  });
  assert(legacy.action === "restart_blocked", "KR-001: v1 markers are readable but non-executable");
  assert(legacy.failure_reason === "legacy_marker_non_executable", "KR-001: bridge reports typed v1 rejection");

  const stalePath = join(root, "stale.json");
  writeMarker(stalePath, "session-stale", "2026-07-09T00:00:00.000Z");
  const stale = await runRestartBridge({
    store,
    agentId,
    project,
    markerPath: stalePath,
    restartCommand: `${trustedBin} --launch`,
    runtimeAuthorityRef: await saveAuthority("session-stale"),
    hostAdapterId,
    execute: false,
    env,
    now: "2026-07-09T00:06:00.000Z",
  });
  assert(stale.action === "restart_blocked", "KR-002: stale marker fails closed");
  assert(stale.failure_reason === "stale_or_missing_marker", "KR-002: stale marker reports typed stale_or_missing_marker");

  const dirSelect = join(root, "dir-select");
  mkdirSync(dirSelect, { recursive: true });
  const older = writeMarker(join(dirSelect, "z-lexical-winner-old.json"), "session-dir", "2026-07-09T00:00:10.000Z");
  const newer = writeMarker(join(dirSelect, "a-generated-winner-new.json"), "session-dir", "2026-07-09T00:00:50.000Z");
  const selected = await runRestartBridge({
    store,
    agentId,
    project,
    markerDir: dirSelect,
    restartCommand: `${trustedBin} --launch`,
    runtimeAuthorityRef: await saveAuthority("session-dir"),
    hostAdapterId,
    execute: false,
    env,
    now,
  });
  assert(selected.action === "restart_dry_run", "KR-002: directory mode selects a fresh marker by generated_at");
  assert(selected.event.marker_id === newer.marker.marker_id, "KR-002: generated_at selection ignores filename ordering");
  assert(selected.event.marker_id !== older.marker.marker_id, "KR-002: reverse lexical filename does not select authority");

  const dirAmbiguous = join(root, "dir-ambiguous");
  mkdirSync(dirAmbiguous, { recursive: true });
  writeMarker(join(dirAmbiguous, "a.json"), "session-ambiguous", "2026-07-09T00:00:50.000Z");
  writeMarker(join(dirAmbiguous, "b.json"), "session-ambiguous", "2026-07-09T00:00:50.000Z");
  const ambiguous = await runRestartBridge({
    store,
    agentId,
    project,
    markerDir: dirAmbiguous,
    restartCommand: `${trustedBin} --launch`,
    runtimeAuthorityRef: await saveAuthority("session-ambiguous"),
    hostAdapterId,
    execute: false,
    env,
    now,
  });
  assert(ambiguous.action === "restart_blocked", "KR-002: equal newest generated_at markers fail closed");
  assert(ambiguous.failure_reason === "ambiguous_fresh_markers", "KR-002: ambiguous markers report typed rejection");

  const racePath = join(root, "race.json");
  writeMarker(racePath, "session-race");
  const raceAuthorityRef = await saveAuthority("session-race");
  const raceResults = await Promise.all([
    runRestartBridge({
      store,
      agentId,
      project,
      markerPath: racePath,
      restartCommand: `${trustedBin} --launch`,
      runtimeAuthorityRef: raceAuthorityRef,
      hostAdapterId,
      execute: true,
      env,
      now,
    }),
    runRestartBridge({
      store,
      agentId,
      project,
      markerPath: racePath,
      restartCommand: `${trustedBin} --launch`,
      runtimeAuthorityRef: raceAuthorityRef,
      hostAdapterId,
      execute: true,
      env,
      now,
    }),
  ]);
  assert(raceResults.filter((result) => result.action === "restart_executed").length === 1, "KR-003: exactly one concurrent consumer wins the marker claim");
  assert(raceResults.filter((result) => result.failure_reason === "marker_already_claimed").length === 1, "KR-003: losing concurrent consumer reports marker_already_claimed");
  const fakeInvocations = existsSync(invocationLog) ? readFileSync(invocationLog, "utf8").trim().split("\n").filter(Boolean).length : 0;
  assert(fakeInvocations === 1, "KR-003/KR-010: exactly one fake adapter invocation occurs and no live runtime is started");

  const unknownPath = join(root, "unknown.json");
  const unknown = writeMarker(unknownPath, "session-unknown");
  const unknownDigest = createHash("sha256")
    .update(canonicalJsonForTest(JSON.parse(readFileSync(unknownPath, "utf8"))))
    .digest("hex");
  const unknownClaimPayloadDigest = createHash("sha256")
    .update(canonicalJsonForTest({
      domain: "wasurezu-restart-marker-claim/v1",
      marker_id: unknown.marker.marker_id,
      marker_digest: unknownDigest,
      attempt_ordinal: 1,
      phase: "claim",
    }))
    .digest("hex");
  await store.saveRestartEvent({
    event_id: `restart-marker-claim:${unknownDigest}`,
    agent_id: agentId,
    project,
    marker_id: unknown.marker.marker_id,
    marker_digest: unknownDigest,
    phase: "claim",
    payload_digest: unknownClaimPayloadDigest,
    action: "restart_blocked",
    restart_required: true,
    executed_restart: false,
  });
  await store.saveRestartEvent({
    event_id: `restart-marker-spawn-intent:${unknownDigest}`,
    agent_id: agentId,
    project,
    marker_id: unknown.marker.marker_id,
    marker_digest: unknownDigest,
    phase: "spawn_intent",
    payload_digest: "spawn-digest",
    action: "restart_dry_run",
    restart_required: true,
    executed_restart: false,
  });
  const replayUnknown = await runRestartBridge({
    store,
    agentId,
    project,
    markerPath: unknownPath,
    restartCommand: `${trustedBin} --launch`,
    runtimeAuthorityRef: await saveAuthority("session-unknown"),
    hostAdapterId,
    execute: true,
    env,
    now,
  });
  assert(replayUnknown.action === "restart_blocked", "KR-004: spawn_intent without terminal evidence blocks replay");
  assert(replayUnknown.failure_reason === "invocation_unknown", "KR-004: replay reports invocation_unknown");

  const blockedQueue: QueueDrainCheckResult = {
    mode: "agent_comms_configured",
    result: "blocked",
    allowed: false,
    in_flight_count: 1,
    in_flight_queue_ids: ["124253"],
    failure_reason: "queue_not_drained",
  };
  const blockedQueuePath = join(root, "blocked-queue.json");
  writeMarker(blockedQueuePath, "session-blocked-queue");
  const blocked = await runRestartBridge({
    store,
    agentId,
    project,
    markerPath: blockedQueuePath,
    restartCommand: `${trustedBin} --launch`,
    runtimeAuthorityRef: await saveAuthority("session-blocked-queue", "aun_supervised"),
    hostAdapterId,
    execute: false,
    env,
    queueDrainCheck: async () => blockedQueue,
    now,
  });
  assert(blocked.action === "restart_blocked", "restart bridge blocks configured queue with in-flight work");
  assert(blocked.failure_reason === "queue_not_drained", "KR-007: restart bridge reports queue in-flight blocker");
  assert(blocked.event.queue_check_result === "blocked", "restart event records queue blocked result");

  const missingAunPath = join(root, "missing-aun.json");
  writeMarker(missingAunPath, "session-missing-aun");
  const unavailable = await runRestartBridge({
    store,
    agentId,
    project,
    markerPath: missingAunPath,
    restartCommand: `${trustedBin} --launch`,
    runtimeAuthorityRef: await saveAuthority("session-missing-aun", "aun_supervised"),
    hostAdapterId,
    execute: false,
    env,
    now,
  });
  assert(unavailable.action === "restart_blocked", "KR-006: restart bridge fail-closes when AUN DB URL is absent");
  assert(unavailable.failure_reason === "lifecycle_authority_unknown_or_blocked", "KR-006: absent DB URL does not prove standalone authority");
  assert(unavailable.event.queue_check_result === "unavailable", "restart event records unavailable queue check");

  const events = await store.getRestartEvents({ agent_id: agentId, project, limit: 10 });
  assert(events.length >= 3, "restart_events persistence stores bridge attempts");
  assert(events.some((event) => event.action === "restart_dry_run"), "restart_events include dry-run evidence");
  assert(events.some((event) => event.failure_reason === "queue_not_drained"), "restart_events include queue blocker evidence");
  assert(events.every((event) => event.metadata.runtime_lifecycle_mode !== "production"), "KR-010: restart_events contain no production runtime activation claim");

  const parsedMarker = parseRestartCliArgs([
    "marker",
    "--agent-id",
    agentId,
    "--project",
    project,
    "--marker-path",
    markerPath,
    "--host-id",
    hostId,
    "--host-adapter-id",
    hostAdapterId,
    "--context-used-ratio",
    "0.95",
    "--threshold-require",
    "0.94",
  ]);
  assert(parsedMarker.command === "marker", "wasurezu-restart parser reads marker command");
  assert(parsedMarker.thresholds?.require === 0.94, "wasurezu-restart parser reads threshold override");

  const parsedBridge = parseRestartCliArgs([
    "bridge",
    "--agent-id",
    agentId,
    "--marker-path",
    markerPath,
    "--host-id",
    hostId,
    "--host-adapter-id",
    hostAdapterId,
    "--session-id",
    "session-a",
    "--lifecycle-mode",
    "standalone_supervisor",
    "--supervisor-id",
    "supervisor-a",
    "--supervisor-available",
    "--authority-ref",
    "KUSABI-DEC-STANDALONE-DETECTION",
    "--authority-expires-at",
    expiresAt,
    "--restart-command",
    `${trustedBin} --launch`,
    "--restart-preauthorized",
    "--agent-comms-db-url",
    "postgres://example.invalid/db",
    "--dry-run",
  ]);
  assert(parsedBridge.command === "bridge", "wasurezu-restart parser reads bridge command");
  assert(parsedBridge.agent_comms_db_url === "postgres://example.invalid/db", "wasurezu-restart parser reads agent-comms DB URL");
  assert(parsedBridge.host_adapter_id === hostAdapterId, "wasurezu-restart parser reads host adapter id");
  assert(parsedBridge.lifecycle_mode === "standalone_supervisor", "wasurezu-restart parser reads lifecycle mode");
  assert(parsedBridge.execute === false, "wasurezu-restart bridge defaults can be explicit dry-run");

  await store.close();
  rmSync(root, { recursive: true, force: true });
}

function testPgMigrationSourceOfTruth() {
  console.log("\n── PostgreSQL Migration Source-of-Truth Tests ──");
  const migrateSource = readFileSync("src/migrate.ts", "utf8");
  const pgStoreSource = readFileSync("src/stores/pg-store.ts", "utf8");
  const pgMigrationsSource = readFileSync("src/stores/pg-migrations.ts", "utf8");

  assert(pgMigrationsSource.includes("export const PG_MIGRATIONS"), "PG migrations are exported from the shared source");
  assert(migrateSource.includes("PG_MIGRATIONS"), "standalone migrate runner imports the shared PG migration source");
  assert(pgStoreSource.includes("PG_MIGRATIONS"), "PgStore imports the shared PG migration source");
  assert(!/\bconst\s+MIGRATIONS\s*=/.test(migrateSource), "standalone migrate runner has no local migration array");
  assert(!/\bconst\s+MIGRATIONS\s*=/.test(pgStoreSource), "PgStore has no local migration array");
  assert(!/`[^`]*ALTER TABLE/i.test(migrateSource), "standalone migrate runner does not embed local ALTER statements");
  assert(!/`[^`]*ALTER TABLE/i.test(pgStoreSource), "PgStore does not embed local ALTER statements");
  assert(PG_MIGRATIONS.length > 40, "canonical PG migration source contains the runtime schema history");

  const canonicalSql = PG_MIGRATIONS.map(normalizeSql).join("\n");
  const requiredFragments = [
    ["pgvector extension", "create extension if not exists vector"],
    ["recovery_config table", "create table if not exists recovery_config"],
    ["recovery_quality_log table", "create table if not exists recovery_quality_log"],
    ["task_id task state column", "alter table task_states add column if not exists task_id"],
    ["task state unique index", "create unique index if not exists uq_task_states_agent_task_id"],
    ["knowledge supersedes column", "alter table knowledge add column if not exists supersedes"],
    ["knowledge supersede_reason column", "alter table knowledge add column if not exists supersede_reason"],
    ["conversation event source index", "create unique index if not exists uq_conversation_events_source_event"],
    ["raw event occurred_at column", "alter table raw_events add column if not exists occurred_at"],
    ["raw event occurred_at not-null enforcement", "alter table raw_events alter column occurred_at set not null"],
    ["raw event source unique index", "create unique index if not exists uq_raw_events_source_event"],
    ["selected restart packs table", "create table if not exists selected_restart_packs"],
    ["restart events table", "create table if not exists restart_events"],
    ["restart events agent index", "create index if not exists idx_restart_events_agent"],
  ] as const;

  for (const [label, fragment] of requiredFragments) {
    assert(canonicalSql.includes(fragment), `canonical PG migrations include ${label}`);
  }
}

function testHostAdapterPackagingBoundary() {
  console.log("\n── Host Adapter Packaging Boundary Tests ──");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert(packageJson.files.includes("docs/operations/HOST_ADAPTERS.md"), "npm package includes host adapter docs");
  assert(packageJson.files.includes("docs/operations/WORLD_CLASS_RELEASE_CRITERIA.md"), "npm package includes README-linked release criteria docs");
  assert(packageJson.files.includes("docs/design/schemas"), "npm package includes structured artifact schemas");
  assert(packageJson.files.includes("SECURITY.md"), "npm package includes security policy");
  assert(packageJson.scripts.build.includes("npm run clean && tsc"), "npm build removes stale dist output before compiling");
  assert(packageJson.scripts.prepack === "npm run build", "npm prepack rebuilds package artifacts");
  const tsconfig = JSON.parse(readFileSync("tsconfig.json", "utf8"));
  assert(tsconfig.exclude.includes("src/test*.ts"), "TypeScript package build excludes test entrypoints from dist");
  assert(packageJson.bin["kusabi"] === packageJson.bin["wasurezu"], "npm package exposes kusabi as wasurezu-compatible MCP CLI alias");
  assert(packageJson.bin["kusabi"] === "dist/index.js", "kusabi CLI alias points at the existing MCP entrypoint");
  assert(packageJson.bin["wasurezu"] === "dist/index.js", "wasurezu CLI remains on the existing MCP entrypoint");
  assert(packageJson.bin["agent-memory"] === "dist/index.js", "agent-memory compatibility CLI remains on the existing MCP entrypoint");
  assert(packageJson.bin["wasurezu-restart"] === "dist/restart-cli.js", "npm package exposes wasurezu-restart CLI");
  assert(packageJson.bin["wasurezu-claude-start"] === "dist/claude-start.js", "npm package exposes wasurezu-claude-start CLI");
  assert(packageJson.files.includes("scripts/host-adapters"), "npm package includes optional host adapter scripts");

  const codexHostScripts = [
    "scripts/host-adapters/codex-bridge-launch.sh",
    "scripts/host-adapters/codex-tmux-exit.sh",
    "scripts/host-adapters/codex-tmux-start.sh",
    "scripts/host-adapters/codex-tmux-restart.sh",
  ];
  for (const script of codexHostScripts) {
    assert(existsSync(script), `${script} exists`);
    assert((statSync(script).mode & 0o111) !== 0, `${script} is executable`);
    execFileSync("bash", ["-n", script]);
    assert(true, `${script} passes bash syntax check`);
  }

  const bridgeDryRun = execFileSync("bash", [
    "scripts/host-adapters/codex-bridge-launch.sh",
    "--dry-run",
    "--cd",
    "/tmp/work",
    "--codex-bin",
    "codex-dev",
  ], { encoding: "utf8" });
  assert(bridgeDryRun.includes("DRY-RUN codex bridge launch"), "Codex bridge script supports dry-run");
  assert(bridgeDryRun.includes("wasurezu-codex-start"), "Codex bridge script invokes wasurezu-codex-start");
  assert(bridgeDryRun.includes("--dry-run"), "Codex bridge script dry-run preserves no-launch mode");

  const tmuxExitDryRun = execFileSync("bash", [
    "scripts/host-adapters/codex-tmux-exit.sh",
    "--dry-run",
    "--session",
    "codex-test",
  ], { encoding: "utf8" });
  assert(tmuxExitDryRun.includes("DRY-RUN codex tmux exit"), "Codex tmux exit script supports dry-run");
  assert(tmuxExitDryRun.includes("/exit"), "Codex tmux exit script sends normal host exit command");

  const tmuxStartDryRun = execFileSync("bash", [
    "scripts/host-adapters/codex-tmux-start.sh",
    "--dry-run",
    "--session",
    "codex-test",
    "--cd",
    "/tmp/work",
    "--codex-bin",
    "codex-dev",
  ], { encoding: "utf8" });
  assert(tmuxStartDryRun.includes("DRY-RUN codex tmux start"), "Codex tmux start script supports dry-run");
  assert(tmuxStartDryRun.includes("bridge_command:"), "Codex tmux start script reports bridge command");
  assert(tmuxStartDryRun.includes("wasurezu-codex-start"), "Codex tmux start script starts through the bridge");

  const tmuxRestartDryRun = execFileSync("bash", [
    "scripts/host-adapters/codex-tmux-restart.sh",
    "--dry-run",
    "--session",
    "codex-test",
    "--cd",
    "/tmp/work",
  ], { encoding: "utf8" });
  assert(tmuxRestartDryRun.includes("DRY-RUN codex tmux exit"), "Codex tmux restart script dry-runs exit step");
  assert(tmuxRestartDryRun.includes("DRY-RUN codex tmux start"), "Codex tmux restart script dry-runs start step");

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
  assert(normalizedHostAdapters.includes("A restart marker such as `restart-required.json` is an input signal, not evidence that restart was executed"), "host adapter docs distinguish restart marker from restart execution");
  assert(normalizedHostAdapters.includes("The restart command must be an absolute executable path or a trusted package/bin command"), "host adapter docs require cwd-independent restart command preflight");
  assert(normalizedHostAdapters.includes("Relative commands such as `scripts/restart-from-context-marker.sh` are rejected"), "host adapter docs reject marker-run relative restart commands");
  assert(normalizedHostAdapters.includes("Missing, non-executable, or not-preauthorized restart commands fail closed"), "host adapter docs fail closed for invalid restart commands");
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
  assert(normalizedHostAdapters.includes("Codex launcher hardening helpers"), "host adapter docs document Codex hardening helpers");
  assert(normalizedHostAdapters.includes("scripts/host-adapters/"), "host adapter docs document packaged operator scripts");
  assert(normalizedHostAdapters.includes("`codex [OPTIONS] [PROMPT]`"), "host adapter docs document Codex positional prompt contract");
  assert(lowerHostAdapters.includes("visible in the codex process argv"), "host adapter docs disclose Codex argv visibility limitation");
  assert(normalizedHostAdapters.includes("Raw Capture Coverage Diagnostics"), "host adapter docs define raw capture coverage diagnostics");
  assert(normalizedHostAdapters.includes("unknown files are surfaced as redacted provenance refs only"), "host adapter docs prevent raw capture policy broadening");
  assert(normalizedHostAdapters.includes("raw_capture_unknown_files"), "host adapter docs document unknown-file missing context");
  assert(normalizedHostAdapters.includes("raw_capture_backlog_pending"), "host adapter docs document backlog missing context");
  assert(normalizedHostAdapters.includes("raw_capture_cursor_stale"), "host adapter docs document stale cursor missing context");

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
  assert(normalizedApiContract.includes("CL2 evidence emission profile for `recovery-pack/v1`"), "SSOT-3 documents recovery-pack CL2 evidence profile");
  assert(normalizedApiContract.includes("base `recovery-pack-v1` schema remains backward-compatible"), "SSOT-3 keeps recovery-pack v1 CL2 fields additive optional");
  assert(normalizedApiContract.includes("`approved_memory` requires `promotion_evidence.promotion_ref`"), "SSOT-3 documents approved memory promotion evidence gate");
  assert(normalizedApiContract.includes("`wasurezu-claude-start` is the Claude host runner entrypoint"), "SSOT-3 documents Claude runner API boundary");
  assert(normalizedApiContract.includes("SessionStart remains the selected-pack load hook, not the restart policy owner"), "SSOT-3 pins Claude SessionStart boundary");

  const dataModel = readFileSync("docs/design/core/SSOT-4_DATA_MODEL.md", "utf8");
  const normalizedDataModel = dataModel.replace(/\s+/g, " ");
  assert(normalizedDataModel.includes("this file owns schema/data-model contracts"), "SSOT-4 is limited to schema/data-model contracts");
  assert(normalizedDataModel.includes("`raw_events` is implemented as the first AM-103 ledger slice"), "SSOT-4 marks raw_events implemented");
  assert(normalizedDataModel.includes("conversation events are mirrored into `raw_events`"), "SSOT-4 documents conversation-to-raw bridge");
  assert(normalizedDataModel.includes("Runtime adapters may append structured evidence, but they must not own lifecycle policy"), "SSOT-4 preserves adapter policy boundary");
  assert(normalizedDataModel.includes("API serialization should conform to `recovery-pack/v1`"), "SSOT-4 maps recovery pack schema to data model");
  assert(normalizedDataModel.includes("CL2 evidence fields are additive optional serialization fields"), "SSOT-4 keeps CL2 evidence additive optional");
  assert(normalizedDataModel.includes("`missing_evidence` is contract-completeness evidence and is separate from `missing_context`"), "SSOT-4 separates missing evidence from missing context");
  assert(normalizedDataModel.includes("mark fallback delivery as `tui-fallback`"), "SSOT-4 maps fallback delivery evidence");

  const codexRecovery = readFileSync("docs/operations/CODEX_RECOVERY_CONTROL.md", "utf8");
  const normalizedCodexRecovery = codexRecovery.replace(/\s+/g, " ");
  assert(normalizedCodexRecovery.includes("launcher-controlled"), "Codex recovery docs prefer launcher-controlled recovery");
  assert(normalizedCodexRecovery.includes("soft fallback controls only"), "Codex recovery docs mark AGENTS/tool fallback as soft");
  assert(normalizedCodexRecovery.includes("target_runtime=codex"), "Codex recovery docs bind host invocation target runtime");
  assert(normalizedCodexRecovery.includes("delivery_mode=tui-fallback"), "Codex recovery docs label TUI fallback delivery");
  assert(normalizedCodexRecovery.includes("codex [OPTIONS] [PROMPT]"), "Codex recovery docs pin tested CLI prompt contract");
  assert(normalizedCodexRecovery.includes("wasurezu-codex-start --doctor"), "Codex recovery docs document doctor mode");
  assert(normalizedCodexRecovery.includes("scripts/host-adapters/"), "Codex recovery docs document packaged operator scripts");
  assert(normalizedCodexRecovery.includes("visible in the Codex process argv"), "Codex recovery docs disclose argv visibility limitation");
  assert(normalizedCodexRecovery.includes("Their tests must use `--dry-run`"), "Codex recovery docs require no-live-launch script tests");

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
  assert(!recoveryPackSchema.required.includes("schema_ref"), "recovery-pack schema keeps CL2 fields optional in base v1");
  assert(recoveryPackSchema.properties.schema_ref.const === RECOVERY_PACK_SCHEMA_REF, "recovery-pack schema pins cross-MCP schema_ref");
  assert(recoveryPackSchema.properties.redaction_summary.$ref === "#/$defs/redaction_summary", "recovery-pack schema reuses canonical redaction summary def");
  assert(recoveryPackSchema.properties.token_budget.minimum === 1, "recovery-pack schema pins token budget minimum");
  assert(recoveryPackSchema.properties.confidence.enum.includes("low"), "recovery-pack schema has low confidence enum");
  assert(recoveryPackSchema.$defs.redaction_summary.properties.private_reasoning_excluded.const === true, "recovery-pack redaction summary excludes private reasoning");
  assert(recoveryPackSchema.$defs.redaction_summary.properties.redacted_counts.additionalProperties.minimum === 0, "recovery-pack redaction summary counts are non-negative");
  assert(sameStringSet(Object.keys(recoveryPackSchema.properties.review_prompt.properties), RECOVERY_PACK_REVIEW_PROMPT_ALLOWED_KEYS), "recovery-pack review_prompt validator keys match schema properties");
  const recoveryItem = recoveryPackSchema.$defs.recovery_pack_item;
  assert(recoveryItem.additionalProperties === false, "recovery-pack item schema rejects additional properties");
  assert(sameStringSet(Object.keys(recoveryItem.properties), RECOVERY_PACK_ITEM_ALLOWED_KEYS), "recovery-pack item validator keys match schema properties");
  assert(recoveryItem.required.includes("source_ref"), "recovery-pack items require provenance source");
  assert(!recoveryItem.required.includes("memory_safety_class"), "recovery-pack items keep CL2 fields optional in base v1");
  assert(recoveryItem.properties.trust_level.enum.includes("external"), "recovery-pack items support external trust level");
  assert(recoveryItem.properties.sensitivity.enum.includes("secret_redacted"), "recovery-pack items record redaction status");
  assert(recoveryItem.properties.memory_safety_class.enum.includes("raw_event_source"), "recovery-pack items support raw event source safety class");
  assert(recoveryItem.properties.promotion_evidence.$ref === "#/$defs/promotion_evidence", "recovery-pack approved memory promotion evidence has a canonical def");
  assert(recoveryPackSchema.$defs.promotion_evidence.required.includes("promotion_ref"), "recovery-pack promotion evidence requires promotion_ref");

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

async function testCoreMcpToolRegression() {
  console.log("\n── Core MCP Tool Regression Tests ──");

  const tmpHome = mkdtempSync(join(tmpdir(), "agent-memory-mcp-core-"));
  const dbPath = join(tmpHome, "memory.db");
  const agentId = "mcp-core-agent-a";
  const otherAgentId = "mcp-core-agent-b";
  const project = "mcp-core-project";
  const cli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const baseEnv = inheritedEnv();
  delete baseEnv.AGENT_MEMORY_DATABASE_URL;
  delete baseEnv.DATABASE_URL;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "src/index.ts"],
    cwd: process.cwd(),
    stderr: "pipe",
    env: {
      ...baseEnv,
      HOME: tmpHome,
      AGENT_MEMORY_DB_TYPE: "sqlite",
      AGENT_MEMORY_DB_PATH: dbPath,
      AGENT_MEMORY_AGENT_ID: agentId,
      AGENT_MEMORY_PROJECT: project,
      CLAUDE_SESSION_ID: "mcp-core-regression-session",
    },
  });
  const client = new Client({ name: "agent-memory-core-mcp-test", version: "0.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);

    const listed = await client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name).sort();
    for (const expected of [
      "log_decision",
      "get_decisions",
      "save_task_state",
      "search_memory",
      "recover_context",
      "restart_pack",
      "restart_prepare",
      "restart_pack_fetch",
      "save_knowledge",
      "get_knowledge",
    ]) {
      assert(toolNames.includes(expected), `MCP listTools exposes ${expected}`);
    }

    const searchTool = listed.tools.find((tool) => tool.name === "search_memory");
    assert(Boolean(searchTool?.inputSchema?.properties?.query), "search_memory schema requires query property");
    assert(Boolean(searchTool?.inputSchema?.properties?.scope), "search_memory schema exposes scope property");
    const restartPrepareTool = listed.tools.find((tool) => tool.name === "restart_prepare");
    assert(Boolean(restartPrepareTool?.inputSchema?.properties?.pack_format), "restart_prepare schema exposes pack_format");
    assert(
      restartPrepareTool?.description?.includes("does not stop, restart, requeue") === true,
      "restart_prepare description preserves lifecycle boundary"
    );
    const restartFetchTool = listed.tools.find((tool) => tool.name === "restart_pack_fetch");
    assert(Boolean(restartFetchTool?.inputSchema?.properties?.consume), "restart_pack_fetch schema exposes consume flag");

    const logged = await client.callTool({
      name: "log_decision",
      arguments: {
        project,
        decision: "Use MCP regression coverage for Core MVP",
        context: "Protect current wasurezu tool behavior before further implementation.",
        tags: ["mcp", "core-mvp"],
      },
    });
    assert(toolResultText(logged).includes("Decision logged"), "log_decision returns success text");

    const decisions = await client.callTool({
      name: "get_decisions",
      arguments: { project, tags: ["mcp"], status: "active", limit: 5 },
    });
    const decisionText = toolResultText(decisions);
    assert(decisionText.includes("Use MCP regression coverage"), "get_decisions returns logged decision");
    assert(decisionText.includes("core-mvp"), "get_decisions returns tags");

    const task = await client.callTool({
      name: "save_task_state",
      arguments: {
        project,
        task: "Core MCP regression coverage",
        status: "in_progress",
        progress: "MCP stdio smoke covers core tools",
        files_modified: ["src/test.ts"],
        next_steps: "Keep current MCP tool behavior stable",
      },
    });
    assert(toolResultText(task).includes("Task state saved"), "save_task_state returns success text");

    const knowledge = await client.callTool({
      name: "save_knowledge",
      arguments: {
        project,
        title: "MCP regression coverage shape",
        content: "Core MVP protects decisions, task state, knowledge, search, recovery, restart prepare, and selected pack fetch.",
        source_type: "manual",
        tags: ["mcp", "coverage"],
      },
    });
    assert(toolResultText(knowledge).includes("Knowledge saved"), "save_knowledge returns success text");

    const search = await client.callTool({
      name: "search_memory",
      arguments: { project, query: "MCP regression coverage", scope: "all", limit: 10 },
    });
    const searchText = toolResultText(search);
    assert(searchText.includes("DECISIONS"), "search_memory returns decision section");
    assert(searchText.includes("TASK STATES"), "search_memory returns task section");
    assert(searchText.includes("KNOWLEDGE"), "search_memory returns knowledge section");
    assert(searchText.includes("Core MCP regression coverage"), "search_memory returns seeded task");

    const otherTransport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, "src/index.ts"],
      cwd: process.cwd(),
      stderr: "pipe",
      env: {
        ...baseEnv,
        HOME: tmpHome,
        AGENT_MEMORY_DB_TYPE: "sqlite",
        AGENT_MEMORY_DB_PATH: dbPath,
        AGENT_MEMORY_AGENT_ID: otherAgentId,
        AGENT_MEMORY_PROJECT: project,
        CLAUDE_SESSION_ID: "mcp-core-regression-other-session",
      },
    });
    const otherClient = new Client({ name: "agent-memory-core-mcp-other-agent-test", version: "0.0.0" }, { capabilities: {} });
    try {
      await otherClient.connect(otherTransport);
      const isolated = await otherClient.callTool({
        name: "search_memory",
        arguments: { project, query: "MCP regression coverage", scope: "all", limit: 10 },
      });
      assert(toolResultText(isolated).includes("no results"), "MCP tools preserve agent isolation across same DB path");
    } finally {
      await otherClient.close();
      await otherTransport.close();
    }

    const recovery = await client.callTool({ name: "recover_context", arguments: { project } });
    const recoveryText = toolResultText(recovery);
    assert(recoveryText.includes("Core MCP regression coverage"), "recover_context returns active task");
    assert(recoveryText.includes("Use MCP regression coverage"), "recover_context returns active decision");
    assert(recoveryText.includes("MCP regression coverage shape"), "recover_context returns knowledge");

    const pack = await client.callTool({
      name: "restart_pack",
      arguments: { project, max_tokens: 1000 },
    });
    const packText = toolResultText(pack);
    assert(packText.includes("CURRENT OBJECTIVE"), "restart_pack returns current objective section");
    assert(packText.includes("Core MCP regression coverage"), "restart_pack returns seeded task");

    const prepared = await client.callTool({
      name: "restart_prepare",
      arguments: {
        project,
        context_used_ratio: 0.91,
        continuity_guard_mode: "recommend",
        pack_injection_mode: "auto_attach",
        emit_pack: false,
      },
    });
    const preparedJson = JSON.parse(toolResultText(prepared));
    assert(preparedJson.action === "restart_recommended", "restart_prepare recommends restart at host metric threshold");
    assert(
      typeof preparedJson.pack_ref === "string" && preparedJson.pack_ref.startsWith("selected_restart_pack:"),
      "restart_prepare returns selected_restart_pack ref"
    );

    const fetched = await client.callTool({
      name: "restart_pack_fetch",
      arguments: { project, pack_ref: preparedJson.pack_ref, consume: true },
    });
    const fetchedJson = JSON.parse(toolResultText(fetched));
    assert(fetchedJson.pack_ref === preparedJson.pack_ref, "restart_pack_fetch returns selected pack by ref");
    assert(fetchedJson.status === "consumed", "restart_pack_fetch marks pack consumed when consume=true");

    const consumedAgain = await client.callTool({
      name: "restart_pack_fetch",
      arguments: { project, pack_ref: preparedJson.pack_ref, consume: true },
    });
    assert(consumedAgain.isError === true, "restart_pack_fetch consume is single-use");
    assert(toolResultText(consumedAgain).includes("not found or already consumed"), "restart_pack_fetch reports consumed pack");
  } finally {
    await client.close();
    await transport.close();
    rmSync(tmpHome, { recursive: true, force: true });
  }
}

async function testRestartRecoverySmokeEvidence() {
  console.log("\n── Restart/Recovery Smoke Evidence Tests ──");

  const tmpHome = mkdtempSync(join(tmpdir(), "agent-memory-recovery-smoke-"));
  const dbPath = join(tmpHome, "memory.db");
  const agentId = "recovery-smoke-agent";
  const project = "recovery-smoke-project";
  const cli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const baseEnv = inheritedEnv();
  delete baseEnv.AGENT_MEMORY_DATABASE_URL;
  delete baseEnv.DATABASE_URL;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "src/index.ts"],
    cwd: process.cwd(),
    stderr: "pipe",
    env: {
      ...baseEnv,
      HOME: tmpHome,
      AGENT_MEMORY_DB_TYPE: "sqlite",
      AGENT_MEMORY_DB_PATH: dbPath,
      AGENT_MEMORY_AGENT_ID: agentId,
      AGENT_MEMORY_PROJECT: project,
      CLAUDE_SESSION_ID: "recovery-smoke-mcp-session",
    },
  });
  const client = new Client({ name: "agent-memory-recovery-smoke-test", version: "0.0.0" }, { capabilities: {} });

  let codexRestartPackText = "";
  let codexSmokeOutput = "";

  try {
    await client.connect(transport);

    await client.callTool({
      name: "save_task_state",
      arguments: {
        project,
        task: "Core MVP restart recovery smoke",
        status: "in_progress",
        progress: "Manual MCP, Codex bridge, and Claude SessionStart paths are under smoke coverage.",
        files_modified: ["src/test.ts"],
        next_steps: "Keep restart recovery evidence scoped to current compatibility surfaces.",
      },
    });
    await client.callTool({
      name: "log_decision",
      arguments: {
        project,
        decision: "Restart recovery smoke evidence must keep manual and startup paths separate.",
        context: "Manual MCP recovery, Codex prompt preview, and Claude SessionStart selected packs remain distinct current paths.",
        tags: ["core-mvp", "restart-smoke"],
      },
    });
    await client.callTool({
      name: "save_knowledge",
      arguments: {
        project,
        title: "Recovery smoke boundary",
        content: "Core MVP smoke evidence covers current compatibility paths only and does not claim future protocol conformance.",
        source_type: "manual",
        tags: ["core-mvp", "recovery"],
      },
    });

    const manualRecovery = await client.callTool({ name: "recover_context", arguments: { project } });
    const manualRecoveryText = toolResultText(manualRecovery);
    assert(manualRecoveryText.includes("Core MVP restart recovery smoke"), "manual MCP recover_context returns smoke task");
    assert(manualRecoveryText.includes("Restart recovery smoke evidence"), "manual MCP recover_context returns smoke decision");
    assert(manualRecoveryText.includes("Recovery smoke boundary"), "manual MCP recover_context returns smoke knowledge");

    const restartPack = await client.callTool({ name: "restart_pack", arguments: { project, max_tokens: 1200 } });
    codexRestartPackText = toolResultText(restartPack);
    assert(codexRestartPackText.includes("SESSION RESTART PACK"), "manual MCP restart_pack returns restart pack text");
    assert(codexRestartPackText.includes("Core MVP restart recovery smoke"), "manual MCP restart_pack includes smoke task");

    const prepared = await client.callTool({
      name: "restart_prepare",
      arguments: {
        project,
        context_used_ratio: 0.91,
        continuity_guard_mode: "recommend",
        pack_format: "host-invocation-context-v1",
        target_runtime: "codex",
        delivery_mode: "stdin-json",
        emit_pack: false,
      },
    });
    const preparedJson = JSON.parse(toolResultText(prepared));
    assert(preparedJson.action === "restart_recommended", "manual MCP restart_prepare reports restart recommendation");
    assert(preparedJson.can_auto_restart === false, "manual MCP restart_prepare does not claim automatic restart");
    assert(preparedJson.restart_pack_format === "host-invocation-context-v1", "manual MCP restart_prepare records Codex host context format");
    assert(preparedJson.restart_pack_schema_ref === "host-invocation-context/v1", "manual MCP restart_prepare records host context schema ref");
    assert(typeof preparedJson.pack_ref === "string", "manual MCP restart_prepare returns selected pack ref");

    const selectedCodex = await client.callTool({
      name: "restart_pack_fetch",
      arguments: { project, pack_ref: preparedJson.pack_ref, consume: false },
    });
    const selectedCodexPack = JSON.parse(toolResultText(selectedCodex));
    const selectedCodexContent = JSON.parse(selectedCodexPack.content);
    assert(selectedCodexPack.pack_ref === preparedJson.pack_ref, "manual MCP restart_pack_fetch returns selected pack");
    assert(validateHostInvocationContextArtifact(selectedCodexContent).valid, "Codex selected restart pack validates as host invocation context");
    assert(selectedCodexContent.target_runtime === "codex", "Codex selected restart pack targets Codex");
    assert(selectedCodexContent.delivery_mode === "stdin-json", "Codex selected restart pack records stdin-json delivery");

    codexSmokeOutput = [
      manualRecoveryText,
      codexRestartPackText,
      JSON.stringify(preparedJson),
      JSON.stringify(selectedCodexContent),
    ].join("\n");
  } finally {
    await client.close();
    await transport.close();
  }

  const codexPrompt = buildCodexStartupPrompt({
    agentId,
    project,
    restartPack: codexRestartPackText,
    extraInstruction: "Treat this as smoke evidence, not release evidence.",
  });
  const codexPreview = buildCodexLaunchPreview({ launch: true, dryRun: true, cd: tmpHome, codexBin: "codex-dev" }, codexPrompt);
  assert(codexPrompt.includes("fresh Codex session"), "Codex startup bridge builds restart prompt");
  assert(codexPrompt.includes("Layer 1 recovery"), "Codex startup prompt labels recovery layer");
  assert(codexPreview.live_launch_performed === false, "Codex startup smoke does not launch Codex");
  assert(codexPreview.args_preview.includes("[restart_pack prompt omitted]"), "Codex startup preview omits restart pack payload");

  const claudeStore = new SqliteStore(dbPath);
  await claudeStore.initialize();
  try {
    const claude = await prepareClaudeResession(claudeStore, {
      agentId,
      project,
      contextUsedRatio: 0.96,
      launch: true,
      continuityGuardMode: "auto_restart",
      aunAbsentConfirmed: true,
      supervisorAvailable: true,
      restartPreauthorized: true,
    });
    assert(claude.runner === "wasurezu-claude-start", "Claude smoke uses current Claude runner");
    assert(claude.prepare.action === "restart_required", "Claude smoke maps high context to restart_required");
    assert(claude.prepare.restart_pack_format === "host-invocation-context-v1", "Claude smoke prepares structured selected pack");
    assert(claude.prepare.restart_pack_schema_ref === "host-invocation-context/v1", "Claude smoke records host context schema ref");
    assert(claude.launch_requested === true, "Claude smoke records launch request");
    assert(claude.launched_claude === false, "Claude smoke does not live-launch Claude");
    assert(claude.launch_blockers.length === 0, "Claude smoke has no standalone launch blockers when gates pass");
    assert(claude.next_session_env.AGENT_MEMORY_BOOT_MODE === "restart_pack", "Claude smoke records restart pack boot mode");
    assert(claude.next_session_env.AGENT_MEMORY_SELECTED_PACK_REF === claude.prepare.pack_ref, "Claude smoke passes selected pack ref to next session env");

    const selectedClaude = await claudeStore.getSelectedRestartPack({ agent_id: agentId, project, pack_ref: claude.prepare.pack_ref! });
    const selectedClaudeContent = JSON.parse(selectedClaude!.content);
    assert(validateHostInvocationContextArtifact(selectedClaudeContent).valid, "Claude selected restart pack validates as host invocation context");
    assert(selectedClaudeContent.target_runtime === "claude", "Claude selected restart pack targets Claude");
    assert(selectedClaudeContent.delivery_mode === "session-start-hook", "Claude selected restart pack records SessionStart delivery");

    const smokeClaimSurface = [
      codexSmokeOutput,
      codexPrompt,
      JSON.stringify(codexPreview),
      JSON.stringify(claude),
      JSON.stringify(selectedClaudeContent),
    ].join("\n").toLowerCase();
    assert(!smokeClaimSurface.includes("uamp conformance"), "restart recovery smoke makes no UAMP conformance claim");
    assert(!smokeClaimSurface.includes("universal startup recovery"), "restart recovery smoke makes no universal startup recovery claim");
  } finally {
    await claudeStore.close();
    rmSync(tmpHome, { recursive: true, force: true });
  }
}

async function testSqliteSupersedeKnowledgeAgentIsolation() {
  console.log("\n── supersedeKnowledge agent_id isolation (SqliteStore) ──");
  const dbPath = join(mkdtempSync(join(tmpdir(), "am076-sqlite-iso-")), "test.db");

  const storeA = new SqliteStore(dbPath);
  await storeA.initialize();

  const storeB = new SqliteStore(dbPath);
  await storeB.initialize();

  const agentA = "agent-iso-a";
  const agentB = "agent-iso-b";

  // Seed agent A with K1
  const k1 = await storeA.saveKnowledge({
    agent_id: agentA,
    title: "shared-title",
    content: "Agent A version of shared-title",
    source_type: "manual",
    project: "iso-test",
  });

  // Seed agent B with K2 (same title, different agent)
  const k2 = await storeB.saveKnowledge({
    agent_id: agentB,
    title: "shared-title",
    content: "Agent B version of shared-title",
    source_type: "manual",
    project: "iso-test",
  });

  // Agent A supersedes K1
  const result = await storeA.supersedeKnowledge({
    agent_id: agentA,
    old_id: k1.id,
    new_title: "shared-title (updated by A)",
    new_content: "Agent A superseded version",
    reason: "agent A refreshed",
    project: "iso-test",
  });
  assert(result.old.status === "superseded", "agent A: old K1 is superseded");

  // Agent B's K2 must still be active
  const bKnowledge = await storeB.getKnowledge({ agent_id: agentB, status: "active" });
  const bK2 = bKnowledge.find((k) => k.id === k2.id);
  assert(bK2 !== undefined, "agent B's K2 still exists after agent A supersedes");
  assert(bK2?.status === "active", "agent B's K2 is still active (not affected by agent A supersede)");

  // Agent A's old K1 is superseded
  const aAll = await storeA.getKnowledge({ agent_id: agentA, status: "all" });
  const aK1 = aAll.find((k) => k.id === k1.id);
  assert(aK1?.status === "superseded", "agent A's old K1 is superseded in SqliteStore");

  await storeA.close();
  await storeB.close();
  rmSync(dbPath, { force: true });
}

async function testSqliteMigrationIdempotency() {
  console.log("\n── Migration idempotency (SqliteStore) ──");
  const dbPath = join(mkdtempSync(join(tmpdir(), "am076-sqlite-idempotent-")), "test.db");

  // First initialization + seed data
  const store1 = new SqliteStore(dbPath);
  await store1.initialize();

  const agentId = "idempotency-test-agent";
  const k1 = await store1.saveKnowledge({
    agent_id: agentId,
    title: "Idempotency Knowledge Item",
    content: "This row must survive double-initialize.",
    source_type: "manual",
    project: "idempotency-test",
  });
  const d1 = await store1.logDecision({
    agent_id: agentId,
    decision: "Use idempotent migrations",
    context: "Double-init must not destroy data.",
    tags: ["migration"],
    project: "idempotency-test",
  });
  await store1.close();

  // Second initialization on same path — should be safe
  const store2 = new SqliteStore(dbPath);
  await store2.initialize();

  const knowledgeAfter = await store2.getKnowledge({ agent_id: agentId, status: "all" });
  assert(knowledgeAfter.length === 1, "seeded knowledge row survives double-initialize");
  assert(knowledgeAfter[0].id === k1.id, "knowledge row id is unchanged after re-initialize");

  const decisionsAfter = await store2.getDecisions({ agent_id: agentId, status: "all" });
  assert(decisionsAfter.length === 1, "seeded decision row survives double-initialize");
  assert(decisionsAfter[0].id === d1.id, "decision row id is unchanged after re-initialize");

  // No duplicate rows
  const allKnowledge = await store2.getKnowledge({ agent_id: agentId, status: "all" });
  const knowledgeIds = allKnowledge.map((k) => k.id);
  const uniqueKnowledgeIds = new Set(knowledgeIds);
  assert(knowledgeIds.length === uniqueKnowledgeIds.size, "no duplicate knowledge rows after double-initialize");

  const allDecisions = await store2.getDecisions({ agent_id: agentId, status: "all" });
  const decisionIds = allDecisions.map((d) => d.id);
  const uniqueDecisionIds = new Set(decisionIds);
  assert(decisionIds.length === uniqueDecisionIds.size, "no duplicate decision rows after double-initialize");

  await store2.close();
  rmSync(dbPath, { force: true });
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
  await testPostgresStoreIntentFailsClosed();
  testRawCaptureCoverage();
  testCatchUpSourceADryRun();
  await testConversationEvents();
  await testClaudeConversationIngest();
  await testCodexConversationIngest();
  await testRestartPack();
  await testCodexStartupBridge();
  await testClaudeResessionRunner();
  await testClaudeMarkerController();
  testRestartCommandPreflight();
  testSupervisorPreflight();
  await testRestartPrepare();
  await testRestartMarkerBridge();
  await testCoreMcpToolRegression();
  await testRestartRecoverySmokeEvidence();
  testPgMigrationSourceOfTruth();
  testHostAdapterPackagingBoundary();
  testConversationScopeSchemaRegression();
  testGovernedActionProfiles();
  testAunGateEvidenceRefs();
  testMemorySafetyGovernance();
  await testSqliteSupersedeKnowledgeAgentIsolation();
  await testSqliteMigrationIdempotency();

  await cleanup();

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
