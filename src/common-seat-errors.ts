/**
 * The failure names of the common-infrastructure form (u1-seat-memory-skeleton, BR2.5, DL-4). This is the one place
 * that holds them and the table that maps what the database, the driver and the store-resolution core report onto
 * them; no other module spells a mapping. A reason that has no row is returned as a failure without a name, never as a
 * success (S5, S8). A failure carries the kind of the error and a short code only, never the driver's text, a value or
 * a URL (NFR1.1, NFR8.3).
 */
import { STORE_ENV_VARS, type StoreRefusalReason } from "./store-resolution.js";

export const SEAT_ERROR_NAMES = [
  "seat_not_registered",
  "no_membership",
  "binding_closed",
  "not_initialized",
  "placement_unreachable",
  "placement_unset",
  "invalid_input",
  "not_yet_available",
] as const;
export type SeatErrorName = (typeof SEAT_ERROR_NAMES)[number];

export type FailureCause =
  | "refused"
  | "unmapped"
  | "bad_response"
  | "connect_failed"
  | "connect_timed_out"
  | "timed_out"
  | "response_lost"
  | "placement"
  | "setting"
  | "input";

export interface SeatFailure {
  readonly ok: false;
  /** The Kusabi name, or null for a failure the table does not name (still a failure). */
  readonly name: SeatErrorName | null;
  readonly cause: FailureCause;
  /** A SQLSTATE or a driver code (letters, digits, underscore). */
  readonly code?: string;
  readonly note?: string;
}

export const RESPONSE_LOST_NOTE =
  "sent, but it is unknown whether it was written; confirm with get_decisions before resending";

/** BR1.3: a common form with no place stops and names the setting (the name comes from the one resolver, S3); a fixed text, never a value. */
export const PLACEMENT_UNSET_NOTE = `no place is set; set ${STORE_ENV_VARS.url}`;

export function failure(name: SeatErrorName | null, cause: FailureCause, code?: string, note?: string): SeatFailure {
  return { ok: false, name, cause, ...(code ? { code } : {}), ...(note ? { note } : {}) };
}

/** What the verification raises: SQLSTATE and the reason in its message `onza-common:<reason>`. */
const COMMON_REASONS: ReadonlyArray<readonly [state: string, reason: string, name: SeatErrorName]> = [
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

/** What the Kusabi functions raise: the message is `kusabi:<name>` (db-design-record 2.5, D-8). */
const KUSABI_REASONS: ReadonlyArray<readonly [state: string, name: SeatErrorName]> = [
  ["28000", "seat_not_registered"],
  ["28000", "binding_closed"],
  ["22023", "invalid_input"],
];

/**
 * Rules by SQLSTATE alone. A check constraint's own message is not pinned (the limits belong to the database's CHECK
 * constraints, so a breach is an invalid input; db-design-record section 10, option a). A missing schema or function
 * means the places are not installed; the connection classes and a cancelled statement mean the place did not answer.
 */
const STATE_RULES: ReadonlyArray<{ readonly test: (state: string) => boolean; readonly name: SeatErrorName; readonly cause: FailureCause }> = [
  { test: (s) => s === "23514", name: "invalid_input", cause: "refused" },
  { test: (s) => s === "3F000" || s === "42883", name: "not_initialized", cause: "refused" },
  { test: (s) => s === "57014", name: "placement_unreachable", cause: "timed_out" },
  { test: (s) => s.startsWith("08") || s === "57P01" || s === "57P02" || s === "57P03" || s === "53300", name: "placement_unreachable", cause: "connect_failed" },
];

/** The reasons the store-resolution core refuses with, written onto the failure names (DL-4, fixed in Step 4). */
const STORE_REFUSALS: Readonly<Record<StoreRefusalReason, SeatErrorName>> = {
  target_missing: "placement_unset",
  unknown_db_type: "invalid_input",
  env_url_shape: "invalid_input",
  config_content: "invalid_input",
  config_kind: "placement_unreachable",
  config_read: "placement_unreachable",
};

export const mapStoreRefusal = (reason: StoreRefusalReason): SeatFailure => {
  const name = STORE_REFUSALS[reason];
  return failure(name, "placement", reason, name === "placement_unset" ? PLACEMENT_UNSET_NOTE : undefined);
};

const read = (error: unknown, key: "code" | "message"): string | undefined => {
  const value = typeof error === "object" && error !== null ? (error as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" ? value : undefined;
};

/**
 * The SQLSTATE of an error from the database, or undefined for an error that did not come from it. A SQLSTATE has
 * five characters with a digit in them; a five-letter system error such as EPIPE is not one.
 */
export function sqlState(error: unknown): string | undefined {
  const code = read(error, "code");
  return code !== undefined && /^(?=.*[0-9])[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

/** A code safe to show: the SQLSTATE or a driver code, never the driver's text. */
export function failureCode(error: unknown): string | undefined {
  const code = read(error, "code");
  return code !== undefined && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : undefined;
}

/**
 * Maps an error that carries a SQLSTATE; null for an error that does not (a lost connection, a timer). A pair or a
 * rule that is not in the table gives a failure without a name.
 */
export function mapDatabaseError(error: unknown): SeatFailure | null {
  const state = sqlState(error);
  if (state === undefined) return null;
  const message = read(error, "message");
  const common = COMMON_REASONS.find(([s, reason]) => s === state && message === `onza-common:${reason}`);
  if (common) return failure(common[2], "refused", state);
  const own = KUSABI_REASONS.find(([s, name]) => s === state && message === `kusabi:${name}`);
  if (own) return failure(own[1], "refused", state);
  const rule = STATE_RULES.find((r) => r.test(state));
  return rule ? failure(rule.name, rule.cause, state) : failure(null, "unmapped", state);
}
