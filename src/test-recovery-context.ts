import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Store, TaskState } from "./stores/types.js";
import { JsonStore } from "./stores/json-store.js";
import { SqliteStore } from "./stores/sqlite-store.js";
import { PgStore } from "./stores/pg-store.js";
import { buildRecoveryOutput, DEFAULT_RECOVERY_CONFIG } from "./constants.js";
import { buildRestartPack, buildRecoveryPackArtifact } from "./restart-pack.js";
import { checkpointFreshness, loadRecoveryContext, normalRecoveryLimits } from "./recovery-context.js";

const exec = promisify(execFile);
const config = { ...DEFAULT_RECOVERY_CONFIG, max_tokens: 4000, messages_limit: 20 };
const limits = normalRecoveryLimits(config);
const visible = "continuation-visible-token";
const hidden = "NEVER-EMIT-PRIVATE-CONTEXT";
const forbidden = "NEVER-EMIT-FOREIGN-CONTEXT";

export function runCheckpointFreshnessContract() {
  const observedAt = "2026-01-02T00:00:00.000Z";
  const base: TaskState = { id: "fixture", agent_id: "fixture", task: "current objective", status: "in_progress", files_modified: [], created_at: "2026-01-01T00:00:00.000Z", next_steps: "continue safely" };
  const cases = [
    { label: "12h boundary", task: { ...base, updated_at: "2026-01-01T12:00:00.000Z" }, observedAt, expected: "fresh" },
    { label: "over 12h", task: { ...base, updated_at: "2026-01-01T11:59:59.999Z" }, observedAt, expected: "stale" },
    { label: "created fallback", task: base, observedAt, expected: "stale" },
    { label: "invalid timestamp", task: { ...base, updated_at: "invalid" }, observedAt, expected: "unknown" },
    { label: "missing timestamp", task: { ...base, created_at: "" }, observedAt, expected: "unknown" },
    { label: "future timestamp", task: { ...base, updated_at: "2026-01-02T00:00:00.001Z" }, observedAt, expected: "unknown" },
    { label: "invalid observation", task: base, observedAt: "invalid", expected: "unknown" },
    { label: "missing observation", task: base, observedAt: undefined, expected: "unknown" },
    { label: "no task", task: undefined, observedAt, expected: "unavailable" },
  ] as const;
  for (const c of cases) {
    assert.equal(checkpointFreshness(c.task, c.observedAt), c.expected, c.label);
    const activeTasks = c.task ? [c.task] : [];
    const data = { agentId: "fixture", project: "alpha", maxTokens: 1500, observedAt: c.observedAt, activeTasks, blockedTasks: [], completedTasks: [], decisions: [], knowledge: [], conversationEvents: [] };
    const normal = buildRecoveryOutput({ agentId: "fixture", config, inProgressTasks: activeTasks, completedTasks: [], decisions: [], knowledgeItems: [], messages: [], observedAt: c.observedAt });
    const pack = buildRestartPack(data);
    const artifact = buildRecoveryPackArtifact(data);
    const marker = c.expected === "stale" ? "FRESHNESS CAUTION" : "FRESHNESS UNKNOWN";
    for (const output of [normal, pack]) {
      assert.equal(output.includes(marker), ["stale", "unknown"].includes(c.expected), c.label);
      if (["stale", "unknown"].includes(c.expected)) assert(output.indexOf(marker) < output.indexOf(base.task));
    }
    assert.equal(artifact.missing_context.includes("task_checkpoint_stale"), c.expected === "stale");
    assert.equal(artifact.missing_context.includes("task_checkpoint_freshness_unknown"), c.expected === "unknown");
  }
  const huge = { ...base, progress: "x".repeat(20000) };
  const normal = buildRecoveryOutput({ agentId: "fixture", config: { ...config, max_tokens: 500 }, inProgressTasks: [huge], completedTasks: [], decisions: [], knowledgeItems: [], messages: [], observedAt });
  const pack = buildRestartPack({ agentId: "fixture", maxTokens: 500, observedAt, activeTasks: [huge], blockedTasks: [], completedTasks: [], decisions: [], knowledge: [], conversationEvents: [] });
  assert(normal.includes("FRESHNESS CAUTION") && pack.includes("FRESHNESS CAUTION"), "large payload cannot hide freshness caution");
  console.log("Checkpoint freshness: boundary/invalid/future/absence/text/JSON/truncation PASS");
}

export async function runRecoveryReadContract(store: Store) {
  const agent = `recovery-${randomUUID()}`;
  const project = "context-alpha";
  const task = await store.saveTaskState({ agent_id: agent, project, task: "context continuation", status: "in_progress", next_steps: "produce the continuation result" });
  await store.saveTaskState({ agent_id: agent, project: "context-beta", task: forbidden, status: "in_progress" });
  await store.saveTaskState({ agent_id: `${agent}-peer`, project, task: forbidden, status: "in_progress" });
  const event = await store.saveConversationEvent({ agent_id: agent, project, source: "manual", role: "user", content: visible });
  await store.saveConversationEvent({ agent_id: agent, project, source: "manual", role: "analysis", content: hidden });
  await store.saveConversationEvent({ agent_id: agent, project, source: "manual", role: "user", content: hidden, metadata: { hidden: true } });
  await store.saveConversationEvent({ agent_id: agent, project, source: "manual", role: "user", content: hidden, metadata: { private_reasoning: true } });
  await store.saveConversationEvent({ agent_id: agent, project, source: "manual", role: "system", content: hidden });
  await store.saveConversationEvent({ agent_id: `${agent}-peer`, project, source: "manual", role: "user", content: forbidden });
  await store.saveConversationEvent({ agent_id: agent, project: "context-beta", source: "manual", role: "user", content: forbidden });
  await store.saveKnowledge({ source_type: "manual", agent_id: agent, title: "context seat knowledge", content: "seat scope", tags: [], memory_scope: "seat", source_ids: [event.id] });
  await store.saveKnowledge({ source_type: "manual", agent_id: agent, project, title: "context project knowledge", content: "project scope", tags: [] });
  await store.saveKnowledge({ source_type: "manual", agent_id: agent, project: "context-beta", title: forbidden, content: forbidden, tags: [] });
  const input = { agent_id: agent, project, limits };
  const start = Date.now();
  const data = await loadRecoveryContext(store, input);
  assert.deepEqual(data.activeTasks.map(t => t.id), [task.id]);
  assert.deepEqual(data.conversationEvents.map(e => e.id), [event.id]);
  assert.equal(data.knowledge.length, 2);
  assert(data.knowledge.some(k => k.memory_scope === "seat"));
  assert(!JSON.stringify(data).includes(forbidden) && !JSON.stringify(data).includes(hidden));
  assert(Date.parse(data.observedAt) >= start && Date.parse(data.observedAt) <= Date.now());
  const failing = Object.create(store) as Store;
  let calls = 0;
  failing.getConversationEvents = async () => { calls++; throw new Error("fixture DB read failure"); };
  await assert.rejects(loadRecoveryContext(failing, input), /fixture DB read failure/);
  assert.equal(calls, 1, "read failure is propagated without retry");
  const zero = Object.create(store) as Store;
  zero.getTaskStates = async () => { throw new Error("zero task limit must not query"); };
  const empty = await loadRecoveryContext(zero, { ...input, limits: { ...limits, active: 0, blocked: 0, completed: 0 } });
  assert.equal(empty.activeTasks.length, 0);
  console.log(`${store.backend}: recovery read boundaries/privacy/errors PASS`);
  return { agent, project, task };
}

async function runEntries(env: Record<string, string>, fixture: Awaited<ReturnType<typeof runRecoveryReadContract>>) {
  const home = await mkdtemp(join(tmpdir(), "kusabi-recovery-home-"));
  const processEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, AGENT_MEMORY_DISABLE_EMBEDDINGS: "1", AGENT_MEMORY_AGENT_ID: fixture.agent, AGENT_MEMORY_PROJECT: fixture.project, ...env };
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: processEnv, stderr: "pipe" });
  const client = new Client({ name: "recovery-context-contract", version: "1" });
  try {
    const boot = await exec(process.execPath, ["dist/boot.js"], { env: processEnv, timeout: 15000 });
    const packBoot = await exec(process.execPath, ["dist/boot.js"], { env: { ...processEnv, AGENT_MEMORY_BOOT_MODE: "restart_pack" }, timeout: 15000 });
    await client.connect(transport);
    const outputs = [boot.stdout, packBoot.stdout];
    for (const name of ["recover_context", "restart_pack"]) {
      const result = await client.callTool({ name, arguments: { project: fixture.project } });
      assert(!result.isError, JSON.stringify(result));
      outputs.push((result.content as Array<{ text?: string }>).map(c => c.text ?? "").join("\n"));
    }
    for (const [index, output] of outputs.entries()) {
      assert(output.includes("FRESHNESS CAUTION"), "live entry marks the stale checkpoint");
      if (index === 0 || index === 2) assert(output.includes(visible), "normal boot/MCP contains the visible conversation");
      else assert(output.includes("Raw conversation events available: 1"), "pack preserves its metadata-only conversation summary after private filtering");
      assert(!output.includes(forbidden) && !output.includes(hidden), "live entry isolates private/foreign records");
      assert(output.indexOf("FRESHNESS CAUTION") < output.indexOf(fixture.task.task));
    }
    console.log(`${env.AGENT_MEMORY_DB_TYPE}: normal boot, pack boot, recover_context and restart_pack actual subprocess/MCP PASS`);
  } finally { await client.close(); await transport.close(); await rm(home, { recursive: true, force: true }); }
}

export async function runSqliteRecoveryEntries() {
  const root = await mkdtemp(join(tmpdir(), "kusabi-recovery-db-"));
  const dbPath = join(root, "memory.db");
  const store = new SqliteStore(dbPath);
  try {
    await store.initialize();
    const fixture = await runRecoveryReadContract(store);
    await store.upsertRecoveryConfig({ agent_id: fixture.agent, ...config });
    // Age only the test checkpoint to 13h (below the existing 7-day expiry).
    // This sets up the scenario; it does not repair a product result.
    const db = (store as unknown as { db: { run(sql: string, args: string[]): void } }).db;
    db.run("UPDATE task_states SET updated_at=? WHERE id=?", [new Date(Date.now() - 13 * 3600000).toISOString(), fixture.task.id]);
    await store.close();
    await runEntries({ AGENT_MEMORY_DB_TYPE: "sqlite", AGENT_MEMORY_DB_PATH: dbPath }, fixture);
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function main() {
  const pgUrl = process.env.KUSABI_SCOPE_TEST_PG_URL;
  if (!pgUrl) throw new Error("KUSABI_SCOPE_TEST_PG_URL required; PostgreSQL absence is not PASS");
  runCheckpointFreshnessContract();
  const root = await mkdtemp(join(tmpdir(), "kusabi-recovery-json-"));
  const json = new JsonStore(root);
  try { await json.initialize(); await runRecoveryReadContract(json); } finally { await json.close(); await rm(root, { recursive: true, force: true }); }
  await runSqliteRecoveryEntries();
  const admin = new pg.Pool({ connectionString: pgUrl });
  const schema = `recovery_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(pgUrl); url.searchParams.set("options", `-c search_path=${schema},public`);
  const store = new PgStore(url.toString());
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await store.initialize();
    const fixture = await runRecoveryReadContract(store);
    await store.upsertRecoveryConfig({ agent_id: fixture.agent, ...config });
    await admin.query(`UPDATE ${schema}.task_states SET updated_at=$1 WHERE id=$2`, [new Date(Date.now() - 13 * 3600000).toISOString(), fixture.task.id]);
    await runEntries({ AGENT_MEMORY_DB_TYPE: "postgres", AGENT_MEMORY_DATABASE_URL: url.toString() }, fixture);
  } finally { await store.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  console.log("Recovery context contract PASS; real LLM continuation remains unmeasured.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
