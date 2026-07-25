import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GEMINI_HOOK_CONFIG_RELATIVE_PATH,
  GEMINI_HOOK_MATCHERS,
  buildGeminiHookCommand,
  installGeminiSessionStartHook,
  parseGeminiHookCommand,
  parseGeminiHookInstallArgs,
  parseGeminiSettings,
  type GeminiHookInstallOptions,
} from "./gemini-hook-installer.js";
import {
  GEMINI_SESSION_START_ADAPTER_ID,
  GEMINI_SESSION_START_HOOK_TIMEOUT_MS,
  type GeminiSessionStartBinding,
} from "./gemini-session-start.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function options(
  workspace: string,
  runtimeRoot: string,
  mode: GeminiHookInstallOptions["mode"],
): GeminiHookInstallOptions {
  return {
    mode,
    workspace,
    runtime_root: runtimeRoot,
    agent_id: "kusabi-gemini",
    project: "agent-memory",
    binding_source_ref: "fixture:verified-binding",
  };
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "wasurezu-gemini-hook-install-"));
  try {
    const runtimeRoot = join(root, "runtime with spaces");
    const workspace = join(root, "workspace");
    await mkdir(join(runtimeRoot, "dist"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(runtimeRoot, "dist", "gemini-session-start.js"), "#!/usr/bin/env node\n");
    const settingsFile = join(workspace, GEMINI_HOOK_CONFIG_RELATIVE_PATH);

    const absent = await installGeminiSessionStartHook(options(workspace, runtimeRoot, "check"));
    assert.equal(absent.placement_status, "absent");
    assert.equal(absent.config_match, "absent");
    assert.equal(absent.would_change, true);
    assert.equal(absent.wrote_settings_file, false);
    assert.equal(await exists(settingsFile), false);
    assert.equal(absent.next_action, "install");

    const dryRun = await installGeminiSessionStartHook(options(workspace, runtimeRoot, "dry-run"));
    assert.equal(dryRun.wrote_settings_file, false);
    assert.equal(await exists(settingsFile), false);

    const applied = await installGeminiSessionStartHook(options(workspace, runtimeRoot, "apply"));
    assert.equal(applied.placement_status, "placed_not_delivered");
    assert.equal(applied.config_match, "exact");
    assert.equal(applied.wrote_settings_file, true);
    assert.equal(applied.backup_file, null);
    assert.equal(applied.trust_verified, false);
    assert.equal(applied.first_context_delivered, false);
    assert.equal(applied.changed_hook_requires_operator_review, true);
    assert.equal(applied.next_action, "review_and_trust_with_gemini_hooks_ui");
    assert.equal((await stat(settingsFile)).mode & 0o777, 0o600);

    const parsed = parseGeminiSettings(await readFile(settingsFile, "utf8"));
    const groups = parsed.hooks.SessionStart ?? [];
    assert.equal(groups.length, 3);
    assert.deepEqual(groups.map((group) => group.matcher), [...GEMINI_HOOK_MATCHERS]);
    for (const group of groups) {
      assert.equal(group.sequential, true);
      assert.equal(group.hooks.length, 1);
      assert.equal(group.hooks[0].type, "command");
      assert.equal(group.hooks[0].timeout, GEMINI_SESSION_START_HOOK_TIMEOUT_MS);
      assert.equal(group.hooks[0].name, GEMINI_SESSION_START_ADAPTER_ID);
      const command = String(group.hooks[0].command);
      assert(command.includes("--agent-id 'kusabi-gemini'"));
      assert(command.includes("--project 'agent-memory'"));
      assert(command.includes("runtime with spaces"));
      const parsedCommand = parseGeminiHookCommand(command);
      assert(parsedCommand);
      assert.equal(parsedCommand.node_executable, process.execPath);
      assert.equal(parsedCommand.runner, join(await realpath(runtimeRoot), "dist", "gemini-session-start.js"));
      assert.equal(parsedCommand.binding.agent_id, "kusabi-gemini");
      assert.equal(parseGeminiHookCommand(command.replace(process.execPath, "/bin/false")), null);
      assert.equal(parseGeminiHookCommand(`${command} ; touch /tmp/forbidden`), null);
    }

    const exactCheck = await installGeminiSessionStartHook(options(workspace, runtimeRoot, "check"));
    assert.equal(exactCheck.config_match, "exact");
    assert.equal(exactCheck.would_change, false);
    assert.equal(exactCheck.wrote_settings_file, false);

    const idempotent = await installGeminiSessionStartHook(options(workspace, runtimeRoot, "apply"));
    assert.equal(idempotent.config_match, "exact");
    assert.equal(idempotent.wrote_settings_file, false);
    assert.equal(idempotent.backup_file, null);

    const preservationWorkspace = join(root, "preservation-workspace");
    await mkdir(join(preservationWorkspace, ".gemini"), { recursive: true });
    const preservationFile = join(preservationWorkspace, GEMINI_HOOK_CONFIG_RELATIVE_PATH);
    const original = {
      customTopLevel: { keep: true },
      hooks: {
        BeforeTool: [{ matcher: "write_file", hooks: [{ type: "command", command: "echo pre" }] }],
        SessionStart: [{
          matcher: "startup",
          sequential: false,
          customGroupField: { keep: true },
          hooks: [{
            type: "command",
            name: "unrelated",
            command: "echo unrelated",
            customHandlerField: "keep",
          }],
        }],
      },
    };
    await writeFile(preservationFile, `${JSON.stringify(original, null, 2)}\n`);
    const preserved = await installGeminiSessionStartHook(options(preservationWorkspace, runtimeRoot, "apply"));
    assert.equal(preserved.wrote_settings_file, true);
    assert(preserved.backup_file);
    assert.equal(await readFile(preserved.backup_file!, "utf8"), `${JSON.stringify(original, null, 2)}\n`);
    const after = JSON.parse(await readFile(preservationFile, "utf8"));
    assert.deepEqual(after.customTopLevel, { keep: true });
    assert.equal(after.hooks.BeforeTool[0].hooks[0].command, "echo pre");
    const unrelatedGroup = after.hooks.SessionStart.find((group: { hooks: Array<{ name?: string }> }) =>
      group.hooks.some((handler) => handler.name === "unrelated")
    );
    assert.deepEqual(unrelatedGroup.customGroupField, { keep: true });
    assert.equal(unrelatedGroup.hooks[0].customHandlerField, "keep");
    assert.equal(
      after.hooks.SessionStart.flatMap((group: { hooks: Array<{ name?: string }> }) => group.hooks)
        .filter((handler: { name?: string }) => handler.name === GEMINI_SESSION_START_ADAPTER_ID).length,
      3,
    );

    const changedBinding = options(preservationWorkspace, runtimeRoot, "apply");
    changedBinding.project = "agent-memory-v2";
    const replaced = await installGeminiSessionStartHook(changedBinding);
    assert.equal(replaced.wrote_settings_file, true);
    const replacedConfig = JSON.parse(await readFile(preservationFile, "utf8"));
    const managedCommands = replacedConfig.hooks.SessionStart
      .flatMap((group: { hooks: Array<{ name?: string; command: string }> }) => group.hooks)
      .filter((handler: { name?: string }) => handler.name === GEMINI_SESSION_START_ADAPTER_ID)
      .map((handler: { command: string }) => handler.command);
    assert.equal(managedCommands.length, 3);
    assert(managedCommands.every((command: string) => command.includes("--project 'agent-memory-v2'")));

    const invalidWorkspace = join(root, "invalid-workspace");
    await mkdir(join(invalidWorkspace, ".gemini"), { recursive: true });
    const invalidFile = join(invalidWorkspace, GEMINI_HOOK_CONFIG_RELATIVE_PATH);
    await writeFile(invalidFile, "{not-json\n");
    await assert.rejects(
      installGeminiSessionStartHook(options(invalidWorkspace, runtimeRoot, "apply")),
      /not valid JSON/,
    );
    assert.equal(await readFile(invalidFile, "utf8"), "{not-json\n");

    const symlinkWorkspace = join(root, "symlink-workspace");
    const externalGeminiDir = join(root, "external-gemini");
    await mkdir(symlinkWorkspace, { recursive: true });
    await mkdir(externalGeminiDir, { recursive: true });
    await symlink(externalGeminiDir, join(symlinkWorkspace, ".gemini"));
    await assert.rejects(
      installGeminiSessionStartHook(options(symlinkWorkspace, runtimeRoot, "apply")),
      /refusing symlink path/,
    );
    assert.equal(await exists(join(externalGeminiDir, "settings.json")), false);

    const symlinkFileWorkspace = join(root, "symlink-file-workspace");
    const externalSettings = join(root, "external-settings.json");
    await mkdir(join(symlinkFileWorkspace, ".gemini"), { recursive: true });
    await writeFile(externalSettings, '{"hooks":{}}\n');
    await symlink(externalSettings, join(symlinkFileWorkspace, GEMINI_HOOK_CONFIG_RELATIVE_PATH));
    await assert.rejects(
      installGeminiSessionStartHook(options(symlinkFileWorkspace, runtimeRoot, "apply")),
      /refusing symlink path/,
    );
    assert.equal(await readFile(externalSettings, "utf8"), '{"hooks":{}}\n');

    const parsedArgs = parseGeminiHookInstallArgs([
      "--dry-run",
      "--workspace", workspace,
      "--runtime-root", runtimeRoot,
      "--agent-id", "kusabi-gemini",
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

    const quoted = buildGeminiHookCommand(runtimeRoot, {
      agent_id: "agent'quote",
      project: "project",
      workspace,
      binding_source_ref: "fixture:quote",
      max_tokens: 1200,
      max_bytes: 4096,
      timeout_ms: 6000,
    } satisfies GeminiSessionStartBinding);
    assert(quoted.includes("'agent'\"'\"'quote'"));
    assert.equal(parseGeminiHookCommand(quoted)?.binding.agent_id, "agent'quote");

    console.log("gemini native hook installer tests passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
