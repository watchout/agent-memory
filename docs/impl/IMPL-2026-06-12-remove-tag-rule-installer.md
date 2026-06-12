# IMPL: remove FEAT-029 memory-tags.md auto-installer (P2-CS1)

> 6-section implementation instruction (governance-flow format).

## 0. Dispatch context (frozen)

- **target_project**: agent-memory (wasurezu)
- **dispatch_origin**: CEO directive 2026-06-12 (autonomous continuation,
  spec-first). Role-collapse disclosure as in companion IMPL docs;
  post-impl audit on chain recovery.
- **dispatch_reason**: clean-install smoke (this date) surfaced that
  `boot.ts` auto-installs `templates/memory-tags.md` into
  `~/.claude/rules/` on every boot (FEAT-029, `src/ensure-tags.ts`).
  Tags are legacy per P2-CS1 (capture default-off in PR #166), and the
  rule file instructs every bot to keep emitting tags. The installer
  actively undoes operator-side retirement: the rule file removed from
  `~/.claude/rules/` on 2026-06-12 was found reinstalled by a
  subsequent bot boot. Verified live: fresh-HOME boot prints
  `[agent-memory] Installed memory-tags.md → ~/.claude/rules/`.

## 1. Interface contract (frozen)

- Delete `src/ensure-tags.ts` (sole export `ensureMemoryTags`; only
  consumer is `src/boot.ts`).
- Delete `templates/memory-tags.md` (installer source artifact).
- `src/boot.ts`: remove the import and the `await ensureMemoryTags()`
  call. No other boot behavior changes.
- Boot must NOT delete an existing installed rule file — uninstall is
  an operator action (forcibly mutating user-owned `~/.claude/rules/`
  is out of bounds). Stop installing; do not start deleting.

## 2. Required behavior (frozen)

- Fresh-HOME boot completes with no `Installed memory-tags.md` stderr
  line and creates no `~/.claude/rules/` directory.
- All other boot side effects (stale-task expiry, recovery output,
  recovery-quality logging, catch-up) unchanged.
- Operators who opt back into legacy tags (#166 flag) manage their own
  rule text; the hooks template (#166) remains the opt-in reference.

## 3. Forbidden behavior (frozen)

- Do NOT touch files owned by pending PRs: post-tool-hook.ts,
  templates/hooks-example.jsonc, SSOT-3 (#166), constants.ts (#170),
  format-search.ts/index.ts (#169), redact.ts (#167), ci.yml gate0
  block (#169/#170/#172).
- Do NOT add deletion/cleanup logic for existing installed files
  (user-file mutation; see §1).

## 4. Test fixtures (frozen, merge gate)

- Extend `src/test-boot-recovery.ts` (already boots in temp HOME) OR a
  standalone check asserting: after boot with fresh HOME, the string
  `Installed memory-tags.md` does not appear on stderr and
  `$HOME/.claude/rules/memory-tags.md` does not exist.
- `npx tsc --noEmit` clean (deleted module has no remaining importers).
- Existing suites stay green.

## 5. Open decisions (implementer free)

- Test placement (boot-recovery suite vs gate0 file) and fixture detail.

## Breaking-change disclosure

- Removal of a boot side effect (auto-install). Affected consumers:
  bots relying on auto-installed tag rules — which is precisely the
  retired behavior (P2-CS1). Remediation: none needed for the default
  path; legacy opt-in operators copy the rule text manually if they
  still want it.

## Pre-impl self-check (7-item, non-independent — see §0)

- [x] §0 complete with live verification evidence
- [x] Interface contract: full deletion set + no-delete boundary stated
- [x] Required behavior observable (stderr line absence + path absence)
- [x] Forbidden list pins all pending-PR files
- [x] No variation axis introduced
- [x] Adapter symmetry n/a
- [x] Executable fixture bound as merge gate
