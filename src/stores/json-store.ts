import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { deriveTaskIdFromTask } from "./task-id.js";
import { conversationEventToRawEventInput, rawEventSourceRef } from "./raw-events.js";
import type {
  Store,
  Decision,
  TaskState,
  Knowledge,
  AgentMessage,
  ConversationEvent,
  RawEvent,
  SelectedRestartPack,
  RecoveryConfig,
  LogDecisionInput,
  GetDecisionsInput,
  SupersedeDecisionInput,
  SaveTaskStateInput,
  GetTaskStatesInput,
  SearchMemoryInput,
  SearchMemoryResult,
  SaveKnowledgeInput,
  GetKnowledgeInput,
  SupersedeKnowledgeInput,
  SaveConversationEventInput,
  GetConversationEventsInput,
  SaveRawEventInput,
  GetRawEventsInput,
  SaveSelectedRestartPackInput,
  GetSelectedRestartPackInput,
  ConsumeSelectedRestartPackInput,
} from "./types.js";

const DATA_DIR = join(homedir(), ".agent-memory");
const DECISIONS_FILE = join(DATA_DIR, "decisions.json");
const TASK_STATES_FILE = join(DATA_DIR, "task-states.json");
const KNOWLEDGE_FILE = join(DATA_DIR, "knowledge.json");
const CONVERSATION_EVENTS_FILE = join(DATA_DIR, "conversation-events.json");
const RAW_EVENTS_FILE = join(DATA_DIR, "raw-events.json");
const SELECTED_RESTART_PACKS_FILE = join(DATA_DIR, "selected-restart-packs.json");

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function conversationSearchScore(event: ConversationEvent, keywords: string[]): number {
  const content = event.content.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (content.includes(keyword)) score += 1;
  }
  if (event.role === "user" || event.role === "assistant") score += 0.25;
  if (content.includes('"type":"token_count"')) score -= 2;
  if (content.includes('"type":"turn_context"')) score -= 1;
  return score;
}

export class JsonStore implements Store {
  private decisions: Decision[] = [];
  private taskStates: TaskState[] = [];
  private knowledgeItems: Knowledge[] = [];
  private conversationEvents: ConversationEvent[] = [];
  private rawEvents: RawEvent[] = [];
  private selectedRestartPacks: SelectedRestartPack[] = [];

  async initialize(): Promise<void> {
    if (!existsSync(DATA_DIR)) {
      await mkdir(DATA_DIR, { recursive: true });
    }
    this.decisions = await this.loadFile<Decision>(DECISIONS_FILE);
    this.taskStates = await this.loadFile<TaskState>(TASK_STATES_FILE);
    this.knowledgeItems = await this.loadFile<Knowledge>(KNOWLEDGE_FILE);
    this.conversationEvents = await this.loadFile<ConversationEvent>(CONVERSATION_EVENTS_FILE);
    this.rawEvents = await this.loadFile<RawEvent>(RAW_EVENTS_FILE);
    this.selectedRestartPacks = await this.loadFile<SelectedRestartPack>(SELECTED_RESTART_PACKS_FILE);
    // AM-023: back-fill + dedup legacy task_states from before the
    // task_id schema change. Mirrors the SQL migration in pg-store /
    // sqlite-store: copy `task` into `task_id` for any row that's
    // missing one, then collapse to one row per (agent_id, task_id),
    // keeping the entry with the latest created_at.
    let mutated = false;
    for (const ts of this.taskStates) {
      if (!ts.task_id) {
        ts.task_id = ts.task;
        mutated = true;
      }
      if (!ts.updated_at) {
        ts.updated_at = ts.created_at;
        mutated = true;
      }
    }
    const latestPerKey = new Map<string, TaskState>();
    for (const ts of this.taskStates) {
      const key = `${ts.agent_id}::${ts.task_id}`;
      const prev = latestPerKey.get(key);
      if (!prev || new Date(ts.created_at).getTime() > new Date(prev.created_at).getTime()) {
        latestPerKey.set(key, ts);
      }
    }
    if (latestPerKey.size !== this.taskStates.length) {
      this.taskStates = Array.from(latestPerKey.values());
      mutated = true;
    }
    if (mutated) {
      await this.saveTaskStates();
    }
  }

  private async loadFile<T>(path: string): Promise<T[]> {
    try {
      if (existsSync(path)) {
        const data = await readFile(path, "utf-8");
        return JSON.parse(data);
      }
    } catch {
      // Corrupted file — start fresh
    }
    return [];
  }

  private async saveDecisions(): Promise<void> {
    await writeFile(DECISIONS_FILE, JSON.stringify(this.decisions, null, 2));
  }

  private async saveTaskStates(): Promise<void> {
    await writeFile(TASK_STATES_FILE, JSON.stringify(this.taskStates, null, 2));
  }

  async logDecision(input: LogDecisionInput): Promise<Decision> {
    const decision: Decision = {
      id: uuidv4(),
      agent_id: input.agent_id,
      project: input.project,
      decision: input.decision,
      context: input.context,
      tags: input.tags || [],
      status: "active",
      created_at: new Date().toISOString(),
    };
    this.decisions.push(decision);
    await this.saveDecisions();
    return decision;
  }

  async getDecisions(input: GetDecisionsInput): Promise<Decision[]> {
    let results = this.decisions.filter((d) => d.agent_id === input.agent_id);

    if (input.project) {
      results = results.filter((d) => d.project === input.project);
    }
    if (input.status && input.status !== "all") {
      results = results.filter((d) => d.status === input.status);
    } else if (!input.status) {
      results = results.filter((d) => d.status === "active");
    }
    if (input.tags && input.tags.length > 0) {
      results = results.filter((d) =>
        input.tags!.some((tag) => d.tags.includes(tag))
      );
    }

    // Sort by created_at descending
    results.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return results.slice(0, input.limit || 10);
  }

  async supersedeDecision(
    input: SupersedeDecisionInput
  ): Promise<{ old: Decision; new: Decision }> {
    const oldDecision = this.decisions.find(
      (d) => d.id === input.old_decision_id && d.agent_id === input.agent_id
    );
    if (!oldDecision) {
      throw new Error(`Decision not found: ${input.old_decision_id}`);
    }

    const newDecision: Decision = {
      id: uuidv4(),
      agent_id: input.agent_id,
      project: input.project || oldDecision.project,
      decision: input.new_decision,
      context: input.context,
      tags: input.tags || oldDecision.tags,
      status: "active",
      created_at: new Date().toISOString(),
    };

    oldDecision.status = "superseded";
    oldDecision.superseded_by = newDecision.id;

    this.decisions.push(newDecision);
    await this.saveDecisions();

    return { old: oldDecision, new: newDecision };
  }

  async saveTaskState(input: SaveTaskStateInput): Promise<TaskState> {
    // AM-023: UPSERT semantics keyed on (agent_id, task_id), matching
    // pg-store and sqlite-store. The in-memory map enforces uniqueness
    // without needing a separate index.
    const taskId = input.task_id ?? deriveTaskIdFromTask(input.task);
    const now = new Date().toISOString();
    const existing = this.taskStates.find(
      (t) => t.agent_id === input.agent_id && t.task_id === taskId
    );

    if (existing) {
      existing.project = input.project;
      existing.task = input.task;
      existing.status = input.status;
      existing.progress = input.progress;
      existing.files_modified = input.files_modified || [];
      existing.next_steps = input.next_steps;
      existing.updated_at = now;
      await this.saveTaskStates();
      return existing;
    }

    const state: TaskState = {
      id: uuidv4(),
      agent_id: input.agent_id,
      project: input.project,
      task_id: taskId,
      task: input.task,
      status: input.status,
      progress: input.progress,
      files_modified: input.files_modified || [],
      next_steps: input.next_steps,
      created_at: now,
      updated_at: now,
    };
    this.taskStates.push(state);
    await this.saveTaskStates();
    return state;
  }

  async getTaskStates(input: GetTaskStatesInput): Promise<TaskState[]> {
    let results = this.taskStates.filter((t) => t.agent_id === input.agent_id);

    if (input.project) {
      results = results.filter((t) => t.project === input.project);
    }
    if (input.status && input.status !== "all") {
      results = results.filter((t) => t.status === input.status);
    }

    results.sort((a, b) => {
      const timeDiff =
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return this.taskStates.indexOf(b) - this.taskStates.indexOf(a);
    });

    return results.slice(0, input.limit || 5);
  }

  async searchMemory(input: SearchMemoryInput): Promise<SearchMemoryResult> {
    const scope = input.scope || "all";
    const limit = input.limit || 5;
    const queryLower = input.query.toLowerCase();
    // Split on whitespace, then further split mixed CJK/ASCII tokens
    const rawTokens = queryLower.split(/\s+/).filter(Boolean);
    const keywords: string[] = [];
    for (const token of rawTokens) {
      // Split at CJK/ASCII boundaries to handle "JWT認証" → ["jwt", "認証"]
      const parts = token.split(/(?<=[\u3000-\u9fff\uf900-\ufaff])(?=[a-z0-9])|(?<=[a-z0-9])(?=[\u3000-\u9fff\uf900-\ufaff])/i).filter(Boolean);
      keywords.push(...parts);
    }

    const matchesAny = (text: string): boolean => {
      const lower = text.toLowerCase();
      return keywords.some((kw) => lower.includes(kw));
    };

    let decisions: Decision[] = [];
    let taskStates: TaskState[] = [];

    if (scope === "decisions" || scope === "all") {
      decisions = this.decisions
        .filter((d) => {
          if (d.agent_id !== input.agent_id) return false;
          if (input.project && d.project !== input.project) return false;
          const searchText = [d.decision, d.context || "", ...d.tags].join(" ");
          return matchesAny(searchText);
        })
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        .slice(0, limit);
    }

    if (scope === "tasks" || scope === "all") {
      taskStates = this.taskStates
        .filter((t) => {
          if (t.agent_id !== input.agent_id) return false;
          if (input.project && t.project !== input.project) return false;
          const searchText = [t.task, t.progress || "", t.next_steps || ""].join(
            " "
          );
          return matchesAny(searchText);
        })
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        .slice(0, limit);
    }

    let knowledgeItems: Knowledge[] = [];

    if (scope === "knowledge" || scope === "all") {
      knowledgeItems = this.knowledgeItems
        .filter((k) => {
          if (k.agent_id !== input.agent_id) return false;
          if (input.project && k.project !== input.project) return false;
          if (k.status !== "active") return false;
          const searchText = [k.title, k.content, ...k.tags].join(" ");
          return matchesAny(searchText);
        })
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
        .slice(0, limit);
    }

    let conversationEvents: ConversationEvent[] = [];

    if (scope === "conversation" || scope === "all") {
      conversationEvents = this.conversationEvents
        .filter((event) => {
          if (event.agent_id !== input.agent_id) return false;
          if (input.project && event.project !== input.project) return false;
          const searchText = [event.content, event.role || "", event.source].join(" ");
          return matchesAny(searchText);
        })
        .sort(
          (a, b) => {
            const scoreDiff = conversationSearchScore(b, keywords) - conversationSearchScore(a, keywords);
            if (scoreDiff !== 0) return scoreDiff;
            return new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
          }
        )
        .slice(0, limit);
    }

    // messages search not available in JSON mode (requires agent-comms DB)
    return { decisions, task_states: taskStates, knowledge: knowledgeItems, messages: [], conversation_events: conversationEvents };
  }

  async saveKnowledge(input: SaveKnowledgeInput): Promise<Knowledge> {
    const knowledge: Knowledge = {
      id: uuidv4(),
      agent_id: input.agent_id,
      project: input.project,
      title: input.title,
      content: input.content,
      source_type: input.source_type,
      source_ids: input.source_ids || [],
      tags: input.tags || [],
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.knowledgeItems.push(knowledge);
    await this.saveKnowledgeFile();
    return knowledge;
  }

  async getKnowledge(input: GetKnowledgeInput): Promise<Knowledge[]> {
    let results = this.knowledgeItems.filter((k) => k.agent_id === input.agent_id);

    if (input.project) {
      results = results.filter((k) => k.project === input.project);
    }
    if (input.status && input.status !== "all") {
      results = results.filter((k) => k.status === input.status);
    } else if (!input.status) {
      results = results.filter((k) => k.status === "active");
    }
    if (input.tags && input.tags.length > 0) {
      results = results.filter((k) =>
        input.tags!.some((tag) => k.tags.includes(tag))
      );
    }

    results.sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );

    return results.slice(0, input.limit || 10);
  }

  private async saveKnowledgeFile(): Promise<void> {
    await writeFile(KNOWLEDGE_FILE, JSON.stringify(this.knowledgeItems, null, 2));
  }

  private async saveConversationEventsFile(): Promise<void> {
    await writeFile(CONVERSATION_EVENTS_FILE, JSON.stringify(this.conversationEvents, null, 2));
  }

  private async saveRawEventsFile(): Promise<void> {
    await writeFile(RAW_EVENTS_FILE, JSON.stringify(this.rawEvents, null, 2));
  }

  private async saveSelectedRestartPacksFile(): Promise<void> {
    await writeFile(SELECTED_RESTART_PACKS_FILE, JSON.stringify(this.selectedRestartPacks, null, 2));
  }

  async getRecentMessages(): Promise<AgentMessage[]> {
    // JSON store has no access to agent_messages — always return empty
    return [];
  }

  async saveConversationEvent(input: SaveConversationEventInput): Promise<ConversationEvent> {
    const hash = input.content_hash ?? contentHash(input.content);
    const existing = this.conversationEvents.find((event) => {
      if (event.agent_id !== input.agent_id || event.source !== input.source) return false;
      if (input.source_event_id) return event.source_event_id === input.source_event_id;
      return event.content_hash === hash && event.occurred_at === (input.occurred_at ?? event.occurred_at);
    });
    if (existing) {
      await this.ensureConversationRawEvent(existing);
      return existing;
    }

    const now = new Date().toISOString();
    const event: ConversationEvent = {
      id: uuidv4(),
      agent_id: input.agent_id,
      project: input.project,
      source: input.source,
      source_event_id: input.source_event_id,
      source_path: input.source_path,
      role: input.role,
      content: input.content,
      content_hash: hash,
      metadata: input.metadata ?? {},
      occurred_at: input.occurred_at ?? now,
      created_at: now,
    };
    this.conversationEvents.push(event);
    await this.saveConversationEventsFile();
    await this.ensureConversationRawEvent(event);
    return event;
  }

  async getConversationEvents(input: GetConversationEventsInput): Promise<ConversationEvent[]> {
    let results = this.conversationEvents.filter((event) => event.agent_id === input.agent_id);
    if (input.project) results = results.filter((event) => event.project === input.project);
    if (input.source) results = results.filter((event) => event.source === input.source);
    if (input.since) {
      const sinceMs = new Date(input.since).getTime();
      results = results.filter((event) => new Date(event.occurred_at).getTime() >= sinceMs);
    }
    results.sort(
      (a, b) =>
        new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
    );
    return results.slice(0, input.limit ?? 50);
  }

  async saveRawEvent(input: SaveRawEventInput): Promise<RawEvent> {
    const now = new Date().toISOString();
    const hash = input.content_hash ?? (input.content ? contentHash(input.content) : undefined);
    const occurredAt = input.occurred_at ?? now;
    const sourceRef = rawEventSourceRef(input);
    const sourceRefHash = contentHash(JSON.stringify(sourceRef));
    const existing = this.rawEvents.find((event) => {
      if (event.agent_id !== input.agent_id || event.source !== input.source) return false;
      if (input.source_event_id) return event.source_event_id === input.source_event_id;
      if (hash !== undefined) return event.content_hash === hash && event.occurred_at === occurredAt;
      return event.source_ref_hash === sourceRefHash && event.occurred_at === occurredAt;
    });
    if (existing) return existing;

    const event: RawEvent = {
      id: uuidv4(),
      agent_id: input.agent_id,
      session_id: input.session_id,
      project: input.project,
      host: input.host,
      source: input.source,
      event_type: input.event_type,
      role: input.role,
      content: input.content,
      content_hash: hash,
      source_ref: sourceRef,
      source_ref_hash: sourceRefHash,
      source_event_id: input.source_event_id,
      source_path: input.source_path,
      redaction_level: input.redaction_level ?? "basic",
      private_reasoning: input.private_reasoning ?? false,
      metadata: input.metadata ?? {},
      occurred_at: occurredAt,
      created_at: now,
    };
    this.rawEvents.push(event);
    await this.saveRawEventsFile();
    return event;
  }

  async getRawEvents(input: GetRawEventsInput): Promise<RawEvent[]> {
    let results = this.rawEvents.filter((event) => event.agent_id === input.agent_id);
    if (input.session_id) results = results.filter((event) => event.session_id === input.session_id);
    if (input.project) results = results.filter((event) => event.project === input.project);
    if (input.source) results = results.filter((event) => event.source === input.source);
    if (input.event_type) results = results.filter((event) => event.event_type === input.event_type);
    if (input.since) {
      const sinceMs = new Date(input.since).getTime();
      results = results.filter((event) => new Date(event.occurred_at).getTime() >= sinceMs);
    }
    results.sort(
      (a, b) =>
        new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
    );
    return results.slice(0, input.limit ?? 50);
  }

  private async ensureConversationRawEvent(event: ConversationEvent): Promise<void> {
    await this.saveRawEvent(conversationEventToRawEventInput(event));
  }

  async getRecoveryConfig(): Promise<RecoveryConfig | null> {
    // JSON store has no recovery_config — use defaults
    return null;
  }

  async expireStaleTaskStates(): Promise<number> {
    // JSON store has no auto-expire — no-op
    return 0;
  }

  async upsertRecoveryConfig(input: {
    agent_id: string;
    max_tokens?: number;
    task_states_limit?: number;
    decisions_limit?: number;
    knowledge_limit?: number;
    messages_limit?: number;
  }): Promise<RecoveryConfig> {
    // JSON store: return defaults merged with input
    const { DEFAULT_RECOVERY_CONFIG } = await import("../constants.js");
    return {
      agent_id: input.agent_id,
      max_tokens: input.max_tokens ?? DEFAULT_RECOVERY_CONFIG.max_tokens,
      task_states_limit: input.task_states_limit ?? DEFAULT_RECOVERY_CONFIG.task_states_limit,
      decisions_limit: input.decisions_limit ?? DEFAULT_RECOVERY_CONFIG.decisions_limit,
      knowledge_limit: input.knowledge_limit ?? DEFAULT_RECOVERY_CONFIG.knowledge_limit,
      messages_limit: input.messages_limit ?? DEFAULT_RECOVERY_CONFIG.messages_limit,
      discord_history_limit: DEFAULT_RECOVERY_CONFIG.discord_history_limit,
      discord_channels: DEFAULT_RECOVERY_CONFIG.discord_channels,
      restart_message_threshold: DEFAULT_RECOVERY_CONFIG.restart_message_threshold,
    };
  }

  async logRecoveryQuality(_input: import("./types.js").LogRecoveryQualityInput): Promise<string> {
    void _input;
    // JSON store has no recovery_quality_log — no-op
    return "";
  }

  async updateSearchMemoryCount(): Promise<void> {
    // JSON store has no recovery_quality_log — no-op
  }

  async saveSelectedRestartPack(input: SaveSelectedRestartPackInput): Promise<SelectedRestartPack> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const pack: SelectedRestartPack = {
      id,
      agent_id: input.agent_id,
      project: input.project,
      pack_ref: `selected_restart_pack:${id}`,
      content: input.content,
      content_hash: contentHash(input.content),
      status: "active",
      source: input.source ?? "restart_prepare",
      metadata: input.metadata ?? {},
      created_at: now,
      expires_at: input.expires_at,
    };
    this.selectedRestartPacks.push(pack);
    await this.saveSelectedRestartPacksFile();
    return pack;
  }

  async getSelectedRestartPack(input: GetSelectedRestartPackInput): Promise<SelectedRestartPack | null> {
    return this.findSelectedRestartPack(input);
  }

  async consumeSelectedRestartPack(input: ConsumeSelectedRestartPackInput): Promise<SelectedRestartPack | null> {
    const pack = this.findSelectedRestartPack(input);
    if (!pack) return null;
    pack.status = "consumed";
    pack.consumed_at = input.consumed_at ?? new Date().toISOString();
    await this.saveSelectedRestartPacksFile();
    return pack;
  }

  private findSelectedRestartPack(input: GetSelectedRestartPackInput): SelectedRestartPack | null {
    const now = Date.now();
    const pack = this.selectedRestartPacks.find((item) => {
      if (item.agent_id !== input.agent_id) return false;
      if (item.pack_ref !== input.pack_ref) return false;
      if (input.project && item.project !== input.project) return false;
      if (item.status !== "active") return false;
      if (item.expires_at && new Date(item.expires_at).getTime() <= now) return false;
      return true;
    });
    return pack ?? null;
  }

  async updateKnowledgeStatus(input: { id: string; agent_id: string; status: "active" | "merged" | "archived" | "superseded"; merged_into?: string }): Promise<Knowledge> {
    const item = this.knowledgeItems.find((k) => k.id === input.id && k.agent_id === input.agent_id);
    if (!item) {
      throw new Error(`Knowledge entry not found: ${input.id}`);
    }
    if (input.merged_into) {
      if (input.id === input.merged_into) {
        throw new Error("Cannot merge a knowledge entry into itself");
      }
      const target = this.knowledgeItems.find((k) => k.id === input.merged_into && k.agent_id === input.agent_id);
      if (!target) {
        throw new Error(`Merge target not found: ${input.merged_into}`);
      }
      item.status = "merged";
      item.merged_into = input.merged_into;
    } else {
      item.status = input.status;
      item.merged_into = undefined;
    }
    item.updated_at = new Date().toISOString();
    await this.saveKnowledgeFile();
    return item;
  }

  async supersedeKnowledge(
    input: SupersedeKnowledgeInput
  ): Promise<{ old: Knowledge; new: Knowledge }> {
    const oldItem = this.knowledgeItems.find(
      (k) => k.id === input.old_id && k.agent_id === input.agent_id
    );
    if (!oldItem) {
      throw new Error(`Knowledge not found: ${input.old_id}`);
    }

    const now = new Date().toISOString();
    const newItem: Knowledge = {
      id: uuidv4(),
      agent_id: input.agent_id,
      project: input.project ?? oldItem.project,
      title: input.new_title,
      content: input.new_content,
      source_type: "manual",
      source_ids: [],
      tags: input.tags ?? oldItem.tags,
      status: "active",
      supersedes: input.old_id,
      supersede_reason: input.reason,
      created_at: now,
      updated_at: now,
    };

    // AM-024 follow-up (#66 item 1): the in-memory mutation below is
    // not atomic with the on-disk write. If `saveKnowledgeFile()`
    // throws (disk full / permission / fs glitch), the in-memory
    // store will already show the old item as `superseded` and the
    // new one inserted, while the on-disk file still reflects the
    // pre-supersede state. Subsequent calls in the same process will
    // see the in-memory state and *re-throw* on retry instead of
    // re-applying. We try/catch the persist call and roll the
    // in-memory mutation back so the next attempt is idempotent.
    const previousStatus = oldItem.status;
    const previousUpdatedAt = oldItem.updated_at;
    oldItem.status = "superseded";
    oldItem.updated_at = now;
    this.knowledgeItems.push(newItem);
    try {
      await this.saveKnowledgeFile();
    } catch (err) {
      // Roll back the in-memory mutation so the caller's retry path
      // sees the original state. PG/SQLite stores get this for free
      // via transactions; the JSON store has to do it by hand.
      oldItem.status = previousStatus;
      oldItem.updated_at = previousUpdatedAt;
      this.knowledgeItems.pop();
      throw err;
    }
    return { old: oldItem, new: newItem };
  }

  async close(): Promise<void> {
    // No-op for JSON store
  }
}
