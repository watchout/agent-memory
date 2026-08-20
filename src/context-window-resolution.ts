/**
 * Context-window resolution and band judgment for the context-threshold restart chain.
 *
 * Control source: watchout/agent-memory#250 (CELL-KUSABI-CTX-RESTART-001), stage S1.
 * Design: DN-KUSABI-CTXR-THRESHOLD-20260820-001, candidate table
 * DN-KUSABI-CTXR-WINDOW-TABLE-20260820-001, fixtures DN-KUSABI-CTXR-FIXTURES-20260820-002.
 *
 * Pure judgment only. Nothing here reads a store, writes evidence, or restarts anything.
 */

export type ContextBand = "ok" | "prepare" | "warn" | "recommend" | "require";
export type ResolutionStatus = "resolved" | "unresolved";
export type WindowSource = "env" | "marker" | "table";

export type UnresolvedReason =
  | "model_unresolved"
  | "context_window_unresolved"
  | "context_window_ambiguous"
  | "window_table_stale"
  | "measured_exceeds_window";

/**
 * Context window per model, in tokens.
 *
 * Source: Anthropic model catalog as carried by the claude-api skill, cached 2026-06-24.
 * The live authority is the Models API `max_input_tokens`; re-confirm there when
 * credentials are available. An empty array means the window is not established yet —
 * resolution then fails closed rather than guessing.
 */
export const CONTEXT_WINDOW_CANDIDATES: Readonly<Record<string, readonly number[]>> = {
  "claude-fable-5": [1_000_000],
  "claude-mythos-5": [1_000_000],
  "claude-opus-5": [1_000_000],
  "claude-opus-4-8": [1_000_000],
  "claude-opus-4-7": [1_000_000],
  "claude-opus-4-6": [1_000_000],
  "claude-sonnet-5": [1_000_000],
  "claude-sonnet-4-6": [1_000_000],
  "claude-haiku-4-5": [200_000],
  "gpt-5.6-sol": [],
  "gemini-3.5-flash": [],
};

const BAND_THRESHOLDS: ReadonlyArray<readonly [ContextBand, number]> = [
  ["require", 0.95],
  ["recommend", 0.9],
  ["warn", 0.8],
  ["prepare", 0.7],
];

/** Placeholder the Claude transcript writes for non-model records. */
const SYNTHETIC_MODEL = "<synthetic>";

export interface ContextHealthJudgment {
  model: string | null;
  model_alias: string | null;
  context_window_tokens: number | null;
  window_source: WindowSource | null;
  window_candidates: readonly number[];
  measured_context_tokens: number;
  used_ratio: number | null;
  band: ContextBand | "unknown";
  resolution_status: ResolutionStatus;
  reason: UnresolvedReason | null;
  restart_recommended: boolean;
  restart_required: boolean;
}

export interface JudgeContextHealthInput {
  measuredContextTokens: number;
  /** Model id as recorded by the host, dated or aliased. */
  model?: string | null;
  /** Host label used for the env override key, e.g. "claude". */
  host?: string | null;
  /** Window supplied by a restart marker, if any. Ranks below an env override. */
  markerWindowTokens?: number | null;
  /** Environment to read overrides from. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  candidates?: Readonly<Record<string, readonly number[]>>;
}

/** Strip a dated suffix so `claude-haiku-4-5-20251001` matches its catalog alias. */
export function normalizeModelAlias(modelId: string): string {
  return modelId.replace(/-\d{8}$/, "");
}

/**
 * Resolve the session model from transcript lines.
 *
 * Reads the structured `model` field only. A substring search over the transcript
 * matches model names quoted in prose and misattributes the session, which would
 * scale a 1M-window session against a 200K window and produce a false `require`.
 */
export function resolveModelFromTranscriptLines(lines: Iterable<string>): string | null {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const model = extractModelField(record);
    if (!model || model === SYNTHETIC_MODEL) continue;
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  let dominant: string | null = null;
  let best = 0;
  for (const [model, count] of counts) {
    if (count > best) {
      dominant = model;
      best = count;
    }
  }
  return dominant;
}

function extractModelField(record: unknown): string | null {
  if (typeof record !== "object" || record === null) return null;
  const top = (record as { model?: unknown }).model;
  if (typeof top === "string" && top) return top;
  const message = (record as { message?: unknown }).message;
  if (typeof message === "object" && message !== null) {
    const nested = (message as { model?: unknown }).model;
    if (typeof nested === "string" && nested) return nested;
  }
  return null;
}

function envWindowTokens(env: NodeJS.ProcessEnv, host: string | null): number | null {
  const keys = host
    ? [`AGENT_MEMORY_${host.toUpperCase()}_CONTEXT_WINDOW_TOKENS`, "AGENT_MEMORY_CONTEXT_WINDOW_TOKENS"]
    : ["AGENT_MEMORY_CONTEXT_WINDOW_TOKENS"];
  for (const key of keys) {
    const raw = env[key];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

export function bandFromRatio(ratio: number): ContextBand {
  for (const [band, threshold] of BAND_THRESHOLDS) {
    if (ratio >= threshold) return band;
  }
  return "ok";
}

/**
 * Decide whether a measured context reading warrants a restart band.
 *
 * Resolution order for the window: env override, then marker, then the model table.
 * Anything that cannot be resolved to exactly one window returns `band: "unknown"`
 * with a named reason and `resolution_status: "unresolved"`, so a seat that cannot be
 * judged is visible rather than indistinguishable from a healthy one.
 */
export function judgeContextHealth(input: JudgeContextHealthInput): ContextHealthJudgment {
  const env = input.env ?? process.env;
  const table = input.candidates ?? CONTEXT_WINDOW_CANDIDATES;
  const model = input.model ?? null;
  const alias = model ? normalizeModelAlias(model) : null;

  const base = {
    model,
    model_alias: alias,
    measured_context_tokens: input.measuredContextTokens,
    used_ratio: null,
    band: "unknown",
    restart_recommended: false,
    restart_required: false,
  } as const;

  const envWindow = envWindowTokens(env, input.host ?? null);
  const markerWindow =
    typeof input.markerWindowTokens === "number" && input.markerWindowTokens > 0
      ? input.markerWindowTokens
      : null;

  let window: number | null = null;
  let source: WindowSource | null = null;
  let candidates: readonly number[] = [];

  if (envWindow !== null) {
    window = envWindow;
    source = "env";
    candidates = [envWindow];
  } else if (markerWindow !== null) {
    window = markerWindow;
    source = "marker";
    candidates = [markerWindow];
  } else if (alias === null) {
    return { ...base, context_window_tokens: null, window_source: null, window_candidates: [], resolution_status: "unresolved", reason: "model_unresolved" };
  } else {
    candidates = table[alias] ?? [];
    if (candidates.length === 1) {
      window = candidates[0];
      source = "table";
    } else {
      return {
        ...base,
        context_window_tokens: null,
        window_source: null,
        window_candidates: candidates,
        resolution_status: "unresolved",
        reason: candidates.length === 0 ? "context_window_unresolved" : "context_window_ambiguous",
      };
    }
  }

  if (input.measuredContextTokens > window) {
    // The measurement contradicts the window. Clamping the ratio to 1 here would
    // publish `require` on the strength of a stale table entry, so decline instead.
    return {
      ...base,
      context_window_tokens: window,
      window_source: source,
      window_candidates: candidates,
      resolution_status: "unresolved",
      reason: source === "table" ? "window_table_stale" : "measured_exceeds_window",
    };
  }

  const ratio = input.measuredContextTokens / window;
  const band = bandFromRatio(ratio);
  return {
    ...base,
    context_window_tokens: window,
    window_source: source,
    window_candidates: candidates,
    used_ratio: Number(ratio.toFixed(4)),
    band,
    resolution_status: "resolved",
    reason: null,
    restart_recommended: band === "recommend" || band === "require",
    restart_required: band === "require",
  };
}
