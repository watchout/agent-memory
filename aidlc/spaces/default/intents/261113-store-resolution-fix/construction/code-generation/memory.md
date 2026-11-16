<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-11-15T23:41:40Z — arc の R-01（emitter も共有の決め方を使う）は、結果を渡す案（URL を evidence・worker の stdin 経由で運ぶ。3 か所が同時に動く）ではなく、worker が同じ関数を自分で呼ぶ形（D1）で読んだ。arc の文は「結果を受け取る」なので、計画の報告で arc に見せ、設計監査にも渡す。
- 2026-11-15T23:41:40Z — 環境変数への書き込みで効いていた読み手を 27d7f8f の grep で数えたら 2 つ（4 つの loader の既定の `createStore()` と、emitter の既定の store）だった。ほかの `AGENT_MEMORY_DATABASE_URL` の読み手は別 process で自分の環境を作る道具。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-11-16T00:55:54Z — 設計監査 1 回目（返却 https://github.com/watchout/agent-memory/pull/346#issuecomment-6904207773）が BLOCK。SR-BF-01: 計画の「CI は `npm test` を流す」は誤りで、27d7f8f の `ci.yml` は `npm test` を流さない。新しい試験を `test:claude-hook`（CI が呼ぶ）の連なりに足す形に直し（D10）、到達の機械の確かめ・意図的な失敗の確かめ・CI の log の確かめを足した。SR-BF-02: D1 の「`binding_sha256` の突き合わせで見つかる」は誤りで、その突き合わせは SessionStart の証拠から出た 2 つの値どうしの比べだった。worker が決めた結果から実際に開く接続先の binding を作り直して、store を作る前に比べる契約を足した（1.6、S6）。SR-BF-03: 前の取り組みの網羅率の script は、読み込まれていない file を 0 件と数える。byte 同一で写さず、未観測を失敗にする版を書き、負例の自己試験を足した（D11、U14）。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-11-15T23:41:40Z — Stop の store の決めは、store が要る回（save）にだけ行い、busy・none・blocked の回では行わない（D4）。hook の頭で決めると、今は成功している「store の要らない回」が設定 file の誤りで新しく失敗になる。環境変数で決まる時は設定 file を読まない（D8）のも同じ理由。
- 2026-11-15T23:41:40Z — 場面の試験 S1 は、設定 file にだけ「接続できない PostgreSQL の URL」を置く形にした。直す前は Stop が既定の SQLite を開いて「保存」するので、PostgreSQL が無い CI でも失敗を確かめられる（書いた先と読む先が分かれる S2 は使い捨ての PostgreSQL が要るので手元でだけ）。

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
