/**
 * FR10.3 / FR10.4 / FR10.5: the diagnostic record of ignored hook-input key
 * names, and the bounded wait that keeps it from delaying a hook's exit.
 * Real time is measured for the wait; the writer and exit are injected.
 */
import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  HOOK_DIAGNOSTIC_MAX_ENTRIES,
  HOOK_DIAGNOSTIC_MAX_FILE_BYTES,
  HOOK_DIAGNOSTIC_MAX_WAIT_MS,
  HOOK_DIAGNOSTIC_MIN_REMAINING_MS,
  HOOK_INPUT_DIAGNOSTIC_SCHEMA,
  applyIgnoredNames,
  finishAfterAnswer,
  hookInputDiagnosticPath,
  isPrivateFolderInfo,
  isPrivateRecordInfo,
  parseHookInputDiagnostic,
  writeHookInputDiagnostic,
  type HookInputDiagnostic,
} from "./hook-input-diagnostics.js";
import { agentMemoryHome, rotationRoot } from "./session-rotation-files.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "SENTINEL_VALUE_NEVER_TO_APPEAR_7f3a";
const T0 = "2026-11-11T10:00:00.000Z";
const T1 = "2026-11-11T10:00:01.000Z";
const ADAPTER = "wasurezu-claude-transcript-stop";

let unhandled = 0;
process.on("unhandledRejection", () => { unhandled++; });

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function names(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(3, "0")}`);
}

function core(): void {
  assert.equal(HOOK_DIAGNOSTIC_MIN_REMAINING_MS, 2000);
  assert.equal(HOOK_DIAGNOSTIC_MAX_WAIT_MS, 200);
  assert(HOOK_DIAGNOSTIC_MIN_REMAINING_MS > HOOK_DIAGNOSTIC_MAX_WAIT_MS, "the floor must exceed the wait");
  assert.equal(HOOK_DIAGNOSTIC_MAX_ENTRIES, 32);

  // First sight, then a repeat: counts rise, first_seen stays, last_seen moves.
  const first = applyIgnoredNames(null, ADAPTER, "Stop", ["prompt_id", "effort"], T0);
  assert.equal(first.schema_version, HOOK_INPUT_DIAGNOSTIC_SCHEMA);
  assert.equal(first.adapter_id, ADAPTER);
  assert.deepEqual(first.entries.map((entry) => entry.name), ["effort", "prompt_id"], "entries are in a fixed order");
  assert.deepEqual(first.entries[0], { event: "Stop", name: "effort", count: 1, first_seen: T0, last_seen: T0 });
  assert.equal(first.dropped_names, 0);
  assert.equal(first.invalid_names, 0);
  const second = applyIgnoredNames(first, ADAPTER, "Stop", ["effort"], T1);
  assert.deepEqual(second.entries.find((entry) => entry.name === "effort"), {
    event: "Stop", name: "effort", count: 2, first_seen: T0, last_seen: T1,
  });
  assert.equal(second.entries.find((entry) => entry.name === "prompt_id")?.count, 1);
  assert.equal(first.entries[0].count, 1, "the earlier state is not changed (no mutation)");
  // The same name under another event is a separate entry.
  const other = applyIgnoredNames(second, ADAPTER, "UserPromptSubmit", ["effort"], T1);
  assert.equal(other.entries.filter((entry) => entry.name === "effort").length, 2);
  // One input counts one name once.
  assert.equal(
    applyIgnoredNames(null, ADAPTER, "Stop", ["a1", "a1", "a1"], T0).entries[0].count,
    1,
  );

  // Name rules: nothing is cut or rewritten; a name that does not fit is only counted.
  const bad = ["", "__proto__", "has space", "x".repeat(65), "-lead", "日本語", "a/b", "ok_name.1-x", "x".repeat(64)];
  const mixed = applyIgnoredNames(null, ADAPTER, "Stop", bad, T0);
  assert.deepEqual(mixed.entries.map((entry) => entry.name).sort(), ["ok_name.1-x", "x".repeat(64)].sort());
  assert.equal(mixed.invalid_names, 7);
  assert.equal(JSON.stringify(mixed).includes("__proto__"), false, "an invalid name is never written");

  // More than 32 names in one input: the first 32 in dictionary order are used, the rest counted.
  const forty = applyIgnoredNames(null, ADAPTER, "Stop", names("n", 40), T0);
  assert.equal(forty.entries.length, 32);
  assert.equal(forty.dropped_names, 8);
  assert.deepEqual(forty.entries.map((entry) => entry.name), names("n", 32));

  // A full table drops the entry seen longest ago (then the lower count, then the name order).
  let table: HookInputDiagnostic = applyIgnoredNames(null, ADAPTER, "Stop", names("k", 32), T0);
  table = applyIgnoredNames(table, ADAPTER, "Stop", ["k005"], T1);
  table = applyIgnoredNames(table, ADAPTER, "Stop", ["k005"], T1);
  const afterNew = applyIgnoredNames(table, ADAPTER, "Stop", ["zz_new"], "2026-11-11T10:00:02.000Z");
  assert.equal(afterNew.entries.length, 32);
  assert.equal(afterNew.dropped_names, 1);
  assert(afterNew.entries.some((entry) => entry.name === "zz_new"));
  assert.equal(afterNew.entries.some((entry) => entry.name === "k000"), false, "oldest last_seen, lowest count, first by name");
  assert(afterNew.entries.some((entry) => entry.name === "k005"), "a name seen again later is kept");

  // Same time seen: the lower count goes first, then the name, then the event.
  let tied: HookInputDiagnostic = applyIgnoredNames(null, ADAPTER, "Stop", names("t", 32), T0);
  tied = applyIgnoredNames(tied, ADAPTER, "Stop", ["t000"], T0);
  tied = applyIgnoredNames(tied, ADAPTER, "Stop", ["t000"], T0);
  const afterTied = applyIgnoredNames(tied, ADAPTER, "Stop", ["zz_new"], T1);
  assert.equal(afterTied.entries.some((entry) => entry.name === "t000"), true, "a name seen more often is kept when the time is the same");
  assert.equal(afterTied.entries.some((entry) => entry.name === "t001"), false, "the same time and count: the first name goes");
  let twoEvents: HookInputDiagnostic = applyIgnoredNames(null, ADAPTER, "Stop", names("e", 16), T0);
  twoEvents = applyIgnoredNames(twoEvents, ADAPTER, "UserPromptSubmit", names("e", 16), T0);
  const afterEvents = applyIgnoredNames(twoEvents, ADAPTER, "Stop", ["zz_new"], T1);
  assert.equal(afterEvents.entries.some((entry) => entry.name === "e000" && entry.event === "Stop"), false, "the same name and time: the event that sorts first goes");
  assert.equal(afterEvents.entries.some((entry) => entry.name === "e000" && entry.event === "UserPromptSubmit"), true);

  // Deterministic: the same sequence of inputs makes the same record, and it fits in 10 KiB.
  const run = () => {
    let state: HookInputDiagnostic | null = null;
    for (let index = 0; index < 5; index++) {
      state = applyIgnoredNames(state, ADAPTER, index % 2 === 0 ? "Stop" : "UserPromptSubmit", names("d", 20 + index * 3), `2026-11-11T10:00:0${index}.000Z`);
    }
    return state;
  };
  assert.equal(JSON.stringify(run()), JSON.stringify(run()));
  const biggest = applyIgnoredNames(null, ADAPTER, "Stop", Array.from({ length: 32 }, () => "n".repeat(64)).map((name, i) => `${name.slice(0, 60)}${String(i).padStart(4, "0")}`), T0);
  assert(Buffer.byteLength(JSON.stringify(biggest, null, 2), "utf8") < 10 * 1024);
  // No version field of the host: a value that cannot be read must not be stored as null.
  assert.deepEqual(Object.keys(first).sort(), ["adapter_id", "dropped_names", "entries", "invalid_names", "schema_version"]);

  // The reader side: only a well-formed record is "valid".
  assert.deepEqual(parseHookInputDiagnostic(JSON.stringify(second)), second);
  assert.equal(parseHookInputDiagnostic("{"), null);
  assert.equal(parseHookInputDiagnostic("[]"), null);
  assert.equal(parseHookInputDiagnostic(JSON.stringify({ ...second, schema_version: "other/v1" })), null);
  assert.equal(parseHookInputDiagnostic(JSON.stringify({ ...second, entries: "x" })), null);
  assert.equal(parseHookInputDiagnostic(JSON.stringify({ ...second, dropped_names: -1 })), null);
  assert.equal(parseHookInputDiagnostic(JSON.stringify({ ...second, dropped_names: "0" })), null);
  assert.equal(parseHookInputDiagnostic(JSON.stringify({ ...second, entries: [{ ...second.entries[0], count: 0 }] })), null);
  assert.equal(parseHookInputDiagnostic(JSON.stringify({ ...second, entries: [{ ...second.entries[0], name: "bad name" }] })), null);
  assert.equal(parseHookInputDiagnostic(JSON.stringify({ ...second, entries: [{ ...second.entries[0], event: "Other" }] })), null);
  assert.equal(parseHookInputDiagnostic(JSON.stringify({ ...second, entries: [{ ...second.entries[0], extra: MARKER }] })), null);
  assert.equal(parseHookInputDiagnostic(JSON.stringify({ ...second, entries: names("e", 33).map((name) => ({ ...second.entries[0], name })) })), null);
  assert.equal(parseHookInputDiagnostic(" ".repeat(HOOK_DIAGNOSTIC_MAX_FILE_BYTES + 1) + JSON.stringify(second)), null);
  for (const entry of [null, [], "x", 1]) {
    assert.equal(parseHookInputDiagnostic(JSON.stringify({ ...second, entries: [entry] })), null, `an entry that is ${JSON.stringify(entry)}`);
  }
  assert.equal(parseHookInputDiagnostic(JSON.stringify({ ...second, entries: [second.entries[0], second.entries[0]] })), null, "the same event and name twice");
}

async function files(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "wasurezu-hook-diag-"));
  try {
    const home = join(root, "home");
    await mkdir(home, { recursive: true, mode: 0o700 });
    const env = { AGENT_MEMORY_HOME: home, HOME: join(root, "unused-home") };

    // One home for both families of files (standard S3).
    assert.equal(agentMemoryHome(env), home);
    assert.equal(agentMemoryHome({ HOME: "/h" }), join("/h", ".agent-memory"));
    assert.equal(rotationRoot(env), join(home, "rotation"));
    assert.equal(
      hookInputDiagnosticPath(env, "kusabi", "agent-memory", ADAPTER),
      join(home, "hook-input", "kusabi", "agent-memory", `${ADAPTER}.json`),
    );
    for (const [agent, project, adapter] of [
      ["../x", "p", ADAPTER], ["a", "..", ADAPTER], ["a/b", "p", ADAPTER], ["a", "p", "../evil"], ["a", "p", "A B"], ["", "p", ADAPTER],
    ] as const) {
      assert.throws(() => hookInputDiagnosticPath(env, agent, project, adapter), (error: unknown) => error instanceof Error, `${agent}|${project}|${adapter}`);
    }

    const request = (overrides: Record<string, unknown> = {}) => ({
      env,
      agent_id: "kusabi",
      project: "agent-memory",
      adapter_id: ADAPTER,
      event: "Stop" as const,
      names: ["effort", "prompt_id"],
      now: new Date(T0),
      pid: 4242,
      ...overrides,
    });
    const target = hookInputDiagnosticPath(env, "kusabi", "agent-memory", ADAPTER);
    const folder = dirname(target);

    // First write: names and counts only, with the intended permissions, no leftover temporary file.
    await writeHookInputDiagnostic(request());
    const text = await readFile(target, "utf8");
    const written = parseHookInputDiagnostic(text);
    assert(written, "the file is a valid record");
    assert.deepEqual(written.entries.map((entry) => [entry.event, entry.name, entry.count]), [["Stop", "effort", 1], ["Stop", "prompt_id", 1]]);
    assert.equal(text.includes(MARKER), false);
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    assert.equal((await stat(folder)).mode & 0o777, 0o700);
    assert.equal((await stat(join(home, "hook-input"))).mode & 0o777, 0o700);
    assert.deepEqual(await readdir(folder), [`${ADAPTER}.json`], "no temporary file is left");
    assert(Buffer.byteLength(text, "utf8") < 10 * 1024);

    // A second write adds to the count; another adapter has its own file.
    await writeHookInputDiagnostic(request({ now: new Date(T1), pid: 4243 }));
    const again = parseHookInputDiagnostic(await readFile(target, "utf8"));
    assert.deepEqual(again?.entries.map((entry) => entry.count), [2, 2]);
    assert.equal(again?.entries[0].first_seen, T0);
    assert.equal(again?.entries[0].last_seen, T1);
    await writeHookInputDiagnostic(request({ adapter_id: "wasurezu-codex-transcript-stop" }));
    assert.equal(
      parseHookInputDiagnostic(await readFile(hookInputDiagnosticPath(env, "kusabi", "agent-memory", "wasurezu-codex-transcript-stop"), "utf8"))?.entries[0].count,
      1,
    );
    assert.deepEqual(parseHookInputDiagnostic(await readFile(target, "utf8"))?.entries.map((entry) => entry.count), [2, 2], "the other adapter's file is not shared");

    // Only the cases that can be written are written: nothing for these requests, anywhere under the home.
    const tree = async (dir: string, prefix = ""): Promise<string[]> => {
      const out: string[] = [];
      for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        out.push(`${prefix}${entry.name}`);
        if (entry.isDirectory()) out.push(...(await tree(join(dir, entry.name), `${prefix}${entry.name}/`)));
      }
      return out;
    };
    const before = JSON.stringify(await tree(root));
    await writeHookInputDiagnostic(request({ names: [] }));
    await writeHookInputDiagnostic(request({ event: "Other" }));
    await writeHookInputDiagnostic(request({ agent_id: "../escape" }));
    await writeHookInputDiagnostic(request({ project: "a/b" }));
    await writeHookInputDiagnostic(request({ adapter_id: "../evil" }));
    assert.equal(JSON.stringify(await tree(root)), before);
    await assert.rejects(lstat(join(root, "escape")), /ENOENT/);

    // A corrupt file is replaced by a fresh record (the reader calls it unreadable until then).
    await writeFile(target, "{ not json", { mode: 0o600 });
    assert.equal(parseHookInputDiagnostic(await readFile(target, "utf8")), null);
    await writeHookInputDiagnostic(request({ names: ["fresh_key"] }));
    assert.deepEqual(parseHookInputDiagnostic(await readFile(target, "utf8"))?.entries.map((entry) => entry.name), ["fresh_key"]);

    // A folder that is a symlink is never written through.
    const linked = join(home, "hook-input", "kusabi", "linked-project");
    const elsewhere = join(root, "elsewhere");
    await mkdir(elsewhere, { recursive: true, mode: 0o700 });
    await symlink(elsewhere, linked);
    await writeHookInputDiagnostic(request({ project: "linked-project" }));
    assert.deepEqual(await readdir(elsewhere), []);

    // A folder open to group/other is not trusted.
    const open = join(home, "hook-input", "kusabi", "open-project");
    await mkdir(open, { recursive: true });
    await chmod(open, 0o755);
    await writeHookInputDiagnostic(request({ project: "open-project" }));
    assert.deepEqual(await readdir(open), []);
    const openToGroup = join(home, "hook-input", "kusabi", "group-project");
    await mkdir(openToGroup, { recursive: true });
    await chmod(openToGroup, 0o770);
    await writeHookInputDiagnostic(request({ project: "group-project" }));
    assert.deepEqual(await readdir(openToGroup), []);

    // A process id that is not a count of processes writes nothing.
    const beforePid = JSON.stringify(await tree(root));
    for (const pid of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) await writeHookInputDiagnostic(request({ pid, names: ["pid_probe"] }));
    assert.equal(JSON.stringify(await tree(root)), beforePid);

    // A record that exists but cannot be trusted (open to the group) is not read from; the new record replaces it.
    const looseProject = join(home, "hook-input", "kusabi", "loose-record");
    await mkdir(looseProject, { recursive: true, mode: 0o700 });
    const looseTarget = hookInputDiagnosticPath(env, "kusabi", "loose-record", ADAPTER);
    const looseOld = applyIgnoredNames(null, ADAPTER, "Stop", ["old_key"], T0);
    await writeFile(looseTarget, JSON.stringify(looseOld), { mode: 0o644 });
    await chmod(looseTarget, 0o644);
    await writeHookInputDiagnostic(request({ project: "loose-record", names: ["new_key"] }));
    const replaced = parseHookInputDiagnostic(await readFile(looseTarget, "utf8"));
    assert.deepEqual(replaced?.entries.map((entry) => entry.name), ["new_key"], "nothing is taken from the untrusted record");
    assert.equal((await stat(looseTarget)).mode & 0o777, 0o600);

    // A folder that cannot be created for a reason other than "already there" writes nothing and does not throw.
    const sealedHome = join(root, "sealed-home");
    await mkdir(join(sealedHome, "hook-input"), { recursive: true, mode: 0o700 });
    await chmod(join(sealedHome, "hook-input"), 0o500);
    await writeHookInputDiagnostic(request({ env: { AGENT_MEMORY_HOME: sealedHome } }));
    await chmod(join(sealedHome, "hook-input"), 0o700);
    assert.deepEqual(await readdir(join(sealedHome, "hook-input")), []);

    // A folder that cannot be entered: nothing is written, the clean-up of the temporary name fails too, and nothing throws.
    const closedProject = join(home, "hook-input", "kusabi", "closed-record");
    await mkdir(closedProject, { recursive: true, mode: 0o700 });
    await chmod(closedProject, 0o600);
    await writeHookInputDiagnostic(request({ project: "closed-record" }));
    await chmod(closedProject, 0o700);
    assert.deepEqual(await readdir(closedProject), []);

    // The temporary file is removed when the final rename cannot happen (a folder stands where the record goes).
    const blockedProject = join(home, "hook-input", "kusabi", "blocked-record");
    await mkdir(join(blockedProject, `${ADAPTER}.json`, "inside"), { recursive: true, mode: 0o700 });
    await writeHookInputDiagnostic(request({ project: "blocked-record" }));
    assert.deepEqual(await readdir(blockedProject), [`${ADAPTER}.json`], "no temporary file is left behind");

    // H5: nothing here may throw into the hook, whatever the place is.
    const notAFolder = join(root, "a-file");
    await writeFile(notAFolder, "x");
    await writeHookInputDiagnostic(request({ env: { AGENT_MEMORY_HOME: join(notAFolder, "sub") } }));
    await writeHookInputDiagnostic(request({ now: new Date("invalid") }));
    await writeHookInputDiagnostic(request({ names: [MARKER.repeat(100)] }));
    const raw = await readFile(target, "utf8");
    assert.equal(raw.includes(MARKER), false, "an overlong name is only counted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

interface Timing {
  exits: number;
  exited_at: number;
  writer_calls: number;
}

/** Runs finishAfterAnswer against the real clock and reports when exit was called. */
async function timed(
  remaining: number,
  writer: () => Promise<unknown> | void,
  settle = 40,
): Promise<Timing> {
  const timing: Timing = { exits: 0, exited_at: -1, writer_calls: 0 };
  const start = performance.now();
  finishAfterAnswer({
    remaining_ms: remaining,
    run_diagnostic: () => { timing.writer_calls++; return writer(); },
    exit: () => { timing.exits++; if (timing.exited_at < 0) timing.exited_at = performance.now() - start; },
  });
  const deadline = performance.now() + 1500;
  while (timing.exits === 0 && performance.now() < deadline) await sleep(5);
  await sleep(settle);
  return timing;
}

const slowWriter = (ms: number) => () => new Promise<void>((done) => { setTimeout(done, ms).unref(); });
const IN_BAND = (t: Timing) => t.exited_at >= 180 && t.exited_at < 1000;

async function waits(): Promise<void> {
  // (1) a slow writer: exit comes at about the cap, not when the writer ends.
  const slow = await timed(2000, slowWriter(3000));
  assert(IN_BAND(slow), `slow writer: exit at ${slow.exited_at} ms`);
  assert.equal(slow.exits, 1);
  assert.equal(slow.writer_calls, 1);
  // (2) a delay beyond what the host leaves (the second audit's counterexample: 5000 ms of work + 4500 ms of I/O).
  const beyond = await timed(2000, slowWriter(4500));
  assert(IN_BAND(beyond), `4500 ms writer: exit at ${beyond.exited_at} ms`);
  // (3) a writer that never returns.
  const never = await timed(2500, () => new Promise<void>(() => undefined));
  assert(IN_BAND(never), `never-returning writer: exit at ${never.exited_at} ms`);
  assert.equal(never.exits, 1);
  // (4) a fast writer: exit when it ends, without waiting for the cap.
  const fast = await timed(5000, slowWriter(5));
  assert(fast.exited_at < 150, `fast writer: exit at ${fast.exited_at} ms`);
  assert.equal(fast.exits, 1);

  // (5) the floor: 2000 starts it, 1999 and an exhausted budget do not; exit is called either way.
  assert.equal((await timed(2000, slowWriter(5))).writer_calls, 1);
  for (const remaining of [1999, 1000, 1, 0, -1, Number.NaN, Number.NEGATIVE_INFINITY]) {
    const skipped = await timed(remaining, slowWriter(5));
    assert.equal(skipped.writer_calls, 0, `remaining ${remaining} must not start the writer`);
    assert.equal(skipped.exits, 1);
    assert(skipped.exited_at < 150, `remaining ${remaining}: exit at ${skipped.exited_at} ms`);
  }

  // (8) exceptions are dropped: exit once, no unhandled rejection.
  const unhandledBefore = unhandled;
  const syncThrow = await timed(3000, () => { throw new Error("writer threw"); });
  assert.equal(syncThrow.exits, 1);
  assert(syncThrow.exited_at < 150, `sync throw: exit at ${syncThrow.exited_at} ms`);
  const rejected = await timed(3000, () => Promise.reject(new Error("writer rejected")));
  assert.equal(rejected.exits, 1);
  assert(rejected.exited_at < 150, `reject: exit at ${rejected.exited_at} ms`);
  const late = await timed(3000, () => new Promise<void>((_, fail) => { setTimeout(() => fail(new Error("late")), 320).unref(); }), 500);
  assert.equal(late.exits, 1);
  assert(IN_BAND(late), `late reject: exit at ${late.exited_at} ms`);
  await sleep(50);
  assert.equal(unhandled, unhandledBefore, "no unhandled rejection from a dropped diagnostic");

  // exit is never called twice, even when the writer ends right around the cap.
  const edge = await timed(3000, slowWriter(HOOK_DIAGNOSTIC_MAX_WAIT_MS), 300);
  assert.equal(edge.exits, 1);

  // Never waits for more than what is left, even if the constants changed relationship (min with the remainder).
  const small = await timed(2000, slowWriter(3000));
  assert(small.exited_at < 1000);
}

// The trust checks take the expected user id as an input: the same inputs give the same answer whatever the process is.
function trustInputs(): void {
  const folder = (uid: number, mode = 0o40700) => ({ isDirectory: () => true, isFile: () => false, uid, mode, size: 0 });
  const record = (uid: number, mode = 0o100600, size = 10) => ({ isDirectory: () => false, isFile: () => true, uid, mode, size });
  const answers = () => [
    isPrivateFolderInfo(folder(501), 501), isPrivateFolderInfo(folder(501), 502), isPrivateFolderInfo(folder(0), 0),
    isPrivateFolderInfo(folder(501), null), isPrivateFolderInfo(folder(501, 0o40750), 501), isPrivateFolderInfo(folder(501, 0o40705), 501),
    isPrivateFolderInfo(record(501), 501),
    isPrivateRecordInfo(record(501), 501), isPrivateRecordInfo(record(501), 502), isPrivateRecordInfo(record(0), 0),
    isPrivateRecordInfo(record(501), null), isPrivateRecordInfo(record(501, 0o100640), 501), isPrivateRecordInfo(record(501, 0o100604), 501),
    isPrivateRecordInfo(record(501, 0o100600, HOOK_DIAGNOSTIC_MAX_FILE_BYTES), 501),
    isPrivateRecordInfo(record(501, 0o100600, HOOK_DIAGNOSTIC_MAX_FILE_BYTES + 1), 501),
    isPrivateRecordInfo(folder(501), 501),
  ];
  const expected = [true, false, true, false, false, false, false, true, false, true, false, false, false, true, false, false];
  assert.deepEqual(answers(), expected, "the answer follows the id that is passed in, root included, and none trusts nothing");

  // The process's own id is not read: the answers stay the same while the process claims other ids or none.
  const holder = process as unknown as { getuid?: () => number };
  const original = holder.getuid;
  try {
    for (const claimed of [() => 501, () => 502, () => 0, undefined]) {
      holder.getuid = claimed;
      assert.deepEqual(answers(), expected, `process id ${claimed ? claimed() : "absent"}`);
    }
  } finally {
    holder.getuid = original;
  }
}

async function trustInputsInFiles(): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "diag-uid-"));
  try {
    const env = { AGENT_MEMORY_HOME: home };
    const request = { env, agent_id: "kusabi", project: "agent-memory", adapter_id: ADAPTER, event: "Stop" as const, names: ["effort"], now: new Date(T0), pid: 4242 };
    const target = hookInputDiagnosticPath(env, "kusabi", "agent-memory", ADAPTER);
    const own = process.getuid!();
    // Another expected id, or none: the folders are not trusted and nothing is recorded.
    for (const uid of [own + 1, null]) {
      await writeHookInputDiagnostic(request, uid);
      await assert.rejects(lstat(target), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT", `uid ${uid}`);
    }
    await writeHookInputDiagnostic(request, own);
    assert(parseHookInputDiagnostic(await readFile(target, "utf8")), "the process's own id records");
    // A record that exists is read back only for the id that is passed in: the other id starts a new record.
    await writeHookInputDiagnostic({ ...request, now: new Date(T1) }, own);
    assert.deepEqual(parseHookInputDiagnostic(await readFile(target, "utf8"))?.entries.map((entry) => entry.count), [2]);
    await writeHookInputDiagnostic({ ...request, now: new Date(T1) });
    assert.deepEqual(parseHookInputDiagnostic(await readFile(target, "utf8"))?.entries.map((entry) => entry.count), [3], "the default is the process's own id");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function staticChecks(): void {
  const source = readFileSync(join(repositoryRoot, "src", "hook-input-diagnostics.ts"), "utf8");
  // (11) asynchronous only: no synchronous file call and no fsync, no process started, no clock read in the core.
  assert.doesNotMatch(source, /\b(mkdirSync|writeFileSync|fsyncSync|readFileSync|renameSync|lstatSync|statSync|openSync|closeSync|existsSync|unlinkSync|rmSync|chmodSync|appendFileSync|readdirSync)\b/);
  assert.doesNotMatch(source, /from "node:fs"/);
  assert.match(source, /from "node:fs\/promises"/);
  assert.doesNotMatch(source, /\bfsync\b|\.sync\(|datasync/i);
  assert.doesNotMatch(source, /child_process|execFile|spawn|--version/);
  // The host version is not a field of the record (it is taken by the deployment health check).
  assert.doesNotMatch(source, /host_version|claude_version|CLAUDE_CODE_VERSION/);
  // S4: the pure part takes time as an argument; the file part receives `now` and `pid` in the request.
  const coreStart = source.indexOf("export function applyIgnoredNames");
  assert(coreStart >= 0, "the pure core is exported");
  const nextExport = source.indexOf("\nexport ", coreStart + 1);
  const coreSource = source.slice(coreStart, nextExport < 0 ? source.length : nextExport);
  assert(coreSource.length > 200, "the core slice is the function body");
  assert.doesNotMatch(coreSource, /Date\.now|new Date\(\)|Math\.random|randomUUID|process\./);
  // The trust checks read only their arguments (the file layer passes the user id in).
  const trustStart = source.indexOf("export function isPrivateFolderInfo");
  const trustEnd = source.indexOf("async function ensurePrivateFolder");
  assert(trustStart >= 0 && trustEnd > trustStart, "the trust checks are found");
  assert.doesNotMatch(source.slice(trustStart, trustEnd), /process|getuid|currentUid/);
  // The one place of the wait constants.
  assert.equal((source.match(/HOOK_DIAGNOSTIC_MAX_WAIT_MS\s*=/g) ?? []).length, 1);
  assert.equal((source.match(/HOOK_DIAGNOSTIC_MIN_REMAINING_MS\s*=/g) ?? []).length, 1);
  // Node is not asked for the host's version from inside a hook (the deployment health check takes it).
  for (const file of ["claude-session-start.ts", "transcript-stop-capture.ts", "session-rotation-stop.ts"]) {
    const text = readFileSync(join(repositoryRoot, "src", file), "utf8");
    assert.doesNotMatch(text, /claude --version|\["--version"\]|"--version"/, file);
  }
}

async function main(): Promise<void> {
  core();
  trustInputs();
  await files();
  await trustInputsInFiles();
  await waits();
  staticChecks();
  process.stdout.write("hook input diagnostics tests passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
