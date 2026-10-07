import type { Knowledge, KnowledgeScope, MemoryScope, SaveKnowledgeInput } from "./types.js";

export interface KnowledgeScopeInput {
  project?: string;
  knowledge_scope?: KnowledgeScope;
}

/** Legacy project-less rows are unclassified, never implicitly seat-wide. */
export function memoryScopeOf(item: { project?: string | null; memory_scope?: string | null }): MemoryScope {
  if (item.memory_scope === "seat" || item.memory_scope === "project" || item.memory_scope === "unclassified") {
    return item.memory_scope;
  }
  return item.project ? "project" : "unclassified";
}

export function validateKnowledgeWrite(input: SaveKnowledgeInput): MemoryScope {
  if (input.memory_scope !== undefined && !["seat", "project", "unclassified"].includes(input.memory_scope)) {
    throw new Error("Invalid memory_scope");
  }
  const scope = memoryScopeOf(input);
  if (scope === "project" && !input.project?.trim()) throw new Error("Project knowledge requires project");
  if (scope !== "project" && (input.project || (scope === "seat" && input.project !== undefined))) throw new Error("Seat or unclassified knowledge cannot have project");
  if (scope === "seat" && !input.source_ids?.length) throw new Error("Seat knowledge requires source_ids");
  if (scope === "seat" && input.source_ids!.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error("Seat knowledge source_ids must be memory record UUIDs");
  }
  return scope;
}

export function correctedMemoryScope(item: { project?: string | null; memory_scope?: string | null }, project?: string): MemoryScope {
  if (project !== undefined && !project.trim()) throw new Error("Correction project must not be empty");
  return project !== undefined ? "project" : memoryScopeOf(item);
}

export function validateKnowledgeScope(input: KnowledgeScopeInput, searchScope?: string): void {
  const mode = input.knowledge_scope ?? "legacy";
  if (!["legacy", "project_and_seat", "seat_only"].includes(mode)) throw new Error("Invalid knowledge_scope");
  if (mode === "project_and_seat" && !input.project?.trim()) throw new Error("project_and_seat requires project");
  if (mode === "seat_only" && (input.project !== undefined || (searchScope !== undefined && searchScope !== "knowledge"))) {
    throw new Error("seat_only requires knowledge search without project");
  }
}

/** The caller always adds agent_id and status predicates independently. */
export function knowledgeScopeSql(input: KnowledgeScopeInput, parameter: string): { clause?: string; values: string[] } {
  validateKnowledgeScope(input);
  if (input.knowledge_scope === "seat_only") {
    return { clause: "(project IS NULL AND memory_scope = 'seat')", values: [] };
  }
  if (input.knowledge_scope === "project_and_seat") {
    return {
      clause: `((project = ${parameter} AND COALESCE(memory_scope, 'project') = 'project') OR (project IS NULL AND memory_scope = 'seat'))`,
      values: [input.project!],
    };
  }
  return input.project ? { clause: `project = ${parameter}`, values: [input.project] } : { values: [] };
}

export function matchesKnowledgeScope(item: Knowledge, input: KnowledgeScopeInput): boolean {
  if (input.knowledge_scope === "seat_only") return !item.project && memoryScopeOf(item) === "seat";
  if (input.knowledge_scope === "project_and_seat") {
    return (!item.project && memoryScopeOf(item) === "seat") ||
      (item.project === input.project && memoryScopeOf(item) === "project");
  }
  return !input.project || item.project === input.project;
}
