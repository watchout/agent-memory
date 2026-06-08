#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEMORY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

pass_count=0

pass() {
  pass_count=$((pass_count + 1))
  printf '  pass: %s\n' "$1"
}

fail() {
  printf '  fail: %s\n' "$1" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "missing $1; run npm run build first"
}

require_file "${MEMORY_ROOT}/dist/boot.js"
require_file "${MEMORY_ROOT}/scripts/recovery-review-request.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

run_boot_only_default_review() {
  local run_dir="$1"
  local ledger_file="$2"
  local db_marker="$3"
  local bun_marker="$4"
  local fake_db="${TMP_DIR}/fake-recovery-review-db.sh"
  local fake_bun="${TMP_DIR}/fake-bun.sh"
  mkdir -p "${run_dir}"
  cat > "${fake_db}" <<'EOF'
#!/usr/bin/env bash
printf 'called\n' > "${FAKE_DB_MARKER}"
EOF
  chmod +x "${fake_db}"
  cat > "${fake_bun}" <<'EOF'
#!/usr/bin/env bash
printf 'called\n' > "${FAKE_BUN_MARKER}"
EOF
  chmod +x "${fake_bun}"

  env -i \
    PATH="${PATH}" \
    HOME="${TMP_DIR}/default-home" \
    AGENT_MEMORY_DB_TYPE=json \
    AGENT_MEMORY_RUN_DIR="${run_dir}" \
    AGENT_MEMORY_AGENT_ID=test-codex \
    AGENT_MEMORY_PROJECT=agent-memory \
    AGENT_MEMORY_RECOVERY_REVIEW=1 \
    AGENT_MEMORY_RECOVERY_REVIEW_DB=1 \
    AGENT_MEMORY_RECOVERY_REVIEW_DRY_RUN=0 \
    AGENT_MEMORY_RECOVERY_REVIEW_DB_SCRIPT="${fake_db}" \
    AGENT_MEMORY_RECOVERY_REVIEW_LEDGER="${ledger_file}" \
    AGENT_MEMORY_RECOVERY_REVIEW_MENTIONS=agent-mem-dev \
    AGENT_MEMORY_BUN_BIN="${fake_bun}" \
    FAKE_DB_MARKER="${db_marker}" \
    FAKE_BUN_MARKER="${bun_marker}" \
    bash "${MEMORY_ROOT}/scripts/codex-memory-start.sh" \
      --cwd "${MEMORY_ROOT}" \
      --boot-only > "${run_dir}/stdout.txt" 2> "${run_dir}/stderr.txt"
}

FAKE_REVIEW="${TMP_DIR}/fake-recovery-review.sh"
cat > "${FAKE_REVIEW}" <<'EOF'
#!/usr/bin/env bash
{
  printf 'db=%s\n' "${AGENT_MEMORY_RECOVERY_REVIEW_DB:-}"
  printf 'dry_run=%s\n' "${AGENT_MEMORY_RECOVERY_REVIEW_DRY_RUN:-}"
  printf 'args='
  printf '%q ' "$@"
  printf '\n'
} > "${FAKE_REVIEW_CAPTURE}"
printf 'fake recovery review\n'
EOF
chmod +x "${FAKE_REVIEW}"

run_boot_only() {
  local run_dir="$1"
  local capture_file="$2"
  shift 2
  mkdir -p "${run_dir}"
  env -i \
    PATH="${PATH}" \
    HOME="${TMP_DIR}/home" \
    AGENT_MEMORY_DB_TYPE=json \
    AGENT_MEMORY_RUN_DIR="${run_dir}" \
    AGENT_MEMORY_AGENT_ID=test-codex \
    AGENT_MEMORY_PROJECT=agent-memory \
    AGENT_MEMORY_RECOVERY_REVIEW=1 \
    AGENT_MEMORY_RECOVERY_REVIEW_DB=1 \
    AGENT_MEMORY_RECOVERY_REVIEW_DRY_RUN=0 \
    AGENT_MEMORY_RECOVERY_REVIEW_SCRIPT="${FAKE_REVIEW}" \
    FAKE_REVIEW_CAPTURE="${capture_file}" \
    "$@" \
    bash "${MEMORY_ROOT}/scripts/codex-memory-start.sh" \
      --cwd "${MEMORY_ROOT}" \
      --boot-only > "${run_dir}/stdout.txt" 2> "${run_dir}/stderr.txt"
}

printf '\n-- Codex boot-only recovery review --\n'
DEFAULT_RUN="${TMP_DIR}/boot-only-default-review"
DEFAULT_LEDGER="${TMP_DIR}/boot-only-default-review-events.jsonl"
DEFAULT_DB_MARKER="${TMP_DIR}/boot-only-default-db-called"
DEFAULT_BUN_MARKER="${TMP_DIR}/boot-only-default-bun-called"
run_boot_only_default_review "${DEFAULT_RUN}" "${DEFAULT_LEDGER}" "${DEFAULT_DB_MARKER}" "${DEFAULT_BUN_MARKER}"

[[ -f "${DEFAULT_RUN}/recovery-review-request.md" ]] \
  || fail "default recovery review request markdown was not written"
[[ -f "${DEFAULT_RUN}/recovery-review-request.json" ]] \
  || fail "default recovery review request JSON was not written"
grep -q '"event_type":"request"' "${DEFAULT_LEDGER}" \
  || fail "default recovery review ledger request event was not written"
grep -q 'Recovery Evaluation Request' "${DEFAULT_RUN}/prompt.txt" \
  || fail "default recovery review output was not injected into boot-only prompt"
[[ ! -s "${DEFAULT_RUN}/recovery-review-error.log" ]] \
  || fail "default recovery review wrote stderr in boot-only path"
pass "Codex boot-only default recovery review writes request artifacts"

[[ ! -f "${DEFAULT_DB_MARKER}" ]] \
  || fail "boot-only default recovery review called DB despite no-live-mutation default"
[[ ! -f "${DEFAULT_BUN_MARKER}" ]] \
  || fail "boot-only default recovery review attempted live notify despite dry-run"
pass "Codex boot-only default recovery review suppresses DB and live notify"

BOOT_ONLY_RUN="${TMP_DIR}/boot-only"
BOOT_ONLY_CAPTURE="${TMP_DIR}/boot-only-review-env.txt"
run_boot_only "${BOOT_ONLY_RUN}" "${BOOT_ONLY_CAPTURE}"

grep -Fxq 'db=0' "${BOOT_ONLY_CAPTURE}" \
  || fail "boot-only recovery review did not force DB off"
grep -Fxq 'dry_run=1' "${BOOT_ONLY_CAPTURE}" \
  || fail "boot-only recovery review did not force dry-run"
grep -q -- '--dry-run' "${BOOT_ONLY_CAPTURE}" \
  || fail "boot-only recovery review did not pass --dry-run"
pass "Codex boot-only recovery review defaults DB off and notify dry-run"

[[ -f "${BOOT_ONLY_RUN}/prompt.txt" ]] \
  || fail "boot-only prompt was not written"
grep -q 'fake recovery review' "${BOOT_ONLY_RUN}/prompt.txt" \
  || fail "boot-only recovery review output was not injected"
pass "Codex boot-only still writes deterministic recovery review prompt"

BOOT_ONLY_LIVE_RUN="${TMP_DIR}/boot-only-live"
BOOT_ONLY_LIVE_CAPTURE="${TMP_DIR}/boot-only-live-review-env.txt"
run_boot_only "${BOOT_ONLY_LIVE_RUN}" "${BOOT_ONLY_LIVE_CAPTURE}" \
  AGENT_MEMORY_BOOT_ONLY_LIVE_REVIEW=1

grep -Fxq 'db=1' "${BOOT_ONLY_LIVE_CAPTURE}" \
  || fail "boot-only live-review opt-in did not preserve DB setting"
grep -Fxq 'dry_run=0' "${BOOT_ONLY_LIVE_CAPTURE}" \
  || fail "boot-only live-review opt-in did not preserve dry-run setting"
! grep -q -- '--dry-run' "${BOOT_ONLY_LIVE_CAPTURE}" \
  || fail "boot-only live-review opt-in still passed --dry-run"
pass "Codex boot-only live-review requires explicit opt-in"

printf '\ncontext health wrapper tests passed (%s)\n' "${pass_count}"
