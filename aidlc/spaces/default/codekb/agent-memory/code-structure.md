# コードの構成 — Kusabi（agent-memory）

## 構成の全体

単一のパッケージ（wasurezu）。TypeScript（ESM）で書き、`tsc` で `src/` を `dist/` に出す（tsconfig.json）。

```text
src/                プログラム（平らに並ぶ。保存の層だけ src/stores/ に分かれる）
src/stores/         保存の層（差し替えの口と SQLite・PostgreSQL・JSON の実装）
src/test*.ts        試験のスクリプト（ビルドから外す）
tests/gate0/        門の試験（3 ファイル）
tests/spec-enforcement/  仕様の守りの試験（1 ファイル）
docs/design/core/   設計の正本（SSOT-2〜7）
scripts/・templates/  展開と雛形
```

## ファイルの分け方

部品の名前は component-inventory.md の見出しと同じ。

| 部品 | 主なファイル |
|------|-------------|
| MCP サーバー | src/index.ts、src/constants.ts |
| 保存の層 | src/stores/types.ts・index.ts・pg-store.ts・sqlite-store.ts・json-store.ts・pg-migrations.ts・knowledge-scope.ts・task-id.ts・raw-events.ts、src/migrate.ts |
| 意味検索 | src/stores/voyage.ts |
| 回復 | src/recovery-context.ts、src/recovery-quality.ts、src/restart-pack.ts、src/restart-prepare.ts、src/restart-cli.ts、src/restart-command-preflight.ts、src/kusabi-checkpoint-recovery.ts |
| 起動の口 | src/boot.ts、src/claude-session-start.ts、src/codex-session-start.ts、src/gemini-session-start.ts、src/antigravity-session-start.ts、src/claude-start.ts、src/codex-start.ts、src/session-start-auto-receive.ts、src/post-tool-hook.ts、各 *-hook-installer.ts |
| 会話の取り込み | src/claude-conversation-ingest.ts、src/codex-conversation-ingest.ts、src/gemini-conversation-ingest.ts、src/antigravity-conversation-ingest.ts、src/catch-up.ts、src/raw-capture-service.ts、src/transcript-stop-capture.ts、src/fleet-conversation-backfill.ts |
| 秘匿処理 | src/redact.ts、src/sanitize.ts |
| 記録の読み出し | src/memory-source.ts |
| 区画の登録 | src/kusabi-partitions.ts |
| 席の実行の身元 | src/kusabi-runtime-identity.ts、src/kusabi-runtime-event-emitter.ts、src/kusabi-runtime-event-store.ts |
| 運用の観測と展開 | src/kusabi-fleet-rollout.ts、src/kusabi-direct-fleet-rollout.ts、src/kusabi-fleet-status.ts、src/kusabi-fleet-status-cli.ts、src/kusabi-one-seat-canary.ts、src/kusabi-fresh-session-fleet.ts、src/continuity-*.ts、src/kusabi-functional-evaluator.ts、src/measure-kusabi-functional.ts、src/raw-capture-coverage.ts、src/company-dev-os-recovery-target-audit.ts など |

## コードの型

- **差し替えの口**: 保存は Store の interface（src/stores/types.ts 499 行目）だけを通す。呼び手は実装を知らない。選ぶのは `createStore`（src/stores/index.ts）
- **道具ごとの入力の検証**: 各道具の引数を zod の形で書き、MCP SDK の `server.tool` に渡す（src/index.ts）
- **身元は process の環境から**: agent_id と project は process の起動の時に環境変数から一度だけ決め、道具の処理はそれを付けて保存の層に渡す
- **失敗は文で返す**: 道具の処理は try/catch で包み、失敗は `isError: true` の応答で返す
- **DB の作りの変更**: 文字列の SQL の並びを毎回の起動で流す。どれも `IF NOT EXISTS` の形（src/stores/pg-migrations.ts）
- **呼び出しの記録**: 道具が呼ばれるたびに `~/.agent-memory/calls.log` に 1 行書く（src/index.ts）

## 大きさ

このリポジトリの決まり（1 ファイル最大 800 行）を超えるファイルが 7 つある。一覧は code-quality-assessment.md の「技術的な負債」を参照。
