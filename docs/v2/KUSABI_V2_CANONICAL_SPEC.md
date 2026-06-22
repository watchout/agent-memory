# Kusabi V2 Canonical Spec Draft

Status: draft
Scope: product/design reset only
Runtime impact: none in this branch
Related: watchout/agent-memory#181

## 1. Canonical name

The V2 product name is **kusabi**.

`wasurezu` and `agent-memory` are legacy or compatibility names. They remain operational compatibility surfaces until a separate owner-approved migration changes package names, CLI commands, MCP server names, MCP tool namespaces, environment variables, storage paths, schema IDs, or release assets.

## 2. Product definition

Kusabi is a local-first memory, recovery, and evidence substrate for long-running AI agents.

Its first reference workload is AI coding agents, because coding workflows expose clear task state, artifacts, decisions, tests, and recovery outcomes. The broader category is agent continuity: preserving work, context, decisions, provenance, and recovery evidence across sessions, runtimes, tools, teams, and eventually domains.

It preserves bounded, source-bearing working context across session restarts, compaction, and host changes. It must separate source data, candidate memory, approved memory, and trusted control-plane instructions.

V2 is a quality and trust uplift, not a feature reduction. Existing Wasurezu / agent-memory runtime capabilities remain compatibility commitments unless a separate owner-approved implementation PR changes a specific surface with tests, migration notes, and rollback.

## 3. V2 goals

1. Use `kusabi` as the single product name in new canonical docs.
2. Define the product category as agent continuity substrate, with coding agents as the first reference workload rather than the final product boundary.
3. Reduce the active design source set to a small number of owner-confirmed documents.
4. Preserve existing V1 implementation capabilities while removing stale design claims.
5. Make memory boundaries explicit before runtime changes.
6. Keep stored external text as data-only unless a separate trusted control-plane path is approved.
7. Provide clear evidence for recovery confidence, missing context, redaction, provenance, retention gaps, and lifecycle ownership.
8. Define a release claim ladder strong enough for serious enterprise and major-technology-company evaluation.
9. Close the remaining design gaps before runtime, protocol, package, or migration work begins.

## 4. Non-goals for this draft

- No runtime behavior change.
- No package publish.
- No repository rename.
- No MCP namespace change.
- No database path or schema migration.
- No workflow enforcement.
- No branch protection change.
- No public-alpha or enterprise-readiness claim.
- No removal, deprecation, or default switch of existing compatibility names.
- No claim that sales, marketing, support, research, ops, legal, finance, or other non-coding agent domains are currently implemented.

## 5. V2 canonical source set proposal

Until confirmed, only the following V2 draft files should be treated as the proposed V2 source set:

| Area | Proposed source |
| --- | --- |
| Product and architecture | `docs/v2/KUSABI_V2_CANONICAL_SPEC.md` |
| Product category and positioning | `docs/v2/KUSABI_V2_PRODUCT_CATEGORY_AND_POSITIONING.md` |
| Implementation readiness | `docs/v2/KUSABI_V2_IMPLEMENTATION_READINESS_PLAN.md` |
| Suite interop boundary | `docs/v2/KUSABI_V2_SUITE_INTEROP_BOUNDARY.md` |
| UAMP draft spec | `docs/v2/KUSABI_V2_UAMP_DRAFT_SPEC.md` |
| UAMP conformance plan | `docs/v2/KUSABI_V2_UAMP_CONFORMANCE_PLAN.md` |
| Scale and identity model | `docs/v2/KUSABI_V2_SCALE_AND_IDENTITY_MODEL.md` |
| Compliance attestation boundary | `docs/v2/KUSABI_V2_COMPLIANCE_ATTESTATION_BOUNDARY.md` |
| Migration and compatibility | `docs/v2/KUSABI_V2_MIGRATION_BOUNDARY.md` |
| Repo audit and cleanup backlog | `docs/v2/KUSABI_V2_REPO_AUDIT.md` |
| Source classification | `docs/v2/KUSABI_V2_SOURCE_CLASSIFICATION.md` |
| V1 intent traceability | `docs/v2/KUSABI_V2_V1_INTENT_TRACEABILITY.md` |
| Naming inventory | `docs/v2/KUSABI_V2_NAMING_SURFACE_INVENTORY.md` |
| Fast-lane policy | `docs/v2/KUSABI_V2_FAST_LANE_POLICY.md` |
| Feature preservation | `docs/v2/KUSABI_V2_FEATURE_PRESERVATION_MATRIX.md` |
| API and data boundary | `docs/v2/KUSABI_V2_API_AND_DATA_BOUNDARY.md` |
| Release and quality gates | `docs/v2/KUSABI_V2_RELEASE_CLAIM_LADDER.md` |
| Security and retention | `docs/v2/KUSABI_V2_SECURITY_AND_RETENTION_BOUNDARY.md` |
| Adoption strategy | `docs/v2/KUSABI_V2_IRRESISTIBLE_ADOPTION_STRATEGY.md` |
| Governance scaffold | `.shirube/repo-spec.yaml` |
| Agent policy | `.shirube/agent-policy.yaml` |
| Memory governance cells | `.shirube/cells/*.yaml` |

Existing `docs/design/*`, `docs/requirements/*`, `docs/operations/*`, and `docs/brand/*` remain evidence and legacy context. They are not automatically deleted or rewritten by this draft.

## 6. Memory data model

V2 memory classes:

| Class | Meaning | Default handling |
| --- | --- | --- |
| `raw_event_source` | Imported transcript, host event, tool result, source reference, or raw evidence. | Data-only, redacted, provenance-bearing. |
| `candidate_memory` | Extracted fact, summary, or proposed memory item. | Not trusted instruction; requires source refs. |
| `approved_memory` | Memory promoted by explicit human or policy evidence. | May guide recovery but still must not become executable control text by default. |
| `trusted_instruction` | Control-plane-authored instruction text. | Must be generated by trusted code/path, not copied from raw source text. |
| `untrusted_context` | External, chat, file, web, tool, queue, or transcript context. | Data-only. |

## 7. Memory boundary

Current compatibility boundary:

```text
memory boundary = agent_id + optional project
```

V2 must not treat `session_id` as the memory namespace. Session IDs are provenance and lifecycle evidence. Runtime source such as `codex`, `claude_code`, or `manual` is also provenance, not memory ownership.

Future tenant/user identity can be added only through an explicit approved design and migration.

## 8. Feature preservation rule

The V2 reset preserves existing compatibility surfaces by default.

The controlling preservation record is `KUSABI_V2_FEATURE_PRESERVATION_MATRIX.md`.
A feature can be preserved, boundary-hardened, redesigned additively, split before stronger claims, or evidence-gated. It cannot be removed by docs-only V2 reset work.

Any future runtime/package/MCP/env/storage migration must update the matrix and include compatibility tests for old surfaces.

## 9. Core surfaces to preserve or redesign

| Surface | V2 direction |
| --- | --- |
| `log_decision` / decisions | Preserve as candidate or approved decision memory; require provenance and supersession clarity. |
| `save_task_state` / task_states | Preserve as current-work state; clarify lifecycle and retention. |
| `knowledge` | Preserve but separate candidate, archived, superseded, merged, and approved states. |
| `search_memory` | Preserve all scopes; require output redaction parity before stronger release claims. |
| `recover_context` | Preserve as compatibility/manual recovery. |
| `conversation_events` | Treat as compatibility ingest/source table. |
| `raw_events` | Prefer as canonical source evidence over time. |
| `restart_pack` | Preserve text and structured concepts; rename schema/policy IDs only after migration plan. |
| `restart_prepare` | Preserve fail-closed boundary; must not own external queue/runtime lifecycle. |
| `restart_pack_fetch` / selected packs | Preserve selected handoff semantics. |
| `ingest_conversation_events` | Preserve redacted visible-context ingest; broad ingest remains high risk. |
| `catch_up` | Split preview, source ingest, candidate extraction, and approved promotion before stronger claims. |
| SQLite default | Preserve local-first zero-config path. |
| PostgreSQL optional | Preserve advanced/team path; claim exact parity only where tested. |
| JSON fallback | Preserve compatibility/dev fallback unless later scoped differently. |

## 10. Recovery and host boundary

Kusabi may prepare recovery packs and selected handoff references. Host adapters may deliver bounded recovery context to a host. External orchestrators such as AUN own their own queue, claim, finalization, close, and runtime lifecycle.

Standalone local restart or refresh requires all of:

- external orchestrator absence explicitly confirmed;
- supported local host hook or supervisor available;
- restart lifecycle preauthorized by local operator configuration.

Pure MCP-only mode can prepare packs and recommend manual recovery; it must not claim host lifecycle control.

## 11. V2 evidence requirements

Recovery and memory outputs should identify or explicitly mark as missing:

- pack or memory event ID;
- source refs;
- generated time;
- agent/project boundary;
- confidence and missing context;
- redaction summary;
- retention policy ref;
- memory safety class;
- promotion evidence for approved memory;
- external lifecycle owner when applicable.

The release and enterprise claim gates are defined in `KUSABI_V2_RELEASE_CLAIM_LADDER.md`. Strong claims require evidence packets, not implementation presence alone.

## 12. Security and retention rule

Kusabi is not a DLP system and not a secret manager. It must provide documented, probe-backed redaction and output-boundary controls for known patterns, while honestly stating limitations.

Retention, deletion, archive, export, and reveal behavior must be explicit. Supersession, merge, archive, and expiration preserve history unless a separate owner-approved deletion policy says otherwise.

The controlling boundary is `KUSABI_V2_SECURITY_AND_RETENTION_BOUNDARY.md`.

## 13. Product-category rule

Kusabi's product category is agent continuity substrate.

Coding agents are the first reference workload because they provide clear proof signals. Future domains such as sales, marketing, support, research, ops, legal, and finance are expansion targets and must not be claimed as currently supported until their adapters, source boundaries, retention profiles, and evaluation fixtures exist.

The controlling positioning record is `KUSABI_V2_PRODUCT_CATEGORY_AND_POSITIONING.md`.

## 14. Implementation-readiness rule

Detailed implementation should not begin from the category or adoption strategy alone.

The controlling readiness record is `KUSABI_V2_IMPLEMENTATION_READINESS_PLAN.md`. Runtime, protocol, package, MCP, environment, storage, schema, or migration work requires a work-package design, compatibility promise, tests, rollback/no-op behavior, and owner-approved scope.

The first P0 readiness blocker is the suite interop boundary in `KUSABI_V2_SUITE_INTEROP_BOUNDARY.md`. UAMP, AUN/A2A, Kodama, Shirube, MCP, and host-adapter ownership must be accepted before UAMP schemas or runtime integration work begins.

The controlling UAMP draft mapping record is `KUSABI_V2_UAMP_DRAFT_SPEC.md`.
It does not authorize runtime emitters, schema file creation, schema ID rename,
MCP namespace change, package/env/DB/workflow/deployment change, or UAMP
conformance claims.

The controlling UAMP conformance planning record is
`KUSABI_V2_UAMP_CONFORMANCE_PLAN.md`. It defines future fixture, runner,
evidence-packet, reference-implementation, and second-adapter requirements. It
does not create fixtures, implement a runner, prove Kusabi conformance, or
authorize runtime behavior.

The controlling scale and identity planning record is
`KUSABI_V2_SCALE_AND_IDENTITY_MODEL.md`. It preserves the current
`agent_id + optional project` compatibility boundary and does not implement
tenant/user identity, cross-agent reads, cross-tenant reads, federation, env var
changes, DB schema changes, package changes, MCP namespace changes, or runtime
behavior changes.

The controlling compliance and attestation planning record is
`KUSABI_V2_COMPLIANCE_ATTESTATION_BOUNDARY.md`. It defines evidence surfaces and
draft attestation packet boundaries that may support an operator compliance
workflow later. It does not certify legal or regulatory compliance, implement
deletion/export/reveal behavior, create schema or fixture files, implement hash
chains or signing, or authorize runtime behavior.

## 15. Design cleanup rule

Do not delete older documents merely because they mention `wasurezu`. First classify each document as one of:

- `v2-canonical-draft`;
- `v2-supporting-evidence`;
- `legacy-v1`;
- `superseded-for-v2`;
- `archive-only-candidate`;
- `pending-review`;
- `do-not-edit-in-v2-planning`.

Deletion is allowed only after owner/domain-designer review and a replacement source or explicit archive decision.

## 16. Initial V2 acceptance criteria

The V2 planning slice is acceptable when:

- `.shirube/` scaffold exists in warn-only mode;
- product name is `kusabi` in V2 draft docs;
- product category is agent continuity substrate;
- coding agents are first reference workload, not the final product boundary;
- runtime behavior remains unchanged;
- old docs are not deleted in the first slice;
- feature preservation matrix exists and covers current major surfaces;
- API/data boundary separates compatibility APIs from V2 concepts;
- release claim ladder prevents overclaiming;
- security/retention boundary documents redaction limits and data lifecycle;
- implementation-readiness gates are explicit before runtime work;
- suite interop boundary prevents UAMP/AUN/Kodama/Shirube ownership overlap;
- UAMP draft mapping exists without runtime or conformance claims;
- UAMP conformance plan exists without fixture, runner, runtime, or conformance claims;
- scale and identity model exists without tenant/user/federation claims;
- compliance attestation boundary exists without legal certification or runtime claims;
- known read-coverage gaps and stale documents are documented;
- repository owner/domain-designer confirms or revises this source set.
