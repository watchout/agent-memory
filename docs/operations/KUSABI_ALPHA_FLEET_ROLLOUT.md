# Kusabi Alpha Fleet Observability and Rollout Runbook

Status: design only; no runtime, configuration, trust, activation, or fleet
distribution is authorized by this document

Control source: `ODR-KUSABI-ALPHA-OBSERVABILITY-DESIGN-20260728-006`

Contract: [`KUSABI_FLEET_OBSERVABILITY_CONTRACT.md`](../design/KUSABI_FLEET_OBSERVABILITY_CONTRACT.md)

## 1. Purpose

This runbook defines how to implement observability first and then distribute
the merged Kusabi alpha without losing exact version identity or creating an
unobservable fleet. It does not authorize those later actions. Each execution
cell requires its own Shirube handoff, allowed paths, stop conditions, evidence,
and owner gate.

The rollout closes only when every target in one frozen manifest is observable
on the expected build/configuration/backend and the fleet has passed a
continuous 24-hour soak. Historical activation receipts, AUN registry totals,
and three-host G3 acceptance do not substitute for current-manifest evidence.

## 2. Actor and control boundaries

| Action | Active function | Gate |
| --- | --- | --- |
| Author/accept observability design | implementation executor + independent reviewer + owner | R2 exact-head design acceptance |
| Add event persistence or DB migration | implementation executor | R3 owner decision before protected DB/runtime mutation |
| Add three-host event emitters | implementation executor | R2 implementation handoff and independent audit |
| Add aggregator/status/alerts | implementation executor | R2 implementation handoff and independent audit |
| Change agent configs, trust, activation, or fleet distribution | implementation executor | R4 owner decision before mutation |
| Merge | separate authorized merge actor or human owner | green required checks, independent audit, owner exact-head decision |

The maker does not self-audit, self-approve, or self-merge. Collaboration
sub-agents are not auditors. AUN may route independent work but is not the
runtime dependency of Kusabi observability.

Progress, FYI, ACK, queue receipt, and intermediate evidence are non-blocking.
A stop occurs only for an explicit `next_action.blocking: true` with an allowed
Shirube stop reason, an owner gate, or a runbook stop condition.

## 3. Frozen inputs

Before any implementation or rollout, record immutable refs for:

- owner-approved design head and tree;
- implementation head/tree and built artifacts for Codex, Claude Code, and
  Gemini CLI;
- runtime-event and fleet-status schema digests;
- exact target-manifest ID, version, SHA-256, and target count;
- per-target expected identity, build, configuration, binding, backend, stale
  threshold, activation deadline, and maintenance window;
- exact pre-change configuration bytes and SHA-256 for rollback;
- selected SQLite and PostgreSQL fixture/database versions;
- alert routing configuration digest, with credentials excluded;
- independent audit and owner decision references.

If any frozen input changes, stop the affected stage, version the input, and
rerun its preflight. Do not silently update evidence to the new value.

## 4. Manifest freeze

1. Read the authoritative internal development-agent inventory.
2. Resolve every enabled Codex, Claude Code, and Gemini CLI binding intended for
   the alpha.
3. Exclude disabled, retired, human, test-only, and canary-only entries unless
   the owner explicitly includes them.
4. Generate each `target_key` from canonical agent/project/host/workspace hash.
5. Reject duplicate target keys and duplicate logical bindings.
6. Bind the exact expected commit, tree, artifact, adapter, configuration,
   trust, binding-source, backend, and store-binding hashes.
7. Assign each target to `canary`, `pilot`, or `fleet` stage.
8. Assign observation interval, stale threshold, activation deadline, and any
   approved maintenance window.
9. Canonicalize the manifest, calculate its SHA-256, and obtain the required
   owner decision.

Pass: all entries resolve, target keys are unique, exclusions are explicit, no
secret or raw absolute path exists, and count/hash are frozen.

Fail: an unresolved enabled target, implicit registry denominator, duplicate,
unknown runtime, unknown backend, unhashed raw path, or credential-bearing
binding appears.

## 5. Implementation gates before rollout

These gates are later cells; this design PR cannot satisfy them.

### Gate O1 — schema and privacy contract

- Both JSON Schemas compile under draft 2020-12.
- Positive examples for all event types and all six target states pass.
- Unknown fields, malformed hashes, raw-path fields, arbitrary error text,
  privacy violations disguised as success, and invalid blocking severities are
  rejected.
- Canonicalization and `target_key` fixtures are deterministic.

### Gate O2 — storage and idempotency

- The same event stream produces identical normalized results in SQLite and
  PostgreSQL.
- Duplicate `event_id` delivery is idempotent.
- Local durable ACK occurs only after commit.
- Primary write failure produces bounded emergency evidence and a degraded or
  failed result; it never disappears silently.
- No migration or DB change runs without the R3 owner gate and tested rollback.

### Gate O3 — host parity

- Codex, Claude Code, and Gemini CLI emit the same common event shape.
- Host-specific input is normalized before persistence.
- Exact canonical `agent_id`, project, workspace hash, backend binding, build,
  and config identity survive session/profile/model/host changes.
- Ordinary startup remains usable when the observability sink is unavailable.
- Wrapper launch, TUI injection, automatic restart, and trust mutation remain
  absent.

### Gate O4 — status and alerts

- State precedence fixtures pass for `not_observed`, `failed`, `drifted`,
  `stale`, `degraded`, and `healthy`.
- Snapshot counts equal unique target rows exactly.
- Every seeded P0/P1 case creates the expected alert and next action within 60
  seconds at p95.
- P2/P3 and non-blocking acknowledgements do not halt unrelated work.
- Status remains queryable when an optional external notifier is unavailable.

### Gate O5 — independent implementation audit

- One independent R2/R3 audit reviews runtime, storage, privacy, schema,
  backend parity, failure isolation, and test evidence.
- Blocking finding count is zero.
- The owner decides the exact implementation head before merge/activation.

## 6. Rollout stages

All stages are sequential at the stage level. Targets inside an owner-approved
stage may be processed with bounded concurrency only after stop-on-first-P0/P1
behavior is proved.

### Stage R0 — dry-run inventory

Run the collector in read-only mode over the frozen manifest. It may hash and
compare files/configuration but may not write configs, change trust, launch a
host, stop a session, restart anything, or deliver TUI input.

Pass:

- manifest coverage is 100%;
- every target reports a resolvable current state;
- rollback bytes/hash exist for every target;
- no forbidden effect occurs.

### Stage R1 — three-host canonical canary

Use one canonical continuity identity across exactly one Codex, one Claude
Code, and one Gemini CLI target. An operator uses the ordinary host command
only when a fresh-session recovery observation is required. The adapter and
configuration are otherwise changed only by the separately authorized rollout
executor.

Pass:

- `3/3` exact deployment observations;
- `3/3` durable runtime event delivery;
- `3/3` expected build/config/binding/backend identity;
- one full recovery result per host with the same canonical agent work;
- seeded degraded/sink-failure behavior leaves ordinary host use available;
- P0/P1 alert smoke detects every seed;
- zero privacy escapes and forbidden effects.

### Stage R2 — pilot cohort

Advance only the manifest targets explicitly labeled `pilot`. Historical
12-seat membership may be reused only if those exact targets appear in the new
manifest with current expected hashes.

Pass:

- `pilot observed exact / pilot targets = 100%`;
- durable evidence coverage is 100%;
- failed, drifted, and not-observed counts are zero;
- no open P0/P1 alert;
- at least one SQLite and one PostgreSQL target or equivalent approved backend
  parity fixture remains green;
- one-hour pilot observation contains no repeated degradation series.

### Stage R3 — remaining fleet

Advance the remaining `fleet` targets in deterministic batches frozen in the
manifest. Recompute the status snapshot after each batch. Do not infer success
for offline or inactive targets; use read-only inventory evidence and collect
runtime evidence when the host next starts within its activation deadline.

Pass after every batch:

- all activated targets are observed exactly and durably;
- no failed, drifted, not-observed, or unapproved stale target exists;
- no open P0/P1 alert;
- snapshot arithmetic and target-key reconciliation are exact.

### Stage R4 — 24-hour soak

Start the soak only after the full frozen manifest passes R3. Produce four
status checkpoints per hour for 24 continuous hours. A missing checkpoint is
an evidence gap and resets the continuous soak window unless covered by an
owner-approved maintenance window frozen before the gap.

Closure requires:

- 100% exact observation and durable evidence coverage at every checkpoint;
- zero privacy escapes;
- zero unresolved failed, drifted, or not-observed targets;
- zero open P0/P1 alerts;
- no unresolved repeated degradation;
- p95 alert generation at or below 60 seconds for scheduled smoke probes;
- SQLite/PostgreSQL normalized parity remains 100%;
- independent closure review and owner closure decision.

## 7. Alert smoke matrix

Use synthetic identifiers and hashes only. Never seed real secrets, prompts,
conversation content, or production destructive behavior.

| Fixture | Expected state | Alert | Blocking at rollout gate |
| --- | --- | --- | --- |
| forbidden telemetry field marker | failed | P0 `privacy_violation` | yes |
| synthetic false-pass marker | failed | P0 `false_acceptance` | yes |
| expected/observed artifact mismatch | drifted | P1 `build_drift` | yes |
| config or trust hash mismatch | drifted | P1 `configuration_drift` | yes |
| backend binding mismatch | drifted | P1 `storage_drift` | yes |
| no event by activation deadline | not_observed | P1 `not_observed` | yes |
| durable sink failure with emergency line | degraded or failed | P1/P2 `evidence_sink_failure` by severity rule | stage-dependent |
| observation older than frozen threshold | stale | P2 `stale_observation` | no, except stage gate |
| three degradations in 15 minutes | degraded | P2 `repeated_degradation` | no, stage cannot close |
| one isolated safe degradation | degraded | P3 `isolated_degradation` | no |

## 8. Stop conditions

Stop advancing the affected stage immediately when:

- a P0 or P1 alert opens;
- an expected/observed build, artifact, configuration, trust, binding, backend,
  or store-binding hash differs;
- a manifest target is missing or duplicated;
- durable evidence is missing at its deadline;
- schema validation, status arithmetic, idempotency, or backend parity fails;
- ordinary host startup is no longer usable after an observation failure;
- a forbidden telemetry value escapes the producer boundary;
- a TUI write, tmux send-keys, wrapper launch, automatic restart, unapproved
  trust/config change, or unrelated workspace mutation occurs;
- the exact approved head/tree/artifact or manifest changes;
- rollback evidence is absent;
- an independent audit reports a blocking finding.

An isolated P2/P3 warning stops stage closure only where the pass criteria say
so; it does not stop unrelated approved development.

## 9. Rollback

Rollback is per target and uses the frozen pre-change configuration bytes and
hash. It is not `git reset --hard`, force-push, broad deletion, or worktree
replacement.

1. Freeze the failing status snapshot, event IDs, hashes, alert fingerprint,
   and affected target set.
2. Stop further rollout batches; do not stop unrelated development.
3. Obtain any required protected-mutation/activation authority.
4. Restore only the authorized target's prior configuration/artifact reference.
5. Do not inject an existing TUI, restart automatically, or change trust
   implicitly. If a fresh host process is necessary, the human operator closes
   and starts it normally.
6. Run read-only inventory and confirm the restored hashes.
7. Confirm ordinary host operation and safe degraded behavior.
8. Keep the alert open until durable evidence proves the target state and an
   independent actor accepts the resolution where required.
9. Add one minimal regression fixture, rerun the failed gate, and require a new
   owner decision before resuming a protected rollout.

## 10. Feedback and incident record

Each open alert provides:

- severity and bounded reason code;
- target key and manifest hash;
- expected/observed identity hashes;
- first/last seen time and occurrence count;
- privacy-safe fingerprint and evidence-reference hashes;
- a complete Shirube `next_action` identifying actor, active function,
  delivery route, exact input-reference hashes, scope, deliverable, completion
  evidence, and blocking status.

Do not attach raw errors, paths, prompts, recovered work, or credentials. The
responsible actor resolves the hashed references inside the authorized evidence
store. Optional AUN/GitHub notifications mirror the alert; they are neither the
canonical record nor a prerequisite for status computation.

## 11. CHECK / ADJUST cadence

At each stage and soak checkpoint, record every KPI as `target`, `actual`, and
durable `evidence_ref`. If a KPI misses, identify the direct cause, select one
bottleneck, change the responsible mechanism or procedure, add one minimal
regression fixture, and rerun the affected stage. Do not add unrelated metrics
or move the acceptance threshold during an active rollout.

## 12. Completion packet

The rollout closure packet contains:

- owner-approved design and implementation head/tree refs;
- independent audit refs;
- exact manifest ID/version/hash/count and membership digest;
- per-stage status snapshots and alert-smoke evidence;
- SQLite/PostgreSQL parity evidence;
- rollback preflight and any executed rollback evidence;
- all 96 expected 24-hour soak checkpoints;
- final snapshot with 100% exact/durable coverage, zero failed/drifted/
  not-observed targets, zero privacy escapes, and zero open P0/P1 alerts;
- owner closure decision;
- `next_action: none` if no external action remains.

Only that packet closes fleet observability and distribution. A PR merge, CI
green result, queue ACK, or old rollout receipt alone is not closure evidence.
