<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-22T00:21:51Z — 最初の版は社内向けだが、この段階は省かずに行うと判断した; 段階の条件は「作るか借りるかの検討がある時に行う」で、席の記憶には既製のサービスや AI の道具の記憶の機能という比べる相手があり、意図の文書でも記憶が外部のサービスに置かれる問題（Q2）を挙げているため。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-22T00:37:29Z — 外の記憶の製品は公開の文書だけで判定し、動かして試すことはしなかった; 方針（Q4 = 自前で作る）は決まっており、試すのは比べる段の範囲を超えるため。判定できない所は「？」とし、条件 C は実際に動かす試しが要ると書いた。AUN の会話の記録も調べず、確かめていないことに残した。

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-22T00:27:05Z — Q3 の答え C が根拠にする決定 4（社内の開発の席の記憶は当面 Claude Code・Codex の組込みで足りる、iyasaka-arc#49 6328010677）と、承認済みの意図の文書（きっかけ・使い始め・対象が社内の開発の席）が食い違う; 追加の質問 Q7 で確かめる。答えによっては意図の確認の段階に戻る必要がある。
