# agent-memory

Persistent memory for AI coding agents. Survives compaction. Works across sessions.

> **Your AI forgot everything after compaction. This fixes it.**

## The Problem

Claude Code (and similar AI coding tools) suffers from two memory problems:

1. **Intra-session compaction** — When context fills up (~83%), auto-compaction wipes conversation history. Decisions, reasoning, and context vanish. The AI continues working *confidently* with degraded quality.

2. **Cross-session amnesia** — Every new session starts from scratch. Yesterday's decisions, half-finished tasks, and failed approaches are all gone.

`CLAUDE.md` helps with static instructions, but can't preserve *dynamic* context — the decisions made during conversations.

## The Solution

agent-memory is an MCP server that gives your AI agent persistent, structured memory:

- **Decision Log** — Save important decisions with context and reasoning. They survive compaction.
- **Task State** — Track work progress. Know what was done and what's next.
- **Context Recovery** — After compaction, automatically restore decisions and task state.
- **Session Boot** — Start new sessions with full context from previous work.

### Key Design Principle

**Does not depend on LLM judgment.** Uses CLAUDE.md Compact Instructions to trigger recovery automatically. The AI doesn't need to *remember* to remember.

## Quick Start

### 1. Install

```bash
# Clone
git clone https://github.com/iyasaka/agent-memory.git
cd agent-memory

# Install dependencies
npm install

# Build
npm run build
```

### 2. Configure Claude Code

Add to your Claude Code MCP settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "node",
      "args": ["/path/to/agent-memory/dist/index.js"],
      "env": {
        "AGENT_MEMORY_AGENT_ID": "my-agent",
        "AGENT_MEMORY_PROJECT": "my-project"
      }
    }
  }
}
```

### 3. Add to CLAUDE.md

Add this to your project's `CLAUDE.md`:

```markdown
## Compact Instructions
After compaction, as your FIRST action:
1. Call `recover_context` to restore decisions and task state
2. Review the recovered context before continuing work

## Memory Rules
- After making important decisions, call `log_decision` to record them
- At task breakpoints, call `save_task_state` to save progress
- When changing a previous decision, use `supersede_decision`
```

### 4. (Optional) PostgreSQL

For multi-agent setups or better performance, set `DATABASE_URL`:

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "node",
      "args": ["/path/to/agent-memory/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgres://user:pass@localhost:5432/agents",
        "AGENT_MEMORY_AGENT_ID": "cto-bot",
        "AGENT_MEMORY_PROJECT": "hotel-app"
      }
    }
  }
}
```

Run migrations:
```bash
DATABASE_URL=postgres://... npm run migrate
```

Without `DATABASE_URL`, agent-memory uses JSON files in `~/.agent-memory/` automatically.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `log_decision` | Save an important decision with context and reasoning |
| `get_decisions` | Retrieve active decisions (filterable by project, tags) |
| `supersede_decision` | Replace an old decision with a new one |
| `save_task_state` | Save current work progress |
| `recover_context` | Restore all context after compaction or session start |

## How It Works

```
Session Start
  → recover_context auto-called (via CLAUDE.md)
  → Active decisions + task states injected into session
  → AI continues where it left off

During Session
  → Important decisions saved via log_decision
  → Task progress saved via save_task_state
  → Conflicting decisions handled via supersede_decision

Compaction Happens (~83% context)
  → Compact Instructions trigger recover_context
  → Decisions and task state restored
  → AI continues with full context
```

## Storage

| Mode | Storage | When |
|------|---------|------|
| PostgreSQL | `decisions` + `task_states` tables | `DATABASE_URL` is set |
| JSON (default) | `~/.agent-memory/*.json` | No `DATABASE_URL` |

Both modes support the same features. PostgreSQL is recommended for multi-agent setups.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | No | PostgreSQL connection string |
| `AGENT_MEMORY_AGENT_ID` | No | Agent identifier (default: "default") |
| `AGENT_MEMORY_PROJECT` | No | Default project name |

## Compatibility

- **Claude Code** — Full support (MCP + Compact Instructions)
- **Cursor** — MCP tools work; no hook integration
- **Other MCP-compatible tools** — MCP tools work

## Related

- [agent-com](https://github.com/iyasaka/agent-com) — Push-based multi-agent communication for Claude Code. Can share the same PostgreSQL database for cross-agent memory.

## License

MIT
