import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { v4 as uuidv4 } from "uuid";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { deriveTaskIdFromTask } from "./task-id.js";
import type {
  Store,
  Decision,
  TaskState,
  Knowledge,
  AgentMessage,
  RecoveryConfig,
  LogDecisionInput,
  GetDecisionsInput,
  SupersedeDecisionInput,
  SaveTaskStateInput,
  GetTaskStatesInput,
  SearchMemoryInput,
  SearchMemoryResult,
  SaveKnowledgeInput,
  GetKnowledgeInput,
  SupersedeKnowledgeInput,
  LogRecoveryQualityInput,
} from "./types.js";

const DEFAULT_DB_PATH = join(homedir(), ".agent-memory", "memory.db");

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    project TEXT,
    decision TEXT NOT NULL,
    context TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    superseded_by TEXT,
    consolidated_at TEXT,
    created_at TEXT NOT NULL,
    embedding TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_agent
    ON decisions(agent_id, status, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS task_states (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    project TEXT,
    task_id TEXT,
    task TEXT NOT NULL,
    status TEXT NOT NULL,
    progress TEXT,
    files_modified TEXT NOT NULL DEFAULT '[]',
    next_steps TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    embedding TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_states_agent
    ON task_states(agent_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS knowledge (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    project TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_ids TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    merged_into TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    embedding TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_agent ON knowledge(agent_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge(project, status)`,

  `CREATE TABLE IF NOT EXISTS recovery_config (
    agent_id TEXT PRIMARY KEY,
    max_tokens INTEGER NOT NULL DEFAULT 1000,
    task_states_limit INTEGER NOT NULL DEFAULT 1,
    decisions_limit INTEGER NOT NULL DEFAULT 0,
    knowledge_limit INTEGER NOT NULL DEFAULT 3,
    messages_limit INTEGER NOT NULL DEFAULT 5,
    discord_history_limit INTEGER NOT NULL DEFAULT 5,
    discord_channels TEXT NOT NULL DEFAULT '[]',
    restart_message_threshold INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS recovery_quality_log (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    session_id TEXT,
    recovered_tokens INTEGER,
    task_continued INTEGER,
    search_memory_count_10min INTEGER NOT NULL DEFAULT 0,
    quality_score REAL,
    notes TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_recovery_quality_agent
    ON recovery_quality_log(agent_id, created_at DESC)`,

];

let SQL_PROMISE: Promise<SqlJsStatic> | null = null;
function loadSqlJs(): Promise<SqlJsStatic> {
  if (!SQL_PROMISE) {
    SQL_PROMISE = initSqlJs();
  }
  return SQL_PROMISE;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

function tokenizeQuery(query: string): string[] {
  const rawTokens = query.split(/\s+/).filter(Boolean);
  const keywords: string[] = [];
  for (const token of rawTokens) {
    const parts = token
      .split(/(?<=[\u3000-\u9fff\uf900-\ufaff])(?=[a-z0-9])|(?<=[a-z0-9])(?=[\u3000-\u9fff\uf900-\ufaff])/i)
      .filter(Boolean);
    keywords.push(...parts);
  }
  return keywords.length > 0 ? keywords : [query];
}

export class SqliteStore implements Store {
  private db!: Database;
  private dbPath: string;
  private fts5Available = false;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? process.env.AGENT_MEMORY_DB_PATH ?? DEFAULT_DB_PATH;
  }

  async initialize(): Promise<void> {
    const SQL = await loadSqlJs();

    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    for (const sql of MIGRATIONS) {
      this.db.run(sql);
    }

    // ─── AM-023: idempotent post-CREATE migration for existing DBs ──
    // The CREATE TABLE above already has task_id/updated_at for fresh
    // installs. For DBs created before AM-023, we ALTER TABLE here.
    // SQLite < 3.35 has no `ADD COLUMN IF NOT EXISTS`, so we wrap each
    // ALTER in try/catch — duplicate column errors are the success
    // case and the only expected failure mode.
    this.alterAddColumnIfMissing("task_states", "task_id", "TEXT");
    this.alterAddColumnIfMissing("task_states", "updated_at", "TEXT");
    // AM-024: knowledge supersede columns
    this.alterAddColumnIfMissing("knowledge", "supersedes", "TEXT");
    this.alterAddColumnIfMissing("knowledge", "supersede_reason", "TEXT");
    // Back-fill: existing rows have task='AM-006' (the ticket id, per
    // pre-AM-023 hook behavior). Copy that into task_id verbatim so
    // the UNIQUE index has something to key on.
    this.db.run(`UPDATE task_states SET task_id = task WHERE task_id IS NULL`);
    this.db.run(`UPDATE task_states SET updated_at = created_at WHERE updated_at IS NULL`);
    // Dedup: keep only the most recently inserted row per
    // (agent_id, task_id). SQLite has no DISTINCT ON, so we use rowid
    // (monotonic with insert order) which is a good proxy here because
    // the legacy rows were append-only and never updated.
    this.db.run(
      `DELETE FROM task_states WHERE rowid NOT IN (
         SELECT MAX(rowid) FROM task_states GROUP BY agent_id, task_id
       )`
    );
    this.db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_task_states_agent_task_id
         ON task_states (agent_id, task_id)`
    );

    // FTS5 detection — sql.js default build does not include FTS5,
    // but we probe so we are forward-compatible with custom builds.
    try {
      this.db.run("CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_probe USING fts5(c)");
      this.db.run("DROP TABLE IF EXISTS _fts5_probe");
      this.fts5Available = true;
    } catch {
      this.fts5Available = false;
    }

    this.persist();
  }

  /** Write the in-memory DB back to disk. Synchronous to keep the MVP simple. */
  private persist(): void {
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  /**
   * AM-023 helper: ALTER TABLE ADD COLUMN with idempotency via
   * try/catch. SQLite ≥ 3.35 supports `IF NOT EXISTS` but the sql.js
   * default build pins an older version, so we have to detect the
   * "duplicate column" error path. Other ALTER errors are re-thrown.
   */
  private alterAddColumnIfMissing(table: string, column: string, type: string): void {
    try {
      this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (!/duplicate column name/i.test(msg)) {
        throw err;
      }
      // Already present — expected idempotent path.
    }
  }

  private allRows(sql: string, params: unknown[] = []): Record<string, unknown>[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params as never);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as Record<string, unknown>);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  // ─── Decisions ────────────────────────────────────────────────

  async logDecision(input: LogDecisionInput): Promise<Decision> {
    const id = uuidv4();
    const created_at = nowIso();
    const tags = JSON.stringify(input.tags || []);
    this.db.run(
      `INSERT INTO decisions (id, agent_id, project, decision, context, tags, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      [id, input.agent_id, input.project ?? null, input.decision, input.context ?? null, tags, created_at]
    );
    this.persist();
    return {
      id,
      agent_id: input.agent_id,
      project: input.project,
      decision: input.decision,
      context: input.context,
      tags: input.tags || [],
      status: "active",
      created_at,
    };
  }

  async getDecisions(input: GetDecisionsInput): Promise<Decision[]> {
    const conditions: string[] = ["agent_id = ?"];
    const params: unknown[] = [input.agent_id];

    if (input.project) {
      conditions.push("project = ?");
      params.push(input.project);
    }

    if (input.status && input.status !== "all") {
      conditions.push("status = ?");
      params.push(input.status);
    } else if (!input.status) {
      conditions.push("status = 'active'");
    }

    const limit = input.limit || 10;
    const sql = `SELECT * FROM decisions
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY created_at DESC
                 LIMIT ${limit}`;
    const rows = this.allRows(sql, params);
    let decisions = rows.map((r) => this.rowToDecision(r));

    if (input.tags && input.tags.length > 0) {
      const wanted = new Set(input.tags);
      decisions = decisions.filter((d) => d.tags.some((t) => wanted.has(t)));
    }

    return decisions;
  }

  async supersedeDecision(
    input: SupersedeDecisionInput
  ): Promise<{ old: Decision; new: Decision }> {
    const oldRows = this.allRows(
      `SELECT * FROM decisions WHERE id = ? AND agent_id = ?`,
      [input.old_decision_id, input.agent_id]
    );
    if (oldRows.length === 0) {
      throw new Error(`Decision not found: ${input.old_decision_id}`);
    }
    const oldDecision = this.rowToDecision(oldRows[0]);

    const newId = uuidv4();
    const created_at = nowIso();
    const newTags = input.tags ?? oldDecision.tags;
    const newProject = input.project ?? oldDecision.project;

    this.db.run("BEGIN");
    try {
      this.db.run(
        `INSERT INTO decisions (id, agent_id, project, decision, context, tags, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
        [
          newId,
          input.agent_id,
          newProject ?? null,
          input.new_decision,
          input.context ?? null,
          JSON.stringify(newTags),
          created_at,
        ]
      );
      this.db.run(
        `UPDATE decisions SET status = 'superseded', superseded_by = ? WHERE id = ?`,
        [newId, input.old_decision_id]
      );
      this.db.run("COMMIT");
    } catch (err) {
      this.db.run("ROLLBACK");
      throw err;
    }
    this.persist();

    const newDecision: Decision = {
      id: newId,
      agent_id: input.agent_id,
      project: newProject,
      decision: input.new_decision,
      context: input.context,
      tags: newTags,
      status: "active",
      created_at,
    };
    const updatedOld: Decision = {
      ...oldDecision,
      status: "superseded",
      superseded_by: newId,
    };
    return { old: updatedOld, new: newDecision };
  }

  // ─── Task States ─────────────────────────────────────────────

  async saveTaskState(input: SaveTaskStateInput): Promise<TaskState> {
    // AM-023: derive a stable task_id when the caller doesn't supply
    // one. See pg-store.ts for the same pattern + rationale.
    const taskId = input.task_id ?? deriveTaskIdFromTask(input.task);
    const now = nowIso();

    // sql.js does not support ON CONFLICT...DO UPDATE on every build,
    // so we explicitly check for an existing row by (agent_id, task_id)
    // and dispatch to UPDATE or INSERT. This keeps the same UPSERT
    // semantics as pg-store while avoiding sqlite version assumptions.
    const existing = this.allRows(
      `SELECT id, created_at FROM task_states WHERE agent_id = ? AND task_id = ?`,
      [input.agent_id, taskId]
    );

    if (existing.length > 0) {
      const existingId = existing[0].id as string;
      const existingCreatedAt = existing[0].created_at as string;
      this.db.run(
        `UPDATE task_states
            SET project = ?, task = ?, status = ?, progress = ?,
                files_modified = ?, next_steps = ?, updated_at = ?
          WHERE id = ?`,
        [
          input.project ?? null,
          input.task,
          input.status,
          input.progress ?? null,
          JSON.stringify(input.files_modified || []),
          input.next_steps ?? null,
          now,
          existingId,
        ]
      );
      this.persist();
      return {
        id: existingId,
        agent_id: input.agent_id,
        project: input.project,
        task_id: taskId,
        task: input.task,
        status: input.status,
        progress: input.progress,
        files_modified: input.files_modified || [],
        next_steps: input.next_steps,
        created_at: existingCreatedAt,
        updated_at: now,
      };
    }

    const id = uuidv4();
    this.db.run(
      `INSERT INTO task_states
        (id, agent_id, project, task_id, task, status, progress,
         files_modified, next_steps, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.agent_id,
        input.project ?? null,
        taskId,
        input.task,
        input.status,
        input.progress ?? null,
        JSON.stringify(input.files_modified || []),
        input.next_steps ?? null,
        now,
        now,
      ]
    );
    this.persist();
    return {
      id,
      agent_id: input.agent_id,
      project: input.project,
      task_id: taskId,
      task: input.task,
      status: input.status,
      progress: input.progress,
      files_modified: input.files_modified || [],
      next_steps: input.next_steps,
      created_at: now,
      updated_at: now,
    };
  }

  async getTaskStates(input: GetTaskStatesInput): Promise<TaskState[]> {
    const conditions: string[] = ["agent_id = ?"];
    const params: unknown[] = [input.agent_id];

    if (input.project) {
      conditions.push("project = ?");
      params.push(input.project);
    }
    if (input.status && input.status !== "all") {
      conditions.push("status = ?");
      params.push(input.status);
    }

    const limit = input.limit || 5;
    const sql = `SELECT * FROM task_states
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY created_at DESC
                 LIMIT ${limit}`;
    const rows = this.allRows(sql, params);
    return rows.map((r) => this.rowToTaskState(r));
  }

  async expireStaleTaskStates(input: { agent_id: string; max_age_days: number }): Promise<number> {
    const cutoff = new Date(Date.now() - input.max_age_days * 24 * 60 * 60 * 1000).toISOString();
    const before = this.allRows(
      `SELECT id FROM task_states
        WHERE agent_id = ? AND status = 'in_progress' AND created_at < ?`,
      [input.agent_id, cutoff]
    );
    if (before.length === 0) return 0;
    this.db.run(
      `UPDATE task_states SET status = 'expired'
        WHERE agent_id = ? AND status = 'in_progress' AND created_at < ?`,
      [input.agent_id, cutoff]
    );
    this.persist();
    return before.length;
  }

  // ─── Knowledge ───────────────────────────────────────────────

  async saveKnowledge(input: SaveKnowledgeInput): Promise<Knowledge> {
    const id = uuidv4();
    const now = nowIso();
    this.db.run(
      `INSERT INTO knowledge
        (id, agent_id, project, title, content, source_type, source_ids, tags, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        id,
        input.agent_id,
        input.project ?? null,
        input.title,
        input.content,
        input.source_type,
        JSON.stringify(input.source_ids || []),
        JSON.stringify(input.tags || []),
        now,
        now,
      ]
    );
    this.persist();
    return {
      id,
      agent_id: input.agent_id,
      project: input.project,
      title: input.title,
      content: input.content,
      source_type: input.source_type,
      source_ids: input.source_ids || [],
      tags: input.tags || [],
      status: "active",
      created_at: now,
      updated_at: now,
    };
  }

  async getKnowledge(input: GetKnowledgeInput): Promise<Knowledge[]> {
    const conditions: string[] = ["agent_id = ?"];
    const params: unknown[] = [input.agent_id];

    if (input.project) {
      conditions.push("project = ?");
      params.push(input.project);
    }
    if (input.status && input.status !== "all") {
      conditions.push("status = ?");
      params.push(input.status);
    } else if (!input.status) {
      conditions.push("status = 'active'");
    }

    const limit = input.limit || 10;
    const sql = `SELECT * FROM knowledge
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY updated_at DESC
                 LIMIT ${limit}`;
    const rows = this.allRows(sql, params);
    let items = rows.map((r) => this.rowToKnowledge(r));

    if (input.tags && input.tags.length > 0) {
      const wanted = new Set(input.tags);
      items = items.filter((k) => k.tags.some((t) => wanted.has(t)));
    }

    return items;
  }

  async updateKnowledgeStatus(input: {
    id: string;
    agent_id: string;
    status: "active" | "merged" | "archived";
    merged_into?: string;
  }): Promise<Knowledge> {
    if (input.merged_into) {
      if (input.id === input.merged_into) {
        throw new Error("Cannot merge a knowledge entry into itself");
      }
      const target = this.allRows(
        `SELECT 1 FROM knowledge WHERE id = ? AND agent_id = ?`,
        [input.merged_into, input.agent_id]
      );
      if (target.length === 0) {
        throw new Error(`Merge target not found: ${input.merged_into}`);
      }
    }

    const effectiveStatus = input.merged_into ? "merged" : input.status;
    const now = nowIso();

    this.db.run(
      `UPDATE knowledge
        SET status = ?, merged_into = ?, updated_at = ?
        WHERE id = ? AND agent_id = ?`,
      [effectiveStatus, input.merged_into ?? null, now, input.id, input.agent_id]
    );
    this.persist();

    const rows = this.allRows(
      `SELECT * FROM knowledge WHERE id = ? AND agent_id = ?`,
      [input.id, input.agent_id]
    );
    if (rows.length === 0) {
      throw new Error(`Knowledge entry not found: ${input.id}`);
    }
    return this.rowToKnowledge(rows[0]);
  }

  async supersedeKnowledge(
    input: SupersedeKnowledgeInput
  ): Promise<{ old: Knowledge; new: Knowledge }> {
    const oldRows = this.allRows(
      `SELECT * FROM knowledge WHERE id = ? AND agent_id = ?`,
      [input.old_id, input.agent_id]
    );
    if (oldRows.length === 0) {
      throw new Error(`Knowledge not found: ${input.old_id}`);
    }
    const oldItem = this.rowToKnowledge(oldRows[0]);

    const newId = uuidv4();
    const now = nowIso();
    const newTags = input.tags ?? oldItem.tags;
    const newProject = input.project ?? oldItem.project ?? null;

    this.db.run("BEGIN");
    try {
      this.db.run(
        `INSERT INTO knowledge
           (id, agent_id, project, title, content, source_type, source_ids, tags,
            status, supersedes, supersede_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'manual', '[]', ?, 'active', ?, ?, ?, ?)`,
        [
          newId,
          input.agent_id,
          newProject,
          input.new_title,
          input.new_content,
          JSON.stringify(newTags),
          input.old_id,
          input.reason,
          now,
          now,
        ]
      );
      this.db.run(
        `UPDATE knowledge SET status = 'superseded', updated_at = ? WHERE id = ?`,
        [now, input.old_id]
      );
      this.db.run("COMMIT");
    } catch (err) {
      this.db.run("ROLLBACK");
      throw err;
    }

    this.persist();

    const updatedOldRows = this.allRows(
      `SELECT * FROM knowledge WHERE id = ?`,
      [input.old_id]
    );
    const newRows = this.allRows(
      `SELECT * FROM knowledge WHERE id = ?`,
      [newId]
    );
    return {
      old: this.rowToKnowledge(updatedOldRows[0]),
      new: this.rowToKnowledge(newRows[0]),
    };
  }

  // ─── Search ──────────────────────────────────────────────────

  async searchMemory(input: SearchMemoryInput): Promise<SearchMemoryResult> {
    // sql.js default build has no FTS5, no pgvector — always use LIKE search.
    const scope = input.scope || "all";
    const limit = input.limit || 5;
    const keywords = tokenizeQuery(input.query);

    const decisions: Decision[] = [];
    const taskStates: TaskState[] = [];
    const knowledgeItems: Knowledge[] = [];

    if (scope === "decisions" || scope === "all") {
      const conditions: string[] = ["agent_id = ?"];
      const params: unknown[] = [input.agent_id];
      if (input.project) {
        conditions.push("project = ?");
        params.push(input.project);
      }
      const likeClause = keywords
        .map(() =>
          "(coalesce(decision,'') || ' ' || coalesce(context,'') || ' ' || tags) LIKE ?"
        )
        .join(" OR ");
      conditions.push(`(${likeClause})`);
      for (const kw of keywords) params.push(`%${kw}%`);

      const sql = `SELECT * FROM decisions
                   WHERE ${conditions.join(" AND ")}
                   ORDER BY created_at DESC LIMIT ${limit}`;
      const rows = this.allRows(sql, params);
      decisions.push(...rows.map((r) => this.rowToDecision(r)));
    }

    if (scope === "tasks" || scope === "all") {
      const conditions: string[] = ["agent_id = ?"];
      const params: unknown[] = [input.agent_id];
      if (input.project) {
        conditions.push("project = ?");
        params.push(input.project);
      }
      const likeClause = keywords
        .map(() =>
          "(coalesce(task,'') || ' ' || coalesce(progress,'') || ' ' || coalesce(next_steps,'')) LIKE ?"
        )
        .join(" OR ");
      conditions.push(`(${likeClause})`);
      for (const kw of keywords) params.push(`%${kw}%`);

      const sql = `SELECT * FROM task_states
                   WHERE ${conditions.join(" AND ")}
                   ORDER BY created_at DESC LIMIT ${limit}`;
      const rows = this.allRows(sql, params);
      taskStates.push(...rows.map((r) => this.rowToTaskState(r)));
    }

    if (scope === "knowledge" || scope === "all") {
      const conditions: string[] = ["agent_id = ?", "status = 'active'"];
      const params: unknown[] = [input.agent_id];
      if (input.project) {
        conditions.push("project = ?");
        params.push(input.project);
      }
      const likeClause = keywords
        .map(() =>
          "(coalesce(title,'') || ' ' || coalesce(content,'') || ' ' || tags) LIKE ?"
        )
        .join(" OR ");
      conditions.push(`(${likeClause})`);
      for (const kw of keywords) params.push(`%${kw}%`);

      const sql = `SELECT * FROM knowledge
                   WHERE ${conditions.join(" AND ")}
                   ORDER BY updated_at DESC LIMIT ${limit}`;
      const rows = this.allRows(sql, params);
      knowledgeItems.push(...rows.map((r) => this.rowToKnowledge(r)));
    }

    // SQLite store has no agent_messages table — messages always empty.
    return { decisions, task_states: taskStates, knowledge: knowledgeItems, messages: [] };
  }

  // ─── Messages (no-op for SQLite) ─────────────────────────────

  async getRecentMessages(_input: {
    agent_id: string;
    project?: string;
    limit?: number;
  }): Promise<AgentMessage[]> {
    void _input;
    return [];
  }

  // ─── Recovery Config ─────────────────────────────────────────

  async getRecoveryConfig(agent_id: string): Promise<RecoveryConfig | null> {
    const rows = this.allRows(
      `SELECT agent_id, max_tokens, task_states_limit, decisions_limit, knowledge_limit,
              messages_limit, discord_history_limit, discord_channels, restart_message_threshold
         FROM recovery_config WHERE agent_id = ?`,
      [agent_id]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      agent_id: row.agent_id as string,
      max_tokens: row.max_tokens as number,
      task_states_limit: row.task_states_limit as number,
      decisions_limit: row.decisions_limit as number,
      knowledge_limit: row.knowledge_limit as number,
      messages_limit: row.messages_limit as number,
      discord_history_limit: row.discord_history_limit as number,
      discord_channels: parseJsonArray(row.discord_channels),
      restart_message_threshold: row.restart_message_threshold as number,
    };
  }

  async upsertRecoveryConfig(input: {
    agent_id: string;
    max_tokens?: number;
    task_states_limit?: number;
    decisions_limit?: number;
    knowledge_limit?: number;
    messages_limit?: number;
  }): Promise<RecoveryConfig> {
    const existing = await this.getRecoveryConfig(input.agent_id);
    const now = nowIso();

    if (existing) {
      const merged: RecoveryConfig = {
        ...existing,
        max_tokens: input.max_tokens ?? existing.max_tokens,
        task_states_limit: input.task_states_limit ?? existing.task_states_limit,
        decisions_limit: input.decisions_limit ?? existing.decisions_limit,
        knowledge_limit: input.knowledge_limit ?? existing.knowledge_limit,
        messages_limit: input.messages_limit ?? existing.messages_limit,
      };
      this.db.run(
        `UPDATE recovery_config
           SET max_tokens = ?, task_states_limit = ?, decisions_limit = ?,
               knowledge_limit = ?, messages_limit = ?, updated_at = ?
         WHERE agent_id = ?`,
        [
          merged.max_tokens,
          merged.task_states_limit,
          merged.decisions_limit,
          merged.knowledge_limit,
          merged.messages_limit,
          now,
          input.agent_id,
        ]
      );
      this.persist();
      return merged;
    }

    const config: RecoveryConfig = {
      agent_id: input.agent_id,
      max_tokens: input.max_tokens ?? 1000,
      task_states_limit: input.task_states_limit ?? 1,
      decisions_limit: input.decisions_limit ?? 0,
      knowledge_limit: input.knowledge_limit ?? 3,
      messages_limit: input.messages_limit ?? 5,
      discord_history_limit: 5,
      discord_channels: [],
      restart_message_threshold: 100,
    };
    this.db.run(
      `INSERT INTO recovery_config
        (agent_id, max_tokens, task_states_limit, decisions_limit, knowledge_limit,
         messages_limit, discord_history_limit, discord_channels, restart_message_threshold,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.agent_id,
        config.max_tokens,
        config.task_states_limit,
        config.decisions_limit,
        config.knowledge_limit,
        config.messages_limit,
        config.discord_history_limit,
        JSON.stringify(config.discord_channels),
        config.restart_message_threshold,
        now,
        now,
      ]
    );
    this.persist();
    return config;
  }

  // ─── Recovery Quality Log ────────────────────────────────────

  async logRecoveryQuality(input: LogRecoveryQualityInput): Promise<string> {
    const id = uuidv4();
    this.db.run(
      `INSERT INTO recovery_quality_log
        (id, agent_id, session_id, recovered_tokens,
         task_continued, quality_score, notes, search_memory_count_10min,
         created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.agent_id,
        input.session_id ?? null,
        input.recovered_tokens,
        input.task_continued === undefined ? null : input.task_continued ? 1 : 0,
        input.quality_score ?? null,
        input.notes ?? null,
        input.search_memory_count_10min ?? 0,
        nowIso(),
      ]
    );
    this.persist();
    return id;
  }

  async updateSearchMemoryCount(log_id: string, count: number): Promise<void> {
    if (!log_id) return;
    this.db.run(
      `UPDATE recovery_quality_log SET search_memory_count_10min = ? WHERE id = ?`,
      [count, log_id]
    );
    this.persist();
  }

  // ─── Lifecycle ───────────────────────────────────────────────

  async close(): Promise<void> {
    if (this.db) {
      this.persist();
      this.db.close();
    }
  }

  // ─── Row mappers ─────────────────────────────────────────────

  private rowToDecision(row: Record<string, unknown>): Decision {
    return {
      id: row.id as string,
      agent_id: row.agent_id as string,
      project: (row.project as string | null) ?? undefined,
      decision: row.decision as string,
      context: (row.context as string | null) ?? undefined,
      tags: parseJsonArray(row.tags),
      status: row.status as Decision["status"],
      superseded_by: (row.superseded_by as string | null) ?? undefined,
      created_at: row.created_at as string,
    };
  }

  private rowToTaskState(row: Record<string, unknown>): TaskState {
    return {
      id: row.id as string,
      agent_id: row.agent_id as string,
      project: (row.project as string | null) ?? undefined,
      task_id: (row.task_id as string | null) ?? undefined,
      task: row.task as string,
      status: row.status as TaskState["status"],
      progress: (row.progress as string | null) ?? undefined,
      files_modified: parseJsonArray(row.files_modified),
      next_steps: (row.next_steps as string | null) ?? undefined,
      created_at: row.created_at as string,
      updated_at: (row.updated_at as string | null) ?? undefined,
    };
  }

  private rowToKnowledge(row: Record<string, unknown>): Knowledge {
    return {
      id: row.id as string,
      agent_id: row.agent_id as string,
      project: (row.project as string | null) ?? undefined,
      title: row.title as string,
      content: row.content as string,
      source_type: row.source_type as Knowledge["source_type"],
      source_ids: parseJsonArray(row.source_ids),
      tags: parseJsonArray(row.tags),
      status: row.status as Knowledge["status"],
      merged_into: (row.merged_into as string | null) ?? undefined,
      supersedes: (row.supersedes as string | null) ?? undefined,
      supersede_reason: (row.supersede_reason as string | null) ?? undefined,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
