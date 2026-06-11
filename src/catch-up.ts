import { existsSync, readdirSync, statSync, type Dirent } from "fs";
import { join } from "path";
import {
  CLAUDE_PROJECTS_MAX_DEPTH,
  getClaudeProjectsDir,
} from "./claude-conversation-ingest.js";
import {
  CODEX_SESSIONS_MAX_DEPTH,
  getCodexSessionsDir,
} from "./codex-conversation-ingest.js";
import { normalizeHomePath, redactText } from "./redact.js";

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
