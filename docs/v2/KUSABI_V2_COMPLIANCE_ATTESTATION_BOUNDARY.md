# Kusabi V2 Compliance Attestation Boundary Draft

Status: draft
Scope: compliance evidence and attestation boundary design only
Runtime impact: none
Certification status: not claimed
Base: `KUSABI_V2_SECURITY_AND_RETENTION_BOUNDARY.md`

## 1. Purpose and status

This document defines the Kusabi V2 compliance and attestation boundary.

This is a compliance and attestation boundary, not legal certification.
Runtime behavior is unchanged. No audit signing is implemented. No
deletion/export/reveal behavior is implemented. No SOC 2, ISO, GDPR, or CCPA
compliance claim is made.

This document defines evidence surfaces that may support an operator's
compliance workflow later.

Boundary language:

```text
Kusabi may produce evidence packets that help operators review memory, recovery,
retention, redaction, and lifecycle behavior. Kusabi does not certify legal or
regulatory compliance by itself.
```

This document is not an implementation authorization.

## 2. Compliance posture

Kusabi compliance posture = evidence support, not certification.

| Claim type | Current status | Required before claim |
| --- | --- | --- |
| Audit evidence support | design target | attestation packet schema + examples |
| Tamper-evident audit chain | future design | hash-chain format + implementation + tests |
| Retention policy evidence | design target | retention refs + report examples |
| Deletion/export support | future high-risk feature | owner-approved design + preview + audit |
| GDPR/CCPA support mapping | design mapping only | legal review + operator controls |
| SOC 2 / ISO support | design mapping only | control mapping + audit evidence + legal/compliance review |
| Legal compliance certification | not claimed | outside Kusabi alone |

Allowed now:

```text
Kusabi V2 documents a draft compliance evidence and attestation boundary.
```

Not allowed now:

```text
Kusabi is GDPR compliant.
Kusabi is SOC 2 ready.
Kusabi provides certified audit logs.
Kusabi deletion/export/reveal is implemented.
```

## 3. Evidence classes

Evidence classes define what future attestation packets may reference. Missing
evidence must be explicit and must not be converted into a stronger claim.

| Evidence class | Owner system | Source artifact | Required fields | Missing evidence behavior |
| --- | --- | --- | --- | --- |
| memory evidence | Kusabi | memory item, decision, task state, knowledge item | memory id, memory class, agent/project, source refs, provenance, promotion refs where applicable | add `missing_evidence`; downgrade claim level |
| recovery evidence | Kusabi | `recovery-pack/v1`, future UAMP recovery pack, selected pack ref | pack id, generated time, source refs, missing context, confidence, lifecycle owner | mark recovery claim partial or unsupported |
| redaction evidence | Kusabi/operator | redaction report, probe output, omitted fields, `KUSABI_V2_REDACTION_PARITY_GATE.md` refs | redaction version, surfaces tested, fixture families, omitted fields, known limitations | block L3+ redaction claims |
| retention evidence | Kusabi/operator | retention policy ref, TTL/legal hold/purge report | policy ref, TTL, legal hold, purge eligibility, archive/deletion refs | block retention enforcement claim |
| deletion/export evidence | operator/Kusabi future | deletion preview, deletion report, export/reveal report | request id, scope, operator intent, preview, redaction, audit refs, backup/rollback note | deny or mark not implemented |
| promotion evidence | human/operator/Shirube | approval ref, policy promotion ref, review note | approver/ref, scope, source refs, time, memory ids | keep as candidate memory |
| lifecycle evidence | AUN/host/Kusabi | AUN queue/claim refs, host adapter event, lifecycle event | lifecycle owner, event id, event type, result, time, source refs | mark lifecycle owner unknown |
| source-policy evidence | Kodama/operator | source labels, allowed-use refs, sensitivity refs | source ref, label ref, allowed use, sensitivity, omission/citation rules | omit or downgrade source material |
| identity/boundary evidence | operator/Kusabi | agent/project refs, future tenant/user refs, common registry refs | boundary ref, agent id, project, tenant/user refs where supported | forbid cross-boundary claim |
| approval/governance evidence | Shirube/operator | work order, approval, audit packet | work order ref, risk tier, approval scope, enforcement mode, reviewer | evidence only; no automatic execution authorization |

## 4. Attestation packet draft

These are TypeScript-like draft shapes, not schema files.

```ts
interface KusabiAttestationPacketDraft {
  packet_id: string;
  packet_type:
    | "recovery_run"
    | "memory_export"
    | "retention_report"
    | "redaction_report"
    | "deletion_report"
    | "governance_review"
    | "uamp_conformance_report";
  generated_at: string;
  generated_by: "kusabi" | "operator" | "shirube" | "external";
  agent_id?: string;
  project?: string;
  tenant_ref?: string;
  user_ref?: string;
  session_id?: string;
  source_refs: string[];
  evidence_refs: KusabiEvidenceRefDraft[];
  redaction_summary?: KusabiRedactionEvidenceDraft;
  retention_summary?: KusabiRetentionEvidenceDraft;
  lifecycle_summary?: KusabiLifecycleEvidenceDraft;
  promotion_evidence?: KusabiPromotionEvidenceDraft[];
  missing_evidence: string[];
  claim_level: "L0" | "L1" | "L2" | "L3" | "L4";
  uamp_level?: "U0" | "U1" | "U2" | "U3" | "U4" | "U5";
  legal_disclaimer: string;
}

interface KusabiEvidenceRefDraft {
  ref_id: string;
  ref_type:
    | "memory"
    | "recovery_pack"
    | "redaction"
    | "retention"
    | "deletion"
    | "export"
    | "promotion"
    | "lifecycle"
    | "source_policy"
    | "identity_boundary"
    | "governance";
  owner_system: "kusabi" | "aun" | "kodama" | "shirube" | "operator" | "external";
  source_ref: string;
  generated_at?: string;
  trust_level: "source_data" | "candidate" | "approved" | "operator_attested";
  missing_fields?: string[];
}

interface KusabiRedactionEvidenceDraft {
  redaction_version: string;
  status: "not_required" | "applied" | "partial" | "unknown";
  surfaces_tested: string[];
  fixture_families?: string[];
  omitted_fields?: string[];
  limitations?: string[];
  secret_scan_refs?: string[];
}

interface KusabiRetentionEvidenceDraft {
  policy_ref: string;
  ttl?: string;
  expires_at?: string;
  legal_hold?: boolean;
  purge_eligible?: boolean;
  archive_refs?: string[];
  deletion_refs?: string[];
  missing_policy_refs?: string[];
}

interface KusabiLifecycleEvidenceDraft {
  lifecycle_owner: "kusabi" | "aun" | "host_adapter" | "manual" | "unknown";
  event_refs: string[];
  result?: "success" | "partial" | "failed" | "blocked";
  missing_lifecycle_refs?: string[];
}

interface KusabiPromotionEvidenceDraft {
  memory_ref: string;
  promoted_by: "human" | "policy" | "shirube" | "operator";
  promotion_ref: string;
  promoted_at: string;
  scope: string;
  source_refs: string[];
}
```

These shapes are documentation only. They do not create schema files, runtime
emitters, fixtures, validation runners, signing behavior, or compliance claims.

## 5. Tamper-evident audit boundary

Tamper-evident audit chain support is future design, not implementation.

Future design expectations:

- append-only event expectation;
- event hash;
- previous hash;
- chain id;
- canonical serialization requirement;
- clock/source timestamp caveat;
- signer optional/future;
- no cryptographic guarantee until implemented and audited.

Draft event shape:

```ts
interface KusabiAuditChainEventDraft {
  chain_id: string;
  event_id: string;
  event_type: string;
  event_at: string;
  actor_ref?: string;
  agent_id?: string;
  project?: string;
  source_refs: string[];
  payload_hash: string;
  previous_event_hash?: string;
  event_hash: string;
  signature?: string;
  missing_evidence: string[];
}
```

Rules:

- hash chain is future design only;
- not emitted today;
- no tamper-evidence claim until implementation and verification;
- no signing claim until signing exists, is tested, and is reviewed;
- timestamps are evidence, not absolute proof, unless backed by an accepted time
  source and audit model.

## 6. Retention / deletion / export boundary

Kusabi V2 must distinguish retention and lifecycle concepts.

| Concept | Meaning | Boundary |
| --- | --- | --- |
| supersession | A newer memory supersedes older active use. | Not deletion. Preserve history unless deletion policy says otherwise. |
| merge | Multiple memories are consolidated into a target. | Not deletion. Preserve source refs. |
| archive | Hidden from active defaults but retained. | Not deletion. Preserve audit trail. |
| expire | Mark inactive or stale after time or lifecycle. | Not deletion unless a deletion policy says so. |
| retention TTL | Policy reference for retention age or review. | Not enforcement until implemented and tested. |
| deletion | Remove data from storage. | Requires owner-approved policy, preview, audit report, backup/rollback consideration. |
| export | Produce a portable copy. | Requires scope, redaction, source refs, operator intent, secret-output checks. |
| reveal | Show raw or sensitive stored data. | Requires scope, redaction mode, source refs, operator intent, output checks. |
| legal hold | Prevent deletion/purge while hold is active. | Prevents purge eligibility. |
| purge eligibility | Data may be eligible for purge after policy checks. | Not deletion by itself. |

Rules:

- supersession is not deletion;
- archive is not deletion;
- expire is not deletion unless a deletion policy says so;
- deletion requires owner-approved policy, preview, audit report, backup/rollback
  consideration;
- export/reveal requires scope, redaction, source refs, operator intent, and
  secret-output checks;
- legal hold prevents purge eligibility.

## 7. Privacy and regulatory mapping

This is non-legal design mapping. GDPR, CCPA, SOC 2, and ISO are mapping targets,
not compliance claims.

| Requirement area | Kusabi design support | Boundary |
| --- | --- | --- |
| Data inventory | source refs, memory classes, raw_events/conversation_events mapping | not a full data catalog |
| Access/export | future scoped export/reveal report | not implemented |
| Deletion | future deletion report / purge eligibility | not implemented |
| Retention | retention_policy_ref, TTL/legal_hold draft | not enforcement yet |
| Provenance | source refs, lifecycle owner, identity refs | evidence only |
| Redaction | redaction summaries and probes | not DLP |
| Auditability | attestation packets and future hash chain | not certification |
| Consent/authorization | operator/approval refs | does not replace legal basis |

Kusabi may help operators assemble evidence. Operators remain responsible for
legal interpretation, policy decisions, access controls, and compliance claims.

## 8. Relationship to UAMP

UAMP artifacts may carry attestation refs.

Rules:

- UAMP conformance does not imply compliance.
- UAMP conformance plan must include compliance/attestation fixture categories
  later.
- UAMP artifacts can reference retention, redaction, provenance, lifecycle, and
  promotion evidence.
- UAMP must not launder missing compliance evidence into "compliant" status.
- Redaction parity gates are defined in `KUSABI_V2_REDACTION_PARITY_GATE.md`;
  passing redaction probes supports review evidence only and does not certify
  legal or regulatory compliance.
- A UAMP artifact with evidence refs is still only evidence-bearing; access
  control and legal compliance remain outside the artifact alone.

## 9. Relationship to AUN / Kodama / Shirube

This boundary follows `KUSABI_V2_SUITE_INTEROP_BOUNDARY.md`.

| System | Owns | Attestation relationship |
| --- | --- | --- |
| AUN / A2A | lifecycle evidence for queue/runtime, claim, lease, worker, requeue/finalize/close | Kusabi may include refs as lifecycle provenance only. |
| Kodama | source permission, sensitivity, allowed-use, omission/citation labels | Kusabi may include refs as source-policy evidence only. |
| Shirube | approval, work-order governance, audit workflow, enforcement mode | Kusabi may include refs as approval/governance evidence only. |
| Kusabi | memory/recovery evidence, confidence, missing context, redaction and retention refs | Kusabi may assemble attestation packets from evidence refs. |

None of those refs automatically promote memory.
None of those refs authorize execution.
None of those refs create legal compliance certification.
None of those refs create `trusted_instruction`.

## 10. Required examples

### Recovery run attestation packet

```json
{
  "packet_id": "attest_recovery_001",
  "packet_type": "recovery_run",
  "generated_at": "2026-06-23T00:00:00Z",
  "generated_by": "kusabi",
  "agent_id": "codex",
  "project": "watchout/agent-memory",
  "source_refs": ["recovery-pack/v1:pack_001"],
  "evidence_refs": [
    {
      "ref_id": "pack_001",
      "ref_type": "recovery_pack",
      "owner_system": "kusabi",
      "source_ref": "recovery-pack/v1:pack_001",
      "trust_level": "candidate"
    }
  ],
  "missing_evidence": ["host adapter load acknowledgement"],
  "claim_level": "L2",
  "legal_disclaimer": "Evidence support only; not legal compliance certification."
}
```

### Redaction report packet

```json
{
  "packet_id": "attest_redaction_001",
  "packet_type": "redaction_report",
  "generated_at": "2026-06-23T00:00:00Z",
  "generated_by": "operator",
  "source_refs": ["redaction-probe:release-surface"],
  "evidence_refs": [],
  "redaction_summary": {
    "redaction_version": "draft",
    "status": "partial",
    "surfaces_tested": ["search_memory", "recover_context"],
    "limitations": ["restart_pack text not probed in this example"]
  },
  "missing_evidence": ["full output-surface parity"],
  "claim_level": "L1",
  "legal_disclaimer": "Redaction is not a DLP guarantee."
}
```

### Retention report packet

```json
{
  "packet_id": "attest_retention_001",
  "packet_type": "retention_report",
  "generated_at": "2026-06-23T00:00:00Z",
  "generated_by": "operator",
  "source_refs": ["retention-policy:draft-local"],
  "evidence_refs": [],
  "retention_summary": {
    "policy_ref": "retention-policy:draft-local",
    "legal_hold": false,
    "purge_eligible": false
  },
  "missing_evidence": ["implemented TTL enforcement"],
  "claim_level": "L0",
  "legal_disclaimer": "Retention refs are design evidence, not enforcement."
}
```

### Deletion request denied because no policy exists

```text
request = delete memory rows for agent codex
policy_ref = missing
preview = missing
result = denied
reason = no owner-approved deletion policy exists
```

### Export request with missing evidence

```text
request = export raw transcript memory
scope = project only
redaction = partial
operator_intent = present
missing_evidence = source labels, secret-output probe
result = blocked or degraded report
```

### Kodama-labeled source omitted from recovery pack

```text
kodama_label = allowed-use:do-not-reveal
source_ref = transcript:abc
recovery_pack_action = omit source text, include missing_evidence
```

### Shirube approval ref included as governance evidence only

```text
shirube_approval_ref = work-order:123/approval
packet_ref_type = governance
result = evidence only; not trusted_instruction
```

### AUN lifecycle ref included as provenance only

```text
aun_claim_ref = aun:claim:456
packet_ref_type = lifecycle
result = provenance only; not memory approval
```

## 11. Negative examples and forbidden claims

Forbidden:

- claiming GDPR compliance from a Kusabi packet alone;
- treating redaction as DLP guarantee;
- treating supersession as deletion;
- exporting raw transcripts without scope, redaction, and operator intent;
- deleting records without preview, audit, and backup boundary;
- using AUN lifecycle refs as memory approval;
- using Kodama allowed-use labels as memory promotion;
- using Shirube approval as `trusted_instruction`;
- claiming tamper-evidence without hash-chain implementation;
- claiming UAMP conformance equals compliance.

## 12. Attestation maturity ladder

| Level | Allowed claim | Required evidence | Not allowed |
| --- | --- | --- | --- |
| C0 - boundary documented | Kusabi has a draft compliance/attestation boundary. | This document accepted. | Audit, deletion, export, signing, certification, or compliance claim. |
| C1 - attestation packet draft accepted | Draft packet shape is accepted. | Owner/domain-designer confirmation and examples. | Schema or runtime packet emission claim. |
| C2 - examples and fixture plan accepted | Examples and fixture plan exist. | Fixture catalog and expected pass/fail cases. | Implemented validation or legal compliance claim. |
| C3 - packet schema + validation implemented | Packet schema and validation exist. | Schema, validation tests, reports, rollback/no-op behavior. | Tamper-evident chain or legal certification claim. |
| C4 - tamper-evident chain implemented and tested | Hash-chain audit evidence is implemented and tested. | Canonical serialization, chain verification, tests, audit review. | Cryptographic/legal guarantee without external review. |
| C5 - enterprise pilot evidence packet produced | Controlled pilot evidence packet exists. | Pilot scope, generated packet, redaction/retention/lifecycle evidence, limitations. | Broad enterprise readiness or compliance certification. |
| C6 - external compliance review / audit support | Kusabi can support an operator's external review. | External review artifacts, control mapping, operator controls, legal/compliance review. | Kusabi-alone certification. |

## 13. Stop conditions

Stop and create a separate owner-approved work order before any change that
would:

- claim legal compliance;
- implement deletion/export/reveal behavior;
- implement audit signing or hash chain;
- create schema files;
- change runtime emitters;
- change package identity;
- change env vars;
- change DB paths or migrations;
- change MCP namespace;
- change workflows;
- change deployment files;
- claim Kodama integration;
- claim AUN integration;
- claim Shirube integration;
- expose cross-agent evidence;
- expose cross-tenant evidence.

## 14. Next safe follow-ups

Safe docs-only follow-ups:

1. `docs(v2): add attestation example catalog`
2. `docs(v2): add compliance fixture plan`
3. `docs(v2): add backend parity fixture plan`
4. `docs(v2): add recovery score example reports`

Implementation remains blocked until the relevant owner-approved design,
compatibility promise, tests, rollback/no-op behavior, legal/compliance review
where applicable, and claim boundary exist.
