# Host Adapter Compatibility

> Status: AM-036 operational design
> Purpose: define what wasurezu can honestly claim for each LLM host.

## Core Boundary

wasurezu is an MCP memory server plus small host adapters. It does not own the
LLM host process lifecycle.

The public contract is:

- MCP tools expose memory operations.
- `restart_pack` provides Layer 1 recovery context.
- Host adapters inject `restart_pack` when a new LLM session starts.
- The user or host exits the old LLM session and starts a new one through the
  adapter.
- wasurezu does not kill, replace, or multiplex existing LLM sessions.

This keeps recovery behavior portable across hosts. A host with a native
startup hook can be transparent. A host without one uses an explicit bridge.

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
than external process management:

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
not an MCP server feature.

## Evaluation Rule

A recovery run only counts as startup recovery when the first model context
already includes `restart_pack`.

- Claude Code: counts when the SessionStart hook emits restart recovery.
- Codex: counts when started through `wasurezu-codex-start --launch` or an
  equivalent verified startup prompt adapter.
- MCP-only clients: do not count unless the host has a verified adapter or hook.

Manual MCP recovery is still useful evidence, but it must be labeled as manual
and cannot be used for public-alpha startup recovery claims.
