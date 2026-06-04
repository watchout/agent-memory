import { accessSync, constants } from "fs";
import { delimiter, isAbsolute, join } from "path";

export type RestartCommandKind = "absolute_path" | "trusted_package_bin" | "unresolved";

export type RestartCommandPreflightReason =
  | "restart_command_missing"
  | "restart_lifecycle_not_preauthorized"
  | "restart_command_unparseable"
  | "restart_command_shell_control_rejected"
  | "restart_command_relative_rejected"
  | "restart_command_bin_not_allowed"
  | "restart_command_not_found"
  | "restart_command_not_executable";

export interface RestartCommandPreflightInput {
  command?: string;
  env?: NodeJS.ProcessEnv;
  trustedBins?: readonly string[];
  requirePreauthorization?: boolean;
  restartPreauthorized?: boolean;
}

export interface RestartCommandPreflightResult {
  status: "pass" | "fail";
  command: string | null;
  executable: string | null;
  resolved_path: string | null;
  command_kind: RestartCommandKind;
  cwd_independent: boolean;
  restart_preauthorized: boolean;
  reasons: RestartCommandPreflightReason[];
  diagnostics: string[];
}

const DEFAULT_TRUSTED_RESTART_BINS = [
  "wasurezu-claude-start",
  "wasurezu-codex-start",
  "wasurezu-restart",
] as const;

const SHELL_CONTROL_RE = /(?:[;&|<>`]|\$\()/;

export function defaultTrustedRestartBins(): readonly string[] {
  return DEFAULT_TRUSTED_RESTART_BINS;
}

export function preflightRestartCommand(input: RestartCommandPreflightInput): RestartCommandPreflightResult {
  const command = input.command?.trim() ?? "";
  const env = input.env ?? process.env;
  const trustedBins = new Set(input.trustedBins ?? DEFAULT_TRUSTED_RESTART_BINS);
  const requirePreauthorization = input.requirePreauthorization ?? true;
  const restartPreauthorized = input.restartPreauthorized === true;
  const reasons: RestartCommandPreflightReason[] = [];
  const diagnostics: string[] = [];

  if (!command) {
    reasons.push("restart_command_missing");
    diagnostics.push("restart command is not configured.");
  }
  if (requirePreauthorization && !restartPreauthorized) {
    reasons.push("restart_lifecycle_not_preauthorized");
    diagnostics.push("restart lifecycle is not explicitly preauthorized.");
  }

  const parsed = command ? firstShellWord(command) : { word: null, error: undefined };
  if (parsed.error) {
    reasons.push("restart_command_unparseable");
    diagnostics.push(parsed.error);
  }
  if (command && SHELL_CONTROL_RE.test(command)) {
    reasons.push("restart_command_shell_control_rejected");
    diagnostics.push("restart command must not use shell control operators.");
  }

  const executable = parsed.word;
  let resolvedPath: string | null = null;
  let commandKind: RestartCommandKind = "unresolved";
  let cwdIndependent = false;

  if (executable && !parsed.error && !SHELL_CONTROL_RE.test(command)) {
    if (isAbsolute(executable)) {
      commandKind = "absolute_path";
      cwdIndependent = true;
      resolvedPath = executable;
      if (!isExecutableFile(executable)) {
        reasons.push("restart_command_not_executable");
        diagnostics.push(`restart command is not executable or cannot be accessed: ${executable}`);
      }
    } else if (hasPathSeparator(executable)) {
      reasons.push("restart_command_relative_rejected");
      diagnostics.push(`restart command must be absolute or an allowed package/bin name: ${executable}`);
    } else if (!trustedBins.has(executable)) {
      reasons.push("restart_command_bin_not_allowed");
      diagnostics.push(`restart package/bin is not allowlisted for restart control: ${executable}`);
    } else {
      commandKind = "trusted_package_bin";
      cwdIndependent = true;
      resolvedPath = findExecutableOnPath(executable, env);
      if (!resolvedPath) {
        reasons.push("restart_command_not_found");
        diagnostics.push(`trusted restart package/bin was not found on PATH: ${executable}`);
      }
    }
  }

  return {
    status: reasons.length === 0 ? "pass" : "fail",
    command: command || null,
    executable,
    resolved_path: resolvedPath,
    command_kind: commandKind,
    cwd_independent: cwdIndependent && reasons.length === 0,
    restart_preauthorized: restartPreauthorized,
    reasons,
    diagnostics,
  };
}

function firstShellWord(command: string): { word: string | null; error?: string } {
  let word = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let started = false;

  for (const char of command.trim()) {
    if (escaped) {
      word += char;
      escaped = false;
      started = true;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        word += char;
      }
      started = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) break;
      continue;
    }
    word += char;
    started = true;
  }

  if (escaped) return { word: null, error: "restart command has a trailing escape." };
  if (quote) return { word: null, error: "restart command has an unterminated quote." };
  return { word: word || null };
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findExecutableOnPath(bin: string, env: NodeJS.ProcessEnv): string | null {
  const pathValue = env.PATH ?? "";
  const candidates = executableCandidates(bin, env);
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const candidate of candidates) {
      const path = join(dir, candidate);
      if (isExecutableFile(path)) return path;
    }
  }
  return null;
}

function executableCandidates(bin: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== "win32" || /\.[^\\/]+$/.test(bin)) return [bin];
  const extensions = (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean);
  return [bin, ...extensions.map((ext) => `${bin}${ext.toLowerCase()}`), ...extensions.map((ext) => `${bin}${ext.toUpperCase()}`)];
}
