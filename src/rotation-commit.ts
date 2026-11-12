/**
 * The commit of a session-rotation start (261110-session-rotation, FR11): after the SessionStart answer has been
 * written to stdout, the output-written record is made (claim route) and only then is the one-time bundle consumed.
 * The consume cannot be undone, so it is the last step and runs only when the fact it must not outrun is on disk.
 *
 * Time is passed in (S4): the caller gives `now`, the elapsed milliseconds and the hook's time limit. Nothing here
 * throws; the result says what happened, for tests, and is not printed (the evidence contract is unchanged).
 */
import {
  ROTATION_COMMIT_BUDGET_MS,
  ROTATION_COMMIT_EXIT_MARGIN_MS,
  ROTATION_COMMIT_WRITE_RESERVE_MS,
} from "./constants.js";
import { writeOutputWritten, type RotationOutputWritten } from "./session-rotation-files.js";
import type { RotationCommitPlan } from "./session-rotation-start.js";
import { createStore } from "./stores/index.js";
import type { Store } from "./stores/types.js";

export type { RotationCommitPlan } from "./session-rotation-start.js";

export type RecordResult = "written" | "exists" | "failed" | "skipped";
export type ConsumeResult = "consumed" | "lost_race" | "unknown" | "skipped";
export interface RotationCommitResult {
  record: RecordResult;
  consume: ConsumeResult;
}

export type RecordWriter = (directory: string, record: Omit<RotationOutputWritten, "schema_version">) => "written" | "exists";

/** The two things a test can replace; the real hooks use the defaults. */
export interface CommitSeams {
  open_store?: () => Promise<Store>;
  write_record?: RecordWriter;
}

export interface RotationCommitDependencies extends CommitSeams {
  now: () => Date;
  /** Milliseconds since the hook process began, from the caller's monotonic clock. */
  elapsed_ms: () => number;
  hook_timeout_ms: number;
}

const openDefaultStore = (): Promise<Store> => createStore({ skipPostgresMigrations: true });

/** A close is never awaited (it may not return) and its failure is of no interest. */
function closeQuietly(store: Store): void {
  void Promise.resolve()
    .then(() => store.close())
    .catch(() => undefined);
}

async function consumeWithin(plan: RotationCommitPlan, dependencies: RotationCommitDependencies, budgetMs: number): Promise<ConsumeResult> {
  let abandoned = false;
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<ConsumeResult>((resolve) => {
    timer = setTimeout(() => {
      abandoned = true;
      resolve("unknown");
    }, budgetMs);
  });
  const attempt = (async (): Promise<ConsumeResult> => {
    const store = await (dependencies.open_store ?? openDefaultStore)();
    if (abandoned) {
      closeQuietly(store);
      return "unknown";
    }
    try {
      const row = await store.consumeSelectedRestartPack({ ...plan.query, consumed_at: dependencies.now().toISOString() });
      return row === null ? "lost_race" : "consumed";
    } catch {
      return "unknown";
    } finally {
      closeQuietly(store);
    }
  })().catch((): ConsumeResult => "unknown");
  try {
    return await Promise.race([attempt, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

function recordFrom(plan: RotationCommitPlan, at: string): Omit<RotationOutputWritten, "schema_version"> | null {
  const turn = plan.turn;
  if (turn === null) return null;
  return {
    marker_id: plan.marker_id,
    agent_id: turn.agent_id,
    project: turn.project,
    host: turn.host,
    session_id: turn.session_id,
    source: turn.source,
    pane_id: turn.pane_id,
    tmux_socket: turn.tmux_socket,
    host_pid: turn.host_pid,
    host_started_at: turn.host_started_at,
    turn_at: turn.at,
    output_written_at: at,
  };
}

/**
 * Steps: (0) do nothing when too little time is left; (1) claim route: make the record, and stop if it is not on disk;
 * (2) consume once, within a budget, never retried; a late store or a late answer writes nothing.
 */
export async function commitRotationRecovery(plan: RotationCommitPlan, dependencies: RotationCommitDependencies): Promise<RotationCommitResult> {
  try {
    const commitBy = dependencies.hook_timeout_ms - ROTATION_COMMIT_EXIT_MARGIN_MS;
    if (commitBy - dependencies.elapsed_ms() < ROTATION_COMMIT_WRITE_RESERVE_MS) return { record: "skipped", consume: "skipped" };
    let record: RecordResult = "skipped";
    if (plan.via === "claim") {
      const fields = recordFrom(plan, dependencies.now().toISOString());
      if (fields !== null) {
        try {
          record = (dependencies.write_record ?? writeOutputWritten)(plan.directory, fields);
        } catch {
          record = "failed";
        }
      }
      if (record !== "written" && record !== "exists") return { record, consume: "skipped" };
    }
    const budget = Math.min(ROTATION_COMMIT_BUDGET_MS, commitBy - dependencies.elapsed_ms());
    if (budget <= 0) return { record, consume: "skipped" };
    return { record, consume: await consumeWithin(plan, dependencies, budget) };
  } catch {
    return { record: "failed", consume: "skipped" };
  }
}

/** Writes one line to a stream; the callback gets the first error (from the write or from an 'error' event), once. */
export function writeLine(stream: NodeJS.WritableStream, line: string, done: (error?: Error | null) => void): void {
  let finished = false;
  const finish = (error?: Error | null): void => {
    if (finished) return;
    finished = true;
    stream.removeListener("error", finish);
    done(error);
  };
  stream.once("error", finish);
  stream.write(line, finish);
}

export interface HookAnswerIo extends CommitSeams {
  write_evidence: (line: string, done: (error?: Error | null) => void) => void;
  write_output: (line: string, done: (error?: Error | null) => void) => void;
  /** Monotonic milliseconds. */
  clock: () => number;
  now: () => Date;
}

/**
 * Writes the evidence (stderr) and the output (stdout), then commits when the output was written and the answer
 * carries a plan. A failing stderr does not count; a failing stdout means the hand-off text did not go out.
 */
export async function answerHookAndCommit(
  io: HookAnswerIo,
  answer: { evidence: unknown; output: unknown; rotation_commit?: RotationCommitPlan },
  startedAtMs: number,
  hookTimeoutMs: number,
): Promise<{ output_written: boolean; commit: RotationCommitResult | null }> {
  let outputError: Error | null | undefined;
  await new Promise<void>((resolve) => {
    let pending = 2;
    const written = (): void => {
      pending -= 1;
      if (pending === 0) resolve();
    };
    io.write_evidence(`${JSON.stringify(answer.evidence)}\n`, written);
    io.write_output(`${JSON.stringify(answer.output)}\n`, (error) => {
      outputError = error;
      written();
    });
  });
  const outputWritten = !outputError;
  if (!outputWritten || !answer.rotation_commit) return { output_written: outputWritten, commit: null };
  const commit = await commitRotationRecovery(answer.rotation_commit, {
    now: io.now,
    elapsed_ms: () => io.clock() - startedAtMs,
    hook_timeout_ms: hookTimeoutMs,
    ...(io.open_store ? { open_store: io.open_store } : {}),
    ...(io.write_record ? { write_record: io.write_record } : {}),
  });
  return { output_written: true, commit };
}
