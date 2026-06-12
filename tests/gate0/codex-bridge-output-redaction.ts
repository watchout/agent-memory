#!/usr/bin/env node
/**
 * Gate 0 test: Codex bridge startup prompt must not leak secrets.
 *
 * buildCodexStartupPrompt already applies redactText at the boundary;
 * this probe pins that contract in CI so a refactor cannot silently
 * drop the seam (incident class: PR#64/#73 silent no-op).
 * Spec: docs/impl/IMPL-2026-06-12-codex-bridge-probe.md
 *
 * Run: HOME=$(mktemp -d) npx tsx tests/gate0/codex-bridge-output-redaction.ts
 */
import { buildCodexStartupPrompt } from "../../src/codex-start.js";
import { redactText } from "../../src/redact.js";

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

const FAKE_SK_KEY = "sk-fakeBridgeLeak0123456789abcdefgh";
const FAKE_AKIA_KEY = "AKIAIOSFODNN7EXAMPLE";
const FAKE_DB_URL = "DATABASE_URL=postgres://svc:hunter2@db.internal:5432/prod";
const FAKE_EMAIL = "bridge.leak@example.com";
const FAKE_GHO_TOKEN = "gho_fakeBridgeLeakABCDEFGHIJKLMNOPQ";

console.log("\n── Gate 0: codex-bridge-output-redaction ──");

// 1. Secrets through both input channels.
const output = buildCodexStartupPrompt({
  agentId: "gate0-bridge",
  project: "gate0",
  restartPack: [
    "SESSION RESTART PACK",
    `objective uses ${FAKE_SK_KEY} and ${FAKE_AKIA_KEY}`,
    `env carries ${FAKE_DB_URL}`,
    `contact ${FAKE_EMAIL}`,
  ].join("\n"),
  extraInstruction: `push with ${FAKE_GHO_TOKEN}`,
});

for (const raw of [FAKE_SK_KEY, FAKE_AKIA_KEY, "hunter2", FAKE_EMAIL, FAKE_GHO_TOKEN]) {
  assert(!output.includes(raw), `raw fixture absent from bridge prompt: ${raw.slice(0, 12)}…`);
}
assert(output.includes("[REDACTED]"), "bridge prompt contains [REDACTED] placeholder");

// 2. Scaffolding intact (vacuous-pass guard half 1).
assert(output.includes("Embedded restart_pack:"), "embedded restart_pack section present");
assert(output.includes("agent_id=gate0-bridge"), "agent namespace line present");
assert(output.includes("SESSION RESTART PACK"), "benign pack content preserved");
assert(output.includes("Do not expose secrets"), "secrecy instruction line present");

// 3. Fixpoint idempotence.
assert(
  redactText(output).text === output,
  "re-applied redactText leaves bridge prompt unchanged (fixpoint)"
);

// 4. No-secret case renders identical scaffolding (vacuous-pass guard half 2).
const clean = buildCodexStartupPrompt({
  agentId: "gate0-bridge",
  restartPack: "SESSION RESTART PACK\nclean objective, nothing secret",
});
assert(clean.includes("Embedded restart_pack:"), "clean prompt renders scaffolding");
assert(clean.includes("clean objective, nothing secret"), "clean pack content preserved verbatim");

console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
