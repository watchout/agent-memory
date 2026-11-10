# 口の一覧 — Kusabi（agent-memory）

外から使える口（MCP の道具・CLI・hook の入出力・環境変数）はここが持ち主。部品の受け持ちは component-inventory.md を参照。

## 1. MCP の道具（src/index.ts、stdio、サーバー名 `wasurezu`、17 個）

席の身元は process の環境変数で決まる: `AGENT_MEMORY_AGENT_ID`（既定 `default`）、`AGENT_MEMORY_PROJECT`、`CLAUDE_SESSION_ID`。各道具は呼び出しを `~/.agent-memory/calls.log` に秘匿処理をして書く。

| 道具 | 書く・読む | 主な引数 | 中身 |
|---|---|---|---|
| `log_decision` | 書く | decision, context?, tags?, project? | 決定を残す |
| `get_decisions` | 読む | project?, tags?, limit?, status? | 決定を返す（既定は active） |
| `supersede_decision` | 書く | old_decision_id, new_decision, … | 古い決定を superseded にし、新しい決定とつなぐ |
| `save_task_state` | 書く | task, status(in_progress/completed/blocked), progress?, files_modified?, next_steps? | 作業の状態を残す |
| `search_memory` | 読む | query, scope(decisions/tasks/knowledge/messages/conversation/all)?, limit?, project?, knowledge_scope? | 記録を探す。会話の結果は `read_memory_source` で続きを読む |
| `read_memory_source` | 読む | source_ref, project?, offset?, max_chars(≦8000)?, expected_content_hash? | 会話の記録の一部を上限つきで読む |
| `recover_context` | 読む＋記録 | project? | 回復の文を返し、`recovery_quality_log` に記録。続けたかの見張りを始める |
| `restart_pack` | 読む | project?, max_tokens?, format(text/recovery-pack-v1/host-invocation-context-v1)?, target_runtime?, delivery_mode?, … | 回復の束を返す |
| `restart_pack_fetch` | 読む／書く | pack_ref, project?, consume? | 置いた束を取り出す。consume=true で使用済みにする |
| `restart_prepare` | 書く | continuity_guard_mode?, pack_injection_mode?, context_used_ratio?, context_tokens?, context_window_tokens?, runtime_context_error?, aun_installed?, aun_absent_confirmed?, supervisor_available?, restart_preauthorized?, pack_format?, … | 作り直しの判定を返し、束を置く（下の 4 を参照） |
| `set_recovery_config` | 書く | agent_id, max_tokens?, *_limit? | 回復の件数と上限を変える（agent_id を引数で受ける） |
| `save_knowledge` | 書く | title, content, source_type?, tags?, memory_scope?, source_ids?, project? | 知識を残す |
| `get_knowledge` | 読む | status?, tags?, project?, knowledge_scope?, limit? | 知識を返す |
| `supersede_knowledge` | 書く | old_id, new_title, new_content, reason | 知識を差し替える |
| `update_knowledge_status` | 書く | id, status, merged_into? | 知識の状態を変える |
| `ingest_conversation_events` | 書く | source(claude_code/codex)?, project?, since?, root?, max_files? | 手元の transcript をまとめて取り込む |
| `catch_up` | 書く | since?, source?, dry_run? | Claude Code の記録から、取りこぼした印（タグ）を拾う |

## 2. CLI（package.json の bin、19 個・行き先 17）

| bin | 行き先 | 中身 |
|---|---|---|
| `kusabi`・`wasurezu`・`agent-memory` | `dist/index.js` | MCP サーバー |
| `wasurezu-claude-session-start`・`wasurezu-codex-session-start`・`wasurezu-gemini-session-start`・`wasurezu-antigravity-session-start` | `dist/*-session-start.js` | 各 CLI の起動の hook |
| `wasurezu-claude-hook-install`・`wasurezu-codex-hook-install`・`wasurezu-gemini-hook-install`・`wasurezu-antigravity-hook-install` | `dist/*-hook-installer.js` | hook の設置と確かめ（check・dry-run・apply） |
| `wasurezu-transcript-stop-capture` | `dist/transcript-stop-capture.js` | Stop と UserPromptSubmit の hook |
| `wasurezu-claude-start` | `dist/claude-start.js` | Claude Code の作り直しの準備と新しい会話の起動 |
| `wasurezu-codex-start` | `dist/codex-start.js` | Codex の起動の文づくりと新しい会話の起動 |
| `wasurezu-restart` | `dist/restart-cli.js` | `prepare`・`fetch`・`preflight` |
| `wasurezu-fleet-conversation-backfill` | `dist/fleet-conversation-backfill.js` | 複数の席の transcript の後からの取り込み |
| `wasurezu-kusabi-direct-fleet-rollout`・`wasurezu-kusabi-fleet-status`・`wasurezu-continuity-alpha-canary` | `dist/…` | 展開・状態・試し |

bin に無い入口: `dist/boot.js`（旧来の SessionStart、`npm run boot`）、`dist/kusabi-fresh-session-fleet.js`（scripts/kusabi-fresh-session-fleet.sh から）、`dist/post-tool-hook.js`。

## 3. hook の入出力

### SessionStart（Claude Code: src/claude-session-start.ts、Codex: src/codex-session-start.ts）

- 設定の置き場: Claude Code は `<workspace>/.claude/settings.json`、Codex は `<workspace>/.codex/hooks.json`。matcher は `startup|resume|clear|compact`、hook の期限 9 秒。
- command の引数: `--adapter-id --agent-id --project --workspace --binding-source-ref --max-tokens(500〜1800) --max-bytes(1024〜8192) --timeout-ms(100〜7000) [--runtime-event-manifest <絶対 path>]`。
- 入力（stdin の JSON、64 KiB まで）:
  - Claude Code: 必須 `cwd`・`hook_event_name`(SessionStart)・`session_id`・`source`(startup/resume/clear/compact)・`transcript_path`。任意 `agent_type`・`model`・`permission_mode`。ほかの鍵があれば不正。
  - Codex: 鍵はちょうど 7 つ（上の必須 5 つ＋`model`・`permission_mode`）。`transcript_path` は null を許す。
- 出力（stdout）: `{"continue":true,"suppressOutput":false,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}`。失敗の時は `systemMessage` に理由を書き、`additionalContext` を出さない。
- 証拠（stderr）: `claude-session-start-evidence/v1`・`codex-session-start-evidence/v1`。`delivery.first_context_delivery_confirmed` は常に false。

### Stop と UserPromptSubmit（src/transcript-stop-capture.ts）

- 引数は SessionStart と同じ形（`--adapter-id` が `wasurezu-claude-transcript-stop` か `wasurezu-codex-transcript-stop`）。`async: true`、期限 9 秒。
- 入力: 必須 `cwd`・`hook_event_name`(Stop/UserPromptSubmit)・`session_id`・`transcript_path`。任意 `agent_id`・`agent_type`・`last_assistant_message`・`model`・`permission_mode`・`prompt`・`stop_hook_active`・`turn_id`。
- 出力: `{"continue":true,"suppressOutput":true}`。証拠は `wasurezu-transcript-stop-capture/v1`（captured・skipped・failed_open と理由）。

## 4. 作り直しの準備（`restart_prepare`・`wasurezu-restart prepare`・src/restart-prepare.ts）

- 使用率: `context_used_ratio`、または `context_tokens ÷ context_window_tokens`。無い時は帯 `unknown`（source=estimated）。
- 帯: 0.95 以上 `require`、0.90 以上 `recommend`、0.80 以上 `warn`、0.70 以上 `prepare`、それ未満 `ok`。
- `action`: モード off → `off`、pack_only → `pack_update_needed`、`runtime_context_error` か `require` → `restart_required`、決定の食い違いあり・`recommend`・確かさ 0.55 未満 → `restart_recommended`、ほかは `pack_update_needed`。
- `can_auto_restart` は `auto_restart` を頼み、かつ妨げ（`aun_installed`・`aun_absence_not_confirmed`・`supervisor_or_host_hook_unavailable`・`restart_lifecycle_not_preauthorized`）が 0 の時だけ true。
- 出力の主な鍵: `action`・`continuity_guard_mode`・`can_auto_restart`・`auto_restart_blockers`・`pack_ref`・`recovery_confidence`・`context_signal{source,usage_ratio,band}`・`provenance`・`notes`。
- `wasurezu-restart preflight`: 作り直しの command を確かめる。許す bin は `wasurezu-claude-start`・`wasurezu-codex-start`・`wasurezu-restart` か絶対 path。shell の制御文字・相対 path を断る（src/restart-command-preflight.ts）。

## 5. 文脈の量の判定（src/context-window-resolution.ts、本番の呼び手なし）

- `judgeContextHealth({measuredContextTokens, model, host, markerWindowTokens, env})` → `band`・`used_ratio`・`resolution_status`・`reason`・`restart_recommended`・`restart_required`。
- 窓の大きさの順: 環境変数 `AGENT_MEMORY_<HOST>_CONTEXT_WINDOW_TOKENS`／`AGENT_MEMORY_CONTEXT_WINDOW_TOKENS` → marker → model の表。表で 1 つに決まらない・測った量が窓を超える時は `unknown` と理由。
- Codex の測り: `measureCodexContextFromTranscriptLines(lines)`（src/codex-context-measurement.ts）。最後の `token_count` の `last_token_usage.input_tokens` と `model_context_window` を使う。

## 6. 主な環境変数

| 変数 | 使う所 |
|---|---|
| `AGENT_MEMORY_AGENT_ID`・`AGENT_MEMORY_PROJECT` | 席と案件（全部） |
| `AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`DATABASE_URL`・`AGENT_MEMORY_DB_PATH` | DB の選び方（src/stores/index.ts）。hook は `~/.agent-memory/config.json` の `database_url` も読む |
| `AGENT_MEMORY_WORKSPACE`・`AGENT_MEMORY_BINDING_SOURCE_REF` | hook の束縛の既定 |
| `AGENT_MEMORY_BOOT_MODE`・`AGENT_MEMORY_SELECTED_PACK_REF`・`AGENT_MEMORY_CLAUDE_HOOK_JSON`・`AGENT_MEMORY_STARTUP_BRIDGE` | src/boot.ts で準備した束を使う |
| `AGENT_MEMORY_CLAUDE_BIN`・`AGENT_MEMORY_BOOT_JS`・`AGENT_MEMORY_CODEX_BIN`・`AGENT_MEMORY_WASUREZU_ENTRYPOINT` | launcher |
| `WASUREZU_RESTART_COMMAND`・`AGENT_MEMORY_RESTART_COMMAND`・`WASUREZU_RESTART_PREAUTHORIZED` | `wasurezu-restart preflight` |
| `AGENT_MEMORY_<HOST>_CONTEXT_WINDOW_TOKENS`・`AGENT_MEMORY_CONTEXT_WINDOW_TOKENS` | 窓の大きさの上書き |
| `CLAUDE_PROJECTS_DIR`・`CODEX_SESSIONS_DIR`・`CODEX_HOME` | transcript の置き場 |
| `AGENT_MEMORY_DISABLE_EMBEDDINGS`・`VOYAGE_API_KEY` | 外の埋め込みの有無 |
| `AGENT_MEMORY_KUSABI_INTERNAL_OPT_IN` ほか `AGENT_MEMORY_EXPECTED_*` | 社内の 1 席の身元の確かめ（src/codex-start.ts） |

## 7. 形の決まった成果物

- `recovery-pack/v1`・`host-invocation-context/v1`: docs/design/schemas/ の JSON Schema で確かめる（src/artifact-schema-validator.ts、src/restart-pack.ts）。
- `kusabi-continuation-recovery-pack/v1`・`continuation-equivalent-state/v1`: 継続の印つきの束（src/kusabi-checkpoint-recovery.ts）。本番の MCP の道具と CLI からは作れない（`prepareRestart` の内部の引数だけ）。
