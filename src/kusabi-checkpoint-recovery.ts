import { createHash } from "node:crypto";
import type { SelectedRestartPack, Store } from "./stores/types.js";
import { redactText } from "./redact.js";

export const CONTINUATION_CHECKPOINT_SCHEMA = "continuation-equivalent-state/v1" as const;
export const CONTINUATION_RECOVERY_PACK_SCHEMA = "kusabi-continuation-recovery-pack/v1" as const;

export const CONTINUATION_REPLAY_POLICY = Object.freeze({
  completed: "do_not_replay",
  not_started: "operator_or_next_action_may_start",
  unknown: "never_auto_replay",
} as const);

export interface ContinuationEffectCounters {
  duplicate_raw_events: number;
  automatic_replay_count: number;
  duplicate_launch_effect_count: number;
  automatic_effect_count: number;
  db_schema_mutation_count: number;
  kusabi_queue_mutation_count: number;
  kusabi_runtime_restart_count: number;
  provider_dispatch_count: number;
  aun_mutation_count: number;
  external_effect_count: number;
}

export const CONTINUATION_ZERO_COUNTERS: Readonly<ContinuationEffectCounters> = Object.freeze({
  duplicate_raw_events: 0,
  automatic_replay_count: 0,
  duplicate_launch_effect_count: 0,
  automatic_effect_count: 0,
  db_schema_mutation_count: 0,
  kusabi_queue_mutation_count: 0,
  kusabi_runtime_restart_count: 0,
  provider_dispatch_count: 0,
  aun_mutation_count: 0,
  external_effect_count: 0,
});

export interface ContinuationIdentity {
  agent_id: string;
  memory_project: string;
  workspace_ref: string;
  workspace_path_hash: string;
  host: string;
  adapter: string;
  lifecycle_owner: string;
  runtime_commit_sha: string;
  runtime_artifact_digest: string;
  config_digest: string;
}

export interface ContinuationTaskInput {
  id: string;
  status: "in_progress" | "blocked" | "completed" | "expired";
  task: string;
  progress?: string;
  next_steps?: string;
  files_modified: string[];
  created_at?: string;
  updated_at?: string;
}

export interface ContinuationDecisionInput {
  id: string;
  status: "active" | "superseded" | "revoked";
  decision: string;
  created_at: string;
}

export interface ContinuationKnowledgeInput {
  id: string;
  status: "active" | "merged" | "archived" | "superseded";
  updated_at: string;
}

export interface ContinuationVisibleEventInput {
  id: string;
  content_digest: string;
  occurred_at: string;
}

export interface ContinuationEffectInput {
  effect_id: string;
  status: "completed" | "not_started" | "unknown";
  source_ref: string;
}

export interface ContinuationCheckpointInput {
  identity: ContinuationIdentity;
  tasks: ContinuationTaskInput[];
  decisions: ContinuationDecisionInput[];
  knowledge: ContinuationKnowledgeInput[];
  artifact_refs: string[];
  visible_events: ContinuationVisibleEventInput[];
  repo: {
    repository: string;
    branch: string;
    head_sha: string;
    dirty_paths: string[];
    diff_material: string;
  };
  effects: ContinuationEffectInput[];
  recovery: {
    prior_session_id: string;
    saved_source_cursor?: string;
    supported_source_backlog_after_sync: number;
    duplicate_raw_events: number;
    confidence: number;
    missing_context: string[];
    pack_content_digest: string;
  };
  suite: {
    aun_supervised: boolean;
    queue_refs: string[];
    mutation_allowed: boolean;
  };
}

export interface ContinuationCheckpoint {
  schema_version: typeof CONTINUATION_CHECKPOINT_SCHEMA;
  identity: ContinuationIdentity;
  work: {
    objective: string;
    active_task_ids: string[];
    next_actions: string[];
    blockers: string[];
    decisions: Array<{ id: string; summary: string; summary_digest: string }>;
    knowledge_refs: string[];
    artifact_refs: string[];
    recent_visible_event_ids: string[];
    recent_visible_content_digests: string[];
    suppression_reasons: Array<{ id: string; reason: string }>;
  };
  repo: {
    repository: string;
    branch: string;
    head_sha: string;
    dirty_paths: string[];
    diff_digest: string;
  };
  effects: {
    pending: ContinuationEffectInput[];
    replay_policy: typeof CONTINUATION_REPLAY_POLICY;
  };
  recovery: {
    prior_session_id: string;
    checkpoint_id: string;
    pack_id: string;
    source_cursor_before: string;
    source_cursor: string;
    source_event_ids: string[];
    supported_source_backlog_after_sync: number;
    duplicate_raw_events: number;
    confidence: number;
    missing_context: string[];
  };
  suite: {
    aun_supervised: boolean;
    queue_refs: string[];
    mutation_allowed: boolean;
  };
}

export interface ContinuationCheckpointVerification {
  ok: boolean;
  status: "pass" | "blocked";
  errors: string[];
  mismatched_fields: string[];
  required_manifest_field_match_rate: number;
  supported_source_backlog_after_sync: number;
  dirty_path_set_match_rate: number;
  diff_digest_match: boolean;
  source_refs_nonempty: boolean;
  operator_warnings: string[];
  counters: Readonly<ContinuationEffectCounters>;
  checkpoint_digest: string;
}

export interface ContinuationRecoveryPack {
  schema_version: typeof CONTINUATION_RECOVERY_PACK_SCHEMA;
  checkpoint: ContinuationCheckpoint;
  checkpoint_digest: string;
  payload: string;
  payload_sha256: string;
}

export interface BuiltContinuationRecoveryPack {
  pack: ContinuationRecoveryPack;
  canonical_json: string;
  metadata: Record<string, unknown>;
}

export interface ConsumeContinuationResult {
  outcome: "full" | "blocked";
  continuity_pass_claimed: boolean;
  payload?: string;
  checkpoint?: ContinuationCheckpoint;
  checkpoint_digest?: string;
  error?: string;
  counters: Readonly<ContinuationEffectCounters>;
}

const REQUIRED_MANIFEST_PATHS = [
  "identity.agent_id",
  "identity.memory_project",
  "identity.workspace_ref",
  "identity.workspace_path_hash",
  "identity.host",
  "identity.adapter",
  "identity.lifecycle_owner",
  "identity.runtime_commit_sha",
  "identity.runtime_artifact_digest",
  "identity.config_digest",
  "work.objective",
  "work.active_task_ids",
  "work.next_actions",
  "work.blockers",
  "work.decisions",
  "work.knowledge_refs",
  "work.artifact_refs",
  "work.recent_visible_event_ids",
  "work.recent_visible_content_digests",
  "repo.repository",
  "repo.branch",
  "repo.head_sha",
  "repo.dirty_paths",
  "repo.diff_digest",
  "effects.pending",
  "effects.replay_policy",
  "recovery.prior_session_id",
  "recovery.checkpoint_id",
  "recovery.pack_id",
  "recovery.source_cursor",
  "recovery.source_event_ids",
  "recovery.confidence",
  "recovery.missing_context",
  "suite.aun_supervised",
  "suite.queue_refs",
  "suite.mutation_allowed",
] as const;

const FORBIDDEN_TEXT = [
  /private[_ -]?reasoning/i,
  /chain[_ -]?of[_ -]?thought/i,
  /base[_ -]?(?:or[_ -]?)?developer[_ -]?instructions?/i,
  /(?:sk|gh[op])-[-_a-z0-9]{12,}/i,
  /\/(?:Users|home)\/[^/\s]+\//,
];

export function buildContinuationCheckpoint(input: ContinuationCheckpointInput): ContinuationCheckpoint {
  const activeTasks = newestFirst(input.tasks.filter((item) => item.status === "in_progress"));
  const blockedTasks = newestFirst(input.tasks.filter((item) => item.status === "blocked"));
  const currentDecisions = [...input.decisions]
    .filter((item) => item.status === "active")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const currentKnowledge = [...input.knowledge]
    .filter((item) => item.status === "active")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const visibleEvents = uniqueById(input.visible_events)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const sourceCursor = visibleEvents[0]?.occurred_at ?? requireCanonicalString(
    input.recovery.saved_source_cursor ?? "missing:source_cursor",
    "recovery.saved_source_cursor",
  );

  const checkpoint: ContinuationCheckpoint = {
    schema_version: CONTINUATION_CHECKPOINT_SCHEMA,
    identity: normalizeIdentity(input.identity),
    work: {
      objective: sanitizeVisibleText(activeTasks[0]?.task ?? blockedTasks[0]?.task ?? "missing:active_task"),
      active_task_ids: activeTasks.map((item) => requireCanonicalString(item.id, "task.id")),
      next_actions: uniqueStrings(
        [...activeTasks, ...blockedTasks]
          .map((item) => item.next_steps)
          .filter((item): item is string => Boolean(item))
          .map(sanitizeVisibleText),
      ),
      blockers: blockedTasks.map((item) =>
        sanitizeVisibleText([item.task, item.progress].filter(Boolean).join(": ")),
      ),
      decisions: currentDecisions.map((item) => {
        const summary = sanitizeVisibleText(item.decision);
        return { id: requireCanonicalString(item.id, "decision.id"), summary, summary_digest: sha256(summary) };
      }),
      knowledge_refs: currentKnowledge.map((item) => `knowledge:${safeReference(item.id)}`),
      artifact_refs: uniqueStrings(input.artifact_refs.map(safeReference)),
      recent_visible_event_ids: visibleEvents.map((item) => requireCanonicalString(item.id, "event.id")),
      recent_visible_content_digests: visibleEvents.map((item) => normalizeDigest(item.content_digest, "event.content_digest")),
      suppression_reasons: [
        ...input.tasks
          .filter((item) => item.status === "completed" || item.status === "expired")
          .map((item) => ({ id: safeReference(item.id), reason: `task_status:${item.status}` })),
        ...input.decisions
          .filter((item) => item.status !== "active")
          .map((item) => ({ id: safeReference(item.id), reason: `decision_status:${item.status}` })),
        ...input.knowledge
          .filter((item) => item.status !== "active")
          .map((item) => ({ id: safeReference(item.id), reason: `knowledge_status:${item.status}` })),
      ].sort((a, b) => a.id.localeCompare(b.id)),
    },
    repo: {
      repository: safeReference(input.repo.repository),
      branch: safeReference(input.repo.branch),
      head_sha: requireHex(input.repo.head_sha, 40, "repo.head_sha"),
      dirty_paths: uniqueStrings(input.repo.dirty_paths.map(safePath)).sort(),
      diff_digest: sha256(input.repo.diff_material),
    },
    effects: {
      pending: [...input.effects]
        .map((item) => ({
          effect_id: safeReference(item.effect_id),
          status: item.status,
          source_ref: safeReference(item.source_ref),
        }))
        .sort((a, b) => a.effect_id.localeCompare(b.effect_id)),
      replay_policy: CONTINUATION_REPLAY_POLICY,
    },
    recovery: {
      prior_session_id: safeReference(input.recovery.prior_session_id),
      checkpoint_id: "checkpoint:pending",
      pack_id: "continuation_pack:pending",
      source_cursor_before: requireCanonicalString(
        input.recovery.saved_source_cursor ?? "missing:source_cursor",
        "recovery.saved_source_cursor",
      ),
      source_cursor: requireCanonicalString(sourceCursor, "recovery.source_cursor"),
      source_event_ids: visibleEvents.map((item) => requireCanonicalString(item.id, "event.id")),
      supported_source_backlog_after_sync: requireNonNegativeInteger(
        input.recovery.supported_source_backlog_after_sync,
        "recovery.supported_source_backlog_after_sync",
      ),
      duplicate_raw_events: requireNonNegativeInteger(
        input.recovery.duplicate_raw_events,
        "recovery.duplicate_raw_events",
      ),
      confidence: normalizeConfidence(input.recovery.confidence),
      missing_context: uniqueStrings(input.recovery.missing_context.map(safeReference)),
    },
    suite: {
      aun_supervised: input.suite.aun_supervised,
      queue_refs: uniqueStrings(input.suite.queue_refs.map(safeReference)),
      mutation_allowed: input.suite.mutation_allowed,
    },
  };

  checkpoint.recovery.checkpoint_id = expectedCheckpointId(checkpoint);
  checkpoint.recovery.pack_id = `continuation_pack:${sha256(
    `${checkpoint.recovery.checkpoint_id}:${normalizeDigest(input.recovery.pack_content_digest, "recovery.pack_content_digest")}`,
  )}`;
  return checkpoint;
}

export function canonicalCheckpointDigest(checkpoint: ContinuationCheckpoint): string {
  return sha256(canonicalJson(checkpoint));
}

export function verifyContinuationCheckpoint(
  checkpoint: ContinuationCheckpoint,
  options: {
    expected_digest?: string;
    expected_dirty_paths?: string[];
    expected_diff_digest?: string;
  } = {},
): ContinuationCheckpointVerification {
  if (!hasCheckpointShape(checkpoint)) {
    return {
      ok: false,
      status: "blocked",
      errors: ["checkpoint_shape_invalid"],
      mismatched_fields: [],
      required_manifest_field_match_rate: 0,
      supported_source_backlog_after_sync: 0,
      dirty_path_set_match_rate: 0,
      diff_digest_match: false,
      source_refs_nonempty: false,
      operator_warnings: [],
      counters: CONTINUATION_ZERO_COUNTERS,
      checkpoint_digest: sha256("invalid-checkpoint-shape"),
    };
  }
  const errors: string[] = [];
  const mismatchedFields: string[] = [];
  const presentCount = REQUIRED_MANIFEST_PATHS.filter((path) => getPath(checkpoint, path) !== undefined).length;
  const matchRate = presentCount / REQUIRED_MANIFEST_PATHS.length;
  if (matchRate !== 1) errors.push("required_manifest_fields_incomplete");

  validateDigestField(checkpoint.identity.workspace_path_hash, "identity.workspace_path_hash", errors);
  validateDigestField(checkpoint.identity.runtime_artifact_digest, "identity.runtime_artifact_digest", errors);
  validateDigestField(checkpoint.identity.config_digest, "identity.config_digest", errors);
  if (!/^[0-9a-f]{40}$/.test(checkpoint.identity.runtime_commit_sha)) errors.push("identity.runtime_commit_sha_invalid");
  if (!/^[0-9a-f]{40}$/.test(checkpoint.repo.head_sha)) errors.push("repo.head_sha_invalid");
  validateDigestField(checkpoint.repo.diff_digest, "repo.diff_digest", errors);

  if (checkpoint.recovery.checkpoint_id !== expectedCheckpointId(checkpoint)) {
    errors.push("checkpoint_id_mismatch");
    mismatchedFields.push("recovery.checkpoint_id");
  }
  if (!/^continuation_pack:[0-9a-f]{64}$/.test(checkpoint.recovery.pack_id)) {
    errors.push("pack_id_invalid");
    mismatchedFields.push("recovery.pack_id");
  }
  if (!sameUniqueOrder(checkpoint.work.recent_visible_event_ids, checkpoint.recovery.source_event_ids)) {
    errors.push("source_event_projection_mismatch");
    mismatchedFields.push("recovery.source_event_ids");
  }
  if (checkpoint.work.recent_visible_event_ids.length !== checkpoint.work.recent_visible_content_digests.length) {
    errors.push("visible_event_digest_count_mismatch");
  }
  if (new Set(checkpoint.recovery.source_event_ids).size !== checkpoint.recovery.source_event_ids.length) {
    errors.push("duplicate_source_event_ids");
  }
  const sourceCursorBefore = canonicalTimestampMillis(checkpoint.recovery.source_cursor_before);
  const sourceCursor = canonicalTimestampMillis(checkpoint.recovery.source_cursor);
  if (sourceCursorBefore === null) {
    errors.push("source_cursor_before_invalid");
    mismatchedFields.push("recovery.source_cursor_before");
  }
  if (sourceCursor === null) {
    errors.push("source_cursor_invalid");
    mismatchedFields.push("recovery.source_cursor");
  }
  if (sourceCursorBefore !== null && sourceCursor !== null && sourceCursor < sourceCursorBefore) {
    errors.push("source_cursor_regressed");
    mismatchedFields.push("recovery.source_cursor");
  }
  if (checkpoint.recovery.supported_source_backlog_after_sync !== 0) {
    errors.push("supported_source_backlog_remaining");
  }
  if (checkpoint.recovery.duplicate_raw_events !== 0) {
    errors.push("duplicate_raw_events_present");
  }
  if (checkpoint.effects.replay_policy.completed !== CONTINUATION_REPLAY_POLICY.completed ||
      checkpoint.effects.replay_policy.not_started !== CONTINUATION_REPLAY_POLICY.not_started ||
      checkpoint.effects.replay_policy.unknown !== CONTINUATION_REPLAY_POLICY.unknown) {
    errors.push("effect_replay_policy_mismatch");
  }
  if (checkpoint.suite.mutation_allowed) errors.push("suite_mutation_not_allowed");

  const serialized = canonicalJson(checkpoint);
  if (FORBIDDEN_TEXT.some((pattern) => pattern.test(serialized))) errors.push("forbidden_content_present");
  const checkpointDigest = sha256(serialized);
  if (options.expected_digest && checkpointDigest !== normalizeDigest(options.expected_digest, "expected_digest")) {
    errors.push("checkpoint_digest_mismatch");
    mismatchedFields.push("checkpoint_digest");
  }

  const sourceRefsNonempty = [
    ...checkpoint.work.active_task_ids,
    ...checkpoint.work.decisions.map((item) => item.id),
    ...checkpoint.work.knowledge_refs,
    ...checkpoint.work.artifact_refs,
    ...checkpoint.recovery.source_event_ids,
  ].length > 0;
  if (!sourceRefsNonempty) errors.push("source_refs_empty");

  const operatorWarnings = checkpoint.effects.pending
    .filter((item) => item.status === "unknown")
    .map((item) => `unknown_effect:${item.effect_id}`);
  const expectedDirtyPaths = options.expected_dirty_paths
    ? uniqueStrings(options.expected_dirty_paths.map(safePath)).sort()
    : checkpoint.repo.dirty_paths;
  const dirtyPathMatch = sameUniqueOrder(checkpoint.repo.dirty_paths, expectedDirtyPaths);
  if (!dirtyPathMatch) {
    errors.push("dirty_path_set_mismatch");
    mismatchedFields.push("repo.dirty_paths");
  }
  const diffDigestMatch = options.expected_diff_digest
    ? checkpoint.repo.diff_digest === normalizeDigest(options.expected_diff_digest, "expected_diff_digest")
    : true;
  if (!diffDigestMatch) {
    errors.push("diff_digest_mismatch");
    mismatchedFields.push("repo.diff_digest");
  }

  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? "pass" : "blocked",
    errors,
    mismatched_fields: mismatchedFields,
    required_manifest_field_match_rate: Number(matchRate.toFixed(6)),
    supported_source_backlog_after_sync: checkpoint.recovery.supported_source_backlog_after_sync,
    dirty_path_set_match_rate: dirtyPathMatch ? 1 : 0,
    diff_digest_match: diffDigestMatch,
    source_refs_nonempty: sourceRefsNonempty,
    operator_warnings: operatorWarnings,
    counters: {
      ...CONTINUATION_ZERO_COUNTERS,
      duplicate_raw_events: checkpoint.recovery.duplicate_raw_events,
    },
    checkpoint_digest: checkpointDigest,
  };
}

export function buildContinuationRecoveryPack(
  checkpoint: ContinuationCheckpoint,
  payload: string,
): BuiltContinuationRecoveryPack {
  const payloadDigest = sha256(payload);
  const boundCheckpoint = JSON.parse(JSON.stringify(checkpoint)) as ContinuationCheckpoint;
  boundCheckpoint.recovery.pack_id = `continuation_pack:${sha256(
    `${boundCheckpoint.recovery.checkpoint_id}:${payloadDigest}`,
  )}`;
  const verification = verifyContinuationCheckpoint(boundCheckpoint);
  if (!verification.ok) throw new Error(`CONTINUATION_CHECKPOINT_INVALID:${verification.errors.join(",")}`);
  const pack: ContinuationRecoveryPack = {
    schema_version: CONTINUATION_RECOVERY_PACK_SCHEMA,
    checkpoint: boundCheckpoint,
    checkpoint_digest: verification.checkpoint_digest,
    payload,
    payload_sha256: payloadDigest,
  };
  const canonical = canonicalJson(pack);
  return {
    pack,
    canonical_json: canonical,
    metadata: {
      continuation_schema_ref: CONTINUATION_CHECKPOINT_SCHEMA,
      continuation_pack_schema: CONTINUATION_RECOVERY_PACK_SCHEMA,
      checkpoint_id: boundCheckpoint.recovery.checkpoint_id,
      continuation_pack_id: boundCheckpoint.recovery.pack_id,
      checkpoint_digest: verification.checkpoint_digest,
      continuation_payload_sha256: pack.payload_sha256,
      continuation_wrapper_sha256: sha256(canonical),
      source_cursor: boundCheckpoint.recovery.source_cursor,
      source_cursor_before: boundCheckpoint.recovery.source_cursor_before,
      source_event_ids: boundCheckpoint.recovery.source_event_ids,
      supported_source_backlog_after_sync: boundCheckpoint.recovery.supported_source_backlog_after_sync,
      duplicate_raw_events: boundCheckpoint.recovery.duplicate_raw_events,
    },
  };
}

export function verifyContinuationRecoveryPack(
  content: string,
  metadata: Record<string, unknown> = {},
): { ok: boolean; errors: string[]; pack?: ContinuationRecoveryPack; verification?: ContinuationCheckpointVerification } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, errors: ["continuation_pack_json_invalid"] };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, errors: ["continuation_pack_shape_invalid"] };
  const pack = parsed as ContinuationRecoveryPack;
  const errors: string[] = [];
  if (canonicalJson(pack) !== content) errors.push("continuation_pack_not_canonical");
  if (!sameUniqueOrder(Object.keys(pack).sort(), [
    "checkpoint",
    "checkpoint_digest",
    "payload",
    "payload_sha256",
    "schema_version",
  ])) errors.push("continuation_pack_additional_or_missing_fields");
  if (pack.schema_version !== CONTINUATION_RECOVERY_PACK_SCHEMA) errors.push("continuation_pack_schema_mismatch");
  if (typeof pack.payload !== "string" || sha256(pack.payload ?? "") !== pack.payload_sha256) {
    errors.push("continuation_payload_digest_mismatch");
  }
  const verification = verifyContinuationCheckpoint(pack.checkpoint, { expected_digest: pack.checkpoint_digest });
  errors.push(...verification.errors);
  if (verification.ok && pack.checkpoint.recovery.pack_id !==
      `continuation_pack:${sha256(`${pack.checkpoint.recovery.checkpoint_id}:${pack.payload_sha256}`)}`) {
    errors.push("continuation_pack_id_mismatch");
  }
  const metadataChecks: Array<[string, unknown, unknown]> = [
    ["checkpoint_id", metadata.checkpoint_id, pack.checkpoint?.recovery?.checkpoint_id],
    ["continuation_pack_id", metadata.continuation_pack_id, pack.checkpoint?.recovery?.pack_id],
    ["checkpoint_digest", metadata.checkpoint_digest, pack.checkpoint_digest],
    ["continuation_payload_sha256", metadata.continuation_payload_sha256, pack.payload_sha256],
  ];
  for (const [field, observed, wanted] of metadataChecks) {
    if (observed !== wanted) errors.push(`metadata_${field}_mismatch`);
  }
  if (metadata.continuation_schema_ref !== CONTINUATION_CHECKPOINT_SCHEMA) {
    errors.push("metadata_continuation_schema_ref_mismatch");
  }
  if (metadata.continuation_pack_schema !== CONTINUATION_RECOVERY_PACK_SCHEMA) {
    errors.push("metadata_continuation_pack_schema_mismatch");
  }
  if (metadata.continuation_wrapper_sha256 !== sha256(content)) {
    errors.push("metadata_continuation_wrapper_sha256_mismatch");
  }
  return { ok: errors.length === 0, errors, pack, verification };
}

export function isContinuationRecoveryPack(
  content: string,
  metadata: Record<string, unknown> = {},
): boolean {
  const continuationMetadataFields = [
    "continuation_schema_ref",
    "continuation_pack_schema",
    "checkpoint_id",
    "continuation_pack_id",
    "checkpoint_digest",
    "continuation_payload_sha256",
    "continuation_wrapper_sha256",
    "source_cursor",
    "source_cursor_before",
    "source_event_ids",
  ];
  if (continuationMetadataFields.some((field) => Object.hasOwn(metadata, field))) return true;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) return false;
    if (parsed.schema_version === CONTINUATION_RECOVERY_PACK_SCHEMA) return true;
    if (typeof parsed.schema_version === "string" && parsed.schema_version.startsWith("kusabi-continuation-recovery-pack/")) {
      return true;
    }
    return ["checkpoint", "checkpoint_digest", "payload_sha256"]
      .some((field) => Object.hasOwn(parsed, field));
  } catch {
    return false;
  }
}

export async function consumeVerifiedContinuationPack(
  store: Pick<Store, "consumeSelectedRestartPack"> | {
    consumeSelectedRestartPack: (input: { agent_id: string; project?: string; pack_ref: string }) => Promise<SelectedRestartPack | null>;
  },
  input: { agent_id: string; project?: string; pack_ref: string },
): Promise<ConsumeContinuationResult> {
  let selected: SelectedRestartPack | null;
  try {
    selected = await store.consumeSelectedRestartPack(input);
  } catch {
    return blockedConsume("checkpoint_store_unavailable");
  }
  if (!selected) return blockedConsume("selected_pack_missing_or_consumed");
  const verified = verifyContinuationRecoveryPack(selected.content, selected.metadata);
  if (!verified.ok || !verified.pack) return blockedConsume(`continuation_pack_invalid:${verified.errors.join(",")}`);
  return {
    outcome: "full",
    continuity_pass_claimed: true,
    payload: verified.pack.payload,
    checkpoint: verified.pack.checkpoint,
    checkpoint_digest: verified.pack.checkpoint_digest,
    counters: CONTINUATION_ZERO_COUNTERS,
  };
}

function blockedConsume(error: string): ConsumeContinuationResult {
  return {
    outcome: "blocked",
    continuity_pass_claimed: false,
    error,
    counters: CONTINUATION_ZERO_COUNTERS,
  };
}

function hasCheckpointShape(value: unknown): value is ContinuationCheckpoint {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return isRecord(record.identity) && isRecord(record.work) && isRecord(record.repo) &&
    isRecord(record.effects) && Array.isArray(record.effects.pending) &&
    isRecord(record.effects.replay_policy) && isRecord(record.recovery) &&
    isRecord(record.suite) && Array.isArray(record.work.recent_visible_event_ids) &&
    Array.isArray(record.work.recent_visible_content_digests) &&
    Array.isArray(record.recovery.source_event_ids);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function expectedCheckpointId(checkpoint: ContinuationCheckpoint): string {
  const basis: ContinuationCheckpoint = JSON.parse(JSON.stringify(checkpoint)) as ContinuationCheckpoint;
  basis.recovery.checkpoint_id = "checkpoint:pending";
  basis.recovery.pack_id = "continuation_pack:pending";
  return `checkpoint:${sha256(canonicalJson(basis))}`;
}

function normalizeIdentity(identity: ContinuationIdentity): ContinuationIdentity {
  return {
    agent_id: safeReference(identity.agent_id),
    memory_project: safeReference(identity.memory_project),
    workspace_ref: safeReference(identity.workspace_ref),
    workspace_path_hash: normalizeDigest(identity.workspace_path_hash, "identity.workspace_path_hash"),
    host: safeReference(identity.host),
    adapter: safeReference(identity.adapter),
    lifecycle_owner: safeReference(identity.lifecycle_owner),
    runtime_commit_sha: requireHex(identity.runtime_commit_sha, 40, "identity.runtime_commit_sha"),
    runtime_artifact_digest: normalizeDigest(identity.runtime_artifact_digest, "identity.runtime_artifact_digest"),
    config_digest: normalizeDigest(identity.config_digest, "identity.config_digest"),
  };
}

function newestFirst<T extends { created_at?: string; updated_at?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? ""),
  );
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)];
}

function sanitizeVisibleText(value: string): string {
  const redacted = redactText(requireCanonicalString(value, "visible_text")).text;
  const scrubbed = redacted
    .split(/\r?\n/)
    .filter((line) => !FORBIDDEN_TEXT.slice(0, 3).some((pattern) => pattern.test(line)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return scrubbed || "[REDACTED]";
}

function safeReference(value: string): string {
  const canonical = requireCanonicalString(value, "reference");
  if (/\/(?:Users|home)\/[^/\s]+\//.test(canonical)) return `ref_sha256:${sha256(canonical)}`;
  return sanitizeVisibleText(canonical);
}

function safePath(value: string): string {
  const canonical = requireCanonicalString(value, "path").replace(/^\.\//, "");
  if (canonical.startsWith("/") || canonical.split("/").includes("..")) return `path_sha256:${sha256(canonical)}`;
  return canonical;
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("recovery.confidence must be 0..1");
  return Number(value.toFixed(6));
}

function requireNonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
  return value;
}

function normalizeDigest(value: string, field: string): string {
  const normalized = value.startsWith("sha256:") ? value.slice(7) : value;
  return requireHex(normalized, 64, field);
}

function requireHex(value: string, length: number, field: string): string {
  const normalized = requireCanonicalString(value, field).toLowerCase();
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(normalized)) {
    throw new Error(`${field} must be ${length} hexadecimal characters`);
  }
  return normalized;
}

function requireCanonicalString(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.includes("\0")) {
    throw new Error(`${field} must be a non-empty canonical string`);
  }
  return value;
}

function canonicalTimestampMillis(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return null;
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== value) return null;
  return millis;
}

function validateDigestField(value: string, field: string, errors: string[]): void {
  if (!/^[0-9a-f]{64}$/.test(value)) errors.push(`${field}_invalid`);
}

function sameUniqueOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonical(value));
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortCanonical(record[key])]));
  }
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))) return value;
  throw new Error("Continuation checkpoint contains an unsupported canonical value");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
