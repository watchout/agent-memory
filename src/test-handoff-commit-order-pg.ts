#!/usr/bin/env node
/**
 * T9 of handoff-commit-order-design.md (261110-session-rotation, FR11.5): against a real PostgreSQL, an old-order
 * hook (consume first) and the new-order commit (record first, consume after) that reach for one bundle at once
 * use it up exactly once, because the update is conditional on `status = 'active'`.
 *
 * Requires DATABASE_URL (a throwaway database). Uses a unique schema that is dropped after the run. Without
 * DATABASE_URL it says so and exits 0, as test-pg.ts does; the evidence of a run is the output of this file.
 * Run with a temporary HOME: the rotation files are written under it.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { commitRotationRecovery } from "./rotation-commit.js";
import { prepareRotationRecovery } from "./session-rotation-start.js";
import { buildMarker, readOutputWritten, seatDirectory, sha256Hex, writeMarker } from "./session-rotation-files.js";
import { PgStore } from "./stores/pg-store.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.log("SKIP test-handoff-commit-order-pg: DATABASE_URL is not set (point it at a throwaway database)");
  process.exit(0);
}

const SCHEMA = `commit_order_${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
const withSearchPath = (connectionString: string): string => {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${SCHEMA},public`);
  return url.toString();
};
const STORE_URL = withSearchPath(DATABASE_URL);

const NOW = new Date();
const PANE = { pane_id: "%7", tmux_socket: "/tmp/sock", host_pid: 4242, host_started_at: "Tue Nov 3 10:00:00 2026" };
const HANDOFF = "## 次の 1 歩\nPG の試験を書く";
const AGENT = `commit-order-${Date.now()}`;
const PROJECT = "agent-memory";

const admin = new pg.Pool({ connectionString: DATABASE_URL });
const seed = new PgStore(STORE_URL);
const opened: PgStore[] = [];
const openStore = async (): Promise<PgStore> => {
  const store = new PgStore(STORE_URL);
  opened.push(store);
  return store;
};

async function scenario(options: { expiresAt?: string } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "commit-order-pg-")));
  const directory = seatDirectory(join(root, "rotation"), AGENT, PROJECT);
  mkdirSync(directory, { recursive: true });
  const pack = await seed.saveSelectedRestartPack({
    agent_id: AGENT, project: PROJECT, content: HANDOFF, source: "restart_prepare", ...(options.expiresAt ? { expires_at: options.expiresAt } : {}),
  });
  const marker = buildMarker({
    agent_id: AGENT, project: PROJECT, host: "claude_code", session_id: "old", ...PANE, pack_ref: pack.pack_ref,
    pack_content_sha256: sha256Hex(HANDOFF), measured_tokens: 310_000, threshold_tokens: 300_000,
    saved_at: new Date(NOW.getTime() - 120_000).toISOString(), handoff_source: "seat_text",
  });
  writeMarker(directory, marker);
  mkdirSync(join(directory, "claims"), { recursive: true });
  writeFileSync(join(directory, "claims", `${marker.marker_id}.json`),
    JSON.stringify({ state: "respawning", marker_id: marker.marker_id, respawn_started_at: new Date(NOW.getTime() - 5_000).toISOString() }));
  const block = await prepareRotationRecovery(
    seed, { agent_id: AGENT, project: PROJECT, host: "claude_code", session_id: "new", source: "startup" },
    { now: () => NOW, env: {}, identity: PANE, rotation_root: join(root, "rotation") },
  );
  assert.ok(block, "the start reads the bundle from PostgreSQL");
  return { root, directory, marker, pack, plan: block.commit };
}

const deps = () => ({ now: () => NOW, elapsed_ms: () => 100, hook_timeout_ms: 9_000, open_store: openStore });
const recordCount = (directory: string): number => {
  try {
    return readdirSync(join(directory, "output-written")).length;
  } catch {
    return 0;
  }
};
const statusOf = async (packRef: string): Promise<string | undefined> =>
  (await admin.query(`SELECT status FROM ${SCHEMA}.selected_restart_packs WHERE pack_ref = $1`, [packRef])).rows[0]?.status;

const cases: Array<[string, () => Promise<void>]> = [];

cases.push(["T9(a): the new commit uses the bundle up once, after the record", async () => {
  const sc = await scenario();
  assert.equal(await statusOf(sc.pack.pack_ref), "active", "reading changed nothing");
  assert.deepEqual(await commitRotationRecovery(sc.plan, deps()), { record: "written", consume: "consumed" });
  assert.equal(await statusOf(sc.pack.pack_ref), "consumed");
  assert.equal(readOutputWritten(sc.directory, sc.marker.marker_id)?.session_id, "new");
  assert.deepEqual(await commitRotationRecovery(sc.plan, deps()), { record: "exists", consume: "lost_race" }, "a second commit changes nothing");
}]);

cases.push(["T9(b): eight commits at once - one consumes, the rest lose the race, one record", async () => {
  const sc = await scenario();
  const results = await Promise.all(Array.from({ length: 8 }, () => commitRotationRecovery(sc.plan, deps())));
  assert.equal(results.filter((r) => r.consume === "consumed").length, 1);
  assert.equal(results.filter((r) => r.consume === "lost_race").length, 7);
  assert.equal(results.filter((r) => r.record === "written").length, 1);
  assert.equal(results.filter((r) => r.record === "exists").length, 7);
  assert.equal(recordCount(sc.directory), 1);
  assert.equal(await statusOf(sc.pack.pack_ref), "consumed");
}]);

cases.push(["T9(c): an old-order hook (consume first) and the new commit at once - the bundle is used once either way", async () => {
  for (let round = 0; round < 5; round += 1) {
    const sc = await scenario();
    const old = await openStore();
    const [oldRow, committed] = await Promise.all([
      old.consumeSelectedRestartPack({ agent_id: AGENT, project: PROJECT, pack_ref: sc.pack.pack_ref, consumed_at: NOW.toISOString() }),
      commitRotationRecovery(sc.plan, deps()),
    ]);
    assert.equal((oldRow !== null ? 1 : 0) + (committed.consume === "consumed" ? 1 : 0), 1, `round ${round}: exactly one effect`);
    assert.equal(await statusOf(sc.pack.pack_ref), "consumed");
    assert.equal(recordCount(sc.directory), 1, "the new commit's record is there whichever consumed");
  }
}]);

cases.push(["T9(d): a bundle that has expired is not used up and the commit says lost_race", async () => {
  const sc = await scenario({ expiresAt: new Date(Date.now() + 1_500).toISOString() });
  await new Promise((resolve) => setTimeout(resolve, 1_800));
  assert.deepEqual(await commitRotationRecovery(sc.plan, deps()), { record: "written", consume: "lost_race" });
  assert.equal(await statusOf(sc.pack.pack_ref), "active", "an expired row is not turned into 'consumed'");
}]);

let failed = 0;
try {
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await seed.initialize();
  for (const [name, run] of cases) {
    try {
      await run();
      console.log(`ok - ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`not ok - ${name}\n${error instanceof Error ? error.stack : String(error)}`);
    }
  }
} finally {
  await Promise.all(opened.map((store) => store.close().catch(() => undefined)));
  await seed.close().catch(() => undefined);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
  await admin.end().catch(() => undefined);
}
if (failed > 0) {
  console.error(`FAIL test-handoff-commit-order-pg (${failed}/${cases.length})`);
  process.exit(1);
}
console.log(`PASS test-handoff-commit-order-pg (${cases.length} cases)`);
