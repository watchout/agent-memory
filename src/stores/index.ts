import type { Store } from "./types.js";
import { PgStore } from "./pg-store.js";
import { JsonStore } from "./json-store.js";
import { SqliteStore } from "./sqlite-store.js";

/**
 * Factory selecting the storage backend based on environment.
 *
 * Resolution order (matches AM-001 spec):
 *   1. AGENT_MEMORY_DB_TYPE = sqlite | postgres | json  → explicit choice
 *   2. AGENT_MEMORY_DATABASE_URL → postgres intent; fail closed on connection failure
 *   3. DATABASE_URL → postgres intent; fail closed on connection failure
 *   4. no configured PostgreSQL URL → sqlite (OSS default)
 */
export async function createStore(): Promise<Store> {
  const dbType = (process.env.AGENT_MEMORY_DB_TYPE || "").toLowerCase();
  const dbUrl =
    process.env.AGENT_MEMORY_DATABASE_URL || process.env.DATABASE_URL || "";
  const hasPostgresUrl = dbUrl.startsWith("postgres");

  if (dbType === "json") {
    if (hasPostgresUrl) {
      console.error(
        "[agent-memory] AGENT_MEMORY_DB_TYPE=json ignores configured PostgreSQL URL; using JSON storage by explicit request"
      );
    }
    const store = new JsonStore();
    await store.initialize();
    console.error("[agent-memory] Using JSON file storage (~/.agent-memory/)");
    return store;
  }

  if (dbType === "sqlite") {
    if (hasPostgresUrl) {
      console.error(
        "[agent-memory] AGENT_MEMORY_DB_TYPE=sqlite ignores configured PostgreSQL URL; using SQLite storage by explicit request"
      );
    }
    const store = new SqliteStore();
    await store.initialize();
    console.error(`[agent-memory] Using SQLite storage`);
    return store;
  }

  if (dbType === "postgres" || hasPostgresUrl) {
    if (!dbUrl) {
      throw new Error(
        "AGENT_MEMORY_DB_TYPE=postgres requires AGENT_MEMORY_DATABASE_URL or DATABASE_URL"
      );
    }
    try {
      const store = new PgStore(dbUrl);
      await store.initialize();
      console.error("[agent-memory] Connected to PostgreSQL");
      return store;
    } catch (err) {
      console.error(
        `[agent-memory] PostgreSQL connection failed; refusing SQLite fallback because a PostgreSQL URL is configured: ${err}`
      );
      throw err;
    }
  }

  // Default: SQLite (OSS default)
  const store = new SqliteStore();
  await store.initialize();
  console.error("[agent-memory] Using SQLite storage (default)");
  return store;
}

export type { Store } from "./types.js";
