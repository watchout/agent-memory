/**
 * The one entry of the common-infrastructure form (u1-seat-memory-skeleton, Step 10, DL-7). Every program that decides
 * a seat's store (the MCP server, the session-start hooks, `boot`, `claude-start`, `codex-start`) asks here first, in
 * one place and before it builds any local store. With no mode, or `standalone`, the answer is "standalone" and the
 * caller runs its existing path unchanged (BR6.1). With `AGENT_MEMORY_MODE=common` the answer carries the seat's
 * store; a place or a setting that cannot be used gives a store whose every call answers that failure, so the caller
 * never falls back to a local store (BR1.1, BR1.3).
 *
 * This is the one module of the form that reads the clock and makes ids (S4): the core modules receive both. Nothing
 * here connects; the store opens a new connection on each call.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { v7 as uuidv7 } from "uuid";
import { commonForm, resolveCommonPlacement } from "./common-placement.js";
import { failure, type SeatFailure } from "./common-seat-errors.js";
import { createCommonSeatStore, createPgSqlClient, type CommonSeatStore, type SqlClient } from "./common-seat-store.js";
import { describeFailure } from "./common-seat-surface.js";
import { defaultUserConfigPath, readUserConfig, type StoreConfigRead, type StoreTarget } from "./store-resolution.js";

export interface EntryDeps {
  /** The read of the user config; the default reads the user's own file. */
  readonly readConfig?: () => StoreConfigRead;
  /** The window onto the database; the default is the PostgreSQL driver. A test passes a fake. */
  readonly makeClient?: (target: StoreTarget) => SqlClient;
  readonly now?: () => number;
  readonly newId?: () => string;
}

export type EntryDecision =
  | { readonly form: "standalone" }
  | { readonly form: "common"; readonly store: CommonSeatStore; readonly now: () => number; readonly newId: () => string };

/** A store that answers one failure to every call: the form is the common one but its place or seat is unusable. */
export function failingStore(cause: SeatFailure): CommonSeatStore {
  return { logDecision: async () => cause, getDecisions: async () => cause, recoverDecisions: async () => cause };
}

export function decideEntry(env: NodeJS.ProcessEnv = process.env, deps: EntryDeps = {}): EntryDecision {
  const form = commonForm(env);
  if (form === "standalone") return { form };
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => uuidv7());
  const place = typeof form === "string" ? resolveCommonPlacement(env, deps.readConfig ?? (() => readUserConfig(defaultUserConfigPath()))) : form;
  const store = place.ok
    ? createCommonSeatStore({ client: (deps.makeClient ?? createPgSqlClient)(place.target), seat: place.seat, now })
    : failingStore(place);
  return { form: "common", store, now, newId };
}

/**
 * For the programs that prepare a restart pack from a local store (`claude-start`, `codex-start`): none of that exists
 * in the common form yet, so they stop before they open a store (BR3.5). Null means the standalone form: carry on.
 */
export function commonFormRefusal(env: NodeJS.ProcessEnv = process.env): SeatFailure | null {
  const form = commonForm(env);
  if (form === "standalone") return null;
  return typeof form === "string" ? failure("not_yet_available", "input") : form;
}

/** The program form of `commonFormRefusal`: tells the person on stderr, sets the exit code and returns true when the caller must stop. */
export function refuseCommonForm(program: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const refused = commonFormRefusal(env);
  if (refused === null) return false;
  process.stderr.write(`[${program}] common form: ${describeFailure(refused)}\n`);
  process.exitCode = 2;
  return true;
}

/** Appends one line of the call record (BR5.1) to the file the caller names; the folder is made when it is missing. */
export async function appendCallRecord(file: string, line: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${line}\n`);
}
