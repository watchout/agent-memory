import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const VERDICTS = ["PASS", "WARN", "BLOCK"];
export const REPORT_ONLY_VERDICTS = ["PASS_WITH_WARN", "BLOCKED"];
export const FAILURE_VERDICT = "FAILURE";
export const ALL_VERDICTS = [...VERDICTS, ...REPORT_ONLY_VERDICTS, FAILURE_VERDICT];

export function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return { options, positionals };
}

export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return importMetaUrl === pathToFileURL(process.argv[1]).href;
  }
}

export function readStructuredFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return parseStructuredText(readFileSync(filePath, "utf8"), extname(filePath) === ".json");
}

export function parseStructuredText(text, json = false) {
  if (json) {
    return JSON.parse(text);
  }
  const yamlAsJson = execFileSync("ruby", [
    "-ryaml",
    "-rjson",
    "-rdate",
    "-e",
    [
      "body = YAML.safe_load(STDIN.read, permitted_classes: [Date, Time], aliases: true)",
      "puts JSON.generate(body)",
    ].join("; "),
  ], { input: text, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(yamlAsJson);
}

export function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function isValidVerdict(verdict) {
  return ALL_VERDICTS.includes(verdict);
}

export function isWouldBlockVerdict(verdict) {
  return verdict === "BLOCK" || verdict === "BLOCKED";
}

export function isWarningVerdict(verdict) {
  return verdict === "WARN" || verdict === "PASS_WITH_WARN";
}

export function exitForVerdict(verdict) {
  const options = arguments[1] ?? {};
  const reportOnly = options.reportOnly ?? true;
  if (!isValidVerdict(verdict)) {
    process.exitCode = 1;
    return;
  }
  if (verdict === FAILURE_VERDICT) {
    process.exitCode = 1;
    return;
  }
  if (isWouldBlockVerdict(verdict) && !reportOnly) {
    process.exitCode = 1;
  }
}

export function buildResult({ gate, verdict, reasons = [], remediation, ...rest }) {
  const resolvedRemediation = remediation ?? {
    what: verdict === "PASS" ? "No remediation required." : `Resolve ${gate} finding(s).`,
    doc_ref: "docs/standards/shirube-ai-development-governance-standard-v1.md",
  };
  const remediationContract = verdict === "PASS"
    ? {}
    : { remediation_contract: buildRemediationContract({ gate, verdict, reasons, remediation: resolvedRemediation, rest }) };
  return {
    gate,
    verdict,
    would_block: isWouldBlockVerdict(verdict),
    reasons,
    remediation: resolvedRemediation,
    ...remediationContract,
    ...rest,
  };
}

export function buildRemediationContract({ gate, verdict, reasons = [], remediation = {}, rest = {} }) {
  const actionableReasons = reasons.flatMap(flattenReasons);
  const missingPrerequisites = actionableReasons
    .map((reason) => reason.code ?? reason.gate ?? reason.field ?? reason.message)
    .filter(Boolean);
  return {
    verdict,
    current_phase: currentPhase(rest),
    blocked_reason: blockedReason(actionableReasons, verdict),
    missing_prerequisites: [...new Set(missingPrerequisites)],
    required_next_actions: requiredNextActions(remediation, actionableReasons),
    responsible_role: responsibleRole(gate),
    allowed_next_phases: allowedNextPhases(gate, rest),
    forbidden_next_phases: forbiddenNextPhases(verdict),
    required_evidence: requiredEvidence(gate, actionableReasons),
    observed_evidence: observedEvidence(rest),
    reference_docs: referenceDocs(gate, remediation),
  };
}

export function verdictFromFindings(findings) {
  if (findings.some((finding) => finding.severity === "BLOCK")) return "BLOCK";
  if (findings.some((finding) => finding.severity === "WARN")) return "WARN";
  return "PASS";
}

export function combineVerdicts(verdicts) {
  if (verdicts.includes(FAILURE_VERDICT)) return FAILURE_VERDICT;
  if (verdicts.some(isWouldBlockVerdict)) return "BLOCK";
  if (verdicts.some(isWarningVerdict)) return "WARN";
  return "PASS";
}

function flattenReasons(reason) {
  if (!reason) return [];
  const nested = Array.isArray(reason.reasons) ? reason.reasons.flatMap(flattenReasons) : [];
  if (isObject(reason)) return [reason, ...nested];
  return nested;
}

function currentPhase(rest) {
  return rest.current_phase ?? rest.observed?.current_phase ?? process.env.SHIRUBE_CURRENT_PHASE ?? "UNKNOWN";
}

function blockedReason(reasons, verdict) {
  const blocking = reasons.find((reason) => reason.severity === "BLOCK") ?? reasons[0];
  return blocking?.message ?? blocking?.code ?? (verdict === "WARN" ? "Warnings require review." : "Blocking prerequisites are missing.");
}

function requiredNextActions(remediation, reasons) {
  const actions = [];
  if (remediation.what) actions.push(remediation.what);
  for (const reason of reasons) {
    if (reason.message && !actions.includes(reason.message)) actions.push(reason.message);
  }
  return actions.length > 0 ? actions : ["Resolve the reported Shirube gate findings."];
}

function responsibleRole(gate) {
  const key = String(gate).replace(/^controller:/, "");
  const roles = {
    "repo-spec": "repo_owner",
    planning: "domain_designer",
    "spec-to-cell-trace": "shirube_command_owner",
    phase: "shirube_command_owner",
    "design-conformance": "domain_designer",
    readiness: "release_owner",
    "dev-loop": "release_owner",
    "change-flow": "implementation_owner",
    "script-error": "implementation_owner",
    controller: "release_owner",
  };
  return roles[key] ?? roles[String(gate)] ?? "release_owner";
}

function allowedNextPhases(gate, rest) {
  if (Array.isArray(rest.allowed_next_phases)) return rest.allowed_next_phases;
  const key = String(gate).replace(/^controller:/, "");
  const phases = {
    "repo-spec": ["REPO_SPEC_DRAFTED", "REPO_SPEC_CONFIRMED"],
    planning: ["PREMISE_SPEC_CONFIRMED", "INVENTORY_CONFIRMED", "CELL_DRAFTED"],
    "spec-to-cell-trace": ["CELL_TRACE_PASSED"],
    phase: ["REPO_SPEC_CONFIRMED", "PREMISE_SPEC_CONFIRMED", "INVENTORY_CONFIRMED", "CELL_DRAFTED"],
    "design-conformance": ["IMPL_AUDITED", "EXECUTION_READY"],
    readiness: ["REPO_SPEC_CONFIRMED", "CELL_DRAFTED"],
    "dev-loop": ["IMPL_AUDITED", "EXECUTION_READY"],
    "change-flow": ["CELL_DRAFTED"],
  };
  return phases[key] ?? [];
}

function forbiddenNextPhases(verdict) {
  if (verdict === "PASS") return [];
  return ["EXECUTION_READY", "IMPLEMENTED", "MERGED", "RELEASED"];
}

function requiredEvidence(gate, reasons) {
  const key = String(gate).replace(/^controller:/, "");
  const defaults = {
    "repo-spec": [".shirube/repo-spec.yaml"],
    planning: ["premise_confirmation_ref", "inventory_confirmation_ref", "owner_confirmation_ref"],
    "spec-to-cell-trace": [".shirube/specs/", ".shirube/cells/"],
    phase: [".shirube/phase-state.json", "scripts/shirube/phases.config.json"],
    "design-conformance": [".shirube/design-conformance-matrix.json"],
    readiness: [".shirube/repo-spec.yaml", "planning evidence"],
    "dev-loop": ["trace evidence", "phase evidence", "design conformance evidence"],
    "change-flow": [".shirube/specs/", ".shirube/cells/"],
  };
  const fromReasons = reasons
    .map((reason) => reason.field ?? reason.requirement ?? reason.control_id ?? reason.cell)
    .filter(Boolean);
  return [...new Set([...(defaults[key] ?? []), ...fromReasons])];
}

function observedEvidence(rest) {
  const observed = [];
  if (rest.checked_file) observed.push({ kind: "checked_file", value: rest.checked_file });
  if (rest.current_phase !== undefined) observed.push({ kind: "current_phase", value: rest.current_phase });
  if (rest.target_phase !== undefined) observed.push({ kind: "target_phase", value: rest.target_phase });
  if (rest.observed !== undefined) observed.push({ kind: "observed", value: rest.observed });
  if (rest.changed_files !== undefined) observed.push({ kind: "changed_files", value: rest.changed_files });
  if (rest.matrix !== undefined) observed.push({ kind: "matrix", value: rest.matrix });
  if (rest.child_results !== undefined) observed.push({ kind: "child_results", value: rest.child_results.map((result) => ({ gate: result.gate, verdict: result.verdict })) });
  return observed;
}

function referenceDocs(gate, remediation) {
  const refs = [
    remediation.doc_ref,
    ".shirube/repo-spec.yaml",
    "docs/standards/shirube-ai-development-governance-standard-v1.md",
  ].filter(Boolean);
  if (String(gate).includes("phase")) refs.push("scripts/shirube/phases.config.json");
  return [...new Set(refs)];
}

export function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

export function asBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value !== "string") return false;
  return ["true", "yes", "required"].includes(value.trim().toLowerCase());
}

export function present(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") {
    return value.trim() !== "" && !["null", "none", "n/a", "pending", "false"].includes(value.trim().toLowerCase());
  }
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return true;
}

export function planningFields(source) {
  const hierarchy = isObject(source?.planning_hierarchy) ? source.planning_hierarchy : {};
  return {
    ...source,
    ...hierarchy,
  };
}

export function listFiles(dir, predicate = () => true) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      files.push(...listFiles(path, predicate));
    } else if (predicate(path)) {
      files.push(path);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

export function extractIds(text, prefix) {
  const pattern = new RegExp(`\\b${escapeRegExp(prefix)}-[A-Z0-9][A-Z0-9._:-]*\\b`, "g");
  return [...new Set(text.match(pattern) ?? [])]
    .filter((id) => id !== `${prefix}-ID`)
    .sort((a, b) => a.localeCompare(b));
}

export function loadFixtureOrFiles(options, loader) {
  if (options.fixture) return readStructuredFile(options.fixture);
  return loader();
}

export function buildFailureResult({ code = "script_failure", message }) {
  return {
    gate: "script-error",
    verdict: FAILURE_VERDICT,
    would_block: false,
    reasons: [{ code, message }],
    remediation: {
      what: "Fix the script invocation, malformed input, missing artifact, or invalid verdict and rerun the gate.",
      doc_ref: "docs/standards/shirube-ai-development-governance-standard-v1.md",
    },
  };
}

export function safeRun(fn) {
  const options = arguments[1] ?? {};
  try {
    const result = fn();
    if (!isObject(result)) {
      throw new Error("Gate script returned a non-object result.");
    }
    if (!isValidVerdict(result.verdict)) {
      writeResult(buildFailureResult({
        code: "unknown_verdict",
        message: `Unknown verdict: ${String(result.verdict)}`,
      }));
      process.exitCode = 1;
      return;
    }
    writeResult({ ...result, would_block: result.would_block ?? isWouldBlockVerdict(result.verdict) });
    exitForVerdict(result.verdict, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeResult(buildFailureResult({ code: "script_error", message }));
    process.exitCode = 1;
  }
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---- design_rule_review (Rapid/Lite 1.3.0) ----------------------------------
// A design-rule finding with verdict NEEDS_REVIEW is resolved only by decisions
// in a shirube-additional-review/v1 record (review_type design_rule_review)
// written by a seat other than the author, for the same repo, PR and head.

export const DESIGN_RULE_REVIEW_TYPE = "design_rule_review";
const ADDITIONAL_REVIEW_SCHEMA = "shirube-additional-review/v1";

export function needsReviewItems(report) {
  const items = [];
  for (const result of asArray(report?.rule_results)) {
    if (!isObject(result) || result.verdict !== "NEEDS_REVIEW") continue;
    for (const matched of asArray(result.evidence)) {
      items.push({ rule_id: result.rule_id, path: result.path, matched: String(matched) });
    }
  }
  return items;
}

// The author seats of a handoff. A canonical control_handoff names its implementer only through
// execution_context.to.agent_id (the normalized owner.actor); self-declared fields are added to it.
export function authorActorsOfHandoff(handoff) {
  const source = isObject(handoff) ? handoff : {};
  const cell = isObject(source.cell) ? source.cell : {};
  const target = isObject(source.execution_context?.to) ? source.execution_context.to : {};
  const canonical = source.schema_version === "shirube-v3/control_handoff/v1";
  return [
    source.implementation_actor, source.implementer_actor, source.implementation?.actor,
    source.executor?.actor, cell.implementation_actor,
    target.agent_id, canonical ? source.owner?.actor : null,
  ].filter((value) => typeof value === "string" && value.trim() !== "").map((value) => value.trim());
}

function reviewKey(item) {
  return [item.rule_id, item.path, String(item.matched).toLowerCase()].join("\0");
}

function actorKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function reviewField(review, names) {
  for (const name of names) {
    const value = review?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return null;
}

function normalizeReviewRepo(value) {
  const match = String(value ?? "").match(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  return match ? match[1].toLowerCase() : null;
}

function normalizeReviewPr(value) {
  const match = String(value ?? "").match(/#(\d+)|\/pull\/(\d+)|^(\d+)$/);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

export const AUDIT_SEAT_FUNCTION = "evidence_audit_gate";

// Binds a record to the seat that posted it. `entry` is the resolver's source entry for this very
// record (same index as its materialized path); every fact in it comes from the GitHub API and the
// base policy, never from the record body, except reviewer_actor which must agree with the seat.
function posterRejection({ review, entry, authorActors }) {
  const poster = isObject(entry?.poster) ? entry.poster : null;
  if (!poster || typeof poster.login !== "string" || poster.login.trim() === "") return "poster_untrusted";
  if (typeof poster.pr_author !== "string" || poster.pr_author.trim() === "") return "poster_untrusted";
  if (actorKey(poster.login) === actorKey(poster.pr_author)) return "poster_is_pr_author";
  if (poster.seat_reason === "policy_unavailable") return "poster_policy_unavailable";
  const seat = isObject(poster.seat) ? poster.seat : null;
  if (!seat || typeof seat.agent_id !== "string" || seat.agent_id.trim() === "" ||
    actorKey(seat.github_login) !== actorKey(poster.login)) return "poster_seat_unregistered";
  if (seat.active_function !== AUDIT_SEAT_FUNCTION) return "poster_seat_not_audit";
  const reviewer = reviewField(review, ["reviewer_actor", "review_actor", "actor"]);
  if (actorKey(reviewer) !== actorKey(seat.agent_id)) return "poster_seat_mismatch";
  if (authorActors.map(actorKey).includes(actorKey(seat.agent_id))) return "author_seat";
  return null;
}

function designRuleReviewRejection({ review, actualRepo, actualPr, actualHead, authorActors, requirePoster }) {
  if (review.schema_version !== ADDITIONAL_REVIEW_SCHEMA) return "schema_version";
  const repo = normalizeReviewRepo(reviewField(review, ["target_repo", "repo"]));
  const pr = normalizeReviewPr(reviewField(review, ["target_pr", "pr", "pull_request"]));
  const head = reviewField(review, ["exact_head_sha", "pr_head_sha", "head_sha", "target_head"]);
  if (!repo || !pr || !head) return "missing_target";
  if (actualRepo && repo !== normalizeReviewRepo(actualRepo)) return "repo_mismatch";
  if (actualPr && pr !== normalizeReviewPr(actualPr)) return "pr_mismatch";
  if (actualHead && head !== String(actualHead).trim()) return "head_mismatch";
  const reviewer = reviewField(review, ["reviewer_actor", "review_actor", "actor"]);
  const implementer = reviewField(review, ["implementation_actor", "implementer_actor"]);
  if (!reviewer || !implementer) return "missing_actor";
  // An unidentified author never makes a record independent.
  if (authorActors.length === 0) return "author_unresolved";
  if (actorKey(reviewer) === actorKey(implementer)) return "author_seat";
  if (authorActors.map(actorKey).includes(actorKey(reviewer))) return "author_seat";
  if (requirePoster) return posterRejection({ review, entry: review.__poster_entry, authorActors });
  return null;
}

/**
 * @param {{ report?: unknown, reviews?: unknown[], actualRepo?: string | null, actualPr?: string | null,
 *   actualHead?: string | null, authorActors?: string[] }} [input]
 */
export function evaluateDesignRuleReviews({ report, reviews = [], actualRepo, actualPr, actualHead, authorActors = [], requirePoster = false } = {}) {
  const items = needsReviewItems(report);
  const accepted = [];
  const ignored = [];
  for (const review of asArray(reviews)) {
    if (!isObject(review)) continue;
    const type = String(review.review_type ?? review.type ?? "").trim().toLowerCase();
    if (type !== DESIGN_RULE_REVIEW_TYPE) continue;
    const reason = designRuleReviewRejection({ review, actualRepo, actualPr, actualHead, authorActors: asArray(authorActors).filter(Boolean), requirePoster });
    if (reason) {
      const detail = reason === "poster_policy_unavailable" ? review.__poster_entry?.poster?.policy_unavailable_detail : undefined;
      ignored.push({ reviewer_actor: reviewField(review, ["reviewer_actor", "review_actor", "actor"]), reason, ...(detail ? { detail } : {}) });
    } else {
      accepted.push(review);
    }
  }
  const decisions = new Map();
  for (const review of accepted) {
    for (const entry of asArray(review.decisions)) {
      if (!isObject(entry)) continue;
      const decision = String(entry.decision ?? "").trim().toLowerCase();
      const rationale = reviewField(entry, ["rationale", "reason"]);
      if (!["safe", "unsafe"].includes(decision) || !rationale) continue;
      const key = reviewKey({ rule_id: entry.rule_id, path: entry.path, matched: entry.matched ?? entry.pattern });
      // An unsafe decision always wins over a safe one for the same item.
      if (decisions.get(key) !== "unsafe") decisions.set(key, decision);
    }
  }
  const safe = [];
  const unsafe = [];
  const uncovered = [];
  for (const item of items) {
    const decision = decisions.get(reviewKey(item));
    (decision === "safe" ? safe : decision === "unsafe" ? unsafe : uncovered).push(item);
  }
  return {
    required: items.length > 0,
    complete: items.length === 0 || (uncovered.length === 0 && unsafe.length === 0),
    items_total: items.length,
    safe,
    unsafe,
    uncovered,
    ignored_reviews: ignored,
  };
}

// ---- design_rule_review: the verified set of records (shared by the gate and the completion) ----
// Lives here, not in next-action-sequencing.mjs, because check-design-rules.mjs is also copied
// standalone next to lib.mjs only.
const TRUSTED_ADDITIONAL_REVIEW_RESOLVER = "scripts/shirube/resolve-additional-review-ref.mjs";

export function normalizePath(value) {
  if (isPlaceholder(value)) return null;
  let text = String(value).trim().replace(/\\/g, "/").replace(/^\.\//, "");
  const cwd = process.cwd().replace(/\\/g, "/").replace(/\/+$/, "");
  if (text.startsWith(`${cwd}/`)) text = text.slice(cwd.length + 1);
  return text;
}


export function normalizeRepo(value) {
  if (isPlaceholder(value)) return null;
  const text = String(value).trim();
  const match = text.match(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  return match ? match[1] : text;
}


export function normalizePr(value) {
  if (isPlaceholder(value)) return null;
  const text = String(value).trim();
  const match = text.match(/#(\d+)|\/pull\/(\d+)|\/issues\/(\d+)|^(\d+)$/);
  return match ? (match[1] ?? match[2] ?? match[3] ?? match[4]) : text;
}


export function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}


export function firstPresent(...values) {
  return values.find((value) => !isPlaceholder(value));
}


export function isPlaceholder(value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^<[^>]+>$/.test(trimmed)) return true;
  return /^(pending|pending-.+|tbd|todo|null|none|n\/a|replace this.*)$/i.test(trimmed);
}

/**
 * The one set of design_rule_review records any judgment may use, for both directions (safe and
 * unsafe): records that passed the source, repo / PR / head, maker-checker and materialized-path
 * checks, each paired with the source entry of its own materialized path. A record outside this set
 * is not counted by the completion check and not by the design-rule gate.
 */
export function verifiedDesignRuleReviews({ reports, source, sourceRuntimeTrusted, actualHead, actualRepo, actualPr }) {
  const sourceTrusted = additionalReviewSourceIsTrusted(source, sourceRuntimeTrusted === true);
  const repo = normalizeRepo(actualRepo);
  const pr = normalizePr(actualPr);
  const statuses = asArray(reports).filter(isObject)
    .filter((entry) => normalizeText(entry.review_type ?? entry.type) === DESIGN_RULE_REVIEW_TYPE)
    .map((report) => ({ report, status: additionalReviewReportStatus({ report, source, sourceTrusted, actualHead, actualRepo: repo, actualPr: pr }) }));
  const verified = statuses.filter((entry) => entry.status.complete)
    .map((entry) => ({ ...entry.report, __poster_entry: sourceEntryForReport(source, entry.report) }));
  return { statuses, verified };
}

export function additionalReviewReportStatus({ report, source, sourceTrusted, actualHead, actualRepo, actualPr }) {
  if (!isObject(report)) return { complete: false };
  const verdict = String(firstPresent(report.verdict, report.decision, report.status) ?? "").toUpperCase();
  const accepted = ["PASS", "PASS_WITH_WARN", "APPROVED", "CONDITIONAL_GO"].includes(verdict);
  const observedHead = firstPresent(report.exact_head_sha, report.pr_head_sha, report.head_sha, report.target_head);
  const observedRepo = normalizeRepo(firstPresent(report.target_repo, report.repo));
  const observedPr = normalizePr(firstPresent(report.target_pr, report.pr, report.pull_request));
  const headMatches = isPlaceholder(actualHead) || !isPlaceholder(observedHead) && String(observedHead) === String(actualHead);
  const repoMatches = !isPlaceholder(observedRepo) && (!actualRepo || observedRepo === actualRepo);
  const prMatches = !isPlaceholder(observedPr) && (!actualPr || observedPr === actualPr);
  const provenance = additionalReviewProvenanceStatus({ report, source, sourceTrusted, actualHead, actualRepo, actualPr });
  const makerCheckerSeparated = additionalReviewMakerCheckerSeparated(report);
  return {
    complete: accepted && headMatches && repoMatches && prMatches && provenance.complete && makerCheckerSeparated,
    accepted,
    head_matches: Boolean(headMatches),
    head_mismatch: !isPlaceholder(actualHead) && !isPlaceholder(observedHead) && !headMatches,
    repo_matches: Boolean(repoMatches),
    pr_matches: Boolean(prMatches),
    observed_head: observedHead ?? null,
    provenance_complete: Boolean(provenance.complete),
    maker_checker_separated: Boolean(makerCheckerSeparated),
  };
}

function additionalReviewProvenanceStatus({ report, source, sourceTrusted, actualHead, actualRepo, actualPr }) {
  if (!sourceTrusted || !isObject(source)) return { complete: false };
  const reviewType = normalizeText(firstPresent(report.review_type, report.type));
  const entry = additionalReviewSourceEntries(source).find((candidate) => normalizeText(candidate.review_type) === reviewType);
  if (!entry) return { complete: false };
  const sourceHead = firstPresent(entry.exact_head_sha, entry.pr_head_sha, source.exact_head_sha, source.pr_head_sha, source.head_sha, source.target_head);
  const sourceRepo = normalizeRepo(firstPresent(entry.target_repo, source.target_repo, source.repo));
  const sourcePr = normalizePr(firstPresent(entry.target_pr, source.target_pr, source.pr));
  const sourceHeadMatches = !isPlaceholder(sourceHead) && (isPlaceholder(actualHead) || String(sourceHead) === String(actualHead));
  const sourceRepoMatches = !isPlaceholder(sourceRepo) && (!actualRepo || sourceRepo === actualRepo);
  const sourcePrMatches = !isPlaceholder(sourcePr) && (!actualPr || sourcePr === actualPr);
  const sourceMaterializedPathMatches = additionalReviewSourceMaterializedPathMatches({ source, report });
  return {
    complete: sourceHeadMatches && sourceRepoMatches && sourcePrMatches && sourceMaterializedPathMatches,
  };
}

export function additionalReviewSourceIsTrusted(source, runtimeTrusted) {
  if (!isObject(source)) return false;
  if (runtimeTrusted !== true) return false;
  if (source.target_branch_mutated === true || source.owner_approval_synthesized === true) return false;
  if (source.trusted_base_workflow !== true) return false;
  if (String(firstPresent(source.generated_by, source.resolver, source.tool) ?? "") !== TRUSTED_ADDITIONAL_REVIEW_RESOLVER) return false;
  const resolverSchema = firstPresent(source.resolver_schema, source.resolution_schema);
  if (!isPlaceholder(resolverSchema) && resolverSchema !== "shirube-additional-review-ref-resolution/v1") return false;
  const hasSourceLocator = additionalReviewSourceEntries(source).some((entry) => !isPlaceholder(firstPresent(
    entry.source_comment_url,
    entry.comment_url,
    entry.review_url,
    entry.source_ref,
    entry.comment_id,
    entry.evidence_ref,
  )));
  if (!hasSourceLocator) return false;
  const type = String(firstPresent(source.source_type, source.type) ?? "").toLowerCase();
  return ["github_comment", "github_pr_comment", "github_review", "external_review_ref", "owner_accepted_external_review_ref"].includes(type);
}

export function additionalReviewSourceEntries(source) {
  if (Array.isArray(source?.sources)) return source.sources.filter(isObject);
  if (isObject(source)) return [source];
  return [];
}

// The source entry written for one materialized record: entries and paths are written in the same order.
export function sourceEntryForReport(source, report) {
  const reportPath = normalizePath(firstPresent(report?.__file_path, report?.file_path, report?.path));
  const paths = asArray(source?.materialized_paths).map(normalizePath);
  const entries = Array.isArray(source?.sources) ? source.sources : [];
  if (isPlaceholder(reportPath) || paths.length === 0 || entries.length !== paths.length) return null;
  const index = paths.indexOf(reportPath);
  const entry = index >= 0 ? entries[index] : null;
  return isObject(entry) && normalizeText(entry.review_type) === DESIGN_RULE_REVIEW_TYPE ? entry : null;
}

function additionalReviewSourceMaterializedPathMatches({ source, report }) {
  const reportPath = normalizePath(firstPresent(report?.__file_path, report?.file_path, report?.path));
  if (isPlaceholder(reportPath)) return false;
  const sourcePaths = [
    ...asArray(source?.materialized_paths),
    ...asArray(source?.materialized_path),
    ...asArray(source?.additional_review_paths),
  ].map(normalizePath).filter(Boolean);
  return sourcePaths.includes(reportPath);
}

function additionalReviewMakerCheckerSeparated(report) {
  if (!isObject(report)) return false;
  const reviewerActor = firstPresent(report.reviewer_actor, report.review_actor, report.actor);
  const implementationActor = firstPresent(report.implementation_actor, report.implementer_actor);
  if (isPlaceholder(reviewerActor) || isPlaceholder(implementationActor)) return false;
  return String(reviewerActor) !== String(implementationActor);
}

