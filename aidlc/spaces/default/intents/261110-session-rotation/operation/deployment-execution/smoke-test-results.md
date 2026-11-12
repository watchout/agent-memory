# 煙の試験の結果 — 会話の切り直し（261110-session-rotation）

`operation/deployment-pipeline/` の `cd-config.md`（S1 の読み戻し、S7 の表）と `deployment-strategy.md`（段ごとの関門）で決めた確かめのうち、今の時点で実施した物と、まだの物。環境の一覧（environment-inventory）は無い取り組み（express）。試験の結果（`construction/build-and-test/` の `test-results.md`、build-test-results）は、コードの試験が済んでいることを前提にしており、ここでは繰り返さない。

「未実施」は成功として数えない。

## 実施した確かめ（S0〜S2）

| 確かめ | 期待 | 結果 |
|---|---|---|
| 版の readback（S1） | `PASS_EXACT_READBACK` | 合格。版の SHA-256 `1b731f0091a93dd875f1903e1866f21b38eaf518fc39ac406819fec229fad784` |
| `release.json` の SHA-256 と directory 名 | 一致（arc の script の前の確かめの条件） | 一致。arc も別に確かめた |
| 切り直しの 2 つと installer が版の `dist/` に実在 | 通常の file、symlink でない | 3 つとも合格（SHA-256 は `deployment-log.md`） |
| `npm audit --omit=dev` | 0 件 | 0 件 |
| 作る場所が清潔 | `git status` が 0 行（作る前・後） | 合格 |
| 古い常駐が止まった（S2） | 読み込まれていない・無効・process なし | 合格（`Could not find service`、`disabled`） |
| 誤りの記録が増えない | 止めた直前と同じ大きさ | 合格（110,355,058 byte のまま） |

## S3・S4 の前の試し（arc が実施した。席は見ただけ）

arc の報告（私信。arc の判断で、Owner の言葉ではない）: S3・S4 の script を、本物の版と、席の `settings.json` の写しに対して流し、S3・S4 とも通った。dry-run は無関係な hook の数 3・3、差分は Kusabi の hook の追加だけ、`--check` は exact、hook の node は 26.12.1。script の SHA-256 は `83a146150b27013a2875f5dc6f2b5d7e757f6b98bd4f34bb024abfd14f08e448`（S1 の版の SHA-256 を入れた物。元の script との差分は 1 行）。本物の席の設定にはまだ書いていない。この試しは席が自分で再現したものではないため、本物の読み戻し（下の S3・S4）が通るまでは、期待が満たされた証拠として数えない。 本物の読み戻しは起こし直しの後に取り直した（下の表。S3・S4 の `--check` は exact）。

## S3 以後の確かめ（起こし直しの後に更新）

| 段 | 確かめ | 期待 | 状態 |
|---|---|---|---|
| S3 | script が書き込みの前に #49 へ投稿する記録の URL と SHA-256 | 読み戻しに添えられる | 合格。#49 6791486407、本文 SHA-256 `b2daee56…6732`。席が GitHub から取り直して数え直し、一致した（投稿者 watchout） |
| S3 | dry-run の数 | `would_change: true`、無関係な hook 3・3、`wrote_settings_file: false` | 合格（arc の script の log を読んだ。席は取り直していない） |
| S3 | apply の後の `diff -u <backup> <settings.json>` | Kusabi の hook の追加だけ | 合格（同上。log に差分の全文がある。席は取り直していない） |
| S3 | `--check` | exact | 合格。席が取り直した |
| S3 | hook の node の実在と実行 | 実在し `--version` が通る | 合格。実在し、SessionStart の hook がその node で JSON を返した |
| S3 | settings.json と backup が PR に載らない | 無視されている | **一部だけ**。settings.json は無視。backup 3 つは無視されていない（`??`）。次の PR で `.gitignore` に 1 行足す |
| S4 | dry-run の数、`diff -u`、`--check --rotation on --rotation-threshold-tokens 240000` | 切り直しの hook の追加だけ、exact | 合格（`--check` は席が取り直した。dry-run と差分は log を読んだ） |
| C2（AI-DLC） | 最初の人手の起動で整合性の誤りが出ない | 誤りなし | 合格。終了 0、stderr 空、案内が `additionalContext` で届いた |
| C2（Kusabi） | SessionStart の証拠（`auto_receive.status`・`store_binding`）が読める | 読める | **不合格**。`MALFORMED_HOOK_INPUT`、`input_valid: false`、`store_binding.source: unknown`、`auto_receive.status` は証拠に無い。原因は `session_title`（Claude Code 2.1.321 が足した key）。再現済み（`deployment-log.md` の C2 の節） |
| 追加 | Stop・UserPromptSubmit の取り込みと切り直しの hook の入力の parse | 受理される | **不合格（`-p` の probe の key の組で）**。UserPromptSubmit は `prompt_id`・`session_title`、Stop は `background_tasks`・`effort`・`prompt_id`・`session_crons` が許可リストに無く、デプロイ済みの parser が拒否する。席の実際の入力は未取得 |
| O5 | 新しい会話が initialUserMessage で続きを受け取る | 続きの案内が届く（見張りを使わず、人が起こし直して確かめる） | 未実施（SessionStart が入力を拒否する間は成り立たない。直しの後に取り直す） |
| S5 | `rotation-watcher probe` | tmux の版・pane の解決・入力欄の行が読める。登録の値と一致 | 起こさない（arc の指示。SessionStart の直しの後） |
| S6 | 見張りの起動と停止の確かめ | 窓が動く。`HALT` を置くと止まり、消すと再開する | 起こさない（同上） |
| S7（FR9.2） | 切り直しが 1 回起きる／続きが届く／引き継ぎの保存が DB から読み戻せる／圧縮より先に来たか／作業中は切らない／AI-DLC の hook も切れる事の記録 | `cd-config.md` の S7 の表のとおり | 未実施 |

## 第 3 回の確かめ（2026-11-12、差し替えと席の起こし直しの後。C2 の取り直し）

| 段 | 確かめ | 期待 | 状態 |
|---|---|---|---|
| S3 | #49 の権限の記録 6811763971 の本文 SHA-256 | `35419f99…2e84` と一致 | 合格。席が GitHub の API が返す本文で数え直した |
| S3 | settings.json の SHA-256 | `1e464644…07c4`（arc の記録の「後」） | 合格。読み取りの前後で変わらない |
| S3 | Kusabi の hook の数と版 | 5 つが新しい版 `28596bf0…`、前の版 `1b731f00…` は 0 | 合格 |
| S3 | 5 つの先頭の語 | `/opt/homebrew/bin/node` | 合格（実在し、実際に動いた） |
| S3 | 無関係な hook | SessionStart 1・Stop 1・UserPromptSubmit 1（3・3） | 合格 |
| S3 | `--check`（同じ引数、`--node-path`、`--rotation on --rotation-threshold-tokens 240000`） | exact、`would_change: false`、書き込み 0 | 合格 |
| S3 | backup が PR に載らない | 無視されている | **一部だけ**。`origin/main` の `.gitignore` は無視する（#342）。この checkout は #342 の前の位置で、backup 4 つは無視されていない |
| C2（AI-DLC） | 整合性の誤りが出ない | 誤りなし | 合格（終了 0、案内が届き、`orchestrate next` が進んだ） |
| C2（Kusabi） | 入力が読める | `input_valid: true` | **合格**。前回の `MALFORMED_HOOK_INPUT` は消えた |
| C2（Kusabi） | `outcome` が `degraded` でない | `full` 等 | **不合格**。`degraded`／`RECOVERY_UNAVAILABLE`。原因は本番の DB に `knowledge.memory_scope` が無いこと |
| C2（Kusabi） | `store_binding`・`auto_receive.status` が証拠にある | 読める | **不合格**（失敗の時は書かない作り。取り直した結びつきは `user_config`／`postgres`／`verified: true`） |
| C2（Kusabi） | `forbidden_effects` | すべて 0 | 合格 |
| C2（診断の記録） | 名前だけ、0600／0700、32 件以下・64 KiB 以下 | 満たす | 合格。新しい key `scratchpad_dir` を確認（対話の起動だけに入る） |
| C2（Stop 系） | Stop の入力・取り込みの証拠 | `malformed_input` でない | 未取得（最初の応答が終わった後に取り直す）。UserPromptSubmit の 2 つは受理を確認 |
| C2（FR10.5） | `claude --version` を 1 行 | 記録がある | 合格。`2.1.321 (Claude Code)`、契約を確かめた版 `2.1.220` よりずれあり |
| 切り分け | 同じ版の hook を使い捨ての空の SQLite で動かす | `RECOVERY_UNAVAILABLE` が「引き継ぐ物が無い普通の形」か | 否。`outcome: full`（SPARSE DATA NOTICE つきの案内）。入力は受理 |
| 切り分け | 実 HOME の結びつきで、復旧の読み出しを段ごとに（SELECT のみ） | 落ちる段が分かる | `loadRestartPackData` が `42703: column "memory_scope" does not exist` |
| 切り分け | 情報スキーマ（読み取り）と migration 76 文の突き合わせ | 不足が分かる | 不足は `knowledge.memory_scope`（列）と `task_state_migration_archive`（表）の 2 つだけ。後者の DELETE が触る行は 0 |
| S5 | `rotation-watcher probe` | 登録の値と一致 | 起こさない（C2 が合うまで） |
| S6 | 見張りの起動と停止の確かめ | 窓が動く。`HALT` で止まる | 起こさない（同上） |
| S7（FR9.2） | 切り直し | `cd-config.md` の S7 の表のとおり | 未実施。引き継ぎの bundle の消費の順番（読み出しの前に消費する）を直すまで起こさない |

## 第 4 回の確かめ（2026-11-12、Owner の判断「B」を受けた本番の DB の migration）

| 段 | 確かめ | 期待 | 状態 |
|---|---|---|---|
| 権限 | #49 の記録 6812189369 の本文 SHA-256 | `87e4e8b8…474efb` と一致 | 合格。席が GitHub の API が返す本文で数え直した |
| 当てる前 | 76 文を本番と突き合わせる（READ ONLY） | 不足が決定と同じ 2 つだけ。書き換える文の対象が 0 行 | 合格。不足は列 1・表 1、索引の不足 0、`vector` 導入済み。24・25・27・61・62・63 の対象は 0 行 |
| 当てる | 席から適用 | — | 席の柵が拒否（Production Deploy）。回避せず、Owner が端末で打つ形にした |
| 当てる（1 回目・最初の版） | 結びつきの解決 | `user_config`／`postgres` | **不合格**。arc の shell で `environment`／`sqlite`（呼び出し側の環境を信じた席の誤り）。何も当たっていない |
| 当てる（2 回目・2 番目の版） | `migrate.js` の接続 | 接続できる | **不合格**。`no PostgreSQL user name specified in startup packet`（子の環境から `USER` を落とした席の誤り）。何も当たっていない |
| 診断 | 子と同じ形の環境で `SELECT 1`（READ ONLY） | `USER` ありは接続、無しは失敗を再現 | 合格。ありは接続、無しは同じ誤りを再現 |
| 当てる（3 回目・最終の版 `ee918392…`） | Owner が `--apply` で打つ | exit 0、読み戻しが決定と一致 | 合格（arc 経由の写し）。`migrate.js` exit 0、`✅` 77 行、`readback_matches_decision` が ok |
| 読み戻し（席。READ ONLY） | 不足 0、`memory_scope` が `text`・NULL 可、表が 0 行、行数が前と同じ、`loadRestartPackData` が通る | 満たす | 合格。不足 0、`text`・NULL 可・既定なし、表 0 行、行数は 914,265／17,354／4,819／758 のまま、`loadRestartPackData` ok（active 2・decisions 5・knowledge 5・conversation 8） |
| C2 の取り直し | SessionStart の `outcome`・`store_binding`・`auto_receive.status` | `full` 等で、証拠に出る | **実施。一部だけ取れた**（下の「第 4 回の C2」） |
| S5・S6・S7 | — | — | 起こさない（C2 が合うまで。S7 は消費の順番の直しの後） |

## 第 4 回の C2（2026-11-12、本番の DB の migration の後、席を起こし直した最初の会話）

読み先は、この会話に hook が渡した SessionStart の結果と、hook が書いた診断の記録、設定、`claude --version`（会話の記録の jsonl と DB は読まない）。全文は `issue-339-readback-c2-retake-4.md`。

| 段 | 確かめ | 期待 | 状態 |
|---|---|---|---|
| C2（AI-DLC） | 整合性の誤りが出ない | 誤りなし | 合格（案内が届き、`orchestrate next` が進んだ） |
| C2（Kusabi） | `RECOVERY_UNAVAILABLE`・`MALFORMED_HOOK_INPUT` が出ない | 続きの案内が届く | **合格（推論）**。案内（`wasurezu-recovery-pack/v1`、`Confidence: medium`）が届いた。degraded の出力は `additionalContext` を持たない |
| C2（Kusabi） | 入力が読める | `input_valid: true` | true と読める（推論。診断の記録の SessionStart が 11:22:42 に更新。値は見ていない） |
| C2（Kusabi） | `outcome` が `full` | `full`（`EVIDENCE_LOG_UNAVAILABLE` でない） | **`full` と記録**（arc の画面の観測 + コード。hook の証拠の値そのものは見ていない） |
| C2（Kusabi） | `store_binding` の値 | 証拠にある | **別の道の観測**（arc が `user_config`／`postgres`／`verified: true` を取った。hook の証拠の値ではない。席は見ていない） |
| C2（Kusabi） | `auto_receive.status` | 証拠にある | **値は観測できず。arc の判断で、届いた事実の観測に置き換えた**（pack ref 11:22:42.288 JST と診断の記録 11:22:42.333 JST の一致）。証拠の JSON は stderr だけに出る。品質ログの 1 行を READ ONLY で読む案は席の柵（「Production Reads」）が拒否。外れは `cd-config.md`。C2（第 4 回）は合格と記録 |
| C2（Kusabi） | `forbidden_effects` | すべて 0 | **実測ではない**（0 を返す定数。S5 で扱う） |
| C2（診断の記録） | 名前だけ、0600／0700、32 件以下・64 KiB 以下 | 満たす | 合格（直接）。3 file、最大 1,631 byte、件数 3・8・8、落とした名前 0・不正な名前 0。SessionStart に `prompt_id` が新しく出た（1 件） |
| C2（Stop 系） | Stop の新しい key が受理されている | `malformed_input` でない | Stop 6 件が受理（直接。6 件目は 11:28:59 JST のこの会話の最初の応答の後）。DB に行が入るかは未判定（DB を読まない） |
| C2（hook の node） | 5 つの先頭が `/opt/homebrew/bin/node`、実在し実行できる | 満たす | 合格（直接）。新しい版 `28596bf0…`、v26.12.1。settings.json の SHA-256 は変わらない |
| C2（FR10.5） | `claude --version` を 1 行 | 記録がある | 合格。`2.1.321 (Claude Code)`、契約を確かめた版 `2.1.220` よりずれあり |
| S5・S6・S7 | — | — | 起こさない（観測できなかった 4 項目の扱いを arc が決めるまで。S7 は消費の順番の直しの後） |
