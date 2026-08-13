#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync,
  mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync,
  rmSync, statSync, writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPOSITORY = "watchout/agent-memory";
const DEFAULT_RELEASE_ROOT = "/Users/yuji/Developer/.kusabi-releases";
const HARNESS_PATH = resolve("scripts/test-kusabi-content-addressed-runtime-release.mjs");
const BUILD_COMMANDS = ["npm ci --ignore-scripts", "npm run build"];
const STAGING_DEPENDENCY_COMMAND = "npm ci --omit=dev --ignore-scripts --no-bin-links";
const ENTRYPOINTS = [
  "dist/codex-session-start.js",
  "dist/claude-session-start.js",
  "dist/gemini-session-start.js",
  "dist/antigravity-session-start.js",
  "dist/antigravity-hook-installer.js",
  "dist/kusabi-direct-fleet-rollout.js",
  "dist/raw-capture-service.js",
  "dist/kusabi-fleet-rollout.js",
];
const RUNTIME_RESOURCES = [
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

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function byteCompare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(value).sort(byteCompare)
    .map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
}

function fail(code, detail) {
  const error = new Error(code + ": " + detail);
  error.code = code;
  throw error;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeout,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) fail(options.code ?? "COMMAND_FAILED", result.error.message);
  if (result.status !== 0) {
    fail(
      options.code ?? "COMMAND_FAILED",
      basename(command) + " " + args.join(" ") + " exited " + result.status + ": " +
        (result.stderr || result.stdout).trim(),
    );
  }
  return result.stdout.trim();
}

function git(args) {
  return run("git", args, { code: "SOURCE_BOUNDARY_FAILED" });
}

export function parseArgs(argv) {
  const options = {
    mode: "candidate",
    releaseRoot: DEFAULT_RELEASE_ROOT,
    releaseSha: null,
    evidenceOutput: null,
    expectedHead: null,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) fail("ARGUMENT_INVALID", arg + " requires a value");
      return value;
    };
    if (arg === "--mode") options.mode = next();
    else if (arg === "--release-root") options.releaseRoot = resolve(next());
    else if (arg === "--release-sha" || arg === "--expected-release-sha") options.releaseSha = next();
    else if (arg === "--evidence-output") options.evidenceOutput = resolve(next());
    else if (arg === "--expected-head") options.expectedHead = next();
    else fail("ARGUMENT_INVALID", arg);
  }
  if (!["candidate", "publish", "readback"].includes(options.mode)) {
    fail("ARGUMENT_INVALID", "unsupported mode " + options.mode);
  }
  if (options.mode === "readback" && !/^[0-9a-f]{64}$/.test(options.releaseSha ?? "")) {
    fail("ARGUMENT_INVALID", "readback requires --release-sha");
  }
  if (options.mode === "publish" && !/^[0-9a-f]{40}$/.test(options.expectedHead ?? "")) {
    fail("ARGUMENT_INVALID", "publish requires --expected-head");
  }
  return options;
}

function statusPaths() {
  const output = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  return output ? output.split("\n").filter(Boolean) : [];
}

function sourceSnapshot(expectedHead = null) {
  if (statusPaths().length > 0) fail("SOURCE_BOUNDARY_FAILED", "release requires a clean worktree");
  const source = { commit: git(["rev-parse", "HEAD"]), tree: git(["rev-parse", "HEAD^{tree}"]) };
  if (expectedHead !== null && source.commit !== expectedHead) {
    fail("SOURCE_BOUNDARY_FAILED", "HEAD does not match --expected-head");
  }
  return source;
}

function assertSourceUnchanged(source) {
  if (
    git(["rev-parse", "HEAD"]) !== source.commit ||
    git(["rev-parse", "HEAD^{tree}"]) !== source.tree ||
    statusPaths().length > 0
  ) {
    fail("SOURCE_BOUNDARY_FAILED", "HEAD, tree, or worktree changed during release");
  }
}

function safeRoot(path, code) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o755 });
  if (lstatSync(path).isSymbolicLink() || !statSync(path).isDirectory() || realpathSync(path) !== path) {
    fail(code, path + " is not an exact real directory");
  }
}

function walkFiles(root, directory = root, out = []) {
  for (const name of readdirSync(directory).sort(byteCompare)) {
    const path = join(directory, name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) fail("RUNTIME_SYMLINK_FORBIDDEN", relative(root, path));
    if (info.isDirectory()) walkFiles(root, path, out);
    else if (info.isFile()) out.push(path);
    else fail("RUNTIME_NODE_TYPE_FORBIDDEN", relative(root, path));
  }
  return out;
}

function modeString(mode) {
  return (mode & 0o7777).toString(8).padStart(4, "0");
}

export function assertImmutableModes(root) {
  const visit = (path) => {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) fail("FULL_READBACK_MISMATCH", "symlink: " + relative(root, path));
    if (info.isDirectory()) {
      if (modeString(info.mode) !== "0555") {
        fail("FULL_READBACK_MISMATCH", "directory mode: " + (relative(root, path) || "."));
      }
      for (const name of readdirSync(path).sort(byteCompare)) visit(join(path, name));
      return;
    }
    if (!info.isFile() || modeString(info.mode) !== "0444") {
      fail("FULL_READBACK_MISMATCH", "file mode: " + relative(root, path));
    }
  };
  visit(root);
}

function normalizeModes(root) {
  const directories = [];
  const visit = (directory) => {
    directories.push(directory);
    for (const name of readdirSync(directory).sort(byteCompare)) {
      const path = join(directory, name);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) fail("RUNTIME_SYMLINK_FORBIDDEN", relative(root, path));
      if (info.isDirectory()) visit(path);
      else if (info.isFile()) chmodSync(path, 0o444);
      else fail("RUNTIME_NODE_TYPE_FORBIDDEN", relative(root, path));
    }
  };
  visit(root);
  for (const directory of directories.reverse()) chmodSync(directory, 0o555);
}

function makeWritable(root) {
  if (!existsSync(root)) return;
  const visit = (path) => {
    const info = lstatSync(path);
    if (info.isDirectory()) {
      chmodSync(path, 0o700);
      for (const name of readdirSync(path)) visit(join(path, name));
    } else if (!info.isSymbolicLink()) {
      chmodSync(path, 0o600);
    }
  };
  visit(root);
}

function removeStage(stageRoot, stagingParent) {
  const expectedPrefix = realpathSync(stagingParent) + sep;
  const exact = resolve(stageRoot);
  if (!exact.startsWith(expectedPrefix) || !basename(exact).startsWith("wasurezu-")) {
    fail("STAGING_CLEANUP_BOUNDARY", exact);
  }
  makeWritable(exact);
  rmSync(exact, { recursive: true, force: true });
}

export function treeLedger(root, options = {}) {
  const entries = walkFiles(root).map((path) => {
    const relativePath = relative(root, path).split(sep).join("/");
    const info = statSync(path);
    return {
      path: relativePath,
      mode: modeString(info.mode),
      size: info.size,
      sha256: sha256(readFileSync(path)),
    };
  }).filter((entry) => !(options.excludeRelease && entry.path === "release.json"))
    .sort((a, b) => byteCompare(a.path, b.path));
  const preimage = entries.map((entry) =>
    entry.path + "\t" + entry.mode + "\t" + entry.size + "\t" + entry.sha256 + "\n").join("");
  return {
    schema_version: "wasurezu-runtime-tree-ledger/v1",
    entry_count: entries.length,
    tree_sha256: sha256(preimage),
    entries,
  };
}

function entrypointMap(root) {
  const map = {};
  for (const entrypoint of ENTRYPOINTS) {
    const path = join(root, entrypoint);
    if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
      fail("ENTRYPOINT_MISSING", entrypoint);
    }
    map[entrypoint] = sha256(readFileSync(path));
  }
  return map;
}

function runHarness(root, phase) {
  const output = run(process.execPath, [
    HARNESS_PATH, "--root", root, "--phase", phase,
    "--fixture", "all", "--timeout-ms", "10000",
  ], { timeout: 180_000, code: "INVOCATION_HARNESS_FAILED" });
  const ledger = JSON.parse(output);
  if (
    ledger.unresolved_path_count !== 0 ||
    ledger.worktree_fallback_count !== 0 ||
    Object.values(ledger.forbidden_effect_counts ?? {}).some((value) => value !== 0)
  ) {
    fail("INVOCATION_HARNESS_FAILED", "fallback, unresolved resource, or protected effect detected");
  }
  return ledger;
}

function descriptorFor(root, source, candidateInvocation) {
  return {
    schema_version: "wasurezu-content-addressed-runtime-release/v1",
    repository: REPOSITORY,
    source_commit: source.commit,
    source_tree: source.tree,
    runtime_tree_sha256: treeLedger(root).tree_sha256,
    dist_tree_sha256: treeLedger(join(root, "dist")).tree_sha256,
    required_entrypoint_sha256_map: entrypointMap(root),
    invocation_harness_sha256: sha256(readFileSync(HARNESS_PATH)),
    invocation_ledgers: {
      candidate_ledger_sha256: candidateInvocation.ledger_sha256,
      candidate_conformance_sha256: candidateInvocation.conformance_sha256,
      required_final_conformance_sha256: candidateInvocation.conformance_sha256,
    },
    package_metadata: {
      package_json_sha256: sha256(readFileSync(join(root, "package.json"))),
      package_lock_sha256: sha256(readFileSync(join(root, "package-lock.json"))),
    },
    normalized_file_mode: "0444",
    normalized_directory_mode: "0555",
    build_commands: BUILD_COMMANDS,
    staging_dependency_command: STAGING_DEPENDENCY_COMMAND,
    node_version: process.version,
    npm_version: run("npm", ["--version"]),
    platform: process.platform + "-" + process.arch,
  };
}

export function exactReadback(root, expectedDescriptorSha) {
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() ||
      !statSync(root).isDirectory() || realpathSync(root) !== root) {
    fail("FULL_READBACK_MISMATCH", root);
  }
  assertImmutableModes(root);
  const bytes = readFileSync(join(root, "release.json"));
  if (sha256(bytes) !== expectedDescriptorSha) fail("FULL_READBACK_MISMATCH", "descriptor digest");
  const descriptor = JSON.parse(bytes);
  if (canonicalJson(descriptor) !== bytes.toString("utf8")) {
    fail("FULL_READBACK_MISMATCH", "descriptor is not canonical JSON");
  }
  const runtime = treeLedger(root, { excludeRelease: true });
  const dist = treeLedger(join(root, "dist"));
  if (
    runtime.tree_sha256 !== descriptor.runtime_tree_sha256 ||
    dist.tree_sha256 !== descriptor.dist_tree_sha256 ||
    canonicalJson(entrypointMap(root)) !== canonicalJson(descriptor.required_entrypoint_sha256_map)
  ) {
    fail("FULL_READBACK_MISMATCH", "runtime, dist, or entrypoint ledger");
  }
  return { descriptor_sha256: expectedDescriptorSha, descriptor, runtime, dist };
}

function buildStage(releaseRoot, source) {
  safeRoot(releaseRoot, "RELEASE_ROOT_INVALID");
  const stagingParent = join(releaseRoot, ".staging");
  const finalParent = join(releaseRoot, "sha256");
  safeRoot(stagingParent, "STAGING_ROOT_INVALID");
  safeRoot(finalParent, "RELEASE_ROOT_INVALID");
  const stageRoot = mkdtempSync(join(stagingParent, "wasurezu-" + source.commit.slice(0, 12) + "-"));
  let keep = false;
  try {
    run("npm", ["ci", "--ignore-scripts"], { timeout: 180_000, code: "CLEAN_BUILD_FAILED" });
    run("npm", ["run", "build"], { timeout: 180_000, code: "CLEAN_BUILD_FAILED" });
    assertSourceUnchanged(source);
    cpSync(resolve("dist"), join(stageRoot, "dist"), {
      recursive: true, dereference: false, errorOnExist: true,
    });
    copyFileSync(resolve("package.json"), join(stageRoot, "package.json"));
    copyFileSync(resolve("package-lock.json"), join(stageRoot, "package-lock.json"));
    for (const resource of RUNTIME_RESOURCES) {
      const target = join(stageRoot, resource);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      copyFileSync(resolve(resource), target);
    }
    run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-bin-links"], {
      cwd: stageRoot, timeout: 180_000, code: "DEPENDENCY_INSTALL_FAILED",
    });
    normalizeModes(stageRoot);
    const candidateInvocation = runHarness(stageRoot, "candidate");
    const descriptor = descriptorFor(stageRoot, source, candidateInvocation);
    const descriptorBytes = canonicalJson(descriptor);
    const descriptorSha = sha256(descriptorBytes);
    chmodSync(stageRoot, 0o755);
    writeFileSync(join(stageRoot, "release.json"), descriptorBytes, { flag: "wx", mode: 0o444 });
    chmodSync(stageRoot, 0o555);
    exactReadback(stageRoot, descriptorSha);
    keep = true;
    return {
      stageRoot,
      finalRoot: join(finalParent, descriptorSha),
      descriptorSha,
      descriptor,
      candidateInvocation,
    };
  } finally {
    if (!keep && existsSync(stageRoot)) removeStage(stageRoot, stagingParent);
  }
}

function writeEvidence(path, evidence) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

function finalIdentity(path, descriptorSha) {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      sha256(readFileSync(join(path, "release.json"))) !== descriptorSha) {
    fail("FINAL_OWNERSHIP_INVALID", path);
  }
  return { device: info.dev, inode: info.ino, descriptorSha };
}

export function rollbackOwnedFinal(finalRoot, stageRoot, ownership) {
  if (existsSync(stageRoot)) fail("FINAL_ROLLBACK_STAGE_OCCUPIED", stageRoot);
  if (!existsSync(finalRoot)) fail("FINAL_ROLLBACK_FINAL_MISSING", finalRoot);
  const observed = finalIdentity(finalRoot, ownership.descriptorSha);
  if (observed.device !== ownership.device || observed.inode !== ownership.inode) {
    fail("FINAL_ROLLBACK_OWNERSHIP_CONFLICT", finalRoot);
  }
  renameSync(finalRoot, stageRoot);
}

export function renameImmutableDirectory(stageRoot, finalRoot) {
  const stageInfo = lstatSync(stageRoot);
  if (!stageInfo.isDirectory() || stageInfo.isSymbolicLink() || modeString(stageInfo.mode) !== "0555") {
    fail("STAGE_ROOT_NOT_IMMUTABLE", stageRoot);
  }
  // macOS denies renaming a directory whose own mode is 0555, even when both
  // parents are writable. Only the root is opened for the rename syscall;
  // all descendants remain immutable, and the final root is closed again
  // before it is read back or exposed as a successful publication.
  chmodSync(stageRoot, 0o755);
  try {
    renameSync(stageRoot, finalRoot);
  } catch (error) {
    chmodSync(stageRoot, 0o555);
    throw error;
  }
  try {
    chmodSync(finalRoot, 0o555);
  } catch (error) {
    try {
      renameSync(finalRoot, stageRoot);
      chmodSync(stageRoot, 0o555);
    } catch (rollbackError) {
      fail("FINAL_MODE_ROLLBACK_FAILED", `${String(error)}; ${String(rollbackError)}`);
    }
    throw error;
  }
}

function candidate(options) {
  const source = sourceSnapshot(options.expectedHead);
  const built = buildStage(options.releaseRoot, source);
  const evidence = {
    schema_version: "wasurezu-runtime-release-evidence/v1",
    operation_id: randomUUID(),
    outcome: "CANDIDATE_VERIFIED",
    source,
    descriptor_sha256: built.descriptorSha,
    stage_root: built.stageRoot,
    proposed_final_root: built.finalRoot,
    candidate_invocation_ledger_sha256: built.candidateInvocation.ledger_sha256,
    protected_effects: { final_cas_publication: 0, fleet_rollout: 0, restart: 0 },
  };
  writeEvidence(options.evidenceOutput, evidence);
  process.stdout.write(canonicalJson(evidence) + "\n");
}

function publish(options) {
  const source = sourceSnapshot(options.expectedHead);
  const built = buildStage(options.releaseRoot, source);
  assertSourceUnchanged(source);
  let publication = "ATOMIC_RENAME_NEW_CAS";
  let createdFinal = false;
  let ownedFinal = null;
  try {
    if (existsSync(built.finalRoot)) {
      const existing = exactReadback(built.finalRoot, built.descriptorSha);
      if (canonicalJson(existing.runtime) !==
          canonicalJson(treeLedger(built.stageRoot, { excludeRelease: true }))) {
        fail("CAS_FINAL_COLLISION", built.finalRoot);
      }
      removeStage(built.stageRoot, join(options.releaseRoot, ".staging"));
      publication = "IDEMPOTENT_SUCCESS_NO_WRITE";
    } else {
      renameImmutableDirectory(built.stageRoot, built.finalRoot);
      createdFinal = true;
      ownedFinal = finalIdentity(built.finalRoot, built.descriptorSha);
    }
    const finalReadback = exactReadback(built.finalRoot, built.descriptorSha);
    const finalInvocation = runHarness(built.finalRoot, "final");
    if (finalInvocation.conformance_sha256 !==
        built.descriptor.invocation_ledgers.required_final_conformance_sha256) {
      fail("FINAL_INVOCATION_MISMATCH", built.finalRoot);
    }
    const evidence = {
      schema_version: "wasurezu-runtime-release-evidence/v1",
      operation_id: randomUUID(),
      outcome: "FINAL_CAS_PUBLISHED_AND_VERIFIED",
      source,
      descriptor_sha256: built.descriptorSha,
      runtime_root: built.finalRoot,
      publication,
      runtime_tree_sha256: finalReadback.runtime.tree_sha256,
      dist_tree_sha256: finalReadback.dist.tree_sha256,
      candidate_invocation_ledger_sha256: built.candidateInvocation.ledger_sha256,
      final_invocation_ledger_sha256: finalInvocation.ledger_sha256,
      conformance_sha256: finalInvocation.conformance_sha256,
      protected_effects: {
        final_cas_publication: publication === "ATOMIC_RENAME_NEW_CAS" ? 1 : 0,
        fleet_rollout: 0,
        restart: 0,
      },
    };
    writeEvidence(options.evidenceOutput, evidence);
    process.stdout.write(canonicalJson(evidence) + "\n");
  } catch (error) {
    if (createdFinal && ownedFinal !== null) {
      rollbackOwnedFinal(built.finalRoot, built.stageRoot, ownedFinal);
    }
    throw error;
  }
}

function readback(options) {
  const root = join(options.releaseRoot, "sha256", options.releaseSha);
  const report = exactReadback(root, options.releaseSha);
  const invocation = runHarness(root, "readback");
  const output = {
    schema_version: "wasurezu-runtime-release-readback/v1",
    outcome: "PASS_EXACT_READBACK",
    runtime_root: root,
    descriptor_sha256: report.descriptor_sha256,
    source_commit: report.descriptor.source_commit,
    source_tree: report.descriptor.source_tree,
    runtime_tree_sha256: report.runtime.tree_sha256,
    conformance_sha256: invocation.conformance_sha256,
  };
  writeEvidence(options.evidenceOutput, output);
  process.stdout.write(canonicalJson(output) + "\n");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.mode === "candidate") candidate(options);
  else if (options.mode === "publish") publish(options);
  else readback(options);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}
