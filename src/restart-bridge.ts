import { spawn } from "child_process";
import { createHash } from "crypto";
import { lstatSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import pg from "pg";
import {
  preflightRestartCommand,
  type RestartCommandPreflightResult,
  type RestartHostAdapterRegistry,
} from "./restart-command-preflight.js";
import type { RestartRequiredMarker, RestartRequiredMarkerV2 } from "./context-restart-marker.js";
import type { RestartEvent, Store } from "./stores/types.js";

const { Pool } = pg;

export type QueueCheckMode = "agent_comms_configured" | "agent_comms_missing" | "standalone_supervisor" | "pure_mcp";
export type QueueCheckResult = "pass" | "blocked" | "unavailable";
export type RestartLifecycleMode = "aun_supervised" | "standalone_supervisor" | "pure_mcp";

export interface QueueDrainCheckResult {
  mode: QueueCheckMode;
  result: QueueCheckResult;
  allowed: boolean;
  in_flight_count: number;
  in_flight_queue_ids: string[];
  failure_reason?: string;
}

export interface RestartRuntimeAuthority {
  lifecycle_mode: RestartLifecycleMode;
  agent_id: string;
  project?: string;
  seat_id?: string;
  host_id: string;
  session_id: string;
  host_adapter_id: string;
  supervisor_id?: string;
  supervisor_available?: boolean;
  restart_preauthorized: boolean;
  authority_ref: string;
  issued_at?: string;
  expires_at: string;
  row_version: number;
  aun_absent_confirmed?: boolean;
}

export interface RestartBridgeInput {
  store: Store;
  agentId: string;
  project?: string;
  markerPath?: string;
  markerDir?: string;
  restartCommand?: string;
  restartArgv?: readonly string[];
  restartPreauthorized?: boolean;
  execute?: boolean;
  env?: NodeJS.ProcessEnv;
  agentCommsDatabaseUrl?: string;
  queueDrainCheck?: (agentId: string) => Promise<QueueDrainCheckResult>;
  runtimeAuthority?: RestartRuntimeAuthority;
  hostAdapterId?: string;
  adapterRegistry?: RestartHostAdapterRegistry;
  now?: string | Date;
  markerMaxAgeSeconds?: number;
  markerFutureSkewSeconds?: number;
}

export interface RestartBridgeResult {
  bridge: "wasurezu-restart bridge";
  marker_path: string | null;
  marker_status: "restart_required" | "restart_not_required" | "ignored" | "missing" | "invalid";
  action: "bridge_no_marker" | "bridge_marker_not_required" | "restart_blocked" | "restart_dry_run" | "restart_executed" | "restart_failed";
  executed_restart: boolean;
  dry_run: boolean;
  command: RestartCommandPreflightResult | null;
  queue_check: QueueDrainCheckResult | null;
  event: RestartEvent;
  failure_reason: string | null;
}

interface LoadedMarker {
  path: string;
  marker: RestartRequiredMarkerV2;
  canonical_json: string;
  marker_digest: string;
}

type MarkerLoadResult =
  | { status: "loaded"; loaded: LoadedMarker }
  | { status: "missing"; failure_reason: string; marker_path: string | null }
  | { status: "invalid"; failure_reason: string; marker_path: string | null; marker?: Partial<RestartRequiredMarker> };

interface LifecycleEvaluation {
  allowed: boolean;
  failure_reason?: string;
  queueCheck: QueueDrainCheckResult | null;
}

export async function runRestartBridge(input: RestartBridgeInput): Promise<RestartBridgeResult> {
  const now = asDate(input.now);
  const dryRun = input.execute !== true;
  const loadedResult = loadExecutableMarker(input, now);
  if (loadedResult.status !== "loaded") {
    const markerStatus = loadedResult.status === "missing" ? "missing" : "invalid";
    const event = await saveRawRestartEvent(input, {
      action: loadedResult.status === "missing" ? "bridge_no_marker" : "restart_blocked",
      markerPath: loadedResult.marker_path,
      marker: loadedResult.status === "invalid" ? loadedResult.marker : undefined,
      markerStatus,
      executedRestart: false,
      failureReason: loadedResult.failure_reason,
      postState: { blocked: loadedResult.status !== "missing" },
    });
    return {
      bridge: "wasurezu-restart bridge",
      marker_path: loadedResult.marker_path,
      marker_status: markerStatus,
      action: loadedResult.status === "missing" ? "bridge_no_marker" : "restart_blocked",
      executed_restart: false,
      dry_run: dryRun,
      command: null,
      queue_check: null,
      event,
      failure_reason: loadedResult.failure_reason,
    };
  }

  const loaded = loadedResult.loaded;
  const marker = loaded.marker;
  if (marker.status === "restart_not_required" && marker.restart_required === false) {
    const event = await saveBridgeEvent(input, loaded, {
      action: "bridge_marker_not_required",
      command: null,
      queueCheck: null,
      executedRestart: false,
      failureReason: "marker_not_restart_required",
      postState: { skipped: true },
      phase: "not_required",
    });
    return {
      bridge: "wasurezu-restart bridge",
      marker_path: loaded.path,
      marker_status: "restart_not_required",
      action: "bridge_marker_not_required",
      executed_restart: false,
      dry_run: dryRun,
      command: null,
      queue_check: null,
      event,
      failure_reason: "marker_not_restart_required",
    };
  }

  const hostAdapterId = input.hostAdapterId ?? input.runtimeAuthority?.host_adapter_id ?? marker.host_adapter_id;
  const command = preflightRestartCommand({
    command: input.restartCommand,
    argv: input.restartArgv,
    restartPreauthorized: input.runtimeAuthority?.restart_preauthorized ?? input.restartPreauthorized,
    env: input.env,
    hostAdapterId,
    adapterRegistry: input.adapterRegistry,
  });
  if (command.status === "fail") {
    const failureReason = command.reasons[0] ?? "restart_command_preflight_failed";
    const event = await saveBridgeEvent(input, loaded, {
      action: "restart_blocked",
      command,
      queueCheck: null,
      executedRestart: false,
      failureReason,
      postState: { blocked: true },
      phase: "preflight_block",
    });
    return blockedResult(input, loaded, command, null, event, failureReason);
  }

  const lifecycle = await evaluateLifecycleAuthority(input, loaded, now);
  if (!lifecycle.allowed || (input.execute === true && input.runtimeAuthority?.lifecycle_mode === "aun_supervised")) {
    const failureReason = lifecycle.failure_reason
      ?? (input.runtimeAuthority?.lifecycle_mode === "aun_supervised" ? "aun_supervised_local_restart_forbidden" : "lifecycle_authority_unknown_or_blocked");
    const event = await saveBridgeEvent(input, loaded, {
      action: "restart_blocked",
      command,
      queueCheck: lifecycle.queueCheck,
      executedRestart: false,
      failureReason,
      postState: { blocked: true },
      phase: "lifecycle_block",
    });
    return blockedResult(input, loaded, command, lifecycle.queueCheck, event, failureReason);
  }

  const claim = await claimMarker(input, loaded);
  if (claim.failure_reason) {
    const event = await saveBridgeEvent(input, loaded, {
      action: "restart_blocked",
      command,
      queueCheck: lifecycle.queueCheck,
      executedRestart: false,
      failureReason: claim.failure_reason,
      postState: { blocked: true, claim_event_id: claim.event.event_id ?? null },
      phase: "claim_block",
    });
    return blockedResult(input, loaded, command, lifecycle.queueCheck, event, claim.failure_reason);
  }

  if (input.execute !== true) {
    const event = await saveBridgeEvent(input, loaded, {
      action: "restart_dry_run",
      command,
      queueCheck: lifecycle.queueCheck,
      executedRestart: false,
      postState: { dry_run: true, claim_event_id: claim.event.event_id ?? null },
      phase: "dry_run",
      eventIdPrefix: "restart-marker-dry-run",
    });
    return {
      bridge: "wasurezu-restart bridge",
      marker_path: loaded.path,
      marker_status: "restart_required",
      action: "restart_dry_run",
      executed_restart: false,
      dry_run: true,
      command,
      queue_check: lifecycle.queueCheck,
      event,
      failure_reason: null,
    };
  }

  await saveBridgeEvent(input, loaded, {
    action: "restart_spawn_intent",
    command,
    queueCheck: lifecycle.queueCheck,
    executedRestart: false,
    postState: { spawn_intent: true, claim_event_id: claim.event.event_id ?? null },
    phase: "spawn_intent",
    eventIdPrefix: "restart-marker-spawn-intent",
  });

  const immediateCommand = preflightRestartCommand({
    command: input.restartCommand,
    argv: input.restartArgv,
    restartPreauthorized: input.runtimeAuthority?.restart_preauthorized ?? input.restartPreauthorized,
    env: input.env,
    hostAdapterId,
    adapterRegistry: input.adapterRegistry,
  });
  if (immediateCommand.status === "fail") {
    const failureReason = immediateCommand.reasons[0] ?? "restart_adapter_preflight_drift";
    const event = await saveBridgeEvent(input, loaded, {
      action: "restart_blocked",
      command: immediateCommand,
      queueCheck: lifecycle.queueCheck,
      executedRestart: false,
      failureReason,
      postState: { blocked: true, post_claim: true },
      phase: "pre_spawn_block",
    });
    return blockedResult(input, loaded, immediateCommand, lifecycle.queueCheck, event, failureReason);
  }

  try {
    await executeRestartCommand(immediateCommand.resolved_path!, immediateCommand.argv, input.env);
    const event = await saveBridgeEvent(input, loaded, {
      action: "restart_executed",
      command: immediateCommand,
      queueCheck: lifecycle.queueCheck,
      executedRestart: true,
      postState: { executed: true },
      phase: "terminal",
      eventIdPrefix: "restart-marker-terminal",
    });
    return {
      bridge: "wasurezu-restart bridge",
      marker_path: loaded.path,
      marker_status: "restart_required",
      action: "restart_executed",
      executed_restart: true,
      dry_run: false,
      command: immediateCommand,
      queue_check: lifecycle.queueCheck,
      event,
      failure_reason: null,
    };
  } catch (err) {
    const failureReason = `restart_command_failed: ${err instanceof Error ? err.message : String(err)}`;
    const event = await saveBridgeEvent(input, loaded, {
      action: "restart_failed",
      command: immediateCommand,
      queueCheck: lifecycle.queueCheck,
      executedRestart: false,
      failureReason,
      postState: { executed: false, invocation_unknown: true },
      phase: "terminal",
      eventIdPrefix: "restart-marker-terminal",
    });
    return {
      bridge: "wasurezu-restart bridge",
      marker_path: loaded.path,
      marker_status: "restart_required",
      action: "restart_failed",
      executed_restart: false,
      dry_run: false,
      command: immediateCommand,
      queue_check: lifecycle.queueCheck,
      event,
      failure_reason: failureReason,
    };
  }
}

export async function checkAgentCommsQueueDrain(input: {
  agentId: string;
  databaseUrl?: string;
}): Promise<QueueDrainCheckResult> {
  if (!input.databaseUrl) {
    return {
      mode: "agent_comms_missing",
      result: "unavailable",
      allowed: false,
      in_flight_count: 0,
      in_flight_queue_ids: [],
      failure_reason: "lifecycle_authority_unknown_or_blocked",
    };
  }

  const pool = new Pool({ connectionString: input.databaseUrl });
  try {
    const result = await pool.query(
      `SELECT id
         FROM message_queue
        WHERE agent_id = $1
          AND (
            status IN ('received', 'in_progress', 'processing', 'claimed')
            OR (claimed_by = $1 AND status NOT IN ('done', 'replied', 'failed', 'skipped'))
          )
        ORDER BY COALESCE(claimed_at, created_at) ASC
        LIMIT 50`,
      [input.agentId]
    );
    const ids = result.rows.map((row) => String(row.id));
    return {
      mode: "agent_comms_configured",
      result: ids.length > 0 ? "blocked" : "pass",
      allowed: ids.length === 0,
      in_flight_count: ids.length,
      in_flight_queue_ids: ids,
      ...(ids.length > 0 ? { failure_reason: "queue_not_drained" } : {}),
    };
  } catch {
    return {
      mode: "agent_comms_configured",
      result: "unavailable",
      allowed: false,
      in_flight_count: 0,
      in_flight_queue_ids: [],
      failure_reason: "lifecycle_authority_unknown_or_blocked",
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function loadExecutableMarker(input: RestartBridgeInput, now: Date): MarkerLoadResult {
  const authority = input.runtimeAuthority;
  if (input.markerPath) {
    const loaded = loadMarkerFile(input.markerPath);
    if (loaded.status !== "loaded") return loaded;
    const validation = validateMarker(loaded.loaded.marker, authority, now, input);
    if (validation) {
      return { status: "invalid", failure_reason: validation, marker_path: loaded.loaded.path, marker: loaded.loaded.marker };
    }
    return loaded;
  }

  const dir = input.markerDir ?? process.cwd();
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".json"));
  } catch {
    return { status: "missing", failure_reason: "restart_marker_missing", marker_path: null };
  }
  if (files.length === 0) {
    return { status: "missing", failure_reason: "restart_marker_missing", marker_path: null };
  }

  const eligible: Array<{ loaded: LoadedMarker; generatedAtMs: number }> = [];
  let sawStale = false;
  for (const file of files) {
    const path = join(dir, file);
    const loaded = loadMarkerFile(path);
    if (loaded.status !== "loaded") return loaded;
    const validation = validateMarker(loaded.loaded.marker, authority, now, input);
    if (validation === "stale_or_missing_marker") {
      sawStale = true;
      continue;
    }
    if (validation) {
      return { status: "invalid", failure_reason: validation, marker_path: path, marker: loaded.loaded.marker };
    }
    eligible.push({ loaded: loaded.loaded, generatedAtMs: Date.parse(loaded.loaded.marker.generated_at) });
  }

  if (eligible.length === 0) {
    return {
      status: "invalid",
      failure_reason: sawStale ? "stale_or_missing_marker" : "restart_marker_missing",
      marker_path: null,
    };
  }

  eligible.sort((a, b) => b.generatedAtMs - a.generatedAtMs);
  if (eligible.length > 1 && eligible[0].generatedAtMs === eligible[1].generatedAtMs) {
    return {
      status: "invalid",
      failure_reason: "ambiguous_fresh_markers",
      marker_path: eligible[0].loaded.path,
      marker: eligible[0].loaded.marker,
    };
  }
  return { status: "loaded", loaded: eligible[0].loaded };
}

function loadMarkerFile(path: string): MarkerLoadResult {
  try {
    const linkStat = lstatSync(path);
    if (linkStat.isSymbolicLink() || !statSync(path).isFile()) {
      return { status: "invalid", failure_reason: "restart_marker_path_invalid", marker_path: path };
    }
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "invalid", failure_reason: "restart_marker_malformed", marker_path: path };
    }
    const canonical = canonicalJson(parsed);
    const markerDigest = sha256(canonical);
    return {
      status: "loaded",
      loaded: {
        path,
        marker: parsed as RestartRequiredMarkerV2,
        canonical_json: canonical,
        marker_digest: markerDigest,
      },
    };
  } catch (err) {
    const missing = /ENOENT/.test(String((err as Error)?.message ?? err));
    return {
      status: missing ? "missing" : "invalid",
      failure_reason: missing ? "restart_marker_missing" : "restart_marker_malformed",
      marker_path: path,
    };
  }
}

function validateMarker(
  marker: Partial<RestartRequiredMarker>,
  authority: RestartRuntimeAuthority | undefined,
  now: Date,
  input: RestartBridgeInput
): string | null {
  if (marker.schema_version === "wasurezu-restart-marker/v1") return "legacy_marker_non_executable";
  if (marker.schema_version !== "wasurezu-restart-marker/v2") return "restart_marker_schema_invalid";
  const v2 = marker as Partial<RestartRequiredMarkerV2>;
  const required: Array<keyof RestartRequiredMarkerV2> = [
    "marker_id",
    "generated_at",
    "agent_id",
    "host_id",
    "session_id",
    "host_adapter_id",
  ];
  for (const key of required) {
    if (typeof v2[key] !== "string" || (v2[key] as string).trim() === "") return "restart_marker_identity_invalid";
  }
  if (authority?.project !== undefined || input.project !== undefined) {
    if (typeof v2.project !== "string" || v2.project.trim() === "") return "restart_marker_identity_invalid";
  }
  if (authority?.seat_id !== undefined) {
    if (typeof v2.seat_id !== "string" || v2.seat_id.trim() === "") return "restart_marker_identity_invalid";
  }
  if (v2.status !== "restart_required" && v2.status !== "restart_not_required") return "restart_marker_status_invalid";
  if ((v2.status === "restart_required") !== (v2.restart_required === true)) return "restart_marker_status_inconsistent";
  if (!isUuidV7Like(v2.marker_id!)) return "restart_marker_identity_invalid";
  if (!strictUtc(v2.generated_at!)) return "restart_marker_generated_at_invalid";

  if (!authority) return "runtime_authority_missing";
  const expectedProject = authority.project ?? input.project;
  const identityMismatch =
    v2.agent_id !== authority.agent_id ||
    (expectedProject !== undefined && v2.project !== expectedProject) ||
    (authority.seat_id !== undefined && v2.seat_id !== authority.seat_id) ||
    v2.host_id !== authority.host_id ||
    v2.session_id !== authority.session_id ||
    v2.host_adapter_id !== authority.host_adapter_id;
  if (identityMismatch) return "restart_marker_identity_mismatch";

  const generatedAt = Date.parse(v2.generated_at!);
  const maxAgeMs = (input.markerMaxAgeSeconds ?? 300) * 1000;
  const futureSkewMs = (input.markerFutureSkewSeconds ?? 30) * 1000;
  if (generatedAt < now.getTime() - maxAgeMs || generatedAt > now.getTime() + futureSkewMs) {
    return "stale_or_missing_marker";
  }
  return null;
}

async function evaluateLifecycleAuthority(
  input: RestartBridgeInput,
  loaded: LoadedMarker,
  now: Date
): Promise<LifecycleEvaluation> {
  const authority = input.runtimeAuthority;
  if (!authority) return { allowed: false, failure_reason: "lifecycle_authority_unknown_or_blocked", queueCheck: null };
  if (authority.agent_id !== input.agentId || authority.agent_id !== loaded.marker.agent_id) {
    return { allowed: false, failure_reason: "lifecycle_authority_unknown_or_blocked", queueCheck: null };
  }
  if (authority.project !== undefined && loaded.marker.project !== authority.project) {
    return { allowed: false, failure_reason: "lifecycle_authority_unknown_or_blocked", queueCheck: null };
  }
  if (authority.host_id !== loaded.marker.host_id || authority.session_id !== loaded.marker.session_id || authority.host_adapter_id !== loaded.marker.host_adapter_id) {
    return { allowed: false, failure_reason: "lifecycle_authority_unknown_or_blocked", queueCheck: null };
  }
  if (!authority.restart_preauthorized || !authority.authority_ref || !Number.isInteger(authority.row_version)) {
    return { allowed: false, failure_reason: "lifecycle_authority_unknown_or_blocked", queueCheck: null };
  }
  if (!strictUtc(authority.expires_at) || Date.parse(authority.expires_at) <= now.getTime()) {
    return { allowed: false, failure_reason: "lifecycle_authority_unknown_or_blocked", queueCheck: null };
  }

  if (authority.lifecycle_mode === "pure_mcp") {
    return {
      allowed: false,
      failure_reason: "lifecycle_authority_unknown_or_blocked",
      queueCheck: {
        mode: "pure_mcp",
        result: "blocked",
        allowed: false,
        in_flight_count: 0,
        in_flight_queue_ids: [],
        failure_reason: "lifecycle_authority_unknown_or_blocked",
      },
    };
  }

  if (authority.lifecycle_mode === "standalone_supervisor") {
    const allowed = authority.aun_absent_confirmed === true && authority.supervisor_available === true && Boolean(authority.supervisor_id);
    return {
      allowed,
      failure_reason: allowed ? undefined : "lifecycle_authority_unknown_or_blocked",
      queueCheck: {
        mode: "standalone_supervisor",
        result: allowed ? "pass" : "blocked",
        allowed,
        in_flight_count: 0,
        in_flight_queue_ids: [],
        ...(allowed ? {} : { failure_reason: "lifecycle_authority_unknown_or_blocked" }),
      },
    };
  }

  const queueCheck = input.queueDrainCheck
    ? await input.queueDrainCheck(input.agentId)
    : await checkAgentCommsQueueDrain({
        agentId: input.agentId,
        databaseUrl: input.agentCommsDatabaseUrl ?? input.env?.AGENT_COMMS_DATABASE_URL,
      });
  return {
    allowed: queueCheck.allowed,
    failure_reason: queueCheck.allowed ? undefined : queueCheck.failure_reason ?? "queue_not_drained",
    queueCheck,
  };
}

async function claimMarker(input: RestartBridgeInput, loaded: LoadedMarker): Promise<{ event: RestartEvent; failure_reason: string | null }> {
  const payload = claimPayload(loaded);
  const payloadDigest = sha256(canonicalJson(payload));
  const event = await saveBridgeEvent(input, loaded, {
    action: "restart_marker_claim",
    command: null,
    queueCheck: null,
    executedRestart: false,
    postState: { claim: true },
    phase: "claim",
    eventIdPrefix: "restart-marker-claim",
    payloadDigest,
  });
  if (event.metadata.inserted === true) return { event, failure_reason: null };
  if (event.metadata.collision === true) return { event, failure_reason: "event_id_collision" };
  const recentEvents = await input.store.getRestartEvents({
    agent_id: input.agentId,
    project: input.project ?? loaded.marker.project,
    limit: 100,
  });
  const markerEvents = recentEvents.filter((item) => item.marker_digest === loaded.marker_digest);
  const hasSpawnIntent = markerEvents.some((item) => item.phase === "spawn_intent");
  const hasTerminal = markerEvents.some((item) => item.phase === "terminal");
  if (hasSpawnIntent && !hasTerminal) return { event, failure_reason: "invocation_unknown" };
  return { event, failure_reason: "marker_already_claimed" };
}

function blockedResult(
  input: RestartBridgeInput,
  loaded: LoadedMarker,
  command: RestartCommandPreflightResult | null,
  queueCheck: QueueDrainCheckResult | null,
  event: RestartEvent,
  failureReason: string
): RestartBridgeResult {
  return {
    bridge: "wasurezu-restart bridge",
    marker_path: loaded.path,
    marker_status: "restart_required",
    action: "restart_blocked",
    executed_restart: false,
    dry_run: input.execute !== true,
    command,
    queue_check: queueCheck,
    event,
    failure_reason: failureReason,
  };
}

async function saveBridgeEvent(
  input: RestartBridgeInput,
  loaded: LoadedMarker,
  outcome: {
    action: string;
    command: RestartCommandPreflightResult | null;
    queueCheck: QueueDrainCheckResult | null;
    executedRestart: boolean;
    failureReason?: string;
    postState?: Record<string, unknown>;
    phase: string;
    eventIdPrefix?: string;
    payloadDigest?: string;
  }
): Promise<RestartEvent> {
  const marker = loaded.marker;
  const payloadDigest = outcome.payloadDigest ?? sha256(canonicalJson({
    action: outcome.action,
    phase: outcome.phase,
    marker_digest: loaded.marker_digest,
    executed_restart: outcome.executedRestart,
    failure_reason: outcome.failureReason ?? null,
  }));
  return input.store.saveRestartEvent({
    event_id: outcome.eventIdPrefix ? `${outcome.eventIdPrefix}:${loaded.marker_digest}` : undefined,
    agent_id: input.agentId,
    project: input.project ?? marker.project,
    seat_id: marker.seat_id,
    host: marker.host,
    host_id: marker.host_id,
    host_adapter_id: marker.host_adapter_id,
    session_id: marker.session_id,
    marker_id: marker.marker_id,
    marker_digest: loaded.marker_digest,
    marker_path: loaded.path,
    marker_status: marker.status,
    attempt_ordinal: 1,
    phase: outcome.phase,
    payload_digest: payloadDigest,
    action: outcome.action,
    restart_required: marker.status === "restart_required" && marker.restart_required === true,
    executed_restart: outcome.executedRestart,
    band: marker.band,
    context_tokens: marker.context_tokens ?? marker.measured_context_tokens,
    context_window_tokens: marker.context_window_tokens,
    context_used_ratio: marker.context_used_ratio ?? undefined,
    thresholds: marker.thresholds ? { ...marker.thresholds } : undefined,
    queue_check_mode: outcome.queueCheck?.mode,
    queue_check_result: outcome.queueCheck?.result,
    preflight_status: outcome.command?.status,
    restart_command: outcome.command?.command ?? undefined,
    failure_reason: outcome.failureReason,
    pre_state: {
      marker_status: marker.status,
      marker_digest: loaded.marker_digest,
      command_status: outcome.command?.status,
      queue_check_result: outcome.queueCheck?.result,
    },
    post_state: outcome.postState ?? {},
    metadata: {
      command_kind: outcome.command?.command_kind ?? null,
      command_reasons: outcome.command?.reasons ?? [],
      command_diagnostics: outcome.command?.diagnostics ?? [],
      queue_in_flight_count: outcome.queueCheck?.in_flight_count ?? null,
      queue_in_flight_queue_ids: outcome.queueCheck?.in_flight_queue_ids ?? [],
      dry_run: input.execute !== true,
      marker_schema_version: marker.schema_version,
      runtime_lifecycle_mode: input.runtimeAuthority?.lifecycle_mode ?? null,
    },
  });
}

async function saveRawRestartEvent(
  input: RestartBridgeInput,
  outcome: {
    action: RestartBridgeResult["action"];
    markerPath: string | null;
    marker?: Partial<RestartRequiredMarker>;
    markerStatus: RestartBridgeResult["marker_status"];
    executedRestart: boolean;
    failureReason?: string;
    postState?: Record<string, unknown>;
  }
): Promise<RestartEvent> {
  return input.store.saveRestartEvent({
    agent_id: input.agentId,
    project: input.project ?? outcome.marker?.project,
    seat_id: outcome.marker?.seat_id,
    host: outcome.marker?.host,
    session_id: outcome.marker?.session_id,
    marker_path: outcome.markerPath ?? undefined,
    marker_status: outcome.markerStatus,
    action: outcome.action,
    restart_required: false,
    executed_restart: outcome.executedRestart,
    failure_reason: outcome.failureReason,
    pre_state: {
      marker_status: outcome.marker?.status ?? outcome.markerStatus,
      marker_schema_version: outcome.marker?.schema_version ?? null,
    },
    post_state: outcome.postState ?? {},
    metadata: {
      dry_run: input.execute !== true,
      runtime_lifecycle_mode: input.runtimeAuthority?.lifecycle_mode ?? null,
    },
  });
}

function claimPayload(loaded: LoadedMarker): Record<string, unknown> {
  return {
    domain: "wasurezu-restart-marker-claim/v1",
    marker_id: loaded.marker.marker_id,
    marker_digest: loaded.marker_digest,
    attempt_ordinal: 1,
    phase: "claim",
  };
}

function executeRestartCommand(path: string, argv: readonly string[], env: NodeJS.ProcessEnv | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, Array.from(argv), {
      stdio: "ignore",
      env: env ?? process.env,
      detached: false,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`exit=${signal ?? code}`));
    });
  });
}

function asDate(value: string | Date | undefined): Date {
  if (value instanceof Date) return value;
  if (value) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function strictUtc(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function isUuidV7Like(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
