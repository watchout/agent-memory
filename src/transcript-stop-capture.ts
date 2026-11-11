#!/usr/bin/env node
/**
 * Fail-open Stop hook that durably captures the completed visible turn.
 *
 * SessionStart remains responsible for recovery injection. This adapter runs
 * after every completed Codex/Claude turn and ingests the exact native
 * transcript supplied by the host. Hidden reasoning and protected
 * system/developer bodies remain excluded by the existing source adapters.
 */
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  CODEX_SESSION_START_INPUT_MAX_BYTES,
  CODEX_SESSION_START_INTERNAL_TIMEOUT_MS,
  parseCodexSessionStartArgs,
  type CodexSessionStartBinding,
} from "./codex-session-start.js";
import { parseHookInputShape, type HookInputShape } from "./hook-input.js";
import {
  finishAfterAnswer,
  writeHookInputDiagnostic,
  type HookDiagnosticRequest,
} from "./hook-input-diagnostics.js";
import { redactText } from "./redact.js";
import {
  receiveCurrentSessionTranscript,
  type SessionStartAutoReceiveResult,
  type SessionStartTranscriptHost,
} from "./session-start-auto-receive.js";
import { receiptOutcome, type ReceiptOutcome } from "./claude-transcript-identity.js";
import { createStore } from "./stores/index.js";
import type { Store } from "./stores/types.js";

export const CODEX_TRANSCRIPT_STOP_ADAPTER_ID = "wasurezu-codex-transcript-stop" as const;
export const CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID = "wasurezu-claude-transcript-stop" as const;
export const TRANSCRIPT_STOP_ADAPTER_VERSION = "1.0.0" as const;
export const TRANSCRIPT_STOP_HOOK_TIMEOUT_SECONDS = 9;
export const TRANSCRIPT_CAPTURE_TAIL_BYTES = 4 * 1024 * 1024;

const OPTIONAL_INPUT_FIELDS = [
  "agent_id",
  "agent_type",
  "last_assistant_message",
  "model",
  "permission_mode",
  "prompt",
  "stop_hook_active",
  "turn_id",
] as const;
const REQUIRED_INPUT_FIELDS = ["cwd", "hook_event_name", "session_id", "transcript_path"] as const;
const INPUT_SHAPE: HookInputShape = {
  required: REQUIRED_INPUT_FIELDS,
  optional: OPTIONAL_INPUT_FIELDS,
  max_bytes: CODEX_SESSION_START_INPUT_MAX_BYTES,
};

export type TranscriptStopHost = "codex" | "claude_code";

export interface TranscriptStopInput {
  cwd: string;
  hook_event_name: "Stop" | "UserPromptSubmit";
  session_id: string;
  transcript_path: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
}

export interface TranscriptStopRunResult {
  output: { continue: true; suppressOutput: true };
  evidence: {
    schema_version: "wasurezu-transcript-stop-capture/v1";
    adapter_id: typeof CODEX_TRANSCRIPT_STOP_ADAPTER_ID | typeof CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID;
    adapter_version: typeof TRANSCRIPT_STOP_ADAPTER_VERSION;
    host: TranscriptStopHost;
    agent_id: string;
    project: string;
    session_id: string | null;
    hook_event_name: "Stop" | "UserPromptSubmit" | null;
    status: "captured" | "skipped" | "failed_open";
    reason: SessionStartAutoReceiveResult["reason"] | "malformed_input" | "identity_binding_invalid";
    /** FR8 R7: ingested / refused (reason code) / unobserved. Unobserved is never success. */
    outcome: ReceiptOutcome;
    events_saved: number;
    events_duplicate: number;
    /** FR8 R5 (Claude only): numbers kept for the receipt, not a gate. */
    cwd_kinds?: number;
    records_outside_workspace?: number;
    private_reasoning_persisted: false;
    protected_instruction_bodies_persisted: false;
  };
}

export interface TranscriptStopDependencies {
  receive?: typeof receiveCurrentSessionTranscript;
  createStore?: () => Promise<Store>;
  /** Called once with the key names the entry does not know, right after the parser accepts the input. */
  on_ignored_names?: (names: readonly string[]) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && !value.includes("\0");
}

export function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function parseTranscriptStopInput(raw: string): TranscriptStopInput {
  return parseTranscriptStopInputWithIgnored(raw).input;
}

/** Same checks as parseTranscriptStopInput; also reports the names of keys the entry does not know. */
export function parseTranscriptStopInputWithIgnored(
  raw: string,
): { input: TranscriptStopInput; ignored_names: readonly string[] } {
  const shape = parseHookInputShape(raw, INPUT_SHAPE);
  if (!shape.ok) throw new Error("malformed_input");
  const { fields } = shape;
  const hookEventName = fields.get("hook_event_name");
  const cwd = fields.get("cwd");
  const sessionId = fields.get("session_id");
  const transcriptPath = fields.get("transcript_path");
  const stopHookActive = fields.get("stop_hook_active");
  const lastAssistantMessage = fields.get("last_assistant_message");
  if (
    !(hookEventName === "Stop" || hookEventName === "UserPromptSubmit") ||
    !nonEmptyText(cwd) ||
    !nonEmptyText(sessionId) ||
    !nonEmptyText(transcriptPath)
  ) {
    throw new Error("malformed_input");
  }
  return {
    input: {
      cwd,
      hook_event_name: hookEventName,
      session_id: sessionId,
      transcript_path: transcriptPath,
      ...(typeof stopHookActive === "boolean" ? { stop_hook_active: stopHookActive } : {}),
      ...(typeof lastAssistantMessage === "string" ? { last_assistant_message: lastAssistantMessage } : {}),
    },
    ignored_names: shape.ignored_names,
  };
}

function adapterId(host: TranscriptStopHost) {
  return host === "codex" ? CODEX_TRANSCRIPT_STOP_ADAPTER_ID : CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID;
}

function failedResult(
  host: TranscriptStopHost,
  binding: CodexSessionStartBinding,
  reason: "malformed_input" | "identity_binding_invalid" | "ingest_failed",
  sessionId: string | null = null,
  hookEventName: "Stop" | "UserPromptSubmit" | null = null,
): TranscriptStopRunResult {
  return {
    output: { continue: true, suppressOutput: true },
    evidence: {
      schema_version: "wasurezu-transcript-stop-capture/v1",
      adapter_id: adapterId(host),
      adapter_version: TRANSCRIPT_STOP_ADAPTER_VERSION,
      host,
      agent_id: binding.agent_id || "invalid",
      project: binding.project || "invalid",
      session_id: sessionId,
      hook_event_name: hookEventName,
      status: "failed_open",
      reason,
      outcome: receiptOutcome({ status: "failed_open", reason }),
      events_saved: 0,
      events_duplicate: 0,
      private_reasoning_persisted: false,
      protected_instruction_bodies_persisted: false,
    },
  };
}

/**
 * Claude Code identity does not use the hook's cwd (FR8 R1): after a `cd` it can
 * legitimately be outside the declared workspace, so only the declared workspace
 * itself is checked there. Codex keeps its cwd binding.
 */
export function verifyBinding(
  binding: CodexSessionStartBinding,
  input: TranscriptStopInput,
  host: TranscriptStopHost,
): void {
  if (!nonEmptyText(binding.agent_id) || !nonEmptyText(binding.project) || !nonEmptyText(binding.workspace) ||
    !nonEmptyText(binding.binding_source_ref)) throw new Error("identity_binding_invalid");
  const workspace = realpathSync(resolve(binding.workspace));
  if (host === "claude_code") return;
  const cwd = realpathSync(resolve(input.cwd));
  if (!isWithin(workspace, cwd)) throw new Error("identity_binding_invalid");
}

export async function runTranscriptStopCapture(
  raw: string,
  host: TranscriptStopHost,
  binding: CodexSessionStartBinding,
  dependencies: TranscriptStopDependencies = {},
): Promise<TranscriptStopRunResult> {
  let input: TranscriptStopInput;
  try {
    const parsed = parseTranscriptStopInputWithIgnored(raw);
    input = parsed.input;
    dependencies.on_ignored_names?.(parsed.ignored_names);
  } catch {
    return failedResult(host, binding, "malformed_input");
  }
  try {
    verifyBinding(binding, input, host);
  } catch {
    return failedResult(host, binding, "identity_binding_invalid", input.session_id, input.hook_event_name);
  }

  try {
    const store = await (dependencies.createStore ?? (() => createStore({ skipPostgresMigrations: true })))();
    try {
      const result = await (dependencies.receive ?? receiveCurrentSessionTranscript)(store, {
        host: host satisfies SessionStartTranscriptHost,
        agent_id: binding.agent_id,
        project: binding.project,
        workspace: binding.workspace,
        cwd: input.cwd,
        session_id: input.session_id,
        transcript_path: input.transcript_path,
        snapshot_mode: "tail",
        tail_bytes: TRANSCRIPT_CAPTURE_TAIL_BYTES,
      });
      return {
        output: { continue: true, suppressOutput: true },
        evidence: {
          schema_version: "wasurezu-transcript-stop-capture/v1",
          adapter_id: adapterId(host),
          adapter_version: TRANSCRIPT_STOP_ADAPTER_VERSION,
          host,
          agent_id: binding.agent_id,
          project: binding.project,
          session_id: input.session_id,
          hook_event_name: input.hook_event_name,
          status: result.status,
          reason: result.reason,
          outcome: receiptOutcome(result),
          events_saved: result.events_saved,
          events_duplicate: result.events_duplicate,
          ...(result.cwd_kinds === undefined ? {} : { cwd_kinds: result.cwd_kinds }),
          ...(result.records_outside_workspace === undefined
            ? {}
            : { records_outside_workspace: result.records_outside_workspace }),
          private_reasoning_persisted: false,
          protected_instruction_bodies_persisted: false,
        },
      };
    } finally {
      await store.close().catch(() => undefined);
    }
  } catch {
    return failedResult(host, binding, "ingest_failed", input.session_id, input.hook_event_name);
  }
}

export function parseTranscriptStopArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): { host: TranscriptStopHost; binding: CodexSessionStartBinding } {
  const normalized = args.slice();
  let host: TranscriptStopHost | undefined;
  for (let index = 0; index < normalized.length; index++) {
    if (normalized[index] !== "--adapter-id") continue;
    const value = normalized[index + 1];
    if (value === CODEX_TRANSCRIPT_STOP_ADAPTER_ID) host = "codex";
    else if (value === CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID) host = "claude_code";
    else throw new Error("unsupported adapter id");
    normalized[index + 1] = "wasurezu-codex-session-start";
    index++;
  }
  if (!host) throw new Error("missing adapter id");
  return { host, binding: parseCodexSessionStartArgs(normalized, env) };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > CODEX_SESSION_START_INPUT_MAX_BYTES) throw new Error("malformed_input");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface TranscriptStopProcessIo {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  read_input: () => Promise<string>;
  write_evidence: (line: string, done: () => void) => void;
  write_output: (line: string, done: () => void) => void;
  exit: () => void;
  run_diagnostic: (request: HookDiagnosticRequest) => Promise<unknown> | void;
  /** Monotonic milliseconds; the hook's budget is counted from the first reading. */
  clock: () => number;
  now: () => Date;
  pid: number;
  dependencies?: TranscriptStopDependencies;
}

function writeLines(io: TranscriptStopProcessIo, evidence: readonly string[], output: string): Promise<void> {
  const writes = [
    ...evidence.map((line) => new Promise<void>((done) => io.write_evidence(line, done))),
    new Promise<void>((done) => io.write_output(output, done)),
  ];
  return Promise.all(writes).then(() => undefined);
}

/**
 * The whole process, with every side effect passed in. The answer and the evidence are written and flushed
 * first; only then is the diagnostic of the ignored key names attempted, for at most a bounded wait.
 */
export async function runTranscriptStopProcess(io: TranscriptStopProcessIo): Promise<void> {
  const started = io.clock();
  let host: TranscriptStopHost = "codex";
  let binding: CodexSessionStartBinding = {
    agent_id: io.env.AGENT_MEMORY_AGENT_ID ?? "invalid",
    project: io.env.AGENT_MEMORY_PROJECT ?? "invalid",
    workspace: io.env.AGENT_MEMORY_WORKSPACE ?? "",
    binding_source_ref: io.env.AGENT_MEMORY_BINDING_SOURCE_REF ?? "invalid",
    max_tokens: 1_800,
    max_bytes: 8_192,
    timeout_ms: CODEX_SESSION_START_INTERNAL_TIMEOUT_MS,
  };
  const notes: string[] = [];
  let ignoredNames: readonly string[] = [];
  let result: TranscriptStopRunResult;
  try {
    ({ host, binding } = parseTranscriptStopArgs(io.argv.slice(), io.env));
    const raw = await io.read_input();
    result = await runTranscriptStopCapture(raw, host, binding, {
      ...io.dependencies,
      on_ignored_names: (names) => {
        ignoredNames = names;
      },
    });
  } catch (error) {
    notes.push(`[transcript-stop-capture] ${redactText(String(error)).text}\n`);
    ignoredNames = [];
    result = failedResult(host, binding, "malformed_input");
  }
  await writeLines(io, [...notes, `${JSON.stringify(result.evidence)}\n`], `${JSON.stringify(result.output)}\n`);
  const event = result.evidence.hook_event_name;
  if (ignoredNames.length === 0 || event === null) {
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
        adapter_id: result.evidence.adapter_id,
        event,
        names: ignoredNames,
        now: io.now(),
        pid: io.pid,
      }),
    exit: io.exit,
  });
}

async function main(): Promise<void> {
  await runTranscriptStopProcess({
    argv: process.argv.slice(2),
    env: process.env,
    read_input: readStdin,
    write_evidence: (line, done) => {
      process.stderr.write(line, done);
    },
    write_output: (line, done) => {
      process.stdout.write(line, done);
    },
    exit: () => process.exit(0),
    run_diagnostic: writeHookInputDiagnostic,
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
    process.stderr.write(`[transcript-stop-capture] ${redactText(String(error)).text}\n`);
    process.stdout.write(`${JSON.stringify({ continue: true, suppressOutput: true })}\n`);
  });
}
