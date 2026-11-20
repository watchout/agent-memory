/**
 * What the host-layer tests of the common-infrastructure form share (u1-seat-memory-skeleton, PR-2): an id source in
 * its own range, the entry's dependencies over a fake window, the binding and hook inputs a session-start entry takes,
 * and a child-process runner with a minimal environment. It holds no test. Every value is synthetic.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CodexSessionStartBinding } from "./codex-session-start.js";
import type { EntryDeps } from "./common-entry.js";
import type { SqlClient } from "./common-seat-store.js";
import { readUserConfig } from "./store-resolution.js";
import { FAKE_OBSERVED_AT_MS, SYNTHETIC_URL, syntheticId } from "./test-common-seat-support.js";

export const COMMON_ENV = { AGENT_MEMORY_MODE: "common", AGENT_MEMORY_DATABASE_URL: SYNTHETIC_URL } as const;

/** Ids `...<nibble>0` to `...<nibble>f`, then again: a test chooses its own nibble so ranges never overlap. */
export function idSequence(nibble: string): () => string {
  let count = 0;
  return () => syntheticId(`${nibble}${(count++ % 16).toString(16)}`);
}

export function entryDeps(client: SqlClient, configPath: string, nibble: string): EntryDeps {
  return { readConfig: () => readUserConfig(configPath), makeClient: () => client, now: () => FAKE_OBSERVED_AT_MS, newId: idSequence(nibble) };
}

export function hookBinding(workspace: string, overrides: Partial<CodexSessionStartBinding> = {}): CodexSessionStartBinding {
  return {
    agent_id: "agent-id-of-the-seat",
    project: "agent-memory",
    workspace,
    binding_source_ref: "fixture:common-seat-binding",
    max_tokens: 1_800,
    max_bytes: 8_192,
    timeout_ms: 7_000,
    ...overrides,
  };
}

/** The input of a session-start hook. Codex's has `permission_mode` and a null transcript; Claude Code's takes a transcript path. */
export function hookInput(cwd: string, host: "codex" | "claude", source = "startup"): string {
  return JSON.stringify({
    session_id: "session-of-the-seat",
    transcript_path: host === "claude" ? "/tmp/session-of-the-seat.jsonl" : null,
    cwd,
    hook_event_name: "SessionStart",
    model: "model-of-the-seat",
    ...(host === "codex" ? { permission_mode: "default" } : {}),
    source,
  });
}

/** Runs a TypeScript file in a new process with only the environment given (plus PATH), and returns what it printed. */
export function runFile(file: string, args: readonly string[], env: Record<string, string>, input?: string) {
  const run = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL(file, import.meta.url)), ...args], {
    encoding: "utf8",
    input,
    env: { PATH: process.env.PATH ?? "", ...env },
    timeout: 30_000,
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, lines: run.stdout.split("\n").filter(Boolean) };
}
