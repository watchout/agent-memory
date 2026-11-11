/**
 * FR8 (261110-session-rotation): which Claude Code transcript is accepted as
 * "this seat's this conversation". Rule: capture-identity-design.md R1-R9.
 * Written before the implementation: it fails until the new rule is in place.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = realpathSync(mkdtempSync(join(tmpdir(), "wasurezu-identity-")));
process.env.HOME = root;
process.env.AGENT_MEMORY_HOME = join(root, ".agent-memory");
process.env.AGENT_MEMORY_DB_TYPE = "json";
const projects = join(root, ".claude", "projects");
process.env.CLAUDE_PROJECTS_DIR = projects;
mkdirSync(projects, { recursive: true });

const identity = await import("./claude-transcript-identity.js");
const { receiveCurrentSessionTranscript } = await import("./session-start-auto-receive.js");
const { runTranscriptStopCapture } = await import("./transcript-stop-capture.js");
const { createStore } = await import("./stores/index.js");

const workspace = join(root, "seat-workspace");
const elsewhere = join(root, "elsewhere");
const otherWorkspace = join(root, "other-workspace");
for (const dir of [workspace, join(workspace, "a"), join(workspace, "b"), elsewhere, otherWorkspace]) {
  mkdirSync(dir, { recursive: true });
}
const AGENT = "seat";
const PROJECT = "seat-project";
const ownDir = join(projects, identity.encodeClaudeProjectDir(workspace));
mkdirSync(ownDir, { recursive: true });

let counter = 0;
const rec = (sessionId: string | undefined, cwd: string, extra: Record<string, unknown> = {}): string => {
  counter += 1;
  const type = (extra.type as string | undefined) ?? (counter % 2 === 0 ? "assistant" : "user");
  const message = type === "assistant"
    ? { role: "assistant", model: "claude-opus-4-1", content: [{ type: "text", text: `reply ${counter}` }] }
    : { role: "user", content: `ask ${counter}` };
  return JSON.stringify({
    type,
    ...(sessionId === undefined ? {} : { sessionId }),
    cwd,
    timestamp: `2026-11-11T01:00:${String(counter % 60).padStart(2, "0")}.000Z`,
    uuid: `uuid-${counter}`,
    message,
    ...extra,
  });
};
const write = (dir: string, sessionId: string, lines: string[], name = `${sessionId}.jsonl`): string => {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
};
const sixCwds = [workspace, join(workspace, "a"), join(workspace, "b"), elsewhere, "/tmp", root];

async function receive(sessionId: string, path: string | null, options: { cwd?: string; mode?: "tail" } = {}) {
  const store = await createStore();
  try {
    return await receiveCurrentSessionTranscript(store, {
      host: "claude_code",
      agent_id: AGENT,
      project: PROJECT,
      workspace,
      cwd: options.cwd ?? workspace,
      session_id: sessionId,
      transcript_path: path,
      roots: { claude_code: projects },
      ...(options.mode ? { snapshot_mode: "tail" as const, tail_bytes: 4_096 } : {}),
    });
  } finally {
    await store.close();
  }
}

async function eventCount(): Promise<number> {
  const store = await createStore();
  try {
    return (await store.getConversationEvents({ agent_id: AGENT, limit: 10_000 })).length;
  } finally {
    await store.close();
  }
}

async function rawCount(): Promise<number> {
  const store = await createStore();
  try {
    return (await store.getRawEvents({ agent_id: AGENT, limit: 10_000 })).length;
  } finally {
    await store.close();
  }
}

const cases: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

test("encoding: every non-alphanumeric becomes a dash (real project dirs)", () => {
  assert.equal(identity.encodeClaudeProjectDir("/Users/example/Developer/team-space/project"),
    "-Users-example-Developer-team-space-project");
  assert.equal(identity.encodeClaudeProjectDir("/Users/example/.hidden/workspace"), "-Users-example--hidden-workspace");
});

test("positive 1: real-shaped transcript with 6+ cwds is captured; receipt counts cwd kinds (R5)", async () => {
  const sid = "11111111-1111-4111-8111-111111111111";
  const lines = [
    ...sixCwds.map((cwd) => rec(sid, cwd)),
    rec(sid, workspace, { isSidechain: true }),
    JSON.stringify({ type: "file-history-snapshot", messageId: "m1", snapshot: {} }),
  ];
  const path = write(ownDir, sid, lines);
  const before = await eventCount();
  const rawBefore = await rawCount();
  const result = await receive(sid, path);
  assert.equal(result.status, "captured");
  assert.ok(result.events_saved >= 7, `saved ${result.events_saved}`);
  assert.ok((result.cwd_kinds ?? 0) >= 6);
  assert.ok((result.records_outside_workspace ?? 0) >= 3);
  assert.equal(await eventCount() - before, result.events_saved);
  assert.ok(await rawCount() > rawBefore, "raw_events rows are written too (FR8.2)");
});

test("positive 2: hook cwd differs from the launch dir (Stop after a cd) is still captured (R1)", async () => {
  const sid = "22222222-2222-4222-8222-222222222222";
  const path = write(ownDir, sid, sixCwds.map((cwd) => rec(sid, cwd)));
  const result = await receive(sid, path, { cwd: elsewhere });
  assert.equal(result.status, "captured");
  assert.ok(result.events_saved >= 6);
});

test("idempotent: the same file twice adds no rows (R8)", async () => {
  const sid = "33333333-3333-4333-8333-333333333333";
  const path = write(ownDir, sid, sixCwds.map((cwd) => rec(sid, cwd)));
  const first = await receive(sid, path);
  const total = await eventCount();
  const second = await receive(sid, path);
  assert.equal(first.status, "captured");
  assert.equal(second.events_saved, 0);
  assert.ok(second.events_duplicate >= first.events_saved);
  assert.equal(await eventCount(), total);
});

test("tail mode: head and ingested tail are both judged", async () => {
  const sid = "44444444-4444-4444-8444-444444444444";
  const filler = Array.from({ length: 400 }, () => rec(sid, workspace));
  const path = write(ownDir, sid, filler);
  assert.equal((await receive(sid, path, { mode: "tail" })).status, "captured");
  const sid2 = "44444444-4444-4444-8444-444444444445";
  const bad = [rec(sid2, workspace), rec("someone-else", workspace), ...Array.from({ length: 400 }, () => rec(sid2, workspace))];
  const result = await receive(sid2, write(ownDir, sid2, bad), { mode: "tail" });
  assert.equal(result.reason, "record_session_mismatch");
});

const refused = (name: string, reason: string, build: () => { sid: string; path: string }) =>
  test(`negative: ${name} -> ${reason}`, async () => {
    const { sid, path } = build();
    const before = await eventCount();
    const result = await receive(sid, path);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, reason);
    assert.equal(result.events_saved, 0);
    assert.equal(await eventCount(), before);
    assert.equal(identity.receiptOutcome(result), "refused");
  });

refused("file name differs from session_id", "basename_mismatch", () => {
  const sid = "55555555-5555-4555-8555-555555555555";
  return { sid, path: write(ownDir, sid, [rec(sid, workspace)], "not-the-session.jsonl") };
});
refused("one record has another sessionId", "record_session_mismatch", () => {
  const sid = "66666666-6666-4666-8666-666666666666";
  return { sid, path: write(ownDir, sid, [rec(sid, workspace), rec("another-session", workspace), rec(sid, workspace)]) };
});
refused("sidechain record with another sessionId is not silently dropped", "record_session_mismatch", () => {
  const sid = "66666666-6666-4666-8666-666666666667";
  return { sid, path: write(ownDir, sid, [rec(sid, workspace), rec("another-session", workspace, { isSidechain: true })]) };
});
refused("file under another workspace's project dir", "projects_dir_mismatch", () => {
  const sid = "77777777-7777-4777-8777-777777777777";
  return { sid, path: write(join(projects, identity.encodeClaudeProjectDir(otherWorkspace)), sid, [rec(sid, otherWorkspace)]) };
});
refused("symlink inside the project dir pointing outside", "not_regular_file_or_symlink", () => {
  const sid = "88888888-8888-4888-8888-888888888888";
  const target = write(elsewhere, sid, [rec(sid, workspace)], "outside.jsonl");
  const link = join(ownDir, `${sid}.jsonl`);
  symlinkSync(target, link);
  return { sid, path: link };
});
refused("not a regular file", "not_regular_file_or_symlink", () => {
  const sid = "99999999-9999-4999-8999-999999999999";
  const dir = join(ownDir, `${sid}.jsonl`);
  mkdirSync(dir, { recursive: true });
  return { sid, path: dir };
});
refused("subagent file below the session folder", "path_outside_projects", () => {
  const sid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  return { sid, path: write(join(ownDir, sid, "subagents"), sid, [rec(sid, workspace)]) };
});
refused("file directly in the projects root", "path_outside_projects", () => {
  const sid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  return { sid, path: write(projects, sid, [rec(sid, workspace)]) };
});
refused("file outside the projects root", "path_outside_projects", () => {
  const sid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  return { sid, path: write(elsewhere, sid, [rec(sid, workspace)]) };
});
refused("ingested kind without a sessionId", "record_session_missing", () => {
  const sid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  return { sid, path: write(ownDir, sid, [rec(sid, workspace), rec(undefined, workspace, { type: "user" })]) };
});
refused("no record carries the session id", "record_session_missing", () => {
  const sid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  return { sid, path: write(ownDir, sid, [JSON.stringify({ type: "file-history-snapshot", snapshot: {} })]) };
});

test("a listed kind without a sessionId is allowed next to matching records (R4)", async () => {
  const sid = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const path = write(ownDir, sid, [rec(sid, workspace), JSON.stringify({ type: "summary", summary: "s", leafUuid: "x" })]);
  assert.equal((await receive(sid, path)).status, "captured");
});

test("observation failures are not success: nothing parses -> failed_open parse_error (R7)", async () => {
  const sid = "10101010-1010-4010-8010-101010101010";
  const path = write(ownDir, sid, ["not json", "{broken"]);
  const result = await receive(sid, path);
  assert.equal(result.status, "failed_open");
  assert.equal(result.reason, "parse_error");
  assert.equal(identity.receiptOutcome(result), "unobserved");
});

test("a missing file stays 'transcript_unavailable' (unobserved)", async () => {
  const result = await receive("12121212-1212-4212-8212-121212121212", join(ownDir, "12121212-1212-4212-8212-121212121212.jsonl"));
  assert.equal(result.reason, "transcript_unavailable");
  assert.equal(identity.receiptOutcome(result), "unobserved");
  assert.equal((await receive("x", null)).reason, "transcript_unavailable");
});

test("a snapshot the bounded reader refuses is skipped with its own reason, not captured", async () => {
  const sid = "13131313-1313-4313-8313-131313131313";
  const path = write(ownDir, sid, [rec(sid, workspace), rec(sid, workspace)]);
  const before = await eventCount();
  const store = await createStore();
  try {
    const result = await receiveCurrentSessionTranscript(store, {
      host: "claude_code", agent_id: AGENT, project: PROJECT, workspace, cwd: workspace,
      session_id: sid, transcript_path: path, roots: { claude_code: projects }, max_bytes: 16,
    });
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "transcript_too_large");
    assert.equal(identity.receiptOutcome(result), "unobserved");
  } finally {
    await store.close();
  }
  assert.equal(await eventCount(), before, "nothing from this refused file was stored");
});

test("a store that fails while saving is failed_open ingest_failed, never a quiet success", async () => {
  const sid = "14141414-1414-4414-8414-141414141414";
  const path = write(ownDir, sid, [rec(sid, workspace), rec(sid, workspace)]);
  const real = await createStore();
  try {
    const broken = new Proxy(real, {
      get(target, property, receiver) {
        if (property === "saveRawEvent" || property === "saveConversationEvent") {
          return async () => { throw new Error("disk full"); };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const result = await receiveCurrentSessionTranscript(broken, {
      host: "claude_code", agent_id: AGENT, project: PROJECT, workspace, cwd: workspace,
      session_id: sid, transcript_path: path, roots: { claude_code: projects },
    });
    assert.equal(result.status, "failed_open");
    assert.equal(result.reason, "ingest_failed");
    assert.equal(result.events_saved, 0);
    assert.equal(identity.receiptOutcome(result), "unobserved");
  } finally {
    await real.close();
  }
});

test("placement: a file owned by another user is refused (R2)", () => {
  const sid = "13131313-1313-4313-8313-131313131313";
  const path = write(ownDir, sid, [rec(sid, workspace)]);
  const base = { transcript_path: path, projects_root: projects, session_id: sid, declared_workspace: workspace };
  assert.deepEqual(identity.checkClaudeTranscriptPlacement({ ...base, uid: (process.getuid?.() ?? 0) + 1 }),
    { ok: false, reason: "path_outside_projects" });
  assert.equal(identity.checkClaudeTranscriptPlacement({ ...base, uid: process.getuid?.() ?? null }).ok, true);
  assert.equal(identity.checkClaudeTranscriptPlacement({ ...base, uid: null }).ok, true);
  assert.deepEqual(identity.checkClaudeTranscriptPlacement({ ...base, projects_root: join(root, "missing"), uid: null }),
    { ok: false, reason: "path_outside_projects" });
});

test("records: judge details (R4, R5)", () => {
  const sid = "s1";
  const line = (value: unknown) => JSON.stringify(value);
  const ok = identity.judgeClaudeRecords(
    [line({ sessionId: sid, cwd: "/w" }), line({ session_id: sid, cwd: "/w/a" }), line({ type: "summary" }), "", "garbled"].join("\n"),
    sid, ["/w"]);
  assert.deepEqual(ok, { ok: true, cwd_kinds: 2, records_outside_workspace: 0 });
  assert.deepEqual(identity.judgeClaudeRecords(line({ sessionId: 7 }), sid, ["/w"]), { ok: false, reason: "record_session_mismatch" });
  assert.deepEqual(identity.judgeClaudeRecords(line([1, 2]) + "\n" + line({ sessionId: sid, cwd: "/x" }), sid, ["/w"]),
    { ok: true, cwd_kinds: 1, records_outside_workspace: 1 });
  assert.deepEqual(identity.judgeClaudeRecords("   \n", sid, ["/w"]), { ok: false, reason: "parse_error" });
});

test("outcome: three values, observation failures are not success (R7)", () => {
  const o = identity.receiptOutcome;
  assert.equal(o({ status: "captured", reason: "captured" }), "ingested");
  for (const reason of ["path_outside_projects", "projects_dir_mismatch", "session_mismatch", "workspace_mismatch", "transcript_invalid"]) {
    assert.equal(o({ status: "skipped", reason }), "refused", reason);
  }
  for (const reason of ["transcript_unavailable", "transcript_unstable", "transcript_too_large"]) {
    assert.equal(o({ status: "skipped", reason }), "unobserved", reason);
  }
  assert.equal(o({ status: "failed_open", reason: "ingest_failed" }), "unobserved");
  assert.equal(o({ status: "failed_open", reason: "malformed_input" }), "unobserved");
  assert.equal(o({ status: "failed_open", reason: "identity_binding_invalid" }), "refused");
});

test("Stop hook: evidence carries the outcome, reason and cwd numbers; cd outside the workspace is not a binding failure", async () => {
  const sid = "14141414-1414-4414-8414-141414141414";
  const path = write(ownDir, sid, sixCwds.map((cwd) => rec(sid, cwd)));
  const binding = { agent_id: AGENT, project: PROJECT, workspace, binding_source_ref: "fixture", max_tokens: 1_800, max_bytes: 8_192, timeout_ms: 7_000 };
  const raw = (cwd: string, id = sid, p = path) => JSON.stringify({ cwd, hook_event_name: "Stop", session_id: id, transcript_path: p });
  const ok = await runTranscriptStopCapture(raw(elsewhere), "claude_code", binding);
  assert.equal(ok.evidence.status, "captured");
  assert.equal(ok.evidence.outcome, "ingested");
  assert.ok((ok.evidence.cwd_kinds ?? 0) >= 6);
  const bad = await runTranscriptStopCapture(raw(elsewhere, "other-id"), "claude_code", binding);
  assert.equal(bad.evidence.reason, "basename_mismatch");
  assert.equal(bad.evidence.outcome, "refused");
  const codex = await runTranscriptStopCapture(raw(elsewhere), "codex", binding);
  assert.equal(codex.evidence.reason, "identity_binding_invalid", "Codex keeps its cwd binding");
  assert.equal(codex.evidence.outcome, "refused");
  const malformed = await runTranscriptStopCapture("{", "claude_code", binding);
  assert.equal(malformed.evidence.outcome, "unobserved");
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}\n${error instanceof Error ? error.stack : String(error)}`);
  }
}
if (failed > 0) {
  console.error(`FAIL test-claude-transcript-identity (${failed}/${cases.length})`);
  process.exit(1);
}
console.log(`PASS test-claude-transcript-identity (${cases.length} cases)`);
