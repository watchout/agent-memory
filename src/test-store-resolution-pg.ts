/**
 * Store resolution against a throwaway PostgreSQL (261113-store-resolution-fix): S5 (the emitter worker opens the
 * PostgreSQL a seat's user config names), S2 (what the Stop hook stores is what the next conversation reads) and
 * U12 (the tables and columns the Stop save path uses exist after the migrations; no DDL is added).
 * Local only: it needs DATABASE_URL and fails, rather than skipping, when it is missing.
 * Run: DATABASE_URL=postgres://... npx tsx src/test-store-resolution-pg.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { kusabiStoreBindingSha256 } from "./codex-session-start.js";
import { rotationHandoffTaskId, readMarker, seatDirectory } from "./session-rotation-files.js";
import { createReadOnlyTaskStateReader, readTaskStatesReadOnly } from "./stores/read-only-task-states.js";
import { readHandoffSource } from "./rotation-handoff-source.js";
import { runSessionRotationStop, type RotationStopDependencies } from "./session-rotation-stop.js";
import { requireStore } from "./store-resolution.js";
import { openResolvedStore } from "./stores/index.js";
import { PgStore } from "./stores/pg-store.js";
import { checkStatements, traceStatements } from "./test-store-resolution-sql.js";
import { AGENT, PROJECT, commandEnv, freshHome, runRestartCli } from "./test-handoff-source-support.js";
import {
  BIG,
  HANDOFF,
  PANE,
  emitThroughWorker,
  j,
  removeSeats,
  seat,
  textLine,
  usageLine,
  withSeatEnv,
  writeUserConfig,
} from "./test-store-resolution-support.js";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("store-resolution-pg: DATABASE_URL is not set; this suite does not skip (it fails)");
  process.exit(1);
}

const SCHEMA = `store_resolution_${Date.now()}_${Math.floor(Math.random() * 100_000)}`;

function withPgSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const option = `-c search_path=${schema},public`;
  const existing = url.searchParams.get("options");
  url.searchParams.set("options", existing ? `${existing} ${option}` : option);
  return url.toString();
}

const SCHEMA_URL = withPgSearchPath(DATABASE_URL, SCHEMA);
const cases: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

test("S5: a seat whose only database_url is in the user config gets its runtime event written to that PostgreSQL by the worker", async () => {
  await withSeatEnv({}, async (home) => {
    writeUserConfig(home, { database_url: SCHEMA_URL });
    assert.equal(process.env.AGENT_MEMORY_DATABASE_URL, undefined, "nothing in this process wrote the URL into the environment");
    const bound = kusabiStoreBindingSha256("postgres", SCHEMA_URL);
    const { result } = await emitThroughWorker("postgres", bound, {});
    assert.equal(result.status, "durable", `the worker did not reach the PostgreSQL the user config names: ${j(result.emergency)}`);
    const admin = new Pool({ connectionString: SCHEMA_URL });
    try {
      const rows = await admin.query("SELECT count(*)::int AS n FROM kusabi_runtime_events");
      assert.equal(rows.rows[0].n, 1, "the event is stored in the configured PostgreSQL");
    } finally {
      await admin.end();
    }
  });
});

/** The seat's two Stop turns: the first is blocked at the threshold, the second (the hook already active) saves the hand-off. */
async function stopTurns(host: "codex" | "claude_code") {
  const s = seat();
  const base: RotationStopDependencies = {
    // restart-cli fetch is a real process that checks the pack's expiry against the real clock, so the Stop that saves the pack must use it too
    now: () => new Date(),
    identity: PANE,
    rotation_root: s.rotationRoot,
    read_transcript: () => ({ status: "ok", lines: [usageLine(host, BIG)] }),
  };
  const blocked = await runSessionRotationStop(s.input("Stop"), host, s.binding, {}, base);
  const saved = await runSessionRotationStop(s.input("Stop", { stop_hook_active: true }), host, s.binding, {}, {
    ...base,
    read_transcript: () => ({ status: "ok", lines: [usageLine(host, BIG), textLine(host, HANDOFF)] }),
  });
  return { s, blocked, saved };
}

for (const host of ["codex", "claude_code"] as const) {
  test(`S2 (${host}): what the Stop hook saves into the PostgreSQL only the user config names is what the next conversation reads`, async () => {
    await withSeatEnv({}, async (home) => {
      writeUserConfig(home, { database_url: SCHEMA_URL });
      process.env.AGENT_MEMORY_DB_PATH = join(home, "never.db");
      const { s, blocked, saved } = await stopTurns(host);
      assert.equal(blocked.evidence.action, "blocked");
      assert.equal(saved.evidence.action, "saved", j(saved.evidence));
      assert.equal(saved.evidence.store_backend, "postgres");
      assert.equal(saved.evidence.store_source, "user_config");
      assert.equal(existsSync(join(home, "never.db")), false, "no SQLite file was made");

      const admin = new Pool({ connectionString: SCHEMA_URL });
      try {
        const rows = await admin.query("SELECT progress FROM task_states WHERE agent_id = $1 AND task_id = $2", [AGENT, rotationHandoffTaskId(PROJECT)]);
        assert.equal(rows.rowCount, 1, "the hand-off task state is in the configured PostgreSQL");
        assert.equal(rows.rows[0].progress, HANDOFF);
      } finally {
        await admin.end();
      }

      const read = await readTaskStatesReadOnly(process.env, { agent_id: AGENT, project: PROJECT, status: "all", limit: 5 });
      assert.equal(read.find((row) => row.task_id === rotationHandoffTaskId(PROJECT))?.progress, HANDOFF, "the read-only reader reads the same row");

      const source = await readHandoffSource(createReadOnlyTaskStateReader(process.env), { agent_id: AGENT, project: PROJECT, rotation_root: s.rotationRoot });
      assert.equal(source.result, "found", j(source));
      if (source.result === "found") assert.equal(source.text, HANDOFF);

      const marker = readMarker(seatDirectory(s.rotationRoot, AGENT, PROJECT));
      assert.ok(marker, "the marker was written next to the stored hand-off");
      const home2 = freshHome("store-res-pg-cli");
      try {
        mkdirSync(join(home2, ".agent-memory"), { recursive: true });
        writeUserConfig(home2, { database_url: SCHEMA_URL });
        const fetched = runRestartCli(commandEnv(home2, { AGENT_MEMORY_DB_PATH: join(home2, "never.db") }), [
          "fetch", "--agent-id", AGENT, "--project", PROJECT, "--pack-ref", marker.pack_ref,
        ]);
        assert.equal(fetched.status, 0, fetched.stderr);
        const pack = JSON.parse(fetched.stdout) as { pack_ref: string; content: string };
        assert.equal(pack.pack_ref, marker.pack_ref, "restart-cli fetch finds the pack the Stop hook saved");
        assert.equal(pack.content, HANDOFF);
        assert.equal(existsSync(join(home2, "never.db")), false);
      } finally {
        rmSync(home2, { recursive: true, force: true });
      }
    });
  });
}

test("S2: a store opened from the decision is the PostgreSQL the user config names", async () => {
  await withSeatEnv({}, async (home) => {
    writeUserConfig(home, { database_url: SCHEMA_URL });
    const store = await openResolvedStore(requireStore(process.env), { skipPostgresMigrations: true });
    try {
      assert.equal(store.backend, "postgres");
    } finally {
      await store.close();
    }
  });
});

const DDL = /\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|EXTENSION|TYPE|SCHEMA|VIEW|COLUMN|CONSTRAINT|SEQUENCE|FUNCTION|TRIGGER)\b/i;

function git(args: string[]): string {
  const ran = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (ran.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${ran.stderr}`);
  return ran.stdout;
}

/** What each of the six Store methods the hooks and the restart command reach is called with, so every statement form runs. */
async function callTheSixMethods(store: PgStore): Promise<void> {
  const at = "2026-11-16T03:00:00.000Z";
  await store.saveTaskState({ agent_id: AGENT, project: PROJECT, task_id: "u12-task", task: "u12", status: "in_progress", progress: "p", next_steps: "n" });
  await store.saveTaskState({ agent_id: AGENT, project: PROJECT, task_id: "u12-task", task: "u12", status: "completed" });
  const pack = await store.saveSelectedRestartPack({ agent_id: AGENT, project: PROJECT, content: "u12 pack" });
  assert.ok(await store.consumeSelectedRestartPack({ agent_id: AGENT, project: PROJECT, pack_ref: pack.pack_ref }), "the pack is consumed once");
  assert.equal(await store.consumeSelectedRestartPack({ agent_id: AGENT, project: PROJECT, pack_ref: pack.pack_ref }), null, "and not twice");
  await store.saveRawEvent({ agent_id: AGENT, project: PROJECT, source: "u12", event_type: "host_event", content: "with content", occurred_at: at });
  await store.saveRawEvent({ agent_id: AGENT, project: PROJECT, source: "u12", event_type: "host_event", content: "with content", occurred_at: at });
  await store.saveRawEvent({ agent_id: AGENT, project: PROJECT, source: "u12", event_type: "host_event", source_event_id: "u12-e", occurred_at: at });
  await store.saveRawEvent({ agent_id: AGENT, project: PROJECT, source: "u12", event_type: "host_event", source_event_id: "u12-e", occurred_at: at });
  await store.saveRawEvent({ agent_id: AGENT, project: PROJECT, source: "u12", event_type: "host_event", occurred_at: at });
  await store.saveRawEvent({ agent_id: AGENT, project: PROJECT, source: "u12", event_type: "host_event", occurred_at: at });
  await store.saveConversationEvent({ agent_id: AGENT, project: PROJECT, source: "manual", source_event_id: "u12-c", content: "hello", occurred_at: at });
  await store.saveConversationEvent({ agent_id: AGENT, project: PROJECT, source: "manual", source_event_id: "u12-c", content: "hello", occurred_at: at });
  await store.saveConversationEvent({ agent_id: AGENT, project: PROJECT, source: "manual", content: "no id", occurred_at: at });
  await store.saveConversationEvent({ agent_id: AGENT, project: PROJECT, source: "manual", content: "no id", occurred_at: at });
  const everyFilter = { agent_id: AGENT, session_id: "s", project: PROJECT, source: "u12", event_type: "host_event" as const, since: at, limit: 5 };
  await store.getRawEvents(everyFilter);
  await store.getRawEvents({ agent_id: AGENT });
}

test("U12: the SQL the Stop save path and the restart command really send uses only tables and columns that exist after the migrations, and no DDL line is added", async () => {
  const saved = process.env.AGENT_MEMORY_DISABLE_EMBEDDINGS;
  process.env.AGENT_MEMORY_DISABLE_EMBEDDINGS = "1";
  const store = new PgStore(SCHEMA_URL);
  const statements: string[] = [];
  try {
    statements.push(...(await traceStatements(() => callTheSixMethods(store))));
  } finally {
    await store.close();
    if (saved === undefined) delete process.env.AGENT_MEMORY_DISABLE_EMBEDDINGS;
    else process.env.AGENT_MEMORY_DISABLE_EMBEDDINGS = saved;
  }
  assert.ok(statements.length >= 20, `the six methods sent ${statements.length} statements`);

  const admin = new Pool({ connectionString: SCHEMA_URL });
  const schema = new Map<string, Set<string>>();
  try {
    const found = await admin.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1", [SCHEMA]);
    for (const row of found.rows as Array<{ table_name: string; column_name: string }>) {
      schema.set(row.table_name, (schema.get(row.table_name) ?? new Set<string>()).add(row.column_name));
    }
  } finally {
    await admin.end();
  }
  const checked = checkStatements(statements, schema);
  assert.deepEqual(checked.problems, [], "a statement uses a table or column the migrated schema does not have, or cannot be read");
  const tables = [...checked.used.keys()].sort();
  for (const table of ["conversation_events", "raw_events", "selected_restart_packs", "task_states"]) assert.ok(tables.includes(table), `${table} is used by the traced statements`);
  for (const table of tables) console.log(`U12 verified ${table}: ${[...(checked.used.get(table) ?? [])].sort().join(", ")}`);

  const negatives = checkStatements(
    ["SELECT * FROM task_states WHERE no_such_column = $1", "VACUUM task_states", "SELECT * FROM no_such_table WHERE agent_id = $1"],
    schema,
  );
  assert.deepEqual(
    negatives.problems.map((problem) => problem.problem),
    ["task_states.no_such_column is not in the migrated schema", "unparsable statement", "table no_such_table is not in the migrated schema"],
    "a missing column, a statement that cannot be read and a missing table are each reported",
  );

  const base = process.env.STORE_RESOLUTION_BASE ?? "origin/main";
  assert.equal(git(["diff", "--name-only", base, "--", "src/stores/pg-migrations.ts"]).trim(), "", "the migrations file is unchanged");
  const added: string[] = [];
  for (const line of git(["diff", "-U0", base, "--", "src", ":(exclude)src/test*"]).split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++") && DDL.test(line)) added.push(line);
  }
  for (const file of git(["ls-files", "--others", "--exclude-standard", "--", "src"]).split("\n").filter((name) => name !== "" && !name.startsWith("src/test"))) {
    for (const line of readFileSync(file, "utf8").split("\n")) if (DDL.test(line)) added.push(`${file}: ${line}`);
  }
  assert.deepEqual(added, [], "a statement that changes the shape of a table was added");
});

const setup = async (): Promise<void> => {
  const admin = new Pool({ connectionString: DATABASE_URL });
  try {
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  } finally {
    await admin.end();
  }
  const store = new PgStore(SCHEMA_URL);
  try {
    await store.initialize();
  } finally {
    await store.close();
  }
};

const teardown = async (): Promise<void> => {
  const admin = new Pool({ connectionString: DATABASE_URL });
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  } finally {
    await admin.end();
  }
};

await setup();
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
  await teardown();
  removeSeats();
}
if (process.exitCode === 1) console.error(`store-resolution-pg: ${cases.length - passed} of ${cases.length} checks failed`);
else console.log(`store-resolution-pg: ${passed} checks passed`);
