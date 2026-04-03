import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { v4 as uuidv4 } from "uuid";
import type {
  Store,
  Decision,
  TaskState,
  Knowledge,
  AgentMessage,
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
} from "./types.js";

const DATA_DIR = join(homedir(), ".agent-memory");
const DECISIONS_FILE = join(DATA_DIR, "decisions.json");
const TASK_STATES_FILE = join(DATA_DIR, "task-states.json");
const KNOWLEDGE_FILE = join(DATA_DIR, "knowledge.json");

export class JsonStore implements Store {
  private decisions: Decision[] = [];
  private taskStates: TaskState[] = [];
  private knowledgeItems: Knowledge[] = [];

  async initialize(): Promise<void> {
    if (!existsSync(DATA_DIR)) {
      await mkdir(DATA_DIR, { recursive: true });
    }
    this.decisions = await this.loadFile<Decision>(DECISIONS_FILE);
    this.taskStates = await this.loadFile<TaskState>(TASK_STATES_FILE);
    this.knowledgeItems = await this.loadFile<Knowledge>(KNOWLEDGE_FILE);
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
    const state: TaskState = {
      id: uuidv4(),
      agent_id: input.agent_id,
      project: input.project,
      task: input.task,
      status: input.status,
      progress: input.progress,
      files_modified: input.files_modified || [],
      next_steps: input.next_steps,
      created_at: new Date().toISOString(),
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

    // messages search not available in JSON mode (requires agent-comms DB)
    return { decisions, task_states: taskStates, knowledge: knowledgeItems, messages: [] };
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

  async getRecentMessages(): Promise<AgentMessage[]> {
    // JSON store has no access to agent_messages — always return empty
    return [];
  }

  async getRecoveryConfig(): Promise<RecoveryConfig | null> {
    // JSON store has no recovery_config — use defaults
    return null;
  }

  async close(): Promise<void> {
    // No-op for JSON store
  }
}
