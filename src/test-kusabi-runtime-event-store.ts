import { createHash } from "crypto";
import {
  canonicalKusabiRuntimeEvent,
  ingestKusabiRuntimeEvent,
  KusabiRuntimeEventConflictError,
  kusabiRuntimeEventSha256,
  validateKusabiRuntimeEvent,
} from "./kusabi-runtime-event-store.js";
import type {
  KusabiRuntimeEventDocument,
  KusabiRuntimeEventRecord,
  Store,
} from "./stores/types.js";

export const OBS02_PARITY_MANIFEST_ID = "kusabi-obs02-parity-v1";
export const OBS02_PARITY_TARGET_KEY = createHash("sha256")
  .update("kusabi-obs02-parity-target")
  .digest("hex");

type AssertFn = (condition: boolean, message: string) => void;

export interface KusabiRuntimeEventContractResult {
  normalized_records: Array<Omit<KusabiRuntimeEventRecord, "ingested_at">>;
  normalized_sha256: string;
}

export function kusabiRuntimeEventFixture(
  eventId = "00000000-0000-4000-8000-000000000201",
  eventType: KusabiRuntimeEventDocument["event_type"] = "recovery_result",
  occurredAt = "2026-07-29T00:00:01.000Z",
): KusabiRuntimeEventDocument {
  const h = "a".repeat(64);
  return {
    schema_version: "kusabi-runtime-event/v1",
    event_id: eventId,
    event_type: eventType,
    occurred_at: occurredAt,
    manifest_id: OBS02_PARITY_MANIFEST_ID,
    target_key: OBS02_PARITY_TARGET_KEY,
    producer: {
      agent_id: "kusabi",
      project: "agent-memory",
      host_runtime: "codex",
      adapter_id: "wasurezu-codex-session-start",
      adapter_version: "1.0.0",
      workspace_sha256: h,
      session_ref_sha256: null,
    },
    build: {
      commit_sha: "b".repeat(40),
      tree_sha: "c".repeat(40),
      artifact_sha256: "d".repeat(64),
    },
    configuration: {
      config_sha256: "e".repeat(64),
      trust_fingerprint_sha256: "f".repeat(64),
      binding_source_ref_sha256: "1".repeat(64),
    },
    storage: {
      backend: "sqlite",
      binding_sha256: "2".repeat(64),
    },
    outcome: {
      status: "full",
      reason_code: null,
      elapsed_ms: 12,
      evidence_delivery: "durable",
      normalized_error_code: null,
      error_fingerprint_sha256: null,
    },
    health: {
      recovered_tokens: 180,
      task_continued: true,
      recovery_quality_score: 0.95,
      search_memory_count_10min: 0,
    },
    privacy: {
      policy_version: "kusabi-observability-v1",
      redaction_count: 0,
      forbidden_field_count: 0,
    },
    evidence_refs: [
      {
        kind: "local_store",
        locator_sha256: "3".repeat(64),
        content_sha256: "4".repeat(64),
      },
    ],
  };
}

export async function runKusabiRuntimeEventStoreContract(
  store: Store,
  assert: AssertFn,
  label: string,
): Promise<KusabiRuntimeEventContractResult> {
  const first = kusabiRuntimeEventFixture();
  const second = kusabiRuntimeEventFixture(
    "00000000-0000-4000-8000-000000000202",
    "heartbeat",
    "2026-07-29T00:00:02.000Z",
  );

  const validation = validateKusabiRuntimeEvent(first);
  assert(validation.valid, `${label}: canonical runtime event passes strict schema validation`);
  const invalid = structuredClone(first) as Record<string, unknown>;
  invalid.prompt = "must never be stored";
  assert(
    !validateKusabiRuntimeEvent(invalid).valid,
    `${label}: unknown/privacy-bearing top-level fields are rejected`,
  );

  const reordered = Object.fromEntries(Object.entries(first).reverse());
  assert(
    canonicalKusabiRuntimeEvent(first) === canonicalKusabiRuntimeEvent(reordered),
    `${label}: canonical serialization is independent of object key order`,
  );

  const inserted = await ingestKusabiRuntimeEvent(store, first);
  assert(inserted.evidence_delivery === "durable", `${label}: committed insert returns durable ACK`);
  assert(inserted.inserted, `${label}: first event insert reports inserted=true`);
  assert(inserted.record?.event_sha256 === kusabiRuntimeEventSha256(first), `${label}: stored event hash matches canonical bytes`);

  const duplicate = await ingestKusabiRuntimeEvent(store, structuredClone(first));
  assert(duplicate.evidence_delivery === "durable", `${label}: exact duplicate remains durable`);
  assert(!duplicate.inserted, `${label}: exact duplicate is idempotent by event_id`);
  assert(duplicate.record?.event_sha256 === inserted.record?.event_sha256, `${label}: duplicate returns the original identity`);

  const conflicting = structuredClone(first);
  (conflicting.health as Record<string, unknown>).recovered_tokens = 181;
  let conflictRejected = false;
  try {
    await store.saveKusabiRuntimeEvent({
      event: conflicting,
      event_sha256: kusabiRuntimeEventSha256(conflicting),
    });
  } catch (error) {
    conflictRejected = error instanceof KusabiRuntimeEventConflictError;
  }
  assert(conflictRejected, `${label}: same event_id with different canonical bytes is rejected`);

  const conflictEmergencyLines: string[] = [];
  const conflictEmergency = await ingestKusabiRuntimeEvent(store, conflicting, {
    writeEmergency: (line) => conflictEmergencyLines.push(line),
  });
  assert(
    conflictEmergency.evidence_delivery === "emergency_only" &&
      conflictEmergency.emergency?.normalized_error_code === "event_id_conflict",
    `${label}: ingest normalizes event_id conflict into privacy-safe emergency evidence`,
  );
  assert(
    conflictEmergencyLines.length === 1 && !conflictEmergencyLines[0].includes("recovered_tokens"),
    `${label}: conflict emergency evidence excludes the conflicting payload`,
  );

  const secondInsert = await ingestKusabiRuntimeEvent(store, second);
  assert(secondInsert.evidence_delivery === "durable" && secondInsert.inserted, `${label}: second event commits durably`);

  const records = await store.getKusabiRuntimeEvents({
    manifest_id: OBS02_PARITY_MANIFEST_ID,
    target_key: OBS02_PARITY_TARGET_KEY,
    since: "2026-07-29T00:00:00.000Z",
    limit: 10,
  });
  assert(records.length === 2, `${label}: duplicate delivery does not change event count`);
  assert(records[0]?.event_id === second.event_id, `${label}: query ordering is deterministic newest-first`);
  const heartbeat = await store.getKusabiRuntimeEvents({ event_type: "heartbeat", limit: 10 });
  assert(heartbeat.some((record) => record.event_id === second.event_id), `${label}: event_type filter returns the matching event`);

  const emergencyLines: string[] = [];
  const failingStore = {
    backend: "sqlite",
    saveKusabiRuntimeEvent: async () => {
      throw new Error("postgresql://secret@private.invalid/db /Users/private stack");
    },
  } as unknown as Store;
  const emergency = await ingestKusabiRuntimeEvent(failingStore, first, {
    writeEmergency: (line) => emergencyLines.push(line),
  });
  assert(emergency.evidence_delivery === "emergency_only", `${label}: write failure produces bounded emergency evidence`);
  assert(emergencyLines.length === 1 && Buffer.byteLength(emergencyLines[0], "utf8") <= 1024, `${label}: emergency evidence is one bounded JSON line`);
  assert(
    !/postgres|secret|private|Users|stack/i.test(emergencyLines[0]),
    `${label}: emergency evidence excludes raw errors, paths, credentials, and DB URLs`,
  );
  const failed = await ingestKusabiRuntimeEvent(failingStore, first, {
    writeEmergency: () => {
      throw new Error("stderr unavailable");
    },
  });
  assert(failed.evidence_delivery === "failed", `${label}: dual durable/emergency failure reports failed without throwing`);

  const normalizedRecords = records.map(({ ingested_at: _ingestedAt, ...record }) => record);
  const normalizedSha256 = createHash("sha256")
    .update(canonicalKusabiRuntimeEvent(normalizedRecords))
    .digest("hex");
  console.log(`  ℹ️  ${label}: OBS02_NORMALIZED_SHA256=${normalizedSha256}`);
  return { normalized_records: normalizedRecords, normalized_sha256: normalizedSha256 };
}

export async function runKusabiRuntimeEventJsonFixtureContract(
  store: Store,
  assert: AssertFn,
): Promise<void> {
  const event = kusabiRuntimeEventFixture(
    "00000000-0000-4000-8000-000000000203",
    "session_start",
    "2026-07-29T00:00:03.000Z",
  );
  const saved = await store.saveKusabiRuntimeEvent({
    event,
    event_sha256: kusabiRuntimeEventSha256(event),
  });
  assert(saved.inserted, "JSON fixture store can persist deterministic test records directly");

  const emergencyLines: string[] = [];
  const result = await ingestKusabiRuntimeEvent(store, event, {
    writeEmergency: (line) => emergencyLines.push(line),
  });
  assert(
    result.evidence_delivery === "emergency_only" &&
      result.emergency?.normalized_error_code === "json_fixture_only",
    "JSON backend is never acknowledged as durable observability evidence",
  );
  const records = await store.getKusabiRuntimeEvents({ limit: 10 });
  assert(records.length === 1, "JSON ingest refusal does not mutate the deterministic fixture ledger");
  assert(
    emergencyLines.length === 1 && Buffer.byteLength(emergencyLines[0], "utf8") <= 1024,
    "JSON fixture-only refusal emits one bounded emergency record",
  );
}
