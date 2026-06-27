#!/usr/bin/env node
/**
 * Spec-as-test: agent-comms ↔ wasurezu tool/field contract.
 *
 * Verifies that post-tool-hook.ts references only the current agent-comms
 * tool name and field name, not retired names from before PR#117.
 *
 * Background: PR#64/PR#73 incident — hook matched old tool name
 * (`mcp__agent-comms__reply`) and old field (`text`) after agent-comms
 * renamed them. This test catches that class of regression at CI time.
 *
 * Run: npx tsx tests/spec-enforcement/anti-regression-agent-comms-contract.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_COMMS_SEND_TOOL,
  AGENT_COMMS_CONTENT_FIELD,
  AGENT_COMMS_RETIRED_TOOLS,
  AGENT_COMMS_RETIRED_FIELDS,
} from "../../src/agent-comms-contract.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗  ${msg}`);
    failed++;
  }
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const hookSrc = readFileSync(join(ROOT, "src/post-tool-hook.ts"), "utf8");
const hookTemplate = readFileSync(join(ROOT, "templates/hooks-example.jsonc"), "utf8");
const apiContract = readFileSync(join(ROOT, "docs/design/core/SSOT-3_API_CONTRACT.md"), "utf8");

// ── Contract constants are defined ────────────────────────────────────────
assert(
  typeof AGENT_COMMS_SEND_TOOL === "string" && AGENT_COMMS_SEND_TOOL.length > 0,
  "AGENT_COMMS_SEND_TOOL is a non-empty string"
);
assert(
  typeof AGENT_COMMS_CONTENT_FIELD === "string" && AGENT_COMMS_CONTENT_FIELD.length > 0,
  "AGENT_COMMS_CONTENT_FIELD is a non-empty string"
);

// ── post-tool-hook uses contract constant, not a bare string literal ──────
assert(
  hookSrc.includes("AGENT_COMMS_SEND_TOOL"),
  "post-tool-hook.ts references AGENT_COMMS_SEND_TOOL constant"
);
assert(
  hookSrc.includes("AGENT_COMMS_CONTENT_FIELD"),
  "post-tool-hook.ts references AGENT_COMMS_CONTENT_FIELD constant"
);

// ── post-tool-hook does NOT hardcode the current tool/field as bare literals
//    (would pass on rename; constant reference would fail, catching the bug) ─
assert(
  !hookSrc.includes(`"${AGENT_COMMS_SEND_TOOL}"`),
  "post-tool-hook.ts does not hardcode current send tool name as a string literal"
);

// ── post-tool-hook does NOT reference retired tool names ─────────────────
for (const retired of AGENT_COMMS_RETIRED_TOOLS) {
  assert(
    !hookSrc.includes(`"${retired}"`),
    `post-tool-hook.ts does not reference retired tool: ${retired}`
  );
}

// ── post-tool-hook does NOT reference retired field names in MCP path ─────
// The word `text` appears legitimately in prose and local variable names, so
// check retired field access patterns rather than bare string presence.
for (const retiredField of AGENT_COMMS_RETIRED_FIELDS) {
  // Check for patterns like `?.text` or `["text"]` in the MCP path block
  // (allow in comments, which start with //)
  const lines = hookSrc.split("\n");
  const codeLines = lines.filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
  const hasRetiredFieldAccess = codeLines.some(
    (l) => l.includes(`?.${retiredField}`) || l.includes(`["${retiredField}"]`) || l.includes(`['${retiredField}']`)
  );
  assert(
    !hasRetiredFieldAccess,
    `post-tool-hook.ts does not access retired field .${retiredField} in code paths`
  );
}

// ── Operator-facing examples use the current contract ───────────────────
for (const [name, src] of [
  ["templates/hooks-example.jsonc", hookTemplate],
  ["docs/design/core/SSOT-3_API_CONTRACT.md", apiContract],
] as const) {
  assert(
    src.includes(`"matcher": "${AGENT_COMMS_SEND_TOOL}"`),
    `${name} config example matches current send tool`
  );
  assert(
    src.includes(AGENT_COMMS_CONTENT_FIELD),
    `${name} documents the current content field`
  );
  for (const retired of AGENT_COMMS_RETIRED_TOOLS) {
    assert(
      !src.includes(`"matcher": "${retired}`) && !src.includes(`|${retired}`),
      `${name} does not use retired tool in matcher examples: ${retired}`
    );
  }
}

console.log(`\n── agent-comms contract spec: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
