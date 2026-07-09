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
  status: "active" | "merged" | "archived" | "superseded";
  merged_into?: string;
  /** AM-024: ID of the older knowledge entry this one supersedes (new → old reference). */
  supersedes?: string;
  /** AM-024: Reason for superseding the old entry. */
  supersede_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface SupersedeKnowledgeInput {
  agent_id: string;
  /** ID of the knowledge entry being superseded. */
  old_id: string;
  new_title: string;
  new_content: string;
  /** Why the old knowledge entry is being superseded. */
  reason: string;
  tags?: string[];
  project?: string;
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
  status?: "active" | "merged" | "archived" | "superseded" | "all";
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

export interface ConversationEvent {
  id: string;
  agent_id: string;
  project?: string;
  source: "claude_code" | "codex" | "manual";
  source_event_id?: string;
  source_path?: string;
  role?: string;
  content: string;
  content_hash: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export interface RawEvent {
  id: string;
  agent_id: string;
  session_id?: string;
  project?: string;
  host?: string;
  source: string;
  event_type:
    | "user_message"
    | "assistant_message"
    | "tool_call"
    | "tool_result"
    | "file_ref"
    | "context_ref"
    | "host_event"
    | "runtime_event";
  role?: string;
  content?: string;
  content_hash?: string;
  source_ref?: Record<string, unknown>;
  source_ref_hash?: string;
  source_event_id?: string;
  source_path?: string;
  redaction_level?: string;
  private_reasoning?: boolean;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export interface SaveRawEventInput {
  agent_id: string;
  session_id?: string;
  project?: string;
  host?: string;
  source: string;
  event_type: RawEvent["event_type"];
  role?: string;
  content?: string;
  content_hash?: string;
  source_ref?: Record<string, unknown>;
  redaction_level?: string;
  private_reasoning?: boolean;
  source_event_id?: string;
  source_path?: string;
  metadata?: Record<string, unknown>;
  occurred_at?: string;
}

export interface GetRawEventsInput {
  agent_id: string;
  session_id?: string;
  project?: string;
  source?: string;
  event_type?: RawEvent["event_type"];
  since?: string;
  limit?: number;
}

// ─── AM-026: Catch-up ledger types ──────────────────────────────────────────

/**
 * A row in the `catch_up_log` ledger table. Each row records
 * the outcome of a single catch-up event attempt.
 *
 * `status` semantics (design draft 3/3):
 *   - `inserted`: target-table row was written. **Only this status
 *     triggers dedup** via `isCatchUpDuplicate`.
 *   - `skipped`: dedup hit on a previous `inserted` row. Written as
 *     forensic trail; does NOT prevent future inserts.
 *   - `failed`: target-table insert threw an exception. Does NOT
 *     prevent retry runs (retry path walks failed rows explicitly).
 *
 * A `dry_run` sweep writes **no** ledger rows at all.
 */
export interface CatchUpLog {
  id: string;
  agent_id: string;
  source: "conversation" | "discord";
  content_hash: string;
  target_table: "decisions" | "task_states" | "knowledge";
  target_id?: string;
  status: "inserted" | "skipped" | "failed";
  content_preview?: string;
  event_at: string;
  created_at: string;
}

export interface CatchUpInput {
  since?: string;
  source?: "conversation" | "discord" | "all";
  dry_run?: boolean;
}

export interface CatchUpResult {
  caught: { decisions: number; task_states: number; knowledge: number };
  skipped: number;
  last_checked: string;
}

export interface SaveCatchUpLogInput {
  agent_id: string;
  source: "conversation" | "discord";
  content_hash: string;
  target_table: "decisions" | "task_states" | "knowledge";
  target_id?: string;
  status: "inserted" | "skipped" | "failed";
  content_preview?: string;
  event_at: string;
}

export interface SaveConversationEventInput {
  agent_id: string;
  project?: string;
  source: "claude_code" | "codex" | "manual";
  source_event_id?: string;
  source_path?: string;
  role?: string;
  content: string;
  content_hash?: string;
  metadata?: Record<string, unknown>;
  occurred_at?: string;
}

export interface GetConversationEventsInput {
  agent_id: string;
  project?: string;
  source?: "claude_code" | "codex" | "manual";
  since?: string;
  limit?: number;
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

export interface SelectedRestartPack {
  id: string;
  agent_id: string;
  project?: string;
  pack_ref: string;
  content: string;
  content_hash: string;
  status: "active" | "consumed" | "expired";
  source: "restart_prepare" | "manual";
  metadata: Record<string, unknown>;
  created_at: string;
  consumed_at?: string;
  expires_at?: string;
}

export interface SaveSelectedRestartPackInput {
  agent_id: string;
  project?: string;
  content: string;
  source?: "restart_prepare" | "manual";
  metadata?: Record<string, unknown>;
  expires_at?: string;
}

export interface GetSelectedRestartPackInput {
  agent_id: string;
  pack_ref: string;
  project?: string;
}

export interface ConsumeSelectedRestartPackInput extends GetSelectedRestartPackInput {
  consumed_at?: string;
}

export interface RestartEvent {
  id: string;
  agent_id: string;
  project?: string;
  seat_id?: string;
  host?: string;
  session_id?: string;
  marker_path?: string;
  marker_status?: string;
  action: string;
  restart_required: boolean;
  executed_restart: boolean;
  band?: string;
  context_tokens?: number;
  context_window_tokens?: number;
  context_used_ratio?: number;
  thresholds?: Record<string, unknown>;
  queue_check_mode?: string;
  queue_check_result?: string;
  preflight_status?: string;
  restart_command?: string;
  failure_reason?: string;
  pre_state?: Record<string, unknown>;
  post_state?: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SaveRestartEventInput {
  agent_id: string;
  project?: string;
  seat_id?: string;
  host?: string;
  session_id?: string;
  marker_path?: string;
  marker_status?: string;
  action: string;
  restart_required?: boolean;
  executed_restart?: boolean;
  band?: string;
  context_tokens?: number;
  context_window_tokens?: number;
  context_used_ratio?: number;
  thresholds?: Record<string, unknown>;
  queue_check_mode?: string;
  queue_check_result?: string;
  preflight_status?: string;
  restart_command?: string;
  failure_reason?: string;
  pre_state?: Record<string, unknown>;
  post_state?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface GetRestartEventsInput {
  agent_id: string;
  project?: string;
  limit?: number;
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
  scope?: "decisions" | "tasks" | "knowledge" | "messages" | "conversation" | "all";
  limit?: number;
  project?: string;
}

export interface SearchMemoryResult {
  decisions: Decision[];
  task_states: TaskState[];
  knowledge: Knowledge[];
  messages: AgentMessage[];
  conversation_events: ConversationEvent[];
}

// ─── CELL-4MCP-KUSABI-001: agent memory partition registry ──────────────────
//
// Lane 3 (Kusabi) of SPEC-4MCP-002. `kusabi_agent_memory_partitions` is this
// MCP's OWN table — the single source of truth for partition + visibility.
//
// Frozen invariants (dispatch anchor: watchout/agent-memory#247):
//   - `agent_id` is the immutable, only identity key.
//   - Partition / visibility are NEVER inferred from shared identity metadata
//     held by peer MCPs; they are resolved exclusively from this table.
//   - Absence of an own-table row fails CLOSED (most restrictive visibility),
//     never open and never inferred. See `resolvePartition` in
//     src/kusabi-partitions.ts.

/** Fail-closed default = "private" (most restrictive). */
export type PartitionVisibility = "private" | "shared";

export interface KusabiPartition {
  /** Immutable, only identity key (frozen common condition). */
  agent_id: string;
  memory_project: string;
  partition_key: string;
  default_visibility: PartitionVisibility;
  retention_policy_ref?: string;
  recovery_config_ref?: string;
  source_capture_policy_ref?: string;
  updated_at: string;
}

export interface UpsertKusabiPartitionInput {
  agent_id: string;
  memory_project: string;
  partition_key: string;
  /** Omitted → "private" (fail-closed). Any non-"shared" value → "private". */
  default_visibility?: PartitionVisibility;
  retention_policy_ref?: string;
  recovery_config_ref?: string;
  source_capture_policy_ref?: string;
}

export interface GetKusabiPartitionInput {
  agent_id: string;
  memory_project: string;
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

  /** Search decisions, task_states, knowledge, and redacted conversation events by keyword */
  searchMemory(input: SearchMemoryInput): Promise<SearchMemoryResult>;

  /** Get recent messages from agent_messages table (com integration, optional) */
  getRecentMessages(input: { agent_id: string; project?: string; limit?: number }): Promise<AgentMessage[]>;

  /** Persist a redacted full-text conversation/log event for later extraction and replay (AM-031) */
  saveConversationEvent(input: SaveConversationEventInput): Promise<ConversationEvent>;

  /** Read redacted full-text conversation/log events in newest-first order (AM-031) */
  getConversationEvents(input: GetConversationEventsInput): Promise<ConversationEvent[]>;

  /** Persist a source-bearing raw event in the canonical ledger (AM-103 first slice) */
  saveRawEvent(input: SaveRawEventInput): Promise<RawEvent>;

  /** Read canonical raw events in newest-first order (AM-103 first slice) */
  getRawEvents(input: GetRawEventsInput): Promise<RawEvent[]>;

  /** Save a knowledge entry (v0.3.0) */
  saveKnowledge(input: SaveKnowledgeInput): Promise<Knowledge>;

  /** Get knowledge entries with optional filters (v0.3.0) */
  getKnowledge(input: GetKnowledgeInput): Promise<Knowledge[]>;

  /** Update knowledge entry status (v0.5.0) */
  updateKnowledgeStatus(input: { id: string; agent_id: string; status: "active" | "merged" | "archived" | "superseded"; merged_into?: string }): Promise<Knowledge>;

  /** Supersede an old knowledge entry with a new one (AM-024) */
  supersedeKnowledge(input: SupersedeKnowledgeInput): Promise<{ old: Knowledge; new: Knowledge }>;

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

  /** Persist a selected restart pack for later host/AUN boot consume (AM-039) */
  saveSelectedRestartPack(input: SaveSelectedRestartPackInput): Promise<SelectedRestartPack>;

  /** Fetch an active selected restart pack by reference without consuming it (AM-039) */
  getSelectedRestartPack(input: GetSelectedRestartPackInput): Promise<SelectedRestartPack | null>;

  /** Fetch and mark a selected restart pack as consumed (AM-039) */
  consumeSelectedRestartPack(input: ConsumeSelectedRestartPackInput): Promise<SelectedRestartPack | null>;

  /** Persist durable evidence for automated restart decisions and attempts. */
  saveRestartEvent(input: SaveRestartEventInput): Promise<RestartEvent>;

  /** Read restart event evidence in newest-first order. */
  getRestartEvents(input: GetRestartEventsInput): Promise<RestartEvent[]>;

  // ─── AM-026: Catch-up ledger methods ────────────────────────────────────

  /** Get the most recent catch_up_log row for an agent+source pair. */
  getLastCatchUpLog(agent_id: string, source: "conversation" | "discord"): Promise<CatchUpLog | null>;

  /** Append a catch_up_log row reflecting the outcome of one sweep event. */
  saveCatchUpLog(input: SaveCatchUpLogInput): Promise<CatchUpLog>;

  /**
   * Return true iff a `status='inserted'` row exists within a ±60s window
   * around `event_at` for the given (agent_id, content_hash) pair.
   * Only `inserted` rows count; `skipped` and `failed` do not.
   */
  isCatchUpDuplicate(input: { agent_id: string; content_hash: string; event_at: string }): Promise<boolean>;

  /** Return all `status='failed'` rows for an agent+source, ordered by event_at ASC. */
  getFailedCatchUpLogs(agent_id: string, source: "conversation" | "discord"): Promise<CatchUpLog[]>;

  // ─── CELL-4MCP-KUSABI-001: agent memory partition registry ──────────────

  /**
   * Read this agent's own partition row for a memory_project, or null.
   * The ONLY sanctioned source for partition/visibility resolution —
   * see `resolvePartition` (src/kusabi-partitions.ts).
   */
  getKusabiPartition(input: GetKusabiPartitionInput): Promise<KusabiPartition | null>;

  /** Upsert (insert or replace) this agent's own partition row, keyed on (agent_id, memory_project). */
  upsertKusabiPartition(input: UpsertKusabiPartitionInput): Promise<KusabiPartition>;

  /** List all partition rows owned by an agent, newest-updated first. */
  listKusabiPartitions(agent_id: string): Promise<KusabiPartition[]>;

  /** Close connections */
  close(): Promise<void>;
}
