#!/usr/bin/env bash
set -euo pipefail

WASUREZU_ROOT="${WASUREZU_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
EXIT_SCRIPT="${CODEX_EXIT_SCRIPT:-${WASUREZU_ROOT}/scripts/host-adapters/codex-tmux-exit.sh}"
START_SCRIPT="${CODEX_START_WRAPPER:-${WASUREZU_ROOT}/scripts/host-adapters/codex-tmux-start.sh}"
WAIT_SECONDS="${CODEX_RESTART_WAIT_SECONDS:-2}"

if [[ ! -x "$EXIT_SCRIPT" ]]; then
  echo "Exit script is not executable: $EXIT_SCRIPT" >&2
  exit 1
fi

if [[ ! -x "$START_SCRIPT" ]]; then
  echo "Start wrapper is not executable: $START_SCRIPT" >&2
  exit 1
fi

"$EXIT_SCRIPT"
sleep "$WAIT_SECONDS"
"$START_SCRIPT" --replace-window "$@"

echo "Restarted Codex via wasurezu startup bridge"
