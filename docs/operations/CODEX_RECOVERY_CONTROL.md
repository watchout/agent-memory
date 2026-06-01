# Codex Recovery Control

> Status: host-specific runbook
> Authority: `docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md` for continuity policy, `docs/design/core/SSOT-7_RUNTIME_AGENT_BINDING.md` for identity binding

---

## 1. Purpose

Codex recovery must be launcher-controlled where possible. `wasurezu-codex-start`
or an equivalent verified launcher/adapter is the hard path for startup
recovery because it can load a bounded restart pack before the model acts.

`AGENTS.md`, MCP tool descriptions, and first-action instructions are soft
fallback controls only.

---

## 2. Primary Path

The primary Codex startup recovery path is:

1. Wasurezu runner or host adapter observes context and prepares restart state.
2. Wasurezu creates or selects a bounded, source-bearing restart pack.
3. Wasurezu serializes a `host-invocation-context/v1` for `target_runtime=codex`.
4. The Codex launcher loads the pack into the fresh runtime startup context.
5. The adapter records structured evidence such as pack id, session id,
   confidence, missing context, and launch outcome.

The launcher may pass context into Codex, but it does not own restart policy or
recovery-pack ranking. Those remain Wasurezu control-plane responsibilities.

Preferred delivery is structured (`stdin-json`) when a verified non-interactive
Codex surface is available. Prompt-fragment delivery is compatibility behavior.
Live TUI delivery must be recorded as `delivery_mode=tui-fallback`.

---

## 3. Fallback Paths

These are compatibility fallback only:

- asking the user to paste a restart prompt into a live TUI
- relying on `AGENTS.md` first-action recovery
- relying on MCP tool descriptions to make the model call `restart_pack`
- treating an already-running TUI injection as startup recovery

Fallback evidence must be labeled as manual recovery.

---

## 4. AUN Suite Mode

When Codex is supervised by AUN, AUN owns runtime restart, requeue, and queue
lifecycle. Wasurezu may provide restart packs, recovery confidence, missing
context, and raw-memory evidence to AUN, but must not independently restart the
runtime or mutate AUN queue state.
