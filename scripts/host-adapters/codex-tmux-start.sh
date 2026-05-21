#!/usr/bin/env bash
set -euo pipefail

SESSION="${CODEX_TMUX_SESSION:-codex}"
WINDOW="${CODEX_TMUX_WINDOW:-wasurezu-restart}"
WORKSPACE="${CODEX_WORKSPACE:-${PWD}}"
WASUREZU_ROOT="${WASUREZU_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
START_SCRIPT="${CODEX_START_SCRIPT:-${WASUREZU_ROOT}/scripts/host-adapters/codex-start-with-wasurezu.sh}"

REPLACE_WINDOW=0
if [[ "${1:-}" == "--replace-window" ]]; then
  REPLACE_WINDOW=1
  shift
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required for codex-tmux-start.sh" >&2
  exit 1
fi

if [[ ! -x "$START_SCRIPT" ]]; then
  echo "Start script is not executable: $START_SCRIPT" >&2
  exit 1
fi

launch_cmd=$(printf "cd %q && CODEX_WORKSPACE=%q WASUREZU_ROOT=%q %q" "$WORKSPACE" "$WORKSPACE" "$WASUREZU_ROOT" "$START_SCRIPT")
for arg in "$@"; do
  launch_cmd+=" $(printf "%q" "$arg")"
done

if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux new-session -d -s "$SESSION" -n "$WINDOW" "$launch_cmd"
  echo "Started $SESSION:$WINDOW"
  exit 0
fi

if tmux list-windows -t "$SESSION" -F '#{window_name}' | grep -Fxq "$WINDOW"; then
  if [[ "$REPLACE_WINDOW" != "1" ]]; then
    echo "tmux window $SESSION:$WINDOW already exists; use --replace-window after exiting it" >&2
    exit 1
  fi
  tmux kill-window -t "$SESSION:$WINDOW"
fi

tmux new-window -t "$SESSION" -n "$WINDOW" "$launch_cmd"
tmux select-window -t "$SESSION:$WINDOW"

echo "Started $SESSION:$WINDOW"
