import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  CLAUDE_PROJECTS_MAX_DEPTH,
  getClaudeProjectsDir,
} from "./claude-conversation-ingest.js";
import {
  CODEX_SESSIONS_MAX_DEPTH,
  getCodexSessionsDir,
} from "./codex-conversation-ingest.js";
import { normalizeHomePath, redactText } from "./redact.js";
import type {
  Store,
  CatchUpInput,
  CatchUpResult,
  CatchUpLog,
} from "./stores/types.js";

export type CatchUpHostSource = "claude_code" | "codex";
export type CatchUpSourceSelector = CatchUpHostSource | "all";
export type CatchUpDryRunStatus = "ready" | "degraded";
export type CatchUpSkippedReason =
  | "root_missing"
  | "scan_error"
  | "max_files_exceeded"
  | "no_candidate_files";

export interface CatchUpDryRunInput {
  source?: CatchUpSourceSelector;
  project?: string;
  since?: string;
  until?: string;
  max_files?: number;
  roots?: Partial<Record<CatchUpHostSource, string>>;
}

export interface CatchUpCandidateRef {
  source: CatchUpHostSource;
  source_ref: string;
  mtime: string;
  size_bytes: number;
}

export interface CatchUpSourceManifest {
  source: CatchUpHostSource;
  project?: string;
  status: CatchUpDryRunStatus;
  root_ref: string;
  candidate_files: number;
  emitted_refs: number;
  skipped_files: number;
  skipped_reasons: CatchUpSkippedReason[];
  candidate_refs: CatchUpCandidateRef[];
}

export interface CatchUpDryRunManifest {
  dry_run: true;
  writes_performed: false;
  approved_memory_promoted: false;
  policy_version: "catch-up-source-a-dry-run-v1";
  source: CatchUpSourceSelector;
  since: string;
  until: string;
  generated_at: string;
  project?: string;
  sources: CatchUpSourceManifest[];
  totals: {
    candidate_files: number;
    emitted_refs: number;
    skipped_files: number;
  };
  notes: string[];
}

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_FILES = 200;

const SOURCE_CONFIG: Record<CatchUpHostSource, { defaultRoot: () => string; maxDepth: number }> = {
  claude_code: {
    defaultRoot: getClaudeProjectsDir,
    maxDepth: CLAUDE_PROJECTS_MAX_DEPTH,
  },
  codex: {
    defaultRoot: getCodexSessionsDir,
    maxDepth: CODEX_SESSIONS_MAX_DEPTH,
  },
};

export function buildCatchUpSourceADryRunManifest(input: CatchUpDryRunInput = {}): CatchUpDryRunManifest {
  const generatedAt = new Date().toISOString();
  const since = parseOptionalDate(input.since, new Date(Date.now() - DEFAULT_LOOKBACK_MS), "since");
  const until = parseOptionalDate(input.until, new Date(), "until");
  if (since.getTime() > until.getTime()) {
    throw new Error(`catch-up since must be <= until: ${since.toISOString()} > ${until.toISOString()}`);
  }

  const selector = input.source ?? "all";
  const sources = selector === "all" ? (["claude_code", "codex"] as const) : ([selector] as const);
  const maxFiles = Math.max(0, Math.floor(input.max_files ?? DEFAULT_MAX_FILES));
  const manifests = sources.map((source) =>
    inspectSource({
      source,
      project: input.project,
      root: input.roots?.[source] ?? SOURCE_CONFIG[source].defaultRoot(),
      since,
      until,
      maxFiles,
    })
  );

  return {
    dry_run: true,
    writes_performed: false,
    approved_memory_promoted: false,
    policy_version: "catch-up-source-a-dry-run-v1",
    source: selector,
    since: since.toISOString(),
    until: until.toISOString(),
    generated_at: generatedAt,
    project: input.project,
    sources: manifests,
    totals: {
      candidate_files: sum(manifests, "candidate_files"),
      emitted_refs: sum(manifests, "emitted_refs"),
      skipped_files: sum(manifests, "skipped_files"),
    },
    notes: [
      "Source A dry-run only; no memory writes were performed.",
      "Host conversation/event logs are source data only and are not approved memory.",
      "Private reasoning, base instructions, and developer instructions are not promoted by this manifest.",
    ],
  };
}

function inspectSource(input: {
  source: CatchUpHostSource;
  project?: string;
  root: string;
  since: Date;
  until: Date;
  maxFiles: number;
}): CatchUpSourceManifest {
  const skippedReasons = new Set<CatchUpSkippedReason>();
  let candidates: CatchUpCandidateRef[] = [];
  let scanError = false;

  if (!existsSync(input.root)) {
    skippedReasons.add("root_missing");
  } else {
    const scanned = scanJsonlCandidates(
      input.source,
      input.root,
      SOURCE_CONFIG[input.source].maxDepth,
      input.since.getTime(),
      input.until.getTime()
    );
    candidates = scanned.candidates;
    scanError = scanned.scanError;
    if (scanError) skippedReasons.add("scan_error");
  }

  if (candidates.length === 0 && !skippedReasons.has("root_missing")) {
    skippedReasons.add("no_candidate_files");
  }
  const emitted = candidates.slice(0, input.maxFiles);
  const skippedFiles = Math.max(0, candidates.length - emitted.length);
  if (skippedFiles > 0) skippedReasons.add("max_files_exceeded");

  const reasonList = Array.from(skippedReasons).sort();
  return {
    source: input.source,
    project: input.project,
    status: reasonList.length > 0 ? "degraded" : "ready",
    root_ref: safeRef(input.root),
    candidate_files: candidates.length,
    emitted_refs: emitted.length,
    skipped_files: skippedFiles,
    skipped_reasons: reasonList,
    candidate_refs: emitted,
  };
}

function scanJsonlCandidates(
  source: CatchUpHostSource,
  root: string,
  maxDepth: number,
  sinceMs: number,
  untilMs: number
): { candidates: CatchUpCandidateRef[]; scanError: boolean } {
  const candidates: CatchUpCandidateRef[] = [];
  let scanError = false;

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      scanError = true;
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      try {
        const stat = statSync(path);
        if (stat.mtimeMs < sinceMs || stat.mtimeMs > untilMs) continue;
        candidates.push({
          source,
          source_ref: safeRef(path),
          mtime: new Date(stat.mtimeMs).toISOString(),
          size_bytes: stat.size,
        });
      } catch {
        scanError = true;
      }
    }
  };

  walk(root, 1);
  return {
    candidates: candidates.sort((a, b) => a.source_ref.localeCompare(b.source_ref)),
    scanError,
  };
}

function parseOptionalDate(value: string | undefined, fallback: Date, label: string): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid catch-up ${label}: ${value}`);
  return parsed;
}

function safeRef(value: string): string {
  return redactText(normalizeHomePath(value)).text;
}

function sum(items: CatchUpSourceManifest[], key: "candidate_files" | "emitted_refs" | "skipped_files"): number {
  return items.reduce((total, item) => total + item[key], 0);
}

// ─── AM-026 Full Catch-up Implementation ────────────────────────────────────

/** Hard cap on glob recursion depth — ARC condition #4 (`maxDepth=3`). */
export const MAX_PROJECTS_GLOB_DEPTH = 3;

/** Default lookback when no prior catch_up_log row exists for an agent. */
const CATCHUP_DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Cap on the content_preview column so it stays log-friendly. */
const PREVIEW_LEN = 200;

/**
 * Internal shape produced by `extractFromRecord`. Not exported as
 * a public type because callers only see the aggregate `CatchUpResult`.
 */
export interface ExtractedEvent {
  target_table: "decisions" | "task_states" | "knowledge";
  content: string;
  title?: string;
  task_status?: "in_progress" | "completed" | "blocked";
  files_modified?: string[];
  event_at: string;
  ticket_id?: string;
}

const TASK_TAG_RE = /\[TASK:(start|done|block)\]/i;
const DECISION_TAG_RE = /\[DECISION\]/i;
const KNOWLEDGE_TAG_RE = /\[KNOWLEDGE\]/i;
const TICKET_RE = /(?:FEAT-\d+|AM-\d+|PR[#＃]\d+|ISSUE[#＃]\d+|#\d+)/i;
const GIT_COMMIT_RE = /\bgit\s+commit\b/;
const TEST_RUN_RE = /\b(npm\s+(?:run\s+)?test|pytest|jest|go\s+test|cargo\s+test|vitest)\b/;

/** Resolve the directory we walk for jsonl files. */
export function getProjectsDir(): string {
  return process.env.CLAUDE_PROJECTS_DIR || join(homedir(), ".claude", "projects");
}

/**
 * Recursively list `*.jsonl` files under `root` whose mtime is at or
 * after `since`. Hard-capped at `MAX_PROJECTS_GLOB_DEPTH` levels deep.
 */
export function findJsonlFiles(
  since: Date,
  root: string = getProjectsDir(),
  maxDepth: number = MAX_PROJECTS_GLOB_DEPTH
): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const sinceMs = since.getTime();

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name as string;
      const path = join(dir, name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
      } else if (entry.isFile() && name.endsWith(".jsonl")) {
        let st: ReturnType<typeof statSync>;
        try {
          st = statSync(path);
        } catch {
          continue;
        }
        if (st.mtimeMs >= sinceMs) {
          out.push(path);
        }
      }
    }
  };

  walk(root, 1);
  return out;
}

/**
 * Iterate over jsonl lines whose `timestamp` field is at or after `since`.
 */
export function parseJsonl(path: string, since: Date, opts?: ExtractOptions): ExtractedEvent[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return [];
  }
  const sinceMs = since.getTime();
  const events: ExtractedEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!record || typeof record !== "object") continue;
    const ts = (record as { timestamp?: unknown }).timestamp;
    if (typeof ts !== "string") continue;
    const tsMs = Date.parse(ts);
    if (Number.isNaN(tsMs) || tsMs < sinceMs) continue;
    events.push(...extractFromRecord(record as Record<string, unknown>, opts));
  }
  return events;
}

/**
 * P2-CS1: tag-derived extraction is legacy and off by default, matching
 * the post-tool-hook opt-in (AGENT_MEMORY_LEGACY_TAG_CAPTURE). Tool-use
 * extraction (Edit/Write, git commit, test runs) is not tag-based and
 * always runs. Spec: docs/impl/IMPL-2026-06-13-catchup-tag-gating.md
 */
export interface ExtractOptions {
  legacyTagCapture?: boolean;
}

/**
 * Convert a single jsonl record into zero or more extractable events.
 */
export function extractFromRecord(
  record: Record<string, unknown>,
  opts?: ExtractOptions
): ExtractedEvent[] {
  if (record.type !== "assistant") return [];
  const message = record.message as { content?: unknown } | undefined;
  if (!message || !Array.isArray(message.content)) return [];

  const ts = record.timestamp as string;
  const events: ExtractedEvent[] = [];

  for (const block of message.content as Array<Record<string, unknown>>) {
    if (block.type === "tool_use") {
      events.push(...extractFromToolUse(block, ts));
    } else if (
      opts?.legacyTagCapture === true &&
      block.type === "text" &&
      typeof block.text === "string"
    ) {
      events.push(...extractFromText(block.text, ts));
    }
  }
  return events;
}

function extractFromToolUse(block: Record<string, unknown>, event_at: string): ExtractedEvent[] {
  const name = block.name as string;
  const input = (block.input as Record<string, unknown>) ?? {};

  if (name === "Edit" || name === "Write") {
    const filePath = input.file_path as string | undefined;
    if (!filePath) return [];
    return [
      {
        target_table: "task_states",
        content: `${name} ${filePath}`,
        files_modified: [filePath],
        task_status: "in_progress",
        event_at,
      },
    ];
  }

  if (name === "Bash") {
    const command = (input.command as string | undefined) ?? "";
    if (GIT_COMMIT_RE.test(command)) {
      return [
        {
          target_table: "knowledge",
          title: "git commit (catch-up)",
          content: command.slice(0, 1000),
          event_at,
        },
      ];
    }
    if (TEST_RUN_RE.test(command)) {
      return [
        {
          target_table: "knowledge",
          title: "test run (catch-up)",
          content: command.slice(0, 500),
          event_at,
        },
      ];
    }
  }

  return [];
}

function extractFromText(text: string, event_at: string): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];
  const ticketId = TICKET_RE.exec(text)?.[0];

  const taskMatch = TASK_TAG_RE.exec(text);
  if (taskMatch) {
    const sub = taskMatch[1].toLowerCase() as "start" | "done" | "block";
    const statusMap: Record<string, ExtractedEvent["task_status"]> = {
      start: "in_progress",
      done: "completed",
      block: "blocked",
    };
    events.push({
      target_table: "task_states",
      content: text.replace(TASK_TAG_RE, "").trim(),
      task_status: statusMap[sub],
      ticket_id: ticketId,
      event_at,
    });
  }

  if (DECISION_TAG_RE.test(text)) {
    events.push({
      target_table: "decisions",
      content: text.replace(DECISION_TAG_RE, "").trim(),
      ticket_id: ticketId,
      event_at,
    });
  }

  if (KNOWLEDGE_TAG_RE.test(text)) {
    events.push({
      target_table: "knowledge",
      title: ticketId ? `${ticketId}: catch-up knowledge` : "catch-up knowledge",
      content: text.replace(KNOWLEDGE_TAG_RE, "").trim(),
      ticket_id: ticketId,
      event_at,
    });
  }

  return events;
}

/** SHA-256 hex of the content string — the dedup key for the ledger. */
export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Entry point. Walks Source A (jsonl) only — Source B (Discord) is
 * reserved as a future PR. Returns a `CatchUpResult` summarizing
 * the sweep.
 */
export async function catchUp(
  store: Store,
  agentId: string,
  input: CatchUpInput = {}
): Promise<CatchUpResult> {
  const source = input.source ?? "all";
  const dryRun = input.dry_run === true;

  const runConversation = source === "all" || source === "conversation";
  if (!runConversation) {
    return {
      caught: { decisions: 0, task_states: 0, knowledge: 0 },
      skipped: 0,
      last_checked: new Date().toISOString(),
    };
  }

  // Compute `since`. Caller-provided > last sweep's event_at > 24h ago.
  let since: Date;
  if (input.since) {
    since = new Date(input.since);
    if (Number.isNaN(since.getTime())) {
      throw new Error(`Invalid since: ${input.since}`);
    }
  } else {
    const last = await store.getLastCatchUpLog(agentId, "conversation");
    since = last
      ? new Date(last.event_at)
      : new Date(Date.now() - CATCHUP_DEFAULT_LOOKBACK_MS);
  }

  const caught = { decisions: 0, task_states: 0, knowledge: 0 };
  let skipped = 0;

  // P2-CS1: same flag name and value grammar as the post-tool-hook
  // opt-in (PR #166). Default off — tag-derived records stay retired.
  const legacyTagCapture = /^(1|true)$/i.test(
    process.env.AGENT_MEMORY_LEGACY_TAG_CAPTURE ?? ""
  );

  const files = findJsonlFiles(since);
  for (const file of files) {
    const events = parseJsonl(file, since, { legacyTagCapture });
    for (const event of events) {
      const hash = contentHash(event.content);
      const dup = await store.isCatchUpDuplicate({
        agent_id: agentId,
        content_hash: hash,
        event_at: event.event_at,
      });

      if (dup) {
        skipped++;
        if (!dryRun) {
          await store.saveCatchUpLog({
            agent_id: agentId,
            source: "conversation",
            content_hash: hash,
            target_table: event.target_table,
            status: "skipped",
            content_preview: event.content.slice(0, PREVIEW_LEN),
            event_at: event.event_at,
          });
        }
        continue;
      }

      if (dryRun) {
        caught[event.target_table]++;
        continue;
      }

      const target_id = await insertEvent(store, agentId, event);
      if (target_id) {
        caught[event.target_table]++;
        await store.saveCatchUpLog({
          agent_id: agentId,
          source: "conversation",
          content_hash: hash,
          target_table: event.target_table,
          target_id,
          status: "inserted",
          content_preview: event.content.slice(0, PREVIEW_LEN),
          event_at: event.event_at,
        });
      } else {
        await store.saveCatchUpLog({
          agent_id: agentId,
          source: "conversation",
          content_hash: hash,
          target_table: event.target_table,
          status: "failed",
          content_preview: event.content.slice(0, PREVIEW_LEN),
          event_at: event.event_at,
        });
      }
    }
  }

  if (!dryRun) {
    await retryFailed(store, agentId, caught);
  }

  return {
    caught,
    skipped,
    last_checked: new Date().toISOString(),
  };
}

/**
 * Failed retry sweep — re-attempts `status='failed'` ledger rows.
 */
async function retryFailed(
  store: Store,
  agentId: string,
  caught: { decisions: number; task_states: number; knowledge: number }
): Promise<void> {
  const failedRows = await store.getFailedCatchUpLogs(agentId, "conversation");
  if (failedRows.length === 0) return;

  const pending: CatchUpLog[] = [];
  for (const row of failedRows) {
    const alreadyResolved = await store.isCatchUpDuplicate({
      agent_id: agentId,
      content_hash: row.content_hash,
      event_at: row.event_at,
    });
    if (!alreadyResolved) pending.push(row);
  }
  if (pending.length === 0) return;

  const earliest = new Date(pending[0].event_at);
  const retrySince = new Date(earliest.getTime() - 60_000);

  const pendingByHash = new Map<string, CatchUpLog>();
  for (const row of pending) pendingByHash.set(row.content_hash, row);

  const retryFiles = findJsonlFiles(retrySince);
  for (const file of retryFiles) {
    if (pendingByHash.size === 0) break;
    const events = parseJsonl(file, retrySince);
    for (const event of events) {
      if (pendingByHash.size === 0) break;
      const hash = contentHash(event.content);
      if (!pendingByHash.has(hash)) continue;

      const target_id = await insertEvent(store, agentId, event);
      if (target_id) {
        caught[event.target_table]++;
        await store.saveCatchUpLog({
          agent_id: agentId,
          source: "conversation",
          content_hash: hash,
          target_table: event.target_table,
          target_id,
          status: "inserted",
          content_preview: event.content.slice(0, PREVIEW_LEN),
          event_at: event.event_at,
        });
        pendingByHash.delete(hash);
      }
    }
  }
}

/**
 * Dispatch an extracted event into the right store method.
 */
async function insertEvent(
  store: Store,
  agentId: string,
  event: ExtractedEvent
): Promise<string | undefined> {
  try {
    if (event.target_table === "decisions") {
      const row = await store.logDecision({
        agent_id: agentId,
        decision: event.content,
        context: "Captured by catch-up Source A (conversation)",
        tags: event.ticket_id ? [event.ticket_id, "catch-up"] : ["catch-up"],
      });
      return row.id;
    }

    if (event.target_table === "task_states") {
      const row = await store.saveTaskState({
        agent_id: agentId,
        task_id: event.ticket_id,
        task: event.content.slice(0, 200),
        status: event.task_status ?? "in_progress",
        progress: event.content,
        files_modified: event.files_modified,
      });
      return row.id;
    }

    if (event.target_table === "knowledge") {
      const row = await store.saveKnowledge({
        agent_id: agentId,
        title: (event.title ?? event.content.slice(0, 80)).slice(0, 200),
        content: event.content,
        source_type: "messages",
        tags: event.ticket_id ? [event.ticket_id, "catch-up"] : ["catch-up"],
      });
      return row.id;
    }
  } catch (err) {
    process.stderr.write(`[catch-up] insert failed (non-fatal): ${err}\n`);
  }
  return undefined;
}
