<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-11-10T08:30:00Z — arc は「動いている会話を切る仕組みは設計の段で Owner への問いにする」と言ったが、express の取り組みには設計の段が無いので、要件の段の Q1 にした; 守る物なので Q1 は Owner の答えが要り、arc の委任（#49 6762288830）の外にある。
- 2026-11-10T08:30:00Z — 問いの答えは、Owner の指示「全部arcにメッセージしてきいて、その指示に従え」と委任（#49 6762288830）により arc に聞く; 守る物でない Q2〜Q4 は「arc の答え（Owner の委任 #49 6762288830）」として書き、Q1 は arc を通して Owner の言葉を受ける。

- 2026-11-10T08:40:00Z — 切り直しで頭に入れる量の上限（FR6.4）は問いにせず、arc の材料「再開用のまとめは数千〜1 万に収める」から 10,000 トークンにした; 守る物ではなく、根拠の数字が材料にあるため。
- 2026-11-10T08:40:00Z — 席ごとの閾値（Q2）は、DB の作りを変えないよう hook の command の引数で渡す形にした; recovery_config の表に列を足す案は DB の作りの変更になるので採らなかった。

## Deviations
- 2026-11-10T08:40:00Z — 深さは Minimal（要件 5〜10 の目安）だが、Owner の条件と arc の補い（取り込みの直し・tool が遅れて届く件・表の変更の流しをやめる）で範囲が広がり、FR は 9 群になった; 減らすと Owner の条件を満たす前提が欠けるため。
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
