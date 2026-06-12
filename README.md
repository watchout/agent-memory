# wasurezu

> **Persistent memory for AI coding agents.**
> Your context window forgets. Your database doesn't.

`wasurezu` (Japanese for "won't forget") is an [MCP](https://modelcontextprotocol.io) server that gives AI coding agents like Claude Code a persistent, structured memory layer. Decisions, task state, and learnings survive context-window compaction and session crashes.

`Kusabi` is the additive public-facing alias for the same tool. Existing
`wasurezu` package identity, MCP server config, MCP tool namespace, database
paths, and startup recovery instructions remain supported and authoritative
during the transition. The compatibility boundary is recorded in
[`docs/brand/kusabi-naming-decision.md`](docs/brand/kusabi-naming-decision.md);
the active design source set is recorded in
[`docs/design/SOURCE_ALIGNMENT.md`](docs/design/SOURCE_ALIGNMENT.md).

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
        "AGENT_MEMORY_PROJECT": "my-project",
        "AGENT_MEMORY_DB_TYPE": "sqlite"
      }
    }
  }
}
```

> `AGENT_MEMORY_DB_TYPE=sqlite` pins the local SQLite backend. Without it,
> a `DATABASE_URL` inherited from your shell silently switches the server
> to PostgreSQL (resolution order in `src/stores/index.ts`).

### 3. Optional Fallback Instructions

Add this to your project's `CLAUDE.md` only as a soft fallback. Normal startup
recovery should come from a host adapter, hook, launcher, or supervisor loading
a bounded restart pack before the model acts.

```markdown
## Fallback Memory Instructions
If no startup adapter or hook has already loaded recovery context:
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
  → Host adapter or hook loads a bounded restart_pack
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
| `restart_pack` | Generate a concise restart summary, or `recovery-pack/v1` / `host-invocation-context/v1` JSON for adapter automation |
| `restart_prepare` | Prepare a restart pack plus confidence, missing context, provenance, and restart recommendation for a host/AUN orchestrator |
| `restart_pack_fetch` | Fetch or consume a selected restart pack produced by `restart_prepare` |
| `set_recovery_config` | Tune recovery output limits per agent |
| `ingest_conversation_events` | Sweep local Claude Code / Codex JSONL transcripts into redacted full-text conversation event storage |

## Storage

wasurezu supports two storage backends:

| Backend | Setup | Best for |
|---------|-------|----------|
| **SQLite** (default) | Zero config — file at `~/.agent-memory/memory.db` | Single user, OSS users, simple setups |
| **PostgreSQL + pgvector** | Set `AGENT_MEMORY_DATABASE_URL=postgresql://...` | Multi-agent teams, semantic vector search, large-scale |

Both modes support the same MCP tools. PostgreSQL adds vector similarity search via [pgvector](https://github.com/pgvector/pgvector) and Voyage AI embeddings.

Conversation memory is redacted full-text event storage, not an unfiltered
transcript dump. The ingest adapters keep visible user/assistant/tool context
after redaction and source filtering, exclude hidden reasoning and developer
instruction bodies, and make the events searchable through
`search_memory scope=conversation`. `restart_pack` summarizes conversation
metadata and fallback guidance, but does not emit raw transcript excerpts.

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
| `AGENT_MEMORY_SELECTED_PACK_REF` | No | — | Consume this selected restart pack during `AGENT_MEMORY_BOOT_MODE=restart_pack` boot, then fall back to a generated pack if unavailable |
| `VOYAGE_API_KEY` | No | — | Voyage AI key for embedding generation (PG mode only) |

## Compatibility

| Tool | Status |
|------|--------|
| **Claude Code** | ✅ MCP + `wasurezu-claude-start` runner + native SessionStart load hook |
| **Codex** | 🧪 MCP tools work; startup recovery requires `wasurezu-codex-start` runtime adapter |
| **Cursor / Gemini CLI** | ⏳ MCP tools work; startup integration in a later release |
| **Other MCP-compatible tools** | ✅ MCP tools work |

See [`docs/operations/HOST_ADAPTERS.md`](docs/operations/HOST_ADAPTERS.md) for
the support-level matrix. In short: MCP tools alone are manual recovery.
Startup recovery requires a host adapter or native startup hook that places
`restart_pack` in the first model context. The control-plane source of truth is
Wasurezu's durable ledger and recovery pack state, not a live TUI transcript.
TUI text injection is a compatibility fallback only.

### Claude Code resession recovery

Claude Code has a native SessionStart hook that can load a selected restart
pack, but the hook is not the restart policy owner. Use the Claude runner when
you want Wasurezu to deterministically observe host context-health input,
prepare a structured selected pack, and then launch a fresh Claude session only
when standalone restart gates are pre-authorized:

```bash
export AGENT_MEMORY_AGENT_ID=auditor
export AGENT_MEMORY_PROJECT=dev-auditor

# Prepare evidence only. This is the default and does not launch Claude.
npx wasurezu-claude-start --context-used-ratio 0.91

# Launch a fresh Claude session only when standalone gates pass.
npx wasurezu-claude-start --launch \
  --mode auto_restart \
  --aun-absent \
  --supervisor-available \
  --restart-preauthorized \
  --cd ~/Developer/dev-auditor \
  --mcp-config .mcp.json
```

The runner always prepares `host-invocation-context/v1` with
`target_runtime=claude` and `delivery_mode=session-start-hook`. It passes the
selected pack reference through `AGENT_MEMORY_SELECTED_PACK_REF` and
`AGENT_MEMORY_BOOT_MODE=restart_pack` so the next SessionStart hook can consume
the pack. `--launch` fails closed when AUN is installed, AUN absence is
unknown, no supervisor/host hook is available, restart is not pre-authorized,
or the context signal only requires `prepare`/`warn`.

`wasurezu-claude-start` does not kill or replace existing Claude sessions.
Close the old session through Claude's normal lifecycle or an installed
supervisor before launching a fresh one. TUI input and SessionStart self-kick
remain fallback only.

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

# Inspect the local Codex CLI contract without launching Codex.
npx wasurezu-codex-start --doctor
```

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

The package also ships optional operator scripts under
`scripts/host-adapters/` for repo/package-based installs:

```bash
scripts/host-adapters/codex-bridge-launch.sh --dry-run --cd ~/Developer/codex
scripts/host-adapters/codex-tmux-exit.sh --dry-run --session codex
scripts/host-adapters/codex-tmux-start.sh --dry-run --session codex --cd ~/Developer/codex
scripts/host-adapters/codex-tmux-restart.sh --dry-run --session codex --cd ~/Developer/codex
```

These scripts are operator conveniences. They do not make Wasurezu the owner of
Codex lifecycle, do not mutate AUN queue state, and are not public-alpha
startup-recovery evidence unless paired with a real launcher-controlled run and
recovery report.

Current Codex launch hardening is explicit about the remaining CLI limitation:
the tested contract is `codex [OPTIONS] [PROMPT]`. Until Codex exposes and this
project verifies a stdin or prompt-file startup surface, the bounded
`restart_pack` prompt may be visible in the Codex process argv during launch.
Use `--doctor` and `--dry-run` to record local compatibility evidence without
launching Codex.

When integrated with AUN or another supervisor, that orchestrator owns runtime
restart/requeue execution. wasurezu supplies restart packs, recovery confidence,
missing-context notes, provenance, and continuity signals; it does not mutate
AUN queue state, claim/requeue lifecycle, delivery, finalization, reply, or
close.

When AUN is absent, a supported wasurezu supervisor or host hook may run local
`auto_restart` only if restart lifecycle was pre-authorized at install or config
time and AUN absence is explicitly confirmed. Unknown AUN status fails closed
to `recommend`. Pure MCP-only installs remain manual recovery: wasurezu can
prepare packs and recommend restart, but cannot force the host to restart.

For deterministic orchestration, hosts should call `restart_prepare` first. It
returns `pack_update_needed`, `restart_recommended`, or `restart_required` with
recovery confidence, missing-context notes, provenance, and a `restart_pack`
reference such as `selected_restart_pack:<id>`. Hosts can fetch it through
`restart_pack_fetch` or `wasurezu-restart fetch --pack-ref <ref> --consume`, or
pass it to boot with `AGENT_MEMORY_SELECTED_PACK_REF`. It never mutates AUN
queue state or performs runtime lifecycle actions. Runtime adapters invoke the
model/runtime, pass bounded recovery context, and return structured evidence;
they do not own restart policy or recovery-pack ranking.

For adapter automation, `restart_prepare` can persist selected packs as
`recovery-pack/v1` or `host-invocation-context/v1` JSON by setting
`pack_format`; the default remains human-readable text for compatibility.

Without this bridge, Codex support should be described as manual MCP recovery:
the user or agent must explicitly call `restart_pack` after startup.

## Release Roadmap

The public MCP release gate is tracked in
[`docs/operations/WORLD_CLASS_RELEASE_CRITERIA.md`](./docs/operations/WORLD_CLASS_RELEASE_CRITERIA.md).
It distinguishes internal opt-in, internal default, MCP public alpha, and the
final world-class public release bar.

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
