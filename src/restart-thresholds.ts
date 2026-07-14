import { readFileSync } from "fs";

export type ContextBand = "unknown" | "ok" | "prepare" | "warn" | "recommend" | "require";

export interface RestartThresholds {
  prepare: number;
  warn: number;
  recommend: number;
  require: number;
}

export type RestartThresholdOverrides = Partial<RestartThresholds>;

export interface ContextMetricInput {
  context_used_ratio?: number;
  context_tokens?: number;
  context_window_tokens?: number;
}

export interface ContextSignal {
  source: "host_metrics" | "estimated";
  usage_ratio: number | null;
  band: ContextBand;
  thresholds: RestartThresholds;
}

export const DEFAULT_RESTART_THRESHOLDS: RestartThresholds = {
  prepare: 0.7,
  warn: 0.8,
  recommend: 0.9,
  require: 0.95,
};

export function loadRestartThresholdConfig(path?: string): RestartThresholdOverrides | undefined {
  if (!path) return undefined;
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("restart threshold config must be a JSON object");
  }
  return parsed as RestartThresholdOverrides;
}

export function normalizeRestartThresholds(overrides?: RestartThresholdOverrides): RestartThresholds {
  const thresholds = { ...DEFAULT_RESTART_THRESHOLDS, ...(overrides ?? {}) };
  for (const key of ["prepare", "warn", "recommend", "require"] as const) {
    const value = thresholds[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`restart threshold ${key} must be a finite number between 0 and 1`);
    }
  }
  if (
    thresholds.prepare >= thresholds.warn ||
    thresholds.warn >= thresholds.recommend ||
    thresholds.recommend >= thresholds.require
  ) {
    throw new Error("restart thresholds must be strictly increasing: prepare < warn < recommend < require");
  }
  return {
    prepare: Number(thresholds.prepare.toFixed(4)),
    warn: Number(thresholds.warn.toFixed(4)),
    recommend: Number(thresholds.recommend.toFixed(4)),
    require: Number(thresholds.require.toFixed(4)),
  };
}

export function contextUsageRatio(input: ContextMetricInput): number | null {
  let ratio: number | null = null;
  if (typeof input.context_used_ratio === "number") {
    ratio = input.context_used_ratio;
  } else if (
    typeof input.context_tokens === "number" &&
    typeof input.context_window_tokens === "number" &&
    input.context_window_tokens > 0
  ) {
    ratio = input.context_tokens / input.context_window_tokens;
  }

  if (ratio === null || Number.isNaN(ratio)) return null;
  return Math.max(0, Math.min(1, ratio));
}

export function classifyContextSignal(
  input: ContextMetricInput,
  overrides?: RestartThresholdOverrides
): ContextSignal {
  const thresholds = normalizeRestartThresholds(overrides);
  const ratio = contextUsageRatio(input);
  if (ratio === null) {
    return { source: "estimated", usage_ratio: null, band: "unknown", thresholds };
  }

  const bounded = Number(ratio.toFixed(4));
  const band =
    bounded >= thresholds.require ? "require" :
    bounded >= thresholds.recommend ? "recommend" :
    bounded >= thresholds.warn ? "warn" :
    bounded >= thresholds.prepare ? "prepare" :
    "ok";
  return { source: "host_metrics", usage_ratio: bounded, band, thresholds };
}
