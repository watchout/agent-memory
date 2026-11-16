/**
 * The first import of the store-resolution tests that load store modules statically (261113-store-resolution-fix,
 * IM-BF-01). It sets a throwaway home and clears the variables that choose a store, before any other module is loaded:
 * ES modules run in import order, and the JSON store (its folder) and the SQLite store (its default file) fix their
 * path from the home when they are imported, so a home set later (by a test) comes too late for them.
 *
 * The caller's values are kept in CALLER_ENV for the one suite that needs one (the PostgreSQL suite reads DATABASE_URL);
 * they are removed from the process, so nothing the suite starts can reach a database or a folder the caller named.
 * test-store-resolution-isolation.ts runs the public npm scripts against a synthetic home and fails if anything in it changes.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NAMES = [
  "AGENT_MEMORY_DB_TYPE",
  "AGENT_MEMORY_DATABASE_URL",
  "DATABASE_URL",
  "AGENT_MEMORY_DB_PATH",
  "AGENT_MEMORY_HOME",
  "HOME",
] as const;

/** What the process that started this test had set, before it was cleared. */
export const CALLER_ENV: Readonly<Record<(typeof NAMES)[number], string | undefined>> = Object.freeze(
  Object.fromEntries(NAMES.map((name) => [name, process.env[name]])) as Record<(typeof NAMES)[number], string | undefined>,
);

export const ISOLATED_HOME = realpathSync(mkdtempSync(join(tmpdir(), "store-res-boot-")));
mkdirSync(join(ISOLATED_HOME, ".agent-memory"));
for (const name of NAMES) delete process.env[name];
process.env.HOME = ISOLATED_HOME;
process.on("exit", () => rmSync(ISOLATED_HOME, { recursive: true, force: true }));
