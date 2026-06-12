#!/usr/bin/env node
/**
 * Tests for AM-016: post-tool-hook Bash + curl tag detection.
 *
 * Two layers:
 *   1. Pure unit tests for `extractDiscordContentFromBash` — fast,
 *      deterministic, no DB.
 *   2. E2E spawn test — pipes a synthetic PostToolUse hook payload
 *      through the script against a temp SQLite DB and verifies the
 *      task_states row is written.
 *
 * Run: tsx src/test-post-tool-hook.ts
 */
import { spawn } from "child_process";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  extractDiscordContentFromBash,
  splitTaskFromContent,
} from "./post-tool-hook.js";
import { SqliteStore } from "./stores/sqlite-store.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

// ─── Layer 1: pure extractor ─────────────────────────────────────

function testExtractor() {
  console.log("\n── extractDiscordContentFromBash (unit) ──");

  // Inline -d '{"content":"..."}' form
  {
    const cmd = `curl -s -X POST "https://discord.com/api/v10/channels/1490958446885863524/messages" -H "Authorization: Bot xyz" -H "Content-Type: application/json" -d '{"content": "[TASK:start] AM-016 test inline"}'`;
    const r = extractDiscordContentFromBash(cmd);
    assert(r !== null, "inline -d form is recognised");
    assert(r?.channel_id === "1490958446885863524", "inline channel_id extracted");
    assert(r?.content === "[TASK:start] AM-016 test inline", "inline content extracted");
  }

  // Heredoc form (--data @- <<'EOF' ... EOF) — this is what
  // agent-mem-dev and Arc actually use day-to-day.
  {
    const cmd = `curl -s -X POST "https://discord.com/api/v10/channels/1490958446885863524/messages" \\
  -H "Authorization: Bot xyz" \\
  -H "Content-Type: application/json" \\
  --data @- <<'EOF'
{
  "content": "[TASK:done] AM-016 heredoc form works"
}
EOF`;
    const r = extractDiscordContentFromBash(cmd);
    assert(r !== null, "heredoc form is recognised");
    assert(r?.channel_id === "1490958446885863524", "heredoc channel_id extracted");
    assert(r?.content === "[TASK:done] AM-016 heredoc form works", "heredoc content extracted");
  }

  // JSON-escaped content (newlines, quotes)
  {
    const cmd = `curl -X POST https://discord.com/api/v10/channels/123/messages -d '{"content": "[DECISION] Use \\"foo\\" not \\nbar"}'`;
    const r = extractDiscordContentFromBash(cmd);
    assert(r !== null, "escaped content is recognised");
    assert(
      r?.content === '[DECISION] Use "foo" not \nbar',
      "JSON escapes are unescaped (content === '[DECISION] Use \"foo\" not \\nbar')"
    );
  }

  // Non-Discord curl (false positive guard)
  {
    const cmd = `curl -X POST https://api.github.com/repos/foo/bar/issues -d '{"content": "[TASK:start] should not be picked up"}'`;
    const r = extractDiscordContentFromBash(cmd);
    assert(r === null, "non-Discord curl is ignored");
  }

  // Discord URL but no JSON body
  {
    const cmd = `curl -X DELETE https://discord.com/api/v10/channels/123/messages/456`;
    const r = extractDiscordContentFromBash(cmd);
    assert(r === null, "Discord URL without /messages POST body is ignored");
  }

  // Discord URL with empty content
  {
    const cmd = `curl -X POST https://discord.com/api/v10/channels/123/messages -d '{"content": ""}'`;
    const r = extractDiscordContentFromBash(cmd);
    assert(r === null, "empty content is treated as no-op");
  }

  // Different API version
  {
    const cmd = `curl -X POST https://discord.com/api/v9/channels/777/messages -d '{"content": "[TASK:block] v9 still works"}'`;
    const r = extractDiscordContentFromBash(cmd);
    assert(r !== null, "any /api/vN/ version is recognised");
    assert(r?.channel_id === "777", "v9 channel_id extracted");
  }
}

// ─── AM-023: splitTaskFromContent unit tests ────────────────────

function testSplitTaskFromContent() {
  console.log("\n── splitTaskFromContent (AM-023 unit) ──");

  // Ticket id at the start: stripped from description
  {
    const r = splitTaskFromContent("AM-023 task_id UPSERT 着手", "AM-023");
    assert(r.taskId === "AM-023", "taskId echoes the ticket id");
    assert(r.taskDescription === "task_id UPSERT 着手", "ticket id stripped from description");
  }

  // No ticket id: taskId undefined, full content as description
  {
    const r = splitTaskFromContent("Build the API", null);
    assert(r.taskId === undefined, "taskId undefined when no ticket id");
    assert(r.taskDescription === "Build the API", "description preserved verbatim");
  }

  // Ticket id appearing mid-string is stripped (only first occurrence)
  {
    const r = splitTaskFromContent("Working on AM-006 hook installer", "AM-006");
    assert(r.taskId === "AM-006", "taskId echoes the mid-string ticket id");
    assert(r.taskDescription === "Working on hook installer", "mid-string ticket id stripped");
  }

  // Bare ticket id with no description falls back to the ticket id itself
  {
    const r = splitTaskFromContent("AM-023", "AM-023");
    assert(r.taskId === "AM-023", "taskId set");
    assert(r.taskDescription === "AM-023", "bare ticket id used as description fallback");
  }

  // Long content gets capped at 200 chars
  {
    const long = "AM-001 " + "x".repeat(500);
    const r = splitTaskFromContent(long, "AM-001");
    assert(r.taskDescription.length === 200, "description capped at 200 chars");
  }
}

// ─── Layer 2: E2E spawn test ─────────────────────────────────────

const TEST_DB_PATH = join(tmpdir(), `agent-memory-hook-e2e-${Date.now()}.db`);
const AGENT_ID = `test-hook-${Date.now()}`;

function runHook(
  payload: object,
  envOverrides: Record<string, string> = {}
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", "src/post-tool-hook.ts"], {
      env: {
        ...process.env,
        AGENT_MEMORY_DB_TYPE: "sqlite",
        AGENT_MEMORY_DB_PATH: TEST_DB_PATH,
        AGENT_MEMORY_AGENT_ID: AGENT_ID,
        // P2-CS1: tag capture is legacy opt-in; these tests exercise
        // the capture paths, so opt in explicitly.
        AGENT_MEMORY_LEGACY_TAG_CAPTURE: "1",
        // Avoid loading config.json
        DATABASE_URL: "",
        AGENT_MEMORY_DATABASE_URL: "",
        ...envOverrides,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? -1, stderr }));
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

async function testE2EBashPath() {
  console.log("\n── post-tool-hook E2E (Bash path) ──");

  const heredocCommand = `curl -s -X POST "https://discord.com/api/v10/channels/1490958446885863524/messages" --data @- <<'EOF'
{"content": "[TASK:start] AM-016 E2E spawn test"}
EOF`;

  const result = await runHook({
    tool_name: "Bash",
    tool_input: { command: heredocCommand, description: "test" },
    tool_result: {},
  });
  assert(result.code === 0, "hook exits cleanly on Bash path");

  // Re-open the temp DB and verify a task_states row was created.
  const store = new SqliteStore(TEST_DB_PATH);
  await store.initialize();
  try {
    const tasks = await store.getTaskStates({
      agent_id: AGENT_ID,
      status: "all",
    });
    assert(tasks.length === 1, "task_states row was inserted by Bash path");
    assert(tasks[0].status === "in_progress", "status mapped to in_progress");
    assert(
      tasks[0].progress?.includes("AM-016 E2E spawn test") ?? false,
      "task progress contains the original message text"
    );
    // AM-023: ticket id now lives in task_id; description (with the
    // ticket id stripped) lives in task.
    assert(
      tasks[0].task_id === "AM-016",
      "task_id extracted from ticket id (AM-016)"
    );
    assert(
      tasks[0].task === "E2E spawn test",
      "task description has ticket id stripped"
    );
  } finally {
    await store.close();
  }
}

async function testE2EBashUpsertSameTicket() {
  console.log("\n── post-tool-hook E2E (UPSERT same ticket) ──");

  // Re-post the *same* ticket id with new progress text. With AM-023,
  // this must NOT create a second row — the UPSERT keyed on
  // (agent_id, task_id) should update the existing row in place.
  const heredocCommand = `curl -s -X POST "https://discord.com/api/v10/channels/1490958446885863524/messages" --data @- <<'EOF'
{"content": "[TASK:done] AM-016 E2E spawn test (now finished)"}
EOF`;

  const result = await runHook({
    tool_name: "Bash",
    tool_input: { command: heredocCommand, description: "test" },
    tool_result: {},
  });
  assert(result.code === 0, "hook exits cleanly on second Bash post");

  const store = new SqliteStore(TEST_DB_PATH);
  await store.initialize();
  try {
    const tasks = await store.getTaskStates({
      agent_id: AGENT_ID,
      status: "all",
    });
    assert(tasks.length === 1, "still exactly one row after re-posting same ticket");
    assert(tasks[0].status === "completed", "status updated to completed");
    assert(
      tasks[0].progress?.includes("now finished") ?? false,
      "progress reflects the latest post"
    );
    assert(tasks[0].task_id === "AM-016", "task_id stays AM-016 across UPSERT");
  } finally {
    await store.close();
  }
}

async function testE2ENonDiscordBashIgnored() {
  console.log("\n── post-tool-hook E2E (non-Discord Bash) ──");

  const result = await runHook({
    tool_name: "Bash",
    tool_input: {
      command: `curl -X POST https://api.github.com/repos/foo/bar/issues -d '{"content": "[TASK:done] should be ignored"}'`,
      description: "test",
    },
    tool_result: {},
  });
  assert(result.code === 0, "non-Discord Bash exits cleanly");

  // Verify no row was added by this call (count should still be 1
  // from the previous test, since we share the temp DB).
  const store = new SqliteStore(TEST_DB_PATH);
  await store.initialize();
  try {
    const tasks = await store.getTaskStates({
      agent_id: AGENT_ID,
      status: "all",
    });
    assert(tasks.length === 1, "non-Discord Bash did not insert a row");
  } finally {
    await store.close();
  }
}

async function testE2EUnrelatedToolIgnored() {
  console.log("\n── post-tool-hook E2E (unrelated tool) ──");

  const result = await runHook({
    tool_name: "Read",
    tool_input: { file_path: "/tmp/foo.txt" },
    tool_result: {},
  });
  assert(result.code === 0, "unrelated tool exits cleanly");

  const store = new SqliteStore(TEST_DB_PATH);
  await store.initialize();
  try {
    const tasks = await store.getTaskStates({
      agent_id: AGENT_ID,
      status: "all",
    });
    assert(tasks.length === 1, "unrelated tool did not insert a row");
  } finally {
    await store.close();
  }
}

// ─── AM-030: dispatcher routes mcp__agent-comms__send ────────────

async function testE2EMcpSendPath() {
  console.log("\n── post-tool-hook E2E (MCP send path, AM-030) ──");

  // Spec-as-test for AM-030: a `mcp__agent-comms__send` PostToolUse
  // payload with a `[TASK:start]` tag in `tool_input.content` must
  // fire the dispatcher and write a task_states row. Before AM-030
  // the regex only matched `reply` / `send_message` and the field
  // was `text`, so the new tool fell through to the unrelated-tool
  // no-op silently.
  //
  // We use a fresh ticket id so dedup against the existing AM-016
  // row (still in the temp DB from earlier tests) doesn't mask the
  // assertion.
  const result = await runHook({
    tool_name: "mcp__agent-comms__send",
    tool_input: {
      content: "[TASK:start] AM-030 mcp send dispatch test",
      mentions: ["lead-tuk"],
      reply_to: "00000000-0000-0000-0000-000000000000",
    },
    tool_result: {},
  });
  assert(result.code === 0, "hook exits cleanly on mcp__agent-comms__send path");

  const store = new SqliteStore(TEST_DB_PATH);
  await store.initialize();
  try {
    const tasks = await store.getTaskStates({
      agent_id: AGENT_ID,
      status: "all",
    });
    const am030 = tasks.find((t) => t.task_id === "AM-030");
    assert(am030 !== undefined, "task_states row was inserted by mcp send path");
    assert(am030?.status === "in_progress", "status mapped to in_progress");
    assert(
      am030?.progress?.includes("AM-030 mcp send dispatch test") ?? false,
      "progress contains the original send content"
    );
    assert(
      am030?.task === "mcp send dispatch test",
      "task description has ticket id stripped"
    );
  } finally {
    await store.close();
  }
}

async function testE2EMcpSendDeprecatedToolsIgnored() {
  console.log("\n── post-tool-hook E2E (deprecated mcp tool no-op) ──");

  // Spec-as-test: the deprecated tool names (`reply` / `send_message`)
  // no longer have a dispatch path. They must hit the unrelated-tool
  // fall-through and exit cleanly without inserting anything. This
  // pins the AM-030 decision: only `send` is alive in the dispatcher.
  const countBefore = await (async () => {
    const store = new SqliteStore(TEST_DB_PATH);
    await store.initialize();
    try {
      return (await store.getTaskStates({ agent_id: AGENT_ID, status: "all" })).length;
    } finally {
      await store.close();
    }
  })();

  for (const toolName of ["mcp__agent-comms__reply", "mcp__agent-comms__send_message"]) {
    const result = await runHook({
      tool_name: toolName,
      tool_input: {
        // Both legacy and new field names — neither should hit a
        // dispatcher path now.
        text: "[TASK:done] AM-030 should be ignored (deprecated tool)",
        content: "[TASK:done] AM-030 should be ignored (deprecated tool)",
      },
      tool_result: {},
    });
    assert(result.code === 0, `${toolName} exits cleanly (no dispatcher)`);
  }

  const countAfter = await (async () => {
    const store = new SqliteStore(TEST_DB_PATH);
    await store.initialize();
    try {
      return (await store.getTaskStates({ agent_id: AGENT_ID, status: "all" })).length;
    } finally {
      await store.close();
    }
  })();
  assert(
    countAfter === countBefore,
    "deprecated tool names inserted no new rows"
  );
}

async function testE2ETagCaptureDefaultOff() {
  console.log("\n── post-tool-hook E2E (P2-CS1 legacy opt-in default off) ──");

  const countRows = async () => {
    const store = new SqliteStore(TEST_DB_PATH);
    await store.initialize();
    try {
      return (await store.getTaskStates({ agent_id: AGENT_ID, status: "all" }))
        .length;
    } finally {
      await store.close();
    }
  };
  const countBefore = await countRows();

  // A payload that WOULD insert when opted in — sent without the flag.
  const taggedPayload = {
    tool_name: "mcp__agent-comms__send",
    tool_input: {
      content: "[TASK:start] P2-CS1 must not be captured by default",
      chat_id: "1490958446885863524",
    },
    tool_result: {},
  };

  for (const flagValue of ["", "0", "false"]) {
    const result = await runHook(taggedPayload, {
      AGENT_MEMORY_LEGACY_TAG_CAPTURE: flagValue,
    });
    assert(
      result.code === 0,
      `default-off hook exits cleanly (flag=${JSON.stringify(flagValue)})`
    );
  }

  assert(
    (await countRows()) === countBefore,
    "no rows inserted while legacy tag capture is off"
  );

  // Sanity: the same payload DOES insert when opted in, proving the
  // default-off result above is the flag and not a broken payload.
  const optedIn = await runHook(taggedPayload);
  assert(optedIn.code === 0, "opted-in hook exits cleanly");
  assert(
    (await countRows()) === countBefore + 1,
    "same payload inserts once opted in"
  );
}

async function cleanup() {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
}

async function run() {
  console.log("agent-memory post-tool-hook test suite (AM-016)\n");
  console.log(`E2E DB: ${TEST_DB_PATH}\n`);

  try {
    testExtractor();
    testSplitTaskFromContent();
    await testE2EBashPath();
    await testE2EBashUpsertSameTicket();
    await testE2ENonDiscordBashIgnored();
    await testE2EUnrelatedToolIgnored();
    await testE2EMcpSendPath();
    await testE2EMcpSendDeprecatedToolsIgnored();
    await testE2ETagCaptureDefaultOff();
  } finally {
    await cleanup();
  }

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
