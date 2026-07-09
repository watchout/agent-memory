import { spawn } from "child_process";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import pg from "pg";
import { preflightRestartCommand, type RestartCommandPreflightResult } from "./restart-command-preflight.js";
import type { RestartRequiredMarker } from "./context-restart-marker.js";
import type { RestartEvent, Store } from "./stores/types.js";

const { Pool } = pg;

export type QueueCheckMode = "standalone_no_agent_comms_detected" | "agent_comms_configured";
export type QueueCheckResult = "pass" | "blocked" | "unavailable";

export interface QueueDrainCheckResult {
  mode: QueueCheckMode;
  result: QueueCheckResult;
  allowed: boolean;
  in_flight_count: number;
  in_flight_queue_ids: string[];
  failure_reason?: string;
}

export interface RestartBridgeInput {
  store: Store;
  agentId: string;
  project?: string;
  markerPath?: string;
  markerDir?: string;
  restartCommand?: string;
  restartPreauthorized?: boolean;
  execute?: boolean;
  env?: NodeJS.ProcessEnv;
  agentCommsDatabaseUrl?: string;
  queueDrainCheck?: (agentId: string) => Promise<QueueDrainCheckResult>;
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
  marker: Partial<RestartRequiredMarker>;
}

export async function runRestartBridge(input: RestartBridgeInput): Promise<RestartBridgeResult> {
  const loaded = loadLatestMarker(input.markerPath, input.markerDir);
  if (!loaded) {
    const event = await input.store.saveRestartEvent({
      agent_id: input.agentId,
      project: input.project,
      action: "bridge_no_marker",
      restart_required: false,
      executed_restart: false,
      failure_reason: "restart_marker_missing",
    });
    return {
      bridge: "wasurezu-restart bridge",
      marker_path: null,
      marker_status: "missing",
      action: "bridge_no_marker",
      executed_restart: false,
      dry_run: input.execute !== true,
      command: null,
      queue_check: null,
      event,
      failure_reason: "restart_marker_missing",
    };
  }

  const marker = loaded.marker;
  const markerStatus = marker.status === "restart_required"
    ? "restart_required"
    : marker.status === "restart_not_required"
      ? "restart_not_required"
      : "ignored";
  const restartRequired = markerStatus === "restart_required" || marker.restart_required === true;
  const restartCommand = input.restartCommand ?? input.env?.WASUREZU_RESTART_COMMAND ?? "wasurezu-claude-start --launch";
  const command = preflightRestartCommand({
    command: restartCommand,
    restartPreauthorized: input.restartPreauthorized === true,
    env: input.env,
  });

  if (!restartRequired) {
    const event = await saveBridgeEvent(input, loaded, {
      action: "bridge_marker_not_required",
      command,
      queueCheck: null,
      executedRestart: false,
      failureReason: "marker_not_restart_required",
      postState: { skipped: true },
    });
    return {
      bridge: "wasurezu-restart bridge",
      marker_path: loaded.path,
      marker_status: markerStatus,
      action: "bridge_marker_not_required",
      executed_restart: false,
      dry_run: input.execute !== true,
      command,
      queue_check: null,
      event,
      failure_reason: "marker_not_restart_required",
    };
  }

  const queueCheck = input.queueDrainCheck
    ? await input.queueDrainCheck(input.agentId)
    : await checkAgentCommsQueueDrain({
        agentId: input.agentId,
        databaseUrl: input.agentCommsDatabaseUrl ?? input.env?.AGENT_COMMS_DATABASE_URL,
      });
  const preflightFailure = command.status === "fail" ? command.reasons[0] ?? "restart_command_preflight_failed" : null;
  const queueFailure = queueCheck.allowed ? null : queueCheck.failure_reason ?? `queue_check_${queueCheck.result}`;
  const blockedReason = preflightFailure ?? queueFailure;
  if (blockedReason) {
    const event = await saveBridgeEvent(input, loaded, {
      action: "restart_blocked",
      command,
      queueCheck,
      executedRestart: false,
      failureReason: blockedReason,
      postState: { blocked: true },
    });
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
      failure_reason: blockedReason,
    };
  }

  if (input.execute !== true) {
    const event = await saveBridgeEvent(input, loaded, {
      action: "restart_dry_run",
      command,
      queueCheck,
      executedRestart: false,
      postState: { dry_run: true },
    });
    return {
      bridge: "wasurezu-restart bridge",
      marker_path: loaded.path,
      marker_status: "restart_required",
      action: "restart_dry_run",
      executed_restart: false,
      dry_run: true,
      command,
      queue_check: queueCheck,
      event,
      failure_reason: null,
    };
  }

  try {
    await executeRestartCommand(restartCommand, input.env);
    const event = await saveBridgeEvent(input, loaded, {
      action: "restart_executed",
      command,
      queueCheck,
      executedRestart: true,
      postState: { executed: true },
    });
    return {
      bridge: "wasurezu-restart bridge",
      marker_path: loaded.path,
      marker_status: "restart_required",
      action: "restart_executed",
      executed_restart: true,
      dry_run: false,
      command,
      queue_check: queueCheck,
      event,
      failure_reason: null,
    };
  } catch (err) {
    const failureReason = `restart_command_failed: ${err instanceof Error ? err.message : String(err)}`;
    const event = await saveBridgeEvent(input, loaded, {
      action: "restart_failed",
      command,
      queueCheck,
      executedRestart: false,
      failureReason,
      postState: { executed: false },
    });
    return {
      bridge: "wasurezu-restart bridge",
      marker_path: loaded.path,
      marker_status: "restart_required",
      action: "restart_failed",
      executed_restart: false,
      dry_run: false,
      command,
      queue_check: queueCheck,
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
      mode: "standalone_no_agent_comms_detected",
      result: "pass",
      allowed: true,
      in_flight_count: 0,
      in_flight_queue_ids: [],
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
      ...(ids.length > 0 ? { failure_reason: "queue_has_in_flight_work" } : {}),
    };
  } catch (err) {
    return {
      mode: "agent_comms_configured",
      result: "unavailable",
      allowed: false,
      in_flight_count: 0,
      in_flight_queue_ids: [],
      failure_reason: `agent_comms_queue_check_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function loadLatestMarker(markerPath?: string, markerDir?: string): LoadedMarker | null {
  const paths = markerPath ? [markerPath] : markerPathsFromDir(markerDir ?? process.cwd());
  for (const path of paths) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { path, marker: parsed as Partial<RestartRequiredMarker> };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function markerPathsFromDir(dir: string): string[] {
  try {
    return readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .map((file) => join(dir, file))
        .sort()
        .reverse();
  } catch {
    return [];
  }
}

async function saveBridgeEvent(
  input: RestartBridgeInput,
  loaded: LoadedMarker,
  outcome: {
    action: RestartBridgeResult["action"];
    command: RestartCommandPreflightResult;
    queueCheck: QueueDrainCheckResult | null;
    executedRestart: boolean;
    failureReason?: string;
    postState?: Record<string, unknown>;
  }
): Promise<RestartEvent> {
  const marker = loaded.marker;
  return input.store.saveRestartEvent({
    agent_id: input.agentId,
    project: input.project ?? marker.project,
    seat_id: marker.seat_id,
    host: marker.host,
    session_id: marker.session_id,
    marker_path: loaded.path,
    marker_status: marker.status,
    action: outcome.action,
    restart_required: marker.status === "restart_required" || marker.restart_required === true,
    executed_restart: outcome.executedRestart,
    band: marker.band,
    context_tokens: marker.context_tokens ?? marker.measured_context_tokens,
    context_window_tokens: marker.context_window_tokens,
    context_used_ratio: marker.context_used_ratio ?? undefined,
    thresholds: marker.thresholds ? { ...marker.thresholds } : undefined,
    queue_check_mode: outcome.queueCheck?.mode,
    queue_check_result: outcome.queueCheck?.result,
    preflight_status: outcome.command.status,
    restart_command: outcome.command.command ?? undefined,
    failure_reason: outcome.failureReason,
    pre_state: {
      marker_status: marker.status,
      command_status: outcome.command.status,
      queue_check_result: outcome.queueCheck?.result,
    },
    post_state: outcome.postState ?? {},
    metadata: {
      command_kind: outcome.command.command_kind,
      command_reasons: outcome.command.reasons,
      command_diagnostics: outcome.command.diagnostics,
      queue_in_flight_count: outcome.queueCheck?.in_flight_count ?? null,
      queue_in_flight_queue_ids: outcome.queueCheck?.in_flight_queue_ids ?? [],
      dry_run: input.execute !== true,
    },
  });
}

function executeRestartCommand(command: string, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  const [bin, ...args] = splitCommand(command);
  if (!bin) return Promise.reject(new Error("restart command missing"));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
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

function splitCommand(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const char of command.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) words.push(current);
  return words;
}
