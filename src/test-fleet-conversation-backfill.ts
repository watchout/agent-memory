import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assignTranscriptFiles,
  parseFleetBackfillArgs,
  transcriptWorkspace,
  type FleetBackfillTarget,
} from "./fleet-conversation-backfill.js";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "wasurezu-fleet-backfill-"));
  try {
    const codexWorkspace = join(root, "codex-workspace");
    const claudeWorkspace = join(root, "claude-workspace");
    await mkdir(join(codexWorkspace, "nested"), { recursive: true });
    await mkdir(claudeWorkspace, { recursive: true });
    const codexFile = join(root, "codex.jsonl");
    const claudeFile = join(root, "claude.jsonl");
    const unknownFile = join(root, "unknown.jsonl");
    await writeFile(codexFile, `${JSON.stringify({
      type: "session_meta",
      payload: { cwd: join(codexWorkspace, "nested") },
    })}\n`);
    await writeFile(claudeFile, `${JSON.stringify({
      type: "user",
      cwd: claudeWorkspace,
      message: { content: "fixture" },
    })}\n`);
    await writeFile(unknownFile, `${JSON.stringify({ type: "unknown" })}\n`);

    assert.equal(transcriptWorkspace(codexFile, "codex"), join(codexWorkspace, "nested"));
    assert.equal(transcriptWorkspace(claudeFile, "claude_code"), claudeWorkspace);
    assert.equal(transcriptWorkspace(unknownFile, "codex"), null);

    const targets: FleetBackfillTarget[] = [
      { agent_id: "codex-agent", project: "codex-project", workspace: codexWorkspace, source: "codex" },
      { agent_id: "claude-agent", project: "claude-project", workspace: claudeWorkspace, source: "claude_code" },
    ];
    const assigned = assignTranscriptFiles(targets, {
      codex: [codexFile, unknownFile],
      claude_code: [claudeFile],
    });
    assert.equal(assigned.assignments[0].files.length, 1);
    assert.equal(assigned.assignments[1].files.length, 1);
    assert.equal(assigned.unmatched_files, 1);
    assert.equal(assigned.ambiguous_files, 0);

    const options = parseFleetBackfillArgs([
      "--dry-run",
      "--since", "2026-08-13T12:00:00Z",
      "--database-url", "postgresql:///agent_comms?host=/tmp",
      "--codex-root", root,
      "--claude-root", root,
      "--max-files-per-target", "50",
      "--max-total-bytes", "1000000",
    ]);
    assert.equal(options.apply, false);
    assert.equal(options.since, "2026-08-13T12:00:00.000Z");
    assert.equal(options.max_files_per_target, 50);
    assert.equal(options.max_total_bytes, 1_000_000);
    assert.throws(() => parseFleetBackfillArgs([]), /--since/);

    console.log("fleet conversation backfill tests passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
