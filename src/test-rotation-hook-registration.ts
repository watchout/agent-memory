/**
 * Session rotation, registration and delivery (261110-session-rotation):
 * FR6.1 (new conversation receives the hand-off in front of the recovery text),
 * and the opt-in installer registration for both hosts (rollback = `--rotation off`).
 * Each unit has a correct case and error/edge cases.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRotationHookGroup,
  isRotationHandler,
  resolveRotationInstall,
  rotationGroupsFor,
  splitRotationHandlers,
  ROTATION_HOOK_STATUS_MESSAGE,
  type RotationHookGroup,
} from "./rotation-hook-registration.js";
import {
  CLAUDE_ROTATION_STOP_ADAPTER_ID,
  CODEX_ROTATION_STOP_ADAPTER_ID,
  ROTATION_STOP_HOOK_TIMEOUT_SECONDS,
} from "./session-rotation-stop.js";
import { installClaudeSessionStartHook, parseClaudeHookInstallArgs, parseClaudeSettings } from "./claude-hook-installer.js";
import { CODEX_HOOK_CONFIG_RELATIVE_PATH, installCodexSessionStartHook, parseCodexHookInstallArgs, parseHooksFile } from "./codex-hook-installer.js";
import { runClaudeSessionStart } from "./claude-session-start.js";
import { runCodexSessionStart, type LoadedCodexRecovery } from "./codex-session-start.js";
import { ROTATION_INITIAL_USER_MESSAGE, ROTATION_UNCERTAINTY_SENTENCE } from "./session-rotation-start.js";

const cases: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

const binding = {
  agent_id: "kusabi", project: "agent-memory", workspace: "/w'x", binding_source_ref: "ref",
  max_tokens: 1_800, max_bytes: 8_192, timeout_ms: 7_000,
};
const group = (command: string): RotationHookGroup => ({ matcher: "", hooks: [{ type: "command", command }] });

test("registration: the built command names the runner, adapter and binding; the threshold and manifest are optional", () => {
  const plain = buildRotationHookGroup({ runtime_root: "/rt", adapter_id: CLAUDE_ROTATION_STOP_ADAPTER_ID, binding });
  const handler = plain.hooks[0];
  assert.equal(handler.timeout, ROTATION_STOP_HOOK_TIMEOUT_SECONDS);
  assert.equal(handler.statusMessage, ROTATION_HOOK_STATUS_MESSAGE);
  assert.equal(handler.async, undefined, "the rotation hook is synchronous");
  const command = String(handler.command);
  assert.match(command, /\/rt\/dist\/session-rotation-stop\.js' --adapter-id 'wasurezu-claude-rotation-stop' --agent-id 'kusabi'/);
  assert.match(command, /--workspace '\/w'"'"'x'/, "single quotes in values are escaped");
  assert.doesNotMatch(command, /--rotation-threshold-tokens|--runtime-event-manifest/);
  const full = buildRotationHookGroup({
    runtime_root: "/rt", adapter_id: CODEX_ROTATION_STOP_ADAPTER_ID,
    binding: { ...binding, runtime_event_manifest_path: "/m.json" }, threshold_tokens: 250_000,
  });
  assert.match(String(full.hooks[0].command), /--runtime-event-manifest '\/m\.json' --rotation-threshold-tokens 250000$/);
});
test("registration: only a command of the exact built shape is ours; lookalikes and odd values are not", () => {
  const ours = String(buildRotationHookGroup({ runtime_root: "/rt", adapter_id: CLAUDE_ROTATION_STOP_ADAPTER_ID, binding }).hooks[0].command);
  assert.equal(isRotationHandler({ command: ours }, CLAUDE_ROTATION_STOP_ADAPTER_ID), true);
  assert.equal(isRotationHandler({ command: ours }, CODEX_ROTATION_STOP_ADAPTER_ID), false, "other host's adapter");
  for (const other of [{ command: `echo ${CLAUDE_ROTATION_STOP_ADAPTER_ID}` }, { command: 5 }, {}, null, "x", [ours], undefined]) {
    assert.equal(isRotationHandler(other, CLAUDE_ROTATION_STOP_ADAPTER_ID), false);
  }
});
test("registration: handlers are split inside a mixed group without touching the others", () => {
  const ours = String(buildRotationHookGroup({ runtime_root: "/rt", adapter_id: CLAUDE_ROTATION_STOP_ADAPTER_ID, binding }).hooks[0].command);
  const groups: RotationHookGroup[] = [
    { matcher: "", hooks: [{ type: "command", command: "echo mine" }, { type: "command", command: ours }] },
    group(ours),
    group("echo other"),
  ];
  const { rest, rotation } = splitRotationHandlers(groups, CLAUDE_ROTATION_STOP_ADAPTER_ID);
  assert.equal(rest.length, 2);
  assert.equal(rest[0].hooks.length, 1);
  assert.equal(rotation.length, 2);
  assert.deepEqual(splitRotationHandlers([], CLAUDE_ROTATION_STOP_ADAPTER_ID), { rest: [], rotation: [] });
});
test("registration: groups to place - keep what is there, a fresh one, or nothing", () => {
  const existing = [group("x")];
  const build = (threshold?: number) => group(`built:${threshold}`);
  assert.equal(rotationGroupsFor(existing, undefined, build), existing);
  assert.deepEqual(rotationGroupsFor(existing, { mode: "on" }, build), [group("built:undefined")]);
  assert.deepEqual(rotationGroupsFor(existing, { mode: "on", threshold_tokens: 9 }, build), [group("built:9")]);
  assert.deepEqual(rotationGroupsFor(existing, { mode: "off" }, build), []);
});
test("registration: flag combinations", () => {
  assert.equal(resolveRotationInstall(undefined, undefined), undefined);
  assert.deepEqual(resolveRotationInstall("on", undefined), { mode: "on" });
  assert.deepEqual(resolveRotationInstall(undefined, 5), { mode: "on", threshold_tokens: 5 });
  assert.deepEqual(resolveRotationInstall("on", 5), { mode: "on", threshold_tokens: 5 });
  assert.deepEqual(resolveRotationInstall("off", undefined), { mode: "off" });
  assert.throws(() => resolveRotationInstall("off", 5), /cannot take/);
  assert.throws(() => resolveRotationInstall("maybe", undefined), /must be on or off/);
});

const hasAdapter = (groups: Array<{ hooks: Array<Record<string, unknown>> }> | undefined, adapter: string): number =>
  (groups ?? []).flatMap((entry) => entry.hooks).filter((handler) => String(handler.command).includes(`--adapter-id '${adapter}'`)).length;

test("Claude installer: rotation is opt-in, preserved when not mentioned, replaced by a new threshold, removed by off", async () => {
  const root = await mkdtemp(join(tmpdir(), "rot-install-claude-"));
  const runtime = join(root, "runtime");
  const workspace = join(root, "ws");
  await mkdir(join(runtime, "dist"), { recursive: true });
  await mkdir(workspace);
  for (const file of ["claude-session-start.js", "transcript-stop-capture.js"]) await writeFile(join(runtime, "dist", file), "//\n");
  const base = { workspace, runtime_root: runtime, agent_id: "kusabi", project: "agent-memory", binding_source_ref: "ref" } as const;
  const read = async () => parseClaudeSettings(await readFile(join(workspace, ".claude", "settings.json"), "utf8"));

  const plain = await installClaudeSessionStartHook({ ...base, mode: "apply" });
  assert.equal(hasAdapter((await read()).hooks.Stop, CLAUDE_ROTATION_STOP_ADAPTER_ID), 0, "off by default");
  await assert.rejects(() => installClaudeSessionStartHook({ ...base, mode: "apply", rotation: { mode: "on" } }), /ENOENT/, "missing runner");
  assert.equal(plain.config_match, "exact");
  await mkdir(join(runtime, "dist", "session-rotation-stop.js"));
  await assert.rejects(() => installClaudeSessionStartHook({ ...base, mode: "apply", rotation: { mode: "on" } }), /invalid hook runner/, "runner is a folder");
  await rm(join(runtime, "dist", "session-rotation-stop.js"), { recursive: true });
  await writeFile(join(runtime, "dist", "session-rotation-stop.js"), "//\n");
  const on = await installClaudeSessionStartHook({ ...base, mode: "apply", rotation: { mode: "on", threshold_tokens: 250_000 } });
  assert.equal(on.config_match, "exact");
  let settings = await read();
  for (const event of [settings.hooks.Stop, settings.hooks.UserPromptSubmit]) {
    assert.equal(hasAdapter(event, CLAUDE_ROTATION_STOP_ADAPTER_ID), 1);
    const last = event![event!.length - 1].hooks[0];
    assert.match(String(last.command), /--rotation-threshold-tokens 250000$/);
    assert.equal(last.async, undefined);
    assert.ok(event!.length >= 2, "the async capture handler stays");
  }
  const kept = await installClaudeSessionStartHook({ ...base, mode: "check" });
  assert.equal(kept.would_change, false, "not mentioning rotation keeps the registered handler");
  const changed = await installClaudeSessionStartHook({ ...base, mode: "apply", rotation: { mode: "on", threshold_tokens: 200_000 } });
  assert.equal(changed.wrote_settings_file, true);
  settings = await read();
  assert.equal(hasAdapter(settings.hooks.Stop, CLAUDE_ROTATION_STOP_ADAPTER_ID), 1, "replaced, not duplicated");
  assert.match(JSON.stringify(settings.hooks.Stop), /--rotation-threshold-tokens 200000/);
  const checkOff = await installClaudeSessionStartHook({ ...base, mode: "check", rotation: { mode: "off" } });
  assert.equal(checkOff.would_change, true);
  await installClaudeSessionStartHook({ ...base, mode: "apply", rotation: { mode: "off" } });
  settings = await read();
  assert.equal(hasAdapter(settings.hooks.Stop, CLAUDE_ROTATION_STOP_ADAPTER_ID), 0);
  assert.equal(hasAdapter(settings.hooks.UserPromptSubmit, CLAUDE_ROTATION_STOP_ADAPTER_ID), 0);
  assert.ok((settings.hooks.Stop?.length ?? 0) >= 1, "the capture handler survives the rollback");
  await installClaudeSessionStartHook({ ...base, mode: "apply", rotation: { mode: "on" } });
  settings = await read();
  assert.equal(hasAdapter(settings.hooks.Stop, CLAUDE_ROTATION_STOP_ADAPTER_ID), 1, "turned on again after the rollback");
  assert.doesNotMatch(JSON.stringify(settings.hooks.Stop), /--rotation-threshold-tokens/, "no threshold given: the default applies, nothing is written");
});

test("Codex installer: same opt-in behaviour on the hooks file", async () => {
  const root = await mkdtemp(join(tmpdir(), "rot-install-codex-"));
  const runtime = join(root, "runtime");
  const workspace = join(root, "ws");
  await mkdir(join(runtime, "dist"), { recursive: true });
  await mkdir(workspace);
  for (const file of ["codex-session-start.js", "transcript-stop-capture.js"]) await writeFile(join(runtime, "dist", file), "//\n");
  const base = { workspace, runtime_root: runtime, agent_id: "kusabi-codex", project: "agent-memory", binding_source_ref: "ref" } as const;
  const read = async () => parseHooksFile(await readFile(join(workspace, CODEX_HOOK_CONFIG_RELATIVE_PATH), "utf8"));
  await installCodexSessionStartHook({ ...base, mode: "apply" });
  await assert.rejects(() => installCodexSessionStartHook({ ...base, mode: "apply", rotation: { mode: "on" } }), /ENOENT/);
  await mkdir(join(runtime, "dist", "session-rotation-stop.js"));
  await assert.rejects(() => installCodexSessionStartHook({ ...base, mode: "apply", rotation: { mode: "on" } }), /invalid hook runner/, "runner is a folder");
  await rm(join(runtime, "dist", "session-rotation-stop.js"), { recursive: true });
  await writeFile(join(runtime, "dist", "session-rotation-stop.js"), "//\n");
  await installCodexSessionStartHook({ ...base, mode: "apply", rotation: { mode: "on" } });
  let hooks = await read();
  assert.equal(hasAdapter(hooks.hooks.Stop, CODEX_ROTATION_STOP_ADAPTER_ID), 1);
  assert.equal(hasAdapter(hooks.hooks.UserPromptSubmit, CODEX_ROTATION_STOP_ADAPTER_ID), 1);
  assert.doesNotMatch(JSON.stringify(hooks.hooks.Stop), /--rotation-threshold-tokens/);
  await installCodexSessionStartHook({ ...base, mode: "apply", rotation: { mode: "on", threshold_tokens: 250_000 } });
  hooks = await read();
  assert.equal(hasAdapter(hooks.hooks.Stop, CODEX_ROTATION_STOP_ADAPTER_ID), 1, "replaced, not duplicated");
  assert.match(JSON.stringify(hooks.hooks.Stop), /--rotation-threshold-tokens 250000/);
  assert.equal((await installCodexSessionStartHook({ ...base, mode: "check" })).would_change, false);
  await installCodexSessionStartHook({ ...base, mode: "apply", rotation: { mode: "off" } });
  hooks = await read();
  assert.equal(hasAdapter(hooks.hooks.Stop, CODEX_ROTATION_STOP_ADAPTER_ID), 0);
  assert.ok((hooks.hooks.Stop?.length ?? 0) >= 1);
});

test("installer arguments: --rotation and --rotation-threshold-tokens, with the same checks on both hosts", () => {
  const common = ["--workspace", "/w", "--runtime-root", "/r", "--agent-id", "a", "--project", "p", "--binding-source-ref", "ref"];
  for (const parse of [parseClaudeHookInstallArgs, parseCodexHookInstallArgs]) {
    assert.equal(parse(common).rotation, undefined);
    assert.deepEqual(parse([...common, "--rotation", "on", "--rotation-threshold-tokens", "1000"]).rotation, { mode: "on", threshold_tokens: 1000 });
    assert.deepEqual(parse([...common, "--rotation", "off"]).rotation, { mode: "off" });
    assert.throws(() => parse([...common, "--rotation", "off", "--rotation-threshold-tokens", "1"]));
    assert.throws(() => parse([...common, "--rotation-threshold-tokens", "0"]), /positive integer/);
    assert.throws(() => parse([...common, "--rotation", "sometimes"]));
    assert.throws(() => parse([...common, "--rotation-wat", "1"]), /unknown argument/);
    assert.throws(() => parse([...common, "--rotation-threshold-tokens"]), /requires a value/);
  }
});

// ---- FR6.1: delivery of the hand-off in front of the recovery text ----
const ordinary = "ORDINARY RECOVERY TEXT";
function loaded(rotation?: LoadedCodexRecovery["rotation"]): LoadedCodexRecovery {
  return {
    recovery: { text: ordinary, token_cap: 1_800, token_estimate: 6, byte_count: ordinary.length, redaction_count: 0, redaction_version: "v", truncation_count: 0, omitted_section_count: 0 },
    recovery_pack: { pack_ref: "restart_pack:x", schema_ref: "wasurezu-recovery-pack/v1", token_budget: 1_650, confidence: "high", missing_context: [], source_refs: [], policy_version: "p" },
    recovery_quality_log_ref: "recovery_quality_log:123e4567-e89b-42d3-a456-426614174000",
    ...(rotation ? { rotation } : {}),
  };
}
const block = { text: "ROTATION HANDOFF BLOCK", initial_user_message: ROTATION_INITIAL_USER_MESSAGE, marker_id: "m1" };
test("FR6.1 Claude: the hand-off block leads, the first user message is set, ordinary starts are unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "rot-deliver-"));
  const input = JSON.stringify({ session_id: "s", transcript_path: join(root, "t.jsonl"), cwd: root, hook_event_name: "SessionStart", model: "m", source: "startup" });
  const claudeBinding = { ...binding, workspace: root, timeout_ms: 500 };
  const withBlock = await runClaudeSessionStart(input, claudeBinding, { loadRecovery: async () => loaded(block) });
  const context = withBlock.output.hookSpecificOutput?.additionalContext ?? "";
  assert.ok(context.startsWith("ROTATION HANDOFF BLOCK"));
  assert.ok(context.endsWith(ordinary));
  assert.equal(withBlock.output.hookSpecificOutput?.initialUserMessage, ROTATION_INITIAL_USER_MESSAGE);
  assert.equal(withBlock.rotation_evidence?.marker_id, "m1");
  const plain = await runClaudeSessionStart(input, claudeBinding, { loadRecovery: async () => loaded() });
  assert.equal(plain.output.hookSpecificOutput?.additionalContext, ordinary);
  assert.equal(plain.output.hookSpecificOutput?.initialUserMessage, undefined);
  assert.equal(plain.rotation_evidence, undefined);
});
test("FR6.1 Codex: the same block leads; no first-message field is added", async () => {
  const root = await mkdtemp(join(tmpdir(), "rot-deliver-"));
  const input = JSON.stringify({ session_id: "s", transcript_path: join(root, "t.jsonl"), cwd: root, hook_event_name: "SessionStart", model: "m", permission_mode: "default", source: "startup" });
  const result = await runCodexSessionStart(input, { ...binding, workspace: root, timeout_ms: 500 }, { loadRecovery: async () => loaded(block) });
  const context = result.output.hookSpecificOutput?.additionalContext ?? "";
  assert.ok(context.startsWith("ROTATION HANDOFF BLOCK"));
  assert.ok(context.endsWith(ordinary));
  assert.equal("initialUserMessage" in (result.output.hookSpecificOutput ?? {}), false);
  assert.equal(result.rotation_evidence?.marker_id, "m1");
});

// ---- FR7.1 / audit F2: after a summary (compact) the fixed DB-lookup sentence leads, with or without a hand-off bundle ----
// "No bundle" and "bundle already taken" reach the runner the same way: prepareRotationRecovery returns null (no `rotation`).
const occurrences = (text: string, part: string): number => text.split(part).length - 1;
const startInput = (host: "claude_code" | "codex", root: string, source: string): string => JSON.stringify({
  session_id: "s", transcript_path: join(root, "t.jsonl"), cwd: root, hook_event_name: "SessionStart", model: "m", source,
  ...(host === "codex" ? { permission_mode: "default" } : {}),
});
const startOn = (host: "claude_code" | "codex", root: string, source: string, load: LoadedCodexRecovery) => {
  const b = { ...binding, workspace: root, timeout_ms: 500 };
  const dependencies = { loadRecovery: async () => load };
  return host === "codex"
    ? runCodexSessionStart(startInput(host, root, source), b, dependencies)
    : runClaudeSessionStart(startInput(host, root, source), b, dependencies);
};
test("FR7.1 compact: with no hand-off bundle both hosts still lead with the fixed sentence, once; the other starts are unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "rot-compact-"));
  for (const host of ["claude_code", "codex"] as const) {
    const compact = await startOn(host, root, "compact", loaded());
    const context = compact.output.hookSpecificOutput?.additionalContext ?? "";
    assert.ok(context.startsWith(ROTATION_UNCERTAINTY_SENTENCE), `${host}: the sentence leads`);
    assert.ok(context.endsWith(ordinary), `${host}: the ordinary recovery text follows`);
    assert.equal(occurrences(context, ROTATION_UNCERTAINTY_SENTENCE), 1);
    assert.equal(compact.rotation_evidence, undefined, "no bundle was used");
    for (const source of ["startup", "resume", "clear"]) {
      const plain = await startOn(host, root, source, loaded());
      assert.equal(plain.output.hookSpecificOutput?.additionalContext, ordinary, `${host}/${source}: unchanged`);
    }
    const withBundle = await startOn(host, root, "compact", loaded({ ...block, text: `ROTATION HANDOFF BLOCK\n${ROTATION_UNCERTAINTY_SENTENCE}` }));
    const bundled = withBundle.output.hookSpecificOutput?.additionalContext ?? "";
    assert.equal(occurrences(bundled, ROTATION_UNCERTAINTY_SENTENCE), 1, `${host}: not added twice when the bundle already carries it`);
    assert.ok(bundled.startsWith("ROTATION HANDOFF BLOCK"));
  }
});
test("FR7.1 compact: the sentence is kept and the ordinary recovery caps still hold when the recovery text is large", async () => {
  const root = await mkdtemp(join(tmpdir(), "rot-compact-cap-"));
  const text = "あ".repeat(20_000);
  const big = loaded();
  big.recovery = { ...big.recovery, text, token_estimate: Math.ceil(text.length / 4), byte_count: Buffer.byteLength(text, "utf8") };
  for (const host of ["claude_code", "codex"] as const) {
    const result = await startOn(host, root, "compact", big);
    const context = result.output.hookSpecificOutput?.additionalContext ?? "";
    assert.ok(context.startsWith(ROTATION_UNCERTAINTY_SENTENCE), host);
    assert.ok(Math.ceil(context.length / 4) <= binding.max_tokens, `${host}: ${Math.ceil(context.length / 4)} tokens`);
    assert.ok(Buffer.byteLength(context, "utf8") <= binding.max_bytes, `${host}: ${Buffer.byteLength(context, "utf8")} bytes`);
  }
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}\n${error instanceof Error ? error.stack : String(error)}`);
  }
}
if (failed > 0) {
  console.error(`FAIL test-rotation-hook-registration (${failed}/${cases.length})`);
  process.exit(1);
}
console.log(`PASS test-rotation-hook-registration (${cases.length} cases)`);
