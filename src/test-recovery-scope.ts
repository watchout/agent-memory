import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import initSqlJs from "sql.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SqliteStore } from "./stores/sqlite-store.js";
import { JsonStore } from "./stores/json-store.js";
import { PgStore } from "./stores/pg-store.js";
import type { Knowledge, Store } from "./stores/types.js";
import { generateRecoveryPackArtifact } from "./restart-pack.js";
import { buildRecoveryOutput, DEFAULT_RECOVERY_CONFIG } from "./constants.js";

const agent = "scope-seat";
const source = randomUUID();
const ids = (items: Knowledge[]) => items.map((k) => k.id).sort();
const base = { agent_id: agent, title: "scopeprobe", content: "scopeprobe evidence", source_type: "manual" as const };
let assertions = 0;
function same(actual: unknown, expected: unknown, label: string) { assert.deepEqual(actual, expected, label); assertions++; }

export async function runRecoveryScopeContract(store: Store) {
  const oldDisable = process.env.AGENT_MEMORY_DISABLE_EMBEDDINGS;
  process.env.AGENT_MEMORY_DISABLE_EMBEDDINGS = "1";
  try {
  const common = await store.saveKnowledge({ ...base, title: "scopeprobe 共通手順", memory_scope: "seat", source_ids: [source] });
  const project = await store.saveKnowledge({ ...base, project: "alpha", title: "scopeprobe AM-7777 alpha" });
  const other = await store.saveKnowledge({ ...base, project: "beta", title: "scopeprobe forbidden-other-project" });
  const unknown = await store.saveKnowledge({ ...base, title: "scopeprobe unclassified" });
  const peer = await store.saveKnowledge({ ...base, agent_id: "peer-seat", memory_scope: "seat", source_ids: [source], title: "scopeprobe forbidden-peer" });
  await assert.rejects(store.saveKnowledge({ ...base, memory_scope: "seat" }), /source_ids/); assertions++;
  await assert.rejects(store.saveKnowledge({ ...base, memory_scope: "seat", source_ids: ["not-a-record-id"] }), /UUIDs/); assertions++;
  await assert.rejects(store.saveKnowledge({ ...base, memory_scope: "seat", source_ids: [source], project: "" }), /cannot have project/); assertions++;
  await assert.rejects(store.saveKnowledge({ ...base, memory_scope: "seat", project: "alpha", source_ids: [source] }), /cannot have project/); assertions++;
  await assert.rejects(store.getKnowledge({ agent_id: agent, knowledge_scope: "project_and_seat" }), /requires project/); assertions++;
  await assert.rejects(store.searchMemory({ agent_id: agent, query: "scopeprobe", knowledge_scope: "seat_only" }), /requires knowledge search/); assertions++;
  await assert.rejects(store.getKnowledge({ agent_id: agent, project: "alpha", knowledge_scope: "seat_only" }), /without project/); assertions++;
  same(unknown.memory_scope, "unclassified", "old-style project-less writes stay unclassified");
  const selection = { agent_id: agent, project: "alpha", knowledge_scope: "project_and_seat" as const };
  same(ids(await store.getKnowledge(selection)), [common.id, project.id].sort(), "only this seat's explicit common + selected project");
  same(ids(await store.getKnowledge({ agent_id: agent, project: "alpha" })), [project.id], "legacy project filter remains exact");
  same(ids(await store.getKnowledge({ agent_id: agent })), [common.id, project.id, other.id, unknown.id].sort(), "legacy unscoped read remains compatible");
  same(ids(await store.getKnowledge({ agent_id: "peer-seat", knowledge_scope: "seat_only" })), [peer.id], "seat isolation");
  const result = await store.searchMemory({ ...selection, query: "scopeprobe", scope: "knowledge" });
  same(ids(result.knowledge), [common.id, project.id].sort(), "search has the same scope predicate");
  same(ids((await store.searchMemory({ agent_id: agent, knowledge_scope: "seat_only", query: "scopeprobe", scope: "knowledge" })).knowledge), [common.id], "seat-only search");
  await store.saveTaskState({ agent_id: agent, project: "alpha", task: "AM-7777 scopeprobe task", status: "in_progress", next_steps: "Use shared test procedure" });
  const pack = await generateRecoveryPackArtifact(store, { agent_id: agent, project: "alpha", max_tokens: 4000 });
  const knowledgeRefs = pack.items.filter((i) => i.kind === "knowledge").map((i) => i.source_ref).sort();
  same(knowledgeRefs, [common.id, project.id].map((id) => `knowledge:${id}`).sort(), "restart pack includes common knowledge despite task anchor");
  assert(!JSON.stringify(pack).includes("forbidden")); assertions++;
  const text = buildRecoveryOutput({ agentId: agent, project: "alpha", config: DEFAULT_RECOVERY_CONFIG, inProgressTasks: [], completedTasks: [], decisions: [], messages: [], knowledgeItems: await store.getKnowledge(selection) });
  assert(text.includes(common.title) && text.includes(project.title) && !text.includes(other.title)); assertions++;
  await assert.rejects(store.supersedeKnowledge({ agent_id: agent, old_id: common.id, new_title: "bad", new_content: "bad", reason: "invalid", project: "" }), /must not be empty/); assertions++;
  const replacement = await store.supersedeKnowledge({ agent_id: agent, old_id: common.id, new_title: "scopeprobe revised common", new_content: "Revised shared procedure", reason: "user correction" });
  same(replacement.new.memory_scope, "seat", "correction retains explicit seat applicability");
  same(replacement.new.source_ids, [source], "correction retains classification evidence");
  same(ids(await store.getKnowledge(selection)), [replacement.new.id, project.id].sort(), "superseded common knowledge is not resurrected");
  const moved = await store.supersedeKnowledge({ agent_id: agent, old_id: replacement.new.id, new_title: "scopeprobe beta only", new_content: "Now specific to beta", reason: "explicit narrowing", project: "beta" });
  same(moved.new.memory_scope, "project", "explicit project change narrows scope");
  same(ids(await store.getKnowledge(selection)), [project.id], "narrowed knowledge no longer appears in alpha");
  return { project, other, unknown };
  } finally {
    if (oldDisable === undefined) delete process.env.AGENT_MEMORY_DISABLE_EMBEDDINGS;
    else process.env.AGENT_MEMORY_DISABLE_EMBEDDINGS = oldDisable;
  }
}

function resultText(result: { content?: unknown }) {
  return (result.content as Array<{ type: string; text?: string }>).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}
async function mcpRoundtrip(dbPath: string) {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: {
    PATH: process.env.PATH ?? "/usr/bin:/bin", AGENT_MEMORY_DB_TYPE: "sqlite", AGENT_MEMORY_DB_PATH: dbPath,
    AGENT_MEMORY_AGENT_ID: agent, AGENT_MEMORY_PROJECT: "alpha", AGENT_MEMORY_DISABLE_EMBEDDINGS: "1",
  }, stderr: "pipe" });
  const client = new Client({ name: "scope-contract", version: "1.0" });
  try {
    await client.connect(transport);
    const save = await client.callTool({ name: "save_knowledge", arguments: { title: "MCP common procedure", content: "Use this shared test procedure", memory_scope: "seat", source_ids: [source] } });
    same(save.isError ?? false, false, "MCP explicit common write ignores environment project default");
    const savedId = resultText(save).match(/id: ([a-f0-9-]+)/)?.[1]; assert(savedId); assertions++;
    const bad = await client.callTool({ name: "save_knowledge", arguments: { title: "bad", content: "bad", memory_scope: "seat", project: "alpha", source_ids: [source] } });
    same(bad.isError, true, "MCP rejects conflicting scope instead of silently dropping project");
    const get = await client.callTool({ name: "get_knowledge", arguments: { knowledge_scope: "seat_only" } });
    assert(resultText(get).includes("MCP common procedure") && !resultText(get).includes("forbidden")); assertions++;
    const recover = await client.callTool({ name: "recover_context", arguments: { project: "alpha" } });
    assert(resultText(recover).includes("MCP common procedure") && !resultText(recover).includes("forbidden")); assertions++;
    const corrected = await client.callTool({ name: "supersede_knowledge", arguments: { old_id: savedId, new_title: "MCP common corrected", new_content: "Corrected procedure", reason: "correction" } });
    same(corrected.isError ?? false, false, "MCP correction succeeds");
    const after = resultText(await client.callTool({ name: "get_knowledge", arguments: { knowledge_scope: "seat_only" } }));
    assert(after.includes("MCP common corrected") && !after.includes("MCP common procedure")); assertions++;
    const packed = await client.callTool({ name: "restart_pack", arguments: { project: "alpha", format: "recovery-pack-v1", max_tokens: 4000 } });
    assert(resultText(packed).includes("MCP common corrected") && !resultText(packed).includes("forbidden")); assertions++;
  } finally { await client.close(); }
}

async function main() {
process.env.AGENT_MEMORY_DISABLE_EMBEDDINGS = "1";
const root = await mkdtemp(join(tmpdir(), "kusabi-scope-test-"));
try {
  const legacyId = randomUUID();
  const legacyRow = { ...base, id: legacyId, source_ids: [], tags: [], status: "active", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
  const legacyJson = new JsonStore(join(root, "legacy-json"));
  await legacyJson.initialize(); await legacyJson.close();
  await writeFile(join(root, "legacy-json", "knowledge.json"), JSON.stringify([legacyRow]));
  const oldJson = new JsonStore(join(root, "legacy-json"));
  await oldJson.initialize();
  same((await oldJson.getKnowledge({ agent_id: agent }))[0].memory_scope, "unclassified", "old JSON record without new field is preserved");
  same(await oldJson.getKnowledge({ agent_id: agent, knowledge_scope: "seat_only" }), [], "old JSON record is not promoted");
  await oldJson.close();
  const SQL = await initSqlJs(); const oldDb = new SQL.Database();
  oldDb.run("CREATE TABLE knowledge(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,project TEXT,title TEXT NOT NULL,content TEXT NOT NULL,source_type TEXT NOT NULL,source_ids TEXT DEFAULT '[]',tags TEXT DEFAULT '[]',status TEXT DEFAULT 'active',merged_into TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
  oldDb.run("INSERT INTO knowledge(id,agent_id,title,content,source_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", [legacyId, agent, "legacy", "legacy", "manual", legacyRow.created_at, legacyRow.updated_at]);
  const legacyPath = join(root, "legacy.db"); await writeFile(legacyPath, Buffer.from(oldDb.export())); oldDb.close();
  const migrated = new SqliteStore(legacyPath); await migrated.initialize(); await migrated.initialize();
  same((await migrated.getKnowledge({ agent_id: agent }))[0].memory_scope, "unclassified", "old SQLite schema gets additive migration only");
  same(await migrated.getKnowledge({ agent_id: agent, knowledge_scope: "seat_only" }), [], "old SQLite row is not promoted on migration rerun");
  await migrated.close();
  const sqlitePath = join(root, "memory.db");
  for (const store of [new SqliteStore(sqlitePath), new JsonStore(join(root, "json"))]) {
    try { await store.initialize(); await runRecoveryScopeContract(store); console.log(`${store.backend}: scope contract PASS`); }
    finally { await store.close(); }
  }
  // Reinitialization must preserve the classification across sessions.
  const reopened = new SqliteStore(sqlitePath);
  await reopened.initialize();
  same((await reopened.getKnowledge({ agent_id: agent })).find((k) => k.title === "scopeprobe unclassified")?.memory_scope, "unclassified", "SQLite restart preserves unclassified knowledge");
  await reopened.close();
  await mcpRoundtrip(sqlitePath);
  console.log("MCP SQLite save/get/recover/correct/pack roundtrip PASS");
  const pgUrl = process.env.KUSABI_SCOPE_TEST_PG_URL;
  if (!pgUrl) throw new Error("KUSABI_SCOPE_TEST_PG_URL is required: refusing to count missing PostgreSQL as PASS");
  const admin = new pg.Pool({ connectionString: pgUrl });
  const schema = `scope_${randomUUID().replaceAll("-", "")}`;
  const scoped = new URL(pgUrl); scoped.searchParams.set("options", `-c search_path=${schema},public`);
  const postgres = new PgStore(scoped.toString());
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    // Real old-schema row: no memory_scope or embedding columns before initialize.
    await admin.query(`CREATE TABLE ${schema}.knowledge (id UUID PRIMARY KEY, agent_id TEXT NOT NULL, project TEXT, title TEXT NOT NULL, content TEXT NOT NULL, source_type TEXT NOT NULL, source_ids UUID[] DEFAULT '{}', tags TEXT[] DEFAULT '{}', status TEXT DEFAULT 'active', merged_into UUID, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())`);
    const legacyId = randomUUID();
    await admin.query(`INSERT INTO ${schema}.knowledge(id,agent_id,title,content,source_type) VALUES ($1,$2,'legacy null','old data','manual')`, [legacyId, "legacy-migration-seat"]);
    await postgres.initialize(); await postgres.initialize();
    same((await postgres.getKnowledge({ agent_id: "legacy-migration-seat" })).find((k) => k.id === legacyId)?.memory_scope, "unclassified", "PG old NULL row is not promoted during migration rerun");
    same(ids(await postgres.getKnowledge({ agent_id: "legacy-migration-seat", knowledge_scope: "seat_only" })), [], "legacy row excluded from common read");
    // Keep the migration fixture; it belongs to its own seat until schema teardown.
    await runRecoveryScopeContract(postgres);
    // Exercise actual pgvector SQL with a deterministic local embedding response.
    // No external embedding request is made; this checks scope, not semantic ranking.
    const oldFetch = globalThis.fetch;
    const oldDisable = process.env.AGENT_MEMORY_DISABLE_EMBEDDINGS;
    const oldKey = process.env.VOYAGE_API_KEY;
    const embedding = Array.from({ length: 512 }, (_, i) => i === 0 ? 1 : 0);
    const requests: Array<{ input: string[]; input_type: string }> = [];
    const localEmbedding = (async (_url, options) => {
      requests.push(JSON.parse(String(options?.body)));
      return new Response(JSON.stringify({ data: [{ embedding }] }), { status: 200 });
    }) as typeof fetch;
    try {
      globalThis.fetch = localEmbedding;
      process.env.AGENT_MEMORY_DISABLE_EMBEDDINGS = "0";
      process.env.VOYAGE_API_KEY = "scope-local-fixture";
      const vectorAgent = "vector-correction-seat";
      const entry = { ...base, agent_id: vectorAgent, memory_scope: "seat" as const, source_ids: [source] };
      const common = await postgres.saveKnowledge(entry);
      const query = { agent_id: vectorAgent, project: "alpha", knowledge_scope: "project_and_seat" as const, query: "scopeprobe", scope: "knowledge" as const };
      same(ids((await postgres.searchMemory(query)).knowledge), [common.id], "saved knowledge is searchable without database repair");
      const corrected = await postgres.supersedeKnowledge({ agent_id: vectorAgent, old_id: common.id, new_title: "scopeprobe corrected", new_content: "correct procedure", reason: "user correction" });
      same(ids((await postgres.searchMemory(query)).knowledge), [corrected.new.id], "corrected knowledge replaces old id in vector search without database repair");
      same(requests.some((r) => r.input_type === "document" && r.input[0] === "scopeprobe corrected correct procedure"), true, "correction embeds the new content rather than copying the old vector");
      globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
      const fallback = await postgres.supersedeKnowledge({ agent_id: vectorAgent, old_id: corrected.new.id, new_title: "scopeprobe offline correction", new_content: "retained without embedding", reason: "correction while provider unavailable" });
      same((await admin.query(`SELECT embedding IS NULL AS missing FROM ${schema}.knowledge WHERE id=$1`, [fallback.new.id])).rows[0].missing, true, "provider failure retains the corrected row without a stale vector");
      // Foreign records also have no vectors: textual fallback must retain the same boundary.
      await postgres.saveKnowledge({ ...entry, agent_id: "vector-peer" });
      await postgres.saveKnowledge({ ...base, agent_id: vectorAgent, project: "beta" });
      globalThis.fetch = localEmbedding;
      same(ids((await postgres.searchMemory(query)).knowledge), [fallback.new.id], "query embedding success still finds a correction saved during provider failure, without foreign or superseded rows");
      const project = await postgres.saveKnowledge({ ...base, agent_id: vectorAgent, project: "alpha" });
      same(ids((await postgres.searchMemory(query)).knowledge), [fallback.new.id, project.id].sort(), "vector and text-only knowledge preserve project plus seat boundary");
      same(ids((await postgres.searchMemory({ ...query, limit: 1 })).knowledge), [fallback.new.id], "text-only correction is not starved by the vector result limit");
      same(ids((await postgres.searchMemory({ ...query, query: " " })).knowledge), [project.id], "blank query does not construct an invalid empty text condition");
    } finally {
      globalThis.fetch = oldFetch;
      if (oldDisable === undefined) delete process.env.AGENT_MEMORY_DISABLE_EMBEDDINGS; else process.env.AGENT_MEMORY_DISABLE_EMBEDDINGS = oldDisable;
      if (oldKey === undefined) delete process.env.VOYAGE_API_KEY; else process.env.VOYAGE_API_KEY = oldKey;
    }
    console.log("PostgreSQL actual Store + legacy migration rerun + vector SQL: scope contract PASS");
  } finally { await postgres.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  console.log(`Recovery scope contract passed (${assertions} assertions); live CLI continuation not evaluated.`);
} finally { await rm(root, { recursive: true, force: true }); }

}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
