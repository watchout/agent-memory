# Kusabi V2 Migration, Compatibility, and Sunset Plan

Status: control plan; no migration is executed by this document

Cell: `CELL-KUSABI-001-MIGRATION-DONE-CLAIM`

Exact source head: `6e85144e4ec22f24d51cf1975c7d0448485df4b7`

## 1. Source and authority

This plan is bound to:

- control source: <https://github.com/watchout/agent-memory/issues/180>
- frozen specification: <https://github.com/watchout/agent-memory/issues/180#issuecomment-4975595110>
- exact handoff: <https://github.com/watchout/agent-memory/issues/180#issuecomment-4975612001>
- existing claim ladder: [`docs/v2/KUSABI_V2_RELEASE_CLAIM_LADDER.md`](v2/KUSABI_V2_RELEASE_CLAIM_LADDER.md)

It is a non-destructive plan only. It does not authorize a package, module,
schema, database, runtime, daemon, deployment, environment, MCP namespace,
workflow, publish, release, alias-removal, or public-claim mutation. Each such
step requires a separate future owner-gated Cell with its own exact handoff,
allowlist, rollback evidence, and independent audit.

## 2. Migration invariants

1. `kusabi` is the canonical V2 product vocabulary and is introduced
   additively.
2. `wasurezu` and `agent-memory` remain working package, module, executable,
   MCP, environment, database-path, documentation, and operator aliases until
   every applicable sunset gate passes.
3. Existing accepted records are never rewritten or deleted merely to rename a
   product or object.
4. Canonical and compatibility paths must produce equivalent domain results;
   string equality alone is not parity evidence.
5. A configured PostgreSQL intent must continue to fail closed. Migration must
   not silently fall back to an unrelated SQLite or JSON store.
6. Planning prose, implementation presence, and a release claim are separate.
   No phase below is evidence that a public V2 level has been reached.
7. AUN owns queue and runtime lifecycle, Shirube owns gate state and authority,
   Kodama owns source-context classification, and Kusabi owns durable context,
   decision, evidence, continuity, and agent-state records. Migration must not
   move those external responsibilities into Kusabi.

## 3. Surface and consumer inventory

Before a protected implementation Cell starts, its inventory must name the
current surface, canonical target, all known consumers, the compatibility
mechanism, read-back evidence, warning channel, rollback action, and owner.

| Surface | Current compatibility surface | Canonical V2 direction | Minimum consumers to enumerate | Required parity/read-back |
| --- | --- | --- | --- | --- |
| npm package/module | `wasurezu`, repository `agent-memory` | additive `kusabi` entry point; package rename is a later owner decision | npm/git installs, MCP configs, scripts, CI, docs, lockfiles | clean install and import/launch from both names against the same build |
| CLI bins | `wasurezu`, `agent-memory`, `wasurezu-*`; current additive `kusabi` bin | `kusabi` command family | shell scripts, launchers, host adapters, runbooks, user configs | exit code, stdout schema, stderr, side effects, and help output parity |
| MCP server/tool names | server `wasurezu`; current tool names such as `recover_context` | canonical Kusabi names may be additive aliases only | Claude, Codex, generic MCP clients, tests, prompts, operator docs | tool discovery plus request/response contract tests for old and new names |
| environment variables | `AGENT_MEMORY_*`, legacy `DATABASE_URL`, host variables | future `KUSABI_*` aliases only after precedence is frozen | launchd, shell profiles, CI, containers, host adapters, deployments | precedence matrix, mixed-config drift result, and fail-closed store selection |
| local paths | `~/.agent-memory/**` | a future canonical path may be added as an alias | SQLite users, logs, selected packs, recovery configs, backups | old-only, new-only, both-present, conflict, rollback, and permissions cases |
| JSON storage | compatibility JSON store and serialized record shapes | canonical V2 adapter over preserved data | development users, fixtures, import/export tools | old file read, canonical write/read, unknown-field preservation, deterministic replay |
| SQLite storage | current default DB and migrations | canonical V2 repository/adapter over existing tables | default local installs, upgrade paths, backups, recovery | legacy DB open, no-op upgrade, canonical round trip, restart, rollback/readback |
| PostgreSQL storage | configured team/backend mode and migrations | canonical V2 repository/adapter over existing tables | shared deployments, pgvector users, operators, migration tooling | configured-intent fail-close, migration checksum, transaction/rollback, canonical round trip |
| schemas/artifacts | current recovery and host-invocation schema names | additive canonical schema refs with explicit legacy map | adapters, saved packs, validators, tests, audits | old artifact accepted, canonical artifact accepted, semantic equivalence, provenance retained |
| docs and examples | `wasurezu`/`agent-memory` operational names | `kusabi` canonical with compatibility labels | README, `docs/**`, examples, troubleshooting, external links | link check, command-example smoke, terminology inventory, future-label check |
| tests and fixtures | current V1-named suites | canonical contract suite plus legacy-alias matrix | unit, integration, clean-install, upgrade, backend and host suites | both paths run against identical fixtures; omissions fail the gate |
| deployment/publish | current repository/package identities; npm unpublished | later owner-approved release identity | GitHub, npm, containers, services, launchd, secrets, support runbooks | dry-run artifact manifest, provenance, rollback/uninstall, owner exact-head decision |

Inventory is incomplete if any repository search hit, packaged file, deployment
template, operator instruction, external integration, or observed consumer is
omitted without an explicit `known_unknown` and owner.

## 4. Additive phases

### Phase M0 — freeze and measure

- Freeze the canonical architecture, domain model, API/CLI contract, legacy map,
  this plan, and the measurable done definition to exact source refs.
- Capture package/module, CLI, MCP, environment, database, path, schema, docs,
  tests, deployment, and publish consumers.
- Record baseline results separately for JSON, SQLite, and PostgreSQL. A result
  for one backend is not parity evidence for another.
- Establish telemetry names that do not contain record content or secrets:
  canonical/legacy entry point, backend, adapter version, result class, warning
  emitted, fallback prevented, and rollback marker.

Exit: an owner accepts the inventory and measurement method. No runtime or
public claim changes occur.

### Phase M1 — canonical adapter and contract

- Add a canonical Kusabi API/CLI adapter without removing or rewriting legacy
  entry points.
- Route both names through one domain contract where possible. Where dual-read
  is required, compare normalized domain objects, provenance, redaction state,
  ordering, and lifecycle state.
- Add canonical contract fixtures and a legacy-alias matrix. At least one V2
  object must be substantively new or an explicit carryover must be justified.
- Emit opt-in deprecation telemetry only after its privacy and retention rules
  are accepted.

Exit: canonical and legacy paths pass the same contract fixtures and divergence
is zero for the accepted fixture set. Any code, package, MCP, or test changes
are owned by separate Cells.

### Phase M2 — persistence realization

- Realize canonical V2 objects through repository adapters without destructive
  table or file renames.
- Prefer additive columns/tables/views or reversible adapter mappings. Record
  schema versions and migration checksums without treating them as release
  evidence by themselves.
- Prove read-after-write, restart recovery, redaction non-resurrection,
  provenance, replay, and rollback separately for JSON, SQLite, and PostgreSQL.
- If dual-write is proposed, define transaction boundaries, partial-failure
  behavior, reconciliation, and a kill switch before activation.

Exit: backend-specific evidence shows accepted-record loss `0`, redacted or
expired resurrection `0`, and rollback/readback success. Every schema or data
step is a separate owner-gated Cell.

### Phase M3 — consumer opt-in and warnings

- Move internal consumers to the canonical entry point one bounded cohort at a
  time while keeping aliases enabled.
- Publish warning policy before warnings: audience, start version, suppression,
  telemetry retention, support link, and rollback.
- Warnings must identify an alias and migration guide without leaking arguments,
  record contents, environment values, connection strings, or paths containing
  secrets.
- Observe legacy use, parity divergence, error rate, latency, recovery quality,
  rollback frequency, and unknown consumers over an owner-approved window.

Exit: each inventoried consumer has a named result; unknown-consumer count is
zero or explicitly blocks sunset.

### Phase M4 — sunset eligibility

- Evaluate, but do not perform, removal against the criteria in section 7.
- Produce a removal impact report proving canonical flows do not depend on the
  alias and that removing it breaks only tested shims.
- Re-run clean install, upgrade, downgrade, backup/restore, all backend,
  redaction, host-adapter, and recovery suites against the frozen candidate.
- Obtain distinct evidence-audit, protected-surface, and owner exact-head
  decisions required by the affected surface.

Exit: a separate removal Cell may be proposed. This phase grants no removal,
publish, deployment, or release authority.

### Phase M5 — removal and post-removal observation

This phase exists only as a future template. A future exact handoff must isolate
one removal surface, define rollback, preserve data readback, and stop on any
canonical-flow regression, unclassified consumer, evidence mismatch, or owner
decision absence. Removal and deployment must not be bundled merely for
convenience.

## 5. Backend compatibility expectations

| Check | JSON | SQLite | PostgreSQL |
| --- | --- | --- | --- |
| legacy read | parse preserved files and unknown fields without destructive rewrite | open supported legacy DB and run idempotent/no-op migrations | verify migration ledger/checksum and supported legacy rows |
| canonical round trip | canonical API write/read yields stable normalized object | transactionally persist and recover after close/reopen | transactionally persist and recover after disconnect/reconnect |
| alias parity | old/new adapters select equivalent objects and provenance | old/new paths share or reconcile the same durable records | old/new paths share or reconcile the same durable records |
| redaction/expiry | deleted, expired, or redacted content never reappears from replay/cache | queries, recovery, backup/restore, and restart return resurrection count `0` | queries, recovery, replicas/restore where claimed, and restart return count `0` |
| failure | malformed/partial file fails explicitly; never silently discards accepted records | locked/corrupt/migration failure stops with recovery instructions | configured PG failure remains PG intent and fails closed |
| rollback | restore exact prior file plus adapter version; prove readback | restore backup/no-op migration and prove readback | rollback transaction/migration under owner-approved procedure and prove readback |

Backend parity may be claimed only for the operations and fixtures that passed
on every named backend. Unsupported, skipped, or unexecuted cases remain
`known_unknown` or `not_built`; they are never inferred from another backend.

## 6. Warning, telemetry, and rollback contract

Every migration Cell must define:

- warning identifier, affected alias, first/last version, delivery surface, and
  suppression/rollback behavior;
- privacy-reviewed telemetry schema, collection window, access, deletion, and
  an explicit ban on record content and secret-bearing values;
- pre-change backup/readback, activation marker, health checks, rollback trigger,
  maximum rollback time, and post-rollback readback;
- a fail-closed divergence policy: canonical/legacy mismatch stops progression,
  preserves both evidence sets, and does not select a winner by inference;
- exact artifact/head, operator, timestamps, backend, fixture results, and
  independent audit refs.

Rollback success means that accepted records, provenance, redaction/expiry
state, and legacy access are mechanically read back. A process exit code or
operator ACK alone is insufficient.

## 7. Sunset and removal criteria

An alias or compatibility surface is not eligible for removal until all are
true:

1. the complete consumer inventory has zero unowned or unknown consumers;
2. canonical API and persistence contract tests pass on the frozen exact head;
3. legacy/canonical parity divergence is zero over the accepted observation
   window and fixture set;
4. JSON, SQLite, and PostgreSQL have explicit supported/unsupported results,
   with no backend result inferred from another;
5. deprecation warnings have run for the owner-approved versions/window and
   telemetry meets privacy/retention policy;
6. accepted-record loss and redacted/expired resurrection are both zero;
7. upgrade, downgrade, backup/restore, clean install, rollback, and uninstall
   evidence is content-addressed and replayable;
8. documentation, tests, MCP tool names, CLI aliases, environment variables,
   packages, modules, schemas, deployment surfaces, and public copy are updated
   by their separately authorized Cells;
9. a removal-impact test proves canonical flows do not import, invoke, read,
   write, or otherwise depend on the alias;
10. distinct audits and the required protected-surface/owner exact-head
    decisions are present.

Failure of any criterion keeps the alias supported. Deadlines or low observed
usage do not override a failed gate.

## 8. Protected future Cell split

The following must remain separate future owner-gated Cells: package/module
identity; each CLI alias family; MCP server/tool aliases; environment precedence;
local path changes; each JSON/SQLite/PostgreSQL schema or data migration;
deployment templates; workflow/required checks; secrets; npm artifacts;
public claim copy; alias removal; publish; release; rollback execution. A Cell
must stop if implementation needs a surface outside its exact allowlist.

## 9. Deterministic failure and recovery

```yaml
failure_and_recovery:
  inventory_omission:
    detect: a required surface or discovered consumer has no classified row
    recover: mark migration blocked; add the exact surface and owner; do not infer completeness
  parity_divergence:
    detect: normalized domain, provenance, redaction, ordering, or lifecycle differs
    recover: stop rollout; preserve both outputs; use the predeclared rollback
  protected_mutation_required:
    detect: work crosses package, schema, runtime, deployment, publish, claim, or removal boundary
    recover: create a separate owner-gated Cell and stop this Cell
  backend_evidence_gap:
    detect: one backend is skipped, unsupported, or represented by another backend's result
    recover: label the backend unknown/not_built and block the corresponding parity claim
  record_loss_or_resurrection:
    detect: accepted_record_loss > 0 or redacted_expired_resurrection > 0
    recover: stop and rollback; preserve tamper-evident evidence for independent audit
  stale_exact_head:
    detect: evidence head, target head, or merge-base differs from the frozen candidate
    recover: mark evidence stale and rerun; no authority is carried forward
```

## 10. Plan completion boundary

This plan is complete when it can be sliced into the future Cells above without
ambiguity. It is not evidence that Kusabi V2 migration is implemented, done,
safe to publish, safe to release, or eligible for alias removal.
