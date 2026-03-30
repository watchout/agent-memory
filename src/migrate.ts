#!/usr/bin/env node
/**
 * Standalone migration script for agent-memory PostgreSQL tables.
 * Usage: DATABASE_URL=postgres://... tsx src/migrate.ts
 *
 * Not needed for JSON file mode — files are created automatically.
 */
import pg from "pg";
const { Pool } = pg;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    project TEXT,
    decision TEXT NOT NULL,
    context TEXT,
    tags TEXT[] DEFAULT '{}',
    status TEXT DEFAULT 'active',
    superseded_by UUID REFERENCES decisions(id),
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_agent
    ON decisions(agent_id, status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS task_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    project TEXT,
    task TEXT NOT NULL,
    status TEXT NOT NULL,
    progress TEXT,
    files_modified TEXT[] DEFAULT '{}',
    next_steps TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_states_agent
    ON task_states(agent_id, created_at DESC)`,

  // v0.2.0: GIN indexes for full-text search
  `CREATE INDEX IF NOT EXISTS idx_decisions_search ON decisions
    USING GIN (to_tsvector('simple', decision || ' ' || coalesce(context,'') || ' ' || array_to_string(tags,' ')))`,
  `CREATE INDEX IF NOT EXISTS idx_task_states_search ON task_states
    USING GIN (to_tsvector('simple', task || ' ' || coalesce(progress,'') || ' ' || coalesce(next_steps,'')))`,
];

async function migrate() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is not set. Migration is only needed for PostgreSQL mode.");
    console.error("For JSON file mode, no migration is needed.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  try {
    for (const sql of MIGRATIONS) {
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
