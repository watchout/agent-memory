<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-22T01:52:20Z — 「必ず入れるもの」を質問で一から聞かず、承認済みの決定から P1〜P7 として示し、追加と変更だけを聞いた; 意図の文書と実現性の段階で成功の条件・置き場所・今の記録の移しが既に決まっており、同じことを聞き直さないため。前の段階で owner の判断として残した母数は、この段階の Q4 で聞いた。
- 2026-10-22T02:11:46Z — Q2 で Gemini を試験に入れた答えに対し、Gemini の席が今の運用に無いことと完了の判定（Q5）の関係を追加の質問 Q8 で確かめた; 答えをそのまま置くと、席が無い間は最初の版が完了できない矛盾になるため。owner は A と答えた後に B（使い捨ての会話）へ改めた。
- 2026-10-22T02:11:46Z — 会話の取り込み（P8）を Must とし、完了の判定に含まれないことを「確かめていないこと」に残した; owner は最初の版に入れると答えたが、完了の 2 条件には入っていないため、範囲と完了の判定の食い違いになりうる。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
