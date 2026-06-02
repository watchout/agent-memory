#!/usr/bin/env node
/**
 * Claude Code resession runner for restart_pack recovery.
 *
 * This runner prepares a structured selected restart pack for Claude Code and
 * can optionally launch a fresh Claude process. It never kills or replaces an
 * existing Claude session. SessionStart remains the load hook; this runner owns
 * deterministic prepare/launch gating in standalone mode.
 */
import { spawn } from "child_process";
import { realpathSync } from "fs";
import { fileURLToPath } from "url";
import { createStore } from "./stores/index.js";
import type { Store } from "./stores/types.js";
import {
  prepareRestart,
  type ContinuityGuardMode,
  type PackInjectionMode,
  type RestartPrepareOutput,
} from "./restart-prepare.js";

const AGENT_ID = process.env.AGENT_MEMORY_AGENT_ID || "default";
const PROJECT = process.env.AGENT_MEMORY_PROJECT || undefined;

export const CLAUDE_RESESSION_RUNNER_ENV = "claude_resession_runner_v1";

export interface ClaudeStartCliOptions {
  launch: boolean;
  agentId: string;
  project?: string;
  cd?: string;
  claudeBin: string;
  mcpConfig?: string;
  maxTokens?: number;
  continuityGuardMode?: ContinuityGuardMode;
  packInjectionMode?: PackInjectionMode;
  contextUsedRatio?: number;
  contextTokens?: number;
  contextWindowTokens?: number;
  runtimeContextError?: boolean;
  aunInstalled?: boolean;
  aunAbsentConfirmed?: boolean;
  supervisorAvailable?: boolean;
  restartPreauthorized?: boolean;
  emitPack?: boolean;
  claudeArgs: string[];
}

export interface ClaudeResessionRunnerResult {
  runner: "wasurezu-claude-start";
  launch_requested: boolean;
  launched_claude: boolean;
  launch_blockers: string[];
  next_session_env: Record<string, string>;
  prepare: RestartPrepareOutput;
  notes: string[];
}

export async function prepareClaudeResession(
  store: Store,
  options: Pick<
    ClaudeStartCliOptions,
    | "agentId"
    | "project"
    | "maxTokens"
    | "continuityGuardMode"
    | "packInjectionMode"
    | "contextUsedRatio"
    | "contextTokens"
    | "contextWindowTokens"
    | "runtimeContextError"
    | "aunInstalled"
    | "aunAbsentConfirmed"
    | "supervisorAvailable"
    | "restartPreauthorized"
    | "emitPack"
    | "launch"
  >
): Promise<ClaudeResessionRunnerResult> {
  const prepared = await prepareRestart(store, {
    agent_id: options.agentId,
    project: options.project,
    max_tokens: options.maxTokens,
    continuity_guard_mode: options.continuityGuardMode ?? "recommend",
    pack_injection_mode: options.packInjectionMode ?? "auto_attach",
    aun_installed: options.aunInstalled,
    aun_absent_confirmed: options.aunAbsentConfirmed,
    supervisor_available: options.supervisorAvailable,
    restart_preauthorized: options.restartPreauthorized,
    context_used_ratio: options.contextUsedRatio,
    context_tokens: options.contextTokens,
    context_window_tokens: options.contextWindowTokens,
    runtime_context_error: options.runtimeContextError,
    emit_pack: options.emitPack === true,
    pack_format: "host-invocation-context-v1",
    target_runtime: "claude",
    delivery_mode: "session-start-hook",
    untrusted_context_policy: "quote-as-data-only",
  });

  return buildClaudeRunnerResult(prepared, options.launch === true);
}

export function buildClaudeRunnerResult(
  prepared: RestartPrepareOutput,
  launchRequested: boolean,
  launchedClaude = false
): ClaudeResessionRunnerResult {
  const launchBlockers = launchRequested ? launchBlockersFor(prepared) : [];
  return {
    runner: "wasurezu-claude-start",
    launch_requested: launchRequested,
    launched_claude: launchedClaude,
    launch_blockers: launchBlockers,
    next_session_env: buildNextSessionEnv(prepared),
    prepare: prepared,
    notes: [
      "wasurezu-claude-start prepares Claude recovery state but never kills or replaces an existing Claude session.",
      "SessionStart is the selected-pack load hook, not the restart policy owner.",
      "TUI text injection and SessionStart self-kick remain compatibility fallbacks only.",
    ],
  };
}

export function launchBlockersFor(prepared: RestartPrepareOutput): string[] {
  const blockers = [...prepared.auto_restart_blockers];
  if (!prepared.can_auto_restart) blockers.push("restart_prepare_can_auto_restart_false");
  if (!prepared.pack_ref) blockers.push("selected_pack_ref_missing");
  if (prepared.action !== "restart_recommended" && prepared.action !== "restart_required") {
    blockers.push("restart_not_recommended_or_required");
  }
  return Array.from(new Set(blockers));
}

export function buildNextSessionEnv(prepared: RestartPrepareOutput): Record<string, string> {
  const env: Record<string, string> = {
    AGENT_MEMORY_STARTUP_BRIDGE: CLAUDE_RESESSION_RUNNER_ENV,
    AGENT_MEMORY_BOOT_MODE: "restart_pack",
  };
  if (prepared.pack_ref) env.AGENT_MEMORY_SELECTED_PACK_REF = prepared.pack_ref;
  env.AGENT_MEMORY_AGENT_ID = prepared.provenance.agent_id;
  if (prepared.provenance.project) env.AGENT_MEMORY_PROJECT = prepared.provenance.project;
  return env;
}

export function buildClaudeLaunchEnv(
  env: NodeJS.ProcessEnv,
  prepared: RestartPrepareOutput
): NodeJS.ProcessEnv {
  return {
    ...env,
    ...buildNextSessionEnv(prepared),
  };
}

export function buildClaudeLaunchArgs(
  options: Pick<ClaudeStartCliOptions, "mcpConfig" | "claudeArgs">
): string[] {
  const args: string[] = [];
  if (options.mcpConfig) args.push("--mcp-config", options.mcpConfig);
  args.push(...options.claudeArgs);
  return args;
}

export function parseClaudeStartArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): ClaudeStartCliOptions {
  const options: ClaudeStartCliOptions = {
    launch: false,
    agentId: env.AGENT_MEMORY_AGENT_ID || "default",
    project: env.AGENT_MEMORY_PROJECT || undefined,
    claudeBin: env.AGENT_MEMORY_CLAUDE_BIN || "claude",
    claudeArgs: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => requireValue(args, ++i, arg);
    switch (arg) {
      case "--launch":
        options.launch = true;
        break;
      case "--print":
        options.launch = false;
        break;
      case "--agent-id":
        options.agentId = next();
        break;
      case "--project":
        options.project = next();
        break;
      case "--cd":
        options.cd = next();
        break;
      case "--claude-bin":
        options.claudeBin = next();
        break;
      case "--mcp-config":
        options.mcpConfig = next();
        break;
      case "--claude-arg":
        options.claudeArgs.push(next());
        break;
      case "--max-tokens":
        options.maxTokens = positiveNumber(arg, next());
        break;
      case "--mode":
      case "--continuity-guard-mode":
        options.continuityGuardMode = guardMode(next());
        break;
      case "--pack-injection-mode":
        options.packInjectionMode = injectionMode(next());
        break;
      case "--context-used-ratio":
        options.contextUsedRatio = ratioNumber(arg, next());
        break;
      case "--context-tokens":
        options.contextTokens = nonNegativeNumber(arg, next());
        break;
      case "--context-window-tokens":
        options.contextWindowTokens = positiveNumber(arg, next());
        break;
      case "--runtime-context-error":
        options.runtimeContextError = true;
        break;
      case "--aun-installed":
        options.aunInstalled = true;
        break;
      case "--aun-absent":
      case "--aun-absent-confirmed":
        options.aunAbsentConfirmed = true;
        break;
      case "--supervisor-available":
        options.supervisorAvailable = true;
        break;
      case "--restart-preauthorized":
        options.restartPreauthorized = true;
        break;
      case "--emit-pack":
        options.emitPack = true;
        break;
      case "--no-pack":
        options.emitPack = false;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function run(): Promise<void> {
  const options = parseClaudeStartArgs(process.argv.slice(2));
  const store = await createStore();
  try {
    const result = await prepareClaudeResession(store, options);
    if (!options.launch) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.launch_blockers.length > 0) {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 2;
      return;
    }

    process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
    await launchClaude(options, result.prepare);
    process.stderr.write(`${JSON.stringify(buildClaudeRunnerResult(result.prepare, true, true), null, 2)}\n`);
  } finally {
    await store.close();
  }
}

function launchClaude(options: ClaudeStartCliOptions, prepared: RestartPrepareOutput): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.claudeBin, buildClaudeLaunchArgs(options), {
      cwd: options.cd ?? process.cwd(),
      stdio: "inherit",
      env: buildClaudeLaunchEnv(process.env, prepared),
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`claude exited with ${signal ?? code}`));
    });
  });
}

function guardMode(value: string): ContinuityGuardMode {
  if (value === "auto_restart" || value === "recommend" || value === "pack_only" || value === "off") return value;
  throw new Error(`invalid continuity guard mode: ${value}`);
}

function injectionMode(value: string): PackInjectionMode {
  if (value === "auto_attach" || value === "on_demand" || value === "off") return value;
  throw new Error(`invalid pack injection mode: ${value}`);
}

function positiveNumber(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive number`);
  return parsed;
}

function nonNegativeNumber(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative number`);
  return parsed;
}

function ratioNumber(flag: string, value: string): number {
  const parsed = nonNegativeNumber(flag, value);
  if (parsed > 1) throw new Error(`${flag} must be between 0 and 1`);
  return parsed;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function printHelp(): void {
  console.log(`wasurezu-claude-start

Prepare a Claude Code selected restart pack from deterministic context-health
signals, or launch a fresh Claude session when standalone restart is explicitly
pre-authorized.

Usage:
  wasurezu-claude-start [--print]
  wasurezu-claude-start --launch --mode auto_restart --aun-absent --supervisor-available --restart-preauthorized [options]

Options:
  --print                         Prepare and print runner evidence. Default.
  --launch                        Launch a fresh Claude process only when fail-closed restart gates pass.
  --agent-id ID                   Memory namespace. Default: AGENT_MEMORY_AGENT_ID or default.
  --project PROJECT               Optional memory project.
  --cd DIR                        Working directory for launched Claude.
  --claude-bin PATH               Claude executable. Default: AGENT_MEMORY_CLAUDE_BIN or claude.
  --mcp-config PATH               Pass --mcp-config to launched Claude.
  --claude-arg ARG                Append one argv item to Claude. Repeat for multiple args.
  --max-tokens N                  restart pack token budget override.
  --mode auto_restart|recommend|pack_only|off
  --pack-injection-mode auto_attach|on_demand|off
  --context-used-ratio N          Host-provided ratio, 0.0-1.0.
  --context-tokens N              Host-provided used tokens.
  --context-window-tokens N       Host-provided window size.
  --runtime-context-error         Treat host context error as require band.
  --aun-installed                 Mark AUN/suite ownership present; launch will fail closed.
  --aun-absent                    Explicitly confirm AUN is absent for standalone auto_restart.
  --supervisor-available          Confirm a supported host hook/supervisor is installed.
  --restart-preauthorized         Confirm restart lifecycle was pre-authorized.
  --emit-pack                     Include selected pack content in printed JSON evidence.

Boundary:
  This runner does not kill or replace existing Claude sessions. It prepares a
  host-invocation-context/v1 selected pack for target_runtime=claude and
  delivery_mode=session-start-hook. SessionStart loads the pack; it is not the
  restart policy owner. TUI input remains fallback only.
`);
}

export function isMainEntrypoint(argvPath: string | undefined, metaUrl: string): boolean {
  if (!argvPath) return false;
  return realpathSync(argvPath) === realpathSync(fileURLToPath(metaUrl));
}

if (isMainEntrypoint(process.argv[1], import.meta.url)) {
  run().catch((err) => {
    console.error(`[wasurezu-claude-start] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
