/**
 * Canonical PostgreSQL migration statements.
 *
 * Keep this as the only source read by PgStore.initialize() and the
 * standalone migrate.ts runner so the two migration paths cannot drift.
 * Statements must remain idempotent and compatibility-preserving.
 */
export const PG_MIGRATIONS: string[] = [
  // decisions table
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

  // task_states table
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

  // v0.2.0: GIN indexes for full-text search (columns only, no function calls on arrays)
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

  // v0.3.0: consolidated_at column on decisions
  `ALTER TABLE decisions ADD COLUMN IF NOT EXISTS consolidated_at TIMESTAMPTZ`,

  // v0.3.1: pgvector extension + embedding columns for semantic search
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `ALTER TABLE decisions ADD COLUMN IF NOT EXISTS embedding vector(512)`,
  `ALTER TABLE task_states ADD COLUMN IF NOT EXISTS embedding vector(512)`,
  `ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS embedding vector(512)`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_embedding ON decisions USING hnsw (embedding vector_cosine_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_task_states_embedding ON task_states USING hnsw (embedding vector_cosine_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge USING hnsw (embedding vector_cosine_ops)`,

  // v0.4.0: recovery_config table (FEAT-015)
  `CREATE TABLE IF NOT EXISTS recovery_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL UNIQUE,
    max_tokens INT DEFAULT 1000,
    task_states_limit INT DEFAULT 1,
    decisions_limit INT DEFAULT 0,
    knowledge_limit INT DEFAULT 3,
    messages_limit INT DEFAULT 5,
    discord_history_limit INT DEFAULT 5,
    discord_channels TEXT[] DEFAULT '{}',
    restart_message_threshold INT DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,

  // NOTE: organization-specific recovery_config seed data is intentionally
  // excluded from PG_MIGRATIONS for OSS distribution (AM-015 / #45). The
  // historical seeds (cto / iyasaka-arc / hotel-dev / etc. with internal
  // Discord channel IDs) live in scripts/seed-watchout.sql and are applied
  // manually to internal deployments. New users get an empty
  // recovery_config and rely on the boot-time auto-init fallback (see
  // src/boot.ts) to populate a default row on first run.

  // v0.4.0: recovery_quality_log table (FEAT-024)
  `CREATE TABLE IF NOT EXISTS recovery_quality_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    session_id TEXT,
    recovered_tokens INT,
    task_continued BOOLEAN,
    search_memory_count_10min INT DEFAULT 0,
    quality_score FLOAT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_recovery_quality_agent ON recovery_quality_log(agent_id, created_at DESC)`,

  // ─── AM-023: task_id UPSERT (#56) ─────────────────────────────
  // Add stable per-task identifier so successive [TASK:start]/done
  // posts with the same ticket id collapse to a single row instead
  // of accumulating duplicates. The migration is split into ALTER →
  // backfill → dedup → UNIQUE so it is safe to re-run.
  `ALTER TABLE task_states ADD COLUMN IF NOT EXISTS task_id TEXT`,
  `ALTER TABLE task_states ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`,
  // Back-fill: existing rows have task='AM-006' (ticket id) because
  // the pre-AM-023 hook stored the ticket in `task`. Copy that into
  // task_id verbatim so the UNIQUE index has something to key on.
  `UPDATE task_states SET task_id = task WHERE task_id IS NULL`,
  `UPDATE task_states SET updated_at = created_at WHERE updated_at IS NULL`,
  // Dedup: keep only the latest row per (agent_id, task_id). Uses
  // DISTINCT ON which is PG-specific but produces a deterministic
  // pick (the row with the largest created_at, ties broken by id).
  `DELETE FROM task_states WHERE id NOT IN (
     SELECT DISTINCT ON (agent_id, task_id) id
       FROM task_states
      ORDER BY agent_id, task_id, created_at DESC, id DESC
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_task_states_agent_task_id
     ON task_states (agent_id, task_id)`,

  // ─── AM-024: knowledge supersede columns (#57) ────────────────
  // Shared source for PgStore.initialize() and standalone migrate.ts.
  // Idempotent ALTER ... ADD COLUMN IF NOT EXISTS statements keep
  // re-running either path a no-op once applied.
  `ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS supersedes UUID REFERENCES knowledge(id)`,
  `ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS supersede_reason TEXT`,

  // AM-031: provider-neutral redacted full-text conversation/log events.
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

  // AM-103: canonical raw event ledger. conversation_events remains a
  // compatibility ingest table; redacted transcript events are mirrored here.
  `CREATE TABLE IF NOT EXISTS raw_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    session_id TEXT,
    project TEXT,
    host TEXT NOT NULL DEFAULT 'unknown',
    source TEXT NOT NULL,
    event_type TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'event',
    source_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_ref_hash TEXT NOT NULL DEFAULT '',
    event_at TIMESTAMPTZ,
    ingested_at TIMESTAMPTZ DEFAULT now(),
    content_text TEXT,
    content_json JSONB,
    redaction_level TEXT NOT NULL DEFAULT 'basic',
    private_reasoning BOOLEAN NOT NULL DEFAULT false,
    content TEXT,
    content_hash TEXT,
    source_event_id TEXT,
    source_path TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS agent_id TEXT`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS session_id TEXT`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS project TEXT`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS host TEXT NOT NULL DEFAULT 'unknown'`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS source TEXT`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS event_type TEXT`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'event'`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS source_ref JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS source_ref_hash TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS event_at TIMESTAMPTZ`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ DEFAULT now()`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS content_text TEXT`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS content_json JSONB`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS redaction_level TEXT NOT NULL DEFAULT 'basic'`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS private_reasoning BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS content TEXT`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS content_hash TEXT`,
  `ALTER TABLE raw_events ALTER COLUMN content_hash DROP NOT NULL`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS source_event_id TEXT`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS source_path TEXT`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ`,
  `ALTER TABLE raw_events ALTER COLUMN occurred_at SET DEFAULT now()`,
  `ALTER TABLE raw_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1
         FROM pg_constraint
        WHERE conrelid = 'raw_events'::regclass
          AND conname = 'raw_events_occurred_at_not_null'
     ) THEN
       ALTER TABLE raw_events
         ADD CONSTRAINT raw_events_occurred_at_not_null
         CHECK (occurred_at IS NOT NULL) NOT VALID;
     END IF;
   END $$`,
  `WITH duplicate_backfill_hash_time AS (
     SELECT id
       FROM (
         SELECT id,
                COUNT(*) OVER (
                  PARTITION BY
                    agent_id,
                    source,
                    content_hash,
                    COALESCE(occurred_at, event_at, ingested_at, created_at, now())
                ) AS duplicate_count
           FROM raw_events
          WHERE source_event_id IS NULL
            AND content_hash IS NOT NULL
       ) ranked
      WHERE duplicate_count > 1
   )
   UPDATE raw_events
      SET source_event_id = 'legacy-raw-event:' || id::text,
          occurred_at = COALESCE(occurred_at, event_at, ingested_at, created_at, now()),
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'migration_source_event_id',
            'synthesized_before_occurred_at_backfill',
            'migration',
            'am103_raw_events_occurred_at_not_null'
          )
    WHERE id IN (SELECT id FROM duplicate_backfill_hash_time)
      AND source_event_id IS NULL`,
  `UPDATE raw_events
     SET occurred_at = COALESCE(occurred_at, event_at, ingested_at, created_at, now())
     WHERE occurred_at IS NULL`,
  `WITH duplicate_hash_time AS (
     SELECT id
       FROM (
         SELECT id,
                COUNT(*) OVER (
                  PARTITION BY agent_id, source, content_hash, occurred_at
                ) AS duplicate_count
           FROM raw_events
          WHERE source_event_id IS NULL
            AND content_hash IS NOT NULL
            AND occurred_at IS NOT NULL
       ) ranked
      WHERE duplicate_count > 1
   )
  UPDATE raw_events
      SET source_event_id = 'legacy-raw-event:' || id::text,
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'migration_source_event_id',
            'synthesized_from_legacy_duplicate',
            'migration',
            'am103_raw_events_occurred_at_not_null'
          )
    WHERE id IN (SELECT id FROM duplicate_hash_time)
      AND source_event_id IS NULL`,
  `ALTER TABLE raw_events VALIDATE CONSTRAINT raw_events_occurred_at_not_null`,
  `ALTER TABLE raw_events ALTER COLUMN occurred_at SET NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_events_source_event
     ON raw_events (agent_id, source, source_event_id)
     WHERE source_event_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_events_hash_time
     ON raw_events (agent_id, source, content_hash, occurred_at)
     WHERE source_event_id IS NULL AND content_hash IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_raw_events_recent
     ON raw_events (agent_id, source, occurred_at DESC)`,

  // AM-039: selected restart packs for host/AUN boot consume.
  `CREATE TABLE IF NOT EXISTS selected_restart_packs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    project TEXT,
    pack_ref TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    source TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    consumed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_selected_restart_packs_agent
     ON selected_restart_packs (agent_id, status, created_at DESC)`,

  // ─── CELL-4MCP-KUSABI-001: agent memory partition registry ──────────────
  // Lane 3 (Kusabi) of SPEC-4MCP-002. This MCP's OWN table — the single
  // source of truth for partition + visibility. agent_id is the immutable,
  // only identity key. Partition/visibility are NEVER inferred from shared
  // identity metadata held by peer MCPs (see src/kusabi-partitions.ts).
  // Dispatch anchor: watchout/agent-memory#247. Schema migration is a
  // protected surface — reviewed via protected_surface_gate at PR time.
  `CREATE TABLE IF NOT EXISTS kusabi_agent_memory_partitions (
    agent_id TEXT NOT NULL,
    memory_project TEXT NOT NULL,
    partition_key TEXT NOT NULL,
    default_visibility TEXT NOT NULL DEFAULT 'private',
    retention_policy_ref TEXT,
    recovery_config_ref TEXT,
    source_capture_policy_ref TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_id, memory_project)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_kusabi_partitions_agent
     ON kusabi_agent_memory_partitions (agent_id, updated_at DESC)`,
];
