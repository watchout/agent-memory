# Host Adapter Compatibility

> Status: AM-036 operational design
> Purpose: define what wasurezu can honestly claim for each LLM host.

## Core Boundary

wasurezu is an MCP memory server plus small host adapters. Lifecycle ownership
depends on install mode.

The public contract is:

- MCP tools expose memory operations.
- `restart_pack` provides Layer 1 recovery context.
- Host adapters inject `restart_pack` when a new LLM session starts.
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

## Install Modes

| Mode | Lifecycle Owner | Wasurezu Claim |
|------|-----------------|----------------|
| AUN or external supervisor | AUN/supervisor | Provides restart pack, recovery confidence, missing context, provenance, and continuity signals. Does not mutate AUN queue state, claim/requeue lifecycle, delivery, finalization, reply, or close. |
| Standalone supervisor or host hook | wasurezu adapter, if pre-authorized | May run local `auto_restart`: pre-exit prepare, pack selection, local host refresh/restart, SessionStart/boot recovery, and lifecycle record with confidence/provenance. |
| Pure MCP-only | User or host | Manual recovery only. Wasurezu can prepare packs and emit restart recommendations, but cannot force restart. |

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
- `restart_pack` and `pack_ref`
- recovery confidence
- missing-context notes
- provenance

It does not stop, restart, requeue, finalize, reply, close, or mutate AUN queue
lifecycle. Host-provided context metrics are used only when supplied; otherwise
the context signal is explicitly marked as estimated and based on semantic
continuity.

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
| Claude Code | 2 | SessionStart hook runs `boot.js` with `AGENT_MEMORY_BOOT_MODE=restart_pack`. | Best current UX because the host provides a deterministic startup hook. |
| Codex | 1 | Exit the old session, then start with `wasurezu-codex-start --launch --cd <workspace>`. | Plain Codex MCP config is manual recovery only. The bridge is required for startup recovery evidence. |
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

This avoids ambiguous singleton ownership. If multiple sessions are running for
the same `agent_id` and project, that is an operator or host lifecycle issue,
not an MCP server feature. Operators should prefer one active session per
`agent_id` and project because concurrent writers can interleave task,
decision, knowledge, and conversation events.

In standalone installs with a supported and pre-authorized supervisor or host
hook, the same re-entry lifecycle may be driven by wasurezu as `auto_restart`.
That claim must not be made for pure MCP-only installs.

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
