# 部品の一覧 — Kusabi（agent-memory）

部品ごとの受け持ちと依存。ファイルの一覧は code-structure.md、口の一覧は api-documentation.md を参照。深く読んだ部品と浅く見ただけの部品は reverse-engineering-timestamp.md の範囲の記録で分けている。

## MCP サーバー

- **受け持ち**: 17 個の道具を stdio で出す。process の環境変数から agent_id・project・session_id を決め、道具の処理に付ける。呼び出しを `~/.agent-memory/calls.log` に書く。回復の後の続きの印（search_memory の回数・続けたかどうか）を見張る
- **主なファイル**: src/index.ts（1,013 行）
- **依存**: 保存の層、回復、記録の読み出し、会話の取り込み、MCP SDK、zod

## 保存の層

- **受け持ち**: Store の interface と 3 つの実装（SQLite・PostgreSQL・JSON）。実装の選び方は architecture.md を参照。DB の作りの変更を起動の時に流す
- **表**: decisions、task_states（agent_id と task_id で一意）、knowledge（memory_scope の列つき）、recovery_config、recovery_quality_log、task_state_migration_archive、conversation_events、raw_events、kusabi_runtime_events、selected_restart_packs、kusabi_agent_memory_partitions。catch_up_log は SQLite だけにあり、PostgreSQL 側は未実装（TODO AM-026）。PostgreSQL では decisions・task_states・knowledge に埋め込みの列（512 次元）と索引を足す
- **主なファイル**: src/stores/types.ts、src/stores/index.ts、src/stores/pg-migrations.ts、src/stores/knowledge-scope.ts、src/stores/pg-store.ts、src/stores/sqlite-store.ts、src/stores/json-store.ts
- **依存**: pg、sql.js、意味検索（PostgreSQL の時）

## 意味検索

- **受け持ち**: 決定・作業の状態・知識の文を Voyage AI に送り、埋め込みを受ける。鍵は環境変数か `~/.agent-com-api-keys`。`AGENT_MEMORY_DISABLE_EMBEDDINGS=1` で止まる
- **主なファイル**: src/stores/voyage.ts
- **依存**: Voyage AI（外の有料の API）

## 回復

- **受け持ち**: 回復の設定（件数の上限）に従って、進行中と完了の作業・有効な決定・知識・最近の会話・AUN のメッセージを集め、回復の文と再起動の束を作る。回復の質の記録を書き、続けたかどうかの印を付ける（2 値）
- **主なファイル**: src/recovery-context.ts、src/recovery-quality.ts、src/restart-pack.ts、src/restart-prepare.ts
- **依存**: 保存の層

## 起動の口

- **受け持ち**: 席の種類（Claude Code・Codex・Gemini・Antigravity）ごとに、起動の時に回復の文を席の最初の文脈へ差し込む。Claude Code の口（src/boot.ts）は 7 日より古い進行中の作業を期限切れにする。起動の口を席の設定に入れるコマンドも持つ
- **主なファイル**: src/boot.ts、src/claude-session-start.ts、src/codex-session-start.ts、src/gemini-session-start.ts、src/antigravity-session-start.ts、各 *-hook-installer.ts
- **依存**: 保存の層、回復、席の実行の身元

## 会話の取り込み

- **受け持ち**: 席の道具の手元の会話の記録を読み、隠れた推論と開発者向けの指示の本文を外し、秘匿処理を通して conversation_events・raw_events に書く（ingest_conversation_events の説明文）。取りこぼしを後から拾う（catch_up）
- **主なファイル**: src/claude-conversation-ingest.ts、src/codex-conversation-ingest.ts、src/gemini-conversation-ingest.ts、src/catch-up.ts、src/raw-capture-service.ts
- **依存**: 保存の層、秘匿処理

## 記録の読み出し

- **受け持ち**: search_memory が返した会話の一部を、同じ agent_id・同じ案件の物だけ、長さの上限つきで読み出す
- **主なファイル**: src/memory-source.ts
- **依存**: 保存の層

## 区画の登録

- **受け持ち**: 席ごとの記憶の区画（kusabi_agent_memory_partitions）を登録・読み出しする。登録が無い・壊れている時は、その席だけの非公開として扱う
- **主なファイル**: src/kusabi-partitions.ts
- **依存**: 保存の層

## 席の実行の身元

- **受け持ち**: 席の起動の時の身元（agent_id・席の種類・session・起動の元）を組み立て、実行の出来事（kusabi_runtime_events）として残す
- **主なファイル**: src/kusabi-runtime-identity.ts、src/kusabi-runtime-event-emitter.ts、src/kusabi-runtime-event-store.ts
- **依存**: 保存の層

## 運用の観測と展開

- **受け持ち**: 複数の席への展開・状態の表示・一部の席での試し・続きの評価・回復の対象の監査
- **主なファイル**: src/kusabi-fleet-rollout.ts、src/kusabi-direct-fleet-rollout.ts、src/kusabi-fleet-status.ts、src/kusabi-one-seat-canary.ts、src/continuity-alpha-evaluator.ts、src/kusabi-functional-evaluator.ts、src/company-dev-os-recovery-target-audit.ts
- **依存**: 保存の層、起動の口

## 秘匿処理

- **受け持ち**: 取り込む文から秘密らしい文字列（各社の鍵・token・Bearer・JWT・秘密鍵・資格情報の環境変数・URL の中の資格情報・DB の URL）を伏せ、伏せた数と処理の版を返す（src/redact.ts）。道具の応答の文から壊れた文字を取り除く（src/sanitize.ts）
- **主なファイル**: src/redact.ts、src/sanitize.ts
- **依存**: なし
