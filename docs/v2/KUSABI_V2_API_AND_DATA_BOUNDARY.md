# Kusabi V2 API and Data Boundary Draft

Status: draft
Scope: API, data, compatibility, and implementation-boundary design
Base dependency: PR #182, PR #183, and PR #187
Runtime impact: none

## 1. Purpose

This document defines the V2 API and data boundary for Kusabi without changing
runtime behavior.

It separates:

1. existing compatibility APIs and tables that must keep working;
2. V2 canonical concepts and names;
3. future additive aliases or migrations;
4. evidence required before release or enterprise-quality claims.

## 2. Boundary principle

Kusabi V2 is a product/design reset, not a silent API rewrite.

```text
V2 product/design name: kusabi
Current runtime/package/MCP compatibility name: wasurezu
Current repository/historical project name: agent-memory
```

Existing MCP tool names, package names, CLI names, environment variables, local
paths, tables, and schema IDs remain compatibility contracts until a later
owner-approved migration changes one surface with tests.

## 3. API layers

| Layer | Current surface | V2 status | Notes |
| --- | --- | --- | --- |
| MCP tools | `log_decision`, `search_memory`, `restart_pack`, etc. | Compatibility API | Preserve exact tool names until explicit MCP contract migration. |
| Human-readable recovery | `recover_context`, text `restart_pack` | Compatibility/manual API | Keep for manual users. Prefer structured artifacts for automation. |
| Structured recovery artifact | `recovery-pack/v1` with `wasurezu-recovery-pack/v1` schema ref | Stable concept, V1-named contract | Preserve; add alias/version only after schema migration plan. |
| Host invocation artifact | `host-invocation-context/v1` | Stable concept | Preserve; data-only policy remains core. |
| CLI | `kusabi`, `wasurezu`, `agent-memory`, `wasurezu-*` | Compatibility CLI | Do not remove old bins; add future aliases only with smoke tests. |
| Store interface | `Store` methods in `src/stores/types.ts` | Compatibility implementation contract | Do not change in docs-only V2 reset. |
| DB tables | `decisions`, `task_states`, `knowledge`, etc. | Compatibility data contract | Table renames are out of scope. |
| Env/config | `AGENT_MEMORY_*`, `DATABASE_URL`, `VOYAGE_API_KEY` | Compatibility config contract | `KUSABI_*` aliases require a later design. |

## 4. V2 conceptual model

V2 should describe the product in these terms:

| V2 concept | Current implementation evidence | V2 direction |
| --- | --- | --- |
| Source ledger | `raw_events`, mirrored from `conversation_events` | Prefer `raw_events` as canonical source evidence over time. |
| Compatibility ingest | `conversation_events` | Keep as compatibility table or view until migration. |
| Structured memory | `decisions`, `task_states`, `knowledge` | Preserve; classify as candidate/approved memory depending on evidence. |
| Recovery pack | `restart_pack`, `recovery-pack/v1` | Preserve; make source refs, confidence, redaction, retention, and missing evidence explicit. |
| Selected handoff | `selected_restart_packs`, `restart_pack_fetch` | Preserve; handoff marker only, not lifecycle mutation. |
| Lifecycle evidence | `recovery_quality_log`, planned lifecycle tables | Strengthen in V2 through claim ladder and observability docs. |
| Host adapter | Claude/Codex bridge/runner paths | Preserve; do not claim plain MCP startup automation. |

## 5. MCP API compatibility promise

The following tools are preserved by V2 planning docs:

| Tool | V2 compatibility promise | V2 claim boundary |
| --- | --- | --- |
| `log_decision` | Keep current input shape and memory behavior. | Stored decision is memory evidence, not trusted instruction. |
| `get_decisions` | Keep current filters and active-default behavior. | Results are scoped by agent/project. |
| `supersede_decision` | Keep history-preserving supersession. | Supersession is not deletion. |
| `save_task_state` | Keep task state persistence and lifecycle state. | Retention/expiration semantics need explicit V2 docs. |
| `save_knowledge` | Keep knowledge persistence. | Default is candidate memory unless promotion evidence exists. |
| `get_knowledge` | Keep retrieval and filters. | Retrieval does not make memory approved. |
| `supersede_knowledge` | Keep correction chain. | Correction preserves history. |
| `update_knowledge_status` | Keep archive/merge/status update. | Merge/archive/deletion distinctions must remain explicit. |
| `search_memory` | Keep all current scopes. | Output redaction parity is required before stronger release claims. |
| `recover_context` | Keep manual/legacy recovery. | Layer 1 automation should prefer `restart_pack`. |
| `restart_pack` | Keep text and structured formats. | Schema refs are compatibility contracts. |
| `restart_prepare` | Keep deterministic prepare/recommend/require semantics. | Must not mutate AUN/host lifecycle. |
| `restart_pack_fetch` | Keep selected pack fetch/consume. | Consume marks memory handoff only. |
| `set_recovery_config` | Keep config updates. | Admin/critical action claims require approval evidence. |
| `ingest_conversation_events` | Keep redacted visible-context ingestion. | Broad ingest requires explicit scope/approval rules. |
| `catch_up` | Keep current compatibility tool. | Split preview/ingest/extract/promote before enterprise claims. |

## 6. Data classes and table mapping

| Data class | Current tables / artifacts | Default treatment | V2 direction |
| --- | --- | --- | --- |
| `raw_event_source` | `raw_events`, `conversation_events`, imported transcripts, tool results | Data-only, redacted, provenance-bearing | Source ledger for recovery and extraction. |
| `candidate_memory` | extracted knowledge, summaries, task/decision candidates | Not trusted instruction; requires source refs | Default for agent-written memory unless approved. |
| `approved_memory` | approved decisions/knowledge/task states with evidence | May guide recovery, still not executable instruction | Requires promotion evidence. |
| `trusted_instruction` | control-plane-authored host instruction | Shell-free, no raw context interpolation | Must not be copied from stored text. |
| `untrusted_context` | chat, file, web, queue, external source context | Data-only | Never becomes argv/env/path/branch/flag content. |

## 7. Store/backend boundary

| Backend | V2 support stance | Claim boundary |
| --- | --- | --- |
| SQLite | Primary local-first OSS/default path. | Clean install and migration-idempotency evidence required for release. |
| PostgreSQL | Optional advanced/team path. | Do not claim feature parity where implementation is stubbed or untested. |
| JSON | Compatibility/dev fallback. | Do not position as production store unless explicitly tested. |
| pgvector/Voyage | Optional semantic enrichment. | Must degrade safely when unavailable or rate-limited. |

Known boundary for V2 planning: catch-up log behavior is not yet cross-backend
complete while PostgreSQL support remains TODO/stub. V2 docs must not claim
complete catch-up parity until PG implementation and tests exist.

## 8. Recovery artifact boundary

Structured recovery artifacts are valuable and should be preserved. The V2 rule
is compatibility-first:

| Artifact field/category | V2 requirement |
| --- | --- |
| `pack_id`, `generated_at`, `token_budget` | Required for traceability. |
| `confidence`, `confidence_reasons`, `missing_context` | Required for recovery quality. |
| `source_refs` | Required or explicitly listed in `missing_evidence`. |
| `schema_ref`, `policy_version` | Required for stronger evidence-emission claims. |
| `redaction_summary` | Required for release/enterprise claims. |
| `retention_policy_ref` | Required or explicitly missing before enterprise claims. |
| item `memory_safety_class` | Required for data-only/trust boundary. |
| item `redaction_state` | Required for safety evidence. |
| `promotion_evidence` | Required for `approved_memory`; otherwise downgrade to candidate. |

## 9. Host lifecycle boundary

Kusabi owns memory and recovery evidence. It does not own all runtime lifecycle.

| Mode | Owner of runtime lifecycle | Kusabi role |
| --- | --- | --- |
| Pure MCP | User/host | Manual recovery tools and restart recommendations only. |
| Claude runner/hook | Local operator / supported runner / hook | Prepare and load bounded recovery context with evidence. |
| Codex bridge | User/operator starts bridge; runtime adapter delivers context | Bridge-based startup recovery, not plain MCP automation. |
| AUN/supervisor | AUN or external supervisor | Provide packs, confidence, missing context, provenance, selected refs. |

No V2 doc should claim automatic host restart from plain MCP config.

## 10. Future alias/migration design

Future aliases should be additive:

| Candidate | Rule |
| --- | --- |
| `KUSABI_*` env vars | Add only with precedence rules and tests; preserve `AGENT_MEMORY_*`. |
| `kusabi-*` host adapter CLIs | Add only with smoke tests; preserve `wasurezu-*`. |
| MCP server key `kusabi` | Optional config alias only after host compatibility tests. |
| MCP namespace `mcp__kusabi__*` | Requires explicit MCP contract and tool-discovery tests. |
| `kusabi-recovery-pack/v1` | Prefer schema alias/version plan; preserve existing schema refs. |
| `~/.kusabi` | Avoid unless compelling; storage migrations require backup and rollback. |

## 11. Acceptance criteria for this boundary

This API/data boundary is acceptable when:

- every existing MCP tool has a V2 compatibility decision;
- every current store/backend has a support stance;
- data classes map to current tables/artifacts;
- recovery artifact evidence requirements are explicit;
- host lifecycle ownership is not overstated;
- future alias/migration is separated from docs-only V2 planning.

## 12. Stop conditions

Stop and create a separate owner-approved migration PR if a change would:

- alter tool names or schemas;
- rename package or CLI surfaces;
- change env var behavior;
- move DB paths or table names;
- change schema refs emitted by runtime;
- modify host lifecycle behavior;
- broaden ingest or cross-agent reads;
- treat stored source text as trusted instruction.
