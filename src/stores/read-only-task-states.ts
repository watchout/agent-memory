import { existsSync, readFileSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import initSqlJs from "sql.js";
import pg from "pg";
import { ROTATION_HANDOFF_SOURCE_PG_TIMEOUT_MS } from "../constants.js";
import { DEFAULT_DATA_DIR, TASK_STATES_FILE } from "./json-store.js";
import { normalizeTaskStates, type TaskStateKeyFields } from "./task-state-normalize.js";
import { resolveStoreBackend } from "./index.js";
import { resolveSqliteDbPath } from "./sqlite-store.js";
import type { GetTaskStatesInput, TaskState } from "./types.js";

/**
 * A reader of the seat's task states that can only read (FR11.7, handoff-commit-order-design.md 4.7 R-b).
 *
 * It does not go through a Store: opening a Store prepares it for writing (the SQLite store migrates and writes the file
 * back, the JSON store rewrites legacy rows, the PostgreSQL store creates tables), and closing one writes again. This reader
 * opens each backend the way that only reads, and it opens it again on every call, so nothing is held that has to be closed:
 *   - SQLite: the file's bytes are read and opened in memory; nothing is exported or written back. No file is made.
 *   - PostgreSQL: no migration; one READ ONLY transaction with one SELECT, then the connection ends.
 *   - JSON: the file is read and parsed; nothing is normalized or written back. No folder is made.
 * A store that is not there, or that cannot be parsed, is a failure (the call throws) - not an empty list.
 * It adds no Store verb and changes no table, column or status.
 */
export type HandoffTaskRow = Pick<TaskState, "task_id" | "progress" | "created_at" | "updated_at">;

export interface HandoffTaskReader {
  getTaskStates(input: GetTaskStatesInput): Promise<HandoffTaskRow[]>;
}

/** The part of a PostgreSQL client the read uses, so that the statements it sends can be checked without a server. */
export interface PgReadClient {
  connect(): Promise<unknown>;
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}
export type PgReadClientFactory = (connectionString: string) => PgReadClient;

export interface ReadOnlyTaskStatesDeps {
  pg_client?: PgReadClientFactory;
  /** The JSON store's folder when it is not the default one under the home folder (the store itself takes the same choice). */
  json_dir?: string;
}

/** The client the command uses against PostgreSQL. The time is a parameter only so that a test can use a short one. */
export function createPgReadClient(connectionString: string, timeoutMs: number = ROTATION_HANDOFF_SOURCE_PG_TIMEOUT_MS): PgReadClient {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
  });
  // A connection that breaks while idle must not end the process; the failure shows in the query that was waiting.
  client.on("error", () => undefined);
  return client;
}

export function createReadOnlyTaskStateReader(env: NodeJS.ProcessEnv = process.env, deps: ReadOnlyTaskStatesDeps = {}): HandoffTaskReader {
  return { getTaskStates: (input) => readTaskStatesReadOnly(env, input, deps) };
}

export async function readTaskStatesReadOnly(env: NodeJS.ProcessEnv, input: GetTaskStatesInput, deps: ReadOnlyTaskStatesDeps = {}): Promise<HandoffTaskRow[]> {
  const choice = resolveStoreBackend(env);
  if (choice.kind === "postgres") return readPg(choice.url as string, input, deps.pg_client ?? ((connectionString) => createPgReadClient(connectionString)));
  if (choice.kind === "json") return readJson(deps.json_dir ?? DEFAULT_DATA_DIR, input);
  return readSqlite(resolveSqliteDbPath(undefined, env), input);
}

function present(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function timestamp(value: unknown): string | undefined {
  return value instanceof Date ? value.toISOString() : present(value);
}

/** A row with no creation time is not a task state of any store (the column is NOT NULL); it is a damaged store, so the read fails. */
function toRow(raw: Record<string, unknown>): HandoffTaskRow {
  const createdAt = timestamp(raw.created_at);
  if (createdAt === undefined) throw new Error("a task state row has no created_at");
  return {
    task_id: present(raw.task_id),
    progress: present(raw.progress),
    created_at: createdAt,
    updated_at: timestamp(raw.updated_at),
  };
}

/** The filter the stores apply, as SQL text and values; placeholders are numbered ($1) for PostgreSQL and "?" for SQLite. */
function selection(input: GetTaskStatesInput, placeholder: (index: number) => string): { where: string; values: unknown[]; limit: string } {
  const conditions = [`agent_id = ${placeholder(1)}`];
  const values: unknown[] = [input.agent_id];
  if (input.project) {
    values.push(input.project);
    conditions.push(`project = ${placeholder(values.length)}`);
  }
  if (input.status && input.status !== "all") {
    values.push(input.status);
    conditions.push(`status = ${placeholder(values.length)}`);
  }
  values.push(input.limit || 5);
  return { where: conditions.join(" AND "), values, limit: placeholder(values.length) };
}

async function readPg(url: string, input: GetTaskStatesInput, makeClient: PgReadClientFactory): Promise<HandoffTaskRow[]> {
  const client = makeClient(url);
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const { where, values, limit } = selection(input, (index) => `$${index}`);
    const result = await client.query(`SELECT * FROM task_states WHERE ${where} ORDER BY created_at DESC LIMIT ${limit}`, values);
    await client.query("ROLLBACK");
    return result.rows.map(toRow);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function readSqlite(dbPath: string, input: GetTaskStatesInput): Promise<HandoffTaskRow[]> {
  if (!existsSync(dbPath)) throw new Error("the SQLite store file is not there");
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));
  try {
    const { where, values, limit } = selection(input, () => "?");
    const statement = db.prepare(`SELECT * FROM task_states WHERE ${where} ORDER BY created_at DESC LIMIT ${limit}`);
    try {
      statement.bind(values as never);
      const rows: HandoffTaskRow[] = [];
      while (statement.step()) rows.push(toRow(statement.getAsObject() as Record<string, unknown>));
      return rows;
    } finally {
      statement.free();
    }
  } finally {
    db.close();
  }
}

/** A row of the records file as parsed: the fields the clean-up reads are typed, the rest are read as unknown. */
type RawTaskState = TaskStateKeyFields & Record<string, unknown>;

async function readJson(dataDir: string, input: GetTaskStatesInput): Promise<HandoffTaskRow[]> {
  if (!existsSync(dataDir)) throw new Error("the JSON store folder is not there");
  const file = join(dataDir, TASK_STATES_FILE);
  if (!existsSync(file)) return [];
  const parsed: unknown = JSON.parse(await readFile(file, "utf-8"));
  if (!Array.isArray(parsed)) throw new Error("the task states file is not a list");
  const entries = parsed.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) throw new Error(`the task states file holds an entry that is not an object (${index})`);
    return entry as unknown as RawTaskState;
  });
  // The store cleans these rows when it opens (a legacy row gets its task id, a duplicate collapses to one row); the same
  // function does it here in memory, so the reader gives the row the store gives. Nothing is written back.
  const rows = normalizeTaskStates(entries).rows.map((raw, index) => ({ index, raw }));
  return rows
    .filter(({ raw }) => raw.agent_id === input.agent_id)
    .filter(({ raw }) => !input.project || raw.project === input.project)
    .filter(({ raw }) => !input.status || input.status === "all" || raw.status === input.status)
    .sort((a, b) => {
      const byTime = new Date(String(b.raw.created_at)).getTime() - new Date(String(a.raw.created_at)).getTime();
      return byTime !== 0 && !Number.isNaN(byTime) ? byTime : b.index - a.index;
    })
    .slice(0, input.limit || 5)
    .map(({ raw }) => toRow(raw));
}
