# Kusabi V2 Scale and Identity Model Draft

Status: draft
Scope: scale, identity, and federation design only
Runtime impact: none
Identity implementation status: not implemented
Federation status: not implemented
Base: `KUSABI_V2_IMPLEMENTATION_READINESS_PLAN.md`

## 1. Purpose and status

This document defines the Kusabi V2 scale and identity model before any runtime
identity or federation work begins.

This is a scale and identity design model. It prepares future federation,
tenant, user, team, and domain identity work; it does not authorize or implement
that work.

Current status:

- Runtime behavior is unchanged.
- No tenant identity is implemented by this PR.
- No user identity is implemented by this PR.
- No cross-agent reads are enabled.
- No cross-tenant reads are enabled.
- Current compatibility boundary remains `agent_id + optional project`.
- Existing `AGENT_MEMORY_AGENT_ID` behavior is preserved.
- Existing `AGENT_MEMORY_PROJECT` behavior is preserved.
- No env var rename is authorized.
- No DB schema migration is authorized.
- No current package, MCP, or runtime change is authorized.

## 2. Current compatibility boundary

The current memory boundary remains:

```text
memory boundary = agent_id + optional project
```

Current interpretation:

| Field or ref | Current meaning | Boundary role |
| --- | --- | --- |
| `agent_id` / `AGENT_MEMORY_AGENT_ID` | Current primary memory namespace. | Primary isolation boundary. |
| `project` / `AGENT_MEMORY_PROJECT` | Optional project/workspace filter inside an agent namespace. | Soft filter, not tenant identity. |
| `session_id` | Runtime/session provenance. | Trace only; not a namespace. |
| runtime/source | Runtime or host provenance such as `codex`, `claude_code`, `manual`, or host adapter metadata. | Trace/capability evidence only; not a namespace. |
| AUN ids | External queue, claim, lease, task, or lifecycle refs. | External lifecycle provenance only. |
| common registry refs | Binding evidence where available. | Evidence ref, not Kusabi-owned identity policy. |

Preservation rules:

- Keep existing `AGENT_MEMORY_AGENT_ID`.
- Keep existing `AGENT_MEMORY_PROJECT`.
- Do not rename env vars.
- Do not change current DB schema.
- Do not change current package identity.
- Do not change current MCP namespace.
- Do not change runtime behavior.

## 3. Identity layer model

Kusabi V2 should distinguish identity layers instead of overloading
`agent_id`, `project`, runtime source, or session IDs.

| Layer | Meaning | Stability | Current or future | Boundary role | Owner system |
| --- | --- | --- | --- | --- | --- |
| Tenant | Hard isolation container for customer/account/legal boundary. | High, long lived. | Future. | Security boundary. | Operator or enterprise identity provider. |
| Organization | Administrative identity, billing, policy, or common registry grouping. | High, long lived. | Future. | Hard/admin boundary. | Operator, registry, or enterprise identity provider. |
| Workspace / project | Work area, repository, client workspace, or domain context. | Medium. | Current as optional `project`; future as richer workspace. | Current soft filter; future policy scope. | Kusabi for current field; operator/registry for future richer identity. |
| Team / fleet | Group of agents or workers allowed to coordinate under explicit policy. | Medium. | Future. | Federation policy scope. | Operator or suite policy layer. |
| Agent | Primary memory actor namespace. | Medium to high. | Current. | Current primary memory namespace. | Kusabi/operator config. |
| Role / persona | Functional mode such as reviewer, implementer, planner, or domain agent. | Medium. | Future. | Filter/provenance; not isolation by itself. | Operator or host adapter. |
| Human owner / operator | Person or account responsible for approval, promotion, or policy. | High. | Future/evidence now. | Approval/provenance; future policy boundary. | Enterprise identity provider, Shirube, or operator. |
| Runtime | Host/runtime such as Codex, Claude Code, MCP-only, or adapter. | Medium. | Current as provenance; future as capability model. | Provenance/capability only. | Host adapter/runtime. |
| Session | Short-lived run or conversation instance. | Low. | Current/future provenance. | Trace only; never memory namespace. | Runtime/host. |
| Task / work item | Unit of work, issue, PR, ticket, AUN task, or work order. | Medium. | Current/future provenance. | Lifecycle reference; not memory namespace. | AUN, Shirube, host, or external system. |
| Source / artifact | File, tool output, transcript, ticket, issue, doc, citation, or external evidence. | Variable. | Current/future evidence. | Source/provenance; not identity boundary. | Source system, Kodama, host, or operator. |

Identity rule:

```text
Only an explicit identity model can create new identity boundaries.
Refs from sessions, runtimes, tasks, AUN, Kodama, Shirube, or source artifacts
do not automatically become Kusabi memory namespaces.
```

## 4. Boundary decision table

| Layer | Current field | V2 status | Boundary role | Default sharing |
| --- | --- | --- | --- | --- |
| Tenant | none | future | hard boundary | forbidden |
| Organization | none/common registry ref | future | hard/admin boundary | forbidden |
| Project | `project` / `AGENT_MEMORY_PROJECT` | current | soft filter | same agent only |
| Agent | `agent_id` / `AGENT_MEMORY_AGENT_ID` | current | current primary memory namespace | isolated |
| Session | `session_id` | current/future provenance | trace only | no namespace |
| Runtime | `source`, host adapter metadata | current/future provenance | trace/capability only | no namespace |
| AUN claim/queue ids | metadata | external provenance | lifecycle owner ref | no namespace |
| Kodama source labels | policy refs | future/evidence | source-policy evidence | no namespace |
| Shirube work order refs | approval/audit refs | future/evidence | governance evidence | no namespace |

## 5. Federation model

Future cross-agent memory federation is explicit and default-forbidden.

Required principles:

- No implicit cross-agent reads.
- No cross-tenant reads by default.
- No raw transcript sharing by default.
- Federation grant must be explicit.
- Federated memory is trust-downgraded unless promotion policy says otherwise.
- Every federated read emits provenance and trust-boundary metadata.
- Federation does not convert source text into `trusted_instruction`.
- Federation must be scoped by agent, project, memory type, tags, time, and max
  items.

Draft grant shape:

```ts
interface KusabiFederationGrantDraft {
  grant_id: string;
  from_agent_id: string;
  to_agent_id: string;
  project?: string;
  memory_classes: Array<
    "raw_event_source" |
    "candidate_memory" |
    "approved_memory" |
    "untrusted_context"
  >;
  allowed_kinds: Array<
    "decision" |
    "task_state" |
    "knowledge" |
    "raw_event" |
    "recovery_pack"
  >;
  tags?: string[];
  since?: string;
  max_items?: number;
  trust_downgrade: "candidate_memory" | "untrusted_context";
  promotion_allowed: boolean;
  expires_at?: string;
  approved_by?: string;
  approval_ref?: string;
}
```

This is draft documentation only. It is not a schema file and does not authorize
runtime federation, DB migration, cross-agent reads, or cross-tenant reads.

## 6. Trust downgrade rules

Trust must not increase when memory crosses a boundary.

| Crossing | Default trust result |
| --- | --- |
| Same agent, same project active memory | May keep current classification. |
| Same agent, cross-project memory | Treat as `candidate_memory` unless explicitly scoped. |
| Cross-agent memory | Default to `candidate_memory` or `untrusted_context`. |
| Cross-tenant memory | Forbidden. |
| `raw_event_source` crossing any boundary | Remains `raw_event_source` or becomes `untrusted_context`. |
| `approved_memory` crossing agent boundaries | Loses approved status unless grant and promotion evidence allow it. |
| `trusted_instruction` from memory content | Never crosses from memory content. Trusted instruction must be control-plane-authored. |
| AUN task text into Kusabi | Raw source or candidate memory only. |
| Kodama label into Kusabi | Source-policy evidence only, not memory approval. |
| Shirube approval into Kusabi | Approval evidence only, not trusted instruction. |

Hard rule:

```text
trusted_instruction never originates from federated memory content.
```

## 7. Domain expansion identity model

Future non-coding domains fit the agent-continuity category through explicit
identity anchors, adapters, source policy, retention, and evaluation fixtures.
This document does not claim current runtime support for non-coding domains.

| Domain | Likely identity anchors | Sensitive data risks | Required before support claim |
| --- | --- | --- | --- |
| Sales | account, contact, opportunity, pipeline stage, CRM source refs | PII, customer promises, confidential pricing, consent scope | CRM adapter policy, source permission labels, retention profile, domain evaluation fixtures. |
| Marketing | campaign, segment, channel, brand asset, approval record | brand/policy violations, audience targeting sensitivity, unpublished campaign data | Brand approval policy, source labels, adapter scope, reveal/omission rules. |
| Support | customer, case, ticket, entitlement, escalation | PII, contractual obligations, support secrets, customer history | Ticket adapter policy, retention/legal hold rules, redaction fixtures, customer boundary design. |
| Research | project, source, citation, hypothesis, review state | source reliability, citation integrity, embargoed sources, hallucinated attribution | Citation/source policy, reliability labels, review fixtures, provenance requirements. |
| Ops | incident, service, runbook, mitigation, postmortem | operational risk, privileged commands, outage details, secret-bearing logs | Runbook/incident adapter policy, command boundary, redaction rules, audit evidence. |
| Legal/finance | matter, vendor, contract, payment, obligation | high compliance risk, regulated data, privilege, payment data | Legal/compliance review, strict retention, access policy, export/reveal controls, domain fixtures. |

Each future domain must remain blocked until adapter/source policy, identity
anchors, retention, redaction, and evaluation fixtures exist.

## 8. Relationship to UAMP

UAMP may represent identity and provenance refs in memory and recovery artifacts.

UAMP does not create permission by itself.

Rules:

- UAMP artifacts may carry tenant, organization, project, agent, session, task,
  source, approval, and adapter refs.
- UAMP conformance does not imply federation permission.
- UAMP conformance does not imply cross-agent read permission.
- UAMP conformance does not imply tenant/user identity is implemented.
- Federation and tenant boundaries are Kusabi/operator policy.
- A UAMP artifact may carry identity refs, but access control remains outside
  the artifact alone.

## 9. Relationship to AUN / Kodama / Shirube

This model follows `KUSABI_V2_SUITE_INTEROP_BOUNDARY.md`.

| System | Owns | Kusabi handling |
| --- | --- | --- |
| AUN / A2A | Lifecycle ids, queue, claim, lease, task movement, runtime orchestration. | Store refs as external lifecycle provenance only. |
| Kodama | Source permission, sensitivity, allowed-use labels, omission/citation policy. | Attach refs as source-policy evidence where available. |
| Shirube | Work-order authority, governance gates, approvals, audits, enforcement mode. | Attach refs as approval/audit evidence where available. |
| Kusabi | Memory, recovery packs, source-bearing memory evidence, confidence, missing context. | Preserve memory boundary and trust classification. |

None of these refs automatically become a Kusabi memory namespace.
None of these refs automatically promote memory.
None of these refs create `trusted_instruction`.

## 10. Required examples

### Same-agent same-project read

Allowed under the current compatibility boundary.

```text
agent_id = codex
project = watchout/agent-memory
read scope = same agent + same project
result = may keep current classification
```

### Same-agent cross-project read

Allowed only as an explicitly scoped search/read, not as a namespace merge.

```text
agent_id = codex
from project = project-a
to project = project-b
result = candidate_memory unless policy says otherwise
```

### Cross-agent federated decision read

Future-only and requires an explicit grant.

```text
from_agent_id = planner
to_agent_id = implementer
allowed_kinds = ["decision"]
trust_downgrade = candidate_memory
result = decision visible as candidate memory with federation provenance
```

### Cross-agent raw transcript read denied

Default is denied.

```text
from_agent_id = agent-a
to_agent_id = agent-b
memory_class = raw_event_source
grant = none
result = denied
```

### Cross-tenant read denied

Always denied until a tenant model and explicit migration exist.

```text
tenant_a -> tenant_b
result = denied
```

### AUN claim id recorded as provenance only

```text
aun_claim_id = claim-123
kusabi_agent_id = codex
result = lifecycle provenance only; not namespace
```

### Kodama label attached to raw source item

```text
kodama_label_ref = source-policy:pii-limited-use
memory_class = raw_event_source
result = source-policy evidence; not approval
```

### Shirube approval ref attached as evidence only

```text
shirube_approval_ref = work-order-approval:abc
memory_class = candidate_memory
result = governance evidence; not trusted_instruction
```

### `session_id` rejected as namespace

```text
requested namespace = session_id:abc
result = reject; session_id is provenance only
```

## 11. Negative examples and forbidden designs

Forbidden:

- Using `session_id` as memory namespace.
- Using AUN claim id as `agent_id`.
- Using runtime name as namespace.
- Default cross-agent search.
- Raw transcript federation by default.
- Treating a Kodama allowed-use label as memory approval.
- Treating Shirube approval as automatic `trusted_instruction`.
- Cross-tenant reads without tenant model.
- Changing `AGENT_MEMORY_AGENT_ID` semantics without migration.
- Changing `AGENT_MEMORY_PROJECT` semantics without migration.
- Replacing `agent_id + optional project` before compatibility tests exist.

## 12. Migration checkpoints

| Checkpoint | Allowed claim | Required evidence | Not allowed |
| --- | --- | --- | --- |
| S0 | Current `agent_id + project` boundary is documented. | This document and current compatibility behavior. | Tenant/user/federation claim. |
| S1 | Identity model is accepted. | Owner/domain-designer confirmation. | Runtime identity change. |
| S2 | Federation schema/design is accepted. | Explicit federation design, grant shape, negative cases. | Cross-agent reads. |
| S3 | Local-only federation fixture plan exists. | Fixture catalog and pass/fail expectations. | Runtime federation. |
| S4 | Cross-agent read prototype with trust downgrade exists. | Separate implementation PR, tests, rollback/no-op behavior. | Production federation or cross-tenant reads. |
| S5 | Tenant/user identity migration design exists. | Migration plan, compatibility tests, backup/rollback, operator approval. | Tenant/user default switch. |
| S6 | Enterprise identity integration pilot exists. | Pilot scope, audit evidence, tenant/user boundary tests, legal/security review. | Broad enterprise identity claim. |

## 13. Stop conditions

Stop and create a separate owner-approved work order before any change that
would:

- change env vars;
- change DB schema;
- enable cross-agent reads;
- introduce tenant identity;
- introduce user identity;
- replace `agent_id` with AUN refs;
- replace `agent_id` with Kodama refs;
- replace `agent_id` with Shirube refs;
- change runtime behavior;
- change MCP namespace;
- implement federation;
- claim federation support;
- claim tenant/user support;
- claim non-coding domain support.

## 14. Next safe follow-ups

Safe docs-only follow-ups:

1. `docs(v2): add federation grant design`
2. `docs(v2): add identity migration checkpoint plan`
3. `docs(v2): add domain adapter identity boundary`
4. `docs(v2): add compliance attestation boundary`
5. `docs(v2): add recovery score contract`

Implementation remains blocked until the relevant owner-approved design,
compatibility promise, tests, rollback/no-op behavior, and claim boundary exist.
