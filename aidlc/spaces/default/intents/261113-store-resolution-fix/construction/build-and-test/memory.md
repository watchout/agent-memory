<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-11-16T21:54:13Z — BT-06（FR5.6。直す前の code で新しい試験が失敗する）は、Code Generation が取った結果の写し（`unit-test-instructions.md` の 4）を引いて `Met` とし、この段では流し直していない。段の手順は `Unverified` を失敗とするので、持ち越した記録であることを行に書き、流し直しが要るかは承認の時に決められるようにした。
- 2026-11-17T02:20:43Z — 段の承認の入力（Owner の決定 95、iyasaka-arc#49 6934340758）が、BT-06 を `Met` ではなく「持ち越し」として記録すると指示した。要約の BT-06 の判定を `持ち越し` に改め、`Met` の数は 18 から 17 になった。上の BT-06 の行の `Met` は、この指示の前の記録。
- 2026-11-16T21:54:13Z — BT-19（CI の義務）は、`aidlc-state.md` で `ci-pipeline` が `SKIP` なので、理由「the plan runs no CI Pipeline」で `N/A` にした。この PR の CI は実際に流れており、その結果は BT-16 の行に書いた。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-11-16T21:54:13Z — 最初の `npm test` が終了コード 1 で落ちた（`test-session-start-auto-receive.ts` の期待値が `replaceAll("/", "-")` だけで、temp の名前に `_`・`.` があると落ちる）。段の中の直しの 1 回目として、temp の名前を 16 進の英数字だけにして流し直し、終了コード 0 になった。code・試験の file は変えていない（base にもある脆さ）。
- 2026-11-16T21:54:13Z — `npm audit` は、この端末の PreToolUse hook に 2 回止められて流せなかった。回避せず、依存の脆弱性の詳細は「観測できず」と記録し、成功に数えていない。
- 2026-11-16T21:54:13Z — CI の `Run post-tool-hook tests` が、環境変数が無いと `process.exit(0)` で試験を 1 件も流さずに成功する（3 つの Node の job とも）。終了コード 0 だけでは「試験が通った」と読めないので BT-OBS-2 に記録した。`ci.yml` は守る物なので、この段では直していない。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-11-16T21:54:13Z — 試験の file を含む型検査は、`tsconfig.json` を直さず、別の設定で流して base と比べた（誤り 89 件が同じ。新しい file は 0 件）。採らなかった代替 = `tsconfig.json` から試験の除外を外す（設定の変更で、この PR の範囲の外）。
- 2026-11-16T21:54:13Z — NFR7 の「新旧の hook が同時に動いても旧い読み手が壊れない」は、旧新の hook を同時に流す試験でなく、証拠の項目が足すだけであることと、merge commit の revert が base の tree に戻ることで読んだ。採らなかった代替 = 席の hook を差し替えて流す（守る物で、席は行わない）。この限界は要約の 6 に書いた。

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-11-16T21:54:13Z — BT-OBS-2（CI の step が試験を流さない）を直すには `ci.yml` を変える。守る物なので Owner の判断が要る。
- 2026-11-16T21:54:13Z — Stop の証拠の JSON の読み手が他の repository にあるかは、この段では追っていない（この repository の `src` には試験以外に無い）。
