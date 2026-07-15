#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const gatePath = resolve(new URL("./rapid-lite-gate.mjs", import.meta.url).pathname);
const requiredItems = Array.from({ length: 12 }, (_, index) => `KRL-${String(index + 1).padStart(3, "0")}`);

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Rapid Lite Test",
      GIT_AUTHOR_EMAIL: "rapid-lite@example.invalid",
      GIT_COMMITTER_NAME: "Rapid Lite Test",
      GIT_COMMITTER_EMAIL: "rapid-lite@example.invalid",
    },
  }).trim();
}

function canonicalHandoff({ repository = "watchout/agent-memory", pullRequest = 252, cellId = "CELL-KUSABI-PR252-RAPID-LITE-ROUTE-RECONCILIATION-001" } = {}) {
  return [
    "<!-- shirube-v3:control-handoff:TEST -->",
    "```yaml",
    "schema_version: shirube-v3/control_handoff/v1",
    "control_source: https://github.com/watchout/agent-memory/issues/180",
    "framework_ref: watchout/ai-dev-framework@5eb57d483947d279c6feb8f2f0eed58aed8b20d2",
    "owner:",
    "  actor: watchout",
    "cell:",
    `  id: ${cellId}`,
    "  cell_type: control_route_reconciliation",
    "  risk_class: R0",
    "execution_context:",
    "  to:",
    "    agent_id: kusabi",
    "repository:",
    `  name: ${repository}`,
    `  pull_request: ${pullRequest}`,
    "allowed_paths:",
    "  - allowed.txt",
    "forbidden_paths:",
    "  - .shirube/**",
    "stop_conditions:",
    "  - any out-of-scope edit",
    "required_evidence:",
    "  - exact head",
    "audit_checklist:",
    "  audit_checklist_id: AUDIT-CHECKLIST-KUSABI-PR252-RL-RECON-001",
    "  required_item_ids:",
    ...requiredItems.map((item) => `    - ${item}`),
    "next_action:",
    "  blocking: true",
    "```",
  ].join("\n");
}

function implementationEvidence({ head, cellId = "CELL-KUSABI-PR252-RAPID-LITE-ROUTE-RECONCILIATION-001" }) {
  return [
    "<!-- shirube-v3:implementation-evidence:TEST -->",
    "```yaml",
    "schema_version: shirube-v3/implementation_evidence/v1",
    "repository: watchout/agent-memory",
    "pull_request: 252",
    `cell_id: ${cellId}`,
    "control_handoff: https://github.com/watchout/agent-memory/pull/252#issuecomment-1",
    `exact_head: ${head}`,
    "implementation_actor: kusabi",
    "validation_status: PASS",
    "no_shirube_changes: true",
    "validation:",
    "  commands:",
    "    - git diff --check",
    "  results:",
    "    - PASS",
    "```",
  ].join("\n");
}

function structuredAudit({
  head,
  cellId = "CELL-KUSABI-PR252-RAPID-LITE-ROUTE-RECONCILIATION-001",
  checklistId = "AUDIT-CHECKLIST-KUSABI-PR252-RL-RECON-001",
  reviewerActor = "codex-audit",
} = {}) {
  return [
    `<!-- shirube-v3:evidence-audit-gate-result:PR252-${head.slice(0, 7).toUpperCase()} -->`,
    "```yaml",
    "schema_version: shirube-structured-audit/v1",
    `audit_checklist_id: ${checklistId}`,
    `reviewer_actor: ${reviewerActor}`,
    "implementation_actor: kusabi",
    "execution_context:",
    `  agent_id: ${reviewerActor}`,
    "  active_function: evidence_audit_gate",
    "target:",
    "  repository: watchout/agent-memory",
    "  pull_request: 252",
    `  cell_id: ${cellId}`,
    "  control_handoff: https://github.com/watchout/agent-memory/pull/252#issuecomment-1",
    `  exact_head: ${head}`,
    "items:",
    ...requiredItems.flatMap((item) => [`  - item_id: ${item}`, "    verdict: PASS"]),
    "aggregate_verdict: PASS",
    "next_action: none",
    "```",
  ].join("\n");
}

function comment(id, body, { login = "watchout", authorAssociation = "OWNER" } = {}) {
  return {
    id,
    html_url: `https://github.com/watchout/agent-memory/pull/252#issuecomment-${id}`,
    user: { login },
    author_association: authorAssociation,
    body,
  };
}

function fixture() {
  const cwd = mkdtempSync(`${tmpdir()}/rapid-lite-gate-`);
  git(cwd, "init", "-q");
  writeFileSync(`${cwd}/allowed.txt`, "base\n");
  git(cwd, "add", "allowed.txt");
  git(cwd, "commit", "-qm", "base");
  const base = git(cwd, "rev-parse", "HEAD");
  writeFileSync(`${cwd}/allowed.txt`, "head\n");
  git(cwd, "add", "allowed.txt");
  git(cwd, "commit", "-qm", "head");
  const head = git(cwd, "rev-parse", "HEAD");
  const eventPath = `${cwd}/event.json`;
  writeFileSync(eventPath, JSON.stringify({
    repository: { full_name: "watchout/agent-memory" },
    pull_request: { number: 252, head: { sha: head }, body: "" },
  }));
  return { cwd, base, head, eventPath };
}

function runGate(fx, comments) {
  const commentsPath = `${fx.cwd}/comments.json`;
  writeFileSync(commentsPath, JSON.stringify(comments));
  const result = spawnSync(process.execPath, [
    gatePath,
    "--event", fx.eventPath,
    "--comments", commentsPath,
    "--base", fx.base,
    "--head", fx.head,
    "--enforce", "false",
  ], { cwd: fx.cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function itemIds(report) {
  return report.hard_blocks.map((item) => item.item_id);
}

function codes(report) {
  return report.hard_blocks.map((item) => item.code);
}

const fx = fixture();
try {
  const valid = [
    comment(1, canonicalHandoff()),
    comment(2, implementationEvidence({ head: fx.head })),
    comment(3, structuredAudit({ head: fx.head }), { login: "iyasaka-ai", authorAssociation: "COLLABORATOR" }),
  ];

  const terminal = runGate(fx, valid);
  assert.deepEqual(itemIds(terminal), ["RL-MERGE-001"]);
  assert.equal(terminal.handoff_ref, "https://github.com/watchout/agent-memory/pull/252#issuecomment-1");
  assert.equal(terminal.cell_id, "CELL-KUSABI-PR252-RAPID-LITE-ROUTE-RECONCILIATION-001");
  assert.equal(terminal.audit_bridge.status, "pass");

  assert(itemIds(runGate(fx, valid.slice(1))).includes("RL-GOAL-001"), "missing handoff must fail closed");
  assert(itemIds(runGate(fx, [comment(1, canonicalHandoff()), comment(4, canonicalHandoff({ cellId: "CELL-CONFLICT" })), ...valid.slice(1)])).includes("RL-GOAL-001"), "conflicting handoffs must fail closed");
  assert(itemIds(runGate(fx, [comment(1, canonicalHandoff({ repository: "wrong/repo" })), ...valid.slice(1)])).includes("RL-GOAL-001"), "wrong repo must fail closed");
  assert(itemIds(runGate(fx, [comment(1, canonicalHandoff({ pullRequest: 999 })), ...valid.slice(1)])).includes("RL-GOAL-001"), "wrong PR must fail closed");
  assert(itemIds(runGate(fx, [...valid, comment(4, implementationEvidence({ head: fx.head, cellId: "CELL-CONFLICT" }))])).includes("RL-EVID-001"), "conflicting implementation evidence must fail closed");
  assert(itemIds(runGate(fx, [...valid, comment(4, structuredAudit({ head: fx.head, cellId: "CELL-CONFLICT" }))])).includes("RL-AUDIT-003"), "conflicting audit evidence must fail closed");

  const wrongChecklist = runGate(fx, [
    ...valid.slice(0, 2),
    comment(3, structuredAudit({ head: fx.head, checklistId: "WRONG-CHECKLIST-ID" }), { login: "iyasaka-ai", authorAssociation: "COLLABORATOR" }),
  ]);
  assert(codes(wrongChecklist).includes("audit_checklist_id_mismatch"), "wrong checklist ID must fail closed");

  const untrustedReviewer = runGate(fx, [
    ...valid.slice(0, 2),
    comment(3, structuredAudit({ head: fx.head, reviewerActor: "fake-auditor" }), { login: "iyasaka-ai", authorAssociation: "COLLABORATOR" }),
  ]);
  assert(codes(untrustedReviewer).includes("audit_reviewer_provenance_untrusted"), "untrusted reviewer actor must fail closed");

  const selfAuthoredAudit = runGate(fx, [
    ...valid.slice(0, 2),
    comment(3, structuredAudit({ head: fx.head }), { login: "watchout", authorAssociation: "OWNER" }),
  ]);
  assert(codes(selfAuthoredAudit).includes("audit_reviewer_provenance_untrusted"), "implementation-seat GitHub author must fail closed");

  const wrongCell = runGate(fx, [
    comment(1, canonicalHandoff()),
    comment(2, implementationEvidence({ head: fx.head, cellId: "CELL-WRONG" })),
    comment(3, structuredAudit({ head: fx.head, cellId: "CELL-WRONG" })),
  ]);
  assert(itemIds(wrongCell).includes("RL-EVID-001"), "wrong implementation cell must fail closed");
  assert(itemIds(wrongCell).includes("RL-AUDIT-003"), "wrong audit cell must fail closed");

  const wrongHead = runGate(fx, [
    comment(1, canonicalHandoff()),
    comment(2, implementationEvidence({ head: "f".repeat(40) })),
    comment(3, structuredAudit({ head: "f".repeat(40) })),
  ]);
  assert(itemIds(wrongHead).includes("RL-EVID-001"), "wrong implementation head must fail closed");
  assert(itemIds(wrongHead).includes("RL-AUDIT-001"), "wrong audit head must fail closed");

  process.stdout.write("rapid-lite canonical comment route tests: PASS\n");
} finally {
  rmSync(fx.cwd, { recursive: true, force: true });
}
