# 健全性の確かめの報告 — 会話の切り直し（261110-session-rotation）

`operation/deployment-pipeline/` の `cd-config.md` と `deployment-strategy.md` に沿った配備の途中（S0〜S4 と C2 が済み、C2 は期待を満たさず、S5 以後が止まっている）の健全性。環境の一覧（environment-inventory）は無い取り組み（express）。試験の結果（`construction/build-and-test/` の `test-results.md`、build-test-results）は、コードの側の確かめ。

## 第 4 回の C2 の状態（2026-11-12、本番の DB の migration の後、席を起こし直した最初の会話）

| 見る物 | 状態 | 根拠 |
|---|---|---|
| Kusabi の SessionStart の結果 | **続きが渡った**（推論）。`RECOVERY_UNAVAILABLE`・`MALFORMED_HOOK_INPUT` は消えた。`outcome` は **`full` と記録**（hook の証拠の値そのものは見ていない） | 続きの案内が SessionStart で届いた。degraded の出力は `additionalContext` を持たない（コード）。`EVIDENCE_LOG_UNAVAILABLE` を作る箇所は 1 つで、必ず `systemMessage` を出す（コード）。arc が読んだ画面の履歴に、11:22 の起動より後の `SessionStart:startup says:` の行は 0 件。全文は `issue-339-readback-c2-retake-4.md` |
| 入力の受理（`input_valid`） | true と読める（推論。値は見ていない）。SessionStart の新しい名前 `prompt_id` を無視して受理 | 診断の記録の SessionStart が 11:22:42 に更新（parse が通った時だけ書く） |
| `auto_receive.status` | **値は観測できず。arc の判断で、届いた事実の観測に置き換えた**（pack ref 11:22:42.288 JST と診断の記録 11:22:42.333 JST の一致）。証拠の JSON は stderr だけで、席に見える file が無い。品質ログの 1 行を READ ONLY で読む案は、席の柵（auto mode の判定「Production Reads」）が拒否した | `issue-339-readback-c2-retake-4.md`、外れは `cd-config.md`。C2（第 4 回）は合格と記録（条件を 1 つ置き換えた合格） |
| `store_binding` の値 | **別の道の観測**: arc が `user_config`／`postgres`／`verified: true` を取った（hook の証拠の値ではない。席は見ていない） | arc の連絡（DB の migration の script の出力） |
| `forbidden_effects` | **実測ではない**（0 を返す定数。S5 で扱う） | コード（`forbiddenEffects()`） |
| 取り込み（Stop 系） | Stop の新しい key（`background_tasks`・`effort`・`prompt_id`・`scratchpad_dir`・`session_crons`）は受理されている（6 件。5 件はこの会話より前の会話、6 件目は 11:28:59 JST のこの会話の最初の応答の後）。DB に行が入るかは未取得 | 診断の記録（落とした名前 0・不正な名前 0） |
| 席の hook の版・node | 5 つとも新しい版 `28596bf0…` と `/opt/homebrew/bin/node`（v26.12.1、実行できる）。settings.json の SHA-256 は変わらない | 設定の読み戻し |
| Claude Code の版（FR10.5） | `claude --version` = `2.1.321 (Claude Code)`。契約を確かめた版 `2.1.220`（`adapter.host_contract_version`）より新しく、**ずれあり**（第 3 回と同じ版） | 席が流した |
| DB・見張り・切り直し | この会話では DB に繋がず、書き込み 0。S5〜S7 は起こしていない | `deployment-log.md` の第 4 回の C2 |

## 第 4 回の状態（2026-11-12、本番の DB の migration の後。C2 の取り直しの前）

| 見る物 | 状態 | 根拠 |
|---|---|---|
| 本番の DB の構造 | **不足 0**。足したのは `knowledge.memory_scope`（`text`・NULL 可）と、空の表 `task_state_migration_archive` の 2 つだけ。行は 1 つも動いていない（`raw_events` 914,265・`task_states` 17,354・`knowledge` 4,819・`decisions` 758 のまま） | Owner の実行（決定 `OD-KUSABI-PROD-DB-APPLY-PENDING-MIGRATION-MEMORY-SCOPE-20261112-001`）と、席の READ ONLY の読み戻し。`deployment-log.md` の第 4 回 |
| 復旧の読み出し（`loadRestartPackData`） | 通る（active 2・decisions 5・knowledge 5・conversation 8）。第 3 回の `42703` の原因は消えた | 席の読み戻し |
| Kusabi の SessionStart の結果 | **未確認**。席を起こし直して取り直すまで、`RECOVERY_UNAVAILABLE` が消えたとは言わない | C2 は arc が席を起こし直した後 |
| 取り込み（Stop 系）・切り直しの判定 | 第 3 回のまま未判定 | 最初の応答が終わった後に取り直す |
| 引き継ぎの bundle の消費の順番 | 要対処のまま（S7 の前に直す） | 第 3 回の行 |
| 戻し方 | 足した列と空の表の削除。`rollback-runbook.md` への追記は記録の PR に含める | 決定の本文 |

## 第 3 回の状態（2026-11-12、差し替えと席の起こし直しの後。C2 の取り直し）

| 見る物 | 状態 | 根拠 |
|---|---|---|
| 席の hook の版 | Kusabi の hook 5 つがすべて新しい版 `28596bf0…cd92` を指す。前の版を指す hook は 0。先頭は `/opt/homebrew/bin/node`（実在し動いた）。`--check` は exact | `deployment-log.md` の第 3 回、`issue-339-readback-c2-retake.md` |
| Kusabi の SessionStart の入力の受理 | **合格**。`input_valid: true`。`session_title`・`scratchpad_dir` を無視して受理（落とした名前 0・不正な名前 0） | SessionStart の証拠、診断の記録 |
| Kusabi の SessionStart の結果 | **劣化**: `RECOVERY_UNAVAILABLE`。通常の起動は続く（会話は使える）。続きは渡せない | 証拠 `degraded_reason`、`delivery.emission_status: not_emitted` |
| 原因 | 本番の DB の `knowledge` 表に `memory_scope` の列が無く、復旧の読み出しが `42703` で落ちる。入力の問題ではない | 読み取りだけの再現と情報スキーマの確認。DB の構造の変更は保護面で、Owner の判断を待っている |
| 取り込み（Stop・UserPromptSubmit の hook） | 入力の受理は取れた（UserPromptSubmit の 2 つ）。Stop の入力と、取り込みが DB に行を入れるかは未判定（`conversation_events` の kusabi は 16,583 行、この会話の開始以降の増加は 0） | 最初の応答が終わった後に取り直す |
| Claude Code の版（FR10.5） | `claude --version` = `2.1.321 (Claude Code)`。契約を確かめた版 `2.1.220`（`adapter.host_contract_version`）より新しく、**ずれあり** | 席が流した |
| 引き継ぎの bundle の消費の順番 | 要対処: 消費が復旧の読み出しの前にあり、後段が落ちると引き継ぎが渡されないまま消費される。S7 の前に直す | `issue-339-readback-c2-retake.md` の「設計上の気になる点」 |
| DB | 構造・書き込みは変更 0。読み取りだけ（SELECT） | `deployment-log.md` の第 3 回の効果の一覧 |
| 見張り（S5・S6）・切り直し（S7） | 起こしていない（C2 が合うまで） | 同上 |

## 第 1 回の時点の状態（C2 の最初の取り直しの前）

| 見る物 | 状態 | 根拠 |
|---|---|---|
| 席 `aidlc-kusabi` | arc が S3・S4 の後に起こし直した。動いている（この会話が席）。AI-DLC の hook は整合性の誤りなく動く | `deployment-log.md` の C2 の節。席の設定の変更は、この会話では 0 |
| 席の Kusabi の SessionStart | **劣化**: `MALFORMED_HOOK_INPUT` で続きを渡せない。通常の起動は続く（会話は使える） | 証拠 `degraded_reason`、`delivery.emission_status: not_emitted`。原因は Claude Code 2.1.321 の入力に増えた `session_title`（再現済み） |
| 席の Stop・UserPromptSubmit の取り込みと切り直しの hook | **評価されていない可能性が高い**: 起動して通すだけ。取り込みも切り直しの判定も行われない（probe の key の組では `prompt_id`・`session_title`・`background_tasks`・`effort`・`session_crons` を拒否）。席の実際の入力は未取得 | 版の parser への再現。`deployment-log.md` の「確かめていないこと」 |
| 新しい版 | 公開済み・読み戻し合格 | `deployment-log.md` の S1 |
| 古い取り込みの常駐 | 止めて無効にした。落ち続ける状態は終わった | S2 の読み戻し。誤りの記録は 110,355,058 byte で増えない |
| DB | 触っていない。変わっていない | どの段も DB の URL を渡していない |
| 取り込み（`conversation_events`・`raw_events`）の件数 | 0 件のまま（止めても直らない。案 B・C は決定の範囲外） | O4。S7 の「引き継ぎの保存」は別の経路（task_states と restart pack）で確かめる |
| 登録された作業場の既存の取り込みの hook | 存在しない node の版を指しており、起動できない状態（取り込みが 0 件の原因の候補。確かめたのは存在だけ） | agent-memory#339 の comment 6790957409。直すのは案 B の範囲で、今は直さない |
| 登録された作業場の Claude の席 | 同じ理由で落ちる可能性がある（版の parser が同じ。`transcript-stop-capture.js` を持つ版 2 つはどちらも新しい key を知らない）。実際にその席で落ちているかは取り直していない | `deployment-log.md` の「確かめていないこと」。直すのは案 B の範囲 |
| backup の扱い | `.claude/settings.json.bak*` が git に無視されていない（3 つ）。`git add -A` では PR に載る | `git check-ignore`。直しは Step 16 の PR の 1 行 |

## 健全性の指標と、確かめの方法

自社が管理できる範囲の指標だけを使う（project の決まり）。

| 指標 | 見方 | 判定 |
|---|---|---|
| 誤りの記録の増加 | file の大きさが増えない | 止めた後は増えていない（合格） |
| hook の node の実在 | 設定の hook の command の先頭の node が実在し実行できる | 合格（実在し、SessionStart の hook がその node で動いた） |
| AI-DLC の hook の健全 | 最初の人手の起動で整合性の誤りを出さない | 合格（終了 0、stderr 空、案内が届いた） |
| Kusabi の SessionStart の入力の受理 | 証拠が `input_valid: true`、`auto_receive.status` と `store_binding` が出る | **不合格**（C2。`MALFORMED_HOOK_INPUT`） |
| host の版と、契約を確かめた版のずれ | 配備を行う席が手順の 1 行として `claude --version` を流し、この表に『観測した版と契約を確かめた版 2.1.220 のずれ』の 1 行を**必ず**書く。読めない時は『観測できず』と書き、ずれ無しと読まない。この 1 行を必ず書くことは agent-memory#339 の comment 6793417308（A3 の 2）が記録し、arc-sec の読み（iyasaka-arc#57 の comment 6792778481）も実装の PR で見る点に挙げている。この 1 行が無い配備の記録を完了としない手順と、実施者を配備を行う席にすることは作者の決め（GitHub の記録は無い）。code にしない | **記録済み（第 3 回、下の節）**: 観測した版 `2.1.321 (Claude Code)`、契約を確かめた版 `2.1.220` より新しい（ずれあり） |
| 診断の記録（知らない key の名前） | `session-rotation-status` の `hook_input` の節が名前と件数だけを出す。『記録なし』は『知らない key を見なかった』の証明ではないので、同じ session の SessionStart の証拠の `input_valid` と合わせて読む | **取れた（第 3 回、下の節）**: SessionStart と UserPromptSubmit の名前（`session_title`・`scratchpad_dir`・`prompt_id`）が出た。同じ session の SessionStart の証拠は `input_valid: true`。Stop の名前は、最初の応答が終わった後に取り直す |
| 見張りの動作 | 記録（`watcher-ledger.jsonl`）に新しい周回の行が出る。停止の印で止まる | S6 で確かめる（未実施） |
| 切り直し | 席が手すきの時だけ起動し直しが起き、新しい session id の会話が続きを受け取る | S7 で確かめる（未実施） |
| 圧縮との前後 | 閾値 240000 で、窓 300000 の圧縮より先に切り直しが来たか | S7 で記録する（未実施） |

## 未確認で、次の会話が確かめること

- parser の直し（Code Generation の Step 16。arc の判断は agent-memory#339 の comment 6791901034）の後に、新しい版で S3・S4 をやり直し、席を起こし直して C2 を取り直す（SessionStart の証拠が `input_valid: true`、`auto_receive.status` と `store_binding` が読める事）。
- 席の対話の起動での Stop・UserPromptSubmit の実際の入力（今は `-p` の probe の key の組）。
- 見張りの設定・起動・停止（S5・S6）と、切り直しの実測（S7）。直しの後。
