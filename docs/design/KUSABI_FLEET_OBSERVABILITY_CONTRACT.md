# Kusabi Fleet Observability Contract v1

Status: owner-approved design candidate; runtime implementation is not authorized

Owner decision: `ODR-KUSABI-ALPHA-OBSERVABILITY-DESIGN-20260728-006`

Baseline: `main@1f9bc0549b560280cc19c4c5a371ab80d54e8159`

Proposed target date: 2026-07-30 23:59 JST; exact-head owner acceptance
freezes this date

## 1. Product promise

Kusabi continuity follows the canonical `agent_id`. A new session, a changed
profile, a different internal model, or a switch among Codex, Claude Code, and
Gemini CLI must continue the same work when the canonical agent, project,
workspace binding, and selected store binding are the same.

Observability does not redefine that promise. It makes the promise operable at
fleet scale by answering, with machine-verifiable evidence:

1. Which exact agent/runtime targets should be running the approved build?
2. Which build, artifact, configuration, binding, and backend did each target
   actually observe?
3. Did startup recovery complete fully, degrade safely, or fail?
4. Is evidence missing, stale, or drifting from the approved rollout?
5. What bounded, privacy-safe failure fingerprint should be acted on next?

The contract is host-neutral. Codex, Claude Code, and Gemini CLI are parallel
host bindings of the same Kusabi product, not a primary host plus secondary
integrations.

## 2. Scope and non-scope

### In scope

- One frozen fleet-manifest denominator.
- One common runtime-event contract for all three native hosts.
- One deterministic derived fleet-status contract.
- Build, artifact, configuration, binding, backend, freshness, recovery,
  evidence-delivery, drift, and privacy signals.
- Durable local evidence plus optional centralized internal aggregation.
- Alert and bug-fingerprint rules.
- SQLite/PostgreSQL parity and a transport-neutral observation boundary.
- Canary, staged rollout, rollback, alert smoke, and 24-hour soak gates.

### Not in scope

- Capturing conversation text, prompts, private reasoning, or recovery-pack
  content.
- A dashboard UI, billing, SSO/RBAC, tenant management, or public SLA.
- Treating AUN, GitHub, Slack, or another notifier as a Kusabi core dependency.
- Automatically restarting a host, injecting TUI input, changing hook trust, or
  activating an agent.
- Implementing a DB schema, migration, runtime emitter, collector, notifier, or
  distribution change in this design cell.
- Adding new KBF acceptance dimensions or reopening the completed G1/G2/G3
  alpha evaluation.

## 3. Source of truth and fleet membership

### 3.1 Frozen target manifest

The rollout manifest is the sole denominator for fleet coverage. A registry
row count, AUN process list, configuration-directory count, or historical
12-seat rollout is never the denominator implicitly.

Each enabled target is uniquely identified by:

```text
target_key = sha256(agent_id + "\n" + project + "\n" + host_runtime + "\n" + workspace_sha256)
```

The manifest freezes, per target:

- canonical `agent_id` and project;
- `host_runtime`: `codex`, `claude_code`, or `gemini_cli`;
- credential-safe `workspace_sha256`;
- expected commit SHA, tree SHA, built-artifact SHA-256, and adapter version;
- expected configuration SHA-256, trust fingerprint SHA-256, and binding-source
  reference SHA-256;
- selected backend (`sqlite` or `postgres`) and credential-safe store-binding
  SHA-256;
- expected observation interval, stale threshold, activation deadline, and an
  optional approved maintenance window.

A target is included only when it is an enabled internal development agent
binding approved for the rollout. Disabled, test-only, canary-only, human, and
retired registry entries are excluded unless listed explicitly. One agent may
have more than one target when it has more than one approved native host
binding. Manifest membership changes require a new manifest version and hash;
they never rewrite the meaning of an old status snapshot.

### 3.2 Baseline and current gap

At the `1f9bc054...` baseline, three canonical host canaries have observed live
alpha evidence, but there is no frozen all-agent manifest or centralized
latest-alpha status plane. Using the provisional three-host minimum only, the
centrally observable coverage is `0/3 = 0%`; the target is `3/3 = 100%`. When
the full manifest is frozen, the same percentage formula is re-baselined to
`observed_exact_targets / manifest_targets`; its acceptance threshold remains
100%. The present measurable gap is therefore 100 percentage points, not an
assumed count of unverified registry rows.

## 4. Architecture boundary

```text
native host / read-only inventory probe
  -> common event builder
  -> selected durable local store (SQLite or PostgreSQL)
  -> transport-neutral observation sink
  -> internal fleet aggregator
  -> deterministic status snapshot + alert/feedback sinks
```

### 4.1 Product-store parity

SQLite and PostgreSQL remain user-selected Kusabi stores. Both implement the
same logical event and query contract and must produce equivalent normalized
events and status results for the same fixture stream. Observability must not
force a SQLite installation to use PostgreSQL for product continuity.

For IYASAKA's internal multi-writer fleet, PostgreSQL is the recommended
central aggregation store. A SQLite target durably records the same event
locally and exports it through the transport-neutral sink. The central choice
is an operations deployment decision, not a change to the Kusabi storage
promise. JSON storage may be used for deterministic fixtures, but it is not an
accepted durable fleet-observability store in v1.

### 4.2 Independence and failure isolation

- Core event creation and local persistence do not require AUN, GitHub, Slack,
  or a dashboard.
- Notifier failure cannot break ordinary host startup or memory recovery.
- Primary evidence-write failure must never disappear silently. The adapter
  emits a bounded emergency JSON line to stderr, marks the recovery result
  degraded, and increments `evidence_sink_failure`.
- If neither durable local evidence nor the bounded emergency record can be
  produced, the runtime remains usable but the observation is `failed`; the
  rollout gate fails closed for that target.
- The aggregator consumes idempotently by `event_id`. Duplicate delivery does
  not change counts or state.
- Collector and inventory work is read-only. It must not trust hooks, modify
  configuration, start or stop sessions, inject TUI input, or restart agents.

## 5. Canonical runtime event

The normative schema is
[`kusabi-runtime-event-v1.schema.json`](schemas/kusabi-runtime-event-v1.schema.json).
Unknown fields are rejected.

Every event includes:

- a UUID `event_id`, UTC occurrence time, event type, and manifest ID;
- the deterministic target key;
- canonical agent, project, host, adapter, workspace hash, and optional hashed
  session reference;
- observed commit, tree, built-artifact hash, and adapter version;
- observed config, trust, and binding-source hashes;
- observed backend and store-binding hash;
- outcome, reason code, elapsed time, recovery-quality signals, evidence
  delivery mode, and bounded error fingerprint;
- privacy-policy version, redaction count, and forbidden-field count;
- zero or more credential-safe evidence references.

Event types are:

| Event | Meaning |
| --- | --- |
| `deployment_observed` | A read-only inventory probe observed build/config/binding/store identity. |
| `session_start` | A native host invoked the approved SessionStart surface. |
| `recovery_result` | Startup recovery completed fully, degraded, or failed. |
| `heartbeat` | A running collector/adapter emitted a liveness observation. |
| `runtime_error` | A normalized runtime failure occurred. |
| `evidence_sink_error` | Primary durable evidence delivery failed. |
| `privacy_violation` | A forbidden telemetry field or value was detected. |

The event contains observed identity only. Expected identity belongs to the
immutable manifest and is joined by the aggregator. This prevents a producer
from declaring itself compliant by copying its own expectation.

### 5.1 Delivery states

- `durable`: the selected local store acknowledged the event.
- `emergency_only`: primary persistence failed but the bounded stderr record
  was emitted.
- `failed`: neither admissible evidence channel produced a record.

Only `durable` counts as complete rollout evidence. `emergency_only` is
diagnostic evidence and forces a degraded or failed status. `failed` is a hard
rollout failure.

### 5.2 Error taxonomy and fingerprint

Raw error messages and stack traces are not fleet telemetry. Producers map
errors to a bounded `reason_code` and compute:

```text
error_fingerprint_sha256 = sha256(
  schema_version + "\n" + event_type + "\n" + host_runtime + "\n" +
  adapter_version + "\n" + reason_code + "\n" + normalized_error_code
)
```

Allowed reason codes are frozen in the schema. New reasons require a schema
version or an explicit backward-compatible enum change with fixtures. This
gives identical defects one fleet-level fingerprint without collecting user
content.

## 6. Privacy and data minimization

The following values are forbidden in runtime events, status snapshots,
fingerprints, alerts, and external notifications:

- conversation or transcript content;
- user prompts or model responses;
- private reasoning, scratchpads, or hidden instructions;
- recovery-pack payloads, objectives, next-action text, constraints, blockers,
  or source excerpts;
- credentials, tokens, cookies, authorization headers, database URLs, or
  environment-variable values;
- raw absolute workspace, home-directory, config, database, or log paths;
- unnormalized exceptions, stack traces, shell command lines, or arbitrary
  labels.

Allowed identifiers are canonical agent/project IDs, enumerated runtime and
reason values, version identifiers, numeric measurements, timestamps, UUIDs,
and SHA-256 hashes of credential-safe canonical values. Evidence references
must use the allow-listed schemes in the event schema and must not embed query
strings, credentials, raw paths, or arbitrary URLs.

The producer sets `forbidden_field_count` after applying the observability
redaction policy. A non-zero count forces `event_type=privacy_violation` and a
failed outcome. The unredacted value is discarded and is never attached as
evidence. A privacy violation is a blocking P0 incident for rollout and a
mandatory regression fixture.

## 7. Deterministic fleet status

The normative derived snapshot schema is
[`kusabi-fleet-status-v1.schema.json`](schemas/kusabi-fleet-status-v1.schema.json).
The aggregator reads one exact manifest plus the idempotent event stream and
derives one state for every manifest target.

### 7.1 State precedence

The first matching rule wins:

1. `not_observed`: no qualifying event exists after the target activation time.
2. `failed`: privacy violation, latest runtime failure, failed evidence
   delivery, or another hard failure is unresolved.
3. `drifted`: observed build, tree, artifact, adapter, config, trust, binding,
   backend, or store-binding identity differs from the manifest.
4. `stale`: last qualifying observation is older than the target's frozen
   `stale_after_seconds`, excluding an approved maintenance window.
5. `degraded`: latest recovery is degraded, delivery is `emergency_only`, or
   three consecutive degradation events occur inside 15 minutes.
6. `healthy`: identities match, evidence is durable, observation is fresh, and
   the latest applicable recovery result is full.

An inactive host is not assumed healthy. A read-only inventory observation can
prove deployment identity while the process is closed; a runtime recovery
claim additionally requires its own session/recovery event.

The snapshot summary counts must equal the exact number of target rows and the
target keys must be unique. JSON Schema checks shape; the aggregator and its
fixture suite check arithmetic, uniqueness, precedence, and time-window rules.

### 7.2 Alerts

| Severity | Trigger | Required response |
| --- | --- | --- |
| P0 | privacy violation, destructive telemetry effect, data loss/corruption, or false acceptance | Block affected rollout; owner and safety review required. |
| P1 | failed event, build/config/binding/backend drift, evidence delivery failed, or target not observed by activation deadline | Block affected rollout stage; implementation executor investigates. |
| P2 | stale target, emergency-only evidence, or 3 degradations within 15 minutes | Keep ordinary work running; investigate without stopping unrelated work. |
| P3 | isolated degradation or performance warning | Record and trend; non-blocking. |

An alert carries `next_action`. `blocking: true` is permitted only for a P0
safety/data-integrity/false-acceptance incident or a protected rollout gate.
Ordinary ACKs, queue receipts, progress reports, isolated warnings, and P2/P3
alerts never stop implementation.

The snapshot-level `next_action` mirrors the highest-severity unresolved alert
or is `none` when no action remains. An `open` or `acknowledged` alert always
has a structured next action; `resolved` or `suppressed` alerts may use `none`.

Alert delivery has three layers:

1. a queryable canonical status snapshot;
2. a local human-readable status command/report;
3. optional external sinks such as AUN, GitHub, or messaging.

Layers 1 and 2 are required. Layer 3 is replaceable and may fail without
becoming a core dependency. An external issue is never opened automatically in
v1; the normalized fingerprint and evidence refs are supplied to the actor who
owns the next action.

## 8. KGI, KPI, KDI, and fixed pass criteria

### 8.1 KGI

Owner: `watchout`

Proposed measurement deadline: 2026-07-30 23:59 JST or before the first
all-manifest activation, whichever occurs first. It becomes authoritative only
when the owner accepts the exact design head.

Business connection: an alpha fleet that cannot expose version drift, missing
recovery evidence, or repeated failure is not supportable and cannot safely
become the open-core lead magnet or a measured continuity pilot.

KGI passes only when one frozen rollout manifest satisfies all of these for a
continuous 24-hour soak:

- observable coverage: `observed_exact_targets / manifest_targets = 100%`;
- healthy or explicitly approved-maintenance coverage: 100%;
- `not_observed + drifted + failed = 0` targets at closure;
- forbidden telemetry values: 0;
- seeded P0/P1 failure detection: 100%;
- unresolved blocking alerts: 0;
- SQLite/PostgreSQL normalized fixture parity: 100%.

### 8.2 KPI

| KPI | Formula | Pass |
| --- | --- | --- |
| Exact observation coverage | exact fresh target observations / manifest targets | 100% |
| Identity drift count | targets with any expected/observed identity mismatch | 0 |
| Durable evidence coverage | targets with durable event evidence / manifest targets | 100% |
| Seeded detection coverage | detected seeded P0/P1 cases / seeded P0/P1 cases | 100% |
| Detection latency | time from qualifying event ingest to status/alert creation | p95 <= 60 seconds in test and canary |
| Privacy escape count | forbidden raw values found outside the producer boundary | 0 |
| Backend parity | identical normalized status verdicts across SQLite/PostgreSQL fixtures | 100% |
| Status arithmetic integrity | snapshots with exact unique target/count invariants | 100% |

### 8.3 KDI

These are controllable execution measures, not document or PR counts:

- Execute 100% of the frozen positive, negative, drift, stale, privacy, sink
  failure, duplicate-delivery, and backend-parity fixture matrix.
- Execute one read-only inventory observation and one runtime recovery event for
  every target before its rollout stage advances.
- Execute alert smoke for every P0/P1 trigger before the first fleet stage.
- Reconcile manifest target keys against status target keys at every stage and
  every soak checkpoint.
- Run four soak checks per hour for 24 hours; missed checks are evidence gaps,
  not inferred passes.

### 8.4 Scope control for new tests

The v1 matrix may gain a case only when it reproduces a concrete privacy,
data-integrity, false-pass/false-fail, drift, durability, or availability defect
that existing cases do not detect and has a deterministic oracle. One root
cause receives one minimal regression scenario with data-table variations.
New dashboards, metrics, hosts, and timing refinements go to v2 unless they
repair a verified v1 blind spot. This prevents a passing target from moving
because inspection continues.

## 9. Problem decomposition and priorities

Candidate gaps considered:

1. No frozen all-agent target denominator.
2. No expected-versus-observed build/artifact comparison.
3. No expected-versus-observed config/trust/binding/backend comparison.
4. Existing structured evidence is not guaranteed to reach one durable fleet
   view.
5. Best-effort evidence failure can be invisible.
6. No deterministic stale/not-observed state.
7. No alert severity or blocking semantics.
8. No bounded cross-host bug fingerprint.
9. No explicit forbidden-telemetry contract.
10. No SQLite/PostgreSQL status-parity oracle.

The three v1 priorities are:

1. Freeze membership and exact deployment identity.
2. Make evidence durable and fleet status deterministic across both backends.
3. Close the feedback loop with privacy-safe alerts and fingerprints.

Dashboard polish, additional hosts, automatic issue creation, and performance
optimization remain outside the v1 critical path.

## 10. CHECK and ADJUST contract

Every rollout checkpoint records `target`, `actual`, and durable `evidence_ref`
for each KPI. A narrative status without those three fields is not CHECK
evidence.

When a KPI misses:

- A1: inspect the failed target/event and identify the direct cause.
- A2: move exactly one bottleneck or silent-failure cause into the next action.
- A3: change the emitter, store, aggregator, manifest, or operating procedure
  that caused the miss; do not merely rewrite the target.
- A4: add one minimal deterministic regression case and rerun the affected
  stage before advancing.

The target may change only through a new owner decision and contract version.

## 11. Completion boundary

This design cell is complete when the contract, both schemas, rollout runbook,
and Shirube artifacts are in one exact-head PR; positive and negative schema
fixtures pass; repository tests pass; an independent R2 design audit has no
blocking finding; and the owner accepts the exact head.

That acceptance authorizes neither implementation nor rollout. The next cell
must receive an explicit handoff defining allowed runtime/storage paths,
migration and rollback controls, tests, actor separation, and owner gates.
