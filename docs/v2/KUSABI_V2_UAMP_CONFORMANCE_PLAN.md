# Kusabi V2 UAMP Conformance Plan Draft

Status: draft
Scope: conformance-suite design only
Runtime impact: none
Conformance status: not claimed
Base: `KUSABI_V2_UAMP_DRAFT_SPEC.md`

## 1. Purpose and status

This document defines the planned UAMP conformance suite for the Kusabi V2
draft protocol track.

It is a plan for future fixtures, runner behavior, pass/fail criteria, Kusabi
reference evidence, and second-adapter evidence. It is not an implementation
authorization and does not make Kusabi UAMP conformant.

Current status:

- UAMP remains draft.
- UAMP conformance is not claimed.
- No runtime emitters are added.
- No schema files are created.
- No fixture files are created by this document.
- No runner is implemented.
- No package, MCP namespace, env var, DB path, workflow, deployment, or schema ID
  change is authorized.
- Current Kusabi/Wasurezu artifacts remain compatibility surfaces.

## 2. U2 definition

U2 is the conformance-suite planning step after the UAMP draft spec.

U2 is acceptable when this plan clearly defines:

- fixture categories;
- validation runner contract;
- pass/fail criteria;
- positive and negative coverage;
- compatibility mapping coverage;
- evidence packet shape;
- reference implementation requirements;
- second-adapter proof requirements;
- claim boundaries and stop conditions.

U2 does not mean:

- UAMP conformance has been achieved;
- fixtures exist;
- a runner exists;
- Kusabi emits `uamp/v1`;
- a second adapter is proven;
- current compatibility artifacts have been replaced.

## 3. Conformance goals

The future UAMP conformance suite should prove that an implementation can:

1. validate `uamp/v1` artifact shapes;
2. preserve memory-safety classes;
3. preserve source refs and provenance;
4. reject trust escalation from source text to trusted instruction;
5. represent retention and redaction boundaries;
6. represent host-adapter capability without claiming lifecycle ownership;
7. map current Kusabi/Wasurezu artifacts without replacing them;
8. produce evidence reports that distinguish pass, fail, skipped, unsupported,
   and not-applicable cases;
9. demonstrate at least one second adapter path before any portable-conformance
   claim.

## 4. Non-goals

This plan does not authorize:

- runtime code changes;
- schema file generation;
- fixture file creation;
- runner implementation;
- UAMP artifact emission from current tools;
- MCP namespace changes;
- package, env, DB, workflow, or deployment changes;
- cross-agent or cross-tenant reads;
- AUN/A2A lifecycle changes;
- Kodama source-policy changes;
- Shirube enforcement changes;
- UAMP conformance claims.

## 5. Artifact coverage matrix

Future fixtures must cover every draft UAMP artifact.

The detailed fixture catalog is defined in
`KUSABI_V2_UAMP_FIXTURE_CATALOG.md`. That catalog is planning-only; it does not
create fixture files, schema files, a runner, or a conformance claim.

| Artifact | Required fixture coverage | Negative coverage |
| --- | --- | --- |
| `uamp/v1#MemoryItem` | decision, task state, working memory, knowledge, raw event source, conversation event source. | missing provenance, missing source refs, invalid memory class, trust escalation. |
| `uamp/v1#RecoveryPack` | selected memory refs, source refs, missing context, confidence, host delivery, quality evidence refs. | no source refs, unredacted secret output, false lifecycle ownership, unsupported host delivery claim. |
| `uamp/v1#LifecycleEvent` | observe, prepare, recommend, handoff, load, degrade, fail, evaluate. | AUN lifecycle mutation by Kusabi, missing artifact refs, unsupported result claim. |
| `uamp/v1#Provenance` | actor, runtime, source system, origin artifact, trust tier, agent/project boundary. | missing actor, missing boundary, session ID used as memory namespace, cross-agent read without federation evidence. |
| `uamp/v1#Retention` | policy ref, TTL, expiration, legal hold, purge eligibility, archive/deletion refs. | missing policy ref for high-claim artifact, deletion claim without evidence. |
| `uamp/v1#Redaction` | redaction version, applied/partial/unknown states, omitted fields, secret scan refs. | secret-bearing output marked not required, missing redaction evidence for recovery output. |
| `uamp/v1#HostAdapterCapability` | delivery modes, startup injection capability, ack-load capability, trusted wrapper requirement, data-only context requirement. | claiming startup injection without evidence, claiming lifecycle ownership from host adapter capability. |

## 6. Future fixture layout

The future suite should use an explicit, reviewable fixture layout. This
document and `KUSABI_V2_UAMP_FIXTURE_CATALOG.md` do not create these files.

Proposed layout:

```text
fixtures/uamp/v1/
  valid/
    memory-item-decision.json
    memory-item-task-state.json
    memory-item-knowledge.json
    memory-item-raw-event-source.json
    recovery-pack-basic.json
    recovery-pack-host-adapter.json
    lifecycle-event-prepare.json
    lifecycle-event-evaluate.json
    provenance-basic.json
    retention-basic.json
    redaction-applied.json
    host-adapter-capability-manual.json
  invalid/
    memory-item-missing-provenance.json
    memory-item-trust-escalation.json
    memory-item-approved-without-promotion.json
    memory-item-cross-agent-without-federation.json
    recovery-pack-unredacted-secret.json
    recovery-pack-missing-source-refs.json
    lifecycle-event-aun-mutation.json
    provenance-session-as-namespace.json
    host-adapter-false-startup-injection.json
  compatibility/
    recovery-pack-v1-to-uamp-recovery-pack.json
    host-invocation-context-v1-to-uamp-envelope.json
    selected-restart-pack-ref.json
    raw-events-to-memory-item.json
    conversation-events-to-memory-item.json
    decisions-to-memory-item.json
    task-states-to-memory-item.json
    knowledge-to-memory-item.json
    recovery-quality-log-to-lifecycle-evidence.json
```

Fixture naming should be stable because future reports will cite fixture IDs.

## 7. Validation runner contract

The future runner should be a pure validation tool. It must not require a live
database, MCP server, host adapter, AUN queue, Kodama policy service, or Shirube
enforcement path.

Minimum runner behavior:

```text
input: fixture directory
input: draft schema/profile version
output: machine-readable report
output: human-readable summary
exit 0: all required cases pass or are explicitly skipped as unsupported
exit 1: one or more required cases fail
exit 2: runner/configuration error
```

Each result should include:

- fixture ID;
- artifact type;
- expected result;
- actual result;
- failure reason when failed;
- unsupported reason when skipped;
- schema/profile version;
- runner version;
- generated time;
- implementation or adapter under test;
- evidence refs.

The runner must support negative fixtures. Passing a negative fixture means the
implementation rejected the invalid artifact for the expected reason.

## 8. Pass/fail criteria

An implementation passes the future UAMP suite only if:

- all required valid fixtures are accepted;
- all required invalid fixtures are rejected;
- every accepted memory/recovery artifact has source refs and provenance;
- memory-safety classes are preserved;
- raw source text is not promoted to `trusted_instruction`;
- approved memory requires promotion evidence;
- cross-agent memory requires federation evidence and trust downgrade;
- recovery output with secret-bearing material is rejected or redacted;
- host adapter capability does not imply lifecycle ownership;
- unsupported capabilities are reported honestly;
- compatibility mappings preserve current Kusabi/Wasurezu surfaces.

An implementation fails the future suite if it:

- accepts trust escalation;
- drops provenance;
- treats `session_id` as memory namespace;
- claims UAMP conformance without required fixture evidence;
- replaces `recovery-pack/v1` or `host-invocation-context/v1` without migration
  approval;
- mutates AUN lifecycle state;
- invents Kodama source permission;
- claims Shirube enforcement without Shirube enforcement evidence.

## 9. Compatibility mapping coverage

Future compatibility fixtures must cover current Kusabi/Wasurezu concepts.

| Current concept | Required conformance question |
| --- | --- |
| `decision` | Does it map to `MemoryItem` type `decision` with source refs and provenance? |
| `task_state` | Does it map to `MemoryItem` type `task_state` or `working_memory` without becoming permanent truth? |
| `knowledge` | Does it preserve candidate, approved, archived, superseded, and merged states where present? |
| `raw_event` | Does it map to `raw_event_source` and remain data-only? |
| `conversation_event` | Does it map as compatibility source and avoid broad ingest overclaim? |
| `recovery-pack/v1` | Does it map to `UAMPRecoveryPack` without replacing the current contract? |
| `host-invocation-context/v1` | Does it preserve target runtime, delivery mode, and data-only policy? |
| `selected_restart_pack:<id>` | Does it remain a handoff ref, not lifecycle ownership? |
| `recovery_quality_log` | Does it map to lifecycle/evaluation evidence without proving conformance alone? |

## 10. Safety and trust coverage

The conformance suite must include explicit safety tests.

Required safety cases:

1. raw transcript text cannot become `trusted_instruction`;
2. tool output remains source data unless separately promoted;
3. approved memory without promotion evidence is invalid;
4. trusted instruction must be control-plane-authored;
5. untrusted context remains data-only in recovery packs;
6. source instructions cannot be copied into host commands;
7. cross-agent memory requires federation evidence;
8. federated memory is downgraded unless promotion evidence exists;
9. redaction state must travel with recovery output;
10. missing evidence must be explicit, not silently ignored.

## 11. Suite interop coverage

The future suite must preserve the suite boundary from
`KUSABI_V2_SUITE_INTEROP_BOUNDARY.md`.

| Boundary | Required conformance check |
| --- | --- |
| UAMP / MCP | MCP may transport UAMP later, but MCP output alone does not prove UAMP conformance. |
| UAMP / AUN | UAMP carries memory/recovery/provenance evidence; AUN owns task/runtime lifecycle. |
| UAMP / Kodama | Kodama owns source permission and allowed-use labels. UAMP may reference labels; it must not invent them. |
| UAMP / Shirube | Shirube owns governance enforcement. UAMP may carry evidence refs; it must not claim enforcement. |
| UAMP / host adapter | Host capability evidence can describe delivery; it must not imply lifecycle control. |

## 12. Evidence packet shape

Future conformance reports should produce an evidence packet.

Draft shape:

```ts
interface UAMPConformanceEvidencePacket {
  schema_ref: "uamp/conformance/v1#EvidencePacket";
  suite_version: string;
  uamp_profile: "uamp/v1-draft";
  implementation_under_test: string;
  adapter_under_test?: string;
  generated_at: string;
  result: "pass" | "fail" | "partial" | "blocked";
  fixture_summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    unsupported: number;
  };
  required_failures: string[];
  unsupported_claims: string[];
  report_refs: string[];
  reviewer_refs?: string[];
}
```

This shape is not a schema file and must not be treated as a conformance claim.

## 13. Reference implementation requirement

Kusabi can be called a UAMP reference implementation only after a separate
owner-approved implementation path proves:

- current compatibility artifacts are preserved;
- UAMP mapping fixtures pass;
- negative safety fixtures are rejected;
- recovery pack fixtures pass;
- redaction and retention fixtures pass;
- host adapter capability is represented honestly;
- reports are generated and reviewed;
- no unsupported claim is advertised.

Until then, allowed wording is:

```text
Kusabi is designed to become the UAMP reference implementation candidate.
```

## 14. Second-adapter requirement

Portable conformance requires a second adapter path. A single Kusabi-only path
can prove internal mapping quality, but it cannot prove protocol portability.

The second adapter evidence must show:

- independent artifact production or consumption;
- fixture pass/fail report;
- host or runtime capability declaration;
- unsupported capability disclosure;
- no AUN/Kodama/Shirube ownership violation;
- no conformance claim beyond the evidence level.

The second adapter may be a host adapter, suite adapter, or independent
prototype, but it must not be only a copy of Kusabi's internal mapping code.

## 15. Claim ladder

| Level | Allowed claim | Required evidence | Not allowed |
| --- | --- | --- | --- |
| U2-P0 plan | UAMP conformance plan exists. | This document accepted. | Fixture or runner claim. |
| U2-P1 fixtures | UAMP fixtures are defined. | Fixture files and review. | Runtime conformance claim. |
| U2-P2 runner | UAMP runner exists. | Runner docs and sample report. | Production integration claim. |
| U2-P3 Kusabi pass | Kusabi mapping passes fixture suite. | Evidence packet from runner. | Portable conformance claim without second adapter. |
| U2-P4 second adapter | A second adapter path passes required cases. | Adapter evidence packet. | Industry standard or broad interoperability claim without adoption evidence. |

## 16. Stop conditions

Stop and create a separate owner-approved work order before any change that
would:

- add runtime UAMP emitters;
- create schema files;
- create executable fixtures or runner code;
- rename schema IDs;
- change MCP namespace;
- change package identity;
- change env vars;
- change DB paths or migrations;
- change workflows;
- change deployment files;
- enable cross-agent or cross-tenant reads;
- mutate AUN lifecycle state;
- change Kodama source-policy semantics;
- enable Shirube enforcement;
- claim UAMP conformance.

## 17. Next safe follow-ups

Safe docs-only follow-ups after this plan:

1. `docs(v2): add redaction parity gate`
2. `docs(v2): add UAMP runner contract examples`
3. `docs(v2): add backend parity fixture plan`
4. `docs(v2): add recovery score example reports`

Implementation remains blocked until the relevant owner-approved design,
compatibility promise, tests, rollback/no-op behavior, and claim boundary exist.
