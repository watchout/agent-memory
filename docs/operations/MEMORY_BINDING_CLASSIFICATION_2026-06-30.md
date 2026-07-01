# Memory Binding Classification 2026-06-30

Status: classification evidence / operator execution input
Runtime impact: none
Source issue: https://github.com/watchout/agent-memory/issues/229
Evidence issue: https://github.com/watchout/agent-memory/issues/228
Owner/operator correction:
https://github.com/watchout/agent-memory/issues/228#issuecomment-4841483624

## Purpose

This document converts the memory binding remediation evidence into a
Shirube-controlled classification artifact. It is the bridge between the
read-only audit/runbook work and later operator actions such as local config
edits, host restarts, and smoke evidence.

This document does not edit local MCP configs, restart hosts, perform smoke
writes, mutate stored memory, change runtime behavior, or claim backend parity.

## Source evidence

Read-only audit evidence was recorded in issue #228 on 2026-06-30 JST.

Observed summary:

```json
{
  "binding_count": 29,
  "backend_counts": {
    "postgres-explicit": 21,
    "sqlite-explicit": 8
  },
  "sqlite_file_count": 10,
  "sqlite_files_with_rows": 5,
  "postgres_included": true
}
```

Important interpretation:

- 29 of 29 inspected bindings point at
  `/Users/yuji/Developer/wasurezu-main/dist/index.js`.
- No inspected binding currently lacks `AGENT_MEMORY_PROJECT`.
- No inspected explicit SQLite binding currently has an ignored `DATABASE_URL`.
- 21 inspected bindings are explicit PostgreSQL.
- 8 inspected bindings are explicit SQLite and require classification before
  they can be called remediated.

## Operator execution evidence update 2026-07-01

Operator execution evidence was recorded in issue #228 after the smoke evidence
Cell was merged. The execution batch changed local MCP configs outside the
repository diff, ran bounded spawn-only smoke checks, and then re-ran the
read-only audit.

Evidence refs:

- Cell merge evidence: <https://github.com/watchout/agent-memory/issues/228#issuecomment-4848480944>
- Read-only refresh: <https://github.com/watchout/agent-memory/issues/228#issuecomment-4848488154>
- Read-only refresh audit: <https://github.com/watchout/agent-memory/issues/228#issuecomment-4848526294>
- `dev-001` smoke: <https://github.com/watchout/agent-memory/issues/228#issuecomment-4848985909>
- Remaining PostgreSQL smoke: <https://github.com/watchout/agent-memory/issues/228#issuecomment-4848997737>
- Inactive-in-scan migration targets: <https://github.com/watchout/agent-memory/issues/228#issuecomment-4849010569>
- Active/attached migration candidates: <https://github.com/watchout/agent-memory/issues/228#issuecomment-4849021305>
- Execution batch summary: <https://github.com/watchout/agent-memory/issues/228#issuecomment-4849027238>
- Execution batch audit: <https://github.com/watchout/agent-memory/issues/228#issuecomment-4849065336>

Final read-only audit summary after the execution batch:

```json
{
  "generated_at": "2026-07-01T00:13:05.542Z",
  "binding_count": 29,
  "backend_counts": {
    "postgres-explicit": 26,
    "sqlite-explicit": 3
  },
  "warning_counts": {
    "entrypoint_targets_other_checkout": 29,
    "sqlite_explicit_local_store": 3
  },
  "sqlite_file_count": 10,
  "sqlite_files_with_rows": 5,
  "postgres_included": true
}
```

Local config migrations performed outside repository diffs:

| Binding | Agent | Project | Execution result |
| --- | --- | --- | --- |
| `hotel-lead/.mcp.json#agent-memory` | `hotel-lead` | `hotel-lead` | Local config migrated to explicit PostgreSQL; spawn-only smoke PASS. Existing attached host was not restarted. |
| `hotel-saas-rebuild/.mcp.json#agent-memory` | `hotel-dev` | `hotel-dev` | Local config migrated to explicit PostgreSQL; spawn-only smoke PASS. |
| `secretary/.mcp.json#agent-memory` | `secretary` | `secretary` | Local config migrated to explicit PostgreSQL; spawn-only smoke PASS. Existing active host was not restarted. |
| `upwork-automation/.mcp.json#agent-memory` | `upwork-dev` | `upwork-automation` | Local config migrated to explicit PostgreSQL; spawn-only smoke PASS. |
| `x-marketing-engine/.mcp.json#agent-memory` | `xmarketing-dev` | `x-marketing-engine` | Local config migrated to explicit PostgreSQL; spawn-only smoke PASS. |

Additional PostgreSQL bindings with smoke evidence:

| Binding | Agent | Project | Execution result |
| --- | --- | --- | --- |
| `dev-001/.mcp.json#agent-memory` | `dev-001` | `dev-001` | Spawn-only smoke PASS. |
| `dev-auditor/.mcp.json#wasurezu` | `devauditor` | `dev-auditor` | Spawn-only smoke PASS. |
| `marketing-bot/.mcp.json#agent-memory` | `marketing-bot` | `marketing-bot` | Spawn-only smoke PASS. |
| `research-lead/.mcp.json#agent-memory` | `research-lead` | `research-lead` | Spawn-only smoke PASS. |
| `sales-bot/.mcp.json#agent-memory` | `sales-bot` | `sales-bot` | Spawn-only smoke PASS. |

Remaining explicit SQLite bindings after the execution batch:

| Binding | Agent | Project | Policy state |
| --- | --- | --- | --- |
| `lead-ama/.mcp.json#agent-memory` | `lead-ama` | `lead-ama` | Inactive/archive target; do not migrate or approve as SQLite exception. |
| `lead-sus/.mcp.json#agent-memory` | `lead-sus` | `lead-sus` | Inactive/archive target unless explicitly reactivated by owner. |
| `lead-tuk/.mcp.json#agent-memory` | `lead-tuk` | `lead-tuk` | Inactive/archive target unless explicitly reactivated by owner. |

Not claimed by the execution batch:

- Existing active hosts were not restarted. Already-running `hotel-lead` and
  `secretary` host processes may lag until separately authorized restart.
- Historical SQLite rows were not migrated into PostgreSQL.
- `lead-ama`, `lead-sus`, and `lead-tuk` archive cleanup was not executed.
- `dev-bot-001` remains duplicate/inactive candidate and is not double-counted
  as a separate smoke-passed binding.
- `entrypoint_targets_other_checkout` remains because local MCP bindings point
  at `/Users/yuji/Developer/wasurezu-main/dist/index.js` while current audit
  commands are run from a separate updated checkout.
- `/Users/yuji/Developer/wasurezu-main` remained behind `origin/main` with
  pre-existing uncommitted local changes during this batch.
- Backend parity, common DB completion, UAMP conformance, compliance, release,
  publish, DLP, zero-leakage, historical migration, archive cleanup, and broad
  host restart are not claimed.

## Classification policy

The owner/operator policy is:

- development, handoff, Shirube, repo-specific implementation, coordinator,
  audit, QA, check, CTO, and org-build-reachable bots use shared PostgreSQL if
  retained;
- deleted, retired, replaced, duplicate, or stale alias agents are
  inactive/archive targets, not migration targets and not SQLite exceptions;
- SQLite is limited to local-only, standalone, test-only, migration fixture, or
  offline archive use;
- SQLite exceptions must not be counted as shared common DB evidence;
- local config edits and host restarts are operator actions outside repository
  diffs.

Current approved SQLite exception:

- FX lane only: `tsumiage-claude` and `tsumiage-codex`.

The eight non-FX SQLite bindings detected in the original classification
snapshot must not be treated as approved SQLite exceptions by default. After the
2026-07-01 operator execution batch, only three explicit SQLite bindings remain
in the read-only audit, and all three are inactive/archive targets.

## FX lane exception

The FX lane is a bounded SQLite exception class, not a general development-bot
exception.

Approved FX SQLite exception agents:

- `tsumiage-claude`
- `tsumiage-codex`

Operating assumptions:

- manual operator-driven local research/operation agents;
- outside shared agent-comms queue, heartbeat, evidence, and `next_action`;
- no automatic handoff to other bots by default;
- state sharing, if needed, uses one local SQLite DB or explicit local
  handoff/log;
- no dual-write to shared PostgreSQL.

Current audit applicability:

- the 2026-06-30 audit did not find `.mcp.json` or Claude settings entries for
  `tsumiage-claude` or `tsumiage-codex` under the inspected local paths;
- therefore this exception class does not close any of the currently detected
  8 explicit SQLite bindings;
- if future audits detect these FX lane agents, classify them as
  `explicit_sqlite_local_exception` with `fx_lane_exception` as the owner note.

Risk note:

If the FX lane handles paper/live/order/capital risk, it needs an FX-specific
log, stop conditions, approval boundary, and evidence rules. That should be a
separate FX control surface, not implicit AUN/shared-queue integration.

## Original binding classification snapshot

The following tables preserve the pre-execution classification snapshot from
2026-06-30. See the 2026-07-01 operator execution evidence update above for the
current post-batch counts and remaining SQLite bindings.

### Shared PostgreSQL bindings

These bindings are classified as `shared_postgres` based on explicit
PostgreSQL configuration and current row-count evidence. They still need smoke
evidence when active host restart/remediation is claimed.

| Binding | Agent | Project | Classification | Notes |
| --- | --- | --- | --- | --- |
| `agent-comms-mcp/.mcp.json#agent-memory` | `agent-com-dev` | `agent-comms-mcp` | `shared_postgres` | DB evidence present. |
| `agent-memory/.mcp.json#agent-memory` | `agent-mem-dev` | `agent-memory` | `shared_postgres` | DB evidence present. |
| `ai-dev-framework/.mcp.json#agent-memory` | `adf-dev` | `ai-dev-framework` | `shared_postgres` | Raw/recovery evidence present; structured write smoke still useful. |
| `codex/.mcp.json#agent-memory` | `codex-cto` | `codex` | `shared_postgres` | DB evidence present. |
| `haishin-puls-hub/.mcp.json#agent-memory` | `haishin-dev` | `haishin-puls-hub` | `shared_postgres` | DB evidence present. |
| `hotel-kanri/.mcp.json#agent-memory` | `hotel-dev` | `hotel-kanri` | `shared_postgres` | DB evidence present. |
| `iyasaka-arc/.mcp.json#agent-memory` | `arc` | `iyasaka` | `shared_postgres` | DB evidence present. |
| `iyasaka/.mcp.json#agent-memory` | `arc` | `iyasaka` | `shared_postgres` | Duplicate project/agent boundary with `iyasaka-arc`; smoke should avoid double-count claim. |
| `iyasaka-org/.mcp.json#agent-memory` | `vice` | `iyasaka-org` | `shared_postgres` | DB evidence present. |
| `nyusatsu/.mcp.json#agent-memory` | `nyusatsu-dev` | `nyusatsu` | `shared_postgres` | DB evidence present. |
| `org-build/.mcp.json#agent-memory` | `org-build-dev` | `org-build` | `shared_postgres` | DB evidence present. |
| `tech-lead/.mcp.json#agent-memory` | `cto` | `tech-lead` | `shared_postgres` | DB evidence present. |
| `wasurezu-main/.mcp.json#wasurezu` | `agent-mem-dev` | `agent-memory` | `shared_postgres` | Same agent/project as `agent-memory` binding. |
| `wbs/.mcp.json#agent-memory` | `wbs-dev` | `wbs` | `shared_postgres` | DB evidence present. |
| `webb-dev/.mcp.json#agent-memory` | `webb-dev` | `webb-dev` | `shared_postgres` | DB evidence present. |

### PostgreSQL bindings requiring smoke or inactive classification

These are explicit PostgreSQL but have low or no exact project evidence in the
2026-06-30 row-count snapshot. They are not blocked, but they should not be
called remediated until either smoke evidence exists or the binding is marked
inactive.

| Binding | Agent | Project | Classification | Required next action |
| --- | --- | --- | --- | --- |
| `dev-001/.mcp.json#agent-memory` | `dev-001` | `dev-001` | `shared_postgres_smoke_required` | Run smoke if retained. |
| `dev-bot-001/.mcp.json#agent-memory` | `dev-001` | `dev-001` | `inactive_if_duplicate_or_not_found` | Same target as `dev-001`; do not double-count duplicate binding. |
| `dev-auditor/.mcp.json#wasurezu` | `devauditor` | `dev-auditor` | `shared_postgres_smoke_required` | Canonical runtime is `devauditor`; old `auditor` / `dev-auditor` aliases are inactive/replaced. |
| `marketing-bot/.mcp.json#agent-memory` | `marketing-bot` | `marketing-bot` | `shared_postgres_smoke_required` | Run smoke if retained. |
| `research-lead/.mcp.json#agent-memory` | `research-lead` | `research-lead` | `shared_postgres_smoke_required` | Run smoke if retained. |
| `sales-bot/.mcp.json#agent-memory` | `sales-bot` | `sales-bot` | `shared_postgres_smoke_required` | Run smoke if retained. |

### Corrected non-FX SQLite binding decisions

The current non-FX SQLite bindings are not approved SQLite exceptions. They are
either migration targets, if retained, or inactive/archive targets if deleted,
retired, replaced, duplicate, or stale.

| Binding | Agent | Project | SQLite DB | Corrected classification | Required next action |
| --- | --- | --- | --- | --- | --- |
| `hotel-lead/.mcp.json#agent-memory` | `hotel-lead` | `hotel-lead` | `hotel-lead.db` | `migrate_to_shared_postgres_if_retained_or_inactive_archive` | If retained as handoff/coordinator, migrate; if no longer used, archive. Not a SQLite exception. |
| `hotel-saas-rebuild/.mcp.json#agent-memory` | `hotel-dev` | `hotel-dev` | `hotel-dev.db` | `migrate_to_shared_postgres` | Registry/runtime actual agent appears to be `hotel-dev`, a repo-specific implementation bot. Not a SQLite exception. |
| `lead-ama/.mcp.json#agent-memory` | `lead-ama` | `lead-ama` | `lead-ama.db` | `inactive_archive` | Disabled/retired/replaced_by=`codex-aun`; do not migrate; do not approve as SQLite exception. |
| `lead-sus/.mcp.json#agent-memory` | `lead-sus` | `lead-sus` | `lead-sus.db` | `inactive_archive` | Treat as deleted/retired unless explicitly reactivated by owner; do not migrate; do not approve as SQLite exception. |
| `lead-tuk/.mcp.json#agent-memory` | `lead-tuk` | `lead-tuk` | `lead-tuk.db` | `inactive_archive` | Treat as deleted/retired/stale binding unless explicitly reactivated by owner; do not migrate; do not approve as SQLite exception. |
| `secretary/.mcp.json#agent-memory` | `secretary` | `secretary` | `secretary.db` | `migrate_to_shared_postgres` | Online handoff/coordinator. Not a SQLite exception. |
| `upwork-automation/.mcp.json#agent-memory` | `upwork-dev` | `upwork-automation` | `upwork-dev.db` | `migrate_to_shared_postgres` | Registry/runtime actual agent appears to be `upwork-dev`, a repo-specific implementation bot. Not a SQLite exception. |
| `x-marketing-engine/.mcp.json#agent-memory` | `xmarketing-dev` | `x-marketing-engine` | `xmarketing-dev.db` | `migrate_to_shared_postgres` | Registry/runtime actual agent appears to be `xmarketing-dev`, a repo-specific implementation bot. Not a SQLite exception. |

Cleanup instructions:

- Do not revive `lead-ama`, `lead-sus`, or `lead-tuk` through migration work.
- Do not approve them as SQLite local exceptions.
- Mark stale DB, workspace, tmux, and binding residue as archive/cleanup
  targets.
- Preserve evidence that `lead-ama` was retired and replaced by `codex-aun`.
- If the owner later explicitly reactivates any lead agent, treat it as a new
  retained coordinator/implementation lane that must use shared PostgreSQL.

## Next Cell

The next Cell after this classification PR should be operator execution, not a
runtime repository PR:

`KUSABI-CORE-MVP-MEMORY-BINDING-SMOKE-EVIDENCE-001`

Expected work:

1. retained non-FX SQLite bindings are migrated to shared PostgreSQL outside
   repository diffs;
2. deleted, retired, replaced, duplicate, or stale aliases are marked
   inactive/archive rather than migrated or approved as SQLite exceptions;
3. active PostgreSQL low/no-count bindings are smoked or marked inactive;
4. local config edits, if any, happen outside repository diffs;
5. host restarts happen one at a time;
6. smoke evidence is recorded using the runbook format;
7. a follow-up docs/control PR may summarize smoke evidence, but must not
   include local configs, secrets, or stored memory content.

## Stop conditions

Stop before implementation if:

- a repository diff would include local `.mcp.json`, Claude, Codex, env, secret,
  or DB files;
- runtime behavior would change;
- DB schema, DB path, MCP namespace, package, or env var names would change;
- stored memory content would be exported, revealed, deleted, or rewritten;
- backend parity, common DB completion, federation, UAMP conformance,
  compliance, DLP, zero-leakage, release, or publish claims would be made;
- FX risk controls would be added without a dedicated FX control surface.

## Boundary

This classification does not remediate local configs, restart hosts, run smoke
writes, mutate DB content, change runtime behavior, or authorize release/publish.
It only classifies the current memory binding evidence and defines the next
operator execution Cell.
