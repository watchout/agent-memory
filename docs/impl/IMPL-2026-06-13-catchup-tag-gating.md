# IMPL: gate catch_up tag extraction behind legacy opt-in (P2-CS1)

> 6-section implementation instruction (governance-flow format).

## 0. Dispatch context (frozen)

- **target_project**: agent-memory (wasurezu)
- **dispatch_origin**: CEO directive 2026-06-12/13 (autonomous
  continuation, spec-first). Role-collapse disclosure as in companion
  IMPL docs; post-impl audit on chain recovery.
- **dispatch_reason**: P2-CS1 retires tag auto-accumulation. PR #166
  gated the live hook path and PR #173 removed the rule-file installer,
  but `catch_up`'s jsonl sweep (`src/catch-up.ts` extractFromText) still
  creates task_states/decisions/knowledge from [TASK:]/[DECISION]/
  [KNOWLEDGE] tags found in conversation logs — retired tags resurrect
  through the sweep path. Tool-use-derived extraction (Edit/Write files,
  git commit, test runs) is NOT tag-based and must keep working.

## 1. Interface contract (frozen)

```ts
// src/catch-up.ts
export interface ExtractOptions { legacyTagCapture?: boolean } // default false
export function extractFromRecord(
  record: Record<string, unknown>,
  opts?: ExtractOptions
): ExtractedEvent[];
```

- `catchUp` computes the flag once per sweep from
  `AGENT_MEMORY_LEGACY_TAG_CAPTURE` (same env name and value grammar
  `/^(1|true)$/i` as PR #166) and threads it through `parseJsonl` →
  `extractFromRecord`.
- Flag off (default): `extractFromText` produces zero events; tool_use
  extraction unchanged. Flag on: behavior identical to today.
- No store interface, schema, or MCP tool signature changes
  (`catch_up` tool params unchanged).

## 2. Required behavior (frozen)

- Default sweep over a record containing both a tagged text block and an
  Edit tool_use yields ONLY the Edit-derived task_states event.
- Opt-in sweep over the same record yields both events (identical to
  pre-change behavior; dedup ledger semantics untouched).
- catch_up_log ledger writes for skipped/caught events keep current
  semantics — gated-out tag events are simply never extracted (they are
  not logged as "skipped"; skipped is reserved for dedup hits).

## 3. Forbidden behavior (frozen)

- Do NOT remove the tag extraction code (opt-in must keep working —
  same reversibility boundary as #166).
- Do NOT touch files owned by pending PRs (post-tool-hook.ts, boot.ts,
  constants.ts, format-search.ts, redact.ts, ci.yml gate0 block, README).
- Do NOT alter tool-use extraction rules or dedup hashing (silent data
  loss class).

## 4. Test fixtures (frozen, merge gate)

- New assertions in `src/test.ts` (pure, no DB): a synthetic assistant
  record with one `[TASK:start]` text block + one Edit tool_use block:
  - default: exactly 1 event, target_table=task_states from Edit,
    files_modified populated, no ticket-derived event;
  - `{legacyTagCapture: true}`: 2+ events including the tag-derived
    task_states event with task_status=in_progress;
  - `[DECISION]`/`[KNOWLEDGE]` text blocks: zero events by default,
    extracted when opted in.
- Existing suites stay green; `npx tsc --noEmit` clean.

## 5. Open decisions (implementer free)

- Option threading style (param vs module state — param required by §1),
  fixture content, assertion count beyond minimum.

## Pre-impl self-check (7-item, non-independent — see §0)

- [x] §0 complete; [x] signature + default stated; [x] observable
  required behavior incl. ledger semantics; [x] forbidden list pins
  pending-PR files + data-loss class; [x] no new variation axis (reuses
  #166's flag); [x] adapter symmetry n/a; [x] executable fixtures bound.
