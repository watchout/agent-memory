#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
codex-tmux-restart.sh

Operator helper that sends /exit to a Codex tmux session and starts a fresh
session through wasurezu-codex-start.

Usage:
  codex-tmux-restart.sh [--dry-run] [--session NAME] [--cd DIR] [--delay-seconds N]

Options:
  --dry-run          Print the exit/start commands. Does not mutate tmux.
  --session NAME     tmux session name. Default: $AGENT_MEMORY_CODEX_TMUX_SESSION or codex.
  --cd DIR           Workspace for the new Codex session. Default: current directory.
  --delay-seconds N  Delay between exit and start. Default: 1.
  --bridge-bin PATH  wasurezu-codex-start executable.
  --codex-bin PATH   Codex executable passed through the bridge.
  --max-tokens N     restart_pack token budget override.
  --extra TEXT       Extra startup instruction.
  --tmux-bin PATH    tmux executable.

Boundary:
  This is a convenience wrapper around normal host lifecycle actions. It does
  not own restart policy, mutate AUN queue lifecycle, or prove startup recovery
  without separate launch/recovery evidence.
EOF
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
session="${AGENT_MEMORY_CODEX_TMUX_SESSION:-codex}"
workdir="$PWD"
delay_seconds="1"
dry_run=0
tmux_bin="${TMUX_BIN:-tmux}"
bridge_bin="${WASUREZU_CODEX_START_BIN:-wasurezu-codex-start}"
start_bridge_args=()

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
    --delay-seconds)
      [[ $# -ge 2 ]] || { echo "--delay-seconds requires a value" >&2; exit 2; }
      delay_seconds="$2"
      shift 2
      ;;
    --bridge-bin)
      [[ $# -ge 2 ]] || { echo "--bridge-bin requires a value" >&2; exit 2; }
      bridge_bin="$2"
      shift 2
      ;;
    --codex-bin|--max-tokens|--extra)
      [[ $# -ge 2 ]] || { echo "$1 requires a value" >&2; exit 2; }
      start_bridge_args+=("$1" "$2")
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

common_exit_args=("--session" "$session" "--tmux-bin" "$tmux_bin")
common_start_args=("--session" "$session" "--cd" "$workdir" "--tmux-bin" "$tmux_bin" "--bridge-bin" "$bridge_bin")
if [[ ${#start_bridge_args[@]} -gt 0 ]]; then
  common_start_args+=("${start_bridge_args[@]}")
fi

if [[ "$dry_run" -eq 1 ]]; then
  "$script_dir/codex-tmux-exit.sh" --dry-run "${common_exit_args[@]}"
  "$script_dir/codex-tmux-start.sh" --dry-run "${common_start_args[@]}"
  exit 0
fi

"$script_dir/codex-tmux-exit.sh" "${common_exit_args[@]}"
sleep "$delay_seconds"
"$script_dir/codex-tmux-start.sh" "${common_start_args[@]}"
