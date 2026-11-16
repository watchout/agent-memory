/**
 * Isolation of the store-resolution tests (261113-store-resolution-fix, IM-BF-01).
 *
 * The public commands (`npm run test:store-resolution`) are run as a developer runs them: HOME and every store variable
 * point into a stand-in for the real home, and that stand-in holds a synthetic old-format JSON store (two rows of one
 * task, no task_id: the JSON store rewrites it as soon as it reads it), a file that is not a database where the default
 * SQLite file would be, and a user config that names an unreachable PostgreSQL. Nothing in the stand-in may change:
 * every name, size, content hash and modification time (the folders' too) is the same after the run, and the run passed.
 * A read of the stand-in shows through its effect (a rewrite, a refusal, a failed test), not as a count of reads.
 *
 * A control proves the check can fail: the same JSON store, loaded before HOME is switched (what the scenario test did
 * before the first import set the home), rewrites the stand-in, and the snapshot differs. A structure check keeps the
 * bootstrap the first import of the tests that load store modules statically.
 * No PostgreSQL server is needed.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
/** The tests run under the stand-in, as `npm run test:store-resolution` runs them. */
const SUITE: ReadonlyArray<{ file: string; pass: RegExp }> = [
  { file: "src/test-store-resolution.ts", pass: /\d+ checks passed/ },
  { file: "src/test-store-resolution-scenario.ts", pass: /\d+ checks passed/ },
  { file: "src/test-codex-session-start.ts", pass: /codex native SessionStart adapter tests passed/ },
  { file: "src/test-transcript-stop-capture.ts", pass: /transcript stop capture tests passed/ },
  { file: "src/test-session-rotation-core.ts", pass: /PASS test-session-rotation-core/ },
];
/** The tests that load store modules statically: their first import must be the bootstrap. */
const BOOTSTRAPPED = ["src/test-store-resolution-scenario.ts", "src/test-store-resolution-pg.ts", "src/test-store-resolution.ts"] as const;
const made: string[] = [];
let checks = 0;

function tmp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `store-res-iso-${prefix}-`)));
  made.push(dir);
  return dir;
}

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** The stand-in for the real home: an old-format JSON store, a non-database at the default SQLite path, a user config. */
function standInHome(): string {
  const home = tmp("home");
  const data = join(home, ".agent-memory");
  mkdirSync(join(data, "rotation", "seat"), { recursive: true });
  const row = { agent_id: "synthetic-seat", task: "synthetic-task", status: "in_progress", created_at: "2026-01-01T00:00:00.000Z" };
  const newer = { ...row, created_at: "2026-01-02T00:00:00.000Z" };
  writeFileSync(join(data, "task-states.json"), JSON.stringify([row, newer], null, 2));
  writeFileSync(join(data, "decisions.json"), "[]");
  writeFileSync(join(data, "memory.db"), Buffer.alloc(96, 7));
  writeFileSync(join(data, "config.json"), JSON.stringify({ database_url: "postgres://127.0.0.1:1/synthetic" }));
  writeFileSync(join(data, "rotation", "seat", "marker.json"), "{}");
  return home;
}

/** Every folder and file under `root`: kind, relative name, size, content hash and modification time (nanoseconds). */
function snapshot(root: string): string[] {
  const rows: string[] = [];
  const walk = (dir: string) => {
    rows.push(`d ${relative(root, dir) || "."} mtime=${statSync(dir, { bigint: true }).mtimeNs}`);
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const info = statSync(full, { bigint: true });
      if (info.isDirectory()) walk(full);
      else rows.push(`f ${relative(root, full)} size=${info.size} mtime=${info.mtimeNs} sha256=${sha(readFileSync(full))}`);
    }
  };
  walk(root);
  return rows;
}

/** The variables a developer's shell may have set, all pointing into the stand-in. */
function developerEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    AGENT_MEMORY_HOME: join(home, ".agent-memory"),
    AGENT_MEMORY_DB_PATH: join(home, ".agent-memory", "memory.db"),
    AGENT_MEMORY_DATABASE_URL: "postgres://127.0.0.1:1/synthetic",
    DATABASE_URL: "postgres://127.0.0.1:1/synthetic",
  };
}

function run(file: string, env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["--import", "tsx", file], { encoding: "utf8", env, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
}

function ok(name: string): void {
  checks += 1;
  console.log(`ok - ${name}`);
}

try {
  // The control: the JSON store is loaded, then HOME is switched, then the store is opened. The stand-in is rewritten.
  {
    const home = standInHome();
    const late = tmp("late");
    const dir = tmp("control");
    const script = join(dir, "control.mts");
    writeFileSync(
      script,
      `import { JsonStore } from ${JSON.stringify(pathToFileURL(join(ROOT, "src", "stores", "json-store.ts")).href)};\n` +
        `process.env.HOME = process.env.CONTROL_LATE_HOME;\nawait new JsonStore().initialize();\n`,
    );
    const before = snapshot(home);
    const result = run(script, { ...developerEnv(home), CONTROL_LATE_HOME: late });
    assert.equal(result.status, 0, `the control ran: ${result.stderr}`);
    const after = snapshot(home);
    assert.notDeepEqual(after, before, "the control (HOME switched after the store module loaded) changes the stand-in");
    assert.ok(
      after.some((row) => row.startsWith("f .agent-memory/task-states.json ") && !before.includes(row)),
      "the control rewrites the old-format task-states.json",
    );
    ok("control: a store module loaded before HOME is switched rewrites the stand-in, and the snapshot shows it");
  }

  // The public commands, run as a developer runs them, leave the stand-in as it was.
  for (const { file, pass } of SUITE) {
    const home = standInHome();
    const before = snapshot(home);
    const result = run(file, developerEnv(home));
    assert.equal(result.status, 0, `${file} passed under the stand-in home\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, pass, `${file} reported its pass line`);
    const after = snapshot(home);
    assert.deepEqual(after, before, `${file} changed nothing in the stand-in home (names, sizes, hashes, modification times)`);
    ok(`${file} (HOME and the store variables point into a stand-in with an old-format JSON store): passed, stand-in unchanged`);
  }

  // The bootstrap stays the first import.
  for (const file of BOOTSTRAPPED) {
    const text = readFileSync(join(ROOT, file), "utf8");
    const first = /^import\b[^;]*;/m.exec(text);
    assert.ok(first, `${file} has an import`);
    assert.match(first[0], /from "\.\/test-isolated-home\.js"|^import "\.\/test-isolated-home\.js"/, `${file}: the first import is the bootstrap, found: ${first[0]}`);
    ok(`${file}: the first import is test-isolated-home.js`);
  }
} finally {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
}

console.log(`store-resolution-isolation: ${checks} checks passed`);
