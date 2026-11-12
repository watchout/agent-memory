/**
 * The start-up clean-up of the JSON store's task states, as one pure function (standard S3: the rule is in one place).
 * It mirrors the SQL migration of the other stores: a row with no task id takes its task name, a row with no update
 * time takes its creation time, and the rows collapse to one per (agent, task) - the one with the latest creation time,
 * and the first of equal times. A kept row stays where its key first appeared, which is the order the store's reads use
 * to break a tie.
 *
 * The JSON store calls it when it opens (and writes the result back when `changed`). The hand-off reader calls it on
 * the same file and writes nothing, so the two give the same row for the same records.
 * It reads no clock and no file, and it does not change its input.
 */
export interface TaskStateKeyFields {
  agent_id: string;
  task: string;
  task_id?: string;
  created_at: string;
  updated_at?: string;
}

export interface NormalizedTaskStates<T extends TaskStateKeyFields> {
  rows: T[];
  changed: boolean;
}

export function normalizeTaskStates<T extends TaskStateKeyFields>(rows: readonly T[]): NormalizedTaskStates<T> {
  let changed = false;
  const filled = rows.map((row) => {
    if (row.task_id && row.updated_at) return row;
    changed = true;
    return { ...row, task_id: row.task_id || row.task, updated_at: row.updated_at || row.created_at };
  });
  const latestPerKey = new Map<string, T>();
  for (const row of filled) {
    const key = `${row.agent_id}::${row.task_id}`;
    const previous = latestPerKey.get(key);
    if (!previous || new Date(row.created_at).getTime() > new Date(previous.created_at).getTime()) {
      latestPerKey.set(key, row);
    }
  }
  if (latestPerKey.size !== filled.length) return { rows: Array.from(latestPerKey.values()), changed: true };
  return { rows: filled, changed };
}
