import type { RecoveryConfig, Store, TaskState } from "./stores/types.js";
import { isReadableConversation } from "./memory-source.js";

/** A caution window for status-bearing checkpoints, not a retention policy. */
export const RESTART_PACK_TASK_FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000;
export type TaskCheckpointFreshness = "fresh" | "stale" | "unknown" | "unavailable";

export function checkpointFreshness(
  task: Pick<TaskState, "updated_at" | "created_at"> | undefined,
  observedAt?: string,
): TaskCheckpointFreshness {
  if (!task) return "unavailable";
  const observed = Date.parse(observedAt ?? "");
  const checkpoint = Date.parse(task.updated_at ?? task.created_at);
  if (!Number.isFinite(observed) || !Number.isFinite(checkpoint) || observed < checkpoint) return "unknown";
  return observed - checkpoint > RESTART_PACK_TASK_FRESHNESS_WINDOW_MS ? "stale" : "fresh";
}

export function checkpointCaution(freshness: TaskCheckpointFreshness): string | undefined {
  if (freshness === "stale") return "FRESHNESS CAUTION\nThe current task checkpoint is older than the recovery freshness window. Treat status-bearing facts as unverified, use targeted search_memory when available, and verify external SSOT before acting.";
  if (freshness === "unknown") return "FRESHNESS UNKNOWN\nThe current task checkpoint freshness cannot be verified because its observation time or checkpoint time is missing, invalid, or future-skewed. Treat status-bearing facts as unverified, use targeted search_memory when available, and verify external SSOT before acting.";
  return undefined;
}

export interface RecoveryReadLimits {
  active: number;
  blocked: number;
  completed: number;
  decisions: number;
  knowledge: number;
  messages: number;
  conversation: number;
}

export function normalRecoveryLimits(config: Pick<RecoveryConfig, "task_states_limit" | "decisions_limit" | "knowledge_limit" | "messages_limit">): RecoveryReadLimits {
  return {
    active: 1, blocked: 0, completed: Math.max(config.task_states_limit - 1, 0),
    decisions: config.decisions_limit, knowledge: config.knowledge_limit, messages: config.messages_limit,
    conversation: Math.min(Math.max(config.messages_limit, 5), 20),
  };
}

/** Read bounded existing records. This is not an atomic database snapshot. */
export async function loadRecoveryContext(store: Store, input: {
  agent_id: string;
  project?: string;
  limits: RecoveryReadLimits;
}) {
  const { agent_id, project, limits } = input;
  const tasks = (status: "in_progress" | "blocked" | "completed", limit: number) =>
    limit === 0 ? Promise.resolve([] as TaskState[]) : store.getTaskStates({ agent_id, project, status, limit });
  const [activeTasks, blockedTasks, completedTasks, decisions, knowledge, messages, events] = await Promise.all([
    tasks("in_progress", limits.active), tasks("blocked", limits.blocked), tasks("completed", limits.completed),
    store.getDecisions({ agent_id, project, limit: limits.decisions, status: "active" }),
    store.getKnowledge({ agent_id, project, knowledge_scope: project ? "project_and_seat" : "legacy", limit: limits.knowledge, status: "active" }),
    limits.messages === 0 ? Promise.resolve([]) : store.getRecentMessages({ agent_id, project, limit: limits.messages }),
    store.getConversationEvents({ agent_id, project, limit: limits.conversation }),
  ]);
  return {
    activeTasks, blockedTasks, completedTasks, decisions, knowledge, messages,
    conversationEvents: events.filter(isReadableConversation),
    observedAt: new Date().toISOString(),
  };
}
