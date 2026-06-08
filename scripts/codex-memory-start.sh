#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEMORY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

CODEX_BIN="${CODEX_BIN:-codex}"
BOOT_ONLY=0
WORKDIR="${PWD}"
CODEX_ARGS=()
CODEX_START_MODE="${AGENT_MEMORY_CODEX_START_MODE:-interactive}"
CODEX_SANDBOX="${AGENT_MEMORY_CODEX_SANDBOX:-danger-full-access}"
CODEX_APPROVAL="${AGENT_MEMORY_CODEX_APPROVAL:-never}"
CODEX_BYPASS_APPROVALS_AND_SANDBOX="${AGENT_MEMORY_CODEX_BYPASS_APPROVALS_AND_SANDBOX:-0}"
CODEX_SKIP_GIT_REPO_CHECK="${AGENT_MEMORY_CODEX_SKIP_GIT_REPO_CHECK:-1}"
RECOVERY_REVIEW="${AGENT_MEMORY_RECOVERY_REVIEW:-0}"
RECOVERY_REVIEW_INJECT="${AGENT_MEMORY_RECOVERY_REVIEW_INJECT:-${RECOVERY_REVIEW}}"

usage() {
  cat >&2 <<'EOF'
usage: codex-memory-start.sh [options] [--] [codex args...]

Options:
  --agent-id ID       Agent id for agent-memory
  --project PROJECT   Project id for agent-memory
  --cwd DIR           Working directory for Codex
  --codex-bin PATH    Codex executable (default: codex)
  --mode MODE         Default Codex mode when no codex args are supplied
                      interactive | exec | exec-json | resume-last
  --codex-sandbox MODE
                      Default sandbox mode (default: danger-full-access)
  --codex-approval POLICY
                      Default approval policy (default: never)
  --skip-git-repo-check 0|1
                      Pass Codex --skip-git-repo-check by default (default: 1)
  --boot-only         Run deterministic recovery and print the injected prompt

All remaining args are passed to Codex. If a prompt is supplied, the recovery
context is prepended to that prompt. If no prompt is supplied, Codex starts with
a recovery-only startup prompt. The wrapper adds full access / approval-never
defaults unless Codex args already specify sandbox or approval options.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent-id)
      export AGENT_MEMORY_AGENT_ID="$2"
      shift 2
      ;;
    --project)
      export AGENT_MEMORY_PROJECT="$2"
      shift 2
      ;;
    --cwd)
      WORKDIR="$2"
      shift 2
      ;;
    --codex-bin)
      CODEX_BIN="$2"
      shift 2
      ;;
    --mode)
      CODEX_START_MODE="$2"
      shift 2
      ;;
    --codex-sandbox)
      CODEX_SANDBOX="$2"
      shift 2
      ;;
    --codex-approval)
      CODEX_APPROVAL="$2"
      shift 2
      ;;
    --skip-git-repo-check)
      CODEX_SKIP_GIT_REPO_CHECK="$2"
      shift 2
      ;;
    --boot-only)
      BOOT_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      CODEX_ARGS+=("$@")
      break
      ;;
    *)
      CODEX_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ "${BOOT_ONLY}" -eq 1 && "${AGENT_MEMORY_BOOT_ONLY_LIVE_REVIEW:-0}" != "1" ]]; then
  export AGENT_MEMORY_RECOVERY_REVIEW_DB="0"
  export AGENT_MEMORY_RECOVERY_REVIEW_DRY_RUN="1"
fi

export AGENT_MEMORY_HOST="${AGENT_MEMORY_HOST:-codex}"
export AGENT_MEMORY_CAPTURE_MODE="${AGENT_MEMORY_CAPTURE_MODE:-raw}"
export AGENT_MEMORY_TAG_CAPTURE="${AGENT_MEMORY_TAG_CAPTURE:-0}"
export AGENT_MEMORY_BOOT_CATCH_UP="${AGENT_MEMORY_BOOT_CATCH_UP:-0}"
export AGENT_MEMORY_INDEXER_MODE="${AGENT_MEMORY_INDEXER_MODE:-rules}"
export AGENT_MEMORY_AI_EXTRACTOR="${AGENT_MEMORY_AI_EXTRACTOR:-off}"
export AGENT_MEMORY_REDACTION_MODE="${AGENT_MEMORY_REDACTION_MODE:-basic}"
export AGENT_MEMORY_CODEX_START_MODE="${CODEX_START_MODE}"
export AGENT_MEMORY_CODEX_SANDBOX="${CODEX_SANDBOX}"
export AGENT_MEMORY_CODEX_APPROVAL="${CODEX_APPROVAL}"
export AGENT_MEMORY_CODEX_SKIP_GIT_REPO_CHECK="${CODEX_SKIP_GIT_REPO_CHECK}"

# This wrapper may be invoked from inside another Codex session by a supervisor
# or operator. Never let the caller's thread id make boot import the caller's
# transcript into the target bot/project.
unset CODEX_THREAD_ID

if [[ -z "${AGENT_MEMORY_PROJECT:-}" ]]; then
  export AGENT_MEMORY_PROJECT="$(basename "${WORKDIR}")"
fi
if [[ -z "${AGENT_MEMORY_AGENT_ID:-}" ]]; then
  export AGENT_MEMORY_AGENT_ID="${AGENT_MEMORY_PROJECT}"
fi

export AGENT_MEMORY_AUN_ENABLED="${AGENT_MEMORY_AUN_ENABLED:-0}"
export AGENT_MEMORY_AUN_AGENT_ID="${AGENT_MEMORY_AUN_AGENT_ID:-${AGENT_MEMORY_AGENT_ID}}"
export AGENT_MEMORY_AUN_EXPECTED_AGENT_ID="${AGENT_MEMORY_AUN_EXPECTED_AGENT_ID:-${AGENT_MEMORY_AUN_AGENT_ID}}"
export AGENT_MEMORY_AUN_WEBHOOK_PORT="${AGENT_MEMORY_AUN_WEBHOOK_PORT:-}"
export AGENT_MEMORY_AUN_DISCORD_STATE_DIR="${AGENT_MEMORY_AUN_DISCORD_STATE_DIR:-}"
export AGENT_MEMORY_AGENT_COMMS_ENABLED="${AGENT_MEMORY_AGENT_COMMS_ENABLED:-0}"
export AGENT_MEMORY_AGENT_COMMS_AGENT_ID="${AGENT_MEMORY_AGENT_COMMS_AGENT_ID:-${AGENT_MEMORY_AGENT_ID}}"
export AGENT_MEMORY_AGENT_COMMS_EXPECTED_AGENT_ID="${AGENT_MEMORY_AGENT_COMMS_EXPECTED_AGENT_ID:-${AGENT_MEMORY_AGENT_COMMS_AGENT_ID}}"
export AGENT_MEMORY_AGENT_COMMS_WEBHOOK_PORT="${AGENT_MEMORY_AGENT_COMMS_WEBHOOK_PORT:-}"
export AGENT_MEMORY_AGENT_COMMS_DISCORD_STATE_DIR="${AGENT_MEMORY_AGENT_COMMS_DISCORD_STATE_DIR:-}"

if [[ "${AGENT_MEMORY_AUN_ENABLED}" == "1" ]]; then
  if [[ "${AGENT_MEMORY_AUN_AGENT_ID}" != "${AGENT_MEMORY_AGENT_ID}" ||
        "${AGENT_MEMORY_AUN_EXPECTED_AGENT_ID}" != "${AGENT_MEMORY_AGENT_ID}" ]]; then
    echo "[codex-memory-start] AUN runtime binding mismatch: AGENT_MEMORY_AGENT_ID=${AGENT_MEMORY_AGENT_ID}, AGENT_MEMORY_AUN_AGENT_ID=${AGENT_MEMORY_AUN_AGENT_ID}, AGENT_MEMORY_AUN_EXPECTED_AGENT_ID=${AGENT_MEMORY_AUN_EXPECTED_AGENT_ID}" >&2
    exit 2
  fi
fi
if [[ "${AGENT_MEMORY_AGENT_COMMS_ENABLED}" == "1" ]]; then
  if [[ "${AGENT_MEMORY_AGENT_COMMS_AGENT_ID}" != "${AGENT_MEMORY_AGENT_ID}" ||
        "${AGENT_MEMORY_AGENT_COMMS_EXPECTED_AGENT_ID}" != "${AGENT_MEMORY_AGENT_ID}" ]]; then
    echo "[codex-memory-start] agent-comms runtime binding mismatch: AGENT_MEMORY_AGENT_ID=${AGENT_MEMORY_AGENT_ID}, AGENT_MEMORY_AGENT_COMMS_AGENT_ID=${AGENT_MEMORY_AGENT_COMMS_AGENT_ID}, AGENT_MEMORY_AGENT_COMMS_EXPECTED_AGENT_ID=${AGENT_MEMORY_AGENT_COMMS_EXPECTED_AGENT_ID}" >&2
    exit 2
  fi
fi

RUN_ID="${AGENT_MEMORY_BOOT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$-${RANDOM}}"
RUN_DIR="${AGENT_MEMORY_RUN_DIR:-${HOME}/.agent-memory/codex-recovery-runs/${RUN_ID}}"
BOOT_OUTPUT_FILE="${RUN_DIR}/boot-output.txt"
BOOT_RESULT_FILE="${RUN_DIR}/boot-result.json"
PROMPT_FILE="${RUN_DIR}/prompt.txt"
EVENTS_FILE="${RUN_DIR}/events.jsonl"
VERIFY_RESULT_FILE="${RUN_DIR}/verify-result.json"
CONTEXT_HEALTH_FILE="${RUN_DIR}/context-health.json"
RESTART_RECOMMENDED_FILE="${RUN_DIR}/restart-recommended.json"
RESTART_REQUIRED_FILE="${RUN_DIR}/restart-required.json"

mkdir -p "${RUN_DIR}"
export AGENT_MEMORY_BOOT_RUN_ID="${RUN_ID}"
export AGENT_MEMORY_BOOT_RESULT_FILE="${BOOT_RESULT_FILE}"

if [[ "${#CODEX_ARGS[@]}" -eq 0 ]]; then
  case "${CODEX_START_MODE}" in
    interactive)
      ;;
    exec)
      CODEX_ARGS=(exec)
      ;;
    exec-json)
      CODEX_ARGS=(exec --json)
      ;;
    resume-last)
      CODEX_ARGS=(resume --last)
      ;;
    *)
      echo "[codex-memory-start] unknown --mode '${CODEX_START_MODE}'" >&2
      exit 2
      ;;
  esac
fi

BOOT_JS="${MEMORY_ROOT}/dist/boot.js"
if [[ ! -f "${BOOT_JS}" ]]; then
  echo "[codex-memory-start] missing ${BOOT_JS}; run npm run build in ${MEMORY_ROOT}" >&2
  exit 1
fi

BOOT_STDERR="$(mktemp)"
BOOT_OUTPUT=""
if ! BOOT_OUTPUT="$(cd "${MEMORY_ROOT}" && node "${BOOT_JS}" 2>"${BOOT_STDERR}")"; then
  cat "${BOOT_STDERR}" >&2 || true
  rm -f "${BOOT_STDERR}"
  echo "[codex-memory-start] recovery boot failed" >&2
  exit 1
fi
if [[ -s "${BOOT_STDERR}" ]]; then
  cat "${BOOT_STDERR}" >&2
fi
rm -f "${BOOT_STDERR}"
printf '%s\n' "${BOOT_OUTPUT}" > "${BOOT_OUTPUT_FILE}"

STARTUP_PROMPT="$(cat <<EOF
Deterministic startup recovery was executed by codex-memory-start before Codex was launched. This recovery context is not optional and does not depend on LLM tool-choice.

${BOOT_OUTPUT}

Continue from this recovered context. If important context is missing, use mcp__wasurezu__search_memory before asking the user to restate it.
EOF
)"

if [[ "${RECOVERY_REVIEW}" == "1" ]]; then
  REVIEW_SCRIPT="${AGENT_MEMORY_RECOVERY_REVIEW_SCRIPT:-${MEMORY_ROOT}/scripts/recovery-review-request.sh}"
  REVIEW_STDERR="${RUN_DIR}/recovery-review-error.log"
  REVIEW_ARGS=(
    --run-dir "${RUN_DIR}"
    --agent-id "${AGENT_MEMORY_AGENT_ID}"
    --project "${AGENT_MEMORY_PROJECT}"
    --host codex
  )
  if [[ -n "${AGENT_MEMORY_RECOVERY_REVIEW_CHANNEL:-}" ]]; then
    REVIEW_ARGS+=(--channel "${AGENT_MEMORY_RECOVERY_REVIEW_CHANNEL}")
  fi
  if [[ -n "${AGENT_MEMORY_RECOVERY_REVIEW_MENTIONS:-}" ]]; then
    REVIEW_ARGS+=(--mentions "${AGENT_MEMORY_RECOVERY_REVIEW_MENTIONS}")
  fi
  if [[ -n "${AGENT_MEMORY_RECOVERY_REVIEW_SENDER_AGENT_ID:-}" ]]; then
    REVIEW_ARGS+=(--sender-agent "${AGENT_MEMORY_RECOVERY_REVIEW_SENDER_AGENT_ID}")
  fi
  if [[ "${AGENT_MEMORY_RECOVERY_REVIEW_DRY_RUN:-0}" == "1" ]]; then
    REVIEW_ARGS+=(--dry-run)
  fi
  if REVIEW_OUTPUT="$(bash "${REVIEW_SCRIPT}" "${REVIEW_ARGS[@]}" --print 2>"${REVIEW_STDERR}")"; then
    if [[ "${RECOVERY_REVIEW_INJECT}" == "1" ]]; then
      STARTUP_PROMPT="${STARTUP_PROMPT}

${REVIEW_OUTPUT}"
    fi
  else
    echo "[codex-memory-start] recovery review request failed (non-fatal): ${REVIEW_STDERR}" >&2
  fi
fi

printf '%s\n' "${STARTUP_PROMPT}" > "${PROMPT_FILE}"

if [[ "${BOOT_ONLY}" -eq 1 ]]; then
  printf '%s\n' "${STARTUP_PROMPT}"
  exit 0
fi

has_sandbox_arg() {
  if [[ "${#CODEX_ARGS[@]}" -eq 0 ]]; then
    return 1
  fi
  for arg in "${CODEX_ARGS[@]}"; do
    case "${arg}" in
      -s|--sandbox|--sandbox=*|--dangerously-bypass-approvals-and-sandbox)
        return 0
        ;;
    esac
  done
  return 1
}

has_approval_arg() {
  if [[ "${#CODEX_ARGS[@]}" -eq 0 ]]; then
    return 1
  fi
  for arg in "${CODEX_ARGS[@]}"; do
    case "${arg}" in
      -a|--ask-for-approval|--ask-for-approval=*|--dangerously-bypass-approvals-and-sandbox)
        return 0
        ;;
    esac
  done
  return 1
}

has_skip_git_repo_check_arg() {
  if [[ "${#CODEX_ARGS[@]}" -eq 0 ]]; then
    return 1
  fi
  for arg in "${CODEX_ARGS[@]}"; do
    case "${arg}" in
      --skip-git-repo-check)
        return 0
        ;;
    esac
  done
  return 1
}

CODEX_DEFAULT_FLAGS=()
CODEX_CONFIG_FLAGS=(
  -c "mcp_servers.wasurezu.env.AGENT_MEMORY_AGENT_ID=\"${AGENT_MEMORY_AGENT_ID}\""
  -c "mcp_servers.wasurezu.env.AGENT_MEMORY_PROJECT=\"${AGENT_MEMORY_PROJECT}\""
  -c "mcp_servers.wasurezu.env.AGENT_MEMORY_HOST=\"codex\""
  -c "mcp_servers.wasurezu.env.DATABASE_URL=\"${DATABASE_URL:-postgresql:///agent_comms?host=/tmp}\""
  -c "mcp_servers.wasurezu.env.AGENT_MEMORY_CAPTURE_MODE=\"${AGENT_MEMORY_CAPTURE_MODE}\""
  -c "mcp_servers.wasurezu.env.AGENT_MEMORY_TAG_CAPTURE=\"${AGENT_MEMORY_TAG_CAPTURE}\""
  -c "mcp_servers.wasurezu.env.AGENT_MEMORY_BOOT_CATCH_UP=\"${AGENT_MEMORY_BOOT_CATCH_UP}\""
  -c "mcp_servers.wasurezu.env.AGENT_MEMORY_INDEXER_MODE=\"${AGENT_MEMORY_INDEXER_MODE}\""
  -c "mcp_servers.wasurezu.env.AGENT_MEMORY_AI_EXTRACTOR=\"${AGENT_MEMORY_AI_EXTRACTOR}\""
  -c "mcp_servers.wasurezu.env.AGENT_MEMORY_REDACTION_MODE=\"${AGENT_MEMORY_REDACTION_MODE}\""
)
if [[ "${AGENT_MEMORY_AUN_ENABLED}" == "1" ]]; then
  CODEX_CONFIG_FLAGS+=(
    -c "mcp_servers.aun.enabled=true"
    -c "mcp_servers.aun.env.AGENT_ID=\"${AGENT_MEMORY_AUN_AGENT_ID}\""
    -c "mcp_servers.aun.env.AGENT_COM_EXPECTED_AGENT_ID=\"${AGENT_MEMORY_AUN_EXPECTED_AGENT_ID}\""
    -c "mcp_servers.aun.env.DATABASE_URL=\"${DATABASE_URL:-postgresql:///agent_comms?host=/tmp}\""
  )
  if [[ -n "${AGENT_MEMORY_AUN_WEBHOOK_PORT}" ]]; then
    CODEX_CONFIG_FLAGS+=(-c "mcp_servers.aun.env.WEBHOOK_PORT=\"${AGENT_MEMORY_AUN_WEBHOOK_PORT}\"")
  fi
  if [[ -n "${AGENT_MEMORY_AUN_DISCORD_STATE_DIR}" ]]; then
    CODEX_CONFIG_FLAGS+=(-c "mcp_servers.aun.env.DISCORD_STATE_DIR=\"${AGENT_MEMORY_AUN_DISCORD_STATE_DIR}\"")
  fi
else
  CODEX_CONFIG_FLAGS+=(-c "mcp_servers.aun.enabled=false")
fi
if [[ "${AGENT_MEMORY_AGENT_COMMS_ENABLED}" == "1" ]]; then
  CODEX_CONFIG_FLAGS+=(
    -c "mcp_servers.agent-comms.enabled=true"
    -c "mcp_servers.agent-comms.env.AGENT_ID=\"${AGENT_MEMORY_AGENT_COMMS_AGENT_ID}\""
    -c "mcp_servers.agent-comms.env.AGENT_COM_EXPECTED_AGENT_ID=\"${AGENT_MEMORY_AGENT_COMMS_EXPECTED_AGENT_ID}\""
    -c "mcp_servers.agent-comms.env.DATABASE_URL=\"${DATABASE_URL:-postgresql:///agent_comms?host=/tmp}\""
  )
  if [[ -n "${AGENT_MEMORY_AGENT_COMMS_WEBHOOK_PORT}" ]]; then
    CODEX_CONFIG_FLAGS+=(-c "mcp_servers.agent-comms.env.WEBHOOK_PORT=\"${AGENT_MEMORY_AGENT_COMMS_WEBHOOK_PORT}\"")
  fi
  if [[ -n "${AGENT_MEMORY_AGENT_COMMS_DISCORD_STATE_DIR}" ]]; then
    CODEX_CONFIG_FLAGS+=(-c "mcp_servers.agent-comms.env.DISCORD_STATE_DIR=\"${AGENT_MEMORY_AGENT_COMMS_DISCORD_STATE_DIR}\"")
  fi
else
  CODEX_CONFIG_FLAGS+=(-c "mcp_servers.agent-comms.enabled=false")
fi
if [[ "${CODEX_BYPASS_APPROVALS_AND_SANDBOX}" == "1" ]]; then
  CODEX_DEFAULT_FLAGS+=(--dangerously-bypass-approvals-and-sandbox)
else
  if ! has_sandbox_arg; then
    CODEX_DEFAULT_FLAGS+=(-s "${CODEX_SANDBOX}")
  fi
  if ! has_approval_arg; then
    CODEX_DEFAULT_FLAGS+=(-a "${CODEX_APPROVAL}")
  fi
fi

if [[ "${CODEX_SKIP_GIT_REPO_CHECK}" == "1" && "${#CODEX_ARGS[@]}" -gt 0 ]]; then
  case "${CODEX_ARGS[0]}" in
    exec|e)
      if ! has_skip_git_repo_check_arg; then
        CODEX_ARGS=("${CODEX_ARGS[0]}" "--skip-git-repo-check" "${CODEX_ARGS[@]:1}")
      fi
      ;;
  esac
fi

cat > "${RUN_DIR}/run-config.json" <<EOF
{
  "run_id": "${RUN_ID}",
  "mode": "${CODEX_START_MODE}",
  "sandbox": "${CODEX_SANDBOX}",
  "approval": "${CODEX_APPROVAL}",
  "bypass_approvals_and_sandbox": "${CODEX_BYPASS_APPROVALS_AND_SANDBOX}",
  "skip_git_repo_check": "${CODEX_SKIP_GIT_REPO_CHECK}",
  "workdir": "${WORKDIR}",
  "agent_id": "${AGENT_MEMORY_AGENT_ID}",
  "project": "${AGENT_MEMORY_PROJECT}",
  "recorded_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

option_takes_value() {
  case "$1" in
    -c|--config|-i|--image|-m|--model|-p|--profile|--profile-v2|-s|--sandbox|\
    -a|--ask-for-approval|--remote|--remote-auth-token-env|-C|--cd|--add-dir|\
    --output-schema|--color|-o|--output-last-message|--local-provider)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

PROMPT_INDEX=-1
START_INDEX=0
if [[ "${#CODEX_ARGS[@]}" -gt 0 ]]; then
  case "${CODEX_ARGS[0]}" in
    exec|e|review|resume|fork)
      START_INDEX=1
      ;;
  esac
fi

index="${START_INDEX}"
while [[ "${index}" -lt "${#CODEX_ARGS[@]}" ]]; do
  arg="${CODEX_ARGS[$index]}"
  if [[ "${arg}" == "--" ]]; then
    next=$((index + 1))
    if [[ "${next}" -lt "${#CODEX_ARGS[@]}" ]]; then
      PROMPT_INDEX="${next}"
    fi
    break
  elif [[ "${arg}" == --*=* ]]; then
    index=$((index + 1))
  elif option_takes_value "${arg}"; then
    index=$((index + 2))
  elif [[ "${arg}" == -* ]]; then
    index=$((index + 1))
  else
    PROMPT_INDEX="${index}"
    break
  fi
done

if [[ "${PROMPT_INDEX}" -ge 0 ]]; then
  CODEX_ARGS["${PROMPT_INDEX}"]="${STARTUP_PROMPT}

User prompt:
${CODEX_ARGS[$PROMPT_INDEX]}"
else
  CODEX_ARGS+=("${STARTUP_PROMPT}")
fi

is_exec_json() {
  if [[ "${#CODEX_ARGS[@]}" -eq 0 ]]; then
    return 1
  fi
  case "${CODEX_ARGS[0]}" in
    exec|e)
      ;;
    *)
      return 1
      ;;
  esac
  for arg in "${CODEX_ARGS[@]}"; do
    if [[ "${arg}" == "--json" ]]; then
      return 0
    fi
  done
  return 1
}

if is_exec_json; then
  set +e
  "${CODEX_BIN}" -C "${WORKDIR}" "${CODEX_CONFIG_FLAGS[@]}" "${CODEX_DEFAULT_FLAGS[@]}" "${CODEX_ARGS[@]}" | tee "${EVENTS_FILE}"
  codex_status=${PIPESTATUS[0]}
  set -e

  cat > "${RUN_DIR}/run-status.json" <<EOF
{
  "status": "$([[ "${codex_status}" -eq 0 ]] && printf completed || printf failed)",
  "exit_code": ${codex_status},
  "run_id": "${RUN_ID}",
  "recorded_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

  CONTEXT_HEALTH_JS="${MEMORY_ROOT}/dist/context-health.js"
  if [[ -f "${CONTEXT_HEALTH_JS}" ]]; then
    if node "${CONTEXT_HEALTH_JS}" \
      --host codex \
      --events "${EVENTS_FILE}" \
      --result "${CONTEXT_HEALTH_FILE}" \
      --restart-marker "${RESTART_RECOMMENDED_FILE}" \
      --required-marker "${RESTART_REQUIRED_FILE}" >&2; then
      echo "[codex-memory-start] context health: ${CONTEXT_HEALTH_FILE}" >&2
      if [[ -f "${RESTART_RECOMMENDED_FILE}" ]]; then
        echo "[codex-memory-start] context restart recommended: ${RESTART_RECOMMENDED_FILE}" >&2
      fi
      if [[ -f "${RESTART_REQUIRED_FILE}" ]]; then
        echo "[codex-memory-start] context restart required: ${RESTART_REQUIRED_FILE}" >&2
      fi
    else
      echo "[codex-memory-start] context health failed (non-fatal)" >&2
    fi
  else
    echo "[codex-memory-start] missing ${CONTEXT_HEALTH_JS}; context health skipped" >&2
  fi

  VERIFY_JS="${MEMORY_ROOT}/dist/codex-recovery-verify.js"
  if [[ -f "${VERIFY_JS}" ]]; then
    if node "${VERIFY_JS}" \
      --boot-output "${BOOT_OUTPUT_FILE}" \
      --boot-result "${BOOT_RESULT_FILE}" \
      --events "${EVENTS_FILE}" \
      --result "${VERIFY_RESULT_FILE}" >&2; then
      echo "[codex-memory-start] recovery verification: ${VERIFY_RESULT_FILE}" >&2
    else
      echo "[codex-memory-start] recovery verification failed (non-fatal)" >&2
    fi
  else
    echo "[codex-memory-start] missing ${VERIFY_JS}; verification skipped" >&2
  fi
  exit "${codex_status}"
fi

cat > "${RUN_DIR}/run-status.json" <<EOF
{
  "status": "launched_unverified",
  "reason": "Codex was not started with exec --json, so this wrapper cannot observe the first completed Codex event.",
  "run_id": "${RUN_ID}",
  "recorded_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

exec "${CODEX_BIN}" -C "${WORKDIR}" "${CODEX_CONFIG_FLAGS[@]}" "${CODEX_DEFAULT_FLAGS[@]}" "${CODEX_ARGS[@]}"
