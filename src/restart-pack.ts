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
  const hasRecentConversation = data.conversationEvents.length > 0;
  const relevanceBasis = primaryTask ? primaryTask.task : "";
  const relevantDecisions = primaryTask ? filterRelevant(data.decisions, relevanceBasis, decisionText) : data.decisions;
  const relevantKnowledge = primaryTask ? filterRelevant(data.knowledge, relevanceBasis, knowledgeText) : data.knowledge;
  const hiddenStructuredCount =
    data.decisions.length - relevantDecisions.length + data.knowledge.length - relevantKnowledge.length;

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
        : hasRecentConversation
          ? "No structured current objective found. Recent conversation events are available; recover the latest objective with search_memory scope=conversation before acting."
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
      primaryTask?.next_steps ??
        (hasRecentConversation
          ? "Run search_memory with scope=conversation for the latest user request, then update task_state before continuing."
          : "No next action recorded."),
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

  if (hiddenStructuredCount > 0) {
    sections.push(
      [
        "STRUCTURED MEMORY CAUTION",
        `${hiddenStructuredCount} older decision/knowledge items were omitted because they did not match the current task. Use targeted search_memory only if the restart pack feels incomplete.`,
      ].join("\n")
    );
  }

  if (relevantDecisions.length > 0) {
    const decisionsTitle = !primaryTask && hasRecentConversation
      ? "RECENT DECISIONS (VERIFY AGAINST CONVERSATION)"
      : "RECENT DECISIONS";
    sections.push(
      [decisionsTitle, ...relevantDecisions.map((decision) => `- ${clipLine(decision.decision, 260)}`)].join("\n")
    );
  }

  const files = collectFiles([...data.activeTasks, ...data.blockedTasks, ...data.completedTasks]);
  if (files.length > 0) {
    sections.push(["RELEVANT FILES", ...files.map((file) => `- ${renderPath(file)}`)].join("\n"));
  }

  const refs = collectRefs({
    ...data,
    decisions: relevantDecisions,
    knowledge: relevantKnowledge,
  }, !primaryTask && hasRecentConversation);
  if (refs.length > 0) {
    sections.push(["RELEVANT PRS / ISSUES / BRANCHES", ...refs.map((ref) => `- ${ref}`)].join("\n"));
  }

  if (relevantKnowledge.length > 0) {
    sections.push(
      [
        "KEY KNOWLEDGE",
        ...relevantKnowledge.map((item) => `- ${clipLine(`${item.title}: ${item.content}`, 260)}`),
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

function clipLine(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxChars ? compact.slice(0, maxChars - 15) + " ...(truncated)" : compact;
}

function decisionText(decision: Decision): string {
  return [decision.decision, decision.context ?? "", ...decision.tags].join(" ");
}

function knowledgeText(item: Knowledge): string {
  return [item.title, item.content, ...item.tags].join(" ");
}

function filterRelevant<T>(items: T[], basis: string, render: (item: T) => string): T[] {
  const basisTokens = relevanceTokens(basis);
  const basisAnchors = basisTokens.filter(isAnchorToken);
  if (basisTokens.length === 0) return items.slice(0, 3);
  return items
    .map((item) => ({
      item,
      tokens: relevanceTokens(render(item)),
    }))
    .map(({ item, tokens }) => ({
      item,
      hasRequiredAnchor: basisAnchors.length === 0 || tokens.some((token) => basisAnchors.includes(token)),
      score: tokens.filter((token) => basisTokens.includes(token)).length,
    }))
    .filter(({ score, hasRequiredAnchor }) => hasRequiredAnchor && score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item)
    .slice(0, 3);
}

function isAnchorToken(token: string): boolean {
  return /^(?:am-\d+|pr[#-]?\d+|issue[#-]?\d+|#[0-9]+)$/i.test(token);
}

function relevanceTokens(text: string): string[] {
  const compactRefs = normalizeRefs(text.toLowerCase());
  const matches = compactRefs.match(/am-\d+|pr[#-]?\d+|issue[#-]?\d+|#[0-9]+|[a-z0-9][a-z0-9_-]{3,}/g) ?? [];
  const stop = new Set([
    "with",
    "from",
    "after",
    "before",
    "current",
    "status",
    "tests",
    "build",
    "branch",
    "worktree",
    "developer",
    "users",
  ]);
  return Array.from(new Set(matches.filter((token) => !stop.has(token))));
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

function collectRefs(data: RestartPackData, structuredMemoryNeedsVerification = false): string[] {
  const taskText = [
    ...data.activeTasks,
    ...data.blockedTasks,
  ]
    .map((task) => [task.task, task.progress, task.next_steps].filter(Boolean).join(" "));
  const structuredText = structuredMemoryNeedsVerification
    ? []
    : data.decisions
        .map((decision) => decision.decision)
        .concat(data.knowledge.map((item) => `${item.title} ${item.content}`));
  const text = normalizeRefs(taskText.concat(structuredText).join("\n"));

  const matches = text.match(/\b(?:PR[#-]?\d+|ISSUE[#-]?\d+|AM-\d+|#[0-9]+)\b/gi) ?? [];
  return Array.from(new Set(matches)).slice(0, 12);
}

function normalizeRefs(text: string): string {
  return text
    .replace(/\b(PR)\s+#?\s*(\d+)\b/gi, "$1#$2")
    .replace(/\b(ISSUE)\s+#?\s*(\d+)\b/gi, "$1#$2");
}

export function renderPath(path: string, cwd: string = process.cwd()): string {
  const normalizedHome = path.split(homedir()).join("~");
  if (isAbsolute(path)) {
    const rel = relative(cwd, path);
    if (rel && !rel.startsWith("..") && rel !== path) return rel;
  }
  return normalizedHome;
}
