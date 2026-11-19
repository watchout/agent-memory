<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-22T23:38:32Z — 単位どうしの取り決めは同じパッケージの中の関数の口とし、質問は外に見える取り決め（道具の互換・単独の形・DB の書き込みの口）だけにした; 単位はすべて同じ process で動き（作業の単位の段の置き方）、ネットワーク越しの呼出しが無いため。道具の形の変更は公開の仕様の変更、DB の書き込みの口は DB の作りの決定で、どちらも自分で決めない決まり（エスカレーション）に当たる。
- 2026-10-22T23:38:32Z — 手元の SQLite の単独の形を残すかを owner に聞いた; 新しい版の共通基盤の形では席の確かめに共通基盤が要り、今の版の既定（設定が無いと SQLite）と両立させるかは、外に出す時の形に関わる製品の判断のため。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-23T00:39:02Z — 2 つの形（共通基盤の形と単独の形）の切り替えに、新しい設定 AGENT_MEMORY_MODE を置き、設定が無い時は DB の設定の有無で決めることにした; 単独の形を残す（Q2 = A）と、社内の席で設定が抜けた時に手元の SQLite に落ちる角が出るため。設定が何も無い社内の席を防ぐ手立てが足りるかは、未決の問いに残した。
- 2026-10-23T00:39:02Z — 書く道具の再送で記録が重なるのを防ぐ鍵（request_id）は、取り決めに足さず未決の問いに残した; owner が Q1 で承認した「足す物」の一覧に無く、足せば公開の仕様の追加になるため。

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
