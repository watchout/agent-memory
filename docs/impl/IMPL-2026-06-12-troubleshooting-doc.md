# IMPL: TROUBLESHOOTING.md (AM-034 §4.6)

> 6-section implementation instruction (governance-flow format).
> Docs-only PR; spec issued anyway per CEO 2026-06-12 spec-first directive.

## 0. Dispatch context (frozen)

- **target_project**: agent-memory (wasurezu)
- **dispatch_origin**: CEO directive 2026-06-12 (in-session, autonomous
  continuation authorized). Role-collapse disclosure as in the companion
  IMPL docs of this date.
- **dispatch_reason**: AM-034 §4.6 requires a troubleshooting guide
  covering the top failure modes before public-alpha claims; §7 item 7
  lists it as an immediate next action. No troubleshooting doc exists
  (only a mention inside WORLD_CLASS_RELEASE_CRITERIA.md).

## 1. Interface contract (frozen)

- New file: `docs/operations/TROUBLESHOOTING.md`. No code changes.
- Every failure mode entry follows the fixed shape:
  **Symptom → Cause → Fix → Verify** (verify = a copy-pasteable command
  or observable output).

## 2. Required behavior (frozen)

- Cover at minimum these failure modes, each grounded in an existing
  repo artifact (code path, test, doc, or merged PR — no invented
  behavior):
  1. `DATABASE_URL` not set (hook skip path; explicit postgres mode
     fails closed instead of falling back to SQLite).
  2. PostToolUse hooks not inheriting `.mcp.json` env vars (SSOT-3).
  3. Stale MCP session schema after upgrade (rebuild + MCP reload;
     AM-031 recovery retest knowledge).
  4. Boot failure fallback (`restart_pack failed, falling back to
     recover_context format` stderr line; non-destructive).
  5. `wasurezu-restart preflight` legacy relative-path config detection
     (PR #160).
  6. Plain MCP config is manual recovery, not startup recovery
     (AM-034 known limitation).
  7. Codex positional prompt argv visibility limitation (AM-034).
  8. Empty/stale recovery output due to `AGENT_MEMORY_AGENT_ID` /
     project mismatch (agent isolation).
  9. Voyage 429 noise in test output (non-fatal).
- Claims must match AM-034 honesty rules: no "fully automatic Codex
  recovery" wording, no DLP guarantees.

## 3. Forbidden behavior (frozen)

- No code, CI, or template changes (docs-only; file overlap with the
  six pending PRs is forbidden).
- No new claims about recovery quality scores or release readiness
  (AM-034 owns those).

## 4. Test fixtures (frozen, merge gate)

- Docs-only: gate is review verification that each entry's Verify
  command exists in the repo (script/test/flag named must be real).
- CI remains green (no code touched).

## 5. Open decisions (implementer free)

- Section ordering, wording, additional failure modes beyond the nine.

## Pre-impl self-check (abbreviated for docs-only scope)

- [x] §0 complete; [x] entry shape contract stated; [x] required modes
  enumerated with grounding sources; [x] forbidden scope explicit;
  [x] merge gate defined (review-verifiable commands).
