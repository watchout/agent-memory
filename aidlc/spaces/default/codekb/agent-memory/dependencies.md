# 依存 — Kusabi（agent-memory）

版の一覧は technology-stack.md が持ち主。ここでは「何が何に頼っているか」だけを書く。「前回の読み」と付けた文は 2026-11-10 の読みのままで、2026-11-15 の取り組み 261113-store-resolution-fix では確かめていない。今回書き直したのは「3. 中の依存」の store を開く行と、新しい「5. 保存先を決める部品の呼び出し元」。

## 1. 外の package

- 本番の直接の依存 7 つ: `@modelcontextprotocol/sdk`、`ajv`、`ajv-formats`、`pg`、`sql.js`、`uuid`、`zod`。すべて版を固定（範囲の記号なし）。今回 `package.json` で再確認した（版は technology-stack.md）。
- 開発の依存 6 つ: `@types/node`・`@types/pg`・`@types/sql.js`・`@types/uuid`・`tsx`・`typescript`（範囲の記号つき）。今回 `package.json` で再確認した。
- lockfile の中身: 147 件（本番 109・開発 38。前回の読み。lockfile は今回開いていない）。
- source が import する外の package は上の 7 つと Node の標準の module（`node:crypto`・`node:fs`・`node:path`・`node:child_process` など）だけ（前回の読み）。

## 2. 外のサービスと道具

| 相手 | 使う所 | 注意 |
|---|---|---|
| Voyage AI の埋め込みの API | src/stores/voyage.ts（PostgreSQL の時、決定・作業・知識の文を送る） | 鍵がある時だけ送る。`AGENT_MEMORY_DISABLE_EMBEDDINGS=1` で止まる。project.md の Forbidden（記憶の中身を外の API に送らない）と食い違うので、止めた状態を保つ必要がある（前回の読み） |
| 席の CLI（`claude`・`codex`・`gemini`・Antigravity） | launcher が起動し、hook が呼ばれる | `codex mcp get --json` で MCP の束縛を読み戻す（前回の読み） |
| 手元の transcript の置き場 | `~/.claude/projects`・`~/.codex/sessions`・Gemini の chats・Antigravity の brain | 取り込みの元（前回の読み） |
| tmux | scripts/host-adapters/ | Codex の会話に `/exit` を送る（前回の読み） |
| git | src/codex-start.ts（`git rev-parse HEAD`） | 社内の 1 席の身元の確かめ（前回の読み） |
| PostgreSQL | src/stores/pg-store.ts | 接続できなければ止まる（SQLite に逃げない。`src/stores/index.ts:75-80`、今回読んだ事実）。CI は PostgreSQL を使う試験を回さない |
| 手元の設定 file `~/.agent-memory/config.json` | 4 つの SessionStart（`resolveCodexStoreBinding`）と `post-tool-hook` | 読む項目の名前は api-documentation.md の 6。Stop の 2 つの hook・MCP サーバー・boot・launcher は読まない（今回読んだ事実） |

## 3. 中の依存（会話の切り直しに関わる所）

前回の読みのまま残した行と、今回確かめた行（「今回」と付けた）がある。

- `src/index.ts` → recovery-context、restart-pack、restart-prepare、claude-conversation-ingest、codex-conversation-ingest、catch-up、recovery-quality、memory-source、raw-capture-coverage、constants、sanitize、redact、stores（前回の読み。今回 `createStore` の 1 行を確認）
- `src/boot.ts` → recovery-context、restart-pack、kusabi-checkpoint-recovery、constants、ensure-tags、redact、stores（前回の読み。今回 `createStore` の 1 行を確認）
- `src/claude-session-start.ts` → codex-session-start（処理を借りる。今回、`resolveCodexStoreBinding` もここから借りることを確認）、session-start-auto-receive、restart-pack、kusabi-runtime-event-emitter、rotation-commit（今回）、redact、stores
- `src/codex-session-start.ts` → session-start-auto-receive、restart-pack、kusabi-runtime-event-emitter、rotation-commit（今回）、constants、redact、stores
- `src/transcript-stop-capture.ts` → codex-session-start（引数の読み取りと定数。`resolveCodexStoreBinding` は借りない、今回）、session-start-auto-receive、redact、stores
- `src/session-rotation-stop.ts` → codex-session-start（`CODEX_SESSION_START_INTERNAL_TIMEOUT_MS` と束縛の型だけ。今回）、claude-conversation-ingest、codex-conversation-ingest、claude-transcript-identity、session-start-auto-receive、session-rotation-files、session-rotation-usage、hook-input-diagnostics、process-uid、constants、redact、stores（今回。冒頭 60 行の import の宣言から読んだ。それ以降の import は読んでいない）
- `src/rotation-commit.ts` → session-rotation-files、session-rotation-start（型）、constants、stores（今回）
- `src/kusabi-runtime-event-emitter.ts` → `SqliteStore`・`PgStore`（`createStore` は借りない）、SessionStart の証拠の型（今回）
- `src/post-tool-hook.ts` → stores（`createStore`）。config の読み込みは自前（今回）
- `src/session-start-auto-receive.ts` → claude・codex・gemini・antigravity の conversation-ingest（前回の読み）
- `src/restart-prepare.ts` → restart-pack、kusabi-checkpoint-recovery、continuity-analysis、raw-capture-coverage、constants（前回の読み）
- `src/restart-pack.ts` → recovery-context、constants、continuity-analysis、artifact-schema-validator、redact（前回の読み）
- `src/claude-start.ts` → restart-prepare、claude-session-start（定数）、constants、redact、stores（前回の読み。今回 `createStore()` の 1 行を確認）
- `src/codex-start.ts` → restart-pack、kusabi-runtime-identity、constants、redact、stores（前回の読み。今回 `createStore()` の 1 行を確認）
- `src/claude-marker-controller.ts` → claude-start、restart-command-preflight（前回の読み）
- `src/restart-cli.ts` → restart-prepare、restart-command-preflight、redact、stores（前回の読み。今回 `createStore()` と読み取り専用の読み手の 2 行を確認）
- `src/stores/read-only-task-states.ts` → `resolveStoreBackend`（`src/stores/index.ts`）、`resolveSqliteDbPath`（`src/stores/sqlite-store.ts`）、json-store の定数、task-state-normalize（今回）
- `src/claude-hook-installer.ts`・`src/codex-hook-installer.ts` → 各 session-start の定数、transcript-stop-capture の定数、rotation-hook-registration（今回。2 つの installer が `buildRotationHookGroup` を呼ぶ）、session-rotation-stop（Claude Code の installer が `CLAUDE_ROTATION_STOP_ADAPTER_ID` を借りる）
- `src/context-window-resolution.ts`・`src/codex-context-measurement.ts` → 依存なし（前回の読み。呼び手は src/test.ts だけだった。今の呼び手は今回確かめていない）

輪になった import は、読んだ範囲では見つけていない（前回の読み。claude-start → claude-session-start は定数だけで、逆向きの import は無い）。`src/session-rotation-stop.ts` が `src/codex-session-start.ts` から借りるのは定数と型で、`resolveCodexStoreBinding` ではない（今回）。

## 4. 席の CLI の設定との依存

- Claude Code: `<workspace>/.claude/settings.json` の `hooks.SessionStart`・`hooks.Stop`・`hooks.UserPromptSubmit`。この作業場では AI-DLC も同じ file に hook を置くので、Kusabi の installer は自分の handler だけを差し替える形に頼っている（前回の読み）。
- Codex: `<workspace>/.codex/hooks.json`。Codex の hooks の画面で人が信頼する必要がある（前回の読み）。
- launcher の既定の path（`~/Developer/agent-memory/dist/…`）は、この AI-DLC の作業場とは別の checkout を指す（前回の読み）。
- 席が起動する時の環境変数（保存先を決める `AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL` など）は、席の CLI を起こす側（tmux・launcher）に頼る。hook の command にも、2 つの installer が書く設定 file にも、それらは入らない（api-documentation.md の 3）。起こす側が実際に渡すかどうかは今回確かめていない。

## 5. 保存先を決める部品の呼び出し元（今回読んだ事実）

保存を開く呼び出しの全部（16 行）。決める部品ごとの入力・順番・失敗の時の動きは api-documentation.md「8. 保存先の決め方」。行は origin/main `27d7f8fc` と byte が同じ file（今回の範囲の 43 本）の行。

| # | 呼び出し元（file:行） | いつ動くか | 決める部品 | 渡す入力 | config.json を読むか | `skipPostgresMigrations` |
|---|---|---|---|---|---|---|
| 1 | `src/claude-session-start.ts:317-318` | Claude Code の SessionStart | `resolveCodexStoreBinding()` → `createStore` | env ＋ config（env への書き込みで URL が `createStore` に届く） | 読む | true |
| 2 | `src/codex-session-start.ts:832-833` | Codex の SessionStart | 同上 | 同上 | 読む | true |
| 3 | `src/gemini-session-start.ts:502-503` | Gemini の SessionStart | 同上 | 同上 | 読む | true |
| 4 | `src/antigravity-session-start.ts:213-214` | Antigravity の呼び出し前 | 同上 | 同上 | 読む | true |
| 5 | `src/transcript-stop-capture.ts:225` | Claude Code・Codex の Stop と UserPromptSubmit | `createStore` だけ | env のみ | 読まない | true |
| 6 | `src/session-rotation-stop.ts:546`（`withStore`） | Claude Code・Codex の Stop と UserPromptSubmit（保存すると決めた時だけ開く） | `createStore` だけ | env のみ | 読まない | true |
| 7 | `src/rotation-commit.ts:43`（`openDefaultStore`、62 の `consumeWithin` が使う） | Claude Code・Codex の SessionStart の process の中、回答を書いた後（`src/codex-session-start.ts:1085、1091`、`src/claude-session-start.ts:566`） | `createStore` だけ | env のみ。ただし同じ process なので 1・2 が書き換えた env を受ける | 読まない（間接に 1・2 の結果を受ける） | true |
| 8 | `src/kusabi-runtime-event-emitter.ts:514-546`（`createQuietStore`、worker の入口 617） | 4 つの SessionStart の後（emission、500 ms） | 自前の `createQuietStore`（3 つ目の写し） | env のみ（子は親の `process.env` を受ける） | 読まない | 流さない（`run_migrations: false`） |
| 9 | `src/post-tool-hook.ts:275、296` | Claude Code の PostToolUse（2 つの installer は登録しない。grep で 0 件） | 自前の config 読み ＋ `createStore` | env ＋ config の `database_url`（`DATABASE_URL` にだけ入れる） | 読む（`database_url`・`agent_id`・`default_project`） | true |
| 10 | `src/boot.ts:41` | 旧来の SessionStart（`npm run boot`、launcher が `--settings` で付ける） | `createStore` だけ | env のみ | 読まない | true |
| 11 | `src/index.ts:53` | MCP サーバーの起動（接続の後に開く、readiness） | `createStore` だけ | env のみ | 読まない | true |
| 12 | `src/claude-start.ts:379` | `wasurezu-claude-start`（launcher） | `createStore()` | env のみ | 読まない | 渡さない（流す） |
| 13 | `src/codex-start.ts:261` | `wasurezu-codex-start`（launcher） | `createStore()` | env のみ | 読まない | 渡さない（流す） |
| 14 | `src/restart-cli.ts:291` | `wasurezu-restart` の prepare・fetch | `createStore()` | env のみ | 読まない | 渡さない（流す） |
| 15 | `src/restart-cli.ts:249` | `wasurezu-restart` の handoff-source | `createReadOnlyTaskStateReader()` → `resolveStoreBackend(process.env)` | env のみ | 読まない | 該当しない（store を開かない。PG は READ ONLY の 1 回） |
| 16 | `src/kusabi-fleet-status-cli.ts:54` | `wasurezu-kusabi-fleet-status` | `createStore()` | env のみ | 読まない | 渡さない（流す） |

- 範囲の外で grep に出た構築: `src/measure-kusabi-functional.ts:297-299`（試験用の一時の 3 種の store）、`src/fleet-conversation-backfill.ts:264`（`new PgStore(options.database_url)`、引数で受ける URL）、`src/kusabi-continuity-interruption-e2e.ts:366-368`（設定で選ぶ 3 種）。`createStore`・`resolveStoreBackend`・`resolveCodexStoreBinding` を呼ばない。
- 「渡さない（流す）」は `createStore()` に option を渡さない呼び出しで、PostgreSQL の時に `PG_MIGRATIONS` の全部を流す（`src/stores/pg-store.ts:80-84`）。
- 4 つの SessionStart（1〜4）だけが `resolveCodexStoreBinding` を呼ぶ。`src/` でこの関数を参照するのは 4 つの SessionStart の file だけ（grep）。
- Codex の Stop 側の 2 つの command（5・6）も Claude Code と同じ host 共通の入口を呼ぶので、Claude Code と同じ形。Codex の installer の組み立ては `src/codex-hook-installer.ts:273`（transcript）と `:428-429`（回転）。
