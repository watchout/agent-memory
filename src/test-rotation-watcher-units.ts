/**
 * Rotation watcher, unit layer (261110-session-rotation, FR5): settings validation,
 * screen and client proofs, process table, the closed tmux command set, the
 * decision core, and the claim/ledger/HALT files. Time and every observation are
 * passed in (standard S4); real tmux is never used. Each unit has a correct case
 * and error/edge cases.
 */
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkConfigPermissions,
  parseWatcherConfig,
  WATCHER_CONFIG_SCHEMA,
} from "./rotation-watcher-config.js";
import {
  isSteady,
  proveHumanQuiet,
  proveInputRow,
  updateStability,
} from "./rotation-watcher-screen.js";
import {
  checkHost,
  descendantsNamed,
  isSameOrDescendant,
  parseProcessTable,
  psTableExec,
} from "./rotation-watcher-ps.js";
import {
  buildRespawnCondition,
  conditionalRespawn,
  readClientActivities,
  readPaneState,
  readScreen,
  readTmuxVersion,
  resolvePaneId,
  tmuxExec,
  type PaneState,
  type TmuxResult,
  type TmuxRun,
} from "./rotation-watcher-tmux.js";
import {
  decideRotationRelaunch,
  isNewConversationConfirmed,
  recheckBeforeRespawn,
  skipClass,
  type Observation,
  type RelaunchInputs,
  type RelaunchPlan,
} from "./rotation-watcher-core.js";
import {
  advanceClaim,
  appendLedger,
  claimPath,
  createClaim,
  isTerminalClaim,
  ledgerPath,
  nodeWatcherFs,
  readClaimRecord,
  summarizeLedger,
  writeHalt,
  type WatcherFs,
} from "./rotation-watcher-store.js";
import { buildMarker, sha256Hex, type RotationMarker, type RotationTurn } from "./session-rotation-files.js";
import { EMPTY_SCREEN, LAUNCH_COMMAND, LAUNCH_SHA, NOW0, SEAT_JSON, seatFrom } from "./test-rotation-watcher-world.js";

const cases: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);
const tmp = () => mkdtempSync(join(tmpdir(), "rotation-watcher-units-"));
const config = (seats: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ schema_version: WATCHER_CONFIG_SCHEMA, seats, ...extra });
const ok = <T>(value: { ok: boolean } & T) => { assert.equal(value.ok, true); return value as T & { ok: true }; };

// ---------- settings ----------
test("config: a complete seat is accepted with the defaults filled in", () => {
  const parsed = ok(parseWatcherConfig(config([SEAT_JSON])));
  const [seat] = parsed.value.config.seats;
  assert.equal(parsed.value.rejected.length, 0);
  assert.equal(seat.quiet_seconds, 20);
  assert.equal(seat.human_quiet_seconds, 30);
  assert.equal(seat.min_interval_seconds, 900);
  assert.equal(seat.max_per_hour, 4);
  assert.equal(seat.confirm_wait_seconds, 60);
  assert.equal(seat.marker_ttl_seconds, 1_800);
  assert.equal(parsed.value.config.no_progress_halt_limit, 30);
});

test("config: each bad seat is rejected with its own reason and the good one is still served", () => {
  const bad: Array<[Record<string, unknown> | string, string]> = [
    ["not an object", "seat_not_object"],
    [{ ...SEAT_JSON, agent_id: "../x" }, "agent_id_invalid"],
    [{ ...SEAT_JSON, project: "" }, "project_invalid"],
    [{ ...SEAT_JSON, host: "gemini" }, "host_invalid"],
    [{ ...SEAT_JSON, tmux_target: "seat" }, "tmux_target_invalid"],
    [{ ...SEAT_JSON, expected_command: "a b" }, "expected_command_invalid"],
    [{ ...SEAT_JSON, launch_command: "sh -c 'x'" }, "launch_command_invalid"],
    [{ ...SEAT_JSON, launch_command: "a,b" }, "launch_command_invalid"],
    [{ ...SEAT_JSON, launch_command: "a}b" }, "launch_command_invalid"],
    [{ ...SEAT_JSON, launch_command: "" }, "launch_command_invalid"],
    [{ ...SEAT_JSON, launch_command: "a".repeat(1_025) }, "launch_command_invalid"],
    [{ ...SEAT_JSON, launch_script: { path: "relative.sh", sha256: LAUNCH_SHA } }, "launch_script_invalid"],
    [{ ...SEAT_JSON, launch_script: { path: "/a.sh", sha256: "zz" } }, "launch_script_invalid"],
    [{ ...SEAT_JSON, launch_script: undefined }, "launch_script_invalid"],
    [{ ...SEAT_JSON, owner_decision_ref: undefined }, "owner_decision_ref_missing"],
    [{ ...SEAT_JSON, owner_decision_ref: { url: "http://x", sha256: LAUNCH_SHA } }, "owner_decision_ref_missing"],
    [{ ...SEAT_JSON, owner_decision_ref: { ...SEAT_JSON.owner_decision_ref, sha256: "short" } }, "owner_decision_ref_missing"],
    [{ ...SEAT_JSON, aun_supervised: true }, "aun_supervised_without_named_decision"],
    [{ ...SEAT_JSON, prompt_markers: [] }, "prompt_markers_invalid"],
    [{ ...SEAT_JSON, placeholder_patterns: [1] }, "placeholder_patterns_invalid"],
    [{ ...SEAT_JSON, drain_commands: ["a b"] }, "drain_commands_invalid"],
    [{ ...SEAT_JSON, drain_commands: "x" }, "drain_commands_invalid"],
    [{ ...SEAT_JSON, human_quiet_seconds: 0 }, "human_quiet_seconds_invalid"],
    [{ ...SEAT_JSON, max_per_hour: 1.5 }, "max_per_hour_invalid"],
  ];
  const parsed = ok(parseWatcherConfig(config([...bad.map(([seat]) => seat), { ...SEAT_JSON, agent_id: "good" }])));
  assert.deepEqual(parsed.value.rejected.map((entry) => entry.reason), bad.map(([, reason]) => reason));
  assert.deepEqual(parsed.value.config.seats.map((seat) => seat.agent_id), ["good"]);
});

test("config: placeholder patterns and drain commands may be left out", () => {
  const { placeholder_patterns: _p, drain_commands: _d, ...bare } = SEAT_JSON;
  const parsed = ok(parseWatcherConfig(config([bare])));
  assert.deepEqual([parsed.value.config.seats[0].placeholder_patterns, parsed.value.config.seats[0].drain_commands], [[], []]);
});

test("config: an AUN-supervised seat is served only with a decision that names AUN supervised relaunch", () => {
  const named = { ...SEAT_JSON.owner_decision_ref, names_aun_supervised_relaunch: true };
  const parsed = ok(parseWatcherConfig(config([{ ...SEAT_JSON, aun_supervised: true, owner_decision_ref: named }])));
  assert.equal(parsed.value.config.seats[0].aun_supervised, true);
});

test("config: a seat named twice is dropped entirely; a broken file or limit starts nothing", () => {
  const twice = ok(parseWatcherConfig(config([SEAT_JSON, { ...SEAT_JSON, tmux_target: "x:0.1" }])));
  assert.equal(twice.value.config.seats.length, 0);
  assert.deepEqual(twice.value.rejected.map((entry) => entry.reason), ["seat_duplicated", "seat_duplicated"]);
  assert.deepEqual(parseWatcherConfig("{not json"), { ok: false, reason: "config_not_json" });
  assert.deepEqual(parseWatcherConfig(JSON.stringify({ schema_version: "other", seats: [] })), { ok: false, reason: "config_shape_invalid" });
  assert.deepEqual(parseWatcherConfig("[]"), { ok: false, reason: "config_shape_invalid" });
  assert.deepEqual(parseWatcherConfig(config([SEAT_JSON], { no_progress_halt_limit: 0 })), { ok: false, reason: "no_progress_halt_limit_invalid" });
  assert.equal(ok(parseWatcherConfig(config([], { no_progress_halt_limit: 5 }))).value.config.no_progress_halt_limit, 5);
});

test("config: the file and its folder must be ours and not writable by others", () => {
  const mine = { uid: 501, mode: 0o100600 };
  assert.deepEqual(checkConfigPermissions({ uid: 501, file: mine, folder: { uid: 501, mode: 0o40700 } }), { ok: true, value: true });
  assert.deepEqual(checkConfigPermissions({ uid: 501, file: { uid: 0, mode: 0o100600 }, folder: mine }), { ok: false, reason: "config_file_not_ours" });
  assert.deepEqual(checkConfigPermissions({ uid: 501, file: mine, folder: { uid: 0, mode: 0o40700 } }), { ok: false, reason: "config_folder_not_ours" });
  assert.deepEqual(checkConfigPermissions({ uid: 501, file: { uid: 501, mode: 0o100666 }, folder: mine }), { ok: false, reason: "config_file_writable_by_others" });
  assert.deepEqual(checkConfigPermissions({ uid: 501, file: mine, folder: { uid: 501, mode: 0o40770 } }), { ok: false, reason: "config_folder_writable_by_others" });
  assert.deepEqual(checkConfigPermissions({ uid: null, file: mine, folder: { uid: 501, mode: 0o40700 } }), { ok: false, reason: "config_file_not_ours" },
    "no uid on this platform: ownership cannot be shown, so nothing is trusted (S5)");
});

// ---------- screen and clients ----------
const proof = (rows: string[], x: number, y: number, markers = [">"], placeholders = ["Try fix lint errors"]) =>
  proveInputRow({ text: `${rows.join("\n")}\n`, cursor_x: x, cursor_y: y }, markers, placeholders);

test("screen: an empty input box with the cursor at its head is proved empty", () => {
  const result = proof(EMPTY_SCREEN, 4, 2);
  assert.deepEqual([result.found, result.empty, result.cursor_at_input_head, result.row, result.column], [true, true, true, 2, 4]);
  assert.equal(result.reason, "input_empty");
  assert.equal(result.row_sha256, sha256Hex("│ >                          │"));
});

test("screen: a configured placeholder counts as empty, any other text does not", () => {
  const placeholder = proof(["╭──╮", "│ > Try fix lint errors │", "╰──╯"], 4, 1);
  assert.equal(placeholder.empty, true);
  const draft = proof(["╭──╮", "│ > half written sentence │", "╰──╯"], 4, 1);
  assert.deepEqual([draft.found, draft.empty, draft.reason], [true, false, "input_row_not_empty"]);
  const nearMiss = proof(["╭──╮", "│ > Try fix lint errors please │", "╰──╯"], 4, 1);
  assert.equal(nearMiss.empty, false);
});

test("screen: text on a line under the input row means a multi-line draft, not empty", () => {
  const result = proof(["╭──╮", "│ >                │", "│   second line     │", "╰──╯"], 4, 1);
  assert.deepEqual([result.found, result.empty, result.reason, result.row_sha256], [true, false, "text_below_input_row", null]);
  assert.equal(result.row, 1);
});

test("screen: blank rows and the border under the input row are allowed", () => {
  const result = proof(["╭──╮", "│ >      │", "", "╰──╯", "  tips"], 4, 1);
  assert.equal(result.empty, true);
});

test("screen: no input row (a permission or question screen) is not found, never empty", () => {
  const result = proof(["Allow this command?", "  1. Yes", "  2. No"], 0, 0);
  assert.deepEqual([result.found, result.empty, result.reason, result.row_sha256], [false, false, "input_row_not_found", null]);
  assert.equal(proveInputRow({ text: "", cursor_x: 0, cursor_y: 0 }, [">"], []).found, false);
});

test("screen: the cursor must sit right after the prompt; elsewhere is not proof", () => {
  assert.equal(proof(EMPTY_SCREEN, 5, 2).cursor_at_input_head, false);
  assert.equal(proof(EMPTY_SCREEN, 4, 3).cursor_at_input_head, false);
  assert.equal(proof(EMPTY_SCREEN, 5, 2).reason, "cursor_not_at_input_head");
  const withSpace = proof(["│>   │"], 3, 0);
  assert.deepEqual([withSpace.column, withSpace.cursor_at_input_head], [3, true]);
  const noSpace = proof(["│>│"], 2, 0);
  assert.deepEqual([noSpace.column, noSpace.cursor_at_input_head, noSpace.empty], [2, true, true]);
});

test("screen: clients — unreadable is not observed, none attached is quiet, a recent client is not", () => {
  assert.deepEqual(proveHumanQuiet(null, 1_000, 30), { observed: false, quiet: false, latest_activity: null, reason: "clients_unreadable" });
  assert.deepEqual(proveHumanQuiet([], 1_000, 30), { observed: true, quiet: true, latest_activity: null, reason: "no_client_attached" });
  assert.equal(proveHumanQuiet([900, 995], 1_000, 30).quiet, false);
  assert.equal(proveHumanQuiet([900, 995], 1_000, 30).reason, "client_recently_active");
  assert.equal(proveHumanQuiet([900, 970], 1_000, 30).quiet, true);
  assert.equal(proveHumanQuiet([900, 970], 1_000, 30).latest_activity, 970);
});

test("screen: steadiness needs the same digest for the quiet period", () => {
  assert.equal(isSteady(undefined, 100, 20), false);
  const first = updateStability(undefined, "a", 100);
  assert.equal(isSteady(first, 110, 20), false);
  const same = updateStability(first, "a", 125);
  assert.equal(same, first);
  assert.equal(isSteady(same, 125, 20), true);
  const changed = updateStability(same, "b", 126);
  assert.deepEqual(changed, { digest: "b", stable_since: 126 });
  assert.equal(isSteady(changed, 130, 20), false);
});

// ---------- processes ----------
const PS = [
  "    1     0 Mon Oct 12 09:05:47 2026     /sbin/launchd",
  "  100     1 Tue Nov  3 10:00:00 2026     /bin/sh",
  "  101   100 Tue Nov  3 10:01:00 2026     /usr/local/bin/claude",
  "  102   101 Tue Nov  3 10:02:00 2026     /usr/bin/transcript-stop",
  "garbage line",
].join("\n");

test("ps: rows are parsed with the start time folded to the form the hooks wrote", () => {
  const table = parseProcessTable(PS)!;
  assert.equal(table.size, 4);
  assert.equal(table.get(100)!.started_at, "Tue Nov 3 10:00:00 2026");
  assert.equal(table.get(101)!.command, "claude");
  assert.equal(parseProcessTable(null), null);
  assert.equal(parseProcessTable("nothing useful"), null);
});

test("ps: ancestry is bounded, handles missing rows and self parents, and finds named helpers", () => {
  const table = parseProcessTable(PS)!;
  assert.equal(isSameOrDescendant(table, 100, 100), true);
  assert.equal(isSameOrDescendant(table, 100, 102), true);
  assert.equal(isSameOrDescendant(table, 102, 100), false);
  assert.equal(isSameOrDescendant(table, 100, 9_999), false);
  assert.equal(isSameOrDescendant(table, 100, 102, 1), false);
  assert.equal(isSameOrDescendant(parseProcessTable("5 5 Tue Nov 3 10:00:00 2026 x\n")!, 1, 5), false);
  assert.equal(isSameOrDescendant(parseProcessTable("5 0 Tue Nov 3 10:00:00 2026 x\n")!, 1, 5), false);
  assert.deepEqual(descendantsNamed(table, 101, ["transcript-stop"]).map((row) => row.pid), [102]);
  assert.deepEqual(descendantsNamed(table, 101, ["claude"]), []);
  assert.deepEqual(descendantsNamed(table, 101, []), []);
});

test("ps: the host check reports gone, replaced, wrong command and outside the pane separately", () => {
  const table = parseProcessTable(PS)!;
  const same = "Tue Nov 3 10:01:00 2026";
  assert.deepEqual(checkHost(table, 101, [same, same], "claude", 100), { alive: true, started_at_matches: true, command_matches: true, in_pane: true });
  assert.equal(checkHost(table, 999, [same], "claude", 100).alive, false);
  assert.equal(checkHost(table, 101, [same, "Tue Nov 3 11:00:00 2026"], "claude", 100).started_at_matches, false);
  assert.equal(checkHost(table, 101, [same], "codex", 100).command_matches, false);
  assert.equal(checkHost(table, 101, [same], "claude", 102).in_pane, false);
});

test("ps and tmux runners: a missing or failing binary is a failure value, never a throw", () => {
  const folder = tmp();
  const original = process.env.PATH;
  try {
    process.env.PATH = folder;
    assert.equal(psTableExec(), null);
    assert.deepEqual(tmuxExec(["display-message", "-p", "x"]), { ok: false, stdout: "" });
    writeFileSync(join(folder, "tmux"), "#!/bin/sh\necho \"$@\"\n", { mode: 0o755 });
    writeFileSync(join(folder, "ps"), "#!/bin/sh\necho '  7 1 Tue Nov  3 10:00:00 2026 /bin/sh'\n", { mode: 0o755 });
    chmodSync(join(folder, "tmux"), 0o755);
    chmodSync(join(folder, "ps"), 0o755);
    assert.deepEqual(tmuxExec(["display-message", "-p", "x"]), { ok: true, stdout: "display-message -p x\n" });
    assert.equal(parseProcessTable(psTableExec())!.get(7)!.command, "sh");
  } finally {
    process.env.PATH = original;
  }
});

// ---------- tmux: the closed command set ----------
const PANE_OUT = "%7|||5000|||0|||0|||4|||2|||1|||/tmp/sock|||$3|||" + LAUNCH_COMMAND;
const fake = (results: TmuxResult[] | ((argv: readonly string[]) => TmuxResult)) => {
  const calls: string[][] = [];
  let index = 0;
  const run: TmuxRun = (argv) => {
    calls.push([...argv]);
    return typeof results === "function" ? results(argv) : results[Math.min(index++, results.length - 1)];
  };
  return { run, calls };
};
const good = (stdout: string): TmuxResult => ({ ok: true, stdout });
const bad: TmuxResult = { ok: false, stdout: "" };

test("tmux: a configured target resolves to a pane id only when tmux answers with one", () => {
  const f = fake([good("%7\n")]);
  assert.equal(resolvePaneId(f.run, "seat:0.0"), "%7");
  assert.deepEqual(f.calls, [["display-message", "-p", "-t", "seat:0.0", "#{pane_id}"]]);
  assert.equal(resolvePaneId(fake([good("nope\n")]).run, "seat:0.0"), null);
  assert.equal(resolvePaneId(fake([bad]).run, "seat:0.0"), null);
  const never = fake([good("%7\n")]);
  assert.equal(resolvePaneId(never.run, "bad target; x"), null);
  assert.equal(never.calls.length, 0);
});

test("tmux: one read of the pane gives every compared field; any malformed field is unreadable", () => {
  const state = readPaneState(fake([good(`${PANE_OUT}\n`)]).run, "%7") as PaneState;
  assert.deepEqual(
    [state.pane_pid, state.pane_dead, state.pane_in_mode, state.cursor_x, state.cursor_y, state.session_attached, state.socket_path, state.session_id, state.start_command],
    [5000, false, false, 4, 2, 1, "/tmp/sock", "$3", LAUNCH_COMMAND],
  );
  const withSeparator = readPaneState(fake([good(`${PANE_OUT}|||tail\n`)]).run, "%7") as PaneState;
  assert.equal(withSeparator.start_command, `${LAUNCH_COMMAND}|||tail`);
  const variants = [
    PANE_OUT.replace("%7", "%8"),
    PANE_OUT.replace("5000", "abc"),
    PANE_OUT.replace("|||$3|||", "|||3|||"),
    PANE_OUT.replace("|||0|||0|||4", "|||2|||0|||4"),
    PANE_OUT.replace("|||0|||4|||2", "|||9|||4|||2"),
    PANE_OUT.replace("/tmp/sock", ""),
    "%7|||5000",
  ];
  for (const variant of variants) assert.equal(readPaneState(fake([good(`${variant}\n`)]).run, "%7"), null, variant);
  assert.equal(readPaneState(fake([bad]).run, "%7"), null);
  const never = fake([good(PANE_OUT)]);
  assert.equal(readPaneState(never.run, "7"), null);
  assert.equal(never.calls.length, 0);
});

test("tmux: client times, screen and version are read with fixed argument arrays", () => {
  const clients = fake([good("100\n250\n")]);
  assert.deepEqual(readClientActivities(clients.run, "$3"), [100, 250]);
  assert.deepEqual(clients.calls, [["list-clients", "-t", "$3", "-F", "#{client_activity}"]]);
  assert.deepEqual(readClientActivities(fake([good("")]).run, "$3"), []);
  assert.equal(readClientActivities(fake([good("12\nxx\n")]).run, "$3"), null);
  assert.equal(readClientActivities(fake([bad]).run, "$3"), null);
  assert.equal(readClientActivities(fake([good("1\n")]).run, "3"), null);
  const state = readPaneState(fake([good(PANE_OUT)]).run, "%7") as PaneState;
  const screen = fake([good("hello\n")]);
  assert.deepEqual(readScreen(screen.run, state), { text: "hello\n", cursor_x: 4, cursor_y: 2 });
  assert.deepEqual(screen.calls, [["capture-pane", "-p", "-t", "%7"]]);
  assert.equal(readScreen(fake([bad]).run, state), null);
  assert.equal(readTmuxVersion(fake([good("3.6a\n")]).run), "3.6a");
  assert.equal(readTmuxVersion(fake([good("\n")]).run), null);
  assert.equal(readTmuxVersion(fake([bad]).run), null);
});

const COND = { pane_id: "%7", pane_pid: 5000, cursor_x: 4, cursor_y: 2, session_attached: 1, launch_command: LAUNCH_COMMAND };

test("tmux: the respawn condition names only what tmux can see, and refuses values it cannot place safely", () => {
  assert.equal(
    buildRespawnCondition(COND),
    `#{&&:#{==:#{pane_id},%7},#{&&:#{==:#{pane_pid},5000},#{&&:#{==:#{pane_dead},0},#{&&:#{==:#{pane_in_mode},0},#{&&:#{==:#{pane_start_command},${LAUNCH_COMMAND}},#{&&:#{==:#{cursor_y},2},#{&&:#{==:#{cursor_x},4},#{==:#{session_attached},1}}}}}}}}`,
  );
  assert.equal(buildRespawnCondition({ ...COND, pane_id: "7" }), null);
  assert.equal(buildRespawnCondition({ ...COND, pane_pid: -1 }), null);
  assert.equal(buildRespawnCondition({ ...COND, cursor_x: 1.5 }), null);
  assert.equal(buildRespawnCondition({ ...COND, launch_command: "a,b" }), null);
  assert.equal(buildRespawnCondition({ ...COND, launch_command: "a}b" }), null);
});

test("tmux: the one respawn command has a fixed shape and its result is read strictly", () => {
  const executed = fake([good("")]);
  assert.equal(conditionalRespawn(executed.run, COND), "executed");
  const [argv] = executed.calls;
  assert.deepEqual(argv.slice(0, 4), ["if-shell", "-F", "-t", "%7"]);
  assert.equal(argv[5], "respawn-pane -k -t %7");
  assert.equal(argv[6], "display-message -p NOT_RESPAWNED");
  assert.equal(argv.length, 7);
  assert.equal(conditionalRespawn(fake([good("NOT_RESPAWNED\n")]).run, COND), "not_respawned");
  assert.equal(conditionalRespawn(fake([bad]).run, COND), "unknown");
  assert.equal(conditionalRespawn(fake([good("something odd\n")]).run, COND), "unknown");
  const refused = fake([good("")]);
  assert.equal(conditionalRespawn(refused.run, { ...COND, launch_command: "a,b" }), "not_respawned");
  assert.equal(refused.calls.length, 0);
});

// ---------- decision core ----------
const MARKER_TIME = new Date(NOW0 - 300_000).toISOString();
const marker = (over: Partial<RotationMarker> = {}): RotationMarker => buildMarker({
  agent_id: "kusabi", project: "agent-memory", host: "claude_code", session_id: "old", pack_ref: "p", pack_content_sha256: "b".repeat(64),
  measured_tokens: 1, threshold_tokens: 1, saved_at: MARKER_TIME, handoff_source: "seat_text",
  pane_id: "%7", tmux_socket: "/tmp/sock", host_pid: 101, host_started_at: "Tue Nov 3 10:01:00 2026", ...over,
});
const turn = (over: Partial<RotationTurn> = {}): RotationTurn => ({
  schema_version: "kusabi-rotation-turn/v1", agent_id: "kusabi", project: "agent-memory", host: "claude_code", session_id: "old",
  state: "idle", source: null, rotation_marker_id: null, at: new Date(NOW0 - 120_000).toISOString(),
  pane_id: "%7", tmux_socket: "/tmp/sock", host_pid: 101, host_started_at: "Tue Nov 3 10:01:00 2026", ...over,
});
const pane = (over: Partial<PaneState> = {}): PaneState => ({
  pane_id: "%7", pane_pid: 100, pane_dead: false, pane_in_mode: false, cursor_x: 4, cursor_y: 2, session_attached: 0,
  socket_path: "/tmp/sock", session_id: "$3", start_command: LAUNCH_COMMAND, ...over,
});
const QUIET_PS = PS.replace("102   101", "102     1");
const observation = (over: Partial<Observation> = {}): Observation => ({
  resolved_pane_id: "%7", pane: pane(), tmux_version: "3.6a", processes: parseProcessTable(QUIET_PS),
  launch_script_sha256: LAUNCH_SHA, input: proof(EMPTY_SCREEN, 4, 2),
  human: proveHumanQuiet([], NOW0 / 1_000, 30), screen_steady: true, ...over,
});
const inputs = (over: Partial<RelaunchInputs> = {}): RelaunchInputs => ({
  seat: seatFrom({ drain_commands: ["transcript-stop"] }), marker: marker(), turn: turn(), now_ms: NOW0, claim_exists: false,
  last_respawn_ms: null, respawns_in_last_hour: 0, halt_global: false, halt_seat: false, observation: null, ...over,
});

test("core: file-level conditions pass and ask for an observation; with it the plan is the observed values", () => {
  assert.deepEqual(decideRotationRelaunch(inputs()), { action: "observe" });
  const decided = decideRotationRelaunch(inputs({ observation: observation() }));
  assert.equal(decided.action, "proceed");
  if (decided.action === "proceed") {
    assert.deepEqual(
      [decided.plan.pane_pid, decided.plan.host_pid, decided.plan.cursor_x, decided.plan.cursor_y, decided.plan.session_attached, decided.plan.client_activity_max],
      [100, 101, 4, 2, 0, null],
    );
    assert.equal(decided.plan.launch_script_sha256, LAUNCH_SHA);
  }
});

const skips: Array<[string, Partial<RelaunchInputs>, string]> = [
  ["global HALT", { halt_global: true }, "halted"],
  ["seat HALT", { halt_seat: true }, "halted"],
  ["no marker", { marker: null }, "no_marker"],
  ["claim exists", { claim_exists: true }, "claim_exists"],
  ["marker time unreadable", { marker: marker({ saved_at: "not a time" }) }, "marker_time_invalid"],
  ["marker too old", { now_ms: NOW0 + 1_600_000 }, "marker_expired"],
  ["no turn", { turn: null }, "no_turn"],
  ["marker of another seat", { marker: marker({ agent_id: "other" }) }, "identity_mismatch"],
  ["turn of another host", { turn: turn({ host: "codex" }) }, "identity_mismatch"],
  ["turn of another project", { turn: turn({ project: "other" }) }, "identity_mismatch"],
  ["marker without a pane", { marker: marker({ pane_id: null, tmux_socket: null, host_pid: null, host_started_at: null }) }, "binding_missing"],
  ["turn without a pane", { turn: turn({ pane_id: null }) }, "binding_missing"],
  ["different pane", { turn: turn({ pane_id: "%8" }) }, "binding_mismatch"],
  ["different socket", { turn: turn({ tmux_socket: "/other" }) }, "binding_mismatch"],
  ["different host process", { turn: turn({ host_pid: 202 }) }, "binding_mismatch"],
  ["different start time", { turn: turn({ host_started_at: "Tue Nov 3 11:00:00 2026" }) }, "binding_mismatch"],
  ["other conversation", { turn: turn({ session_id: "newer" }) }, "session_mismatch"],
  ["seat is busy", { turn: turn({ state: "busy" }) }, "turn_busy"],
  ["seat just started", { turn: turn({ state: "started" }) }, "turn_not_idle"],
  ["turn older than marker", { turn: turn({ at: new Date(NOW0 - 400_000).toISOString() }) }, "turn_older_than_marker"],
  ["turn time unreadable", { turn: turn({ at: "x" }) }, "turn_older_than_marker"],
  ["idle for too short a time", { turn: turn({ at: new Date(NOW0 - 5_000).toISOString() }) }, "turn_not_quiet_yet"],
  ["respawned recently", { last_respawn_ms: NOW0 - 60_000 }, "min_interval"],
  ["too many this hour", { respawns_in_last_hour: 4 }, "rate_limited"],
];
for (const [name, over, reason] of skips) {
  test(`core: ${name} does nothing (${reason})`, () => {
    const decided = decideRotationRelaunch(inputs(over));
    assert.deepEqual(decided, { action: "skip", reason, class: skipClass(reason as never) });
  });
}

const observed: Array<[string, Partial<Observation>, string]> = [
  ["tmux target does not resolve", { resolved_pane_id: null }, "pane_unresolved"],
  ["pane cannot be read", { pane: null }, "tmux_unreadable"],
  ["tmux version cannot be read", { tmux_version: null }, "tmux_unsupported"],
  ["resolved to another pane", { resolved_pane_id: "%9" }, "pane_mismatch"],
  ["pane has another id", { pane: pane({ pane_id: "%9" }) }, "pane_mismatch"],
  ["another tmux server", { pane: pane({ socket_path: "/other" }) }, "socket_mismatch"],
  ["pane is dead", { pane: pane({ pane_dead: true }) }, "pane_dead"],
  ["pane is in copy mode", { pane: pane({ pane_in_mode: true }) }, "pane_in_mode"],
  ["pane was started another way", { pane: pane({ start_command: '"sh /other.sh"' }) }, "launch_command_mismatch"],
  ["launch script unreadable", { launch_script_sha256: null }, "launch_script_unreadable"],
  ["launch script edited", { launch_script_sha256: "c".repeat(64) }, "launch_script_changed"],
  ["ps unreadable", { processes: null }, "ps_unreadable"],
  ["host process gone", { processes: parseProcessTable(PS.replace("  101   100", "  909   100")) }, "host_gone"],
  ["host process replaced", { processes: parseProcessTable(PS.replace("10:01:00", "12:34:56")) }, "host_replaced"],
  ["a different CLI in the same place", { processes: parseProcessTable(PS.replace("bin/claude", "bin/codex")) }, "host_command_mismatch"],
  ["host outside the pane", { pane: pane({ pane_pid: 102 }) }, "host_not_in_pane"],
  ["an import helper is running", { processes: parseProcessTable(PS) }, "import_running"],
  ["screen not steady", { screen_steady: false }, "screen_not_steady"],
  ["screen unreadable", { input: null }, "screen_unreadable"],
  ["no input row", { input: proof(["Allow?"], 0, 0) }, "input_row_not_found"],
  ["draft in the input", { input: proof(["│ > typing │"], 4, 0) }, "input_not_empty"],
  ["multi-line draft under the input row", { input: proof(["│ >   │", "│ second line │"], 4, 0) }, "input_not_empty"],
  ["cursor elsewhere", { input: proof(EMPTY_SCREEN, 9, 2) }, "cursor_not_at_input_head"],
  ["clients unreadable", { human: proveHumanQuiet(null, NOW0 / 1_000, 30) }, "clients_unreadable"],
  ["a person typed just now", { human: proveHumanQuiet([NOW0 / 1_000 - 2], NOW0 / 1_000, 30) }, "human_active"],
];
for (const [name, over, reason] of observed) {
  test(`core: ${name} does nothing (${reason})`, () => {
    const seat = seatFrom({ drain_commands: ["transcript-stop"] });
    const decided = decideRotationRelaunch(inputs({ seat, observation: observation(over) }));
    assert.deepEqual(decided, { action: "skip", reason, class: skipClass(reason as never) });
  });
}

test("core: reasons are classified once — waiting, unobservable, mismatch and idle", () => {
  assert.equal(skipClass("human_active"), "waiting");
  assert.equal(skipClass("input_row_not_found"), "unobservable");
  assert.equal(skipClass("host_replaced"), "mismatch");
  assert.equal(skipClass("no_marker"), "idle");
});

const PLAN: RelaunchPlan = {
  marker_id: marker().marker_id, pane_id: "%7", pane_pid: 100, cursor_x: 4, cursor_y: 2, session_attached: 0, session_id: "$3",
  host_pid: 101, host_started_at: "Tue Nov 3 10:01:00 2026", turn_at: turn().at, input_row_sha256: "d".repeat(64),
  client_activity_max: null, launch_script_sha256: LAUNCH_SHA,
};
const quietProcesses = parseProcessTable(QUIET_PS);

test("core: the last look before acting needs the same marker, the same idle turn and the same bindings", () => {
  const seat = seatFrom();
  const accepted = recheckBeforeRespawn(PLAN, seat, marker(), turn(), observation({ processes: quietProcesses }));
  assert.equal(accepted.action, "proceed");
  const expectSkip = (m: RotationMarker | null, t: RotationTurn | null, o: Observation, reason: string) =>
    assert.deepEqual(recheckBeforeRespawn(PLAN, seat, m, t, o), { action: "skip", reason, class: skipClass(reason as never) });
  const fine = observation({ processes: quietProcesses });
  expectSkip(null, turn(), fine, "no_marker");
  expectSkip(marker({ session_id: "newer" }), turn(), fine, "no_marker");
  expectSkip(marker(), null, fine, "no_turn");
  expectSkip(marker(), turn({ state: "busy" }), fine, "turn_busy");
  expectSkip(marker(), turn({ state: "started" }), fine, "turn_not_idle");
  expectSkip(marker(), turn({ at: new Date(NOW0 - 1_000).toISOString() }), fine, "session_mismatch");
  expectSkip(marker(), turn({ session_id: "newer" }), fine, "session_mismatch");
  expectSkip(marker(), turn({ host_pid: 7 }), fine, "binding_mismatch");
  expectSkip(marker(), turn({ pane_id: "%9" }), fine, "binding_mismatch");
  expectSkip(marker(), turn(), observation({ processes: quietProcesses, human: proveHumanQuiet([NOW0 / 1_000 - 1], NOW0 / 1_000, 30) }), "human_active");
  expectSkip(marker(), turn(), observation({ processes: quietProcesses, pane: pane({ cursor_x: 9 }), input: proof(EMPTY_SCREEN, 9, 2) }), "cursor_not_at_input_head");
});

test("core: confirmation needs a changed pane process and the ordered start of a new conversation", () => {
  const seat = seatFrom();
  const m = marker();
  const table = parseProcessTable("200 1 Tue Nov 3 12:00:00 2026 /bin/sh\n201 200 Tue Nov 3 12:00:01 2026 /usr/bin/claude\n");
  const started = turn({ state: "started", source: "startup", rotation_marker_id: m.marker_id, session_id: "new", host_pid: 201, at: new Date(NOW0 + 1_000).toISOString() });
  const base = { seat, marker: m, turn: started, pane: pane({ pane_pid: 200 }), processes: table, pane_pid_before: 100, respawn_started_ms: NOW0 };
  assert.equal(isNewConversationConfirmed(base), true);
  const reject = (over: object) => assert.equal(isNewConversationConfirmed({ ...base, ...over }), false, JSON.stringify(over));
  reject({ turn: null });
  reject({ pane: null });
  reject({ processes: null });
  reject({ pane: pane({ pane_pid: 100 }) });
  reject({ pane: pane({ pane_id: "%9", pane_pid: 200 }) });
  for (const over of [
    { state: "idle" }, { source: "clear" }, { rotation_marker_id: "e".repeat(64) }, { rotation_marker_id: null }, { agent_id: "x" }, { project: "x" },
    { host: "codex" }, { pane_id: "%9" }, { tmux_socket: "/x" }, { session_id: "old" }, { host_pid: null }, { host_pid: 101 },
    { host_pid: 999 }, { at: "bad" }, { at: new Date(NOW0 - 1).toISOString() },
  ]) reject({ turn: { ...started, ...over } });
});

// ---------- claim, ledger, HALT ----------
const claimFields = { marker_id: "a".repeat(64), launch_command_sha256: "b".repeat(64), attempt_id: "att-1", watcher_pid: 4242, claimed_at: "2026-11-11T02:00:00.000Z" };

test("store: a claim is created once; a second attempt for the same marker finds it", () => {
  const dir = join(tmp(), "kusabi", "agent-memory");
  const first = createClaim(nodeWatcherFs, dir, claimFields);
  assert.equal(first.result, "created");
  assert.equal(createClaim(nodeWatcherFs, dir, { ...claimFields, attempt_id: "att-2" }).result, "exists");
  const read = readClaimRecord(nodeWatcherFs, dir, claimFields.marker_id);
  assert.equal(read.kind, "found");
  if (read.kind === "found") {
    assert.deepEqual([read.claim.state, read.claim.attempt_id, read.claim.respawn_started_at, isTerminalClaim(read.claim)], ["claimed", "att-1", null, false]);
  }
  assert.equal(readClaimRecord(nodeWatcherFs, dir, "f".repeat(64)).kind, "none");
});

test("store: a claim moves forward by atomic replace and reports a failed write", () => {
  const dir = join(tmp(), "k", "p");
  const created = createClaim(nodeWatcherFs, dir, claimFields);
  assert.equal(created.result, "created");
  const claim = (created as { claim: Parameters<typeof advanceClaim>[2] }).claim;
  const next = advanceClaim(nodeWatcherFs, dir, claim, { state: "respawning", respawn_started_at: "2026-11-11T02:00:01.000Z", pane_pid_before: 100 });
  assert.equal(next?.state, "respawning");
  const read = readClaimRecord(nodeWatcherFs, dir, claimFields.marker_id);
  assert.equal(read.kind === "found" && read.claim.pane_pid_before, 100);
  const done = advanceClaim(nodeWatcherFs, dir, next!, { state: "done", resolution: "confirmed" });
  assert.equal(done !== null && isTerminalClaim(done), true);
  const broken: WatcherFs = { ...nodeWatcherFs, replace: () => { throw new Error("disk"); } };
  assert.equal(advanceClaim(broken, dir, claim, { state: "done" }), null);
  const cannotCreate: WatcherFs = { ...nodeWatcherFs, createExclusive: () => { throw new Error("disk"); } };
  assert.equal(createClaim(cannotCreate, dir, { ...claimFields, marker_id: "9".repeat(64) }).result, "failed");
});

test("store: a claim file that is damaged is unreadable, not absent", () => {
  const dir = join(tmp(), "k", "p");
  mkdirSync(join(dir, "claims"), { recursive: true });
  const id = "a".repeat(64);
  for (const body of ["{broken", "[]", JSON.stringify({ marker_id: id }), JSON.stringify({ schema_version: "kusabi-rotation-claim/v1", marker_id: "other", attempt_id: "x", watcher_pid: 1, state: "done" }), JSON.stringify({ schema_version: "kusabi-rotation-claim/v1", marker_id: id, attempt_id: "x", watcher_pid: 1, state: "weird" })]) {
    writeFileSync(claimPath(dir, id), body);
    assert.equal(readClaimRecord(nodeWatcherFs, dir, id).kind, "unreadable", body);
  }
  const unreadableFile: WatcherFs = { ...nodeWatcherFs, readText: () => null };
  assert.equal(readClaimRecord(unreadableFile, dir, id).kind, "unreadable");
});

test("store: the ledger appends durable lines and the summary counts only real respawns for the seat", () => {
  const root = tmp();
  const at = (offset: number) => new Date(NOW0 + offset).toISOString();
  const line = (kind: Parameters<typeof appendLedger>[2], agent: string, offset: number, attempt = "a") =>
    appendLedger(nodeWatcherFs, root, kind, { at: at(offset), attempt_id: attempt, marker_id: "m", host: "claude_code", agent_id: agent, project: "p" });
  assert.equal(line("intent", "kusabi", -100, "e"), true);
  assert.equal(line("skipped", "kusabi", -50, "e"), true);
  assert.equal(line("respawn_issued", "kusabi", -7_200_000, "old"), true);
  assert.equal(line("respawn_issued", "kusabi", -600_000, "a"), true);
  assert.equal(line("outcome_unknown", "kusabi", -300_000, "b"), true);
  assert.equal(line("respawn_issued", "other", -1_000, "x"), true);
  assert.equal(line("respawn_issued", "kusabi", -200_000, "c"), true);
  assert.equal(line("confirmed", "kusabi", -100_000, "c"), true);
  assert.equal(line("confirmed", "kusabi", -10, "d"), true);
  // the confirmed-by-inquiry attempt "d" has no respawn_issued line, and counts; "c" has both lines and counts once, at its latest
  assert.deepEqual(summarizeLedger(nodeWatcherFs, root, "kusabi", "p", NOW0), { readable: true, last_respawn_ms: NOW0 - 10, respawns_in_last_hour: 4 });
  assert.deepEqual(summarizeLedger(nodeWatcherFs, root, "other", "p", NOW0), { readable: true, last_respawn_ms: NOW0 - 1_000, respawns_in_last_hour: 1 });
  assert.deepEqual(summarizeLedger(nodeWatcherFs, root, "kusabi", "q", NOW0), { readable: true, last_respawn_ms: null, respawns_in_last_hour: 0 });
  assert.deepEqual(summarizeLedger(nodeWatcherFs, tmp(), "kusabi", "p", NOW0), { readable: true, last_respawn_ms: null, respawns_in_last_hour: 0 }, "no ledger yet is an empty history");
  const broken: WatcherFs = { ...nodeWatcherFs, appendDurable: () => { throw new Error("disk"); } };
  assert.equal(appendLedger(broken, root, "skipped", { at: at(0), attempt_id: null, marker_id: "m", host: "h", agent_id: "a", project: "p" }), false);
});

test("store (F4): a ledger that exists but cannot be read in full is 'unreadable', never an empty history", () => {
  const entry = (over: Record<string, unknown>) => `${JSON.stringify({ kind: "respawn_issued", agent_id: "kusabi", project: "p", attempt_id: "a", at: new Date(NOW0 - 1_000).toISOString(), ...over })}\n`;
  const withText = (text: string) => {
    const root = tmp();
    writeFileSync(ledgerPath(root), text);
    return summarizeLedger(nodeWatcherFs, root, "kusabi", "p", NOW0);
  };
  assert.deepEqual(withText(entry({})), { readable: true, last_respawn_ms: NOW0 - 1_000, respawns_in_last_hour: 1 });
  assert.deepEqual(withText(`${entry({})}\n${entry({ kind: "intent" })}`), { readable: true, last_respawn_ms: NOW0 - 1_000, respawns_in_last_hour: 1 }, "blank lines are fine");
  assert.deepEqual(withText(entry({ agent_id: "other", at: "bad", attempt_id: 1 })), { readable: true, last_respawn_ms: null, respawns_in_last_hour: 0 }, "another seat's damaged counting line does not matter");
  assert.deepEqual(withText(entry({ kind: "skipped", at: "bad", attempt_id: null })), { readable: true, last_respawn_ms: null, respawns_in_last_hour: 0 }, "a line that does not count is not checked beyond JSON");
  for (const [label, text] of [
    ["a torn line", `${entry({})}{"kind":"respawn_iss`],
    ["not JSON", `${entry({})}not json\n`],
    ["a JSON line that is not an object", `${entry({})}[1]\n`],
    ["a null line", `${entry({})}null\n`],
    ["a counting line with a bad time", entry({ at: "bad" })],
    ["a counting line with a numeric time", entry({ at: 12_345 })],
    ["a counting line with no attempt", entry({ attempt_id: undefined })],
    ["a counting line with an empty attempt", entry({ attempt_id: "" })],
    ["a confirmed line with no attempt", entry({ kind: "confirmed", attempt_id: null })],
  ] as const) {
    const summary = withText(text);
    assert.equal(summary.readable, false, label);
    assert.ok(!summary.readable && summary.reason.length > 0, label);
  }
  const root = tmp();
  writeFileSync(ledgerPath(root), entry({}));
  const unreadableFs: WatcherFs = { ...nodeWatcherFs, readText: () => null };
  assert.deepEqual(summarizeLedger(unreadableFs, root, "kusabi", "p", NOW0), { readable: false, reason: "ledger_unreadable" });
});

test("store: HALT files are written atomically, and a failed write is reported", () => {
  const path = join(tmp(), "HALT");
  assert.equal(writeHalt(nodeWatcherFs, path, "no_progress", "2026-11-11T02:00:00.000Z"), true);
  assert.equal(nodeWatcherFs.exists(path), true);
  assert.equal(JSON.parse(nodeWatcherFs.readText(path)!).reason, "no_progress");
  assert.equal(writeHalt({ ...nodeWatcherFs, replace: () => { throw new Error("disk"); } }, path, "x", "t"), false);
});

test("store: the real file port reports missing files and refuses to overwrite an exclusive file", () => {
  const dir = tmp();
  assert.equal(nodeWatcherFs.readText(join(dir, "missing")), null);
  assert.equal(nodeWatcherFs.stat(join(dir, "missing")), null);
  assert.equal(typeof nodeWatcherFs.stat(dir)?.uid, "number");
  const file = join(dir, "sub", "x.json");
  assert.equal(nodeWatcherFs.createExclusive(file, "one"), "created");
  assert.equal(nodeWatcherFs.createExclusive(file, "two"), "exists");
  assert.equal(nodeWatcherFs.readText(file), "one");
  assert.throws(() => nodeWatcherFs.createExclusive(join(file, "child"), "x"));
  const closed = join(dir, "closed");
  mkdirSync(closed);
  chmodSync(closed, 0o500);
  try {
    assert.throws(() => nodeWatcherFs.createExclusive(join(closed, "x.json"), "x"), /EACCES|EPERM/);
  } finally {
    chmodSync(closed, 0o700);
  }
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
  console.error(`FAIL test-rotation-watcher-units (${failed}/${cases.length})`);
  process.exit(1);
}
console.log(`PASS test-rotation-watcher-units (${cases.length} cases)`);
