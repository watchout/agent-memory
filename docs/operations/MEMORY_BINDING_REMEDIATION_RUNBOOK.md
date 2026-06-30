# Memory Binding Remediation Runbook

Status: operator runbook / evidence contract
Scope: Kusabi Core MVP local MCP memory bindings
Runtime impact from this document: none
Source issue: https://github.com/watchout/agent-memory/issues/226

## Purpose

This runbook turns the read-only memory persistence audit into an operator
decision and smoke-evidence process.

The practical problem is not simply whether memory exists. The risky state is
that active agents can write through different local entrypoints, storage
backends, or `agent_id + project` boundaries. That makes recovery evidence hard
to trust even when individual writes succeed.

This document does not change runtime behavior, local MCP configs, package
metadata, workflows, deployment, database schema, environment variable names, or
stored memory content.

## Inputs

The current 2026-06-30 classification artifact is
`MEMORY_BINDING_CLASSIFICATION_2026-06-30.md`.

Use the current audit command as the source of binding evidence:

```sh
node scripts/audit-memory-persistence.mjs --json
```

Use PostgreSQL row counts only when an operator intentionally allows the audit
to query the configured database:

```sh
node scripts/audit-memory-persistence.mjs --include-postgres --json
```

The audit output is metadata-only. It must not be treated as a memory export,
content review, deletion report, or backend parity report.

## Binding decision states

Each active memory binding must be classified into one of these states before it
is called remediated.

| State | Meaning | Required evidence | Allowed local action |
| --- | --- | --- | --- |
| `shared_postgres` | Binding is intended to write to the shared PostgreSQL-backed memory store. | `AGENT_MEMORY_DB_TYPE=postgres`, PostgreSQL URL present, `AGENT_MEMORY_AGENT_ID`, `AGENT_MEMORY_PROJECT`, smoke writes/readbacks hit expected target. | Update local host config, restart host, run smoke. |
| `postgres_url_fail_closed_pending` | PostgreSQL URL exists but DB type is not explicit. Since PR #186 this is fail-closed, but weaker operator evidence. | URL present, no explicit local DB type, audit warning recorded. | Prefer adding `AGENT_MEMORY_DB_TYPE=postgres` locally. |
| `explicit_sqlite_local_exception` | Binding is intentionally isolated in SQLite. | `AGENT_MEMORY_DB_TYPE=sqlite`, dedicated path or accepted default, agent/project present, owner exception reason. | Keep local SQLite and record exception. |
| `sqlite_default_pending_decision` | Binding falls back to default local SQLite without an accepted local-only reason. | Audit warning `sqlite_default_local_store`. | Decide shared PostgreSQL or explicit SQLite exception. |
| `missing_project_pending` | Binding lacks `AGENT_MEMORY_PROJECT`. | Audit warning `missing_project_env`. | Add project locally or record why `project = null` is intentional. |
| `ignored_database_url_pending` | SQLite mode has `DATABASE_URL`, which is ignored. | Audit warning `database_url_ignored_by_sqlite_mode`. | Remove ignored URL locally or document why it remains. |
| `entrypoint_drift_pending` | Binding executes another checkout. | Audit warning `entrypoint_targets_other_checkout`. | Point local config to the intended checkout and rebuild before restart. |
| `retired_or_inactive` | Binding is not active and should not be used as current evidence. | Owner/operator note and no current smoke requirement. | Leave untouched or remove from local config outside repo. |
| `blocked_missing_evidence` | Binding cannot be classified safely. | Missing config, parse error, unavailable host, or failed smoke. | Do not claim remediated. |

## Required owner decisions

Before broad V2 runtime work or release-facing claims, the operator should
record a decision table like this in the relevant issue or PR comment:

| Binding | Decision state | Agent ID | Project | Backend | Evidence ref | Owner note |
| --- | --- | --- | --- | --- | --- | --- |
| `<config>:<server>` | `<state>` | `<agent>` | `<project>` | `<backend>` | `<audit/smoke ref>` | `<reason>` |

Explicit SQLite bindings are allowed for local-only agents, but they must be
accepted as exceptions. They are not evidence of shared common DB behavior.

## Safe remediation sequence

Run remediation one host at a time. Do not restart every active MCP host at
once.

1. Rebuild the intended repo checkout if local configs point at `dist/index.js`.
2. Run the audit and save the summary in the control issue or PR.
3. Classify every active binding using the decision states above.
4. Apply local config changes outside the repository diff.
5. Restart the affected MCP host only after active work is saved and no
   long-running task depends on the old process.
6. Run the smoke sequence for that binding.
7. Record smoke evidence before moving to the next host.
8. Re-run the audit after all intended host restarts.

This sequence intentionally separates repository changes from local operator
config changes. A repository PR must not include `.mcp.json`, Claude settings,
Codex settings, env files, secrets, or local DB content.

## Recommended restart timing

Restart an MCP host when all of these are true:

- current task state has been saved or can be safely re-run;
- no active agent is in the middle of a tool call using the old memory server;
- the intended checkout has been built;
- the local config change has been reviewed;
- a smoke target `agent_id + project` is known;
- the operator is ready to run write/read smoke immediately after restart.

If those conditions are not true, keep the host running and classify the binding
as pending.

## Practical smoke sequence

For each remediated active binding, run a bounded smoke that proves the binding
writes and reads from the expected backend and boundary.

Minimum smoke:

1. `log_decision`
2. `save_task_state`
3. `save_knowledge`
4. `search_memory`
5. `recover_context`
6. `restart_pack`, when the host uses restart recovery
7. `restart_prepare` and `restart_pack_fetch`, when selected restart packs are
   part of the host flow

The smoke should use a unique marker, then remove or supersede the marker only
through existing supported behavior. Do not add deletion/export/reveal behavior
for the smoke.

## Smoke evidence format

Record smoke evidence with this shape:

```yaml
schema_version: kusabi-memory-binding-smoke/v1
binding_ref: "<config path>#<server name>"
agent_id: "<agent>"
project: "<project>"
decision_state: "shared_postgres"
backend_expected: "postgres"
backend_observed: "postgres"
repo_entrypoint: "<redacted or path>"
host_restarted_at: "<iso8601 or not_restarted>"
commands:
  log_decision: pass
  save_task_state: pass
  save_knowledge: pass
  search_memory: pass
  recover_context: pass
  restart_pack: pass | not_applicable
  restart_prepare: pass | not_applicable
  restart_pack_fetch: pass | not_applicable
missing_evidence: []
notes: []
```

This evidence proves only that the tested binding worked at that time. It does
not prove backend parity, common DB completion, cross-agent federation, UAMP
conformance, compliance, DLP, zero leakage, release readiness, or publish
readiness.

## SQLite fallback policy

SQLite remains the default for clean local installs.

Explicit SQLite remains valid for accepted local-only agents.

Configured PostgreSQL intent must not silently write to SQLite when PostgreSQL
is unavailable. After PR #186, URL-only PostgreSQL intent is fail-closed by
runtime behavior. This runbook still prefers explicit
`AGENT_MEMORY_DB_TYPE=postgres` because it is clearer operator evidence.

## Stop conditions

Stop before remediation or implementation if:

- local config changes would be committed to the repository;
- runtime behavior would change;
- package, MCP namespace, env var, or DB path names would change;
- DB schema migration would be required;
- stored memory content would be exported, revealed, deleted, or rewritten;
- cross-agent reads or federation would be enabled;
- backend parity, common DB completion, release, publish, compliance, UAMP
  conformance, DLP, or zero-leakage claims would be made;
- AUN, Kodama, Shirube, workflow, deployment, branch protection, or ruleset
  behavior would change.

## Completion criteria

This remediation step is complete only when:

- every active binding is classified;
- explicit SQLite exceptions have owner notes;
- missing project bindings are fixed or explicitly accepted;
- ignored URLs in SQLite mode are removed or documented;
- affected hosts are restarted at a safe time;
- smoke evidence exists for active shared-memory bindings;
- unresolved bindings are listed as pending rather than silently treated as
  remediated.
