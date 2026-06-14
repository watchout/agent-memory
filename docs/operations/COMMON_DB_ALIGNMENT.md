# Common DB Alignment

> Status: #147 Phase 0 contract / docs-only
> Purpose: define how Kusabi/Wasurezu should align with the IYASAKA MCP Common
> DB without changing current runtime behavior.
> Issue: https://github.com/watchout/agent-memory/issues/147
> Parent design: https://github.com/watchout/iyasaka-arc/issues/11

## 1. Current State

Current Wasurezu storage selection is:

1. `AGENT_MEMORY_DB_TYPE=sqlite|postgres|json`
2. `AGENT_MEMORY_DATABASE_URL`
3. legacy `DATABASE_URL`
4. SQLite default

Current PostgreSQL mode stores Wasurezu product state in legacy table names
such as `decisions`, `task_states`, `knowledge`, `recovery_config`,
`recovery_quality_log`, `conversation_events`, `raw_events`, and restart-pack
tables. Agent-comms tables may coexist in the same database, but Wasurezu
currently treats `agent_id` and `project` as application-layer namespace
strings, not as foreign keys to a common registry.

As of this Phase 0 contract, there is no live `IYASAKA_MCP_DATABASE_URL`
discovery path, no `common_*` registry adapter, and no `kusabi_*` migration in
the implementation. This document is a contract for the next slices, not a
runtime rollout claim.

## 2. Target Boundary

Kusabi/Wasurezu owns memory and recovery product state:

- memory partitions
- raw/recovered source events
- memory atoms, edges, episodes, retrieval runs, and consolidation runs
- recovery configs and recovery quality logs
- restart packs and selected restart packs
- recovery target drift evidence

The common DB owns canonical cross-product identity and runtime registry state:

- agents
- workspaces
- agent/workspace bindings
- runtime sessions and invocations
- connector identities
- secret refs
- common audit log

Wasurezu must not become the owner of common identity/runtime registry tables.
It may read common registry rows, bind Wasurezu memory/recovery records to their
canonical refs, and report drift or missing evidence.

## 3. Discovery Precedence

Future common DB discovery should be additive and fail-closed:

1. If `IYASAKA_MCP_DATABASE_URL` is set, treat it as the fixed common DB
   candidate.
2. If `AGENT_MEMORY_DATABASE_URL` is set, treat it as the Wasurezu PostgreSQL
   candidate and detect whether common registry tables are present.
3. If legacy `DATABASE_URL` is set, keep backward compatibility and detect
   whether common registry tables are present.
4. If no PostgreSQL URL is configured, keep the existing SQLite local fallback.

Detection of a PostgreSQL URL must not by itself claim common registry support.
The registry is available only when required common tables are present and a
read-only lookup succeeds.

If `AGENT_MEMORY_DB_TYPE=postgres` is explicit and the configured database
cannot be reached, Wasurezu should continue to fail closed instead of silently
falling back to SQLite. This preserves the current explicit-postgres behavior.

## 4. Common Registry Adapter Contract

Future implementation should put common registry consumption behind a narrow
adapter. The adapter should be read-only for common tables unless a separate
common-infrastructure issue explicitly delegates writes.

Minimum lookup outputs:

| Output | Meaning |
|--------|---------|
| `common_registry_available` | `true` only when common registry tables are present and readable. |
| `canonical_agent_id` | Common registry agent id for the current memory owner, when found. |
| `canonical_workspace_id` | Common workspace id for the current project/workspace, when found. |
| `canonical_binding_id` | Agent/workspace binding id, when found. |
| `runtime_session_id` | Runtime session ref, when supplied by a launcher/adapter or common registry. |
| `missing_evidence` | Exact missing table, row, column, permission, or lookup path. |
| `drift_findings` | Identity or workspace mismatches between Wasurezu, Company Dev OS targets, common registry, and launchers. |

Wasurezu APIs may continue accepting `agent_id` and `project`. When common
registry evidence is available, they should resolve or attach canonical refs.
When it is unavailable, they should preserve existing local behavior and emit
explicit missing-evidence or local-fallback evidence in protected flows.

## 5. Product Table Migration Contract

Future `kusabi_*` product tables must be additive. A migration must not drop,
rename, or rewrite existing Wasurezu tables destructively in the same slice.

Required migration evidence for every common DB implementation PR:

- migration names and checksums
- new or changed tables
- owner classification: `common-owned` or `kusabi-owned`
- rollback or no-op re-run behavior
- compatibility behavior for existing `decisions`, `task_states`, `knowledge`,
  `recovery_config`, `recovery_quality_log`, `raw_events`, and restart-pack
  tables
- SQLite fallback behavior

Legacy table names may remain during migration. Stronger claims, such as full
Kusabi-owned table migration or common-registry-backed memory partitions,
require their own protected implementation PR.

## 6. Drift Verifier Contract

The drift verifier should compare:

- Company Dev OS target overlays
- Wasurezu recovery target registry
- common agent/workspace registry rows, when available
- Codex/Claude launcher identity inputs
- alias approvals in `docs/operations/company-dev-os-recovery-target-aliases.json`

Verifier output must include:

- pass/fail status
- checked registry source
- counts for Company Dev OS targets, Wasurezu registry targets, and common
  registry targets
- block findings for missing launchers, unapproved identity drift, or missing
  required common registry refs when common DB mode is claimed
- warning findings for degraded local fallback, missing optional runtime
  session refs, or explicitly approved aliases

Aliases are compatibility evidence only. They must not hide drift unless the
alias approval exactly matches the source identity, registry identity, cwd, and
expiration policy.

## 7. Runtime And Recovery Evidence

Common DB alignment does not prove recovery success by itself.

When a phase claims common-registry-backed memory/recovery behavior, GitHub
evidence must include:

- configured DB source and discovery path
- common registry availability result
- canonical agent/workspace/binding refs or `missing_evidence`
- Wasurezu memory/recovery product refs
- recovery target drift verifier output
- launcher or adapter identity evidence when runtime behavior is claimed
- backward-compatibility checks for `recover_context`, `search_memory`, and
  `restart_pack`
- SQLite/local fallback check when fallback is in scope

Do not infer success from AUN ACKs, queue ids, Discord projection, TUI
visibility, green CI, or the presence of a PostgreSQL URL alone.

## 8. Protected Gate

#147 is high risk. Any implementation that changes common DB binding, memory
semantics, recovery target sync, launch/restart behavior, or live runtime
behavior must follow:

```text
implementation -> L2 audit -> QA practical smoke -> CTO Go/No-Go
```

This Phase 0 contract does not authorize rollout. It only defines the next
safe implementation boundaries and evidence requirements.
