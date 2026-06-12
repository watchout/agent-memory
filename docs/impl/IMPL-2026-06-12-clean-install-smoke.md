# IMPL: clean-install smoke evidence + README quick-start determinism

> 6-section implementation instruction (governance-flow format).
> Docs-only PR (evidence record + README caveat).

## 0. Dispatch context (frozen)

- **target_project**: agent-memory (wasurezu)
- **dispatch_origin**: CEO directive 2026-06-12 (autonomous continuation,
  spec-first). Role-collapse disclosure as in companion IMPL docs.
- **dispatch_reason**: AM-034 §5 Phase C requires clean-install smoke
  evidence and verified README copy-paste commands; §7 item 6 lists the
  README quick start as an immediate next action.

## 1. Interface contract (frozen)

- New evidence record: `docs/operations/CLEAN_INSTALL_SMOKE_2026-06-12.md`
  (method, per-run results table, findings, claim boundaries).
- README quick-start change is limited to: adding
  `"AGENT_MEMORY_DB_TYPE": "sqlite"` to the step-2 mcp.json env example
  plus one explanatory sentence. No other README sections change.

## 2. Required behavior (frozen)

- Evidence must distinguish inherited-env and isolated-env runs and
  state honestly that inherited `DATABASE_URL` switches the backend.
- Claim boundaries section must exclude Windows, recovery-quality, and
  Phase-C-pass claims (AM-034 honesty rules).
- The FEAT-029 installer reproduction is recorded and cross-referenced
  to PR #173, not re-fixed here.

## 3. Forbidden behavior (frozen)

- No code changes. No file overlap with pending PRs (#163/#164/#166-#173).
- No release-readiness claims beyond the executed probes.

## 4. Test fixtures (frozen, merge gate)

- Docs-only: reviewer verifies the commands in the method section are
  reproducible and the README diff matches the §1 boundary.

## 5. Open decisions (implementer free)

- Wording, table layout, placement of the README sentence.
