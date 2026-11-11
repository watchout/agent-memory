/**
 * Session rotation, hook layer (261110-session-rotation): FR2 (threshold),
 * FR3 (block once, hand-off saved before the marker), FR4 (marker contents),
 * FR6 (next-conversation start), FR7.1 (start-of-conversation turn record).
 * Time, identity, store and transcript are injected, so every case is
 * deterministic (standard S4). Each unit has a correct case and error/edge cases.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ROTATION_CONFIRM_WAIT_SECONDS,
  ROTATION_DEFAULT_THRESHOLD_TOKENS,
  ROTATION_HANDOFF_MAX_CHARS,
  ROTATION_MARKER_TTL_SECONDS,
  ROTATION_START_MAX_BYTES,
  ROTATION_START_MAX_TOKENS,
  estimateTokens,
} from "./constants.js";
import { encodeClaudeProjectDir } from "./claude-transcript-identity.js";
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
  rotationDeadlineMs,
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
const withSession = (line: string, id: string): string => j({ ...(JSON.parse(line) as object), sessionId: id });
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Restores the host-folder variables a test sets, whatever the test does. */
async function withHostRoots(roots: { claude?: string; codex?: string }, run: () => Promise<void> | void): Promise<void> {
  const saved = { c: process.env.CLAUDE_PROJECTS_DIR, x: process.env.CODEX_SESSIONS_DIR };
  if (roots.claude !== undefined) process.env.CLAUDE_PROJECTS_DIR = roots.claude;
  if (roots.codex !== undefined) process.env.CODEX_SESSIONS_DIR = roots.codex;
  try {
    await run();
  } finally {
    if (saved.c === undefined) delete process.env.CLAUDE_PROJECTS_DIR; else process.env.CLAUDE_PROJECTS_DIR = saved.c;
    if (saved.x === undefined) delete process.env.CODEX_SESSIONS_DIR; else process.env.CODEX_SESSIONS_DIR = saved.x;
  }
}
const withProjectsDir = (projects: string, run: () => Promise<void> | void) => withHostRoots({ claude: projects }, run);

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

/** A Claude transcript at the place Claude Code uses: projects/<encoded workspace>/<session>.jsonl, every record carrying its session. */
function claudeTranscript(
  s: ReturnType<typeof seat>,
  lines: string[],
  options: { session?: string; dirOf?: string; name?: string } = {},
): { projects: string; path: string } {
  const projects = join(s.root, "projects");
  const dir = join(projects, encodeClaudeProjectDir(options.dirOf ?? s.workspace));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${options.name ?? "sess-1"}.jsonl`);
  writeFileSync(path, `${lines.map((line) => withSession(line, options.session ?? "sess-1")).join("\n")}\n`);
  return { projects, path };
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
// ---------- NFR1 / audit F1: the hook's own deadline ----------
async function blockedOnce(timeoutMs: number) {
  const s = seat();
  const binding = { ...s.binding, timeout_ms: timeoutMs };
  const lines = [usageLine(BIG), textLine(HANDOFF)];
  const first = fakeStore();
  await runSessionRotationStop(s.input("Stop"), "claude_code", binding, {}, deps(s, [usageLine(BIG)], first));
  const answer = (store: Fake, extra: Partial<RotationStopDependencies> = {}) =>
    runSessionRotationStop(s.input("Stop", { stop_hook_active: true }), "claude_code", binding, {}, deps(s, lines, store, extra));
  return { s, answer };
}
const PASS_OUTPUT = { continue: true, suppressOutput: true };

test("NFR1: the internal deadline is the configured time, never more than 7 s (the hook's own limit is 9 s)", () => {
  assert.equal(rotationDeadlineMs(150), 150);
  assert.equal(rotationDeadlineMs(7_000), 7_000);
  assert.equal(rotationDeadlineMs(60_000), 7_000);
});
test("NFR1/F1: a store that never opens is given up at the deadline - the seat continues and no marker is written", async () => {
  const { s, answer } = await blockedOnce(150);
  const started = Date.now();
  const result = await answer(fakeStore(), { createStore: () => new Promise<Store>(() => undefined) });
  const elapsed = Date.now() - started;
  assert.deepEqual(result.output, PASS_OUTPUT);
  assert.equal(result.evidence.action, "failed_open");
  assert.equal(result.evidence.reason, "internal_deadline_exceeded");
  assert.ok(elapsed >= 100 && elapsed < 1_500, `returned after ${elapsed} ms`);
  assert.equal(readMarker(s.directory), null);
});
test("NFR1/F1: a save that finishes after the deadline leaves no marker and no turn record", async () => {
  const { s, answer } = await blockedOnce(150);
  const slow = fakeStore();
  const save = slow.store.saveSelectedRestartPack.bind(slow.store);
  slow.store.saveSelectedRestartPack = async (input) => { await wait(400); return save(input); };
  const result = await answer(slow);
  assert.equal(result.evidence.reason, "internal_deadline_exceeded");
  await wait(600);
  assert.equal(slow.packs.size, 1, "the late save did finish");
  assert.equal(readMarker(s.directory), null, "but the marker that says 'safe to cut' is never written after the deadline");
  assert.equal(readTurn(s.directory), null);
});
test("NFR1/F1: a store that opens after the deadline is closed unused", async () => {
  const { s, answer } = await blockedOnce(150);
  const late = fakeStore();
  const result = await answer(fakeStore(), { createStore: async () => { await wait(400); return late.store; } });
  assert.equal(result.evidence.reason, "internal_deadline_exceeded");
  await wait(600);
  assert.equal(late.closed, 1);
  assert.deepEqual([late.packs.size, late.tasks.length], [0, 0]);
  assert.equal(readMarker(s.directory), null);
});
test("NFR1/F1: a store that opens after the deadline and then fails to close still ends in a pass", async () => {
  const { s, answer } = await blockedOnce(150);
  const late = fakeStore({ failClose: true });
  const result = await answer(fakeStore(), { createStore: async () => { await wait(400); return late.store; } });
  assert.deepEqual(result.output, PASS_OUTPUT);
  assert.equal(result.evidence.reason, "internal_deadline_exceeded");
  await wait(600);
  assert.equal(late.closed, 1, "a close was tried, and its failure went nowhere");
  assert.equal(readMarker(s.directory), null);
});
test("NFR1/F1: a close that never returns does not undo a finished save", async () => {
  const { s, answer } = await blockedOnce(150);
  const hung = fakeStore();
  hung.store.close = () => new Promise<void>(() => undefined);
  const started = Date.now();
  const result = await answer(hung);
  const elapsed = Date.now() - started;
  assert.equal(result.evidence.action, "saved");
  assert.equal(readMarker(s.directory)?.marker_id, result.evidence.marker_id);
  assert.equal(readTurn(s.directory)?.state, "idle");
  assert.ok(elapsed < 1_500, `returned after ${elapsed} ms`);
});

// ---------- FR8 / audit F6: the hand-off may come only from this seat's own conversation ----------
test("F6: the hand-off is saved from a verified transcript of this conversation", async () => {
  const s = seat();
  const fake = fakeStore();
  const own = claudeTranscript(s, [usageLine(BIG)]);
  await withProjectsDir(own.projects, async () => {
    const { read_transcript: _t, ...real } = deps(s, null, fake);
    const base = { transcript_path: own.path };
    assert.equal((await runSessionRotationStop(s.input("Stop", base), "claude_code", s.binding, {}, real)).evidence.action, "blocked");
    claudeTranscript(s, [usageLine(BIG), textLine(HANDOFF)]);
    const result = await runSessionRotationStop(s.input("Stop", { ...base, stop_hook_active: true }), "claude_code", s.binding, {}, real);
    assert.equal(result.evidence.action, "saved");
    assert.equal(result.evidence.handoff_source, "seat_text");
    assert.equal(readMarker(s.directory)?.pack_content_sha256, sha256Hex(HANDOFF));
  });
});
test("F6: a transcript that is not this conversation's is never used - nothing is saved and no marker is written", async () => {
  const variants: Array<[string, (s: ReturnType<typeof seat>, good: string) => string, string]> = [
    ["another workspace's folder", (s) => claudeTranscript(s, [usageLine(BIG), textLine("## 次の 1 歩\n他の席の続き")], { dirOf: join(s.root, "other-ws") }).path, "projects_dir_mismatch"],
    ["another conversation's file name", (s) => claudeTranscript(s, [usageLine(BIG), textLine("## 次の 1 歩\n他の会話")], { name: "sess-9" }).path, "basename_mismatch"],
    ["a file whose records belong to another conversation", (s, good) => { claudeTranscript(s, [usageLine(BIG), textLine("## 次の 1 歩\n他の会話")], { session: "sess-9" }); return good; }, "record_session_mismatch"],
    ["a file outside the projects folder", (s) => { const p = join(s.root, "stray.jsonl"); writeFileSync(p, `${withSession(textLine("## 次の 1 歩\n外"), "sess-1")}\n`); return p; }, "path_outside_projects"],
    ["a missing file", (s) => join(s.root, "projects", "gone.jsonl"), "transcript_unavailable"],
  ];
  for (const [label, makeBad, reason] of variants) {
    const s = seat();
    const fake = fakeStore();
    const good = claudeTranscript(s, [usageLine(BIG)]);
    await withProjectsDir(good.projects, async () => {
      const { read_transcript: _t, ...real } = deps(s, null, fake);
      const blocked = await runSessionRotationStop(s.input("Stop", { transcript_path: good.path }), "claude_code", s.binding, {}, real);
      assert.equal(blocked.evidence.action, "blocked", label);
      const bad = makeBad(s, good.path);
      const result = await runSessionRotationStop(s.input("Stop", { transcript_path: bad, stop_hook_active: true }), "claude_code", s.binding, {}, real);
      assert.deepEqual(result.output, PASS_OUTPUT, label);
      assert.equal(result.evidence.action, "failed_open", label);
      assert.equal(result.evidence.reason, `transcript_unverified:${reason}`, label);
      assert.equal(readMarker(s.directory), null, label);
      assert.deepEqual([fake.packs.size, fake.tasks.length], [0, 0], `${label}: nothing from the transcript reached the store`);
    });
  }
});
test("F6: the same rule holds for a Codex rollout of another session", async () => {
  const s = seat("codex");
  const fake = fakeStore();
  const root = join(s.root, "sessions");
  mkdirSync(root);
  const count = (n: number) => j({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: n }, model_context_window: 1_000_000 } } });
  const meta = (id: string) => j({ type: "session_meta", payload: { id, cwd: s.workspace } });
  const message = j({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: HANDOFF }] } });
  const own = join(root, "own.jsonl");
  writeFileSync(own, `${[meta("sess-1"), count(BIG)].join("\n")}\n`);
  const other = join(root, "other.jsonl");
  writeFileSync(other, `${[meta("sess-9"), count(BIG), message].join("\n")}\n`);
  await withHostRoots({ codex: root }, async () => {
    const { read_transcript: _t, ...real } = deps(s, null, fake);
    assert.equal((await runSessionRotationStop(s.input("Stop", { transcript_path: own }), "codex", s.binding, {}, real)).evidence.action, "blocked");
    const refused = await runSessionRotationStop(s.input("Stop", { transcript_path: other, stop_hook_active: true }), "codex", s.binding, {}, real);
    assert.equal(refused.evidence.reason, "transcript_unverified:session_mismatch");
    assert.equal(readMarker(s.directory), null);
    assert.equal(fake.packs.size, 0);
  });
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
  const { projects, path: transcript } = claudeTranscript(s, [usageLine(BIG)]);
  await withProjectsDir(projects, async () => {
    const fake = fakeStore({ failClose: true });
    const { rotation_root: _r, identity: _i, read_transcript: _t, ...bare } = deps(s, null, fake);
    const env = { AGENT_MEMORY_HOME: home };
    await runSessionRotationStop(s.input("Stop", { transcript_path: transcript }), "claude_code", s.binding, {}, { ...bare, env, ps: () => "" });
    const directory = seatDirectory(join(home, "rotation"), "kusabi", "agent-memory");
    assert.equal(readHookState(directory)?.measured_tokens, BIG, "read from the real transcript file");
    const answered = await runSessionRotationStop(
      s.input("Stop", { stop_hook_active: true, last_assistant_message: HANDOFF, transcript_path: transcript }),
      "claude_code", s.binding, {}, { ...bare, env, parent_pid: 1, ps: () => "" });
    assert.equal(answered.evidence.action, "saved", "a store that fails on close does not lose the save");
    assert.equal(readMarker(directory)?.pane_id, null, "no tmux pane in this environment");
  });
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

test("readTranscriptTail (Claude, FR8 R1-R5): only this seat's own conversation file is read; every other place or content is refused with its reason", async () => {
  const s = seat();
  const expected = { session_id: "sess-1", workspace: s.workspace, cwd: s.workspace };
  const own = claudeTranscript(s, [usageLine(1), textLine("a")]);
  await withProjectsDir(own.projects, () => {
    const ok = readTranscriptTail("claude_code", own.path, expected);
    assert.equal(ok.status, "ok");
    assert.equal(ok.status === "ok" && ok.lines.length, 3, "two records and the trailing empty line");
    const refused = (path: string, reason: string, over: Partial<typeof expected> = {}) =>
      assert.deepEqual(readTranscriptTail("claude_code", path, { ...expected, ...over }), { status: "unreadable", reason }, reason);
    refused(join(own.projects, "..", "missing.jsonl"), "transcript_unavailable");
    refused(own.path, "basename_mismatch", { session_id: "sess-2" });
    refused(claudeTranscript(s, [usageLine(1)], { dirOf: join(s.root, "elsewhere") }).path, "projects_dir_mismatch");
    refused(claudeTranscript(s, [usageLine(1)], { name: "other" }).path, "basename_mismatch");
    refused(claudeTranscript(s, [usageLine(1)], { session: "other" }).path, "record_session_mismatch");
    const bare = join(own.projects, encodeClaudeProjectDir(s.workspace), "sess-3.jsonl");
    writeFileSync(bare, `${usageLine(1)}\n`);
    refused(bare, "record_session_missing", { session_id: "sess-3" });
    const garbage = join(own.projects, encodeClaudeProjectDir(s.workspace), "sess-4.jsonl");
    writeFileSync(garbage, "not json\n");
    refused(garbage, "parse_error", { session_id: "sess-4" });
    const outside = join(realpathSync(mkdtempSync(join(tmpdir(), "rot-tail-out-"))), "sess-1.jsonl");
    writeFileSync(outside, `${withSession(usageLine(1), "sess-1")}\n`);
    refused(outside, "path_outside_projects");
    const link = join(own.projects, encodeClaudeProjectDir(s.workspace), "sess-5.jsonl");
    symlinkSync(own.path, link);
    refused(link, "not_regular_file_or_symlink", { session_id: "sess-5" });
    const empty = join(own.projects, encodeClaudeProjectDir(s.workspace), "sess-6.jsonl");
    writeFileSync(empty, "");
    refused(empty, "transcript_unavailable", { session_id: "sess-6" });
  });
  await withProjectsDir(join(s.root, "no-such-root"), () => {
    assert.deepEqual(readTranscriptTail("claude_code", own.path, expected), { status: "unreadable", reason: "path_outside_projects" });
  });
});
test("readTranscriptTail (Codex): the rollout must be this session's, started in this workspace, and inside the sessions folder", async () => {
  const s = seat("codex");
  const expected = { session_id: "sess-1", workspace: s.workspace, cwd: s.workspace };
  const root = join(s.root, "sessions");
  mkdirSync(root);
  const meta = (id: string, cwd: string) => j({ type: "session_meta", payload: { id, cwd } });
  const rollout = (name: string, lines: string[]) => {
    const path = join(root, name);
    writeFileSync(path, `${lines.join("\n")}\n`);
    return path;
  };
  const own = rollout("own.jsonl", [meta("sess-1", s.workspace), "tail"]);
  await withHostRoots({ codex: root }, () => {
    assert.deepEqual(readTranscriptTail("codex", own, expected), { status: "ok", lines: [meta("sess-1", s.workspace), "tail", ""] });
    assert.deepEqual(readTranscriptTail("codex", rollout("other-session.jsonl", [meta("other", s.workspace)]), expected),
      { status: "unreadable", reason: "session_mismatch" });
    assert.deepEqual(readTranscriptTail("codex", rollout("other-workspace.jsonl", [meta("sess-1", s.root)]), expected),
      { status: "unreadable", reason: "session_mismatch" });
    assert.deepEqual(readTranscriptTail("codex", rollout("no-meta.jsonl", ["tail"]), expected), { status: "unreadable", reason: "session_mismatch" });
    const outside = join(realpathSync(mkdtempSync(join(tmpdir(), "rot-tail-out-"))), "s.jsonl");
    writeFileSync(outside, `${meta("sess-1", s.workspace)}\n`);
    assert.deepEqual(readTranscriptTail("codex", outside, expected), { status: "unreadable", reason: "transcript_outside_host_root" });
    assert.equal(readTranscriptTail("codex", join(root, "missing.jsonl"), expected).status, "unreadable");
  });
  await withHostRoots({ codex: join(s.root, "no-such-root") }, () => {
    assert.deepEqual(readTranscriptTail("codex", own, expected), { status: "unreadable", reason: "transcript_root_unavailable" });
  });
  assert.deepEqual(readTranscriptTail("codex", own, { ...expected, cwd: join(s.root, "gone") }).status, "unreadable", "a cwd that cannot be resolved is not verified");
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

// ---------- audit 2 F1: the one internal budget starts at the entry, before standard input is read ----------
const cliArgs = (workspace: string, timeoutMs: number) => ["--adapter-id", CLAUDE_ROTATION_STOP_ADAPTER_ID, "--agent-id", "kusabi", "--project", "agent-memory",
  "--workspace", workspace, "--binding-source-ref", "ref", "--max-tokens", "1800", "--max-bytes", "8192", "--timeout-ms", String(timeoutMs)];
async function runCli(argv: string[], readInput: () => Promise<string>, dependencies?: RotationStopDependencies) {
  const written = { evidence: "", output: "" };
  const started = Date.now();
  await runRotationCli({
    argv, env: {}, read_input: readInput,
    write_evidence: (line) => { written.evidence += line; },
    write_output: (line) => { written.output += line; },
    dependencies,
  });
  return { ...written, elapsed: Date.now() - started };
}

test("F1 (audit 2): standard input that never ends is given up at the internal deadline - a pass, with the reason, and no key sent", async () => {
  const s = seat();
  const result = await runCli(cliArgs(s.workspace, 150), () => new Promise<string>(() => undefined));
  assert.ok(result.elapsed >= 100 && result.elapsed < 1_500, `returned after ${result.elapsed} ms`);
  assert.deepEqual(JSON.parse(result.output), PASS_OUTPUT);
  const evidence = JSON.parse(result.evidence) as { action: string; reason: string; keys_sent: number; agent_id: string };
  assert.deepEqual([evidence.action, evidence.reason, evidence.keys_sent, evidence.agent_id], ["failed_open", "internal_deadline_exceeded", 0, "kusabi"]);
  assert.ok(result.evidence.endsWith("\n") && result.output.endsWith("\n"));
});

test("F1 (audit 2): input that arrives only after the deadline is not used - nothing is saved and no marker is written", async () => {
  const s = seat();
  const fake = fakeStore();
  const late = () => wait(400).then(() => s.input("Stop", { stop_hook_active: true }));
  const result = await runCli(cliArgs(s.workspace, 150), late, deps(s, [usageLine(BIG), textLine(HANDOFF)], fake));
  assert.equal(JSON.parse(result.evidence).reason, "internal_deadline_exceeded");
  await wait(600);
  assert.equal(fake.packs.size, 0);
  assert.equal(readMarker(s.directory), null);
});

test("F1 (audit 2): the time spent waiting for input comes out of the same budget (it is not a second one)", async () => {
  const s = seat();
  const never = { createStore: () => new Promise<Store>(() => undefined) };
  // The first Stop blocks once, so the next one (the seat's answer) goes on to save.
  const block = await runSessionRotationStop(s.input("Stop"), "claude_code", { ...s.binding, timeout_ms: 400 }, {}, deps(s, [usageLine(BIG)], fakeStore()));
  assert.equal(block.evidence.action, "blocked");
  // One shared budget ends near 1,000 ms; a second budget started after the read would end near 1,600 ms. The limit sits 300 ms from both.
  const answered = () => wait(600).then(() => s.input("Stop", { stop_hook_active: true }));
  const result = await runCli(cliArgs(s.workspace, 1_000), answered, deps(s, [usageLine(BIG), textLine(HANDOFF)], fakeStore(), never));
  assert.equal(JSON.parse(result.evidence).reason, "internal_deadline_exceeded");
  assert.ok(result.elapsed < 1_300, `a 600 ms read and a store that never opens took ${result.elapsed} ms against one 1,000 ms budget`);
  assert.equal(readMarker(s.directory), null);
});

test("F1 (audit 2) process: a hook whose standard input stays open ends by itself at the deadline, with the pass and the evidence", async () => {
  const home = mkdtempSync(join(tmpdir(), "rotation-stop-stalled-"));
  const entry = join(process.cwd(), "src", "session-rotation-stop.ts");
  const env = { ...process.env, AGENT_MEMORY_HOME: join(home, "agent-home") };
  const child = spawn(process.execPath, ["--import", "tsx", entry, ...cliArgs(home, 700)], { env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code))),
      new Promise<string>((resolve) => { giveUp = setTimeout(() => resolve("still running"), 20_000); }),
    ]);
    assert.equal(outcome, 0, "the hook ended by itself although its input never closed");
    assert.deepEqual(JSON.parse(stdout), PASS_OUTPUT);
    const evidence = JSON.parse(stderr.split("\n").filter((line) => line.startsWith("{"))[0] ?? "{}") as { reason: string; action: string };
    assert.deepEqual([evidence.action, evidence.reason], ["failed_open", "internal_deadline_exceeded"]);
  } finally {
    clearTimeout(giveUp);
    child.kill("SIGKILL");
  }
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
  assert.ok(wide.evidence.token_estimate <= wide.evidence.token_cap, "the truncation mark is inside the cap, no slack");
  const roomless = composeRotationContext(block, "x".repeat(ROTATION_START_MAX_BYTES + 10));
  assert.ok(roomless.text.startsWith("\n…(rotation cap applied)"));
});
test("F3 composeRotationContext: at the cap's edge the whole text - including the truncation mark - stays within both caps", () => {
  const tokenChars = ROTATION_START_MAX_TOKENS * 4;
  for (const ordinaryLength of [0, 1, 7_000, 14_400]) {
    const ordinary = "o".repeat(ordinaryLength);
    const room = tokenChars - (2 + ordinaryLength);
    for (const [char, delta] of [["a", -1], ["a", 0], ["a", 1], ["a", 25], ["a", 5_000], ["あ", -1], ["あ", 0], ["あ", 1], ["あ", 25]] as const) {
      const block = { text: char.repeat(room + delta), initial_user_message: "m", marker_id: "m" };
      const { text, evidence } = composeRotationContext(block, ordinary);
      const label = `ordinary ${ordinaryLength}, ${char} ${delta >= 0 ? "+" : ""}${delta}`;
      assert.ok(estimateTokens(text) <= ROTATION_START_MAX_TOKENS, `${label}: ${estimateTokens(text)} tokens`);
      assert.ok(Buffer.byteLength(text, "utf8") <= ROTATION_START_MAX_BYTES, `${label}: ${Buffer.byteLength(text, "utf8")} bytes`);
      assert.equal(evidence.token_estimate, estimateTokens(text), label);
      assert.equal(evidence.byte_count, Buffer.byteLength(text, "utf8"), label);
      assert.ok(text.endsWith(`\n\n${ordinary}`), label);
      assert.equal(evidence.truncated, delta > 0, `${label}: cut exactly when the block is longer than the room`);
    }
  }
});

test("F3 composeRotationContext: the byte cap binds on its own when it is the tighter one, and the mark is paid out of it", () => {
  const caps = { max_tokens: 10_000, max_bytes: 3_000 };
  for (const char of ["a", "あ"]) {
    const ordinary = "o".repeat(100);
    const { text, evidence } = composeRotationContext({ text: char.repeat(5_000), initial_user_message: "m", marker_id: "m" }, ordinary, caps);
    assert.ok(Buffer.byteLength(text, "utf8") <= caps.max_bytes, `${char}: ${Buffer.byteLength(text, "utf8")} bytes`);
    assert.equal(evidence.truncated, true, char);
    assert.equal(evidence.byte_cap, caps.max_bytes);
    assert.equal(evidence.token_cap, caps.max_tokens);
    assert.ok(text.endsWith(`\n\n${ordinary}`), char);
    assert.doesNotMatch(text, /�/, `${char}: no cut inside a character`);
  }
  const under = composeRotationContext({ text: "b".repeat(500), initial_user_message: "m", marker_id: "m" }, "o", caps);
  assert.equal(under.evidence.truncated, false);
  const overBytesOnly = composeRotationContext({ text: "あ".repeat(1_500), initial_user_message: "m", marker_id: "m" }, "o", caps);
  assert.equal(overBytesOnly.evidence.truncated, true, "1,500 characters are well under the token cap but 4,500 bytes are over the byte cap");
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
