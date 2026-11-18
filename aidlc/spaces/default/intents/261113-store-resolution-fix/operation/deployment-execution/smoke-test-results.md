# 配った後の確かめ（smoke test）の結果（取り組み 261113-store-resolution-fix）

この記録は、R1（Kusabi 自身の 2 席）へ版 `eb9bf298…` を配った後の確かめを、1 行ずつ、結果（一致・不一致・観測できず）と出どころ（観測 = 席が読んで確かめた物、写し = arc が写した宣言）で書く。席は版の置き場・本番の DB・tmux に触れておらず、確かめはすべて読むだけ。経過と hash の全体は `deployment-log.md`、配った後の様子の読みは `health-check-report.md`。**観測できずを成功に数えない**（S5）。

## 1. 確かめの一覧

時点は 2026-11-18T21:02Z〜21:06Z（席が読んだ時刻。数は、この時点の値）。

| # | 確かめること | 結果 | 出どころ | 根拠 |
|---|---|---|---|---|
| S-01 | 統合した版が main にある | 一致 | 観測 | PR #347 は統合済み（merge commit `fa9f3a2f…`、base `27d7f8f…`）。main と `fa9f3a2f…` の差は 0（GitHub の compare で identical） |
| S-02 | 2 席の設定 file が、新しい版を指す | 一致 | 観測 | A・B とも、Kusabi の hook 5 つ中 5 つが `eb9bf298…`、旧い版 `5fd29e06…` は 0。新しい版の識別子の 64 桁は、記録の RELEASE_SHA と publish の log の記述子（arc の写し）と同じ |
| S-03 | 差し替えが版の識別子の置き換えだけである | 一致 | 観測 | backup の識別子だけを置き換えた物の SHA-256 が、いまの file と同じ（A = `38006e55…`、B = `692950e6…`）。独立の相手（install4.sh が書いた直後に記録した hash）も、arc の写し（6991634288）が同じ値を引く |
| S-04 | hook が 5 つずつあり、event が想定のとおり | 一致 | 観測 | A = UserPromptSubmit 2・SessionStart 1・Stop 2。B = SessionStart 1・Stop 2・UserPromptSubmit 2。どちらも、記録の「hook 5 つ・handler 5 つ」と合う |
| S-05 | 実行する node が実在し動く | 一致 | 観測 | `/opt/homebrew/bin/node` は実行できる（`v26.13.1`。arc の戻しの試験の出力も同じ版）。`project.md` の決まり（command が指す node の実在） |
| S-06 | 閾値が決めたとおり | 一致（限り付き） | 観測 | A の command 群に `240000`、B に `200000` が現れ、相手の数は現れない。引数の名前は確かめていない |
| S-07 | 版の公開が読み戻しまで通った | 一致 | 写し | `publish.sh` の log: `PASS_EXACT_READBACK`、記述子 `eb9bf298…`（arc の記録 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6943446661 、SHA-256 `979fd9fd…`）。席は log も版の置き場も見ていない |
| S-08 | 版の置き場の中身（`dist/*.js`・`release.json`）が揃う | 観測できず | — | 席は版の置き場に触れない（Q1 = A）。S-07 の写しに依る。戻しの試験の出力（arc の写し）は、前の版 `5fd29e06…` の `dist` の 3 file が置き場にあることを引くが、新しい版は引いていない |
| S-09 | 本番の DB に 4 表と列の名前がある | 一致 | 写し | `prodcheck.sh` の log: 4 表で 11/11・21/21・11/11・11/11、「名前だけ。値は読んでいない」（同じ記録 6943446661）。11-16 の時点。席は DB を読んでいない |
| S-10 | Claude の席の process が差し替えの後に起動した | 一致 | 観測 | 起動 11-16 08:39:06Z（`ps`）は、設定 file の書き換え 08:20:38Z より後 |
| S-11 | Claude の席で Kusabi の 2 つの Stop の hook が動き、host の側に誤りが出ていない | 一致（限り付き） | 観測 | この会話の記録に、起動の後の Stop の run 記録が 7 件あり、各件に「Checking context volume with Wasurezu」と「Saving conversation with Wasurezu」の 2 hook の行がある。誤り（`hookErrors`）は 0、続行の阻止（`preventedContinuation`）は 0。**限り**: 記録に出るのは hook の表示名と所要時間だけで、版も保存先も出ない。拒否の回も、host を止めず「続ける」を返す作り（`deployment-strategy.md` の 3）なので、誤り 0 は、保存が成功した証拠にならない |
| S-12 | 最初の Stop の証拠が期待と一致（`store_backend`・`store_source`・`store_refused` 0 件） | 観測できず | — | 期待は A・B とも backend = postgres・source = user_config（arc の記録 6943475955、SHA-256 `5a42d79d…`）。証拠は hook の stderr に出るだけで残らない（code を読んだ事実）。Q3 の答え = B により、観測 1 は「観測できず」 |
| S-13 | Stop が保存した引き継ぎを、同じ保存先から `restart-cli` で読み戻せる | 観測できず | — | Owner が打つ script の出力待ち（Q4 = A。Owner の決定 6943524026）。script はまだ無い |
| S-14 | 保存先の DB に繋がる（接続の道が通る） | 観測できず | — | S-13 の script の出力待ち。arc は、Kusabi の保存先の設定が TCP の loopback を指すと書く（道の種類と DB 名だけを読んだ） |
| S-15 | Codex の席が新しい設定で動く | 観測できず | 写し | arc の記録 6943475955: Codex の席は動いておらず、差し替えの後に一度も起動していない。席は tmux に触れていない |
| S-16 | Claude の席の切り直し（回転）の Stop | 観測できず | 写し | まだ起きていない（arc の答え。閾値 240000 に届いていない） |
| S-17 | 戻しが効く（使い捨ての写し） | 一致（写し） | 写し | arc の記録 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6991634288 （SHA-256 `7e7c9cf1…`）: A・B とも byte まで戻る。限り: 席を起こし直して hook が動くことは試していない。実物の戻しは試していない |

## 2. 集計と、読み方

- **一致 11 行**（全 17 行を表から数えた）: S-01〜S-07（S-06 は限り付き）・S-09・S-10・S-11（限り付き）・S-17。うち、席が自分で観測した物は S-01〜S-06・S-10・S-11 の 8 行、arc の写しに依る物は S-07・S-09・S-17 の 3 行（S-03 は観測に写しの照らしを足した行）。
- **観測できず 6 行**: S-08・S-12〜S-16。
- **不一致 0 行**。

件数は、この表の行を数えた値で、観測を重ねると変わる（時点は 21:06Z）。

## 3. 差し替えの確かめとして足りないところ

- 保存先が合っているかを直接見る行（S-12・S-13・S-14）が、3 つとも「観測できず」。前の段の Q1 = B の定義では、R1 の判定は満たされていない。R2 に進む判断を Owner に伺う材料は、まだ無い。
- S-11 は「動いている」ことの弱い確かめで、「正しい保存先に書いた」ことは言えない。特に、2026-11-17 10:49〜15:23 JST の間、TCP の loopback が拒まれていた（arc の記録 6940564525）ので、その窓の保存の成否は、この表では分からない（`health-check-report.md` の 4）。
