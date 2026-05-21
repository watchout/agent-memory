# wasurezu

> **Persistent memory for AI coding agents.**
> Your context window forgets. Your database doesn't.

`wasurezu` (Japanese for "won't forget") is an [MCP](https://modelcontextprotocol.io) server that gives AI coding agents like Claude Code a persistent, structured memory layer. Decisions, task state, and learnings survive context-window compaction and session crashes.

> ⚠️ **Early Stage (v0.3.0, internal-use snapshot)** — currently used internally by the IYASAKA bot swarm. The public OSS release is in preparation (see AM-013 / AM-014). API may still change before the first public alpha. Feedback welcome via GitHub Issues.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)

## The Problem

AI coding sessions lose context constantly:

- 🪦 **Compaction wipes history** — When the context window fills up, auto-compaction removes old messages. Decisions, reasoning, and design discussions vanish.
- 💥 **Sessions crash** — Network blip, OOM, accidental close — and the entire session is gone.
- 🔁 **Cross-session amnesia** — Every new session starts from zero. You re-explain what was already decided yesterday.

Static instructions (`CLAUDE.md`) only solve part of the problem. They preserve *static* rules, not *dynamic* context.

## The Solution

wasurezu runs as a local MCP server on your machine. Your AI agent calls memory tools, and the data goes into a database that survives any session restart.

- 📋 **Decision Log** — Save important decisions with context and reasoning. They survive compaction.
- ✅ **Task State** — Track work progress. Know what's done and what's next.
- 📚 **Cross-Session Memory** — What one session learns, the next session knows.
- 🔄 **Compaction Recovery** — Restore lost context from your database via `recover_context`.
- 🚀 **Session Boot** — New sessions automatically restore prior context.
- 🎣 **Auto-tagging** — Write `[TASK:start]` `[DECISION]` `[KNOWLEDGE]` in your messages and they're auto-recorded.

## Quick Start (3 steps, 2 minutes)

### 1. Install

```bash
git clone https://github.com/watchout/agent-memory.git
cd agent-memory
npm install && npm run build
```

> Note: npm publish is in progress (AM-014). Once published, this will switch back to `npm install -g wasurezu`.

### 2. Configure Claude Code

Add to `~/.claude/mcp.json` (or your project's `.mcp.json`):

```json
{
  "mcpServers": {
    "wasurezu": {
      "command": "node",
      "args": ["<path-to-agent-memory>/dist/index.js"],
      "env": {
        "AGENT_MEMORY_AGENT_ID": "my-agent",
        "AGENT_MEMORY_PROJECT": "my-project"
      }
    }
  }
}
```

### 3. Add Compact Instructions

Add this to your project's `CLAUDE.md`:

```markdown
## Compact Instructions
After compaction, as your FIRST action:
1. Call `recover_context` to restore decisions and task state
2. Review the recovered context before continuing

## Memory Rules
- After important decisions, call `log_decision` to record them
- At task breakpoints, call `save_task_state` to save progress
- When changing a previous decision, use `supersede_decision`
```

**Done.** Restart Claude Code. wasurezu now persists your context to a local SQLite database at `~/.agent-memory/memory.db`. No PostgreSQL needed. No native build required. Works on macOS and Linux. Windows support is planned (post-MVP).

## Demo

```text
=== Session Boot ===
Project: hotel-app
Agent: default

Active Decisions (3):
- [architecture] JWT for auth: chose JWT over session cookies for API-first design
- [database] PostgreSQL: ruled out SQLite for multi-agent access
- [convention] Use Conventional Commits

Pending Tasks (2):
- [in_progress] Implement RBAC middleware
  Progress: JWT verification done, role-based access control pending
- [in_progress] Migrate user table to UUID primary keys

Recent Knowledge (5):
- ConoHa VPS: PM2 requires env vars passed at start (not from .env)
- Voyage embeddings: 512-dim vectors, $0.05/M tokens
...

Total items restored: 10
==========================================
```

(Demo GIF coming soon — see [#35](https://github.com/watchout/agent-memory/issues/35))

## How It Works

```
Session Start
  → SessionStart hook emits restart_pack recovery
  → Current objective + next action + recovery controls injected
  → AI continues where it left off

During Session
  → log_decision / save_task_state / save_knowledge save context
  → Or write tags ([TASK:start]/[DECISION]/[KNOWLEDGE]) in Discord/Slack
    → PostToolUse hook auto-detects and records (no manual call needed)
  → Conflicting decisions handled via supersede_decision

Compaction (~83% context)
  → Compact Instructions trigger recover_context
  → Restored: decisions + tasks + knowledge + conversation summary
  → AI continues with full context
```

## MCP Tools

| Tool | Purpose |
|------|---------|
| `log_decision` | Record an important design / technology / convention decision |
| `get_decisions` | Retrieve active decisions (filterable by project / tags / status) |
| `supersede_decision` | Replace an old decision with a new one (preserves history) |
| `save_task_state` | Save current work snapshot (status, progress, files modified) |
| `save_knowledge` | Store a knowledge / insight / pattern |
| `get_knowledge` | Retrieve knowledge entries |
| `supersede_knowledge` | Replace an outdated knowledge entry with a corrected one (AM-024) |
| `update_knowledge_status` | Archive / merge knowledge entries |
| `search_memory` | Cross-cutting search across decisions / tasks / knowledge / conversation events |
| `recover_context` | Restore all context (called after compaction) |
| `restart_pack` | Generate a concise restart summary for continuing after session refresh |
| `set_recovery_config` | Tune recovery output limits per agent |
| `ingest_conversation_events` | Sweep local Claude Code / Codex JSONL transcripts into raw event storage |

## Storage

wasurezu supports two storage backends:

| Backend | Setup | Best for |
|---------|-------|----------|
| **SQLite** (default) | Zero config — file at `~/.agent-memory/memory.db` | Single user, OSS users, simple setups |
| **PostgreSQL + pgvector** | Set `AGENT_MEMORY_DATABASE_URL=postgresql://...` | Multi-agent teams, semantic vector search, large-scale |

Both modes support the same MCP tools. PostgreSQL adds vector similarity search via [pgvector](https://github.com/pgvector/pgvector) and Voyage AI embeddings.

To use PostgreSQL:

```bash
docker compose up -d  # see docker-compose.yml in repo root
export AGENT_MEMORY_DATABASE_URL=postgresql://agent_memory:dev@localhost/agent_memory
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENT_MEMORY_DB_TYPE` | No | `sqlite` | `sqlite` / `postgres` / `json` |
| `AGENT_MEMORY_DB_PATH` | No | `~/.agent-memory/memory.db` | SQLite file path |
| `AGENT_MEMORY_DATABASE_URL` | No | — | PostgreSQL connection string |
| `DATABASE_URL` | No | — | Legacy alias for `AGENT_MEMORY_DATABASE_URL` |
| `AGENT_MEMORY_AGENT_ID` | No | `default` | Agent identifier (multi-agent namespace) |
| `AGENT_MEMORY_PROJECT` | No | — | Default project name |
| `VOYAGE_API_KEY` | No | — | Voyage AI key for embedding generation (PG mode only) |

## Compatibility

| Tool | Status |
|------|--------|
| **Claude Code** | ✅ Full support (MCP + SessionStart hook + Compact Instructions) |
| **Codex** | 🧪 MCP tools work; startup recovery requires `wasurezu-codex-start` bridge |
| **Cursor / Gemini CLI** | ⏳ MCP tools work; startup integration in a later release |
| **Other MCP-compatible tools** | ✅ MCP tools work |

See [`docs/operations/HOST_ADAPTERS.md`](docs/operations/HOST_ADAPTERS.md) for
the support-level matrix. In short: MCP tools alone are manual recovery.
Startup recovery requires a host adapter or native startup hook that places
`restart_pack` in the first model context.

### Codex startup recovery

Codex can use wasurezu MCP tools, but plain MCP configuration does not
automatically call `restart_pack` when a new Codex session starts. Use the
startup bridge when you want restart recovery to be present in the first Codex
prompt:

```bash
export AGENT_MEMORY_AGENT_ID=codex-cto
export AGENT_MEMORY_PROJECT=codex

# Print a restart_pack-backed prompt.
npx wasurezu-codex-start

# Or launch Codex with that prompt.
npx wasurezu-codex-start --launch --cd ~/Developer/codex
```

For tmux-based local operations, optional host-adapter scripts are included:

```bash
CODEX_WORKSPACE=~/Developer/codex scripts/host-adapters/codex-tmux-restart.sh
```

These scripts are wrappers around the same `wasurezu-codex-start` bridge. They
are intended for local operations and tests, not as MCP core lifecycle
ownership.

The intended Codex restart UX is to exit the old session first, then start a
fresh session through the bridge:

```text
/exit
```

```bash
npx wasurezu-codex-start --launch --cd ~/Developer/codex
```

wasurezu does not kill or replace existing Codex sessions. Session lifecycle is
owned by the user or host. This keeps the bridge portable and avoids ambiguous
singleton ownership.

Without this bridge, Codex support should be described as manual MCP recovery:
the user or agent must explicitly call `restart_pack` after startup.

## Requirements

- Node.js 18+
- Optional: PostgreSQL 14+ with [pgvector](https://github.com/pgvector/pgvector) (for PG mode)
- Optional: [Voyage AI](https://www.voyageai.com/) API key (for semantic search)

## Contributing

We welcome contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development setup, PR process, and code style guidelines.

All contributions to core are MIT licensed and will remain free forever.

## Related Projects

- [**agent-com**](https://github.com/watchout/agent-comms-mcp) — Push-based multi-agent communication for Claude Code. Can share the same PostgreSQL database with wasurezu for cross-agent memory linkage.

## License

[MIT](./LICENSE) — see LICENSE file for details.

## Why "wasurezu"?

「忘れず」(*wasurezu*) is Japanese for "won't forget" — a reminder of what this tool exists to do. Your AI shouldn't have to forget.

---

**Built by [IYASAKA](https://github.com/watchout)** — a small team that runs wasurezu daily inside its 16-bot internal AI development swarm to keep agents coherent across compactions and crashes. We are using v0.3.0 internally; the public OSS release is in preparation and the API may still shift before the first public alpha.
