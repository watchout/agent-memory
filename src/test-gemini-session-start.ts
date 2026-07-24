import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  GEMINI_SESSION_START_ADAPTER_ID,
  GEMINI_SESSION_START_HOOK_TIMEOUT_MS,
  GEMINI_SESSION_START_MAX_BYTES,
  GEMINI_SESSION_START_MAX_TOKENS,
  parseGeminiSessionStartArgs,
  runGeminiSessionStart,
  type GeminiSessionStartBinding,
  type GeminiSessionStartInput,
  type LoadedGeminiRecovery,
} from "./gemini-session-start.js";
import {
  enforceCodexRecoveryCaps,
  recoveryFromPack,
  type RecoveryOutputWithMetrics,
} from "./codex-session-start.js";
import { buildRecoveryPackArtifact, buildRestartPack, type RestartPackData } from "./restart-pack.js";

function hookInput(cwd: string, source: GeminiSessionStartInput["source"] = "startup"): string {
  return JSON.stringify({
    session_id: `session-${source}`,
    transcript_path: `/tmp/session-${source}.json`,
    cwd,
    hook_event_name: "SessionStart",
    timestamp: "2026-07-24T00:00:00.000Z",
    source,
  });
}

function binding(workspace: string, overrides: Partial<GeminiSessionStartBinding> = {}): GeminiSessionStartBinding {
  return {
    agent_id: "kusabi-gemini",
    project: "agent-memory",
    workspace,
    binding_source_ref: "fixture:verified-kusabi-gemini-binding",
    max_tokens: GEMINI_SESSION_START_MAX_TOKENS,
    max_bytes: GEMINI_SESSION_START_MAX_BYTES,
    timeout_ms: 500,
    ...overrides,
  };
}

function recovery(text = "Recovered objective and exact next action."): RecoveryOutputWithMetrics {
  return {
    text,
    token_cap: GEMINI_SESSION_START_MAX_TOKENS,
    token_estimate: Math.ceil(text.length / 4),
    byte_count: Buffer.byteLength(text, "utf8"),
    redaction_count: 0,
    redaction_version: "am031-redaction-v1",
    truncation_count: 0,
    omitted_section_count: 0,
  };
}

function loaded(text?: string): LoadedGeminiRecovery {
  return {
    recovery: recovery(text),
    recovery_pack: {
      pack_ref: "restart_pack:kusabi-gemini:agent-memory:fixture",
      schema_ref: "wasurezu-recovery-pack/v1",
      token_budget: 1650,
      confidence: "high",
      missing_context: [],
      source_refs: ["task_state:fixture"],
      policy_version: "wasurezu-memory-safety-governance/0.1.0",
    },
    recovery_quality_log_ref: "recovery_quality_log:123e4567-e89b-42d3-a456-426614174000",
  };
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "wasurezu-gemini-session-start-"));
  try {
    const schema = JSON.parse(await readFile(
      "docs/design/schemas/gemini-session-start-evidence-v1.schema.json",
      "utf8",
    ));
    const validateEvidence = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
    const workspace = join(root, "workspace");
    const child = join(workspace, "packages", "app");
    const outside = join(root, "outside");
    await mkdir(child, { recursive: true });
    await mkdir(outside, { recursive: true });

    for (const source of ["startup", "resume", "clear"] as const) {
      const result = await runGeminiSessionStart(hookInput(child, source), binding(workspace), {
        loadRecovery: async () => loaded(),
        now: (() => {
          const values = [1_000, 1_025];
          return () => values.shift() ?? 1_025;
        })(),
      });
      assert.equal(result.exit_code, 0);
      assert.equal(result.output.continue, true);
      assert.equal(result.output.suppressOutput, false);
      assert(result.output.hookSpecificOutput?.additionalContext.includes("exact next action"));
      assert.equal(result.output.systemMessage, undefined);
      assert.equal(result.evidence.outcome, "full");
      assert.equal(result.evidence.adapter.normal_launch_command, "gemini");
      assert.equal(result.evidence.adapter.host_contract_version, "0.38.2");
      assert.equal(result.evidence.hook.source, source);
      assert.equal(result.evidence.hook.strict_json_stdout, true);
      assert.equal(result.evidence.identity.runtime, "gemini-cli");
      assert.equal(result.evidence.identity.verified, true);
      assert.equal(result.evidence.timing.elapsed_ms, 25);
      assert.equal(result.evidence.timing.hook_timeout_ms, GEMINI_SESSION_START_HOOK_TIMEOUT_MS);
      assert.equal(result.evidence.delivery.status, "degraded");
      assert.equal(result.evidence.delivery.emission_status, "emitted");
      assert.equal(result.evidence.delivery.first_context_delivery_confirmed, false);
      assert.equal(result.evidence.trust.configuration_state, "placed_not_delivered");
      assert.equal(result.evidence.trust.changed_hook_requires_operator_review, true);
      assert.equal(result.evidence.ordinary_launch_usable, true);
      assert.deepEqual(Object.values(result.evidence.forbidden_effects), [0, 0, 0, 0, 0, 0, 0]);
      assert(validateEvidence(result.evidence), JSON.stringify(validateEvidence.errors));
    }

    const malformed = await runGeminiSessionStart("not-json", binding(workspace));
    assert.equal(malformed.output.continue, true);
    assert.equal(malformed.output.hookSpecificOutput, undefined);
    assert.match(malformed.output.systemMessage ?? "", /MALFORMED_HOOK_INPUT/);
    assert.equal(malformed.evidence.delivery.emission_status, "not_emitted");
    assert(validateEvidence(malformed.evidence), JSON.stringify(validateEvidence.errors));

    const wrongEvent = await runGeminiSessionStart(
      JSON.stringify({ ...JSON.parse(hookInput(child)), hook_event_name: "Stop" }),
      binding(workspace),
    );
    assert.match(wrongEvent.output.systemMessage ?? "", /UNSUPPORTED_HOOK_EVENT/);

    const wrongSource = await runGeminiSessionStart(
      JSON.stringify({ ...JSON.parse(hookInput(child)), source: "compact" }),
      binding(workspace),
    );
    assert.match(wrongSource.output.systemMessage ?? "", /UNSUPPORTED_START_SOURCE/);

    const invalidTimestamp = await runGeminiSessionStart(
      JSON.stringify({ ...JSON.parse(hookInput(child)), timestamp: "invalid" }),
      binding(workspace),
    );
    assert.match(invalidTimestamp.output.systemMessage ?? "", /MALFORMED_HOOK_INPUT/);

    const additionalProperty = await runGeminiSessionStart(
      JSON.stringify({ ...JSON.parse(hookInput(child)), unexpected: true }),
      binding(workspace),
    );
    assert.match(additionalProperty.output.systemMessage ?? "", /MALFORMED_HOOK_INPUT/);

    for (const field of ["cwd", "hook_event_name", "session_id", "source", "timestamp", "transcript_path"]) {
      const input = JSON.parse(hookInput(child));
      delete input[field];
      const result = await runGeminiSessionStart(JSON.stringify(input), binding(workspace));
      assert.match(result.output.systemMessage ?? "", /MALFORMED_HOOK_INPUT/);
    }

    const oversized = await runGeminiSessionStart(" ".repeat(65_537), binding(workspace));
    assert.match(oversized.output.systemMessage ?? "", /MALFORMED_HOOK_INPUT/);

    const cwdEscape = await runGeminiSessionStart(hookInput(outside), binding(workspace));
    assert.match(cwdEscape.output.systemMessage ?? "", /WORKSPACE_IDENTITY_MISMATCH/);
    assert.equal(cwdEscape.evidence.identity.verified, false);

    const invalidIdentity = await runGeminiSessionStart(hookInput(child), binding(workspace, { agent_id: "" }));
    assert.match(invalidIdentity.output.systemMessage ?? "", /IDENTITY_BINDING_INVALID/);

    const missingWorkspace = await runGeminiSessionStart(
      hookInput(child),
      binding(join(root, "missing-workspace")),
    );
    assert.match(missingWorkspace.output.systemMessage ?? "", /IDENTITY_BINDING_INVALID/);

    const unavailable = await runGeminiSessionStart(hookInput(child), binding(workspace), {
      loadRecovery: async () => { throw new Error("DATABASE_URL=postgresql://user:secret@example.test/db"); },
    });
    assert.match(unavailable.output.systemMessage ?? "", /RECOVERY_UNAVAILABLE/);
    assert(!JSON.stringify(unavailable).includes("secret@example"));

    const redactedBindingRef = await runGeminiSessionStart(
      hookInput(child),
      binding(workspace, { binding_source_ref: "source:sk-abcdefghijklmnopqrstuvwxyz123456" }),
      { loadRecovery: async () => loaded() },
    );
    assert(!redactedBindingRef.evidence.identity.binding_source_ref.includes("sk-abcdefghijklmnopqrstuvwxyz"));

    const timedOut = await runGeminiSessionStart(hookInput(child), binding(workspace, { timeout_ms: 100 }), {
      loadRecovery: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return loaded();
      },
    });
    assert.match(timedOut.output.systemMessage ?? "", /RECOVERY_TIMEOUT/);
    assert.equal(timedOut.output.continue, true);

    const missingEvidence = await runGeminiSessionStart(hookInput(child), binding(workspace), {
      loadRecovery: async () => ({ ...loaded(), recovery_quality_log_ref: null }),
    });
    assert.equal(missingEvidence.evidence.outcome, "degraded");
    assert.equal(missingEvidence.evidence.degraded_reason, "EVIDENCE_LOG_UNAVAILABLE");
    assert(missingEvidence.output.hookSpecificOutput?.additionalContext.includes("Recovered objective"));
    assert.match(missingEvidence.output.systemMessage ?? "", /cannot count as alpha evidence/);

    const huge = recovery("あ".repeat(20_000));
    const capped = enforceCodexRecoveryCaps(huge, binding(workspace, { max_tokens: 300, max_bytes: 1_024 }));
    assert(capped.token_estimate <= 300);
    assert(capped.byte_count <= 1_024);
    assert(capped.truncation_count >= 1);

    const secret = "sk-abcdefghijklmnopqrstuvwxyz123456";
    const packData: RestartPackData = {
      agentId: "kusabi-gemini",
      project: "agent-memory",
      maxTokens: 1_500,
      activeTasks: [{
        id: "task-1",
        agent_id: "kusabi-gemini",
        project: "agent-memory",
        task: `Continue ${secret} from /Users/yuji/Developer/agent-memory`,
        status: "in_progress",
        progress: "ready",
        next_steps: "run the native hook test",
        files_modified: [],
        created_at: "2026-07-24T00:00:00.000Z",
        updated_at: "2026-07-24T00:00:00.000Z",
      }],
      blockedTasks: [],
      completedTasks: [],
      decisions: [],
      knowledge: [],
      conversationEvents: [],
    };
    const pack = buildRecoveryPackArtifact(packData, {
      generated_at: "2026-07-24T00:00:00.000Z",
      pack_id: "restart_pack:kusabi-gemini:agent-memory:redaction-fixture",
    });
    const built = recoveryFromPack(buildRestartPack(packData), pack, binding(workspace));
    assert(!built.text.includes(secret));
    assert(!built.text.includes("/Users/yuji"));
    assert(built.text.includes("~/Developer/agent-memory"));
    assert(built.redaction_count >= 1);

    const parsed = parseGeminiSessionStartArgs([
      "--adapter-id", GEMINI_SESSION_START_ADAPTER_ID,
      "--agent-id", "kusabi-gemini",
      "--project", "agent-memory",
      "--workspace", workspace,
      "--binding-source-ref", "fixture:binding",
      "--max-tokens", "1200",
      "--max-bytes", "4096",
      "--timeout-ms", "6000",
    ], {});
    assert.equal(parsed.agent_id, "kusabi-gemini");
    assert.equal(parsed.max_tokens, 1200);

    const cli = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "gemini-session-start.js"),
      "--adapter-id", GEMINI_SESSION_START_ADAPTER_ID,
      "--agent-id", "kusabi-gemini",
      "--project", "agent-memory",
      "--workspace", workspace,
      "--binding-source-ref", "fixture:binding",
    ], { input: "not-json", encoding: "utf8" });
    assert.equal(cli.status, 0);
    const stdoutLines = cli.stdout.trim().split("\n");
    const stderrLines = cli.stderr.trim().split("\n");
    assert.equal(stdoutLines.length, 1);
    assert.equal(stderrLines.length, 1);
    assert.match(JSON.parse(stdoutLines[0]).systemMessage, /MALFORMED_HOOK_INPUT/);
    assert.equal(JSON.parse(stderrLines[0]).hook.strict_json_stdout, true);

    console.log("gemini native SessionStart adapter tests passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
