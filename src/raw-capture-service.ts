/**
 * OBS-05 tracked raw-capture service.
 *
 * This module is script-controlled and makes zero LLM calls. The frozen
 * DB-backed fleet manifest is the only target authority; installed registry
 * rows are observations reconciled bidirectionally against it.
 */
import { createHash } from "crypto";
import { isAbsolute, relative, resolve, sep } from "path";
import type { Store } from "./stores/types.js";
import {
  assertKusabiFleetManifest,
  type KusabiFleetManifest,
} from "./kusabi-fleet-status.js";
import {
  kusabiFleetInventoryBindingKey,
  type KusabiFleetInventoryBinding,
} from "./kusabi-fleet-rollout.js";
import { ingestCodexConversationEvents } from "./codex-conversation-ingest.js";
import { ingestClaudeConversationEvents } from "./claude-conversation-ingest.js";
import { ingestGeminiConversationEvents, type GeminiPrivacyCounters } from "./gemini-conversation-ingest.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
export const FROZEN_AUTHORITATIVE_TARGET_COUNT = 35;
export const FROZEN_INSTALLED_REGISTRY_COUNT = 47;
export const FROZEN_UNMATCHED_REGISTRY_COUNT = 24;
export const FROZEN_MISSING_MANIFEST_BINDING_COUNT = 11;

export type RawCaptureHost = "codex" | "claude_code" | "gemini_cli";

export interface InstalledCaptureRegistryRow {
  registry_row_sha256: string;
  matched_manifest_binding_keys: string[];
}

export interface RawCaptureReconciliation {
  authoritative_target_count: number;
  unique_authoritative_binding_key_count: number;
  actual_covered_manifest_binding_count: number;
  registry_manifest_exact_equality: boolean;
  installed_registry_observation_count: number;
  unmatched_registry_row_sha256: string[];
  missing_manifest_binding_keys: string[];
  unmatched_registry_row_count: number;
  unmatched_registry_row_unique_count: number;
  missing_manifest_binding_count: number;
  missing_manifest_binding_unique_count: number;
  arithmetic_net_difference: number;
  arithmetic_net_difference_is_enumerable_row_set: false;
}

export interface RawCaptureRuntimeCandidate {
  commit: string;
  tree: string;
  built_artifact_sha256: string;
  build_command: string;
  artifact_path_relative_to_repository: string;
  runtime_source_kind: "immutable_release_artifact";
}

export interface RawCaptureSourceResult {
  source: RawCaptureHost;
  files_scanned: number;
  records_seen: number;
  events_saved: number;
  events_duplicate: number;
  events_skipped: number;
  coverage_status: "clean" | "degraded" | "failed";
  privacy?: GeminiPrivacyCounters;
}

export interface RawCaptureServiceReport {
  schema_version: "kusabi-raw-capture-service/v1";
  run_id: string;
  generated_at: string;
  manifest_id: string;
  target_key: string;
  agent_id: string;
  project: string;
  host_runtime: RawCaptureHost;
  store_backend: Store["backend"];
  deterministic_controller: "script";
  llm_call_count: 0;
  store_capability: "saveRawEvent";
  source_results: RawCaptureSourceResult[];
  reconciliation: RawCaptureReconciliation;
  runtime_candidate: RawCaptureRuntimeCandidate;
  production_effect_count: 0;
}

export interface RunRawCaptureServiceInput {
  store: Store;
  manifest: KusabiFleetManifest;
  target_key: string;
  registry_rows: InstalledCaptureRegistryRow[];
  source_roots: Record<RawCaptureHost, string>;
  runtime_candidate: RawCaptureRuntimeCandidate;
  sources?: RawCaptureHost[];
  since?: string;
  max_files?: number;
  run_id?: string;
  generated_at?: string;
}

export function authoritativeManifestBindingKeys(manifest: KusabiFleetManifest): string[] {
  assertKusabiFleetManifest(manifest);
  if (manifest.targets.length !== FROZEN_AUTHORITATIVE_TARGET_COUNT) {
    throw new Error("KUSABI_RAW_CAPTURE_AUTHORITATIVE_TARGET_COUNT_MISMATCH");
  }
  const keys = manifest.targets.map((target) => kusabiFleetInventoryBindingKey({
    canonical_agent_id: target.identity.agent_id,
    project: target.identity.project,
    host_runtime: target.identity.host_runtime,
    workspace_sha256: target.identity.workspace_sha256,
    binding_source_ref_sha256: target.expected.configuration.binding_source_ref_sha256,
  } satisfies Pick<KusabiFleetInventoryBinding,
    "canonical_agent_id" | "project" | "host_runtime" | "workspace_sha256" | "binding_source_ref_sha256">));
  if (new Set(keys).size !== FROZEN_AUTHORITATIVE_TARGET_COUNT) {
    throw new Error("KUSABI_RAW_CAPTURE_AUTHORITATIVE_BINDING_DUPLICATE");
  }
  return keys.sort();
}

export function reconcileRawCaptureRegistry(
  manifest: KusabiFleetManifest,
  registryRows: InstalledCaptureRegistryRow[],
): RawCaptureReconciliation {
  const authoritativeKeys = authoritativeManifestBindingKeys(manifest);
  const authoritative = new Set(authoritativeKeys);
  const registryHashes = registryRows.map((row) => row.registry_row_sha256);
  if (registryRows.length !== FROZEN_INSTALLED_REGISTRY_COUNT) {
    throw new Error("KUSABI_RAW_CAPTURE_INSTALLED_REGISTRY_COUNT_MISMATCH");
  }
  if (registryHashes.some((hash) => !SHA256_PATTERN.test(hash)) || new Set(registryHashes).size !== registryRows.length) {
    throw new Error("KUSABI_RAW_CAPTURE_REGISTRY_ROW_HASH_INVALID_OR_DUPLICATE");
  }
  const covered = new Set<string>();
  const unmatched: string[] = [];
  for (const row of registryRows) {
    if (new Set(row.matched_manifest_binding_keys).size !== row.matched_manifest_binding_keys.length) {
      throw new Error("KUSABI_RAW_CAPTURE_REGISTRY_MATCH_DUPLICATE");
    }
    if (row.matched_manifest_binding_keys.some((key) => !authoritative.has(key))) {
      throw new Error("KUSABI_RAW_CAPTURE_REGISTRY_MATCH_NOT_AUTHORITATIVE");
    }
    if (row.matched_manifest_binding_keys.length === 0) unmatched.push(row.registry_row_sha256);
    for (const key of row.matched_manifest_binding_keys) covered.add(key);
  }
  const missing = authoritativeKeys.filter((key) => !covered.has(key));
  const reconciliation: RawCaptureReconciliation = {
    authoritative_target_count: manifest.targets.length,
    unique_authoritative_binding_key_count: authoritative.size,
    actual_covered_manifest_binding_count: covered.size,
    registry_manifest_exact_equality:
      covered.size === authoritative.size && missing.length === 0 && unmatched.length === 0,
    installed_registry_observation_count: registryRows.length,
    unmatched_registry_row_sha256: unmatched.sort(),
    missing_manifest_binding_keys: missing,
    unmatched_registry_row_count: unmatched.length,
    unmatched_registry_row_unique_count: new Set(unmatched).size,
    missing_manifest_binding_count: missing.length,
    missing_manifest_binding_unique_count: new Set(missing).size,
    arithmetic_net_difference: registryRows.length - manifest.targets.length,
    arithmetic_net_difference_is_enumerable_row_set: false,
  };
  assertFrozenReconciliation(reconciliation);
  return reconciliation;
}

export function assertFrozenReconciliation(value: RawCaptureReconciliation): void {
  const derivedExactEquality =
    value.actual_covered_manifest_binding_count === value.authoritative_target_count &&
    value.missing_manifest_binding_count === 0 &&
    value.unmatched_registry_row_count === 0;
  if (
    value.authoritative_target_count !== FROZEN_AUTHORITATIVE_TARGET_COUNT ||
    value.unique_authoritative_binding_key_count !== FROZEN_AUTHORITATIVE_TARGET_COUNT ||
    value.actual_covered_manifest_binding_count !==
      value.authoritative_target_count - value.missing_manifest_binding_unique_count ||
    value.actual_covered_manifest_binding_count !==
      FROZEN_AUTHORITATIVE_TARGET_COUNT - FROZEN_MISSING_MANIFEST_BINDING_COUNT ||
    value.registry_manifest_exact_equality !== derivedExactEquality ||
    value.registry_manifest_exact_equality !== false ||
    value.installed_registry_observation_count !== FROZEN_INSTALLED_REGISTRY_COUNT ||
    value.unmatched_registry_row_sha256.length !== FROZEN_UNMATCHED_REGISTRY_COUNT ||
    new Set(value.unmatched_registry_row_sha256).size !== FROZEN_UNMATCHED_REGISTRY_COUNT ||
    value.missing_manifest_binding_keys.length !== FROZEN_MISSING_MANIFEST_BINDING_COUNT ||
    new Set(value.missing_manifest_binding_keys).size !== FROZEN_MISSING_MANIFEST_BINDING_COUNT ||
    value.unmatched_registry_row_count !== FROZEN_UNMATCHED_REGISTRY_COUNT ||
    value.unmatched_registry_row_unique_count !== FROZEN_UNMATCHED_REGISTRY_COUNT ||
    value.missing_manifest_binding_count !== FROZEN_MISSING_MANIFEST_BINDING_COUNT ||
    value.missing_manifest_binding_unique_count !== FROZEN_MISSING_MANIFEST_BINDING_COUNT ||
    value.arithmetic_net_difference !== 12 ||
    value.arithmetic_net_difference_is_enumerable_row_set !== false
  ) {
    throw new Error("KUSABI_RAW_CAPTURE_FROZEN_RECONCILIATION_MISMATCH");
  }
}

export function assertImmutableRuntimeCandidate(candidate: RawCaptureRuntimeCandidate): void {
  if (
    !COMMIT_PATTERN.test(candidate.commit) ||
    !COMMIT_PATTERN.test(candidate.tree) ||
    !SHA256_PATTERN.test(candidate.built_artifact_sha256) ||
    candidate.build_command.length === 0 ||
    candidate.runtime_source_kind !== "immutable_release_artifact" ||
    candidate.artifact_path_relative_to_repository.length === 0 ||
    isAbsolute(candidate.artifact_path_relative_to_repository) ||
    candidate.artifact_path_relative_to_repository.split(/[\\/]/).includes("..")
  ) {
    throw new Error("KUSABI_RAW_CAPTURE_RUNTIME_CANDIDATE_INVALID");
  }
}

export function assertNotMutableWorkspaceDist(runtimeExecutable: string, repositoryRoot: string): void {
  const executable = resolve(runtimeExecutable);
  const mutableDist = resolve(repositoryRoot, "dist");
  const fromDist = relative(mutableDist, executable);
  if (fromDist === "" || (!fromDist.startsWith(`..${sep}`) && fromDist !== ".." && !isAbsolute(fromDist))) {
    throw new Error("KUSABI_RAW_CAPTURE_MUTABLE_WORKSPACE_DIST_FORBIDDEN");
  }
}

export async function runRawCaptureService(input: RunRawCaptureServiceInput): Promise<RawCaptureServiceReport> {
  assertImmutableRuntimeCandidate(input.runtime_candidate);
  const reconciliation = reconcileRawCaptureRegistry(input.manifest, input.registry_rows);
  const target = input.manifest.targets.find((item) => item.target_key === input.target_key);
  if (!target) throw new Error("KUSABI_RAW_CAPTURE_TARGET_NOT_IN_AUTHORITATIVE_MANIFEST");
  const sources = input.sources ?? [target.identity.host_runtime];
  if (
    sources.length === 0 ||
    new Set(sources).size !== sources.length ||
    sources.some((source) => !["codex", "claude_code", "gemini_cli"].includes(source))
  ) {
    throw new Error("KUSABI_RAW_CAPTURE_SOURCE_SELECTION_INVALID");
  }
  const sourceResults: RawCaptureSourceResult[] = [];
  for (const source of sources) {
    const common = {
      project: target.identity.project,
      since: input.since,
      root: input.source_roots[source],
      max_files: input.max_files,
    };
    if (source === "codex") {
      const value = await ingestCodexConversationEvents(input.store, target.identity.agent_id, common);
      sourceResults.push({
        source,
        files_scanned: value.files_scanned,
        records_seen: value.lines_seen,
        events_saved: value.events_saved,
        events_duplicate: value.events_duplicate,
        events_skipped: value.events_skipped,
        coverage_status: value.coverage.status,
      });
    } else if (source === "claude_code") {
      const value = await ingestClaudeConversationEvents(input.store, target.identity.agent_id, common);
      sourceResults.push({
        source,
        files_scanned: value.files_scanned,
        records_seen: value.lines_seen,
        events_saved: value.events_saved,
        events_duplicate: value.events_duplicate,
        events_skipped: value.events_skipped,
        coverage_status: value.coverage.status,
      });
    } else {
      const value = await ingestGeminiConversationEvents(input.store, target.identity.agent_id, common);
      sourceResults.push({
        source,
        files_scanned: value.files_scanned,
        records_seen: value.records_seen,
        events_saved: value.events_saved,
        events_duplicate: value.events_duplicate,
        events_skipped: value.events_skipped,
        coverage_status: value.coverage.status,
        privacy: value.privacy,
      });
    }
  }
  const generatedAt = input.generated_at ?? new Date().toISOString();
  const runId = input.run_id ?? `raw-capture-${sha256([
    input.manifest.manifest_id, input.target_key, generatedAt,
  ].join("\n")).slice(0, 24)}`;
  return {
    schema_version: "kusabi-raw-capture-service/v1",
    run_id: runId,
    generated_at: generatedAt,
    manifest_id: input.manifest.manifest_id,
    target_key: target.target_key,
    agent_id: target.identity.agent_id,
    project: target.identity.project,
    host_runtime: target.identity.host_runtime,
    store_backend: input.store.backend,
    deterministic_controller: "script",
    llm_call_count: 0,
    store_capability: "saveRawEvent",
    source_results: sourceResults,
    reconciliation,
    runtime_candidate: input.runtime_candidate,
    production_effect_count: 0,
  };
}

export function normalizeRawCaptureEvidence(value: RawCaptureServiceReport): Record<string, unknown> {
  return {
    ...value,
    store_backend: "normalized",
    source_results: value.source_results.map((source) => ({ ...source })),
  };
}

export function normalizedRawCaptureEvidenceSha256(value: RawCaptureServiceReport): string {
  return sha256(canonicalJson(normalizeRawCaptureEvidence(value)));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
