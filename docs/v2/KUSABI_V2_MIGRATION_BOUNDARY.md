# Kusabi V2 Migration Boundary Draft

Status: draft
Scope: migration planning only
Runtime impact: none in this branch

## 1. Purpose

This document separates the Kusabi V2 design reset from runtime, package, MCP, database, and repository migration work.

The goal is to let the repository start using `kusabi` as the V2 product name without accidentally breaking existing users or overstating migration completion.

## 2. Current boundary

Existing operational surfaces are compatibility surfaces until a later approved PR changes them.

| Surface | Current observed state | V2 decision |
| --- | --- | --- |
| Product planning name | Kusabi alias exists in docs | Use `kusabi` in V2 docs. |
| npm package | `wasurezu` | Do not rename in this branch. |
| CLI bins | `kusabi`, `wasurezu`, `agent-memory`, `wasurezu-*` | Keep as compatibility until tested migration. |
| MCP server name | `wasurezu` | Do not rename in this branch. |
| MCP tool namespace | `mcp__wasurezu__*` in docs/profiles | Do not rename in this branch. |
| Environment variables | `AGENT_MEMORY_*`, `DATABASE_URL`, `VOYAGE_API_KEY` | Do not rename in this branch. |
| Default storage path | `~/.agent-memory` | Do not rename in this branch. |
| Schema/policy IDs | `wasurezu-*` in artifacts/docs | Plan rename, but do not change runtime emitters yet. |
| Repository name | `watchout/agent-memory` | Decide after V2 source set is confirmed. |

## 3. Migration phases

### Phase 0: governance and V2 source reset

Allowed:

- add `.shirube/` warn-only scaffold;
- add `docs/v2/` draft source set;
- identify stale or duplicated docs;
- document compatibility boundaries.

Forbidden:

- runtime code changes;
- package rename;
- MCP namespace change;
- DB path migration;
- workflow enforcement;
- deletion of existing design sources.

### Phase 1: source authority cleanup

Allowed after owner/domain-designer review:

- mark old docs as `legacy-v1`, `supporting-evidence`, or `superseded`;
- add front-matter or warnings to stale docs;
- consolidate duplicate requirements into the V2 spec;
- keep archival links for provenance.

### Phase 2: runtime surface inventory

Create a complete inventory of references to:

- `wasurezu`;
- `agent-memory`;
- `AGENT_MEMORY_*`;
- `~/.agent-memory`;
- `mcp__wasurezu__*`;
- `wasurezu-*` schema and policy IDs;
- package, docs, scripts, CI, and host adapter names.

No rename occurs until this inventory is reviewed.

### Phase 3: additive compatibility implementation

Possible changes, each requiring its own approval and tests:

- add `KUSABI_*` env aliases while preserving `AGENT_MEMORY_*`;
- add `kusabi-*` CLI aliases while preserving `wasurezu-*`;
- add docs that prefer `kusabi` commands only when the commands exist;
- add schema aliases or versioned `kusabi-*` artifact IDs;
- add compatibility tests proving old names still work.

### Phase 4: default switch decision

Only after Phase 3 evidence:

- decide whether `kusabi` becomes default CLI/package/MCP name;
- decide whether DB path remains legacy for stability;
- decide whether to rename the repository or create `watchout/kusabi`;
- decide deprecation policy for old names.

### Phase 5: removal or legacy freeze

Removal of old names is not assumed. If removal is proposed, it needs:

- owner approval;
- migration guide;
- rollback plan;
- release note;
- install/upgrade tests;
- data backup and recovery instructions where storage is involved.

## 4. Repository rename vs new repository gate

Do not create or rename a repository until these questions are answered:

1. Does V2 keep the existing GitHub issue/PR history as product history?
2. Does V2 need a clean public repository without V1 internal/stale docs?
3. Is `watchout/agent-memory` retained as legacy maintenance?
4. Are old package, CLI, MCP, and DB surfaces supported indefinitely?
5. Are release, security, and docs references ready for a repository move?

Default decision for this branch: keep work in `watchout/agent-memory` on `v2/kusabi-reset`.

## 5. Safe edit classes

| Class | Examples | Allowed in this branch |
| --- | --- | --- |
| Additive docs | `docs/v2/**`, `.shirube/**` | Yes |
| Existing docs note | README or source-alignment note | Yes, minimal only |
| Existing docs rewrite | Replace old SSOT contents | Not yet |
| Runtime code | `src/**` | No |
| Package metadata | `package.json`, lockfile | No |
| CI/workflows | `.github/workflows/**` | No |
| Deployment | `deploy/**`, docker changes | No |

## 6. First cleanup backlog

- Create owner-confirmed V2 source set.
- Confirm V1 design intent traceability before treating V1 docs as legacy only.
- Mark PRD and feature catalog stale where implementation has moved on.
- Split catch-up preview, ingest, extraction, and promotion semantics.
- Define V2 control-plane state and evidence contract.
- Decide schema IDs for `kusabi-recovery-pack/v1` and compatibility aliases.
- Decide if `conversation_events` remains compatibility table or view.
- Decide if `raw_events` becomes the only canonical source ledger.
- Reconcile SQLite/PostgreSQL fallback and common DB binding policy before runtime rollout.
- Define retention and deletion semantics before runtime changes.
- Define package/repo rename strategy after compatibility inventory.
