import { homedir } from "os";
import { relative, isAbsolute } from "path";
import type { Store, ConversationEvent, Decision, Knowledge, TaskState } from "./stores/types.js";
import { DEFAULT_RECOVERY_CONFIG, estimateTokens } from "./constants.js";
import { redactText } from "./redact.js";

export interface RestartPackInput {
  agent_id: string;
  project?: string;
  max_tokens?: number;
}

export interface RestartPackData {
  agentId: string;
  project?: string;
  maxTokens: number;
  activeTasks: TaskState[];
  blockedTasks: TaskState[];
  completedTasks: TaskState[];
  decisions: Decision[];
  knowledge: Knowledge[];
  conversationEvents: ConversationEvent[];
}

const MIN_TOKEN_BUDGET = 500;
const DEFAULT_TOKEN_BUDGET = 1500;

export async function generateRestartPack(store: Store, input: RestartPackInput): Promise<string> {
  const cfg = await store.getRecoveryConfig(input.agent_id);
  const maxTokens = Math.max(
    input.max_tokens ?? cfg?.max_tokens ?? DEFAULT_RECOVERY_CONFIG.max_tokens ?? DEFAULT_TOKEN_BUDGET,
    MIN_TOKEN_BUDGET
  );

  const [activeTasks, blockedTasks, completedTasks, decisions, knowledge, conversationEvents] = await Promise.all([
    store.getTaskStates({ agent_id: input.agent_id, project: input.project, limit: 2, status: "in_progress" }),
    store.getTaskStates({ agent_id: input.agent_id, project: input.project, limit: 2, status: "blocked" }),
    store.getTaskStates({ agent_id: input.agent_id, project: input.project, limit: 3, status: "completed" }),
    store.getDecisions({ agent_id: input.agent_id, project: input.project, limit: 5, status: "active" }),
    store.getKnowledge({ agent_id: input.agent_id, project: input.project, limit: 5, status: "active" }),
    store.getConversationEvents({ agent_id: input.agent_id, project: input.project, limit: 8 }),
  ]);

  return buildRestartPack({
    agentId: input.agent_id,
    project: input.project,
    maxTokens,
    activeTasks,
    blockedTasks,
    completedTasks,
    decisions,
    knowledge,
    conversationEvents,
  });
}

export function buildRestartPack(data: RestartPackData): string {
  const sections = buildSections(data);
  return truncateSections(sections, data.maxTokens).join("\n\n");
}

function buildSections(data: RestartPackData): string[] {
  const sections: string[] = [];
  const active = data.activeTasks[0];
  const blocked = data.blockedTasks[0];
  const primaryTask = active ?? blocked;

  sections.push(
    [
      "SESSION RESTART PACK",
      `Agent: ${data.agentId}`,
      data.project ? `Project: ${data.project}` : "",
    ]
      .filter(Boolean)
      .join("\n")
  );

  sections.push(
    [
      "CURRENT OBJECTIVE",
      primaryTask
        ? primaryTask.task
        : "No current objective found in structured memory.",
    ].join("\n")
  );

  sections.push(
    [
      "ACTIVE TASK",
      primaryTask
        ? `[${primaryTask.status}] ${primaryTask.task}` +
          (primaryTask.progress ? `\nProgress: ${primaryTask.progress}` : "")
        : "No active task recorded.",
    ].join("\n")
  );

  sections.push(
    [
      "NEXT CONCRETE ACTION",
      primaryTask?.next_steps ?? "No next action recorded.",
    ].join("\n")
  );

  sections.push(
    [
      "BLOCKERS / NEEDS INFO",
      data.blockedTasks.length
        ? data.blockedTasks
            .map((task) => `- ${task.task}${task.progress ? `: ${task.progress}` : ""}`)
            .join("\n")
        : "No blockers recorded.",
    ].join("\n")
  );

  if (data.decisions.length > 0) {
    sections.push(
      ["RECENT DECISIONS", ...data.decisions.map((decision) => `- ${decision.decision}`)].join("\n")
    );
  }

  const files = collectFiles([...data.activeTasks, ...data.blockedTasks, ...data.completedTasks]);
  if (files.length > 0) {
    sections.push(["RELEVANT FILES", ...files.map((file) => `- ${renderPath(file)}`)].join("\n"));
  }

  const refs = collectRefs(data);
  if (refs.length > 0) {
    sections.push(["RELEVANT PRS / ISSUES / BRANCHES", ...refs.map((ref) => `- ${ref}`)].join("\n"));
  }

  if (data.knowledge.length > 0) {
    sections.push(
      [
        "KEY KNOWLEDGE",
        ...data.knowledge.map((item) => `- ${item.title}: ${item.content.slice(0, 220)}`),
      ].join("\n")
    );
  }

  const recent = summarizeRecentConversation(data.conversationEvents);
  if (recent) {
    sections.push(["RECENT CONVERSATION SUMMARY", recent].join("\n"));
  }

  if (!primaryTask && data.decisions.length === 0 && data.knowledge.length === 0 && data.conversationEvents.length === 0) {
    sections.push(
      [
        "SPARSE DATA NOTICE",
        "No structured memory or raw conversation events are available yet. Start by saving task state or ingesting conversation events.",
      ].join("\n")
    );
  }

  return sections;
}

function truncateSections(sections: string[], maxTokens: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const section of sections) {
    const safeSection = redactText(section).text;
    const tokens = estimateTokens(safeSection);
    if (used + tokens <= maxTokens) {
      out.push(safeSection);
      used += tokens;
      continue;
    }
    const remaining = maxTokens - used;
    if (remaining > 30) {
      out.push(safeSection.slice(0, remaining * 4) + "\n...(truncated)");
    }
    break;
  }
  return out;
}

function summarizeRecentConversation(events: ConversationEvent[]): string | null {
  if (events.length === 0) return null;
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = `${event.source}/${event.role ?? "event"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const latest = events[0]?.occurred_at ?? "unknown";
  return [
    `Raw conversation events available: ${events.length}`,
    `Latest event: ${latest}`,
    ...Array.from(counts.entries()).map(([key, count]) => `- ${key}: ${count}`),
  ].join("\n");
}

function collectFiles(tasks: TaskState[]): string[] {
  const seen = new Set<string>();
  for (const task of tasks) {
    for (const file of task.files_modified) {
      if (file) seen.add(file);
    }
  }
  return Array.from(seen).slice(0, 12);
}

function collectRefs(data: RestartPackData): string[] {
  const text = [
    ...data.activeTasks,
    ...data.blockedTasks,
    ...data.completedTasks,
  ]
    .map((task) => [task.task, task.progress, task.next_steps].filter(Boolean).join(" "))
    .concat(data.decisions.map((decision) => `${decision.decision} ${decision.context ?? ""}`))
    .concat(data.knowledge.map((item) => `${item.title} ${item.content}`))
    .join("\n");

  const matches = text.match(/\b(?:PR[#-]?\d+|ISSUE[#-]?\d+|AM-\d+|#[0-9]+|[a-zA-Z0-9._/-]+\/[a-zA-Z0-9._/-]+)\b/g) ?? [];
  return Array.from(new Set(matches)).slice(0, 12);
}

export function renderPath(path: string, cwd: string = process.cwd()): string {
  const normalizedHome = path.split(homedir()).join("~");
  if (isAbsolute(path)) {
    const rel = relative(cwd, path);
    if (rel && !rel.startsWith("..") && rel !== path) return rel;
  }
  return normalizedHome;
}
