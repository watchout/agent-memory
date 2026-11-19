# Common-infrastructure form (`AGENT_MEMORY_MODE=common`)

> Status: operations note for u1-seat-memory-skeleton, PR-2. The design is in
> `aidlc/spaces/default/intents/261021-facility-ax-memory/construction/u1-seat-memory-skeleton/` (BR and DL numbers below).
> The code is the source for every limit and name: `src/common-placement.ts` (`COMMON_LIMITS`), `src/common-seat-errors.ts`
> (failure names), `src/common-recovery.ts` (`MEMORY_STATUS`). This note does not repeat their values.

## Entering the form

- Only `AGENT_MEMORY_MODE=common` enters it. With no mode, an empty mode or `standalone`, nothing here runs and every
  program keeps its existing path (BR6.1). Any other value is a failure named `invalid_input`, not a fallback.
- Setting the variable in a seat's launch settings is a deployment step and an owner decision (protected surface). This
  change does not set it anywhere.
- The place is `AGENT_MEMORY_DATABASE_URL`, then the user config's `database_url`. `DATABASE_URL` and
  `AGENT_MEMORY_DB_TYPE` are not read. No place is a failure named `placement_unset`; the form never opens SQLite or JSON
  (BR1.1, BR1.3).
- The seat's own setting is the `common_seat` field of the user config (`~/.agent-memory/config.json`), not an
  environment variable and not a tool argument. An absent field is `seat_not_registered`; a wrong shape is
  `invalid_input`. The value prints, stringifies and serializes as a fixed word.

## What each program does in the form

| Program | In the common form |
|---|---|
| MCP server (`index.ts`) | The form is decided once before any local store is built. `log_decision` and `get_decisions` reach the database; every other listed tool answers `not_yet_available`. `get_decisions` with a `status` other than `active` also answers `not_yet_available`. |
| Claude Code and Codex session start, `boot` | Read this seat's active decisions and print them as data, one JSON line each, between `DATA BEGIN` and `DATA END`. Every path returns content; a start-up is never stopped. |
| Gemini and Antigravity session start (Antigravity: on its first invocation) | Recovery is empty and says `reason: not_yet_available (input)` with no `memory_status` line (the set of `memory_status` values has no value for "no read yet"). |
| `claude-start`, `codex-start` | Stop before opening a store, print the reason on stderr and exit with code 2: the restart pack is a local-store feature with no common form yet. |

## Reading what the start-up printed

- `memory_status` is one of `ok`, `unreachable`, `not_registered`, `not_initialized`, `skipped_deadline`. Anything but `ok`
  means no decision was recovered, which is not a statement that the seat has none.
- `skipped_deadline` means the whole start-up limit was reached. A connection or read that exceeded its own limit is
  `unreachable`.
- No recovery quality log is written in this form, so the host's own "evidence logging is unavailable" notice follows.

## The local call record

Each call appends one line to `~/.agent-memory/calls.log`: the time, the tool name, the ids of the records, and `ok` or
`error:<name>`. It never holds decision text, a URL or driver text (BR5.1, BR5.2). A failed append does not change the
tool's answer.

## When a write's answer is lost

`log_decision` is not resent automatically. If the answer is lost, the failure says the write may or may not have
happened; read with `get_decisions` before sending it again (S7).
