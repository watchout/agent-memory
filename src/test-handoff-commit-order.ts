/**
 * Step 17 (FR11, 261110-session-rotation): the hand-off is committed after the output is written, in the order
 * output -> output-written record -> consume. T1-T7, T10-T15 of handoff-commit-order-design.md section 6
 * (the watcher half, T8/T15(b)/T16, is in test-rotation-watcher-flow.ts and -units.ts; T9 is test-handoff-commit-order-pg.ts).
 * Run with a temporary HOME: the default store would otherwise write to this machine's real folder.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs, { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { ROTATION_COMMIT_BUDGET_MS, ROTATION_COMMIT_EXIT_MARGIN_MS, ROTATION_COMMIT_WRITE_RESERVE_MS } from "./constants.js";
import {
  CLAUDE_SESSION_START_ADAPTER_ID,
  CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS,
  CLAUDE_SESSION_START_MAX_BYTES,
  CLAUDE_SESSION_START_MAX_TOKENS,
  runClaudeSessionStart,
  runClaudeSessionStartProcess,
  type ClaudeSessionStartProcessIo,
} from "./claude-session-start.js";
import {
  CODEX_SESSION_START_ADAPTER_ID,
  CODEX_SESSION_START_HOOK_TIMEOUT_SECONDS,
  runCodexSessionStartProcess,
  type CodexSessionStartProcessIo,
  type LoadedCodexRecovery,
} from "./codex-session-start.js";
import {
  answerHookAndCommit,
  commitRotationRecovery,
  writeLine,
  type RotationCommitDependencies,
  type RotationCommitPlan,
  type RotationCommitResult,
} from "./rotation-commit.js";
import { prepareRotationRecovery, type RotationBlock, type RotationStartSource } from "./session-rotation-start.js";
import {
  ROTATION_OUTPUT_WRITTEN_SCHEMA,
  buildMarker,
  outputWrittenPath,
  readOutputWritten,
  readTurn,
  seatDirectory,
  sha256Hex,
  writeMarker,
  writeOutputWritten,
  type RotationMarker,
} from "./session-rotation-files.js";
import type { Store } from "./stores/types.js";

const cases: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const j = (value: unknown) => JSON.stringify(value);

// ---------- fixtures ----------
const NOW = new Date("2026-11-11T02:00:00.000Z");
const PANE = { pane_id: "%7", tmux_socket: "/tmp/sock", host_pid: 4242, host_started_at: "Tue Nov 3 10:00:00 2026" };
const HANDOFF = "## 済んだこと\n実装を進めた\n## 次の 1 歩\nwatcher の試験を書く\n## まだ決まっていないこと\nなし";
const HOOK_MS = 9_000;
const COMMIT_BY = HOOK_MS - ROTATION_COMMIT_EXIT_MARGIN_MS;

interface FakeOptions {
  failConsume?: boolean;
  raceLost?: boolean;
  /** The update is applied, then the response is lost (a rejection). */
  lostResponse?: boolean;
  hangConsume?: boolean;
  /** The consume answers after this many ms. */
  consumeDelayMs?: number;
  openDelayMs?: number;
  openFails?: boolean;
  hangClose?: boolean;
  failClose?: boolean;
}
interface Fake {
  store: Store;
  events: string[];
  consumed: boolean;
  consumeCalls: number;
  opened: number;
  closed: number;
  open_store: () => Promise<Store>;
}
function fakeStore(events: string[], options: FakeOptions = {}): Fake {
  const fake: Fake = { store: undefined as unknown as Store, events, consumed: false, consumeCalls: 0, opened: 0, closed: 0, open_store: async () => fake.store };
  fake.store = {
    getSelectedRestartPack: async (query: { pack_ref: string }) => (fake.consumed ? null : { pack_ref: query.pack_ref, content: HANDOFF }),
    consumeSelectedRestartPack: async (query: { pack_ref: string; consumed_at?: string }) => {
      fake.consumeCalls += 1;
      events.push("consume");
      assert.ok(typeof query.consumed_at === "string", "the time is passed in (S4)");
      if (options.hangConsume) return new Promise(() => undefined);
      if (options.consumeDelayMs) await sleep(options.consumeDelayMs);
      if (options.failConsume) throw new Error("consume failed");
      if (fake.consumed || options.raceLost) return null;
      fake.consumed = true;
      if (options.lostResponse) throw new Error("response lost");
      return { pack_ref: query.pack_ref, content: HANDOFF };
    },
    close: async () => {
      fake.closed += 1;
      if (options.failClose) throw new Error("close failed");
      if (options.hangClose) return new Promise(() => undefined);
    },
  } as unknown as Store;
  fake.open_store = async () => {
    if (options.openDelayMs) await sleep(options.openDelayMs);
    if (options.openFails) throw new Error("cannot open");
    fake.opened += 1;
    return fake.store;
  };
  return fake;
}

interface Scenario {
  root: string;
  workspace: string;
  rotationRoot: string;
  directory: string;
  marker: RotationMarker;
  fake: Fake;
  events: string[];
}
function scenario(over: { claim?: boolean; store?: FakeOptions; host?: "claude_code" | "codex" } = {}): Scenario {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "commit-order-")));
  const workspace = join(root, "ws");
  mkdirSync(workspace);
  const rotationRoot = join(root, "rotation");
  const directory = seatDirectory(rotationRoot, "kusabi", "agent-memory");
  mkdirSync(directory, { recursive: true });
  const events: string[] = [];
  const marker = buildMarker({
    agent_id: "kusabi", project: "agent-memory", host: over.host ?? "claude_code", session_id: "old", ...PANE,
    pack_ref: "pack-1", pack_content_sha256: sha256Hex(HANDOFF), measured_tokens: 310_000, threshold_tokens: 300_000,
    saved_at: new Date(NOW.getTime() - 120_000).toISOString(), handoff_source: "seat_text",
  });
  writeMarker(directory, marker);
  if (over.claim !== false) {
    mkdirSync(join(directory, "claims"), { recursive: true });
    writeFileSync(join(directory, "claims", `${marker.marker_id}.json`),
      j({ state: "respawning", marker_id: marker.marker_id, respawn_started_at: new Date(NOW.getTime() - 5_000).toISOString() }));
  }
  return { root, workspace, rotationRoot, directory, marker, fake: fakeStore(events, over.store), events };
}

type Host = "claude_code" | "codex";
async function prepare(sc: Scenario, host: Host, source: RotationStartSource, session = "new-sess", over: { identity?: typeof PANE; now?: Date } = {}): Promise<RotationBlock | null> {
  return prepareRotationRecovery(
    sc.fake.store,
    { agent_id: "kusabi", project: "agent-memory", host, session_id: session, source },
    { now: () => over.now ?? NOW, env: {}, identity: over.identity ?? PANE, rotation_root: sc.rotationRoot },
  );
}
async function planFor(sc: Scenario, source: RotationStartSource = "startup"): Promise<RotationCommitPlan> {
  const block = await prepare(sc, "claude_code", source);
  assert.ok(block, "the start takes the hand-off");
  return block.commit;
}

const recordFiles = (sc: Scenario): string[] => (existsSync(join(sc.directory, "output-written")) ? readdirSync(join(sc.directory, "output-written")).sort() : []);
const recordOf = (sc: Scenario) => readOutputWritten(sc.directory, sc.marker.marker_id);

/** The invariant of FR11.3: a claim-route start never leaves 'consumed with no record'. */
function assertNoConsumedWithoutRecord(sc: Scenario, label: string): void {
  if (sc.fake.consumed) assert.ok(recordOf(sc) !== null, `${label}: consumed, so a record exists`);
}

// ---------- the process layers, with every side effect injected ----------
function recoveryBase(): LoadedCodexRecovery {
  const text = "Recovered objective, exact blocker, and next safe action.";
  return {
    recovery: {
      text, token_cap: CLAUDE_SESSION_START_MAX_TOKENS, token_estimate: Math.ceil(text.length / 4), byte_count: Buffer.byteLength(text, "utf8"),
      redaction_count: 0, redaction_version: "am031-redaction-v1", truncation_count: 0, omitted_section_count: 0,
    },
    recovery_pack: {
      pack_ref: "restart_pack:kusabi:agent-memory:fixture", schema_ref: "wasurezu-recovery-pack/v1", token_budget: 1_650,
      confidence: "high", missing_context: [], source_refs: ["task_state:fixture"], policy_version: "wasurezu-memory-safety-governance/0.1.0",
    },
    recovery_quality_log_ref: "recovery_quality_log:123e4567-e89b-42d3-a456-426614174000",
    store_binding: {
      source: "user_config", backend_intent: "postgres", config_path_sha256: "a".repeat(64), binding_sha256: "b".repeat(64),
      verified: true, credentials_embedded: false,
    },
  };
}

interface RunOptions {
  source?: RotationStartSource;
  stdout_error?: boolean;
  stderr_error?: boolean;
  /** What the loader does after it has read the hand-off. */
  after_read?: "throw" | "slow" | "no_log";
  /** Milliseconds the hook is said to have run, by the point named. */
  elapsed?: () => number;
  write_record_throws?: boolean;
  extra_input?: Record<string, unknown>;
  timeout_ms?: number;
  open_store?: () => Promise<Store>;
}
interface Ran {
  stdout: string[];
  stderr: string[];
  exits: number;
  diagnostics: number;
  directResult: unknown;
}

async function runProcess(host: Host, sc: Scenario, options: RunOptions = {}): Promise<Ran> {
  const source = options.source ?? "startup";
  const ran: Ran = { stdout: [], stderr: [], exits: 0, diagnostics: 0, directResult: null };
  const raw = j({
    session_id: "new-sess", transcript_path: "/tmp/new.jsonl", cwd: sc.workspace, hook_event_name: "SessionStart", model: "m", source,
    ...(host === "codex" ? { permission_mode: "default" } : {}), ...options.extra_input,
  });
  const loadRecovery = async (_binding: unknown, input: { session_id: string; source: string }): Promise<LoadedCodexRecovery> => {
    const rotation = await prepare(sc, host, input.source as RotationStartSource, input.session_id);
    if (options.after_read === "throw") throw new Error("recovery pack unavailable");
    if (options.after_read === "slow") await sleep(300);
    const base = recoveryBase();
    return { ...base, ...(options.after_read === "no_log" ? { recovery_quality_log_ref: null } : {}), ...(rotation ? { rotation } : {}) };
  };
  let first = true;
  const clock = (): number => {
    if (first) {
      first = false;
      return 1_000;
    }
    return 1_000 + (options.elapsed ? options.elapsed() : 0);
  };
  const common = {
    env: {},
    read_input: async () => raw,
    write_evidence: (line: string, done: (error?: Error | null) => void) => {
      sc.events.push("evidence");
      ran.stderr.push(line);
      done(options.stderr_error ? new Error("EPIPE") : undefined);
    },
    write_output: (line: string, done: (error?: Error | null) => void) => {
      sc.events.push("output");
      ran.stdout.push(line);
      done(options.stdout_error ? new Error("EPIPE") : undefined);
    },
    exit: () => {
      ran.exits += 1;
      sc.events.push("exit");
    },
    emit_runtime_event: async () => undefined,
    clock,
    now: () => NOW,
    open_store: options.open_store ?? sc.fake.open_store,
    write_record: (directory: string, record: Parameters<typeof writeOutputWritten>[1]) => {
      sc.events.push("record");
      if (options.write_record_throws) throw new Error("disk");
      return writeOutputWritten(directory, record);
    },
  };
  const argv = [
    "--adapter-id", host === "claude_code" ? CLAUDE_SESSION_START_ADAPTER_ID : CODEX_SESSION_START_ADAPTER_ID,
    "--agent-id", "kusabi", "--project", "agent-memory", "--workspace", sc.workspace, "--binding-source-ref", "fixture:process",
    ...(options.timeout_ms ? ["--timeout-ms", String(options.timeout_ms)] : []),
  ];
  if (host === "claude_code") {
    const io: ClaudeSessionStartProcessIo = {
      ...common,
      argv,
      run_diagnostic: async () => {
        ran.diagnostics += 1;
        sc.events.push("diagnostic");
      },
      pid: 4242,
      dependencies: { loadRecovery: loadRecovery as never },
    };
    await runClaudeSessionStartProcess(io);
  } else {
    const io: CodexSessionStartProcessIo = { ...common, argv, dependencies: { loadRecovery: loadRecovery as never } };
    await runCodexSessionStartProcess(io);
  }
  const limit = Date.now() + 2_500;
  while (ran.exits === 0 && Date.now() < limit) await sleep(5);
  await sleep(30);
  return ran;
}

const HOSTS: Host[] = ["claude_code", "codex"];
const indexOfEvent = (events: string[], name: string): number => events.indexOf(name);

// ---------- T1, T2: nothing is used up when the answer cannot be built ----------
test("T1: the recovery load throws after the hand-off was read - the bundle stays, no record, a degraded answer, no commit", async () => {
  for (const host of HOSTS) {
    const sc = scenario({ host });
    const ran = await runProcess(host, sc, { after_read: "throw" });
    assert.equal(sc.fake.consumed, false, host);
    assert.equal(sc.fake.consumeCalls, 0, host);
    assert.deepEqual(recordFiles(sc), [], host);
    assert.ok(!ran.stdout[0]!.includes("watcher の試験を書く"), `${host}: the hand-off text is not in the degraded answer`);
    assert.ok(!sc.events.includes("record") && !sc.events.includes("consume"), host);
    assert.equal(ran.exits, 1, host);
  }
});

test("T2: the recovery load is cut by the time limit, then finishes - nothing is used up afterwards either", async () => {
  for (const host of HOSTS) {
    const sc = scenario({ host });
    const ran = await runProcess(host, sc, { after_read: "slow", timeout_ms: 100 });
    await sleep(450);
    assert.equal(sc.fake.consumed, false, host);
    assert.equal(sc.fake.consumeCalls, 0, host);
    assert.deepEqual(recordFiles(sc), [], host);
    assert.ok(!ran.stdout[0]!.includes("watcher の試験を書く"), host);
  }
});

// ---------- T3: the output not written ----------
test("T3(a)(c): a failing stdout is not committed; a failing stderr alone still commits", async () => {
  for (const host of HOSTS) {
    const failed = scenario({ host });
    await runProcess(host, failed, { stdout_error: true });
    assert.equal(failed.fake.consumed, false, `${host} (a)`);
    assert.equal(failed.fake.consumeCalls, 0, `${host} (a)`);
    assert.deepEqual(recordFiles(failed), [], `${host} (a)`);
    const evidenceOnly = scenario({ host });
    await runProcess(host, evidenceOnly, { stderr_error: true });
    assert.equal(evidenceOnly.fake.consumed, true, `${host} (c)`);
    assert.equal(recordFiles(evidenceOnly).length, 1, `${host} (c)`);
  }
});

test("T3(b): a real Writable's error - from the write callback or from the 'error' event around it - ends the write once and never reaches the process as an unhandled error", async () => {
  const uncaught: unknown[] = [];
  const onUncaught = (error: unknown): void => {
    uncaught.push(error);
  };
  process.on("uncaughtException", onUncaught);
  try {
    type Mode = "event_first" | "callback_error" | "ok" | "event_after_ok";
    const make = (mode: Mode): Writable => new Writable({
      write(_chunk, _encoding, callback) {
        if (mode === "event_first") {
          this.emit("error", new Error("EPIPE"));
          callback();
        } else if (mode === "callback_error") {
          callback(new Error("EPIPE"));
        } else {
          callback();
          if (mode === "event_after_ok") setImmediate(() => this.emit("error", new Error("late")));
        }
      },
    });
    const outcome = async (mode: Mode): Promise<{ first: string; calls: number; target: Writable }> => {
      const target = make(mode);
      let calls = 0;
      let first = "none";
      await new Promise<void>((resolve) => writeLine(target, "line\n", (error) => {
        calls += 1;
        if (calls === 1) {
          first = error ? "error" : "ok";
          resolve();
        }
      }));
      await sleep(40);
      return { first, calls, target };
    };
    for (const [mode, expected] of [["event_first", "error"], ["callback_error", "error"], ["ok", "ok"], ["event_after_ok", "ok"]] as const) {
      const got = await outcome(mode);
      assert.equal(got.first, expected, mode);
      assert.equal(got.calls, 1, `${mode}: the answer comes once`);
    }
    assert.deepEqual(uncaught.map(String), [], "no error event was left without a listener (it would stop the process)");
    // The per-write listener is taken off; one listener stays for the life of the stream, however many lines are written.
    const twice = make("ok");
    await new Promise<void>((resolve) => writeLine(twice, "a\n", () => resolve()));
    await new Promise<void>((resolve) => writeLine(twice, "b\n", () => resolve()));
    assert.equal(twice.listenerCount("error"), 1);
  } finally {
    process.off("uncaughtException", onUncaught);
  }
});

// ---------- T4: the usual start ----------
test("T4: output -> record -> consume (claim route); output -> consume with no record (marker route); the bytes of the answer are unchanged; the turn carries no mark; nothing waits after the commit", async () => {
  for (const host of HOSTS) {
    const claim = scenario({ host });
    const ran = await runProcess(host, claim, { source: "startup" });
    const e = claim.events;
    assert.ok(indexOfEvent(e, "output") >= 0 && indexOfEvent(e, "evidence") >= 0, host);
    assert.ok(indexOfEvent(e, "record") > Math.max(indexOfEvent(e, "output"), indexOfEvent(e, "evidence")), `${host}: the record is after the answer`);
    assert.ok(indexOfEvent(e, "consume") > indexOfEvent(e, "record"), `${host}: the consume is after the record`);
    assert.deepEqual(e.slice(indexOfEvent(e, "consume") + 1), ["exit"], `${host}: nothing but the exit after the commit`);
    assert.equal(claim.fake.consumed, true, host);
    assert.equal(recordFiles(claim).length, 1, host);
    assert.equal(readTurn(claim.directory)?.rotation_marker_id, null, `${host}: the turn no longer carries the mark`);
    const record = recordOf(claim)!;
    assert.equal(record.session_id, "new-sess");
    assert.equal(record.source, "startup");
    // The bytes of the answer are what the run function gives for the same input (no commit field leaks into them).
    const sc2 = scenario({ host });
    const raw = j({ session_id: "new-sess", transcript_path: "/tmp/new.jsonl", cwd: sc2.workspace, hook_event_name: "SessionStart", model: "m", source: "startup", ...(host === "codex" ? { permission_mode: "default" } : {}) });
    const binding = { agent_id: "kusabi", project: "agent-memory", workspace: sc2.workspace, binding_source_ref: "fixture:process", max_tokens: CLAUDE_SESSION_START_MAX_TOKENS, max_bytes: CLAUDE_SESSION_START_MAX_BYTES, timeout_ms: 7_000 };
    const direct = await runClaudeSessionStart(raw, binding, {
      loadRecovery: async (_b, input) => ({ ...recoveryBase(), rotation: (await prepare(sc2, host, input.source, input.session_id))! }),
    });
    if (host === "claude_code") assert.equal(ran.stdout[0], `${JSON.stringify(direct.output)}\n`, "the bytes of stdout");
    assert.ok(!ran.stdout[0]!.includes("rotation_commit") && !ran.stderr[0]!.includes("rotation_commit"), `${host}: the plan is not printed`);

    const marker = scenario({ claim: false, host });
    await runProcess(host, marker, { source: "clear" });
    assert.ok(indexOfEvent(marker.events, "consume") > indexOfEvent(marker.events, "output"), `${host}: clear - the consume is after the output`);
    assert.ok(!marker.events.includes("record"), `${host}: clear - no record`);
    assert.deepEqual(recordFiles(marker), [], host);
    assert.equal(marker.fake.consumed, true, host);
  }
});

test("T4(e): a consume is never issued unless the record is written first - a record that cannot be written means no consume", async () => {
  for (const host of HOSTS) {
    const sc = scenario({ host });
    await runProcess(host, sc, { write_record_throws: true });
    assert.ok(sc.events.includes("record"));
    assert.equal(sc.fake.consumeCalls, 0, host);
    assert.equal(sc.fake.consumed, false, host);
  }
});

// ---------- T5, T6, T12: the commit itself ----------
const deps = (sc: Scenario, over: Partial<RotationCommitDependencies> & { elapsed?: number[] | number } = {}): RotationCommitDependencies => {
  const readings = Array.isArray(over.elapsed) ? [...over.elapsed] : null;
  const fixed = typeof over.elapsed === "number" ? over.elapsed : 100;
  const { elapsed: _elapsed, ...rest } = over;
  return {
    now: () => NOW,
    elapsed_ms: () => (readings ? (readings.length > 1 ? readings.shift()! : readings[0]!) : fixed),
    hook_timeout_ms: HOOK_MS,
    open_store: sc.fake.open_store,
    ...rest,
  };
};
const expectResult = (actual: RotationCommitResult, record: RotationCommitResult["record"], consume: RotationCommitResult["consume"], label: string) =>
  assert.deepEqual(actual, { record, consume }, label);

test("T5: the consume's result never changes the record, is never retried, and a lost response is 'unknown'", async () => {
  const lost = scenario({ store: { raceLost: true } });
  expectResult(await commitRotationRecovery(await planFor(lost), deps(lost)), "written", "lost_race", "(a) a lost race");
  assert.equal(recordFiles(lost).length, 1);
  const thrown = scenario({ store: { failConsume: true } });
  expectResult(await commitRotationRecovery(await planFor(thrown), deps(thrown)), "written", "unknown", "(b) an exception");
  assert.equal(thrown.fake.consumeCalls, 1);
  const response = scenario({ store: { lostResponse: true } });
  expectResult(await commitRotationRecovery(await planFor(response), deps(response)), "written", "unknown", "(c) applied, response lost");
  assert.equal(response.fake.consumeCalls, 1, "not sent again");
  assert.equal(response.fake.consumed, true, "and not read as 'not updated': it was applied");
  const noBudget = scenario();
  expectResult(await commitRotationRecovery(await planFor(noBudget), deps(noBudget, { elapsed: [6_000, 7_100] })), "written", "skipped", "(d) no budget left after the record");
  assert.equal(noBudget.fake.consumeCalls, 0);
  assert.equal(noBudget.fake.consumed, false, "the bundle stays");
  const failedOpen = scenario({ store: { openFails: true } });
  expectResult(await commitRotationRecovery(await planFor(failedOpen), deps(failedOpen)), "written", "unknown", "the store cannot be opened");
});

test("T6(a): with less than the reserve left, nothing is done - and exactly the reserve left still proceeds", async () => {
  const none = scenario();
  expectResult(await commitRotationRecovery(await planFor(none), deps(none, { elapsed: COMMIT_BY - ROTATION_COMMIT_WRITE_RESERVE_MS + 1 })), "skipped", "skipped", "just under");
  assert.deepEqual(recordFiles(none), []);
  assert.equal(none.fake.consumed, false);
  const edge = scenario();
  expectResult(await commitRotationRecovery(await planFor(edge), deps(edge, { elapsed: COMMIT_BY - ROTATION_COMMIT_WRITE_RESERVE_MS })), "written", "consumed", "exactly the reserve");
  // The same through a process layer: the recovery load took 6.7 s or more and succeeded.
  for (const host of HOSTS) {
    const slow = scenario({ host });
    const ran = await runProcess(host, slow, { elapsed: () => 6_800 });
    assert.ok(ran.stdout[0]!.includes("watcher の試験を書く"), `${host}: the text is in the answer`);
    assert.deepEqual(recordFiles(slow), [], host);
    assert.equal(slow.fake.consumed, false, host);
  }
});

test("T6(b)-(e): a consume past its budget is 'unknown'; a store opened late is not used; a late answer writes nothing; a close that never returns is not awaited", async () => {
  const budget = COMMIT_BY - 6_650;
  assert.ok(budget > 0 && budget < ROTATION_COMMIT_BUDGET_MS);
  const hung = scenario({ store: { hangConsume: true } });
  const began = Date.now();
  expectResult(await commitRotationRecovery(await planFor(hung), deps(hung, { elapsed: 6_650 })), "written", "unknown", "(b)");
  assert.ok(Date.now() - began >= budget - 20 && Date.now() - began < budget + 400, "it gave up at the budget");
  assert.equal(recordFiles(hung).length, 1, "the record was already there");

  const lateOpen = scenario({ store: { openDelayMs: budget + 250 } });
  expectResult(await commitRotationRecovery(await planFor(lateOpen), deps(lateOpen, { elapsed: 6_650 })), "written", "unknown", "(c)");
  await sleep(400);
  assert.equal(lateOpen.fake.consumeCalls, 0, "a store opened after the budget issues no consume");
  assert.equal(lateOpen.fake.closed, 1, "it is only closed");
  assert.equal(lateOpen.fake.consumed, false);

  const lateAnswer = scenario({ store: { consumeDelayMs: budget + 250 } });
  expectResult(await commitRotationRecovery(await planFor(lateAnswer), deps(lateAnswer, { elapsed: 6_650 })), "written", "unknown", "(d)");
  const recordText = readFileSync(outputWrittenPath(lateAnswer.directory, lateAnswer.marker.marker_id), "utf8");
  await sleep(400);
  assert.equal(readFileSync(outputWrittenPath(lateAnswer.directory, lateAnswer.marker.marker_id), "utf8"), recordText, "a late answer writes nothing");
  assert.deepEqual(recordFiles(lateAnswer), [`${lateAnswer.marker.marker_id}.json`]);

  const hangClose = scenario({ store: { hangClose: true } });
  const started = Date.now();
  expectResult(await commitRotationRecovery(await planFor(hangClose), deps(hangClose)), "written", "consumed", "(e)");
  assert.ok(Date.now() - started < ROTATION_COMMIT_BUDGET_MS / 2, "the close is not awaited");
});

// ---------- T7: after a commit that did not happen ----------
test("T7: the next start follows the same rules as before - a bundle left active is taken again only inside the limits", async () => {
  const sc = scenario();
  assert.ok(await prepare(sc, "claude_code", "startup"), "first start, bundle active");
  assert.ok(await prepare(sc, "claude_code", "startup"), "no commit happened, so the same startup is allowed again");
  assert.ok(await prepare(sc, "claude_code", "clear"), "clear with the same pane");
  assert.ok(await prepare(sc, "claude_code", "clear", "s", { identity: { ...PANE, pane_id: null as never, tmux_socket: null as never } }), "a missing pane id on one side is accepted");
  assert.equal(await prepare(sc, "claude_code", "clear", "s", { identity: { ...PANE, pane_id: "%99" } }), null, "both known and different");
  assert.equal(await prepare(sc, "claude_code", "resume"), null);
  assert.equal(await prepare(sc, "claude_code", "startup", "s", { now: new Date(NOW.getTime() + 90_000) }), null, "outside the 60 s wait");
  assert.equal(await prepare(sc, "claude_code", "clear", "s", { now: new Date(NOW.getTime() + 1_900_000) }), null, "the marker is too old");
  const noClaim = scenario({ claim: false });
  assert.equal(await prepare(noClaim, "claude_code", "startup"), null, "a startup with no order");
});

// ---------- T10, T11: the degraded answer and the diagnostic ----------
test("T10: a degraded answer that still carries the hand-off text is committed", async () => {
  for (const host of HOSTS) {
    const sc = scenario({ host });
    const ran = await runProcess(host, sc, { after_read: "no_log" });
    assert.ok(ran.stdout[0]!.includes("watcher の試験を書く"), host);
    assert.ok(ran.stdout[0]!.includes("systemMessage"), `${host}: the answer is the degraded kind`);
    assert.equal(sc.fake.consumed, true, host);
    assert.equal(recordFiles(sc).length, 1, host);
    assert.ok(indexOfEvent(sc.events, "record") < indexOfEvent(sc.events, "consume"), host);
  }
});

test("T11: with ignored key names, the order is output -> commit -> diagnostic; a diagnostic with too little time left is not started and the commit is the same", async () => {
  const sc = scenario();
  const ran = await runProcess("claude_code", sc, { extra_input: { session_title: "x" }, elapsed: () => 100 });
  const e = sc.events;
  assert.ok(indexOfEvent(e, "consume") > indexOfEvent(e, "record") && indexOfEvent(e, "record") > indexOfEvent(e, "output"));
  assert.ok(indexOfEvent(e, "diagnostic") > indexOfEvent(e, "consume"), "the diagnostic is after the commit");
  assert.equal(ran.diagnostics, 1);
  assert.equal(sc.fake.consumed, true);
  const late = scenario();
  const lateRan = await runProcess("claude_code", late, { extra_input: { session_title: "x" }, elapsed: () => 6_000 });
  assert.equal(lateRan.diagnostics, 0, "less than the floor is left: no diagnostic");
  assert.equal(late.fake.consumed, true, "the commit does not depend on the diagnostic");
  assert.equal(recordFiles(late).length, 1);
});

// ---------- T12: the output-written record ----------
test("T12(a)(b): the record is written once with the plan's identity and the commit's time, 0600, no temp; a second write keeps the first", async () => {
  const sc = scenario();
  const plan = await planFor(sc);
  expectResult(await commitRotationRecovery(plan, deps(sc)), "written", "consumed", "(a)");
  const path = outputWrittenPath(sc.directory, sc.marker.marker_id);
  assert.deepEqual(recordFiles(sc), [`${sc.marker.marker_id}.json`], "one file, no temp");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(join(sc.directory, "output-written")).mode & 0o777, 0o700);
  const first = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  assert.deepEqual(first, {
    schema_version: ROTATION_OUTPUT_WRITTEN_SCHEMA, marker_id: sc.marker.marker_id, agent_id: "kusabi", project: "agent-memory", host: "claude_code",
    session_id: "new-sess", source: "startup", ...PANE, turn_at: plan.turn!.at, output_written_at: NOW.toISOString(),
  });
  assert.ok(!/delivered|received|delivery/.test(readFileSync(path, "utf8")), "T15(a): only the observed fact is named");
  const second = await commitRotationRecovery(plan, deps(sc, { now: () => new Date(NOW.getTime() + 5_000) }));
  assert.equal(second.record, "exists");
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), first, "the first record is kept");
});

test("T12(c): a record that cannot be written is 'failed', throws nothing, and means no consume", async () => {
  const blocked = scenario();
  writeFileSync(join(blocked.directory, "output-written"), "a file where the folder should be");
  expectResult(await commitRotationRecovery(await planFor(blocked), deps(blocked)), "failed", "skipped", "folder cannot be made");
  assert.equal(blocked.fake.consumeCalls, 0);
  const readOnly = scenario();
  mkdirSync(join(readOnly.directory, "output-written"), { mode: 0o700 });
  chmodSync(join(readOnly.directory, "output-written"), 0o500);
  try {
    expectResult(await commitRotationRecovery(await planFor(readOnly), deps(readOnly)), "failed", "skipped", "folder cannot be written");
    assert.deepEqual(recordFiles(readOnly), [], "no record, no temp left");
  } finally {
    chmodSync(join(readOnly.directory, "output-written"), 0o700);
  }
  const seam = scenario();
  expectResult(await commitRotationRecovery(await planFor(seam), deps(seam, { write_record: () => { throw new Error("disk"); } })), "failed", "skipped", "a throwing writer");
});

test("T12(i): the writer refuses a marker id that is not a marker id's spelling - it throws, makes no file and no folder, and the commit says 'failed' and consumes nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "rotation-writer-spelling-"));
  const seat = join(root, "seat");
  mkdirSync(seat, { recursive: true });
  const at = NOW.toISOString();
  const record = (marker_id: string): Parameters<typeof writeOutputWritten>[1] => ({
    marker_id, agent_id: "kusabi", project: "agent-memory", host: "claude_code", session_id: "s", source: "startup", ...PANE, turn_at: at, output_written_at: at,
  });
  const spellings = ["", "../escape", "..", "a/b", "A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), `${"a".repeat(64)}\n`, `${"a".repeat(32)}/../${"b".repeat(27)}`];
  for (const bad of spellings) {
    assert.throws(() => writeOutputWritten(seat, record(bad)), /marker id/, `refused: ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(readdirSync(seat), [], "no output-written folder and no file was made in the seat folder");
  assert.deepEqual(readdirSync(root), ["seat"], "nothing was made beside the seat folder either (no path was built from the spelling)");
  assert.equal(writeOutputWritten(seat, record("a".repeat(64))), "written", "a marker id's spelling still writes");
  assert.equal(writeOutputWritten(seat, record("a".repeat(64))), "exists", "and the second write still keeps the first");

  const sc = scenario();
  const plan = await planFor(sc);
  const before = readdirSync(sc.directory).sort();
  expectResult(await commitRotationRecovery({ ...plan, marker_id: "../escape" }, deps(sc)), "failed", "skipped", "a plan whose marker id is not a marker id's spelling");
  assert.equal(sc.fake.consumeCalls, 0, "nothing was used up");
  assert.deepEqual(readdirSync(sc.directory).sort(), before, "the seat folder is as it was");
});

const WRITER = `
const [file, directory, at] = process.argv.slice(1);
const m = await import(file);
const out = m.writeOutputWritten(directory, { marker_id: "a".repeat(64), agent_id: "kusabi", project: "p", host: "claude_code", session_id: "s", source: "startup", pane_id: "%7", tmux_socket: "/t", host_pid: 1, host_started_at: "x", turn_at: at, output_written_at: at });
process.stdout.write(out);
`;
function runWriter(directory: string, at: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", WRITER, pathToFileURL(join(process.cwd(), "src", "session-rotation-files.ts")).href, directory, at], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += String(chunk); });
    child.on("close", (code) => resolve({ code, out }));
  });
}

test("T12(d): two real processes writing the same marker's record at once leave exactly one complete record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "commit-order-race-"));
  const results = await Promise.all([runWriter(dir, "2026-11-11T02:00:01.000Z"), runWriter(dir, "2026-11-11T02:00:02.000Z"), runWriter(dir, "2026-11-11T02:00:03.000Z")]);
  assert.deepEqual(results.map((r) => r.code), [0, 0, 0]);
  assert.deepEqual(results.map((r) => r.out).sort(), ["exists", "exists", "written"]);
  const files = readdirSync(join(dir, "output-written"));
  assert.deepEqual(files, [`${"a".repeat(64)}.json`], "one file, no temp");
  const record = readOutputWritten(dir, "a".repeat(64));
  assert.ok(record !== null && ["2026-11-11T02:00:01.000Z", "2026-11-11T02:00:02.000Z", "2026-11-11T02:00:03.000Z"].includes(record.turn_at));
});

test("T12(e): the commit does not read or write turn.json, and a real Stop-side writer at the same time touches neither the record nor the turn's validity", async () => {
  const sc = scenario();
  const plan = await planFor(sc);
  const before = readFileSync(join(sc.directory, "turn.json"), "utf8");
  const writerScript = `
const [file, directory] = process.argv.slice(1);
const m = await import(file);
const end = Date.now() + 400;
while (Date.now() < end) m.writeTurn(directory, { agent_id: "kusabi", project: "agent-memory", host: "claude_code", session_id: "new-sess", state: "busy", source: null, rotation_marker_id: null, at: new Date().toISOString(), pane_id: null, tmux_socket: null, host_pid: null, host_started_at: null });
`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", writerScript, pathToFileURL(join(process.cwd(), "src", "session-rotation-files.ts")).href, sc.directory], { stdio: "ignore" });
  const closed = new Promise<void>((resolve) => child.on("close", () => resolve()));
  await sleep(150);
  expectResult(await commitRotationRecovery(plan, deps(sc)), "written", "consumed", "during the other writer");
  await closed;
  assert.equal(recordOf(sc)?.session_id, "new-sess");
  const turn = readTurn(sc.directory);
  assert.ok(turn !== null, "the turn file is still whole");
  assert.equal(turn.rotation_marker_id, null);
  assert.notEqual(readFileSync(join(sc.directory, "turn.json"), "utf8"), before, "the other writer did write");
  const quiet = scenario();
  const quietPlan = await planFor(quiet);
  const quietBefore = readFileSync(join(quiet.directory, "turn.json"), "utf8");
  await commitRotationRecovery(quietPlan, deps(quiet));
  assert.equal(readFileSync(join(quiet.directory, "turn.json"), "utf8"), quietBefore, "the commit leaves the turn file's bytes alone");
});

test("T12(g)(h): a plan with no turn writes no record (and a claim-route plan then consumes nothing); the marker route writes no record and consumes", async () => {
  const noTurn = scenario();
  const plan = await planFor(noTurn);
  expectResult(await commitRotationRecovery({ ...plan, turn: null }, deps(noTurn)), "skipped", "skipped", "(g)");
  assert.equal(noTurn.fake.consumeCalls, 0);
  const marker = scenario({ claim: false });
  const markerPlan = await planFor(marker, "clear");
  assert.equal(markerPlan.via, "marker");
  expectResult(await commitRotationRecovery(markerPlan, deps(marker)), "skipped", "consumed", "(h)");
  assert.deepEqual(recordFiles(marker), []);
  const markerNoTurn = scenario({ claim: false });
  const mp = await planFor(markerNoTurn, "clear");
  expectResult(await commitRotationRecovery({ ...mp, turn: null }, deps(markerNoTurn)), "skipped", "consumed", "marker route does not need the turn");
});

// ---------- T13, T14: stopped at every point ----------
test("T13: a stop at any point never leaves a claim-route bundle consumed with no record; the marker route keeps its own states", async () => {
  // (a) P1: stopped after the output and before the record - the commit never ran.
  const p1 = scenario();
  await planFor(p1);
  assert.equal(p1.fake.consumed, false);
  assert.deepEqual(recordFiles(p1), []);
  assertNoConsumedWithoutRecord(p1, "P1");
  // (b) P2: the record is there, the consume was not issued (the store cannot be opened at all).
  const p2 = scenario({ store: { openFails: true } });
  await commitRotationRecovery(await planFor(p2), deps(p2));
  assert.equal(recordFiles(p2).length, 1);
  assert.equal(p2.fake.consumed, false);
  assertNoConsumedWithoutRecord(p2, "P2");
  // (c) P3: after the consume was issued - the record is there whichever way the update ended.
  for (const store of [{ lostResponse: true }, { failConsume: true }, { hangConsume: true }] as FakeOptions[]) {
    const p3 = scenario({ store });
    await commitRotationRecovery(await planFor(p3), deps(p3, { elapsed: 6_800 - 300 }));
    assert.equal(recordFiles(p3).length, 1);
    assertNoConsumedWithoutRecord(p3, "P3");
  }
  // (d)(e) the record cannot be written / the plan has no turn: nothing is consumed.
  const failedRecord = scenario();
  await commitRotationRecovery(await planFor(failedRecord), deps(failedRecord, { write_record: () => { throw new Error("link then fsync"); } }));
  assert.equal(failedRecord.fake.consumeCalls, 0);
  assertNoConsumedWithoutRecord(failedRecord, "(d)");
  const noTurn = scenario();
  await commitRotationRecovery({ ...(await planFor(noTurn)), turn: null }, deps(noTurn));
  assert.equal(noTurn.fake.consumeCalls, 0);
  assertNoConsumedWithoutRecord(noTurn, "(e)");
  // (f) marker route: no record is ever made; before the consume the bundle is active, after it the state is not asserted.
  const f = scenario({ claim: false });
  const plan = await planFor(f, "clear");
  assert.deepEqual(recordFiles(f), []);
  assert.equal(f.fake.consumed, false);
  await commitRotationRecovery(plan, deps(f));
  assert.deepEqual(recordFiles(f), []);
});

test("T14: after a stop before the record, a /clear takes the same bundle again, consumes it once and makes no record; an expired bundle is not returned", async () => {
  const sc = scenario();
  await planFor(sc, "startup");
  const clear = await prepare(sc, "claude_code", "clear", "recovery-sess");
  assert.ok(clear, "(a) the same bundle is read again");
  assert.equal(clear.commit.via, "marker");
  expectResult(await commitRotationRecovery(clear.commit, deps(sc)), "skipped", "consumed", "(a)");
  assert.deepEqual(recordFiles(sc), [], "(a) no record");
  assert.equal(await prepare(sc, "claude_code", "clear", "again"), null, "(d) it is used up, so a second /clear brings nothing");
  assert.equal(sc.fake.consumeCalls, 1, "(e) consumed at most once");
  const onDisk = JSON.parse(readFileSync(join(sc.directory, "marker.json"), "utf8")) as Record<string, unknown>;
  assert.equal(onDisk.pack_ref, "pack-1", "(f) the pack reference is in the marker file");
  const old = scenario({ claim: false });
  assert.equal(await prepare(old, "claude_code", "clear", "late", { now: new Date(NOW.getTime() + 1_900_000) }), null, "(g)");
});

// ---------- T15: names ----------
test("T15(a)(e): the record has one schema name and no 'delivered/received/delivery' anywhere in what it persists; the end value has one definition", () => {
  assert.equal(ROTATION_OUTPUT_WRITTEN_SCHEMA, "kusabi-rotation-output-written/v1");
  assert.ok(!/delivered|received|delivery/.test(ROTATION_OUTPUT_WRITTEN_SCHEMA));
  const sources = readdirSync(join(process.cwd(), "src")).filter((name) => name.endsWith(".ts") && !name.startsWith("test-"));
  const defining = sources.filter((name) => readFileSync(join(process.cwd(), "src", name), "utf8").includes('"output_written_receipt_unobserved"'));
  assert.deepEqual(defining, ["rotation-watcher-store.ts"], "the value is written once; claim, ledger and tick share the constant");
  const commitText = readFileSync(join(process.cwd(), "src", "rotation-commit.ts"), "utf8");
  assert.ok(!/delivered|received/.test(commitText), "the commit module names only what it observes");
});

// ---------- the shared answer-and-commit step, as a unit ----------
test("answerHookAndCommit: no plan means no commit; a failed stdout means no commit; the result says whether the output was written", async () => {
  const events: string[] = [];
  const io = (fail: boolean) => ({
    write_evidence: (_line: string, done: (error?: Error | null) => void) => { events.push("evidence"); done(); },
    write_output: (_line: string, done: (error?: Error | null) => void) => { events.push("output"); done(fail ? new Error("EPIPE") : undefined); },
    clock: () => 1_100,
    now: () => NOW,
  });
  const sc = scenario();
  const plan = await planFor(sc);
  const none = await answerHookAndCommit({ ...io(false), open_store: sc.fake.open_store }, { evidence: {}, output: {} }, 1_000, HOOK_MS);
  assert.deepEqual(none, { output_written: true, commit: null });
  const broken = await answerHookAndCommit({ ...io(true), open_store: sc.fake.open_store }, { evidence: {}, output: {}, rotation_commit: plan }, 1_000, HOOK_MS);
  assert.deepEqual(broken, { output_written: false, commit: null });
  assert.equal(sc.fake.consumeCalls, 0);
  const good = await answerHookAndCommit({ ...io(false), open_store: sc.fake.open_store }, { evidence: {}, output: {}, rotation_commit: plan }, 1_000, HOOK_MS);
  assert.deepEqual(good, { output_written: true, commit: { record: "written", consume: "consumed" } });
  assert.equal(CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS * 1_000, HOOK_MS);
  assert.equal(CODEX_SESSION_START_HOOK_TIMEOUT_SECONDS * 1_000, HOOK_MS);
});

test("source: the commit module takes time and clocks as arguments (S4) and the read step never consumes", () => {
  const commit = readFileSync(join(process.cwd(), "src", "rotation-commit.ts"), "utf8");
  for (const word of ["Date.now", "new Date()", "Math.random", "randomUUID", "performance.now"]) assert.ok(!commit.includes(word), `${word} in rotation-commit.ts`);
  const start = readFileSync(join(process.cwd(), "src", "session-rotation-start.ts"), "utf8");
  assert.ok(!start.includes("consumeSelectedRestartPack"), "the read step has no consume call");
});

// ---------- the edges of the commit and of the record (line coverage 100%) ----------
test("commit edges: a close that fails changes nothing; a clock that throws gives 'failed' and nothing is consumed", async () => {
  const closing = scenario({ store: { failClose: true } });
  expectResult(await commitRotationRecovery(await planFor(closing), deps(closing)), "written", "consumed", "a failing close");
  await sleep(30);
  assert.equal(closing.fake.closed, 1);
  const clock = scenario();
  const plan = await planFor(clock);
  expectResult(await commitRotationRecovery(plan, deps(clock, { elapsed_ms: () => { throw new Error("clock"); } })), "failed", "skipped", "a throwing clock");
  assert.equal(clock.fake.consumeCalls, 0);
});

test("record edges: a record that is damaged, of another marker, or of the wrong type is no record", async () => {
  const sc = scenario();
  const plan = await planFor(sc);
  await commitRotationRecovery(plan, deps(sc));
  const path = outputWrittenPath(sc.directory, sc.marker.marker_id);
  const good = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  assert.ok(readOutputWritten(sc.directory, sc.marker.marker_id), "the untouched record reads");
  assert.equal(readOutputWritten(sc.directory, "not-a-marker-id"), null, "a spelling that is not a marker id");
  assert.equal(readOutputWritten(sc.directory, "e".repeat(64)), null, "no such record");
  const variants: Array<Record<string, unknown>> = [
    { schema_version: "kusabi-rotation-output-written/v0" },
    { marker_id: "e".repeat(64) },
    { session_id: null }, { source: 3 }, { agent_id: "" }, { output_written_at: undefined },
    { pane_id: 7 }, { tmux_socket: 7 }, { host_started_at: 7 }, { host_pid: 1.5 }, { host_pid: "1" },
  ];
  for (const over of variants) {
    writeFileSync(path, JSON.stringify({ ...good, ...over }));
    assert.equal(readOutputWritten(sc.directory, sc.marker.marker_id), null, JSON.stringify(over));
  }
  writeFileSync(path, JSON.stringify({ ...good, pane_id: null, tmux_socket: null, host_started_at: null, host_pid: null }));
  assert.ok(readOutputWritten(sc.directory, sc.marker.marker_id), "unknown identity values are allowed (null)");
  writeFileSync(path, "{ not json");
  assert.equal(readOutputWritten(sc.directory, sc.marker.marker_id), null, "damaged text");
});

test("record edges: a link that fails for a reason other than 'exists' is an error, leaves no temp, and the commit says 'failed'", async () => {
  const sc = scenario();
  const plan = await planFor(sc);
  const original = fs.linkSync;
  fs.linkSync = (() => { throw Object.assign(new Error("not permitted"), { code: "EPERM" }); }) as typeof fs.linkSync;
  syncBuiltinESMExports();
  try {
    expectResult(await commitRotationRecovery(plan, deps(sc)), "failed", "skipped", "link not permitted");
  } finally {
    fs.linkSync = original;
    syncBuiltinESMExports();
  }
  assert.deepEqual(recordFiles(sc), [], "no record and no temp file");
  assert.equal(sc.fake.consumeCalls, 0);
  expectResult(await commitRotationRecovery(plan, deps(sc)), "written", "consumed", "and the next attempt works");
});

test("read edges: a store that fails while the bundle is read is an ordinary start - the turn is still written, nothing is consumed", async () => {
  const sc = scenario();
  const broken = { ...sc.fake.store, getSelectedRestartPack: async () => { throw new Error("read failed"); } } as unknown as Store;
  const block = await prepareRotationRecovery(
    broken, { agent_id: "kusabi", project: "agent-memory", host: "claude_code", session_id: "new-sess", source: "startup" },
    { now: () => NOW, env: {}, identity: PANE, rotation_root: sc.rotationRoot },
  );
  assert.equal(block, null);
  assert.equal(readTurn(sc.directory)?.session_id, "new-sess");
  assert.equal(sc.fake.consumeCalls, 0);
});

test("Codex process edges: an argument that is not accepted gives the degraded answer, no commit, and one exit", async () => {
  const sc = scenario({ host: "codex" });
  const out: string[] = [];
  let exits = 0;
  await runCodexSessionStartProcess({
    argv: ["--bogus"], env: {}, read_input: async () => "{}",
    write_evidence: (_line, done) => done(), write_output: (line, done) => { out.push(line); done(); },
    exit: () => { exits += 1; }, emit_runtime_event: async () => undefined, clock: () => 1, now: () => NOW,
    open_store: sc.fake.open_store,
  });
  assert.equal(exits, 1);
  assert.ok(out[0]!.includes("IDENTITY_BINDING_INVALID"));
  assert.equal(sc.fake.consumeCalls, 0);
  assert.deepEqual(recordFiles(sc), []);
});

// ---------- the real commands, end to end ----------
/** Runs a little script against the JSON store of the given environment, in its own process (the store reads its folder when it is loaded). */
function storeScript(env: NodeJS.ProcessEnv, code: string): string {
  const ran = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8", env, cwd: process.cwd() });
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout.trim().split("\n").at(-1) ?? "";
}
const STORE_URL_JS = JSON.stringify(pathToFileURL(join(process.cwd(), "src", "stores", "index.ts")).href);

const COMMIT_URL_JS = JSON.stringify(pathToFileURL(join(process.cwd(), "src", "rotation-commit.ts")).href);

test("JSON store, one process: four commits at once on one bundle use it up exactly once", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "commit-order-json-")));
  mkdirSync(join(root, ".agent-memory"), { recursive: true });
  const env = { ...process.env, HOME: root, AGENT_MEMORY_HOME: join(root, ".agent-memory"), AGENT_MEMORY_DB_TYPE: "json" } as NodeJS.ProcessEnv;
  const line = storeScript(env, `
    const { createStore } = await import(${STORE_URL_JS});
    const { commitRotationRecovery } = await import(${COMMIT_URL_JS});
    const store = await createStore();
    const pack = await store.saveSelectedRestartPack({ agent_id: "kusabi", project: "agent-memory", content: "x", source: "restart_prepare" });
    const plan = { query: { agent_id: "kusabi", project: "agent-memory", pack_ref: pack.pack_ref }, directory: ${JSON.stringify(root)}, turn: null, marker_id: "e".repeat(64), via: "marker" };
    const deps = { now: () => new Date(), elapsed_ms: () => 100, hook_timeout_ms: 9000, open_store: async () => store };
    const results = await Promise.all([1, 2, 3, 4].map(() => commitRotationRecovery(plan, deps)));
    console.log(JSON.stringify(results));`);
  const results = JSON.parse(line) as Array<{ record: string; consume: string }>;
  assert.equal(results.filter((r) => r.consume === "consumed").length, 1);
  assert.equal(results.filter((r) => r.consume === "lost_race").length, 3);
  assert.ok(results.every((r) => r.record === "skipped"), "the marker route makes no record");
});

interface E2e {
  env: NodeJS.ProcessEnv;
  args: string[];
  input: string;
  packRef: string;
  directory: string;
  marker: RotationMarker;
}

function prepareE2e(host: Host): E2e {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "commit-order-e2e-")));
  const memoryHome = join(root, ".agent-memory");
  const workspace = join(root, "ws");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(memoryHome, { recursive: true });
  const { TMUX: _tmux, TMUX_PANE: _pane, ...inherited } = process.env;
  const env = { ...inherited, HOME: root, AGENT_MEMORY_HOME: memoryHome, AGENT_MEMORY_DB_TYPE: "json", TMUX_PANE: PANE.pane_id, TMUX: `${PANE.tmux_socket},1,0` } as NodeJS.ProcessEnv;
  const packRef = storeScript(env, `
    const { createStore } = await import(${STORE_URL_JS});
    const store = await createStore();
    const pack = await store.saveSelectedRestartPack({ agent_id: "kusabi", project: "agent-memory", content: ${JSON.stringify(HANDOFF)}, source: "restart_prepare" });
    await store.close();
    console.log(pack.pack_ref);`);
  const directory = seatDirectory(join(memoryHome, "rotation"), "kusabi", "agent-memory");
  mkdirSync(directory, { recursive: true });
  const marker = buildMarker({
    agent_id: "kusabi", project: "agent-memory", host, session_id: "old", ...PANE, pack_ref: packRef,
    pack_content_sha256: sha256Hex(HANDOFF), measured_tokens: 310_000, threshold_tokens: 300_000,
    saved_at: new Date(Date.now() - 120_000).toISOString(), handoff_source: "seat_text",
  });
  writeMarker(directory, marker);
  mkdirSync(join(directory, "claims"), { recursive: true });
  writeFileSync(join(directory, "claims", `${marker.marker_id}.json`),
    j({ state: "respawning", marker_id: marker.marker_id, respawn_started_at: new Date(Date.now() - 5_000).toISOString() }));
  const script = host === "claude_code" ? "claude-session-start.ts" : "codex-session-start.ts";
  const input = j({
    session_id: "new-sess", transcript_path: join(root, "none.jsonl"), cwd: workspace, hook_event_name: "SessionStart", model: "m", source: "startup",
    ...(host === "codex" ? { permission_mode: "default" } : {}),
  });
  const args = [
    "--import", "tsx", join(process.cwd(), "src", script),
    "--adapter-id", host === "claude_code" ? CLAUDE_SESSION_START_ADAPTER_ID : CODEX_SESSION_START_ADAPTER_ID,
    "--agent-id", "kusabi", "--project", "agent-memory", "--workspace", workspace, "--binding-source-ref", "fixture:commit-order",
  ];
  return { env, args, input, packRef, directory, marker };
}

function bundleState(e2e: E2e): string {
  return storeScript(e2e.env, `
    const { createStore } = await import(${STORE_URL_JS});
    const store = await createStore();
    const pack = await store.getSelectedRestartPack({ agent_id: "kusabi", project: "agent-memory", pack_ref: ${JSON.stringify(e2e.packRef)} });
    await store.close();
    console.log(pack === null ? "used_up" : "still_active");`);
}

/**
 * Runs the real command with one of its output pipes' read ends closed before it writes: the write fails with EPIPE.
 * NODE_NO_WARNINGS keeps the test loader's own start-up warning (Node writes it to the closed stderr and stops the process
 * itself) out of the way, so a stop here can only come from the command's own writes.
 */
function runWithClosedPipe(e2e: E2e, closed: "stderr" | "stdout"): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, e2e.args, { env: { ...e2e.env, NODE_NO_WARNINGS: "1" }, cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", () => undefined);
    child[closed].destroy();
    child.stdin.end(e2e.input);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("the command did not end"));
    }, 30_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout });
    });
  });
}

for (const host of HOSTS) {
  test(`${host}: the real command writes the answer, then the record, then uses the bundle up - through the default store`, async () => {
    const e2e = prepareE2e(host);
    const ran = spawnSync(process.execPath, e2e.args, { input: e2e.input, encoding: "utf8", env: e2e.env, cwd: process.cwd() });
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(ran.stdout.trim().split("\n").length, 1);
    assert.ok(ran.stdout.includes("watcher の試験を書く"), "the hand-off text is in the answer");
    const record = readOutputWritten(e2e.directory, e2e.marker.marker_id);
    assert.ok(record, "the record is there");
    assert.equal(record.session_id, "new-sess");
    assert.equal(record.host, host);
    assert.equal(bundleState(e2e), "used_up", "the bundle is used up");
  });

  test(`${host}: a real stderr pipe that is closed - the command still ends cleanly with the answer, the record and the consume (the evidence is only evidence)`, async () => {
    const e2e = prepareE2e(host);
    const ran = await runWithClosedPipe(e2e, "stderr");
    assert.notEqual(ran.stdout.trim(), "", "the answer was written");
    assert.equal(ran.stdout.trim().split("\n").length, 1, "the answer is one line");
    assert.ok(ran.stdout.includes("watcher の試験を書く"), `status ${String(ran.status)}: ${ran.stdout.slice(0, 600)}`);
    assert.equal(ran.status, 0, "an error on stderr does not stop the process");
    assert.ok(readOutputWritten(e2e.directory, e2e.marker.marker_id), "the record is there");
    assert.equal(bundleState(e2e), "used_up");
  });

  test(`${host}: a real stdout pipe that is closed - no record and no consume, the bundle stays for the next start`, async () => {
    const e2e = prepareE2e(host);
    const ran = await runWithClosedPipe(e2e, "stdout");
    assert.equal(ran.stdout, "");
    assert.equal(readOutputWritten(e2e.directory, e2e.marker.marker_id), null, "no record");
    assert.equal(bundleState(e2e), "still_active");
  });
}

let failed = 0;
for (const [name, runCase] of cases) {
  try {
    await runCase();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}\n${error instanceof Error ? error.stack : String(error)}`);
  }
}
if (failed > 0) {
  console.error(`FAIL test-handoff-commit-order (${failed}/${cases.length})`);
  process.exit(1);
}
console.log(`PASS test-handoff-commit-order (${cases.length} cases)`);
