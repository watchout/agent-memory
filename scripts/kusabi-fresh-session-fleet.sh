#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
runner="${repo_root}/dist/kusabi-fresh-session-fleet.js"

if [[ ! -f "${runner}" ]]; then
  echo "[kusabi-fresh-session-fleet] dist runner missing; run npm run build first" >&2
  exit 2
fi

mode="--preflight-only"
forward=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --preflight-only)
      mode="--preflight-only"
      shift
      ;;
    --live)
      mode="--live"
      shift
      ;;
    --profiles-json|--input-json|--audit-json)
      [[ $# -ge 2 ]] || { echo "$1 requires a value" >&2; exit 2; }
      forward+=("$1" "$2")
      shift 2
      ;;
    --help|-h)
      cat <<'EOF'
Usage:
  scripts/kusabi-fresh-session-fleet.sh --preflight-only [--profiles-json FILE]
  scripts/kusabi-fresh-session-fleet.sh --live --input-json FILE --audit-json FILE [--profiles-json FILE]

The live mode launches exactly 12 ordinary fresh processes, one at a time. It
never detects disconnects, restarts an existing runtime, or writes to a TUI.
Run live mode only after an independent exact-head audit PASS.
EOF
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ ${#forward[@]} -eq 0 ]]; then
  exec node "${runner}" "${mode}"
fi
exec node "${runner}" "${mode}" "${forward[@]}"
