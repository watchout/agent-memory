#!/usr/bin/env node
/**
 * Gate 0 test: recovery pack output must not leak secrets.
 *
 * Seeds a temporary SqliteStore with decisions/knowledge that contain
 * fake secret strings, generates a restart pack, and asserts that the
 * output contains no raw secret values — only redaction placeholders.
 *
 * Run: HOME=$(mktemp -d) npx tsx tests/gate0/no-secret-recovery.ts
 */
import { SqliteStore } from "../../src/stores/sqlite-store.js";
import { generateRestartPack } from "../../src/restart-pack.js";
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

const AGENT = "gate0-secret-test";
const PROJECT = "gate0";
const FAKE_OPENAI_KEY = "sk-ant-fake123abcDEFGHIJKLMNOPQRSTUV";
const FAKE_GITHUB_TOKEN = "github_pat_faketoken123ABCDEFGHIJKLMNOPQRfake";
const FAKE_GHO_TOKEN = "gho_fakeGHOtokenABCDEFGHIJKLMNOPQ";

async function runTests(): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), "gate0-secret-"));
  const dbPath = join(tmpDir, "test.db");

  try {
    const store = new SqliteStore(dbPath);
    await store.initialize();

    // Seed a decision containing a fake OpenAI/Anthropic-style API key
    await store.logDecision({
      agent_id: AGENT,
      project: PROJECT,
      decision: `Use external LLM service with key=${FAKE_OPENAI_KEY} for summarisation`,
      context: "Evaluated cost vs quality tradeoff",
      tags: ["llm"],
    });

    // Seed knowledge containing a fake GitHub token
    await store.saveKnowledge({
      agent_id: AGENT,
      project: PROJECT,
      title: "CI deploy token",
      content: `The CI pipeline uses token ${FAKE_GITHUB_TOKEN} to push images`,
      source_type: "manual",
      tags: ["ci"],
    });

    // Seed knowledge containing a GitHub OAuth token
    await store.saveKnowledge({
      agent_id: AGENT,
      project: PROJECT,
      title: "OAuth token note",
      content: `OAuth flow returns ${FAKE_GHO_TOKEN} on success`,
      source_type: "manual",
      tags: ["auth"],
    });

    console.log("\n── Gate 0: no-secret-recovery ──");

    // ── Test 1: redactText removes sk- pattern ──
    const r1 = redactText(FAKE_OPENAI_KEY);
    assert(!r1.text.includes(FAKE_OPENAI_KEY), "redactText removes sk- pattern");
    assert(r1.redaction_count > 0, "redactText reports non-zero redaction_count for sk- pattern");

    // ── Test 2: redactText removes ghp_ token ──
    const r2 = redactText(FAKE_GITHUB_TOKEN);
    assert(!r2.text.includes(FAKE_GITHUB_TOKEN), "redactText removes ghp_ token");

    // ── Test 3: redactText removes gho_ token ──
    const r3 = redactText(FAKE_GHO_TOKEN);
    assert(!r3.text.includes(FAKE_GHO_TOKEN), "redactText removes gho_ token");

    // ── Test 4: restart pack output does not contain raw sk- key ──
    const pack = await generateRestartPack(store, {
      agent_id: AGENT,
      project: PROJECT,
    });
    assert(!pack.includes(FAKE_OPENAI_KEY), "generateRestartPack output does not contain raw sk- key");

    // ── Test 5: restart pack output does not contain raw ghp_ token ──
    assert(!pack.includes(FAKE_GITHUB_TOKEN), "generateRestartPack output does not contain raw ghp_ token");

    // ── Test 6: restart pack output does not contain raw gho_ token ──
    assert(!pack.includes(FAKE_GHO_TOKEN), "generateRestartPack output does not contain raw gho_ token");

    // ── Test 7: redacted output contains placeholder string ──
    const redacted = redactText(`API key: ${FAKE_OPENAI_KEY}`);
    assert(
      redacted.text.includes("[REDACTED]"),
      "redactText output contains [REDACTED] placeholder"
    );

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
