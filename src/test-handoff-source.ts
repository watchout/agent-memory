/**
 * Step 17 (FR11, 261110-session-rotation), the second audit's F1: where the hand-off text comes back from when its bundle
 * was used up and the host did not take the text (handoff-commit-order-design.md 4.7 R-b). T17 of section 6.
 * The read goes through real stores (JSON and SQLite, in a temporary folder); a fake store is used only for the
 * failures a real store cannot be made to give on demand.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROTATION_HANDOFF_SOURCE_LIST_LIMIT } from "./constants.js";
import { parseRestartCliArgs, printRestartCliHelp } from "./restart-cli.js";
import { buildRecoveryPackArtifact, loadRestartPackData } from "./restart-pack.js";
import { readHandoffSource, HANDOFF_SOURCE_SCHEMA } from "./rotation-handoff-source.js";
import {
  buildMarker,
  rotationHandoffTaskId,
  seatDirectory,
  sha256Hex,
  writeMarker,
  type HandoffSource,
  type RotationMarker,
} from "./session-rotation-files.js";
import { JsonStore } from "./stores/json-store.js";
import { SqliteStore } from "./stores/sqlite-store.js";
import type { Store, TaskState } from "./stores/types.js";

const cases: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

const AGENT = "kusabi";
const PROJECT = "agent-memory";
const PANE = { pane_id: "%7", tmux_socket: "/tmp/tmux-501/default", host_pid: 4242, host_started_at: "2026-11-12T00:00:00.000Z" };
const BODY = Array.from({ length: 40 }, (_, index) => `済んだこと ${index}: 引き継ぎの本文の行。長い本文は通常の回復の束では切られる。`).join("\n");
const HANDOFF = `${BODY}\n次の 1 歩: watcher の試験を書く\nまだ決まっていないこと: なし`;

interface World {
  directory: string;
  rotationRoot: string;
  store: Store;
  kind: "json" | "sqlite";
  home: string;
}

async function world(kind: "json" | "sqlite"): Promise<World> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), `handoff-source-${kind}-`)));
  const rotationRoot = join(home, ".agent-memory", "rotation");
  const directory = seatDirectory(rotationRoot, AGENT, PROJECT);
  mkdirSync(directory, { recursive: true });
  mkdirSync(join(home, "store"), { recursive: true });
  // The JSON store sits where the command's own default store would (HOME/.agent-memory), so the real command reads the same records.
  const store: Store = kind === "json" ? new JsonStore(join(home, ".agent-memory")) : new SqliteStore(join(home, "store", "memory.db"));
  await (store as JsonStore | SqliteStore).initialize();
  return { directory, rotationRoot, store, kind, home };
}

function marker(over: { agent?: string; project?: string; source?: HandoffSource; text?: string } = {}): RotationMarker {
  return buildMarker({
    agent_id: over.agent ?? AGENT, project: over.project ?? PROJECT, host: "claude_code", session_id: "old", ...PANE,
    pack_ref: "selected_restart_pack:fixture", pack_content_sha256: sha256Hex(over.text ?? HANDOFF),
    measured_tokens: 310_000, threshold_tokens: 300_000, saved_at: "2026-11-12T00:00:00.000Z", handoff_source: over.source ?? "seat_text",
  });
}

/** What the stop side leaves behind when the seat's own text was taken: the bundle, and the task state that holds the same text. */
async function leaveHandoff(w: World, text = HANDOFF): Promise<void> {
  await w.store.saveTaskState({
    agent_id: AGENT, project: PROJECT, task_id: rotationHandoffTaskId(PROJECT), task: "会話の切り直しの引き継ぎ", status: "in_progress", progress: text,
  });
  const pack = await w.store.saveSelectedRestartPack({ agent_id: AGENT, project: PROJECT, content: text, source: "restart_prepare" });
  const used = await w.store.consumeSelectedRestartPack({ agent_id: AGENT, project: PROJECT, pack_ref: pack.pack_ref });
  assert.ok(used, "the bundle is used up - the state this recovery is for");
  assert.equal(await w.store.getSelectedRestartPack({ agent_id: AGENT, project: PROJECT, pack_ref: pack.pack_ref }), null, "no code reads a used-up bundle");
}

const read = (w: World, over: { agent?: string; project?: string; store?: Pick<Store, "getTaskStates"> } = {}) =>
  readHandoffSource(over.store ?? w.store, { agent_id: over.agent ?? AGENT, project: over.project ?? PROJECT, rotation_root: w.rotationRoot });

for (const kind of ["json", "sqlite"] as const) {
  test(`T17(a) [${kind}]: the text comes back whole from the task state when its SHA-256 is the marker's - and the ordinary recovery pack cannot give it whole`, async () => {
    const w = await world(kind);
    writeMarker(w.directory, marker());
    await leaveHandoff(w);
    const rowsBefore = JSON.stringify(await w.store.getTaskStates({ agent_id: AGENT, project: PROJECT, status: "all", limit: 100 }));
    const got = await read(w);
    assert.equal(got.schema_version, HANDOFF_SOURCE_SCHEMA);
    assert.equal(got.result, "found");
    assert.equal(got.result === "found" ? got.text : null, HANDOFF);
    assert.equal(got.result === "found" ? got.sha256 : null, sha256Hex(HANDOFF));
    // Read-only, shown rather than assumed: through a store that throws on every verb but the one read, the answer is the same,
    // and the rows are unchanged afterwards (the type `Pick<Store, "getTaskStates">` is the promise; this is the evidence).
    const onlyTheRead = new Proxy(w.store, {
      get(target, property, receiver) {
        if (property === "getTaskStates") return Reflect.get(target, property, receiver).bind(target);
        throw new Error(`handoff-source touched store.${String(property)}`);
      },
    }) as Pick<Store, "getTaskStates">;
    const guarded = await read(w, { store: onlyTheRead });
    assert.deepEqual(guarded, got, "the same answer through a store that can only read task states");
    assert.equal(JSON.stringify(await w.store.getTaskStates({ agent_id: AGENT, project: PROJECT, status: "all", limit: 100 })), rowsBefore, "the task states are unchanged by the reads");
    const pack = buildRecoveryPackArtifact(await loadRestartPackData(w.store, { agent_id: AGENT, project: PROJECT }));
    const current = pack.items.find((item) => item.kind === "current_task");
    assert.ok(current, "the ordinary recovery names it as the current task here");
    assert.ok(current.summary.length < HANDOFF.length, "but it cuts the text, so it is not a source for the whole hand-off");
    await w.store.close();
  });

  test(`T17(b) [${kind}]: a later hand-off of the same seat replaces the task state - the older text is reported as overwritten, never returned`, async () => {
    const w = await world(kind);
    writeMarker(w.directory, marker());
    await leaveHandoff(w);
    await w.store.saveTaskState({
      agent_id: AGENT, project: PROJECT, task_id: rotationHandoffTaskId(PROJECT), task: "会話の切り直しの引き継ぎ", status: "in_progress", progress: `${HANDOFF}\nその後の切り直しの本文`,
    });
    const got = await read(w);
    assert.equal(got.result, "overwritten");
    assert.ok(!("text" in got), "no text is returned for a body that is not the marker's");
    await w.store.close();
  });

  test(`T17(c) [${kind}]: no task state, a task state of another project or another agent, and a seat that is not the marker's are each named - and nothing is returned`, async () => {
    const w = await world(kind);
    writeMarker(w.directory, marker());
    assert.equal((await read(w)).result, "absent");
    for (const [agent, project] of [[AGENT, "other-project"], ["other-agent", PROJECT]] as const) {
      await w.store.saveTaskState({ agent_id: agent, project, task_id: rotationHandoffTaskId(project), task: "会話の切り直しの引き継ぎ", status: "in_progress", progress: HANDOFF });
    }
    const still = await read(w);
    assert.equal(still.result, "absent", "another project's or agent's task state is not this seat's source");
    await w.store.close();
  });

  test(`T17(d) [${kind}]: however many newer tasks there are, the hand-off is found by its task id, not by its rank`, async () => {
    const w = await world(kind);
    writeMarker(w.directory, marker());
    await leaveHandoff(w);
    for (let index = 0; index < 30; index += 1) {
      await w.store.saveTaskState({ agent_id: AGENT, project: PROJECT, task_id: `other-${index}`, task: `別の作業 ${index}`, status: "in_progress", progress: "x" });
    }
    const first = (await w.store.getTaskStates({ agent_id: AGENT, project: PROJECT, status: "in_progress", limit: 2 }))[0];
    assert.notEqual(first.task_id, rotationHandoffTaskId(PROJECT), "the ordinary recovery would put another task first");
    assert.equal((await read(w)).result, "found");
    await w.store.close();
  });
}

const throwingStore = (): Pick<Store, "getTaskStates"> => ({
  getTaskStates: async () => {
    throw new Error("store unavailable");
  },
});

test("T17(e): a marker that is missing, of another seat, or about a fixed sentence is named before any store is read", async () => {
  const w = await world("json");
  const none = await read(w, { store: throwingStore() });
  assert.equal(none.result, "no_marker");
  const badSeat = await readHandoffSource(throwingStore(), { agent_id: "../x", project: PROJECT, rotation_root: w.rotationRoot });
  assert.equal(badSeat.result, "no_marker", "a seat name that is not valid never reaches the disk or the store");
  writeMarker(w.directory, marker({ agent: "someone-else" }));
  assert.equal((await read(w, { store: throwingStore() })).result, "other_seat");
  writeMarker(w.directory, marker({ source: "existing_records" }));
  assert.equal((await read(w, { store: throwingStore() })).result, "not_seat_text");
  await w.store.close();
});

test("T17(f): a store that fails, or a list cut at the limit that does not show the task, is 'unreadable' - never 'absent'", async () => {
  const w = await world("json");
  writeMarker(w.directory, marker());
  assert.equal((await read(w, { store: throwingStore() })).result, "unreadable");
  const filler = (index: number): TaskState => ({
    id: `id-${index}`, agent_id: AGENT, project: PROJECT, task_id: `other-${index}`, task: "x", status: "in_progress", files_modified: [], created_at: "2026-11-12T00:00:00.000Z", updated_at: "2026-11-12T00:00:00.000Z",
  });
  const cut = { getTaskStates: async (input: { limit?: number }) => Array.from({ length: input.limit ?? 0 }, (_, index) => filler(index)) };
  const got = await read(w, { store: cut });
  assert.equal(got.result, "unreadable");
  assert.ok(got.result === "unreadable" && got.reason.includes(String(ROTATION_HANDOFF_SOURCE_LIST_LIMIT)));
  const short = { getTaskStates: async () => [filler(1)] };
  assert.equal((await read(w, { store: short })).result, "absent", "a list that was not cut and does not show it is absent");
  await w.store.close();
});

test("T17(g): the command is added without changing the others - the arguments, the help text, and the old verbs", () => {
  const options = parseRestartCliArgs(["handoff-source", "--agent-id", AGENT, "--project", PROJECT], {});
  assert.equal(options.command, "handoff-source");
  assert.equal(options.agent_id, AGENT);
  assert.equal(options.project, PROJECT);
  assert.ok(printRestartCliHelp().includes("handoff-source"));
  assert.equal(parseRestartCliArgs(["fetch", "--pack-ref", "r", "--consume"], {}).consume, true);
  assert.equal(parseRestartCliArgs(["prepare"], {}).command, "prepare");
  assert.throws(() => parseRestartCliArgs(["no-such-command"], {}), /unknown command: no-such-command/);
});

test("T17(g2): a task state row without a progress body is 'overwritten' (never a found empty text), and a legacy row without updated_at reports its created_at", async () => {
  const w = await world("json");
  writeMarker(w.directory, marker());
  const row = (over: Partial<TaskState>): TaskState => ({
    id: "id-1", agent_id: AGENT, project: PROJECT, task_id: rotationHandoffTaskId(PROJECT), task: "x", status: "in_progress", files_modified: [],
    created_at: "2026-11-12T00:00:00.000Z", ...over,
  });
  const noBody = await read(w, { store: { getTaskStates: async () => [row({ updated_at: "2026-11-12T01:00:00.000Z" })] } });
  assert.equal(noBody.result, "overwritten");
  const legacy = await read(w, { store: { getTaskStates: async () => [row({ progress: HANDOFF })] } });
  assert.equal(legacy.result, "found");
  assert.equal(legacy.result === "found" ? legacy.task_updated_at : null, "2026-11-12T00:00:00.000Z");
  await w.store.close();
});

test("T17(h): the real command prints the text for a matching task state, exits 1 for each other result, and writes nothing", async () => {
  const w = await world("json");
  writeMarker(w.directory, marker());
  await leaveHandoff(w);
  const env = {
    ...process.env, HOME: w.home, AGENT_MEMORY_HOME: join(w.home, ".agent-memory"), AGENT_MEMORY_DB_TYPE: "json",
    AGENT_MEMORY_AGENT_ID: AGENT, AGENT_MEMORY_PROJECT: PROJECT,
  } as NodeJS.ProcessEnv;
  const before = listing(w.directory);
  const storeBefore = digestOf(join(w.home, ".agent-memory"));
  assert.ok(storeBefore.some((entry) => entry.includes("task")), "the digest covers the store's records, so the comparison below is not empty");
  const run = (extra: string[] = []) => spawnSync(process.execPath, ["--import", "tsx", join(process.cwd(), "src", "restart-cli.ts"), "handoff-source", ...extra],
    { encoding: "utf8", env: { ...env, NODE_NO_WARNINGS: "1" }, cwd: process.cwd() });
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  const printed = JSON.parse(ok.stdout) as { result: string; text?: string };
  assert.equal(printed.result, "found");
  assert.equal(printed.text, HANDOFF);
  const noProject = spawnSync(process.execPath, ["--import", "tsx", join(process.cwd(), "src", "restart-cli.ts"), "handoff-source"],
    { encoding: "utf8", env: { ...env, AGENT_MEMORY_PROJECT: "", NODE_NO_WARNINGS: "1" }, cwd: process.cwd() });
  assert.equal(noProject.status, 1, "a missing --project is refused before any store is read");
  assert.ok(noProject.stderr.includes("handoff-source requires --project"), noProject.stderr);
  assert.equal(noProject.stdout, "");
  const other = run(["--project", "no-such-project"]);
  assert.equal(other.status, 1);
  assert.equal((JSON.parse(other.stdout) as { result: string }).result, "no_marker");
  assert.deepEqual(listing(w.directory), before, "the seat's folder is unchanged");
  assert.deepEqual(digestOf(join(w.home, ".agent-memory")), storeBefore, "the store's own files (every record) are byte for byte unchanged after the four runs");
  await w.store.close();
});

/** Every file under a folder, with a SHA-256 of its bytes: a changed record, a new file or a removed one all show. */
function digestOf(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return `${path.slice(directory.length)}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
    })
    .sort();
}

function listing(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: false }).map(String).sort().map((name) => `${name}:${statSync(join(directory, name)).size}`);
}

let failed = 0;
for (const [name, runCase] of cases) {
  try {
    await runCase();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}\n${error instanceof Error ? error.stack : String(error)}`);
  }
}
if (failed > 0) {
  console.error(`FAIL test-handoff-source (${failed}/${cases.length})`);
  process.exit(1);
}
console.log(`PASS test-handoff-source (${cases.length} cases)`);
