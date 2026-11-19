/**
 * The tools a seat calls in the common-infrastructure form (u1-seat-memory-skeleton, Step 8; BR3.2, BR3.5, BR5.1,
 * BR5.2). Only `log_decision` and `get_decisions` reach the database, through the seat's store; every other tool the
 * server lists answers `not_yet_available` (never a success, never a write to the standalone tables). The only local
 * record of a call holds the tool name, the ids of the records, the time and the result (BR5.1); the standalone
 * `logCall` line, which carries the decision text, is not used here. A failure is told by name, kind and short code
 * only (BR5.2). The clock, the ids and the place the record goes are given by the caller (S4).
 */
import { failure, type SeatFailure } from "./common-seat-errors.js";
import type { CommonSeatStore } from "./common-seat-store.js";
import { safeText } from "./sanitize.js";

/** The tools that reach the database in this form; every other registered tool is `not_yet_available`. */
export const COMMON_TOOLS = ["log_decision", "get_decisions"] as const;

/** The default of `get_decisions`' limit, as its description states it ("Max results (default: 10)"). */
const DEFAULT_GET_LIMIT = 10;

export interface ToolReply {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}

export interface SurfacePorts {
  readonly store: CommonSeatStore;
  readonly now: () => number;
  /** A fresh UUID each call: the decision, each tag and the call record's own reference. */
  readonly newId: () => string;
  /** Appends one line to the seat's local call record. A failure here never changes a tool's answer. */
  readonly record: (line: string) => Promise<void>;
  /** The project label used when a call names none. */
  readonly defaultProject?: string;
}

export interface CommonSurface {
  call(tool: string, args: unknown): Promise<ToolReply>;
}

/** A failure as text: its name, kind and code, and the fixed note some carry. It never holds a value, a URL or driver text. */
export function describeFailure(f: SeatFailure): string {
  const detail = [f.cause, f.code].filter(Boolean).join(", ");
  return `${f.name ?? "unnamed_failure"} (${detail})${f.note ? `: ${f.note}` : ""}`;
}

export interface CallRecordInput {
  readonly at: number;
  readonly tool: string;
  readonly entryRef: string;
  readonly refs: readonly string[];
  readonly outcome: "ok" | SeatFailure;
}

/** One line of the local call record: the tool name, the record ids, the time and the result, and nothing else. */
export function callRecordLine(input: CallRecordInput): string {
  const result = input.outcome === "ok" ? "ok" : `error:${input.outcome.name ?? "unnamed_failure"}`;
  return `${new Date(input.at).toISOString()}  ${input.tool}  entry=${input.entryRef} refs=${input.refs.join(",") || "-"} outcome=${result}`;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const textOf = (lines: string[], isError: boolean): ToolReply => ({ content: [safeText(lines.join("\n"))], ...(isError ? { isError: true as const } : {}) });

export function createCommonSurface(ports: SurfacePorts): CommonSurface {
  const { store } = ports;

  async function logDecision(args: Record<string, unknown>): Promise<{ reply: ToolReply; refs: string[]; outcome: "ok" | SeatFailure }> {
    const decisionId = ports.newId();
    const tags = Array.isArray(args.tags) ? args.tags.map((text) => ({ id: ports.newId(), text: text as string })) : [];
    const result = await store.logDecision({
      decisionId,
      decision: args.decision as string,
      context: args.context as string | undefined,
      project: (args.project as string | undefined) || ports.defaultProject,
      tags,
    });
    if (result.ok) {
      return { reply: textOf([`Decision logged (id: ${result.decisionId})`], false), refs: [result.decisionId], outcome: "ok" };
    }
    // After a lost answer the write may have happened: the id lets the seat look for it before it sends again (S7).
    const lost = result.cause === "response_lost";
    return {
      reply: textOf([`Failed to log decision: ${describeFailure(result)}`, ...(lost ? [`Attempted id: ${decisionId}`] : [])], true),
      refs: lost ? [decisionId] : [],
      outcome: result,
    };
  }

  async function getDecisions(args: Record<string, unknown>): Promise<{ reply: ToolReply; refs: string[]; outcome: "ok" | SeatFailure }> {
    // Only active decisions exist in this form; the other statuses come with the later unit (U2).
    if (args.status !== undefined && args.status !== "active") {
      const unavailable = failure("not_yet_available", "input");
      return { reply: textOf([`Failed to get decisions: ${describeFailure(unavailable)}`], true), refs: [], outcome: unavailable };
    }
    const result = await store.getDecisions({
      project: (args.project as string | undefined) || ports.defaultProject,
      tags: args.tags as string[] | undefined,
      limit: (args.limit as number | undefined) ?? DEFAULT_GET_LIMIT,
    });
    if (!result.ok) return { reply: textOf([`Failed to get decisions: ${describeFailure(result)}`], true), refs: [], outcome: result };
    if (result.decisions.length === 0) return { reply: textOf(["No decisions found."], false), refs: [], outcome: "ok" };
    const lines = result.decisions.map(
      (d, i) =>
        `${i + 1}. [${d.status}] ${d.decision_text}` +
        (d.context_text ? `\n   Context: ${d.context_text}` : "") +
        (d.tags.length ? `\n   Tags: ${d.tags.join(", ")}` : "") +
        `\n   ID: ${d.id} | ${new Date(d.created_at_ms).toISOString()}`,
    );
    return {
      reply: textOf([`${result.decisions.length} decision(s):`, "", lines.join("\n\n")], false),
      refs: result.decisions.map((d) => d.id),
      outcome: "ok",
    };
  }

  return {
    async call(tool, rawArgs) {
      const args = record(rawArgs);
      const known = tool === "log_decision" || tool === "get_decisions";
      const done = known
        ? await (tool === "log_decision" ? logDecision(args) : getDecisions(args))
        : { reply: textOf([`${tool}: ${describeFailure(failure("not_yet_available", "input"))}`], true), refs: [], outcome: failure("not_yet_available", "input") };
      try {
        await ports.record(
          callRecordLine({ at: ports.now(), tool: /^[a-z_]{1,64}$/.test(tool) ? tool : "unknown", entryRef: ports.newId(), refs: done.refs, outcome: done.outcome }),
        );
      } catch {
        // The call record is a convenience of the seat; its failure never changes the answer.
      }
      return done.reply;
    },
  };
}

type ToolRegistration = (name: string, description: string, shape: unknown, handler: unknown) => unknown;

/**
 * The same server, with every tool it registers answered by the surface. The registrations keep their own names,
 * descriptions and argument shapes (one definition of the public tools); only the handler is replaced. Methods other
 * than `tool` pass through unchanged.
 */
export function withCommonForm<T extends object>(server: T, surface: CommonSurface): T {
  return new Proxy(server, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (property === "tool") {
        return (name: string, description: string, shape: unknown) =>
          (value as ToolRegistration).call(target, name, description, shape, (args: unknown) => surface.call(name, args));
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
