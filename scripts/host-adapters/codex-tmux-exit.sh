#!/usr/bin/env bash
set -euo pipefail

TARGET="${CODEX_TMUX_TARGET:-codex:wasurezu-restart}"
WAIT_SECONDS="${CODEX_EXIT_WAIT_SECONDS:-3}"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required for codex-tmux-exit.sh" >&2
  exit 1
fi

SESSION="${TARGET%%:*}"
WINDOW="${TARGET#*:}"

if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux session $SESSION does not exist; nothing to exit"
  exit 0
fi

if ! tmux list-windows -t "$SESSION" -F '#{window_name}' | grep -Fxq "$WINDOW"; then
  echo "tmux window $TARGET does not exist; nothing to exit"
  exit 0
fi

tmux send-keys -t "$TARGET" "/exit" C-m
sleep "$WAIT_SECONDS"

echo "Sent /exit to $TARGET"
