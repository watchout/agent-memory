#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildKusabiFleetStatusNotification,
  canonicalKusabiFleetStatus,
  deliverKusabiFleetStatusNotification,
  deriveKusabiFleetStatus,
  formatKusabiFleetStatus,
  kusabiFleetStatusSha256,
  validateKusabiFleetStatus,
  type KusabiFleetAlert,
  type KusabiFleetManifest,
  type KusabiFleetStatusSnapshot,
} from "./kusabi-fleet-status.js";
import {
  kusabiFleetStatusFixtureEvent,
  kusabiFleetStatusFixtureManifest,
  kusabiFleetStatusFixtureRecord,
  sealKusabiFleetStatusFixtureManifest,
} from "./test-kusabi-fleet-status-store.js";
import type { KusabiRuntimeEventDocument, KusabiRuntimeEventRecord } from "./stores/types.js";
import { parseKusabiFleetStatusArgs } from "./kusabi-fleet-status-cli.js";

const FRESH_AT = "2026-07-30T00:01:00.000Z";
let assertions = 0;

function check(condition: unknown, message: string): void {
  assert(condition, message);
  assertions++;
}

function snapshot(
  manifest: KusabiFleetManifest,
  events: KusabiRuntimeEventDocument[],
  generatedAt = FRESH_AT,
): KusabiFleetStatusSnapshot {
  return deriveKusabiFleetStatus(manifest, events.map(kusabiFleetStatusFixtureRecord), { generatedAt });
}

function alertFor(result: KusabiFleetStatusSnapshot, code: KusabiFleetAlert["code"]): KusabiFleetAlert {
  const alert = result.alerts.find((candidate) => candidate.code === code);
  assert(alert, `expected ${code} alert`);
  return alert;
}

function mutateEvent(
  event: KusabiRuntimeEventDocument,
  mutate: (copy: Record<string, any>) => void,
): KusabiRuntimeEventDocument {
  const copy = structuredClone(event) as Record<string, any>;
  mutate(copy);
  return copy as KusabiRuntimeEventDocument;
}

async function main(): Promise<void> {
  const healthyManifest = kusabiFleetStatusFixtureManifest();
  const healthyEvent = kusabiFleetStatusFixtureEvent(healthyManifest);
  const healthy = snapshot(healthyManifest, [healthyEvent]);
  check(healthy.targets[0].state === "healthy", "fresh exact durable recovery is healthy");
  check(healthy.targets[0].state_reasons.length === 0, "healthy state has no reasons");
  check(healthy.summary.healthy_count === 1 && healthy.summary.target_count === 1,
    "healthy summary arithmetic is exact");
  check(healthy.summary.exact_observation_rate === 1 && healthy.summary.durable_evidence_rate === 1,
    "healthy coverage rates are exact");
  check(healthy.alerts.length === 0 && healthy.next_action === "none", "healthy snapshot has no alerts");
  check(validateKusabiFleetStatus(healthy).valid, "healthy snapshot validates against the normative schema");

  const notObservedBefore = snapshot(healthyManifest, [], "2026-07-30T00:04:59.000Z");
  check(notObservedBefore.targets[0].state === "not_observed", "no event derives not_observed");
  check(notObservedBefore.alerts.length === 0, "not_observed remains non-alerting before the deadline");
  const notObservedAfter = snapshot(healthyManifest, [], "2026-07-30T00:05:00.000Z");
  const notObservedAlert = alertFor(notObservedAfter, "not_observed");
  check(notObservedAlert.severity === "P1", "not_observed at the deadline is P1");
  check(notObservedAlert.next_action !== "none" && notObservedAlert.next_action.blocking,
    "not_observed P1 has a blocking next action");

  const privacyEvent = kusabiFleetStatusFixtureEvent(healthyManifest, {
    eventType: "privacy_violation",
    status: "failed",
    reasonCode: "privacy_forbidden_field",
    normalizedErrorCode: "privacy_forbidden_field",
    forbiddenFieldCount: 1,
  });
  const privacy = snapshot(healthyManifest, [privacyEvent]);
  check(privacy.targets[0].state === "failed", "privacy violation has failed-state precedence");
  const privacyAlert = alertFor(privacy, "privacy_violation");
  check(privacyAlert.severity === "P0", "privacy violation is P0");
  check(privacyAlert.next_action !== "none" && privacyAlert.next_action.blocking,
    "privacy P0 has a blocking next action");

  const runtimeFailureEvent = kusabiFleetStatusFixtureEvent(healthyManifest, {
    eventType: "runtime_error",
    status: "failed",
    reasonCode: "runtime_exception",
    normalizedErrorCode: "runtime_failure",
  });
  const runtimeFailure = snapshot(healthyManifest, [runtimeFailureEvent]);
  check(runtimeFailure.targets[0].state === "failed", "latest runtime failure derives failed");
  const runtimeAlert = alertFor(runtimeFailure, "runtime_failure");
  check(runtimeAlert.severity === "P1", "runtime failure is P1");
  check(runtimeAlert.next_action !== "none" && runtimeAlert.next_action.blocking,
    "runtime failure P1 is blocking");

  const normalizedP0Results = ([
    "destructive_effect", "data_loss_or_corruption", "false_acceptance",
  ] as const).map((code, index) => {
    const event = kusabiFleetStatusFixtureEvent(healthyManifest, {
      eventId: `00000000-0000-4000-8000-${String(301 + index).padStart(12, "0")}`,
      eventType: "runtime_error",
      status: "failed",
      reasonCode: "runtime_exception",
      normalizedErrorCode: code,
    });
    const result = snapshot(healthyManifest, [event]);
    const alert = alertFor(result, code);
    check(alert.severity === "P0" && alert.next_action !== "none" && alert.next_action.blocking,
      `${code} normalized runtime defect is blocking P0`);
    check(!result.alerts.some((candidate) => candidate.code === "runtime_failure"),
      `${code} P0 does not add a redundant lower-severity runtime alert`);
    return result;
  });

  const driftEvent = mutateEvent(healthyEvent, (event) => {
    event.build.commit_sha = "9".repeat(40);
    event.configuration.config_sha256 = "9".repeat(64);
    event.configuration.binding_source_ref_sha256 = "8".repeat(64);
    event.storage.backend = "postgres";
    event.storage.binding_sha256 = "7".repeat(64);
  });
  const drift = snapshot(healthyManifest, [driftEvent]);
  check(drift.targets[0].state === "drifted", "identity mismatch derives drifted");
  check(drift.targets[0].state_reasons.join(",") ===
    "binding_drift,build_drift,configuration_drift,storage_drift",
    "drift reasons remain distinct and deterministic");
  for (const code of ["build_drift", "configuration_drift", "binding_drift", "storage_drift"] as const) {
    const alert = alertFor(drift, code);
    check(alert.severity === "P1" && alert.next_action !== "none" && alert.next_action.blocking,
      `${code} is blocking P1`);
  }

  const stale = snapshot(healthyManifest, [healthyEvent], "2026-07-30T00:03:01.000Z");
  check(stale.targets[0].state === "stale", "old observation derives stale after the frozen threshold");
  const staleAlert = alertFor(stale, "stale_observation");
  check(staleAlert.severity === "P2", "stale observation is P2");
  check(staleAlert.next_action !== "none" && !staleAlert.next_action.blocking,
    "stale P2 is non-blocking");

  const maintenanceManifest = kusabiFleetStatusFixtureManifest({ maintenanceWindows: [{
    started_at: "2026-07-30T00:02:00.000Z",
    ended_at: "2026-07-30T00:04:00.000Z",
  }] });
  const maintenanceEvent = kusabiFleetStatusFixtureEvent(maintenanceManifest);
  const maintenance = snapshot(maintenanceManifest, [maintenanceEvent], "2026-07-30T00:03:01.000Z");
  check(maintenance.targets[0].state === "healthy" && maintenance.targets[0].maintenance_active,
    "approved maintenance suppresses stale classification without hiding identity or recovery state");

  const degradedEvent = kusabiFleetStatusFixtureEvent(healthyManifest, {
    status: "degraded",
    reasonCode: "recovery_incomplete",
    normalizedErrorCode: "recovery_incomplete",
  });
  const isolated = snapshot(healthyManifest, [degradedEvent]);
  check(isolated.targets[0].state === "degraded", "one degraded recovery derives degraded");
  const isolatedAlert = alertFor(isolated, "isolated_degradation");
  check(isolatedAlert.severity === "P3" && isolatedAlert.next_action !== "none" && !isolatedAlert.next_action.blocking,
    "isolated degradation is non-blocking P3");

  const repeatedEvents = [0, 1, 2].map((index) => kusabiFleetStatusFixtureEvent(healthyManifest, {
    eventId: `00000000-0000-4000-8000-${String(201 + index).padStart(12, "0")}`,
    occurredAt: `2026-07-30T00:00:${String(20 + index * 10).padStart(2, "0")}.000Z`,
    status: "degraded",
    reasonCode: "recovery_incomplete",
    normalizedErrorCode: "recovery_incomplete",
  }));
  const repeated = snapshot(healthyManifest, repeatedEvents);
  check(repeated.targets[0].consecutive_degraded === 3, "three consecutive degradations inside 15 minutes are counted");
  check(repeated.targets[0].state_reasons.includes("repeated_degradation"),
    "repeated degradation appears in target reasons");
  const repeatedAlert = alertFor(repeated, "repeated_degradation");
  check(repeatedAlert.severity === "P2" && repeatedAlert.occurrence_count === 3,
    "repeated degradation is one P2 alert with exact occurrence count");

  const emergencyEvent = kusabiFleetStatusFixtureEvent(healthyManifest, {
    eventType: "evidence_sink_error",
    status: "degraded",
    reasonCode: "evidence_sink_write_failed",
    evidenceDelivery: "emergency_only",
    normalizedErrorCode: "store_write_failed",
  });
  const emergencyBefore = snapshot(healthyManifest, [emergencyEvent], "2026-07-30T00:04:59.000Z");
  const emergencyP2 = alertFor(emergencyBefore, "evidence_sink_failure");
  check(emergencyP2.severity === "P2" && emergencyP2.next_action !== "none" && !emergencyP2.next_action.blocking,
    "emergency evidence before the deadline is non-blocking P2");
  const emergencyAtDeadline = snapshot(healthyManifest, [emergencyEvent], "2026-07-30T00:05:00.000Z");
  const emergencyP1 = alertFor(emergencyAtDeadline, "evidence_sink_failure");
  check(emergencyP1.severity === "P1" && emergencyP1.next_action !== "none" && emergencyP1.next_action.blocking,
    "emergency evidence at the deadline is blocking P1");

  const failedDeliveryEvent = kusabiFleetStatusFixtureEvent(healthyManifest, {
    eventType: "evidence_sink_error",
    status: "failed",
    reasonCode: "evidence_sink_write_failed",
    evidenceDelivery: "failed",
    normalizedErrorCode: "store_write_failed",
  });
  const failedDelivery = snapshot(healthyManifest, [failedDeliveryEvent]);
  check(failedDelivery.targets[0].state === "failed", "failed evidence delivery derives failed");
  const failedDeliveryAlert = alertFor(failedDelivery, "evidence_sink_failure");
  check(failedDeliveryAlert.severity === "P1" && failedDeliveryAlert.next_action !== "none" && failedDeliveryAlert.next_action.blocking,
    "failed evidence delivery is blocking P1 immediately");

  const deploymentEvent = kusabiFleetStatusFixtureEvent(healthyManifest, {
    eventType: "deployment_observed",
    status: "not_applicable",
  });
  const deploymentOnly = snapshot(healthyManifest, [deploymentEvent]);
  check(deploymentOnly.targets[0].state === "degraded", "inventory alone does not claim runtime recovery health");
  check(alertFor(deploymentOnly, "isolated_degradation").severity === "P3",
    "inventory-only runtime gap is a non-blocking isolated degradation");

  const performanceEvent = kusabiFleetStatusFixtureEvent(healthyManifest, {
    eventType: "recovery_result",
    status: "degraded",
    reasonCode: "timeout",
    normalizedErrorCode: "performance_warning",
  });
  const performanceStatus = snapshot(healthyManifest, [performanceEvent]);
  const performanceAlert = alertFor(performanceStatus, "performance_warning");
  check(performanceAlert.severity === "P3" && performanceAlert.next_action !== "none" && !performanceAlert.next_action.blocking,
    "bounded normalized performance warning is non-blocking P3");
  check(!performanceStatus.alerts.some((candidate) => candidate.code === "isolated_degradation"),
    "performance warning does not create a redundant isolated-degradation alert");

  const duplicate = deriveKusabiFleetStatus(
    healthyManifest,
    [kusabiFleetStatusFixtureRecord(healthyEvent), kusabiFleetStatusFixtureRecord(healthyEvent)],
    { generatedAt: FRESH_AT },
  );
  check(duplicate.targets[0].event_count === 1, "duplicate event_id delivery is idempotent");
  check(duplicate.snapshot_id === healthy.snapshot_id, "duplicate delivery does not change snapshot identity");

  const futureEvent = mutateEvent(healthyEvent, (event) => {
    event.event_id = "00000000-0000-4000-8000-000000000999";
    event.occurred_at = "2026-07-30T00:02:00.000Z";
  });
  const futureExcluded = snapshot(healthyManifest, [futureEvent]);
  check(futureExcluded.targets[0].state === "not_observed", "future event is excluded from the generated status window");

  const codexManifest = kusabiFleetStatusFixtureManifest({ hostRuntime: "codex", agentId: "kusabi-codex" });
  const geminiManifest = kusabiFleetStatusFixtureManifest({
    hostRuntime: "gemini_cli",
    agentId: "kusabi-gemini",
    manifestId: codexManifest.manifest_id,
  });
  const codexError = kusabiFleetStatusFixtureEvent(codexManifest, {
    eventType: "runtime_error", status: "failed", reasonCode: "runtime_exception",
    normalizedErrorCode: "shared_normalized_failure",
  });
  const geminiError = kusabiFleetStatusFixtureEvent(geminiManifest, {
    eventType: "runtime_error", status: "failed", reasonCode: "runtime_exception",
    normalizedErrorCode: "shared_normalized_failure",
  });
  const codexFingerprint = alertFor(snapshot(codexManifest, [codexError]), "runtime_failure");
  const geminiFingerprint = alertFor(snapshot(geminiManifest, [geminiError]), "runtime_failure");
  check(codexFingerprint.fingerprint_sha256 === geminiFingerprint.fingerprint_sha256,
    "same normalized defect receives one cross-host fingerprint");
  check(codexFingerprint.alert_id !== geminiFingerprint.alert_id,
    "per-target alert identity remains distinct while fingerprint groups the defect");

  const sqliteManifest = kusabiFleetStatusFixtureManifest({ backend: "sqlite" });
  const postgresManifest = kusabiFleetStatusFixtureManifest({ backend: "postgres" });
  const sqliteStatus = snapshot(sqliteManifest, [kusabiFleetStatusFixtureEvent(sqliteManifest)]);
  const postgresStatus = snapshot(postgresManifest, [kusabiFleetStatusFixtureEvent(postgresManifest)]);
  const normalizeBackend = (result: KusabiFleetStatusSnapshot) => ({
    state: result.targets[0].state,
    reasons: result.targets[0].state_reasons,
    summary: result.summary,
    alerts: result.alerts.map(({ code, severity, next_action }) =>
      ({ code, severity, blocking: next_action === "none" ? null : next_action.blocking })),
  });
  check(JSON.stringify(normalizeBackend(sqliteStatus)) === JSON.stringify(normalizeBackend(postgresStatus)),
    "SQLite and PostgreSQL fixtures produce identical normalized status verdicts");

  const canonicalBeforeNotification = canonicalKusabiFleetStatus(runtimeFailure);
  const failedNotification = await deliverKusabiFleetStatusNotification(runtimeFailure, async () => {
    throw new Error("raw notifier failure must be discarded");
  });
  check(failedNotification.status === "failed", "optional notifier failure is reported without throwing");
  check(canonicalKusabiFleetStatus(runtimeFailure) === canonicalBeforeNotification,
    "notifier failure does not mutate canonical status");
  check(formatKusabiFleetStatus(runtimeFailure).includes("alert=P1/runtime_failure"),
    "local human-readable status remains queryable when notifier fails");
  const notification = buildKusabiFleetStatusNotification(runtimeFailure);
  check(notification.payload_sha256.length === 64 && !JSON.stringify(notification).includes("raw notifier failure"),
    "notification is bounded to normalized fields and a deterministic digest");

  check(kusabiFleetStatusSha256(healthy) === kusabiFleetStatusSha256(structuredClone(healthy)),
    "status canonicalization is deterministic");
  check(snapshot(healthyManifest, [healthyEvent]).snapshot_id === healthy.snapshot_id,
    "same manifest, event, and generated_at produce the same snapshot id");

  const badHash = structuredClone(healthyManifest);
  badHash.manifest_sha256 = "f".repeat(64);
  assert.throws(() => snapshot(badHash, []), /KUSABI_FLEET_MANIFEST_HASH_MISMATCH/);
  assertions++;
  const badTarget = structuredClone(healthyManifest);
  badTarget.targets[0].target_key = "f".repeat(64);
  sealKusabiFleetStatusFixtureManifest(badTarget);
  assert.throws(() => snapshot(badTarget, []), /KUSABI_FLEET_MANIFEST_TARGET_KEY_MISMATCH/);
  assertions++;
  const duplicateTarget = structuredClone(healthyManifest);
  duplicateTarget.targets.push(structuredClone(duplicateTarget.targets[0]));
  sealKusabiFleetStatusFixtureManifest(duplicateTarget);
  assert.throws(() => snapshot(duplicateTarget, []), /KUSABI_FLEET_MANIFEST_DUPLICATE_TARGET/);
  assertions++;
  const unknownField = { ...structuredClone(healthyManifest), unexpected: true };
  assert.throws(() => deriveKusabiFleetStatus(unknownField, [], { generatedAt: FRESH_AT }),
    /KUSABI_FLEET_MANIFEST_INVALID/);
  assertions++;

  const conflictRecord = kusabiFleetStatusFixtureRecord(healthyEvent);
  const conflictingCopy = structuredClone(conflictRecord);
  conflictingCopy.event_sha256 = "f".repeat(64);
  assert.throws(() => deriveKusabiFleetStatus(healthyManifest, [conflictRecord, conflictingCopy], { generatedAt: FRESH_AT }),
    /KUSABI_FLEET_STATUS_EVENT_INTEGRITY_INVALID|KUSABI_FLEET_STATUS_EVENT_ID_CONFLICT/);
  assertions++;

  const parsedArgs = parseKusabiFleetStatusArgs(["--manifest", "fixture.json", "--at", FRESH_AT, "--json"]);
  check(parsedArgs.manifestPath === "fixture.json" && parsedArgs.generatedAt === FRESH_AT && parsedArgs.json,
    "local status CLI parses one explicit manifest, time, and format");
  assert.throws(() => parseKusabiFleetStatusArgs(["--unknown"]), /KUSABI_FLEET_STATUS_ARGUMENT_INVALID/);
  assertions++;

  for (const result of [healthy, notObservedAfter, privacy, runtimeFailure, ...normalizedP0Results, drift, stale,
    isolated, repeated, emergencyBefore, emergencyAtDeadline, failedDelivery, deploymentOnly, performanceStatus]) {
    check(validateKusabiFleetStatus(result).valid, `derived ${result.targets[0].state} snapshot remains schema-valid`);
    const summary = result.summary;
    check(summary.target_count === summary.healthy_count + summary.degraded_count + summary.failed_count +
      summary.stale_count + summary.not_observed_count + summary.drifted_count,
    `derived ${result.targets[0].state} snapshot has exact arithmetic`);
  }

  for (const alert of [notObservedAlert, privacyAlert, runtimeAlert, staleAlert, isolatedAlert,
    repeatedAlert, emergencyP2, emergencyP1, failedDeliveryAlert]) {
    check(alert.next_action !== "none", `${alert.code} open alert has a structured next action`);
    if (alert.next_action !== "none") {
      check(alert.next_action.blocking === (alert.severity === "P0" || alert.severity === "P1"),
        `${alert.code} blocking semantics match severity`);
      check(alert.next_action.exact_input_refs.every((ref) => /^[a-f0-9]{64}$/.test(ref)),
        `${alert.code} next action contains credential-safe exact hash refs only`);
    }
  }

  const latencyCases: Array<() => KusabiFleetStatusSnapshot> = [
    () => snapshot(healthyManifest, [], "2026-07-30T00:05:00.000Z"),
    () => snapshot(healthyManifest, [privacyEvent]),
    () => snapshot(healthyManifest, [runtimeFailureEvent]),
    () => snapshot(healthyManifest, [driftEvent]),
    () => snapshot(healthyManifest, [failedDeliveryEvent]),
  ];
  const latencyMs: number[] = [];
  let seededBlockingDetected = 0;
  for (let iteration = 0; iteration < 20; iteration++) {
    for (const deriveCase of latencyCases) {
      const started = performance.now();
      const result = deriveCase();
      latencyMs.push(performance.now() - started);
      if (result.alerts.some((alert) =>
        (alert.severity === "P0" || alert.severity === "P1") &&
        alert.next_action !== "none" && alert.next_action.blocking)) seededBlockingDetected++;
    }
  }
  latencyMs.sort((left, right) => left - right);
  const p95Ms = latencyMs[Math.ceil(latencyMs.length * 0.95) - 1];
  check(seededBlockingDetected === latencyCases.length * 20,
    "all seeded P0/P1 derivations create the expected blocking alert");
  check(p95Ms <= 60_000, "seeded P0/P1 status and alert creation is within the 60-second p95 gate");

  console.log(`KUSABI_OBS04_P0_P1_P95_MS=${p95Ms.toFixed(3)}`);
  console.log(`Kusabi fleet status tests passed: ${assertions} assertions`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
