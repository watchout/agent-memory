import type { RecoveryConfig, Decision, TaskState, Knowledge, AgentMessage } from "./stores/types.js";

/**
 * Default recovery config used when no recovery_config record exists in DB.
 * Matches SSOT-4 defaults: Dev Bot equivalent (lightweight recovery).
 */
export const DEFAULT_RECOVERY_CONFIG: Omit<RecoveryConfig, "agent_id"> = {
  max_tokens: 1000,
  task_states_limit: 1,
  decisions_limit: 0,
  knowledge_limit: 3,
  messages_limit: 5,
  discord_history_limit: 5,
  discord_channels: [],
  restart_message_threshold: 100,
};

/**
 * Rough token estimation: ~4 chars per token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate recovery output to max_tokens, prioritizing:
 * task > decisions > messages > knowledge (per SSOT-3 §3-G #5)
 */
export function truncateByPriority(
  sections: { key: string; content: string }[],
  maxTokens: number
): string[] {
  const priorityOrder = ["task", "decisions", "messages", "knowledge"];
  const sorted = [...sections].sort(
    (a, b) => priorityOrder.indexOf(a.key) - priorityOrder.indexOf(b.key)
  );

  const result: string[] = [];
  let tokensUsed = 0;

  for (const section of sorted) {
    const sectionTokens = estimateTokens(section.content);
    if (tokensUsed + sectionTokens <= maxTokens) {
      result.push(section.content);
      tokensUsed += sectionTokens;
    } else {
      const remaining = maxTokens - tokensUsed;
      if (remaining > 20) {
        const charBudget = remaining * 4;
        result.push(section.content.slice(0, charBudget) + "\n…(truncated)");
      }
      break;
    }
  }

  return result;
}

/**
 * Build recovery output from fetched data + config.
 * Shared by recover_context (index.ts) and boot.ts.
 */
export function buildRecoveryOutput(params: {
  agentId: string;
  project?: string;
  config: RecoveryConfig | Omit<RecoveryConfig, "agent_id">;
  inProgressTasks: TaskState[];
  completedTasks: TaskState[];
  decisions: Decision[];
  knowledgeItems: Knowledge[];
  messages: AgentMessage[];
}): string {
  const { agentId, project, config, inProgressTasks, completedTasks, decisions, knowledgeItems, messages } = params;

  const header: string[] = [];
  header.push(`⚡ SESSION BOOT — agent-memory (${agentId})`);
  if (project) header.push(`Project: ${project}`);
  header.push("");

  // Task section (highest priority)
  const taskLines: string[] = [];
  if (inProgressTasks.length > 0 || completedTasks.length > 0) {
    taskLines.push("── CURRENT WORK ──");
    for (const t of inProgressTasks) {
      taskLines.push(`🔧 [${t.status}] ${t.task}`);
      if (t.progress) taskLines.push(`  Progress: ${t.progress}`);
      if (t.next_steps) taskLines.push(`  Next: ${t.next_steps}`);
      if (t.files_modified.length)
        taskLines.push(`  Files: ${t.files_modified.join(", ")}`);
    }
    for (const t of completedTasks) {
      taskLines.push(`✅ [completed] ${t.task}`);
    }
  } else {
    taskLines.push("No in-progress tasks.");
  }

  // Decisions section
  const decisionLines: string[] = [];
  if (decisions.length > 0) {
    decisionLines.push("── ACTIVE DECISIONS ──");
    for (const d of decisions) {
      decisionLines.push(`• ${d.decision}`);
    }
  }

  // Messages section
  const messageLines: string[] = [];
  if (messages.length > 0) {
    messageLines.push("── RECENT MESSAGES ──");
    for (const m of messages) {
      const ts = m.created_at.replace(/T/, " ").replace(/\.\d+Z$/, "");
      messageLines.push(`[${ts}] ${m.author_id}: ${m.content.slice(0, 200)}`);
    }
  }

  // Knowledge section (lowest priority for truncation)
  const knowledgeLines: string[] = [];
  if (knowledgeItems.length > 0) {
    knowledgeLines.push("── KEY KNOWLEDGE ──");
    for (const k of knowledgeItems) {
      knowledgeLines.push(`• ${k.title}`);
    }
  }

  const footer = "Use search_memory to find past decisions when needed.";

  const sections = [
    { key: "task", content: taskLines.join("\n") },
    { key: "decisions", content: decisionLines.join("\n") },
    { key: "messages", content: messageLines.join("\n") },
    { key: "knowledge", content: knowledgeLines.join("\n") },
  ].filter(s => s.content.length > 0);

  const headerText = header.join("\n");
  const maxTokens = "max_tokens" in config ? config.max_tokens : 1000;
  const bodyBudget = maxTokens - estimateTokens(headerText) - estimateTokens(footer);
  const bodyParts = truncateByPriority(sections, Math.max(bodyBudget, 100));

  return [headerText, ...bodyParts, "", footer].join("\n");
}
