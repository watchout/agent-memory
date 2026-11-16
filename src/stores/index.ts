import type { Store } from "./types.js";
import { PgStore } from "./pg-store.js";
import { JsonStore } from "./json-store.js";
import { SqliteStore } from "./sqlite-store.js";
import type { StoreResolution } from "../store-resolution.js";

export interface CreateStoreOptions {
  /**
   * Native SessionStart hooks have a strict 7-second deadline. Their schema is
   * provisioned by the ordinary MCP/CLI startup path, so they verify the
   * PostgreSQL connection without replaying every idempotent migration.
   */
  skipPostgresMigrations?: boolean;
  /**
   * The decision of the shared resolver (store-resolution.ts). When given, the store is opened from it and the
   * environment is not read again; when absent the environment decides, as for the MCP server and the CLI.
   */
  resolution?: StoreResolution;
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
 * Which storage backend the environment alone asks for (the MCP server, the CLI and the carry-over entries). The hooks do
 * not call this: they decide through `resolveStore` (store-resolution.ts), which adds the `database_url` of the user config.
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

function choiceFromResolution(resolution: StoreResolution): StoreBackendChoice {
  const explicit = resolution.source === "environment";
  if (resolution.backend === "postgres") {
    return { kind: "postgres", url: resolution.target.reveal(), ignores_postgres_url: false, explicit };
  }
  return { kind: resolution.backend, ignores_postgres_url: resolution.ignores_postgres_url, explicit };
}

/**
 * Factory selecting the storage backend: from the given resolution when there is one, otherwise from the environment
 * (see resolveStoreBackend).
 */
export async function createStore(options: CreateStoreOptions = {}): Promise<Store> {
  const choice = options.resolution ? choiceFromResolution(options.resolution) : resolveStoreBackend();

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

/**
 * Checks that a store is of the backend a resolution names: one that opened as anything else is closed and refused, so a
 * hook never writes to a place the decision did not name. A store that reports no backend (a test double) is not checked.
 */
export async function requireStoreBackend(store: Store, resolution: StoreResolution): Promise<Store> {
  if (store.backend !== undefined && store.backend !== resolution.backend) {
    await store.close().catch(() => undefined);
    throw new Error(`opened store backend does not match the decision (${resolution.backend})`);
  }
  return store;
}

/** Opens the store a resolution names and checks it (requireStoreBackend). */
export async function openResolvedStore(
  resolution: StoreResolution,
  options: Omit<CreateStoreOptions, "resolution"> = {},
): Promise<Store> {
  return requireStoreBackend(await createStore({ ...options, resolution }), resolution);
}

export type { Store } from "./types.js";
