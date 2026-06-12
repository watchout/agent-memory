#!/usr/bin/env node
/**
 * Gate 0 test: recover_context / boot recovery output must not leak
 * secrets.
 *
 * buildRecoveryOutput (src/constants.ts) is the shared formatter for
 * the recover_context MCP tool and the boot.ts restart-pack-failure
 * fallback. Structured memory is not redacted at ingest, so this
 * output boundary must redact.
 * Spec: docs/impl/IMPL-2026-06-12-recovery-output-redaction.md
 *
 * Run: HOME=$(mktemp -d) npx tsx tests/gate0/recovery-output-redaction.ts
 */
import { DEFAULT_RECOVERY_CONFIG, buildRecoveryOutput } from "../../src/constants.js";
import { redactText } from "../../src/redact.js";
import { SqliteStore } from "../../src/stores/sqlite-store.js";
import type { TaskState, Decision, Knowledge, AgentMessage } from "../../src/stores/types.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗  ${msg}`);
    failed++;
  }
}

const FAKE_SK_KEY = "sk-fakeBootLeak0123456789abcdefghij";
const FAKE_AKIA_KEY = "AKIAIOSFODNN7EXAMPLE";
const FAKE_DB_URL = "DATABASE_URL=postgres://svc:hunter2@db.internal:5432/prod";
const FAKE_GHO_TOKEN = "gho_fakeBootLeakABCDEFGHIJKLMNOPQRS";
const FAKE_SLACK_TOKEN = "xoxb-1234567890-fakeBootLeakSlack";
const FAKE_EMAIL = "boot.leak@example.com";
const FAKE_BEARER = "Bearer fakeBootLeakBearerToken123";

const NOW = "2026-06-12T00:00:00.000Z";

function fixtureParams() {
  const task: TaskState = {
    id: "t1",
    agent_id: "gate0-boot",
    project: "gate0",
    task: `deploy probeword with ${FAKE_SK_KEY}`,
    status: "in_progress",
    progress: `ran with ${FAKE_AKIA_KEY}`,
    next_steps: `rotate ${FAKE_DB_URL}`,
    files_modified: ["src/app.ts"],
    created_at: NOW,
    updated_at: NOW,
  } as unknown as TaskState;

  const decision: Decision = {
    id: "d1",
    agent_id: "gate0-boot",
    project: "gate0",
    decision: `use CI bot token ${FAKE_GHO_TOKEN} for pushes`,
    context: "ctx",
    status: "active",
    tags: [],
    created_at: NOW,
  } as unknown as Decision;

  const knowledge: Knowledge = {
    id: "k1",
    agent_id: "gate0-boot",
    project: "gate0",
    title: `alerts use ${FAKE_SLACK_TOKEN}`,
    content: "body not rendered in boot output",
    source_type: "manual",
    status: "active",
    tags: [],
    created_at: NOW,
    updated_at: NOW,
  } as unknown as Knowledge;

  const message: AgentMessage = {
    id: "m1",
    agent_id: "gate0-boot",
    author_id: "someone",
    source: "agent-comms",
    content: `mail ${FAKE_EMAIL} auth ${FAKE_BEARER}`,
    created_at: NOW,
  } as unknown as AgentMessage;

  return {
    agentId: "gate0-boot",
    project: "gate0",
    config: DEFAULT_RECOVERY_CONFIG,
    inProgressTasks: [task],
    completedTasks: [],
    decisions: [decision],
    knowledgeItems: [knowledge],
    messages: [message],
    discordHistory: [`history line with ${FAKE_SK_KEY}`],
  };
}

const RAW_FIXTURES = [
  FAKE_SK_KEY,
  FAKE_AKIA_KEY,
  "hunter2",
  FAKE_GHO_TOKEN,
  FAKE_SLACK_TOKEN,
  FAKE_EMAIL,
  FAKE_BEARER,
];

async function runTests(): Promise<void> {
  console.log("\n── Gate 0: recovery-output-redaction ──");

  // 1. Pure-function probe across every rendered field class.
  const output = buildRecoveryOutput(fixtureParams());
  for (const raw of RAW_FIXTURES) {
    assert(!output.includes(raw), `raw fixture absent from boot output: ${raw.slice(0, 12)}…`);
  }
  assert(output.includes("[REDACTED]"), "output contains [REDACTED] placeholder");
  assert(output.includes("⚡ SESSION BOOT"), "SESSION BOOT header intact");
  assert(output.includes("── CURRENT WORK ──"), "task section header intact");
  assert(output.includes("RECOVERY CONTROL"), "recovery control footer intact");
  assert(
    redactText(output).text === output,
    "re-applied redactText leaves output unchanged (fixpoint)"
  );

  // 2. Truncation safety: tiny budget must not bisect into a leak.
  const tiny = buildRecoveryOutput({
    ...fixtureParams(),
    config: { ...DEFAULT_RECOVERY_CONFIG, max_tokens: 120 },
  });
  for (const raw of RAW_FIXTURES) {
    assert(!tiny.includes(raw), `raw fixture absent under truncation: ${raw.slice(0, 12)}…`);
  }

  // 3. Store-backed probe: real rows through getTaskStates.
  const tmpDir = mkdtempSync(join(tmpdir(), "gate0-boot-"));
  try {
    const store = new SqliteStore(join(tmpDir, "test.db"));
    await store.initialize();
    await store.saveTaskState({
      agent_id: "gate0-boot",
      project: "gate0",
      task: "store-backed probeword task",
      status: "in_progress",
      progress: `uses ${FAKE_SK_KEY} and ${FAKE_AKIA_KEY}`,
    });
    const tasks = await store.getTaskStates({ agent_id: "gate0-boot", project: "gate0", status: "in_progress" });
    assert(tasks.length === 1, "store-backed task row seeded");
    const storeOutput = buildRecoveryOutput({
      agentId: "gate0-boot",
      project: "gate0",
      config: DEFAULT_RECOVERY_CONFIG,
      inProgressTasks: tasks,
      completedTasks: [],
      decisions: [],
      knowledgeItems: [],
      messages: [],
    });
    assert(!storeOutput.includes(FAKE_SK_KEY), "store-backed output: sk- key absent");
    assert(!storeOutput.includes(FAKE_AKIA_KEY), "store-backed output: AKIA key absent");
    assert(storeOutput.includes("store-backed probeword task"), "store-backed benign text preserved");
    await store.close?.();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

runTests()
  .then(() => {
    console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
  });
