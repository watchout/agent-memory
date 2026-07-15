# Kusabi V2 Measurable Done Definition

Status: frozen evaluation contract; not a completion declaration

Cell: `CELL-KUSABI-001-MIGRATION-DONE-CLAIM`

Exact source head: `6e85144e4ec22f24d51cf1975c7d0448485df4b7`

## 1. Source binding and decision rule

This definition is bound to:

- control source: <https://github.com/watchout/agent-memory/issues/180>
- frozen specification: <https://github.com/watchout/agent-memory/issues/180#issuecomment-4975595110>
- exact handoff: <https://github.com/watchout/agent-memory/issues/180#issuecomment-4975612001>
- release ladder: [`docs/v2/KUSABI_V2_RELEASE_CLAIM_LADDER.md`](v2/KUSABI_V2_RELEASE_CLAIM_LADDER.md)
- migration plan: [`docs/KUSABI_V2_MIGRATION_PLAN.md`](KUSABI_V2_MIGRATION_PLAN.md)

`v2_done` is true only when every gate D01-D14 is `PASS` on one frozen exact
head, every required proof is content-addressed and read back, blocker count is
zero, shipped-claim inferred-evidence count is zero, and all required independent
and owner decisions exist. `PASS_WITH_STOP`, `SKIP`, `UNKNOWN`, stale evidence,
implementation presence, prose, an ACK, green CI by itself, or a report's own
verdict cannot satisfy a gate.

## 2. Required proof tuple

Every gate result must include:

```yaml
required_proof_tuple:
  gate_id: D01-D14
  exact_head: full_git_sha
  source_refs: [content_addressed_inputs]
  command_or_fixture: deterministic_reproduction_ref
  environment: os_node_backend_adapter_versions
  expected: machine_checkable_predicate
  observed: machine_readable_result
  evidence_digest: sha256
  producer_function: implementation_or_verification_function
  independent_audit_ref: distinct_registered_seat_result
  owner_decision_ref: required_for_protected_publish_or_release_claims
  timestamp: rfc3339
```

If a field is inapplicable, the result must state why; it may not omit the field
silently. Evidence is stale when the exact head, source digest, fixture, backend,
adapter, policy version, or relevant environment differs from the evaluated
candidate.

## 3. Binary done gates

| Gate | Predicate required for `PASS` | Minimum completion evidence |
| --- | --- | --- |
| D01 canonical source set | Canonical architecture, domain model, API/CLI contract, legacy concept map, migration plan, and this done definition exist and are bound to frozen source digests. | file digests, source URLs/digests, link/read-back check |
| D02 not a pure rename | At least one substantively new canonical V2 object is implemented, or every carried-over object has an explicit justification and V2 invariant; docs-only/package-only rename is insufficient. | object schema/domain diff, reviewable carryover decisions, negative pure-rename fixture |
| D03 canonical persistence | A canonical V2 API persists and retrieves the V2 object through its supported repository contract. | API contract test plus durable backend readback after process/store reopen |
| D04 compatibility isolation | Canonical flows do not import, invoke, depend on, or select legacy aliases; removing aliases from the test harness breaks only explicit compatibility-shim tests. | alias-disabled canonical suite and dependency/entry-point inventory |
| D05 backend truth | JSON, SQLite, and PostgreSQL each have explicit pass/fail/unsupported results; no backend parity is inferred. | backend matrix, migrations/checksums, round trips, failure and rollback results |
| D06 ownership boundaries | AUN queue/runtime, Shirube gate/authority, Kodama source-context, and Kusabi durable substrate ownership are exact and mechanically tested at integration boundaries. | negative cross-boundary tests and ownership map refs |
| D07 restart durability | Across every claimed backend/adapter, restart recovery loses zero accepted records and preserves identifiers, ordering, provenance, and lifecycle state. | pre/post restart record digests and `accepted_record_loss_count: 0` |
| D08 redaction and expiry | Every retrieval path applies the accepted redaction policy; redacted, deleted, expired, or ineligible data resurrection count is zero after search, recovery, replay, cache, backup/restore, and restart. | per-surface redaction fixtures and `resurrection_count: 0` |
| D09 evidence integrity | Evidence is tamper-evident, provenance-bound, source-bound, policy-versioned, omission-aware, and replayable by a distinct seat. | hashes/signatures or append-only chain evidence, replay instructions/result |
| D10 migration safety | Canonical and legacy surfaces coexist until inventory, parity, warning, observation, rollback, and sunset gates pass; no destructive migration is required. | migration matrix, consumer inventory, divergence `0`, rollback/readback evidence |
| D11 contract breadth | Canonical API/CLI and persistence tests cover positive, negative, authorization, redaction, failure, idempotency, concurrency where claimed, upgrade, downgrade, and alias-isolation cases. | machine-readable fixture report with no unexplained skip |
| D12 recovery quality | Recovery after restart meets the claimed L0-L4 ladder evidence, loses zero accepted records, requires zero project restatements for counted runs, and reports missing context. | scorecards, adapter refs, no-restatement count, missing-context reports |
| D13 claim discipline | Every public claim surface is inventoried and classified; present claims do not exceed verified evidence; shipped claims supported by inferred evidence equal zero. | exact-head claim audit, per-surface refs, blocker/warning/unknown lists |
| D14 protected acceptance | Required policy, redaction, promotion, scenario, operator, evidence-audit, protected-surface, and owner exact-head decisions exist before enterprise, publish, or release claims. | distinct decision refs tied to exact head and content digests |

All count predicates are evaluated over a declared, complete inventory. A zero
computed over an incomplete inventory is `UNKNOWN`, not `PASS`.

## 4. Canonical object and persistence bar

A qualifying V2 object must have a stable identifier, canonical type/version,
agent/project boundary, source references, provenance, lifecycle state,
redaction/eligibility state, created/observed time, and deterministic serialized
form. It must add a substantive V2 invariant or behavior rather than only a new
name. An explicit carryover must record why the V1 object already satisfies the
V2 invariant and which compatibility alias exposes it.

At least one qualifying object must pass this event sequence through the
canonical V2 API:

1. validate and accept the canonical request;
2. persist it through a supported backend adapter;
3. close the process or store connection;
4. reopen through the canonical configuration;
5. retrieve through each applicable canonical retrieval path;
6. compare identifier, normalized body, provenance, lifecycle, redaction state,
   and ordering to the accepted record;
7. replay the evidence using only recorded source refs and versions.

Docs, type declarations, generated fixtures, table presence, migration success,
or a mocked repository alone cannot satisfy D02 or D03.

## 5. Alias-isolation and sunset bar

The candidate must expose a test mode in which legacy entry points are absent.
In that mode all canonical flows and canonical contract tests must still pass.
A second compatibility mode must prove that old package/module, CLI, MCP,
environment, path, schema, and documentation aliases select the same supported
domain behavior. Expected failures after alias removal are restricted to named
shim-discovery and legacy-entry tests; any canonical test failure blocks sunset.

Alias removal remains a separate owner-gated Cell even after this predicate
passes. A passing impact report is eligibility evidence, not removal authority.

## 6. Exact suite ownership boundaries

| System | Owns | Must not be claimed by Kusabi |
| --- | --- | --- |
| Kusabi | durable context, decision, evidence, continuity and agent-state records; persistence/retrieval; redaction and provenance state for those records | queue scheduling/claim/requeue, external runtime restart, governance approval, source-label authority, merge/deploy/publish authority |
| AUN | queue, routing, claim/requeue/finalization and registered runtime lifecycle | durable memory truth, Shirube gate decisions, Kodama source classification |
| Shirube | control artifacts, lifecycle/gate state, evidence/owner/protected decisions and `next_action` routing | product record persistence, queue/runtime implementation, self-approval |
| Kodama | source-context ownership, classification and provenance vocabulary supplied to consumers | Kusabi storage semantics, AUN lifecycle, Shirube gate authority |

Integration evidence must demonstrate that references cross these boundaries as
data/provenance only. A Kusabi call that mutates AUN queue state, manufactures a
Shirube approval, or invents/overrides a Kodama classification fails D06.

## 7. Restart, retrieval, and non-resurrection matrix

The declared inventory must include `search_memory`, `recover_context`,
`restart_pack` text, `recovery-pack/v1`, `host-invocation-context/v1`, selected
pack fetch/consume, boot fallback, CLI output, host adapter output, and every
other public or internal retrieval added by the candidate.

For each claimed backend and adapter, fixtures must cover accepted, redacted,
expired, deleted/ineligible, superseded, conflicting, missing-source,
cross-agent, cross-project, malformed, and interrupted-write records. The
mechanical done predicates are:

```text
accepted_record_loss_count = 0
redacted_expired_deleted_resurrection_count = 0
unauthorized_cross_boundary_retrieval_count = 0
unclassified_retrieval_surface_count = 0
project_restatement_from_scratch_count = 0  # for counted recovery runs
shipped_claim_inferred_count = 0
```

Redaction at persistence does not substitute for output redaction, and output
redaction does not prove deletion/expiry. Backup, cache, replay, and restart
paths are included because stale representations can resurrect data.

## 8. Tamper-evident and replayable evidence

Every evidence packet must bind the candidate head, source inputs, policy and
schema versions, fixture corpus, command, environment, backend, observed output
digest, omissions/skips, producer identity/function, and time. Mutation of a
bound component must invalidate replay. A distinct registered seat must be able
to reproduce the machine result or report an exact mismatch.

Prose copied from implementation, an issue claim, an implementer's self-audit,
or an inferred relation is not verification. Inference may identify a question;
it may not support a shipped capability or release level.

## 9. Enterprise, publish, and release block

Enterprise/pilot, L2-L4, public-release, package-publish, compliance,
attestation, federation, backend-parity, DLP, zero-secret-leakage, or other
protected claims remain blocked until their exact ladder evidence and all
applicable D14 policy, redaction, promotion, acceptance, independent audit,
protected-surface, legal where applicable, and owner exact-head decisions exist.
This done definition and any report produced under it have no approval, merge,
publish, release, deploy, or removal authority.

## 10. Acceptance fixtures

| ID | Input | Expected result |
| --- | --- | --- |
| KMDC-001 | docs-only rename with no persistence or API proof | `v2_done=false` |
| KMDC-002 | legacy alias removal before consumer/parity/warning/sunset gates | `migration_allowed=false` |
| KMDC-003 | redacted or expired record in restart recovery | `recovered_count=0` |
| KMDC-004 | present-tense UAMP, compliance, federation, backend-parity, L2-L4, or enterprise claim without verified evidence | `would_block=true`; `owner_must_not_publish=true` |
| KMDC-005 | planned future guardrail on an explicitly planning-only surface | excluded from shipped claims only when future/non-shipped label is explicit |
| KMDC-006 | inferred evidence offered for a shipped claim | `shipped_claim_inferred_count=0`; claim blocked |
| KMDC-007 | one minimum public surface omitted | `inventory_complete=false`; audit blocked |
| KMDC-008 | current exact-base inventory | every discovered claim has a class plus exact evidence or `known_unknown` |
| KMDC-009 | report says pass but target differs from evaluated exact head | `stale_report=true`; authority remains none |
| KMDC-010 | PR 251 is open or changes | scheduling/audit result unchanged; `dependency_count=0` |

Machine-readable form for parser/read-back checks:

```yaml
fixtures:
  KMDC-001: {expected: {v2_done: false}}
  KMDC-002: {expected: {migration_allowed: false}}
  KMDC-003: {expected: {recovered_count: 0}}
  KMDC-004: {expected: {would_block: true, owner_must_not_publish: true}}
  KMDC-005: {expected: {planning_not_shipped_requires_explicit_label: true}}
  KMDC-006: {expected: {shipped_claim_inferred_count: 0, claim_blocked: true}}
  KMDC-007: {expected: {inventory_complete: false, audit_blocked: true}}
  KMDC-008: {expected: {all_claims_classified_or_known_unknown: true}}
  KMDC-009: {expected: {stale_report: true, authority: none}}
  KMDC-010: {expected: {dependency_count: 0}}
```

## 11. Completion report requirements

A completion packet must state the frozen exact head and merge-base; all changed
paths and content tuples; parsed report target/release/blocker/warning/unknown
counts; the complete minimum surface inventory; KMDC-001 through KMDC-010
results; public-claim-surface diff count; D01-D14 and G1-G7 results; commands and
outputs; independent audit request/result; protected and owner decisions when
required; and an exact `next_action`.

Until that packet proves every predicate, the only valid overall result is
`v2_done=false`. This document itself therefore makes no Kusabi V2 completion
claim.
