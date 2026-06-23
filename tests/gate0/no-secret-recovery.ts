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
import { DEFAULT_RECOVERY_CONFIG, buildRecoveryOutput } from "../../src/constants.js";
import { generateHostInvocationContext, generateRecoveryPackArtifact, generateRestartPack } from "../../src/restart-pack.js";
import { redactText } from "../../src/redact.js";
import { safeText } from "../../src/sanitize.js";
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
const FAKE_BEARER_TOKEN = "Bearer abcdefghijklmnopqrstuvwxyz.0123456789._secret";
const FAKE_DATABASE_URL = "DATABASE_URL=postgres://user:pass@example.test:5432/app";
const FAKE_PHONE = "415-555-0123";
const SAMPLE_DATE = "2026-06-23";

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

    await store.saveTaskState({
      agent_id: AGENT,
      project: PROJECT,
      task: `Rotate deployment token ${FAKE_BEARER_TOKEN}`,
      status: "in_progress",
      progress: `Investigating ${FAKE_DATABASE_URL}`,
      next_steps: `Call ${FAKE_PHONE} only after redaction coverage is verified`,
      files_modified: [join(tmpDir, "secret-output.ts")],
    });

    console.log("\n── Gate 0: no-secret-recovery ──");

    // ── Test 1: redactText removes sk- pattern ──
    const r1 = redactText(FAKE_OPENAI_KEY);
    assert(!r1.text.includes(FAKE_OPENAI_KEY), "redactText removes sk- pattern");
    assert(r1.redaction_count > 0, "redactText reports non-zero redaction_count for sk- pattern");

    // ── Test 2: redactText removes GitHub token ──
    const r2 = redactText(FAKE_GITHUB_TOKEN);
    assert(!r2.text.includes(FAKE_GITHUB_TOKEN), "redactText removes GitHub token");

    // ── Test 3: redactText removes gho_ token ──
    const r3 = redactText(FAKE_GHO_TOKEN);
    assert(!r3.text.includes(FAKE_GHO_TOKEN), "redactText removes gho_ token");

    // ── Test 4: redactText redacts phones without treating ISO dates as phones ──
    const r4 = redactText(`date ${SAMPLE_DATE} phone ${FAKE_PHONE}`);
    assert(r4.text.includes(SAMPLE_DATE), "redactText preserves ISO dates");
    assert(!r4.text.includes(FAKE_PHONE), "redactText removes phone-like PII");

    // ── Test 5: MCP text boundary redacts current output surfaces ──
    const mcpOutput = safeText(`search_memory result ${FAKE_GITHUB_TOKEN} ${SAMPLE_DATE}`);
    assert(!mcpOutput.text.includes(FAKE_GITHUB_TOKEN), "safeText redacts MCP text content");
    assert(mcpOutput.text.includes(SAMPLE_DATE), "safeText preserves ISO dates");

    // ── Test 6: restart pack output does not contain raw sk- key ──
    const pack = await generateRestartPack(store, {
      agent_id: AGENT,
      project: PROJECT,
    });
    assert(!pack.includes(FAKE_OPENAI_KEY), "generateRestartPack output does not contain raw sk- key");

    // ── Test 7: restart pack output does not contain raw GitHub token ──
    assert(!pack.includes(FAKE_GITHUB_TOKEN), "generateRestartPack output does not contain raw GitHub token");

    // ── Test 8: restart pack output does not contain raw gho_ token ──
    assert(!pack.includes(FAKE_GHO_TOKEN), "generateRestartPack output does not contain raw gho_ token");
    assert(!pack.includes(FAKE_BEARER_TOKEN), "generateRestartPack output does not contain raw bearer token");
    assert(!pack.includes(FAKE_DATABASE_URL), "generateRestartPack output does not contain raw database URL");
    assert(!pack.includes(FAKE_PHONE), "generateRestartPack output does not contain raw phone-like PII");

    // ── Test 9: recover_context / boot output builder redacts current surfaces ──
    const [inProgressTasks, completedTasks, decisions, knowledgeItems] = await Promise.all([
      store.getTaskStates({ agent_id: AGENT, project: PROJECT, limit: 1, status: "in_progress" }),
      store.getTaskStates({ agent_id: AGENT, project: PROJECT, limit: 1, status: "completed" }),
      store.getDecisions({ agent_id: AGENT, project: PROJECT, limit: 5, status: "active" }),
      store.getKnowledge({ agent_id: AGENT, project: PROJECT, limit: 5, status: "active" }),
    ]);
    const recoveryOutput = buildRecoveryOutput({
      agentId: AGENT,
      project: PROJECT,
      config: DEFAULT_RECOVERY_CONFIG,
      inProgressTasks,
      completedTasks,
      decisions,
      knowledgeItems,
      messages: [
        {
          id: "msg-1",
          author_id: "user",
          content: `Recent output included ${FAKE_OPENAI_KEY}`,
          source: "manual",
          role: "user",
          project: PROJECT,
          created_at: `${SAMPLE_DATE}T00:00:00.000Z`,
        },
      ],
    });
    assert(!recoveryOutput.includes(FAKE_OPENAI_KEY), "buildRecoveryOutput redacts message content");
    assert(!recoveryOutput.includes(FAKE_BEARER_TOKEN), "buildRecoveryOutput redacts task content");
    assert(!recoveryOutput.includes(FAKE_DATABASE_URL), "buildRecoveryOutput redacts env-style secrets");
    assert(!recoveryOutput.includes(FAKE_PHONE), "buildRecoveryOutput redacts phone-like PII");
    assert(recoveryOutput.includes(SAMPLE_DATE), "buildRecoveryOutput preserves ISO dates");

    // ── Test 10: structured recovery artifacts do not contain raw secrets ──
    const recoveryArtifact = await generateRecoveryPackArtifact(store, {
      agent_id: AGENT,
      project: PROJECT,
    });
    const recoveryJson = JSON.stringify(recoveryArtifact);
    assert(!recoveryJson.includes(FAKE_OPENAI_KEY), "recovery-pack/v1 JSON does not contain raw sk- key");
    assert(!recoveryJson.includes(FAKE_GITHUB_TOKEN), "recovery-pack/v1 JSON does not contain raw GitHub token");
    assert(!recoveryJson.includes(FAKE_BEARER_TOKEN), "recovery-pack/v1 JSON does not contain raw bearer token");
    assert(
      recoveryArtifact.redaction_summary?.mode === "redacted-before-emit",
      "recovery-pack/v1 records redaction summary when secrets are redacted"
    );

    const hostContext = await generateHostInvocationContext(store, {
      agent_id: AGENT,
      project: PROJECT,
      target_runtime: "claude",
    });
    const hostContextJson = JSON.stringify(hostContext);
    assert(!hostContextJson.includes(FAKE_OPENAI_KEY), "host-invocation-context/v1 JSON does not contain raw sk- key");
    assert(!hostContextJson.includes(FAKE_GITHUB_TOKEN), "host-invocation-context/v1 JSON does not contain raw GitHub token");
    assert(!hostContextJson.includes(FAKE_BEARER_TOKEN), "host-invocation-context/v1 JSON does not contain raw bearer token");

    // ── Test 11: redacted output contains placeholder string ──
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
