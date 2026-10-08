import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID,
  CODEX_TRANSCRIPT_STOP_ADAPTER_ID,
  parseTranscriptStopArgs,
  parseTranscriptStopInput,
  runTranscriptStopCapture,
} from "./transcript-stop-capture.js";
import { JsonStore } from "./stores/json-store.js";
import type { CodexSessionStartBinding } from "./codex-session-start.js";

async function main(): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "wasurezu-transcript-stop-")));
  try {
    const workspace = join(root, "workspace");
    const cwd = join(workspace, "nested");
    await mkdir(cwd, { recursive: true });
    const binding: CodexSessionStartBinding = {
      agent_id: "kusabi",
      project: "agent-memory",
      workspace,
      binding_source_ref: "fixture:binding",
      max_tokens: 1_800,
      max_bytes: 8_192,
      timeout_ms: 7_000,
    };
    const raw = JSON.stringify({
      cwd,
      hook_event_name: "Stop",
      session_id: "session-1",
      transcript_path: join(root, "transcript.jsonl"),
      stop_hook_active: false,
      last_assistant_message: "full visible answer",
      model: "fixture",
      permission_mode: "default",
      turn_id: "turn-1",
    });
    assert.equal(parseTranscriptStopInput(raw).session_id, "session-1");
    assert.throws(() => parseTranscriptStopInput("{}"), /malformed_input/);
    assert.throws(() => parseTranscriptStopInput(JSON.stringify({
      ...JSON.parse(raw),
      hook_event_name: "SessionStart",
    })), /malformed_input/);

    const stores: JsonStore[] = [];
    const createStore = async () => {
      const store = new JsonStore(join(root, `store-${stores.length}`));
      await store.initialize();
      stores.push(store);
      return store;
    };
    const captured = await runTranscriptStopCapture(raw, "codex", binding, {
      createStore,
      receive: async (_store, input) => {
        assert.equal(input.agent_id, "kusabi");
        assert.equal(input.project, "agent-memory");
        assert.equal(input.snapshot_mode, "tail");
        assert.equal(input.tail_bytes, 4 * 1024 * 1024);
        return { status: "captured", reason: "captured", events_saved: 2, events_duplicate: 3 };
      },
    });
    assert.deepEqual(captured.output, { continue: true, suppressOutput: true });
    assert.equal(captured.evidence.adapter_id, CODEX_TRANSCRIPT_STOP_ADAPTER_ID);
    assert.equal(captured.evidence.status, "captured");
    assert.equal(captured.evidence.events_saved, 2);
    assert.equal(captured.evidence.events_duplicate, 3);
    assert.equal(captured.evidence.hook_event_name, "Stop");
    assert.equal(captured.evidence.private_reasoning_persisted, false);

    const claude = await runTranscriptStopCapture(raw, "claude_code", binding, {
      createStore,
      receive: async () => ({
        status: "skipped",
        reason: "transcript_too_large",
        events_saved: 0,
        events_duplicate: 0,
      }),
    });
    assert.equal(claude.evidence.adapter_id, CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID);
    assert.equal(claude.evidence.status, "skipped");
    assert.equal(claude.evidence.reason, "transcript_too_large");

    const malformed = await runTranscriptStopCapture("{}", "codex", binding, { createStore });
    assert.equal(malformed.evidence.status, "failed_open");
    assert.equal(malformed.evidence.reason, "malformed_input");
    assert.equal(stores.length, 2, "malformed input must not open a store");

    const foreign = await runTranscriptStopCapture(JSON.stringify({
      ...JSON.parse(raw),
      cwd: root,
    }), "codex", binding, { createStore });
    assert.equal(foreign.evidence.reason, "identity_binding_invalid");
    assert.equal(stores.length, 2, "identity mismatch must not open a store");

    const failedOpen = await runTranscriptStopCapture(raw, "codex", binding, {
      createStore,
      receive: async () => { throw new Error("fixture failure"); },
    });
    assert.equal(failedOpen.evidence.status, "failed_open");
    assert.equal(failedOpen.evidence.reason, "ingest_failed");

    const promptRaw = JSON.stringify({
      cwd,
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      transcript_path: join(root, "transcript.jsonl"),
      prompt: "full visible user request",
    });
    const prompt = await runTranscriptStopCapture(promptRaw, "codex", binding, {
      createStore,
      receive: async () => ({
        status: "captured",
        reason: "captured",
        events_saved: 1,
        events_duplicate: 0,
      }),
    });
    assert.equal(prompt.evidence.hook_event_name, "UserPromptSubmit");
    assert.equal(prompt.evidence.events_saved, 1);

    const args = [
      "--adapter-id", CODEX_TRANSCRIPT_STOP_ADAPTER_ID,
      "--agent-id", "kusabi",
      "--project", "agent-memory",
      "--workspace", workspace,
      "--binding-source-ref", "fixture:binding",
      "--max-tokens", "1800",
      "--max-bytes", "8192",
      "--timeout-ms", "7000",
    ];
    assert.equal(parseTranscriptStopArgs(args).host, "codex");
    assert.equal(
      parseTranscriptStopArgs(args.map((value) =>
        value === CODEX_TRANSCRIPT_STOP_ADAPTER_ID ? CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID : value
      )).host,
      "claude_code",
    );
    assert.throws(() => parseTranscriptStopArgs([]), /missing adapter id/);

    // Exercise the real CLI: hooks do not inherit the MCP server's env.
    // A user-config PostgreSQL binding must fail open when unavailable,
    // without silently creating a SQLite store in the hook process's HOME.
    for (const host of ["claude", "codex"] as const) {
      const fixtureHome = join(root, `${host}-home`);
      const configDir = join(fixtureHome, ".agent-memory");
      const transcriptRoot = join(root, `${host}-transcripts`);
      const transcriptDir = host === "claude"
        ? join(transcriptRoot, cwd.replaceAll("/", "-")) : transcriptRoot;
      await mkdir(configDir, { recursive: true });
      await mkdir(transcriptDir, { recursive: true });
      const transcript = join(transcriptDir, "session-1.jsonl");
      const timestamp = new Date().toISOString();
      const records = host === "claude" ? [{
        timestamp, uuid: "visible-user", type: "user", sessionId: "session-1", cwd,
        message: { role: "user", content: "Store binding regression sentinel" },
      }] : [{
        timestamp, type: "session_meta", payload: { id: "session-1", cwd },
      }, {
        timestamp, type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Store binding regression sentinel" }] },
      }];
      await writeFile(transcript, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
      const env: NodeJS.ProcessEnv = {
        HOME: fixtureHome, PATH: process.env.PATH,
        CLAUDE_PROJECTS_DIR: transcriptRoot, CODEX_SESSIONS_DIR: transcriptRoot,
      };
      const cliArgs = args.map((value) => value === CODEX_TRANSCRIPT_STOP_ADAPTER_ID && host === "claude"
        ? CLAUDE_TRANSCRIPT_STOP_ADAPTER_ID : value);
      const invoke = (extra: NodeJS.ProcessEnv = {}) => {
        const child = spawnSync(process.execPath, [
          "--import", "tsx", fileURLToPath(new URL("./transcript-stop-capture.ts", import.meta.url)), ...cliArgs,
        ], {
          env: { ...env, ...extra }, encoding: "utf8", timeout: 15_000,
          input: JSON.stringify({ ...JSON.parse(raw), transcript_path: transcript }),
        });
        assert.equal(child.status, 0, "capture failures must not block the host");
        assert.deepEqual(JSON.parse(child.stdout), { continue: true, suppressOutput: true });
        return JSON.parse(child.stderr.split("\n").find((line) => line.startsWith("{"))!);
      };
      await writeFile(join(configDir, "config.json"), JSON.stringify({
        database_url: `postgresql://fixture@localhost/postgres?host=${encodeURIComponent(join(root, "absent-socket"))}`,
      }), { mode: 0o600 });
      assert.equal(invoke().status, "failed_open", `${host}: unavailable configured PG is not capture success`);
      assert(!existsSync(join(configDir, "memory.db")), "configured PostgreSQL must not create a SQLite fallback");
      await writeFile(join(configDir, "config.json"), "{invalid");
      assert.equal(invoke().status, "failed_open", `${host}: malformed config fails closed for storage`);
      assert(!existsSync(join(configDir, "memory.db")));
      // Explicit local intent retains the existing resolver's precedence.
      assert.equal(invoke({ AGENT_MEMORY_DB_TYPE: "sqlite" }).status, "captured");
      assert(existsSync(join(configDir, "memory.db")));
    }

    console.log("transcript stop capture tests passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
