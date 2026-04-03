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
  task: string;
  status: "in_progress" | "completed" | "blocked";
  progress?: string;
  files_modified: string[];
  next_steps?: string;
  created_at: string;
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

  /** Close connections */
  close(): Promise<void>;
}
