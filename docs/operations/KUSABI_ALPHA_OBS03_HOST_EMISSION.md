# Kusabi alpha OBS-03 host emission

Status: implementation and isolated-validation contract. This change does not
modify a live hook configuration or trust decision and does not activate,
distribute, restart, migrate, or deploy a runtime.

## Scope

OBS-03 connects the existing native SessionStart adapters for Codex, Claude
Code, and Gemini CLI to the strict OBS-02 `kusabi_runtime_events` ledger. Each
successful native startup attempt can produce one `session_start` event under a
separately supplied rollout target. The adapter's ordinary recovery output is
built first and remains usable regardless of observability delivery.

The code is inert by default. If `KUSABI_RUNTIME_EVENT_TARGET_JSON` is absent or
empty, the emitter returns `disabled`, opens no additional store, writes no
runtime event, and preserves the adapter's prior stdout/stderr shape. This PR
does not set that variable anywhere.

## Strict rollout target

A later activation gate must supply exactly this privacy-safe identity shape:

```json
{
  "schema_version": "kusabi-runtime-event-target/v1",
  "manifest_id": "bounded-rollout-id",
  "build": {
    "commit_sha": "0000000000000000000000000000000000000000",
    "tree_sha": "0000000000000000000000000000000000000000",
    "artifact_sha256": "0000000000000000000000000000000000000000000000000000000000000000"
  },
  "configuration": {
    "config_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "trust_fingerprint_sha256": "0000000000000000000000000000000000000000000000000000000000000000"
  },
  "storage": {
    "backend": "sqlite",
    "binding_sha256": "0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

Unknown fields, malformed hashes, JSON storage, and a backend other than
`sqlite` or `postgres` are rejected. The target contains identities and hashes,
not a database URL, credential, raw path, environment dump, prompt, or recovery
payload. An invalid target produces only bounded emergency evidence with
`target_invalid`; its raw value is never echoed.

## Normalization and identity

The three native identities normalize as follows:

| Adapter identity | Runtime event identity |
| --- | --- |
| `codex` | `codex` |
| `claude-code` | `claude_code` |
| `gemini-cli` | `gemini_cli` |

For every host, the target identity is exactly:

```text
SHA-256(agent_id + "\n" + project + "\n" + host_runtime + "\n" + workspace_sha256)
```

The session reference, binding source reference, evidence locator, and evidence
content are stored only as SHA-256 values. `event_id` is a deterministic UUID
derived from the manifest, target, `session_start` type, and hashed session
reference, making exact redelivery idempotent at the OBS-02 ingest boundary.

## Backend and delivery boundary

Durable delivery requires all of these conditions:

1. the native recovery evidence verified its store binding;
2. its backend intent is SQLite or PostgreSQL;
3. that backend equals the rollout target backend;
4. the opened store reports the same backend;
5. the strict event passes the OBS-02 schema and the store acknowledges it.

The product's selected SQLite/PostgreSQL model is preserved. JSON remains a
test-fixture backend and is never accepted as durable observability evidence.
The emitter uses a quiet store selection path so normal success does not add a
second backend log line to native hook stderr.

## Failure isolation

Emission is awaited for at most 500 ms after the recovery result has been
constructed. The following outcomes do not replace, suppress, or mutate that
ordinary result:

| Condition | Emission result | Normalized emergency code |
| --- | --- | --- |
| no rollout target | `disabled` | none |
| invalid rollout target | `emergency_only` or `failed` | `target_invalid` |
| unverified or mismatched backend | `emergency_only` or `failed` | `backend_drift` |
| store cannot open before the bound | `emergency_only` or `failed` | `store_unavailable` |
| store write fails | `emergency_only` or `failed` | `store_write_failed` |
| emergency writer also fails | `failed` | no raw fallback |

Emergency output is one canonical JSON line bounded to 1,024 bytes. It contains
only schema version, event identity, event type/time, manifest/target hashes,
event hash, and normalized reason codes. Raw exceptions, stack traces, paths,
credentials, database URLs, environment values, prompts, conversations, and
recovery content are excluded.

## Isolated verification

```sh
npx tsc --noEmit
npx tsx src/test-kusabi-runtime-event-emitter.ts
npm run test:codex-hook
npm run test:claude-hook
npm run test:gemini-hook
DATABASE_URL='postgresql:///agent_comms?host=/tmp' npx tsx src/test-pg.ts
KUSABI_OBS03_POSTGRES_URL='postgresql:///agent_comms?host=/tmp' npx tsx src/test-kusabi-runtime-event-emitter.ts
npm test
npm run build
git diff --check
```

The common emitter test starts the actual source CLIs for all three hosts
against one temporary SQLite ledger, reopens the ledger, and requires exactly
three schema-valid `session_start` events with distinct normalized runtimes and
the exact target-key formula. It also covers duplicate delivery, a PostgreSQL
contract store, backend drift, target rejection, sink open/write failures,
bounded timeout, emergency-writer failure, and forbidden-literal exclusion.
The PostgreSQL integration suite remains isolated in unique temporary schemas
and must be cleaned up after execution.

## Later rollout and rollback gates

Activation is a separate protected effect. It must bind an exact merged build,
artifact, manifest, configuration, trust fingerprint, selected backend, and
binding fingerprint; confirm the OBS-02 live schema separately; and then modify
only the explicitly approved host configuration. None of those effects occurs
in this implementation PR.

Rollback is configuration-first and non-destructive: remove the separately
activated target binding or restore the prior exact configuration, leaving this
code inert and leaving the additive OBS-02 ledger intact. Dropping event data,
changing hook trust, restarting hosts, or reverting a deployed runtime requires
its own exact-target authorization.

## Governance boundary

Implementation authority:
`ODR-KUSABI-ALPHA-OBS03-04-ACCELERATION-20260730-001`.

OBS-04 implementation may begin only after an independent audit and owner
decision pass the immutable OBS-03 PR head/tree. Merge still requires the
separate protected merge actor. Live configuration/trust mutation, activation,
distribution, restart, TUI injection, live database migration, and deployment
remain outside this change.
