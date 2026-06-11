import { readFileSync } from "fs";
import type { Store } from "./stores/types.js";
import {
  prepareClaudeResession,
  type ClaudeResessionRunnerResult,
} from "./claude-start.js";
import {
  preflightRestartCommand,
  type RestartCommandPreflightResult,
} from "./restart-command-preflight.js";

export type ClaudeMarkerControllerOutcome =
  | "prepared"
  | "blocked"
  | "degraded"
  | "skipped"
  | "failed";

export interface ClaudeRestartMarker {
  status?: string;
  reason?: string;
  project?: string;
  host?: string;
  session_id?: string;
  generated_at?: string;
  measured_context_tokens?: number;
  context_tokens?: number;
  context_window_tokens?: number;
  context_used_ratio?: number;
  runtime_context_error?: boolean;
}

export interface ClaudeMarkerControllerInput {
  store: Store;
  agentId: string;
  markerPath?: string;
  marker?: unknown;
  restartCommand?: string;
  env?: NodeJS.ProcessEnv;
  project?: string;
  launchRequested?: boolean;
  aunInstalled?: boolean;
  aunAbsentConfirmed?: boolean;
  supervisorAvailable?: boolean;
  restartPreauthorized?: boolean;
}

export interface ClaudeMarkerControllerResult {
  controller: "wasurezu-claude-marker-controller";
  marker_path: string | null;
  marker_status: "restart_required" | "ignored" | "invalid";
  reason: string | null;
  project?: string;
  host?: string;
  session_id?: string;
  runner: "wasurezu-claude-start";
  command: RestartCommandPreflightResult;
  launch_requested: boolean;
  launch_permitted: boolean;
  executed_restart: false;
  outcome: ClaudeMarkerControllerOutcome;
  failure_class: string | null;
  selected_pack_ref: string | null;
  confidence: ClaudeResessionRunnerResult["prepare"]["recovery_confidence"];
  missing_context: string[];
  launch_blockers: string[];
  prepare: ClaudeResessionRunnerResult["prepare"];
  notes: string[];
}

export async function controlClaudeRestartMarker(
  input: ClaudeMarkerControllerInput
): Promise<ClaudeMarkerControllerResult> {
  const marker = normalizeMarker(input.marker ?? loadMarker(input.markerPath));
  const markerStatus = marker.status === "restart_required" ? "restart_required" : marker.status ? "ignored" : "invalid";
  const project = input.project ?? marker.project;
  const contextTokens = numeric(marker.context_tokens) ?? numeric(marker.measured_context_tokens);
  const contextWindowTokens = numeric(marker.context_window_tokens);
  const contextUsedRatio = numeric(marker.context_used_ratio) ?? ratioFromTokens(contextTokens, contextWindowTokens);
  const metricAbsent = contextUsedRatio === undefined && contextTokens === undefined && marker.runtime_context_error !== true;
  const runtimeContextError = marker.runtime_context_error === true || (markerStatus === "restart_required" && metricAbsent);

  const command = preflightRestartCommand({
    command: input.restartCommand,
    env: input.env,
    restartPreauthorized: input.restartPreauthorized,
  });

  const runner = await prepareClaudeResession(input.store, {
    agentId: input.agentId,
    project,
    continuityGuardMode: "auto_restart",
    packInjectionMode: "auto_attach",
    contextUsedRatio,
    contextTokens,
    contextWindowTokens,
    runtimeContextError,
    aunInstalled: input.aunInstalled,
    aunAbsentConfirmed: input.aunAbsentConfirmed,
    supervisorAvailable: input.supervisorAvailable,
    restartPreauthorized: input.restartPreauthorized,
    launch: input.launchRequested === true,
    emitPack: false,
  });

  const launchBlockers = Array.from(new Set([...runner.launch_blockers, ...command.reasons]));
  const launchPermitted =
    markerStatus === "restart_required" &&
    command.status === "pass" &&
    runner.prepare.can_auto_restart &&
    runner.launch_blockers.length === 0;

  const failureClass = failureClassFor({
    markerStatus,
    command,
    launchBlockers,
    canAutoRestart: runner.prepare.can_auto_restart,
  });

  return {
    controller: "wasurezu-claude-marker-controller",
    marker_path: input.markerPath ?? null,
    marker_status: markerStatus,
    reason: marker.reason ?? null,
    ...(project ? { project } : {}),
    ...(marker.host ? { host: marker.host } : {}),
    ...(marker.session_id ? { session_id: marker.session_id } : {}),
    runner: "wasurezu-claude-start",
    command,
    launch_requested: input.launchRequested === true,
    launch_permitted: launchPermitted,
    executed_restart: false,
    outcome: outcomeFor({
      markerStatus,
      command,
      launchPermitted,
      canAutoRestart: runner.prepare.can_auto_restart,
      metricAbsent,
    }),
    failure_class: failureClass,
    selected_pack_ref: runner.prepare.pack_ref,
    confidence: runner.prepare.recovery_confidence,
    missing_context: runner.prepare.recovery_confidence.missing_context,
    launch_blockers: launchBlockers,
    prepare: runner.prepare,
    notes: [
      "restart-required markers are input evidence only; this controller does not execute a live restart.",
      "wasurezu-claude-start owns selected-pack preparation and launch gating.",
      "SessionStart remains a selected-pack load hook, not the restart policy owner.",
      ...(metricAbsent ? ["marker did not provide host context metrics; continuity signal is estimated."] : []),
    ],
  };
}

function loadMarker(markerPath?: string): unknown {
  if (!markerPath) return {};
  return JSON.parse(readFileSync(markerPath, "utf8"));
}

function normalizeMarker(value: unknown): ClaudeRestartMarker {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    status: stringValue(record.status),
    reason: stringValue(record.reason),
    project: stringValue(record.project),
    host: stringValue(record.host),
    session_id: stringValue(record.session_id ?? record.sessionId),
    generated_at: stringValue(record.generated_at ?? record.generatedAt),
    measured_context_tokens: numeric(record.measured_context_tokens ?? record.measuredContextTokens),
    context_tokens: numeric(record.context_tokens ?? record.contextTokens),
    context_window_tokens: numeric(record.context_window_tokens ?? record.contextWindowTokens),
    context_used_ratio: numeric(record.context_used_ratio ?? record.contextUsedRatio),
    runtime_context_error: record.runtime_context_error === true || record.runtimeContextError === true,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function ratioFromTokens(contextTokens?: number, contextWindowTokens?: number): number | undefined {
  if (contextTokens === undefined || contextWindowTokens === undefined || contextWindowTokens <= 0) return undefined;
  return Math.max(0, Math.min(1, contextTokens / contextWindowTokens));
}

function failureClassFor(input: {
  markerStatus: ClaudeMarkerControllerResult["marker_status"];
  command: RestartCommandPreflightResult;
  launchBlockers: string[];
  canAutoRestart: boolean;
}): string | null {
  if (input.markerStatus === "invalid") return "marker_invalid";
  if (input.markerStatus === "ignored") return "marker_not_restart_required";
  if (input.command.status === "fail") return input.command.reasons[0] ?? "restart_command_preflight_failed";
  if (!input.canAutoRestart) return input.launchBlockers[0] ?? "auto_restart_blocked";
  return null;
}

function outcomeFor(input: {
  markerStatus: ClaudeMarkerControllerResult["marker_status"];
  command: RestartCommandPreflightResult;
  launchPermitted: boolean;
  canAutoRestart: boolean;
  metricAbsent: boolean;
}): ClaudeMarkerControllerOutcome {
  if (input.markerStatus === "invalid") return "failed";
  if (input.markerStatus === "ignored") return "skipped";
  if (input.command.status === "fail" || !input.canAutoRestart) return "blocked";
  if (input.metricAbsent) return "degraded";
  return input.launchPermitted ? "prepared" : "blocked";
}
