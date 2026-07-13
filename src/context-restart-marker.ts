import { randomBytes } from "crypto";
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
  host_id: string;
  host_adapter_id: string;
  seat_id?: string;
  session_id?: string;
  marker_id?: string;
  context_used_ratio?: number;
  context_tokens?: number;
  context_window_tokens?: number;
  runtime_context_error?: boolean;
  thresholds?: RestartThresholdOverrides;
  generated_at?: string;
}

export interface RestartRequiredMarkerV1 {
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

export interface RestartRequiredMarkerV2 extends Omit<RestartRequiredMarkerV1, "schema_version"> {
  schema_version: "wasurezu-restart-marker/v2";
  marker_id: string;
  host_id: string;
  host_adapter_id: string;
}

export type RestartRequiredMarker = RestartRequiredMarkerV1 | RestartRequiredMarkerV2;

export interface WriteRestartMarkerInput extends RestartMarkerInput {
  marker_path?: string;
  marker_dir?: string;
}

export interface WriteRestartMarkerResult {
  marker_path: string;
  marker: RestartRequiredMarkerV2;
}

export function buildRestartMarker(input: RestartMarkerInput): RestartRequiredMarkerV2 {
  const signal = classifyContextSignal(input, input.thresholds);
  const runtimeContextError = input.runtime_context_error === true;
  const restartRequired = runtimeContextError || signal.band === "require";
  const reason = runtimeContextError
    ? "runtime_context_error"
    : restartRequired
      ? "context_band_require"
      : `context_band_${signal.band}`;
  const generatedAt = input.generated_at ?? new Date().toISOString();
  const hostId = requiredNonEmpty("host_id", input.host_id);
  const hostAdapterId = requiredNonEmpty("host_adapter_id", input.host_adapter_id);
  return {
    schema_version: "wasurezu-restart-marker/v2",
    marker_id: input.marker_id ?? mintUuidV7(generatedAt),
    status: restartRequired ? "restart_required" : "restart_not_required",
    restart_required: restartRequired,
    reason,
    agent_id: input.agent_id,
    ...(input.project ? { project: input.project } : {}),
    ...(input.host ? { host: input.host } : {}),
    host_id: hostId,
    host_adapter_id: hostAdapterId,
    ...(input.seat_id ? { seat_id: input.seat_id } : {}),
    ...(input.session_id ? { session_id: input.session_id } : {}),
    generated_at: generatedAt,
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

function requiredNonEmpty(name: string, value: string | undefined): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`restart marker v2 requires ${name}`);
  }
  return value.trim();
}

function mintUuidV7(generatedAt: string): string {
  const date = new Date(generatedAt);
  const timestamp = BigInt(Number.isFinite(date.getTime()) ? date.getTime() : Date.now());
  const bytes = randomBytes(16);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number((timestamp >> BigInt((5 - i) * 8)) & 0xffn);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
