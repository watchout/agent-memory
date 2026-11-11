/**
 * One pass over the configured seats, and the loop around it (watcher-design.md 3, 7).
 * A pass reads the config, and for each seat either does nothing (with a reason)
 * or hands one fresh marker to the once-per-marker procedure. The loop idles while
 * a HALT file exists, and writes the global HALT after too many passes in which
 * the watcher could not see what it needs (the waiting rule: stop, do not spin).
 */
import { readMarker, readTurn, seatDirectory } from "./session-rotation-files.js";
import {
  appendLedger,
  globalHaltPath,
  isTerminalClaim,
  readClaimRecord,
  seatHaltPath,
  summarizeLedger,
  writeHalt,
  type LedgerSummary,
} from "./rotation-watcher-store.js";
import { decideRotationRelaunch, skipClass, type Skip } from "./rotation-watcher-core.js";
import {
  checkConfigPermissions,
  parseWatcherConfig,
  type WatcherConfig,
  type WatcherSeat,
} from "./rotation-watcher-config.js";
import { isoAt, observeSeat, type SeatMemory, type WatcherPorts } from "./rotation-watcher-observe.js";
import { attemptRelaunch, resolveExistingClaim, type SeatTick } from "./rotation-watcher-attempt.js";
import { ROTATION_WATCHER_NO_PROGRESS_HALT_LIMIT } from "./constants.js";
import { join } from "node:path";

export const watcherConfigPath = (root: string): string => join(root, "watcher-config.json");

/** Reasons that mean nothing is pending; they leave no ledger line. */
const QUIET_REASONS: readonly string[] = ["halted", "no_marker", "claim_exists"];

function noteSkip(ports: WatcherPorts, seat: WatcherSeat, memory: SeatMemory, markerId: string | null, skip: Skip): SeatTick {
  const key = `${markerId ?? "none"}/${skip.reason}`;
  if (markerId !== null && !QUIET_REASONS.includes(skip.reason) && memory.last_skip_key !== key) {
    appendLedger(ports.fs, ports.root, "skipped", {
      at: isoAt(ports.now_ms()),
      attempt_id: null,
      marker_id: markerId,
      host: seat.host,
      agent_id: seat.agent_id,
      project: seat.project,
      reason: skip.reason,
    });
  }
  memory.last_skip_key = key;
  return { class: skip.class, reason: skip.reason };
}

export async function tickSeat(ports: WatcherPorts, seat: WatcherSeat, memory: SeatMemory): Promise<SeatTick> {
  const seatDir = seatDirectory(ports.root, seat.agent_id, seat.project);
  const marker = readMarker(seatDir);
  const turn = readTurn(seatDir);
  const nowMs = ports.now_ms();

  let claimExists = false;
  if (marker !== null) {
    const read = readClaimRecord(ports.fs, seatDir, marker.marker_id);
    if (read.kind === "unreadable") {
      return noteSkip(ports, seat, memory, marker.marker_id, { action: "skip", reason: "claim_unreadable", class: skipClass("claim_unreadable") });
    }
    if (read.kind === "found") {
      claimExists = true;
      const resolved = isTerminalClaim(read.claim) ? null : resolveExistingClaim(ports, seat, seatDir, marker, read.claim);
      if (resolved !== null) return resolved;
    }
  }

  let history: Extract<LedgerSummary, { readable: true }> = { readable: true, last_respawn_ms: null, respawns_in_last_hour: 0 };
  if (marker !== null) {
    const summary = summarizeLedger(ports.fs, ports.root, seat.agent_id, seat.project, nowMs);
    // Without the history the interval and hourly limits cannot be judged: no respawn (S5).
    if (!summary.readable) {
      return noteSkip(ports, seat, memory, marker.marker_id, { action: "skip", reason: "ledger_unreadable", class: skipClass("ledger_unreadable") });
    }
    history = summary;
  }
  const inputs = {
    seat,
    marker,
    turn,
    now_ms: nowMs,
    claim_exists: claimExists,
    last_respawn_ms: history.last_respawn_ms,
    respawns_in_last_hour: history.respawns_in_last_hour,
    halt_global: ports.fs.exists(globalHaltPath(ports.root)),
    halt_seat: ports.fs.exists(seatHaltPath(seatDir)),
    observation: null,
  };
  const first = decideRotationRelaunch(inputs);
  const decision = first.action === "observe"
    ? decideRotationRelaunch({ ...inputs, observation: observeSeat(ports, seat, memory) })
    : first;
  if (decision.action === "skip") return noteSkip(ports, seat, memory, marker?.marker_id ?? null, decision);
  // A proceed decision exists only for a present marker; the decision core guarantees it.
  return attemptRelaunch(ports, seat, seatDir, memory, marker!, decision.plan);
}

export interface PassResult {
  config_reason: string | null;
  rejected: Array<{ index: number; reason: string }>;
  halt_limit: number;
  seats: Array<{ agent_id: string; project: string; tick: SeatTick }>;
}

function loadConfig(ports: WatcherPorts): { ok: true; config: WatcherConfig; rejected: PassResult["rejected"] } | { ok: false; reason: string } {
  const path = watcherConfigPath(ports.root);
  const file = ports.fs.stat(path);
  const folder = ports.fs.stat(ports.root);
  if (file === null || folder === null) return { ok: false, reason: "config_missing" };
  const permission = checkConfigPermissions({ uid: ports.uid, file, folder });
  if (!permission.ok) return { ok: false, reason: permission.reason };
  const text = ports.fs.readText(path);
  if (text === null) return { ok: false, reason: "config_unreadable" };
  const parsed = parseWatcherConfig(text);
  return parsed.ok ? { ok: true, ...parsed.value } : { ok: false, reason: parsed.reason };
}

export async function runPass(ports: WatcherPorts, memories: Map<string, SeatMemory>): Promise<PassResult> {
  const loaded = loadConfig(ports);
  if (!loaded.ok) {
    return { config_reason: loaded.reason, rejected: [], halt_limit: ROTATION_WATCHER_NO_PROGRESS_HALT_LIMIT, seats: [] };
  }
  const seats: PassResult["seats"] = [];
  for (const seat of loaded.config.seats) {
    const key = `${seat.agent_id}/${seat.project}`;
    const memory = memories.get(key) ?? {};
    memories.set(key, memory);
    const tick = await tickSeat(ports, seat, memory);
    seats.push({ agent_id: seat.agent_id, project: seat.project, tick });
    // A seat that could not be kept safe on disk stops the runner: nothing further may run, not even for the next seat (S8).
    if (tick.stop_runner === true) break;
  }
  return { config_reason: null, rejected: loaded.rejected, halt_limit: loaded.config.no_progress_halt_limit, seats };
}

/** A pass counts as non-progress when the watcher could not see what it needs and did nothing. */
export function isNonProgress(pass: PassResult): boolean {
  if (pass.seats.some((entry) => entry.tick.class === "progress")) return false;
  return pass.config_reason !== null || pass.seats.some((entry) => entry.tick.class === "unobservable");
}

export interface LoopOptions {
  poll_ms: number;
  max_passes?: number;
  log(line: string): void;
}

export interface LoopResult {
  passes: number;
  halted_global: boolean;
  /** A seat could not be kept safe on disk after a respawn, so the runner stopped (S8). */
  stopped?: true;
}

/**
 * When a seat's tick asks the runner to stop (its state could not be recorded, not even
 * a HALT), nothing further may run: write the global HALT if that is still possible.
 */
export function runnerMustStop(ports: WatcherPorts, pass: PassResult): boolean {
  if (!pass.seats.some((entry) => entry.tick.stop_runner === true)) return false;
  writeHalt(ports.fs, globalHaltPath(ports.root), "state_unrecordable", isoAt(ports.now_ms()));
  return true;
}

export async function runWatcher(ports: WatcherPorts, options: LoopOptions): Promise<LoopResult> {
  const memories = new Map<string, SeatMemory>();
  let passes = 0;
  let nonProgress = 0;
  let lastSummary = "";
  while (options.max_passes === undefined || passes < options.max_passes) {
    passes += 1;
    if (ports.fs.exists(globalHaltPath(ports.root))) {
      await ports.sleep(options.poll_ms);
      continue;
    }
    const pass = await runPass(ports, memories);
    // One line per change, not per pass: waiting must not pile up output.
    const summary = JSON.stringify({ config_reason: pass.config_reason, seats: pass.seats });
    if (summary !== lastSummary) options.log(JSON.stringify({ at: isoAt(ports.now_ms()), ...JSON.parse(summary) }));
    lastSummary = summary;
    if (runnerMustStop(ports, pass)) {
      options.log(JSON.stringify({ halt: "runner_stopped", reason: "state_unrecordable" }));
      return { passes, halted_global: false, stopped: true };
    }
    nonProgress = isNonProgress(pass) ? nonProgress + 1 : 0;
    if (nonProgress >= pass.halt_limit) {
      writeHalt(ports.fs, globalHaltPath(ports.root), "no_progress", isoAt(ports.now_ms()));
      options.log(JSON.stringify({ halt: "global", reason: "no_progress", passes_without_progress: nonProgress }));
      return { passes, halted_global: true };
    }
    await ports.sleep(options.poll_ms);
  }
  return { passes, halted_global: false };
}
