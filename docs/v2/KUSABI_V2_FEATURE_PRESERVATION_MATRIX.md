# Kusabi V2 Feature Preservation Matrix Draft

Status: draft
Scope: feature preservation, non-regression, and V2 redesign boundary
Base dependency: PR #182, PR #183, and PR #187
Runtime impact: none

## 1. Purpose

This matrix exists to protect the original Wasurezu / agent-memory capabilities
while Kusabi V2 resets product naming and design authority.

The V2 reset must not become a silent feature reduction. Existing working
surfaces remain compatibility surfaces unless this matrix or a later
owner-approved migration explicitly changes one surface with tests, release
notes, and rollback guidance.

## 2. Preservation rules

1. V2 docs may rename the product concept to `kusabi`.
2. V2 docs must not imply that existing `wasurezu` package, CLI, MCP, env, DB,
   schema, or storage surfaces have been removed.
3. A feature can be **preserved as-is**, **preserved with clearer boundaries**,
   **redesigned without removing compatibility**, or **deferred for future
   implementation**.
4. A feature cannot be removed by docs-only V2 reset work.
5. Any future runtime migration must add tests proving the old behavior still
   works or explicitly document an owner-approved breaking change.
6. Enterprise-quality claims require evidence, not only implementation presence.

## 3. Decision labels

| Label | Meaning | Runtime implication now |
| --- | --- | --- |
| `preserve` | Keep current capability and compatibility surface. | No runtime change. |
| `preserve-boundary` | Keep capability but document stricter claim / safety boundary. | No runtime change. |
| `redesign-additive` | Redesign conceptually, but only through additive aliases or new docs until tested. | No runtime change. |
| `split-before-claim` | Capability exists but must be decomposed before stronger claims. | No runtime change. |
| `evidence-gated` | Implementation may exist, but release/enterprise claim waits for evidence. | No runtime change. |
| `defer` | Not part of current V2 compatibility promise. | No runtime change. |

## 4. Core MCP memory tools

| Feature / surface | Current compatibility surface | V2 decision | Preservation promise | Required before behavior change |
| --- | --- | --- | --- | --- |
| Decision logging | `log_decision` | `preserve` | Keep tool semantics: record decision, context, tags, project under current agent namespace. | MCP/store regression tests. |
| Decision retrieval | `get_decisions` | `preserve` | Keep active-by-default retrieval and project/tag/status filters. | Query compatibility tests. |
| Decision supersession | `supersede_decision` | `preserve-boundary` | Keep history-preserving replacement; do not redefine replacement as deletion. | Supersession-chain and agent-isolation tests. |
| Task state save | `save_task_state` | `preserve` | Keep current work state persistence and task lifecycle updates. | Task id/upsert and status transition tests. |
| Task state retrieval | store-level `getTaskStates`, recovery surfaces | `preserve` | Keep recovery-readable task state. | Store and restart-pack tests. |
| Knowledge save | `save_knowledge` | `preserve-boundary` | Keep storage of facts/patterns, but treat as candidate memory unless promotion evidence exists. | Knowledge tool tests and safety docs. |
| Knowledge retrieval | `get_knowledge` | `preserve` | Keep active/default retrieval and status/tag/project filters. | Query compatibility tests. |
| Knowledge supersession | `supersede_knowledge` | `preserve-boundary` | Keep history-preserving correction; replacement is not deletion. | Supersession and agent-isolation tests. |
| Knowledge status update | `update_knowledge_status` | `preserve` | Keep archive/merge/status handling. | Merge-target and self-merge tests. |
| Cross-memory search | `search_memory` | `preserve-boundary` | Keep decisions/tasks/knowledge/messages/conversation/all scopes; output must be redacted before stronger release claims. | Secret-output probes for all output paths. |
| Legacy recovery | `recover_context` | `preserve-boundary` | Keep manual/legacy recovery while positioning `restart_pack` as preferred Layer 1 recovery. | Boot/recovery and redaction parity probes. |

## 5. Recovery, restart, and host continuity

| Feature / surface | Current compatibility surface | V2 decision | Preservation promise | Required before stronger claim |
| --- | --- | --- | --- | --- |
| Human-readable restart pack | `restart_pack` default text | `preserve` | Keep manual-compatible text pack. | Restart-pack regression tests. |
| Structured recovery pack | `restart_pack format=recovery-pack-v1` | `preserve-boundary` | Keep schema-shaped artifact; do not rename schema refs until alias strategy exists. | Schema validation and alias migration plan. |
| Host invocation context | `restart_pack format=host-invocation-context-v1` | `preserve-boundary` | Keep data-only `context_data` with trusted wrapper instruction. | Schema validation and adapter delivery tests. |
| Deterministic restart prepare | `restart_prepare` | `preserve-boundary` | Keep fail-closed prepare/recommend/require behavior; do not mutate AUN or host lifecycle. | Host/AUN boundary tests and recovery evidence. |
| Selected pack fetch/consume | `restart_pack_fetch`, `selected_restart_pack:<id>` | `preserve` | Keep selected pack handoff and consume marker; no queue/lifecycle mutation. | Fetch/consume idempotency tests. |
| Claude startup support | `wasurezu-claude-start` + SessionStart hook | `evidence-gated` | Preserve compatibility path; stronger claims require fresh run evidence. | Claude SessionStart recovery evaluation. |
| Codex startup bridge | `wasurezu-codex-start` | `evidence-gated` | Preserve bridge path; plain MCP remains manual recovery. | Codex bridge recovery evaluation and argv limitation docs. |
| Pure MCP manual recovery | MCP tools only | `preserve-boundary` | Keep manual recovery; do not claim startup automation. | Host adapter docs and claim review. |
| TUI fallback | `tui-fallback` delivery mode | `preserve-boundary` | Keep as degraded compatibility only. | Evidence labeling and no primary-automation claim. |

## 6. Conversation, raw event, and catch-up surfaces

| Feature / surface | Current compatibility surface | V2 decision | Preservation promise | Required before stronger claim |
| --- | --- | --- | --- | --- |
| Claude transcript ingest | `ingest_conversation_events source=claude_code` | `preserve-boundary` | Keep redacted visible-context ingest; hidden reasoning and developer/base instructions excluded. | Ingest redaction and source filtering probes. |
| Codex transcript ingest | `ingest_conversation_events source=codex` | `preserve-boundary` | Keep redacted visible-context ingest. | Codex ingest probes. |
| Conversation search | `search_memory scope=conversation` | `preserve-boundary` | Keep focused retrieval; recovery packs must not dump raw transcripts. | Search redaction output probes. |
| Compatibility conversation table | `conversation_events` | `preserve-boundary` | Keep as compatibility ingest table or view. | Raw-ledger migration plan before changing. |
| Canonical source ledger | `raw_events` | `redesign-additive` | Prefer as V2 source ledger over time without removing compatibility table. | API/data boundary and migration tests. |
| Catch-up sweep | `catch_up` | `split-before-claim` | Preserve missed-event sweep but split preview, source ingest, candidate extraction, and promotion before stronger claims. | Source A/PG parity and dedup tests. |
| Catch-up dedup ledger | `catch_up_log` | `evidence-gated` | Preserve SQLite/JSON behavior; do not claim PG parity while PG methods are stubbed. | PG migration and cross-backend parity tests. |

## 7. Storage and backend compatibility

| Feature / surface | Current compatibility surface | V2 decision | Preservation promise | Required before stronger claim |
| --- | --- | --- | --- | --- |
| SQLite default | `AGENT_MEMORY_DB_TYPE=sqlite`, default `~/.agent-memory/memory.db` | `preserve` | Keep local-first, zero-config default. | Clean install smoke and migration-idempotency tests. |
| PostgreSQL optional | `AGENT_MEMORY_DATABASE_URL` / `DATABASE_URL` | `preserve-boundary` | Keep advanced/team backend; claim exact parity only where tested. | PG test suite and catch-up parity work. |
| JSON fallback/dev store | `AGENT_MEMORY_DB_TYPE=json` | `preserve-boundary` | Keep compatibility/dev fallback as documented. | JSON store behavior tests. |
| Vector search | Voyage + pgvector when available | `evidence-gated` | Keep optional semantic search path. | Rate-limit handling and PG/vector tests. |
| agent-comms messages | `agent_messages` read integration in PG mode | `preserve-boundary` | Keep optional integration; SQLite messages stay empty. | Shared-DB compatibility tests. |
| Recovery config | `set_recovery_config`, `recovery_config` table | `preserve-boundary` | Keep tunable limits; enterprise/admin claims require approval evidence. | Admin-surface approval/gate design. |
| Recovery quality log | `recovery_quality_log` | `preserve-boundary` | Keep metric logging; stronger quality claims require score/rubric evidence. | Recovery evaluation reports. |

## 8. Naming and compatibility surfaces

| Feature / surface | Current compatibility surface | V2 decision | Preservation promise | Required before migration |
| --- | --- | --- | --- | --- |
| Product name | `wasurezu`, `Kusabi` alias, `agent-memory` repo | `redesign-additive` | New V2 docs use `kusabi`; old operational names remain. | Naming inventory accepted. |
| Package name | `wasurezu` | `preserve` | Do not rename package in docs-only reset. | Package ownership, install tests, rollback. |
| CLI aliases | `kusabi`, `wasurezu`, `agent-memory`, `wasurezu-*` | `redesign-additive` | Preserve old bins; add future `kusabi-*` aliases only with tests. | CLI smoke matrix. |
| MCP server key | `wasurezu` | `preserve` | Do not change MCP server key in this reset. | MCP host config migration tests. |
| MCP namespace | `mcp__wasurezu__*` | `preserve` | Do not document `mcp__kusabi__*` until implemented. | MCP contract and host tests. |
| Env vars | `AGENT_MEMORY_*`, `DATABASE_URL`, `VOYAGE_API_KEY` | `preserve` | Do not replace env vars; aliases require explicit precedence design. | Env alias tests and docs. |
| Local storage path | `~/.agent-memory` | `preserve` | Do not move DB path without backup/restore migration. | Backup, restore, rollback, user opt-in. |
| Schema and policy IDs | `wasurezu-*`, `recovery-pack/v1`, `host-invocation-context/v1` | `preserve-boundary` | Treat as contracts; alias/version before default switch. | Schema compatibility tests. |

## 9. Release and enterprise-quality surfaces

| Feature / surface | Current state | V2 decision | Preservation promise | Required before claim |
| --- | --- | --- | --- | --- |
| Public alpha claim | planned/gated | `evidence-gated` | No stronger claim from docs reset alone. | Release claim ladder gates. |
| World-class release claim | planned/gated | `evidence-gated` | No production-evaluable claim until evidence complete. | Consecutive recovery score, security, docs, install, observability gates. |
| Security policy | basic policy plus follow-up work | `preserve-boundary` | Preserve no-secret-public-issue guidance and local data sensitivity. | Expanded security/retention doc and probes. |
| Redaction probes | partial on main, more in open work | `evidence-gated` | Require all recovery/search/boot/bridge surfaces before stronger claim. | Gate 0 probe expansion. |
| Observability | recovery quality log exists | `evidence-gated` | Keep logging but require source attribution and sample scorecards for enterprise. | Evaluation reports and audit examples. |

## 10. Non-regression gates for any future Lane C PR

A future runtime/package/MCP/env/storage migration must include:

1. Updated row in this matrix.
2. Compatibility tests for old surface names.
3. Smoke tests for new aliases or defaults.
4. User-facing migration notes.
5. Rollback plan.
6. Explicit claim boundary update.
7. Security and redaction impact review.
8. Clean install check when install or package surfaces change.

## 11. Current conclusion

Kusabi V2 should be treated as a design and quality uplift, not a replacement
that drops V1 capabilities. The current compatibility promise is:

```text
No existing Wasurezu / agent-memory runtime capability is removed by the V2 docs reset.
Kusabi V2 may reorganize naming, source authority, evidence gates, and safety
boundaries, but runtime changes require separate owner-approved work with tests.
```
