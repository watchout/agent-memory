#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const SCHEMA = "shirube-rapid-lite-ci-hard-block/v1";
const DEFAULT_BASE = "origin/main";

function main() {
  const options = parseArgs(process.argv.slice(2));
  const event = readJsonOption(options.event);
  const comments = readJsonOption(options.comments) ?? [];
  const enforce = options.enforce === true || options.enforce === "true";
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
  let auditBridge = { required: false, status: "not_required" };

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

  if (handoff) {
    auditBridge = checkCellAuditBridge({ docs, changedFiles, actualHead, handoff });
    findings.push(...auditBridge.findings);
    warnings.push(...auditBridge.warnings);
    evidence.push(...auditBridge.evidence);
  }

  const ownerDecision = findOwnerDecisionDoc(comments, actualHead, handoff?.ownerActor);
  if (!ownerDecision.found) {
    findings.push(finding("RL-MERGE-001", "owner_decision_missing", "Owner APPROVED_EXACT_HEAD decision is missing.", "owner_decision"));
  } else if (!ownerDecision.actorMatched) {
    findings.push(finding("RL-MERGE-003", "owner_decision_actor_mismatch", `Owner decision author ${ownerDecision.actor ?? "unknown"} does not match expected owner ${handoff?.ownerActor ?? "unknown"}.`, "owner_decision.actor"));
  } else if (!ownerDecision.exactHeadMatched) {
    findings.push(finding("RL-MERGE-002", "merge_head_mismatch", "Owner decision does not match the current exact head.", "owner_decision.exact_head_sha"));
  } else {
    evidence.push({ code: "owner_decision", source: "pr_comment", detail: `APPROVED_EXACT_HEAD by ${ownerDecision.actor} matched current head` });
  }

  if (changedFiles.length > 12) {
    warnings.push(finding("RL-PR-W001", "PR_size_large", "Changed file count exceeds Rapid/Lite gate threshold.", "changed_files"));
  }

  const hardBlocks = uniqueFindings(findings);
  const uniqueWarnings = uniqueFindings(warnings);
  const verdict = hardBlocks.length > 0 ? "BLOCKED" : uniqueWarnings.length > 0 ? "PASS_WITH_WARN" : "PASS";
  const report = {
    schema: SCHEMA,
    report_only: !enforce,
    enforcement: enforce ? "ci_hard_block" : "report_only",
    mode: handoff?.mode ?? "unknown",
    profile: handoff?.profile ?? "unknown",
    verdict,
    would_block: hardBlocks.length > 0,
    owner_must_not_merge: hardBlocks.length > 0,
    head_sha: actualHead,
    handoff_ref: handoffPath ?? null,
    cell_id: handoff?.cellId ?? null,
    cell_type: handoff?.cellType ?? null,
    audit_bridge: {
      required: auditBridge.required,
      status: auditBridge.status,
      audit_ref: auditBridge.auditRef ?? null,
      item_set_ref: auditBridge.itemSetRef ?? null,
    },
    changed_files: changedFiles,
    hard_blocks: hardBlocks,
    warnings: uniqueWarnings,
    evidence,
    boundary: {
      required_check_active: false,
      branch_protection_changed: false,
      ci_hard_block_active: enforce,
      report_only: !enforce,
    },
  };

  const output = stringOption(options.output);
  if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  appendStepSummary(renderMarkdown(report));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (enforce && hardBlocks.length > 0) process.exitCode = 1;
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
  const candidates = Array.from(new Set([...matches, ...changed]));
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? null;
}

function checkCellAuditBridge({ docs, changedFiles, actualHead, handoff }) {
  const findings = [];
  const warnings = [];
  const evidence = [];
  const required = true;
  const candidates = discoverAuditRecords(docs, changedFiles);

  if (candidates.length === 0) {
    findings.push(finding("RL-AUDIT-001", "missing_cell_audit_record", "CELL audit record is required for Shirube-controlled PRs.", "audit_record"));
    return { required, status: "missing", findings, warnings, evidence };
  }

  const parsed = candidates.map((candidate) => parseAuditCandidate(candidate));
  const parseFailures = parsed.filter((candidate) => candidate.error);
  for (const candidate of parseFailures) {
    findings.push(finding("RL-AUDIT-002", "invalid_audit_record_json", `${candidate.ref}: ${candidate.error}`, candidate.ref));
  }

  const validRecords = parsed.filter((candidate) => candidate.record);
  const matching = validRecords.find((candidate) =>
    candidate.record.target_head === actualHead &&
    Array.isArray(candidate.record.target_refs) &&
    candidate.record.target_refs.includes(handoff.cellId) &&
    candidate.record.target_refs.includes(handoff.filePath)
  );

  if (!matching) {
    const headMatches = validRecords.filter((candidate) => candidate.record.target_head === actualHead);
    const detail = headMatches.length === 0
      ? `No audit record targets exact head ${actualHead}.`
      : `No audit record for exact head ${actualHead} targets both ${handoff.cellId} and ${handoff.filePath}.`;
    findings.push(finding("RL-AUDIT-003", "audit_record_target_mismatch", detail, "audit_record.target_refs"));
    return { required, status: "target_mismatch", findings, warnings, evidence };
  }

  evidence.push({ code: "cell_audit_record", source: matching.source, detail: matching.ref });
  const validation = validateCellAuditRecord(matching.record, matching.ref, actualHead, handoff);
  findings.push(...validation.findings);
  warnings.push(...validation.warnings);
  evidence.push(...validation.evidence);

  return {
    required,
    status: validation.findings.length > 0 ? "blocked" : validation.warnings.length > 0 ? "pass_with_warn" : "pass",
    auditRef: matching.ref,
    itemSetRef: validation.itemSetRef,
    findings,
    warnings,
    evidence,
  };
}

function discoverAuditRecords(docs, changedFiles) {
  const candidates = [];
  const seen = new Set();
  let inlineIndex = 0;

  for (const doc of docs) {
    const inlineBlocks = Array.from(doc.matchAll(/<!--\s*shirube-audit-record\/v1\s*-->\s*```json\s*([\s\S]*?)```/g));
    for (const match of inlineBlocks) {
      inlineIndex++;
      const ref = `inline:audit-record:${inlineIndex}`;
      candidates.push({ ref, source: "pr_comment", jsonText: match[1] });
    }
  }

  const combinedDocs = docs.join("\n");
  const paths = [
    ...Array.from(combinedDocs.matchAll(/\.shirube\/audits\/[A-Za-z0-9_.\/-]+\.json/g)).map((match) => match[0]),
    ...changedFiles.filter((file) => /^\.shirube\/audits\/.+\.json$/.test(file)),
  ];

  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    candidates.push({ ref: path, source: "file", filePath: path });
  }

  return candidates;
}

function parseAuditCandidate(candidate) {
  try {
    const jsonText = candidate.filePath ? readFileSync(candidate.filePath, "utf8") : candidate.jsonText;
    const record = JSON.parse(jsonText);
    return { ...candidate, record };
  } catch (error) {
    return { ...candidate, error: error instanceof Error ? error.message : String(error) };
  }
}

function validateCellAuditRecord(record, recordRef, actualHead, handoff) {
  const findings = [];
  const warnings = [];
  const evidence = [];
  const requiredFields = [
    "schema_version",
    "document_type",
    "audit_id",
    "audit_type",
    "stage",
    "reviewer_actor",
    "reviewer_model",
    "implementation_actor",
    "implementation_model",
    "target_head",
    "target_refs",
    "item_set_ref",
    "items",
    "aggregate_verdict",
  ];

  for (const field of requiredFields) {
    if (!present(record[field])) {
      findings.push(finding("RL-AUDIT-004", "audit_record_missing_required_field", `Audit record is missing ${field}.`, `${recordRef}.${field}`));
    }
  }

  if (record.schema_version !== "shirube-audit/v1") {
    findings.push(finding("RL-AUDIT-004", "audit_record_schema_mismatch", "Audit record schema_version must be shirube-audit/v1.", `${recordRef}.schema_version`));
  }
  if (record.document_type !== "audit_record") {
    findings.push(finding("RL-AUDIT-004", "audit_record_document_type_mismatch", "Audit record document_type must be audit_record.", `${recordRef}.document_type`));
  }
  if (typeof record.target_head !== "string" || !/^[0-9a-f]{40}$/i.test(record.target_head)) {
    findings.push(finding("RL-AUDIT-004", "audit_record_head_invalid", "Audit record target_head must be a real 40-character SHA.", `${recordRef}.target_head`));
  } else if (record.target_head !== actualHead) {
    findings.push(finding("RL-AUDIT-003", "audit_record_head_mismatch", `Audit record target_head ${record.target_head} does not match current head ${actualHead}.`, `${recordRef}.target_head`));
  }

  if (!Array.isArray(record.target_refs)) {
    findings.push(finding("RL-AUDIT-004", "audit_record_target_refs_invalid", "Audit record target_refs must be an array.", `${recordRef}.target_refs`));
  } else {
    if (!record.target_refs.includes(handoff.cellId)) {
      findings.push(finding("RL-AUDIT-003", "audit_record_cell_mismatch", `Audit record target_refs must include ${handoff.cellId}.`, `${recordRef}.target_refs`));
    }
    if (!record.target_refs.includes(handoff.filePath)) {
      findings.push(finding("RL-AUDIT-003", "audit_record_handoff_mismatch", `Audit record target_refs must include ${handoff.filePath}.`, `${recordRef}.target_refs`));
    }
  }

  if (record.reviewer_actor === record.implementation_actor) {
    findings.push(finding("RL-AUDIT-005", "maker_checker_actor_not_separated", "Audit reviewer_actor must differ from implementation_actor.", `${recordRef}.reviewer_actor`));
  }
  if (record.reviewer_model === record.implementation_model) {
    findings.push(finding("RL-AUDIT-005", "maker_checker_model_not_separated", "Audit reviewer_model must differ from implementation_model.", `${recordRef}.reviewer_model`));
  }

  if (!["PASS", "PASS_WITH_WARN"].includes(record.aggregate_verdict)) {
    findings.push(finding("RL-AUDIT-006", "audit_aggregate_not_pass", "Audit aggregate_verdict must be PASS or PASS_WITH_WARN before merge.", `${recordRef}.aggregate_verdict`));
  }

  const itemSetRef = typeof record.item_set_ref === "string" ? record.item_set_ref : null;
  if (!itemSetRef || !existsSync(itemSetRef)) {
    findings.push(finding("RL-AUDIT-007", "audit_item_set_missing", `Audit item set is not readable: ${itemSetRef ?? "missing"}.`, `${recordRef}.item_set_ref`));
    return { findings, warnings, evidence, itemSetRef };
  }

  let itemSet = null;
  try {
    itemSet = JSON.parse(readFileSync(itemSetRef, "utf8"));
  } catch (error) {
    findings.push(finding("RL-AUDIT-007", "audit_item_set_invalid_json", `${itemSetRef}: ${error instanceof Error ? error.message : String(error)}`, itemSetRef));
    return { findings, warnings, evidence, itemSetRef };
  }

  evidence.push({ code: "cell_audit_item_set", source: "file", detail: itemSetRef });
  findings.push(...validateAuditItemSet(itemSet, itemSetRef));

  if (itemSet.stage && record.stage && itemSet.stage !== record.stage) {
    findings.push(finding("RL-AUDIT-008", "audit_stage_mismatch", `Audit record stage ${record.stage} does not match item set stage ${itemSet.stage}.`, `${recordRef}.stage`));
  }

  if (!Array.isArray(record.items)) {
    findings.push(finding("RL-AUDIT-004", "audit_items_invalid", "Audit record items must be an array.", `${recordRef}.items`));
    return { findings, warnings, evidence, itemSetRef };
  }

  const requiredIds = Array.isArray(itemSet.items)
    ? itemSet.items.map((item) => item?.item_id).filter((id) => typeof id === "string")
    : [];
  const seen = new Map();
  const validVerdicts = new Set(["PASS", "FAIL", "WAIVED"]);

  record.items.forEach((item, index) => {
    const path = `${recordRef}.items.${index}`;
    if (!item || typeof item !== "object") {
      findings.push(finding("RL-AUDIT-009", "audit_item_invalid", "Audit item must be an object.", path));
      return;
    }

    const itemId = item.item_id;
    if (typeof itemId !== "string" || itemId.length === 0) {
      findings.push(finding("RL-AUDIT-009", "audit_item_id_missing", "Audit item item_id is required.", `${path}.item_id`));
      return;
    }
    if (seen.has(itemId)) {
      findings.push(finding("RL-AUDIT-010", "audit_item_duplicate", `${itemId} appears more than once in audit record.`, `${path}.item_id`));
    }
    seen.set(itemId, path);

    if (!validVerdicts.has(item.verdict)) {
      findings.push(finding("RL-AUDIT-011", "audit_item_verdict_invalid", `${itemId} verdict must be PASS, FAIL, or WAIVED.`, `${path}.verdict`));
    }
    if (item.verdict === "FAIL") {
      findings.push(finding("RL-AUDIT-012", "audit_item_failed", `${itemId} is FAIL.`, `${path}.verdict`));
    }
    if (item.verdict === "WAIVED") {
      warnings.push(finding("RL-AUDIT-W001", "audit_item_waived", `${itemId} is WAIVED and requires owner waiver awareness.`, `${path}.verdict`));
      if (!isDurableEvidenceRef(item.waiver_ref)) {
        findings.push(finding("RL-AUDIT-013", "audit_waiver_ref_missing", `${itemId} is WAIVED but waiver_ref is missing or non-durable.`, `${path}.waiver_ref`));
      }
    }
    if (typeof item.reason !== "string" || item.reason.trim().length === 0) {
      findings.push(finding("RL-AUDIT-014", "audit_item_reason_missing", `${itemId} requires a reason.`, `${path}.reason`));
    }
    if (!Array.isArray(item.evidence_ref) || item.evidence_ref.length === 0 || !item.evidence_ref.every(isDurableEvidenceRef)) {
      findings.push(finding("RL-AUDIT-015", "audit_item_evidence_missing", `${itemId} requires durable evidence_ref entries.`, `${path}.evidence_ref`));
    }
  });

  for (const itemId of requiredIds) {
    if (!seen.has(itemId)) {
      findings.push(finding("RL-AUDIT-016", "audit_item_missing", `Required audit item ${itemId} is missing.`, `${recordRef}.items`));
    }
  }
  for (const [itemId, path] of seen.entries()) {
    if (!requiredIds.includes(itemId)) {
      findings.push(finding("RL-AUDIT-017", "audit_item_extra", `Audit item ${itemId} is not in the item set.`, path));
    }
  }

  return { findings, warnings, evidence, itemSetRef };
}

function validateAuditItemSet(itemSet, itemSetRef) {
  const findings = [];
  if (itemSet.schema_version !== "shirube-audit/v1") {
    findings.push(finding("RL-AUDIT-007", "audit_item_set_schema_mismatch", "Audit item set schema_version must be shirube-audit/v1.", `${itemSetRef}.schema_version`));
  }
  if (itemSet.document_type !== "audit_item_set") {
    findings.push(finding("RL-AUDIT-007", "audit_item_set_document_type_mismatch", "Audit item set document_type must be audit_item_set.", `${itemSetRef}.document_type`));
  }
  if (typeof itemSet.item_set_id !== "string" || !/^AUDIT-ITEM-SET-[A-Z0-9-]+$/.test(itemSet.item_set_id)) {
    findings.push(finding("RL-AUDIT-007", "audit_item_set_id_invalid", "Audit item set item_set_id is invalid.", `${itemSetRef}.item_set_id`));
  }
  if (!Array.isArray(itemSet.items) || itemSet.items.length === 0) {
    findings.push(finding("RL-AUDIT-007", "audit_item_set_items_missing", "Audit item set must contain items.", `${itemSetRef}.items`));
    return findings;
  }
  const seen = new Set();
  for (let index = 0; index < itemSet.items.length; index++) {
    const item = itemSet.items[index];
    const path = `${itemSetRef}.items.${index}`;
    if (!item || typeof item !== "object") {
      findings.push(finding("RL-AUDIT-007", "audit_item_set_item_invalid", "Audit item set item must be an object.", path));
      continue;
    }
    if (typeof item.item_id !== "string" || item.item_id.length === 0) {
      findings.push(finding("RL-AUDIT-007", "audit_item_set_item_id_missing", "Audit item set item_id is required.", `${path}.item_id`));
    } else if (seen.has(item.item_id)) {
      findings.push(finding("RL-AUDIT-007", "audit_item_set_duplicate_item_id", `${item.item_id} appears more than once in the item set.`, `${path}.item_id`));
    } else {
      seen.add(item.item_id);
    }
    if (typeof item.criterion !== "string" || item.criterion.trim().length === 0) {
      findings.push(finding("RL-AUDIT-007", "audit_item_set_criterion_missing", `${item.item_id ?? path} requires criterion.`, `${path}.criterion`));
    }
    if (!Array.isArray(item.required_evidence) || item.required_evidence.length === 0) {
      findings.push(finding("RL-AUDIT-007", "audit_item_set_required_evidence_missing", `${item.item_id ?? path} requires required_evidence.`, `${path}.required_evidence`));
    }
  }
  return findings;
}

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim().length === 0);
}

function isDurableEvidenceRef(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return !/^<[^>]+>$|placeholder|pending|\btbd\b|^n\/a$|^none$/i.test(trimmed);
}

function parseHandoff(text, filePath) {
  return {
    filePath,
    mode: scalar(text, "mode"),
    profile: scalar(text, "profile"),
    frameworkRef: scalar(text, "framework_ref") ?? scalar(text, "framework_lock_ref"),
    repoLocalIssue: scalar(text, "repo_local_issue"),
    ownerActor: scalar(text, "actor"),
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

function findOwnerDecisionDoc(comments, head, ownerActor) {
  let firstParsedDecision = null;
  for (const comment of comments) {
    const doc = typeof comment?.body === "string" ? comment.body : "";
    const parsedDecision = parseOwnerDecisionOnlyComment(doc);
    if (!parsedDecision) continue;
    const actor = typeof comment?.user?.login === "string" ? comment.user.login : null;
    const decision = {
      found: true,
      actor,
      actorMatched: !ownerActor || actor === ownerActor,
      exactHeadMatched: Boolean(head && parsedDecision.exactHead.toLowerCase() === String(head).toLowerCase()),
    };
    if (decision.actorMatched && decision.exactHeadMatched) return decision;
    firstParsedDecision ??= decision;
  }
  return firstParsedDecision ?? { found: false, actor: null, actorMatched: false, exactHeadMatched: false };
}

function parseOwnerDecisionOnlyComment(doc) {
  const withoutHtmlComments = doc.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!withoutHtmlComments || withoutHtmlComments.includes("```")) return null;
  const lines = withoutHtmlComments
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 2) return null;

  const decisionMatch = lines[0].match(
    /^Owner(?:\/domain-designer)? decision for PR #(\d+):\s*APPROVED_EXACT_HEAD\.?$/i
  );
  const headMatch = lines[1].match(/^Exact head:\s*([0-9a-f]{40})\.?$/i);
  if (!decisionMatch || !headMatch) return null;
  return {
    prNumber: decisionMatch[1],
    exactHead: headMatch[1],
  };
}

function runOwnerDecisionParserSelfTest() {
  const head = "eaa6fbf1c40be034147a2d6e11c3beb1e8cdae16";
  const validDecision = [
    `Owner decision for PR #213: APPROVED_EXACT_HEAD.`,
    `Exact head: ${head}`,
  ].join("\n");
  const sampleDecision = [
    "Required owner comment before merge:",
    "",
    "```text",
    `Owner decision for PR #213: APPROVED_EXACT_HEAD.`,
    `Exact head: ${head}`,
    "```",
  ].join("\n");
  const correctionText = [
    "Owner must not approve or merge this PR based only on the previous Codex audit comment.",
    "",
    `Owner decision for PR #213: APPROVED_EXACT_HEAD.`,
    `Exact head: ${head}`,
  ].join("\n");
  const quotedDecision = [
    "> Owner decision for PR #213: APPROVED_EXACT_HEAD.",
    `> Exact head: ${head}`,
  ].join("\n");
  const wrongHeadDecision = [
    `Owner decision for PR #213: APPROVED_EXACT_HEAD.`,
    `Exact head: ${"f".repeat(40)}`,
  ].join("\n");

  assertSelfTest(
    findOwnerDecisionDoc([{ user: { login: "watchout" }, body: validDecision }], head, "watchout").exactHeadMatched,
    "accepts exact decision-only owner comment"
  );
  assertSelfTest(
    !findOwnerDecisionDoc([{ user: { login: "watchout" }, body: sampleDecision }], head, "watchout").found,
    "rejects fenced sample owner decision"
  );
  assertSelfTest(
    !findOwnerDecisionDoc([{ user: { login: "watchout" }, body: correctionText }], head, "watchout").found,
    "rejects owner decision embedded in correction prose"
  );
  assertSelfTest(
    !findOwnerDecisionDoc([{ user: { login: "watchout" }, body: quotedDecision }], head, "watchout").found,
    "rejects quoted owner decision"
  );
  assertSelfTest(
    !findOwnerDecisionDoc([{ user: { login: "other" }, body: validDecision }], head, "watchout").actorMatched,
    "preserves owner actor check"
  );
  assertSelfTest(
    !findOwnerDecisionDoc([{ user: { login: "watchout" }, body: wrongHeadDecision }], head, "watchout").exactHeadMatched,
    "preserves exact head check"
  );
  assertSelfTest(
    findOwnerDecisionDoc([
      { user: { login: "watchout" }, body: wrongHeadDecision },
      { user: { login: "watchout" }, body: validDecision },
    ], head, "watchout").exactHeadMatched,
    "accepts a later matching decision-only owner comment"
  );
  process.stdout.write("owner decision parser self-test: PASS\n");
}

function assertSelfTest(condition, message) {
  if (!condition) throw new Error(`owner decision parser self-test failed: ${message}`);
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
    "## Shirube Rapid/Lite Gate",
    "",
    `- Verdict: \`${report.verdict}\``,
    `- Would block: \`${report.would_block}\``,
    `- Owner must not merge: \`${report.owner_must_not_merge}\``,
    `- Report-only: \`${report.report_only}\``,
    `- Enforcement: \`${report.enforcement ?? "report_only"}\``,
    `- Head: \`${report.head_sha}\``,
    `- Handoff: \`${report.handoff_ref ?? "missing"}\``,
    `- Cell: \`${report.cell_id ?? "missing"}\``,
    `- Audit bridge required: \`${report.audit_bridge?.required ?? false}\``,
    `- Audit bridge status: \`${report.audit_bridge?.status ?? "unknown"}\``,
    `- Audit record: \`${report.audit_bridge?.audit_ref ?? "missing"}\``,
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
    report.enforcement === "ci_hard_block"
      ? "This check fails the CI job when would_block=true. It does not mutate branch protection or repository rulesets."
      : "This check is visible/report-only. It does not activate a required check, mutate branch protection, or enforce merge blocking by exit code.",
    "",
  ].join("\n");
}

try {
  if (process.argv.includes("--self-test-owner-decision-parser")) {
    runOwnerDecisionParserSelfTest();
  } else {
    main();
  }
} catch (error) {
  const report = {
    schema: SCHEMA,
    report_only: false,
    enforcement: "ci_hard_block",
    verdict: "FAILURE",
    would_block: true,
    owner_must_not_merge: true,
    hard_blocks: [finding("RL-INFRA-001", "gate_runtime_failure", error instanceof Error ? error.message : String(error), "script")],
  };
  appendStepSummary(renderMarkdown({ ...report, warnings: [], changed_files: [], head_sha: "unknown", handoff_ref: null, cell_id: null }));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
}
