/**
 * Session rotation, hook layer (261110-session-rotation): FR2 (threshold),
 * FR3 (block once, hand-off saved before the marker), FR4 (marker contents),
 * FR6 (next-conversation start), FR7.1 (start-of-conversation turn record).
 * Time, identity, store and transcript are injected, so every case is
 * deterministic (standard S4). Each unit has a correct case and error/edge cases.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ROTATION_CONFIRM_WAIT_SECONDS,
  ROTATION_DEFAULT_THRESHOLD_TOKENS,
  ROTATION_HANDOFF_MAX_CHARS,
  ROTATION_MARKER_TTL_SECONDS,
  ROTATION_START_MAX_BYTES,
} from "./constants.js";
import {
  CLAUDE_ROTATION_STOP_ADAPTER_ID,
  CODEX_ROTATION_STOP_ADAPTER_ID,
  ROTATION_BLOCK_REASON,
  decideRotationStop,
  extractNextStep,
  isUsableHandoff,
  parseRotationStopArgs,
  readAll,
  readTranscriptTail,
  runRotationCli,
  runSessionRotationStop,
  type RotationStopDependencies,
} from "./session-rotation-stop.js";
import {
  ROTATION_INITIAL_USER_MESSAGE,
  ROTATION_UNCERTAINTY_SENTENCE,
  composeRotationContext,
  decideRotationUse,
  prepareRotationRecovery,
  type RotationUseInput,
} from "./session-rotation-start.js";
import {
  buildMarker,
  readHookState,
  readMarker,
  readTurn,
  seatDirectory,
  sha256Hex,
  writeMarker,
} from "./session-rotation-files.js";
import type { Store } from "./stores/types.js";

const cases: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);
const j = (value: unknown) => JSON.stringify(value);

// ---------- fixtures ----------
const NOW = new Date("2026-11-11T02:00:00.000Z");
const PANE = { pane_id: "%7", tmux_socket: "/tmp/sock", host_pid: 4242, host_started_at: "Tue Nov 3 10:00:00 2026" };
const NO_PANE = { pane_id: null, tmux_socket: null, host_pid: null, host_started_at: null };
const BIG = ROTATION_DEFAULT_THRESHOLD_TOKENS + 10_000;
const usageLine = (tokens: number) =>
  j({ type: "assistant", message: { role: "assistant", model: "m", usage: { input_tokens: tokens }, content: [{ type: "tool_use", name: "t" }] } });
const textLine = (text: string) =>
  j({ type: "assistant", message: { role: "assistant", model: "m", content: [{ type: "text", text }] } });
const HANDOFF = "## 済んだこと\n実装を進めた\n## 次の 1 歩\nwatcher の試験を書く\n## まだ決まっていないこと\nなし";

interface Fake {
  store: Store;
  tasks: Array<Record<string, unknown>>;
  packs: Map<string, { content: string; consumed: boolean; input: Record<string, unknown> }>;
  closed: number;
}
function fakeStore(options: { failSave?: boolean; failConsume?: boolean; raceLost?: boolean; failClose?: boolean } = {}): Fake {
  const fake: Fake = { store: undefined as unknown as Store, tasks: [], packs: new Map(), closed: 0 };
  fake.store = {
    saveTaskState: async (input: Record<string, unknown>) => { fake.tasks.push(input); return input; },
    saveSelectedRestartPack: async (input: Record<string, unknown>) => {
      if (options.failSave) throw new Error("db down");
      const ref = `pack-${fake.packs.size + 1}`;
      fake.packs.set(ref, { content: String(input.content), consumed: false, input });
      return { pack_ref: ref, ...input };
    },
    getSelectedRestartPack: async (query: { pack_ref: string }) => {
      const pack = fake.packs.get(query.pack_ref);
      return pack && !pack.consumed ? { pack_ref: query.pack_ref, content: pack.content } : null;
    },
    consumeSelectedRestartPack: async (query: { pack_ref: string }) => {
      if (options.failConsume) throw new Error("consume failed");
      const pack = fake.packs.get(query.pack_ref);
      if (!pack || pack.consumed || options.raceLost) return null;
      pack.consumed = true;
      return { pack_ref: query.pack_ref, content: pack.content };
    },
    close: async () => {
      fake.closed += 1;
      if (options.failClose) throw new Error("close failed");
    },
  } as unknown as Store;
  return fake;
}

function seat(host: "claude_code" | "codex" = "claude_code") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rot-flow-")));
  const workspace = join(root, "ws");
  mkdirSync(workspace);
  const rotationRoot = join(root, "rotation");
  const binding = {
    agent_id: "kusabi", project: "agent-memory", workspace, binding_source_ref: "ref",
    max_tokens: 1_800, max_bytes: 8_192, timeout_ms: 7_000,
  };
  const directory = seatDirectory(rotationRoot, "kusabi", "agent-memory");
  const input = (event: "Stop" | "UserPromptSubmit", extra: Record<string, unknown> = {}, cwd = workspace) =>
    j({ cwd, hook_event_name: event, session_id: "sess-1", transcript_path: join(root, "t.jsonl"), ...extra });
  return { root, workspace, rotationRoot, binding, directory, input, host };
}
function deps(s: ReturnType<typeof seat>, lines: string[] | null, store: Fake, extra: Partial<RotationStopDependencies> = {}): RotationStopDependencies {
  return {
    now: () => NOW,
    env: {},
    identity: PANE,
    rotation_root: s.rotationRoot,
    createStore: async () => store.store,
    read_transcript: () => lines === null ? { status: "unreadable", reason: "transcript_unavailable" } : { status: "ok", lines },
    ...extra,
  };
}

// ---------- FR2/FR3: pure decision ----------
test("decideRotationStop: every branch, with its priority", () => {
  const base = { event: "Stop" as const, stop_hook_active: false, measurement: { status: "measured" as const, tokens: 100 }, threshold_tokens: 100, blocked_measured_tokens: null, marker_for_session: false };
  assert.deepEqual(decideRotationStop({ ...base, event: "UserPromptSubmit" }), { action: "mark_busy" });
  assert.deepEqual(decideRotationStop({ ...base, marker_for_session: true, blocked_measured_tokens: 310_000 }), { action: "none", reason: "already_saved" });
  assert.deepEqual(decideRotationStop({ ...base, blocked_measured_tokens: 310_000, stop_hook_active: true }), { action: "save", answered: true, measured_tokens: 310_000 });
  assert.deepEqual(decideRotationStop({ ...base, blocked_measured_tokens: 310_000 }), { action: "save", answered: false, measured_tokens: 310_000 },
    "the value recorded when the block was issued is the one that is stored, even if this turn measures differently");
  assert.deepEqual(decideRotationStop({ ...base, blocked_measured_tokens: 310_000, measurement: { status: "unmeasured", reason: "no_usage_record" } }), { action: "save", answered: false, measured_tokens: 310_000 });
  assert.deepEqual(decideRotationStop({ ...base, measurement: { status: "unmeasured", reason: "no_usage_record" } }), { action: "none", reason: "unmeasured:no_usage_record" });
  assert.deepEqual(decideRotationStop({ ...base, measurement: { status: "measured", tokens: 99 } }), { action: "none", reason: "below_threshold" });
  assert.deepEqual(decideRotationStop(base), { action: "block", measured_tokens: 100 }, "the threshold itself is reached");
});

test("hand-off text: usable only with a 'next step' heading; the section is extracted up to the next heading", () => {
  assert.equal(isUsableHandoff(HANDOFF), true);
  assert.equal(isUsableHandoff("- 次の1歩: 試験"), true);
  assert.equal(isUsableHandoff("済んだこと だけ"), false);
  assert.equal(extractNextStep(HANDOFF), "watcher の試験を書く");
  assert.equal(extractNextStep("次の 1 歩：直す\n続き\n## 済んだこと\n無視"), "直す\n続き");
  assert.equal(extractNextStep("## 次の 1 歩\n\n## 済んだこと\nx"), undefined);
  assert.equal(extractNextStep("見出しなし"), undefined);
});

// ---------- FR3/FR4: Stop hook ----------
test("FR3: first Stop above the threshold blocks once, records the block, saves nothing yet, sends no key", async () => {
  const s = seat();
  const fake = fakeStore();
  const result = await runSessionRotationStop(s.input("Stop"), "claude_code", s.binding, {}, deps(s, [usageLine(BIG)], fake));
  assert.deepEqual(result.output, { decision: "block", reason: ROTATION_BLOCK_REASON });
  assert.equal(result.evidence.action, "blocked");
  assert.equal(result.evidence.measured_tokens, BIG);
  assert.equal(result.evidence.keys_sent, 0);
  assert.equal(result.evidence.external_api_calls, 0);
  assert.equal(readHookState(s.directory)?.session_id, "sess-1");
  assert.equal(readMarker(s.directory), null);
  assert.equal(fake.packs.size, 0);
});
test("FR3/FR4: the answered Stop saves the seat's hand-off to the DB first, then writes the marker that names it", async () => {
  const s = seat();
  const fake = fakeStore();
  await runSessionRotationStop(s.input("Stop"), "claude_code", s.binding, {}, deps(s, [usageLine(BIG)], fake));
  const result = await runSessionRotationStop(s.input("Stop", { stop_hook_active: true }), "claude_code", s.binding, {},
    deps(s, [usageLine(BIG), textLine(HANDOFF)], fake));
  assert.equal(result.evidence.action, "saved");
  assert.equal(result.evidence.handoff_source, "seat_text");
  assert.deepEqual(result.output, { continue: true, suppressOutput: true });
  const marker = readMarker(s.directory)!;
  assert.equal(marker.marker_id, result.evidence.marker_id);
  assert.equal(marker.session_id, "sess-1");
  assert.equal(marker.pack_content_sha256, sha256Hex(HANDOFF));
  assert.equal(marker.measured_tokens, BIG);
  assert.equal(marker.threshold_tokens, ROTATION_DEFAULT_THRESHOLD_TOKENS);
  assert.equal(marker.pane_id, "%7");
  assert.equal(fake.packs.get(marker.pack_ref)?.content, HANDOFF);
  assert.equal(fake.tasks.length, 1);
  assert.equal(fake.tasks[0].next_steps, "watcher の試験を書く");
  assert.equal(fake.tasks[0].task_id, "session-rotation-handoff:agent-memory");
  const packInput = fake.packs.get(marker.pack_ref)!.input;
  assert.equal(packInput.expires_at, new Date(NOW.getTime() + ROTATION_MARKER_TTL_SECONDS * 1_000).toISOString());
  assert.equal((packInput.metadata as Record<string, unknown>).kind, "session_rotation");
  assert.equal(fake.closed, 1, "the store is closed after use");
  assert.equal(readTurn(s.directory)?.state, "idle");
  const again = await runSessionRotationStop(s.input("Stop"), "claude_code", s.binding, {}, deps(s, [usageLine(BIG)], fake));
  assert.equal(again.evidence.reason, "already_saved", "one rotation per conversation");
});
test("FR3: hand-off from the hook input when the transcript has no text; redacted and bounded", async () => {
  const s = seat();
  const fake = fakeStore();
  await runSessionRotationStop(s.input("Stop"), "claude_code", s.binding, {}, deps(s, [usageLine(BIG)], fake));
  const long = `## 次の 1 歩\n${"あ".repeat(ROTATION_HANDOFF_MAX_CHARS + 50)}\npassword=hunter2hunter2hunter2`;
  const result = await runSessionRotationStop(s.input("Stop", { stop_hook_active: true, last_assistant_message: long }),
    "claude_code", s.binding, {}, deps(s, [usageLine(BIG)], fake));
  assert.equal(result.evidence.handoff_source, "seat_text");
  const content = [...fake.packs.values()][0].content;
  assert.match(content, /hand-off truncated/);
  assert.ok(content.length <= ROTATION_HANDOFF_MAX_CHARS + 40);
  assert.doesNotMatch(content, /hunter2hunter2hunter2/);
});
test("FR3: when the seat did not give a usable hand-off, the bundle is built from existing records and says so", async () => {
  for (const [lines, active, reason] of [
    [[usageLine(BIG), textLine("終わりました")], true, "handoff_shape_invalid"],
    [[usageLine(BIG)], true, "handoff_empty"],
    [[usageLine(BIG), textLine(HANDOFF)], false, "block_not_answered"],
  ] as const) {
    const s = seat();
    const fake = fakeStore();
    await runSessionRotationStop(s.input("Stop"), "claude_code", s.binding, {}, deps(s, [usageLine(BIG)], fake));
    const result = await runSessionRotationStop(s.input("Stop", { stop_hook_active: active }), "claude_code", s.binding, {}, deps(s, [...lines], fake));
    assert.equal(result.evidence.action, "saved", reason);
    assert.equal(result.evidence.handoff_source, "existing_records", reason);
    assert.equal(result.evidence.reason, reason);
    assert.equal(fake.tasks.length, 0, "no task state is invented");
    assert.match([...fake.packs.values()][0].content, new RegExp(reason));
    assert.equal(readMarker(s.directory)?.handoff_source, "existing_records");
  }
});
test("FR3/NFR: a store failure fails open - the seat continues, no marker is written", async () => {
  const s = seat();
  const fake = fakeStore({ failSave: true });
  await runSessionRotationStop(s.input("Stop"), "claude_code", s.binding, {}, deps(s, [usageLine(BIG)], fake));
  const result = await runSessionRotationStop(s.input("Stop", { stop_hook_active: true }), "claude_code", s.binding, {}, deps(s, [usageLine(BIG), textLine(HANDOFF)], fake));
  assert.deepEqual(result.output, { continue: true, suppressOutput: true });
  assert.equal(result.evidence.action, "failed_open");
  assert.equal(result.evidence.reason, "rotation_stop_failed");
  assert.equal(readMarker(s.directory), null);
  assert.equal(fake.closed, 1);
});
test("FR1/FR2: below the threshold, unmeasured, and a seat-specific threshold", async () => {
  const s = seat();
  const fake = fakeStore();
  const below = await runSessionRotationStop(s.input("Stop"), "claude_code", s.binding, {}, deps(s, [usageLine(1_000)], fake));
  assert.equal(below.evidence.reason, "below_threshold");
  assert.equal(below.evidence.measured_tokens, 1_000);
  assert.equal(readTurn(s.directory)?.state, "idle");
  const unreadable = await runSessionRotationStop(s.input("Stop"), "claude_code", s.binding, {}, deps(s, null, fake));
  assert.equal(unreadable.evidence.reason, "unmeasured:no_usage_record");
  assert.equal(unreadable.evidence.measured_tokens, null);
  const lower = await runSessionRotationStop(s.input("Stop"), "claude_code", s.binding, { threshold_tokens: 500 }, deps(s, [usageLine(1_000)], fake));
  assert.equal(lower.evidence.action, "blocked");
  assert.equal(lower.evidence.threshold_tokens, 500);
});
test("FR7.1: UserPromptSubmit records a busy turn with the pane identity; no other effect", async () => {
  const s = seat();
  const result = await runSessionRotationStop(s.input("UserPromptSubmit"), "claude_code", s.binding, {}, deps(s, [usageLine(BIG)], fakeStore()));
  assert.equal(result.evidence.action, "busy");
  assert.deepEqual(result.output, { continue: true, suppressOutput: true });
  const turn = readTurn(s.directory)!;
  assert.equal(turn.state, "busy");
  assert.equal(turn.pane_id, "%7");
  assert.equal(turn.at, NOW.toISOString());
  assert.equal(readHookState(s.directory), null);
});
test("the real clock is the default when no time is passed in (only the hook command reads it)", async () => {
  const s = seat();
  const before = Date.now();
  const { now: _unused, ...withoutClock } = deps(s, [usageLine(1)], fakeStore());
  await runSessionRotationStop(s.input("UserPromptSubmit"), "claude_code", s.binding, {}, withoutClock);
  const at = Date.parse(readTurn(s.directory)!.at);
  assert.ok(at >= before && at <= Date.now());
});
test("defaults: seat folder from the environment, host identity resolved, transcript read from the host folder, close errors ignored", async () => {
  const s = seat();
  const home = join(s.root, "home");
  const transcript = join(s.root, "t.jsonl");
  writeFileSync(transcript, `${usageLine(BIG)}\n`);
  const saved = process.env.CLAUDE_PROJECTS_DIR;
  process.env.CLAUDE_PROJECTS_DIR = s.root;
  try {
    const fake = fakeStore({ failClose: true });
    const { rotation_root: _r, identity: _i, read_transcript: _t, ...bare } = deps(s, null, fake);
    const env = { AGENT_MEMORY_HOME: home };
    await runSessionRotationStop(s.input("Stop"), "claude_code", s.binding, {}, { ...bare, env, ps: () => "" });
    const directory = seatDirectory(join(home, "rotation"), "kusabi", "agent-memory");
    assert.equal(readHookState(directory)?.measured_tokens, BIG, "read from the real transcript file");
    const answered = await runSessionRotationStop(s.input("Stop", { stop_hook_active: true, last_assistant_message: HANDOFF }),
      "claude_code", s.binding, {}, { ...bare, env, parent_pid: 1, ps: () => "" });
    assert.equal(answered.evidence.action, "saved", "a store that fails on close does not lose the save");
    assert.equal(readMarker(directory)?.pane_id, null, "no tmux pane in this environment");
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PROJECTS_DIR; else process.env.CLAUDE_PROJECTS_DIR = saved;
  }
  const { env: _e, ...noEnv } = deps(seat(), [usageLine(1)], fakeStore());
  const below = await runSessionRotationStop(s.input("Stop"), "claude_code", s.binding, {}, noEnv);
  assert.equal(below.evidence.reason, "below_threshold", "process environment is the default");
  const emptyProject = await runSessionRotationStop("{", "claude_code", { ...s.binding, project: "" }, {}, deps(s, [], fakeStore()));
  assert.equal(emptyProject.evidence.project, "invalid");
});
test("fail-open edges: malformed input, rotation off, invalid seat name, Codex cwd outside the workspace", async () => {
  const s = seat();
  const fake = fakeStore();
  const malformed = await runSessionRotationStop("{", "claude_code", s.binding, {}, deps(s, [], fake));
  assert.equal(malformed.evidence.reason, "malformed_input");
  assert.equal(malformed.evidence.hook_event_name, null);
  const off = await runSessionRotationStop(s.input("Stop"), "claude_code", s.binding, { off: true }, deps(s, [usageLine(BIG)], fake));
  assert.equal(off.evidence.reason, "rotation_off");
  assert.equal(existsSync(s.directory), false, "off writes nothing");
  const badName = await runSessionRotationStop(s.input("Stop"), "claude_code", { ...s.binding, agent_id: "../x" }, {}, deps(s, [], fake));
  assert.equal(badName.evidence.reason, "identity_binding_invalid");
  const codex = await runSessionRotationStop(s.input("Stop", {}, s.root), "codex", s.binding, {}, deps(s, [], fake));
  assert.equal(codex.evidence.reason, "identity_binding_invalid");
  const claudeAfterCd = await runSessionRotationStop(s.input("Stop", {}, s.root), "claude_code", s.binding, {}, deps(s, [usageLine(1)], fake));
  assert.equal(claudeAfterCd.evidence.reason, "below_threshold", "Claude identity does not use the hook cwd (FR8 R1)");
  const noBinding = await runSessionRotationStop(s.input("Stop"), "claude_code", { ...s.binding, agent_id: "" }, {}, deps(s, [], fake));
  assert.equal(noBinding.evidence.agent_id, "invalid");
});
test("Codex hand-off and usage come from the Codex rollout shapes", async () => {
  const s = seat("codex");
  const fake = fakeStore();
  const count = (n: number) => j({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: n }, model_context_window: 1_000_000 } } });
  await runSessionRotationStop(s.input("Stop"), "codex", s.binding, {}, deps(s, [count(BIG)], fake));
  const message = j({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: HANDOFF }] } });
  const result = await runSessionRotationStop(s.input("Stop", { stop_hook_active: true }), "codex", s.binding, {}, deps(s, [count(BIG), message], fake));
  assert.equal(result.evidence.handoff_source, "seat_text");
  assert.equal(readMarker(s.directory)?.host, "codex");
});

test("readTranscriptTail: reads inside the host root; refuses a file outside it or a missing file", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rot-tail-")));
  const inside = join(root, "p", "s.jsonl");
  mkdirSync(join(root, "p"));
  writeFileSync(inside, "a\nb\n");
  const outside = join(realpathSync(mkdtempSync(join(tmpdir(), "rot-tail-out-"))), "s.jsonl");
  writeFileSync(outside, "c\n");
  const saved = { c: process.env.CLAUDE_PROJECTS_DIR, x: process.env.CODEX_SESSIONS_DIR };
  try {
    process.env.CLAUDE_PROJECTS_DIR = root;
    process.env.CODEX_SESSIONS_DIR = root;
    assert.deepEqual(readTranscriptTail("claude_code", inside), { status: "ok", lines: ["a", "b", ""] });
    assert.equal(readTranscriptTail("codex", inside).status, "ok");
    assert.deepEqual(readTranscriptTail("claude_code", outside), { status: "unreadable", reason: "transcript_outside_host_root" });
    assert.equal(readTranscriptTail("claude_code", join(root, "missing.jsonl")).status, "unreadable");
    process.env.CLAUDE_PROJECTS_DIR = join(root, "no-such-root");
    assert.deepEqual(readTranscriptTail("claude_code", inside), { status: "unreadable", reason: "transcript_root_unavailable" });
  } finally {
    if (saved.c === undefined) delete process.env.CLAUDE_PROJECTS_DIR; else process.env.CLAUDE_PROJECTS_DIR = saved.c;
    if (saved.x === undefined) delete process.env.CODEX_SESSIONS_DIR; else process.env.CODEX_SESSIONS_DIR = saved.x;
  }
});

test("process: the hook command run as a file reads standard input, passes on a failure, and importing it runs nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "rotation-stop-process-"));
  const entry = join(process.cwd(), "src", "session-rotation-stop.ts");
  const env = { ...process.env, AGENT_MEMORY_HOME: join(home, "agent-home"), AGENT_MEMORY_AGENT_ID: "kusabi", AGENT_MEMORY_PROJECT: "agent-memory" };
  const args = ["--adapter-id", CLAUDE_ROTATION_STOP_ADAPTER_ID, "--agent-id", "kusabi", "--project", "agent-memory", "--workspace", home,
    "--binding-source-ref", "ref", "--max-tokens", "1800", "--max-bytes", "8192", "--timeout-ms", "7000"];
  const run = spawnSync(process.execPath, ["--import", "tsx", entry, ...args], { encoding: "utf8", env, input: "not json" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { continue: true, suppressOutput: true }, "standard input was read, found unusable, and the hook passed");
  const evidence = JSON.parse(run.stderr.split("\n").filter((line) => line.startsWith("{"))[0] ?? "{}") as { reason: string; agent_id: string };
  assert.equal(evidence.reason, "malformed_input");
  assert.equal(evidence.agent_id, "kusabi");
  const badArgs = spawnSync(process.execPath, ["--import", "tsx", entry, "--adapter-id", "nope"], { encoding: "utf8", env, input: "{}" });
  assert.equal(badArgs.status, 0, badArgs.stderr);
  assert.deepEqual(JSON.parse(badArgs.stdout), { continue: true, suppressOutput: true });
  const importScript = `import(${JSON.stringify(`file://${entry}`)})`;
  const notAFile = spawnSync(process.execPath, ["--import", "tsx", "-e", importScript, join(home, "not-a-file")], { encoding: "utf8", env });
  assert.equal(notAFile.status, 0, notAFile.stderr);
  assert.equal(notAFile.stdout, "", "an entry path that cannot be resolved is not the entry file");
  const noArgument = spawnSync(process.execPath, ["--import", "tsx", "-e", importScript], { encoding: "utf8", env });
  assert.equal(noArgument.status, 0, noArgument.stderr);
  assert.equal(noArgument.stdout, "");
});

test("parseRotationStopArgs: adapter ids, threshold and off; bad values are rejected", () => {
  const common = ["--agent-id", "a", "--project", "p", "--workspace", "/w", "--binding-source-ref", "ref", "--max-tokens", "1800", "--max-bytes", "8192", "--timeout-ms", "7000"];
  const claude = parseRotationStopArgs(["--adapter-id", CLAUDE_ROTATION_STOP_ADAPTER_ID, ...common, "--rotation-threshold-tokens", "123"], {});
  assert.equal(claude.host, "claude_code");
  assert.equal(claude.options.threshold_tokens, 123);
  assert.equal(claude.binding.agent_id, "a");
  const codex = parseRotationStopArgs(["--adapter-id", CODEX_ROTATION_STOP_ADAPTER_ID, ...common, "--rotation", "off"], {});
  assert.equal(codex.host, "codex");
  assert.equal(codex.options.off, true);
  for (const bad of [["--rotation-threshold-tokens", "0"], ["--rotation-threshold-tokens", "x"], ["--rotation", "on"]]) {
    assert.throws(() => parseRotationStopArgs(["--adapter-id", CLAUDE_ROTATION_STOP_ADAPTER_ID, ...common, ...bad], {}));
  }
  assert.throws(() => parseRotationStopArgs(["--adapter-id", "other", ...common], {}), /unsupported adapter id/);
});

test("hook command: arguments and standard input in, evidence on stderr, hook output on stdout; any failure still passes", async () => {
  assert.equal(await readAll(Readable.from([Buffer.from("ab"), "cd"])), "abcd");
  const s = seat();
  const fake = fakeStore();
  const run = async (argv: string[], input: string, env: NodeJS.ProcessEnv = {}) => {
    const written = { evidence: "", output: "" };
    await runRotationCli({
      argv, env, read_input: async () => input,
      write_evidence: (line) => { written.evidence += line; },
      write_output: (line) => { written.output += line; },
      dependencies: deps(s, [usageLine(BIG)], fake),
    });
    return written;
  };
  const args = ["--adapter-id", CLAUDE_ROTATION_STOP_ADAPTER_ID, "--agent-id", "kusabi", "--project", "agent-memory", "--workspace", s.workspace,
    "--binding-source-ref", "ref", "--max-tokens", "1800", "--max-bytes", "8192", "--timeout-ms", "7000"];
  const ok = await run(args, s.input("Stop"));
  assert.deepEqual(JSON.parse(ok.output), { decision: "block", reason: ROTATION_BLOCK_REASON });
  assert.equal(JSON.parse(ok.evidence).action, "blocked");
  assert.ok(ok.evidence.endsWith("\n") && ok.output.endsWith("\n"));
  const badArgs = await run(["--adapter-id", "nope"], s.input("Stop"), { AGENT_MEMORY_AGENT_ID: "kusabi", AGENT_MEMORY_PROJECT: "agent-memory" });
  assert.deepEqual(JSON.parse(badArgs.output), { continue: true, suppressOutput: true });
  const failure = JSON.parse(badArgs.evidence);
  assert.equal(failure.reason, "malformed_input");
  assert.equal(failure.agent_id, "kusabi", "fallback binding is taken from the environment");
  const unreadable = await runRotationCli({
    argv: args, env: {}, read_input: async () => { throw new Error("stdin closed"); },
    write_evidence: () => undefined, write_output: (line) => { assert.match(line, /continue/); },
  });
  assert.equal(unreadable, undefined);
  const noEnv = await run(["--adapter-id", "nope"], "{}");
  assert.equal(JSON.parse(noEnv.evidence).agent_id, "invalid");
});

// ---------- FR6: next-conversation start ----------
const use = (over: Partial<RotationUseInput> = {}): RotationUseInput => {
  const marker = buildMarker({
    agent_id: "kusabi", project: "agent-memory", host: "claude_code", session_id: "old", ...PANE,
    pack_ref: "pack-1", pack_content_sha256: sha256Hex(HANDOFF), measured_tokens: BIG, threshold_tokens: 300_000,
    saved_at: new Date(NOW.getTime() - 120_000).toISOString(), handoff_source: "seat_text",
  });
  return {
    source: "startup", host: "claude_code", agent_id: "kusabi", project: "agent-memory", marker,
    claim: { state: "respawning", marker_id: marker.marker_id, respawn_started_at: new Date(NOW.getTime() - 5_000).toISOString() },
    identity: PANE, now_ms: NOW.getTime(), ...over,
  };
};
test("decideRotationUse: only a fresh marker for this seat, ordered by the watcher, in the same pane, is used at startup", () => {
  assert.deepEqual(decideRotationUse(use()), { use: true, via: "claim" });
  const marker = use().marker!;
  const no = (over: Partial<RotationUseInput>, reason: string) => assert.deepEqual(decideRotationUse(use(over)), { use: false, reason }, reason);
  no({ marker: null }, "no_marker");
  no({ agent_id: "other" }, "marker_for_other_seat");
  no({ project: "other" }, "marker_for_other_seat");
  no({ host: "codex" }, "marker_for_other_seat");
  no({ source: "resume" }, "resume_is_ordinary");
  no({ now_ms: NOW.getTime() + (ROTATION_MARKER_TTL_SECONDS + 200) * 1_000 }, "marker_stale");
  no({ now_ms: NOW.getTime() - 600_000 }, "marker_stale");
  no({ marker: { ...marker, saved_at: "not a date" } }, "marker_stale");
  no({ claim: null }, "startup_not_ordered");
  no({ claim: { state: "claimed", marker_id: marker.marker_id, respawn_started_at: null } }, "startup_not_ordered");
  for (const respawn of [null, "bad", new Date(NOW.getTime() + 5_000).toISOString(),
    new Date(NOW.getTime() - (ROTATION_CONFIRM_WAIT_SECONDS + 5) * 1_000).toISOString()]) {
    no({ claim: { state: "respawning", marker_id: marker.marker_id, respawn_started_at: respawn } }, "startup_outside_confirm_window");
  }
  no({ identity: { ...PANE, pane_id: "%8" } }, "startup_pane_mismatch");
  no({ identity: { ...PANE, tmux_socket: "/other" } }, "startup_pane_mismatch");
  no({ identity: NO_PANE }, "startup_pane_mismatch");
  no({ marker: { ...marker, pane_id: null } }, "startup_pane_mismatch");
});
test("decideRotationUse: /clear and compact starts use the marker unless the pane is a different one", () => {
  for (const source of ["clear", "compact"] as const) {
    assert.deepEqual(decideRotationUse(use({ source, claim: null })), { use: true, via: "marker" });
    assert.deepEqual(decideRotationUse(use({ source, claim: null, identity: NO_PANE })), { use: true, via: "marker" });
    assert.deepEqual(decideRotationUse(use({ source, claim: null, identity: { ...PANE, pane_id: "%9" } })), { use: false, reason: "pane_mismatch" });
  }
});

test("FR6.4 composeRotationContext: the block leads and the whole text stays within the caps", () => {
  const block = { text: "BLOCK", initial_user_message: ROTATION_INITIAL_USER_MESSAGE, marker_id: "m" };
  const small = composeRotationContext(block, "ordinary");
  assert.equal(small.text, "BLOCK\n\nordinary");
  assert.equal(small.evidence.truncated, false);
  assert.equal(small.evidence.marker_id, "m");
  const huge = composeRotationContext({ ...block, text: "あ".repeat(60_000) }, "ordinary");
  assert.equal(huge.evidence.truncated, true);
  assert.ok(huge.evidence.byte_count <= ROTATION_START_MAX_BYTES);
  assert.ok(huge.text.endsWith("ordinary"));
  assert.match(huge.text, /rotation cap applied/);
  assert.doesNotMatch(huge.text, /�/, "no cut inside a character");
  const wide = composeRotationContext({ ...block, text: "a".repeat(100_000) }, "o");
  assert.equal(wide.evidence.truncated, true, "token cap");
  assert.ok(wide.evidence.token_estimate <= wide.evidence.token_cap + 10);
  const roomless = composeRotationContext(block, "x".repeat(ROTATION_START_MAX_BYTES + 10));
  assert.ok(roomless.text.startsWith("\n…(rotation cap applied)"));
});

async function startScenario(over: { claim?: boolean; store?: Fake; source?: "startup" | "resume" | "clear" | "compact"; sha?: string; savedAgo?: number } = {}) {
  const s = seat();
  const fake = over.store ?? fakeStore();
  fake.packs.set("pack-1", { content: HANDOFF, consumed: false, input: {} });
  const marker = buildMarker({
    agent_id: "kusabi", project: "agent-memory", host: "claude_code", session_id: "old", ...PANE,
    pack_ref: "pack-1", pack_content_sha256: over.sha ?? sha256Hex(HANDOFF), measured_tokens: BIG, threshold_tokens: 300_000,
    saved_at: new Date(NOW.getTime() - (over.savedAgo ?? 120) * 1_000).toISOString(), handoff_source: "seat_text",
  });
  writeMarker(s.directory, marker);
  if (over.claim !== false) {
    mkdirSync(join(s.directory, "claims"), { recursive: true });
    writeFileSync(join(s.directory, "claims", `${marker.marker_id}.json`),
      j({ state: "respawning", marker_id: marker.marker_id, respawn_started_at: new Date(NOW.getTime() - 5_000).toISOString() }));
  }
  const run = (extra: Record<string, unknown> = {}) => prepareRotationRecovery(
    fake.store,
    { agent_id: "kusabi", project: "agent-memory", host: "claude_code", session_id: "new-sess", source: over.source ?? "startup" },
    { now: () => NOW, env: {}, identity: PANE, rotation_root: s.rotationRoot, ...extra },
  );
  return { s, fake, marker, run };
}
test("FR6: an ordered startup takes the one-time hand-off, leads with the seat's own text, and records the started turn", async () => {
  const { s, fake, marker, run } = await startScenario();
  const block = await run();
  assert.ok(block);
  assert.equal(block.marker_id, marker.marker_id);
  assert.equal(block.initial_user_message, ROTATION_INITIAL_USER_MESSAGE);
  assert.match(block.text, /watcher の試験を書く/);
  assert.match(block.text, new RegExp(marker.marker_id));
  assert.ok(block.text.includes(ROTATION_UNCERTAINTY_SENTENCE), "uncertainty sentence names where to look");
  assert.equal(fake.packs.get("pack-1")?.consumed, true);
  const turn = readTurn(s.directory)!;
  assert.equal(turn.state, "started");
  assert.equal(turn.source, "startup");
  assert.equal(turn.session_id, "new-sess");
  assert.equal(turn.rotation_marker_id, marker.marker_id);
  assert.equal(await run(), null, "the bundle is consumed once");
});
test("FR6: /clear takes the marker without a claim; the started turn then carries no marker id", async () => {
  const { s, run } = await startScenario({ source: "clear", claim: false });
  assert.ok(await run());
  assert.equal(readTurn(s.directory)?.rotation_marker_id, null);
});
test("FR6 edges: no order, resume, stale marker, other pane, changed bundle, lost race and store errors are ordinary starts", async () => {
  const noOrder = await startScenario({ claim: false });
  assert.equal(await noOrder.run(), null);
  assert.equal(readTurn(noOrder.s.directory)?.state, "started", "the turn is still recorded");
  assert.equal(noOrder.fake.packs.get("pack-1")?.consumed, false);
  assert.equal(await (await startScenario({ source: "resume" })).run(), null);
  assert.equal(await (await startScenario({ savedAgo: ROTATION_MARKER_TTL_SECONDS + 100 })).run(), null);
  assert.equal(await (await startScenario()).run({ identity: { ...PANE, pane_id: "%99" } }), null);
  assert.equal(await (await startScenario({ sha: sha256Hex("changed") })).run(), null, "bundle digest differs from the marker");
  const raced = await startScenario({ store: fakeStore({ raceLost: true }) });
  assert.equal(await raced.run(), null);
  const failing = await startScenario({ store: fakeStore({ failConsume: true }) });
  assert.equal(await failing.run(), null);
  assert.equal(readTurn(failing.s.directory)?.state, "started");
  const missing = await startScenario();
  missing.fake.packs.clear();
  assert.equal(await missing.run(), null);
});
test("FR6/FR7.1 edges: an invalid seat name or unwritable turn file never blocks the start", async () => {
  const fake = fakeStore();
  assert.equal(await prepareRotationRecovery(fake.store,
    { agent_id: "../x", project: "p", host: "claude_code", session_id: "s", source: "startup" }, { env: {}, identity: PANE }), null);
  const s = seat();
  mkdirSync(s.rotationRoot, { recursive: true });
  writeFileSync(join(s.rotationRoot, "kusabi"), "a file where the seat folder should be");
  assert.equal(await prepareRotationRecovery(fake.store,
    { agent_id: "kusabi", project: "agent-memory", host: "claude_code", session_id: "s", source: "startup" },
    { now: () => NOW, env: {}, identity: PANE, rotation_root: s.rotationRoot }), null);
  const viaEnv = await prepareRotationRecovery(fake.store,
    { agent_id: "kusabi", project: "agent-memory", host: "claude_code", session_id: "s", source: "startup" },
    { env: { AGENT_MEMORY_HOME: join(s.root, "home") }, parent_pid: process.pid, ps: () => "Tue Nov 3 10:00:00 2026", rotation_root: undefined });
  assert.equal(viaEnv, null);
  assert.equal(readTurn(seatDirectory(join(s.root, "home", "rotation"), "kusabi", "agent-memory"))?.state, "started");
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}\n${error instanceof Error ? error.stack : String(error)}`);
  }
}
if (failed > 0) {
  console.error(`FAIL test-session-rotation-flow (${failed}/${cases.length})`);
  process.exit(1);
}
console.log(`PASS test-session-rotation-flow (${cases.length} cases)`);
