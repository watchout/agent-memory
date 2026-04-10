/**
 * AM-026: Catch-up Source A — Claude Code conversation log parser.
 *
 * Background:
 *   The PostToolUse hook (FEAT-025 / AM-016) records `[TASK:*]`,
 *   `[DECISION]`, and `[KNOWLEDGE]` tags into agent-memory in real
 *   time. But sessions where the hook isn't installed yet, or
 *   sessions that ran before AM-016 landed, leave gaps in the
 *   record. The catch-up flow walks `~/.claude/projects/.../*.jsonl`
 *   files modified since the previous sweep, extracts the same
 *   tag/tool-use events the hook would have caught, and writes
 *   them into the store with dedup against the per-event ledger
 *   table `catch_up_log`.
 *
 * Source A in this file = jsonl conversation logs. A future Source B
 * (Discord history) is planned but out of scope for AM-026.
 *
 * Design refs:
 *   - knowledge id `AM-026 詳細設計ドラフト 2/3` — types + module shape
 *   - knowledge id `AM-026 詳細設計ドラフト 3/3` — MCP tool + dedup decisions
 *   - issue #58 — ARC review conditions (5 gates: schema/SSOT/tests/maxDepth/content_hash)
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync, readdirSync, existsSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  Store,
  CatchUpInput,
  CatchUpResult,
  CatchUpLog,
} from "./stores/types.js";

/** Hard cap on glob recursion depth — ARC condition #4 (`maxDepth=3`). */
export const MAX_PROJECTS_GLOB_DEPTH = 3;

/** Default lookback when no prior catch_up_log row exists for an agent. */
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Cap on the content_preview column so it stays log-friendly. */
const PREVIEW_LEN = 200;

/**
 * Internal shape produced by `extractFromRecord`. Not exported as
 * a public type because callers only see the aggregate `CatchUpResult`.
 */
export interface ExtractedEvent {
  target_table: "decisions" | "task_states" | "knowledge";
  /** Hashed and dedup-keyed. */
  content: string;
  /** Display title for knowledge entries. Ignored for the others. */
  title?: string;
  /** Mirrors save_task_state.status when target_table === 'task_states'. */
  task_status?: "in_progress" | "completed" | "blocked";
  /** Files touched, used for save_task_state.files_modified. */
  files_modified?: string[];
  /** ISO8601 from the source jsonl line. */
  event_at: string;
  /** Optional ticket id (AM-026, FEAT-025, etc) extracted from content. */
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
 * after `since`. Hard-capped at `MAX_PROJECTS_GLOB_DEPTH` levels deep
 * (ARC condition #4) so an unexpectedly deep tree can't blow up RAM.
 *
 * Returns absolute paths.
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
 * Iterate over jsonl lines whose `timestamp` field is at or after
 * `since`. Lines that don't parse, lack a timestamp, or are older
 * than `since` are skipped. Order is whatever the file uses (we don't
 * sort — caller does dedup by content_hash + ±60s window).
 */
export function parseJsonl(path: string, since: Date): ExtractedEvent[] {
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
    events.push(...extractFromRecord(record as Record<string, unknown>));
  }
  return events;
}

/**
 * Convert a single jsonl record into zero or more extractable events.
 *
 * Rules (per design draft 2/3):
 *   1. assistant tool_use Edit|Write    → task_state (files_modified)
 *   2. assistant tool_use Bash + commit → knowledge (commit msg)
 *   3. assistant tool_use Bash + tests  → knowledge (test run)
 *   4. assistant text [TASK:*]          → task_state
 *   5. assistant text [DECISION]        → decision
 *   6. assistant text [KNOWLEDGE]       → knowledge
 *
 * The hook (post-tool-hook.ts) handles tags in *outgoing* messages,
 * but assistant text in jsonl is only captured here. We deliberately
 * skip user records — the user can't post tags into their own memory.
 */
export function extractFromRecord(record: Record<string, unknown>): ExtractedEvent[] {
  if (record.type !== "assistant") return [];
  const message = record.message as { content?: unknown } | undefined;
  if (!message || !Array.isArray(message.content)) return [];

  const ts = record.timestamp as string;
  const events: ExtractedEvent[] = [];

  for (const block of message.content as Array<Record<string, unknown>>) {
    if (block.type === "tool_use") {
      events.push(...extractFromToolUse(block, ts));
    } else if (block.type === "text" && typeof block.text === "string") {
      events.push(...extractFromText(block.text, ts));
    }
  }
  return events;
}

function extractFromToolUse(block: Record<string, unknown>, event_at: string): ExtractedEvent[] {
  const name = block.name as string;
  const input = (block.input as Record<string, unknown>) ?? {};

  // Rule 1: Edit / Write → task_state with files_modified
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
    // Rule 2: git commit → knowledge entry capturing the commit text
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
    // Rule 3: test run → knowledge entry recording the invocation
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
 *
 * Ledger semantics (BLOCK fixes #1 / #2 / #3):
 *   - On a successful insert into the target table: write a
 *     ledger row with `status='inserted'`. This is the only
 *     row type that subsequently dedups via `isCatchUpDuplicate`.
 *   - On a duplicate (dedup hit): write a ledger row with
 *     `status='skipped'` for forensic trail. These rows do NOT
 *     dedup later runs (status filter on the lookup).
 *   - On a target-table insert failure: write a ledger row with
 *     `status='failed'`. These rows do NOT dedup later runs, so
 *     a transient fs/network error doesn't permanently block
 *     the retry.
 *   - On `dry_run=true`: write **no** ledger rows. Writing a
 *     `status='dry_run'` row would otherwise poison the next
 *     real run via the dedup window.
 */
export async function catchUp(
  store: Store,
  agentId: string,
  input: CatchUpInput = {}
): Promise<CatchUpResult> {
  const source = input.source ?? "all";
  const dryRun = input.dry_run === true;

  // Source B is reserved; the {source: 'discord'} branch is a no-op
  // until a future PR. {source: 'all'} just runs Source A for now.
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
      : new Date(Date.now() - DEFAULT_LOOKBACK_MS);
  }

  const caught = { decisions: 0, task_states: 0, knowledge: 0 };
  let skipped = 0;

  // Find candidate jsonl files (mtime >= since), then per-line filter.
  const files = findJsonlFiles(since);
  for (const file of files) {
    const events = parseJsonl(file, since);
    for (const event of events) {
      const hash = contentHash(event.content);
      const dup = await store.isCatchUpDuplicate({
        agent_id: agentId,
        content_hash: hash,
        event_at: event.event_at,
      });

      // ── Duplicate path (BLOCK fix #3) ──
      // Record `status='skipped'` for forensic trail. The dedup
      // lookup ignores skipped rows, so this doesn't poison
      // future runs. Only write the ledger row in real runs;
      // dry_run never touches the ledger (BLOCK fix #1).
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

      // ── dry_run path (BLOCK #1 + BLOCK #4) ──
      // Skip both the target-table insert AND the ledger write.
      // Writing a `status='dry_run'` ledger row would otherwise
      // poison the next real run via `isCatchUpDuplicate` (the
      // original AM-026 BLOCK #1 the auditor flagged).
      //
      // BLOCK #4 (round 2): the tool description promises "report
      // counts but do not insert" — so increment the `caught`
      // counter even in dry_run, mirroring what a real sweep
      // would have inserted. Only the side effects (target row
      // INSERT + ledger row) are suppressed.
      if (dryRun) {
        caught[event.target_table]++;
        continue;
      }

      // ── Real insert path (BLOCK fix #2) ──
      // Try the target-table insert first. Only write a ledger
      // row reflecting the *actual* outcome (`inserted` on
      // success, `failed` on exception). A `failed` row does
      // not dedup, so the retry path is unblocked.
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

  // ── Failed retry path (BLOCK #1 round 2) ──
  // The normal sweep above advances `since` past any past event_at,
  // so a `status='failed'` row left over from an earlier sweep would
  // never be re-attempted by the cursor-driven path. CTO option (ii):
  // walk the ledger for `failed` rows, re-parse jsonl files in a window
  // around their event_at, and re-attempt the underlying insert.
  //
  // dry_run never touches state, so the retry loop is skipped during
  // a preview run.
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
 * BLOCK #1 (round 2) — failed retry sweep.
 *
 * Reads `status='failed'` ledger rows for the agent, filters out any
 * that have since been resolved (an `inserted` row exists at the same
 * `content_hash` within ±60s of the failed `event_at`), and walks the
 * jsonl files starting from `(earliest pending failure - 60s)` to
 * locate the underlying event by `content_hash`. Re-attempts the
 * insert and writes a fresh `inserted` ledger row on success. The
 * original `failed` row is preserved as forensic trail; subsequent
 * retry sweeps will skip it because `isCatchUpDuplicate` now reports
 * the row as deduped.
 *
 * The `caught` accumulator is mutated in-place so successful retries
 * surface in the final `CatchUpResult`.
 */
async function retryFailed(
  store: Store,
  agentId: string,
  caught: { decisions: number; task_states: number; knowledge: number }
): Promise<void> {
  const failedRows = await store.getFailedCatchUpLogs(agentId, "conversation");
  if (failedRows.length === 0) return;

  // Filter out failures already resolved by a later successful insert.
  // This keeps the retry loop O(1) per stale failure on subsequent
  // sweeps, instead of re-walking jsonl files for nothing.
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

  // Earliest pending failure sets the lower bound for the retry walk.
  const earliest = new Date(pending[0].event_at);
  const retrySince = new Date(earliest.getTime() - 60_000);

  // Map content_hash → failed row for O(1) lookup during the walk.
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
      // On retry-failure: leave the original `failed` row alone, do
      // not write another `failed` row (would just duplicate the
      // forensic trail). The next sweep will try again.
    }
  }
}

/**
 * Dispatch an extracted event into the right store method. Returns
 * the inserted row's id, or undefined if the insert failed
 * non-fatally (we want catch-up to keep going past one bad row).
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
