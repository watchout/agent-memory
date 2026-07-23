#!/usr/bin/env node
/**
 * Deterministic installer/checker for the native Codex SessionStart adapter.
 *
 * Placement is deliberately separate from trust and delivery. This command
 * never changes Codex hook trust and never claims first-context delivery.
 */
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CODEX_SESSION_START_ADAPTER_ID,
  CODEX_SESSION_START_HOOK_TIMEOUT_SECONDS,
  CODEX_SESSION_START_INTERNAL_TIMEOUT_MS,
  CODEX_SESSION_START_MAX_BYTES,
  CODEX_SESSION_START_MAX_TOKENS,
  type CodexSessionStartBinding,
} from "./codex-session-start.js";

export const CODEX_HOOK_CONFIG_RELATIVE_PATH = ".codex/hooks.json" as const;
export const CODEX_HOOK_MATCHER = "startup|resume|clear|compact" as const;
export const CODEX_HOOK_STATUS_MESSAGE = "Recovering prior work with Wasurezu" as const;

export type CodexHookInstallMode = "check" | "dry-run" | "apply";

export interface CodexHookInstallOptions {
  mode: CodexHookInstallMode;
  workspace: string;
  runtime_root: string;
  agent_id: string;
  project: string;
  binding_source_ref: string;
  max_tokens?: number;
  max_bytes?: number;
  timeout_ms?: number;
}

export interface CodexHookInstallReport {
  schema_version: "codex-hook-install-report/v1";
  adapter_id: typeof CODEX_SESSION_START_ADAPTER_ID;
  mode: CodexHookInstallMode;
  hooks_file: string;
  placement_status: "absent" | "placed_not_delivered";
  config_match: "absent" | "different" | "exact";
  would_change: boolean;
  wrote_hooks_file: boolean;
  backup_file: string | null;
  unrelated_hook_group_count_before: number;
  unrelated_hook_group_count_after: number;
  trust_verified: false;
  first_context_delivered: false;
  ordinary_launch_command: "codex";
  native_start_surface: "SessionStart";
  next_action: "install" | "review_and_trust_with_codex_hooks_ui" | "verify_first_context_delivery";
}

export interface ParsedCodexHookCommand {
  node_executable: string;
  runner: string;
  runtime_root: string;
  binding: CodexSessionStartBinding;
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

type HooksFile = Record<string, unknown> & {
  description?: string;
  hooks: Record<string, unknown> & {
    SessionStart?: HookGroup[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: string, field: string): string {
  if (!value || value.trim() !== value || value.includes("\0")) throw new Error(`${field} must be a canonical non-empty string`);
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

export function buildCodexHookCommand(
  runtimeRoot: string,
  binding: CodexSessionStartBinding,
): string {
  const runner = join(runtimeRoot, "dist", "codex-session-start.js");
  return [
    shellQuote(process.execPath),
    shellQuote(runner),
    "--adapter-id",
    shellQuote(CODEX_SESSION_START_ADAPTER_ID),
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
  ].join(" ");
}

/** Parse only the byte-canonical command shape emitted by buildCodexHookCommand. */
export function parseCodexHookCommand(command: string): ParsedCodexHookCommand | null {
  const words = parseShellWords(command);
  if (!words || words.length !== 18) return null;
  const expectedFlags = [
    [2, "--adapter-id"],
    [4, "--agent-id"],
    [6, "--project"],
    [8, "--workspace"],
    [10, "--binding-source-ref"],
    [12, "--max-tokens"],
    [14, "--max-bytes"],
    [16, "--timeout-ms"],
  ] as const;
  if (expectedFlags.some(([index, value]) => words[index] !== value)) return null;
  if (words[0] !== process.execPath || words[3] !== CODEX_SESSION_START_ADAPTER_ID) return null;
  if (!isAbsolute(words[1]) || !isAbsolute(words[9])) return null;
  const runtimeRoot = dirname(dirname(words[1]));
  if (words[1] !== join(runtimeRoot, "dist", "codex-session-start.js")) return null;
  const binding: CodexSessionStartBinding = {
    agent_id: words[5],
    project: words[7],
    workspace: words[9],
    binding_source_ref: words[11],
    max_tokens: Number(words[13]),
    max_bytes: Number(words[15]),
    timeout_ms: Number(words[17]),
  };
  try {
    requiredText(binding.agent_id, "agent_id");
    requiredText(binding.project, "project");
    requiredText(binding.workspace, "workspace");
    requiredText(binding.binding_source_ref, "binding_source_ref");
    boundedInteger(binding.max_tokens, 500, CODEX_SESSION_START_MAX_TOKENS, "max_tokens");
    boundedInteger(binding.max_bytes, 1_024, CODEX_SESSION_START_MAX_BYTES, "max_bytes");
    boundedInteger(binding.timeout_ms, 100, CODEX_SESSION_START_INTERNAL_TIMEOUT_MS, "timeout_ms");
  } catch {
    return null;
  }
  if (command !== buildCodexHookCommand(runtimeRoot, binding)) return null;
  return {
    node_executable: words[0],
    runner: words[1],
    runtime_root: runtimeRoot,
    binding,
  };
}

export function buildCodexSessionStartHookGroup(
  runtimeRoot: string,
  binding: CodexSessionStartBinding,
): HookGroup {
  const handler: HookHandler = {
    type: "command",
    command: buildCodexHookCommand(runtimeRoot, binding),
    timeout: CODEX_SESSION_START_HOOK_TIMEOUT_SECONDS,
    statusMessage: CODEX_HOOK_STATUS_MESSAGE,
  };
  return {
    matcher: CODEX_HOOK_MATCHER,
    hooks: [handler],
  };
}

function isManagedHandler(value: unknown): boolean {
  return isRecord(value) && typeof value.command === "string" && value.command.includes(CODEX_SESSION_START_ADAPTER_ID);
}

function normalizeHookGroup(value: unknown, index: number): HookGroup {
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

export function parseHooksFile(raw: string): HooksFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("hooks.json is not valid JSON");
  }
  if (!isRecord(parsed)) throw new Error("hooks.json must contain an object");
  const hooks = parsed.hooks === undefined ? {} : parsed.hooks;
  if (!isRecord(hooks)) throw new Error("hooks.json hooks must be an object");
  const sessionStart = hooks.SessionStart;
  if (sessionStart !== undefined && !Array.isArray(sessionStart)) {
    throw new Error("hooks.SessionStart must be an array");
  }
  return {
    ...parsed,
    hooks: {
      ...hooks,
      ...(Array.isArray(sessionStart)
        ? { SessionStart: sessionStart.map((group, index) => normalizeHookGroup(group, index)) }
        : {}),
    },
  };
}

export function mergeCodexSessionStartHook(
  existing: HooksFile,
  runtimeRoot: string,
  binding: CodexSessionStartBinding,
): { hooksFile: HooksFile; unrelatedBefore: number; unrelatedAfter: number } {
  const groups = existing.hooks.SessionStart ?? [];
  let unrelatedBefore = 0;
  const preserved: HookGroup[] = [];
  for (const group of groups) {
    const unrelatedHandlers = group.hooks.filter((handler) => !isManagedHandler(handler));
    unrelatedBefore += unrelatedHandlers.length;
    if (unrelatedHandlers.length > 0) preserved.push({ ...group, hooks: unrelatedHandlers });
  }
  const nextGroups = [...preserved, buildCodexSessionStartHookGroup(runtimeRoot, binding)];
  const hooksFile: HooksFile = {
    ...existing,
    description: typeof existing.description === "string"
      ? existing.description
      : "Lifecycle hooks for this workspace.",
    hooks: {
      ...existing.hooks,
      SessionStart: nextGroups,
    },
  };
  return {
    hooksFile,
    unrelatedBefore,
    unrelatedAfter: nextGroups.flatMap((group) => group.hooks).filter((handler) => !isManagedHandler(handler)).length,
  };
}

function canonicalHooksJson(value: HooksFile): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function defaultHooksFile(): HooksFile {
  return { description: "Lifecycle hooks for this workspace.", hooks: {} };
}

async function readExistingHooks(path: string): Promise<{ raw: string | null; hooksFile: HooksFile }> {
  try {
    const raw = await readFile(path, "utf8");
    return { raw, hooksFile: parseHooksFile(raw) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { raw: null, hooksFile: defaultHooksFile() };
    throw error;
  }
}

export async function installCodexSessionStartHook(
  options: CodexHookInstallOptions,
): Promise<CodexHookInstallReport> {
  const workspace = await realpath(requiredText(options.workspace, "workspace"));
  const runtimeRoot = await realpath(requiredText(options.runtime_root, "runtime_root"));
  const runner = join(runtimeRoot, "dist", "codex-session-start.js");
  const runnerInfo = await lstat(runner);
  if (!runnerInfo.isFile() || runnerInfo.isSymbolicLink()) throw new Error(`invalid hook runner: ${runner}`);
  const binding: CodexSessionStartBinding = {
    agent_id: requiredText(options.agent_id, "agent_id"),
    project: requiredText(options.project, "project"),
    workspace,
    binding_source_ref: requiredText(options.binding_source_ref, "binding_source_ref"),
    max_tokens: boundedInteger(options.max_tokens ?? CODEX_SESSION_START_MAX_TOKENS, 500, CODEX_SESSION_START_MAX_TOKENS, "max_tokens"),
    max_bytes: boundedInteger(options.max_bytes ?? CODEX_SESSION_START_MAX_BYTES, 1_024, CODEX_SESSION_START_MAX_BYTES, "max_bytes"),
    timeout_ms: boundedInteger(options.timeout_ms ?? CODEX_SESSION_START_INTERNAL_TIMEOUT_MS, 100, CODEX_SESSION_START_INTERNAL_TIMEOUT_MS, "timeout_ms"),
  };
  const codexDir = join(workspace, ".codex");
  const hooksFile = join(codexDir, "hooks.json");
  await assertNotSymlink(codexDir, true);
  await assertNotSymlink(hooksFile, true);
  const existing = await readExistingHooks(hooksFile);
  const merged = mergeCodexSessionStartHook(existing.hooksFile, runtimeRoot, binding);
  const desired = canonicalHooksJson(merged.hooksFile);
  const configMatch = existing.raw === null
    ? "absent" as const
    : canonicalHooksJson(existing.hooksFile) === desired
      ? "exact" as const
      : "different" as const;
  const wouldChange = configMatch !== "exact";
  let backupFile: string | null = null;
  let wroteHooksFile = false;
  if (options.mode === "apply" && wouldChange) {
    await mkdir(codexDir, { recursive: true });
    await assertNotSymlink(codexDir, false);
    if (existing.raw !== null) {
      backupFile = `${hooksFile}.bak.wasurezu-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
      await copyFile(hooksFile, backupFile);
      await chmod(backupFile, 0o600);
    }
    const temporary = join(codexDir, `.hooks.json.wasurezu-${randomUUID()}.tmp`);
    await writeFile(temporary, desired, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, hooksFile);
    await chmod(hooksFile, 0o600);
    wroteHooksFile = true;
  }
  const exactAfter = options.mode === "apply" ? true : configMatch === "exact";
  return {
    schema_version: "codex-hook-install-report/v1",
    adapter_id: CODEX_SESSION_START_ADAPTER_ID,
    mode: options.mode,
    hooks_file: hooksFile,
    placement_status: existing.raw === null && options.mode !== "apply" ? "absent" : "placed_not_delivered",
    config_match: exactAfter ? "exact" : configMatch,
    would_change: wouldChange,
    wrote_hooks_file: wroteHooksFile,
    backup_file: backupFile,
    unrelated_hook_group_count_before: merged.unrelatedBefore,
    unrelated_hook_group_count_after: merged.unrelatedAfter,
    trust_verified: false,
    first_context_delivered: false,
    ordinary_launch_command: "codex",
    native_start_surface: "SessionStart",
    next_action: existing.raw === null && options.mode !== "apply"
      ? "install"
      : exactAfter
        ? "review_and_trust_with_codex_hooks_ui"
        : "install",
  };
}

function positiveInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} must be a positive integer`);
  return parsed;
}

export function parseCodexHookInstallArgs(args: string[]): CodexHookInstallOptions {
  let mode: CodexHookInstallMode = "check";
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
  };
}

async function main(): Promise<void> {
  const options = parseCodexHookInstallArgs(process.argv.slice(2));
  const report = await installCodexSessionStartHook(options);
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
    process.stderr.write(`[codex-hook-installer] ${error}\n`);
    process.exit(1);
  });
}
