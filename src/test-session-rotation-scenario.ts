/**
 * Success-condition scenario for 261110-session-rotation (written before the
 * implementation, per the unit's Testing Contract).
 *
 * One seat writes a hand-off at the threshold, the Stop hook stores it and
 * issues the "safe to cut" marker, and the next conversation (Claude Code and
 * Codex) starts from the saved next step. The same bundle is never used twice.
 */
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeClaudeProjectDir } from "./claude-transcript-identity.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "wasurezu-rotation-scenario-")));
process.env.HOME = root;
process.env.AGENT_MEMORY_HOME = join(root, ".agent-memory");
process.env.AGENT_MEMORY_DB_TYPE = "json";
process.env.CLAUDE_PROJECTS_DIR = join(root, ".claude", "projects");
process.env.CODEX_SESSIONS_DIR = join(root, ".codex", "sessions");

const { runSessionRotationStop } = await import("./session-rotation-stop.js");
const { runClaudeSessionStart } = await import("./claude-session-start.js");
const { runCodexSessionStart } = await import("./codex-session-start.js");
const { ROTATION_UNCERTAINTY_SENTENCE } = await import("./session-rotation-start.js");
const { createStore } = await import("./stores/index.js");
const { commitRotationRecovery } = await import("./rotation-commit.js");
import type { RotationCommitPlan } from "./rotation-commit.js";

type Host = "claude_code" | "codex";

const agentFor = (host: Host): string => (host === "claude_code" ? "kusabi" : "kusabi-codex");
const PROJECT = "agent-memory";
const NEXT_STEP = "次の 1 歩: scenario-next-step-7d3f を直してから試験を流す";
const HANDOFF_TEXT = [
  "済んだこと: 閾値の計算を入れた",
  NEXT_STEP,
  "まだ決まっていないこと: 席ごとの閾値の置き場",
].join("\n");
const IDENTITY = {
  pane_id: "%7",
  tmux_socket: "/tmp/tmux-501/default",
  host_pid: 4242,
  host_started_at: "Wed Nov 11 10:00:00 2026",
};
// The JSON store compares a restart pack's expiry with the real clock, so the injected clock starts at the real time (fixed within one run).
const NOW_BASE = Date.now();
const NOW = () => new Date(NOW_BASE);

const workspace = join(root, "workspace");
mkdirSync(workspace, { recursive: true });
const bindingFor = (host: Host) => ({
  agent_id: agentFor(host),
  project: PROJECT,
  workspace,
  binding_source_ref: "fixture:binding",
  max_tokens: 1_800,
  max_bytes: 8_192,
  timeout_ms: 7_000,
});

function transcriptFor(host: Host, sessionId: string): string {
  const dir = host === "claude_code"
    ? join(root, ".claude", "projects", encodeClaudeProjectDir(workspace))
    : join(root, ".codex", "sessions", "2026", "11", "11");
  mkdirSync(dir, { recursive: true });
  return join(dir, host === "claude_code" ? `${sessionId}.jsonl` : `rollout-${sessionId}.jsonl`);
}

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function writeOverThresholdTranscript(host: Host, sessionId: string): string {
  const path = transcriptFor(host, sessionId);
  if (host === "claude_code") {
    writeFileSync(path,
      line({ type: "user", sessionId, cwd: workspace, message: { role: "user", content: "続きをお願いします" } }) +
      line({
        type: "assistant", sessionId, cwd: workspace,
        message: {
          role: "assistant", model: "claude-opus-4-1",
          content: [{ type: "text", text: "作業を進めました" }],
          usage: { input_tokens: 10, cache_creation_input_tokens: 50_000, cache_read_input_tokens: 300_000, output_tokens: 400 },
        },
      }));
  } else {
    writeFileSync(path,
      line({ type: "session_meta", payload: { id: sessionId, cwd: workspace } }) +
      line({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "続きをお願いします" }] } }) +
      line({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "作業を進めました" }] } }) +
      line({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 350_000 }, model_context_window: 1_000_000 } } }));
  }
  return path;
}

function appendHandoff(host: Host, sessionId: string, path: string): void {
  if (host === "claude_code") {
    appendFileSync(path, line({
      type: "assistant", sessionId, cwd: workspace,
      message: {
        role: "assistant", model: "claude-opus-4-1",
        content: [{ type: "text", text: HANDOFF_TEXT }],
        usage: { input_tokens: 10, cache_creation_input_tokens: 1_000, cache_read_input_tokens: 350_000, output_tokens: 300 },
      },
    }));
  } else {
    appendFileSync(path,
      line({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: HANDOFF_TEXT }] } }) +
      line({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 351_000 }, model_context_window: 1_000_000 } } }));
  }
}

function stopInput(sessionId: string, path: string, stopHookActive: boolean): string {
  return JSON.stringify({
    cwd: workspace,
    hook_event_name: "Stop",
    session_id: sessionId,
    transcript_path: path,
    stop_hook_active: stopHookActive,
  });
}

function rotationFile(host: Host, name: string): unknown {
  return JSON.parse(readFileSync(join(process.env.AGENT_MEMORY_HOME!, "rotation", agentFor(host), PROJECT, name), "utf8"));
}

async function runScenario(host: Host): Promise<void> {
  const AGENT = agentFor(host);
  const binding = bindingFor(host);
  const oldSession = `old-${host}`;
  const path = writeOverThresholdTranscript(host, oldSession);
  const deps = { now: NOW, identity: IDENTITY };

  // 1st Stop: over the threshold, nothing saved yet -> block once with the hand-off request.
  const first = await runSessionRotationStop(stopInput(oldSession, path, false), host, binding, {}, deps);
  assert.equal((first.output as { decision?: string }).decision, "block", `${host}: first Stop must block`);
  const reason = (first.output as { reason?: string }).reason ?? "";
  for (const phrase of ["済んだこと", "次の 1 歩", "まだ決まっていないこと"]) {
    assert.ok(reason.includes(phrase), `${host}: block reason names ${phrase}`);
  }
  assert.throws(() => rotationFile(host, "marker.json"), `${host}: no marker before the save`);

  // 2nd Stop: the seat wrote the hand-off -> stored, marker issued, no further block.
  appendHandoff(host, oldSession, path);
  const second = await runSessionRotationStop(stopInput(oldSession, path, true), host, binding, {}, deps);
  assert.equal((second.output as { decision?: string }).decision, undefined, `${host}: second Stop must not block`);
  assert.equal(second.evidence.handoff_source, "seat_text");
  const marker = rotationFile(host, "marker.json") as Record<string, unknown>;
  assert.equal(marker.session_id, oldSession);
  assert.equal(marker.pane_id, IDENTITY.pane_id);
  assert.equal(marker.host, host);
  assert.equal(marker.handoff_source, "seat_text");
  assert.match(String(marker.marker_id), /^[0-9a-f]{64}$/);
  const turn = rotationFile(host, "turn.json") as Record<string, unknown>;
  assert.equal(turn.state, "idle");

  const store = await createStore();
  try {
    const tasks = await store.getTaskStates({ agent_id: AGENT, project: PROJECT });
    assert.ok(tasks.some((task) => `${task.progress ?? ""}${task.next_steps ?? ""}`.includes("scenario-next-step-7d3f")),
      `${host}: the next step is in the work state`);
    const pack = await store.getSelectedRestartPack({ agent_id: AGENT, project: PROJECT, pack_ref: String(marker.pack_ref) });
    assert.equal(pack?.status, "active");
  } finally {
    await store.close();
  }

  // Next conversation: SessionStart (source = clear) starts from the saved next step.
  const newSession = `new-${host}`;
  const startRaw = JSON.stringify({
    session_id: newSession,
    transcript_path: join(root, "none.jsonl"),
    cwd: workspace,
    hook_event_name: "SessionStart",
    model: "fixture-model",
    source: "clear",
    ...(host === "codex" ? { permission_mode: "default" } : {}),
  });
  const rotation = { now: NOW, identity: IDENTITY };
  const started = host === "claude_code"
    ? await runClaudeSessionStart(startRaw, binding, { rotation })
    : await runCodexSessionStart(startRaw, binding, { rotation });
  const specific = started.output.hookSpecificOutput as { additionalContext: string; initialUserMessage?: string };
  const context = specific.additionalContext;
  assert.ok(context.includes("scenario-next-step-7d3f"), `${host}: context carries the saved next step`);
  assert.ok(context.indexOf("scenario-next-step-7d3f") < 2_000, `${host}: next step is at the head`);
  assert.ok(context.includes(ROTATION_UNCERTAINTY_SENTENCE), `${host}: fixed FR7.1 sentence present`);
  if (host === "claude_code") assert.ok((specific.initialUserMessage ?? "").length > 0, "claude: initialUserMessage present");
  else assert.equal(specific.initialUserMessage, undefined, "codex: no initialUserMessage");
  const startedTurn = rotationFile(host, "turn.json") as Record<string, unknown>;
  assert.equal(startedTurn.state, "started");
  assert.equal(startedTurn.session_id, newSession);
  assert.equal(startedTurn.source, "clear");

  // FR11.1: reading consumed nothing; the commit after the output is what uses the bundle up.
  const readAgain = host === "claude_code"
    ? await runClaudeSessionStart(startRaw, binding, { rotation })
    : await runCodexSessionStart(startRaw, binding, { rotation });
  assert.ok((readAgain.output.hookSpecificOutput as { additionalContext: string }).additionalContext.includes(ROTATION_UNCERTAINTY_SENTENCE), `${host}: reading alone leaves the bundle`);
  const plan = (started as { rotation_commit?: RotationCommitPlan }).rotation_commit;
  assert.ok(plan, `${host}: the result carries the commit plan`);
  assert.equal(plan.via, "marker");
  const committed = await commitRotationRecovery(plan, { now: NOW, elapsed_ms: () => 100, hook_timeout_ms: 9_000, open_store: () => createStore() });
  assert.deepEqual(committed, { record: "skipped", consume: "consumed" }, `${host}: a /clear start has no record and consumes once`);

  // The same bundle is not used twice.
  const again = host === "claude_code"
    ? await runClaudeSessionStart(startRaw, binding, { rotation })
    : await runCodexSessionStart(startRaw, binding, { rotation });
  const againContext = (again.output.hookSpecificOutput as { additionalContext: string }).additionalContext;
  assert.ok(!againContext.includes(ROTATION_UNCERTAINTY_SENTENCE), `${host}: a used bundle is not delivered again`);
}

try {
  await runScenario("claude_code");
  await runScenario("codex");
  console.log("PASS test-session-rotation-scenario");
} finally {
  // temp directory lives under the OS temp root and is left for the OS to clear
}
