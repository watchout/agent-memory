<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-11-09T07:40:00Z — 監査の項目の file の置き場を、この repo の前の cell の `.shirube/cells/` ではなく team.md の `docs/audit/` にした; `.shirube/` は守る物の path で、team.md の進め方が `docs/audit/*.json` を名指しするため。
- 2026-11-09T07:40:00Z — 公開の repo に入れる記録の中で、非公開の repo（iyasaka-arc）は番号で引くだけにし中身は引用しないことを「非公開の repo の中身が無い」と読んだ; Owner の答えは中身を伏せることを求め、決定の記録の場所の番号は前の公開の PR でも引いているため。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-11-09T07:40:00Z — 作る役のサブエージェントには手元の commit までをさせ、push・PR・コメントはこの会話が行った; Owner に見せた選択肢の説明では作る役が PR を出すと書いたが、team.md がサブエージェントの GitHub への書き込みを禁じているため。
- 2026-11-09T07:40:00Z — package-lock.json の先頭の項で bin の写しも変わったのを、NFR1.1 の文言を直さず外れとして PR に書くことにした; Owner の答え「文言は直さず外れとして書く」。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
