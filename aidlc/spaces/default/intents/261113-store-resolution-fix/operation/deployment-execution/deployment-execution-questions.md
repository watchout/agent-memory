# Deployment Execution — 質問（取り組み 261113-store-resolution-fix）

この質問の答えは、AI-DLC の決まりどおり、守る物に触れる問い（版の置き場・本番の DB・席の hook・資格情報）は Owner の言葉のまま、守る物でない運用の問いは Owner の委任（https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6934340758）に基づく arc の答えとして書く。`[Answer]:` は空けてあり、選択肢に勧めは付けていない。

## すでに決まっている物・観測できた物（質問にしない）

決まっている物の出どころは、Owner の決定 `OD-KUSABI-STORE-RESOLUTION-RELEASE-PRODCHECK-R1-SELF-SEATS-20261116-001`（https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6910764201 ）、前の段の記録（`operation/deployment-pipeline/` の 4 file。承認済み）、`team.md` の Deployment。

- 配る先は Kusabi 自身の 2 席（R1）だけ。R2 以後は、この 2 席の観測の後に改めて Owner に伺う。
- DB の構造は変えない（DDL 0 行）ので、migration は無い。席が行うのは、記録と、読むだけの観測だけ（前の段の Q2 = B）。版の公開・本番の確認・席の hook の差し替えは、Owner が arc の script を打つ形で、席は実行しない。
- 「観測できず」は成功に数えない（S5）。観測の値は、観測した file から計算し、宣言を写さない。
- 配ったことの「時期」を決める問いは無い（差し替えは、Owner が 2026-11-16 に打ち終えている）。AWS は使っていないので、AWS の確認はしない。

この段の始めに、2 席の設定 file を読むだけで観測した（書いていない。中身は写さず、hash・hook の数・版の識別子だけ）。結果は次の表。観測の記録は `deployment-log.md` に書く。

| 席 | 設定 file | Kusabi の hook | 指す版の識別子 | 差し替えの前の file（installer の backup）の版の識別子だけを置き換えた物と、いまの file |
|---|---|---|---|---|
| A（Claude の席 tmux `aidlc-kusabi`） | この作業場の `.claude/settings.json` | 5 つ | すべて新しい版 `eb9bf298…`（5 つ中 5 つ） | 一致 |
| B（Codex の席 tmux `kusabi`） | `~/Developer/agent-memory/.codex/hooks.json` | 5 つ | すべて新しい版 `eb9bf298…`（5 つ中 5 つ） | 一致 |

つまり、設定 file の上では、差し替えは記録のとおりに起きている（観測）。ただし、観測できたのはここまで。次の 3 点は観測できていない: (1) hook が実際に動いて保存先を決めた結果（Stop の証拠）、(2) 版の置き場にある版の中身、(3) 動いている席の process が新しい設定を読み込んだか（Codex の席は、差し替えの後に再起動していない。Claude の席の回転の Stop は、まだ起きていない = arc の答え）。

**前の段の記録の訂正（承認済みの file は書き換えない）**: 差し替えの記録（https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6911141083 ）の 13 行目は「記録は arc が先に投稿。Owner の端末の gh が 401 で投稿できなかったため。install4.sh は投稿せず」と言う。前の段の `cd-config.md` などが書いた「install4.sh が書き込みの前に投稿した記録」は、この点で不正確で、正しくは「arc が先に投稿した宣言」。結論（宣言であって差し替えの成功の証拠ではない）は変わらない。訂正は `deployment-log.md` に書く。

## Q1. [運用] 版の公開・読み戻し・本番の表と列の確認の出力を、記録に写せる形で出せるか

背景: 差し替えの記録は、版の公開と読み戻し（`publish.sh`）と、本番の DB の表と列の名前の確認（`prodcheck.sh`）が済んだと言い切っています。しかし #49 には、その 2 つの script の出力（`PASS_EXACT_READBACK` などの状態名、4 表すべてに列が揃っているか）は投稿されていません（2026-11-16 以後の #49 の comment 33 件を調べた）。席が記録に写せるのは、出された出力か、席が読むだけで確かめられた物だけです。なお、版の置き場（`~/Developer/.kusabi-releases`）の版は、置き場の名前が記述子（`release.json`）の SHA-256 と同じ作りです。読むだけで、名前と一致するかを確かめられます。

選択肢:
- A. Owner か arc が、2 つの script の出力（状態名・識別子・一致か不一致かだけ。行の値と接続の文字列は出さない）を GitHub に出す。席は読んで記録する。席は版の置き場に触れない
- B. 出さない。席は「宣言のみ・観測できず」と記録する
- C. A に加えて、席が版の置き場の `release.json` を読むだけで、記述子の SHA-256 が置き場の名前（`eb9bf298…`）と一致するかを確かめる。書かない・消さない・版の中の code は動かさない。範囲は Owner が決める（守る物 = 版の置き場）
- X. Other (please specify)

[Answer]: A。Owner か arc が 2 つの script（publish.sh・prodcheck.sh）の出力（状態名・識別子・一致か不一致かだけ。行の値と接続の文字列は出さない）を GitHub に出す。席は読んで記録する。席は版の置き場に触れない。
（画面の選びで受けた答え。2026-11-17T08:58:44Z に写した、**Mode:** guided。出力が出るまで、版の公開・読み戻し・本番の確認は「観測できず」。）

## Q2. [運用] 2 席の「期待の保存先」を、誰がどう決めるか

背景: 前の段で、R1 の観測 1 は「最初の Stop の証拠が、席ごとの期待と一致」することを見ると決めました。ところが、2 席の期待（`postgres` か `sqlite` か、決めた根拠が環境変数か設定 file か）を決めた記録がありません。要件の AS2 のとおり、席の起動の環境変数と `~/.agent-memory/config.json` の `database_url` の有無は、まだ誰も読んでいません。設定 file には接続の文字列（資格情報）が入りえます。席が読むなら、「ある・無い」の真偽だけにして、値は読まない・出さない形になります。

選択肢:
- A. Owner か arc が、2 席の期待（backend と source）を、記録に先に書く。席は設定 file も環境も読まない
- B. 席が、2 席の起動の環境の変数の「名前の有無」と設定 file の `database_url` の「キーの有無」だけを読み、共有の関数の規則（要件の FR1.2）から期待を計算して記録に書く。値は読まない・出さない・写さない（守る物 = 資格情報のそばの file。範囲は Owner が決める）
- C. 期待は決めない。観測 1 は「`store_backend`・`store_source` が入り、`store_refused` が 0 件」の事実だけを書き、「一致」とは数えず、結果は「観測できず」にする
- X. Other (please specify)

[Answer]: A。Owner か arc が、2 席の期待（backend と source）を、記録に先に書く。席は設定 file も環境も読まない。
（画面の選びで受けた答え。2026-11-17T09:00:12Z に写した、**Mode:** guided。期待が出るまで、観測 1 の「一致」は判定できず「観測できず」。期待は、席の設定の中身を読まずに、Owner か arc が出す。）

## Q3. [運用] 差し替えの後の「最初の Stop の証拠」を、どこから読むか

背景: Stop の 2 つの hook は、保存先を書いた行（`store_backend`・`store_source`・`store_refused`）を、hook の stderr に出すだけです。file にも DB にも残しません（code を読んだ事実: `session-rotation-stop.ts` と `transcript-stop-capture.ts` の `write_evidence` はどちらも `process.stderr.write`）。host（Claude Code・Codex）が hook の stderr を残さない限り、前の段で決めた観測 1 は、後から読み返せません。加えて、Codex の席は差し替えの後に再起動しておらず、Claude の席の回転の Stop もまだ起きていません。

選択肢:
- A. 次の本物の Stop の stderr の行を、Owner が host の debug の出力などから 1 回写して貼る。席は貼られた行をデータとして読み、期待（Q2）と比べて記録する。席は何も実行しない
- B. 観測 1 は「観測できず」と記録して先へ進む。保存先が合っているかは、Q4 の読み戻し（保存した行を、決めた保存先から読む）だけで見る
- C. Stop の証拠を file にも残す直しを、この取り組みの外の新しい取り組みとして別に決める（コードの変更）。それまで観測 1 は「観測できず」
- X. Other (please specify)

[Answer]: B。観測 1 は「観測できず」と記録して先へ進む。保存先が合っているかは、Q4 の読み戻し（保存した行を、決めた保存先から読む）だけで見る。
（画面の選びで受けた答え。2026-11-17T09:02:32Z に写した、**Mode:** guided。Stop の証拠を残す直しは、この取り組みでは決めていない。）

## Q4. [運用] 保存した引き継ぎの読み戻しと、保存先の DB に繋がるかの確認を、誰がどの形で行うか

背景: 前の段の答え（Q1 = B）は、各席で 1 回、Stop が保存した引き継ぎを、同じ保存先から `restart-cli` で読み戻すことでした。これは本番の保存先の DB を読みます。今の Owner の決定（表と列の名前だけ読む）には入っておらず、席は DB を読まない範囲です（Q2 = B）。さらに、2026-11-17 に、この Mac の Postgres の接続の認証が変わりました（TCP の loopback は拒否、socket は通る。arc の読み戻し https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6935369527 、データとして読んだ）。2 席の保存先が使う接続の道が TCP か socket かは、まだ確かめていません。道が TCP なら、Stop の保存が失敗している可能性があります。

（訂正。答えの後に見つけた。この背景が引いた記録 6935369527 は、arc が https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6940564525 で「戻した（事故）」と書いて無効にしている: 認証の変更は 2026-11-17 10:49 JST に当たり、15:24 JST に戻った。その間（10:49〜15:23 JST）、loopback の TCP は拒否されていた。arc の記録では、Kusabi の保存先の設定も agent_comms を TCP の loopback で指している（arc が道の種類と DB 名だけを読んだ）。つまり、その窓の間の Stop の保存は失敗した可能性がある。今は戻っている。答えの A（Owner が script を打つ）は、この訂正で変わらない。読み戻しの script が、その窓の保存の欠けも件数だけで見られるかは、arc に確かめる。）

選択肢:
- A. Owner が、読み戻しと接続の確認の script を打つ（arc が作り、arc-sec が読んで通す）。出力は、席ごとの接続の道、繋がったか、読み戻せたか（一致か不一致）だけ。行の値と接続の文字列は出さない。席は出力をデータとして読んで記録する
- B. この取り組みでは行わない。読み戻しと接続は「観測できず」と記録し、R2 に進む判断は、観測できた物だけで Owner に伺う
- C. 席が自分で読み戻す許可を Owner が出す。何を読むか・何を出さないか・どの接続を使うかを、Owner が決める（守る物 = 本番の DB）
- X. Other (please specify)

[Answer]: A。Owner が、読み戻しと接続の確認の script を打つ（arc が作り、arc-sec が読んで通す）。出力は、席ごとの接続の道、繋がったか、読み戻せたか（一致か不一致）だけ。行の値と接続の文字列は出さない。席は出力をデータとして読んで記録する。
（画面の選びで受けた答え。2026-11-17T09:06:59Z に写した、**Mode:** guided。この script はまだ作られておらず、出力が出るまで、読み戻しと接続の確認は「観測できず」。本番の DB を読む script なので、守る物の手順（arc が作り、arc-sec が通し、Owner が打つ）を通る。）

## Q5. [運用] install4.sh の戻しを、使い捨ての copy で試した記録を出せるか

背景: `team.md` の Deployment は、置き場を新しい所へ切り替える前に、戻す手順を一度試すことを求めます。前の段の戻しの手順書は、試していなければ「差し替えの前に試す」と書きました。しかし R1 の差し替えは、すでに終わっています（観測済み）。repo の installer には、backup を取る機能はありますが、backup から戻す機能はありません（code を読んだ事実）。戻しは `install4.sh` の側の働きで、席はその script を読んでいません。

選択肢:
- A. arc か Owner が、使い捨ての copy で `install4.sh` の戻しを試した結果（出力）を GitHub に出す。席は読んで記録する
- B. 試していない。R1 の差し替えは済んでいるので、戻しは「試していない」と記録し、R2 以後に進める前に試すことを条件にして Owner に伝える
- X. Other (please specify)

[Answer]: A。arc か Owner が、使い捨ての copy で `install4.sh` の戻しを試した結果（出力）を GitHub に出す。席は読んで記録する。
（画面の選びで受けた答え。2026-11-18T21:02:13Z に写した、**Mode:** guided。出力が出るまで、install4.sh の戻しは「試していない」。席は install4.sh を読んでいない。）
