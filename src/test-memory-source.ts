import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { JsonStore } from "./stores/json-store.js";
import { SqliteStore } from "./stores/sqlite-store.js";
import { PgStore } from "./stores/pg-store.js";
import type { Store } from "./stores/types.js";
import { conversationSourcePreview, readMemorySource, MemorySourceError } from "./memory-source.js";

const syntheticSecret = `ghp_${"A".repeat(25)}`;
const prefix = `readbackprobe ${"あ".repeat(210)}🚀`;
const suffix = " 必須条件: 青の設定を選び、旧案を実行しない。";
const content = `${prefix} ${syntheticSecret}${suffix}`;
const protectedContent = `${prefix} [REDACTED]${suffix}`;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const ref = (id: string) => `conversation_event:${id}`;
const code = (expected: string) => (error: unknown) => error instanceof MemorySourceError && error.code === expected;

export async function runMemorySourceContract(store: Store) {
  const agent = `source-${randomUUID()}`;
  const base = { agent_id: agent, project: "source-alpha", source: "manual" as const, role: "user" };
  const row = await store.saveConversationEvent({ ...base, content, occurred_at: "2026-01-01T00:00:00.000Z" });
  const otherProject = await store.saveConversationEvent({ ...base, project: "source-beta", content: "readbackprobe forbidden project" });
  const peer = await store.saveConversationEvent({ ...base, agent_id: `${agent}-peer`, content: "readbackprobe forbidden peer" });
  const hidden = await store.saveConversationEvent({ ...base, content: "hidden fixture", metadata: { private_reasoning: true } });
  const system = await store.saveConversationEvent({ ...base, content: "system fixture", role: "system" });
  const noProject = await store.saveConversationEvent({ ...base, project: undefined, content: "unclassified fixture" });
  const boundary = await store.saveConversationEvent({ ...base, content: "TOKEN=synthetic-only\n12345678-1234-1234-1234-123456789012🚀" });
  // Newer records must not hide an older ID behind a recent-results LIMIT.
  await store.saveConversationEvent({ ...base, content: "new unrelated record" });
  const lookup = { agent_id: agent, project: base.project, id: row.id, limit: 1 };
  assert.deepEqual((await store.getConversationEvents(lookup)).map((e) => e.id), [row.id]);
  assert.deepEqual(await store.getConversationEvents({ ...lookup, agent_id: `${agent}-peer` }), []);
  assert.deepEqual(await store.getConversationEvents({ ...lookup, project: "source-beta" }), []);
  const results = await store.searchMemory({ agent_id: agent, project: base.project, scope: "conversation", query: "readbackprobe", limit: 5 });
  assert(results.conversation_events.some((e) => e.id === row.id));
  assert(!results.conversation_events.some((e) => e.id === peer.id || e.id === otherProject.id));
  const preview = conversationSourcePreview(row);
  assert(!preview.content.includes("必須条件"));
  assert.equal(preview.next_offset, 220);
  assert.equal(preview.content_hash, hash(protectedContent));
  const input = { agent_id: agent, project: base.project, source_ref: preview.source_ref };
  const first = await readMemorySource(store, { ...input, max_chars: 220, expected_content_hash: preview.content_hash });
  assert.equal(first.content, preview.content);
  const remainder = await readMemorySource(store, { ...input, offset: first.next_offset!, expected_content_hash: first.content_hash });
  assert(remainder.content.includes(suffix));
  assert.equal(first.content + remainder.content, protectedContent);
  assert.equal(remainder.next_offset, null);
  assert.equal(remainder.truncated, false);
  // Small pages preserve emoji and cannot expose a partial secret.
  let assembled = ""; let offset: number | null = 0;
  while (offset !== null) {
    const page = await readMemorySource(store, { ...input, offset, max_chars: 7, expected_content_hash: hash(protectedContent) });
    assert(Array.from(page.content).length <= 7);
    assert(!page.content.includes("ghp_"));
    assembled += page.content;
    offset = page.next_offset;
  }
  assert.equal(assembled, protectedContent);
  assert.equal((await readMemorySource(store, { ...input, offset: Array.from(protectedContent).length, expected_content_hash: hash(protectedContent) })).content, "");
  for (const id of [otherProject.id, peer.id, hidden.id, system.id, noProject.id, randomUUID()]) {
    await assert.rejects(readMemorySource(store, { ...input, source_ref: ref(id) }), code("MEMORY_SOURCE_NOT_FOUND"));
  }
  for (const source_ref of ["file:///etc/passwd", "https://example.com/", "../memory.db", "conversation_event:not-a-uuid"]) {
    await assert.rejects(readMemorySource(store, { ...input, source_ref }), code("MEMORY_SOURCE_INVALID_REF"));
  }
  for (const project of [undefined, "", "  "]) {
    await assert.rejects(readMemorySource(store, { ...input, project }), code("MEMORY_SOURCE_PROJECT_REQUIRED"));
  }
  for (const range of [{ offset: -1 }, { offset: 0.5 }, { max_chars: 0 }, { max_chars: 8001 }, { max_chars: NaN }]) {
    await assert.rejects(readMemorySource(store, { ...input, ...range }), code("MEMORY_SOURCE_INVALID_RANGE"));
  }
  await assert.rejects(readMemorySource(store, { ...input, offset: 1 }), code("MEMORY_SOURCE_HASH_REQUIRED"));
  await assert.rejects(readMemorySource(store, { ...input, expected_content_hash: "wrong" }), code("MEMORY_SOURCE_INVALID_HASH"));
  await assert.rejects(readMemorySource(store, { ...input, expected_content_hash: "0".repeat(64) }), code("MEMORY_SOURCE_CHANGED"));
  await assert.rejects(readMemorySource(store, { ...input, offset: 99999, expected_content_hash: hash(protectedContent) }), code("MEMORY_SOURCE_INVALID_RANGE"));
  const failing = Object.create(store) as Store;
  failing.getConversationEvents = async () => { throw new Error("fixture database unavailable"); };
  await assert.rejects(readMemorySource(failing, input), /fixture database unavailable/);
  const changed = Object.create(store) as Store;
  changed.getConversationEvents = async () => [{ ...row, content: "corrected record" }];
  await assert.rejects(readMemorySource(changed, { ...input, expected_content_hash: preview.content_hash }), code("MEMORY_SOURCE_CHANGED"));
  const long = await store.saveConversationEvent({ ...base, content: "語".repeat(8100) });
  const longInput = { ...input, source_ref: ref(long.id) };
  assert.equal(Array.from((await readMemorySource(store, longInput)).content).length, 2000);
  assert.equal(Array.from((await readMemorySource(store, { ...longInput, max_chars: 8000 })).content).length, 8000);
  console.log(`${store.backend}: memory-source contract PASS (lookup, boundaries, paging, redaction, version and errors)`);
  return { agent, project: base.project, row, hidden, peer, boundary };
}

function text(result: { content?: unknown }) {
  return (result.content as Array<{ text?: string }>).map((item) => item.text ?? "").join("\n");
}

async function mcpRoundtrip(
  env: Record<string, string>, fixture: Awaited<ReturnType<typeof runMemorySourceContract>>,
  mutate?: () => Promise<void>, failRead?: () => Promise<void>,
) {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: {
    PATH: process.env.PATH ?? "/usr/bin:/bin", AGENT_MEMORY_DISABLE_EMBEDDINGS: "1",
    AGENT_MEMORY_AGENT_ID: fixture.agent, ...env,
  }, stderr: "pipe" });
  const client = new Client({ name: "memory-source-contract", version: "1.0" });
  try {
    await client.connect(transport);
    const search = await client.callTool({ name: "search_memory", arguments: { query: "readbackprobe", scope: "conversation", project: fixture.project } });
    assert(!search.isError);
    const output = text(search);
    assert(output.includes(ref(fixture.row.id)));
    assert(!output.includes("必須条件"));
    assert(!output.includes("forbidden"));
    const source_ref = output.match(/Source: (conversation_event:[a-f0-9-]+)/)?.[1];
    const expected_content_hash = output.match(/content_hash: ([a-f0-9]{64})/)?.[1];
    assert(source_ref && expected_content_hash);
    const args = { source_ref, project: fixture.project, expected_content_hash };
    const read = await client.callTool({ name: "read_memory_source", arguments: args });
    assert(!read.isError);
    const full = JSON.parse(text(read));
    assert.equal(full.content, protectedContent);
    assert.equal(full.content_hash, hash(full.content));
    assert.equal(full.schema_version, "memory-source/v1");
    const second = await client.callTool({ name: "read_memory_source", arguments: { ...args, offset: 220 } });
    assert(!second.isError); assert(JSON.parse(text(second)).content.includes(suffix));
    for (const id of [fixture.peer.id, fixture.hidden.id, randomUUID()]) {
      const denied = await client.callTool({ name: "read_memory_source", arguments: { ...args, source_ref: ref(id) } });
      assert.equal(denied.isError, true); assert.equal(text(denied), "MEMORY_SOURCE_NOT_FOUND");
    }
    const hiddenSearch = await client.callTool({ name: "search_memory", arguments: { query: "hidden fixture", scope: "conversation", project: fixture.project } });
    assert(!text(hiddenSearch).includes(ref(fixture.hidden.id)));
    const unscoped = await client.callTool({ name: "read_memory_source", arguments: { source_ref } });
    if (env.AGENT_MEMORY_PROJECT) {
      assert(!unscoped.isError); assert.equal(JSON.parse(text(unscoped)).content, protectedContent);
    } else {
      assert.equal(unscoped.isError, true); assert.equal(text(unscoped), "MEMORY_SOURCE_PROJECT_REQUIRED");
    }
    const emptyProject = await client.callTool({ name: "read_memory_source", arguments: { ...args, project: "" } });
    assert.equal(emptyProject.isError, true); assert.equal(text(emptyProject), "MEMORY_SOURCE_PROJECT_REQUIRED");
    const wrongProject = await client.callTool({ name: "read_memory_source", arguments: { ...args, project: "source-beta" } });
    assert.equal(wrongProject.isError, true); assert.equal(text(wrongProject), "MEMORY_SOURCE_NOT_FOUND");
    const overLimit = await client.callTool({ name: "read_memory_source", arguments: { ...args, max_chars: 8001 } });
    assert.equal(overLimit.isError, true);
    const boundaryArgs = { project: fixture.project, source_ref: ref(fixture.boundary.id) };
    const boundaryResult = await client.callTool({ name: "read_memory_source", arguments: boundaryArgs });
    assert(!boundaryResult.isError);
    const boundaryFull = JSON.parse(text(boundaryResult));
    const boundaryExpected = "TOKEN=[REDACTED]\n12345678-1234-1234-1234-123456789012🚀";
    assert.equal(boundaryFull.content, boundaryExpected);
    assert.equal(boundaryFull.content_hash, hash(boundaryExpected));
    const uuidPage = await client.callTool({ name: "read_memory_source", arguments: { ...boundaryArgs, offset: 17, max_chars: 13, expected_content_hash: boundaryFull.content_hash } });
    assert(!uuidPage.isError);
    assert.equal(JSON.parse(text(uuidPage)).content, Array.from(boundaryExpected).slice(17, 30).join(""));
    let joined = ""; let next: number | null = 0;
    while (next !== null) {
      const pageResult = await client.callTool({ name: "read_memory_source", arguments: { ...boundaryArgs, offset: next, max_chars: 13, expected_content_hash: boundaryFull.content_hash } });
      assert(!pageResult.isError);
      const page = JSON.parse(text(pageResult)); joined += page.content; next = page.next_offset;
    }
    assert.equal(joined, boundaryExpected);
    if (mutate) {
      await mutate();
      const stale = await client.callTool({ name: "read_memory_source", arguments: { ...args, offset: 220 } });
      assert.equal(stale.isError, true); assert.equal(text(stale), "MEMORY_SOURCE_CHANGED");
    }
    if (failRead) {
      await failRead();
      const failed = await client.callTool({ name: "read_memory_source", arguments: args });
      assert.equal(failed.isError, true); assert.equal(text(failed), "MEMORY_SOURCE_READ_FAILED");
    }
    console.log(`${env.AGENT_MEMORY_DB_TYPE}: real MCP search -> source readback PASS`);
  } finally { await client.close(); }
}

export async function runSqliteMemorySourceMcpContract() {
  const root = await mkdtemp(join(tmpdir(), "kusabi-source-mcp-"));
  const dbPath = join(root, "memory.db");
  const store = new SqliteStore(dbPath);
  try {
    await store.initialize();
    let fixture;
    try { fixture = await runMemorySourceContract(store); } finally { await store.close(); }
    const env = { AGENT_MEMORY_DB_TYPE: "sqlite", AGENT_MEMORY_DB_PATH: dbPath };
    await mcpRoundtrip(env, fixture);
    await mcpRoundtrip({ ...env, AGENT_MEMORY_PROJECT: fixture.project }, fixture);
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function main() {
  const pgUrl = process.env.KUSABI_SCOPE_TEST_PG_URL;
  if (!pgUrl) throw new Error("KUSABI_SCOPE_TEST_PG_URL required; missing PostgreSQL is not PASS");
  const root = await mkdtemp(join(tmpdir(), "kusabi-source-test-"));
  try {
    const json = new JsonStore(join(root, "json"));
    try { await json.initialize(); await runMemorySourceContract(json); } finally { await json.close(); }
    await runSqliteMemorySourceMcpContract();
    const admin = new pg.Pool({ connectionString: pgUrl });
    const schema = `source_${randomUUID().replaceAll("-", "")}`;
    const url = new URL(pgUrl); url.searchParams.set("options", `-c search_path=${schema},public`);
    const postgres = new PgStore(url.toString());
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await postgres.initialize();
      const fixture = await runMemorySourceContract(postgres);
      await mcpRoundtrip({ AGENT_MEMORY_DB_TYPE: "postgres", AGENT_MEMORY_DATABASE_URL: url.toString() }, fixture,
        async () => { await admin.query(`UPDATE ${schema}.conversation_events SET content=$1 WHERE id=$2`, ["corrected public text", fixture.row.id]); },
        async () => { await admin.query(`ALTER TABLE ${schema}.conversation_events RENAME TO unavailable_events`); });
    } finally { await postgres.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    console.log("Memory-source backend contracts and SQLite/PostgreSQL MCP integration PASS; actual LLM continuation not evaluated.");
  } finally { await rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
