# Wasurezu Governed Action Profiles

> Status: AM-120 inventory/profile contract
> Purpose: make Wasurezu MCP tools Aun Gate-ready before live enforcement exists.
> Machine-readable profile: `docs/design/governance/wasurezu-governed-action-profiles.v1.json`

## Boundary

These profiles classify Wasurezu action surfaces. They do not enable live Aun
Gate enforcement, do not authorize action execution, and do not mutate AUN
queue, claim, requeue, final close, retry, quarantine, merge, or runtime
lifecycle state.

Wasurezu supplies governed memory and recovery evidence. AUN/Shirube may later
consume these profiles for policy, approval, execution-attempt, and audit
records.

Private reasoning is excluded by default. Redaction and retention evidence must
be machine-readable for search, recovery, import, and configuration surfaces.

## Current MCP Inventory

The current MCP surface is defined in `src/index.ts`. Every listed tool has a
matching `wasurezu.<tool>` profile in the JSON file.

| Tool | Capability classes | Risk | Approval posture |
|------|--------------------|------|------------------|
| `log_decision` | `write` | `medium` | conditional only |
| `get_decisions` | `read`, `reveal` | `medium` | conditional for restricted decisions |
| `supersede_decision` | `write` | `medium` | conditional for architecture/release/security/governance decisions |
| `save_task_state` | `write` | `medium` | conditional only |
| `search_memory` | `read`, `reveal` | `high` | conditional for restricted scopes or broad sensitive reveal |
| `recover_context` | `read`, `reveal`, `write` | `high` | conditional for restricted scopes or broad sensitive reveal |
| `restart_pack` | `read`, `reveal` | `high` | conditional for restricted scopes or degraded delivery policies |
| `restart_pack_fetch` | `read`, `reveal`, `write` | `high` | conditional for restricted selected-pack refs |
| `restart_prepare` | `read`, `reveal`, `write` | `high` | standalone `auto_restart` requires AUN absence, supervisor availability, and preauthorization evidence |
| `set_recovery_config` | `admin`, `write` | `critical` | approval required |
| `save_knowledge` | `write` | `medium` | conditional for approved policy/security/customer memory promotion |
| `get_knowledge` | `read`, `reveal` | `medium` | conditional for restricted knowledge |
| `supersede_knowledge` | `write` | `medium` | conditional for policy/security/retention/customer-data knowledge |
| `update_knowledge_status` | `write` | `medium` | conditional for policy/security or retention-sensitive archive/merge |
| `ingest_conversation_events` | `write`, `action`, `reveal` | `high` | required for broad imports outside current-session or allowlisted roots |

## High-Risk Read/Reveal Surfaces

`search_memory`, `recover_context`, `restart_pack`, `restart_pack_fetch`, and
`restart_prepare` may reveal recovery or memory context. Their audit evidence
must include project/scope, result or recovered counts, redaction summary, and
pack/recovery identifiers when applicable.

These tools must not reveal private reasoning. Conversation events are source
data and must remain redacted, bounded, and data-only unless explicitly
promoted by policy.

## Mutation And Retention Surfaces

Memory write/update tools require mutation summaries. Supersession preserves
history; archive/merge is retention-adjacent. `restart_pack_fetch consume=true`
marks a selected handoff as consumed, but this remains a Wasurezu memory
handoff marker and does not mutate AUN queue lifecycle.

`set_recovery_config` is critical because it changes what memory can be
restored and revealed to future agents. It requires approval-note and
human-intent evidence before enterprise enforcement can allow it.

## Import Surface

`ingest_conversation_events` is high risk because it sweeps local transcript
files into memory source data. Current-session or allowlisted roots can be
handled by policy, but broad imports require approval. Ingest adapters must
redact before persistence and hashing, exclude private reasoning, exclude
developer/base instructions, and store visible conversation/tool context only.
