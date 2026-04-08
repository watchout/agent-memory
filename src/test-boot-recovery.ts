#!/usr/bin/env node
/**
 * E2E proof-of-life test for AM-002 Stage 1.
 *
 * Spawns `tsx src/boot.ts` against a temp SQLite DB, then verifies that
 * a `recovery_quality_log` row was inserted with the expected `notes`
 * JSON shape. This guarantees the boot path actually calls
 * `logRecoveryQuality`, which was the gap that AM-002 fixes.
 *
 * Run: tsx src/test-boot-recovery.ts
 */
import { spawn } from "child_process";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SqliteStore } from "./stores/sqlite-store.js";

const TEST_DB_PATH = join(tmpdir(), `agent-memory-boot-e2e-${Date.now()}.db`);
const AGENT_ID = `test-boot-${Date.now()}`;
const SESSION_ID = `test-session-${Date.now()}`;

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

async function seed() {
  // Pre-populate the DB with a decision and an in_progress task so the
  // recovery output has non-trivial counts to summarize.
  const store = new SqliteStore(TEST_DB_PATH);
  await store.initialize();
  await store.logDecision({
    agent_id: AGENT_ID,
    decision: "AM-002 boot E2E test seed decision",
    tags: ["test"],
  });
  await store.saveTaskState({
    agent_id: AGENT_ID,
    task: "AM-002 boot E2E test seed task",
    status: "in_progress",
  });
  await store.close();
}

function runBoot(): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", "src/boot.ts"], {
      env: {
        ...process.env,
        AGENT_MEMORY_DB_TYPE: "sqlite",
        AGENT_MEMORY_DB_PATH: TEST_DB_PATH,
        AGENT_MEMORY_AGENT_ID: AGENT_ID,
        CLAUDE_SESSION_ID: SESSION_ID,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", () => {
      /* swallow recovery output */
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

async function verify() {
  const store = new SqliteStore(TEST_DB_PATH);
  await store.initialize();

  const sqlitePrivate = store as unknown as {
    db: {
      prepare: (sql: string) => {
        bind: (p: unknown[]) => void;
        step: () => boolean;
        getAsObject: () => Record<string, unknown>;
        free: () => void;
      };
    };
  };

  const stmt = sqlitePrivate.db.prepare(
    `SELECT id, agent_id, session_id, recovered_tokens,
            task_continued, quality_score, notes, search_memory_count_10min
       FROM recovery_quality_log
      WHERE agent_id = ?
      ORDER BY created_at DESC`
  );
  stmt.bind([AGENT_ID]);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();

  assert(rows.length >= 1, "boot inserted at least one recovery_quality_log row");
  const row = rows[0];

  assert(row.session_id === SESSION_ID, "session_id matches the env var");
  assert(typeof row.recovered_tokens === "number" && (row.recovered_tokens as number) > 0, "recovered_tokens is positive");
  assert(row.task_continued === 0, "task_continued is 0 (Stage 1 always false)");
  assert(row.notes !== null && typeof row.notes === "string", "notes JSON is present");

  // Parse notes and confirm summary shape
  let summary: Record<string, unknown> = {};
  try {
    summary = JSON.parse(row.notes as string);
  } catch {
    // fall through — assertion below will fail
  }
  assert(summary.source === "boot", "notes.source = 'boot'");
  assert(typeof summary.decisions === "number", "notes.decisions is a number");
  assert(typeof summary.tasks_in_progress === "number", "notes.tasks_in_progress is a number");
  assert(typeof summary.knowledge === "number", "notes.knowledge is a number");
  assert((summary.decisions as number) >= 1, "notes.decisions reflects seeded decision");
  assert((summary.tasks_in_progress as number) >= 1, "notes.tasks_in_progress reflects seeded task");

  await store.close();
}

async function cleanup() {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
}

async function run() {
  console.log("agent-memory boot recovery E2E test (AM-002)\n");
  console.log(`DB path: ${TEST_DB_PATH}`);
  console.log(`Agent: ${AGENT_ID}`);
  console.log(`Session: ${SESSION_ID}\n`);

  try {
    await seed();
    const result = await runBoot();
    if (result.code !== 0) {
      console.error("boot.ts exited with non-zero code");
      console.error("stderr:", result.stderr);
      failed++;
    } else {
      assert(true, "boot.ts exited cleanly");
    }
    await verify();
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
