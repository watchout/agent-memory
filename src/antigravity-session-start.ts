#!/usr/bin/env node
/** Antigravity CLI v1.1.12 Pre/PostInvocation recovery and receive adapter. */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  enforceCodexRecoveryCaps,
  recoveryFromPack,
  resolveCodexStoreBinding,
  type CodexRecoveryPackEvidence,
  type CodexSessionStartBinding,
  type CodexStoreBindingEvidence,
  type RecoveryOutputWithMetrics,
} from "./codex-session-start.js";
import { emitKusabiSessionStartRuntimeEvent } from "./kusabi-runtime-event-emitter.js";
import { redactText } from "./redact.js";
import { receiveCurrentSessionTranscript, type SessionStartAutoReceiveResult } from "./session-start-auto-receive.js";
import {
  isAntigravityConversationId,
  isCanonicalAbsoluteAntigravityPath,
} from "./antigravity-conversation-ingest.js";
import {
  RECOVERY_PACK_SCHEMA_REF,
  buildRecoveryPackArtifact,
  buildRestartPack,
  loadRestartPackData,
} from "./restart-pack.js";
import { createStore } from "./stores/index.js";

export const ANTIGRAVITY_SESSION_START_ADAPTER_ID = "wasurezu-antigravity-session-start" as const;
export const ANTIGRAVITY_SESSION_START_ADAPTER_VERSION = "1.0.0" as const;
export const ANTIGRAVITY_SESSION_START_EVIDENCE_SCHEMA = "antigravity-session-start-evidence/v1" as const;
export const ANTIGRAVITY_HOST_CONTRACT_VERSION = "1.1.12" as const;
export const ANTIGRAVITY_INPUT_MAX_BYTES = 65_536;
export const ANTIGRAVITY_MAX_TOKENS = 1_800;
export const ANTIGRAVITY_MAX_BYTES = 8_192;
export const ANTIGRAVITY_INTERNAL_TIMEOUT_MS = 7_000;
export const ANTIGRAVITY_HOOK_TIMEOUT_SECONDS = 9;

export type AntigravityHookEvent = "post-invocation" | "pre-invocation";
export type AntigravitySessionStartBinding = CodexSessionStartBinding;

export interface AntigravityHookInput {
  conversationId: string;
  workspacePaths: string[];
  transcriptPath: string;
  artifactDirectoryPath: string;
  modelName?: string;
  invocationNum: number;
  initialNumSteps: number;
}

export interface AntigravityHookOutput {
  injectSteps: Array<{ ephemeralMessage: string }>;
}

export type AntigravityDegradedReason =
  | "MALFORMED_HOOK_INPUT"
  | "IDENTITY_BINDING_INVALID"
  | "WORKSPACE_IDENTITY_MISMATCH"
  | "RECOVERY_TIMEOUT"
  | "RECOVERY_UNAVAILABLE"
  | "EVIDENCE_LOG_UNAVAILABLE";

export interface AntigravityHookEvidence {
  schema_version: typeof ANTIGRAVITY_SESSION_START_EVIDENCE_SCHEMA;
  adapter: { id: typeof ANTIGRAVITY_SESSION_START_ADAPTER_ID; version: typeof ANTIGRAVITY_SESSION_START_ADAPTER_VERSION };
  host_contract_version: typeof ANTIGRAVITY_HOST_CONTRACT_VERSION;
  identity: {
    agent_id: string;
    project: string;
    workspace_sha256: string;
    binding_source_ref: string;
    runtime: "antigravity-cli";
    verified: boolean;
  };
  store_binding: CodexStoreBindingEvidence;
  hook: {
    session_id: string | null;
    event: AntigravityHookEvent;
    invocation_num: number | null;
    initial_num_steps: number | null;
    model_name: string | null;
    input_valid: boolean;
    strict_json_stdout: true;
  };
  timing: { started_at: string; completed_at: string; elapsed_ms: number };
  output: {
    token_estimate: number;
    byte_count: number;
    redaction_count: number;
    injection_count: 0 | 1;
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
  auto_receive: SessionStartAutoReceiveResult;
  outcome: "full" | "degraded";
  degraded_reason: AntigravityDegradedReason | null;
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

export interface LoadedAntigravityHookData {
  auto_receive: SessionStartAutoReceiveResult;
  recovery?: RecoveryOutputWithMetrics;
  recovery_pack?: CodexRecoveryPackEvidence;
  recovery_quality_log_ref: string | null;
  store_binding?: CodexStoreBindingEvidence;
}

export interface AntigravityHookDependencies {
  load?: (
    binding: AntigravitySessionStartBinding,
    input: AntigravityHookInput,
    event: AntigravityHookEvent,
  ) => Promise<LoadedAntigravityHookData>;
  now?: () => number;
}

export interface AntigravityHookRunResult {
  output: AntigravityHookOutput;
  evidence: AntigravityHookEvidence;
  exit_code: 0;
}

class AntigravityHookError extends Error {
  constructor(readonly reason: AntigravityDegradedReason) {
    super(reason);
  }
}

const BASE_REQUIRED = [
  "artifactDirectoryPath", "conversationId", "initialNumSteps", "invocationNum", "transcriptPath", "workspacePaths",
] as const;
export function parseAntigravityHookInput(raw: string, event: AntigravityHookEvent): AntigravityHookInput {
  if (Buffer.byteLength(raw, "utf8") > ANTIGRAVITY_INPUT_MAX_BYTES) throw new AntigravityHookError("MALFORMED_HOOK_INPUT");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new AntigravityHookError("MALFORMED_HOOK_INPUT"); }
  if (!isRecord(value) || !BASE_REQUIRED.every((key) => Object.hasOwn(value, key))) {
    throw new AntigravityHookError("MALFORMED_HOOK_INPUT");
  }
  if (event === "pre-invocation" && (Object.hasOwn(value, "modelOutput") || Object.hasOwn(value, "modelThinking"))) {
    throw new AntigravityHookError("MALFORMED_HOOK_INPUT");
  }
  if (!isAntigravityConversationId(value.conversationId) ||
    !isCanonicalAbsoluteAntigravityPath(value.transcriptPath) ||
    !isCanonicalAbsoluteAntigravityPath(value.artifactDirectoryPath) || !Array.isArray(value.workspacePaths) ||
    value.workspacePaths.length < 1 || value.workspacePaths.some((path) => !isCanonicalAbsoluteAntigravityPath(path)) ||
    !nonNegativeInteger(value.invocationNum) || !nonNegativeInteger(value.initialNumSteps) ||
    (value.modelName !== undefined && typeof value.modelName !== "string")) {
    throw new AntigravityHookError("MALFORMED_HOOK_INPUT");
  }
  return {
    conversationId: value.conversationId,
    workspacePaths: value.workspacePaths as string[],
    transcriptPath: value.transcriptPath,
    artifactDirectoryPath: value.artifactDirectoryPath,
    invocationNum: value.invocationNum,
    initialNumSteps: value.initialNumSteps,
    ...(typeof value.modelName === "string" ? { modelName: value.modelName } : {}),
  };
}

export function normalizeAntigravityBinding(binding: AntigravitySessionStartBinding): AntigravitySessionStartBinding {
  let workspace: string;
  try { workspace = realpathSync(requiredText(binding.workspace)); } catch { throw new AntigravityHookError("IDENTITY_BINDING_INVALID"); }
  return {
    agent_id: requiredText(binding.agent_id),
    project: requiredText(binding.project),
    workspace,
    binding_source_ref: requiredText(binding.binding_source_ref),
    max_tokens: bounded(binding.max_tokens, 500, ANTIGRAVITY_MAX_TOKENS),
    max_bytes: bounded(binding.max_bytes, 1_024, ANTIGRAVITY_MAX_BYTES),
    timeout_ms: bounded(binding.timeout_ms, 100, ANTIGRAVITY_INTERNAL_TIMEOUT_MS),
    ...(binding.runtime_event_manifest_path === undefined ? {} : {
      runtime_event_manifest_path: requiredAbsolutePath(binding.runtime_event_manifest_path),
    }),
  };
}

export function verifyAntigravityWorkspace(binding: AntigravitySessionStartBinding, input: AntigravityHookInput): string {
  const workspace = realpathSync(binding.workspace);
  const paths = input.workspacePaths.map((path) => {
    try { return realpathSync(path); } catch { throw new AntigravityHookError("WORKSPACE_IDENTITY_MISMATCH"); }
  });
  if (!paths.some((path) => path === workspace)) {
    throw new AntigravityHookError("WORKSPACE_IDENTITY_MISMATCH");
  }
  return workspace;
}

export async function loadAntigravityHookDataFromStore(
  binding: AntigravitySessionStartBinding,
  input: AntigravityHookInput,
  event: AntigravityHookEvent,
): Promise<LoadedAntigravityHookData> {
  const storeBinding = resolveCodexStoreBinding();
  const store = await createStore({ skipPostgresMigrations: true });
  try {
    const autoReceive = await receiveCurrentSessionTranscript(store, {
      host: "antigravity_cli",
      agent_id: binding.agent_id,
      project: binding.project,
      workspace: binding.workspace,
      cwd: binding.workspace,
      session_id: input.conversationId,
      transcript_path: input.transcriptPath,
    });
    if (event !== "pre-invocation" || input.invocationNum !== 0) {
      return { auto_receive: autoReceive, recovery_quality_log_ref: null, store_binding: storeBinding };
    }
    const packData = await loadRestartPackData(store, {
      agent_id: binding.agent_id,
      project: binding.project,
      max_tokens: Math.max(500, binding.max_tokens - 150),
    });
    const pack = buildRecoveryPackArtifact(packData);
    const recovery = enforceCodexRecoveryCaps(recoveryFromPack(buildRestartPack(packData), pack, binding), binding);
    const recoveryPack: CodexRecoveryPackEvidence = {
      pack_ref: pack.pack_id,
      schema_ref: pack.schema_ref ?? RECOVERY_PACK_SCHEMA_REF,
      token_budget: pack.token_budget,
      confidence: pack.confidence,
      missing_context: pack.missing_context.slice(),
      source_refs: pack.source_refs?.slice() ?? [],
      policy_version: pack.policy_version ?? null,
    };
    const qualityId = await store.logRecoveryQuality({
      agent_id: binding.agent_id,
      session_id: input.conversationId,
      recovered_tokens: recovery.token_estimate,
      notes: JSON.stringify({
        schema_version: ANTIGRAVITY_SESSION_START_EVIDENCE_SCHEMA,
        source: "antigravity_cli_pre_invocation",
        host_adapter: ANTIGRAVITY_SESSION_START_ADAPTER_ID,
        host_contract_version: ANTIGRAVITY_HOST_CONTRACT_VERSION,
        auto_receive: autoReceive,
        invocation_num: input.invocationNum,
        binding_source_ref: redactText(binding.binding_source_ref).text,
      }),
    });
    return {
      auto_receive: autoReceive,
      recovery,
      recovery_pack: recoveryPack,
      recovery_quality_log_ref: qualityId ? `recovery_quality_log:${qualityId}` : null,
      store_binding: storeBinding,
    };
  } finally {
    await store.close();
  }
}

export async function runAntigravityHook(
  rawInput: string,
  rawBinding: AntigravitySessionStartBinding,
  event: AntigravityHookEvent,
  dependencies: AntigravityHookDependencies = {},
): Promise<AntigravityHookRunResult> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  let binding = safeBinding(rawBinding);
  let input: AntigravityHookInput | undefined;
  let verified = false;
  try {
    binding = normalizeAntigravityBinding(rawBinding);
    input = parseAntigravityHookInput(rawInput, event);
    verifyAntigravityWorkspace(binding, input);
    verified = true;
    const loaded = await withTimeout((dependencies.load ?? loadAntigravityHookDataFromStore)(binding, input, event), binding.timeout_ms);
    const recovery = loaded.recovery === undefined ? undefined : enforceCodexRecoveryCaps(loaded.recovery, binding);
    const firstPre = event === "pre-invocation" && input.invocationNum === 0;
    if (firstPre && (!recovery || !loaded.recovery_pack)) throw new AntigravityHookError("RECOVERY_UNAVAILABLE");
    const evidenceMissing = firstPre && loaded.recovery_quality_log_ref === null;
    return {
      output: { injectSteps: firstPre && recovery ? [{ ephemeralMessage: recovery.text }] : [] },
      evidence: buildEvidence({
        binding, input, event, verified, startedAt, completedAt: now(), loaded,
        outcome: evidenceMissing ? "degraded" : "full",
        reason: evidenceMissing ? "EVIDENCE_LOG_UNAVAILABLE" : null,
      }),
      exit_code: 0,
    };
  } catch (error) {
    return {
      output: { injectSteps: [] },
      evidence: buildEvidence({
        binding, input, event, verified, startedAt, completedAt: now(),
        outcome: "degraded", reason: error instanceof AntigravityHookError ? error.reason : "RECOVERY_UNAVAILABLE",
      }),
      exit_code: 0,
    };
  }
}

function buildEvidence(value: {
  binding: AntigravitySessionStartBinding;
  input?: AntigravityHookInput;
  event: AntigravityHookEvent;
  verified: boolean;
  startedAt: number;
  completedAt: number;
  loaded?: LoadedAntigravityHookData;
  outcome: "full" | "degraded";
  reason: AntigravityDegradedReason | null;
}): AntigravityHookEvidence {
  const recovery = value.loaded?.recovery;
  return {
    schema_version: ANTIGRAVITY_SESSION_START_EVIDENCE_SCHEMA,
    adapter: { id: ANTIGRAVITY_SESSION_START_ADAPTER_ID, version: ANTIGRAVITY_SESSION_START_ADAPTER_VERSION },
    host_contract_version: ANTIGRAVITY_HOST_CONTRACT_VERSION,
    identity: {
      agent_id: value.binding.agent_id,
      project: value.binding.project,
      workspace_sha256: sha256(resolve(value.binding.workspace || "invalid")),
      binding_source_ref: redactText(value.binding.binding_source_ref).text,
      runtime: "antigravity-cli",
      verified: value.verified,
    },
    store_binding: value.loaded?.store_binding ?? unknownStoreBinding(),
    hook: {
      session_id: value.input?.conversationId ?? null,
      event: value.event,
      invocation_num: value.input?.invocationNum ?? null,
      initial_num_steps: value.input?.initialNumSteps ?? null,
      model_name: value.input?.modelName ?? null,
      input_valid: value.input !== undefined,
      strict_json_stdout: true,
    },
    timing: {
      started_at: new Date(value.startedAt).toISOString(),
      completed_at: new Date(value.completedAt).toISOString(),
      elapsed_ms: Math.max(0, value.completedAt - value.startedAt),
    },
    output: {
      token_estimate: recovery?.token_estimate ?? 0,
      byte_count: recovery?.byte_count ?? 0,
      redaction_count: recovery?.redaction_count ?? 0,
      injection_count: value.event === "pre-invocation" && value.input?.invocationNum === 0 && recovery ? 1 : 0,
    },
    recovery_pack: value.loaded?.recovery_pack ?? emptyPackEvidence(),
    auto_receive: value.loaded?.auto_receive ?? skippedAutoReceive(),
    outcome: value.outcome,
    degraded_reason: value.reason,
    recovery_quality_log_ref: value.loaded?.recovery_quality_log_ref ?? null,
    forbidden_effects: {
      automatic_restart_count: 0, process_kill_count: 0, tui_write_count: 0, tmux_send_keys_count: 0,
      clipboard_write_count: 0, aun_queue_mutation_count: 0, running_session_injection_count: 0,
    },
  };
}

function parseArgs(args: string[], env: NodeJS.ProcessEnv = process.env): { binding: AntigravitySessionStartBinding; event: AntigravityHookEvent } {
  const values: Record<string, string | undefined> = {
    agent_id: env.AGENT_MEMORY_AGENT_ID,
    project: env.AGENT_MEMORY_PROJECT,
    workspace: env.AGENT_MEMORY_WORKSPACE,
    binding_source_ref: env.AGENT_MEMORY_BINDING_SOURCE_REF,
  };
  let event: AntigravityHookEvent | undefined;
  let max_tokens = ANTIGRAVITY_MAX_TOKENS;
  let max_bytes = ANTIGRAVITY_MAX_BYTES;
  let timeout_ms = ANTIGRAVITY_INTERNAL_TIMEOUT_MS;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = () => { const item = args[++index]; if (!item) throw new Error(`${arg} requires a value`); return item; };
    if (arg === "--adapter-id" && next() !== ANTIGRAVITY_SESSION_START_ADAPTER_ID) throw new Error("unsupported adapter id");
    else if (arg === "--hook-event") { const item = next(); if (item !== "pre-invocation" && item !== "post-invocation") throw new Error("invalid hook event"); event = item; }
    else if (arg === "--agent-id") values.agent_id = next();
    else if (arg === "--project") values.project = next();
    else if (arg === "--workspace") values.workspace = next();
    else if (arg === "--binding-source-ref") values.binding_source_ref = next();
    else if (arg === "--max-tokens") max_tokens = Number(next());
    else if (arg === "--max-bytes") max_bytes = Number(next());
    else if (arg === "--timeout-ms") timeout_ms = Number(next());
    else if (arg === "--runtime-event-manifest") values.runtime_event_manifest_path = next();
    else if (arg !== "--adapter-id") throw new Error(`unknown argument: ${arg}`);
  }
  if (!event) throw new Error("--hook-event is required");
  return { event, binding: {
    agent_id: values.agent_id ?? "", project: values.project ?? "", workspace: values.workspace ?? "",
    binding_source_ref: values.binding_source_ref ?? "", max_tokens, max_bytes, timeout_ms,
    ...(values.runtime_event_manifest_path ? { runtime_event_manifest_path: values.runtime_event_manifest_path } : {}),
  } };
}

async function main(): Promise<void> {
  let raw = "";
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(process.argv.slice(2));
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > ANTIGRAVITY_INPUT_MAX_BYTES) throw new Error("input too large");
      chunks.push(buffer);
    }
    raw = Buffer.concat(chunks).toString("utf8");
  } catch (error) {
    process.stderr.write(`[antigravity-session-start] ${redactText(String(error)).text}\n`);
    process.stdout.write('{"injectSteps":[]}\n');
    return;
  }
  const result = await runAntigravityHook(raw, parsed.binding, parsed.event);
  if (parsed.event === "pre-invocation") {
    await emitKusabiSessionStartRuntimeEvent(result.evidence, { manifestPath: parsed.binding.runtime_event_manifest_path });
  }
  process.stderr.write(`${JSON.stringify(result.evidence)}\n`);
  process.stdout.write(`${JSON.stringify(result.output)}\n`);
}

function safeBinding(binding: AntigravitySessionStartBinding): AntigravitySessionStartBinding {
  return {
    agent_id: canonicalText(binding.agent_id) ? binding.agent_id : "invalid",
    project: canonicalText(binding.project) ? binding.project : "invalid",
    workspace: typeof binding.workspace === "string" ? binding.workspace : "",
    binding_source_ref: canonicalText(binding.binding_source_ref) ? binding.binding_source_ref : "invalid",
    max_tokens: Number.isInteger(binding.max_tokens) ? binding.max_tokens : ANTIGRAVITY_MAX_TOKENS,
    max_bytes: Number.isInteger(binding.max_bytes) ? binding.max_bytes : ANTIGRAVITY_MAX_BYTES,
    timeout_ms: Number.isInteger(binding.timeout_ms) ? binding.timeout_ms : ANTIGRAVITY_INTERNAL_TIMEOUT_MS,
  };
}

function unknownStoreBinding(): CodexStoreBindingEvidence {
  return { source: "unknown", backend_intent: "unknown", config_path_sha256: null, binding_sha256: null, verified: false, credentials_embedded: false };
}
function emptyPackEvidence(): AntigravityHookEvidence["recovery_pack"] {
  return { pack_ref: null, schema_ref: null, token_budget: null, confidence: null, missing_context: [], source_refs: [], policy_version: null };
}
function skippedAutoReceive(): SessionStartAutoReceiveResult {
  return { status: "skipped", reason: "transcript_unavailable", events_saved: 0, events_duplicate: 0 };
}
function canonicalText(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.trim() === value && !value.includes("\0"); }
function requiredText(value: unknown): string { if (!canonicalText(value)) throw new AntigravityHookError("IDENTITY_BINDING_INVALID"); return value; }
function nonNegativeInteger(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0; }
function bounded(value: number, min: number, max: number): number { if (!Number.isInteger(value) || value < min || value > max) throw new AntigravityHookError("IDENTITY_BINDING_INVALID"); return value; }
function requiredAbsolutePath(value: string): string { if (!canonicalText(value) || !isAbsolute(value) || resolve(value) !== value) throw new AntigravityHookError("IDENTITY_BINDING_INVALID"); return value; }
function isWithin(parent: string, child: string): boolean { const item = relative(resolve(parent), resolve(child)); return item === "" || (!item.startsWith("..") && !isAbsolute(item)); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AntigravityHookError("RECOVERY_TIMEOUT")), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}

let invoked = "";
try { invoked = process.argv[1] ? realpathSync(resolve(process.argv[1])) : ""; } catch { invoked = ""; }
if (invoked === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`[antigravity-session-start] ${redactText(String(error)).text}\n`);
    process.stdout.write('{"injectSteps":[]}\n');
  });
}
