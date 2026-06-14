# Host Adapter Compatibility

> Status: AM-036 operational design
> Purpose: define what wasurezu can honestly claim for each LLM host.
> Authority: `docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md` for continuity policy, `docs/design/core/SSOT-7_RUNTIME_AGENT_BINDING.md` for identity binding.

## Core Boundary

wasurezu is an MCP memory server plus small host adapters. Lifecycle ownership
depends on install mode.

The primary automation path is the Wasurezu control plane: durable events,
session checkpoints, restart packs, recovery confidence, and lifecycle events
owned by Wasurezu runners or supervisors. A live TUI transcript is not the
canonical state, and a prompt inside the model must not be the component that
decides context-limit policy.

The public contract is:

- MCP tools expose memory operations.
- `restart_pack` provides Layer 1 recovery context.
- Host adapters load or attach a bounded `restart_pack` when a new LLM session
  starts and return structured recovery evidence.
- With AUN or another supervisor installed, that orchestrator owns runtime
  restart, requeue, finalization, reply, and close behavior. wasurezu supplies
  restart packs, recovery confidence, missing-context notes, and continuity
  signals.
- Without AUN, wasurezu may execute local session refresh only when a supported
  supervisor or host hook is available and restart lifecycle was explicitly
  pre-authorized at install or config time. AUN absence must be explicitly
  confirmed; unknown AUN status fails closed to `recommend`.
- In pure MCP-only mode, wasurezu can prepare packs and recommend restart, but
  it cannot force host restart.

This keeps recovery behavior portable across hosts without overstating what MCP
alone can do. A host with a native startup hook can be transparent. A host
without one uses an explicit bridge or remains manual MCP recovery.

## Control-Plane Runner Boundary

Wasurezu continuity operations are deterministic runner actions, equivalent to:

- `observe_context(session_id)`
- `prepare_restart(session_id, reason)`
- `create_restart_pack(session_id, budget, project)`
- `load_recovery_pack(pack_id)`
- `record_recovery_result(session_id, pack_id, confidence, missing_context)`
- `recommend_restart(session_id, band)`

Runtime adapters are deliberately narrow. They may invoke the runtime, pass a
bounded recovery pack into that runtime, and return structured evidence. They
must not own lifecycle state mutation, final close, queue repair, restart
policy, recovery-pack ranking policy, or destructive memory rewrite.

Adapter automation should consume `host-invocation-context/v1`, whose
`context_data` is a `recovery-pack/v1`. The adapter may render that artifact
into the host's supported input surface, but external/contextual content must
remain data only and must not become executable instruction.

The MCP `restart_pack` tool keeps the human-readable text output as its
default for manual users. Automation should request `format=recovery-pack-v1`
or `format=host-invocation-context-v1` and then validate the returned JSON
before host delivery.

Wasurezu owns memory/recovery artifacts, confidence, missing context, and
provenance. AUN, Shirube, or another installed runner owns lifecycle policy,
CLI execution, queue behavior, and final close/requeue decisions.

Company Dev OS phase-goal and runner-policy workflow is defined in
`docs/operations/COMPANY_DEV_OS_PHASE_CONVEYOR.md`. Host adapter work must
declare one of those runner policies before implementation and must write
direct memory/recovery evidence back to the GitHub issue or PR. AUN ACKs,
queue ids, Discord projection, TUI visibility, and green CI are not sufficient
startup/recovery evidence without Wasurezu pack, recovery, binding, or runtime
evidence refs.

Host invocation profiles:

| Target runtime | Structured delivery profile | Boundary |
|----------------|-----------------------------|----------|
| `codex` | `stdin-json` or verified prompt-plus-stdin startup surface | Wasurezu emits schema-valid context. The Codex launcher/runner executes the host command. |
| `claude` | `system-prompt-fragment`, `append-system-prompt-fragment`, or `session-start-hook` where verified | Wasurezu emits schema-valid context. The Claude hook/runner loads it and returns structured evidence. |
| `generic-mcp-host` | MCP `structuredContent` with an `outputSchema` where supported | Wasurezu emits schema-valid context. The host controls invocation and lifecycle. |

### AUN CP-40D Runtime Invocation Alignment

When AUN consumes Wasurezu recovery artifacts, the AUN host runtime invocation
adapter contract remains the lower runtime layer. Wasurezu's
`host-invocation-context/v1` is not an AUN `RuntimeRunnerInvocation/v1`; it is
the bounded context pack input that AUN runner code can reference before
launching Codex, Claude, or a custom runtime.

Boundary mapping:

| Wasurezu field | AUN CP-40D use | Owner |
|----------------|----------------|-------|
| `target_runtime=codex` / `claude` | Select or validate `RuntimeInvocationProfile/v1.runtime` for Codex or Claude. | AUN runner/profile code |
| `target_runtime=generic-mcp-host` | Map to a custom or host-specific runtime profile if one is installed. | AUN runner/profile code |
| `delivery_mode=stdin-json` | Compatible with CP-40D `prompt_delivery=stdin-json`. | AUN host adapter |
| `system-prompt-fragment`, `append-system-prompt-fragment`, `session-start-hook` | Adapter rendering choices for hosts that support prompt or hook delivery. If AUN uses CP-40D non-interactive CLI execution, it may map these to `prompt-arg`, `stdin-text`, or `session-resume` only when feature-detected and policy-allowed. | AUN host adapter |
| `delivery_mode=tui-fallback` | Degraded compatibility evidence only; it must not count as scheduler activation, recovery success, merge authorization, final delivery proof, or lifecycle completion. | AUN host adapter and deterministic completion code |
| `trusted_instruction` | May become CP-40D `trusted_instruction` only as control-plane-authored text. It must not contain shell commands or interpolated untrusted content. | Wasurezu emits, AUN validates before launch |
| `context_data` (`recovery-pack/v1`) | Becomes `context_pack_refs` or an equivalent profile-managed stdin/file payload with provenance. It must not be interpolated into argv, environment names, file paths, branch names, command flags, or prompt arguments as executable text. | AUN runner/adapter code |
| `untrusted_context_policy` | Reinforces CP-40D separation of trusted instructions from untrusted queue, GitHub, docs, tool, and chat context. | Both; AUN enforces at runtime boundary |

The AUN contract owns `RuntimeInvocationProfile/v1`,
`RuntimeRunnerInvocation/v1`, `RuntimeRunnerResult/v1`, feature detection,
argv construction, process timeout, stream parsing, schema-valid result
evidence, and degraded fallback evidence. Wasurezu supplies only the structured
recovery artifact, provenance, confidence, missing context, and selected-pack
references.

The artifacts must not embed raw shell commands. Host-specific launch commands
belong in the runner or adapter implementation, not in the recovery pack.

TUI text injection is allowed only as a compatibility fallback for runtimes
with no proper adapter or hook. It must not be the primary automation path. A
SessionStart hook may load a precomputed pack, but SessionStart/TUI self-kick
must not be treated as the primary restart mechanism or policy engine.

## Install Modes

| Mode | Lifecycle Owner | Wasurezu Claim |
|------|-----------------|----------------|
| AUN or external supervisor | AUN/supervisor | Provides restart pack, recovery confidence, missing context, provenance, and continuity signals. Does not mutate AUN queue state, claim/requeue lifecycle, delivery, finalization, reply, or close. |
| Standalone supervisor or host hook | wasurezu runner/supervisor, if pre-authorized | May run local `auto_restart`: pre-exit prepare, pack selection, local host refresh/restart, post-start pack load, and lifecycle record with confidence/provenance. |
| Pure MCP-only | User or host | Manual recovery only. Wasurezu can prepare packs and emit restart recommendations, but cannot force restart. |

## Company Dev OS Runner Policy Mapping

| Policy | Valid host/adapter shape | Host evidence requirement |
|--------|--------------------------|---------------------------|
| `codex_native_fast_lane` | Codex-safe R0-R2 work that does not claim live restart/recovery or protected semantic changes. | Local checks plus any direct Wasurezu evidence needed for the claim. |
| `claude_code_autonomous_lane` | Claude Code is the active runtime and existing hook/runner paths preserve recovery evidence. | SessionStart/runner evidence when startup or recovery behavior is claimed. |
| `headless_runtime_adapter_lane` | A headless adapter preserves structured pack/ref/result evidence. | `host-invocation-context/v1`, delivery mode, feature detection, runtime result, and recovery result evidence. |
| `governed_manual_lane` | Manual recovery, ambiguous host capability, or human/gate controlled operation. | Manual steps, gate reference, direct Wasurezu evidence, and missing evidence labels. |
| `stop_lane` | Unsafe or undelegated protected host/runtime work. | Stop reason and required owner/gate. |

## Continuity Guard Modes

| Mode | Valid When | Behavior |
|------|------------|----------|
| `auto_restart` | AUN absence is explicitly confirmed, a supported wasurezu supervisor/host hook exists, and restart lifecycle was pre-authorized at install/config time. | Prepare a bounded restart pack, select the pack, refresh/restart the local host session, run SessionStart/boot recovery, and record confidence/provenance. Unknown AUN status downgrades to `recommend`. |
| `recommend` | Default for AUN/supervisor or MCP installs. | Emit `restart_recommended` with pack reference, confidence, missing context, and provenance. Does not execute runtime restart. |
| `pack_only` | Any install mode. | Create/update/fetch restart packs without emitting restart recommendations or executing restart. |
| `off` | Any install mode. | Disable continuity guard behavior. |

## Prepare Interface

`restart_prepare` is the deterministic pre-restart interface for hosts and AUN.
It prepares a bounded restart pack and returns:

- `pack_update_needed`, `restart_recommended`, or `restart_required`
- `restart_pack` and `pack_ref` such as `selected_restart_pack:<id>`
- recovery confidence
- missing-context notes
- provenance

It does not stop, restart, requeue, finalize, reply, close, or mutate AUN queue
lifecycle. Host-provided context metrics are used only when supplied; otherwise
the context signal is explicitly marked as estimated and based on semantic
continuity.

When pack injection is enabled, the `pack_ref` points to a persisted selected
restart pack. Hosts can fetch it with `restart_pack_fetch` or
`wasurezu-restart fetch --pack-ref <ref> --consume`, or pass it to a compatible
boot path with `AGENT_MEMORY_SELECTED_PACK_REF`. Fetch/consume is still a
wasurezu memory handoff only; it does not mutate AUN queue lifecycle.

By default the selected pack content is the backward-compatible text restart
pack. Automation can request `pack_format=recovery-pack-v1` or
`pack_format=host-invocation-context-v1` on `restart_prepare` so the persisted
selected pack content is schema-shaped JSON for adapter delivery.

## Raw Capture Coverage Diagnostics

Raw transcript capture is recovery evidence, not restart authority. A capture
scan that finds unclassified files, stale cursor evidence, or pending backlog
must not be counted as clean review/backlog continuity. The diagnostic status
is:

- `clean`: known transcript files were within scan limits, no unknown files
  were observed, and any supplied cursor evidence is fresh.
- `degraded`: recovery may proceed with explicit missing-context markers such
  as `raw_capture_unknown_files`, `raw_capture_backlog_pending`, or
  `raw_capture_cursor_stale`.
- `failed`: the expected transcript root cannot be scanned, so consumers must
  treat raw capture as unavailable.

`ingest_conversation_events` reports this coverage status alongside ingest
counts. `restart_prepare` can consume the same coverage report and add the
raw-capture gaps to recovery confidence and missing-context output. This does
not broaden raw capture policy: unknown files are surfaced as redacted
provenance refs only, not imported as transcript content. AUN and other
supervisors remain responsible for runtime lifecycle and queue state.

## Support Levels

| Level | Name | Requirement | Recovery Claim |
|-------|------|-------------|----------------|
| 0 | MCP tools only | The host can call wasurezu MCP tools after startup. | Manual MCP recovery only. Not startup recovery. |
| 1 | Startup prompt adapter | A wrapper or command injects `restart_pack` into the first prompt of a new session. | Startup recovery, explicit adapter path. |
| 2 | Native lifecycle integration | The host has a native startup hook or extension point that runs recovery on session start. | Startup recovery, transparent host integration. |
| 3 | Managed enterprise integration | Org install, policy, audit, metrics, and rollout controls are available. | Enterprise managed recovery. Future tier. |

## Current Host Matrix

| Host | Level | Startup Path | Notes |
|------|-------|--------------|-------|
| Claude Code | 2 | `wasurezu-claude-start` prepares a selected `host-invocation-context/v1` pack; SessionStart runs `boot.js` with `AGENT_MEMORY_BOOT_MODE=restart_pack` to load it. | The Claude runner owns deterministic prepare/launch gating in standalone mode. SessionStart is a load hook, not the restart policy owner. |
| Codex | 1 | Exit the old session, then start with `wasurezu-codex-start --launch --cd <workspace>`. | Plain Codex MCP config is manual recovery only. The bridge is a runtime adapter, not lifecycle policy owner. |
| Cursor | 0 | Configure wasurezu as an MCP server and call `restart_pack` manually. | Startup adapter not verified yet. |
| Gemini CLI | 0 | Configure wasurezu as an MCP server and call `restart_pack` manually. | Startup adapter not verified yet. |
| Other MCP clients | 0 | Configure wasurezu as an MCP server and call `restart_pack` manually. | Do not claim startup recovery until an adapter or native hook is verified. |

## Restart UX

For hosts without a native lifecycle hook, the intended UX is re-entry rather
than unmanaged process replacement:

1. In the current LLM session, save any final task state if needed.
2. Exit the current LLM session using the host's normal command, such as
   `/exit`.
3. Start a fresh session through the host adapter.
4. The first model context includes `restart_pack`.

For Codex:

```bash
/exit
wasurezu-codex-start --launch --cd /path/to/workspace
```

Codex launcher hardening helpers:

```bash
wasurezu-codex-start --doctor
wasurezu-codex-start --launch --dry-run --cd /path/to/workspace
scripts/host-adapters/codex-bridge-launch.sh --dry-run --cd /path/to/workspace
scripts/host-adapters/codex-tmux-exit.sh --dry-run --session codex
scripts/host-adapters/codex-tmux-start.sh --dry-run --session codex --cd /path/to/workspace
scripts/host-adapters/codex-tmux-restart.sh --dry-run --session codex --cd /path/to/workspace
```

The `scripts/host-adapters/` Codex scripts are packaged operator conveniences.
They are not MCP core lifecycle ownership and do not by themselves prove
startup recovery. Tests and audits should use `--dry-run` to verify command
construction without launching Codex, touching tmux, or mutating production
state.

Supervisor restart command preflight:

- A restart marker such as `restart-required.json` is an input signal, not
  evidence that restart was executed.
- A standalone supervisor must preflight its restart command before claiming
  recovery readiness.
- The restart command must be an absolute executable path or a trusted
  package/bin command such as `wasurezu-claude-start`.
- Relative commands such as `scripts/restart-from-context-marker.sh` are
  rejected because marker run directories must not influence command
  resolution.
- Missing, non-executable, or not-preauthorized restart commands fail closed
  with structured diagnostics.

The current verified Codex CLI startup contract is
`codex [OPTIONS] [PROMPT]`. `wasurezu-codex-start --doctor` checks local
Codex help/version surfaces without launching Codex. Until a stdin or
prompt-file startup surface is verified, the bounded restart pack prompt may be
visible in the Codex process argv. That is a documented compatibility
limitation, not public-alpha evidence.

For Claude Code standalone resession:

```bash
/exit
wasurezu-claude-start --launch \
  --mode auto_restart \
  --aun-absent \
  --supervisor-available \
  --restart-preauthorized \
  --cd /path/to/workspace \
  --mcp-config .mcp.json
```

`wasurezu-claude-start` always calls `restart_prepare` with
`pack_format=host-invocation-context-v1`, `target_runtime=claude`, and
`delivery_mode=session-start-hook`. It accepts host-provided context metrics
(`--context-used-ratio` or `--context-tokens` plus
`--context-window-tokens`) and labels missing metrics as estimated. Its
`prepare`, `warn`, `recommend`, and `require` bands come from the
control-plane context signal, not from a prompt-local LLM decision.

`--launch` is fail-closed. It only starts a fresh Claude process when
`restart_prepare` reports `can_auto_restart=true`, a selected pack exists, and
the action is `restart_recommended` or `restart_required`. This requires
explicit AUN absence, supervisor/host-hook availability, and restart
pre-authorization. If AUN is installed or AUN status is unknown, the runner
prints evidence and does not launch Claude.

The runner does not kill or replace existing Claude sessions. Operators or the
installed supervisor must close the old session through the host's normal
mechanism before starting the new one. The next Claude session receives
`AGENT_MEMORY_SELECTED_PACK_REF` and `AGENT_MEMORY_BOOT_MODE=restart_pack` so
the SessionStart hook can consume the selected pack.

This avoids ambiguous singleton ownership. If multiple sessions are running for
the same `agent_id` and project, that is an operator or host lifecycle issue,
not an MCP server feature. Operators should prefer one active session per
`agent_id` and project because concurrent writers can interleave task,
decision, knowledge, and conversation events.

In standalone installs with a supported and pre-authorized supervisor or host
hook, the same re-entry lifecycle may be driven by wasurezu as `auto_restart`.
That claim must not be made for pure MCP-only installs.

TUI compatibility fallback must be labeled as such in evidence. A run that
requires manually typing a prompt into an already-running TUI is manual
recovery, not primary startup automation.

## Evaluation Rule

A recovery run only counts as startup recovery when the first model context
already includes `restart_pack`.

- Claude Code: counts when the SessionStart hook emits restart recovery.
- Codex: counts when started through `wasurezu-codex-start --launch` or an
  equivalent verified startup prompt adapter. Printed prompts from
  `wasurezu-codex-start --print` are inspection evidence only, not startup
  recovery runs.
- MCP-only clients: do not count unless the host has a verified adapter or hook.

Manual MCP recovery is still useful evidence, but it must be labeled as manual
and cannot be used for public-alpha startup recovery claims.
