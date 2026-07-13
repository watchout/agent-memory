import { accessSync, constants, lstatSync, readFileSync, realpathSync, statSync } from "fs";
import { createHash } from "crypto";
import { isAbsolute } from "path";
import type { RestartHostAdapter } from "./stores/types.js";

export type RestartCommandKind = "registered_host_adapter" | "unresolved";

export type RestartCommandPreflightReason =
  | "restart_adapter_id_missing"
  | "restart_adapter_not_registered"
  | "restart_adapter_disabled"
  | "restart_adapter_runtime_missing"
  | "restart_adapter_state_invalid"
  | "restart_adapter_owner_decision_missing"
  | "restart_adapter_provenance_invalid"
  | "restart_adapter_path_invalid"
  | "restart_adapter_path_writable_rejected"
  | "restart_adapter_digest_mismatch"
  | "restart_adapter_command_mismatch"
  | "restart_command_args_rejected"
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
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  trustedBins?: readonly string[];
  requirePreauthorization?: boolean;
  restartPreauthorized?: boolean;
  hostAdapterId?: string;
  hostAdapter?: RestartHostAdapter;
}

export interface RestartCommandPreflightResult {
  status: "pass" | "fail";
  command: string | null;
  executable: string | null;
  resolved_path: string | null;
  argv: string[];
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
  const requirePreauthorization = input.requirePreauthorization ?? true;
  const restartPreauthorized = input.restartPreauthorized === true;
  const reasons: RestartCommandPreflightReason[] = [];
  const diagnostics: string[] = [];
  const hostAdapterId = input.hostAdapterId?.trim() ?? "";
  const adapter = hostAdapterId && input.hostAdapter?.host_adapter_id === hostAdapterId ? input.hostAdapter : null;

  if (!hostAdapterId) {
    reasons.push("restart_adapter_id_missing");
    diagnostics.push("restart execution requires an explicit host_adapter_id.");
  } else if (!adapter) {
    reasons.push("restart_adapter_not_registered");
    diagnostics.push(`host adapter is not registered: ${hostAdapterId}`);
  } else {
    validateAdapterRecord(adapter, reasons, diagnostics);
  }

  if (requirePreauthorization && !restartPreauthorized) {
    reasons.push("restart_lifecycle_not_preauthorized");
    diagnostics.push("restart lifecycle is not explicitly preauthorized.");
  }

  const parsed = command ? splitCommand(command) : { words: [], error: undefined };
  if (parsed.error) {
    reasons.push("restart_command_unparseable");
    diagnostics.push(parsed.error);
  }
  if (command && SHELL_CONTROL_RE.test(command)) {
    reasons.push("restart_command_shell_control_rejected");
    diagnostics.push("restart command must not use shell control operators.");
  }

  let resolvedPath: string | null = null;
  let executable: string | null = null;
  let argv = input.argv ? Array.from(input.argv) : parsed.words.slice(1);
  let commandKind: RestartCommandKind = "unresolved";
  let cwdIndependent = false;

  if (adapter && !adapterHasAuthorityRecordFailure(reasons)) {
    const pathCheck = validateAdapterPath(adapter);
    resolvedPath = pathCheck.resolvedPath;
    executable = pathCheck.resolvedPath;
    reasons.push(...pathCheck.reasons);
    diagnostics.push(...pathCheck.diagnostics);

    if (pathCheck.resolvedPath) {
      commandKind = "registered_host_adapter";
      const commandExecutable = parsed.words[0];
      if (commandExecutable) {
        if (!isAbsolute(commandExecutable)) {
          reasons.push("restart_adapter_command_mismatch");
          diagnostics.push("restart command must name the registered adapter canonical path, not a PATH lookup or relative executable.");
        } else {
          try {
            const commandRealpath = realpathSync(commandExecutable);
            if (commandRealpath !== pathCheck.resolvedPath) {
              reasons.push("restart_adapter_command_mismatch");
              diagnostics.push(`restart command path does not match registered adapter: ${commandRealpath}`);
            }
          } catch {
            reasons.push("restart_adapter_command_mismatch");
            diagnostics.push(`restart command path cannot be resolved: ${commandExecutable}`);
          }
        }
      } else if (input.argv === undefined) {
        argv = Array.isArray(adapter.allowed_argv) ? Array.from(adapter.allowed_argv) : [];
      }

      if (Array.isArray(adapter.allowed_argv) && !sameArgv(argv, adapter.allowed_argv)) {
        reasons.push("restart_command_args_rejected");
        diagnostics.push(`restart argv does not match registered adapter allowlist: ${JSON.stringify(argv)}`);
      }
    }
  } else if (command && parsed.words[0] && !isAbsolute(parsed.words[0]) && hasPathSeparator(parsed.words[0])) {
    reasons.push("restart_command_relative_rejected");
    diagnostics.push(`restart command cannot use a relative path: ${parsed.words[0]}`);
  } else if (command && parsed.words[0] && !isAbsolute(parsed.words[0])) {
    reasons.push("restart_command_bin_not_allowed");
    diagnostics.push("restart command cannot use PATH lookup without a registered host adapter.");
  }

  cwdIndependent = reasons.length === 0 && commandKind === "registered_host_adapter" && resolvedPath !== null;
  const renderedCommand = resolvedPath
    ? [resolvedPath, ...argv].map(shellDisplayWord).join(" ")
    : command || null;

  return {
    status: reasons.length === 0 ? "pass" : "fail",
    command: renderedCommand,
    executable,
    resolved_path: resolvedPath,
    argv,
    command_kind: commandKind,
    cwd_independent: cwdIndependent,
    restart_preauthorized: restartPreauthorized,
    reasons,
    diagnostics,
  };
}

function validateAdapterRecord(
  adapter: RestartHostAdapter,
  reasons: RestartCommandPreflightReason[],
  diagnostics: string[]
): void {
  if (typeof adapter.runtime !== "string" || adapter.runtime.trim() === "") {
    reasons.push("restart_adapter_runtime_missing");
    diagnostics.push(`host adapter runtime is missing: ${adapter.host_adapter_id}`);
  }
  if (adapter.state !== "active") {
    if (adapter.state === "disabled" || adapter.state === "revoked") {
      reasons.push("restart_adapter_disabled");
      diagnostics.push(`host adapter is not active: ${adapter.host_adapter_id}`);
    } else {
      reasons.push("restart_adapter_state_invalid");
      diagnostics.push(`host adapter state is invalid: ${adapter.host_adapter_id}`);
    }
  }
  if (typeof adapter.owner_decision_ref !== "string" || adapter.owner_decision_ref.trim() === "") {
    reasons.push("restart_adapter_owner_decision_missing");
    diagnostics.push(`host adapter owner_decision_ref is missing: ${adapter.host_adapter_id}`);
  }
  if (typeof adapter.provenance_ref !== "string" || adapter.provenance_ref.trim() === "") {
    reasons.push("restart_adapter_provenance_invalid");
    diagnostics.push(`host adapter provenance_ref is missing: ${adapter.host_adapter_id}`);
  }
}

function adapterHasAuthorityRecordFailure(reasons: readonly RestartCommandPreflightReason[]): boolean {
  return reasons.some((reason) =>
    reason === "restart_adapter_disabled" ||
    reason === "restart_adapter_runtime_missing" ||
    reason === "restart_adapter_state_invalid" ||
    reason === "restart_adapter_owner_decision_missing" ||
    reason === "restart_adapter_provenance_invalid"
  );
}

function validateAdapterPath(adapter: RestartHostAdapter): {
  resolvedPath: string | null;
  reasons: RestartCommandPreflightReason[];
  diagnostics: string[];
} {
  const reasons: RestartCommandPreflightReason[] = [];
  const diagnostics: string[] = [];
  const configuredPath = adapter.canonical_path;
  let resolvedPath: string | null = null;

  if (!configuredPath || !isAbsolute(configuredPath)) {
    reasons.push("restart_adapter_path_invalid");
    diagnostics.push("registered adapter canonical_path must be absolute.");
    return { resolvedPath, reasons, diagnostics };
  }

  try {
    const linkStat = lstatSync(configuredPath);
    if (linkStat.isSymbolicLink()) {
      reasons.push("restart_adapter_path_invalid");
      diagnostics.push(`registered adapter path must not be a symlink: ${configuredPath}`);
    }
    const real = realpathSync(configuredPath);
    const stat = statSync(real);
    resolvedPath = real;
    if (!stat.isFile()) {
      reasons.push("restart_adapter_path_invalid");
      diagnostics.push(`registered adapter path must be a regular file: ${configuredPath}`);
    }
    if ((stat.mode & 0o022) !== 0) {
      reasons.push("restart_adapter_path_writable_rejected");
      diagnostics.push(`registered adapter path must not be group/world writable: ${configuredPath}`);
    }
    try {
      accessSync(real, constants.X_OK);
    } catch {
      reasons.push("restart_command_not_executable");
      diagnostics.push(`registered adapter path is not executable: ${configuredPath}`);
    }
    const digest = createHash("sha256").update(readFileSync(real)).digest("hex");
    if (digest !== adapter.executable_sha256) {
      reasons.push("restart_adapter_digest_mismatch");
      diagnostics.push(`registered adapter digest mismatch: ${configuredPath}`);
    }
  } catch (err) {
    reasons.push("restart_adapter_path_invalid");
    diagnostics.push(`registered adapter path cannot be resolved: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { resolvedPath, reasons, diagnostics };
}

function splitCommand(command: string): { words: string[]; error?: string } {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let started = false;

  for (const char of command.trim()) {
    if (escaped) {
      current += char;
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
        current += char;
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
      if (started) {
        words.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }

  if (escaped) return { words: [], error: "restart command has a trailing escape." };
  if (quote) return { words: [], error: "restart command has an unterminated quote." };
  if (started) words.push(current);
  return { words };
}

function sameArgv(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function shellDisplayWord(value: string): string {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}
