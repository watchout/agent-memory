<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-22T01:46:56Z — 成功の条件 C の「100% 取り出せる」の母数を、対応表で席に結べた記録に限るかは決めず、Owner の判断として残した; Q8 で対応の無い記録を推測でつながないと決まったため、結べない記録を母数に入れると 100% が原理的に届かなくなる。母数を動かすことは測度の変更に当たるので、自分では決めない。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-10-22T00:43:11Z — 段階の手順にある AWS と規制の専門の担当への受け渡しをせず、1 人で進めた; この作業では専門家を呼ばない設定で、別の担当を立ち上げることは owner の承認が要るため。AWS の質問は、自社が AWS を使っている根拠が無いので「自社の DB を置く場所」の質問に置き換えた。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-22T00:45:36Z — 自社の DB を共通基盤の DB に置く（Q3 = B）と、今の Kusabi の DB にある記録の扱いが決まっていない; 追加の質問 Q8 で確かめる。
