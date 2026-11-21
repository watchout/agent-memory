#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  evaluateDesignRuleReviews,
  verifiedDesignRuleReviews,
  isMain,
  isObject,
  parseArgs,
  readStructuredFile,
  authorActorsOfHandoff,
} from "./lib.mjs";
import {
  normalizeControlHandoff,
} from "./normalize-control-handoff.mjs";

const SCHEMA = "shirube-design-rule-check/v1";
const DEFAULT_RULE_PACK = ".shirube/design-rule-packs/shirube-default-design-rules.yaml";
const PROTECTED_FORBIDDEN_NEXT = ["EXECUTION_READY", "IMPLEMENTED", "MERGED", "RELEASED"];

// TypeScript is an existing development dependency. Copied standalone checkers
// retain the conservative text check when the parser is not installed.
let sourceParser;
try {
  sourceParser = createRequire(import.meta.url)("typescript");
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}

export function buildDesignRuleReport(input) {
  // The evaluation time is decided once here so every exception check in this
  // run compares against the same instant (tests pass it in `input.now`).
  const now = resolveNow(input.now);
  const authorActors = authorActorsFrom(input);
  const rulePack = input.rulePack;
  const rules = Array.isArray(rulePack?.rules) ? rulePack.rules : [];
  const ruleResults = [];
  const evidence = [];

  if (input.rulePackPath) {
    evidence.push({ code: "rule_pack", source: "file", detail: input.rulePackPath });
  }
  if (input.changedFilesPath) {
    evidence.push({ code: "changed_files", source: "file", detail: input.changedFilesPath });
  }
  if (input.diffRoot) {
    evidence.push({ code: "diff_root", source: "filesystem", detail: input.diffRoot });
  }
  if (input.handoffPath) {
    evidence.push({ code: "handoff", source: "file", detail: input.handoffPath });
  }
  if (input.prBodyPath) {
    evidence.push({ code: "pr_body", source: "file", detail: input.prBodyPath });
  }
  if (input.evidencePath) {
    evidence.push({ code: "evidence", source: "file", detail: input.evidencePath });
  }

  if (!hasRulePackIdentity(rulePack)) {
    ruleResults.push(finding({
      ruleId: "DR-RULEPACK-001",
      code: "missing_rule_pack_or_version",
      severity: "BLOCK",
      verdict: "FAIL",
      path: input.rulePackPath || "rule_pack",
      evidence: ["schema_version and rule_pack_id are required"],
    }));
  }

  const changedFiles = input.changedFiles ?? [];
  const changedFileRecords = changedFiles.map((file) => ({
    path: file,
    content: readChangedFileContent({ diffRoot: input.diffRoot, file }),
  }));
  const textInputs = buildTextInputs(input, changedFileRecords);

  for (const rule of rules) {
    if (!isObject(rule)) continue;
    const checkType = rule.check?.type;
    if (checkType === "rule_pack_has_identity") continue;
    const results = evaluateRule({ rule, input, changedFileRecords, textInputs, now, authorActors });
    if (results.length === 0) {
      ruleResults.push(passResult(rule));
    } else {
      ruleResults.push(...results);
    }
  }

  // Independent reviewers' decisions can turn a NEEDS_REVIEW item into a
  // blocker (unsafe). A safe decision does not rewrite the finding: the
  // review-plan gate keeps requiring design_rule_review until every item is
  // covered for this repo, PR and head.
  // Both directions use the same verified set as the review-plan completion: a record that is not
  // from a trusted source, registered audit seat and this repo / PR / head decides nothing.
  const { verified } = verifiedDesignRuleReviews({
    reports: input.designRuleReviews,
    source: input.additionalReviewSource,
    sourceRuntimeTrusted: input.additionalReviewSourceTrusted,
    actualRepo: input.actualRepo,
    actualPr: input.actualPr,
    actualHead: input.actualHead,
  });
  const reviewEvaluation = evaluateDesignRuleReviews({
    report: { rule_results: ruleResults },
    reviews: verified,
    actualRepo: input.actualRepo,
    actualPr: input.actualPr,
    actualHead: input.actualHead,
    authorActors,
    requirePoster: true,
  });
  for (const item of reviewEvaluation.unsafe) {
    ruleResults.push(finding({
      ruleId: item.rule_id,
      code: "reviewed_unsafe",
      severity: "BLOCK",
      verdict: "FAIL",
      path: item.path,
      evidence: [item.matched],
    }));
  }
  const unsafeKeys = new Set(reviewEvaluation.unsafe.map((item) => `${item.rule_id}\0${item.path}\0${item.matched}`));
  const effectiveResults = ruleResults.filter((result) => result.verdict !== "NEEDS_REVIEW" ||
    result.evidence.some((entry) => !unsafeKeys.has(`${result.rule_id}\0${result.path}\0${entry}`)));

  const blockers = effectiveResults.filter((result) => result.severity === "BLOCK" && result.verdict === "FAIL");
  const warnings = effectiveResults.filter((result) => result.severity === "WARN" && result.verdict === "WARN");
  const needsReview = effectiveResults.filter((result) => result.severity === "REVIEW" && result.verdict === "NEEDS_REVIEW");
  // BLOCKED > NEEDS_REVIEW > PASS_WITH_WARN > PASS
  const verdict = blockers.length > 0 ? "BLOCKED"
    : needsReview.length > 0 ? "NEEDS_REVIEW"
      : warnings.length > 0 ? "PASS_WITH_WARN" : "PASS";

  return {
    schema: SCHEMA,
    rule_pack_id: stringOrNull(rulePack?.rule_pack_id),
    verdict,
    would_block: verdict === "BLOCKED",
    rule_results: stableRuleResults(effectiveResults),
    blockers: blockers.map(toSummary),
    warnings: warnings.map(toSummary),
    needs_review: needsReview.map(toSummary),
    evidence: uniqueEvidence(evidence),
    required_next_actions: requiredNextActions(blockers, warnings, needsReview),
  };
}

function evaluateRule({ rule, input, changedFileRecords, textInputs, now, authorActors }) {
  switch (rule.check?.type) {
    case "text_pattern_absent":
      return evaluateLlmAuthorityRule({ rule, textInputs });
    case "hard_delete_requires_soft_delete_policy":
      return evaluateHardDeleteRule({ rule, input, changedFileRecords, now, authorActors });
    case "source_generality_heuristic":
      return evaluateGeneralityRule({ rule, changedFileRecords });
    case "exact_duplicate_block":
      return evaluateDuplicateRule({ rule, changedFileRecords });
    case "source_configurable_value_heuristic":
      return evaluateConfigurableValueRule({ rule, changedFileRecords });
    case "protected_surface_requires_declaration":
      return evaluateProtectedSurfaceRule({ rule, input, changedFileRecords });
    case "business_constant_heuristic":
      return evaluateBusinessConstantRule({ rule, changedFileRecords });
    default:
      return [];
  }
}

function evaluateLlmAuthorityRule({ rule, textInputs }) {
  const patterns = asStringArray(rule.check?.forbidden_patterns);
  const results = [];
  for (const input of textInputs) {
    for (const pattern of patterns) {
      if (containsPattern(input.text, pattern)) {
        results.push(finding({
          ruleId: rule.rule_id,
          code: rule.code,
          severity: "BLOCK",
          verdict: "FAIL",
          path: input.path,
          evidence: [pattern],
        }));
      }
    }
  }
  return uniqueByKey(results, (result) => `${result.rule_id}:${result.path}:${result.evidence.join("|")}`);
}

function evaluateHardDeleteRule({ rule, input, changedFileRecords, now, authorActors }) {
  // `hard_delete_patterns` is the pre-1.3.0 key; every pattern in it keeps its BLOCK meaning.
  const blockPatterns = [
    ...asStringArray(rule.check?.block_patterns),
    ...asStringArray(rule.check?.hard_delete_patterns),
  ];
  const reviewPatterns = asStringArray(rule.check?.review_patterns);
  const softDeleteMarkers = asStringArray(rule.check?.soft_delete_markers);
  const results = [];
  for (const record of changedFileRecords) {
    if (!record.content || !isSourceOrMigrationLike(record.path)) continue;
    const matchPatterns = (patterns) => patterns.filter((pattern) => containsPattern(record.content, pattern) &&
      !(pattern === ".delete(" && onlyLocalSetDeletes(record)) &&
      !(pattern === ".destroy(" && onlyLocalRequestDestroys(record)));
    const blocked = matchPatterns(blockPatterns);
    const review = matchPatterns(reviewPatterns).filter((pattern) => !blocked.includes(pattern));
    if (blocked.length === 0 && review.length === 0) continue;
    if (hasSoftDeletePolicy(record.content, softDeleteMarkers)) continue;
    if (hasApprovedException({ input, ruleId: rule.rule_id, filePath: record.path, now, authorActors })) continue;
    if (blocked.length > 0) {
      results.push(finding({
        ruleId: rule.rule_id,
        code: rule.code,
        severity: "BLOCK",
        verdict: "FAIL",
        path: record.path,
        evidence: blocked,
      }));
    }
    if (review.length > 0) {
      results.push(finding({
        ruleId: rule.rule_id,
        code: rule.code,
        severity: "REVIEW",
        verdict: "NEEDS_REVIEW",
        path: record.path,
        evidence: review,
      }));
    }
  }
  return results;
}

function parseSourceBindings({ path: filePath, content }) {
  const ts = sourceParser;
  if (!ts || !/\.(mjs|cjs|js|jsx|ts|tsx)$/.test(filePath)) return null;
  const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length > 0) return null;
  const host = {
    getSourceFile: (name) => name === filePath ? source : undefined,
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    fileExists: (name) => name === filePath,
    readFile: (name) => name === filePath ? content : undefined,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram([filePath], { allowJs: true, noLib: true, noResolve: true }, host);
  const checker = program.getTypeChecker();
  const nodes = [];
  const collect = (node) => { nodes.push(node); ts.forEachChild(node, collect); };
  collect(source);
  return { ts, source, checker, nodes };
}

function onlyLocalSetDeletes(record) {
  const parsed = parseSourceBindings(record);
  if (!parsed) return false;
  const { ts, source, checker, nodes } = parsed;
  const { content } = record;
  // Shadowed constructors, prototype access and dynamic scope are ambiguous.
  if (nodes.some((node) => ts.isWithStatement(node) ||
    (ts.isIdentifier(node) && node.text === "eval") ||
    (ts.isStringLiteral(node) && node.text === "Set") ||
    (ts.isIdentifier(node) && node.text === "Set" &&
      !(ts.isNewExpression(node.parent) && node.parent.expression === node &&
        !checker.getSymbolAtLocation(node))))) return false;

  const safeOffsets = new Set();
  for (const declaration of nodes) {
    if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name) ||
      !(declaration.parent.flags & ts.NodeFlags.Const)) continue;
    const initializer = declaration.initializer;
    if (!initializer || !ts.isNewExpression(initializer) ||
      !ts.isIdentifier(initializer.expression) || initializer.expression.text !== "Set" ||
      (initializer.arguments?.length ?? 0) !== 0) continue;
    let enclosing = declaration.parent;
    while (enclosing && !ts.isFunctionLike(enclosing)) enclosing = enclosing.parent;
    if (!enclosing) continue;
    const symbol = checker.getSymbolAtLocation(declaration.name);
    if (!symbol) continue;
    const references = nodes.filter((node) => ts.isIdentifier(node) && node !== declaration.name &&
      (ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node)) === symbol);
    // Never exempt aliases, escaping values, reassignment or overridden methods.
    if (!references.every((node) => {
      const access = node.parent;
      return ts.isPropertyAccessExpression(access) && access.expression === node &&
        ["add", "has", "delete"].includes(access.name.text) &&
        ts.isCallExpression(access.parent) && access.parent.expression === access;
    })) continue;
    for (const node of references) {
      if (node.parent.name.text === "delete") safeOffsets.add(node.parent.name.getStart(source) - 1);
    }
  }
  const matches = [...content.toLowerCase().matchAll(/\.delete\(/g)];
  return matches.length > 0 && matches.every((match) => safeOffsets.has(match.index));
}

// Classify only non-escaping local ClientRequest receivers from the builtin
// HTTPS GET factory. Unknown destroy calls retain the hard-delete finding.
// Like the Set classifier, this assumes unmodified builtin modules; it is not
// an arbitrary-JavaScript proof or a source-path/expiry exception.
function onlyLocalRequestDestroys(record) {
  const parsed = parseSourceBindings(record);
  if (!parsed) return false;
  const { ts, source, checker, nodes } = parsed;
  if (nodes.some((node) => ts.isWithStatement(node) || node.kind === ts.SyntaxKind.ThisKeyword ||
    node.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node) && ["eval", "require"].includes(node.text)))) return false;
  const transportImports = source.statements.filter((node) => ts.isImportDeclaration(node) &&
    ts.isStringLiteral(node.moduleSpecifier) &&
    ["http", "https", "node:http", "node:https", "node:module", "module"].includes(node.moduleSpecifier.text));
  if (transportImports.length !== 1 || transportImports[0].moduleSpecifier.text !== "node:https") return false;
  const references = (name) => {
    const symbol = checker.getSymbolAtLocation(name);
    return symbol ? nodes.filter((node) => ts.isIdentifier(node) && node !== name &&
      (ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node)) === symbol) : [];
  };
  const directCall = (node, methods) => {
    const access = node.parent;
    return ts.isPropertyAccessExpression(access) && access.expression === node &&
      methods.includes(access.name.text) && ts.isCallExpression(access.parent) &&
      access.parent.expression === access;
  };
  const factories = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "node:https") continue;
    const name = statement.importClause?.name;
    // Only the default builtin import is classified; named/namespace aliases
    // and factory escapes are deliberately left to the conservative check.
    if (!name || statement.importClause.namedBindings) continue;
    const refs = references(name);
    if (refs.length > 0 && refs.every((node) => directCall(node, ["request"]))) {
      for (const node of refs) factories.add(node.parent.parent);
    }
  }
  const safeOffsets = new Set();
  for (const declaration of nodes) {
    if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name) ||
      !(declaration.parent.flags & ts.NodeFlags.Const) || !factories.has(declaration.initializer)) continue;
    let enclosing = declaration.parent;
    while (enclosing && !ts.isFunctionLike(enclosing)) enclosing = enclosing.parent;
    if (!enclosing) continue;
    const options = declaration.initializer.arguments[0];
    if (!options || !ts.isObjectLiteralExpression(options)) continue;
    const properties = options.properties;
    if (!properties.every((property) => ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) && ["hostname", "path", "method", "headers"].includes(property.name.text))) continue;
    if (new Set(properties.map((property) => property.name.text)).size !== properties.length) continue;
    const method = properties.find((property) => property.name.text === "method")?.initializer;
    const hostname = properties.find((property) => property.name.text === "hostname")?.initializer;
    if (!method || !ts.isStringLiteral(method) || method.text !== "GET" ||
      !hostname || !ts.isStringLiteral(hostname) || !hostname.text) continue;
    const refs = references(declaration.name);
    if (!refs.every((node) => {
      if (!directCall(node, ["destroy", "setTimeout", "on", "end"])) return false;
      const call = node.parent.parent;
      if (ts.isExpressionStatement(call.parent)) return true;
      // A destroy call may be the body of an inline event/timeout arrow.
      // All other uses of the return value could leak the receiver.
      const arrow = call.parent;
      return node.parent.name.text === "destroy" && ts.isArrowFunction(arrow) &&
        arrow.body === call && ts.isCallExpression(arrow.parent) &&
        arrow.parent.arguments.includes(arrow) &&
        ts.isPropertyAccessExpression(arrow.parent.expression) &&
        ["on", "setTimeout"].includes(arrow.parent.expression.name.text);
    })) continue;
    for (const node of refs) {
      if (node.parent.name.text === "destroy") safeOffsets.add(node.parent.name.getStart(source) - 1);
    }
  }
  const matches = [...record.content.toLowerCase().matchAll(/\.destroy\(/g)];
  return matches.length > 0 && matches.every((match) => safeOffsets.has(match.index));
}

function evaluateGeneralityRule({ rule, changedFileRecords }) {
  const markers = asStringArray(rule.check?.markers);
  const results = [];
  for (const record of changedFileRecords) {
    if (!record.content || !isSourcePath(record.path)) continue;
    const matched = markers.filter((marker) => containsPattern(record.content, marker));
    if (matched.length > 0 || hasEnumLikeBusinessArray(record.content) || hasRepeatedLiteralBranches(record.content)) {
      results.push(finding({
        ruleId: rule.rule_id,
        code: rule.code,
        severity: "WARN",
        verdict: "WARN",
        path: record.path,
        evidence: matched.length > 0 ? matched : ["source contains configurable-looking domain shape"],
      }));
    }
  }
  return results;
}

function evaluateDuplicateRule({ rule, changedFileRecords }) {
  const warnThreshold = Number(rule.check?.warn_threshold_lines ?? 6);
  const blockThreshold = Number(rule.check?.block_threshold_lines ?? 12);
  const ignorePaths = asStringArray(rule.check?.ignore_paths);
  const results = [];
  for (const record of changedFileRecords) {
    if (!record.content || !isSourcePath(record.path) || matchesAnyGlob(record.path, ignorePaths)) continue;
    const duplicate = longestDuplicateBlock(record.content);
    if (duplicate.length >= blockThreshold) {
      results.push(finding({
        ruleId: rule.rule_id,
        code: rule.code,
        severity: "BLOCK",
        verdict: "FAIL",
        path: record.path,
        evidence: [`duplicate block length ${duplicate.length}`],
      }));
    } else if (duplicate.length >= warnThreshold) {
      results.push(finding({
        ruleId: rule.rule_id,
        code: rule.code,
        severity: "WARN",
        verdict: "WARN",
        path: record.path,
        evidence: [`duplicate block length ${duplicate.length}`],
      }));
    }
  }
  return results;
}

function evaluateConfigurableValueRule({ rule, changedFileRecords }) {
  const allowedPaths = asStringArray(rule.check?.allowed_paths);
  const results = [];
  for (const record of changedFileRecords) {
    if (!record.content || !isSourcePath(record.path) || matchesAnyGlob(record.path, allowedPaths)) continue;
    const repeated = repeatedStringLiterals(record.content, Number(rule.check?.repeated_literal_min_count ?? 2));
    const urls = environmentSpecificValues(record.content);
    const evidence = [...repeated, ...urls];
    if (evidence.length > 0) {
      results.push(finding({
        ruleId: rule.rule_id,
        code: rule.code,
        severity: "WARN",
        verdict: "WARN",
        path: record.path,
        evidence: evidence.slice(0, 5),
      }));
    }
  }
  return results;
}

function evaluateProtectedSurfaceRule({ rule, input, changedFileRecords }) {
  if (hasProtectedDeclaration(input.handoff)) return [];
  const protectedPathPatterns = asStringArray(rule.check?.protected_path_patterns);
  const protectedContentPatterns = asStringArray(rule.check?.protected_content_patterns);
  const results = [];
  for (const record of changedFileRecords) {
    const evidence = [];
    if (matchesAnyGlob(record.path, protectedPathPatterns)) evidence.push("protected path");
    for (const pattern of protectedContentPatterns) {
      if (record.content && containsPattern(record.content, pattern)) evidence.push(pattern);
    }
    if (evidence.length > 0) {
      results.push(finding({
        ruleId: rule.rule_id,
        code: rule.code,
        severity: "BLOCK",
        verdict: "FAIL",
        path: record.path,
        evidence,
      }));
    }
  }
  return results;
}

function evaluateBusinessConstantRule({ rule, changedFileRecords }) {
  const markers = asStringArray(rule.check?.markers);
  const results = [];
  for (const record of changedFileRecords) {
    if (!record.content || !isSourcePath(record.path) || isAllowedConfigLocation(record.path)) continue;
    const matched = markers.filter((marker) => containsPattern(record.content, marker));
    if (matched.length > 0) {
      results.push(finding({
        ruleId: rule.rule_id,
        code: rule.code,
        severity: "WARN",
        verdict: "WARN",
        path: record.path,
        evidence: matched,
      }));
    }
  }
  return results;
}

function readInput(options) {
  const rulePackPath = typeof options["rule-pack"] === "string"
    ? options["rule-pack"]
    : existsSync(DEFAULT_RULE_PACK)
      ? DEFAULT_RULE_PACK
      : null;
  const changedFilesPath = typeof options["changed-files"] === "string" ? options["changed-files"] : null;
  const diffRoot = typeof options["diff-root"] === "string" ? options["diff-root"] : null;
  const handoffPath = typeof options.handoff === "string" ? options.handoff : null;
  const prBodyPath = typeof options["pr-body"] === "string" ? options["pr-body"] : null;
  const evidencePath = typeof options.evidence === "string" ? options.evidence : null;
  const context = {
    now: typeof options.now === "string" ? options.now : undefined,
    authorActors: typeof options["author-actor"] === "string" ? options["author-actor"].split(",") : [],
    designRuleReviews: readDesignRuleReviews(options["design-rule-review"]),
    additionalReviewSource: readOptionalSource(options["additional-review-source"]),
    additionalReviewSourceTrusted: options["trusted-additional-review-source"] === true,
    actualRepo: typeof options["actual-repo"] === "string" ? options["actual-repo"] : undefined,
    actualPr: typeof options["actual-pr"] === "string" ? options["actual-pr"] : undefined,
    actualHead: typeof options["actual-head"] === "string" ? options["actual-head"] : undefined,
  };

  if (!rulePackPath || !existsSync(rulePackPath)) {
    return {
      input: {
        rulePack: null,
        rulePackPath: rulePackPath ?? "",
        changedFiles: readChangedFiles(changedFilesPath),
        changedFilesPath,
        diffRoot,
        handoff: null,
        handoffPath,
        prBodyText: "",
        prBodyPath,
        evidenceValue: null,
        evidenceText: "",
        evidencePath,
        ...context,
      },
    };
  }

  const rulePackResult = readOptionalStructuredInput(rulePackPath, "rule_pack_parse_error", true);
  if (rulePackResult.error) return { error: rulePackResult.error };
  const handoffResult = handoffPath ? readOptionalStructuredInput(handoffPath, "handoff_parse_error", true) : { value: null };
  if (handoffResult.error) return { error: handoffResult.error };
  const evidenceResult = evidencePath ? readOptionalEvidence(evidencePath) : { value: null, text: "" };
  if (evidenceResult.error) return { error: evidenceResult.error };

  return {
    input: {
      rulePack: rulePackResult.value,
      rulePackPath,
      changedFiles: readChangedFiles(changedFilesPath),
      changedFilesPath,
      diffRoot,
      handoff: normalizeControlHandoff(handoffResult.value),
      handoffPath,
      prBodyText: prBodyPath ? readTextInput(prBodyPath, "pr_body_read_error") : "",
      prBodyPath,
      evidenceValue: evidenceResult.value,
      evidenceText: evidenceResult.text,
      evidencePath,
      ...context,
    },
  };
}

function readDesignRuleReviews(value) {
  if (typeof value !== "string") return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean)
    .filter((filePath) => existsSync(filePath))
    .map((filePath) => {
      const record = readStructuredFile(filePath);
      return isObject(record) ? { ...record, __file_path: filePath } : record;
    });
}

function readOptionalSource(value) {
  if (typeof value !== "string" || !existsSync(value)) return null;
  try {
    return readStructuredFile(value);
  } catch {
    return null;
  }
}

function readOptionalStructuredInput(filePath, errorCode, required) {
  if (!existsSync(filePath)) {
    if (!required) return { value: null };
    return {
      error: failureReport({ code: errorCode, message: `File not found: ${filePath}` }),
    };
  }
  try {
    return { value: readStructuredFile(filePath) };
  } catch (error) {
    return {
      error: failureReport({ code: errorCode, message: errorMessage(error) }),
    };
  }
}

function readOptionalEvidence(filePath) {
  if (!existsSync(filePath)) {
    return { error: failureReport({ code: "evidence_read_error", message: `File not found: ${filePath}` }) };
  }
  const text = readFileSync(filePath, "utf8");
  try {
    return { value: readStructuredFile(filePath), text };
  } catch {
    return { value: text, text };
  }
}

function readTextInput(filePath, errorCode) {
  if (!existsSync(filePath)) {
    throw new Error(`${errorCode}: File not found: ${filePath}`);
  }
  return readFileSync(filePath, "utf8");
}

function readChangedFiles(filePath) {
  if (!filePath) return [];
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .sort((a, b) => a.localeCompare(b));
}

function readChangedFileContent({ diffRoot, file }) {
  if (!diffRoot) return "";
  const absolute = path.join(diffRoot, file);
  if (!existsSync(absolute)) return "";
  return readFileSync(absolute, "utf8");
}

function buildTextInputs(input, changedFileRecords) {
  return [
    { path: input.prBodyPath ?? "pr_body", text: input.prBodyText ?? "" },
    { path: input.handoffPath ?? "handoff", text: stringifyForSearch(input.handoff) },
    { path: input.evidencePath ?? "evidence", text: input.evidenceText || stringifyForSearch(input.evidenceValue) },
    { path: input.changedFilesPath ?? "changed_files", text: changedFileRecords.map((record) => `${record.path}\n${record.content}`).join("\n") },
  ];
}

function hasRulePackIdentity(rulePack) {
  return isObject(rulePack) && nonEmptyString(rulePack.schema_version) && nonEmptyString(rulePack.rule_pack_id);
}

function passResult(rule) {
  return {
    rule_id: String(rule.rule_id),
    code: String(rule.code),
    severity: String(rule.severity ?? "WARN"),
    verdict: "PASS",
    path: null,
    evidence: [],
  };
}

function finding({ ruleId, code, severity, verdict, path: findingPath, evidence }) {
  return {
    rule_id: ruleId,
    code,
    severity,
    verdict,
    path: findingPath,
    evidence: evidence.filter(Boolean).map(String),
  };
}

function toSummary(result) {
  return {
    rule_id: result.rule_id,
    code: result.code,
    severity: result.severity,
    path: result.path,
    evidence: result.evidence,
  };
}

function requiredNextActions(blockers, warnings, needsReview = []) {
  if (blockers.length === 0 && warnings.length === 0 && needsReview.length === 0) return [];
  return [...blockers, ...needsReview, ...warnings].map((result) => ({
    rule_id: result.rule_id,
    action: actionForResult(result),
  }));
}

function actionForResult(result) {
  if (result.verdict === "NEEDS_REVIEW") {
    return "Record a safe or unsafe decision per item in a design_rule_review (shirube-additional-review/v1) written by a seat other than the author.";
  }
  const actions = {
    "DR-LLM-001": "Replace LLM/model final authority claim with machine evidence and owner decision.",
    "DR-DATA-001": "Add soft-delete policy evidence or an explicit approved scoped exception.",
    "DR-ARCH-001": "Move configurable domain shape toward DB/config or document why source ownership is acceptable.",
    "DR-CODE-001": "Extract or justify duplicate code block.",
    "DR-CONFIG-001": "Move repeated configurable values to DB/config/content ownership.",
    "DR-SAFE-001": "Declare protected_stop or escalation route before touching protected surfaces.",
    "DR-CONFIG-002": "Move business constants to their declared SSOT.",
    "DR-RULEPACK-001": "Provide a design rule pack with schema_version and rule_pack_id.",
  };
  return actions[result.rule_id] ?? `Resolve ${result.code}.`;
}

function failureReport({ code, message }) {
  return {
    schema: SCHEMA,
    rule_pack_id: null,
    verdict: "FAILURE",
    would_block: false,
    rule_results: [],
    blockers: [],
    warnings: [],
    evidence: [],
    required_next_actions: [{ code, message }],
  };
}

function stableRuleResults(results) {
  return uniqueByKey(results, (result) => `${result.rule_id}\0${result.verdict}\0${result.path ?? ""}\0${result.evidence.join("|")}`)
    .sort((a, b) => [
      a.rule_id.localeCompare(b.rule_id),
      String(a.path ?? "").localeCompare(String(b.path ?? "")),
      a.verdict.localeCompare(b.verdict),
    ].find((value) => value !== 0) ?? 0);
}

function uniqueEvidence(evidence) {
  return uniqueByKey(evidence, (entry) => `${entry.code}\0${entry.source}\0${entry.detail}`);
}

function uniqueByKey(values, keyFn) {
  const seen = new Set();
  const unique = [];
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

function containsPattern(text, pattern) {
  if (!text || !pattern) return false;
  return text.toLowerCase().includes(String(pattern).toLowerCase());
}

function hasSoftDeletePolicy(content, markers) {
  return markers.some((marker) => containsPattern(content, marker));
}

function hasApprovedException({ input, ruleId, filePath, now, authorActors }) {
  const exceptions = [
    ...asArray(input.handoff?.design_rule_exceptions),
    ...asArray(input.evidenceValue?.design_rule_exceptions),
  ].filter(isObject);
  return exceptions.some((exception) => {
    if (exception.rule_id !== ruleId) return false;
    if (!nonEmptyString(exception.reason) || !nonEmptyString(exception.approved_by)) return false;
    // With no identifiable author there is nobody to be independent of: the exception is not applied.
    if (authorActors.length === 0 || authorActors.includes(exception.approved_by.trim().toLowerCase())) return false;
    // An exception without a valid, unexpired expires_at is not accepted.
    if (!nonEmptyString(exception.expires_at) || isExpired(exception.expires_at, now)) return false;
    const scopes = asStringArray(exception.scope);
    if (scopes.length === 0) return false;
    return matchesAnyGlob(filePath, scopes);
  });
}

function isExpired(value, now) {
  if (!nonEmptyString(value)) return true;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return true;
  return timestamp <= now;
}

function resolveNow(value) {
  if (value === undefined || value === null) return Date.now();
  const timestamp = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(String(value));
  if (Number.isNaN(timestamp)) throw new Error(`Invalid evaluation time: ${String(value)}`);
  return timestamp;
}

function authorActorsFrom(input) {
  return [
    ...asArray(input.authorActors),
    ...authorActorsOfHandoff(input.handoff),
  ].filter(nonEmptyString).map((value) => value.trim().toLowerCase());
}

function isSourceOrMigrationLike(filePath) {
  return isSourcePath(filePath) ||
    /(^|\/)(migration|migrations|schema|db)\b/i.test(filePath) ||
    /\.(sql|prisma)$/.test(filePath);
}

function isSourcePath(filePath) {
  return /\.(mjs|cjs|js|jsx|ts|tsx|sql|prisma|rb|py|go|java|kt|swift)$/.test(filePath);
}

function isAllowedConfigLocation(filePath) {
  return matchesAnyGlob(filePath, ["config/**", "*.config.*", ".shirube/**", "templates/**", "test/**", "tests/**", "docs/**"]);
}

function hasEnumLikeBusinessArray(content) {
  return /\b(?:const|let|var)\s+\w*(?:plans?|types?|labels?|tiers?|ranks?)\w*\s*=\s*\[[^\]]*["'][^"']{3,}["'][^\]]*["'][^"']{3,}["']/i.test(content);
}

function hasRepeatedLiteralBranches(content) {
  const matches = [...content.matchAll(/(?:===|!==|==|!=)\s*["']([^"']{3,})["']/g)].map((match) => match[1]);
  return new Set(matches).size >= 2 && matches.length >= 3;
}

function longestDuplicateBlock(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isCommentOnly(line));
  let best = 0;
  for (let left = 0; left < lines.length; left += 1) {
    for (let right = left + 1; right < lines.length; right += 1) {
      let length = 0;
      while (lines[left + length] && lines[left + length] === lines[right + length]) {
        length += 1;
      }
      if (length > best) best = length;
    }
  }
  return { length: best };
}

function isCommentOnly(line) {
  return /^(\/\/|#|\/\*|\*|\*\/)/.test(line);
}

function repeatedStringLiterals(content, minCount) {
  const counts = new Map();
  const matches = content.matchAll(/(["'`])([^"'`\n]{3,80})\1/g);
  for (const match of matches) {
    const literal = match[2].trim();
    if (!isMeaningfulLiteral(literal)) continue;
    counts.set(literal, (counts.get(literal) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .map(([literal, count]) => `repeated literal "${literal}" x${count}`);
}

function isMeaningfulLiteral(literal) {
  if (/^[./@_\-\w]+$/.test(literal) && !/\s/.test(literal) && literal.length < 8) return false;
  if (/^(true|false|null|undefined|GET|POST|PUT|PATCH|DELETE)$/i.test(literal)) return false;
  return true;
}

function environmentSpecificValues(content) {
  const values = [];
  if (/https?:\/\/(?:localhost|staging|prod|production|dev)\b/i.test(content)) {
    values.push("environment-specific URL");
  }
  if (/\b(?:tenant|hotel|operator|plan|rank)[A-Z_]*ID\b/.test(content)) {
    values.push("environment-specific business ID/name");
  }
  return values;
}

function hasProtectedDeclaration(handoff) {
  if (!isObject(handoff)) return false;
  const cell = isObject(handoff.cell) ? handoff.cell : {};
  return handoff.protected_stop === true ||
    cell.protected_stop === true ||
    cell.cell_type === "protected_stop" ||
    nonEmptyString(handoff.escalation_route) ||
    nonEmptyString(cell.escalation_route) ||
    presentArray(handoff.protected_surfaces) ||
    presentArray(cell.protected_surfaces);
}

function matchesAnyGlob(file, globs) {
  return globs.some((glob) => globToRegExp(glob).test(file));
}

function globToRegExp(glob) {
  let pattern = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    const nextNext = glob[index + 2];
    if (char === "*" && next === "*" && nextNext === "/") {
      pattern += "(?:.*/)?";
      index += 2;
      continue;
    }
    if (char === "*" && next === "*") {
      pattern += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      pattern += "[^/]*";
      continue;
    }
    pattern += escapeRegExp(char);
  }
  pattern += "$";
  return new RegExp(pattern);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stringifyForSearch(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function stringOrNull(value) {
  return nonEmptyString(value) ? value : null;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function asStringArray(value) {
  return asArray(value).filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim());
}

function presentArray(value) {
  return asArray(value).some((entry) => {
    if (Array.isArray(entry)) return presentArray(entry);
    if (isObject(entry)) return Object.keys(entry).length > 0;
    return nonEmptyString(entry);
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function main() {
  const { options } = parseArgs(process.argv.slice(2));
  if (options.format !== "json") {
    const result = failureReport({
      code: "unsupported_format",
      message: "--format json is required.",
    });
    writeResult(result);
    process.exitCode = 1;
    return;
  }

  let readResult;
  try {
    readResult = readInput(options);
  } catch (error) {
    const result = failureReport({
      code: "input_read_error",
      message: errorMessage(error),
    });
    writeResult(result);
    process.exitCode = 1;
    return;
  }

  if (readResult.error) {
    writeResult(readResult.error);
    process.exitCode = 1;
    return;
  }

  const result = buildDesignRuleReport(readResult.input);
  writeResult(result);
  if (result.verdict === "FAILURE") process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main();
}
