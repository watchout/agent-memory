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
import { fileURLToPath } from "node:url";
import {
  CODEX_SESSION_START_INPUT_MAX_BYTES,
  CODEX_SESSION_START_INTERNAL_TIMEOUT_MS,
  parseCodexSessionStartArgs,
  type CodexSessionStartBinding,
} from "./codex-session-start.js";
import { redactText } from "./redact.js";
import {
  receiveCurrentSessionTranscript,
  type SessionStartAutoReceiveResult,
  type SessionStartTranscriptHost,
} from "./session-start-auto-receive.js";
import { createStore } from "./stores/index.js";
import type { Store } from "./stores/types.js";

export const CODEX_TRANSCRIPT_STOP_ADAPTER_ID = "wasurezu-codex-transcript-stop" as const;
export const CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID = "wasurezu-claude-transcript-stop" as const;
export const TRANSCRIPT_STOP_ADAPTER_VERSION = "1.0.0" as const;
export const TRANSCRIPT_STOP_HOOK_TIMEOUT_SECONDS = 9;
export const TRANSCRIPT_CAPTURE_TAIL_BYTES = 4 * 1024 * 1024;

const OPTIONAL_INPUT_FIELDS = new Set([
  "agent_id",
  "agent_type",
  "last_assistant_message",
  "model",
  "permission_mode",
  "prompt",
  "stop_hook_active",
  "turn_id",
]);
const REQUIRED_INPUT_FIELDS = ["cwd", "hook_event_name", "session_id", "transcript_path"] as const;

export type TranscriptStopHost = "codex" | "claude_code";

export interface TranscriptStopInput {
  cwd: string;
  hook_event_name: "Stop" | "UserPromptSubmit";
  session_id: string;
  transcript_path: string;
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
    events_saved: number;
    events_duplicate: number;
    private_reasoning_persisted: false;
    protected_instruction_bodies_persisted: false;
  };
}

export interface TranscriptStopDependencies {
  receive?: typeof receiveCurrentSessionTranscript;
  createStore?: () => Promise<Store>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && !value.includes("\0");
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function parseTranscriptStopInput(raw: string): TranscriptStopInput {
  if (Buffer.byteLength(raw, "utf8") > CODEX_SESSION_START_INPUT_MAX_BYTES) throw new Error("malformed_input");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("malformed_input");
  }
  if (!isRecord(value)) throw new Error("malformed_input");
  const allowed = new Set<string>([...REQUIRED_INPUT_FIELDS, ...OPTIONAL_INPUT_FIELDS]);
  if (Object.keys(value).some((key) => !allowed.has(key)) ||
    !REQUIRED_INPUT_FIELDS.every((key) => Object.prototype.hasOwnProperty.call(value, key)) ||
    !(value.hook_event_name === "Stop" || value.hook_event_name === "UserPromptSubmit") ||
    !nonEmptyText(value.cwd) ||
    !nonEmptyText(value.session_id) ||
    !nonEmptyText(value.transcript_path)) {
    throw new Error("malformed_input");
  }
  return {
    cwd: value.cwd,
    hook_event_name: value.hook_event_name,
    session_id: value.session_id,
    transcript_path: value.transcript_path,
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
      events_saved: 0,
      events_duplicate: 0,
      private_reasoning_persisted: false,
      protected_instruction_bodies_persisted: false,
    },
  };
}

function verifyBinding(binding: CodexSessionStartBinding, input: TranscriptStopInput): void {
  if (!nonEmptyText(binding.agent_id) || !nonEmptyText(binding.project) || !nonEmptyText(binding.workspace) ||
    !nonEmptyText(binding.binding_source_ref)) throw new Error("identity_binding_invalid");
  const workspace = realpathSync(resolve(binding.workspace));
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
    input = parseTranscriptStopInput(raw);
  } catch {
    return failedResult(host, binding, "malformed_input");
  }
  try {
    verifyBinding(binding, input);
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
          events_saved: result.events_saved,
          events_duplicate: result.events_duplicate,
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

function writeResult(result: TranscriptStopRunResult): void {
  process.stderr.write(`${JSON.stringify(result.evidence)}\n`);
  process.stdout.write(`${JSON.stringify(result.output)}\n`);
}

async function main(): Promise<void> {
  let host: TranscriptStopHost = "codex";
  let binding: CodexSessionStartBinding = {
    agent_id: process.env.AGENT_MEMORY_AGENT_ID ?? "invalid",
    project: process.env.AGENT_MEMORY_PROJECT ?? "invalid",
    workspace: process.env.AGENT_MEMORY_WORKSPACE ?? "",
    binding_source_ref: process.env.AGENT_MEMORY_BINDING_SOURCE_REF ?? "invalid",
    max_tokens: 1_800,
    max_bytes: 8_192,
    timeout_ms: CODEX_SESSION_START_INTERNAL_TIMEOUT_MS,
  };
  try {
    ({ host, binding } = parseTranscriptStopArgs(process.argv.slice(2)));
    const raw = await readStdin();
    writeResult(await runTranscriptStopCapture(raw, host, binding));
  } catch (error) {
    process.stderr.write(`[transcript-stop-capture] ${redactText(String(error)).text}\n`);
    writeResult(failedResult(host, binding, "malformed_input"));
  }
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
