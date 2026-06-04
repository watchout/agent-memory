import type { ConversationEvent, Decision, Knowledge, Store, TaskState } from "./stores/types.js";
import { estimateTokens } from "./constants.js";
import { detectContinuityRisks, type ContinuityRisk } from "./continuity-analysis.js";
import {
  rawCaptureMissingContext,
  summarizeRawCaptureCoverage,
  type RawCaptureCoverageReport,
} from "./raw-capture-coverage.js";
import {
  buildHostInvocationContextArtifact,
  buildRecoveryPackArtifact,
  buildRestartPack,
  loadRestartPackData,
  type HostInvocationDeliveryMode,
  type HostInvocationTargetRuntime,
  type RestartPackData,
  type UntrustedContextPolicy,
} from "./restart-pack.js";

export type ContinuityGuardMode = "auto_restart" | "recommend" | "pack_only" | "off";
export type PackInjectionMode = "auto_attach" | "on_demand" | "off";
export type RestartPackFormat = "text" | "recovery-pack-v1" | "host-invocation-context-v1";
export type RestartPrepareAction =
  | "off"
  | "pack_update_needed"
  | "restart_recommended"
  | "restart_required";

export interface RestartPrepareInput {
  agent_id: string;
  project?: string;
  max_tokens?: number;
  continuity_guard_mode?: ContinuityGuardMode;
  pack_injection_mode?: PackInjectionMode;
  aun_installed?: boolean;
  aun_absent_confirmed?: boolean;
  supervisor_available?: boolean;
  restart_preauthorized?: boolean;
  context_used_ratio?: number;
  context_tokens?: number;
  context_window_tokens?: number;
  runtime_context_error?: boolean;
  emit_pack?: boolean;
  pack_format?: RestartPackFormat;
  target_runtime?: HostInvocationTargetRuntime;
  delivery_mode?: HostInvocationDeliveryMode;
  trusted_instruction?: string;
  untrusted_context_policy?: UntrustedContextPolicy;
  raw_capture_coverage?: RawCaptureCoverageReport;
}

export interface RestartPrepareOutput {
  action: RestartPrepareAction;
  continuity_guard_mode: ContinuityGuardMode;
  requested_continuity_guard_mode: ContinuityGuardMode;
  pack_injection_mode: PackInjectionMode;
  can_auto_restart: boolean;
  auto_restart_blockers: string[];
  pack_ref: string | null;
  restart_pack_format: RestartPackFormat;
  restart_pack_schema_ref?: "recovery-pack/v1" | "host-invocation-context/v1";
  restart_pack?: string;
  recovery_confidence: {
    score: number;
    level: "high" | "medium" | "low";
    missing_context: string[];
  };
  context_signal: {
    source: "host_metrics" | "estimated";
    usage_ratio: number | null;
    band: "unknown" | "ok" | "prepare" | "warn" | "recommend" | "require";
  };
  provenance: {
    generated_at: string;
    agent_id: string;
    project?: string;
    pack_tokens: number;
    active_task_ids: string[];
    blocked_task_ids: string[];
    decision_ids: string[];
    knowledge_ids: string[];
    conversation_event_ids: string[];
  };
  notes: string[];
}

interface Snapshot {
  activeTasks: TaskState[];
  blockedTasks: TaskState[];
  decisions: Decision[];
  knowledge: Knowledge[];
  conversationEvents: ConversationEvent[];
  continuityRisks: ContinuityRisk[];
}

interface PreparedPackContent {
  content: string;
  schema_ref?: "recovery-pack/v1" | "host-invocation-context/v1";
  target_runtime?: HostInvocationTargetRuntime;
  delivery_mode?: HostInvocationDeliveryMode;
  untrusted_context_policy?: UntrustedContextPolicy;
}

export async function prepareRestart(store: Store, input: RestartPrepareInput): Promise<RestartPrepareOutput> {
  const requestedMode = input.continuity_guard_mode ?? "recommend";
  const autoRestartBlockers = autoRestartBlockersFor(input);
  const effectiveMode: ContinuityGuardMode =
    requestedMode === "auto_restart" && autoRestartBlockers.length > 0 ? "recommend" : requestedMode;
  const packInjectionMode = input.pack_injection_mode ?? "auto_attach";
  const packFormat = input.pack_format ?? "text";

  const [snapshot, restartPackData] = await Promise.all([
    loadSnapshot(store, input),
    loadRestartPackData(store, {
      agent_id: input.agent_id,
      project: input.project,
      max_tokens: input.max_tokens,
    }),
  ]);
  const preparedPack = buildPreparedPackContent(restartPackData, input);

  const missingContext = missingContextFor(snapshot, input.raw_capture_coverage);
  const score = confidenceScore(missingContext);
  const contextSignal = contextSignalFor(input);
  const action = actionFor({
    mode: effectiveMode,
    score,
    missingContext,
    continuityRisks: snapshot.continuityRisks,
    contextBand: contextSignal.band,
    runtimeContextError: input.runtime_context_error === true,
  });
  const generatedAt = new Date().toISOString();
  const selectedPack = packInjectionMode === "off"
    ? null
    : await store.saveSelectedRestartPack({
        agent_id: input.agent_id,
        project: input.project,
        content: preparedPack.content,
        source: "restart_prepare",
        metadata: {
          generated_at: generatedAt,
          pack_format: packFormat,
          pack_schema_ref: preparedPack.schema_ref,
          target_runtime: preparedPack.target_runtime,
          delivery_mode: preparedPack.delivery_mode,
          untrusted_context_policy: preparedPack.untrusted_context_policy,
          requested_continuity_guard_mode: requestedMode,
          continuity_guard_mode: effectiveMode,
          action,
          context_signal: contextSignal,
          recovery_confidence: { score, missing_context: missingContext },
          raw_capture_coverage: input.raw_capture_coverage,
        },
      });

  return {
    action,
    continuity_guard_mode: effectiveMode,
    requested_continuity_guard_mode: requestedMode,
    pack_injection_mode: packInjectionMode,
    can_auto_restart: autoRestartBlockers.length === 0 && requestedMode === "auto_restart",
    auto_restart_blockers: autoRestartBlockers,
    pack_ref: selectedPack?.pack_ref ?? null,
    restart_pack_format: packFormat,
    ...(preparedPack.schema_ref ? { restart_pack_schema_ref: preparedPack.schema_ref } : {}),
    ...(input.emit_pack === false ? {} : { restart_pack: preparedPack.content }),
    recovery_confidence: {
      score,
      level: score >= 0.8 ? "high" : score >= 0.55 ? "medium" : "low",
      missing_context: missingContext,
    },
    context_signal: contextSignal,
    provenance: {
      generated_at: generatedAt,
      agent_id: input.agent_id,
      project: input.project,
      pack_tokens: estimateTokens(preparedPack.content),
      active_task_ids: ids(snapshot.activeTasks),
      blocked_task_ids: ids(snapshot.blockedTasks),
      decision_ids: ids(snapshot.decisions),
      knowledge_ids: ids(snapshot.knowledge),
      conversation_event_ids: ids(snapshot.conversationEvents),
    },
    notes: notesFor({
      requestedMode,
      effectiveMode,
      packInjectionMode,
      contextSignalSource: contextSignal.source,
      action,
      continuityRisks: snapshot.continuityRisks,
      rawCaptureCoverage: input.raw_capture_coverage,
    }),
  };
}

function buildPreparedPackContent(
  data: RestartPackData,
  input: RestartPrepareInput
): PreparedPackContent {
  const format = input.pack_format ?? "text";
  if (format === "recovery-pack-v1") {
    return {
      content: JSON.stringify(buildRecoveryPackArtifact(data), null, 2),
      schema_ref: "recovery-pack/v1",
    };
  }
  if (format === "host-invocation-context-v1") {
    const recoveryPack = buildRecoveryPackArtifact(data);
    const hostContext = buildHostInvocationContextArtifact(recoveryPack, {
      target_runtime: input.target_runtime ?? "codex",
      delivery_mode: input.delivery_mode,
      trusted_instruction: input.trusted_instruction,
      untrusted_context_policy: input.untrusted_context_policy,
    });
    return {
      content: JSON.stringify(hostContext, null, 2),
      schema_ref: "host-invocation-context/v1",
      target_runtime: hostContext.target_runtime,
      delivery_mode: hostContext.delivery_mode,
      untrusted_context_policy: hostContext.untrusted_context_policy,
    };
  }
  return { content: buildRestartPack(data) };
}

async function loadSnapshot(store: Store, input: RestartPrepareInput): Promise<Snapshot> {
  const [activeTasks, blockedTasks, decisions, knowledge, conversationEvents] = await Promise.all([
    store.getTaskStates({ agent_id: input.agent_id, project: input.project, limit: 2, status: "in_progress" }),
    store.getTaskStates({ agent_id: input.agent_id, project: input.project, limit: 2, status: "blocked" }),
    store.getDecisions({ agent_id: input.agent_id, project: input.project, limit: 5, status: "active" }),
    store.getKnowledge({ agent_id: input.agent_id, project: input.project, limit: 5, status: "active" }),
    store.getConversationEvents({ agent_id: input.agent_id, project: input.project, limit: 8 }),
  ]);
  return {
    activeTasks,
    blockedTasks,
    decisions,
    knowledge,
    conversationEvents,
    continuityRisks: detectContinuityRisks({ decisions }),
  };
}

function autoRestartBlockersFor(input: RestartPrepareInput): string[] {
  if (input.continuity_guard_mode !== "auto_restart") return [];
  const blockers: string[] = [];
  if (input.aun_installed) {
    blockers.push("aun_installed");
  } else if (!input.aun_absent_confirmed) {
    blockers.push("aun_absence_not_confirmed");
  }
  if (!input.supervisor_available) blockers.push("supervisor_or_host_hook_unavailable");
  if (!input.restart_preauthorized) blockers.push("restart_lifecycle_not_preauthorized");
  return blockers;
}

function missingContextFor(snapshot: Snapshot, rawCaptureCoverage?: RawCaptureCoverageReport): string[] {
  const missing: string[] = [];
  const active = snapshot.activeTasks[0] ?? snapshot.blockedTasks[0];
  if (!active) missing.push("active_task");
  if (!active?.next_steps) missing.push("next_action");
  if (snapshot.decisions.length === 0) missing.push("latest_decision");
  if (snapshot.knowledge.length === 0 && snapshot.conversationEvents.length === 0) missing.push("supporting_context");
  for (const risk of snapshot.continuityRisks) {
    if (!missing.includes(risk.missing_context_key)) missing.push(risk.missing_context_key);
  }
  for (const key of rawCaptureCoverage ? rawCaptureMissingContext(rawCaptureCoverage) : []) {
    if (!missing.includes(key)) missing.push(key);
  }
  return missing;
}

function confidenceScore(missingContext: string[]): number {
  const weights: Record<string, number> = {
    active_task: 0.35,
    next_action: 0.25,
    latest_decision: 0.15,
    supporting_context: 0.15,
    contradictory_decisions: 0.3,
    raw_capture_unavailable: 0.25,
    raw_capture_unknown_files: 0.15,
    raw_capture_backlog_pending: 0.1,
    raw_capture_cursor_stale: 0.15,
  };
  const penalty = missingContext.reduce((sum, key) => sum + (weights[key] ?? 0.1), 0);
  return Math.max(0, Math.min(1, Number((1 - penalty).toFixed(2))));
}

function contextSignalFor(input: RestartPrepareInput): RestartPrepareOutput["context_signal"] {
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

  if (ratio === null || Number.isNaN(ratio)) {
    return { source: "estimated", usage_ratio: null, band: "unknown" };
  }

  const bounded = Math.max(0, Math.min(1, ratio));
  const band =
    bounded >= 0.95 ? "require" :
    bounded >= 0.90 ? "recommend" :
    bounded >= 0.80 ? "warn" :
    bounded >= 0.70 ? "prepare" :
    "ok";
  return { source: "host_metrics", usage_ratio: Number(bounded.toFixed(4)), band };
}

function actionFor(input: {
  mode: ContinuityGuardMode;
  score: number;
  missingContext: string[];
  continuityRisks: ContinuityRisk[];
  contextBand: RestartPrepareOutput["context_signal"]["band"];
  runtimeContextError: boolean;
}): RestartPrepareAction {
  if (input.mode === "off") return "off";
  if (input.mode === "pack_only") return "pack_update_needed";
  if (input.runtimeContextError || input.contextBand === "require") return "restart_required";
  if (input.continuityRisks.length > 0) return "restart_recommended";
  if (input.contextBand === "recommend" || input.score < 0.55) return "restart_recommended";
  return "pack_update_needed";
}

function notesFor(input: {
  requestedMode: ContinuityGuardMode;
  effectiveMode: ContinuityGuardMode;
  packInjectionMode: PackInjectionMode;
  contextSignalSource: "host_metrics" | "estimated";
  action: RestartPrepareAction;
  continuityRisks: ContinuityRisk[];
  rawCaptureCoverage?: RawCaptureCoverageReport;
}): string[] {
  const notes: string[] = [];
  notes.push("wasurezu does not mutate AUN queue state, claim/requeue lifecycle, delivery, finalization, reply, or close.");
  if (input.requestedMode !== input.effectiveMode) {
    notes.push(`continuity_guard_mode downgraded from ${input.requestedMode} to ${input.effectiveMode}.`);
  }
  if (input.contextSignalSource === "estimated") {
    notes.push("context usage ratio unavailable; recommendation is based on semantic continuity only.");
  }
  if (input.packInjectionMode === "off") {
    notes.push("pack injection is off; restart_pack content is generated for inspection only.");
  }
  for (const risk of input.continuityRisks) {
    notes.push(`semantic continuity degraded: ${risk.kind}; ${risk.source_refs.join(", ")}.`);
  }
  if (input.rawCaptureCoverage) {
    notes.push(...summarizeRawCaptureCoverage(input.rawCaptureCoverage));
  }
  notes.push(`restart_prepare action=${input.action}.`);
  return notes;
}

function ids(items: Array<{ id: string }>): string[] {
  return items.map((item) => item.id);
}
