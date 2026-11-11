/**
 * Session rotation, status view (261110-session-rotation, FR4.2): the read-only
 * command that shows a seat's marker, turn, hook state and watcher claim. Each
 * file shows as none / unreadable / valid; the view never writes, and never
 * prints conversation text or a path.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMarker,
  seatDirectory,
  sha256Hex,
  writeHookState,
  writeJsonAtomic,
  writeMarker,
  writeTurn,
} from "./session-rotation-files.js";
import { ROTATION_STATUS_SCHEMA, buildRotationStatus, runRotationStatusCli } from "./session-rotation-status.js";

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
    marker: { file: "none" }, turn: { file: "none" }, hook_state: { file: "none" }, claim: { file: "none" },
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
