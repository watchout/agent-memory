/**
 * Session rotation, status view (261110-session-rotation, FR4.2): the read-only
 * command that shows a seat's marker, turn, hook state and watcher claim. Each
 * file shows as none / unreadable / valid; the view never writes, and never
 * prints conversation text or a path.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildMarker,
  seatDirectory,
  sha256Hex,
  writeHookState,
  writeJsonAtomic,
  outputWrittenPath,
  writeMarker,
  writeOutputWritten,
  writeTurn,
} from "./session-rotation-files.js";
import { ROTATION_STATUS_SCHEMA, buildRotationStatus, runRotationStatusCli } from "./session-rotation-status.js";
import { buildHookInputStatus } from "./session-rotation-status.js";
import { hookInputDiagnosticPath, parseHookInputDiagnostic, writeHookInputDiagnostic } from "./hook-input-diagnostics.js";
import { CLAUDE_SESSION_START_ADAPTER_ID } from "./claude-session-start.js";
import { CLAUDE_ROTATION_STOP_ADAPTER_ID } from "./session-rotation-stop.js";
import { CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID } from "./transcript-stop-capture.js";

const cases: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

const identity = { pane_id: "%7", tmux_socket: "/tmp/sock", host_pid: 42, host_started_at: "Tue Nov 3 10:00:00 2026" };
const markerFields = {
  agent_id: "kusabi", project: "agent-memory", host: "claude_code" as const, session_id: "s1", ...identity,
  pack_ref: "pack-1", pack_content_sha256: sha256Hex("body"), measured_tokens: 310_000, threshold_tokens: 300_000,
  saved_at: "2026-11-11T01:00:00.000Z", handoff_source: "seat_text" as const,
};
const freshSeat = () => {
  const home = mkdtempSync(join(tmpdir(), "rot-status-"));
  const directory = seatDirectory(join(home, "rotation"), "kusabi", "agent-memory");
  mkdirSync(directory, { recursive: true });
  return { home, directory };
};
const listing = (directory: string) => readdirSync(directory, { recursive: true }).map(String).sort();

test("an empty seat: every file is none", () => {
  const { directory } = freshSeat();
  const status = buildRotationStatus(directory, "kusabi", "agent-memory");
  assert.deepEqual(status, {
    schema_version: ROTATION_STATUS_SCHEMA, agent_id: "kusabi", project: "agent-memory",
    marker: { file: "none" }, turn: { file: "none" }, hook_state: { file: "none" }, claim: { file: "none" }, output_written: { file: "none" },
  });
});

test("a saved conversation: marker, turn and hook state are shown with ids and counts only", () => {
  const { directory } = freshSeat();
  const marker = buildMarker(markerFields);
  writeMarker(directory, marker);
  writeTurn(directory, { agent_id: "kusabi", project: "agent-memory", host: "claude_code", session_id: "s1", state: "idle", source: "startup", rotation_marker_id: null, at: "2026-11-11T01:00:05.000Z", ...identity });
  writeHookState(directory, { session_id: "s1", blocked_at: "2026-11-11T00:59:00.000Z", measured_tokens: 310_000, threshold_tokens: 300_000 });
  const status = buildRotationStatus(directory, "kusabi", "agent-memory");
  assert.deepEqual(status.marker, {
    file: "valid", session_id: "s1", host: "claude_code", marker_id: marker.marker_id, saved_at: "2026-11-11T01:00:00.000Z",
    handoff_source: "seat_text", measured_tokens: 310_000, threshold_tokens: 300_000, pane_id: "%7",
  });
  assert.deepEqual(status.turn, { file: "valid", state: "idle", session_id: "s1", at: "2026-11-11T01:00:05.000Z", source: "startup", rotation_marker_id: null });
  assert.deepEqual(status.hook_state, { file: "valid", session_id: "s1", blocked_at: "2026-11-11T00:59:00.000Z", measured_tokens: 310_000 });
  assert.deepEqual(status.claim, { file: "none" }, "no claim yet for this marker");
  const text = JSON.stringify(status);
  assert.ok(!text.includes("/tmp/sock") && !text.includes(sha256Hex("body")) && !text.includes("pack-1"), "no socket path, content digest or pack reference");
});

test("the watcher's claim for the current marker is shown; a claim for another marker is not", () => {
  const { directory } = freshSeat();
  const marker = buildMarker(markerFields);
  writeMarker(directory, marker);
  writeJsonAtomic(join(directory, "claims", `${marker.marker_id}.json`), { marker_id: marker.marker_id, state: "done", respawn_started_at: "2026-11-11T01:01:00.000Z" });
  assert.deepEqual(buildRotationStatus(directory, "kusabi", "agent-memory").claim, { file: "valid", state: "done", respawn_started_at: "2026-11-11T01:01:00.000Z" });
  writeJsonAtomic(join(directory, "claims", `${marker.marker_id}.json`), { marker_id: "0".repeat(64), state: "done" });
  assert.deepEqual(buildRotationStatus(directory, "kusabi", "agent-memory").claim, { file: "unreadable" }, "present but not this marker's claim");
});

test("FR11.6: the output-written record of the current marker is shown by its presence and times only; another marker's is not", () => {
  const { directory } = freshSeat();
  const marker = buildMarker(markerFields);
  writeMarker(directory, marker);
  assert.deepEqual(buildRotationStatus(directory, "kusabi", "agent-memory").output_written, { file: "none" });
  const record = {
    marker_id: marker.marker_id, agent_id: "kusabi", project: "agent-memory", host: "claude_code" as const, session_id: "s2", source: "startup" as const, ...identity,
    turn_at: "2026-11-11T01:01:00.000Z", output_written_at: "2026-11-11T01:01:00.500Z",
  };
  assert.equal(writeOutputWritten(directory, record), "written");
  const shown = buildRotationStatus(directory, "kusabi", "agent-memory").output_written;
  assert.deepEqual(shown, { file: "valid", session_id: "s2", output_written_at: "2026-11-11T01:01:00.500Z" });
  const text = JSON.stringify(buildRotationStatus(directory, "kusabi", "agent-memory"));
  assert.ok(!/delivered|received|delivery/.test(text), "the view names only the observed fact");
  assert.ok(!text.includes("/tmp/sock"), "no socket path");
  // The existing items are unchanged by the new one.
  assert.deepEqual(buildRotationStatus(directory, "kusabi", "agent-memory").claim, { file: "none" });
  writeFileSync(outputWrittenPath(directory, marker.marker_id), "{broken");
  assert.deepEqual(buildRotationStatus(directory, "kusabi", "agent-memory").output_written, { file: "unreadable" });
  // No marker, so no record is looked up.
  const empty = freshSeat();
  assert.deepEqual(buildRotationStatus(empty.directory, "kusabi", "agent-memory").output_written, { file: "none" });
});

test("a file that exists but cannot be trusted is unreadable, never none (S5)", () => {
  const { directory } = freshSeat();
  const marker = buildMarker(markerFields);
  writeMarker(directory, marker);
  const raw = JSON.parse(readFileSync(join(directory, "marker.json"), "utf8")) as Record<string, unknown>;
  writeFileSync(join(directory, "marker.json"), JSON.stringify({ ...raw, measured_tokens: 1 }));
  writeFileSync(join(directory, "turn.json"), "{broken");
  writeFileSync(join(directory, "hook-state.json"), JSON.stringify({ schema_version: "other/v1" }));
  const status = buildRotationStatus(directory, "kusabi", "agent-memory");
  assert.deepEqual(status.marker, { file: "unreadable" }, "marker digest no longer matches its fields");
  assert.deepEqual(status.turn, { file: "unreadable" });
  assert.deepEqual(status.hook_state, { file: "unreadable" });
  assert.deepEqual(status.claim, { file: "none" }, "no trusted marker, so no claim is looked up");
  assert.deepEqual(status.output_written, { file: "none" }, "nor an output-written record");
});

test("the view writes nothing", () => {
  const { directory } = freshSeat();
  writeMarker(directory, buildMarker(markerFields));
  const before = listing(directory);
  const bytes = readFileSync(join(directory, "marker.json"), "utf8");
  buildRotationStatus(directory, "kusabi", "agent-memory");
  assert.deepEqual(listing(directory), before);
  assert.equal(readFileSync(join(directory, "marker.json"), "utf8"), bytes);
});

test("the command: names from arguments or the environment, one JSON line, exit 0", () => {
  const { home, directory } = freshSeat();
  writeMarker(directory, buildMarker(markerFields));
  const lines: string[] = [];
  assert.equal(runRotationStatusCli(["--agent-id", "kusabi", "--project", "agent-memory"], { AGENT_MEMORY_HOME: home }, (line) => lines.push(line)), 0);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]?.endsWith("\n"));
  assert.equal((JSON.parse(lines[0] ?? "{}") as { marker: { file: string } }).marker.file, "valid");
  const fromEnv: string[] = [];
  assert.equal(runRotationStatusCli([], { AGENT_MEMORY_HOME: home, AGENT_MEMORY_AGENT_ID: "kusabi", AGENT_MEMORY_PROJECT: "agent-memory" }, (line) => fromEnv.push(line)), 0);
  assert.equal(fromEnv.join(""), lines.join(""), "the same view");
  const other: string[] = [];
  assert.equal(runRotationStatusCli(["--agent-id", "someone-else", "--project", "agent-memory"], { AGENT_MEMORY_HOME: home }, (line) => other.push(line)), 0);
  assert.equal((JSON.parse(other[0] ?? "{}") as { marker: { file: string } }).marker.file, "none", "another seat's files are not shown");
});

test("the command refuses unknown arguments, missing names and names that are not plain", () => {
  const out: string[] = [];
  const write = (line: string) => out.push(line);
  assert.equal(runRotationStatusCli(["--agent-id"], {}, write), 2, "option without a value");
  assert.equal(runRotationStatusCli(["--other", "x"], {}, write), 2, "unknown option");
  assert.equal(runRotationStatusCli([], {}, write), 2, "no names at all");
  assert.equal(runRotationStatusCli(["--agent-id", "../escape", "--project", "p"], { AGENT_MEMORY_HOME: tmpdir() }, write), 2, "path-like name");
  assert.ok(out.every((line) => line.startsWith("usage:")));
  assert.ok(out.some((line) => line.includes("plain names")));
});

test("run as a process: prints the view, and importing the module prints nothing", () => {
  const { home } = freshSeat();
  const entry = join(process.cwd(), "src", "session-rotation-status.ts");
  const env = { ...process.env, AGENT_MEMORY_HOME: home };
  const run = spawnSync(process.execPath, ["--import", "tsx", entry, "--agent-id", "kusabi", "--project", "agent-memory"], { encoding: "utf8", env });
  assert.equal(run.status, 0, run.stderr);
  assert.equal((JSON.parse(run.stdout) as { schema_version: string }).schema_version, ROTATION_STATUS_SCHEMA);
  const imported = spawnSync(process.execPath, ["--import", "tsx", "-e", `import(${JSON.stringify(`file://${entry}`)})`], { encoding: "utf8", env });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "", "no output when imported, not run");
  const notAFile = spawnSync(process.execPath, ["--import", "tsx", "-e", `import(${JSON.stringify(`file://${entry}`)})`, join(home, "not-a-file")], { encoding: "utf8", env });
  assert.equal(notAFile.status, 0, notAFile.stderr);
  assert.equal(notAFile.stdout, "", "an entry path that cannot be resolved is not the entry file");
  const failing = spawnSync(process.execPath, ["--import", "tsx", entry, "--bogus", "x"], { encoding: "utf8", env });
  assert.equal(failing.status, 2);
  assert.ok(failing.stdout.startsWith("usage:"));
});


// ---------- FR10 (261110 hook input): the health check reads the diagnostic names, never the values ----------
const MARK = "SENTINEL_VALUE_NEVER_TO_APPEAR_7f3a";
const T0 = "2026-11-11T02:00:00.000Z";
const T1 = "2026-11-11T02:05:00.000Z";
const hookInputOf = (lines: string[]) => (JSON.parse(lines.join("")) as { hook_input?: Record<string, unknown> }).hook_input;
const statusLines = (home: string, agent = "kusabi", project = "agent-memory") => {
  const lines: string[] = [];
  assert.equal(runRotationStatusCli(["--agent-id", agent, "--project", project], { AGENT_MEMORY_HOME: home }, (line) => lines.push(line)), 0);
  return lines;
};
const record = (home: string, adapter: string, event: string, names: string[], at = T0, agent = "kusabi") =>
  writeHookInputDiagnostic({
    env: { AGENT_MEMORY_HOME: home }, agent_id: agent, project: "agent-memory", adapter_id: adapter,
    event, names, now: new Date(at), pid: 4242,
  });
const diagnosticFile = (home: string, adapter: string) => hookInputDiagnosticPath({ AGENT_MEMORY_HOME: home }, "kusabi", "agent-memory", adapter);

test("hook input: nothing recorded is none - and an empty list, not zero names", () => {
  const { home } = freshSeat();
  assert.deepEqual(hookInputOf(statusLines(home)), { file: "none", adapters: [] });
});

test("hook input: names, events and counts of every adapter that recorded, in adapter order, and nothing else", async () => {
  const { home } = freshSeat();
  await record(home, CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID, "UserPromptSubmit", ["prompt_id", "session_title"]);
  await record(home, CLAUDE_SESSION_START_ADAPTER_ID, "SessionStart", ["session_title"], T0);
  await record(home, CLAUDE_SESSION_START_ADAPTER_ID, "SessionStart", ["session_title"], T1);
  await record(home, CLAUDE_ROTATION_STOP_ADAPTER_ID, "Stop", ["effort", "background_tasks"]);
  const lines = statusLines(home);
  const hookInput = hookInputOf(lines) as { file: string; adapters: Array<Record<string, unknown>> };
  assert.equal(hookInput.file, "valid");
  assert.deepEqual(hookInput.adapters.map((adapter) => adapter.adapter_id), [...[
    CLAUDE_SESSION_START_ADAPTER_ID, CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID, CLAUDE_ROTATION_STOP_ADAPTER_ID,
  ]].sort());
  for (const adapter of hookInput.adapters) {
    const stored = parseHookInputDiagnostic(readFileSync(diagnosticFile(home, String(adapter.adapter_id)), "utf8"));
    assert.ok(stored);
    assert.deepEqual(adapter, {
      adapter_id: stored.adapter_id, file: "valid",
      entries: stored.entries.map((entry) => ({ event: entry.event, name: entry.name, count: entry.count, last_seen: entry.last_seen })),
      dropped_names: stored.dropped_names, invalid_names: stored.invalid_names,
    });
  }
  const start = hookInput.adapters.find((adapter) => adapter.adapter_id === CLAUDE_SESSION_START_ADAPTER_ID);
  assert.deepEqual(start?.entries, [{ event: "SessionStart", name: "session_title", count: 2, last_seen: T1 }]);
  const text = lines.join("");
  assert.equal(text.includes(home), false, "no path");
  assert.equal(text.includes("first_seen"), false, "names, events, counts and the last time seen only");
  assert.equal(text.includes("4242"), false, "no process id");
  assert.equal(text.includes(MARK), false);
});

test("hook input: another seat's records are not shown, and a name that is not plain is refused before any path is built", async () => {
  const { home } = freshSeat();
  await record(home, CLAUDE_SESSION_START_ADAPTER_ID, "SessionStart", ["session_title"], T0, "someone-else");
  assert.deepEqual(hookInputOf(statusLines(home)), { file: "none", adapters: [] });
  assert.equal(runRotationStatusCli(["--agent-id", "../escape", "--project", "agent-memory"], { AGENT_MEMORY_HOME: home }, () => undefined), 2);
});

test("hook input: the user id the trust checks expect is an input - another id, or none, makes a real record unreadable", async () => {
  const { home } = freshSeat();
  await record(home, CLAUDE_SESSION_START_ADAPTER_ID, "SessionStart", ["session_title"]);
  const env = { AGENT_MEMORY_HOME: home };
  const own = process.getuid!();
  assert.equal(buildHookInputStatus(env, "kusabi", "agent-memory", own).file, "valid");
  assert.deepEqual(buildHookInputStatus(env, "kusabi", "agent-memory", own + 1), { file: "unreadable", adapters: [] });
  assert.deepEqual(buildHookInputStatus(env, "kusabi", "agent-memory", null), { file: "unreadable", adapters: [] });
  assert.equal(buildHookInputStatus(env, "kusabi", "agent-memory").file, "valid", "the default is the process's own id");
});

test("hook input: a file that cannot be trusted is unreadable, never none or zero names (S5)", async () => {
  const unreadable = async (label: string, damage: (file: string, folder: string) => void | Promise<void>) => {
    const { home } = freshSeat();
    await record(home, CLAUDE_SESSION_START_ADAPTER_ID, "SessionStart", ["session_title"]);
    await record(home, CLAUDE_ROTATION_STOP_ADAPTER_ID, "Stop", ["effort"]);
    const file = diagnosticFile(home, CLAUDE_SESSION_START_ADAPTER_ID);
    await damage(file, dirname(file));
    const hookInput = hookInputOf(statusLines(home)) as { file: string; adapters: Array<{ adapter_id: string; file: string; entries?: unknown }> };
    assert.equal(hookInput.file, "unreadable", label);
    const damaged = hookInput.adapters.find((adapter) => adapter.adapter_id === CLAUDE_SESSION_START_ADAPTER_ID);
    assert.deepEqual(damaged, { adapter_id: CLAUDE_SESSION_START_ADAPTER_ID, file: "unreadable" }, `${label}: no names from a file that cannot be trusted`);
    const intact = hookInput.adapters.find((adapter) => adapter.adapter_id === CLAUDE_ROTATION_STOP_ADAPTER_ID);
    assert.equal(intact?.file, "valid", `${label}: another adapter's valid record is still shown`);
  };
  const good = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  await unreadable("broken JSON", (file) => writeFileSync(file, "{broken", { mode: 0o600 }));
  await unreadable("empty file", (file) => writeFileSync(file, "", { mode: 0o600 }));
  await unreadable("another schema", (file) => writeFileSync(file, JSON.stringify({ ...good(file), schema_version: "other/v1" }), { mode: 0o600 }));
  await unreadable("an extra field that could carry a value", (file) => writeFileSync(file, JSON.stringify({ ...good(file), session_id: MARK }), { mode: 0o600 }));
  await unreadable("a count that is not a number", (file) => {
    const stored = good(file) as { entries: Array<Record<string, unknown>> };
    writeFileSync(file, JSON.stringify({ ...stored, entries: [{ ...stored.entries[0], count: "1" }] }), { mode: 0o600 });
  });
  await unreadable("a name that is not a plain name", (file) => {
    const stored = good(file) as { entries: Array<Record<string, unknown>> };
    writeFileSync(file, JSON.stringify({ ...stored, entries: [{ ...stored.entries[0], name: `a/${MARK}` }] }), { mode: 0o600 });
  });
  await unreadable("a record of another adapter under this name", (file) =>
    writeFileSync(file, JSON.stringify({ ...good(file), adapter_id: CLAUDE_ROTATION_STOP_ADAPTER_ID }), { mode: 0o600 }));
  await unreadable("larger than the read limit", (file) => writeFileSync(file, `${JSON.stringify(good(file))}${" ".repeat(70 * 1024)}`, { mode: 0o600 }));
  await unreadable("open to the group and others", (file) => chmodSync(file, 0o644));
  await unreadable("a symlink in place of the file", (file, folder) => {
    const target = join(folder, "elsewhere.json");
    writeFileSync(target, readFileSync(file), { mode: 0o600 });
    rmSync(file);
    symlinkSync(target, file);
  });
  await unreadable("a file nobody may read", (file) => chmodSync(file, 0o000));
  await unreadable("a folder in its place", (file) => {
    rmSync(file);
    mkdirSync(file, { mode: 0o700 });
  });
});

test("hook input: a folder that cannot be trusted is unreadable with no adapter listed", async () => {
  const open = freshSeat();
  await record(open.home, CLAUDE_SESSION_START_ADAPTER_ID, "SessionStart", ["session_title"]);
  const folder = dirname(diagnosticFile(open.home, CLAUDE_SESSION_START_ADAPTER_ID));
  chmodSync(folder, 0o755);
  assert.deepEqual(hookInputOf(statusLines(open.home)), { file: "unreadable", adapters: [] }, "open to the group and others");

  const sealed = freshSeat();
  await record(sealed.home, CLAUDE_SESSION_START_ADAPTER_ID, "SessionStart", ["session_title"]);
  chmodSync(join(sealed.home, "hook-input"), 0o000);
  assert.deepEqual(hookInputOf(statusLines(sealed.home)), { file: "unreadable", adapters: [] }, "a folder that cannot be entered is not an empty one");
  chmodSync(join(sealed.home, "hook-input"), 0o700);

  const linked = freshSeat();
  const real = join(linked.home, "real-folder");
  mkdirSync(real, { recursive: true, mode: 0o700 });
  mkdirSync(join(linked.home, "hook-input", "kusabi"), { recursive: true, mode: 0o700 });
  symlinkSync(real, join(linked.home, "hook-input", "kusabi", "agent-memory"));
  assert.deepEqual(hookInputOf(statusLines(linked.home)), { file: "unreadable", adapters: [] }, "a symlink in place of the folder");

  const fileInPlace = freshSeat();
  mkdirSync(join(fileInPlace.home, "hook-input", "kusabi"), { recursive: true, mode: 0o700 });
  writeFileSync(join(fileInPlace.home, "hook-input", "kusabi", "agent-memory"), "x");
  assert.deepEqual(hookInputOf(statusLines(fileInPlace.home)), { file: "unreadable", adapters: [] }, "a file in place of the folder");
});

test("hook input: only the adapters the code knows are looked at - temporary and foreign files are ignored", () => {
  const { home } = freshSeat();
  const folder = join(home, "hook-input", "kusabi", "agent-memory");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  writeFileSync(join(folder, `${CLAUDE_SESSION_START_ADAPTER_ID}.json.4242.1700000000000.tmp`), "{broken", { mode: 0o600 });
  writeFileSync(join(folder, "other-adapter.json"), "{broken", { mode: 0o600 });
  writeFileSync(join(folder, "notes.txt"), "x", { mode: 0o600 });
  assert.deepEqual(hookInputOf(statusLines(home)), { file: "none", adapters: [] });
});

test("hook input: the view is additive and writes nothing", async () => {
  const { home, directory } = freshSeat();
  writeMarker(directory, buildMarker(markerFields));
  await record(home, CLAUDE_SESSION_START_ADAPTER_ID, "SessionStart", ["session_title"]);
  const before = readdirSync(home, { recursive: true }).map(String).sort();
  const contents = readFileSync(diagnosticFile(home, CLAUDE_SESSION_START_ADAPTER_ID), "utf8");
  const lines = statusLines(home);
  const status = JSON.parse(lines.join("")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(status).sort(), ["agent_id", "claim", "hook_input", "hook_state", "marker", "output_written", "project", "schema_version", "turn"]);
  const { hook_input: _hookInput, ...rest } = status;
  assert.deepEqual(rest, JSON.parse(JSON.stringify(buildRotationStatus(directory, "kusabi", "agent-memory"))), "the existing fields are the same as without the new section");
  assert.deepEqual(readdirSync(home, { recursive: true }).map(String).sort(), before);
  assert.equal(readFileSync(diagnosticFile(home, CLAUDE_SESSION_START_ADAPTER_ID), "utf8"), contents);
});

test("hook input: asked without the new argument the view has no such section (the existing function is unchanged)", () => {
  const { directory } = freshSeat();
  assert.equal("hook_input" in buildRotationStatus(directory, "kusabi", "agent-memory"), false);
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
  console.error(`FAIL test-session-rotation-status (${failed}/${cases.length})`);
  process.exit(1);
}
console.log(`PASS test-session-rotation-status (${cases.length} cases)`);
