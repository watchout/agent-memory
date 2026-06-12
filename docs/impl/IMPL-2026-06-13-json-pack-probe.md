# IMPL: recovery-pack/host-invocation JSON output probe (Gate 0, probe-only)

> 6-section implementation instruction (governance-flow format).
> Pins the already-correct item-level redaction of the structured pack
> formats (recovery-pack/v1, host-invocation-context/v1).

## 0. Dispatch context (frozen)

- **target_project**: agent-memory (wasurezu)
- **dispatch_origin**: CEO directive 2026-06-12/13 (autonomous
  continuation, spec-first). Role-collapse disclosure as in companion
  IMPL docs; post-impl audit on chain recovery.
- **dispatch_reason**: the week's two real leaks (search_memory #169,
  recover_context/boot #170) were both "boundary exists elsewhere but
  this surface is unpinned/absent". The JSON pack formats redact per
  item (src/restart-pack.ts recoveryItem → redactText + sensitivity/
  redaction_state) but no Gate 0 probe pins it; a refactor of
  recoveryItem could silently drop the seam.

## 1. Interface contract (frozen)

- No production code changes. `generateRecoveryPackArtifact` /
  `generateHostInvocationContext` signatures and behavior untouched.
- New probe: `tests/gate0/json-pack-output-redaction.ts`, wired into the
  CI Gate 0 step (stacked on #172's branch for the shared ci.yml hunk).

## 2. Required behavior (frozen)

- Seed a SqliteStore with secrets in decision text, knowledge title+
  content, and task progress (sk- / AKIA / gho_ / email fixtures).
- `generateRecoveryPackArtifact`: JSON.stringify of the artifact
  contains no raw fixture; at least one item carries
  sensitivity=secret_redacted with redaction_state=redacted-before-emit.
- `generateHostInvocationContext` (target_runtime=claude): stringified
  artifact contains no raw fixture; context_data embeds the same pack.
- Vacuous-pass guard: a clean-store artifact still renders items/
  missing_context (probe fails loud if generation breaks).

## 3. Forbidden behavior (frozen)

- No changes to src/restart-pack.ts, src/redact.ts, or any pending-PR
  file other than the shared ci.yml Gate 0 block.

## 4. Test fixtures (frozen, merge gate)

- The probe file; CI Gate 0 hard gate; existing suites stay green.

## 5. Open decisions (implementer free)

- Fixture values, assertion granularity beyond the minimum.
