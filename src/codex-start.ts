#!/usr/bin/env node
/**
 * Codex startup bridge for restart_pack recovery.
 *
 * Codex exposes MCP tools, but it does not currently provide the same
 * deterministic SessionStart stdout injection path as Claude Code. This
 * bridge generates a restart_pack-backed initial prompt and can optionally
 * launch Codex with that prompt.
 */
import { spawn, spawnSync } from "child_process";
import { realpathSync } from "fs";
import { fileURLToPath } from "url";
import { createStore } from "./stores/index.js";
import type { Store } from "./stores/types.js";
import { DEFAULT_RECOVERY_CONFIG, RECOVERY_CONTROL_LINES, estimateTokens } from "./constants.js";
import { generateRestartPack } from "./restart-pack.js";
import { redactText } from "./redact.js";
import {
  buildKusabiRuntimeIdentityReadback,
  canonicalConfigDigest,
  KUSABI_ONE_SEAT_IDENTITY,
  verifyKusabiRuntimeIdentity,
  type KusabiRuntimeIdentityReadback,
} from "./kusabi-runtime-identity.js";

const AGENT_ID = process.env.AGENT_MEMORY_AGENT_ID || "default";
const PROJECT = process.env.AGENT_MEMORY_PROJECT || undefined;
const SESSION_ID = process.env.CODEX_SESSION_ID || `codex-boot-${Date.now()}`;

export interface CodexStartupPromptInput {
  agentId: string;
  project?: string;
  restartPack: string;
  extraInstruction?: string;
}

export interface CodexStartCliOptions {
  launch: boolean;
  dryRun: boolean;
  doctor: boolean;
  cd?: string;
  codexBin: string;
  maxTokens?: number;
  extraInstruction?: string;
}

export const CODEX_STARTUP_BRIDGE_ENV = "codex_startup_bridge_v1";
export const CODEX_POSITIONAL_PROMPT_CONTRACT = "codex [OPTIONS] [PROMPT]";
export const CODEX_PROMPT_DELIVERY_MODE = "positional-prompt-argv";
export const CODEX_ARGV_VISIBILITY_NOTE =
  "Codex prompt delivery currently uses a positional prompt argument unless a verified stdin or prompt-file Codex surface is available; this can expose the bounded restart_pack in the Codex process argv.";
export const KUSABI_INTERNAL_OPT_IN_ENV = "AGENT_MEMORY_KUSABI_INTERNAL_OPT_IN";
export const KUSABI_CODEX_START_CONFIG = Object.freeze({
  startup_bridge: CODEX_STARTUP_BRIDGE_ENV,
  prompt_delivery_mode: CODEX_PROMPT_DELIVERY_MODE,
  guard_mode: "pack_only",
  aun_supervised: false,
  auto_restart: false,
  external_send_enabled: false,
  provider_dispatch_enabled: false,
  queue_mutation_enabled: false,
});

export interface CodexDoctorCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface CodexDoctorReport {
  runner: "wasurezu-codex-start";
  codex_bin: string;
  positional_prompt_contract: string;
  prompt_delivery_mode: string;
  codex_help_available: boolean;
  codex_version_available: boolean;
  help_mentions_prompt_argument: boolean;
  version?: string;
  argv_visibility_risk: string;
  live_launch_performed: false;
  notes: string[];
}

export interface CodexLaunchPreview {
  runner: "wasurezu-codex-start";
  launch_requested: boolean;
  would_launch_codex: boolean;
  codex_bin: string;
  cd?: string;
  prompt_delivery_mode: string;
  positional_prompt_contract: string;
  argv_visibility_risk: string;
  prompt_chars: number;
  prompt_arg_index: number;
  args_preview: string[];
  live_launch_performed: false;
}

export function buildCodexStartupPrompt(input: CodexStartupPromptInput): string {
  const prompt = [
    "You are starting a fresh Codex session with wasurezu restart recovery context.",
    "",
    "Before claiming that prior context is unavailable, read and use the embedded restart_pack below.",
    `Agent memory namespace: agent_id=${input.agentId}${input.project ? `, project=${input.project}` : ""}.`,
    "",
    "Startup requirements:",
    "- First summarize the recovered current objective and next concrete action.",
    ...RECOVERY_CONTROL_LINES.map((line) => `- ${line}`),
    "- Clearly separate recovered facts, uncertainty, and any SSOT checks still needed.",
    "- Do not expose secrets, raw transcript dumps, private reasoning, or full home paths.",
    input.extraInstruction ? `- Additional instruction: ${input.extraInstruction}` : "",
    "",
    "Embedded restart_pack:",
    "```text",
    input.restartPack,
    "```",
  ]
    .filter(Boolean)
    .join("\n");
  return redactText(prompt).text;
}

export function parseArgs(args: string[]): CodexStartCliOptions {
  const options: CodexStartCliOptions = {
    launch: false,
    dryRun: false,
    doctor: false,
    codexBin: process.env.AGENT_MEMORY_CODEX_BIN || "codex",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--launch") {
      options.launch = true;
    } else if (arg === "--print") {
      options.launch = false;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--doctor") {
      options.doctor = true;
    } else if (arg === "--cd") {
      options.cd = requireValue(args, ++i, "--cd");
    } else if (arg === "--codex-bin") {
      options.codexBin = requireValue(args, ++i, "--codex-bin");
    } else if (arg === "--max-tokens") {
      const raw = requireValue(args, ++i, "--max-tokens");
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--max-tokens must be a positive integer, got ${raw}`);
      }
      options.maxTokens = parsed;
    } else if (arg === "--extra") {
      options.extraInstruction = requireValue(args, ++i, "--extra");
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  if (options.doctor) {
    console.log(JSON.stringify(buildCodexDoctorReport(options), null, 2));
    return;
  }

  const identityReadback = runKusabiRuntimeIdentityPreflight(process.env, {
    workspacePath: options.cd ?? process.cwd(),
    runtimeArtifactPath: fileURLToPath(import.meta.url),
  });
  if (identityReadback) {
    process.stderr.write(`[kusabi-runtime-identity] ${identityReadback.canonical_json}\n`);
  }

  const store = await createStore();

  try {
    const cfg = await store.getRecoveryConfig(AGENT_ID);
    const restartPack = await generateRestartPack(store, {
      agent_id: AGENT_ID,
      project: PROJECT,
      max_tokens: options.maxTokens ?? cfg?.max_tokens ?? DEFAULT_RECOVERY_CONFIG.max_tokens,
    });
    const prompt = buildCodexStartupPrompt({
      agentId: AGENT_ID,
      project: PROJECT,
      restartPack,
      extraInstruction: options.extraInstruction,
    });

    if (options.dryRun) {
      console.log(JSON.stringify(buildCodexLaunchPreview(options, prompt), null, 2));
      return;
    }

    await logCodexStartupQuality(store, restartPack, { launchRequested: options.launch });

    if (!options.launch) {
      console.log(prompt);
      return;
    }

    await launchCodex(options, prompt);
    await logCodexStartupQuality(store, restartPack, { launchRequested: true, launchedCodex: true });
  } finally {
    await store.close();
  }
}

export function runKusabiRuntimeIdentityPreflight(
  env: NodeJS.ProcessEnv,
  input: {
    workspacePath: string;
    runtimeArtifactPath: string;
    resolveRuntimeCommitSha?: (workspacePath: string) => string;
  },
): KusabiRuntimeIdentityReadback | undefined {
  if (env[KUSABI_INTERNAL_OPT_IN_ENV] !== "1") return undefined;

  const runtimeCommitSha = (input.resolveRuntimeCommitSha ?? resolveRuntimeCommitSha)(input.workspacePath);
  const readback = buildKusabiRuntimeIdentityReadback({
    agentId: env.AGENT_MEMORY_AGENT_ID ?? "",
    memoryProject: env.AGENT_MEMORY_PROJECT ?? "",
    workspaceRef: env.AGENT_MEMORY_WORKSPACE_REF ?? "",
    workspacePath: input.workspacePath,
    host: env.AGENT_MEMORY_HOST ?? "",
    adapter: env.AGENT_MEMORY_ADAPTER ?? "",
    lifecycleOwner: env.AGENT_MEMORY_LIFECYCLE_OWNER ?? "",
    runtimeCommitSha,
    runtimeArtifactPath: input.runtimeArtifactPath,
    config: KUSABI_CODEX_START_CONFIG,
  });
  const verification = verifyKusabiRuntimeIdentity(readback, {
    ...KUSABI_ONE_SEAT_IDENTITY,
    workspacePathHash: env.AGENT_MEMORY_EXPECTED_WORKSPACE_PATH_SHA256 ?? "",
    runtimeCommitSha: env.AGENT_MEMORY_EXPECTED_RUNTIME_COMMIT_SHA ?? "",
    runtimeArtifactDigest: env.AGENT_MEMORY_EXPECTED_RUNTIME_ARTIFACT_SHA256 ?? "",
    configDigest: env.AGENT_MEMORY_EXPECTED_CONFIG_SHA256 ?? "",
  });
  if (!verification.ok) {
    throw new Error(
      `${verification.code}: ${verification.mismatched_fields.join(",")}; ` +
        `db_open_count=0 model_invocation_count=0 external_effect_count=0`,
    );
  }
  return verification.readback;
}

export function expectedKusabiCodexStartConfigDigest(): string {
  return canonicalConfigDigest(KUSABI_CODEX_START_CONFIG);
}

function resolveRuntimeCommitSha(workspacePath: string): string {
  const result = spawnSync("git", ["-C", workspacePath, "rev-parse", "HEAD"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.status !== 0) {
    throw new Error("KUSABI_RUNTIME_COMMIT_UNAVAILABLE");
  }
  return result.stdout.trim();
}

export async function logCodexStartupQuality(
  store: Pick<Store, "logRecoveryQuality">,
  restartPack: string,
  options: { launchRequested: boolean; launchedCodex?: boolean }
): Promise<void> {
  await store.logRecoveryQuality({
    agent_id: AGENT_ID,
    session_id: SESSION_ID,
    recovered_tokens: estimateTokens(restartPack),
    task_continued: false,
    notes: JSON.stringify({
      source: "codex_startup_bridge",
      host_adapter: "codex_startup_bridge",
      host_adapter_level: 1,
      launch_requested: options.launchRequested,
      launched_codex: options.launchedCodex === true,
    }),
  }).catch((err: unknown) => {
    process.stderr.write(redactText(`[codex-start] logRecoveryQuality failed (non-fatal): ${err}\n`).text);
  });
}

function launchCodex(options: CodexStartCliOptions, prompt: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.codexBin, buildCodexLaunchArgs(options, prompt), {
      stdio: "inherit",
      env: buildCodexLaunchEnv(process.env),
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`codex exited with ${signal ?? code}`));
    });
  });
}

export function buildCodexLaunchArgs(options: Pick<CodexStartCliOptions, "cd">, prompt: string): string[] {
  return options.cd ? ["--cd", options.cd, prompt] : [prompt];
}

export function buildCodexLaunchPreview(
  options: Pick<CodexStartCliOptions, "launch" | "cd" | "codexBin">,
  prompt: string
): CodexLaunchPreview {
  const args = options.cd
    ? ["--cd", options.cd, "[restart_pack prompt omitted]"]
    : ["[restart_pack prompt omitted]"];
  return {
    runner: "wasurezu-codex-start",
    launch_requested: options.launch,
    would_launch_codex: options.launch,
    codex_bin: options.codexBin,
    cd: options.cd,
    prompt_delivery_mode: CODEX_PROMPT_DELIVERY_MODE,
    positional_prompt_contract: CODEX_POSITIONAL_PROMPT_CONTRACT,
    argv_visibility_risk: CODEX_ARGV_VISIBILITY_NOTE,
    prompt_chars: prompt.length,
    prompt_arg_index: args.length - 1,
    args_preview: args,
    live_launch_performed: false,
  };
}

export function buildCodexLaunchEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    AGENT_MEMORY_STARTUP_BRIDGE: CODEX_STARTUP_BRIDGE_ENV,
  };
}

export function buildCodexDoctorReport(
  options: Pick<CodexStartCliOptions, "codexBin">,
  runCommand: (bin: string, args: string[]) => CodexDoctorCommandResult = runCodexDoctorCommand
): CodexDoctorReport {
  const help = runCommand(options.codexBin, ["--help"]);
  const version = runCommand(options.codexBin, ["--version"]);
  const helpText = `${help.stdout}\n${help.stderr}`;
  const versionText = `${version.stdout}\n${version.stderr}`.trim();
  const helpMentionsPrompt = /\[?PROMPT\]?|initial prompt|positional prompt/i.test(helpText);
  return {
    runner: "wasurezu-codex-start",
    codex_bin: options.codexBin,
    positional_prompt_contract: CODEX_POSITIONAL_PROMPT_CONTRACT,
    prompt_delivery_mode: CODEX_PROMPT_DELIVERY_MODE,
    codex_help_available: help.status === 0,
    codex_version_available: version.status === 0,
    help_mentions_prompt_argument: helpMentionsPrompt,
    version: version.status === 0 && versionText ? versionText.split("\n")[0] : undefined,
    argv_visibility_risk: CODEX_ARGV_VISIBILITY_NOTE,
    live_launch_performed: false,
    notes: [
      "Doctor mode does not launch Codex.",
      "A positive help match means the local Codex help still advertises a prompt argument surface; it is not public-alpha recovery evidence.",
      "Use launcher-controlled runs plus recovery evidence for startup recovery claims.",
    ],
  };
}

function runCodexDoctorCommand(bin: string, args: string[]): CodexDoctorCommandResult {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    timeout: 5_000,
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? String(result.error) : undefined,
  };
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`wasurezu-codex-start

Generate a restart_pack-backed initial prompt for Codex, or launch Codex with it.

Usage:
  wasurezu-codex-start [--print]
  wasurezu-codex-start --launch [--cd DIR]

Options:
  --print              Print the generated prompt. This is the default.
  --launch             Launch Codex with the generated prompt.
  --dry-run            Print launch preview JSON without writing telemetry or launching Codex.
  --doctor             Check local Codex CLI help/version surfaces without launching Codex.
  --cd DIR             Pass a working directory to codex --cd when launching.
  --codex-bin PATH     Codex executable to run. Default: codex.
  --max-tokens N       restart_pack token budget override.
  --extra TEXT         Add one extra startup instruction to the prompt.

Restart UX:
  Exit the old Codex session first, then start a fresh one through this bridge:
    /exit
    wasurezu-codex-start --launch --cd <workspace>
  The bridge does not kill or replace existing Codex sessions.
  Current Codex prompt delivery uses the tested contract:
    ${CODEX_POSITIONAL_PROMPT_CONTRACT}
  Until a verified stdin or prompt-file Codex surface exists, the bounded
  restart_pack prompt may be visible in the Codex process argv.

Environment:
  AGENT_MEMORY_AGENT_ID       Memory namespace. Default: default.
  AGENT_MEMORY_PROJECT        Optional memory project.
  AGENT_MEMORY_DATABASE_URL   PostgreSQL URL. SQLite is used by default.
  AGENT_MEMORY_CODEX_BIN      Default executable for --launch.
`);
}

export function isMainEntrypoint(argvPath: string | undefined, metaUrl: string): boolean {
  if (!argvPath) return false;
  return realpathSync(argvPath) === realpathSync(fileURLToPath(metaUrl));
}

if (isMainEntrypoint(process.argv[1], import.meta.url)) {
  run().catch((err) => {
    console.error(redactText(`[wasurezu-codex-start] ${err instanceof Error ? err.message : err}`).text);
    process.exit(1);
  });
}
