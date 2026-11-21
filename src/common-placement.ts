/**
 * Where the common-infrastructure form keeps a seat's memory, and who the seat says it is (u1-seat-memory-skeleton,
 * BR1.1-BR1.3, DL-1, DL-2, DL-3a, Q-V1). Only `AGENT_MEMORY_MODE=common` enters this form; with no mode, or
 * `standalone`, the existing `decideStore` decides and nothing here runs (BR6.1). The place is read from the
 * environment's `AGENT_MEMORY_DATABASE_URL`, then the user config's `database_url`; the generic `DATABASE_URL` and
 * `AGENT_MEMORY_DB_TYPE` are never read, and no place means `placement_unset`, never SQLite or JSON. The seat's own
 * setting (the `common_seat` field of the user config, not the environment and not a tool argument) is an opaque
 * value: it prints as a fixed word and only `reveal()` returns its fields.
 *
 * The core takes the environment and a reader of the user config and reads neither the clock, the random source nor
 * the process environment (S4); the clock arrives as an argument of `buildVerifyArguments`. The check of a URL's shape
 * and the read of the config are `decideStore`'s own (one decision, not a second one: DL-2, deviation D1).
 */
import { inspect } from "node:util";
import { z } from "zod";
import { failure, mapStoreRefusal, mapTransportRefusal, type SeatFailure } from "./common-seat-errors.js";
import { decideStore, STORE_ENV_VARS, type StoreConfigRead, type StoreResolution, type StoreTarget } from "./store-resolution.js";

export const COMMON_CONTRACT = "onza-common/0.2.0-draft.1" as const;
export const COMMON_PRODUCT = "kusabi" as const;

export interface CommonLimits {
  readonly connectMs: number;
  readonly readMs: number;
  readonly toolMs: number;
  readonly startupMs: number;
  readonly closeMs: number;
  /** The longest a statement waits for a lock inside the transaction (u2 NFR5.8, DV-2). */
  readonly lockMs: number;
  readonly verifyQueryBudget: number;
}

/** Every time limit and budget of the form, in one place (NFR4.1-NFR4.3, NFR5.2). Exceeding one is a failure. */
export const COMMON_LIMITS: CommonLimits = Object.freeze({
  connectMs: 2000,
  /** The verification and a read (get_decisions, recover_decisions). */
  readMs: 3000,
  /** The whole database processing of one tool call that writes. */
  toolMs: 5000,
  /** The whole start-up recovery of a session-start entry. */
  startupMs: 7000,
  /** The wait for a rollback and for closing a connection after a failure. */
  closeMs: 1000,
  /** The wait for a lock; it ends before the read limit so a blocked call is a failure the caller can act on. */
  lockMs: 1000,
  /** The query budget declared to the verification; it is only required to be above zero. */
  verifyQueryBudget: 4,
});

export function commonForm(env: NodeJS.ProcessEnv): "standalone" | "common" | SeatFailure {
  const mode = env.AGENT_MEMORY_MODE;
  if (mode === undefined || mode === "" || mode === "standalone") return "standalone";
  return mode === "common" ? "common" : failure("invalid_input", "setting");
}

const text = z.string().min(1);
const count = z.number().int();
const seatValues = z
  .object({
    installation_id: text,
    db_epoch: text,
    scope_id: text,
    principal_id: text,
    principal_revision: count,
    membership_revision: count,
    seat_id: text,
    binding_id: text,
    binding_generation: count,
  })
  .strict();
export type SeatValues = z.infer<typeof seatValues>;

const SEAT_VALUES = new WeakMap<SeatSetting, SeatValues>();

/** The seat's own setting. It prints, stringifies and serializes as a fixed word (NFR8.3). */
export class SeatSetting {
  constructor(values: SeatValues) {
    SEAT_VALUES.set(this, values);
  }

  reveal(): SeatValues {
    return SEAT_VALUES.get(this) as SeatValues;
  }

  toString(): string {
    return "[seat-setting]";
  }

  toJSON(): string {
    return "[seat-setting]";
  }

  [inspect.custom](): string {
    return "[seat-setting]";
  }
}

export interface CommonPlacement {
  readonly ok: true;
  readonly target: StoreTarget;
  readonly source: "environment" | "user_config";
  readonly seat: SeatSetting;
}

function once(read: () => StoreConfigRead): () => StoreConfigRead {
  let value: StoreConfigRead | undefined;
  return () => (value ??= read());
}

/** The seat setting from what the config read gave: absent is an unregistered seat, a wrong shape an invalid input. */
function readSeatSetting(read: StoreConfigRead): SeatSetting | SeatFailure {
  if (read.status === "unreadable") return mapStoreRefusal(read.reason);
  if (read.status === "absent") return failure("seat_not_registered", "setting");
  if (read.content === null || typeof read.content !== "object" || Array.isArray(read.content)) {
    return mapStoreRefusal("config_content");
  }
  const field = (read.content as Record<string, unknown>).common_seat;
  if (field === undefined) return failure("seat_not_registered", "setting");
  const parsed = seatValues.safeParse(field);
  return parsed.success ? new SeatSetting(parsed.data) : failure("invalid_input", "setting");
}

const SAME_MACHINE = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/** The URL as the driver reads it: a setting repeated takes its last value, and an empty host in front of the path is an unnamed host. */
function readPlaceUrl(address: string): { settings: ReadonlyMap<string, string>; host: string } | null {
  let url: URL;
  let unnamed = false;
  try {
    url = new URL(address);
  } catch {
    try {
      url = new URL(address.replace("@/", "@___DUMMY___/"));
      unnamed = true;
    } catch {
      return null;
    }
  }
  const settings = new Map<string, string>();
  for (const [key, value] of url.searchParams) settings.set(key, value);
  try {
    return { settings, host: settings.get("host") || (unnamed ? "" : decodeURIComponent(url.hostname)) };
  } catch {
    return null;
  }
}

/**
 * NFR8.1, DV-3: a place on this machine (127.0.0.1, ::1, localhost, a Unix socket) needs no TLS. Any other place must
 * verify the server (`sslmode=verify-full`) against a named CA. A place that names no host, or whose URL does not
 * parse, is not known to be this machine, so it has to verify too (fail closed). This runs before any connection.
 */
function serverVerified(address: string): boolean {
  const place = readPlaceUrl(address);
  if (place === null) return false;
  if (SAME_MACHINE.has(place.host) || place.host.startsWith("/")) return true;
  return place.settings.get("sslmode") === "verify-full" && (place.settings.get("sslrootcert") ?? "") !== "";
}

/** For the common form only: the place, then the seat. Nothing here connects. */
export function resolveCommonPlacement(env: NodeJS.ProcessEnv, readConfig: () => StoreConfigRead): CommonPlacement | SeatFailure {
  const read = once(readConfig);
  const decided = decideStore({ [STORE_ENV_VARS.backend]: "postgres", [STORE_ENV_VARS.url]: env[STORE_ENV_VARS.url] }, read);
  if (!decided.ok) return mapStoreRefusal(decided.reason);
  const place = decided.resolution as Extract<StoreResolution, { backend: "postgres" }>;
  if (!serverVerified(place.target.reveal())) return mapTransportRefusal();
  const seat = readSeatSetting(read());
  if (!(seat instanceof SeatSetting)) return seat;
  return { ok: true, target: place.target, source: place.source === "environment" ? "environment" : "user_config", seat };
}

export interface VerifyArguments {
  readonly context: string;
  readonly scopeId: string;
  readonly expectedActor: string;
}

/** The first three arguments of a Kusabi function (the verification's context, scope and expected actor), as JSON text. */
export function buildVerifyArguments(seat: SeatSetting, nowMs: number, limitMs: number): VerifyArguments {
  const values = seat.reveal();
  const observed = Math.trunc(nowMs);
  return {
    context: JSON.stringify({
      product: COMMON_PRODUCT,
      required_contract: COMMON_CONTRACT,
      expected_installation_id: values.installation_id,
      expected_db_epoch: values.db_epoch,
      deadline_ms: observed + limitMs,
      budget: { remaining_ms: limitMs, remaining_queries: COMMON_LIMITS.verifyQueryBudget },
    }),
    scopeId: values.scope_id,
    expectedActor: JSON.stringify({
      contract_version: COMMON_CONTRACT,
      installation_id: values.installation_id,
      db_epoch: values.db_epoch,
      scope_id: values.scope_id,
      principal_id: values.principal_id,
      principal_revision: values.principal_revision,
      membership_revision: values.membership_revision,
      observed_at_ms: observed,
      seat_id: values.seat_id,
      binding_id: values.binding_id,
      binding_generation: values.binding_generation,
    }),
  };
}
