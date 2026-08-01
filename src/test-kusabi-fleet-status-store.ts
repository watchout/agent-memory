import { createHash } from "node:crypto";
import { ingestKusabiRuntimeEvent, kusabiRuntimeEventSha256, validateKusabiRuntimeEvent } from "./kusabi-runtime-event-store.js";
import {
  deriveKusabiFleetStatusFromStore,
  kusabiFleetManifestSha256,
  kusabiFleetTargetKey,
  type KusabiFleetManifest,
  type KusabiHostRuntime,
} from "./kusabi-fleet-status.js";
import type { KusabiRuntimeEventDocument, KusabiRuntimeEventRecord, Store } from "./stores/types.js";

const GENERATED_AT = "2026-07-30T00:01:00.000Z";

export interface FleetFixtureManifestOptions {
  backend?: "sqlite" | "postgres";
  hostRuntime?: KusabiHostRuntime;
  agentId?: string;
  manifestId?: string;
  maintenanceWindows?: Array<{ started_at: string; ended_at: string }>;
}

export interface FleetFixtureEventOptions {
  eventId?: string;
  eventType?: KusabiRuntimeEventDocument["event_type"];
  occurredAt?: string;
  status?: "full" | "degraded" | "failed" | "not_applicable";
  reasonCode?: string | null;
  evidenceDelivery?: "durable" | "emergency_only" | "failed";
  normalizedErrorCode?: string | null;
  forbiddenFieldCount?: number;
}

export function kusabiFleetStatusFixtureManifest(
  options: FleetFixtureManifestOptions = {},
): KusabiFleetManifest {
  const backend = options.backend ?? "sqlite";
  const hostRuntime = options.hostRuntime ?? "codex";
  const identity = {
    agent_id: options.agentId ?? `kusabi-${hostRuntime}`,
    project: "agent-memory",
    host_runtime: hostRuntime,
    workspace_sha256: digest(`workspace:${options.agentId ?? hostRuntime}`),
  };
  const target = {
    target_key: kusabiFleetTargetKey(identity),
    identity,
    expected: {
      build: {
        commit_sha: "1".repeat(40),
        tree_sha: "2".repeat(40),
        artifact_sha256: digest("artifact:v1"),
        adapter_version: "1.0.0",
      },
      configuration: {
        config_sha256: digest("config:v1"),
        trust_fingerprint_sha256: digest("trust:v1"),
        binding_source_ref_sha256: digest("binding:v1"),
      },
      storage: {
        backend,
        binding_sha256: digest(`store-binding:${backend}`),
      },
    },
    activation_at: "2026-07-30T00:00:00.000Z",
    durable_evidence_deadline_at: "2026-07-30T00:05:00.000Z",
    stale_after_seconds: 120,
    maintenance_windows: options.maintenanceWindows ?? [],
  };
  const manifest: KusabiFleetManifest = {
    schema_version: "kusabi-fleet-manifest/v1",
    manifest_id: options.manifestId ?? "kusabi-alpha-fixture",
    version: 1,
    manifest_sha256: "0".repeat(64),
    targets: [target],
  };
  return sealKusabiFleetStatusFixtureManifest(manifest);
}

export function sealKusabiFleetStatusFixtureManifest(
  manifest: KusabiFleetManifest,
): KusabiFleetManifest {
  manifest.manifest_sha256 = kusabiFleetManifestSha256(manifest);
  return manifest;
}

export function kusabiFleetStatusFixtureEvent(
  manifest: KusabiFleetManifest,
  options: FleetFixtureEventOptions = {},
): KusabiRuntimeEventDocument {
  const target = manifest.targets[0];
  const status = options.status ?? "full";
  const eventType = options.eventType ?? "recovery_result";
  const evidenceDelivery = options.evidenceDelivery ?? "durable";
  const reasonCode = options.reasonCode !== undefined
    ? options.reasonCode
    : status === "full" || status === "not_applicable" ? null
    : eventType === "privacy_violation" ? "privacy_forbidden_field"
    : evidenceDelivery === "failed" ? "evidence_sink_write_failed"
    : status === "degraded" ? "recovery_incomplete" : "runtime_exception";
  const normalizedErrorCode = options.normalizedErrorCode !== undefined
    ? options.normalizedErrorCode
    : status === "full" || status === "not_applicable" ? null : "normalized_fixture_error";
  const errorFingerprint = status === "full" || status === "not_applicable"
    ? null
    : digest([
      "kusabi-runtime-event/v1",
      eventType,
      target.identity.host_runtime,
      target.expected.build.adapter_version,
      reasonCode,
      normalizedErrorCode,
    ].join("\n"));
  const event = {
    schema_version: "kusabi-runtime-event/v1",
    event_id: options.eventId ?? "00000000-0000-4000-8000-000000000101",
    event_type: eventType,
    occurred_at: options.occurredAt ?? "2026-07-30T00:00:30.000Z",
    manifest_id: manifest.manifest_id,
    target_key: target.target_key,
    producer: {
      ...target.identity,
      adapter_id: `wasurezu-${target.identity.host_runtime}-session-start`,
      adapter_version: target.expected.build.adapter_version,
      session_ref_sha256: null,
    },
    build: {
      commit_sha: target.expected.build.commit_sha,
      tree_sha: target.expected.build.tree_sha,
      artifact_sha256: target.expected.build.artifact_sha256,
    },
    configuration: structuredClone(target.expected.configuration),
    storage: structuredClone(target.expected.storage),
    outcome: {
      status,
      reason_code: reasonCode,
      elapsed_ms: 25,
      evidence_delivery: evidenceDelivery,
      normalized_error_code: normalizedErrorCode,
      error_fingerprint_sha256: errorFingerprint,
    },
    health: {
      recovered_tokens: status === "not_applicable" ? null : 1200,
      task_continued: status === "not_applicable" ? null : status === "full",
      recovery_quality_score: status === "not_applicable" ? null : status === "full" ? 1 : 0.5,
      search_memory_count_10min: status === "not_applicable" ? null : 0,
    },
    privacy: {
      policy_version: "kusabi-observability-redaction:v1",
      redaction_count: 0,
      forbidden_field_count: options.forbiddenFieldCount ?? 0,
    },
    evidence_refs: [{
      kind: "run",
      locator_sha256: digest(`locator:${options.eventId ?? "101"}`),
      content_sha256: digest(`content:${options.eventId ?? "101"}`),
    }],
  } as KusabiRuntimeEventDocument;
  const validation = validateKusabiRuntimeEvent(event);
  if (!validation.valid) throw new Error(`INVALID_FLEET_FIXTURE:${validation.errors.join("|")}`);
  return event;
}

export function kusabiFleetStatusFixtureRecord(
  event: KusabiRuntimeEventDocument,
): KusabiRuntimeEventRecord {
  return {
    event_id: event.event_id,
    manifest_id: event.manifest_id,
    target_key: event.target_key,
    event_type: event.event_type,
    occurred_at: event.occurred_at,
    event_sha256: kusabiRuntimeEventSha256(event),
    event,
    ingested_at: event.occurred_at,
  };
}

export async function runKusabiFleetStatusStoreContract(
  store: Store,
  assert: (condition: boolean, message: string) => void,
  backendName: "SQLite" | "PostgreSQL",
): Promise<{ normalized_sha256: string }> {
  if (store.backend !== "sqlite" && store.backend !== "postgres") {
    throw new Error("KUSABI_FLEET_STATUS_STORE_CONTRACT_DURABLE_BACKEND_REQUIRED");
  }
  const manifest = kusabiFleetStatusFixtureManifest({
    backend: store.backend,
    manifestId: "kusabi-alpha-store-parity",
  });
  const event = kusabiFleetStatusFixtureEvent(manifest);
  const ingested = await ingestKusabiRuntimeEvent(store, event);
  assert(ingested.evidence_delivery === "durable", `${backendName} status fixture is durably ingested`);
  const snapshot = await deriveKusabiFleetStatusFromStore(store, manifest, { generatedAt: GENERATED_AT });
  assert(snapshot.targets.length === 1, `${backendName} status derives exactly one manifest target`);
  assert(snapshot.targets[0].state === "healthy", `${backendName} status derives healthy from exact fresh evidence`);
  assert(snapshot.summary.healthy_count === 1 && snapshot.summary.target_count === 1,
    `${backendName} status summary arithmetic is exact`);
  assert(snapshot.alerts.length === 0 && snapshot.next_action === "none",
    `${backendName} healthy status has no alert or next action`);
  const normalized = {
    target_states: snapshot.targets.map(({ state, state_reasons, event_count, consecutive_degraded }) =>
      ({ state, state_reasons, event_count, consecutive_degraded })),
    summary: snapshot.summary,
    alerts: snapshot.alerts.map(({ severity, code, status, next_action }) =>
      ({ severity, code, status, blocking: next_action === "none" ? null : next_action.blocking })),
  };
  return { normalized_sha256: digest(canonical(normalized)) };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
