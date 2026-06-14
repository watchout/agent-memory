# Wasurezu / agent-memory Agent Instructions

This repository is the Kusabi/Wasurezu memory and recovery control plane.
`CLAUDE.md` remains the broader project guide; this file is the Codex/agent
runtime entrypoint.

## Company Dev OS Operating Rule

Canonical Company Dev OS model:
https://github.com/watchout/iyasaka-arc/issues/18

Kusabi rollout issue:
https://github.com/watchout/agent-memory/issues/177

For every non-trivial task:

- Treat the GitHub issue or PR as the durable SSOT. AUN, Discord, local notes,
  queue ids, and TUI state are acceleration or projection surfaces only.
- Execute work as a bounded phase goal. State or recover the goal, scope,
  non-scope, acceptance criteria, target files/modules, allowed actions,
  required checks, stop conditions, evidence to write back to GitHub, and next
  phase handoff.
- Declare or resolve the runner policy before implementation:
  `codex_native_fast_lane`, `claude_code_autonomous_lane`,
  `headless_runtime_adapter_lane`, `governed_manual_lane`, or `stop_lane`.
- Write evidence back to GitHub in the issue or PR. Local success is not enough.
- Stop at protected gates for the correct owner/role. Runtime recovery,
  memory semantics, common DB binding, launch/restart behavior, redaction,
  retention, production launchd, secrets, and Discord gateway changes are
  protected unless the issue explicitly delegates the lane.

## Memory/Recovery Evidence Rule

Memory and recovery work must provide direct Wasurezu evidence, not inferred
success. A successful operation must not be inferred from AUN ACKs, queue ids,
Discord projection, TUI visibility, or green CI alone.

Use the evidence contract in
`docs/operations/COMPANY_DEV_OS_PHASE_CONVEYOR.md` for:

- memory capture evidence
- context recovery evidence
- restart pack evidence
- canonical agent/project/workspace binding evidence
- live runtime evidence when a runtime adapter, launcher, or supervisor is part
  of the claim

Common DB alignment stays on
https://github.com/watchout/agent-memory/issues/147. Wasurezu owns
memory/recovery product state; common identity/runtime registries remain common
infrastructure.
