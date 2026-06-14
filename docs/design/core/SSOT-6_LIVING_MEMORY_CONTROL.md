# SSOT-6: Living Memory Control

> Status: authoritative Wasurezu control-plane / continuity SSOT
> Scope: architecture, ownership, lifecycle policy, recovery confidence, memory-pack and restart-pack semantics
> Consolidates: GitHub issues #101, #103, #107, #108

---

## 1. Authority

This document is the top-level Wasurezu continuity and memory-control-plane
spec. Other docs must reference it instead of restating continuity policy as an
independent source of truth.

| Area | Authority |
|------|-----------|
| Active source-set provenance and compatibility boundaries | `docs/design/SOURCE_ALIGNMENT.md` |
| Control-plane architecture, lifecycle bands, ownership boundaries, recovery confidence | `SSOT-6_LIVING_MEMORY_CONTROL.md` |
| Runtime / agent identity binding | `SSOT-7_RUNTIME_AGENT_BINDING.md` |
| Data model and schema contracts | `SSOT-4_DATA_MODEL.md` |
| MCP / CLI / internal API shapes | `SSOT-3_API_CONTRACT.md` |
| Memory safety taxonomy, promotion boundary, redaction/retention evidence | `docs/design/governance/WASUREZU_MEMORY_SAFETY_GOVERNANCE.md` |
| Governed action profile inventory and schema | `docs/design/governance/WASUREZU_GOVERNED_ACTION_PROFILES.md`, `docs/design/governance/wasurezu-governed-action-profiles.v1.json`, `docs/design/governance/governed-action-surface-profile.schema.json` |
| AUN gate evidence reference contract | `docs/design/governance/WASUREZU_AUN_GATE_EVIDENCE_REFS.md`, `docs/design/schemas/aun-gate-evidence-refs-v1.schema.json` |
| Company Dev OS phase-goal, runner-policy, and GitHub evidence workflow | `docs/operations/COMPANY_DEV_OS_PHASE_CONVEYOR.md` |
| Product naming and compatibility transition | `docs/brand/kusabi-naming-decision.md` |
| Host-specific runbooks, rollout evidence, local audit packets | `docs/operations/*` |
| Legacy v0.2 startup/recovery design | `docs/SSOT.md` and `docs/strategy/agent-memory-ssot-v0.2.0.md` |

`SSOT-3` and `SSOT-4` mirror this policy through API and schema terms. They do
not redefine lifecycle ownership or restart policy independently.

---

## 2. Product Boundary

Wasurezu is a deterministic memory and session-continuity control plane for AI
coding agents. It is not just a prompt-time memory helper.

The system must be able to answer, with durable evidence:

- what session, task, claim, or goal was active before context loss or restart
- which raw events and checkpoints support the recovered state
- which memory pack or restart pack was created, selected, loaded, or consumed
- how confident the recovery was
- what context was missing, stale, contradictory, or unsafe to restore
- who owned runtime restart or queue lifecycle
- whether user-visible work resumed, requeued, stayed pending, degraded, or failed

---

## 3. Canonical State

Canonical continuity state is durable Wasurezu evidence, not a live TUI
transcript and not an LLM prompt-local memory.

The control plane must persist, or provide explicit equivalents for:

- `raw_events`: user messages, assistant messages, tool calls/results,
  host/runtime events, file/context references, imported transcript spans, and
  optional AUN/agent-comms message events
- `session_checkpoints`: session id, project, agent id, host, active task/goal,
  current artifacts, pending actions, and context metrics
- `recovery_packs` / `restart_packs`: pack id, session id, project, reason,
  source event ids, confidence, missing context, freshness, and consumed state
- `recovery_pack_items`: item type, content, provenance, priority, freshness,
  confidence, and redaction state
- `session_lifecycle_events`: observe, prepare, pack_created,
  restart_recommended, restart_required, restart_executed, recovery_loaded,
  recovery_degraded, and recovery_failed

`conversation_events` can remain a compatibility ingest table or view, but new
continuity policy should target `raw_events` plus checkpoints and lifecycle
events.

---

## 4. Control-Plane Responsibilities

Primary automation must be deterministic scripts, runners, hooks, launchers, or
supervisors that operate over durable evidence.

Wasurezu owns:

- raw event and session memory
- transcript and host-adapter ingestion
- memory atoms, graph/episode links, and consolidation
- pre-generation memory packs
- restart/recovery packs
- context-health interpretation when host metrics are supplied
- recovery confidence and missing-context reports
- standalone local session refresh only when AUN is absent, a supported
  Wasurezu supervisor or host hook is installed, and restart lifecycle was
  pre-authorized

Prompt-driven context-limit decisions are not sufficient for normal operation.
LLM prompts may consume a bounded pack, but the policy decision to prepare,
recommend, require, load, or record recovery belongs to the control plane.

---

## 5. AUN Suite Boundary

In AUN suite mode, AUN owns:

- queue claim, requeue, finalize, and close lifecycle
- runtime restart orchestration
- worker lease and heartbeat
- deciding whether user-visible queue work is resumed or requeued after runtime replacement

Wasurezu supplies:

- restart packs and memory packs
- source event ids and provenance
- recovery confidence
- missing-context signals
- raw memory / structured memory evidence
- context-health recommendations

Wasurezu must not independently restart an AUN-supervised runtime or mutate AUN
queue lifecycle.

---

## 6. Standalone Boundary

In Wasurezu standalone mode, local session refresh or restart may run only when:

- AUN absence is explicitly confirmed
- a supported Wasurezu supervisor or host hook is installed
- restart lifecycle was pre-authorized at install or config time

Pure MCP mode may prepare packs, warn, and recommend. It must not claim it can
force host restart.

---

## 7. Runtime Adapter Boundary

Runtime adapters for Codex, Claude, TUI, or other hosts may:

- invoke the runtime or model
- provide bounded memory/recovery pack input
- return structured result and evidence

Runtime adapters must not own:

- lifecycle state mutation
- final close
- queue repair
- restart policy
- recovery-pack ranking policy
- destructive memory rewrite

---

## 8. Structured Host Invocation Artifacts

Automation consumes structured artifacts, not ad hoc prompt text.

Wasurezu owns:

- `recovery-pack/v1`: bounded memory/recovery content with confidence,
  missing context, provenance, trust level, actionability, and redaction status
- `host-invocation-context/v1`: the adapter handoff wrapper that names the
  target runtime, delivery mode, trusted instruction, data-only policy, schema
  reference, and embedded recovery pack

Stable schemas:

- `docs/design/schemas/recovery-pack-v1.schema.json`
- `docs/design/schemas/host-invocation-context-v1.schema.json`

Host adapters may render these artifacts into host-specific invocation forms,
but they must not change the recovery-pack ranking policy or treat untrusted
context as executable instruction.

Canonical delivery is structured where the host supports it. `tui-fallback` is
valid only as degraded compatibility evidence.

---

## 9. Fallback Rule

TUI input, SessionStart self-kick, `AGENTS.md` first-action recovery, and MCP
tool-description recovery are compatibility/fallback paths only.

- Claude `SessionStart` is a valid host hook adapter, not the universal architecture.
- Codex `AGENTS.md` first-action instructions are soft fallback controls.
- MCP tool descriptions are soft fallback controls.
- Live TUI text injection is compatibility fallback only.
- No normal recovery design may depend on "type this prompt into the live TUI".
- No SessionStart/TUI self-kick may be treated as the primary restart mechanism.

Launcher-controlled or runner-controlled recovery is the hard path where the
host supports it.

---

## 10. Typed Lifecycle Actions

The API or internal runner surface should expose deterministic equivalents of:

| Action | Required output |
|--------|-----------------|
| `observe_context(session_id, metrics?)` | observed band, metrics source, checkpoint id |
| `prepare_restart(session_id, reason, owner?)` | lifecycle event id, checkpoint id, pack need |
| `create_restart_pack(session_id, budget, project?)` | pack id, source ids, confidence, missing context |
| `get_restart_pack(pack_id | session_id)` | bounded pack, item provenance, consumed state |
| `load_recovery_pack(pack_id)` | loaded pack id, adapter handoff evidence |
| `record_recovery_result(session_id, pack_id, confidence, missing_context, outcome)` | lifecycle event id and outcome |
| `check_context_health(metrics?, semantic_signals?)` | typed band and signal provenance |
| `recommend_restart(session_id, band, pack_id?)` | recommendation event without host/AUN mutation |

Lifecycle bands:

- `ok`
- `prepare`
- `warn`
- `recommend`
- `require`
- `pack_only`
- `on_demand`
- `off`

Exact implementation names may change, but the state machine and output shape
must be deterministic and testable.

---

## 11. Evidence Requirements

Every restart or recovery attempt must record:

- reason
- owner (`wasurezu`, `aun`, `host`, or `user`)
- session id
- project
- affected task, claim, or goal
- pack id
- source event ids / provenance
- confidence score
- missing context
- whether user-visible work was resumed, requeued, or left pending
- whether recovery was full, partial, degraded, or failed

This evidence can later form an Agent Continuity Record for enterprise audit.

When continuity, memory, or recovery work is executed as a Company Dev OS
phase, the same evidence must be written back to the durable GitHub issue or
PR. AUN ACKs, queue ids, Discord projection, TUI visibility, and green CI may
support an audit trail, but they are not sufficient to prove Wasurezu
memory/recovery success without direct Wasurezu evidence refs or explicit
`missing_evidence` / `missing_context`.

---

## 12. Related Work Mapping

- #101 maps to lifecycle bands, context-health policy, restart pack requirements, and AUN ownership.
- #103 maps to raw event ledger, memory atoms/edges, retrieval runs, consolidation, and source-bearing memory packs.
- #107 maps to Agent Continuity Record, provenance, governance, and enterprise positioning.
- #108 maps to this SSOT hierarchy and fallback-vs-primary boundary.
- #110 maps to `recovery-pack/v1`, `host-invocation-context/v1`, and structured host adapter delivery.
- #117 maps to `WASUREZU_MEMORY_SAFETY_GOVERNANCE.md`, memory safety taxonomy, candidate-vs-approved promotion boundaries, and redaction/retention evidence requirements.
- #147 maps to common DB identity/runtime alignment. Wasurezu binds to common
  registry IDs when available and reports drift; it does not own the common
  registry.
- #177 maps to the Company Dev OS phase-goal conveyor, runner-policy selection,
  protected gate stops, and GitHub evidence write-back for memory/recovery
  work.
