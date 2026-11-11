#!/usr/bin/env node
/**
 * Session-rotation Stop / UserPromptSubmit hook (FR1-FR4).
 *
 * Synchronous companion to the async transcript-capture hook: it measures the
 * context volume, asks the seat for one hand-off when the threshold is passed,
 * stores that hand-off in Kusabi's DB, and only then issues the "safe to cut"
 * marker. It never sends keys, never talks to tmux, and never calls an external
 * API. The pure decision core takes time as an argument (standard S4).
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getClaudeProjectsDir } from "./claude-conversation-ingest.js";
import { getCodexSessionsDir } from "./codex-conversation-ingest.js";
import {
  CODEX_SESSION_START_INTERNAL_TIMEOUT_MS,
  type CodexSessionStartBinding,
} from "./codex-session-start.js";
import {
  ROTATION_DEFAULT_THRESHOLD_TOKENS,
  ROTATION_HANDOFF_MAX_CHARS,
  ROTATION_MARKER_TTL_SECONDS,
} from "./constants.js";
import { redactText } from "./redact.js";
import { readBoundedTranscriptTailSnapshot } from "./session-start-auto-receive.js";
import {
  buildMarker,
  readHookState,
  readMarker,
  resolveHostIdentity,
  rotationRoot,
  seatDirectory,
  sha256Hex,
  writeHookState,
  writeMarker,
  writeTurn,
  type HandoffSource,
  type HostIdentity,
  type PsRunner,
} from "./session-rotation-files.js";
import {
  extractLastAssistantText,
  measureContextTokens,
  type ContextMeasurement,
  type RotationHost,
} from "./session-rotation-usage.js";
import { createStore } from "./stores/index.js";
import type { Store } from "./stores/types.js";
import {
  CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID,
  CODEX_TRANSCRIPT_STOP_ADAPTER_ID,
  TRANSCRIPT_CAPTURE_TAIL_BYTES,
  isWithin,
  parseTranscriptStopArgs,
  parseTranscriptStopInput,
  verifyBinding,
  type TranscriptStopInput,
} from "./transcript-stop-capture.js";

export const CODEX_ROTATION_STOP_ADAPTER_ID = "wasurezu-codex-rotation-stop" as const;
export const CLAUDE_ROTATION_STOP_ADAPTER_ID = "wasurezu-claude-rotation-stop" as const;
export const ROTATION_STOP_HOOK_TIMEOUT_SECONDS = 9;
export const ROTATION_STOP_EVIDENCE_SCHEMA = "wasurezu-session-rotation-stop/v1" as const;

export const ROTATION_BLOCK_REASON = [
  "会話の量が切り直しの閾値を超えました。この会話を閉じ、新しい会話で続けます。",
  "ほかの作業は始めず、次の 3 つだけを、見出しを付けて短く書いて終えてください。",
  "- 済んだこと",
  "- 次の 1 歩",
  "- まだ決まっていないこと",
  "書いた文は Kusabi の DB に保存され、新しい会話の頭に入ります。",
].join("\n");

export interface RotationStopOptions {
  threshold_tokens?: number;
  off?: boolean;
}

export type RotationStopAction = "none" | "busy" | "blocked" | "saved" | "failed_open";

export interface RotationStopEvidence {
  schema_version: typeof ROTATION_STOP_EVIDENCE_SCHEMA;
  host: RotationHost;
  agent_id: string;
  project: string;
  session_id: string | null;
  hook_event_name: "Stop" | "UserPromptSubmit" | null;
  action: RotationStopAction;
  reason: string;
  measured_tokens: number | null;
  threshold_tokens: number;
  handoff_source: HandoffSource | null;
  marker_id: string | null;
  keys_sent: 0;
  external_api_calls: 0;
}

export type RotationStopOutput =
  | { continue: true; suppressOutput: true }
  | { decision: "block"; reason: string };

export interface RotationStopResult {
  output: RotationStopOutput;
  evidence: RotationStopEvidence;
}

export interface RotationStopDependencies {
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  identity?: HostIdentity;
  parent_pid?: number;
  ps?: PsRunner;
  rotation_root?: string;
  createStore?: () => Promise<Store>;
  read_transcript?: (host: RotationHost, path: string) => TranscriptTail;
}

export type TranscriptTail = { status: "ok"; lines: string[] } | { status: "unreadable"; reason: string };

export type RotationStopDecision =
  | { action: "mark_busy" }
  | { action: "none"; reason: string }
  | { action: "block"; measured_tokens: number }
  | { action: "save"; answered: boolean; measured_tokens: number };

export interface RotationStopDecisionInput {
  event: "Stop" | "UserPromptSubmit";
  stop_hook_active: boolean;
  measurement: ContextMeasurement;
  threshold_tokens: number;
  /** The volume recorded when this conversation was blocked, or null when it was not blocked. */
  blocked_measured_tokens: number | null;
  marker_for_session: boolean;
}

/** Pure decision core: no clock, no file, no environment. */
export function decideRotationStop(input: RotationStopDecisionInput): RotationStopDecision {
  if (input.event === "UserPromptSubmit") return { action: "mark_busy" };
  if (input.marker_for_session) return { action: "none", reason: "already_saved" };
  if (input.blocked_measured_tokens !== null) {
    return { action: "save", answered: input.stop_hook_active, measured_tokens: input.blocked_measured_tokens };
  }
  if (input.measurement.status === "unmeasured") return { action: "none", reason: `unmeasured:${input.measurement.reason}` };
  if (input.measurement.tokens < input.threshold_tokens) return { action: "none", reason: "below_threshold" };
  return { action: "block", measured_tokens: input.measurement.tokens };
}

const NEXT_STEP_HEADING = /^[\s#>*-]*次の\s*1\s*歩\s*[:：]?\s*(.*)$/;
const OTHER_HEADING = /^[\s#>*-]*(?:済んだこと|まだ決まっていないこと)/;

export function isUsableHandoff(text: string): boolean {
  return text.split("\n").some((line) => NEXT_STEP_HEADING.test(line));
}

/** The seat's "next step" section, or undefined when the text has none. */
export function extractNextStep(text: string): string | undefined {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => NEXT_STEP_HEADING.test(line));
  if (start < 0) return undefined;
  const collected = [NEXT_STEP_HEADING.exec(lines[start])![1]];
  for (const line of lines.slice(start + 1)) {
    if (OTHER_HEADING.test(line)) break;
    collected.push(line);
  }
  const step = collected.join("\n").trim();
  return step === "" ? undefined : step;
}

function boundedHandoff(text: string): string {
  const redacted = redactText(text.trim()).text;
  return redacted.length > ROTATION_HANDOFF_MAX_CHARS
    ? `${redacted.slice(0, ROTATION_HANDOFF_MAX_CHARS)}\n…(hand-off truncated)`
    : redacted;
}

export function readTranscriptTail(host: RotationHost, transcriptPath: string): TranscriptTail {
  const snapshot = readBoundedTranscriptTailSnapshot(host, transcriptPath, TRANSCRIPT_CAPTURE_TAIL_BYTES);
  if (snapshot.status !== "valid") return { status: "unreadable", reason: snapshot.reason };
  try {
    const root = realpathSync(resolve(host === "claude_code" ? getClaudeProjectsDir() : getCodexSessionsDir()));
    if (!isWithin(root, snapshot.path)) return { status: "unreadable", reason: "transcript_outside_host_root" };
  } catch {
    return { status: "unreadable", reason: "transcript_root_unavailable" };
  }
  return { status: "ok", lines: snapshot.raw.split("\n") };
}

function failedEvidence(
  host: RotationHost,
  binding: CodexSessionStartBinding,
  reason: string,
  threshold: number,
  input?: TranscriptStopInput,
): RotationStopEvidence {
  return evidence(host, binding, input, threshold, { action: "failed_open", reason });
}

function evidence(
  host: RotationHost,
  binding: CodexSessionStartBinding,
  input: TranscriptStopInput | undefined,
  threshold: number,
  fields: Partial<RotationStopEvidence> & Pick<RotationStopEvidence, "action" | "reason">,
): RotationStopEvidence {
  return {
    schema_version: ROTATION_STOP_EVIDENCE_SCHEMA,
    host,
    agent_id: binding.agent_id || "invalid",
    project: binding.project || "invalid",
    session_id: input?.session_id ?? null,
    hook_event_name: input?.hook_event_name ?? null,
    measured_tokens: null,
    threshold_tokens: threshold,
    handoff_source: null,
    marker_id: null,
    keys_sent: 0,
    external_api_calls: 0,
    ...fields,
  };
}

const PASS: RotationStopOutput = { continue: true, suppressOutput: true };

interface SaveContext {
  store: Store;
  host: RotationHost;
  binding: CodexSessionStartBinding;
  input: TranscriptStopInput;
  directory: string;
  identity: HostIdentity;
  now: Date;
  measured_tokens: number;
  threshold_tokens: number;
  handoff: { text: string; source: HandoffSource; reason: string };
}

async function saveHandoff(context: SaveContext): Promise<string> {
  const { store, binding, handoff, now } = context;
  const bundleText = handoff.source === "seat_text"
    ? handoff.text
    : `席の引き継ぎの文は取れなかった（${handoff.reason}）。Kusabi の記録だけで続きを組み立てた。`;
  if (handoff.source === "seat_text") {
    await store.saveTaskState({
      agent_id: binding.agent_id,
      project: binding.project,
      task_id: `session-rotation-handoff:${binding.project}`,
      task: "会話の切り直しの引き継ぎ",
      status: "in_progress",
      progress: handoff.text,
      next_steps: extractNextStep(handoff.text),
    });
  }
  const savedAt = now.toISOString();
  const pack = await store.saveSelectedRestartPack({
    agent_id: binding.agent_id,
    project: binding.project,
    content: bundleText,
    source: "restart_prepare",
    metadata: {
      kind: "session_rotation",
      session_id: context.input.session_id,
      host: context.host,
      handoff_source: handoff.source,
      measured_tokens: context.measured_tokens,
      threshold_tokens: context.threshold_tokens,
      saved_at: savedAt,
    },
    expires_at: new Date(now.getTime() + ROTATION_MARKER_TTL_SECONDS * 1_000).toISOString(),
  });
  const marker = buildMarker({
    agent_id: binding.agent_id,
    project: binding.project,
    host: context.host,
    session_id: context.input.session_id,
    ...context.identity,
    pack_ref: pack.pack_ref,
    pack_content_sha256: sha256Hex(bundleText),
    measured_tokens: context.measured_tokens,
    threshold_tokens: context.threshold_tokens,
    saved_at: savedAt,
    handoff_source: handoff.source,
  });
  writeMarker(context.directory, marker);
  return marker.marker_id;
}

function chooseHandoff(
  host: RotationHost,
  lines: string[],
  input: TranscriptStopInput,
  answered: boolean,
): { text: string; source: HandoffSource; reason: string } {
  if (!answered) return { text: "", source: "existing_records", reason: "block_not_answered" };
  const fromTranscript = extractLastAssistantText(host, lines) ?? input.last_assistant_message ?? "";
  if (!isUsableHandoff(fromTranscript)) {
    return { text: "", source: "existing_records", reason: fromTranscript.trim() === "" ? "handoff_empty" : "handoff_shape_invalid" };
  }
  return { text: boundedHandoff(fromTranscript), source: "seat_text", reason: "seat_text" };
}

export async function runSessionRotationStop(
  raw: string,
  host: RotationHost,
  binding: CodexSessionStartBinding,
  options: RotationStopOptions = {},
  dependencies: RotationStopDependencies = {},
): Promise<RotationStopResult> {
  const threshold = options.threshold_tokens ?? ROTATION_DEFAULT_THRESHOLD_TOKENS;
  let input: TranscriptStopInput;
  try {
    input = parseTranscriptStopInput(raw);
  } catch {
    return { output: PASS, evidence: failedEvidence(host, binding, "malformed_input", threshold) };
  }
  if (options.off) {
    return { output: PASS, evidence: evidence(host, binding, input, threshold, { action: "none", reason: "rotation_off" }) };
  }
  let directory: string;
  try {
    verifyBinding(binding, input, host);
    directory = seatDirectory(dependencies.rotation_root ?? rotationRoot(dependencies.env), binding.agent_id, binding.project);
  } catch {
    return { output: PASS, evidence: failedEvidence(host, binding, "identity_binding_invalid", threshold, input) };
  }
  const env = dependencies.env ?? process.env;
  const now = (dependencies.now ?? (() => new Date()))();
  const identity = dependencies.identity ??
    resolveHostIdentity(env, dependencies.parent_pid ?? process.ppid, dependencies.ps);
  const turn = (state: "busy" | "idle") =>
    writeTurn(directory, {
      agent_id: binding.agent_id,
      project: binding.project,
      host,
      session_id: input.session_id,
      state,
      source: null,
      rotation_marker_id: null,
      at: now.toISOString(),
      ...identity,
    });

  try {
    const tail = (dependencies.read_transcript ?? readTranscriptTail)(host, input.transcript_path);
    const lines = tail.status === "ok" ? tail.lines : [];
    const measurement: ContextMeasurement = tail.status === "ok"
      ? measureContextTokens(host, lines)
      : { status: "unmeasured", reason: "no_usage_record" };
    const hookState = readHookState(directory);
    const decision = decideRotationStop({
      event: input.hook_event_name,
      stop_hook_active: input.stop_hook_active === true,
      measurement,
      threshold_tokens: threshold,
      blocked_measured_tokens: hookState?.session_id === input.session_id ? hookState.measured_tokens : null,
      marker_for_session: readMarker(directory)?.session_id === input.session_id,
    });
    const measured = measurement.status === "measured" ? measurement.tokens : null;

    if (decision.action === "mark_busy") {
      turn("busy");
      return { output: PASS, evidence: evidence(host, binding, input, threshold, { action: "busy", reason: "prompt_submitted" }) };
    }
    if (decision.action === "block") {
      writeHookState(directory, {
        session_id: input.session_id,
        blocked_at: now.toISOString(),
        measured_tokens: decision.measured_tokens,
        threshold_tokens: threshold,
      });
      return {
        output: { decision: "block", reason: ROTATION_BLOCK_REASON },
        evidence: evidence(host, binding, input, threshold, { action: "blocked", reason: "threshold_reached", measured_tokens: measured }),
      };
    }
    if (decision.action === "save") {
      const handoff = chooseHandoff(host, lines, input, decision.answered);
      const markerId = await withStore(dependencies, (store) =>
        saveHandoff({
          store,
          host,
          binding,
          input,
          directory,
          identity,
          now,
          measured_tokens: decision.measured_tokens,
          threshold_tokens: threshold,
          handoff,
        }));
      turn("idle");
      return {
        output: PASS,
        evidence: evidence(host, binding, input, threshold, {
          action: "saved",
          reason: handoff.reason,
          measured_tokens: measured,
          handoff_source: handoff.source,
          marker_id: markerId,
        }),
      };
    }
    turn("idle");
    return { output: PASS, evidence: evidence(host, binding, input, threshold, { action: "none", reason: decision.reason, measured_tokens: measured }) };
  } catch {
    return { output: PASS, evidence: failedEvidence(host, binding, "rotation_stop_failed", threshold, input) };
  }
}

async function withStore<T>(dependencies: RotationStopDependencies, work: (store: Store) => Promise<T>): Promise<T> {
  const store = await (dependencies.createStore ?? (() => createStore({ skipPostgresMigrations: true })))();
  try {
    return await work(store);
  } finally {
    await store.close().catch(() => undefined);
  }
}

export function parseRotationStopArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): { host: RotationHost; binding: CodexSessionStartBinding; options: RotationStopOptions } {
  const rest: string[] = [];
  const options: RotationStopOptions = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--rotation-threshold-tokens") {
      const value = Number(args[++index]);
      if (!Number.isInteger(value) || value <= 0) throw new Error("--rotation-threshold-tokens must be a positive integer");
      options.threshold_tokens = value;
    } else if (arg === "--rotation") {
      if (args[++index] !== "off") throw new Error("--rotation only accepts off");
      options.off = true;
    } else if (arg === "--adapter-id") {
      const id = args[++index];
      if (id === CODEX_ROTATION_STOP_ADAPTER_ID) rest.push(arg, CODEX_TRANSCRIPT_STOP_ADAPTER_ID);
      else if (id === CLAUDE_ROTATION_STOP_ADAPTER_ID) rest.push(arg, CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID);
      else throw new Error("unsupported adapter id");
    } else {
      rest.push(arg);
    }
  }
  const parsed = parseTranscriptStopArgs(rest, env);
  return {
    host: parsed.host === "claude_code" ? "claude_code" : "codex",
    binding: parsed.binding,
    options,
  };
}

export async function readAll(stream: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export interface RotationCliIo {
  argv: string[];
  env: NodeJS.ProcessEnv;
  read_input: () => Promise<string>;
  write_evidence: (line: string) => void;
  write_output: (line: string) => void;
  dependencies?: RotationStopDependencies;
}

/** The hook command: arguments and standard input in, evidence on stderr, hook output on stdout. */
export async function runRotationCli(io: RotationCliIo): Promise<void> {
  let host: RotationHost = "codex";
  let binding: CodexSessionStartBinding = {
    agent_id: io.env.AGENT_MEMORY_AGENT_ID ?? "invalid",
    project: io.env.AGENT_MEMORY_PROJECT ?? "invalid",
    workspace: io.env.AGENT_MEMORY_WORKSPACE ?? "",
    binding_source_ref: io.env.AGENT_MEMORY_BINDING_SOURCE_REF ?? "invalid",
    max_tokens: 1_800,
    max_bytes: 8_192,
    timeout_ms: CODEX_SESSION_START_INTERNAL_TIMEOUT_MS,
  };
  let result: RotationStopResult;
  try {
    const parsed = parseRotationStopArgs(io.argv, io.env);
    host = parsed.host;
    binding = parsed.binding;
    result = await runSessionRotationStop(await io.read_input(), host, binding, parsed.options, io.dependencies);
  } catch {
    result = {
      output: PASS,
      evidence: failedEvidence(host, binding, "malformed_input", ROTATION_DEFAULT_THRESHOLD_TOKENS),
    };
  }
  io.write_evidence(`${JSON.stringify(result.evidence)}\n`);
  io.write_output(`${JSON.stringify(result.output)}\n`);
}

async function main(): Promise<void> {
  await runRotationCli({
    argv: process.argv.slice(2),
    env: process.env,
    read_input: () => readAll(process.stdin),
    write_evidence: (line) => { process.stderr.write(line); },
    write_output: (line) => { process.stdout.write(line); },
  });
}

let invokedPath = "";
try {
  invokedPath = process.argv[1] ? realpathSync(resolve(process.argv[1])) : "";
} catch {
  invokedPath = "";
}
if (invokedPath === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(() => {
    process.stdout.write(`${JSON.stringify(PASS)}\n`);
  });
}
