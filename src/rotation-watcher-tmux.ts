/**
 * The only door from the rotation watcher to tmux (watcher-design.md 3.3).
 * The commands it can run are a closed set: display-message -p, list-clients -F,
 * capture-pane -p, and one if-shell -F whose then-branch is respawn-pane -k -t
 * <pane_id> and whose else-branch is display-message -p NOT_RESPAWNED. Nothing
 * here types into a pane, and no command string is ever handed to respawn-pane,
 * so tmux re-runs the pane's own start command and nothing else.
 * Arguments are passed as an array (no shell). Every value placed in a command
 * is validated first; a value that fails validation yields "not readable".
 */
import { execFileSync } from "node:child_process";
import type { ScreenSnapshot } from "./rotation-watcher-screen.js";

export interface TmuxResult {
  ok: boolean;
  stdout: string;
}

/** Runs tmux with an argument array. Never throws: a failure is `ok: false`. */
export type TmuxRun = (argv: readonly string[]) => TmuxResult;

export const tmuxExec: TmuxRun = (argv) => {
  try {
    const stdout = execFileSync("tmux", [...argv], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
};

export const NOT_RESPAWNED = "NOT_RESPAWNED" as const;

const PANE_ID = /^%[0-9]+$/;
const SESSION_ID = /^\$[0-9]+$/;
const TARGET = /^[A-Za-z0-9_.-]+:[0-9]+\.[0-9]+$/;
const FIELD_SEPARATOR = "|||";

const line = (stdout: string): string => stdout.replace(/\r?\n$/, "");

function toInteger(value: string): number | null {
  return /^[0-9]+$/.test(value) ? Number(value) : null;
}

/** Resolves a configured `session:window.pane` to a stable pane id. */
export function resolvePaneId(run: TmuxRun, target: string): string | null {
  if (!TARGET.test(target)) return null;
  const result = run(["display-message", "-p", "-t", target, "#{pane_id}"]);
  const id = line(result.stdout);
  return result.ok && PANE_ID.test(id) ? id : null;
}

export interface PaneState {
  pane_id: string;
  pane_pid: number;
  pane_dead: boolean;
  pane_in_mode: boolean;
  cursor_x: number;
  cursor_y: number;
  session_attached: number;
  socket_path: string;
  session_id: string;
  start_command: string;
}

const PANE_FORMAT = [
  "#{pane_id}",
  "#{pane_pid}",
  "#{pane_dead}",
  "#{pane_in_mode}",
  "#{cursor_x}",
  "#{cursor_y}",
  "#{session_attached}",
  "#{socket_path}",
  "#{session_id}",
  "#{pane_start_command}",
].join(FIELD_SEPARATOR);

/** One read of everything the watcher compares. Any malformed field makes the whole read unreadable. */
export function readPaneState(run: TmuxRun, paneId: string): PaneState | null {
  if (!PANE_ID.test(paneId)) return null;
  const result = run(["display-message", "-p", "-t", paneId, PANE_FORMAT]);
  if (!result.ok) return null;
  const parts = line(result.stdout).split(FIELD_SEPARATOR);
  if (parts.length < 10) return null;
  const startCommand = parts.slice(9).join(FIELD_SEPARATOR);
  const [id, panePid, dead, inMode, cursorX, cursorY, attached, socket, session] = parts;
  const numbers = [panePid, cursorX, cursorY, attached].map(toInteger);
  if (id !== paneId || numbers.some((value) => value === null) || !SESSION_ID.test(session)) return null;
  if ((dead !== "0" && dead !== "1") || (inMode !== "0" && inMode !== "1") || socket === "") return null;
  return {
    pane_id: id,
    pane_pid: numbers[0] as number,
    pane_dead: dead === "1",
    pane_in_mode: inMode === "1",
    cursor_x: numbers[1] as number,
    cursor_y: numbers[2] as number,
    session_attached: numbers[3] as number,
    socket_path: socket,
    session_id: session,
    start_command: startCommand,
  };
}

/** Last-operation times (seconds) of every client on the session; null when the list cannot be read. */
export function readClientActivities(run: TmuxRun, sessionId: string): number[] | null {
  if (!SESSION_ID.test(sessionId)) return null;
  const result = run(["list-clients", "-t", sessionId, "-F", "#{client_activity}"]);
  if (!result.ok) return null;
  const rows = result.stdout.split("\n").filter((row) => row !== "");
  const values = rows.map(toInteger);
  return values.every((value): value is number => value !== null) ? values : null;
}

/** The visible area of the pane plus the cursor from the same pane state. */
export function readScreen(run: TmuxRun, state: PaneState): ScreenSnapshot | null {
  const result = run(["capture-pane", "-p", "-t", state.pane_id]);
  return result.ok ? { text: result.stdout, cursor_x: state.cursor_x, cursor_y: state.cursor_y } : null;
}

export function readTmuxVersion(run: TmuxRun): string | null {
  const result = run(["display-message", "-p", "#{version}"]);
  const version = line(result.stdout);
  return result.ok && /^[0-9][0-9A-Za-z.+-]*$/.test(version) ? version : null;
}

export interface RespawnCondition {
  pane_id: string;
  pane_pid: number;
  cursor_x: number;
  cursor_y: number;
  session_attached: number;
  launch_command: string;
}

const LAUNCH_COMMAND_IN_CONDITION = /^[A-Za-z0-9 "_./:=;@+~-]+$/;

/**
 * Builds the tmux condition. It only names things tmux can see (pane, pane
 * pid, mode, start command, cursor, client count); the host process is checked
 * by the caller just before (design 2.6). Returns null for a value that could
 * not be placed safely.
 */
export function buildRespawnCondition(condition: RespawnCondition): string | null {
  const integers = [condition.pane_pid, condition.cursor_x, condition.cursor_y, condition.session_attached];
  if (!PANE_ID.test(condition.pane_id) || !integers.every((value) => Number.isInteger(value) && value >= 0)) return null;
  if (!LAUNCH_COMMAND_IN_CONDITION.test(condition.launch_command)) return null;
  const terms = [
    `#{==:#{pane_id},${condition.pane_id}}`,
    `#{==:#{pane_pid},${condition.pane_pid}}`,
    "#{==:#{pane_dead},0}",
    "#{==:#{pane_in_mode},0}",
    `#{==:#{pane_start_command},${condition.launch_command}}`,
    `#{==:#{cursor_y},${condition.cursor_y}}`,
    `#{==:#{cursor_x},${condition.cursor_x}}`,
    `#{==:#{session_attached},${condition.session_attached}}`,
  ];
  return terms.reduceRight((rest, term) => `#{&&:${term},${rest}}`);
}

export type RespawnOutcome = "executed" | "not_respawned" | "unknown";

/**
 * The one command that can end a process. Called at most once per marker by
 * the procedure. `executed`: tmux evaluated the condition true and ran the
 * respawn (empty output, success). `unknown`: anything else.
 */
export function conditionalRespawn(run: TmuxRun, condition: RespawnCondition): RespawnOutcome {
  const expression = buildRespawnCondition(condition);
  if (expression === null) return "not_respawned";
  const paneId = condition.pane_id;
  const result = run([
    "if-shell",
    "-F",
    "-t",
    paneId,
    expression,
    `respawn-pane -k -t ${paneId}`,
    `display-message -p ${NOT_RESPAWNED}`,
  ]);
  if (!result.ok) return "unknown";
  const output = result.stdout.trim();
  if (output === NOT_RESPAWNED) return "not_respawned";
  return output === "" ? "executed" : "unknown";
}
