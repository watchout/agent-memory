import type { Store } from "./types.js";
import { PgStore } from "./pg-store.js";
import { JsonStore } from "./json-store.js";
import { SqliteStore } from "./sqlite-store.js";

/**
 * Factory selecting the storage backend based on environment.
 *
 * Resolution order (matches AM-001 spec):
 *   1. AGENT_MEMORY_DB_TYPE = sqlite | postgres | json  → explicit choice
 *   2. AGENT_MEMORY_DATABASE_URL → postgres (preferred env name)
 *   3. DATABASE_URL → postgres (legacy env name, kept for backward compat)
 *   4. fallback → sqlite (OSS default)
 */
export async function createStore(): Promise<Store> {
  const dbType = (process.env.AGENT_MEMORY_DB_TYPE || "").toLowerCase();
  const dbUrl =
    process.env.AGENT_MEMORY_DATABASE_URL || process.env.DATABASE_URL || "";

  if (dbType === "json") {
    const store = new JsonStore();
    await store.initialize();
    console.error("[agent-memory] Using JSON file storage (~/.agent-memory/)");
    return store;
  }

  if (dbType === "sqlite") {
    const store = new SqliteStore();
    await store.initialize();
    console.error(`[agent-memory] Using SQLite storage`);
    return store;
  }

  if (dbType === "postgres" || dbUrl.startsWith("postgres")) {
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
      if (dbType === "postgres") {
        console.error(
          `[agent-memory] PostgreSQL connection failed in explicit postgres mode; refusing SQLite fallback: ${err}`
        );
        throw err;
      }
      console.error(
        `[agent-memory] PostgreSQL connection failed, falling back to SQLite: ${err}`
      );
      const store = new SqliteStore();
      await store.initialize();
      return store;
    }
  }

  // Default: SQLite (OSS default)
  const store = new SqliteStore();
  await store.initialize();
  console.error("[agent-memory] Using SQLite storage (default)");
  return store;
}

export type { Store } from "./types.js";
