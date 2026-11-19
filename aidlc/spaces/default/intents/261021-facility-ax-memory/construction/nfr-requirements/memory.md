<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-23T01:46:31Z — U1: 共通基盤の取り込みを AUN と同じ形（SQL 3 つの変えない写しと sha256 の試験）にし、TS の adapter を取り込まない既定にした; onza main 5beb404 の SQL 3 つの sha256 が AUN の写しと同じで、取り決め C4（DB の関数の口）なら確かめを DB の関数の中で呼べるため。adapter の Node 22.18 以上の縛りも来ない。
- 2026-10-23T01:46:31Z — U1: 網羅率を測る道具と使い捨ての試験の DB の置き方を、この段階で owner に聞いた; owner が「最初の確かめの時までに決まる」と言った 2 つで、技術の選び方（tech-stack）を決めるこの段階が置き場だったため。この Mac に PostgreSQL 17 の道具と docker 29.2.1 があることを先に確かめた。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-23T01:56:04Z — U1: 道具の速さの目安（95% が 500 ミリ秒以内）を、要件の前提 AS7（速さの数値の要件は置かない）と並べて書いた; AS7 は利用者に約束する数値を置かないという意味で、起動の時の期限（7 秒）を守るための作る側の目安は要るため。速さの文書にこの読み方を書いた。

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
