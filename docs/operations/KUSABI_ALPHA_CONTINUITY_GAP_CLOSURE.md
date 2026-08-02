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
