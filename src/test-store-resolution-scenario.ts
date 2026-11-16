/**
 * Store resolution, scenario layer (261113-store-resolution-fix): S1 (a seat whose only database_url is in the
 * user config must not be written to the default SQLite by the Stop hooks), S3 (every entry decides alike over the
 * nine settings), S4 (a database_url in the user config is never read as the local default), S6 (the emitter worker
 * opens exactly the store the SessionStart evidence bound, or nothing), and the units U7-U10 that need a seat around
 * them. No PostgreSQL server is needed: the unreachable place is a closed port, and S6 counts connections on two
 * local listeners that do not speak the PostgreSQL protocol. The cases that need a real server are in
 * test-store-resolution-pg.ts.
 */
import assert from "node:assert/strict";
import fs, { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { loadAntigravityHookDataFromStore, type AntigravityHookInput, type AntigravitySessionStartBinding } from "./antigravity-session-start.js";
import { kusabiStoreBindingSha256, resolveSessionStartStore, type CodexSessionStartBinding } from "./codex-session-start.js";
import { loadGeminiRecoveryFromStore, type GeminiSessionStartInput } from "./gemini-session-start.js";
import { createQuietStore, emitKusabiSessionStartRuntimeEvent } from "./kusabi-runtime-event-emitter.js";
import { answerHookAndCommit, commitRotationRecovery, type RotationCommitPlan } from "./rotation-commit.js";
import { seatDirectory, writeMarker } from "./session-rotation-files.js";
import { runSessionRotationStop, type RotationStopDependencies } from "./session-rotation-stop.js";
import type { RotationHost } from "./session-rotation-usage.js";
import { localStoreBindingSha256, requireStore, StoreRefusedError, type StoreResolution } from "./store-resolution.js";
import { requireStoreBackend, type Store } from "./stores/index.js";
import { readTaskStatesReadOnly } from "./stores/read-only-task-states.js";
import { AGENT, PROJECT, commandEnv, freshHome, marker, runRestartCli } from "./test-handoff-source-support.js";
import {
  BIG,
  HANDOFF,
  NOW,
  PANE,
  closedPort,
  emitThroughWorker,
  j,
  listener,
  pgUrl,
  removeSeats,
  runtimeTarget,
  seat,
  sessionStartEvidence,
  textLine,
  usageLine,
  withSeatEnv,
  writeUserConfig,
} from "./test-store-resolution-support.js";
import { runTranscriptStopCapture } from "./transcript-stop-capture.js";

const cases: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);
const HOSTS = ["codex", "claude_code"] as const;

for (const host of HOSTS) {
  test(`S1 (${host}): transcript-stop-capture does not open the default SQLite when only the user config names a PostgreSQL`, async () => {
    const port = await closedPort();
    await withSeatEnv({}, async (home) => {
      const dbPath = join(home, "default-sqlite.db");
      process.env.AGENT_MEMORY_DB_PATH = dbPath;
      writeUserConfig(home, { database_url: pgUrl(port) });
      const s = seat();
      const result = await runTranscriptStopCapture(s.input("Stop"), host, s.binding);
      assert.equal(result.evidence.status, "failed_open", "the decided store is PostgreSQL and it cannot be reached");
      assert.equal(existsSync(dbPath), false, "a SQLite file was created although the seat's database_url names a PostgreSQL");
      rmSync(s.root, { recursive: true, force: true });
    });
  });

  test(`S1 (${host}): session-rotation-stop does not save the hand-off into the default SQLite`, async () => {
    const port = await closedPort();
    await withSeatEnv({}, async (home) => {
      const dbPath = join(home, "default-sqlite.db");
      process.env.AGENT_MEMORY_DB_PATH = dbPath;
      writeUserConfig(home, { database_url: pgUrl(port) });
      const s = seat();
      const base: RotationStopDependencies = {
        now: () => NOW,
        identity: PANE,
        rotation_root: s.rotationRoot,
        read_transcript: () => ({ status: "ok", lines: [usageLine(host, BIG)] }),
      };
      await runSessionRotationStop(s.input("Stop"), host, s.binding, {}, base);
      const result = await runSessionRotationStop(s.input("Stop", { stop_hook_active: true }), host, s.binding, {}, {
        ...base,
        read_transcript: () => ({ status: "ok", lines: [usageLine(host, BIG), textLine(host, HANDOFF)] }),
      });
      assert.equal(result.evidence.action, "failed_open", "nothing can be saved: the decided store is an unreachable PostgreSQL");
      assert.equal(result.evidence.marker_id, null, "no marker may be issued for a hand-off that was not stored");
      assert.equal(existsSync(dbPath), false, "a SQLite file was created although the seat's database_url names a PostgreSQL");
      rmSync(s.root, { recursive: true, force: true });
    });
  });
}

// ---------- S6: the emitter worker opens the store the evidence bound, or nothing ----------
test("S6: the worker does not connect to a PostgreSQL other than the one SessionStart bound (environment)", async () => {
  const [a, b] = [await listener(), await listener()];
  try {
    await withSeatEnv({}, async () => {
      const bound = kusabiStoreBindingSha256("postgres", pgUrl(a.port));
      const { result } = await emitThroughWorker("postgres", bound, {
        AGENT_MEMORY_DB_TYPE: "postgres",
        AGENT_MEMORY_DATABASE_URL: pgUrl(b.port),
      });
      assert.equal(b.connections(), 0, "the worker connected to a server the SessionStart evidence did not bind");
      assert.equal(result.status, "emergency_only");
      assert.equal(result.emergency?.normalized_error_code, "binding_drift");
    });
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});

test("S6: the worker does not connect to a PostgreSQL other than the one SessionStart bound (user config)", async () => {
  const [a, b] = [await listener(), await listener()];
  try {
    await withSeatEnv({}, async (home) => {
      writeUserConfig(home, { database_url: pgUrl(b.port) });
      const bound = kusabiStoreBindingSha256("postgres", pgUrl(a.port));
      const { result } = await emitThroughWorker("postgres", bound, {});
      assert.equal(b.connections(), 0, "the worker connected to a server the SessionStart evidence did not bind");
      assert.equal(result.status, "emergency_only");
      assert.equal(result.emergency?.normalized_error_code, "binding_drift");
    });
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});

test("S6: the worker does not create a SQLite file other than the one SessionStart bound", async () => {
  await withSeatEnv({}, async (home) => {
    const pathA = join(home, "a.db");
    const pathB = join(home, "b.db");
    const bound = kusabiStoreBindingSha256("sqlite", pathA);
    const { result } = await emitThroughWorker("sqlite", bound, {
      AGENT_MEMORY_DB_TYPE: "sqlite",
      AGENT_MEMORY_DB_PATH: pathB,
    });
    assert.equal(existsSync(pathB), false, "the worker created a SQLite file the SessionStart evidence did not bind");
    assert.equal(result.status, "emergency_only");
    assert.equal(result.emergency?.normalized_error_code, "binding_drift");
  });
});

test("S6 (positive pair): the worker opens the PostgreSQL the evidence bound", async () => {
  const a = await listener();
  try {
    await withSeatEnv({}, async () => {
      const bound = kusabiStoreBindingSha256("postgres", pgUrl(a.port));
      const { result } = await emitThroughWorker("postgres", bound, {
        AGENT_MEMORY_DB_TYPE: "postgres",
        AGENT_MEMORY_DATABASE_URL: pgUrl(a.port),
      });
      assert.ok(a.connections() >= 1, "the worker never tried the bound server");
      assert.notEqual(result.emergency?.normalized_error_code, "binding_drift");
    });
  } finally {
    await a.close();
  }
});

// ---------- what each entry decides (S3, S4) ----------
interface Observed {
  backend: string;
  source?: string;
  url?: string | null;
}
type Outcome = Observed | { refused: string };

const recorded = (resolution: StoreResolution): Observed => ({
  backend: resolution.backend,
  source: resolution.source,
  url: resolution.backend === "postgres" ? resolution.target.reveal() : null,
});

function refusedFrom(reason: string | null | undefined): Outcome {
  const prefix = "store_refused:";
  if (typeof reason !== "string" || !reason.startsWith(prefix)) throw new Error(`neither a store was asked for nor a refusal recorded: ${String(reason)}`);
  return { refused: reason.slice(prefix.length) };
}

function resolved(entry: string, outcome: Outcome): Observed {
  if ("refused" in outcome) throw new Error(`${entry} refused: ${outcome.refused}`);
  return outcome;
}

function viaSessionStart(): Outcome {
  try {
    return recorded(resolveSessionStartStore().resolution);
  } catch (error) {
    if ((error as Error).name === "HookDegradedError") return { refused: (error as { reason?: string }).reason ?? "degraded" };
    throw error;
  }
}

async function viaTranscriptStop(): Promise<Outcome> {
  const box: { seen?: Observed } = {};
  const s = seat();
  const result = await runTranscriptStopCapture(s.input("Stop"), "codex", s.binding, {
    createStore: async (resolution) => {
      box.seen = recorded(resolution);
      throw new Error("recorded");
    },
  });
  return box.seen ?? refusedFrom(result.evidence.reason);
}

async function viaRotationStop(): Promise<Outcome> {
  const box: { seen?: Observed } = {};
  const s = seat();
  const base: RotationStopDependencies = {
    now: () => NOW,
    identity: PANE,
    rotation_root: s.rotationRoot,
    read_transcript: () => ({ status: "ok", lines: [usageLine("codex", BIG)] }),
  };
  await runSessionRotationStop(s.input("Stop"), "codex", s.binding, {}, base);
  const result = await runSessionRotationStop(s.input("Stop", { stop_hook_active: true }), "codex", s.binding, {}, {
    ...base,
    read_transcript: () => ({ status: "ok", lines: [usageLine("codex", BIG), textLine("codex", HANDOFF)] }),
    createStore: async (resolution) => {
      box.seen = recorded(resolution);
      throw new Error("recorded");
    },
  });
  return box.seen ?? refusedFrom(result.evidence.reason);
}

/** The reader reads without a Store; what it was asked to reach shows as the client it built or the store it found missing. */
async function viaReader(jsonDir: string): Promise<Outcome> {
  const box: { url?: string } = {};
  try {
    await readTaskStatesReadOnly(process.env, { agent_id: "kusabi", project: "agent-memory" }, {
      pg_client: (url) => {
        box.url = url;
        return { connect: async () => { throw new Error("recorded"); }, query: async () => ({ rows: [] }), end: async () => undefined };
      },
      json_dir: jsonDir,
    });
    throw new Error("the reader read rows from a store that was never made");
  } catch (error) {
    if (error instanceof StoreRefusedError) return { refused: error.reason };
    if (box.url !== undefined) return { backend: "postgres", url: box.url };
    const message = (error as Error).message;
    if (message.includes("JSON store folder")) return { backend: "json" };
    if (message.includes("SQLite store file")) return { backend: "sqlite" };
    throw error;
  }
}

interface Ports {
  env: number;
  cfg: number;
}
/** restart-cli runs as the real command; the place it tried shows in what it printed. */
function viaRestartCli(home: string, vars: Record<string, string>, ports: Ports, urls: { env: string; cfg: string }): Outcome {
  const ran = runRestartCli(commandEnv(home, vars), ["fetch", "--agent-id", "kusabi", "--project", "agent-memory", "--pack-ref", "none"]);
  const text = ran.stderr;
  const refused = /store_refused:(\w+)/.exec(text);
  if (refused) return { refused: refused[1] };
  if (text.includes("Using JSON file storage")) return { backend: "json", source: "environment" };
  if (text.includes("Using SQLite storage")) return { backend: "sqlite", source: text.includes("(default)") ? "local_default" : "environment" };
  const port = /127\.0\.0\.1:(\d+)/.exec(text)?.[1];
  if (text.includes("PostgreSQL connection failed") && port !== undefined) {
    if (Number(port) === ports.env) return { backend: "postgres", source: "environment", url: urls.env };
    if (Number(port) === ports.cfg) return { backend: "postgres", source: "user_config", url: urls.cfg };
  }
  throw new Error(`restart-cli fetch left no sign of the store it chose: ${text.slice(0, 300)}`);
}

interface Combo {
  name: string;
  env: (urls: { env: string; cfg: string }) => Record<string, string>;
  config?: (urls: { env: string; cfg: string }) => unknown;
  expect: { backend: string; source: string; url: "env" | "cfg" | null };
}
const S3_COMBOS: Combo[] = [
  { name: "environment URL only", env: (u) => ({ AGENT_MEMORY_DATABASE_URL: u.env }), expect: { backend: "postgres", source: "environment", url: "env" } },
  { name: "user config only", env: () => ({}), config: (u) => ({ database_url: u.cfg }), expect: { backend: "postgres", source: "user_config", url: "cfg" } },
  { name: "both: the environment wins", env: (u) => ({ DATABASE_URL: u.env }), config: (u) => ({ database_url: u.cfg }), expect: { backend: "postgres", source: "environment", url: "env" } },
  { name: "sqlite named", env: () => ({ AGENT_MEMORY_DB_TYPE: "sqlite" }), expect: { backend: "sqlite", source: "environment", url: null } },
  { name: "json named", env: () => ({ AGENT_MEMORY_DB_TYPE: "json" }), expect: { backend: "json", source: "environment", url: null } },
  { name: "nothing set", env: () => ({}), expect: { backend: "sqlite", source: "local_default", url: null } },
  { name: "a user config without database_url", env: () => ({}), config: () => ({}), expect: { backend: "sqlite", source: "local_default", url: null } },
  { name: "postgres named with the environment URL", env: (u) => ({ AGENT_MEMORY_DB_TYPE: "postgres", AGENT_MEMORY_DATABASE_URL: u.env }), expect: { backend: "postgres", source: "environment", url: "env" } },
  { name: "postgres named with the user config URL", env: () => ({ AGENT_MEMORY_DB_TYPE: "postgres" }), config: (u) => ({ database_url: u.cfg }), expect: { backend: "postgres", source: "user_config", url: "cfg" } },
];

for (const combo of S3_COMBOS) {
  test(`S3: SessionStart, both Stop hooks, the reader and restart-cli decide alike for "${combo.name}"`, async () => {
    const ports: Ports = { env: await closedPort(), cfg: await closedPort() };
    const urls = { env: pgUrl(ports.env, "s3env"), cfg: pgUrl(ports.cfg, "s3cfg") };
    await withSeatEnv({}, async (home) => {
      const vars: Record<string, string> = { ...combo.env(urls), AGENT_MEMORY_DB_PATH: join(home, "s3.db") };
      for (const [name, value] of Object.entries(vars)) process.env[name] = value;
      if (combo.config) writeUserConfig(home, combo.config(urls));
      const seen: Array<[string, Observed]> = [
        ["session-start", resolved("session-start", viaSessionStart())],
        ["transcript-stop-capture", resolved("transcript-stop-capture", await viaTranscriptStop())],
        ["session-rotation-stop", resolved("session-rotation-stop", await viaRotationStop())],
        ["reader", resolved("reader", await viaReader(join(home, "no-json-folder")))],
        ["restart-cli", resolved("restart-cli", viaRestartCli(home, vars, ports, urls))],
      ];
      const wantUrl = combo.expect.url === null ? null : urls[combo.expect.url];
      for (const [entry, got] of seen) {
        assert.equal(got.backend, combo.expect.backend, `${entry}: backend`);
        if (got.source !== undefined) assert.equal(got.source, combo.expect.source, `${entry}: source`);
        if (got.url !== undefined) assert.equal(got.url, wantUrl, `${entry}: the place it reaches`);
      }
    });
  });
}

const S4_VARIANTS: Array<{ name: string; env: Record<string, string>; expect: "user_config" | "sqlite" | "json" | "refused" }> = [
  { name: "nothing else", env: {}, expect: "user_config" },
  { name: "postgres named", env: { AGENT_MEMORY_DB_TYPE: "postgres" }, expect: "user_config" },
  { name: "POSTGRES named in capitals", env: { AGENT_MEMORY_DB_TYPE: "POSTGRES" }, expect: "user_config" },
  { name: "an empty AGENT_MEMORY_DATABASE_URL", env: { AGENT_MEMORY_DATABASE_URL: "" }, expect: "user_config" },
  { name: "sqlite named (the one way to leave it)", env: { AGENT_MEMORY_DB_TYPE: "sqlite" }, expect: "sqlite" },
  { name: "json named (the other way)", env: { AGENT_MEMORY_DB_TYPE: "json" }, expect: "json" },
  { name: "an unknown AGENT_MEMORY_DB_TYPE", env: { AGENT_MEMORY_DB_TYPE: "mysql" }, expect: "refused" },
];
for (const variant of S4_VARIANTS) {
  test(`S4: a user config with database_url is never read as the local default SQLite (${variant.name})`, async () => {
    const url = pgUrl(await closedPort(), "s4cfg");
    await withSeatEnv({}, async (home) => {
      for (const [name, value] of Object.entries({ ...variant.env, AGENT_MEMORY_DB_PATH: join(home, "s4.db") })) process.env[name] = value;
      writeUserConfig(home, { database_url: url });
      const outcomes: Array<[string, Outcome]> = [
        ["session-start", viaSessionStart()],
        ["transcript-stop-capture", await viaTranscriptStop()],
        ["session-rotation-stop", await viaRotationStop()],
        ["reader", await viaReader(join(home, "no-json-folder"))],
      ];
      for (const [entry, outcome] of outcomes) {
        if (variant.expect === "refused") {
          assert.ok("refused" in outcome, `${entry}: expected a refusal, got ${j(outcome)}`);
          continue;
        }
        const got = resolved(entry, outcome);
        assert.ok(!(got.backend === "sqlite" && got.source === "local_default"), `${entry} chose the local default although the user config names a database`);
        if (variant.expect === "user_config") {
          assert.equal(got.backend, "postgres", entry);
          if (got.source !== undefined) assert.equal(got.source, "user_config", entry);
          if (got.url !== undefined) assert.equal(got.url, url, entry);
        } else {
          assert.equal(got.backend, variant.expect, entry);
        }
      }
    });
  });
}

// ---------- U7: the evidence of the two Stop hooks ----------
const PASS_OUTPUT = { continue: true, suppressOutput: true };

async function stopRun(host: RotationHost, extra: RotationStopDependencies = {}, heard: "ok" | "small" = "ok") {
  const s = seat();
  const base: RotationStopDependencies = {
    now: () => NOW,
    identity: PANE,
    rotation_root: s.rotationRoot,
    read_transcript: () => ({ status: "ok", lines: [usageLine(host, heard === "ok" ? BIG : 1_000)] }),
    ...extra,
  };
  const first = await runSessionRotationStop(s.input("Stop"), host, s.binding, {}, base);
  const second = await runSessionRotationStop(s.input("Stop", { stop_hook_active: true }), host, s.binding, {}, {
    ...base,
    read_transcript: () => ({ status: "ok", lines: [usageLine(host, heard === "ok" ? BIG : 1_000), textLine(host, HANDOFF)] }),
  });
  return { s, first, second };
}

const storeFields = (evidence: { store_backend: string | null; store_source: string | null }) => [evidence.store_backend, evidence.store_source];

test("U7 (session-rotation-stop): the evidence names the store only when a hand-off was saved, and never a place", async () => {
  await withSeatEnv({}, async (home) => {
    const dbPath = join(home, "u7.db");
    process.env.AGENT_MEMORY_DB_TYPE = "sqlite";
    process.env.AGENT_MEMORY_DB_PATH = dbPath;
    const { first, second } = await stopRun("codex");
    assert.equal(first.evidence.action, "blocked");
    assert.deepEqual(storeFields(first.evidence), [null, null], "a blocked turn opens no store");
    assert.equal(second.evidence.action, "saved", j(second.evidence));
    assert.deepEqual(storeFields(second.evidence), ["sqlite", "environment"]);
    const text = j(second.evidence);
    assert.ok(!text.includes(dbPath) && !text.includes(localStoreBindingSha256("sqlite", process.env)) && !text.includes("postgres://"), "no path, digest or URL in the evidence");
  });
});

test("U7 (session-rotation-stop): a turn that saves nothing carries no store; a refusal says so and still lets the turn go on", async () => {
  await withSeatEnv({}, async (home) => {
    const dbPath = join(home, "u7b.db");
    process.env.AGENT_MEMORY_DB_PATH = dbPath;
    const none = await stopRun("codex", {}, "small");
    assert.equal(none.second.evidence.action, "none");
    assert.deepEqual(storeFields(none.second.evidence), [null, null]);
    const s = seat();
    const busy = await runSessionRotationStop(s.input("UserPromptSubmit"), "codex", s.binding, {}, { now: () => NOW, identity: PANE, rotation_root: s.rotationRoot });
    assert.deepEqual(storeFields(busy.evidence), [null, null]);
    const malformed = await runSessionRotationStop("not json", "codex", s.binding, {}, {});
    assert.equal(malformed.evidence.reason, "malformed_input");
    assert.deepEqual(storeFields(malformed.evidence), [null, null]);
    process.env.AGENT_MEMORY_DB_TYPE = "mysql";
    const refused = await stopRun("codex");
    assert.equal(refused.second.evidence.reason, "store_refused:unknown_db_type");
    assert.equal(refused.second.evidence.action, "failed_open");
    assert.deepEqual(refused.second.output, PASS_OUTPUT, "the conversation goes on");
    assert.deepEqual(refused.second.output, none.second.output);
    assert.deepEqual(storeFields(refused.second.evidence), [null, null]);
    assert.equal(existsSync(dbPath), false, "a refusal opens no store");
  });
});

test("U7 (session-rotation-stop): a store that opened as another backend than the decided one fails the save and is closed", async () => {
  await withSeatEnv({}, async (home) => {
    process.env.AGENT_MEMORY_DB_TYPE = "sqlite";
    process.env.AGENT_MEMORY_DB_PATH = join(home, "u7c.db");
    let closed = 0;
    const wrong = { backend: "json", close: async () => { closed += 1; } } as unknown as Store;
    const { second } = await stopRun("claude_code", { createStore: async () => wrong });
    assert.equal(second.evidence.action, "failed_open");
    assert.equal(second.evidence.marker_id, null);
    assert.equal(closed, 1);
  });
});

test("U7 (transcript-stop-capture): the evidence names the store when it captured, and a refusal is not counted as a capture", async () => {
  await withSeatEnv({}, async (home) => {
    const dbPath = join(home, "u7d.db");
    process.env.AGENT_MEMORY_DB_TYPE = "sqlite";
    process.env.AGENT_MEMORY_DB_PATH = dbPath;
    const s = seat();
    const receive = async () => ({ status: "captured" as const, reason: "captured" as const, events_saved: 1, events_duplicate: 0 });
    const captured = await runTranscriptStopCapture(s.input("Stop"), "codex", s.binding, { receive });
    assert.equal(captured.evidence.status, "captured");
    assert.deepEqual(storeFields(captured.evidence), ["sqlite", "environment"]);
    assert.ok(!j(captured.evidence).includes(dbPath));
    const malformed = await runTranscriptStopCapture("not json", "codex", s.binding, { receive });
    assert.equal(malformed.evidence.reason, "malformed_input");
    assert.deepEqual(storeFields(malformed.evidence), [null, null]);
    process.env.AGENT_MEMORY_DB_TYPE = "mysql";
    process.env.AGENT_MEMORY_DB_PATH = join(home, "u7e.db");
    const refused = await runTranscriptStopCapture(s.input("Stop"), "codex", s.binding, { receive });
    assert.equal(refused.evidence.reason, "store_refused:unknown_db_type");
    assert.equal(refused.evidence.outcome, "unobserved", "a refused turn is not a capture");
    assert.deepEqual(refused.output, PASS_OUTPUT);
    assert.deepEqual(storeFields(refused.evidence), [null, null]);
    assert.equal(existsSync(join(home, "u7e.db")), false);
    process.env.AGENT_MEMORY_DB_TYPE = "sqlite";
    let closed = 0;
    const wrong = { backend: "postgres", close: async () => { closed += 1; } } as unknown as Store;
    const mismatch = await runTranscriptStopCapture(s.input("Stop"), "codex", s.binding, { receive, createStore: async () => wrong });
    assert.equal(mismatch.evidence.status, "failed_open");
    assert.equal(closed, 1);
  });
});

// ---------- U8: the hand-off commit consumes in the place the answer was read from ----------
const COMMIT_PLAN: RotationCommitPlan = {
  query: { agent_id: "kusabi", project: "agent-memory", pack_ref: "selected_restart_pack:none" },
  directory: "/nonexistent",
  turn: null,
  marker_id: "marker",
  via: "marker",
};
const commitDeps = { now: () => NOW, elapsed_ms: () => 0, hook_timeout_ms: 7_000 };

test("U8: the commit opens the store of the decision it is given, and consumes there", async () => {
  await withSeatEnv({}, async (home) => {
    const dbPath = join(home, "u8.db");
    process.env.AGENT_MEMORY_DB_PATH = dbPath;
    const resolution = requireStore({ AGENT_MEMORY_DB_TYPE: "sqlite" });
    const result = await commitRotationRecovery(COMMIT_PLAN, { ...commitDeps, store_resolution: resolution });
    assert.deepEqual(result, { record: "skipped", consume: "lost_race" }, "a store was opened and asked to consume (nothing to consume in it)");
    assert.equal(existsSync(dbPath), true);
  });
});

test("U8: with neither a decision nor a seam nothing is opened and the result is unknown", async () => {
  await withSeatEnv({}, async (home) => {
    const dbPath = join(home, "u8b.db");
    process.env.AGENT_MEMORY_DB_PATH = dbPath;
    process.env.AGENT_MEMORY_DB_TYPE = "sqlite";
    const result = await commitRotationRecovery(COMMIT_PLAN, commitDeps);
    assert.deepEqual(result, { record: "skipped", consume: "unknown" });
    assert.equal(existsSync(dbPath), false, "no store was opened from the environment");
  });
});

test("U8: a decision that names PostgreSQL never falls back to SQLite, and a store of another backend is not consumed from", async () => {
  await withSeatEnv({}, async (home) => {
    const dbPath = join(home, "u8c.db");
    process.env.AGENT_MEMORY_DB_PATH = dbPath;
    const unreachable = requireStore({ DATABASE_URL: pgUrl(await closedPort(), "u8") });
    const failed = await commitRotationRecovery(COMMIT_PLAN, { ...commitDeps, store_resolution: unreachable });
    assert.deepEqual(failed, { record: "skipped", consume: "unknown" });
    assert.equal(existsSync(dbPath), false, "no SQLite file was made in its place");

    let consumed = 0;
    let closed = 0;
    const wrong = { backend: "json", consumeSelectedRestartPack: async () => { consumed += 1; return null; }, close: async () => { closed += 1; } } as unknown as Store;
    const sqliteResolution = requireStore({ AGENT_MEMORY_DB_TYPE: "sqlite" });
    const mismatch = await commitRotationRecovery(COMMIT_PLAN, { ...commitDeps, store_resolution: sqliteResolution, open_store: async () => wrong });
    assert.equal(mismatch.consume, "unknown");
    assert.equal(consumed, 0);
    assert.equal(closed, 1);
  });
});

test("U8: answerHookAndCommit hands the decision on, so the commit follows the answer's store", async () => {
  await withSeatEnv({}, async (home) => {
    const dbPath = join(home, "u8d.db");
    process.env.AGENT_MEMORY_DB_PATH = dbPath;
    const lines: string[] = [];
    const io = { write_evidence: (line: string, done: () => void) => { lines.push(line); done(); }, write_output: (line: string, done: () => void) => { lines.push(line); done(); }, clock: () => 0, now: () => NOW };
    const answered = await answerHookAndCommit(io, { evidence: {}, output: {}, rotation_commit: COMMIT_PLAN, store_resolution: requireStore({ AGENT_MEMORY_DB_TYPE: "sqlite" }) }, 0, 7_000);
    assert.equal(answered.commit?.consume, "lost_race");
    const without = await answerHookAndCommit(io, { evidence: {}, output: {}, rotation_commit: COMMIT_PLAN }, 0, 7_000);
    assert.equal(without.commit?.consume, "unknown");
  });
});

// ---------- U9: restart-cli ----------
test("U9: a refused setting makes fetch and prepare fail with the kind of error only, and handoff-source say it cannot read", async () => {
  const home = freshHome("store-res-u9");
  try {
    const directory = seatDirectory(join(home, ".agent-memory", "rotation"), AGENT, PROJECT);
    mkdirSync(directory, { recursive: true });
    writeMarker(directory, marker());
    const secretUrl = `mysql://u:${"SECRETPW"}@127.0.0.1/db`;
    for (const vars of [{ AGENT_MEMORY_DB_TYPE: "mysql" }, { DATABASE_URL: secretUrl }] as Array<Record<string, string>>) {
      const env = commandEnv(home, { ...vars, AGENT_MEMORY_DB_PATH: join(home, "never.db") });
      for (const args of [["fetch", "--pack-ref", "none"], ["prepare"]]) {
        const ran = runRestartCli(env, [args[0], "--agent-id", AGENT, "--project", PROJECT, ...args.slice(1)]);
        assert.equal(ran.status, 1, ran.stderr);
        assert.equal(ran.stdout, "", `${args[0]} printed on standard output`);
        assert.match(ran.stderr, /store_refused:(unknown_db_type|env_url_shape)/);
        assert.ok(!ran.stderr.includes("SECRETPW"), "no value in the message");
      }
      const reading = runRestartCli(env, ["handoff-source", "--agent-id", AGENT, "--project", PROJECT]);
      assert.equal(reading.status, 1);
      assert.equal(JSON.parse(reading.stdout).result, "unreadable", "the reader that cannot decide is reported as it reports any store it cannot read");
      assert.match(reading.stderr, /store_refused:(unknown_db_type|env_url_shape)/, "the kind of error is said on standard error, as fetch and prepare say it");
      assert.ok(!reading.stdout.includes("SECRETPW") && !reading.stderr.includes("SECRETPW"));
    }
    assert.equal(existsSync(join(home, "never.db")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("U9: a reader asked without a decision, for a setting it cannot decide, refuses instead of reading SQLite", async () => {
  await withSeatEnv({}, async (home) => {
    await assert.rejects(
      () => readTaskStatesReadOnly({ AGENT_MEMORY_DB_TYPE: "mysql", AGENT_MEMORY_DB_PATH: join(home, "r.db") }, { agent_id: "kusabi", project: "agent-memory" }),
      (error: unknown) => error instanceof StoreRefusedError && error.reason === "unknown_db_type",
    );
  });
});

// ---------- U5 (antigravity) and the seam check: the places the other tests do not reach ----------
test("U5 (antigravity): the loader decides once, opens only the decided place, and carries the decision as its binding", async () => {
  await withSeatEnv({ AGENT_MEMORY_DB_TYPE: "json" }, async (home) => {
    const workspace = join(home, "workspace");
    mkdirSync(workspace);
    const transcript = join(home, "transcript.jsonl");
    writeFileSync(transcript, "{}\n");
    const binding: AntigravitySessionStartBinding = {
      agent_id: AGENT, project: PROJECT, workspace, binding_source_ref: "fixture:antigravity",
      max_tokens: 1_800, max_bytes: 8_192, timeout_ms: 500,
    };
    const hookInput: AntigravityHookInput = {
      conversationId: "123e4567-e89b-42d3-a456-426614174000", workspacePaths: [workspace], transcriptPath: transcript,
      artifactDirectoryPath: join(workspace, "artifacts"), invocationNum: 1, initialNumSteps: 0,
    };
    const loaded = await loadAntigravityHookDataFromStore(binding, hookInput, "post-invocation");
    assert.equal(loaded.store_binding?.source, "environment");
    assert.equal(loaded.store_binding?.backend_intent, "json");
    assert.equal(loaded.recovery_quality_log_ref, null, "a post-invocation turn builds no pack");
    process.env.AGENT_MEMORY_DB_TYPE = "mysql";
    await assert.rejects(
      () => loadAntigravityHookDataFromStore(binding, hookInput, "post-invocation"),
      (error: unknown) => (error as Error).name === "HookDegradedError" && (error as { reason?: string }).reason === "RECOVERY_UNAVAILABLE",
    );
  });
});

test("seam: a store that opened as another backend is refused, and a close that fails does not hide the refusal", async () => {
  const resolution = requireStore({ AGENT_MEMORY_DB_TYPE: "sqlite" });
  let closed = 0;
  const wrong = { backend: "json", close: async () => { closed += 1; throw new Error("close failed"); } } as unknown as Store;
  await assert.rejects(
    () => requireStoreBackend(wrong, resolution),
    (error: unknown) => (error as Error).message.includes("does not match the decision") && !(error as Error).message.includes("close failed"),
  );
  assert.equal(closed, 1, "the wrong store was closed");
  const right = { backend: "sqlite", close: async () => { throw new Error("must not be closed"); } } as unknown as Store;
  assert.equal(await requireStoreBackend(right, resolution), right);
  const double = { close: async () => { throw new Error("must not be closed"); } } as unknown as Store;
  assert.equal(await requireStoreBackend(double, resolution), double, "a test double that reports no backend is not checked");
});

test("U5 (gemini): the loader decides once, opens only the decided place, and refuses what it cannot decide", async () => {
  await withSeatEnv({ AGENT_MEMORY_DB_TYPE: "json" }, async (home) => {
    const workspace = join(home, "workspace");
    mkdirSync(workspace);
    const binding: CodexSessionStartBinding = {
      agent_id: AGENT, project: PROJECT, workspace, binding_source_ref: "fixture:gemini", max_tokens: 1_800, max_bytes: 8_192, timeout_ms: 500,
    };
    const hookInput: GeminiSessionStartInput = {
      session_id: "gemini-session-1", transcript_path: join(home, "transcript.jsonl"), cwd: workspace,
      hook_event_name: "SessionStart", timestamp: NOW.toISOString(), source: "startup",
    };
    const loaded = await loadGeminiRecoveryFromStore(binding, hookInput);
    assert.equal(loaded.store_binding?.source, "environment");
    assert.equal(loaded.store_binding?.backend_intent, "json");
    process.env.AGENT_MEMORY_DB_TYPE = "mysql";
    await assert.rejects(
      () => loadGeminiRecoveryFromStore(binding, hookInput),
      (error: unknown) => (error as Error).name === "HookDegradedError" && (error as { reason?: string }).reason === "RECOVERY_UNAVAILABLE",
    );
  });
});

test("U10 (in process): the emitter opens the store the caller gives, and a different place is told apart from an unreachable one", async () => {
  await withSeatEnv({}, async (home) => {
    const env = { AGENT_MEMORY_DB_TYPE: "sqlite", AGENT_MEMORY_DB_PATH: join(home, "u10-inprocess.db") };
    const bound = kusabiStoreBindingSha256("sqlite", join(home, "u10-inprocess.db"));
    const emit = async (expected: string) => {
      const lines: string[] = [];
      const result = await emitKusabiSessionStartRuntimeEvent(sessionStartEvidence("sqlite", bound), {
        target: runtimeTarget("sqlite", bound),
        env: { ...process.env, ...env },
        writeEmergency: (line) => lines.push(line),
        timeoutMs: 4_000,
        createStore: (signal) => createQuietStore(env, expected, signal),
      });
      return result;
    };
    const same = await emit(bound);
    assert.equal(same.status, "durable", j(same.emergency));
    assert.equal(existsSync(join(home, "u10-inprocess.db")), true, "the bound SQLite file is the one that was opened");
    rmSync(join(home, "u10-inprocess.db"));
    const other = await emit(kusabiStoreBindingSha256("sqlite", join(home, "another.db")));
    assert.equal(other.emergency?.normalized_error_code, "binding_drift");
    assert.equal(existsSync(join(home, "u10-inprocess.db")), false, "a different place opens nothing");
    assert.equal(existsSync(join(home, "another.db")), false);
  });
});

// ---------- U10 and S6 (direct): the emitter worker's store ----------
const never = () => new AbortController().signal;

async function withConfigReadCount<T>(configPath: string, run: () => Promise<T>): Promise<{ value?: T; error?: unknown; reads: number }> {
  const fsApi = fs as unknown as { lstatSync: (...args: unknown[]) => unknown };
  const original = fsApi.lstatSync;
  let reads = 0;
  fsApi.lstatSync = (...args: unknown[]) => {
    if (args[0] === configPath) reads += 1;
    return original(...args);
  };
  syncBuiltinESMExports();
  try {
    return { value: await run(), reads };
  } catch (error) {
    return { error, reads };
  } finally {
    fsApi.lstatSync = original;
    syncBuiltinESMExports();
  }
}

const driftName = (error: unknown) => (error as Error | undefined)?.constructor?.name;

test("U10: the worker refuses what it cannot decide, and leaves JSON to the fixtures", async () => {
  await withSeatEnv({}, async (home) => {
    const bound = kusabiStoreBindingSha256("sqlite", join(home, "u10.db"));
    const refused = await createQuietStore({ AGENT_MEMORY_DB_TYPE: "mysql" }, bound, never()).catch((error: Error) => error);
    assert.equal((refused as Error).message, "KUSABI_RUNTIME_EVENT_STORE_UNAVAILABLE");
    const json = await createQuietStore({ AGENT_MEMORY_DB_TYPE: "json" }, bound, never()).catch((error: Error) => error);
    assert.equal((json as Error).message, "KUSABI_RUNTIME_EVENT_JSON_FIXTURE_ONLY");
    const viaWorker = await emitThroughWorker("sqlite", bound, { AGENT_MEMORY_DB_TYPE: "mysql", AGENT_MEMORY_DB_PATH: join(home, "u10.db") });
    assert.equal(viaWorker.result.emergency?.normalized_error_code, "store_unavailable");
    assert.equal(existsSync(join(home, "u10.db")), false);
  });
});

test("S6 (direct): createQuietStore decides once, builds no store for another place, and opens the bound one", async () => {
  const [a, b] = [await listener(), await listener()];
  try {
    await withSeatEnv({}, async (home) => {
      const configPath = join(home, ".agent-memory", "config.json");
      writeUserConfig(home, { database_url: pgUrl(b.port) });
      const boundToA = kusabiStoreBindingSha256("postgres", pgUrl(a.port));
      const drift = await withConfigReadCount(configPath, () => createQuietStore({}, boundToA, never()));
      assert.equal(driftName(drift.error), "StoreBindingDriftError");
      assert.equal(b.connections(), 0, "no connection to the place the evidence did not bind");
      assert.equal(drift.reads, 1, "the user config is read once for one decision");

      const pathA = join(home, "a.db");
      const pathB = join(home, "b.db");
      const sqliteDrift = await createQuietStore({ AGENT_MEMORY_DB_TYPE: "sqlite", AGENT_MEMORY_DB_PATH: pathB }, kusabiStoreBindingSha256("sqlite", pathA), never()).catch((error: unknown) => error);
      assert.equal(driftName(sqliteDrift), "StoreBindingDriftError");
      assert.equal(existsSync(pathB), false, "no SQLite file for the place the evidence did not bind");

      const same = await withConfigReadCount(configPath, () => createQuietStore({}, kusabiStoreBindingSha256("postgres", pgUrl(b.port)), never()));
      assert.notEqual(driftName(same.error), "StoreBindingDriftError", "the bound place is the one it tried");
      assert.ok(b.connections() >= 1, "the bound server was reached for");
      assert.equal(same.reads, 1);
    });
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});

let passed = 0;
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
removeSeats();
if (process.exitCode === 1) {
  console.error(`store-resolution-scenario: ${cases.length - passed} of ${cases.length} checks failed`);
} else {
  console.log(`store-resolution-scenario: ${passed} checks passed`);
}
