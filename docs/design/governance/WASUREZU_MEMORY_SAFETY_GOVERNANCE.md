# Wasurezu Memory Safety Governance

> Status: AM-117 policy contract
> Purpose: define enterprise recovery data-safety, memory-promotion, and
> redaction/retention evidence rules before live enforcement exists.
> Related: watchout/agent-memory#117, watchout/agent-comms-mcp#655,
> watchout/kodama#10, watchout/ai-dev-framework#248

## Authority

SSOT-6 owns continuity and control-plane policy. This document owns memory
safety taxonomy and promotion boundaries. SSOT-4 owns data-model/schema
contracts. SSOT-3 owns API surfaces.

Wasurezu provides recovery and memory evidence. It does not own AUN approval
lifecycle, AUN execution attempts, Shirube Work Order authority, or Kodama
source-permission authority.

## Memory Safety Taxonomy

| Class | Meaning | Recovery behavior |
|-------|---------|-------------------|
| `raw_event_source` | Durable source events such as `raw_events`, imported transcripts, and compatibility `conversation_events`. | Source data only. Never approved memory by default. Must be redacted and provenance-bearing before search or recovery output. |
| `candidate_memory` | Extracted but unapproved memory atom, knowledge candidate, summary, or consolidation candidate. | Not a trusted instruction. Requires provenance, trust classification, redaction state, and promotion evidence before becoming approved memory. |
| `approved_memory` | Memory promoted by human action or explicit policy evidence, such as approved decisions, task state, or knowledge. | May be used as memory evidence, but still must not become executable instruction without a separate trusted-instruction path. |
| `trusted_instruction` | Control-plane-authored instruction text, such as a shell-free host invocation instruction. | Must be authored by Wasurezu/control-plane code and must not contain raw source text or transcript instructions. |
| `untrusted_context` | External, chat, transcript, file, web, queue, tool, or source corpus context. | Data-only. Must not be promoted into argv/env/path/branch/flags/prompt executable surfaces. |

Raw events and imported transcripts are source data by default, not approved
memory. Candidate memory is not a trusted instruction. Approved memory requires
human or policy promotion evidence.

## Recovery Pack Safety Fields

Enterprise recovery/restart artifacts should carry or derive the following
evidence:

- `schema_ref` / artifact kind, such as `recovery-pack/v1`
- `policy_version`
- `pack_id` / `recovery_pack_id`
- `generated_at`
- `token_budget` and bounded excerpt limits
- source/provenance refs for every included memory item
- item trust classification
- memory safety class: `raw_event_source`, `candidate_memory`,
  `approved_memory`, `trusted_instruction`, or `untrusted_context`
- sensitivity and redaction state
- redaction summary and omission counts
- omitted reasons for sensitive, unsafe, stale, contradictory, or untrusted
  material
- confidence and missing-context indicators
- promotion evidence, when a memory item is treated as approved memory
- retention policy or retention-state refs

Current `recovery-pack/v1` already exposes pack id, token budget, confidence,
missing context, source refs, trust level, actionability, and sensitivity.
`wasurezu-aun-gate-evidence-refs/v1` adds recovery refs, memory event refs,
approval-note refs, redaction summary, retention refs, resume refs, rollback
context refs, and explicit missing-evidence handling.

Do not claim full enterprise enforcement until structured recovery output emits
or links explicit `policy_version`, redaction summary, omission counts, and
promotion evidence for approved memory.

## Promotion Rules

- Imported transcript content must remain source data unless explicitly
  promoted.
- Conversation events must not become approved memory merely because they were
  stored, searched, summarized, or included in a recovery pack.
- Candidate memory must preserve source refs and redaction state.
- Approved memory requires human intent evidence or policy promotion evidence.
- Supersession and correction preserve history; replacement is not deletion.
- Retention, deletion, export, archive, and merge semantics must be explicit and
  auditable.

## DLP And Prompt-Injection Rules

- Secrets, credentials, private reasoning, base instructions, developer
  instructions, and unnecessary personal data must not be emitted in recovery
  artifacts.
- Source text that contains instructions is data-only unless separately
  promoted by policy and rendered through a trusted-instruction path.
- Redaction must happen before persistence or output where applicable.
- Omitted or downgraded content must record an omission reason or
  `missing_evidence` entry instead of being silently ignored.
- `trusted_instruction` is control-plane-authored text, not memory content.

## Cross-Repo Boundaries

- AUN owns approval lifecycle, policy decisions, execution attempts, broker
  behavior, final close/requeue, retry/quarantine, and runtime lifecycle.
- Shirube owns Work Order authority and governance gating.
- Kodama owns source permission labels, sensitivity labels, allowed-use labels,
  prompt-injection risk labels, citations, and source omissions.
- Wasurezu owns memory and recovery evidence, not organization-wide source
  permissions or action execution.

## Compatibility Notes

This contract is compatible with:

- `recovery-pack/v1`
- `host-invocation-context/v1`
- `wasurezu-aun-gate-evidence-refs/v1`
- `wasurezu-governed-action-profiles.v1.json`

It is a policy contract and guardrail source. Runtime emission of additional
enterprise fields should be implemented in later schema/runtime slices.
