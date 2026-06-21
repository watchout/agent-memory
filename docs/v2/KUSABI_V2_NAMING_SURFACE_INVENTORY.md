# Kusabi V2 Naming Surface Inventory Draft

Status: draft
Scope: naming and compatibility inventory only
Base dependency: PR #182 and PR #183
Runtime impact: none

## 1. Purpose

This document starts the V2 naming-surface inventory required before any runtime,
package, MCP, environment-variable, database-path, schema-ID, repository, or
release-asset rename.

It is intentionally conservative. `kusabi` is the canonical V2 product name for
new V2 design documents. Existing `wasurezu` and `agent-memory` surfaces remain
compatibility surfaces until a separate owner-approved migration changes that
specific surface and proves rollback.

## 2. Inventory status

This is a first-pass planning inventory derived from the reviewed V1 and V2
sources. It is not a complete grep result yet. A later inventory PR must run and
record full-repository checks before any behavior-changing rename.

Required full-pass commands for the later inventory PR:

```text
git grep -n "wasurezu"
git grep -n "agent-memory"
git grep -n "AGENT_MEMORY_"
git grep -n "~/.agent-memory"
git grep -n "mcp__wasurezu__"
git grep -n "recovery-pack/v1"
git grep -n "wasurezu-"
git grep -n "kusabi"
```

Do not read or print local secret files, `.env`, database dumps, or private
transcripts while running the inventory.

## 3. Naming principles

1. New V2 canonical prose uses `kusabi`.
2. Existing operational names are compatibility surfaces, not stale text to
   blindly replace.
3. A compatibility surface can move only through an explicit migration cell with
   tests, docs, rollback, and owner approval.
4. Additive aliases are preferred before default switches.
5. Deletion or removal of old names is not assumed.
6. Schema IDs and policy IDs are API contracts; they require versioning or alias
   strategy, not search-and-replace.
7. Public claims must distinguish product name, package name, MCP namespace, and
   storage path.

## 4. Surface inventory

| Surface | Current observed name or pattern | V2 target direction | Action before rename |
| --- | --- | --- | --- |
| Product/design name | `Kusabi` alias, `wasurezu`, `agent-memory` | `kusabi` in V2 canonical docs | Keep V2 docs consistent; add legacy notices later. |
| Repository | `watchout/agent-memory` | Undecided: keep, rename, or create `watchout/kusabi` | Decide after source set and public-history policy are confirmed. |
| npm package | `wasurezu` | Possibly scoped `@iyasaka/kusabi` or compatibility alias later | Inventory package ownership, publish rights, install tests, rollback. |
| Package lock root | `wasurezu` | Must match actual package decision | Do not edit without package migration PR. |
| Primary CLI bin | `kusabi`, `wasurezu`, `agent-memory` | Prefer `kusabi` only after docs and smoke tests prove it | Preserve `wasurezu` and `agent-memory` compatibility. |
| Host-adapter CLI bins | `wasurezu-codex-start`, `wasurezu-claude-start`, `wasurezu-restart` | Possible `kusabi-*` additive aliases | Add aliases first; keep old commands documented as compatibility. |
| MCP server name | `wasurezu` | Possible optional `kusabi` server key later | Requires host config migration docs and MCP smoke tests. |
| MCP tool namespace | `mcp__wasurezu__*` | Possible alias only after explicit MCP contract | Do not rewrite instructions to unavailable namespace. |
| MCP tool names | `log_decision`, `restart_pack`, etc. | Keep semantic tool names | Product rename should not rename every tool by default. |
| Environment variables | `AGENT_MEMORY_*`, `DATABASE_URL`, `VOYAGE_API_KEY` | Possible `KUSABI_*` aliases, not replacement | Alias semantics, precedence, docs, and tests required. |
| Default local path | `~/.agent-memory` | Prefer stable path until explicit storage decision | DB migration requires backup, rollback, and user approval. |
| Database table names | `decisions`, `task_states`, `knowledge`, etc. | Keep unless schema migration is justified | Table rename is out of V2 planning lane. |
| Structured artifact names | `recovery-pack/v1`, `host-invocation-context/v1` | Preserve concepts; schema alias/version plan later | Schema migration or alias must be tested. |
| Schema refs / policy IDs | `wasurezu-recovery-pack/v1`, `wasurezu-*` governance refs | Possible `kusabi-*` aliases in a later version | Treat as contract IDs; never blind replace. |
| Docs source authority | broad V1 SSOT set | small `docs/v2/**` source set | Classify legacy docs before editing. |
| GitHub Actions text | `wasurezu CI` and related comments | Can remain compatibility text until workflow PR | Workflow changes are out of this slice. |
| Scripts/templates | host adapters, hooks, operator helpers | Pending review | Review before any command rename. |
| Release assets/tags | not yet public-alpha release line | V2 release naming undecided | Release policy and npm package decision required. |

## 5. Safe terminology for V2 docs

Use:

```text
kusabi — V2 product name and canonical design name.
wasurezu — current runtime/package/MCP compatibility name.
agent-memory — current repository name and historical project name.
```

Avoid:

```text
kusabi has replaced wasurezu
wasurezu is deprecated
mcp__kusabi__* is available
KUSABI_* env vars are supported
~/.kusabi is the default database path
```

Those statements become allowed only after the relevant implementation and
compatibility PRs land.

## 6. Migration checkpoints

### Checkpoint 0: Docs-only V2 naming

Allowed now:

- use `kusabi` in `docs/v2/**`;
- describe `wasurezu` and `agent-memory` as compatibility surfaces;
- add classification and inventory documents;
- add non-invasive legacy notices after source classification is accepted.

Forbidden now:

- package or lockfile rename;
- CLI default switch;
- MCP namespace switch;
- environment-variable replacement;
- database path migration;
- schema ID emitter change;
- workflow enforcement or branch protection change.

### Checkpoint 1: Additive alias plan

Prerequisites:

- complete full-repo naming grep;
- owner/domain-designer approval;
- tests proving old names still work;
- docs explaining old and new names;
- rollback plan.

Possible changes:

- additive `kusabi-*` CLI aliases;
- optional `KUSABI_*` env aliases with explicit precedence;
- schema alias documentation;
- README preference shift only for commands that exist.

### Checkpoint 2: Default switch decision

Prerequisites:

- clean install smoke tests;
- compatibility smoke tests for old names;
- release notes and migration guide;
- data backup/restore guidance for any path/storage change;
- public-claim review.

## 7. Initial follow-up checklist

- [ ] Accept or revise PR #182 as the V2 scaffold baseline.
- [ ] Accept or revise PR #183 source classification.
- [ ] Run full naming grep and paste summarized counts into this document.
- [ ] Review `scripts/**`, `templates/**`, `tests/**`, and schema files before
      any rename claim.
- [ ] Decide whether V2 stays in `watchout/agent-memory` or moves to a new repo.
- [ ] Decide whether `wasurezu` remains an indefinite compatibility name.
- [ ] Draft additive alias implementation only after this inventory is complete.

## 8. Stop conditions

Stop and create a separate owner-approved migration work order if a change would
modify any of these:

- `src/**` runtime behavior;
- `package.json` or `package-lock.json` identity;
- MCP server or tool namespace;
- environment variable names or precedence;
- database paths, table names, or migrations;
- schema IDs emitted by runtime;
- GitHub Actions enforcement;
- deployment or publish behavior.
