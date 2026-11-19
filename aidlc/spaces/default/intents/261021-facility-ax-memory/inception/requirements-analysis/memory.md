<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-22T08:35:32Z — 試験の場面の集合（Q1）と「取り出せる」と数える条件（Q7）は、自分で決めず owner に聞いた; どちらも完了の判定の母数と測り方を決めるもので、測度の変更に当たるため（L6、project.md の決まり）。
- 2026-10-22T08:35:32Z — 起動の時の時間の上限（native の起動の口の 7 秒）、DB に届かない時に別の置き場所へ逃げないこと、席が自分の設定だけを書けることなどの角は、質問にせず要件か前提として書くことにした; 手本の角の一覧の決まり（自分で妥当な既定を置ける角は質問にしない）のため。

- 2026-10-22T08:44:52Z — 制約 C-13 の「外の LLM に記憶を出さない」を「外の記憶の製品や LLM の道具の組込みの記憶に置かない」と読み、Q5 = A（席の LLM に渡すことを認める）と両立させた; 元の owner の指示（iyasaka-arc#49 6327956142）は「置かない」の形で、推論のために渡すことは全製品で未決と区別されていたため。この読みは要約の確認に入れて owner が確かめた。
- 2026-10-22T08:44:52Z — 仕事の ID が付いていない記録は、今までどおり書いた席だけが読める、を既定として書いた; Q2 = A は仕事の ID が付いた記録の読み方だけを決めており、付いていない記録まで開くと今の記憶の境目（席ごとの非公開）を黙って広げることになるため。要約の確認に入れた。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-10-22T08:44:52Z — 手元の呼出しの記録（calls.log）に記憶の文を書かない要件（NFR1）を、質問にせずに足した; 要件を書く前に src/index.ts を確かめ、決定の文と作業の名前が置き場所の DB の外のファイルに平文で残ることが分かり、固い決まり（外へ出さない）と意図の「DB の中で完結」から直接出る要件だったため。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
