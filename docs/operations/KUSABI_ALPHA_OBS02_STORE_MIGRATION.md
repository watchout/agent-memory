# Kusabi alpha OBS-02 store migration

Status: implementation and isolated-validation contract. This document does
not authorize a live database migration, host emission, configuration/trust
change, distribution, activation, or deployment.

## Scope

OBS-02 adds a dedicated `kusabi_runtime_events` ledger to the existing
user-selected SQLite and PostgreSQL stores. It deliberately does not reuse
`raw_events`: that legacy ledger can contain source content and uses
agent-scoped compatibility identities, while runtime observability requires a
privacy-safe, globally idempotent `event_id` and strict event schema.

The selected backend remains a product choice:

- SQLite stores the canonical event JSON and indexed identity fields in the
  selected database file. A durable result is returned only after the sql.js
  image has been written successfully.
- PostgreSQL writes the same logical record in a transaction and returns a
  durable result only after `COMMIT` succeeds.
- JSON can persist deterministic test fixtures, but the ingest boundary always
  reports `json_fixture_only`; it is never accepted as durable OBS-02 evidence.

## Additive schema

Both backends create `kusabi_runtime_events` idempotently. The logical columns
are:

| Column | Contract |
| --- | --- |
| `event_id` | primary key; duplicate delivery identity |
| `manifest_id` | bounded rollout-manifest identity |
| `target_key` | lowercase SHA-256 target identity |
| `event_type` | one of the schema-frozen runtime event types |
| `occurred_at` | producer event time |
| `event_sha256` | SHA-256 of recursively key-sorted canonical event JSON |
| `event_json` | complete strict `kusabi-runtime-event/v1` object |
| `ingested_at` | store acknowledgement time |

Indexes cover `(manifest_id, occurred_at, event_id)` and
`(target_key, occurred_at, event_id)`. The migration does not rewrite, copy,
or delete `raw_events` or another existing table.

## Ingest invariants

1. The complete input must pass the strict draft-2020-12 runtime-event schema;
   unknown fields are rejected before persistence.
2. Canonical bytes and `event_sha256` are computed inside the ingest boundary.
3. First delivery inserts one record. An exact duplicate returns the existing
   record with `inserted=false`.
4. Reusing an `event_id` for different canonical bytes is an integrity
   conflict. The conflicting payload is not stored or copied into evidence.
5. A store failure emits at most one bounded, privacy-safe emergency JSON line.
   Raw errors, stack traces, credentials, database URLs, environment values,
   conversation/prompt content, and absolute paths are excluded.
6. If both durable storage and the emergency writer fail, ingest returns
   `failed` without breaking the caller's ordinary runtime flow.

## Isolated verification

These commands are admissible before live-migration approval:

```sh
npx tsc --noEmit
HOME="$(mktemp -d)" npx tsx src/test-sqlite.ts
HOME="$(mktemp -d)" npx tsx tests/gate0/migration-idempotency.ts
DATABASE_URL='postgresql:///agent_comms?host=/tmp' npx tsx src/test-pg.ts
npm test
npm run build
```

The PostgreSQL suite creates a unique `obs02_suite_*` schema and drops it with
`CASCADE` in `finally`. Two legacy-migration tests create and drop their own
unique schemas. No suite command may target or migrate live product tables.
SQLite uses temporary files/directories that are deleted after the suite.

For the fixed OBS-02 fixture stream, SQLite and PostgreSQL must both emit:

```text
OBS02_NORMALIZED_SHA256=17dbf478bbb50f291f3dffeee2249791b9102fff206b29fe838f47680b9c936b
```

## Later live-migration gate

This PR only supplies additive migration code. A future, separately approved
live migration must bind an exact build and exact database target, take and
verify a recoverable backup, record the preflight table/index state, stop or
coordinate writers, run the selected backend's normal initialization, and
verify schema plus a privacy-safe read/write canary before activation.

Default rollback is non-destructive: stop the new writer, revert the exact
runtime build/configuration through its separately authorized gate, and leave
the additive table in place. Dropping the table is not routine rollback. It
requires separate destructive approval, an export whose content hash and
readback are verified, and an exact target binding. This implementation does
not execute either live migration or rollback.

## Governance boundary

Implementation authority:
`ODR-KUSABI-ALPHA-OBS02-STORE-INGEST-20260729-001`.

Merge still requires an independent audit bound to the exact PR head and tree,
an exact-head owner decision, and a separate protected merge actor. Runtime
implementation outside OBS-02, distribution, configuration/trust mutation,
activation, and deployment remain unapproved.
