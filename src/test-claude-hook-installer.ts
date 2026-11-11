import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
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
import { CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID } from "./transcript-stop-capture.js";
import { CLAUDE_ROTATION_STOP_ADAPTER_ID } from "./session-rotation-stop.js";

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

const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;
type Handler = { command: string };
const handlersOf = (settings: ClaudeSettingsFile, event: string): string[] =>
  ((settings.hooks as Record<string, Array<{ hooks: Handler[] }> | undefined>)[event] ?? [])
    .flatMap((group) => group.hooks.map((handler) => handler.command));
const firstWord = (command: string): string => {
  assert.equal(command.startsWith("'"), true, `a quoted first word: ${command.slice(0, 40)}`);
  return command.slice(1, command.indexOf("' "));
};

/** FR10.7: the optional --node-path of the installer, its refusals, and the re-install of managed hooks. */
async function nodePathCases(root: string, runtimeRoot: string): Promise<void> {
  await writeFile(join(runtimeRoot, "dist", "session-rotation-stop.js"), "// fixture\n", "utf8");
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
  const withNode = (workspace: string, mode: "check" | "dry-run" | "apply", node_path?: string, rotation = true) => ({
    ...options(workspace, runtimeRoot, mode),
    ...(node_path === undefined ? {} : { node_path }),
    ...(rotation ? { rotation: { mode: "on" as const } } : {}),
  });
  const settingsOf = async (workspace: string): Promise<ClaudeSettingsFile> =>
    parseClaudeSettings(await readFile(join(workspace, ".claude", "settings.json"), "utf8"));
  const exists = async (path: string): Promise<boolean> => stat(path).then(() => true, () => false);
  const realRuntime = await realpath(runtimeRoot);
  const exact = binding(await workspaceOf("shape"));

  // The default is unchanged: the same bytes as the builder had before the option existed.
  const defaultCommand = buildClaudeHookCommand(realRuntime, exact);
  assert.equal(defaultCommand, [
    quote(process.execPath), quote(join(realRuntime, "dist", "claude-session-start.js")),
    "--adapter-id", quote(CLAUDE_SESSION_START_ADAPTER_ID),
    "--agent-id", quote(exact.agent_id), "--project", quote(exact.project),
    "--workspace", quote(exact.workspace), "--binding-source-ref", quote(exact.binding_source_ref),
    "--max-tokens", String(exact.max_tokens), "--max-bytes", String(exact.max_bytes), "--timeout-ms", String(exact.timeout_ms),
  ].join(" "));
  assert.equal(buildClaudeHookCommand(realRuntime, exact, process.execPath), defaultCommand);
  assert.equal(buildClaudeHookCommand(realRuntime, exact, "/x/node").startsWith("'/x/node' "), true);
  assert.deepEqual(parseClaudeHookInstallArgs(["--node-path", nodeA]), {
    mode: "check", workspace: "", runtime_root: "", agent_id: "", project: "", binding_source_ref: "", node_path: nodeA,
  });
  assert.throws(() => parseClaudeHookInstallArgs(["--node-path"]), /--node-path requires a value/);
  assert.equal("node_path" in parseClaudeHookInstallArgs([]), false, "no flag, no key");

  // Without the option every command starts with the node that runs the installer (all five, rotation on).
  const defaultWorkspace = await workspaceOf("default");
  await installClaudeSessionStartHook(withNode(defaultWorkspace, "apply"));
  const defaultSettings = await settingsOf(defaultWorkspace);
  const defaultAll = [...handlersOf(defaultSettings, "SessionStart"), ...handlersOf(defaultSettings, "Stop"), ...handlersOf(defaultSettings, "UserPromptSubmit")];
  assert.equal(defaultAll.length, 5);
  for (const command of defaultAll) assert.equal(firstWord(command), process.execPath);

  // With the option all five commands (SessionStart, the capture Stop and UserPromptSubmit, the rotation Stop and UserPromptSubmit) share it.
  const workspace = await workspaceOf("main");
  const dry = await installClaudeSessionStartHook(withNode(workspace, "dry-run", nodeA));
  assert.equal(dry.wrote_settings_file, false);
  assert.equal(await exists(join(workspace, ".claude", "settings.json")), false);
  const applied = await installClaudeSessionStartHook(withNode(workspace, "apply", nodeA));
  assert.equal(applied.config_match, "exact");
  const placed = await settingsOf(workspace);
  const allPlaced = ["SessionStart", "Stop", "UserPromptSubmit"].flatMap((event) => handlersOf(placed, event));
  assert.equal(allPlaced.length, 5);
  for (const command of allPlaced) assert.equal(firstWord(command), nodeA, "the path is kept as given, not resolved");
  assert.equal(handlersOf(placed, "Stop").filter((c) => c.includes(CLAUDE_ROTATION_STOP_ADAPTER_ID)).length, 1);
  assert.equal(handlersOf(placed, "UserPromptSubmit").filter((c) => c.includes(CLAUDE_ROTATION_STOP_ADAPTER_ID)).length, 1);
  assert.equal(handlersOf(placed, "Stop").filter((c) => c.includes(CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID)).length, 1);

  // (b) The same specification again changes nothing and is exact; the other node is "different".
  const before = await readFile(join(workspace, ".claude", "settings.json"), "utf8");
  const again = await installClaudeSessionStartHook(withNode(workspace, "apply", nodeA));
  assert.equal(again.wrote_settings_file, false);
  assert.equal(await readFile(join(workspace, ".claude", "settings.json"), "utf8"), before, "idempotent, byte for byte");
  assert.equal((await installClaudeSessionStartHook(withNode(workspace, "check", nodeA))).config_match, "exact");
  assert.equal((await installClaudeSessionStartHook(withNode(workspace, "check", nodeB))).config_match, "different");

  // (a) Installing again through another symlink leaves one managed hook of each kind, all with the new node.
  const reinstalled = await installClaudeSessionStartHook(withNode(workspace, "apply", nodeB));
  assert.equal(reinstalled.wrote_settings_file, true);
  assert.equal(reinstalled.unrelated_hook_handler_count_before, 0);
  assert.equal(reinstalled.unrelated_hook_handler_count_after, 0);
  const second = await settingsOf(workspace);
  const allSecond = ["SessionStart", "Stop", "UserPromptSubmit"].flatMap((event) => handlersOf(second, event));
  assert.equal(allSecond.length, 5, "no managed hook was added next to the old one");
  for (const command of allSecond) assert.equal(firstWord(command), nodeB);
  assert.equal(handlersOf(second, "SessionStart").length, 1);

  // Without the rotation option the rotation hook is not added, and the other commands still share the node.
  const noRotation = await workspaceOf("no-rotation");
  await installClaudeSessionStartHook(withNode(noRotation, "apply", nodeA, false));
  const noRotationSettings = await settingsOf(noRotation);
  assert.equal(handlersOf(noRotationSettings, "Stop").length, 1);
  assert.equal(firstWord(handlersOf(noRotationSettings, "Stop")[0]), nodeA);

  // (c) An old installer wrote the node it ran with; a different absolute path, whatever its name, is replaced.
  for (const [label, oldNode] of [["a versioned name", "/opt/old/bin/node20"], ["a removed path", "/gone/node"], ["another node", "/usr/local/bin/node"]] as const) {
    const oldWorkspace = await workspaceOf(`old-${label.replace(/\W/g, "")}`);
    await mkdir(join(oldWorkspace, ".claude"), { recursive: true });
    const oldBinding = binding(await realpath(oldWorkspace));
    const settings: ClaudeSettingsFile = {
      hooks: {
        SessionStart: [
          { matcher: "startup", hooks: [{ type: "command", command: "echo unrelated" }] },
          { matcher: CLAUDE_HOOK_MATCHER, hooks: [{ type: "command", command: buildClaudeHookCommand(realRuntime, oldBinding, oldNode) }] },
        ],
      },
    };
    await writeFile(join(oldWorkspace, ".claude", "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    const report = await installClaudeSessionStartHook(withNode(oldWorkspace, "apply", nodeA, false));
    assert.equal(report.unrelated_hook_handler_count_before, 1, `${label}: only the echo is unrelated`);
    const after = handlersOf(await settingsOf(oldWorkspace), "SessionStart");
    assert.equal(after.length, 2, label);
    assert.equal(after[0], "echo unrelated");
    assert.equal(firstWord(after[1]), nodeA);
  }

  // (d) A command that is not exactly ours stays where it is: a relative node, another adapter id, another flag order.
  const lookalikeWorkspace = await workspaceOf("lookalike");
  await mkdir(join(lookalikeWorkspace, ".claude"), { recursive: true });
  const lookBinding = binding(await realpath(lookalikeWorkspace));
  const canonical = buildClaudeHookCommand(realRuntime, lookBinding, nodeA);
  const lookalikes = [
    buildClaudeHookCommand(realRuntime, lookBinding, "node"),
    canonical.replace(CLAUDE_SESSION_START_ADAPTER_ID, "other-adapter-id"),
    canonical.replace(
      `--max-tokens ${lookBinding.max_tokens} --max-bytes ${lookBinding.max_bytes}`,
      `--max-bytes ${lookBinding.max_bytes} --max-tokens ${lookBinding.max_tokens}`,
    ),
  ];
  for (const command of lookalikes) assert.notEqual(command, canonical);
  await writeFile(join(lookalikeWorkspace, ".claude", "settings.json"), `${JSON.stringify({
    hooks: { SessionStart: lookalikes.map((command) => ({ matcher: "startup", hooks: [{ type: "command", command }] })) },
  }, null, 2)}\n`, "utf8");
  const kept = await installClaudeSessionStartHook(withNode(lookalikeWorkspace, "apply", nodeA, false));
  assert.equal(kept.unrelated_hook_handler_count_before, 3);
  assert.equal(kept.unrelated_hook_handler_count_after, 3);
  const keptCommands = handlersOf(await settingsOf(lookalikeWorkspace), "SessionStart");
  assert.equal(keptCommands.length, 4);
  for (const command of lookalikes) assert.equal(keptCommands.includes(command), true);

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
  await writeFile(noExec, "#!/bin/sh\n", "utf8");
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
    ["a parent segment", `${join(nodes, "A")}/../A/node`],
    ["an empty value", ""],
  ];
  for (const [label, value] of refused) {
    for (const mode of ["check", "dry-run", "apply"] as const) {
      for (const rotation of [false, true]) {
        await expectReject(
          () => installClaudeSessionStartHook(withNode(refuseWorkspace, mode, value, rotation)),
          /invalid node path/,
        );
      }
    }
    assert.equal(await exists(join(refuseWorkspace, ".claude")), false, `${label}: nothing was written`);
  }
  // A refusal does not touch an existing, valid configuration.
  const keepBefore = await readFile(join(workspace, ".claude", "settings.json"), "utf8");
  const folderBefore = (await readdir(join(workspace, ".claude"))).sort();
  await expectReject(() => installClaudeSessionStartHook(withNode(workspace, "apply", nodejsLink)), /invalid node path/);
  assert.equal(await readFile(join(workspace, ".claude", "settings.json"), "utf8"), keepBefore);
  assert.deepEqual((await readdir(workspace)).sort(), [".claude"]);
  assert.deepEqual((await readdir(join(workspace, ".claude"))).sort(), folderBefore,
    "a refused run leaves no backup or temporary file (the earlier successful re-install made its own backup)");

  // The reader that finds our own hook has a default that did not move (the rollout read-back and the recovery-target check rely on it).
  const foreignNode = "/opt/other/bin/node";
  const foreign = buildClaudeHookCommand(realRuntime, exact, foreignNode);
  assert.equal(parseClaudeHookCommand(foreign), null, "the default reader counts only the node that runs it");
  assert.equal(parseClaudeHookCommand(foreign, "current"), null);
  const any = parseClaudeHookCommand(foreign, "any");
  assert(any);
  assert.equal(any.node_executable, foreignNode);
  assert.deepEqual(any.binding, exact);
  assert.equal(any.runtime_root, realRuntime);
  const throughLink = buildClaudeHookCommand(realRuntime, exact, nodeA);
  assert.equal(parseClaudeHookCommand(throughLink), null, "a symlink to this node is a different first word");
  assert.equal(parseClaudeHookCommand(throughLink, "any")?.node_executable, nodeA);
  assert.deepEqual(parseClaudeHookCommand(defaultCommand), parseClaudeHookCommand(defaultCommand, "any"));
  assert.equal(parseClaudeHookCommand(defaultCommand)?.node_executable, process.execPath);
  // "any" widens only the first word: every other part of the shape is still required.
  assert.equal(parseClaudeHookCommand(buildClaudeHookCommand(realRuntime, exact, "node"), "any"), null, "a relative first word");
  assert.equal(parseClaudeHookCommand(`${foreign}; touch /tmp/nope`, "any"), null);
  assert.equal(parseClaudeHookCommand(foreign.replace(CLAUDE_SESSION_START_ADAPTER_ID, "other-adapter-id"), "any"), null);
  assert.equal(parseClaudeHookCommand(foreign.replace("--agent-id", "--agent"), "any"), null);
  assert.equal(parseClaudeHookCommand(foreign.replace(String(CLAUDE_SESSION_START_MAX_TOKENS), "999999"), "any"), null);
  assert.equal(parseClaudeHookCommand(foreign.replace(quote(foreignNode), foreignNode), "any"), null, "the same words written another way are not the command the installer writes");
  assert.equal(parseClaudeHookCommand(foreign.replace(" --adapter-id", "  --adapter-id"), "any"), null, "an extra space is not the command the installer writes");
  assert.equal(parseClaudeHookCommand(foreign.replace(quote(join(realRuntime, "dist", "claude-session-start.js")), quote(join(realRuntime, "dist", "elsewhere.js"))), "any"), null);
  assert.equal(parseClaudeHookCommand("", "any"), null);
  assert.equal(parseClaudeHookCommand("'/opt/other/bin/node'", "any"), null);

  // The command line: the option is read, a refusal exits 1 on standard error and writes nothing.
  const cli = spawnSync(process.execPath, [
    resolve(repositoryRoot, "dist", "claude-hook-installer.js"),
    "--dry-run", "--workspace", await workspaceOf("cli"), "--runtime-root", repositoryRoot,
    "--agent-id", "spec", "--project", "agent-memory", "--binding-source-ref", "owner-ref", "--node-path", nodeA,
  ], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).would_change, true);
  const cliRefused = spawnSync(process.execPath, [
    resolve(repositoryRoot, "dist", "claude-hook-installer.js"),
    "--dry-run", "--workspace", await workspaceOf("cli-refused"), "--runtime-root", repositoryRoot,
    "--agent-id", "spec", "--project", "agent-memory", "--binding-source-ref", "owner-ref", "--node-path", nodejsLink,
  ], { encoding: "utf8" });
  assert.equal(cliRefused.status, 1);
  assert.match(cliRefused.stderr, /\[claude-hook-installer\].*invalid node path/);
  assert.equal(cliRefused.stdout, "");
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "wasurezu-claude-installer-"));
  try {
    const runtimeRoot = join(root, "runtime root's");
    const workspace = join(root, "workspace root's");
    await mkdir(join(runtimeRoot, "dist"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(runtimeRoot, "dist", "claude-session-start.js"), "// fixture\n", "utf8");
    await writeFile(join(runtimeRoot, "dist", "transcript-stop-capture.js"), "// fixture\n", "utf8");

    const exactBinding = {
      ...binding(workspace),
      runtime_event_manifest_path: join(root, "immutable-plan", "fleet-manifest.json"),
    };
    const command = buildClaudeHookCommand(runtimeRoot, exactBinding);
    const parsed = parseClaudeHookCommand(command);
    assert(parsed, "canonical command must parse");
    assert.deepEqual(parsed.binding, exactBinding);
    assert.equal(parsed.runtime_root, runtimeRoot);
    assert.equal(parseClaudeHookCommand(`${command}; touch /tmp/nope`), null);
    assert.equal(parseClaudeHookCommand(command.replace("--agent-id", "--agent")), null);
    assert.equal(parseClaudeHookCommand(command.replace(String(CLAUDE_SESSION_START_MAX_TOKENS), "999999")), null);
    assert.equal(parseClaudeHookCommand(command.replace("--runtime-event-manifest", "--manifest")), null);

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
    assert.equal(createdSettings.hooks.Stop?.length, 1);
    assert.equal(
      (createdSettings.hooks.Stop?.[0]?.hooks[0]?.command as string).includes(CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID),
      true,
    );
    assert.equal(createdSettings.hooks.UserPromptSubmit?.length, 1);
    assert.equal(createdSettings.hooks.Stop?.[0]?.hooks[0]?.async, true);
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

    await nodePathCases(root, runtimeRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log("claude hook installer tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
