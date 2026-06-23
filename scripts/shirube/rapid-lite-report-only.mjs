#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const SCHEMA = "shirube-rapid-lite-report-only/v1";
const DEFAULT_BASE = "origin/main";

function main() {
  const options = parseArgs(process.argv.slice(2));
  const event = readJsonOption(options.event);
  const comments = readJsonOption(options.comments) ?? [];
  const actualHead =
    stringOption(options.head) ??
    event?.pull_request?.head?.sha ??
    git(["rev-parse", "HEAD"]).stdout.trim();
  const baseRef = stringOption(options.base) ?? DEFAULT_BASE;
  const changedFiles = readChangedFiles(baseRef);
  const docs = collectDocs(event, comments);
  const handoffPath = stringOption(options.handoff) ?? discoverHandoffPath(docs, changedFiles);
  const findings = [];
  const warnings = [];
  const evidence = [];

  let handoff = null;
  if (!handoffPath) {
    findings.push(finding("RL-GOAL-001", "missing_control_handoff", "No .shirube control handoff reference found in PR body/comments or changed files.", "handoff"));
  } else if (!existsSync(handoffPath)) {
    findings.push(finding("RL-GOAL-001", "missing_control_handoff", `Control handoff file is not readable: ${handoffPath}`, "handoff"));
  } else {
    const text = readFileSync(handoffPath, "utf8");
    handoff = parseHandoff(text, handoffPath);
    evidence.push({ code: "control_handoff", source: "file", detail: handoffPath });
  }

  if (existsSync(".shirube/repo-spec.yaml")) evidence.push({ code: "repo_spec", source: "file", detail: ".shirube/repo-spec.yaml" });
  evidence.push({ code: "changed_files", source: "git", detail: `${changedFiles.length} changed file(s)` });
  evidence.push({ code: "actual_head", source: "github", detail: actualHead });

  if (handoff) {
    requireScalar(handoff.mode, "RL-BOOT-002", "missing_mode_or_profile", "mode is required.", "mode", findings);
    requireScalar(handoff.profile, "RL-BOOT-002", "missing_mode_or_profile", "profile is required.", "profile", findings);
    requireScalar(handoff.frameworkRef, "RL-BOOT-001", "missing_framework_lock", "framework_ref is required.", "framework_ref", findings);
    requireScalar(handoff.repoLocalIssue, "RL-GOAL-002", "missing_repo_local_issue", "repo_local_issue is required.", "repo_local_issue", findings);
    requireScalar(handoff.cellId, "RL-CELL-001", "missing_cell_id", "CELL-ID is required.", "cell.CELL-ID", findings);
    requireScalar(handoff.cellType, "RL-SPEC-004", "missing_minimal_spec_boundary", "cell_type is required.", "cell.cell_type", findings);
    requireScalar(handoff.riskClass, "RL-SPEC-004", "missing_minimal_spec_boundary", "risk_class is required.", "cell.risk_class", findings);
    if (handoff.allowedPaths.length === 0) {
      findings.push(finding("RL-CELL-002", "missing_allowed_paths", "cell.allowed_paths must contain at least one path glob.", "cell.allowed_paths"));
    }
    if (handoff.forbiddenPaths.length === 0) {
      findings.push(finding("RL-CELL-003", "missing_forbidden_paths", "cell.forbidden_paths must contain at least one path glob.", "cell.forbidden_paths"));
    }
    if (handoff.stopConditions.length === 0) {
      findings.push(finding("RL-CELL-004", "missing_stop_conditions", "cell.stop_conditions must contain at least one stop condition.", "cell.stop_conditions"));
    }

    for (const file of changedFiles) {
      if (handoff.allowedPaths.length > 0 && !matchesAnyGlob(file, handoff.allowedPaths)) {
        findings.push(finding("RL-PR-002", "changed_files_outside_allowed_paths", `${file} is outside cell.allowed_paths.`, file));
      }
      if (matchesAnyGlob(file, handoff.forbiddenPaths)) {
        findings.push(finding("RL-PR-003", "forbidden_paths_touched", `${file} matches cell.forbidden_paths.`, file));
      }
    }
  }

  const combinedDocs = docs.join("\n\n");
  if (!actualHead || actualHead.length < 8) {
    findings.push(finding("RL-PR-001", "missing_pr_head_sha", "Actual PR head SHA could not be determined.", "pr_head_sha"));
  } else if (!combinedDocs.includes(actualHead)) {
    findings.push(finding("RL-PR-001", "missing_pr_head_sha", `PR evidence does not mention exact head ${actualHead}.`, "pr_head_sha"));
  }

  if (!hasValidationEvidence(combinedDocs)) {
    findings.push(finding("RL-EVID-001", "missing_validation_evidence", "PR evidence does not include required validation commands/results.", "validation_evidence"));
  }

  const ownerDecision = findOwnerDecisionDoc(docs, actualHead);
  if (!ownerDecision.found) {
    findings.push(finding("RL-MERGE-001", "owner_decision_missing", "Owner APPROVED_EXACT_HEAD decision is missing.", "owner_decision"));
  } else if (!ownerDecision.exactHeadMatched) {
    findings.push(finding("RL-MERGE-002", "merge_head_mismatch", "Owner decision does not match the current exact head.", "owner_decision.exact_head_sha"));
  } else {
    evidence.push({ code: "owner_decision", source: "pr_comment_or_body", detail: "APPROVED_EXACT_HEAD matched current head" });
  }

  if (changedFiles.length > 12) {
    warnings.push(finding("RL-PR-W001", "PR_size_large", "Changed file count exceeds Rapid/Lite report-only threshold.", "changed_files"));
  }

  const hardBlocks = uniqueFindings(findings);
  const uniqueWarnings = uniqueFindings(warnings);
  const verdict = hardBlocks.length > 0 ? "BLOCKED" : uniqueWarnings.length > 0 ? "PASS_WITH_WARN" : "PASS";
  const report = {
    schema: SCHEMA,
    report_only: true,
    mode: handoff?.mode ?? "unknown",
    profile: handoff?.profile ?? "unknown",
    verdict,
    would_block: hardBlocks.length > 0,
    owner_must_not_merge: hardBlocks.length > 0,
    head_sha: actualHead,
    handoff_ref: handoffPath ?? null,
    cell_id: handoff?.cellId ?? null,
    cell_type: handoff?.cellType ?? null,
    changed_files: changedFiles,
    hard_blocks: hardBlocks,
    warnings: uniqueWarnings,
    evidence,
    boundary: {
      required_check_active: false,
      branch_protection_changed: false,
      report_only: true,
    },
  };

  const output = stringOption(options.output);
  if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  appendStepSummary(renderMarkdown(report));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      i++;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function stringOption(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readJsonOption(filePath) {
  if (!stringOption(filePath) || !existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readChangedFiles(baseRef) {
  const result = git(["diff", "--name-only", `${baseRef}...HEAD`]);
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function git(args) {
  return spawnSync("git", args, { encoding: "utf8" });
}

function collectDocs(event, comments) {
  const docs = [];
  const body = event?.pull_request?.body;
  if (typeof body === "string") docs.push(body);
  if (Array.isArray(comments)) {
    for (const comment of comments) {
      if (typeof comment?.body === "string") docs.push(comment.body);
    }
  }
  return docs;
}

function discoverHandoffPath(docs, changedFiles) {
  const combined = docs.join("\n");
  const matches = Array.from(combined.matchAll(/\.shirube\/control-handoffs\/[A-Za-z0-9_.\/-]+\.ya?ml/g)).map((match) => match[0]);
  const changed = changedFiles.filter((file) => /^\.shirube\/control-handoffs\/.+\.ya?ml$/.test(file));
  return Array.from(new Set([...matches, ...changed]))[0] ?? null;
}

function parseHandoff(text, filePath) {
  return {
    filePath,
    mode: scalar(text, "mode"),
    profile: scalar(text, "profile"),
    frameworkRef: scalar(text, "framework_ref") ?? scalar(text, "framework_lock_ref"),
    repoLocalIssue: scalar(text, "repo_local_issue"),
    cellId: scalar(text, "CELL-ID"),
    cellType: scalar(text, "cell_type"),
    riskClass: scalar(text, "risk_class"),
    allowedPaths: list(text, "allowed_paths"),
    forbiddenPaths: list(text, "forbidden_paths"),
    stopConditions: list(text, "stop_conditions"),
  };
}

function scalar(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^\\s*${escaped}:\\s*(.+?)\\s*$`, "m"));
  if (!match) return null;
  const value = cleanYamlValue(match[1]);
  if (!value || value === "null") return null;
  return value;
}

function list(text, key) {
  const lines = text.split(/\r?\n/);
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(new RegExp(`^(\\s*)${escaped}:\\s*$`));
    if (!match) continue;
    const baseIndent = match[1].length;
    const values = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim()) continue;
      const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
      if (indent <= baseIndent) break;
      const item = line.match(/^\s*-\s+(.+?)\s*$/);
      if (item) values.push(cleanYamlValue(item[1]));
    }
    return values.filter(Boolean);
  }
  return [];
}

function cleanYamlValue(value) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function hasValidationEvidence(text) {
  const hasValidationHeading = /\bvalidation\b/i.test(text);
  const hasPass = /\bPASS\b/.test(text);
  const hasCommand = /git diff --check|npm test|npm run build|npx tsc --noEmit|build-and-test/i.test(text);
  return hasValidationHeading && hasPass && hasCommand;
}

function findOwnerDecisionDoc(docs, head) {
  for (const doc of docs) {
    const approvedDecisionLine =
      /(^|\n)\s*Owner(?:\/domain-designer)? decision for PR #\d+:\s*APPROVED_EXACT_HEAD\.?\s*(\n|$)/i.test(doc);
    if (!approvedDecisionLine) continue;
    return { found: true, exactHeadMatched: Boolean(head && doc.includes(head)) };
  }
  return { found: false, exactHeadMatched: false };
}

function requireScalar(value, itemId, code, message, path, findings) {
  if (!value) findings.push(finding(itemId, code, message, path));
}

function finding(item_id, code, message, path) {
  return { item_id, code, message, path };
}

function uniqueFindings(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.item_id}:${item.code}:${item.path}:${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function matchesAnyGlob(file, globs) {
  return globs.some((glob) => globToRegExp(glob).test(file));
}

function globToRegExp(glob) {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        pattern += ".*";
        i++;
      } else {
        pattern += "[^/]*";
      }
      continue;
    }
    pattern += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern}$`);
}

function appendStepSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  writeFileSync(summaryPath, markdown, { flag: "a" });
}

function renderMarkdown(report) {
  const blockRows = report.hard_blocks.length
    ? report.hard_blocks.map((item) => `| ${item.item_id} | ${item.code} | ${item.path} | ${item.message} |`).join("\n")
    : "| - | - | - | none |";
  const warningRows = report.warnings.length
    ? report.warnings.map((item) => `| ${item.item_id} | ${item.code} | ${item.path} | ${item.message} |`).join("\n")
    : "| - | - | - | none |";
  const changed = report.changed_files.length ? report.changed_files.map((file) => `- \`${file}\``).join("\n") : "- none";
  return [
    "## Shirube Rapid/Lite Report-Only Gate",
    "",
    `- Verdict: \`${report.verdict}\``,
    `- Would block: \`${report.would_block}\``,
    `- Owner must not merge: \`${report.owner_must_not_merge}\``,
    `- Report-only: \`${report.report_only}\``,
    `- Head: \`${report.head_sha}\``,
    `- Handoff: \`${report.handoff_ref ?? "missing"}\``,
    `- Cell: \`${report.cell_id ?? "missing"}\``,
    "",
    "### Hard Blocks",
    "",
    "| Item | Code | Path | Message |",
    "| --- | --- | --- | --- |",
    blockRows,
    "",
    "### Warnings",
    "",
    "| Item | Code | Path | Message |",
    "| --- | --- | --- | --- |",
    warningRows,
    "",
    "### Changed Files",
    "",
    changed,
    "",
    "### Boundary",
    "",
    "This check is visible/report-only. It does not activate a required check, mutate branch protection, or enforce merge blocking by exit code.",
    "",
  ].join("\n");
}

try {
  main();
} catch (error) {
  const report = {
    schema: SCHEMA,
    report_only: true,
    verdict: "FAILURE",
    would_block: true,
    owner_must_not_merge: true,
    hard_blocks: [finding("RL-INFRA-001", "gate_runtime_failure", error instanceof Error ? error.message : String(error), "script")],
  };
  appendStepSummary(renderMarkdown({ ...report, warnings: [], changed_files: [], head_sha: "unknown", handoff_ref: null, cell_id: null }));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
