/**
 * What the watcher concludes from the visible screen and the tmux clients
 * (watcher-design.md 2.5). Pure functions: the screen text, cursor and clock
 * come in as arguments (standard S4). The screen text is judged in memory and
 * never stored; only digests and booleans leave this module (design 6).
 * "Could not find / could not read" is never turned into "empty" or "quiet"
 * (standard S5): those cases return found=false / observed=false.
 */
import { sha256Hex } from "./session-rotation-files.js";

export interface ScreenSnapshot {
  /** `capture-pane -p` of the visible area only. */
  text: string;
  /** `#{cursor_x}` / `#{cursor_y}`: column and row counted from the top-left of the visible area. */
  cursor_x: number;
  cursor_y: number;
}

export interface InputProof {
  /** An input row was found in the lower part of the screen. */
  found: boolean;
  /** The input row holds nothing, or only a configured placeholder. */
  empty: boolean;
  cursor_at_input_head: boolean;
  row: number | null;
  column: number | null;
  /** Digest of the input row; the row itself is not kept. */
  row_sha256: string | null;
  reason: string;
}

/** Box-drawing characters and spaces: the frame around an input box. */
const FRAME = /[─-╿ \t]/u;

function codePoints(text: string): string[] {
  return Array.from(text);
}

function isFrameOnly(line: string): boolean {
  return codePoints(line).every((character) => FRAME.test(character));
}

function stripFrame(characters: string[], fromStart: boolean): string[] {
  const copy = [...characters];
  if (fromStart) {
    while (copy.length > 0 && FRAME.test(copy[0])) copy.shift();
  } else {
    while (copy.length > 0 && FRAME.test(copy[copy.length - 1])) copy.pop();
  }
  return copy;
}

function visibleRows(text: string): string[] {
  const rows = text.split("\n");
  if (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  return rows;
}

const NOT_FOUND = (reason: string): InputProof => ({
  found: false,
  empty: false,
  cursor_at_input_head: false,
  row: null,
  column: null,
  row_sha256: null,
  reason,
});

/**
 * Finds the last row that starts with a prompt marker (after frame characters
 * and spaces), and decides whether it is empty and whether the cursor sits at
 * its head. A screen without such a row (a permission or question screen)
 * is "not found": the watcher does not act on it.
 */
export function proveInputRow(
  screen: ScreenSnapshot,
  promptMarkers: string[],
  placeholderPatterns: string[],
): InputProof {
  const rows = visibleRows(screen.text);
  let inputRow = -1;
  let markerLength = 0;
  let leading = 0;
  for (let index = rows.length - 1; index >= 0; index--) {
    const characters = codePoints(rows[index]);
    const body = stripFrame(characters, true);
    const skipped = characters.length - body.length;
    const marker = promptMarkers.find((candidate) => body.join("").startsWith(candidate));
    if (marker !== undefined) {
      inputRow = index;
      markerLength = codePoints(marker).length;
      leading = skipped;
      break;
    }
  }
  if (inputRow < 0) return NOT_FOUND("input_row_not_found");

  const characters = codePoints(rows[inputRow]);
  const afterMarker = characters.slice(leading + markerLength);
  // One space after the marker belongs to the prompt; the cursor sits right after it.
  const headOffset = afterMarker[0] === " " ? 1 : 0;
  const column = leading + markerLength + headOffset;
  const content = stripFrame(stripFrame(afterMarker, true), false).join("");

  for (let index = inputRow + 1; index < rows.length; index++) {
    if (isFrameOnly(rows[index])) {
      if (rows[index].trim() !== "") break;
      continue;
    }
    return { ...NOT_FOUND("text_below_input_row"), found: true, row: inputRow, column };
  }

  const empty = content === "" || placeholderPatterns.includes(content);
  const cursorAtHead = screen.cursor_y === inputRow && screen.cursor_x === column;
  return {
    found: true,
    empty,
    cursor_at_input_head: cursorAtHead,
    row: inputRow,
    column,
    row_sha256: sha256Hex(rows[inputRow]),
    reason: !empty ? "input_row_not_empty" : cursorAtHead ? "input_empty" : "cursor_not_at_input_head",
  };
}

export interface HumanProof {
  observed: boolean;
  quiet: boolean;
  /** Latest client activity in seconds, or null when no client is attached. */
  latest_activity: number | null;
  reason: string;
}

/**
 * `activities` are the `#{client_activity}` values (seconds) of every client on the
 * seat's session. `null` means the list could not be read. No client at all
 * satisfies the condition (design 2.5, point 3).
 */
export function proveHumanQuiet(
  activities: number[] | null,
  nowSeconds: number,
  quietSeconds: number,
): HumanProof {
  if (activities === null) return { observed: false, quiet: false, latest_activity: null, reason: "clients_unreadable" };
  if (activities.length === 0) return { observed: true, quiet: true, latest_activity: null, reason: "no_client_attached" };
  const latest = Math.max(...activities);
  const quiet = latest <= nowSeconds - quietSeconds;
  return { observed: true, quiet, latest_activity: latest, reason: quiet ? "clients_quiet" : "client_recently_active" };
}

export interface ScreenStability {
  digest: string;
  stable_since: number;
}

/** Folds one screen digest into the per-seat memory; the screen counts as steady while the digest holds. */
export function updateStability(
  previous: ScreenStability | undefined,
  digest: string,
  nowSeconds: number,
): ScreenStability {
  return previous && previous.digest === digest ? previous : { digest, stable_since: nowSeconds };
}

export function isSteady(stability: ScreenStability | undefined, nowSeconds: number, quietSeconds: number): boolean {
  return stability !== undefined && nowSeconds - stability.stable_since >= quietSeconds;
}
