/**
 * The seat's store against a fake window (u1-seat-memory-skeleton, PR-1; BR1.4-BR1.6, BR2.1-BR2.7, BR3.1, BR3.3, S7,
 * S8): the statements of one call and their order, what each failure is called, the lost-answer note of a write and
 * that nothing is resent, every limit, a response that is not the expected shape, the shape of the inputs, and the
 * driver adapter with a fake driver class. The real SQL is tried by test-common-seat-pg.ts (by hand).
 * The first import sets a throwaway home before any store module is loaded.
 */
import "./test-isolated-home.js";
import assert from "node:assert/strict";
import { v7 as uuidv7 } from "uuid";
import { COMMON_LIMITS, SeatSetting } from "./common-placement.js";
import { RESPONSE_LOST_NOTE } from "./common-seat-errors.js";
import { createCommonSeatStore, createPgSqlClient, type PgClientCtor, type SqlClient, type SqlConnection } from "./common-seat-store.js";
import { StoreTarget } from "./store-resolution.js";
import { DECISION_TEXT, FakeDb, SECRET_PASSWORD, SEAT_A, SYNTHETIC_URL, dbError, networkError } from "./test-common-seat-support.js";

const NOW = 1_800_000_000_000;
const SHORT = { ...COMMON_LIMITS, connectMs: 40, readMs: 40, toolMs: 40, closeMs: 40 };
const seat = new SeatSetting(SEAT_A);
const storeOver = (client: SqlClient, limits = COMMON_LIMITS) => createCommonSeatStore({ client, seat, now: () => NOW, limits });
const save = (store: ReturnType<typeof storeOver>, text = DECISION_TEXT) => store.logDecision({ decisionId: uuidv7(), decision: text, tags: [] });
const texts = (db: FakeDb): string[] => db.statements.map((s) => s.text);
const calls = (db: FakeDb): string[] => texts(db).filter((t) => t.startsWith("SELECT kusabi."));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A window whose connection answers every statement the way `answer` says, and counts what it was sent. */
function scripted(answer: (text: string) => unknown | Promise<unknown>): { client: SqlClient; sent: string[]; ended: () => number } {
  const sent: string[] = [];
  let ended = 0;
  const connection: SqlConnection = {
    async query(text) {
      sent.push(text);
      return (await answer(text)) as { rows: unknown[] };
    },
    async end() {
      ended += 1;
    },
  };
  return { client: { connect: async () => connection }, sent, ended: () => ended };
}
const rowsFor = (result: unknown) => (text: string) => (text.startsWith("SELECT kusabi.") ? { rows: [{ result }] } : { rows: [] });

const cases: Array<[string, () => Promise<void>]> = [];

cases.push(["one write is BEGIN, a time limit, one function call, COMMIT, in that order, then the connection ends", async () => {
  const db = new FakeDb();
  const result = await storeOver(db).logDecision({ decisionId: uuidv7(), decision: DECISION_TEXT, context: "why", project: "p", tags: [{ id: uuidv7(), text: "b" }, { id: uuidv7(), text: "a" }] });
  assert.ok(result.ok);
  assert.equal(result.createdAtMs > NOW, true);
  assert.deepEqual(texts(db).map((t) => t.split("(")[0]), ["BEGIN", `SET LOCAL statement_timeout = ${COMMON_LIMITS.toolMs}`, "SELECT kusabi.log_decision", "COMMIT"]);
  assert.equal(db.ended, 1);
  const call = db.statements[2];
  assert.equal(call.values.length, 9);
  const context = JSON.parse(String(call.values[0]));
  assert.equal(context.deadline_ms, NOW + COMMON_LIMITS.toolMs);
  assert.equal(JSON.parse(String(call.values[2])).observed_at_ms, NOW);
  assert.deepEqual(call.values.slice(4, 7), [DECISION_TEXT, "why", "p"]);
  assert.deepEqual(call.values[8], ["b", "a"]);
}]);

cases.push(["reads use the read limit and the same order of statements; get filters and recover counts", async () => {
  const db = new FakeDb();
  const store = storeOver(db);
  await store.logDecision({ decisionId: uuidv7(), decision: "one", project: "alpha", tags: [{ id: uuidv7(), text: "t1" }] });
  await store.logDecision({ decisionId: uuidv7(), decision: "two", project: "beta", tags: [{ id: uuidv7(), text: "t2" }] });
  db.statements.length = 0;
  const all = await store.getDecisions({ limit: 10 });
  assert.ok(all.ok);
  assert.deepEqual(all.decisions.map((d) => d.decision_text), ["two", "one"]);
  assert.deepEqual(texts(db).map((t) => t.split("(")[0]), ["BEGIN", `SET LOCAL statement_timeout = ${COMMON_LIMITS.readMs}`, "SELECT kusabi.get_decisions", "COMMIT"]);
  const byProject = await store.getDecisions({ project: "alpha", limit: 10 });
  assert.ok(byProject.ok && byProject.decisions.length === 1 && byProject.decisions[0].decision_text === "one");
  const byTag = await store.getDecisions({ tags: ["t2"], limit: 10 });
  assert.ok(byTag.ok && byTag.decisions.length === 1 && byTag.decisions[0].decision_text === "two");
  const recovered = await store.recoverDecisions({ limit: 1 });
  assert.ok(recovered.ok);
  assert.equal(recovered.decisions.length, 1);
  assert.equal(recovered.total_active_count, 2);
  assert.equal(recovered.verified.seat_ref, SEAT_A.seat_id);
  assert.equal(recovered.verified.binding_generation, SEAT_A.binding_generation);
}]);

cases.push(["a refusal rolls back, never commits, and is named by the table (BR2.2-BR2.5, D-8)", async () => {
  const pairs: Array<[string, string, string]> = [
    ["OC004", "onza-common:not_found", "seat_not_registered"],
    ["OC003", "onza-common:forbidden", "no_membership"],
    ["OC008", "onza-common:stale", "binding_closed"],
    ["OC005", "onza-common:not_initialized", "not_initialized"],
    ["28000", "kusabi:seat_not_registered", "seat_not_registered"],
    ["28000", "kusabi:binding_closed", "binding_closed"],
    ["22023", "kusabi:invalid_input", "invalid_input"],
    ["23514", "check violated", "invalid_input"],
    ["3F000", "no schema", "not_initialized"],
  ];
  for (const [state, message, name] of pairs) {
    const db = new FakeDb();
    db.faults.select = dbError(state, message);
    const result = await save(storeOver(db));
    assert.ok(!result.ok);
    assert.equal(result.name, name, state);
    assert.equal(result.cause, "refused");
    assert.ok(!texts(db).includes("COMMIT") && texts(db).includes("ROLLBACK"));
    assert.equal(result.note, undefined, "a refusal is a known no-write");
    assert.equal(db.decisions().length, 0);
  }
}]);

cases.push(["a SQLSTATE with no row is a failure without a name (S8), and writes nothing", async () => {
  const db = new FakeDb();
  db.faults.select = dbError("42501", "permission denied for table decision");
  const result = await save(storeOver(db));
  assert.ok(!result.ok);
  assert.equal(result.name, null);
  assert.equal(result.cause, "unmapped");
  assert.equal(result.code, "42501");
  assert.equal(db.decisions().length, 0);
}]);

cases.push(["a lost answer to a write is 'sent, unknown whether written'; it is not resent and no new id is made (S7)", async () => {
  for (const applied of [true, false]) {
    const db = new FakeDb();
    db.faults.commit = { error: networkError("ECONNRESET"), applied };
    const result = await save(storeOver(db));
    assert.ok(!result.ok);
    assert.equal(result.name, "placement_unreachable");
    assert.equal(result.cause, "response_lost");
    assert.equal(result.note, RESPONSE_LOST_NOTE);
    assert.equal(calls(db).length, 1, "the function was called once, never again");
    assert.equal(db.decisions().length, applied ? 1 : 0);
  }
  const closed = new FakeDb();
  closed.faults.select = dbError("57P01", "terminating connection");
  const dropped = await save(storeOver(closed));
  assert.ok(!dropped.ok);
  assert.equal(dropped.cause, "response_lost");
  assert.equal(dropped.note, RESPONSE_LOST_NOTE);
  const plain = new FakeDb();
  plain.faults.select = networkError("EPIPE");
  const piped = await save(storeOver(plain));
  assert.ok(!piped.ok && piped.cause === "response_lost" && piped.note === RESPONSE_LOST_NOTE);
}]);

cases.push(["a read that loses its answer is a failure without the write note", async () => {
  const db = new FakeDb();
  db.faults.select = networkError("ECONNRESET");
  const result = await storeOver(db).recoverDecisions({ limit: 3 });
  assert.ok(!result.ok);
  assert.equal(result.name, "placement_unreachable");
  assert.equal(result.cause, "response_lost");
  assert.equal(result.note, undefined);
}]);

cases.push(["a call that never answers stops at its limit: a write is 'unknown', a read is timed_out, and the connection is let go", async () => {
  const wrote = new FakeDb();
  wrote.faults.hangSelect = true;
  const lostWrite = await save(storeOver(wrote, SHORT));
  assert.ok(!lostWrite.ok);
  assert.equal(lostWrite.cause, "response_lost");
  assert.equal(lostWrite.note, RESPONSE_LOST_NOTE);
  assert.ok(texts(wrote).includes("ROLLBACK") && !texts(wrote).includes("COMMIT"));
  assert.equal(wrote.ended, 1);
  const read = new FakeDb();
  read.faults.hangSelect = true;
  const timed = await storeOver(read, SHORT).getDecisions({ limit: 5 });
  assert.ok(!timed.ok);
  assert.equal(timed.name, "placement_unreachable");
  assert.equal(timed.cause, "timed_out");
  assert.equal(timed.note, undefined);
}]);

cases.push(["a connection that does not come up stops at the connect limit and is closed if it arrives late", async () => {
  let late: SqlConnection | undefined;
  let ended = 0;
  const slow: SqlClient = {
    connect: () =>
      new Promise((resolve) =>
        setTimeout(() => {
          late = { query: async () => ({ rows: [] }), end: async () => void (ended += 1) };
          resolve(late);
        }, 120),
      ),
  };
  const result = await save(storeOver(slow, SHORT));
  assert.ok(!result.ok);
  assert.equal(result.name, "placement_unreachable");
  assert.equal(result.cause, "connect_timed_out");
  await sleep(200);
  assert.ok(late);
  assert.equal(ended, 1);
}]);

cases.push(["a connect that fails after its limit is let go quietly, and the call already said connect_timed_out", async () => {
  const slowFail: SqlClient = { connect: () => new Promise((_, reject) => setTimeout(() => reject(networkError("ECONNREFUSED")), 120)) };
  const result = await save(storeOver(slowFail, SHORT));
  assert.ok(!result.ok);
  assert.equal(result.cause, "connect_timed_out");
  await sleep(200);
}]);

cases.push(["an answer that arrives after the limit is never committed: the write is 'unknown', the rollback is sent, no COMMIT follows", async () => {
  const id = uuidv7();
  const window = scripted(async (text) => {
    if (!text.startsWith("SELECT kusabi.")) return { rows: [] };
    await sleep(120);
    return { rows: [{ result: { decision_id: id, created_at_ms: NOW } }] };
  });
  const result = await storeOver(window.client, SHORT).logDecision({ decisionId: id, decision: "late", tags: [] });
  assert.ok(!result.ok);
  assert.equal(result.cause, "response_lost");
  assert.equal(result.note, RESPONSE_LOST_NOTE);
  await sleep(250);
  assert.ok(window.sent.includes("ROLLBACK"));
  assert.ok(!window.sent.includes("COMMIT"), "a late answer must not commit");
  assert.equal(window.ended(), 1);
}]);

cases.push(["a rollback or a close that fails or hangs neither hides the failure nor hangs the call", async () => {
  for (const mode of ["rejects", "hangs"] as const) {
    let ended = 0;
    const connection: SqlConnection = {
      async query(text) {
        if (text === "ROLLBACK") return mode === "rejects" ? Promise.reject(networkError("EPIPE")) : new Promise<never>(() => undefined);
        if (text.startsWith("SELECT kusabi.")) return Promise.reject(dbError("OC004", "onza-common:not_found"));
        return { rows: [] };
      },
      end: () => ((ended += 1), mode === "rejects" ? Promise.reject(networkError("EPIPE")) : new Promise<never>(() => undefined)),
    };
    const started = Date.now();
    const result = await storeOver({ connect: async () => connection }, SHORT).getDecisions({ limit: 3 });
    assert.ok(!result.ok);
    assert.equal(result.name, "seat_not_registered");
    assert.ok(Date.now() - started < 1000, mode);
    assert.equal(ended, 1);
  }
}]);

cases.push(["a database that cannot be reached, or a statement before the call that fails, is a plain placement_unreachable without the note", async () => {
  const down = new FakeDb();
  down.faults.connect = networkError("ECONNREFUSED");
  const refused = await save(storeOver(down));
  assert.ok(!refused.ok);
  assert.deepEqual(refused, { ok: false, name: "placement_unreachable", cause: "connect_failed", code: "ECONNREFUSED" });
  assert.deepEqual(down.statements, []);
  const early = new FakeDb();
  early.faults.before = networkError("ECONNRESET");
  const result = await save(storeOver(early));
  assert.ok(!result.ok);
  assert.equal(result.name, "placement_unreachable");
  assert.equal(result.cause, "connect_failed");
  assert.equal(result.note, undefined);
  assert.equal(calls(early).length, 0);
  const back = new FakeDb();
  back.faults.connect = networkError("ECONNREFUSED");
  const store = storeOver(back);
  assert.ok(!(await save(store)).ok);
  back.faults.connect = undefined;
  assert.ok((await save(store)).ok, "the next call connects again with no restart (BR1.5)");
}]);

cases.push(["an answer that is not the expected shape is bad_response, rolled back, and not a success (S5)", async () => {
  const id = uuidv7();
  const shapes: unknown[] = [undefined, null, "text", {}, { decision_id: id }, { decision_id: id, created_at_ms: "1" }, { decision_id: uuidv7(), created_at_ms: 1 }];
  for (const shape of shapes) {
    const window = scripted(rowsFor(shape));
    const result = await storeOver(window.client).logDecision({ decisionId: id, decision: "x", tags: [] });
    assert.ok(!result.ok, JSON.stringify(shape));
    assert.deepEqual(result, { ok: false, name: null, cause: "bad_response" });
    assert.ok(window.sent.includes("ROLLBACK") && !window.sent.includes("COMMIT"));
    assert.equal(window.ended(), 1);
  }
  for (const rows of [[], [{ result: 1 }, { result: 2 }]]) {
    const window = scripted((text) => (text.startsWith("SELECT kusabi.") ? { rows } : { rows: [] }));
    const result = await storeOver(window.client).recoverDecisions({ limit: 3 });
    assert.ok(!result.ok && result.cause === "bad_response");
  }
  const noTotal = scripted(rowsFor({ decisions: [], verified: { scope_id: "s", principal_ref: "p", seat_ref: "q", binding_ref: "b", binding_generation: 1 } }));
  assert.ok(!(await storeOver(noTotal.client).recoverDecisions({ limit: 3 })).ok);
  const badRow = scripted(rowsFor({ decisions: [{ id: "x" }], verified: { scope_id: "s", principal_ref: "p", seat_ref: "q", binding_ref: "b", binding_generation: 1 } }));
  assert.ok(!(await storeOver(badRow.client).getDecisions({ limit: 3 })).ok);
}]);

cases.push(["inputs of the wrong shape are invalid_input before any connection; bounds are the database's", async () => {
  const db = new FakeDb();
  const store = storeOver(db);
  const bad = [
    await store.logDecision({ decisionId: "not-a-uuid", decision: "x", tags: [] }),
    await store.logDecision({ decisionId: uuidv7(), decision: 5 as unknown as string, tags: [] }),
    await store.logDecision({ decisionId: uuidv7(), decision: "x", tags: [{ id: "bad", text: "t" }] }),
    await store.logDecision({ decisionId: uuidv7(), decision: "x" } as never),
    await store.getDecisions({ limit: 1.5 }),
    await store.getDecisions({ limit: "3" as unknown as number }),
    await store.recoverDecisions({ limit: undefined as unknown as number }),
  ];
  for (const result of bad) {
    assert.ok(!result.ok);
    assert.deepEqual(result, { ok: false, name: "invalid_input", cause: "input" });
  }
  assert.equal(db.connects, 0);
  const overlong = await store.logDecision({ decisionId: uuidv7(), decision: "x".repeat(9000), tags: [] });
  assert.ok(overlong.ok, "the length limit is the database's CHECK, not a second copy here");
  assert.ok((await store.getDecisions({ limit: 1000 })).ok, "the 1..100 range is the database's too");
}]);

cases.push(["statement text holds no value: every value travels as a parameter, and no failure shows a value", async () => {
  const db = new FakeDb();
  db.faults.select = new Error(`driver text ${SECRET_PASSWORD} ${DECISION_TEXT}`);
  const store = storeOver(db);
  const failed = await save(store);
  await store.getDecisions({ project: DECISION_TEXT, tags: [DECISION_TEXT], limit: 5 });
  for (const text of texts(db)) {
    assert.ok(/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL statement_timeout = \d+|SELECT kusabi\.\w+\((\$\d+(::[a-z0-9\[\]]+)?(, )?)+\) AS result)$/.test(text), text);
  }
  assert.ok(!JSON.stringify(failed).includes(SECRET_PASSWORD) && !JSON.stringify(failed).includes(DECISION_TEXT));
}]);

class FakeDriver {
  static readonly instances: FakeDriver[] = [];
  listeners: Array<(error: Error) => void> = [];
  statements: Array<{ text: string; values: unknown[] }> = [];
  ended = 0;
  static failConnect: Error | undefined;
  constructor(readonly config: { connectionString: string; connectionTimeoutMillis: number }) {
    FakeDriver.instances.push(this);
  }
  on(_event: "error", listener: (error: Error) => void): void {
    this.listeners.push(listener);
  }
  async connect(): Promise<void> {
    if (FakeDriver.failConnect) throw FakeDriver.failConnect;
  }
  async query(text: string, values: unknown[]): Promise<{ rows: unknown[] }> {
    this.statements.push({ text, values });
    return { rows: [{ result: { text } }] };
  }
  async end(): Promise<void> {
    this.ended += 1;
  }
}

cases.push(["the driver adapter: opens with the place and the connect limit, forwards a copy of the values, ignores a later socket error", async () => {
  const client = createPgSqlClient(new StoreTarget(SYNTHETIC_URL), FakeDriver as unknown as PgClientCtor);
  const connection = await client.connect(1234);
  const driver = FakeDriver.instances[0];
  assert.equal(driver.config.connectionString, SYNTHETIC_URL);
  assert.equal(driver.config.connectionTimeoutMillis, 1234);
  assert.equal(driver.listeners.length, 1);
  assert.doesNotThrow(() => driver.listeners[0](new Error("idle socket error")));
  const values = ["a", 1];
  const answer = await connection.query("SELECT 1", values);
  assert.deepEqual(answer.rows, [{ result: { text: "SELECT 1" } }]);
  assert.notEqual(driver.statements[0].values, values);
  assert.deepEqual(driver.statements[0].values, values);
  await connection.end();
  assert.equal(driver.ended, 1);
  FakeDriver.failConnect = networkError("ECONNREFUSED");
  await assert.rejects(client.connect(10), (error: Error & { code?: string }) => error.code === "ECONNREFUSED");
  FakeDriver.failConnect = undefined;
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
console.log(process.exitCode === 1 ? `common-seat-store: ${cases.length - passed} of ${cases.length} checks failed` : `common-seat-store: ${passed} checks passed`);
