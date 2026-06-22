# Kusabi V2 Suite Interop Boundary Draft

Status: draft
Scope: UAMP / AUN / Kodama / Shirube / MCP interop and ownership boundaries
Runtime impact: none
Base: `KUSABI_V2_IMPLEMENTATION_READINESS_PLAN.md`

## 1. Purpose

This document defines the suite-level interop boundary that must exist before
UAMP, scale/identity, compliance, or runtime implementation work begins.

The goal is to prevent the V2 strategy from splitting into incompatible protocol
tracks or overlapping ownership domains.

Specifically, this document answers:

- how UAMP relates to MCP and existing Kusabi artifacts;
- how UAMP relates to AUN / A2A or other agent-to-agent standards;
- how Kusabi context packs relate to Kodama source labels and domain policy;
- how Shirube governance relates to Kusabi memory/recovery evidence;
- which component owns which decision;
- which artifacts can cross boundaries;
- which claims remain forbidden until implementation and conformance evidence
  exist.

## 2. Non-goals

This document does not authorize:

- runtime code changes;
- new protocol emitters;
- package or schema renames;
- MCP namespace changes;
- cross-agent or cross-tenant reads;
- identity migration;
- AUN lifecycle mutation;
- Kodama source-policy mutation;
- Shirube enforcement;
- compliance certification;
- UAMP conformance claims.

## 3. System roles

| System / layer | Owns | Does not own |
| --- | --- | --- |
| Kusabi | local-first memory, recovery packs, source-bearing memory evidence, recovery confidence, missing context, selected handoff refs | external runtime lifecycle, organization-wide source permission, policy enforcement authority, queue lifecycle |
| UAMP | future vendor-neutral memory/recovery/provenance/continuity exchange format and conformance model | runtime orchestration, product-specific storage implementation, legal compliance certification |
| MCP | current host/tool transport for Kusabi compatibility API | universal memory semantics, multi-agent federation policy, enterprise identity |
| AUN | queue, claim, worker lease, runtime orchestration, requeue/finalize/close lifecycle | Kusabi memory semantics, recovery-pack ranking policy, stored memory promotion |
| A2A / agent-to-agent standards | agent-to-agent task/message handoff protocol where adopted by AUN or suite layer | Kusabi-specific memory storage or recovery evidence semantics |
| Kodama | source permission, sensitivity labels, allowed-use labels, prompt-injection risk labels, citation/omission policy | memory storage, recovery scoring, runtime lifecycle |
| Shirube | work order authority, governance gates, review/audit workflow when enforced | memory/recovery implementation, source permission semantics, runtime execution |
| Host adapters | delivery of bounded recovery context to a specific runtime | lifecycle policy, memory promotion, source permission policy |

## 4. Protocol layering

Kusabi V2 should treat protocol layers as complementary, not competing.

| Layer | Protocol / artifact | Direction |
| --- | --- | --- |
| Tool transport | MCP | Keep current compatibility API. |
| Recovery artifact | `recovery-pack/v1`, `host-invocation-context/v1` | Preserve as current Kusabi/Wasurezu contracts. |
| Interop exchange | future `uamp/v1` | Map from current artifacts; do not replace until schema/conformance exists. |
| Agent-to-agent task flow | AUN / A2A or adopted suite standard | AUN-owned lifecycle and task handoff; may reference Kusabi/UAMP memory artifacts. |
| Source policy | Kodama labels / policy refs | Applied as metadata and omission rules for source material. |
| Governance workflow | Shirube Cell/Spec/Impl/Audit | Gate design and execution work; does not define memory schema by itself. |

## 5. UAMP and MCP boundary

MCP is the current transport for Kusabi tools. UAMP is a future interop protocol.

V2 rule:

```text
MCP exposes Kusabi compatibility tools.
UAMP standardizes portable memory/recovery artifacts.
MCP may transport UAMP artifacts later, but MCP is not UAMP by itself.
```

Implications:

- `mcp__wasurezu__*` remains the current compatibility namespace.
- `mcp__kusabi__*` must not be documented as available until implemented.
- `recovery-pack/v1` remains valid until a UAMP mapping and schema alias exist.
- UAMP conformance requires schemas and fixtures, not just MCP tool output.
- MCP-only mode remains manual recovery unless a host adapter provides startup
  injection evidence.

## 6. UAMP and AUN / A2A boundary

AUN may use A2A or another agent-to-agent standard for task/runtime lifecycle.
UAMP should not duplicate that lifecycle protocol.

V2 rule:

```text
AUN / A2A moves work and owns lifecycle.
UAMP moves memory, recovery, provenance, and continuity evidence.
Kusabi produces or consumes UAMP-compatible memory artifacts.
```

AUN-owned examples:

- queue item;
- claim;
- lease;
- heartbeat;
- worker assignment;
- runtime invocation;
- requeue/finalize/close;
- retry/quarantine;
- task handoff protocol.

Kusabi/UAMP-owned examples:

- memory item;
- recovery pack;
- source refs;
- confidence and missing context;
- redaction summary;
- retention policy ref;
- promotion evidence;
- selected recovery pack ref.

Allowed connection:

```text
AUN task or runtime invocation may reference Kusabi/UAMP context_pack_refs.
Kusabi may record AUN refs as provenance.
```

Forbidden connection:

```text
Kusabi must not mutate AUN lifecycle state.
UAMP must not redefine AUN task/queue protocol.
AUN task messages must not become approved memory without promotion evidence.
```

## 7. Kusabi and Kodama boundary

Kodama owns source/domain policy. Kusabi owns memory/recovery evidence.

V2 rule:

```text
Kodama labels source material.
Kusabi stores and recovers memory with source refs and label-derived constraints.
```

Kodama-owned labels or decisions may include:

- source permission;
- sensitivity;
- allowed-use;
- prompt-injection risk;
- citation requirements;
- omission requirements;
- domain ownership;
- freshness or revocation status.

Kusabi-owned handling:

- attach label refs to memory/recovery items where available;
- omit or downgrade unsafe material;
- record `missing_evidence` when label evidence is absent;
- keep source text data-only;
- preserve provenance and redaction state;
- avoid copying source instructions into `trusted_instruction`.

Forbidden:

- Kusabi must not invent source permission when Kodama evidence is absent.
- Kusabi must not override Kodama allowed-use or omission labels.
- Kodama must not become the memory namespace or recovery ranking owner.
- A context pack must not launder untrusted source text into executable host
  instructions.

## 8. Kusabi and Shirube boundary

Shirube may govern work execution. Kusabi supplies memory and recovery evidence.

V2 rule:

```text
Shirube governs Work Order / Cell / Spec / Impl / Audit flow.
Kusabi provides evidence artifacts and recovery context.
```

Shirube-owned:

- work order authority;
- allowed path/command policy when enforced;
- review gates;
- risk tier workflow;
- approval records;
- audit packet workflow;
- enforcement mode.

Kusabi-owned:

- memory/recovery source refs;
- restart/recovery packs;
- continuity confidence;
- missing context;
- redaction summary;
- retention/missing-evidence refs.

Connection:

- Shirube audit packets may reference Kusabi recovery/memory artifacts.
- Kusabi artifacts may include Shirube approval or review refs as provenance.

Forbidden:

- Kusabi must not claim Shirube enforcement until Shirube actually enforces.
- Shirube approval does not automatically make raw memory trusted instruction.
- Kusabi recovery evidence does not authorize source edits or command execution by
  itself.

## 9. Artifact handoff map

| Producer | Artifact | Consumer | Required boundary metadata |
| --- | --- | --- | --- |
| Kusabi | `recovery-pack/v1` | host adapter, AUN, future UAMP bridge | source refs, memory safety class, redaction state, missing evidence. |
| Kusabi | `host-invocation-context/v1` | runtime adapter | target runtime, delivery mode, data-only policy, trusted wrapper instruction. |
| Kusabi | future `uamp/v1#RecoveryPack` | UAMP consumers, AUN refs, external adapters | schema ref, provenance, retention, redaction, confidence, conformance version. |
| AUN | runtime invocation / queue refs | Kusabi as provenance only | AUN owner, claim/ref ids, lifecycle state, no memory namespace change. |
| Kodama | source labels / allowed-use refs | Kusabi and UAMP artifacts | source permission, sensitivity, prompt-injection risk, citation/omission rules. |
| Shirube | approval / review / work order refs | Kusabi evidence packets | risk tier, approval scope, enforcement mode, review status. |

## 10. Trust downgrade rules

When data crosses subsystem boundaries, default trust must not increase.

| Crossing | Default trust handling |
| --- | --- |
| external source -> Kodama | source label, not memory approval. |
| Kodama label -> Kusabi | source policy evidence, not trusted instruction. |
| AUN task text -> Kusabi | raw source or candidate memory only. |
| Kusabi memory -> AUN invocation | data-only context refs unless AUN/adapter renders trusted wrapper. |
| Kusabi memory -> host adapter | data-only recovery context; trusted instruction remains control-plane-authored. |
| federated agent memory -> local agent | candidate or lower unless explicit promotion evidence exists. |
| Shirube approval -> Kusabi memory | approval evidence only; does not auto-promote raw text. |

## 11. Claim ladder for suite interop

| Level | Allowed claim | Required evidence | Not allowed |
| --- | --- | --- | --- |
| S0 — boundary documented | Suite ownership boundaries are documented. | This doc accepted. | Runtime interop claim. |
| S1 — artifact refs aligned | AUN/Kodama/Shirube can reference Kusabi artifacts by contract. | schema/ref docs and examples. | Live enforcement claim. |
| S2 — UAMP mapping | Current Kusabi artifacts map to UAMP draft schemas. | mapping table, examples, tests. | UAMP conformance claim. |
| S3 — suite fixture | AUN/Kodama/Shirube/Kusabi fixture shows boundaries. | fixture packet and validation checks. | production integration claim. |
| S4 — live integration | Tested suite integration exists. | integration tests, audit logs, recovery evidence. | broad enterprise guarantee. |

## 12. Required examples before implementation

Before implementation, create examples for:

1. MCP-only manual recovery with no AUN/Kodama/Shirube.
2. AUN-supervised runtime that references a Kusabi selected pack.
3. Kodama-labeled source that Kusabi includes as data-only memory.
4. Kodama-labeled unsafe source that Kusabi omits or downgrades.
5. Shirube-approved work order that references Kusabi evidence without making raw
   memory trusted instruction.
6. Future UAMP recovery pack mapping from current `recovery-pack/v1`.
7. Federated agent memory read with trust downgrade.

## 13. Stop conditions

Stop and create a separate owner-approved work order if a proposed change:

- changes AUN lifecycle behavior;
- creates or consumes A2A messages;
- changes Kodama labels or policy semantics;
- enables Shirube enforcement;
- emits UAMP schemas or claims UAMP conformance;
- broadens cross-agent or cross-tenant reads;
- promotes source text to trusted instruction;
- changes runtime/package/MCP/env/DB behavior.

## 14. Acceptance criteria

This boundary is acceptable when:

- UAMP is clearly memory/recovery/provenance interop, not AUN lifecycle protocol;
- AUN/A2A owns task/runtime lifecycle;
- Kodama owns source permission and allowed-use labels;
- Shirube owns governance/work-order enforcement;
- Kusabi owns memory/recovery evidence;
- artifact handoff refs are named;
- trust downgrade rules are explicit;
- no subsystem is allowed to silently increase trust or ownership;
- next implementation docs can proceed without protocol/domain overlap.
