/**
 * Read-only check to run before a seat is registered (watcher-design.md 2.5).
 * It looks at one pane and reports booleans, positions, the tmux version, the
 * pane start command and digests. It runs only display-message, list-clients and
 * capture-pane: it never evaluates the respawn condition and never changes a pane.
 */
import { proveHumanQuiet, proveInputRow } from "./rotation-watcher-screen.js";
import {
  buildRespawnCondition,
  readClientActivities,
  readPaneState,
  readScreen,
  readTmuxVersion,
  resolvePaneId,
  type TmuxRun,
} from "./rotation-watcher-tmux.js";

export interface ProbeOptions {
  tmux_target: string;
  prompt_markers: string[];
  placeholder_patterns: string[];
  launch_script: string | null;
}

export const PROBE_SCHEMA = "kusabi-rotation-watcher-probe/v1" as const;

export function probeSeat(
  tmux: TmuxRun,
  hashFile: (path: string) => string | null,
  nowMs: number,
  options: ProbeOptions,
) {
  const paneId = resolvePaneId(tmux, options.tmux_target);
  const pane = paneId === null ? null : readPaneState(tmux, paneId);
  const screen = pane === null ? null : readScreen(tmux, pane);
  const input = screen === null ? null : proveInputRow(screen, options.prompt_markers, options.placeholder_patterns);
  const clients = pane === null ? null : readClientActivities(tmux, pane.session_id);
  const human = proveHumanQuiet(clients, Math.floor(nowMs / 1_000), 0);
  const version = readTmuxVersion(tmux);
  const condition = pane === null
    ? null
    : buildRespawnCondition({
        pane_id: pane.pane_id,
        pane_pid: pane.pane_pid,
        cursor_x: pane.cursor_x,
        cursor_y: pane.cursor_y,
        session_attached: pane.session_attached,
        launch_command: pane.start_command,
      });
  return {
    schema_version: PROBE_SCHEMA,
    tmux_version: version,
    pane_resolved: paneId !== null,
    pane_read: pane !== null,
    pane_start_command: pane?.start_command ?? null,
    launch_command_chars_ok: condition !== null,
    conditional_respawn_form_supported: version !== null && condition !== null,
    cursor_x: pane?.cursor_x ?? null,
    cursor_y: pane?.cursor_y ?? null,
    input_row_found: input?.found ?? false,
    input_row: input?.row ?? null,
    input_column: input?.column ?? null,
    input_empty: input?.empty ?? false,
    cursor_at_input_head: input?.cursor_at_input_head ?? false,
    input_row_sha256: input?.row_sha256 ?? null,
    clients_readable: human.observed,
    client_count: clients?.length ?? null,
    client_activity_max: human.latest_activity,
    launch_script_sha256: options.launch_script === null ? null : hashFile(options.launch_script),
  };
}
