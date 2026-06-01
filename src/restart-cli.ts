#!/usr/bin/env node
import { realpathSync } from "fs";
import { fileURLToPath } from "url";
import { createStore } from "./stores/index.js";
import { prepareRestart, type ContinuityGuardMode, type PackInjectionMode, type RestartPackFormat } from "./restart-prepare.js";
import type { HostInvocationDeliveryMode, HostInvocationTargetRuntime, UntrustedContextPolicy } from "./restart-pack.js";

interface CliOptions {
  command: "prepare" | "fetch" | "help";
  agent_id: string;
  project?: string;
  pack_ref?: string;
  consume?: boolean;
  max_tokens?: number;
  continuity_guard_mode?: ContinuityGuardMode;
  pack_injection_mode?: PackInjectionMode;
  aun_installed?: boolean;
  aun_absent_confirmed?: boolean;
  supervisor_available?: boolean;
  restart_preauthorized?: boolean;
  context_used_ratio?: number;
  context_tokens?: number;
  context_window_tokens?: number;
  runtime_context_error?: boolean;
  emit_pack?: boolean;
  pack_format?: RestartPackFormat;
  target_runtime?: HostInvocationTargetRuntime;
  delivery_mode?: HostInvocationDeliveryMode;
  trusted_instruction?: string;
  untrusted_context_policy?: UntrustedContextPolicy;
}

export function parseRestartCliArgs(args: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const [command = "help", ...rest] = args;
  if (command === "help" || command === "--help" || command === "-h") {
    return { command: "help", agent_id: env.AGENT_MEMORY_AGENT_ID || "default" };
  }
  if (command !== "prepare" && command !== "fetch") {
    throw new Error(`unknown command: ${command}`);
  }

  const options: CliOptions = {
    command,
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
      case "--pack-ref":
        options.pack_ref = next();
        break;
      case "--consume":
        options.consume = true;
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
      case "--aun-absent":
      case "--aun-absent-confirmed":
        options.aun_absent_confirmed = true;
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
      case "--pack-format":
        options.pack_format = packFormat(next());
        break;
      case "--target-runtime":
        options.target_runtime = targetRuntime(next());
        break;
      case "--delivery-mode":
        options.delivery_mode = deliveryMode(next());
        break;
      case "--trusted-instruction":
        options.trusted_instruction = next();
        break;
      case "--untrusted-context-policy":
        options.untrusted_context_policy = untrustedContextPolicy(next());
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
    "  wasurezu-restart fetch --pack-ref REF [--consume] [options]",
    "",
    "Options:",
    "  --agent-id ID",
    "  --project PROJECT",
    "  --pack-ref REF                selected_restart_pack reference for fetch",
    "  --consume                     mark fetched selected pack as consumed",
    "  --max-tokens N",
    "  --mode auto_restart|recommend|pack_only|off",
    "  --pack-injection-mode auto_attach|on_demand|off",
    "  --context-used-ratio N        host-provided ratio, 0.0-1.0",
    "  --context-tokens N            host-provided used tokens",
    "  --context-window-tokens N     host-provided window size",
    "  --aun-installed",
    "  --aun-absent                 explicitly confirm AUN is absent for auto_restart",
    "  --supervisor-available",
    "  --restart-preauthorized",
    "  --runtime-context-error",
    "  --no-pack                     omit restart_pack text from JSON output",
    "  --pack-format text|recovery-pack-v1|host-invocation-context-v1",
    "  --target-runtime codex|claude|generic-mcp-host",
    "  --delivery-mode stdin-json|system-prompt-fragment|append-system-prompt-fragment|session-start-hook|tui-fallback",
    "  --trusted-instruction TEXT    trusted wrapper instruction; must not embed raw shell commands",
    "  --untrusted-context-policy quote-as-data-only|omit|summarize-only",
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
    if (options.command === "fetch") {
      if (!options.pack_ref) throw new Error("fetch requires --pack-ref");
      const pack = options.consume
        ? await store.consumeSelectedRestartPack({
            agent_id: options.agent_id,
            project: options.project,
            pack_ref: options.pack_ref,
          })
        : await store.getSelectedRestartPack({
            agent_id: options.agent_id,
            project: options.project,
            pack_ref: options.pack_ref,
          });
      if (!pack) throw new Error(`selected restart pack not found or already consumed: ${options.pack_ref}`);
      console.log(JSON.stringify(pack, null, 2));
      return;
    }
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

function packFormat(value: string): RestartPackFormat {
  if (value === "text" || value === "recovery-pack-v1" || value === "host-invocation-context-v1") return value;
  throw new Error(`invalid pack format: ${value}`);
}

function targetRuntime(value: string): HostInvocationTargetRuntime {
  if (value === "codex" || value === "claude" || value === "generic-mcp-host") return value;
  throw new Error(`invalid target runtime: ${value}`);
}

function deliveryMode(value: string): HostInvocationDeliveryMode {
  if (
    value === "stdin-json" ||
    value === "system-prompt-fragment" ||
    value === "append-system-prompt-fragment" ||
    value === "session-start-hook" ||
    value === "tui-fallback"
  ) {
    return value;
  }
  throw new Error(`invalid delivery mode: ${value}`);
}

function untrustedContextPolicy(value: string): UntrustedContextPolicy {
  if (value === "quote-as-data-only" || value === "omit" || value === "summarize-only") return value;
  throw new Error(`invalid untrusted context policy: ${value}`);
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
