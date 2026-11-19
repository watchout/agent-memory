/**
 * The host layer of the common-infrastructure form (u1-seat-memory-skeleton, PR-2, Step 11; DL-7, BR1.1, BR3.4, BR3.5,
 * BR6.1, S4, S5). The success scenario of Step 3 at the entries a seat really uses: a decision written through the
 * tool surface in the Codex form, then a NEW process starts a session in the Claude Code form and in the Codex form and
 * shows the same decision. The negative checks: a seat the database does not know and a stopped database leave nothing
 * written locally and nothing resent; the default loaders, `boot`, `claude-start`, `codex-start` and the MCP server,
 * run as the host runs them, answer from the common form and create no local store; the core modules do not read the
 * clock or make ids (the entry does). The window is a fake that keeps its rows in a file; the real driver is pointed at
 * a closed port where a program builds its own window. The real SQL is tried by test-common-seat-pg.ts (by hand).
 */
import { ISOLATED_HOME } from "./test-isolated-home.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadClaudeRecoveryFromStore, runClaudeSessionStart } from "./claude-session-start.js";
import { loadCodexRecoveryFromStore, runCodexSessionStart } from "./codex-session-start.js";
import { loadCommonRecovery } from "./common-recovery.js";
import { commonFormRefusal, decideEntry, refuseCommonForm } from "./common-entry.js";
import { createCommonSurface } from "./common-seat-surface.js";
import { COMMON_ENV, entryDeps, hookBinding, hookInput, runFile } from "./test-common-seat-entry-support.js";
import {
  DECISION_TEXT,
  FakeDb,
  SEAT_A,
  SEAT_UNREGISTERED,
  SYNTHETIC_URL,
  networkError,
  scratchFolder,
  settingFor,
  snapshotTree,
  writeConfig,
} from "./test-common-seat-support.js";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const here = fileURLToPath(import.meta.url);

/** What a child process does: one operation, one line of result. The first import gave it a throwaway home. */
async function child(op: string, stateFile: string, configPath: string): Promise<void> {
  const deps = entryDeps(new FakeDb({ stateFile }), configPath, "5");
  if (op === "codex-write") {
    const entry = decideEntry(COMMON_ENV, deps);
    assert.equal(entry.form, "common");
    const surface = createCommonSurface({ store: entry.store, now: entry.now, newId: entry.newId, record: async () => undefined });
    const reply = await surface.call("log_decision", { decision: DECISION_TEXT, context: "written by the Codex form", tags: ["scenario"] });
    console.log(`RESULT ${JSON.stringify({ isError: reply.isError ?? false })}`);
    return;
  }
  const loadRecovery = (binding: Parameters<typeof loadCommonRecovery>[0]) => loadCommonRecovery(binding, { ...deps, env: COMMON_ENV }).then((loaded) => loaded!);
  const claude = await runClaudeSessionStart(hookInput(ISOLATED_HOME, "claude"), hookBinding(ISOLATED_HOME), { loadRecovery });
  const codex = await runCodexSessionStart(hookInput(ISOLATED_HOME, "codex"), hookBinding(ISOLATED_HOME), { loadRecovery });
  console.log(`RESULT ${JSON.stringify({ claude: contextOf(claude), codex: contextOf(codex) })}`);
}

const contextOf = (run: { output: { systemMessage?: string; hookSpecificOutput?: { additionalContext: string } }; evidence: { outcome?: string } }) => ({
  context: run.output.hookSpecificOutput?.additionalContext ?? "",
  systemMessage: run.output.systemMessage ?? "",
  outcome: (run.evidence as { outcome?: string }).outcome ?? "",
});

if (process.argv[2] === "--child") {
  await child(process.argv[3], process.argv[4], process.argv[5]);
  process.exit(0);
}

function runChild(op: string, stateFile: string, configPath: string) {
  const run = runFile("./test-common-seat-host.ts", ["--child", op, stateFile, configPath], { HOME: ISOLATED_HOME });
  const found = run.lines.find((line) => line.startsWith("RESULT "));
  return { run, result: found ? (JSON.parse(found.slice(7)) as Record<string, any>) : undefined };
}

/** The decision lines of a context, parsed: the data between DATA BEGIN and DATA END. */
function decisionsIn(context: string): Array<Record<string, string | null>> {
  const lines = context.split("\n");
  return lines.slice(lines.indexOf("DATA BEGIN") + 1, lines.indexOf("DATA END")).map((line) => JSON.parse(line));
}

/** A home with the seat's setting, for the programs run as the host runs them. */
function homeWithSeat(dir: string): { home: string; before: string[] } {
  const home = join(dir, "home");
  writeConfig(join(home, ".agent-memory"), settingFor(SEAT_A));
  return { home, before: snapshotTree(home) };
}
const childEnv = (home: string): Record<string, string> => ({ HOME: home, AGENT_MEMORY_MODE: "common", AGENT_MEMORY_DATABASE_URL: SYNTHETIC_URL });

const cases: Array<[string, () => Promise<void> | void]> = [];

cases.push(["host scenario: a decision written in the Codex form is shown by a new process at the Claude Code and Codex session starts", () => {
  const scratch = scratchFolder();
  try {
    const stateFile = join(scratch.dir, "rows.json");
    const configPath = writeConfig(scratch.dir, settingFor(SEAT_A));
    const written = runChild("codex-write", stateFile, configPath);
    assert.equal(written.run.status, 0, written.run.stderr);
    assert.deepEqual(written.result, { isError: false });
    const read = runChild("read", stateFile, configPath);
    assert.equal(read.run.status, 0, read.run.stderr);
    for (const host of ["claude", "codex"] as const) {
      const shown = read.result?.[host] as { context: string; systemMessage: string; outcome: string };
      assert.ok(shown.context.includes("memory_status: ok"), shown.context);
      const decisions = decisionsIn(shown.context);
      assert.equal(decisions.length, 1);
      assert.equal(sha256(String(decisions[0].decision)), sha256(DECISION_TEXT));
      assert.equal(decisions[0].seat_ref, SEAT_A.seat_id);
      assert.equal(decisions[0].context, "written by the Codex form");
      assert.match(String(decisions[0].created_at), /^2027-01-15T/);
      assert.equal(shown.outcome, "degraded", "no quality log is written in this form, and the host says so (S5)");
      assert.ok(shown.systemMessage.includes("evidence logging is unavailable"));
    }
  } finally {
    scratch.remove();
  }
}]);

cases.push(["negative: a seat the database does not know is shown as not_registered, and the rows and the home are untouched", async () => {
  const scratch = scratchFolder();
  try {
    const stateFile = join(scratch.dir, "rows.json");
    assert.equal(runChild("codex-write", stateFile, writeConfig(scratch.dir, settingFor(SEAT_A))).run.status, 0);
    const rowsBefore = readFileSync(stateFile, "utf8");
    const homeBefore = snapshotTree(ISOLATED_HOME);
    const unknown = writeConfig(join(scratch.dir, "other"), settingFor(SEAT_UNREGISTERED));
    const db = new FakeDb({ stateFile, seats: [SEAT_A] });
    const run = await runClaudeSessionStart(hookInput(ISOLATED_HOME, "claude"), hookBinding(ISOLATED_HOME), {
      loadRecovery: async (binding) => (await loadCommonRecovery(binding, { ...entryDeps(db, unknown, "6"), env: COMMON_ENV }))!,
    });
    const context = run.output.hookSpecificOutput?.additionalContext ?? "";
    assert.ok(context.includes("memory_status: not_registered") && !context.includes(DECISION_TEXT), context);
    assert.equal(readFileSync(stateFile, "utf8"), rowsBefore);
    assert.deepEqual(snapshotTree(ISOLATED_HOME), homeBefore);
  } finally {
    scratch.remove();
  }
}]);

cases.push(["negative: a stopped database is shown as unreachable, nothing is written or resent, and the next start reads again without a restart", async () => {
  const scratch = scratchFolder();
  try {
    const stateFile = join(scratch.dir, "rows.json");
    const configPath = writeConfig(scratch.dir, settingFor(SEAT_A));
    assert.equal(runChild("codex-write", stateFile, configPath).run.status, 0);
    const rowsBefore = readFileSync(stateFile, "utf8");
    const homeBefore = snapshotTree(ISOLATED_HOME);
    const db = new FakeDb({ stateFile });
    db.faults.connect = networkError("ECONNREFUSED");
    const start = () =>
      runCodexSessionStart(hookInput(ISOLATED_HOME, "codex"), hookBinding(ISOLATED_HOME), {
        loadRecovery: async (binding) => (await loadCommonRecovery(binding, { ...entryDeps(db, configPath, "7"), env: COMMON_ENV }))!,
      });
    const down = (await start()).output.hookSpecificOutput?.additionalContext ?? "";
    assert.ok(down.includes("memory_status: unreachable") && !down.includes(DECISION_TEXT) && !down.includes("DATA BEGIN"), down);
    assert.ok(down.includes("This is not a statement that the seat has no decision."));
    assert.equal(db.statements.length, 0);
    assert.equal(readFileSync(stateFile, "utf8"), rowsBefore);
    assert.deepEqual(snapshotTree(ISOLATED_HOME), homeBefore);
    db.faults.connect = undefined;
    const back = (await start()).output.hookSpecificOutput?.additionalContext ?? "";
    assert.ok(back.includes("memory_status: ok") && decisionsIn(back).length === 1);
  } finally {
    scratch.remove();
  }
}]);

cases.push(["wiring: the default Claude Code and Codex loaders answer from the common form and create no local store", async () => {
  const home = ISOLATED_HOME;
  writeConfig(join(home, ".agent-memory"), settingFor(SEAT_A));
  const before = snapshotTree(home);
  const saved = { mode: process.env.AGENT_MEMORY_MODE, url: process.env.AGENT_MEMORY_DATABASE_URL };
  Object.assign(process.env, { AGENT_MEMORY_MODE: "common", AGENT_MEMORY_DATABASE_URL: SYNTHETIC_URL });
  try {
    const binding = hookBinding(home);
    const claude = await loadClaudeRecoveryFromStore(binding, JSON.parse(hookInput(home, "claude")));
    const codex = await loadCodexRecoveryFromStore(binding, JSON.parse(hookInput(home, "codex")));
    for (const loaded of [claude, codex]) {
      assert.ok(loaded.recovery.text.includes("memory_status: unreachable"), loaded.recovery.text);
      assert.ok(loaded.recovery.text.includes("reason: placement_unreachable (connect_failed"));
      assert.equal(loaded.recovery_quality_log_ref, null);
      assert.equal(loaded.store_binding, undefined);
    }
  } finally {
    for (const [name, value] of [["AGENT_MEMORY_MODE", saved.mode], ["AGENT_MEMORY_DATABASE_URL", saved.url]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  assert.deepEqual(snapshotTree(home), before, "no local store is created");
}]);

cases.push(["wiring: boot, claude-start and codex-start run as the host runs them: boot answers from the common form, the two starts stop before a store, none creates one", () => {
  const scratch = scratchFolder();
  try {
    const { home, before } = homeWithSeat(scratch.dir);
    const boot = runFile("./boot.ts", [], childEnv(home));
    assert.equal(boot.status, 0, boot.stderr);
    assert.ok(boot.stdout.includes("memory_status: unreachable") && boot.stdout.includes("placement_unreachable (connect_failed"), boot.stdout);
    for (const program of ["claude-start", "codex-start"]) {
      const run = runFile(`./${program}.ts`, [], childEnv(home));
      assert.equal(run.status, 2, run.stderr);
      assert.ok(run.stderr.includes(`[${program}] common form: not_yet_available (input)`), run.stderr);
      assert.equal(run.stdout, "");
    }
    const invalid = runFile("./claude-start.ts", [], { ...childEnv(home), AGENT_MEMORY_MODE: "bogus" });
    assert.equal(invalid.status, 2);
    assert.ok(invalid.stderr.includes("[claude-start] common form: invalid_input (setting"), invalid.stderr);
    assert.deepEqual(snapshotTree(home), before, "no local store or restart pack is created");
  } finally {
    scratch.remove();
  }
}]);

/** Starts the MCP server as the host does (a child over stdio) with the given environment, runs `use`, and closes it. */
async function withServer<T>(env: Record<string, string>, use: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", fileURLToPath(new URL("./index.ts", import.meta.url))],
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(transport);
  try {
    return await use(client);
  } finally {
    await client.close();
  }
}
const textOf = (reply: unknown): string => JSON.stringify((reply as { content: unknown }).content);
const toolNames = async (client: Client): Promise<string[]> => (await client.listTools()).tools.map((tool) => tool.name).sort();

cases.push(["wiring: the MCP server in the common form serves all 17 tools, answers not_yet_available for the 15 U1 does not have, and creates only the call record", async () => {
  const scratch = scratchFolder();
  try {
    const { home, before } = homeWithSeat(scratch.dir);
    await withServer(childEnv(home), async (client) => {
      const listed = await toolNames(client);
      assert.equal(listed.length, 17);
      assert.ok(listed.includes("log_decision") && listed.includes("get_decisions") && listed.includes("search_memory"));
      const other = await client.callTool({ name: "search_memory", arguments: { query: "anything" } });
      assert.equal(other.isError, true);
      assert.match(textOf(other), /not_yet_available \(input\)/);
      const read = await client.callTool({ name: "get_decisions", arguments: {} });
      assert.equal(read.isError, true);
      assert.match(textOf(read), /placement_unreachable \(connect_failed/);
      const wrote = await client.callTool({ name: "log_decision", arguments: { decision: DECISION_TEXT, context: "must not appear" } });
      assert.equal(wrote.isError, true);
      assert.ok(!textOf(wrote).includes(DECISION_TEXT));
    });
    const after = snapshotTree(home).filter((file) => !before.includes(file));
    assert.deepEqual(after.map((file) => file.slice(home.length + 1).replace(/:\d+$/, "")), [".agent-memory/calls.log"]);
    const record = readFileSync(join(home, ".agent-memory", "calls.log"), "utf8");
    assert.equal(record.trim().split("\n").length, 3);
    assert.ok(!record.includes(DECISION_TEXT) && !record.includes("must not appear") && !record.includes("decision="));
    assert.match(record, /search_memory {2}entry=\S+ refs=- outcome=error:not_yet_available/);
  } finally {
    scratch.remove();
  }
}]);

cases.push(["wiring: the MCP server in the standalone form is unchanged: the same 17 tools, answered by the local store it opens", async () => {
  const scratch = scratchFolder();
  try {
    const home = join(scratch.dir, "home");
    mkdirSync(join(home, ".agent-memory"), { recursive: true });
    const before = snapshotTree(home);
    const standalone = { HOME: home, AGENT_MEMORY_DB_TYPE: "sqlite" };
    const common = await withServer(childEnv(home), toolNames);
    const names = await withServer(standalone, async (client) => {
      const read = await client.callTool({ name: "get_decisions", arguments: {} });
      assert.ok(!read.isError && /No decisions found/.test(textOf(read)) && !textOf(read).includes("not_yet_available"), textOf(read));
      return toolNames(client);
    });
    assert.deepEqual(names, common, "one definition of each tool serves both forms");
    assert.ok(snapshotTree(home).length > before.length, "the standalone form opens its own local store");
  } finally {
    scratch.remove();
  }
}]);

cases.push(["wiring: refusal is the common form's alone; the standalone form carries on, and the refusal writes only to stderr", () => {
  assert.equal(commonFormRefusal({}), null);
  assert.equal(commonFormRefusal({ AGENT_MEMORY_MODE: "standalone" }), null);
  assert.equal(commonFormRefusal(COMMON_ENV)?.name, "not_yet_available");
  assert.equal(commonFormRefusal({ AGENT_MEMORY_MODE: "bogus" })?.name, "invalid_input");
  const saved = process.exitCode;
  try {
    assert.equal(refuseCommonForm("tool", {}), false);
    assert.equal(process.exitCode, saved);
  } finally {
    process.exitCode = saved;
  }
}]);

cases.push(["S4: the core of the form does not read the clock or make ids; the one entry module does, and passes both on", () => {
  const read = (name: string): string => readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const reads = /Date\.now|Math\.random|randomUUID|uuidv7|from "uuid"|new Date\(\)/;
  for (const core of ["common-recovery", "common-seat-surface", "common-seat-store", "common-placement", "common-seat-errors"]) {
    assert.ok(!reads.test(read(core)), `${core} reads the clock or makes an id`);
  }
  assert.ok(/Date\.now/.test(read("common-entry")) && /uuidv7/.test(read("common-entry")));
}]);

let passed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}
console.log(process.exitCode === 1 ? `common-seat-host: ${cases.length - passed} of ${cases.length} checks failed` : `common-seat-host: ${passed} checks passed`);
