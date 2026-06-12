# IMPL: recover_context / boot output-boundary redaction (Gate 0 parity)

> 6-section implementation instruction (governance-flow format).
> Follow-up to IMPL-2026-06-12-search-output-redaction.md; completes the
> AM-034 §4.2 "Claude boot output" probe surface.

## 0. Dispatch context (frozen)

- **target_project**: agent-memory (wasurezu)
- **dispatch_origin**: CEO directive 2026-06-12 (in-session): continue
  spec-first implementation autonomously while AUN/review chain is down.
  **Role-collapse disclosure**: spec and impl authored by the same session;
  pre-impl self-check is not independent. Flagged for post-impl audit on
  chain recovery.
- **dispatch_reason**: AM-034 §4.2 requires Claude boot output to pass
  secret-output probes. `buildRecoveryOutput` (src/constants.ts) — shared
  by the `recover_context` MCP tool (src/index.ts) and the boot.ts
  restart-pack-failure fallback path — applies no redaction. Same leak
  class as the search_memory finding fixed in PR #169: structured memory
  is not redacted at ingest, so unredacted task progress / decision text /
  knowledge titles / message content flow into boot output verbatim.

## 1. Interface contract (frozen)

- `buildRecoveryOutput(params): string` keeps its exact signature and call
  sites (src/index.ts recover_context, src/boot.ts fallback). No new
  exports required.
- Post-condition: the returned string is a `redactText` fixpoint
  (`redactText(output).text === output`). Fixpoint form per the §1
  amendment in IMPL-2026-06-12-search-output-redaction.md.
- `src/constants.ts` gains an import of `redactText` from `./redact.js`
  only. No store, server, or schema changes. No new dependencies.

## 2. Required behavior (frozen)

- Output structure (SESSION BOOT header, section markers, truncation
  priority task > decisions > messages > discord > knowledge, token
  budgeting) is unchanged except where redaction replaces secret
  substrings and home paths normalize to `~` (matching restart_pack
  behavior).
- Redaction is applied once over the fully assembled output (after
  truncation), so cross-section adjacency cannot reassemble a secret and
  token budgeting math is untouched.
- Fixing the seam in `buildRecoveryOutput` must cover BOTH consumers
  (recover_context tool and boot.ts fallback) with no per-consumer code.
- restart_pack and search output paths are unchanged by this PR.

## 3. Forbidden behavior (frozen)

- Do NOT redact at ingest for structured memory (output boundary only;
  same ARC-level boundary rationale as the #169 spec).
- Do NOT modify `src/redact.ts` (pattern ownership: PR #167).
- Do NOT modify `src/restart-pack.ts`, `src/format-search.ts`, store
  implementations, or the recovery-quality logging block in index.ts.
- Do NOT change section ordering/keys or truncation priority (SSOT-3
  §3-G #5 contract; downstream recovery-quality scoring depends on it).

## 4. Test fixtures (frozen, merge gate)

`tests/gate0/recovery-output-redaction.ts`, added to the CI "Run Gate 0
tests" step (branch stacks on #169, so the CI line lands after its line):

1. Pure-function probe: call `buildRecoveryOutput` with fixture data
   carrying secrets in every rendered field class —
   task.task / task.progress / task.next_steps (sk- key, AKIA key,
   credential NAME=value), decision.decision (gho_ token),
   knowledge.title (xoxb Slack token), message.content (email +
   Bearer token), discordHistory line (sk- key):
   - output contains none of the raw fixture values;
   - output contains `[REDACTED]` placeholders;
   - benign text and all section headers render intact;
   - fixpoint: `redactText(output).text === output`.
2. Truncation safety: with a small max_tokens config, output still
   contains no raw fixture value (redaction happens after truncation —
   a truncated-then-redacted string must not bisect into a leak).
3. Store-backed probe (SqliteStore, temp dir): seed task with secret
   progress, fetch via `getTaskStates`, build output with real rows —
   no raw secret in output. Covers the recover_context data shape.
4. All existing suites stay green: src/test.ts, test-sqlite,
   boot-recovery (27), gate0 suite (now 5 files), spec-enforcement.

## 5. Open decisions (implementer free)

- Fixture values and count beyond the minimum classes above.
- Test file internal structure.

Out of scope (future spec): Codex bridge probe additions (codex-start.ts
already applies redactText; probe-only work), recovery-pack-v1 /
host-invocation-context-v1 JSON formats (restart-pack module owns those).

## Pre-impl self-check (7-item, non-independent — see §0 disclosure)

- [x] §0 has target_project / dispatch_origin / dispatch_reason
- [x] Interface contract: signature unchanged, fixpoint post-condition stated
- [x] Required behavior observable/testable (structure intact + fixpoint)
- [x] Forbidden behavior carries incident/contract references (SSOT-3 §3-G #5, #167 ownership)
- [x] Variation axis: none introduced (single shared seam covers both consumers)
- [x] Adapter symmetry: n/a (no new external world)
- [x] Test fixtures executable, CI-bound as merge gate, including truncation edge
