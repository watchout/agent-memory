<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-11-17T02:30:21Z — 段の手順が入力に挙げる 4 つの記録（`ci-config`・`quality-gates`・`infrastructure-specification`・`cicd-pipeline`）は、bugfix の scope が CI Pipeline と Infrastructure Design を行わないので存在しない。無い物を作らず、既にある版の作り手の script・配りの runbook・`ci.yml`・Owner の決定に当たった（段の手順の Step 1）。
- 2026-11-17T02:30:21Z — Q1 = B と Q2 = B は arc の答え（Owner の決定 95）。Q1 の「観測 2（`restart-cli` の読み戻し）」は本番の保存先を読むが、Q2 = B の席は DB を読まないので、読み戻しは Owner か arc の script の出力を席がデータとして読む形に読んだ。この読みは `deployment-strategy.md` の 2 に未決の点として書いた。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-11-17T02:30:21Z — 段の手順の「feature flag の strategy」「環境の昇格の matrix」は、AWS の機能（Evidently・AppConfig）と環境（dev・staging・prod）を前提にしている。今回は AWS を使わず、環境は席の束（R1〜R3）なので、feature flag は使わないと書き（理由つき）、昇格の表は束で書いた。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-11-17T02:30:21Z — CD の workflow を足す案は採らなかった。配りは保護面で、workflows を足すには Owner の exact-head が要り、今回の手順は Owner が script を打つ形で決まっている。採った判断 = 手順を `cd-config.md` に書くだけ。採らなかった代替 = `ci.yml` に公開の job を足す。
- 2026-11-17T02:30:21Z — arc の script（publish.sh・prodcheck.sh・install4.sh）を読まずに書いた。採った判断 = 決定と差し替えの記録の文から名前と「何をするか」を取り、読んでいない物には「宣言」「読んでいない」と書く。採らなかった代替 = arc の作業場の script を読む（席の外の作業場で、arc-sec が読む手順の前に席が読む形になる）。

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-11-17T02:30:21Z — 席ごとの期待（`store_backend`・`store_source` の値）が記録に無い。差し替えの前に Owner か arc が出し、記録に先に書く。出なければ「観測できず」。
- 2026-11-17T02:30:21Z — 観測 2 の読み戻し（本番の保存先を読む）を、誰がどの許可で行うか。今の Owner の決定（表と列の名前だけ）には入っていない。
- 2026-11-17T02:30:21Z — 差し替えの記録（#49 6911141083）は、script が書き込みの前に投稿した物で、差し替えが成功した証拠ではない。Deployment Execution で、席が設定 file の hash を読んで確かめる。
- 2026-11-17T02:30:21Z — install4.sh の戻しを、使い捨ての copy で一度試したか（`team.md` の Deployment の決まり）。試していなければ、差し替えの前に試す。
