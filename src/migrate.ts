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
    USING GIN (to_tsvector('simple', coalesce(decision,'') || ' ' || coalesce(context,'')))`,
  `CREATE INDEX IF NOT EXISTS idx_task_states_search ON task_states
    USING GIN (to_tsvector('simple', coalesce(task,'') || ' ' || coalesce(progress,'') || ' ' || coalesce(next_steps,'')))`,

  // v0.3.0: knowledge table
  `CREATE TABLE IF NOT EXISTS knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    project TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_ids UUID[] DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    status TEXT DEFAULT 'active',
    merged_into UUID REFERENCES knowledge(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_agent ON knowledge(agent_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge(project, status)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_search ON knowledge
    USING GIN (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,'')))`,
  `ALTER TABLE decisions ADD COLUMN IF NOT EXISTS consolidated_at TIMESTAMPTZ`,

  // ─── AM-023: task_id UPSERT (#56) ─────────────────────────────
  // (Chronologically merged before AM-024. Order matters for human
  // readability only — every statement is `IF NOT EXISTS`-guarded
  // and idempotent so the runtime behavior is order-independent.)
  `ALTER TABLE task_states ADD COLUMN IF NOT EXISTS task_id TEXT`,
  `ALTER TABLE task_states ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`,
  `UPDATE task_states SET task_id = task WHERE task_id IS NULL`,
  `UPDATE task_states SET updated_at = created_at WHERE updated_at IS NULL`,
  `DELETE FROM task_states WHERE id NOT IN (
     SELECT DISTINCT ON (agent_id, task_id) id
       FROM task_states
      ORDER BY agent_id, task_id, created_at DESC, id DESC
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_task_states_agent_task_id
     ON task_states (agent_id, task_id)`,

  // ─── AM-024: knowledge supersede columns (#57) ────────────────
  `ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS supersedes UUID REFERENCES knowledge(id)`,
  `ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS supersede_reason TEXT`,

  // ─── AM-031: redacted full-text conversation/log events ──────
  `CREATE TABLE IF NOT EXISTS conversation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    project TEXT,
    source TEXT NOT NULL,
    source_event_id TEXT,
    source_path TEXT,
    role TEXT,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_events_source_event
     ON conversation_events (agent_id, source, source_event_id)
     WHERE source_event_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_events_hash_time
     ON conversation_events (agent_id, source, content_hash, occurred_at)
     WHERE source_event_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_events_recent
     ON conversation_events (agent_id, source, occurred_at DESC)`,
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
