/**
 * One look at a seat: tmux, the screen, the clients and `ps`, gathered into the
 * plain values the decision core takes (watcher-design.md 2.4, 2.5). This is the
 * reading side only; it runs read commands and nothing that changes a pane.
 */
import { sha256Hex } from "./session-rotation-files.js";
import type { WatcherFs } from "./rotation-watcher-store.js";
import type { WatcherSeat } from "./rotation-watcher-config.js";
import type { Observation } from "./rotation-watcher-core.js";
import { parseProcessTable, type PsTableRun } from "./rotation-watcher-ps.js";
import {
  isSteady,
  proveHumanQuiet,
  proveInputRow,
  updateStability,
  type ScreenStability,
} from "./rotation-watcher-screen.js";
import {
  readClientActivities,
  readPaneState,
  readScreen,
  readTmuxVersion,
  resolvePaneId,
  type TmuxRun,
} from "./rotation-watcher-tmux.js";

/** Everything the watcher touches outside itself. Tests replace each one. */
export interface WatcherPorts {
  tmux: TmuxRun;
  ps: PsTableRun;
  fs: WatcherFs;
  /** Rotation root, e.g. `$AGENT_MEMORY_HOME/rotation`. */
  root: string;
  /** null where the platform has no uid; the config file is then not trusted. */
  uid: number | null;
  now_ms(): number;
  sleep(ms: number): Promise<void>;
  hash_file(path: string): string | null;
  pid_alive(pid: number): boolean;
  watcher_pid: number;
  new_attempt_id(): string;
}

/** What the watcher remembers about a seat between passes (kept in memory only). */
export interface SeatMemory {
  stability?: ScreenStability;
  last_skip_key?: string;
}

export const isoAt = (ms: number): string => new Date(ms).toISOString();

export function observeSeat(ports: WatcherPorts, seat: WatcherSeat, memory: SeatMemory): Observation {
  const nowSeconds = Math.floor(ports.now_ms() / 1_000);
  const resolved = resolvePaneId(ports.tmux, seat.tmux_target);
  const pane = resolved === null ? null : readPaneState(ports.tmux, resolved);
  const screen = pane === null ? null : readScreen(ports.tmux, pane);
  if (screen === null) memory.stability = undefined;
  else memory.stability = updateStability(memory.stability, sha256Hex(screen.text), nowSeconds);
  const clients = pane === null ? null : readClientActivities(ports.tmux, pane.session_id);
  return {
    resolved_pane_id: resolved,
    pane,
    tmux_version: readTmuxVersion(ports.tmux),
    processes: parseProcessTable(ports.ps()),
    launch_script_sha256: ports.hash_file(seat.launch_script.path),
    input: screen === null ? null : proveInputRow(screen, seat.prompt_markers, seat.placeholder_patterns),
    human: proveHumanQuiet(clients, nowSeconds, seat.human_quiet_seconds),
    screen_steady: isSteady(memory.stability, nowSeconds, seat.quiet_seconds),
  };
}
