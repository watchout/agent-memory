import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  classifyContextSignal,
  type ContextSignal,
  type RestartThresholdOverrides,
  type RestartThresholds,
} from "./restart-thresholds.js";

export interface RestartMarkerInput {
  agent_id: string;
  project?: string;
  host?: string;
  seat_id?: string;
  session_id?: string;
  context_used_ratio?: number;
  context_tokens?: number;
  context_window_tokens?: number;
  runtime_context_error?: boolean;
  thresholds?: RestartThresholdOverrides;
  generated_at?: string;
}

export interface RestartRequiredMarker {
  schema_version: "wasurezu-restart-marker/v1";
  status: "restart_required" | "restart_not_required";
  restart_required: boolean;
  reason: string;
  agent_id: string;
  project?: string;
  host?: string;
  seat_id?: string;
  session_id?: string;
  generated_at: string;
  measured_context_tokens?: number;
  context_tokens?: number;
  context_window_tokens?: number;
  context_used_ratio: number | null;
  runtime_context_error: boolean;
  band: ContextSignal["band"];
  thresholds: RestartThresholds;
}

export interface WriteRestartMarkerInput extends RestartMarkerInput {
  marker_path?: string;
  marker_dir?: string;
}

export interface WriteRestartMarkerResult {
  marker_path: string;
  marker: RestartRequiredMarker;
}

export function buildRestartMarker(input: RestartMarkerInput): RestartRequiredMarker {
  const signal = classifyContextSignal(input, input.thresholds);
  const runtimeContextError = input.runtime_context_error === true;
  const restartRequired = runtimeContextError || signal.band === "require";
  const reason = runtimeContextError
    ? "runtime_context_error"
    : restartRequired
      ? "context_band_require"
      : `context_band_${signal.band}`;
  return {
    schema_version: "wasurezu-restart-marker/v1",
    status: restartRequired ? "restart_required" : "restart_not_required",
    restart_required: restartRequired,
    reason,
    agent_id: input.agent_id,
    ...(input.project ? { project: input.project } : {}),
    ...(input.host ? { host: input.host } : {}),
    ...(input.seat_id ? { seat_id: input.seat_id } : {}),
    ...(input.session_id ? { session_id: input.session_id } : {}),
    generated_at: input.generated_at ?? new Date().toISOString(),
    ...(typeof input.context_tokens === "number" ? { measured_context_tokens: input.context_tokens } : {}),
    ...(typeof input.context_tokens === "number" ? { context_tokens: input.context_tokens } : {}),
    ...(typeof input.context_window_tokens === "number" ? { context_window_tokens: input.context_window_tokens } : {}),
    context_used_ratio: signal.usage_ratio,
    runtime_context_error: runtimeContextError,
    band: signal.band,
    thresholds: signal.thresholds,
  };
}

export function writeRestartMarker(input: WriteRestartMarkerInput): WriteRestartMarkerResult {
  const marker = buildRestartMarker(input);
  const markerPath = input.marker_path ?? join(input.marker_dir ?? process.cwd(), "restart-required.json");
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  return { marker_path: markerPath, marker };
}
