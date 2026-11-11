/**
 * Rotation watcher, procedure layer (261110-session-rotation, FR5): the once-per-marker
 * procedure, the loop, the command line and the read-only probe, run against a
 * modelled tmux pane (test-rotation-watcher-world.ts). The checks that matter most:
 * no key-sending tmux command is ever issued, `respawn-pane` appears only inside the
 * one conditional command and at most once per marker, and every "could not see" case
 * ends with no respawn. Real tmux is never used here.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaim, advanceClaim, claimPath, globalHaltPath, ledgerPath, nodeWatcherFs, readClaimRecord, seatHaltPath, writeHalt, type WatcherFs } from "./rotation-watcher-store.js";
import { isNonProgress, runPass, runWatcher, tickSeat, watcherConfigPath } from "./rotation-watcher-run.js";
import { conditionalRespawn } from "./rotation-watcher-tmux.js";
import { resolveExistingClaim } from "./rotation-watcher-attempt.js";
import { parseWatcherArgs, realPorts, runWatcherCli } from "./rotation-watcher.js";
import type { SeatMemory } from "./rotation-watcher-observe.js";
import { PS_ENV, sha256Hex } from "./session-rotation-files.js";
import { EMPTY_SCREEN, LAUNCH_COMMAND, LAUNCH_SHA, NOW0, SEAT_JSON, seatFrom, World, type RespawnMode } from "./test-rotation-watcher-world.js";

const cases: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

const FORBIDDEN_TMUX_WORDS = [
  "send-keys", "send-prefix", "paste-buffer", "load-buffer", "set-buffer", "run-shell", "pipe-pane", "command-prompt",
  "source-file", "kill-pane", "kill-session", "kill-server", "new-session", "new-window", "split-window", "respawn-window",
  "select-pane", "copy-mode", "send-prefix", "wait-for",
];
const CLOSED_SET = ["display-message", "list-clients", "capture-pane", "if-shell"];

function assertSafe(world: World): void {
  assert.deepEqual(world.violations, []);
  for (const call of world.calls) {
    assert.ok(CLOSED_SET.includes(call[0]), `command outside the closed set: ${call[0]}`);
    for (const word of call) for (const forbidden of FORBIDDEN_TMUX_WORDS) assert.ok(!word.includes(forbidden), `${forbidden} in ${call.join(" ")}`);
  }
  const conditional = world.respawnCalls();
  assert.ok(conditional.length <= 1, "more than one conditional respawn for one marker");
  for (const call of conditional) {
    assert.equal(call.length, 7);
    assert.deepEqual(call.slice(0, 4), ["if-shell", "-F", "-t", world.pane.id]);
    assert.equal(call[5], `respawn-pane -k -t ${world.pane.id}`);
    assert.equal(call[6], "display-message -p NOT_RESPAWNED");
  }
}

const ledger = (world: World): Array<Record<string, unknown>> =>
  (nodeWatcherFs.readText(ledgerPath(world.root)) ?? "").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
const kinds = (world: World) => ledger(world).map((line) => line.kind);
const claimOf = (world: World) => {
  const read = readClaimRecord(nodeWatcherFs, world.seatDir, world.marker.marker_id);
  return read.kind === "found" ? read.claim : null;
};
const seatHalted = (world: World) => nodeWatcherFs.exists(seatHaltPath(world.seatDir));

/** One look while the screen is new, a wait past the steadiness period, then the look that may act. */
async function twoLooks(world: World, memory: SeatMemory = {}, seat = seatFrom()) {
  const first = await tickSeat(world.ports, seat, memory);
  await world.settle();
  const second = await tickSeat(world.ports, seat, memory);
  return { first, second, seat, memory };
}

const DRAFT_SCREEN = ["previous output", "╭────────────────────────────╮", "│ > half written sentence    │", "╰────────────────────────────╯"];

// ---------- the normal path ----------
test("flow: a fresh marker on a quiet seat is respawned once, confirmed, and not repeated", async () => {
  const world = new World();
  let respawnsAtIntent = -1;
  world.fsPort = {
    ...nodeWatcherFs,
    appendDurable: (path, text) => {
      if (text.includes('"kind":"intent"')) respawnsAtIntent = world.respawns;
      nodeWatcherFs.appendDurable(path, text);
    },
  };
  const { first, second, seat, memory } = await twoLooks(world);
  assert.deepEqual(first, { class: "waiting", reason: "screen_not_steady" });
  assert.deepEqual(second, { class: "progress", reason: "confirmed" });
  assert.equal(world.respawns, 1);
  assert.equal(respawnsAtIntent, 0, "intent must be written before the respawn");
  assertSafe(world);
  assert.deepEqual(kinds(world), ["skipped", "intent", "respawn_issued", "confirmed"]);
  const claim = claimOf(world);
  assert.deepEqual([claim?.state, claim?.resolution, claim?.pane_pid_before], ["done", "confirmed", 5000]);
  assert.deepEqual(await tickSeat(world.ports, seat, memory), { class: "idle", reason: "claim_exists" });
  assert.equal(world.respawns, 1);
  assert.equal(seatHalted(world), false);
});

test("flow: the evidence line written before the respawn names the seat and digests, never screen text or the launch command", async () => {
  const world = new World();
  await twoLooks(world);
  const intent = ledger(world).find((line) => line.kind === "intent")!;
  assert.deepEqual(
    [intent.agent_id, intent.project, intent.host, intent.old_session_id, intent.pane_id, intent.pane_pid, intent.host_pid, intent.host_started_at, intent.input_empty, intent.client_activity_max],
    ["kusabi", "agent-memory", "claude_code", "old-session", "%7", 5000, 5001, "Tue Nov 3 10:01:00 2026", true, null],
  );
  assert.equal(intent.launch_command_sha256, sha256Hex(LAUNCH_COMMAND));
  assert.equal(intent.launch_script_sha256, LAUNCH_SHA);
  assert.equal(intent.input_row_sha256, sha256Hex("│ >                          │"));
  assert.equal(intent.marker_id, world.marker.marker_id);
  const text = nodeWatcherFs.readText(ledgerPath(world.root))!;
  for (const secret of ["previous output", "? for shortcuts", "sh /seats", "╭", LAUNCH_COMMAND]) assert.ok(!text.includes(secret), secret);
});

test("flow: a configured placeholder in the input box counts as empty", async () => {
  const world = new World();
  world.screen = ["output", "╭──────────────╮", "│ > Try fix lint errors │", "╰──────────────╯"];
  const { second } = await twoLooks(world);
  assert.deepEqual(second, { class: "progress", reason: "confirmed" });
  assert.equal(world.respawns, 1);
  assertSafe(world);
});

test("flow: a seat with a person attached but idle for longer than the quiet period is still respawned", async () => {
  const world = new World();
  world.pane.attached = 1;
  world.clients = [Math.floor(NOW0 / 1_000) - 600];
  const { second } = await twoLooks(world);
  assert.equal(second.reason, "confirmed");
  assert.equal(world.respawns, 1);
  assert.equal(ledger(world).find((line) => line.kind === "intent")!.client_activity_max, Math.floor(NOW0 / 1_000) - 600);
  assertSafe(world);
});

// ---------- cases the watcher must not act on ----------
const NOT_YET: Array<[string, (world: World) => void, string]> = [
  ["cursor is not at the head of the input", (w) => { w.cursor.x = 9; }, "cursor_not_at_input_head"],
  ["a person typed in the last 30 seconds", (w) => { w.pane.attached = 1; w.clients = [NOW0 / 1_000 + 20]; }, "human_active"],
  ["the client list cannot be read", (w) => { w.clientsReadable = false; }, "clients_unreadable"],
  ["the pane is in copy mode", (w) => { w.pane.inMode = true; }, "pane_in_mode"],
  ["the pane is dead", (w) => { w.pane.dead = true; }, "pane_dead"],
  ["the seat is busy", (w) => { w.writeTurn({ state: "busy" }); }, "turn_busy"],
  ["a draft is typed", (w) => { w.screen = [...DRAFT_SCREEN]; w.cursor = { x: 4, y: 2 }; }, "input_not_empty"],
  ["a multi-line draft is typed", (w) => { w.screen = ["out", "│ >    │", "│ more text │", "╰────╯"]; w.cursor = { x: 4, y: 1 }; }, "input_not_empty"],
  ["there is no input row (a question screen)", (w) => { w.screen = ["Allow this command?", "  1. Yes", "  2. No"]; }, "input_row_not_found"],
  ["the host process was swapped under the same shell", (w) => { w.hostPid = 7777; }, "host_gone"],
  ["the host process has another start time", (w) => { w.hostStartedAt = "Tue Nov 3 12:00:00 2026"; }, "host_replaced"],
  ["a different CLI runs in the pane", (w) => { w.hostCommand = "codex"; }, "host_command_mismatch"],
  ["an import helper is still running", (w) => { w.extra = [{ pid: 7000, ppid: w.hostPid, command: "transcript-stop" }]; }, "import_running"],
  ["the launch script was edited", (w) => { w.scriptHash = "c".repeat(64); }, "launch_script_changed"],
  ["the launch script cannot be read", (w) => { w.scriptHash = null; }, "launch_script_unreadable"],
  ["the pane was started another way", (w) => { w.pane.start = '"sh /other.sh"'; }, "launch_command_mismatch"],
  ["another tmux server answers", (w) => { w.socket = "/tmp/other-socket"; }, "socket_mismatch"],
  ["the target resolves to another pane", (w) => { w.pane.id = "%9"; }, "pane_mismatch"],
  ["tmux does not answer", (w) => { w.tmuxDown = true; }, "pane_unresolved"],
  ["ps does not answer", (w) => { w.psReadable = false; }, "ps_unreadable"],
];
for (const [name, mutate, reason] of NOT_YET) {
  test(`flow: no respawn when ${name} (${reason})`, async () => {
    const world = new World();
    mutate(world);
    const { second } = await twoLooks(world);
    assert.equal(second.reason, reason);
    assert.notEqual(second.class, "progress");
    assert.equal(world.respawns, 0);
    assert.equal(claimOf(world), null, "decided before the claim");
    assert.ok(!kinds(world).includes("respawn_issued"));
    assertSafe(world);
  });
}

// ---------- a change between the decision and the respawn ----------
const CHANGES_AFTER_DECISION: Array<[string, (world: World) => void, string]> = [
  ["the cursor moved", (w) => { w.cursor.x = 9; }, "cursor_not_at_input_head"],
  ["a person started typing", (w) => { w.pane.attached = 1; w.clients = [Math.floor(w.now / 1_000)]; }, "human_active"],
  ["the pane went into copy mode", (w) => { w.pane.inMode = true; }, "pane_in_mode"],
  ["the seat became busy", (w) => { w.writeTurn({ state: "busy" }); }, "turn_busy"],
  ["a draft appeared", (w) => { w.screen = [...DRAFT_SCREEN]; }, "input_not_empty"],
  ["the host process changed", (w) => { w.hostPid = 7777; }, "host_gone"],
];
for (const [name, mutate, reason] of CHANGES_AFTER_DECISION) {
  test(`flow: the last look stops the respawn when ${name}`, async () => {
    const world = new World();
    world.fsPort = {
      ...nodeWatcherFs,
      appendDurable: (path, text) => {
        nodeWatcherFs.appendDurable(path, text);
        if (text.includes('"kind":"intent"')) mutate(world);
      },
    };
    const { second, seat, memory } = await twoLooks(world);
    assert.equal(second.reason, reason);
    assert.equal(world.respawns, 0);
    const claim = claimOf(world);
    assert.deepEqual([claim?.state, claim?.resolution], ["aborted_before_respawn", reason]);
    assert.deepEqual(kinds(world).slice(-2), ["intent", "skipped"]);
    assert.equal(ledger(world).at(-1)!.reason, reason);
    assertSafe(world);
    assert.deepEqual(await tickSeat(world.ports, seat, memory), { class: "idle", reason: "claim_exists" });
    assert.equal(world.respawns, 0);
  });
}

// ---------- the window inside tmux itself ----------
const CHANGES_INSIDE_TMUX: Array<[string, (world: World) => void]> = [
  ["the pane process was replaced", (w) => { w.pane.pid += 1; }],
  ["the cursor moved", (w) => { w.cursor.x = 9; }],
  ["a client attached", (w) => { w.pane.attached = 1; }],
  ["the pane went into copy mode", (w) => { w.pane.inMode = true; }],
  ["the pane was started another way", (w) => { w.pane.start = '"sh /other.sh"'; }],
];
for (const [name, mutate] of CHANGES_INSIDE_TMUX) {
  test(`flow: tmux answers NOT_RESPAWNED when ${name} just before the command`, async () => {
    const world = new World();
    world.beforeTmux = (argv) => { if (argv[0] === "if-shell") mutate(world); };
    const { second } = await twoLooks(world);
    assert.deepEqual(second, { class: "waiting", reason: "tmux_condition_false" });
    assert.equal(world.respawns, 0);
    assert.equal(claimOf(world)?.state, "aborted_before_respawn");
    assert.equal(claimOf(world)?.resolution, "tmux_condition_false");
    assert.ok(!kinds(world).includes("respawn_issued"));
    assertSafe(world);
  });
}

test("flow: a draft typed in the last moment with the cursor back in place is the accepted risk, and still sends no keys", async () => {
  const world = new World();
  world.beforeTmux = (argv) => {
    if (argv[0] === "if-shell") world.screen = [...DRAFT_SCREEN];
  };
  const { second } = await twoLooks(world);
  assert.equal(second.reason, "confirmed");
  assert.equal(world.respawns, 1);
  assertSafe(world);
  assert.equal(ledger(world).find((line) => line.kind === "intent")!.input_row_sha256, sha256Hex("│ >                          │"));
});

// ---------- once per marker ----------
const FIELDS = { marker_id: "", launch_command_sha256: "b".repeat(64), attempt_id: "other", watcher_pid: 4242, claimed_at: "2026-11-11T01:59:00.000Z" };

test("flow: a claim held by a live watcher is left alone", async () => {
  const world = new World();
  assert.equal(createClaim(nodeWatcherFs, world.seatDir, { ...FIELDS, marker_id: world.marker.marker_id }).result, "created");
  world.alive.add(4242);
  const { second } = await twoLooks(world);
  assert.deepEqual(second, { class: "idle", reason: "in_progress_elsewhere" });
  assert.equal(world.respawns, 0);
  assert.equal(claimOf(world)?.state, "claimed");
  assertSafe(world);
});

test("flow: a claim whose watcher died is looked up once, then the seat stops instead of retrying", async () => {
  const world = new World();
  createClaim(nodeWatcherFs, world.seatDir, { ...FIELDS, marker_id: world.marker.marker_id });
  const { first, second, seat, memory } = await twoLooks(world);
  assert.deepEqual(first, { class: "progress", reason: "outcome_unknown" }, "the inquiry does not wait for the screen to settle");
  assert.deepEqual(second, { class: "idle", reason: "halted" });
  assert.equal(world.respawns, 0);
  assert.equal(claimOf(world)?.state, "unknown_quarantined");
  assert.deepEqual(kinds(world).filter((kind) => kind === "outcome_unknown"), ["outcome_unknown"]);
  assert.equal(seatHalted(world), true);
  assert.deepEqual(await tickSeat(world.ports, seat, memory), { class: "idle", reason: "halted" });
  assert.equal(world.respawns, 0);
  assertSafe(world);
});

test("flow: a respawning claim whose watcher died is closed as confirmed when the new conversation is there", async () => {
  const world = new World();
  const created = createClaim(nodeWatcherFs, world.seatDir, { ...FIELDS, marker_id: world.marker.marker_id });
  assert.equal(created.result, "created");
  if (created.result !== "created") throw new Error("claim not created");
  advanceClaim(nodeWatcherFs, world.seatDir, created.claim, { state: "respawning", respawn_started_at: world.iso(), pane_pid_before: 5000 });
  world.respawn();
  const { first, second } = await twoLooks(world);
  assert.deepEqual(first, { class: "progress", reason: "confirmed_by_inquiry" });
  assert.deepEqual(second, { class: "idle", reason: "claim_exists" });
  assert.equal(world.respawns, 1);
  assert.deepEqual([claimOf(world)?.state, claimOf(world)?.resolution], ["done", "confirmed_by_inquiry"]);
  assert.equal(seatHalted(world), false);
});

test("flow: a seat with no marker file is idle, touches neither tmux nor the ledger", async () => {
  const world = new World();
  const result = await tickSeat(world.ports, seatFrom({ agent_id: "nobody" }), {});
  assert.deepEqual(result, { class: "idle", reason: "no_marker" });
  assert.equal(world.calls.length, 0);
  assert.deepEqual(ledger(world), []);
});

test("flow: the inquiry leaves a finished claim alone", () => {
  const world = new World();
  const created = createClaim(nodeWatcherFs, world.seatDir, { ...FIELDS, marker_id: world.marker.marker_id });
  if (created.result !== "created") throw new Error("claim not created");
  const done = advanceClaim(nodeWatcherFs, world.seatDir, created.claim, { state: "done", resolution: "confirmed" });
  assert.equal(resolveExistingClaim(world.ports, seatFrom(), world.seatDir, world.marker, done!), null);
  assert.equal(world.calls.length, 0);
});

test("flow: a second command with the old pane process is answered NOT_RESPAWNED after the first respawn", async () => {
  const world = new World();
  await twoLooks(world);
  assert.equal(world.respawns, 1);
  const again = conditionalRespawn(world.tmux, { pane_id: "%7", pane_pid: 5000, cursor_x: 4, cursor_y: 2, session_attached: 0, launch_command: LAUNCH_COMMAND });
  assert.equal(again, "not_respawned");
  assert.equal(world.respawns, 1);
});

test("flow: two watchers racing for one marker give one respawn", async () => {
  const world = new World();
  const seat = seatFrom();
  const ports = world.ports;
  const other: WatcherFs = {
    ...nodeWatcherFs,
    createExclusive: (path, text) => {
      nodeWatcherFs.createExclusive(path, JSON.stringify({ schema_version: "kusabi-rotation-claim/v1", marker_id: world.marker.marker_id, attempt_id: "first", watcher_pid: 4300, state: "claimed" }));
      return nodeWatcherFs.createExclusive(path, text);
    },
  };
  const memory: SeatMemory = {};
  await tickSeat(ports, seat, memory);
  await world.settle();
  const result = await tickSeat({ ...world.ports, fs: other }, seat, memory);
  assert.deepEqual(result, { class: "idle", reason: "in_progress_elsewhere" });
  assert.equal(world.respawns, 0);
  assertSafe(world);
});

test("flow: a second watcher during the confirmation wait does nothing", async () => {
  const world = new World();
  world.mode = "delayed";
  const seat = seatFrom();
  const memory: SeatMemory = {};
  await tickSeat(world.ports, seat, memory);
  await world.settle();
  const seen: unknown[] = [];
  const base = world.ports;
  const ports = {
    ...base,
    sleep: async (ms: number) => {
      if (seen.length === 0) {
        seen.push(await tickSeat({ ...base, watcher_pid: 4400 }, seat, {}));
      }
      await base.sleep(ms);
    },
  };
  const result = await tickSeat(ports, seat, memory);
  assert.deepEqual(result, { class: "progress", reason: "confirmed" });
  assert.deepEqual(seen, [{ class: "idle", reason: "in_progress_elsewhere" }]);
  assert.equal(world.respawns, 1);
  assertSafe(world);
});

const WRITE_FAILURES: Array<[string, Partial<WatcherFs>, string]> = [
  ["the claim cannot be created", { createExclusive: () => { throw new Error("disk"); } }, "claim_unwritable"],
  ["the evidence cannot be written", { appendDurable: () => { throw new Error("disk"); } }, "ledger_unwritable"],
  ["the claim cannot move to respawning", { replace: (path: string, value: unknown) => { if ((value as { state?: string }).state === "respawning") throw new Error("disk"); nodeWatcherFs.replace(path, value); } }, "claim_unwritable"],
];
for (const [name, patch, reason] of WRITE_FAILURES) {
  test(`flow: no respawn when ${name}`, async () => {
    const world = new World();
    world.fsPort = { ...nodeWatcherFs, ...patch };
    const { second } = await twoLooks(world);
    assert.deepEqual(second, { class: "unobservable", reason });
    assert.equal(world.respawns, 0);
    assertSafe(world);
  });
}

test("flow: a claim file that cannot be read stops the seat for that marker", async () => {
  const world = new World();
  mkdirSync(join(world.seatDir, "claims"), { recursive: true });
  writeFileSync(claimPath(world.seatDir, world.marker.marker_id), "{broken");
  const { second } = await twoLooks(world);
  assert.deepEqual(second, { class: "unobservable", reason: "claim_unreadable" });
  assert.equal(world.respawns, 0);
});

test("flow: when the line after the respawn cannot be written the seat is stopped, and the confirmation still runs", async () => {
  const world = new World();
  world.fsPort = {
    ...nodeWatcherFs,
    appendDurable: (path, text) => {
      if (text.includes('"kind":"respawn_issued"')) throw new Error("disk");
      nodeWatcherFs.appendDurable(path, text);
    },
  };
  const { second } = await twoLooks(world);
  assert.deepEqual(second, { class: "progress", reason: "confirmed" });
  assert.equal(world.respawns, 1);
  assert.equal(seatHalted(world), true);
  assert.equal(JSON.parse(nodeWatcherFs.readText(seatHaltPath(world.seatDir))!).reason, "ledger_unwritable_after_respawn");
});

// ---------- confirmation ----------
test("flow: a new conversation that starts late but inside the wait is confirmed", async () => {
  const world = new World();
  world.mode = "delayed";
  const { second } = await twoLooks(world);
  assert.deepEqual(second, { class: "progress", reason: "confirmed" });
  assert.equal(world.respawns, 1);
});

const UNCONFIRMED: Array<[string, RespawnMode]> = [
  ["no new conversation starts", "no_start"],
  ["the start names another marker", "wrong_marker"],
  ["the conversation id did not change", "same_session"],
  ["the host process did not change", "same_host_pid"],
  ["the start came from /clear", "source_clear"],
  ["the start record is older than the respawn", "old_turn"],
  ["the pane process did not change", "pid_unchanged"],
];
for (const [name, mode] of UNCONFIRMED) {
  test(`flow: ${name} → unconfirmed, the seat is stopped and nothing is retried`, async () => {
    const world = new World();
    world.mode = mode;
    const { second, seat, memory } = await twoLooks(world);
    assert.deepEqual(second, { class: "progress", reason: "unconfirmed" });
    assert.equal(world.respawns, 1);
    assert.ok(world.now - NOW0 >= 60_000, "waited the configured period");
    assert.equal(claimOf(world)?.state, "unconfirmed");
    assert.equal(seatHalted(world), true);
    assert.deepEqual(kinds(world).slice(-2), ["respawn_issued", "unconfirmed"]);
    assert.deepEqual(await tickSeat(world.ports, seat, memory), { class: "idle", reason: "halted" });
    assert.equal(world.respawns, 1);
    assertSafe(world);
  });
}

test("flow: a start that arrives after the wait is too late and counts as unconfirmed", async () => {
  const world = new World();
  world.mode = "delayed";
  world.delayMs = 120_000;
  const { second } = await twoLooks(world);
  assert.equal(second.reason, "unconfirmed");
});

test("flow: a respawn command that reports failure but did nothing is not retried, the seat stops", async () => {
  const world = new World();
  world.mode = "call_fails_nothing_happens";
  const { second, seat, memory } = await twoLooks(world);
  assert.deepEqual(second, { class: "progress", reason: "outcome_unknown" });
  assert.equal(world.respawns, 1);
  assert.equal(claimOf(world)?.state, "unknown_quarantined");
  assert.equal(seatHalted(world), true);
  assert.deepEqual(await tickSeat(world.ports, seat, memory), { class: "idle", reason: "halted" });
  assert.equal(world.respawns, 1);
});

test("flow: a respawn command that reports failure but did happen is found by the inquiry", async () => {
  const world = new World();
  world.mode = "call_fails_but_happened";
  const { second } = await twoLooks(world);
  assert.deepEqual(second, { class: "progress", reason: "confirmed_by_inquiry" });
  assert.equal(world.respawns, 1);
  assert.deepEqual([claimOf(world)?.state, claimOf(world)?.resolution], ["done", "confirmed_by_inquiry"]);
  assert.equal(ledger(world).at(-1)!.detail, "by_inquiry");
  assert.equal(seatHalted(world), false);
});

// ---------- rate and age limits come from the ledger ----------
test("flow: a recent respawn in the ledger holds the next one back, and a stale marker is not used", async () => {
  const world = new World();
  const line = (offset: number) => `${JSON.stringify({ schema_version: "kusabi-rotation-watcher-evidence/v1", kind: "respawn_issued", agent_id: "kusabi", project: "agent-memory", at: new Date(NOW0 + offset).toISOString() })}\n`;
  nodeWatcherFs.appendDurable(ledgerPath(world.root), line(-60_000));
  const { second } = await twoLooks(world);
  assert.deepEqual(second, { class: "waiting", reason: "min_interval" });
  assert.equal(world.respawns, 0);
  const stale = new World();
  stale.writeMarkerAndTurn({ marker: { saved_at: stale.iso(-3_600_000) } });
  const result = await twoLooks(stale);
  assert.deepEqual(result.second, { class: "idle", reason: "marker_expired" });
});

// ---------- the loop ----------
const collect = () => { const lines: string[] = []; return { lines, log: (line: string) => { lines.push(line); } }; };

test("loop: while a global HALT file exists nothing is read and nothing is changed", async () => {
  const world = new World();
  world.writeConfig();
  writeHalt(nodeWatcherFs, globalHaltPath(world.root), "operator", world.iso());
  const out = collect();
  const result = await runWatcher(world.ports, { poll_ms: 1_000, max_passes: 3, log: out.log });
  assert.deepEqual(result, { passes: 3, halted_global: false });
  assert.equal(world.calls.length, 0);
  assert.deepEqual(out.lines, []);
});

test("loop: passes where the watcher cannot see are counted, then it writes the global HALT and stops", async () => {
  const world = new World();
  world.writeConfig([SEAT_JSON], { no_progress_halt_limit: 3 });
  world.screen = ["Allow this command?", "  1. Yes"];
  const out = collect();
  const result = await runWatcher(world.ports, { poll_ms: 5_000, log: out.log });
  // Four passes wait for the screen to settle (waiting is not counted), then three cannot find the input row.
  assert.deepEqual(result, { passes: 7, halted_global: true });
  assert.equal(JSON.parse(nodeWatcherFs.readText(globalHaltPath(world.root))!).reason, "no_progress");
  assert.equal(out.lines.length, 3, "a line per change of state, and the halt");
  assert.equal(JSON.parse(out.lines[2]).halt, "global");
  assert.equal(world.respawns, 0);
  const calls = world.calls.length;
  await runWatcher(world.ports, { poll_ms: 5_000, max_passes: 2, log: out.log });
  assert.equal(world.calls.length, calls, "idle after the halt");
});

test("loop: a missing config counts as no progress and stops at the default limit", async () => {
  const world = new World();
  const out = collect();
  const result = await runWatcher(world.ports, { poll_ms: 5_000, log: out.log });
  assert.deepEqual(result, { passes: 30, halted_global: true });
  assert.equal(JSON.parse(out.lines[0]).config_reason, "config_missing");
  assert.equal(world.calls.length, 0);
});

test("loop: waiting repeats the same line once, and the ledger holds one skipped line per reason", async () => {
  const world = new World();
  world.writeConfig();
  world.pane.attached = 1;
  world.clients = [NOW0 / 1_000 + 1_000];
  const out = collect();
  const result = await runWatcher(world.ports, { poll_ms: 5_000, max_passes: 10, log: out.log });
  assert.deepEqual(result, { passes: 10, halted_global: false });
  assert.equal(out.lines.length, 2);
  assert.deepEqual(ledger(world).filter((line) => line.kind === "skipped").map((line) => line.reason), ["screen_not_steady", "human_active"]);
  assert.equal(world.respawns, 0);
});

test("loop: a fresh marker is respawned once over many passes", async () => {
  const world = new World();
  world.writeConfig();
  const out = collect();
  const result = await runWatcher(world.ports, { poll_ms: 5_000, max_passes: 12, log: out.log });
  assert.equal(result.halted_global, false);
  assert.equal(world.respawns, 1);
  assert.equal(claimOf(world)?.resolution, "confirmed");
  assertSafe(world);
});

test("loop: a pass reads the config every time, rejects bad seats and serves the good ones", async () => {
  const world = new World();
  world.writeConfig([SEAT_JSON, { ...SEAT_JSON, agent_id: "bad id" }]);
  const pass = await runPass(world.ports, new Map());
  assert.equal(pass.config_reason, null);
  assert.deepEqual(pass.rejected, [{ index: 1, reason: "agent_id_invalid" }]);
  assert.equal(pass.seats.length, 1);
  assert.equal(pass.halt_limit, 30);
});

const CONFIG_PROBLEMS: Array<[string, (world: World) => void, string]> = [
  ["missing", () => undefined, "config_missing"],
  ["writable by others", (w) => { w.writeConfig(); chmodSync(watcherConfigPath(w.root), 0o666); }, "config_file_writable_by_others"],
  ["folder writable by others", (w) => { w.writeConfig(); chmodSync(w.root, 0o777); }, "config_folder_writable_by_others"],
  ["not JSON", (w) => { writeFileSync(watcherConfigPath(w.root), "{broken", { mode: 0o600 }); }, "config_not_json"],
  ["unreadable", (w) => { w.writeConfig(); w.fsPort = { ...nodeWatcherFs, readText: (path) => (path === watcherConfigPath(w.root) ? null : nodeWatcherFs.readText(path)) }; }, "config_unreadable"],
];
for (const [name, setup, reason] of CONFIG_PROBLEMS) {
  test(`loop: a config that is ${name} starts nothing (${reason})`, async () => {
    const world = new World();
    setup(world);
    const pass = await runPass(world.ports, new Map());
    assert.equal(pass.config_reason, reason);
    assert.deepEqual(pass.seats, []);
    assert.equal(isNonProgress(pass), true);
    assert.equal(world.calls.length, 0);
  });
}

test("loop: only unobservable passes count as no progress", () => {
  const pass = (...classes: string[]) => ({ config_reason: null, rejected: [], halt_limit: 3, seats: classes.map((tickClass) => ({ agent_id: "a", project: "p", tick: { class: tickClass as never, reason: "x" } })) });
  assert.equal(isNonProgress(pass("unobservable")), true);
  assert.equal(isNonProgress(pass("unobservable", "progress")), false);
  assert.equal(isNonProgress(pass("waiting")), false);
  assert.equal(isNonProgress(pass("idle", "mismatch")), false);
  assert.equal(isNonProgress(pass()), false);
});

// ---------- command line and probe ----------
test("cli: arguments are parsed strictly", () => {
  assert.deepEqual(parseWatcherArgs(["once"]), { command: "once" });
  assert.deepEqual(parseWatcherArgs(["run"]), { command: "run", max_passes: null });
  assert.deepEqual(parseWatcherArgs(["run", "--max-passes", "3"]), { command: "run", max_passes: 3 });
  assert.deepEqual(parseWatcherArgs(["probe", "--tmux-target", "s:0.0", "--prompt-marker", ">", "--prompt-marker", "›", "--placeholder-pattern", "Try", "--launch-script", "/x.sh"]), {
    command: "probe",
    options: { tmux_target: "s:0.0", prompt_markers: [">", "›"], placeholder_patterns: ["Try"], launch_script: "/x.sh" },
  });
  for (const bad of [[], ["unknown"], ["once", "x"], ["run", "--max-passes"], ["run", "--max-passes", "0"], ["run", "--max-passes", "x"], ["run", "--other", "1"], ["probe"], ["probe", "--tmux-target", "s:0.0"], ["probe", "--prompt-marker", ">"], ["probe", "--tmux-target"], ["probe", "--bogus", "1"]]) {
    assert.equal(parseWatcherArgs(bad).command, "error", JSON.stringify(bad));
  }
});

async function cli(world: World, argv: string[], pollMs = 1) {
  const out: string[] = [];
  const code = await runWatcherCli(argv, world.ports, (line) => { out.push(line); }, pollMs);
  return { code, out: out.join("") };
}

test("cli: a bad command prints the usage and exits 2", async () => {
  const result = await cli(new World(), ["nope"]);
  assert.equal(result.code, 2);
  assert.ok(result.out.startsWith("usage:"));
});

test("cli: probe reads the pane with read-only commands and never evaluates the respawn", async () => {
  const world = new World();
  const result = await cli(world, ["probe", "--tmux-target", "seat:0.0", "--prompt-marker", ">", "--launch-script", "/seats/kusabi-launch.sh"]);
  assert.equal(result.code, 0);
  const report = JSON.parse(result.out);
  assert.deepEqual(
    [report.schema_version, report.pane_resolved, report.pane_read, report.tmux_version, report.launch_command_chars_ok, report.conditional_respawn_form_supported, report.input_row_found, report.input_empty, report.cursor_at_input_head, report.clients_readable, report.client_count, report.launch_script_sha256, report.pane_start_command],
    ["kusabi-rotation-watcher-probe/v1", true, true, "3.6a", true, true, true, true, true, true, 0, LAUNCH_SHA, LAUNCH_COMMAND],
  );
  assert.equal(world.respawnCalls().length, 0);
  assert.equal(world.respawns, 0);
  assert.deepEqual([...new Set(world.calls.map((call) => call[0]))].sort(), ["capture-pane", "display-message", "list-clients"]);
  assertSafe(world);
});

test("cli: probe reports what it could not read as false or null", async () => {
  const world = new World();
  world.tmuxDown = true;
  const report = JSON.parse((await cli(world, ["probe", "--tmux-target", "seat:0.0", "--prompt-marker", ">"])).out);
  assert.deepEqual(
    [report.pane_resolved, report.pane_read, report.tmux_version, report.conditional_respawn_form_supported, report.input_row_found, report.clients_readable, report.client_count, report.launch_script_sha256],
    [false, false, null, false, false, false, null, null],
  );
});

test("cli: once prints one pass and exits 1 only on a config problem", async () => {
  const world = new World();
  const missing = await cli(world, ["once"]);
  assert.equal(missing.code, 1);
  assert.equal(JSON.parse(missing.out).config_reason, "config_missing");
  world.writeConfig();
  const fine = await cli(world, ["once"]);
  assert.equal(fine.code, 0);
  assert.deepEqual(JSON.parse(fine.out).seats[0].tick, { class: "waiting", reason: "screen_not_steady" });
});

test("cli: run exits 0 after its passes and 3 when the global HALT was written", async () => {
  const world = new World();
  world.writeConfig();
  assert.equal((await cli(world, ["run", "--max-passes", "2"])).code, 0);
  const stopped = new World();
  const result = await cli(stopped, ["run"]);
  assert.equal(result.code, 3);
  assert.ok(result.out.includes('"halt":"global"'));
});

test("cli: the real ports read the clock, files and processes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rotation-watcher-real-"));
  const ports = realPorts({ AGENT_MEMORY_HOME: dir });
  assert.equal(ports.root, join(dir, "rotation"));
  assert.equal(ports.watcher_pid, process.pid);
  assert.equal(ports.uid, process.getuid!());
  assert.ok(Math.abs(ports.now_ms() - Date.now()) < 5_000);
  assert.notEqual(ports.new_attempt_id(), ports.new_attempt_id());
  assert.equal(ports.pid_alive(process.pid), true);
  assert.equal(ports.pid_alive(2_147_483_000), false);
  const file = join(dir, "script.sh");
  writeFileSync(file, "echo hi\n");
  assert.equal(ports.hash_file(file), sha256Hex("echo hi\n"));
  assert.equal(ports.hash_file(join(dir, "missing.sh")), null);
  await ports.sleep(1);
});

// ---------- the real command line, in a separate process ----------
const run = (args: string[], env: Record<string, string>, extra: string[] = []) =>
  spawnSync(process.execPath, ["--import", "tsx", ...extra, ...args], { encoding: "utf8", env: { ...process.env, ...env }, cwd: process.cwd() });

test("process: the entry file prints usage, runs a pass and probes without a tmux binary", () => {
  const dir = mkdtempSync(join(tmpdir(), "rotation-watcher-proc-"));
  const emptyPath = join(dir, "bin");
  mkdirSync(emptyPath);
  const env = { AGENT_MEMORY_HOME: join(dir, "home"), PATH: emptyPath };
  const entry = join(process.cwd(), "src", "rotation-watcher.ts");
  const usage = run([entry], env);
  assert.equal(usage.status, 2);
  assert.ok(usage.stdout.startsWith("usage:"));
  const once = run([entry, "once"], env);
  assert.equal(once.status, 1);
  assert.equal(JSON.parse(once.stdout).config_reason, "config_missing");
  const probe = run([entry, "probe", "--tmux-target", "seat:0.0", "--prompt-marker", ">"], env);
  assert.equal(probe.status, 0);
  assert.equal(JSON.parse(probe.stdout).pane_resolved, false);
});

test("process: importing the module without being the entry file runs nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "rotation-watcher-import-"));
  const entry = join(process.cwd(), "src", "rotation-watcher.ts");
  const result = spawnSync(process.execPath, ["--import", "tsx", "-e", `import(${JSON.stringify(`file://${entry}`)})`, join(dir, "not-a-file")], {
    encoding: "utf8",
    env: { ...process.env, AGENT_MEMORY_HOME: join(dir, "home") },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  const noArgument = spawnSync(process.execPath, ["--import", "tsx", "-e", `import(${JSON.stringify(`file://${entry}`)})`], {
    encoding: "utf8",
    env: { ...process.env, AGENT_MEMORY_HOME: join(dir, "home") },
  });
  assert.equal(noArgument.status, 0, noArgument.stderr);
  assert.equal(noArgument.stdout, "");
});

// ---------- the source itself ----------
const sources = readdirSync(join(process.cwd(), "src")).filter((name) => /^rotation-watcher.*\.ts$/.test(name));

test("source: no key-sending or other out-of-set tmux command is named in the watcher, and respawn-pane only in the tmux module", () => {
  assert.ok(sources.length >= 10);
  for (const name of sources) {
    const text = readFileSync(join(process.cwd(), "src", name), "utf8");
    for (const word of FORBIDDEN_TMUX_WORDS) assert.ok(!text.includes(word), `${word} in ${name}`);
    assert.equal(text.includes("respawn-pane"), name === "rotation-watcher-tmux.ts", `respawn-pane in ${name}`);
    assert.ok(!/import \{[^}]*\b(exec|execSync|spawn|spawnSync)\b[^}]*\} from "node:child_process"/.test(text), `shell-capable import in ${name}`);
    assert.ok(!/shell:\s*true/.test(text), `shell option in ${name}`);
    assert.ok(!/DATABASE_URL|AGENT_MEMORY_DB|createStore|pg\b/.test(text), `database access in ${name}`);
  }
});

test("source: the decision core does not read the clock, randomness or ids (standard S4)", () => {
  for (const name of ["rotation-watcher-core.ts", "rotation-watcher-screen.ts", "rotation-watcher-config.ts"]) {
    const text = readFileSync(join(process.cwd(), "src", name), "utf8");
    for (const word of ["Date.now", "new Date()", "Math.random", "randomUUID", "readFileSync", "process.env"]) assert.ok(!text.includes(word), `${word} in ${name}`);
  }
});

test("source: the process runners pass fixed argument arrays and the C locale", () => {
  const tmuxText = readFileSync(join(process.cwd(), "src", "rotation-watcher-tmux.ts"), "utf8");
  const psText = readFileSync(join(process.cwd(), "src", "rotation-watcher-ps.ts"), "utf8");
  assert.ok(tmuxText.includes("execFileSync"));
  assert.ok(psText.includes("execFileSync"));
  assert.ok(psText.includes("...PS_ENV"));
  assert.deepEqual(PS_ENV, { LC_ALL: "C" });
});

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
  console.error(`FAIL test-rotation-watcher-flow (${failed}/${cases.length})`);
  process.exit(1);
}
console.log(`PASS test-rotation-watcher-flow (${cases.length} cases)`);
void EMPTY_SCREEN;
