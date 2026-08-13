import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { receiveCurrentSessionTranscript } from "./session-start-auto-receive.js";
import {
  ANTIGRAVITY_TRANSCRIPT_MAX_BYTES,
  ingestAntigravityConversationEvents,
} from "./antigravity-conversation-ingest.js";
import { JsonStore } from "./stores/json-store.js";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "antigravity-ingest-"));
  const storeRoot = await mkdtemp(join(tmpdir(), "antigravity-ingest-store-"));
  const store = new JsonStore(storeRoot);
  await store.initialize();
  try {
    const workspace = join(root, "workspace");
    const brain = join(root, "brain");
    const conversationId = "antigravity-visible-conversation";
    const logs = join(brain, conversationId, ".system_generated", "logs");
    await Promise.all([mkdir(workspace), mkdir(logs, { recursive: true })]);
    const transcript = join(logs, "transcript.jsonl");
    const compactRecords = [
      { step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", content: "Visible user request", tool_calls: [], futureHarmlessField: true },
      { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", content: "truncated...", tool_calls: [{ private: "MUST_NOT_PERSIST" }], is_truncated: true },
      { step_index: 2, source: "SYSTEM", type: "USER_INPUT", status: "DONE", content: "SYSTEM_PRIVATE_MUST_NOT_PERSIST", tool_calls: [] },
      { step_index: 3, source: "MODEL", type: "TOOL_RESULT", status: "DONE", content: "TOOL_RESULT_MUST_NOT_PERSIST", tool_calls: [{ result: "secret" }] },
    ];
    const fullRecords = [
      compactRecords[0],
      { ...compactRecords[1], content: "Complete visible assistant response", is_truncated: false },
      compactRecords[2],
      compactRecords[3],
    ];
    await writeFile(transcript, `${compactRecords.map(JSON.stringify).join("\n")}\n`);
    await writeFile(join(logs, "transcript_full.jsonl"), `${fullRecords.map(JSON.stringify).join("\n")}\n`);

    const first = await receiveCurrentSessionTranscript(store, {
      host: "antigravity_cli", agent_id: "kusabi", project: "agent-memory", workspace, cwd: workspace,
      session_id: conversationId, transcript_path: transcript, roots: { antigravity_cli: brain },
    });
    assert.equal(first.status, "captured");
    assert.equal(first.events_saved, 2);
    const raw = await store.getRawEvents({ agent_id: "kusabi", source: "antigravity_cli", limit: 100 });
    assert.equal(raw.length, 2);
    assert(raw.some((event) => event.role === "user" && event.content === "Visible user request"));
    assert(raw.some((event) => event.role === "assistant" && event.content === "Complete visible assistant response"));
    const persisted = JSON.stringify(raw);
    assert(!persisted.includes("truncated..."));
    assert(!persisted.includes("MUST_NOT_PERSIST"));
    assert(!persisted.includes("SYSTEM_PRIVATE"));
    assert(!persisted.includes("TOOL_RESULT"));

    const projected = await store.getConversationEvents({ agent_id: "kusabi", project: "agent-memory", source: "antigravity_cli", limit: 100 });
    assert.deepEqual(projected.map((event) => event.role).sort(), ["assistant", "user"]);

    const replay = await receiveCurrentSessionTranscript(store, {
      host: "antigravity_cli", agent_id: "kusabi", project: "agent-memory", workspace, cwd: workspace,
      session_id: conversationId, transcript_path: transcript, roots: { antigravity_cli: brain },
    });
    assert.equal(replay.events_saved, 0);
    assert.equal(replay.events_duplicate, 2);

    const wrongSession = await receiveCurrentSessionTranscript(store, {
      host: "antigravity_cli", agent_id: "kusabi", project: "agent-memory", workspace, cwd: workspace,
      session_id: "different", transcript_path: transcript, roots: { antigravity_cli: brain },
    });
    assert.equal(wrongSession.reason, "session_mismatch");

    const symlinkLogs = join(brain, "symlink-session", ".system_generated", "logs");
    const oversizedLogs = join(brain, "oversized-session", ".system_generated", "logs");
    await Promise.all([mkdir(symlinkLogs, { recursive: true }), mkdir(oversizedLogs, { recursive: true })]);
    await symlink(transcript, join(symlinkLogs, "transcript.jsonl"));
    await writeFile(join(oversizedLogs, "transcript.jsonl"), Buffer.alloc(ANTIGRAVITY_TRANSCRIPT_MAX_BYTES + 1, 0x78));
    const boundedSweep = await ingestAntigravityConversationEvents(store, "kusabi", {
      project: "agent-memory", root: brain, since: new Date(0),
    });
    assert.equal(boundedSweep.files_scanned, 2, "symlink transcript is excluded before capture");
    assert.equal(boundedSweep.events_skipped, 3, "oversized transcript is rejected in addition to two protected records");
    const afterUnsafe = await store.getConversationEvents({ agent_id: "kusabi", project: "agent-memory", source: "antigravity_cli", limit: 100 });
    assert.equal(afterUnsafe.length, 2);
    console.log("Antigravity full visible conversation durable ingest tests passed");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
    await rm(storeRoot, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
