#!/usr/bin/env node
/**
 * Gate 0 test: search_memory formatted output must not leak secrets.
 *
 * Structured memory (decisions/knowledge/task states) is not redacted
 * at ingest, so the output boundary (formatSearchMemoryOutput) must
 * redact. Spec: docs/impl/IMPL-2026-06-12-search-output-redaction.md
 *
 * Run: HOME=$(mktemp -d) npx tsx tests/gate0/search-output-redaction.ts
 */
import { SqliteStore } from "../../src/stores/sqlite-store.js";
import { formatSearchMemoryOutput } from "../../src/format-search.js";
import { redactText } from "../../src/redact.js";
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

const AGENT = "gate0-search-redaction";
const PROJECT = "gate0";
const FAKE_SK_KEY = "sk-fakeSearchLeak0123456789abcdefgh";
const FAKE_GHO_TOKEN = "gho_fakeSearchLeakABCDEFGHIJKLMNOPQ";
const FAKE_EMAIL = "leaky.user@example.com";
const FAKE_AKIA_KEY = "AKIAIOSFODNN7EXAMPLE";
const FAKE_DB_URL = "DATABASE_URL=postgres://svc:hunter2@db.internal:5432/prod";

async function runTests(): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), "gate0-search-"));
  const dbPath = join(tmpDir, "test.db");

  try {
    const store = new SqliteStore(dbPath);
    await store.initialize();

    await store.logDecision({
      agent_id: AGENT,
      project: PROJECT,
      decision: `Adopt probeword vendor API with key ${FAKE_SK_KEY} for enrichment`,
      context: `Rotated after incident; old key was ${FAKE_SK_KEY}`,
      tags: ["vendor"],
    });

    await store.saveKnowledge({
      agent_id: AGENT,
      project: PROJECT,
      title: "probeword CI access note",
      content: `CI bot uses ${FAKE_GHO_TOKEN}; alerts go to ${FAKE_EMAIL}`,
      source_type: "manual",
      tags: ["ci"],
    });

    await store.saveTaskState({
      agent_id: AGENT,
      project: PROJECT,
      task: "probeword deploy task",
      status: "in_progress",
      progress: `Deploying with ${FAKE_AKIA_KEY} and ${FAKE_DB_URL}`,
    });

    console.log("\n── Gate 0: search-output-redaction ──");

    const result = await store.searchMemory({
      agent_id: AGENT,
      project: PROJECT,
      query: "probeword",
      scope: "all",
    });
    const totalHits =
      result.decisions.length + result.knowledge.length + result.task_states.length;
    assert(totalHits >= 3, "seeded records are all found by search");

    const output = formatSearchMemoryOutput("probeword", result);

    // 1. No raw fixture values survive.
    assert(!output.includes(FAKE_SK_KEY), "sk- key absent from search output");
    assert(!output.includes(FAKE_GHO_TOKEN), "gho_ token absent from search output");
    assert(!output.includes(FAKE_EMAIL), "email absent from search output");
    assert(!output.includes(FAKE_AKIA_KEY), "AKIA key absent from search output");
    assert(!output.includes("hunter2"), "DB password absent from search output");

    // 2. Placeholders present.
    assert(output.includes("[REDACTED]"), "output contains [REDACTED] placeholder");
    assert(output.includes("[REDACTED_EMAIL]"), "output contains [REDACTED_EMAIL] placeholder");

    // 3. Benign text and structure preserved.
    assert(output.includes("probeword CI access note"), "benign knowledge title preserved");
    assert(output.includes("── KNOWLEDGE ──"), "knowledge section header intact");
    assert(output.includes("── DECISIONS ──"), "decisions section header intact");
    assert(output.includes("── TASK STATES ──"), "task states section header intact");

    // 4. Idempotence: output is a redaction fixpoint — re-applying changes
    // nothing. (Count-based idempotence is impossible: placeholders like
    // DATABASE_URL=[REDACTED] re-match with identical replacement.)
    assert(
      redactText(output).text === output,
      "re-applied redactText leaves output unchanged (fixpoint)"
    );

    // 5. No-results path.
    const empty = await store.searchMemory({
      agent_id: AGENT,
      project: PROJECT,
      query: "zzz-no-such-term-zzz",
      scope: "all",
    });
    const emptyOutput = formatSearchMemoryOutput("zzz-no-such-term-zzz", empty);
    assert(emptyOutput.includes("no results"), "no-results path renders cleanly");
    assert(emptyOutput.includes("zzz-no-such-term-zzz"), "no-results path echoes the query");

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
