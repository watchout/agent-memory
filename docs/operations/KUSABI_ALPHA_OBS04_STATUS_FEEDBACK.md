# Kusabi Alpha OBS-04 — deterministic status and feedback

Status: code and isolated-test implementation under
`ODR-KUSABI-ALPHA-OBS03-04-ACCELERATION-20260730-001`; no live activation or
external notification is authorized.

## Purpose

OBS-04 turns one exact fleet manifest and the OBS-02 runtime-event stream into
one deterministic, schema-valid status snapshot. It implements the status,
alert, and feedback layer defined by
[`KUSABI_FLEET_OBSERVABILITY_CONTRACT.md`](../design/KUSABI_FLEET_OBSERVABILITY_CONTRACT.md)
without adding another database schema or making AUN, GitHub, Slack, or any
other notifier a core dependency.

The implementation is in `src/kusabi-fleet-status.ts`. The local read-only
command is `wasurezu-kusabi-fleet-status` after a normal package build. Tests
use the same API against SQLite and an isolated PostgreSQL schema.

## Exact input boundary

The aggregator accepts `kusabi-fleet-manifest/v1` with these exact top-level
fields:

- `manifest_id`, positive integer `version`, and `manifest_sha256`;
- one or more unique targets;
- per target: the canonical identity and `target_key`, expected build,
  configuration, binding, and storage identity, activation time, durable
  evidence deadline, stale threshold, and zero or more approved maintenance
  windows.

`manifest_sha256` is SHA-256 over canonical JSON containing the schema version,
manifest ID, version, and target array. The target key is recomputed as:

```text
sha256(agent_id + "\n" + project + "\n" + host_runtime + "\n" + workspace_sha256)
```

Unknown fields, duplicate target keys, malformed hashes, non-canonical UTC
timestamps, overlapping maintenance windows, a target-key mismatch, or a
manifest-hash mismatch fail closed before any event is read.

The durable-store adapter reads at most 500 events per target from the existing
OBS-02 table. Reaching that bound fails closed with
`KUSABI_FLEET_STATUS_EVENT_WINDOW_EXCEEDS_QUERY_BOUND`; it never treats a
possibly truncated event window as complete. JSON remains fixture-only and is
rejected by the durable-store status entry point.

## Deterministic derivation

Events are schema-validated again, their indexed fields and canonical SHA-256
are checked, and duplicate `event_id` deliveries are collapsed only when their
hashes agree. Events before target activation or after `generated_at` are not
qualifying observations. An event claiming the exact manifest but an unknown
target fails closed.

For each target, the first matching state wins:

1. `not_observed` — no qualifying event;
2. `failed` — any privacy violation in the manifest window, or a latest runtime
   or failed-delivery event;
3. `drifted` — observed build, configuration, binding, producer identity, or
   storage differs from the manifest;
4. `stale` — the latest event is older than `stale_after_seconds` and no
   approved maintenance window is active;
5. `degraded` — the latest recovery is degraded, evidence is emergency-only,
   three consecutive degradations occur inside 15 minutes, or only inventory
   evidence exists without a successful session/recovery observation;
6. `healthy` — identity is exact, evidence is durable and fresh, and the latest
   session/recovery observation is full.

A later exact, full, durable recovery resolves a runtime, drift, stale, or
degradation condition in the derived view. A privacy violation remains a hard
failure for that immutable manifest window because v1 has no event that can
erase a captured privacy incident.

Targets, alerts, reasons, evidence references, and exact-input hashes are
sorted canonically. Snapshot IDs are UUIDv5 of the complete derived payload
excluding the ID. The same manifest, event set, and `generated_at` therefore
produce the same snapshot bytes and ID regardless of input ordering or
duplicate delivery.

## Alerts and fingerprints

The implementation emits open alerts only for currently actionable derived
conditions:

- P0: privacy violation, destructive effect, data loss/corruption, or false
  acceptance;
- P1: runtime failure, build/configuration/binding/storage drift, failed
  evidence delivery, or no observation at the durable-evidence deadline;
- P2: stale observation, three degradations inside 15 minutes, or
  emergency-only evidence before the durable-evidence deadline;
- P3: one isolated degradation, inventory-only observation, or a bounded
  normalized performance warning.

The three non-privacy P0 codes and `performance_warning` are accepted only as
exact bounded `normalized_error_code` values on an otherwise schema-valid
event. Free text is never classified or forwarded.

Emergency-only evidence changes from non-blocking P2 to blocking P1 exactly at
the frozen durable-evidence deadline. Every open P0/P1 next action has
`blocking: true`; every open P2/P3 next action has `blocking: false`. Snapshot
`next_action` mirrors the highest-severity alert and is `none` when no alert is
open.

The fleet bug fingerprint is:

```text
sha256("kusabi-alert-fingerprint/v1" + "\n" + alert_code + "\n" + normalized_defect)
```

For runtime and evidence failures, `normalized_defect` contains only the event
schema version, event type, alert code, enumerated reason code, and bounded
normalized error code. Host runtime, agent ID, workspace, raw exception, stack,
path, prompt, recovery content, credential, and database URL are excluded. The
same normalized defect can therefore share one fingerprint across Codex,
Claude Code, and Gemini CLI while each target keeps its own deterministic alert
ID.

## Local query and notifier isolation

After build:

```text
wasurezu-kusabi-fleet-status --manifest <file>
wasurezu-kusabi-fleet-status --manifest <file> --at <UTC ISO timestamp> --json
```

The command reads the selected SQLite or PostgreSQL store and writes either a
human-readable report or canonical JSON. It does not update the manifest,
event store, configuration, hook trust, host process, or runtime.

`deliverKusabiFleetStatusNotification` receives an injected optional notifier.
The payload contains only snapshot identity, manifest ID, numeric summary,
normalized alert fields, structured next actions, and one payload SHA-256. A
notifier exception is discarded and returned as `status=failed`; it never
changes, suppresses, or makes the canonical status and local report
unavailable. OBS-04 wires no real external notifier and never opens an issue
automatically.

## Fixed test oracle

`src/test-kusabi-fleet-status.ts` covers:

- all six state-precedence outcomes and exact summary arithmetic;
- not-observed before and at the evidence deadline;
- every fixed P0 trigger plus P1/P2/P3 severity and blocking semantics;
- four independent drift classes;
- isolated and repeated degradation;
- emergency-only P2 to P1 deadline transition and immediate failed-delivery P1;
- duplicate idempotency, future-event exclusion, maintenance handling, strict
  manifest rejection, event-integrity rejection, schema validation, canonical
  ordering, and deterministic snapshot identity;
- cross-host fingerprint equality with per-target alert identity;
- optional notifier failure isolation and local report availability;
- normalized SQLite/PostgreSQL fixture equality.

The existing SQLite and PostgreSQL suites also ingest an actual schema-valid
event, query it through each durable store, and derive the same normalized
OBS-04 result. PostgreSQL uses a unique temporary schema and drops it in the
suite cleanup.

## Explicit non-effects

This cell does not perform or authorize:

- a live database migration or new status/alert table;
- live configuration or trust changes;
- runtime activation, distribution, restart, wrapper launch, session or TUI
  injection, deployment, npm publish, tag, or release;
- external AUN, GitHub, Slack, email, or dashboard notification;
- raw error, path, credential, prompt, conversation, private reasoning, or
  recovery-content telemetry.

OBS-05 manifest freeze, R0 inventory, distribution, and activation remain
separately gated.
