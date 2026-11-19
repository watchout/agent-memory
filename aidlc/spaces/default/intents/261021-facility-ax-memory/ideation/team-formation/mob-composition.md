# 作業の組み方

入力: 範囲の文書（`ideation/scope-definition/scope-document.md`）、能力の一覧（`ideation/scope-definition/intent-backlog.md`）、実現性の見立て（`ideation/feasibility/feasibility-assessment.md`）、体制の見立て（`team-assessment.md`）、役割と力の表（`skill-matrix.md`）。

## 作業ごとの組み方

| 作業 | 組み方 | 誰と誰 | 理由 |
|------|--------|--------|------|
| 要件と設計 | owner との対話で決める | owner と arc | 何をどうするかは owner との対話で決める（iyasaka-arc#49 6308414423） |
| 種類の違う席の間の引き継ぎ（P2）の見分け方 | 先に設計で決め、owner の承認を受ける | arc と owner、kusabi の席に相談 | いちばん不確かな所（能力の一覧の案の順 1） |
| 実装（P1〜P8） | 1 つの席が受け持つ | kusabi の席 | 実装の受け持ちは kusabi の席（体制の見立て） |
| 独立の監査 | 作った席とは別の席が見る | devauditor | 自分の作った物を自分で監査しない |
| 試験（P4） | 試験の場面で、種類の違う席の間で引き継ぎを確かめる | kusabi の席、Claude と Codex の席、CTO が起こす使い捨ての Gemini の会話 | 範囲の文書（試験の記録は合成のデータ） |
| 統合 | 作った席とは別の席が統合する | suite-lead | 監査済みの PR の統合（iyasaka-arc#49 6288848200） |

## 連絡の決まり

- 段階の進み具合と判断待ちは、段階が終わるたびにこの会話の中で owner に伝える。決まったことは iyasaka-arc#49 に記録し、agent-memory#330 に写す。（意図の文書）
- 正本は GitHub に置く。席への指示に対する確認事項は、その指示の GitHub の場所に書く。（iyasaka-arc#49 6287138298）
- 保護面（DB の置き場・記録の移し・対応表・使い捨ての会話・停止の解除）は、owner の決定が無ければ進めない。（範囲の文書）

## 上げ方（困った時）

| 困りごと | 上げる先 |
|---------|---------|
| 設計で決まっていない所に実装で当たった | arc |
| 配車や順番の都合 | suite-lead |
| 保護面に当たる操作 | owner |
| 監査で止まった | 作った席が直し、devauditor が見直す |

## 確かめていないこと

- 決まったことを iyasaka-arc#49 に記録し agent-memory#330 に写す作業を、どの席が受け持つか（体制の見立てと同じ）。
