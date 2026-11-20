/**
 * The tool surface of the common-infrastructure form (u1-seat-memory-skeleton, PR-2, Step 11; BR3.2, BR3.5, BR5.1,
 * BR5.2): `log_decision` and `get_decisions` reach the database through the seat's store, every other tool answers
 * `not_yet_available` and never reaches it, the call record holds a tool name, record ids, a time and a result only,
 * and a failure is told by name and code without a value. Also that the real MCP server keeps one definition of each
 * tool and only its handler is replaced, and that the public tool names in `index.ts` and the surface do not drift.
 * The database is a fake window; the real SQL is tried by test-common-seat-pg.ts (by hand).
 */
import "./test-isolated-home.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { failingStore } from "./common-entry.js";
import { RESPONSE_LOST_NOTE, failure } from "./common-seat-errors.js";
import { SeatSetting } from "./common-placement.js";
import { createCommonSeatStore } from "./common-seat-store.js";
import { COMMON_TOOLS, callRecordLine, createCommonSurface, describeFailure, redactDecisionFields, withCommonForm } from "./common-seat-surface.js";
import { idSequence } from "./test-common-seat-entry-support.js";
import { DECISION_TEXT, FAKE_OBSERVED_AT_MS, FakeDb, SECRET_PASSWORD, SEAT_A, dbError, networkError } from "./test-common-seat-support.js";

const NOW = FAKE_OBSERVED_AT_MS;

function surfaceOver(db: FakeDb, options: { record?: (line: string) => Promise<void>; defaultProject?: string } = {}) {
  const lines: string[] = [];
  const surface = createCommonSurface({
    store: createCommonSeatStore({ client: db, seat: new SeatSetting(SEAT_A), now: () => NOW }),
    now: () => NOW,
    newId: idSequence("3"),
    record: options.record ?? (async (line) => void lines.push(line)),
    defaultProject: options.defaultProject,
  });
  return { surface, lines };
}
const textOf = (reply: { content: Array<{ text: string }> }): string => reply.content.map((c) => c.text).join("\n");

const cases: Array<[string, () => Promise<void>]> = [];

cases.push(["log_decision writes one decision for the seat, gives its id, and get_decisions reads it back with its tags", async () => {
  const db = new FakeDb();
  const { surface, lines } = surfaceOver(db, { defaultProject: "agent-memory" });
  const wrote = await surface.call("log_decision", { decision: DECISION_TEXT, context: "why", tags: ["alpha", "beta"] });
  assert.equal(wrote.isError, undefined);
  assert.match(textOf(wrote), /^Decision logged \(id: 0badc0de-0000-4000-8000-00000000003[0-9a-f]\)$/);
  const rows = db.decisions();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].project_name, rows[0].tags, rows[0].seat_ref], ["agent-memory", ["alpha", "beta"], SEAT_A.seat_id]);
  const read = await surface.call("get_decisions", { tags: ["alpha"], limit: 5 });
  assert.equal(read.isError, undefined);
  assert.match(textOf(read), /1 decision\(s\):/);
  assert.ok(textOf(read).includes(DECISION_TEXT) && textOf(read).includes("Context: why") && textOf(read).includes("Tags: alpha, beta"));
  assert.equal(lines.length, 2);
}]);

cases.push(["get_decisions answers 'No decisions found.' for a seat with none, and shows a decision without context or tags", async () => {
  const db = new FakeDb();
  const { surface } = surfaceOver(db);
  assert.equal(textOf(await surface.call("get_decisions", {})), "No decisions found.");
  await surface.call("log_decision", { decision: "a bare decision" });
  const read = textOf(await surface.call("get_decisions", { status: "active" }));
  assert.ok(read.includes("[active] a bare decision") && !read.includes("Context:") && !read.includes("Tags:"));
}]);

const KEY_BEGIN = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
const KEY_END = ["-----END", "PRIVATE KEY-----"].join(" ");

cases.push(["a pair of key markers in two decisions does not take the decisions between them from the get_decisions reply", async () => {
  const db = new FakeDb();
  const { surface } = surfaceOver(db);
  for (const [decision, context] of [[KEY_END, "CONTEXT-OLDEST"], ["a plain decision in the middle", "CONTEXT-MIDDLE"], [KEY_BEGIN, "CONTEXT-NEWEST"]]) {
    await surface.call("log_decision", { decision, context });
  }
  const reply = textOf(await surface.call("get_decisions", {}));
  assert.match(reply, /^3 decision\(s\):/);
  assert.equal([...reply.matchAll(/^ {3}ID: /gm)].length, 3, "every decision keeps its own id line");
  for (const kept of ["CONTEXT-OLDEST", "CONTEXT-MIDDLE", "CONTEXT-NEWEST", "a plain decision in the middle"]) assert.ok(reply.includes(kept), kept);
  assert.equal([...reply.matchAll(/^ {3}Context: /gm)].length, 3);
  assert.ok(!reply.includes("withheld decisions"), "a lone marker takes nothing, so no decision is withheld");
}]);

cases.push(["a secret over several lines, or one in a tag, is removed from its own field only, and one over the text and the context of a decision is withheld in both", async () => {
  const db = new FakeDb();
  const { surface } = surfaceOver(db);
  await surface.call("log_decision", { decision: `rotate\n${KEY_BEGIN}\nSYNTH-KEY-BODY-1\n${KEY_END}\nthen restart`, context: "Bearer\nSYNTH-BEARER-VALUE-2", tags: ["plain-one", "API_TOKEN=SYNTH-TAG-OWN-5"] });
  await surface.call("log_decision", { decision: "Bearer", context: "SYNTH-SPAN-VALUE-4" });
  await surface.call("log_decision", { decision: "untouched decision", context: "untouched context", tags: ["plain"] });
  const reply = textOf(await surface.call("get_decisions", {}));
  for (const value of ["SYNTH-KEY-BODY-1", "SYNTH-BEARER-VALUE-2", "SYNTH-SPAN-VALUE-4", "SYNTH-TAG-OWN-5"]) assert.ok(!reply.includes(value), value);
  assert.ok(reply.includes("untouched decision") && reply.includes("untouched context") && reply.includes("Tags: plain\n"));
  assert.ok(reply.includes("rotate") && reply.includes("then restart"), "the key is removed from its own field only");
  assert.ok(reply.includes("Tags: API_TOKEN=[REDACTED], plain-one\n"), "a secret that is inside one tag is removed from that tag only");
  assert.match(reply, /\[active\] \[REDACTED\]\n {3}Context: \[REDACTED\]\n {3}ID: /, "a secret over the text and the context withholds both");
  assert.equal([...reply.matchAll(/^ {3}ID: /gm)].length, 3);
  assert.match(reply, /^3 decision\(s\):\nwithheld decisions: 1;/, "the number of withheld decisions is stated before the list");
}]);

const SPAN_NEIGHBORS = ["neighbor before", "CONTEXT-BEFORE", "neighbor after", "CONTEXT-AFTER"];

/** One decision whose secret runs across its fields, between two plain decisions: the reply of get_decisions. */
async function replyWithSpanned(entry: { decision: string; context?: string; tags: string[] }): Promise<string> {
  const db = new FakeDb();
  const { surface } = surfaceOver(db);
  await surface.call("log_decision", { decision: "neighbor before", context: "CONTEXT-BEFORE", tags: ["near"] });
  assert.equal((await surface.call("log_decision", entry)).isError, undefined);
  await surface.call("log_decision", { decision: "neighbor after", context: "CONTEXT-AFTER", tags: ["near"] });
  const reply = textOf(await surface.call("get_decisions", {}));
  assert.match(reply, /^3 decision\(s\):\nwithheld decisions: 1;/);
  assert.equal([...reply.matchAll(/^ {3}ID: /gm)].length, 3, "every decision keeps its own id line");
  for (const kept of SPAN_NEIGHBORS) assert.ok(reply.includes(kept), kept);
  return reply;
}

cases.push(["a secret that starts in the text and ends in a tag of one decision is withheld from every field of that decision (BF-2)", async () => {
  const reply = await replyWithSpanned({ decision: `${KEY_BEGIN}\nSYNTH-SPAN-BODY-A`, tags: [KEY_END] });
  assert.ok(!reply.includes("SYNTH-SPAN-BODY-A"));
  assert.ok(reply.includes("[active] [REDACTED]\n   Tags: [REDACTED]\n   ID: "), "the text and the tag are replaced and the id stays");
}]);

// The store keeps the tags of a decision in sorted order, so the A, B and C in front make them read begin, body, end.
cases.push(["a secret that starts in one tag and ends in another tag of one decision is withheld from every field of that decision (BF-2)", async () => {
  const reply = await replyWithSpanned({ decision: "SYNTH-TEXT-B plain words", tags: [`A ${KEY_BEGIN}`, "B SYNTH-SPAN-BODY-B", `C ${KEY_END}`] });
  for (const value of ["SYNTH-SPAN-BODY-B", "SYNTH-TEXT-B"]) assert.ok(!reply.includes(value), value);
  assert.ok(reply.includes("[active] [REDACTED]\n   Tags: [REDACTED], [REDACTED], [REDACTED]\n   ID: "), "the text and each tag are replaced, in their places");
}]);

cases.push(["a secret that starts in the context and ends in a tag of one decision is withheld from every field of that decision (BF-2)", async () => {
  const reply = await replyWithSpanned({ decision: "SYNTH-TEXT-C plain words", context: `${KEY_BEGIN}\nSYNTH-SPAN-BODY-C`, tags: [KEY_END] });
  for (const value of ["SYNTH-SPAN-BODY-C", "SYNTH-TEXT-C"]) assert.ok(!reply.includes(value), value);
  assert.ok(reply.includes("[active] [REDACTED]\n   Context: [REDACTED]\n   Tags: [REDACTED]\n   ID: "), "the text, the context and the tag are replaced");
}]);

cases.push(["a decision whose fields read differently together than alone is withheld and counted at least once, an ordinary one is not", () => {
  const plain = redactDecisionFields("plain words", "more words", ["a", "b"]);
  assert.deepEqual([plain.withheld, plain.count, plain.decision, plain.context, plain.tags], [false, 0, "plain words", "more words", ["a", "b"]]);
  // "1111 1111 1111" alone reads as a telephone number; after another digit group on the line before it does not, so the two readings differ.
  const differs = redactDecisionFields("ticket 4111", null, ["1111 1111 1111"]);
  assert.deepEqual([differs.withheld, differs.count, differs.decision, differs.context, differs.tags], [true, 1, "[REDACTED]", null, ["[REDACTED]"]]);
}]);

cases.push(["a tool U1 does not have, and a status other than active, answer not_yet_available and never reach the database", async () => {
  const db = new FakeDb();
  const { surface, lines } = surfaceOver(db);
  for (const tool of ["save_task_state", "search_memory", "supersede_decision", "recover_context", "not a tool name!"]) {
    const reply = await surface.call(tool, { anything: 1 });
    assert.equal(reply.isError, true);
    assert.match(textOf(reply), /not_yet_available \(input\)/);
  }
  for (const status of ["superseded", "all"]) {
    const reply = await surface.call("get_decisions", { status });
    assert.equal(reply.isError, true);
    assert.match(textOf(reply), /Failed to get decisions: not_yet_available/);
  }
  assert.equal(db.connects, 0);
  assert.deepEqual(db.statements, []);
  assert.deepEqual(db.decisions(), []);
  assert.ok(lines.every((line) => line.endsWith("outcome=error:not_yet_available")));
  assert.ok(lines[4].includes("  unknown  "), "a name that is not a tool name is recorded as 'unknown', never as given");
}]);

cases.push(["the call record holds the tool name, the record ids, the time and the result, and never the decision text or a value", async () => {
  const db = new FakeDb();
  const { surface, lines } = surfaceOver(db);
  await surface.call("log_decision", { decision: DECISION_TEXT, context: "CONTEXT-SYNTHETIC-77", tags: ["TAG-SYNTHETIC-88"] });
  db.faults.connect = networkError("ECONNREFUSED");
  await surface.call("get_decisions", {});
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^2027-01-15T[0-9:.]+Z {2}log_decision {2}entry=\S+ refs=0badc0de-0000-4000-8000-00000000003[0-9a-f] outcome=ok$/);
  assert.match(lines[1], / {2}get_decisions {2}entry=\S+ refs=- outcome=error:placement_unreachable$/);
  for (const line of lines) {
    for (const secret of [DECISION_TEXT, "CONTEXT-SYNTHETIC-77", "TAG-SYNTHETIC-88", SECRET_PASSWORD]) assert.ok(!line.includes(secret));
  }
  assert.equal(callRecordLine({ at: NOW, tool: "x", entryRef: "e", refs: [], outcome: failure(null, "bad_response") }).endsWith("outcome=error:unnamed_failure"), true);
}]);

cases.push(["a failure reaches the person by name, kind and code only; a lost answer says so and names the attempted id", async () => {
  const db = new FakeDb();
  const { surface, lines } = surfaceOver(db);
  db.faults.select = dbError("OC004", "onza-common:not_found");
  const refused = await surface.call("log_decision", { decision: DECISION_TEXT });
  assert.equal(refused.isError, true);
  assert.equal(textOf(refused), "Failed to log decision: seat_not_registered (refused, OC004)");
  db.faults.commit = { error: networkError("ECONNRESET"), applied: true };
  const lost = textOf(await surface.call("log_decision", { decision: DECISION_TEXT }));
  assert.ok(lost.includes("placement_unreachable (response_lost") && lost.includes(RESPONSE_LOST_NOTE) && /Attempted id: 0badc0de-/.test(lost));
  assert.match(lines[1], /refs=0badc0de-0000-4000-8000-00000000003[0-9a-f] outcome=error:placement_unreachable$/);
  db.faults.select = dbError("ZZ999", `driver text with ${SECRET_PASSWORD}`);
  const odd = textOf(await surface.call("get_decisions", {}));
  assert.equal(odd, "Failed to get decisions: unnamed_failure (unmapped, ZZ999)");
  assert.equal(describeFailure(failure("not_initialized", "refused", "3F000")), "not_initialized (refused, 3F000)");
}]);

cases.push(["a decision that is not text is an invalid input and nothing is written; a failing call record never changes the answer", async () => {
  const db = new FakeDb();
  const { surface } = surfaceOver(db, { record: async () => Promise.reject(new Error("disk is full")) });
  const reply = await surface.call("log_decision", { decision: 42 });
  assert.equal(textOf(reply), "Failed to log decision: invalid_input (input)");
  assert.deepEqual(db.decisions(), []);
  const ok = await surface.call("log_decision", { decision: "fine" });
  assert.equal(ok.isError, undefined);
  assert.equal((await surface.call("log_decision", "not an object")).isError, true);
}]);

cases.push(["a seat whose place or setting cannot be used gets the same failure from every tool, and no database is touched", async () => {
  const cause = failure("placement_unset", "placement", "target_missing");
  const surface = createCommonSurface({ store: failingStore(cause), now: () => NOW, newId: idSequence("3"), record: async () => undefined });
  for (const tool of ["log_decision", "get_decisions"]) {
    assert.equal(textOf(await surface.call(tool, { decision: "x" })).endsWith("placement_unset (placement, target_missing)"), true);
  }
  assert.deepEqual(await failingStore(cause).recoverDecisions({ limit: 1 }), cause);
}]);

cases.push(["the real MCP server keeps one definition of each tool: only the handler is replaced, and no standalone handler runs", async () => {
  const standaloneRan: string[] = [];
  const server = new McpServer({ name: "wasurezu", version: "test" });
  const db = new FakeDb();
  const { surface } = surfaceOver(db);
  const wrapped = withCommonForm(server, surface);
  wrapped.tool("log_decision", "Save a decision", { decision: z.string(), tags: z.array(z.string()).optional() }, async () => {
    standaloneRan.push("log_decision");
    return { content: [{ type: "text" as const, text: "standalone" }] };
  });
  wrapped.tool("save_task_state", "Save the work state", { state: z.string() }, async () => {
    standaloneRan.push("save_task_state");
    return { content: [{ type: "text" as const, text: "standalone" }] };
  });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([wrapped.connect(serverSide), client.connect(clientSide)]);
  const listed = (await client.listTools()).tools;
  assert.deepEqual(listed.map((tool) => tool.name).sort(), ["log_decision", "save_task_state"]);
  assert.deepEqual(Object.keys(listed.find((tool) => tool.name === "log_decision")?.inputSchema.properties ?? {}).sort(), ["decision", "tags"]);
  const wrote = await client.callTool({ name: "log_decision", arguments: { decision: "through the server", tags: ["t"] } });
  assert.match(JSON.stringify(wrote.content), /Decision logged/);
  const unavailable = await client.callTool({ name: "save_task_state", arguments: { state: "x" } });
  assert.equal(unavailable.isError, true);
  assert.match(JSON.stringify(unavailable.content), /not_yet_available/);
  assert.deepEqual(standaloneRan, []);
  assert.equal(db.decisions().length, 1);
  assert.equal(wrapped.server, server.server, "a property that is not a function is passed through as it is");
  await client.close();
}]);

cases.push(["the tools the surface serves exist in index.ts, and every other tool index.ts registers is answered not_yet_available", async () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const registered = [...source.matchAll(/server\.tool\(\s*"([a-z_]+)"/g)].map((match) => match[1]);
  assert.equal(registered.length, 17);
  assert.deepEqual([...COMMON_TOOLS].filter((name) => !registered.includes(name)), []);
  const db = new FakeDb();
  const { surface } = surfaceOver(db);
  for (const name of registered.filter((tool) => !(COMMON_TOOLS as readonly string[]).includes(tool))) {
    assert.match(textOf(await surface.call(name, {})), /not_yet_available/, name);
  }
  assert.equal(db.connects, 0);
}]);

let passed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}
console.log(process.exitCode === 1 ? `common-seat-surface: ${cases.length - passed} of ${cases.length} checks failed` : `common-seat-surface: ${passed} checks passed`);
