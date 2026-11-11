import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID,
  CODEX_TRANSCRIPT_STOP_ADAPTER_ID,
  parseTranscriptStopArgs,
  parseTranscriptStopInput,
  parseTranscriptStopInputWithIgnored,
  runTranscriptStopCapture,
  runTranscriptStopProcess,
  type TranscriptStopHost,
  type TranscriptStopProcessIo,
  type TranscriptStopRunResult,
} from "./transcript-stop-capture.js";
import { JsonStore } from "./stores/json-store.js";
import type { CodexSessionStartBinding } from "./codex-session-start.js";
import { hookInputDiagnosticPath, type HookDiagnosticRequest } from "./hook-input-diagnostics.js";
import type { Store } from "./stores/types.js";

const MARK = "SENTINEL_VALUE_NEVER_TO_APPEAR_7f3a";
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const slowWriter = (ms: number) => () => new Promise<void>((done) => { setTimeout(done, ms).unref(); });

const fakeStore = async (): Promise<Store> => ({ close: async () => undefined }) as unknown as Store;

interface ProcessRun {
  log: string[];
  evidence: string[];
  output: string[];
  requests: HookDiagnosticRequest[];
  exits: number;
  exited_at: number;
  answered_at: number;
}

// Time from the moment the answer was written to the exit. The start also holds the entry's own file work, which a loaded
// runner can stretch past a fixed bound; the wait this bound guards (FR10, 5 section) begins only after the answer.
const afterAnswer = (run: ProcessRun): number => run.exited_at - Math.max(run.answered_at, 0);

/** Runs the capture process function with every side effect injected; waits until exit is called. */
async function processRun(
  workspace: string,
  adapterId: string,
  raw: string | Error,
  extra: {
    argv?: string[];
    clock?: (answered: boolean) => number;
    run_diagnostic?: (request: HookDiagnosticRequest) => Promise<unknown>;
    write_delay?: number;
  } = {},
): Promise<ProcessRun> {
  const run: ProcessRun = { log: [], evidence: [], output: [], requests: [], exits: 0, exited_at: -1, answered_at: -1 };
  let answered = 0;
  const start = performance.now();
  const io: TranscriptStopProcessIo = {
    argv: extra.argv ?? [
      "--adapter-id", adapterId,
      "--agent-id", "kusabi",
      "--project", "agent-memory",
      "--workspace", workspace,
      "--binding-source-ref", "fixture:process",
      "--timeout-ms", "7000",
    ],
    env: {},
    read_input: async () => {
      if (raw instanceof Error) throw raw;
      return raw;
    },
    write_evidence: (line, done) => {
      run.log.push("evidence");
      run.evidence.push(line);
      setTimeout(() => { run.log.push("evidence_done"); answered++; if (answered === 2) run.answered_at = performance.now() - start; done(); }, extra.write_delay ?? 0);
    },
    write_output: (line, done) => {
      run.log.push("output");
      run.output.push(line);
      setTimeout(() => { run.log.push("output_done"); answered++; if (answered === 2) run.answered_at = performance.now() - start; done(); }, extra.write_delay ?? 0);
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
    clock: () => (extra.clock ? extra.clock(answered >= 2) : performance.now()),
    now: () => new Date("2026-11-11T10:00:00.000Z"),
    pid: 4242,
    dependencies: {
      createStore: fakeStore,
      receive: async () => ({ status: "captured", reason: "captured", events_saved: 1, events_duplicate: 0 }),
    },
  };
  await runTranscriptStopProcess(io);
  const limit = performance.now() + 2500;
  while (run.exits === 0 && performance.now() < limit) await sleep(5);
  await sleep(60);
  return run;
}

/** FR10: keys the host added (Claude Code 2.1.321) are ignored; every other rule of the entry stays. */
// The hook command run as a file: standard input is read, the answer and the evidence are written, and the
// names of the keys the entry does not know are recorded under the (temporary) agent memory home.
async function realEntry(root: string, workspace: string): Promise<void> {
  const home = join(root, "real-entry-home");
  const memoryHome = join(home, "agent-memory-home");
  const env = { ...process.env, HOME: home, AGENT_MEMORY_HOME: memoryHome };
  const entry = join(process.cwd(), "src", "transcript-stop-capture.ts");
  const args = [
    "--adapter-id", CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID, "--agent-id", "kusabi", "--project", "agent-memory",
    "--workspace", workspace, "--binding-source-ref", "fixture:binding", "--max-tokens", "1800",
    "--max-bytes", "8192", "--timeout-ms", "7000",
  ];
  const evidenceOf = (stderr: string) => JSON.parse(stderr.split("\n").filter((line) => line.startsWith("{"))[0] ?? "{}") as { reason?: string; hook_event_name?: string | null };
  const bad = spawnSync(process.execPath, ["--import", "tsx", entry, ...args], { encoding: "utf8", env, input: "not json" });
  assert.equal(bad.status, 0, bad.stderr);
  assert.deepEqual(JSON.parse(bad.stdout), { continue: true, suppressOutput: true });
  assert.equal(evidenceOf(bad.stderr).reason, "malformed_input");

  const sentinel = "SENTINEL_VALUE_NEVER_TO_APPEAR_5c1e";
  const input = JSON.stringify({
    cwd: workspace, hook_event_name: "Stop", session_id: "session-real", transcript_path: join(workspace, "missing.jsonl"), prompt_id: sentinel,
  });
  const accepted = spawnSync(process.execPath, ["--import", "tsx", entry, ...args], { encoding: "utf8", env, input });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.deepEqual(JSON.parse(accepted.stdout), { continue: true, suppressOutput: true });
  assert.equal(evidenceOf(accepted.stderr).hook_event_name, "Stop");
  const record = await readFile(hookInputDiagnosticPath({ AGENT_MEMORY_HOME: memoryHome }, "kusabi", "agent-memory", CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID), "utf8");
  assert.deepEqual((JSON.parse(record) as { entries: Array<{ name: string; count: number }> }).entries.map((entry) => [entry.name, entry.count]), [["prompt_id", 1]]);
  assert.equal(record.includes(sentinel) || accepted.stdout.includes(sentinel) || accepted.stderr.includes(sentinel), false, "no value of an unknown key is written anywhere");
}

async function hostAddedKeys(root: string, workspace: string, cwd: string, binding: CodexSessionStartBinding): Promise<void> {
  const transcript = join(root, "transcript.jsonl");
  const stop = { cwd, hook_event_name: "Stop", session_id: "session-1", transcript_path: transcript };
  const prompt = { cwd, hook_event_name: "UserPromptSubmit", session_id: "session-1", transcript_path: transcript, prompt: "visible" };
  const stopKeys = { background_tasks: [MARK], effort: MARK, prompt_id: MARK, session_crons: { x: MARK } };
  const promptKeys = { prompt_id: MARK, session_title: MARK };

  // The sibling reports names and returns what the original returns; values are never carried.
  for (const [base, extra] of [[stop, stopKeys], [prompt, promptKeys]] as const) {
    const withKeys = JSON.stringify({ ...base, ...extra });
    const sibling = parseTranscriptStopInputWithIgnored(withKeys);
    assert.deepEqual(sibling.input, parseTranscriptStopInput(withKeys));
    assert.deepEqual(sibling.input, parseTranscriptStopInput(JSON.stringify(base)));
    assert.deepEqual([...sibling.ignored_names], Object.keys(extra).sort());
    assert.equal(JSON.stringify(sibling).includes(MARK), false);
  }
  assert.deepEqual([...parseTranscriptStopInputWithIgnored(JSON.stringify(stop)).ignored_names], []);
  for (const raw of ["{}", "{", "[]", "null", JSON.stringify({ ...stop, hook_event_name: "SessionStart" })]) {
    assert.throws(() => parseTranscriptStopInputWithIgnored(raw), /malformed_input/);
  }

  // F1: the eight optional keys are not type-checked today: a wrong type is accepted and left out.
  const mismatched: Array<[string, unknown]> = [
    ["model", null], ["permission_mode", "invalid-mode"], ["stop_hook_active", "yes"],
    ["last_assistant_message", 42], ["agent_id", null], ["agent_type", false], ["prompt", []], ["turn_id", {}],
  ];
  for (const [field, value] of mismatched) {
    for (const base of [stop, prompt]) {
      for (const extra of [{}, { session_title: MARK }]) {
        const raw = JSON.stringify({ ...base, [field]: value, ...extra });
        const input = parseTranscriptStopInputWithIgnored(raw).input;
        assert.equal(field in input, false, `${field} must be left out`);
        assert.deepEqual(input, parseTranscriptStopInput(JSON.stringify(base)), `${field}: same as the input without it`);
        for (const host of ["codex", "claude_code"] as const) {
          const result = await runTranscriptStopCapture(raw, host, binding, {
            createStore: fakeStore,
            receive: async () => ({ status: "captured", reason: "captured", events_saved: 1, events_duplicate: 0 }),
          });
          assert.equal(result.evidence.status, "captured", `${host} ${field}`);
        }
      }
    }
  }
  // The two typed ones are returned only with the right type (unchanged behaviour).
  const typed = parseTranscriptStopInput(JSON.stringify({ ...stop, stop_hook_active: true, last_assistant_message: "text" }));
  assert.equal(typed.stop_hook_active, true);
  assert.equal(typed.last_assistant_message, "text");

  // Differential (F5): the result for N + U equals the result for N, for both hosts.
  interface Seen { inputs: string[] }
  const run = async (host: TranscriptStopHost, input: Record<string, unknown>, bound: CodexSessionStartBinding, seen: Seen) => {
    const result = await runTranscriptStopCapture(JSON.stringify(input), host, bound, {
      createStore: fakeStore,
      receive: async (_store, received) => {
        seen.inputs.push(JSON.stringify(received));
        return { status: "captured", reason: "captured", events_saved: 1, events_duplicate: 0 };
      },
    });
    return result;
  };
  const outside = join(root, "outside-cwd");
  await mkdir(outside, { recursive: true });
  const without = (base: Record<string, unknown>, key: string) => {
    const copy = { ...base };
    delete copy[key];
    return copy;
  };
  type Case = [string, Record<string, unknown>, CodexSessionStartBinding, string];
  const bad = { ...binding, agent_id: "" };
  for (const host of ["codex", "claude_code"] as const) {
    const cases: Case[] = [
      ["accepted Stop", stop, binding, "accepted"],
      ["accepted UserPromptSubmit", prompt, binding, "accepted"],
      ["cwd missing", without(stop, "cwd"), binding, "malformed_input"],
      ["hook_event_name missing", without(stop, "hook_event_name"), binding, "malformed_input"],
      ["session_id missing", without(stop, "session_id"), binding, "malformed_input"],
      ["transcript_path missing", without(stop, "transcript_path"), binding, "malformed_input"],
      ["empty cwd", { ...stop, cwd: "" }, binding, "malformed_input"],
      ["padded session id", { ...stop, session_id: " s" }, binding, "malformed_input"],
      ["wrong event", { ...stop, hook_event_name: "SessionStart" }, binding, "malformed_input"],
      ["binding invalid", stop, bad, "identity_binding_invalid"],
      // FR8 R1: Claude Code identity does not use the hook's cwd, so N is accepted there and no cwd check is added.
      ["cwd outside the workspace", { ...stop, cwd: outside }, binding, host === "codex" ? "identity_binding_invalid" : "accepted"],
      ["transcript outside the workspace", { ...stop, transcript_path: join(outside, "t.jsonl") }, binding, "accepted"],
    ];
    for (const [label, input, bound, expected] of cases) {
      const seenN: Seen = { inputs: [] };
      const seenU: Seen = { inputs: [] };
      const plain = await run(host, input, bound, seenN);
      const marked = await run(host, { ...input, ...stopKeys, session_title: MARK }, bound, seenU);
      const view = (result: TranscriptStopRunResult) => JSON.stringify({
        status: result.evidence.status, reason: result.evidence.reason, outcome: result.evidence.outcome,
        saved: result.evidence.events_saved, session: result.evidence.session_id, event: result.evidence.hook_event_name,
        output: result.output,
      });
      assert.equal(plain.evidence.status === "captured" ? "accepted" : plain.evidence.reason, expected, `${host} ${label}: plain`);
      assert.equal(view(marked), view(plain), `${host} ${label}: a host-added key must not change the result`);
      assert.deepEqual(seenU.inputs, seenN.inputs, `${host} ${label}: the store receives the same input`);
      assert.equal(JSON.stringify(marked).includes(MARK) || seenU.inputs.join("").includes(MARK), false, `${host} ${label}: no ignored value anywhere`);
    }
  }
  // Claude: a cwd outside the workspace is accepted, with and without the extra key, and still not checked.
  const claudeOutside = await runTranscriptStopCapture(JSON.stringify({ ...stop, cwd: outside, ...stopKeys }), "claude_code", binding, {
    createStore: fakeStore,
    receive: async () => ({ status: "captured", reason: "captured", events_saved: 1, events_duplicate: 0 }),
  });
  assert.equal(claudeOutside.evidence.status, "captured");

  // on_ignored_names: once, right after the parser accepts (also when the binding is refused later); never for a refusal.
  const calls: string[][] = [];
  const watch = { createStore: fakeStore, on_ignored_names: (names: readonly string[]) => { calls.push([...names]); } };
  await runTranscriptStopCapture(JSON.stringify({ ...stop, zeta: 1, ...stopKeys }), "claude_code", binding, watch);
  assert.deepEqual(calls, [["background_tasks", "effort", "prompt_id", "session_crons", "zeta"]]);
  calls.length = 0;
  await runTranscriptStopCapture(JSON.stringify({ ...stop, session_title: MARK }), "codex", bad, watch);
  assert.deepEqual(calls, [["session_title"]], "the parser accepted it; the binding refusal comes after");
  calls.length = 0;
  for (const refused of ["{}", "{", "[]", JSON.stringify({ ...without(stop, "cwd"), session_title: MARK }), JSON.stringify({ ...stop, hook_event_name: "Other", session_title: MARK })]) {
    await runTranscriptStopCapture(refused, "codex", binding, watch);
  }
  assert.deepEqual(calls, []);
  await runTranscriptStopCapture(JSON.stringify(stop), "codex", binding, {
    ...watch,
    receive: async () => ({ status: "captured", reason: "captured", events_saved: 0, events_duplicate: 0 }),
  });
  assert.deepEqual(calls, [[]], "reported once, with no names, when there is nothing to report");

  // The process function: write callbacks first, the bounded wait, the budget, the failure paths.
  const plainCodex = await processRun(workspace, CODEX_TRANSCRIPT_STOP_ADAPTER_ID, JSON.stringify(stop));
  assert.equal(plainCodex.exits, 1);
  assert.deepEqual(plainCodex.requests, [], "nothing to report: no diagnostic is started");
  assert(afterAnswer(plainCodex) < 150, `exit after the answer ${afterAnswer(plainCodex)} ms`);
  assert.equal(plainCodex.evidence.length, 1);
  assert.equal(plainCodex.output.length, 1);
  assert.equal(plainCodex.output[0], `${JSON.stringify({ continue: true, suppressOutput: true })}\n`);
  assert.equal(JSON.parse(plainCodex.evidence[0]).adapter_id, CODEX_TRANSCRIPT_STOP_ADAPTER_ID);
  const log = plainCodex.log;
  assert(log.indexOf("exit") > log.indexOf("evidence_done") && log.indexOf("exit") > log.indexOf("output_done"), "exit follows the write callbacks");
  assert(log.indexOf("evidence") < log.indexOf("output"), "evidence first, then the answer (unchanged order)");

  const slowCodex = await processRun(workspace, CODEX_TRANSCRIPT_STOP_ADAPTER_ID, JSON.stringify({ ...stop, ...stopKeys }), {
    run_diagnostic: slowWriter(3000),
    write_delay: 60,
  });
  assert.equal(slowCodex.requests.length, 1);
  const request = slowCodex.requests[0];
  assert.equal(request.adapter_id, CODEX_TRANSCRIPT_STOP_ADAPTER_ID);
  assert.equal(request.event, "Stop");
  assert.deepEqual([...request.names], ["background_tasks", "effort", "prompt_id", "session_crons"]);
  assert.equal(request.agent_id, "kusabi");
  assert.equal(request.project, "agent-memory");
  assert.equal(request.pid, 4242);
  assert.equal(request.now.toISOString(), "2026-11-11T10:00:00.000Z");
  assert.equal(JSON.stringify(request).includes(MARK), false);
  const at = (entry: string) => slowCodex.log.indexOf(entry);
  assert(at("diagnostic") > at("evidence_done") && at("diagnostic") > at("output_done"), JSON.stringify(slowCodex.log));
  assert(at("exit") > at("diagnostic"));
  assert(slowCodex.exited_at >= 180 + 60 && slowCodex.exited_at < 1000, `slow diagnostic: exit at ${slowCodex.exited_at} ms`);
  assert.deepEqual(slowCodex.evidence, plainCodex.evidence, "bytes are the same with and without the host-added keys");
  assert.deepEqual(slowCodex.output, plainCodex.output);

  const claudePrompt = await processRun(workspace, CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID, JSON.stringify({ ...prompt, ...promptKeys }), {
    run_diagnostic: slowWriter(5),
  });
  assert.equal(claudePrompt.requests[0].adapter_id, CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID);
  assert.equal(claudePrompt.requests[0].event, "UserPromptSubmit");
  assert(afterAnswer(claudePrompt) < 150, `fast diagnostic: exit after the answer ${afterAnswer(claudePrompt)} ms`);

  const exhausted = await processRun(workspace, CODEX_TRANSCRIPT_STOP_ADAPTER_ID, JSON.stringify({ ...stop, ...stopKeys }), {
    clock: (answered) => (answered ? 6_500 : 0),
  });
  assert.deepEqual(exhausted.requests, [], "less than the floor is left: the diagnostic is not started");
  assert.equal(exhausted.exits, 1);
  assert(afterAnswer(exhausted) < 150, `exhausted: exit after the answer ${afterAnswer(exhausted)} ms`);
  assert.deepEqual(exhausted.evidence, plainCodex.evidence);

  const thrown = await processRun(workspace, CODEX_TRANSCRIPT_STOP_ADAPTER_ID, JSON.stringify({ ...stop, ...stopKeys }), {
    run_diagnostic: () => { throw new Error("writer threw"); },
  });
  assert.equal(thrown.exits, 1);
  assert.deepEqual(thrown.output, plainCodex.output);

  // A refusal writes the same bytes as before, starts no diagnostic, and exits.
  const plainMalformed = await processRun(workspace, CODEX_TRANSCRIPT_STOP_ADAPTER_ID, "{}");
  const markedMalformed = await processRun(workspace, CODEX_TRANSCRIPT_STOP_ADAPTER_ID, JSON.stringify({ ...without(stop, "cwd"), session_title: MARK }));
  assert.equal(JSON.parse(plainMalformed.evidence[0]).reason, "malformed_input");
  assert.deepEqual(markedMalformed.evidence, plainMalformed.evidence);
  assert.deepEqual(markedMalformed.output, plainMalformed.output);
  assert.deepEqual(markedMalformed.requests, []);
  assert.equal(markedMalformed.exits, 1);
  assert(afterAnswer(markedMalformed) < 150);

  // The failure paths of main (arguments or standard input cannot be read) still end with the answer and an exit.
  const failing: Array<{ label: string; raw: string | Error; extra: { argv?: string[] } }> = [
    { label: "no adapter id", raw: "{}", extra: { argv: [] } },
    { label: "unreadable input", raw: new Error("input too large"), extra: {} },
  ];
  for (const { label, raw, extra } of failing) {
    const failed = await processRun(workspace, CODEX_TRANSCRIPT_STOP_ADAPTER_ID, raw, extra);
    assert.equal(failed.exits, 1, label);
    assert.deepEqual(failed.requests, [], label);
    assert.equal(failed.output.length, 1, label);
    assert.equal(failed.output[0], `${JSON.stringify({ continue: true, suppressOutput: true })}\n`);
    assert.equal(failed.evidence.length, 2, `${label}: the note line, then the evidence line`);
    assert.match(failed.evidence[0], /^\[transcript-stop-capture\] /);
    assert.equal(JSON.parse(failed.evidence[1]).reason, "malformed_input");
    assert(failed.log.indexOf("exit") > failed.log.lastIndexOf("output_done"), `${label}: exit follows the write callbacks`);
    assert(afterAnswer(failed) < 150, `${label}: exit after the answer ${afterAnswer(failed)} ms`);
  }
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "wasurezu-transcript-stop-"));
  try {
    const workspace = join(root, "workspace");
    const cwd = join(workspace, "nested");
    await mkdir(cwd, { recursive: true });
    const binding: CodexSessionStartBinding = {
      agent_id: "kusabi",
      project: "agent-memory",
      workspace,
      binding_source_ref: "fixture:binding",
      max_tokens: 1_800,
      max_bytes: 8_192,
      timeout_ms: 7_000,
    };
    const raw = JSON.stringify({
      cwd,
      hook_event_name: "Stop",
      session_id: "session-1",
      transcript_path: join(root, "transcript.jsonl"),
      stop_hook_active: false,
      last_assistant_message: "full visible answer",
      model: "fixture",
      permission_mode: "default",
      turn_id: "turn-1",
    });
    assert.equal(parseTranscriptStopInput(raw).session_id, "session-1");
    assert.throws(() => parseTranscriptStopInput("{}"), /malformed_input/);
    assert.throws(() => parseTranscriptStopInput(JSON.stringify({
      ...JSON.parse(raw),
      hook_event_name: "SessionStart",
    })), /malformed_input/);

    const stores: JsonStore[] = [];
    const createStore = async () => {
      const store = new JsonStore(join(root, `store-${stores.length}`));
      await store.initialize();
      stores.push(store);
      return store;
    };
    const captured = await runTranscriptStopCapture(raw, "codex", binding, {
      createStore,
      receive: async (_store, input) => {
        assert.equal(input.agent_id, "kusabi");
        assert.equal(input.project, "agent-memory");
        assert.equal(input.snapshot_mode, "tail");
        assert.equal(input.tail_bytes, 4 * 1024 * 1024);
        return { status: "captured", reason: "captured", events_saved: 2, events_duplicate: 3 };
      },
    });
    assert.deepEqual(captured.output, { continue: true, suppressOutput: true });
    assert.equal(captured.evidence.adapter_id, CODEX_TRANSCRIPT_STOP_ADAPTER_ID);
    assert.equal(captured.evidence.status, "captured");
    assert.equal(captured.evidence.events_saved, 2);
    assert.equal(captured.evidence.events_duplicate, 3);
    assert.equal(captured.evidence.hook_event_name, "Stop");
    assert.equal(captured.evidence.private_reasoning_persisted, false);

    const claude = await runTranscriptStopCapture(raw, "claude_code", binding, {
      createStore,
      receive: async () => ({
        status: "skipped",
        reason: "transcript_too_large",
        events_saved: 0,
        events_duplicate: 0,
      }),
    });
    assert.equal(claude.evidence.adapter_id, CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID);
    assert.equal(claude.evidence.status, "skipped");
    assert.equal(claude.evidence.reason, "transcript_too_large");

    const malformed = await runTranscriptStopCapture("{}", "codex", binding, { createStore });
    assert.equal(malformed.evidence.status, "failed_open");
    assert.equal(malformed.evidence.reason, "malformed_input");
    assert.equal(stores.length, 2, "malformed input must not open a store");

    const foreign = await runTranscriptStopCapture(JSON.stringify({
      ...JSON.parse(raw),
      cwd: root,
    }), "codex", binding, { createStore });
    assert.equal(foreign.evidence.reason, "identity_binding_invalid");
    assert.equal(stores.length, 2, "identity mismatch must not open a store");

    const failedOpen = await runTranscriptStopCapture(raw, "codex", binding, {
      createStore,
      receive: async () => { throw new Error("fixture failure"); },
    });
    assert.equal(failedOpen.evidence.status, "failed_open");
    assert.equal(failedOpen.evidence.reason, "ingest_failed");

    const promptRaw = JSON.stringify({
      cwd,
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      transcript_path: join(root, "transcript.jsonl"),
      prompt: "full visible user request",
    });
    const prompt = await runTranscriptStopCapture(promptRaw, "codex", binding, {
      createStore,
      receive: async () => ({
        status: "captured",
        reason: "captured",
        events_saved: 1,
        events_duplicate: 0,
      }),
    });
    assert.equal(prompt.evidence.hook_event_name, "UserPromptSubmit");
    assert.equal(prompt.evidence.events_saved, 1);

    const args = [
      "--adapter-id", CODEX_TRANSCRIPT_STOP_ADAPTER_ID,
      "--agent-id", "kusabi",
      "--project", "agent-memory",
      "--workspace", workspace,
      "--binding-source-ref", "fixture:binding",
      "--max-tokens", "1800",
      "--max-bytes", "8192",
      "--timeout-ms", "7000",
    ];
    assert.equal(parseTranscriptStopArgs(args).host, "codex");
    assert.equal(
      parseTranscriptStopArgs(args.map((value) =>
        value === CODEX_TRANSCRIPT_STOP_ADAPTER_ID ? CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID : value
      )).host,
      "claude_code",
    );
    assert.throws(() => parseTranscriptStopArgs([]), /missing adapter id/);

    await hostAddedKeys(root, workspace, cwd, binding);
    await realEntry(root, workspace);

    console.log("transcript stop capture tests passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
