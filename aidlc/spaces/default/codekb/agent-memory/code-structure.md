# コードの置き場と形 — Kusabi（agent-memory）

ファイルの置き場と種類の一覧はここが持ち主。部品ごとの受け持ちは component-inventory.md を参照。「前回の読み」と付けた文は 2026-11-10 の読み（commit a4a4d1e）のままで、2026-11-15 の取り組み 261113-store-resolution-fix では確かめていない。今回書き直したのは `src/` 直下と `src/stores/` の数・一覧、種類ごとの分け方の入口の行、「繰り返し出てくる形」の末尾 2 項目。

## 置き場（git が追う物だけ。AI-DLC の install と build の出力は除く）

| 置き場 | 数 | 中身 |
|---|---|---|
| `src/` 直下 | 試験でない `.ts` が 83・試験（`src/test*`）が 56 | 機能ごとの module が平らに並ぶ。名前の頭で機能が分かる（`claude-*`・`codex-*`・`gemini-*`・`antigravity-*`・`kusabi-*`・`restart-*`・`recovery-*`・`rotation-*`・`session-rotation-*`）。数は origin/main `27d7f8fc` の `git ls-tree` で直下を数えた値で、前回の 58・39 とは数え方が同じか確かめていない。増えた理由は今回調べていない |
| `src/stores/` | 12 | Store の interface（`types.ts`）、選び方（`index.ts`）、実装 3 つ（`pg-store.ts`・`sqlite-store.ts`・`json-store.ts`）、PostgreSQL の表の変更（`pg-migrations.ts`）、埋め込み（`voyage.ts`）、補助（`knowledge-scope.ts`・`raw-events.ts`・`task-id.ts`）、読み取り専用の読み手（`read-only-task-states.ts`）、行の整理（`task-state-normalize.ts`）。前回の 10 は古い |
| `tests/` | 4 | `gate0/`（秘密を回復に出さない・表の変更の冪等・search_memory の回帰）、`spec-enforcement/`（AM-027 の回帰）（前回の読み） |
| `scripts/` | 16 | shell と mjs の運用の道具。`host-adapters/`（Codex の tmux と launcher の 4 本）、`codex-memory-start.sh`、`install-hook.sh`、`post-tool-hook.sh`、公開の版づくり（`build-kusabi-content-addressed-runtime-release.mjs`）ほか（前回の読み） |
| `templates/` | 4 | `CLAUDE.md.template`、hook と設定の例、`memory-tags.md`（前回の読み） |
| `docs/` | 106 | `design/core/SSOT-2〜7`（設計の正本）、`design/schemas/`（JSON Schema）、`operations/`（運用の手順と設計）、`v2/`（次の版の設計）、`requirements/`・`standards/`・`strategy/`（前回の読み） |
| `.shirube/` | 55 | 社内の門（Shirube）の設定・作業の引き渡し（`control-handoffs/`）・門の道具（`runtime/rapid-lite/`）（前回の読み） |
| `.framework/` | 5 | 以前の開発の枠組み（ADF）の状態の JSON（前回の読み） |
| `.github/` | 6 | CI（`workflows/ci.yml`）、Shirube の門の報告（`workflows/shirube-rapid-lite-gates-report.yml`）、issue と PR の雛形（前回の読み。2 つの workflow は今回も存在を確認） |
| 直下 | — | `package.json`・`package-lock.json`・`tsconfig.json`・`docker-compose.yml`・`.env.example`・`AGENTS.md`・`CLAUDE.md`・`README.md` ほか |

行の数: 試験でない source は 34,945 行、`src/` の試験は 20,076 行（前回の読み。今回は数え直していない）。

## 種類ごとの分け方（`src/` の試験でない物）

| 種類 | ファイル |
|---|---|
| 入口（CLI・MCP・hook） | `index.ts`、`boot.ts`、`claude-session-start.ts`、`codex-session-start.ts`、`gemini-session-start.ts`、`antigravity-session-start.ts`、`transcript-stop-capture.ts`、`session-rotation-stop.ts`（Stop・UserPromptSubmit の回転の入口、`bin` に無い）、`claude-start.ts`、`codex-start.ts`、`restart-cli.ts`、`*-hook-installer.ts`（4）、`post-tool-hook.ts`（`bin` に無い）、`migrate.ts`、`fleet-conversation-backfill.ts`、`kusabi-fleet-status-cli.ts`、`kusabi-direct-fleet-rollout.ts`、`continuity-alpha-canary.ts`、`kusabi-fresh-session-fleet.ts`、`measure-kusabi-functional.ts`、`company-dev-os-recovery-target-audit.ts` |
| 処理（回復・取り込み・準備・回転の確定） | `recovery-context.ts`、`restart-pack.ts`、`restart-prepare.ts`、`recovery-quality.ts`、`session-start-auto-receive.ts`、`*-conversation-ingest.ts`（4）、`catch-up.ts`、`raw-capture-service.ts`、`kusabi-checkpoint-recovery.ts`、`memory-source.ts`、`kusabi-partitions.ts`、`rotation-commit.ts`、`rotation-hook-registration.ts`（2 つの installer が使う hook の組の作り方）、運用系（`kusabi-fleet-*`・`kusabi-one-seat-canary.ts`・`continuity-alpha-*`・`kusabi-functional-evaluator.ts`・`kusabi-continuity-interruption-e2e.ts`・`kusabi-direct-db-gate.ts`・`kusabi-runtime-*`） |
| 保存（Repository） | `stores/*`（12。保存先を決める部品の置き場は component-inventory.md の「保存先の決め方」） |
| 判定・補助（純粋な関数が中心） | `context-window-resolution.ts`、`codex-context-measurement.ts`、`claude-marker-controller.ts`、`restart-command-preflight.ts`、`continuity-analysis.ts`、`constants.ts`、`redact.ts`、`sanitize.ts`、`artifact-schema-validator.ts`、`raw-capture-coverage.ts`、`ensure-tags.ts` |
| 回転の補助（名前だけ。開いていない） | `session-rotation-files.ts`、`session-rotation-start.ts`、`session-rotation-usage.ts`、`claude-transcript-identity.ts`、`hook-input-diagnostics.ts`、`process-uid.ts` |
| 表の変更 | `stores/pg-migrations.ts`（`migrate.ts` から流す。起動の時にも流す、ただし hook・MCP は `skipPostgresMigrations` で流さない） |
| 試験 | `src/test*.ts`、`tests/**`（4）。数は上の表 |

上の表で「前回の読み」と書いていない行も、今回は名前を確かめただけの file が多い。回転の補助の 6 つは `src/session-rotation-stop.ts`・`src/rotation-commit.ts` の import の宣言に名前が出た物で、中身は読んでいない。

## 繰り返し出てくる形

- 入口の見分け: 各 CLI の file は関数を export し、`realpath(process.argv[1])` が自分と同じ時だけ `main()` を動かす。試験は同じ file の関数を import して呼ぶ（前回の読み。`src/session-rotation-stop.ts` も先頭で `realpathSync` と `fileURLToPath` を import しており、同じ形と読めるが、入口の判定の行そのものは確かめていない）。
- 試験のための差し替え: `dependencies` 引数で `now`・`loadRecovery`・`createStore`・`receive` などを差し替える（例: src/codex-session-start.ts `runCodexSessionStart`、src/transcript-stop-capture.ts `runTranscriptStopCapture`）。`src/rotation-commit.ts` は `CommitSeams` で `open_store`・`write_record` を差し替える（今回読んだ事実）。
- 出力の分け方: host に返す JSON は stdout、証拠の JSON（`*-evidence/v1`）は stderr（前回の読み）。
- fail-open: 失敗は型の付いた理由（`MALFORMED_HOOK_INPUT`・`RECOVERY_TIMEOUT` など）で返し、席の起動は続ける（前回の読み）。
- 束縛の値は引数で渡す: hook の command に `--agent-id`・`--project`・`--workspace`・`--binding-source-ref` を書き込み、環境からの推測をしない（前回の読み）。保存先は引数で渡さず、呼ばれた process が環境（と一部は設定 file）から決める（今回読んだ事実。api-documentation.md の 3 と 8）。
- 上限の明記: 入力 64 KiB、回復の文 1,800 token・8,192 byte、内部の期限 7 秒、transcript 8 MiB（起動時）・末尾 4 MiB（Stop）（前回の読み）。
- Codex の口を土台に、Claude Code・Gemini・Antigravity の口が型と関数を借りる（src/claude-session-start.ts は入力を Codex の形に直して `runCodexSessionStart` を呼ぶ。前回の読み）。保存先を決める `resolveCodexStoreBinding` も Codex の file に置かれ、4 つの SessionStart がそれを借りる（今回読んだ事実）。
- 決める部品の写し: 同じ種類の判断（保存先）を、入口ごとに自前で持つ形が複数ある（`createQuietStore`・`post-tool-hook` の config の読み込み。component-inventory.md の「保存先の決め方」）。
- 時刻を引数で受ける核: `src/rotation-commit.ts`・`src/session-rotation-stop.ts` は `now` を呼び手が渡す（標準 S4、今回読んだ事実）。
