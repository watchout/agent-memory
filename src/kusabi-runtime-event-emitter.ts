import { createHash } from "node:crypto";
import {
  ingestKusabiRuntimeEvent,
  kusabiRuntimeEventSha256,
  writeKusabiRuntimeEventEmergency,
  type KusabiEmergencyEvidence,
} from "./kusabi-runtime-event-store.js";
import { PgStore } from "./stores/pg-store.js";
import { SqliteStore } from "./stores/sqlite-store.js";
import type { KusabiRuntimeEventDocument, Store } from "./stores/types.js";

export const KUSABI_RUNTIME_EVENT_TARGET_ENV = "KUSABI_RUNTIME_EVENT_TARGET_JSON" as const;
export const KUSABI_RUNTIME_EVENT_TARGET_SCHEMA = "kusabi-runtime-event-target/v1" as const;
export const KUSABI_RUNTIME_EVENT_EMISSION_TIMEOUT_MS = 500;

const SHA256_RE = /^[a-f0-9]{64}$/;
const GIT_SHA_RE = /^[a-f0-9]{40}$/;
const BOUNDED_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface KusabiRuntimeEventTargetBinding {
  schema_version: typeof KUSABI_RUNTIME_EVENT_TARGET_SCHEMA;
  manifest_id: string;
  build: {
    commit_sha: string;
    tree_sha: string;
    artifact_sha256: string;
  };
  configuration: {
    config_sha256: string;
    trust_fingerprint_sha256: string;
  };
  storage: {
    backend: "sqlite" | "postgres";
    binding_sha256: string;
  };
}

export interface KusabiSessionStartEvidence {
  adapter: { id: string; version: string };
  identity: {
    agent_id: string;
    project: string;
    workspace_sha256: string;
    binding_source_ref: string;
    runtime: "codex" | "claude-code" | "gemini-cli";
  };
  store_binding: {
    backend_intent: "postgres" | "sqlite" | "json" | "unknown";
    verified: boolean;
  };
  hook: { session_id: string | null };
  timing: { completed_at: string; elapsed_ms: number };
  output: { token_estimate: number; redaction_count: number };
  recovery_pack: { pack_ref: string | null; policy_version: string | null };
  outcome: "full" | "degraded";
  degraded_reason: string | null;
  recovery_quality_log_ref: string | null;
}

export interface KusabiRuntimeEventEmissionResult {
  status: "disabled" | "durable" | "emergency_only" | "failed";
  event_id: string | null;
  target_key: string | null;
  emergency: KusabiEmergencyEvidence | null;
}

export interface KusabiRuntimeEventEmissionOptions {
  target?: KusabiRuntimeEventTargetBinding | string | null;
  env?: NodeJS.ProcessEnv;
  createStore?: () => Promise<Store>;
  writeEmergency?: (line: string) => void;
  timeoutMs?: number;
}

export function parseKusabiRuntimeEventTarget(
  raw: string | KusabiRuntimeEventTargetBinding,
): KusabiRuntimeEventTargetBinding {
  const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!isRecord(value) || !exactKeys(value, ["schema_version", "manifest_id", "build", "configuration", "storage"])) {
    throw new Error("KUSABI_RUNTIME_EVENT_TARGET_INVALID");
  }
  if (value.schema_version !== KUSABI_RUNTIME_EVENT_TARGET_SCHEMA || !boundedId(value.manifest_id)) {
    throw new Error("KUSABI_RUNTIME_EVENT_TARGET_INVALID");
  }
  const build = value.build;
  const configuration = value.configuration;
  const storage = value.storage;
  if (
    !isRecord(build) || !exactKeys(build, ["commit_sha", "tree_sha", "artifact_sha256"]) ||
    !gitSha(build.commit_sha) || !gitSha(build.tree_sha) || !sha256Value(build.artifact_sha256) ||
    !isRecord(configuration) || !exactKeys(configuration, ["config_sha256", "trust_fingerprint_sha256"]) ||
    !sha256Value(configuration.config_sha256) || !sha256Value(configuration.trust_fingerprint_sha256) ||
    !isRecord(storage) || !exactKeys(storage, ["backend", "binding_sha256"]) ||
    (storage.backend !== "sqlite" && storage.backend !== "postgres") || !sha256Value(storage.binding_sha256)
  ) {
    throw new Error("KUSABI_RUNTIME_EVENT_TARGET_INVALID");
  }
  return {
    schema_version: KUSABI_RUNTIME_EVENT_TARGET_SCHEMA,
    manifest_id: value.manifest_id,
    build: {
      commit_sha: build.commit_sha,
      tree_sha: build.tree_sha,
      artifact_sha256: build.artifact_sha256,
    },
    configuration: {
      config_sha256: configuration.config_sha256,
      trust_fingerprint_sha256: configuration.trust_fingerprint_sha256,
    },
    storage: {
      backend: storage.backend,
      binding_sha256: storage.binding_sha256,
    },
  };
}

export function buildKusabiSessionStartRuntimeEvent(
  evidence: KusabiSessionStartEvidence,
  target: KusabiRuntimeEventTargetBinding,
): KusabiRuntimeEventDocument {
  const hostRuntime = normalizeHostRuntime(evidence.identity.runtime);
  const targetKey = digest([
    evidence.identity.agent_id,
    evidence.identity.project,
    hostRuntime,
    evidence.identity.workspace_sha256,
  ].join("\n"));
  const sessionRefSha256 = evidence.hook.session_id === null ? null : digest(evidence.hook.session_id);
  const eventIdentity = digest(`${target.manifest_id}\n${targetKey}\nsession_start\n${sessionRefSha256 ?? "none"}`);
  const degradedReason = normalizeReason(evidence.degraded_reason);
  const evidenceLocator = evidence.recovery_quality_log_ref ?? evidence.recovery_pack.pack_ref ??
    `${evidence.adapter.id}:${sessionRefSha256 ?? "none"}`;
  return {
    schema_version: "kusabi-runtime-event/v1",
    event_id: uuidFromSha256(eventIdentity),
    event_type: "session_start",
    occurred_at: new Date(evidence.timing.completed_at).toISOString(),
    manifest_id: target.manifest_id,
    target_key: targetKey,
    producer: {
      agent_id: evidence.identity.agent_id,
      project: evidence.identity.project,
      host_runtime: hostRuntime,
      adapter_id: evidence.adapter.id,
      adapter_version: evidence.adapter.version,
      workspace_sha256: evidence.identity.workspace_sha256,
      session_ref_sha256: sessionRefSha256,
    },
    build: { ...target.build },
    configuration: {
      config_sha256: target.configuration.config_sha256,
      trust_fingerprint_sha256: target.configuration.trust_fingerprint_sha256,
      binding_source_ref_sha256: digest(evidence.identity.binding_source_ref),
    },
    storage: { ...target.storage },
    outcome: {
      status: evidence.outcome,
      reason_code: evidence.outcome === "full" ? null : degradedReason.reason,
      elapsed_ms: evidence.timing.elapsed_ms,
      evidence_delivery: "durable",
      normalized_error_code: evidence.outcome === "full" ? null : degradedReason.code,
      error_fingerprint_sha256: evidence.outcome === "full"
        ? null
        : digest(`${hostRuntime}\n${degradedReason.code}`),
    },
    health: {
      recovered_tokens: evidence.output.token_estimate,
      task_continued: null,
      recovery_quality_score: null,
      search_memory_count_10min: null,
    },
    privacy: {
      policy_version: boundedId(evidence.recovery_pack.policy_version)
        ? evidence.recovery_pack.policy_version
        : "kusabi-observability-v1",
      redaction_count: evidence.output.redaction_count,
      forbidden_field_count: 0,
    },
    evidence_refs: [{
      kind: evidence.recovery_quality_log_ref === null ? "run" : "local_store",
      locator_sha256: digest(evidenceLocator),
      content_sha256: digest(canonicalJson(evidence)),
    }],
  };
}

export async function emitKusabiSessionStartRuntimeEvent(
  evidence: KusabiSessionStartEvidence,
  options: KusabiRuntimeEventEmissionOptions = {},
): Promise<KusabiRuntimeEventEmissionResult> {
  try {
    const configured = options.target ?? options.env?.[KUSABI_RUNTIME_EVENT_TARGET_ENV] ??
      process.env[KUSABI_RUNTIME_EVENT_TARGET_ENV];
    if (configured === undefined || configured === null || configured === "") {
      return { status: "disabled", event_id: null, target_key: null, emergency: null };
    }

    let target: KusabiRuntimeEventTargetBinding;
    try {
      target = parseKusabiRuntimeEventTarget(configured);
    } catch {
      return invalidTargetEmergency(evidence, options.writeEmergency);
    }

    const event = buildKusabiSessionStartRuntimeEvent(evidence, target);
    const timeoutMs = boundedTimeout(options.timeoutMs);
    let timedOut = false;
    const emergencyWriter = (line: string) => {
      if (!timedOut) (options.writeEmergency ?? defaultEmergencyWriter)(line);
    };
    const emission = emitPreparedEvent(event, evidence, target, options, emergencyWriter);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<KusabiRuntimeEventEmissionResult>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve(safeEmergencyResult(
          event,
          "evidence_sink_unavailable",
          "store_unavailable",
          options.writeEmergency,
        ));
      }, timeoutMs);
    });
    const result = await Promise.race([emission, timeout]);
    if (timer !== undefined) clearTimeout(timer);
    return result;
  } catch {
    return { status: "failed", event_id: null, target_key: null, emergency: null };
  }
}

async function emitPreparedEvent(
  event: KusabiRuntimeEventDocument,
  evidence: KusabiSessionStartEvidence,
  target: KusabiRuntimeEventTargetBinding,
  options: KusabiRuntimeEventEmissionOptions,
  writeEmergency: (line: string) => void,
): Promise<KusabiRuntimeEventEmissionResult> {
  const backendIntent = evidence.store_binding.backend_intent;
  if (
    !evidence.store_binding.verified ||
    (backendIntent !== "sqlite" && backendIntent !== "postgres") ||
    backendIntent !== target.storage.backend
  ) {
    return safeEmergencyResult(
      event,
      "evidence_sink_unavailable",
      "backend_drift",
      writeEmergency,
    );
  }

  let store: Store | null = null;
  try {
    store = await (options.createStore ?? (() => createQuietStore(options.env ?? process.env)))();
  } catch {
    return safeEmergencyResult(
      event,
      "evidence_sink_unavailable",
      "store_unavailable",
      writeEmergency,
    );
  }

  try {
    if (store.backend !== target.storage.backend) {
      return safeEmergencyResult(
        event,
        "evidence_sink_unavailable",
        "backend_drift",
        writeEmergency,
      );
    }
    const result = await ingestKusabiRuntimeEvent(store, event, {
      writeEmergency,
    });
    return emissionResult(result.evidence_delivery, event, result.emergency);
  } catch {
    return safeEmergencyResult(
      event,
      "evidence_sink_write_failed",
      "store_write_failed",
      writeEmergency,
    );
  } finally {
    try {
      await store.close();
    } catch {
      // Closing observability must never change the already-produced hook result.
    }
  }
}

async function createQuietStore(env: NodeJS.ProcessEnv): Promise<Store> {
  const dbType = (env.AGENT_MEMORY_DB_TYPE ?? "").toLowerCase();
  const dbUrl = env.AGENT_MEMORY_DATABASE_URL ?? env.DATABASE_URL ?? "";
  const hasPostgresUrl = dbUrl.startsWith("postgres");
  let store: Store;
  if (dbType === "json") throw new Error("KUSABI_RUNTIME_EVENT_JSON_FIXTURE_ONLY");
  if (dbType === "sqlite") store = new SqliteStore();
  else if (dbType === "postgres" || hasPostgresUrl) {
    if (!dbUrl) throw new Error("KUSABI_RUNTIME_EVENT_STORE_UNAVAILABLE");
    store = new PgStore(dbUrl);
  } else store = new SqliteStore();
  await store.initialize();
  return store;
}

function safeEmergencyResult(
  event: KusabiRuntimeEventDocument,
  reasonCode: KusabiEmergencyEvidence["reason_code"],
  normalizedErrorCode: KusabiEmergencyEvidence["normalized_error_code"],
  writeEmergency?: (line: string) => void,
): KusabiRuntimeEventEmissionResult {
  try {
    const result = writeKusabiRuntimeEventEmergency(
      event,
      kusabiRuntimeEventSha256(event),
      reasonCode,
      normalizedErrorCode,
      writeEmergency,
    );
    return emissionResult(result.evidence_delivery, event, result.emergency);
  } catch {
    return emissionResult("failed", event, null);
  }
}

function invalidTargetEmergency(
  evidence: KusabiSessionStartEvidence,
  writeEmergency?: (line: string) => void,
): KusabiRuntimeEventEmissionResult {
  try {
    const backend = evidence.store_binding.backend_intent === "postgres" ? "postgres" : "sqlite";
    const zeroHash = "0".repeat(64);
    const placeholder: KusabiRuntimeEventTargetBinding = {
      schema_version: KUSABI_RUNTIME_EVENT_TARGET_SCHEMA,
      manifest_id: "kusabi-invalid-target",
      build: {
        commit_sha: "0".repeat(40),
        tree_sha: "0".repeat(40),
        artifact_sha256: zeroHash,
      },
      configuration: {
        config_sha256: zeroHash,
        trust_fingerprint_sha256: zeroHash,
      },
      storage: { backend, binding_sha256: zeroHash },
    };
    const event = buildKusabiSessionStartRuntimeEvent(evidence, placeholder);
    return safeEmergencyResult(event, "evidence_sink_unavailable", "target_invalid", writeEmergency);
  } catch {
    return { status: "failed", event_id: null, target_key: null, emergency: null };
  }
}

function defaultEmergencyWriter(line: string): void {
  process.stderr.write(`${line}\n`);
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return KUSABI_RUNTIME_EVENT_EMISSION_TIMEOUT_MS;
  if (!Number.isInteger(value) || value < 1 || value > 5_000) {
    return KUSABI_RUNTIME_EVENT_EMISSION_TIMEOUT_MS;
  }
  return value;
}

function emissionResult(
  delivery: "durable" | "emergency_only" | "failed",
  event: KusabiRuntimeEventDocument,
  emergency: KusabiEmergencyEvidence | null,
): KusabiRuntimeEventEmissionResult {
  return {
    status: delivery,
    event_id: event.event_id,
    target_key: event.target_key,
    emergency,
  };
}

function normalizeHostRuntime(runtime: KusabiSessionStartEvidence["identity"]["runtime"]):
  "codex" | "claude_code" | "gemini_cli" {
  if (runtime === "claude-code") return "claude_code";
  if (runtime === "gemini-cli") return "gemini_cli";
  return "codex";
}

function normalizeReason(reason: string | null): { reason: string; code: string } {
  const mapping: Record<string, string> = {
    MALFORMED_HOOK_INPUT: "malformed_hook_input",
    UNSUPPORTED_HOOK_EVENT: "malformed_hook_input",
    UNSUPPORTED_START_SOURCE: "malformed_hook_input",
    IDENTITY_BINDING_INVALID: "binding_mismatch",
    WORKSPACE_IDENTITY_MISMATCH: "binding_mismatch",
    RECOVERY_TIMEOUT: "timeout",
    RECOVERY_UNAVAILABLE: "recovery_unavailable",
    EVIDENCE_LOG_UNAVAILABLE: "recovery_incomplete",
  };
  const normalized = mapping[reason ?? ""] ?? "unknown_normalized_error";
  return { reason: normalized, code: `session_start.${normalized}` };
}

function uuidFromSha256(hash: string): string {
  const chars = hash.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ["8", "9", "a", "b"][parseInt(chars[16], 16) % 4];
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function boundedId(value: unknown): value is string {
  return typeof value === "string" && BOUNDED_ID_RE.test(value);
}

function sha256Value(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

function gitSha(value: unknown): value is string {
  return typeof value === "string" && GIT_SHA_RE.test(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") return JSON.stringify(null);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
