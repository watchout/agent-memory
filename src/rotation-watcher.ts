/**
 * Rotation watcher entry (watcher-design.md). A script, not an LLM: it reads local
 * files, tmux and `ps`, and at most respawns a registered pane. It holds no database
 * credential. Commands:
 *   run    loop over the registered seats (idles while a HALT file exists)
 *   once   one pass, prints what each seat did
 *   probe  read-only look at one pane before it is registered
 * Installing it on a seat is an Owner decision and is not done by this file.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROTATION_WATCHER_POLL_SECONDS } from "./constants.js";
import { currentUid } from "./process-uid.js";
import { rotationRoot } from "./session-rotation-files.js";
import { nodeWatcherFs } from "./rotation-watcher-store.js";
import { psTableExec } from "./rotation-watcher-ps.js";
import { tmuxExec } from "./rotation-watcher-tmux.js";
import type { WatcherPorts } from "./rotation-watcher-observe.js";
import { probeSeat, type ProbeOptions } from "./rotation-watcher-probe.js";
import { runPass, runWatcher, runnerMustStop } from "./rotation-watcher-run.js";

export type WatcherCommand =
  | { command: "run"; max_passes: number | null }
  | { command: "once" }
  | { command: "probe"; options: ProbeOptions }
  | { command: "error"; message: string };

const USAGE =
  "usage: rotation-watcher run [--max-passes N] | once | probe --tmux-target S:W.P --prompt-marker M [--prompt-marker M ...] [--placeholder-pattern P ...] [--launch-script PATH]";

export function parseWatcherArgs(argv: readonly string[]): WatcherCommand {
  const [command, ...rest] = argv;
  if (command === "once" && rest.length === 0) return { command: "once" };
  if (command === "run") {
    if (rest.length === 0) return { command: "run", max_passes: null };
    const passes = Number(rest[1]);
    return rest.length === 2 && rest[0] === "--max-passes" && Number.isInteger(passes) && passes > 0
      ? { command: "run", max_passes: passes }
      : { command: "error", message: USAGE };
  }
  if (command !== "probe") return { command: "error", message: USAGE };
  const options: ProbeOptions = { tmux_target: "", prompt_markers: [], placeholder_patterns: [], launch_script: null };
  for (let index = 0; index < rest.length; index += 2) {
    const value = rest[index + 1];
    if (value === undefined) return { command: "error", message: USAGE };
    if (rest[index] === "--tmux-target") options.tmux_target = value;
    else if (rest[index] === "--prompt-marker") options.prompt_markers.push(value);
    else if (rest[index] === "--placeholder-pattern") options.placeholder_patterns.push(value);
    else if (rest[index] === "--launch-script") options.launch_script = value;
    else return { command: "error", message: USAGE };
  }
  return options.tmux_target === "" || options.prompt_markers.length === 0
    ? { command: "error", message: USAGE }
    : { command: "probe", options };
}

function sha256OfFile(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function realPorts(env: NodeJS.ProcessEnv): WatcherPorts {
  return {
    tmux: tmuxExec,
    ps: psTableExec,
    fs: nodeWatcherFs,
    root: rotationRoot(env),
    uid: currentUid(),
    now_ms: () => Date.now(),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    hash_file: sha256OfFile,
    pid_alive: pidAlive,
    watcher_pid: process.pid,
    new_attempt_id: () => randomUUID(),
  };
}

export async function runWatcherCli(
  argv: readonly string[],
  ports: WatcherPorts,
  write: (line: string) => void,
  pollMs: number = ROTATION_WATCHER_POLL_SECONDS * 1_000,
): Promise<number> {
  const parsed = parseWatcherArgs(argv);
  if (parsed.command === "error") {
    write(`${parsed.message}\n`);
    return 2;
  }
  if (parsed.command === "probe") {
    write(`${JSON.stringify(probeSeat(ports.tmux, ports.hash_file, ports.now_ms(), parsed.options))}\n`);
    return 0;
  }
  if (parsed.command === "once") {
    const pass = await runPass(ports, new Map());
    const mustStop = runnerMustStop(ports, pass);
    write(`${JSON.stringify(pass)}\n`);
    return mustStop ? 4 : pass.config_reason === null ? 0 : 1;
  }
  const result = await runWatcher(ports, {
    poll_ms: pollMs,
    ...(parsed.max_passes === null ? {} : { max_passes: parsed.max_passes }),
    log: (line) => write(`${line}\n`),
  });
  return result.stopped ? 4 : result.halted_global ? 3 : 0;
}

async function main(): Promise<void> {
  process.exitCode = await runWatcherCli(process.argv.slice(2), realPorts(process.env), (line) => {
    process.stdout.write(line);
  });
}

let invokedPath = "";
try {
  invokedPath = process.argv[1] ? realpathSync(resolve(process.argv[1])) : "";
} catch {
  invokedPath = "";
}
if (invokedPath === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    process.stderr.write(`rotation-watcher failed: ${error instanceof Error ? error.message : "unknown"}\n`);
    process.exitCode = 1;
  });
}
