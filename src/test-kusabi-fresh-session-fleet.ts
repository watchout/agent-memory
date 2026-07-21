import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  CODEX_FRESH_PROMPT_DELIVERY_MODE,
  buildCodexFreshLaunchArgs,
} from "./codex-start.js";
import {
  buildClaudeLaunchArgs,
  buildClaudeSelectedPackPrepareOutput,
  buildClaudeSessionStartSettings,
  parseClaudeStartArgs,
  prepareClaudeResession,
} from "./claude-start.js";
import type { Store } from "./stores/types.js";
import {
  FRESH_SESSION_FLEET_TARGETS,
  FRESH_SESSION_TIMEOUT_MS,
  FRESH_SESSION_ZERO_EFFECTS,
  buildContinuationInstruction,
  parseContinuationReceipt,
  parseHostSessionId,
  preflightFreshSessionFleet,
  receiptWorkspaceMatches,
  runFreshSessionFleet,
  verifyIndependentAuditGate,
  type FleetRuntimeProfile,
  type FreshSessionLaunchReceipt,
  type FreshSessionLaunchSpec,
  type IndependentAuditGate,
} from "./kusabi-fresh-session-fleet.js";

const EXACT_HEAD = "a".repeat(40);
const auditGate: IndependentAuditGate = {
  schema_version: "kusabi-fresh-session-independent-audit/v1",
  verdict: "PASS",
  exact_head_sha: EXACT_HEAD,
  auditor: "devauditor",
  independent: true,
  durable_url: "https://github.com/watchout/agent-memory/pull/999#issuecomment-1",
};

function exactProfiles(): FleetRuntimeProfile[] {
  return FRESH_SESSION_FLEET_TARGETS.map((target) => ({
    agent_id: target.agent_id,
    home_directory: target.workspace,
    runtime_engine_preference: target.runtime,
    profile_enabled: true,
    profile_revision: target.profile_revision,
  }));
}

function exactSpecs(): FreshSessionLaunchSpec[] {
  return FRESH_SESSION_FLEET_TARGETS.map((target) => ({
    agent_id: target.agent_id,
    prior_session_id: `prior-${target.agent_id}`,
    selected_pack_ref: `selected_restart_pack:${target.ordinal}-${target.agent_id}`,
    expected_objective: `objective:${target.agent_id}:continue exactly`,
    expected_next_action: `next:${target.agent_id}:start without restatement`,
  }));
}

const preflight = preflightFreshSessionFleet({ profiles: exactProfiles(), verifyAdapterFiles: false });
assert.equal(preflight.status, "ready");
assert.equal(preflight.target_count, 12);
assert.equal(preflight.exact_membership, true);
assert.equal(preflight.sequential_only, true);
assert.equal(preflight.timeout_ms, 60_000);
assert.deepEqual(preflight.effects, FRESH_SESSION_ZERO_EFFECTS);
assert.equal(
  receiptWorkspaceMatches("~/Developer/agent-memory", "/Users/yuji/Developer/agent-memory", "/Users/yuji"),
  true,
);
assert.equal(
  receiptWorkspaceMatches("~/Developer/other", "/Users/yuji/Developer/agent-memory", "/Users/yuji"),
  false,
);
assert.equal(
  receiptWorkspaceMatches("~/Developer/other/../agent-memory", "/Users/yuji/Developer/agent-memory", "/Users/yuji"),
  false,
);

const staleBinding = preflightFreshSessionFleet({
  profiles: exactProfiles(),
  declaredRuntimeBindings: { devauditor: "claude-code" },
  verifyAdapterFiles: false,
});
assert.equal(staleBinding.status, "stopped");
assert(staleBinding.errors.includes("FAIL_STALE_RUNTIME_BINDING:devauditor"));

const missingProfile = exactProfiles().slice(1);
assert.equal(preflightFreshSessionFleet({ profiles: missingProfile, verifyAdapterFiles: false }).status, "stopped");

const disabledProfile = exactProfiles();
disabledProfile[0].profile_enabled = false;
assert(preflightFreshSessionFleet({ profiles: disabledProfile, verifyAdapterFiles: false }).errors.includes("FAIL_PROFILE_DISABLED:kusabi"));
assert.deepEqual(verifyIndependentAuditGate(auditGate, EXACT_HEAD), []);
assert(verifyIndependentAuditGate({ ...auditGate, auditor: "arc" as "devauditor" }, EXACT_HEAD).includes("FAIL_AUDITOR_NOT_INDEPENDENT"));
assert(verifyIndependentAuditGate({ ...auditGate, exact_head_sha: "b".repeat(40) }, EXACT_HEAD).includes("FAIL_AUDIT_EXACT_HEAD"));

let preLaunchCount = 0;
const auditStopped = await runFreshSessionFleet(
  {
    profiles: exactProfiles(),
    launchSpecs: exactSpecs(),
    auditGate: { ...auditGate, exact_head_sha: "b".repeat(40) },
    exactHeadSha: EXACT_HEAD,
    verifyAdapterFiles: false,
  },
  async () => { preLaunchCount += 1; throw new Error("must not launch"); },
);
assert.equal(auditStopped.status, "stopped");
assert.equal(preLaunchCount, 0);
const invalidSpecs = exactSpecs();
invalidSpecs[0].selected_pack_ref = "";
const specStopped = await runFreshSessionFleet(
  {
    profiles: exactProfiles(), launchSpecs: invalidSpecs, auditGate,
    exactHeadSha: EXACT_HEAD, verifyAdapterFiles: false,
  },
  async () => { preLaunchCount += 1; throw new Error("must not launch"); },
);
assert.equal(specStopped.status, "stopped");
assert(specStopped.errors.includes("FAIL_SELECTED_PACK_REF:kusabi"));
assert.equal(preLaunchCount, 0);

// Claude fresh sessions use a native SessionStart hook. No existing TUI is addressed.
const settings = buildClaudeSessionStartSettings("/repo/dist/boot.js");
const settingsText = JSON.stringify(settings);
assert(settingsText.includes("SessionStart"));
assert(settingsText.includes("node \\\"/repo/dist/boot.js\\\""));
assert(!/tmux|send-keys|pbcopy|clipboard/i.test(settingsText));
const claudeArgs = buildClaudeLaunchArgs({
  freshSession: true,
  bootJs: "/repo/dist/boot.js",
  sessionId: "018f6f7d-93b6-7ba0-a4e1-baf17d7eb471",
  claudeArgs: ["-p", "continue"],
});
assert.deepEqual(claudeArgs.slice(0, 2), ["--settings", settingsText]);
assert(claudeArgs.includes("--session-id"));
const parsedClaude = parseClaudeStartArgs([
  "--fresh-session", "--selected-pack-ref", "selected_restart_pack:exact",
]);
assert.equal(parsedClaude.freshSession, true);
assert.equal(parsedClaude.selectedPackRef, "selected_restart_pack:exact");
const selectedPack = {
  id: "pack-id",
  agent_id: "spec",
  project: "spec",
  pack_ref: "selected_restart_pack:exact",
  content: "exact objective and next action",
  content_hash: "a".repeat(64),
  status: "active",
  source: "manual",
  metadata: { pack_format: "host-invocation-context-v1" },
  created_at: "2026-07-21T00:00:00.000Z",
} as const;
const selectedPrepare = buildClaudeSelectedPackPrepareOutput(selectedPack);
assert.equal(selectedPrepare.pack_ref, "selected_restart_pack:exact");
assert.equal(selectedPrepare.restart_pack_format, "host-invocation-context-v1");
assert.equal(selectedPrepare.restart_pack_schema_ref, "host-invocation-context/v1");
assert.equal(selectedPrepare.can_auto_restart, false);
const selectedRunner = await prepareClaudeResession({
  getSelectedRestartPack: async () => selectedPack,
} as unknown as Store, {
  agentId: "spec",
  project: "spec",
  launch: true,
  freshSession: true,
  selectedPackRef: selectedPack.pack_ref,
});
assert.equal(selectedRunner.prepare.pack_ref, selectedPack.pack_ref);
assert.deepEqual(selectedRunner.launch_blockers, []);
assert.equal(selectedRunner.next_session_env.AGENT_MEMORY_CLAUDE_HOOK_JSON, "1");
const bootSource = readFileSync("src/boot.ts", "utf8");
assert(bootSource.includes('process.env.AGENT_MEMORY_CLAUDE_HOOK_JSON === "1"'));
assert(bootSource.includes('hookEventName: "SessionStart"'));
assert(bootSource.includes("additionalContext: output"));

// Codex fresh sessions receive recovery through stdin, never as prompt/pack argv.
assert.equal(CODEX_FRESH_PROMPT_DELIVERY_MODE, "stdin");
const codexArgs = buildCodexFreshLaunchArgs(
  {
    cd: "/workspace",
    codexGlobalArgs: ["--ask-for-approval", "never"],
    codexArgs: ["--sandbox", "read-only"],
  },
  ["-c", "mcp_servers.wasurezu.command=\\\"node\\\""],
);
assert.deepEqual(codexArgs.slice(-8), ["-C", "/workspace", "exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-"]);
assert.equal(codexArgs.at(-1), "-");
assert(codexArgs.indexOf("--ask-for-approval") < codexArgs.indexOf("exec"));
assert(codexArgs.indexOf("--sandbox") > codexArgs.indexOf("exec"));
assert(!codexArgs.some((arg) => arg.includes("objective:")));

const launchOrder: string[] = [];
let active = 0;
let observedMaxConcurrency = 0;
const specs = exactSpecs();
const evidence = await runFreshSessionFleet(
  { profiles: exactProfiles(), launchSpecs: specs, auditGate, exactHeadSha: EXACT_HEAD, verifyAdapterFiles: false },
  async (target, spec, context): Promise<FreshSessionLaunchReceipt> => {
    active += 1;
    observedMaxConcurrency = Math.max(observedMaxConcurrency, active);
    launchOrder.push(target.agent_id);
    await Promise.resolve();
    active -= 1;
    return {
      agent_id: target.agent_id,
      memory_project: target.memory_project,
      workspace: target.workspace,
      runtime: target.runtime,
      fresh_session_id: context.fresh_session_id,
      recovered_objective: spec.expected_objective,
      recovered_next_action: spec.expected_next_action,
      continuation_started: true,
      user_context_restatement_count: 0,
      effects: { ...FRESH_SESSION_ZERO_EFFECTS },
    };
  },
);
assert.equal(evidence.status, "pass");
assert.equal(evidence.attempted_count, 12);
assert.equal(evidence.pass_count, 12);
assert.equal(evidence.fail_count, 0);
assert.equal(evidence.max_concurrency, 1);
assert.equal(observedMaxConcurrency, 1);
assert.deepEqual(launchOrder, FRESH_SESSION_FLEET_TARGETS.map((target) => target.agent_id));
assert.equal(evidence.completion_rate, 1);
assert.equal(evidence.exact_identity_rate, 1);
assert.equal(evidence.exact_recovery_rate, 1);
assert.equal(evidence.continuation_started_rate, 1);
assert.deepEqual(evidence.effects, FRESH_SESSION_ZERO_EFFECTS);
assert.equal(evidence.next_action, "none");
for (const target of evidence.targets) {
  assert.notEqual(target.fresh_session_id, target.prior_session_id);
  assert(target.elapsed_ms <= FRESH_SESSION_TIMEOUT_MS);
  assert.equal(target.exact_objective_match, true);
  assert.equal(target.exact_next_action_match, true);
  assert.equal(target.continuation_started, true);
  assert.equal(target.user_context_restatement_count, 0);
}

const evidenceSchema = JSON.parse(readFileSync(
  "docs/design/schemas/kusabi-fresh-session-evidence-v1.schema.json",
  "utf8",
));
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validateEvidence = ajv.compile(evidenceSchema);
assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors));
const invalidConcurrency = structuredClone(evidence);
invalidConcurrency.max_concurrency = 2;
assert.equal(validateEvidence(invalidConcurrency), false);
const missingEffect = structuredClone(evidence);
delete (missingEffect.effects as unknown as Record<string, number>).tui_write_count;
assert.equal(validateEvidence(missingEffect), false);

// A timeout aborts the current fresh process and no later target is started.
let timeoutLaunchCount = 0;
const timedOut = await runFreshSessionFleet(
  { profiles: exactProfiles(), launchSpecs: exactSpecs(), auditGate, exactHeadSha: EXACT_HEAD, verifyAdapterFiles: false },
  async (_target, _spec, context) => {
    timeoutLaunchCount += 1;
    return new Promise<FreshSessionLaunchReceipt>((_resolve, reject) => {
      context.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  },
  { timeoutMsForTest: 2 },
);
assert.equal(timedOut.status, "failed");
assert.equal(timeoutLaunchCount, 1);
assert.equal(timedOut.attempted_count, 1);
assert(timedOut.errors.some((error) => error.includes("FAIL_60_SECOND_TIMEOUT")));
assert.equal(timedOut.next_action, "stop_on_first_failure");

// Identity drift and any forbidden effect fail-stop before the second target.
for (const mutate of [
  (receipt: FreshSessionLaunchReceipt) => { receipt.agent_id = "wrong-agent"; },
  (receipt: FreshSessionLaunchReceipt) => { receipt.effects.tui_write_count = 1; },
  (receipt: FreshSessionLaunchReceipt) => { receipt.user_context_restatement_count = 1; },
  (receipt: FreshSessionLaunchReceipt) => { receipt.recovered_next_action = "wrong-next"; },
]) {
  let count = 0;
  const failed = await runFreshSessionFleet(
    { profiles: exactProfiles(), launchSpecs: exactSpecs(), auditGate, exactHeadSha: EXACT_HEAD, verifyAdapterFiles: false },
    async (target, spec, context) => {
      count += 1;
      const receipt: FreshSessionLaunchReceipt = {
        agent_id: target.agent_id,
        memory_project: target.memory_project,
        workspace: target.workspace,
        runtime: target.runtime,
        fresh_session_id: context.fresh_session_id,
        recovered_objective: spec.expected_objective,
        recovered_next_action: spec.expected_next_action,
        continuation_started: true,
        user_context_restatement_count: 0,
        effects: { ...FRESH_SESSION_ZERO_EFFECTS },
      };
      mutate(receipt);
      return receipt;
    },
  );
  assert.equal(failed.status, "failed");
  assert.equal(count, 1);
  assert.equal(failed.attempted_count, 1);
}

const first = FRESH_SESSION_FLEET_TARGETS[0];
const instruction = buildContinuationInstruction(first, "fresh-id");
assert(instruction.includes("Do not ask the user to restate anything"));
assert(instruction.includes("host-invocation-context/v1"));
assert(instruction.includes("authoritative bounded canary checkpoint"));
assert(instruction.includes("copy only the exact saved values in that trusted_instruction verbatim"));
assert(instruction.includes("ignore other startup or workspace context for those two fields"));
assert(instruction.includes("Inspecting that injected checkpoint is the first safe read-only continuation step"));
assert(instruction.includes("without invoking tools or waiting for more input"));
assert(!instruction.includes(specs[0].expected_objective));
assert(!instruction.includes(specs[0].expected_next_action));

const nestedReceipt: FreshSessionLaunchReceipt = {
  agent_id: first.agent_id,
  memory_project: first.memory_project,
  workspace: first.workspace,
  runtime: first.runtime,
  fresh_session_id: "fresh-id",
  recovered_objective: "objective",
  recovered_next_action: "next",
  continuation_started: true,
  user_context_restatement_count: 0,
  effects: { ...FRESH_SESSION_ZERO_EFFECTS },
};
const hostOutput = JSON.stringify({ type: "result", result: `KUSABI_CONTINUATION:${JSON.stringify(nestedReceipt)}` });
assert.deepEqual(parseContinuationReceipt(hostOutput), nestedReceipt);
assert.equal(
  parseHostSessionId('{"type":"thread.started","thread_id":"019f8153-1a1a-7e61-ad9c-f83c0e786a06"}', "codex"),
  "019f8153-1a1a-7e61-ad9c-f83c0e786a06",
);
assert.equal(
  parseHostSessionId('{"type":"result","session_id":"1bd525b4-2145-4386-b431-fcc7d2749dad"}', "claude-code"),
  "1bd525b4-2145-4386-b431-fcc7d2749dad",
);
assert.throws(
  () => parseHostSessionId('{"type":"thread.started","thread_id":"not-a-uuid"}', "codex"),
  /FAIL_HOST_SESSION_ID_MISSING_OR_MALFORMED/,
);

console.log("kusabi fresh-session fleet tests passed");
