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
