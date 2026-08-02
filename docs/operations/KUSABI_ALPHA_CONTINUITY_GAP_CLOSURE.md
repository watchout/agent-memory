# Kusabi alpha continuity gap closure

This document records the A2 capture-service boundary authorized by Issue 280.
It does not authorize activation, deployment, restart, PR state changes, A3, or
production use.

## Deterministic capture contract

- The controller is repository-owned TypeScript and makes zero LLM calls.
- The only canonical raw-event write capability is `Store.saveRawEvent`.
- Codex, Claude Code, and Gemini CLI produce source-bearing, redacted raw events.
- Replaying the same stable source reference is idempotent.
- The AM-031 conversation table remains a compatibility projection for the
  existing Codex and Claude adapters; it is not the capture authority.

Gemini parsing covers the three A1-observed path shapes: snapshot JSON,
append/patch JSONL, and nested session-fragment JSON. The parser recognizes the
complete frozen field surface and uses default deny. It never persists thoughts,
model identifiers, token accounting, raw tool arguments/results, protected
system or developer instruction bodies, or unknown fields. Unknown fields reject
the containing record and produce only credential-safe counters.

## Fleet authority and reconciliation

The frozen DB-backed 35-target manifest is the only target authority. The
installed 47-row registry is an observation, not an alternative inventory.
Reconciliation is bidirectional and must reproduce both complete sets:

- 24 unique unmatched registry-row hashes;
- 11 unique missing manifest-binding keys.

The arithmetic difference `47 - 35 = 12` is not an enumerable row set and must
never drive selection, deletion, adoption, or omission of registry rows.

## Immutable runtime boundary

Candidate evidence binds the commit, tree, build command, repository-relative
artifact path, and artifact SHA-256. A production command may reference only an
immutable release artifact. A mutable checkout's `dist/` directory is rejected
as a production runtime root.

## A2 verification

Run from a clean isolated worktree at the authorized exact base:

```text
npx tsc --noEmit
npx tsx src/test-gemini-conversation-ingest.ts
npx tsx src/test-raw-capture-service.ts
npm test
npm run test:codex-hook
npm run test:claude-hook
npm run test:gemini-hook
npm run build
git diff --check
```

The focused service test uses isolated JSON, SQLite, and PostgreSQL stores,
requires normalized parity 1.0, validates strict positive and negative schema
fixtures, proves idempotent readback, and cleans up all temporary resources.

## Continuation boundary

A2 produces an independently auditable candidate only. A3 interruption and
continuation execution, preproduction audit, owner production GO, merge,
distribution, activation, and soak remain separate later gates. Status reports,
ACKs, and queue receipts are not completion evidence.

## A3 local interruption-continuation evidence

A3 is a local, isolated fixture gate. It launches a distinct interrupted child
process and a distinct fresh recovery child process for every Codex, Claude Code,
and Gemini CLI scenario. The frozen matrix is three hosts by seven interruption
points: pre-output, post-visible/pre-capture, in-flight tool, post-file-write/
pre-commit, temporary database outage, capture crash/restart, and identity
mismatch. All 21 rows must pass; same-process continuation is rejected.

The fixture maps Codex to an isolated JSON store, Claude Code to an isolated
SQLite store, and Gemini CLI to an isolated PostgreSQL schema. Selected packs
are single-use except when an identity mismatch is rejected. Capture replay uses
the canonical `Store.saveRawEvent` source reference and must retain exactly one
durable event. Temporary stores and schemas are removed deterministically.

Recovery envelopes are strict, bounded data-only objects. They contain only an
exact fixture identity, durable objective and next action, redacted fixture
source references, explicit effect state, and privacy classification. Unknown
fields, private reasoning, protected instruction bodies, raw tool payloads,
credentials, secrets, and raw absolute home paths are rejected before store
consumption. Output is limited to 1,800 estimated tokens and 8,192 bytes, and
each fresh process has a seven-second startup deadline.

Run the A3 gate and its inherited checks from the exact clean A2 head:

```text
npx tsc --noEmit
npx tsx src/test-kusabi-continuity-interruption-e2e.ts
npx tsx src/test-raw-capture-service.ts
npx tsx src/test-gemini-conversation-ingest.ts
npm test
npm run test:codex-hook
npm run test:claude-hook
npm run test:gemini-hook
npm run build
git diff --check
```

The A3 evidence schema is
`docs/design/schemas/kusabi-continuity-interruption-e2e-v1.schema.json`.
Passing A3 does not authorize preproduction audit, owner GO, PR state changes,
merge, distribution, deployment, restart, session mutation, or production use.
