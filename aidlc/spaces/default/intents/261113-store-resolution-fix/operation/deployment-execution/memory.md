<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-11-17T06:18:32Z — 前の段の Q2 = B の「script の出力と食い違わないか」は、script の出力（install4 の log）が Owner の端末にあり GitHub に無いので、そのままは比べられない。代わりに、2 席の installer の backup（差し替えの前の file）の版の識別子だけを置き換えた物の hash が、いまの file の hash と一致するかを、観測した file から計算した（A・B とも一致）。設定 file を読んで取ったのは hash・hook の数・版の識別子だけで、中身は写していない。
- 2026-11-17T06:18:32Z — 差し替えの記録（#49 6911141083）の 13 行目は「記録は arc が先に投稿。install4.sh は投稿せず」と言い、2 行目の定型の文（script が書き込みの前に投稿した）と食い違う。13 行目を、実際の投稿の事情として読んだ（投稿者は watchout、作成は 2026-11-16T08:19:12Z）。
- 2026-11-18T21:08:40Z — Operation 段階の決まり（新しい service に health の指標と誤り率の指標）は、この取り組みに当てはまらないと読んだ（新しい service は無く、既存の hook の保存先の決め方を直した取り組み）。health-check-report に理由を書いた。
- 2026-11-18T21:08:40Z — Q2 = B の「script の出力の hash と比べる」は、席が観測した時点では比べる相手が GitHub に無かった。arc が Q5 の記録（6991634288）で install4.sh が書いた直後の hash を引いたので、その後に照らした。元の log は席が見ていないので「写しとの一致」と書いた。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-11-17T06:18:32Z — 承認済みの `deployment-pipeline` の file（cd-config.md ほか）にある「install4.sh が書き込みの前に投稿した記録」は不正確だが、承認の後の書き換えは段の有効性の確かめを動かすので、書き換えず、訂正を questions の前書きと deployment-log に書く形にした。採った判断 = 訂正を新しい記録に書く。採らなかった代替 = 承認済みの file を直接直す。
- 2026-11-18T21:08:40Z — Step 3「Execute Deployment」は、席が配りを実行する形でなく、Owner が打った配りを読んで記録する形にした（前の段の Q2 = B と、Owner の決定の 4）。smoke test も、席が読むだけで行える確かめだけにした。
- 2026-11-18T21:08:40Z — team.md の Deployment は戻しの試験を切り替えの前に求めるが、今回は差し替えの後に arc が使い捨ての写しで試した。順序が決まりから外れたことを deployment-log に書いた。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-11-17T06:18:32Z — 観測を、2 席の設定 file を読むだけに限った（前の段の Q2 = B）。版の置き場・本番の DB・席の起動の環境・設定 file の接続の文字列には触れていない。採らなかった代替 = 版の hook を使い捨ての HOME で動かして Stop の証拠を出させる（承認の範囲を超え、保護面の版の code を動かす形になる）。
- 2026-11-18T21:08:40Z — 保存の欠けの可能性（2026-11-17 の接続の拒否の窓）を、席が確かめない形にした。確かめるには本番の DB を読む必要があり、今の許可（表と列の名前だけ）の外。採らなかった代替 = 席が DB を数える。

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-11-17T06:18:32Z — Q1〜Q5（questions file）。特に、Stop の証拠は stderr だけに出て残らない（code を読んだ事実）ので、前の段の観測 1 は、誰かが貼らない限り観測できない。
- 2026-11-17T06:18:32Z — 2026-11-17 に Mac の Postgres の認証が変わった（#49 6935369527）。2 席の保存先の接続の道（TCP か socket か）は未確認で、TCP なら Stop の保存が失敗している可能性がある。
- 2026-11-17T06:18:32Z — 動いている 2 席の process が新しい設定を読み込んだか（Codex の席は差し替えの後に未再起動）。
- 2026-11-18T21:08:40Z — 観測 1 は、Q3 の答え（B）により、この取り組みでは観測できないまま。観測 2 だけが「一致」になった時に R2 に進むかは Owner の判断。
- 2026-11-18T21:08:40Z — Q4 の読み戻しの script が、窓の間（11-17 10:49〜15:23 JST）の保存の欠けを件数だけで見られるか。
- 2026-11-18T21:08:40Z — 前の段の Q4 の背景が引いた記録 6935369527 は、arc の 6940564525 で無効になっていた。答えを受ける前に最新の記録を読まなかった席の見落とし。質問 file に訂正を書き、答え（A）は変わらない。
