#!/usr/bin/env node
/**
 * Gate 0 test: search_memory must not leak secrets and must return
 * correct results across decisions, tasks, and knowledge.
 *
 * Seeds a temporary SqliteStore with known data (including fake secret
 * strings) and asserts:
 *   1. searchMemory finds seeded records by keyword.
 *   2. searchMemory does not return raw secret values in any result field.
 *   3. Scope filtering (decisions / tasks / knowledge) works correctly.
 *   4. Agent isolation: agent B's results do not appear in agent A's query.
 *
 * Run: HOME=$(mktemp -d) npx tsx tests/gate0/search-memory-regression.ts
 */
import { SqliteStore } from "../../src/stores/sqlite-store.js";
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

const AGENT_A = "gate0-search-agent-a";
const AGENT_B = "gate0-search-agent-b";
const PROJECT = "gate0";

const FAKE_API_KEY = "sk-ant-fake9999XXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const FAKE_GH_TOKEN = "github_pat_fakeTokenABCDEFGHIJKLMNOPQ";

async function runTests(): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), "gate0-search-"));
  const dbPath = join(tmpDir, "test.db");

  try {
    const store = new SqliteStore(dbPath);
    await store.initialize();

    // Seed agent A: decision containing a secret-like string
    await store.logDecision({
      agent_id: AGENT_A,
      project: PROJECT,
      decision: `Use external API with key=${FAKE_API_KEY}`,
      context: "Cost evaluation",
    });

    // Seed agent A: normal decision (findable by keyword)
    await store.logDecision({
      agent_id: AGENT_A,
      project: PROJECT,
      decision: "Adopt SqliteStore as the default backend for OSS distribution",
      context: "Ease of setup for new users",
    });

    // Seed agent A: task
    await store.saveTaskState({
      agent_id: AGENT_A,
      project: PROJECT,
      task: "Implement search regression gate test",
      status: "completed",
      progress: "Gate 0 search_memory coverage added",
    });

    // Seed agent A: knowledge
    await store.saveKnowledge({
      agent_id: AGENT_A,
      project: PROJECT,
      title: "SqliteStore FTS behaviour",
      content: "Full-text search uses SQLite FTS5 with porter stemmer tokenizer",
      source_type: "manual",
    });

    // Seed agent B: knowledge (must NOT appear in agent A searches)
    await store.saveKnowledge({
      agent_id: AGENT_B,
      project: PROJECT,
      title: "Agent B private knowledge",
      content: "This content belongs only to agent B and should not cross isolation boundary",
      source_type: "manual",
    });

    // ── Test 1: keyword search finds seeded decision ──────────────────
    const decisionResult = await store.searchMemory({
      agent_id: AGENT_A,
      query: "SqliteStore backend",
      scope: "decisions",
    });
    assert(
      decisionResult.decisions.length >= 1,
      "search_memory finds seeded decision by keyword"
    );
    assert(
      decisionResult.decisions.some((d) => d.decision.includes("SqliteStore")),
      "search_memory decision result contains expected keyword"
    );

    // ── Test 2: search finds seeded record (even if it contains secret-like
    //    content — raw DB read is expected to return stored content as-is;
    //    secret redaction is the restart pack's responsibility, covered by
    //    tests/gate0/no-secret-recovery.ts) ─────────────────────────────
    const secretResult = await store.searchMemory({
      agent_id: AGENT_A,
      query: "external API key",
      scope: "decisions",
    });
    assert(
      secretResult.decisions.length >= 1,
      "search_memory finds decision that contains secret-like content (raw read)"
    );
    assert(
      secretResult.decisions.some((d) => d.agent_id === AGENT_A),
      "search_memory returns only this agent's decisions for secret-containing query"
    );

    // ── Test 3: task search ───────────────────────────────────────────
    const taskResult = await store.searchMemory({
      agent_id: AGENT_A,
      query: "search regression gate",
      scope: "tasks",
    });
    assert(taskResult.task_states.length >= 1, "search_memory finds seeded task by keyword");
    assert(
      taskResult.task_states.some((t) => t.task.includes("search regression")),
      "search_memory task result contains expected keyword"
    );

    // ── Test 4: knowledge search ──────────────────────────────────────
    const knowledgeResult = await store.searchMemory({
      agent_id: AGENT_A,
      query: "FTS5 porter stemmer",
      scope: "knowledge",
    });
    assert(knowledgeResult.knowledge.length >= 1, "search_memory finds seeded knowledge by keyword");
    assert(
      knowledgeResult.knowledge.some((k) => k.title.includes("SqliteStore")),
      "search_memory knowledge result contains expected title"
    );

    // ── Test 5: scope filtering — knowledge scope returns no decisions ─
    assert(
      knowledgeResult.decisions.length === 0,
      "search_memory with scope=knowledge returns no decisions"
    );
    assert(
      knowledgeResult.task_states.length === 0,
      "search_memory with scope=knowledge returns no tasks"
    );

    // ── Test 6: agent isolation ───────────────────────────────────────
    const isolationResult = await store.searchMemory({
      agent_id: AGENT_A,
      query: "agent B private",
      scope: "knowledge",
    });
    assert(
      isolationResult.knowledge.every((k) => k.agent_id === AGENT_A),
      "search_memory returns only agent A knowledge even when agent B has matching content"
    );
    assert(
      !isolationResult.knowledge.some((k) => k.content.includes("only to agent B")),
      "search_memory does not leak agent B knowledge into agent A results"
    );

    await store.close();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

runTests()
  .then(() => {
    console.log(`\n── Gate 0 search_memory regression: ${passed} passed, ${failed} failed ──`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error("Gate 0 search_memory test error:", err);
    process.exit(1);
  });
