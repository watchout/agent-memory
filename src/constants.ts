import type { RecoveryConfig } from "./stores/types.js";

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
  // Priority order: first items are kept, last items are cut first
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
      // Partial fit: truncate this section to remaining budget
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
