/**
 * Placement of the common-infrastructure form (u1-seat-memory-skeleton, PR-1; BR1.1-BR1.3, DL-1, DL-2, DL-3a, Q-V1,
 * S4): which environment names enter the form, where the place is read from, what a missing or wrong seat setting
 * is called, that nothing prints a raw value, and what the verification's arguments hold.
 * The first import sets a throwaway home before any store module is loaded.
 */
import "./test-isolated-home.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { fileURLToPath } from "node:url";
import { COMMON_CONTRACT, COMMON_LIMITS, buildVerifyArguments, commonForm, resolveCommonPlacement, SeatSetting } from "./common-placement.js";
import { PLACEMENT_UNSET_NOTE, type SeatFailure } from "./common-seat-errors.js";
import { decideStore, STORE_ENV_VARS, type StoreConfigRead } from "./store-resolution.js";
import { SECRET_PASSWORD, SEAT_A, SYNTHETIC_URL, settingFor } from "./test-common-seat-support.js";

const COMMON = { AGENT_MEMORY_MODE: "common", AGENT_MEMORY_DATABASE_URL: SYNTHETIC_URL };
const CONFIG_URL = "postgres://config_user:CONFIG-PW-77@127.0.0.1:2/memory";
const present = (content: unknown): (() => StoreConfigRead) => () => ({ status: "read", content });

const failureOf = (value: unknown): SeatFailure => {
  const result = value as SeatFailure;
  assert.equal(result.ok, false, "a failure was expected");
  return result;
};
const placementOf = (value: unknown) => {
  const result = value as { ok: boolean; target: { reveal(): string }; source: string; seat: SeatSetting };
  assert.equal(result.ok, true, "a placement was expected");
  return result;
};

const cases: Array<[string, () => void]> = [];

cases.push(["commonForm: only AGENT_MEMORY_MODE=common enters the form; none and standalone keep the existing path", () => {
  assert.equal(commonForm({}), "standalone");
  assert.equal(commonForm({ AGENT_MEMORY_MODE: "" }), "standalone");
  assert.equal(commonForm({ AGENT_MEMORY_MODE: "standalone" }), "standalone");
  assert.equal(commonForm({ AGENT_MEMORY_MODE: "common" }), "common");
  const unknown = failureOf(commonForm({ AGENT_MEMORY_MODE: "Common" }));
  assert.equal(unknown.name, "invalid_input");
}]);

cases.push(["placement: the environment URL is the place, the seat is read from the user config, the config is read once", () => {
  let reads = 0;
  const placement = placementOf(resolveCommonPlacement(COMMON, () => ((reads += 1), { status: "read", content: settingFor(SEAT_A) })));
  assert.equal(placement.source, "environment");
  assert.equal(placement.target.reveal(), SYNTHETIC_URL);
  assert.deepEqual(placement.seat.reveal(), SEAT_A);
  assert.equal(reads, 1);
}]);

cases.push(["placement: with no environment URL the user config's database_url is the place (read once)", () => {
  let reads = 0;
  const content = { ...settingFor(SEAT_A), database_url: CONFIG_URL };
  const placement = placementOf(resolveCommonPlacement({ AGENT_MEMORY_MODE: "common" }, () => ((reads += 1), { status: "read", content })));
  assert.equal(placement.source, "user_config");
  assert.equal(placement.target.reveal(), CONFIG_URL);
  assert.equal(reads, 1);
}]);

cases.push(["placement: no place, or only the generic DATABASE_URL, is placement_unset and never a local store", () => {
  const unset = failureOf(resolveCommonPlacement({ AGENT_MEMORY_MODE: "common" }, present(settingFor(SEAT_A))));
  assert.equal(unset.name, "placement_unset");
  assert.equal(unset.note, PLACEMENT_UNSET_NOTE);
  assert.equal(failureOf(resolveCommonPlacement({ AGENT_MEMORY_MODE: "common" }, () => ({ status: "absent" }))).name, "placement_unset");
  const generic = failureOf(resolveCommonPlacement({ AGENT_MEMORY_MODE: "common", DATABASE_URL: SYNTHETIC_URL }, present(settingFor(SEAT_A))));
  assert.equal(generic.name, "placement_unset");
  assert.equal(generic.cause, "placement");
}]);

cases.push(["placement: STORE_ENV_VARS names the two variables decideStore reads first (the common form builds its environment from them)", () => {
  const absent = (): StoreConfigRead => ({ status: "absent" });
  const local = decideStore({ [STORE_ENV_VARS.backend]: "sqlite" }, absent);
  assert.ok(local.ok && local.resolution.backend === "sqlite" && local.resolution.source === "environment");
  const both = decideStore({ [STORE_ENV_VARS.url]: SYNTHETIC_URL, DATABASE_URL: CONFIG_URL }, absent);
  assert.ok(both.ok && both.resolution.backend === "postgres" && both.resolution.target.reveal() === SYNTHETIC_URL);
}]);

cases.push(["placement: AGENT_MEMORY_DB_TYPE=sqlite or json does not move the common form to a local store", () => {
  for (const type of ["sqlite", "json"]) {
    const placement = placementOf(resolveCommonPlacement({ ...COMMON, AGENT_MEMORY_DB_TYPE: type }, present(settingFor(SEAT_A))));
    assert.equal(placement.target.reveal(), SYNTHETIC_URL);
  }
}]);

cases.push(["placement: a URL of the wrong shape is invalid_input, from the environment and from the config", () => {
  assert.equal(failureOf(resolveCommonPlacement({ AGENT_MEMORY_MODE: "common", AGENT_MEMORY_DATABASE_URL: "mysql://x" }, present(settingFor(SEAT_A)))).name, "invalid_input");
  const content = { ...settingFor(SEAT_A), database_url: "not a url" };
  assert.equal(failureOf(resolveCommonPlacement({ AGENT_MEMORY_MODE: "common" }, present(content))).name, "invalid_input");
}]);

cases.push(["seat setting: absent is seat_not_registered; unreadable is placement_unreachable; not an object is invalid_input", () => {
  assert.equal(failureOf(resolveCommonPlacement(COMMON, () => ({ status: "absent" }))).name, "seat_not_registered");
  assert.equal(failureOf(resolveCommonPlacement(COMMON, present({}))).name, "seat_not_registered");
  for (const reason of ["config_read", "config_kind"] as const) {
    assert.equal(failureOf(resolveCommonPlacement(COMMON, () => ({ status: "unreadable", reason }))).name, "placement_unreachable");
  }
  assert.equal(failureOf(resolveCommonPlacement(COMMON, () => ({ status: "unreadable", reason: "config_content" }))).name, "invalid_input");
  for (const content of [[], null, "text", 7]) {
    assert.equal(failureOf(resolveCommonPlacement(COMMON, present(content))).name, "invalid_input");
  }
}]);

cases.push(["seat setting: a wrong type, an unknown key, a missing key, an empty value or a fraction is invalid_input", () => {
  const wrong: unknown[] = [
    { ...SEAT_A, principal_revision: "1" },
    { ...SEAT_A, extra: "x" },
    { ...SEAT_A, seat_id: "" },
    { ...SEAT_A, binding_generation: 1.5 },
    { ...SEAT_A, db_epoch: null },
    "text",
    [],
  ];
  for (const value of wrong) assert.equal(failureOf(resolveCommonPlacement(COMMON, present({ common_seat: value }))).name, "invalid_input");
  const { installation_id: _gone, ...missing } = SEAT_A;
  assert.equal(failureOf(resolveCommonPlacement(COMMON, present({ common_seat: missing }))).name, "invalid_input");
}]);

cases.push(["no raw value: placements and failures print a fixed word, never the URL, the password or an id", () => {
  const placement = placementOf(resolveCommonPlacement(COMMON, present(settingFor(SEAT_A))));
  for (const shown of [String(placement.target), JSON.stringify(placement), inspect(placement), String(placement.seat), JSON.stringify(placement.seat), inspect(placement.seat)]) {
    assert.ok(!shown.includes(SECRET_PASSWORD) && !shown.includes(SEAT_A.seat_id) && !shown.includes(SEAT_A.scope_id), shown);
  }
  assert.equal(String(placement.seat), "[seat-setting]");
  assert.equal(String(placement.target), "[store-target]");
  const bad = resolveCommonPlacement(COMMON, present({ common_seat: { ...SEAT_A, seat_id: `SECRET-${SEAT_A.seat_id}`, extra: 1 } }));
  assert.ok(!JSON.stringify(bad).includes("SECRET-"));
  const unset = resolveCommonPlacement({ AGENT_MEMORY_MODE: "common", DATABASE_URL: SYNTHETIC_URL }, present(settingFor(SEAT_A)));
  assert.ok(!JSON.stringify(unset).includes(SECRET_PASSWORD));
}]);

const REMOTE = "postgres://seat_user:PW-REMOTE-91c2@db.example.invalid:5432/memory";
const CA = "sslrootcert=/etc/synthetic/ca.pem";
const withUrl = (url: string) => resolveCommonPlacement({ AGENT_MEMORY_MODE: "common", AGENT_MEMORY_DATABASE_URL: url }, present(settingFor(SEAT_A)));
const refusedForTls = (url: string, note: string): void => {
  const result = failureOf(withUrl(url));
  assert.equal(result.name, "invalid_input", note);
  assert.equal(result.cause, "placement", note);
  assert.equal(result.code, "tls_not_verified", note);
  const shown = JSON.stringify(result);
  for (const secret of ["PW-REMOTE-91c2", "db.example.invalid", "seat_user", "/etc/synthetic"]) assert.ok(!shown.includes(secret), `${note}: the failure shows ${secret}`);
};

const accepted = (url: string, note: string): void => {
  assert.equal(placementOf(withUrl(url)).target.reveal(), url, note);
};

cases.push(["DV-3: a place that is not on this machine is refused unless the server is verified (no mode, require, verify-ca)", () => {
  refusedForTls(REMOTE, "no sslmode");
  refusedForTls(`${REMOTE}?sslmode=require`, "require");
  refusedForTls(`${REMOTE}?sslmode=require&${CA}`, "require with a CA");
  refusedForTls(`${REMOTE}?sslmode=verify-ca&${CA}`, "verify-ca");
  refusedForTls(`${REMOTE}?sslmode=prefer`, "prefer");
  refusedForTls(`${REMOTE}?sslmode=disable`, "disable");
}]);

cases.push(["DV-3: verify-full needs the CA named too; verify-full with a CA is the only way a remote place passes", () => {
  refusedForTls(`${REMOTE}?sslmode=verify-full`, "verify-full without a CA");
  refusedForTls(`${REMOTE}?sslmode=verify-full&sslrootcert=`, "verify-full with an empty CA");
  const placed = placementOf(withUrl(`${REMOTE}?sslmode=verify-full&${CA}`));
  assert.equal(placed.target.reveal(), `${REMOTE}?sslmode=verify-full&${CA}`);
  assert.equal(placed.source, "environment");
}]);

cases.push(["DV-3: the check reads the URL the way the driver does (the last repeated setting wins, a host setting moves the place)", () => {
  refusedForTls(`${REMOTE}?sslmode=verify-full&${CA}&sslmode=disable`, "a later sslmode");
  refusedForTls(`${REMOTE}?sslmode=verify-full&${CA}&sslrootcert=`, "a later empty CA");
  refusedForTls("postgres://seat_user:PW-REMOTE-91c2@localhost:5432/memory?host=db.example.invalid", "a host setting over localhost");
  refusedForTls("postgres://seat_user:PW-REMOTE-91c2@127.0.0.1:5432/memory?host=db.example.invalid&sslmode=require", "a host setting over 127.0.0.1");
  accepted("postgres://seat_user@db.example.invalid:5432/memory?host=localhost", "a host setting that points home");
}]);

cases.push(["DV-3: the place on this machine needs no TLS (127.0.0.1, ::1, localhost, a Unix socket in either spelling)", () => {
  for (const url of [
    "postgres://seat_user:PW@127.0.0.1:5432/memory",
    "postgres://seat_user:PW@[::1]:5432/memory",
    "postgres://seat_user:PW@localhost:5432/memory",
    "postgresql://seat_user:PW@localhost/memory",
    "postgres://seat_user:PW@localhost:5432/memory?sslmode=disable",
    "postgres://seat_user:PW@localhost/memory?host=%2Fvar%2Frun%2Fsynthetic",
    "postgres://seat_user:PW@/memory?host=/var/run/synthetic",
    "postgres://%2Fvar%2Frun%2Fsynthetic/memory",
  ]) accepted(url, url.replace(/:PW@/, ":***@"));
}]);

cases.push(["DV-3: a place that names no host, or that does not parse, is refused (it is not known to be this machine)", () => {
  refusedForTls("postgres:///memory", "no host");
  refusedForTls("postgres://seat_user:PW-REMOTE-91c2@localhost.invalid:5432/memory", "a host that only starts like localhost");
  refusedForTls("postgres://seat_user:PW-REMOTE-91c2@127.0.0.2:5432/memory", "another loopback address");
  refusedForTls("postgres://seat_user:PW-REMOTE-91c2@[db.example.invalid:5432/memory", "a URL that does not parse");
}]);

cases.push(["DV-3: the refusal is the same from the user config, and a refused place never reaches a seat check", () => {
  const content = { ...settingFor(SEAT_A), database_url: REMOTE };
  const fromConfig = failureOf(resolveCommonPlacement({ AGENT_MEMORY_MODE: "common" }, present(content)));
  assert.equal(fromConfig.code, "tls_not_verified");
  const noSeat = failureOf(resolveCommonPlacement({ AGENT_MEMORY_MODE: "common", AGENT_MEMORY_DATABASE_URL: REMOTE }, () => ({ status: "absent" })));
  assert.equal(noSeat.code, "tls_not_verified");
}]);

cases.push(["verification arguments: the call's product, contract, expected place, deadline, budget and expected actor", () => {
  const placement = placementOf(resolveCommonPlacement(COMMON, present(settingFor(SEAT_A))));
  const now = 1_800_000_000_123.9;
  const args = buildVerifyArguments(placement.seat, now, COMMON_LIMITS.readMs);
  const context = JSON.parse(args.context);
  assert.deepEqual(context, {
    product: "kusabi",
    required_contract: COMMON_CONTRACT,
    expected_installation_id: SEAT_A.installation_id,
    expected_db_epoch: SEAT_A.db_epoch,
    deadline_ms: 1_800_000_000_123 + COMMON_LIMITS.readMs,
    budget: { remaining_ms: COMMON_LIMITS.readMs, remaining_queries: COMMON_LIMITS.verifyQueryBudget },
  });
  assert.ok(COMMON_LIMITS.verifyQueryBudget > 0);
  assert.equal(args.scopeId, SEAT_A.scope_id);
  assert.deepEqual(JSON.parse(args.expectedActor), { contract_version: COMMON_CONTRACT, ...SEAT_A, observed_at_ms: 1_800_000_000_123 });
}]);

cases.push(["limits: one table, frozen, every time limit above zero and the start-up limit above the tool limits", () => {
  assert.ok(Object.isFrozen(COMMON_LIMITS));
  for (const value of Object.values(COMMON_LIMITS)) assert.ok(Number.isInteger(value) && value > 0);
  assert.ok(COMMON_LIMITS.startupMs > COMMON_LIMITS.toolMs && COMMON_LIMITS.toolMs > COMMON_LIMITS.readMs);
  assert.ok(COMMON_LIMITS.lockMs < COMMON_LIMITS.readMs, "DV-2: the wait for a lock ends before the read limit does");
}]);

cases.push(["S4: the core modules never read the clock, the random source or an id generator themselves", () => {
  for (const file of ["common-placement.ts", "common-seat-errors.ts", "common-seat-store.ts"]) {
    const source = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
    for (const banned of [/Date\.now/, /new Date\(\)/, /Math\.random/, /randomUUID/, /randomBytes/, /from "uuid"/, /process\.env/]) {
      assert.ok(!banned.test(source), `${file} must not contain ${banned}`);
    }
  }
}]);

let passed = 0;
for (const [name, run] of cases) {
  try {
    run();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}
console.log(process.exitCode === 1 ? `common-placement: ${cases.length - passed} of ${cases.length} checks failed` : `common-placement: ${passed} checks passed`);
