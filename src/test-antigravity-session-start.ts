import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import {
  ANTIGRAVITY_MAX_BYTES,
  ANTIGRAVITY_MAX_TOKENS,
  parseAntigravityHookInput,
  runAntigravityHook,
  type AntigravitySessionStartBinding,
  type LoadedAntigravityHookData,
} from "./antigravity-session-start.js";
import type { RecoveryOutputWithMetrics } from "./codex-session-start.js";

const CONVERSATION_ID = "123e4567-e89b-42d3-a456-426614174000";

function binding(workspace: string): AntigravitySessionStartBinding {
  return {
    agent_id: "kusabi", project: "agent-memory", workspace,
    binding_source_ref: "fixture:antigravity", max_tokens: ANTIGRAVITY_MAX_TOKENS,
    max_bytes: ANTIGRAVITY_MAX_BYTES, timeout_ms: 500,
  };
}

function input(workspace: string, transcript: string, invocationNum = 0): string {
  return JSON.stringify({
    conversationId: CONVERSATION_ID, workspacePaths: [workspace], transcriptPath: transcript,
    artifactDirectoryPath: join(workspace, "artifacts"), modelName: "auto", invocationNum, initialNumSteps: 0,
  });
}

function recovery(): RecoveryOutputWithMetrics {
  const text = "Recovered Antigravity objective and next action.";
  return {
    text, token_cap: ANTIGRAVITY_MAX_TOKENS, token_estimate: Math.ceil(text.length / 4),
    byte_count: Buffer.byteLength(text), redaction_count: 0, redaction_version: "am031-redaction-v1",
    truncation_count: 0, omitted_section_count: 0,
  };
}

function loaded(includeRecovery: boolean): LoadedAntigravityHookData {
  return {
    auto_receive: { status: "captured", reason: "captured", events_saved: 2, events_duplicate: 0 },
    ...(includeRecovery ? {
      recovery: recovery(),
      recovery_pack: {
        pack_ref: "restart_pack:fixture", schema_ref: "wasurezu-recovery-pack/v1", token_budget: 1_650,
        confidence: "high" as const, missing_context: [], source_refs: ["task:fixture"], policy_version: "fixture/v1",
      },
      recovery_quality_log_ref: "recovery_quality_log:123e4567-e89b-42d3-a456-426614174000",
    } : { recovery_quality_log_ref: null }),
    store_binding: {
      source: "user_config", backend_intent: "postgres", config_path_sha256: "a".repeat(64),
      binding_sha256: "b".repeat(64), verified: true, credentials_embedded: false,
    },
  };
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "antigravity-adapter-"));
  try {
    const schema = JSON.parse(await readFile("docs/design/schemas/antigravity-session-start-evidence-v1.schema.json", "utf8"));
    const validateEvidence = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    await Promise.all([mkdir(workspace), mkdir(outside)]);
    const transcript = join(root, "transcript.jsonl");
    await writeFile(transcript, "{}\n");

    const parsedWithoutModel = parseAntigravityHookInput(JSON.stringify({
      conversationId: CONVERSATION_ID, workspacePaths: [workspace], transcriptPath: transcript,
      artifactDirectoryPath: join(workspace, "artifacts"), invocationNum: 0, initialNumSteps: 0,
    }), "pre-invocation");
    assert.equal(parsedWithoutModel.modelName, undefined);
    const futureInput = parseAntigravityHookInput(JSON.stringify({
      ...JSON.parse(input(workspace, transcript)), futureHarmlessField: { private: "ignored" },
    }), "pre-invocation");
    assert.equal(futureInput.conversationId, CONVERSATION_ID);
    assert(!JSON.stringify(futureInput).includes("futureHarmlessField"));

    for (const invalidConversationId of [".", "..", "not-a-uuid", "a/b", "a\\b"]) {
      assert.throws(() => parseAntigravityHookInput(JSON.stringify({
        ...JSON.parse(input(workspace, transcript)), conversationId: invalidConversationId,
      }), "pre-invocation"), undefined, `reject conversationId ${invalidConversationId}`);
    }
    for (const invalidTranscriptPath of [
      "relative/transcript.jsonl",
      "~/.gemini/antigravity-cli/brain/transcript.jsonl",
      `${root}/./transcript.jsonl`,
      `${root}/nested/../transcript.jsonl`,
      `${transcript}\0suffix`,
    ]) {
      assert.throws(() => parseAntigravityHookInput(JSON.stringify({
        ...JSON.parse(input(workspace, transcript)), transcriptPath: invalidTranscriptPath,
      }), "pre-invocation"), undefined, `reject transcriptPath ${JSON.stringify(invalidTranscriptPath)}`);
    }
    assert.throws(() => parseAntigravityHookInput(JSON.stringify({
      ...JSON.parse(input(workspace, transcript)), workspacePaths: ["relative-workspace"],
    }), "pre-invocation"), undefined, "reject relative workspacePaths entry");
    assert.throws(() => parseAntigravityHookInput(JSON.stringify({
      ...JSON.parse(input(workspace, transcript)), artifactDirectoryPath: `${workspace}/artifacts/../artifacts`,
    }), "pre-invocation"), undefined, "reject non-canonical artifactDirectoryPath");

    const first = await runAntigravityHook(input(workspace, transcript), binding(workspace), "pre-invocation", {
      load: async (_binding, hookInput, event) => {
        assert.equal(hookInput.conversationId, CONVERSATION_ID);
        assert.equal(event, "pre-invocation");
        return loaded(true);
      },
    });
    assert.deepEqual(first.output, { injectSteps: [{ ephemeralMessage: recovery().text }] });
    assert.equal(first.evidence.identity.runtime, "antigravity-cli");
    assert.equal(first.evidence.hook.invocation_num, 0);
    assert.equal(first.evidence.output.injection_count, 1);
    assert.equal(first.evidence.outcome, "full");
    assert(validateEvidence(first.evidence), JSON.stringify(validateEvidence.errors));
    const unexpectedStoreField = structuredClone(first.evidence) as typeof first.evidence & {
      store_binding: typeof first.evidence.store_binding & { unexpected: boolean };
    };
    unexpectedStoreField.store_binding.unexpected = true;
    assert.equal(validateEvidence(unexpectedStoreField), false, "closed evidence rejects unknown store binding fields");

    const later = await runAntigravityHook(input(workspace, transcript, 1), binding(workspace), "pre-invocation", {
      load: async () => loaded(false),
    });
    assert.deepEqual(later.output, { injectSteps: [] });
    assert.equal(later.evidence.outcome, "full");
    assert.equal(later.evidence.output.injection_count, 0);

    const post = await runAntigravityHook(JSON.stringify({
      ...JSON.parse(input(workspace, transcript, 1)), modelOutput: "must-not-be-persisted", modelThinking: "private",
    }), binding(workspace), "post-invocation", { load: async () => loaded(false) });
    assert.deepEqual(post.output, { injectSteps: [] });
    assert.equal(post.evidence.hook.event, "post-invocation");
    assert(validateEvidence(post.evidence), JSON.stringify(validateEvidence.errors));
    assert(!JSON.stringify(post.evidence).includes("must-not-be-persisted"));
    assert(!JSON.stringify(post.evidence).includes("private"));

    const malformed = await runAntigravityHook("not-json", binding(workspace), "pre-invocation");
    assert.deepEqual(malformed.output, { injectSteps: [] });
    assert.equal(malformed.evidence.degraded_reason, "MALFORMED_HOOK_INPUT");
    assert(validateEvidence(malformed.evidence), JSON.stringify(validateEvidence.errors));

    const mismatch = await runAntigravityHook(input(outside, transcript), binding(workspace), "pre-invocation");
    assert.equal(mismatch.evidence.degraded_reason, "WORKSPACE_IDENTITY_MISMATCH");
    assert.equal(mismatch.evidence.identity.verified, false);

    const addedDir = JSON.stringify({ ...JSON.parse(input(workspace, transcript)), workspacePaths: [workspace, outside] });
    const withAddedDir = await runAntigravityHook(addedDir, binding(workspace), "pre-invocation", { load: async () => loaded(true) });
    assert.equal(withAddedDir.evidence.outcome, "full");

    console.log("Antigravity Pre/PostInvocation adapter tests passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
