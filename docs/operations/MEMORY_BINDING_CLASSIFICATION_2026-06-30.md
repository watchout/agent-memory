# Memory Binding Classification 2026-06-30

Status: classification evidence / operator execution input
Runtime impact: none
Source issue: https://github.com/watchout/agent-memory/issues/229
Evidence issue: https://github.com/watchout/agent-memory/issues/228

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

## Classification policy

The owner/operator policy is:

- development, org-build, Shirube, audit, QA, and check-coordinated bots use
  shared PostgreSQL;
- SQLite is limited to local-only, standalone, test-only, migration fixture, or
  offline archive use;
- SQLite exceptions must not be counted as shared common DB evidence;
- local config edits and host restarts are operator actions outside repository
  diffs.

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

## Current binding classification

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
| `dev-001/.mcp.json#agent-memory` | `dev-001` | `dev-001` | `shared_postgres_smoke_needed` | Run smoke if active, otherwise mark inactive. |
| `dev-bot-001/.mcp.json#agent-memory` | `dev-001` | `dev-001` | `shared_postgres_smoke_needed` | Same target as `dev-001`; decide active binding owner. |
| `dev-auditor/.mcp.json#wasurezu` | `devauditor` | `dev-auditor` | `shared_postgres_smoke_needed` | Run audit-bot smoke if active. |
| `marketing-bot/.mcp.json#agent-memory` | `marketing-bot` | `marketing-bot` | `postgres_inactive_or_smoke_needed` | Mark inactive or run smoke. |
| `research-lead/.mcp.json#agent-memory` | `research-lead` | `research-lead` | `shared_postgres_smoke_needed` | Run smoke if active. |
| `sales-bot/.mcp.json#agent-memory` | `sales-bot` | `sales-bot` | `postgres_inactive_or_smoke_needed` | Mark inactive or run smoke. |

### Explicit SQLite bindings requiring owner classification

These are the current non-FX SQLite bindings. They remain pending until the
owner/operator records either `explicit_sqlite_local_exception` or
`migrate_to_shared_postgres` for each binding.

| Binding | Agent | Project | SQLite DB | Classification | Default recommendation |
| --- | --- | --- | --- | --- | --- |
| `hotel-lead/.mcp.json#agent-memory` | `hotel-lead` | `hotel-lead` | `hotel-lead.db` | `sqlite_owner_classification_required` | Keep SQLite only if local-only; otherwise migrate. |
| `hotel-saas-rebuild/.mcp.json#agent-memory` | `hotel-dev` | `hotel-dev` | `hotel-dev.db` | `sqlite_owner_classification_required` | Development-like; prefer PostgreSQL if active. |
| `lead-ama/.mcp.json#agent-memory` | `lead-ama` | `lead-ama` | `lead-ama.db` | `sqlite_owner_classification_required` | Keep SQLite only if standalone/offline lead lane. |
| `lead-sus/.mcp.json#agent-memory` | `lead-sus` | `lead-sus` | `lead-sus.db` | `sqlite_owner_classification_required` | Keep SQLite only if standalone/offline lead lane. |
| `lead-tuk/.mcp.json#agent-memory` | `lead-tuk` | `lead-tuk` | `lead-tuk.db` | `sqlite_owner_classification_required` | Keep SQLite only if standalone/offline lead lane. |
| `secretary/.mcp.json#agent-memory` | `secretary` | `secretary` | `secretary.db` | `sqlite_owner_classification_required` | Keep SQLite only if local assistant, otherwise migrate. |
| `upwork-automation/.mcp.json#agent-memory` | `upwork-dev` | `upwork-automation` | `upwork-dev.db` | `sqlite_owner_classification_required` | Automation lane; owner decides standalone vs shared. |
| `x-marketing-engine/.mcp.json#agent-memory` | `xmarketing-dev` | `x-marketing-engine` | `xmarketing-dev.db` | `sqlite_owner_classification_required` | Marketing lane; owner decides standalone vs shared. |

## Next Cell

The next Cell after this classification PR should be operator execution, not a
runtime repository PR:

`KUSABI-CORE-MVP-MEMORY-BINDING-SMOKE-EVIDENCE-001`

Expected work:

1. owner/operator records SQLite decisions for the 8 pending bindings;
2. active PostgreSQL low/no-count bindings are smoked or marked inactive;
3. local config edits, if any, happen outside repository diffs;
4. host restarts happen one at a time;
5. smoke evidence is recorded using the runbook format;
6. a follow-up docs/control PR may summarize smoke evidence, but must not
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
