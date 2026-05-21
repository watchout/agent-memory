#!/usr/bin/env node
/**
 * Codex startup bridge for restart_pack recovery.
 *
 * Codex exposes MCP tools, but it does not currently provide the same
 * deterministic SessionStart stdout injection path as Claude Code. This
 * bridge generates a restart_pack-backed initial prompt and can optionally
 * launch Codex with that prompt.
 */
import { spawn } from "child_process";
import { realpathSync } from "fs";
import { fileURLToPath } from "url";
import { createStore } from "./stores/index.js";
import { DEFAULT_RECOVERY_CONFIG, RECOVERY_CONTROL_LINES, estimateTokens } from "./constants.js";
import { generateRestartPack } from "./restart-pack.js";
import { redactText } from "./redact.js";

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
  cd?: string;
  codexBin: string;
  maxTokens?: number;
  extraInstruction?: string;
}

export const CODEX_STARTUP_BRIDGE_ENV = "codex_startup_bridge_v1";

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
    codexBin: process.env.AGENT_MEMORY_CODEX_BIN || "codex",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--launch") {
      options.launch = true;
    } else if (arg === "--print") {
      options.launch = false;
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

    await store.logRecoveryQuality({
      agent_id: AGENT_ID,
      session_id: SESSION_ID,
      recovered_tokens: estimateTokens(restartPack),
      task_continued: false,
      notes: JSON.stringify({
        source: "codex_startup_bridge",
        host_adapter: "codex_startup_bridge",
        host_adapter_level: 1,
        launched_codex: options.launch,
      }),
    }).catch((err) => {
      process.stderr.write(`[codex-start] logRecoveryQuality failed (non-fatal): ${err}\n`);
    });

    if (!options.launch) {
      console.log(prompt);
      return;
    }

    await launchCodex(options, prompt);
  } finally {
    await store.close();
  }
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

export function buildCodexLaunchEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    AGENT_MEMORY_STARTUP_BRIDGE: CODEX_STARTUP_BRIDGE_ENV,
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
  --cd DIR             Pass a working directory to codex --cd when launching.
  --codex-bin PATH     Codex executable to run. Default: codex.
  --max-tokens N       restart_pack token budget override.
  --extra TEXT         Add one extra startup instruction to the prompt.

Restart UX:
  Exit the old Codex session first, then start a fresh one through this bridge:
    /exit
    wasurezu-codex-start --launch --cd <workspace>
  The bridge does not kill or replace existing Codex sessions.

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
    console.error(`[wasurezu-codex-start] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
