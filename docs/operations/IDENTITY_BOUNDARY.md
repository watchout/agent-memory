# Identity Boundary Standard

> Project: wasurezu / agent-memory
> Status: AM-031 operational standard
> Purpose: Define how memory is scoped when sessions restart or LLM runtimes are swapped.

---

## 1. Problem

Session continuity only works if the memory boundary is stable across restarts.

If memory is scoped too narrowly, every restart or model swap starts from zero. If memory is scoped too broadly, agents can read unrelated or sensitive context. This document defines the intended boundary.

---

## 2. Identity Layers

| Layer | Current Field | Meaning | Stability | Isolation Role |
|-------|---------------|---------|-----------|----------------|
| Tenant / user | Not implemented | Human owner or organization | Stable across projects | Future hard security boundary |
| Workspace / project | `project` / `AGENT_MEMORY_PROJECT` | Repo or product context | Stable while working in the same repo/product | Soft filter within an agent namespace |
| Memory owner | `agent_id` / `AGENT_MEMORY_AGENT_ID` | Persistent role/persona memory namespace | Stable across restarts and model/runtime swaps | Current primary app-layer namespace |
| Runtime source | `source` (`codex`, `claude_code`, `manual`) | Where the transcript came from | Changes by tool/runtime | Provenance, not isolation |
| Execution session | `session_id` in metadata or recovery log | One concrete Codex/Claude run | Changes every restart | Observability only, not isolation |

---

## 3. Current Rule

For MVP/internal operation:

```text
memory boundary = agent_id + optional project
```

This means:

- A new session must keep the same `AGENT_MEMORY_AGENT_ID` to continue memory.
- Codex and Claude Code may share memory if they are acting as the same role on the same project.
- Switching from one LLM/runtime to another does not require a new `agent_id`.
- `session_id` must not be used as the memory namespace.

Example:

```text
AGENT_MEMORY_AGENT_ID=agent-mem-dev
AGENT_MEMORY_PROJECT=agent-memory
source=codex or claude_code
session_id=<changes every restart>
```

The above is one continuous memory stream for the `agent-mem-dev` role working on `agent-memory`, even if the runtime changes from Codex to Claude Code.

---

## 4. What `agent_id` Means

`agent_id` is the durable memory owner for a role/persona, not a process id, session id, model name, or tool name.

Use the same `agent_id` when:

- the same role continues the same work after restart
- Codex replaces Claude Code for the same role
- a model upgrade occurs but the assistant is still doing the same job
- a session refresh happens because of context limits

Use a different `agent_id` when:

- the role/persona is different
- memory should not be shared by default
- the agent represents a different team function
- evaluation requires a clean namespace

Do not use:

- a random session id as `agent_id`
- a model name such as `gpt-5` or `claude-sonnet` as `agent_id`
- a tool runtime such as `codex` or `claude_code` as `agent_id`

---

## 5. What `session_id` Means

`session_id` is for traceability and quality measurement only.

It is used to answer:

- which boot produced this recovery log
- which restart cycle was evaluated
- which transcript file/session a raw event came from

It must not be used to decide whether memory is visible. If memory visibility depended on `session_id`, a restarted agent would be unable to read its own previous context.

---

## 6. Runtime Swap Rule

LLM/runtime swapping is supported by keeping the memory owner stable and recording runtime as provenance.

| Scenario | `agent_id` | `project` | `source` |
|----------|------------|-----------|----------|
| Codex session starts | same role id | same repo/product | `codex` |
| Claude Code takes over | same role id | same repo/product | `claude_code` |
| New model version | same role id | same repo/product | same runtime source |
| Different role takes over | new role id unless explicit handoff | same or different project | runtime source |

If two roles need to collaborate, they should not silently share the same `agent_id`. They should exchange context through explicit handoff records, issue comments, or future cross-agent sharing features.

---

## 7. Security Boundary

Current wasurezu local/internal mode uses application-layer namespace filtering:

```sql
WHERE agent_id = ?
```

This is sufficient for local single-user and trusted internal operation. It is not a hard multi-tenant security boundary.

For public cloud or paid multi-user operation, add:

- `tenant_id` / `workspace_id`
- DB-level row-level security or equivalent enforcement
- per-tenant DB credentials or policy-enforced access
- explicit cross-agent sharing grants
- audit logs for cross-boundary reads

Until that exists, do not market local/internal `agent_id` filtering as tenant-grade isolation.

---

## 8. Retrieval Policy

Default retrieval must use:

```text
agent_id = current memory owner
project = current project when set
```

`project` may be omitted only when the user explicitly wants all projects under the same `agent_id`.

Search tools may search across sources (`codex`, `claude_code`, `manual`) within the same memory owner. Source is provenance, not a read boundary.

---

## 9. Handoff Policy

When a different role needs to inherit work:

1. create a structured handoff summary
2. include source PRs/issues and current task state
3. store it under the receiving `agent_id` or a future shared handoff table
4. do not require the receiving agent to read the sender's full private transcript namespace

This avoids forcing all agents into one shared `agent_id` just to support handoff.

---

## 10. Design Implications

Future schema evolution should preserve this separation:

- `agent_id`: current memory-owner namespace
- `project`: project/repo context filter
- `session_id`: trace/evaluation only
- `source`: transcript/runtime provenance only
- `tenant_id`: future hard security boundary
- `handoff_id` or sharing grants: future explicit cross-agent sharing

The critical decision is:

```text
Do not bind memory continuity to session_id.
Do not bind memory continuity to a specific LLM runtime.
Bind memory continuity to a stable memory owner role plus project.
```
