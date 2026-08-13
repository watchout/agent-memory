import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { v5 as uuidv5 } from "uuid";
import { defaultSchemaDir } from "./artifact-schema-validator.js";
import {
  kusabiRuntimeEventSha256,
  validateKusabiRuntimeEvent,
} from "./kusabi-runtime-event-store.js";
import type {
  KusabiRuntimeEventDocument,
  KusabiRuntimeEventRecord,
  Store,
} from "./stores/types.js";

const FLEET_STATUS_SCHEMA_FILE = "kusabi-fleet-status-v1.schema.json";
const SNAPSHOT_NAMESPACE = "70f0d44d-6846-5f47-b739-2132887f99d6";
const ALERT_NAMESPACE = "df70d91d-4601-54c8-a6a2-517580851f15";
const SHA256_RE = /^[a-f0-9]{64}$/;
const GIT_SHA_RE = /^[a-f0-9]{40}$/;
const BOUNDED_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEGRADATION_WINDOW_MS = 15 * 60 * 1000;
const STORE_QUERY_LIMIT = 500;

export type KusabiHostRuntime = "antigravity_cli" | "codex" | "claude_code" | "gemini_cli";
export type KusabiFleetTargetState =
  | "healthy"
  | "degraded"
  | "failed"
  | "stale"
  | "not_observed"
  | "drifted";
export type KusabiFleetStateReason =
  | "privacy_violation"
  | "runtime_failure"
  | "evidence_sink_failure"
  | "build_drift"
  | "configuration_drift"
  | "binding_drift"
  | "storage_drift"
  | "no_observation"
  | "stale_observation"
  | "repeated_degradation"
  | "latest_recovery_degraded";
export type KusabiFleetAlertSeverity = "P0" | "P1" | "P2" | "P3";
export type KusabiFleetAlertCode =
  | "privacy_violation"
  | "destructive_effect"
  | "data_loss_or_corruption"
  | "false_acceptance"
  | "runtime_failure"
  | "build_drift"
  | "configuration_drift"
  | "binding_drift"
  | "storage_drift"
  | "evidence_sink_failure"
  | "not_observed"
  | "stale_observation"
  | "repeated_degradation"
  | "isolated_degradation"
  | "performance_warning";

export interface KusabiFleetIdentity {
  agent_id: string;
  project: string;
  host_runtime: KusabiHostRuntime;
  workspace_sha256: string;
}

export interface KusabiFleetBuildIdentity {
  commit_sha: string;
  tree_sha: string;
  artifact_sha256: string;
  adapter_version: string;
}

export interface KusabiFleetConfigurationIdentity {
  config_sha256: string;
  trust_fingerprint_sha256: string;
  binding_source_ref_sha256: string;
}

export interface KusabiFleetStorageIdentity {
  backend: "sqlite" | "postgres";
  binding_sha256: string;
}

export interface KusabiFleetDeploymentIdentity {
  build: KusabiFleetBuildIdentity;
  configuration: KusabiFleetConfigurationIdentity;
  storage: KusabiFleetStorageIdentity;
}

export interface KusabiFleetMaintenanceWindow {
  started_at: string;
  ended_at: string;
}

export interface KusabiFleetManifestTarget {
  target_key: string;
  identity: KusabiFleetIdentity;
  expected: KusabiFleetDeploymentIdentity;
  activation_at: string;
  durable_evidence_deadline_at: string;
  stale_after_seconds: number;
  maintenance_windows: KusabiFleetMaintenanceWindow[];
}

export interface KusabiFleetManifest {
  schema_version: "kusabi-fleet-manifest/v1";
  manifest_id: string;
  version: number;
  manifest_sha256: string;
  targets: KusabiFleetManifestTarget[];
}

export interface KusabiFleetEvidenceRef {
  kind: "local_store" | "central_store" | "run" | "github" | "aun" | "stderr_emergency";
  locator_sha256: string;
  content_sha256: string;
}

export interface KusabiFleetNextAction {
  actor_agent_id: string;
  active_function: string;
  action: string;
  deliver_via: string;
  exact_input_refs: string[];
  scope: string;
  deliverable: string;
  completion_evidence: string;
  blocking: boolean;
}

export interface KusabiFleetObservedDeployment {
  deployment: KusabiFleetDeploymentIdentity;
  last_event_id: string;
  last_event_at: string;
  evidence_delivery: "durable" | "emergency_only" | "failed";
}

export interface KusabiFleetTargetStatus {
  target_key: string;
  identity: KusabiFleetIdentity;
  state: KusabiFleetTargetState;
  state_reasons: KusabiFleetStateReason[];
  expected: KusabiFleetDeploymentIdentity;
  observed: KusabiFleetObservedDeployment | null;
  last_seen_at: string | null;
  stale_after_seconds: number;
  event_count: number;
  consecutive_degraded: number;
  maintenance_active: boolean;
  evidence_refs: KusabiFleetEvidenceRef[];
}

export interface KusabiFleetAlert {
  alert_id: string;
  severity: KusabiFleetAlertSeverity;
  code: KusabiFleetAlertCode;
  target_key: string | null;
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;
  fingerprint_sha256: string;
  status: "open" | "acknowledged" | "resolved" | "suppressed";
  evidence_refs: KusabiFleetEvidenceRef[];
  next_action: KusabiFleetNextAction | "none";
}

export interface KusabiFleetStatusSummary {
  target_count: number;
  healthy_count: number;
  degraded_count: number;
  failed_count: number;
  stale_count: number;
  not_observed_count: number;
  drifted_count: number;
  open_p0_count: number;
  open_p1_count: number;
  open_p2_count: number;
  open_p3_count: number;
  exact_observation_rate: number;
  durable_evidence_rate: number;
}

export interface KusabiFleetStatusSnapshot {
  schema_version: "kusabi-fleet-status/v1";
  snapshot_id: string;
  generated_at: string;
  manifest: {
    manifest_id: string;
    version: number;
    manifest_sha256: string;
    target_count: number;
  };
  window: { started_at: string; ended_at: string };
  summary: KusabiFleetStatusSummary;
  targets: KusabiFleetTargetStatus[];
  alerts: KusabiFleetAlert[];
  next_action: KusabiFleetNextAction | "none";
}

export interface KusabiFleetStatusValidationResult {
  valid: boolean;
  errors: string[];
}

export interface KusabiFleetStatusNotification {
  schema_version: "kusabi-fleet-status-notification/v1";
  snapshot_id: string;
  generated_at: string;
  manifest_id: string;
  summary: KusabiFleetStatusSummary;
  alerts: Array<Pick<KusabiFleetAlert,
    "severity" | "code" | "target_key" | "fingerprint_sha256" | "status" | "next_action">>;
  payload_sha256: string;
}

export interface KusabiFleetNotificationResult {
  status: "delivered" | "failed";
  payload_sha256: string;
}

export interface DeriveKusabiFleetStatusOptions {
  generatedAt?: string;
}

interface RuntimeEventProducer extends KusabiFleetIdentity {
  adapter_id: string;
  adapter_version: string;
  session_ref_sha256: string | null;
}

interface RuntimeEventOutcome {
  status: "full" | "degraded" | "failed" | "not_applicable";
  reason_code: string | null;
  elapsed_ms: number;
  evidence_delivery: "durable" | "emergency_only" | "failed";
  normalized_error_code: string | null;
  error_fingerprint_sha256: string | null;
}

interface RuntimeEventDocument extends KusabiRuntimeEventDocument {
  producer: RuntimeEventProducer;
  build: Omit<KusabiFleetBuildIdentity, "adapter_version">;
  configuration: KusabiFleetConfigurationIdentity;
  storage: KusabiFleetStorageIdentity;
  outcome: RuntimeEventOutcome;
  privacy: { policy_version: string; redaction_count: number; forbidden_field_count: number };
  evidence_refs: KusabiFleetEvidenceRef[];
}

interface PreparedRecord extends KusabiRuntimeEventRecord {
  event: RuntimeEventDocument;
}

interface TargetDerivation {
  target: KusabiFleetTargetStatus;
  alerts: KusabiFleetAlert[];
}

export class KusabiFleetStatusError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "KusabiFleetStatusError";
    this.code = code;
  }
}

let fleetStatusValidatorCache: { schemaDir: string; validate: ValidateFunction } | null = null;

export function kusabiFleetTargetKey(identity: KusabiFleetIdentity): string {
  return sha256([
    identity.agent_id,
    identity.project,
    identity.host_runtime,
    identity.workspace_sha256,
  ].join("\n"));
}

export function kusabiFleetManifestSha256(manifest: KusabiFleetManifest): string {
  return sha256(canonicalJson({
    schema_version: manifest.schema_version,
    manifest_id: manifest.manifest_id,
    version: manifest.version,
    targets: manifest.targets,
  }));
}

export function assertKusabiFleetManifest(value: unknown): asserts value is KusabiFleetManifest {
  if (!isRecord(value) || !exactKeys(value, [
    "schema_version", "manifest_id", "version", "manifest_sha256", "targets",
  ])) throw new KusabiFleetStatusError("KUSABI_FLEET_MANIFEST_INVALID");
  if (
    value.schema_version !== "kusabi-fleet-manifest/v1" ||
    !boundedId(value.manifest_id) ||
    !Number.isInteger(value.version) || Number(value.version) < 1 ||
    !sha256Value(value.manifest_sha256) || !Array.isArray(value.targets) || value.targets.length < 1
  ) throw new KusabiFleetStatusError("KUSABI_FLEET_MANIFEST_INVALID");

  const targetKeys = new Set<string>();
  for (const rawTarget of value.targets) {
    assertManifestTarget(rawTarget);
    const target = rawTarget as unknown as KusabiFleetManifestTarget;
    if (targetKeys.has(target.target_key)) {
      throw new KusabiFleetStatusError("KUSABI_FLEET_MANIFEST_DUPLICATE_TARGET");
    }
    targetKeys.add(target.target_key);
    if (kusabiFleetTargetKey(target.identity) !== target.target_key) {
      throw new KusabiFleetStatusError("KUSABI_FLEET_MANIFEST_TARGET_KEY_MISMATCH");
    }
  }
  const manifest = value as unknown as KusabiFleetManifest;
  if (kusabiFleetManifestSha256(manifest) !== manifest.manifest_sha256) {
    throw new KusabiFleetStatusError("KUSABI_FLEET_MANIFEST_HASH_MISMATCH");
  }
}

export function validateKusabiFleetStatus(
  value: unknown,
  schemaDir = defaultSchemaDir(),
): KusabiFleetStatusValidationResult {
  const validate = compiledFleetStatusValidator(schemaDir);
  if (validate(value)) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: (validate.errors ?? []).map((error) =>
      `${error.instancePath || "/"} ${error.message ?? "failed schema validation"}`),
  };
}

export function canonicalKusabiFleetStatus(value: unknown): string {
  return canonicalJson(value);
}

export function kusabiFleetStatusSha256(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function deriveKusabiFleetStatus(
  manifestValue: unknown,
  records: KusabiRuntimeEventRecord[],
  options: DeriveKusabiFleetStatusOptions = {},
): KusabiFleetStatusSnapshot {
  assertKusabiFleetManifest(manifestValue);
  const manifest = manifestValue;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  assertCanonicalTimestamp(generatedAt, "KUSABI_FLEET_STATUS_GENERATED_AT_INVALID");
  const generatedMs = Date.parse(generatedAt);
  const prepared = prepareRecords(manifest, records);

  const derivations = [...manifest.targets]
    .sort((left, right) => left.target_key.localeCompare(right.target_key))
    .map((target) => deriveTarget(manifest, target, prepared.get(target.target_key) ?? [], generatedAt, generatedMs));
  const targets = derivations.map(({ target }) => target);
  const alerts = derivations.flatMap(({ alerts }) => alerts).sort(compareAlerts);
  const summary = summarize(targets, alerts);
  const windowStart = [...manifest.targets]
    .map(({ activation_at }) => activation_at)
    .sort()[0];
  const highestAlert = alerts.find((alert) => alert.status === "open" || alert.status === "acknowledged");

  const withoutId = {
    schema_version: "kusabi-fleet-status/v1" as const,
    generated_at: generatedAt,
    manifest: {
      manifest_id: manifest.manifest_id,
      version: manifest.version,
      manifest_sha256: manifest.manifest_sha256,
      target_count: manifest.targets.length,
    },
    window: { started_at: windowStart, ended_at: generatedAt },
    summary,
    targets,
    alerts,
    next_action: highestAlert?.next_action ?? "none",
  };
  const snapshot: KusabiFleetStatusSnapshot = {
    ...withoutId,
    snapshot_id: uuidv5(canonicalJson(withoutId), SNAPSHOT_NAMESPACE),
  };
  const validation = validateKusabiFleetStatus(snapshot);
  if (!validation.valid) throw new KusabiFleetStatusError("KUSABI_FLEET_STATUS_SCHEMA_INVALID");
  assertSnapshotArithmetic(snapshot);
  return snapshot;
}

export async function deriveKusabiFleetStatusFromStore(
  store: Store,
  manifestValue: unknown,
  options: DeriveKusabiFleetStatusOptions = {},
): Promise<KusabiFleetStatusSnapshot> {
  assertKusabiFleetManifest(manifestValue);
  if (store.backend !== "sqlite" && store.backend !== "postgres") {
    throw new KusabiFleetStatusError("KUSABI_FLEET_STATUS_DURABLE_STORE_REQUIRED");
  }
  const recordGroups = await Promise.all(manifestValue.targets.map(async (target) => {
    const rows = await store.getKusabiRuntimeEvents({
      manifest_id: manifestValue.manifest_id,
      target_key: target.target_key,
      since: target.activation_at,
      limit: STORE_QUERY_LIMIT,
    });
    if (rows.length === STORE_QUERY_LIMIT) {
      throw new KusabiFleetStatusError("KUSABI_FLEET_STATUS_EVENT_WINDOW_EXCEEDS_QUERY_BOUND");
    }
    return rows;
  }));
  return deriveKusabiFleetStatus(manifestValue, recordGroups.flat(), options);
}

export function formatKusabiFleetStatus(snapshot: KusabiFleetStatusSnapshot): string {
  const summary = snapshot.summary;
  const lines = [
    `Kusabi fleet status ${snapshot.generated_at}`,
    `manifest=${snapshot.manifest.manifest_id} version=${snapshot.manifest.version} snapshot=${snapshot.snapshot_id}`,
    `targets=${summary.target_count} healthy=${summary.healthy_count} degraded=${summary.degraded_count} failed=${summary.failed_count} drifted=${summary.drifted_count} stale=${summary.stale_count} not_observed=${summary.not_observed_count}`,
    `alerts=P0:${summary.open_p0_count} P1:${summary.open_p1_count} P2:${summary.open_p2_count} P3:${summary.open_p3_count}`,
    `coverage=exact:${rate(summary.exact_observation_rate)} durable:${rate(summary.durable_evidence_rate)}`,
  ];
  for (const target of snapshot.targets) {
    lines.push(`target=${target.target_key} state=${target.state} reasons=${target.state_reasons.join(",") || "none"}`);
  }
  for (const alert of snapshot.alerts) {
    lines.push(`alert=${alert.severity}/${alert.code} target=${alert.target_key ?? "fleet"} fingerprint=${alert.fingerprint_sha256} blocking=${alert.next_action === "none" ? "none" : alert.next_action.blocking}`);
  }
  lines.push(snapshot.next_action === "none"
    ? "next_action=none"
    : `next_action=${snapshot.next_action.actor_agent_id}/${snapshot.next_action.active_function} blocking=${snapshot.next_action.blocking}`);
  return `${lines.join("\n")}\n`;
}

export function buildKusabiFleetStatusNotification(
  snapshot: KusabiFleetStatusSnapshot,
): KusabiFleetStatusNotification {
  const withoutHash = {
    schema_version: "kusabi-fleet-status-notification/v1" as const,
    snapshot_id: snapshot.snapshot_id,
    generated_at: snapshot.generated_at,
    manifest_id: snapshot.manifest.manifest_id,
    summary: snapshot.summary,
    alerts: snapshot.alerts.map((alert) => ({
      severity: alert.severity,
      code: alert.code,
      target_key: alert.target_key,
      fingerprint_sha256: alert.fingerprint_sha256,
      status: alert.status,
      next_action: alert.next_action,
    })),
  };
  return { ...withoutHash, payload_sha256: sha256(canonicalJson(withoutHash)) };
}

export async function deliverKusabiFleetStatusNotification(
  snapshot: KusabiFleetStatusSnapshot,
  notifier: (notification: KusabiFleetStatusNotification) => Promise<void>,
): Promise<KusabiFleetNotificationResult> {
  const notification = buildKusabiFleetStatusNotification(snapshot);
  try {
    await notifier(notification);
    return { status: "delivered", payload_sha256: notification.payload_sha256 };
  } catch {
    return { status: "failed", payload_sha256: notification.payload_sha256 };
  }
}

function assertManifestTarget(value: unknown): void {
  if (!isRecord(value) || !exactKeys(value, [
    "target_key", "identity", "expected", "activation_at",
    "durable_evidence_deadline_at", "stale_after_seconds", "maintenance_windows",
  ])) throw new KusabiFleetStatusError("KUSABI_FLEET_MANIFEST_TARGET_INVALID");
  if (!sha256Value(value.target_key) || !isIdentity(value.identity) || !isDeployment(value.expected)) {
    throw new KusabiFleetStatusError("KUSABI_FLEET_MANIFEST_TARGET_INVALID");
  }
  assertCanonicalTimestamp(value.activation_at, "KUSABI_FLEET_MANIFEST_TARGET_INVALID");
  assertCanonicalTimestamp(value.durable_evidence_deadline_at, "KUSABI_FLEET_MANIFEST_TARGET_INVALID");
  if (Date.parse(value.durable_evidence_deadline_at) < Date.parse(value.activation_at)) {
    throw new KusabiFleetStatusError("KUSABI_FLEET_MANIFEST_TARGET_INVALID");
  }
  if (!Number.isInteger(value.stale_after_seconds) || Number(value.stale_after_seconds) < 60) {
    throw new KusabiFleetStatusError("KUSABI_FLEET_MANIFEST_TARGET_INVALID");
  }
  if (!Array.isArray(value.maintenance_windows)) {
    throw new KusabiFleetStatusError("KUSABI_FLEET_MANIFEST_TARGET_INVALID");
  }
  let previousEnd = 0;
  for (const window of value.maintenance_windows) {
    if (!isRecord(window) || !exactKeys(window, ["started_at", "ended_at"])) {
      throw new KusabiFleetStatusError("KUSABI_FLEET_MANIFEST_TARGET_INVALID");
    }
    assertCanonicalTimestamp(window.started_at, "KUSABI_FLEET_MANIFEST_TARGET_INVALID");
    assertCanonicalTimestamp(window.ended_at, "KUSABI_FLEET_MANIFEST_TARGET_INVALID");
    const start = Date.parse(window.started_at);
    const end = Date.parse(window.ended_at);
    if (end <= start || start < previousEnd) {
      throw new KusabiFleetStatusError("KUSABI_FLEET_MANIFEST_TARGET_INVALID");
    }
    previousEnd = end;
  }
}

function prepareRecords(
  manifest: KusabiFleetManifest,
  records: KusabiRuntimeEventRecord[],
): Map<string, PreparedRecord[]> {
  const targets = new Set(manifest.targets.map(({ target_key }) => target_key));
  const byEventId = new Map<string, PreparedRecord>();
  for (const record of records) {
    if (record.manifest_id !== manifest.manifest_id || record.event.manifest_id !== manifest.manifest_id) {
      throw new KusabiFleetStatusError("KUSABI_FLEET_STATUS_MANIFEST_EVENT_MISMATCH");
    }
    if (!targets.has(record.target_key) || record.event.target_key !== record.target_key) {
      throw new KusabiFleetStatusError("KUSABI_FLEET_STATUS_UNKNOWN_TARGET_EVENT");
    }
    const validation = validateKusabiRuntimeEvent(record.event);
    if (!validation.valid || kusabiRuntimeEventSha256(record.event) !== record.event_sha256) {
      throw new KusabiFleetStatusError("KUSABI_FLEET_STATUS_EVENT_INTEGRITY_INVALID");
    }
    if (
      record.event_id !== record.event.event_id || record.event_type !== record.event.event_type ||
      record.occurred_at !== record.event.occurred_at
    ) throw new KusabiFleetStatusError("KUSABI_FLEET_STATUS_EVENT_INDEX_MISMATCH");
    const existing = byEventId.get(record.event_id);
    if (existing !== undefined && existing.event_sha256 !== record.event_sha256) {
      throw new KusabiFleetStatusError("KUSABI_FLEET_STATUS_EVENT_ID_CONFLICT");
    }
    byEventId.set(record.event_id, record as PreparedRecord);
  }

  const result = new Map<string, PreparedRecord[]>();
  for (const record of byEventId.values()) {
    const rows = result.get(record.target_key) ?? [];
    rows.push(record);
    result.set(record.target_key, rows);
  }
  for (const rows of result.values()) rows.sort(compareRecords);
  return result;
}

function deriveTarget(
  manifest: KusabiFleetManifest,
  manifestTarget: KusabiFleetManifestTarget,
  allRecords: PreparedRecord[],
  generatedAt: string,
  generatedMs: number,
): TargetDerivation {
  const activationMs = Date.parse(manifestTarget.activation_at);
  const records = allRecords.filter((record) => {
    const occurred = Date.parse(record.occurred_at);
    return occurred >= activationMs && occurred <= generatedMs;
  });
  const maintenanceActive = manifestTarget.maintenance_windows.some((window) =>
    generatedMs >= Date.parse(window.started_at) && generatedMs < Date.parse(window.ended_at));
  const evidenceRefs = uniqueEvidence(records.flatMap(({ event }) => event.evidence_refs));

  if (records.length === 0) {
    const target: KusabiFleetTargetStatus = {
      target_key: manifestTarget.target_key,
      identity: manifestTarget.identity,
      state: "not_observed",
      state_reasons: ["no_observation"],
      expected: manifestTarget.expected,
      observed: null,
      last_seen_at: null,
      stale_after_seconds: manifestTarget.stale_after_seconds,
      event_count: 0,
      consecutive_degraded: 0,
      maintenance_active: maintenanceActive,
      evidence_refs: [],
    };
    const alerts = generatedMs >= Date.parse(manifestTarget.durable_evidence_deadline_at)
      ? [makeAlert(manifest, manifestTarget, "not_observed", "P1", [
        absenceEvidence(manifest, manifestTarget, generatedAt),
      ], manifestTarget.durable_evidence_deadline_at, manifestTarget.durable_evidence_deadline_at, 1, "deadline")]
      : [];
    return { target, alerts };
  }

  const latest = records[records.length - 1];
  const event = latest.event;
  const latestRecovery = latestRecordMatching(records, ({ event: candidate }) =>
    candidate.event_type === "session_start" || candidate.event_type === "recovery_result");
  const latestSuccessfulRecoveryIndex = latestRecordIndexMatching(records, ({ event: candidate }) =>
    isRecoveryObservation(candidate));
  const unresolvedRecords = records.slice(latestSuccessfulRecoveryIndex + 1);
  const unresolvedHardFailure = latestRecordMatching(unresolvedRecords, ({ event: candidate }) =>
    candidate.event_type !== "privacy_violation" &&
    (candidate.event_type === "runtime_error" || candidate.outcome.status === "failed"));
  const unresolvedEvidenceFailure = latestRecordMatching(unresolvedRecords, ({ event: candidate }) =>
    candidate.outcome.evidence_delivery !== "durable");
  const unresolvedDegradation = latestRecordMatching(unresolvedRecords, ({ event: candidate }) =>
    isDegradedEvent(candidate));
  const degradationEvidence = unresolvedDegradation ??
    (latestRecovery === undefined || !isRecoveryObservation(latestRecovery.event) ? latestRecovery ?? latest : undefined);
  const hardFailureEvent = unresolvedHardFailure?.event;
  const normalizedP0Code = hardFailureEvent === undefined ? null : normalizedP0AlertCode(hardFailureEvent);
  const performanceWarning = degradationEvidence?.event.outcome.normalized_error_code === "performance_warning";
  const observed = observedDeployment(event);
  const consecutiveDegraded = consecutiveDegradationCount(records);
  const drift = driftReasons(manifestTarget, event);
  const hardReasons: KusabiFleetStateReason[] = [];
  const privacyEvents = records.filter(({ event: candidate }) =>
    candidate.event_type === "privacy_violation" || candidate.privacy.forbidden_field_count > 0);
  if (privacyEvents.length > 0) hardReasons.push("privacy_violation");
  if (unresolvedHardFailure !== undefined) hardReasons.push("runtime_failure");
  if (unresolvedEvidenceFailure?.event.outcome.evidence_delivery === "failed") {
    hardReasons.push("evidence_sink_failure");
  }

  let state: KusabiFleetTargetState;
  let stateReasons: KusabiFleetStateReason[];
  if (hardReasons.length > 0) {
    state = "failed";
    stateReasons = uniqueReasons(hardReasons);
  } else if (drift.reasons.length > 0) {
    state = "drifted";
    stateReasons = drift.reasons;
  } else if (!maintenanceActive && generatedMs - Date.parse(latest.occurred_at) > manifestTarget.stale_after_seconds * 1000) {
    state = "stale";
    stateReasons = ["stale_observation"];
  } else if (
    consecutiveDegraded >= 3 || degradationEvidence !== undefined
  ) {
    state = "degraded";
    stateReasons = uniqueReasons([
      ...(consecutiveDegraded >= 3 ? ["repeated_degradation" as const] : []),
      ...(degradationEvidence !== undefined ? ["latest_recovery_degraded" as const] : []),
    ]);
  } else {
    state = "healthy";
    stateReasons = [];
  }

  const target: KusabiFleetTargetStatus = {
    target_key: manifestTarget.target_key,
    identity: manifestTarget.identity,
    state,
    state_reasons: stateReasons,
    expected: manifestTarget.expected,
    observed,
    last_seen_at: latest.occurred_at,
    stale_after_seconds: manifestTarget.stale_after_seconds,
    event_count: records.length,
    consecutive_degraded: consecutiveDegraded,
    maintenance_active: maintenanceActive,
    evidence_refs: evidenceRefs,
  };
  const alerts: KusabiFleetAlert[] = [];
  if (privacyEvents.length > 0) {
    alerts.push(makeEventAlert(manifest, manifestTarget, "privacy_violation", "P0", privacyEvents, evidenceRefs));
  }
  if (normalizedP0Code !== null) {
    alerts.push(makeEventAlert(manifest, manifestTarget, normalizedP0Code, "P0", [unresolvedHardFailure!], evidenceRefs));
  } else if (hardReasons.includes("runtime_failure")) {
    alerts.push(makeEventAlert(manifest, manifestTarget, "runtime_failure", "P1", [unresolvedHardFailure!], evidenceRefs));
  }
  if (unresolvedEvidenceFailure !== undefined) {
    const blocking = unresolvedEvidenceFailure.event.outcome.evidence_delivery === "failed" ||
      generatedMs >= Date.parse(manifestTarget.durable_evidence_deadline_at);
    alerts.push(makeEventAlert(
      manifest,
      manifestTarget,
      "evidence_sink_failure",
      blocking ? "P1" : "P2",
      [unresolvedEvidenceFailure],
      evidenceRefs,
    ));
  }
  for (const code of drift.codes) {
    alerts.push(makeAlert(
      manifest,
      manifestTarget,
      code,
      "P1",
      alertEvidence(evidenceRefs, manifest, manifestTarget, generatedAt, records),
      latest.occurred_at,
      latest.occurred_at,
      1,
      drift.fieldsByCode.get(code)?.join(",") ?? code,
    ));
  }
  if (state === "stale") {
    alerts.push(makeAlert(
      manifest,
      manifestTarget,
      "stale_observation",
      "P2",
      alertEvidence(evidenceRefs, manifest, manifestTarget, generatedAt, records),
      latest.occurred_at,
      generatedAt,
      1,
      "stale",
    ));
  }
  if (consecutiveDegraded >= 3) {
    const degraded = records.slice(-consecutiveDegraded);
    alerts.push(makeEventAlert(manifest, manifestTarget, "repeated_degradation", "P2", degraded, evidenceRefs));
  } else if (!performanceWarning && state === "degraded" && degradationEvidence !== undefined) {
    alerts.push(makeEventAlert(manifest, manifestTarget, "isolated_degradation", "P3", [degradationEvidence], evidenceRefs));
  }
  if (performanceWarning && degradationEvidence !== undefined) {
    alerts.push(makeEventAlert(manifest, manifestTarget, "performance_warning", "P3", [degradationEvidence], evidenceRefs));
  }
  return { target, alerts };
}

function driftReasons(
  target: KusabiFleetManifestTarget,
  event: RuntimeEventDocument,
): {
  reasons: KusabiFleetStateReason[];
  codes: Array<"build_drift" | "configuration_drift" | "binding_drift" | "storage_drift">;
  fieldsByCode: Map<KusabiFleetAlertCode, string[]>;
} {
  const fieldsByCode = new Map<KusabiFleetAlertCode, string[]>();
  const add = (code: KusabiFleetAlertCode, field: string) => {
    const fields = fieldsByCode.get(code) ?? [];
    fields.push(field);
    fieldsByCode.set(code, fields);
  };
  if (event.build.commit_sha !== target.expected.build.commit_sha) add("build_drift", "commit_sha");
  if (event.build.tree_sha !== target.expected.build.tree_sha) add("build_drift", "tree_sha");
  if (event.build.artifact_sha256 !== target.expected.build.artifact_sha256) add("build_drift", "artifact_sha256");
  if (event.producer.adapter_version !== target.expected.build.adapter_version) add("build_drift", "adapter_version");
  if (event.configuration.config_sha256 !== target.expected.configuration.config_sha256) add("configuration_drift", "config_sha256");
  if (event.configuration.trust_fingerprint_sha256 !== target.expected.configuration.trust_fingerprint_sha256) add("configuration_drift", "trust_fingerprint_sha256");
  if (event.configuration.binding_source_ref_sha256 !== target.expected.configuration.binding_source_ref_sha256) add("binding_drift", "binding_source_ref_sha256");
  if (
    event.producer.agent_id !== target.identity.agent_id || event.producer.project !== target.identity.project ||
    event.producer.host_runtime !== target.identity.host_runtime || event.producer.workspace_sha256 !== target.identity.workspace_sha256
  ) add("binding_drift", "producer_identity");
  if (event.storage.backend !== target.expected.storage.backend) add("storage_drift", "backend");
  if (event.storage.binding_sha256 !== target.expected.storage.binding_sha256) add("storage_drift", "binding_sha256");

  const codes = [...fieldsByCode.keys()].sort() as Array<
    "build_drift" | "configuration_drift" | "binding_drift" | "storage_drift"
  >;
  return { reasons: codes, codes, fieldsByCode };
}

function makeEventAlert(
  manifest: KusabiFleetManifest,
  target: KusabiFleetManifestTarget,
  code: KusabiFleetAlertCode,
  severity: KusabiFleetAlertSeverity,
  records: PreparedRecord[],
  fallbackEvidence: KusabiFleetEvidenceRef[],
): KusabiFleetAlert {
  const first = records[0];
  const last = records[records.length - 1];
  const evidence = uniqueEvidence(records.flatMap(({ event }) => event.evidence_refs));
  const normalizedDefect = records.map(({ event }) => normalizedDefectKey(code, event)).sort()[0] ?? code;
  return makeAlert(
    manifest,
    target,
    code,
    severity,
    evidence.length > 0 ? evidence : fallbackEvidence,
    first.occurred_at,
    last.occurred_at,
    records.length,
    normalizedDefect,
  );
}

function makeAlert(
  manifest: KusabiFleetManifest,
  target: KusabiFleetManifestTarget,
  code: KusabiFleetAlertCode,
  severity: KusabiFleetAlertSeverity,
  evidenceRefs: KusabiFleetEvidenceRef[],
  firstSeenAt: string,
  lastSeenAt: string,
  occurrenceCount: number,
  normalizedDefect: string,
): KusabiFleetAlert {
  const fingerprint = sha256(["kusabi-alert-fingerprint/v1", code, normalizedDefect].join("\n"));
  const blocking = severity === "P0" || severity === "P1";
  const nextAction = nextActionFor(code, severity, target.target_key, fingerprint, evidenceRefs, blocking);
  return {
    alert_id: uuidv5(`${manifest.manifest_id}\n${target.target_key}\n${fingerprint}`, ALERT_NAMESPACE),
    severity,
    code,
    target_key: target.target_key,
    first_seen_at: firstSeenAt,
    last_seen_at: lastSeenAt,
    occurrence_count: Math.max(1, occurrenceCount),
    fingerprint_sha256: fingerprint,
    status: "open",
    evidence_refs: evidenceRefs.length > 0 ? evidenceRefs : [absenceEvidence(manifest, target, lastSeenAt)],
    next_action: nextAction,
  };
}

function nextActionFor(
  code: KusabiFleetAlertCode,
  severity: KusabiFleetAlertSeverity,
  targetKey: string,
  fingerprint: string,
  evidence: KusabiFleetEvidenceRef[],
  blocking: boolean,
): KusabiFleetNextAction {
  const ownerReview = severity === "P0";
  return {
    actor_agent_id: ownerReview ? "watchout" : "kusabi",
    active_function: ownerReview ? "protected_surface_gate" : "implementation_executor",
    action: ownerReview
      ? `Review the ${code} alert and decide the bounded remediation before the affected rollout advances.`
      : `Inspect the ${code} evidence and implement one bounded verified correction for the affected target.`,
    deliver_via: "kusabi_fleet_status",
    exact_input_refs: uniqueStrings([
      fingerprint,
      targetKey,
      ...evidence.flatMap((ref) => [ref.locator_sha256, ref.content_sha256]),
    ]).slice(0, 16),
    scope: "one normalized alert fingerprint and its affected manifest target",
    deliverable: "verified status correction or evidence-backed gate result",
    completion_evidence: "new schema-valid runtime event and deterministic status snapshot resolving or reclassifying this fingerprint",
    blocking,
  };
}

function normalizedDefectKey(code: KusabiFleetAlertCode, event: RuntimeEventDocument): string {
  return [
    event.schema_version,
    event.event_type,
    code,
    event.outcome.reason_code ?? "none",
    event.outcome.normalized_error_code ?? "none",
  ].join("\n");
}

function normalizedP0AlertCode(
  event: RuntimeEventDocument,
): "destructive_effect" | "data_loss_or_corruption" | "false_acceptance" | null {
  const code = event.outcome.normalized_error_code;
  if (code === "destructive_effect" || code === "data_loss_or_corruption" || code === "false_acceptance") {
    return code;
  }
  return null;
}

function observedDeployment(event: RuntimeEventDocument): KusabiFleetObservedDeployment {
  return {
    deployment: {
      build: { ...event.build, adapter_version: event.producer.adapter_version },
      configuration: event.configuration,
      storage: event.storage,
    },
    last_event_id: event.event_id,
    last_event_at: event.occurred_at,
    evidence_delivery: event.outcome.evidence_delivery,
  };
}

function consecutiveDegradationCount(records: PreparedRecord[]): number {
  if (records.length === 0) return 0;
  const latestMs = Date.parse(records[records.length - 1].occurred_at);
  let count = 0;
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index];
    if (latestMs - Date.parse(record.occurred_at) > DEGRADATION_WINDOW_MS) break;
    if (!isDegradedEvent(record.event)) break;
    count++;
  }
  return count;
}

function isDegradedEvent(event: RuntimeEventDocument): boolean {
  return event.outcome.status === "degraded" || event.outcome.evidence_delivery === "emergency_only";
}

function isRecoveryObservation(event: RuntimeEventDocument): boolean {
  return (event.event_type === "session_start" || event.event_type === "recovery_result") &&
    event.outcome.status === "full" && event.outcome.evidence_delivery === "durable";
}

function latestRecordIndexMatching(
  records: PreparedRecord[],
  predicate: (record: PreparedRecord) => boolean,
): number {
  for (let index = records.length - 1; index >= 0; index--) {
    if (predicate(records[index])) return index;
  }
  return -1;
}

function latestRecordMatching(
  records: PreparedRecord[],
  predicate: (record: PreparedRecord) => boolean,
): PreparedRecord | undefined {
  const index = latestRecordIndexMatching(records, predicate);
  return index === -1 ? undefined : records[index];
}

function summarize(targets: KusabiFleetTargetStatus[], alerts: KusabiFleetAlert[]): KusabiFleetStatusSummary {
  const count = (state: KusabiFleetTargetState) => targets.filter((target) => target.state === state).length;
  const openCount = (severity: KusabiFleetAlertSeverity) => alerts.filter((alert) =>
    alert.severity === severity && (alert.status === "open" || alert.status === "acknowledged")).length;
  const observedCount = targets.filter((target) => target.state !== "not_observed").length;
  const durableCount = targets.filter((target) => target.observed?.evidence_delivery === "durable").length;
  return {
    target_count: targets.length,
    healthy_count: count("healthy"),
    degraded_count: count("degraded"),
    failed_count: count("failed"),
    stale_count: count("stale"),
    not_observed_count: count("not_observed"),
    drifted_count: count("drifted"),
    open_p0_count: openCount("P0"),
    open_p1_count: openCount("P1"),
    open_p2_count: openCount("P2"),
    open_p3_count: openCount("P3"),
    exact_observation_rate: observedCount / targets.length,
    durable_evidence_rate: durableCount / targets.length,
  };
}

function assertSnapshotArithmetic(snapshot: KusabiFleetStatusSnapshot): void {
  const summary = snapshot.summary;
  const stateTotal = summary.healthy_count + summary.degraded_count + summary.failed_count +
    summary.stale_count + summary.not_observed_count + summary.drifted_count;
  if (
    summary.target_count !== snapshot.targets.length ||
    summary.target_count !== snapshot.manifest.target_count || stateTotal !== summary.target_count ||
    new Set(snapshot.targets.map(({ target_key }) => target_key)).size !== summary.target_count
  ) throw new KusabiFleetStatusError("KUSABI_FLEET_STATUS_ARITHMETIC_INVALID");
}

function absenceEvidence(
  manifest: KusabiFleetManifest,
  target: KusabiFleetManifestTarget,
  at: string,
): KusabiFleetEvidenceRef {
  return {
    kind: "central_store",
    locator_sha256: sha256(`kusabi-status-window\n${manifest.manifest_sha256}\n${target.target_key}`),
    content_sha256: sha256(canonicalJson({
      manifest_sha256: manifest.manifest_sha256,
      target_key: target.target_key,
      activation_at: target.activation_at,
      observed_through: at,
      event_count: 0,
    })),
  };
}

function alertEvidence(
  evidence: KusabiFleetEvidenceRef[],
  manifest: KusabiFleetManifest,
  target: KusabiFleetManifestTarget,
  at: string,
  records: PreparedRecord[],
): KusabiFleetEvidenceRef[] {
  if (evidence.length > 0) return evidence;
  if (records.length === 0) return [absenceEvidence(manifest, target, at)];
  return [{
    kind: "central_store",
    locator_sha256: sha256(`kusabi-runtime-events\n${manifest.manifest_sha256}\n${target.target_key}`),
    content_sha256: sha256(canonicalJson(records.map(({ event_id, event_sha256 }) => ({ event_id, event_sha256 })))),
  }];
}

function uniqueEvidence(evidence: KusabiFleetEvidenceRef[]): KusabiFleetEvidenceRef[] {
  const byCanonical = new Map<string, KusabiFleetEvidenceRef>();
  for (const ref of evidence) byCanonical.set(canonicalJson(ref), ref);
  return [...byCanonical.entries()].sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 16).map(([, ref]) => ref);
}

function compareAlerts(left: KusabiFleetAlert, right: KusabiFleetAlert): number {
  const severityOrder: Record<KusabiFleetAlertSeverity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return severityOrder[left.severity] - severityOrder[right.severity] ||
    left.code.localeCompare(right.code) ||
    (left.target_key ?? "").localeCompare(right.target_key ?? "") ||
    left.fingerprint_sha256.localeCompare(right.fingerprint_sha256);
}

function compareRecords(left: KusabiRuntimeEventRecord, right: KusabiRuntimeEventRecord): number {
  return left.occurred_at.localeCompare(right.occurred_at) || left.event_id.localeCompare(right.event_id);
}

function compiledFleetStatusValidator(schemaDir: string): ValidateFunction {
  const resolved = resolve(schemaDir);
  if (fleetStatusValidatorCache?.schemaDir === resolved) return fleetStatusValidatorCache.validate;
  const schema = JSON.parse(readFileSync(resolve(resolved, FLEET_STATUS_SCHEMA_FILE), "utf8")) as Record<string, unknown>;
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  fleetStatusValidatorCache = { schemaDir: resolved, validate };
  return validate;
}

function isIdentity(value: unknown): value is KusabiFleetIdentity {
  if (!isRecord(value) || !exactKeys(value, ["agent_id", "project", "host_runtime", "workspace_sha256"])) return false;
  return boundedId(value.agent_id) && boundedId(value.project) &&
    (value.host_runtime === "antigravity_cli" || value.host_runtime === "codex" || value.host_runtime === "claude_code" || value.host_runtime === "gemini_cli") &&
    sha256Value(value.workspace_sha256);
}

function isDeployment(value: unknown): value is KusabiFleetDeploymentIdentity {
  if (!isRecord(value) || !exactKeys(value, ["build", "configuration", "storage"])) return false;
  const { build, configuration, storage } = value;
  return isRecord(build) && exactKeys(build, ["commit_sha", "tree_sha", "artifact_sha256", "adapter_version"]) &&
    gitShaValue(build.commit_sha) && gitShaValue(build.tree_sha) && sha256Value(build.artifact_sha256) && boundedId(build.adapter_version) &&
    isRecord(configuration) && exactKeys(configuration, ["config_sha256", "trust_fingerprint_sha256", "binding_source_ref_sha256"]) &&
    sha256Value(configuration.config_sha256) && sha256Value(configuration.trust_fingerprint_sha256) &&
    sha256Value(configuration.binding_source_ref_sha256) &&
    isRecord(storage) && exactKeys(storage, ["backend", "binding_sha256"]) &&
    (storage.backend === "sqlite" || storage.backend === "postgres") && sha256Value(storage.binding_sha256);
}

function assertCanonicalTimestamp(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string") throw new KusabiFleetStatusError(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new KusabiFleetStatusError(code);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function uniqueReasons(values: KusabiFleetStateReason[]): KusabiFleetStateReason[] {
  return [...new Set(values)];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function boundedId(value: unknown): value is string {
  return typeof value === "string" && BOUNDED_ID_RE.test(value);
}

function sha256Value(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

function gitShaValue(value: unknown): value is string {
  return typeof value === "string" && GIT_SHA_RE.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function rate(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new KusabiFleetStatusError("KUSABI_FLEET_STATUS_NON_FINITE_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value)) throw new KusabiFleetStatusError("KUSABI_FLEET_STATUS_NON_JSON_VALUE");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
