/**
 * Storage abstraction layer for agent-memory.
 * Defines the interface that both PostgreSQL and JSON file stores implement.
 */

export interface Decision {
  id: string;
  agent_id: string;
  project?: string;
  decision: string;
  context?: string;
  tags: string[];
  status: "active" | "superseded" | "revoked";
  superseded_by?: string;
  created_at: string;
}

export interface TaskState {
  id: string;
  agent_id: string;
  project?: string;
  /**
   * AM-023: stable identifier for a task lifecycle.
   * Holds a ticket id (e.g. "AM-023") when one is detected, otherwise
   * a 16-hex prefix of SHA-256(task description). UNIQUE per agent_id.
   * Optional in the type for backward compat with rows migrated from
   * the pre-AM-023 schema (where it is back-filled to equal `task`).
   */
  task_id?: string;
  task: string;
  status: "in_progress" | "completed" | "blocked" | "expired";
  progress?: string;
  files_modified: string[];
  next_steps?: string;
  created_at: string;
  /** AM-023: timestamp of the last UPSERT. Falls back to created_at on legacy rows. */
  updated_at?: string;
}

export interface LogDecisionInput {
  agent_id: string;
  decision: string;
  context?: string;
  tags?: string[];
  project?: string;
}

export interface GetDecisionsInput {
  agent_id: string;
  project?: string;
  tags?: string[];
  limit?: number;
  status?: "active" | "superseded" | "all";
}

export interface SupersedeDecisionInput {
  agent_id: string;
  old_decision_id: string;
  new_decision: string;
  context?: string;
  tags?: string[];
  project?: string;
}

export interface SaveTaskStateInput {
  agent_id: string;
  /**
   * AM-023: stable identifier for the task lifecycle. When supplied
   * (typically by post-tool-hook from a ticket id like "AM-023"),
   * subsequent saves with the same (agent_id, task_id) UPSERT the
   * same row instead of creating duplicates. When omitted, stores
   * derive a fallback id from a SHA-256 prefix of `task`.
   */
  task_id?: string;
  task: string;
  status: "in_progress" | "completed" | "blocked";
  progress?: string;
  files_modified?: string[];
  next_steps?: string;
  project?: string;
}

export interface GetTaskStatesInput {
  agent_id: string;
  project?: string;
  limit?: number;
  status?: "in_progress" | "completed" | "blocked" | "all";
}

export interface Knowledge {
  id: string;
  agent_id: string;
  project?: string;
  title: string;
  content: string;
  source_type: "decisions" | "messages" | "manual";
  source_ids: string[];
  tags: string[];
  status: "active" | "merged" | "archived";
  merged_into?: string;
  created_at: string;
  updated_at: string;
}

export interface SaveKnowledgeInput {
  agent_id: string;
  project?: string;
  title: string;
  content: string;
  source_type: "decisions" | "messages" | "manual";
  source_ids?: string[];
  tags?: string[];
}

export interface GetKnowledgeInput {
  agent_id: string;
  project?: string;
  limit?: number;
  status?: "active" | "merged" | "archived" | "all";
  tags?: string[];
}

export interface AgentMessage {
  id: string;
  author_id: string;
  content: string;
  source: string;
  channel_id?: string;
  role: string;
  project?: string;
  created_at: string;
}

export interface RecoveryConfig {
  agent_id: string;
  max_tokens: number;
  task_states_limit: number;
  decisions_limit: number;
  knowledge_limit: number;
  messages_limit: number;
  discord_history_limit: number;
  discord_channels: string[];
  restart_message_threshold: number;
}

/**
 * Input for logRecoveryQuality (AM-002, Stage 1).
 *
 * Stage 1 fields: agent_id, session_id, recovered_tokens (existing).
 * AM-002 additions are all optional so existing callers keep working
 * unchanged. The actual `quality_score` algorithm is deferred to AM-018.
 */
export interface LogRecoveryQualityInput {
  agent_id: string;
  session_id?: string;
  recovered_tokens: number;
  task_continued?: boolean;
  quality_score?: number;
  notes?: string;
  search_memory_count_10min?: number;
}

export interface SearchMemoryInput {
  agent_id: string;
  query: string;
  scope?: "decisions" | "tasks" | "knowledge" | "messages" | "all";
  limit?: number;
  project?: string;
}

export interface SearchMemoryResult {
  decisions: Decision[];
  task_states: TaskState[];
  knowledge: Knowledge[];
  messages: AgentMessage[];
}

export interface Store {
  /** Initialize the store (create tables/files if needed) */
  initialize(): Promise<void>;

  /** Log a new decision */
  logDecision(input: LogDecisionInput): Promise<Decision>;

  /** Get decisions with optional filters */
  getDecisions(input: GetDecisionsInput): Promise<Decision[]>;

  /** Supersede an old decision with a new one */
  supersedeDecision(input: SupersedeDecisionInput): Promise<{ old: Decision; new: Decision }>;

  /** Save current task state */
  saveTaskState(input: SaveTaskStateInput): Promise<TaskState>;

  /** Get task states with optional filters */
  getTaskStates(input: GetTaskStatesInput): Promise<TaskState[]>;

  /** Search decisions, task_states, and knowledge by keyword */
  searchMemory(input: SearchMemoryInput): Promise<SearchMemoryResult>;

  /** Get recent messages from agent_messages table (com integration, optional) */
  getRecentMessages(input: { agent_id: string; project?: string; limit?: number }): Promise<AgentMessage[]>;

  /** Save a knowledge entry (v0.3.0) */
  saveKnowledge(input: SaveKnowledgeInput): Promise<Knowledge>;

  /** Get knowledge entries with optional filters (v0.3.0) */
  getKnowledge(input: GetKnowledgeInput): Promise<Knowledge[]>;

  /** Update knowledge entry status (v0.5.0) */
  updateKnowledgeStatus(input: { id: string; agent_id: string; status: "active" | "merged" | "archived"; merged_into?: string }): Promise<Knowledge>;

  /** Get recovery config for an agent (v0.4.0, FEAT-015) */
  getRecoveryConfig(agent_id: string): Promise<RecoveryConfig | null>;

  /** Expire stale in_progress tasks older than max_age_days (v0.5.0, FEAT-037) */
  expireStaleTaskStates(input: { agent_id: string; max_age_days: number }): Promise<number>;

  /** Upsert recovery config for an agent (v0.5.0, FEAT-014+015) */
  upsertRecoveryConfig(input: {
    agent_id: string;
    max_tokens?: number;
    task_states_limit?: number;
    decisions_limit?: number;
    knowledge_limit?: number;
    messages_limit?: number;
  }): Promise<RecoveryConfig>;

  /** Log recovery quality metrics (v0.4.0, FEAT-024 / AM-002 Stage 1) */
  logRecoveryQuality(input: LogRecoveryQualityInput): Promise<string>;

  /** Update search_memory count on a recovery quality log entry (v0.4.0, FEAT-024) */
  updateSearchMemoryCount(log_id: string, count: number): Promise<void>;

  /** Close connections */
  close(): Promise<void>;
}
