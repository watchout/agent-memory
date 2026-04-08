/**
 * AM-023: shared helper for deriving a stable task_id when one is not
 * supplied by the caller.
 *
 * Two callers:
 *   1. post-tool-hook.ts — when a Discord message has no recognisable
 *      ticket id (FEAT-NNN / AM-NNN / PR#NN), the hook uses this to
 *      group successive [TASK:start]/[TASK:done] posts whose `task`
 *      field is identical.
 *   2. pg-store / sqlite-store / json-store saveTaskState() — defensive
 *      fallback so the UNIQUE constraint always has a value to key on
 *      even when an external caller forgets to set task_id.
 *
 * Limitation (documented in AM-023 issue): two posts whose `task` text
 * differs (e.g. "Build the API" vs "Built the API") will hash to
 * different ids and therefore become two rows. Use a ticket id when
 * lifecycle linkage matters.
 */
import { createHash } from "node:crypto";

const HASH_PREFIX_LENGTH = 16;

export function deriveTaskIdFromTask(task: string): string {
  const normalized = task.trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, HASH_PREFIX_LENGTH);
}
