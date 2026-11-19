# 実現性と制約 — 質問

意図の文書（`ideation/intent-capture/intent-statement.md`）と市場調査の 3 つの文書（`ideation/market-research/competitive-analysis.md`・`market-trends.md`・`build-vs-buy.md`）を受けて、最初の版を作れるか、何に縛られるかを確かめます。

## Q1. [開発者] つなぐ既存の仕組み（select all that apply）

最初の版がつながる必要のある社内の仕組みを確認します。つなぐ先が多いほど、作る量と止まる所が増えます。

A. AUN（Claude と Codex の席の間の連絡）
B. 共通基盤のエージェントの管理（主体・席・在否。席が誰かを決める所）
C. 今の Kusabi の DB と道具（v0.3.0。決定・作業の状態・学びの記録と回復の道具）
D. Claude Code・Codex の組込みの記憶（読み込む、または書き出す）
E. Not yet defined（まだ決まっていない）
X. Other (please specify)

[Answer]: B, C（arc の下書き。B = 席が誰かは共通基盤のエージェントの管理で決める = iyasaka-arc#49 6290511960。C = 今の Kusabi を土台に作る = この段の前の市場調査 Q4。A の AUN との連動は、AUN の意図の文書で「今回は考えない」。D の組込みの記憶は比べる相手にとどめる = 市場調査 Q7）

## Q2. [開発者] 作る技術の前提

今の Kusabi は TypeScript・Node.js・PostgreSQL で動いています。最初の版でこの前提を変えるかを確認します。

A. 変えない（今の Kusabi と同じ前提で作る）
B. 必要なら変えてよい（理由を設計の段階で示す）
C. Not yet defined（まだ決まっていない）
X. Other (please specify)

[Answer]: A（arc の下書き。今の repo は TypeScript・Node.js・PostgreSQL（package.json、wasurezu 0.3.0）。今の Kusabi を土台に作る = 市場調査 Q4）

## Q3. [運用担当] 自社の DB を置く場所

使い始めは「社内の開発の席で、自社の DB から」と決まっています（意図の文書）。その自社の DB をどこに置くかを確認します。

A. 今の Kusabi の DB と同じ所
B. 共通基盤の DB と同じ所
C. 自社の VPS などの別の所
D. Not yet defined（まだ決まっていない）
X. Other (please specify)

[Answer]: B（arc の下書き。共通基盤 0.2 は 1 つの PostgreSQL の DB に common・shirube・aun・kusabi・kodama・onza の schema を置く設計 = onza docs/common/0.2。この Mac の DB suite は作ってある = iyasaka-arc#49 6289421859。そこへ Kusabi の schema を入れる時は保護面として Owner の決定が要る）

## Q4. [運用担当] 顧客の DB に置く形を試す環境

意図の文書では「顧客の DB に置く形は試験の環境で確かめる」としています。その試験の環境を誰が用意するかを確認します。

A. 自社で、顧客役の DB を用意して試す
B. 実在の顧客（施設）に協力してもらう
C. Not yet defined（まだ決まっていない）
X. Other (please specify)

[Answer]: A（arc の下書き。最初の版は社内の開発の席で使い始め、顧客の DB に置く形は試験の環境で確かめる = 意図の Q13。施設の顧客への提供は後の版 = 市場調査 Q5）

## Q5. [事業責任者] 守る決まり（select all that apply）

最初の版が守る必要のある決まりを確認します。流れの文書で、個人情報保護法の外国の第三者への提供のガイドラインを挙げています。

A. 個人情報保護法（顧客の仕事の記憶に個人データが入る場合）
B. 顧客企業ごとの社内の決まり（データの置き場所・持ち出し）
C. 自社の開発の決まり（Shirube 開発規格。参照される行は消さない、DB の作りの変更は戻せる形にする、など）
D. None（特に意識する決まりはない）
E. Not yet defined（まだ決まっていない）
X. Other (please specify)

[Answer]: A, B, C, X. 記録は自社か顧客の DB の中で完結する（arc の下書き。A・B は最初の版から顧客ごとに置き場所を選べる形にするため設計で守る = 意図の Q4。C = 全製品で Shirube 開発規格を使う = iyasaka-arc#49 5902619032。X = 6327956142）

## Q6. [事業責任者] 始められる条件

Kusabi の新しい実装は、制御系が 1 周回るまで止めることになっています（T102。iyasaka-arc#49 6329622282 でも「止めていることは変わらない」とされています）。最初の版を、この停止とどう合わせるかを確認します。

A. 停止が解けてから作る。それまでは設計の段階までにとどめる
B. 停止の間も設計の段階まで進め、実装は停止が解けてから
C. 最初の版だけ停止の対象から外して先に作る（owner の決定が要る）
D. Not yet defined（まだ決まっていない）
X. Other (please specify)

[Answer]: B（arc の下書き。止めているのは新しい実装 = iyasaka-arc#49 6284653618。実装を待つ間に各 repo の Inception を揃える = 6308341298）

## Q7. [事業責任者] 費用

最初の版にかけられる費用を確認します。

A. 新しい費用はかけない（自社の機械と今ある DB の範囲で作る）
B. 顧客の DB に置く形を試す環境には費用をかけてよい
C. Not yet defined（まだ決まっていない）
X. Other (please specify)

[Answer]: X. 新しい費用・有料サービスは Owner の決定なしに使わない。顧客役の DB の試験の環境も、まず自社の機械で用意する（arc の下書き。出典: 新しい外部依存と課金は Owner が決める = rules escalation-policy。AUN の答えと同じ形）

## Q8. [運用担当] 今の Kusabi の DB にある記録の扱い

Q3 で、自社の DB は「共通基盤の DB と同じ所」になりました（今の Kusabi の DB と同じ所ではない）。今の Kusabi の DB には、社内の席が書いた決定・作業の状態・学びが既にあります。最初の版で、それをどう扱うかを確認します。なお、意図の文書で最初の版でやらないとした「DB 間の移行・同期」は自社の DB と顧客の DB の間の話で、この質問とは別です。

A. 今の記録を共通基盤の DB へ移す（移した後も元の DB は消さずに残す）
B. 今の DB は読むだけにして残し、新しい記録から共通基盤の DB に置く
C. 最初の版は今の Kusabi の DB を使い続け、共通基盤の DB へ移るのは後の版にする
D. Not yet defined（まだ決まっていない）
X. Other (please specify)

（arc の勧め: A。成功の条件「担当交代と再起動の後に、決定・作業の状態・学びを 100% 取り出せる」は今ある記録にも効くので、記録が 2 つの DB に分かれる B より、移して 1 か所から引ける A が合う。元の DB を消さずに残すのは、参照される行を消さない決まりと、DB の変更を戻せる形にする決まりに合う = Shirube 開発規格 S1・S6。C は Q3 の答え（共通基盤の DB）と食い違う。実際に移す作業は DB の変更なので、その時に Owner の決定が要る）

[Answer]: X. A（今の記録を共通基盤の DB へ移し、元は消さずに残す）。移す時は、今の記憶の持ち主（agent_id・project）と共通基盤の席の対応表（Owner  が承認）を通し、対応の無い記録は推測でつながない。今の記録は席ごとに置き場所が違う（SQLite の file と  PostgreSQL）ので、設計の段で棚卸ししてから移す（共通基盤 0.2 の段階導入の決まり）

## Consolidated Summary Confirmation

- 答えの扱い: Q1〜Q7 は arc の下書きを owner が done で確定したもの、Q8 は owner がこの会話で答えたもの
- つなぐ仕組み: 共通基盤のエージェントの管理（席が誰かを決める所）と、今の Kusabi の DB と道具。AUN との連動は今回は考えない。組込みの記憶は比べる相手にとどめる（Q1）
- 技術の前提: 変えない（TypeScript・Node.js・PostgreSQL）（Q2）
- 自社の DB: 共通基盤の DB と同じ所。そこへ Kusabi の置き場を入れる時は、保護面として Owner の決定が要る（Q3）
- 顧客の DB の試験: 自社で顧客役の DB を用意して試す（Q4）
- 守る決まり: 個人情報保護法、顧客企業ごとの社内の決まり、Shirube 開発規格、記録は自社か顧客の DB の中で完結（Q5）
- 始められる条件: 停止の間も設計の段階まで進め、実装は停止が解けてから（Q6）
- 費用: 新しい費用・有料サービスは Owner の決定なしに使わない。顧客役の DB の試験の環境も、まず自社の機械で用意する（Q7）
- 今の記録: 共通基盤の DB へ移し、元は消さずに残す。移す時は、今の記憶の持ち主（agent_id・project）と共通基盤の席の対応表（Owner が承認）を通し、対応の無い記録は推測でつながない。席ごとに置き場所が違う（SQLite のファイルと PostgreSQL）ので、設計の段で棚卸ししてから移す（Q8）

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
