import pg from "pg";
import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { deriveTaskIdFromTask } from "./task-id.js";
import { conversationEventToRawEventInput, rawEventSourceRef } from "./raw-events.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";
import type {
  Store,
  Decision,
  TaskState,
  Knowledge,
  AgentMessage,
  ConversationEvent,
  RawEvent,
  SelectedRestartPack,
  RestartEvent,
  RecoveryConfig,
  CatchUpLog,
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
  SaveConversationEventInput,
  GetConversationEventsInput,
  SaveRawEventInput,
  GetRawEventsInput,
  SaveSelectedRestartPackInput,
  GetSelectedRestartPackInput,
  ConsumeSelectedRestartPackInput,
  SaveRestartEventInput,
  GetRestartEventsInput,
  SaveCatchUpLogInput,
  KusabiPartition,
  UpsertKusabiPartitionInput,
  GetKusabiPartitionInput,
} from "./types.js";
import {
  isVoyageAvailable,
  generateEmbedding,
  toPgVector,
  EMBEDDING_DIM,
} from "./voyage.js";

const { Pool } = pg;

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export class PgStore implements Store {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      for (const sql of PG_MIGRATIONS) {
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
    // AM-023: derive a stable task_id when the caller doesn't supply one,
    // so the UNIQUE constraint always has a value to key on. The hash
    // input is intentionally just `task` (not progress/next_steps) so
    // that callers updating the same task with different progress text
    // still hit the same key.
    const taskId = input.task_id ?? deriveTaskIdFromTask(input.task);

    const result = await this.pool.query(
      `INSERT INTO task_states
        (id, agent_id, project, task_id, task, status, progress,
         files_modified, next_steps, embedding, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (agent_id, task_id) DO UPDATE SET
         project = EXCLUDED.project,
         task = EXCLUDED.task,
         status = EXCLUDED.status,
         progress = EXCLUDED.progress,
         files_modified = EXCLUDED.files_modified,
         next_steps = EXCLUDED.next_steps,
         embedding = COALESCE(EXCLUDED.embedding, task_states.embedding),
         updated_at = now()
       RETURNING *`,
      [
        id,
        input.agent_id,
        input.project || null,
        taskId,
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
    let conversationEvents: ConversationEvent[] = [];

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
    if (scope === "conversation" || scope === "all") {
      conversationEvents = await this.searchConversationEventsText(input);
    }

    return { decisions, task_states: taskStates, knowledge: knowledgeItems, messages, conversation_events: conversationEvents };
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
    let conversationEvents: ConversationEvent[] = [];
    if (scope === "conversation" || scope === "all") {
      conversationEvents = await this.searchConversationEventsText(input);
    }

    return { decisions, task_states: taskStates, knowledge: knowledgeItems, messages, conversation_events: conversationEvents };
  }

  private async searchConversationEventsText(input: SearchMemoryInput): Promise<ConversationEvent[]> {
    const limit = input.limit || 5;
    const rawTokens = input.query.split(/\s+/).filter(Boolean);
    const keywords: string[] = [];
    for (const token of rawTokens) {
      const parts = token.split(/(?<=[\u3000-\u9fff\uf900-\ufaff])(?=[a-z0-9])|(?<=[a-z0-9])(?=[\u3000-\u9fff\uf900-\ufaff])/i).filter(Boolean);
      keywords.push(...parts);
    }
    if (keywords.length === 0) return [];

    const tsQuery = keywords
      .map((w) => w.replace(/[^\w\u3000-\u9fff\uf900-\ufaff]/g, ""))
      .filter(Boolean)
      .join(" | ");
    const likePatterns = keywords.map((w) => `%${w}%`);

    const conditions: string[] = ["agent_id = $1"];
    const params: unknown[] = [input.agent_id];
    let pi = 2;
    if (input.project) {
      conditions.push(`project = $${pi++}`);
      params.push(input.project);
    }

    const searchClauses: string[] = [];
    if (tsQuery) {
      searchClauses.push(`to_tsvector('simple', coalesce(content,'')) @@ to_tsquery('simple', $${pi++})`);
      params.push(tsQuery);
    }
    const likeParamRefs = likePatterns.map(() => `$${pi++}`);
    const likeClause = likeParamRefs.map((paramRef) =>
      `(coalesce(content,'') || ' ' || coalesce(role,'') || ' ' || coalesce(source,'')) ILIKE ${paramRef}`
    ).join(" OR ");
    searchClauses.push(`(${likeClause})`);
    for (const pat of likePatterns) params.push(pat);

    conditions.push(`(${searchClauses.join(" OR ")})`);
    const rankExpr = [
      ...likeParamRefs.map((paramRef) => `CASE WHEN content ILIKE ${paramRef} THEN 1 ELSE 0 END`),
      `CASE WHEN role IN ('user', 'assistant') THEN 0.25 ELSE 0 END`,
      `CASE WHEN content ILIKE '%"type":"token_count"%' THEN -2 ELSE 0 END`,
      `CASE WHEN content ILIKE '%"type":"turn_context"%' THEN -1 ELSE 0 END`,
    ].join(" + ");
    const result = await this.pool.query(
      `SELECT * FROM conversation_events
       WHERE ${conditions.join(" AND ")}
       ORDER BY (${rankExpr}) DESC, occurred_at DESC
       LIMIT ${limit}`,
      params
    );
    return result.rows.map((row: Record<string, unknown>) => this.rowToConversationEvent(row));
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

  async saveConversationEvent(input: SaveConversationEventInput): Promise<ConversationEvent> {
    const id = uuidv4();
    const hash = input.content_hash ?? contentHash(input.content);
    const occurredAt = input.occurred_at ?? new Date().toISOString();
    const result = await this.pool.query(
      `INSERT INTO conversation_events
        (id, agent_id, project, source, source_event_id, source_path, role,
         content, content_hash, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        id,
        input.agent_id,
        input.project ?? null,
        input.source,
        input.source_event_id ?? null,
        input.source_path ?? null,
        input.role ?? null,
        input.content,
        hash,
        JSON.stringify(input.metadata ?? {}),
        occurredAt,
      ]
    );
    if (result.rows[0]) {
      const event = this.rowToConversationEvent(result.rows[0]);
      await this.ensureConversationRawEvent(event);
      return event;
    }

    const existing = input.source_event_id
      ? await this.pool.query(
          `SELECT * FROM conversation_events
           WHERE agent_id = $1 AND source = $2 AND source_event_id = $3
           LIMIT 1`,
          [input.agent_id, input.source, input.source_event_id]
        )
      : await this.pool.query(
          `SELECT * FROM conversation_events
           WHERE agent_id = $1 AND source = $2 AND content_hash = $3 AND occurred_at = $4
           LIMIT 1`,
          [input.agent_id, input.source, hash, occurredAt]
        );
    const event = this.rowToConversationEvent(existing.rows[0]);
    await this.ensureConversationRawEvent(event);
    return event;
  }

  async getConversationEvents(input: GetConversationEventsInput): Promise<ConversationEvent[]> {
    const conditions: string[] = ["agent_id = $1"];
    const params: unknown[] = [input.agent_id];
    let pi = 2;
    if (input.project) {
      conditions.push(`project = $${pi}`);
      params.push(input.project);
      pi++;
    }
    if (input.source) {
      conditions.push(`source = $${pi}`);
      params.push(input.source);
      pi++;
    }
    if (input.since) {
      conditions.push(`occurred_at >= $${pi}`);
      params.push(input.since);
      pi++;
    }
    const result = await this.pool.query(
      `SELECT * FROM conversation_events
       WHERE ${conditions.join(" AND ")}
       ORDER BY occurred_at DESC
       LIMIT ${input.limit ?? 50}`,
      params
    );
    return result.rows.map((row: Record<string, unknown>) => this.rowToConversationEvent(row));
  }

  async saveRawEvent(input: SaveRawEventInput): Promise<RawEvent> {
    const id = uuidv4();
    const hash = input.content_hash ?? (input.content ? contentHash(input.content) : undefined);
    const occurredAt = input.occurred_at ?? new Date().toISOString();
    const sourceRef = rawEventSourceRef(input);
    const sourceRefHash = contentHash(JSON.stringify(sourceRef));
    const findExisting = async () => {
      if (input.source_event_id) {
        return this.pool.query(
          `SELECT * FROM raw_events
           WHERE agent_id = $1 AND source = $2 AND source_event_id = $3
           LIMIT 1`,
          [input.agent_id, input.source, input.source_event_id]
        );
      }
      if (hash !== undefined) {
        return this.pool.query(
          `SELECT * FROM raw_events
           WHERE agent_id = $1 AND source = $2 AND content_hash = $3 AND occurred_at = $4
           LIMIT 1`,
          [input.agent_id, input.source, hash, occurredAt]
        );
      }
      return this.pool.query(
        `SELECT * FROM raw_events
         WHERE agent_id = $1 AND source = $2 AND source_ref_hash = $3 AND occurred_at = $4
         LIMIT 1`,
        [input.agent_id, input.source, sourceRefHash, occurredAt]
      );
    };

    if (!input.source_event_id && hash === undefined) {
      const existing = await findExisting();
      if (existing.rows[0]) return this.rowToRawEvent(existing.rows[0]);
    }

    const result = await this.pool.query(
      `INSERT INTO raw_events
        (id, agent_id, session_id, project, host, source, event_type, role,
         source_ref, source_ref_hash, event_at, content_text, content_json,
         redaction_level, private_reasoning, content, content_hash,
         source_event_id, source_path, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18, $19, $20::jsonb, $21)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        id,
        input.agent_id,
        input.session_id ?? null,
        input.project ?? null,
        input.host ?? "unknown",
        input.source,
        input.event_type,
        input.role ?? "event",
        JSON.stringify(sourceRef),
        sourceRefHash,
        occurredAt,
        input.content ?? null,
        null,
        input.redaction_level ?? "basic",
        input.private_reasoning ?? false,
        input.content ?? null,
        hash ?? null,
        input.source_event_id ?? null,
        input.source_path ?? null,
        JSON.stringify(input.metadata ?? {}),
        occurredAt,
      ]
    );
    if (result.rows[0]) return this.rowToRawEvent(result.rows[0]);

    const existing = await findExisting();
    return this.rowToRawEvent(existing.rows[0]);
  }

  async getRawEvents(input: GetRawEventsInput): Promise<RawEvent[]> {
    const conditions: string[] = ["agent_id = $1"];
    const params: unknown[] = [input.agent_id];
    let pi = 2;
    if (input.session_id) {
      conditions.push(`session_id = $${pi}`);
      params.push(input.session_id);
      pi++;
    }
    if (input.project) {
      conditions.push(`project = $${pi}`);
      params.push(input.project);
      pi++;
    }
    if (input.source) {
      conditions.push(`source = $${pi}`);
      params.push(input.source);
      pi++;
    }
    if (input.event_type) {
      conditions.push(`event_type = $${pi}`);
      params.push(input.event_type);
      pi++;
    }
    if (input.since) {
      conditions.push(`occurred_at >= $${pi}`);
      params.push(input.since);
      pi++;
    }
    const result = await this.pool.query(
      `SELECT * FROM raw_events
       WHERE ${conditions.join(" AND ")}
       ORDER BY occurred_at DESC
       LIMIT ${input.limit ?? 50}`,
      params
    );
    return result.rows.map((row: Record<string, unknown>) => this.rowToRawEvent(row));
  }

  private async ensureConversationRawEvent(event: ConversationEvent): Promise<void> {
    await this.saveRawEvent(conversationEventToRawEventInput(event));
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
    } catch (err) {
      // AM-015: warn instead of swallowing silently. The original silent
      // catch is what produced the all-NULL recovery_quality_log row that
      // motivated AM-002. Surfacing the error here means we notice the
      // schema-missing or permission-denied case immediately.
      process.stderr.write(
        `[agent-memory] logRecoveryQuality failed (non-fatal): ${err}\n`
      );
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

  async saveSelectedRestartPack(input: SaveSelectedRestartPackInput): Promise<SelectedRestartPack> {
    const id = uuidv4();
    const packRef = `selected_restart_pack:${id}`;
    const hash = createHash("sha256").update(input.content).digest("hex");
    const result = await this.pool.query(
      `INSERT INTO selected_restart_packs
        (id, agent_id, project, pack_ref, content, content_hash, source, metadata, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id,
        input.agent_id,
        input.project ?? null,
        packRef,
        input.content,
        hash,
        input.source ?? "restart_prepare",
        input.metadata ?? {},
        input.expires_at ?? null,
      ]
    );
    return this.rowToSelectedRestartPack(result.rows[0]);
  }

  async getSelectedRestartPack(input: GetSelectedRestartPackInput): Promise<SelectedRestartPack | null> {
    const result = await this.pool.query(
      `SELECT * FROM selected_restart_packs
       WHERE agent_id = $1
         AND pack_ref = $2
         AND ($3::text IS NULL OR project = $3)
         AND status = 'active'
         AND (expires_at IS NULL OR expires_at > now())
       LIMIT 1`,
      [input.agent_id, input.pack_ref, input.project ?? null]
    );
    return result.rows[0] ? this.rowToSelectedRestartPack(result.rows[0]) : null;
  }

  async consumeSelectedRestartPack(input: ConsumeSelectedRestartPackInput): Promise<SelectedRestartPack | null> {
    const result = await this.pool.query(
      `UPDATE selected_restart_packs
          SET status = 'consumed', consumed_at = COALESCE($4::timestamptz, now())
        WHERE agent_id = $1
          AND pack_ref = $2
          AND ($3::text IS NULL OR project = $3)
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > now())
        RETURNING *`,
      [input.agent_id, input.pack_ref, input.project ?? null, input.consumed_at ?? null]
    );
    return result.rows[0] ? this.rowToSelectedRestartPack(result.rows[0]) : null;
  }

  async saveRestartEvent(input: SaveRestartEventInput): Promise<RestartEvent> {
    const result = await this.pool.query(
      `INSERT INTO restart_events
        (event_id, agent_id, project, seat_id, host, host_id, host_adapter_id,
         session_id, marker_id, marker_digest, marker_path, marker_status,
         attempt_ordinal, phase, payload_digest, action, restart_required, executed_restart, band, context_tokens,
         context_window_tokens, context_used_ratio, thresholds, queue_check_mode,
         queue_check_result, preflight_status, restart_command, failure_reason,
         pre_state, post_state, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
               $24, $25, $26, $27, $28, $29, $30, $31,
               COALESCE($32::timestamptz, now()))
       ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        input.event_id ?? null,
        input.agent_id,
        input.project ?? null,
        input.seat_id ?? null,
        input.host ?? null,
        input.host_id ?? null,
        input.host_adapter_id ?? null,
        input.session_id ?? null,
        input.marker_id ?? null,
        input.marker_digest ?? null,
        input.marker_path ?? null,
        input.marker_status ?? null,
        input.attempt_ordinal ?? null,
        input.phase ?? null,
        input.payload_digest ?? null,
        input.action,
        input.restart_required ?? false,
        input.executed_restart ?? false,
        input.band ?? null,
        input.context_tokens ?? null,
        input.context_window_tokens ?? null,
        input.context_used_ratio ?? null,
        input.thresholds ?? {},
        input.queue_check_mode ?? null,
        input.queue_check_result ?? null,
        input.preflight_status ?? null,
        input.restart_command ?? null,
        input.failure_reason ?? null,
        input.pre_state ?? {},
        input.post_state ?? {},
        {
          ...(input.metadata ?? {}),
          ...(input.event_id ? { persistence_result: "inserted", inserted: true, collision: false } : {}),
        },
        input.created_at ?? null,
      ]
    );
    if (!result.rows[0] && input.event_id) {
      const existing = await this.pool.query(
        `SELECT * FROM restart_events WHERE event_id = $1 LIMIT 1`,
        [input.event_id]
      );
      if (existing.rows[0]) {
        const event = this.rowToRestartEvent(existing.rows[0]);
        const sameDigest = (event.payload_digest ?? "") === (input.payload_digest ?? "");
        return {
          ...event,
          metadata: {
            ...event.metadata,
            persistence_result: sameDigest ? "idempotent" : "event_id_collision",
            inserted: false,
            collision: !sameDigest,
          },
        };
      }
    }
    return this.rowToRestartEvent(result.rows[0]);
  }

  async getRestartEvents(input: GetRestartEventsInput): Promise<RestartEvent[]> {
    const result = await this.pool.query(
      `SELECT * FROM restart_events
       WHERE agent_id = $1
         AND ($2::text IS NULL OR project = $2)
       ORDER BY created_at DESC, COALESCE(event_id, id::text) DESC
       LIMIT $3`,
      [input.agent_id, input.project ?? null, input.limit ?? 20]
    );
    return result.rows.map(this.rowToRestartEvent);
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

  async supersedeKnowledge(
    input: SupersedeKnowledgeInput
  ): Promise<{ old: Knowledge; new: Knowledge }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const oldResult = await client.query(
        "SELECT * FROM knowledge WHERE id = $1 AND agent_id = $2",
        [input.old_id, input.agent_id]
      );
      if (oldResult.rows.length === 0) {
        throw new Error(`Knowledge not found: ${input.old_id}`);
      }
      const oldRow = oldResult.rows[0];

      const newId = uuidv4();
      const newResult = await client.query(
        `INSERT INTO knowledge
           (id, agent_id, project, title, content, source_type, tags, supersedes, supersede_reason)
         VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7, $8)
         RETURNING *`,
        [
          newId,
          input.agent_id,
          input.project ?? oldRow.project,
          input.new_title,
          input.new_content,
          input.tags ?? oldRow.tags,
          input.old_id,
          input.reason,
        ]
      );

      // AM-024 follow-up (#66 item 2): the SELECT above already
      // checks `agent_id`, and we're inside a transaction, so the
      // existing `WHERE id = $1` is safe in practice. We add the
      // `agent_id` filter anyway so the UPDATE matches the SELECT
      // and the query is robustly isolated even if the surrounding
      // transaction structure changes in the future.
      const updatedOld = await client.query(
        `UPDATE knowledge SET status = 'superseded', updated_at = now()
         WHERE id = $1 AND agent_id = $2 RETURNING *`,
        [input.old_id, input.agent_id]
      );

      await client.query("COMMIT");
      return {
        old: this.rowToKnowledge(updatedOld.rows[0]),
        new: this.rowToKnowledge(newResult.rows[0]),
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Catch-up Log (AM-026) — stub pending pg migration ──────────

  async getLastCatchUpLog(
    _agent_id: string,
    _source: "conversation" | "discord"
  ): Promise<CatchUpLog | null> {
    // TODO AM-026: implement catch_up_log table in pg-store
    return null;
  }

  async saveCatchUpLog(_input: SaveCatchUpLogInput): Promise<CatchUpLog> {
    // TODO AM-026: implement catch_up_log table in pg-store
    throw new Error("saveCatchUpLog not yet implemented in PgStore");
  }

  async isCatchUpDuplicate(_input: {
    agent_id: string;
    content_hash: string;
    event_at: string;
  }): Promise<boolean> {
    // TODO AM-026: implement catch_up_log table in pg-store
    return false;
  }

  async getFailedCatchUpLogs(
    _agent_id: string,
    _source: "conversation" | "discord"
  ): Promise<CatchUpLog[]> {
    // TODO AM-026: implement catch_up_log table in pg-store
    return [];
  }

  // ─── Kusabi partition registry (CELL-4MCP-KUSABI-001) ─────────

  async getKusabiPartition(
    input: GetKusabiPartitionInput
  ): Promise<KusabiPartition | null> {
    const result = await this.pool.query(
      `SELECT * FROM kusabi_agent_memory_partitions
        WHERE agent_id = $1 AND memory_project = $2
        LIMIT 1`,
      [input.agent_id, input.memory_project]
    );
    return result.rows[0] ? this.rowToKusabiPartition(result.rows[0]) : null;
  }

  async upsertKusabiPartition(
    input: UpsertKusabiPartitionInput
  ): Promise<KusabiPartition> {
    // Fail-closed: anything other than an explicit "shared" resolves to
    // "private" (the most restrictive visibility).
    const visibility = input.default_visibility === "shared" ? "shared" : "private";
    const result = await this.pool.query(
      `INSERT INTO kusabi_agent_memory_partitions
        (agent_id, memory_project, partition_key, default_visibility,
         retention_policy_ref, recovery_config_ref, source_capture_policy_ref, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (agent_id, memory_project) DO UPDATE SET
         partition_key = excluded.partition_key,
         default_visibility = excluded.default_visibility,
         retention_policy_ref = excluded.retention_policy_ref,
         recovery_config_ref = excluded.recovery_config_ref,
         source_capture_policy_ref = excluded.source_capture_policy_ref,
         updated_at = now()
       RETURNING *`,
      [
        input.agent_id,
        input.memory_project,
        input.partition_key,
        visibility,
        input.retention_policy_ref ?? null,
        input.recovery_config_ref ?? null,
        input.source_capture_policy_ref ?? null,
      ]
    );
    return this.rowToKusabiPartition(result.rows[0]);
  }

  async listKusabiPartitions(agent_id: string): Promise<KusabiPartition[]> {
    const result = await this.pool.query(
      `SELECT * FROM kusabi_agent_memory_partitions
        WHERE agent_id = $1
        ORDER BY updated_at DESC`,
      [agent_id]
    );
    return result.rows.map((row) => this.rowToKusabiPartition(row));
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
      task_id: (row.task_id as string | null) ?? undefined,
      task: row.task as string,
      status: row.status as TaskState["status"],
      progress: row.progress as string | undefined,
      files_modified: (row.files_modified as string[]) || [],
      next_steps: row.next_steps as string | undefined,
      created_at:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : (row.created_at as string),
      updated_at:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : ((row.updated_at as string | null) ?? undefined),
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
      supersedes: row.supersedes as string | undefined,
      supersede_reason: row.supersede_reason as string | undefined,
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

  private rowToConversationEvent(row: Record<string, unknown>): ConversationEvent {
    return {
      id: row.id as string,
      agent_id: row.agent_id as string,
      project: row.project as string | undefined,
      source: row.source as ConversationEvent["source"],
      source_event_id: row.source_event_id as string | undefined,
      source_path: row.source_path as string | undefined,
      role: row.role as string | undefined,
      content: row.content as string,
      content_hash: row.content_hash as string,
      metadata: (row.metadata as Record<string, unknown>) || {},
      occurred_at:
        row.occurred_at instanceof Date
          ? row.occurred_at.toISOString()
          : (row.occurred_at as string),
      created_at:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : (row.created_at as string),
    };
  }

  private rowToRawEvent(row: Record<string, unknown>): RawEvent {
    return {
      id: row.id as string,
      agent_id: row.agent_id as string,
      session_id: row.session_id as string | undefined,
      project: row.project as string | undefined,
      host: row.host as string | undefined,
      source: row.source as string,
      event_type: row.event_type as RawEvent["event_type"],
      role: row.role as string | undefined,
      content: (row.content as string | undefined) ?? (row.content_text as string | undefined),
      content_hash: (row.content_hash as string | null) ?? undefined,
      source_ref: (row.source_ref as Record<string, unknown>) || {},
      source_ref_hash: (row.source_ref_hash as string | null) ?? undefined,
      source_event_id: row.source_event_id as string | undefined,
      source_path: row.source_path as string | undefined,
      redaction_level: row.redaction_level as string | undefined,
      private_reasoning: row.private_reasoning as boolean | undefined,
      metadata: (row.metadata as Record<string, unknown>) || {},
      occurred_at:
        row.occurred_at instanceof Date
          ? row.occurred_at.toISOString()
          : row.event_at instanceof Date
            ? row.event_at.toISOString()
            : ((row.occurred_at as string | null) ?? (row.event_at as string)),
      created_at:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : row.ingested_at instanceof Date
            ? row.ingested_at.toISOString()
            : ((row.created_at as string | null) ?? (row.ingested_at as string)),
    };
  }

  private rowToSelectedRestartPack(row: Record<string, unknown>): SelectedRestartPack {
    return {
      id: row.id as string,
      agent_id: row.agent_id as string,
      project: (row.project as string | null) ?? undefined,
      pack_ref: row.pack_ref as string,
      content: row.content as string,
      content_hash: row.content_hash as string,
      status: row.status as SelectedRestartPack["status"],
      source: row.source as SelectedRestartPack["source"],
      metadata: (row.metadata as Record<string, unknown>) || {},
      created_at:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : (row.created_at as string),
      consumed_at:
        row.consumed_at instanceof Date
          ? row.consumed_at.toISOString()
          : ((row.consumed_at as string | null) ?? undefined),
      expires_at:
        row.expires_at instanceof Date
          ? row.expires_at.toISOString()
          : ((row.expires_at as string | null) ?? undefined),
    };
  }

  private rowToKusabiPartition(row: Record<string, unknown>): KusabiPartition {
    return {
      agent_id: row.agent_id as string,
      memory_project: row.memory_project as string,
      partition_key: row.partition_key as string,
      default_visibility:
        (row.default_visibility as string) === "shared" ? "shared" : "private",
      retention_policy_ref: (row.retention_policy_ref as string | null) ?? undefined,
      recovery_config_ref: (row.recovery_config_ref as string | null) ?? undefined,
      source_capture_policy_ref:
        (row.source_capture_policy_ref as string | null) ?? undefined,
      updated_at:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : (row.updated_at as string),
    };
  }

  private rowToRestartEvent(row: Record<string, unknown>): RestartEvent {
    return {
      id: row.id as string,
      event_id: (row.event_id as string | null) ?? undefined,
      agent_id: row.agent_id as string,
      project: (row.project as string | null) ?? undefined,
      seat_id: (row.seat_id as string | null) ?? undefined,
      host: (row.host as string | null) ?? undefined,
      host_id: (row.host_id as string | null) ?? undefined,
      host_adapter_id: (row.host_adapter_id as string | null) ?? undefined,
      session_id: (row.session_id as string | null) ?? undefined,
      marker_id: (row.marker_id as string | null) ?? undefined,
      marker_digest: (row.marker_digest as string | null) ?? undefined,
      marker_path: (row.marker_path as string | null) ?? undefined,
      marker_status: (row.marker_status as string | null) ?? undefined,
      attempt_ordinal: (row.attempt_ordinal as number | null) ?? undefined,
      phase: (row.phase as string | null) ?? undefined,
      payload_digest: (row.payload_digest as string | null) ?? undefined,
      action: row.action as string,
      restart_required: row.restart_required === true,
      executed_restart: row.executed_restart === true,
      band: (row.band as string | null) ?? undefined,
      context_tokens: (row.context_tokens as number | null) ?? undefined,
      context_window_tokens: (row.context_window_tokens as number | null) ?? undefined,
      context_used_ratio: (row.context_used_ratio as number | null) ?? undefined,
      thresholds: asRecord(row.thresholds),
      queue_check_mode: (row.queue_check_mode as string | null) ?? undefined,
      queue_check_result: (row.queue_check_result as string | null) ?? undefined,
      preflight_status: (row.preflight_status as string | null) ?? undefined,
      restart_command: (row.restart_command as string | null) ?? undefined,
      failure_reason: (row.failure_reason as string | null) ?? undefined,
      pre_state: asRecord(row.pre_state),
      post_state: asRecord(row.post_state),
      metadata: asRecord(row.metadata),
      created_at:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : (row.created_at as string),
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
