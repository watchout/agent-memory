# U1 の技術の選び方

- 入力: 使っている技術（`aidlc/spaces/default/codekb/agent-memory/technology-stack.md`）、取り決め（`inception/contract-design/contract-summary.md` の C4・C5）、進め方（team.md の Testing Posture）、この段階の質問の答え
- 新しい技術は足さない（制約 C-01）。足すかもしれない物（c8）は、その時に owner の決定を取る。

## 選んだ物

| 物 | 選び方 | 理由 |
|----|--------|------|
| 言語と実行環境 | TypeScript（ESM）、Node 18 以上（今のまま。CI は 18・20・22） | 今の版と同じ（制約 C-01）。共通基盤の TS の adapter を取り込まないので、adapter の Node 22.18 以上の縛りは来ない |
| DB | PostgreSQL（版の番号は公開の記録に書かない）。本番の置き場所は共通基盤の DB（自社）か顧客ごとの DB | 今の版と同じ。共通基盤 0.2 は別の版で試され、手元の機械の PostgreSQL にも AUN の段 2 で入っている |
| DB の接続 | 今の `pg`（package.json の ^8.13.0） | 今の版と同じ。新しい依存を足さない |
| 共通基盤の取り込み | onza の共通基盤 0.2 の SQL 3 つ（`001_schema.sql`・`010_verify_current_tx.sql`・`020_acl.sql`）を変えない写しで置き、sha256（74a05751…・62aa83da…・53827714…）が一致することを試験で確かめる。TS の adapter と 0.3 は取り込まない | AUN と同じ形（aun feature/bootstrap 2f9c204d）。onza main 5beb404 の 3 つの bytes は AUN の写しと同じ。確かめは Kusabi の DB の関数の中で `common.verify_current_tx` を呼ぶ（取り決め C4） |
| Kusabi の置き場の作り | Kusabi の置き場（schema `kusabi`）に決定の表と公開関数を足す。関数は持ち主の権限で動き、探す場所を固定する | 取り決め C4。席には関数の実行だけを許す |
| 試験の DB | 試験のたびに、一時的な場所に専用の PostgreSQL を立ち上げ（手元の機械に入っている initdb・pg_ctl・postgres を使い、空いている port で動かす）、終われば止めて消す。手元の機械で動いている今の PostgreSQLには触れない | この段階の Q2 = A。AUN の結合の試験にも同じ形を当てる |
| 試験の動かし方 | 今のまま tsx で動かす自前のスクリプト | 今の版と同じ |
| 行の網羅率 | まず今の試験を書き直さずに `node --test --import tsx --experimental-test-coverage` で動かし、Node の組込みで行の網羅率が出るかを試す。出ればそれを使う。出なければ c8 を開発用の依存に足す（その時に owner の決定） | この段階の Q1 = X。Shirube・AUN・Onza は Node の組込みで測ると決めてあり（iyasaka-arc#49 6336689921）、そろえば道具が 1 つで済む |

## 試験と確かめ

| ID | 要件 | 確かめ方 |
|----|------|----------|
| NFR10.1 | PostgreSQL の試験は、試験のたびに立ち上げた専用の PostgreSQL で、手順に書いた準備（手元の機械の PostgreSQL の道具）のほかは人の手を入れずに回せる。同じ準備で 2 回流せば同じ結果 | 試験の命令を 2 回流して結果を比べる |
| NFR10.2 | 行の網羅率 80% を床にし、統合の前に確かめる（team.md の Testing Posture） | 網羅率の道具の出力。CI に入れるのは workflow の変更で、その時に owner の exact-head |

## 後で決める物

- CI に網羅率の確かめと PostgreSQL の試験を入れること（workflow の変更、owner の exact-head）
- Node 18・20 は Node の提供元の支えが終わっている。Kusabi の対応する版を上げるかは、この単位の外の別の決定として扱う
