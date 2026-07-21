#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type CompanyDevOsRecoveryAuditStatus = "pass" | "fail";
export type CompanyDevOsRecoveryFindingSeverity = "warn" | "block";
export type CaptureHostSelector = "claude" | "codex" | "both";

export interface CaptureTarget {
  agent_id: string;
  project: string;
  cwd: string;
  host?: CaptureHostSelector;
  enabled?: boolean;
}

export interface CompanyDevOsExpectedTarget {
  source: "repo_overlay" | "bot_workspace";
  path: string;
  cwd: string;
  agent_id: string;
  project: string;
  role?: string;
}

export interface CompanyDevOsRecoveryFinding {
  severity: CompanyDevOsRecoveryFindingSeverity;
  code:
    | "registry_missing"
    | "registry_non_codex"
    | "agents_recovery_missing"
    | "instructions_recovery_missing"
    | "launcher_missing"
    | "launcher_not_executable"
    | "registry_identity_differs"
    | "alias_approval_expired"
    | "company_target_conflict"
    | "company_targets_below_minimum"
    | "registry_targets_below_minimum";
  message: string;
  cwd: string;
  expected_agent_id?: string;
  actual_agent_id?: string;
  expected_project?: string;
  actual_project?: string;
  file?: string;
  approval_id?: string;
}

export interface CompanyDevOsRecoveryTargetReport {
  cwd: string;
  sources: CompanyDevOsExpectedTarget[];
  registry_target?: {
    agent_id: string;
    project: string;
    host: string;
  };
  launcher_file: string;
  launcher_status: "ok" | "missing" | "not_executable";
  agents_recovery_block: boolean;
  instructions_recovery_block: boolean;
  findings: CompanyDevOsRecoveryFinding[];
}

export interface CompanyDevOsRecoveryAuditReport {
  status: CompanyDevOsRecoveryAuditStatus;
  checked_at: string;
  targets_file?: string;
  company_dev_os_root: string;
  totals: {
    company_targets: number;
    existing_company_targets: number;
    skipped_missing_dirs: number;
    registry_targets: number;
    block_findings: number;
    warn_findings: number;
  };
  targets: CompanyDevOsRecoveryTargetReport[];
  skipped_missing_dirs: CompanyDevOsExpectedTarget[];
  findings: CompanyDevOsRecoveryFinding[];
}

export interface CompanyDevOsRecoveryAuditOptions {
  targetsFile?: string;
  aliasFile?: string;
  companyDevOsRoot?: string;
  devRoot?: string;
  minCompanyTargets?: number;
  minRegistryTargets?: number;
}

const AGENTS_MARKER = "<!-- agent-memory-codex-agents:start -->";
const INSTRUCTIONS_MARKER = "<!-- agent-memory-codex-recovery:start -->";
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ALIAS_FILE = resolve(MODULE_DIR, "..", "docs", "operations", "company-dev-os-recovery-target-aliases.json");

interface AliasApproval {
  id: string;
  cwd: string;
  source_agent_id: string;
  source_project: string;
  registry_agent_id: string;
  registry_project: string;
  approved_by: string;
  reason: string;
  expires_at?: string;
}

interface AliasApprovalFile {
  min_company_targets?: number;
  min_registry_targets?: number;
  approvals: AliasApproval[];
  expired_approvals: AliasApproval[];
}

interface CaptureTargetsFile {
  targets?: unknown;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-/g, "_");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = value;
      index++;
    }
  }
  return args;
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`invalid non-negative integer: ${value}`);
  }
  return parsed;
}

async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function defaultCaptureTargetsFile(): string {
  return join(homedir(), ".agent-memory", "raw-capture-targets.json");
}

function resolveCaptureTargetsFile(path?: string): string | undefined {
  if (path) return resolve(path);
  const defaultPath = defaultCaptureTargetsFile();
  return existsSync(defaultPath) ? defaultPath : undefined;
}

function hostRequiresCodex(target: CaptureTarget): boolean {
  return target.host === "codex" || target.host === "both" || target.host === undefined;
}

function uniqueByCwd(targets: CompanyDevOsExpectedTarget[]): Map<string, CompanyDevOsExpectedTarget[]> {
  const out = new Map<string, CompanyDevOsExpectedTarget[]>();
  for (const target of targets) {
    const list = out.get(target.cwd) ?? [];
    list.push(target);
    out.set(target.cwd, list);
  }
  return out;
}

function parseRepoOverlay(script: string, devRoot: string): CompanyDevOsExpectedTarget[] {
  const out: CompanyDevOsExpectedTarget[] = [];
  const regex = /Target\("([^"]+)",\s*"[^"]+",\s*"([^"]+)",\s*"[^"]+"\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(script)) !== null) {
    const path = match[1];
    const agentId = match[2];
    out.push({
      source: "repo_overlay",
      path,
      cwd: resolve(devRoot, path),
      agent_id: agentId,
      project: path.split("/").pop() ?? path,
    });
  }
  return out;
}

function parseBotWorkspaceOverlay(script: string, devRoot: string): CompanyDevOsExpectedTarget[] {
  const out: CompanyDevOsExpectedTarget[] = [];
  const regex =
    /BotWorkspace\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"[^"]+",\s*"([^"]+)",\s*(?:True|False),\s*"[^"]+"\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(script)) !== null) {
    const path = match[1];
    out.push({
      source: "bot_workspace",
      path,
      cwd: resolve(devRoot, path),
      agent_id: match[2],
      role: match[3],
      project: match[4],
    });
  }
  return out;
}

async function loadCompanyDevOsTargets(
  companyDevOsRoot: string,
  devRoot: string
): Promise<CompanyDevOsExpectedTarget[]> {
  const scriptsRoot = join(companyDevOsRoot, "cross-cutting", "scripts");
  const [repoScript, botScript] = await Promise.all([
    readText(join(scriptsRoot, "apply-company-dev-os-runtime-overlay.py")),
    readText(join(scriptsRoot, "apply-company-dev-os-bot-workspace-overlay.py")),
  ]);
  return [
    ...parseRepoOverlay(repoScript, devRoot),
    ...parseBotWorkspaceOverlay(botScript, devRoot),
  ];
}

async function hasMarker(path: string, marker: string): Promise<boolean> {
  try {
    return (await readText(path)).includes(marker);
  } catch {
    return false;
  }
}

async function executableStatus(path: string): Promise<"ok" | "missing" | "not_executable"> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return "missing";
    return (info.mode & 0o111) !== 0 ? "ok" : "not_executable";
  } catch {
    return "missing";
  }
}

function block(input: Omit<CompanyDevOsRecoveryFinding, "severity">): CompanyDevOsRecoveryFinding {
  return { severity: "block", ...input };
}

function warn(input: Omit<CompanyDevOsRecoveryFinding, "severity">): CompanyDevOsRecoveryFinding {
  return { severity: "warn", ...input };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredCaptureTargetString(record: Record<string, unknown>, key: string, file: string, index: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${file}: targets[${index}] has invalid ${key}`);
  }
  return value;
}

function optionalCaptureTargetHost(value: unknown, file: string, index: number): CaptureHostSelector | undefined {
  if (value === undefined) return undefined;
  if (value === "claude" || value === "codex" || value === "both") return value;
  throw new Error(`${file}: targets[${index}] has invalid host`);
}

function normalizeCaptureTarget(value: unknown, file: string, index: number): CaptureTarget {
  if (!isRecord(value)) throw new Error(`${file}: targets[${index}] must be an object`);
  return {
    agent_id: requiredCaptureTargetString(value, "agent_id", file, index),
    project: requiredCaptureTargetString(value, "project", file, index),
    cwd: resolve(requiredCaptureTargetString(value, "cwd", file, index)),
    host: optionalCaptureTargetHost(value.host, file, index) ?? "both",
    enabled: value.enabled === undefined ? true : value.enabled !== false,
  };
}

async function loadCaptureTargets(path?: string): Promise<CaptureTarget[]> {
  const targetsFile = resolveCaptureTargetsFile(path);
  if (!targetsFile) return [];
  const parsed = JSON.parse(await readText(targetsFile)) as CaptureTargetsFile;
  if (!Array.isArray(parsed.targets)) {
    throw new Error(`${targetsFile}: targets must be an array`);
  }
  return parsed.targets
    .map((value, index) => normalizeCaptureTarget(value, targetsFile, index))
    .filter((target) => target.enabled !== false);
}

function requiredString(record: Record<string, unknown>, key: string, file: string, index: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${file}: approvals[${index}] has invalid ${key}`);
  }
  return value;
}

function optionalNonNegativeInteger(value: unknown, key: string, file: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${file}: ${key} must be a non-negative integer`);
  }
  return Number(value);
}

async function loadAliasApprovalFile(path?: string): Promise<AliasApprovalFile> {
  const aliasFile = path ?? (existsSync(DEFAULT_ALIAS_FILE) ? DEFAULT_ALIAS_FILE : undefined);
  if (!aliasFile) return { approvals: [], expired_approvals: [] };
  const parsed = JSON.parse(await readText(aliasFile)) as unknown;
  if (!isRecord(parsed)) throw new Error(`${aliasFile}: alias file must be an object`);
  const rawApprovals = parsed.approvals;
  if (!Array.isArray(rawApprovals)) throw new Error(`${aliasFile}: approvals must be an array`);
  const approvals = rawApprovals.map((value, index): AliasApproval => {
    if (!isRecord(value)) throw new Error(`${aliasFile}: approvals[${index}] must be an object`);
    const expiresAt = typeof value.expires_at === "string" && value.expires_at.trim() !== ""
      ? value.expires_at
      : undefined;
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
      throw new Error(`${aliasFile}: approvals[${index}] has invalid expires_at`);
    }
    return {
      id: requiredString(value, "id", aliasFile, index),
      cwd: resolve(requiredString(value, "cwd", aliasFile, index)),
      source_agent_id: requiredString(value, "source_agent_id", aliasFile, index),
      source_project: requiredString(value, "source_project", aliasFile, index),
      registry_agent_id: requiredString(value, "registry_agent_id", aliasFile, index),
      registry_project: requiredString(value, "registry_project", aliasFile, index),
      approved_by: requiredString(value, "approved_by", aliasFile, index),
      reason: requiredString(value, "reason", aliasFile, index),
      expires_at: expiresAt,
    };
  });
  const now = Date.now();
  return {
    min_company_targets: optionalNonNegativeInteger(parsed.min_company_targets, "min_company_targets", aliasFile),
    min_registry_targets: optionalNonNegativeInteger(parsed.min_registry_targets, "min_registry_targets", aliasFile),
    approvals: approvals.filter((approval) => !approval.expires_at || Date.parse(approval.expires_at) > now),
    expired_approvals: approvals.filter((approval) => approval.expires_at !== undefined && Date.parse(approval.expires_at) <= now),
  };
}

function sameIdentity(source: CompanyDevOsExpectedTarget, registryTarget: CaptureTarget): boolean {
  return registryTarget.agent_id === source.agent_id && registryTarget.project === source.project;
}

function findAliasApproval(
  approvals: AliasApproval[],
  source: CompanyDevOsExpectedTarget,
  registryTarget: CaptureTarget | undefined
): AliasApproval | undefined {
  if (!registryTarget) return undefined;
  const cwd = resolve(source.cwd);
  return approvals.find((approval) =>
    approval.cwd === cwd &&
    approval.source_agent_id === source.agent_id &&
    approval.source_project === source.project &&
    approval.registry_agent_id === registryTarget.agent_id &&
    approval.registry_project === registryTarget.project
  );
}

export async function runCompanyDevOsRecoveryTargetAudit(
  options: CompanyDevOsRecoveryAuditOptions = {}
): Promise<CompanyDevOsRecoveryAuditReport> {
  const devRoot = resolve(options.devRoot ?? process.env.AGENT_MEMORY_DEV_ROOT ?? "/Users/yuji/Developer");
  const companyDevOsRoot = resolve(options.companyDevOsRoot ?? join(devRoot, "iyasaka-arc"));
  const targetsFile = options.targetsFile ?? process.env.AGENT_MEMORY_CAPTURE_TARGETS_FILE;
  const resolvedTargetsFile = resolveCaptureTargetsFile(targetsFile);
  const aliasFile = options.aliasFile ?? process.env.AGENT_MEMORY_COMPANY_DEV_OS_ALIAS_FILE;
  const [companyTargets, registryTargets, aliasApprovals] = await Promise.all([
    loadCompanyDevOsTargets(companyDevOsRoot, devRoot),
    loadCaptureTargets(resolvedTargetsFile),
    loadAliasApprovalFile(aliasFile),
  ]);
  const codexRegistryByCwd = new Map<string, CaptureTarget>();
  for (const target of registryTargets) {
    if (hostRequiresCodex(target)) codexRegistryByCwd.set(resolve(target.cwd), target);
  }

  const targets: CompanyDevOsRecoveryTargetReport[] = [];
  const skippedMissingDirs: CompanyDevOsExpectedTarget[] = [];
  const findings: CompanyDevOsRecoveryFinding[] = [];
  const minCompanyTargets = options.minCompanyTargets ?? aliasApprovals.min_company_targets ?? 1;
  const minRegistryTargets = options.minRegistryTargets ?? aliasApprovals.min_registry_targets ?? 1;

  const companyTargetCwds = new Set(companyTargets.map((target) => resolve(target.cwd)));
  for (const approval of aliasApprovals.expired_approvals) {
    if (!companyTargetCwds.has(approval.cwd)) continue;
    findings.push(warn({
      code: "alias_approval_expired",
      message: "Alias approval is expired and is not being used as identity authority",
      cwd: approval.cwd,
      expected_agent_id: approval.source_agent_id,
      actual_agent_id: approval.registry_agent_id,
      expected_project: approval.source_project,
      actual_project: approval.registry_project,
      approval_id: approval.id,
    }));
  }

  if (companyTargets.length < minCompanyTargets) {
    findings.push(block({
      code: "company_targets_below_minimum",
      message: `Company Dev OS source target count is below the required minimum (${companyTargets.length}/${minCompanyTargets})`,
      cwd: companyDevOsRoot,
      expected_project: String(minCompanyTargets),
      actual_project: String(companyTargets.length),
    }));
  }
  if (registryTargets.length < minRegistryTargets) {
    findings.push(block({
      code: "registry_targets_below_minimum",
      message: `Wasurezu target registry count is below the required minimum (${registryTargets.length}/${minRegistryTargets})`,
      cwd: targetsFile ?? "built-in-targets",
      expected_project: String(minRegistryTargets),
      actual_project: String(registryTargets.length),
    }));
  }

  for (const [cwd, sources] of uniqueByCwd(companyTargets)) {
    const existingSources = sources.filter((source) => existsSync(source.cwd));
    if (existingSources.length === 0) {
      skippedMissingDirs.push(...sources);
      continue;
    }
    const source = existingSources[0];
    const targetFindings: CompanyDevOsRecoveryFinding[] = [];
    const registryTarget = codexRegistryByCwd.get(cwd);
    const launcherFile = join(cwd, ".codex", "start-with-memory.sh");
    const [launcherStatus, agentsBlock, instructionsBlock] = await Promise.all([
      executableStatus(launcherFile),
      hasMarker(join(cwd, "AGENTS.md"), AGENTS_MARKER),
      hasMarker(join(cwd, ".codex", "instructions.md"), INSTRUCTIONS_MARKER),
    ]);

    const sourceAgents = new Set(existingSources.map((item) => item.agent_id));
    const sourceProjects = new Set(existingSources.map((item) => item.project));
    if (sourceAgents.size > 1 || sourceProjects.size > 1) {
      const conflictApproved = registryTarget !== undefined &&
        existingSources.every((item) => sameIdentity(item, registryTarget) || findAliasApproval(aliasApprovals.approvals, item, registryTarget));
      targetFindings.push((conflictApproved ? warn : block)({
        code: "company_target_conflict",
        message: conflictApproved
          ? "Company Dev OS sources define multiple identities for the same cwd; all non-registry identities have explicit alias approvals"
          : "Company Dev OS sources define multiple identities for the same cwd and at least one identity lacks an explicit alias approval",
        cwd,
        expected_agent_id: Array.from(sourceAgents).join(","),
        expected_project: Array.from(sourceProjects).join(","),
      }));
    }

    if (!registryTarget) {
      targetFindings.push(block({
        code: "registry_missing",
        message: "Company Dev OS workspace is missing from Wasurezu raw capture targets",
        cwd,
        expected_agent_id: source.agent_id,
        expected_project: source.project,
      }));
    } else {
      if (!hostRequiresCodex(registryTarget)) {
        targetFindings.push(block({
          code: "registry_non_codex",
          message: "registry target exists but is not enabled for Codex recovery",
          cwd,
          expected_agent_id: source.agent_id,
          actual_agent_id: registryTarget.agent_id,
          expected_project: source.project,
          actual_project: registryTarget.project,
        }));
      }
      for (const identitySource of existingSources) {
        if (sameIdentity(identitySource, registryTarget)) continue;
        const approval = findAliasApproval(aliasApprovals.approvals, identitySource, registryTarget);
        targetFindings.push((approval ? warn : block)({
          code: "registry_identity_differs",
          message: approval
            ? `registry identity differs from Company Dev OS script but is explicitly approved: ${approval.reason}`
            : "registry identity differs from Company Dev OS script and has no explicit alias approval",
          cwd,
          expected_agent_id: identitySource.agent_id,
          actual_agent_id: registryTarget.agent_id,
          expected_project: identitySource.project,
          actual_project: registryTarget.project,
          approval_id: approval?.id,
        }));
      }
    }

    if (!agentsBlock) {
      targetFindings.push(block({
        code: "agents_recovery_missing",
        message: "AGENTS.md is missing Wasurezu Startup Recovery block",
        cwd,
        file: join(cwd, "AGENTS.md"),
      }));
    }
    if (!instructionsBlock) {
      targetFindings.push(block({
        code: "instructions_recovery_missing",
        message: ".codex/instructions.md is missing Wasurezu Startup Recovery block",
        cwd,
        file: join(cwd, ".codex", "instructions.md"),
      }));
    }
    if (launcherStatus === "missing") {
      targetFindings.push(block({
        code: "launcher_missing",
        message: "Codex deterministic recovery launcher is missing",
        cwd,
        file: launcherFile,
      }));
    } else if (launcherStatus === "not_executable") {
      targetFindings.push(block({
        code: "launcher_not_executable",
        message: "Codex deterministic recovery launcher is not executable",
        cwd,
        file: launcherFile,
      }));
    }

    findings.push(...targetFindings);
    targets.push({
      cwd,
      sources: existingSources,
      registry_target: registryTarget
        ? {
            agent_id: registryTarget.agent_id,
            project: registryTarget.project,
            host: registryTarget.host ?? "both",
          }
        : undefined,
      launcher_file: launcherFile,
      launcher_status: launcherStatus,
      agents_recovery_block: agentsBlock,
      instructions_recovery_block: instructionsBlock,
      findings: targetFindings,
    });
  }

  const blockFindings = findings.filter((item) => item.severity === "block").length;
  const warnFindings = findings.filter((item) => item.severity === "warn").length;
  return {
    status: blockFindings === 0 ? "pass" : "fail",
    checked_at: new Date().toISOString(),
    targets_file: resolvedTargetsFile,
    company_dev_os_root: companyDevOsRoot,
    totals: {
      company_targets: companyTargets.length,
      existing_company_targets: targets.length,
      skipped_missing_dirs: skippedMissingDirs.length,
      registry_targets: registryTargets.length,
      block_findings: blockFindings,
      warn_findings: warnFindings,
    },
    targets,
    skipped_missing_dirs: skippedMissingDirs,
    findings,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await runCompanyDevOsRecoveryTargetAudit({
    targetsFile: asString(args.targets_file),
    aliasFile: asString(args.alias_file),
    companyDevOsRoot: asString(args.company_dev_os_root),
    devRoot: asString(args.dev_root),
    minCompanyTargets: asNumber(asString(args.min_company_targets)),
    minRegistryTargets: asNumber(asString(args.min_registry_targets)),
  });
  if (args.json === true) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(
      [
        `company-dev-os recovery target audit: ${report.status}`,
        `targets=${report.totals.existing_company_targets}`,
        `registry_targets=${report.totals.registry_targets}`,
        `block_findings=${report.totals.block_findings}`,
        `warn_findings=${report.totals.warn_findings}`,
      ].join(" ") + "\n"
    );
    for (const finding of report.findings) {
      process.stdout.write(
        `${finding.severity.toUpperCase()} ${finding.code} ${finding.cwd}: ${finding.message}\n`
      );
    }
  }
  if (report.status !== "pass") process.exit(1);
}

const modulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === modulePath) {
  main().catch((err) => {
    process.stderr.write(`[company-dev-os-recovery-target-audit] ${err}\n`);
    process.exit(1);
  });
}
