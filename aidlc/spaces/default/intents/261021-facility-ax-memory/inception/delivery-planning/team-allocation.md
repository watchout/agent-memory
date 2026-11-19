# 受け持ちの割り当て

- **Bolt**（ボルト）は、作る段を 1 回通して、1 つ以上の作業の単位を「動く物」まで仕上げる一区切り。
- **mob**（モブ）は、1 つの Bolt を一緒に受け持つ顔ぶれのこと。この取り組みでは、人は owner お一人で、作業は自社の席（AI）が受け持つ。
- 入力: チームの編成（`ideation/team-formation/team-assessment.md`）、決定の記録（D-30・D-31・D-32）、作る順の計画（`bolt-plan.md`）、進め方（`inception/practices-discovery/team-practices.md`）、この段階の Q1 = A

## 役割（チームの編成の段の決定 D-30 から）

| 役割 | 受け持つ者 |
|------|-----------|
| 決定・承認・保護面（DB の作りの変更・席の起動・展開・資格情報など） | owner |
| 設計（単位ごとの設計の段の下書き） | arc（この AI-DLC の会話の問いに下書きし、owner が確かめる） |
| 単位ごとの設計の段を回す会話 | この AI-DLC の会話（aidlc-kusabi）。席の名簿に登録せず、統治の働き（配車・統合・監査の判定）をしない |
| 実行の配車と統合 | suite-lead（作者と別の席として、監査 PASS・head の一致の後に統合） |
| 実装（コードを書く段から） | kusabi の席。停止（T102）が解け、Kusabi の順番（D-32）が来てから |
| 独立の監査 | devauditor |
| 試験の使い捨ての Gemini の会話を起こす | CTO（owner の決定を受けて、D-31） |

## Bolt ごとの割り当て

どの Bolt も同じ顔ぶれ（mob は 1 つ）で、並べて作らずに順に進める。

| Bolt | 単位 | 単位ごとの設計の段 | コードを書く段 | 監査 | 統合 | owner の決定 |
|------|------|------------------|----------------|------|------|--------------|
| B1 | U1 薄い一本 | この会話（arc の下書き・owner の確かめ） | kusabi の席 | devauditor | suite-lead | 使い捨ての試験の DB を作ること（AUN の分とまとめて） |
| B2 | U8 場面の試験 | この会話 | kusabi の席 | devauditor | suite-lead | — |
| B3 | U2 記録 | この会話 | kusabi の席 | devauditor | suite-lead | — |
| B4 | U3 回復と起動の口 | この会話 | kusabi の席 | devauditor | suite-lead | 使い捨ての Gemini の会話（CTO が起こす） |
| B5 | U4 顧客の DB の形 | この会話 | kusabi の席 | devauditor | suite-lead | 顧客役の DB に共通基盤の置き場を入れること |
| B6 | U5 一覧 | この会話 | kusabi の席 | devauditor | suite-lead | — |
| B7 | U6 会話の取り込み | この会話 | kusabi の席 | devauditor | suite-lead | — |
| B8 | U7 今の記録の移し | この会話 | kusabi の席 | devauditor | suite-lead | 対応表の承認・共通基盤の DB への移し |

- kusabi の席を AI-DLC の作業場で起動してコードを書く段を回すかは、その段に来た時に owner に伺う（Q1 = A の下書きの補足）。
- 特別実装席（spe-dev）を使うかは、使う時に改めて決める（D-30）。

## 1 席に集まる負担

- 実装の席が 1 つ（kusabi）なので、Bolt を並べて作らない。単位は小さく分けてあり（PR 1〜2 本）、1 つの Bolt を監査・統合まで通してから次へ進む。
- 監査（devauditor）と統合（suite-lead）は Suite のほかの製品（Shirube・AUN・Onza・Tsumama）も受け持つ。Kusabi の順番が来るまでは、この取り組みは設計の段までにとどめ、監査・統合の席の負担を足さない。
