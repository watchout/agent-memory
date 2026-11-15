<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-11-15T23:22:21Z — 保存先の決め方を動かす時は、書き手（Stop の hook）だけでなく、同じ決め方を持つ読み手（restart-cli の handoff-source の読み手、fetch・prepare）も探して同じ入口に束ねる。書き手と読み手の決め方が分かれていると、書いた先と読む先が食い違って記憶が取り出せなくなる。Q6 の確かめで読み手が見つかり、要件 FR2.4 と FR5.5（書き手と読み手の対の試験）に入れた。
- 2026-11-15T23:22:21Z — 決め方の関数が環境変数へ書く副作用（codex-session-start が config の database_url を AGENT_MEMORY_DATABASE_URL に書く）は、同じ process の別の読み手（kusabi-runtime-event-emitter の既定の store）の保存先を黙って変える。決め方を 1 つにする時は、副作用で効いている読み手を数え、結果を引数で渡すか、副作用を残す理由を書く（見直し役の Major 1）。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-11-15T23:22:21Z — bugfix の取り組みには intent-statement・scope-document・team-practices の記録が無いので、Sources はそれらを引かず、実在する記録（codekb の business-overview・architecture・code-structure、project-description.json、aidlc-state.md、team.md、project.md）を引いた。upstream-coverage の確かめが要る語は Sources に残した。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-11-15T23:22:21Z — 作業場が dirty で local branch が古いため、読んだ版の根拠に git の HEAD を使わず、origin/main の commit（27d7f8f）と src・scripts・package.json・.github・docs/operations をバイトで比べた。採らなかった代替 = HEAD を信じる（dirty の木では HEAD が読んだ file と一致する保証が無い）。

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
