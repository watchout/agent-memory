# Kusabi v2 domain model

Status: canonical domain design; not a persistence or runtime claim

Control source: [issue #180](https://github.com/watchout/agent-memory/issues/180)

Architecture: [KUSABI_V2_ARCHITECTURE.md](./KUSABI_V2_ARCHITECTURE.md)

Compatibility mapping: [KUSABI_V2_LEGACY_CONCEPT_AUDIT.md](./KUSABI_V2_LEGACY_CONCEPT_AUDIT.md)

## 1. Common identity and scope

Every canonical object carries the following envelope, either as stored fields
or as an immutable embedded value for derived objects:

| Field | Rule |
| --- | --- |
| `object_id` | Globally unique within the Kusabi object type; deterministic when created from an idempotency key. |
| `tenant_ref` | Optional until tenant identity is implemented. Absence is explicit and is not inferred from a project or agent. |
| `project_ref` | Optional compatibility scope; if present it must match the caller's authorized project boundary. |
| `agent_ref` | Required memory-owner reference for agent-scoped records; current compatibility value is `agent_id`. Shared objects state their explicit scope instead of using a different agent's namespace. |
| `source_refs[]` | Immutable provenance references. Empty is allowed only for a locally originated event whose actor and creation evidence are recorded. |
| `policy_refs[]` | Exact policy versions for redaction, retention, promotion, retrieval, or identity decisions when those rules apply. |
| `created_at` / `sequence` | Stable event time plus monotonic or causal ordering data. Arrival order alone is not conflict resolution. |
| `idempotency_key` | Required on writes that can be retried. Same key and same payload resolves to the same identity; same key and different payload is a conflict. |
| `redaction_state` | Versioned state plus omission/tombstone evidence. Unknown state is ineligible for protected recovery. |
| `retention_state` | Active, archived, expired, or deleted/tombstoned under an exact `policy_ref`. |

The current compatibility boundary remains `agent_id + optional project`.
Tenant/user identity is not implemented by this model. `session_id`, runtime,
AUN queue IDs, and Shirube cells are provenance, not ownership namespaces.

## 2. Canonical object matrix

The storage column describes domain durability, not a claim that a matching v2
table already exists.

| Object | Canonical identity and scope | Provenance authority | Storage / lifecycle | Mutation rule | Compaction / regeneration | Redaction, retention, non-resurrection | Ordering, idempotency, conflict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `context_record` | `context_record_id`; tenant/project/agent envelope; source-kind and subject scope | Original host/raw event or Kodama `source_ref`; Kusabi owns only the memory derivative | Durable canonical record; candidate/approved/superseded/archived/expired | Content and attached source refs are append-only; lifecycle changes use events, never in-place provenance rewrite | May compact into a new summary record with complete input refs; original retention policy still applies | Redaction precedes eligibility; tombstones and source policy prevent deleted/expired input from reappearing in summaries or packs | Source sequence then stable object ID; write retry uses source digest/idempotency key; contradictory records coexist and are reported |
| `decision_record` | `decision_record_id`; tenant/project/agent plus decision subject | Human/tool event `source_ref`; promotion evidence when treated as approved | Durable canonical record; proposed/active/superseded/revoked/archived | Decision text and origin are append-only; status changes create linked events or successor records | May derive a current-decision view; canonical history is not compacted away | Sensitive fields may be redacted; expiry/removal excludes the decision from recovery without deleting its non-sensitive supersession/tombstone evidence | Causal supersession order; duplicate intent key resolves idempotently; concurrent active decisions surface a conflict rather than last-write-wins |
| `evidence_record` | `evidence_record_id`; scope of the claim/artifact it supports | Immutable external `source_ref` or locally generated digest/envelope | Durable canonical evidence metadata; payload may remain external | Append-only attestations/status observations; changed external content requires a new digest/reference | Indexes and verification views may regenerate; evidence identity/digest and history remain | Redact copied metadata; external retention is honored; an inaccessible/deleted source becomes unresolved and is never reconstructed from cache | Ordered by observation/verification sequence; digest provides idempotency; conflicting verification results coexist with actor/policy refs |
| `agent_state_snapshot` | `snapshot_id`; tenant/project/agent required, session/runtime only provenance | Agent/host checkpoint source refs plus included canonical record refs | Durable point-in-time snapshot; immutable after commit; superseded/expired lifecycle | No in-place state rewrite; corrections create a successor snapshot | Derived current-state view may regenerate; snapshot regeneration gets a new identity and exact input set | Snapshot includes only eligible fields; redaction/expiry invalidates affected derived packs; it cannot restore removed source data | Sequence/checkpoint order within agent scope; same checkpoint+digest is idempotent; divergent snapshots at one sequence are explicit conflicts |
| `continuity_pack` | `continuity_pack_id`; tenant/project/agent and target-runtime provenance | Exact `retrieval_run`, included object refs, source refs, and policy refs | Derived artifact; optionally durably retained for delivery/audit; generated/delivered/consumed/expired | Pack content immutable; delivery and consume observations are append-only events | May regenerate only from currently eligible inputs; regeneration has new ID/digest and may omit newly ineligible data | Must carry redaction/retention summary and omissions; redacted/expired inputs cannot be rehydrated; `resurrection_count` must be zero | Stable item ranking and digest; repeated same request/policy/input set is idempotent; conflicting inputs are included as conflict metadata, not silently chosen |
| `retrieval_run` | `retrieval_run_id`; caller tenant/project/agent scope and query digest | Query/request source, resolved policy refs, selected/omitted canonical object refs | Durable audit record even when result set is empty or failed | Append-only result, ranking, omission, and conflict evidence | Result presentation may regenerate from recorded refs; the historical run itself is immutable | Records redaction checks and omission reasons; historical metadata cannot be used to reconstruct removed content | Deterministic comparator with stable ID tiebreak; request idempotency key deduplicates; policy/source drift creates a new run and reports it |
| `redaction_event` | `redaction_event_id`; scope matches affected object/source | Versioned redaction `policy_ref`, actor/service ref, target object/source ref | Durable append-only event; applied/failed/reversed-by-new-policy states without restoring content | Never edit an event; correction is a new event linked to the prior event | Not compactable away while it prevents resurrection; non-sensitive aggregate views may regenerate | Stores rules/digests/omission evidence, not removed secret text; propagates ineligibility to derivatives and records invalidation | Ordered causally per target; target+policy+input digest is idempotent; contradictory outcomes fail closed and require reconciliation |
| `promotion_event` | `promotion_event_id`; tenant/project/agent scope of promoted target | Human authority `source_ref` or exact promotion `policy_ref`, target version/digest | Durable append-only event; requested/approved/rejected/revoked | Never silently updates a target; approval/revocation is a new event and the materialized status is derived | Cannot be compacted away while approved status depends on it; status view may regenerate | Promotion never bypasses redaction or retention; later redaction/expiry makes the target ineligible even if promoted | Causal sequence per target; target+authority+version key is idempotent; concurrent approvals/revocations surface a conflict and fail closed |
| `source_ref` | Canonical tuple `authority + namespace + object_id + version_or_digest`; inherits consumer scope | The named external/local source authority, never Kusabi merely because it stores the ref | Immutable durable value embedded or indexed; resolution state is a separate observation | Reference tuple is immutable; source change creates a new ref | Index/cache may regenerate; the authority tuple and digest cannot | May expose only non-sensitive locator metadata; revoked/expired/denied resolution remains unresolved and cached content cannot resurrect it | Exact tuple/digest gives idempotency; different digests for one claimed version are an integrity conflict |
| `policy_ref` | Canonical tuple `authority + policy_id + version_or_digest`; scope states tenant/project/agent applicability | Named policy authority (Kusabi or external provider) | Immutable durable value embedded or indexed; resolution/evaluation observations are separate | Reference tuple is immutable; policy revision creates a new ref | Resolver cache may regenerate; historical decisions retain the exact prior policy ref | Policy access restrictions and retention apply; missing policy fails closed for protected promotion/recovery and does not fall back silently | Exact tuple/digest gives idempotency; two bodies for one version are an integrity conflict and block evaluation |

## 3. Object-specific invariants

### `context_record`

- Represents a durable, source-bearing unit of memory context, not Kodama's
  permissioned source object itself.
- Raw input defaults to candidate/data-only. Approval is derived only from a
  valid `promotion_event`.
- A compacted summary is another `context_record` with exact input refs and
  does not replace the originals' redaction or retention obligations.

### `decision_record`

- A decision records what was decided, status, subject, author/actor evidence,
  rationale reference where permitted, and supersession chain.
- `decision_record` is not a Shirube `owner_decision`; it may reference one as
  provenance but cannot grant approval, merge, deploy, or release authority.

### `evidence_record`

- Describes evidence identity, digest, claim relation, verification observation,
  and external envelope. The authoritative payload may remain in GitHub, AUN,
  Shirube, Kodama, or another content-addressed store.
- Verification status is evidence about evidence. It is not an execution gate.

### `agent_state_snapshot`

- Captures bounded working state and references decisions/context/evidence; it
  does not copy an AUN queue lease or runtime baton.
- Runtime and session identifiers state where the snapshot was observed, not
  who owns its memory namespace.

### `continuity_pack`

- Is a policy-bound derived delivery artifact, distinct from Kodama's
  permissioned source context pack.
- `consumed` means the pack handoff was observed. It does not prove that the
  task resumed, the queue closed, or recovery succeeded.

### `retrieval_run`

- Records the query boundary, eligible candidates, deterministic ranking,
  selected/omitted refs, policy refs, redaction result, and conflicts.
- A failed or empty run remains audit evidence and must not silently broaden
  scope to obtain results.

### `redaction_event`

- Is new in substance: it makes the removal/omission decision and propagation
  chain first-class rather than only storing a mutable redaction flag.
- It retains non-sensitive prevention evidence so compaction, caching, or
  regeneration cannot recreate the removed content.

### `promotion_event`

- Is new in substance: candidate-to-approved change has its own durable actor,
  target digest, authority reference, policy, reason, and idempotency identity.
- Missing or invalid promotion evidence means candidate, never implicit
  approval.

### `source_ref` and `policy_ref`

- Are authority-preserving value objects. They do not copy the referenced
  foreign state or transfer ownership to Kusabi.
- Resolution and evaluation outputs are observations with their own timestamps
  and evidence; the reference tuple remains immutable.

## 4. Pure-rename guard

Kusabi v2 is not satisfied by renaming existing tables, commands, or product
labels. At minimum, implementation evidence must show the substantive
semantics of `redaction_event`, `promotion_event`, and `retrieval_run` (or an
explicit evidence-backed one-to-one realization) plus the object lifecycle
rules above. These concepts introduce durable policy decisions, propagation,
deterministic selection, and conflict evidence that are not proven by a table
or command rename.

Until schema realization, canonical API contract tests, alias isolation, and
the release ladder's matching evidence exist:

```text
v2_done=false
```

The current v1 storage may be mapped as implementation evidence in a later
migration plan; this document neither renames nor migrates it.

## 5. Fixture readback

| Fixture | Domain-model result |
| --- | --- |
| KADL-001 | PASS (design): all 10 canonical objects have identity/scope, provenance, storage/lifecycle, mutation, compaction/regeneration, redaction/retention/non-resurrection, and ordering/idempotency/conflict semantics in the matrix. |
| KADL-002 | PASS (design): Kodama source material is represented by `source_ref`; Kusabi owns only a permitted derivative and cannot become source ACL authority. |
| KADL-003 | PASS (design): AUN queue/runtime and Shirube gate fields remain external; authority duplication count is zero. |
| KADL-004 | PASS (negative design fixture): a pure table/command rename leaves `v2_done=false`. |
| KADL-005 | PASS (design): approved state requires an explicit, provenance-bound `promotion_event`; silent promotion is rejected/downgraded. |
| KADL-006 | PASS (design): redacted/expired/deleted inputs are ineligible and tombstone/invalidation rules require `resurrection_count=0`. |
