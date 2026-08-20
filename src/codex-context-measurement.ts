/**
 * Codex context measurement — extract the current context size and the host-reported
 * window from a codex rollout transcript.
 *
 * Control source: watchout/agent-memory#250 (CELL-KUSABI-CTX-RESTART-001), stage S3a.
 * Design: DN-KUSABI-CTXR-HOST-MEASUREMENT-20260821-001.
 *
 * Extraction only. Nothing here judges a band, writes a record, or restarts anything;
 * the judgment layer consumes the normalized result.
 *
 * Why this is a codex-specific adapter rather than a shared parser: `input_tokens` means
 * the opposite thing on the two hosts. A claude transcript reports it excluding cache, so
 * the context size is input + cache_creation + cache_read. A codex transcript reports it
 * already including `cached_input_tokens`, so the context size is `input_tokens` alone and
 * adding the cached figure double-counts it.
 */

export type CodexMeasurementStatus = "measured" | "unmeasured";

export type CodexMeasurementReason =
  | "no_token_count_record"
  | "usage_field_missing"
  | "window_missing";

export type CodexWindowSource = "host_reported";

export interface CodexContextMeasurement {
  session_id: string | null;
  model: string | null;
  measured_context_tokens: number | null;
  context_window_tokens: number | null;
  window_source: CodexWindowSource | null;
  token_count_records: number;
  status: CodexMeasurementStatus;
  reason: CodexMeasurementReason | null;
}

interface TokenCountObservation {
  inputTokens: number | null;
  windowTokens: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Read the current context size from one `token_count` payload.
 *
 * `last_token_usage` is the size of the prompt for the most recent turn, which is the
 * current context. `total_token_usage` accumulates over the whole session and reached
 * 207,705,683 in one observed 258,400-window session, so it is never a context measure.
 */
function readTokenCount(payload: Record<string, unknown>): TokenCountObservation | null {
  const info = payload.info;
  if (!isRecord(info)) return null;
  const last = info.last_token_usage;
  const inputTokens = isRecord(last) ? positiveInteger(last.input_tokens) : null;
  const windowTokens = positiveInteger(info.model_context_window);
  if (inputTokens === null && windowTokens === null) return null;
  return { inputTokens, windowTokens };
}

/**
 * Extract the measurement from codex rollout transcript lines.
 *
 * The last `token_count` record wins. That is what makes the result correct across a
 * compaction: a compacted session reports a smaller prompt on its next turn, and reading
 * the maximum or the first record would keep reporting a context that no longer exists.
 *
 * Malformed lines are skipped rather than fatal. The rollout file is appended while the
 * session runs, so the final line can be a partial write.
 */
export function measureCodexContextFromTranscriptLines(
  lines: Iterable<string>
): CodexContextMeasurement {
  let sessionId: string | null = null;
  let model: string | null = null;
  let latest: TokenCountObservation | null = null;
  let tokenCountRecords = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(record)) continue;
    const payload = record.payload;
    if (!isRecord(payload)) continue;

    if (record.type === "session_meta") {
      sessionId = nonEmptyText(payload.session_id) ?? sessionId;
      continue;
    }
    if (record.type === "turn_context") {
      // Structured field only. A substring search over the transcript matches model names
      // quoted inside instructions and misattributes the session.
      model = nonEmptyText(payload.model) ?? model;
      continue;
    }
    if (payload.type === "token_count") {
      const observation = readTokenCount(payload);
      if (observation) {
        tokenCountRecords += 1;
        latest = observation;
      }
    }
  }

  if (latest === null) {
    return {
      session_id: sessionId,
      model,
      measured_context_tokens: null,
      context_window_tokens: null,
      window_source: null,
      token_count_records: 0,
      status: "unmeasured",
      reason: "no_token_count_record",
    };
  }

  const base = {
    session_id: sessionId,
    model,
    measured_context_tokens: latest.inputTokens,
    context_window_tokens: latest.windowTokens,
    window_source: latest.windowTokens === null ? null : ("host_reported" as const),
    token_count_records: tokenCountRecords,
  };

  if (latest.inputTokens === null) {
    return { ...base, status: "unmeasured", reason: "usage_field_missing" };
  }
  if (latest.windowTokens === null) {
    // The measurement is usable; only the denominator is absent. The caller falls back to
    // its env override or model table, and the judgment layer reports unresolved if neither
    // supplies one.
    return { ...base, status: "unmeasured", reason: "window_missing" };
  }
  return { ...base, status: "measured", reason: null };
}
