# Kusabi V2 Backend Parity Matrix Draft

Status: draft
Scope: storage backend claim boundaries and parity evidence
Runtime impact: none
Base: `src/stores/index.ts`, `src/stores/types.ts`, `src/stores/sqlite-store.ts`,
`src/stores/pg-store.ts`, `src/stores/json-store.ts`,
`docs/operations/COMMON_DB_ALIGNMENT.md`

## 1. Purpose and status

This document defines the Kusabi V2 backend parity matrix for SQLite,
PostgreSQL, and JSON storage.

It answers a narrow question:

```text
Which storage claims can be made, and what evidence is required before claiming
SQLite/PostgreSQL/JSON parity?
```

This is a docs-only claim boundary. It does not:

- change runtime behavior;
- change storage selection;
- change package identity;
- change MCP namespace;
- change environment variables;
- change DB paths;
- create migrations;
- create schema files;
- create fixture files;
- implement tests;
- implement a score runner;
- change startup behavior;
- claim UAMP conformance;
- claim backend parity;
- claim legal or regulatory compliance.

## 2. Current backend selection boundary

Current store selection is implementation behavior, not a new V2 claim.

Observed selection order:

1. `AGENT_MEMORY_DB_TYPE=sqlite|postgres|json` selects an explicit backend.
2. `AGENT_MEMORY_DATABASE_URL` selects PostgreSQL intent.
3. Legacy `DATABASE_URL` selects PostgreSQL intent.
4. No configured DB selects SQLite default.

Current compatibility notes:

- `AGENT_MEMORY_DB_TYPE=postgres` requires
  `AGENT_MEMORY_DATABASE_URL` or `DATABASE_URL`.
- Explicit `AGENT_MEMORY_DB_TYPE=postgres` must fail closed if PostgreSQL cannot
  initialize.
- URL-only PostgreSQL intent currently attempts PostgreSQL and falls back to
  SQLite if connection fails.
- SQLite remains the zero-config local default.
- JSON remains an explicit compatibility/dev backend when
  `AGENT_MEMORY_DB_TYPE=json`.
- Common DB registry support is not live runtime behavior.

This document does not change those rules. Any future change to fallback,
fail-closed behavior, env vars, DB paths, or migration semantics requires a
separate owner-approved implementation PR.

## 3. Backend roles

| Backend | Current role | V2 claim boundary |
| --- | --- | --- |
| SQLite | Default local-first store using `sql.js` and `~/.agent-memory/memory.db`. | May be claimed as local/default only with clean-install and direct smoke evidence. |
| PostgreSQL | Optional/shared store selected by explicit type or PostgreSQL URL. | May be claimed as shared/team backend only with live PG test evidence and migration-state evidence. |
| JSON | Explicit compatibility/dev fallback under `~/.agent-memory/*.json`. | Must not be claimed as production parity; use for dev/manual recovery only unless separately proven. |

SQLite, PostgreSQL, and JSON can implement the same TypeScript `Store`
interface while still having different durability, concurrency, ranking,
migration, search, and operational guarantees.

## 4. Current surface matrix

This matrix records the current design/read-through position. It is not a
certification that every behavior is fully equivalent.

| Surface | SQLite | PostgreSQL | JSON | Claim boundary |
| --- | --- | --- | --- | --- |
| Store selection | Default and explicit. | Explicit or URL selected. | Explicit only. | Selection evidence is not parity evidence. |
| Decisions | Implemented. | Implemented. | Implemented. | Claim exact parity only with cross-backend tests. |
| Decision supersession | Implemented. | Implemented. | Implemented. | Must preserve old/new refs and status. |
| Task states | Implemented. | Implemented. | Implemented. | `task_id` upsert behavior needs parity checks before stronger claims. |
| Knowledge | Implemented. | Implemented. | Implemented. | Superseded/merged/archive semantics require parity evidence. |
| Search memory | LIKE search. | tsvector/ILIKE and optional vector path. | in-memory substring scoring. | Search quality is backend-specific; do not claim ranking parity without fixtures. |
| Conversation events | Implemented. | Implemented. | Implemented. | Must prove dedup, source filters, project filters, and raw-event mirroring per backend. |
| Raw events | Implemented. | Implemented. | Implemented. | Raw source ledger claims require source-ref/hash dedup evidence. |
| Recovery config | Implemented. | Implemented. | Partially compatible/default-oriented. | Admin/config parity requires explicit tests. |
| Recovery quality log | Implemented. | Implemented. | Compatibility behavior only. | Score/report claims require `KUSABI_V2_RECOVERY_SCORE_CONTRACT.md` evidence. |
| Selected restart packs | Implemented. | Implemented. | Implemented. | Startup recovery claim still requires host-adapter evidence. |
| Catch-up log | Implemented. | Implemented. | Implemented. | Cross-backend catch-up claims require duplicate/retry fixture parity. |
| Common DB registry refs | Not live. | Future additive read-only adapter. | Not live. | Common DB support is not claimed. |
| Vector search | Not supported. | Optional when configured. | Not supported. | Vector availability must not be generalized to all backends. |

## 5. Evidence classes

Backend parity evidence must be explicit about what was tested.

| Evidence class | Required content |
| --- | --- |
| Selection evidence | Env vars used, DB URL presence, selected backend, fallback/fail-closed behavior. |
| Schema/migration evidence | Tables/files created, migration state, compatibility with old rows, no destructive rewrite. |
| CRUD evidence | Decisions, task states, knowledge, conversation events, raw events, selected packs. |
| Search evidence | Query corpus, expected hits, ranking expectations, CJK/mixed-language cases, scope filters. |
| Isolation evidence | `agent_id`, optional `project`, and confirmation that `session_id` is provenance only. |
| Recovery evidence | Pack generation/fetch/consume, recovery quality log, recovery score report where applicable. |
| Catch-up evidence | Dry-run no-write behavior, inserted/skipped/failed semantics, duplicate window, retry behavior. |
| Fallback evidence | Explicit backend intent, connection failure behavior, whether fallback was allowed or blocked. |
| Performance evidence | Dataset size, timing, host, backend version, and whether performance is claim-relevant. |
| Common DB evidence | Registry availability, canonical refs, drift findings, or explicit missing evidence. |

Green CI alone is not backend parity evidence unless the CI job actually runs
the backend-specific cases being claimed.

## 6. Parity status labels

Use these labels in reviews and release notes:

| Label | Meaning |
| --- | --- |
| `proven-parity` | Equivalent behavior has cross-backend fixtures and current passing evidence. |
| `implemented-untested-parity` | Code exists, but the specific cross-backend behavior is not proven. |
| `compatible-different` | Behavior is intentionally different and documented. |
| `backend-specific` | The behavior belongs only to one backend, such as PG vector search. |
| `dev-fallback-only` | Useful for local/dev/manual fallback, not release or enterprise claims. |
| `future-design` | Documented target only; no runtime implementation claim. |
| `not-supported` | Must be excluded from claims. |

## 7. Claim gates

| Claim | Required evidence | Not allowed |
| --- | --- | --- |
| SQLite local default works | Clean install, default store selection, core CRUD/search/recovery smoke on SQLite. | PostgreSQL or JSON parity claim. |
| PostgreSQL optional backend works | Explicit PG env, live PG initialization, core CRUD/search/recovery smoke, migration state. | Silent local fallback claim when PG was configured explicitly. |
| JSON fallback works | Explicit `AGENT_MEMORY_DB_TYPE=json`, manual/dev smoke, file path evidence. | Production, shared, enterprise, or parity claim. |
| SQLite/PostgreSQL core parity | Same fixture corpus passes on SQLite and PostgreSQL for the claimed surfaces. | Search ranking, vector, common DB, or startup recovery claims not covered by the corpus. |
| Backend parity for recovery | Pack, selected pack, recovery quality, and recovery score evidence per backend. | Startup recovery claim without host adapter evidence. |
| Common DB aligned storage | Registry lookup, canonical refs, drift verifier output, missing evidence, rollback/no-op behavior. | Common DB support from presence of a PG URL alone. |

## 8. Fallback policy boundary

Fallback behavior is high-risk because it can silently split shared memory.

Current documented policy target:

- SQLite is the local/default store.
- PostgreSQL is the shared/team store.
- Explicit `AGENT_MEMORY_DB_TYPE=postgres` must fail closed when unreachable.
- PostgreSQL outage must not silently redirect shared-memory writes to unrelated
  SQLite or JSON storage when shared-memory intent is explicit.
- JSON is explicit compatibility/dev fallback, not production parity.

Current implementation includes URL-only PostgreSQL fallback to SQLite when the
URL-selected connection fails. That may be acceptable for compatibility, but it
must be recorded as fallback evidence and must not support shared/team backend
claims unless owner-approved policy says otherwise.

Any change from compatibility fallback to stricter fail-closed behavior must be
handled as runtime/storage behavior change in a separate implementation PR.

## 9. Search and ranking boundary

Search behavior differs by backend:

- SQLite uses LIKE search and has no default FTS/vector claim.
- PostgreSQL uses text search/ILIKE and may use vector search when configured.
- JSON uses in-memory substring/scoring behavior.

Therefore:

- exact ranking parity is not claimed;
- vector search parity is not claimed;
- CJK/mixed-language search must be fixture-tested per backend before claims;
- search scope parity must be proven separately for decisions, tasks, knowledge,
  messages, and conversation events;
- recovery score reports must identify the backend used for search evidence.

## 10. Recovery and startup boundary

Backend parity does not prove startup recovery.

A backend can pass memory and pack tests while still lacking:

- host startup injection evidence;
- first model context delivery evidence;
- selected-pack consume evidence;
- recovery score report;
- Claude/Codex path diversity;
- no-restatement evidence.

Startup recovery claims must follow `KUSABI_V2_RECOVERY_SCORE_CONTRACT.md` and
`KUSABI_V2_RELEASE_CLAIM_LADDER.md`.

## 11. Common DB boundary

Common DB alignment is future additive work. It does not exist merely because
PostgreSQL exists.

Before claiming common DB support, evidence must include:

- configured common DB discovery path;
- common registry table availability;
- read-only adapter behavior unless writes are separately delegated;
- canonical agent/workspace/binding refs or exact missing evidence;
- drift verifier output;
- compatibility behavior for existing Wasurezu tables;
- SQLite/local fallback behavior when fallback is in scope;
- rollback or no-op behavior.

Common registry refs are evidence and binding refs. They must not replace
Kusabi memory namespace semantics.

## 12. Required future fixture categories

This document does not create fixtures. Future backend parity fixtures should
cover:

1. default SQLite selection;
2. explicit SQLite selection;
3. explicit PostgreSQL success;
4. explicit PostgreSQL fail-closed;
5. URL-only PostgreSQL fallback behavior;
6. explicit JSON selection;
7. decisions CRUD and supersession;
8. task state upsert by `task_id`;
9. knowledge save/update/supersession/archive states;
10. conversation event dedup and project/source filters;
11. raw event source refs, source hashes, and session provenance;
12. search scope and ranking expectations;
13. selected restart pack fetch/consume/single-use semantics;
14. recovery quality log writes;
15. catch-up inserted/skipped/failed semantics;
16. cross-agent/project isolation;
17. migration from legacy rows;
18. no secret or private reasoning exposure in test output.

The UAMP-level backend fixture catalog is defined in
`KUSABI_V2_UAMP_FIXTURE_CATALOG.md`. It is planning evidence only. Backend
parity claims still require backend-specific fixture files, smoke reports,
selection evidence, migration-state evidence, and owner-reviewed pass/fail
results.

## 13. Positive examples

### SQLite local default claim

No DB env var is set. The server selects SQLite, creates/uses the local DB path,
passes core memory smoke, records backend evidence, and makes only a local
default claim.

### PostgreSQL optional backend claim

`AGENT_MEMORY_DB_TYPE=postgres` and `AGENT_MEMORY_DATABASE_URL` are set. The
server connects to PG, migrations are present, core PG tests pass, and the claim
is limited to the tested PG surfaces.

### JSON compatibility claim

`AGENT_MEMORY_DB_TYPE=json` is set for a local debugging run. JSON files are
created under the compatibility data directory, manual recovery evidence is
recorded, and no production or parity claim is made.

## 14. Negative examples / forbidden claims

- Claiming SQLite/PostgreSQL parity because both classes implement `Store`.
- Claiming PostgreSQL support from package dependency presence alone.
- Claiming common DB support because a PostgreSQL URL is present.
- Claiming startup recovery because a backend stored a restart pack.
- Claiming vector search parity on SQLite or JSON.
- Claiming JSON is production-grade shared storage.
- Claiming backend parity from green CI that did not run backend-specific tests.
- Claiming explicit PostgreSQL intent succeeded after silent fallback to SQLite.
- Treating `session_id` as a backend namespace.
- Changing `AGENT_MEMORY_DATABASE_URL`, `DATABASE_URL`,
  `AGENT_MEMORY_DB_TYPE`, or DB paths as part of a docs-only PR.

## 15. Backend parity maturity ladder

| Level | Allowed claim | Required evidence | Not allowed |
| --- | --- | --- | --- |
| B0 - boundary documented | Backend parity claims have a draft boundary. | This document accepted. | Runtime behavior or parity claim. |
| B1 - fixture plan accepted | Backend parity fixture categories are accepted. | Fixture plan, expected outcomes, owner review. | Fixture implementation claim. |
| B2 - SQLite smoke proven | SQLite default/local smoke is current. | Clean install, store selection, core smoke report. | PG/JSON parity claim. |
| B3 - PostgreSQL smoke proven | PG optional smoke is current. | Live PG run, migration state, core smoke report. | Common DB or vector parity claim beyond tested surfaces. |
| B4 - cross-backend core parity | SQLite and PG pass the same core fixture corpus. | Cross-backend report with gaps and exclusions. | Exact search ranking parity unless tested. |
| B5 - recovery/backend parity | Recovery packs, selected packs, recovery quality, and score reports pass per backend. | Recovery score evidence by backend and host. | Startup recovery without host evidence. |
| B6 - common DB alignment pilot | Common registry refs and drift verifier evidence exist. | Read-only adapter evidence, drift report, rollback/no-op behavior. | Common DB rollout or schema migration claim without protected review. |

## 16. Stop conditions

Stop and create a separate owner-approved work order before any change that
would:

- change store selection;
- change fallback/fail-closed behavior;
- change env vars;
- change DB paths;
- create or alter migrations;
- create schema files;
- create fixture files;
- implement backend parity tests;
- implement a score runner;
- change runtime emitters;
- change startup behavior;
- change package identity;
- change MCP namespace;
- change workflows;
- change deployment files;
- claim backend parity;
- claim common DB support;
- claim UAMP conformance;
- claim legal or regulatory compliance.
