import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCompanyDevOsRecoveryTargetAudit } from "./company-dev-os-recovery-target-audit.js";
import {
  CODEX_HOOK_MATCHER,
  CODEX_HOOK_STATUS_MESSAGE,
} from "./codex-hook-installer.js";
import {
  CODEX_SESSION_START_ADAPTER_ID,
  CODEX_SESSION_START_HOOK_TIMEOUT_SECONDS,
} from "./codex-session-start.js";

async function writeRecoveryFiles(root: string, agentId: string, project: string): Promise<void> {
  await mkdir(join(root, ".codex"), { recursive: true });
  await writeFile(
    join(root, "AGENTS.md"),
    "<!-- agent-memory-codex-agents:start -->\n# Wasurezu Startup Recovery\n<!-- agent-memory-codex-agents:end -->\n"
  );
  await writeFile(
    join(root, ".codex", "instructions.md"),
    "<!-- agent-memory-codex-recovery:start -->\n## Wasurezu Startup Recovery\n<!-- agent-memory-codex-recovery:end -->\n"
  );
  const launcher = join(root, ".codex", "start-with-memory.sh");
  await writeFile(launcher, "#!/usr/bin/env bash\nexit 0\n");
  await chmod(launcher, 0o755);
  await writeFile(
    join(root, ".codex", "hooks.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [{
          matcher: CODEX_HOOK_MATCHER,
          hooks: [{
            type: "command",
            command: [
              "node '/runtime/dist/codex-session-start.js'",
              `--adapter-id '${CODEX_SESSION_START_ADAPTER_ID}'`,
              `--agent-id '${agentId}'`,
              `--project '${project}'`,
              `--workspace '${root}'`,
              "--binding-source-ref 'fixture:registry'",
              "--max-tokens 1800",
              "--max-bytes 8192",
              "--timeout-ms 7000",
            ].join(" "),
            timeout: CODEX_SESSION_START_HOOK_TIMEOUT_SECONDS,
            statusMessage: CODEX_HOOK_STATUS_MESSAGE,
          }],
        }],
      },
    }, null, 2) + "\n"
  );
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "am-cdo-recovery-audit-"));
  try {
    const devRoot = join(root, "Developer");
    const companyRoot = join(devRoot, "iyasaka-arc");
    const scriptsRoot = join(companyRoot, "cross-cutting", "scripts");
    const repoA = join(devRoot, "repo-a");
    const qa = join(devRoot, "qa");
    await mkdir(scriptsRoot, { recursive: true });
    await mkdir(repoA, { recursive: true });
    await mkdir(qa, { recursive: true });

    await writeFile(
      join(scriptsRoot, "apply-company-dev-os-runtime-overlay.py"),
      'TARGETS = [\n    Target("repo-a", "watchout/repo-a", "repo-a-dev", "specified"),\n]\n'
    );
    await writeFile(
      join(scriptsRoot, "apply-company-dev-os-bot-workspace-overlay.py"),
      'BOT_WORKSPACES = [\n    BotWorkspace("qa", "qa", "qa", "Codex", "qa", False, "qa bot"),\n]\n'
    );
    await writeRecoveryFiles(repoA, "repo-a-dev", "repo-a");

    const targetsFile = join(root, "targets.json");
    await writeFile(
      targetsFile,
      JSON.stringify({
        version: 1,
        targets: [
          {
            agent_id: "repo-a-dev",
            project: "repo-a",
            cwd: repoA,
            host: "both",
          },
        ],
      }) + "\n"
    );

    const missing = await runCompanyDevOsRecoveryTargetAudit({
      targetsFile,
      companyDevOsRoot: companyRoot,
      devRoot,
    });
    assert.equal(missing.status, "fail");
    assert(missing.findings.some((item) => item.code === "registry_missing" && item.cwd === qa));
    assert(missing.findings.some((item) => item.code === "launcher_missing" && item.cwd === qa));
    assert(missing.findings.some((item) => item.code === "native_hook_missing" && item.cwd === qa));

    await writeRecoveryFiles(qa, "qa", "qa");
    await writeFile(
      targetsFile,
      JSON.stringify({
        version: 1,
        targets: [
          {
            agent_id: "repo-a-dev",
            project: "repo-a",
            cwd: repoA,
            host: "both",
          },
          {
            agent_id: "qa",
            project: "qa",
            cwd: qa,
            host: "codex",
          },
        ],
      }) + "\n"
    );

    const pass = await runCompanyDevOsRecoveryTargetAudit({
      targetsFile,
      companyDevOsRoot: companyRoot,
      devRoot,
    });
    assert.equal(pass.status, "pass");
    assert.equal(pass.totals.block_findings, 0);
    assert.equal(pass.totals.existing_company_targets, 2);

    await writeFile(
      targetsFile,
      JSON.stringify({
        version: 1,
        targets: [
          {
            agent_id: "repo-a-dev",
            project: "repo-a",
            cwd: repoA,
            host: "both",
          },
          {
            agent_id: "qa-runtime",
            project: "qa",
            cwd: qa,
            host: "codex",
          },
        ],
      }) + "\n"
    );

    const unapprovedMismatch = await runCompanyDevOsRecoveryTargetAudit({
      targetsFile,
      companyDevOsRoot: companyRoot,
      devRoot,
    });
    assert.equal(unapprovedMismatch.status, "fail");
    assert(unapprovedMismatch.findings.some((item) =>
      item.code === "registry_identity_differs" &&
      item.severity === "block" &&
      item.cwd === qa
    ));
    assert(unapprovedMismatch.findings.some((item) =>
      item.code === "native_hook_identity_differs" && item.severity === "block" && item.cwd === qa
    ));

    await writeRecoveryFiles(qa, "qa-runtime", "qa");

    const aliasFile = join(root, "aliases.json");
    await writeFile(
      aliasFile,
      JSON.stringify({
        version: 1,
        approvals: [
          {
            id: "qa-test-alias",
            cwd: qa,
            source_agent_id: "qa",
            source_project: "qa",
            registry_agent_id: "qa-runtime",
            registry_project: "qa",
            approved_by: "test",
            reason: "test-approved alias",
          },
        ],
      }) + "\n"
    );
    const approvedMismatch = await runCompanyDevOsRecoveryTargetAudit({
      targetsFile,
      aliasFile,
      companyDevOsRoot: companyRoot,
      devRoot,
    });
    assert.equal(approvedMismatch.status, "pass");
    assert(approvedMismatch.findings.some((item) =>
      item.code === "registry_identity_differs" &&
      item.severity === "warn" &&
      item.approval_id === "qa-test-alias"
    ));

    const expiredAliasFile = join(root, "expired-aliases.json");
    await writeFile(
      expiredAliasFile,
      JSON.stringify({
        version: 1,
        approvals: [
          {
            id: "qa-expired-alias",
            cwd: qa,
            source_agent_id: "qa",
            source_project: "qa",
            registry_agent_id: "qa-runtime",
            registry_project: "qa",
            approved_by: "test",
            reason: "expired approvals must not authorize an identity mismatch",
            expires_at: "2000-01-01T00:00:00.000Z",
          },
        ],
      }) + "\n"
    );
    const expiredMismatch = await runCompanyDevOsRecoveryTargetAudit({
      targetsFile,
      aliasFile: expiredAliasFile,
      companyDevOsRoot: companyRoot,
      devRoot,
    });
    assert.equal(expiredMismatch.status, "fail");
    assert(expiredMismatch.findings.some((item) =>
      item.code === "registry_identity_differs" && item.severity === "block" && item.cwd === qa
    ));
    assert(expiredMismatch.findings.some((item) =>
      item.code === "alias_approval_expired" && item.severity === "warn" && item.approval_id === "qa-expired-alias"
    ));

    await writeFile(join(scriptsRoot, "apply-company-dev-os-runtime-overlay.py"), "TARGETS = []\n");
    await writeFile(join(scriptsRoot, "apply-company-dev-os-bot-workspace-overlay.py"), "BOT_WORKSPACES = []\n");
    await writeFile(targetsFile, JSON.stringify({ version: 1, targets: [] }) + "\n");
    const empty = await runCompanyDevOsRecoveryTargetAudit({
      targetsFile,
      companyDevOsRoot: companyRoot,
      devRoot,
    });
    assert.equal(empty.status, "fail");
    assert(empty.findings.some((item) => item.code === "company_targets_below_minimum"));
    assert(empty.findings.some((item) => item.code === "registry_targets_below_minimum"));

    console.log("company dev os recovery target audit tests passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
