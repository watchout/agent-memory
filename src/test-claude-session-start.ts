import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import Ajv2020 from "ajv/dist/2020.js";
import {
  CLAUDE_SESSION_START_ADAPTER_ID,
  CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS,
  CLAUDE_SESSION_START_HOST_CONTRACT_VERSION,
  CLAUDE_SESSION_START_MAX_BYTES,
  CLAUDE_SESSION_START_MAX_TOKENS,
  CLAUDE_SESSION_START_MODEL_UNSPECIFIED,
  parseClaudeSessionStartArgs,
  parseClaudeSessionStartInput,
  parseClaudeSessionStartInputWithIgnored,
  runClaudeSessionStart,
  runClaudeSessionStartProcess,
  type ClaudeSessionStartBinding,
  type ClaudeSessionStartInput,
  type ClaudeSessionStartProcessIo,
} from "./claude-session-start.js";
import { parseHookInputDiagnostic, type HookDiagnosticRequest } from "./hook-input-diagnostics.js";
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
    agent_id: "kusabi",
    project: "agent-memory",
    workspace,
    binding_source_ref: "fixture:verified-kusabi-claude-binding",
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
      pack_ref: "restart_pack:kusabi:agent-memory:fixture",
      schema_ref: "wasurezu-recovery-pack/v1",
      token_budget: 1_650,
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

const MARK = "SENTINEL_VALUE_NEVER_TO_APPEAR_7f3a";
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

interface ProcessRun {
  log: string[];
  evidence: string[];
  output: string[];
  requests: HookDiagnosticRequest[];
  exits: number;
  exited_at: number;
}

/** Runs the SessionStart process function with every side effect injected; waits until exit is called. */
async function processRun(
  workspace: string,
  raw: string,
  extra: {
    clock?: (answered: boolean) => number;
    run_diagnostic?: (request: HookDiagnosticRequest) => Promise<unknown>;
    write_delay?: number;
    argv_extra?: string[];
  } = {},
): Promise<ProcessRun> {
  const run: ProcessRun = { log: [], evidence: [], output: [], requests: [], exits: 0, exited_at: -1 };
  let answered = 0;
  const start = performance.now();
  const frozen = () => {
    const values = [1_000, 1_024];
    return () => values.shift() ?? 1_024;
  };
  const io: ClaudeSessionStartProcessIo = {
    argv: [
      "--adapter-id", CLAUDE_SESSION_START_ADAPTER_ID,
      "--agent-id", "kusabi",
      "--project", "agent-memory",
      "--workspace", workspace,
      "--binding-source-ref", "fixture:process",
      ...(extra.argv_extra ?? []),
    ],
    env: {},
    read_input: async () => raw,
    write_evidence: (line, done) => {
      run.log.push("evidence");
      run.evidence.push(line);
      setTimeout(() => { run.log.push("evidence_done"); answered++; done(); }, extra.write_delay ?? 0);
    },
    write_output: (line, done) => {
      run.log.push("output");
      run.output.push(line);
      setTimeout(() => { run.log.push("output_done"); answered++; done(); }, extra.write_delay ?? 0);
    },
    exit: () => {
      run.exits++;
      if (run.exited_at < 0) run.exited_at = performance.now() - start;
      run.log.push("exit");
    },
    run_diagnostic: async (request) => {
      run.log.push("diagnostic");
      run.requests.push(request);
      return extra.run_diagnostic?.(request);
    },
    emit_runtime_event: async () => { run.log.push("runtime_event"); },
    clock: () => (extra.clock ? extra.clock(answered >= 2) : performance.now()),
    now: () => new Date("2026-11-11T10:00:00.000Z"),
    pid: 4242,
    dependencies: { loadRecovery: async () => loaded(), now: frozen() },
  };
  await runClaudeSessionStartProcess(io);
  const limit = performance.now() + 2500;
  while (run.exits === 0 && performance.now() < limit) await sleep(5);
  await sleep(60);
  return run;
}

const slowWriter = (ms: number) => () => new Promise<void>((done) => { setTimeout(done, ms).unref(); });

/** FR10: keys the host added (Claude Code 2.1.321) are ignored; every other rule of the entry stays. */
async function hostAddedKeys(context: {
  child: string;
  workspace: string;
  outside: string;
  validateEvidence: { (value: unknown): boolean; errors?: unknown };
  root: string;
}): Promise<void> {
  const { child, workspace, outside, validateEvidence, root } = context;
  const base = JSON.parse(hookInput(child)) as Record<string, unknown>;
  const withoutKey = (key: string) => {
    const copy = { ...base };
    delete copy[key];
    return copy;
  };

  // The sibling parser reports the names and returns what the original returns.
  const live321 = { ...base, session_title: MARK };
  const sibling = parseClaudeSessionStartInputWithIgnored(JSON.stringify(live321));
  assert.deepEqual(sibling.input, parseClaudeSessionStartInput(JSON.stringify(live321)));
  assert.deepEqual(sibling.input, parseClaudeSessionStartInput(JSON.stringify(base)));
  assert.deepEqual([...sibling.ignored_names], ["session_title"]);
  assert.equal(JSON.stringify(sibling).includes(MARK), false, "an ignored value is never carried");
  assert.deepEqual([...parseClaudeSessionStartInputWithIgnored(JSON.stringify(base)).ignored_names], []);

  // F1: the type rules of the three optional keys stay refusals, with and without a host-added key.
  for (const [field, value] of [["model", null], ["permission_mode", "invalid-mode"], ["agent_type", ""]] as const) {
    for (const extra of [{}, { session_title: MARK }]) {
      const input = JSON.stringify({ ...base, [field]: value, ...extra });
      assert.throws(() => parseClaudeSessionStartInput(input), /MALFORMED_HOOK_INPUT/, `${field} ${JSON.stringify(extra)}`);
      assert.throws(() => parseClaudeSessionStartInputWithIgnored(input), /MALFORMED_HOOK_INPUT/);
    }
  }

  // The result for the input with a host-added key equals the result for the same input without it
  // (accepted or refused, the reason, identity). The reasons of the plain inputs are fixed first.
  const loaders = { loadRecovery: async () => loaded() };
  const summary = (result: Awaited<ReturnType<typeof runClaudeSessionStart>>) => JSON.stringify({
    reason: result.evidence.degraded_reason,
    verified: result.evidence.identity.verified,
    outcome: result.evidence.outcome,
    context: result.output.hookSpecificOutput !== undefined,
    message: result.output.systemMessage ?? null,
  });
  const withoutModel = withoutKey("model");
  const cases: Array<[string, Record<string, unknown>, ClaudeSessionStartBinding, string | null]> = [
    ["accepted", base, binding(workspace), null],
    ["required key missing", withoutKey("cwd"), binding(workspace), "MALFORMED_HOOK_INPUT"],
    ["empty session id", { ...base, session_id: "" }, binding(workspace), "MALFORMED_HOOK_INPUT"],
    ["model null", { ...base, model: null }, binding(workspace), "MALFORMED_HOOK_INPUT"],
    ["unknown permission mode", { ...base, permission_mode: "invalid-mode" }, binding(workspace), "MALFORMED_HOOK_INPUT"],
    ["empty agent type", { ...base, agent_type: "" }, binding(workspace), "MALFORMED_HOOK_INPUT"],
    ["wrong event", { ...base, hook_event_name: "Stop" }, binding(workspace), "UNSUPPORTED_HOOK_EVENT"],
    ["unknown source", { ...base, source: "unknown" }, binding(workspace), "UNSUPPORTED_START_SOURCE"],
    ["wrong event, permission mode given (it is passed on as it is)", { ...base, permission_mode: "default", hook_event_name: "Stop" }, binding(workspace), "UNSUPPORTED_HOOK_EVENT"],
    ["unknown source, permission mode given", { ...base, permission_mode: "default", source: "unknown" }, binding(workspace), "UNSUPPORTED_START_SOURCE"],
    ["wrong event, no model (keys do not line up for the Codex parser)", { ...withoutModel, hook_event_name: "Stop" }, binding(workspace), "MALFORMED_HOOK_INPUT"],
    ["unknown source, agent type present", { ...base, source: "unknown", agent_type: "worker" }, binding(workspace), "MALFORMED_HOOK_INPUT"],
    ["binding invalid", base, binding(workspace, { agent_id: "" }), "IDENTITY_BINDING_INVALID"],
    ["cwd outside the workspace", { ...base, cwd: outside }, binding(workspace), "WORKSPACE_IDENTITY_MISMATCH"],
  ];
  for (const [label, input, bound, expected] of cases) {
    const plain = await runClaudeSessionStart(JSON.stringify(input), bound, loaders);
    assert.equal(plain.evidence.degraded_reason, expected, `${label}: the plain input's reason`);
    const marked = await runClaudeSessionStart(
      JSON.stringify({ ...input, session_title: MARK, prompt_id: MARK }),
      bound,
      loaders,
    );
    assert.equal(summary(marked), summary(plain), `${label}: a host-added key must not change the result`);
    assert.equal(JSON.stringify(marked).includes(MARK), false, `${label}: no ignored value in the result`);
    assert(validateEvidence(marked.evidence), JSON.stringify(validateEvidence.errors));
  }

  // The ignored value does not reach the recovery loader or the store binding either.
  const seenByLoader: string[] = [];
  const accepted = await runClaudeSessionStart(JSON.stringify({ ...base, session_title: MARK }), binding(workspace), {
    loadRecovery: async (_binding, input) => { seenByLoader.push(JSON.stringify(input)); return loaded(); },
  });
  assert.equal(accepted.evidence.outcome, "full");
  assert.equal(seenByLoader.join("").includes(MARK), false);
  assert.deepEqual(JSON.parse(seenByLoader[0]), JSON.parse(JSON.stringify(sibling.input)));

  // on_ignored_names: once, right after the Claude parser accepts; never for a refusal nor the proxy route.
  const calls: string[][] = [];
  await runClaudeSessionStart(JSON.stringify({ ...base, session_title: MARK, zeta: 1 }), binding(workspace), {
    ...loaders,
    on_ignored_names: (names) => { calls.push([...names]); },
  });
  assert.deepEqual(calls, [["session_title", "zeta"]]);
  calls.length = 0;
  for (const refused of [
    withoutKey("cwd"), { ...base, model: null }, { ...base, hook_event_name: "Stop" }, { ...base, source: "unknown" },
    { ...withoutModel, hook_event_name: "Stop" },
  ]) {
    await runClaudeSessionStart(JSON.stringify({ ...refused, session_title: MARK }), binding(workspace), {
      ...loaders,
      on_ignored_names: (names) => { calls.push([...names]); },
    });
  }
  assert.deepEqual(calls, [], "no names are reported for an input the Claude parser refused");
  await runClaudeSessionStart(JSON.stringify(base), binding(workspace), {
    ...loaders,
    on_ignored_names: (names) => { calls.push([...names]); },
  });
  assert.deepEqual(calls, [[]], "reported once, with no names, when there is nothing to report");
  // Callers that do not pass it get the same result shape as before.
  const shape = await runClaudeSessionStart(JSON.stringify(base), binding(workspace), loaders);
  assert.deepEqual(Object.keys(shape).sort(), ["evidence", "exit_code", "output"]);

  // The contract-version constant keeps its value and says what it means (H6).
  assert.equal(CLAUDE_SESSION_START_HOST_CONTRACT_VERSION, "2.1.220");
  const source = readFileSync(join(process.cwd(), "src", "claude-session-start.ts"), "utf8");
  const declaration = source.indexOf("export const CLAUDE_SESSION_START_HOST_CONTRACT_VERSION");
  const comment = source.slice(Math.max(0, declaration - 240), declaration);
  assert.match(comment, /verified against/i);
  assert.match(comment, /not the host/i);

  // The process function: order of writes, the bounded wait, and the budget.
  const raw321 = JSON.stringify({ ...base, session_title: MARK });
  const rawPlain = JSON.stringify(base);
  const plainRun = await processRun(workspace, rawPlain);
  assert.equal(plainRun.exits, 1);
  assert.deepEqual(plainRun.requests, [], "nothing to report: no diagnostic is started");
  assert(plainRun.exited_at < 150, `exit at ${plainRun.exited_at} ms`);

  const slow = await processRun(workspace, raw321, { run_diagnostic: slowWriter(3000), write_delay: 60 });
  assert.equal(slow.exits, 1);
  assert.equal(slow.requests.length, 1);
  const request = slow.requests[0];
  assert.equal(request.adapter_id, CLAUDE_SESSION_START_ADAPTER_ID);
  assert.equal(request.event, "SessionStart");
  assert.deepEqual([...request.names], ["session_title"]);
  assert.equal(request.agent_id, "kusabi");
  assert.equal(request.project, "agent-memory");
  assert.equal(request.pid, 4242);
  assert.equal(request.now.toISOString(), "2026-11-11T10:00:00.000Z");
  assert.equal(JSON.stringify(request).includes(MARK), false);
  // The diagnostic starts only after the runtime event, the evidence and the answer are written and flushed.
  const at = (entry: string) => slow.log.indexOf(entry);
  assert(at("runtime_event") >= 0 && at("runtime_event") < at("evidence"));
  assert(at("evidence_done") >= 0 && at("output_done") >= 0);
  assert(at("diagnostic") > at("evidence_done") && at("diagnostic") > at("output_done"), JSON.stringify(slow.log));
  assert(at("exit") > at("diagnostic"));
  assert(slow.exited_at >= 180 + 60 && slow.exited_at < 1000, `slow diagnostic: exit at ${slow.exited_at} ms`);
  // The bytes written are the same with and without the host-added key.
  assert.deepEqual(slow.evidence, plainRun.evidence);
  assert.deepEqual(slow.output, plainRun.output);
  assert(slow.evidence.every((line) => line.endsWith("\n")) && slow.output.every((line) => line.endsWith("\n")));

  const fast = await processRun(workspace, raw321, { run_diagnostic: slowWriter(5) });
  assert(fast.exited_at < 150, `fast diagnostic: exit at ${fast.exited_at} ms`);

  const exhausted = await processRun(workspace, raw321, { clock: (answered) => (answered ? 6_500 : 0) });
  assert.deepEqual(exhausted.requests, [], "less than the floor is left: the diagnostic is not started");
  assert.equal(exhausted.exits, 1);
  assert(exhausted.exited_at < 150, `exhausted: exit at ${exhausted.exited_at} ms`);
  assert.deepEqual(exhausted.evidence, plainRun.evidence);

  const thrown = await processRun(workspace, raw321, { run_diagnostic: () => { throw new Error("writer threw"); } });
  assert.equal(thrown.exits, 1);
  assert.deepEqual(thrown.output, plainRun.output);

  const refused = await processRun(workspace, JSON.stringify({ ...base, model: null, session_title: MARK }));
  assert.deepEqual(refused.requests, [], "a refused input starts no diagnostic");
  assert.equal(refused.exits, 1);
  assert(refused.exited_at < 150);

  // End to end through the real command: the ignored name is recorded, the value is nowhere.
  const home = join(root, "e2e-home");
  const memoryHome = join(root, "e2e-memory");
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(memoryHome, { recursive: true, mode: 0o700 });
  const started = performance.now();
  const e2e = spawnSync(process.execPath, [
    "--import", "tsx",
    "src/claude-session-start.ts",
    "--adapter-id", CLAUDE_SESSION_START_ADAPTER_ID,
    "--agent-id", "kusabi",
    "--project", "agent-memory",
    "--workspace", workspace,
    "--binding-source-ref", "fixture:e2e-host-added-key",
  ], {
    input: raw321,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      AGENT_MEMORY_HOME: memoryHome,
      AGENT_MEMORY_DB_TYPE: "sqlite",
      AGENT_MEMORY_DB_PATH: join(root, "e2e.db"),
    },
  });
  assert.equal(e2e.status, 0, e2e.stderr);
  assert(performance.now() - started < 20_000);
  assert.equal(e2e.stdout.includes(MARK) || e2e.stderr.includes(MARK), false);
  const e2eOutput = JSON.parse(e2e.stdout);
  assert(e2eOutput.hookSpecificOutput.additionalContext.includes("WASUREZU NATIVE STARTUP RECOVERY"));
  const e2eEvidence = JSON.parse(e2e.stderr.trim().split("\n").filter((line) => line.startsWith("{"))[0]);
  assert.equal(e2eEvidence.hook.input_valid, true);
  assert.equal(e2eEvidence.outcome, "full");
  assert(validateEvidence(e2eEvidence), JSON.stringify(validateEvidence.errors));
  const diagnosticFolder = join(memoryHome, "hook-input", "kusabi", "agent-memory");
  const diagnosticFile = join(diagnosticFolder, `${CLAUDE_SESSION_START_ADAPTER_ID}.json`);
  const record = parseHookInputDiagnostic(await readFile(diagnosticFile, "utf8"));
  assert(record, "the diagnostic record is a valid record");
  assert.deepEqual(record.entries.map((entry) => [entry.event, entry.name, entry.count]), [["SessionStart", "session_title", 1]]);
  assert.equal((await readFile(diagnosticFile, "utf8")).includes(MARK), false);
  assert.deepEqual(await readdir(diagnosticFolder), [`${CLAUDE_SESSION_START_ADAPTER_ID}.json`]);
  assert.deepEqual(await readdir(home), [], "the home folder is not touched when AGENT_MEMORY_HOME is set");
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
      assert.equal(result.evidence.identity.agent_id, "kusabi");
      assert.equal(result.evidence.store_binding.backend_intent, "postgres");
      assert.equal(result.evidence.store_binding.verified, true);
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

    const manualModeInput = hookInput(child, "startup", "manual");
    const parsedManualMode = parseClaudeSessionStartInput(manualModeInput);
    assert.equal(parsedManualMode.permission_mode, "manual");
    const manualMode = await runClaudeSessionStart(manualModeInput, binding(workspace), {
      loadRecovery: async () => loaded(),
    });
    assert.equal(manualMode.evidence.hook.permission_mode, "manual");
    assert(validateEvidence(manualMode.evidence), JSON.stringify(validateEvidence.errors));

    // Live Claude Code 2.1.220 SessionStart stdin contains exactly these five
    // fields and omits model and permission_mode.
    const liveHostInput = JSON.stringify({
      cwd: child,
      hook_event_name: "SessionStart",
      session_id: "live-claude-2-1-220",
      source: "startup",
      transcript_path: "/tmp/live-claude-2-1-220.jsonl",
    });
    const parsedLiveHost = parseClaudeSessionStartInput(liveHostInput);
    assert.equal(parsedLiveHost.model, CLAUDE_SESSION_START_MODEL_UNSPECIFIED);
    assert.equal(parsedLiveHost.permission_mode, undefined);
    assert.deepEqual(Object.keys(parsedLiveHost).sort(), [
      "cwd", "hook_event_name", "model", "session_id", "source", "transcript_path",
    ]);
    const liveHost = await runClaudeSessionStart(liveHostInput, binding(workspace), {
      loadRecovery: async (_binding, input) => {
        assert.equal(input.model, CLAUDE_SESSION_START_MODEL_UNSPECIFIED);
        assert.equal(input.permission_mode, undefined);
        return loaded();
      },
    });
    assert.equal(liveHost.evidence.outcome, "full");
    assert.equal(liveHost.evidence.hook.input_valid, true);
    assert.equal(liveHost.evidence.hook.permission_mode, null);
    assert.equal(liveHost.evidence.adapter.version, "1.0.3");
    assert.equal(liveHost.evidence.adapter.host_contract_version, "2.1.220");
    assert(validateEvidence(liveHost.evidence), JSON.stringify(validateEvidence.errors));
    for (const [field, value] of [
      ["cwd", ""],
      ["session_id", ""],
      ["transcript_path", ""],
      ["permission_mode", "allowEverything"],
      ["model", null],
    ] as const) {
      assert.throws(
        () => parseClaudeSessionStartInput(JSON.stringify({ ...JSON.parse(liveHostInput), [field]: value })),
        /MALFORMED_HOOK_INPUT/,
      );
    }
    assert.throws(
      () => parseClaudeSessionStartInput(JSON.stringify({ ...JSON.parse(liveHostInput), source: "unknown" })),
      /UNSUPPORTED_START_SOURCE/,
    );
    // FR10.2: a key the host added is ignored, not a refusal of the whole input (this was an allow-list refusal).
    assert.deepEqual(
      parseClaudeSessionStartInput(JSON.stringify({ ...JSON.parse(liveHostInput), unexpected: true })),
      parsedLiveHost,
    );

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

    // FR10.2: the same input with a host-added key is accepted and gives the same recovery as without it.
    const additionalProperty = await runClaudeSessionStart(
      JSON.stringify({ ...JSON.parse(hookInput(child)), unexpected: true }),
      binding(workspace),
      { loadRecovery: async () => loaded() },
    );
    assert.equal(additionalProperty.evidence.hook.input_valid, true);
    assert.equal(additionalProperty.evidence.outcome, "full");
    assert(additionalProperty.output.hookSpecificOutput?.additionalContext.includes("Recovered objective"));

    await hostAddedKeys({ child, workspace, outside, validateEvidence, root });

    for (const field of ["cwd", "hook_event_name", "session_id", "source", "transcript_path"]) {
      const input = JSON.parse(hookInput(child));
      delete input[field];
      const result = await runClaudeSessionStart(JSON.stringify(input), binding(workspace));
      assert.match(result.output.systemMessage ?? "", /MALFORMED_HOOK_INPUT/);
    }
    const omittedModel = JSON.parse(hookInput(child));
    delete omittedModel.model;
    assert.equal(parseClaudeSessionStartInput(JSON.stringify(omittedModel)).model, CLAUDE_SESSION_START_MODEL_UNSPECIFIED);

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
      "--agent-id", "kusabi",
      "--project", "agent-memory",
      "--workspace", workspace,
      "--binding-source-ref", "fixture:binding",
      "--max-tokens", "1200",
      "--max-bytes", "4096",
      "--timeout-ms", "6000",
    ], {});
    assert.equal(parsedArgs.agent_id, "kusabi");
    assert.equal(parsedArgs.max_tokens, 1200);

    const settings = buildClaudeSessionStartSettings("/tmp/wasurezu/dist/boot.js") as {
      hooks: { SessionStart: Array<{ hooks: Array<{ timeout: number }> }> };
    };
    assert.equal(settings.hooks.SessionStart[0].hooks[0].timeout, CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS);

    const realCli = spawnSync(process.execPath, [
      "--import", "tsx",
      "src/claude-session-start.ts",
      "--adapter-id", CLAUDE_SESSION_START_ADAPTER_ID,
      "--agent-id", "kusabi",
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
    assert.equal(realEvidence.identity.agent_id, "kusabi");
    assert.equal(realEvidence.store_binding.source, "environment");
    assert.equal(realEvidence.store_binding.backend_intent, "sqlite");
    assert.equal(realEvidence.store_binding.verified, true);
    assert(validateEvidence(realEvidence), JSON.stringify(validateEvidence.errors));

    const cli = spawnSync(process.execPath, [
      "--import", "tsx",
      "src/claude-session-start.ts",
      "--adapter-id", CLAUDE_SESSION_START_ADAPTER_ID,
      "--agent-id", "kusabi",
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
