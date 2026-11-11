import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  CODEX_HOOK_CONFIG_RELATIVE_PATH,
  CODEX_HOOK_MATCHER,
  buildCodexHookCommand,
  installCodexSessionStartHook,
  parseCodexHookCommand,
  parseCodexHookInstallArgs,
  parseHooksFile,
  type CodexHookInstallOptions,
} from "./codex-hook-installer.js";
import {
  CODEX_SESSION_START_ADAPTER_ID,
  CODEX_SESSION_START_HOOK_TIMEOUT_SECONDS,
  type CodexSessionStartBinding,
} from "./codex-session-start.js";
import { CODEX_TRANSCRIPT_STOP_ADAPTER_ID } from "./transcript-stop-capture.js";
import { CODEX_ROTATION_STOP_ADAPTER_ID } from "./session-rotation-stop.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;
type Handler = { command: string };
const handlersOf = (hooks: unknown, event: string): string[] =>
  (((hooks as { hooks: Record<string, Array<{ hooks: Handler[] }> | undefined> }).hooks)[event] ?? [])
    .flatMap((group) => group.hooks.map((handler) => handler.command));
const firstWord = (command: string): string => {
  assert.equal(command.startsWith("'"), true, `a quoted first word: ${command.slice(0, 40)}`);
  return command.slice(1, command.indexOf("' "));
};

/** FR10.7: the optional --node-path of the installer, its refusals, and the re-install of managed hooks. */
async function nodePathCases(root: string, runtimeRoot: string): Promise<void> {
  await writeFile(join(runtimeRoot, "dist", "session-rotation-stop.js"), "#!/usr/bin/env node\n");
  const nodes = join(root, "nodes");
  const linkTo = async (dir: string, name: string): Promise<string> => {
    await mkdir(join(nodes, dir), { recursive: true });
    const path = join(nodes, dir, name);
    await symlink(process.execPath, path);
    return path;
  };
  const nodeA = await linkTo("A", "node");
  const nodeB = await linkTo("B", "node");
  const workspaceOf = async (name: string): Promise<string> => {
    const path = join(root, `np-${name}`);
    await mkdir(path, { recursive: true });
    return path;
  };
  const withNode = (
    workspace: string,
    mode: CodexHookInstallOptions["mode"],
    node_path?: string,
    rotation = true,
  ): CodexHookInstallOptions => ({
    ...options(workspace, runtimeRoot, mode),
    ...(node_path === undefined ? {} : { node_path }),
    ...(rotation ? { rotation: { mode: "on" as const } } : {}),
  });
  const hooksOf = async (workspace: string): Promise<unknown> =>
    parseHooksFile(await readFile(join(workspace, CODEX_HOOK_CONFIG_RELATIVE_PATH), "utf8"));
  const all = (hooks: unknown): string[] => ["SessionStart", "Stop", "UserPromptSubmit"].flatMap((event) => handlersOf(hooks, event));
  const exists = async (path: string): Promise<boolean> => stat(path).then(() => true, () => false);
  const realRuntime = await realpath(runtimeRoot);
  const exactBinding: CodexSessionStartBinding = {
    agent_id: "kusabi", project: "agent-memory", workspace: await realpath(await workspaceOf("shape")),
    binding_source_ref: "fixture:verified-binding", max_tokens: 1200, max_bytes: 4096, timeout_ms: 6000,
  };

  // The default is unchanged: the same bytes as the builder had before the option existed.
  const defaultCommand = buildCodexHookCommand(realRuntime, exactBinding);
  assert.equal(defaultCommand, [
    quote(process.execPath), quote(join(realRuntime, "dist", "codex-session-start.js")),
    "--adapter-id", quote(CODEX_SESSION_START_ADAPTER_ID),
    "--agent-id", quote(exactBinding.agent_id), "--project", quote(exactBinding.project),
    "--workspace", quote(exactBinding.workspace), "--binding-source-ref", quote(exactBinding.binding_source_ref),
    "--max-tokens", "1200", "--max-bytes", "4096", "--timeout-ms", "6000",
  ].join(" "));
  assert.equal(buildCodexHookCommand(realRuntime, exactBinding, process.execPath), defaultCommand);
  assert.equal(buildCodexHookCommand(realRuntime, exactBinding, "/x/node").startsWith("'/x/node' "), true);
  assert.equal(parseCodexHookInstallArgs(["--node-path", nodeA]).node_path, nodeA);
  assert.equal("node_path" in parseCodexHookInstallArgs([]), false, "no flag, no key");
  assert.throws(() => parseCodexHookInstallArgs(["--node-path"]), /--node-path requires a value/);

  // Without the option every command starts with the node that runs the installer.
  const defaultWorkspace = await workspaceOf("default");
  await installCodexSessionStartHook(withNode(defaultWorkspace, "apply"));
  const defaultAll = all(await hooksOf(defaultWorkspace));
  assert.equal(defaultAll.length, 5);
  for (const command of defaultAll) assert.equal(firstWord(command), process.execPath);

  // With the option all five commands share it, kept as given.
  const workspace = await workspaceOf("main");
  const dry = await installCodexSessionStartHook(withNode(workspace, "dry-run", nodeA));
  assert.equal(dry.wrote_hooks_file, false);
  assert.equal(await exists(join(workspace, CODEX_HOOK_CONFIG_RELATIVE_PATH)), false);
  await installCodexSessionStartHook(withNode(workspace, "apply", nodeA));
  const placed = await hooksOf(workspace);
  assert.equal(all(placed).length, 5);
  for (const command of all(placed)) assert.equal(firstWord(command), nodeA);
  assert.equal(handlersOf(placed, "Stop").filter((c) => c.includes(CODEX_ROTATION_STOP_ADAPTER_ID)).length, 1);
  assert.equal(handlersOf(placed, "UserPromptSubmit").filter((c) => c.includes(CODEX_ROTATION_STOP_ADAPTER_ID)).length, 1);
  assert.equal(handlersOf(placed, "Stop").filter((c) => c.includes(CODEX_TRANSCRIPT_STOP_ADAPTER_ID)).length, 1);

  // The same specification again changes nothing; the other node is "different".
  const hooksPath = join(workspace, CODEX_HOOK_CONFIG_RELATIVE_PATH);
  const before = await readFile(hooksPath, "utf8");
  const again = await installCodexSessionStartHook(withNode(workspace, "apply", nodeA));
  assert.equal(again.wrote_hooks_file, false);
  assert.equal(await readFile(hooksPath, "utf8"), before, "idempotent, byte for byte");
  assert.equal((await installCodexSessionStartHook(withNode(workspace, "check", nodeA))).config_match, "exact");
  assert.equal((await installCodexSessionStartHook(withNode(workspace, "check", nodeB))).config_match, "different");

  // Installing again through another symlink leaves one managed hook of each kind, all with the new node.
  const reinstalled = await installCodexSessionStartHook(withNode(workspace, "apply", nodeB));
  assert.equal(reinstalled.wrote_hooks_file, true);
  const second = await hooksOf(workspace);
  assert.equal(all(second).length, 5, "no managed hook was added next to the old one");
  for (const command of all(second)) assert.equal(firstWord(command), nodeB);
  assert.equal(handlersOf(second, "SessionStart").length, 1);

  // An old installer wrote the node it ran with; a different absolute path is replaced and an unrelated handler stays.
  for (const [label, oldNode] of [["a versioned name", "/opt/old/bin/node20"], ["a removed path", "/gone/node"]] as const) {
    const oldWorkspace = await workspaceOf(`old-${label.replace(/\W/g, "")}`);
    await mkdir(join(oldWorkspace, ".codex"), { recursive: true });
    const oldBinding: CodexSessionStartBinding = { ...exactBinding, workspace: await realpath(oldWorkspace) };
    await writeFile(join(oldWorkspace, CODEX_HOOK_CONFIG_RELATIVE_PATH), `${JSON.stringify({
      hooks: {
        SessionStart: [
          { matcher: "startup", hooks: [{ type: "command", command: "echo unrelated" }] },
          { matcher: CODEX_HOOK_MATCHER, hooks: [{ type: "command", command: buildCodexHookCommand(realRuntime, oldBinding, oldNode) }] },
        ],
      },
    }, null, 2)}\n`);
    await installCodexSessionStartHook(withNode(oldWorkspace, "apply", nodeA, false));
    const after = handlersOf(await hooksOf(oldWorkspace), "SessionStart");
    assert.equal(after.length, 2, label);
    assert.equal(after[0], "echo unrelated");
    assert.equal(firstWord(after[1]), nodeA);
  }

  // The check is done before anything is read or written, in every mode, with or without rotation.
  const refuseWorkspace = await workspaceOf("refuse");
  await mkdir(join(nodes, "other"), { recursive: true });
  const nodejsLink = join(nodes, "other", "nodejs");
  const node22Link = join(nodes, "other", "node22");
  await symlink(process.execPath, nodejsLink);
  await symlink(process.execPath, node22Link);
  await mkdir(join(nodes, "dir", "node"), { recursive: true });
  const noExec = join(nodes, "noexec", "node");
  await mkdir(join(nodes, "noexec"), { recursive: true });
  await writeFile(noExec, "#!/bin/sh\n");
  await chmod(noExec, 0o644);
  const refused: Array<[string, string]> = [
    ["a missing path", join(nodes, "missing", "node")],
    ["a relative path", "node"],
    ["a relative path with a directory", "./nodes/A/node"],
    ["a directory", join(nodes, "dir", "node")],
    ["not executable", noExec],
    ["a NUL byte", `${nodeA}\0`],
    ["the name nodejs", nodejsLink],
    ["the name node22", node22Link],
    ["a parent segment", join(nodes, "A", "..", "A", "node")],
    ["an empty value", ""],
  ];
  for (const [label, value] of refused) {
    for (const mode of ["check", "dry-run", "apply"] as const) {
      for (const rotation of [false, true]) {
        await assert.rejects(installCodexSessionStartHook(withNode(refuseWorkspace, mode, value, rotation)), /invalid node path/);
      }
    }
    assert.equal(await exists(join(refuseWorkspace, ".codex")), false, `${label}: nothing was written`);
  }
  const keepBefore = await readFile(hooksPath, "utf8");
  await assert.rejects(installCodexSessionStartHook(withNode(workspace, "apply", nodejsLink)), /invalid node path/);
  assert.equal(await readFile(hooksPath, "utf8"), keepBefore);
  assert.deepEqual((await readdir(join(workspace, ".codex"))).sort(), ["hooks.json"], "a refused run leaves no backup or temporary file");

  // The readers of this command are not widened: another node's hook is not counted (the rollout and the recovery-target check fail safe).
  const foreign = buildCodexHookCommand(realRuntime, exactBinding, "/opt/other/bin/node");
  assert.equal(parseCodexHookCommand(foreign), null);
  assert.equal(parseCodexHookCommand(buildCodexHookCommand(realRuntime, exactBinding, nodeA)), null, "a symlink to this node is a different first word");
  assert.deepEqual(parseCodexHookCommand(defaultCommand)?.binding, exactBinding);

  // The command line: the option is read, a refusal exits 1 on standard error and writes nothing.
  const cli = spawnSync(process.execPath, [
    resolve(repositoryRoot, "dist", "codex-hook-installer.js"),
    "--dry-run", "--workspace", await workspaceOf("cli"), "--runtime-root", repositoryRoot,
    "--agent-id", "kusabi", "--project", "agent-memory", "--binding-source-ref", "fixture:binding", "--node-path", nodeA,
  ], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).would_change, true);
  const cliRefused = spawnSync(process.execPath, [
    resolve(repositoryRoot, "dist", "codex-hook-installer.js"),
    "--dry-run", "--workspace", await workspaceOf("cli-refused"), "--runtime-root", repositoryRoot,
    "--agent-id", "kusabi", "--project", "agent-memory", "--binding-source-ref", "fixture:binding", "--node-path", nodejsLink,
  ], { encoding: "utf8" });
  assert.equal(cliRefused.status, 1);
  assert.match(cliRefused.stderr, /\[codex-hook-installer\].*invalid node path/);
  assert.equal(cliRefused.stdout, "");
}

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
    await writeFile(join(runtimeRoot, "dist", "transcript-stop-capture.js"), "#!/usr/bin/env node\n");
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
    const parsedCommand = parseCodexHookCommand(command);
    assert(parsedCommand);
    assert.equal(parsedCommand.node_executable, process.execPath);
    assert.equal(parsedCommand.runner, join(await realpath(runtimeRoot), "dist", "codex-session-start.js"));
    assert.equal(parsedCommand.binding.agent_id, "kusabi");
    assert.equal(parseCodexHookCommand(command.replace(process.execPath, "/bin/false")), null);
    assert.equal(parseCodexHookCommand(`${command} ; touch /tmp/forbidden`), null);
    const stopGroups = parsed.hooks.Stop ?? [];
    assert.equal(stopGroups.length, 1);
    assert.equal(stopGroups[0].matcher, "");
    assert.equal(stopGroups[0].hooks.length, 1);
    assert(String(stopGroups[0].hooks[0].command).includes(CODEX_TRANSCRIPT_STOP_ADAPTER_ID));
    assert.equal(stopGroups[0].hooks[0].async, true);
    const promptGroups = parsed.hooks.UserPromptSubmit ?? [];
    assert.equal(promptGroups.length, 1);
    assert(String(promptGroups[0].hooks[0].command).includes(CODEX_TRANSCRIPT_STOP_ADAPTER_ID));

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
    assert(after.hooks.Stop.some((group: { hooks: Array<{ command: string }> }) =>
      group.hooks.some((handler) => handler.command.includes(CODEX_TRANSCRIPT_STOP_ADAPTER_ID))
    ));
    assert(after.hooks.UserPromptSubmit.some((group: { hooks: Array<{ command: string }> }) =>
      group.hooks.some((handler) => handler.command.includes(CODEX_TRANSCRIPT_STOP_ADAPTER_ID))
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
      runtime_event_manifest_path: join(root, "immutable-plan", "fleet-manifest.json"),
    } satisfies CodexSessionStartBinding);
    assert(quotedCommand.includes("'agent'\"'\"'quote'"));
    assert.equal(parseCodexHookCommand(quotedCommand)?.binding.agent_id, "agent'quote");
    assert.equal(
      parseCodexHookCommand(quotedCommand)?.binding.runtime_event_manifest_path,
      join(root, "immutable-plan", "fleet-manifest.json"),
    );
    assert.equal(parseCodexHookCommand(quotedCommand.replace("--runtime-event-manifest", "--manifest")), null);

    await nodePathCases(root, runtimeRoot);

    console.log("codex native hook installer tests passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
