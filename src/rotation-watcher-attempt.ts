/**
 * The once-per-marker procedure that ends in a pane respawn (watcher-design.md 3.2, 5).
 * Order matters and is the point of this file: claim first, evidence of intent
 * second, a fresh look third, the claim set to `respawning` before the one
 * conditional respawn, then a read-only confirmation. A respawn is never issued
 * twice for a marker, and an unknown result is looked up, never retried.
 */
import { readMarker, readTurn, sha256Hex, type RotationMarker } from "./session-rotation-files.js";
import {
  advanceClaim,
  appendLedger,
  createClaim,
  seatHaltPath,
  writeHalt,
  type ClaimRecord,
  type LedgerFields,
} from "./rotation-watcher-store.js";
import {
  isNewConversationConfirmed,
  recheckBeforeRespawn,
  skipClass,
  type RelaunchPlan,
  type SkipReason,
} from "./rotation-watcher-core.js";
import type { WatcherSeat } from "./rotation-watcher-config.js";
import { isoAt, observeSeat, type SeatMemory, type WatcherPorts } from "./rotation-watcher-observe.js";
import { parseProcessTable } from "./rotation-watcher-ps.js";
import { conditionalRespawn, readPaneState } from "./rotation-watcher-tmux.js";
import { ROTATION_WATCHER_CONFIRM_POLL_SECONDS } from "./constants.js";

export type SeatTickClass = "idle" | "waiting" | "unobservable" | "mismatch" | "progress";

export interface SeatTick {
  class: SeatTickClass;
  reason: string;
  /** The seat could not be kept safe on disk after a respawn (not even a HALT file): the runner must stop (S8). */
  stop_runner?: true;
}

const stopped = (reason: SkipReason): SeatTick => ({ class: skipClass(reason), reason });

function baseFields(ports: WatcherPorts, seat: WatcherSeat, marker: RotationMarker, attemptId: string | null): LedgerFields {
  return {
    at: isoAt(ports.now_ms()),
    attempt_id: attemptId,
    marker_id: marker.marker_id,
    host: seat.host,
    agent_id: seat.agent_id,
    project: seat.project,
  };
}

/** Whether the new conversation has started, from a fresh read of tmux, `ps` and the turn file. */
function lookConfirmed(
  ports: WatcherPorts,
  seat: WatcherSeat,
  seatDir: string,
  marker: RotationMarker,
  paneIdBefore: string,
  panePidBefore: number,
  startedMs: number,
): boolean {
  return isNewConversationConfirmed({
    seat,
    marker,
    turn: readTurn(seatDir),
    pane: readPaneState(ports.tmux, paneIdBefore),
    processes: parseProcessTable(ports.ps()),
    pane_pid_before: panePidBefore,
    respawn_started_ms: startedMs,
  });
}

function haltSeat(ports: WatcherPorts, seatDir: string, reason: string): boolean {
  return writeHalt(ports.fs, seatHaltPath(seatDir), reason, isoAt(ports.now_ms()));
}

/** How one attempt ended once the respawn was (or may have been) issued. */
interface Outcome {
  state: "done" | "unconfirmed" | "unknown_quarantined";
  resolution: string;
  kind: "confirmed" | "unconfirmed" | "outcome_unknown";
  detail?: string;
  /** The tick reason when everything was recorded. */
  tick: string;
  /** Written to the seat's HALT file even when everything was recorded; null when the seat may go on. */
  halt: string | null;
}

/**
 * Records the end of an attempt - the claim and the ledger line - and stops the seat
 * when either could not be written, because the interval and hourly limits would no
 * longer be true. The respawn already happened and is never undone; the tick says it
 * was not recorded, and if not even a HALT file can be written the runner is asked to stop.
 */
function finishAttempt(
  ports: WatcherPorts,
  seat: WatcherSeat,
  seatDir: string,
  marker: RotationMarker,
  claim: ClaimRecord,
  outcome: Outcome,
): SeatTick {
  const claimWritten = advanceClaim(ports.fs, seatDir, claim, { state: outcome.state, resolution: outcome.resolution }) !== null;
  const ledgerWritten = appendLedger(ports.fs, ports.root, outcome.kind, {
    ...baseFields(ports, seat, marker, claim.attempt_id),
    ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
  });
  const recorded = claimWritten && ledgerWritten;
  const reason = recorded ? outcome.tick : `${outcome.tick}_unrecorded`;
  const halt = recorded ? outcome.halt : reason;
  const unstoppable = halt !== null && !haltSeat(ports, seatDir, halt);
  return { class: "progress", reason, ...(unstoppable ? { stop_runner: true as const } : {}) };
}

/** Ends a claim that never reached the respawn, and records why. */
function abortBeforeRespawn(
  ports: WatcherPorts,
  seat: WatcherSeat,
  seatDir: string,
  marker: RotationMarker,
  claim: ClaimRecord,
  reason: SkipReason,
): SeatTick {
  advanceClaim(ports.fs, seatDir, claim, { state: "aborted_before_respawn", resolution: reason });
  appendLedger(ports.fs, ports.root, "skipped", { ...baseFields(ports, seat, marker, claim.attempt_id), reason });
  return stopped(reason);
}

/**
 * Looks up the outcome of a respawn whose result is not known, once, read-only.
 * Confirmed: the claim is `done`. Not confirmed: the claim is quarantined and the
 * seat is stopped, because a second respawn would end the new conversation.
 */
function resolveUnknown(
  ports: WatcherPorts,
  seat: WatcherSeat,
  seatDir: string,
  marker: RotationMarker,
  claim: ClaimRecord,
): SeatTick {
  const confirmed =
    claim.state === "respawning" &&
    claim.pane_pid_before !== null &&
    claim.respawn_started_at !== null &&
    marker.pane_id !== null &&
    lookConfirmed(ports, seat, seatDir, marker, marker.pane_id, claim.pane_pid_before, Date.parse(claim.respawn_started_at));
  if (confirmed) {
    return finishAttempt(ports, seat, seatDir, marker, claim, {
      state: "done",
      resolution: "confirmed_by_inquiry",
      kind: "confirmed",
      detail: "by_inquiry",
      tick: "confirmed_by_inquiry",
      halt: null,
    });
  }
  return finishAttempt(ports, seat, seatDir, marker, claim, {
    state: "unknown_quarantined",
    resolution: "outcome_unknown",
    kind: "outcome_unknown",
    tick: "outcome_unknown",
    halt: "outcome_unknown",
  });
}

/** A claim found at the start of a pass. Terminal ones are left alone; a live watcher keeps its own. */
export function resolveExistingClaim(
  ports: WatcherPorts,
  seat: WatcherSeat,
  seatDir: string,
  marker: RotationMarker,
  claim: ClaimRecord,
): SeatTick | null {
  if (claim.state !== "claimed" && claim.state !== "respawning") return null;
  if (ports.pid_alive(claim.watcher_pid)) return stopped("in_progress_elsewhere");
  return resolveUnknown(ports, seat, seatDir, marker, claim);
}

async function confirmAfterRespawn(
  ports: WatcherPorts,
  seat: WatcherSeat,
  seatDir: string,
  marker: RotationMarker,
  claim: ClaimRecord,
  plan: RelaunchPlan,
  startedMs: number,
): Promise<SeatTick> {
  const deadline = startedMs + seat.confirm_wait_seconds * 1_000;
  for (;;) {
    if (lookConfirmed(ports, seat, seatDir, marker, plan.pane_id, plan.pane_pid, startedMs)) {
      return finishAttempt(ports, seat, seatDir, marker, claim, {
        state: "done",
        resolution: "confirmed",
        kind: "confirmed",
        tick: "confirmed",
        halt: null,
      });
    }
    if (ports.now_ms() >= deadline) break;
    await ports.sleep(ROTATION_WATCHER_CONFIRM_POLL_SECONDS * 1_000);
  }
  return finishAttempt(ports, seat, seatDir, marker, claim, {
    state: "unconfirmed",
    resolution: "unconfirmed",
    kind: "unconfirmed",
    tick: "unconfirmed",
    halt: "unconfirmed",
  });
}

/**
 * Takes the claim and, if every look still agrees, issues the one conditional
 * respawn. `plan` is what the decision saw; the tmux condition is built from
 * the values of the fresh look that follows the claim.
 */
export async function attemptRelaunch(
  ports: WatcherPorts,
  seat: WatcherSeat,
  seatDir: string,
  memory: SeatMemory,
  marker: RotationMarker,
  plan: RelaunchPlan,
): Promise<SeatTick> {
  const created = createClaim(ports.fs, seatDir, {
    marker_id: marker.marker_id,
    launch_command_sha256: sha256Hex(seat.launch_command),
    attempt_id: ports.new_attempt_id(),
    watcher_pid: ports.watcher_pid,
    claimed_at: isoAt(ports.now_ms()),
  });
  if (created.result === "exists") return stopped("in_progress_elsewhere");
  if (created.result === "failed") return stopped("claim_unwritable");
  const claim = created.claim;
  const fields = baseFields(ports, seat, marker, claim.attempt_id);

  const intentWritten = appendLedger(ports.fs, ports.root, "intent", {
    ...fields,
    old_session_id: marker.session_id,
    pane_id: plan.pane_id,
    pane_pid: plan.pane_pid,
    host_pid: plan.host_pid,
    host_started_at: plan.host_started_at,
    launch_command_sha256: claim.launch_command_sha256,
    launch_script_sha256: plan.launch_script_sha256,
    input_row_sha256: plan.input_row_sha256,
    input_empty: true,
    client_activity_max: plan.client_activity_max,
  });
  if (!intentWritten) return abortBeforeRespawn(ports, seat, seatDir, marker, claim, "ledger_unwritable");

  const looked = recheckBeforeRespawn(plan, seat, readMarker(seatDir), readTurn(seatDir), observeSeat(ports, seat, memory));
  if (looked.action === "skip") return abortBeforeRespawn(ports, seat, seatDir, marker, claim, looked.reason);
  const fresh = looked.plan;

  const startedMs = ports.now_ms();
  const respawning = advanceClaim(ports.fs, seatDir, claim, {
    state: "respawning",
    respawn_started_at: isoAt(startedMs),
    pane_pid_before: fresh.pane_pid,
  });
  if (respawning === null) return abortBeforeRespawn(ports, seat, seatDir, marker, claim, "claim_unwritable");

  const outcome = conditionalRespawn(ports.tmux, {
    pane_id: fresh.pane_id,
    pane_pid: fresh.pane_pid,
    cursor_x: fresh.cursor_x,
    cursor_y: fresh.cursor_y,
    session_attached: fresh.session_attached,
    launch_command: seat.launch_command,
  });
  if (outcome === "not_respawned") return abortBeforeRespawn(ports, seat, seatDir, marker, respawning, "tmux_condition_false");
  if (outcome === "unknown") return resolveUnknown(ports, seat, seatDir, marker, respawning);

  const recorded = appendLedger(ports.fs, ports.root, "respawn_issued", {
    ...baseFields(ports, seat, marker, claim.attempt_id),
    pane_id: fresh.pane_id,
    pane_pid: fresh.pane_pid,
  });
  // Without this line the interval and hourly limits would not see the respawn: stop the seat, and the runner if even that fails.
  const unstoppable = !recorded && !haltSeat(ports, seatDir, "ledger_unwritable_after_respawn");
  const tick = await confirmAfterRespawn(ports, seat, seatDir, marker, respawning, fresh, startedMs);
  return unstoppable ? { ...tick, stop_runner: true as const } : tick;
}
