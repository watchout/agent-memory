/**
 * The rotation watcher's decision core (watcher-design.md 2.4, 3.1, 3.2 step 7).
 * Pure: markers, turn records, tmux and process observations, screen proofs and
 * the current time all arrive as arguments. It reads no clock, no file, no
 * random source (standard S4). Anything unreadable or unmatched returns a skip
 * with a reason; "could not observe" is never read as "ok" (standard S5).
 */
import type { RotationMarker, RotationOutputWritten, RotationTurn } from "./session-rotation-files.js";
import type { PaneState } from "./rotation-watcher-tmux.js";
import type { HumanProof, InputProof } from "./rotation-watcher-screen.js";
import { checkHost, descendantsNamed, isSameOrDescendant, type ProcessTable } from "./rotation-watcher-ps.js";
import type { WatcherSeat } from "./rotation-watcher-config.js";

/**
 * Why a pass did nothing, and what kind of nothing it is. `idle`: nothing is
 * pending. `waiting`: the seat is in a state where acting is not allowed yet.
 * `unobservable`: the watcher could not read something it needs. `mismatch`:
 * what it read does not match the registered seat.
 */
const REASON_CLASS = {
  halted: "idle",
  no_marker: "idle",
  claim_exists: "idle",
  marker_expired: "idle",
  marker_time_invalid: "unobservable",
  no_turn: "unobservable",
  identity_mismatch: "mismatch",
  binding_missing: "unobservable",
  binding_mismatch: "mismatch",
  session_mismatch: "mismatch",
  turn_busy: "waiting",
  turn_not_idle: "waiting",
  turn_older_than_marker: "waiting",
  turn_not_quiet_yet: "waiting",
  min_interval: "waiting",
  rate_limited: "waiting",
  tmux_unreadable: "unobservable",
  tmux_unsupported: "unobservable",
  pane_unresolved: "unobservable",
  pane_mismatch: "mismatch",
  socket_mismatch: "mismatch",
  pane_dead: "waiting",
  pane_in_mode: "waiting",
  launch_command_mismatch: "mismatch",
  launch_script_unreadable: "unobservable",
  launch_script_changed: "mismatch",
  ps_unreadable: "unobservable",
  host_gone: "mismatch",
  host_replaced: "mismatch",
  host_command_mismatch: "mismatch",
  host_not_in_pane: "mismatch",
  import_running: "waiting",
  screen_unreadable: "unobservable",
  screen_not_steady: "waiting",
  input_row_not_found: "unobservable",
  input_not_empty: "waiting",
  cursor_not_at_input_head: "waiting",
  clients_unreadable: "unobservable",
  human_active: "waiting",
  // Raised by the procedure around the decision, classified in the same place.
  claim_unreadable: "unobservable",
  claim_unwritable: "unobservable",
  ledger_unwritable: "unobservable",
  ledger_unreadable: "unobservable",
  in_progress_elsewhere: "idle",
  tmux_condition_false: "waiting",
  config_invalid: "unobservable",
} as const;

export type SkipReason = keyof typeof REASON_CLASS;
export type SkipClass = (typeof REASON_CLASS)[SkipReason];

export interface Skip {
  action: "skip";
  reason: SkipReason;
  class: SkipClass;
}

export const skipClass = (reason: SkipReason): SkipClass => REASON_CLASS[reason];

const skip = (reason: SkipReason): Skip => ({ action: "skip", reason, class: REASON_CLASS[reason] });

/** What the watcher read from tmux, `ps` and the screen in one look at a seat. */
export interface Observation {
  resolved_pane_id: string | null;
  pane: PaneState | null;
  tmux_version: string | null;
  processes: ProcessTable | null;
  launch_script_sha256: string | null;
  /** null when the screen could not be read. */
  input: InputProof | null;
  human: HumanProof;
  /** The screen digest has stayed the same for `quiet_seconds`. */
  screen_steady: boolean;
}

/** Values taken at the moment of decision; the tmux condition is built from these. */
export interface RelaunchPlan {
  marker_id: string;
  pane_id: string;
  pane_pid: number;
  cursor_x: number;
  cursor_y: number;
  session_attached: number;
  session_id: string;
  host_pid: number;
  host_started_at: string;
  turn_at: string;
  input_row_sha256: string;
  client_activity_max: number | null;
  launch_script_sha256: string;
}

export type Proceed = { action: "proceed"; plan: RelaunchPlan };
export type RelaunchDecision = Skip | { action: "observe" } | Proceed;

export interface RelaunchInputs {
  seat: WatcherSeat;
  marker: RotationMarker | null;
  turn: RotationTurn | null;
  now_ms: number;
  claim_exists: boolean;
  last_respawn_ms: number | null;
  respawns_in_last_hour: number;
  halt_global: boolean;
  halt_seat: boolean;
  observation: Observation | null;
}

function parseTime(value: string): number | null {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/** Conditions that need only the two local files and the seat's registration (3.1, 1 to 3 and 7 to 9). */
function checkFiles(input: RelaunchInputs): Skip | null {
  const { seat, marker, turn } = input;
  if (input.halt_global || input.halt_seat) return skip("halted");
  if (marker === null) return skip("no_marker");
  if (input.claim_exists) return skip("claim_exists");
  const savedAt = parseTime(marker.saved_at);
  if (savedAt === null) return skip("marker_time_invalid");
  if (input.now_ms - savedAt > seat.marker_ttl_seconds * 1_000) return skip("marker_expired");
  if (turn === null) return skip("no_turn");
  for (const record of [marker, turn]) {
    if (record.agent_id !== seat.agent_id || record.project !== seat.project || record.host !== seat.host) {
      return skip("identity_mismatch");
    }
  }
  const markerBinding = [marker.pane_id, marker.tmux_socket, marker.host_pid, marker.host_started_at];
  const turnBinding = [turn.pane_id, turn.tmux_socket, turn.host_pid, turn.host_started_at];
  if (markerBinding.includes(null) || turnBinding.includes(null)) return skip("binding_missing");
  if (markerBinding.some((value, index) => value !== turnBinding[index])) return skip("binding_mismatch");
  if (turn.session_id !== marker.session_id) return skip("session_mismatch");
  if (turn.state === "busy") return skip("turn_busy");
  if (turn.state !== "idle") return skip("turn_not_idle");
  const turnAt = parseTime(turn.at);
  if (turnAt === null || turnAt < savedAt) return skip("turn_older_than_marker");
  if (input.now_ms - turnAt < seat.quiet_seconds * 1_000) return skip("turn_not_quiet_yet");
  if (input.last_respawn_ms !== null && input.now_ms - input.last_respawn_ms < seat.min_interval_seconds * 1_000) {
    return skip("min_interval");
  }
  if (input.respawns_in_last_hour >= seat.max_per_hour) return skip("rate_limited");
  return null;
}

/**
 * Conditions on what was just read (2.4 items 1, 2, 3, 5 and 2.5). The marker and turn
 * are known to agree already. `requireSteady` is off for the last look before acting.
 */
function checkObservation(
  seat: WatcherSeat,
  marker: RotationMarker,
  turn: RotationTurn,
  observation: Observation,
  requireSteady: boolean,
): Skip | RelaunchPlan {
  const { pane } = observation;
  if (observation.resolved_pane_id === null) return skip("pane_unresolved");
  if (pane === null) return skip("tmux_unreadable");
  if (observation.tmux_version === null) return skip("tmux_unsupported");
  if (observation.resolved_pane_id !== marker.pane_id || pane.pane_id !== marker.pane_id) return skip("pane_mismatch");
  if (pane.socket_path !== marker.tmux_socket) return skip("socket_mismatch");
  if (pane.pane_dead) return skip("pane_dead");
  if (pane.pane_in_mode) return skip("pane_in_mode");
  if (pane.start_command !== seat.launch_command) return skip("launch_command_mismatch");
  if (observation.launch_script_sha256 === null) return skip("launch_script_unreadable");
  if (observation.launch_script_sha256 !== seat.launch_script.sha256) return skip("launch_script_changed");
  if (observation.processes === null) return skip("ps_unreadable");
  const host = checkHost(
    observation.processes,
    marker.host_pid as number,
    [marker.host_started_at as string, turn.host_started_at as string],
    seat.expected_command,
    pane.pane_pid,
  );
  if (!host.alive) return skip("host_gone");
  if (!host.started_at_matches) return skip("host_replaced");
  if (!host.command_matches) return skip("host_command_mismatch");
  if (!host.in_pane) return skip("host_not_in_pane");
  if (descendantsNamed(observation.processes, marker.host_pid as number, seat.drain_commands).length > 0) {
    return skip("import_running");
  }
  if (requireSteady && !observation.screen_steady) return skip("screen_not_steady");
  const { input, human } = observation;
  if (input === null) return skip("screen_unreadable");
  if (!input.found) return skip("input_row_not_found");
  if (!input.empty) return skip("input_not_empty");
  if (!input.cursor_at_input_head) return skip("cursor_not_at_input_head");
  if (!human.observed) return skip("clients_unreadable");
  if (!human.quiet) return skip("human_active");
  return {
    marker_id: marker.marker_id,
    pane_id: pane.pane_id,
    pane_pid: pane.pane_pid,
    cursor_x: pane.cursor_x,
    cursor_y: pane.cursor_y,
    session_attached: pane.session_attached,
    session_id: pane.session_id,
    host_pid: marker.host_pid as number,
    host_started_at: marker.host_started_at as string,
    turn_at: turn.at,
    input_row_sha256: input.row_sha256 as string,
    client_activity_max: human.latest_activity,
    launch_script_sha256: observation.launch_script_sha256,
  };
}

/**
 * Decides whether to relaunch a seat now. With no observation it answers
 * "observe" once the file-level conditions hold, so the caller reads tmux, `ps`
 * and the screen only for a seat with something pending.
 */
export function decideRotationRelaunch(input: RelaunchInputs & { observation: Observation }): Skip | Proceed;
export function decideRotationRelaunch(input: RelaunchInputs): RelaunchDecision;
export function decideRotationRelaunch(input: RelaunchInputs): RelaunchDecision {
  const blocked = checkFiles(input);
  if (blocked) return blocked;
  if (input.observation === null) return { action: "observe" };
  const result = checkObservation(input.seat, input.marker as RotationMarker, input.turn as RotationTurn, input.observation, true);
  return "action" in result ? result : { action: "proceed", plan: result };
}

/**
 * The last look before the claim is turned into a respawn (3.2 step 4): same
 * marker, the turn is still the same idle record, and everything is read again.
 */
export function recheckBeforeRespawn(
  plan: RelaunchPlan,
  seat: WatcherSeat,
  marker: RotationMarker | null,
  turn: RotationTurn | null,
  observation: Observation,
): Skip | Proceed {
  if (marker === null || marker.marker_id !== plan.marker_id) return skip("no_marker");
  if (turn === null) return skip("no_turn");
  if (turn.state !== "idle") return skip(turn.state === "busy" ? "turn_busy" : "turn_not_idle");
  if (turn.at !== plan.turn_at || turn.session_id !== marker.session_id) return skip("session_mismatch");
  for (const [markerValue, turnValue] of [
    [marker.pane_id, turn.pane_id],
    [marker.tmux_socket, turn.tmux_socket],
    [marker.host_pid, turn.host_pid],
    [marker.host_started_at, turn.host_started_at],
  ] as const) {
    if (markerValue === null || markerValue !== turnValue) return skip("binding_mismatch");
  }
  const result = checkObservation(seat, marker, turn, observation, false);
  return "action" in result ? result : { action: "proceed", plan: result };
}

export interface ConfirmInputs {
  seat: WatcherSeat;
  marker: RotationMarker;
  turn: RotationTurn | null;
  /** The record the start hook wrote after its answer (null when there is none or it cannot be read). */
  output_written: RotationOutputWritten | null;
  pane: PaneState | null;
  processes: ProcessTable | null;
  pane_pid_before: number;
  respawn_started_ms: number;
}

/** What the confirmation stands on: the hook's output-written record, or (only without one) an old hook's turn mark. */
export type ConfirmationBasis = "output_written" | "legacy_turn_marker";

interface StartFacts {
  agent_id: string;
  project: string;
  host: string;
  session_id: string;
  source: string | null;
  pane_id: string | null;
  tmux_socket: string | null;
  host_pid: number | null;
  at: string;
}

/**
 * Whether the new conversation really started after the respawn (3.2 step 7): the pane process changed, and the start
 * came from the ordered start of the same seat in the same pane, with a different conversation and host process.
 * The basis is the output-written record when there is one (it alone decides); with none, an old hook's `started`
 * turn that carries this marker is read as before (standard S6: old and new hooks live side by side).
 */
export function confirmationBasis(input: ConfirmInputs): ConfirmationBasis | null {
  const { seat, marker, turn, pane, processes } = input;
  if (pane === null || processes === null) return null;
  if (pane.pane_id !== marker.pane_id || pane.pane_pid === input.pane_pid_before) return null;
  const record = input.output_written;
  let basis: ConfirmationBasis;
  let facts: StartFacts;
  if (record !== null) {
    if (record.marker_id !== marker.marker_id) return null;
    basis = "output_written";
    facts = { ...record, at: record.turn_at };
  } else {
    if (turn === null || turn.state !== "started" || turn.rotation_marker_id !== marker.marker_id) return null;
    basis = "legacy_turn_marker";
    facts = turn;
  }
  const at = parseTime(facts.at);
  const fits =
    facts.source === "startup" &&
    facts.agent_id === seat.agent_id &&
    facts.project === seat.project &&
    facts.host === seat.host &&
    facts.pane_id === marker.pane_id &&
    facts.tmux_socket === marker.tmux_socket &&
    facts.session_id !== marker.session_id &&
    facts.host_pid !== null &&
    facts.host_pid !== marker.host_pid &&
    isSameOrDescendant(processes, pane.pane_pid, facts.host_pid) &&
    at !== null &&
    at >= input.respawn_started_ms;
  return fits ? basis : null;
}
