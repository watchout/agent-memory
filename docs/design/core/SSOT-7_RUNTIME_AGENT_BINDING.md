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
| Common registry identity | future common agent/workspace/runtime refs | Cross-product canonical identity refs | Stable while registry ownership remains common | Evidence/binding refs, not Wasurezu-owned namespace policy |

---

## 3. Memory Boundary

Current memory visibility is:

```text
memory boundary = agent_id + optional project
```

`session_id` must not become the memory namespace. A restarted agent must keep
the same `AGENT_MEMORY_AGENT_ID` to continue work.

When a common DB registry is available, Wasurezu may attach canonical
agent/workspace/runtime refs to memory and recovery evidence. Those refs do not
make Wasurezu the owner of common identity/runtime registry policy, and their
absence must be represented as missing evidence rather than silently inferred.

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

## 6. Common Registry Binding (#147 planned)

Common DB alignment is defined in
`docs/operations/COMMON_DB_ALIGNMENT.md`.

Future common registry consumption should preserve the current memory boundary:

```text
memory boundary = agent_id + optional project
canonical refs = evidence/binding metadata when available
```

Required rules:

- Common registry rows are cross-product identity/runtime evidence, not
  Wasurezu-owned memory semantics.
- Wasurezu may resolve `agent_id` / `project` to canonical
  agent/workspace/binding refs when the common registry is available.
- Wasurezu must preserve local fallback behavior when the common registry is
  unavailable, unless an explicit protected implementation PR changes that
  behavior.
- Missing common registry tables, rows, permissions, or runtime-session refs
  must be emitted as `missing_evidence` in protected flows.
- Launchers must keep `AGENT_MEMORY_AGENT_ID` and `AGENT_MEMORY_PROJECT`
  stable while adding canonical refs as evidence, not replacing the namespace
  with transient session or queue ids.

---

## 7. Handoff Rule

If a different role needs to inherit work:

1. create a structured handoff summary
2. include source PRs/issues and current task state
3. store the handoff under the receiving `agent_id` or a future shared handoff table
4. do not require the receiving agent to read the sender's full transcript namespace

This keeps collaboration explicit and avoids accidental cross-role memory bleed.

## Seat continuity: native first-input receipt (2026-09-13 amendment)

Authority: [bounded native continuation](https://github.com/watchout/agent-comms-mcp/issues/575#issuecomment-5650379038), published body SHA-256 `647ec69fd4e7702ed100b9d7cdeabdc6f47e1c17b7b932ef66a9590f8b3f5f63`; existing SC3 and stable namespace semantics remain unchanged. This is source implementation scope; no live configuration, migration, rollout, queue or credential effect is admitted.

The ordinary cold-start path is existing Codex/Claude `SessionStart`, before AUN queue readiness. Verified binding selects stable `agent_id` plus project. The native hook parses the host's session/cwd/provider identity, retrieves the actual durable work, and emits the existing `hookSpecificOutput.additionalContext` envelope. A recovery tool response, generated artifact, callback supplied as evidence, or the old pre-output runtime event is not consumption proof.

The native writer independently observes the ancestor chain from its own PID, the actual provider PID/start time and resolved executable file identity, and stdout's OS pipe/socket identity. The chain must reach exactly one provider consistent with the hook's provider and verified binding. A basename, environment variable, fabricated callback or caller-supplied PID alone is not verification. Record process-start and executable/pipe digests; reject missing/ambiguous ancestry, terminal/file stdout, conflicting provider, changed process identity and reused PID. Native tests may inject process observations to exercise failures, but positive delivery requires an actual OS pipe and actual write completion.

Sequence: validated non-degraded recovery and exact native session → validated output envelope and content/work digests → observed target host pipe → successful stdout write callback and same process identity readback → `native_context_delivery` receipt → durable existing `session_start` event. No receipt is created on EPIPE, output error, timeout, incomplete objective/next action, unverified identity or failed write. Emit the durable event after output completion, with a digest of the exact transmitted bytes; storage failure leaves no retrievable delivery acceptance. The legacy `first_context_delivery_confirmed:false` continues to avoid claiming model comprehension or subsequent action; the new receipt attests only accepted native input bytes.

The optional `native_context_delivery` object is `native-context-delivery/v1` and contains: status `accepted`, stable seat/project; target runtime; native host session; provider PID, canonical process-start timestamp and executable identity digest; workspace digest; stdout pipe identity digest; exact transmitted input digest; durable work digest; pack reference; delivery timestamp. These fields contain no raw context, paths, commands, credentials or model hidden state. Runtime UUID need not exist during the hook.

Use the existing `kusabi_runtime_events` JSON payload and existing `session_start` event type. No new event type, table, registry, migration or monitoring loop is introduced. Existing strict JSON schemas admit only the explicitly added optional receipt. Pre-output events lack this object and cannot pass the new lookup.

Read-only MCP `native_context_delivery` looks up stored proof; its arguments are `project`, `target_runtime`, `provider_pid`, `provider_started_at`, `workspace_sha256`, and optional `host_session_id`. The actual MCP server `AGENT_MEMORY_AGENT_ID` is the namespace authority, not an agent ID supplied in arguments. Derive the existing target key from that seat/project/runtime/workspace, retrieve a bounded existing event set, and inspect the stored producer and receipt identity. Independently reread the live provider PID/start/executable identity. Do not accept a request's receipt as evidence. Expired/dead/reused PID, wrong project/provider/workspace/session, malformed stored proof, unsupported store, truncation or absent target state returns typed unavailable with no context.

When `host_session_id` is supplied, only an equal native session may be used. When it is absent because the provider did not propagate it to MCP, acceptance requires exactly one observed native session for that independently verified provider PID/start in the bounded stored target events and a post-write receipt for that session. Include all subsequent attempt events, including failed, nonreceipt and missing-session observations; the latest corresponding attempt must be successful. Never reuse an older success after a newer failed or unverified input, select the freshest session, or omit failed attempts from ambiguity detection. Zero or multiple session identities, incomplete bounded history or no accepted receipt is unavailable. Return the exact stored native session identity to bind into the caller's new runtime.

AUN's owned memory adapter verifies this stored receipt against the freshly observed same provider PID/start/workspace/session and exact current runtime UUID (or the sealed provider→MCP runtime mapping). It records a current-runtime consumption receipt only after equality; previous or foreign runtime/session evidence cannot transfer. This path must reach memory-ready before queue execution and must not depend on a queue invocation to obtain its first receipt. Existing claims/fences and effect history remain untouched.


Each native hook invocation creates a random UUID `attempt_id` and a source `attempt_started_at` from that hook process's startup clock (`performance.timeOrigin`), before recovery or output; its hook PID/start are observed, not supplied by MCP. Persist an existing `session_start` event with optional `native_context_attempt` phase `started` before retrieving work. Persist a distinct terminal event phase `finished` after failure or successful output. Both carry attempt ID/start, hook PID/start, provider PID/start and native session (nullable for malformed input). Immutable event ID includes target + attempt ID + phase, so compact/resume/clear failures cannot collide with a prior success. A receipt additionally includes the exact attempt ID/start. Failure to persist the start forbids a delivery receipt.

Lookup orders attempts by source hook startup, never completion or insertion time; tied/invalid source start or truncated history is unavailable. It selects the newest started attempt for the exact live provider, requiring exactly one matching terminal event and an accepted receipt for that same attempt. Pending, failed, cancelled, missing-session or superseding attempts invalidate older acceptance even if an older hook completes later. Hook termination/cancel before terminal store leaves a pending attempt and no acceptance. Output accepted by the exact live pipe is the boundary: this does not assert that a host retained input after a subsequent clear/resume or cancellation; the next native attempt immediately supersedes that evidence. Tests cover same-session success→failed compact, delayed old completion after a newer start, pending/cancelled latest attempt, missing-session latest attempt, and tied source starts.

Process collection uses the kernel executable identity, never the `ps comm` label, cwd lookup, or PATH resolution as process authority. Linux resolves `/proc/<pid>/exe` and verifies its device/inode against the resolved file; Darwin selects exactly one executable Mach-O text mapping reported by `lsof` for that PID, verifying the mapped device/inode. Missing, replaced, ambiguous or unsupported executable observations fail closed. Preserve the canonical second-resolution `ps lstart` ISO timestamp used by AUN; independently reread PID/parent/start and kernel executable evidence around collection. Linux kernel start ticks also participate in the executable observation digest so a reused PID cannot inherit an earlier identity.

Pipe collection remains exact and reciprocal. Darwin uses the two kernel endpoint addresses. Linux requests `lsof -E` and verifies the exact hook stdout descriptor, endpoint inode and reciprocal provider PID/descriptor references; UNIX socket peers must name each other's inode, while FIFO endpoints must share the same kernel inode with complementary read/write access. Both process endpoints and the hook descriptor are reread around collection, and the unchanged before/after-write gate still applies. An unrelated socket/pipe, duplicate or ambiguous peer, missing endpoint support, nonpipe, stale process or EPIPE remains unavailable. Command names in endpoint diagnostics are not identity evidence.

The existing Codex SessionStart test caller must await the real native-context-delivery test as a checked absolute Node child, propagating failure, signal and timeout. Its existing Linux Node 18/20/22 CI selection therefore executes actual process/pipe/store/registered-MCP positives and negatives; parser examples alone do not establish platform compatibility. These tests use an isolated synthetic host and store, never a real provider API or ambient memory database.

Required fixtures: both native host output protocols over real OS pipes; successful write-before-store ordering; EPIPE/no reader; unverified/ambiguous parent and process reuse; actual durable same-store work across Codex→Claude→Codex and relocated cwd; no foreign seat/project output; bounded store lookup rejects fake/old/multiple-session evidence; AUN current runtime accepts the same native receipt and rejects another runtime/provenance. Local fixture provider-input acceptance never claims live deployment or hidden model understanding.

Relocated invocation may select exactly one original manifest target for the same seat/project/provider only when the actual native hook argv explicitly binds that identity/workspace/source reference and provider ancestry is observed. The event separately preserves original target/workspace and marks `exact_rollout_target_match:false`, `configuration_trust:original-reference-only`; current invocation has its own argv/source/workspace digests. Configuration hash remains null and trust status `native-invocation-only`: accepted host input is observed, fleet configuration/trust audit is not inferred. No manifest/profile edit or cross-seat/provider fallback occurs; ambiguous targets and unverified invocation fail closed.

The SQLite boundary follows the SC3-CA-01 API amendment: current event reads are independent read-only snapshots; ordinary operations refresh their disk base before reading or mutating, while genuinely overlapping stale writers fail before atomic file replacement, and closing an old reader cannot erase new attempts or work. This is required for latest-attempt identity to remain true across separately running hooks and the connected MCP process.
