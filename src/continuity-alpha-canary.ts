#!/usr/bin/env node
/**
 * Fail-closed planner and verifier for the ALPHA-05 observed live canary.
 *
 * This module never places hooks, trusts configuration, launches or ends a
 * host process, or writes evidence. Operators own the old-session exit and
 * ordinary-command fresh-session start; this code only binds and evaluates
 * their immutable receipts.
 */
import { createHash } from "node:crypto";
import { realpathSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTINUITY_ALPHA_EVALUATOR_VERSION,
  CONTINUITY_ALPHA_HOST_CONTRACT,
  CONTINUITY_ALPHA_HOSTS,
  CONTINUITY_ALPHA_P0_AGENTS,
  CONTINUITY_ALPHA_SCENARIOS,
  CONTINUITY_ALPHA_THRESHOLDS,
  CONTINUITY_ALPHA_ZERO_EFFECTS,
  S15_FIXTURE_ID,
  evaluateCanonicalS15Fixture,
  evaluateContinuityAlphaSuite,
  type ContinuityAlphaEffectCounters,
  type ContinuityAlphaHost,
  type ContinuityAlphaRunEvidence,
  type ContinuityAlphaSuiteEvaluation,
  type ContinuityAlphaSuiteInput,
} from "./continuity-alpha-evaluator.js";

export const CONTINUITY_ALPHA_CANARY_PLAN_VERSION = "continuity-alpha-canary-plan/v1" as const;
export const CONTINUITY_ALPHA_CANARY_VERIFICATION_VERSION = "continuity-alpha-canary-verification/v1" as const;
export const CONTINUITY_ALPHA_CANARY_PLAN_REF = "https://github.com/watchout/agent-memory/issues/180#issuecomment-5076405102" as const;
export const CONTINUITY_ALPHA_CANARY_CONTROL_SOURCE_REF = "https://github.com/watchout/agent-memory/issues/180#issuecomment-5053368043" as const;
export const CONTINUITY_ALPHA_CANARY_OWNER_ENVELOPE_REF = "https://github.com/watchout/agent-memory/issues/180#issuecomment-5054279853" as const;
export const CONTINUITY_ALPHA_CANARY_DEPENDENCY_REFS = Object.freeze([
  "https://github.com/watchout/agent-memory/pull/265",
  "https://github.com/watchout/agent-memory/pull/270",
  "https://github.com/watchout/agent-memory/pull/266",
  "https://github.com/watchout/agent-memory/pull/267",
] as const);
export const CONTINUITY_ALPHA_OBSERVATION_RECEIPT_VERSION = "continuity-alpha-observation-receipt/v1" as const;
export const CONTINUITY_ALPHA_OBSERVATION_RECEIPT_MARKER = "<!-- continuity-alpha-observation-receipt/v1 -->" as const;

export interface ContinuityAlphaCanaryEffectCounters extends ContinuityAlphaEffectCounters {
  host_launch_count: number;
  session_exit_count: number;
  evidence_write_count: number;
  external_send_count: number;
  live_canary_execution_count: number;
  deploy_count: number;
  production_mutation_count: number;
}

export const CONTINUITY_ALPHA_CANARY_ZERO_EFFECTS: Readonly<ContinuityAlphaCanaryEffectCounters> = Object.freeze({
  ...CONTINUITY_ALPHA_ZERO_EFFECTS,
  host_launch_count: 0,
  session_exit_count: 0,
  evidence_write_count: 0,
  external_send_count: 0,
  live_canary_execution_count: 0,
  deploy_count: 0,
  production_mutation_count: 0,
});

const CONTINUITY_ALPHA_CANARY_EFFECT_KEYS = Object.freeze(Object.keys(CONTINUITY_ALPHA_CANARY_ZERO_EFFECTS).sort());

export interface ContinuityAlphaObservationReceipt {
  schema_version: typeof CONTINUITY_ALPHA_OBSERVATION_RECEIPT_VERSION;
  capture_id: string;
  captured_at: string;
  observer_actor: string;
  receipt_ref: string;
  plan_id: string;
  run_ref: string;
  exact_head: string;
  exact_tree: string;
  agent_id: string;
  runtime: ContinuityAlphaHost;
  project: string;
  workspace: string;
  binding_ref: string;
  ordinary_launch_command: string;
  native_start_surface: string;
  identity_receipt_ref: string;
  first_context_receipt_ref: string;
  action_receipt_ref: string;
  result_receipt_ref: string;
  evidence_sha256: string;
}

export type ContinuityAlphaObservedRunEvidence = ContinuityAlphaRunEvidence & {
  observation_receipt: ContinuityAlphaObservationReceipt;
};

export interface ContinuityAlphaCanarySuiteInput extends Omit<ContinuityAlphaSuiteInput, "runs" | "effects"> {
  runs: ContinuityAlphaObservedRunEvidence[];
  effects: ContinuityAlphaCanaryEffectCounters;
}

export interface ContinuityAlphaCanaryTarget {
  agent_id: string;
  runtime: ContinuityAlphaHost;
  project: string;
  workspace_ref: string;
  binding_ref: string;
}

export interface ContinuityAlphaHostCanaryTarget extends ContinuityAlphaCanaryTarget {
  use: "alpha-canary-only";
  normal_work_queue: false;
}

export interface ContinuityAlphaCanaryPlanInput {
  schema_version: "continuity-alpha-canary-plan-input/v1";
  plan_ref: string;
  exact_head: string;
  exact_tree: string;
  control_source_ref: string;
  owner_envelope_ref: string;
  dependency_refs: string[];
  targets: ContinuityAlphaCanaryTarget[];
  host_canaries: ContinuityAlphaHostCanaryTarget[];
}

export interface ContinuityAlphaCanaryPlan {
  schema_version: typeof CONTINUITY_ALPHA_CANARY_PLAN_VERSION;
  plan_id: string;
  status: "ready_for_operator" | "stopped";
  errors: string[];
  exact_subject: {
    head: string;
    tree: string;
    plan_ref: string;
    control_source_ref: string;
    owner_envelope_ref: string;
    dependency_refs: string[];
  };
  evaluator: {
    version: typeof CONTINUITY_ALPHA_EVALUATOR_VERSION;
    s15_fixture_id: typeof S15_FIXTURE_ID;
    s15_checked_first: true;
    s15_passed: boolean;
  };
  contract: {
    p0_order: string[];
    host_matrix: Array<{
      runtime: ContinuityAlphaHost;
      ordinary_command: string;
      native_start_surface: string;
    }>;
    scenarios: Array<{ id: string; name: string }>;
    thresholds: typeof CONTINUITY_ALPHA_THRESHOLDS;
    sequential: true;
    stop_on_first_failure: true;
    initial_sudden_death_agents: ["kusabi", "spec"];
    operator_actions: ["end_old_session", "start_fresh_session_with_ordinary_command"];
    observation_receipt: {
      schema_version: typeof CONTINUITY_ALPHA_OBSERVATION_RECEIPT_VERSION;
      source: "durable_github_issue_comment";
      payload_digest: "sha256";
      exact_identity_binding: true;
      resolution: "github_api_comment_by_id";
      requires_unedited_comment: true;
      maximum_capture_to_comment_ms: 3_600_000;
      embedded_exact_receipt: true;
    };
  };
  targets: ContinuityAlphaCanaryTarget[];
  host_canaries: ContinuityAlphaHostCanaryTarget[];
  operator_steps: Array<{
    ordinal: number;
    agent_id: string;
    runtime: ContinuityAlphaHost;
    ordinary_command: string;
    workspace_ref: string;
    action: "operator_exit_then_ordinary_fresh_start";
  }>;
  host_canary_steps: Array<{
    ordinal: number;
    agent_id: string;
    runtime: ContinuityAlphaHost;
    ordinary_command: string;
    workspace_ref: string;
    action: "operator_exit_then_ordinary_fresh_start";
  }>;
  forbidden_automation: string[];
  preflight_effects: ContinuityAlphaCanaryEffectCounters;
  claims: {
    live_execution_performed: false;
    first_context_delivery_confirmed: false;
    continuity_alpha_candidate: false;
  };
  next_action: {
    blocking: true;
    responsible_actor: "operator" | "implementation_executor";
    action: "place_and_review_exact_hook_then_run_first_sequential_operator_canary" | "fix_plan_before_operator_run";
  };
}

export interface ContinuityAlphaCanaryVerification {
  schema_version: typeof CONTINUITY_ALPHA_CANARY_VERIFICATION_VERSION;
  plan_id: string;
  plan_digest: string;
  status: "pass" | "fail" | "stopped";
  errors: string[];
  evaluation: ContinuityAlphaSuiteEvaluation;
  exact_subject: ContinuityAlphaCanaryPlan["exact_subject"];
  operator_boundary_verified: boolean;
  target_binding_verified: boolean;
  receipt_provenance_verified: boolean;
  verified_receipt_refs: string[];
  sudden_death_scope_verified: boolean;
  continuity_alpha_candidate: boolean;
  next_action: "none" | "fix_canary_evidence" | "fix_evaluator_before_operator_run";
}

function isText(value: unknown): value is string {
  return typeof value === "string"
    && value.trim() === value
    && value.length > 0
    && !value.includes("\0");
}

function isSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isDurableObservationRef(value: unknown): value is string {
  return typeof value === "string"
    && /^https:\/\/github\.com\/watchout\/agent-memory\/(?:issues|pull)\/[1-9]\d*#issuecomment-[1-9]\d*$/.test(value);
}

function exactArray(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function continuityAlphaObservedRunDigest(run: ContinuityAlphaRunEvidence | ContinuityAlphaObservedRunEvidence): string {
  const { observation_receipt: _receipt, ...evidence } = run as ContinuityAlphaObservedRunEvidence;
  return digest(evidence);
}

export function continuityAlphaObservationReceiptComment(receipt: ContinuityAlphaObservationReceipt): string {
  return `${CONTINUITY_ALPHA_OBSERVATION_RECEIPT_MARKER}\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\``;
}

function exactZeroCanaryEffects(value: ContinuityAlphaCanaryEffectCounters): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as unknown as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return exactArray(keys, CONTINUITY_ALPHA_CANARY_EFFECT_KEYS)
    && CONTINUITY_ALPHA_CANARY_EFFECT_KEYS.every((key) => record[key] === 0);
}

function validateTargets(targets: ContinuityAlphaCanaryTarget[]): string[] {
  const errors: string[] = [];
  const agentIds = targets.map((target) => target.agent_id);
  if (!exactArray(agentIds, CONTINUITY_ALPHA_P0_AGENTS)) errors.push("FAIL_EXACT_P0_ORDER");
  if (new Set(agentIds).size !== agentIds.length) errors.push("FAIL_DUPLICATE_TARGET_AGENT");
  for (const target of targets) {
    if (!CONTINUITY_ALPHA_HOSTS.includes(target.runtime)) errors.push(`FAIL_TARGET_RUNTIME:${target.agent_id}`);
    if (!isText(target.project)) errors.push(`FAIL_TARGET_PROJECT:${target.agent_id}`);
    if (!isText(target.workspace_ref)) errors.push(`FAIL_TARGET_WORKSPACE_REF:${target.agent_id}`);
    if (!isText(target.binding_ref)) errors.push(`FAIL_TARGET_BINDING_REF:${target.agent_id}`);
    if (target.runtime === "gemini_cli") errors.push(`FAIL_P0_GEMINI_REQUIRES_DEDICATED_CANARY:${target.agent_id}`);
  }
  return errors;
}

function validateHostCanaries(targets: ContinuityAlphaHostCanaryTarget[]): string[] {
  const errors: string[] = [];
  if (targets.length !== CONTINUITY_ALPHA_HOSTS.length) errors.push("FAIL_EXACT_HOST_CANARY_COUNT");
  if (!exactArray(targets.map((target) => target.runtime), CONTINUITY_ALPHA_HOSTS)) {
    errors.push("FAIL_EXACT_HOST_CANARY_ORDER");
  }
  for (const target of targets) {
    if (!isText(target.agent_id)) errors.push(`FAIL_HOST_CANARY_AGENT:${target.runtime}`);
    if (!isText(target.project)) errors.push(`FAIL_HOST_CANARY_PROJECT:${target.runtime}`);
    if (!isText(target.workspace_ref)) errors.push(`FAIL_HOST_CANARY_WORKSPACE_REF:${target.runtime}`);
    if (!isText(target.binding_ref)) errors.push(`FAIL_HOST_CANARY_BINDING_REF:${target.runtime}`);
    if (target.use !== "alpha-canary-only") errors.push(`FAIL_HOST_CANARY_USE:${target.runtime}`);
    if (target.normal_work_queue !== false) errors.push(`FAIL_HOST_CANARY_QUEUE_BOUNDARY:${target.runtime}`);
  }
  const gemini = targets.find((target) => target.runtime === "gemini_cli");
  if (!gemini
    || gemini.agent_id !== "kusabi-gemini"
    || gemini.project !== "agent-memory"
    || gemini.workspace_ref !== "/Users/yuji/Developer/agent-memory") {
    errors.push("FAIL_DEDICATED_GEMINI_CANARY_IDENTITY");
  }
  return errors;
}

export function buildContinuityAlphaCanaryPlan(input: ContinuityAlphaCanaryPlanInput): ContinuityAlphaCanaryPlan {
  const s15 = evaluateCanonicalS15Fixture();
  const errors: string[] = [];
  if (input.schema_version !== "continuity-alpha-canary-plan-input/v1") errors.push("FAIL_PLAN_INPUT_SCHEMA");
  if (input.plan_ref !== CONTINUITY_ALPHA_CANARY_PLAN_REF) errors.push("FAIL_PLAN_REF");
  if (!isSha(input.exact_head)) errors.push("FAIL_EXACT_HEAD");
  if (!isSha(input.exact_tree)) errors.push("FAIL_EXACT_TREE");
  if (input.control_source_ref !== CONTINUITY_ALPHA_CANARY_CONTROL_SOURCE_REF) errors.push("FAIL_CONTROL_SOURCE_REF");
  if (input.owner_envelope_ref !== CONTINUITY_ALPHA_CANARY_OWNER_ENVELOPE_REF) errors.push("FAIL_OWNER_ENVELOPE_REF");
  if (!Array.isArray(input.dependency_refs)
    || !exactArray(input.dependency_refs, CONTINUITY_ALPHA_CANARY_DEPENDENCY_REFS)) {
    errors.push("FAIL_EXACT_DEPENDENCY_REFS");
  }
  if (!s15.passed) errors.unshift("AUTO_FAIL_S15_PREREQUISITE");
  errors.push(...validateTargets(input.targets));
  errors.push(...validateHostCanaries(input.host_canaries));
  const contract = {
    p0_order: [...CONTINUITY_ALPHA_P0_AGENTS],
    host_matrix: CONTINUITY_ALPHA_HOSTS.map((runtime) => ({
      runtime,
      ordinary_command: CONTINUITY_ALPHA_HOST_CONTRACT[runtime].command,
      native_start_surface: CONTINUITY_ALPHA_HOST_CONTRACT[runtime].start_surface,
    })),
    scenarios: CONTINUITY_ALPHA_SCENARIOS.map((scenario) => ({ ...scenario })),
    thresholds: CONTINUITY_ALPHA_THRESHOLDS,
    sequential: true as const,
    stop_on_first_failure: true as const,
    initial_sudden_death_agents: ["kusabi", "spec"] as ["kusabi", "spec"],
    operator_actions: ["end_old_session", "start_fresh_session_with_ordinary_command"] as [
      "end_old_session",
      "start_fresh_session_with_ordinary_command",
    ],
    observation_receipt: {
      schema_version: CONTINUITY_ALPHA_OBSERVATION_RECEIPT_VERSION,
      source: "durable_github_issue_comment" as const,
      payload_digest: "sha256" as const,
      exact_identity_binding: true as const,
      resolution: "github_api_comment_by_id" as const,
      requires_unedited_comment: true as const,
      maximum_capture_to_comment_ms: 3_600_000 as const,
      embedded_exact_receipt: true as const,
    },
  };
  const exactSubject = {
    head: input.exact_head,
    tree: input.exact_tree,
    plan_ref: input.plan_ref,
    control_source_ref: input.control_source_ref,
    owner_envelope_ref: input.owner_envelope_ref,
    dependency_refs: [...input.dependency_refs],
  };
  const planId = `alpha05:${digest({ exactSubject, contract, targets: input.targets, hostCanaries: input.host_canaries })}`;
  return {
    schema_version: CONTINUITY_ALPHA_CANARY_PLAN_VERSION,
    plan_id: planId,
    status: errors.length === 0 ? "ready_for_operator" : "stopped",
    errors: [...new Set(errors)],
    exact_subject: exactSubject,
    evaluator: {
      version: CONTINUITY_ALPHA_EVALUATOR_VERSION,
      s15_fixture_id: S15_FIXTURE_ID,
      s15_checked_first: true,
      s15_passed: s15.passed,
    },
    contract,
    targets: input.targets.map((target) => ({ ...target })),
    host_canaries: input.host_canaries.map((target) => ({ ...target })),
    operator_steps: input.targets.map((target, index) => ({
      ordinal: index + 1,
      agent_id: target.agent_id,
      runtime: target.runtime,
      ordinary_command: CONTINUITY_ALPHA_HOST_CONTRACT[target.runtime].command,
      workspace_ref: target.workspace_ref,
      action: "operator_exit_then_ordinary_fresh_start" as const,
    })),
    host_canary_steps: input.host_canaries.map((target, index) => ({
      ordinal: index + 1,
      agent_id: target.agent_id,
      runtime: target.runtime,
      ordinary_command: CONTINUITY_ALPHA_HOST_CONTRACT[target.runtime].command,
      workspace_ref: target.workspace_ref,
      action: "operator_exit_then_ordinary_fresh_start" as const,
    })),
    forbidden_automation: [
      "disconnect_detection",
      "automatic_restart",
      "process_kill",
      "existing_session_injection",
      "tui_write",
      "tmux_send_keys",
      "clipboard_write",
      "aun_queue_mutation",
      "live_config_mutation",
      "trust_mutation",
      "activation",
      "rollout",
      "host_launch",
      "session_exit",
      "evidence_write",
      "external_send",
      "live_canary_execution",
      "deploy",
      "production_mutation",
    ],
    preflight_effects: { ...CONTINUITY_ALPHA_CANARY_ZERO_EFFECTS },
    claims: {
      live_execution_performed: false,
      first_context_delivery_confirmed: false,
      continuity_alpha_candidate: false,
    },
    next_action: errors.length === 0
      ? {
          blocking: true,
          responsible_actor: "operator" as const,
          action: "place_and_review_exact_hook_then_run_first_sequential_operator_canary" as const,
        }
      : {
          blocking: true,
          responsible_actor: "implementation_executor" as const,
          action: "fix_plan_before_operator_run" as const,
        },
  };
}

export function continuityAlphaCanaryPlanDigest(plan: ContinuityAlphaCanaryPlan): string {
  return digest(plan);
}

function planIntegrityErrors(plan: ContinuityAlphaCanaryPlan): string[] {
  try {
    const rebuilt = buildContinuityAlphaCanaryPlan({
      schema_version: "continuity-alpha-canary-plan-input/v1",
      plan_ref: plan.exact_subject.plan_ref,
      exact_head: plan.exact_subject.head,
      exact_tree: plan.exact_subject.tree,
      control_source_ref: plan.exact_subject.control_source_ref,
      owner_envelope_ref: plan.exact_subject.owner_envelope_ref,
      dependency_refs: [...plan.exact_subject.dependency_refs],
      targets: plan.targets.map((target) => ({ ...target })),
      host_canaries: plan.host_canaries.map((target) => ({ ...target })),
    });
    return canonical(rebuilt) === canonical(plan) ? [] : ["AUTO_FAIL_PLAN_INTEGRITY"];
  } catch {
    return ["AUTO_FAIL_PLAN_INTEGRITY"];
  }
}

function bindingErrors(plan: ContinuityAlphaCanaryPlan, suite: ContinuityAlphaCanarySuiteInput): string[] {
  const errors: string[] = [];
  const bindings = new Map(plan.targets.map((target) => [target.agent_id, target]));
  for (const run of suite.runs) {
    const target = run.scenario_id === "S14"
      ? plan.host_canaries.find((candidate) => candidate.runtime === run.host)
      : bindings.get(run.identity.agent_id);
    if (!target) {
      errors.push(`FAIL_RUN_AGENT_OUTSIDE_PLAN:${run.run_ref}`);
      continue;
    }
    if (target.agent_id !== run.identity.agent_id) errors.push(`FAIL_RUN_AGENT_BINDING:${run.run_ref}`);
    if (target.runtime !== run.host || run.identity.runtime !== target.runtime) {
      errors.push(`FAIL_RUN_RUNTIME_BINDING:${run.run_ref}`);
    }
    if (run.identity.project !== target.project) errors.push(`FAIL_RUN_PROJECT_BINDING:${run.run_ref}`);
    if (run.identity.workspace !== target.workspace_ref) errors.push(`FAIL_RUN_WORKSPACE_BINDING:${run.run_ref}`);
    if (run.ordinary_launch_command !== CONTINUITY_ALPHA_HOST_CONTRACT[target.runtime].command) {
      errors.push(`FAIL_RUN_ORDINARY_COMMAND:${run.run_ref}`);
    }
    if (run.native_start_surface !== CONTINUITY_ALPHA_HOST_CONTRACT[target.runtime].start_surface) {
      errors.push(`FAIL_RUN_NATIVE_START_SURFACE:${run.run_ref}`);
    }
    if (run.identity.binding_ref !== target.binding_ref) errors.push(`FAIL_RUN_BINDING_REF:${run.run_ref}`);
  }
  const suddenDeath = suite.runs.filter((run) => run.scenario_id === "S3");
  if (suddenDeath.length !== 1 || !["kusabi", "spec"].includes(suddenDeath[0]?.identity.agent_id ?? "")) {
    errors.push("FAIL_INITIAL_SUDDEN_DEATH_SCOPE");
  }
  return errors;
}

interface ResolvedGitHubObservationComment {
  id: number;
  html_url: string;
  body: string;
  created_at: string;
  updated_at: string;
  author: string;
}

function observationCommentId(ref: string): number | null {
  const match = ref.match(/^https:\/\/github\.com\/watchout\/agent-memory\/(?:issues|pull)\/[1-9]\d*#issuecomment-([1-9]\d*)$/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

function embeddedObservationReceipts(body: string): unknown[] {
  const pattern = /<!--\s*continuity-alpha-observation-receipt\/v1\s*-->\s*```json\s*([\s\S]*?)```/g;
  const receipts: unknown[] = [];
  for (const match of body.matchAll(pattern)) {
    try {
      receipts.push(JSON.parse(match[1]));
    } catch {
      receipts.push(null);
    }
  }
  return receipts;
}

async function resolveGitHubObservationComment(ref: string): Promise<ResolvedGitHubObservationComment | null> {
  const id = observationCommentId(ref);
  if (id === null) return null;
  try {
    const response = await fetch(`https://api.github.com/repos/watchout/agent-memory/issues/comments/${id}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "wasurezu-continuity-alpha-canary",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (!isRecord(value) || !isRecord(value.user)
      || value.id !== id
      || value.html_url !== ref
      || typeof value.body !== "string"
      || value.body.trim().length === 0
      || !isIsoInstant(value.created_at)
      || !isIsoInstant(value.updated_at)
      || !isText(value.user.login)) {
      return null;
    }
    return {
      id,
      html_url: value.html_url,
      body: value.body,
      created_at: value.created_at,
      updated_at: value.updated_at,
      author: value.user.login,
    };
  } catch {
    return null;
  }
}

async function observationReceiptErrors(plan: ContinuityAlphaCanaryPlan, suite: ContinuityAlphaCanarySuiteInput): Promise<string[]> {
  const errors: string[] = [];
  const captureIds = new Set<string>();
  const resolvedComments = new Map<string, Promise<ResolvedGitHubObservationComment | null>>();
  for (const run of suite.runs) {
    const receipt = run.observation_receipt;
    if (!receipt || typeof receipt !== "object") {
      errors.push(`FAIL_RUN_OBSERVATION_RECEIPT_MISSING:${run.run_ref}`);
      continue;
    }
    if (receipt.schema_version !== CONTINUITY_ALPHA_OBSERVATION_RECEIPT_VERSION
      || !isText(receipt.capture_id)
      || !isIsoInstant(receipt.captured_at)
      || !isText(receipt.observer_actor)) {
      errors.push(`FAIL_RUN_OBSERVATION_RECEIPT_CAPTURE:${run.run_ref}`);
    }
    if (captureIds.has(receipt.capture_id)) errors.push(`FAIL_DUPLICATE_OBSERVATION_CAPTURE_ID:${receipt.capture_id}`);
    captureIds.add(receipt.capture_id);
    const durableRefs = [
      receipt.receipt_ref,
      receipt.identity_receipt_ref,
      receipt.first_context_receipt_ref,
      receipt.action_receipt_ref,
      receipt.result_receipt_ref,
    ];
    if (!durableRefs.every(isDurableObservationRef)) errors.push(`FAIL_RUN_OBSERVATION_RECEIPT_REF:${run.run_ref}`);
    if (receipt.plan_id !== plan.plan_id
      || receipt.run_ref !== run.run_ref
      || receipt.exact_head !== plan.exact_subject.head
      || receipt.exact_tree !== plan.exact_subject.tree
      || receipt.agent_id !== run.identity.agent_id
      || receipt.runtime !== run.host
      || receipt.project !== run.identity.project
      || receipt.workspace !== run.identity.workspace
      || receipt.binding_ref !== run.identity.binding_ref
      || receipt.ordinary_launch_command !== run.ordinary_launch_command
      || receipt.native_start_surface !== run.native_start_surface) {
      errors.push(`FAIL_RUN_OBSERVATION_RECEIPT_BINDING:${run.run_ref}`);
    }
    if (!isDigest(receipt.evidence_sha256)
      || receipt.evidence_sha256 !== continuityAlphaObservedRunDigest(run)) {
      errors.push(`FAIL_RUN_OBSERVATION_RECEIPT_DIGEST:${run.run_ref}`);
    }
    if (isDurableObservationRef(receipt.receipt_ref)) {
      let resolution = resolvedComments.get(receipt.receipt_ref);
      if (!resolution) {
        resolution = resolveGitHubObservationComment(receipt.receipt_ref);
        resolvedComments.set(receipt.receipt_ref, resolution);
      }
      const comment = await resolution;
      const capturedAt = Date.parse(receipt.captured_at);
      const createdAt = comment ? Date.parse(comment.created_at) : Number.NaN;
      const receiptEmbedded = comment
        ? embeddedObservationReceipts(comment.body).some((candidate) => canonical(candidate) === canonical(receipt))
        : false;
      if (!comment
        || comment.author !== receipt.observer_actor
        || comment.created_at !== comment.updated_at
        || !Number.isFinite(capturedAt)
        || capturedAt > createdAt
        || createdAt - capturedAt > 3_600_000
        || !receiptEmbedded) {
        errors.push(`FAIL_RUN_OBSERVATION_RECEIPT_RESOLUTION:${run.run_ref}`);
      }
    }
  }
  return errors;
}

export async function verifyObservedContinuityAlphaCanary(
  plan: ContinuityAlphaCanaryPlan,
  suite: ContinuityAlphaCanarySuiteInput,
): Promise<ContinuityAlphaCanaryVerification> {
  const planDigest = continuityAlphaCanaryPlanDigest(plan);
  const integrityErrors = planIntegrityErrors(plan);
  if (plan.status !== "ready_for_operator" || !plan.evaluator.s15_passed || integrityErrors.length > 0) {
    const evaluation = evaluateContinuityAlphaSuite(suite);
    return {
      schema_version: CONTINUITY_ALPHA_CANARY_VERIFICATION_VERSION,
      plan_id: plan.plan_id,
      plan_digest: planDigest,
      status: "stopped",
      errors: [...new Set([
        ...(plan.status !== "ready_for_operator" || !plan.evaluator.s15_passed ? ["AUTO_FAIL_PLAN_NOT_READY"] : []),
        ...integrityErrors,
      ])],
      evaluation,
      exact_subject: { ...plan.exact_subject, dependency_refs: [...plan.exact_subject.dependency_refs] },
      operator_boundary_verified: false,
      target_binding_verified: false,
      receipt_provenance_verified: false,
      verified_receipt_refs: [],
      sudden_death_scope_verified: false,
      continuity_alpha_candidate: false,
      next_action: "fix_evaluator_before_operator_run",
    };
  }
  const receiptErrors = await observationReceiptErrors(plan, suite);
  const errors = [...bindingErrors(plan, suite), ...receiptErrors];
  if (suite.evidence_kind !== "observed_live_canary") errors.push("FAIL_OBSERVED_LIVE_EVIDENCE_REQUIRED");
  const evaluatorEffects = Object.fromEntries(
    Object.keys(CONTINUITY_ALPHA_ZERO_EFFECTS).map((key) => [
      key,
      suite.effects[key as keyof ContinuityAlphaEffectCounters],
    ]),
  ) as unknown as ContinuityAlphaEffectCounters;
  const evaluation = evaluateContinuityAlphaSuite({ ...suite, effects: evaluatorEffects });
  if (!evaluation.continuity_alpha_candidate) errors.push("FAIL_EVALUATOR_LIVE_CANDIDATE");
  const operatorBoundaryVerified = suite.evidence_kind === "observed_live_canary"
    && suite.p0_sequence.stop_on_first_failure
    && exactZeroCanaryEffects(suite.effects)
    && receiptErrors.length === 0
    && suite.runs.every((run) => run.fresh_process_started
      && run.startup_path_kind === "ordinary_native"
      && Object.values(run.effects).every((count) => count === 0));
  if (!operatorBoundaryVerified) errors.push("FAIL_OPERATOR_BOUNDARY");
  const targetBindingVerified = !errors.some((error) => error.startsWith("FAIL_RUN_") || error.includes("P0"));
  const receiptProvenanceVerified = receiptErrors.length === 0;
  const suddenDeathScopeVerified = !errors.includes("FAIL_INITIAL_SUDDEN_DEATH_SCOPE");
  const pass = errors.length === 0;
  return {
    schema_version: CONTINUITY_ALPHA_CANARY_VERIFICATION_VERSION,
    plan_id: plan.plan_id,
    plan_digest: planDigest,
    status: pass ? "pass" : "fail",
    errors: [...new Set(errors)],
    evaluation,
    exact_subject: { ...plan.exact_subject, dependency_refs: [...plan.exact_subject.dependency_refs] },
    operator_boundary_verified: operatorBoundaryVerified,
    target_binding_verified: targetBindingVerified,
    receipt_provenance_verified: receiptProvenanceVerified,
    verified_receipt_refs: receiptProvenanceVerified
      ? [...new Set(suite.runs.map((run) => run.observation_receipt.receipt_ref))]
      : [],
    sudden_death_scope_verified: suddenDeathScopeVerified,
    continuity_alpha_candidate: pass && evaluation.continuity_alpha_candidate,
    next_action: pass ? "none" : "fix_canary_evidence",
  };
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const planInputPath = option(args, "--plan-input-json");
  const planPath = option(args, "--plan-json");
  const suitePath = option(args, "--suite-json");
  if (planInputPath && !planPath && !suitePath) {
    const plan = buildContinuityAlphaCanaryPlan(readJson(planInputPath) as ContinuityAlphaCanaryPlanInput);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    if (plan.status !== "ready_for_operator") process.exitCode = 2;
    return;
  }
  if (planPath && suitePath && !planInputPath) {
    const result = await verifyObservedContinuityAlphaCanary(
      readJson(planPath) as ContinuityAlphaCanaryPlan,
      readJson(suitePath) as ContinuityAlphaCanarySuiteInput,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "pass") process.exitCode = 2;
    return;
  }
  throw new Error("use --plan-input-json FILE or --plan-json FILE --suite-json FILE");
}

let invokedPath = "";
try {
  invokedPath = process.argv[1] ? realpathSync(resolve(process.argv[1])) : "";
} catch {
  invokedPath = "";
}
if (invokedPath === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`[continuity-alpha-canary] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
