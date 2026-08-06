#!/usr/bin/env node

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildStatus,
  canonicalJson,
  computeGoalRunStateDigest,
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
const AGENTS = join(ROOT, "AGENTS.md");
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
check(checkReport.generation_history.generation_4.state_digest === checkReport.status.state_digest, "generation 4 history readback must bind the current GoalRun state");
check(checkReport.generation_history.generation_4.evidence_ref === "file:.shirube/goal-runs/GOAL-RUN-KUSABI-OBS05-OBS06-FLEET-CLOSURE-20260804.json", "generation 4 must be reported as current without relabeling it as generation 3");

const statusA = run(["status"], 1);
const statusB = run(["status"], 1);
check(canonicalJson(statusA) === canonicalJson(statusB), "status readback must be deterministic across process restart");
check(statusA.targets.total === 35 && statusA.targets.live_exact === 0, "frozen target denominator must be 35 with no false live completion");
check(statusA.generation === 4 && statusA.status === "BLOCKED", "effective external CAS gate must block generation 4");
check(statusA.blockers.length === 1 && statusA.blockers[0]?.blocker_id === "B-03-KUSABI-CAS-B01-AUTHENTICATED-PUBLICATION-GATE" && statusA.acceptance.total === 11 && statusA.acceptance.passed === 1, "generation 4 must retain KUSABI-CAS-B01 and only A01 as verified");
check(statusA.next_work_item?.work_item_id === "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE", "candidate correction must keep immutable runtime release as the next WorkItem");
check(statusA.next_work_item?.status === "BLOCKED" && statusA.next_work_item?.required_operation === "LOCAL_DIRECT_ADAPTER" && statusA.can_continue === false, "effective external gate must dominate a locally executable adapter state");
check(statusA.next_action?.actor_agent_id === "codex-audit" && statusA.next_action?.active_function === "evidence_audit_gate", "generation 4 must route the completed correction to the maker-separated auditor");
check(statusA.next_action?.blocking === true && statusA.next_action?.exact_input_refs?.includes("file:.shirube/control-handoffs/CH-KUSABI-CAS-B01-DIRECT-SUCCESSOR-20260807-001.yaml"), "generation 4 routing must bind the exact bounded successor and remain blocking");

const workItems = checkReport.work_item_validators.map((row) => JSON.parse(readFileSync(repoPath(row.report.file), "utf8")));
const inMemoryStatus = buildStatus(JSON.parse(readFileSync(GOAL, "utf8")), workItems);
check(canonicalJson(inMemoryStatus) === canonicalJson(statusA), "checkpoint recovery must reproduce exact status");
const releaseItem = workItems.find((item) => item.work_item_id === "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE");
const r0Item = workItems.find((item) => item.work_item_id === "WORK-ITEM-KUSABI-R0-V3-HEARTBEAT-REPRODUCTION");
const auditItem = workItems.find((item) => item.work_item_id === "WORK-ITEM-KUSABI-R0-V3-INDEPENDENT-AUDIT");
check(releaseItem?.status === "BLOCKED" && releaseItem.terminal_evidence.length === 0, "A02 must remain blocked and nonterminal before a fresh exact audit and final publication gates");
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

const reconcileScratch = mkdtempSync(join(tmpdir(), "shirube-v4-release-r0-successor-"));
try {
  cpSync(join(ROOT, ".shirube"), join(reconcileScratch, ".shirube"), { recursive: true });
  const replayReport = run(["check", "--root", reconcileScratch, "--framework-root", frameworkRoot()]);
  check(replayReport.verdict === "PASS", "generation-4 candidate copy must remain canonical");
  const replayStatus = run(["status", "--root", reconcileScratch], 1);
  check(canonicalJson(replayStatus) === canonicalJson(statusA), "generation-4 candidate must be portable and restart-readable");
} finally {
  rmSync(reconcileScratch, { recursive: true, force: true });
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
