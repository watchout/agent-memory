# コードの置き場と形 — Kusabi（agent-memory）

ファイルの置き場と種類の一覧はここが持ち主。部品ごとの受け持ちは component-inventory.md を参照。

## 置き場（git が追う物だけ。AI-DLC の install と build の出力は除く）

| 置き場 | 数 | 中身 |
|---|---|---|
| `src/` 直下 | 試験でない 58・試験 39 | 機能ごとの module が平らに並ぶ。名前の頭で機能が分かる（`claude-*`・`codex-*`・`gemini-*`・`antigravity-*`・`kusabi-*`・`restart-*`・`recovery-*`） |
| `src/stores/` | 10 | Store の interface（`types.ts`）、選び方（`index.ts`）、実装 3 つ（`pg-store.ts`・`sqlite-store.ts`・`json-store.ts`）、PostgreSQL の表の変更（`pg-migrations.ts`）、埋め込み（`voyage.ts`）、補助（`knowledge-scope.ts`・`raw-events.ts`・`task-id.ts`） |
| `tests/` | 4 | `gate0/`（秘密を回復に出さない・表の変更の冪等・search_memory の回帰）、`spec-enforcement/`（AM-027 の回帰） |
| `scripts/` | 16 | shell と mjs の運用の道具。`host-adapters/`（Codex の tmux と launcher の 4 本）、`codex-memory-start.sh`、`install-hook.sh`、`post-tool-hook.sh`、公開の版づくり（`build-kusabi-content-addressed-runtime-release.mjs`）ほか |
| `templates/` | 4 | `CLAUDE.md.template`、hook と設定の例、`memory-tags.md` |
| `docs/` | 106 | `design/core/SSOT-2〜7`（設計の正本）、`design/schemas/`（JSON Schema）、`operations/`（運用の手順と設計）、`v2/`（次の版の設計）、`requirements/`・`standards/`・`strategy/` |
| `.shirube/` | 55 | 社内の門（Shirube）の設定・作業の引き渡し（`control-handoffs/`）・門の道具（`runtime/rapid-lite/`） |
| `.framework/` | 5 | 以前の開発の枠組み（ADF）の状態の JSON |
| `.github/` | 6 | CI（`workflows/ci.yml`）、Shirube の門の報告（`workflows/shirube-rapid-lite-gates-report.yml`）、issue と PR の雛形 |
| 直下 | — | `package.json`・`package-lock.json`・`tsconfig.json`・`docker-compose.yml`・`.env.example`・`AGENTS.md`・`CLAUDE.md`・`README.md` ほか |

行の数: 試験でない source は 34,945 行、`src/` の試験は 20,076 行。

## 種類ごとの分け方（`src/` の試験でない物）

| 種類 | ファイル |
|---|---|
| 入口（CLI・MCP・hook） | `index.ts`、`boot.ts`、`claude-session-start.ts`、`codex-session-start.ts`、`gemini-session-start.ts`、`antigravity-session-start.ts`、`transcript-stop-capture.ts`、`claude-start.ts`、`codex-start.ts`、`restart-cli.ts`、`*-hook-installer.ts`（4）、`post-tool-hook.ts`、`migrate.ts`、`fleet-conversation-backfill.ts`、`kusabi-fleet-status-cli.ts`、`kusabi-direct-fleet-rollout.ts`、`continuity-alpha-canary.ts`、`kusabi-fresh-session-fleet.ts`、`measure-kusabi-functional.ts`、`company-dev-os-recovery-target-audit.ts` |
| 処理（回復・取り込み・準備） | `recovery-context.ts`、`restart-pack.ts`、`restart-prepare.ts`、`recovery-quality.ts`、`session-start-auto-receive.ts`、`*-conversation-ingest.ts`（4）、`catch-up.ts`、`raw-capture-service.ts`、`kusabi-checkpoint-recovery.ts`、`memory-source.ts`、`kusabi-partitions.ts`、運用系（`kusabi-fleet-*`・`kusabi-one-seat-canary.ts`・`continuity-alpha-*`・`kusabi-functional-evaluator.ts`・`kusabi-continuity-interruption-e2e.ts`・`kusabi-direct-db-gate.ts`・`kusabi-runtime-*`） |
| 保存（Repository） | `stores/*` |
| 判定・補助（純粋な関数が中心） | `context-window-resolution.ts`、`codex-context-measurement.ts`、`claude-marker-controller.ts`、`restart-command-preflight.ts`、`continuity-analysis.ts`、`constants.ts`、`redact.ts`、`sanitize.ts`、`artifact-schema-validator.ts`、`raw-capture-coverage.ts`、`ensure-tags.ts` |
| 表の変更 | `stores/pg-migrations.ts`（`migrate.ts` から流す。起動の時にも流す） |
| 試験 | `src/test*.ts`（39）、`tests/**`（4） |

## 繰り返し出てくる形

- 入口の見分け: 各 CLI の file は関数を export し、`realpath(process.argv[1])` が自分と同じ時だけ `main()` を動かす。試験は同じ file の関数を import して呼ぶ。
- 試験のための差し替え: `dependencies` 引数で `now`・`loadRecovery`・`createStore`・`receive` などを差し替える（例: src/codex-session-start.ts `runCodexSessionStart`、src/transcript-stop-capture.ts `runTranscriptStopCapture`）。
- 出力の分け方: host に返す JSON は stdout、証拠の JSON（`*-evidence/v1`）は stderr。
- fail-open: 失敗は型の付いた理由（`MALFORMED_HOOK_INPUT`・`RECOVERY_TIMEOUT` など）で返し、席の起動は続ける。
- 束縛の値は引数で渡す: hook の command に `--agent-id`・`--project`・`--workspace`・`--binding-source-ref` を書き込み、環境からの推測をしない。
- 上限の明記: 入力 64 KiB、回復の文 1,800 token・8,192 byte、内部の期限 7 秒、transcript 8 MiB（起動時）・末尾 4 MiB（Stop）。
- Codex の口を土台に、Claude Code・Gemini・Antigravity の口が型と関数を借りる（src/claude-session-start.ts は入力を Codex の形に直して `runCodexSessionStart` を呼ぶ）。
