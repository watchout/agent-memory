#!/usr/bin/env node
/**
 * SessionStart hook script for agent-memory.
 * Outputs integrated recovery context to stdout.
 * Runs standalone (not as MCP server) — exits after output.
 */
import { createStore } from "./stores/index.js";
import { DEFAULT_RECOVERY_CONFIG, truncateByPriority } from "./constants.js";

const AGENT_ID = process.env.AGENT_MEMORY_AGENT_ID || "default";
const PROJECT = process.env.AGENT_MEMORY_PROJECT || undefined;

async function boot() {
  const store = await createStore();

  try {
    // Load per-agent config from DB, fall back to defaults
    const dbConfig = await store.getRecoveryConfig(AGENT_ID);
    const cfg = dbConfig ?? { ...DEFAULT_RECOVERY_CONFIG, agent_id: AGENT_ID };

    const [inProgressTasks, completedTasks, decisions, knowledgeItems, messages] = await Promise.all([
      store.getTaskStates({
        agent_id: AGENT_ID,
        project: PROJECT,
        limit: 1,
        status: "in_progress",
      }),
      store.getTaskStates({
        agent_id: AGENT_ID,
        project: PROJECT,
        limit: Math.max(cfg.task_states_limit - 1, 0),
        status: "completed",
      }),
      store.getDecisions({
        agent_id: AGENT_ID,
        project: PROJECT,
        limit: cfg.decisions_limit,
        status: "active",
      }),
      store.getKnowledge({
        agent_id: AGENT_ID,
        project: PROJECT,
        limit: cfg.knowledge_limit,
        status: "active",
      }),
      store.getRecentMessages({
        agent_id: AGENT_ID,
        project: PROJECT,
        limit: cfg.messages_limit,
      }),
    ]);

    // Build sections for priority-based truncation
    const header: string[] = [];
    header.push(`⚡ SESSION BOOT — agent-memory (${AGENT_ID})`);
    if (PROJECT) header.push(`Project: ${PROJECT}`);
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

    // Truncate by priority: task > decisions > messages > knowledge
    const sections = [
      { key: "task", content: taskLines.join("\n") },
      { key: "decisions", content: decisionLines.join("\n") },
      { key: "messages", content: messageLines.join("\n") },
      { key: "knowledge", content: knowledgeLines.join("\n") },
    ].filter(s => s.content.length > 0);

    const headerText = header.join("\n");
    const bodyBudget = cfg.max_tokens - Math.ceil(headerText.length / 4) - Math.ceil(footer.length / 4);
    const bodyParts = truncateByPriority(sections, Math.max(bodyBudget, 100));

    const output = [headerText, ...bodyParts, "", footer].join("\n");

    // Output to stdout — hook output is injected into session context
    console.log(output);
  } finally {
    await store.close();
  }
}

boot().catch((err) => {
  console.error("[agent-memory boot] Error:", err);
  process.exit(1);
});
