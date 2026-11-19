/**
 * The seat's places against a throwaway PostgreSQL (u1-seat-memory-skeleton, PR-1; db-design-record 5, 6, 9, 10):
 * the migrations (up, down, up; a broken 0002; a role that is not the database owner), the roles and what each may do,
 * the table guards, the seat check, and the three calls through the real driver against a stand-in of the common
 * infrastructure's verification that this file builds itself (STAND_IN_SQL).
 * By hand only; CI does not run it (team.md). Run: npx tsx src/test-common-seat-pg.ts
 * (initdb, pg_ctl, psql and postgres from PATH, or from KUSABI_TEST_PG_BIN; a missing tool prints OBSERVATION_UNAVAILABLE
 * and exits 3, never 0). It reads nothing outside this repository.
 * The server listens on 127.0.0.1 only, on a port the system picks, with no socket file, and is stopped and removed at
 * the end. Every id, role and name below is synthetic; the ids carry the marker prefix of test-common-seat-support.ts.
 */
import "./test-isolated-home.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { COMMON_CONTRACT, COMMON_PRODUCT, SeatSetting } from "./common-placement.js";
import { createCommonSeatStore, createPgSqlClient } from "./common-seat-store.js";
import { StoreTarget } from "./store-resolution.js";
import { SEAT_A, SEAT_B, SEAT_UNREGISTERED, scratchFolder, syntheticId, type SeatFixture } from "./test-common-seat-support.js";

/**
 * 公開の名前だけから書いた作り物で、共通基盤の写しではない。
 * What it takes from public names only: the role `common_verify_caller` and the function `common.verify_current_tx` with
 * its seven arguments (the Kusabi migrations and functions name them), the `actor` object it returns (the keys the Kusabi
 * functions read), and the SQLSTATE and `onza-common:<reason>` pairs of src/common-seat-errors.ts. Which seat is refused,
 * and with which pair, is data the test puts in `common.stand_in_seat`; nothing here decides who a real caller is.
 */
const STAND_IN_SQL = `
-- 公開の名前だけから書いた作り物で、共通基盤の写しではない
CREATE SCHEMA common;
CREATE TABLE common.stand_in_seat (
  seat_id text PRIMARY KEY, scope_id text NOT NULL, binding_id text NOT NULL, binding_generation bigint NOT NULL,
  refuse_state text, refuse_reason text
);
CREATE TABLE common.stand_in_call (operation text NOT NULL, product text, contract text, installation_id text);
CREATE FUNCTION common.verify_current_tx(p_context json, p_scope text, p_actor json, p_operation text, p_a json, p_b json, p_c json)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, common AS $$
DECLARE
  v_actor jsonb := p_actor::jsonb;
  v_seat common.stand_in_seat;
BEGIN
  IF p_scope IS NULL OR p_scope !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR p_operation NOT IN ('save', 'query') THEN
    RAISE EXCEPTION USING ERRCODE = 'OC001', MESSAGE = 'onza-common:invalid_input';
  END IF;
  INSERT INTO common.stand_in_call VALUES (p_operation, p_context ->> 'product', p_context ->> 'required_contract', p_context ->> 'expected_installation_id');
  IF v_actor ->> 'seat_id' IS NULL THEN
    RETURN json_build_object('actor', p_actor);
  END IF;
  SELECT * INTO v_seat FROM common.stand_in_seat WHERE seat_id = v_actor ->> 'seat_id';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'OC004', MESSAGE = 'onza-common:not_found';
  END IF;
  IF v_seat.refuse_state IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = v_seat.refuse_state, MESSAGE = 'onza-common:' || v_seat.refuse_reason;
  END IF;
  IF v_seat.scope_id <> p_scope OR v_seat.binding_id <> v_actor ->> 'binding_id' OR v_seat.binding_generation <> (v_actor ->> 'binding_generation')::bigint THEN
    RAISE EXCEPTION USING ERRCODE = 'OC008', MESSAGE = 'onza-common:stale';
  END IF;
  RETURN json_build_object('actor', p_actor);
END
$$;
REVOKE ALL ON FUNCTION common.verify_current_tx(json, text, json, text, json, json, json) FROM PUBLIC;
GRANT USAGE ON SCHEMA common TO common_verify_caller;
GRANT EXECUTE ON FUNCTION common.verify_current_tx(json, text, json, text, json, json, json) TO common_verify_caller;
`;
/** What the stand-in raises for a refused seat, and the name Kusabi gives it (the same pairs as src/common-seat-errors.ts). */
const PAIRS: ReadonlyArray<readonly [state: string, reason: string, name: string]> = [
  ["OC001", "invalid_input", "invalid_input"],
  ["OC002", "unauthenticated", "seat_not_registered"],
  ["OC003", "forbidden", "no_membership"],
  ["OC004", "not_found", "seat_not_registered"],
  ["OC005", "not_initialized", "not_initialized"],
  ["OC006", "unbound", "binding_closed"],
  ["OC007", "retired", "binding_closed"],
  ["OC008", "stale", "binding_closed"],
  ["OC009", "incompatible", "not_initialized"],
  ["OC010", "conflict", "invalid_input"],
  ["OC011", "unavailable", "placement_unreachable"],
];
const hex = (n: number): string => n.toString(16);
const refusedSeat = (i: number): SeatFixture => ({ ...SEAT_A, seat_id: syntheticId(hex(0x10 + i)), binding_id: syntheticId(hex(0x20 + i)) });
const SQL_DIR = new URL("../sql/kusabi/", import.meta.url).pathname;
const OTHER_SCOPE_ID = syntheticId("04");
const ACTIVE_STATUS_ID = "019a0f00-0000-7000-8000-000000000001";
const FUNCTIONS = ["log_decision", "get_decisions", "recover_decisions"];
const TABLES = ["decision_status", "decision", "decision_tag"];

function unavailable(reason: string): never {
  console.log(`OBSERVATION_UNAVAILABLE: ${reason}`);
  process.exit(3);
}

const binDir = process.env.KUSABI_TEST_PG_BIN;
const tool = (name: string): string => (binDir ? join(binDir, name) : name);
const cleanEnv = { PATH: process.env.PATH ?? "", LC_ALL: "C", HOME: process.env.HOME ?? "" };
const run = (command: string, args: string[]) => spawnSync(tool(command), args, { encoding: "utf8", env: cleanEnv });
for (const name of ["initdb", "pg_ctl", "psql", "postgres"]) {
  if (run(name, ["--version"]).status !== 0) unavailable(`${name} is not available`);
}

const scratch = scratchFolder();
const dataDir = join(scratch.dir, "data");
const logFile = join(scratch.dir, "server.log");
const copies = join(scratch.dir, "copies");
mkdirSync(copies);

const port: number = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.on("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port: picked } = probe.address() as AddressInfo;
    probe.close(() => resolve(picked));
  });
});
let serverUp = false;
const stopServer = (): void => {
  if (serverUp) run("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
  serverUp = false;
};
process.on("exit", stopServer);

assert.equal(run("initdb", ["-D", dataDir, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C"]).status, 0, "initdb");
const options = `-c listen_addresses=127.0.0.1 -c port=${port} -c unix_socket_directories= -c lc_messages=C -c fsync=off`;
assert.equal(run("pg_ctl", ["-D", dataDir, "-o", options, "-l", logFile, "-w", "start"]).status, 0, "pg_ctl start");
serverUp = true;

const url = (user: string, db: string, at = port): string => `postgres://${user}@127.0.0.1:${at}/${db}`;
async function q(user: string, db: string, text: string, values: unknown[] = []): Promise<Array<Record<string, any>>> {
  const client = new pg.Client({ host: "127.0.0.1", port, user, database: db });
  client.on("error", () => undefined);
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}
const admin = (db: string, text: string, values: unknown[] = []) => q("postgres", db, text, values);
/** The SQLSTATE and message of a statement that must fail ("ok" when it did not), run as `role` and rolled back. */
async function asRole(db: string, role: string | null, text: string, values: unknown[] = []): Promise<{ code: string; message: string }> {
  const client = new pg.Client({ host: "127.0.0.1", port, user: "postgres", database: db });
  client.on("error", () => undefined);
  await client.connect();
  try {
    await client.query("BEGIN");
    if (role) await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(text, values);
    return { code: "ok", message: "" };
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return { code: e.code ?? "none", message: e.message ?? "" };
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}
const psql = (user: string, db: string, file: string) =>
  run("psql", ["-h", "127.0.0.1", "-p", String(port), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", `migration_role=${user}`, "-v", `database=${db}`, "-U", user, "-d", db, "-f", file]);
const migrate = (db: string, name: string, file = join(SQL_DIR, name)) => psql("kusabi_migrator", db, file);

async function reset(): Promise<void> {
  for (const row of await admin("postgres", "SELECT datname FROM pg_database WHERE datname LIKE 'kx\\_%'")) {
    await admin("postgres", `DROP DATABASE "${row.datname}" WITH (FORCE)`);
  }
  for (const row of await admin("postgres", "SELECT rolname FROM pg_roles WHERE rolname ~ '^(kusabi_|common_|kx_)'")) {
    await admin("postgres", `DROP ROLE "${row.rolname}"`);
  }
}
/** A database for the migrations: the migration role (CREATEROLE, ADMIN OPTION on the verification role), no stand-in. */
async function bareDb(db: string, owner: string): Promise<void> {
  await admin("postgres", "CREATE ROLE common_verify_caller NOLOGIN");
  await admin("postgres", "CREATE ROLE kusabi_migrator LOGIN CREATEROLE");
  await admin("postgres", "GRANT common_verify_caller TO kusabi_migrator WITH ADMIN OPTION");
  await admin("postgres", `CREATE DATABASE ${db} OWNER ${owner}`);
}
/** The stand-in with the seats it knows (two active, one refused with each pair), the two Kusabi migrations and one login. */
async function fullDb(db: string): Promise<void> {
  await bareDb(db, "kusabi_migrator");
  await admin(db, STAND_IN_SQL);
  const seat = (s: SeatFixture, state: string | null = null, reason: string | null = null) =>
    admin(db, "INSERT INTO common.stand_in_seat VALUES ($1, $2, $3, $4, $5, $6)", [s.seat_id, s.scope_id, s.binding_id, s.binding_generation, state, reason]);
  await seat(SEAT_A);
  await seat(SEAT_B);
  for (const [i, [state, reason]] of PAIRS.entries()) await seat(refusedSeat(i), state, reason);
  for (const name of ["0001_roles.up.sql", "0002_schema.up.sql"]) assert.equal(migrate(db, name).status, 0, name);
  await admin(db, "CREATE ROLE kx_login LOGIN IN ROLE kusabi_seat");
}

async function fingerprint(db: string): Promise<string> {
  const rows = await admin(
    db,
    `SELECT k, v FROM (
       SELECT 'role' AS k, rolname || ':' || rolcanlogin::text AS v FROM pg_roles WHERE rolname LIKE 'kusabi\\_%' AND rolname <> 'kusabi_migrator'
       UNION ALL SELECT 'owner_create', has_database_privilege(rolname, current_database(), 'CREATE')::text FROM pg_roles WHERE rolname = 'kusabi_owner'
       UNION ALL SELECT 'schema', n.nspname || ':' || pg_get_userbyid(n.nspowner) || ':' || coalesce(n.nspacl::text, '') FROM pg_namespace n WHERE n.nspname = 'kusabi'
       UNION ALL SELECT 'rel', c.relname || ':' || c.relkind::text || ':' || pg_get_userbyid(c.relowner) || ':' || c.relrowsecurity::text || c.relforcerowsecurity::text || ':' || coalesce(c.relacl::text, '')
         FROM pg_class c WHERE c.relnamespace = to_regnamespace('kusabi') AND c.relkind IN ('r', 'i')
       UNION ALL SELECT 'fn', p.proname || ':' || pg_get_userbyid(p.proowner) || ':' || p.prosecdef::text || ':' || coalesce(p.proconfig::text, '') || ':' || coalesce(p.proacl::text, '')
         FROM pg_proc p WHERE p.pronamespace = to_regnamespace('kusabi')
       UNION ALL SELECT 'policy', polname FROM pg_policy
       UNION ALL SELECT 'trigger', tgname FROM pg_trigger WHERE NOT tgisinternal
     ) t ORDER BY k, v`,
  );
  return JSON.stringify(rows);
}
const roleCount = async (db: string): Promise<number> => Number((await admin(db, "SELECT count(*) AS n FROM pg_roles WHERE rolname LIKE 'kusabi\\_%' AND rolname <> 'kusabi_migrator'"))[0].n);
const count = async (db: string, text: string, values: unknown[] = []): Promise<number> => Number((await admin(db, text, values))[0].n);

const FULL = "kx_full";
const storeFor = (login: string, seat: SeatFixture = SEAT_A, target = url(login, FULL)) =>
  createCommonSeatStore({ client: createPgSqlClient(new StoreTarget(target)), seat: new SeatSetting(seat), now: Date.now });
const failureOf = (value: unknown) => {
  const result = value as { ok: boolean; name: string | null; cause?: string; code?: string };
  assert.equal(result.ok, false, "a failure was expected");
  return result;
};
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const ctx = (seat: SeatFixture) => JSON.stringify({ product: COMMON_PRODUCT, required_contract: COMMON_CONTRACT, expected_installation_id: seat.installation_id, expected_db_epoch: seat.db_epoch, deadline_ms: Date.now() + 5000, budget: { remaining_ms: 5000, remaining_queries: 4 } });
const directActor = JSON.stringify({ contract_version: COMMON_CONTRACT, ...SEAT_A, seat_id: null, binding_id: null, binding_generation: null, observed_at_ms: Date.now() });

const cases: Array<[string, () => Promise<void>]> = [];
const check = (name: string, run: () => Promise<void>): void => void cases.push([name, run]);

check("migrations: roles, then schema, then back down and up again leave the same catalog; a second 0002 after its down keeps the roles", async () => {
  await reset();
  await bareDb("kx_round", "kusabi_migrator");
  assert.equal(await roleCount("kx_round"), 0);
  assert.equal(migrate("kx_round", "0001_roles.up.sql").status, 0);
  assert.equal(await roleCount("kx_round"), 4);
  assert.equal(migrate("kx_round", "0002_schema.up.sql").status, 0);
  const first = await fingerprint("kx_round");
  assert.ok(first.includes("kusabi_owner:false") && first.includes("owner_create") && first.includes("policy_decision_scope"));
  assert.equal(migrate("kx_round", "0002_schema.down.sql").status, 0);
  assert.equal(await count("kx_round", "SELECT count(*) AS n FROM pg_namespace WHERE nspname = 'kusabi'"), 0);
  assert.equal(await roleCount("kx_round"), 4, "the roles stay after 0002 goes down");
  assert.equal(migrate("kx_round", "0002_schema.up.sql").status, 0);
  assert.equal(await fingerprint("kx_round"), first);
  assert.equal(migrate("kx_round", "0002_schema.down.sql").status, 0);
  assert.equal(migrate("kx_round", "0001_roles.down.sql").status, 0);
  assert.equal(await roleCount("kx_round"), 0);
  assert.equal(await count("kx_round", "SELECT count(*) AS n FROM pg_roles WHERE rolname = 'common_verify_caller'"), 1, "the common role is never dropped");
  for (const name of ["0001_roles.up.sql", "0002_schema.up.sql"]) assert.equal(migrate("kx_round", name).status, 0);
  assert.equal(await fingerprint("kx_round"), first, "down and up again leaves the same catalog");
});

check("migrations: a role that is not the database owner cannot finish 0001, and no role is left behind", async () => {
  await reset();
  await bareDb("kx_notowner", "postgres");
  const result = migrate("kx_notowner", "0001_roles.up.sql");
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes("kusabi:owner_cannot_create"));
  assert.equal(await roleCount("kx_notowner"), 0);
});

check("migrations: 0002 broken part way leaves no schema, table, function, owned object or temporary CREATE; the real one then applies", async () => {
  await reset();
  await bareDb("kx_broken", "kusabi_migrator");
  assert.equal(migrate("kx_broken", "0001_roles.up.sql").status, 0);
  const original = readFileSync(join(SQL_DIR, "0002_schema.up.sql"), "utf8");
  const broken = original.replace("CREATE FUNCTION kusabi.get_decisions(", "CREATE FUNCTIOM kusabi.get_decisions(");
  assert.notEqual(broken, original, "the copy was changed");
  const copy = join(copies, "0002_broken.up.sql");
  writeFileSync(copy, broken);
  assert.notEqual(migrate("kx_broken", "", copy).status, 0);
  assert.equal(await count("kx_broken", "SELECT count(*) AS n FROM pg_namespace WHERE nspname = 'kusabi'"), 0);
  assert.equal(await count("kx_broken", "SELECT count(*) AS n FROM pg_proc WHERE proname = ANY($1)", [[...FUNCTIONS, "require_verified_seat", "trigger_decision_guard"]]), 0);
  assert.equal(await count("kx_broken", "SELECT count(*) AS n FROM pg_class WHERE relname = ANY($1)", [TABLES]), 0);
  assert.equal(await count("kx_broken", "SELECT count(*) AS n FROM pg_shdepend d JOIN pg_roles r ON r.oid = d.refobjid WHERE d.deptype = 'o' AND d.dbid = (SELECT oid FROM pg_database WHERE datname = 'kx_broken') AND r.rolname LIKE 'kusabi\\_%'"), 0);
  assert.equal(migrate("kx_broken", "0002_schema.up.sql").status, 0);
});

check("setup: the stand-in with its seats, both migrations and one login", async () => {
  await reset();
  await fullDb(FULL);
  assert.equal(await count(FULL, "SELECT count(*) AS n FROM pg_proc WHERE pronamespace = 'kusabi'::regnamespace AND prokind = 'f'"), 6);
});

check("roles: what each may do on the tables and the functions (db-design-record 6)", async () => {
  const has = async (role: string, kind: "table" | "function", object: string, privilege: string): Promise<boolean> =>
    (await admin(FULL, `SELECT has_${kind}_privilege($1, $2, $3) AS v`, [role, object, privilege]))[0].v;
  const signatures: Record<string, string> = {
    log_decision: "kusabi.log_decision(json, text, json, uuid, text, text, text, uuid[], text[])",
    get_decisions: "kusabi.get_decisions(json, text, json, text, text[], integer)",
    recover_decisions: "kusabi.recover_decisions(json, text, json, integer)",
    require_verified_seat: "kusabi.require_verified_seat(text, text, bigint)",
  };
  await admin(FULL, "CREATE ROLE kx_stranger NOLOGIN");
  for (const table of ["kusabi.decision", "kusabi.decision_tag"]) {
    assert.deepEqual(await Promise.all(["SELECT", "INSERT"].map((p) => has("kusabi_save_function_owner", "table", table, p))), [true, true]);
    assert.deepEqual(await Promise.all(["UPDATE", "DELETE", "TRUNCATE"].map((p) => has("kusabi_save_function_owner", "table", table, p))), [false, false, false]);
    assert.equal(await has("kusabi_query_function_owner", "table", table, "SELECT"), true);
    assert.deepEqual(await Promise.all(["INSERT", "UPDATE", "DELETE", "TRUNCATE"].map((p) => has("kusabi_query_function_owner", "table", table, p))), [false, false, false, false]);
  }
  assert.equal(await has("kusabi_save_function_owner", "table", "kusabi.decision_status", "SELECT"), true);
  assert.equal(await has("kusabi_save_function_owner", "table", "kusabi.decision_status", "INSERT"), false);
  for (const role of ["kusabi_seat", "kx_login", "kx_stranger"]) {
    for (const table of ["kusabi.decision", "kusabi.decision_tag", "kusabi.decision_status"]) {
      assert.deepEqual(await Promise.all(["SELECT", "INSERT", "UPDATE", "DELETE"].map((p) => has(role, "table", table, p))), [false, false, false, false], `${role} ${table}`);
    }
  }
  for (const name of FUNCTIONS) {
    assert.equal(await has("kusabi_seat", "function", signatures[name], "EXECUTE"), true, name);
    assert.equal(await has("kx_login", "function", signatures[name], "EXECUTE"), true, name);
    assert.equal(await has("kx_stranger", "function", signatures[name], "EXECUTE"), false, name);
  }
  const helper = signatures.require_verified_seat;
  assert.deepEqual(
    await Promise.all(["kusabi_save_function_owner", "kusabi_query_function_owner", "kusabi_seat", "kx_login", "kx_stranger"].map((r) => has(r, "function", helper, "EXECUTE"))),
    [true, true, false, false, false],
  );
  assert.equal((await admin(FULL, "SELECT has_schema_privilege('kx_stranger', 'kusabi', 'USAGE') AS v"))[0].v, false);
  for (const role of ["kusabi_save_function_owner", "kusabi_query_function_owner", "kusabi_seat"]) {
    assert.equal((await admin(FULL, "SELECT has_schema_privilege($1, 'kusabi', 'CREATE') AS v", [role]))[0].v, false, `${role} cannot create after the migration`);
  }
});

check("roles: the refusals happen when a statement is run, not only in the catalog", async () => {
  assert.equal((await asRole(FULL, "kusabi_seat", "SELECT * FROM kusabi.decision")).code, "42501");
  assert.equal((await asRole(FULL, "kusabi_seat", "SELECT kusabi.require_verified_seat('a', 'b', 1)")).code, "42501");
  assert.equal((await asRole(FULL, "kx_stranger", "SELECT kusabi.require_verified_seat('a', 'b', 1)")).code, "42501");
  assert.equal((await asRole(FULL, "kx_stranger", "SELECT * FROM kusabi.decision_status")).code, "42501");
  const insert = "INSERT INTO kusabi.decision_status (id, code) VALUES ('019a0f00-0000-7000-8000-0000000000f1', 'other')";
  assert.equal((await asRole(FULL, "kusabi_query_function_owner", insert)).code, "42501");
  assert.equal((await asRole(FULL, "kusabi_save_function_owner", insert)).code, "42501");
  const scoped = (text: string): string => `SELECT set_config('kusabi.scope_id', '${SEAT_A.scope_id}', true); ${text}`;
  assert.equal((await asRole(FULL, "kusabi_save_function_owner", scoped("UPDATE kusabi.decision SET project_name = 'x'"))).code, "42501");
  assert.equal((await asRole(FULL, "kusabi_save_function_owner", scoped("DELETE FROM kusabi.decision"))).code, "42501");
  assert.equal((await asRole(FULL, "kusabi_save_function_owner", scoped("DELETE FROM kusabi.decision_tag"))).code, "42501");
  assert.equal((await asRole(FULL, "kusabi_query_function_owner", scoped("INSERT INTO kusabi.decision_tag (id, scope_id, decision_id, tag_text) VALUES ('019a0f00-0000-7000-8000-0000000000f2', '" + SEAT_A.scope_id + "', '019a0f00-0000-7000-8000-0000000000f3', 't')"))).code, "42501");
  assert.equal((await asRole(FULL, "kusabi_seat", scoped("SELECT 1 FROM kusabi.decision_tag"))).code, "42501");
  assert.equal((await asRole(FULL, "kusabi_query_function_owner", "SELECT count(*) FROM kusabi.decision")).code, "42704", "no scope set: a stop, not an empty answer");
  assert.equal((await asRole(FULL, "kusabi_owner", "SELECT 1 FROM kusabi.decision LIMIT 1")).code, "ok");
  assert.equal(await count(FULL, "SELECT count(*) AS n FROM kusabi.decision"), 0);
});

check("catalog (T-7): every SECURITY DEFINER function of the schema calls the seat check before it sets the scope; owners and settings are as designed", async () => {
  const rows = await admin(FULL, "SELECT proname, pg_get_userbyid(proowner) AS owner, prosecdef, proconfig, prosrc FROM pg_proc WHERE pronamespace = 'kusabi'::regnamespace AND prokind = 'f' ORDER BY proname");
  const definers = rows.filter((row) => row.prosecdef);
  assert.deepEqual(definers.map((row) => row.proname).sort(), [...FUNCTIONS].sort());
  for (const row of definers) {
    const source = String(row.prosrc);
    const call = source.indexOf("require_verified_seat");
    assert.ok(call >= 0 && call < source.indexOf("set_config"), row.proname);
    assert.deepEqual(row.proconfig, ["search_path=pg_catalog, kusabi, pg_temp"]);
    assert.equal(row.owner, row.proname === "log_decision" ? "kusabi_save_function_owner" : "kusabi_query_function_owner");
  }
  const helper = rows.find((row) => row.proname === "require_verified_seat");
  assert.ok(helper);
  assert.equal(helper.prosecdef, false);
  assert.equal(helper.owner, "kusabi_query_function_owner");
  assert.deepEqual(helper.proconfig, ["search_path=pg_catalog"]);
  assert.deepEqual(rows.filter((row) => row.owner === "kusabi_owner").map((row) => row.proname).sort(), ["trigger_decision_guard", "trigger_decision_tag_guard"]);
  assert.deepEqual(rows.filter((row) => row.owner === "kusabi_owner" && row.prosecdef), []);
});

check("seat check (T-4): no seat is seat_not_registered, no binding or generation is binding_closed, all three return", async () => {
  const call = (seat: string | null, binding: string | null, generation: number | null) => asRole(FULL, null, "SELECT kusabi.require_verified_seat($1, $2, $3)", [seat, binding, generation]);
  for (const result of [await call(null, "b", 1), await call("", "b", 1)]) assert.deepEqual([result.code, result.message], ["28000", "kusabi:seat_not_registered"]);
  for (const result of [await call("s", null, 1), await call("s", "", 1), await call("s", "b", null)]) assert.deepEqual([result.code, result.message], ["28000", "kusabi:binding_closed"]);
  assert.equal((await call("s", "b", 1)).code, "ok");
});

check("verified caller without a seat (T-1..T-3): the three calls refuse, no row is written, and a bad scope is a stop, not an empty answer", async () => {
  const scope = SEAT_A.scope_id;
  const calls: Array<[string, string, unknown[]]> = [
    ["get", "SELECT kusabi.get_decisions($1::json, $2, $3::json, NULL, NULL, 5)", []],
    ["recover", "SELECT kusabi.recover_decisions($1::json, $2, $3::json, 5)", []],
    ["log", "SELECT kusabi.log_decision($1::json, $2, $3::json, '019a0f00-0000-7000-8000-0000000000a1', 'x', NULL, NULL, '{}'::uuid[], '{}'::text[])", []],
  ];
  for (const [, text] of calls) {
    const client = new pg.Client({ host: "127.0.0.1", port, user: "kx_login", database: FULL });
    client.on("error", () => undefined);
    await client.connect();
    try {
      for (const [actor, expectedCode, expectedMessage, scopeId] of [
        [directActor, "28000", "kusabi:seat_not_registered", scope],
        [directActor, "OC001", "onza-common:invalid_input", ""],
        [directActor, "OC001", "onza-common:invalid_input", "not-an-id"],
      ] as const) {
        await client.query("BEGIN");
        const error = await client.query(text, [ctx(SEAT_A), scopeId, actor]).then(() => null, (e: { code: string; message: string }) => e);
        await client.query("ROLLBACK");
        assert.deepEqual([error?.code, error?.message], [expectedCode, expectedMessage]);
      }
    } finally {
      await client.end();
    }
  }
  assert.equal(await count(FULL, "SELECT count(*) AS n FROM kusabi.decision"), 0);
  assert.equal(await count(FULL, "SELECT count(*) AS n FROM kusabi.decision_tag"), 0);
});

check("the three calls through the real driver (T-5): an empty seat succeeds; a write is read back newest first with its tags; recover counts", async () => {
  await admin(FULL, "TRUNCATE common.stand_in_call");
  const store = storeFor("kx_login");
  const empty = await store.recoverDecisions({ limit: 5 });
  assert.ok(empty.ok);
  assert.deepEqual([empty.decisions, empty.total_active_count], [[], 0]);
  assert.deepEqual(empty.verified, { scope_id: SEAT_A.scope_id, principal_ref: SEAT_A.principal_id, seat_ref: SEAT_A.seat_id, binding_ref: SEAT_A.binding_id, binding_generation: 1 });
  const none = await store.getDecisions({ limit: 5 });
  assert.ok(none.ok && none.decisions.length === 0);
  const before = Date.now();
  const first = await store.logDecision({ decisionId: uuidv7(), decision: "first", context: "why", project: "alpha", tags: [{ id: uuidv7(), text: "t2" }, { id: uuidv7(), text: "t1" }] });
  assert.ok(first.ok);
  await sleep(5);
  const second = await store.logDecision({ decisionId: uuidv7(), decision: "second", project: "beta", tags: [{ id: uuidv7(), text: "t3" }] });
  assert.ok(second.ok);
  assert.ok(first.createdAtMs >= before - 5000 && second.createdAtMs > first.createdAtMs);
  const all = await store.getDecisions({ limit: 10 });
  assert.ok(all.ok);
  assert.deepEqual(all.decisions.map((d) => [d.decision_text, d.context_text, d.project_name, d.tags, d.status]), [["second", null, "beta", ["t3"], "active"], ["first", "why", "alpha", ["t1", "t2"], "active"]]);
  const byProject = await store.getDecisions({ project: "alpha", limit: 10 });
  assert.ok(byProject.ok && byProject.decisions.map((d) => d.decision_text).join() === "first");
  const byTag = await store.getDecisions({ tags: ["t3", "nope"], limit: 10 });
  assert.ok(byTag.ok && byTag.decisions.map((d) => d.decision_text).join() === "second");
  const recovered = await store.recoverDecisions({ limit: 1 });
  assert.ok(recovered.ok && recovered.decisions.length === 1 && recovered.total_active_count === 2 && recovered.decisions[0].decision_text === "second");
  const seen = await admin(FULL, "SELECT operation, product, contract, count(*)::int AS n, array_agg(DISTINCT installation_id) AS installations FROM common.stand_in_call GROUP BY 1, 2, 3 ORDER BY 1");
  assert.deepEqual(seen.map((r) => [r.operation, r.product, r.contract, r.n, r.installations]), [
    ["query", COMMON_PRODUCT, COMMON_CONTRACT, 6, [SEAT_A.installation_id]],
    ["save", COMMON_PRODUCT, COMMON_CONTRACT, 2, [SEAT_A.installation_id]],
  ], "the verification is asked as 'query' by the two reads and as 'save' by the write, with the product, the contract and the installation of the setting");
});

check("who is refused and what it is called: each pair the verification can raise, an unknown seat and a stale generation, through the real driver", async () => {
  const kinds: Array<[SeatFixture, string, string]> = [
    ...PAIRS.map(([state, , name], i): [SeatFixture, string, string] => [refusedSeat(i), name, state]),
    [SEAT_UNREGISTERED, "seat_not_registered", "OC004"],
    [{ ...SEAT_A, binding_generation: 2 }, "binding_closed", "OC008"],
  ];
  const rowsBefore = await count(FULL, "SELECT count(*) AS n FROM kusabi.decision");
  for (const [seat, name, code] of kinds) {
    const store = storeFor("kx_login", seat);
    for (const result of [
      await store.getDecisions({ limit: 5 }),
      await store.recoverDecisions({ limit: 5 }),
      await store.logDecision({ decisionId: uuidv7(), decision: "refused", tags: [] }),
    ]) {
      const failure = failureOf(result);
      assert.deepEqual([failure.name, failure.cause, failure.code], [name, "refused", code], seat.seat_id);
    }
  }
  assert.equal(await count(FULL, "SELECT count(*) AS n FROM kusabi.decision"), rowsBefore, "a refused write wrote nothing");
});

check("a write that fails leaves nothing (S7, S8): a repeated id, a repeated tag and two writes of one id at once", async () => {
  const store = storeFor("kx_login");
  const id = uuidv7();
  assert.ok((await store.logDecision({ decisionId: id, decision: "once", tags: [] })).ok);
  const again = failureOf(await store.logDecision({ decisionId: id, decision: "twice", tags: [] }));
  assert.deepEqual([again.name, again.cause, again.code], [null, "unmapped", "23505"]);
  assert.equal(await count(FULL, "SELECT count(*) AS n FROM kusabi.decision WHERE id = $1", [id]), 1);
  const dupTagId = uuidv7();
  const dup = failureOf(await store.logDecision({ decisionId: dupTagId, decision: "tags", tags: [{ id: uuidv7(), text: "same" }, { id: uuidv7(), text: "same" }] }));
  assert.deepEqual([dup.name, dup.code], [null, "23505"]);
  assert.equal(await count(FULL, "SELECT count(*) AS n FROM kusabi.decision WHERE id = $1", [dupTagId]), 0, "the decision rolled back with its tags");
  const raced = uuidv7();
  const results = await Promise.all([store.logDecision({ decisionId: raced, decision: "a", tags: [] }), store.logDecision({ decisionId: raced, decision: "b", tags: [] })]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.filter((r) => !r.ok).every((r) => failureOf(r).name === null && failureOf(r).code === "23505"), true);
  assert.equal(await count(FULL, "SELECT count(*) AS n FROM kusabi.decision WHERE id = $1", [raced]), 1);
});

check("limits (I-3, tentative) and the id version: the edge that passes and the edge that is refused, each named invalid_input", async () => {
  const store = storeFor("kx_login");
  const rows = (): Promise<number> => count(FULL, "SELECT count(*) AS n FROM kusabi.decision");
  const tags = (n: number, text = (i: number) => `tag-${i}`) => Array.from({ length: n }, (_, i) => ({ id: uuidv7(), text: text(i) }));
  const passes: Array<[string, Parameters<typeof store.logDecision>[0]]> = [
    ["decision 1", { decisionId: uuidv7(), decision: "x", tags: [] }],
    ["decision 8000", { decisionId: uuidv7(), decision: "x".repeat(8000), tags: [] }],
    ["context 8000", { decisionId: uuidv7(), decision: "x", context: "c".repeat(8000), tags: [] }],
    ["project 200", { decisionId: uuidv7(), decision: "x", project: "p".repeat(200), tags: [] }],
    ["tag 64", { decisionId: uuidv7(), decision: "x", tags: [{ id: uuidv7(), text: "t".repeat(64) }] }],
    ["tags 20", { decisionId: uuidv7(), decision: "x", tags: tags(20) }],
  ];
  for (const [name, input] of passes) assert.ok((await store.logDecision(input)).ok, name);
  const refused: Array<[string, Parameters<typeof store.logDecision>[0]]> = [
    ["decision 0", { decisionId: uuidv7(), decision: "", tags: [] }],
    ["decision 8001", { decisionId: uuidv7(), decision: "x".repeat(8001), tags: [] }],
    ["context 0", { decisionId: uuidv7(), decision: "x", context: "", tags: [] }],
    ["context 8001", { decisionId: uuidv7(), decision: "x", context: "c".repeat(8001), tags: [] }],
    ["project 0", { decisionId: uuidv7(), decision: "x", project: "", tags: [] }],
    ["project 201", { decisionId: uuidv7(), decision: "x", project: "p".repeat(201), tags: [] }],
    ["tag 0", { decisionId: uuidv7(), decision: "x", tags: [{ id: uuidv7(), text: "" }] }],
    ["tag 65", { decisionId: uuidv7(), decision: "x", tags: [{ id: uuidv7(), text: "t".repeat(65) }] }],
    ["tags 21", { decisionId: uuidv7(), decision: "x", tags: tags(21) }],
    ["decision id version 4", { decisionId: "6ba7b810-9dad-41d1-80b4-00c04fd430c8", decision: "x", tags: [] }],
    ["tag id version 4", { decisionId: uuidv7(), decision: "x", tags: [{ id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8", text: "t" }] }],
  ];
  const before = await rows();
  for (const [name, input] of refused) {
    const failure = failureOf(await store.logDecision(input));
    assert.deepEqual([failure.name, failure.cause], ["invalid_input", "refused"], name);
  }
  assert.equal(await rows(), before, "a refused write wrote nothing");
  for (const limit of [1, 100]) assert.ok((await store.getDecisions({ limit })).ok && (await store.recoverDecisions({ limit })).ok, `limit ${limit}`);
  for (const limit of [0, -1, 101]) {
    assert.equal(failureOf(await store.getDecisions({ limit })).name, "invalid_input", `get ${limit}`);
    assert.equal(failureOf(await store.recoverDecisions({ limit })).name, "invalid_input", `recover ${limit}`);
  }
});

check("guards (BR3.1): a decision and its tags are not rewritten or deleted even by the role that bypasses the policy; only the status may change", async () => {
  const [row] = await admin(FULL, "SELECT id FROM kusabi.decision WHERE decision_text = 'first'");
  const message = (text: string, values: unknown[] = []) => asRole(FULL, null, text, values);
  assert.deepEqual(await message("UPDATE kusabi.decision SET decision_text = 'changed' WHERE id = $1", [row.id]), { code: "55000", message: "kusabi:decision_is_not_rewritten" });
  assert.deepEqual(await message("UPDATE kusabi.decision SET created_at = now() WHERE id = $1", [row.id]), { code: "55000", message: "kusabi:decision_is_not_rewritten" });
  assert.deepEqual(await message("DELETE FROM kusabi.decision WHERE id = $1", [row.id]), { code: "55000", message: "kusabi:decision_is_not_rewritten" });
  assert.deepEqual(await message("UPDATE kusabi.decision_tag SET tag_text = 'z' WHERE decision_id = $1", [row.id]), { code: "55000", message: "kusabi:decision_tag_is_not_rewritten" });
  assert.deepEqual(await message("DELETE FROM kusabi.decision_tag WHERE decision_id = $1", [row.id]), { code: "55000", message: "kusabi:decision_tag_is_not_rewritten" });
  assert.equal((await message("INSERT INTO kusabi.decision_tag (id, scope_id, decision_id, tag_text) VALUES ($1, $2, $3, 'orphan')", ["019a0f00-0000-7000-8000-0000000000b1", OTHER_SCOPE_ID, row.id])).code, "23503");
  const store = storeFor("kx_login");
  const before = await store.recoverDecisions({ limit: 100 });
  assert.ok(before.ok);
  await admin(FULL, "INSERT INTO kusabi.decision_status (id, code) VALUES ('019a0f00-0000-7000-8000-000000000002', 'archived')");
  await admin(FULL, "UPDATE kusabi.decision SET status_id = '019a0f00-0000-7000-8000-000000000002' WHERE id = $1", [row.id]);
  const after = await store.recoverDecisions({ limit: 100 });
  assert.ok(after.ok);
  assert.equal(after.total_active_count, before.total_active_count - 1);
  assert.ok(!after.decisions.some((d) => d.id === row.id), "a decision that is not active is not returned");
});

check("scope and seat: rows of another seat and of another scope are neither returned nor counted", async () => {
  const store = storeFor("kx_login");
  const before = await store.recoverDecisions({ limit: 100 });
  assert.ok(before.ok);
  const refs = { principal_ref: SEAT_A.principal_id, binding_ref: SEAT_A.binding_id };
  const plant = (id: string, scope: string, seat: string, text: string) =>
    admin(FULL, "INSERT INTO kusabi.decision (id, scope_id, principal_ref, seat_ref, binding_ref, binding_generation, status_id, decision_text, created_at) VALUES ($1, $2, $3, $4, $5, 1, $6, $7, now())", [id, scope, refs.principal_ref, seat, refs.binding_ref, ACTIVE_STATUS_ID, text]);
  await plant("019a0f00-0000-7000-8000-0000000000e1", SEAT_A.scope_id, SEAT_B.seat_id, "other-seat");
  await plant("019a0f00-0000-7000-8000-0000000000e2", OTHER_SCOPE_ID, SEAT_A.seat_id, "other-scope");
  const after = await store.recoverDecisions({ limit: 100 });
  const listed = await store.getDecisions({ limit: 100 });
  assert.ok(after.ok && listed.ok);
  assert.equal(after.total_active_count, before.total_active_count);
  for (const result of [after.decisions, listed.decisions]) assert.ok(!result.some((d) => d.decision_text.startsWith("other-")));
});

check("failures show no secret: an unreachable place and a missing database give a name and a short code, never the URL, the password or the text", async () => {
  const secret = "PW-SYNTHETIC-PG-4d7b";
  const closed: number = await new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port: picked } = probe.address() as AddressInfo;
      probe.close(() => resolve(picked));
    });
  });
  const targets: Array<[string, string, string]> = [
    ["a port nobody listens on", `postgres://kx_login:${secret}@127.0.0.1:${closed}/${FULL}`, "ECONNREFUSED"],
    ["a database that does not exist", `postgres://kx_login:${secret}@127.0.0.1:${port}/kx_missing`, "3D000"],
  ];
  for (const [label, target, code] of targets) {
    const store = storeFor("kx_login", SEAT_A, target);
    for (const result of [await store.getDecisions({ limit: 5 }), await store.logDecision({ decisionId: uuidv7(), decision: "SECRET-DECISION-TEXT", tags: [] })]) {
      const failure = failureOf(result);
      assert.deepEqual([failure.name, failure.cause, failure.code], ["placement_unreachable", "connect_failed", code], label);
      const shown = JSON.stringify(result);
      for (const forbidden of [secret, "127.0.0.1", String(port), String(closed), "SECRET-DECISION-TEXT", FULL, "kx_login"]) assert.ok(!shown.includes(forbidden), `${label}: ${forbidden}`);
    }
  }
  const back = storeFor("kx_login");
  assert.ok((await back.getDecisions({ limit: 1 })).ok, "the next call reaches the place again with no restart");
});

check("speed (NFR4.4): with 10,000 decisions of one seat, 100 writes and 100 reads each answer in 500 ms or less at the 95th value", async () => {
  await admin(
    FULL,
    `INSERT INTO kusabi.decision (id, scope_id, principal_ref, seat_ref, binding_ref, binding_generation, status_id, decision_text, created_at)
     SELECT ('019a1f00-0000-7000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, $1::uuid, $2, $3, $4, 1, $5::uuid, 'bulk ' || g, now() - g * interval '1 second'
     FROM generate_series(1, 10000) g`,
    [SEAT_A.scope_id, SEAT_A.principal_id, SEAT_A.seat_id, SEAT_A.binding_id, ACTIVE_STATUS_ID],
  );
  await admin(
    FULL,
    "INSERT INTO kusabi.decision_tag (id, scope_id, decision_id, tag_text) SELECT ('019a2f00-0000-7000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, $1::uuid, ('019a1f00-0000-7000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'bulk' FROM generate_series(1, 10000) g",
    [SEAT_A.scope_id],
  );
  await admin(FULL, "ANALYZE kusabi.decision");
  await admin(FULL, "ANALYZE kusabi.decision_tag");
  const store = storeFor("kx_login");
  const p95 = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
  const timed = async (work: () => Promise<{ ok: boolean }>): Promise<number> => {
    const start = performance.now();
    assert.ok((await work()).ok);
    return performance.now() - start;
  };
  const writes: number[] = [];
  const reads: number[] = [];
  for (let i = 0; i < 100; i += 1) writes.push(await timed(() => store.logDecision({ decisionId: uuidv7(), decision: `timed ${i}`, tags: [{ id: uuidv7(), text: "timed" }] })));
  for (let i = 0; i < 100; i += 1) reads.push(await timed(() => (i % 2 ? store.getDecisions({ limit: 20 }) : store.recoverDecisions({ limit: 20 }))));
  console.log(`speed: write p95 ${p95(writes).toFixed(1)} ms, read p95 ${p95(reads).toFixed(1)} ms (limit 500 ms)`);
  assert.ok(p95(writes) <= 500 && p95(reads) <= 500);
});

let passed = 0;
try {
  for (const [name, work] of cases) {
    try {
      await work();
      passed += 1;
      console.log(`ok - ${name}`);
    } catch (error) {
      console.error(`not ok - ${name}`);
      console.error(error);
      process.exitCode = 1;
    }
  }
} finally {
  stopServer();
  const files = (dir: string): number => readdirSync(dir).reduce((n, name) => (statSync(join(dir, name)).isDirectory() ? n + files(join(dir, name)) : n + 1), 0);
  const removed = `server data directory (${files(dataDir)} files), server log (${existsSync(logFile) ? 1 : 0} file), migration copies (${files(copies)} files)`;
  rmSync(scratch.dir, { recursive: true, force: true });
  const reachable = await new Promise<boolean>((resolve) => {
    const socket = new pg.Client({ host: "127.0.0.1", port, user: "postgres", database: "postgres" });
    socket.on("error", () => undefined);
    socket.connect().then(() => socket.end().then(() => resolve(true)), () => resolve(false));
  });
  console.log(`removed: ${removed}; scratch exists: ${existsSync(scratch.dir)}; server still answering: ${reachable}`);
  if (existsSync(scratch.dir) || reachable) process.exitCode = 1;
}
console.log(process.exitCode === 1 ? `common-seat-pg: failed (${passed} of ${cases.length} checks passed)` : `common-seat-pg: ${passed} checks passed`);
