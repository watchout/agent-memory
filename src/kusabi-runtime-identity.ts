import { createHash } from "crypto";
import { readFileSync, realpathSync } from "fs";

export const KUSABI_RUNTIME_IDENTITY_SCHEMA = "kusabi-runtime-identity/v1" as const;

export const KUSABI_ONE_SEAT_IDENTITY = Object.freeze({
  agentId: "kusabi",
  memoryProject: "agent-memory",
  workspaceRef: "watchout/agent-memory",
  host: "codex",
  adapter: "verified_codex_startup_bridge",
  lifecycleOwner: "user_host",
});

export const ZERO_EFFECT_COUNTERS = Object.freeze({
  db_open_count: 0,
  schema_mutation_count: 0,
  model_invocation_count: 0,
  provider_dispatch_count: 0,
  aun_mutation_count: 0,
  external_effect_count: 0,
});

export type KusabiConfigValue = string | number | boolean | null;
export type KusabiRuntimeConfig = Readonly<Record<string, KusabiConfigValue>>;

export interface KusabiRuntimeIdentityInput {
  agentId: string;
  memoryProject: string;
  workspaceRef: string;
  workspacePath: string;
  host: string;
  adapter: string;
  lifecycleOwner: string;
  runtimeCommitSha: string;
  runtimeArtifactPath: string;
  config: KusabiRuntimeConfig;
}

export interface KusabiRuntimeIdentityExpectation {
  agentId: string;
  memoryProject: string;
  workspaceRef: string;
  workspacePathHash: string;
  host: string;
  adapter: string;
  lifecycleOwner: string;
  runtimeCommitSha: string;
  runtimeArtifactDigest: string;
  configDigest: string;
}

export interface KusabiRuntimeIdentityTuple {
  schema_version: typeof KUSABI_RUNTIME_IDENTITY_SCHEMA;
  identity: {
    agent_id: string;
    memory_project: string;
    workspace_ref: string;
    workspace_path_hash: string;
    host: string;
    adapter: string;
    lifecycle_owner: string;
  };
  runtime: {
    commit_sha: string;
    artifact_digest: string;
  };
  config_digest: string;
}

export interface KusabiRuntimeIdentityReadback {
  tuple: KusabiRuntimeIdentityTuple;
  canonical_json: string;
  tuple_sha256: string;
}

export interface KusabiRuntimeIdentityVerificationPass {
  ok: true;
  status: "pass";
  readback: KusabiRuntimeIdentityReadback;
  mismatched_fields: [];
  counters: typeof ZERO_EFFECT_COUNTERS;
}

export interface KusabiRuntimeIdentityVerificationBlock {
  ok: false;
  status: "blocked";
  code: "KUSABI_RUNTIME_IDENTITY_MISMATCH";
  readback: KusabiRuntimeIdentityReadback;
  mismatched_fields: string[];
  counters: typeof ZERO_EFFECT_COUNTERS;
}

export type KusabiRuntimeIdentityVerification =
  | KusabiRuntimeIdentityVerificationPass
  | KusabiRuntimeIdentityVerificationBlock;

export function canonicalConfigDigest(config: KusabiRuntimeConfig): string {
  return sha256(canonicalJson(config));
}

export function workspacePathDigest(workspacePath: string): string {
  return sha256(realpathSync(workspacePath));
}

export function runtimeArtifactDigest(runtimeArtifactPath: string): string {
  return sha256(readFileSync(realpathSync(runtimeArtifactPath)));
}

export function buildKusabiRuntimeIdentityReadback(
  input: KusabiRuntimeIdentityInput,
): KusabiRuntimeIdentityReadback {
  const tuple: KusabiRuntimeIdentityTuple = {
    schema_version: KUSABI_RUNTIME_IDENTITY_SCHEMA,
    identity: {
      agent_id: requireNonEmpty(input.agentId, "agentId"),
      memory_project: requireNonEmpty(input.memoryProject, "memoryProject"),
      workspace_ref: requireNonEmpty(input.workspaceRef, "workspaceRef"),
      workspace_path_hash: workspacePathDigest(requireNonEmpty(input.workspacePath, "workspacePath")),
      host: requireNonEmpty(input.host, "host"),
      adapter: requireNonEmpty(input.adapter, "adapter"),
      lifecycle_owner: requireNonEmpty(input.lifecycleOwner, "lifecycleOwner"),
    },
    runtime: {
      commit_sha: requireHex(input.runtimeCommitSha, 40, "runtimeCommitSha"),
      artifact_digest: runtimeArtifactDigest(
        requireNonEmpty(input.runtimeArtifactPath, "runtimeArtifactPath"),
      ),
    },
    config_digest: canonicalConfigDigest(input.config),
  };
  const canonical = canonicalJson(tuple);
  return {
    tuple,
    canonical_json: canonical,
    tuple_sha256: sha256(canonical),
  };
}

export function verifyKusabiRuntimeIdentity(
  readback: KusabiRuntimeIdentityReadback,
  expected: KusabiRuntimeIdentityExpectation,
): KusabiRuntimeIdentityVerification {
  const checks: Array<[string, string, string]> = [
    ["identity.agent_id", readback.tuple.identity.agent_id, expected.agentId],
    ["identity.memory_project", readback.tuple.identity.memory_project, expected.memoryProject],
    ["identity.workspace_ref", readback.tuple.identity.workspace_ref, expected.workspaceRef],
    ["identity.workspace_path_hash", readback.tuple.identity.workspace_path_hash, normalizeDigest(expected.workspacePathHash, "workspacePathHash")],
    ["identity.host", readback.tuple.identity.host, expected.host],
    ["identity.adapter", readback.tuple.identity.adapter, expected.adapter],
    ["identity.lifecycle_owner", readback.tuple.identity.lifecycle_owner, expected.lifecycleOwner],
    ["runtime.commit_sha", readback.tuple.runtime.commit_sha, requireHex(expected.runtimeCommitSha, 40, "expected.runtimeCommitSha")],
    ["runtime.artifact_digest", readback.tuple.runtime.artifact_digest, normalizeDigest(expected.runtimeArtifactDigest, "runtimeArtifactDigest")],
    ["config_digest", readback.tuple.config_digest, normalizeDigest(expected.configDigest, "configDigest")],
  ];
  const mismatchedFields = checks
    .filter(([, observed, wanted]) => observed !== wanted)
    .map(([field]) => field);

  if (mismatchedFields.length > 0) {
    return {
      ok: false,
      status: "blocked",
      code: "KUSABI_RUNTIME_IDENTITY_MISMATCH",
      readback,
      mismatched_fields: mismatchedFields,
      counters: ZERO_EFFECT_COUNTERS,
    };
  }

  return {
    ok: true,
    status: "pass",
    readback,
    mismatched_fields: [],
    counters: ZERO_EFFECT_COUNTERS,
  };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonical(value));
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortCanonical(record[key])]),
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  throw new Error("Kusabi canonical input contains an unsupported value");
}

function normalizeDigest(value: string, field: string): string {
  const normalized = value.startsWith("sha256:") ? value.slice(7) : value;
  return requireHex(normalized, 64, field);
}

function requireHex(value: string, length: number, field: string): string {
  const normalized = requireNonEmpty(value, field).toLowerCase();
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(normalized)) {
    throw new Error(`${field} must be ${length} lowercase hexadecimal characters`);
  }
  return normalized;
}

function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.includes("\0")) {
    throw new Error(`${field} must be a non-empty canonical string`);
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
