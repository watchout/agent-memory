#!/usr/bin/env node
import { readFileSync, realpathSync } from "fs";
import { fileURLToPath } from "url";
import { createStore } from "./stores/index.js";
import { prepareRestart, type ContinuityGuardMode, type PackInjectionMode, type RestartPackFormat } from "./restart-prepare.js";
import type { HostInvocationDeliveryMode, HostInvocationTargetRuntime, UntrustedContextPolicy } from "./restart-pack.js";
import { preflightRestartCommand } from "./restart-command-preflight.js";
import { writeRestartMarker } from "./context-restart-marker.js";
import { runRestartBridge, type RestartLifecycleMode, type RestartRuntimeAuthority } from "./restart-bridge.js";
import type { RestartHostAdapterRegistry } from "./restart-command-preflight.js";
import { loadRestartThresholdConfig, type RestartThresholdOverrides } from "./restart-thresholds.js";
import { redactText } from "./redact.js";

interface CliOptions {
  command: "prepare" | "fetch" | "preflight" | "marker" | "bridge" | "help";
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
  thresholds?: RestartThresholdOverrides;
  runtime_context_error?: boolean;
  emit_pack?: boolean;
  pack_format?: RestartPackFormat;
  target_runtime?: HostInvocationTargetRuntime;
  delivery_mode?: HostInvocationDeliveryMode;
  trusted_instruction?: string;
  untrusted_context_policy?: UntrustedContextPolicy;
  restart_command?: string;
  marker_path?: string;
  marker_dir?: string;
  host?: string;
  host_id?: string;
  host_adapter_id?: string;
  seat_id?: string;
  session_id?: string;
  agent_comms_db_url?: string;
  runtime_authority_file?: string;
  adapter_registry_file?: string;
  lifecycle_mode?: RestartLifecycleMode;
  supervisor_id?: string;
  authority_ref?: string;
  authority_expires_at?: string;
  runtime_row_version?: number;
  execute?: boolean;
}

export function parseRestartCliArgs(args: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const [command = "help", ...rest] = args;
  if (command === "help" || command === "--help" || command === "-h") {
    return { command: "help", agent_id: env.AGENT_MEMORY_AGENT_ID || "default" };
  }
  if (command !== "prepare" && command !== "fetch" && command !== "preflight" && command !== "marker" && command !== "bridge") {
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
      case "--threshold-config":
        options.thresholds = { ...(options.thresholds ?? {}), ...loadRestartThresholdConfig(next()) };
        break;
      case "--threshold-prepare":
        setThreshold(options, "prepare", ratioNumber(arg, next()));
        break;
      case "--threshold-warn":
        setThreshold(options, "warn", ratioNumber(arg, next()));
        break;
      case "--threshold-recommend":
        setThreshold(options, "recommend", ratioNumber(arg, next()));
        break;
      case "--threshold-require":
        setThreshold(options, "require", ratioNumber(arg, next()));
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
      case "--restart-command":
        options.restart_command = next();
        break;
      case "--marker-path":
        options.marker_path = next();
        break;
      case "--marker-dir":
        options.marker_dir = next();
        break;
      case "--host":
        options.host = next();
        break;
      case "--host-id":
        options.host_id = next();
        break;
      case "--host-adapter-id":
        options.host_adapter_id = next();
        break;
      case "--seat-id":
        options.seat_id = next();
        break;
      case "--session-id":
        options.session_id = next();
        break;
      case "--agent-comms-db-url":
        options.agent_comms_db_url = next();
        break;
      case "--runtime-authority-file":
        options.runtime_authority_file = next();
        break;
      case "--adapter-registry-file":
        options.adapter_registry_file = next();
        break;
      case "--lifecycle-mode":
        options.lifecycle_mode = lifecycleMode(next());
        break;
      case "--supervisor-id":
        options.supervisor_id = next();
        break;
      case "--authority-ref":
        options.authority_ref = next();
        break;
      case "--authority-expires-at":
        options.authority_expires_at = next();
        break;
      case "--runtime-row-version":
        options.runtime_row_version = positiveNumber(arg, next());
        break;
      case "--execute":
        options.execute = true;
        break;
      case "--dry-run":
        options.execute = false;
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
    "  wasurezu-restart preflight [--restart-command CMD] [--restart-preauthorized]",
    "  wasurezu-restart marker --marker-path PATH --context-used-ratio N [options]",
    "  wasurezu-restart bridge --marker-path PATH --restart-command CMD --restart-preauthorized [--dry-run|--execute]",
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
    "  --threshold-config PATH       JSON override for prepare/warn/recommend/require ratios",
    "  --threshold-prepare N",
    "  --threshold-warn N",
    "  --threshold-recommend N",
    "  --threshold-require N",
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
    "  --marker-path PATH",
    "  --marker-dir DIR",
    "  --host HOST",
    "  --host-id ID",
    "  --host-adapter-id ID",
    "  --seat-id ID",
    "  --session-id ID",
    "  --agent-comms-db-url URL       optional read-only queue drain check",
    "  --runtime-authority-file PATH  restart_runtime_authority/v1 JSON",
    "  --adapter-registry-file PATH   registered host adapter registry JSON",
    "  --lifecycle-mode aun_supervised|standalone_supervisor|pure_mcp",
    "  --supervisor-id ID",
    "  --authority-ref REF",
    "  --authority-expires-at RFC3339",
    "  --execute                     bridge executes after gates pass; default is dry-run",
  ].join("\n");
}

export interface SupervisorPreflightResult {
  cli: "wasurezu-restart preflight";
  checked_at: string;
  status: "pass" | "fail";
  restart_command: string | null;
  command_kind: string;
  cwd_independent: boolean;
  resolved_path: string | null;
  restart_preauthorized: boolean;
  reasons: string[];
  diagnostics: string[];
  remediation: string[];
}

export function runSupervisorPreflight(
  restartCommand: string | undefined,
  restartPreauthorized: boolean,
  checkedAt: string,
  env: NodeJS.ProcessEnv = process.env,
  hostAdapterId?: string,
  adapterRegistry?: RestartHostAdapterRegistry
): SupervisorPreflightResult {
  const effectiveCommand = restartCommand ?? env.WASUREZU_RESTART_COMMAND ?? env.AGENT_MEMORY_RESTART_COMMAND;
  const result = preflightRestartCommand({
    command: effectiveCommand,
    restartPreauthorized,
    env,
    hostAdapterId,
    adapterRegistry,
  });

  const remediation: string[] = [];
  if (result.reasons.includes("restart_command_relative_rejected")) {
    remediation.push(
      "Change the supervisor restart command from a relative path (e.g. scripts/restart-from-context-marker.sh) to the trusted bin: wasurezu-claude-start --launch"
    );
  }
  if (result.reasons.includes("restart_command_bin_not_allowed")) {
    remediation.push("Use one of the allowed restart bins: wasurezu-claude-start, wasurezu-codex-start, wasurezu-restart");
  }
  if (result.reasons.includes("restart_command_not_found")) {
    remediation.push("Ensure the restart bin is installed and available on PATH (npm install -g wasurezu or npx wasurezu)");
  }
  if (result.reasons.includes("restart_command_missing")) {
    remediation.push("Set WASUREZU_RESTART_COMMAND=wasurezu-claude-start --launch or pass --restart-command to the preflight check");
  }
  if (result.reasons.includes("restart_adapter_id_missing")) {
    remediation.push("Pass --host-adapter-id and --adapter-registry-file so restart preflight can verify the registered adapter.");
  }
  if (result.reasons.includes("restart_adapter_not_registered")) {
    remediation.push("Register the host adapter with canonical_path, executable_sha256, allowed_argv, and enabled=true.");
  }
  if (result.reasons.includes("restart_lifecycle_not_preauthorized")) {
    remediation.push("Pass --restart-preauthorized flag or set WASUREZU_RESTART_PREAUTHORIZED=1 to confirm restart lifecycle is authorized");
  }

  return {
    cli: "wasurezu-restart preflight",
    checked_at: checkedAt,
    status: result.status,
    restart_command: result.command,
    command_kind: result.command_kind,
    cwd_independent: result.cwd_independent,
    resolved_path: result.resolved_path,
    restart_preauthorized: result.restart_preauthorized,
    reasons: result.reasons,
    diagnostics: result.diagnostics,
    remediation,
  };
}

async function main(): Promise<void> {
  const options = parseRestartCliArgs(process.argv.slice(2));
  if (options.command === "help") {
    console.log(printRestartCliHelp());
    return;
  }
  if (options.command === "preflight") {
    const restartPreauthorized =
      options.restart_preauthorized === true ||
      process.env.WASUREZU_RESTART_PREAUTHORIZED === "1" ||
      process.env.WASUREZU_RESTART_PREAUTHORIZED === "true";
    const adapterRegistry = loadAdapterRegistry(options.adapter_registry_file);
    const result = runSupervisorPreflight(
      options.restart_command,
      restartPreauthorized,
      new Date().toISOString(),
      process.env,
      options.host_adapter_id,
      adapterRegistry
    );
    console.log(redactedJson(result));
    if (result.status === "fail") process.exit(1);
    return;
  }
  if (options.command === "marker") {
    const result = writeRestartMarker({
      agent_id: options.agent_id,
      project: options.project,
      host: options.host,
      host_id: requiredOption("--host-id", options.host_id),
      host_adapter_id: requiredOption("--host-adapter-id", options.host_adapter_id),
      seat_id: options.seat_id,
      session_id: options.session_id,
      context_used_ratio: options.context_used_ratio,
      context_tokens: options.context_tokens,
      context_window_tokens: options.context_window_tokens,
      runtime_context_error: options.runtime_context_error,
      thresholds: options.thresholds,
      marker_path: options.marker_path,
      marker_dir: options.marker_dir,
    });
    console.log(redactedJson(result));
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
      console.log(redactedJson(pack));
      return;
    }
    if (options.command === "bridge") {
      const runtimeAuthority = loadRuntimeAuthority(options);
      const adapterRegistry = loadAdapterRegistry(options.adapter_registry_file);
      const result = await runRestartBridge({
        store,
        agentId: options.agent_id,
        project: options.project,
        markerPath: options.marker_path,
        markerDir: options.marker_dir,
        restartCommand: options.restart_command,
        restartPreauthorized: options.restart_preauthorized,
        execute: options.execute === true,
        agentCommsDatabaseUrl: options.agent_comms_db_url,
        runtimeAuthority,
        hostAdapterId: options.host_adapter_id,
        adapterRegistry,
        env: process.env,
      });
      console.log(redactedJson(result));
      return;
    }
    const output = await prepareRestart(store, options);
    console.log(redactedJson(output));
  } finally {
    await store.close();
  }
}

function redactedJson(value: unknown): string {
  return redactText(JSON.stringify(value, null, 2)).text;
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

function lifecycleMode(value: string): RestartLifecycleMode {
  if (value === "aun_supervised" || value === "standalone_supervisor" || value === "pure_mcp") return value;
  throw new Error(`invalid lifecycle mode: ${value}`);
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

function setThreshold(options: CliOptions, key: keyof RestartThresholdOverrides, value: number): void {
  options.thresholds = { ...(options.thresholds ?? {}), [key]: value };
}

function requiredOption(flag: string, value: string | undefined): string {
  if (!value) throw new Error(`missing required option: ${flag}`);
  return value;
}

function loadRuntimeAuthority(options: CliOptions): RestartRuntimeAuthority | undefined {
  if (options.runtime_authority_file) {
    return JSON.parse(readFileSync(options.runtime_authority_file, "utf8")) as RestartRuntimeAuthority;
  }
  if (!options.lifecycle_mode) return undefined;
  if (!options.host_id || !options.host_adapter_id || !options.session_id || !options.authority_ref || !options.authority_expires_at) {
    throw new Error("bridge lifecycle authority requires --host-id, --host-adapter-id, --session-id, --authority-ref, and --authority-expires-at");
  }
  return {
    lifecycle_mode: options.lifecycle_mode,
    agent_id: options.agent_id,
    project: options.project,
    seat_id: options.seat_id,
    host_id: options.host_id,
    session_id: options.session_id,
    host_adapter_id: options.host_adapter_id,
    supervisor_id: options.supervisor_id,
    supervisor_available: options.supervisor_available,
    restart_preauthorized: options.restart_preauthorized === true,
    authority_ref: options.authority_ref,
    expires_at: options.authority_expires_at,
    row_version: options.runtime_row_version ?? 1,
    aun_absent_confirmed: options.aun_absent_confirmed,
  };
}

function loadAdapterRegistry(path: string | undefined): RestartHostAdapterRegistry | undefined {
  if (!path) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as RestartHostAdapterRegistry;
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
    console.error(redactText(`wasurezu-restart failed: ${err}`).text);
    process.exit(1);
  });
}
