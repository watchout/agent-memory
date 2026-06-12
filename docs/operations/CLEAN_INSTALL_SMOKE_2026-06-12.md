# Clean Install Smoke — 2026-06-12

> Evidence record for AM-034 Phase C ("Clean install smoke on a fresh
> directory" / "Copy-paste commands in README verified") and Phase F.
> Method spec: docs/impl/IMPL-2026-06-12-clean-install-smoke.md

## Method

1. Export `origin/main` (commit `00d6d5b`) via `git archive` into a fresh
   temp directory (equivalent to README step 1 clone).
2. `npm install --no-audit --no-fund` → `npm run build` (README step 1).
3. Run `node dist/boot.js` twice against a fresh `$HOME` (mktemp dir):
   - Run A: inheriting the operator shell environment.
   - Run B: isolated `env -i HOME=... PATH=...`.

## Results

| Probe | Run A (inherited env) | Run B (isolated env) |
|---|---|---|
| npm install | OK (120 packages, no native build) | same artifact |
| npm run build | OK | same artifact |
| boot exit | OK, SESSION BOOT rendered | OK, SESSION BOOT rendered |
| storage backend | **PostgreSQL** (shell `DATABASE_URL` inherited) | SQLite (`Using SQLite storage (default)`) |
| `~/.agent-memory/memory.db` created | no (went to PG) | **yes** |
| memory-tags.md installed to `~/.claude/rules/` | yes (FEAT-029) | yes (FEAT-029) |

## Findings

1. **README SQLite quick-start claim is true in a clean environment**:
   fresh HOME + no DB env vars → SQLite at `~/.agent-memory/memory.db`,
   no PostgreSQL, no native build, macOS verified.
2. **Environment inheritance silently switches the backend**: any
   `DATABASE_URL`/`AGENT_MEMORY_DATABASE_URL` in the operator shell makes
   the quick start land on PostgreSQL without warning. Fixed by pinning
   `AGENT_MEMORY_DB_TYPE=sqlite` in the README quick-start mcp.json env
   (this PR) — the resolution order is documented in
   `src/stores/index.ts`.
3. **Boot reinstalled the retired memory-tags.md rule** (FEAT-029
   auto-installer) — filed and fixed separately as PR #173; this smoke
   predates that merge and reproduces the behavior.

## Claim boundaries

This record supports "clean install smoke executed on macOS, Node 22"
only. It is not a Windows claim, not a recovery-quality claim, and not a
public-alpha gate pass by itself (AM-034 §5 Phase C requires the full
evidence set).
