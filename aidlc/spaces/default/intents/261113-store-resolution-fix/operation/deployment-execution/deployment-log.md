# 配りの実行の記録（取り組み 261113-store-resolution-fix）

この記録は、統合された版 `fa9f3a2f16255d723b0cb96f0e77958035f7b11e`（PR #347 の merge commit）を、Kusabi 自身の 2 席（R1）へ配った実行の経過と結果を書く。配り（版の公開・本番の表と列の確認・席の hook の差し替え）は、Owner が arc の script を打って 2026-11-16 に行った。この席は何も実行しておらず、この段で席がしたのは、読むだけの観測（設定 file・GitHub の記録・この会話の記録・code）と、この記録を書くことだけ。手順と方式は `operation/deployment-pipeline/cd-config.md` と `deployment-strategy.md`、戻しは `rollback-runbook.md`、問いと答えは `deployment-execution-questions.md`。

入力にした記録: `cd-config`（`operation/deployment-pipeline/cd-config.md`）、`deployment-strategy`（同じ場所の `deployment-strategy.md`。戻しの `rollback-runbook.md` も）、`build-test-results`（`construction/build-and-test/test-results.md` と `build-and-test-summary.md`。BT-06 は持ち越し）。`environment-inventory` は**存在しない**: bugfix の scope は Environment Provisioning を行わず、配る先は AWS の環境でなく Kusabi 自身の 2 席なので、作らなかった（段の手順の Step 1。無い物を作らない）。

結果は 3 値（一致・不一致・観測できず）で書き、**観測できずを成功に数えない**（S5）。各行に、観測（席が file・GitHub・code を読んで確かめた物）か、写し（arc が Owner の log から写した宣言。席は元の log を見ていない）かを添える。

## 1. 結論

- **配った物（観測）**: 2 席の設定 file は、Kusabi の hook 5 つずつがすべて新しい版 `eb9bf298…` を指す。差し替えの前の file（installer の backup）の版の識別子だけを置き換えると、いまの file と byte 単位で一致した（2 席とも）。
- **版の公開・読み戻し・本番の表と列（写し）**: `PASS_EXACT_READBACK`、4 表すべてに列がある（arc が 11-16 の log から写した。席は版の置き場にも本番の DB にも触れておらず、元の log を見ていない）。
- **R1 の「合っている」の判定（Q1 = B）: 観測できず**。Stop の証拠は stderr に出るだけで残らず（Q3 の答えで観測 1 は「観測できず」）、引き継ぎの読み戻しは Owner が打つ script の出力待ち（Q4）。この 2 つが出るまで、R2 に進む判断を Owner に伺う材料は無い。
- **新しく分かった risk（観測できず、可能性）**: 2026-11-17 10:49〜15:23 JST に、この Mac の PostgreSQL が loopback の TCP を拒んでいた（arc の記録）。Kusabi の保存先の設定が TCP の loopback を指しているなら、その間の Stop の保存は失敗した可能性がある。欠けが後から補われるかは、`health-check-report.md` の 4 に書く。
- **戻しの試験（写し）**: arc が、使い捨ての写しで install4.sh の restore と同じ手順を当て、A・B とも入れる前の file に byte まで戻ることを確かめた（PASS。arc の記録 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6991634288 、本文の SHA-256 `7e7c9cf1ebf125224539848495fea78f5c911f772d3c197739bf389f85201d5f`、2026-11-18T21:06:13Z）。live の file には書いていない。限り: 席を起こし直して hook が動くことまでは試していない。
- 席が実行して変えた物: 無い（設定 file・版の置き場・DB・tmux に書いていない）。

## 2. 経過（時刻は UTC。JST は +9 時間）

| 時刻 | 出来事 | 出どころ |
|---|---|---|
| 2026-11-16 05:42:45 | PR #347 が main に統合。merge commit `fa9f3a2f…`、base `27d7f8f…` | 観測（GitHub の API） |
| 2026-11-16 08:10:49 | 本番の表と列の確認（prodcheck.sh）の log の名前の時刻 | 写し（log の名前 `prodcheck-20261116171049` を JST と読んだ。時刻帯は推定） |
| 2026-11-16 08:15:38 | 版の公開と読み戻し（publish.sh）の log の名前の時刻 | 写し（同上。`publish-20261116171538`） |
| 2026-11-16 08:19:12 | arc が差し替えの記録を #49 に投稿（6911141083） | 観測（GitHub の API。`created_at`） |
| 2026-11-16 08:20:38〜08:20:39 | 2 席の設定 file が書き換わった（A = 08:20:38、B = 08:20:39）。installer の backup も同じ時刻 | 観測（file の mtime と backup の名前） |
| 2026-11-16 08:39:06 | この Claude の席の process が起動（差し替えの後） | 観測（`ps` の起動時刻 `Nov 16 17:39:06` を JST と読んだ） |
| 2026-11-17 01:49〜06:23 | PostgreSQL が loopback の TCP を拒んでいた（10:49〜15:23 JST）。06:25 に戻したと arc が記録 | 写し（#49 6940564525） |
| 2026-11-17 08:58〜09:02 | arc が、publish と prodcheck の出力・2 席の期待の保存先・読み戻しの Owner の決定を投稿 | 観測（GitHub の API。下の 3 の表） |
| 2026-11-18 21:02〜21:05 | この席が、設定 file・main・この会話の記録を読み直した | 観測 |

## 3. 手順ごとの結果（`cd-config.md` の 3 の手順に対して）

| # | 手順 | 結果 | 根拠 |
|---|---|---|---|
| 1 | 候補の版を作る | 観測できず | arc の記録に出力が無い。手順 2 の公開が通っているので、候補の確かめは通った前提だが、それは推論で、記録は無い |
| 2 | 版を置き場に公開する | 一致（写し） | `publish.sh` の log の行: 「読み戻し: PASS_EXACT_READBACK」「記述子 `eb9bf2982c6202769fb60f7cdbd826072c47e721c0a86bae583f65dbedb768d3`」。arc の記録 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6943446661 （本文の SHA-256 `979fd9fd0ddd1509b40e88d5bfa3a14a642d2192b6ffdc9eac26459c67c5320b`）。log の SHA-256 は `5dfe61b4…`（席は log を見ていない）。`--expected-head` の値と公開の状態名（`FINAL_CAS_PUBLISHED_AND_VERIFIED` など）は、arc の写しに無い |
| 3 | 公開した版を読み戻す | 一致（写し） | 手順 2 の log に含まれる `PASS_EXACT_READBACK`。別の読み戻しの出力は無い |
| 4 | 本番の表と列の名前を確かめる | 一致（写し） | `prodcheck.sh` の log の行: `conversation_events` 11/11・`raw_events` 21/21・`selected_restart_packs` 11/11・`task_states` 11/11、「4 表と列が全部ある（名前だけ。値は読んでいない）」。同じ記録 6943446661。log の SHA-256 は `b48900be…`（席は見ていない）。列の数の分母が `unit-test-instructions.md` の 8 の一覧と同じかは、席は照らしていない |
| 5 | 2 席の hook を差し替える | 一致（観測） | 4 の表の観測 |
| 6 | 観測する（Q1 = B） | 観測できず | 観測 1 = Q3 の答えにより観測できず、観測 2 = Q4 の script の出力待ち |
| 7 | R2 以後に進むか決める | 開いていない | 手順 6 が「一致」でないので、Owner に伺う材料が無い |

写しの 2 つの script の識別子（`publish.sh` の `9894fc31…`、`prodcheck.sh` の `4051c496…`）は、arc の記録のとおりで、席は script を読んでいない。

## 4. 差し替えの観測（Q2 = B）

観測の時刻は 2026-11-18T21:02:31Z（席が file を読むだけ。書かない・直さない。hook の command の中身は写さず、hash・数・版の識別子だけを書く）。

| 項目 | A（Claude の席。この作業場の `.claude/settings.json`） | B（Codex の席。`~/Developer/agent-memory/.codex/hooks.json`） |
|---|---|---|
| file の SHA-256 | `38006e55a1e12f23fd7c9d4d32a4979628d9a662c993f0b7de62f8dafe621c1b` | `692950e6940bc1ce06c03b2ce451445074082a5768053749f973e4255972beaa` |
| 大きさ・mode | 16035 bytes・0600 | 6674 bytes・0600 |
| Kusabi の hook | 5 つ（UserPromptSubmit 2・SessionStart 1・Stop 2） | 5 つ（SessionStart 1・Stop 2・UserPromptSubmit 2） |
| 指す版の識別子 | 5 つ中 5 つが `eb9bf298…`（記録の RELEASE_SHA の 64 桁と一致）。旧い版 `5fd29e06…` は 0 | 同じ |
| 実行する node | `/opt/homebrew/bin/node`（実在し実行できる。`v26.13.1`） | 同じ |
| 閾値の数 | command 群に `240000` が現れ `200000` は現れない（記録の「閾値 240000」と合う） | `200000` が現れ `240000` は現れない（記録の「閾値 200000」と合う） |
| 直前の backup | `settings.json.bak.wasurezu-2026-11-16T08-20-38-920Z-69fb6cd0-61d5-4412-a0df-3748bab01f28`（SHA-256 `801ccfa5…`、0600） | `hooks.json.bak.wasurezu-2026-11-16T08-20-39-646Z-c2c40312-8959-4839-95f0-1851d634a07c`（SHA-256 `aefe0584…`、0600） |
| backup の旧い版の識別子 | 1 種類だけ。`5fd29e06bf735432…` で、記録の「`5fd29e06…`」と合う | 同じ |
| backup の版の識別子だけを新しい版に置き換えた物の SHA-256 | `38006e55…`（いまの file と同じ） | `692950e6…`（いまの file と同じ） |
| 結果 | **一致** | **一致** |

読み方と限界:

- 一致が示すのは、「差し替えは版の識別子の置き換えだけで、ほかの行を変えていない」こと。この比べ自体は、backup と現在の file が同じ installer の書いた物なので、書いた手と独立ではない。
- 独立の相手は、install4.sh が 11-16 に書いた直後の hash の記録。arc の記録 6991634288 が、その値（書いた直後 A = `38006e55…`、B = `692950e6…`）と、戻し先の backup の hash（A = `801ccfa5…`、B = `aefe0584…`）を引いており、**席が観測した 4 つの hash と一致する**（写しと観測の一致。arc の記録は、試しの後も live の file が A = `38006e55…`、B = `692950e6…` の「まま」と書く）。元の install4 の log は、席は見ていない。
- 閾値の数は、command 群の文字列に数が現れることだけを見た（引数の名前と、どの引数かは確かめていない）。「切り直しが on」は、設定 file からは確かめていない（adapter-id に `rotation` の語が入るので、語の有無では on と言えない）。
- 版の置き場の中身（`dist/*.js`・`release.json`）には、この席は触れていない（Q1 = A）。設定 file が指す先に、実際に動く code があるかは、手順 2 の写し（`PASS_EXACT_READBACK`）に依る。

## 5. 前の段の記録の訂正（承認済みの file は書き換えない）

承認済みの `operation/deployment-pipeline/` の file は、この段で書き換えない。次の 2 点は、ここで訂正する。

1. `cd-config.md` の 1・3・5 などが「install4.sh が書き込みの前に投稿した記録」と書いた点は不正確。差し替えの記録（#49 6911141083、本文の SHA-256 `aa2486f6e93f92d7dbfda81a099d8eb1f4ae5934db8f342848e3a4729abb48c2`）の 13 行目は「記録は arc が先に投稿。Owner の端末の gh が 401 で投稿できなかったため。install4.sh は投稿せず、この URL を引数で受けて差し替える」と言う。正しくは「arc が先に投稿した宣言」。結論（差し替えの成功の証拠ではない）は変わらない。
2. `deployment-strategy.md` の 2（Q2 = B の答え）は「前の版の hash は、install4 の log と #49 6911141083 の記録にある」と言うが、#49 6911141083 に 2 席の設定 file の hash は無い（書かれているのは、記録の file の SHA-256 `d0903c5b…`・新しい版の識別子・旧い版の先頭 `5fd29e06…` だけ）。Q2 = B の「script の出力の hash と比べる」は、席が 4 の観測を終えた時点では、比べる相手が GitHub に無かった。その後、arc が Q5 の記録 6991634288（本文の SHA-256 `7e7c9cf1…`）で、install4.sh が書いた直後の hash と backup の hash を引いたので、観測の hash と照らした（一致。4 に書いた）。元の log は席が見ていないので、「写しとの一致」であって、log そのものとの一致ではない。

## 6. 未決・観測できていない物

| # | 物 | 状態 | 次 |
|---|---|---|---|
| 1 | Stop の証拠（`store_backend`・`store_source`）と期待（A・B とも backend = postgres・source = user_config。arc が名前と真偽だけを読んで決めた。https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6943475955 、SHA-256 `5a42d79d…`）との照らし | 観測できず | Q3 の答え = B（観測 1 は「観測できず」）。Stop の証拠を残す直しは、この取り組みでは決めていない |
| 2 | 引き継ぎの読み戻し（`restart-cli`）と、保存先の DB に繋がるかの確認 | 観測できず | Owner が打つ script の出力待ち。arc が作り arc-sec が読む。Owner の決定 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6943524026 （SHA-256 `34fee41a…`）。出力は、席ごとの接続の道・繋がったか・読み戻せたか（一致か不一致か）だけ |
| 3 | 2026-11-17 10:49〜15:23 JST の保存の欠け | 観測できず | `health-check-report.md` の 4。読み戻しの script が、その窓の欠けを件数だけで見られるかを arc に確かめる |
| 4 | install4.sh の戻しの試験（使い捨ての写し） | 写しで PASS（写し） | arc の記録 6991634288: A・B とも、戻した後の file が入れる前の file と byte まで同じ。mode 600。前の版 5・新しい版 0。書いた後に別の変更がある時は戻さない。限り: arc は「install4.sh の restore と同じ手順」を写しに当てたと書いており、install4.sh そのものを動かしたかは、席は script を読んでいないので確かめていない。席を起こし直して hook が動くことは試していない。`team.md` の Deployment は、置き場を切り替える**前**に戻しを一度試すことを求める。今回の試験は差し替えの後（2026-11-18）で、決まりの順序からは外れた。R2 以後は、差し替えの前に試す |
| 5 | 動いている席の process が新しい設定を読んだか | A は起動が差し替えの後（観測）。B は動いていない（arc の記録。席は tmux に触れていない） | `health-check-report.md` の 2・5 |
| 6 | Claude の席の回転の Stop | まだ起きていない（arc の答え。閾値 240000 に届いていない） | 起きた時の証拠は、Stop の証拠と同じく stderr のみ |

## 7. この席が行った読むだけの観測の道具

観測の script と取った出力は、作業場の外の scratchpad にある（`seat-observe.py`・`seat-recompute.py`・`seat-shape.py`・arc の記録の写し）。どの script も、読むだけで、file に書かない。設定 file は mode を変えず、backup は触っていない。取った SHA-256 と数は、上の表に写した（時点は 2026-11-18T21:05Z 前後）。作業の跡の片付け（社内の決まり版 13）は、この取り組みの記録が済んだ後に、その席が自分で作った一時の物だけを、GitHub に無い変更が無いことを確かめて消し、消した物の一覧を残す。
