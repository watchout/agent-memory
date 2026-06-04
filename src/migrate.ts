#!/usr/bin/env node
/**
 * Standalone migration script for agent-memory PostgreSQL tables.
 * Usage: DATABASE_URL=postgres://... tsx src/migrate.ts
 *
 * Not needed for JSON file mode — files are created automatically.
 */
import pg from "pg";
import { PG_MIGRATIONS } from "./stores/pg-migrations.js";
const { Pool } = pg;

async function migrate() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is not set. Migration is only needed for PostgreSQL mode.");
    console.error("For JSON file mode, no migration is needed.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  try {
    for (const sql of PG_MIGRATIONS) {
      await pool.query(sql);
      console.log("✅", sql.split("\n")[0].trim());
    }
    console.log("\n✅ All migrations complete.");
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
