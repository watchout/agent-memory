#!/usr/bin/env node
/** Atomic, namespace-preserving installer for Antigravity CLI lifecycle hooks. */
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANTIGRAVITY_HOOK_TIMEOUT_SECONDS,
  ANTIGRAVITY_INTERNAL_TIMEOUT_MS,
  ANTIGRAVITY_MAX_BYTES,
  ANTIGRAVITY_MAX_TOKENS,
  ANTIGRAVITY_SESSION_START_ADAPTER_ID,
  type AntigravityHookEvent,
  type AntigravitySessionStartBinding,
} from "./antigravity-session-start.js";

export const ANTIGRAVITY_HOOK_CONFIG_RELATIVE_PATH = ".agents/hooks.json" as const;
export const ANTIGRAVITY_HOOK_NAMESPACE = "wasurezu-antigravity-recovery" as const;
export type AntigravityHookInstallMode = "apply" | "check" | "dry-run";

export interface AntigravityHookInstallOptions {
  mode: AntigravityHookInstallMode;
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

export interface AntigravityHookInstallReport {
  schema_version: "antigravity-hook-install-report/v1";
  adapter_id: typeof ANTIGRAVITY_SESSION_START_ADAPTER_ID;
  mode: AntigravityHookInstallMode;
  hooks_file: string;
  config_match: "absent" | "different" | "exact";
  would_change: boolean;
  wrote_hooks_file: boolean;
  backup_file: string | null;
  preimage_sha256: string | null;
  preimage_mode: string | null;
  postimage_sha256: string;
  postimage_mode: "0600";
  config_mutation_count: 0 | 1;
  managed_handler_count: 2;
  unrelated_namespace_count_before: number;
  unrelated_namespace_count_after: number;
  native_surfaces: ["PreInvocation", "PostInvocation"];
}

export type AntigravityHooksFile = Record<string, unknown>;
export interface ParsedAntigravityHookCommand {
  node_executable: string;
  runner: string;
  runtime_root: string;
  event: AntigravityHookEvent;
  binding: AntigravitySessionStartBinding;
}

export function buildAntigravityHookCommand(
  runtimeRoot: string,
  event: AntigravityHookEvent,
  binding: AntigravitySessionStartBinding,
): string {
  return [
    shellQuote(process.execPath), shellQuote(join(runtimeRoot, "dist", "antigravity-session-start.js")),
    "--adapter-id", shellQuote(ANTIGRAVITY_SESSION_START_ADAPTER_ID),
    "--hook-event", shellQuote(event),
    "--agent-id", shellQuote(binding.agent_id),
    "--project", shellQuote(binding.project),
    "--workspace", shellQuote(binding.workspace),
    "--binding-source-ref", shellQuote(binding.binding_source_ref),
    "--max-tokens", String(binding.max_tokens),
    "--max-bytes", String(binding.max_bytes),
    "--timeout-ms", String(binding.timeout_ms),
    ...(binding.runtime_event_manifest_path ? ["--runtime-event-manifest", shellQuote(binding.runtime_event_manifest_path)] : []),
  ].join(" ");
}

export function parseAntigravityHookCommand(command: string): ParsedAntigravityHookCommand | null {
  const words = parseShellWords(command);
  if (!words || (words.length !== 20 && words.length !== 22)) return null;
  const expectedFlags = [
    [2, "--adapter-id"], [4, "--hook-event"], [6, "--agent-id"], [8, "--project"],
    [10, "--workspace"], [12, "--binding-source-ref"], [14, "--max-tokens"], [16, "--max-bytes"], [18, "--timeout-ms"],
  ] as const;
  if (expectedFlags.some(([index, flag]) => words[index] !== flag) || words[0] !== process.execPath ||
    words[3] !== ANTIGRAVITY_SESSION_START_ADAPTER_ID || (words[5] !== "pre-invocation" && words[5] !== "post-invocation")) return null;
  const runtimeRoot = dirname(dirname(words[1]));
  if (words[1] !== join(runtimeRoot, "dist", "antigravity-session-start.js")) return null;
  const binding: AntigravitySessionStartBinding = {
    agent_id: words[7], project: words[9], workspace: words[11], binding_source_ref: words[13],
    max_tokens: Number(words[15]), max_bytes: Number(words[17]), timeout_ms: Number(words[19]),
    ...(words.length === 22 ? { runtime_event_manifest_path: words[21] } : {}),
  };
  if (!isAbsolute(words[1]) || !isAbsolute(binding.workspace) ||
    !Number.isInteger(binding.max_tokens) || !Number.isInteger(binding.max_bytes) || !Number.isInteger(binding.timeout_ms) ||
    (words.length === 22 && (words[20] !== "--runtime-event-manifest" || !isAbsolute(words[21])))) return null;
  if (command !== buildAntigravityHookCommand(runtimeRoot, words[5], binding)) return null;
  return { node_executable: words[0], runner: words[1], runtime_root: runtimeRoot, event: words[5], binding };
}

export function parseAntigravityHooks(raw: string): AntigravityHooksFile {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("hooks.json is not valid JSON"); }
  if (!isRecord(parsed)) throw new Error("hooks.json must contain an object");
  return clone(parsed);
}

export function mergeAntigravityHooks(
  existing: AntigravityHooksFile,
  runtimeRoot: string,
  binding: AntigravitySessionStartBinding,
): AntigravityHooksFile {
  assertManagedNamespace(existing[ANTIGRAVITY_HOOK_NAMESPACE]);
  return {
    ...existing,
    [ANTIGRAVITY_HOOK_NAMESPACE]: {
      PreInvocation: [handler(buildAntigravityHookCommand(runtimeRoot, "pre-invocation", binding))],
      PostInvocation: [handler(buildAntigravityHookCommand(runtimeRoot, "post-invocation", binding))],
    },
  };
}

function assertManagedNamespace(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "PostInvocation,PreInvocation") {
    throw new Error(`refusing unowned namespace collision: ${ANTIGRAVITY_HOOK_NAMESPACE}`);
  }
  for (const [surface, event] of [["PreInvocation", "pre-invocation"], ["PostInvocation", "post-invocation"]] as const) {
    const handlers = value[surface];
    if (!Array.isArray(handlers) || handlers.length !== 1 || !isRecord(handlers[0]) ||
      typeof handlers[0].command !== "string" || parseAntigravityHookCommand(handlers[0].command)?.event !== event) {
      throw new Error(`refusing unowned namespace collision: ${ANTIGRAVITY_HOOK_NAMESPACE}`);
    }
  }
}

export async function installAntigravityHooks(options: AntigravityHookInstallOptions): Promise<AntigravityHookInstallReport> {
  const workspace = await realpath(requiredText(options.workspace));
  const runtimeRoot = await realpath(requiredText(options.runtime_root));
  const runner = join(runtimeRoot, "dist", "antigravity-session-start.js");
  const runnerInfo = await lstat(runner);
  if (!runnerInfo.isFile() || runnerInfo.isSymbolicLink()) throw new Error(`invalid hook runner: ${runner}`);
  const binding: AntigravitySessionStartBinding = {
    agent_id: requiredText(options.agent_id), project: requiredText(options.project), workspace,
    binding_source_ref: requiredText(options.binding_source_ref),
    max_tokens: bounded(options.max_tokens ?? ANTIGRAVITY_MAX_TOKENS, 500, ANTIGRAVITY_MAX_TOKENS),
    max_bytes: bounded(options.max_bytes ?? ANTIGRAVITY_MAX_BYTES, 1_024, ANTIGRAVITY_MAX_BYTES),
    timeout_ms: bounded(options.timeout_ms ?? ANTIGRAVITY_INTERNAL_TIMEOUT_MS, 100, ANTIGRAVITY_INTERNAL_TIMEOUT_MS),
    ...(options.runtime_event_manifest_path ? { runtime_event_manifest_path: requiredAbsolute(options.runtime_event_manifest_path) } : {}),
  };
  const agentsDir = join(workspace, ".agents");
  const hooksFile = join(agentsDir, "hooks.json");
  await assertNotSymlink(agentsDir, true);
  await assertNotSymlink(hooksFile, true);
  let raw: string | null = null;
  let preimageMode: string | null = null;
  let existing: AntigravityHooksFile = {};
  try {
    const info = await lstat(hooksFile);
    raw = await readFile(hooksFile, "utf8");
    preimageMode = modeOf(info.mode);
    existing = parseAntigravityHooks(raw);
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const desired = canonicalJson(mergeAntigravityHooks(existing, runtimeRoot, binding));
  const configMatch = raw === null ? "absent" as const : raw === desired && preimageMode === "0600" ? "exact" as const : "different" as const;
  let wrote = false;
  let backup: string | null = null;
  let actualPostimageSha256 = sha256(desired);
  let actualPostimageMode = "0600" as const;
  if (options.mode === "apply" && configMatch !== "exact") {
    await mkdir(agentsDir, { recursive: true });
    await assertNotSymlink(agentsDir, false);
    if (raw !== null && options.create_backup !== false) {
      backup = `${hooksFile}.bak.wasurezu-${randomUUID()}`;
      await copyFile(hooksFile, backup);
      await chmod(backup, 0o600);
    }
    const temporary = join(agentsDir, `.hooks.json.wasurezu-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, desired, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await chmod(temporary, 0o600);
      await rename(temporary, hooksFile);
      wrote = true;
      const [actualRaw, actualInfo] = await Promise.all([readFile(hooksFile, "utf8"), lstat(hooksFile)]);
      actualPostimageSha256 = sha256(actualRaw);
      actualPostimageMode = modeOf(actualInfo.mode) as "0600";
      if (actualRaw !== desired || actualPostimageMode !== "0600") throw new Error("Antigravity hook postimage readback mismatch");
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      if (wrote) {
        let restore: string | undefined;
        try {
          const currentInfo = await lstat(hooksFile);
          const currentRaw = await readFile(hooksFile, "utf8");
          if (!currentInfo.isFile() || currentInfo.isSymbolicLink() || sha256(currentRaw) !== sha256(desired)) {
            throw new Error("Antigravity hook rollback conflict");
          }
          if (raw === null) {
            await rm(hooksFile);
          } else {
            restore = join(agentsDir, `.hooks.json.wasurezu-restore-${randomUUID()}.tmp`);
            await writeFile(restore, raw, { encoding: "utf8", mode: Number.parseInt(preimageMode ?? "0600", 8), flag: "wx" });
            await chmod(restore, Number.parseInt(preimageMode ?? "0600", 8));
            await rename(restore, hooksFile);
            restore = undefined;
          }
        } catch (restoreError) {
          throw new Error(`Antigravity hook apply failed and rollback failed: ${String(error)}; ${String(restoreError)}`);
        } finally {
          if (restore !== undefined) await rm(restore, { force: true }).catch(() => undefined);
        }
      }
      throw error;
    }
  }
  if (options.mode === "apply") {
    const [actualRaw, actualInfo] = await Promise.all([readFile(hooksFile, "utf8"), lstat(hooksFile)]);
    actualPostimageSha256 = sha256(actualRaw);
    actualPostimageMode = modeOf(actualInfo.mode) as "0600";
    if (actualRaw !== desired || actualPostimageMode !== "0600") throw new Error("Antigravity hook postimage readback mismatch");
  }
  const unrelated = Object.keys(existing).filter((key) => key !== ANTIGRAVITY_HOOK_NAMESPACE).length;
  return {
    schema_version: "antigravity-hook-install-report/v1", adapter_id: ANTIGRAVITY_SESSION_START_ADAPTER_ID,
    mode: options.mode, hooks_file: hooksFile,
    config_match: options.mode === "apply" ? "exact" : configMatch,
    would_change: configMatch !== "exact", wrote_hooks_file: wrote, backup_file: backup,
    preimage_sha256: raw === null ? null : sha256(raw), preimage_mode: preimageMode,
    postimage_sha256: actualPostimageSha256, postimage_mode: actualPostimageMode, config_mutation_count: wrote ? 1 : 0,
    managed_handler_count: 2, unrelated_namespace_count_before: unrelated, unrelated_namespace_count_after: unrelated,
    native_surfaces: ["PreInvocation", "PostInvocation"],
  };
}

function handler(command: string): Record<string, unknown> { return { type: "command", command, timeout: ANTIGRAVITY_HOOK_TIMEOUT_SECONDS }; }
function canonicalJson(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function modeOf(mode: number): string { return (mode & 0o777).toString(8).padStart(4, "0"); }
function clone(value: Record<string, unknown>): Record<string, unknown> { return JSON.parse(JSON.stringify(value)) as Record<string, unknown>; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function requiredText(value: string): string { if (!value || value.trim() !== value || value.includes("\0")) throw new Error("canonical text required"); return value; }
function bounded(value: number, min: number, max: number): number { if (!Number.isInteger(value) || value < min || value > max) throw new Error("bounded integer required"); return value; }
function requiredAbsolute(value: string): string { if (!isAbsolute(value) || resolve(value) !== value) throw new Error("absolute path required"); return value; }
function shellQuote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }
function parseShellWords(command: string): string[] | null {
  const words: string[] = []; let word = ""; let started = false; let state: "plain" | "single" | "double" = "plain";
  for (const char of command) {
    if (state === "single") { if (char === "'") state = "plain"; else word += char; continue; }
    if (state === "double") { if (char === '"') state = "plain"; else if ("$`\\\n\r".includes(char)) return null; else word += char; continue; }
    if (/\s/.test(char)) { if (started) { words.push(word); word = ""; started = false; } continue; }
    started = true;
    if (char === "'") state = "single"; else if (char === '"') state = "double"; else if (";&|<>`$()\\".includes(char)) return null; else word += char;
  }
  if (state !== "plain") return null; if (started) words.push(word); return words;
}
async function assertNotSymlink(path: string, allowMissing: boolean): Promise<void> {
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error(`refusing symlink path: ${path}`); }
  catch (error) { if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2); const values: Record<string, string> = {}; let mode: AntigravityHookInstallMode = "check";
  const allowed = new Set(["workspace", "runtime_root", "agent_id", "project", "binding_source_ref", "runtime_event_manifest"]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]; const next = () => { const value = args[++index]; if (!value) throw new Error(`${arg} requires a value`); return value; };
    if (arg === "--apply") mode = "apply"; else if (arg === "--dry-run") mode = "dry-run"; else if (arg === "--check") mode = "check";
    else if (arg.startsWith("--")) {
      const key = arg.slice(2).replaceAll("-", "_");
      if (!allowed.has(key)) throw new Error(`unknown argument: ${arg}`);
      values[key] = next();
    } else throw new Error(`unknown argument: ${arg}`);
  }
  const report = await installAntigravityHooks({
    mode, workspace: values.workspace ?? "", runtime_root: values.runtime_root ?? "", agent_id: values.agent_id ?? "",
    project: values.project ?? "", binding_source_ref: values.binding_source_ref ?? "",
    ...(values.runtime_event_manifest ? { runtime_event_manifest_path: values.runtime_event_manifest } : {}),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (mode === "check" && report.config_match !== "exact") process.exitCode = 1;
}

let invoked = ""; try { invoked = process.argv[1] ? realpathSync(resolve(process.argv[1])) : ""; } catch { invoked = ""; }
if (invoked === realpathSync(fileURLToPath(import.meta.url))) main().catch((error) => { process.stderr.write(`[antigravity-hook-installer] ${error}\n`); process.exit(1); });
