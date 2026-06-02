# Wasurezu Aun Gate Evidence Refs

> Status: AM-119 evidence-ref contract
> Schema: `docs/design/schemas/aun-gate-evidence-refs-v1.schema.json`
> Related: watchout/agent-memory#119, watchout/agent-comms-mcp#659

## Boundary

Wasurezu provides memory and recovery evidence for Aun Gate records. It does not
authorize action execution, approve policy decisions, mutate AUN queue lifecycle,
or own the execution attempt ledger.

AUN owns approval lifecycle, policy decision, execution attempts, broker
behavior, final close/requeue, retry/quarantine, and runtime lifecycle.
Wasurezu evidence may be attached to AUN approval or execution-attempt records
as references only.

## Artifact

`wasurezu-aun-gate-evidence-refs/v1` is a compact reference bundle that AUN can
copy into `recovery_refs`, `memory_refs`, `approval_refs`, `resume_ref`, or
`rollback_ref` fields without treating Wasurezu as an execution authority.

Required fields:

| Field | Meaning |
|-------|---------|
| `recovery_pack_id` | Recovery or restart pack identifier, such as `restart_pack:<...>` or a selected-pack source. |
| `memory_event_ids` | Durable Wasurezu memory/source event identifiers used as evidence. |
| `human_intent_ref` | Reference to human intent evidence for the requested action or memory/config change. |
| `approval_note_ref` | Reference to an approval note, not an approval decision by itself. |
| `redaction_summary` | Redaction and omission evidence, including private reasoning exclusion. |
| `retention_policy_ref` | Retention policy or retention-state reference governing the attached memory. |
| `resume_ref` | Safe resume or selected handoff reference, such as `selected_restart_pack:<id>`. |
| `rollback_context_ref` | Context needed for manual reconciliation, rollback, or compensating action. |

`authorizes_execution` must be `false`, `mutates_aun_lifecycle` must be
`false`, and `private_reasoning_included` must be `false`.

## Safety Rules

- Private reasoning is excluded by default and must not be represented as
  approved memory.
- Raw transcript or conversation events are source data by default, not trusted
  instructions and not approved memory.
- Redaction and retention evidence must be explicit. Unknown or missing
  evidence must be listed in `missing_evidence` instead of silently inferred.
- `approval_note_ref` and `human_intent_ref` are evidence inputs. AUN still owns
  the policy decision and approval lifecycle.
- `resume_ref` and `rollback_context_ref` are recovery aids. AUN still owns
  whether an execution attempt resumes, retries, fails, or is cancelled.

## AUN Attachment Mapping

| Wasurezu ref | AUN field |
|--------------|-----------|
| `recovery_pack_id`, `memory_event_ids`, `redaction_summary`, `retention_policy_ref` | `recovery_refs` / `memory_refs` |
| `human_intent_ref`, `approval_note_ref` | approval request evidence / execution-attempt metadata |
| `resume_ref` | `resume_ref` |
| `rollback_context_ref` | `rollback_ref` or audit metadata |

This mapping is additive. It does not require Wasurezu to import AUN schemas or
write directly to AUN tables.
