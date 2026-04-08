#!/usr/bin/env bash
# AM-006: PostToolUse hook installer for internal multi-agent deployment.
#
# Idempotently merges an agent-memory PostToolUse hook block into a bot's
# .claude/settings.json. Dry-run by default; pass --apply to write.
#
# Usage:
#   scripts/install-hook.sh <bot_name> [--apply] [--dir <override>]
#
# Examples:
#   scripts/install-hook.sh cto                  # dry-run for cto
#   scripts/install-hook.sh cto --apply          # actually write
#   scripts/install-hook.sh new --dir /path --apply  # explicit working dir
#
# Behavior:
#   - Looks up the bot's working dir from the internal mapping table
#     (or accepts an explicit --dir override).
#   - Reads <bot_dir>/.claude/settings.json (or initializes {}).
#   - Adds (or updates) a PostToolUse hook entry that points at
#     scripts/post-tool-hook.sh with per-bot env vars inlined. The
#     entry is keyed on the matcher string, so re-running this script
#     against an already-installed bot is a no-op (idempotent).
#   - Prints a unified diff against the original.
#   - On --apply: writes the new file with a .bak backup of the
#     original alongside it.
#
# OSS NOTE: this script is for watchout-internal deployment only.
# It must not ship in the npm package (see package.json "files").

set -euo pipefail

# ─── 14-bot mapping table ─────────────────────────────────────────
#
# bot_name → working_dir basename. The full path is built as
# /Users/yuji/Developer/<working_dir>/.claude/settings.json.
#
# AGENT_MEMORY_PROJECT is set to the working_dir basename so the
# project label matches the directory layout.
#
# Source: Arc, AM-006 Q3A confirmation 2026-04-08.
#
# NOTE: implemented as a case statement instead of an associative
# array because macOS ships with bash 3.2, which doesn't support
# `declare -A`. The bots/IDs that need updating live in one place.
get_bot_dir() {
  case "$1" in
    agent-mem-dev)    echo "agent-memory" ;;
    arc)              echo "iyasaka" ;;
    cto)              echo "tech-lead" ;;
    agent-com-dev)    echo "agent-comms-mcp" ;;
    auditor)          echo "dev-auditor" ;;
    hotel-dev)        echo "hotel-kanri" ;;
    wbs-dev)          echo "wbs" ;;
    haishin-dev)      echo "haishin-puls-hub" ;;
    nyusatsu-dev)     echo "nyusatsu" ;;
    xmarketing-dev)   echo "x-marketing-engine" ;;
    upwork-dev)       echo "upwork-automation" ;;
    research-lead)    echo "research-lead" ;;
    secretary)        echo "secretary" ;;
    webb-dev)         echo "webb-dev" ;;
    *)                return 1 ;;
  esac
}

list_bots() {
  cat <<'BOTS'
  agent-com-dev    -> agent-comms-mcp
  agent-mem-dev    -> agent-memory
  arc              -> iyasaka
  auditor          -> dev-auditor
  cto              -> tech-lead
  haishin-dev      -> haishin-puls-hub
  hotel-dev        -> hotel-kanri
  nyusatsu-dev     -> nyusatsu
  research-lead    -> research-lead
  secretary        -> secretary
  upwork-dev       -> upwork-automation
  wbs-dev          -> wbs
  webb-dev         -> webb-dev
  xmarketing-dev   -> x-marketing-engine
BOTS
}

DEV_ROOT="/Users/yuji/Developer"
HOOK_WRAPPER="${DEV_ROOT}/agent-memory/scripts/post-tool-hook.sh"
DEFAULT_DATABASE_URL="postgresql://localhost/agent_comms"
HOOK_MATCHER="Bash|mcp__agent-comms__reply|mcp__agent-comms__send_message"

# ─── Argument parsing ─────────────────────────────────────────────
APPLY=0
BOT_NAME=""
DIR_OVERRIDE=""

usage() {
  cat <<USAGE
Usage: $0 <bot_name> [--apply] [--dir <override>]

Available bots:
$(list_bots)
USAGE
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --dir) DIR_OVERRIDE="$2"; shift 2 ;;
    -h|--help) usage ;;
    -*) echo "Unknown flag: $1" >&2; usage ;;
    *)
      if [[ -z "$BOT_NAME" ]]; then
        BOT_NAME="$1"
        shift
      else
        echo "Unexpected argument: $1" >&2
        usage
      fi
      ;;
  esac
done

if [[ -z "$BOT_NAME" ]]; then
  usage
fi

# ─── Resolve bot dir ──────────────────────────────────────────────
if [[ -n "$DIR_OVERRIDE" ]]; then
  BOT_DIR="$DIR_OVERRIDE"
  PROJECT_LABEL="$(basename "$DIR_OVERRIDE")"
else
  if WORKING_DIR_BASENAME="$(get_bot_dir "$BOT_NAME")"; then
    BOT_DIR="${DEV_ROOT}/${WORKING_DIR_BASENAME}"
    PROJECT_LABEL="$WORKING_DIR_BASENAME"
  else
    echo "Error: unknown bot_name '$BOT_NAME'. Use --dir <path> to override." >&2
    usage
  fi
fi

if [[ ! -d "$BOT_DIR" ]]; then
  echo "Error: bot directory does not exist: $BOT_DIR" >&2
  exit 1
fi

SETTINGS_DIR="${BOT_DIR}/.claude"
SETTINGS_PATH="${SETTINGS_DIR}/settings.json"

# ─── Build merged settings.json via node ──────────────────────────
#
# We use node (already required by the agent-memory project) instead
# of jq so the script has zero external dependencies beyond what is
# already installed for the bots.
#
# The merge logic:
#   1. Load existing JSON (or start from {}).
#   2. Ensure hooks.PostToolUse is an array.
#   3. Look for an existing entry whose matcher === HOOK_MATCHER.
#      - If found, replace its hooks.command with the canonical one.
#      - If missing, append a new entry.
#   4. Print the merged JSON to stdout.
#
# This is idempotent: re-running with no changes leaves the file
# byte-identical (modulo whitespace).
HOOK_COMMAND="DATABASE_URL=${DEFAULT_DATABASE_URL} AGENT_MEMORY_AGENT_ID=${BOT_NAME} AGENT_MEMORY_PROJECT=${PROJECT_LABEL} bash ${HOOK_WRAPPER} 2>/dev/null || true"

NEW_JSON="$(SETTINGS_PATH="$SETTINGS_PATH" HOOK_MATCHER="$HOOK_MATCHER" HOOK_COMMAND="$HOOK_COMMAND" node -e '
const fs = require("fs");
const path = process.env.SETTINGS_PATH;
const matcher = process.env.HOOK_MATCHER;
const command = process.env.HOOK_COMMAND;

let settings = {};
if (fs.existsSync(path)) {
  try {
    settings = JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (err) {
    console.error("[install-hook] existing settings.json is invalid JSON: " + err.message);
    process.exit(3);
  }
}

if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
if (!Array.isArray(settings.hooks.PostToolUse)) settings.hooks.PostToolUse = [];

const entry = {
  matcher,
  hooks: [{ type: "command", command }],
};

const idx = settings.hooks.PostToolUse.findIndex(e => e && e.matcher === matcher);
if (idx >= 0) {
  settings.hooks.PostToolUse[idx] = entry;
} else {
  settings.hooks.PostToolUse.push(entry);
}

process.stdout.write(JSON.stringify(settings, null, 2) + "\n");
')"

# ─── Diff and apply ───────────────────────────────────────────────
mkdir -p "$SETTINGS_DIR"

if [[ -f "$SETTINGS_PATH" ]]; then
  ORIGINAL="$(cat "$SETTINGS_PATH")"
else
  ORIGINAL="(no existing settings.json)"
fi

if [[ "$ORIGINAL" == "$NEW_JSON" ]]; then
  echo "[install-hook] $BOT_NAME ($BOT_DIR) — already up-to-date, no changes."
  exit 0
fi

echo "── Diff for $BOT_NAME ($SETTINGS_PATH) ──"
diff -u <(printf '%s' "$ORIGINAL") <(printf '%s' "$NEW_JSON") || true
echo ""

if [[ "$APPLY" -eq 1 ]]; then
  if [[ -f "$SETTINGS_PATH" ]]; then
    cp "$SETTINGS_PATH" "${SETTINGS_PATH}.bak"
    echo "[install-hook] backed up original to ${SETTINGS_PATH}.bak"
  fi
  printf '%s' "$NEW_JSON" > "$SETTINGS_PATH"
  echo "[install-hook] wrote $SETTINGS_PATH"
  echo "[install-hook] NOTE: bot tmux session must be restarted to pick up the new hook."
else
  echo "[install-hook] dry-run only — pass --apply to write."
fi
