<!-- kusabi-rotation-deploy-readback:c2-retake -->
## 配備の読み戻し — S3 の読み戻しと C2 の取り直し（第 2 回、席を起こし直した後の最初の会話）

取り組み 261110-session-rotation の Deployment Execution。決定の出どころ: Owner の決定 `OD-KUSABI-ROTATION-DEPLOY-SELF-SEAT-TRIAL-20261111-001`（iyasaka-arc#49 の comment 6790645694）。S3・S4 の差し替えは Owner が arc の script を打った（arc の記録 `OD-KUSABI-SELF-SEAT-HOOK-VERSION-SWAP-BY-OWNER-RUN-20261112-001`: iyasaka-arc#49 の comment 6811763971、本文 SHA-256 `35419f99736c5d62c00bf75da2c45f407724df520c3738c2b7992c37b0052e84`。席が GitHub の API が返す本文で数え直し、一致した。投稿者 watchout）。

この会話が行ったのは、読み取りと、使い捨ての SQLite・読み取りだけの SELECT による切り分けだけ。席の設定・DB への書き込み・作業場のコードは変えていない。S5・S6（見張り）は起こしていない。

### 結論

| 項目 | 結果 |
|---|---|
| S3 の読み戻し | 合格（下の表） |
| C2: 入力が読めている | **合格**。`hook.input_valid: true`。前回の `MALFORMED_HOOK_INPUT` は消えた |
| C2: AI-DLC の SessionStart の hook | 合格。整合性の誤りなし |
| C2: Kusabi の SessionStart の結果 | **不合格**。`outcome: degraded`／`degraded_reason: RECOVERY_UNAVAILABLE`。続きを渡せない |
| C2: 副作用 | 合格。`forbidden_effects` はすべて 0 |
| 原因 | 本番の DB の `knowledge` 表に **`memory_scope` の列が無い**（配備した版の読み出しが要求する）。入力の問題ではない |
| 引き継ぎが渡せるか | **渡せない**。DB の構造の変更は保護面で、Owner の決定を待っている。S5・S6 は起こさない |

`RECOVERY_UNAVAILABLE` は「引き継ぐ物が無い普通の起動」の形ではない。同じ版の hook を、使い捨ての空の SQLite で同じ形の入力（`session_title`・`scratchpad_dir` つき）に当てると `outcome: full`（「SPARSE DATA NOTICE」つきの案内）になる。

### S3 の読み戻し（席が取り直した）

| 項目 | 結果 |
|---|---|
| 権限の記録（#49 の comment 6811763971） | 本文 SHA-256 が上の値と一致 |
| settings.json の SHA-256 | `1e4646448a424a4588e6b467ed57382f6d3469bdc71097f699174f3291d807c4`（arc の記録の「後」と一致。読み取りの前後で変わらない） |
| Kusabi の hook | 5 つ（SessionStart 1・UserPromptSubmit 2・Stop 2）。**5 つとも新しい版 `28596bf0…cd92` を指す。前の版 `1b731f00…` を指す hook は 0** |
| 5 つの先頭の語 | すべて `/opt/homebrew/bin/node`（実在し、実際に動いた） |
| 無関係な hook | SessionStart 1・Stop 1・UserPromptSubmit 1（3・3）。他の event の hook は変わらない |
| `--check`（同じ引数、`--node-path /opt/homebrew/bin/node`、`--rotation on --rotation-threshold-tokens 240000`） | `config_match: exact`、`would_change: false`、`wrote_settings_file: false`、終了 0 |
| backup | `.claude/settings.json.bak*` が 4 つ。**この checkout では `.gitignore` が backup を無視していない**（`git check-ignore` で規則なし）。`origin/main` の `.gitignore`（24 行目 `.claude/settings.json.bak*`）には #342 で入っている。この checkout は #342 の前の位置なので、main を取り込めば無視される。席は PR に記録を入れる時に path を指定するので、今は PR に載らない |

### C2 の取り直し（`cd-config.md` の表の順）

| 見る物 | 期待 | 結果 |
|---|---|---|
| AI-DLC の SessionStart の hook | 終了 0、stderr 空、整合性の誤りなし | 合格（終了 0、476 ms、案内が `additionalContext` で届き、`orchestrate next` が進んだ） |
| Kusabi の SessionStart の結果 | `degraded`／`MALFORMED_HOOK_INPUT` でない。画面に `degraded` が出ない | **不合格**。画面の文は `Wasurezu startup recovery degraded (RECOVERY_UNAVAILABLE)`。ただし理由は前回と違い、入力ではない |
| 入力が読めている | `hook.input_valid: true`、`session_id`・`source`・`cwd_sha256` が null でない | **合格**。`input_valid: true`、`source: startup`、`session_id`・`cwd_sha256` あり。`identity.verified: true` |
| DB の結びつき | `store_binding` が `unknown` でない | 証拠は `source: unknown`／`backend_intent: unknown`／`verified: false`（失敗の時は結びつきを書かない作り）。結びつき自体は、同じ設定で取り直して読んだ値が `source: user_config`／`backend_intent: postgres`／`verified: true`。DB は同じ Mac の PostgreSQL（URL は書かない）。hook の process で DB に繋がるところまでは行っている（stderr に `Connected to PostgreSQL`） |
| 取り込みの経路 | `auto_receive.status` が証拠にある | **証拠に無い**（復旧の読み出しが落ちたので、その項目まで進まない）。O4（DB の指定が届かない）が原因ではない |
| 副作用 | `forbidden_effects` がすべて 0 | 合格（再起動・kill・TUI 書き込み・tmux send-keys・clipboard・AUN queue・session への注入、すべて 0） |
| 診断の記録（名前だけ） | `wasurezu-claude-session-start.json` ができ、名前・件数・時刻だけ。件数 32 以下・64 KiB 以下。file 0600、folder 0700 | **合格**。`kusabi-hook-input-diagnostics/v1`。SessionStart の名前は `session_title`・`scratchpad_dir` の 2 つ（各 1 件）。落とした名前 0・不正な名前 0。file の大きさは 546 byte、権限は file 0600・folder 0700 |
| Stop 系の入力 | Stop の後に `…transcript-stop.json`・`…rotation-stop.json` に Stop の新しい key の名前が出る。`malformed_input` でない | **一部だけ取れた**。UserPromptSubmit の 2 つの hook の診断の記録ができ、`prompt_id`・`scratchpad_dir`・`session_title` の 3 つを無視して受理した（診断の記録は parse が通った時だけ書く）。**Stop の入力は、この会話の最初の応答が終わるまで取れない**（次の入力で取り直す） |
| hook の node | 5 つの先頭が `/opt/homebrew/bin/node` で実在し実行できる | 合格（上の S3） |
| Claude Code の版（FR10.5） | `claude --version` を 1 行 | `2.1.321 (Claude Code)`。契約を確かめた版 `2.1.220`（`adapter.host_contract_version`）より新しく、ずれがある。証拠の契約にも診断の記録にも版は書かない |

発見: 前回の probe（`claude -p`）に出なかった key `scratchpad_dir` が、**対話の起動だけ**の入力（SessionStart・UserPromptSubmit）に入っていた。前回の「対話の起動だけの key が無いとは言い切れない」が当たっていた。直した parser は無視して受理しており、問題は出ていない。

### 原因（読み取りだけで特定した）

1. `claude-session-start` の復旧の読み込みは、store を開いた後、自動取り込み → 切り直しの準備 → 復旧パックの読み出し（`loadRestartPackData`）→ 組み立て → 品質ログの書き込み、の順に進む。この流れのどこで例外が出ても、`catch` が理由コード `RECOVERY_UNAVAILABLE` に丸め、**例外の中身は証拠にも stderr にも残らない**（品質ログの書き込みの失敗だけは内側で握られ、別の理由コード `EVIDENCE_LOG_UNAVAILABLE` になる）。
2. 同じ配備済みの版の関数を、hook と同じ条件（実 HOME の `user_config`、上限 1800 token・8192 byte）で段ごとに読み取りだけで流した結果: store を開くところまでは成功し、**`loadRestartPackData` が PostgreSQL の `42703: column "memory_scope" does not exist` で落ちる**。
3. 情報スキーマの読み取りで確認: 本番の `knowledge` 表の列は 15 個で `memory_scope` が無い。配備した版が持つ idempotent な migration 76 文（列の追加 31・表の作成 11）のうち、本番に無いのは **`knowledge.memory_scope`（列）と `task_state_migration_archive`（表）の 2 つだけ**。
4. `memory_scope` を足す migration（`ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS memory_scope TEXT`、NULL を許す）は commit `80f2273`（2026-10-05）で入った。復旧の読み出しは `project` があると `knowledge_scope: "project_and_seat"` で `knowledge` を読み、その条件が `memory_scope` を使う。hook は設計どおり `skipPostgresMigrations: true` で動く（hook が DB の構造を変えない）ので、列の無い本番に対する SELECT が失敗した。
5. もう 1 つの不足（表 `task_state_migration_archive`）の migration は、重複した `task_states` の行を DELETE して退避する文を含む。本番では一意索引 `uq_task_states_agent_task_id` が既にあり、その DELETE が触る行は **0 件**（`task_states` は 17,354 行、`task_id` が NULL の行 0）。流しても実際に起きるのは「空の表ができる」だけ。

### 実行前の確かめの訂正

`deployment-execution-questions.md` と `deployment-log.md` の実行前の確かめに、「DB の移行は要らない（この取り組みは DB を変えない）」と書いた。**これは足りなかった**: 取り組みが DB を変えなくても、配備する版（main から作った物）は、本番の DB にまだ入っていない構造（`knowledge.memory_scope`）を読む。確かめるべきだったのは「版が要求する DB の構造と、本番の DB の構造が合うか」で、第 1 回・第 2 回の実行前の確かめには入っていなかった。第 1 回の C2 は parse で落ちて DB に届かなかったため、今回まで表に出なかった。

### 【判断待ち】

- 内容: 本番の PostgreSQL に `knowledge.memory_scope` の列を足すか（DB の構造の変更。保護面）。これが入るまで、Kusabi の SessionStart は続きを渡せない（通常の起動は続く）。
- 選択肢（席は決めない）:
  - 1. 列だけを足す: `ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS memory_scope TEXT` を Owner の認可の下で 1 回流す。追加だけで、NULL を許し、古い code は無視する。戻しは `DROP COLUMN`（`rollback-runbook.md` に足す）。
  - 2. migration を全部流す（`npm run migrate`）: 上の列に加え、空の表 `task_state_migration_archive` ができる。データを動かす文はあるが、本番では 0 行を動かすだけ（上の 5）。
  - 3. DB は変えず、hook の側を直す（列が無い時に読み出しを諦めない）: 設計と実装を食い違わせる方向で、`recover_context` など他の経路は直らない。席の見立ては、構造が code に追いついていないのが根で、1 か 2 が筋。
- 影響: 続きが渡せない状態のまま。下の設計上の気になる点により、**この状態で S5・S6・S7 に進むと、切り直しの引き継ぎが渡されないまま消費される**。
- 現在の状態: 実装・配備を中断して待機中。席は DB の構造を変えない。S5・S6 は起こさない。

### 設計上の気になる点（次の取り組みで直す物。ここでは変えない）

`prepareRotationRecovery` は、切り直しの引き継ぎ（bundle）を `consumeSelectedRestartPack`（DB への書き込み）で**消費済みにしてから**返す。その後で `loadRestartPackData` が呼ばれる。コメントが守っているのは「消費の前の失敗」だけで、**消費の後の `loadRestartPackData`・組み立て・上限の適用が落ちると、引き継ぎの文は捨てられ、bundle は消費済みのまま**になる。今の本番の DB では、切り直しで起きる SessionStart は毎回これに当たる。直すなら、消費を最後にする（読み出しと組み立てが成功した後）か、失敗時に未消費へ戻す。設計の記録を先に直す。

### 確かめていないこと

- Stop の入力（最初の応答が終わるまで取れない）と、取り込み（`transcript-stop-capture`）が DB に行を入れるか。`conversation_events` の kusabi の行は 16,583（`codex` 16,565・`claude_code` 18）、この会話の開始以降の増加は 0、最新は 2026-09-21。Stop の後に取り直すまで、取り込みの成否は判定しない。
- 列を足した後に `outcome: full` になるか（足していないので未確認。空の SQLite では full になる）。
- `initialUserMessage` は S7 で確かめる（O5。arc の答え）。

### 効果の一覧（この会話）

| 効果 | 数 |
|---|---|
| 席の設定の変更 | 0（settings.json は読み取り前後で同じ SHA-256） |
| DB への書き込み・構造の変更 | 0（書いたのは使い捨ての SQLite だけ。作業場の外の一時の directory） |
| DB の読み取り | SELECT のみ（`loadRestartPackData` の読み出し、情報スキーマ、件数の集計）。結果は件数・列名だけで、中身・URL は出していない |
| 見張りの設定・起動 | 0 |
| 作業場のコードの変更 | 0 |
| 別の `claude` の起動 | 0 |
