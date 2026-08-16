#!/usr/bin/env node
/**
 * Deterministic Shirube cell-conformance gate.
 *
 * Control source: https://github.com/watchout/agent-memory/issues/301
 *
 * Verifies a change against the control handoff that governs it. Every predicate
 * is a comparison over the handoff, the diff, and the repository policy. No model
 * judgment participates, and the gate performs no repository, runtime, or database
 * effect.
 *
 * This gate asserts the enumerated mechanical predicates only. It never asserts
 * that a change is well designed, and it does not replace a maker-separated
 * semantic audit.
 *
 * Usage:
 *   node scripts/shirube-cell-gate.mjs --base <sha> --head <sha> [--handoff <path>]
 *                                      [--policy <path>] [--out <path>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const CELL_GATE_SCHEMA = "shirube-cell-gate-result/v1";
export const HANDOFF_SCHEMA = "shirube-control-handoff/rapid-lite/v1";

const DEFAULT_HANDOFF_DIR = ".shirube/control-handoffs";
const DEFAULT_POLICY_PATH = ".shirube/repo-policy.json";

// Placeholders keep wildcard rewriting from being re-processed by later passes.
const TOKEN_TRAILING_DOUBLE = "\u0000";
const TOKEN_INNER_DOUBLE = "\u0001";
const TOKEN_DOUBLE = "\u0002";
const TOKEN_SINGLE = "\u0003";

/**
 * Matches a path against one glob. A trailing `/**` covers the directory and
 * everything under it, an inner `**` spans intermediate segments, and a single
 * `*` never crosses a separator.
 */
export function matchesGlob(path, pattern) {
  if (pattern === path) return true;
  const tokenized = pattern
    .replace(/\/\*\*$/g, TOKEN_TRAILING_DOUBLE)
    .replace(/\/\*\*\//g, TOKEN_INNER_DOUBLE)
    .replace(/\*\*/g, TOKEN_DOUBLE)
    .replace(/\*/g, TOKEN_SINGLE);
  const source = tokenized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .split(TOKEN_TRAILING_DOUBLE).join("(?:/.*)?")
    .split(TOKEN_INNER_DOUBLE).join("/(?:.*/)?")
    .split(TOKEN_DOUBLE).join(".*")
    .split(TOKEN_SINGLE).join("[^/]*");
  return new RegExp(`^${source}$`).test(path);
}

export function isTestPath(path) {
  return /(^|\/)(test|tests)\//.test(path) || /(^|\/)[^/]*\btest[^/]*\.[cm]?[jt]sx?$/.test(path);
}

function blocker(code, detail) {
  return { code, detail };
}

/**
 * Pure evaluation. `observed` describes what the repository actually contains;
 * `handoff` and `policy` describe what was declared.
 */
export function evaluateCellGate({ handoff, policy, observed }) {
  const blockers = [];
  const checks = [];
  const record = (id, ok, detail) => {
    checks.push({ id, verdict: ok ? "PASS" : "BLOCK", detail });
    return ok;
  };

  if (!handoff || typeof handoff !== "object") {
    blockers.push(blocker("HANDOFF_ABSENT", "no control handoff was found for this change"));
    return finalize(blockers, { ...observed, headDeclared: false }, checks, null);
  }

  const cell = handoff.cell ?? {};
  const subject = cell.exact_subject ?? {};
  const allowed = Array.isArray(cell.allowed_paths) ? cell.allowed_paths : [];

  if (!record(
    "HANDOFF-01",
    handoff.schema_version === HANDOFF_SCHEMA && typeof cell.cell_id === "string" && cell.cell_id !== "",
    `schema_version=${handoff.schema_version ?? "<absent>"} cell_id=${cell.cell_id ?? "<absent>"}`,
  )) blockers.push(blocker("HANDOFF_MALFORMED", "schema_version must be the recognised handoff schema and cell.cell_id must be non-empty"));

  const controlSource = handoff.control_source ?? {};
  if (!record(
    "HANDOFF-02",
    typeof controlSource.decision_ref === "string" && controlSource.decision_ref !== "",
    `decision_ref=${controlSource.decision_ref ?? "<absent>"}`,
  )) blockers.push(blocker("CONTROL_SOURCE_ABSENT", "control_source.decision_ref must name the issue or owner decision that authorized this cell"));

  // head_sha is optional because a handoff cannot name the commit that contains
  // it. When declared it must match exactly; when absent the gate records the head
  // as unbound, and the exact-head binding remains the owner decision's job.
  const headDeclared = typeof subject.head_sha === "string" && subject.head_sha !== "";
  if (!record(
    "SUBJECT-01",
    subject.base_sha === observed.base && (!headDeclared || subject.head_sha === observed.head),
    `declared base=${subject.base_sha ?? "<absent>"} head=${headDeclared ? subject.head_sha : "<unbound>"}; observed base=${observed.base} head=${observed.head}`,
  )) blockers.push(blocker("EXACT_SUBJECT_MISMATCH", "the handoff is not bound to this exact base, or declares a head that is not this head"));

  const unlisted = observed.changedPaths.filter(p => !allowed.some(a => matchesGlob(p, a)));
  if (!record(
    "PATHS-01",
    unlisted.length === 0,
    unlisted.length === 0 ? `${observed.changedPaths.length} changed paths all covered` : `outside allowed_paths: ${unlisted.join(", ")}`,
  )) blockers.push(blocker("PATH_OUTSIDE_ALLOWED", `changed paths not declared in cell.allowed_paths: ${unlisted.join(", ")}`));

  const protectedSurfaces = Array.isArray(policy?.protected_surfaces) ? policy.protected_surfaces : [];
  const touchedProtected = observed.changedPaths.filter(p => protectedSurfaces.some(s => matchesGlob(p, s)));
  const declaredProtected = touchedProtected.filter(p => allowed.some(a => matchesGlob(p, a)));
  const undeclaredProtected = touchedProtected.filter(p => !declaredProtected.includes(p));
  if (!record(
    "PROTECTED-01",
    undeclaredProtected.length === 0,
    touchedProtected.length === 0 ? "no protected surface touched" : `protected and declared: ${declaredProtected.join(", ") || "none"}`,
  )) blockers.push(blocker("PROTECTED_SURFACE_UNDECLARED", `protected surfaces touched without being declared: ${undeclaredProtected.join(", ")}`));

  if (touchedProtected.length > 0) {
    checks.push({
      id: "PROTECTED-02",
      verdict: "OWNER_GATE_REQUIRED",
      detail: `this change touches a protected surface and therefore requires an exact-head owner decision regardless of this gate: ${touchedProtected.join(", ")}`,
    });
  }

  const sourceChanged = observed.changedPaths.filter(p => !isTestPath(p) && /^src\//.test(p));
  const testChanged = observed.changedPaths.some(p => isTestPath(p));
  const exemption = cell.test_coupling_exempt;
  const exempt = typeof exemption === "string" && exemption.trim() !== "";
  if (!record(
    "TEST-01",
    sourceChanged.length === 0 || testChanged || exempt,
    sourceChanged.length === 0 ? "no source change" : exempt ? `exempt: ${exemption}` : `source changed without a test change: ${sourceChanged.join(", ")}`,
  )) blockers.push(blocker("TEST_COUPLING_ABSENT", "a source change must come with a test change, or the handoff must declare cell.test_coupling_exempt with a reason"));

  const shapeOk =
    (subject.changed_file_count === undefined || subject.changed_file_count === observed.changedPaths.length) &&
    (subject.commit_count === undefined || subject.commit_count === observed.commitCount);
  if (!record(
    "SHAPE-01",
    shapeOk,
    `declared files=${subject.changed_file_count ?? "<unset>"} commits=${subject.commit_count ?? "<unset>"}; observed files=${observed.changedPaths.length} commits=${observed.commitCount}`,
  )) blockers.push(blocker("DECLARED_SHAPE_MISMATCH", "declared changed_file_count or commit_count does not match the diff"));

  return finalize(blockers, { ...observed, headDeclared }, checks, cell.cell_id ?? null);
}

function finalize(blockers, observed, checks, cellId) {
  return {
    schema_version: CELL_GATE_SCHEMA,
    verdict: blockers.length === 0 ? "PASS" : "BLOCK",
    cell_id: cellId,
    exact_subject: { base: observed.base, head: observed.head },
    head_binding: observed.headDeclared ? "declared" : "unbound",
    checks,
    blockers,
    blocker_count: blockers.length,
    asserts: "mechanical conformance only; this gate does not assert design correctness and does not replace a maker-separated semantic audit",
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function discoverHandoff(dir, head) {
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir).filter(f => f.endsWith(".json"));
  for (const file of candidates) {
    try {
      const parsed = readJson(join(dir, file));
      if (parsed?.cell?.exact_subject?.head_sha === head) return parsed;
    } catch {
      // An unparseable sibling must not mask a valid handoff; a wholly absent
      // handoff is reported by the caller as HANDOFF_ABSENT.
    }
  }
  return null;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key.startsWith("--")) args[key.slice(2)] = argv[i + 1];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const head = args.head ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const base = args.base ?? execFileSync("git", ["merge-base", "origin/main", head], { encoding: "utf8" }).trim();
  const changedPaths = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], { encoding: "utf8" })
    .split("\n").map(s => s.trim()).filter(Boolean);
  const commitCount = execFileSync("git", ["rev-list", "--count", `${base}..${head}`], { encoding: "utf8" }).trim();

  const handoff = args.handoff ? readJson(args.handoff) : discoverHandoff(DEFAULT_HANDOFF_DIR, head);
  const policyPath = args.policy ?? DEFAULT_POLICY_PATH;
  const policy = existsSync(policyPath) ? readJson(policyPath) : { protected_surfaces: [] };

  const result = evaluateCellGate({
    handoff,
    policy,
    observed: { base, head, changedPaths, commitCount: Number(commitCount) },
  });

  const rendered = JSON.stringify(result, null, 2);
  if (args.out) writeFileSync(args.out, `${rendered}\n`);
  process.stdout.write(`${rendered}\n`);
  process.exit(result.verdict === "PASS" ? 0 : 1);
}

// Compare resolved URLs rather than a suffix: the test module's filename also ends
// with this module's filename, and a suffix check would run the CLI on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
