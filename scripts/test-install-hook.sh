#!/usr/bin/env bash
# Smoke test for scripts/install-hook.sh.
#
# Verifies the properties that matter for AM-006 / AM-022 deployment:
#   1. dry-run does NOT modify the target file
#   2. --apply on a fresh dir creates settings.json with the correct hook
#      and writes a .bak only when there was an original to back up
#   3. --apply is idempotent: re-running against the now-installed file
#      leaves it byte-identical
#   4. --apply against a settings.json that already has unrelated hooks
#      preserves those hooks and merges the PostToolUse entry
#   5. --mcp creates/updates .mcp.json with mcpServers.wasurezu
#   6. --mode sqlite switches both hook and MCP env vars to SQLite
#
# Run: bash scripts/test-install-hook.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="${SCRIPT_DIR}/install-hook.sh"

passed=0
failed=0

assert() {
  if [[ "$2" == "true" ]]; then
    echo "  ✅ $1"
    passed=$((passed + 1))
  else
    echo "  ❌ $1"
    failed=$((failed + 1))
  fi
}

run_test() {
  local name="$1"
  echo ""
  echo "── $name ──"
}

cleanup() {
  if [[ -n "${TMP_BASE:-}" && -d "$TMP_BASE" ]]; then
    rm -rf "$TMP_BASE"
  fi
}
trap cleanup EXIT

TMP_BASE="$(mktemp -d -t am-006-installer-test-XXXXXX)"
echo "Test base: $TMP_BASE"

# ─── Test 1: dry-run on a fresh dir does not write ────────────────
run_test "dry-run does not write"
TARGET_DIR="${TMP_BASE}/fresh"
mkdir -p "$TARGET_DIR"

# Run dry-run (no --apply); we provide --dir so the script does not
# need a real bot in the mapping table.
"$INSTALLER" cto --dir "$TARGET_DIR" >/dev/null

assert "settings.json was NOT created on dry-run" \
  "$([[ ! -f "${TARGET_DIR}/.claude/settings.json" ]] && echo true || echo false)"

# ─── Test 2: --apply creates the file ─────────────────────────────
run_test "--apply on fresh dir creates settings.json"
"$INSTALLER" cto --dir "$TARGET_DIR" --apply >/dev/null

assert "settings.json was created" \
  "$([[ -f "${TARGET_DIR}/.claude/settings.json" ]] && echo true || echo false)"
assert "no .bak (no original to back up)" \
  "$([[ ! -f "${TARGET_DIR}/.claude/settings.json.bak" ]] && echo true || echo false)"

PROJECT_LABEL="$(basename "$TARGET_DIR")"
assert "settings.json contains AGENT_MEMORY_AGENT_ID=cto" \
  "$(grep -q 'AGENT_MEMORY_AGENT_ID=cto' "${TARGET_DIR}/.claude/settings.json" && echo true || echo false)"
assert "settings.json contains AGENT_MEMORY_PROJECT=$PROJECT_LABEL" \
  "$(grep -q "AGENT_MEMORY_PROJECT=${PROJECT_LABEL}" "${TARGET_DIR}/.claude/settings.json" && echo true || echo false)"
assert "settings.json contains the AM-016 Bash matcher" \
  "$(grep -q 'Bash|mcp__agent-comms__reply' "${TARGET_DIR}/.claude/settings.json" && echo true || echo false)"
assert "settings.json contains the wrapper path" \
  "$(grep -q 'agent-memory/scripts/post-tool-hook.sh' "${TARGET_DIR}/.claude/settings.json" && echo true || echo false)"

# ─── Test 3: --apply is idempotent ────────────────────────────────
run_test "--apply is idempotent"
ORIG_HASH="$(shasum -a 256 "${TARGET_DIR}/.claude/settings.json" | awk '{print $1}')"
"$INSTALLER" cto --dir "$TARGET_DIR" --apply >/dev/null
NEW_HASH="$(shasum -a 256 "${TARGET_DIR}/.claude/settings.json" | awk '{print $1}')"
assert "second --apply leaves the file byte-identical" \
  "$([[ "$ORIG_HASH" == "$NEW_HASH" ]] && echo true || echo false)"

# ─── Test 4: existing unrelated hooks are preserved ───────────────
run_test "existing unrelated hooks are preserved"
TARGET_DIR2="${TMP_BASE}/with-existing"
mkdir -p "${TARGET_DIR2}/.claude"
cat > "${TARGET_DIR2}/.claude/settings.json" <<'JSON'
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "echo session-start-original" }
        ]
      }
    ]
  }
}
JSON

"$INSTALLER" cto --dir "$TARGET_DIR2" --apply >/dev/null

assert ".bak created when original existed" \
  "$([[ -f "${TARGET_DIR2}/.claude/settings.json.bak" ]] && echo true || echo false)"
assert "SessionStart hook preserved" \
  "$(grep -q 'session-start-original' "${TARGET_DIR2}/.claude/settings.json" && echo true || echo false)"
assert "PostToolUse hook added" \
  "$(grep -q 'PostToolUse' "${TARGET_DIR2}/.claude/settings.json" && echo true || echo false)"

# ─── Test 5: matcher upgrade replaces existing entry ──────────────
run_test "re-running with the same matcher updates in place (no duplicate)"
"$INSTALLER" cto --dir "$TARGET_DIR2" --apply >/dev/null
PT_COUNT="$(grep -c 'Bash|mcp__agent-comms__reply' "${TARGET_DIR2}/.claude/settings.json" || true)"
assert "matcher appears exactly once after re-run" \
  "$([[ "$PT_COUNT" == "1" ]] && echo true || echo false)"

# ─── Test 6: --mcp creates .mcp.json in PostgreSQL mode ───────────
run_test "--mcp creates .mcp.json in PostgreSQL mode"
TARGET_DIR3="${TMP_BASE}/with-mcp"
mkdir -p "$TARGET_DIR3"
"$INSTALLER" cto --dir "$TARGET_DIR3" --mcp --apply >/dev/null

assert ".mcp.json was created" \
  "$([[ -f "${TARGET_DIR3}/.mcp.json" ]] && echo true || echo false)"
assert ".mcp.json contains wasurezu server" \
  "$(grep -q '"wasurezu"' "${TARGET_DIR3}/.mcp.json" && echo true || echo false)"
assert ".mcp.json points at dist/index.js" \
  "$(grep -q 'agent-memory/dist/index.js' "${TARGET_DIR3}/.mcp.json" && echo true || echo false)"
assert ".mcp.json contains DATABASE_URL in postgres mode" \
  "$(grep -q '"DATABASE_URL": "postgresql://localhost/agent_comms"' "${TARGET_DIR3}/.mcp.json" && echo true || echo false)"
assert ".mcp.json contains AGENT_MEMORY_AGENT_ID=cto" \
  "$(grep -q '"AGENT_MEMORY_AGENT_ID": "cto"' "${TARGET_DIR3}/.mcp.json" && echo true || echo false)"

run_test "--mcp is idempotent when only .mcp.json is already current"
MCP_HASH="$(shasum -a 256 "${TARGET_DIR3}/.mcp.json" | awk '{print $1}')"
"$INSTALLER" cto --dir "$TARGET_DIR3" --mcp --apply >/dev/null
MCP_HASH_2="$(shasum -a 256 "${TARGET_DIR3}/.mcp.json" | awk '{print $1}')"
assert "second --mcp --apply leaves .mcp.json byte-identical" \
  "$([[ "$MCP_HASH" == "$MCP_HASH_2" ]] && echo true || echo false)"

# ─── Test 7: SQLite mode switches hook + MCP env ─────────────────
run_test "--mode sqlite switches hook and MCP env"
TARGET_DIR4="${TMP_BASE}/sqlite-mode"
mkdir -p "$TARGET_DIR4"
"$INSTALLER" secretary --dir "$TARGET_DIR4" --mode sqlite --mcp --apply >/dev/null

assert "settings.json contains AGENT_MEMORY_DB_TYPE=sqlite" \
  "$(grep -q 'AGENT_MEMORY_DB_TYPE=sqlite' "${TARGET_DIR4}/.claude/settings.json" && echo true || echo false)"
assert "settings.json contains secretary SQLite DB path" \
  "$(grep -q 'AGENT_MEMORY_DB_PATH=/Users/yuji/.agent-memory/secretary.db' "${TARGET_DIR4}/.claude/settings.json" && echo true || echo false)"
assert ".mcp.json contains AGENT_MEMORY_DB_TYPE sqlite" \
  "$(grep -q '"AGENT_MEMORY_DB_TYPE": "sqlite"' "${TARGET_DIR4}/.mcp.json" && echo true || echo false)"
assert ".mcp.json contains secretary SQLite DB path" \
  "$(grep -q '"AGENT_MEMORY_DB_PATH": "/Users/yuji/.agent-memory/secretary.db"' "${TARGET_DIR4}/.mcp.json" && echo true || echo false)"
assert ".mcp.json omits DATABASE_URL in sqlite mode" \
  "$(! grep -q '"DATABASE_URL"' "${TARGET_DIR4}/.mcp.json" && echo true || echo false)"

# ─── Test 8: invalid mode fails cleanly ───────────────────────────
run_test "invalid --mode fails"
if "$INSTALLER" cto --dir "$TARGET_DIR" --mode definitely-not-real 2>/dev/null; then
  assert "invalid mode should exit non-zero" "false"
else
  assert "invalid mode exits non-zero" "true"
fi

# ─── Test 9: unknown bot without --dir fails cleanly ──────────────
run_test "unknown bot_name without --dir fails"
if "$INSTALLER" definitely-not-a-real-bot 2>/dev/null; then
  assert "unknown bot_name should exit non-zero" "false"
else
  assert "unknown bot_name exits non-zero" "true"
fi

# ─── Results ──────────────────────────────────────────────────────
echo ""
echo "── Results: $passed passed, $failed failed ──"
[[ "$failed" -eq 0 ]] || exit 1
