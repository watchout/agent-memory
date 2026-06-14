# Company Dev OS Phase Conveyor

> Status: Kusabi #177 operational contract
> Purpose: make Wasurezu memory/recovery work runnable through the same
> GitHub-first, runner-agnostic phase-goal conveyor as the rest of Company Dev
> OS.
> Canonical model: https://github.com/watchout/iyasaka-arc/issues/18
> Kusabi rollout: https://github.com/watchout/agent-memory/issues/177
> Common DB alignment: https://github.com/watchout/agent-memory/issues/147

## 1. Boundary

GitHub issue or PR state is the durable SSOT for work intent, decisions,
acceptance, evidence, and handoff. AUN, Discord, queue ids, local notes, and TUI
visibility are acceleration or projection surfaces only.

Wasurezu owns memory/recovery product state:

- memory capture and retrieval behavior
- recovery packs, restart packs, selected pack refs, and recovery confidence
- recovery-quality and lifecycle evidence produced by Wasurezu
- redaction, retention, provenance, and missing-evidence reporting for its
  emitted artifacts

Wasurezu does not own AUN queue lifecycle, Shirube Work Order authority, common
identity/runtime registry ownership, or runtime execution attempts owned by an
external runner. Common identity/runtime registry work stays on #147; Wasurezu
binds to canonical IDs when available and reports drift when they differ.

## 2. Phase Goal Contract

Every non-trivial Wasurezu task, including memory and recovery work, must be
expressible as one bounded phase goal:

```text
Phase Goal:
- Goal:
- Scope:
- Non-scope:
- Acceptance Criteria:
- Target files/modules:
- Allowed actions:
- Required checks:
- Stop conditions:
- Evidence to write back to GitHub:
- Next phase handoff:
```

The phase goal may live in an issue comment, PR description, review comment, or
handoff comment. If the task starts from AUN or another queue, the agent must
recover or link the GitHub issue/PR before treating the work as durable.

Phase goals must be small enough that acceptance and evidence can be checked in
one review pass. If memory/recovery behavior, runtime launch behavior, common
DB binding, or protected policy changes are discovered mid-phase, stop and
split the work or route it to the correct role.

## 3. Runner Policies

Declare one runner policy before implementation. If the policy is not obvious,
resolve it in GitHub before changing protected behavior.

| Policy | Supported Wasurezu use | Required evidence |
|--------|------------------------|-------------------|
| `codex_native_fast_lane` | Codex-safe R0-R2 docs, tests, probes, and narrow implementation work that does not change protected memory/recovery semantics. | GitHub phase goal, local diff, commands/checks, and any direct Wasurezu evidence relevant to the claim. |
| `claude_code_autonomous_lane` | Work where Claude Code is the active runtime and existing SessionStart or Claude runner paths preserve recovery evidence. | Same as fast lane, plus runtime/host evidence when recovery, restart, or SessionStart behavior is claimed. |
| `headless_runtime_adapter_lane` | Adapter or headless execution only when `recovery-pack/v1`, `host-invocation-context/v1`, selected-pack refs, recovery result, or equivalent structured evidence is preserved. | Runtime profile, delivery mode, feature detection/degradation, pack/ref evidence, result evidence, and GitHub write-back. |
| `governed_manual_lane` | Ambiguous work, non-autonomous tasks, manual recovery, policy review, protected-but-approved inspection, or human-gated operations. | Human/gate reference, manual steps, Wasurezu evidence, missing evidence, and next owner. |
| `stop_lane` | Unsafe, undelegated, or protected work without the correct owner/gate. | Stop reason, needed owner/gate, missing authorization/evidence, and proposed next phase. |

AUN is acceleration only. AUN can schedule, speed up, or attach evidence, but a
queue claim, queue id, ACK, Discord projection, or close event is not proof that
Wasurezu memory/recovery work succeeded.

## 4. Protected Gates

Stop for the correct role or gate when the phase touches any of:

- runtime recovery semantics
- memory capture, promotion, retrieval, redaction, or retention semantics
- common DB identity/runtime binding or registry drift policy
- launch/restart behavior for Codex, Claude Code, AUN, or host adapters
- production launchd, secrets, gateway, or Discord behavior
- destructive memory rewrite, broad deletion, retention bypass, or sensitive
  memory reveal

Protected work should route through the GitHub issue/PR and the declared owner
chain. The default route from #177 is:

```text
arc design -> agent-memory/Kusabi implementation bot -> audit -> qa/check -> cto when protected
```

## 5. Evidence Contract

Evidence must directly support the claim being made. For memory/recovery work,
green CI can support implementation correctness, but it does not by itself
prove that memory was captured, context was recovered, a restart pack was
loaded, or a runtime resumed safely.

Every GitHub evidence write-back should include:

- phase goal or issue/PR link
- runner policy
- changed files/modules or artifact refs
- commands/checks run and their result
- direct Wasurezu evidence for the specific memory/recovery claim
- explicit `missing_evidence` or `missing_context` where applicable
- protected gate status
- next phase handoff

### 5.1 Memory Capture Evidence

Required when claiming memory was captured, promoted, updated, superseded,
ingested, or made searchable:

- `agent_id`, `project`, workspace/repo identity, and canonical registry refs
  when available
- tool/CLI/surface used, such as `log_decision`, `save_task_state`,
  `save_knowledge`, `ingest_conversation_events`, or `catch_up`
- durable IDs or refs: decision ids, task ids, knowledge ids, memory event ids,
  raw event ids, source refs, or ingest batch refs
- capture counts and skipped/omitted counts
- redaction summary and private-reasoning exclusion status
- promotion evidence for anything treated as approved memory
- retention policy/ref when retention behavior is part of the claim
- missing evidence for absent source refs, absent registry binding, redaction
  gaps, or unsupported host/source coverage

Do not infer memory capture from a Discord message, AUN task status, model
summary, or a passing unit test unless there is direct Wasurezu storage or
artifact evidence for the captured item.

### 5.2 Context Recovery Evidence

Required when claiming context was recovered after boot, restart, compaction,
crash, handoff, or manual recovery:

- recovery surface used, such as `recover_context`, `restart_pack`,
  `restart_pack_fetch`, boot, SessionStart, `wasurezu-codex-start`, or a host
  adapter
- `session_id`, `agent_id`, project, workspace/repo identity, and runtime/host
  identity when available
- recovery log id, lifecycle event id, selected-pack ref, or pack id when
  applicable
- recovered counts by category: tasks, decisions, knowledge, conversation/raw
  events, packs, or source refs
- confidence and `missing_context`
- redaction summary, omission counts, and sensitivity boundary
- whether user-visible work was resumed, requeued, left pending, degraded, or
  failed
- direct check or command output summary that supports the recovery claim

Manual MCP recovery is valid, but it must be labeled manual/degraded when there
is no launcher or host hook evidence.

### 5.3 Restart Pack Evidence

Required when claiming a restart pack was created, selected, loaded, consumed,
or delivered:

- pack id or `selected_restart_pack:<id>` ref
- artifact format and schema ref: text, `recovery-pack/v1`, or
  `host-invocation-context/v1`
- source event ids, source refs, item provenance, token budget, and freshness
- confidence and `missing_context`
- `missing_evidence` for absent CL2 fields or absent source refs
- redaction summary, memory safety class, and untrusted-context policy
- target runtime and delivery mode when adapter delivery is claimed
- validation result against the JSON schema when structured artifacts are used
- consume/load status when the phase claims handoff or startup recovery

Human-readable text packs remain compatible for manual users. Automation claims
should prefer structured artifacts and explicitly mark fallback delivery.

### 5.4 Canonical Binding Evidence

Required when claiming recovery targets, memory visibility, or common DB
alignment are correct:

- `AGENT_MEMORY_AGENT_ID` / `agent_id`
- `AGENT_MEMORY_PROJECT` / project
- workspace root and repository identity
- runtime identity and host adapter identity when relevant
- common registry ref or explicit note that the common registry was unavailable
- recovery target ref, alias approval, or drift finding
- verification that `session_id` is observability/provenance only, not the
  memory namespace

Drift between Company Dev OS targets, common registry, Wasurezu recovery
targets, and launchers must be detectable and reported. It must not be hidden
by local aliases unless the alias is explicitly documented as a compatibility
approval.

### 5.5 Live Runtime Evidence

Required only when the phase claims a runtime was launched, restarted, resumed,
or recovered through an adapter:

- runner policy and runtime lane
- target runtime, host, support level, adapter name/version, and delivery mode
- feature detection result and degradation label when applicable
- AUN status, supervisor availability, and restart preauthorization when
  `auto_restart` or managed lifecycle behavior is involved
- command/check summary, dry-run output, or structured runtime result
- `host-invocation-context/v1` or equivalent pack/ref evidence
- post-start `record_recovery_result` or lifecycle event evidence when claimed
- whether AUN or another supervisor owned queue claim/requeue/final close

TUI visibility is not startup recovery evidence by itself. A live prompt that
contains recovery text is a compatibility fallback unless the adapter or hook
also returns structured evidence.

## 6. Success Inference Bans

Do not claim Wasurezu memory/recovery success from any of these alone:

- AUN ACK
- AUN queue id, claim, lease, requeue, or close event
- Discord projection or reply
- TUI visibility or pasted prompt text
- green CI
- a model-written summary of what should have happened
- a GitHub comment without the direct Wasurezu evidence refs needed for the
  claim

These signals can be supporting context only when the direct evidence contract
above is satisfied or the missing evidence is explicitly called out.

## 7. GitHub Write-Back Format

Use this compact format for issue/PR evidence comments:

```text
Phase evidence:
- Phase goal:
- Runner policy:
- Scope completed:
- Changed files/artifacts:
- Required checks:
- Direct Wasurezu evidence:
- Missing evidence/context:
- Protected gate status:
- Next phase handoff:
```

For memory/recovery phases, `Direct Wasurezu evidence` must name the concrete
IDs, refs, logs, pack refs, schema validation, or lifecycle records that support
the claim. When the phase is documentation-only, say that no live
memory/recovery operation was executed and list the docs changed instead.

## 8. Related Docs

- `AGENTS.md`
- `CLAUDE.md`
- `docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md`
- `docs/design/core/SSOT-7_RUNTIME_AGENT_BINDING.md`
- `docs/design/core/SSOT-3_API_CONTRACT.md`
- `docs/design/core/SSOT-4_DATA_MODEL.md`
- `docs/operations/HOST_ADAPTERS.md`
- `docs/operations/CODEX_RECOVERY_CONTROL.md`
- `docs/design/governance/WASUREZU_MEMORY_SAFETY_GOVERNANCE.md`
- `docs/design/governance/WASUREZU_AUN_GATE_EVIDENCE_REFS.md`
