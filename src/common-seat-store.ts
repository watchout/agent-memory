/**
 * The seat's store in the common-infrastructure form (u1-seat-memory-skeleton, BR1.4-BR1.6, BR2.1-BR2.7, BR3.1,
 * BR3.3): the one window to the database and the three calls a seat makes (write a decision, read decisions, recover
 * decisions). Each call is one short transaction (connect, BEGIN, SET LOCAL statement_timeout, one Kusabi function
 * that verifies the seat and reads or writes, COMMIT), so the check and the write stand or fall together. The window
 * is a narrow interface so tests put a fake behind it; only `createPgSqlClient` knows the driver.
 *
 * It never retries on its own (S7): a write whose answer was lost is reported as "sent, unknown whether written" and
 * the caller reads before resending. It writes nothing anywhere else when the database cannot be reached (BR1.4), and
 * opens a new connection on every call, so a database that comes back needs no restart (BR1.5). It holds no time or
 * random source: the clock and the ids are given (S4). A failure carries a name and a short code, never driver text.
 */
import { Client } from "pg";
import { z } from "zod";
import { COMMON_LIMITS, buildVerifyArguments, type CommonLimits, type SeatSetting, type VerifyArguments } from "./common-placement.js";
import { RESPONSE_LOST_NOTE, failure, failureCode, mapDatabaseError, type SeatFailure } from "./common-seat-errors.js";
import type { StoreTarget } from "./store-resolution.js";

export interface SqlConnection {
  query(text: string, values: readonly unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}
export interface SqlClient {
  connect(timeoutMs: number): Promise<SqlConnection>;
}

export interface PgClientLike {
  on(event: "error", listener: (error: Error) => void): unknown;
  connect(): Promise<unknown>;
  query(text: string, values: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}
export type PgClientCtor = new (config: { connectionString: string; connectionTimeoutMillis: number }) => PgClientLike;

/** The window onto a real PostgreSQL. The driver class is a parameter so a test can put a fake in its place. */
export function createPgSqlClient(target: StoreTarget, ClientCtor: PgClientCtor = Client as unknown as PgClientCtor): SqlClient {
  return {
    async connect(timeoutMs) {
      const client = new ClientCtor({ connectionString: target.reveal(), connectionTimeoutMillis: timeoutMs });
      client.on("error", () => undefined);
      await client.connect();
      return {
        query: async (text, values) => ({ rows: (await client.query(text, [...values])).rows }),
        end: () => client.end(),
      };
    },
  };
}

class LimitExceeded extends Error {}
class BadResponse extends Error {}

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LimitExceeded()), ms);
  });
  return Promise.race([work, clock]).finally(() => clearTimeout(timer));
}

const quiet = (work: Promise<unknown>, ms: number): Promise<void> => within(work, ms).then(() => undefined, () => undefined);

const verifiedSeat = z.object({
  scope_id: z.string(),
  principal_ref: z.string(),
  seat_ref: z.string(),
  binding_ref: z.string(),
  binding_generation: z.number().int(),
});
const decisionRecord = z.object({
  id: z.string(),
  decision_text: z.string(),
  context_text: z.string().nullable(),
  project_name: z.string().nullable(),
  tags: z.array(z.string()),
  status: z.string(),
  created_at_ms: z.number().int(),
});
const logResult = z.object({ decision_id: z.string(), created_at_ms: z.number().int() });
const getResult = z.object({ decisions: z.array(decisionRecord), verified: verifiedSeat });
const recoverResult = getResult.extend({ total_active_count: z.number().int().nonnegative() });
const answer = z.object({ result: z.unknown() });

export type VerifiedSeat = z.infer<typeof verifiedSeat>;
export type DecisionRecord = z.infer<typeof decisionRecord>;

/** Only the shape is checked here; the bounds (lengths, counts, 1..100) belong to the database's own checks. */
const logInput = z.object({
  decisionId: z.uuid(),
  decision: z.string(),
  context: z.string().nullish(),
  project: z.string().nullish(),
  tags: z.array(z.object({ id: z.uuid(), text: z.string() })),
});
const getInput = z.object({ project: z.string().nullish(), tags: z.array(z.string()).optional(), limit: z.number().int() });
const recoverInput = z.object({ limit: z.number().int() });

export type LogDecisionInput = z.input<typeof logInput>;
export type GetDecisionsInput = z.input<typeof getInput>;
export type RecoverDecisionsInput = z.input<typeof recoverInput>;
export type LogDecisionResult = { ok: true; decisionId: string; createdAtMs: number } | SeatFailure;
export type GetDecisionsResult = { ok: true; decisions: DecisionRecord[]; verified: VerifiedSeat } | SeatFailure;
export type RecoverDecisionsResult =
  | { ok: true; decisions: DecisionRecord[]; total_active_count: number; verified: VerifiedSeat }
  | SeatFailure;

export interface CommonSeatStore {
  logDecision(input: LogDecisionInput): Promise<LogDecisionResult>;
  getDecisions(input: GetDecisionsInput): Promise<GetDecisionsResult>;
  recoverDecisions(input: RecoverDecisionsInput): Promise<RecoverDecisionsResult>;
}

export interface CommonSeatStoreOptions {
  readonly client: SqlClient;
  readonly seat: SeatSetting;
  readonly now: () => number;
  /** The time limits; a test passes short ones. The default is the one table in common-placement.ts. */
  readonly limits?: CommonLimits;
}

const LOG_SQL = "SELECT kusabi.log_decision($1::json, $2::text, $3::json, $4::uuid, $5::text, $6::text, $7::text, $8::uuid[], $9::text[]) AS result";
const GET_SQL = "SELECT kusabi.get_decisions($1::json, $2::text, $3::json, $4::text, $5::text[], $6::int) AS result";
const RECOVER_SQL = "SELECT kusabi.recover_decisions($1::json, $2::text, $3::json, $4::int) AS result";

interface CallSpec<T> {
  readonly sql: string;
  readonly limitMs: (limits: CommonLimits) => number;
  readonly write: boolean;
  readonly values: (verify: VerifyArguments) => unknown[];
  readonly parse: (result: unknown) => T | null;
}
type Outcome<T> = { ok: true; value: T } | SeatFailure;

const lost = (code: string | undefined): SeatFailure => failure("placement_unreachable", "response_lost", code, RESPONSE_LOST_NOTE);

/** Writes the failure of a call that got as far as `sent` onto a name. After the send, a write's lost answer is not a refusal. */
function classify(error: unknown, sent: boolean, write: boolean): SeatFailure {
  if (error instanceof BadResponse) return failure(null, "bad_response");
  if (error instanceof LimitExceeded) return sent && write ? lost(undefined) : failure("placement_unreachable", "timed_out");
  const mapped = mapDatabaseError(error);
  if (mapped) return sent && write && mapped.cause === "connect_failed" ? lost(mapped.code) : mapped;
  const code = failureCode(error);
  if (!sent) return failure("placement_unreachable", "connect_failed", code);
  return write ? lost(code) : failure("placement_unreachable", "response_lost", code);
}

async function call<T>(options: CommonSeatStoreOptions, spec: CallSpec<T>): Promise<Outcome<T>> {
  const limits = options.limits ?? COMMON_LIMITS;
  const connecting = (async () => options.client.connect(limits.connectMs))();
  let connection: SqlConnection;
  try {
    connection = await within(connecting, limits.connectMs);
  } catch (error) {
    if (error instanceof LimitExceeded) void connecting.then((late) => quiet(late.end(), limits.closeMs), () => undefined);
    return failure("placement_unreachable", error instanceof LimitExceeded ? "connect_timed_out" : "connect_failed", failureCode(error));
  }
  const limitMs = spec.limitMs(limits);
  let sent = false;
  let over = false;
  const transaction = async (): Promise<T> => {
    const verify = buildVerifyArguments(options.seat, options.now(), limitMs);
    await connection.query("BEGIN", []);
    await connection.query(`SET LOCAL statement_timeout = ${limitMs}`, []);
    sent = true;
    const { rows } = await connection.query(spec.sql, spec.values(verify));
    const row = rows.length === 1 ? answer.safeParse(rows[0]) : null;
    const value = row?.success ? spec.parse(row.data.result) : null;
    if (value === null) throw new BadResponse();
    if (over) throw new LimitExceeded();
    await connection.query("COMMIT", []);
    return value;
  };
  try {
    const value = await within(transaction(), limitMs);
    await quiet(connection.end(), limits.closeMs);
    return { ok: true, value };
  } catch (error) {
    over = true;
    await quiet(connection.query("ROLLBACK", []), limits.closeMs);
    await quiet(connection.end(), limits.closeMs);
    return classify(error, sent, spec.write);
  }
}

const invalid = (): SeatFailure => failure("invalid_input", "input");
const parseWith = <S extends z.ZodType>(schema: S) => (result: unknown): z.infer<S> | null => {
  const parsed = schema.safeParse(result);
  return parsed.success ? parsed.data : null;
};

export function createCommonSeatStore(options: CommonSeatStoreOptions): CommonSeatStore {
  return {
    async logDecision(raw) {
      const parsed = logInput.safeParse(raw);
      if (!parsed.success) return invalid();
      const input = parsed.data;
      const parseLog = parseWith(logResult);
      const outcome = await call(options, {
        sql: LOG_SQL,
        limitMs: (limits) => limits.toolMs,
        write: true,
        values: (v) => [
          v.context, v.scopeId, v.expectedActor, input.decisionId, input.decision, input.context ?? null, input.project ?? null,
          input.tags.map((tag) => tag.id), input.tags.map((tag) => tag.text),
        ],
        parse: (result) => {
          const value = parseLog(result);
          return value !== null && value.decision_id === input.decisionId ? value : null;
        },
      });
      return outcome.ok ? { ok: true, decisionId: outcome.value.decision_id, createdAtMs: outcome.value.created_at_ms } : outcome;
    },

    async getDecisions(raw) {
      const parsed = getInput.safeParse(raw);
      if (!parsed.success) return invalid();
      const input = parsed.data;
      const outcome = await call(options, {
        sql: GET_SQL,
        limitMs: (limits) => limits.readMs,
        write: false,
        values: (v) => [v.context, v.scopeId, v.expectedActor, input.project ?? null, input.tags ?? null, input.limit],
        parse: parseWith(getResult),
      });
      return outcome.ok ? { ok: true, ...outcome.value } : outcome;
    },

    async recoverDecisions(raw) {
      const parsed = recoverInput.safeParse(raw);
      if (!parsed.success) return invalid();
      const outcome = await call(options, {
        sql: RECOVER_SQL,
        limitMs: (limits) => limits.readMs,
        write: false,
        values: (v) => [v.context, v.scopeId, v.expectedActor, parsed.data.limit],
        parse: parseWith(recoverResult),
      });
      return outcome.ok ? { ok: true, ...outcome.value } : outcome;
    },
  };
}
