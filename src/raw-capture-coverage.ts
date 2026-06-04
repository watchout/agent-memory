import { existsSync, readdirSync, statSync, type Dirent } from "fs";
import { join } from "path";
import { normalizeHomePath, redactText } from "./redact.js";

export type RawCaptureCoverageSource = "claude_code" | "codex";
export type RawCaptureCoverageStatus = "clean" | "degraded" | "failed";
export type RawCaptureCoverageReason =
  | "transcript_root_missing"
  | "capture_scan_error"
  | "unknown_transcript_files"
  | "capture_backlog_pending"
  | "capture_cursor_stale";

export interface InspectRawCaptureCoverageInput {
  source: RawCaptureCoverageSource;
  project?: string;
  root?: string;
  since?: string;
  max_files?: number;
  max_depth?: number;
  cursor_updated_at?: string;
  stale_after_ms?: number;
  pending_events?: number;
}

export interface RawCaptureSourceRef {
  type: "transcript_root" | "unknown_file" | "pending_file" | "cursor";
  source: RawCaptureCoverageSource;
  ref: string;
}

export interface RawCaptureSourceCoverage {
  source: RawCaptureCoverageSource;
  project?: string;
  status: RawCaptureCoverageStatus;
  root_ref?: string;
  known_files: number;
  scanned_files: number;
  unknown_files: number;
  pending_files: number;
  pending_events: number;
  cursor_updated_at?: string;
  cursor_lag_ms?: number;
  reasons: RawCaptureCoverageReason[];
  source_refs: RawCaptureSourceRef[];
}

export interface RawCaptureCoverageReport {
  project?: string;
  status: RawCaptureCoverageStatus;
  checked_at: string;
  sources: RawCaptureSourceCoverage[];
  missing_context: string[];
}

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000;

const MISSING_CONTEXT_BY_REASON: Record<RawCaptureCoverageReason, string> = {
  transcript_root_missing: "raw_capture_unavailable",
  capture_scan_error: "raw_capture_unavailable",
  unknown_transcript_files: "raw_capture_unknown_files",
  capture_backlog_pending: "raw_capture_backlog_pending",
  capture_cursor_stale: "raw_capture_cursor_stale",
};

export function inspectRawCaptureCoverage(input: InspectRawCaptureCoverageInput): RawCaptureCoverageReport {
  const checkedAt = new Date().toISOString();
  const source = inspectRawCaptureSource(input, checkedAt);
  return {
    project: input.project,
    status: source.status,
    checked_at: checkedAt,
    sources: [source],
    missing_context: rawCaptureMissingContext({ sources: [source] }),
  };
}

export function rawCaptureMissingContext(report: Pick<RawCaptureCoverageReport, "sources">): string[] {
  const missing = new Set<string>();
  for (const source of report.sources) {
    for (const reason of source.reasons) missing.add(MISSING_CONTEXT_BY_REASON[reason]);
  }
  return Array.from(missing).sort();
}

export function summarizeRawCaptureCoverage(report: RawCaptureCoverageReport): string[] {
  const notes: string[] = [];
  notes.push(`raw capture coverage status=${report.status}.`);
  for (const source of report.sources) {
    if (source.status === "clean") {
      notes.push(
        `raw capture ${source.source} clean: scanned=${source.scanned_files}, pending_files=0, unknown_files=0.`
      );
      continue;
    }
    notes.push(
      `raw capture ${source.source} ${source.status}: reasons=${source.reasons.join(",")}; ` +
        `known_files=${source.known_files}; scanned=${source.scanned_files}; pending_files=${source.pending_files}; ` +
        `unknown_files=${source.unknown_files}; pending_events=${source.pending_events}.`
    );
  }
  return notes;
}

function inspectRawCaptureSource(
  input: InspectRawCaptureCoverageInput,
  checkedAt: string
): RawCaptureSourceCoverage {
  const reasons = new Set<RawCaptureCoverageReason>();
  const sourceRefs: RawCaptureSourceRef[] = [];
  const maxFiles = Math.max(0, Math.floor(input.max_files ?? DEFAULT_MAX_FILES));
  const maxDepth = Math.max(0, Math.floor(input.max_depth ?? DEFAULT_MAX_DEPTH));
  const sinceMs = input.since ? Date.parse(input.since) : null;
  const rootRef = input.root ? safeRef(input.root) : undefined;
  if (rootRef) sourceRefs.push({ type: "transcript_root", source: input.source, ref: rootRef });

  let knownFiles: string[] = [];
  let unknownFiles: string[] = [];
  let scanFailed = false;
  if (!input.root || !existsSync(input.root)) {
    reasons.add("transcript_root_missing");
  } else {
    const scanned = scanTranscriptRoot(input.root, maxDepth, sinceMs);
    knownFiles = scanned.knownFiles;
    unknownFiles = scanned.unknownFiles;
    scanFailed = scanned.scanFailed;
    if (scanFailed) reasons.add("capture_scan_error");
  }

  if (unknownFiles.length > 0) reasons.add("unknown_transcript_files");
  const pendingFiles = Math.max(0, knownFiles.length - maxFiles);
  const pendingEvents = Math.max(0, Math.floor(input.pending_events ?? 0));
  if (pendingFiles > 0 || pendingEvents > 0) reasons.add("capture_backlog_pending");

  const cursorLagMs = cursorLag(input.cursor_updated_at, checkedAt);
  if (cursorLagMs !== undefined && cursorLagMs > (input.stale_after_ms ?? DEFAULT_STALE_AFTER_MS)) {
    reasons.add("capture_cursor_stale");
  }

  for (const file of unknownFiles.slice(0, 5)) {
    sourceRefs.push({ type: "unknown_file", source: input.source, ref: safeRef(file) });
  }
  for (const file of knownFiles.slice(maxFiles, maxFiles + 5)) {
    sourceRefs.push({ type: "pending_file", source: input.source, ref: safeRef(file) });
  }
  if (input.cursor_updated_at) {
    sourceRefs.push({ type: "cursor", source: input.source, ref: safeRef(input.cursor_updated_at) });
  }

  const reasonList = Array.from(reasons).sort();
  const status: RawCaptureCoverageStatus =
    reasonList.includes("transcript_root_missing") || reasonList.includes("capture_scan_error")
      ? "failed"
      : reasonList.length > 0
        ? "degraded"
        : "clean";

  return {
    source: input.source,
    project: input.project,
    status,
    root_ref: rootRef,
    known_files: knownFiles.length,
    scanned_files: Math.min(knownFiles.length, maxFiles),
    unknown_files: unknownFiles.length,
    pending_files: pendingFiles,
    pending_events: pendingEvents,
    ...(input.cursor_updated_at ? { cursor_updated_at: input.cursor_updated_at } : {}),
    ...(cursorLagMs !== undefined ? { cursor_lag_ms: cursorLagMs } : {}),
    reasons: reasonList,
    source_refs: sourceRefs,
  };
}

function scanTranscriptRoot(
  root: string,
  maxDepth: number,
  sinceMs: number | null
): { knownFiles: string[]; unknownFiles: string[]; scanFailed: boolean } {
  const knownFiles: string[] = [];
  const unknownFiles: string[] = [];
  let scanFailed = false;

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      scanFailed = true;
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(path).mtimeMs;
      } catch {
        scanFailed = true;
        continue;
      }
      if (sinceMs !== null && mtimeMs < sinceMs) continue;
      if (entry.name.endsWith(".jsonl")) {
        knownFiles.push(path);
      } else {
        unknownFiles.push(path);
      }
    }
  };

  walk(root, 1);
  return {
    knownFiles: knownFiles.sort(),
    unknownFiles: unknownFiles.sort(),
    scanFailed,
  };
}

function cursorLag(cursorUpdatedAt: string | undefined, checkedAt: string): number | undefined {
  if (!cursorUpdatedAt) return undefined;
  const cursorMs = Date.parse(cursorUpdatedAt);
  const checkedMs = Date.parse(checkedAt);
  if (Number.isNaN(cursorMs) || Number.isNaN(checkedMs)) return undefined;
  return Math.max(0, checkedMs - cursorMs);
}

function safeRef(value: string): string {
  return redactText(normalizeHomePath(value)).text;
}
