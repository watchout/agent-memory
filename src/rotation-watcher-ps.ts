/**
 * Process table view for the rotation watcher (watcher-design.md 2.4 items 3 and 5).
 * One `ps` call is parsed into a table; every question about hosts, ancestors
 * and import helpers is answered from that table. `ps` is run with an
 * argument array and no shell. An unreadable table is `null`, never "no
 * process found" (standard S5).
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { normalizeStartedAt, PS_ENV } from "./session-rotation-files.js";
import { ROTATION_WATCHER_ANCESTOR_DEPTH } from "./constants.js";

export interface ProcessRow {
  pid: number;
  ppid: number;
  /** `ps -o lstart=` with runs of spaces folded to one, the same form the hooks wrote. */
  started_at: string;
  command: string;
}

export type ProcessTable = ReadonlyMap<number, ProcessRow>;

/** Runs `ps` for the whole table. Returns null when it cannot be read. */
export type PsTableRun = () => string | null;

export const psTableExec: PsTableRun = () => {
  try {
    return execFileSync("ps", ["-A", "-o", "pid=,ppid=,lstart=,comm="], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, ...PS_ENV },
    });
  } catch {
    return null;
  }
};

// pid ppid, then lstart as five words (weekday month day time year), then the command.
const ROW = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+?)\s*$/;

export function parseProcessTable(text: string | null): ProcessTable | null {
  if (text === null) return null;
  const table = new Map<number, ProcessRow>();
  for (const row of text.split("\n")) {
    const match = ROW.exec(row);
    if (!match) continue;
    table.set(Number(match[1]), {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      // The row pattern guarantees five non-empty words, so the normalised text is never null.
      started_at: normalizeStartedAt(match[3]) as string,
      command: basename(match[4]),
    });
  }
  return table.size === 0 ? null : table;
}

/** `pid` is `ancestor` itself or sits below it, walking parents at most `depth` steps. */
export function isSameOrDescendant(
  table: ProcessTable,
  ancestor: number,
  pid: number,
  depth: number = ROTATION_WATCHER_ANCESTOR_DEPTH,
): boolean {
  let current = pid;
  for (let step = 0; step <= depth; step++) {
    if (current === ancestor) return true;
    const row = table.get(current);
    if (!row || row.ppid === current || row.ppid <= 0) return false;
    current = row.ppid;
  }
  return false;
}

/** Processes below `pid` (not `pid` itself) whose command name is one of `names`. */
export function descendantsNamed(table: ProcessTable, pid: number, names: readonly string[]): ProcessRow[] {
  if (names.length === 0) return [];
  const found: ProcessRow[] = [];
  for (const row of table.values()) {
    if (row.pid !== pid && names.includes(row.command) && isSameOrDescendant(table, pid, row.pid)) found.push(row);
  }
  return found;
}

export interface HostCheck {
  alive: boolean;
  started_at_matches: boolean;
  command_matches: boolean;
  in_pane: boolean;
}

/**
 * Whether the process the hooks recorded is still the same one: alive, same
 * start time, the expected command, and inside the pane's process tree.
 */
export function checkHost(
  table: ProcessTable,
  hostPid: number,
  recordedStartedAt: string[],
  expectedCommand: string,
  panePid: number,
): HostCheck {
  const row = table.get(hostPid);
  if (!row) return { alive: false, started_at_matches: false, command_matches: false, in_pane: false };
  return {
    alive: true,
    started_at_matches: recordedStartedAt.every((value) => value === row.started_at),
    command_matches: row.command === expectedCommand,
    in_pane: isSameOrDescendant(table, panePid, hostPid),
  };
}
