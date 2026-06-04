#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
codex-tmux-exit.sh

Send /exit to a Codex tmux session.

Usage:
  codex-tmux-exit.sh [--dry-run] [--session NAME]

Options:
  --dry-run      Print the tmux command. Does not mutate tmux.
  --session NAME tmux session name. Default: $AGENT_MEMORY_CODEX_TMUX_SESSION or codex.
  --tmux-bin PATH tmux executable. Default: $TMUX_BIN or tmux.

Boundary:
  This script asks an operator-owned tmux session to exit normally. It does not
  own restart policy, kill processes, mutate AUN queue lifecycle, or repair
  unfinished work.
EOF
}

tmux_bin="${TMUX_BIN:-tmux}"
session="${AGENT_MEMORY_CODEX_TMUX_SESSION:-codex}"
dry_run=0

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

command=("$tmux_bin" "send-keys" "-t" "$session" "/exit" "C-m")

if [[ "$dry_run" -eq 1 ]]; then
  echo "DRY-RUN codex tmux exit"
  printf 'command:'
  printf ' %q' "${command[@]}"
  printf '\n'
  exit 0
fi

exec "${command[@]}"
