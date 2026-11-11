/**
 * FR10.7: the one check of the `--node-path` value of the hook installers.
 * The accepted names are a small, explicit set: an absolute, normalized path whose last
 * name is exactly `node`, that reaches an executable regular file (a symlink is allowed).
 */
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { assertHookNodePath, checkHookNodePath } from "./hook-node-path.js";

const root = mkdtempSync(join(tmpdir(), "wasurezu-node-path-"));

function main(): void {
  const realNode = join(root, "real", "node");
  mkdirSync(join(root, "real"));
  writeFileSync(realNode, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  chmodSync(realNode, 0o755);
  const link = (dir: string, name: string, target = realNode): string => {
    mkdirSync(join(root, dir), { recursive: true });
    const path = join(root, dir, name);
    symlinkSync(target, path);
    return path;
  };

  // Accepted: a regular executable file named node, and a symlink named node to it (also through a second symlink).
  assert.deepEqual(checkHookNodePath(realNode), { ok: true });
  assert.equal(assertHookNodePath(realNode), realNode, "the value is returned as given, not resolved");
  const viaLink = link("a", "node");
  assert.deepEqual(checkHookNodePath(viaLink), { ok: true });
  assert.equal(assertHookNodePath(viaLink), viaLink, "a symlink path is kept, so a version-independent path stays version-independent");
  const viaTwoLinks = link("b", "node", viaLink);
  assert.deepEqual(checkHookNodePath(viaTwoLinks), { ok: true });
  if (basename(process.execPath) === "node") {
    assert.deepEqual(checkHookNodePath(process.execPath), { ok: true }, "the node running this test is acceptable when it is named node");
  }
  // A spaced or quoted directory is a normal path.
  const spaced = link("with space's", "node");
  assert.deepEqual(checkHookNodePath(spaced), { ok: true });

  // Refused: the reason is named, and nothing is created.
  const reasons: Array<[string, unknown, string]> = [
    ["empty", "", "not_absolute"],
    ["bare name", "node", "not_absolute"],
    ["relative", "./bin/node", "not_absolute"],
    ["relative with parent", "../node", "not_absolute"],
    ["NUL inside", `${realNode}\0`, "contains_nul"],
    ["NUL before the name", `${join(root, "real")}\0/node`, "contains_nul"],
    ["parent segment", `${join(root, "real")}/../real/node`, "not_normalized"],
    ["dot segment", `${join(root, "real")}/./node`, "not_normalized"],
    ["double slash", `${join(root, "real")}//node`, "not_normalized"],
    ["trailing slash", `${realNode}/`, "not_normalized"],
    ["not a string", undefined, "not_absolute"],
    ["a number", 5, "not_absolute"],
    ["null", null, "not_absolute"],
    ["other name nodejs", link("c", "nodejs"), "basename_not_node"],
    ["other name node22", link("d", "node22"), "basename_not_node"],
    ["other name Node", link("e", "Node"), "basename_not_node"],
    ["other name node.exe", link("f", "node.exe"), "basename_not_node"],
    ["a file named by prefix", join(root, "real", "mynode"), "basename_not_node"],
    ["missing", join(root, "missing", "node"), "not_found"],
  ];
  for (const [label, value, reason] of reasons) {
    assert.deepEqual(checkHookNodePath(value), { ok: false, reason }, label);
    assert.throws(() => assertHookNodePath(value as string), (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /invalid node path/, label);
      assert.ok(error.message.includes(`(${reason})`), `${label}: ${error.message}`);
      return true;
    }, label);
  }

  // A dangling symlink named node is not found; a symlink loop is not found either.
  const dangling = link("g", "node", join(root, "gone"));
  assert.deepEqual(checkHookNodePath(dangling), { ok: false, reason: "not_found" });
  mkdirSync(join(root, "loop"));
  symlinkSync(join(root, "loop", "node"), join(root, "loop", "node"));
  assert.deepEqual(checkHookNodePath(join(root, "loop", "node")), { ok: false, reason: "not_found" });

  // A directory named node is not a regular file.
  mkdirSync(join(root, "dir", "node"), { recursive: true });
  assert.deepEqual(checkHookNodePath(join(root, "dir", "node")), { ok: false, reason: "not_file" });
  const dirLink = link("h", "node", join(root, "dir", "node"));
  assert.deepEqual(checkHookNodePath(dirLink), { ok: false, reason: "not_file" });

  // A file the running user cannot execute.
  mkdirSync(join(root, "noexec"));
  const noExec = join(root, "noexec", "node");
  writeFileSync(noExec, "#!/bin/sh\n", { mode: 0o644 });
  chmodSync(noExec, 0o644);
  assert.deepEqual(checkHookNodePath(noExec), { ok: false, reason: "not_executable" });
  assert.deepEqual(checkHookNodePath(link("i", "node", noExec)), { ok: false, reason: "not_executable" });

  // The error text never carries a NUL byte (it is escaped), so a log line stays one line.
  try {
    assertHookNodePath(`${realNode}\0evil`);
    assert.fail("must refuse");
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes("\0"), false);
    assert.equal(error.message.includes("\n"), false);
  }

  // Pure of the environment: the answer does not depend on PATH or the current directory.
  const savedPath = process.env.PATH;
  const savedCwd = process.cwd();
  try {
    process.env.PATH = "";
    process.chdir(root);
    assert.deepEqual(checkHookNodePath("node"), { ok: false, reason: "not_absolute" });
    assert.deepEqual(checkHookNodePath(realNode), { ok: true });
  } finally {
    process.chdir(savedCwd);
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
  }

  process.stdout.write("hook node path tests passed\n");
}

try {
  main();
} finally {
  rmSync(root, { recursive: true, force: true });
}
