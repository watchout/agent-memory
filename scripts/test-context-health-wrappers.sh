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

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

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
