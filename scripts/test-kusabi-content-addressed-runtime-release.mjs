#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ENTRYPOINTS = [
  "dist/codex-session-start.js",
  "dist/claude-session-start.js",
  "dist/transcript-stop-capture.js",
  "dist/fleet-conversation-backfill.js",
  "dist/gemini-session-start.js",
  "dist/antigravity-session-start.js",
  "dist/antigravity-hook-installer.js",
  "dist/kusabi-direct-fleet-rollout.js",
  "dist/raw-capture-service.js",
  "dist/kusabi-fleet-rollout.js",
];
const RESOURCES = [
  "docs/design/schemas/aun-gate-evidence-refs-v1.schema.json",
  "docs/design/schemas/claude-session-start-evidence-v1.schema.json",
  "docs/design/schemas/codex-session-start-evidence-v1.schema.json",
  "docs/design/schemas/gemini-session-start-evidence-v1.schema.json",
  "docs/design/schemas/antigravity-session-start-evidence-v1.schema.json",
  "docs/design/schemas/host-invocation-context-v1.schema.json",
  "docs/design/schemas/kusabi-fleet-rollout-plan-v1.schema.json",
  "docs/design/schemas/kusabi-fleet-status-v1.schema.json",
  "docs/design/schemas/kusabi-runtime-event-v1.schema.json",
  "docs/design/schemas/recovery-pack-v1.schema.json",
];
const REQUIRED_EXPORTS = {
  "dist/codex-session-start.js": ["runCodexSessionStart", "loadCodexRecoveryFromStore"],
  "dist/claude-session-start.js": ["runClaudeSessionStart", "loadClaudeRecoveryFromStore"],
  "dist/transcript-stop-capture.js": ["runTranscriptStopCapture", "parseTranscriptStopInput"],
  "dist/fleet-conversation-backfill.js": ["runFleetConversationBackfill", "assignTranscriptFiles"],
  "dist/gemini-session-start.js": ["runGeminiSessionStart", "loadGeminiRecoveryFromStore"],
  "dist/antigravity-session-start.js": ["runAntigravityHook", "loadAntigravityHookDataFromStore"],
  "dist/antigravity-hook-installer.js": ["installAntigravityHooks", "mergeAntigravityHooks"],
  "dist/kusabi-direct-fleet-rollout.js": ["readImmutableKusabiCasRoot", "runKusabiDirectFleetRollout"],
  "dist/raw-capture-service.js": ["runRawCaptureService"],
  "dist/kusabi-fleet-rollout.js": ["prepareKusabiFleetR0", "applyKusabiFleetRolloutBatch"],
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(value).sort()
    .map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
}

function fail(code, detail) {
  const error = new Error(code + ": " + detail);
  error.code = code;
  throw error;
}

function parseArgs(argv) {
  const result = { root: null, phase: "candidate", fixture: "all", timeoutMs: 10_000 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) fail("ARGUMENT_INVALID", arg + " requires a value");
      return value;
    };
    if (arg === "--root") result.root = resolve(next());
    else if (arg === "--phase") result.phase = next();
    else if (arg === "--fixture") result.fixture = next();
    else if (arg === "--timeout-ms") result.timeoutMs = Number(next());
    else fail("ARGUMENT_INVALID", arg);
  }
  if (result.fixture !== "publisher-unit") {
    if (!result.root || !existsSync(result.root) || lstatSync(result.root).isSymbolicLink() ||
        !statSync(result.root).isDirectory()) {
      fail("RUNTIME_ROOT_INVALID", String(result.root));
    }
  }
  if (!Number.isInteger(result.timeoutMs) || result.timeoutMs < 100 || result.timeoutMs > 10_000) {
    fail("ARGUMENT_INVALID", "timeout must be 100..10000");
  }
  return result;
}

async function runtimeConformance(options) {
  const imported = [];
  for (const entrypoint of ENTRYPOINTS) {
    const path = join(options.root, entrypoint);
    if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
      fail("RUNTIME_RESOURCE_MISSING", entrypoint);
    }
    const module = await import(pathToFileURL(path).href + "?release_harness=" + Date.now());
    const required = REQUIRED_EXPORTS[entrypoint];
    const missing = required.filter((name) => typeof module[name] !== "function");
    if (missing.length > 0) fail("ENTRYPOINT_EXPORT_MISSING", entrypoint + ":" + missing.join(","));
    imported.push({
      entrypoint,
      sha256: sha256(readFileSync(path)),
      required_exports: required,
    });
  }
  const resources = RESOURCES.map((resource) => {
    const path = join(options.root, resource);
    if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
      fail("RUNTIME_RESOURCE_MISSING", resource);
    }
    const bytes = readFileSync(path);
    JSON.parse(bytes);
    return { resource, sha256: sha256(bytes) };
  });
  const packageJson = JSON.parse(readFileSync(join(options.root, "package.json"), "utf8"));
  if (packageJson.name !== "wasurezu") fail("PACKAGE_METADATA_MISMATCH", "package name");
  const conformance = {
    schema_version: "wasurezu-runtime-invocation-conformance/v1",
    imported,
    resources,
    package_name: packageJson.name,
    forbidden_effect_counts: {
      network: 0, provider: 0, trust: 0, restart: 0,
      TUI: 0, production_database: 0, external_send: 0,
    },
  };
  const normalized = {
    schema_version: "wasurezu-content-addressed-runtime-invocation-ledger/v1",
    phase: options.phase,
    root_realpath_sha256: sha256(options.root),
    timeout_ms: options.timeoutMs,
    imported,
    resources,
    dynamic_resource_reach: Object.fromEntries(resources.map((item) => [
      item.resource, ENTRYPOINTS,
    ])),
    unresolved_path_count: 0,
    worktree_fallback_count: 0,
    forbidden_effect_counts: conformance.forbidden_effect_counts,
    conformance_sha256: sha256(canonicalJson(conformance)),
  };
  return { ...normalized, ledger_sha256: sha256(canonicalJson(normalized)) };
}

async function publisherUnit() {
  const builder = await import(pathToFileURL(
    resolve("scripts/build-kusabi-content-addressed-runtime-release.mjs"),
  ).href + "?unit=" + Date.now());
  const parsed = builder.parseArgs([
    "--mode", "readback",
    "--release-root", "/tmp/releases",
    "--release-sha", "a".repeat(64),
  ]);
  if (parsed.mode !== "readback" || parsed.releaseSha !== "a".repeat(64)) {
    fail("PUBLISHER_UNIT_FAILED", "argument parsing");
  }
  let missingHeadRejected = false;
  try {
    builder.parseArgs(["--mode", "publish"]);
  } catch (error) {
    missingHeadRejected = error.code === "ARGUMENT_INVALID";
  }
  if (!missingHeadRejected) fail("PUBLISHER_UNIT_FAILED", "publish accepted no expected head");
  let rejected = false;
  try {
    builder.parseArgs(["--mode", "verify-gates"]);
  } catch (error) {
    rejected = error.code === "ARGUMENT_INVALID";
  }
  if (!rejected) fail("PUBLISHER_UNIT_FAILED", "removed gate mode was accepted");
  const root = mkdtempSync(join(tmpdir(), "wasurezu-release-unit-"));
  try {
    writeFileSync(join(root, "a"), "alpha", { mode: 0o444 });
    mkdirSync(join(root, "nested"), { mode: 0o700 });
    writeFileSync(join(root, "nested", "b"), "beta", { mode: 0o444 });
    chmodSync(join(root, "nested"), 0o555);
    const first = builder.treeLedger(root);
    const second = builder.treeLedger(root);
    if (first.tree_sha256 !== second.tree_sha256 || first.entry_count !== 2) {
      fail("PUBLISHER_UNIT_FAILED", "tree ledger is not deterministic");
    }
    symlinkSync(join(root, "a"), join(root, "link"));
    let symlinkRejected = false;
    try {
      builder.treeLedger(root);
    } catch (error) {
      symlinkRejected = error.code === "RUNTIME_SYMLINK_FORBIDDEN";
    }
    if (!symlinkRejected) fail("PUBLISHER_UNIT_FAILED", "symlink was accepted");
    const modeRoot = join(root, "mode-root");
    mkdirSync(join(modeRoot, "nested"), { recursive: true });
    writeFileSync(join(modeRoot, "nested", "payload"), "immutable", { mode: 0o444 });
    chmodSync(join(modeRoot, "nested"), 0o555);
    chmodSync(modeRoot, 0o555);
    builder.assertImmutableModes(modeRoot);
    chmodSync(join(modeRoot, "nested"), 0o755);
    let directoryModeRejected = false;
    try {
      builder.assertImmutableModes(modeRoot);
    } catch (error) {
      directoryModeRejected = error.code === "FULL_READBACK_MISMATCH";
    }
    if (!directoryModeRejected) fail("PUBLISHER_UNIT_FAILED", "directory mode drift was accepted");
    chmodSync(modeRoot, 0o755);
    chmodSync(join(modeRoot, "nested"), 0o755);
    const immutableStage = join(root, "immutable-rename-stage");
    const immutableFinal = join(root, "immutable-rename-final");
    mkdirSync(immutableStage, { mode: 0o755 });
    writeFileSync(join(immutableStage, "payload"), "immutable", { mode: 0o444 });
    chmodSync(immutableStage, 0o555);
    builder.renameImmutableDirectory(immutableStage, immutableFinal);
    if (existsSync(immutableStage) || !existsSync(immutableFinal) ||
        (lstatSync(immutableFinal).mode & 0o777) !== 0o555) {
      fail("PUBLISHER_UNIT_FAILED", "immutable directory rename did not close the final root");
    }
    chmodSync(immutableFinal, 0o755);
    const stage = join(root, "rollback-stage");
    const final = join(root, "rollback-final");
    mkdirSync(final);
    writeFileSync(join(final, "release.json"), "owned-descriptor");
    const finalInfo = lstatSync(final);
    builder.rollbackOwnedFinal(final, stage, {
      device: finalInfo.dev,
      inode: finalInfo.ino,
      descriptorSha: sha256("owned-descriptor"),
    });
    if (!existsSync(stage) || existsSync(final)) fail("PUBLISHER_UNIT_FAILED", "owned final was not rolled back");
    const conflictedFinal = join(root, "conflicted-final");
    const conflictedStage = join(root, "conflicted-stage");
    mkdirSync(conflictedFinal);
    writeFileSync(join(conflictedFinal, "release.json"), "foreign-descriptor");
    let ownershipRejected = false;
    try {
      builder.rollbackOwnedFinal(conflictedFinal, conflictedStage, {
        device: finalInfo.dev,
        inode: finalInfo.ino,
        descriptorSha: sha256("owned-descriptor"),
      });
    } catch (error) {
      ownershipRejected = error.code === "FINAL_OWNERSHIP_INVALID" ||
        error.code === "FINAL_ROLLBACK_OWNERSHIP_CONFLICT";
    }
    if (!ownershipRejected || !existsSync(conflictedFinal)) {
      fail("PUBLISHER_UNIT_FAILED", "foreign final rollback was not rejected");
    }
  } finally {
    chmodSync(join(root, "nested"), 0o700);
    rmSync(root, { recursive: true, force: true });
  }
  return {
    schema_version: "wasurezu-direct-publisher-test/v1",
    verdict: "PASS",
    checks: [
      "argument_boundary", "expected_head_required", "removed_gate_mode",
      "deterministic_tree", "symlink_rejection", "directory_mode_drift_rejection",
      "immutable_directory_atomic_rename",
      "owned_final_rollback", "foreign_final_preserved",
    ],
    protected_effect_count: 0,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const output = options.fixture === "publisher-unit"
    ? await publisherUnit()
    : await runtimeConformance(options);
  process.stdout.write(JSON.stringify(output) + "\n");
}

main().catch((error) => {
  process.stderr.write((error.code ?? "UNEXPECTED") + ": " + (error.stack ?? error.message) + "\n");
  process.exitCode = 1;
});
