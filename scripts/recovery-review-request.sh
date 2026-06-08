#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEMORY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_DIR=""
AGENT_ID="${AGENT_MEMORY_AGENT_ID:-}"
PROJECT="${AGENT_MEMORY_PROJECT:-}"
HOST="${AGENT_MEMORY_HOST:-unknown}"
CHANNEL="${AGENT_MEMORY_RECOVERY_REVIEW_CHANNEL:-agent-mem}"
MENTIONS="${AGENT_MEMORY_RECOVERY_REVIEW_MENTIONS:-}"
SENDER_AGENT_ID="${AGENT_MEMORY_RECOVERY_REVIEW_SENDER_AGENT_ID:-agent-mem-dev}"
AUN_ROOT="${AGENT_MEMORY_AUN_ROOT:-/Users/yuji/Developer/codex-aun/agent-comms-mcp-main}"
BUN_BIN="${AGENT_MEMORY_BUN_BIN:-/Users/yuji/.bun/bin/bun}"
DATABASE_URL_VALUE="${DATABASE_URL:-postgresql:///agent_comms?host=/tmp}"
LEDGER_FILE="${AGENT_MEMORY_RECOVERY_REVIEW_LEDGER:-${HOME}/.agent-memory/recovery-review-events.jsonl}"
DB_SCRIPT="${AGENT_MEMORY_RECOVERY_REVIEW_DB_SCRIPT:-${MEMORY_ROOT}/dist/recovery-review-db.js}"
PRINT=0
DRY_RUN=0
RECORD_RESPONSE=0
RESPONSE_FILE=""
RESPONSE_TEXT=""
REVIEW_ID=""
RECOVERED_OBJECTIVE=""
CAN_CONTINUE_WITHOUT_USER_RESTATE=""
MISSING_CONTEXT=""
TOO_MUCH_CONTEXT=""
WRONG_OR_STALE_CONTEXT=""
USEFUL_CONTEXT=""
SEARCH_MEMORY_USED=""
SEARCH_QUERY=""
RECOMMENDED_TUNING=""
SCORE=""

usage() {
  cat >&2 <<'EOF'
usage: recovery-review-request.sh --run-dir DIR [options]

Creates or records recovery-quality evaluation data for an internal dogfood run.
This is not L1/L2/L3 governance approval.

Options:
  --run-dir DIR       Codex recovery run directory.
  --agent-id ID       Target agent id.
  --project PROJECT   Target project.
  --host HOST         Host name, usually codex or claude.
  --ledger FILE       JSONL evaluation ledger. Default:
                      ~/.agent-memory/recovery-review-events.jsonl
  --review-id ID      Stable review id. Defaults to the run id.
  --channel CHANNEL   AUN channel for optional notify. Default: agent-mem.
  --mentions IDS      Comma-separated AUN recipients for optional notify.
  --sender-agent ID   AUN sender agent id. Default: agent-mem-dev.
  --print             Print the generated review request to stdout.
  --dry-run           Do not send AUN notify even when --mentions is provided.
  --record-response   Record an evaluation response instead of creating a request.
  --response-file FILE
                      Read evaluation response text from FILE.
  --response-text TEXT
                      Evaluation response text.
  --recovered-objective VALUE
                      yes | partial | no, when known.
  --can-continue VALUE
                      yes | partial | no, when known.
  --missing-context TEXT
  --too-much-context TEXT
  --wrong-or-stale-context TEXT
  --useful-context TEXT
  --search-memory-used VALUE
                      yes | no, when known.
  --search-query TEXT
  --recommended-tuning TEXT
  --score N           1-5, when known.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-dir)
      RUN_DIR="$2"
      shift 2
      ;;
    --agent-id)
      AGENT_ID="$2"
      shift 2
      ;;
    --project)
      PROJECT="$2"
      shift 2
      ;;
    --host)
      HOST="$2"
      shift 2
      ;;
    --ledger)
      LEDGER_FILE="$2"
      shift 2
      ;;
    --review-id)
      REVIEW_ID="$2"
      shift 2
      ;;
    --channel)
      CHANNEL="$2"
      shift 2
      ;;
    --mentions)
      MENTIONS="$2"
      shift 2
      ;;
    --sender-agent)
      SENDER_AGENT_ID="$2"
      shift 2
      ;;
    --print)
      PRINT=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --record-response)
      RECORD_RESPONSE=1
      shift
      ;;
    --response-file)
      RESPONSE_FILE="$2"
      shift 2
      ;;
    --response-text)
      RESPONSE_TEXT="$2"
      shift 2
      ;;
    --recovered-objective)
      RECOVERED_OBJECTIVE="$2"
      shift 2
      ;;
    --can-continue)
      CAN_CONTINUE_WITHOUT_USER_RESTATE="$2"
      shift 2
      ;;
    --missing-context)
      MISSING_CONTEXT="$2"
      shift 2
      ;;
    --too-much-context)
      TOO_MUCH_CONTEXT="$2"
      shift 2
      ;;
    --wrong-or-stale-context)
      WRONG_OR_STALE_CONTEXT="$2"
      shift 2
      ;;
    --useful-context)
      USEFUL_CONTEXT="$2"
      shift 2
      ;;
    --search-memory-used)
      SEARCH_MEMORY_USED="$2"
      shift 2
      ;;
    --search-query)
      SEARCH_QUERY="$2"
      shift 2
      ;;
    --recommended-tuning)
      RECOMMENDED_TUNING="$2"
      shift 2
      ;;
    --score)
      SCORE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[recovery-review-request] unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "${RUN_DIR}" ]]; then
  echo "[recovery-review-request] --run-dir is required" >&2
  exit 2
fi

mkdir -p "${RUN_DIR}"
OUT_FILE="${RUN_DIR}/recovery-review-request.md"
REQUEST_JSON_FILE="${RUN_DIR}/recovery-review-request.json"
RESPONSE_JSON_FILE="${RUN_DIR}/recovery-review-response.json"
SEND_RESULT_FILE="${RUN_DIR}/recovery-review-aun-result.json"

if [[ "${RECORD_RESPONSE}" == "1" ]]; then
  RESPONSE_INPUT_FILE="${RUN_DIR}/recovery-review-response-input.txt"
  if [[ -n "${RESPONSE_FILE}" ]]; then
    if [[ ! -f "${RESPONSE_FILE}" ]]; then
      echo "[recovery-review-request] response file not found: ${RESPONSE_FILE}" >&2
      exit 1
    fi
    RESPONSE_INPUT_FILE="${RESPONSE_FILE}"
  elif [[ -n "${RESPONSE_TEXT}" ]]; then
    printf '%s\n' "${RESPONSE_TEXT}" > "${RESPONSE_INPUT_FILE}"
  elif [[ ! -t 0 ]]; then
    cat > "${RESPONSE_INPUT_FILE}"
  else
    echo "[recovery-review-request] --record-response requires --response-file, --response-text, or stdin" >&2
    exit 2
  fi

  node - \
    "${RUN_DIR}" \
    "${REQUEST_JSON_FILE}" \
    "${RESPONSE_JSON_FILE}" \
    "${LEDGER_FILE}" \
    "${RESPONSE_INPUT_FILE}" \
    "${REVIEW_ID}" \
    "${AGENT_ID}" \
    "${PROJECT}" \
    "${HOST}" \
    "${RECOVERED_OBJECTIVE}" \
    "${CAN_CONTINUE_WITHOUT_USER_RESTATE}" \
    "${MISSING_CONTEXT}" \
    "${TOO_MUCH_CONTEXT}" \
    "${WRONG_OR_STALE_CONTEXT}" \
    "${USEFUL_CONTEXT}" \
    "${SEARCH_MEMORY_USED}" \
    "${SEARCH_QUERY}" \
    "${RECOMMENDED_TUNING}" \
    "${SCORE}" <<'NODE'
const fs = require("fs");
const path = require("path");
const [
  runDir,
  requestJsonFile,
  responseJsonFile,
  ledgerFile,
  responseInputFile,
  reviewIdArg,
  agentIdArg,
  projectArg,
  hostArg,
  recoveredObjective,
  canContinue,
  missingContext,
  tooMuchContext,
  wrongOrStaleContext,
  usefulContext,
  searchMemoryUsed,
  searchQuery,
  recommendedTuning,
  scoreArg,
] = process.argv.slice(2);

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(runDir, name), "utf8"));
  } catch {
    return null;
  }
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function appendLedger(event) {
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  fs.appendFileSync(ledgerFile, `${JSON.stringify(event)}\n`);
}

function compact(value) {
  return value === "" ? undefined : value;
}

const request = readJsonFile(requestJsonFile) || {};
const boot = readJson("boot-result.json") || {};
const run = readJson("run-status.json") || {};
const config = readJson("run-config.json") || {};
const health = readJson("context-health.json") || {};
const notes = boot.notes && typeof boot.notes === "object" ? boot.notes : {};
const runId = path.basename(runDir);
const reviewId = reviewIdArg || request.review_id || runId;
const agentId = agentIdArg || request.agent_id || boot.agent_id || config.agent_id || "";
const project = projectArg || request.project || boot.project || config.project || "";
const host = hostArg || request.host || health.host || "unknown";
const score = scoreArg === "" ? undefined : Number(scoreArg);
const recordedAt = new Date().toISOString();
const responseText = fs.readFileSync(responseInputFile, "utf8");

const response = {
  recovered_objective: compact(recoveredObjective),
  can_continue_without_user_restate: compact(canContinue),
  missing_context: compact(missingContext),
  too_much_context: compact(tooMuchContext),
  wrong_or_stale_context: compact(wrongOrStaleContext),
  useful_context: compact(usefulContext),
  search_memory_used: compact(searchMemoryUsed),
  search_query: compact(searchQuery),
  recommended_tuning: compact(recommendedTuning),
  score,
};
for (const key of Object.keys(response)) {
  if (response[key] === undefined || Number.isNaN(response[key])) {
    delete response[key];
  }
}

const payload = {
  schema_version: 1,
  type: "recovery_review_response",
  review_id: reviewId,
  run_id: runId,
  run_dir: runDir,
  recovery_log_id: request.recovery_log_id || boot.recovery_log_id || null,
  agent_id: agentId,
  project,
  host,
  recorded_at: recordedAt,
  request_file: fs.existsSync(requestJsonFile) ? requestJsonFile : null,
  response_text: responseText,
  response,
  evidence: {
    boot_status: boot.status || null,
    recovery_log_id: request.recovery_log_id || boot.recovery_log_id || null,
    recovered_tokens: boot.recovered_tokens ?? null,
    messages: notes.messages ?? null,
    raw_events: notes.raw_events ?? null,
    tasks_in_progress: notes.tasks_in_progress ?? null,
    run_status: run.status || null,
    context_health: health.band || health.reason || null,
  },
};

fs.writeFileSync(responseJsonFile, `${JSON.stringify(payload, null, 2)}\n`);
appendLedger({
  schema_version: 1,
  event_type: "response",
  review_id: reviewId,
  run_id: runId,
  run_dir: runDir,
  agent_id: agentId,
  project,
  host,
  recorded_at: recordedAt,
  response_file: responseJsonFile,
  response,
  response_text: responseText,
});
NODE
  if [[ "${AGENT_MEMORY_RECOVERY_REVIEW_DB:-1}" == "1" && -f "${DB_SCRIPT}" ]]; then
    if ! DATABASE_URL="${DATABASE_URL_VALUE}" node "${DB_SCRIPT}" --event-file "${RESPONSE_JSON_FILE}" >/dev/null; then
      echo "[recovery-review-request] DB record failed for response (non-fatal)" >&2
    fi
  fi
  exit 0
fi

node - \
  "${RUN_DIR}" \
  "${OUT_FILE}" \
  "${REQUEST_JSON_FILE}" \
  "${LEDGER_FILE}" \
  "${REVIEW_ID}" \
  "${AGENT_ID}" \
  "${PROJECT}" \
  "${HOST}" <<'NODE'
const fs = require("fs");
const path = require("path");
const [
  runDir,
  outFile,
  requestJsonFile,
  ledgerFile,
  reviewIdArg,
  agentIdArg,
  projectArg,
  hostArg,
] = process.argv.slice(2);

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(runDir, name), "utf8"));
  } catch {
    return null;
  }
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readText(name, maxChars = 1800) {
  try {
    const text = fs.readFileSync(path.join(runDir, name), "utf8");
    return text.length > maxChars
      ? `${text.slice(0, maxChars)}\n[TRUNCATED ${text.length - maxChars} chars]`
      : text;
  } catch {
    return "";
  }
}

function appendLedger(event) {
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  fs.appendFileSync(ledgerFile, `${JSON.stringify(event)}\n`);
}

const boot = readJson("boot-result.json") || {};
const run = readJson("run-status.json") || {};
const verify = readJson("verify-result.json") || {};
const health = readJson("context-health.json") || {};
const config = readJson("run-config.json") || {};
const notes = boot.notes && typeof boot.notes === "object" ? boot.notes : {};
const promptHead = readText("prompt.txt", 1600);
const existing = readJsonFile(requestJsonFile) || {};
const runId = path.basename(runDir);
const reviewId = reviewIdArg || existing.review_id || runId;
const requestedAt = new Date().toISOString();

const agentId = agentIdArg || boot.agent_id || config.agent_id || "";
const project = projectArg || boot.project || config.project || "";
const host = hostArg || health.host || "unknown";
const evidence = {
  boot_status: boot.status || null,
  recovery_log_id: boot.recovery_log_id || null,
  recovered_tokens: boot.recovered_tokens ?? null,
  messages: notes.messages ?? null,
  raw_events: notes.raw_events ?? null,
  tasks_in_progress: notes.tasks_in_progress ?? null,
  run_status: run.status || null,
  verify_status: verify.status || null,
  context_health: health.band || health.reason || null,
};

const lines = [
  "# Recovery Evaluation Request",
  "",
  "This is an internal dogfood evaluation request for Wasurezu startup recovery quality.",
  "It is not L1/L2/L3 governance approval unless separately routed through the governance gate.",
  "",
  "## Run Evidence",
  "",
  `- review_id: \`${reviewId}\``,
  `- run_id: \`${runId}\``,
  `- run_dir: \`${runDir}\``,
  `- recovery_log_id: \`${boot.recovery_log_id || ""}\``,
  `- agent_id: \`${agentId || "unknown"}\``,
  `- project: \`${project || "unknown"}\``,
  `- host: \`${host}\``,
  `- boot_status: \`${evidence.boot_status || "missing"}\``,
  `- recovered_tokens: \`${evidence.recovered_tokens ?? "unknown"}\``,
  `- messages: \`${evidence.messages ?? "unknown"}\``,
  `- raw_events: \`${evidence.raw_events ?? "unknown"}\``,
  `- tasks_in_progress: \`${evidence.tasks_in_progress ?? "unknown"}\``,
  `- run_status: \`${evidence.run_status || "missing"}\``,
  `- verify_status: \`${evidence.verify_status || "missing"}\``,
  `- context_health: \`${evidence.context_health || "missing"}\``,
  `- response_recording: \`scripts/recovery-review-request.sh --run-dir ${runDir} --record-response\``,
  "",
  "## Evaluation Questions",
  "",
  "Call `mcp__wasurezu__record_recovery_review` before any prose reply, using these fields. If that tool is unavailable, reply with the same compact fields so an operator can record it:",
  "",
  `- \`review_id\`: \`${reviewId}\``,
  `- \`run_id\`: \`${runId}\``,
  `- \`run_dir\`: \`${runDir}\``,
  `- \`recovery_log_id\`: \`${boot.recovery_log_id || ""}\``,
  "- `recovered_objective`: yes / partial / no",
  "- `can_continue_without_user_restate`: yes / partial / no",
  "- `missing_context`: concrete bullets, or `none`",
  "- `too_much_context`: concrete bullets, or `none`",
  "- `wrong_or_stale_context`: concrete bullets, or `none`",
  "- `useful_context`: concrete bullets",
  "- `search_memory_used`: yes / no; include query if used",
  "- `recommended_tuning`: what to add/remove/re-rank in recovery pack",
  "- `score`: 1-5, where 5 means ready to continue work immediately",
  "",
  "## Prompt Preview",
  "",
  "```text",
  promptHead || "[prompt.txt missing]",
  "```",
  "",
];

fs.writeFileSync(outFile, lines.join("\n") + "\n");
const request = {
  schema_version: 1,
  type: "recovery_review_request",
  review_id: reviewId,
  run_id: runId,
  run_dir: runDir,
  recovery_log_id: boot.recovery_log_id || null,
  agent_id: agentId,
  project,
  host,
  requested_at: requestedAt,
  evidence,
  files: {
    request_markdown: outFile,
    request_json: requestJsonFile,
    response_json: path.join(runDir, "recovery-review-response.json"),
    ledger_jsonl: ledgerFile,
  },
  questions: [
    "recovered_objective",
    "can_continue_without_user_restate",
    "missing_context",
    "too_much_context",
    "wrong_or_stale_context",
    "useful_context",
    "search_memory_used",
    "recommended_tuning",
    "score",
  ],
};
fs.writeFileSync(requestJsonFile, `${JSON.stringify(request, null, 2)}\n`);
appendLedger({
  schema_version: 1,
  event_type: "request",
  review_id: reviewId,
  run_id: runId,
  run_dir: runDir,
  agent_id: agentId,
  project,
  host,
  requested_at: requestedAt,
  request_file: requestJsonFile,
  request_markdown_file: outFile,
  evidence,
});
NODE

if [[ "${AGENT_MEMORY_RECOVERY_REVIEW_DB:-1}" == "1" && -f "${DB_SCRIPT}" ]]; then
  if ! DATABASE_URL="${DATABASE_URL_VALUE}" node "${DB_SCRIPT}" --event-file "${REQUEST_JSON_FILE}" >/dev/null; then
    echo "[recovery-review-request] DB record failed for request (non-fatal)" >&2
  fi
fi

if [[ "${PRINT}" == "1" ]]; then
  cat "${OUT_FILE}"
fi

if [[ -n "${MENTIONS}" && "${DRY_RUN}" != "1" ]]; then
  if [[ ! -x "${BUN_BIN}" ]]; then
    echo "[recovery-review-request] bun not found: ${BUN_BIN}" >&2
    exit 1
  fi
  if [[ ! -f "${AUN_ROOT}/bin/aun.ts" ]]; then
    echo "[recovery-review-request] AUN CLI not found: ${AUN_ROOT}/bin/aun.ts" >&2
    exit 1
  fi
  CONTENT="$(cat "${OUT_FILE}")"
  env -u AGENT_COM_EXPECTED_AGENT_ID \
    AGENT_ID="${SENDER_AGENT_ID}" \
    DATABASE_URL="${DATABASE_URL_VALUE}" \
    "${BUN_BIN}" "${AUN_ROOT}/bin/aun.ts" notify \
      --agent-id "${SENDER_AGENT_ID}" \
      --channel "${CHANNEL}" \
      --content "${CONTENT}" \
      --mentions "${MENTIONS}" \
      --message-type instruction > "${SEND_RESULT_FILE}"
  node - "${REQUEST_JSON_FILE}" "${LEDGER_FILE}" "${SEND_RESULT_FILE}" "${CHANNEL}" "${MENTIONS}" "${SENDER_AGENT_ID}" <<'NODE'
const fs = require("fs");
const path = require("path");
const [requestJsonFile, ledgerFile, sendResultFile, channel, mentions, senderAgentId] = process.argv.slice(2);
const request = JSON.parse(fs.readFileSync(requestJsonFile, "utf8"));
fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
fs.appendFileSync(ledgerFile, `${JSON.stringify({
  schema_version: 1,
  event_type: "aun_notify",
  review_id: request.review_id,
  run_id: request.run_id,
  run_dir: request.run_dir,
  agent_id: request.agent_id,
  project: request.project,
  host: request.host,
  sent_at: new Date().toISOString(),
  channel,
  mentions,
  sender_agent_id: senderAgentId,
  send_result_file: sendResultFile,
})}\n`);
NODE
fi
