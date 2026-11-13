<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-11-11T08:30:00Z — この段の問いは、聞き直しを避けて未決の 5 つだけにした; 配り方（束ごとの R1〜R3・失敗した束は戻す）と守る物の決まりは team.md で決まっているため。Q5 の道具の選択は守る物でない技術の問いとして arc の答えで受け、Q1〜Q4 は Owner の答えを arc が原文で渡す。
- 2026-11-11T08:30:00Z — 席の hook の版の差し替えと、切り直しを有効にすることは別の操作として設計に書く; installer が切り直しを opt-in（指定なしは既存の設定に触れない）にしているため。
- 2026-11-11T08:55:00Z — 据え付けの手順は、方針（deployment-strategy.md）・具体の手順（cd-config.md）・戻し（rollback-runbook.md）の 3 file に分け、同じ中身を #339 の 1 つの comment にも出した; arc が arc-sec の確かめに渡す入口が #339 の comment で、記録は段の承認の対象になるため。
- 2026-11-11T09:40:00Z — S3 を「古い参照の差し替え（rollout の道具）」から「席が読む作業場の設定への新規の追加（installer を直接）」に変えた; 席が読む設定は AI-DLC の作業場の設定で Kusabi の取り込みの hook が入っておらず、rollout の道具の対象は DB に登録された別の作業場で任意の作業場を渡せないため。配備の手順は、席が実際に読む設定の場所（起動の引数の設定の読み先と作業場）を、道具の対象と突き合わせてから書く。
- 2026-11-11T09:40:00Z — 読み戻しに「hook の command が指す node が実在し実行できる」を足した; installer は node の実体の版つきの path を書き込み、登録された作業場の既存の hook は存在しない node を指していた（確かめたのは存在だけで、起動の失敗は未確認）ため。command の文字列の一致だけでは壊れた hook を通してしまう。
- 2026-11-11T10:20:00Z — S0 の前提から「次の PR の統合」を外し、版は今の main の `aa77b683…` から作る（arc の判断、arc-sec も同じ読み）; 版には `dist/` 全体が入るので、Q5 と `--node-path` の PR を待たずに作れるため。代わりに次の PR の統合を待つ案は採らなかった。副作用: 版を作る道具の必須の入口の一覧に切り直しの 2 つがまだ無く、readback はそれを見ないので、S1 に `dist/` の 3 つの file の実在の確かめを別に足した。
- 2026-11-11T10:20:00Z — 版を作る場所を、作業場でなく清潔な別の checkout にした; 版を作る道具は「作業場が清潔で head が `--expected-head` と一致」を要求し（`SOURCE_BOUNDARY_FAILED`）、作業場は別の branch で AI-DLC の記録が未コミットのため。席が道具を読んで見つけた（arc-sec の指摘ではない）。
- 2026-11-11T10:20:00Z — S3・S4 を、arc が置く 1 つの script（Owner が 1 回打つ）が続けて行う形に書き替え、dry-run は数だけ見て差分は apply の後の `diff -u` で確かめる形にした（arc-sec の D1・D2・E1・E2）; installer の dry-run は差分を出さないため。権限は、script が書き込みの前に #49 へ投稿する記録の URL と SHA-256 にした（arc の連絡だけでは席の権限として引けない）。
- 2026-11-11T23:15:28Z — この段は、前の回（#341 の統合の後）の記録が #342 の統合と S1 のやり直しの後の事実と食い違ったので、承認済みの段を戻して書き直した; 版の元・Q5 の状態・S3 が「新規の追加」から「差し替え」に変わった点が主な食い違い。第 1 版の実行の記録（deployment-log.md の S0〜S4・C2）は実物の記録なので書き換えていない。
- 2026-11-11T23:15:28Z — Q6（hook の node の path）と Q7（差し替えの操作の分け方）は、守る物でない技術の問いとして arc の答えで受けた（Owner の委任 #49 6762288830）。Q6 = B（`--node-path /opt/homebrew/bin/node`）、Q7 = B（1 回の操作）。arc の席間の連絡で、GitHub への記録はまだ無い。権限の根拠として引かず、Owner が script を打つ時に #49 へ投稿される記録を権限とする（E1 のとおり）。
- 2026-11-11T23:15:28Z — arc の script（SHA-256 541b4fef…d6a7）を本文まで読み、記録の command の形と同文であることを確かめた。script は新しい版を指す hook の数（5）を表明しないので、読み戻しの「席が足す物」に数えることを入れた。
- 2026-11-11T23:15:28Z — `initialUserMessage` は切り直しの印がある時だけ出る（claude-session-start.ts の `loaded.rotation?.initial_user_message`）。そのため、S5 の前の条件（arc の指示）の確かめは、印の無い通常の起こし直しの C2 では取れない。O5 に追記し、確かめ方は arc に実行の段で伺う（席は決めない）。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-11-11T08:55:00Z — 機能の旗・段階的な割合の配り方（canary の割合）の設計は書かなかった; この取り組みの配備は、席 1 つへの設定の追加で、止める手段（停止の印・設定から席を消す・--rotation off）が旗の代わりになるため。
- 2026-11-11T23:15:28Z — 第 2 版では、機能の旗・段階的な割合の配り方を引き続き書かなかった（第 1 版と同じ理由）。S0 の Owner の決定の取り直しと S2 の実行は、第 1 版で済みなので第 2 版の手順に入れず、読み取りの再確認だけにした。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-11-11T09:40:00Z — 切り直しの閾値は既定の 300000 でなく 240000 を指定する（arc の判断）; 席の自動の圧縮の窓 300000 より先に切り直しが来るようにするため。代わりに既定のまま観測する案は採らなかった。切り直しが圧縮より先に来たかは FR9.2 で記録する。
- 2026-11-11T09:40:00Z — この試しの node の path は、installer が書く今の node の実体の path のままにする（arc の判断）; 版つきの path は次の node の入れ替えで壊れるが、直すには installer に `--node-path` を足す設計の変更が要り、次の PR（Q5 と同じ）で行う。
- 2026-11-11T23:15:28Z — 差し替えを 1 回の操作にした（arc の答え Q7 = B）。代わりに第 1 版と同じ 2 つの操作にする案は採らなかった: 切り直しの hook を `--rotation` なしで適用すると旧い版のまま残り、途中に新旧が混ざるため。1 回の操作は、読み戻しの失敗の時に 5 つ全部を戻す。
- 2026-11-11T23:15:28Z — 戻しの command（`--rotation off`）にも、差し替えと同じ引数 A（`--node-path` を含む）を付けると決めた; 付けないと、残る取り込みの hook の node の path が installer を動かした node の実体の path に書き換わるため（installer のコードで確かめた）。

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-11-11T08:55:00Z — 席 aidlc-kusabi が読む作業場の設定には Kusabi の取り込みの hook が入っておらず、rollout の道具が替える作業場は別（O1）。Owner の決定の「席の hook を新しい版に替える」が、この作業場への新規の追加を含むかを arc と arc-sec に伺う。含まなければ追加の決定が要り、それまで S3 を実行しない。
- 2026-11-11T08:55:00Z — rollout の R1 の束は Kusabi の 3 つの host の設定を替える（O2）。決定は tmux aidlc-kusabi だけ。範囲の読み方を伺う。
- 2026-11-11T09:40:00Z — 上の 2 件は解決: O1 は arc が決めた（hook を新しく入れる形）、O2 は arc の読みで範囲は席が読む作業場の claude_code の設定だけ。残る待ちは arc-sec の確かめ（通るまで S1 以後を実行しない）。
- 2026-11-11T23:15:28Z — arc-sec の第 2 版の手順の読み直し（O12）が済むまで、Owner に script を打つ段を渡さない。arc-sec の席は止まっていて、Owner の `/clear` 待ち（arc の連絡）。
- 2026-11-11T23:15:28Z — `initialUserMessage` が効くかの確かめ方（O5。S7 の実際の切り直し／一時 dir の別 process）と、確かめられなかった時に S6 を始めないことを、arc に Deployment Execution で伺う。
