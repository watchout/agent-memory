/**
 * K-HTTP-1: Streamable HTTP entrypoint with per-seat bearer authentication.
 * Runs on loopback with an isolated HOME and a throwaway SQLite store.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const tmpHome = mkdtempSync(join(tmpdir(), "kusabi-http-"));
process.env.HOME = tmpHome;
process.env.AGENT_MEMORY_DB_TYPE = "sqlite";
process.env.AGENT_MEMORY_DB_PATH = join(tmpHome, "memory.db");
process.env.AGENT_MEMORY_DISABLE_EMBEDDINGS = "1";
delete process.env.AGENT_MEMORY_DATABASE_URL;
delete process.env.DATABASE_URL;

const TOKEN_A = "seat-a-test-token-not-a-secret";
const TOKEN_B = "seat-b-test-token-not-a-secret";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const tokensFile = join(tmpHome, "tokens.json");
writeFileSync(tokensFile, JSON.stringify([
  { token_sha256: sha256(TOKEN_A), agent_id: "http-seat-a", project: "http-project" },
  { token_sha256: sha256(TOKEN_B), agent_id: "http-seat-b", project: "http-project" },
]));

const EXPECTED_TOOLS = [
  "log_decision", "get_decisions", "supersede_decision", "save_task_state", "search_memory",
  "read_memory_source", "recover_context", "restart_pack", "restart_pack_fetch", "restart_prepare",
  "set_recovery_config", "save_knowledge", "get_knowledge", "supersede_knowledge",
  "update_knowledge_status", "ingest_conversation_events", "catch_up",
];

const { loadTokenTable, startHttpServer } = await import("./http-server.js");
const { createStore } = await import("./stores/index.js");

let passed = 0;
const check = async (label: string, fn: () => Promise<void>) => {
  await fn();
  passed++;
  console.log(`  PASS ${label}`);
};

const store = await createStore();
const http = await startHttpServer({ bind: "127.0.0.1", port: 0, tokens: loadTokenTable(tokensFile), store });
const mcpUrl = new URL("/mcp", http.url);

const rawPost = (headers: Record<string, string>, body: unknown) =>
  fetch(mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
const initBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "raw", version: "0" } },
};

async function connect(token: string) {
  const transport = new StreamableHTTPClientTransport(mcpUrl, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "k-http-1-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}
const text = (r: unknown) =>
  ((r as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("\n");

console.log("\n── K-HTTP-1 Streamable HTTP + bearer ──");
try {
  await check("healthz: no auth, body is {\"ok\":true} only", async () => {
    const res = await fetch(new URL("/healthz", http.url));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  await check("other paths: 404", async () => {
    const res = await fetch(new URL("/other", http.url), { headers: { Authorization: `Bearer ${TOKEN_A}` } });
    assert.equal(res.status, 404);
  });

  await check("a1: no token -> 401 + WWW-Authenticate: Bearer, empty body", async () => {
    const res = await rawPost({}, initBody);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("www-authenticate"), "Bearer");
    assert.equal(await res.text(), "");
  });

  await check("a2: wrong token -> 401", async () => {
    const res = await rawPost({ authorization: "Bearer not-a-registered-token" }, initBody);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("www-authenticate"), "Bearer");
    const malformed = await rawPost({ authorization: `Basic ${TOKEN_A}` }, initBody);
    assert.equal(malformed.status, 401);
  });

  const seatA = await connect(TOKEN_A);
  const seatB = await connect(TOKEN_B);

  await check("b: seat A initialize -> tools/list has the existing tools", async () => {
    const names = (await seatA.client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...EXPECTED_TOOLS].sort());
  });

  await check("c: seat A log_decision is visible to A and not to B (SQLite)", async () => {
    const marker = `k-http-1 marker ${Date.now()}`;
    const saved = await seatA.client.callTool({ name: "log_decision", arguments: { decision: marker } });
    assert.ok(!saved.isError, text(saved));
    const fromA = text(await seatA.client.callTool({ name: "get_decisions", arguments: {} }));
    const fromB = text(await seatB.client.callTool({ name: "get_decisions", arguments: {} }));
    assert.ok(fromA.includes(marker), "seat A should see its own decision");
    assert.ok(!fromB.includes(marker), "seat B must not see seat A's decision");
  });

  await check("d: seat A session id used with seat B token -> 404, and the session is discarded", async () => {
    const sessionA = seatA.transport.sessionId;
    assert.ok(sessionA, "seat A has a session id");
    const listReq = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
    const crossed = await rawPost({ authorization: `Bearer ${TOKEN_B}`, "mcp-session-id": sessionA }, listReq);
    assert.equal(crossed.status, 404);
    const after = await rawPost({ authorization: `Bearer ${TOKEN_A}`, "mcp-session-id": sessionA }, listReq);
    assert.equal(after.status, 404, "discarded session must not be reusable");
  });

  await check("unknown session id -> 404; request without session that is not initialize -> 400", async () => {
    const unknown = await rawPost({ authorization: `Bearer ${TOKEN_A}`, "mcp-session-id": "no-such-session" }, initBody);
    assert.equal(unknown.status, 404);
    const noSession = await rawPost({ authorization: `Bearer ${TOKEN_A}` }, { jsonrpc: "2.0", id: 3, method: "tools/list" });
    assert.equal(noSession.status, 400);
  });

  await seatB.client.close();
} finally {
  await http.close();
  await store.close();
  rmSync(tmpHome, { recursive: true, force: true });
}

console.log(`\nK-HTTP-1: ${passed} checks passed`);
process.exit(0);
