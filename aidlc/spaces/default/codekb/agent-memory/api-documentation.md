# 口の一覧 — Kusabi（agent-memory）

外から使える口（MCP の道具・CLI・hook の入出力・環境変数）はここが持ち主。部品の受け持ちは component-inventory.md、呼び出し元の表は dependencies.md を参照。「前回の読み」と付けた節は 2026-11-10 の読みのままで、2026-11-15 の取り組み 261113-store-resolution-fix では確かめていない。今回書き直したのは「3. hook の入出力」の command の形、「6. 主な環境変数」の DB の行、新しい「8. 保存先の決め方」。

## 1. MCP の道具（src/index.ts、stdio、サーバー名 `wasurezu`、17 個。前回の読み）

席の身元は process の環境変数で決まる: `AGENT_MEMORY_AGENT_ID`（既定 `default`）、`AGENT_MEMORY_PROJECT`、`CLAUDE_SESSION_ID`。各道具は呼び出しを `~/.agent-memory/calls.log` に秘匿処理をして書く。store は接続の後に `createStoreReadiness(() => createStore({ skipPostgresMigrations: true }))` で開く（`src/index.ts:53`、今回読んだ事実）。

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
| `wasurezu-restart` | `dist/restart-cli.js` | `prepare`・`fetch`・`preflight`（`handoff-source` もある。今回読んだ事実、`src/restart-cli.ts:249`） |
| `wasurezu-fleet-conversation-backfill` | `dist/fleet-conversation-backfill.js` | 複数の席の transcript の後からの取り込み |
| `wasurezu-kusabi-direct-fleet-rollout`・`wasurezu-kusabi-fleet-status`・`wasurezu-continuity-alpha-canary` | `dist/…` | 展開・状態・試し |

bin に無い入口: `dist/boot.js`（旧来の SessionStart、`npm run boot`）、`dist/kusabi-fresh-session-fleet.js`（scripts/kusabi-fresh-session-fleet.sh から）、`dist/post-tool-hook.js`、`dist/session-rotation-stop.js`（installer の command が path で呼ぶ。今回読んだ事実）。

## 3. hook の入出力

### SessionStart（Claude Code: src/claude-session-start.ts、Codex: src/codex-session-start.ts。入出力は前回の読み）

- 設定の置き場: Claude Code は `<workspace>/.claude/settings.json`、Codex は `<workspace>/.codex/hooks.json`。matcher は `startup|resume|clear|compact`、hook の期限 9 秒。
- command の引数: `--adapter-id --agent-id --project --workspace --binding-source-ref --max-tokens(500〜1800) --max-bytes(1024〜8192) --timeout-ms(100〜7000) [--runtime-event-manifest <絶対 path>]`。
- 入力（stdin の JSON、64 KiB まで）:
  - Claude Code: 必須 `cwd`・`hook_event_name`(SessionStart)・`session_id`・`source`(startup/resume/clear/compact)・`transcript_path`。任意 `agent_type`・`model`・`permission_mode`。ほかの鍵があれば不正。
  - Codex: 鍵はちょうど 7 つ（上の必須 5 つ＋`model`・`permission_mode`）。`transcript_path` は null を許す。
- 出力（stdout）: `{"continue":true,"suppressOutput":false,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}`。失敗の時は `systemMessage` に理由を書き、`additionalContext` を出さない。
- 証拠（stderr）: `claude-session-start-evidence/v1`・`codex-session-start-evidence/v1`。`delivery.first_context_delivery_confirmed` は常に false（前回の読み）。保存先を名指す項目（`store_binding`・`binding_sha256`・`backend_intent`）を持つのはこの SessionStart の証拠（今回読んだ事実。`src/codex-session-start.ts:125、723、812、881`、`src/claude-session-start.ts:385`）。

### Stop と UserPromptSubmit（src/transcript-stop-capture.ts。入出力は前回の読み）

- 引数は SessionStart と同じ形（`--adapter-id` が `wasurezu-claude-transcript-stop` か `wasurezu-codex-transcript-stop`）。`async: true`、期限 9 秒。
- 入力: 必須 `cwd`・`hook_event_name`(Stop/UserPromptSubmit)・`session_id`・`transcript_path`。任意 `agent_id`・`agent_type`・`last_assistant_message`・`model`・`permission_mode`・`prompt`・`stop_hook_active`・`turn_id`。
- 出力: `{"continue":true,"suppressOutput":true}`。証拠は `wasurezu-transcript-stop-capture/v1`（captured・skipped・failed_open と理由）。保存先を名指す項目（`store_binding`・`binding_sha256`・`backend`）は無い（今回読んだ事実。`src/transcript-stop-capture.ts:240` から始まる evidence の項目と grep）。

### 回転の Stop の組（src/session-rotation-stop.ts、今回読んだ事実）

- 同じ Stop・UserPromptSubmit に並ぶ、もう 1 つの command（`dist/session-rotation-stop.js`）。`async` の指定が無い（transcript の取り込みは `async: true`）。command は上の形に `[--rotation-threshold-tokens <n>]` が付く（`buildRotationHookGroup`、`src/rotation-hook-registration.ts:61-100`）。
- 置くのは installer に `--rotation on` を渡した時だけ（opt-in）。渡さなければ既にある回転の handler をそのままにし、`--rotation off` で外す（`src/rotation-hook-registration.ts:2-8`、`RotationInstall`）。Claude Code の installer も Codex の installer も同じ関数で置く（Claude Code は `src/claude-hook-installer.ts:389、427-428`、Codex は `src/codex-hook-installer.ts:428-429`。どちらも Stop と UserPromptSubmit の両方）。どの席に実際に置いてあるかは今回確かめていない。
- 動き: 文脈の量を測り、閾値を超えたら引き継ぎを 1 回頼んで DB に保存し、その後で「切ってよい」の印を出す。キーを送らず、tmux に触れず、外の API を呼ばない（file の冒頭の説明）。

### command の形（保存先に関わる所。今回読んだ事実）

- 形（Claude Code: `buildClaudeHookCommand`、`src/claude-hook-installer.ts:171-198`。Codex: `buildCodexHookCommand`、`src/codex-hook-installer.ts:173-200`）: `<node の絶対 path> <runtime>/dist/<入口>.js --adapter-id <id> --agent-id <席> --project <案件> --workspace <作業場> --binding-source-ref <参照> --max-tokens <n> --max-bytes <n> --timeout-ms <n> [--runtime-event-manifest <path>]`。回転の Stop は末尾に `[--rotation-threshold-tokens <n>]`。
- 環境変数の接頭辞も `env` の項目も無い。保存先を指す引数（`--database-url`・`--store` など）も、config の path を渡す引数も無い。保存先に関わる値を command で渡す所は無い。席の身元は引数で渡すが、保存先は引数で渡さない。
- 入口は `--adapter-id` の種類で決まる: SessionStart、transcript の Stop（`async: true`、`src/claude-hook-installer.ts:308`、`src/codex-hook-installer.ts:309`）、回転の Stop（`async` の指定が無い。`--rotation on` の時だけ置かれる）。待ちの上限は 3 つとも 9 秒（`CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS`・`CODEX_SESSION_START_HOOK_TIMEOUT_SECONDS`・`TRANSCRIPT_STOP_HOOK_TIMEOUT_SECONDS`・`ROTATION_STOP_HOOK_TIMEOUT_SECONDS` の定義）。
- installer は「byte で同じ形」の command だけを自分の物と見分ける（`parseClaudeHookCommand`・`parseCodexHookCommand` は語の数が 18 または 20 のときだけ受ける）。env の接頭辞や追加の引数がある command は、自分の物と見分けられず、そのまま残る。
- 置き場の file に env の項目を足す処理は無い（grep で `env:` の書き込みが 0 件）。席が起動する時の環境変数（`AGENT_MEMORY_DB_TYPE` など）は、席の CLI を起こす側（tmux・launcher）が決める。それは今回の範囲の外で読んでいない。

## 4. 作り直しの準備（`restart_prepare`・`wasurezu-restart prepare`・src/restart-prepare.ts。前回の読み）

- 使用率: `context_used_ratio`、または `context_tokens ÷ context_window_tokens`。無い時は帯 `unknown`（source=estimated）。
- 帯: 0.95 以上 `require`、0.90 以上 `recommend`、0.80 以上 `warn`、0.70 以上 `prepare`、それ未満 `ok`。
- `action`: モード off → `off`、pack_only → `pack_update_needed`、`runtime_context_error` か `require` → `restart_required`、決定の食い違いあり・`recommend`・確かさ 0.55 未満 → `restart_recommended`、ほかは `pack_update_needed`。
- `can_auto_restart` は `auto_restart` を頼み、かつ妨げ（`aun_installed`・`aun_absence_not_confirmed`・`supervisor_or_host_hook_unavailable`・`restart_lifecycle_not_preauthorized`）が 0 の時だけ true。
- 出力の主な鍵: `action`・`continuity_guard_mode`・`can_auto_restart`・`auto_restart_blockers`・`pack_ref`・`recovery_confidence`・`context_signal{source,usage_ratio,band}`・`provenance`・`notes`。
- `wasurezu-restart preflight`: 作り直しの command を確かめる。許す bin は `wasurezu-claude-start`・`wasurezu-codex-start`・`wasurezu-restart` か絶対 path。shell の制御文字・相対 path を断る（src/restart-command-preflight.ts）。

## 5. 文脈の量の判定（src/context-window-resolution.ts。前回の読み）

- 前回の読みでは本番の呼び手が無かった。回転の入口（`src/session-rotation-stop.ts`）が文脈の量を測るようになった今の呼び手との関係は、今回確かめていない。
- `judgeContextHealth({measuredContextTokens, model, host, markerWindowTokens, env})` → `band`・`used_ratio`・`resolution_status`・`reason`・`restart_recommended`・`restart_required`。
- 窓の大きさの順: 環境変数 `AGENT_MEMORY_<HOST>_CONTEXT_WINDOW_TOKENS`／`AGENT_MEMORY_CONTEXT_WINDOW_TOKENS` → marker → model の表。表で 1 つに決まらない・測った量が窓を超える時は `unknown` と理由。
- Codex の測り: `measureCodexContextFromTranscriptLines(lines)`（src/codex-context-measurement.ts）。最後の `token_count` の `last_token_usage.input_tokens` と `model_context_window` を使う。

## 6. 主な環境変数

保存先に関わる変数の使われ方（どの部品が読むか）は「8. 保存先の決め方」が持ち主。この表は名前の索引。

| 変数 | 使う所 |
|---|---|
| `AGENT_MEMORY_AGENT_ID`・`AGENT_MEMORY_PROJECT` | 席と案件（全部） |
| `AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`DATABASE_URL`・`AGENT_MEMORY_DB_PATH` | 保存先の決め方（8 を参照）。`~/.agent-memory/config.json` の `database_url` も一部の部品が読む |
| `AGENT_MEMORY_HOME` | 回転の記録の置き場（`src/session-rotation-files.ts:127-128`）と hook の診断の置き場。保存先は決めない |
| `AGENT_MEMORY_WORKSPACE`・`AGENT_MEMORY_BINDING_SOURCE_REF` | hook の束縛の既定 |
| `KUSABI_RUNTIME_EVENT_TARGET_JSON` | 起動の出来事の目標（emitter、今回読んだ事実） |
| `AGENT_MEMORY_BOOT_MODE`・`AGENT_MEMORY_SELECTED_PACK_REF`・`AGENT_MEMORY_CLAUDE_HOOK_JSON`・`AGENT_MEMORY_STARTUP_BRIDGE` | src/boot.ts で準備した束を使う（前回の読み） |
| `AGENT_MEMORY_CLAUDE_BIN`・`AGENT_MEMORY_BOOT_JS`・`AGENT_MEMORY_CODEX_BIN`・`AGENT_MEMORY_WASUREZU_ENTRYPOINT` | launcher（前回の読み） |
| `WASUREZU_RESTART_COMMAND`・`AGENT_MEMORY_RESTART_COMMAND`・`WASUREZU_RESTART_PREAUTHORIZED` | `wasurezu-restart preflight`（前回の読み） |
| `AGENT_MEMORY_<HOST>_CONTEXT_WINDOW_TOKENS`・`AGENT_MEMORY_CONTEXT_WINDOW_TOKENS` | 窓の大きさの上書き（前回の読み） |
| `CLAUDE_PROJECTS_DIR`・`CODEX_SESSIONS_DIR`・`CODEX_HOME` | transcript の置き場（前回の読み） |
| `AGENT_MEMORY_DISABLE_EMBEDDINGS`・`VOYAGE_API_KEY` | 外の埋め込みの有無（前回の読み） |
| `AGENT_MEMORY_KUSABI_INTERNAL_OPT_IN` ほか `AGENT_MEMORY_EXPECTED_*` | 社内の 1 席の身元の確かめ（src/codex-start.ts、前回の読み） |
| `KUSABI_OBS03_POSTGRES_URL` | emitter の試験が実体の PostgreSQL を使う時だけ（src/test-kusabi-runtime-event-emitter.ts） |

設定 file `~/.agent-memory/config.json` の項目の名前（値は読んでいない）: `database_url`・`agent_id`・`default_project`。読む部品は 8 を参照。

## 7. 形の決まった成果物（前回の読み）

- `recovery-pack/v1`・`host-invocation-context/v1`: docs/design/schemas/ の JSON Schema で確かめる（src/artifact-schema-validator.ts、src/restart-pack.ts）。
- `kusabi-continuation-recovery-pack/v1`・`continuation-equivalent-state/v1`: 継続の印つきの束（src/kusabi-checkpoint-recovery.ts）。本番の MCP の道具と CLI からは作れない（`prepareRestart` の内部の引数だけ）。

## 8. 保存先の決め方（今回読んだ事実。新しい節）

呼ばれた process が自分で保存先を決める。部品は 4 つで、入力・順番・失敗の時の動きが違う。呼び出し元と、その呼び出し元がどの部品を使うかは dependencies.md「5. 保存先を決める部品の呼び出し元」。以降の file:行は origin/main `27d7f8fc` と byte が同じ file の行（今回の範囲の 43 本）。

| 観点 | `resolveStoreBackend` ＋ `createStore`（`src/stores/index.ts:35-100`） | `resolveCodexStoreBinding`（`src/codex-session-start.ts:305-387`） | `createQuietStore`（`src/kusabi-runtime-event-emitter.ts:514-546`） | post-tool-hook の読み込み（`src/post-tool-hook.ts:26-45`） |
|---|---|---|---|---|
| env の取り方 | `resolveStoreBackend(env = process.env)`。`createStore` は引数なしで呼ぶので常に `process.env`（55） | 引数 `env`（既定 `process.env`） | 引数 `env`（既定は emission の `options.env ?? process.env`。worker では `process.env`、462・617） | `process.env` を直接 |
| config file | 読まない | 読む。`~/.agent-memory/config.json` の `database_url` だけ（引数 `configPath` の既定、307） | 読まない | 読む。`database_url`・`agent_id`・`default_project`（28-36、49-50） |
| 種別 `AGENT_MEMORY_DB_TYPE` | `\|\| ""` を小文字に（36） | `?? ""` を小文字に（309） | `?? ""` を小文字に（516） | `\|\| ""` を小文字に（`DB_TYPE`） |
| URL の順 | `AGENT_MEMORY_DATABASE_URL \|\| DATABASE_URL`（37。空文字は次へ落ちる） | 同じ `\|\|`（324） | `AGENT_MEMORY_DATABASE_URL ?? DATABASE_URL`（517。空文字は次へ落ちない） | `DATABASE_URL` だけ。無ければ config の `database_url` を `DATABASE_URL` に入れる（`AGENT_MEMORY_DATABASE_URL` は見ない） |
| URL の形の判定 | `startsWith("postgres")`（38） | 正規表現 `/^postgres(?:ql)?:\/\//`（`postgresUrl`、278）。env の URL も config の URL も当てる | `startsWith("postgres")`（518） | 判定なし |
| 順番 | json → sqlite → （postgres 指定 または postgres の URL）→ 既定 SQLite | sqlite・json（env の証拠）→ 他の非空の種別は例外 → env の URL → config → 既定 SQLite | json は例外 → sqlite → （postgres 指定 または URL）→ 既定 SQLite | env の `DATABASE_URL` → config の `database_url`。種別が sqlite・json なら URL は要らない |
| 知らない種別（例 `mysql`） | 黙って既定 SQLite（URL が postgres で始まれば postgres）。`src/test-handoff-source-cli.ts` の T17(p) が `{AGENT_MEMORY_DB_TYPE:"mysql"}`→sqlite を表明している | 例外 `HookDegradedError("RECOVERY_UNAVAILABLE")`（320-321）。env の URL が postgres(ql):// でない時も同じ例外（326） | 黙って既定 SQLite（URL が postgres で始まれば postgres） | 種別が sqlite・json 以外なら URL を要求し、無ければ exit 0（43-46） |
| postgres 指定で URL が無い | 例外（43-47、文言 `requires AGENT_MEMORY_DATABASE_URL or DATABASE_URL`） | config が無い（ENOENT）時は例外（341-351）、config に `database_url` が無い時も例外（377） | 例外 `KUSABI_RUNTIME_EVENT_STORE_UNAVAILABLE`（523） | stderr に出して `exit(0)`（44-46） |
| json | `new JsonStore()`（63） | 証拠 `json`（env の出所） | 例外 `KUSABI_RUNTIME_EVENT_JSON_FIXTURE_ONLY`（520） | `needsUrl` が false なので `createStore` に任せる |
| config の URL が postgres でない | （config は読まない） | 例外（377） | （config は読まない） | 判定なし。`DATABASE_URL` に入れて `createStore` に渡る。postgres で始まらなければ既定 SQLite |
| config が壊れている・symlink・非 file | （config は読まない） | 例外（symlink と非 file は 353-354、parse の失敗と非 object は 359-364） | （config は読まない） | 黙って `{}` として進む（`loadConfig` の catch、32-34） |
| 失敗の時の動き | PG の接続が失敗したら再 throw。SQLite に逃げない（75-80） | 例外を hook が受けて degraded を返し、終了コード 0。store は開かない | 開けない・時間切れ・drift は緊急の 1 行（`store_unavailable`・`backend_drift`・`binding_drift`）か `failed`。別の保存先には逃げない | `exit(0)` で何もせず終わる |
| 副作用 | 無し（SQLite・JSON は開くと folder と file を作る） | config の URL を採った時だけ `env.AGENT_MEMORY_DATABASE_URL = configUrl`（378）。値は証拠に出さない | 無し | config の URL を採った時だけ `process.env.DATABASE_URL` に書く（38-40） |
| PG の表の変更 | `skipPostgresMigrations` が true の時は流さない（72） | 開かない | 常に流さない（`run_migrations: false`、536） | 呼び先の `createStore` が skip を true にする |

### 表の補い

- 既定の SQLite の path は `AGENT_MEMORY_DB_PATH`、無ければ `~/.agent-memory/memory.db`（`resolveSqliteDbPath`、`src/stores/sqlite-store.ts:57-58`、`??` なので空文字はそのまま path になる）。証拠の `localStoreBindingSha256` は同じ値を `AGENT_MEMORY_DB_PATH || defaultPath` で数える（`src/codex-session-start.ts:288-296`、`||` は 296、空文字は既定に落ちる）。
- JSON の folder は `~/.agent-memory`（`DEFAULT_DATA_DIR`、`src/stores/json-store.ts:54`）。`createStore` は folder を引数に取らない。
- 読み取り専用の読み手 `readTaskStatesReadOnly`（`src/stores/read-only-task-states.ts:62`）は `resolveStoreBackend(env)` と `resolveSqliteDbPath(undefined, env)` を使う（63・66）ので、`createStore` と同じ決め方に従う。config は読まない。store を開かず、PostgreSQL は READ ONLY の 1 回、SQLite は file の byte を読むだけで、file が無い時は例外（120）。
- `src/stores/index.ts:25-34` の doc comment が「選び方の順（4 段）」を書き、`resolveStoreBackend` を「The one place this is decided」と呼ぶ。表の 4 つの部品は、この文と同じ答えになる保証をコードでは持たない。
- 読み取り元の env の名前: `AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`DATABASE_URL`・`AGENT_MEMORY_DB_PATH`。席の身元の既定には `AGENT_MEMORY_AGENT_ID`・`AGENT_MEMORY_PROJECT`・`AGENT_MEMORY_WORKSPACE`・`AGENT_MEMORY_BINDING_SOURCE_REF`、emission の目標には `KUSABI_RUNTIME_EVENT_TARGET_JSON`。値は読んでいない。

### createQuietStore の補い

- `resolveStoreBackend`・`createStore`・`resolveCodexStoreBinding` のどれも呼ばず、`SqliteStore`・`PgStore` を直接作る（521-525）。決めるための入力は env の `AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`DATABASE_URL` だけ。
- PG は `initialize({ run_migrations: false })`（536）で、接続の確かめは残る。SQLite は `initialize()`（既定の path を作りうる）。
- 失敗: 開く途中の例外は `emitPreparedEvent` の catch が受け、`store_unavailable` の緊急の 1 行を書いて返す（464-472）。開いた後に `store.backend` が目標と違えば `backend_drift`（486-491）。開く前にも、SessionStart の証拠の `backend_intent` と目標の `storage.backend`、`binding_sha256` と目標の値を比べ、違えば `backend_drift`・`binding_drift`（436-456）。
- worker の子 process は `{ ...process.env, ...options.env }` を受ける（358-359）。emission は SessionStart が回復の結果を出した後に起こるので、`resolveCodexStoreBinding` が `process.env` に書いた URL を子が受け継ぐ。時間の枠は 500 ms（23）。
