/**
 * Step 17 (FR11.7, 261110-session-rotation), the fourth audit's F1: the real command `restart-cli handoff-source` reads and
 * writes nothing - not when it starts, not when it ends - on each of the three stores. T17(i)-(p) of section 6.
 * Every case runs the real command as a child process in its own empty home; a store that is checked is a real one.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";
import { pathToFileURL } from "node:url";
import { EventEmitter } from "node:events";
import { rotationHandoffTaskId, seatDirectory, writeMarker } from "./session-rotation-files.js";
import { JsonStore } from "./stores/json-store.js";
import { SqliteStore } from "./stores/sqlite-store.js";
import { AGENT, HANDOFF, HANDOFF_TASK_NAME, PROJECT, commandEnv, digestOf, freshHome, listing, marker, runRestartCli } from "./test-handoff-source-support.js";

const cases: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

const ARGS = ["handoff-source", "--agent-id", AGENT, "--project", PROJECT];
type Kind = "json" | "sqlite";

interface Seat {
  home: string;
  env: NodeJS.ProcessEnv;
  directory: string;
  /** SQLite: the database file. JSON: the folder that holds the records. */
  place: string;
}

const saveHandoff = {
  agent_id: AGENT, project: PROJECT, task_id: rotationHandoffTaskId(PROJECT), task: HANDOFF_TASK_NAME, status: "in_progress" as const, progress: HANDOFF,
};

/** A seat with its marker and, when asked, the hand-off task state in a real store of the given kind. The store is closed before the command runs. */
async function seat(kind: Kind, over: { handoff?: boolean; marker?: boolean } = {}): Promise<Seat> {
  const home = freshHome(`handoff-cli-${kind}`);
  const directory = seatDirectory(join(home, ".agent-memory", "rotation"), AGENT, PROJECT);
  mkdirSync(directory, { recursive: true });
  if (over.marker !== false) writeMarker(directory, marker());
  const place = kind === "sqlite" ? join(home, "store", "memory.db") : join(home, ".agent-memory");
  const env = commandEnv(home, kind === "sqlite" ? { AGENT_MEMORY_DB_TYPE: "sqlite", AGENT_MEMORY_DB_PATH: place } : { AGENT_MEMORY_DB_TYPE: "json" });
  const store = kind === "sqlite" ? new SqliteStore(place) : new JsonStore(place);
  await store.initialize();
  if (over.handoff !== false) await store.saveTaskState(saveHandoff);
  await store.close();
  return { home, env, directory, place };
}

const answer = (ran: { status: number | null; stdout: string }): { result: string; text?: string; reason?: string } => JSON.parse(ran.stdout);
const fileState = (path: string) => `${statSync(path).mtimeMs}:${statSync(path).size}:${readFileSync(path).toString("base64")}`;

test("T17(i) [sqlite]: the real command finds the text and leaves the database file byte for byte, and in modification time, as it was", async () => {
  const s = await seat("sqlite");
  const before = fileState(s.place);
  const ok = runRestartCli(s.env, ARGS);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(answer(ok).result, "found");
  assert.equal(answer(ok).text, HANDOFF);
  assert.equal(fileState(s.place), before, "the command wrote nothing to the database file - not when it opened it, not when it closed it");
  const other = runRestartCli(s.env, ["handoff-source", "--agent-id", AGENT, "--project", "no-such-project"]);
  assert.equal(other.status, 1);
  assert.equal(answer(other).result, "no_marker");
  assert.equal(fileState(s.place), before);
});

const PRELOAD = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { spawnSync } from "node:child_process";
const original = fs.readFileSync;
let fired = false;
fs.readFileSync = function patched(path, ...rest) {
  const data = original.call(this, path, ...rest);
  if (!fired && path === process.env.TEST_WATCHED_FILE) {
    fired = true;
    const ran = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", process.env.TEST_OTHER_PROCESS, process.env.TEST_SAVER_MODULE, path],
      { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" }, cwd: process.env.TEST_CWD });
    fs.writeFileSync(process.env.TEST_MARK, String(ran.status) + ":" + ran.stderr);
  }
  return data;
};
syncBuiltinESMExports();
`;
const OTHER_PROCESS = `
const [file, dbPath] = process.argv.slice(1);
const { SqliteStore } = await import(file);
const store = new SqliteStore(dbPath);
await store.initialize();
await store.saveTaskState({ agent_id: "kusabi", project: "agent-memory", task_id: "concurrent-ordinary-save", task: "別の process の通常の保存", status: "in_progress", progress: "kept" });
await store.close();
`;

test("T17(j) [sqlite]: an ordinary save by another process that lands while the command is reading is still there afterwards", async () => {
  const s = await seat("sqlite");
  const tools = join(s.home, "tools");
  mkdirSync(tools, { recursive: true });
  const preload = join(tools, "interleave.mjs");
  const mark = join(tools, "mark.txt");
  writeFileSync(preload, PRELOAD);
  const env = {
    ...s.env, TEST_WATCHED_FILE: s.place, TEST_OTHER_PROCESS: OTHER_PROCESS, TEST_MARK: mark, TEST_CWD: process.cwd(),
    TEST_SAVER_MODULE: pathToFileURL(join(process.cwd(), "src", "stores", "sqlite-store.ts")).href,
  };
  const ran = runRestartCli(env, ARGS, ["--import", pathToFileURL(preload).href]);
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(answer(ran).result, "found");
  assert.ok(existsSync(mark), "the other process's save did happen while the command was between reading the file and ending");
  assert.ok(readFileSync(mark, "utf8").startsWith("0:"), readFileSync(mark, "utf8"));
  const check = new SqliteStore(s.place);
  await check.initialize();
  const rows = await check.getTaskStates({ agent_id: AGENT, project: PROJECT, status: "all", limit: 50 });
  await check.close();
  assert.ok(rows.some((row) => row.task_id === "concurrent-ordinary-save"), "the ordinary save made while the command read is not rolled back by the command's end");
  assert.ok(rows.some((row) => row.task_id === rotationHandoffTaskId(PROJECT)));
});

test("T17(k) [json]: a legacy row in the records (no task_id, no updated_at) is not rewritten by the command - the records are byte for byte as they were", async () => {
  const s = await seat("json");
  const file = join(s.place, "task-states.json");
  const rows = JSON.parse(readFileSync(file, "utf8")) as unknown[];
  rows.push({ id: "legacy-1", agent_id: "another-agent", project: PROJECT, task: "AM-006", status: "in_progress", files_modified: [], created_at: "2026-01-01T00:00:00.000Z" });
  // Other tasks of the same seat: two with the same time and one newer than the hand-off, so the order the reader gives is the store's.
  for (const [id, at] of [["other-a", "2020-01-01T00:00:00.000Z"], ["other-b", "2020-01-01T00:00:00.000Z"], ["other-c", "2999-01-01T00:00:00.000Z"]] as const) {
    rows.push({ id, agent_id: AGENT, project: PROJECT, task_id: id, task: id, status: "in_progress", files_modified: [], created_at: at, updated_at: at });
  }
  writeFileSync(file, JSON.stringify(rows, null, 2));
  const before = digestOf(s.place);
  const ok = runRestartCli(s.env, ARGS);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(answer(ok).result, "found");
  assert.equal(answer(ok).text, HANDOFF);
  assert.deepEqual(digestOf(s.place), before, "no file of the store changed - the legacy row was not given a task_id or an updated_at");
  assert.ok(!("task_id" in (JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>>).find((row) => row.id === "legacy-1")!));
});

test("T17(l): what the command cannot read is 'unreadable' - a broken or foreign store, a store place that is not there - never 'absent', and it creates and changes nothing", async () => {
  // JSON: broken text, not a list, a row that is not an object.
  for (const [label, text] of [["broken", "{ not json"], ["not a list", "{\"a\":1}"], ["a row that is not an object", "[null]"]] as const) {
    const s = await seat("json");
    writeFileSync(join(s.place, "task-states.json"), text);
    const before = digestOf(s.place);
    const ran = runRestartCli(s.env, ARGS);
    assert.equal(ran.status, 1, label);
    assert.equal(answer(ran).result, "unreadable", `json, ${label}`);
    assert.equal(answer(ran).text, undefined);
    assert.deepEqual(digestOf(s.place), before, `json, ${label}: unchanged`);
  }
  // JSON: the folder exists but has never held a task state - the store is readable and has no row: absent.
  const empty = await seat("json", { handoff: false });
  rmSyncIfExists(join(empty.place, "task-states.json"));
  assert.equal(answer(runRestartCli(empty.env, ARGS)).result, "absent");
  // JSON: the place the command is told to read is not there at all (the seat's folder is elsewhere): unreadable, and not created.
  const elsewhere = await seat("json");
  const noStore = freshHome("handoff-cli-nostore");
  const lost = runRestartCli({ ...elsewhere.env, HOME: noStore }, ARGS);
  assert.equal(lost.status, 1);
  assert.equal(answer(lost).result, "unreadable");
  assert.ok(!existsSync(join(noStore, ".agent-memory")), "the command did not create the store's folder");
  // SQLite: no file, a file that is not a database, a database that has no task_states table.
  const none = await seat("sqlite");
  rmSyncIfExists(none.place);
  const missing = runRestartCli(none.env, ARGS);
  assert.equal(answer(missing).result, "unreadable");
  assert.ok(!existsSync(none.place), "the command did not create the database file");
  const garbage = await seat("sqlite");
  writeFileSync(garbage.place, "this is not a database file");
  const garbageBefore = fileState(garbage.place);
  assert.equal(answer(runRestartCli(garbage.env, ARGS)).result, "unreadable");
  assert.equal(fileState(garbage.place), garbageBefore);
  const foreign = await seat("sqlite");
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE unrelated (x TEXT)");
  writeFileSync(foreign.place, Buffer.from(db.export()));
  db.close();
  const foreignBefore = fileState(foreign.place);
  assert.equal(answer(runRestartCli(foreign.env, ARGS)).result, "unreadable");
  assert.equal(fileState(foreign.place), foreignBefore);
  // A row with no creation time is a damaged store (the column is NOT NULL in every store): unreadable, on JSON and on SQLite.
  const noTime = await seat("json");
  const noTimeFile = join(noTime.place, "task-states.json");
  const noTimeRows = (JSON.parse(readFileSync(noTimeFile, "utf8")) as Array<Record<string, unknown>>).map((row) => ({ ...row, created_at: undefined }));
  writeFileSync(noTimeFile, JSON.stringify(noTimeRows));
  const noTimeBefore = digestOf(noTime.place);
  assert.equal(answer(runRestartCli(noTime.env, ARGS)).result, "unreadable");
  assert.deepEqual(digestOf(noTime.place), noTimeBefore);
  const nullTime = await seat("sqlite");
  const loose = new SQL.Database();
  loose.run("CREATE TABLE task_states (agent_id TEXT, project TEXT, status TEXT, task_id TEXT, progress TEXT, created_at TEXT, updated_at TEXT)");
  loose.run("INSERT INTO task_states VALUES (?, ?, 'in_progress', ?, ?, NULL, NULL)", [AGENT, PROJECT, rotationHandoffTaskId(PROJECT), HANDOFF]);
  writeFileSync(nullTime.place, Buffer.from(loose.export()));
  loose.close();
  const nullTimeBefore = fileState(nullTime.place);
  assert.equal(answer(runRestartCli(nullTime.env, ARGS)).result, "unreadable");
  assert.equal(fileState(nullTime.place), nullTimeBefore);
});

function rmSyncIfExists(path: string): void {
  if (existsSync(path)) spawnSync("rm", ["-f", path]);
}

test("T17(m): a missing argument is a usage error - exit 2, nothing on stdout, and no store is touched or created, on each of the three stores", async () => {
  const usage: string[][] = [
    ["handoff-source"],
    ["handoff-source", "--agent-id", AGENT],
    ["handoff-source", "--project", PROJECT],
    ["handoff-source", "--agent-id", AGENT, "--project"],
    ["handoff-source", "--agent-id", AGENT, "--project", PROJECT, "--no-such-option"],
  ];
  const stores: Array<[string, Record<string, string>]> = [
    ["sqlite", { AGENT_MEMORY_DB_TYPE: "sqlite" }],
    ["json", { AGENT_MEMORY_DB_TYPE: "json" }],
    ["postgres", { AGENT_MEMORY_DB_TYPE: "postgres", AGENT_MEMORY_DATABASE_URL: "postgres://nobody@127.0.0.1:1/none" }],
  ];
  for (const [label, extra] of stores) {
    for (const args of usage) {
      const home = freshHome(`handoff-cli-usage-${label}`);
      const before = listing(home);
      const ran = runRestartCli(commandEnv(home, extra), args);
      assert.equal(ran.status, 2, `${label} ${args.join(" ")}: ${ran.stderr}`);
      assert.equal(ran.stdout, "", `${label} ${args.join(" ")}`);
      assert.ok(ran.stderr.length > 0, "a usage error says what is missing");
      assert.deepEqual(listing(home), before, `${label} ${args.join(" ")}: nothing was created in the home`);
    }
  }
});

test("T17(m2): the arguments of the other verbs are read as before - an unknown command or option is still the ordinary failure (exit 1), not the usage error of handoff-source", async () => {
  for (const args of [["no-such-verb"], ["prepare", "--no-such-option"]]) {
    const home = freshHome("handoff-cli-other-verb");
    const before = listing(home);
    const ran = runRestartCli(commandEnv(home, { AGENT_MEMORY_DB_TYPE: "json" }), args);
    assert.equal(ran.status, 1, `${args.join(" ")}: ${ran.stderr}`);
    assert.match(ran.stderr, /wasurezu-restart failed: Error: unknown (command|option)/);
    assert.deepEqual(listing(home), before);
  }
});

test("T17(n): a seat with no marker is named before any store is opened - no database file, no folder, no connection", async () => {
  for (const [label, extra] of [
    ["sqlite (the default place)", { AGENT_MEMORY_DB_TYPE: "sqlite" }],
    ["sqlite (no type named)", {}],
    ["json", { AGENT_MEMORY_DB_TYPE: "json" }],
  ] as const) {
    const home = freshHome("handoff-cli-nomarker");
    const before = listing(home);
    const ran = runRestartCli(commandEnv(home, extra), ARGS);
    assert.equal(ran.status, 1, `${label}: ${ran.stderr}`);
    assert.equal(answer(ran).result, "no_marker", label);
    assert.deepEqual(listing(home), before, `${label}: the home is as it was - the store was not created`);
  }
});

test("T17(o) [postgres]: a database that cannot be reached is 'unreadable' with exit 1, and no local store file is made", async () => {
  const s = await seat("sqlite");
  const home = s.home;
  const before = listing(home);
  const env = commandEnv(home, { AGENT_MEMORY_DB_TYPE: "postgres", AGENT_MEMORY_DATABASE_URL: "postgres://nobody@127.0.0.1:1/none" });
  const ran = runRestartCli(env, ARGS);
  assert.equal(ran.status, 1, ran.stderr);
  assert.equal(answer(ran).result, "unreadable");
  assert.equal(answer(ran).text, undefined);
  assert.deepEqual(listing(home), before);
  const noUrl = runRestartCli(commandEnv(home, { AGENT_MEMORY_DB_TYPE: "postgres" }), ARGS);
  assert.equal(answer(noUrl).result, "unreadable", "a postgres choice with no URL is a store that cannot be opened, not an empty one");
});

test("T17(q) [postgres]: the read sends no migration - one READ ONLY transaction with one SELECT, then the connection ends - on success and on every failure", async () => {
  const { createReadOnlyTaskStateReader } = await import("./stores/read-only-task-states.js");
  const { readHandoffSource } = await import("./rotation-handoff-source.js");
  const { ROTATION_HANDOFF_SOURCE_LIST_LIMIT } = await import("./constants.js");
  const home = freshHome("handoff-cli-fake-pg");
  const rotationRoot = join(home, ".agent-memory", "rotation");
  const directory = seatDirectory(rotationRoot, AGENT, PROJECT);
  mkdirSync(directory, { recursive: true });
  writeMarker(directory, marker());
  const env = { AGENT_MEMORY_DB_TYPE: "postgres", AGENT_MEMORY_DATABASE_URL: "postgres://reader@db.example.invalid/memory" } as NodeJS.ProcessEnv;
  const at = new Date("2026-11-12T00:00:00.000Z");
  const row = { task_id: rotationHandoffTaskId(PROJECT), progress: HANDOFF, created_at: at, updated_at: new Date("2026-11-12T01:00:00.000Z") };
  const fake = (over: { connect?: Error; select?: Error } = {}) => {
    const events: string[] = [];
    const values: unknown[][] = [];
    const client = {
      connect: async () => { events.push("connect"); if (over.connect) throw over.connect; },
      query: async (text: string, params?: unknown[]) => {
        events.push(text);
        if (params) values.push(params);
        if (text.startsWith("SELECT") && over.select) throw over.select;
        return { rows: text.startsWith("SELECT") ? [row] : [] };
      },
      end: async () => { events.push("end"); },
    };
    return { events, values, factory: (url: string) => { events.push(`client:${url}`); return client; } };
  };

  const ok = fake();
  const got = await readHandoffSource(createReadOnlyTaskStateReader(env, { pg_client: ok.factory }), { agent_id: AGENT, project: PROJECT, rotation_root: rotationRoot });
  assert.equal(got.result, "found");
  assert.equal(got.result === "found" ? got.task_updated_at : null, "2026-11-12T01:00:00.000Z", "a timestamp column comes back as the store gives it: an ISO string");
  assert.deepEqual(ok.events, [
    "client:postgres://reader@db.example.invalid/memory", "connect", "BEGIN READ ONLY",
    "SELECT * FROM task_states WHERE agent_id = $1 AND project = $2 ORDER BY created_at DESC LIMIT $3", "ROLLBACK", "end",
  ]);
  assert.deepEqual(ok.values, [[AGENT, PROJECT, ROTATION_HANDOFF_SOURCE_LIST_LIMIT]]);
  assert.ok(!ok.events.some((event) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COMMIT|GRANT)\b/i.test(event)), "nothing that writes, and no migration");

  const filtered = fake();
  await createReadOnlyTaskStateReader(env, { pg_client: filtered.factory }).getTaskStates({ agent_id: AGENT, status: "in_progress" });
  assert.ok(filtered.events.includes("SELECT * FROM task_states WHERE agent_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3"));
  assert.deepEqual(filtered.values, [[AGENT, "in_progress", 5]]);

  const endFails = fake();
  const factoryWithFailingEnd = (url: string) => ({ ...endFails.factory(url), end: async () => { throw new Error("socket already closed"); } });
  const stillFound = await readHandoffSource(createReadOnlyTaskStateReader(env, { pg_client: factoryWithFailingEnd }), { agent_id: AGENT, project: PROJECT, rotation_root: rotationRoot });
  assert.equal(stillFound.result, "found", "a connection that cannot be ended tidily does not turn a read that succeeded into a failure");

  for (const [label, over] of [["a refused connection", { connect: new Error("refused") }], ["a failing query", { select: new Error("permission denied") }]] as const) {
    const failing = fake(over);
    const result = await readHandoffSource(createReadOnlyTaskStateReader(env, { pg_client: failing.factory }), { agent_id: AGENT, project: PROJECT, rotation_root: rotationRoot });
    assert.equal(result.result, "unreadable", label);
    assert.equal(failing.events.at(-1), "end", `${label}: the connection is ended`);
  }
});

test("T17(s) [postgres]: the client survives an idle break, and a server that never answers ends the read as 'unreadable' when the time is used up", async () => {
  const { createPgReadClient, createReadOnlyTaskStateReader } = await import("./stores/read-only-task-states.js");
  const { readHandoffSource } = await import("./rotation-handoff-source.js");
  const { ROTATION_HANDOFF_SOURCE_PG_TIMEOUT_MS } = await import("./constants.js");
  assert.equal(ROTATION_HANDOFF_SOURCE_PG_TIMEOUT_MS, 10_000);
  const idle = createPgReadClient("postgres://nobody@127.0.0.1:1/none");
  assert.doesNotThrow(() => (idle as unknown as EventEmitter).emit("error", new Error("the connection broke while idle")), "an error on an idle connection does not end the process");
  // A server that accepts the connection and never answers.
  const open = new Set<import("node:net").Socket>();
  const silent = createServer((socket) => { open.add(socket); socket.on("error", () => undefined); socket.on("close", () => open.delete(socket)); });
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const port = (silent.address() as { port: number }).port;
  try {
    const home = freshHome("handoff-cli-silent");
    const rotationRoot = join(home, ".agent-memory", "rotation");
    const directory = seatDirectory(rotationRoot, AGENT, PROJECT);
    mkdirSync(directory, { recursive: true });
    writeMarker(directory, marker());
    const env = { AGENT_MEMORY_DB_TYPE: "postgres", AGENT_MEMORY_DATABASE_URL: `postgres://nobody@127.0.0.1:${port}/none` } as NodeJS.ProcessEnv;
    const startedAt = Date.now();
    const result = await readHandoffSource(
      createReadOnlyTaskStateReader(env, { pg_client: (url) => createPgReadClient(url, 300) }),
      { agent_id: AGENT, project: PROJECT, rotation_root: rotationRoot },
    );
    assert.equal(result.result, "unreadable");
    assert.ok(Date.now() - startedAt < 5_000, "the read gave up when its time was used up");
    // The real command, with the real time (10 seconds): it ends with 'unreadable' and exit 1 - it does not stay alive on the open connection.
    const cliStartedAt = Date.now();
    const ran = spawnSync(process.execPath, ["--import", "tsx", join(process.cwd(), "src", "restart-cli.ts"), ...ARGS], {
      encoding: "utf8", cwd: process.cwd(), timeout: 40_000,
      env: commandEnv(home, { AGENT_MEMORY_DB_TYPE: "postgres", AGENT_MEMORY_DATABASE_URL: `postgres://nobody@127.0.0.1:${port}/none` }),
    });
    assert.equal(ran.status, 1, `the command ended by itself: ${ran.stderr}`);
    assert.equal(answer(ran).result, "unreadable");
    assert.ok(Date.now() - cliStartedAt >= ROTATION_HANDOFF_SOURCE_PG_TIMEOUT_MS - 500, "it waited for the declared time before it gave up");
  } finally {
    for (const socket of open) socket.destroy();
    await new Promise<void>((resolve) => silent.close(() => resolve()));
  }
});

test("T17(p): the reader chooses the store the way createStore does - one function decides, and the reader's folder and file are the store's own", async () => {
  const { resolveStoreBackend } = await import("./stores/index.js");
  const table: Array<[Record<string, string>, string]> = [
    [{}, "sqlite"],
    [{ AGENT_MEMORY_DB_TYPE: "json" }, "json"],
    [{ AGENT_MEMORY_DB_TYPE: "JSON", DATABASE_URL: "postgres://a/b" }, "json"],
    [{ AGENT_MEMORY_DB_TYPE: "sqlite", DATABASE_URL: "postgres://a/b" }, "sqlite"],
    [{ DATABASE_URL: "postgres://a/b" }, "postgres"],
    [{ AGENT_MEMORY_DATABASE_URL: "postgresql://a/b" }, "postgres"],
    [{ AGENT_MEMORY_DB_TYPE: "postgres", DATABASE_URL: "postgres://a/b" }, "postgres"],
    [{ AGENT_MEMORY_DB_TYPE: "mysql" }, "sqlite"],
    [{ DATABASE_URL: "mysql://a/b" }, "sqlite"],
  ];
  for (const [env, expected] of table) assert.equal(resolveStoreBackend(env as NodeJS.ProcessEnv).kind, expected, JSON.stringify(env));
  assert.throws(() => resolveStoreBackend({ AGENT_MEMORY_DB_TYPE: "postgres" } as NodeJS.ProcessEnv), /requires AGENT_MEMORY_DATABASE_URL or DATABASE_URL/);
  assert.equal(resolveStoreBackend({ AGENT_MEMORY_DB_TYPE: "json", DATABASE_URL: "postgres://a/b" } as NodeJS.ProcessEnv).ignores_postgres_url, true);
  const { resolveSqliteDbPath } = await import("./stores/sqlite-store.js");
  assert.equal(resolveSqliteDbPath("/x/own.db", { AGENT_MEMORY_DB_PATH: "/y/env.db" } as NodeJS.ProcessEnv), "/x/own.db");
  assert.equal(resolveSqliteDbPath(undefined, { AGENT_MEMORY_DB_PATH: "/y/env.db" } as NodeJS.ProcessEnv), "/y/env.db");
  // The real stores take the same paths: a store made with no argument and the environment's path writes where the reader looks.
  const home = freshHome("handoff-cli-same-place");
  const dbPath = join(home, "store", "memory.db");
  const made = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `const m = await import(process.argv[1]); const s = new m.SqliteStore(); await s.initialize(); await s.close();`,
    pathToFileURL(join(process.cwd(), "src", "stores", "sqlite-store.ts")).href],
  { encoding: "utf8", env: commandEnv(home, { AGENT_MEMORY_DB_PATH: dbPath }), cwd: process.cwd() });
  assert.equal(made.status, 0, made.stderr);
  assert.ok(existsSync(dbPath), "SqliteStore with no argument used the environment's path, which is the path the reader resolves");
  // End to end: whatever createStore chooses and saves into, the command reads from - with a PostgreSQL URL present, with an explicit path, and by default.
  const storeModule = pathToFileURL(join(process.cwd(), "src", "stores", "index.ts")).href;
  const saveThroughCreateStore = `const m = await import(process.argv[1]); const s = await m.createStore();
    await s.saveTaskState({ agent_id: process.env.T_AGENT, project: process.env.T_PROJECT, task_id: process.env.T_TASK_ID, task: "引き継ぎ", status: "in_progress", progress: process.env.T_TEXT });
    await s.close();`;
  const chosen: Array<[string, (home: string) => Record<string, string>, RegExp | null]> = [
    ["json, with a PostgreSQL URL present", () => ({ AGENT_MEMORY_DB_TYPE: "json", DATABASE_URL: "postgres://nobody@127.0.0.1:1/none" }), /AGENT_MEMORY_DB_TYPE=json ignores configured PostgreSQL URL/],
    ["sqlite, by default", () => ({}), /Using SQLite storage \(default\)/],
    ["sqlite, at an explicit path", (home) => ({ AGENT_MEMORY_DB_TYPE: "sqlite", AGENT_MEMORY_DB_PATH: join(home, "store", "chosen.db"), DATABASE_URL: "postgres://nobody@127.0.0.1:1/none" }), /AGENT_MEMORY_DB_TYPE=sqlite ignores configured PostgreSQL URL/],
  ];
  for (const [label, extra, said] of chosen) {
    const placeHome = freshHome("handoff-cli-chosen");
    const directory = seatDirectory(join(placeHome, ".agent-memory", "rotation"), AGENT, PROJECT);
    mkdirSync(directory, { recursive: true });
    writeMarker(directory, marker());
    const env = commandEnv(placeHome, extra(placeHome));
    const saved = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", saveThroughCreateStore, storeModule], {
      encoding: "utf8", cwd: process.cwd(), env: { ...env, T_AGENT: AGENT, T_PROJECT: PROJECT, T_TASK_ID: rotationHandoffTaskId(PROJECT), T_TEXT: HANDOFF },
    });
    assert.equal(saved.status, 0, `${label}: ${saved.stderr}`);
    if (said) assert.match(saved.stderr, said, label);
    const read = runRestartCli(env, ARGS);
    assert.equal(read.status, 0, `${label}: ${read.stderr}`);
    assert.equal(answer(read).text, HANDOFF, `${label}: the command reads the store createStore wrote`);
  }
});

test("T17(r): the reader gives the rows a store gives - the same filter, the same order, the same limit - on JSON and on SQLite", async () => {
  const { readTaskStatesReadOnly } = await import("./stores/read-only-task-states.js");
  const pick = (rows: Array<{ task_id?: string; progress?: string; created_at: string; updated_at?: string }>) =>
    JSON.stringify(rows.map((row) => ({ task_id: row.task_id, progress: row.progress, created_at: row.created_at, updated_at: row.updated_at })));
  const inputs = [
    { agent_id: AGENT },
    { agent_id: AGENT, project: PROJECT },
    { agent_id: AGENT, project: PROJECT, status: "in_progress" as const },
    { agent_id: AGENT, status: "completed" as const },
    { agent_id: AGENT, status: "all" as const, limit: 2 },
    { agent_id: AGENT, limit: 1 },
    { agent_id: AGENT, project: PROJECT, limit: 500 },
    { agent_id: "nobody" },
  ];

  // JSON: raw rows with the same time (a tie), a newer and an older row, other statuses, projects and agents.
  const jsonHome = freshHome("handoff-cli-equal-json");
  const jsonDir = join(jsonHome, "records");
  mkdirSync(jsonDir, { recursive: true });
  const raw = (id: string, over: Record<string, unknown>) => ({
    id, agent_id: AGENT, project: PROJECT, task_id: id, task: id, status: "in_progress", progress: `progress of ${id}`, files_modified: [],
    created_at: "2026-03-01T00:00:00.000Z", updated_at: "2026-03-01T00:00:00.000Z", ...over,
  });
  writeFileSync(join(jsonDir, "task-states.json"), JSON.stringify([
    raw("a", {}), raw("b", {}), raw("c", { created_at: "2026-04-01T00:00:00.000Z" }), raw("d", { created_at: "2026-02-01T00:00:00.000Z" }),
    raw("e", { status: "completed" }), raw("f", { project: "elsewhere" }), raw("g", { agent_id: "someone-else" }), raw("h", { status: "blocked", created_at: "2026-03-01T00:00:00.000Z" }),
  ]));
  const jsonStore = new JsonStore(jsonDir);
  await jsonStore.initialize();
  for (const input of inputs) {
    const fromStore = await jsonStore.getTaskStates(input);
    const fromReader = await readTaskStatesReadOnly({ AGENT_MEMORY_DB_TYPE: "json" } as NodeJS.ProcessEnv, input, { json_dir: jsonDir });
    assert.equal(pick(fromReader), pick(fromStore), `json ${JSON.stringify(input)}`);
    assert.equal(fromStore.length > 0, input.agent_id !== "nobody", `json ${JSON.stringify(input)}: the comparison is over real rows, not two empty lists`);
  }
  await jsonStore.close();

  // SQLite: rows saved through the store, a few milliseconds apart, with the same filters.
  const sqliteHome = freshHome("handoff-cli-equal-sqlite");
  const dbPath = join(sqliteHome, "store", "memory.db");
  const sqliteStore = new SqliteStore(dbPath);
  await sqliteStore.initialize();
  const save = async (id: string, over: Record<string, unknown> = {}) => {
    await sqliteStore.saveTaskState({ agent_id: AGENT, project: PROJECT, task_id: id, task: id, status: "in_progress", progress: `progress of ${id}`, ...over } as never);
    await new Promise((resolve) => setTimeout(resolve, 5));
  };
  await save("a"); await save("b"); await save("c", { status: "completed" }); await save("d"); await save("e", { project: "elsewhere" });
  await save("f", { agent_id: "someone-else" }); await save("g", { status: "blocked" }); await save("a", { progress: "a again" });
  await sqliteStore.close();
  for (const input of inputs) {
    const check = new SqliteStore(dbPath);
    await check.initialize();
    const fromStore = await check.getTaskStates(input);
    await check.close();
    const fromReader = await readTaskStatesReadOnly({ AGENT_MEMORY_DB_TYPE: "sqlite", AGENT_MEMORY_DB_PATH: dbPath } as NodeJS.ProcessEnv, input);
    assert.equal(pick(fromReader), pick(fromStore), `sqlite ${JSON.stringify(input)}`);
    assert.equal(fromStore.length > 0, input.agent_id !== "nobody", `sqlite ${JSON.stringify(input)}: the comparison is over real rows, not two empty lists`);
  }
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
  console.error(`FAIL test-handoff-source-cli (${failed}/${cases.length})`);
  process.exit(1);
}
console.log(`PASS test-handoff-source-cli (${cases.length} cases)`);
