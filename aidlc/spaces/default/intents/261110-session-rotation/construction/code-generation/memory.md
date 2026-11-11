<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-11-11T09:30:26Z — 新しい試行（Step 16）の範囲を、arc の判断（agent-memory#339 の comment 6791901034）と arc-sec の条件のとおり、「Claude の 3 つの入口が知らない key を拒否する故障を、知らない key を無視する 1 か所の parser に直す」と読んだ。共有の `parseTranscriptStopInput` を直すので Codex の Stop も同時に緩むが、Codex の SessionStart の parser は範囲の外のままにした（設計の記録 3 節の H7・4 節。arc が席間の連絡で「良い」と答え、Codex 側の正例・負例を試験に入れる）。
- 2026-11-11 — 見直し役（aidlc-architecture-reviewer-agent、取り組みごとの承認の範囲、読み取りだけ）が監査の項目を見て NOT-READY と返した。直した点: 観測した host の版の実施者を「配備の health check の手順（code ではない）」に決めた（設計の記録 6 節・7 節・11 節の 5、計画 16.11、要件 FR10.5、HOST_ADAPTERS）。arc が「良い」と答えたのは取り方（`claude --version`、読めなければ観測できず）まで。実施者を手順にしたのは作者の絞り込みで、code を足さない側。ほかに、計画 16.3 の S7（該当しない）、16.6 の `.gitignore` は 1 行だけ、知らない key が `source` の違いと重なる時の理由コードの変わり（11 節の 12）、診断が書けない時に黙る S8 の ledger（11 節の 11）、戻しの時の hook の重なり（12 節）を足した。
- 2026-11-11T09:30:26Z — 観測した host の版は、hook の入力にも hook の環境にも版が無いため、診断の記録ではなく配備の health check の手順が `claude --version` で取る形にした。arc の判断の文面（診断の記録にだけ書く）と違うが、arc が席間の連絡で「良い」と答えた（技術の判断。設計の記録 7 節・13 節。読めない時は「観測できず」）。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-11-11T09:30:26Z — arc に確かめた 4 点（設計の記録 13 節）: 観測した版の取り方、Codex の Stop の同時の緩み、`.gitignore` を 1 行だけにすること、この PR を R3（Owner の exact-head）として扱うこと。解決（2026-11-11 PR #342 を出した後）: 4 点とも arc が席間の連絡で「良い」と答えた（arc の技術の判断と Owner の委任 #49 6762288830 の範囲。Owner の言葉ではなく、GitHub への記録はまだ無い）。設計の記録の 0 節・13 節に反映した。
- 2026-11-11T09:30:26Z — 監査の依頼の前の自己確認の 3 つ目（項目の file を AI-DLC の見直し役に先に見せる）は、取り組みごとの承認が今回の試行に及ぶかを arc に確かめてから行う。解決: arc が「及ぶ」と答えた（取り組みごとの承認と #49 6762808466）。ただし規則の塊を会話の記録の file から抜き出さない。呼び出しが止まる時は、呼ばずに依頼を出し、その事実を maker_history に書く。
- 2026-11-11 — PR #342 の `Shirube Rapid/Lite Gates Report` は fail（`RL-PR-002`: 変えた file が cell の `allowed_paths` の外、変えた file の数が閾値超え）。PR #341 でも同じ失敗のまま統合された。直すには `.shirube/` か workflow に触れる必要があり、保護面なので触らない。`build-and-test` 18・20・22 は pass。
