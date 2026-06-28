# Memory Persistence Audit 2026-06-22

Status: initial read-only audit
Scope: local Company Dev OS / Wasurezu memory persistence bindings
Runtime impact: none
Current repo policy: post-PR #186 PostgreSQL URL intent is fail-closed

## Purpose

This audit checks whether current agents are writing memory to a consistent
storage boundary before Kusabi V2 runtime work begins.

It intentionally does not change MCP configs, source code, package metadata,
database schema, workflows, deployment files, or stored memory content.

## Command

```sh
node scripts/audit-memory-persistence.mjs --include-postgres
```

The script reports local MCP bindings, storage backend selection, SQLite row
counts, and PostgreSQL row counts. It redacts URL-like values and does not read
stored memory text.

## Summary

Historical initial observation on 2026-06-22 JST, before PR #186 changed
PostgreSQL URL intent to fail closed:

```json
{
  "binding_count": 27,
  "backend_counts": {
    "postgres-implicit-fallback-enabled": 19,
    "sqlite-explicit": 8
  },
  "warning_counts": {
    "postgres_not_fail_closed": 19,
    "entrypoint_targets_other_checkout": 24,
    "missing_project_env": 1,
    "sqlite_explicit_local_store": 8,
    "database_url_ignored_by_sqlite_mode": 3
  },
  "sqlite_file_count": 10,
  "sqlite_files_with_rows": 5,
  "postgres_included": true
}
```

Historical observation after local MCP remediation on 2026-06-22 JST:

```json
{
  "binding_count": 27,
  "backend_counts": {
    "postgres-explicit": 19,
    "sqlite-explicit": 8
  },
  "warning_counts": {
    "missing_project_env": 1,
    "sqlite_explicit_local_store": 8,
    "database_url_ignored_by_sqlite_mode": 3
  },
  "sqlite_file_count": 10,
  "sqlite_files_with_rows": 5,
  "postgres_included": true
}
```

Local `.mcp.json` backups were created next to each changed config with suffix
`.bak-memory-persistence-20260621T204212Z`. The remediation changed only local
operator configs, not repository runtime code or schemas.

Remediation applied:

- replaced `~/Developer/agent-memory/dist/index.js` MCP entrypoints with
  `~/Developer/wasurezu-main/dist/index.js`;
- set `AGENT_MEMORY_DB_TYPE=postgres` wherever a PostgreSQL URL was configured
  without an explicit DB type.

Remaining warnings:

- 1 binding still lacks `AGENT_MEMORY_PROJECT`;
- 8 bindings intentionally or accidentally remain on explicit SQLite;
- 3 SQLite-mode bindings still contain ignored `DATABASE_URL` values.

Post-PR #186 interpretation:

- `AGENT_MEMORY_DATABASE_URL` and legacy `DATABASE_URL` now mean PostgreSQL
  intent and fail closed on connection failure unless an explicit local store
  type is selected.
- A binding with a PostgreSQL URL but no `AGENT_MEMORY_DB_TYPE=postgres` is no
  longer fail-open by runtime behavior. It remains weaker operator evidence than
  explicit `AGENT_MEMORY_DB_TYPE=postgres`.
- Fresh audits should classify this as `postgres_url_without_explicit_db_type`,
  not `postgres_not_fail_closed`.
- This document records historical local evidence and required remediation
  categories. It does not prove current local configs are still in the same
  state; rerun the script for current machine evidence.

## Findings

### F1: MCP entrypoints are split across local checkouts

24 of 27 detected MCP bindings execute
`~/Developer/agent-memory/dist/index.js` instead of the current
`~/Developer/wasurezu-main/dist/index.js` checkout.

This can make local behavior diverge from the branch under review and can hide
fixes, aliases, or diagnostics that exist only in one checkout.

Post-remediation status: resolved in local `.mcp.json` files for the 27 detected
bindings.

### F2: PostgreSQL mode lacked explicit DB type in many bindings

19 bindings set a PostgreSQL URL without `AGENT_MEMORY_DB_TYPE=postgres`.

At the time of the initial 2026-06-22 observation, store selection could fall
back to SQLite on connection failure. Since PR #186, configured PostgreSQL URL
intent fails closed instead of writing to a separate local store. The remaining
concern is operator clarity and evidence: explicit
`AGENT_MEMORY_DB_TYPE=postgres` is still easier to audit than URL-only intent.

Post-remediation status: resolved in local `.mcp.json` files for the 19 detected
PostgreSQL bindings by adding `AGENT_MEMORY_DB_TYPE=postgres`.

### F3: Several agents are intentionally or accidentally isolated in SQLite

8 bindings use explicit SQLite mode. Local DB files found under
`~/.agent-memory` include:

| DB | Notes |
| --- | --- |
| `memory.db` | Large default SQLite DB; contains many `raw_events` but few structured memories. |
| `lead-ama.db` | Non-empty dedicated agent DB. |
| `hotel-lead.db` | Non-empty dedicated agent DB. |
| `secretary.db` | Non-empty dedicated agent DB. |
| `hotel-dev.db`, `lead-sus.db`, `lead-tuk.db`, `upwork-dev.db`, `xmarketing-dev.db` | Empty or nearly empty dedicated DBs. |

Dedicated SQLite may be valid for local-only agents, but it must be an explicit
exception. It should not be the default for agents expected to participate in
shared recovery.

### F4: Project binding is not consistently enforced

One MCP binding lacks `AGENT_MEMORY_PROJECT`.

PostgreSQL also contains large historical groups with `project = null`,
especially in `task_states` and `knowledge`. This weakens the V2 memory boundary
of `agent_id + optional project`, because recovery targeting depends on the
project partition being intentional rather than accidental.

### F5: Raw/conversation capture is stale for several surfaces

PostgreSQL shows current recovery quality activity, but source capture is stale:

| Table | Latest observed rows |
| --- | --- |
| `recovery_quality_log` | active as of 2026-06-22 JST for `aun` |
| `decisions` | latest visible group: 2026-06-21 JST |
| `knowledge` | latest visible group: 2026-06-19 JST |
| `task_states` | latest visible group: 2026-06-18 JST |
| `raw_events` | latest visible group: 2026-06-18 JST |
| `conversation_events` | latest visible group: 2026-05-20 JST |

This suggests recovery calls are still happening, but raw/conversation capture
and structured memory writes are not uniformly healthy across agents.

## Operational Diagnosis

The current issue is not simply "memory is not saved." Data exists in both
PostgreSQL and SQLite. The practical failure mode is more likely:

1. agents write through different local entrypoints;
2. some agents use PostgreSQL with SQLite fallback enabled;
3. some agents write to dedicated SQLite files;
4. some historical writes omit `project`;
5. raw capture and structured memory capture are not aligned to the same
   `agent_id + project` target.

## Required Remediation Before V2 Runtime Work

1. Pick one canonical runtime entrypoint for active local agents.
2. For agents intended to use the shared common DB, set:

   ```text
   AGENT_MEMORY_DB_TYPE=postgres
   AGENT_MEMORY_DATABASE_URL or DATABASE_URL=<redacted>
   AGENT_MEMORY_AGENT_ID=<agent>
   AGENT_MEMORY_PROJECT=<project>
   ```

   Post-PR #186, omitting `AGENT_MEMORY_DB_TYPE=postgres` no longer enables
   SQLite fallback when a PostgreSQL URL is configured, but explicit DB type
   remains the preferred operator evidence.

3. For agents intentionally using SQLite, record an explicit exception with:

   ```text
   AGENT_MEMORY_DB_TYPE=sqlite
   AGENT_MEMORY_DB_PATH=<dedicated path>
   AGENT_MEMORY_AGENT_ID=<agent>
   AGENT_MEMORY_PROJECT=<project>
   ```

4. Remove or document ignored `DATABASE_URL` values in explicit SQLite configs.
5. Refresh raw capture targets so each active agent has the expected
   `agent_id + project` source target.
6. Run a practical smoke for each active agent:
   - `log_decision`
   - `save_task_state`
   - `save_knowledge`
   - `search_memory`
   - `recover_context`
   - `restart_pack` where applicable
7. Confirm each smoke writes and reads from the expected backend and
   `agent_id + project` boundary.

## V2 Boundary

This audit does not authorize Kusabi V2 runtime, package, MCP namespace,
environment variable, database path, schema, workflow, deployment, or repository
rename changes.

Kusabi V2 implementation work should wait until the current persistence binding
audit and smoke checks can prove that active agents save and recover memory from
the intended storage boundary.
