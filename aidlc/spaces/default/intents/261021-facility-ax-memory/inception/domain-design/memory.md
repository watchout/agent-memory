<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-22T12:47:38Z — 要件の前提 AS2（共通基盤の所属で顧客を表せる）を、手元の古い onza ではなく GitHub の main（5beb404）の共通基盤 0.2・0.3 の正本で確かめた; 手元の checkout は 2026-09-22 の版で、共通基盤の文書が入っていなかったため。fetch だけで作業中のファイルは変えていない。
- 2026-10-22T12:47:38Z — 顧客の DB に置く時の身元の確かめ方（Q1）を owner に聞いた; 共通基盤の決まり（保存と同じ transaction で共通の確かめの関数を呼ぶ）から、身元と記憶を別の DB に分ける形は決まりから外れることが分かり、顧客の DB の形そのものを決める大きな分かれ目になったため。
- 2026-10-22T12:47:38Z — 試験の形（Q4）の勧めを、Kusabi が渡したかどうかで数える形にした; 取り出した記録を席の LLM が使うかは自社が管理できない振る舞いで、team.md の Mandated（自社が管理できる範囲の指標）に合わせるため。数え方は測度なので owner に聞いた。

- 2026-10-22T20:35:23Z — 共通基盤の所属範囲・主体・席・割り当ては Kusabi の記録の持ち主にせず、参照の値（scope_ref など）として持つと書いた; 共通基盤の正本はそれらを共通の持ち物とし、製品は参照を書いた時点のまま保つと決めているため（contract.md §2）。
- 2026-10-22T20:35:23Z — 部品の目録の決まり（対の依存・輪が無い・持ち主が 1 つ・参照先がある）を、手で読むだけでなく行ごとの読み取りの script で確かめた; YAML の読み取りの道具が手元に無く、目録の崩れは後の段階（単位の分け方・契約）にそのまま響くため。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-10-22T20:35:23Z — 画面案を仕上げる段階を、owner に聞かずに飛ばした; owner が粗い画面案の段階で「人が見る画面は作らない、一覧は道具の応答」と決めて飛ばす指示を出しており（D-33）、この段階の必須の入力（画面の線画と流れ）が無いため。同じ理由の当てはめで、新しい判断は入れていない。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
