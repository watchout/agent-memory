/**
 * The success scenario of the common-infrastructure form, store layer (u1-seat-memory-skeleton, PR-1; written before
 * the code it tests): a seat writes one decision in the Codex shape, the process ends, and a new process in the Claude
 * Code shape reads the same decision back through the call both session-start entries use (`recoverDecisions`). The
 * negative checks: a seat the database does not know, a database that cannot be reached (nothing is written near the
 * seat), `DATABASE_URL` alone (no place is chosen and no connection is made), and no decision text or password in any
 * statement text, failure or process output.
 *
 * The database is a fake window that keeps its rows in a file, so the second process sees what the first wrote. The
 * real SQL is tried by test-common-seat-pg.ts (by hand). The host layer (session-start entries) is PR-2.
 * The first import sets a throwaway home before any store module is loaded.
 */
import { CALLER_ENV, ISOLATED_HOME } from "./test-isolated-home.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { v7 as uuidv7 } from "uuid";
import { commonForm, resolveCommonPlacement } from "./common-placement.js";
import { createCommonSeatStore } from "./common-seat-store.js";
import { readUserConfig } from "./store-resolution.js";
import {
  DECISION_TEXT,
  FakeDb,
  SECRET_PASSWORD,
  SEAT_A,
  SEAT_UNREGISTERED,
  SYNTHETIC_URL,
  networkError,
  scratchFolder,
  settingFor,
  snapshotTree,
  writeConfig,
} from "./test-common-seat-support.js";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const COMMON_ENV = { AGENT_MEMORY_MODE: "common", AGENT_MEMORY_DATABASE_URL: SYNTHETIC_URL } as const;

/** A store the way a seat builds it: placement from the environment and the config file, a window, a clock. */
function seatStore(env: NodeJS.ProcessEnv, configPath: string, client: FakeDb) {
  assert.equal(commonForm(env), "common");
  const placement = resolveCommonPlacement(env, () => readUserConfig(configPath));
  if (!placement.ok) return { placement, store: null };
  return { placement, store: createCommonSeatStore({ client, seat: placement.seat, now: () => Date.now() }) };
}

/** The part a child process runs: one operation, one line of result, nothing else on stdout or stderr. */
async function child(role: string, op: string, stateFile: string, configPath: string): Promise<void> {
  // The bootstrap import removed the store variables from the process; the ones the parent gave are in CALLER_ENV.
  const env = { ...process.env, AGENT_MEMORY_DATABASE_URL: CALLER_ENV.AGENT_MEMORY_DATABASE_URL };
  const { store } = seatStore(env, configPath, new FakeDb({ stateFile }));
  assert.ok(store, "the child's placement must resolve");
  if (op === "write") {
    const result = await store.logDecision({
      decisionId: uuidv7(),
      decision: DECISION_TEXT,
      context: `written by the ${role} shape`,
      project: "agent-memory",
      tags: [{ id: uuidv7(), text: "scenario" }],
    });
    console.log(`RESULT ${JSON.stringify({ role, ok: result.ok, name: result.ok ? null : result.name })}`);
    return;
  }
  const result = await store.recoverDecisions({ limit: 3 });
  const first = result.ok ? result.decisions[0] : undefined;
  console.log(
    `RESULT ${JSON.stringify({
      role,
      ok: result.ok,
      name: result.ok ? null : result.name,
      count: result.ok ? result.decisions.length : 0,
      total: result.ok ? result.total_active_count : 0,
      textSha256: first ? sha256(first.decision_text) : null,
      status: first?.status ?? null,
      seat: result.ok ? result.verified.seat_ref : null,
    })}`,
  );
}

const here = fileURLToPath(import.meta.url);
if (process.argv[2] === "--child") {
  const [, , , role, op, stateFile, configPath] = process.argv;
  await child(role, op, stateFile, configPath);
  process.exit(0);
}

function runChild(role: string, op: string, stateFile: string, configPath: string, agentId: string) {
  const run = spawnSync(process.execPath, ["--import", "tsx", here, "--child", role, op, stateFile, configPath], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...COMMON_ENV, AGENT_MEMORY_AGENT_ID: agentId, HOME: ISOLATED_HOME },
  });
  const lines = run.stdout.split("\n").filter(Boolean);
  const result = lines.find((line) => line.startsWith("RESULT "));
  return { run, lines, result: result ? (JSON.parse(result.slice(7)) as Record<string, unknown>) : undefined };
}

const cases: Array<[string, () => Promise<void> | void]> = [];

cases.push(["scenario: a decision written in the Codex shape is read back in a new process in the Claude Code shape", () => {
  const scratch = scratchFolder();
  try {
    const stateFile = `${scratch.dir}/rows.json`;
    const configPath = writeConfig(scratch.dir, settingFor(SEAT_A));
    const written = runChild("codex", "write", stateFile, configPath, "agent-id-of-the-codex-seat");
    assert.equal(written.run.status, 0, written.run.stderr);
    assert.deepEqual(written.result, { role: "codex", ok: true, name: null });
    const read = runChild("claude", "read", stateFile, configPath, "a-different-agent-id-in-the-claude-shape");
    assert.equal(read.run.status, 0, read.run.stderr);
    assert.deepEqual(read.result, {
      role: "claude",
      ok: true,
      name: null,
      count: 1,
      total: 1,
      textSha256: sha256(DECISION_TEXT),
      status: "active",
      seat: SEAT_A.seat_id,
    });
  } finally {
    scratch.remove();
  }
}]);

cases.push(["negative: a seat the database does not know is refused by name, writes nothing and reads nothing", async () => {
  const scratch = scratchFolder();
  try {
    const db = new FakeDb({ seats: [SEAT_A] });
    const { store } = seatStore(COMMON_ENV, writeConfig(scratch.dir, settingFor(SEAT_UNREGISTERED)), db);
    assert.ok(store);
    const wrote = await store.logDecision({ decisionId: uuidv7(), decision: DECISION_TEXT, tags: [] });
    assert.ok(!wrote.ok);
    assert.equal(wrote.name, "seat_not_registered");
    const read = await store.getDecisions({ limit: 10 });
    assert.ok(!read.ok);
    assert.equal(read.name, "seat_not_registered");
    const recovered = await store.recoverDecisions({ limit: 3 });
    assert.ok(!recovered.ok);
    assert.equal(recovered.name, "seat_not_registered");
    assert.deepEqual(db.decisions(), []);
  } finally {
    scratch.remove();
  }
}]);

cases.push(["negative: a database that cannot be reached is a failure by name, and nothing is written near the seat", async () => {
  const scratch = scratchFolder();
  try {
    const before = snapshotTree(ISOLATED_HOME);
    const db = new FakeDb();
    db.faults.connect = networkError("ECONNREFUSED");
    const { store } = seatStore(COMMON_ENV, writeConfig(scratch.dir, settingFor(SEAT_A)), db);
    assert.ok(store);
    const wrote = await store.logDecision({ decisionId: uuidv7(), decision: DECISION_TEXT, tags: [] });
    assert.ok(!wrote.ok);
    assert.equal(wrote.name, "placement_unreachable");
    assert.deepEqual(snapshotTree(ISOLATED_HOME), before);
    assert.deepEqual(snapshotTree(scratch.dir), [`${scratch.dir}/config.json:${JSON.stringify(settingFor(SEAT_A)).length}`]);
    db.faults.connect = undefined;
    const again = await store.logDecision({ decisionId: uuidv7(), decision: DECISION_TEXT, tags: [] });
    assert.ok(again.ok, "the next call connects again without a restart");
  } finally {
    scratch.remove();
  }
}]);

cases.push(["negative: DATABASE_URL alone chooses no place, makes no connection and creates no table", async () => {
  const scratch = scratchFolder();
  try {
    const db = new FakeDb();
    const env = { AGENT_MEMORY_MODE: "common", DATABASE_URL: SYNTHETIC_URL };
    const { placement, store } = seatStore(env, writeConfig(scratch.dir, settingFor(SEAT_A)), db);
    assert.equal(store, null);
    assert.ok(!placement.ok);
    assert.equal(placement.name, "placement_unset");
    assert.equal(db.connects, 0);
    assert.deepEqual(db.statements, []);
  } finally {
    scratch.remove();
  }
}]);

cases.push(["negative: no statement text, failure or process output holds the decision text or the password", async () => {
  const scratch = scratchFolder();
  try {
    const stateFile = `${scratch.dir}/rows.json`;
    const configPath = writeConfig(scratch.dir, settingFor(SEAT_A));
    const db = new FakeDb();
    const { store } = seatStore(COMMON_ENV, configPath, db);
    assert.ok(store);
    const outcomes: unknown[] = [];
    outcomes.push(await store.logDecision({ decisionId: uuidv7(), decision: DECISION_TEXT, tags: [{ id: uuidv7(), text: "t" }] }));
    db.faults.select = new Error(`driver text with ${SECRET_PASSWORD} and ${DECISION_TEXT}`);
    outcomes.push(await store.logDecision({ decisionId: uuidv7(), decision: DECISION_TEXT, tags: [] }));
    db.faults.commit = { error: networkError(), applied: false };
    outcomes.push(await store.logDecision({ decisionId: uuidv7(), decision: DECISION_TEXT, tags: [] }));
    outcomes.push(await store.getDecisions({ limit: 10 }));
    const hidden = [DECISION_TEXT, SECRET_PASSWORD];
    for (const statement of db.statements) {
      for (const secret of hidden) assert.ok(!statement.text.includes(secret), "the SQL text carries values only as parameters");
    }
    for (const outcome of outcomes.filter((o) => !(o as { ok: boolean }).ok)) {
      for (const secret of hidden) assert.ok(!JSON.stringify(outcome).includes(secret), "a failure names its kind, never a value");
    }
    const written = runChild("codex", "write", stateFile, configPath, "any");
    for (const secret of hidden) {
      assert.ok(!written.run.stdout.includes(secret) && !written.run.stderr.includes(secret), "the process prints no value");
    }
    assert.equal(written.run.stderr, "");
    assert.equal(written.lines.length, 1);
  } finally {
    scratch.remove();
  }
}]);

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
if (process.exitCode === 1) {
  console.error(`common-seat-scenario: ${cases.length - passed} of ${cases.length} checks failed`);
} else {
  console.log(`common-seat-scenario: ${passed} checks passed`);
}
