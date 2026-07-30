import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { defaultSchemaDir } from "./artifact-schema-validator.js";
import type {
  KusabiRuntimeEventDocument,
  KusabiRuntimeEventRecord,
  SaveKusabiRuntimeEventResult,
  Store,
} from "./stores/types.js";

const SCHEMA_FILE = "kusabi-runtime-event-v1.schema.json";
const SHA256_RE = /^[a-f0-9]{64}$/;
const MAX_EMERGENCY_BYTES = 1024;

export interface KusabiRuntimeEventValidationResult {
  valid: boolean;
  errors: string[];
}

export interface KusabiEmergencyEvidence {
  schema_version: "kusabi-emergency-evidence/v1";
  event_id: string;
  event_type: string;
  occurred_at: string;
  manifest_id: string;
  target_key: string;
  event_sha256: string;
  reason_code: "evidence_sink_unavailable" | "evidence_sink_write_failed";
  normalized_error_code:
    | "json_fixture_only"
    | "event_id_conflict"
    | "store_write_failed"
    | "store_unavailable"
    | "backend_drift"
    | "target_invalid";
}

export interface KusabiRuntimeEventIngestResult {
  evidence_delivery: "durable" | "emergency_only" | "failed";
  inserted: boolean;
  record: KusabiRuntimeEventRecord | null;
  emergency: KusabiEmergencyEvidence | null;
}

export interface KusabiRuntimeEventIngestOptions {
  schemaDir?: string;
  writeEmergency?: (line: string) => void;
}

export class KusabiRuntimeEventValidationError extends Error {
  readonly code = "KUSABI_RUNTIME_EVENT_INVALID";
  readonly validationErrors: string[];

  constructor(errors: string[]) {
    super(`KUSABI_RUNTIME_EVENT_INVALID: ${errors.join("; ")}`);
    this.name = "KusabiRuntimeEventValidationError";
    this.validationErrors = [...errors];
  }
}

export class KusabiRuntimeEventConflictError extends Error {
  readonly code = "KUSABI_RUNTIME_EVENT_ID_CONFLICT";

  constructor(eventId: string) {
    super(`KUSABI_RUNTIME_EVENT_ID_CONFLICT: ${eventId}`);
    this.name = "KusabiRuntimeEventConflictError";
  }
}

let validatorCache: { schemaDir: string; validate: ValidateFunction } | null = null;

export function validateKusabiRuntimeEvent(
  value: unknown,
  schemaDir = defaultSchemaDir(),
): KusabiRuntimeEventValidationResult {
  const validate = compiledValidator(schemaDir);
  if (validate(value)) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: (validate.errors ?? []).map((error) =>
      `${error.instancePath || "/"} ${error.message ?? "failed schema validation"}`),
  };
}

export function canonicalKusabiRuntimeEvent(value: unknown): string {
  return canonicalJson(value);
}

export function kusabiRuntimeEventSha256(value: unknown): string {
  return createHash("sha256").update(canonicalKusabiRuntimeEvent(value)).digest("hex");
}

export async function ingestKusabiRuntimeEvent(
  store: Store,
  value: unknown,
  options: KusabiRuntimeEventIngestOptions = {},
): Promise<KusabiRuntimeEventIngestResult> {
  const validation = validateKusabiRuntimeEvent(value, options.schemaDir);
  if (!validation.valid) throw new KusabiRuntimeEventValidationError(validation.errors);

  const event = cloneJson(value) as KusabiRuntimeEventDocument;
  const eventSha256 = kusabiRuntimeEventSha256(event);

  if (store.backend === "json") {
    return emergencyResult(
      event,
      eventSha256,
      "evidence_sink_unavailable",
      "json_fixture_only",
      options.writeEmergency,
    );
  }

  try {
    const saved: SaveKusabiRuntimeEventResult = await store.saveKusabiRuntimeEvent({
      event,
      event_sha256: eventSha256,
    });
    return {
      evidence_delivery: "durable",
      inserted: saved.inserted,
      record: saved.record,
      emergency: null,
    };
  } catch (error) {
    return emergencyResult(
      event,
      eventSha256,
      "evidence_sink_write_failed",
      error instanceof KusabiRuntimeEventConflictError ? "event_id_conflict" : "store_write_failed",
      options.writeEmergency,
    );
  }
}

export function assertKusabiRuntimeEventHash(value: string): void {
  if (!SHA256_RE.test(value)) throw new Error("KUSABI_RUNTIME_EVENT_INVALID_SHA256");
}

function compiledValidator(schemaDir: string): ValidateFunction {
  const resolved = resolve(schemaDir);
  if (validatorCache?.schemaDir === resolved) return validatorCache.validate;

  const schema = JSON.parse(readFileSync(resolve(resolved, SCHEMA_FILE), "utf8")) as Record<string, unknown>;
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  validatorCache = { schemaDir: resolved, validate };
  return validate;
}

export function writeKusabiRuntimeEventEmergency(
  event: KusabiRuntimeEventDocument,
  eventSha256: string,
  reasonCode: KusabiEmergencyEvidence["reason_code"],
  normalizedErrorCode: KusabiEmergencyEvidence["normalized_error_code"],
  writeEmergency: (line: string) => void = (line: string) => {
    process.stderr.write(`${line}\n`);
  },
): KusabiRuntimeEventIngestResult {
  const emergency: KusabiEmergencyEvidence = {
    schema_version: "kusabi-emergency-evidence/v1",
    event_id: event.event_id,
    event_type: event.event_type,
    occurred_at: event.occurred_at,
    manifest_id: event.manifest_id,
    target_key: event.target_key,
    event_sha256: eventSha256,
    reason_code: reasonCode,
    normalized_error_code: normalizedErrorCode,
  };
  const line = canonicalJson(emergency);
  if (Buffer.byteLength(line, "utf8") > MAX_EMERGENCY_BYTES) {
    throw new Error("KUSABI_EMERGENCY_EVIDENCE_EXCEEDS_BOUND");
  }
  try {
    writeEmergency(line);
    return { evidence_delivery: "emergency_only", inserted: false, record: null, emergency };
  } catch {
    return { evidence_delivery: "failed", inserted: false, record: null, emergency: null };
  }
}

const emergencyResult = writeKusabiRuntimeEventEmergency;

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("KUSABI_RUNTIME_EVENT_NON_FINITE_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new Error("KUSABI_RUNTIME_EVENT_NON_JSON_VALUE");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
