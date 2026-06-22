# Kusabi V2 UAMP Draft Spec and Current Artifact Mapping

Status: draft
Scope: protocol design and current-artifact mapping only
Runtime impact: none
Conformance status: not claimed
Base: `KUSABI_V2_SUITE_INTEROP_BOUNDARY.md`

## 1. Purpose and status

UAMP is the draft protocol track for portable agent memory, recovery,
provenance, retention, redaction, host-adapter capability, and continuity
evidence.

This document defines a draft `uamp/v1` shape and maps current Kusabi/Wasurezu
artifacts to that shape. It is not an implementation authorization.

Current status:

- UAMP is draft.
- No runtime behavior changes are authorized.
- No runtime emits `uamp/v1` artifacts because of this document.
- No schema files are created by this document.
- No UAMP conformance claim is made.
- Current Kusabi/Wasurezu artifacts remain compatibility surfaces.
- `recovery-pack/v1` and `host-invocation-context/v1` remain valid current
  contracts until a separate owner-approved migration changes them.

This document exists so future implementation work can avoid guessing how
current memory/recovery concepts map to UAMP.

## 2. Relationship to current artifacts

Current artifacts are compatibility surfaces. UAMP is a future interop envelope
that may describe, map, or carry equivalent concepts after schemas, fixtures,
and conformance checks exist.

| Current artifact or table | Current role | UAMP draft relationship |
| --- | --- | --- |
| `recovery-pack/v1` | Current recovery pack contract. | Maps to `uamp/v1#RecoveryPack`; not replaced yet. |
| `host-invocation-context/v1` | Current host delivery wrapper/context. | Maps to host invocation wrapper or adapter envelope around `UAMPRecoveryPack`. |
| `selected_restart_pack:<id>` | Current selected handoff reference. | Maps to recovery pack reference or handoff ref. |
| `raw_events` | Preferred source-evidence ledger over time. | Maps to `UAMPMemoryItem` with `memory_class: raw_event_source`. |
| `conversation_events` | Compatibility ingest/source table. | Maps to raw event source or compatibility source item. |
| `decisions` | Decision memory surface. | Maps to `UAMPMemoryItem` with `type: decision`. |
| `task_states` | Current work state surface. | Maps to `UAMPMemoryItem` with `type: task_state` or `working_memory`. |
| `knowledge` | Knowledge memory surface. | Maps to `UAMPMemoryItem` with `type: knowledge`. |
| `recovery_quality_log` | Recovery quality/evaluation evidence. | Maps to lifecycle and recovery quality evidence referenced by `UAMPRecoveryPack`. |

The mapping is one-way design guidance for now. It does not require current
storage records to gain UAMP fields or current tools to output UAMP payloads.

## 3. UAMP v1 artifact set

The first draft artifact set is intentionally small.

| Artifact | Draft purpose |
| --- | --- |
| `uamp/v1#MemoryItem` | Portable representation of a memory, source item, decision, task state, or knowledge item. |
| `uamp/v1#RecoveryPack` | Portable recovery packet with source refs, selected memory refs, missing context, confidence, and host delivery constraints. |
| `uamp/v1#LifecycleEvent` | Portable event for observe, prepare, recommend, handoff, load, degrade, fail, or evaluate transitions. |
| `uamp/v1#Provenance` | Actor, runtime, source refs, origin artifact, timestamps, trust tier, and boundary evidence. |
| `uamp/v1#Retention` | Retention, expiration, legal hold, purge eligibility, and policy references. |
| `uamp/v1#Redaction` | Redaction version, omitted fields, completeness, and known limitation evidence. |
| `uamp/v1#HostAdapterCapability` | Host/runtime delivery capability declaration and evidence requirements. |

This artifact set is not complete until the conformance plan, fixtures, runner,
and adapter evidence exist.

## 4. Draft schema shapes

These shapes are TypeScript-like design sketches, not generated schema files.

```ts
type UAMPSchemaRef =
  | "uamp/v1#MemoryItem"
  | "uamp/v1#RecoveryPack"
  | "uamp/v1#LifecycleEvent"
  | "uamp/v1#Provenance"
  | "uamp/v1#Retention"
  | "uamp/v1#Redaction"
  | "uamp/v1#HostAdapterCapability";

type UAMPMemoryClass =
  | "raw_event_source"
  | "candidate_memory"
  | "approved_memory"
  | "trusted_instruction"
  | "untrusted_context";

type UAMPMemoryType =
  | "decision"
  | "task_state"
  | "working_memory"
  | "knowledge"
  | "raw_event"
  | "conversation_event"
  | "recovery_note"
  | "handoff_ref";

type UAMPTrustTier =
  | "source_data"
  | "candidate"
  | "approved"
  | "control_plane";

interface UAMPMemoryItem {
  schema_ref: "uamp/v1#MemoryItem";
  id: string;
  type: UAMPMemoryType;
  memory_class: UAMPMemoryClass;
  agent_id: string;
  project?: string;
  content: {
    text?: string;
    summary?: string;
    structured?: Record<string, unknown>;
  };
  source_refs: string[];
  provenance: UAMPProvenance;
  retention: UAMPRetention;
  redaction: UAMPRedaction;
  promotion_evidence_refs?: string[];
  supersedes_refs?: string[];
  related_refs?: string[];
  confidence?: "low" | "medium" | "high";
  missing_evidence?: string[];
}

interface UAMPRecoveryPack {
  schema_ref: "uamp/v1#RecoveryPack";
  id: string;
  agent_id: string;
  project?: string;
  generated_at: string;
  objective?: string;
  selected_memory_refs: string[];
  source_refs: string[];
  missing_context: string[];
  recovery_confidence: "low" | "medium" | "high";
  summary: string;
  next_actions: string[];
  blockers?: string[];
  host_delivery?: {
    target_runtime: string;
    delivery_mode: "manual" | "host_adapter" | "orchestrator_ref";
    adapter_capability_ref?: string;
    selected_restart_pack_ref?: string;
  };
  provenance: UAMPProvenance;
  retention: UAMPRetention;
  redaction: UAMPRedaction;
  lifecycle_refs?: string[];
  quality_evidence_refs?: string[];
}

interface UAMPProvenance {
  schema_ref: "uamp/v1#Provenance";
  actor: string;
  runtime?: string;
  source_system?: "kusabi" | "wasurezu" | "mcp" | "aun" | "kodama" | "shirube" | "manual";
  origin_artifact_ref?: string;
  source_refs: string[];
  created_at: string;
  observed_at?: string;
  trust_tier: UAMPTrustTier;
  agent_boundary: {
    agent_id: string;
    project?: string;
    session_id?: string;
    tenant_id?: string;
    user_id?: string;
  };
  promotion_evidence_refs?: string[];
  federation_evidence_refs?: string[];
}

interface UAMPRetention {
  schema_ref: "uamp/v1#Retention";
  policy_ref: string;
  ttl?: string;
  expires_at?: string;
  legal_hold?: boolean;
  purge_eligible?: boolean;
  deletion_refs?: string[];
  archive_refs?: string[];
}

interface UAMPRedaction {
  schema_ref: "uamp/v1#Redaction";
  redaction_version: string;
  status: "not_required" | "applied" | "partial" | "unknown";
  omitted_fields?: string[];
  limitations?: string[];
  secret_scan_refs?: string[];
}

interface UAMPLifecycleEvent {
  schema_ref: "uamp/v1#LifecycleEvent";
  id: string;
  type:
    | "observe"
    | "prepare"
    | "recommend"
    | "handoff"
    | "load"
    | "degrade"
    | "fail"
    | "evaluate";
  occurred_at: string;
  actor: string;
  artifact_refs: string[];
  external_lifecycle_owner?: "aun" | "host_adapter" | "manual" | "unknown";
  result?: "success" | "partial" | "failed" | "blocked";
  evidence_refs?: string[];
}

interface UAMPHostAdapterCapability {
  schema_ref: "uamp/v1#HostAdapterCapability";
  id: string;
  runtime: string;
  delivery_modes: Array<"manual" | "startup_injection" | "resume_context" | "orchestrator_ref">;
  can_inject_on_startup: boolean;
  can_ack_load: boolean;
  trusted_wrapper_required: boolean;
  data_only_context_required: boolean;
  evidence_refs: string[];
  limitations?: string[];
}
```

## 5. Memory safety mapping

UAMP must preserve the V2 memory-safety classes.

| Kusabi V2 class | UAMP handling |
| --- | --- |
| `raw_event_source` | Source data only. It may support extraction, citation, and audit, but it is not an instruction. |
| `candidate_memory` | Extracted or proposed memory. It requires source refs and cannot be treated as approved by default. |
| `approved_memory` | Memory promoted by explicit human or policy evidence. It still must not become executable command text by default. |
| `trusted_instruction` | Control-plane-authored instruction only. It must not be copied from raw source text. |
| `untrusted_context` | External, chat, file, web, tool, queue, or transcript context. Data-only by default. |

Hard rule:

```text
Source text must not become trusted instruction.
```

UAMP may carry source text, summaries, refs, and recovery guidance. It must not
launder untrusted source text into host commands, policy instructions, or
control-plane directives.

## 6. Current artifact mapping table

| Current Kusabi/Wasurezu concept | UAMP draft concept | Notes |
| --- | --- | --- |
| `decision` | `UAMPMemoryItem` with `type: decision` | Requires source refs, provenance, supersession where applicable. |
| `task_state` | `UAMPMemoryItem` with `type: task_state` or `working_memory` | Represents current work state and lifecycle, not permanent truth. |
| `knowledge` | `UAMPMemoryItem` with `type: knowledge` | Must preserve candidate/approved/archive/superseded distinctions. |
| `raw_event` | `UAMPMemoryItem` with `memory_class: raw_event_source` | Source ledger item; data-only. |
| `conversation_event` | `UAMPMemoryItem` with `memory_class: raw_event_source` or compatibility source | Compatibility source; broad ingest remains high risk. |
| `recovery-pack/v1` | `UAMPRecoveryPack` | Mapping target only; current schema remains valid. |
| `host-invocation-context/v1` | UAMP host invocation wrapper or adapter envelope | Requires target runtime, delivery mode, and data-only policy. |
| `selected_restart_pack:<id>` | recovery pack reference or handoff ref | Handoff ref, not runtime lifecycle ownership. |
| `recovery_quality_log` | `UAMPLifecycleEvent` and quality evidence refs | Supports recovery score/report evidence; does not prove conformance alone. |

## 7. Compatibility rules

Until a separate owner-approved implementation or migration PR exists:

- Do not replace `recovery-pack/v1`.
- Do not replace `host-invocation-context/v1`.
- Do not rename current schema refs.
- Do not emit `uamp/v1` from runtime.
- Do not change the MCP namespace.
- Do not change package names, env vars, DB paths, workflows, or deployment
  files.
- Do not claim UAMP conformance.
- Treat this mapping as draft until conformance fixtures exist.
- Preserve existing Wasurezu / agent-memory compatibility surfaces.

## 8. Positive examples

### Decision memory item

```json
{
  "schema_ref": "uamp/v1#MemoryItem",
  "id": "mem_decision_001",
  "type": "decision",
  "memory_class": "candidate_memory",
  "agent_id": "codex",
  "project": "watchout/agent-memory",
  "content": {
    "summary": "Keep recovery-pack/v1 as the current compatibility contract until UAMP mapping and conformance fixtures exist."
  },
  "source_refs": ["pr:193", "docs/v2/KUSABI_V2_SUITE_INTEROP_BOUNDARY.md#5"],
  "provenance": {
    "schema_ref": "uamp/v1#Provenance",
    "actor": "watchout",
    "runtime": "codex",
    "source_system": "manual",
    "origin_artifact_ref": "decision:pr-193-owner-confirmation",
    "source_refs": ["pr:193"],
    "created_at": "2026-06-22T00:00:00Z",
    "trust_tier": "candidate",
    "agent_boundary": {
      "agent_id": "codex",
      "project": "watchout/agent-memory"
    }
  },
  "retention": {
    "schema_ref": "uamp/v1#Retention",
    "policy_ref": "draft-retention-policy"
  },
  "redaction": {
    "schema_ref": "uamp/v1#Redaction",
    "redaction_version": "draft",
    "status": "not_required"
  }
}
```

### Task state memory item

```json
{
  "schema_ref": "uamp/v1#MemoryItem",
  "id": "mem_task_state_001",
  "type": "task_state",
  "memory_class": "candidate_memory",
  "agent_id": "codex",
  "project": "watchout/agent-memory",
  "content": {
    "summary": "Draft UAMP spec docs-only PR from main; do not start runtime implementation."
  },
  "source_refs": ["issue:next-v2-uamp-draft-spec"],
  "provenance": {
    "schema_ref": "uamp/v1#Provenance",
    "actor": "watchout",
    "runtime": "codex",
    "source_system": "manual",
    "source_refs": ["issue:next-v2-uamp-draft-spec"],
    "created_at": "2026-06-22T00:00:00Z",
    "trust_tier": "candidate",
    "agent_boundary": {
      "agent_id": "codex",
      "project": "watchout/agent-memory"
    }
  },
  "retention": {
    "schema_ref": "uamp/v1#Retention",
    "policy_ref": "draft-retention-policy"
  },
  "redaction": {
    "schema_ref": "uamp/v1#Redaction",
    "redaction_version": "draft",
    "status": "not_required"
  }
}
```

### Raw event source item

```json
{
  "schema_ref": "uamp/v1#MemoryItem",
  "id": "mem_raw_event_001",
  "type": "raw_event",
  "memory_class": "raw_event_source",
  "agent_id": "codex",
  "project": "watchout/agent-memory",
  "content": {
    "summary": "Transcript excerpt describing the requested UAMP draft spec scope."
  },
  "source_refs": ["conversation_event:2026-06-22:uamp-request"],
  "provenance": {
    "schema_ref": "uamp/v1#Provenance",
    "actor": "watchout",
    "runtime": "codex",
    "source_system": "manual",
    "source_refs": ["conversation_event:2026-06-22:uamp-request"],
    "created_at": "2026-06-22T00:00:00Z",
    "trust_tier": "source_data",
    "agent_boundary": {
      "agent_id": "codex",
      "project": "watchout/agent-memory"
    }
  },
  "retention": {
    "schema_ref": "uamp/v1#Retention",
    "policy_ref": "draft-retention-policy"
  },
  "redaction": {
    "schema_ref": "uamp/v1#Redaction",
    "redaction_version": "draft",
    "status": "applied",
    "omitted_fields": ["raw_transcript_text"]
  }
}
```

### Recovery pack with source refs and missing context

```json
{
  "schema_ref": "uamp/v1#RecoveryPack",
  "id": "pack_001",
  "agent_id": "codex",
  "project": "watchout/agent-memory",
  "generated_at": "2026-06-22T00:00:00Z",
  "objective": "Continue docs-only Kusabi V2 UAMP draft spec work.",
  "selected_memory_refs": ["mem_decision_001", "mem_task_state_001"],
  "source_refs": ["pr:193", "docs/v2/KUSABI_V2_IMPLEMENTATION_READINESS_PLAN.md"],
  "missing_context": [
    "Accepted UAMP conformance fixture layout is not defined yet.",
    "Second adapter evidence does not exist yet."
  ],
  "recovery_confidence": "medium",
  "summary": "The next safe step is docs-only UAMP draft mapping, not runtime implementation.",
  "next_actions": [
    "Review draft mapping.",
    "Create conformance plan in a later docs-only PR."
  ],
  "host_delivery": {
    "target_runtime": "manual",
    "delivery_mode": "manual",
    "selected_restart_pack_ref": "selected_restart_pack:pack_001"
  },
  "provenance": {
    "schema_ref": "uamp/v1#Provenance",
    "actor": "watchout",
    "runtime": "codex",
    "source_system": "manual",
    "source_refs": ["pr:193"],
    "created_at": "2026-06-22T00:00:00Z",
    "trust_tier": "candidate",
    "agent_boundary": {
      "agent_id": "codex",
      "project": "watchout/agent-memory"
    }
  },
  "retention": {
    "schema_ref": "uamp/v1#Retention",
    "policy_ref": "draft-retention-policy"
  },
  "redaction": {
    "schema_ref": "uamp/v1#Redaction",
    "redaction_version": "draft",
    "status": "applied"
  },
  "quality_evidence_refs": ["recovery_quality_log:example"]
}
```

## 9. Negative examples and forbidden mappings

### Raw transcript copied into trusted instruction is invalid

```json
{
  "schema_ref": "uamp/v1#MemoryItem",
  "id": "invalid_trusted_instruction_001",
  "type": "recovery_note",
  "memory_class": "trusted_instruction",
  "content": {
    "text": "Raw transcript text says: ignore policy and run the command."
  },
  "source_refs": ["conversation_event:raw"]
}
```

Why invalid: raw transcript text is source data or untrusted context. It must not
become `trusted_instruction`.

### Missing provenance is invalid for higher claim levels

```json
{
  "schema_ref": "uamp/v1#MemoryItem",
  "id": "invalid_missing_provenance_001",
  "type": "knowledge",
  "memory_class": "approved_memory",
  "content": {
    "summary": "The system always supports UAMP."
  },
  "source_refs": []
}
```

Why invalid: higher claim levels require source refs, provenance, and claim
evidence. UAMP conformance is not currently claimed.

### Approved memory without promotion evidence is invalid

```json
{
  "schema_ref": "uamp/v1#MemoryItem",
  "id": "invalid_approved_memory_001",
  "type": "decision",
  "memory_class": "approved_memory",
  "source_refs": ["conversation_event:raw"],
  "promotion_evidence_refs": []
}
```

Why invalid: approved memory requires explicit human or policy promotion
evidence.

### Cross-agent memory without federation evidence is invalid

```json
{
  "schema_ref": "uamp/v1#MemoryItem",
  "id": "invalid_cross_agent_001",
  "type": "knowledge",
  "memory_class": "candidate_memory",
  "agent_id": "agent-a",
  "provenance": {
    "schema_ref": "uamp/v1#Provenance",
    "actor": "agent-b",
    "source_refs": ["memory:agent-b:private"],
    "created_at": "2026-06-22T00:00:00Z",
    "trust_tier": "candidate",
    "agent_boundary": {
      "agent_id": "agent-a"
    },
    "federation_evidence_refs": []
  }
}
```

Why invalid: cross-agent memory sharing requires explicit federation evidence
and trust downgrade.

### Unredacted secret-bearing output is invalid

```json
{
  "schema_ref": "uamp/v1#RecoveryPack",
  "id": "invalid_secret_pack_001",
  "summary": "Use token sk-live-example in the next command.",
  "source_refs": ["tool_output:secret-bearing"],
  "redaction": {
    "schema_ref": "uamp/v1#Redaction",
    "redaction_version": "draft",
    "status": "not_required"
  }
}
```

Why invalid: recovery output must preserve redaction evidence and must not emit
unredacted secret-bearing material.

## 10. Conformance dependency

This draft spec is not complete, implemented, or conformant until all of the
following exist and are accepted:

- `KUSABI_V2_UAMP_CONFORMANCE_PLAN.md`;
- fixture corpus;
- validation runner;
- Kusabi reference implementation passing the fixtures;
- at least one second adapter path proven by evidence.

Until then, allowed wording is limited to draft mapping and design intent.
Forbidden wording includes:

- "UAMP conformant";
- "UAMP implemented";
- "UAMP production integration";
- "UAMP standard support";
- "second adapter proven".

## 11. Stop conditions

Stop and create a separate owner-approved work order before any change that
would:

- change runtime emitters;
- rename schema IDs;
- change MCP namespace;
- enable cross-agent reads;
- claim UAMP conformance;
- change package identity;
- change env vars;
- change DB paths;
- change workflows;
- change deployment files;
- create schema files;
- start runtime implementation.
