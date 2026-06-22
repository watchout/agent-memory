# Kusabi V2 Irresistible Adoption Strategy Draft

Status: draft
Scope: strategy consolidation for UAMP, safety, compliance, scale, and adopt-vs-build
Base dependency: PR #190 (`docs/v2-world-class-design`)
Runtime impact: none
Related: issue #188, issue #154, PR #164

## 1. Purpose

This document converts the strategic proposal in issue #188 into a V2 design
strategy layer.

The goal is not merely to make Kusabi safe, renamed, or internally consistent.
The goal is to make Kusabi compelling enough that a serious platform or AI
infrastructure team would prefer to evaluate, adopt, or contribute to Kusabi and
UAMP instead of building another incompatible private memory stack.

This is a strategy and design-consolidation document only. It does not authorize
runtime, package, schema, MCP, database, workflow, deployment, or repository
migration.

## 2. Current diagnosis

The current V2 docs stack creates a strong floor:

- canonical V2 product name: `kusabi`;
- compatibility preservation for `wasurezu` and `agent-memory` surfaces;
- Lane A / B / C separation;
- feature-preservation matrix;
- API/data boundary;
- release claim ladder;
- security and retention boundary.

That floor is necessary but not sufficient for irresistible adoption.

The missing top layer is a unified category-defining strategy that consolidates:

1. UAMP as an actual protocol track, not only an RFC idea;
2. memory safety as an injection-resistance and governance differentiator;
3. scale design for teams, tenants, multi-agent fleets, and cross-runtime
   interoperability;
4. compliance surfaces with tamper-evident audit and attestation boundaries;
5. adopt-vs-build proof through conformance and reference adapters.

## 3. Strategic thesis

Kusabi should become the reference implementation of an open agent-memory and
continuity standard.

The product should be valuable in two ways:

| Layer | Value |
| --- | --- |
| Kusabi reference implementation | Local-first MCP memory/recovery engine that works for real coding agents. |
| UAMP protocol | Vendor-neutral memory, recovery, provenance, safety, and compliance exchange layer. |

The strategic win is not that every platform uses the exact Kusabi codebase. The
win is that major platforms can implement or interoperate with UAMP, while Kusabi
remains the default OSS engine, compatibility testbed, and fastest path to
conformance.

## 4. Non-negotiable compatibility floor

The irresistible layer must sit on top of the conservative V2 floor. It must not
invalidate the existing discipline.

Preserve:

- existing Wasurezu / agent-memory capabilities;
- `agent_id + optional project` as the current memory boundary;
- explicit owner-approved migration for tenant/user identity;
- data-only treatment of stored source text;
- fail-closed host lifecycle boundaries;
- compatibility for package, CLI, MCP, env, DB path, and schema IDs until tested
  migration exists;
- no public-alpha, enterprise, compliance, DLP, or governance-enforcement claim
  without evidence.

## 5. Five consolidation pillars

### Pillar 1: UAMP protocol track

UAMP should move from RFC intent to a versioned protocol track.

Minimum spec surfaces:

| Surface | Required artifact |
| --- | --- |
| Memory item | `uamp/v1#MemoryItem` schema. |
| Recovery pack | `uamp/v1#RecoveryPack` schema. |
| Provenance | actor, runtime, source refs, trust tier, signing state. |
| Retention | TTL, legal hold, purge eligibility, policy refs. |
| Redaction | redaction version, completeness claim, omitted fields. |
| Lifecycle | observe, prepare, recommend, require, load, degrade, fail. |
| Conformance | fixture corpus and pass/fail suite. |
| Adapter contract | runtime capability declaration and delivery-mode evidence. |

The first UAMP milestone should not claim to replace existing
`recovery-pack/v1` immediately. It should define an interop envelope and mapping
from current Kusabi/Wasurezu artifacts into `uamp/v1`.

### Pillar 2: Safety as the differentiation layer

The most defensible technical differentiator is memory safety.

Kusabi should frame the memory system as injection-resistant by default:

```text
raw_event_source -> candidate_memory -> approved_memory -> trusted_instruction
```

The transition from left to right is never automatic. In particular:

- transcript text is source data;
- tool output is source data;
- issue/PR/chat/web text is untrusted context;
- candidate memory requires source refs;
- approved memory requires promotion evidence;
- trusted instruction must be control-plane-authored;
- `trusted_instruction` must not copy raw source text;
- host adapters must render context as data, not executable command material.

This safety model should be a first-class UAMP conformance requirement, not only
a Kusabi implementation convention.

### Pillar 3: Scale and identity model

Kusabi V2 can keep `agent_id + optional project` as the current compatibility
boundary while designing the next scale layer.

Scale design must answer:

| Dimension | V2 / UAMP requirement |
| --- | --- |
| Tenant | Future hard boundary; not implemented by docs reset. |
| User | Future owner/person identity; must not be inferred from session id. |
| Agent | Current primary memory namespace. |
| Project/workspace | Current soft filter within agent namespace. |
| Session | Provenance/lifecycle trace only. |
| Runtime | Provenance and adapter capability only. |
| Team/fleet | Future federation policy, not implicit cross-agent read. |
| Common registry | Binding evidence, not Kusabi-owned identity policy. |

Multi-agent memory sharing should be explicit federation, not namespace bleed.

Federation design principles:

1. Default cross-agent read is forbidden.
2. Federation grants are explicit and scoped.
3. Federated memory is downgraded unless promotion policy says otherwise.
4. Raw transcript sharing across agents is not default.
5. Every federated read emits provenance and trust boundary metadata.
6. Tenant/user identity requires owner-approved design and migration.

### Pillar 4: Tamper-evident compliance surface

Compliance should become concrete, but not overclaimed.

The first compliance layer should be an evidence and attestation boundary, not a
legal guarantee.

Required design surfaces:

| Surface | Requirement |
| --- | --- |
| Audit chain | Append-only lifecycle and memory events with hash links or equivalent tamper-evidence. |
| Attestation | Reportable recovery run, redaction, retention, and provenance evidence. |
| Retention mapping | TTL, archive, legal hold, purge eligibility, and deletion report concepts. |
| Privacy mapping | GDPR/CCPA-style data subject and deletion/export questions, marked as design mapping not certification. |
| Governance evidence | promotion refs, approval refs, policy version, missing evidence. |
| Export/reveal | scoped, redacted, provenance-bearing, operator-authorized. |

Do not claim GDPR, CCPA, SOC 2, ISO, or legal compliance solely from the design.
Claim only that Kusabi can produce reviewable evidence packets designed to support
operator compliance workflows.

### Pillar 5: Adopt-vs-build proof

Major platforms will not adopt because Kusabi says it is useful. They will adopt
when conformance is cheaper than rebuilding.

The proof package should include:

1. UAMP schemas.
2. UAMP conformance fixtures.
3. Kusabi reference implementation.
4. At least two adapter examples.
5. A migration map from current `recovery-pack/v1` into UAMP.
6. Public examples of recovery scorecards and audit packets.
7. A clear extension model for proprietary runtimes.
8. A compatibility promise that old Wasurezu surfaces keep working.

The second adapter matters. One adapter proves Kusabi works. Two adapters prove
UAMP is not just an implementation detail.

## 6. UAMP milestone ladder

| Milestone | Allowed claim | Required evidence | Not allowed |
| --- | --- | --- | --- |
| U0 — RFC accepted | UAMP is a proposed interop direction. | RFC issue, V2 strategy doc. | Conformance or adoption claims. |
| U1 — draft schema | UAMP has draft schemas for memory and recovery exchange. | JSON schemas, mapping from current artifacts. | Runtime-neutral interoperability claim. |
| U2 — conformance suite | UAMP has executable conformance fixtures. | Fixture corpus, pass/fail runner, Kusabi passes. | Platform adoption claim. |
| U3 — second adapter | UAMP works across at least two runtime adapters. | Claude/Codex or another adapter with startup/recovery evidence. | Universal runtime support. |
| U4 — pilot protocol | UAMP supports controlled enterprise pilot evaluation. | audit packet, retention boundary, conformance report, security notes. | Compliance certification. |
| U5 — standardization candidate | UAMP is credible as an open standard. | external contribution or independent implementation evidence. | Industry standard claim without adoption evidence. |

## 7. Major-tech adoption package

A serious platform team should be able to evaluate Kusabi through a single packet:

| Packet item | Purpose |
| --- | --- |
| V2 canonical spec | Product and architecture boundary. |
| Feature preservation matrix | No silent regression from Wasurezu. |
| API/data boundary | Compatibility APIs and V2 concepts. |
| Release claim ladder | Evidence-backed claims. |
| Security/retention boundary | Safety and privacy limits. |
| UAMP draft spec | Interop and standardization path. |
| Conformance suite | Objective adopt-vs-build proof. |
| Adapter examples | Cross-runtime proof. |
| Recovery scorecards | Measured continuity benefit. |
| Audit packet examples | Compliance and governance review. |

## 8. Relationship to GSO / enterprise pilot

The Grand Slam Offer direction should be interpreted as the commercial proof of
this technical strategy.

| GSO element | Design requirement |
| --- | --- |
| 90-day Agent Continuity Pilot | Recovery score contract and repeatable evaluation reports. |
| Performance guarantee | Versioned scoring rubric and restatement-incident definition. |
| Design-partner cohort | Controlled scope, explicit limitations, evidence packet per run. |
| Enterprise governance layer | Identity, audit reports, retention, attestation, dashboard, SLA boundaries. |
| Open-core distribution | OSS reference implementation plus paid governance/compliance surface. |

The pilot should not require overclaiming V2. It should prove a measured slice:

```text
For a scoped cohort and runtime path, Kusabi improves continuity with measured
recovery scores, zero or reduced restatement incidents, explicit redaction limits,
and auditable provenance.
```

## 9. Required new V2 docs after this strategy

This strategy should produce the following follow-up docs:

| Follow-up doc | Purpose |
| --- | --- |
| `KUSABI_V2_UAMP_DRAFT_SPEC.md` | Draft wire format, schema refs, mapping from current artifacts. |
| `KUSABI_V2_UAMP_CONFORMANCE_PLAN.md` | Fixtures, runner, pass/fail requirements, second adapter target. |
| `KUSABI_V2_SCALE_AND_IDENTITY_MODEL.md` | Tenant/user/team/agent/project/session/runtime boundaries and federation. |
| `KUSABI_V2_COMPLIANCE_ATTESTATION_BOUNDARY.md` | Tamper-evident audit, retention mapping, attestation packet. |
| `KUSABI_V2_ADOPT_VS_BUILD_CASE.md` | Why platforms should adopt UAMP/Kusabi instead of rebuilding. |

These should remain docs-only until owner/domain-designer review accepts the
strategy.

## 10. Implementation backlog generated by this strategy

Do not start implementation until the relevant docs and owner approvals exist.

Potential later work:

1. UAMP schema files under a governed schema path.
2. Mapping from `recovery-pack/v1` to `uamp/v1#RecoveryPack`.
3. Conformance fixture corpus.
4. Conformance runner.
5. Adapter capability declarations.
6. Second adapter proof beyond the current primary bridge path.
7. Tamper-evident audit chain design and prototype.
8. Recovery score contract versioning.
9. Restatement incident definition and report field.
10. Enterprise pilot evidence packet template.

## 11. Stop conditions

Stop and split into a separate owner-approved work order if a change would:

- alter runtime behavior;
- rename package, CLI, MCP, env, DB, schema, or repository surfaces;
- claim UAMP conformance without schemas and tests;
- claim enterprise compliance without evidence and legal review;
- introduce cross-agent or cross-tenant reads;
- implement identity migration;
- sign or export audit evidence;
- broaden transcript ingest or reveal behavior;
- modify workflows, deployment, publishing, or branch protection.

## 12. Current conclusion

Issue #188 is correct: the conservative V2 floor is necessary but not enough.

The irresistible layer is:

```text
Kusabi = reference implementation
UAMP = open interop protocol
Safety = data-only memory and trusted-instruction separation
Scale = explicit identity/federation model
Compliance = tamper-evident evidence and attestation boundary
Adoption proof = conformance suite + second adapter + recovery scorecards
```

This layer should be added above the V2 floor, not used to bypass it.
