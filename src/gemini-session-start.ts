#!/usr/bin/env node
/**
 * Native Gemini CLI SessionStart adapter.
 *
 * Gemini CLI invokes this command from a trusted project settings file and
 * passes strict JSON on stdin. The adapter emits exactly one JSON object on
 * stdout. Evidence is written to stderr. It never launches or restarts Gemini,
 * writes to a TUI, or mutates AUN queue state.
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateTokens } from "./constants.js";
import {
  enforceCodexRecoveryCaps,
  recoveryFromPack,
  type CodexRecoveryPackEvidence,
  type CodexSessionStartBinding,
  type RecoveryOutputWithMetrics,
} from "./codex-session-start.js";
import { redactText } from "./redact.js";
import {
  RECOVERY_PACK_SCHEMA_REF,
  buildRecoveryPackArtifact,
  buildRestartPack,
  loadRestartPackData,
  type RecoveryPackArtifact,
} from "./restart-pack.js";
import { createStore } from "./stores/index.js";

export const GEMINI_SESSION_START_ADAPTER_ID = "wasurezu-gemini-session-start" as const;
export const GEMINI_SESSION_START_ADAPTER_VERSION = "1.0.0" as const;
export const GEMINI_SESSION_START_EVIDENCE_SCHEMA = "gemini-session-start-evidence/v1" as const;
export const GEMINI_SESSION_START_HOST_CONTRACT_VERSION = "0.38.2" as const;
export const GEMINI_SESSION_START_INPUT_MAX_BYTES = 65_536;
export const GEMINI_SESSION_START_MAX_TOKENS = 1_800;
export const GEMINI_SESSION_START_MAX_BYTES = 8_192;
export const GEMINI_SESSION_START_INTERNAL_TIMEOUT_MS = 7_000;
export const GEMINI_SESSION_START_HOOK_TIMEOUT_MS = 9_000;

const START_SOURCES = ["startup", "resume", "clear"] as const;
const INPUT_FIELDS = [
  "cwd",
  "hook_event_name",
  "session_id",
  "source",
  "timestamp",
  "transcript_path",
] as const;

export type GeminiSessionStartSource = typeof START_SOURCES[number];
export type GeminiSessionStartBinding = CodexSessionStartBinding;

export interface GeminiSessionStartInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: "SessionStart";
  timestamp: string;
  source: GeminiSessionStartSource;
}

export interface GeminiSessionStartOutput {
  continue: true;
  suppressOutput: false;
  systemMessage?: string;
  hookSpecificOutput?: {
    additionalContext: string;
  };
}

export type GeminiSessionStartDegradedReason =
  | "MALFORMED_HOOK_INPUT"
  | "UNSUPPORTED_HOOK_EVENT"
  | "UNSUPPORTED_START_SOURCE"
  | "IDENTITY_BINDING_INVALID"
  | "WORKSPACE_IDENTITY_MISMATCH"
  | "RECOVERY_TIMEOUT"
  | "RECOVERY_UNAVAILABLE"
  | "EVIDENCE_LOG_UNAVAILABLE";

export interface GeminiSessionStartEvidence {
  schema_version: typeof GEMINI_SESSION_START_EVIDENCE_SCHEMA;
  adapter: {
    id: typeof GEMINI_SESSION_START_ADAPTER_ID;
    version: typeof GEMINI_SESSION_START_ADAPTER_VERSION;
    host: "gemini-cli";
    host_contract_version: typeof GEMINI_SESSION_START_HOST_CONTRACT_VERSION;
    normal_launch_command: "gemini";
    native_start_surface: "SessionStart";
    canonical_config_location: ".gemini/settings.json";
    delivery_mode: "hookSpecificOutput.additionalContext";
  };
  identity: {
    agent_id: string;
    project: string;
    workspace_sha256: string;
    binding_source_ref: string;
    runtime: "gemini-cli";
    verified: boolean;
  };
  hook: {
    session_id: string | null;
    source: GeminiSessionStartSource | null;
    timestamp: string | null;
    cwd_sha256: string | null;
    input_valid: boolean;
    strict_json_stdout: true;
  };
  timing: {
    started_at: string;
    completed_at: string;
    elapsed_ms: number;
    internal_timeout_ms: number;
    hook_timeout_ms: number;
    t0_process_start_at: null;
    t1_injection_confirmed_at: null;
    t2_orientation_complete_at: null;
    t3_safe_action_started_at: null;
    t4_useful_result_at: null;
  };
  output: {
    token_cap: number;
    byte_cap: number;
    token_estimate: number;
    byte_count: number;
    redaction_count: number;
    redaction_version: string;
    truncation_count: number;
    omitted_section_count: number;
  };
  recovery_pack: {
    pack_ref: string | null;
    schema_ref: string | null;
    token_budget: number | null;
    confidence: "high" | "medium" | "low" | null;
    missing_context: string[];
    source_refs: string[];
    policy_version: string | null;
  };
  trust: {
    hook_execution_observed: boolean;
    hook_trust_verified_by_adapter: false;
    configuration_state: "placed_not_delivered" | "unknown";
    changed_hook_requires_operator_review: true;
  };
  delivery: {
    status: "degraded";
    emission_status: "emitted" | "not_emitted";
    first_context_delivery_confirmed: false;
  };
  outcome: "full" | "degraded";
  degraded_reason: GeminiSessionStartDegradedReason | null;
  ordinary_launch_usable: true;
  recovery_quality_log_ref: string | null;
  forbidden_effects: {
    automatic_restart_count: 0;
    process_kill_count: 0;
    tui_write_count: 0;
    tmux_send_keys_count: 0;
    clipboard_write_count: 0;
    aun_queue_mutation_count: 0;
    running_session_injection_count: 0;
  };
}

export interface LoadedGeminiRecovery {
  recovery: RecoveryOutputWithMetrics;
  recovery_pack: CodexRecoveryPackEvidence;
  recovery_quality_log_ref: string | null;
}

export interface GeminiSessionStartDependencies {
  loadRecovery?: (
    binding: GeminiSessionStartBinding,
    input: GeminiSessionStartInput,
  ) => Promise<LoadedGeminiRecovery>;
  now?: () => number;
}

export interface GeminiSessionStartRunResult {
  output: GeminiSessionStartOutput;
  evidence: GeminiSessionStartEvidence;
  exit_code: 0;
}

class GeminiHookDegradedError extends Error {
  constructor(public readonly reason: GeminiSessionStartDegradedReason) {
    super(reason);
    this.name = "GeminiHookDegradedError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.trim() !== value || value.includes("\0")) {
    throw new GeminiHookDegradedError("IDENTITY_BINDING_INVALID");
  }
  if (field === "binding_source_ref" && value.length > 512) {
    throw new GeminiHookDegradedError("IDENTITY_BINDING_INVALID");
  }
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new GeminiHookDegradedError("IDENTITY_BINDING_INVALID");
  }
  return value;
}

export function normalizeGeminiSessionStartBinding(
  binding: GeminiSessionStartBinding,
): GeminiSessionStartBinding {
  let workspace: string;
  try {
    workspace = realpathSync(nonEmpty(binding.workspace, "workspace"));
  } catch {
    throw new GeminiHookDegradedError("IDENTITY_BINDING_INVALID");
  }
  return {
    agent_id: nonEmpty(binding.agent_id, "agent_id"),
    project: nonEmpty(binding.project, "project"),
    workspace,
    binding_source_ref: nonEmpty(binding.binding_source_ref, "binding_source_ref"),
    max_tokens: boundedInteger(binding.max_tokens, 500, GEMINI_SESSION_START_MAX_TOKENS),
    max_bytes: boundedInteger(binding.max_bytes, 1_024, GEMINI_SESSION_START_MAX_BYTES),
    timeout_ms: boundedInteger(binding.timeout_ms, 100, GEMINI_SESSION_START_INTERNAL_TIMEOUT_MS),
  };
}

export function parseGeminiSessionStartInput(raw: string): GeminiSessionStartInput {
  if (Buffer.byteLength(raw, "utf8") > GEMINI_SESSION_START_INPUT_MAX_BYTES) {
    throw new GeminiHookDegradedError("MALFORMED_HOOK_INPUT");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new GeminiHookDegradedError("MALFORMED_HOOK_INPUT");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GeminiHookDegradedError("MALFORMED_HOOK_INPUT");
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    keys.length !== INPUT_FIELDS.length ||
    !INPUT_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(input, field))
  ) {
    throw new GeminiHookDegradedError("MALFORMED_HOOK_INPUT");
  }
  if (input.hook_event_name !== "SessionStart") {
    throw new GeminiHookDegradedError("UNSUPPORTED_HOOK_EVENT");
  }
  if (typeof input.source !== "string" || !START_SOURCES.includes(input.source as GeminiSessionStartSource)) {
    throw new GeminiHookDegradedError("UNSUPPORTED_START_SOURCE");
  }
  if (
    typeof input.session_id !== "string" || input.session_id.trim() === "" ||
    typeof input.transcript_path !== "string" || input.transcript_path.trim() === "" ||
    typeof input.cwd !== "string" || input.cwd.trim() === "" ||
    typeof input.timestamp !== "string" || input.timestamp.trim() === "" ||
    Number.isNaN(Date.parse(input.timestamp))
  ) {
    throw new GeminiHookDegradedError("MALFORMED_HOOK_INPUT");
  }
  return {
    session_id: input.session_id,
    transcript_path: input.transcript_path,
    cwd: input.cwd,
    hook_event_name: "SessionStart",
    timestamp: input.timestamp,
    source: input.source as GeminiSessionStartSource,
  };
}

export function verifyGeminiHookWorkspace(
  binding: GeminiSessionStartBinding,
  input: GeminiSessionStartInput,
): { workspace: string; cwd: string } {
  let workspace: string;
  let cwd: string;
  try {
    workspace = realpathSync(binding.workspace);
    cwd = realpathSync(input.cwd);
  } catch {
    throw new GeminiHookDegradedError("WORKSPACE_IDENTITY_MISMATCH");
  }
  const fromWorkspace = relative(workspace, cwd);
  if (
    fromWorkspace === ".." ||
    fromWorkspace.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(fromWorkspace)
  ) {
    throw new GeminiHookDegradedError("WORKSPACE_IDENTITY_MISMATCH");
  }
  return { workspace, cwd };
}

function emptyOutputMetrics(binding: GeminiSessionStartBinding): GeminiSessionStartEvidence["output"] {
  return {
    token_cap: binding.max_tokens,
    byte_cap: binding.max_bytes,
    token_estimate: 0,
    byte_count: 0,
    redaction_count: 0,
    redaction_version: "am031-redaction-v1",
    truncation_count: 0,
    omitted_section_count: 0,
  };
}

function outputMetrics(
  recovery: RecoveryOutputWithMetrics,
  binding: GeminiSessionStartBinding,
): GeminiSessionStartEvidence["output"] {
  return {
    token_cap: binding.max_tokens,
    byte_cap: binding.max_bytes,
    token_estimate: recovery.token_estimate,
    byte_count: recovery.byte_count,
    redaction_count: recovery.redaction_count,
    redaction_version: recovery.redaction_version,
    truncation_count: recovery.truncation_count,
    omitted_section_count: recovery.omitted_section_count,
  };
}

function packEvidence(pack: RecoveryPackArtifact): CodexRecoveryPackEvidence {
  return {
    pack_ref: pack.pack_id,
    schema_ref: pack.schema_ref ?? RECOVERY_PACK_SCHEMA_REF,
    token_budget: pack.token_budget,
    confidence: pack.confidence,
    missing_context: pack.missing_context.slice(),
    source_refs: pack.source_refs?.slice() ?? [],
    policy_version: pack.policy_version ?? null,
  };
}

function emptyPackEvidence(): GeminiSessionStartEvidence["recovery_pack"] {
  return {
    pack_ref: null,
    schema_ref: null,
    token_budget: null,
    confidence: null,
    missing_context: [],
    source_refs: [],
    policy_version: null,
  };
}

function degradedOutput(reason: GeminiSessionStartDegradedReason): GeminiSessionStartOutput {
  return {
    continue: true,
    suppressOutput: false,
    systemMessage: `Wasurezu startup recovery degraded (${reason}); Gemini continued with ordinary startup.`,
  };
}

function safeBindingForEvidence(binding: GeminiSessionStartBinding): GeminiSessionStartBinding {
  const source = typeof binding.binding_source_ref === "string" && binding.binding_source_ref.trim()
    ? binding.binding_source_ref.trim()
    : "invalid";
  return {
    agent_id: typeof binding.agent_id === "string" && binding.agent_id.trim() ? binding.agent_id.trim() : "invalid",
    project: typeof binding.project === "string" && binding.project.trim() ? binding.project.trim() : "invalid",
    workspace: typeof binding.workspace === "string" ? binding.workspace : "",
    binding_source_ref: redactText(source).text,
    max_tokens: Number.isInteger(binding.max_tokens) && binding.max_tokens >= 500 && binding.max_tokens <= GEMINI_SESSION_START_MAX_TOKENS
      ? binding.max_tokens
      : GEMINI_SESSION_START_MAX_TOKENS,
    max_bytes: Number.isInteger(binding.max_bytes) && binding.max_bytes >= 1_024 && binding.max_bytes <= GEMINI_SESSION_START_MAX_BYTES
      ? binding.max_bytes
      : GEMINI_SESSION_START_MAX_BYTES,
    timeout_ms: Number.isInteger(binding.timeout_ms) && binding.timeout_ms >= 100 && binding.timeout_ms <= GEMINI_SESSION_START_INTERNAL_TIMEOUT_MS
      ? binding.timeout_ms
      : GEMINI_SESSION_START_INTERNAL_TIMEOUT_MS,
  };
}

function buildEvidence(input: {
  binding: GeminiSessionStartBinding;
  hookInput?: GeminiSessionStartInput;
  identityVerified: boolean;
  startedAt: number;
  completedAt: number;
  recovery?: RecoveryOutputWithMetrics;
  recoveryPack?: CodexRecoveryPackEvidence;
  outcome: "full" | "degraded";
  reason: GeminiSessionStartDegradedReason | null;
  recoveryQualityLogRef: string | null;
}): GeminiSessionStartEvidence {
  const binding = safeBindingForEvidence(input.binding);
  return {
    schema_version: GEMINI_SESSION_START_EVIDENCE_SCHEMA,
    adapter: {
      id: GEMINI_SESSION_START_ADAPTER_ID,
      version: GEMINI_SESSION_START_ADAPTER_VERSION,
      host: "gemini-cli",
      host_contract_version: GEMINI_SESSION_START_HOST_CONTRACT_VERSION,
      normal_launch_command: "gemini",
      native_start_surface: "SessionStart",
      canonical_config_location: ".gemini/settings.json",
      delivery_mode: "hookSpecificOutput.additionalContext",
    },
    identity: {
      agent_id: binding.agent_id,
      project: binding.project,
      workspace_sha256: sha256(binding.workspace ? resolve(binding.workspace) : "invalid"),
      binding_source_ref: binding.binding_source_ref,
      runtime: "gemini-cli",
      verified: input.identityVerified,
    },
    hook: {
      session_id: input.hookInput?.session_id ?? null,
      source: input.hookInput?.source ?? null,
      timestamp: input.hookInput?.timestamp ?? null,
      cwd_sha256: input.hookInput ? sha256(resolve(input.hookInput.cwd)) : null,
      input_valid: input.hookInput !== undefined,
      strict_json_stdout: true,
    },
    timing: {
      started_at: new Date(input.startedAt).toISOString(),
      completed_at: new Date(input.completedAt).toISOString(),
      elapsed_ms: Math.max(0, input.completedAt - input.startedAt),
      internal_timeout_ms: binding.timeout_ms,
      hook_timeout_ms: GEMINI_SESSION_START_HOOK_TIMEOUT_MS,
      t0_process_start_at: null,
      t1_injection_confirmed_at: null,
      t2_orientation_complete_at: null,
      t3_safe_action_started_at: null,
      t4_useful_result_at: null,
    },
    output: input.recovery ? outputMetrics(input.recovery, binding) : emptyOutputMetrics(binding),
    recovery_pack: input.recoveryPack ?? emptyPackEvidence(),
    trust: {
      hook_execution_observed: input.hookInput !== undefined,
      hook_trust_verified_by_adapter: false,
      configuration_state: input.hookInput ? "placed_not_delivered" : "unknown",
      changed_hook_requires_operator_review: true,
    },
    delivery: {
      status: "degraded",
      emission_status: input.recovery ? "emitted" : "not_emitted",
      first_context_delivery_confirmed: false,
    },
    outcome: input.outcome,
    degraded_reason: input.reason,
    ordinary_launch_usable: true,
    recovery_quality_log_ref: input.recoveryQualityLogRef,
    forbidden_effects: {
      automatic_restart_count: 0,
      process_kill_count: 0,
      tui_write_count: 0,
      tmux_send_keys_count: 0,
      clipboard_write_count: 0,
      aun_queue_mutation_count: 0,
      running_session_injection_count: 0,
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new GeminiHookDegradedError("RECOVERY_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function loadGeminiRecoveryFromStore(
  binding: GeminiSessionStartBinding,
  input: GeminiSessionStartInput,
): Promise<LoadedGeminiRecovery> {
  const store = await createStore();
  try {
    const packTokenBudget = Math.max(500, binding.max_tokens - 150);
    const packData = await loadRestartPackData(store, {
      agent_id: binding.agent_id,
      project: binding.project,
      max_tokens: packTokenBudget,
    });
    const pack = buildRecoveryPackArtifact(packData);
    const recovery = enforceCodexRecoveryCaps(
      recoveryFromPack(buildRestartPack(packData), pack, binding),
      binding,
    );
    const recoveryPack = packEvidence(pack);
    const qualityId = await store.logRecoveryQuality({
      agent_id: binding.agent_id,
      session_id: input.session_id,
      recovered_tokens: recovery.token_estimate,
      notes: JSON.stringify({
        schema_version: GEMINI_SESSION_START_EVIDENCE_SCHEMA,
        source: "gemini_native_session_start",
        host_adapter: GEMINI_SESSION_START_ADAPTER_ID,
        host_adapter_level: 2,
        host_contract_version: GEMINI_SESSION_START_HOST_CONTRACT_VERSION,
        native_start_surface: "SessionStart",
        start_source: input.source,
        binding_source_ref: redactText(binding.binding_source_ref).text,
        workspace_sha256: sha256(binding.workspace),
        recovery_pack: recoveryPack,
        output: outputMetrics(recovery, binding),
        delivery_status: "degraded",
        emission_status: "emitted",
        first_context_delivery_confirmed: false,
        recovery_deadline_ms: binding.timeout_ms,
        ordinary_launch_usable: true,
        automatic_restart: false,
        tui_write_count: 0,
        aun_queue_mutation_count: 0,
      }),
    });
    return {
      recovery,
      recovery_pack: recoveryPack,
      recovery_quality_log_ref: qualityId ? `recovery_quality_log:${qualityId}` : null,
    };
  } finally {
    await store.close();
  }
}

function reasonFromError(error: unknown): GeminiSessionStartDegradedReason {
  return error instanceof GeminiHookDegradedError ? error.reason : "RECOVERY_UNAVAILABLE";
}

export async function runGeminiSessionStart(
  rawInput: string,
  rawBinding: GeminiSessionStartBinding,
  dependencies: GeminiSessionStartDependencies = {},
): Promise<GeminiSessionStartRunResult> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  let binding = safeBindingForEvidence(rawBinding);
  let hookInput: GeminiSessionStartInput | undefined;
  let identityVerified = false;
  try {
    binding = normalizeGeminiSessionStartBinding(rawBinding);
    hookInput = parseGeminiSessionStartInput(rawInput);
    verifyGeminiHookWorkspace(binding, hookInput);
    identityVerified = true;
    const loaded = await withTimeout(
      (dependencies.loadRecovery ?? loadGeminiRecoveryFromStore)(binding, hookInput),
      binding.timeout_ms,
    );
    const recovery = enforceCodexRecoveryCaps(loaded.recovery, binding);
    const evidenceLogMissing = loaded.recovery_quality_log_ref === null;
    const completedAt = now();
    const evidence = buildEvidence({
      binding,
      hookInput,
      identityVerified,
      startedAt,
      completedAt,
      recovery,
      recoveryPack: loaded.recovery_pack,
      outcome: evidenceLogMissing ? "degraded" : "full",
      reason: evidenceLogMissing ? "EVIDENCE_LOG_UNAVAILABLE" : null,
      recoveryQualityLogRef: loaded.recovery_quality_log_ref,
    });
    return {
      output: {
        continue: true,
        suppressOutput: false,
        ...(evidenceLogMissing
          ? { systemMessage: "Wasurezu recovery loaded, but evidence logging is unavailable; this run cannot count as alpha evidence." }
          : {}),
        hookSpecificOutput: { additionalContext: recovery.text },
      },
      evidence,
      exit_code: 0,
    };
  } catch (error) {
    const reason = reasonFromError(error);
    const completedAt = now();
    return {
      output: degradedOutput(reason),
      evidence: buildEvidence({
        binding,
        hookInput,
        identityVerified,
        startedAt,
        completedAt,
        outcome: "degraded",
        reason,
        recoveryQualityLogRef: null,
      }),
      exit_code: 0,
    };
  }
}

function parsePositiveInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} must be a positive integer`);
  return parsed;
}

export function parseGeminiSessionStartArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): GeminiSessionStartBinding {
  const values: Record<string, string | undefined> = {
    agent_id: env.AGENT_MEMORY_AGENT_ID,
    project: env.AGENT_MEMORY_PROJECT,
    workspace: env.AGENT_MEMORY_WORKSPACE,
    binding_source_ref: env.AGENT_MEMORY_BINDING_SOURCE_REF,
  };
  let maxTokens = GEMINI_SESSION_START_MAX_TOKENS;
  let maxBytes = GEMINI_SESSION_START_MAX_BYTES;
  let timeoutMs = GEMINI_SESSION_START_INTERNAL_TIMEOUT_MS;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = () => {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === "--agent-id") values.agent_id = next();
    else if (arg === "--project") values.project = next();
    else if (arg === "--workspace") values.workspace = next();
    else if (arg === "--binding-source-ref") values.binding_source_ref = next();
    else if (arg === "--max-tokens") maxTokens = parsePositiveInteger(next(), arg);
    else if (arg === "--max-bytes") maxBytes = parsePositiveInteger(next(), arg);
    else if (arg === "--timeout-ms") timeoutMs = parsePositiveInteger(next(), arg);
    else if (arg === "--adapter-id") {
      if (next() !== GEMINI_SESSION_START_ADAPTER_ID) throw new Error("unsupported adapter id");
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return {
    agent_id: values.agent_id ?? "",
    project: values.project ?? "",
    workspace: values.workspace ?? "",
    binding_source_ref: values.binding_source_ref ?? "",
    max_tokens: maxTokens,
    max_bytes: maxBytes,
    timeout_ms: timeoutMs,
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let byteCount = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteCount += buffer.length;
    if (byteCount > GEMINI_SESSION_START_INPUT_MAX_BYTES) {
      throw new GeminiHookDegradedError("MALFORMED_HOOK_INPUT");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeCliResult(result: GeminiSessionStartRunResult): void {
  let pendingWrites = 2;
  const finished = () => {
    pendingWrites--;
    if (pendingWrites === 0) process.exit(0);
  };
  process.stderr.write(`${JSON.stringify(result.evidence)}\n`, finished);
  process.stdout.write(`${JSON.stringify(result.output)}\n`, finished);
}

async function main(): Promise<void> {
  let rawInput = "";
  let binding: GeminiSessionStartBinding | undefined;
  try {
    binding = parseGeminiSessionStartArgs(process.argv.slice(2));
    rawInput = await readStdin();
  } catch (error) {
    const evidenceBinding = binding ?? {
      agent_id: process.env.AGENT_MEMORY_AGENT_ID ?? "invalid",
      project: process.env.AGENT_MEMORY_PROJECT ?? "invalid",
      workspace: process.env.AGENT_MEMORY_WORKSPACE ?? "",
      binding_source_ref: process.env.AGENT_MEMORY_BINDING_SOURCE_REF ?? "invalid",
      max_tokens: GEMINI_SESSION_START_MAX_TOKENS,
      max_bytes: GEMINI_SESSION_START_MAX_BYTES,
      timeout_ms: GEMINI_SESSION_START_INTERNAL_TIMEOUT_MS,
    };
    const reason = error instanceof GeminiHookDegradedError ? error.reason : "IDENTITY_BINDING_INVALID";
    const observedAt = Date.now();
    writeCliResult({
      output: degradedOutput(reason),
      evidence: buildEvidence({
        binding: evidenceBinding,
        identityVerified: false,
        startedAt: observedAt,
        completedAt: observedAt,
        outcome: "degraded",
        reason,
        recoveryQualityLogRef: null,
      }),
      exit_code: 0,
    });
    return;
  }
  writeCliResult(await runGeminiSessionStart(rawInput, binding));
}

const modulePath = realpathSync(fileURLToPath(import.meta.url));
let invokedPath = "";
try {
  invokedPath = process.argv[1] ? realpathSync(resolve(process.argv[1])) : "";
} catch {
  invokedPath = "";
}
if (invokedPath === modulePath) {
  main().catch((error) => {
    process.stderr.write(`[gemini-session-start] ${redactText(String(error)).text}\n`);
    process.stdout.write(`${JSON.stringify(degradedOutput("RECOVERY_UNAVAILABLE"))}\n`, () => process.exit(0));
  });
}
