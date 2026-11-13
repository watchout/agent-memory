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
import { performance } from "node:perf_hooks";
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
import { parseHookInputShape, type HookInputShape } from "./hook-input.js";
import {
  finishAfterAnswer,
  writeHookInputDiagnostic,
  type HookDiagnosticRequest,
} from "./hook-input-diagnostics.js";
import { emitKusabiSessionStartRuntimeEvent } from "./kusabi-runtime-event-emitter.js";
import { redactText } from "./redact.js";
import { answerHookAndCommit, writeLine, type CommitSeams } from "./rotation-commit.js";
import {
  prepareRotationRecovery,
  type RotationCommitPlan,
  type RotationStartDependencies,
  type RotationStartEvidence,
} from "./session-rotation-start.js";
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
export const CLAUDE_SESSION_START_ADAPTER_VERSION = "1.0.3" as const;
export const CLAUDE_SESSION_START_EVIDENCE_SCHEMA = "claude-session-start-evidence/v1" as const;
// The Claude Code version this adapter's input and evidence contract was verified against.
// It is not the host's version at run time (the deployment health check records that).
export const CLAUDE_SESSION_START_HOST_CONTRACT_VERSION = "2.1.220" as const;
export const CLAUDE_SESSION_START_MODEL_UNSPECIFIED = "claude-code-host-unspecified" as const;
export const CLAUDE_SESSION_START_INPUT_MAX_BYTES = CODEX_SESSION_START_INPUT_MAX_BYTES;
export const CLAUDE_SESSION_START_MAX_TOKENS = CODEX_SESSION_START_MAX_TOKENS;
export const CLAUDE_SESSION_START_MAX_BYTES = CODEX_SESSION_START_MAX_BYTES;
export const CLAUDE_SESSION_START_INTERNAL_TIMEOUT_MS = CODEX_SESSION_START_INTERNAL_TIMEOUT_MS;
export const CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS = 9;

const START_SOURCES = ["startup", "resume", "clear", "compact"] as const;
const PERMISSION_MODES = [
  "default",
  "manual",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
] as const;
const REQUIRED_FIELDS = [
  "cwd",
  "hook_event_name",
  "session_id",
  "source",
  "transcript_path",
] as const;
const OPTIONAL_FIELDS = ["agent_type", "model", "permission_mode"] as const;
const INPUT_SHAPE: HookInputShape = {
  required: REQUIRED_FIELDS,
  optional: OPTIONAL_FIELDS,
  max_bytes: CLAUDE_SESSION_START_INPUT_MAX_BYTES,
};

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

export type ClaudeSessionStartOutput = Omit<CodexSessionStartOutput, "hookSpecificOutput"> & {
  hookSpecificOutput?: NonNullable<CodexSessionStartOutput["hookSpecificOutput"]> & {
    /** Set only for a session-rotation start (FR6.1). */
    initialUserMessage?: string;
  };
};
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
  /** Used by the default store loader only; an injected loadRecovery is unaffected. */
  rotation?: RotationStartDependencies;
  /** Called once with the key names the host added, right after the Claude parser accepts the input. */
  on_ignored_names?: (names: readonly string[]) => void;
}

export interface ClaudeSessionStartRunResult {
  output: ClaudeSessionStartOutput;
  evidence: ClaudeSessionStartEvidence;
  exit_code: 0;
  rotation_evidence?: RotationStartEvidence;
  rotation_commit?: RotationCommitPlan;
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
  return parseClaudeSessionStartInputWithIgnored(raw).input;
}

/** Same checks as parseClaudeSessionStartInput; also reports the names of keys the entry does not know. */
export function parseClaudeSessionStartInputWithIgnored(
  raw: string,
): { input: ClaudeSessionStartInput; ignored_names: readonly string[] } {
  const shape = parseHookInputShape(raw, INPUT_SHAPE);
  if (!shape.ok) throw new ClaudeInputError("MALFORMED_HOOK_INPUT");
  const { fields } = shape;
  const sessionId = fields.get("session_id");
  const transcriptPath = fields.get("transcript_path");
  const cwd = fields.get("cwd");
  const source = fields.get("source");
  const model = fields.get("model");
  const permissionMode = fields.get("permission_mode");
  const agentType = fields.get("agent_type");
  if (fields.get("hook_event_name") !== "SessionStart") {
    throw new ClaudeInputError("UNSUPPORTED_HOOK_EVENT");
  }
  if (typeof source !== "string" || !START_SOURCES.includes(source as ClaudeSessionStartSource)) {
    throw new ClaudeInputError("UNSUPPORTED_START_SOURCE");
  }
  if (
    !nonEmptyString(sessionId) ||
    !nonEmptyString(transcriptPath) ||
    !nonEmptyString(cwd) ||
    !(model === undefined || typeof model === "string") ||
    !(
      permissionMode === undefined ||
      (
        typeof permissionMode === "string" &&
        PERMISSION_MODES.includes(permissionMode as ClaudeSessionStartPermissionMode)
      )
    ) ||
    !(agentType === undefined || nonEmptyString(agentType))
  ) {
    throw new ClaudeInputError("MALFORMED_HOOK_INPUT");
  }
  return {
    input: {
      session_id: sessionId,
      transcript_path: transcriptPath,
      cwd,
      hook_event_name: "SessionStart",
      // Claude Code 2.1.220 omits model from native SessionStart stdin. Do not
      // infer a model from process state; normalize the omission explicitly.
      model: typeof model === "string" ? model : CLAUDE_SESSION_START_MODEL_UNSPECIFIED,
      source: source as ClaudeSessionStartSource,
      ...(typeof permissionMode === "string"
        ? { permission_mode: permissionMode as ClaudeSessionStartPermissionMode }
        : {}),
      ...(typeof agentType === "string" ? { agent_type: agentType } : {}),
    },
    ignored_names: shape.ignored_names,
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
      input.permission_mode === undefined || input.permission_mode === "auto" || input.permission_mode === "manual"
        ? "default"
        : input.permission_mode,
    source: input.source,
  };
}

function proxyForInputError(error: ClaudeInputError, raw: string): string {
  if (error.reason === "UNSUPPORTED_HOOK_EVENT" || error.reason === "UNSUPPORTED_START_SOURCE") {
    try {
      const input: unknown = JSON.parse(raw);
      if (isRecord(input)) {
        // Only the keys this entry knows go on: a key the host added never reaches the Codex parser.
        const known: Record<string, unknown> = {};
        for (const key of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
          if (Object.prototype.hasOwnProperty.call(input, key)) known[key] = input[key];
        }
        return JSON.stringify(known.permission_mode === undefined ? { ...known, permission_mode: "default" } : known);
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
  rotationDependencies: RotationStartDependencies = {},
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
    const rotation = await prepareRotationRecovery(store, {
      agent_id: binding.agent_id,
      project: binding.project,
      host: "claude_code",
      session_id: input.session_id,
      source: input.source,
    }, rotationDependencies);
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
      ...(rotation ? { rotation } : {}),
    };
  } finally {
    await store.close();
  }
}

function transformOutput(output: CodexSessionStartOutput, initialUserMessage?: string): ClaudeSessionStartOutput {
  return {
    ...output,
    ...(initialUserMessage && output.hookSpecificOutput
      ? { hookSpecificOutput: { ...output.hookSpecificOutput, initialUserMessage } }
      : {}),
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
  let ignoredNames: readonly string[] | undefined;
  let codexRaw = rawInput;
  try {
    const parsed = parseClaudeSessionStartInputWithIgnored(rawInput);
    input = parsed.input;
    ignoredNames = parsed.ignored_names;
    codexRaw = JSON.stringify(toCodexInput(input));
  } catch (error) {
    codexRaw = error instanceof ClaudeInputError ? proxyForInputError(error, rawInput) : "{}";
  }
  if (ignoredNames !== undefined) dependencies.on_ignored_names?.(ignoredNames);
  let initialUserMessage: string | undefined;
  const codexDependencies: CodexSessionStartDependencies = {
    ...(dependencies.now ? { now: dependencies.now } : {}),
    loadRecovery: async (resolvedBinding) => {
      if (!input) throw new Error("CLAUDE_INPUT_INVALID");
      const loaded = await (dependencies.loadRecovery ??
        ((b, i) => loadClaudeRecoveryFromStore(b, i, dependencies.rotation)))(resolvedBinding, input);
      initialUserMessage = loaded.rotation?.initial_user_message;
      return loaded;
    },
  };
  const result = await runCodexSessionStart(codexRaw, binding, codexDependencies);
  return {
    output: transformOutput(result.output, initialUserMessage),
    evidence: transformEvidence(result.evidence, input),
    exit_code: 0,
    ...(result.rotation_evidence ? { rotation_evidence: result.rotation_evidence } : {}),
    ...(result.rotation_commit ? { rotation_commit: result.rotation_commit } : {}),
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

function fallbackBinding(env: NodeJS.ProcessEnv): ClaudeSessionStartBinding {
  return {
    agent_id: env.AGENT_MEMORY_AGENT_ID ?? "invalid",
    project: env.AGENT_MEMORY_PROJECT ?? "invalid",
    workspace: env.AGENT_MEMORY_WORKSPACE ?? "",
    binding_source_ref: env.AGENT_MEMORY_BINDING_SOURCE_REF ?? "invalid",
    max_tokens: CLAUDE_SESSION_START_MAX_TOKENS,
    max_bytes: CLAUDE_SESSION_START_MAX_BYTES,
    timeout_ms: CLAUDE_SESSION_START_INTERNAL_TIMEOUT_MS,
    runtime_event_manifest_path: undefined,
  };
}

export interface ClaudeSessionStartProcessIo extends CommitSeams {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  read_input: () => Promise<string>;
  write_evidence: (line: string, done: (error?: Error | null) => void) => void;
  write_output: (line: string, done: (error?: Error | null) => void) => void;
  exit: () => void;
  run_diagnostic: (request: HookDiagnosticRequest) => Promise<unknown> | void;
  emit_runtime_event: (
    evidence: ClaudeSessionStartEvidence,
    options: { manifestPath?: string },
  ) => Promise<unknown>;
  /** Monotonic milliseconds; the hook's budget is counted from the first reading. */
  clock: () => number;
  now: () => Date;
  pid: number;
  dependencies?: ClaudeSessionStartDependencies;
}

/**
 * The whole process, with every side effect passed in. The answer and the evidence are written and flushed
 * first, then the hand-off is committed (record, then consume; FR11); only then is the diagnostic of the
 * ignored key names attempted, for at most a bounded wait.
 */
export async function runClaudeSessionStartProcess(io: ClaudeSessionStartProcessIo): Promise<void> {
  const started = io.clock();
  let binding = fallbackBinding(io.env);
  let bound = false;
  let raw = "{}";
  try {
    binding = parseClaudeSessionStartArgs(io.argv.slice(), io.env);
    bound = true;
    raw = await io.read_input();
  } catch {
    // The normal runner below emits a structured, non-blocking degradation.
  }
  let ignoredNames: readonly string[] = [];
  const result = await runClaudeSessionStart(raw, binding, {
    ...io.dependencies,
    on_ignored_names: (names) => {
      ignoredNames = names;
    },
  });
  await io.emit_runtime_event(result.evidence, { manifestPath: binding.runtime_event_manifest_path });
  await answerHookAndCommit(io, result, started, CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS * 1_000);
  if (!bound || ignoredNames.length === 0) {
    io.exit();
    return;
  }
  finishAfterAnswer({
    remaining_ms: binding.timeout_ms - (io.clock() - started),
    run_diagnostic: () =>
      io.run_diagnostic({
        env: io.env,
        agent_id: binding.agent_id,
        project: binding.project,
        adapter_id: CLAUDE_SESSION_START_ADAPTER_ID,
        event: "SessionStart",
        names: ignoredNames,
        now: io.now(),
        pid: io.pid,
      }),
    exit: io.exit,
  });
}

async function main(): Promise<void> {
  await runClaudeSessionStartProcess({
    argv: process.argv.slice(2),
    env: process.env,
    read_input: readStdin,
    write_evidence: (line, done) => {
      writeLine(process.stderr, line, done);
    },
    write_output: (line, done) => {
      writeLine(process.stdout, line, done);
    },
    exit: () => process.exit(0),
    run_diagnostic: writeHookInputDiagnostic,
    emit_runtime_event: emitKusabiSessionStartRuntimeEvent,
    clock: () => performance.now(),
    now: () => new Date(),
    pid: process.pid,
  });
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
