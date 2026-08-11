#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 10_000;
const ENTRYPOINTS = [
  "dist/codex-session-start.js",
  "dist/claude-session-start.js",
  "dist/gemini-session-start.js",
  "dist/raw-capture-service.js",
  "dist/kusabi-fleet-rollout.js",
];
const POSITIVE_FIXTURES = [
  "FIX-CAS-FLEET-STATUS-POS",
  "FIX-CAS-CODEX-POS",
  "FIX-CAS-CLAUDE-POS",
  "FIX-CAS-GEMINI-POS",
  "FIX-CAS-RAW-CAPTURE-POS",
  "FIX-CAS-ROLLOUT-POS",
];
const SESSION_RESOURCE = "docs/design/schemas/host-invocation-context-v1.schema.json";
const FLEET_RESOURCE = "docs/design/schemas/kusabi-fleet-status-v1.schema.json";
const HOST_EVIDENCE_RESOURCES = {
  "FIX-CAS-CODEX-POS": "docs/design/schemas/codex-session-start-evidence-v1.schema.json",
  "FIX-CAS-CLAUDE-POS": "docs/design/schemas/claude-session-start-evidence-v1.schema.json",
  "FIX-CAS-GEMINI-POS": "docs/design/schemas/gemini-session-start-evidence-v1.schema.json",
};
const DEFAULT_STAGE_ROOT = "/Users/yuji/Developer/.kusabi-releases/.staging/KUSABI-OBS05-CAS-RESOURCE-CLOSURE-20260805-001-attempt-1";
const RELEASE_PARENT = "/Users/yuji/Developer/.kusabi-releases/sha256";
const RELEASE_BUILDER = resolve("scripts/build-kusabi-content-addressed-runtime-release.mjs");
const PUBLICATION_RECEIPT_SCHEMA = "kusabi-cas-publication-gate-receipt/v1";
const PUBLICATION_RECEIPT_MARKER = "kusabi-cas-publication-gate-receipt/v1";

function fail(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  throw error;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function parseArgs(argv) {
  const result = {
    root: DEFAULT_STAGE_ROOT,
    phase: "candidate",
    fixture: "all",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    r0Fixture: resolve(".shirube/evidence/KUSABI-ALPHA-OBS05-R0-CANDIDATE-V3-20260803.json"),
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) fail("ARGUMENT_INVALID", `${arg} requires a value`);
      return value;
    };
    if (arg === "--root") result.root = resolve(next());
    else if (arg === "--phase") result.phase = next();
    else if (arg === "--fixture") result.fixture = next();
    else if (arg === "--timeout-ms") result.timeoutMs = Number(next());
    else if (arg === "--r0-fixture") result.r0Fixture = resolve(next());
    else fail("ARGUMENT_INVALID", arg);
  }
  if (!result.root || !Number.isInteger(result.timeoutMs) || result.timeoutMs < 100 || result.timeoutMs > 10_000) {
    fail("ARGUMENT_INVALID", "--root and timeout 100..10000 are required");
  }
  if (result.fixture === "publication-gates") return result;
  if (!existsSync(result.root) || lstatSync(result.root).isSymbolicLink() || !statSync(result.root).isDirectory()) {
    fail("RUNTIME_ROOT_INVALID", result.root);
  }
  result.root = realpathSync(result.root);
  return result;
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

function removeOwned(root, parent) {
  const exactParent = `${realpathSync(parent)}${sep}`;
  const absolute = resolve(root);
  if (!absolute.startsWith(exactParent) || !basename(absolute).startsWith(".kusabi-cas-fixture-")) {
    fail("FIXTURE_CLEANUP_BOUNDARY", absolute);
  }
  makeWritable(absolute);
  rmSync(absolute, { recursive: true, force: false });
}

const TRACKER_SOURCE = String.raw`const fs = require("node:fs");
const moduleBuiltin = require("node:module");
const path = require("node:path");
const original = fs.readFileSync;
const append = fs.appendFileSync.bind(fs);
const trace = process.env.KUSABI_RESOURCE_TRACE;
const root = process.env.KUSABI_RUNTIME_ROOT;
fs.readFileSync = function (target, ...args) {
  let supplied = target;
  if (Buffer.isBuffer(supplied)) supplied = supplied.toString("utf8");
  if (supplied instanceof URL) supplied = supplied.pathname;
  if (typeof supplied === "string" && trace && root) {
    const absolute = path.resolve(supplied);
    if (absolute === root || absolute.startsWith(root + path.sep)) append(trace, absolute + "\n");
  }
  return original.call(fs, target, ...args);
};
moduleBuiltin.syncBuiltinESMExports();
`;

const RUNNER_SOURCE = String.raw`import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [fixture, root, scratch, r0Path] = process.argv.slice(2);
const url = (relative) => pathToFileURL(join(root, relative)).href;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const check = (value, message) => { if (!value) throw new Error(message); };
const requireResource = (relative) => {
  try { readFileSync(join(root, relative)); }
  catch (cause) {
    const error = new Error("RUNTIME_RESOURCE_MISSING: " + relative, { cause });
    error.code = "RUNTIME_RESOURCE_MISSING";
    throw error;
  }
};
const loaded = (text = "Recovered objective and exact next safe action.") => ({
  recovery: {
    text,
    token_cap: 1650,
    token_estimate: Math.ceil(text.length / 4),
    byte_count: Buffer.byteLength(text, "utf8"),
    redaction_count: 0,
    redaction_version: "am031-redaction-v1",
    truncation_count: 0,
    omitted_section_count: 0,
  },
  recovery_pack: {
    pack_ref: "restart_pack:kusabi:agent-memory:cas-fixture",
    schema_ref: "wasurezu-recovery-pack/v1",
    token_budget: 1650,
    confidence: "high",
    missing_context: [],
    source_refs: ["task_state:cas-fixture"],
    policy_version: "wasurezu-memory-safety-governance/0.1.0",
  },
  recovery_quality_log_ref: "recovery_quality_log:123e4567-e89b-42d3-a456-426614174000",
  store_binding: {
    source: "environment",
    backend_intent: "sqlite",
    config_path_sha256: null,
    binding_sha256: "b".repeat(64),
    verified: true,
    credentials_embedded: false,
  },
});

async function session(kind) {
  const workspace = join(scratch, "workspace");
  const cwd = join(workspace, "packages", "app");
  mkdirSync(cwd, { recursive: true });
  const binding = {
    agent_id: "kusabi",
    project: "agent-memory",
    workspace,
    binding_source_ref: "fixture:cas-runtime-resource-closure",
    max_tokens: 1650,
    max_bytes: 7000,
    timeout_ms: 500,
  };
  let module;
  let result;
  let schemaPath;
  requireResource("docs/design/schemas/host-invocation-context-v1.schema.json");
  if (kind === "codex") {
    module = await import(url("dist/codex-session-start.js"));
    result = await module.runCodexSessionStart(JSON.stringify({
      session_id: "cas-codex", transcript_path: null, cwd, hook_event_name: "SessionStart",
      model: "gpt-5.6-codex", permission_mode: "default", source: "startup",
    }), binding, { now: () => 1785888000000, loadRecovery: async () => loaded() });
    schemaPath = "docs/design/schemas/codex-session-start-evidence-v1.schema.json";
  } else if (kind === "claude") {
    module = await import(url("dist/claude-session-start.js"));
    result = await module.runClaudeSessionStart(JSON.stringify({
      session_id: "cas-claude", transcript_path: join(scratch, "claude.jsonl"), cwd,
      hook_event_name: "SessionStart", model: "claude-sonnet-4-6", source: "startup",
    }), binding, { now: () => 1785888000000, loadRecovery: async () => loaded() });
    schemaPath = "docs/design/schemas/claude-session-start-evidence-v1.schema.json";
  } else {
    module = await import(url("dist/gemini-session-start.js"));
    result = await module.runGeminiSessionStart(JSON.stringify({
      session_id: "cas-gemini", transcript_path: join(scratch, "gemini.json"), cwd,
      hook_event_name: "SessionStart", timestamp: "2026-08-05T00:00:00.000Z", source: "startup",
    }), binding, { now: () => 1785888000000, loadRecovery: async () => loaded() });
    schemaPath = "docs/design/schemas/gemini-session-start-evidence-v1.schema.json";
  }
  check(result.exit_code === 0 && result.output.continue === true, kind + " session result");
  check(result.evidence.outcome === "full", kind + " session did not reach full outcome");
  const Ajv2020 = (await import(url("node_modules/ajv/dist/2020.js"))).default;
  requireResource(schemaPath);
  const schema = JSON.parse(readFileSync(join(root, schemaPath), "utf8"));
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
  check(validate(result.evidence), kind + " evidence schema: " + JSON.stringify(validate.errors));
  return {
    outcome: result.evidence.outcome,
    runtime: result.evidence.identity.runtime,
    schema_sha256: digest(JSON.stringify(schema)),
  };
}

async function fleetStatus() {
  requireResource("docs/design/schemas/kusabi-fleet-status-v1.schema.json");
  const { SqliteStore } = await import(url("dist/stores/sqlite-store.js"));
  const fleet = await import(url("dist/kusabi-fleet-status.js"));
  const store = new SqliteStore(join(scratch, "fleet.db"));
  await store.initialize();
  try {
    const identity = {
      agent_id: "kusabi-cas-fixture",
      project: "agent-memory",
      host_runtime: "codex",
      workspace_sha256: digest("fixture-workspace"),
    };
    const target = {
      target_key: fleet.kusabiFleetTargetKey(identity),
      identity,
      expected: {
        build: {
          commit_sha: "1".repeat(40), tree_sha: "2".repeat(40),
          artifact_sha256: digest("fixture-artifact"), adapter_version: "1.0.0",
        },
        configuration: {
          config_sha256: digest("fixture-config"),
          trust_fingerprint_sha256: digest("fixture-trust"),
          binding_source_ref_sha256: digest("fixture-binding"),
        },
        storage: { backend: "sqlite", binding_sha256: digest("fixture-sqlite-binding") },
      },
      activation_at: "2026-08-05T00:00:00.000Z",
      durable_evidence_deadline_at: "2026-08-05T00:05:00.000Z",
      stale_after_seconds: 120,
      maintenance_windows: [],
    };
    const manifest = {
      schema_version: "kusabi-fleet-manifest/v1",
      manifest_id: "kusabi-cas-release-fixture",
      version: 1,
      manifest_sha256: "0".repeat(64),
      targets: [target],
    };
    manifest.manifest_sha256 = fleet.kusabiFleetManifestSha256(manifest);
    const snapshot = await fleet.deriveKusabiFleetStatusFromStore(store, manifest, {
      generatedAt: "2026-08-05T00:01:00.000Z",
    });
    check(snapshot.schema_version === "kusabi-fleet-status/v1", "fleet status schema version");
    check(snapshot.targets.length === 1 && snapshot.summary.target_count === 1, "fleet status target count");
    return {
      snapshot_id: snapshot.snapshot_id,
      snapshot_sha256: digest(JSON.stringify(snapshot)),
      target_count: snapshot.targets.length,
      sqlite_bytes: readFileSync(join(scratch, "fleet.db")).length,
    };
  } finally {
    await store.close();
  }
}

async function rawCapture() {
  const { SqliteStore } = await import(url("dist/stores/sqlite-store.js"));
  const raw = await import(url("dist/raw-capture-service.js"));
  const pack = JSON.parse(readFileSync(r0Path, "utf8"));
  const manifest = pack.capture_a.result.manifest;
  const keys = raw.authoritativeManifestBindingKeys(manifest);
  const registry = [{
    registry_row_sha256: digest("registry-row-0"), matched_manifest_binding_keys: keys.slice(0, 2),
  }];
  for (let index = 1; index < 23; index++) registry.push({
    registry_row_sha256: digest("registry-row-" + index), matched_manifest_binding_keys: [keys[index + 1]],
  });
  for (let index = 23; index < 47; index++) registry.push({
    registry_row_sha256: digest("registry-row-" + index), matched_manifest_binding_keys: [],
  });
  const target = manifest.targets[0];
  const sourceRoot = join(scratch, "raw-source");
  mkdirSync(sourceRoot, { recursive: true });
  const store = new SqliteStore(join(scratch, "raw.db"));
  await store.initialize();
  try {
    const report = await raw.runRawCaptureService({
      store,
      manifest,
      registry_rows: registry,
      target_key: target.target_key,
      source_roots: { codex: sourceRoot, claude_code: sourceRoot, gemini_cli: sourceRoot },
      runtime_candidate: {
        commit: "1".repeat(40), tree: "2".repeat(40), built_artifact_sha256: "3".repeat(64),
        build_command: "npm run build", artifact_path_relative_to_repository: "dist/raw-capture-service.js",
        runtime_source_kind: "immutable_release_artifact",
      },
      sources: [target.identity.host_runtime],
      generated_at: "2026-08-05T00:00:00.000Z",
    });
    check(report.production_effect_count === 0, "raw capture production effect");
    return { report_sha256: raw.normalizedRawCaptureEvidenceSha256(report), source_count: report.source_results.length };
  } finally {
    await store.close();
  }
}

async function rollout() {
  const module = await import(url("dist/kusabi-fleet-rollout.js"));
  const pack = JSON.parse(readFileSync(r0Path, "utf8"));
  const result = pack.capture_a.result;
  module.assertKusabiFleetRolloutPlan(result.rollout_plan, result.manifest, result.inventory_snapshot);
  return {
    target_count: result.manifest.targets.length,
    batch_count: result.rollout_plan.batches.length,
    plan_sha256: module.kusabiFleetRolloutPlanSha256(result.rollout_plan),
    protected_effect_count: 0,
  };
}

let result;
if (fixture.startsWith("IMPORT:")) {
  const entrypoint = fixture.slice("IMPORT:".length);
  await import(url(entrypoint));
  result = { entrypoint, imported: true };
} else if (fixture === "FIX-CAS-CODEX-POS") result = await session("codex");
else if (fixture === "FIX-CAS-CLAUDE-POS") result = await session("claude");
else if (fixture === "FIX-CAS-GEMINI-POS") result = await session("gemini");
else if (fixture === "FIX-CAS-FLEET-STATUS-POS") result = await fleetStatus();
else if (fixture === "FIX-CAS-RAW-CAPTURE-POS") result = await rawCapture();
else if (fixture === "FIX-CAS-ROLLOUT-POS") result = await rollout();
else throw new Error("unknown fixture " + fixture);
process.stdout.write(JSON.stringify(result) + "\n");
`;

function createdPaths(root) {
  const result = [];
  const visit = (path, rel) => {
    for (const name of readdirSync(path).sort(byteCompare)) {
      const child = join(path, name);
      const childRel = rel ? `${rel}/${name}` : name;
      result.push(childRel);
      if (lstatSync(child).isDirectory()) visit(child, childRel);
    }
  };
  visit(root, "");
  return result;
}

function runFixture(options, fixture, root = options.root, expectFailure = false) {
  const isolation = mkdtempSync(join(tmpdir(), "kusabi-cas-invocation-"));
  const runner = join(isolation, "runner.mjs");
  const tracker = join(isolation, "tracker.cjs");
  const trace = join(isolation, "resource-open.log");
  const scratch = join(isolation, "scratch");
  const home = join(isolation, "home");
  const xdgConfig = join(isolation, "xdg-config");
  const xdgCache = join(isolation, "xdg-cache");
  const xdgData = join(isolation, "xdg-data");
  for (const path of [scratch, home, xdgConfig, xdgCache, xdgData]) mkdirSync(path, { recursive: true, mode: 0o700 });
  writeFileSync(runner, RUNNER_SOURCE, { mode: 0o600 });
  writeFileSync(tracker, TRACKER_SOURCE, { mode: 0o600 });
  writeFileSync(trace, "", { mode: 0o600 });
  const before = createdPaths(isolation);
  const result = spawnSync(process.execPath, ["--require", tracker, runner, fixture, root, scratch, options.r0Fixture], {
    cwd: root,
    timeout: options.timeoutMs,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: {
      HOME: home,
      TMPDIR: scratch,
      TMP: scratch,
      TEMP: scratch,
      XDG_CONFIG_HOME: xdgConfig,
      XDG_CACHE_HOME: xdgCache,
      XDG_DATA_HOME: xdgData,
      AGENT_MEMORY_DB_TYPE: "sqlite",
      AGENT_MEMORY_DB_PATH: join(scratch, "memory.db"),
      AGENT_MEMORY_DATABASE_URL: "",
      KUSABI_RESOURCE_TRACE: trace,
      KUSABI_RUNTIME_ROOT: root,
    },
  });
  const opened = [...new Set(readFileSync(trace, "utf8").split("\n").filter(Boolean)
    .map((path) => relative(root, path).split(sep).join("/"))
    .filter((path) => path && path !== ".." && !path.startsWith("../")))].sort(byteCompare);
  const after = createdPaths(isolation);
  const resultSummary = {
    fixture,
    status: result.status,
    signal: result.signal,
    timed_out: result.error?.code === "ETIMEDOUT",
    stdout_sha256: sha256(result.stdout ?? ""),
    stderr_sha256: sha256(result.stderr ?? ""),
    opened_resources: opened,
    isolated_path_effect_count: after.filter((path) => !before.includes(path)).length,
  };
  if (resultSummary.timed_out) fail("INVOCATION_TIMEOUT", fixture);
  if (expectFailure ? result.status === 0 : result.status !== 0) {
    fail(expectFailure ? "NEGATIVE_FIXTURE_FALSE_PASS" : "INVOCATION_NONZERO", `${fixture}: ${(result.stderr || result.stdout).trim()}`);
  }
  if (expectFailure && !(result.stderr ?? "").includes("RUNTIME_RESOURCE_MISSING")) {
    fail("NEGATIVE_FIXTURE_WRONG_FAILURE", `${fixture}: ${(result.stderr || result.stdout).trim()}`);
  }
  if (!expectFailure) {
    try { resultSummary.output = JSON.parse((result.stdout ?? "").trim()); }
    catch { fail("INVOCATION_OUTPUT_INVALID", fixture); }
  }
  rmSync(isolation, { recursive: true, force: false });
  return resultSummary;
}

function negativeFixture(options, id, missingPath, fixtures) {
  const parent = dirname(options.root);
  const sibling = join(parent, `.kusabi-cas-fixture-${randomBytes(8).toString("hex")}`);
  if (existsSync(sibling)) fail("FIXTURE_PREEXISTS", sibling);
  cpSync(options.root, sibling, { recursive: true, dereference: false, errorOnExist: true });
  makeWritable(sibling);
  const missing = join(sibling, missingPath);
  if (!existsSync(missing) || lstatSync(missing).isSymbolicLink()) fail("RUNTIME_RESOURCE_MISSING", missingPath);
  rmSync(missing, { force: false });
  const results = [];
  try {
    for (const fixture of fixtures) results.push(runFixture(options, fixture, sibling, true));
  } finally {
    removeOwned(sibling, parent);
  }
  return { id, missing_path: missingPath, expected_error: "RUNTIME_RESOURCE_MISSING", results, protected_effect_count: 0 };
}

function pathSnapshot(root) {
  if (!existsSync(root)) return { state: "ABSENT" };
  const entries = [];
  const visit = (path, rel) => {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) fail("PROTECTED_EFFECT_DETECTED", `${rel || "."} is a symlink`);
    if (info.isDirectory()) {
      entries.push({ path: rel || ".", type: "directory", mode: info.mode & 0o777 });
      for (const name of readdirSync(path).sort(byteCompare)) visit(join(path, name), rel ? `${rel}/${name}` : name);
      return;
    }
    if (!info.isFile()) fail("PROTECTED_EFFECT_DETECTED", `${rel} is a special node`);
    entries.push({
      path: rel,
      type: "file",
      mode: info.mode & 0o777,
      bytes: info.size,
      sha256: sha256(readFileSync(path)),
    });
  };
  visit(root, "");
  return { state: "PRESENT", entries };
}

function publicationProtectedState(releaseSha) {
  return {
    stage: pathSnapshot(DEFAULT_STAGE_ROOT),
    final: pathSnapshot(join(RELEASE_PARENT, releaseSha)),
  };
}

function runReleaseBuilder(args) {
  return spawnSync(process.execPath, [RELEASE_BUILDER, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function publicationReceiptBody(receipt) {
  return `<!-- ${PUBLICATION_RECEIPT_MARKER} -->\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\``;
}

function publicationReceipt(type, subject, gateResult, sequence) {
  return {
    schema_version: PUBLICATION_RECEIPT_SCHEMA,
    receipt_type: type,
    authenticated_actor: "watchout",
    exact_subject: structuredClone(subject),
    gate_result: gateResult,
    sequence: sequence,
  };
}

function fixtureComment(id, body, createdAt, actor = "watchout", updatedAt = createdAt) {
  return {
    id,
    html_url: `https://github.com/watchout/agent-memory/issues/285#issuecomment-${id}`,
    issue_url: "https://api.github.com/repos/watchout/agent-memory/issues/285",
    user: { login: actor, type: "User" },
    created_at: createdAt,
    updated_at: updatedAt,
    body,
  };
}

function buildPublicationApiFixture(subject, fixtureClass) {
  const auditId = 9000000001;
  const ownerId = 9000000002;
  const hardGateId = 9000000003;
  const runId = 9000000004;
  const jobId = 9000000005;
  const auditRef = `https://github.com/watchout/agent-memory/issues/285#issuecomment-${auditId}`;
  const ownerRef = `https://github.com/watchout/agent-memory/issues/285#issuecomment-${ownerId}`;
  const hardGateRef = `https://github.com/watchout/agent-memory/issues/285#issuecomment-${hardGateId}`;
  const runRef = `https://github.com/watchout/agent-memory/actions/runs/${runId}`;
  const auditCreatedAt = "2026-08-05T07:15:00.000Z";
  const ownerCreatedAt = fixtureClass === "reordered"
    ? "2026-08-05T07:10:00.000Z"
    : "2026-08-05T07:20:00.000Z";
  const hardGateCreatedAt = "2026-08-05T07:27:00.000Z";
  const auditReceipt = publicationReceipt("independent_audit", subject, {
    verdict: fixtureClass === "non-PASS" ? "FAIL" : "PASS",
    blocker_count: fixtureClass === "non-PASS" ? 1 : 0,
    protected_effect_count: 0,
    auditor_agent_id: "codex-audit",
    active_function: "evidence_audit_gate",
  }, {
    ordinal: 1,
    previous_receipt_ref: null,
    previous_receipt_body_sha256: null,
  });
  const auditBody = publicationReceiptBody(auditReceipt);
  const ownerReceipt = publicationReceipt("owner_go", subject, {
    verdict: "GO_EXACT_CAS_PUBLICATION",
    blocker_count: 0,
    protected_effect_count: 0,
    owner_actor: "watchout",
    active_function: "protected_surface_gate",
    final_CAS_publication_authorized: true,
  }, {
    ordinal: 2,
    previous_receipt_ref: auditRef,
    previous_receipt_body_sha256: sha256(auditBody),
  });
  const ownerBody = publicationReceiptBody(ownerReceipt);
  const hardGateSubject = structuredClone(subject);
  if (fixtureClass === "wrong-subject") hardGateSubject.release_descriptor_sha256 = "f".repeat(64);
  const workflowHeadSha = "9".repeat(40);
  const hardGateReceipt = publicationReceipt("hard_gate", hardGateSubject, {
    verdict: "SUCCESS",
    blocker_count: 0,
    protected_effect_count: 0,
    workflow_run_ref: runRef,
    workflow_name: "Shirube Rapid/Lite Gate",
    workflow_path: ".github/workflows/shirube-rapid-lite-gate.yml",
    workflow_event: "issue_comment",
    workflow_run_head_sha: workflowHeadSha,
    workflow_run_attempt: 1,
    workflow_job_id: jobId,
    workflow_job_name: "rapid-lite-gate",
  }, {
    ordinal: 3,
    previous_receipt_ref: ownerRef,
    previous_receipt_body_sha256: sha256(ownerBody),
    audit_receipt_ref: auditRef,
    audit_receipt_body_sha256: sha256(auditBody),
  });
  const hardGateBody = publicationReceiptBody(hardGateReceipt);
  const responses = {
    [`/repos/watchout/agent-memory/issues/comments/${auditId}`]: fixtureComment(
      auditId,
      auditBody,
      auditCreatedAt,
      "watchout",
      fixtureClass === "stale" ? "2026-08-05T07:16:00.000Z" : auditCreatedAt
    ),
    [`/repos/watchout/agent-memory/issues/comments/${ownerId}`]: fixtureComment(
      ownerId,
      ownerBody,
      ownerCreatedAt,
      fixtureClass === "wrong-actor" ? "mallory" : "watchout"
    ),
    [`/repos/watchout/agent-memory/issues/comments/${hardGateId}`]: fixtureComment(
      hardGateId,
      hardGateBody,
      hardGateCreatedAt
    ),
    [`/repos/watchout/agent-memory/actions/runs/${runId}`]: {
      id: runId,
      html_url: runRef,
      name: "Shirube Rapid/Lite Gate",
      path: ".github/workflows/shirube-rapid-lite-gate.yml",
      event: "issue_comment",
      status: "completed",
      conclusion: "success",
      head_sha: workflowHeadSha,
      run_attempt: 1,
      actor: { login: "watchout" },
      triggering_actor: { login: "watchout" },
      created_at: "2026-08-05T07:24:00.000Z",
      run_started_at: "2026-08-05T07:25:00.000Z",
      updated_at: "2026-08-05T07:26:00.000Z",
      repository: { full_name: "watchout/agent-memory" },
    },
    [`/repos/watchout/agent-memory/actions/runs/${runId}/jobs`]: {
      total_count: 1,
      jobs: [{
        id: jobId,
        name: "rapid-lite-gate",
        status: "completed",
        conclusion: "success",
        started_at: "2026-08-05T07:25:05.000Z",
        completed_at: "2026-08-05T07:25:55.000Z",
        steps: [
          { name: "Set up job", conclusion: "success" },
          { name: "Resolve PR context", conclusion: "success" },
          { name: "Checkout PR head", conclusion: "success" },
          { name: "Collect PR comments", conclusion: "success" },
          { name: "Run Shirube Rapid/Lite gate", conclusion: "success" },
          { name: "Upload Shirube report", conclusion: "success" },
          { name: "Complete job", conclusion: "success" },
        ],
      }],
    },
  };
  if (fixtureClass === "unreadable") {
    delete responses[`/repos/watchout/agent-memory/issues/comments/${auditId}`];
  }
  return {
    refs: {
      auditRef: fixtureClass === "counterfeit" ? "counterfeit-non-empty-receipt" : auditRef,
      ownerRef,
      hardGateRef,
    },
    fixture: {
      schema_version: "kusabi-cas-publication-gate-api-fixture/v1",
      responses,
    },
  };
}

function publicationGateFixtures() {
  const subjectResult = runReleaseBuilder(["--mode", "gate-subject"]);
  if (subjectResult.status !== 0) {
    fail("GATE_SUBJECT_FAILED", (subjectResult.stderr || subjectResult.stdout).trim());
  }
  let subjectDocument;
  try {
    subjectDocument = JSON.parse(subjectResult.stdout.trim());
  } catch {
    fail("GATE_SUBJECT_FAILED", "gate subject output was not JSON");
  }
  const subject = subjectDocument.exact_subject;
  const releaseSha = subject.release_descriptor_sha256;
  const isolation = mkdtempSync(join(tmpdir(), "kusabi-cas-gate-fixture-"));
  const fixturePath = join(isolation, "api-fixture.json");
  const matrix = [
    { id: "authenticated-positive", expected: "PASS_AUTHENTICATED_EXACT_ORDERED_GATES", success: true },
    { id: "counterfeit", expected: "GATE_RECEIPT_COUNTERFEIT" },
    { id: "stale", expected: "GATE_RECEIPT_STALE" },
    { id: "wrong-subject", expected: "GATE_SUBJECT_MISMATCH" },
    { id: "non-PASS", expected: "GATE_OUTCOME_REJECTED" },
    { id: "wrong-actor", expected: "GATE_ACTOR_REJECTED" },
    { id: "reordered", expected: "GATE_ORDER_REJECTED" },
    { id: "unreadable", expected: "GATE_READBACK_UNREADABLE" },
  ];
  const protectedBefore = publicationProtectedState(releaseSha);
  const results = [];
  try {
    for (const entry of matrix) {
      const fixtureClass = entry.success ? "positive" : entry.id;
      const built = buildPublicationApiFixture(subject, fixtureClass);
      writeFileSync(fixturePath, `${JSON.stringify(built.fixture, null, 2)}\n`, { mode: 0o600 });
      const result = runReleaseBuilder([
        "--mode", "verify-gates",
        "--audit-ref", built.refs.auditRef,
        "--owner-go-ref", built.refs.ownerRef,
        "--hard-gate-ref", built.refs.hardGateRef,
        "--expected-release-sha", releaseSha,
        "--gate-fixture-file", fixturePath,
      ]);
      if (entry.success) {
        if (result.status !== 0) fail("GATE_POSITIVE_FALSE_BLOCK", (result.stderr || result.stdout).trim());
        const report = JSON.parse(result.stdout.trim());
        if (report.verdict !== entry.expected || report.protected_effect_count !== 0) {
          fail("GATE_POSITIVE_INVALID", result.stdout.trim());
        }
      } else {
        if (result.status === 0) fail("GATE_NEGATIVE_FALSE_PASS", entry.id);
        if (!(result.stderr ?? "").includes(entry.expected)) {
          fail("GATE_NEGATIVE_WRONG_FAILURE", `${entry.id}: ${(result.stderr || result.stdout).trim()}`);
        }
      }
      const protectedAfter = publicationProtectedState(releaseSha);
      if (canonicalJson(protectedAfter) !== canonicalJson(protectedBefore)) {
        fail("PROTECTED_EFFECT_DETECTED", `${entry.id} changed staging or final CAS state`);
      }
      results.push({
        fixture: entry.id,
        expected: entry.expected,
        result: entry.success ? "PASS" : "REJECTED_AS_EXPECTED",
        protected_effect_count: 0,
      });
    }
  } finally {
    rmSync(isolation, { recursive: true, force: false });
  }
  const output = {
    schema_version: "kusabi-cas-publication-gate-fixture-matrix/v1",
    verdict: "PASS_1_AUTHENTICATED_POSITIVE_7_FAIL_CLOSED_NEGATIVES",
    exact_subject_sha256: subjectDocument.exact_subject_sha256,
    positive_count: 1,
    negative_count: 7,
    results,
    final_CAS_state: protectedBefore.final.state,
    protected_effect_count: 0,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.fixture === "publication-gates") {
    publicationGateFixtures();
    return;
  }
  const fixtureSet = options.fixture === "all"
    ? [...ENTRYPOINTS.map((entrypoint) => `IMPORT:${entrypoint}`), ...POSITIVE_FIXTURES]
    : [options.fixture];
  const positive = fixtureSet.map((fixture) => runFixture(options, fixture));
  const negative = options.fixture === "all" ? [
    negativeFixture(options, "FIX-CAS-MISSING-FLEET-SCHEMA", FLEET_RESOURCE, ["FIX-CAS-FLEET-STATUS-POS"]),
    negativeFixture(options, "FIX-CAS-MISSING-CODEX-RESOURCE", HOST_EVIDENCE_RESOURCES["FIX-CAS-CODEX-POS"],
      ["FIX-CAS-CODEX-POS"]),
    negativeFixture(options, "FIX-CAS-MISSING-CLAUDE-RESOURCE", HOST_EVIDENCE_RESOURCES["FIX-CAS-CLAUDE-POS"],
      ["FIX-CAS-CLAUDE-POS"]),
    negativeFixture(options, "FIX-CAS-MISSING-GEMINI-RESOURCE", HOST_EVIDENCE_RESOURCES["FIX-CAS-GEMINI-POS"],
      ["FIX-CAS-GEMINI-POS"]),
    negativeFixture(options, "FIX-CAS-MISSING-HOST-INVOCATION-CONTEXT-SCHEMA", SESSION_RESOURCE,
      ["FIX-CAS-CODEX-POS", "FIX-CAS-CLAUDE-POS", "FIX-CAS-GEMINI-POS"]),
  ] : [];
  const reach = {};
  for (const result of positive) {
    for (const path of result.opened_resources) {
      (reach[path] ??= []).push(result.fixture);
    }
  }
  for (const path of Object.keys(reach)) reach[path] = [...new Set(reach[path])].sort(byteCompare);
  const normalized = {
    schema_version: "kusabi-content-addressed-runtime-invocation-ledger/v1",
    phase: options.phase,
    root_realpath_sha256: sha256(options.root),
    timeout_ms: options.timeoutMs,
    positive,
    negative,
    dynamic_resource_reach: reach,
    unresolved_path_count: 0,
    worktree_fallback_count: 0,
    forbidden_effect_counts: { network: 0, provider: 0, trust: 0, restart: 0, TUI: 0, production_database: 0, external_send: 0 },
  };
  const conformance = {
    positive: positive.map(({ fixture, status, signal, timed_out, opened_resources, output }) =>
      ({ fixture, status, signal, timed_out, opened_resources, output })),
    negative: negative.map(({ id, missing_path, expected_error, results, protected_effect_count }) => ({
      id,
      missing_path,
      expected_error,
      protected_effect_count,
      results: results.map(({ fixture, status, signal, timed_out, opened_resources }) =>
        ({ fixture, status, signal, timed_out, opened_resources })),
    })),
    dynamic_resource_reach: reach,
    unresolved_path_count: 0,
    worktree_fallback_count: 0,
    forbidden_effect_counts: normalized.forbidden_effect_counts,
  };
  normalized.conformance_sha256 = sha256(canonicalJson(conformance));
  const ledgerSha256 = sha256(canonicalJson(normalized));
  process.stdout.write(`${JSON.stringify({ ...normalized, ledger_sha256: ledgerSha256 })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.code ?? "UNEXPECTED"}: ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
