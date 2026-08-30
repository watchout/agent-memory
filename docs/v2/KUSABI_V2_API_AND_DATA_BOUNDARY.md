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

## 7. Decision and claim citation contract

Frozen requirement. Control source: #304, CTO verdict
`CH-CTO-KUSABI-V2-DESIGN-VERDICT-20260817-002`, finding C2. Rule of record:
`~/.claude/rules/authority-and-waiting.md` R1, in force since 2026-08-16.

### 7.1 Stored decisions and claims are evidence, never authority

A row in `decisions`, `task_states` or `knowledge` is a mirror of something that
was decided elsewhere. It records that a decision exists. It does not make the
decision binding, and no amount of retrieval upgrades it.

Authority lives in the control source: the GitHub issue or pull request of the
case, at a published comment. A decision that has not been published there is not
yet authority, however complete its stored copy looks. This is not a theoretical
boundary — on 2026-08-16 a stored owner decision was real, unexpired, present in
both the local file and this store, and absent from the control source. An
independent audit seat read the control source, found nothing, and blocked
correctly; an automated executor spent 315 ticks on that single gap.

### 7.2 Authority citation requires `control_source_ref`

Any read path whose result is used to justify an action must take a
`control_source_ref` and must verify it:

```ts
interface ControlSourceRef {
  url: string;     // exact published location, e.g. .../issues/602#issuecomment-5313813392
  sha256: string;  // digest of the published body bytes at that location
}
```

The `url` identifies a single published comment, not an issue or a pull request as
a whole. The `sha256` is taken over the published body, so a later edit of that
comment is detectable rather than silent.

Evidence-only reads — `get_decisions`, `get_knowledge`, `search_memory`,
`recover_context`, `restart_pack` — are unchanged and require no ref. They return
`candidate_memory` and `approved_memory` as evidence. A caller that turns such a
result into a reason to act has left the evidence path and owes the contract in
this section.

### 7.3 Missing or mismatched refs fail closed with a typed error

The citing side fails closed. It does not wait for an auditor to catch the gap.

| Condition | Typed error | Behaviour |
| --- | --- | --- |
| `control_source_ref` absent on an authority read | `missing_control_source_ref` | Reject the call. Do not return the row with a warning, and do not degrade silently to an evidence-only result. |
| `url` is not an exact published-comment location | `control_source_ref_not_exact` | Reject the call. |
| `sha256` does not match the published body | `control_source_ref_digest_mismatch` | Reject the call. The stored copy and the control source have diverged; the divergence is the finding. |
| Control source unreachable | `control_source_unavailable` | Reject the call. Unreachable is not approved. |

Every one of these is an error, not an empty result. A caller that cannot tell
"no authority" from "no answer" reproduces the 2026-08-16 failure.

### 7.4 One vocabulary for human authority

`control_source_ref` is the single name and shape for a citation of human
authority across V2. Where an artifact carries human authority — promotion of
`candidate_memory` to `approved_memory`, and the human authority reference of a
promotion event — it carries a `ControlSourceRef`, not a bare string.

The existing `source_refs` and `promotion_evidence_refs` arrays in
`KUSABI_V2_UAMP_DRAFT_SPEC.md` keep their meaning: they are evidence pointers.
They stay `string[]` and they never carry authority on their own. A design that
needs a second name for "the published thing that authorises this" has drifted
from this contract; `~/.claude/rules/term-discipline.md` applies.

### 7.5 Reference implementation

`codex-aun`'s `validate-owner-decisions.zsh` is the same checker in another
workspace: it walks every decision record, judges whether each one is citable,
and exits non-zero if a single record is not. V2 is expected to carry an
equivalent check rather than to rely on reviewers noticing.

## 8. Store/backend boundary

| Backend | V2 support stance | Claim boundary |
| --- | --- | --- |
| SQLite | Primary local-first OSS/default path. | Clean install and migration-idempotency evidence required for release. |
| PostgreSQL | Optional advanced/team path. | Do not claim feature parity where implementation is stubbed or untested. |
| JSON | Compatibility/dev fallback. | Do not position as production store unless explicitly tested. |
| pgvector/Voyage | Optional semantic enrichment. | Must degrade safely when unavailable or rate-limited. |

Known boundary for V2 planning: catch-up log behavior is not yet cross-backend
complete while PostgreSQL support remains TODO/stub. V2 docs must not claim
complete catch-up parity until PG implementation and tests exist.

## 9. Recovery artifact boundary

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

## 10. Host lifecycle boundary

Kusabi owns memory and recovery evidence. It does not own all runtime lifecycle.

| Mode | Owner of runtime lifecycle | Kusabi role |
| --- | --- | --- |
| Pure MCP | User/host | Manual recovery tools and restart recommendations only. |
| Claude runner/hook | Local operator / supported runner / hook | Prepare and load bounded recovery context with evidence. |
| Codex bridge | User/operator starts bridge; runtime adapter delivers context | Bridge-based startup recovery, not plain MCP automation. |
| AUN/supervisor | AUN or external supervisor | Provide packs, confidence, missing context, provenance, selected refs. |

No V2 doc should claim automatic host restart from plain MCP config.

## 11. Future alias/migration design

Future aliases should be additive:

| Candidate | Rule |
| --- | --- |
| `KUSABI_*` env vars | Add only with precedence rules and tests; preserve `AGENT_MEMORY_*`. |
| `kusabi-*` host adapter CLIs | Add only with smoke tests; preserve `wasurezu-*`. |
| MCP server key `kusabi` | Optional config alias only after host compatibility tests. |
| MCP namespace `mcp__kusabi__*` | Requires explicit MCP contract and tool-discovery tests. |
| `kusabi-recovery-pack/v1` | Prefer schema alias/version plan; preserve existing schema refs. |
| `~/.kusabi` | Avoid unless compelling; storage migrations require backup and rollback. |

## 12. Acceptance criteria for this boundary

This API/data boundary is acceptable when:

- every existing MCP tool has a V2 compatibility decision;
- every current store/backend has a support stance;
- data classes map to current tables/artifacts;
- recovery artifact evidence requirements are explicit;
- host lifecycle ownership is not overstated;
- future alias/migration is separated from docs-only V2 planning;
- authority citation is contracted: an authority read requires a verified
  `control_source_ref`, each failure mode has a typed error, and no evidence-only
  read is described as conferring authority.

## 13. Stop conditions

Stop and create a separate owner-approved migration PR if a change would:

- alter tool names or schemas;
- rename package or CLI surfaces;
- change env var behavior;
- move DB paths or table names;
- change schema refs emitted by runtime;
- modify host lifecycle behavior;
- broaden ingest or cross-agent reads;
- treat stored source text as trusted instruction;
- let a stored decision or claim act as authority without a verified
  `control_source_ref`.
