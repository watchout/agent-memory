import pg from "pg";
import { v4 as uuidv4 } from "uuid";
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
  LogRecoveryQualityInput,
} from "./types.js";
import {
  isVoyageAvailable,
  generateEmbedding,
  toPgVector,
  EMBEDDING_DIM,
} from "./voyage.js";

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

  // v0.2.0: GIN indexes for full-text search (columns only, no function calls on arrays)
  `CREATE INDEX IF NOT EXISTS idx_decisions_search ON decisions
    USING GIN (to_tsvector('simple', coalesce(decision,'') || ' ' || coalesce(context,'')))`,
  `CREATE INDEX IF NOT EXISTS idx_task_states_search ON task_states
    USING GIN (to_tsvector('simple', coalesce(task,'') || ' ' || coalesce(progress,'') || ' ' || coalesce(next_steps,'')))`,

  // v0.3.0: knowledge table
  `CREATE TABLE IF NOT EXISTS knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    project TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_ids UUID[] DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    status TEXT DEFAULT 'active',
    merged_into UUID REFERENCES knowledge(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_agent ON knowledge(agent_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge(project, status)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_search ON knowledge
    USING GIN (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,'')))`,

  // v0.3.0: consolidated_at column on decisions
  `ALTER TABLE decisions ADD COLUMN IF NOT EXISTS consolidated_at TIMESTAMPTZ`,

  // v0.3.1: pgvector extension + embedding columns for semantic search
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `ALTER TABLE decisions ADD COLUMN IF NOT EXISTS embedding vector(512)`,
  `ALTER TABLE task_states ADD COLUMN IF NOT EXISTS embedding vector(512)`,
  `ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS embedding vector(512)`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_embedding ON decisions USING hnsw (embedding vector_cosine_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_task_states_embedding ON task_states USING hnsw (embedding vector_cosine_ops)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge USING hnsw (embedding vector_cosine_ops)`,

  // v0.4.0: recovery_config table (FEAT-015)
  `CREATE TABLE IF NOT EXISTS recovery_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL UNIQUE,
    max_tokens INT DEFAULT 1000,
    task_states_limit INT DEFAULT 1,
    decisions_limit INT DEFAULT 0,
    knowledge_limit INT DEFAULT 3,
    messages_limit INT DEFAULT 5,
    discord_history_limit INT DEFAULT 5,
    discord_channels TEXT[] DEFAULT '{}',
    restart_message_threshold INT DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,

  // Initial data for Phase 0 deploy
  `INSERT INTO recovery_config (agent_id, max_tokens, task_states_limit, decisions_limit, messages_limit, knowledge_limit, discord_history_limit, discord_channels, restart_message_threshold) VALUES
    ('cto', 3000, 3, 5, 10, 5, 20, '{1485598480553611357,1486097810989383773}', 100),
    ('iyasaka-arc', 2000, 3, 3, 10, 3, 10, '{1485598480553611357}', 150),
    ('hotel-dev', 1000, 1, 0, 5, 3, 5, '{1486097810989383773}', 80),
    ('adf-dev', 1000, 1, 0, 5, 3, 5, '{1486161338832126083}', 80),
    ('haishin-dev', 1000, 1, 0, 5, 3, 5, '{}', 100),
    ('wbs-dev', 1000, 1, 0, 5, 3, 5, '{}', 100),
    ('nyusatsu-dev', 1000, 1, 0, 5, 3, 5, '{}', 100),
    ('xmarketing-dev', 1000, 1, 0, 5, 3, 5, '{}', 100),
    ('upwork-dev', 1000, 1, 0, 5, 3, 5, '{}', 100),
    ('agent-com-dev', 1500, 2, 3, 5, 3, 5, '{}', 100)
  ON CONFLICT (agent_id) DO NOTHING`,

  // v0.4.0: recovery_quality_log table (FEAT-024)
  `CREATE TABLE IF NOT EXISTS recovery_quality_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    session_id TEXT,
    recovered_tokens INT,
    task_continued BOOLEAN,
    search_memory_count_10min INT DEFAULT 0,
    quality_score FLOAT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_recovery_quality_agent ON recovery_quality_log(agent_id, created_at DESC)`,
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
    const embeddingText = `${input.decision} ${input.context || ""}`.trim();
    const embedding = await generateEmbedding(embeddingText);

    const result = await this.pool.query(
      `INSERT INTO decisions (id, agent_id, project, decision, context, tags, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        input.agent_id,
        input.project || null,
        input.decision,
        input.context || null,
        input.tags || [],
        embedding ? toPgVector(embedding) : null,
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
    const embeddingText = `${input.task} ${input.progress || ""} ${input.next_steps || ""}`.trim();
    const embedding = await generateEmbedding(embeddingText);

    const result = await this.pool.query(
      `INSERT INTO task_states (id, agent_id, project, task, status, progress, files_modified, next_steps, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
        embedding ? toPgVector(embedding) : null,
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

  async searchMemory(input: SearchMemoryInput): Promise<SearchMemoryResult> {
    // Use vector search if Voyage AI is available, otherwise fall back to text search
    if (isVoyageAvailable()) {
      return this.searchMemoryVector(input);
    }
    return this.searchMemoryText(input);
  }

  /**
   * Semantic vector search using Voyage AI embeddings + pgvector cosine similarity.
   */
  private async searchMemoryVector(input: SearchMemoryInput): Promise<SearchMemoryResult> {
    const scope = input.scope || "all";
    const limit = input.limit || 5;

    // Generate query embedding
    const queryEmbedding = await generateEmbedding(input.query, "query");
    if (!queryEmbedding) {
      // Fallback to text search if embedding generation fails
      return this.searchMemoryText(input);
    }
    const queryVec = toPgVector(queryEmbedding);

    let decisions: Decision[] = [];
    let taskStates: TaskState[] = [];
    let knowledgeItems: Knowledge[] = [];
    let messages: AgentMessage[] = [];

    if (scope === "decisions" || scope === "all") {
      const conditions: string[] = ["agent_id = $1", "embedding IS NOT NULL"];
      const params: unknown[] = [input.agent_id];
      let pi = 2;
      if (input.project) {
        conditions.push(`project = $${pi++}`);
        params.push(input.project);
      }
      const sql = `SELECT *, embedding <=> $${pi}::vector AS distance
                   FROM decisions WHERE ${conditions.join(" AND ")}
                   ORDER BY distance ASC LIMIT ${limit}`;
      params.push(queryVec);
      const result = await this.pool.query(sql, params);
      decisions = result.rows.map(this.rowToDecision);
    }

    if (scope === "tasks" || scope === "all") {
      const conditions: string[] = ["agent_id = $1", "embedding IS NOT NULL"];
      const params: unknown[] = [input.agent_id];
      let pi = 2;
      if (input.project) {
        conditions.push(`project = $${pi++}`);
        params.push(input.project);
      }
      const sql = `SELECT *, embedding <=> $${pi}::vector AS distance
                   FROM task_states WHERE ${conditions.join(" AND ")}
                   ORDER BY distance ASC LIMIT ${limit}`;
      params.push(queryVec);
      const result = await this.pool.query(sql, params);
      taskStates = result.rows.map(this.rowToTaskState);
    }

    if (scope === "knowledge" || scope === "all") {
      const conditions: string[] = ["agent_id = $1", "status = 'active'", "embedding IS NOT NULL"];
      const params: unknown[] = [input.agent_id];
      let pi = 2;
      if (input.project) {
        conditions.push(`project = $${pi++}`);
        params.push(input.project);
      }
      const sql = `SELECT *, embedding <=> $${pi}::vector AS distance
                   FROM knowledge WHERE ${conditions.join(" AND ")}
                   ORDER BY distance ASC LIMIT ${limit}`;
      params.push(queryVec);
      try {
        const result = await this.pool.query(sql, params);
        knowledgeItems = result.rows.map(this.rowToKnowledge);
      } catch {
        // knowledge table may not exist yet
      }
    }

    // Messages don't have embeddings — use text search fallback
    if (scope === "messages" || scope === "all") {
      messages = await this.searchMessagesText(input);
    }

    return { decisions, task_states: taskStates, knowledge: knowledgeItems, messages };
  }

  /**
   * Text-based search using tsvector + ILIKE (original implementation).
   */
  private async searchMemoryText(input: SearchMemoryInput): Promise<SearchMemoryResult> {
    const scope = input.scope || "all";
    const limit = input.limit || 5;
    // Split on whitespace, then further split mixed CJK/ASCII tokens
    const rawTokens = input.query.split(/\s+/).filter(Boolean);
    const keywords: string[] = [];
    for (const token of rawTokens) {
      const parts = token.split(/(?<=[\u3000-\u9fff\uf900-\ufaff])(?=[a-z0-9])|(?<=[a-z0-9])(?=[\u3000-\u9fff\uf900-\ufaff])/i).filter(Boolean);
      keywords.push(...parts);
    }

    // Build tsquery for full-text search (works well for ASCII/Latin)
    const tsQuery = keywords
      .map((w) => w.replace(/[^\w\u3000-\u9fff\uf900-\ufaff]/g, ""))
      .filter(Boolean)
      .join(" | ");

    // Build ILIKE patterns for CJK/mixed text fallback
    const likePatterns = keywords.map((w) => `%${w}%`);

    let decisions: Decision[] = [];
    let taskStates: TaskState[] = [];

    if (scope === "decisions" || scope === "all") {
      const conditions: string[] = ["agent_id = $1"];
      const params: unknown[] = [input.agent_id];
      let pi = 2;

      if (input.project) {
        conditions.push(`project = $${pi++}`);
        params.push(input.project);
      }

      // Combine tsvector (for indexed ASCII search) OR ILIKE (for CJK fallback)
      const searchClauses: string[] = [];
      if (tsQuery) {
        searchClauses.push(
          `to_tsvector('simple', coalesce(decision,'') || ' ' || coalesce(context,'')) @@ to_tsquery('simple', $${pi++})`
        );
        params.push(tsQuery);
      }
      const likeClause = likePatterns.map((_, i) =>
        `(coalesce(decision,'') || ' ' || coalesce(context,'') || ' ' || array_to_string(tags,' ')) ILIKE $${pi + i}`
      ).join(" OR ");
      searchClauses.push(`(${likeClause})`);
      for (const pat of likePatterns) params.push(pat);
      pi += likePatterns.length;

      conditions.push(`(${searchClauses.join(" OR ")})`);

      const sql = `SELECT * FROM decisions WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ${limit}`;
      const result = await this.pool.query(sql, params);
      decisions = result.rows.map(this.rowToDecision);
    }

    if (scope === "tasks" || scope === "all") {
      const conditions: string[] = ["agent_id = $1"];
      const params: unknown[] = [input.agent_id];
      let pi = 2;

      if (input.project) {
        conditions.push(`project = $${pi++}`);
        params.push(input.project);
      }

      const searchClauses: string[] = [];
      if (tsQuery) {
        searchClauses.push(
          `to_tsvector('simple', coalesce(task,'') || ' ' || coalesce(progress,'') || ' ' || coalesce(next_steps,'')) @@ to_tsquery('simple', $${pi++})`
        );
        params.push(tsQuery);
      }
      const likeClause = likePatterns.map((_, i) =>
        `(coalesce(task,'') || ' ' || coalesce(progress,'') || ' ' || coalesce(next_steps,'')) ILIKE $${pi + i}`
      ).join(" OR ");
      searchClauses.push(`(${likeClause})`);
      for (const pat of likePatterns) params.push(pat);
      pi += likePatterns.length;

      conditions.push(`(${searchClauses.join(" OR ")})`);

      const sql = `SELECT * FROM task_states WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ${limit}`;
      const result = await this.pool.query(sql, params);
      taskStates = result.rows.map(this.rowToTaskState);
    }

    let knowledgeItems: Knowledge[] = [];

    if (scope === "knowledge" || scope === "all") {
      const conditions: string[] = ["agent_id = $1", "status = 'active'"];
      const params: unknown[] = [input.agent_id];
      let pi = 2;

      if (input.project) {
        conditions.push(`project = $${pi++}`);
        params.push(input.project);
      }

      const searchClauses: string[] = [];
      if (tsQuery) {
        searchClauses.push(
          `to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,'')) @@ to_tsquery('simple', $${pi++})`
        );
        params.push(tsQuery);
      }
      const likeClause = likePatterns.map((_, i) =>
        `(coalesce(title,'') || ' ' || coalesce(content,'') || ' ' || array_to_string(tags,' ')) ILIKE $${pi + i}`
      ).join(" OR ");
      searchClauses.push(`(${likeClause})`);
      for (const pat of likePatterns) params.push(pat);
      pi += likePatterns.length;

      conditions.push(`(${searchClauses.join(" OR ")})`);

      const sql = `SELECT * FROM knowledge WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC LIMIT ${limit}`;
      try {
        const result = await this.pool.query(sql, params);
        knowledgeItems = result.rows.map(this.rowToKnowledge);
      } catch {
        // knowledge table may not exist yet
      }
    }

    let messages: AgentMessage[] = [];
    if (scope === "messages" || scope === "all") {
      messages = await this.searchMessagesText(input);
    }

    return { decisions, task_states: taskStates, knowledge: knowledgeItems, messages };
  }

  /**
   * Text search for agent_messages (shared by both vector and text search paths).
   */
  private async searchMessagesText(input: SearchMemoryInput): Promise<AgentMessage[]> {
    const limit = input.limit || 5;
    const rawTokens = input.query.split(/\s+/).filter(Boolean);
    const keywords: string[] = [];
    for (const token of rawTokens) {
      const parts = token.split(/(?<=[\u3000-\u9fff\uf900-\ufaff])(?=[a-z0-9])|(?<=[a-z0-9])(?=[\u3000-\u9fff\uf900-\ufaff])/i).filter(Boolean);
      keywords.push(...parts);
    }
    const likePatterns = keywords.map((w) => `%${w}%`);

    try {
      const conditions: string[] = ["author_id = $1"];
      const params: unknown[] = [input.agent_id];
      let pi = 2;

      if (input.project) {
        conditions.push(`(project = $${pi++} OR project IS NULL)`);
        params.push(input.project);
      }

      const likeClause = likePatterns.map((_, i) =>
        `content ILIKE $${pi + i}`
      ).join(" OR ");
      conditions.push(`(${likeClause})`);
      for (const pat of likePatterns) params.push(pat);
      pi += likePatterns.length;

      const sql = `SELECT id, author_id, content, coalesce(source,'agent-comms') as source, channel_id, coalesce(role,'agent') as role, project, created_at FROM agent_messages WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ${limit}`;
      const result = await this.pool.query(sql, params);
      return result.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        author_id: row.author_id as string,
        content: row.content as string,
        source: row.source as string,
        channel_id: row.channel_id as string | undefined,
        role: row.role as string,
        project: row.project as string | undefined,
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at as string,
      }));
    } catch {
      // agent_messages table may not exist
      return [];
    }
  }

  async getRecentMessages(input: { agent_id: string; project?: string; limit?: number }): Promise<AgentMessage[]> {
    const limit = input.limit || 10;
    try {
      // Check if agent_messages table exists
      const tableCheck = await this.pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_messages' LIMIT 1`
      );
      if (tableCheck.rows.length === 0) return [];

      const conditions: string[] = [];
      const params: unknown[] = [];
      let pi = 1;

      // Get messages TO or FROM this agent
      conditions.push(`author_id = $${pi}`);
      params.push(input.agent_id);
      pi++;

      if (input.project) {
        conditions.push(`(project = $${pi} OR project IS NULL)`);
        params.push(input.project);
        pi++;
      }

      const sql = `SELECT id, author_id, content, coalesce(source,'agent-comms') as source, channel_id, coalesce(role,'agent') as role, project, created_at
        FROM agent_messages
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC LIMIT ${limit}`;

      const result = await this.pool.query(sql, params);
      return result.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        author_id: row.author_id as string,
        content: row.content as string,
        source: row.source as string,
        channel_id: row.channel_id as string | undefined,
        role: row.role as string,
        project: row.project as string | undefined,
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at as string,
      }));
    } catch {
      // agent_messages table may not exist or query fails — graceful skip
      return [];
    }
  }

  async getRecoveryConfig(agent_id: string): Promise<RecoveryConfig | null> {
    try {
      const result = await this.pool.query(
        `SELECT agent_id, max_tokens, task_states_limit, decisions_limit, knowledge_limit,
                messages_limit, discord_history_limit, discord_channels, restart_message_threshold
         FROM recovery_config WHERE agent_id = $1`,
        [agent_id]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        agent_id: row.agent_id,
        max_tokens: row.max_tokens,
        task_states_limit: row.task_states_limit,
        decisions_limit: row.decisions_limit,
        knowledge_limit: row.knowledge_limit,
        messages_limit: row.messages_limit,
        discord_history_limit: row.discord_history_limit,
        discord_channels: row.discord_channels || [],
        restart_message_threshold: row.restart_message_threshold,
      };
    } catch {
      // Table may not exist yet
      return null;
    }
  }

  async expireStaleTaskStates(input: { agent_id: string; max_age_days: number }): Promise<number> {
    const result = await this.pool.query(
      `UPDATE task_states
       SET status = 'expired'
       WHERE agent_id = $1
         AND status = 'in_progress'
         AND created_at < NOW() - INTERVAL '1 day' * $2
       RETURNING id`,
      [input.agent_id, input.max_age_days]
    );
    return result.rowCount ?? 0;
  }

  async upsertRecoveryConfig(input: {
    agent_id: string;
    max_tokens?: number;
    task_states_limit?: number;
    decisions_limit?: number;
    knowledge_limit?: number;
    messages_limit?: number;
  }): Promise<RecoveryConfig> {
    const result = await this.pool.query(
      `INSERT INTO recovery_config (agent_id, max_tokens, task_states_limit, decisions_limit, knowledge_limit, messages_limit)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (agent_id) DO UPDATE SET
         max_tokens = COALESCE($2, recovery_config.max_tokens),
         task_states_limit = COALESCE($3, recovery_config.task_states_limit),
         decisions_limit = COALESCE($4, recovery_config.decisions_limit),
         knowledge_limit = COALESCE($5, recovery_config.knowledge_limit),
         messages_limit = COALESCE($6, recovery_config.messages_limit),
         updated_at = now()
       RETURNING agent_id, max_tokens, task_states_limit, decisions_limit, knowledge_limit, messages_limit, discord_history_limit, discord_channels, restart_message_threshold`,
      [
        input.agent_id,
        input.max_tokens ?? null,
        input.task_states_limit ?? null,
        input.decisions_limit ?? null,
        input.knowledge_limit ?? null,
        input.messages_limit ?? null,
      ]
    );
    const row = result.rows[0];
    return {
      agent_id: row.agent_id,
      max_tokens: row.max_tokens,
      task_states_limit: row.task_states_limit,
      decisions_limit: row.decisions_limit,
      knowledge_limit: row.knowledge_limit,
      messages_limit: row.messages_limit,
      discord_history_limit: row.discord_history_limit,
      discord_channels: row.discord_channels || [],
      restart_message_threshold: row.restart_message_threshold,
    };
  }

  async logRecoveryQuality(input: LogRecoveryQualityInput): Promise<string> {
    try {
      const result = await this.pool.query(
        `INSERT INTO recovery_quality_log
          (agent_id, session_id, recovered_tokens,
           task_continued, quality_score, notes, search_memory_count_10min)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          input.agent_id,
          input.session_id ?? null,
          input.recovered_tokens,
          input.task_continued ?? null,
          input.quality_score ?? null,
          input.notes ?? null,
          input.search_memory_count_10min ?? 0,
        ]
      );
      return result.rows[0].id;
    } catch {
      // Table may not exist yet — non-fatal
      return "";
    }
  }

  async updateSearchMemoryCount(log_id: string, count: number): Promise<void> {
    if (!log_id) return;
    try {
      await this.pool.query(
        `UPDATE recovery_quality_log SET search_memory_count_10min = $1 WHERE id = $2`,
        [count, log_id]
      );
    } catch {
      // Non-fatal
    }
  }

  async saveKnowledge(input: SaveKnowledgeInput): Promise<Knowledge> {
    const id = uuidv4();
    const embeddingText = `${input.title} ${input.content}`.trim();
    const embedding = await generateEmbedding(embeddingText);

    const result = await this.pool.query(
      `INSERT INTO knowledge (id, agent_id, project, title, content, source_type, source_ids, tags, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id,
        input.agent_id,
        input.project || null,
        input.title,
        input.content,
        input.source_type,
        input.source_ids || [],
        input.tags || [],
        embedding ? toPgVector(embedding) : null,
      ]
    );
    return this.rowToKnowledge(result.rows[0]);
  }

  async getKnowledge(input: GetKnowledgeInput): Promise<Knowledge[]> {
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
    const sql = `SELECT * FROM knowledge WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC LIMIT ${limit}`;
    const result = await this.pool.query(sql, params);
    return result.rows.map(this.rowToKnowledge);
  }

  async updateKnowledgeStatus(input: { id: string; agent_id: string; status: "active" | "merged" | "archived"; merged_into?: string }): Promise<Knowledge> {
    if (input.merged_into) {
      if (input.id === input.merged_into) {
        throw new Error("Cannot merge a knowledge entry into itself");
      }
      const targetCheck = await this.pool.query(
        `SELECT 1 FROM knowledge WHERE id = $1 AND agent_id = $2`,
        [input.merged_into, input.agent_id]
      );
      if (targetCheck.rows.length === 0) {
        throw new Error(`Merge target not found: ${input.merged_into}`);
      }
    }

    const effectiveStatus = input.merged_into ? "merged" : input.status;

    const result = await this.pool.query(
      `UPDATE knowledge SET status = $1, merged_into = $2, updated_at = now()
       WHERE id = $3 AND agent_id = $4
       RETURNING *`,
      [effectiveStatus, input.merged_into || null, input.id, input.agent_id]
    );
    if (result.rows.length === 0) {
      throw new Error(`Knowledge entry not found: ${input.id}`);
    }
    return this.rowToKnowledge(result.rows[0]);
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

  private rowToKnowledge(row: Record<string, unknown>): Knowledge {
    return {
      id: row.id as string,
      agent_id: row.agent_id as string,
      project: row.project as string | undefined,
      title: row.title as string,
      content: row.content as string,
      source_type: row.source_type as Knowledge["source_type"],
      source_ids: (row.source_ids as string[]) || [],
      tags: (row.tags as string[]) || [],
      status: row.status as Knowledge["status"],
      merged_into: row.merged_into as string | undefined,
      created_at:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : (row.created_at as string),
      updated_at:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : (row.updated_at as string),
    };
  }
}
