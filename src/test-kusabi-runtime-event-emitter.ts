import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import {
  buildKusabiSessionStartRuntimeEvent,
  emitKusabiSessionStartRuntimeEvent,
  parseKusabiRuntimeEventTarget,
  type KusabiRuntimeEventTargetBinding,
  type KusabiSessionStartEvidence,
} from "./kusabi-runtime-event-emitter.js";
import { validateKusabiRuntimeEvent } from "./kusabi-runtime-event-store.js";
import { SqliteStore } from "./stores/sqlite-store.js";
import { PgStore } from "./stores/pg-store.js";
import type { KusabiRuntimeEventDocument, Store } from "./stores/types.js";

const h = (value: string): string => createHash("sha256").update(value).digest("hex");
const { Pool } = pg;

function target(backend: "sqlite" | "postgres" = "sqlite"): KusabiRuntimeEventTargetBinding {
  return {
    schema_version: "kusabi-runtime-event-target/v1",
    manifest_id: "kusabi-obs03-test-v1",
    build: {
      commit_sha: "b".repeat(40),
      tree_sha: "c".repeat(40),
      artifact_sha256: "d".repeat(64),
    },
    configuration: {
      config_sha256: "e".repeat(64),
      trust_fingerprint_sha256: "f".repeat(64),
    },
    storage: {
      backend,
      binding_sha256: "1".repeat(64),
    },
  };
}

function evidence(
  runtime: KusabiSessionStartEvidence["identity"]["runtime"],
  backend: "sqlite" | "postgres" = "sqlite",
  outcome: "full" | "degraded" = "full",
): KusabiSessionStartEvidence {
  const adapter = runtime === "codex"
    ? "wasurezu-codex-session-start"
    : runtime === "claude-code"
      ? "wasurezu-claude-session-start"
      : "wasurezu-gemini-session-start";
  return {
    adapter: { id: adapter, version: "1.0.1" },
    identity: {
      agent_id: "kusabi",
      project: "agent-memory",
      workspace_sha256: "a".repeat(64),
      binding_source_ref: "binding:kusabi:test-secret-ref",
      runtime,
    },
    store_binding: { backend_intent: backend, verified: true },
    hook: { session_id: `session-${runtime}` },
    timing: { completed_at: "2026-07-30T00:00:00.000Z", elapsed_ms: 21 },
    output: { token_estimate: 180, redaction_count: 2 },
    recovery_pack: {
      pack_ref: `restart_pack:kusabi:agent-memory:${runtime}`,
      policy_version: "kusabi-observability-v1",
    },
    outcome,
    degraded_reason: outcome === "degraded" ? "RECOVERY_TIMEOUT" : null,
    recovery_quality_log_ref: "recovery_quality_log:123e4567-e89b-42d3-a456-426614174000",
  };
}

function fakeStore(
  backend: "sqlite" | "postgres",
  save: (event: KusabiRuntimeEventDocument, eventSha256: string) => Promise<void>,
): Store {
  return {
    backend,
    initialize: async () => undefined,
    close: async () => undefined,
    saveKusabiRuntimeEvent: async ({ event, event_sha256 }) => {
      await save(event, event_sha256);
      return {
        inserted: true,
        record: { ...event, event_sha256, ingested_at: "2026-07-30T00:00:01.000Z" },
      };
    },
  } as unknown as Store;
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "kusabi-obs03-emitter-"));
  try {
    const disabled = await emitKusabiSessionStartRuntimeEvent(evidence("codex"), { env: {} });
    assert.equal(disabled.status, "disabled");
    assert.equal(disabled.event_id, null);

    assert.deepEqual(parseKusabiRuntimeEventTarget(JSON.stringify(target())), target());
    assert.throws(
      () => parseKusabiRuntimeEventTarget({ ...target(), unknown: true } as unknown as KusabiRuntimeEventTargetBinding),
      /KUSABI_RUNTIME_EVENT_TARGET_INVALID/,
    );
    assert.throws(
      () => parseKusabiRuntimeEventTarget(JSON.stringify({ ...target(), storage: { backend: "json", binding_sha256: "1".repeat(64) } })),
      /KUSABI_RUNTIME_EVENT_TARGET_INVALID/,
    );
    const invalidTargetLines: string[] = [];
    const invalidTarget = await emitKusabiSessionStartRuntimeEvent(evidence("codex"), {
      target: JSON.stringify({ ...target(), unknown: "must-not-be-echoed" }),
      writeEmergency: (line) => invalidTargetLines.push(line),
    });
    assert.equal(invalidTarget.status, "emergency_only");
    assert.equal(invalidTarget.emergency?.normalized_error_code, "target_invalid");
    assert.equal(invalidTargetLines.length, 1);
    assert(!invalidTargetLines[0].includes("must-not-be-echoed"));

    const runtimes = ["codex", "claude-code", "gemini-cli"] as const;
    const normalized = runtimes.map((runtime) => buildKusabiSessionStartRuntimeEvent(evidence(runtime), target()));
    assert.deepEqual(normalized.map((event) => event.producer.host_runtime), ["codex", "claude_code", "gemini_cli"]);
    for (const event of normalized) {
      assert(validateKusabiRuntimeEvent(event).valid, JSON.stringify(validateKusabiRuntimeEvent(event).errors));
      assert.equal(
        event.target_key,
        h([event.producer.agent_id, event.producer.project, event.producer.host_runtime, event.producer.workspace_sha256].join("\n")),
      );
      const serialized = JSON.stringify(event);
      assert(!serialized.includes("test-secret-ref"));
      assert(!serialized.includes("restart_pack"));
      assert(!serialized.includes("recovery_quality_log"));
    }
    assert.equal(
      buildKusabiSessionStartRuntimeEvent(evidence("codex"), target()).event_id,
      normalized[0].event_id,
      "same manifest/target/session is idempotent",
    );
    assert.equal(new Set(normalized.map((event) => event.event_id)).size, 3);

    const degraded = buildKusabiSessionStartRuntimeEvent(evidence("claude-code", "sqlite", "degraded"), target());
    assert.equal(degraded.outcome.reason_code, "timeout");
    assert.equal(degraded.outcome.normalized_error_code, "session_start.timeout");
    assert(validateKusabiRuntimeEvent(degraded).valid, JSON.stringify(validateKusabiRuntimeEvent(degraded).errors));

    const sqlitePath = join(root, "runtime-events.db");
    const createSqlite = async (): Promise<Store> => {
      const store = new SqliteStore(sqlitePath);
      await store.initialize();
      return store;
    };
    const firstSqlite = await emitKusabiSessionStartRuntimeEvent(evidence("codex"), {
      target: target(),
      createStore: createSqlite,
    });
    const duplicateSqlite = await emitKusabiSessionStartRuntimeEvent(evidence("codex"), {
      target: target(),
      createStore: createSqlite,
    });
    assert.equal(firstSqlite.status, "durable");
    assert.equal(duplicateSqlite.status, "durable");
    const sqlite = await createSqlite();
    const sqliteRecords = await sqlite.getKusabiRuntimeEvents({ manifest_id: target().manifest_id, limit: 10 });
    await sqlite.close();
    assert.equal(sqliteRecords.length, 1);
    assert.equal(sqliteRecords[0].event_id, firstSqlite.event_id);

    const postgresEvents: KusabiRuntimeEventDocument[] = [];
    const postgresResult = await emitKusabiSessionStartRuntimeEvent(evidence("gemini-cli", "postgres"), {
      target: target("postgres"),
      createStore: async () => fakeStore("postgres", async (event) => { postgresEvents.push(event); }),
    });
    assert.equal(postgresResult.status, "durable");
    assert.equal(postgresEvents.length, 1);
    assert.equal(postgresEvents[0].storage.backend, "postgres");
    assert(validateKusabiRuntimeEvent(postgresEvents[0]).valid);

    const postgresUrl = process.env.KUSABI_OBS03_POSTGRES_URL;
    if (postgresUrl) {
      const schema = `obs03_emitter_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const admin = new Pool({ connectionString: postgresUrl });
      try {
        await admin.query(`CREATE SCHEMA ${schema}`);
        const scopedUrl = withPgSearchPath(postgresUrl, schema);
        const createPostgres = async (): Promise<Store> => {
          const store = new PgStore(scopedUrl);
          await store.initialize();
          return store;
        };
        const actualPostgres = await emitKusabiSessionStartRuntimeEvent(evidence("gemini-cli", "postgres"), {
          target: target("postgres"),
          createStore: createPostgres,
        });
        assert.equal(actualPostgres.status, "durable");
        const postgresStore = await createPostgres();
        const records = await postgresStore.getKusabiRuntimeEvents({
          manifest_id: target("postgres").manifest_id,
          event_type: "session_start",
          limit: 10,
        });
        await postgresStore.close();
        assert.equal(records.length, 1);
        assert.equal(records[0].event_id, actualPostgres.event_id);
        assert.equal((records[0].event as { storage: { backend: string } }).storage.backend, "postgres");
      } finally {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        const remaining = await admin.query(
          "SELECT count(*)::int AS count FROM pg_namespace WHERE nspname = $1",
          [schema],
        );
        assert.equal(remaining.rows[0].count, 0);
        await admin.end();
      }
    }

    let driftStoreCreated = false;
    const driftLines: string[] = [];
    const driftEvidence = evidence("codex");
    driftEvidence.store_binding.backend_intent = "postgres";
    const drift = await emitKusabiSessionStartRuntimeEvent(driftEvidence, {
      target: target(),
      createStore: async () => {
        driftStoreCreated = true;
        return fakeStore("sqlite", async () => undefined);
      },
      writeEmergency: (line) => driftLines.push(line),
    });
    assert.equal(drift.status, "emergency_only");
    assert.equal(drift.emergency?.normalized_error_code, "backend_drift");
    assert.equal(driftStoreCreated, false);
    assert.equal(driftLines.length, 1);

    const unavailableLines: string[] = [];
    const unavailable = await emitKusabiSessionStartRuntimeEvent(evidence("codex"), {
      target: target(),
      createStore: async () => {
        throw new Error("postgresql://user:secret@private.invalid/db /Users/private/runtime.db raw prompt");
      },
      writeEmergency: (line) => unavailableLines.push(line),
    });
    assert.equal(unavailable.status, "emergency_only");
    assert.equal(unavailable.emergency?.normalized_error_code, "store_unavailable");
    assert.equal(unavailableLines.length, 1);
    assert(!/postgres|secret|private|Users|prompt/i.test(unavailableLines[0]));
    assert(Buffer.byteLength(unavailableLines[0], "utf8") <= 1024);

    const writeFailureLines: string[] = [];
    const writeFailure = await emitKusabiSessionStartRuntimeEvent(evidence("codex"), {
      target: target(),
      createStore: async () => fakeStore("sqlite", async () => {
        throw new Error("sk-secret /Users/private raw recovery content");
      }),
      writeEmergency: (line) => writeFailureLines.push(line),
    });
    assert.equal(writeFailure.status, "emergency_only");
    assert.equal(writeFailure.emergency?.normalized_error_code, "store_write_failed");
    assert(!/secret|Users|recovery content/i.test(writeFailureLines[0]));

    const dualFailure = await emitKusabiSessionStartRuntimeEvent(evidence("codex"), {
      target: target(),
      createStore: async () => { throw new Error("sink unavailable"); },
      writeEmergency: () => { throw new Error("stderr unavailable"); },
    });
    assert.equal(dualFailure.status, "failed");

    const timeoutLines: string[] = [];
    let lateSaveCount = 0;
    let lateStoreCloseCount = 0;
    const timeoutStartedAt = Date.now();
    const timedOut = await emitKusabiSessionStartRuntimeEvent(evidence("codex"), {
      target: target(),
      createStore: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const store = fakeStore("sqlite", async () => {
          lateSaveCount++;
        });
        store.close = async () => {
          lateStoreCloseCount++;
        };
        return store;
      },
      writeEmergency: (line) => timeoutLines.push(line),
      timeoutMs: 5,
    });
    const timeoutReturnedMs = Date.now() - timeoutStartedAt;
    assert.equal(timedOut.status, "emergency_only");
    assert.equal(timedOut.emergency?.normalized_error_code, "store_unavailable");
    assert.equal(timeoutLines.length, 1);
    assert(timeoutReturnedMs < 100, `timeout returned after ${timeoutReturnedMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(lateSaveCount, 0, "timed-out store must never receive a durable save");
    assert.equal(lateStoreCloseCount, 1, "a store produced after timeout must be closed");

    const workerTimeoutLines: string[] = [];
    const workerTimeoutStartedAt = Date.now();
    const workerTimedOut = await emitKusabiSessionStartRuntimeEvent(evidence("codex", "postgres"), {
      target: target("postgres"),
      env: {
        ...process.env,
        AGENT_MEMORY_DB_TYPE: "postgres",
        AGENT_MEMORY_DATABASE_URL: "postgres://127.0.0.1:9/kusabi-timeout-probe",
      },
      writeEmergency: (line) => workerTimeoutLines.push(line),
      timeoutMs: 5,
    });
    const workerTimeoutMs = Date.now() - workerTimeoutStartedAt;
    assert.equal(workerTimedOut.status, "emergency_only");
    assert.equal(workerTimeoutLines.length, 1);
    assert(workerTimeoutMs < 250, `timeout worker retained resources for ${workerTimeoutMs} ms`);

    const malformedEvidence = evidence("codex");
    malformedEvidence.timing.completed_at = "not-a-date";
    const malformed = await emitKusabiSessionStartRuntimeEvent(malformedEvidence, { target: target() });
    assert.equal(malformed.status, "failed");

    const workspace = join(root, "workspace");
    const child = join(workspace, "child");
    await mkdir(child, { recursive: true });
    const cliDbPath = join(root, "three-host-cli.db");
    const cliTarget = JSON.stringify(target());
    const commonArgs = [
      "--agent-id", "kusabi",
      "--project", "agent-memory",
      "--workspace", workspace,
      "--binding-source-ref", "fixture:obs03-cli-binding",
    ];
    const cliCases = [
      {
        source: "src/codex-session-start.ts",
        adapterId: "wasurezu-codex-session-start",
        input: JSON.stringify({
          session_id: "obs03-codex-session",
          transcript_path: null,
          cwd: child,
          hook_event_name: "SessionStart",
          model: "gpt-5.6-codex",
          permission_mode: "default",
          source: "startup",
        }),
      },
      {
        source: "src/claude-session-start.ts",
        adapterId: "wasurezu-claude-session-start",
        input: JSON.stringify({
          session_id: "obs03-claude-session",
          transcript_path: join(root, "obs03-claude-session.jsonl"),
          cwd: child,
          hook_event_name: "SessionStart",
          model: "claude-opus-5",
          source: "startup",
        }),
      },
      {
        source: "src/gemini-session-start.ts",
        adapterId: "wasurezu-gemini-session-start",
        input: JSON.stringify({
          session_id: "obs03-gemini-session",
          transcript_path: join(root, "obs03-gemini-session.json"),
          cwd: child,
          hook_event_name: "SessionStart",
          timestamp: "2026-07-30T00:00:00.000Z",
          source: "startup",
        }),
      },
    ];
    for (const cliCase of cliCases) {
      const cli = spawnSync(process.execPath, [
        "--import", "tsx",
        cliCase.source,
        "--adapter-id", cliCase.adapterId,
        ...commonArgs,
      ], {
        input: cliCase.input,
        encoding: "utf8",
        timeout: 8_000,
        env: {
          ...process.env,
          AGENT_MEMORY_DB_TYPE: "sqlite",
          AGENT_MEMORY_DB_PATH: cliDbPath,
          KUSABI_RUNTIME_EVENT_TARGET_JSON: cliTarget,
        },
      });
      assert.equal(cli.status, 0, `${cliCase.source}: ${cli.stderr}`);
      assert.equal(cli.stdout.trim().split("\n").length, 1, cliCase.source);
      assert.equal(JSON.parse(cli.stdout).continue, true, cliCase.source);
      const evidenceLines = cli.stderr.trim().split("\n").filter((line) => line.startsWith("{"));
      assert.equal(evidenceLines.length, 1, `${cliCase.source}: ${cli.stderr}`);
      assert.equal(JSON.parse(evidenceLines[0]).identity.verified, true, cliCase.source);
    }
    const cliStore = new SqliteStore(cliDbPath);
    await cliStore.initialize();
    const cliRecords = await cliStore.getKusabiRuntimeEvents({
      manifest_id: target().manifest_id,
      event_type: "session_start",
      limit: 10,
    });
    await cliStore.close();
    assert.equal(cliRecords.length, 3);
    const cliEvents = cliRecords.map((record) => record.event as KusabiRuntimeEventDocument & {
      producer: {
        agent_id: string;
        project: string;
        host_runtime: string;
        workspace_sha256: string;
      };
    });
    assert.deepEqual(
      new Set(cliEvents.map((event) => event.producer.host_runtime)),
      new Set(["codex", "claude_code", "gemini_cli"]),
    );
    assert(cliEvents.every((event) => event.producer.agent_id === "kusabi"));
    assert(cliEvents.every((event) => event.target_key === h([
      event.producer.agent_id,
      event.producer.project,
      event.producer.host_runtime,
      event.producer.workspace_sha256,
    ].join("\n"))));

    console.log("Kusabi OBS-03 runtime-event emitter tests passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function withPgSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const option = `-c search_path=${schema},public`;
  const existing = url.searchParams.get("options");
  url.searchParams.set("options", existing ? `${existing} ${option}` : option);
  return url.toString();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
