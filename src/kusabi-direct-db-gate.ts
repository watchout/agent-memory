import { createHash } from "node:crypto";
import {
  kusabiRuntimeEventSha256,
  validateKusabiRuntimeEvent,
} from "./kusabi-runtime-event-store.js";
import type {
  KusabiFleetManifest,
  KusabiFleetStatusSnapshot,
} from "./kusabi-fleet-status.js";

const SHA256_RE = /^[a-f0-9]{64}$/;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_EVENT_ROWS = 500;
const MAX_QUALITY_ROWS = 2_000;
const MAX_RAW_ROWS = 5_000;

export interface KusabiDirectGateDatabase {
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export interface KusabiDirectDbTargetProof {
  target_key: string;
  t0_event_id: string;
  t0_event_sha256: string;
  t0_ingested_at: string;
  t0_session_ref_sha256: string;
  t0_quality_locator_sha256: string;
  t0_raw_event_count: number;
  t1_event_id: string | null;
  t1_event_sha256: string | null;
  t1_ingested_at: string | null;
  t1_session_ref_sha256: string | null;
  t1_quality_locator_sha256: string | null;
  t1_raw_event_count: number | null;
}

export interface KusabiDirectDbGateProof {
  schema_version: "kusabi-direct-db-gate-proof/v1";
  manifest_id: string;
  batch_id: string;
  minimum_soak_seconds: number;
  target_count: number;
  database_window_start: string;
  database_window_end: string;
  elapsed_seconds: number;
  status_event_count: number;
  targets: KusabiDirectDbTargetProof[];
  proof_sha256: string;
}

interface EventRow {
  event_id: string;
  target_key: string;
  event_sha256: string;
  event_json: unknown;
  ingested_at: string | Date;
}

interface QualityRow {
  quality_id: string;
  agent_id: string;
  session_id: string | null;
  notes: string | null;
  created_at: string | Date;
}

interface RawRow {
  agent_id: string;
  session_id: string | null;
  project: string | null;
  host: string;
  source: string;
  source_ref: unknown;
  source_ref_hash: string;
  source_event_id: string | null;
  source_path: string | null;
  redaction_level: string;
  private_reasoning: boolean;
}

interface VerifiedEvent {
  row: EventRow;
  ingestedAt: string;
  sessionRefSha256: string;
  qualityLocatorSha256: string;
  rawEventCount: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().flatMap((key) =>
      source[key] === undefined ? [] : [[key, canonicalValue(source[key])]]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value: string | Date, code: string): string {
  const result = value instanceof Date ? value.toISOString() : value;
  if (typeof result !== "string" || !Number.isFinite(Date.parse(result))) throw new Error(code);
  return new Date(result).toISOString();
}

function exactJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function parseAutoReceive(notes: string | null): { captured: boolean; eventCount: number } {
  if (typeof notes !== "string") return { captured: false, eventCount: 0 };
  try {
    const parsed: unknown = JSON.parse(notes);
    if (!isRecord(parsed) || !isRecord(parsed.auto_receive)) return { captured: false, eventCount: 0 };
    const auto = parsed.auto_receive;
    const saved = typeof auto.events_saved === "number" && Number.isInteger(auto.events_saved) ? auto.events_saved : 0;
    const duplicate = typeof auto.events_duplicate === "number" && Number.isInteger(auto.events_duplicate)
      ? auto.events_duplicate : 0;
    return {
      captured: auto.status === "captured" && auto.reason === "captured" && saved + duplicate > 0,
      eventCount: Math.max(0, saved + duplicate),
    };
  } catch {
    return { captured: false, eventCount: 0 };
  }
}

function rawMatches(row: RawRow, target: KusabiFleetManifest["targets"][number], sessionId: string): boolean {
  if (row.agent_id !== target.identity.agent_id || row.session_id !== sessionId ||
    row.project !== target.identity.project || row.host !== target.identity.host_runtime ||
    row.source !== target.identity.host_runtime || row.redaction_level !== "complete" ||
    row.private_reasoning !== false || typeof row.source_event_id !== "string" || row.source_event_id.length === 0 ||
    typeof row.source_path !== "string" || row.source_path.length === 0 || !SHA256_RE.test(row.source_ref_hash) ||
    !isRecord(row.source_ref)) return false;
  const expectedSourceRef = {
    source: target.identity.host_runtime,
    source_event_id: row.source_event_id,
    source_path: row.source_path,
  };
  return exactJson(row.source_ref, expectedSourceRef) && row.source_ref_hash === sha256(JSON.stringify(expectedSourceRef));
}

function eventMatchesTarget(value: unknown, target: KusabiFleetManifest["targets"][number]): value is Record<string, unknown> {
  if (!isRecord(value) || !validateKusabiRuntimeEvent(value).valid || value.event_type !== "session_start" ||
    value.target_key !== target.target_key || !isRecord(value.producer) || !isRecord(value.outcome) ||
    !isRecord(value.privacy) || !Array.isArray(value.evidence_refs)) return false;
  const expectedProducer = target.identity;
  const producer = value.producer;
  const deployment = {
    build: isRecord(value.build) ? { ...value.build, adapter_version: producer.adapter_version } : value.build,
    configuration: value.configuration,
    storage: value.storage,
  };
  return producer.agent_id === expectedProducer.agent_id && producer.project === expectedProducer.project &&
    producer.host_runtime === expectedProducer.host_runtime &&
    producer.workspace_sha256 === expectedProducer.workspace_sha256 &&
    exactJson(deployment, target.expected) && value.outcome.status === "full" &&
    value.outcome.evidence_delivery === "durable" && value.privacy.forbidden_field_count === 0;
}

function sealProof(value: Omit<KusabiDirectDbGateProof, "proof_sha256">): KusabiDirectDbGateProof {
  return { ...value, proof_sha256: sha256(canonicalJson(value)) };
}

export async function verifyKusabiDirectDbGate(input: {
  database: KusabiDirectGateDatabase;
  manifest: KusabiFleetManifest;
  batch_id: string;
  batch_target_keys: string[];
  placed_target_keys: string[];
  minimum_soak_seconds: number;
  status: KusabiFleetStatusSnapshot;
}): Promise<KusabiDirectDbGateProof> {
  if (!Number.isInteger(input.minimum_soak_seconds) || input.minimum_soak_seconds < 0 ||
    input.batch_target_keys.length === 0 || new Set(input.batch_target_keys).size !== input.batch_target_keys.length ||
    new Set(input.placed_target_keys).size !== input.placed_target_keys.length) {
    throw new Error("KUSABI_DIRECT_DB_GATE_INPUT_INVALID");
  }
  const targetByKey = new Map(input.manifest.targets.map((target) => [target.target_key, target]));
  if (input.batch_target_keys.some((key) => !targetByKey.has(key)) ||
    input.placed_target_keys.some((key) => !targetByKey.has(key))) throw new Error("KUSABI_DIRECT_DB_GATE_INPUT_INVALID");
  const statusByKey = new Map(input.status.targets.map((target) => [target.target_key, target]));
  const statusEventIds = input.placed_target_keys.map((key) => statusByKey.get(key)?.observed?.last_event_id ?? "");
  if (statusEventIds.some((id) => !UUID_RE.test(id))) throw new Error("KUSABI_DIRECT_DB_GATE_STATUS_UNBOUND");

  let began = false;
  try {
    await input.database.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    began = true;
    const eventResult = await input.database.query<EventRow>(`
      SELECT event_id::text, target_key, event_sha256, event_json, ingested_at
      FROM kusabi_runtime_events
      WHERE manifest_id = $1
        AND target_key = ANY($2::text[])
      ORDER BY ingested_at ASC, event_id ASC
      LIMIT ${MAX_EVENT_ROWS + 1}
    `, [input.manifest.manifest_id, input.placed_target_keys]);
    if (eventResult.rows.length > MAX_EVENT_ROWS) throw new Error("KUSABI_DIRECT_DB_GATE_EVENT_LIMIT");

    const agentIds = [...new Set(input.batch_target_keys.map((key) => targetByKey.get(key)!.identity.agent_id))];
    const qualityResult = await input.database.query<QualityRow>(`
      SELECT id::text AS quality_id, agent_id, session_id, notes, created_at
      FROM recovery_quality_log
      WHERE agent_id = ANY($1::text[])
      ORDER BY created_at DESC, id DESC
      LIMIT ${MAX_QUALITY_ROWS + 1}
    `, [agentIds]);
    if (qualityResult.rows.length > MAX_QUALITY_ROWS) throw new Error("KUSABI_DIRECT_DB_GATE_QUALITY_LIMIT");

    const sessionIds = [...new Set(qualityResult.rows.flatMap(({ session_id }) =>
      typeof session_id === "string" && session_id.length > 0 ? [session_id] : []))];
    const rawResult = sessionIds.length === 0 ? { rows: [] as RawRow[] } : await input.database.query<RawRow>(`
      SELECT agent_id, session_id, project, host, source, source_ref, source_ref_hash,
             source_event_id, source_path, redaction_level, private_reasoning
      FROM raw_events
      WHERE agent_id = ANY($1::text[])
        AND session_id = ANY($2::text[])
      ORDER BY ingested_at DESC, id DESC
      LIMIT ${MAX_RAW_ROWS + 1}
    `, [agentIds, sessionIds]);
    if (rawResult.rows.length > MAX_RAW_ROWS) throw new Error("KUSABI_DIRECT_DB_GATE_RAW_LIMIT");
    await input.database.query("COMMIT");
    began = false;

    const eventById = new Map(eventResult.rows.map((row) => [row.event_id, row]));
    for (const row of eventResult.rows) {
      const event = row.event_json;
      if (!UUID_RE.test(row.event_id) || !SHA256_RE.test(row.event_sha256) || !isRecord(event) ||
        !validateKusabiRuntimeEvent(event).valid || event.event_id !== row.event_id ||
        event.target_key !== row.target_key || event.manifest_id !== input.manifest.manifest_id ||
        row.event_sha256 !== kusabiRuntimeEventSha256(event as never)) {
        throw new Error("KUSABI_DIRECT_DB_GATE_RUNTIME_EVENT_INVALID");
      }
      if (!input.batch_target_keys.includes(row.target_key)) continue;
      const outcome = isRecord(event.outcome) ? event.outcome : {};
      if (event.event_type === "runtime_error" || event.event_type === "evidence_sink_error" ||
        event.event_type === "privacy_violation" || outcome.status === "degraded" || outcome.status === "failed" ||
        outcome.evidence_delivery === "failed" || outcome.evidence_delivery === "emergency_only") {
        throw new Error(`KUSABI_DIRECT_DB_GATE_INTERVENING_FAILURE:${row.target_key}`);
      }
    }
    for (let index = 0; index < input.placed_target_keys.length; index++) {
      const targetKey = input.placed_target_keys[index];
      const statusTarget = statusByKey.get(targetKey);
      const row = eventById.get(statusEventIds[index]);
      const target = targetByKey.get(targetKey)!;
      if (!statusTarget || statusTarget.state !== "healthy" || statusTarget.observed === null || !row ||
        row.target_key !== targetKey || !eventMatchesTarget(row.event_json, target) ||
        row.event_sha256 !== kusabiRuntimeEventSha256(row.event_json as never) ||
        !exactJson(statusTarget.observed.deployment, target.expected) ||
        statusTarget.observed.evidence_delivery !== "durable" ||
        statusTarget.observed.last_event_at !== (row.event_json as Record<string, unknown>).occurred_at ||
        statusTarget.last_seen_at !== (row.event_json as Record<string, unknown>).occurred_at) {
        throw new Error("KUSABI_DIRECT_DB_GATE_STATUS_UNBOUND");
      }
    }

    const qualityByLocator = new Map<string, Array<{ row: QualityRow; eventCount: number }>>();
    for (const row of qualityResult.rows) {
      if (!UUID_RE.test(row.quality_id) || typeof row.session_id !== "string" || row.session_id.length === 0) continue;
      const auto = parseAutoReceive(row.notes);
      if (!auto.captured) continue;
      const locator = sha256(`recovery_quality_log:${row.quality_id}`);
      const entries = qualityByLocator.get(locator) ?? [];
      entries.push({ row, eventCount: auto.eventCount });
      qualityByLocator.set(locator, entries);
    }

    const validByTarget = new Map<string, VerifiedEvent[]>();
    for (const row of eventResult.rows) {
      if (!input.batch_target_keys.includes(row.target_key)) continue;
      const target = targetByKey.get(row.target_key)!;
      if (!UUID_RE.test(row.event_id) || !SHA256_RE.test(row.event_sha256) ||
        !eventMatchesTarget(row.event_json, target) || row.event_sha256 !== kusabiRuntimeEventSha256(row.event_json as never)) continue;
      const event = row.event_json as Record<string, unknown>;
      const producer = event.producer as Record<string, unknown>;
      const sessionRef = producer.session_ref_sha256;
      const localRefs = (event.evidence_refs as unknown[]).filter((ref): ref is Record<string, unknown> =>
        isRecord(ref) && ref.kind === "local_store" && typeof ref.locator_sha256 === "string");
      if (typeof sessionRef !== "string" || !SHA256_RE.test(sessionRef) || localRefs.length !== 1) continue;
      const locator = String(localRefs[0].locator_sha256);
      const qualities = qualityByLocator.get(locator) ?? [];
      const quality = qualities.find(({ row: qualityRow }) => qualityRow.agent_id === target.identity.agent_id &&
        typeof qualityRow.session_id === "string" && sha256(qualityRow.session_id) === sessionRef);
      if (!quality || typeof quality.row.session_id !== "string") continue;
      const raws = rawResult.rows.filter((raw) => rawMatches(raw, target, quality.row.session_id!));
      if (raws.length === 0) continue;
      const items = validByTarget.get(row.target_key) ?? [];
      items.push({
        row,
        ingestedAt: timestamp(row.ingested_at, "KUSABI_DIRECT_DB_GATE_TIME_INVALID"),
        sessionRefSha256: sessionRef,
        qualityLocatorSha256: locator,
        rawEventCount: raws.length,
      });
      validByTarget.set(row.target_key, items);
    }

    const t0ByTarget = new Map<string, VerifiedEvent>();
    for (const targetKey of input.batch_target_keys) {
      const candidates = (validByTarget.get(targetKey) ?? []).sort((left, right) =>
        Date.parse(left.ingestedAt) - Date.parse(right.ingestedAt) || left.row.event_id.localeCompare(right.row.event_id));
      if (candidates.length === 0) throw new Error(`KUSABI_DIRECT_DB_GATE_AUTO_RECEIVE_MISSING:${targetKey}`);
      t0ByTarget.set(targetKey, candidates[0]);
    }
    const windowStartMs = Math.max(...[...t0ByTarget.values()].map((item) => Date.parse(item.ingestedAt)));
    const minimumEndMs = windowStartMs + input.minimum_soak_seconds * 1_000;
    const t1ByTarget = new Map<string, VerifiedEvent>();
    for (const targetKey of input.batch_target_keys) {
      if (input.minimum_soak_seconds === 0) continue;
      const t0 = t0ByTarget.get(targetKey)!;
      const candidate = (validByTarget.get(targetKey) ?? []).find((item) =>
        item.sessionRefSha256 !== t0.sessionRefSha256 && Date.parse(item.ingestedAt) >= minimumEndMs);
      if (!candidate) throw new Error(`KUSABI_DIRECT_DB_GATE_SOAK_INCOMPLETE:${targetKey}`);
      t1ByTarget.set(targetKey, candidate);
    }
    const windowEndMs = input.minimum_soak_seconds === 0
      ? windowStartMs
      : Math.min(...[...t1ByTarget.values()].map((item) => Date.parse(item.ingestedAt)));
    if (windowEndMs < minimumEndMs) throw new Error("KUSABI_DIRECT_DB_GATE_SOAK_INCOMPLETE");

    const targets = input.batch_target_keys.slice().sort().map((targetKey) => {
      const t0 = t0ByTarget.get(targetKey)!;
      const t1 = t1ByTarget.get(targetKey) ?? null;
      return {
        target_key: targetKey,
        t0_event_id: t0.row.event_id,
        t0_event_sha256: t0.row.event_sha256,
        t0_ingested_at: t0.ingestedAt,
        t0_session_ref_sha256: t0.sessionRefSha256,
        t0_quality_locator_sha256: t0.qualityLocatorSha256,
        t0_raw_event_count: t0.rawEventCount,
        t1_event_id: t1?.row.event_id ?? null,
        t1_event_sha256: t1?.row.event_sha256 ?? null,
        t1_ingested_at: t1?.ingestedAt ?? null,
        t1_session_ref_sha256: t1?.sessionRefSha256 ?? null,
        t1_quality_locator_sha256: t1?.qualityLocatorSha256 ?? null,
        t1_raw_event_count: t1?.rawEventCount ?? null,
      };
    });
    return sealProof({
      schema_version: "kusabi-direct-db-gate-proof/v1",
      manifest_id: input.manifest.manifest_id,
      batch_id: input.batch_id,
      minimum_soak_seconds: input.minimum_soak_seconds,
      target_count: targets.length,
      database_window_start: new Date(windowStartMs).toISOString(),
      database_window_end: new Date(windowEndMs).toISOString(),
      elapsed_seconds: Math.floor((windowEndMs - windowStartMs) / 1_000),
      status_event_count: statusEventIds.length,
      targets,
    });
  } catch (error) {
    if (began) await input.database.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
