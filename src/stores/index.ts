import type { Store } from "./types.js";
import { PgStore } from "./pg-store.js";
import { JsonStore } from "./json-store.js";

export async function createStore(): Promise<Store> {
  const dbUrl = process.env.DATABASE_URL;

  if (dbUrl) {
    try {
      const store = new PgStore(dbUrl);
      await store.initialize();
      console.error("[agent-memory] Connected to PostgreSQL");
      return store;
    } catch (err) {
      console.error(
        `[agent-memory] PostgreSQL connection failed, falling back to JSON: ${err}`
      );
    }
  }

  const store = new JsonStore();
  await store.initialize();
  console.error("[agent-memory] Using JSON file storage (~/.agent-memory/)");
  return store;
}

export type { Store } from "./types.js";
