<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-23T02:00:25Z — U1: この段階は owner に聞く問いを作らず、設計の要点のまとめだけを確かめてもらった; 設計が承認済みの要件（NFR1.1〜NFR10.2）と共通基盤の権限の決まり（020_acl.sql の common_verify_caller）からそのまま決まり、判断の分かれ目が無かったため。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-10-23T02:00:25Z — U1: 振る舞いの設計（entities.md）の memory_status に skipped_deadline を足した; 取り決め C2 と速さの要件 NFR4.1 には期限で打ち切った時の値があり、振る舞いの設計だけに抜けていたため。設計と取り決めを黙って食い違わせない決まり（R3）で、見つけた時に直した。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
