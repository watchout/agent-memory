#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REPOSITORY = "watchout/agent-memory";
const BASE_COMMIT = "40d91aaa58013048168d68ac0a51326f42e15db5";
const BASE_TREE = "0b6420a58d29e910b249d404840cbed88e9070f9";
const INVALID_RELEASE_SHA256 = "f58fbfe30ac29867fecdb338b294efb02eeb5a4f1688d0bcbf3a48f5a6b13626";
const STAGE_ROOT = "/Users/yuji/Developer/.kusabi-releases/.staging/KUSABI-OBS05-CAS-RESOURCE-CLOSURE-20260805-001-attempt-1";
const RELEASE_PARENT = "/Users/yuji/Developer/.kusabi-releases/sha256";
const INVALID_ROOT = join(RELEASE_PARENT, INVALID_RELEASE_SHA256);
const EVIDENCE_PATH = resolve(".shirube/evidence/KUSABI-ALPHA-OBS05-RUNTIME-RELEASE-V3-20260805.json");
const R0_EVIDENCE_PATH = resolve(".shirube/evidence/KUSABI-ALPHA-OBS05-R0-CANDIDATE-V4-20260805.json");
const PREDECESSOR_R0_PATH = resolve(".shirube/evidence/KUSABI-ALPHA-OBS05-R0-CANDIDATE-V3-20260803.json");
const HARNESS_PATH = resolve("scripts/test-kusabi-content-addressed-runtime-release.mjs");
const CONTROL_HANDOFF_REF = "https://github.com/watchout/agent-memory/issues/285#issuecomment-5187986037";
const CONTROL_HANDOFF_SHA256 = "029fb954fdf0a3cd6f32aa71bff6b8088fd22fa9d3e3d1b78f0e7ae2ef356983";
const A1_REF = "https://github.com/watchout/agent-memory/issues/285#issuecomment-5188144867";
const A1_SHA256 = "90720bc4ca2d74e1d09f86da941f31658f51335013dbb968ba576b38288edf11";
const A2_REF = "https://github.com/watchout/agent-memory/issues/285#issuecomment-5188410390";
const A2_SHA256 = "8d980f227e259ccfa60c4d90e19ee6072671b53b63d2c2ae330783106389ee94";
const OWNER_PLAN_REF = "https://github.com/watchout/agent-memory/issues/285#issuecomment-5187596002";
const PLAN_SHA256 = "9c5a7381ed94bb6a32faee5098d88ea8d0beb49115ec9808023b32918dea936a";
const FROZEN_TARGET_SET_SHA256 = "69be7fb005847676dd8821154508b9764716287226b7560ce274ef499dc1e2ec";
const FROZEN_BATCH_MEMBERSHIP_SHA256 = "8e0f595168507229703ed8bbc6ee8becc01a263c200af99b3c8373c72aff53fb";
const BUILD_COMMANDS = ["npm ci --ignore-scripts", "npm run build"];
const STAGING_DEPENDENCY_COMMAND = "npm ci --omit=dev --ignore-scripts --no-bin-links";

const ENTRYPOINTS = [
  "dist/codex-session-start.js",
  "dist/claude-session-start.js",
  "dist/gemini-session-start.js",
  "dist/raw-capture-service.js",
  "dist/kusabi-fleet-rollout.js",
];

const RESOURCE_REACH = {
  "docs/design/schemas/aun-gate-evidence-refs-v1.schema.json": ["dist/raw-capture-service.js"],
  "docs/design/schemas/claude-session-start-evidence-v1.schema.json": ["dist/claude-session-start.js"],
  "docs/design/schemas/codex-session-start-evidence-v1.schema.json": ["dist/codex-session-start.js"],
  "docs/design/schemas/gemini-session-start-evidence-v1.schema.json": ["dist/gemini-session-start.js"],
  "docs/design/schemas/host-invocation-context-v1.schema.json": [
    "dist/codex-session-start.js",
    "dist/claude-session-start.js",
    "dist/gemini-session-start.js",
  ],
  "docs/design/schemas/kusabi-fleet-rollout-plan-v1.schema.json": ["dist/kusabi-fleet-rollout.js"],
  "docs/design/schemas/kusabi-fleet-status-v1.schema.json": ["dist/kusabi-fleet-status.js"],
  "docs/design/schemas/kusabi-runtime-event-v1.schema.json": ["dist/kusabi-fleet-status.js"],
  "docs/design/schemas/recovery-pack-v1.schema.json": [
    "dist/codex-session-start.js",
    "dist/claude-session-start.js",
    "dist/gemini-session-start.js",
  ],
};

const WRITABLE_PATHS = new Set([
  "scripts/build-kusabi-content-addressed-runtime-release.mjs",
  "scripts/test-kusabi-content-addressed-runtime-release.mjs",
  "package.json",
  ".shirube/control-handoffs/CH-KUSABI-OBS05-CAS-RESOURCE-CLOSURE-20260805-001.yaml",
  ".shirube/evidence/KUSABI-ALPHA-OBS05-RUNTIME-RELEASE-V3-20260805.json",
  ".shirube/evidence/KUSABI-ALPHA-OBS05-R0-CANDIDATE-V4-20260805.json",
  ".shirube/evidence/KUSABI-ALPHA-OBS05-R1-RETRY-20260805.json",
  ".shirube/goal-runs/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.json",
  ".shirube/goal-runs/history/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.generation-3.json",
  ".shirube/execution-goal-bindings/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.kusabi.json",
  ".shirube/work-items/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804/WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE.json",
  ".shirube/work-items/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804/WORK-ITEM-KUSABI-R0-V3-HEARTBEAT-REPRODUCTION.json",
  ".shirube/work-items/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804/WORK-ITEM-KUSABI-POSTIMPLEMENTATION-AUDIT.json",
  ".shirube/work-items/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804/WORK-ITEM-KUSABI-R0-V3-OWNER-GO.json",
  ".shirube/work-items/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804/WORK-ITEM-KUSABI-R1-CANARY-3-OF-3.json",
  ".shirube/work-items/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804/WORK-ITEM-KUSABI-PR281-EXACT-MERGE.json",
  ".shirube/work-items/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804/WORK-ITEM-KUSABI-R0-V3-INDEPENDENT-AUDIT.json",
  ".shirube/work-items/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804/WORK-ITEM-KUSABI-R2-PILOT-11-OF-11.json",
  ".shirube/work-items/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804/WORK-ITEM-KUSABI-R3-FLEET-35-OF-35.json",
  ".shirube/work-items/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804/WORK-ITEM-KUSABI-OBS06-24H-96-CHECKPOINTS.json",
  ".shirube/work-items/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804/WORK-ITEM-KUSABI-FINAL-OWNER-CLOSURE.json",
]);

const ZERO_EFFECTS = {
  network: 0,
  provider: 0,
  trust: 0,
  restart: 0,
  TUI: 0,
  production_database: 0,
  external_send: 0,
  runtime_activation: 0,
};

function fail(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  throw error;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function byteCompare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort(byteCompare)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
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
    fail(options.code ?? "COMMAND_FAILED", `${basename(command)} ${args.join(" ")} exited ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function git(args) {
  return run("git", args, { code: "BASE_OR_HEAD_DRIFT" });
}

function parseArgs(argv) {
  const options = { mode: "candidate", auditRef: null, ownerGoRef: null, hardGateRef: null, expectedReleaseSha: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) fail("ARGUMENT_INVALID", `${arg} requires a value`);
      return value;
    };
    if (arg === "--mode") options.mode = next();
    else if (arg === "--audit-ref") options.auditRef = next();
    else if (arg === "--owner-go-ref") options.ownerGoRef = next();
    else if (arg === "--hard-gate-ref") options.hardGateRef = next();
    else if (arg === "--expected-release-sha") options.expectedReleaseSha = next();
    else fail("ARGUMENT_INVALID", arg);
  }
  if (!["candidate", "r0", "publish", "readback"].includes(options.mode)) fail("ARGUMENT_INVALID", `mode ${options.mode}`);
  return options;
}

function assertNoSymlinkOrSpecial(path, rel) {
  const info = lstatSync(path);
  if (info.isSymbolicLink()) fail("FORBIDDEN_NODE_TYPE", `${rel} -> ${readlinkSync(path)}`);
  if (info.isBlockDevice() || info.isCharacterDevice() || info.isFIFO() || info.isSocket()) fail("FORBIDDEN_NODE_TYPE", rel);
  return info;
}

function treeLedger(root, { excludeRelease = false } = {}) {
  const files = [];
  const directories = [];
  const visit = (absolute, rel) => {
    const info = assertNoSymlinkOrSpecial(absolute, rel || ".");
    if (info.isDirectory()) {
      directories.push({ path: rel || ".", mode: (info.mode & 0o777).toString(8).padStart(4, "0") });
      for (const name of readdirSync(absolute).sort(byteCompare)) visit(join(absolute, name), rel ? `${rel}/${name}` : name);
      return;
    }
    if (!info.isFile()) fail("FORBIDDEN_NODE_TYPE", rel);
    if (excludeRelease && rel === "release.json") return;
    files.push({
      path: rel,
      mode: (info.mode & 0o777).toString(8).padStart(4, "0"),
      bytes: info.size,
      sha256: sha256File(absolute),
    });
  };
  visit(root, "");
  files.sort((a, b) => byteCompare(a.path, b.path));
  directories.sort((a, b) => byteCompare(a.path, b.path));
  const preimage = files.map((entry) => `${entry.path}\t${entry.mode}\t${entry.sha256}\n`).join("");
  return { files, directories, tree_sha256: sha256(preimage), preimage_sha256: sha256(preimage) };
}

function normalizeModes(root) {
  const directories = [];
  const visit = (path) => {
    const info = assertNoSymlinkOrSpecial(path, relative(root, path));
    if (info.isDirectory()) {
      directories.push(path);
      for (const name of readdirSync(path).sort(byteCompare)) visit(join(path, name));
    } else {
      chmodSync(path, 0o444);
    }
  };
  visit(root);
  directories.sort((left, right) => right.length - left.length || byteCompare(right, left));
  for (const path of directories) chmodSync(path, 0o555);
}

function makeWritable(root) {
  if (!existsSync(root)) return;
  const visit = (path) => {
    const info = lstatSync(path);
    if (info.isDirectory()) {
      chmodSync(path, 0o700);
      for (const name of readdirSync(path)) visit(join(path, name));
    } else if (!info.isSymbolicLink()) chmodSync(path, 0o600);
  };
  visit(root);
}

function removeExactStage() {
  if (!existsSync(STAGE_ROOT)) return;
  const expectedParent = `${realpathSync(dirname(STAGE_ROOT))}${sep}`;
  if (resolve(STAGE_ROOT) !== STAGE_ROOT || !STAGE_ROOT.startsWith(expectedParent)) fail("STAGE_CLEANUP_BOUNDARY", STAGE_ROOT);
  makeWritable(STAGE_ROOT);
  rmSync(STAGE_ROOT, { recursive: true, force: false });
}

function statusPaths() {
  const output = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (!output) return [];
  return output.split("\n").map((line) => {
    const raw = line.replace(/^[ MADRCU?!]{1,2} /, "");
    return raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;
  }).sort(byteCompare);
}

function assertSourceBoundary() {
  if (git(["rev-parse", BASE_COMMIT]) !== BASE_COMMIT) fail("BASE_OR_HEAD_DRIFT", "base commit unavailable");
  if (git(["rev-parse", `${BASE_COMMIT}^{tree}`]) !== BASE_TREE) fail("BASE_OR_HEAD_DRIFT", "base tree mismatch");
  if (git(["rev-parse", "HEAD"]) !== BASE_COMMIT) fail("BASE_OR_HEAD_DRIFT", "candidate must be assembled before the implementation commit");
  const productDiff = git(["diff", "--name-only", BASE_COMMIT, "--", "src", "package-lock.json", "docs/design/schemas"]);
  if (productDiff) fail("PATH_SCOPE_VIOLATION", productDiff.replaceAll("\n", ","));
  const unauthorized = statusPaths().filter((path) => !WRITABLE_PATHS.has(path));
  if (unauthorized.length) fail("PATH_SCOPE_VIOLATION", unauthorized.join(","));
  if (!existsSync(INVALID_ROOT) || realpathSync(INVALID_ROOT) !== INVALID_ROOT) fail("BASE_OR_HEAD_DRIFT", "invalid historical CAS missing or redirected");
}

function dependencyInventory(root, sourceLock) {
  const installedLockPath = join(root, "node_modules", ".package-lock.json");
  if (!existsSync(installedLockPath)) fail("DEPENDENCY_LEDGER_MISMATCH", "installed package lock absent");
  const installedLock = JSON.parse(readFileSync(installedLockPath, "utf8"));
  const locations = Object.keys(installedLock.packages ?? {}).filter((path) => path.startsWith("node_modules/")).sort(byteCompare);
  const rows = [];
  const defects = [];
  for (const location of locations) {
    const installed = installedLock.packages[location];
    const locked = sourceLock.packages?.[location];
    const packagePath = join(root, location, "package.json");
    if (!locked) defects.push(`extraneous:${location}`);
    else if (locked.dev) defects.push(`dev:${location}`);
    else if (!existsSync(packagePath)) defects.push(`package-json:${location}`);
    else {
      const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
      if (pkg.version !== locked.version || installed.version !== locked.version) defects.push(`version:${location}`);
      if (!locked.integrity || installed.integrity !== locked.integrity) defects.push(`integrity:${location}`);
      rows.push({ name: pkg.name, version: locked.version, integrity: locked.integrity, resolved_relative_location: location });
    }
  }
  const required = Object.entries(sourceLock.packages ?? {})
    .filter(([path, value]) => path.startsWith("node_modules/") && !value.dev && !value.optional)
    .map(([path]) => path).sort(byteCompare);
  for (const path of required) if (!locations.includes(path)) defects.push(`missing:${path}`);
  const npmLs = JSON.parse(run("npm", ["ls", "--omit=dev", "--all", "--json"], { cwd: root, code: "DEPENDENCY_LEDGER_MISMATCH" }));
  if (npmLs.problems?.length) defects.push(...npmLs.problems.map((value) => `npm-ls:${value}`));
  if (defects.length) fail("DEPENDENCY_LEDGER_MISMATCH", defects.join(","));
  rows.sort((a, b) => byteCompare(a.resolved_relative_location, b.resolved_relative_location));
  return {
    rows,
    canonical_sha256: sha256(canonicalJson(rows)),
    installed_count: rows.length,
    required_non_optional_count: required.length,
    extraneous_missing_invalid_count: 0,
    npm_ls_problem_count: 0,
  };
}

function entrypointMap(root) {
  const result = {};
  for (const path of ENTRYPOINTS) {
    const absolute = join(root, path);
    if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink() || !statSync(absolute).isFile()) {
      fail("REQUIRED_ENTRYPOINT_MISSING", path);
    }
    result[path] = sha256File(absolute);
  }
  return result;
}

function fixtureToReach(fixture) {
  if (fixture.includes("CODEX")) return ["dist/codex-session-start.js"];
  if (fixture.includes("CLAUDE")) return ["dist/claude-session-start.js"];
  if (fixture.includes("GEMINI")) return ["dist/gemini-session-start.js"];
  if (fixture.includes("FLEET-STATUS")) return ["dist/kusabi-fleet-status.js"];
  if (fixture.includes("RAW-CAPTURE")) return ["dist/raw-capture-service.js"];
  if (fixture.includes("ROLLOUT")) return ["dist/kusabi-fleet-rollout.js"];
  if (fixture.startsWith("IMPORT:")) return [fixture.slice("IMPORT:".length)];
  return [];
}

function resourceLedger(root, invocation) {
  const dynamic = invocation.dynamic_resource_reach ?? {};
  const resourcePaths = [...new Set([...Object.keys(RESOURCE_REACH), ...Object.keys(dynamic)])].sort(byteCompare);
  const entries = resourcePaths.map((path) => {
    const declaredReach = RESOURCE_REACH[path] ?? [];
    const absolute = join(root, path);
    if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink() || !statSync(absolute).isFile()) fail("RUNTIME_RESOURCE_MISSING", path);
    const dynamicReach = (dynamic[path] ?? []).flatMap(fixtureToReach);
    return {
      path,
      mode: (lstatSync(absolute).mode & 0o777).toString(8).padStart(4, "0"),
      bytes: statSync(absolute).size,
      sha256: sha256File(absolute),
      resource_kind: path.startsWith("docs/design/schemas/") ? "tracked_json_schema"
        : path.endsWith(".wasm") ? "production_dependency_wasm"
          : path.endsWith("package.json") || path.endsWith("package-lock.json") ? "package_metadata"
            : "runtime_opened_file",
      entrypoint_reach: [...new Set([...declaredReach, ...dynamicReach])].sort(byteCompare),
    };
  }).sort((a, b) => byteCompare(a.path, b.path));
  for (const entry of entries) if (entry.mode !== "0444") fail("RUNTIME_RESOURCE_MODE_MISMATCH", `${entry.path}:${entry.mode}`);
  const unresolved = Object.keys(dynamic).filter((path) =>
    !path.startsWith("dist/") && !path.startsWith("node_modules/") &&
    path !== "package.json" && path !== "package-lock.json" && !RESOURCE_REACH[path]);
  if (unresolved.length) fail("RUNTIME_RESOURCE_MISSING", `unregistered dynamic resources: ${unresolved.join(",")}`);
  const treePreimage = entries.map((entry) => `${entry.path}\t${entry.mode}\t${entry.sha256}\n`).join("");
  const entrypointMap = {};
  for (const entry of entries) for (const entrypoint of entry.entrypoint_reach) (entrypointMap[entrypoint] ??= []).push(entry.path);
  for (const paths of Object.values(entrypointMap)) paths.sort(byteCompare);
  const ledgerCore = {
    schema_version: "kusabi-runtime-resource-ledger/v1",
    entries,
    resource_tree_sha256: sha256(treePreimage),
    entrypoint_to_resource_map: entrypointMap,
    entrypoint_to_resource_map_sha256: sha256(canonicalJson(entrypointMap)),
    unresolved_path_count: 0,
    worktree_fallback_count: 0,
  };
  return { ...ledgerCore, ledger_sha256: sha256(canonicalJson(ledgerCore)) };
}

function runHarness(root, phase) {
  const output = run(process.execPath, [HARNESS_PATH, "--root", root, "--phase", phase, "--fixture", "all", "--timeout-ms", "10000"], {
    cwd: process.cwd(),
    timeout: 180_000,
    code: "RUNTIME_RESOURCE_MISSING",
  });
  const ledger = JSON.parse(output);
  if (ledger.unresolved_path_count !== 0 || ledger.worktree_fallback_count !== 0) fail("RUNTIME_RESOURCE_MISSING", "harness fallback or unresolved path");
  if (Object.values(ledger.forbidden_effect_counts ?? {}).some((value) => value !== 0)) fail("PROTECTED_EFFECT_DETECTED", "invocation harness");
  return ledger;
}

function assertRootBoundary(root) {
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() || !statSync(root).isDirectory()) fail("FULL_READBACK_MISMATCH", root);
  if (realpathSync(root) !== root) fail("FULL_READBACK_MISMATCH", `${root} resolves elsewhere`);
}

function exactReadback(root, descriptorSha) {
  assertRootBoundary(root);
  const descriptorBytes = readFileSync(join(root, "release.json"));
  if (sha256(descriptorBytes) !== descriptorSha) fail("FULL_READBACK_MISMATCH", "release.json digest");
  const descriptor = JSON.parse(descriptorBytes);
  if (canonicalJson(descriptor) !== descriptorBytes.toString("utf8")) fail("DESCRIPTOR_CANONICALIZATION_MISMATCH", "release.json");
  const runtime = treeLedger(root, { excludeRelease: true });
  if (runtime.tree_sha256 !== descriptor.runtime_tree_sha256) fail("FULL_READBACK_MISMATCH", "runtime tree");
  const dist = treeLedger(join(root, "dist"));
  if (dist.tree_sha256 !== descriptor.dist_tree_sha256) fail("FULL_READBACK_MISMATCH", "dist tree");
  const entries = entrypointMap(root);
  if (canonicalJson(entries) !== canonicalJson(descriptor.required_entrypoint_sha256_map)) fail("FULL_READBACK_MISMATCH", "entrypoint map");
  const sourceLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const dependencies = dependencyInventory(root, sourceLock);
  if (dependencies.canonical_sha256 !== descriptor.production_dependency_inventory_sha256) fail("FULL_READBACK_MISMATCH", "dependency inventory");
  const resources = resourceLedger(root, { dynamic_resource_reach: descriptor.runtime_resource_ledger.entrypoint_fixture_reach });
  if (resources.ledger_sha256 !== descriptor.runtime_resource_ledger.ledger_sha256) fail("FULL_READBACK_MISMATCH", "resource ledger");
  return { descriptor, runtime, dist, entries, dependencies, resources, descriptor_sha256: descriptorSha };
}

function writeEvidence(document) {
  const payload = structuredClone(document);
  delete payload.evidence_payload_sha256;
  document.evidence_payload_sha256 = sha256(canonicalJson(payload));
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o644 });
}

function candidate() {
  assertSourceBoundary();
  if (existsSync(STAGE_ROOT)) fail("STAGING_ROOT_PREEXISTS", STAGE_ROOT);
  const stageParent = dirname(STAGE_ROOT);
  if (!existsSync(stageParent)) mkdirSync(stageParent, { mode: 0o755 });
  if (lstatSync(stageParent).isSymbolicLink() || !statSync(stageParent).isDirectory() || realpathSync(stageParent) !== stageParent) {
    fail("STAGING_ROOT_PREEXISTS", "staging parent invalid");
  }
  if (!existsSync(RELEASE_PARENT) || realpathSync(RELEASE_PARENT) !== RELEASE_PARENT) fail("CAS_FINAL_COLLISION", "release parent invalid");
  const invalidBefore = treeLedger(INVALID_ROOT);
  let created = false;
  try {
    run("npm", ["ci", "--ignore-scripts"], { code: "CLEAN_BUILD_FAILED", timeout: 180_000 });
    run("npm", ["run", "build"], { code: "CLEAN_BUILD_FAILED", timeout: 180_000 });
    mkdirSync(STAGE_ROOT, { mode: 0o700 });
    created = true;
    cpSync(resolve("dist"), join(STAGE_ROOT, "dist"), { recursive: true, dereference: false, errorOnExist: true });
    copyFileSync(resolve("package.json"), join(STAGE_ROOT, "package.json"));
    copyFileSync(resolve("package-lock.json"), join(STAGE_ROOT, "package-lock.json"));
    for (const path of Object.keys(RESOURCE_REACH)) {
      const target = join(STAGE_ROOT, path);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      copyFileSync(resolve(path), target);
    }
    run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-bin-links"], {
      cwd: STAGE_ROOT,
      timeout: 180_000,
      code: "DEPENDENCY_LEDGER_MISMATCH",
    });
    normalizeModes(STAGE_ROOT);
    const invocation = runHarness(STAGE_ROOT, "candidate");
    const sourceLock = JSON.parse(readFileSync(resolve("package-lock.json"), "utf8"));
    const dependencies = dependencyInventory(STAGE_ROOT, sourceLock);
    const runtime = treeLedger(STAGE_ROOT, { excludeRelease: true });
    const dist = treeLedger(join(STAGE_ROOT, "dist"));
    const entrypoints = entrypointMap(STAGE_ROOT);
    const resources = resourceLedger(STAGE_ROOT, invocation);
    const descriptor = {
      schema_version: "kusabi-content-addressed-runtime-release/v3",
      repository: REPOSITORY,
      source_commit: BASE_COMMIT,
      source_tree: BASE_TREE,
      dist_tree_sha256: dist.tree_sha256,
      package_metadata: {
        package_json_sha256: sha256File(resolve("package.json")),
        package_lock_sha256: sha256File(resolve("package-lock.json")),
      },
      production_dependency_inventory_sha256: dependencies.canonical_sha256,
      runtime_resource_ledger: {
        ledger_sha256: resources.ledger_sha256,
        resource_tree_sha256: resources.resource_tree_sha256,
        entrypoint_to_resource_map_sha256: resources.entrypoint_to_resource_map_sha256,
        entrypoint_fixture_reach: invocation.dynamic_resource_reach,
        unresolved_path_count: 0,
        worktree_fallback_count: 0,
      },
      required_entrypoint_sha256_map: entrypoints,
      runtime_tree_sha256: runtime.tree_sha256,
      invocation_ledgers: {
        candidate_ledger_sha256: invocation.ledger_sha256,
        candidate_conformance_sha256: invocation.conformance_sha256,
        required_final_conformance_sha256: invocation.conformance_sha256,
      },
      invocation_harness_sha256: sha256File(HARNESS_PATH),
      normalized_file_mode: "0444",
      normalized_directory_mode: "0555",
      build_commands: BUILD_COMMANDS,
      staging_dependency_command: STAGING_DEPENDENCY_COMMAND,
      node_version: process.version,
      npm_version: run("npm", ["--version"]),
      platform: `${process.platform}-${process.arch}`,
    };
    const descriptorBytes = canonicalJson(descriptor);
    const descriptorSha = sha256(descriptorBytes);
    const finalRoot = join(RELEASE_PARENT, descriptorSha);
    if (descriptorSha === INVALID_RELEASE_SHA256 || finalRoot === INVALID_ROOT) fail("CAS_FINAL_COLLISION", "successor aliases invalid historical CAS");
    if (existsSync(finalRoot)) fail("CAS_FINAL_COLLISION", `candidate final already exists: ${finalRoot}`);
    chmodSync(STAGE_ROOT, 0o755);
    writeFileSync(join(STAGE_ROOT, "release.json"), descriptorBytes, { flag: "wx", mode: 0o444 });
    chmodSync(STAGE_ROOT, 0o555);
    const readback = exactReadback(STAGE_ROOT, descriptorSha);
    const invalidAfter = treeLedger(INVALID_ROOT);
    if (invalidAfter.tree_sha256 !== invalidBefore.tree_sha256 || canonicalJson(invalidAfter) !== canonicalJson(invalidBefore)) {
      fail("INVALID_HISTORICAL_CAS_MUTATION", INVALID_ROOT);
    }
    writeEvidence({
      schema_version: "kusabi-content-addressed-runtime-release-evidence/v1",
      lifecycle_state: "CANDIDATE_VERIFIED_AWAITING_INDEPENDENT_GATES",
      control_source: {
        plan_ref: "https://github.com/watchout/agent-memory/issues/285",
        plan_body_sha256: PLAN_SHA256,
        owner_plan_approval_ref: OWNER_PLAN_REF,
        control_handoff_ref: CONTROL_HANDOFF_REF,
        control_handoff_body_sha256_with_trailing_lf: CONTROL_HANDOFF_SHA256,
        readonly_resource_addendum_ref: A1_REF,
        readonly_resource_addendum_sha256: A1_SHA256,
        writable_allowlist_addendum_ref: A2_REF,
        writable_allowlist_addendum_sha256: A2_SHA256,
      },
      build: {
        source_root: process.cwd(),
        source_commit: BASE_COMMIT,
        source_tree_sha256: BASE_TREE,
        source_status_before_install: "AUTHORIZED_CONTROL_DIFF_ONLY",
        product_source_diff: "CLEAN",
        package_lock_sha256: sha256File(resolve("package-lock.json")),
        node_version: process.version,
        npm_version: descriptor.npm_version,
        commands: BUILD_COMMANDS,
        staging_dependency_command: STAGING_DEPENDENCY_COMMAND,
      },
      release: {
        stage_root: STAGE_ROOT,
        proposed_final_root: finalRoot,
        release_descriptor_sha256: descriptorSha,
        release_json_file_sha256: descriptorSha,
        descriptor,
        runtime_tree_sha256: runtime.tree_sha256,
        dist_tree_sha256: dist.tree_sha256,
        production_dependency_inventory_sha256: dependencies.canonical_sha256,
        production_dependency_inventory: dependencies,
        runtime_resource_ledger: resources,
        candidate_invocation_ledger: invocation,
        final_invocation_ledger: null,
        complete_runtime_path_mode_sha256_ledger: runtime,
        required_entrypoint_readback: Object.fromEntries(Object.entries(entrypoints).map(([path, digest]) => [path, {
          mode: "0444", expected_sha256: digest, actual_sha256: readback.entries[path], verdict: digest === readback.entries[path] ? "PASS" : "FAIL",
        }])),
        normalized_file_mode: "0444",
        normalized_directory_mode: "0555",
        publication: {
          status: "NOT_ATTEMPTED_INDEPENDENT_AUDIT_OWNER_GO_HARD_GATE_REQUIRED",
          initial: null,
          final_conformance_readback: null,
        },
      },
      invalid_historical_release: {
        root: INVALID_ROOT,
        before_tree_sha256: invalidBefore.tree_sha256,
        after_tree_sha256: invalidAfter.tree_sha256,
        mutation_count: 0,
      },
      protected_effects: { ...ZERO_EFFECTS, final_CAS_publication: 0 },
      gate_result: {
        verdict: "PASS_CANDIDATE_RESOURCE_AND_INVOCATION_READBACK",
        blocker_count: 0,
        protected_effect_count: 0,
        final_publication_authorized: false,
      },
      next_action: {
        blocking: true,
        actor_agent_id: "codex-audit",
        active_function: "evidence_audit_gate",
        action: "Independently audit the exact Draft head/tree, candidate stage, descriptor, resource ledger, invocation ledger, and zero-effect evidence.",
        deliver_via: "Immutable Draft PR comment and Issue 285 receipt",
        exact_input_refs: [A2_REF, `release:sha256:${descriptorSha}`, `file:${relative(process.cwd(), EVIDENCE_PATH)}`],
        scope: "Read-only exact-subject audit; no implementation or runtime mutation.",
        deliverable: "PASS with blocker_count 0, or typed findings bound to the exact subject.",
        completion_evidence: "Immutable audit URL and exact audited head/tree/release tuple.",
      },
    });
    process.stdout.write(`${JSON.stringify({ verdict: "PASS_CANDIDATE", descriptor_sha256: descriptorSha, stage_root: STAGE_ROOT, proposed_final_root: finalRoot, evidence_path: EVIDENCE_PATH })}\n`);
    created = false;
  } finally {
    if (created) removeExactStage();
  }
}

function trustSource(host) {
  if (host === "codex") return { kind: "codex_hook_state", config_toml: "/Users/yuji/.codex/config.toml" };
  if (host === "claude_code") return { kind: "claude_project_state", claude_state_json: "/Users/yuji/.claude.json" };
  return {
    kind: "gemini_hook_state",
    trusted_folders_json: "/Users/yuji/.gemini/trustedFolders.json",
    trusted_hooks_json: "/Users/yuji/.gemini/trusted_hooks.json",
  };
}

function workspaceRows() {
  const sql = String.raw`
    SELECT COALESCE(json_agg(json_build_object(
      'agent_id', a.agent_id,
      'project', aw.name,
      'local_path', aw.local_path
    ) ORDER BY a.agent_id), '[]'::json)::text
    FROM agents a
    JOIN agent_workspace_bindings awb
      ON awb.agent_id = a.agent_id AND awb.binding_role = 'primary' AND awb.active = true
    JOIN agent_workspaces aw ON aw.workspace_id = awb.workspace_id
    WHERE a.agent_type <> 'human'
      AND a.agent_id <> 'pdca-ops'
      AND a.disabled_at IS NULL
      AND COALESCE(a.profile_enabled, true) = true
      AND a.runtime_engine_preference IN ('codex', 'claude-code')
      AND a.home_directory LIKE '/Users/yuji/Developer/%'
      AND a.agent_id !~ '(^__|test|ephemeral)';
  `;
  const rows = JSON.parse(run("psql", [
    "postgresql:///agent_comms?host=/tmp", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql,
  ], { code: "R0_INVENTORY_READ_FAILED" }));
  if (rows.length !== 33) fail("R0_FROZEN_TOPOLOGY_DRIFT", `primary workspace count ${rows.length}`);
  return rows;
}

function targetSetSha(result) {
  const keys = result.manifest.targets.map(({ target_key }) => target_key).sort(byteCompare);
  return sha256(`${keys.join("\n")}\n`);
}

function membershipSha(result) {
  const preimage = result.rollout_plan.batches.flatMap((batch) =>
    batch.target_keys.map((targetKey) => `${batch.batch_id}\t${batch.stage}\t${batch.ordinal}\t${targetKey}\n`)).join("");
  return sha256(preimage);
}

function assertFreshWindow(window, ownerGoCreatedAt = null) {
  const generatedA = Date.parse(window.capture_a_generated_at);
  const generatedB = Date.parse(window.capture_b_generated_at);
  const activation = Date.parse(window.activation_at);
  const planned = Date.parse(window.planned_R1_start_at);
  const deadline = Date.parse(window.durable_evidence_deadline_at);
  const margin = window.declared_margin_seconds * 1000;
  if (![generatedA, generatedB, activation, planned, deadline].every(Number.isFinite) ||
      generatedA >= activation || generatedB >= activation || planned < activation || planned >= deadline ||
      deadline - planned < margin || (ownerGoCreatedAt !== null && Date.parse(ownerGoCreatedAt) >= activation)) {
    fail("ROLLOUT_WINDOW_STALE", canonicalJson(window));
  }
}

function staleWindowFixture() {
  const timestamp = "2026-08-05T00:00:00.000Z";
  try {
    assertFreshWindow({
      capture_a_generated_at: timestamp,
      capture_b_generated_at: timestamp,
      activation_at: timestamp,
      planned_R1_start_at: timestamp,
      durable_evidence_deadline_at: timestamp,
      declared_margin_seconds: 1,
    });
  } catch (error) {
    if (error.code === "ROLLOUT_WINDOW_STALE") return { fixture_id: "FIX-CAS-STALE-WINDOW", expected: "ROLLOUT_WINDOW_STALE", verdict: "PASS" };
    throw error;
  }
  fail("NEGATIVE_FIXTURE_FALSE_PASS", "FIX-CAS-STALE-WINDOW");
}

function comparePreimages(current, predecessor) {
  const fields = [
    "host_runtime", "batch_id", "config_locator_sha256", "preimage_state", "preimage_sha256", "preimage_mode",
    "trust_source_locator_sha256", "preimage_trust_fingerprint_sha256", "preimage_trust_exact", "rollback_required",
  ];
  const previous = new Map(predecessor.report.targets.map((target) => [target.target_key, target]));
  const rows = current.report.targets.map((target) => {
    const frozen = previous.get(target.target_key);
    return { target_key: target.target_key, exact: Boolean(frozen && fields.every((field) => frozen[field] === target[field])) };
  });
  return { rows, exact_count: rows.filter(({ exact }) => exact).length, total_count: rows.length };
}

async function buildR0Capture({ label, observedAt, logicalCapturedAt, temporal, predecessor, releaseEvidence, inventory, targets, fleet }) {
  const result = await fleet.prepareKusabiFleetR0({
    manifest_id: "kusabi-alpha-obs05-fleet-20260805-v4-candidate",
    manifest_version: 4,
    rollout_id: "kusabi-alpha-obs05-rollout-20260805-v4-candidate",
    runtime_root: STAGE_ROOT,
    commit_sha: BASE_COMMIT,
    tree_sha: BASE_TREE,
    activation_at: temporal.activation_at,
    durable_evidence_deadline_at: temporal.durable_evidence_deadline_at,
    stale_after_seconds: predecessor.capture_b.result.manifest.targets[0].stale_after_seconds,
    captured_at: logicalCapturedAt,
    batch_order: predecessor.capture_b.result.rollout_plan.batches.map(({ batch_id, stage, ordinal, minimum_soak_seconds }) =>
      ({ batch_id, stage, ordinal, minimum_soak_seconds })),
    inventory_snapshot: inventory,
    targets,
  });
  const payload = {
    schema_version: "kusabi-fleet-r0-preflight-capture/v4",
    capture_label: label,
    database_observed_at: observedAt,
    logical_snapshot_captured_at: logicalCapturedAt,
    release_descriptor_sha256: releaseEvidence.release.release_descriptor_sha256,
    runtime_locator_phase: "candidate_stage",
    primary_workspace_row_count: 33,
    result,
  };
  return { ...payload, internal_digest_sha256: sha256(canonicalJson(payload)) };
}

async function r0Candidate() {
  assertSourceBoundary();
  if (!existsSync(EVIDENCE_PATH) || !existsSync(PREDECESSOR_R0_PATH)) fail("R0_INPUT_MISSING", "release or predecessor evidence");
  const releaseEvidence = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8"));
  const descriptorSha = releaseEvidence.release?.release_descriptor_sha256;
  const readback = exactReadback(STAGE_ROOT, descriptorSha);
  const predecessor = JSON.parse(readFileSync(PREDECESSOR_R0_PATH, "utf8"));
  const fleet = await import(`${pathToFileURL(resolve("dist/kusabi-fleet-rollout.js")).href}?r0=${Date.now()}`);
  const rows = workspaceRows();
  const workspaceByIdentity = new Map(rows.map((row) => [`${row.agent_id}\n${row.project}`, row.local_path]));
  const stableRefs = new Map(predecessor.capture_b.stable_binding_refs.map((item) => [item.target_key, item]));
  const previousEvidence = new Map(predecessor.capture_b.result.report.targets.map((item) => [item.target_key, item]));
  const targets = predecessor.capture_b.result.manifest.targets.map((target) => {
    const workspaceInput = workspaceByIdentity.get(`${target.identity.agent_id}\n${target.identity.project}`);
    if (!workspaceInput) fail("R0_FROZEN_IDENTITY_DRIFT", target.target_key);
    const workspace = realpathSync(workspaceInput);
    if (sha256(workspace) !== target.identity.workspace_sha256) fail("R0_FROZEN_IDENTITY_DRIFT", `${target.target_key}:workspace`);
    const stable = stableRefs.get(target.target_key);
    const stageEvidence = previousEvidence.get(target.target_key);
    if (!stable || !stageEvidence) fail("R0_FROZEN_IDENTITY_DRIFT", `${target.target_key}:binding`);
    const bindingSourceRef = JSON.stringify(stable.ref_payload);
    if (sha256(bindingSourceRef) !== target.expected.configuration.binding_source_ref_sha256) {
      fail("R0_FROZEN_IDENTITY_DRIFT", `${target.target_key}:binding-source-ref`);
    }
    return {
      agent_id: target.identity.agent_id,
      project: target.identity.project,
      host_runtime: target.identity.host_runtime,
      workspace,
      binding_source_ref: bindingSourceRef,
      storage: target.expected.storage,
      trust_source: trustSource(target.identity.host_runtime),
      stage: stageEvidence.batch_id.startsWith("r1-") ? "r1" : stageEvidence.batch_id.startsWith("r2-") ? "r2" : "r3",
      batch_id: stageEvidence.batch_id,
    };
  });
  const logicalCapturedAt = new Date().toISOString();
  const inventoryWithoutSha = structuredClone(predecessor.capture_b.result.inventory_snapshot);
  delete inventoryWithoutSha.snapshot_sha256;
  inventoryWithoutSha.source.captured_at = logicalCapturedAt;
  const inventory = fleet.sealKusabiFleetInventorySnapshot(inventoryWithoutSha);
  const generatedAtA = new Date().toISOString();
  const activation = new Date(Date.parse(generatedAtA) + 90 * 60 * 1000);
  const planned = new Date(activation.getTime() + 5 * 60 * 1000);
  const deadline = new Date(planned.getTime() + 6 * 60 * 60 * 1000);
  const captureA = await buildR0Capture({
    label: "A", observedAt: generatedAtA, logicalCapturedAt, predecessor, releaseEvidence, inventory, targets, fleet,
    temporal: { activation_at: activation.toISOString(), durable_evidence_deadline_at: deadline.toISOString() },
  });
  let observedB = new Date().toISOString();
  while (observedB === generatedAtA) observedB = new Date().toISOString();
  const captureB = await buildR0Capture({
    label: "B", observedAt: observedB, logicalCapturedAt, predecessor, releaseEvidence, inventory, targets, fleet,
    temporal: { activation_at: activation.toISOString(), durable_evidence_deadline_at: deadline.toISOString() },
  });
  const temporalWindow = {
    capture_a_generated_at: generatedAtA,
    capture_b_generated_at: observedB,
    activation_at: activation.toISOString(),
    planned_R1_start_at: planned.toISOString(),
    durable_evidence_deadline_at: deadline.toISOString(),
    declared_margin_seconds: 21_600,
    owner_go_created_at: null,
  };
  assertFreshWindow(temporalWindow);
  const aResult = captureA.result;
  const bResult = captureB.result;
  const targetDigestA = targetSetSha(aResult);
  const targetDigestB = targetSetSha(bResult);
  const membershipA = membershipSha(aResult);
  const membershipB = membershipSha(bResult);
  const preimagesA = comparePreimages(aResult, predecessor.capture_b.result);
  const preimagesB = comparePreimages(bResult, predecessor.capture_b.result);
  const stageCounts = Object.fromEntries(["r1", "r2", "r3"].map((stage) => [stage,
    bResult.rollout_plan.batches.filter((batch) => batch.stage === stage).reduce((sum, batch) => sum + batch.target_keys.length, 0),
  ]));
  const equalityEntries = {
    canonical_result_A_equals_B: canonicalJson(aResult) === canonicalJson(bResult),
    target_set_A_equals_B_equals_frozen: targetDigestA === FROZEN_TARGET_SET_SHA256 && targetDigestB === FROZEN_TARGET_SET_SHA256,
    ordered_membership_A_equals_B_equals_frozen: membershipA === FROZEN_BATCH_MEMBERSHIP_SHA256 && membershipB === FROZEN_BATCH_MEMBERSHIP_SHA256,
    rollback_preimages_A_equals_frozen_35_of_35: preimagesA.exact_count === 35 && preimagesA.total_count === 35,
    rollback_preimages_B_equals_frozen_35_of_35: preimagesB.exact_count === 35 && preimagesB.total_count === 35,
    topology_A_equals_B_35_and_3_11_21: aResult.manifest.targets.length === 35 && bResult.manifest.targets.length === 35 &&
      stageCounts.r1 === 3 && stageCounts.r2 === 11 && stageCounts.r3 === 21,
    release_descriptor_A_equals_B: captureA.release_descriptor_sha256 === descriptorSha && captureB.release_descriptor_sha256 === descriptorSha,
    temporal_tuple_A_equals_B: aResult.manifest.targets.every((target) =>
      target.activation_at === temporalWindow.activation_at && target.durable_evidence_deadline_at === temporalWindow.durable_evidence_deadline_at) &&
      bResult.manifest.targets.every((target) =>
        target.activation_at === temporalWindow.activation_at && target.durable_evidence_deadline_at === temporalWindow.durable_evidence_deadline_at),
  };
  if (!Object.values(equalityEntries).every(Boolean)) fail("R0_EQUALITY_MATRIX_BLOCK", canonicalJson(equalityEntries));
  const payload = {
    schema_version: "kusabi-fleet-r0-candidate-pack/v3",
    lifecycle_version: 4,
    lifecycle_state: "FRESH_CANDIDATE_A_B_AWAITING_INDEPENDENT_GATES",
    control_source: {
      plan_ref: "https://github.com/watchout/agent-memory/issues/285",
      plan_body_sha256: PLAN_SHA256,
      control_handoff_ref: CONTROL_HANDOFF_REF,
      readonly_resource_addendum_ref: A1_REF,
      writable_allowlist_addendum_ref: A2_REF,
    },
    exact_subject: {
      source_commit: BASE_COMMIT,
      source_tree: BASE_TREE,
      release_descriptor_sha256: descriptorSha,
      runtime_tree_sha256: readback.runtime.tree_sha256,
      resource_ledger_sha256: readback.resources.ledger_sha256,
      production_dependency_inventory_sha256: readback.dependencies.canonical_sha256,
      candidate_invocation_conformance_sha256: releaseEvidence.release.candidate_invocation_ledger.conformance_sha256,
      runtime_locator_phase: "candidate_stage",
      proposed_final_root: releaseEvidence.release.proposed_final_root,
    },
    temporal_window: temporalWindow,
    stale_window_negative_fixture: staleWindowFixture(),
    capture_a: captureA,
    capture_b: captureB,
    equality_matrix: {
      entries: equalityEntries,
      pass_count: Object.values(equalityEntries).filter(Boolean).length,
      total_count: Object.keys(equalityEntries).length,
      verdict: "PASS",
    },
    canonical_result: bResult,
    topology: {
      target_count: 35,
      primary_binding_count: inventory.primary_binding_count,
      approved_secondary_binding_count: inventory.secondary_binding_count,
      stage_counts: stageCounts,
      sorted_target_keys_lf_sha256: targetDigestB,
      ordered_batch_membership_tsv_sha256: membershipB,
      rollback_preimage_match_count: preimagesB.exact_count,
    },
    predecessor_heartbeat_partition: {
      evidence_ref: `file:${relative(process.cwd(), PREDECESSOR_R0_PATH)}`,
      verdict: predecessor.heartbeat_separation.verdict,
      identity_partition_only: true,
      current_runtime_authority: false,
    },
    storage_groups: predecessor.storage_groups,
    protected_effects: {
      production_configuration_writes: 0,
      production_trust_writes: 0,
      database_writes: 0,
      runtime_or_supervisor_actions: 0,
      restarts_or_session_triggers: 0,
      TUI_actions: 0,
      provider_or_external_sends: 0,
      final_CAS_publication: 0,
      R1_R2_R3_actions: 0,
    },
    gate_result: {
      verdict: "PASS_FRESH_R0_A_B_TEMPORAL_CANDIDATE",
      blocker_count: 0,
      independent_audit_required: true,
      owner_go_required_after_audit: true,
      hard_gate_required_after_owner_go: true,
      final_R0_regeneration_after_CAS_publication_required: true,
      R1_authorized: false,
    },
    next_action: {
      blocking: true,
      actor_agent_id: "codex-audit",
      active_function: "evidence_audit_gate",
      action: "Audit the exact Draft head/tree, release candidate, invocation/resource ledgers, fresh R0 A/B equality, temporal window, and zero-effect evidence.",
      deliver_via: "Immutable Draft PR comment and Issue 285 receipt",
      exact_input_refs: [A2_REF, `release:sha256:${descriptorSha}`, `file:${relative(process.cwd(), R0_EVIDENCE_PATH)}`],
      scope: "Read-only exact-subject audit; no implementation, owner decision, publication, or rollout.",
      deliverable: "PASS with blocker_count 0, or typed exact-subject findings.",
      completion_evidence: "Immutable audit URL binding Draft head/tree, release, R0, target set, membership, and temporal tuple.",
    },
  };
  const document = { ...payload, evidence_payload_sha256: sha256(canonicalJson(payload)) };
  writeFileSync(R0_EVIDENCE_PATH, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o644 });
  process.stdout.write(`${JSON.stringify({
    verdict: "PASS_R0_CANDIDATE",
    evidence_path: R0_EVIDENCE_PATH,
    manifest_sha256: bResult.manifest.manifest_sha256,
    rollout_plan_sha256: bResult.rollout_plan.rollout_plan_sha256,
    target_set_sha256: targetDigestB,
    membership_sha256: membershipB,
    activation_at: temporalWindow.activation_at,
    planned_R1_start_at: temporalWindow.planned_R1_start_at,
    deadline_at: temporalWindow.durable_evidence_deadline_at,
  })}\n`);
}

function publish(options) {
  for (const [name, value] of [["audit", options.auditRef], ["owner GO", options.ownerGoRef], ["hard gate", options.hardGateRef], ["release SHA", options.expectedReleaseSha]]) {
    if (!value) fail("EXACT_GATE_FAILURE", `${name} input missing`);
  }
  if (!existsSync(EVIDENCE_PATH)) fail("EXACT_GATE_FAILURE", "candidate evidence missing");
  const evidence = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8"));
  const descriptorSha = evidence.release?.release_descriptor_sha256;
  if (descriptorSha !== options.expectedReleaseSha) fail("BASE_OR_HEAD_DRIFT", "release SHA does not match candidate evidence");
  const candidate = exactReadback(STAGE_ROOT, descriptorSha);
  const finalRoot = join(RELEASE_PARENT, descriptorSha);
  let publication;
  if (existsSync(finalRoot)) {
    const existing = exactReadback(finalRoot, descriptorSha);
    if (canonicalJson(existing.runtime) !== canonicalJson(candidate.runtime)) fail("CAS_FINAL_COLLISION", finalRoot);
    removeExactStage();
    publication = "IDEMPOTENT_SUCCESS_NO_WRITE";
  } else {
    renameSync(STAGE_ROOT, finalRoot);
    publication = "ATOMIC_RENAME_NEW_CAS";
  }
  const finalReadback = exactReadback(finalRoot, descriptorSha);
  const finalInvocation = runHarness(finalRoot, "final");
  if (finalInvocation.conformance_sha256 !== candidate.descriptor.invocation_ledgers.required_final_conformance_sha256) {
    fail("FULL_READBACK_MISMATCH", "final invocation conformance");
  }
  evidence.lifecycle_state = "FINAL_CAS_PUBLISHED_AND_VERIFIED";
  evidence.release.runtime_root = finalRoot;
  evidence.release.runtime_root_realpath = realpathSync(finalRoot);
  evidence.release.final_invocation_ledger = finalInvocation;
  evidence.release.publication = {
    status: "PASS_FINAL_CAS_READBACK",
    initial: publication,
    final_conformance_readback: "PASS_BYTE_MODE_LEDGER_INVOCATION_REALPATH_EXACT",
  };
  evidence.release.complete_runtime_path_mode_sha256_ledger = finalReadback.runtime;
  evidence.gates = {
    independent_audit_ref: options.auditRef,
    owner_go_ref: options.ownerGoRef,
    hard_gate_ref: options.hardGateRef,
    exact_release_sha256: descriptorSha,
  };
  evidence.protected_effects.final_CAS_publication = publication === "ATOMIC_RENAME_NEW_CAS" ? 1 : 0;
  evidence.gate_result = {
    verdict: "PASS_SELF_CONTAINED_RELEASE_5_OF_5",
    blocker_count: 0,
    protected_effect_count: 0,
    final_publication_authorized: true,
  };
  evidence.next_action = {
    blocking: false,
    actor_agent_id: "kusabi",
    active_function: "implementation_executor",
    action: "Generate and verify the fresh R0 A/B temporal subject before R1.",
    deliver_via: "R0 v4 evidence and GoalRun successor",
    exact_input_refs: [`release:sha256:${descriptorSha}`, options.auditRef, options.ownerGoRef, options.hardGateRef],
    scope: "Exact frozen 35 targets and 3/11/21 membership; no rollout effect.",
    deliverable: "Fresh equal R0 A/B with non-stale owner-bound temporal window.",
    completion_evidence: "R0 v4 file digest and deterministic equality/temporal receipts.",
  };
  writeEvidence(evidence);
  process.stdout.write(`${JSON.stringify({ verdict: "PASS_FINAL", descriptor_sha256: descriptorSha, final_root: finalRoot, publication })}\n`);
}

function readback(options) {
  if (!existsSync(EVIDENCE_PATH)) fail("FULL_READBACK_MISMATCH", "evidence missing");
  const evidence = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8"));
  const descriptorSha = options.expectedReleaseSha ?? evidence.release?.release_descriptor_sha256;
  const root = existsSync(join(RELEASE_PARENT, descriptorSha)) ? join(RELEASE_PARENT, descriptorSha) : STAGE_ROOT;
  const result = exactReadback(root, descriptorSha);
  process.stdout.write(`${JSON.stringify({ verdict: "PASS_READBACK", root, descriptor_sha256: descriptorSha, runtime_tree_sha256: result.runtime.tree_sha256, resource_ledger_sha256: result.resources.ledger_sha256 })}\n`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "candidate") candidate();
  else if (options.mode === "r0") await r0Candidate();
  else if (options.mode === "publish") publish(options);
  else readback(options);
} catch (error) {
  process.stderr.write(`${error.code ?? "UNEXPECTED"}: ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
