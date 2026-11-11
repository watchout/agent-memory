# 部品の一覧 — Kusabi（agent-memory）

部品の受け持ちと依存はここが持ち主。ファイルの置き場は code-structure.md、口の形は api-documentation.md を参照。各見出しの「読み」は今回の読み方: 深く読んだ部品だけが reverse-engineering-timestamp.md の範囲の記録（`analyzed.components`）に入る。

## MCP サーバー

- 読み: 深く読んだ
- 受け持ち: 17 個の道具を stdio で出す。process の環境変数から `agent_id`・`project`・`session_id` を決める。呼び出しを `~/.agent-memory/calls.log` に書く。`recover_context` の後、10 分以内に書く道具が呼ばれたら「続けた」と `recovery_quality_log` に印を付ける（`RecoveryContinuationTracker`）。
- 主なファイル: src/index.ts、src/recovery-quality.ts
- 依存: 回復の文と束、再起動の準備と判定、会話の記録の取り込み（Claude Code・Codex）、保存の層、MCP SDK、zod

## 起動時の回復の口（Claude Code・Codex）

- 読み: 深く読んだ
- 受け持ち: 各 CLI の SessionStart（`startup`・`resume`・`clear`・`compact`）で呼ばれ、入力と workspace を確かめ、その会話の transcript を取り込み、DB から回復の束を作って `additionalContext` で返す。上限は 1,800 token・8,192 byte・内部 7 秒。失敗しても起動は続ける。Claude Code の口は入力を Codex の形に直して Codex の口の処理を使う。旧来の src/boot.ts は環境変数 `AGENT_MEMORY_BOOT_MODE=restart_pack` の時だけ、準備した束を consume する。boot.ts は 7 日より古い進行中の作業を期限切れにし、`~/.claude/rules/` に印の説明を置く。
- 主なファイル: src/claude-session-start.ts、src/codex-session-start.ts、src/boot.ts
- 依存: 会話の記録の取り込み（Claude Code・Codex）、回復の文と束、保存の層、席の実行の身元（証拠の出来事）

## 起動時の回復の口（Gemini・Antigravity）

- 読み: 浅く見た（冒頭と定数だけ）
- 受け持ち: Gemini CLI（`startup`・`resume`・`clear`）と Antigravity CLI（Pre/PostInvocation）の同じ働き。Codex の口の型と関数を借りる。
- 主なファイル: src/gemini-session-start.ts、src/antigravity-session-start.ts

## 会話の記録の取り込み（Claude Code・Codex）

- 読み: 深く読んだ
- 受け持ち: host が渡した transcript だけを読む（ディレクトリを探し回らない）。symlink・置き換わり・大きすぎを断り、session_id と cwd がその会話の物かを確かめる。Claude Code・Codex の行から、system・developer の指示と隠れた推論を外し、秘匿処理をして `raw_events` と `conversation_events` に書く。Stop と UserPromptSubmit の hook は末尾 4 MiB、SessionStart は 8 MiB まで。重複は `getRawEvents`（1,000 件まで）で確かめる。手動の道具 `ingest_conversation_events` は過去 24 時間の file を探して取り込む。
- 主なファイル: src/transcript-stop-capture.ts、src/session-start-auto-receive.ts、src/claude-conversation-ingest.ts、src/codex-conversation-ingest.ts
- 依存: 保存の層、秘匿処理、src/raw-capture-coverage.ts

## 会話の記録の取り込み（Gemini・Antigravity）

- 読み: 浅く見た
- 主なファイル: src/gemini-conversation-ingest.ts、src/antigravity-conversation-ingest.ts

## hook の設置（Claude Code・Codex）

- 読み: 深く読んだ
- 受け持ち: `<workspace>/.claude/settings.json`（Claude Code）・`<workspace>/.codex/hooks.json`（Codex）に、SessionStart・Stop・UserPromptSubmit の 3 つの組を置く。Kusabi の handler だけを見分けて差し替え、ほかは残す。書く前に控えを取り、一時 file から rename する。信頼（trust）の操作と「最初の文脈に届いた」の確かめはしない（Codex は hooks の画面で人が信頼する）。
- 主なファイル: src/claude-hook-installer.ts、src/codex-hook-installer.ts
- 依存: 起動時の回復の口（Claude Code・Codex）の定数、src/transcript-stop-capture.ts の定数

## hook の設置（Gemini・Antigravity）

- 読み: 浅く見た
- 受け持ち: `.gemini/settings.json`・`.agents/hooks.json` に置く。
- 主なファイル: src/gemini-hook-installer.ts、src/antigravity-hook-installer.ts

## 回復の文と束

- 読み: 深く読んだ（src/restart-pack.ts の形の確かめの関数は浅く）
- 受け持ち: 記録を件数の上限つきで読み（`loadRecoveryContext`）、回復の文（`buildRecoveryOutput`）と回復の束（`buildRestartPack`、`recovery-pack/v1`、`host-invocation-context/v1`）を作る。束は「今の目的・作業・次の一手・妨げ・決定・file・PR・知識・最近の会話」の順で、token の上限で切る。作業の印が 12 時間より古いと注意を付ける。足りない物（`missing_context`）から確かさを出す。
- 主なファイル: src/recovery-context.ts、src/restart-pack.ts、src/constants.ts、src/continuity-analysis.ts
- 依存: 保存の層、秘匿処理、src/artifact-schema-validator.ts

## 再起動の準備と判定

- 読み: 深く読んだ
- 受け持ち: 使用率の帯と確かさから `action` を決め、1 回だけ使える束を `selected_restart_packs` に置く。自動の作り直しの妨げを数える。作り直しの command を確かめる。Claude Code の「作り直しが要る」の marker を読み、準備だけをする（実行しない）。
- 主なファイル: src/restart-prepare.ts、src/restart-cli.ts、src/restart-command-preflight.ts、src/claude-marker-controller.ts
- 依存: 回復の文と束、継続の印、保存の層
- 注意: src/claude-marker-controller.ts は試験からだけ呼ばれる

## 文脈の量の測定

- 読み: 深く読んだ
- 受け持ち: model ごとの窓の大きさの表と、環境変数・marker での上書きから窓を決め、測った量を帯にする。Codex の rollout の transcript から今の量と host の報せる窓を読む。
- 主なファイル: src/context-window-resolution.ts、src/codex-context-measurement.ts
- 依存: なし（純粋な関数）
- 注意: 本番の呼び手は無い（src/test.ts だけ）。Claude Code の量の読み取りは無い。表の Codex の model（`gpt-5.6-sol`）は空で、表だけでは決まらない

## 新しい会話の起動

- 読み: 深く読んだ
- 受け持ち: Claude Code: 準備をして、条件がそろう時だけ新しい `claude` を起こす。`--fresh-session` は `--settings` で SessionStart に dist/boot.js を付け、準備した束を使う。Codex: 起動の文を作り、`--launch` は引数で、`--fresh-session` は `codex exec --json -` に stdin で渡す。MCP の束縛を `codex mcp get --json` で読み戻して確かめる。どちらも今の会話を kill しない。tmux の helper は `/exit` を送ってから新しい tmux の会話を起こす。
- 主なファイル: src/claude-start.ts、src/codex-start.ts、scripts/host-adapters/（4 本）
- 依存: 再起動の準備と判定、回復の文と束、保存の層、席の実行の身元
- 注意: 既定の path が作業者の home の下の別の checkout（`~/Developer/agent-memory`）に固定されている

## 保存の層

- 読み: 選び方（src/stores/index.ts）だけ深く読み、実装は浅く見た
- 受け持ち: Store の interface と実装 3 つ（PostgreSQL・SQLite・JSON）。表は `decisions`・`task_states`・`knowledge`・`recovery_config`・`recovery_quality_log`・`task_state_migration_archive`・`conversation_events`・`raw_events`・`kusabi_runtime_events`・`selected_restart_packs`・`kusabi_agent_memory_partitions`。`catch_up_log` は SQLite だけ（PostgreSQL は TODO AM-026）。PostgreSQL の表の変更は起動の時に流す（hook は `skipPostgresMigrations` で流さない）。
- 主なファイル: src/stores/*
- 依存: pg、sql.js、uuid、意味検索

## 意味検索

- 読み: 浅く見た
- 受け持ち: PostgreSQL の時、決定・作業・知識の文を Voyage AI に送って埋め込みを受ける。鍵は環境変数か `~/.agent-com-api-keys`。`AGENT_MEMORY_DISABLE_EMBEDDINGS=1` で止まる。
- 主なファイル: src/stores/voyage.ts

## 継続の印

- 読み: 浅く見た（型と consume の関数だけ）
- 受け持ち: 作業・決定・repo の head・外への効果の状態を digest つきで固めた束を作り、consume の時に確かめる。完了した効果は再実行しない方針を持つ。
- 主なファイル: src/kusabi-checkpoint-recovery.ts

## 新しい会話の群れの試し

- 読み: 浅く見た（起動の関数だけ）
- 受け持ち: 固定の 12 席に、1 席ずつ新しい process（`codex exec`・`claude -p`）を起こし、続きの目的と次の一手を返させて照らす試し。
- 主なファイル: src/kusabi-fresh-session-fleet.ts、scripts/kusabi-fresh-session-fleet.sh

## 運用の観測と展開

- 読み: 浅く見た
- 主なファイル: src/kusabi-fleet-rollout.ts、src/kusabi-direct-fleet-rollout.ts、src/kusabi-fleet-status.ts、src/kusabi-fleet-status-cli.ts、src/kusabi-one-seat-canary.ts、src/continuity-alpha-evaluator.ts、src/continuity-alpha-canary.ts、src/kusabi-functional-evaluator.ts、src/measure-kusabi-functional.ts、src/company-dev-os-recovery-target-audit.ts、src/raw-capture-service.ts、src/fleet-conversation-backfill.ts、src/kusabi-direct-db-gate.ts、src/kusabi-continuity-interruption-e2e.ts

## 席の実行の身元

- 読み: 浅く見た
- 受け持ち: 起動の身元（席・案件・host・adapter・commit・設定の digest）を組み立てて確かめる。起動の出来事を `kusabi_runtime_events` に残す（期限 500 ms）。
- 主なファイル: src/kusabi-runtime-identity.ts、src/kusabi-runtime-event-emitter.ts、src/kusabi-runtime-event-store.ts

## 秘匿処理

- 読み: 浅く見た
- 受け持ち: 鍵・token・資格情報・DB の URL・電話番号らしい文字列を伏せる。道具の応答から壊れた文字を除く。
- 主なファイル: src/redact.ts、src/sanitize.ts

## 区画の登録と記録の読み出し

- 読み: 浅く見た
- 主なファイル: src/kusabi-partitions.ts、src/memory-source.ts、src/stores/knowledge-scope.ts

## 印の拾い上げ

- 読み: 浅く見た
- 受け持ち: 送った文の `[TASK:start]`・`[DECISION]`・`[KNOWLEDGE]` などの印を PostToolUse の hook で拾って記録にする。取りこぼしを Claude Code の記録から後で拾う。
- 主なファイル: src/post-tool-hook.ts、scripts/post-tool-hook.sh、src/catch-up.ts、src/ensure-tags.ts、templates/memory-tags.md

## 社内の門の道具

- 読み: 浅く見た
- 受け持ち: PR ごとの Shirube の門（Rapid/Lite）の判定と、作業の引き渡しの記録。
- 主なファイル: .shirube/runtime/rapid-lite/*、.shirube/control-handoffs/*、.github/workflows/shirube-rapid-lite-gates-report.yml
