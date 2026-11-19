<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-22T08:07:40Z — 読む範囲を全体ではなく今回の取り組みに関わる所（道具・保存の層・回復・起動の口・席の身元・記憶の境目の設計）に絞った; 初回で置き場が空だったが、取り組みの中心（記憶の境目・置き場所・外への送り出し・引き継ぎ）を確かめるのに全体の深い読みは要らないため。浅く見ただけの所は範囲の記録で分けた。
- 2026-10-22T08:07:40Z — 部品の一覧の 11 部品のうち、深く読んだ 8 つだけを範囲の記録の部品に入れた; 会話の取り込み・運用の観測と展開・秘匿処理はファイルの名前と冒頭しか見ていないため。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-10-22T08:07:40Z — 開発者の担当を別に立てず、この会話が開発者の役として読み、9 つの文書も自分で書いた; owner の指示「分身は使わず、この会話の中で開発者の役として読み解いてください」と、サブエージェントを owner の承認なしに立てない決まりのため。
- 2026-10-22T08:07:40Z — 受け渡しの記録を書いた後、受け取りの印を付ける前に 2 か所を直した（コマンドの数を 20 から 19 へ、顧客の層が未実装の発見と TODO の中身を足した）; package.json と設計の文書を読み直して数え違いと抜けに気づいたため。印を付ける前なので、読み直しのやり直しにはならない。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-22T08:07:40Z — 要件の段階で扱う: Voyage AI への送り出し（意図の条件と食い違う）、別の役割の席への引き継ぎの形、顧客の層、共通基盤の DB に置く形と表の置き場、set_recovery_config の席をまたぐ書き換え、汎用の DATABASE_URL を拾うこと、PostgreSQL の試験が CI に無いこと。
