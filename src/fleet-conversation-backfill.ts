#!/usr/bin/env node
/** Deterministic, workspace-bound Codex/Claude transcript backfill. */
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  findClaudeJsonlFiles,
  getClaudeProjectsDir,
  ingestClaudeConversationEvents,
} from "./claude-conversation-ingest.js";
import {
  findCodexJsonlFiles,
  getCodexSessionsDir,
  ingestCodexConversationEvents,
} from "./codex-conversation-ingest.js";
import { redactText } from "./redact.js";
import { PgStore } from "./stores/pg-store.js";

export const FLEET_BACKFILL_EXPECTED_TARGET_COUNT = 33;
export const FLEET_BACKFILL_HEAD_BYTES = 256 * 1024;
export const FLEET_BACKFILL_DEFAULT_MAX_FILES_PER_TARGET = 200;
export const FLEET_BACKFILL_DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

const ELIGIBLE_PRIMARY_SQL = `
SELECT
  a.agent_id,
  aw.name AS project,
  aw.local_path AS workspace,
  a.runtime_engine_preference
FROM agents a
JOIN agent_workspace_bindings awb
  ON awb.agent_id = a.agent_id
  AND awb.binding_role = 'primary'
  AND awb.active = true
JOIN agent_workspaces aw ON aw.workspace_id = awb.workspace_id
WHERE a.agent_type <> 'human'
  AND a.agent_id <> 'pdca-ops'
  AND a.disabled_at IS NULL
  AND COALESCE(a.profile_enabled, true) = true
  AND a.runtime_engine_preference IN ('codex', 'claude-code')
  AND a.home_directory LIKE '/Users/yuji/Developer/%'
  AND a.agent_id !~ '(^__|test|ephemeral)'
ORDER BY a.agent_id, aw.name, aw.local_path
`;

export type BackfillSource = "codex" | "claude_code";

export interface FleetBackfillTarget {
  agent_id: string;
  project: string;
  workspace: string;
  source: BackfillSource;
}

export interface FleetBackfillAssignment extends FleetBackfillTarget {
  files: string[];
  bytes: number;
}

export interface FleetBackfillOptions {
  apply: boolean;
  since: string;
  database_url: string;
  codex_root: string;
  claude_root: string;
  max_files_per_target: number;
  max_total_bytes: number;
}

interface EligibleRow {
  agent_id: unknown;
  project: unknown;
  workspace: unknown;
  runtime_engine_preference: unknown;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${flag} requires a positive integer`);
  return parsed;
}

export function parseFleetBackfillArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): FleetBackfillOptions {
  let apply = false;
  let since = "";
  let databaseUrl = env.AGENT_MEMORY_DATABASE_URL ?? env.DATABASE_URL ?? "postgresql:///agent_comms?host=/tmp";
  let codexRoot = getCodexSessionsDir();
  let claudeRoot = getClaudeProjectsDir();
  let maxFiles = FLEET_BACKFILL_DEFAULT_MAX_FILES_PER_TARGET;
  let maxBytes = FLEET_BACKFILL_DEFAULT_MAX_TOTAL_BYTES;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = () => {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--since") since = next();
    else if (arg === "--database-url") databaseUrl = next();
    else if (arg === "--codex-root") codexRoot = next();
    else if (arg === "--claude-root") claudeRoot = next();
    else if (arg === "--max-files-per-target") maxFiles = positiveInteger(next(), arg);
    else if (arg === "--max-total-bytes") maxBytes = positiveInteger(next(), arg);
    else throw new Error(`unknown argument: ${arg}`);
  }
  const sinceDate = new Date(since);
  if (!since || Number.isNaN(sinceDate.getTime())) throw new Error("--since requires an ISO timestamp");
  if (!databaseUrl.startsWith("postgres")) throw new Error("PostgreSQL database URL required");
  return {
    apply,
    since: sinceDate.toISOString(),
    database_url: databaseUrl,
    codex_root: resolve(codexRoot),
    claude_root: resolve(claudeRoot),
    max_files_per_target: maxFiles,
    max_total_bytes: maxBytes,
  };
}

function readHead(path: string): string {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(FLEET_BACKFILL_HEAD_BYTES);
    const bytes = readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytes).toString("utf8");
  } finally {
    closeSync(descriptor);
  }
}

export function transcriptWorkspace(path: string, source: BackfillSource): string | null {
  let head: string;
  try {
    head = readHead(path);
  } catch {
    return null;
  }
  for (const line of head.split("\n")) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(record)) continue;
    const payload = isRecord(record.payload) ? record.payload : {};
    const cwd = source === "codex" ? payload.cwd : record.cwd;
    if (typeof cwd === "string" && isAbsolute(cwd)) return resolve(cwd);
  }
  return null;
}

export function assignTranscriptFiles(
  targets: FleetBackfillTarget[],
  discovered: Record<BackfillSource, string[]>,
): { assignments: FleetBackfillAssignment[]; unmatched_files: number; ambiguous_files: number } {
  const assignments: FleetBackfillAssignment[] = targets.map((target) => ({
    ...target,
    files: [],
    bytes: 0,
  }));
  let unmatchedFiles = 0;
  let ambiguousFiles = 0;
  for (const source of ["codex", "claude_code"] as const) {
    const sourceTargets = assignments.filter((target) => target.source === source);
    for (const file of discovered[source]) {
      const cwd = transcriptWorkspace(file, source);
      if (!cwd) {
        unmatchedFiles++;
        continue;
      }
      const matches = sourceTargets.filter((target) => isWithin(target.workspace, cwd));
      if (matches.length === 0) {
        unmatchedFiles++;
        continue;
      }
      if (matches.length !== 1) {
        ambiguousFiles++;
        continue;
      }
      const exact = matches[0];
      exact.files.push(file);
      exact.bytes += statSync(file).size;
    }
  }
  for (const assignment of assignments) assignment.files.sort();
  return { assignments, unmatched_files: unmatchedFiles, ambiguous_files: ambiguousFiles };
}

async function loadTargets(database: Client): Promise<FleetBackfillTarget[]> {
  const result = await database.query<EligibleRow>(ELIGIBLE_PRIMARY_SQL);
  if (result.rows.length !== FLEET_BACKFILL_EXPECTED_TARGET_COUNT) {
    throw new Error(`expected ${FLEET_BACKFILL_EXPECTED_TARGET_COUNT} targets, got ${result.rows.length}`);
  }
  const targets = result.rows.map((row): FleetBackfillTarget => {
    if (typeof row.agent_id !== "string" || typeof row.project !== "string" ||
      typeof row.workspace !== "string" ||
      !(row.runtime_engine_preference === "codex" || row.runtime_engine_preference === "claude-code")) {
      throw new Error("invalid eligible target row");
    }
    const workspace = realpathSync(row.workspace);
    return {
      agent_id: row.agent_id,
      project: row.project,
      workspace,
      source: row.runtime_engine_preference === "codex" ? "codex" : "claude_code",
    };
  });
  if (new Set(targets.map((target) => `${target.agent_id}\0${target.project}\0${target.source}`)).size !== targets.length) {
    throw new Error("duplicate eligible target");
  }
  return targets;
}

export async function runFleetConversationBackfill(options: FleetBackfillOptions): Promise<Record<string, unknown>> {
  const database = new Client({ connectionString: options.database_url });
  await database.connect();
  try {
    const targets = await loadTargets(database);
    const since = new Date(options.since);
    const discovered = {
      codex: findCodexJsonlFiles(since, options.codex_root, 4),
      claude_code: findClaudeJsonlFiles(since, options.claude_root, 3),
    };
    const assigned = assignTranscriptFiles(targets, discovered);
    if (assigned.ambiguous_files !== 0) throw new Error("ambiguous transcript workspace mapping");
    const overflow = assigned.assignments.filter((item) => item.files.length > options.max_files_per_target);
    if (overflow.length > 0) throw new Error("max files per target exceeded");
    const totalBytes = assigned.assignments.reduce((sum, item) => sum + item.bytes, 0);
    if (totalBytes > options.max_total_bytes) throw new Error("max total bytes exceeded");
    const planRows = assigned.assignments.map((item) => ({
      agent_id: item.agent_id,
      project: item.project,
      source: item.source,
      workspace_sha256: sha256(item.workspace),
      file_count: item.files.length,
      bytes: item.bytes,
    }));
    const planSha256 = sha256(JSON.stringify({ since: options.since, rows: planRows }));
    const ingestResults: Array<Record<string, unknown>> = [];
    if (options.apply) {
      const store = new PgStore(options.database_url);
      await store.initialize({ run_migrations: false });
      try {
        for (const assignment of assigned.assignments) {
          if (assignment.files.length === 0) {
            ingestResults.push({
              agent_id: assignment.agent_id,
              project: assignment.project,
              source: assignment.source,
              files_scanned: 0,
              events_saved: 0,
              events_duplicate: 0,
              events_skipped: 0,
            });
            continue;
          }
          const common = {
            project: assignment.project,
            since: options.since,
            root: assignment.source === "codex" ? options.codex_root : options.claude_root,
            max_files: options.max_files_per_target,
            files: assignment.files,
          };
          const result = assignment.source === "codex"
            ? await ingestCodexConversationEvents(store, assignment.agent_id, common)
            : await ingestClaudeConversationEvents(store, assignment.agent_id, common);
          ingestResults.push({
            agent_id: assignment.agent_id,
            project: assignment.project,
            source: assignment.source,
            files_scanned: result.files_scanned,
            events_saved: result.events_saved,
            events_duplicate: result.events_duplicate,
            events_skipped: result.events_skipped,
          });
        }
      } finally {
        await store.close();
      }
    }
    const verification = options.apply
      ? (await database.query<{
          agent_id: string;
          source: string;
          user_count: string;
          assistant_count: string;
          latest_at: Date | null;
        }>(`
          SELECT agent_id, source,
            count(*) FILTER (WHERE role = 'user')::text AS user_count,
            count(*) FILTER (WHERE role = 'assistant')::text AS assistant_count,
            max(occurred_at) AS latest_at
          FROM conversation_events
          WHERE occurred_at >= $1
            AND (agent_id, source) IN (
              SELECT a.agent_id,
                CASE WHEN a.runtime_engine_preference = 'codex' THEN 'codex' ELSE 'claude_code' END
              FROM agents a
              WHERE a.disabled_at IS NULL
            )
          GROUP BY agent_id, source
          ORDER BY agent_id, source
        `, [options.since])).rows.map((row) => ({
          agent_id: row.agent_id,
          source: row.source,
          user_count: Number(row.user_count),
          assistant_count: Number(row.assistant_count),
          latest_at: row.latest_at?.toISOString() ?? null,
        }))
      : [];
    return {
      schema_version: "wasurezu-fleet-conversation-backfill/v1",
      mode: options.apply ? "apply" : "dry-run",
      since: options.since,
      target_count: targets.length,
      codex_target_count: targets.filter((target) => target.source === "codex").length,
      claude_target_count: targets.filter((target) => target.source === "claude_code").length,
      discovered_file_count: discovered.codex.length + discovered.claude_code.length,
      assigned_file_count: assigned.assignments.reduce((sum, item) => sum + item.files.length, 0),
      unmatched_file_count: assigned.unmatched_files,
      ambiguous_file_count: assigned.ambiguous_files,
      total_bytes: totalBytes,
      plan_sha256: planSha256,
      targets: planRows,
      ingest_results: ingestResults,
      verification,
      private_reasoning_persisted: false,
      protected_instruction_bodies_persisted: false,
    };
  } finally {
    await database.end();
  }
}

async function main(): Promise<void> {
  const options = parseFleetBackfillArgs(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(await runFleetConversationBackfill(options), null, 2)}\n`);
}

let invokedPath = "";
try {
  invokedPath = process.argv[1] ? realpathSync(resolve(process.argv[1])) : "";
} catch {
  invokedPath = "";
}
if (invokedPath === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`[fleet-conversation-backfill] ${redactText(String(error)).text}\n`);
    process.exit(1);
  });
}
