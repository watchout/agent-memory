#!/usr/bin/env node
/**
 * K-HTTP-1: MCP Streamable HTTP entrypoint with per-seat bearer tokens.
 * One McpServer + transport per session; the seat (agent_id / project) is
 * fixed at initialize from the token. TLS belongs to a reverse proxy in front.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createStore } from "./stores/index.js";
import type { Store } from "./stores/types.js";
import { redactText } from "./redact.js";

// Must match EMBEDDED_HOST_MARKER in index.ts; set before importing it so the stdio server does not autostart.
(globalThis as Record<symbol, unknown>)[Symbol.for("wasurezu.embedded-host")] = true;
const { createWasurezuServer } = await import("./index.js");

const MAX_BODY_BYTES = 4 * 1024 * 1024;

const TokenEntrySchema = z
  .object({
    token_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    agent_id: z.string().min(1),
    project: z.string().min(1).optional(),
  })
  .strict();
const TokenTableSchema = z.array(TokenEntrySchema).min(1);

export type TokenEntry = z.infer<typeof TokenEntrySchema>;
interface SeatToken extends TokenEntry {
  digest: Buffer;
}

export function loadTokenTable(path: string): SeatToken[] {
  const entries = TokenTableSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.token_sha256)) throw new Error("Duplicate token_sha256 in token file");
    seen.add(entry.token_sha256);
  }
  return entries.map((entry) => ({ ...entry, digest: Buffer.from(entry.token_sha256, "hex") }));
}

function authenticate(header: string | undefined, tokens: SeatToken[]): SeatToken | undefined {
  const match = /^Bearer (\S+)$/.exec(header ?? "");
  if (!match) return undefined;
  const digest = createHash("sha256").update(match[1]).digest();
  let found: SeatToken | undefined;
  for (const entry of tokens) {
    if (timingSafeEqual(digest, entry.digest) && !found) found = entry;
  }
  return found;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  close: () => Promise<void>;
  tokenSha256: string;
}

function sendStatus(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, headers);
  res.end();
}

function sendJsonRpcError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Body too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

export interface HttpServerOptions {
  bind: string;
  port: number;
  tokens: SeatToken[];
  store: Store;
}

export async function startHttpServer(options: HttpServerOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const sessions = new Map<string, Session>();

  const dropSession = async (id: string) => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    await session.close();
  };

  const openSession = async (seat: SeatToken, req: IncomingMessage, res: ServerResponse, body: unknown) => {
    const id = randomUUID();
    const { server, flush } = createWasurezuServer(options.store, {
      agentId: seat.agent_id,
      project: seat.project,
      sessionId: id,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => id,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, {
          transport,
          tokenSha256: seat.token_sha256,
          close: async () => {
            await flush();
            await server.close();
          },
        });
      },
    });
    transport.onclose = () => {
      sessions.delete(id);
      void flush();
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname === "/healthz" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (pathname !== "/mcp") return sendStatus(res, 404);

    const seat = authenticate(req.headers.authorization, options.tokens);
    if (!seat) return sendStatus(res, 401, { "WWW-Authenticate": "Bearer" });

    const sessionHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return sendStatus(res, 404);
      if (session.tokenSha256 !== seat.token_sha256) {
        await dropSession(sessionId);
        return sendStatus(res, 404);
      }
      await session.transport.handleRequest(req, res);
      return;
    }

    if (req.method !== "POST") return sendJsonRpcError(res, 400, "Session required");
    const body = await readJsonBody(req);
    if (!isInitializeRequest(body)) return sendJsonRpcError(res, 400, "Session required");
    await openSession(seat, req, res, body);
  };

  const httpServer = createServer((req, res) => {
    res.on("finish", () => {
      const path = (req.url ?? "/").split("?")[0];
      process.stderr.write(redactText(`[agent-memory] http ${req.method} ${path} ${res.statusCode}\n`).text);
    });
    handle(req, res).catch((err: unknown) => {
      const status = (err as { status?: number }).status ?? 500;
      process.stderr.write(redactText(`[agent-memory] http request failed: ${(err as Error).message}\n`).text);
      if (!res.headersSent) sendStatus(res, status);
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, options.bind, () => resolve());
  });
  const address = httpServer.address() as AddressInfo;
  const host = address.family === "IPv6" ? `[${address.address}]` : address.address;

  return {
    url: `http://${host}:${address.port}`,
    close: async () => {
      await Promise.all([...sessions.keys()].map(dropSession));
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

async function main() {
  const tokensFile = process.env.AGENT_MEMORY_HTTP_TOKENS_FILE;
  if (!tokensFile) {
    console.error("[agent-memory] AGENT_MEMORY_HTTP_TOKENS_FILE is required");
    process.exit(1);
  }
  const tokens = loadTokenTable(tokensFile);
  const store = await createStore();
  const http = await startHttpServer({
    bind: process.env.AGENT_MEMORY_HTTP_BIND || "127.0.0.1",
    port: Number(process.env.AGENT_MEMORY_HTTP_PORT || 8787),
    tokens,
    store,
  });
  console.error(`[agent-memory] MCP server running on ${http.url}/mcp (${tokens.length} seat token(s))`);

  const shutdown = async () => {
    await http.close();
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main().catch((err) => {
    console.error(redactText(`[agent-memory] Fatal error: ${err}`).text);
    process.exit(1);
  });
}
