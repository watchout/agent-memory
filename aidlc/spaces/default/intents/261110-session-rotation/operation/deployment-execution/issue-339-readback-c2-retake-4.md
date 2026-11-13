<!-- kusabi-rotation-deploy-readback:c2-retake-4 -->
## 配備の読み戻し — 第 4 回の C2 の取り直し（本番の DB の migration の後、席を起こし直した最初の会話）

取り組み 261110-session-rotation の Deployment Execution。決定の出どころ: Owner の決定 `OD-KUSABI-ROTATION-DEPLOY-SELF-SEAT-TRIAL-20261111-001`（iyasaka-arc#49 の comment 6790645694）。本番の DB の migration は Owner の判断「kusabiはBで」の記録 `OD-KUSABI-PROD-DB-APPLY-PENDING-MIGRATION-MEMORY-SCOPE-20261112-001`（iyasaka-arc#49 の comment 6812189369、本文 SHA-256 `87e4e8b836b3388309e67253d09e7effdd5cfe3d1b136cb22699b4b672474efb`）の範囲で、Owner が端末で打った（`deployment-log.md` の第 4 回）。

この取り直しは arc が席を起こし直した後の最初の会話（arc の依頼は席間の連絡で、Owner の答えではない）。起こし直しの SessionStart は 11:22:42（JST）。読んだのは、この会話に hook が渡した SessionStart の結果と、hook が書いた診断の記録の 3 file、設定の file、`claude --version` だけ。会話の記録の jsonl は読んでいない。DB には繋いでいない。S5・S6・S7 は起こしていない。

追記（arc の読み先の判断。arc の判断で、Owner の言葉ではない）: 会話の記録の jsonl を script で読む案は取らない、と arc が決めた。代わりに (1) arc が tmux の画面の履歴を読み、11:22 の起動より後に `SessionStart:startup says:` の行が 0 件だったこと（前の起動には `Wasurezu startup recovery degraded (RECOVERY_UNAVAILABLE)` の行があり、同じ描き方）、(2) arc が 11:1x に同じ版の `resolveCodexStoreBinding` で同じ設定の file を読んで取った結びつきの値、を「arc の観測」として足した。(3) 品質ログの 1 行を READ ONLY の SELECT で読む案は、席の柵（auto mode の判定「Production Reads」）が拒否した。回避せず、再試行もしていない。この拒否は arc に代わりに流してもらうことでも解けないので、Owner の判断に回した。

### 結論

**C2（第 4 回）は合格と記録する。** ただし条件を 1 つ置き換えた合格: `auto_receive.status` の値は観測できておらず、arc の判断（Owner の言葉ではない）で「続きの案内が会話の文脈に実際に届いた」事実の観測に置き換えた（外れは `cd-config.md`）。値を観測したとは書かない。

| 項目 | 結果 |
|---|---|
| `RECOVERY_UNAVAILABLE` | **消えた**（推論。下の「根拠の種類」）。続きの案内が SessionStart で届いた |
| 入力が読めている（`hook.input_valid`） | **true と読める**（推論。値そのものは見ていない） |
| `outcome` が `full` か | **`full` と記録する**。根拠は arc の画面の観測（起動の後に `systemMessage` の行が 0 件）とコード（下の「`outcome` の根拠」）。hook の証拠の値そのものは見ていない |
| `store_binding` の値 | **別の道の観測**（arc が `user_config`／`postgres`／`verified: true` を取った。hook の証拠の値ではない）。席は見ていない |
| `auto_receive.status` | **観測できず**（値）。品質ログの 1 行を読む案は席の柵が拒否した。arc の判断（Owner の委任 #49 6762288830 の技術の範囲。Owner の言葉ではない）で、C2 の合格の条件から外し、「続きの案内が会話の文脈に実際に届いた」事実の観測（pack ref 11:22:42.288 JST と診断の記録の更新 11:22:42.333 JST の一致、差 45 ミリ秒）で置き換えた。外れは `cd-config.md` の C2 の表の直下 |
| `forbidden_effects` | **実測ではない**（0 を返す定数。S5 で扱う） |
| 診断の記録・設定・`claude --version` | 合格（直接読んだ） |

観測できなかった項目と、実測でない項目を、成功とは読まない。

### 根拠の種類

- **直接**: この会話に届いた物と、file の内容をそのまま読んだ物。
- **推論**: コードを読んで、届いた物から決まる事。
  - `degradedOutput` は `systemMessage` だけを返し、`hookSpecificOutput`（`additionalContext`）を持たない（`codex-session-start.ts`）。この会話には Kusabi の `additionalContext`（「WASUREZU NATIVE STARTUP RECOVERY」の案内。schema `wasurezu-recovery-pack/v1`、`Confidence: medium`、`Missing context: task_checkpoint_stale`）が届いた。したがって hook は成功の道を通っている。成功の道は `parseCodexSessionStartInput` と `verifyCodexHookWorkspace` を通った後にだけ入り、`input_valid` は `hookInput !== undefined`、`identity.verified` は workspace の確かめの後に立つ。
  - **`outcome` の根拠**（arc の画面の観測 + コード）: 成功の道でも `outcome` は 2 通り。品質ログの書き込みが失敗すると `degraded`／`EVIDENCE_LOG_UNAVAILABLE`。この理由コードを作る箇所は `codex-session-start.ts` の 1 か所だけ（`loaded.recovery_quality_log_ref === null` の時）で、その時は必ず `systemMessage`「Wasurezu recovery loaded, but evidence logging is unavailable; this run cannot count as alpha evidence.」を出力に足す。Claude 側の `transformOutput` はその `systemMessage` を残す（`Codex` を `Claude Code` に置き換えるだけ）。もう 1 つの `outcome: "degraded"` の箇所（catch の道と、起動の入口の `IDENTITY_BINDING_INVALID`）は `additionalContext` を出さない。arc が読んだ画面の履歴では、11:22 の起動より後に `SessionStart:startup says:` の行が 0 件で、前の起動の degraded の行と同じ描き方。したがって `systemMessage` は出ておらず、`full` と読める。席は画面を見ていない（arc の観測）ので、値そのものを見たとは書かない。
  - 案内の pack ref の時刻は 11:22:42（JST）で、診断の記録の SessionStart の更新時刻（`last_seen` 02:22:42Z）と一致する。この会話の起動の hook が組んだ案内。
- **観測できず**: 証拠の JSON（`hook`・`store_binding`・`auto_receive`・`forbidden_effects`・`outcome`）は、hook が stderr に書く（`claude-session-start.ts` の `write_evidence`）。runtime event の出力先は、この席の hook の引数に manifest が無いため無効。診断の記録は名前と件数だけで、これらの項目は入らない。第 3 回はこれを会話の記録の hook の結果から読んだが、今回は依頼で使わない。
- 補足: SessionStart の証拠の `forbidden_effects` は、`forbiddenEffects()` が 0 を固定で返す定数。読めたとしても実測ではなく、「宣言された値は証拠でない」（S5）に当たる。

### C2 の取り直し（`cd-config.md` の表の順）

| 見る物 | 期待 | 結果 |
|---|---|---|
| AI-DLC の SessionStart の hook | 終了 0、stderr が空、整合性の誤りなし | 合格（直接）。案内（`AIDLC WORKFLOW ACTIVE`）が届き、`orchestrate next` が進んだ。終了コードと stderr の欄は席に見えない |
| Kusabi の SessionStart の結果 | `degraded`／`MALFORMED_HOOK_INPUT` でない | 上の結論のとおり。`RECOVERY_UNAVAILABLE`・`MALFORMED_HOOK_INPUT` は否定（推論）。`outcome` は `full` と記録する（arc の画面の観測 + コード。hook の証拠の値そのものは見ていない） |
| 入力が読めている | `hook.input_valid: true`、`session_id`・`source`・`cwd_sha256` が null でない | true と読める（推論）。診断の記録の SessionStart が 11:22:42 に更新されており、診断は parse が通った時だけ書く（`on_ignored_names` は parse の後）。`session_id` などの値は見ていない |
| DB の結びつき | `store_binding` の `source`・`backend_intent` が `unknown` でない | **別の道の観測**（hook の証拠の値ではない）。arc が 11:1x に、同じ版の `resolveCodexStoreBinding` で同じ設定の file を読み、`source: user_config`・`backend_intent: postgres`・`verified: true`（`config_path_sha256` `1820c746…`・`binding_sha256` `a1330147…`）を観測した（DB の migration の script の出力。席は見ていない）。続きの案内の中身が本番の PostgreSQL から届いたこと（10 月の task_state を含み、最後の更新が 9 月 13 日の SQLite の `memory.db` には入り得ない。推論）と合う。hook がこの起動で実際に使った値は、証拠の JSON を読めていないので未確認 |
| 取り込みの経路 | `auto_receive.status` が証拠にある | **値は観測できず。arc の判断で、届いた事実の観測に置き換えた**（pack ref の時刻 11:22:42.288 JST と、診断の記録の SessionStart の更新時刻 11:22:42.333 JST が一致。差 45 ミリ秒）。品質ログの 1 行を READ ONLY の SELECT で読む案は、席の柵（auto mode の判定「Production Reads」）が拒否した。回避せず、再試行もしていない。Owner に端末で流してもらう案も取らなかった。外れの記入は `cd-config.md` |
| 副作用 | `forbidden_effects` がすべて 0 | **実測ではない**（0 を返す定数。読めても「宣言された値は証拠でない」。S5 で扱う） |
| 診断の記録（名前だけ） | `kusabi-hook-input-diagnostics/v1`、名前・事象・件数・時刻だけ、32 件以下・64 KiB 以下、file 0600・folder 0700 | 合格（直接）。下の表 |
| Stop 系の入力 | 最初の応答が終わった後に Stop の名前が出る。`malformed_input` でない | **取れた**（直接）。この会話の最初の応答の後（11:28:59 JST）に Stop が 6 件目として記録され、`transcript-stop`・`rotation-stop` の 2 つの adapter とも受理（落とした名前 0・不正な名前 0）。それ以前の会話の Stop 5 件も取れている（下の表） |
| hook の node | 5 つの先頭が `/opt/homebrew/bin/node` で実在し実行できる | 合格（直接）。Kusabi の hook は 5 つ（SessionStart 1・UserPromptSubmit 2・Stop 2）、すべて新しい版 `28596bf0…` を指す。`node --version` は v26.12.1。settings.json の SHA-256 は `1e4646448a424a4588e6b467ed57382f6d3469bdc71097f699174f3291d807c4`（第 3 回と同じ。変わっていない） |
| Claude Code の版（FR10.5） | `claude --version` を 1 行 | `2.1.321 (Claude Code)`。契約を確かめた版 `2.1.220`（`adapter.host_contract_version`）より新しく、**ずれあり**（第 3 回と同じ版）。証拠の契約にも診断の記録にも版は書かない |

### 診断の記録（直接。名前・件数・時刻だけ）

folder `<AGENT_MEMORY_HOME>/hook-input/kusabi/agent-memory/`（権限は `hook-input`・`kusabi`・`agent-memory` の 3 つの folder がすべて 0700、file が 0600）。3 file とも `kusabi-hook-input-diagnostics/v1`、`dropped_names: 0`、`invalid_names: 0`。

| file | 大きさ | 更新 | 事象と名前（件数） |
|---|---|---|---|
| `wasurezu-claude-session-start.json` | 729 byte | 11:22:42 | SessionStart: `session_title`（3）・`scratchpad_dir`（3）・`prompt_id`（1） |
| `wasurezu-claude-transcript-stop.json` | 1,631 byte | 11:23:09 | Stop: `background_tasks`・`effort`・`prompt_id`・`scratchpad_dir`・`session_crons`（各 5）。UserPromptSubmit: `prompt_id`・`scratchpad_dir`・`session_title`（各 6） |
| `wasurezu-claude-rotation-stop.json` | 1,629 byte | 11:23:09 | 上と同じ名前・件数 |

- 新しい名前: SessionStart の `prompt_id`（1 件、11:03:10（JST）の 1 回だけ。この会話の起動の入力には無い）。第 3 回の SessionStart は `session_title`・`scratchpad_dir` の 2 つだった。parser は無視して受理している。
- Stop の 5 件は 10:47:07 から 11:22:24（JST）で、この会話の起動（11:22:42）より前の会話のもの。Stop の診断は parse が通った時だけ書く（`transcript-stop-capture.ts` の `on_ignored_names` は parse の後）ので、Stop の新しい key（`background_tasks`・`effort`・`prompt_id`・`session_crons` ほか）は拒否されず受理されている。Stop の入力で取り込みが DB に行を入れたか（`conversation_events` の増減）は、DB を読んでいないので判定しない。
- UserPromptSubmit の最後の更新 11:23:09 は、この会話の最初の入力（arc の依頼）。
- 追記（この会話の最初の応答が終わった後に取り直した）: 2 つの Stop の file（`wasurezu-claude-transcript-stop.json`・`wasurezu-claude-rotation-stop.json`）は 11:28:59（JST）に更新され、Stop の 5 つの名前の件数が各 6 になった（最後の更新 02:28:59Z）。起動の 11:22:42 より後の Stop はこの 1 回だけなので、この会話の Stop。名前の組は変わらず、`dropped_names: 0`・`invalid_names: 0`。SessionStart の file は 11:22:42 のまま。

### 確かめていないこと

- `auto_receive.status` の値（観測できず。品質ログの 1 行を読む案は席の柵が拒否した。arc の判断で、届いた事実の観測に置き換えた。値を読むのは、S5 の見張りの probe を据える時に、その段の手順で改めて扱う）。
- hook がこの起動で使った `store_binding` の値（arc の別の道の観測だけ）と、SessionStart の `forbidden_effects` の実測（定数）。
- `outcome: full` は arc の画面の観測とコードによる記録で、hook の証拠の値そのものは見ていない。
- 取り込みが DB に行を入れるか（`conversation_events` の件数。DB を読んでいない）。
- `initialUserMessage` は S7 の実際の切り直しで確かめる（O5。arc の答え）。
- 引き継ぎの bundle の消費の順番（`prepareRotationRecovery`）は、第 3 回の「設計上の気になる点」のまま。S7 の前に直す。

### 効果の一覧（この会話）

| 効果 | 数 |
|---|---|
| 席の設定の変更 | 0（settings.json の SHA-256 は第 3 回と同じ） |
| DB への接続・書き込み・構造の変更 | 0（接続していない） |
| 見張りの設定・起動 | 0 |
| 作業場のコードの変更 | 0 |
| 別の `claude` の起動 | 0 |
| 書いた記録 | この file、`deployment-log.md`・`health-check-report.md`・`smoke-test-results.md`・`memory.md`（段の diary）の追記 |
