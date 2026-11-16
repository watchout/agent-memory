<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-11-15T08:07:43Z — 保存先を決める呼び出し元を数える時は、`createStore(` の直接の呼び出しに加えて、関数を引数で受け取る所（`options.createStore` など）も探す; 最初の一覧は直接の呼び出しだけで、足りなかったのは `src/kusabi-runtime-event-emitter.ts`（引数で渡された `createStore` を使い、保存先は別の関数 `createQuietStore` が環境変数だけで決める）だった。その file と試験を範囲に足して snapshot を取り直し、読み解きの途中の開発者の役にも知らせた。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-11-15T08:07:43Z — Focused scan（前の知識の置き場に統合する形）を選び、全体の読み直しは採らなかった; 保存先の決め方に関わる部品と呼び出し元だけを深く読めたが、前の取り組みの深い読みのうち今回の範囲の外の path と component は「浅い」に下がり、`--compare` は NARROWER を出した。この直しに要らない読みを増やさないことを優先した。範囲の外の部品は、次の段が必要とした所だけ深く読み直す。

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-11-15T08:07:43Z — 開発者の読みは、arc が挙げた呼び出し元のうち claude・gemini・antigravity の session-start、boot、index、restart-cli、claude-start、codex-start、kusabi-fleet-status-cli と codex-hook-installer を「浅く見た」に分けた。共通の部品へ載せ替える設計で、これらの個別の挙動（特に PostgreSQL の移行を飛ばす option を付けない呼び出しの扱い）を決める前に、深く読み直すかどうかを要件の段で確かめる。
