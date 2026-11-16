/**
 * Store resolution, unit and machine-check layer (261113-store-resolution-fix): U1-U6 (the core, the adapter, the
 * opaque target, createStore from a decision, the SessionStart evidence), U11 (the literals that decide a store live in
 * one place) and U13 (CI reaches the new tests). No PostgreSQL server is needed: the PostgreSQL cases point at a closed
 * port. The home folder is a throwaway one, set before any store module is loaded (the JSON and SQLite stores fix their
 * default folder when they are imported).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import type { StoreConfigRead, StoreDecision, StoreRefusalReason, StoreResolution } from "./store-resolution.js";

const HOME = realpathSync(mkdtempSync(join(tmpdir(), "store-res-unit-home-")));
mkdirSync(join(HOME, ".agent-memory"));
const STORE_ENV_NAMES = ["AGENT_MEMORY_DB_TYPE", "AGENT_MEMORY_DATABASE_URL", "DATABASE_URL", "AGENT_MEMORY_DB_PATH"] as const;
for (const name of STORE_ENV_NAMES) delete process.env[name];
process.env.HOME = HOME;

const {
  StoreRefusedError, StoreTarget, decideStore, readUserConfig, requireStore, resolveStore, storeBindingSha256, storeRefusedReason,
} = await import("./store-resolution.js");
const { createStore, openResolvedStore } = await import("./stores/index.js");
const { SqliteStore } = await import("./stores/sqlite-store.js");
const { resolveSessionStartStore } = await import("./codex-session-start.js");

const cases: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);
const j = (value: unknown) => JSON.stringify(value);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const made: string[] = [];
function tmp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `store-res-${prefix}-`)));
  made.push(dir);
  return dir;
}

const PG = "postgres://127.0.0.1:5432/u1";
const PG2 = "postgres://127.0.0.1:5433/u1b";
const SECRET = "SECRETPW";
const REASONS: StoreRefusalReason[] = ["unknown_db_type", "env_url_shape", "config_kind", "config_read", "config_content", "target_missing"];

function decide(env: NodeJS.ProcessEnv, config: StoreConfigRead = { status: "absent" }) {
  let reads = 0;
  const decision = decideStore(env, () => {
    reads += 1;
    return config;
  });
  return { decision, reads };
}

function resolutionOf(decision: StoreDecision): StoreResolution {
  assert.ok(decision.ok, `expected a decision, got ${j(decision)}`);
  return decision.resolution;
}

// ---------- U1: the core table ----------
interface Row {
  name: string;
  env: NodeJS.ProcessEnv;
  config?: StoreConfigRead;
  backend: "postgres" | "sqlite" | "json";
  source: "environment" | "user_config" | "local_default";
  reads: number;
  url?: string;
  ignores?: boolean;
  configSeen?: boolean;
}
const ROWS: Row[] = [
  { name: "sqlite named", env: { AGENT_MEMORY_DB_TYPE: "sqlite" }, backend: "sqlite", source: "environment", reads: 0 },
  { name: "SQLite named in capitals while a PostgreSQL URL is set", env: { AGENT_MEMORY_DB_TYPE: "SQLite", DATABASE_URL: PG }, backend: "sqlite", source: "environment", reads: 0, ignores: true },
  { name: "json named while a PostgreSQL URL is set", env: { AGENT_MEMORY_DB_TYPE: "json", AGENT_MEMORY_DATABASE_URL: PG }, backend: "json", source: "environment", reads: 0, ignores: true },
  { name: "json named", env: { AGENT_MEMORY_DB_TYPE: "json" }, backend: "json", source: "environment", reads: 0 },
  { name: "AGENT_MEMORY_DATABASE_URL", env: { AGENT_MEMORY_DATABASE_URL: PG }, backend: "postgres", source: "environment", reads: 0, url: PG },
  { name: "DATABASE_URL", env: { DATABASE_URL: PG2 }, backend: "postgres", source: "environment", reads: 0, url: PG2 },
  { name: "both URLs: AGENT_MEMORY_DATABASE_URL first", env: { AGENT_MEMORY_DATABASE_URL: PG, DATABASE_URL: PG2 }, backend: "postgres", source: "environment", reads: 0, url: PG },
  { name: "an empty AGENT_MEMORY_DATABASE_URL falls through to DATABASE_URL", env: { AGENT_MEMORY_DATABASE_URL: "", DATABASE_URL: PG2 }, backend: "postgres", source: "environment", reads: 0, url: PG2 },
  { name: "postgres named with a URL", env: { AGENT_MEMORY_DB_TYPE: "postgres", DATABASE_URL: PG }, backend: "postgres", source: "environment", reads: 0, url: PG },
  { name: "the postgresql scheme", env: { DATABASE_URL: "postgresql://127.0.0.1/x" }, backend: "postgres", source: "environment", reads: 0, url: "postgresql://127.0.0.1/x" },
  { name: "the environment URL wins over the user config", env: { DATABASE_URL: PG2 }, config: { status: "read", content: { database_url: PG } }, backend: "postgres", source: "environment", reads: 0, url: PG2 },
  { name: "nothing set, no user config", env: {}, backend: "sqlite", source: "local_default", reads: 1, configSeen: false },
  { name: "an empty URL is the same as no URL", env: { AGENT_MEMORY_DATABASE_URL: "", DATABASE_URL: "" }, backend: "sqlite", source: "local_default", reads: 1, configSeen: false },
  { name: "a user config without database_url", env: {}, config: { status: "read", content: {} }, backend: "sqlite", source: "local_default", reads: 1, configSeen: true },
  { name: "a user config with database_url", env: {}, config: { status: "read", content: { database_url: PG } }, backend: "postgres", source: "user_config", reads: 1, url: PG, configSeen: true },
  { name: "postgres named, URL only in the user config", env: { AGENT_MEMORY_DB_TYPE: "POSTGRES" }, config: { status: "read", content: { database_url: PG } }, backend: "postgres", source: "user_config", reads: 1, url: PG, configSeen: true },
];
for (const row of ROWS) {
  test(`U1: ${row.name}`, () => {
    const { decision, reads } = decide(row.env, row.config);
    const resolution = resolutionOf(decision);
    assert.equal(resolution.backend, row.backend);
    assert.equal(resolution.source, row.source);
    assert.equal(reads, row.reads, "the user config is read only when the environment does not decide, and once at most");
    assert.equal(resolution.ignores_postgres_url, row.ignores ?? false);
    if (row.configSeen !== undefined) assert.equal(resolution.config_seen, row.configSeen);
    if (resolution.backend === "postgres") assert.equal(resolution.target.reveal(), row.url);
    else assert.equal(resolution.target, null);
  });
}

interface Refusal {
  name: string;
  env: NodeJS.ProcessEnv;
  config?: StoreConfigRead;
  reason: StoreRefusalReason;
  reads: number;
}
const bad = (content: unknown): StoreConfigRead => ({ status: "read", content });
const REFUSALS: Refusal[] = [
  { name: "an unknown AGENT_MEMORY_DB_TYPE", env: { AGENT_MEMORY_DB_TYPE: "mysql" }, reason: "unknown_db_type", reads: 0 },
  { name: "an unknown AGENT_MEMORY_DB_TYPE while a URL is set", env: { AGENT_MEMORY_DB_TYPE: "mysql", DATABASE_URL: PG }, reason: "unknown_db_type", reads: 0 },
  { name: "an environment URL that is not PostgreSQL", env: { DATABASE_URL: `mysql://u:${SECRET}@h/db` }, reason: "env_url_shape", reads: 0 },
  { name: "an environment URL in the wrong case", env: { AGENT_MEMORY_DATABASE_URL: "Postgres://127.0.0.1/x" }, reason: "env_url_shape", reads: 0 },
  { name: "a user config that is not a regular file", env: {}, config: { status: "unreadable", reason: "config_kind" }, reason: "config_kind", reads: 1 },
  { name: "a user config that cannot be read", env: {}, config: { status: "unreadable", reason: "config_read" }, reason: "config_read", reads: 1 },
  { name: "a user config that is not JSON", env: {}, config: { status: "unreadable", reason: "config_content" }, reason: "config_content", reads: 1 },
  { name: "a user config that is null", env: {}, config: bad(null), reason: "config_content", reads: 1 },
  { name: "a user config that is an array", env: {}, config: bad([]), reason: "config_content", reads: 1 },
  { name: "a user config that is a string", env: {}, config: bad("x"), reason: "config_content", reads: 1 },
  { name: "a user config that is a number", env: {}, config: bad(5), reason: "config_content", reads: 1 },
  { name: "an empty database_url", env: {}, config: bad({ database_url: "" }), reason: "config_content", reads: 1 },
  { name: "a null database_url", env: {}, config: bad({ database_url: null }), reason: "config_content", reads: 1 },
  { name: "a number as database_url", env: {}, config: bad({ database_url: 5 }), reason: "config_content", reads: 1 },
  { name: "a database_url that is not PostgreSQL", env: {}, config: bad({ database_url: `mysql://u:${SECRET}@h/db` }), reason: "config_content", reads: 1 },
  { name: "postgres named, no user config", env: { AGENT_MEMORY_DB_TYPE: "postgres" }, reason: "target_missing", reads: 1 },
  { name: "postgres named, a user config without database_url", env: { AGENT_MEMORY_DB_TYPE: "postgres" }, config: bad({}), reason: "target_missing", reads: 1 },
];
for (const refusal of REFUSALS) {
  test(`U1/U2: refuses ${refusal.name}`, () => {
    const { decision, reads } = decide(refusal.env, refusal.config);
    assert.deepEqual(decision, { ok: false, reason: refusal.reason });
    assert.ok(REASONS.includes(refusal.reason));
    assert.equal(reads, refusal.reads);
    assert.ok(!j(decision).includes(SECRET), "a refusal names a kind of error, never a value");
    assert.throws(() => {
      throw new StoreRefusedError(refusal.reason);
    }, (error: unknown) => error instanceof StoreRefusedError && error.message === storeRefusedReason(refusal.reason));
  });
}

// ---------- U2/U3: the adapter and the refusal groups on a real file system ----------
function configIn(dir: string, name = "config.json"): string {
  return join(dir, name);
}

test("U3: readUserConfig reports only a missing file as absent", () => {
  const dir = tmp("u3");
  assert.deepEqual(readUserConfig(configIn(dir)), { status: "absent" });
  writeFileSync(configIn(dir), j({ database_url: PG }));
  assert.deepEqual(readUserConfig(configIn(dir)), { status: "read", content: { database_url: PG } });
  mkdirSync(configIn(dir, "dir"));
  assert.deepEqual(readUserConfig(configIn(dir, "dir")), { status: "unreadable", reason: "config_kind" });
  symlinkSync(configIn(dir), configIn(dir, "link.json"));
  assert.deepEqual(readUserConfig(configIn(dir, "link.json")), { status: "unreadable", reason: "config_kind" });
  writeFileSync(configIn(dir, "notjson.json"), "{ not json");
  assert.deepEqual(readUserConfig(configIn(dir, "notjson.json")), { status: "unreadable", reason: "config_content" });
  writeFileSync(configIn(dir, "empty.json"), "");
  assert.deepEqual(readUserConfig(configIn(dir, "empty.json")), { status: "unreadable", reason: "config_content" });
  assert.deepEqual(readUserConfig(join(configIn(dir), "below-a-file.json")), { status: "unreadable", reason: "config_read" }, "a missing file is ENOENT only; a path below a regular file is a failure to read");
});

test("U3: a configuration file that cannot be read is a failure, not an absent file", () => {
  if (process.getuid?.() === 0) {
    console.error("store-resolution: NOT RUN (running as root, chmod does not stop a read): U3 unreadable file");
    return;
  }
  const dir = tmp("u3-chmod");
  writeFileSync(configIn(dir), j({ database_url: PG }));
  chmodSync(configIn(dir), 0);
  try {
    assert.deepEqual(readUserConfig(configIn(dir)), { status: "unreadable", reason: "config_read" });
  } finally {
    chmodSync(configIn(dir), 0o600);
  }
});

test("U2: every refusal group on a real file system gives one closed reason, names no value, and opens no store", () => {
  const dir = tmp(`u2-${SECRET}`);
  const sqlite = join(dir, "never.db");
  const env = { AGENT_MEMORY_DB_PATH: sqlite };
  const files: Array<[string, (path: string) => void, StoreRefusalReason]> = [
    ["a directory", (path) => mkdirSync(path), "config_kind"],
    ["a symbolic link", (path) => symlinkSync(join(dir, "target.json"), path), "config_kind"],
    ["not JSON", (path) => writeFileSync(path, `{ ${SECRET}`), "config_content"],
    ["an array", (path) => writeFileSync(path, "[]"), "config_content"],
    ["database_url not PostgreSQL", (path) => writeFileSync(path, j({ database_url: `mysql://u:${SECRET}@h/db` })), "config_content"],
  ];
  writeFileSync(join(dir, "target.json"), j({ database_url: PG }));
  files.forEach(([label, make, reason], index) => {
    const path = configIn(dir, `case-${index}.json`);
    make(path);
    const decision = resolveStore(env, path);
    assert.deepEqual(decision, { ok: false, reason }, label);
    assert.ok(!j(decision).includes(SECRET) && !j(decision).includes(dir), `${label}: no value or path in the decision`);
    assert.throws(() => requireStore(env, path), (error: unknown) => {
      assert.ok(error instanceof StoreRefusedError);
      assert.equal(error.reason, reason);
      assert.ok(![error.message, String(error), error.stack ?? ""].some((text) => text.includes(SECRET) || text.includes(dir)));
      return true;
    });
  });
  assert.equal(existsSync(sqlite), false, "resolving never opens a store");
});

// ---------- U4: the target is opaque ----------
test("U4: a PostgreSQL URL is printed, stringified and serialized as a fixed word; only reveal returns it", () => {
  const url = `postgres://user:${SECRET}@127.0.0.1:5432/db`;
  const target = new StoreTarget(url);
  const resolution = resolutionOf(decide({ DATABASE_URL: url }).decision);
  const shown = [
    j({ target }), String(target), `${target}`, inspect(target), inspect(target, { showHidden: true, depth: 9 }),
    j(resolution), inspect(resolution, { depth: 9 }), inspect({ nested: { resolution } }, { depth: 9, showHidden: true }),
    Reflect.ownKeys(target).map(String).join(","),
  ];
  for (const text of shown) assert.ok(!text.includes(SECRET) && !text.includes("127.0.0.1"), `the URL leaked into: ${text}`);
  assert.equal(String(target), "[store-target]");
  assert.equal(target.reveal(), url);
  assert.equal(resolution.backend === "postgres" && resolution.target.reveal(), url);
  const digest = storeBindingSha256(resolution, {});
  assert.equal(digest, sha(`kusabi-store-binding/v1\0postgres\0${url}`));
  assert.ok(!digest.includes(SECRET));
});

// ---------- U5: createStore from a decision ----------
async function captureStderr<T>(run: () => Promise<T>): Promise<{ value?: T; error?: unknown; lines: string[] }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    // Only the store's own lines: the runtime may print a one-time deprecation warning through the same stream.
    if (line.startsWith("[agent-memory]")) lines.push(line);
  };
  try {
    return { value: await run(), lines };
  } catch (error) {
    return { error, lines };
  } finally {
    console.error = original;
  }
}

async function withEnv<T>(vars: Partial<Record<(typeof STORE_ENV_NAMES)[number], string>>, run: () => Promise<T>): Promise<T> {
  const saved = new Map(STORE_ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of STORE_ENV_NAMES) delete process.env[name];
  for (const [name, value] of Object.entries(vars)) process.env[name] = value;
  try {
    return await run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

const SQLITE_LINES = {
  explicit: "[agent-memory] Using SQLite storage",
  default: "[agent-memory] Using SQLite storage (default)",
  ignores: "[agent-memory] AGENT_MEMORY_DB_TYPE=sqlite ignores configured PostgreSQL URL; using SQLite storage by explicit request",
};

test("U5: createStore({ resolution }) opens SQLite, with the same stderr lines as before", async () => {
  const dbPath = join(tmp("u5"), "u5.db");
  await withEnv({ AGENT_MEMORY_DB_PATH: dbPath }, async () => {
    const named = await captureStderr(() => createStore({ resolution: resolutionOf(decide({ AGENT_MEMORY_DB_TYPE: "sqlite" }).decision) }));
    assert.equal(named.value?.backend, "sqlite");
    assert.deepEqual(named.lines, [SQLITE_LINES.explicit]);
    await named.value?.close();
    const ignoring = await captureStderr(() => createStore({ resolution: resolutionOf(decide({ AGENT_MEMORY_DB_TYPE: "sqlite", DATABASE_URL: PG }).decision) }));
    assert.deepEqual(ignoring.lines, [SQLITE_LINES.ignores, SQLITE_LINES.explicit]);
    await ignoring.value?.close();
    const byDefault = await captureStderr(() => createStore({ resolution: resolutionOf(decide({}).decision) }));
    assert.equal(byDefault.value?.backend, "sqlite");
    assert.deepEqual(byDefault.lines, [SQLITE_LINES.default]);
    await byDefault.value?.close();
  });
});

test("U5: createStore({ resolution }) opens the JSON store, with the same stderr lines as before", async () => {
  await withEnv({}, async () => {
    const named = await captureStderr(() => createStore({ resolution: resolutionOf(decide({ AGENT_MEMORY_DB_TYPE: "json" }).decision) }));
    assert.equal(named.value?.backend, "json");
    assert.deepEqual(named.lines, ["[agent-memory] Using JSON file storage (~/.agent-memory/)"]);
    await named.value?.close();
    const ignoring = await captureStderr(() => createStore({ resolution: resolutionOf(decide({ AGENT_MEMORY_DB_TYPE: "json", DATABASE_URL: PG }).decision) }));
    assert.deepEqual(ignoring.lines, [
      "[agent-memory] AGENT_MEMORY_DB_TYPE=json ignores configured PostgreSQL URL; using JSON storage by explicit request",
      "[agent-memory] Using JSON file storage (~/.agent-memory/)",
    ]);
    await ignoring.value?.close();
  });
});

test("U5: a PostgreSQL decision that cannot connect is refused with no SQLite fallback and no URL in the output", async () => {
  const dbPath = join(tmp("u5-pg"), "never.db");
  const url = `postgres://user:${SECRET}@127.0.0.1:${await closedPort()}/db`;
  await withEnv({ AGENT_MEMORY_DB_PATH: dbPath }, async () => {
    const result = await captureStderr(() => createStore({ resolution: resolutionOf(decide({ DATABASE_URL: url }).decision), skipPostgresMigrations: true }));
    assert.ok(result.error, "the connection is refused");
    assert.ok(result.lines.some((line) => line.startsWith("[agent-memory] PostgreSQL connection failed; refusing SQLite fallback because a PostgreSQL URL is configured")));
    for (const text of [...result.lines, String(result.error)]) assert.ok(!text.includes(SECRET), "no password in the output");
    assert.equal(existsSync(dbPath), false, "no SQLite file was created");
  });
});

test("U5: createStore() without a decision still reads the environment as before", async () => {
  const dbPath = join(tmp("u5-env"), "env.db");
  await withEnv({ AGENT_MEMORY_DB_PATH: dbPath, AGENT_MEMORY_DB_TYPE: "sqlite" }, async () => {
    const result = await captureStderr(() => createStore());
    assert.equal(result.value?.backend, "sqlite");
    assert.deepEqual(result.lines, [SQLITE_LINES.explicit]);
    await result.value?.close();
  });
  const url = `postgres://127.0.0.1:${await closedPort()}/db`;
  await withEnv({ AGENT_MEMORY_DB_PATH: dbPath + ".2", DATABASE_URL: url }, async () => {
    const result = await captureStderr(() => createStore({ skipPostgresMigrations: true }));
    assert.ok(result.error);
    assert.equal(existsSync(dbPath + ".2"), false);
  });
});

test("U5: openResolvedStore returns a store of the decided backend and closes one that opened as another", async () => {
  const dbPath = join(tmp("u5-open"), "open.db");
  await withEnv({ AGENT_MEMORY_DB_PATH: dbPath }, async () => {
    const resolution = resolutionOf(decide({ AGENT_MEMORY_DB_TYPE: "sqlite" }).decision);
    const opened = await captureStderr(() => openResolvedStore(resolution));
    assert.equal(opened.value?.backend, "sqlite");
    await opened.value?.close();

    const proto = SqliteStore.prototype as unknown as { initialize: () => Promise<void>; close: () => Promise<void> };
    const { initialize, close } = proto;
    let closed = 0;
    proto.initialize = async function (this: object) {
      await initialize.call(this);
      Object.defineProperty(this, "backend", { value: "json" });
    };
    proto.close = async function (this: object) {
      closed += 1;
      await close.call(this);
    };
    try {
      const mismatch = await captureStderr(() => openResolvedStore(resolution));
      assert.match(String(mismatch.error), /does not match the decision \(sqlite\)/);
    } finally {
      proto.initialize = initialize;
      proto.close = close;
    }
    assert.equal(closed, 1, "the store that opened as the wrong backend was closed");
  });
});

// ---------- U6: the SessionStart evidence is the same as before ----------
const HOOK_ENV_URL = "postgres://127.0.0.1:5432/u6env";
const HOOK_CONFIG_URL = "postgres://127.0.0.1:5433/u6cfg";
interface Combo {
  name: string;
  env: NodeJS.ProcessEnv;
  config?: unknown;
  expected: (configPath: string) => {
    source: string; backend_intent: string; config_path_sha256: string | null; binding_sha256: string;
  };
}
const bind = (backend: string, locator: string) => sha(`kusabi-store-binding/v1\0${backend}\0${locator}`);
const DEFAULT_SQLITE = () => bind("sqlite", resolve(join(HOME, ".agent-memory", "memory.db")));
const COMBOS: Combo[] = [
  { name: "environment URL only", env: { AGENT_MEMORY_DATABASE_URL: HOOK_ENV_URL }, expected: () => ({ source: "environment", backend_intent: "postgres", config_path_sha256: null, binding_sha256: bind("postgres", HOOK_ENV_URL) }) },
  { name: "user config only", env: {}, config: { database_url: HOOK_CONFIG_URL }, expected: (path) => ({ source: "user_config", backend_intent: "postgres", config_path_sha256: sha(resolve(path)), binding_sha256: bind("postgres", HOOK_CONFIG_URL) }) },
  { name: "both: the environment wins", env: { AGENT_MEMORY_DATABASE_URL: HOOK_ENV_URL }, config: { database_url: HOOK_CONFIG_URL }, expected: () => ({ source: "environment", backend_intent: "postgres", config_path_sha256: null, binding_sha256: bind("postgres", HOOK_ENV_URL) }) },
  { name: "sqlite named", env: { AGENT_MEMORY_DB_TYPE: "sqlite", AGENT_MEMORY_DB_PATH: join(HOME, "named.db") }, expected: () => ({ source: "environment", backend_intent: "sqlite", config_path_sha256: null, binding_sha256: bind("sqlite", resolve(join(HOME, "named.db"))) }) },
  { name: "json named", env: { AGENT_MEMORY_DB_TYPE: "json" }, expected: () => ({ source: "environment", backend_intent: "json", config_path_sha256: null, binding_sha256: bind("json", resolve(join(HOME, ".agent-memory"))) }) },
  { name: "nothing set", env: {}, expected: () => ({ source: "local_default", backend_intent: "sqlite", config_path_sha256: null, binding_sha256: DEFAULT_SQLITE() }) },
  { name: "a user config without database_url", env: {}, config: {}, expected: (path) => ({ source: "local_default", backend_intent: "sqlite", config_path_sha256: sha(resolve(path)), binding_sha256: DEFAULT_SQLITE() }) },
  { name: "postgres named with the environment URL", env: { AGENT_MEMORY_DB_TYPE: "postgres", DATABASE_URL: HOOK_ENV_URL }, expected: () => ({ source: "environment", backend_intent: "postgres", config_path_sha256: null, binding_sha256: bind("postgres", HOOK_ENV_URL) }) },
  { name: "postgres named with the user config URL", env: { AGENT_MEMORY_DB_TYPE: "postgres" }, config: { database_url: HOOK_CONFIG_URL }, expected: (path) => ({ source: "user_config", backend_intent: "postgres", config_path_sha256: sha(resolve(path)), binding_sha256: bind("postgres", HOOK_CONFIG_URL) }) },
];
COMBOS.forEach((combo, index) => {
  test(`U6: the SessionStart evidence for "${combo.name}" is the one the previous code produced`, () => {
    const dir = tmp(`u6-${index}`);
    const path = configIn(dir);
    if (combo.config !== undefined) writeFileSync(path, j(combo.config));
    const env = { ...combo.env };
    const processBefore = j(process.env);
    const { binding, resolution } = resolveSessionStartStore(env, path);
    assert.deepEqual(binding, { ...combo.expected(path), verified: true, credentials_embedded: false });
    assert.equal(resolution.backend, binding.backend_intent);
    assert.equal(resolution.source, binding.source);
    assert.deepEqual(env, combo.env, "the environment given is not written");
    assert.equal(j(process.env), processBefore, "the process environment is not written");
    assert.ok(!j(binding).includes("127.0.0.1"), "the evidence names no URL");
  });
});

test("U6: a refused setting degrades the hook and writes nothing", () => {
  const dir = tmp("u6-refused");
  const env = { AGENT_MEMORY_DB_TYPE: "mysql" };
  assert.throws(() => resolveSessionStartStore(env, configIn(dir)), (error: unknown) => {
    const e = error as { name: string; reason: string; message: string };
    return e.name === "HookDegradedError" && e.reason === "RECOVERY_UNAVAILABLE" && e.message === "RECOVERY_UNAVAILABLE";
  });
  assert.deepEqual(env, { AGENT_MEMORY_DB_TYPE: "mysql" });
});

// ---------- U11: the literals that decide a store are in one place ----------
const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(SRC_DIR, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.startsWith("test") ? [path] : [];
  });
}
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/(?<=[;,{}\)\s])\/\/\s.*$/gm, "");
const DECIDING_LITERALS = /AGENT_MEMORY_DB_TYPE|AGENT_MEMORY_DATABASE_URL|DATABASE_URL|database_url|startsWith\("postgres|\^postgres/;
const NEW_STORE = /new (?:PgStore|SqliteStore|JsonStore)\(/;
/** Carry-over: tools that build a URL for a child process or read their own variable, not an entry that decides a hook's store. */
const LITERAL_ALLOWED = new Set([
  "stores/index.ts", // resolveStoreBackend: the MCP server, the CLI and the entries below decide from the environment alone
  "post-tool-hook.ts", // reads the environment of its own process
  "codex-start.ts", // builds the environment of the child process it starts
  "fleet-conversation-backfill.ts", // a tool that reads its own variables
  "kusabi-direct-fleet-rollout.ts", // a tool that writes the configuration it rolls out
  "kusabi-fresh-session-fleet.ts", // builds a child environment
  "migrate.ts", // runs the table migrations from DATABASE_URL
  "redact.ts", // a pattern that hides secrets; decides no store
  "measure-kusabi-functional.ts", // reads KUSABI_G2_DATABASE_URL
  "store-resolution.ts", // the one place
]);
const NEW_STORE_ALLOWED = new Set([
  "stores/index.ts", "kusabi-runtime-event-emitter.ts", "fleet-conversation-backfill.ts",
  "measure-kusabi-functional.ts", "kusabi-continuity-interruption-e2e.ts",
]);
function filesWith(texts: Map<string, string>, pattern: RegExp): string[] {
  return [...texts].filter(([, text]) => pattern.test(withoutComments(text))).map(([path]) => path).sort();
}
const realSources = (): Map<string, string> =>
  new Map(sourceFiles(SRC_DIR).map((path) => [relative(SRC_DIR, path), readFileSync(path, "utf8")]));

test("U11: only the one resolver and the listed carry-over files hold the literals that decide a store", () => {
  const found = filesWith(realSources(), DECIDING_LITERALS);
  assert.ok(found.includes("store-resolution.ts"));
  assert.deepEqual(found.filter((path) => !LITERAL_ALLOWED.has(path)), [], "a new file decides a store on its own: use resolveStore");
  const stores = filesWith(realSources(), NEW_STORE);
  assert.deepEqual(stores.filter((path) => !NEW_STORE_ALLOWED.has(path)), [], "a store is built outside createStore and the listed files");
});

test("U11 (negative): the check flags a file that decides a store on its own and ignores comments", () => {
  const texts = new Map([
    ["new-entry.ts", "const url = process.env.DATABASE_URL;"],
    ["commented.ts", "// DATABASE_URL is read elsewhere\n/* database_url */\nconst x = 1; // AGENT_MEMORY_DB_TYPE"],
    ["builds.ts", "const s = new SqliteStore();"],
  ]);
  assert.deepEqual(filesWith(texts, DECIDING_LITERALS), ["new-entry.ts"]);
  assert.deepEqual(filesWith(texts, NEW_STORE), ["builds.ts"]);
});

// ---------- U13: CI reaches the new tests ----------
function runCommandsOf(yaml: string): string[] {
  const out: string[] = [];
  const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const value = match[2].trim();
    if (value === "|" || value === ">") {
      for (i += 1; i < lines.length; i += 1) {
        if (lines[i].trim() === "") continue;
        if (/^(\s*)/.exec(lines[i])![1].length <= match[1].length) {
          i -= 1;
          break;
        }
        out.push(lines[i].trim());
      }
    } else if (value !== "") {
      out.push(value);
    }
  }
  return out;
}

function reachedTests(commands: string[], scripts: Record<string, string>): Set<string> {
  const files = new Set<string>();
  const seen = new Set<string>();
  const visit = (command: string): void => {
    for (const part of command.split("&&").map((piece) => piece.trim())) {
      const npm = /(?:^|\s)npm run (\S+)/.exec(part) ?? (/(?:^|\s)npm test\b/.test(part) ? [part, "test"] : null);
      if (npm) {
        if (!seen.has(npm[1])) {
          seen.add(npm[1]);
          if (scripts[npm[1]] !== undefined) visit(scripts[npm[1]]);
        }
        continue;
      }
      const tsx = /(?:^|\s)tsx\s+(\S+\.ts)\b/.exec(part);
      if (tsx) files.add(tsx[1]);
    }
  };
  commands.forEach(visit);
  return files;
}

const NEW_TESTS = ["src/test-store-resolution.ts", "src/test-store-resolution-scenario.ts"];
const missingFrom = (yaml: string, scripts: Record<string, string>) => {
  const reached = reachedTests(runCommandsOf(yaml), scripts);
  return NEW_TESTS.filter((file) => !reached.has(file));
};

test("U13: the commands CI runs reach both new test files, and the check fails on the two wrong shapes", () => {
  const yaml = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const scripts = (JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
  assert.ok(runCommandsOf(yaml).includes("npm run test:claude-hook"), "the step this check relies on is still in ci.yml");
  assert.deepEqual(missingFrom(yaml, scripts), [], "CI does not run a new test file");

  const tail = " && npm run test:store-resolution";
  assert.ok(scripts["test:claude-hook"].endsWith(tail) && scripts.test.endsWith(tail), "the chain this check is about");
  const strip = (body: string) => body.slice(0, -tail.length);
  assert.deepEqual(missingFrom(yaml, { ...scripts, "test:claude-hook": strip(scripts["test:claude-hook"]), test: strip(scripts.test) }), NEW_TESTS, "the chain removed everywhere");
  assert.deepEqual(missingFrom(yaml, { ...scripts, "test:claude-hook": strip(scripts["test:claude-hook"]) }), NEW_TESTS, "added to `test` only: CI does not run `npm test`");
  assert.deepEqual(
    missingFrom(yaml, { ...scripts, "test:store-resolution": "tsx src/test-store-resolution.ts" }),
    ["src/test-store-resolution-scenario.ts"],
    "one of the two files dropped from the script",
  );
});

let passed = 0;
try {
  for (const [name, run] of cases) {
    try {
      await run();
      passed += 1;
      console.log(`ok - ${name}`);
    } catch (error) {
      console.error(`not ok - ${name}`);
      console.error(error);
      process.exitCode = 1;
    }
  }
} finally {
  for (const dir of [...made, HOME]) rmSync(dir, { recursive: true, force: true });
}
if (process.exitCode === 1) console.error(`store-resolution: ${cases.length - passed} of ${cases.length} checks failed`);
else console.log(`store-resolution: ${passed} checks passed`);
