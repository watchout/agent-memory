# 部品の一覧 — Kusabi（agent-memory）

部品の受け持ちと依存はここが持ち主。ファイルの置き場は code-structure.md、口の形は api-documentation.md、呼び出し元の表は dependencies.md を参照。各見出しの「読み」は読み方の記録: 取り組み 261113-store-resolution-fix（2026-11-15）で深く読んだ部品だけが reverse-engineering-timestamp.md の範囲の記録（`analyzed.components`）に入る。「前回の読み」と付けた文は 2026-11-10 の読み（取り組み 261110-session-rotation、commit a4a4d1e）のままで、今回は確かめていない。

## 保存先の決め方

- 読み: 今回深く読んだ（新しい部品）
- 受け持ち: 呼ばれた process が、自分で「どの DB を開くか」を決める働き。決める部品は 4 つあり、入力・順番・失敗の時の動きがそれぞれ違う。読み取り専用の読み手が 1 つ、その 1 つ目に従う。
  1. `resolveStoreBackend`＋`createStore`（env だけ。`createStore` は env を引数に取らず `process.env` を読む）
  2. `resolveCodexStoreBinding`（env に加えて `~/.agent-memory/config.json` の `database_url` を読み、採った URL を `process.env.AGENT_MEMORY_DATABASE_URL` に書く）
  3. emitter の `createQuietStore`（env だけ。`createStore` を通らず `SqliteStore`・`PgStore` を直接作る）
  4. `post-tool-hook` の config の読み込み（`DATABASE_URL` にだけ書く）
  - 読み手 `readTaskStatesReadOnly` は 1 つ目の `resolveStoreBackend(env)` に従い、config は読まない。
- 入力・順番・失敗の時の動きの表: api-documentation.md「8. 保存先の決め方」。呼び出し元の表: dependencies.md「5. 保存先を決める部品の呼び出し元」。環境変数と config の項目の名前: api-documentation.md の 8 と 6。
- 主なファイル: src/stores/index.ts（`resolveStoreBackend`・`createStore`）、src/stores/read-only-task-states.ts、src/stores/sqlite-store.ts（`resolveSqliteDbPath`、浅く）、src/codex-session-start.ts（`resolveCodexStoreBinding`・`kusabiStoreBindingSha256`・`localStoreBindingSha256`）、src/kusabi-runtime-event-emitter.ts（`createQuietStore`）、src/post-tool-hook.ts
- 依存: 保存の層（開く先）、起動時の回復の口（`resolveCodexStoreBinding` を持つ）、席の実行の身元（emitter）
- 注意:
  - `createStore` の 16 の呼び出し元のうち config を通るのは 4 つの SessionStart だけ。その順序の依存（`resolveCodexStoreBinding` が先に `process.env` を書き換え、その後の `createStore` が env を読む）はコードの中の規則として明記されていない。
  - 既定の SQLite を開くと、無ければ folder と空の DB file を作る（`src/stores/sqlite-store.ts:368-373`、446）。
  - PostgreSQL の接続に失敗した時は再 throw で、SQLite に逃げない（`src/stores/index.ts:75-80`）。

## MCP サーバー

- 読み: 前回の読み（深く）。今回は store を開く 1 行だけ（`src/index.ts:53` が `createStoreReadiness(() => createStore({ skipPostgresMigrations: true }))`。前回の文の「MCP の起動は表の変更を流す」は、この行と合わない。流すのは launcher・restart-cli・fleet-status）
- 受け持ち（前回の読み）: 17 個の道具を stdio で出す。process の環境変数から `agent_id`・`project`・`session_id` を決める。呼び出しを `~/.agent-memory/calls.log` に書く。`recover_context` の後の 10 分の窓の間に書く道具が呼ばれたら「続けた」と `recovery_quality_log` に印を付ける（`RecoveryContinuationTracker`）。
- 主なファイル: src/index.ts、src/recovery-quality.ts
- 依存: 回復の文と束、再起動の準備と判定、会話の記録の取り込み（Claude Code・Codex）、保存の層、保存先の決め方、MCP SDK、zod

## 起動時の回復の口（Claude Code・Codex）

- 読み: 今回深く読んだのは src/codex-session-start.ts。src/claude-session-start.ts は保存を開く前後（270-420）と grep、src/boot.ts は保存を開く前後だけ
- 受け持ち: 各 CLI の SessionStart（`startup`・`resume`・`clear`・`compact`）で呼ばれ、入力と workspace を確かめ、その会話の transcript を取り込み、DB から回復の束を作って `additionalContext` で返す。上限は 1,800 token・8,192 byte・内部 7 秒。失敗しても起動は続ける。Claude Code の口は入力を Codex の形に直して Codex の口の処理を使う。旧来の src/boot.ts は環境変数 `AGENT_MEMORY_BOOT_MODE=restart_pack` の時だけ、準備した束を consume する。boot.ts は 7 日より古い進行中の作業を期限切れにし、`~/.claude/rules/` に印の説明を置く（前回の読み）。
- 保存を開く所（今回読んだ事実）:
  - Claude Code: `loadClaudeRecoveryFromStore` の先頭で `resolveCodexStoreBinding()`（`src/claude-session-start.ts:317`）、続けて `createStore({ skipPostgresMigrations: true })`（318）。
  - Codex: 同じ 2 つの呼び出し（`src/codex-session-start.ts:832-833`）。
  - `src/boot.ts:41` は `createStore` だけ（config は読まない、`skipPostgresMigrations: true`）。
  - 証拠の `store_binding`・`binding_sha256`・`backend_intent` を持つのは SessionStart の証拠だけ（`src/codex-session-start.ts:125、723、812、881`、`src/claude-session-start.ts:385`）。
- 回答を書いた後の処理: 回転の受け取りの確定（`rotation-commit`）を呼ぶ（Codex は `src/codex-session-start.ts:1085、1091`、Claude Code は `src/claude-session-start.ts:566`）。「会話の切り直しの Stop 側と起動時の受け取り」を参照。
- 主なファイル: src/claude-session-start.ts、src/codex-session-start.ts、src/boot.ts
- 依存: 会話の記録の取り込み（Claude Code・Codex）、回復の文と束、保存の層、保存先の決め方、席の実行の身元（証拠の出来事）、会話の切り直しの Stop 側と起動時の受け取り

## 起動時の回復の口（Gemini・Antigravity）

- 読み: 浅く見た（冒頭と定数。今回は保存を開く前後だけ）
- 受け持ち: Gemini CLI（`startup`・`resume`・`clear`）と Antigravity CLI（Pre/PostInvocation）の同じ働き。Codex の口の型と関数を借りる。
- 保存を開く所（今回読んだ事実）: どちらも `resolveCodexStoreBinding()` の後に `createStore`（`src/gemini-session-start.ts:502-503`、`src/antigravity-session-start.ts:213-214`）。`rotation-commit` は呼ばない。
- 主なファイル: src/gemini-session-start.ts、src/antigravity-session-start.ts

## 会話の記録の取り込み（Claude Code・Codex）

- 読み: 今回深く読んだのは src/transcript-stop-capture.ts。取り込みの処理（ingest の 2 file と session-start-auto-receive）は前回の読み
- 受け持ち: host が渡した transcript だけを読む（ディレクトリを探し回らない）。symlink・置き換わり・大きすぎを断り、session_id と cwd がその会話の物かを確かめる。Claude Code・Codex の行から、system・developer の指示と隠れた推論を外し、秘匿処理をして `raw_events` と `conversation_events` に書く。Stop と UserPromptSubmit の hook は末尾 4 MiB、SessionStart は 8 MiB まで。重複は `getRawEvents`（1,000 件まで）で確かめる。手動の道具 `ingest_conversation_events` は過去 24 時間の file を探して取り込む（前回の読み）。
- 保存を開く所（今回読んだ事実）: src/transcript-stop-capture.ts:225 が `createStore({ skipPostgresMigrations: true })`。`resolveCodexStoreBinding` を呼ばず、config を読まない。証拠 `wasurezu-transcript-stop-capture/v1` には `store_binding`・`binding_sha256`・`backend` の項目が無い。
- 主なファイル: src/transcript-stop-capture.ts、src/session-start-auto-receive.ts、src/claude-conversation-ingest.ts、src/codex-conversation-ingest.ts
- 依存: 保存の層、保存先の決め方、秘匿処理、src/raw-capture-coverage.ts

## 会話の記録の取り込み（Gemini・Antigravity）

- 読み: 浅く見た
- 主なファイル: src/gemini-conversation-ingest.ts、src/antigravity-conversation-ingest.ts

## hook の設置（Claude Code・Codex）

- 読み: 今回深く読んだのは src/claude-hook-installer.ts（100-629）。src/codex-hook-installer.ts は command の組み立てと Stop の組（170-320）と grep
- 受け持ち: `<workspace>/.claude/settings.json`（Claude Code）・`<workspace>/.codex/hooks.json`（Codex）に、SessionStart・Stop・UserPromptSubmit の 3 つの組を置く。Kusabi の handler だけを見分けて差し替え、ほかは残す。書く前に控えを取り、一時 file から rename する。信頼（trust）の操作と「最初の文脈に届いた」の確かめはしない（Codex は hooks の画面で人が信頼する）。
- command の形（今回読んだ事実）: 席・案件・作業場・参照・上限の引数だけで、環境変数の接頭辞も保存先の引数も無い。installer は「byte で同じ形」の command だけを自分の物と見分け、env の接頭辞や追加の引数がある command は自分の物と見分けられずそのまま残る。形の詳細は api-documentation.md「3. hook の入出力」の「command の形」。
- 回転の Stop の組は `buildRotationHookGroup`（`src/rotation-hook-registration.ts:61`）が作り、2 つの installer が同じ関数で Stop と UserPromptSubmit の両方に置く（`src/claude-hook-installer.ts:389、427-428`、`src/codex-hook-installer.ts:428-429`）。置くのは installer に `--rotation on` を渡した時だけ（opt-in。渡さなければ既にある物をそのままにし、`--rotation off` で外す、`src/rotation-hook-registration.ts:2-8`）。transcript の取り込みの組は常に置く。
- `post-tool-hook` は 2 つの installer のどちらも登録しない（`PostToolUse` の語が 3 つの installer の file に無い）。
- 主なファイル: src/claude-hook-installer.ts、src/codex-hook-installer.ts、src/rotation-hook-registration.ts（浅く）
- 依存: 起動時の回復の口（Claude Code・Codex）の定数、src/transcript-stop-capture.ts の定数、会話の切り直しの Stop 側と起動時の受け取り

## hook の設置（Gemini・Antigravity）

- 読み: 浅く見た
- 受け持ち: `.gemini/settings.json`・`.agents/hooks.json` に置く。
- 主なファイル: src/gemini-hook-installer.ts、src/antigravity-hook-installer.ts

## 会話の切り直しの Stop 側と起動時の受け取り

- 読み: 今回深く読んだ（新しい部品。PR #341 で入った物）。src/session-rotation-stop.ts は 1-160 と 296-759（160-296 は未読）、src/rotation-commit.ts は全体。ほかの回転の file は開いていない
- 受け持ち:
  - Stop・UserPromptSubmit の回転の入口（src/session-rotation-stop.ts）: 文脈の量を測り、閾値を超えたら席に引き継ぎを 1 回頼み、その引き継ぎを Kusabi の DB に保存し、その後で「切ってよい」の印（marker の file）を出す。キーを送らず、tmux に触れず、外の API を呼ばない。核の判定は時刻を引数で受ける（標準 S4）。transcript-stop-capture の「同期の相棒」で、こちらは `async` の指定が無く、installer に `--rotation on` を渡した席にだけ置かれる。store は保存すると決めた時だけ `withStore`（546）で開く。
  - SessionStart の回答の後の確定（src/rotation-commit.ts）: 回答を stdout に書いた後で「書いた」の記録を作り、その後で 1 回だけの束を consume する。consume は戻せないので最後の段で、先に出してはいけない事実が disk にある時だけ動く。時刻・経過・hook の上限は呼び手が渡す。例外を投げず、結果は試験のために返す。store は `openDefaultStore`（43、`createStore({ skipPostgresMigrations: true })`）。
- 保存先との関係（今回読んだ事実）: 2 つとも `resolveCodexStoreBinding` を呼ばず、config を読まない。`rotation-commit` が config の URL を受けるのは、同じ process の SessionStart が先に `process.env` を書き換えているから。
- 主なファイル: src/session-rotation-stop.ts、src/rotation-commit.ts。名前だけ（開いていない）: src/session-rotation-files.ts、src/session-rotation-start.ts、src/session-rotation-usage.ts、src/rotation-hook-registration.ts
- 依存: 保存の層、保存先の決め方、起動時の回復の口（Claude Code・Codex）（`CODEX_SESSION_START_INTERNAL_TIMEOUT_MS` と束縛の型を借りる）、会話の記録の取り込み（Claude Code・Codex）（`session-start-auto-receive` の関数）、hook の設置（Claude Code・Codex）

## 回復の文と束

- 読み: 前回の読み（深く。src/restart-pack.ts の形の確かめの関数は浅く）
- 受け持ち: 記録を件数の上限つきで読み（`loadRecoveryContext`）、回復の文（`buildRecoveryOutput`）と回復の束（`buildRestartPack`、`recovery-pack/v1`、`host-invocation-context/v1`）を作る。束は「今の目的・作業・次の一手・妨げ・決定・file・PR・知識・最近の会話」の順で、token の上限で切る。作業の印が 12 時間より古いと注意を付ける。足りない物（`missing_context`）から確かさを出す。
- 主なファイル: src/recovery-context.ts、src/restart-pack.ts、src/constants.ts、src/continuity-analysis.ts
- 依存: 保存の層、秘匿処理、src/artifact-schema-validator.ts

## 再起動の準備と判定

- 読み: 前回の読み（深く）
- 受け持ち: 使用率の帯と確かさから `action` を決め、1 回だけ使える束を `selected_restart_packs` に置く。自動の作り直しの妨げを数える。作り直しの command を確かめる。Claude Code の「作り直しが要る」の marker を読み、準備だけをする（実行しない）。
- 保存を開く所（今回読んだ事実）: `src/restart-cli.ts:291` が `createStore()`（option を渡さないので PostgreSQL の表の変更を流す）。`src/restart-cli.ts:249` の handoff-source は読み取り専用の読み手を使う。
- 主なファイル: src/restart-prepare.ts、src/restart-cli.ts、src/restart-command-preflight.ts、src/claude-marker-controller.ts
- 依存: 回復の文と束、継続の印、保存の層、保存先の決め方
- 注意（前回の読み）: src/claude-marker-controller.ts は試験からだけ呼ばれる

## 文脈の量の測定

- 読み: 前回の読み（深く）
- 受け持ち: model ごとの窓の大きさの表と、環境変数・marker での上書きから窓を決め、測った量を帯にする。Codex の rollout の transcript から今の量と host の報せる窓を読む。
- 主なファイル: src/context-window-resolution.ts、src/codex-context-measurement.ts
- 依存: なし（純粋な関数）
- 注意（前回の読み）: 本番の呼び手は無い（src/test.ts だけ）。Claude Code の量の読み取りは無い。表の Codex の model（`gpt-5.6-sol`）は空で、表だけでは決まらない。PR #341 の後（回転の入口が文脈の量を測る）もこの 2 module が呼ばれないかは、今回確かめていない。

## 新しい会話の起動

- 読み: 前回の読み（深く）
- 受け持ち: Claude Code: 準備をして、条件がそろう時だけ新しい `claude` を起こす。`--fresh-session` は `--settings` で SessionStart に dist/boot.js を付け、準備した束を使う。Codex: 起動の文を作り、`--launch` は引数で、`--fresh-session` は `codex exec --json -` に stdin で渡す。MCP の束縛を `codex mcp get --json` で読み戻して確かめる。どちらも今の会話を kill しない。tmux の helper は `/exit` を送ってから新しい tmux の会話を起こす。
- 保存を開く所（今回読んだ事実）: `src/claude-start.ts:379`・`src/codex-start.ts:261` が `createStore()`（option なし、表の変更を流す）。config は読まない。
- 主なファイル: src/claude-start.ts、src/codex-start.ts、scripts/host-adapters/（4 本）
- 依存: 再起動の準備と判定、回復の文と束、保存の層、保存先の決め方、席の実行の身元
- 注意（前回の読み）: 既定の path が作業者の home の下の別の checkout（`~/Developer/agent-memory`）に固定されている

## 保存の層

- 読み: 今回深く読んだのは src/stores/index.ts と src/stores/read-only-task-states.ts（保存先の選び方と読み取り専用の読み手）。実装 3 つは保存先を決める所だけ浅く（sqlite-store の `resolveSqliteDbPath`・constructor・`initialize()` の冒頭、pg-store の constructor と `initialize()`、json-store の定数と constructor）
- 受け持ち: Store の interface と実装 3 つ（PostgreSQL・SQLite・JSON）。表は `decisions`・`task_states`・`knowledge`・`recovery_config`・`recovery_quality_log`・`task_state_migration_archive`・`conversation_events`・`raw_events`・`kusabi_runtime_events`・`selected_restart_packs`・`kusabi_agent_memory_partitions`（前回の読み）。`catch_up_log` は SQLite だけ（PostgreSQL は TODO AM-026、前回の読み）。PostgreSQL の表の変更は `createStore` の option `skipPostgresMigrations` が true の時だけ流さない（`src/stores/index.ts:72`）。流さない呼び出しは SessionStart・Stop・MCP・boot・emitter、流す呼び出しは launcher・restart-cli・fleet-status（dependencies.md の表）。
- 開く時の副作用（今回読んだ事実）: SQLite は無ければ folder と空の DB file を作る。JSON の store は folder を作る。PostgreSQL は `initialize()` が接続を確かめ、接続の失敗は再 throw（SQLite に逃げない）。読み取り専用の読み手は、SQLite の file が無ければ例外で、file を作らない。
- 主なファイル: src/stores/*（12 file、一覧は code-structure.md）
- 依存: pg、sql.js、uuid、意味検索

## 意味検索

- 読み: 前回の読み（浅く）
- 受け持ち: PostgreSQL の時、決定・作業・知識の文を Voyage AI に送って埋め込みを受ける。鍵は環境変数か `~/.agent-com-api-keys`。`AGENT_MEMORY_DISABLE_EMBEDDINGS=1` で止まる。
- 主なファイル: src/stores/voyage.ts

## 継続の印

- 読み: 前回の読み（浅く。型と consume の関数だけ）
- 受け持ち: 作業・決定・repo の head・外への効果の状態を digest つきで固めた束を作り、consume の時に確かめる。完了した効果は再実行しない方針を持つ。
- 主なファイル: src/kusabi-checkpoint-recovery.ts

## 新しい会話の群れの試し

- 読み: 前回の読み（浅く。起動の関数だけ）
- 受け持ち: 固定の 12 席に、1 席ずつ新しい process（`codex exec`・`claude -p`）を起こし、続きの目的と次の一手を返させて照らす試し。
- 主なファイル: src/kusabi-fresh-session-fleet.ts、scripts/kusabi-fresh-session-fleet.sh

## 運用の観測と展開

- 読み: 前回の読み（浅く）。今回は store の構築の行だけ（`src/kusabi-fleet-status-cli.ts:54` が `createStore()`、`src/fleet-conversation-backfill.ts:264` が `new PgStore(options.database_url)`、`src/measure-kusabi-functional.ts`・`src/kusabi-continuity-interruption-e2e.ts` が試験用の store を直接作る）
- 主なファイル: src/kusabi-fleet-rollout.ts、src/kusabi-direct-fleet-rollout.ts、src/kusabi-fleet-status.ts、src/kusabi-fleet-status-cli.ts、src/kusabi-one-seat-canary.ts、src/continuity-alpha-evaluator.ts、src/continuity-alpha-canary.ts、src/kusabi-functional-evaluator.ts、src/measure-kusabi-functional.ts、src/company-dev-os-recovery-target-audit.ts、src/raw-capture-service.ts、src/fleet-conversation-backfill.ts、src/kusabi-direct-db-gate.ts、src/kusabi-continuity-interruption-e2e.ts

## 席の実行の身元

- 読み: 今回深く読んだのは起動の出来事の emitter（src/kusabi-runtime-event-emitter.ts の 1-130、200-794）とその試験（src/test-kusabi-runtime-event-emitter.ts）。src/kusabi-runtime-identity.ts と src/kusabi-runtime-event-store.ts は開いていない
- 受け持ち: 起動の身元（席・案件・host・adapter・commit・設定の digest）を組み立てて確かめる（前回の読み）。起動の出来事を `kusabi_runtime_events` に残す。
- emitter の動き（今回読んだ事実）:
  - 4 つの SessionStart（claude・codex・gemini・antigravity）だけが呼ぶ。Stop 側は呼ばない。
  - 子 process（worker）に `{ ...process.env, ...options.env }` を渡す。時間の枠は 500 ms。
  - store は自前の `createQuietStore`（env だけで決める。`createStore` を通らない）。PostgreSQL の表の変更は常に流さない（`run_migrations: false`）。
  - 開く前に、SessionStart の証拠の `backend_intent`・`binding_sha256` と目標の値を比べ、違えば `backend_drift`・`binding_drift` の緊急の 1 行を書く。開けない時は `store_unavailable`。ほかの保存先には逃げない。
  - 試験（src/test-kusabi-runtime-event-emitter.ts）が確かめる物（`assert` の並びから読んだ）: 無効の時の `disabled`、目標の読み取り、manifest の食い違いと不正な目標が `target_invalid` の緊急の 1 行になること、3 つの host（codex・claude_code・gemini_cli）の出来事が別の `event_id` になること、時間切れの理由、SQLite の保存が重複しても 1 件であること、PostgreSQL の目標で `storage.backend` が `postgres` になること（偽の store。環境変数 `KUSABI_OBS03_POSTGRES_URL` がある時だけ実体の PostgreSQL でも流す）、`backend_drift`・`binding_drift` の時に store を作らないこと、`store_unavailable`・`store_write_failed`・両方失敗の `failed`、時間切れの後に来た store へ保存せず閉じること、worker の時間切れ、壊れた入力が `failed` になること。
  - 保存先の選び方に関わる試験は 1 つだけ: CLI の試験（`src/test-kusabi-runtime-event-emitter.ts` の 466-498 付近）が codex・claude・gemini の SessionStart を、同じ SQLite の DB（`AGENT_MEMORY_DB_TYPE=sqlite` と `AGENT_MEMORY_DB_PATH`）に向けて起こし、`session_start` の記録がその 1 つの DB に 3 件入ることを見る。env だけで、config.json と Stop の hook は含まない。この試験は CI で回らない（code-quality-assessment.md）。
- 主なファイル: src/kusabi-runtime-identity.ts、src/kusabi-runtime-event-emitter.ts、src/kusabi-runtime-event-store.ts
- 依存: 保存の層、保存先の決め方（3 つ目の写しを持つ）

## 秘匿処理

- 読み: 前回の読み（浅く）
- 受け持ち: 鍵・token・資格情報・DB の URL・電話番号らしい文字列を伏せる。道具の応答から壊れた文字を除く。
- 主なファイル: src/redact.ts、src/sanitize.ts

## 区画の登録と記録の読み出し

- 読み: 前回の読み（浅く）
- 主なファイル: src/kusabi-partitions.ts、src/memory-source.ts、src/stores/knowledge-scope.ts

## 印の拾い上げ

- 読み: 今回深く読んだのは src/post-tool-hook.ts（全体）。src/catch-up.ts・src/ensure-tags.ts・scripts/post-tool-hook.sh・templates/memory-tags.md は前回の読み（浅く）
- 受け持ち: 送った文の `[TASK:start]`・`[DECISION]`・`[KNOWLEDGE]` などの印を PostToolUse の hook で拾って記録にする。取りこぼしを Claude Code の記録から後で拾う。
- 保存先との関係（今回読んだ事実）: 自前で `~/.agent-memory/config.json` を読み（`database_url`・`agent_id`・`default_project`）、`database_url` を `process.env.DATABASE_URL` にだけ入れる（`AGENT_MEMORY_DATABASE_URL` は見ない）。壊れた config は黙って `{}` として進む。保存先が postgres 以外の種別なら URL は要らない。URL が要るのに無ければ stderr に出して終了コード 0。その後 `createStore({ skipPostgresMigrations: true })`（275・296）。この hook を登録する場所は今回確かめていない（2 つの installer は登録しない）。
- 主なファイル: src/post-tool-hook.ts、scripts/post-tool-hook.sh、src/catch-up.ts、src/ensure-tags.ts、templates/memory-tags.md
- 依存: 保存の層、保存先の決め方

## 社内の門の道具

- 読み: 前回の読み（浅く）。今回は `.github/workflows/shirube-rapid-lite-gates-report.yml` の冒頭 60 行と step の名前だけ
- 受け持ち: PR ごとの Shirube の門（Rapid/Lite）の判定と、作業の引き渡しの記録。
- 主なファイル: .shirube/runtime/rapid-lite/*、.shirube/control-handoffs/*、.github/workflows/shirube-rapid-lite-gates-report.yml
