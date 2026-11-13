import type { Store } from "./types.js";
import { PgStore } from "./pg-store.js";
import { JsonStore } from "./json-store.js";
import { SqliteStore } from "./sqlite-store.js";

export interface CreateStoreOptions {
  /**
   * Native SessionStart hooks have a strict 7-second deadline. Their schema is
   * provisioned by the ordinary MCP/CLI startup path, so they verify the
   * PostgreSQL connection without replaying every idempotent migration.
   */
  skipPostgresMigrations?: boolean;
}

export interface StoreBackendChoice {
  kind: "json" | "sqlite" | "postgres";
  /** The PostgreSQL URL; set only when kind is "postgres". */
  url?: string;
  /** json or sqlite was named by AGENT_MEMORY_DB_TYPE while a PostgreSQL URL is also configured: the URL is ignored. */
  ignores_postgres_url: boolean;
  /** AGENT_MEMORY_DB_TYPE named it (false: it is the default SQLite). */
  explicit: boolean;
}

/**
 * Which storage backend the environment asks for. The one place this is decided: createStore opens the chosen backend, and the
 * read-only reader of the hand-off source (read-only-task-states.ts) looks in the same one.
 *
 * Resolution order (matches AM-001 spec):
 *   1. AGENT_MEMORY_DB_TYPE = sqlite | postgres | json  → explicit choice
 *   2. AGENT_MEMORY_DATABASE_URL → postgres intent; fail closed on connection failure
 *   3. DATABASE_URL → postgres intent; fail closed on connection failure
 *   4. no configured PostgreSQL URL → sqlite (OSS default)
 */
export function resolveStoreBackend(env: NodeJS.ProcessEnv = process.env): StoreBackendChoice {
  const dbType = (env.AGENT_MEMORY_DB_TYPE || "").toLowerCase();
  const dbUrl = env.AGENT_MEMORY_DATABASE_URL || env.DATABASE_URL || "";
  const hasPostgresUrl = dbUrl.startsWith("postgres");

  if (dbType === "json") return { kind: "json", ignores_postgres_url: hasPostgresUrl, explicit: true };
  if (dbType === "sqlite") return { kind: "sqlite", ignores_postgres_url: hasPostgresUrl, explicit: true };
  if (dbType === "postgres" || hasPostgresUrl) {
    if (!dbUrl) {
      throw new Error(
        "AGENT_MEMORY_DB_TYPE=postgres requires AGENT_MEMORY_DATABASE_URL or DATABASE_URL"
      );
    }
    return { kind: "postgres", url: dbUrl, ignores_postgres_url: false, explicit: dbType === "postgres" };
  }
  return { kind: "sqlite", ignores_postgres_url: false, explicit: false };
}

/** Factory selecting the storage backend based on environment (see resolveStoreBackend). */
export async function createStore(options: CreateStoreOptions = {}): Promise<Store> {
  const choice = resolveStoreBackend();

  if (choice.kind === "json") {
    if (choice.ignores_postgres_url) {
      console.error(
        "[agent-memory] AGENT_MEMORY_DB_TYPE=json ignores configured PostgreSQL URL; using JSON storage by explicit request"
      );
    }
    const store = new JsonStore();
    await store.initialize();
    console.error("[agent-memory] Using JSON file storage (~/.agent-memory/)");
    return store;
  }

  if (choice.kind === "postgres") {
    try {
      const store = new PgStore(choice.url as string);
      await store.initialize({ run_migrations: !options.skipPostgresMigrations });
      console.error("[agent-memory] Connected to PostgreSQL");
      return store;
    } catch (err) {
      console.error(
        `[agent-memory] PostgreSQL connection failed; refusing SQLite fallback because a PostgreSQL URL is configured: ${err}`
      );
      throw err;
    }
  }

  if (choice.explicit) {
    if (choice.ignores_postgres_url) {
      console.error(
        "[agent-memory] AGENT_MEMORY_DB_TYPE=sqlite ignores configured PostgreSQL URL; using SQLite storage by explicit request"
      );
    }
    const store = new SqliteStore();
    await store.initialize();
    console.error(`[agent-memory] Using SQLite storage`);
    return store;
  }

  // Default: SQLite (OSS default)
  const store = new SqliteStore();
  await store.initialize();
  console.error("[agent-memory] Using SQLite storage (default)");
  return store;
}

export type { Store } from "./types.js";
