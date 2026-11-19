/**
 * The failure-name table (u1-seat-memory-skeleton, PR-1; BR2.5, DL-4, D-8, T-8): every reason the verification and the
 * Kusabi functions raise, every refusal of the store-resolution core, and every database or driver error that has no
 * row, written onto a name - and that nothing else in the product spells the mapping. A reason with no row is a
 * failure without a name, never a success; no failure carries driver text.
 */
import "./test-isolated-home.js";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PLACEMENT_UNSET_NOTE,
  RESPONSE_LOST_NOTE,
  SEAT_ERROR_NAMES,
  failure,
  failureCode,
  mapDatabaseError,
  mapStoreRefusal,
  sqlState,
  type SeatErrorName,
} from "./common-seat-errors.js";
import { STORE_ENV_VARS, type StoreRefusalReason } from "./store-resolution.js";
import { dbError } from "./test-common-seat-support.js";

const COMMON: Array<[string, string, SeatErrorName]> = [
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

const cases: Array<[string, () => void]> = [];

cases.push(["the names: eight, distinct, and the ones the design names", () => {
  assert.equal(SEAT_ERROR_NAMES.length, 8);
  assert.equal(new Set(SEAT_ERROR_NAMES).size, 8);
  for (const name of ["seat_not_registered", "no_membership", "binding_closed", "not_initialized", "placement_unreachable", "placement_unset", "invalid_input", "not_yet_available"]) {
    assert.ok((SEAT_ERROR_NAMES as readonly string[]).includes(name), name);
  }
}]);

cases.push(["the verification's eleven reasons map as the table says, each as a SQLSTATE and message pair", () => {
  for (const [state, reason, name] of COMMON) {
    const mapped = mapDatabaseError(dbError(state, `onza-common:${reason}`));
    assert.deepEqual(mapped, { ok: false, name, cause: "refused", code: state }, state);
  }
}]);

cases.push(["a pair that does not match is not mapped: wrong message, wrong state, empty message", () => {
  for (const error of [dbError("OC004", "onza-common:forbidden"), dbError("OC999", "onza-common:not_found"), dbError("OC004", ""), dbError("OC004", "kusabi:seat_not_registered")]) {
    const mapped = mapDatabaseError(error);
    assert.equal(mapped?.name, null);
    assert.equal(mapped?.cause, "unmapped");
  }
}]);

cases.push(["D-8: the Kusabi functions' own pairs map; the same SQLSTATE with another message does not", () => {
  assert.equal(mapDatabaseError(dbError("28000", "kusabi:seat_not_registered"))?.name, "seat_not_registered");
  assert.equal(mapDatabaseError(dbError("28000", "kusabi:binding_closed"))?.name, "binding_closed");
  assert.equal(mapDatabaseError(dbError("22023", "kusabi:invalid_input"))?.name, "invalid_input");
  for (const error of [dbError("28000", "something else"), dbError("22023", "kusabi:seat_not_registered"), dbError("28000", "kusabi:invalid_input")]) {
    assert.equal(mapDatabaseError(error)?.name, null);
  }
}]);

cases.push(["state-only rules: a check violation is invalid_input; a missing schema or function is not_initialized", () => {
  assert.equal(mapDatabaseError(dbError("23514", "new row violates check constraint"))?.name, "invalid_input");
  assert.equal(mapDatabaseError(dbError("3F000", "schema does not exist"))?.name, "not_initialized");
  assert.equal(mapDatabaseError(dbError("42883", "function does not exist"))?.name, "not_initialized");
}]);

cases.push(["the place did not answer: the connection classes, a shutdown and a cancelled statement are placement_unreachable", () => {
  for (const state of ["08000", "08006", "08P01", "57P01", "57P02", "57P03", "53300"]) {
    const mapped = mapDatabaseError(dbError(state, "gone"));
    assert.equal(mapped?.name, "placement_unreachable", state);
    assert.equal(mapped?.cause, "connect_failed", state);
  }
  const cancelled = mapDatabaseError(dbError("57014", "canceling statement due to statement timeout"));
  assert.equal(cancelled?.name, "placement_unreachable");
  assert.equal(cancelled?.cause, "timed_out");
}]);

cases.push(["a SQLSTATE with no row is a failure without a name, never a success", () => {
  for (const state of ["42501", "23505", "22P02", "23502", "55000", "40001", "XX000"]) {
    const mapped = mapDatabaseError(dbError(state, "driver text"));
    assert.ok(mapped);
    assert.equal(mapped.ok, false);
    assert.equal(mapped.name, null);
    assert.equal(mapped.cause, "unmapped");
    assert.equal(mapped.code, state);
  }
}]);

cases.push(["an error that is not from the database (no SQLSTATE) is left to the caller: null", () => {
  for (const error of [new Error("x"), Object.assign(new Error("x"), { code: "ECONNRESET" }), Object.assign(new Error("x"), { code: "EPIPE" }), Object.assign(new Error("x"), { code: "EBUSY" }), Object.assign(new Error("x"), { code: 42 }), null, "text", undefined]) {
    assert.equal(mapDatabaseError(error), null);
  }
  assert.equal(sqlState(dbError("OC004", "m")), "OC004");
  assert.equal(sqlState(Object.assign(new Error("x"), { code: "ECONNRESET" })), undefined);
  assert.equal(sqlState(Object.assign(new Error("x"), { code: "EPIPE" })), undefined);
}]);

cases.push(["store refusals: all six reasons have a row", () => {
  const expected: Record<StoreRefusalReason, SeatErrorName> = {
    target_missing: "placement_unset",
    unknown_db_type: "invalid_input",
    env_url_shape: "invalid_input",
    config_content: "invalid_input",
    config_kind: "placement_unreachable",
    config_read: "placement_unreachable",
  };
  for (const [reason, name] of Object.entries(expected)) {
    const note = name === "placement_unset" ? { note: PLACEMENT_UNSET_NOTE } : {};
    assert.deepEqual(mapStoreRefusal(reason as StoreRefusalReason), { ok: false, name, cause: "placement", code: reason, ...note });
  }
}]);

cases.push(["BR1.3: a common form with no place names the setting in a fixed text; no other refusal carries a note", () => {
  assert.ok(PLACEMENT_UNSET_NOTE.includes(STORE_ENV_VARS.url));
  assert.ok(!/:\/\/|@/.test(PLACEMENT_UNSET_NOTE), "the note holds no URL");
  assert.equal(mapStoreRefusal("target_missing").note, PLACEMENT_UNSET_NOTE);
  for (const reason of ["unknown_db_type", "env_url_shape", "config_content", "config_kind", "config_read"] as const) {
    assert.equal(mapStoreRefusal(reason).note, undefined);
  }
}]);

cases.push(["a failure shows a short code only: letters, digits and underscore, never driver text", () => {
  assert.equal(failureCode(Object.assign(new Error("x"), { code: "ECONNREFUSED" })), "ECONNREFUSED");
  assert.equal(failureCode(dbError("OC004", "m")), "OC004");
  for (const code of ["password for user failed", "a".repeat(41), "", "ok\nnext", 7, undefined, null]) {
    assert.equal(failureCode(Object.assign(new Error("x"), { code })), undefined);
  }
  assert.equal(failureCode("text"), undefined);
  assert.equal(failureCode(null), undefined);
  const built = failure("invalid_input", "input", "X1", RESPONSE_LOST_NOTE);
  assert.deepEqual(built, { ok: false, name: "invalid_input", cause: "input", code: "X1", note: RESPONSE_LOST_NOTE });
  assert.deepEqual(failure(null, "bad_response"), { ok: false, name: null, cause: "bad_response" });
}]);

cases.push(["single owner: no other product file spells the verification's SQLSTATEs or the message prefixes", () => {
  const folder = fileURLToPath(new URL(".", import.meta.url));
  const owners = new Set(["common-seat-errors.ts"]);
  const holders = readdirSync(folder)
    .filter((name) => name.endsWith(".ts") && !name.startsWith("test") && !owners.has(name))
    .filter((name) => /onza-common:|"OC0[01]\d"|kusabi:seat_not_registered|kusabi:binding_closed/.test(readFileSync(`${folder}${name}`, "utf8")));
  assert.deepEqual(holders, []);
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
console.log(process.exitCode === 1 ? `common-seat-errors: ${cases.length - passed} of ${cases.length} checks failed` : `common-seat-errors: ${passed} checks passed`);
