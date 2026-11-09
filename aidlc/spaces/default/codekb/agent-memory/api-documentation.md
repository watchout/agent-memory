# 外と内の口 — Kusabi（agent-memory）

## MCP の道具（17 個、src/index.ts）

stdio の MCP サーバーとして出す。agent_id の欄は「誰の記憶を読み書きするか」の決まり方。

| 道具 | 中身 | agent_id |
|------|------|----------|
| log_decision | 決定を記録する | process の環境 |
| get_decisions | 決定を読む（既定は有効な物だけ） | process の環境 |
| supersede_decision | 古い決定を新しい決定で置き換え、つなぐ | process の環境 |
| save_task_state | 作業の状態を保存する | process の環境 |
| search_memory | 記録と会話を探す | process の環境 |
| read_memory_source | search_memory が返した会話の一部を読む（同じ席・同じ案件だけ） | process の環境 |
| recover_context | 起動の時の回復の内容をまとめて返す | process の環境 |
| restart_pack | 続きから再開するための短い束を作る（文か決まった形） | process の環境 |
| restart_pack_fetch | 選ばれた束を取り出す（使った印を付けられる） | process の環境 |
| restart_prepare | 再起動の準備の束と続きの印を作る（席を止めたり AUN の列を動かしたりはしない） | process の環境 |
| set_recovery_config | 回復で返す量の設定を変える | **引数で任意の agent_id を受ける** |
| save_knowledge | 知識を残す | process の環境 |
| get_knowledge | 知識を読む（状態・札・案件で絞る） | process の環境 |
| supersede_knowledge | 古い知識を正しい知識で置き換える | process の環境 |
| update_knowledge_status | 知識の状態を変える（保管・統合など） | process の環境 |
| ingest_conversation_events | 手元の会話の記録（Claude Code・Codex の JSONL）を伏せ字の処理をして取り込む | process の環境 |
| catch_up | Claude Code の会話の記録から、取りこぼした札つきの出来事を後から拾う | process の環境 |

## コマンド（19 個、package.json の bin）

| コマンド | 中身 |
|----------|------|
| kusabi・wasurezu・agent-memory | MCP サーバー（同じ物の 3 つの名前） |
| wasurezu-claude-session-start・wasurezu-codex-session-start・wasurezu-gemini-session-start・wasurezu-antigravity-session-start | 席の種類ごとの起動の口 |
| wasurezu-claude-hook-install・wasurezu-codex-hook-install・wasurezu-gemini-hook-install・wasurezu-antigravity-hook-install | 起動の口を席の設定に入れる |
| wasurezu-claude-start・wasurezu-codex-start | 記憶つきで席を起動する |
| wasurezu-transcript-stop-capture | 席の止まりの時に会話を取り込む |
| wasurezu-fleet-conversation-backfill | 複数の席の会話を後から取り込む |
| wasurezu-kusabi-direct-fleet-rollout | 複数の席へ展開する |
| wasurezu-kusabi-fleet-status | 複数の席の状態を表示する |
| wasurezu-continuity-alpha-canary | 続きの試し（一部の席で試す） |
| wasurezu-restart | 再起動 |

## 環境変数の契約

| 変数 | 中身 |
|------|------|
| AGENT_MEMORY_AGENT_ID | 記憶の持ち主（無ければ `default`） |
| AGENT_MEMORY_PROJECT | 案件 |
| AGENT_MEMORY_DB_TYPE | `sqlite`・`postgres`・`json` の明示の選択 |
| AGENT_MEMORY_DATABASE_URL・DATABASE_URL | PostgreSQL の URL（前の方が優先） |
| AGENT_MEMORY_DB_PATH | SQLite の file の場所 |
| VOYAGE_API_KEY | 埋め込みの鍵（無ければ `~/.agent-com-api-keys` を読む） |
| AGENT_MEMORY_DISABLE_EMBEDDINGS | `1` で埋め込みを作らない |
| AGENT_MEMORY_BOOT_MODE・AGENT_MEMORY_STARTUP_BRIDGE・AGENT_MEMORY_SELECTED_PACK_REF・AGENT_MEMORY_CLAUDE_HOOK_JSON・CLAUDE_SESSION_ID | 起動の口と再起動の束の受け渡し |

## 内部の契約（保存の層）

Store の interface（src/stores/types.ts 499〜625 行目）。主な群:

- 決定: logDecision・getDecisions・supersedeDecision
- 作業の状態: saveTaskState・getTaskStates・expireStaleTaskStates
- 知識: saveKnowledge・getKnowledge・updateKnowledgeStatus・supersedeKnowledge
- 検索: searchMemory・updateSearchMemoryCount
- 会話: saveConversationEvent・getConversationEvents・saveRawEvent・getRawEvents・getRecentMessages（AUN の表）
- 回復: getRecoveryConfig・upsertRecoveryConfig・logRecoveryQuality・markRecoveryContinued
- 再起動の束: saveSelectedRestartPack・getSelectedRestartPack・consumeSelectedRestartPack
- 取りこぼしの拾い: getLastCatchUpLog・saveCatchUpLog・isCatchUpDuplicate・getFailedCatchUpLogs
- 席の実行の出来事: saveKusabiRuntimeEvent・getKusabiRuntimeEvents
- 区画: getKusabiPartition・upsertKusabiPartition・listKusabiPartitions

どの読み書きも agent_id を引数に取る。表は component-inventory.md の「保存の層」を参照。

## 外への呼び出し

| 先 | 中身 | 条件 |
|----|------|------|
| Voyage AI（https://api.voyageai.com/v1/embeddings、型 voyage-3-lite、512 次元） | 決定・作業の状態・知識の文を送り、埋め込みを受ける | PostgreSQL の時で、鍵があり、`AGENT_MEMORY_DISABLE_EMBEDDINGS=1` でない時（src/stores/voyage.ts） |
| AUN の agent_messages 表 | 最近のメッセージを読む | 同じ PostgreSQL の DB にその表がある時（src/stores/pg-store.ts） |
| 席の道具の手元の会話の記録 | 読むだけ | 会話の取り込みの時 |
