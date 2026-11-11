/**
 * FR10.1 / FR10.2: the shared outer-shape parser of the hook entries.
 * Pure function tests plus a static check that the three entries go through it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHookInputShape, type HookInputShape } from "./hook-input.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "SENTINEL_VALUE_NEVER_TO_APPEAR_7f3a";

const SESSION_START: HookInputShape = {
  required: ["cwd", "hook_event_name", "session_id", "source", "transcript_path"],
  optional: ["agent_type", "model", "permission_mode"],
  max_bytes: 64 * 1024,
};
const STOP: HookInputShape = {
  required: ["cwd", "hook_event_name", "session_id", "transcript_path"],
  optional: [
    "agent_id", "agent_type", "last_assistant_message", "model",
    "permission_mode", "prompt", "stop_hook_active", "turn_id",
  ],
  max_bytes: 64 * 1024,
};

const sessionStart = {
  cwd: "/w",
  hook_event_name: "SessionStart",
  session_id: "s1",
  source: "startup",
  transcript_path: "/t.jsonl",
};
const stop = { cwd: "/w", hook_event_name: "Stop", session_id: "s1", transcript_path: "/t.jsonl" };

function ok(raw: string, shape: HookInputShape) {
  const result = parseHookInputShape(raw, shape);
  assert.equal(result.ok, true, `expected ok for ${raw.slice(0, 80)}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function reason(raw: string, shape: HookInputShape): string {
  const result = parseHookInputShape(raw, shape);
  assert.equal(result.ok, false, `expected a refusal for ${raw.slice(0, 80)}`);
  if (result.ok) throw new Error("unreachable");
  return result.reason;
}

function main(): void {
  // Host-added keys seen with Claude Code 2.1.321 (names only; every value here is a dummy).
  const live321 = [
    { shape: SESSION_START, base: sessionStart, extra: { session_title: MARKER } },
    {
      shape: STOP,
      base: { ...stop, hook_event_name: "UserPromptSubmit" },
      extra: { prompt_id: MARKER, session_title: MARKER },
    },
    {
      shape: STOP,
      base: stop,
      extra: { background_tasks: [MARKER], effort: MARKER, prompt_id: MARKER, session_crons: { x: MARKER } },
    },
  ];
  for (const { shape, base, extra } of live321) {
    const result = ok(JSON.stringify({ ...base, ...extra }), shape);
    assert.deepEqual([...result.ignored_names], Object.keys(extra).sort());
    for (const key of Object.keys(extra)) assert.equal(result.fields.has(key), false);
    assert.equal(JSON.stringify([...result.fields.entries()]).includes(MARKER), false);
    assert.equal(JSON.stringify(result).includes(MARKER), false, "an unknown key's value is never carried");
    assert.deepEqual([...result.fields.keys()].sort(), Object.keys(base).sort());
  }

  // Known keys: required and optional that the input owns are returned as read.
  const withOptional = ok(JSON.stringify({ ...sessionStart, model: "m", permission_mode: "plan", agent_type: "a" }), SESSION_START);
  assert.deepEqual([...withOptional.ignored_names], []);
  assert.equal(withOptional.fields.get("model"), "m");
  assert.equal(withOptional.fields.get("source"), "startup");
  assert.equal(ok(JSON.stringify(sessionStart), SESSION_START).fields.has("model"), false, "an absent optional key stays absent");
  // A known key with a wrong type is not judged here: the entry owns the type rules.
  assert.equal(ok(JSON.stringify({ ...sessionStart, model: null }), SESSION_START).fields.get("model"), null);

  // Names come back in dictionary order, whatever the input order was.
  const unordered = ok(JSON.stringify({ zeta: 1, ...stop, alpha: 2, mid: 3 }), STOP);
  assert.deepEqual([...unordered.ignored_names], ["alpha", "mid", "zeta"]);

  // __proto__ and friends are own properties of the parsed JSON; they must not reach a prototype.
  const proto = ok(`{"__proto__":{"polluted":"${MARKER}"},"cwd":"/w","hook_event_name":"Stop","session_id":"s","transcript_path":"/t"}`, STOP);
  assert.deepEqual([...proto.ignored_names], ["__proto__"]);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.getPrototypeOf(proto.fields), Map.prototype);
  assert.equal(JSON.stringify(proto).includes(MARKER), false);
  const inherited = ok(JSON.stringify(stop), { ...STOP, optional: [...STOP.optional, "toString", "constructor"] });
  assert.equal(inherited.fields.has("toString"), false, "an inherited property is not an own key of the input");
  assert.equal(inherited.fields.has("constructor"), false);

  // Pure: the same input gives the same result and the shape is not changed.
  const before = JSON.stringify(STOP);
  const a = parseHookInputShape(JSON.stringify({ ...stop, extra: 1 }), STOP);
  const b = parseHookInputShape(JSON.stringify({ ...stop, extra: 1 }), STOP);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(STOP), before);

  // Refusals that stay as they were.
  assert.equal(reason("{", STOP), "not_json");
  assert.equal(reason("not json", STOP), "not_json");
  assert.equal(reason("", STOP), "not_json");
  for (const raw of ["[]", "[{}]", "1", "null", "true", "\"x\""]) assert.equal(reason(raw, STOP), "not_object");
  assert.equal(reason("{}", STOP), "missing_required");
  for (const [shape, base] of [[SESSION_START, sessionStart], [STOP, stop]] as const) {
    for (const key of shape.required) {
      const input: Record<string, unknown> = { ...base, extra_key: MARKER };
      delete input[key];
      assert.equal(reason(JSON.stringify(input), shape), "missing_required", `${key} removed`);
    }
  }
  // A required key that is present with a null value is present (the entry judges the type).
  assert.equal(ok(JSON.stringify({ ...stop, cwd: null }), STOP).fields.get("cwd"), null);

  // The size limit is on UTF-8 bytes, boundary included.
  const padded = (bytes: number): string => {
    const raw = JSON.stringify({ ...stop, pad: "" });
    return JSON.stringify({ ...stop, pad: "x".repeat(bytes - Buffer.byteLength(raw, "utf8")) });
  };
  assert.equal(Buffer.byteLength(padded(64 * 1024), "utf8"), 64 * 1024);
  ok(padded(64 * 1024), STOP);
  assert.equal(reason(padded(64 * 1024 + 1), STOP), "too_large");
  assert.equal(reason(" ".repeat(64 * 1024 + 1), STOP), "too_large");
  assert.equal(reason(JSON.stringify({ ...stop, pad: "あ".repeat(30_000) }), STOP), "too_large", "multi-byte text counts as bytes");
  assert.equal(reason(padded(200), { ...STOP, max_bytes: 100 }), "too_large");

  // The three entries share this one function (FR10.1): a static check of the sources.
  const read = (file: string) => readFileSync(join(repositoryRoot, "src", file), "utf8");
  const claude = read("claude-session-start.ts");
  const capture = read("transcript-stop-capture.ts");
  const rotation = read("session-rotation-stop.ts");
  const hookInput = read("hook-input.ts");
  assert.match(claude, /from "\.\/hook-input\.js"/);
  assert.match(claude, /parseHookInputShape\(/);
  assert.match(capture, /from "\.\/hook-input\.js"/);
  assert.match(capture, /parseHookInputShape\(/);
  assert.doesNotMatch(claude, /Object\.keys\(input\)/, "the outer shape is not kept in a second place");
  assert.doesNotMatch(capture, /Object\.keys\(value\)\.some/, "the outer shape is not kept in a second place");
  assert.match(rotation, /parseTranscriptStopInputWithIgnored/);
  assert.doesNotMatch(rotation, /\bparseTranscriptStopInput\(/, "the rotation entry reads through the sibling that reports names");
  // Pure core: no clock, no environment, no file, no randomness (standard S4).
  assert.doesNotMatch(hookInput, /Date\.now|new Date|Math\.random|randomUUID|process\.env|from "node:(fs|os|child_process)/);

  process.stdout.write("hook input shape tests passed\n");
}

main();
