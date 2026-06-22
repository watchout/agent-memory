# Kusabi V2 V1 Intent Traceability Draft

Status: draft
Scope: V1 intent review and V2 design alignment
Runtime impact: none
Base dependency: PR #183 (`docs/v2-source-classification`)

## 1. Purpose

This document checks whether the Kusabi V2 draft preserves the design intent of
the current Wasurezu / agent-memory V1 sources.

It is not a runtime implementation plan. It identifies V1 intent that must be
kept, narrowed, or explicitly deferred before V2 runtime, package, MCP, storage,
schema, or workflow changes begin.

## 2. Review Position

The V2 draft preserves the broad V1 direction:

- `kusabi` becomes the V2 product name in new canonical docs.
- `wasurezu` and `agent-memory` remain compatibility surfaces until an approved
  migration changes runtime names or storage paths.
- Current memory boundary remains `agent_id + optional project`.
- `session_id`, runtime source, AUN ids, and common registry refs remain
  provenance or evidence, not the memory namespace.
- Stored transcripts, tool output, and external source text remain data-only
  unless promoted through a trusted path.
- Runtime, package, MCP namespace, env var, DB path, workflow, deployment, and
  branch protection changes remain out of scope for the V2 scaffold.

The V2 draft is not yet complete enough for protected runtime work. The missing
piece is a V2-level trace from V1 control-plane intent to explicit V2 state,
evidence, storage, and claim gates.

## 3. Traceability Matrix

| V1 design intent | V1 source area | V2 interpretation | Required V2 follow-up |
| --- | --- | --- | --- |
| Product is a memory and continuity control plane, not just prompt-time memory. | `SSOT-6_LIVING_MEMORY_CONTROL.md` | Define Kusabi as a deterministic memory, recovery, and continuity substrate. | Strengthen V2 architecture docs around durable control-plane state and deterministic runner actions. |
| Canonical continuity state is durable evidence, not a live TUI transcript or prompt-local memory. | `SSOT-6_LIVING_MEMORY_CONTROL.md` | V2 must make `raw_events`, checkpoints, packs, pack items, and lifecycle events first-class design concepts. | Add V2 control-plane state model before runtime implementation. |
| Every recovery or restart attempt must produce direct evidence. | `SSOT-6_LIVING_MEMORY_CONTROL.md`, `HOST_ADAPTERS.md`, `COMPANY_DEV_OS_PHASE_CONVEYOR.md` | Recovery success cannot be inferred from green CI, queue ACKs, Discord projection, or TUI visibility alone. | Define a V2 evidence contract for memory/recovery work and GitHub issue/PR evidence write-back. |
| Memory boundary is `agent_id + optional project`; `session_id` is not the namespace. | `SSOT-7_RUNTIME_AGENT_BINDING.md` | Preserve current namespace while allowing future tenant/user refs only through approved migration. | Keep launcher/hook identity tests before any runtime or env alias work. |
| Runtime source, AUN identity, and common registry refs are evidence, not ownership. | `SSOT-7_RUNTIME_AGENT_BINDING.md`, `COMMON_DB_ALIGNMENT.md` | V2 may attach canonical refs, but must not replace memory semantics with transient session or queue ids. | Add binding/drift verifier expectations to V2 implementation gates. |
| Raw events and conversation transcripts are source data, not approved memory. | `WASUREZU_MEMORY_SAFETY_GOVERNANCE.md`, `SSOT-4_DATA_MODEL.md` | `conversation_events` is compatibility ingest/source; `raw_events` should become canonical source evidence over time. | Decide whether `conversation_events` remains a table, view, or compatibility facade. |
| Candidate and approved memory must be separated. | `WASUREZU_MEMORY_SAFETY_GOVERNANCE.md` | Candidate memory requires provenance; approved memory requires human or policy promotion evidence. | Define V2 approved-memory promotion paths before claiming approved memory behavior. |
| Trusted instruction is control-plane-authored, not copied memory content. | `WASUREZU_MEMORY_SAFETY_GOVERNANCE.md`, `HOST_ADAPTERS.md` | `trusted_instruction` must be shell-free and must not contain raw transcript instructions or untrusted source text. | Review schema/profile docs before renaming artifacts or changing adapter output. |
| AUN or external supervisor owns queue/runtime lifecycle in suite mode. | `SSOT-6_LIVING_MEMORY_CONTROL.md`, `HOST_ADAPTERS.md` | Kusabi supplies packs, confidence, missing context, and evidence; it does not requeue, finalize, close, or restart AUN-owned runtimes. | Preserve fail-closed host adapter gates and AUN absence checks. |
| Pure MCP-only installs are manual recovery, not startup automation. | `HOST_ADAPTERS.md`, `CODEX_RECOVERY_CONTROL.md` | MCP tools can prepare packs and recommend recovery, but cannot claim host lifecycle control. | Keep support levels and startup recovery claim gates in V2 docs. |
| Structured artifacts are the automation path. | `SSOT-6_LIVING_MEMORY_CONTROL.md`, schema docs | `recovery-pack/v1` and `host-invocation-context/v1` remain valuable compatibility artifacts. | Plan schema/policy ID aliases before any `kusabi-*` artifact rename. |
| SQLite and PostgreSQL are both supported, but shared-memory intent must not split silently. | `SSOT-4_DATA_MODEL.md`, `COMMON_DB_ALIGNMENT.md`, PRs #184-#186 | SQLite is local/default or explicit isolated storage. Configured PostgreSQL intent must fail closed instead of writing to a separate local file. | Reconcile V2 docs with the memory persistence audit and store-selection policy before runtime rollout. |
| Common DB alignment is additive and ownership-preserving. | `COMMON_DB_ALIGNMENT.md` | Common registry tables are common-owned. Kusabi owns memory/recovery state and may attach common refs as evidence. | Require read-only adapter, drift findings, missing evidence, migration checksums, and rollback/no-op evidence. |
| Catch-up needs separated semantics. | `catch-up` docs/code and V2 repo audit | Preview, source ingest, candidate extraction, and approved promotion must be separate. | Do not claim complete cross-backend catch-up until PostgreSQL catch-up log behavior is implemented and tested. |
| Implementation status and product/release claims are different. | `SSOT-1_FEATURE_CATALOG.md` | V2 must not treat existing implementation as public-alpha, enterprise, live enforcement, or rollout proof. | Add claim-level gates for public startup recovery, evidence emission, and live enforcement. |
| High-risk reveal/admin surfaces require approval or explicit evidence. | governed action profiles | `search_memory`, `recover_context`, `restart_pack`, `restart_prepare`, broad ingest, and `set_recovery_config` remain governed surfaces. | Review governed action profiles and schemas before claiming enforcement or changing tool policy. |
| Supersession is not deletion. | memory safety governance and data-model docs | V2 cleanup can mark docs and memory as superseded while preserving provenance. | Define retention, deletion, archive, export, and merge semantics before runtime behavior changes. |

## 4. V2 Decisions To Adopt

### 4.1 Product definition

Kusabi V2 should be described as:

> A local-first memory, recovery, and continuity control-plane substrate for AI
> coding agents.

The "control-plane" wording matters. The original design intent was not only to
store memory, but to preserve durable evidence about context loss, restart,
handoff, recovery confidence, missing context, lifecycle owner, and outcome.

### 4.2 Canonical continuity state

V2 should preserve the V1 canonical state model:

| State | V2 treatment |
| --- | --- |
| `raw_events` | Canonical source ledger target. |
| `conversation_events` | Compatibility ingest/source surface until replaced or converted. |
| `session_checkpoints` | Required V2 design concept before full control-plane claims. |
| `recovery_packs` / `restart_packs` | Bounded recovery evidence, not lifecycle authority by itself. |
| `recovery_pack_items` | Source-bearing, redacted, ranked recovery content. |
| `selected_restart_packs` | Handoff refs and consume state; does not mutate AUN lifecycle. |
| `session_lifecycle_events` | Required audit trail for observe, prepare, recommend, execute, load, degrade, and fail outcomes. |

Existing implementation may not expose every table above. V2 docs must not
claim full control-plane runtime completion until the missing state is either
implemented or explicitly represented as missing evidence.

### 4.3 Evidence contract

Every V2 memory/recovery attempt should record or explicitly mark missing:

- action or reason;
- owner: `kusabi`, `aun`, `host`, or `user`;
- agent id and project boundary;
- session id or explicit missing session evidence;
- affected task, claim, goal, or work item;
- pack id or selected pack ref;
- source event ids and provenance refs;
- confidence and missing context;
- redaction summary and omission reasons;
- memory safety class;
- promotion evidence when memory is treated as approved;
- lifecycle outcome: full, partial, degraded, failed, resumed, requeued, or left
  pending;
- external lifecycle owner when applicable.

When memory/recovery work is part of a Company Dev OS phase, the same evidence
must be written back to the GitHub issue or PR as durable review evidence.

### 4.4 Storage and fallback policy

V2 should preserve both SQLite and PostgreSQL support:

- SQLite remains the zero-config local/default store and an explicit isolated
  store when `AGENT_MEMORY_DB_TYPE=sqlite`.
- PostgreSQL remains the shared/multi-agent store.
- A configured PostgreSQL URL without an explicit local-store override is
  PostgreSQL intent and must fail closed if unreachable.
- PostgreSQL outage must not silently redirect shared memory writes to an
  unrelated SQLite or JSON store.
- Common DB registry support is additive. Common registry rows are evidence and
  binding refs, not Kusabi-owned memory semantics.

This policy must be reconciled with the memory persistence audit, SQLite legacy
raw-events migration, and configured-PostgreSQL fail-closed work before active
MCP hosts are restarted for V2 runtime claims.

### 4.5 Claim-level gates

V2 must keep these claims separate:

| Claim | Required before claiming |
| --- | --- |
| Local memory works | Passing SQLite/PostgreSQL tests and direct binding smoke for the target host. |
| Startup recovery works | Host-specific startup hook/adapter evidence, not just MCP tool availability. |
| Structured recovery works | Schema-valid `recovery-pack/v1` or V2 alias plus provenance, confidence, redaction, and missing evidence. |
| Evidence emission is complete | `policy_version`, redaction summary, omission counts, promotion evidence, and exact missing-evidence fields. |
| Live enforcement works | Approval owner integration, fail-closed critical actions, approval/execution-attempt evidence, and separate AUN/Shirube/Kodama gates. |
| V2 migration is complete | Compatibility tests for old names, aliases for new names, storage migration evidence, rollback/no-op behavior, and owner approval. |

## 5. Current Gaps Before Runtime Work

1. `docs/design/schemas/**` has not been fully reviewed for V2 schema/policy ID
   migration.
2. Governed action profiles are still V1-named and need V2 classification before
   live enforcement or policy claims.
3. V2 docs do not yet define a full control-plane state model with checkpoints,
   recovery pack items, and lifecycle events.
4. V2 docs do not yet contain a complete API/data model boundary.
5. Retention, deletion, export, archive, merge, and TTL semantics remain draft.
6. Common DB runtime binding, drift verifier output, and migration ownership are
   still future protected implementation work.
7. Memory persistence operational fixes and store-selection policy need to be
   reconciled into the V2 design branch before any runtime restart or rollout.

## 6. Acceptance Gate Before V2 Runtime PRs

Do not start V2 runtime/package/MCP/env/DB migration until all of the following
are true:

1. V2 scaffold and source classification are owner/domain-designer accepted.
2. This V1 intent traceability is accepted or revised.
3. Source inventory covers names, schema IDs, MCP namespaces, env vars, DB paths,
   scripts, templates, workflows, and host adapters.
4. Schema and governed-action profile review is complete.
5. Storage/fallback policy is reconciled with current runtime fixes.
6. V2 API/data model and control-plane evidence contracts exist.
7. Required smoke evidence is defined for SQLite, PostgreSQL, local fallback,
   common DB binding, host startup recovery, and rollback/no-op migration.

## 7. Boundary Statement

This document does not authorize runtime code changes, package changes, MCP
namespace changes, environment variable renames, database path changes, storage
migrations, workflow enforcement, branch protection changes, deployment changes,
or existing V1 doc deletion.
