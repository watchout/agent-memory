/**
 * Session rotation, core layer (261110-session-rotation):
 * FR1 (context measurement), FR3.2 (hand-off text), the state files shared with
 * the watcher (watcher-design.md 2.1/2.2), FR7.2 (store readiness) and FR7.3
 * (startup paths skip schema migration). Each unit has a correct case and
 * error/edge cases.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureContextTokens, extractLastAssistantText } from "./session-rotation-usage.js";
import {
  buildMarker,
  canonicalJson,
  normalizeStartedAt,
  readClaim,
  readHookState,
  readJsonFile,
  readMarker,
  readTurn,
  resolveHostIdentity,
  rotationRoot,
  runPsStartedAt,
  seatDirectory,
  sha256Hex,
  writeHookState,
  writeJsonAtomic,
  writeMarker,
  writeTurn,
} from "./session-rotation-files.js";
import { StoreNotReadyError, createStoreReadiness } from "./mcp-store-readiness.js";
import { currentUid } from "./process-uid.js";
import type { Store } from "./stores/types.js";

const cases: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);
const j = (value: unknown) => JSON.stringify(value);
const claudeLine = (usage: unknown, extra: Record<string, unknown> = {}, message: Record<string, unknown> = {}) =>
  j({ type: "assistant", message: { role: "assistant", model: "claude-opus-4-1", usage, ...message }, ...extra });
const codexCount = (input: number | undefined, window = 1_000_000) =>
  j({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: input === undefined ? {} : { input_tokens: input }, model_context_window: window } } });

// ---- FR1: measurement ----
test("FR1 claude: input + cache creation + cache read of the latest main-conversation reply", () => {
  const lines = [
    claudeLine({ input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100 }),
    claudeLine({ input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 }),
  ];
  assert.deepEqual(measureContextTokens("claude_code", lines), { status: "measured", tokens: 6 });
});
test("FR1 claude: cache fields may be absent (count as 0); sidechain, synthetic and non-assistant records are ignored", () => {
  const lines = [
    claudeLine({ input_tokens: 40 }),
    claudeLine({ input_tokens: 999_999 }, { isSidechain: true }),
    claudeLine({ input_tokens: 888_888 }, {}, { model: "<synthetic>" }),
    j({ type: "user", message: { usage: { input_tokens: 777_777 } } }),
    j({ type: "assistant", message: "not-an-object" }),
    "",
    "not json",
    j([1, 2]),
  ];
  assert.deepEqual(measureContextTokens("claude_code", lines), { status: "measured", tokens: 40 });
});
test("FR1 claude: unmeasured is explicit, and a broken newer record never falls back to an older value (S5)", () => {
  assert.deepEqual(measureContextTokens("claude_code", []), { status: "unmeasured", reason: "no_usage_record" });
  assert.deepEqual(measureContextTokens("claude_code", [j({ type: "user" })]), { status: "unmeasured", reason: "no_usage_record" });
  const broken = [claudeLine({ input_tokens: 500_000 }), claudeLine({ input_tokens: "7" })];
  assert.deepEqual(measureContextTokens("claude_code", broken), { status: "unmeasured", reason: "usage_field_missing" });
  for (const usage of [undefined, null, {}, { input_tokens: -1 }, { input_tokens: 1.5 }, { input_tokens: 1, cache_read_input_tokens: "x" },
    { input_tokens: 1, cache_creation_input_tokens: -2 }]) {
    assert.equal(measureContextTokens("claude_code", [claudeLine(usage)]).status, "unmeasured", j(usage));
  }
});
test("FR1 codex: the host-reported prompt size of the latest token_count record", () => {
  assert.deepEqual(measureContextTokens("codex", [codexCount(10), codexCount(250_000)]), { status: "measured", tokens: 250_000 });
});
test("FR1 codex: no usage record, and a record without the input field, are unmeasured", () => {
  assert.deepEqual(measureContextTokens("codex", []), { status: "unmeasured", reason: "no_usage_record" });
  assert.deepEqual(measureContextTokens("codex", [codexCount(250_000), codexCount(undefined)]), { status: "unmeasured", reason: "usage_field_missing" });
});

// ---- FR3.2: hand-off text ----
test("FR3.2 claude: last visible assistant text (string or text blocks), tool-only replies keep the earlier text", () => {
  const lines = [
    j({ type: "assistant", message: { role: "assistant", model: "m", content: "first" } }),
    j({ type: "assistant", message: { role: "assistant", model: "m", content: [{ type: "text", text: "a" }, { type: "tool_use", name: "x" }, { type: "text", text: "b" }, { type: "text", text: 7 }] } }),
    j({ type: "assistant", message: { role: "assistant", model: "m", content: [{ type: "tool_use", name: "x" }] } }),
    j({ type: "assistant", isSidechain: true, message: { role: "assistant", model: "m", content: "side" } }),
    j({ type: "assistant", message: { role: "assistant", model: "<synthetic>", content: "stub" } }),
    j({ type: "assistant", message: { role: "assistant", model: "m", content: "   " } }),
    j({ type: "assistant", message: { role: "assistant", model: "m", content: 42 } }),
    "garbage",
  ];
  assert.equal(extractLastAssistantText("claude_code", lines), "a\nb");
  assert.equal(extractLastAssistantText("claude_code", []), null);
  assert.equal(extractLastAssistantText("claude_code", [lines[5]]), null);
});
test("FR3.2 codex: output_text of an assistant message, agent_message events, nothing else", () => {
  const msg = (role: string, content: unknown) => j({ type: "response_item", payload: { type: "message", role, content } });
  const lines = [
    msg("assistant", [{ type: "output_text", text: "one" }, { type: "output_text", text: 5 }, { type: "other" }]),
    msg("user", [{ type: "output_text", text: "not mine" }]),
    j({ type: "event_msg", payload: { type: "agent_message", message: "  two  " } }),
    j({ type: "event_msg", payload: { type: "agent_message", message: "   " } }),
    j({ type: "event_msg", payload: "not-an-object" }),
    j({ type: "event_msg", payload: { type: "token_count" } }),
  ];
  assert.equal(extractLastAssistantText("codex", lines), "two");
  assert.equal(extractLastAssistantText("codex", [lines[0]]), "one");
  assert.equal(extractLastAssistantText("codex", [lines[1], lines[3], lines[4], lines[5]]), null);
  assert.equal(extractLastAssistantText("codex", [msg("assistant", [])]), null);
});

// ---- state files ----
test("files: canonical JSON sorts keys and drops undefined, so the digest is stable", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: undefined, c: "x" }], z: null }), '{"a":[2,{"c":"x"}],"b":1,"z":null}');
  assert.equal(canonicalJson("s"), '"s"');
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
test("files: rotation root follows AGENT_MEMORY_HOME, then HOME, then the OS home; seat names are validated", () => {
  assert.equal(rotationRoot({ AGENT_MEMORY_HOME: "/data/am", HOME: "/h" }), "/data/am/rotation");
  assert.equal(rotationRoot({ AGENT_MEMORY_HOME: "  ", HOME: "/h" }), "/h/.agent-memory/rotation");
  assert.match(rotationRoot({ HOME: " " }), /\/\.agent-memory\/rotation$/);
  assert.equal(seatDirectory("/r", "kusabi", "agent-memory"), "/r/kusabi/agent-memory");
  for (const bad of ["", "../x", "a/b", ".hidden", "a b"]) {
    assert.throws(() => seatDirectory("/r", bad, "p"), /rotation_seat_name_invalid/, bad);
    assert.throws(() => seatDirectory("/r", "a", bad), /rotation_seat_name_invalid/, bad);
  }
});
test("files: process start time is read with ps and normalized", () => {
  assert.equal(normalizeStartedAt("  Tue Nov  3   10:00:00 2026\n"), "Tue Nov 3 10:00:00 2026");
  assert.equal(normalizeStartedAt(" \n"), null);
  assert.notEqual(normalizeStartedAt(runPsStartedAt(process.pid)), null);
});
test("files: host identity needs a tmux pane, the tmux socket and a readable start time; otherwise null parts", () => {
  const env = { TMUX_PANE: "%7", TMUX: "/tmp/tmux-501/default,1234,0" };
  assert.deepEqual(resolveHostIdentity(env, 42, () => " Tue Nov  3 10:00:00 2026\n"),
    { pane_id: "%7", tmux_socket: "/tmp/tmux-501/default", host_pid: 42, host_started_at: "Tue Nov 3 10:00:00 2026" });
  const none = { pane_id: null, tmux_socket: null, host_pid: null, host_started_at: null };
  assert.deepEqual(resolveHostIdentity({}, 42, () => "x"), none);
  assert.deepEqual(resolveHostIdentity({ TMUX_PANE: "7", TMUX: "/s,1,0" }, 42, () => "x"), none);
  assert.deepEqual(resolveHostIdentity({ TMUX_PANE: "%7", TMUX: "" }, 42, () => "x"), none);
  assert.deepEqual(resolveHostIdentity({ TMUX_PANE: "%7", TMUX: "/tmp/tmux-501/bare" }, 42, () => "Tue Nov 3 10:00:00 2026"),
    { pane_id: "%7", tmux_socket: "/tmp/tmux-501/bare", host_pid: 42, host_started_at: "Tue Nov 3 10:00:00 2026" },
    "a TMUX value without the trailing fields is still the socket");
  assert.deepEqual(resolveHostIdentity(env, 42, () => { throw new Error("ps failed"); }),
    { pane_id: "%7", tmux_socket: "/tmp/tmux-501/default", host_pid: null, host_started_at: null });
  assert.deepEqual(resolveHostIdentity(env, 42, () => "  "),
    { pane_id: "%7", tmux_socket: "/tmp/tmux-501/default", host_pid: null, host_started_at: null });
  assert.equal(resolveHostIdentity(env, process.pid).host_pid, process.pid, "default runner uses real ps");
});

const markerFields = {
  agent_id: "kusabi", project: "agent-memory", host: "claude_code" as const, session_id: "s1",
  pane_id: "%7", tmux_socket: "/tmp/sock", host_pid: 42, host_started_at: "Tue Nov 3 10:00:00 2026",
  pack_ref: "pack-1", pack_content_sha256: sha256Hex("body"), measured_tokens: 310_000, threshold_tokens: 300_000,
  saved_at: "2026-11-11T01:00:00.000Z", handoff_source: "seat_text" as const,
};
test("files: marker id is the digest of its own fields; any change is detected on read", () => {
  const dir = mkdtempSync(join(tmpdir(), "rot-files-"));
  const marker = buildMarker(markerFields);
  assert.equal(marker.marker_id, buildMarker(markerFields).marker_id);
  assert.notEqual(marker.marker_id, buildMarker({ ...markerFields, session_id: "s2" }).marker_id);
  writeMarker(dir, marker);
  assert.deepEqual(readMarker(dir), marker);
  const path = join(dir, "marker.json");
  const raw = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, j({ ...raw, measured_tokens: 1 }));
  assert.equal(readMarker(dir), null, "tampered field");
  writeFileSync(path, j({ ...raw, marker_id: 5 }));
  assert.equal(readMarker(dir), null, "non-string id");
  writeFileSync(path, j({ ...raw, schema_version: "other/v1" }));
  assert.equal(readMarker(dir), null, "wrong schema");
  assert.equal(readMarker(join(dir, "missing")), null);
});
test("files: atomic writes are private (0700 folder, 0600 file) and leave no temp file", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "rot-files-")), "seat", "deep");
  writeJsonAtomic(join(dir, "x.json"), { a: 1 });
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(join(dir, "x.json")).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir), ["x.json"]);
  assert.deepEqual(readJsonFile(join(dir, "x.json")), { a: 1 });
});
test("files: readers return null for missing, broken or wrongly shaped files", () => {
  const dir = mkdtempSync(join(tmpdir(), "rot-files-"));
  assert.equal(readJsonFile(join(dir, "none.json")), null);
  writeFileSync(join(dir, "bad.json"), "{broken");
  assert.equal(readJsonFile(join(dir, "bad.json")), null);
  writeFileSync(join(dir, "arr.json"), "[1]");
  assert.equal(readJsonFile(join(dir, "arr.json")), null);
  writeFileSync(join(dir, "turn.json"), j({ schema_version: "x" }));
  writeFileSync(join(dir, "hook-state.json"), j({ schema_version: "x" }));
  assert.equal(readTurn(dir), null);
  assert.equal(readHookState(dir), null);
  assert.equal(readTurn(join(dir, "none")), null);
});
test("files: turn and hook-state round-trip with their schema", () => {
  const dir = mkdtempSync(join(tmpdir(), "rot-files-"));
  const identity = { pane_id: null, tmux_socket: null, host_pid: null, host_started_at: null };
  writeTurn(dir, { agent_id: "a", project: "p", host: "codex", session_id: "s", state: "idle", source: null, rotation_marker_id: null, at: "t", ...identity });
  assert.equal(readTurn(dir)?.state, "idle");
  writeHookState(dir, { session_id: "s", blocked_at: "t", measured_tokens: 5, threshold_tokens: 4 });
  assert.equal(readHookState(dir)?.measured_tokens, 5);
});
test("files: a claim is read only for a valid id whose file names the same marker", () => {
  const dir = mkdtempSync(join(tmpdir(), "rot-files-"));
  const id = sha256Hex("m");
  mkdirSync(join(dir, "claims"));
  writeFileSync(join(dir, "claims", `${id}.json`), j({ state: "respawning", marker_id: id, respawn_started_at: "2026-11-11T01:00:00.000Z" }));
  assert.deepEqual(readClaim(dir, id), { state: "respawning", marker_id: id, respawn_started_at: "2026-11-11T01:00:00.000Z" });
  assert.equal(readClaim(dir, "../etc/passwd"), null, "id is not a digest");
  assert.equal(readClaim(dir, sha256Hex("other")), null, "no file");
  const other = sha256Hex("n");
  writeFileSync(join(dir, "claims", `${other}.json`), j({ state: "claimed", marker_id: id }));
  assert.equal(readClaim(dir, other), null, "marker mismatch");
  const empty = sha256Hex("o");
  writeFileSync(join(dir, "claims", `${empty}.json`), j({ state: "", marker_id: empty }));
  assert.equal(readClaim(dir, empty), null, "empty state");
  const bare = sha256Hex("p");
  writeFileSync(join(dir, "claims", `${bare}.json`), j({ state: "claimed", marker_id: bare }));
  assert.equal(readClaim(dir, bare)?.respawn_started_at, null);
});

// ---- FR7.2: store readiness ----
const fakeStore = (log: string[] = []): Store => ({
  backend: "json",
  getDecisions: async (...args: unknown[]) => { log.push(`get:${j(args)}`); return ["d"]; },
  close: async () => { log.push("close"); },
}) as unknown as Store;

test("FR7.2 readiness: calls wait for the open, then reach the real store; begin runs the open once", async () => {
  let opens = 0;
  let finish: (store: Store) => void = () => undefined;
  const log: string[] = [];
  const readiness = createStoreReadiness(() => { opens += 1; return new Promise<Store>((resolve) => { finish = resolve; }); });
  assert.equal(readiness.state(), "waiting");
  const pending = (readiness.store as unknown as { getDecisions(x: number): Promise<string[]> }).getDecisions(1);
  readiness.begin();
  readiness.begin();
  assert.equal(readiness.state(), "opening");
  assert.equal(opens, 1);
  assert.equal(readiness.store.backend, undefined, "backend is not known before ready");
  finish(fakeStore(log));
  assert.deepEqual(await pending, ["d"]);
  await readiness.settled();
  assert.equal(readiness.state(), "ready");
  assert.equal(readiness.store.backend, "json");
  assert.equal(await Promise.resolve(readiness.store) === readiness.store, true, "the proxy is not a thenable");
  assert.equal((readiness.store as unknown as Record<symbol, unknown>)[Symbol.iterator], undefined);
  await readiness.close();
  assert.deepEqual(log, ["get:[1]", "close"]);
});
test("FR7.2 readiness: a failed open fails each call with the reason (redacted), never hangs; close does nothing", async () => {
  const readiness = createStoreReadiness(async () => { throw new Error("connect failed password=hunter2hunter2hunter2"); });
  readiness.begin();
  await readiness.settled();
  assert.equal(readiness.state(), "failed");
  await assert.rejects(
    () => (readiness.store as unknown as { getDecisions(): Promise<unknown> }).getDecisions(),
    (error: unknown) => error instanceof StoreNotReadyError && /connect failed/.test(error.reason) && !/hunter2hunter2hunter2/.test(error.message),
  );
  await readiness.close();
  const nonError = createStoreReadiness(() => Promise.reject("plain text"));
  nonError.begin();
  await nonError.settled();
  await assert.rejects(() => (nonError.store as unknown as { x(): Promise<unknown> }).x(), /plain text/);
});
test("FR7.2 readiness: an unknown method after open fails clearly; close during the open waits for it", async () => {
  const log: string[] = [];
  const readiness = createStoreReadiness(async () => fakeStore(log));
  readiness.begin();
  const closing = readiness.close();
  await closing;
  assert.deepEqual(log, ["close"]);
  await assert.rejects(() => (readiness.store as unknown as { nope(): Promise<unknown> }).nope(), /unknown store method: nope/);
  const idle = createStoreReadiness(async () => fakeStore());
  await idle.close();
  assert.equal(idle.state(), "waiting");
});

// ---- FR7.3: startup paths skip the schema migration ----
test("FR7.3 every startup path opens the store without running the schema migration", async () => {
  const { readdirSync: list, readFileSync: read } = await import("node:fs");
  const outOfScope = new Set([
    "claude-start.ts", "codex-start.ts", "kusabi-fleet-status-cli.ts", "restart-cli.ts",
  ]);
  const srcDir = new URL(".", import.meta.url).pathname;
  const offenders: string[] = [];
  let checked = 0;
  for (const name of list(srcDir)) {
    if (!name.endsWith(".ts") || name.startsWith("test") || outOfScope.has(name)) continue;
    const source = read(join(srcDir, name), "utf8");
    for (const match of source.matchAll(/\bcreateStore\(([^)]*)\)/g)) {
      if (/^\s*$/.test(match[1]) || !/skipPostgresMigrations:\s*true/.test(match[1])) {
        if (!/function createStore|import /.test(source.slice(Math.max(0, match.index! - 20), match.index!))) offenders.push(name);
      } else {
        checked += 1;
      }
    }
  }
  assert.deepEqual(offenders, []);
  assert.ok(checked >= 10, `checked ${checked} call sites`);
});

test("currentUid: the process's own id, or null where the platform has none", () => {
  assert.equal(currentUid({ getuid: () => 501 }), 501);
  assert.equal(currentUid({ getuid: () => 0 }), 0, "root is an id, not 'no id'");
  assert.equal(currentUid({}), null);
  const own = currentUid();
  assert.ok(own === null || Number.isInteger(own));
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
  console.error(`FAIL test-session-rotation-core (${failed}/${cases.length})`);
  process.exit(1);
}
console.log(`PASS test-session-rotation-core (${cases.length} cases)`);
