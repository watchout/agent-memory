# 依存 — Kusabi（agent-memory）

版の一覧は technology-stack.md が持ち主。ここでは「何が何に頼っているか」だけを書く。

## 1. 外の package

- 本番の直接の依存 7 つ: `@modelcontextprotocol/sdk`、`ajv`、`ajv-formats`、`pg`、`sql.js`、`uuid`、`zod`。すべて版を固定（範囲の記号なし）。
- 開発の依存 6 つ: `@types/node`・`@types/pg`・`@types/sql.js`・`@types/uuid`・`tsx`・`typescript`（範囲の記号つき）。
- lockfile の中身: 147 件（本番 109・開発 38）。
- source が import する外の package は上の 7 つと Node の標準の module（`node:crypto`・`node:fs`・`node:path`・`node:child_process` など）だけ。

## 2. 外のサービスと道具

| 相手 | 使う所 | 注意 |
|---|---|---|
| Voyage AI の埋め込みの API | src/stores/voyage.ts（PostgreSQL の時、決定・作業・知識の文を送る） | 鍵がある時だけ送る。`AGENT_MEMORY_DISABLE_EMBEDDINGS=1` で止まる。project.md の Forbidden（記憶の中身を外の API に送らない）と食い違うので、止めた状態を保つ必要がある |
| 席の CLI（`claude`・`codex`・`gemini`・Antigravity） | launcher が起動し、hook が呼ばれる | `codex mcp get --json` で MCP の束縛を読み戻す |
| 手元の transcript の置き場 | `~/.claude/projects`・`~/.codex/sessions`・Gemini の chats・Antigravity の brain | 取り込みの元 |
| tmux | scripts/host-adapters/ | Codex の会話に `/exit` を送る |
| git | src/codex-start.ts（`git rev-parse HEAD`） | 社内の 1 席の身元の確かめ |
| PostgreSQL | src/stores/pg-store.ts | 接続できなければ止まる（SQLite に逃げない） |

## 3. 中の依存（会話の切り直しに関わる所）

- `src/index.ts` → recovery-context、restart-pack、restart-prepare、claude-conversation-ingest、codex-conversation-ingest、catch-up、recovery-quality、memory-source、raw-capture-coverage、constants、sanitize、redact、stores
- `src/boot.ts` → recovery-context、restart-pack、kusabi-checkpoint-recovery、constants、ensure-tags、redact、stores
- `src/claude-session-start.ts` → codex-session-start（処理を借りる）、session-start-auto-receive、restart-pack、kusabi-runtime-event-emitter、redact、stores
- `src/codex-session-start.ts` → session-start-auto-receive、restart-pack、kusabi-runtime-event-emitter、constants、redact、stores
- `src/transcript-stop-capture.ts` → codex-session-start（引数の読み取りと定数）、session-start-auto-receive、redact、stores
- `src/session-start-auto-receive.ts` → claude・codex・gemini・antigravity の conversation-ingest
- `src/restart-prepare.ts` → restart-pack、kusabi-checkpoint-recovery、continuity-analysis、raw-capture-coverage、constants
- `src/restart-pack.ts` → recovery-context、constants、continuity-analysis、artifact-schema-validator、redact
- `src/claude-start.ts` → restart-prepare、claude-session-start（定数）、constants、redact、stores
- `src/codex-start.ts` → restart-pack、kusabi-runtime-identity、constants、redact、stores
- `src/claude-marker-controller.ts` → claude-start、restart-command-preflight
- `src/restart-cli.ts` → restart-prepare、restart-command-preflight、redact、stores
- `src/claude-hook-installer.ts`・`src/codex-hook-installer.ts` → 各 session-start の定数、transcript-stop-capture の定数
- `src/context-window-resolution.ts`・`src/codex-context-measurement.ts` → 依存なし。呼び手は src/test.ts だけ

輪になった import は、読んだ範囲では見つけていない（claude-start → claude-session-start は定数だけで、逆向きの import は無い）。

## 4. 席の CLI の設定との依存

- Claude Code: `<workspace>/.claude/settings.json` の `hooks.SessionStart`・`hooks.Stop`・`hooks.UserPromptSubmit`。この作業場では AI-DLC も同じ file に hook を置くので、Kusabi の installer は自分の handler だけを差し替える形に頼っている。
- Codex: `<workspace>/.codex/hooks.json`。Codex の hooks の画面で人が信頼する必要がある。
- launcher の既定の path（`~/Developer/agent-memory/dist/…`）は、この AI-DLC の作業場とは別の checkout を指す。
