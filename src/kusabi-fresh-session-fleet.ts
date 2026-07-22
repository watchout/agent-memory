#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

export const FRESH_SESSION_EVIDENCE_SCHEMA = "kusabi-fresh-session-evidence/v1" as const;
export const FRESH_SESSION_TIMEOUT_MS = 60_000 as const;

export type FleetRuntime = "codex" | "claude-code";

export interface FleetTarget {
  ordinal: number;
  agent_id: string;
  memory_project: string;
  workspace: string;
  runtime: FleetRuntime;
  profile_revision: number;
}

export const FRESH_SESSION_FLEET_TARGETS: readonly FleetTarget[] = Object.freeze([
  { ordinal: 1, agent_id: "kusabi", memory_project: "agent-memory", workspace: "/Users/yuji/Developer/agent-memory", runtime: "codex", profile_revision: 9 },
  { ordinal: 2, agent_id: "spec", memory_project: "spec", workspace: "/Users/yuji/Developer/spec", runtime: "claude-code", profile_revision: 6 },
  { ordinal: 3, agent_id: "arc", memory_project: "iyasaka-arc", workspace: "/Users/yuji/Developer/iyasaka-arc", runtime: "codex", profile_revision: 7 },
  { ordinal: 4, agent_id: "codex-audit", memory_project: "codex-audit", workspace: "/Users/yuji/Developer/codex-audit", runtime: "codex", profile_revision: 5 },
  { ordinal: 5, agent_id: "devauditor", memory_project: "dev-auditor", workspace: "/Users/yuji/Developer/dev-auditor", runtime: "codex", profile_revision: 5 },
  { ordinal: 6, agent_id: "qa", memory_project: "qa", workspace: "/Users/yuji/Developer/qa", runtime: "codex", profile_revision: 6 },
  { ordinal: 7, agent_id: "check", memory_project: "check", workspace: "/Users/yuji/Developer/check", runtime: "claude-code", profile_revision: 6 },
  { ordinal: 8, agent_id: "codex-cto", memory_project: "codex", workspace: "/Users/yuji/Developer/codex", runtime: "codex", profile_revision: 8 },
  { ordinal: 9, agent_id: "dev-001", memory_project: "dev-001", workspace: "/Users/yuji/Developer/dev-001", runtime: "codex", profile_revision: 6 },
  { ordinal: 10, agent_id: "org-build-dev", memory_project: "org-build", workspace: "/Users/yuji/Developer/org-build", runtime: "claude-code", profile_revision: 5 },
  { ordinal: 11, agent_id: "hotel-lead", memory_project: "hotel-lead", workspace: "/Users/yuji/Developer/hotel-lead", runtime: "codex", profile_revision: 5 },
  { ordinal: 12, agent_id: "secretary", memory_project: "secretary", workspace: "/Users/yuji/Developer/secretary", runtime: "codex", profile_revision: 6 },
]);

export interface FleetRuntimeProfile {
  agent_id: string;
  home_directory: string;
  runtime_engine_preference: string;
  profile_enabled: boolean;
  profile_revision: number;
}

export interface FleetEffectCounters {
  automatic_restart_count: number;
  disconnect_detection_count: number;
  tui_write_count: number;
  tmux_send_keys_count: number;
  clipboard_write_count: number;
  existing_session_injection_count: number;
  workspace_write_count: number;
  schema_mutation_count: number;
  deploy_count: number;
  merge_count: number;
  activation_count: number;
  aun_queue_mutation_count: number;
  external_send_count: number;
  parallel_target_count: number;
}

export const FRESH_SESSION_ZERO_EFFECTS: Readonly<FleetEffectCounters> = Object.freeze({
  automatic_restart_count: 0,
  disconnect_detection_count: 0,
  tui_write_count: 0,
  tmux_send_keys_count: 0,
  clipboard_write_count: 0,
  existing_session_injection_count: 0,
  workspace_write_count: 0,
  schema_mutation_count: 0,
  deploy_count: 0,
  merge_count: 0,
  activation_count: 0,
  aun_queue_mutation_count: 0,
  external_send_count: 0,
  parallel_target_count: 0,
});

const EFFECT_KEYS = Object.freeze(Object.keys(FRESH_SESSION_ZERO_EFFECTS).sort());

export interface FreshSessionLaunchSpec {
  agent_id: string;
  prior_session_id: string;
  selected_pack_ref: string;
  expected_objective: string;
  expected_next_action: string;
}

export interface FreshSessionLaunchContext {
  fresh_session_id: string;
  timeout_ms: typeof FRESH_SESSION_TIMEOUT_MS;
  signal: AbortSignal;
}

export interface FreshSessionLaunchReceipt {
  agent_id: string;
  memory_project: string;
  workspace: string;
  runtime: FleetRuntime;
  fresh_session_id: string;
  recovered_objective: string;
  recovered_next_action: string;
  continuation_started: boolean;
  user_context_restatement_count: number;
  effects: FleetEffectCounters;
}

export type FreshSessionLauncher = (
  target: FleetTarget,
  spec: FreshSessionLaunchSpec,
  context: FreshSessionLaunchContext,
) => Promise<FreshSessionLaunchReceipt>;

export interface FleetPreflightReport {
  schema_version: "kusabi-fresh-session-preflight/v1";
  status: "ready" | "stopped";
  target_count: number;
  exact_membership: boolean;
  sequential_only: true;
  timeout_ms: typeof FRESH_SESSION_TIMEOUT_MS;
  errors: string[];
  effects: Readonly<FleetEffectCounters>;
}

export interface IndependentAuditGate {
  schema_version: "kusabi-fresh-session-independent-audit/v1";
  verdict: "PASS";
  exact_head_sha: string;
  auditor: "devauditor" | "codex-audit";
  independent: true;
  durable_url: string;
}

export interface FreshSessionTargetEvidence {
  ordinal: number;
  agent_id: string;
  memory_project: string;
  workspace: string;
  runtime: FleetRuntime;
  profile_revision: number;
  prior_session_id: string;
  fresh_session_id: string;
  started_at: string;
  finished_at: string;
  elapsed_ms: number;
  objective_sha256: string;
  next_action_sha256: string;
  exact_objective_match: boolean;
  exact_next_action_match: boolean;
  identity_match: boolean;
  continuation_started: boolean;
  user_context_restatement_count: number;
  status: "pass" | "fail";
  errors: string[];
  effects: FleetEffectCounters;
}

export interface FreshSessionFleetEvidence {
  schema_version: typeof FRESH_SESSION_EVIDENCE_SCHEMA;
  run_id: string;
  status: "pass" | "failed" | "stopped";
  started_at: string;
  finished_at: string;
  timeout_ms: typeof FRESH_SESSION_TIMEOUT_MS;
  target_count: 12;
  attempted_count: number;
  pass_count: number;
  fail_count: number;
  max_concurrency: number;
  completion_rate: number;
  exact_identity_rate: number;
  exact_recovery_rate: number;
  continuation_started_rate: number;
  preflight: FleetPreflightReport;
  audit_gate: IndependentAuditGate;
  targets: FreshSessionTargetEvidence[];
  errors: string[];
  effects: FleetEffectCounters;
  next_action: "none" | "stop_on_first_failure";
}

export interface FleetPreflightInput {
  profiles: FleetRuntimeProfile[];
  declaredRuntimeBindings?: Readonly<Record<string, string>>;
  repositoryRoot?: string;
  verifyAdapterFiles?: boolean;
}

export function verifyIndependentAuditGate(
  gate: IndependentAuditGate,
  currentHeadSha: string,
): string[] {
  const errors: string[] = [];
  if (gate.schema_version !== "kusabi-fresh-session-independent-audit/v1") errors.push("FAIL_AUDIT_SCHEMA");
  if (gate.verdict !== "PASS") errors.push("FAIL_AUDIT_VERDICT");
  if (gate.auditor !== "devauditor" && gate.auditor !== "codex-audit") errors.push("FAIL_AUDITOR_NOT_INDEPENDENT");
  if (gate.independent !== true) errors.push("FAIL_AUDIT_NOT_INDEPENDENT");
  if (!/^[a-f0-9]{40}$/.test(gate.exact_head_sha) || gate.exact_head_sha !== currentHeadSha) errors.push("FAIL_AUDIT_EXACT_HEAD");
  if (!gate.durable_url.startsWith("https://github.com/") || !gate.durable_url.includes("#issuecomment-")) {
    errors.push("FAIL_AUDIT_DURABLE_URL");
  }
  return errors;
}

export function preflightFreshSessionFleet(input: FleetPreflightInput): FleetPreflightReport {
  const errors: string[] = [];
  const expectedIds = FRESH_SESSION_FLEET_TARGETS.map((target) => target.agent_id);
  const actualIds = input.profiles.map((profile) => profile.agent_id);
  const profileById = new Map(input.profiles.map((profile) => [profile.agent_id, profile]));
  const exactMembership = actualIds.length === expectedIds.length &&
    new Set(actualIds).size === expectedIds.length &&
    expectedIds.every((id) => profileById.has(id));
  if (!exactMembership) errors.push("FAIL_EXACT_12_TARGET_MEMBERSHIP");

  for (const target of FRESH_SESSION_FLEET_TARGETS) {
    const profile = profileById.get(target.agent_id);
    if (!profile) {
      errors.push(`FAIL_PROFILE_MISSING:${target.agent_id}`);
      continue;
    }
    if (!profile.profile_enabled) errors.push(`FAIL_PROFILE_DISABLED:${target.agent_id}`);
    if (resolve(profile.home_directory) !== target.workspace) errors.push(`FAIL_WORKSPACE_MISMATCH:${target.agent_id}`);
    if (profile.runtime_engine_preference !== target.runtime) errors.push(`FAIL_RUNTIME_MISMATCH:${target.agent_id}`);
    if (profile.profile_revision !== target.profile_revision) errors.push(`FAIL_PROFILE_REVISION_MISMATCH:${target.agent_id}`);
    const declared = input.declaredRuntimeBindings?.[target.agent_id];
    if (declared !== undefined && declared !== profile.runtime_engine_preference) {
      errors.push(`FAIL_STALE_RUNTIME_BINDING:${target.agent_id}`);
    }
  }

  if (input.verifyAdapterFiles !== false) {
    verifyAdapterBoundary(input.repositoryRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."), errors);
  }

  return {
    schema_version: "kusabi-fresh-session-preflight/v1",
    status: errors.length === 0 ? "ready" : "stopped",
    target_count: expectedIds.length,
    exact_membership: exactMembership,
    sequential_only: true,
    timeout_ms: FRESH_SESSION_TIMEOUT_MS,
    errors,
    effects: FRESH_SESSION_ZERO_EFFECTS,
  };
}

function verifyAdapterBoundary(repositoryRoot: string, errors: string[]): void {
  const compiledMode = fileURLToPath(import.meta.url).endsWith(".js");
  const files = compiledMode
    ? ["dist/codex-start.js", "dist/claude-start.js", "dist/boot.js", "scripts/host-adapters/codex-bridge-launch.sh"]
    : ["src/codex-start.ts", "src/claude-start.ts", "src/boot.ts", "scripts/host-adapters/codex-bridge-launch.sh"];
  for (const relative of files) {
    const path = resolve(repositoryRoot, relative);
    if (!existsSync(path)) {
      errors.push(`FAIL_ADAPTER_MISSING:${relative}`);
      continue;
    }
    const text = readFileSync(path, "utf8");
    if (/tmux\s+send-keys|\bpbcopy\b|\bosascript\b|clipboard(?:\.write|\s+write)/i.test(text)) {
      errors.push(`FAIL_FORBIDDEN_TUI_WRITE_SURFACE:${relative}`);
    }
  }
  const codexHelp = spawnSync(process.env.AGENT_MEMORY_CODEX_BIN ?? "codex", ["exec", "--help"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  const codexSurface = `${codexHelp.stdout ?? ""}\n${codexHelp.stderr ?? ""}`;
  if (codexHelp.status !== 0 || !codexSurface.includes("instructions are read from stdin") ||
      !codexSurface.includes("--json") || !codexSurface.includes("--skip-git-repo-check") ||
      !codexSurface.includes("--sandbox")) {
    errors.push("FAIL_CODEX_FRESH_SESSION_CAPABILITY");
  }
  const codexRootHelp = spawnSync(process.env.AGENT_MEMORY_CODEX_BIN ?? "codex", ["--help"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (codexRootHelp.status !== 0 || !`${codexRootHelp.stdout ?? ""}\n${codexRootHelp.stderr ?? ""}`.includes("--ask-for-approval")) {
    errors.push("FAIL_CODEX_APPROVAL_CAPABILITY");
  }
  const claudeHelp = spawnSync(process.env.AGENT_MEMORY_CLAUDE_BIN ?? "claude", ["--help"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  const claudeSurface = `${claudeHelp.stdout ?? ""}\n${claudeHelp.stderr ?? ""}`;
  if (claudeHelp.status !== 0 || !claudeSurface.includes("--settings <file-or-json>") ||
      !claudeSurface.includes("--session-id") || !claudeSurface.includes("--output-format") ||
      !claudeSurface.includes("--permission-mode")) {
    errors.push("FAIL_CLAUDE_FRESH_SESSION_CAPABILITY");
  }
}

export async function runFreshSessionFleet(
  input: FleetPreflightInput & {
    launchSpecs: FreshSessionLaunchSpec[];
    auditGate: IndependentAuditGate;
    exactHeadSha: string;
  },
  launcher: FreshSessionLauncher,
  dependencies: {
    now?: () => number;
    isoNow?: () => string;
    timeoutMsForTest?: number;
  } = {},
): Promise<FreshSessionFleetEvidence> {
  const preflight = preflightFreshSessionFleet(input);
  const runId = randomUUID();
  const startedAt = (dependencies.isoNow ?? (() => new Date().toISOString()))();
  if (preflight.status !== "ready") {
    return buildFleetEvidence(runId, "stopped", startedAt, [], preflight, input.auditGate, [...preflight.errors], 0);
  }

  const auditErrors = verifyIndependentAuditGate(input.auditGate, input.exactHeadSha);
  if (auditErrors.length > 0) {
    return buildFleetEvidence(runId, "stopped", startedAt, [], preflight, input.auditGate, auditErrors, 0);
  }

  const specById = new Map(input.launchSpecs.map((spec) => [spec.agent_id, spec]));
  if (input.launchSpecs.length !== 12 || specById.size !== 12 ||
      FRESH_SESSION_FLEET_TARGETS.some((target) => !specById.has(target.agent_id))) {
    const errors = ["FAIL_EXACT_12_LAUNCH_SPECS"];
    return buildFleetEvidence(runId, "stopped", startedAt, [], preflight, input.auditGate, errors, 0);
  }
  const specErrors = validateLaunchSpecs(input.launchSpecs);
  if (specErrors.length > 0) {
    return buildFleetEvidence(runId, "stopped", startedAt, [], preflight, input.auditGate, specErrors, 0);
  }

  const now = dependencies.now ?? Date.now;
  const timeoutMs = dependencies.timeoutMsForTest ?? FRESH_SESSION_TIMEOUT_MS;
  const results: FreshSessionTargetEvidence[] = [];
  let active = 0;
  let maxConcurrency = 0;

  for (const target of FRESH_SESSION_FLEET_TARGETS) {
    const spec = specById.get(target.agent_id)!;
    const freshSessionId = randomUUID();
    const startedMs = now();
    const targetStartedAt = new Date().toISOString();
    const controller = new AbortController();
    active += 1;
    maxConcurrency = Math.max(maxConcurrency, active);
    let receipt: FreshSessionLaunchReceipt | undefined;
    let launchError: unknown;
    try {
      receipt = await withHardTimeout(
        launcher(target, spec, {
          fresh_session_id: freshSessionId,
          timeout_ms: FRESH_SESSION_TIMEOUT_MS,
          signal: controller.signal,
        }),
        timeoutMs,
        controller,
      );
    } catch (error) {
      launchError = error;
    } finally {
      active -= 1;
    }

    const finishedMs = now();
    const errors = verifyLaunchReceipt(target, spec, freshSessionId, receipt, launchError, finishedMs - startedMs);
    const effects = receipt?.effects ?? { ...FRESH_SESSION_ZERO_EFFECTS };
    results.push({
      ordinal: target.ordinal,
      agent_id: target.agent_id,
      memory_project: target.memory_project,
      workspace: target.workspace,
      runtime: target.runtime,
      profile_revision: target.profile_revision,
      prior_session_id: spec.prior_session_id,
      fresh_session_id: receipt?.fresh_session_id ?? freshSessionId,
      started_at: targetStartedAt,
      finished_at: new Date().toISOString(),
      elapsed_ms: Math.max(0, finishedMs - startedMs),
      objective_sha256: sha256(spec.expected_objective),
      next_action_sha256: sha256(spec.expected_next_action),
      exact_objective_match: receipt?.recovered_objective === spec.expected_objective,
      exact_next_action_match: receipt?.recovered_next_action === spec.expected_next_action,
      identity_match: receipt !== undefined && receipt.agent_id === target.agent_id &&
        receipt.memory_project === target.memory_project &&
        receiptWorkspaceMatches(receipt.workspace, target.workspace) &&
        receipt.runtime === target.runtime && isUuid(receipt.fresh_session_id),
      continuation_started: receipt?.continuation_started === true,
      user_context_restatement_count: receipt?.user_context_restatement_count ?? 0,
      status: errors.length === 0 ? "pass" : "fail",
      errors,
      effects,
    });
    if (errors.length > 0) {
      return buildFleetEvidence(runId, "failed", startedAt, results, preflight, input.auditGate, errors.map((error) => `${target.agent_id}:${error}`), maxConcurrency);
    }
  }

  return buildFleetEvidence(runId, "pass", startedAt, results, preflight, input.auditGate, [], maxConcurrency);
}

function validateLaunchSpecs(specs: FreshSessionLaunchSpec[]): string[] {
  const errors: string[] = [];
  const packRefs = new Set<string>();
  for (const spec of specs) {
    if (!canonicalNonEmpty(spec.prior_session_id)) errors.push(`FAIL_PRIOR_SESSION_ID:${spec.agent_id}`);
    if (!/^selected_restart_pack:[a-zA-Z0-9-]+$/.test(spec.selected_pack_ref)) errors.push(`FAIL_SELECTED_PACK_REF:${spec.agent_id}`);
    if (packRefs.has(spec.selected_pack_ref)) errors.push(`FAIL_DUPLICATE_SELECTED_PACK_REF:${spec.agent_id}`);
    packRefs.add(spec.selected_pack_ref);
    if (!canonicalNonEmpty(spec.expected_objective)) errors.push(`FAIL_EXPECTED_OBJECTIVE:${spec.agent_id}`);
    if (!canonicalNonEmpty(spec.expected_next_action)) errors.push(`FAIL_EXPECTED_NEXT_ACTION:${spec.agent_id}`);
  }
  return errors;
}

function canonicalNonEmpty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("\0");
}

export function receiptWorkspaceMatches(
  receivedWorkspace: string,
  expectedWorkspace: string,
  homeDirectory: string = homedir(),
): boolean {
  const canonicalExpected = resolve(expectedWorkspace);
  if (receivedWorkspace === canonicalExpected) return true;

  const canonicalHome = resolve(homeDirectory);
  const redactedExpected = canonicalExpected === canonicalHome
    ? "~"
    : canonicalExpected.startsWith(`${canonicalHome}${sep}`)
      ? `~${canonicalExpected.slice(canonicalHome.length)}`
      : null;
  return redactedExpected !== null && receivedWorkspace === redactedExpected;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function verifyLaunchReceipt(
  target: FleetTarget,
  spec: FreshSessionLaunchSpec,
  freshSessionId: string,
  receipt: FreshSessionLaunchReceipt | undefined,
  launchError: unknown,
  elapsedMs: number,
): string[] {
  if (launchError !== undefined) {
    return [launchError instanceof Error ? launchError.message : "FAIL_LAUNCH_UNKNOWN"];
  }
  if (!receipt) return ["FAIL_LAUNCH_RECEIPT_MISSING"];
  const errors: string[] = [];
  if (freshSessionId === spec.prior_session_id || receipt.fresh_session_id === spec.prior_session_id ||
      !isUuid(receipt.fresh_session_id)) errors.push("FAIL_SESSION_NOT_FRESH");
  if (elapsedMs > FRESH_SESSION_TIMEOUT_MS) errors.push("FAIL_OVER_60_SECONDS");
  if (receipt.agent_id !== target.agent_id || receipt.memory_project !== target.memory_project ||
      !receiptWorkspaceMatches(receipt.workspace, target.workspace) ||
      receipt.runtime !== target.runtime) errors.push("FAIL_EXACT_IDENTITY");
  if (receipt.recovered_objective !== spec.expected_objective) errors.push("FAIL_EXACT_OBJECTIVE");
  if (receipt.recovered_next_action !== spec.expected_next_action) errors.push("FAIL_EXACT_NEXT_ACTION");
  if (receipt.continuation_started !== true) errors.push("FAIL_CONTINUATION_NOT_STARTED");
  if (receipt.user_context_restatement_count !== 0) errors.push("FAIL_USER_RESTATEMENT_REQUIRED");
  if (!exactZeroEffects(receipt.effects)) errors.push("FAIL_FORBIDDEN_EFFECT");
  return errors;
}

function withHardTimeout<T>(promise: Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      controller.abort();
      rejectPromise(new Error("FAIL_60_SECOND_TIMEOUT"));
    }, timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolvePromise(value); },
      (error) => { clearTimeout(timer); rejectPromise(error); },
    );
  });
}

function buildFleetEvidence(
  runId: string,
  status: FreshSessionFleetEvidence["status"],
  startedAt: string,
  targets: FreshSessionTargetEvidence[],
  preflight: FleetPreflightReport,
  auditGate: IndependentAuditGate,
  errors: string[],
  maxConcurrency: number,
): FreshSessionFleetEvidence {
  const passCount = targets.filter((target) => target.status === "pass").length;
  const aggregateEffects = sumEffects(targets.map((target) => target.effects));
  aggregateEffects.parallel_target_count += Math.max(0, maxConcurrency - 1);
  return {
    schema_version: FRESH_SESSION_EVIDENCE_SCHEMA,
    run_id: runId,
    status,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    timeout_ms: FRESH_SESSION_TIMEOUT_MS,
    target_count: 12,
    attempted_count: targets.length,
    pass_count: passCount,
    fail_count: targets.filter((target) => target.status === "fail").length,
    max_concurrency: maxConcurrency,
    completion_rate: passCount / 12,
    exact_identity_rate: targets.filter((target) => target.identity_match).length / 12,
    exact_recovery_rate: targets.filter((target) => target.exact_objective_match && target.exact_next_action_match).length / 12,
    continuation_started_rate: targets.filter((target) => target.continuation_started).length / 12,
    preflight,
    audit_gate: auditGate,
    targets,
    errors,
    effects: aggregateEffects,
    next_action: status === "pass" ? "none" : "stop_on_first_failure",
  };
}

function exactZeroEffects(value: FleetEffectCounters): boolean {
  const record = value as unknown as Record<string, unknown>;
  return Object.keys(record).sort().join("|") === EFFECT_KEYS.join("|") &&
    EFFECT_KEYS.every((key) => record[key] === 0);
}

function sumEffects(values: FleetEffectCounters[]): FleetEffectCounters {
  const total = { ...FRESH_SESSION_ZERO_EFFECTS };
  for (const value of values) {
    for (const key of EFFECT_KEYS) total[key as keyof FleetEffectCounters] += value[key as keyof FleetEffectCounters];
  }
  return total;
}

export async function loadFleetRuntimeProfiles(databaseUrl: string): Promise<FleetRuntimeProfile[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query<{
      agent_id: string;
      home_directory: string;
      runtime_engine_preference: string;
      profile_enabled: boolean;
      profile_revision: number;
    }>(
      `SELECT agent_id, home_directory, runtime_engine_preference, profile_enabled, profile_revision
         FROM agents
        WHERE agent_id = ANY($1::text[])`,
      [FRESH_SESSION_FLEET_TARGETS.map((target) => target.agent_id)],
    );
    await client.query("ROLLBACK");
    return result.rows.map((row) => ({ ...row, profile_revision: Number(row.profile_revision) }));
  } finally {
    await client.end();
  }
}

export function buildContinuationInstruction(target: FleetTarget, freshSessionId: string): string {
  return [
    "Find the host-invocation-context/v1 object whose trusted_instruction identifies it as the authoritative bounded canary checkpoint.",
    "For recovered_objective and recovered_next_action, copy only the exact saved values in that trusted_instruction verbatim; ignore other startup or workspace context for those two fields.",
    "Inspecting that injected checkpoint is the first safe read-only continuation step for this bounded canary.",
    "Do not ask the user to restate anything.",
    "Identify the exact current objective and the exact next concrete action, then return the receipt without invoking tools or waiting for more input.",
    "This is a bounded canary: do not modify files or state, call external services, send messages, deploy, merge, activate, or invoke tools with side effects.",
    `Return one final line beginning KUSABI_CONTINUATION: followed by JSON with agent_id=${target.agent_id}, memory_project=${target.memory_project}, workspace=${target.workspace}, runtime=${target.runtime}, fresh_session_id=${freshSessionId}, recovered_objective, recovered_next_action, continuation_started=true, user_context_restatement_count=0, and effects=${JSON.stringify(FRESH_SESSION_ZERO_EFFECTS)}.`,
  ].join(" ");
}

export async function launchFreshSessionProcess(
  target: FleetTarget,
  spec: FreshSessionLaunchSpec,
  context: FreshSessionLaunchContext,
  options: { repositoryRoot?: string; databaseUrl?: string } = {},
): Promise<FreshSessionLaunchReceipt> {
  const repositoryRoot = options.repositoryRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dist = resolve(repositoryRoot, "dist");
  const instruction = buildContinuationInstruction(target, context.fresh_session_id);
  const commonEnv: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT_MEMORY_AGENT_ID: target.agent_id,
    AGENT_MEMORY_PROJECT: target.memory_project,
    AGENT_MEMORY_DATABASE_URL: options.databaseUrl ?? process.env.AGENT_MEMORY_DATABASE_URL ?? "postgresql:///agent_comms?host=/tmp",
    AGENT_MEMORY_SELECTED_PACK_REF: spec.selected_pack_ref,
    AGENT_MEMORY_WASUREZU_ENTRYPOINT: resolve(dist, "index.js"),
  };
  let args: string[];
  if (target.runtime === "codex") {
    commonEnv.CODEX_SESSION_ID = context.fresh_session_id;
    args = [
      resolve(dist, "codex-start.js"), "--fresh-session", "--selected-pack-ref", spec.selected_pack_ref,
      "--cd", target.workspace, "--extra", instruction,
      "--codex-arg", "--sandbox", "--codex-arg", "read-only",
      "--codex-global-arg", "--ask-for-approval", "--codex-global-arg", "never",
    ];
  } else {
    commonEnv.CLAUDE_SESSION_ID = context.fresh_session_id;
    args = [
      resolve(dist, "claude-start.js"), "--fresh-session", "--agent-id", target.agent_id,
      "--project", target.memory_project, "--cd", target.workspace,
      "--selected-pack-ref", spec.selected_pack_ref,
      "--boot-js", resolve(dist, "boot.js"), "--session-id", context.fresh_session_id,
      "--claude-arg", "-p", "--claude-arg", instruction,
      "--claude-arg", "--output-format", "--claude-arg", "json",
      "--claude-arg", "--permission-mode", "--claude-arg", "plan",
    ];
  }
  const output = await spawnCaptured(process.execPath, args, commonEnv, context.signal);
  const combinedOutput = `${output.stdout}\n${output.stderr}`;
  const receipt = parseContinuationReceipt(combinedOutput);
  const hostSessionId = parseHostSessionId(combinedOutput, target.runtime);
  if (target.runtime === "claude-code" && hostSessionId !== context.fresh_session_id) {
    throw new Error("FAIL_CLAUDE_HOST_SESSION_ID_MISMATCH");
  }
  return { ...receipt, fresh_session_id: hostSessionId };
}

function spawnCaptured(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const detached = process.platform !== "win32";
    const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"], detached });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const stopProcessGroup = (): void => {
      if (child.pid === undefined) return;
      try {
        if (detached) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch { /* the bounded child may already have exited */ }
    };
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(error);
    };
    const onAbort = (): void => {
      stopProcessGroup();
      rejectOnce(new Error("FAIL_FRESH_PROCESS_ABORTED"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString("utf8");
      if (next.length > 2_000_000) {
        stopProcessGroup();
        rejectOnce(new Error("FAIL_PROCESS_OUTPUT_LIMIT"));
        return current;
      }
      return next;
    };
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.on("error", (error) => rejectOnce(error));
    child.on("exit", (code, childSignal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) resolvePromise({ stdout, stderr });
      else rejectPromise(new Error(`FAIL_FRESH_PROCESS_EXIT:${childSignal ?? code}`));
    });
  });
}

export function parseContinuationReceipt(output: string): FreshSessionLaunchReceipt {
  const strings: string[] = [output, ...output.split(/\r?\n/)];
  for (const line of output.split(/\r?\n/)) {
    try { collectStrings(JSON.parse(line), strings); } catch { /* non-JSON host output */ }
  }
  for (const value of strings) {
    const marker = value.indexOf("KUSABI_CONTINUATION:");
    if (marker < 0) continue;
    const candidate = value.slice(marker + "KUSABI_CONTINUATION:".length).trim();
    try {
      const parsed = JSON.parse(candidate) as FreshSessionLaunchReceipt;
      if (parsed && typeof parsed === "object") return parsed;
    } catch { /* continue searching nested host output */ }
  }
  throw new Error("FAIL_CONTINUATION_RECEIPT_MISSING_OR_MALFORMED");
}

export function parseHostSessionId(output: string, runtime: FleetRuntime): string {
  for (const line of output.split(/\r?\n/)) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const candidate = runtime === "codex" && record.type === "thread.started"
      ? record.thread_id
      : runtime === "claude-code"
        ? record.session_id
        : undefined;
    if (typeof candidate === "string" && isUuid(candidate)) return candidate;
  }
  throw new Error("FAIL_HOST_SESSION_ID_MISSING_OR_MALFORMED");
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value !== null && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, out));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const live = args.includes("--live");
  const profilesJson = optionValue(args, "--profiles-json");
  const inputJson = optionValue(args, "--input-json");
  const auditJson = optionValue(args, "--audit-json");
  const databaseUrl = process.env.AGENT_COMMS_DATABASE_URL ?? "postgresql:///agent_comms?host=/tmp";
  const profiles = profilesJson
    ? JSON.parse(readFileSync(resolve(profilesJson), "utf8")) as FleetRuntimeProfile[]
    : await loadFleetRuntimeProfiles(databaseUrl);
  if (!live) {
    const report = preflightFreshSessionFleet({ profiles });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "ready") process.exitCode = 2;
    return;
  }
  if (!inputJson || !auditJson) throw new Error("--live requires --input-json and --audit-json");
  const launchSpecs = JSON.parse(readFileSync(resolve(inputJson), "utf8")) as FreshSessionLaunchSpec[];
  const auditGate = JSON.parse(readFileSync(resolve(auditJson), "utf8")) as IndependentAuditGate;
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const headResult = spawnSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (headResult.status !== 0) throw new Error("FAIL_CURRENT_HEAD_READBACK");
  const exactHeadSha = headResult.stdout.trim();
  const evidence = await runFreshSessionFleet(
    { profiles, launchSpecs, auditGate, exactHeadSha },
    (target, spec, context) => launchFreshSessionProcess(target, spec, context),
  );
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.status !== "pass") process.exitCode = 2;
}

function optionValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`[kusabi-fresh-session-fleet] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
