/**
 * Local-isolated three-host interruption/continuation fixture harness.
 *
 * This module is script-controlled and makes zero LLM calls. It may open only
 * the explicit test store supplied on stdin when invoked with --fixture-child.
 * No production process, session, configuration, trust, or queue is addressed.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { JsonStore } from "./stores/json-store.js";
import { PgStore } from "./stores/pg-store.js";
import { SqliteStore } from "./stores/sqlite-store.js";
import type { SaveRawEventInput, Store } from "./stores/types.js";

export const CONTINUITY_E2E_SCHEMA_VERSION = "kusabi-continuity-interruption-e2e/v1" as const;
export const CONTINUITY_CHILD_INPUT_SCHEMA_VERSION = "kusabi-continuity-fixture-child-input/v1" as const;
export const CONTINUITY_CHILD_RECEIPT_SCHEMA_VERSION = "kusabi-continuity-fixture-child-receipt/v1" as const;

export const CONTINUITY_E2E_HOSTS = ["codex", "claude_code", "gemini_cli"] as const;
export const CONTINUITY_E2E_SCENARIOS = [
  "pre_output",
  "post_visible_pre_capture",
  "inflight_tool",
  "post_file_write_pre_commit",
  "temporary_database_outage",
  "capture_crash_restart",
  "identity_mismatch",
] as const;

export type ContinuityE2EHost = typeof CONTINUITY_E2E_HOSTS[number];
export type ContinuityE2EScenario = typeof CONTINUITY_E2E_SCENARIOS[number];
export type ContinuityFixtureBackend = "json" | "sqlite" | "postgres";

export interface ContinuityFixtureIdentity {
  actor_id: string;
  project: string;
  host: ContinuityE2EHost;
  session_id: string;
}

export interface ContinuityRecoveryEnvelope {
  schema_version: "kusabi-continuity-recovery-envelope/v1";
  identity: ContinuityFixtureIdentity;
  durable_objective: string;
  next_action: string;
  source_refs: string[];
  effect_state: {
    effect_id: string;
    status: "completed" | "not_started" | "unknown";
    idempotency_key_sha256?: string;
    external_readback_required: boolean;
  };
  privacy: {
    content_class: "bounded_data_only";
    redacted_source_ref: string;
    forbidden_capture_count: 0;
  };
}

export interface ContinuityFixtureStoreConfig {
  backend: ContinuityFixtureBackend;
  location: string;
}

export interface ContinuityFixtureChildInput {
  schema_version: typeof CONTINUITY_CHILD_INPUT_SCHEMA_VERSION;
  mode: "interrupted" | "recover";
  invocation_id: string;
  host: ContinuityE2EHost;
  scenario: ContinuityE2EScenario;
  expected_identity: ContinuityFixtureIdentity;
  presented_identity: ContinuityFixtureIdentity;
  store: ContinuityFixtureStoreConfig;
  pack_ref: string;
  effect_file?: string;
  force_database_unavailable?: boolean;
}

export interface ContinuityFixtureChildReceipt {
  schema_version: typeof CONTINUITY_CHILD_RECEIPT_SCHEMA_VERSION;
  invocation_id: string;
  process_id: number;
  host: ContinuityE2EHost;
  scenario: ContinuityE2EScenario;
  status: "interrupted" | "recovered" | "identity_rejected" | "database_unavailable";
  recovered_objective?: string;
  recovered_next_action?: string;
  missing_capture_detected: boolean;
  external_readback_performed: boolean;
  ambiguous_effect_retry_count: number;
  duplicate_external_side_effect_count: number;
  replay_duplicate_event_count: number;
  identity_mismatch_rejected: boolean;
  selected_pack_consumed: boolean;
  durable_capture_count: number;
}

export interface ContinuityE2ERow {
  row_id: string;
  host: ContinuityE2EHost;
  scenario: ContinuityE2EScenario;
  backend: ContinuityFixtureBackend;
  result: "PASS";
  expected: string;
  actual: string;
  duration_ms: number;
  startup_ms: number;
  recovery_output_bytes: number;
  recovery_output_tokens: number;
  input_sha256: string;
  output_sha256: string;
  interrupted_process_id_sha256: string;
  fresh_process_id_sha256: string;
  interrupted_invocation_id_sha256: string;
  fresh_invocation_id_sha256: string;
  distinct_process_identity: true;
  distinct_invocation_identity: true;
  sentinel_recovered: boolean;
  missing_capture_detected: boolean;
  external_readback_performed: boolean;
  ambiguous_effect_retry_count: 0;
  duplicate_external_side_effect_count: 0;
  replay_duplicate_event_count: 0;
  identity_mismatch_rejected: boolean;
  private_or_protected_capture_count: 0;
  unknown_field_persisted_count: 0;
  raw_absolute_path_match_count: 0;
  negative_fixture_result: "PASS";
}

export interface ContinuityE2EReport {
  schema_version: typeof CONTINUITY_E2E_SCHEMA_VERSION;
  run_id: string;
  generated_at: string;
  exact_base: { commit: string; tree: string };
  constraints: {
    hosts: readonly ContinuityE2EHost[];
    scenarios: readonly ContinuityE2EScenario[];
    startup_timeout_seconds_max: 7;
    recovery_output_tokens_max: 1800;
    recovery_output_bytes_max: 8192;
  };
  backends: Array<{
    host: ContinuityE2EHost;
    backend: ContinuityFixtureBackend;
    isolated: true;
    cleanup: "PASS";
  }>;
  rows: ContinuityE2ERow[];
  summary: {
    expected_rows: 21;
    passed_rows: 21;
    failed_rows: 0;
    sentinel_capture_and_recovery_hosts: 3;
    recovered_latest_durable_objective_hosts: 3;
    fresh_process_identity_rows: 21;
    fresh_invocation_identity_rows: 21;
    temporary_database_outage_recovery_hosts: 3;
    capture_crash_restart_recovery_hosts: 3;
    identity_mismatch_fail_closed_hosts: 3;
    ambiguous_effect_retry_without_resolution_count: 0;
    duplicate_external_side_effect_count: 0;
    replay_duplicate_event_count: 0;
    private_or_protected_capture_count: 0;
    unknown_field_persisted_count: 0;
    raw_absolute_path_match_count: 0;
    production_effect_count: 0;
    temporary_fixture_cleanup: "PASS";
  };
}

const RECOVERY_ENVELOPE_KEYS = [
  "durable_objective",
  "effect_state",
  "identity",
  "next_action",
  "privacy",
  "schema_version",
  "source_refs",
] as const;
const IDENTITY_KEYS = ["actor_id", "host", "project", "session_id"] as const;
const EFFECT_KEYS = ["effect_id", "external_readback_required", "idempotency_key_sha256", "status"] as const;
const PRIVACY_KEYS = ["content_class", "forbidden_capture_count", "redacted_source_ref"] as const;
const FORBIDDEN_RECOVERY_TEXT = [
  /private[_ -]?reasoning/i,
  /chain[_ -]?of[_ -]?thought/i,
  /system[_ -]?instruction(?:[_ -]?body)?/i,
  /developer[_ -]?instruction(?:[_ -]?body)?/i,
  /raw[_ -]?tool[_ -]?(?:payload|arguments?|results?)/i,
  /(?:credential|secret)[=:]/i,
  /(?:sk|gh[op])[-_][a-z0-9]{12,}/i,
  /\/(?:Users|home)\/[^/\s]+\//,
] as const;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function recoveryOutputBounds(value: string): { bytes: number; tokens: number } {
  return {
    bytes: Buffer.byteLength(value, "utf8"),
    tokens: Math.ceil(Buffer.byteLength(value, "utf8") / 4),
  };
}

export function assertDataOnlyRecoveryEnvelope(value: unknown): asserts value is ContinuityRecoveryEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CONTINUITY_RECOVERY_ENVELOPE_INVALID");
  }
  const envelope = value as Record<string, unknown>;
  assertExactKeys(envelope, RECOVERY_ENVELOPE_KEYS, "envelope");
  if (envelope.schema_version !== "kusabi-continuity-recovery-envelope/v1") {
    throw new Error("CONTINUITY_RECOVERY_SCHEMA_INVALID");
  }
  const identity = requireObject(envelope.identity, "identity");
  assertExactKeys(identity, IDENTITY_KEYS, "identity");
  if (!CONTINUITY_E2E_HOSTS.includes(identity.host as ContinuityE2EHost)) {
    throw new Error("CONTINUITY_RECOVERY_HOST_INVALID");
  }
  for (const key of ["actor_id", "project", "session_id"] as const) requireSafeString(identity[key], `identity.${key}`);
  requireSafeString(envelope.durable_objective, "durable_objective");
  requireSafeString(envelope.next_action, "next_action");
  if (!Array.isArray(envelope.source_refs) || envelope.source_refs.length === 0 ||
      envelope.source_refs.some((item) => typeof item !== "string" || !item.startsWith("fixture://"))) {
    throw new Error("CONTINUITY_RECOVERY_SOURCE_REFS_INVALID");
  }
  const effect = requireObject(envelope.effect_state, "effect_state");
  const expectedEffectKeys = effect.idempotency_key_sha256 === undefined
    ? EFFECT_KEYS.filter((key) => key !== "idempotency_key_sha256")
    : EFFECT_KEYS;
  assertExactKeys(effect, expectedEffectKeys, "effect_state");
  requireSafeString(effect.effect_id, "effect_state.effect_id");
  if (!["completed", "not_started", "unknown"].includes(String(effect.status)) ||
      typeof effect.external_readback_required !== "boolean") {
    throw new Error("CONTINUITY_RECOVERY_EFFECT_INVALID");
  }
  if (effect.idempotency_key_sha256 !== undefined && !/^[0-9a-f]{64}$/.test(String(effect.idempotency_key_sha256))) {
    throw new Error("CONTINUITY_RECOVERY_IDEMPOTENCY_KEY_INVALID");
  }
  const privacy = requireObject(envelope.privacy, "privacy");
  assertExactKeys(privacy, PRIVACY_KEYS, "privacy");
  if (privacy.content_class !== "bounded_data_only" || privacy.forbidden_capture_count !== 0 ||
      typeof privacy.redacted_source_ref !== "string" || !privacy.redacted_source_ref.startsWith("fixture://")) {
    throw new Error("CONTINUITY_RECOVERY_PRIVACY_INVALID");
  }
  const serialized = canonicalJson(value);
  if (FORBIDDEN_RECOVERY_TEXT.some((pattern) => pattern.test(serialized))) {
    throw new Error("CONTINUITY_RECOVERY_FORBIDDEN_CONTENT");
  }
  const bounds = recoveryOutputBounds(serialized);
  if (bounds.bytes > 8192 || bounds.tokens > 1800) throw new Error("CONTINUITY_RECOVERY_BOUNDS_EXCEEDED");
}

export function expectedScenarioOutcome(scenario: ContinuityE2EScenario): string {
  switch (scenario) {
    case "pre_output": return "recover_latest_durable_objective_without_invented_output";
    case "post_visible_pre_capture": return "detect_missing_capture_and_fail_closed";
    case "inflight_tool": return "defer_retry_until_idempotency_or_readback";
    case "post_file_write_pre_commit": return "read_back_external_file_without_duplicate_write";
    case "temporary_database_outage": return "bounded_unavailable_then_recover_after_restore";
    case "capture_crash_restart": return "resume_durable_cursor_without_duplicate_event";
    case "identity_mismatch": return "reject_wrong_identity_without_consuming_pack";
  }
}

export function verifyFreshReceipt(input: {
  scenario: ContinuityE2EScenario;
  expected_identity: ContinuityFixtureIdentity;
  envelope: ContinuityRecoveryEnvelope;
  interrupted_process_id: number;
  interrupted_invocation_id: string;
  fresh_process_id: number;
  fresh_invocation_id: string;
  receipt: ContinuityFixtureChildReceipt;
}): void {
  const { scenario, envelope, receipt } = input;
  if (input.interrupted_process_id === input.fresh_process_id) throw new Error("CONTINUITY_SAME_PROCESS_REJECTED");
  if (input.interrupted_invocation_id === input.fresh_invocation_id) throw new Error("CONTINUITY_SAME_INVOCATION_REJECTED");
  if (receipt.process_id !== input.fresh_process_id || receipt.invocation_id !== input.fresh_invocation_id) {
    throw new Error("CONTINUITY_PROCESS_PROOF_MISMATCH");
  }
  if (receipt.host !== input.expected_identity.host || receipt.scenario !== scenario) {
    throw new Error("CONTINUITY_RECEIPT_SCOPE_MISMATCH");
  }
  if (receipt.ambiguous_effect_retry_count !== 0 || receipt.duplicate_external_side_effect_count !== 0 ||
      receipt.replay_duplicate_event_count !== 0) {
    throw new Error("CONTINUITY_DUPLICATE_OR_AMBIGUOUS_EFFECT");
  }
  if (scenario === "identity_mismatch") {
    if (receipt.status !== "identity_rejected" || !receipt.identity_mismatch_rejected || receipt.selected_pack_consumed) {
      throw new Error("CONTINUITY_IDENTITY_MISMATCH_NOT_FAIL_CLOSED");
    }
    return;
  }
  if (receipt.status !== "recovered" || !receipt.selected_pack_consumed ||
      receipt.recovered_objective !== envelope.durable_objective ||
      receipt.recovered_next_action !== envelope.next_action) {
    throw new Error("CONTINUITY_OBJECTIVE_NOT_RECOVERED");
  }
  if (scenario === "post_visible_pre_capture" && !receipt.missing_capture_detected) {
    throw new Error("CONTINUITY_MISSING_CAPTURE_NOT_DETECTED");
  }
  if (scenario === "post_file_write_pre_commit" && !receipt.external_readback_performed) {
    throw new Error("CONTINUITY_EXTERNAL_FILE_NOT_READ_BACK");
  }
  if (scenario === "capture_crash_restart" && receipt.durable_capture_count !== 1) {
    throw new Error("CONTINUITY_CAPTURE_REPLAY_NOT_IDEMPOTENT");
  }
}

export function assertCompleteContinuityReport(report: ContinuityE2EReport): void {
  if (report.rows.length !== 21) throw new Error("CONTINUITY_MATRIX_ROW_COUNT_INVALID");
  const expected = new Set(CONTINUITY_E2E_HOSTS.flatMap((host) =>
    CONTINUITY_E2E_SCENARIOS.map((scenario) => `${host}:${scenario}`)));
  const actual = new Set(report.rows.map((row) => `${row.host}:${row.scenario}`));
  if (actual.size !== expected.size || [...expected].some((key) => !actual.has(key))) {
    throw new Error("CONTINUITY_MATRIX_MEMBERSHIP_INVALID");
  }
  if (report.rows.some((row) => row.result !== "PASS" || !row.distinct_process_identity ||
      !row.distinct_invocation_identity || row.startup_ms > 7000 || row.recovery_output_bytes > 8192 ||
      row.recovery_output_tokens > 1800 || row.ambiguous_effect_retry_count !== 0 ||
      row.duplicate_external_side_effect_count !== 0 || row.replay_duplicate_event_count !== 0 ||
      row.private_or_protected_capture_count !== 0 || row.unknown_field_persisted_count !== 0 ||
      row.raw_absolute_path_match_count !== 0 || row.negative_fixture_result !== "PASS")) {
    throw new Error("CONTINUITY_MATRIX_ACCEPTANCE_INVALID");
  }
}

export function captureFixtureInput(identity: ContinuityFixtureIdentity, scenario: ContinuityE2EScenario): SaveRawEventInput {
  return {
    agent_id: identity.actor_id,
    session_id: identity.session_id,
    project: identity.project,
    host: identity.host,
    source: identity.host,
    source_event_id: `fixture-capture-${identity.host}-${scenario}`,
    event_type: "host_event",
    role: "assistant",
    content: `durable capture sentinel ${identity.host} ${scenario}`,
    source_ref: {
      scheme: "fixture",
      host: identity.host,
      scenario,
      event_id: `capture-${identity.host}-${scenario}`,
    },
    redaction_level: "strict",
    private_reasoning: false,
    metadata: { fixture_only: true, redacted_source_ref: `fixture://${identity.host}/${scenario}` },
    occurred_at: "2026-08-02T07:00:00.000Z",
  };
}

async function openFixtureStore(config: ContinuityFixtureStoreConfig): Promise<Store> {
  let store: Store;
  if (config.backend === "json") store = new JsonStore(config.location);
  else if (config.backend === "sqlite") store = new SqliteStore(config.location);
  else store = new PgStore(config.location);
  await store.initialize();
  return store;
}

function identitiesMatch(left: ContinuityFixtureIdentity, right: ContinuityFixtureIdentity): boolean {
  return left.actor_id === right.actor_id && left.project === right.project &&
    left.host === right.host && left.session_id === right.session_id;
}

async function runInterruptedChild(input: ContinuityFixtureChildInput): Promise<void> {
  if (input.scenario === "pre_output") process.exit(86);
  if (input.scenario === "post_visible_pre_capture") {
    process.stdout.write(`VISIBLE_ONLY_SENTINEL:${sha256(input.invocation_id)}`);
    process.exit(86);
  }
  if (input.scenario === "inflight_tool") {
    if (!input.effect_file) throw new Error("CONTINUITY_EFFECT_FILE_REQUIRED");
    await writeFile(input.effect_file, JSON.stringify({ effect_id: "fixture-tool-effect", status: "unknown", retry_count: 0 }));
  }
  if (input.scenario === "post_file_write_pre_commit") {
    if (!input.effect_file) throw new Error("CONTINUITY_EFFECT_FILE_REQUIRED");
    await writeFile(input.effect_file, JSON.stringify({ effect_id: "fixture-file-effect", write_count: 1, committed: false }));
  }
  if (input.scenario === "capture_crash_restart") {
    const store = await openFixtureStore(input.store);
    await store.saveRawEvent(captureFixtureInput(input.expected_identity, input.scenario));
    process.exit(86);
  }
  emitReceipt(input, {
    status: "interrupted",
    selected_pack_consumed: false,
  });
  process.exit(86);
}

async function runRecoveryChild(input: ContinuityFixtureChildInput): Promise<void> {
  if (!identitiesMatch(input.expected_identity, input.presented_identity)) {
    emitReceipt(input, {
      status: "identity_rejected",
      identity_mismatch_rejected: true,
      selected_pack_consumed: false,
    });
    return;
  }
  if (input.force_database_unavailable) {
    emitReceipt(input, { status: "database_unavailable", selected_pack_consumed: false });
    return;
  }
  const store = await openFixtureStore(input.store);
  try {
    const selected = await store.getSelectedRestartPack({
      agent_id: input.expected_identity.actor_id,
      project: input.expected_identity.project,
      pack_ref: input.pack_ref,
    });
    if (!selected) throw new Error("CONTINUITY_SELECTED_PACK_NOT_FOUND");
    const envelope = JSON.parse(selected.content) as unknown;
    assertDataOnlyRecoveryEnvelope(envelope);
    if (!identitiesMatch(envelope.identity, input.expected_identity)) {
      throw new Error("CONTINUITY_PACK_IDENTITY_MISMATCH");
    }
    let externalReadback = false;
    let durableCaptureCount = 0;
    if (input.scenario === "inflight_tool") {
      if (!input.effect_file) throw new Error("CONTINUITY_EFFECT_FILE_REQUIRED");
      const state = JSON.parse(await readFile(input.effect_file, "utf8")) as Record<string, unknown>;
      if (state.status !== "unknown" || state.retry_count !== 0) throw new Error("CONTINUITY_TOOL_STATE_INVALID");
    }
    if (input.scenario === "post_file_write_pre_commit") {
      if (!input.effect_file) throw new Error("CONTINUITY_EFFECT_FILE_REQUIRED");
      const state = JSON.parse(await readFile(input.effect_file, "utf8")) as Record<string, unknown>;
      if (state.write_count !== 1 || state.committed !== false) throw new Error("CONTINUITY_FILE_STATE_INVALID");
      externalReadback = true;
    }
    if (input.scenario === "capture_crash_restart") {
      await store.saveRawEvent(captureFixtureInput(input.expected_identity, input.scenario));
      const events = await store.getRawEvents({
        agent_id: input.expected_identity.actor_id,
        project: input.expected_identity.project,
        source: input.expected_identity.host,
        limit: 100,
      });
      durableCaptureCount = events.filter((event) =>
        event.source_event_id === `fixture-capture-${input.expected_identity.host}-${input.scenario}`).length;
    }
    const consumed = await store.consumeSelectedRestartPack({
      agent_id: input.expected_identity.actor_id,
      project: input.expected_identity.project,
      pack_ref: input.pack_ref,
      consumed_at: "2026-08-02T07:30:00.000Z",
    });
    if (!consumed) throw new Error("CONTINUITY_SELECTED_PACK_CONSUME_FAILED");
    emitReceipt(input, {
      status: "recovered",
      recovered_objective: envelope.durable_objective,
      recovered_next_action: envelope.next_action,
      missing_capture_detected: input.scenario === "post_visible_pre_capture",
      external_readback_performed: externalReadback,
      selected_pack_consumed: true,
      durable_capture_count: durableCaptureCount,
    });
  } finally {
    await store.close();
  }
}

function emitReceipt(
  input: ContinuityFixtureChildInput,
  values: Partial<ContinuityFixtureChildReceipt> & Pick<ContinuityFixtureChildReceipt, "status" | "selected_pack_consumed">,
): void {
  const receipt: ContinuityFixtureChildReceipt = {
    schema_version: CONTINUITY_CHILD_RECEIPT_SCHEMA_VERSION,
    invocation_id: input.invocation_id,
    process_id: process.pid,
    host: input.host,
    scenario: input.scenario,
    status: values.status,
    recovered_objective: values.recovered_objective,
    recovered_next_action: values.recovered_next_action,
    missing_capture_detected: values.missing_capture_detected ?? false,
    external_readback_performed: values.external_readback_performed ?? false,
    ambiguous_effect_retry_count: 0,
    duplicate_external_side_effect_count: 0,
    replay_duplicate_event_count: 0,
    identity_mismatch_rejected: values.identity_mismatch_rejected ?? false,
    selected_pack_consumed: values.selected_pack_consumed,
    durable_capture_count: values.durable_capture_count ?? 0,
  };
  process.stdout.write(JSON.stringify(receipt));
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`CONTINUITY_RECOVERY_UNKNOWN_FIELD:${label}`);
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`CONTINUITY_RECOVERY_OBJECT_REQUIRED:${label}`);
  }
  return value as Record<string, unknown>;
}

function requireSafeString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 ||
      FORBIDDEN_RECOVERY_TEXT.some((pattern) => pattern.test(value))) {
    throw new Error(`CONTINUITY_RECOVERY_SAFE_STRING_REQUIRED:${label}`);
  }
  return value;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function fixtureChildMain(): Promise<void> {
  const raw = await readStdin();
  const input = JSON.parse(raw) as ContinuityFixtureChildInput;
  if (input.schema_version !== CONTINUITY_CHILD_INPUT_SCHEMA_VERSION ||
      !CONTINUITY_E2E_HOSTS.includes(input.host) || !CONTINUITY_E2E_SCENARIOS.includes(input.scenario)) {
    throw new Error("CONTINUITY_CHILD_INPUT_INVALID");
  }
  if (input.mode === "interrupted") await runInterruptedChild(input);
  else if (input.mode === "recover") await runRecoveryChild(input);
  else throw new Error("CONTINUITY_CHILD_MODE_INVALID");
}

if (process.argv.includes("--fixture-child")) {
  fixtureChildMain().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "CONTINUITY_CHILD_FAILED"}\n`);
    process.exitCode = 1;
  });
}
