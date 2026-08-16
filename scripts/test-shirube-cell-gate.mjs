#!/usr/bin/env node
/**
 * Fixtures for the deterministic Shirube cell-conformance gate.
 * Control source: https://github.com/watchout/agent-memory/issues/301
 */
import assert from "node:assert/strict";
import { evaluateCellGate, matchesGlob, isTestPath, selectHandoff, HANDOFF_SCHEMA } from "./shirube-cell-gate.mjs";

const BASE = "b".repeat(40);
const HEAD = "h".repeat(40);

const POLICY = {
  protected_surfaces: [".github/workflows/**", "db/migrations/**", "docs/design/schemas/**"],
};

function handoff(overrides = {}) {
  const cell = {
    cell_id: "D-01-FIXTURE",
    risk_class: "R1",
    allowed_paths: ["src/redact.ts", "src/test.ts"],
    exact_subject: { base_sha: BASE, head_sha: HEAD, changed_file_count: 2, commit_count: 2 },
    ...(overrides.cell ?? {}),
  };
  return {
    schema_version: HANDOFF_SCHEMA,
    control_source: { decision_ref: "https://github.com/watchout/agent-memory/issues/301" },
    ...overrides,
    cell,
  };
}

function observed(overrides = {}) {
  return {
    base: BASE,
    head: HEAD,
    changedPaths: ["src/redact.ts", "src/test.ts"],
    commitCount: 2,
    ...overrides,
  };
}

function run(name, fn) {
  fn();
  console.log(`  ok  ${name}`);
}

// glob semantics the predicates rely on
run("glob matches an exact path", () => assert.equal(matchesGlob("src/a.ts", "src/a.ts"), true));
run("glob star stays inside one segment", () => {
  assert.equal(matchesGlob("src/a.ts", "src/*.ts"), true);
  assert.equal(matchesGlob("src/deep/a.ts", "src/*.ts"), false);
});
run("glob doublestar spans segments", () => {
  assert.equal(matchesGlob(".github/workflows/ci.yml", ".github/workflows/**"), true);
  assert.equal(matchesGlob("db/migrations/2026-01-01.sql", "db/migrations/**"), true);
  assert.equal(matchesGlob("db/other.sql", "db/migrations/**"), false);
});
run("test paths are recognised", () => {
  assert.equal(isTestPath("src/test.ts"), true);
  assert.equal(isTestPath("src/test-codex-session-start.ts"), true);
  assert.equal(isTestPath("tests/a.mjs"), true);
  assert.equal(isTestPath("src/redact.ts"), false);
});

// GATE-01 conforming change passes
run("GATE-01 a conforming change passes with no blockers", () => {
  const r = evaluateCellGate({ handoff: handoff(), policy: POLICY, observed: observed() });
  assert.equal(r.verdict, "PASS");
  assert.equal(r.blocker_count, 0);
  assert.equal(r.cell_id, "D-01-FIXTURE");
  assert.ok(r.asserts.includes("does not replace"), "the verdict states its own limits");
});

// GATE-02 path outside allowed_paths blocks and names the path
run("GATE-02 an undeclared path blocks and is named", () => {
  const r = evaluateCellGate({
    handoff: handoff(),
    policy: POLICY,
    observed: observed({ changedPaths: ["src/redact.ts", "src/test.ts", "src/secret.ts"], commitCount: 2 }),
  });
  assert.equal(r.verdict, "BLOCK");
  const b = r.blockers.find(x => x.code === "PATH_OUTSIDE_ALLOWED");
  assert.ok(b && b.detail.includes("src/secret.ts"), "the offending path is named");
});

// GATE-03 head binding
run("GATE-03 a head mismatch blocks", () => {
  const r = evaluateCellGate({ handoff: handoff(), policy: POLICY, observed: observed({ head: "x".repeat(40) }) });
  assert.equal(r.verdict, "BLOCK");
  assert.ok(r.blockers.some(x => x.code === "EXACT_SUBJECT_MISMATCH"));
});

run("GATE-03 an absent head declaration leaves the head unbound but does not block", () => {
  const h = handoff();
  delete h.cell.exact_subject.head_sha;
  const r = evaluateCellGate({ handoff: h, policy: POLICY, observed: observed() });
  assert.equal(r.verdict, "PASS", "a handoff cannot name the commit that contains it");
  assert.equal(r.head_binding, "unbound");
});
run("GATE-03 a declared head still binds exactly", () => {
  const r = evaluateCellGate({ handoff: handoff(), policy: POLICY, observed: observed() });
  assert.equal(r.head_binding, "declared");
});
run("GATE-03 a base mismatch blocks even when the head is unbound", () => {
  const h = handoff();
  delete h.cell.exact_subject.head_sha;
  const r = evaluateCellGate({ handoff: h, policy: POLICY, observed: observed({ base: "z".repeat(40) }) });
  assert.equal(r.verdict, "BLOCK");
  assert.ok(r.blockers.some(x => x.code === "EXACT_SUBJECT_MISMATCH"));
});

// handoff selection
run("SELECT a head-bound handoff wins", () => {
  const bound = handoff();
  const other = handoff({ cell: { cell_id: "OTHER", exact_subject: { base_sha: BASE } } });
  assert.equal(selectHandoff([other, bound], { base: BASE, head: HEAD }).handoff, bound);
});
run("SELECT a single base-bound handoff is used when no head is declared", () => {
  const h = handoff();
  delete h.cell.exact_subject.head_sha;
  const r = selectHandoff([h], { base: BASE, head: HEAD });
  assert.equal(r.handoff, h);
  assert.equal(r.reason, "base_bound");
});
run("SELECT two unbound handoffs for the same base are ambiguous, not silently resolved", () => {
  const a = handoff(); delete a.cell.exact_subject.head_sha;
  const b = handoff({ cell: { cell_id: "B", exact_subject: { base_sha: BASE } } });
  const r = selectHandoff([a, b], { base: BASE, head: HEAD });
  assert.equal(r.handoff, null);
  assert.equal(r.reason, "ambiguous");
});
run("SELECT no candidate reports absent", () => {
  assert.equal(selectHandoff([], { base: BASE, head: HEAD }).reason, "absent");
});

// GATE-04 protected surfaces
run("GATE-04 an undeclared protected surface blocks", () => {
  const r = evaluateCellGate({
    handoff: handoff(),
    policy: POLICY,
    observed: observed({ changedPaths: [".github/workflows/ci.yml"], commitCount: 2 }),
  });
  assert.equal(r.verdict, "BLOCK");
  assert.ok(r.blockers.some(x => x.code === "PROTECTED_SURFACE_UNDECLARED"));
});
run("GATE-04 a declared protected surface still demands the owner gate", () => {
  const r = evaluateCellGate({
    handoff: handoff({ cell: { allowed_paths: [".github/workflows/ci.yml"], exact_subject: { base_sha: BASE, head_sha: HEAD, changed_file_count: 1, commit_count: 1 } } }),
    policy: POLICY,
    observed: observed({ changedPaths: [".github/workflows/ci.yml"], commitCount: 1 }),
  });
  assert.equal(r.verdict, "PASS", "declaring the surface clears the mechanical predicate");
  const owner = r.checks.find(c => c.id === "PROTECTED-02");
  assert.ok(owner && owner.verdict === "OWNER_GATE_REQUIRED", "the owner gate is still recorded as required");
});

// GATE-05 test coupling
run("GATE-05 a source change without a test change blocks", () => {
  const r = evaluateCellGate({
    handoff: handoff({ cell: { allowed_paths: ["src/redact.ts"], exact_subject: { base_sha: BASE, head_sha: HEAD, changed_file_count: 1, commit_count: 1 } } }),
    policy: POLICY,
    observed: observed({ changedPaths: ["src/redact.ts"], commitCount: 1 }),
  });
  assert.equal(r.verdict, "BLOCK");
  assert.ok(r.blockers.some(x => x.code === "TEST_COUPLING_ABSENT"));
});
run("GATE-05 a declared exemption with a reason passes", () => {
  const r = evaluateCellGate({
    handoff: handoff({
      cell: {
        allowed_paths: ["src/redact.ts"],
        test_coupling_exempt: "comment-only change, covered by the existing suite",
        exact_subject: { base_sha: BASE, head_sha: HEAD, changed_file_count: 1, commit_count: 1 },
      },
    }),
    policy: POLICY,
    observed: observed({ changedPaths: ["src/redact.ts"], commitCount: 1 }),
  });
  assert.equal(r.verdict, "PASS");
});
run("GATE-05 an empty exemption does not count", () => {
  const r = evaluateCellGate({
    handoff: handoff({
      cell: {
        allowed_paths: ["src/redact.ts"],
        test_coupling_exempt: "   ",
        exact_subject: { base_sha: BASE, head_sha: HEAD, changed_file_count: 1, commit_count: 1 },
      },
    }),
    policy: POLICY,
    observed: observed({ changedPaths: ["src/redact.ts"], commitCount: 1 }),
  });
  assert.equal(r.verdict, "BLOCK");
});

// GATE-06 missing or malformed handoff
run("GATE-06 an absent handoff blocks rather than passing silently", () => {
  const r = evaluateCellGate({ handoff: null, policy: POLICY, observed: observed() });
  assert.equal(r.verdict, "BLOCK");
  assert.ok(r.blockers.some(x => x.code === "HANDOFF_ABSENT"));
});
run("GATE-06 a handoff without a control source blocks", () => {
  const h = handoff();
  delete h.control_source;
  const r = evaluateCellGate({ handoff: h, policy: POLICY, observed: observed() });
  assert.equal(r.verdict, "BLOCK");
  assert.ok(r.blockers.some(x => x.code === "CONTROL_SOURCE_ABSENT"));
});
run("GATE-06 an unrecognised schema blocks", () => {
  const r = evaluateCellGate({ handoff: handoff({ schema_version: "something-else/v9" }), policy: POLICY, observed: observed() });
  assert.equal(r.verdict, "BLOCK");
  assert.ok(r.blockers.some(x => x.code === "HANDOFF_MALFORMED"));
});

// GATE-07 declared shape
run("GATE-07 a declared file or commit count mismatch blocks", () => {
  const r = evaluateCellGate({ handoff: handoff(), policy: POLICY, observed: observed({ commitCount: 5 }) });
  assert.equal(r.verdict, "BLOCK");
  assert.ok(r.blockers.some(x => x.code === "DECLARED_SHAPE_MISMATCH"));
});

// GATE-08 verdict shape
run("GATE-08 the verdict names the exact head it is bound to", () => {
  const r = evaluateCellGate({ handoff: handoff(), policy: POLICY, observed: observed() });
  assert.equal(r.exact_subject.head, HEAD);
  assert.equal(r.exact_subject.base, BASE);
  assert.equal(r.schema_version, "shirube-cell-gate-result/v1");
  assert.ok(Array.isArray(r.checks) && r.checks.length >= 6, "every predicate is reported, not only failures");
});

console.log("shirube cell gate tests passed");
