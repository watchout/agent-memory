#!/usr/bin/env node
/**
 * Anti-regression tests for the AM-027 incident class.
 *
 * Each test guards a specific rule that was BROKEN in recent history. The
 * comment above each test cites the incident date + commit/PR so future
 * maintainers can see why the rule exists and judge edge cases.
 *
 * Background:
 *   On 2026-04-08 we shipped PR#61 (fix: track voyage.ts + ADF artifacts +
 *   .gitignore hardening, commit 747d537). The PR fixed a class of
 *   regressions that had been silently broken for days:
 *
 *     1. src/stores/voyage.ts existed locally but was untracked in git.
 *        pg-store.ts imports './voyage.js' so CI broke with TS2307
 *        ("Cannot find module") on every PR build.
 *     2. .framework/{gates,plan,project,retrofit-report}.json — created
 *        by the AM-008/009/010 ADF retrofit but never committed.
 *     3. .claude/hooks/{pre-code-gate,skill-tracker}.sh — same story,
 *        ADF retrofit artifacts left untracked.
 *     4. docs/{idea,operations,standards}/ — ADF docs left untracked.
 *     5. .mcp.json contained the agent-mem-dev Discord bot token in
 *        cleartext and was NOT in .gitignore. Sensitive secret was at
 *        risk of being committed by any developer running `git add .`.
 *     6. .claude/settings.json contained per-developer absolute paths
 *        (DATABASE_URL, AGENT_ID, project name) that should be
 *        per-developer, not committed.
 *
 *   The ADF retrofit ran the Pre-Code Gate locally so the gap was
 *   invisible until CI logs were inspected.
 *
 * CEO directive 2026-04-08 (msg id 1491522388465287218):
 *   仕様書を何本書いても、実装者が仕様を読まずに incremental に問題を潰していけば
 *   乖離し続けます。提案: 仕様書をコードにする — 仕様をドキュメントではなく
 *   テストとして書く。テストが通らなければマージできない。
 *
 * Each rule below would have failed CI and blocked the original gap from
 * shipping if it existed at the time. They MUST stay green.
 *
 * See: https://github.com/watchout/agent-memory/issues/62 (AM-028)
 *      https://github.com/watchout/agent-memory/pull/61   (AM-027 fix)
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// REPO_ROOT discovery: this file lives at tests/spec-enforcement/, so the
// repo root is two directories up. Use import.meta.url so the test runs
// correctly regardless of CWD (CI runs from the repo root, but a
// developer might invoke the test from a subdirectory).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

function exists(rel: string): boolean {
  return existsSync(join(REPO_ROOT, rel));
}

/**
 * Returns true if `rel` is tracked by git (`git ls-files --error-unmatch`
 * exits 0). Returns false if untracked, missing, or anything else fails.
 *
 * --error-unmatch is the canonical way to ask git "is this path tracked?"
 * because it exits non-zero on an untracked or missing path. We swallow
 * stderr because the caller only cares about the boolean result.
 */
function trackedInGit(rel: string): boolean {
  try {
    execSync(`git ls-files --error-unmatch -- ${rel}`, {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function gitIgnoreContains(needle: string): boolean {
  if (!exists(".gitignore")) return false;
  const content = readFileSync(join(REPO_ROOT, ".gitignore"), "utf-8");
  // Anchored line match: split into lines and compare each line after
  // stripping leading/trailing whitespace and any trailing comment.
  // This avoids the substring trap (".mcp.json.example" satisfying
  // ".mcp.json") and the regex-escaping rabbit hole — the inputs we
  // care about are literal paths so a string equality check is fine.
  for (const rawLine of content.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (line === needle) return true;
  }
  return false;
}

// ─── Test 1: voyage.ts must be tracked ──────────────────────────
//
// Incident: src/stores/voyage.ts was created locally on ~2026-04-04 but
// never `git add`-ed. pg-store.ts has `import { ... } from "./voyage.js"`
// so every CI run failed with TS2307. Re-tracked in commit 747d537
// (PR#61). Without this guard a developer can `git rm` it again and
// re-break CI silently.
function testVoyageTracked() {
  console.log("\n── Test 1: voyage.ts is tracked ──");
  assert(exists("src/stores/voyage.ts"), "src/stores/voyage.ts exists on disk");
  assert(
    trackedInGit("src/stores/voyage.ts"),
    "src/stores/voyage.ts is tracked in git"
  );
}

// ─── Test 2: .framework/*.json must be tracked ──────────────────
//
// Incident: ADF retrofit (AM-008/009/010) created .framework/ artifacts
// locally on ~2026-04-06 but never committed. Re-tracked in PR#61.
// Each file represents a different aspect of the ADF state and the
// reproducibility story breaks if any one is missing on a fresh clone.
function testFrameworkTracked() {
  console.log("\n── Test 2: .framework/*.json files are tracked ──");
  for (const path of [
    ".framework/gates.json",
    ".framework/plan.json",
    ".framework/project.json",
    ".framework/retrofit-report.json",
  ]) {
    assert(exists(path), `${path} exists on disk`);
    assert(trackedInGit(path), `${path} is tracked in git`);
  }
}

// ─── Test 3: .claude/hooks/*.sh must be tracked ─────────────────
//
// Incident: pre-code-gate.sh + skill-tracker.sh were ADF retrofit
// artifacts (AM-006 + AM-008) left untracked until PR#61. The hooks are
// what the ADF gate process calls — without them tracked, the framework
// silently no-ops on a fresh clone.
function testClaudeHooksTracked() {
  console.log("\n── Test 3: .claude/hooks/*.sh files are tracked ──");
  for (const path of [
    ".claude/hooks/pre-code-gate.sh",
    ".claude/hooks/skill-tracker.sh",
  ]) {
    assert(exists(path), `${path} exists on disk`);
    assert(trackedInGit(path), `${path} is tracked in git`);
  }
}

// ─── Test 4: docs/{idea,operations,standards}/ must have content ─
//
// Incident: ADF retrofit created docs/idea/, docs/operations/,
// docs/standards/ on ~2026-04-06 but never committed. PR#61 re-tracked
// the directories along with their contents. The test asserts each
// directory contains at least one tracked file so an empty
// .gitkeep-style commit doesn't satisfy it.
function testAdfDocsTracked() {
  console.log("\n── Test 4: docs/{idea,operations,standards}/ have tracked files ──");
  for (const dir of ["docs/idea", "docs/operations", "docs/standards"]) {
    assert(exists(dir), `${dir} exists on disk`);
    // List files tracked under this directory. ls-files -- <dir>/ returns
    // an empty string when nothing is tracked.
    let trackedCount = 0;
    try {
      const out = execSync(`git ls-files -- ${dir}`, {
        cwd: REPO_ROOT,
        encoding: "utf-8",
      });
      trackedCount = out.split("\n").filter((line) => line.trim().length > 0).length;
    } catch {
      trackedCount = 0;
    }
    assert(
      trackedCount >= 1,
      `${dir} contains at least 1 file tracked in git (found: ${trackedCount})`
    );
  }
}

// ─── Test 5: .mcp.json must NOT be tracked (negative) ───────────
//
// Incident: .mcp.json contained agent-mem-dev's Discord bot token in
// plaintext. PR#61 added it to .gitignore but did NOT delete the local
// copy (each developer has their own per-bot config). The negative
// assertion guards against a future `git add .mcp.json` slipping a
// secret into the repo.
function testMcpJsonNotTracked() {
  console.log("\n── Test 5: .mcp.json is NOT tracked (negative) ──");
  assert(
    !trackedInGit(".mcp.json"),
    ".mcp.json is NOT tracked in git (would expose Discord bot tokens)"
  );
}

// ─── Test 6: .claude/settings.json must NOT be tracked (negative) ─
//
// Incident: .claude/settings.json contained per-developer absolute
// paths (DATABASE_URL, AGENT_MEMORY_AGENT_ID, project name). Tracking
// it would force every developer to share the same agent identity. PR
// #61 added it to .gitignore.
function testClaudeSettingsNotTracked() {
  console.log("\n── Test 6: .claude/settings.json is NOT tracked (negative) ──");
  assert(
    !trackedInGit(".claude/settings.json"),
    ".claude/settings.json is NOT tracked in git (per-developer config)"
  );
}

// ─── Test 7: .gitignore must list .mcp.json ─────────────────────
//
// Incident: .gitignore did not contain .mcp.json so a developer running
// `git add .` could trivially leak the Discord bot token. PR#61 added
// the line. This test guards against the line being removed in a
// future cleanup PR.
function testGitignoreMcpJson() {
  console.log("\n── Test 7: .gitignore contains .mcp.json ──");
  assert(
    gitIgnoreContains(".mcp.json"),
    ".gitignore has a line matching '.mcp.json'"
  );
}

// ─── Test 8: .gitignore must list .claude/settings.json ─────────
//
// Same incident class as test 7. Guards against accidental removal of
// the .claude/settings.json gitignore line.
function testGitignoreClaudeSettings() {
  console.log("\n── Test 8: .gitignore contains .claude/settings.json ──");
  assert(
    gitIgnoreContains(".claude/settings.json"),
    ".gitignore has a line matching '.claude/settings.json'"
  );
}

async function run() {
  console.log("agent-memory anti-regression test suite (AM-028 / AM-027 incident class)\n");
  console.log(`REPO_ROOT: ${REPO_ROOT}`);

  testVoyageTracked();
  testFrameworkTracked();
  testClaudeHooksTracked();
  testAdfDocsTracked();
  testMcpJsonNotTracked();
  testClaudeSettingsNotTracked();
  testGitignoreMcpJson();
  testGitignoreClaudeSettings();

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  if (failed > 0) {
    console.error(
      "\n❌ Anti-regression test failed. One of the rules from AM-027 (PR#61) has been broken.\n" +
        "   See tests/spec-enforcement/anti-regression-am027.ts for the rule + remediation context.\n"
    );
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
