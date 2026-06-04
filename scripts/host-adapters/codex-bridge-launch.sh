#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
codex-bridge-launch.sh

Operator helper for launching Codex through wasurezu-codex-start.

Usage:
  codex-bridge-launch.sh [--dry-run] [--print] [--cd DIR] [--codex-bin PATH] [--max-tokens N] [--extra TEXT]

Options:
  --dry-run        Print the command that would run. Does not invoke Codex.
  --print          Print/inspect the bridge output instead of launching Codex.
  --bridge-bin     wasurezu-codex-start executable. Default: $WASUREZU_CODEX_START_BIN or wasurezu-codex-start.
  --cd DIR         Workspace passed to Codex through wasurezu-codex-start.
  --codex-bin PATH Codex executable passed to wasurezu-codex-start.
  --max-tokens N   restart_pack token budget override.
  --extra TEXT     Extra startup instruction.

Boundary:
  This script is an operator convenience. It does not kill an existing Codex
  session, own restart policy, mutate AUN queue lifecycle, or prove public-alpha
  recovery. Use --dry-run for tests and audits.
EOF
}

bridge_bin="${WASUREZU_CODEX_START_BIN:-wasurezu-codex-start}"
dry_run=0
mode="--launch"
bridge_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      dry_run=1
      shift
      ;;
    --print|--print-only)
      mode="--print"
      shift
      ;;
    --launch)
      mode="--launch"
      shift
      ;;
    --bridge-bin)
      [[ $# -ge 2 ]] || { echo "--bridge-bin requires a value" >&2; exit 2; }
      bridge_bin="$2"
      shift 2
      ;;
    --cd|--codex-bin|--max-tokens|--extra)
      [[ $# -ge 2 ]] || { echo "$1 requires a value" >&2; exit 2; }
      bridge_args+=("$1" "$2")
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

command=("$bridge_bin" "$mode")
if [[ "$dry_run" -eq 1 ]]; then
  command+=("--dry-run")
fi
if [[ ${#bridge_args[@]} -gt 0 ]]; then
  command+=("${bridge_args[@]}")
fi

if [[ "$dry_run" -eq 1 ]]; then
  echo "DRY-RUN codex bridge launch"
  printf 'command:'
  printf ' %q' "${command[@]}"
  printf '\n'
  exit 0
fi

exec "${command[@]}"
