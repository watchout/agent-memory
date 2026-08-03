import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { JsonStore } from "./stores/json-store.js";
import {
  GEMINI_OBSERVED_JSONL_FIELDS,
  GEMINI_OBSERVED_MESSAGE_FIELDS,
  GEMINI_OBSERVED_SET_PATCH_FIELDS,
  GEMINI_OBSERVED_TOOL_CALL_FIELDS,
  GEMINI_OBSERVED_TOP_FIELDS,
  ingestGeminiConversationEvents,
} from "./gemini-conversation-ingest.js";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "kusabi-gemini-capture-"));
  const storeRoot = await mkdtemp(join(tmpdir(), "kusabi-gemini-store-"));
  const store = new JsonStore(storeRoot);
  await store.initialize();
  try {
    assert.equal(GEMINI_OBSERVED_TOP_FIELDS.length, 8);
    assert.equal(GEMINI_OBSERVED_MESSAGE_FIELDS.length, 9);
    assert.equal(GEMINI_OBSERVED_JSONL_FIELDS.length, 14);
    assert.equal(GEMINI_OBSERVED_SET_PATCH_FIELDS.length, 2);
    assert.equal(GEMINI_OBSERVED_TOOL_CALL_FIELDS.length, 10);

    const chats = join(root, "project-a", "chats");
    const nested = join(chats, "nested", "session-nested");
    await mkdir(nested, { recursive: true });
    await writeFile(join(chats, "session-snapshot.json"), JSON.stringify({
      directories: ["PRIVATE_DIRECTORY_SENTINEL"],
      kind: "chat",
      lastUpdated: "2026-08-02T00:10:00.000Z",
      messages: [
        {
          content: "Visible user request API_KEY=sk-abcdefghijklmnopqrstuvwxyz",
          displayContent: "Visible user request",
          id: "user-1",
          model: "PRIVATE_MODEL_SENTINEL",
          thoughts: "PRIVATE_THOUGHT_SENTINEL",
          timestamp: "2026-08-02T00:01:00.000Z",
          tokens: { input: 42 },
          toolCalls: [{
            args: { secret: "PRIVATE_ARGS_SENTINEL" },
            description: "PRIVATE_DESCRIPTION_SENTINEL",
            displayName: "Read file",
            id: "PRIVATE_TOOL_ID_SENTINEL",
            name: "read_file",
            renderOutputAsMarkdown: true,
            result: "PRIVATE_RESULT_SENTINEL",
            resultDisplay: "PRIVATE_RESULT_DISPLAY_SENTINEL",
            status: "success",
            timestamp: "2026-08-02T00:01:01.000Z"
          }],
          type: "user"
        },
        {
          content: "Visible Gemini response",
          displayContent: "Visible Gemini response",
          id: "gemini-1",
          model: "PRIVATE_MODEL_TWO_SENTINEL",
          thoughts: "PRIVATE_THOUGHT_TWO_SENTINEL",
          timestamp: "2026-08-02T00:02:00.000Z",
          tokens: 9,
          toolCalls: [],
          type: "gemini"
        },
        {
          content: "PROTECTED_SYSTEM_INSTRUCTION_SENTINEL",
          id: "system-1",
          timestamp: "2026-08-02T00:03:00.000Z",
          type: "system"
        },
        {
          content: "UNKNOWN_FIELD_CONTENT_SENTINEL",
          id: "unknown-1",
          timestamp: "2026-08-02T00:04:00.000Z",
          type: "user",
          futurePrivateField: "UNKNOWN_FIELD_VALUE_SENTINEL"
        }
      ],
      projectHash: "PRIVATE_PROJECT_HASH_SENTINEL",
      sessionId: "session-snapshot",
      startTime: "2026-08-02T00:00:00.000Z",
      summary: "PRIVATE_SUMMARY_SENTINEL"
    }));

    const jsonl = [
      JSON.stringify({
        kind: "session",
        projectHash: "PRIVATE_JSONL_PROJECT_SENTINEL",
        sessionId: "session-patch",
        startTime: "2026-08-02T00:00:00.000Z",
        lastUpdated: "2026-08-02T00:12:00.000Z"
      }),
      JSON.stringify({
        content: "Visible JSONL user",
        id: "patch-user-1",
        model: "PRIVATE_JSONL_MODEL_SENTINEL",
        sessionId: "session-patch",
        thoughts: "PRIVATE_JSONL_THOUGHT_SENTINEL",
        timestamp: "2026-08-02T00:05:00.000Z",
        tokens: 7,
        toolCalls: [],
        type: "user"
      }),
      JSON.stringify({
        sessionId: "session-patch",
        $set: {
          lastUpdated: "2026-08-02T00:12:00.000Z",
          messages: [{
            content: "Visible patched Gemini",
            id: "patch-gemini-1",
            timestamp: "2026-08-02T00:06:00.000Z",
            type: "gemini"
          }]
        }
      }),
      JSON.stringify({
        sessionId: "session-patch",
        $set: {
          "messages.2": {
            content: "Visible dotted patch Gemini",
            id: "patch-gemini-2",
            timestamp: "2026-08-02T00:07:00.000Z",
            type: "gemini"
          }
        }
      }),
      JSON.stringify({
        content: "UNKNOWN_JSONL_CONTENT_SENTINEL",
        id: "unknown-jsonl",
        timestamp: "2026-08-02T00:08:00.000Z",
        type: "user",
        unexpected: "UNKNOWN_JSONL_VALUE_SENTINEL"
      }),
      "{malformed-json"
    ].join("\n");
    await writeFile(join(chats, "session-patch.jsonl"), `${jsonl}\n`);

    await writeFile(join(nested, "fragment.json"), JSON.stringify({
      kind: "chat",
      lastUpdated: "2026-08-02T00:15:00.000Z",
      messages: [{
        content: "Visible nested fragment",
        id: "nested-1",
        timestamp: "2026-08-02T00:09:00.000Z",
        type: "gemini"
      }],
      sessionId: "session-nested",
      startTime: "2026-08-02T00:09:00.000Z"
    }));

    const first = await ingestGeminiConversationEvents(store, "gemini-fixture-agent", {
      project: "fixture-project",
      root,
      since: "2026-08-01T00:00:00.000Z",
    });
    assert.equal(first.files_scanned, 3);
    assert.deepEqual(first.path_shapes, {
      session_snapshot_json: 1,
      session_append_patch_jsonl: 1,
      nested_session_fragment_json: 1,
    });
    assert.equal(first.events_saved, 6);
    assert(first.privacy.thought_bearing_records_denied >= 3);
    assert.equal(first.privacy.protected_instruction_records_denied, 1);
    assert.equal(first.privacy.unknown_field_records_denied, 2);
    assert.equal(first.privacy.malformed_records_denied, 1);
    assert.equal(first.coverage.status, "clean");

    const events = await store.getRawEvents({
      agent_id: "gemini-fixture-agent",
      source: "gemini_cli",
      limit: 100,
    });
    assert.equal(events.length, 6);
    assert(events.every((event) => event.private_reasoning === false));
    assert(events.every((event) => event.redaction_level === "complete"));
    assert(events.some((event) => event.event_type === "user_message"));
    assert(events.some((event) => event.event_type === "assistant_message"));
    const persisted = JSON.stringify(events);
    for (const sentinel of [
      "PRIVATE_DIRECTORY_SENTINEL",
      "PRIVATE_MODEL_SENTINEL",
      "PRIVATE_THOUGHT_SENTINEL",
      "PRIVATE_ARGS_SENTINEL",
      "PRIVATE_DESCRIPTION_SENTINEL",
      "PRIVATE_TOOL_ID_SENTINEL",
      "PRIVATE_RESULT_SENTINEL",
      "PRIVATE_RESULT_DISPLAY_SENTINEL",
      "PRIVATE_PROJECT_HASH_SENTINEL",
      "PRIVATE_SUMMARY_SENTINEL",
      "PROTECTED_SYSTEM_INSTRUCTION_SENTINEL",
      "UNKNOWN_FIELD_CONTENT_SENTINEL",
      "UNKNOWN_FIELD_VALUE_SENTINEL",
      "PRIVATE_JSONL_PROJECT_SENTINEL",
      "PRIVATE_JSONL_MODEL_SENTINEL",
      "PRIVATE_JSONL_THOUGHT_SENTINEL",
      "UNKNOWN_JSONL_CONTENT_SENTINEL",
      "UNKNOWN_JSONL_VALUE_SENTINEL",
    ]) assert(!persisted.includes(sentinel), `denied sentinel persisted: ${sentinel}`);
    assert(!persisted.includes("sk-abcdefghijklmnopqrstuvwxyz"));
    assert(persisted.includes("[REDACTED]"));
    assert(persisted.includes("read_file"));
    for (const deniedKey of ["thoughts", "model", "args", "result", "resultDisplay", "directories", "summary", "projectHash"]) {
      assert(!persisted.includes(`\"${deniedKey}\"`), `denied field persisted: ${deniedKey}`);
    }

    const second = await ingestGeminiConversationEvents(store, "gemini-fixture-agent", {
      project: "fixture-project",
      root,
      since: "2026-08-01T00:00:00.000Z",
    });
    assert.equal(second.events_saved, 0);
    assert.equal(second.events_duplicate, 6);
    const replay = await store.getRawEvents({
      agent_id: "gemini-fixture-agent",
      source: "gemini_cli",
      limit: 100,
    });
    assert.equal(replay.length, 6);
    console.log("Gemini default-deny raw-capture tests passed");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
    await rm(storeRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
