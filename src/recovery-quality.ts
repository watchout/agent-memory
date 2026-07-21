import type { MarkRecoveryContinuedInput } from "./stores/types.js";

export const RECOVERY_CONTINUATION_WINDOW_MS = 10 * 60 * 1000;
export const OBSERVED_CONTINUATION_QUALITY_SCORE = 1;
export const OBSERVED_CONTINUATION_SCORE_MODEL = "binary_observed_continuation_v1";
export const RECOVERY_CONTINUATION_ACTION_TOOLS = Object.freeze([
  "log_decision",
  "supersede_decision",
  "save_task_state",
  "set_recovery_config",
  "save_knowledge",
  "supersede_knowledge",
  "update_knowledge_status",
  "ingest_conversation_events",
  "catch_up",
] as const);

export interface RecoveryContinuationUpdateTarget {
  markRecoveryContinued(input: MarkRecoveryContinuedInput): Promise<boolean>;
}

export interface RecoveryContinuationObservation {
  status: "no_pending_recovery" | "ignored_non_continuation_tool" | "expired" | "recorded" | "already_recorded_or_mismatched";
  log_id?: string;
}

interface PendingRecovery {
  log_id: string;
  notes: string;
  armed_at_ms: number;
}

function recoveryNotes(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Preserve malformed legacy notes as data rather than dropping them.
  }
  return value ? { prior_notes: value } : {};
}

export function observedContinuationNotes(
  notes: string,
  tool: string,
  observedAtMs: number,
): string {
  return JSON.stringify({
    ...recoveryNotes(notes),
    task_continued_observation: {
      source: "mcp_post_recovery_tool_call",
      tool,
      observed_at: new Date(observedAtMs).toISOString(),
      window_ms: RECOVERY_CONTINUATION_WINDOW_MS,
    },
    quality_score_model: OBSERVED_CONTINUATION_SCORE_MODEL,
  });
}

export function isRecoveryContinuationAction(tool: string): boolean {
  return (RECOVERY_CONTINUATION_ACTION_TOOLS as readonly string[]).includes(tool);
}

/**
 * Tracks the newest recover_context row in one MCP server process.
 *
 * A repeated recover_context replaces the pending row. The first later
 * eligible state/action tool call is the post-action observation required by
 * the recovery quality contract; recovery-only reads leave it pending.
 * Store-side exact binding and compare-and-set make the write safe across
 * agents, sessions, and duplicate observations.
 */
export class RecoveryContinuationTracker {
  private pending: PendingRecovery | undefined;

  constructor(
    private readonly agentId: string,
    private readonly sessionId: string,
  ) {}

  arm(logId: string, notes: string, armedAtMs = Date.now()): void {
    this.pending = logId ? { log_id: logId, notes, armed_at_ms: armedAtMs } : undefined;
  }

  async observe(
    target: RecoveryContinuationUpdateTarget,
    tool: string,
    observedAtMs = Date.now(),
  ): Promise<RecoveryContinuationObservation> {
    if (!this.pending) return { status: "no_pending_recovery" };
    if (!isRecoveryContinuationAction(tool)) {
      return { status: "ignored_non_continuation_tool", log_id: this.pending.log_id };
    }

    const pending = this.pending;
    if (observedAtMs < pending.armed_at_ms ||
        observedAtMs - pending.armed_at_ms > RECOVERY_CONTINUATION_WINDOW_MS) {
      this.pending = undefined;
      return { status: "expired", log_id: pending.log_id };
    }

    const updated = await target.markRecoveryContinued({
      id: pending.log_id,
      agent_id: this.agentId,
      session_id: this.sessionId,
      quality_score: OBSERVED_CONTINUATION_QUALITY_SCORE,
      notes: observedContinuationNotes(pending.notes, tool, observedAtMs),
    });
    this.pending = undefined;
    return {
      status: updated ? "recorded" : "already_recorded_or_mismatched",
      log_id: pending.log_id,
    };
  }
}
