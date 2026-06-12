#!/usr/bin/env node
/**
 * Gate 0 test: structured pack formats (recovery-pack/v1 and
 * host-invocation-context/v1) must not leak secrets.
 *
 * recoveryItem() already redacts each item summary and stamps
 * sensitivity/redaction_state; this probe pins that contract in CI.
 * Spec: docs/impl/IMPL-2026-06-13-json-pack-probe.md
 *
 * Run: HOME=$(mktemp -d) npx tsx tests/gate0/json-pack-output-redaction.ts
 */
import { SqliteStore } from "../../src/stores/sqlite-store.js";
import {
  generateRecoveryPackArtifact,
  generateHostInvocationContext,
} from "../../src/restart-pack.js";
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

const AGENT = "gate0-json-pack";
const PROJECT = "gate0";
const FAKE_SK_KEY = "sk-fakeJsonPackLeak0123456789abcdef";
const FAKE_AKIA_KEY = "AKIAIOSFODNN7EXAMPLE";
const FAKE_GHO_TOKEN = "gho_fakeJsonPackLeakABCDEFGHIJKLMNO";
const FAKE_EMAIL = "json.pack@example.com";
const RAW_FIXTURES = [FAKE_SK_KEY, FAKE_AKIA_KEY, FAKE_GHO_TOKEN, FAKE_EMAIL];

async function runTests(): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), "gate0-jsonpack-"));
  try {
    const store = new SqliteStore(join(tmpDir, "test.db"));
    await store.initialize();

    await store.logDecision({
      agent_id: AGENT,
      project: PROJECT,
      decision: `probeword vendor key is ${FAKE_SK_KEY}`,
      context: `mail ${FAKE_EMAIL}`,
      tags: ["vendor"],
    });
    await store.saveKnowledge({
      agent_id: AGENT,
      project: PROJECT,
      title: `probeword infra note ${FAKE_AKIA_KEY}`,
      content: `CI bot uses ${FAKE_GHO_TOKEN}`,
      source_type: "manual",
      tags: ["ci"],
    });
    await store.saveTaskState({
      agent_id: AGENT,
      project: PROJECT,
      task: "probeword deploy task",
      status: "in_progress",
      progress: `deploying with ${FAKE_AKIA_KEY}`,
    });

    console.log("\n── Gate 0: json-pack-output-redaction ──");

    // 1. recovery-pack/v1
    const pack = await generateRecoveryPackArtifact(store, {
      agent_id: AGENT,
      project: PROJECT,
    });
    const packJson = JSON.stringify(pack);
    for (const raw of RAW_FIXTURES) {
      assert(!packJson.includes(raw), `recovery-pack/v1 has no raw fixture: ${raw.slice(0, 12)}…`);
    }
    assert(packJson.includes("[REDACTED]"), "recovery-pack/v1 carries [REDACTED] placeholder");
    assert(
      pack.items.some(
        (i) => i.sensitivity === "secret_redacted" && i.redaction_state === "redacted-before-emit"
      ),
      "secret-bearing item stamped secret_redacted / redacted-before-emit"
    );
    assert(pack.items.length > 0, "recovery-pack/v1 renders items (vacuous-pass guard)");

    // 2. host-invocation-context/v1
    const ctx = await generateHostInvocationContext(store, {
      agent_id: AGENT,
      project: PROJECT,
      target_runtime: "claude",
    });
    const ctxJson = JSON.stringify(ctx);
    for (const raw of RAW_FIXTURES) {
      assert(!ctxJson.includes(raw), `host-invocation-context/v1 has no raw fixture: ${raw.slice(0, 12)}…`);
    }
    assert(ctx.context_data.pack_id === ctx.pack_id, "context embeds the same recovery pack");

    // 3. Clean store still generates a valid artifact.
    const cleanStore = new SqliteStore(join(tmpDir, "clean.db"));
    await cleanStore.initialize();
    const cleanPack = await generateRecoveryPackArtifact(cleanStore, {
      agent_id: AGENT,
      project: PROJECT,
    });
    assert(
      Array.isArray(cleanPack.missing_context) && cleanPack.missing_context.length > 0,
      "clean-store pack reports missing_context (generation alive)"
    );
    await cleanStore.close?.();
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
