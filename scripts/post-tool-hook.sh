#!/usr/bin/env bash
# AM-006: PostToolUse hook entry point for internal multi-agent deployment.
#
# Each bot's .claude/settings.json calls this script from its own working
# directory; this wrapper cd's into the agent-memory repo first so that
# `tsx` can resolve `src/post-tool-hook.ts` relative to a known root,
# regardless of where the calling bot lives.
#
# Required env vars (set per-bot in the calling settings.json):
#   DATABASE_URL              postgresql://...
#   AGENT_MEMORY_AGENT_ID     bot identifier (e.g. "cto", "arc", "agent-mem-dev")
#   AGENT_MEMORY_PROJECT      project label (usually the bot's working dir name)
#
# OSS NOTE: this wrapper is for internal multi-bot deployment only.
# Once `wasurezu` is published to npm, the hook should run from the bin
# entry point instead of `tsx src/`. AM-006 keeps tsx because we want
# every PR merge to be live for all bots without a rebuild step.

set -e

AGENT_MEMORY_DIR="/Users/yuji/Developer/agent-memory"
cd "$AGENT_MEMORY_DIR"

exec npx tsx src/post-tool-hook.ts
