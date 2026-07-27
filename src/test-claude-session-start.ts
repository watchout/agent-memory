import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  CLAUDE_SESSION_START_ADAPTER_ID,
  CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS,
  CLAUDE_SESSION_START_MAX_BYTES,
  CLAUDE_SESSION_START_MAX_TOKENS,
  parseClaudeSessionStartArgs,
  parseClaudeSessionStartInput,
  runClaudeSessionStart,
  type ClaudeSessionStartBinding,
  type ClaudeSessionStartInput,
} from "./claude-session-start.js";
import { buildClaudeSessionStartSettings } from "./claude-start.js";
import type { LoadedCodexRecovery, RecoveryOutputWithMetrics } from "./codex-session-start.js";

function hookInput(
  cwd: string,
  source: ClaudeSessionStartInput["source"] = "startup",
  permissionMode?: ClaudeSessionStartInput["permission_mode"],
): string {
  return JSON.stringify({
    session_id: `session-${source}`,
    transcript_path: `/tmp/session-${source}.jsonl`,
    cwd,
    hook_event_name: "SessionStart",
    model: "claude-sonnet-4-6",
    source,
    ...(permissionMode === undefined ? {} : { permission_mode: permissionMode }),
  });
}

function binding(workspace: string, overrides: Partial<ClaudeSessionStartBinding> = {}): ClaudeSessionStartBinding {
  return {
    agent_id: "spec",
    project: "agent-memory",
    workspace,
    binding_source_ref: "fixture:verified-spec-binding",
    max_tokens: CLAUDE_SESSION_START_MAX_TOKENS,
    max_bytes: CLAUDE_SESSION_START_MAX_BYTES,
    timeout_ms: 500,
    ...overrides,
  };
}

function recovery(text = "Recovered objective, exact blocker, and next safe action."): RecoveryOutputWithMetrics {
  return {
    text,
    token_cap: CLAUDE_SESSION_START_MAX_TOKENS,
    token_estimate: Math.ceil(text.length / 4),
    byte_count: Buffer.byteLength(text, "utf8"),
    redaction_count: 2,
    redaction_version: "am031-redaction-v1",
    truncation_count: 0,
    omitted_section_count: 1,
  };
}

function loaded(text?: string): LoadedCodexRecovery {
  return {
    recovery: recovery(text),
    recovery_pack: {
      pack_ref: "restart_pack:spec:agent-memory:fixture",
      schema_ref: "wasurezu-recovery-pack/v1",
      token_budget: 1_650,
      confidence: "high",
      missing_context: [],
      source_refs: ["task_state:fixture"],
      policy_version: "wasurezu-memory-safety-governance/0.1.0",
    },
    recovery_quality_log_ref: "recovery_quality_log:123e4567-e89b-42d3-a456-426614174000",
  };
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "wasurezu-claude-session-start-"));
  try {
    const schema = JSON.parse(await readFile(
      "docs/design/schemas/claude-session-start-evidence-v1.schema.json",
      "utf8",
    ));
    const validateEvidence = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
    const workspace = join(root, "workspace");
    const child = join(workspace, "packages", "app");
    const outside = join(root, "outside");
    await mkdir(child, { recursive: true });
    await mkdir(outside, { recursive: true });

    for (const source of ["startup", "resume", "clear", "compact"] as const) {
      const result = await runClaudeSessionStart(hookInput(child, source), binding(workspace), {
        loadRecovery: async () => loaded(),
        now: (() => {
          const values = [1_000, 1_024];
          return () => values.shift() ?? 1_024;
        })(),
      });
      assert.equal(result.exit_code, 0);
      assert.equal(result.output.continue, true);
      assert.equal(result.output.suppressOutput, false);
      assert(result.output.hookSpecificOutput?.additionalContext.includes("next safe action"));
      assert.equal(result.evidence.schema_version, "claude-session-start-evidence/v1");
      assert.equal(result.evidence.adapter.id, CLAUDE_SESSION_START_ADAPTER_ID);
      assert.equal(result.evidence.adapter.normal_launch_command, "claude");
      assert.equal(result.evidence.adapter.canonical_config_location, ".claude/settings.json");
      assert.equal(result.evidence.identity.runtime, "claude-code");
      assert.equal(result.evidence.identity.verified, true);
      assert.equal(result.evidence.hook.source, source);
      assert.equal(result.evidence.hook.permission_mode, null);
      assert.equal(result.evidence.hook.strict_json_stdout, true);
      assert.equal(result.evidence.timing.elapsed_ms, 24);
      assert.equal(result.evidence.timing.hook_timeout_seconds, 9);
      assert.equal(result.evidence.output.redaction_count, 2);
      assert.equal(result.evidence.output.omitted_section_count, 1);
      assert.equal(result.evidence.delivery.first_context_delivery_confirmed, false);
      assert.equal(result.evidence.trust.changed_hook_requires_operator_review, true);
      assert.equal(result.evidence.ordinary_launch_usable, true);
      assert.deepEqual(Object.values(result.evidence.forbidden_effects), [0, 0, 0, 0, 0, 0, 0]);
      assert(validateEvidence(result.evidence), JSON.stringify(validateEvidence.errors));
    }

    const autoInput = JSON.stringify({
      ...JSON.parse(hookInput(child)),
      permission_mode: "auto",
      agent_type: "continuity-canary",
    });
    const parsedAuto = parseClaudeSessionStartInput(autoInput);
    assert.equal(parsedAuto.permission_mode, "auto");
    assert.equal(parsedAuto.agent_type, "continuity-canary");
    const auto = await runClaudeSessionStart(autoInput, binding(workspace), { loadRecovery: async () => loaded() });
    assert.equal(auto.evidence.hook.permission_mode, "auto");
    assert.equal(auto.evidence.hook.agent_type, "continuity-canary");

    const defaultModeInput = hookInput(child, "startup", "default");
    const parsedDefaultMode = parseClaudeSessionStartInput(defaultModeInput);
    assert.equal(parsedDefaultMode.permission_mode, "default");
    const defaultMode = await runClaudeSessionStart(defaultModeInput, binding(workspace), {
      loadRecovery: async () => loaded(),
    });
    assert.equal(defaultMode.evidence.hook.permission_mode, "default");

    const invalidPermissionMode = await runClaudeSessionStart(
      JSON.stringify({ ...JSON.parse(hookInput(child)), permission_mode: "allowEverything" }),
      binding(workspace),
    );
    assert.match(invalidPermissionMode.output.systemMessage ?? "", /MALFORMED_HOOK_INPUT/);

    const malformed = await runClaudeSessionStart("not-json", binding(workspace));
    assert.match(malformed.output.systemMessage ?? "", /MALFORMED_HOOK_INPUT/);
    assert.equal(malformed.output.continue, true);
    assert.equal(malformed.output.hookSpecificOutput, undefined);
    assert(validateEvidence(malformed.evidence), JSON.stringify(validateEvidence.errors));

    const wrongEvent = await runClaudeSessionStart(
      JSON.stringify({ ...JSON.parse(hookInput(child)), hook_event_name: "Stop" }),
      binding(workspace),
    );
    assert.match(wrongEvent.output.systemMessage ?? "", /UNSUPPORTED_HOOK_EVENT/);

    const wrongSource = await runClaudeSessionStart(
      JSON.stringify({ ...JSON.parse(hookInput(child)), source: "unknown" }),
      binding(workspace),
    );
    assert.match(wrongSource.output.systemMessage ?? "", /UNSUPPORTED_START_SOURCE/);

    const additionalProperty = await runClaudeSessionStart(
      JSON.stringify({ ...JSON.parse(hookInput(child)), unexpected: true }),
      binding(workspace),
    );
    assert.match(additionalProperty.output.systemMessage ?? "", /MALFORMED_HOOK_INPUT/);

    for (const field of ["cwd", "hook_event_name", "model", "session_id", "source", "transcript_path"]) {
      const input = JSON.parse(hookInput(child));
      delete input[field];
      const result = await runClaudeSessionStart(JSON.stringify(input), binding(workspace));
      assert.match(result.output.systemMessage ?? "", /MALFORMED_HOOK_INPUT/);
    }

    const oversized = await runClaudeSessionStart(" ".repeat(65_537), binding(workspace));
    assert.match(oversized.output.systemMessage ?? "", /MALFORMED_HOOK_INPUT/);

    const cwdEscape = await runClaudeSessionStart(hookInput(outside), binding(workspace));
    assert.match(cwdEscape.output.systemMessage ?? "", /WORKSPACE_IDENTITY_MISMATCH/);
    assert.equal(cwdEscape.evidence.identity.verified, false);

    const invalidIdentity = await runClaudeSessionStart(hookInput(child), binding(workspace, { agent_id: "" }));
    assert.match(invalidIdentity.output.systemMessage ?? "", /IDENTITY_BINDING_INVALID/);

    const unavailable = await runClaudeSessionStart(hookInput(child), binding(workspace), {
      loadRecovery: async () => { throw new Error("DATABASE_URL=postgresql://user:secret@example.test/db"); },
    });
    assert.match(unavailable.output.systemMessage ?? "", /RECOVERY_UNAVAILABLE/);
    assert(!JSON.stringify(unavailable).includes("secret@example"));

    const timedOut = await runClaudeSessionStart(hookInput(child), binding(workspace, { timeout_ms: 100 }), {
      loadRecovery: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return loaded();
      },
    });
    assert.match(timedOut.output.systemMessage ?? "", /RECOVERY_TIMEOUT/);
    assert.equal(timedOut.output.continue, true);

    const missingEvidence = await runClaudeSessionStart(hookInput(child), binding(workspace), {
      loadRecovery: async () => ({ ...loaded(), recovery_quality_log_ref: null }),
    });
    assert.equal(missingEvidence.evidence.outcome, "degraded");
    assert.equal(missingEvidence.evidence.degraded_reason, "EVIDENCE_LOG_UNAVAILABLE");
    assert(missingEvidence.output.hookSpecificOutput?.additionalContext.includes("Recovered objective"));
    assert.match(missingEvidence.output.systemMessage ?? "", /cannot count as alpha evidence/);

    const hugeText = "あ".repeat(20_000);
    const capped = await runClaudeSessionStart(hookInput(child), binding(workspace, {
      max_tokens: 500,
      max_bytes: 1_024,
    }), { loadRecovery: async () => loaded(hugeText) });
    assert((capped.output.hookSpecificOutput?.additionalContext.length ?? 0) < hugeText.length);
    assert(capped.evidence.output.token_estimate <= 500);
    assert(capped.evidence.output.byte_count <= 1_024);
    assert(capped.evidence.output.truncation_count >= 1);

    const parsedArgs = parseClaudeSessionStartArgs([
      "--adapter-id", CLAUDE_SESSION_START_ADAPTER_ID,
      "--agent-id", "spec",
      "--project", "agent-memory",
      "--workspace", workspace,
      "--binding-source-ref", "fixture:binding",
      "--max-tokens", "1200",
      "--max-bytes", "4096",
      "--timeout-ms", "6000",
    ], {});
    assert.equal(parsedArgs.agent_id, "spec");
    assert.equal(parsedArgs.max_tokens, 1200);

    const settings = buildClaudeSessionStartSettings("/tmp/wasurezu/dist/boot.js") as {
      hooks: { SessionStart: Array<{ hooks: Array<{ timeout: number }> }> };
    };
    assert.equal(settings.hooks.SessionStart[0].hooks[0].timeout, CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS);

    const realCli = spawnSync(process.execPath, [
      "--import", "tsx",
      "src/claude-session-start.ts",
      "--adapter-id", CLAUDE_SESSION_START_ADAPTER_ID,
      "--agent-id", "spec",
      "--project", "agent-memory",
      "--workspace", workspace,
      "--binding-source-ref", "fixture:real-cli",
    ], {
      input: hookInput(child),
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_MEMORY_DB_TYPE: "sqlite",
        AGENT_MEMORY_DB_PATH: join(root, "real-cli.db"),
      },
    });
    assert.equal(realCli.status, 0, realCli.stderr);
    assert.equal(realCli.stdout.trim().split("\n").length, 1);
    const realCliOutput = JSON.parse(realCli.stdout);
    assert(realCliOutput.hookSpecificOutput.additionalContext.includes("WASUREZU NATIVE STARTUP RECOVERY"));
    const realEvidenceLines = realCli.stderr.trim().split("\n").filter((line) => line.startsWith("{"));
    assert.equal(realEvidenceLines.length, 1);
    const realEvidence = JSON.parse(realEvidenceLines[0]);
    assert.equal(realEvidence.outcome, "full");
    assert.equal(realEvidence.identity.verified, true);
    assert(validateEvidence(realEvidence), JSON.stringify(validateEvidence.errors));

    const cli = spawnSync(process.execPath, [
      "--import", "tsx",
      "src/claude-session-start.ts",
      "--adapter-id", CLAUDE_SESSION_START_ADAPTER_ID,
      "--agent-id", "spec",
      "--project", "agent-memory",
      "--workspace", workspace,
      "--binding-source-ref", "fixture:cli",
    ], { input: "not-json", encoding: "utf8" });
    assert.equal(cli.status, 0);
    assert.equal(cli.stdout.trim().split("\n").length, 1);
    assert.equal(JSON.parse(cli.stdout).continue, true);
    const evidenceLines = cli.stderr.trim().split("\n").filter((line) => line.startsWith("{"));
    assert.equal(evidenceLines.length, 1);
    assert(validateEvidence(JSON.parse(evidenceLines[0])), JSON.stringify(validateEvidence.errors));

    console.log("Claude SessionStart tests passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
