import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CODEX_HOOK_CONFIG_RELATIVE_PATH,
  CODEX_HOOK_MATCHER,
  buildCodexHookCommand,
  installCodexSessionStartHook,
  parseCodexHookInstallArgs,
  parseHooksFile,
  type CodexHookInstallOptions,
} from "./codex-hook-installer.js";
import {
  CODEX_SESSION_START_ADAPTER_ID,
  CODEX_SESSION_START_HOOK_TIMEOUT_SECONDS,
  type CodexSessionStartBinding,
} from "./codex-session-start.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function options(workspace: string, runtimeRoot: string, mode: CodexHookInstallOptions["mode"]): CodexHookInstallOptions {
  return {
    mode,
    workspace,
    runtime_root: runtimeRoot,
    agent_id: "kusabi",
    project: "agent-memory",
    binding_source_ref: "fixture:verified-binding",
  };
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "wasurezu-codex-hook-install-"));
  try {
    const runtimeRoot = join(root, "runtime with spaces");
    const workspace = join(root, "workspace");
    await mkdir(join(runtimeRoot, "dist"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(runtimeRoot, "dist", "codex-session-start.js"), "#!/usr/bin/env node\n");
    const hooksFile = join(workspace, CODEX_HOOK_CONFIG_RELATIVE_PATH);

    const absent = await installCodexSessionStartHook(options(workspace, runtimeRoot, "check"));
    assert.equal(absent.placement_status, "absent");
    assert.equal(absent.config_match, "absent");
    assert.equal(absent.would_change, true);
    assert.equal(absent.wrote_hooks_file, false);
    assert.equal(await exists(hooksFile), false);
    assert.equal(absent.next_action, "install");

    const dryRun = await installCodexSessionStartHook(options(workspace, runtimeRoot, "dry-run"));
    assert.equal(dryRun.wrote_hooks_file, false);
    assert.equal(await exists(hooksFile), false);

    const applied = await installCodexSessionStartHook(options(workspace, runtimeRoot, "apply"));
    assert.equal(applied.placement_status, "placed_not_delivered");
    assert.equal(applied.config_match, "exact");
    assert.equal(applied.wrote_hooks_file, true);
    assert.equal(applied.backup_file, null);
    assert.equal(applied.trust_verified, false);
    assert.equal(applied.first_context_delivered, false);
    assert.equal(applied.next_action, "review_and_trust_with_codex_hooks_ui");
    assert.equal((await stat(hooksFile)).mode & 0o777, 0o600);

    const parsed = parseHooksFile(await readFile(hooksFile, "utf8"));
    const groups = parsed.hooks.SessionStart ?? [];
    assert.equal(groups.length, 1);
    assert.equal(groups[0].matcher, CODEX_HOOK_MATCHER);
    assert.equal(groups[0].hooks.length, 1);
    assert.equal(groups[0].hooks[0].type, "command");
    assert.equal(groups[0].hooks[0].timeout, CODEX_SESSION_START_HOOK_TIMEOUT_SECONDS);
    assert.equal(typeof groups[0].hooks[0].statusMessage, "string");
    const command = String(groups[0].hooks[0].command);
    assert(command.includes(CODEX_SESSION_START_ADAPTER_ID));
    assert(command.includes("--agent-id 'kusabi'"));
    assert(command.includes("--project 'agent-memory'"));
    assert(command.includes("runtime with spaces"));
    assert(!command.includes("start-with-memory.sh"));

    const exactCheck = await installCodexSessionStartHook(options(workspace, runtimeRoot, "check"));
    assert.equal(exactCheck.config_match, "exact");
    assert.equal(exactCheck.would_change, false);
    assert.equal(exactCheck.wrote_hooks_file, false);

    const idempotentApply = await installCodexSessionStartHook(options(workspace, runtimeRoot, "apply"));
    assert.equal(idempotentApply.config_match, "exact");
    assert.equal(idempotentApply.wrote_hooks_file, false);
    assert.equal(idempotentApply.backup_file, null);

    const preservationWorkspace = join(root, "preservation-workspace");
    await mkdir(join(preservationWorkspace, ".codex"), { recursive: true });
    const preservationHooks = join(preservationWorkspace, CODEX_HOOK_CONFIG_RELATIVE_PATH);
    const original = {
      description: "Keep this description.",
      customTopLevel: { keep: true },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }],
        SessionStart: [{
          matcher: "startup",
          customGroupField: { keep: true },
          hooks: [{ type: "command", command: "echo unrelated", customHandlerField: "keep" }],
        }],
      },
    };
    await writeFile(preservationHooks, `${JSON.stringify(original, null, 2)}\n`);
    const preserved = await installCodexSessionStartHook(options(preservationWorkspace, runtimeRoot, "apply"));
    assert.equal(preserved.wrote_hooks_file, true);
    assert(preserved.backup_file);
    assert.equal(await readFile(preserved.backup_file!, "utf8"), `${JSON.stringify(original, null, 2)}\n`);
    const after = JSON.parse(await readFile(preservationHooks, "utf8"));
    assert.deepEqual(after.customTopLevel, { keep: true });
    assert.equal(after.description, "Keep this description.");
    assert.equal(after.hooks.PreToolUse[0].hooks[0].command, "echo pre");
    assert(after.hooks.SessionStart.some((group: { hooks: Array<{ command: string }> }) =>
      group.hooks.some((handler) => handler.command === "echo unrelated")
    ));
    const unrelatedGroup = after.hooks.SessionStart.find((group: { hooks: Array<{ command: string }> }) =>
      group.hooks.some((handler) => handler.command === "echo unrelated")
    );
    assert.deepEqual(unrelatedGroup.customGroupField, { keep: true });
    assert.equal(unrelatedGroup.hooks[0].customHandlerField, "keep");
    assert(after.hooks.SessionStart.some((group: { hooks: Array<{ command: string }> }) =>
      group.hooks.some((handler) => handler.command.includes(CODEX_SESSION_START_ADAPTER_ID))
    ));

    const changedBinding = options(preservationWorkspace, runtimeRoot, "apply");
    changedBinding.project = "agent-memory-v2";
    const replaced = await installCodexSessionStartHook(changedBinding);
    assert.equal(replaced.wrote_hooks_file, true);
    const replacedConfig = JSON.parse(await readFile(preservationHooks, "utf8"));
    const managedCommands = replacedConfig.hooks.SessionStart
      .flatMap((group: { hooks: Array<{ command: string }> }) => group.hooks)
      .map((handler: { command: string }) => handler.command)
      .filter((value: string) => value.includes(CODEX_SESSION_START_ADAPTER_ID));
    assert.equal(managedCommands.length, 1);
    assert(managedCommands[0].includes("--project 'agent-memory-v2'"));

    const invalidWorkspace = join(root, "invalid-workspace");
    await mkdir(join(invalidWorkspace, ".codex"), { recursive: true });
    const invalidHooks = join(invalidWorkspace, CODEX_HOOK_CONFIG_RELATIVE_PATH);
    await writeFile(invalidHooks, "{not-json\n");
    await assert.rejects(
      installCodexSessionStartHook(options(invalidWorkspace, runtimeRoot, "apply")),
      /not valid JSON/,
    );
    assert.equal(await readFile(invalidHooks, "utf8"), "{not-json\n");

    const symlinkWorkspace = join(root, "symlink-workspace");
    const externalCodexDir = join(root, "external-codex");
    await mkdir(symlinkWorkspace, { recursive: true });
    await mkdir(externalCodexDir, { recursive: true });
    await symlink(externalCodexDir, join(symlinkWorkspace, ".codex"));
    await assert.rejects(
      installCodexSessionStartHook(options(symlinkWorkspace, runtimeRoot, "apply")),
      /refusing symlink path/,
    );
    assert.equal(await exists(join(externalCodexDir, "hooks.json")), false);

    const symlinkFileWorkspace = join(root, "symlink-file-workspace");
    const externalHooks = join(root, "external-hooks.json");
    await mkdir(join(symlinkFileWorkspace, ".codex"), { recursive: true });
    await writeFile(externalHooks, '{"hooks":{}}\n');
    await symlink(externalHooks, join(symlinkFileWorkspace, CODEX_HOOK_CONFIG_RELATIVE_PATH));
    await assert.rejects(
      installCodexSessionStartHook(options(symlinkFileWorkspace, runtimeRoot, "apply")),
      /refusing symlink path/,
    );
    assert.equal(await readFile(externalHooks, "utf8"), '{"hooks":{}}\n');

    const parsedArgs = parseCodexHookInstallArgs([
      "--dry-run",
      "--workspace", workspace,
      "--runtime-root", runtimeRoot,
      "--agent-id", "kusabi",
      "--project", "agent-memory",
      "--binding-source-ref", "fixture:binding",
      "--max-tokens", "1200",
      "--max-bytes", "4096",
      "--timeout-ms", "6000",
    ]);
    assert.equal(parsedArgs.mode, "dry-run");
    assert.equal(parsedArgs.max_tokens, 1200);
    assert.equal(parsedArgs.max_bytes, 4096);
    assert.equal(parsedArgs.timeout_ms, 6000);

    const quotedCommand = buildCodexHookCommand(runtimeRoot, {
      agent_id: "agent'quote",
      project: "project",
      workspace,
      binding_source_ref: "fixture:quote",
      max_tokens: 1200,
      max_bytes: 4096,
      timeout_ms: 6000,
    } satisfies CodexSessionStartBinding);
    assert(quotedCommand.includes("'agent'\"'\"'quote'"));

    console.log("codex native hook installer tests passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
