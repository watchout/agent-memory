# SSOT-7: Runtime Agent Binding

> Status: authoritative identity and runtime-binding SSOT
> Scope: `agent_id`, project binding, host/runtime provenance, launcher/hook env generation, optional AUN/agent-comms adapter identity

---

## 1. Authority

This document owns identity and binding rules. It does not own restart policy;
restart and continuity policy lives in `SSOT-6_LIVING_MEMORY_CONTROL.md`.

Operational identity guidance in `docs/operations/IDENTITY_BOUNDARY.md` should
mirror this file.

---

## 2. Identity Layers

| Layer | Current field | Meaning | Stability | Isolation role |
|-------|---------------|---------|-----------|----------------|
| Tenant / user | not implemented | Human owner or organization | Stable across projects | Future hard security boundary |
| Workspace / project | `project` / `AGENT_MEMORY_PROJECT` | Repo or product context | Stable while working in the same repo/product | Soft filter within an agent namespace |
| Memory owner | `agent_id` / `AGENT_MEMORY_AGENT_ID` | Persistent role/persona memory namespace | Stable across restarts and runtime swaps | Current primary app-layer namespace |
| Runtime source | `source` (`codex`, `claude_code`, `manual`, etc.) | Transcript/runtime origin | Changes by tool/runtime | Provenance, not isolation |
| Execution session | `session_id` | One concrete runtime session | Changes every restart | Observability and lifecycle trace only |
| AUN identity | `aun_agent_id`, queue claim metadata, or adapter metadata | Suite-mode orchestration identity | Stable while AUN owns a worker/claim | External lifecycle mapping |

---

## 3. Memory Boundary

Current memory visibility is:

```text
memory boundary = agent_id + optional project
```

`session_id` must not become the memory namespace. A restarted agent must keep
the same `AGENT_MEMORY_AGENT_ID` to continue work.

Runtime swaps are provenance changes, not memory-boundary changes:

| Scenario | `agent_id` | `project` | runtime/source |
|----------|------------|-----------|----------------|
| Codex session starts | same role id | same repo/product | `codex` |
| Claude Code takes over | same role id | same repo/product | `claude_code` |
| Model version changes | same role id | same repo/product | same host/source |
| Different role takes over | new role id unless explicit handoff | same or different project | runtime source |

---

## 4. Launcher And Hook Binding

Host launchers and hooks must set or preserve:

- `AGENT_MEMORY_AGENT_ID`
- `AGENT_MEMORY_PROJECT`
- session id or adapter-provided session metadata when available
- host/runtime source metadata
- selected restart pack reference when loading a precomputed pack

Launchers and hooks may load recovery context. They must not define restart
policy independently from `SSOT-6`.

---

## 5. AUN Adapter Identity

When AUN supervises the runtime:

- AUN remains the lifecycle owner for queue claim, requeue, finalize, close,
  worker lease, heartbeat, and runtime restart orchestration.
- Wasurezu should store AUN references as provenance or lifecycle metadata.
- Wasurezu must not silently map an AUN claim id to a new `agent_id`.
- Wasurezu must not mutate AUN queue lifecycle.

Recommended metadata keys:

- `aun_agent_id`
- `aun_claim_id`
- `aun_queue_item_id`
- `aun_channel_id`
- `aun_message_id`
- `aun_thread_id`

These keys identify the external orchestration context. They are not the memory
namespace.

---

## 6. Handoff Rule

If a different role needs to inherit work:

1. create a structured handoff summary
2. include source PRs/issues and current task state
3. store the handoff under the receiving `agent_id` or a future shared handoff table
4. do not require the receiving agent to read the sender's full transcript namespace

This keeps collaboration explicit and avoids accidental cross-role memory bleed.
