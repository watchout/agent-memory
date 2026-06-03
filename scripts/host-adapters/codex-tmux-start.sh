#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
codex-tmux-start.sh

Start a detached Codex tmux session through the wasurezu Codex bridge.

Usage:
  codex-tmux-start.sh [--dry-run] [--session NAME] [--cd DIR] [--codex-bin PATH] [--max-tokens N] [--extra TEXT]

Options:
  --dry-run         Print the tmux command. Does not start tmux or Codex.
  --session NAME    tmux session name. Default: $AGENT_MEMORY_CODEX_TMUX_SESSION or codex.
  --cd DIR          Workspace for the new Codex session. Default: current directory.
  --bridge-bin PATH wasurezu-codex-start executable. Default: $WASUREZU_CODEX_START_BIN or wasurezu-codex-start.
  --codex-bin PATH  Codex executable passed through the bridge.
  --max-tokens N    restart_pack token budget override.
  --extra TEXT      Extra startup instruction.
  --tmux-bin PATH   tmux executable. Default: $TMUX_BIN or tmux.

Boundary:
  This script starts a fresh operator-owned tmux session. It does not close,
  requeue, finalize, or repair work, and it does not mutate AUN lifecycle.
EOF
}

shell_join() {
  printf '%q ' "$@"
}

tmux_bin="${TMUX_BIN:-tmux}"
bridge_bin="${WASUREZU_CODEX_START_BIN:-wasurezu-codex-start}"
session="${AGENT_MEMORY_CODEX_TMUX_SESSION:-codex}"
workdir="$PWD"
dry_run=0
bridge_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      dry_run=1
      shift
      ;;
    --session)
      [[ $# -ge 2 ]] || { echo "--session requires a value" >&2; exit 2; }
      session="$2"
      shift 2
      ;;
    --cd)
      [[ $# -ge 2 ]] || { echo "--cd requires a value" >&2; exit 2; }
      workdir="$2"
      shift 2
      ;;
    --bridge-bin)
      [[ $# -ge 2 ]] || { echo "--bridge-bin requires a value" >&2; exit 2; }
      bridge_bin="$2"
      shift 2
      ;;
    --codex-bin|--max-tokens|--extra)
      [[ $# -ge 2 ]] || { echo "$1 requires a value" >&2; exit 2; }
      bridge_args+=("$1" "$2")
      shift 2
      ;;
    --tmux-bin)
      [[ $# -ge 2 ]] || { echo "--tmux-bin requires a value" >&2; exit 2; }
      tmux_bin="$2"
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

bridge_command=("$bridge_bin" "--launch" "--cd" "$workdir")
if [[ ${#bridge_args[@]} -gt 0 ]]; then
  bridge_command+=("${bridge_args[@]}")
fi
bridge_shell_command="$(shell_join "${bridge_command[@]}")"
tmux_command=("$tmux_bin" "new-session" "-d" "-s" "$session" "-c" "$workdir" "$bridge_shell_command")

if [[ "$dry_run" -eq 1 ]]; then
  echo "DRY-RUN codex tmux start"
  printf 'command:'
  printf ' %q' "${tmux_command[@]}"
  printf '\n'
  printf 'bridge_command: %s\n' "$bridge_shell_command"
  exit 0
fi

exec "${tmux_command[@]}"
