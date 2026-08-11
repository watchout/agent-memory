#!/usr/bin/env node

import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildStatus,
  canonicalJson,
  computeGoalRunStateDigest,
  digestValue,
} from "./shirube-v4-goal-control.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const CONTROL = join(ROOT, "scripts/shirube-v4-goal-control.mjs");
const GOAL = join(ROOT, ".shirube/goal-runs/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.json");
const ITEMS = join(ROOT, ".shirube/work-items/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804");
const RELEASE = join(ROOT, ".shirube/evidence/KUSABI-ALPHA-OBS05-RUNTIME-RELEASE-V1-20260803.json");
const R0_V3 = join(ROOT, ".shirube/evidence/KUSABI-ALPHA-OBS05-R0-CANDIDATE-V3-20260803.json");
const RELEASE_V3_CANDIDATE = join(ROOT, ".shirube/evidence/KUSABI-ALPHA-OBS05-RUNTIME-RELEASE-V3-20260805.json");
const R0_V4_CANDIDATE = join(ROOT, ".shirube/evidence/KUSABI-ALPHA-OBS05-R0-CANDIDATE-V4-20260805.json");
const GENERATION_3_HISTORY = join(ROOT, ".shirube/goal-runs/history/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.generation-3.json");
const GENERATION_4_HISTORY = join(ROOT, ".shirube/goal-runs/history/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.generation-4.json");
const RECONCILIATION_EVIDENCE_RELATIVE = ".shirube/evidence/KUSABI-PR286-B03-AUDIT-HARD-GATE-RECONCILIATION-20260810.json";
const RECONCILIATION_EVIDENCE = join(ROOT, RECONCILIATION_EVIDENCE_RELATIVE);
const RECONCILIATION_HANDOFF_RELATIVE = ".shirube/control-handoffs/CH-KUSABI-PR286-GOALRUN-B03-B04-RECONCILIATION-20260810-001.yaml";
const RECONCILIATION_HANDOFF = join(ROOT, RECONCILIATION_HANDOFF_RELATIVE);
const AGENTS = join(ROOT, "AGENTS.md");
const PREDECESSOR_HEAD = "43724e69a3b40a2088cb4b0149c9ba618f1d4e65";
const SHIRUBE_MANIFEST_SERIALIZATION = "shirube-manifest/v1:utf8-byte-order:path-nul-raw-sha256:lf-terminated";
const EXPECTED_SHIRUBE_MANIFEST_FILE_COUNT = 168;
const EXPECTED_SHIRUBE_MANIFEST_SHA256 = "540cf5060b5705f94c7fb22b2420cc4feb35e7baa18695f0aff3058637acd3b6";
const RECONCILE_ARGS = [
  "reconcile-cas-b01-audit",
  "--subject-head", PREDECESSOR_HEAD,
  "--subject-tree", "10a3c1c5633743914082abddaec0cae20ee51f04",
  "--audit-ref", "https://github.com/watchout/agent-memory/issues/285#issuecomment-5230368349",
  "--audit-body-sha256", "9016e826418c9c22234b821065c4cc1f6821a6c30eb1fdc37b2ddf5a31c100f9",
  "--hard-gate-run-ref", "https://github.com/watchout/agent-memory/actions/runs/31303252529",
  "--hard-gate-report-sha256", "5f488ded2bc28e4215e003f4d7f76eedef722ef9cf8ec897cdf37d1a1a15cb90",
  "--hard-gate-receipt-ref", "https://github.com/watchout/agent-memory/issues/285#issuecomment-5230557950",
  "--hard-gate-receipt-body-sha256", "37f6fa0b2d14bc82fd569748b3a5d166dca09acfbdbb88a0c839c01d806cfbd7",
  "--observed-at", "2026-08-09T22:27:28Z",
];
const FRAMEWORK_CANDIDATES = [
  process.env.SHIRUBE_FRAMEWORK_ROOT,
  resolve(ROOT, "../ai-dev-framework"),
  resolve(ROOT, "../ai-dev-framework-v4-integration"),
].filter(Boolean);

let assertions = 0;
function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function run(args, expected = 0) {
  const result = spawnSync(process.execPath, [CONTROL, ...args], { cwd: ROOT, encoding: "utf8" });
  check(result.status === expected, `${args.join(" ")} exit ${result.status}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function runFailure(args, message) {
  const result = spawnSync(process.execPath, [CONTROL, ...args], { cwd: ROOT, encoding: "utf8" });
  check(result.status === 1 && result.stderr.includes(message), `${args.join(" ")} must fail with ${message}: ${result.stderr || result.stdout}`);
}

function gitFile(ref, relativePath) {
  const result = spawnSync("git", ["show", `${ref}:${relativePath}`], { cwd: ROOT, encoding: "utf8" });
  check(result.status === 0, `git show ${ref}:${relativePath} failed: ${result.stderr}`);
  return result.stdout;
}

function sha256Raw(value) {
  return createHash("sha256").update(value).digest("hex");
}

function byteManifest(root) {
  const rows = [];
  const walk = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => Buffer.compare(Buffer.from(left.name, "utf8"), Buffer.from(right.name, "utf8")))) {
      const path = join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path, relativePath);
      else if (entry.isFile()) rows.push(`${relativePath}\0${sha256Raw(readFileSync(path))}`);
      else throw new Error(`unsupported manifest entry: ${path}`);
    }
  };
  walk(root);
  const bytes = Buffer.from(`${rows.join("\n")}\n`, "utf8");
  return { bytes, fileCount: rows.length, sha256: sha256Raw(bytes) };
}

function reconcileArg(name) {
  const index = RECONCILE_ARGS.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= RECONCILE_ARGS.length) throw new Error(`missing reconciliation argument: ${name}`);
  return RECONCILE_ARGS[index + 1];
}

function repoPath(locator) {
  if (typeof locator === "string" && locator.startsWith("repo:")) return join(ROOT, locator.slice("repo:".length));
  return locator;
}

function frameworkRoot() {
  const found = FRAMEWORK_CANDIDATES.find((candidate) => {
    try { return readFileSync(join(candidate, "scripts/shirube/validate-goal-run.mjs")).length > 0; }
    catch { return false; }
  });
  if (!found) throw new Error("canonical Shirube validators unavailable");
  return found;
}

const checkReport = run(["check"]);
const agentInstructions = readFileSync(AGENTS, "utf8");
check(agentInstructions.includes("mcp__wasurezu__recover_context") && agentInstructions.includes('project: "agent-memory"'), "LLM startup instructions must preserve deterministic Wasurezu recovery");
check(agentInstructions.includes("## Shirube V4 GoalRun Binding"), "LLM startup instructions must bind Shirube V4 GoalRun");
check(agentInstructions.includes("npm run shirube:v4:goal:status") && agentInstructions.includes("npm run shirube:v4:goal:next"), "LLM startup instructions must read deterministic status and next action");
check(agentInstructions.includes("Do not stop on progress reports"), "LLM startup instructions must reject declaration stalls");
check(checkReport.verdict === "PASS", "canonical aggregate check must pass");
check(checkReport.goal_validator.report.verdict === "PASS", "GoalRun validator must pass");
check(checkReport.work_item_validators.length === 11 && checkReport.work_item_validators.every((row) => row.report.verdict === "PASS"), "all 11 WorkItems must pass");
check(checkReport.execution_binding_validator.report.verdict === "PASS", "ExecutionGoalBinding validator must pass");
check(checkReport.generation_history.generation_1.file_sha256 === "6b51df6c4c1af2190c4ac58d230ed2cf9e51b5d7bbaf12d9da62d5d71d6f42f3", "generation 1 history must remain file-backed and immutable");
check(checkReport.generation_history.generation_2.file_sha256 === "6f39518dba6953f17b843ea2696611c3aaa5c360a6cfe8c3085cfdc1bac1f66c", "generation 2 history must remain bound to the exact git predecessor");
check(checkReport.generation_history.generation_3.file_sha256 === "141e00b311028dc119d837523084550c85bc0e8dda83d97dc478ed28d647b01b", "generation 3 history must remain immutable and file-backed");
check(checkReport.generation_history.generation_3.state_digest === JSON.parse(readFileSync(GENERATION_3_HISTORY, "utf8")).state_digest, "generation 3 history report must bind the immutable predecessor state");
check(checkReport.generation_history.generation_4.state_digest === JSON.parse(readFileSync(GENERATION_4_HISTORY, "utf8")).state_digest, "generation 4 history must bind the immutable B-03 predecessor state");
check(checkReport.generation_history.generation_5.state_digest === checkReport.status.state_digest, "generation 5 history readback must bind the current GoalRun state");
check(checkReport.generation_history.generation_5.evidence_ref === "file:.shirube/goal-runs/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.json", "generation 5 must be reported as current without relabeling its predecessor");

const statusA = run(["status"], 1);
const statusB = run(["status"], 1);
check(canonicalJson(statusA) === canonicalJson(statusB), "status readback must be deterministic across process restart");
check(statusA.targets.total === 35 && statusA.targets.live_exact === 0, "frozen target denominator must be 35 with no false live completion");
check(statusA.generation === 5 && statusA.status === "BLOCKED", "PR 286 exact correction merge gate must block generation 5");
check(statusA.blockers.length === 1 && statusA.blockers[0]?.blocker_id === "B-04-PR286-EXACT-CORRECTION-MERGE" && statusA.acceptance.total === 11 && statusA.acceptance.passed === 1, "generation 5 must replace B-03 with only B-04 and keep only A01 verified");
check(statusA.next_work_item?.work_item_id === "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE", "merge-blocked correction must keep immutable runtime release as the next WorkItem");
check(statusA.next_work_item?.status === "BLOCKED" && statusA.next_work_item?.required_operation === "LOCAL_DIRECT_ADAPTER" && statusA.can_continue === false, "effective external gate must dominate a locally executable adapter state");
check(statusA.next_action?.actor_agent_id === "codex-audit" && statusA.next_action?.active_function === "evidence_audit_gate", "generation 5 must route the new exact head to the maker-separated auditor");
check(statusA.next_action?.blocking === true && statusA.next_action?.exact_input_refs?.includes("file:.shirube/control-handoffs/CH-KUSABI-PR286-GOALRUN-B03-B04-RECONCILIATION-20260810-001.yaml"), "generation 5 routing must bind the exact bounded successor and remain blocking");

const workItems = checkReport.work_item_validators.map((row) => JSON.parse(readFileSync(repoPath(row.report.file), "utf8")));
const inMemoryStatus = buildStatus(JSON.parse(readFileSync(GOAL, "utf8")), workItems);
check(canonicalJson(inMemoryStatus) === canonicalJson(statusA), "checkpoint recovery must reproduce exact status");
const releaseItem = workItems.find((item) => item.work_item_id === "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE");
const r0Item = workItems.find((item) => item.work_item_id === "WORK-ITEM-KUSABI-R0-V3-HEARTBEAT-REPRODUCTION");
const auditItem = workItems.find((item) => item.work_item_id === "WORK-ITEM-KUSABI-R0-V3-INDEPENDENT-AUDIT");
check(releaseItem?.status === "BLOCKED" && releaseItem.removes_blocker_ids.length === 0 && releaseItem.terminal_evidence.length === 0, "A02 must remain blocked and nonterminal without claiming that its later release operation removes B-03 or B-04");
check(releaseItem?.handoff_digest === `sha256:${sha256Raw(readFileSync(RECONCILIATION_HANDOFF))}`, "A02 must bind the exact current control-handoff bytes");
check(r0Item?.status === "READY" && r0Item.terminal_evidence.length === 0, "A03 must remain nonterminal before final CAS readback");
check(auditItem?.status === "READY" && auditItem.terminal_evidence.length === 0, "audit WorkItem must not contain inferred terminal evidence");

const staleLocalGoal = structuredClone(JSON.parse(readFileSync(GOAL, "utf8")));
staleLocalGoal.status = "ACTIVE";
const staleLocalItems = workItems.map((item) => item.work_item_id === "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE"
  ? { ...item, status: "READY" }
  : item);
const reconciledExternalGate = buildStatus(staleLocalGoal, staleLocalItems);
check(reconciledExternalGate.status === "BLOCKED" && reconciledExternalGate.can_continue === false, "effective external blocker must dominate stale local ACTIVE and READY fields");
check(reconciledExternalGate.next_work_item?.status === "BLOCKED" && reconciledExternalGate.next_action?.blocking === true, "effective external blocker must expose a blocked WorkItem and blocking next_action");

const releaseEvidence = JSON.parse(readFileSync(RELEASE, "utf8"));
const r0Evidence = JSON.parse(readFileSync(R0_V3, "utf8"));
const releaseCandidate = JSON.parse(readFileSync(RELEASE_V3_CANDIDATE, "utf8"));
const r0Candidate = JSON.parse(readFileSync(R0_V4_CANDIDATE, "utf8"));
check(releaseEvidence.release.release_descriptor_sha256 === "f58fbfe30ac29867fecdb338b294efb02eeb5a4f1688d0bcbf3a48f5a6b13626", "release descriptor must bind the self-contained CAS");
check(releaseEvidence.release.production_dependency_inventory.installed_count === 107 && releaseEvidence.release.production_dependency_inventory.extraneous_missing_invalid_count === 0, "production dependency closure must be exact");
check(releaseEvidence.release.import_smoke_before_publish.pass_count === 5 && releaseEvidence.release.import_smoke_after_publish.pass_count === 5, "staging and final imports must pass 5 of 5");
check(r0Evidence.heartbeat_separation.verdict === "PASS_PARTITIONED_33_OF_33" && r0Evidence.equality_matrix.verdict === "PASS", "fresh R0 heartbeat separation and equality matrix must pass");
check(r0Evidence.topology.target_count === 35 && canonicalJson(r0Evidence.topology.stage_counts) === canonicalJson({ r1: 3, r2: 11, r3: 21 }), "fresh R0 topology must remain frozen 35 and 3/11/21");
check(r0Evidence.gate_result.R1_authorized === false, "R1 must remain closed before audit and owner GO");
check(releaseCandidate.lifecycle_state === "CANDIDATE_VERIFIED_AWAITING_INDEPENDENT_GATES", "successor release must remain a candidate before exact gates");
check(releaseCandidate.release.release_descriptor_sha256 === "ceb74adfd032aabfece0feb2cb50978551a68686c69bdbfd69649b367d07e9d4", "candidate release descriptor must bind the exact successor CAS subject");
check(releaseCandidate.release.publication.status === "NOT_ATTEMPTED_INDEPENDENT_AUDIT_OWNER_GO_HARD_GATE_REQUIRED" && releaseCandidate.protected_effects.final_CAS_publication === 0, "candidate evidence must prove final CAS remains unpublished");
check(releaseCandidate.release.candidate_invocation_ledger.unresolved_path_count === 0 && releaseCandidate.release.candidate_invocation_ledger.worktree_fallback_count === 0, "candidate invocation ledger must have complete resource closure");
check(r0Candidate.lifecycle_state === "FRESH_CANDIDATE_A_B_AWAITING_INDEPENDENT_GATES" && r0Candidate.equality_matrix.verdict === "PASS", "fresh candidate R0 A/B must pass equality without becoming terminal");
check(r0Candidate.topology.target_count === 35 && canonicalJson(r0Candidate.topology.stage_counts) === canonicalJson({ r1: 3, r2: 11, r3: 21 }), "candidate R0 topology must remain frozen 35 and 3/11/21");
check(r0Candidate.topology.rollback_preimage_match_count === 35 && r0Candidate.gate_result.R1_authorized === false, "candidate R0 must preserve 35 preimages and keep R1 closed");

const reconcileScratch = mkdtempSync(join(tmpdir(), "shirube-v4-b04-portable-"));
try {
  cpSync(join(ROOT, ".shirube"), join(reconcileScratch, ".shirube"), { recursive: true });
  const replayReport = run(["check", "--root", reconcileScratch, "--framework-root", frameworkRoot()]);
  check(replayReport.verdict === "PASS", "generation-5 B-04 copy must remain canonical");
  const replayStatus = run(["status", "--root", reconcileScratch], 1);
  check(canonicalJson(replayStatus) === canonicalJson(statusA), "generation-5 B-04 state must be portable and restart-readable");
} finally {
  rmSync(reconcileScratch, { recursive: true, force: true });
}

const predecessorScratch = mkdtempSync(join(tmpdir(), "shirube-v4-b03-predecessor-"));
try {
  cpSync(join(ROOT, ".shirube"), join(predecessorScratch, ".shirube"), { recursive: true });
  const goalRelative = ".shirube/goal-runs/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.json";
  const bindingRelative = ".shirube/execution-goal-bindings/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.kusabi.json";
  const itemRootRelative = ".shirube/work-items/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804";
  writeFileSync(join(predecessorScratch, goalRelative), gitFile(PREDECESSOR_HEAD, goalRelative));
  writeFileSync(join(predecessorScratch, bindingRelative), gitFile(PREDECESSOR_HEAD, bindingRelative));
  for (const name of readdirSync(ITEMS).filter((entry) => entry.endsWith(".json"))) {
    const relativePath = `${itemRootRelative}/${name}`;
    writeFileSync(join(predecessorScratch, relativePath), gitFile(PREDECESSOR_HEAD, relativePath));
  }
  unlinkSync(join(predecessorScratch, ".shirube/goal-runs/history/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.generation-4.json"));
  const transitioned = run([...RECONCILE_ARGS, "--root", predecessorScratch, "--framework-root", frameworkRoot()]);
  check(transitioned.verdict === "PASS" && transitioned.status.generation === 5, "exact generation-4 predecessor must transition to generation 5");
  check(transitioned.status.blockers.length === 1 && transitioned.status.blockers[0]?.blocker_id === "B-04-PR286-EXACT-CORRECTION-MERGE", "exact predecessor transition must replace B-03 with only B-04");
  check(transitioned.status.acceptance.passed === 1 && transitioned.status.targets.live_exact === 0 && transitioned.production_effect_count === 0, "transition must not advance A-02 through A-11, targets, or protected effects");
  const goalAfterFirst = readFileSync(join(predecessorScratch, goalRelative), "utf8");
  const historyAfterFirst = readFileSync(join(predecessorScratch, ".shirube/goal-runs/history/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.generation-4.json"), "utf8");
  const handoffSha256 = sha256Raw(readFileSync(join(predecessorScratch, RECONCILIATION_HANDOFF_RELATIVE)));
  const evidenceSha256 = sha256Raw(readFileSync(join(predecessorScratch, RECONCILIATION_EVIDENCE_RELATIVE)));
  const expectedCheckpointKey = digestValue({
    event_id: `EVENT-KUSABI-PR286-B03-AUDIT-RECONCILED-${PREDECESSOR_HEAD}`,
    subject_head: reconcileArg("subject-head"),
    subject_tree: reconcileArg("subject-tree"),
    audit_ref: reconcileArg("audit-ref"),
    audit_body_sha256: reconcileArg("audit-body-sha256"),
    hard_gate_run_ref: reconcileArg("hard-gate-run-ref"),
    hard_gate_report_sha256: reconcileArg("hard-gate-report-sha256"),
    evidence_sha256: evidenceSha256,
    handoff_sha256: handoffSha256,
  });
  const transitionedGoal = JSON.parse(goalAfterFirst);
  const transitionedReleaseItem = JSON.parse(readFileSync(join(predecessorScratch, itemRootRelative, "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE.json"), "utf8"));
  check(transitionedGoal.checkpoint.last_idempotency_key === expectedCheckpointKey, "generation-5 checkpoint must bind the final current handoff bytes");
  check(transitionedReleaseItem.handoff_digest === `sha256:${handoffSha256}`, "generated A02 WorkItem must bind the final current handoff raw SHA");
  const manifestAfterFirst = byteManifest(join(predecessorScratch, ".shirube"));
  check(manifestAfterFirst.fileCount === EXPECTED_SHIRUBE_MANIFEST_FILE_COUNT, `${SHIRUBE_MANIFEST_SERIALIZATION} must cover the complete 168-file .shirube manifest`);
  check(manifestAfterFirst.sha256 === EXPECTED_SHIRUBE_MANIFEST_SHA256, `${SHIRUBE_MANIFEST_SERIALIZATION} digest must match immutable implementation evidence`);
  const replayed = run([...RECONCILE_ARGS, "--root", predecessorScratch, "--framework-root", frameworkRoot()]);
  check(replayed.status.state_digest === transitioned.status.state_digest, "exact generation-5 replay must preserve the state digest");
  check(readFileSync(join(predecessorScratch, goalRelative), "utf8") === goalAfterFirst && readFileSync(join(predecessorScratch, ".shirube/goal-runs/history/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.generation-4.json"), "utf8") === historyAfterFirst, "exact replay must be byte-idempotent for GoalRun and predecessor history");
  check(byteManifest(join(predecessorScratch, ".shirube")).bytes.equals(manifestAfterFirst.bytes), "exact replay must be byte-idempotent for the complete generated .shirube manifest");
} finally {
  rmSync(predecessorScratch, { recursive: true, force: true });
}

const rejectionScratch = mkdtempSync(join(tmpdir(), "shirube-v4-b03-rejections-"));
try {
  cpSync(join(ROOT, ".shirube"), join(rejectionScratch, ".shirube"), { recursive: true });
  const wrongHead = [...RECONCILE_ARGS];
  wrongHead[wrongHead.indexOf("--subject-head") + 1] = "0000000000000000000000000000000000000000";
  runFailure([...wrongHead, "--root", rejectionScratch], "subject-head must equal the authenticated exact value");
  const wrongAuditDigest = [...RECONCILE_ARGS];
  wrongAuditDigest[wrongAuditDigest.indexOf("--audit-body-sha256") + 1] = "0".repeat(64);
  runFailure([...wrongAuditDigest, "--root", rejectionScratch], "audit-body-sha256 must equal the authenticated exact value");
  const wrongGateRef = [...RECONCILE_ARGS];
  wrongGateRef[wrongGateRef.indexOf("--hard-gate-run-ref") + 1] = "https://github.com/watchout/agent-memory/actions/runs/0";
  runFailure([...wrongGateRef, "--root", rejectionScratch], "hard-gate-run-ref must equal the authenticated exact value");

  const evidencePath = join(rejectionScratch, RECONCILIATION_EVIDENCE_RELATIVE);
  const exactEvidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  for (const mutate of [
    (value) => { value.independent_audit.verdict = "FAIL"; },
    (value) => { value.independent_audit.reviewer_agent_id = "kusabi"; },
    (value) => { value.authenticated_hard_gate.verdict = "FAILURE"; },
    (value) => { value.protected_effects.final_CAS_publication = 1; },
  ]) {
    const rejectedEvidence = structuredClone(exactEvidence);
    mutate(rejectedEvidence);
    writeFileSync(evidencePath, `${JSON.stringify(rejectedEvidence, null, 2)}\n`);
    runFailure([...RECONCILE_ARGS, "--root", rejectionScratch], "B-03 audit/hard-gate reconciliation evidence is not exact PASS with zero protected effects");
  }
  writeFileSync(evidencePath, `${JSON.stringify(exactEvidence, null, 2)}\n`);
  const historyPath = join(rejectionScratch, ".shirube/goal-runs/history/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.generation-4.json");
  const exactHistory = readFileSync(historyPath, "utf8");
  writeFileSync(historyPath, `${exactHistory}\n`);
  runFailure([...RECONCILE_ARGS, "--root", rejectionScratch], "immutable generation-4 history raw SHA-256 mismatch");
  writeFileSync(historyPath, exactHistory);
  const wrongGenerationGoalPath = join(rejectionScratch, ".shirube/goal-runs/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.json");
  const wrongGenerationGoal = JSON.parse(readFileSync(wrongGenerationGoalPath, "utf8"));
  wrongGenerationGoal.generation = 6;
  wrongGenerationGoal.state_digest = computeGoalRunStateDigest(wrongGenerationGoal);
  writeFileSync(wrongGenerationGoalPath, `${JSON.stringify(wrongGenerationGoal, null, 2)}\n`);
  runFailure([...RECONCILE_ARGS, "--root", rejectionScratch], "requires the exact blocked generation-4 predecessor or exact generation-5 B-04 replay");
} finally {
  rmSync(rejectionScratch, { recursive: true, force: true });
}

const scratch = mkdtempSync(join(tmpdir(), "shirube-v4-false-completion-"));
try {
  const falseGoal = JSON.parse(readFileSync(GOAL, "utf8"));
  falseGoal.status = "VERIFIED_COMPLETE";
  falseGoal.blocker_set = [];
  falseGoal.active_work_item_id = null;
  falseGoal.acceptance_states = falseGoal.acceptance_states.map((state) => ({ ...state, status: "VERIFIED_PASS", evidence_refs: ["fixture://unsupported-claim"] }));
  falseGoal.state_digest = computeGoalRunStateDigest(falseGoal);
  const falsePath = join(scratch, "false-complete.json");
  writeFileSync(falsePath, `${JSON.stringify(falseGoal, null, 2)}\n`);
  const validator = join(frameworkRoot(), "scripts/shirube/validate-goal-run.mjs");
  const rejected = spawnSync(process.execPath, [validator, "--file", falsePath, "--format", "json"], { encoding: "utf8" });
  const report = JSON.parse(rejected.stdout);
  check(rejected.status === 1 && report.would_block === true, "false completion must be rejected");
  check(report.blockers.some((row) => ["GOAL-RUN-070", "GOAL-RUN-072", "GOAL-RUN-073", "GOAL-RUN-076"].includes(row.item_id)), "false completion rejection must be evidence/target based");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`Shirube V4 GoalRun adoption tests passed (${assertions} assertions).`);
