# 健全性の確かめの報告 — 会話の切り直し（261110-session-rotation）

`operation/deployment-pipeline/` の `cd-config.md` と `deployment-strategy.md` に沿った配備の途中（S0〜S4 と C2 が済み、C2 は期待を満たさず、S5 以後が止まっている）の健全性。環境の一覧（environment-inventory）は無い取り組み（express）。試験の結果（`construction/build-and-test/` の `test-results.md`、build-test-results）は、コードの側の確かめ。

## 今の時点の状態

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
| 見張りの動作 | 記録（`watcher-ledger.jsonl`）に新しい周回の行が出る。停止の印で止まる | S6 で確かめる（未実施） |
| 切り直し | 席が手すきの時だけ起動し直しが起き、新しい session id の会話が続きを受け取る | S7 で確かめる（未実施） |
| 圧縮との前後 | 閾値 240000 で、窓 300000 の圧縮より先に切り直しが来たか | S7 で記録する（未実施） |

## 未確認で、次の会話が確かめること

- parser の直し（Code Generation の Step 16。arc の判断は agent-memory#339 の comment 6791901034）の後に、新しい版で S3・S4 をやり直し、席を起こし直して C2 を取り直す（SessionStart の証拠が `input_valid: true`、`auto_receive.status` と `store_binding` が読める事）。
- 席の対話の起動での Stop・UserPromptSubmit の実際の入力（今は `-p` の probe の key の組）。
- 見張りの設定・起動・停止（S5・S6）と、切り直しの実測（S7）。直しの後。
