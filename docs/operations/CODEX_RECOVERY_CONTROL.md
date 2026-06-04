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

MCP callers can request the Codex-shaped artifact with
`restart_pack format=host-invocation-context-v1 target_runtime=codex`. The
returned context is data-only recovery material; the launcher or runner owns
the actual Codex command invocation.

## 3. CLI Contract And Operator Scripts

The currently tested Codex launch contract is:

```text
codex [OPTIONS] [PROMPT]
```

`wasurezu-codex-start --doctor` checks the local Codex help/version surfaces
without launching Codex. It is compatibility evidence only; it is not a startup
recovery run.

`wasurezu-codex-start --launch --dry-run` prints a launch preview that omits
the restart pack text and does not write telemetry or launch Codex. Use it for
script and packaging checks.

The npm package includes optional Codex operator helpers under
`scripts/host-adapters/`:

- `codex-bridge-launch.sh`
- `codex-tmux-exit.sh`
- `codex-tmux-start.sh`
- `codex-tmux-restart.sh`

These scripts are repo-owned host adapter conveniences. They do not own restart
policy, kill or replace sessions by force, mutate AUN queue lifecycle, or prove
public-alpha recovery. Their tests must use `--dry-run` and shell syntax checks
only.

Until Codex exposes and this project verifies a stdin or prompt-file startup
surface, the bounded restart pack prompt may be visible in the Codex process
argv during launch. This limitation must stay visible in release/readiness
evidence and must not be hidden behind a public-alpha claim.

---

## 4. Fallback Paths

These are compatibility fallback only:

- asking the user to paste a restart prompt into a live TUI
- relying on `AGENTS.md` first-action recovery
- relying on MCP tool descriptions to make the model call `restart_pack`
- treating an already-running TUI injection as startup recovery

Fallback evidence must be labeled as manual recovery.

---

## 5. AUN Suite Mode

When Codex is supervised by AUN, AUN owns runtime restart, requeue, and queue
lifecycle. Wasurezu may provide restart packs, recovery confidence, missing
context, and raw-memory evidence to AUN, but must not independently restart the
runtime or mutate AUN queue state.
