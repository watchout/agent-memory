import type { RecoveryConfig, Decision, TaskState, Knowledge, AgentMessage } from "./stores/types.js";
import { redactText } from "./redact.js";

/**
 * Default recovery config used when no recovery_config record exists in DB.
 * Matches SSOT-4 defaults: Dev Bot equivalent (lightweight recovery).
 */
export const DEFAULT_RECOVERY_CONFIG: Omit<RecoveryConfig, "agent_id"> = {
  max_tokens: 1500,
  task_states_limit: 2,
  decisions_limit: 3,
  knowledge_limit: 3,
  messages_limit: 5,
  discord_history_limit: 0,
  discord_channels: [],
  restart_message_threshold: 100,
};

export const SEARCH_MEMORY_TOOL_DESCRIPTION =
  "Search agent memory by keyword or natural language. Use this as the adaptive retrieval layer: call it before making architectural or design decisions, when project context is unfamiliar, when restart_pack feels incomplete, when memory and external state may conflict, or before asking the user to restate context. For missing recent conversation after restart, use scope=conversation with focused queries. PR/status answers must be verified with the relevant external SSOT before acting.";

export const RECOVERY_CONTROL_LINES = [
  "Treat this boot context as Layer 1 recovery only.",
  "Before architectural/design decisions, unfamiliar project context, or contradiction risk, run search_memory before acting.",
  "If restart_pack is incomplete, use search_memory scope=conversation with focused queries before asking the user to restate context.",
  "Treat PR/status memory as context only; verify with the external SSOT before merging or making status claims.",
];

export const RECOVERY_CONTROL_SECTION = [
  "RECOVERY CONTROL",
  ...RECOVERY_CONTROL_LINES.map((line) => `- ${line}`),
].join("\n");

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
  const priorityOrder = ["task", "decisions", "messages", "discord", "knowledge"];
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
  discordHistory?: string[];
}): string {
  const { agentId, project, config, inProgressTasks, completedTasks, decisions, knowledgeItems, messages, discordHistory } = params;

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

  // Discord history section (FEAT-026)
  const discordLines: string[] = [];
  if (discordHistory && discordHistory.length > 0) {
    discordLines.push("── DISCORD HISTORY ──");
    discordLines.push(...discordHistory);
  }

  // Knowledge section (lowest priority for truncation)
  const knowledgeLines: string[] = [];
  if (knowledgeItems.length > 0) {
    knowledgeLines.push("── KEY KNOWLEDGE ──");
    for (const k of knowledgeItems) {
      knowledgeLines.push(`• ${k.title}`);
    }
  }

  const footer = RECOVERY_CONTROL_SECTION;

  const sections = [
    { key: "task", content: taskLines.join("\n") },
    { key: "decisions", content: decisionLines.join("\n") },
    { key: "messages", content: messageLines.join("\n") },
    { key: "discord", content: discordLines.join("\n") },
    { key: "knowledge", content: knowledgeLines.join("\n") },
  ].filter(s => s.content.length > 0);

  const headerText = header.join("\n");
  const maxTokens = "max_tokens" in config ? config.max_tokens : 1000;
  const bodyBudget = maxTokens - estimateTokens(headerText) - estimateTokens(footer);
  const bodyParts = truncateByPriority(sections, Math.max(bodyBudget, 100));

  return redactText([headerText, ...bodyParts, "", footer].join("\n")).text;
}
