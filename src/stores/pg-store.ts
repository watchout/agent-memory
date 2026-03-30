import pg from "pg";
import { v4 as uuidv4 } from "uuid";
import type {
  Store,
  Decision,
  TaskState,
  LogDecisionInput,
  GetDecisionsInput,
  SupersedeDecisionInput,
  SaveTaskStateInput,
  GetTaskStatesInput,
} from "./types.js";

const { Pool } = pg;

const MIGRATIONS = [
  // decisions table
  `CREATE TABLE IF NOT EXISTS decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    project TEXT,
    decision TEXT NOT NULL,
    context TEXT,
    tags TEXT[] DEFAULT '{}',
    status TEXT DEFAULT 'active',
    superseded_by UUID REFERENCES decisions(id),
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_agent
    ON decisions(agent_id, status, created_at DESC)`,

  // task_states table
  `CREATE TABLE IF NOT EXISTS task_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    project TEXT,
    task TEXT NOT NULL,
    status TEXT NOT NULL,
    progress TEXT,
    files_modified TEXT[] DEFAULT '{}',
    next_steps TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_states_agent
    ON task_states(agent_id, created_at DESC)`,
];

export class PgStore implements Store {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      for (const sql of MIGRATIONS) {
        await client.query(sql);
      }
    } finally {
      client.release();
    }
  }

  async logDecision(input: LogDecisionInput): Promise<Decision> {
    const id = uuidv4();
    const result = await this.pool.query(
      `INSERT INTO decisions (id, agent_id, project, decision, context, tags)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        id,
        input.agent_id,
        input.project || null,
        input.decision,
        input.context || null,
        input.tags || [],
      ]
    );
    return this.rowToDecision(result.rows[0]);
  }

  async getDecisions(input: GetDecisionsInput): Promise<Decision[]> {
    const conditions: string[] = ["agent_id = $1"];
    const params: unknown[] = [input.agent_id];
    let paramIndex = 2;

    if (input.project) {
      conditions.push(`project = $${paramIndex++}`);
      params.push(input.project);
    }

    if (input.status && input.status !== "all") {
      conditions.push(`status = $${paramIndex++}`);
      params.push(input.status);
    } else if (!input.status) {
      conditions.push(`status = 'active'`);
    }

    if (input.tags && input.tags.length > 0) {
      conditions.push(`tags && $${paramIndex++}`);
      params.push(input.tags);
    }

    const limit = input.limit || 10;
    conditions.push(`TRUE`); // ensure WHERE clause always valid

    const sql = `SELECT * FROM decisions
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY created_at DESC
                 LIMIT ${limit}`;

    const result = await this.pool.query(sql, params);
    return result.rows.map(this.rowToDecision);
  }

  async supersedeDecision(
    input: SupersedeDecisionInput
  ): Promise<{ old: Decision; new: Decision }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Verify old decision exists and belongs to agent
      const oldResult = await client.query(
        "SELECT * FROM decisions WHERE id = $1 AND agent_id = $2",
        [input.old_decision_id, input.agent_id]
      );
      if (oldResult.rows.length === 0) {
        throw new Error(`Decision not found: ${input.old_decision_id}`);
      }

      const newId = uuidv4();

      // Insert new decision
      const newResult = await client.query(
        `INSERT INTO decisions (id, agent_id, project, decision, context, tags)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          newId,
          input.agent_id,
          input.project || oldResult.rows[0].project,
          input.new_decision,
          input.context || null,
          input.tags || oldResult.rows[0].tags,
        ]
      );

      // Mark old as superseded
      const updatedOld = await client.query(
        `UPDATE decisions SET status = 'superseded', superseded_by = $1
         WHERE id = $2 RETURNING *`,
        [newId, input.old_decision_id]
      );

      await client.query("COMMIT");

      return {
        old: this.rowToDecision(updatedOld.rows[0]),
        new: this.rowToDecision(newResult.rows[0]),
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async saveTaskState(input: SaveTaskStateInput): Promise<TaskState> {
    const id = uuidv4();
    const result = await this.pool.query(
      `INSERT INTO task_states (id, agent_id, project, task, status, progress, files_modified, next_steps)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        id,
        input.agent_id,
        input.project || null,
        input.task,
        input.status,
        input.progress || null,
        input.files_modified || [],
        input.next_steps || null,
      ]
    );
    return this.rowToTaskState(result.rows[0]);
  }

  async getTaskStates(input: GetTaskStatesInput): Promise<TaskState[]> {
    const conditions: string[] = ["agent_id = $1"];
    const params: unknown[] = [input.agent_id];
    let paramIndex = 2;

    if (input.project) {
      conditions.push(`project = $${paramIndex++}`);
      params.push(input.project);
    }
    if (input.status && input.status !== "all") {
      conditions.push(`status = $${paramIndex++}`);
      params.push(input.status);
    }

    const limit = input.limit || 5;

    const sql = `SELECT * FROM task_states
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY created_at DESC
                 LIMIT ${limit}`;

    const result = await this.pool.query(sql, params);
    return result.rows.map(this.rowToTaskState);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private rowToDecision(row: Record<string, unknown>): Decision {
    return {
      id: row.id as string,
      agent_id: row.agent_id as string,
      project: row.project as string | undefined,
      decision: row.decision as string,
      context: row.context as string | undefined,
      tags: (row.tags as string[]) || [],
      status: row.status as Decision["status"],
      superseded_by: row.superseded_by as string | undefined,
      created_at:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : (row.created_at as string),
    };
  }

  private rowToTaskState(row: Record<string, unknown>): TaskState {
    return {
      id: row.id as string,
      agent_id: row.agent_id as string,
      project: row.project as string | undefined,
      task: row.task as string,
      status: row.status as TaskState["status"],
      progress: row.progress as string | undefined,
      files_modified: (row.files_modified as string[]) || [],
      next_steps: row.next_steps as string | undefined,
      created_at:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : (row.created_at as string),
    };
  }
}
