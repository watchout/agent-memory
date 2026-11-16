/**
 * What the store-resolution tests share (261113-store-resolution-fix): the throwaway home and environment, the places
 * that cannot or can be reached, the seat of the two Stop hooks, and the runtime-event fixtures. Used by
 * test-store-resolution-scenario.ts and test-store-resolution-pg.ts; it holds no test and decides nothing itself.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emitKusabiSessionStartRuntimeEvent,
  type KusabiRuntimeEventTargetBinding,
  type KusabiSessionStartEvidence,
} from "./kusabi-runtime-event-emitter.js";
import type { RotationHost } from "./session-rotation-usage.js";

export const j = (value: unknown) => JSON.stringify(value);

const STORE_ENV_NAMES = [
  "AGENT_MEMORY_DB_TYPE",
  "AGENT_MEMORY_DATABASE_URL",
  "DATABASE_URL",
  "AGENT_MEMORY_DB_PATH",
  "HOME",
] as const;

/** Runs `run` with a throwaway home folder and the store variables set to exactly `env`; restores everything after. */
export async function withSeatEnv(
  env: Partial<Record<(typeof STORE_ENV_NAMES)[number], string>>,
  run: (home: string) => Promise<void> | void,
): Promise<void> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "store-res-home-")));
  mkdirSync(join(home, ".agent-memory"));
  const saved = new Map(STORE_ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of STORE_ENV_NAMES) delete process.env[name];
  process.env.HOME = home;
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
  try {
    await run(home);
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

/** A port nothing listens on: bind to port 0, read the port, close. */
export async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export interface Listener {
  port: number;
  connections: () => number;
  close: () => Promise<void>;
}
/** Counts connections and drops each at once. It does not speak the PostgreSQL protocol. */
export async function listener(): Promise<Listener> {
  let count = 0;
  const server = net.createServer((socket) => {
    count += 1;
    socket.on("error", () => undefined);
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    port,
    connections: () => count,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const pgUrl = (port: number, name = "scenario"): string => `postgres://127.0.0.1:${port}/${name}`;

export function writeUserConfig(home: string, content: unknown): void {
  writeFileSync(join(home, ".agent-memory", "config.json"), typeof content === "string" ? content : j(content));
}

// ---------- seat fixture for the two Stop hooks ----------
export const NOW = new Date("2026-11-16T02:00:00.000Z");
export const PANE = { pane_id: "%7", tmux_socket: "/tmp/sock", host_pid: 4242, host_started_at: "Tue Nov 3 10:00:00 2026" };
export const BIG = 400_000;
/** One record of each host's transcript: the measured volume, and the seat's last visible text. */
export const usageLine = (host: RotationHost, tokens: number) => host === "codex"
  ? j({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: tokens }, model_context_window: 1_000_000 } } })
  : j({ type: "assistant", message: { role: "assistant", model: "m", usage: { input_tokens: tokens }, content: [{ type: "tool_use", name: "t" }] } });
export const textLine = (host: RotationHost, text: string) => host === "codex"
  ? j({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] } })
  : j({ type: "assistant", message: { role: "assistant", model: "m", content: [{ type: "text", text }] } });
export const HANDOFF = "## 済んだこと\n実装を進めた\n## 次の 1 歩\n試験を書く\n## まだ決まっていないこと\nなし";

/** Every folder a seat() made: a case that fails before its own clean-up must not leave one behind. */
const seatRoots: string[] = [];
export function removeSeats(): void {
  for (const root of seatRoots) rmSync(root, { recursive: true, force: true });
}

export function seat() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "store-res-seat-")));
  seatRoots.push(root);
  const workspace = join(root, "ws");
  mkdirSync(workspace);
  const binding = {
    agent_id: "kusabi", project: "agent-memory", workspace, binding_source_ref: "ref",
    max_tokens: 1_800, max_bytes: 8_192, timeout_ms: 7_000,
  };
  const input = (event: "Stop" | "UserPromptSubmit", extra: Record<string, unknown> = {}) =>
    j({ cwd: workspace, hook_event_name: event, session_id: "sess-1", transcript_path: join(root, "t.jsonl"), ...extra });
  return { root, workspace, rotationRoot: join(root, "rotation"), binding, input };
}

// ---------- runtime-event fixtures for the emitter worker ----------
export function runtimeTarget(backend: "sqlite" | "postgres", bindingSha256: string): KusabiRuntimeEventTargetBinding {
  return {
    schema_version: "kusabi-runtime-event-target/v1",
    manifest_id: "kusabi-store-resolution-scenario-v1",
    build: { commit_sha: "b".repeat(40), tree_sha: "c".repeat(40), artifact_sha256: "d".repeat(64) },
    configuration: { config_sha256: "e".repeat(64), trust_fingerprint_sha256: "f".repeat(64) },
    storage: { backend, binding_sha256: bindingSha256 },
  };
}

export function sessionStartEvidence(backend: "sqlite" | "postgres", bindingSha256: string): KusabiSessionStartEvidence {
  return {
    adapter: { id: "wasurezu-codex-session-start", version: "1.0.1" },
    identity: {
      agent_id: "kusabi", project: "agent-memory", workspace_sha256: "a".repeat(64),
      binding_source_ref: "binding:kusabi:scenario", runtime: "codex",
    },
    store_binding: { backend_intent: backend, binding_sha256: bindingSha256, verified: true },
    hook: { session_id: "session-scenario" },
    timing: { completed_at: "2026-11-16T00:00:00.000Z", elapsed_ms: 21 },
    output: { token_estimate: 180, redaction_count: 0 },
    recovery_pack: { pack_ref: "restart_pack:kusabi:agent-memory:scenario", policy_version: "kusabi-observability-v1" },
    outcome: "full",
    degraded_reason: null,
    recovery_quality_log_ref: null,
  };
}

export const WORKER_TIMEOUT_MS = 4_000;

export async function emitThroughWorker(backend: "sqlite" | "postgres", boundSha256: string, env: NodeJS.ProcessEnv) {
  const lines: string[] = [];
  const result = await emitKusabiSessionStartRuntimeEvent(sessionStartEvidence(backend, boundSha256), {
    target: runtimeTarget(backend, boundSha256),
    env: { ...process.env, ...env },
    writeEmergency: (line) => lines.push(line),
    timeoutMs: WORKER_TIMEOUT_MS,
  });
  return { result, lines };
}
