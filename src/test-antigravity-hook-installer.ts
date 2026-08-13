import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ANTIGRAVITY_HOOK_CONFIG_RELATIVE_PATH,
  ANTIGRAVITY_HOOK_NAMESPACE,
  installAntigravityHooks,
  parseAntigravityHookCommand,
  type AntigravityHookInstallOptions,
} from "./antigravity-hook-installer.js";

function options(workspace: string, runtimeRoot: string, mode: AntigravityHookInstallOptions["mode"]): AntigravityHookInstallOptions {
  return { mode, workspace, runtime_root: runtimeRoot, agent_id: "kusabi", project: "agent-memory", binding_source_ref: "fixture:antigravity" };
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "antigravity-installer-"));
  try {
    const workspace = join(root, "workspace");
    const runtimeRoot = join(root, "runtime with spaces");
    await Promise.all([mkdir(join(workspace, ".agents"), { recursive: true }), mkdir(join(runtimeRoot, "dist"), { recursive: true })]);
    await writeFile(join(runtimeRoot, "dist", "antigravity-session-start.js"), "#!/usr/bin/env node\n");
    const hooksFile = join(workspace, ANTIGRAVITY_HOOK_CONFIG_RELATIVE_PATH);
    const original = {
      "unrelated-linter": { enabled: false, PreInvocation: [{ type: "command", command: "./lint.sh", timeout: 10 }] },
      "unrelated-safety": { PreToolUse: [{ matcher: "run_command", hooks: [{ command: "./safe.sh" }] }] },
    };
    await writeFile(hooksFile, `${JSON.stringify(original, null, 2)}\n`, { mode: 0o640 });

    const dry = await installAntigravityHooks(options(workspace, runtimeRoot, "dry-run"));
    assert.equal(dry.config_match, "different");
    assert.equal(dry.wrote_hooks_file, false);
    assert.deepEqual(JSON.parse(await readFile(hooksFile, "utf8")), original);

    const applied = await installAntigravityHooks(options(workspace, runtimeRoot, "apply"));
    assert.equal(applied.config_match, "exact");
    assert.equal(applied.wrote_hooks_file, true);
    assert.equal(applied.unrelated_namespace_count_before, 2);
    assert.equal(applied.unrelated_namespace_count_after, 2);
    assert.match(applied.preimage_sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(applied.preimage_mode, "0640");
    assert.match(applied.postimage_sha256, /^[a-f0-9]{64}$/);
    assert.equal(applied.postimage_mode, "0600");
    assert.equal(applied.config_mutation_count, 1);
    assert.equal((await stat(hooksFile)).mode & 0o777, 0o600);
    const parsed = JSON.parse(await readFile(hooksFile, "utf8"));
    assert.deepEqual(parsed["unrelated-linter"], original["unrelated-linter"]);
    assert.deepEqual(parsed["unrelated-safety"], original["unrelated-safety"]);
    assert.deepEqual(Object.keys(parsed[ANTIGRAVITY_HOOK_NAMESPACE]).sort(), ["PostInvocation", "PreInvocation"]);
    for (const [surface, event] of [["PreInvocation", "pre-invocation"], ["PostInvocation", "post-invocation"]] as const) {
      const handlers = parsed[ANTIGRAVITY_HOOK_NAMESPACE][surface];
      assert.equal(handlers.length, 1);
      assert.equal(handlers[0].timeout, 9);
      const command = parseAntigravityHookCommand(handlers[0].command);
      assert(command);
      assert.equal(command.event, event);
      assert.equal(command.binding.agent_id, "kusabi");
      assert.equal(parseAntigravityHookCommand(`${handlers[0].command}; touch /tmp/no`), null);
    }

    const exact = await installAntigravityHooks(options(workspace, runtimeRoot, "check"));
    assert.equal(exact.config_match, "exact");
    assert.equal(exact.would_change, false);
    const idempotent = await installAntigravityHooks(options(workspace, runtimeRoot, "apply"));
    assert.equal(idempotent.wrote_hooks_file, false);
    assert.equal(idempotent.config_mutation_count, 0);
    await chmod(hooksFile, 0o644);
    const repairedMode = await installAntigravityHooks(options(workspace, runtimeRoot, "apply"));
    assert.equal(repairedMode.config_match, "exact");
    assert.equal(repairedMode.config_mutation_count, 1);
    assert.equal((await stat(hooksFile)).mode & 0o777, 0o600);

    const collisionWorkspace = join(root, "collision");
    await mkdir(join(collisionWorkspace, ".agents"), { recursive: true });
    const collisionFile = join(collisionWorkspace, ANTIGRAVITY_HOOK_CONFIG_RELATIVE_PATH);
    await writeFile(collisionFile, `${JSON.stringify({ [ANTIGRAVITY_HOOK_NAMESPACE]: { PreInvocation: [{ command: "echo unowned" }] } })}\n`);
    await assert.rejects(
      installAntigravityHooks(options(collisionWorkspace, runtimeRoot, "apply")),
      /unowned namespace collision/,
    );
    assert.match(await readFile(collisionFile, "utf8"), /echo unowned/);
    console.log("Antigravity namespace-preserving hook installer tests passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
