<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-10-22T20:50:35Z — 追跡（traceability.json）の行き先に複数の単位を並べて書き、確かめで 7 件の失敗が出たので、話ごとに主な単位 1 つに直した; この段階の追跡は行き先を 1 つの単位としか読まないため。複数の単位にまたがる話は、対応の表（unit-of-work-story-map.md）に全部の単位と受け持ちを残した。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-22T20:42:41Z — 試験の単位（U8）を U1 にだけ依存させ、U2・U3・U7 に依存させなかった; 場面の試験を実装より先に書く進め方のため、試験は記録・回復ができる前から書けて失敗する形にしたい。結べなかった古い記録の件数は、移しの記録があれば読む形にし、無い時は無いと出す。依存の辺を減らした分、試験が通るのは U2・U3・U7 の後になる。
- 2026-10-22T20:42:41Z — DB の作りを別の単位（spec）に切り出さず、単位ごとに要る表を足す形にした; 薄い一本を依存の最初に置く決まりがあり、DB の作りの単位を前に置くと、最初の単位が単独で動かない層になるため。どの変更にも戻し方を付ける（NFR6）。

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
