#!/usr/bin/env node
/** Atomic installer/checker for Claude Code native SessionStart recovery. */
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAUDE_SESSION_START_ADAPTER_ID,
  CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS,
  CLAUDE_SESSION_START_INTERNAL_TIMEOUT_MS,
  CLAUDE_SESSION_START_MAX_BYTES,
  CLAUDE_SESSION_START_MAX_TOKENS,
  type ClaudeSessionStartBinding,
} from "./claude-session-start.js";
import {
  CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID,
  TRANSCRIPT_STOP_HOOK_TIMEOUT_SECONDS,
} from "./transcript-stop-capture.js";

export const CLAUDE_HOOK_CONFIG_RELATIVE_PATH = ".claude/settings.json" as const;
export const CLAUDE_HOOK_MATCHER = "startup|resume|clear|compact" as const;
export const CLAUDE_HOOK_STATUS_MESSAGE = "Recovering prior work with Wasurezu" as const;
export const CLAUDE_TRANSCRIPT_STOP_STATUS_MESSAGE = "Saving conversation with Wasurezu" as const;

export type ClaudeHookInstallMode = "check" | "dry-run" | "apply";

export interface ClaudeHookInstallOptions {
  mode: ClaudeHookInstallMode;
  workspace: string;
  runtime_root: string;
  agent_id: string;
  project: string;
  binding_source_ref: string;
  max_tokens?: number;
  max_bytes?: number;
  timeout_ms?: number;
  create_backup?: boolean;
  runtime_event_manifest_path?: string;
}

export interface ClaudeHookInstallReport {
  schema_version: "claude-hook-install-report/v1";
  adapter_id: typeof CLAUDE_SESSION_START_ADAPTER_ID;
  mode: ClaudeHookInstallMode;
  settings_file: string;
  placement_status: "absent" | "placed_not_delivered";
  config_match: "absent" | "different" | "exact";
  would_change: boolean;
  wrote_settings_file: boolean;
  backup_file: string | null;
  managed_hook_group_count: 3;
  unrelated_hook_handler_count_before: number;
  unrelated_hook_handler_count_after: number;
  trust_verified: false;
  first_context_delivered: false;
  changed_hook_requires_operator_review: true;
  ordinary_launch_command: "claude";
  native_start_surface: "SessionStart";
  next_action: "install" | "review_current_project_settings" | "verify_first_context_delivery";
}

export interface ParsedClaudeHookCommand {
  node_executable: string;
  runner: string;
  runtime_root: string;
  binding: ClaudeSessionStartBinding;
}

interface HookHandler extends Record<string, unknown> {
  type: "command";
  command: string;
  timeout: number;
  statusMessage: string;
}

interface HookGroup extends Record<string, unknown> {
  matcher?: string;
  hooks: Array<Record<string, unknown>>;
}

export type ClaudeSettingsFile = Record<string, unknown> & {
  hooks: Record<string, unknown> & {
    SessionStart?: HookGroup[];
    Stop?: HookGroup[];
    UserPromptSubmit?: HookGroup[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: string, field: string): string {
  if (!value || value.trim() !== value || value.includes("\0")) {
    throw new Error(`${field} must be a canonical non-empty string`);
  }
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function parseShellWords(command: string): string[] | null {
  const words: string[] = [];
  let word = "";
  let started = false;
  let state: "plain" | "single" | "double" = "plain";
  for (const character of command) {
    if (state === "single") {
      if (character === "'") state = "plain";
      else word += character;
      continue;
    }
    if (state === "double") {
      if (character === '"') state = "plain";
      else if (character === "$" || character === "`" || character === "\\" || character === "\n" || character === "\r") return null;
      else word += character;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        words.push(word);
        word = "";
        started = false;
      }
      continue;
    }
    started = true;
    if (character === "'") state = "single";
    else if (character === '"') state = "double";
    else if (";&|<>`$()\\".includes(character)) return null;
    else word += character;
  }
  if (state !== "plain") return null;
  if (started) words.push(word);
  return words;
}

async function assertNotSymlink(path: string, allowMissing: boolean): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`refusing symlink path: ${path}`);
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

export function buildClaudeHookCommand(
  runtimeRoot: string,
  binding: ClaudeSessionStartBinding,
): string {
  const runner = join(runtimeRoot, "dist", "claude-session-start.js");
  return [
    shellQuote(process.execPath),
    shellQuote(runner),
    "--adapter-id",
    shellQuote(CLAUDE_SESSION_START_ADAPTER_ID),
    "--agent-id",
    shellQuote(binding.agent_id),
    "--project",
    shellQuote(binding.project),
    "--workspace",
    shellQuote(binding.workspace),
    "--binding-source-ref",
    shellQuote(binding.binding_source_ref),
    "--max-tokens",
    String(binding.max_tokens),
    "--max-bytes",
    String(binding.max_bytes),
    "--timeout-ms",
    String(binding.timeout_ms),
    ...(binding.runtime_event_manifest_path === undefined ? [] : [
      "--runtime-event-manifest",
      shellQuote(binding.runtime_event_manifest_path),
    ]),
  ].join(" ");
}

/** Parse only the byte-canonical command emitted by buildClaudeHookCommand. */
export function parseClaudeHookCommand(command: string): ParsedClaudeHookCommand | null {
  const words = parseShellWords(command);
  if (!words || (words.length !== 18 && words.length !== 20)) return null;
  const flags = [
    [2, "--adapter-id"],
    [4, "--agent-id"],
    [6, "--project"],
    [8, "--workspace"],
    [10, "--binding-source-ref"],
    [12, "--max-tokens"],
    [14, "--max-bytes"],
    [16, "--timeout-ms"],
  ] as const;
  if (flags.some(([index, flag]) => words[index] !== flag)) return null;
  if (words[0] !== process.execPath || words[3] !== CLAUDE_SESSION_START_ADAPTER_ID) return null;
  if (!isAbsolute(words[1]) || !isAbsolute(words[9])) return null;
  const runtimeRoot = dirname(dirname(words[1]));
  if (words[1] !== join(runtimeRoot, "dist", "claude-session-start.js")) return null;
  const binding: ClaudeSessionStartBinding = {
    agent_id: words[5],
    project: words[7],
    workspace: words[9],
    binding_source_ref: words[11],
    max_tokens: Number(words[13]),
    max_bytes: Number(words[15]),
    timeout_ms: Number(words[17]),
    ...(words.length === 20 ? { runtime_event_manifest_path: words[19] } : {}),
  };
  try {
    requiredText(binding.agent_id, "agent_id");
    requiredText(binding.project, "project");
    requiredText(binding.workspace, "workspace");
    requiredText(binding.binding_source_ref, "binding_source_ref");
    boundedInteger(binding.max_tokens, 500, CLAUDE_SESSION_START_MAX_TOKENS, "max_tokens");
    boundedInteger(binding.max_bytes, 1_024, CLAUDE_SESSION_START_MAX_BYTES, "max_bytes");
    boundedInteger(binding.timeout_ms, 100, CLAUDE_SESSION_START_INTERNAL_TIMEOUT_MS, "timeout_ms");
    if (words.length === 20 && (words[18] !== "--runtime-event-manifest" ||
      !isAbsolute(words[19]) || resolve(words[19]) !== words[19])) return null;
  } catch {
    return null;
  }
  if (command !== buildClaudeHookCommand(runtimeRoot, binding)) return null;
  return { node_executable: words[0], runner: words[1], runtime_root: runtimeRoot, binding };
}

export function buildClaudeSessionStartHookGroup(
  runtimeRoot: string,
  binding: ClaudeSessionStartBinding,
): HookGroup {
  return {
    matcher: CLAUDE_HOOK_MATCHER,
    hooks: [{
      type: "command",
      command: buildClaudeHookCommand(runtimeRoot, binding),
      timeout: CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS,
      statusMessage: CLAUDE_HOOK_STATUS_MESSAGE,
    } satisfies HookHandler],
  };
}

export function buildClaudeTranscriptStopHookGroup(
  runtimeRoot: string,
  binding: ClaudeSessionStartBinding,
): HookGroup {
  const runner = join(runtimeRoot, "dist", "transcript-stop-capture.js");
  return {
    matcher: "",
    hooks: [{
      type: "command",
      command: [
        shellQuote(process.execPath),
        shellQuote(runner),
        "--adapter-id",
        shellQuote(CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID),
        "--agent-id",
        shellQuote(binding.agent_id),
        "--project",
        shellQuote(binding.project),
        "--workspace",
        shellQuote(binding.workspace),
        "--binding-source-ref",
        shellQuote(binding.binding_source_ref),
        "--max-tokens",
        String(binding.max_tokens),
        "--max-bytes",
        String(binding.max_bytes),
        "--timeout-ms",
        String(binding.timeout_ms),
        ...(binding.runtime_event_manifest_path === undefined ? [] : [
          "--runtime-event-manifest",
          shellQuote(binding.runtime_event_manifest_path),
        ]),
      ].join(" "),
      timeout: TRANSCRIPT_STOP_HOOK_TIMEOUT_SECONDS,
      statusMessage: CLAUDE_TRANSCRIPT_STOP_STATUS_MESSAGE,
      async: true,
    } satisfies HookHandler],
  };
}

function isManagedHandler(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.command === "string" &&
    parseClaudeHookCommand(value.command) !== null;
}

function isManagedTranscriptStopHandler(value: unknown): boolean {
  return isRecord(value) && typeof value.command === "string" &&
    value.command.includes(CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID);
}

function normalizeGroup(value: unknown, index: number): HookGroup {
  if (!isRecord(value) || !Array.isArray(value.hooks)) {
    throw new Error(`hooks.SessionStart[${index}] must be a hook group`);
  }
  if (value.matcher !== undefined && typeof value.matcher !== "string") {
    throw new Error(`hooks.SessionStart[${index}].matcher must be a string`);
  }
  return {
    ...value,
    ...(typeof value.matcher === "string" ? { matcher: value.matcher } : {}),
    hooks: value.hooks.map((hook) => {
      if (!isRecord(hook)) throw new Error(`hooks.SessionStart[${index}] contains an invalid handler`);
      return { ...hook };
    }),
  };
}

export function parseClaudeSettings(raw: string): ClaudeSettingsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("settings.json is not valid JSON");
  }
  if (!isRecord(parsed)) throw new Error("settings.json must contain an object");
  const hooks = parsed.hooks === undefined ? {} : parsed.hooks;
  if (!isRecord(hooks)) throw new Error("settings.json hooks must be an object");
  const sessionStart = hooks.SessionStart;
  if (sessionStart !== undefined && !Array.isArray(sessionStart)) {
    throw new Error("hooks.SessionStart must be an array");
  }
  const stop = hooks.Stop;
  if (stop !== undefined && !Array.isArray(stop)) {
    throw new Error("hooks.Stop must be an array");
  }
  const userPromptSubmit = hooks.UserPromptSubmit;
  if (userPromptSubmit !== undefined && !Array.isArray(userPromptSubmit)) {
    throw new Error("hooks.UserPromptSubmit must be an array");
  }
  return {
    ...parsed,
    hooks: {
      ...hooks,
      ...(Array.isArray(sessionStart)
        ? { SessionStart: sessionStart.map((group, index) => normalizeGroup(group, index)) }
        : {}),
      ...(Array.isArray(stop)
        ? { Stop: stop.map((group, index) => normalizeGroup(group, index)) }
        : {}),
      ...(Array.isArray(userPromptSubmit)
        ? { UserPromptSubmit: userPromptSubmit.map((group, index) => normalizeGroup(group, index)) }
        : {}),
    },
  };
}

export function mergeClaudeSessionStartHook(
  existing: ClaudeSettingsFile,
  runtimeRoot: string,
  binding: ClaudeSessionStartBinding,
): { settings: ClaudeSettingsFile; unrelatedBefore: number; unrelatedAfter: number } {
  const groups = existing.hooks.SessionStart ?? [];
  let unrelatedBefore = 0;
  const preserved: HookGroup[] = [];
  for (const group of groups) {
    const unrelated = group.hooks.filter((handler) => !isManagedHandler(handler));
    unrelatedBefore += unrelated.length;
    if (unrelated.length > 0) preserved.push({ ...group, hooks: unrelated });
  }
  const stopGroups = existing.hooks.Stop ?? [];
  const preservedStop: HookGroup[] = [];
  for (const group of stopGroups) {
    const unrelated = group.hooks.filter((handler) => !isManagedTranscriptStopHandler(handler));
    unrelatedBefore += unrelated.length;
    if (unrelated.length > 0) preservedStop.push({ ...group, hooks: unrelated });
  }
  const promptGroups = existing.hooks.UserPromptSubmit ?? [];
  const preservedPrompt: HookGroup[] = [];
  for (const group of promptGroups) {
    const unrelated = group.hooks.filter((handler) => !isManagedTranscriptStopHandler(handler));
    unrelatedBefore += unrelated.length;
    if (unrelated.length > 0) preservedPrompt.push({ ...group, hooks: unrelated });
  }
  const nextGroups = [...preserved, buildClaudeSessionStartHookGroup(runtimeRoot, binding)];
  const nextStopGroups = [...preservedStop, buildClaudeTranscriptStopHookGroup(runtimeRoot, binding)];
  const nextPromptGroups = [...preservedPrompt, buildClaudeTranscriptStopHookGroup(runtimeRoot, binding)];
  return {
    settings: {
      ...existing,
      hooks: {
        ...existing.hooks,
        SessionStart: nextGroups,
        Stop: nextStopGroups,
        UserPromptSubmit: nextPromptGroups,
      },
    },
    unrelatedBefore,
    unrelatedAfter:
      nextGroups.flatMap((group) => group.hooks).filter((handler) => !isManagedHandler(handler)).length +
      nextStopGroups.flatMap((group) => group.hooks).filter((handler) => !isManagedTranscriptStopHandler(handler)).length +
      nextPromptGroups.flatMap((group) => group.hooks).filter((handler) => !isManagedTranscriptStopHandler(handler)).length,
  };
}

function canonicalJson(value: ClaudeSettingsFile): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function defaultSettings(): ClaudeSettingsFile {
  return { hooks: {} };
}

async function readExisting(path: string): Promise<{ raw: string | null; settings: ClaudeSettingsFile }> {
  try {
    const raw = await readFile(path, "utf8");
    return { raw, settings: parseClaudeSettings(raw) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { raw: null, settings: defaultSettings() };
    throw error;
  }
}

export async function installClaudeSessionStartHook(
  options: ClaudeHookInstallOptions,
): Promise<ClaudeHookInstallReport> {
  const workspace = await realpath(requiredText(options.workspace, "workspace"));
  const runtimeRoot = await realpath(requiredText(options.runtime_root, "runtime_root"));
  const runner = join(runtimeRoot, "dist", "claude-session-start.js");
  const runnerInfo = await lstat(runner);
  if (!runnerInfo.isFile() || runnerInfo.isSymbolicLink()) throw new Error(`invalid hook runner: ${runner}`);
  const captureRunner = join(runtimeRoot, "dist", "transcript-stop-capture.js");
  const captureRunnerInfo = await lstat(captureRunner);
  if (!captureRunnerInfo.isFile() || captureRunnerInfo.isSymbolicLink()) {
    throw new Error(`invalid hook runner: ${captureRunner}`);
  }
  const binding: ClaudeSessionStartBinding = {
    agent_id: requiredText(options.agent_id, "agent_id"),
    project: requiredText(options.project, "project"),
    workspace,
    binding_source_ref: requiredText(options.binding_source_ref, "binding_source_ref"),
    max_tokens: boundedInteger(options.max_tokens ?? CLAUDE_SESSION_START_MAX_TOKENS, 500, CLAUDE_SESSION_START_MAX_TOKENS, "max_tokens"),
    max_bytes: boundedInteger(options.max_bytes ?? CLAUDE_SESSION_START_MAX_BYTES, 1_024, CLAUDE_SESSION_START_MAX_BYTES, "max_bytes"),
    timeout_ms: boundedInteger(options.timeout_ms ?? CLAUDE_SESSION_START_INTERNAL_TIMEOUT_MS, 100, CLAUDE_SESSION_START_INTERNAL_TIMEOUT_MS, "timeout_ms"),
    ...(options.runtime_event_manifest_path === undefined ? {} : {
      runtime_event_manifest_path: requiredAbsolutePath(options.runtime_event_manifest_path, "runtime_event_manifest_path"),
    }),
  };
  const claudeDir = join(workspace, ".claude");
  const settingsFile = join(claudeDir, "settings.json");
  await assertNotSymlink(claudeDir, true);
  await assertNotSymlink(settingsFile, true);
  const existing = await readExisting(settingsFile);
  const merged = mergeClaudeSessionStartHook(existing.settings, runtimeRoot, binding);
  const desired = canonicalJson(merged.settings);
  const configMatch = existing.raw === null
    ? "absent" as const
    : canonicalJson(existing.settings) === desired
      ? "exact" as const
      : "different" as const;
  const wouldChange = configMatch !== "exact";
  let backupFile: string | null = null;
  let wroteSettingsFile = false;
  if (options.mode === "apply" && wouldChange) {
    await mkdir(claudeDir, { recursive: true });
    await assertNotSymlink(claudeDir, false);
    if (existing.raw !== null && options.create_backup !== false) {
      backupFile = `${settingsFile}.bak.wasurezu-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
      await copyFile(settingsFile, backupFile);
      await chmod(backupFile, 0o600);
    }
    const temporary = join(claudeDir, `.settings.json.wasurezu-${randomUUID()}.tmp`);
    await writeFile(temporary, desired, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, settingsFile);
    await chmod(settingsFile, 0o600);
    wroteSettingsFile = true;
  }
  const exactAfter = options.mode === "apply" ? true : configMatch === "exact";
  return {
    schema_version: "claude-hook-install-report/v1",
    adapter_id: CLAUDE_SESSION_START_ADAPTER_ID,
    mode: options.mode,
    settings_file: settingsFile,
    placement_status: existing.raw === null && options.mode !== "apply" ? "absent" : "placed_not_delivered",
    config_match: exactAfter ? "exact" : configMatch,
    would_change: wouldChange,
    wrote_settings_file: wroteSettingsFile,
    backup_file: backupFile,
    managed_hook_group_count: 3,
    unrelated_hook_handler_count_before: merged.unrelatedBefore,
    unrelated_hook_handler_count_after: merged.unrelatedAfter,
    trust_verified: false,
    first_context_delivered: false,
    changed_hook_requires_operator_review: true,
    ordinary_launch_command: "claude",
    native_start_surface: "SessionStart",
    next_action: existing.raw === null && options.mode !== "apply"
      ? "install"
      : exactAfter
        ? "review_current_project_settings"
        : "install",
  };
}

function requiredAbsolutePath(value: string, field: string): string {
  requiredText(value, field);
  if (!isAbsolute(value) || resolve(value) !== value) throw new Error(`${field} must be an absolute canonical path`);
  return value;
}

function positiveInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} must be a positive integer`);
  return parsed;
}

export function parseClaudeHookInstallArgs(args: string[]): ClaudeHookInstallOptions {
  let mode: ClaudeHookInstallMode = "check";
  const values: Record<string, string> = {};
  let maxTokens: number | undefined;
  let maxBytes: number | undefined;
  let timeoutMs: number | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = () => {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === "--check") mode = "check";
    else if (arg === "--dry-run") mode = "dry-run";
    else if (arg === "--apply") mode = "apply";
    else if (arg === "--workspace") values.workspace = next();
    else if (arg === "--runtime-root") values.runtime_root = next();
    else if (arg === "--agent-id") values.agent_id = next();
    else if (arg === "--project") values.project = next();
    else if (arg === "--binding-source-ref") values.binding_source_ref = next();
    else if (arg === "--max-tokens") maxTokens = positiveInteger(next(), arg);
    else if (arg === "--max-bytes") maxBytes = positiveInteger(next(), arg);
    else if (arg === "--timeout-ms") timeoutMs = positiveInteger(next(), arg);
    else if (arg === "--runtime-event-manifest") values.runtime_event_manifest_path = next();
    else throw new Error(`unknown argument: ${arg}`);
  }
  return {
    mode,
    workspace: values.workspace ?? "",
    runtime_root: values.runtime_root ?? "",
    agent_id: values.agent_id ?? "",
    project: values.project ?? "",
    binding_source_ref: values.binding_source_ref ?? "",
    ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
    ...(maxBytes === undefined ? {} : { max_bytes: maxBytes }),
    ...(timeoutMs === undefined ? {} : { timeout_ms: timeoutMs }),
    ...(values.runtime_event_manifest_path === undefined ? {} : {
      runtime_event_manifest_path: values.runtime_event_manifest_path,
    }),
  };
}

async function main(): Promise<void> {
  const options = parseClaudeHookInstallArgs(process.argv.slice(2));
  const report = await installClaudeSessionStartHook(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (options.mode === "check" && report.config_match !== "exact") process.exitCode = 1;
}

const modulePath = realpathSync(fileURLToPath(import.meta.url));
let invokedPath = "";
try {
  invokedPath = process.argv[1] ? realpathSync(resolve(process.argv[1])) : "";
} catch {
  invokedPath = "";
}
if (modulePath === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`[claude-hook-installer] ${error}\n`);
    process.exit(1);
  });
}
