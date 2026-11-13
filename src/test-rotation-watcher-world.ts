/**
 * Test double for the rotation watcher: a small model of one tmux pane, its
 * processes, the visible screen, clients and a clock. The fake tmux records
 * every argument array it receives, understands only the closed command set,
 * evaluates the `if-shell -F` condition the way tmux does for the subset used
 * (`#{==:a,b}`, `#{&&:a,b}`, `#{name}`), and counts respawns. Real tmux is
 * never used here. State files (marker, turn, claim, ledger) are real files in
 * a temporary folder so exclusive creation and durability code run for real.
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMarker,
  seatDirectory,
  writeMarker,
  writeOutputWritten,
  writeTurn,
  type RotationMarker,
  type RotationTurn,
} from "./session-rotation-files.js";
import { nodeWatcherFs, type WatcherFs } from "./rotation-watcher-store.js";
import type { WatcherPorts } from "./rotation-watcher-observe.js";
import { parseWatcherConfig, type WatcherSeat } from "./rotation-watcher-config.js";
import type { TmuxResult } from "./rotation-watcher-tmux.js";

export const NOW0 = Date.parse("2026-11-11T02:00:00.000Z");
export const LAUNCH_COMMAND = '"sh /seats/kusabi-launch.sh"';
export const LAUNCH_SHA = "a".repeat(64);
export const DECISION = {
  url: "https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6785869798",
  sha256: "f65ca4e11c9f71b3b31d34bdb17c3736f1add64705b9fc827ccb5dcff1f1dd3e",
};
export const EMPTY_SCREEN = ["previous output", "╭────────────────────────────╮", "│ >                          │", "╰────────────────────────────╯", "  ? for shortcuts"];
export const SEAT_JSON = {
  agent_id: "kusabi",
  project: "agent-memory",
  host: "claude_code",
  tmux_target: "seat:0.0",
  expected_command: "claude",
  launch_command: LAUNCH_COMMAND,
  launch_script: { path: "/seats/kusabi-launch.sh", sha256: LAUNCH_SHA },
  owner_decision_ref: DECISION,
  prompt_markers: [">"],
  placeholder_patterns: ["Try fix lint errors"],
  drain_commands: ["transcript-stop"],
};

export function seatFrom(overrides: Record<string, unknown> = {}): WatcherSeat {
  const parsed = parseWatcherConfig(JSON.stringify({ schema_version: "kusabi-rotation-watcher-config/v1", seats: [{ ...SEAT_JSON, ...overrides }] }));
  if (!parsed.ok || parsed.value.config.seats.length !== 1) throw new Error("test seat invalid");
  return parsed.value.config.seats[0];
}

const SOCKET = "/tmp/tmux-501/default";
const started = (n: number) => `Tue Nov 3 10:0${n}:00 2026`;

function splitTop(text: string): [string, string] {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.startsWith("#{", index)) depth++;
    else if (text[index] === "}") depth--;
    else if (text[index] === "," && depth === 0) return [text.slice(0, index), text.slice(index + 1)];
  }
  return [text, ""];
}

function expand(template: string, vars: Record<string, string>): string {
  let out = "";
  let index = 0;
  while (index < template.length) {
    if (!template.startsWith("#{", index)) {
      out += template[index];
      index += 1;
      continue;
    }
    let depth = 1;
    let end = index + 2;
    while (end < template.length && depth > 0) {
      if (template.startsWith("#{", end)) { depth++; end += 2; continue; }
      if (template[end] === "}") depth--;
      end++;
    }
    const body = template.slice(index + 2, end - 1);
    const truthy = (value: string) => value !== "" && value !== "0";
    if (body.startsWith("==:")) {
      const [a, b] = splitTop(body.slice(3));
      out += expand(a, vars) === expand(b, vars) ? "1" : "0";
    } else if (body.startsWith("&&:")) {
      const [a, b] = splitTop(body.slice(3));
      out += truthy(expand(a, vars)) && truthy(expand(b, vars)) ? "1" : "0";
    } else {
      out += vars[body] ?? "";
    }
    index = end;
  }
  return out;
}

export type RespawnMode =
  | "ok"
  | "delayed"
  | "no_start"
  | "wrong_marker"
  | "same_session"
  | "same_host_pid"
  | "source_clear"
  | "old_turn"
  | "pid_unchanged"
  | "call_fails_nothing_happens"
  | "call_fails_but_happened";

export class World {
  now = NOW0;
  tmp = mkdtempSync(join(tmpdir(), "rotation-watcher-"));
  root = join(this.tmp, "rotation");
  fsPort: WatcherFs = nodeWatcherFs;
  calls: string[][] = [];
  violations: string[] = [];
  respawns = 0;
  mode: RespawnMode = "ok";
  /** Which hook the new conversation runs: the new one leaves an output-written record, the old one marks the turn (kept while both exist). */
  hook: "record" | "legacy" = "record";
  delayMs = 10_000;
  tmuxDown = false;
  clientsReadable = true;
  clients: number[] = [];
  screen: string[] = [...EMPTY_SCREEN];
  cursor = { x: 4, y: 2 };
  pane = { id: "%7", pid: 5000, dead: false, inMode: false, attached: 0, session: "$3", start: LAUNCH_COMMAND };
  socket = SOCKET;
  hostPid = 5001;
  hostStartedAt = started(1);
  hostCommand = "claude";
  extra: Array<{ pid: number; ppid: number; command: string }> = [];
  psReadable = true;
  scriptHash: string | null = LAUNCH_SHA;
  alive = new Set<number>([process.pid]);
  scheduled: Array<{ at: number; run: () => void }> = [];
  attemptCounter = 0;
  sessionId = "old-session";
  nextHost = 6001;
  marker!: RotationMarker;
  watcherPid = process.pid;

  constructor() {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    chmodSync(this.root, 0o700);
    this.seatDir = seatDirectory(this.root, "kusabi", "agent-memory");
    this.writeMarkerAndTurn();
  }

  seatDir: string;

  iso(offsetMs = 0): string {
    return new Date(this.now + offsetMs).toISOString();
  }

  writeMarkerAndTurn(over: { marker?: Partial<RotationMarker>; turn?: Partial<RotationTurn> } = {}): void {
    this.marker = buildMarker({
      agent_id: "kusabi",
      project: "agent-memory",
      host: "claude_code",
      session_id: this.sessionId,
      pack_ref: "pack-1",
      pack_content_sha256: "b".repeat(64),
      measured_tokens: 310_000,
      threshold_tokens: 300_000,
      saved_at: this.iso(-300_000),
      handoff_source: "seat_text",
      pane_id: this.pane.id,
      tmux_socket: this.socket,
      host_pid: this.hostPid,
      host_started_at: this.hostStartedAt,
      ...over.marker,
    });
    writeMarker(this.seatDir, this.marker);
    this.writeTurn(over.turn ?? {});
  }

  writeTurn(over: Partial<RotationTurn> = {}): void {
    writeTurn(this.seatDir, {
      agent_id: "kusabi",
      project: "agent-memory",
      host: "claude_code",
      session_id: this.sessionId,
      state: "idle",
      source: null,
      rotation_marker_id: null,
      at: this.iso(-120_000),
      pane_id: this.pane.id,
      tmux_socket: this.socket,
      host_pid: this.hostPid,
      host_started_at: this.hostStartedAt,
      ...over,
    });
  }

  /** tmux targets the model answers for; every one of them is the same modelled pane. */
  targets = new Set<string>(["seat:0.0"]);

  /**
   * A second seat in the same folder, for the passes that serve several seats. It has a marker and a turn
   * of its own and answers on its own tmux target (the same modelled pane), so that a tmux command
   * aimed at it shows that the seat was served.
   */
  addSeat(agentId: string): { seatDir: string; target: string } {
    const seatDir = seatDirectory(this.root, agentId, "agent-memory");
    const marker = buildMarker({
      agent_id: agentId,
      project: "agent-memory",
      host: "claude_code",
      session_id: this.sessionId,
      pack_ref: `pack-${agentId}`,
      pack_content_sha256: "b".repeat(64),
      measured_tokens: 310_000,
      threshold_tokens: 300_000,
      saved_at: this.iso(-300_000),
      handoff_source: "seat_text",
      pane_id: this.pane.id,
      tmux_socket: this.socket,
      host_pid: this.hostPid,
      host_started_at: this.hostStartedAt,
    });
    writeMarker(seatDir, marker);
    writeTurn(seatDir, {
      agent_id: agentId,
      project: "agent-memory",
      host: "claude_code",
      session_id: this.sessionId,
      state: "idle",
      source: null,
      rotation_marker_id: null,
      at: this.iso(-120_000),
      pane_id: this.pane.id,
      tmux_socket: this.socket,
      host_pid: this.hostPid,
      host_started_at: this.hostStartedAt,
    });
    const target = `${agentId}:0.0`;
    this.targets.add(target);
    return { seatDir, target };
  }

  writeConfig(seats: unknown[] = [SEAT_JSON], extra: Record<string, unknown> = {}): void {
    const path = join(this.root, "watcher-config.json");
    writeFileSync(path, JSON.stringify({ schema_version: "kusabi-rotation-watcher-config/v1", seats, ...extra }), { mode: 0o600 });
    chmodSync(path, 0o600);
  }

  vars(): Record<string, string> {
    return {
      pane_id: this.pane.id,
      pane_pid: String(this.pane.pid),
      pane_dead: this.pane.dead ? "1" : "0",
      pane_in_mode: this.pane.inMode ? "1" : "0",
      cursor_x: String(this.cursor.x),
      cursor_y: String(this.cursor.y),
      session_attached: String(this.pane.attached),
      socket_path: this.socket,
      session_id: this.pane.session,
      pane_start_command: this.pane.start,
      version: "3.6a",
    };
  }

  /** What the respawn does in the model; the modes let a test break one part of the confirmation. */
  respawn(): void {
    this.respawns += 1;
    if (this.mode === "call_fails_nothing_happens") return;
    const oldHost = this.hostPid;
    const oldSession = this.sessionId;
    if (this.mode !== "pid_unchanged") {
      this.pane.pid += 1_000;
      this.extra = [];
    }
    this.hostPid = this.mode === "same_host_pid" ? oldHost : this.nextHost++;
    this.hostStartedAt = started(5);
    const write = () => {
      const fields = {
        session_id: this.mode === "same_session" ? oldSession : "new-session",
        source: this.mode === "source_clear" ? "clear" : "startup",
        at: this.mode === "old_turn" ? this.iso(-60_000) : this.iso(),
        host_pid: this.hostPid,
        host_started_at: this.hostStartedAt,
      };
      const wrongMarker = this.mode === "wrong_marker" ? "c".repeat(64) : this.marker.marker_id;
      this.writeTurn({ ...fields, state: "started", rotation_marker_id: this.hook === "legacy" ? wrongMarker : null });
      if (this.hook === "record") {
        writeOutputWritten(this.seatDir, {
          marker_id: wrongMarker,
          agent_id: "kusabi",
          project: "agent-memory",
          host: "claude_code",
          session_id: fields.session_id,
          source: fields.source,
          pane_id: this.pane.id,
          tmux_socket: this.socket,
          host_pid: fields.host_pid,
          host_started_at: fields.host_started_at,
          turn_at: fields.at,
          output_written_at: this.iso(),
        });
      }
    };
    if (this.mode === "no_start") return;
    if (this.mode === "delayed") this.scheduled.push({ at: this.now + this.delayMs, run: write });
    else write();
  }

  /** Lets a test change the world at the moment tmux receives a command (the windows R-A and R-C). */
  beforeTmux: ((argv: readonly string[]) => void) | null = null;

  tmux = (argv: readonly string[]): TmuxResult => {
    this.calls.push([...argv]);
    this.beforeTmux?.(argv);
    if (this.tmuxDown) return { ok: false, stdout: "" };
    const [command] = argv;
    const target = argv[argv.indexOf("-t") + 1];
    if (command === "display-message" && argv.includes("-t") && this.targets.has(target)) return { ok: true, stdout: `${this.pane.id}\n` };
    if (command === "display-message") {
      const format = argv[argv.length - 1];
      return { ok: true, stdout: `${expand(format, this.vars())}\n` };
    }
    if (command === "list-clients") {
      return this.clientsReadable ? { ok: true, stdout: this.clients.map((value) => `${value}\n`).join("") } : { ok: false, stdout: "" };
    }
    if (command === "capture-pane") return { ok: true, stdout: `${this.screen.join("\n")}\n` };
    if (command === "if-shell" && argv[1] === "-F") {
      const truthy = expand(argv[4], this.vars());
      const branch = truthy !== "" && truthy !== "0" ? argv[5] : argv[6];
      if (branch === `respawn-pane -k -t ${this.pane.id}`) {
        this.respawn();
        return this.mode === "call_fails_nothing_happens" || this.mode === "call_fails_but_happened"
          ? { ok: false, stdout: "" }
          : { ok: true, stdout: "" };
      }
      if (branch === "display-message -p NOT_RESPAWNED") return { ok: true, stdout: "NOT_RESPAWNED\n" };
    }
    this.violations.push(argv.join(" "));
    return { ok: false, stdout: "" };
  };

  psText(): string | null {
    if (!this.psReadable) return null;
    const rows = [
      `1 0 ${started(0)} /sbin/launchd`,
      `${this.pane.pid} 1 ${started(2)} /bin/sh`,
      `${this.hostPid} ${this.pane.pid} ${this.hostStartedAt} /usr/local/bin/${this.hostCommand}`,
      ...this.extra.map((row) => `${row.pid} ${row.ppid} ${started(3)} /usr/bin/${row.command}`),
    ];
    return `${rows.join("\n")}\n`;
  }

  get ports(): WatcherPorts {
    return {
      tmux: this.tmux,
      ps: () => this.psText(),
      fs: this.fsPort,
      root: this.root,
      uid: process.getuid ? process.getuid() : 0,
      now_ms: () => this.now,
      sleep: async (ms) => {
        this.now += ms;
        const due = this.scheduled.filter((entry) => entry.at <= this.now);
        this.scheduled = this.scheduled.filter((entry) => entry.at > this.now);
        due.forEach((entry) => entry.run());
      },
      hash_file: () => this.scriptHash,
      pid_alive: (pid) => this.alive.has(pid),
      watcher_pid: this.watcherPid,
      new_attempt_id: () => `attempt-${++this.attemptCounter}`,
    };
  }

  /** Sleeps through the quiet period so the screen counts as steady. */
  async settle(seconds = 25): Promise<void> {
    await this.ports.sleep(seconds * 1_000);
  }

  respawnCalls(): string[][] {
    return this.calls.filter((call) => call[0] === "if-shell");
  }
}
