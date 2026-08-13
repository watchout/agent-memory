import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  CODEX_SESSION_START_ADAPTER_ID,
  CODEX_SESSION_START_MAX_BYTES,
  CODEX_SESSION_START_MAX_TOKENS,
  enforceCodexRecoveryCaps,
  parseCodexSessionStartArgs,
  recoveryFromPack,
  resolveCodexStoreBinding,
  kusabiStoreBindingSha256,
  runCodexSessionStart,
  type CodexSessionStartBinding,
  type CodexSessionStartInput,
  type LoadedCodexRecovery,
  type RecoveryOutputWithMetrics,
} from "./codex-session-start.js";
import { buildRecoveryPackArtifact, buildRestartPack, type RestartPackData } from "./restart-pack.js";

function hookInput(cwd: string, source: CodexSessionStartInput["source"] = "startup"): string {
  return JSON.stringify({
    session_id: `session-${source}`,
    transcript_path: null,
    cwd,
    hook_event_name: "SessionStart",
    model: "gpt-5.6-codex",
    permission_mode: "default",
    source,
  });
}

function binding(workspace: string, overrides: Partial<CodexSessionStartBinding> = {}): CodexSessionStartBinding {
  return {
    agent_id: "kusabi",
    project: "agent-memory",
    workspace,
    binding_source_ref: "fixture:verified-kusabi-binding",
    max_tokens: CODEX_SESSION_START_MAX_TOKENS,
    max_bytes: CODEX_SESSION_START_MAX_BYTES,
    timeout_ms: 500,
    ...overrides,
  };
}

function recovery(text = "Recovered objective and exact next action."): RecoveryOutputWithMetrics {
  return {
    text,
    token_cap: CODEX_SESSION_START_MAX_TOKENS,
    token_estimate: Math.ceil(text.length / 4),
    byte_count: Buffer.byteLength(text, "utf8"),
    redaction_count: 0,
    redaction_version: "am031-redaction-v1",
    truncation_count: 0,
    omitted_section_count: 0,
  };
}

function loaded(text?: string): LoadedCodexRecovery {
  return {
    recovery: recovery(text),
    recovery_pack: {
      pack_ref: "restart_pack:kusabi:agent-memory:fixture",
      schema_ref: "wasurezu-recovery-pack/v1",
      token_budget: 1650,
      confidence: "high",
      missing_context: [],
      source_refs: ["task_state:fixture"],
      policy_version: "wasurezu-memory-safety-governance/0.1.0",
    },
    recovery_quality_log_ref: "recovery_quality_log:123e4567-e89b-42d3-a456-426614174000",
    store_binding: {
      source: "user_config",
      backend_intent: "postgres",
      config_path_sha256: "a".repeat(64),
      binding_sha256: "b".repeat(64),
      verified: true,
      credentials_embedded: false,
    },
  };
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "wasurezu-codex-session-start-"));
  try {
    const evidenceSchema = JSON.parse(await readFile(
      "docs/design/schemas/codex-session-start-evidence-v1.schema.json",
      "utf8",
    ));
    const validateEvidence = new Ajv2020({ strict: false, validateFormats: false }).compile(evidenceSchema);
    const workspace = join(root, "workspace");
    const child = join(workspace, "packages", "app");
    const outside = join(root, "outside");
    await mkdir(child, { recursive: true });
    await mkdir(outside, { recursive: true });

    const configDir = join(root, "store-config");
    const configPath = join(configDir, "config.json");
    const syntheticDatabaseUrl = "postgresql:///fixture?host=/tmp";
    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, JSON.stringify({
      database_url: syntheticDatabaseUrl,
      agent_id: "must-not-override-hook-binding",
      default_project: "must-not-override-hook-binding",
    }));

    const userConfigEnv: NodeJS.ProcessEnv = {};
    const userConfigBinding = resolveCodexStoreBinding(userConfigEnv, configPath);
    assert.equal(userConfigBinding.source, "user_config");
    assert.equal(userConfigBinding.backend_intent, "postgres");
    assert.match(userConfigBinding.config_path_sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(userConfigBinding.binding_sha256, kusabiStoreBindingSha256("postgres", syntheticDatabaseUrl));
    assert.equal(userConfigBinding.credentials_embedded, false);
    assert.equal(userConfigEnv.AGENT_MEMORY_DATABASE_URL, syntheticDatabaseUrl);
    assert(!JSON.stringify(userConfigBinding).includes(syntheticDatabaseUrl));
    assert(!JSON.stringify(userConfigBinding).includes("must-not-override-hook-binding"));

    const explicitEnvironmentBinding = resolveCodexStoreBinding({
      AGENT_MEMORY_DATABASE_URL: syntheticDatabaseUrl,
    }, join(root, "not-read.json"));
    assert.equal(explicitEnvironmentBinding.source, "environment");
    assert.equal(explicitEnvironmentBinding.backend_intent, "postgres");
    assert.equal(explicitEnvironmentBinding.config_path_sha256, null);
    assert.equal(explicitEnvironmentBinding.binding_sha256, userConfigBinding.binding_sha256);
    const distinctEnvironmentBinding = resolveCodexStoreBinding({
      AGENT_MEMORY_DATABASE_URL: "postgresql:///fixture-other?host=/tmp",
    }, join(root, "not-read-either.json"));
    assert.notEqual(distinctEnvironmentBinding.binding_sha256, explicitEnvironmentBinding.binding_sha256);

    const explicitLocalPath = join(root, "explicit-memory.db");
    const explicitLocalEnv: NodeJS.ProcessEnv = {
      AGENT_MEMORY_DB_TYPE: "sqlite",
      AGENT_MEMORY_DB_PATH: explicitLocalPath,
    };
    const explicitLocalBinding = resolveCodexStoreBinding(explicitLocalEnv, configPath);
    assert.equal(explicitLocalBinding.source, "environment");
    assert.equal(explicitLocalBinding.backend_intent, "sqlite");
    assert.equal(explicitLocalBinding.binding_sha256, kusabiStoreBindingSha256("sqlite", explicitLocalPath));
    assert.equal(explicitLocalEnv.AGENT_MEMORY_DATABASE_URL, undefined);

    const absentConfigBinding = resolveCodexStoreBinding({}, join(root, "absent-config.json"));
    assert.equal(absentConfigBinding.source, "local_default");
    assert.equal(absentConfigBinding.backend_intent, "sqlite");
    assert.match(absentConfigBinding.binding_sha256 ?? "", /^[a-f0-9]{64}$/);

    const malformedConfigPath = join(configDir, "malformed.json");
    await writeFile(malformedConfigPath, "not-json");
    assert.throws(() => resolveCodexStoreBinding({}, malformedConfigPath), /RECOVERY_UNAVAILABLE/);

    const invalidUrlConfigPath = join(configDir, "invalid-url.json");
    await writeFile(invalidUrlConfigPath, JSON.stringify({ database_url: "https://not-a-database.invalid" }));
    assert.throws(() => resolveCodexStoreBinding({}, invalidUrlConfigPath), /RECOVERY_UNAVAILABLE/);

    const unreadableConfigPath = join(configDir, "unreadable.json");
    await writeFile(unreadableConfigPath, JSON.stringify({ database_url: syntheticDatabaseUrl }));
    await chmod(unreadableConfigPath, 0o000);
    assert.throws(() => resolveCodexStoreBinding({}, unreadableConfigPath), /RECOVERY_UNAVAILABLE/);
    await chmod(unreadableConfigPath, 0o600);

    const symlinkConfigPath = join(configDir, "symlink.json");
    await symlink(configPath, symlinkConfigPath);
    assert.throws(() => resolveCodexStoreBinding({}, symlinkConfigPath), /RECOVERY_UNAVAILABLE/);
    assert.throws(
      () => resolveCodexStoreBinding({ AGENT_MEMORY_DB_TYPE: "postgres" }, join(root, "absent-postgres.json")),
      /RECOVERY_UNAVAILABLE/,
    );

    for (const source of ["startup", "resume", "clear", "compact"] as const) {
      const result = await runCodexSessionStart(hookInput(child, source), binding(workspace), {
        loadRecovery: async () => loaded(),
        now: (() => {
          const values = [1_000, 1_025];
          return () => values.shift() ?? 1_025;
        })(),
      });
      assert.equal(result.exit_code, 0);
      assert.equal(result.output.continue, true);
      assert.equal(result.output.suppressOutput, false);
      assert.equal(result.output.hookSpecificOutput?.hookEventName, "SessionStart");
      assert(result.output.hookSpecificOutput?.additionalContext.includes("exact next action"));
      assert.equal(result.output.systemMessage, undefined);
      assert.equal(result.evidence.outcome, "full");
      assert.equal(result.evidence.delivery.status, "degraded");
      assert.equal(result.evidence.delivery.emission_status, "emitted");
      assert.equal(result.evidence.delivery.first_context_delivery_confirmed, false);
      assert.equal(result.evidence.recovery_pack.pack_ref, "restart_pack:kusabi:agent-memory:fixture");
      assert.equal(result.evidence.recovery_pack.token_budget, 1650);
      assert.equal(result.evidence.trust.configuration_state, "placed_not_delivered");
      assert.equal(result.evidence.adapter.normal_launch_command, "codex");
      assert.equal(result.evidence.hook.source, source);
      assert.equal(result.evidence.identity.verified, true);
      assert.equal(result.evidence.store_binding.source, "user_config");
      assert.equal(result.evidence.store_binding.backend_intent, "postgres");
      assert.equal(result.evidence.store_binding.credentials_embedded, false);
      assert.equal(result.evidence.timing.elapsed_ms, 25);
      assert.equal(result.evidence.ordinary_launch_usable, true);
      assert.deepEqual(Object.values(result.evidence.forbidden_effects), [0, 0, 0, 0, 0, 0, 0]);
      assert(validateEvidence(result.evidence), JSON.stringify(validateEvidence.errors));
    }

    const malformed = await runCodexSessionStart("not-json", binding(workspace));
    assert.equal(malformed.output.continue, true);
    assert.equal(malformed.output.hookSpecificOutput, undefined);
    assert.match(malformed.output.systemMessage ?? "", /MALFORMED_HOOK_INPUT/);
    assert.equal(malformed.evidence.outcome, "degraded");
    assert.equal(malformed.evidence.delivery.status, "degraded");
    assert.equal(malformed.evidence.delivery.emission_status, "not_emitted");
    assert.equal(malformed.evidence.ordinary_launch_usable, true);
    assert(validateEvidence(malformed.evidence), JSON.stringify(validateEvidence.errors));

    const wrongEvent = await runCodexSessionStart(
      JSON.stringify({ ...JSON.parse(hookInput(child)), hook_event_name: "Stop" }),
      binding(workspace),
    );
    assert.match(wrongEvent.output.systemMessage ?? "", /UNSUPPORTED_HOOK_EVENT/);

    const wrongSource = await runCodexSessionStart(
      JSON.stringify({ ...JSON.parse(hookInput(child)), source: "fork" }),
      binding(workspace),
    );
    assert.match(wrongSource.output.systemMessage ?? "", /UNSUPPORTED_START_SOURCE/);

    const unsupportedPermissionMode = await runCodexSessionStart(
      JSON.stringify({ ...JSON.parse(hookInput(child)), permission_mode: "unsupported-mode" }),
      binding(workspace),
    );
    assert.match(unsupportedPermissionMode.output.systemMessage ?? "", /MALFORMED_HOOK_INPUT/);

    const additionalProperty = await runCodexSessionStart(
      JSON.stringify({ ...JSON.parse(hookInput(child)), unexpected: true }),
      binding(workspace),
    );
    assert.match(additionalProperty.output.systemMessage ?? "", /MALFORMED_HOOK_INPUT/);

    for (const requiredField of [
      "cwd",
      "hook_event_name",
      "model",
      "permission_mode",
      "session_id",
      "source",
      "transcript_path",
    ]) {
      const missingRequired = JSON.parse(hookInput(child));
      delete missingRequired[requiredField];
      const missingRequiredResult = await runCodexSessionStart(JSON.stringify(missingRequired), binding(workspace));
      assert.match(missingRequiredResult.output.systemMessage ?? "", /MALFORMED_HOOK_INPUT/);
    }

    const cwdEscape = await runCodexSessionStart(hookInput(outside), binding(workspace));
    assert.match(cwdEscape.output.systemMessage ?? "", /WORKSPACE_IDENTITY_MISMATCH/);
    assert.equal(cwdEscape.evidence.identity.verified, false);

    const invalidIdentity = await runCodexSessionStart(
      hookInput(child),
      binding(workspace, { agent_id: "" }),
    );
    assert.match(invalidIdentity.output.systemMessage ?? "", /IDENTITY_BINDING_INVALID/);

    const missingWorkspace = await runCodexSessionStart(
      hookInput(child),
      binding(join(root, "missing-workspace")),
    );
    assert.match(missingWorkspace.output.systemMessage ?? "", /IDENTITY_BINDING_INVALID/);

    const invalidCap = await runCodexSessionStart(
      hookInput(child),
      binding(workspace, { max_tokens: 99_999 }),
    );
    assert.match(invalidCap.output.systemMessage ?? "", /IDENTITY_BINDING_INVALID/);
    assert(validateEvidence(invalidCap.evidence), JSON.stringify(validateEvidence.errors));

    const unavailable = await runCodexSessionStart(hookInput(child), binding(workspace), {
      loadRecovery: async () => { throw new Error("DATABASE_URL=postgresql://user:secret@example.test/db"); },
    });
    assert.match(unavailable.output.systemMessage ?? "", /RECOVERY_UNAVAILABLE/);
    assert(!JSON.stringify(unavailable).includes("secret@example"));

    const redactedBindingRef = await runCodexSessionStart(
      hookInput(child),
      binding(workspace, { binding_source_ref: "source:sk-abcdefghijklmnopqrstuvwxyz123456" }),
      { loadRecovery: async () => loaded() },
    );
    assert(!redactedBindingRef.evidence.identity.binding_source_ref.includes("sk-abcdefghijklmnopqrstuvwxyz"));

    const timedOut = await runCodexSessionStart(hookInput(child), binding(workspace, { timeout_ms: 100 }), {
      loadRecovery: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return loaded();
      },
    });
    assert.match(timedOut.output.systemMessage ?? "", /RECOVERY_TIMEOUT/);
    assert.equal(timedOut.output.continue, true);

    const missingEvidenceLog = await runCodexSessionStart(hookInput(child), binding(workspace), {
      loadRecovery: async () => ({ ...loaded(), recovery_quality_log_ref: null }),
    });
    assert.equal(missingEvidenceLog.evidence.outcome, "degraded");
    assert.equal(missingEvidenceLog.evidence.degraded_reason, "EVIDENCE_LOG_UNAVAILABLE");
    assert(missingEvidenceLog.output.hookSpecificOutput?.additionalContext.includes("Recovered objective"));
    assert.match(missingEvidenceLog.output.systemMessage ?? "", /cannot count as alpha evidence/);

    const huge = recovery("あ".repeat(20_000));
    const capped = enforceCodexRecoveryCaps(huge, binding(workspace, { max_tokens: 300, max_bytes: 1_024 }));
    assert(capped.token_estimate <= 300);
    assert(capped.byte_count <= 1_024);
    assert(capped.truncation_count >= 1);
    assert.match(capped.text, /cap applied/);

    const secret = "sk-abcdefghijklmnopqrstuvwxyz123456";
    const privateWorkspacePath = join(homedir(), "Developer", "agent-memory");
    const packData: RestartPackData = {
      agentId: "kusabi",
      project: "agent-memory",
      maxTokens: 1_500,
      activeTasks: [{
        id: "task-1",
        agent_id: "kusabi",
        project: "agent-memory",
        task: `Continue ${secret} from ${privateWorkspacePath}`,
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
      pack_id: "restart_pack:kusabi:agent-memory:redaction-fixture",
    });
    const built = recoveryFromPack(buildRestartPack(packData), pack, binding(workspace));
    assert(!built.text.includes(secret));
    assert(!built.text.includes(homedir()));
    assert(built.text.includes("~/Developer/agent-memory"));
    assert(built.redaction_count >= 1);
    assert.equal(typeof built.omitted_section_count, "number");
    assert.equal(typeof built.truncation_count, "number");
    assert(built.text.includes("Pack ref: restart_pack:kusabi:agent-memory:redaction-fixture"));

    const parsed = parseCodexSessionStartArgs([
      "--adapter-id", CODEX_SESSION_START_ADAPTER_ID,
      "--agent-id", "kusabi",
      "--project", "agent-memory",
      "--workspace", workspace,
      "--binding-source-ref", "fixture:binding",
      "--max-tokens", "1200",
      "--max-bytes", "4096",
      "--timeout-ms", "6000",
    ], {});
    assert.equal(parsed.agent_id, "kusabi");
    assert.equal(parsed.max_tokens, 1200);
    assert.equal(parsed.max_bytes, 4096);
    assert.equal(parsed.timeout_ms, 6000);

    console.log("codex native SessionStart adapter tests passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
