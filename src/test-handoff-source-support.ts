/**
 * Shared fixtures for the hand-off source tests (T17, 261110-session-rotation, FR11.7): the seat, the text, the marker, a
 * clean environment for the real command, and a digest of every file under a folder. No test runs from here.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMarker,
  sha256Hex,
  type HandoffSource,
  type RotationMarker,
} from "./session-rotation-files.js";

export const AGENT = "kusabi";
export const PROJECT = "agent-memory";
export const PANE = { pane_id: "%7", tmux_socket: "/tmp/tmux-501/default", host_pid: 4242, host_started_at: "2026-11-12T00:00:00.000Z" };
export const BODY = Array.from({ length: 40 }, (_, index) => `済んだこと ${index}: 引き継ぎの本文の行。長い本文は通常の回復の束では切られる。`).join("\n");
export const HANDOFF = `${BODY}\n次の 1 歩: watcher の試験を書く\nまだ決まっていないこと: なし`;
export const HANDOFF_TASK_NAME = "会話の切り直しの引き継ぎ";

export function marker(over: { agent?: string; project?: string; source?: HandoffSource; text?: string } = {}): RotationMarker {
  return buildMarker({
    agent_id: over.agent ?? AGENT, project: over.project ?? PROJECT, host: "claude_code", session_id: "old", ...PANE,
    pack_ref: "selected_restart_pack:fixture", pack_content_sha256: sha256Hex(over.text ?? HANDOFF),
    measured_tokens: 310_000, threshold_tokens: 300_000, saved_at: "2026-11-12T00:00:00.000Z", handoff_source: over.source ?? "seat_text",
  });
}

/** A new empty home (real path, so a comparison of paths cannot be fooled by a link). */
export function freshHome(label: string): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), `${label}-`)));
  mkdirSync(join(home, "store"), { recursive: true });
  return home;
}

/**
 * The environment of a real command: this process's, with every place that could name a real store removed, so a test
 * can never read or write this machine's own records. `extra` names the store of the test.
 */
export function commandEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, AGENT_MEMORY_HOME: join(home, ".agent-memory"), NODE_NO_WARNINGS: "1" };
  for (const name of [
    "AGENT_MEMORY_DB_TYPE", "AGENT_MEMORY_DB_PATH", "AGENT_MEMORY_DATABASE_URL", "DATABASE_URL", "AGENT_MEMORY_AGENT_ID", "AGENT_MEMORY_PROJECT",
    "PGOPTIONS", "PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE",
  ]) delete env[name];
  return { ...env, ...extra };
}

export function runRestartCli(env: NodeJS.ProcessEnv, args: string[], nodeArgs: string[] = []) {
  return spawnSync(process.execPath, [...nodeArgs, "--import", "tsx", join(process.cwd(), "src", "restart-cli.ts"), ...args], { encoding: "utf8", env, cwd: process.cwd() });
}

/** Every file under a folder, with a SHA-256 of its bytes: a changed record, a new file or a removed one all show. */
export function digestOf(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return `${path.slice(directory.length)}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
    })
    .sort();
}

/** Every name under a folder, with its size: a new file or folder shows, even an empty one. */
export function listing(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: false }).map(String).sort().map((name) => `${name}:${statSync(join(directory, name)).size}`);
}
