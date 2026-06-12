# IMPL: Codex bridge output probe (Gate 0 parity, probe-only)

> 6-section implementation instruction (governance-flow format).
> Completes the fourth AM-034 §4.2 probe surface. Probe-only: the
> boundary already redacts (src/codex-start.ts buildCodexStartupPrompt
> returns redactText(prompt).text); this pins it in CI so a refactor
> cannot silently drop it.

## 0. Dispatch context (frozen)

- **target_project**: agent-memory (wasurezu)
- **dispatch_origin**: CEO directive 2026-06-12 (autonomous continuation,
  spec-first). Role-collapse disclosure as in companion IMPL docs of this
  date; post-impl audit on chain recovery.
- **dispatch_reason**: AM-034 §4.2 requires Codex bridge output to pass
  secret-output probes. restart_pack (pre-existing), search_memory (#169),
  and recover_context/boot (#170) are probed; the bridge is the last
  unprobed surface. Regression risk class: silent seam removal during a
  refactor (cf. PR#64/#73 silent no-op incident).

## 1. Interface contract (frozen)

- No production code changes. `buildCodexStartupPrompt` signature and
  behavior untouched.
- New probe: `tests/gate0/codex-bridge-output-redaction.ts`, wired into
  the CI Gate 0 step.

## 2. Required behavior (frozen)

- Probe feeds secrets through both attacker-relevant inputs:
  `restartPack` (sk- key, AKIA key, credential NAME=value, email) and
  `extraInstruction` (gho_ token).
- Asserts: no raw fixture in output; `[REDACTED]` placeholder present;
  prompt scaffolding intact (recovery-control lines, embedded
  restart_pack fence, agent namespace line); fixpoint
  `redactText(output).text === output`.
- Asserts the no-secret case renders the same scaffolding (probe must
  not pass vacuously on a broken builder).

## 3. Forbidden behavior (frozen)

- No changes to src/codex-start.ts, src/redact.ts, or any pending-PR
  file other than the shared ci.yml Gate 0 block (stacked on #170 for
  that reason).

## 4. Test fixtures (frozen, merge gate)

- The probe file itself; CI Gate 0 hard gate. Existing suites stay green.

## 5. Open decisions (implementer free)

- Fixture values; assertion granularity beyond the minimum above.

## Pre-impl self-check (abbreviated, probe-only)

- [x] §0 complete; [x] no-code-change contract stated; [x] both input
  channels covered + vacuous-pass guard; [x] forbidden scope explicit;
  [x] CI-bound merge gate.
