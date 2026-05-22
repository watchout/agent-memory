#!/usr/bin/env node
import { realpathSync } from "fs";
import { fileURLToPath } from "url";
import { createStore } from "./stores/index.js";
import { prepareRestart, type ContinuityGuardMode, type PackInjectionMode } from "./restart-prepare.js";

interface CliOptions {
  command: "prepare" | "help";
  agent_id: string;
  project?: string;
  max_tokens?: number;
  continuity_guard_mode?: ContinuityGuardMode;
  pack_injection_mode?: PackInjectionMode;
  aun_installed?: boolean;
  supervisor_available?: boolean;
  restart_preauthorized?: boolean;
  context_used_ratio?: number;
  context_tokens?: number;
  context_window_tokens?: number;
  runtime_context_error?: boolean;
  emit_pack?: boolean;
}

export function parseRestartCliArgs(args: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const [command = "help", ...rest] = args;
  if (command === "help" || command === "--help" || command === "-h") {
    return { command: "help", agent_id: env.AGENT_MEMORY_AGENT_ID || "default" };
  }
  if (command !== "prepare") {
    throw new Error(`unknown command: ${command}`);
  }

  const options: CliOptions = {
    command: "prepare",
    agent_id: env.AGENT_MEMORY_AGENT_ID || "default",
    project: env.AGENT_MEMORY_PROJECT || undefined,
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = () => {
      const value = rest[++i];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      return value;
    };

    switch (arg) {
      case "--agent-id":
        options.agent_id = next();
        break;
      case "--project":
        options.project = next();
        break;
      case "--max-tokens":
        options.max_tokens = positiveNumber(arg, next());
        break;
      case "--mode":
      case "--continuity-guard-mode":
        options.continuity_guard_mode = guardMode(next());
        break;
      case "--pack-injection-mode":
        options.pack_injection_mode = injectionMode(next());
        break;
      case "--context-used-ratio":
        options.context_used_ratio = ratioNumber(arg, next());
        break;
      case "--context-tokens":
        options.context_tokens = positiveNumber(arg, next());
        break;
      case "--context-window-tokens":
        options.context_window_tokens = positiveNumber(arg, next());
        break;
      case "--aun-installed":
        options.aun_installed = true;
        break;
      case "--supervisor-available":
        options.supervisor_available = true;
        break;
      case "--restart-preauthorized":
        options.restart_preauthorized = true;
        break;
      case "--runtime-context-error":
        options.runtime_context_error = true;
        break;
      case "--no-pack":
        options.emit_pack = false;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  return options;
}

export function printRestartCliHelp(): string {
  return [
    "wasurezu-restart — restart continuity helper",
    "",
    "Usage:",
    "  wasurezu-restart prepare [options]",
    "",
    "Options:",
    "  --agent-id ID",
    "  --project PROJECT",
    "  --max-tokens N",
    "  --mode auto_restart|recommend|pack_only|off",
    "  --pack-injection-mode auto_attach|on_demand|off",
    "  --context-used-ratio N        host-provided ratio, 0.0-1.0",
    "  --context-tokens N            host-provided used tokens",
    "  --context-window-tokens N     host-provided window size",
    "  --aun-installed",
    "  --supervisor-available",
    "  --restart-preauthorized",
    "  --runtime-context-error",
    "  --no-pack                     omit restart_pack text from JSON output",
  ].join("\n");
}

async function main(): Promise<void> {
  const options = parseRestartCliArgs(process.argv.slice(2));
  if (options.command === "help") {
    console.log(printRestartCliHelp());
    return;
  }
  const store = await createStore();
  try {
    const output = await prepareRestart(store, options);
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await store.close();
  }
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
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative number`);
  return parsed;
}

function ratioNumber(flag: string, value: string): number {
  const parsed = positiveNumber(flag, value);
  if (parsed > 1) throw new Error(`${flag} must be between 0 and 1`);
  return parsed;
}

export function isMainEntrypoint(argvPath: string | undefined, metaUrl: string): boolean {
  if (!argvPath) return false;
  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return argvPath === fileURLToPath(metaUrl);
  }
}

if (isMainEntrypoint(process.argv[1], import.meta.url)) {
  main().catch((err) => {
    console.error(`wasurezu-restart failed: ${err}`);
    process.exit(1);
  });
}
