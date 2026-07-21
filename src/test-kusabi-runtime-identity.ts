import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildKusabiRuntimeIdentityReadback,
  canonicalConfigDigest,
  KUSABI_ONE_SEAT_IDENTITY,
  verifyKusabiRuntimeIdentity,
  workspacePathDigest,
  type KusabiRuntimeIdentityExpectation,
  type KusabiRuntimeIdentityInput,
} from "./kusabi-runtime-identity.js";
import {
  expectedKusabiCodexStartConfigDigest,
  KUSABI_CODEX_START_CONFIG,
  runKusabiRuntimeIdentityPreflight,
} from "./codex-start.js";

const root = mkdtempSync(join(tmpdir(), "kusabi-runtime-identity-"));
const artifactPath = join(root, "codex-start.js");
writeFileSync(artifactPath, "verified runtime artifact\n");

const config = {
  guard_mode: "pack_only",
  auto_restart: false,
  queue_mutation_enabled: false,
  bounded_recent_projection_tokens: 800,
};
const input: KusabiRuntimeIdentityInput = {
  ...KUSABI_ONE_SEAT_IDENTITY,
  workspacePath: root,
  runtimeCommitSha: "6e85144e4ec22f24d51cf1975c7d0448485df4b7",
  runtimeArtifactPath: artifactPath,
  config,
};
const readback = buildKusabiRuntimeIdentityReadback(input);
const expected: KusabiRuntimeIdentityExpectation = {
  ...KUSABI_ONE_SEAT_IDENTITY,
  workspacePathHash: workspacePathDigest(root),
  runtimeCommitSha: input.runtimeCommitSha,
  runtimeArtifactDigest: readback.tuple.runtime.artifact_digest,
  configDigest: canonicalConfigDigest(config),
};

try {
  // KUI-001 exact identity positive.
  const positive = verifyKusabiRuntimeIdentity(readback, expected);
  assert.equal(positive.ok, true);
  assert.equal(positive.status, "pass");
  assert.equal(positive.readback.tuple.identity.agent_id, "kusabi");
  assert.equal(positive.readback.tuple.identity.memory_project, "agent-memory");
  assert.match(positive.readback.tuple_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(positive.counters, {
    db_open_count: 0,
    schema_mutation_count: 0,
    model_invocation_count: 0,
    provider_dispatch_count: 0,
    aun_mutation_count: 0,
    external_effect_count: 0,
  });

  // KUI-002 all identity variants fail closed without effects.
  const variants: Array<[keyof KusabiRuntimeIdentityExpectation, string]> = [
    ["agentId", "arc"],
    ["memoryProject", "spec"],
    ["workspaceRef", "watchout/spec"],
    ["workspacePathHash", "f".repeat(64)],
    ["host", "claude"],
    ["adapter", "legacy_direct_codex"],
    ["lifecycleOwner", "aun"],
  ];
  for (const [field, wrong] of variants) {
    const result = verifyKusabiRuntimeIdentity(readback, { ...expected, [field]: wrong });
    assert.equal(result.ok, false, `${field} must fail closed`);
    assert.equal(result.status, "blocked");
    assert.equal(result.counters.db_open_count, 0);
    assert.equal(result.counters.model_invocation_count, 0);
    assert.equal(result.counters.external_effect_count, 0);
  }

  // KUI-014 runtime/config drift fails closed.
  for (const drift of [
    { runtimeCommitSha: "a".repeat(40) },
    { runtimeArtifactDigest: "b".repeat(64) },
    { configDigest: "c".repeat(64) },
  ]) {
    const result = verifyKusabiRuntimeIdentity(readback, { ...expected, ...drift });
    assert.equal(result.ok, false);
    assert.equal(result.counters.db_open_count, 0);
  }

  // KUI-011 sensitive inputs are digested, never emitted in the canonical tuple.
  const homePath = "/Users/example/secret-workspace";
  const sensitive = buildKusabiRuntimeIdentityReadback({
    ...input,
    config: {
      safe_mode: true,
      secret: "sk-example-do-not-emit",
      private_reasoning: "hidden reasoning must not be emitted",
      home_path: homePath,
    },
  });
  assert.equal(sensitive.canonical_json.includes("sk-example"), false);
  assert.equal(sensitive.canonical_json.includes("hidden reasoning"), false);
  assert.equal(sensitive.canonical_json.includes(homePath), false);
  assert.equal(sensitive.canonical_json.includes(root), false);

  // KUI-016 the known spec->arc regression is rejected before any effect.
  const regression = buildKusabiRuntimeIdentityReadback({
    ...input,
    agentId: "arc",
    memoryProject: "spec",
    workspaceRef: "watchout/spec",
  });
  const regressionResult = verifyKusabiRuntimeIdentity(regression, expected);
  assert.equal(regressionResult.ok, false);
  if (!regressionResult.ok) {
    assert.deepEqual(regressionResult.mismatched_fields, [
      "identity.agent_id",
      "identity.memory_project",
      "identity.workspace_ref",
    ]);
    assert.equal(regressionResult.counters.model_invocation_count, 0);
  }

  // Codex opt-in integration validates before createStore; non-opt-in is inert.
  assert.equal(
    runKusabiRuntimeIdentityPreflight({}, { workspacePath: root, runtimeArtifactPath: artifactPath }),
    undefined,
  );
  const preflightEnv = {
    AGENT_MEMORY_KUSABI_INTERNAL_OPT_IN: "1",
    AGENT_MEMORY_AGENT_ID: "kusabi",
    AGENT_MEMORY_PROJECT: "agent-memory",
    AGENT_MEMORY_WORKSPACE_REF: "watchout/agent-memory",
    AGENT_MEMORY_HOST: "codex",
    AGENT_MEMORY_ADAPTER: "verified_codex_startup_bridge",
    AGENT_MEMORY_LIFECYCLE_OWNER: "user_host",
    AGENT_MEMORY_EXPECTED_WORKSPACE_PATH_SHA256: workspacePathDigest(root),
    AGENT_MEMORY_EXPECTED_RUNTIME_COMMIT_SHA: input.runtimeCommitSha,
    AGENT_MEMORY_EXPECTED_RUNTIME_ARTIFACT_SHA256: readback.tuple.runtime.artifact_digest,
    AGENT_MEMORY_EXPECTED_CONFIG_SHA256: expectedKusabiCodexStartConfigDigest(),
  };
  const integrated = runKusabiRuntimeIdentityPreflight(preflightEnv, {
    workspacePath: root,
    runtimeArtifactPath: artifactPath,
    resolveRuntimeCommitSha: () => input.runtimeCommitSha,
  });
  assert.equal(integrated?.tuple.identity.agent_id, "kusabi");
  assert.equal(canonicalConfigDigest(KUSABI_CODEX_START_CONFIG), expectedKusabiCodexStartConfigDigest());

  assert.throws(
    () =>
      runKusabiRuntimeIdentityPreflight(
        { ...preflightEnv, AGENT_MEMORY_AGENT_ID: "arc" },
        {
          workspacePath: root,
          runtimeArtifactPath: artifactPath,
          resolveRuntimeCommitSha: () => input.runtimeCommitSha,
        },
      ),
    /KUSABI_RUNTIME_IDENTITY_MISMATCH: identity\.agent_id; db_open_count=0 model_invocation_count=0 external_effect_count=0/,
  );

  console.log("KUI-001 PASS exact identity positive");
  console.log("KUI-002 PASS identity variants fail closed");
  console.log("KUI-011 PASS sensitive values and home paths are digest-only");
  console.log("KUI-014 PASS runtime and config drift fail closed");
  console.log("KUI-016 PASS spec-to-arc regression rejected with zero effects");
  console.log("kusabi runtime identity tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
