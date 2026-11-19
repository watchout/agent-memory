<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-21T22:39:10Z — 「施設向け管理AXシステム」がどの製品かを推定せず質問にした（Q1）; 依頼文は製品名を挙げておらず、Onza・OmotenasuAI・新規のどれかで顧客と使う場面が変わるため。
- 2026-10-22T00:16:14Z — Kusabi の記憶の持ち主は席（自社の席として動く AI）で、効く先は製品ではなく席と読む; 要約の確認で owner が「製品に対して効くような見え方になっているが、席に対しての影響である」と訂正した。製品（Onza・OmotenasuAI など）は席が仕事をする対象であり、記憶を使う側として質問や文書を組まない。
- 2026-10-22T00:16:14Z — Q16 を「顧客ごとに自社か顧客の DB のどちらか一方」と読んで記録した; 選択肢 C の文面（顧客の DB だけか両方か）より、Q17 での owner の補足「選べるなので、両方使うとは言ってない」を優先した。要約の確認で owner が Looks correct とした。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-10-22T00:16:14Z — 選択肢が 5 つある質問を、質問の欄を 2 つに分けて出した; 1 つの欄に出せる選択肢は 4 つまでのため。後半の欄には「この欄からは選ばない」「A〜C で選んだ」を足し、1 つ選ぶ質問で 2 つの欄の両方に答えが付いた時（Q1）は追加の質問（Q11）で確かめた。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-21T23:36:55Z — 要約の確認で owner から「製品に対して効くような見え方になっているが、席に対しての影響である」と指摘; 依頼文の「施設向け管理AXシステムの記憶」を製品が使う記憶と読み、Q1・Q3・Q6C・Q8・Q15 を製品と施設スタッフ寄りに作ったのが原因。効く先は席（自社の席として動く AI）で、主語の置き直しが要る。
