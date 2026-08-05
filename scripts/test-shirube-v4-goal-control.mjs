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

const statusA = run(["status"], 1);
const statusB = run(["status"], 1);
check(canonicalJson(statusA) === canonicalJson(statusB), "status readback must be deterministic across process restart");
check(statusA.targets.total === 35 && statusA.targets.live_exact === 0, "frozen target denominator must be 35 with no false live completion");
check(statusA.generation === 2 && statusA.status === "BLOCKED", "release import failure must advance the GoalRun to an explicit blocked generation 2");
check(statusA.acceptance.total === 11 && statusA.acceptance.passed === 1, "blocked release must not falsely advance pre-rollout predicates");
check(statusA.next_work_item?.work_item_id === "WORK-ITEM-KUSABI-IMMUTABLE-RUNTIME-RELEASE", "blocked WorkItem must remain the immutable runtime release");
check(statusA.next_work_item?.status === "BLOCKED" && statusA.can_continue === false, "blocked release must prevent R1 continuation");
check(statusA.next_action?.actor_agent_id === "kusabi" && statusA.next_action?.active_function === "implementation_executor", "release correction must route to Kusabi");
check(statusA.next_action?.blocking === true && statusA.next_action?.action.includes("five required entrypoints"), "release blocker must carry an exact removal action");

const workItems = checkReport.work_item_validators.map((row) => JSON.parse(readFileSync(repoPath(row.report.file), "utf8")));
const inMemoryStatus = buildStatus(JSON.parse(readFileSync(GOAL, "utf8")), workItems);
check(canonicalJson(inMemoryStatus) === canonicalJson(statusA), "checkpoint recovery must reproduce exact status");

const reconcileScratch = mkdtempSync(join(tmpdir(), "shirube-v4-prerollout-reconcile-"));
try {
  cpSync(join(ROOT, ".shirube"), join(reconcileScratch, ".shirube"), { recursive: true });
  run(["init", "--root", reconcileScratch, "--source-root", ROOT, "--framework-root", frameworkRoot()]);
  run(["advance-exact-merge", "--root", reconcileScratch, "--framework-root", frameworkRoot()]);
  const rejected = spawnSync(process.execPath, [CONTROL, "reconcile-prerollout", "--root", reconcileScratch, "--framework-root", frameworkRoot()], { cwd: ROOT, encoding: "utf8" });
  check(rejected.status === 1 && rejected.stderr.includes("not self-contained"), "reconciliation must reject a non-executable immutable release");
  const blockReport = run(["record-prerollout-blocker", "--root", reconcileScratch, "--framework-root", frameworkRoot()]);
  check(blockReport.verdict === "PASS", "recorded release blocker must remain canonically valid");
  const blockedStatus = run(["status", "--root", reconcileScratch], 1);
  check(blockedStatus.generation === 2 && blockedStatus.status === "BLOCKED", "release failure must be restart-readable as blocked generation 2");
  check(blockedStatus.next_action?.blocking === true && blockedStatus.can_continue === false, "blocked status must stop protected rollout with an exact next action");
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
