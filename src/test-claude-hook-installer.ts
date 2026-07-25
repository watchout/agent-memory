import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  CLAUDE_HOOK_MATCHER,
  buildClaudeHookCommand,
  buildClaudeSessionStartHookGroup,
  installClaudeSessionStartHook,
  mergeClaudeSessionStartHook,
  parseClaudeHookCommand,
  parseClaudeHookInstallArgs,
  parseClaudeSettings,
  type ClaudeSettingsFile,
} from "./claude-hook-installer.js";
import {
  CLAUDE_SESSION_START_ADAPTER_ID,
  CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS,
  CLAUDE_SESSION_START_INTERNAL_TIMEOUT_MS,
  CLAUDE_SESSION_START_MAX_BYTES,
  CLAUDE_SESSION_START_MAX_TOKENS,
  type ClaudeSessionStartBinding,
} from "./claude-session-start.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function binding(workspace: string): ClaudeSessionStartBinding {
  return {
    agent_id: "spec's-canary",
    project: "agent-memory",
    workspace,
    binding_source_ref: "https://github.com/watchout/agent-memory/issues/180#owner",
    max_tokens: CLAUDE_SESSION_START_MAX_TOKENS,
    max_bytes: CLAUDE_SESSION_START_MAX_BYTES,
    timeout_ms: CLAUDE_SESSION_START_INTERNAL_TIMEOUT_MS,
  };
}

function options(workspace: string, runtimeRoot: string, mode: "check" | "dry-run" | "apply") {
  return {
    mode,
    workspace,
    runtime_root: runtimeRoot,
    agent_id: "spec's-canary",
    project: "agent-memory",
    binding_source_ref: "https://github.com/watchout/agent-memory/issues/180#owner",
  } as const;
}

async function expectReject(action: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(action, pattern);
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "wasurezu-claude-installer-"));
  try {
    const runtimeRoot = join(root, "runtime root's");
    const workspace = join(root, "workspace root's");
    await mkdir(join(runtimeRoot, "dist"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(runtimeRoot, "dist", "claude-session-start.js"), "// fixture\n", "utf8");

    const exactBinding = binding(workspace);
    const command = buildClaudeHookCommand(runtimeRoot, exactBinding);
    const parsed = parseClaudeHookCommand(command);
    assert(parsed, "canonical command must parse");
    assert.deepEqual(parsed.binding, exactBinding);
    assert.equal(parsed.runtime_root, runtimeRoot);
    assert.equal(parseClaudeHookCommand(`${command}; touch /tmp/nope`), null);
    assert.equal(parseClaudeHookCommand(command.replace("--agent-id", "--agent")), null);
    assert.equal(parseClaudeHookCommand(command.replace(String(CLAUDE_SESSION_START_MAX_TOKENS), "999999")), null);

    const group = buildClaudeSessionStartHookGroup(runtimeRoot, exactBinding);
    assert.equal(group.matcher, CLAUDE_HOOK_MATCHER);
    assert.equal(group.hooks.length, 1);
    assert.equal(group.hooks[0]?.type, "command");
    assert.equal(group.hooks[0]?.timeout, CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS);
    assert.equal(group.hooks[0]?.statusMessage, "Recovering prior work with Wasurezu");

    assert.deepEqual(parseClaudeHookInstallArgs([
      "--dry-run", "--workspace", workspace, "--runtime-root", runtimeRoot,
      "--agent-id", "spec", "--project", "agent-memory", "--binding-source-ref", "owner-ref",
      "--max-tokens", "1200", "--max-bytes", "4096", "--timeout-ms", "5000",
    ]), {
      mode: "dry-run",
      workspace,
      runtime_root: runtimeRoot,
      agent_id: "spec",
      project: "agent-memory",
      binding_source_ref: "owner-ref",
      max_tokens: 1200,
      max_bytes: 4096,
      timeout_ms: 5000,
    });
    assert.throws(() => parseClaudeHookInstallArgs(["--wat"]), /unknown argument/);
    assert.throws(() => parseClaudeHookInstallArgs(["--max-tokens", "0"]), /positive integer/);

    const existing: ClaudeSettingsFile = {
      permissions: { allow: ["Read"] },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo safe" }] }],
        SessionStart: [
          { matcher: "startup", hooks: [{ type: "command", command: "echo unrelated", timeout: 3 }] },
          { matcher: "resume", hooks: [{ type: "command", command }] },
        ],
      },
    };
    const merged = mergeClaudeSessionStartHook(existing, runtimeRoot, exactBinding);
    assert.equal(merged.unrelatedBefore, 1);
    assert.equal(merged.unrelatedAfter, 1);
    assert.deepEqual(merged.settings.permissions, existing.permissions);
    assert.deepEqual(merged.settings.hooks.PreToolUse, existing.hooks.PreToolUse);
    assert.equal(merged.settings.hooks.SessionStart?.length, 2);
    assert.equal(merged.settings.hooks.SessionStart?.[0]?.hooks[0]?.command, "echo unrelated");
    assert.equal(
      (merged.settings.hooks.SessionStart?.[1]?.hooks[0]?.command as string).includes(CLAUDE_SESSION_START_ADAPTER_ID),
      true,
    );

    const lookalikeCommand = `echo ${CLAUDE_SESSION_START_ADAPTER_ID}`;
    const lookalike = mergeClaudeSessionStartHook({
      hooks: {
        SessionStart: [{
          matcher: "startup",
          hooks: [{ type: "command", command: lookalikeCommand, timeout: 3 }],
        }],
      },
    }, runtimeRoot, exactBinding);
    assert.equal(lookalike.unrelatedBefore, 1);
    assert.equal(lookalike.unrelatedAfter, 1);
    assert.equal(lookalike.settings.hooks.SessionStart?.[0]?.hooks[0]?.command, lookalikeCommand);
    assert.equal(lookalike.settings.hooks.SessionStart?.length, 2);

    assert.throws(() => parseClaudeSettings("{"), /not valid JSON/);
    assert.throws(() => parseClaudeSettings("[]"), /must contain an object/);
    assert.throws(() => parseClaudeSettings('{"hooks":[]}'), /hooks must be an object/);
    assert.throws(() => parseClaudeSettings('{"hooks":{"SessionStart":{}}}'), /must be an array/);

    const dryWorkspace = join(root, "dry-workspace");
    await mkdir(dryWorkspace);
    const dry = await installClaudeSessionStartHook(options(dryWorkspace, runtimeRoot, "dry-run"));
    assert.equal(dry.placement_status, "absent");
    assert.equal(dry.config_match, "absent");
    assert.equal(dry.would_change, true);
    assert.equal(dry.wrote_settings_file, false);
    assert.equal(dry.trust_verified, false);
    assert.equal(dry.first_context_delivered, false);
    await assert.rejects(stat(join(dryWorkspace, ".claude", "settings.json")), /ENOENT/);

    const createWorkspace = join(root, "create-workspace");
    await mkdir(createWorkspace);
    const created = await installClaudeSessionStartHook(options(createWorkspace, runtimeRoot, "apply"));
    assert.equal(created.config_match, "exact");
    assert.equal(created.wrote_settings_file, true);
    assert.equal(created.backup_file, null);
    assert.equal(created.next_action, "review_current_project_settings");
    assert.equal((await stat(created.settings_file)).mode & 0o777, 0o600);
    const createdSettings = parseClaudeSettings(await readFile(created.settings_file, "utf8"));
    assert.equal(createdSettings.hooks.SessionStart?.length, 1);
    const checked = await installClaudeSessionStartHook(options(createWorkspace, runtimeRoot, "check"));
    assert.equal(checked.config_match, "exact");
    assert.equal(checked.would_change, false);
    assert.equal(checked.wrote_settings_file, false);

    const preserveWorkspace = join(root, "preserve-workspace");
    const preserveDir = join(preserveWorkspace, ".claude");
    await mkdir(preserveDir, { recursive: true });
    const preimage = `${JSON.stringify(existing, null, 2)}\n`;
    await writeFile(join(preserveDir, "settings.json"), preimage, "utf8");
    const applied = await installClaudeSessionStartHook(options(preserveWorkspace, runtimeRoot, "apply"));
    assert.equal(applied.config_match, "exact");
    assert.equal(applied.wrote_settings_file, true);
    assert(applied.backup_file);
    assert.equal(await readFile(applied.backup_file, "utf8"), preimage);
    assert.equal((await stat(applied.backup_file)).mode & 0o777, 0o600);
    const after = parseClaudeSettings(await readFile(applied.settings_file, "utf8"));
    assert.deepEqual(after.permissions, existing.permissions);
    assert.deepEqual(after.hooks.PreToolUse, existing.hooks.PreToolUse);
    assert.equal(after.hooks.SessionStart?.[0]?.hooks[0]?.command, "echo unrelated");
    assert.equal(applied.unrelated_hook_handler_count_before, 1);
    assert.equal(applied.unrelated_hook_handler_count_after, 1);

    const invalidWorkspace = join(root, "invalid-workspace");
    await mkdir(join(invalidWorkspace, ".claude"), { recursive: true });
    await writeFile(join(invalidWorkspace, ".claude", "settings.json"), "not-json", "utf8");
    await expectReject(
      () => installClaudeSessionStartHook(options(invalidWorkspace, runtimeRoot, "dry-run")),
      /not valid JSON/,
    );

    const symlinkWorkspace = join(root, "symlink-workspace");
    await mkdir(join(symlinkWorkspace, ".claude"), { recursive: true });
    const externalSettings = join(root, "external-settings.json");
    await writeFile(externalSettings, '{"hooks":{}}\n', "utf8");
    await symlink(externalSettings, join(symlinkWorkspace, ".claude", "settings.json"));
    await expectReject(
      () => installClaudeSessionStartHook(options(symlinkWorkspace, runtimeRoot, "apply")),
      /refusing symlink path/,
    );

    const runnerSymlinkRoot = join(root, "runner-symlink-root");
    await mkdir(join(runnerSymlinkRoot, "dist"), { recursive: true });
    await symlink(join(runtimeRoot, "dist", "claude-session-start.js"), join(runnerSymlinkRoot, "dist", "claude-session-start.js"));
    await expectReject(
      () => installClaudeSessionStartHook(options(createWorkspace, runnerSymlinkRoot, "dry-run")),
      /invalid hook runner/,
    );

    const cliWorkspace = join(root, "cli-workspace");
    await mkdir(cliWorkspace);
    const cli = spawnSync(process.execPath, [
      resolve(repositoryRoot, "dist", "claude-hook-installer.js"),
      "--dry-run", "--workspace", cliWorkspace, "--runtime-root", repositoryRoot,
      "--agent-id", "spec", "--project", "agent-memory", "--binding-source-ref", "owner-ref",
    ], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).schema_version, "claude-hook-install-report/v1");
    assert.equal(cli.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log("claude hook installer tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
