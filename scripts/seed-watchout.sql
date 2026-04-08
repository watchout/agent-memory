-- =============================================================================
-- agent-memory: watchout-internal recovery_config seed
-- =============================================================================
--
-- This file holds the recovery_config seeds that previously lived inline in
-- src/stores/pg-store.ts MIGRATIONS. They were extracted by AM-015 (#45)
-- because the values are organization-specific (watchout-internal Discord
-- channel IDs and bot identifiers) and must NOT ship with OSS distributions.
--
-- USAGE (watchout internal only):
--   psql "$DATABASE_URL" -f scripts/seed-watchout.sql
--
-- The INSERT is idempotent: existing rows are preserved via
-- ON CONFLICT (agent_id) DO NOTHING. Safe to re-run.
--
-- DO NOT add this file to npm package "files" or any OSS release artifact.
-- =============================================================================

INSERT INTO recovery_config (
  agent_id,
  max_tokens,
  task_states_limit,
  decisions_limit,
  messages_limit,
  knowledge_limit,
  discord_history_limit,
  discord_channels,
  restart_message_threshold
) VALUES
  ('cto',           3000, 3, 5, 10, 5, 20, '{1485598480553611357,1486097810989383773}', 100),
  ('iyasaka-arc',   2000, 3, 3, 10, 3, 10, '{1485598480553611357}',                     150),
  ('hotel-dev',     1000, 1, 0,  5, 3,  5, '{1486097810989383773}',                      80),
  ('adf-dev',       1000, 1, 0,  5, 3,  5, '{1486161338832126083}',                      80),
  ('haishin-dev',   1000, 1, 0,  5, 3,  5, '{}',                                        100),
  ('wbs-dev',       1000, 1, 0,  5, 3,  5, '{}',                                        100),
  ('nyusatsu-dev',  1000, 1, 0,  5, 3,  5, '{}',                                        100),
  ('xmarketing-dev',1000, 1, 0,  5, 3,  5, '{}',                                        100),
  ('upwork-dev',    1000, 1, 0,  5, 3,  5, '{}',                                        100),
  ('agent-com-dev', 1500, 2, 3,  5, 3,  5, '{}',                                        100)
ON CONFLICT (agent_id) DO NOTHING;
