#!/usr/bin/env node
/**
 * Native Claude Code SessionStart adapter.
 *
 * Claude Code invokes this command from a native SessionStart hook and passes
 * JSON on stdin. The adapter returns one JSON object on stdout and writes one
 * schema-shaped evidence object to stderr. It does not launch Claude, mutate a
 * TUI, or own session lifecycle.
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CODEX_SESSION_START_INPUT_MAX_BYTES,
  CODEX_SESSION_START_INTERNAL_TIMEOUT_MS,
  CODEX_SESSION_START_MAX_BYTES,
  CODEX_SESSION_START_MAX_TOKENS,
  enforceCodexRecoveryCaps,
  parseCodexSessionStartArgs,
  recoveryFromPack,
  resolveCodexStoreBinding,
  runCodexSessionStart,
  type CodexRecoveryPackEvidence,
  type CodexSessionStartBinding,
  type CodexSessionStartDependencies,
  type CodexSessionStartEvidence,
  type CodexSessionStartInput,
  type CodexSessionStartOutput,
  type LoadedCodexRecovery,
  type RecoveryOutputWithMetrics,
} from "./codex-session-start.js";
import { emitKusabiSessionStartRuntimeEvent } from "./kusabi-runtime-event-emitter.js";
import { redactText } from "./redact.js";
import { receiveCurrentSessionTranscript } from "./session-start-auto-receive.js";
import {
  RECOVERY_PACK_SCHEMA_REF,
  buildRecoveryPackArtifact,
  buildRestartPack,
  loadRestartPackData,
  type RecoveryPackArtifact,
} from "./restart-pack.js";
import { createStore } from "./stores/index.js";

export const CLAUDE_SESSION_START_ADAPTER_ID = "wasurezu-claude-session-start" as const;
export const CLAUDE_SESSION_START_ADAPTER_VERSION = "1.0.2" as const;
export const CLAUDE_SESSION_START_EVIDENCE_SCHEMA = "claude-session-start-evidence/v1" as const;
export const CLAUDE_SESSION_START_HOST_CONTRACT_VERSION = "2026-07-27" as const;
export const CLAUDE_SESSION_START_INPUT_MAX_BYTES = CODEX_SESSION_START_INPUT_MAX_BYTES;
export const CLAUDE_SESSION_START_MAX_TOKENS = CODEX_SESSION_START_MAX_TOKENS;
export const CLAUDE_SESSION_START_MAX_BYTES = CODEX_SESSION_START_MAX_BYTES;
export const CLAUDE_SESSION_START_INTERNAL_TIMEOUT_MS = CODEX_SESSION_START_INTERNAL_TIMEOUT_MS;
export const CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS = 9;

const START_SOURCES = ["startup", "resume", "clear", "compact"] as const;
const PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
] as const;
const REQUIRED_FIELDS = [
  "cwd",
  "hook_event_name",
  "model",
  "session_id",
  "source",
  "transcript_path",
] as const;
const OPTIONAL_FIELDS = ["agent_type", "permission_mode"] as const;

export type ClaudeSessionStartSource = typeof START_SOURCES[number];
export type ClaudeSessionStartPermissionMode = typeof PERMISSION_MODES[number];
export type ClaudeSessionStartBinding = CodexSessionStartBinding;

export interface ClaudeSessionStartInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: "SessionStart";
  model: string;
  permission_mode?: ClaudeSessionStartPermissionMode;
  source: ClaudeSessionStartSource;
  agent_type?: string;
}

export type ClaudeSessionStartOutput = CodexSessionStartOutput;
export type ClaudeSessionStartDegradedReason =
  | "MALFORMED_HOOK_INPUT"
  | "UNSUPPORTED_HOOK_EVENT"
  | "UNSUPPORTED_START_SOURCE"
  | "IDENTITY_BINDING_INVALID"
  | "WORKSPACE_IDENTITY_MISMATCH"
  | "RECOVERY_TIMEOUT"
  | "RECOVERY_UNAVAILABLE"
  | "EVIDENCE_LOG_UNAVAILABLE";

export type ClaudeSessionStartEvidence = Omit<
  CodexSessionStartEvidence,
  "schema_version" | "adapter" | "identity" | "hook" | "timing" | "trust" | "degraded_reason"
> & {
  schema_version: typeof CLAUDE_SESSION_START_EVIDENCE_SCHEMA;
  adapter: {
    id: typeof CLAUDE_SESSION_START_ADAPTER_ID;
    version: typeof CLAUDE_SESSION_START_ADAPTER_VERSION;
    host: "claude-code";
    host_contract_version: typeof CLAUDE_SESSION_START_HOST_CONTRACT_VERSION;
    normal_launch_command: "claude";
    native_start_surface: "SessionStart";
    canonical_config_location: ".claude/settings.json";
    delivery_mode: "hookSpecificOutput.additionalContext";
  };
  identity: Omit<CodexSessionStartEvidence["identity"], "runtime"> & { runtime: "claude-code" };
  hook: Omit<CodexSessionStartEvidence["hook"], "source"> & {
    source: ClaudeSessionStartSource | null;
    permission_mode: ClaudeSessionStartPermissionMode | null;
    agent_type: string | null;
    strict_json_stdout: true;
  };
  timing: CodexSessionStartEvidence["timing"] & { hook_timeout_seconds: number };
  trust: CodexSessionStartEvidence["trust"] & { changed_hook_requires_operator_review: true };
  degraded_reason: ClaudeSessionStartDegradedReason | null;
};

export interface ClaudeSessionStartDependencies {
  loadRecovery?: (
    binding: ClaudeSessionStartBinding,
    input: ClaudeSessionStartInput,
  ) => Promise<LoadedCodexRecovery>;
  now?: () => number;
}

export interface ClaudeSessionStartRunResult {
  output: ClaudeSessionStartOutput;
  evidence: ClaudeSessionStartEvidence;
  exit_code: 0;
}

class ClaudeInputError extends Error {
  constructor(public readonly reason: ClaudeSessionStartDegradedReason) {
    super(reason);
    this.name = "ClaudeInputError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.trim() === value && !value.includes("\0");
}

export function parseClaudeSessionStartInput(raw: string): ClaudeSessionStartInput {
  if (Buffer.byteLength(raw, "utf8") > CLAUDE_SESSION_START_INPUT_MAX_BYTES) {
    throw new ClaudeInputError("MALFORMED_HOOK_INPUT");
  }
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new ClaudeInputError("MALFORMED_HOOK_INPUT");
  }
  if (!isRecord(input)) throw new ClaudeInputError("MALFORMED_HOOK_INPUT");
  const keys = Object.keys(input);
  if (
    !REQUIRED_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(input, field)) ||
    keys.some((field) =>
      !REQUIRED_FIELDS.includes(field as typeof REQUIRED_FIELDS[number]) &&
      !OPTIONAL_FIELDS.includes(field as typeof OPTIONAL_FIELDS[number])
    )
  ) {
    throw new ClaudeInputError("MALFORMED_HOOK_INPUT");
  }
  if (input.hook_event_name !== "SessionStart") {
    throw new ClaudeInputError("UNSUPPORTED_HOOK_EVENT");
  }
  if (typeof input.source !== "string" || !START_SOURCES.includes(input.source as ClaudeSessionStartSource)) {
    throw new ClaudeInputError("UNSUPPORTED_START_SOURCE");
  }
  if (
    !nonEmptyString(input.session_id) ||
    !nonEmptyString(input.transcript_path) ||
    !nonEmptyString(input.cwd) ||
    typeof input.model !== "string" ||
    !(
      input.permission_mode === undefined ||
      (
        typeof input.permission_mode === "string" &&
        PERMISSION_MODES.includes(input.permission_mode as ClaudeSessionStartPermissionMode)
      )
    ) ||
    !(input.agent_type === undefined || nonEmptyString(input.agent_type))
  ) {
    throw new ClaudeInputError("MALFORMED_HOOK_INPUT");
  }
  return {
    session_id: input.session_id,
    transcript_path: input.transcript_path,
    cwd: input.cwd,
    hook_event_name: "SessionStart",
    model: input.model,
    source: input.source as ClaudeSessionStartSource,
    ...(typeof input.permission_mode === "string"
      ? { permission_mode: input.permission_mode as ClaudeSessionStartPermissionMode }
      : {}),
    ...(typeof input.agent_type === "string" ? { agent_type: input.agent_type } : {}),
  };
}

function toCodexInput(input: ClaudeSessionStartInput): CodexSessionStartInput {
  return {
    session_id: input.session_id,
    transcript_path: input.transcript_path,
    cwd: input.cwd,
    hook_event_name: "SessionStart",
    model: input.model,
    permission_mode:
      input.permission_mode === undefined || input.permission_mode === "auto"
        ? "default"
        : input.permission_mode,
    source: input.source,
  };
}

function proxyForInputError(error: ClaudeInputError, raw: string): string {
  if (error.reason === "UNSUPPORTED_HOOK_EVENT" || error.reason === "UNSUPPORTED_START_SOURCE") {
    try {
      const input: unknown = JSON.parse(raw);
      if (isRecord(input) && input.permission_mode === undefined) {
        return JSON.stringify({ ...input, permission_mode: "default" });
      }
    } catch {
      // The original parser has already classified this input.
    }
    return raw;
  }
  return "{}";
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

function outputMetrics(recovery: RecoveryOutputWithMetrics, binding: ClaudeSessionStartBinding) {
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function loadClaudeRecoveryFromStore(
  binding: ClaudeSessionStartBinding,
  input: ClaudeSessionStartInput,
): Promise<LoadedCodexRecovery> {
  const storeBinding = resolveCodexStoreBinding();
  const store = await createStore({ skipPostgresMigrations: true });
  try {
    const autoReceive = await receiveCurrentSessionTranscript(store, {
      host: "claude_code",
      agent_id: binding.agent_id,
      project: binding.project,
      workspace: binding.workspace,
      cwd: input.cwd,
      session_id: input.session_id,
      transcript_path: input.transcript_path,
    });
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
    let qualityId: string | null = null;
    try {
      qualityId = await store.logRecoveryQuality({
        agent_id: binding.agent_id,
        session_id: input.session_id,
        recovered_tokens: recovery.token_estimate,
        notes: JSON.stringify({
          schema_version: CLAUDE_SESSION_START_EVIDENCE_SCHEMA,
          source: "claude_native_session_start",
          host_adapter: CLAUDE_SESSION_START_ADAPTER_ID,
          host_adapter_level: 2,
          host_contract_version: CLAUDE_SESSION_START_HOST_CONTRACT_VERSION,
          native_start_surface: "SessionStart",
          start_source: input.source,
          binding_source_ref: redactText(binding.binding_source_ref).text,
          workspace_sha256: sha256(binding.workspace),
          auto_receive: autoReceive,
          recovery_pack: recoveryPack,
          output: outputMetrics(recovery, binding),
          delivery_status: "degraded",
          emission_status: "emitted",
          first_context_delivery_confirmed: false,
          recovery_deadline_ms: binding.timeout_ms,
          hook_timeout_seconds: CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS,
          ordinary_launch_usable: true,
          automatic_restart: false,
          tui_write_count: 0,
          aun_queue_mutation_count: 0,
        }),
      });
    } catch {
      qualityId = null;
    }
    return {
      recovery,
      recovery_pack: recoveryPack,
      recovery_quality_log_ref: qualityId ? `recovery_quality_log:${qualityId}` : null,
      store_binding: storeBinding,
    };
  } finally {
    await store.close();
  }
}

function transformOutput(output: CodexSessionStartOutput): ClaudeSessionStartOutput {
  return {
    ...output,
    ...(output.systemMessage
      ? { systemMessage: output.systemMessage.replaceAll("Codex", "Claude Code") }
      : {}),
  };
}

function transformEvidence(
  evidence: CodexSessionStartEvidence,
  input?: ClaudeSessionStartInput,
): ClaudeSessionStartEvidence {
  return {
    ...evidence,
    schema_version: CLAUDE_SESSION_START_EVIDENCE_SCHEMA,
    adapter: {
      id: CLAUDE_SESSION_START_ADAPTER_ID,
      version: CLAUDE_SESSION_START_ADAPTER_VERSION,
      host: "claude-code",
      host_contract_version: CLAUDE_SESSION_START_HOST_CONTRACT_VERSION,
      normal_launch_command: "claude",
      native_start_surface: "SessionStart",
      canonical_config_location: ".claude/settings.json",
      delivery_mode: "hookSpecificOutput.additionalContext",
    },
    identity: { ...evidence.identity, runtime: "claude-code" },
    hook: {
      ...evidence.hook,
      source: input?.source ?? null,
      permission_mode: input?.permission_mode ?? null,
      agent_type: input?.agent_type ?? null,
      strict_json_stdout: true,
    },
    timing: {
      ...evidence.timing,
      hook_timeout_seconds: CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS,
    },
    trust: {
      ...evidence.trust,
      changed_hook_requires_operator_review: true,
    },
    degraded_reason: evidence.degraded_reason as ClaudeSessionStartDegradedReason | null,
  };
}

export async function runClaudeSessionStart(
  rawInput: string,
  binding: ClaudeSessionStartBinding,
  dependencies: ClaudeSessionStartDependencies = {},
): Promise<ClaudeSessionStartRunResult> {
  let input: ClaudeSessionStartInput | undefined;
  let codexRaw = rawInput;
  try {
    input = parseClaudeSessionStartInput(rawInput);
    codexRaw = JSON.stringify(toCodexInput(input));
  } catch (error) {
    codexRaw = error instanceof ClaudeInputError ? proxyForInputError(error, rawInput) : "{}";
  }
  const codexDependencies: CodexSessionStartDependencies = {
    ...(dependencies.now ? { now: dependencies.now } : {}),
    loadRecovery: async (resolvedBinding) => {
      if (!input) throw new Error("CLAUDE_INPUT_INVALID");
      return (dependencies.loadRecovery ?? loadClaudeRecoveryFromStore)(resolvedBinding, input);
    },
  };
  const result = await runCodexSessionStart(codexRaw, binding, codexDependencies);
  return {
    output: transformOutput(result.output),
    evidence: transformEvidence(result.evidence, input),
    exit_code: 0,
  };
}

export function parseClaudeSessionStartArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): ClaudeSessionStartBinding {
  const normalized = args.slice();
  for (let index = 0; index < normalized.length; index++) {
    if (normalized[index] === "--adapter-id") {
      if (normalized[index + 1] !== CLAUDE_SESSION_START_ADAPTER_ID) {
        throw new Error("unsupported adapter id");
      }
      normalized[index + 1] = "wasurezu-codex-session-start";
      index++;
    }
  }
  return parseCodexSessionStartArgs(normalized, env);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > CLAUDE_SESSION_START_INPUT_MAX_BYTES) throw new ClaudeInputError("MALFORMED_HOOK_INPUT");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function fallbackBinding(): ClaudeSessionStartBinding {
  return {
    agent_id: process.env.AGENT_MEMORY_AGENT_ID ?? "invalid",
    project: process.env.AGENT_MEMORY_PROJECT ?? "invalid",
    workspace: process.env.AGENT_MEMORY_WORKSPACE ?? "",
    binding_source_ref: process.env.AGENT_MEMORY_BINDING_SOURCE_REF ?? "invalid",
    max_tokens: CLAUDE_SESSION_START_MAX_TOKENS,
    max_bytes: CLAUDE_SESSION_START_MAX_BYTES,
    timeout_ms: CLAUDE_SESSION_START_INTERNAL_TIMEOUT_MS,
  };
}

function writeCliResult(result: ClaudeSessionStartRunResult): void {
  let pending = 2;
  const done = () => {
    pending--;
    if (pending === 0) process.exit(0);
  };
  process.stderr.write(`${JSON.stringify(result.evidence)}\n`, done);
  process.stdout.write(`${JSON.stringify(result.output)}\n`, done);
}

async function main(): Promise<void> {
  let binding = fallbackBinding();
  let raw = "{}";
  try {
    binding = parseClaudeSessionStartArgs(process.argv.slice(2));
    raw = await readStdin();
  } catch {
    // The normal runner below emits a structured, non-blocking degradation.
  }
  const result = await runClaudeSessionStart(raw, binding);
  await emitKusabiSessionStartRuntimeEvent(result.evidence);
  writeCliResult(result);
}

let invokedPath = "";
try {
  invokedPath = process.argv[1] ? realpathSync(resolve(process.argv[1])) : "";
} catch {
  invokedPath = "";
}
if (invokedPath === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`[claude-session-start] ${redactText(String(error)).text}\n`);
    process.stdout.write(`${JSON.stringify({
      continue: true,
      suppressOutput: false,
      systemMessage: "Wasurezu startup recovery degraded (RECOVERY_UNAVAILABLE); Claude Code continued with ordinary startup.",
    })}\n`, () => process.exit(0));
  });
}
