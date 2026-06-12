# Troubleshooting

> Top failure modes for Kusabi / wasurezu, with verification commands.
> Format per entry: Symptom → Cause → Fix → Verify.
> Spec: `docs/impl/IMPL-2026-06-12-troubleshooting-doc.md` (AM-034 §4.6).

## 1. Hook logs "DATABASE_URL is not set ... skipping"

- **Symptom**: stderr line `[agent-memory hook] DATABASE_URL is not set (env nor config.json), skipping`; nothing is recorded.
- **Cause**: PostgreSQL mode is implied (no `AGENT_MEMORY_DB_TYPE=sqlite|json`) but no connection string is available in env or `~/.agent-memory/config.json`.
- **Fix**: either set `AGENT_MEMORY_DB_TYPE=sqlite` for local use, or provide `DATABASE_URL` (env or `database_url` in `~/.agent-memory/config.json`).
- **Verify**: `echo '{}' | DATABASE_URL= AGENT_MEMORY_DB_TYPE=sqlite npx tsx src/post-tool-hook.ts; echo $?` → exits `0` without the warning.

## 2. Explicit PostgreSQL mode refuses to start

- **Symptom**: server/process throws on startup when PostgreSQL is unreachable, instead of silently using SQLite.
- **Cause**: intentional fail-closed behavior — with `AGENT_MEMORY_DB_TYPE=postgres`, wasurezu never falls back to another store (regression-tested in `src/test.ts`: "explicit postgres mode refuses SQLite fallback on connection failure").
- **Fix**: restore DB connectivity or change `AGENT_MEMORY_DB_TYPE` deliberately. Do not treat the fallback refusal as a bug.
- **Verify**: `AGENT_MEMORY_DB_TYPE=postgres DATABASE_URL=postgresql://127.0.0.1:1/nope PGCONNECT_TIMEOUT=1 npx tsx -e 'import("./src/stores/index.js").then(m=>m.createStore()).catch(()=>console.log("fail-closed OK"))'`

## 3. Hook works in terminal but not under Claude Code

- **Symptom**: running the hook manually inserts records, but the PostToolUse hook in `settings.json` does nothing.
- **Cause**: PostToolUse hooks run as child processes of the Claude SDK and do **not** inherit `.mcp.json` env vars (SSOT-3 §環境変数の受け渡し).
- **Fix**: inline the env vars in the hook command string, or place them in `~/.agent-memory/config.json`. See `templates/hooks-example.jsonc`.
- **Verify**: the hook command in `.claude/settings.json` contains `DATABASE_URL=` (or config.json carries `database_url`).

## 4. MCP tools missing or rejecting parameters after an upgrade

- **Symptom**: a tool (e.g. `search_memory scope=conversation`) errors with a schema/validation failure although the source supports it.
- **Cause**: the MCP client session cached the old tool schema; the server binary was rebuilt but the session was not reloaded (observed in the AM-031 recovery retest, 2026-05-20).
- **Fix**: `npm run build`, then restart/reload the MCP server connection in the client (new session or MCP reload).
- **Verify**: the failing call succeeds in a fresh session; `git log -1` commit matches the running server's build time.

## 5. Boot prints "restart_pack failed, falling back to recover_context format"

- **Symptom**: that stderr line during SessionStart boot (`src/boot.ts`).
- **Cause**: restart-pack generation failed (DB hiccup, empty/new DB, or a bug); boot deliberately degrades to the legacy recovery format instead of breaking host startup.
- **Fix**: nothing destructive happened. Inspect the appended error text; for a new DB this is benign. Recovery quality is lower until the cause is fixed.
- **Verify**: `HOME=$(mktemp -d) npx tsx src/test-boot-recovery.ts` passes (fallback path covered).

## 6. `wasurezu-restart` fails or restarts the wrong way

- **Symptom**: restart preparation errors, or the restart command is rejected.
- **Cause**: legacy/relative-path restart command configuration (pre-#160 configs), or missing pre-authorization flags.
- **Fix**: run the built-in preflight and follow its remediation lines, e.g. set `WASUREZU_RESTART_COMMAND=wasurezu-claude-start --launch`.
- **Verify**: `wasurezu-restart preflight [--restart-command CMD]` reports pass; see `wasurezu-restart help` for flags.

## 7. "Codex doesn't recover automatically"

- **Symptom**: a Codex session started from plain MCP config has no boot context.
- **Cause**: by design — plain MCP config is **manual recovery** (call `restart_pack` / `recover_context` yourself). Codex startup recovery requires the bridge launcher (`wasurezu-codex-start`).
- **Fix**: launch via `wasurezu-codex-start --launch --cd <workspace>`, or accept manual recovery.
- **Known limitation**: Codex positional prompt delivery may expose a bounded restart pack in process argv until a safer verified surface exists (AM-034 §Phase C known limitations). Do not put unbounded content in the prompt path.
- **Verify**: `wasurezu-codex-start --doctor` records local Codex CLI compatibility without launching.

## 8. Recovery output is empty or shows someone else's work

- **Symptom**: `recover_context` / `restart_pack` returns "No in-progress tasks." or unfamiliar content.
- **Cause**: agent isolation — records are partitioned by `agent_id` (and filtered by `project`). A mismatched `AGENT_MEMORY_AGENT_ID` or project filter reads a different namespace.
- **Fix**: align `AGENT_MEMORY_AGENT_ID` / `AGENT_MEMORY_PROJECT` (or config.json `agent_id` / `default_project`) with the identity that wrote the records.
- **Verify**: `search_memory` with the expected agent's env returns the expected records; cross-agent isolation is regression-tested (`tests/gate0/search-memory-regression.ts`).

## 9. "429 Too Many Requests" noise in test output

- **Symptom**: Voyage embedding 429 warnings interleaved in test runs.
- **Cause**: optional embedding enrichment hitting rate limits; non-fatal by design.
- **Fix**: ignore for test purposes, or unset the embedding API key to silence.
- **Verify**: test summary line still reports `0 failed`.

---

If a failure mode is not listed here, check `docs/operations/` for the
subsystem doc (DEPLOYMENT, HOST_ADAPTERS, CODEX_RECOVERY_CONTROL,
RECOVERY_EVALUATION) before filing an issue, and never paste raw secrets
or transcripts into issues (see `SECURITY.md`).
