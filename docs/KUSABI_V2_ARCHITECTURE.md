# Kusabi v2 architecture

Status: canonical design contract; documentation only

Control source: [issue #180](https://github.com/watchout/agent-memory/issues/180)

Frozen requirements: [SPEC-KUSABI-001 freeze](https://github.com/watchout/agent-memory/issues/180#issuecomment-4975595110)

Implementation handoff: [CH-SPEC-KUSABI-001-ARCH-DOMAIN-LEGACY-20260715](https://github.com/watchout/agent-memory/issues/180#issuecomment-4975612006)

Exact design baseline: `6e85144e4ec22f24d51cf1975c7d0448485df4b7`

## 1. Purpose and claim boundary

Kusabi v2 is the durable memory, decision, evidence, continuity, and agent-state
substrate for MCP-based agents. It is an architectural reset: the canonical
objects and their lifecycle rules are explicit, while current v1 tables, tools,
and names remain compatibility surfaces until separately implemented and
verified.

This document does not change runtime behavior, schemas, package identity, MCP
namespaces, CLI aliases, deployment, or release claims. The presence of these
documents alone does not satisfy a Kusabi v2 release claim. The existing
[release claim ladder](./v2/KUSABI_V2_RELEASE_CLAIM_LADDER.md) remains the only
claim-level authority.

Related contracts:

- [Kusabi v2 domain model](./KUSABI_V2_DOMAIN_MODEL.md)
- [Kusabi v1-to-v2 legacy concept audit](./KUSABI_V2_LEGACY_CONCEPT_AUDIT.md)
- [existing API and data compatibility boundary](./v2/KUSABI_V2_API_AND_DATA_BOUNDARY.md)
- [existing suite interop boundary](./v2/KUSABI_V2_SUITE_INTEROP_BOUNDARY.md)

## 2. Plane ownership

| Plane | Owns | Must not be copied into Kusabi as authority | Kusabi interaction |
| --- | --- | --- | --- |
| Kusabi | Context and memory records, decisions, evidence, continuity packs, agent-state snapshots, retrieval runs, redaction events, promotion events, and their durable provenance | Queue leases, development gates, source ACLs, runtime restart decisions | Persist canonical records and immutable references; produce bounded recovery and evidence outputs. |
| AUN | Queue claim/requeue/finalize/close, worker lease and heartbeat, runtime baton, runtime restart orchestration | AUN queue or baton state | Kusabi may retain an immutable `source_ref` to AUN evidence and may provide a pack/reference to AUN. It never decides or mutates AUN lifecycle. |
| Shirube | Development cells, handoffs, gates, owner decisions, audit results, and lifecycle governance | Shirube gate state or merge/approval authority | Kusabi may retain an immutable `policy_ref` or `source_ref` to a gate artifact as evidence context. A Shirube PASS never silently promotes memory. |
| Kodama | Source ACL, permissioned source context, and permissioned context-pack provenance | Source text or ACL state as Kusabi-owned authority | Kusabi stores an immutable `source_ref` and the redacted, policy-permitted derivative needed for memory. Kodama remains source authority. |
| MCP host / adapter | Host invocation and transport-specific delivery | Canonical memory policy or lifecycle state | Calls Kusabi ports, renders returned data, and reports delivery evidence. |

`duplication_as_authority_count` must remain `0`. Cross-plane objects are
referenced by immutable `source_ref` or `policy_ref`; copying a foreign record
into a Kusabi table does not transfer authority.

## 3. Kusabi core boundary

The core owns the rules for the objects defined in the
[domain model](./KUSABI_V2_DOMAIN_MODEL.md):

- canonical identity and tenant/project/agent scoping;
- provenance validation and immutable reference handling;
- candidate-to-approved promotion through an explicit `promotion_event`;
- redaction, deletion, expiry, retention, and non-resurrection;
- deterministic retrieval eligibility and ordering;
- continuity-pack assembly from eligible records and source references;
- append-only event recording, idempotency, and conflict reporting;
- evidence needed to evaluate a claim without granting release authority.

The core does not parse an LLM answer as authority. LLMs may propose candidate
memory or summaries, but deterministic code validates identity, scope,
provenance, policy, redaction state, retention, promotion evidence, transition
eligibility, ordering, idempotency, and conflicts.

## 4. Ports and adapters

The architecture is hexagonal. The following are conceptual contracts, not a
claim that matching v2 runtime interfaces already exist.

| Port | Core responsibility | Adapter examples | Adapter constraint |
| --- | --- | --- | --- |
| `record_port` | Accept canonical records/events after scope and provenance validation. | MCP tools, CLI, host hooks | Cannot bypass promotion or redaction rules. |
| `query_port` | Run deterministic, scoped retrieval and return a `retrieval_run`. | MCP search/recovery, CLI query | Cannot expand tenant/project/agent scope. |
| `continuity_port` | Build or fetch a bounded `continuity_pack`. | MCP recovery, host launcher, AUN integration | Cannot restart a host or mutate an AUN queue. |
| `evidence_port` | Attach or resolve evidence references and integrity metadata. | GitHub/AUN/Shirube envelope adapters | External envelope remains external authority. |
| `policy_port` | Resolve a `policy_ref` and return a versioned decision input. | Local policy, enterprise identity/policy provider | Resolution result is input to core rules, not adapter discretion. |
| `identity_port` | Resolve canonical tenant/project/agent refs where available. | Local binding, future registry/auth provider | Current fallback boundary remains `agent_id + optional project`; no tenant capability is implied. |
| `store_port` | Commit/retrieve durable objects atomically and enforce idempotency. | SQLite, PostgreSQL, JSON compatibility adapter | Backend cannot redefine domain lifecycle or claim parity without evidence. |
| `clock_sequence_port` | Supply stable timestamps and monotonic/causal sequence data. | DB clock/sequence, deterministic test clock | Wall-clock arrival alone cannot overwrite conflicting history. |
| `redaction_port` | Apply a versioned redaction policy and return evidence. | Local scanner, approved external service | Failure is explicit and fail-closed for recovery eligibility. |

The MCP runtime, database, auth/identity provider, and external evidence
envelopes are adapters. They may translate transport and storage shapes, but
they cannot own canonical state transitions.

## 5. Deterministic processing path

```text
external input
  -> adapter labels source and caller scope
  -> core validates source_ref/policy_ref and identity boundary
  -> redaction/retention eligibility check
  -> append durable record or reject with a typed reason
  -> explicit promotion_event when candidate status changes
  -> scoped retrieval_run with deterministic ordering/conflict report
  -> continuity_pack derived from eligible records
  -> adapter delivers data and records delivery evidence
```

The script-controlled path must enforce these invariants:

1. No source without provenance becomes approved memory.
2. No candidate becomes approved without an explicit, idempotent
   `promotion_event` tied to a `policy_ref` or human-authority `source_ref`.
3. Redacted, deleted, expired, or out-of-scope material is ineligible for
   retrieval and continuity packs. Compaction cannot resurrect it.
4. Every retrieval records inputs, policy version, ordering, omissions, and
   conflicts in a `retrieval_run`.
5. Retention and state transitions are evaluated from versioned policy and
   durable events, not prompt wording.
6. Conflicting facts coexist as evidence until a deterministic or explicitly
   authorized resolution/supersession event is recorded.
7. Repeating an operation with the same idempotency key produces the same
   canonical identity or an explicit conflict; it never silently duplicates.

## 6. Canonical state transitions

### Memory and decisions

```text
source observed -> candidate -> approved -> superseded/archived/expired
                         \-> rejected
```

Only `promotion_event` enters `approved`. Supersession preserves history.
Archive and expiry affect retrieval eligibility. Deletion/redaction follows
policy and leaves the minimum non-sensitive tombstone needed to prevent replay
or regeneration.

### Evidence

```text
reference observed -> verified/unverified -> superseded/expired/redacted
```

Verification describes evidence status; it does not grant AUN, Shirube,
release, approval, or deployment authority.

### Continuity

```text
retrieval_run -> continuity_pack generated -> delivered -> consumed/expired
```

A `continuity_pack` is derived and regenerable only from records still eligible
under the same or a stricter current policy. Delivery/consumption is evidence,
not runtime lifecycle ownership.

## 7. Source and policy reference rule

`source_ref` identifies immutable provenance such as a content-addressed GitHub
artifact, raw event, Kodama source object, or AUN evidence object. `policy_ref`
identifies the exact policy version used for redaction, retention, promotion,
identity, or retrieval.

Both references:

- include authority/namespace, stable object identity, version or digest, and
  resolution status;
- are immutable once attached to a durable event;
- may be re-resolved, but a changed target produces a new reference/version;
- do not embed foreign ACL, queue, gate, or approval state as Kusabi authority;
- fail closed for protected retrieval/promotion when required resolution or
  permissions are missing.

For Kodama-owned material, Kusabi may store a redacted derivative only when the
resolved source policy permits it. The derivative retains the Kodama
`source_ref`; Kusabi never becomes the source ACL authority.

## 8. Failure and recovery

| Failure | Detection | Required recovery |
| --- | --- | --- |
| Unsourced domain invention | Canonical object/rule has no frozen issue, existing design, compatibility surface, or explicit `new_invention` label. | Stop canonicalization and obtain owner input. |
| Boundary duplication | AUN queue, Shirube gate, or Kodama ACL/context provenance is represented as Kusabi-owned state. | Remove the authority claim; retain only a typed immutable reference. |
| Silent promotion | Approved status has no valid `promotion_event`. | Reject or downgrade to candidate; emit missing promotion evidence. |
| Resurrection | Redacted/expired/deleted source appears in retrieval or a regenerated pack. | Fail the run, keep a non-sensitive tombstone, invalidate affected derived packs, and report `resurrection_count`. |
| Pure rename overclaim | Only names/tables/commands changed and no substantive object/lifecycle/contract proof exists. | Set `v2_done=false`; preserve aliases and list unmet predicates. |
| Adapter divergence | Backend or runtime adapter changes ordering, redaction, scope, or state semantics. | Fail parity claim and require adapter-specific fixture evidence. |

## 9. Acceptance interpretation

This architecture satisfies the documentation inputs for KADL-002 and
KADL-003: Kodama remains source authority, AUN/Shirube remain lifecycle and gate
authorities, and foreign state is referenced rather than duplicated. Runtime
conformance, schema realization, API contracts, migration, and release claims
remain separate work and evidence.
