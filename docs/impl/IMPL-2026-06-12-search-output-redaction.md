# IMPL: search_memory output-boundary redaction (Gate 0 parity)

> 6-section implementation instruction (governance-flow format).
> Implements one AM-034 §4.2 hard-gate item: "search_memory passes
> secret-output probes."

## 0. Dispatch context (frozen)

- **target_project**: agent-memory (wasurezu)
- **dispatch_origin**: CEO directive 2026-06-12 (in-session). AUN/review
  chain offline; CEO authorized parallel independent implementation with
  mandatory spec-before-impl. **Role-collapse disclosure**: this spec and its
  implementation are authored by the same session; the pre-impl audit
  self-check below is not independent. Flagged for full post-impl audit
  when the chain recovers.
- **dispatch_reason**: AM-034 §4.2 requires restart_pack, search_memory,
  Claude boot, and Codex bridge outputs to pass secret-output probes.
  Observed evidence (2026-06-12 live session): `search_memory` returned a
  knowledge item containing raw `sk-test-AKIAIOSFODNN7EXAMPLE` and
  `dev@example.com` — structured memory is not redacted at ingest, and the
  search output boundary applies only `safeText` (surrogate sanitization,
  not redaction). restart_pack output of the same content was redacted,
  confirming the gap is search-specific.

## 1. Interface contract (frozen)

```ts
// src/format-search.ts (new module, pure, no store/server imports
// beyond types and redact)
export function formatSearchMemoryOutput(
  query: string,
  result: SearchMemoryResult
): string;
```

- Pre-condition: `result` is the unmodified return of `store.searchMemory`.
- Post-condition: the returned string is a `redactText` fixpoint:
  `redactText(output).text === output` (re-applying redaction changes
  nothing). *Amended during impl*: the original `redaction_count === 0`
  form is unachievable without modifying `src/redact.ts` (forbidden by §3)
  because placeholder text such as `DATABASE_URL=[REDACTED]` re-matches the
  credential pattern with an identical replacement. The fixpoint form
  captures the actual safety property: no residual secret material.
- `src/index.ts` `search_memory` handler returns
  `safeText(formatSearchMemoryOutput(query, result))` for both the
  no-results and results paths. Error path keeps current shape.
- No Store interface change. No schema change. No new dependencies.

## 2. Required behavior (frozen)

- Output structure (section headers, bullet/emoji forms, truncation at
  100/220 chars, date slicing) is byte-identical to the current handler
  output except where redaction replaces secret substrings.
- Redaction uses `redactText` from `src/redact.ts` as found on `main`
  (am031-redaction-v1). This PR must NOT depend on PR #167; when #167
  merges, the boundary picks up the expanded pattern set automatically.
- Redaction is applied to the fully assembled output string (single pass),
  not per-field, so cross-field adjacency cannot reassemble a secret.
- restart_pack, recover_context, and Codex bridge outputs are unchanged by
  this PR (recover_context boundary is a follow-up — see §5 note).

## 3. Forbidden behavior (frozen)

- Do NOT redact at ingest for structured memory (decisions/knowledge/task
  tools). Changing stored data is an ARC-level boundary decision
  (SSOT-6 continuity policy); this PR is output-boundary only.
- Do NOT modify `src/redact.ts` (pattern ownership: PR #167; file overlap
  would break the independent-PR constraint).
- Do NOT modify `src/restart-pack.ts`, `src/codex-start.ts`, or store
  implementations.
- Do NOT change result counts, ordering, or section structure (downstream
  agents parse these sections; incident class: silent contract drift,
  cf. agent-comms PR#117 / wasurezu #77).

## 4. Test fixtures (frozen, merge gate)

`tests/gate0/search-output-redaction.ts`, wired into the CI "Run Gate 0
tests" step:

1. Seed (SqliteStore, temp dir): decision containing an `sk-` key, knowledge
   containing a `gho_` token and an email address, task progress containing
   an `AKIA` key and a `DATABASE_URL=postgres://user:pass@host` pair.
2. `store.searchMemory` for a term matching all seeds →
   `formatSearchMemoryOutput`:
   - output contains none of the raw fixture values;
   - output contains `[REDACTED]` and `[REDACTED_EMAIL]` placeholders;
   - benign text from the same records is preserved;
   - section headers for seeded scopes are present (structure intact).
3. Idempotence probe: `redactText(output).text === output` (fixpoint; see
   §1 amendment note).
4. No-results path: formatted output for a non-matching query contains the
   query echo and no exception.
5. All existing suites stay green: src/test.ts, test-sqlite, boot-recovery,
   gate0 trio, spec-enforcement.

## 5. Open decisions (implementer free)

- Internal decomposition of the formatter (per-section helpers vs single
  function body).
- Fixture string values and seeded record count beyond the minimum above.
- Whether the formatter file also exports per-section helpers for reuse.

Follow-up explicitly out of scope (next spec): recover_context / boot
output boundary parity, and Codex-bridge probe additions.

## Pre-impl self-check (7-item, non-independent — see §0 disclosure)

- [x] §0 has target_project / dispatch_origin / dispatch_reason
- [x] Interface signature, pre/post-conditions stated
- [x] Required behavior is observable/testable (byte-identical structure + zero-count re-redaction)
- [x] Forbidden behavior carries incident references
- [x] Variation axis: none introduced (single output boundary; no env switch)
- [x] Adapter symmetry: n/a (no new external world)
- [x] Test fixtures are executable and bound to CI as merge gate
