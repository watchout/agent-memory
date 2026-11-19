# 証拠

## 見たもの

担当（release engineer）は別に立てず、この会話がその役として見た。ほかの担当による見直しは、この作業の範囲の設定で行わない（専門家を呼ばない設定）。

| 見たもの | 読み取ったこと |
|----------|----------------|
| git の履歴（統合 25 件・通常の commit 30 件、遠くの branch 170 本） | 変更ごとに branch を切り PR で統合。統合は merge commit と squash が混在。branch の名前は担当の印で始まる。Conventional commits。統合した branch は消していない |
| .github/workflows/ci.yml | main への push と PR で、Node 18・20・22 の型検査・ビルド・試験。PostgreSQL の試験は無い |
| .github/workflows/shirube-rapid-lite-gates-report.yml | Shirube の門の報告 |
| package.json の命令 | 試験は tsx で直接動かす自前のスクリプト。網羅率の道具は無い。runtime release の作成と公開の命令がある |
| scripts/build-kusabi-content-addressed-runtime-release.mjs | 統合済みの main から、中身の決まった版を `~/Developer/.kusabi-releases` に作る |
| docs/operations/KUSABI_ALPHA_OBS05_FLEET_ROLLOUT.md | 席の束ごとの展開（R1 → R2 → R3）、各束の健全さの確かめ、失敗時の設定の戻し |
| docs/operations/DEPLOYMENT.md・ENVIRONMENTS.md | 中身は「要記入」のまま |
| CLAUDE.md | 書き方の決まり、main への直接の commit の禁止、PR のレビュー必須 |
| コードの知識（aidlc/spaces/default/codekb/agent-memory/ の code-structure・technology-stack・dependencies・code-quality-assessment・architecture・business-overview） | 書式・静的検査の道具が無い、800 行を超えるファイルが 7 つ、試験の網羅率を測っていない、PostgreSQL の時に記憶の文が Voyage AI に送られうる |
| owner の決定（索引と決定の記録 D-01〜D-36） | 統合は監査 PASS の後に別の席（T129）、保護面は owner、Kusabi の実装は決まった順が来てから（D-32） |

## 面談の決定

| 問い | 答え | 誰が |
|------|------|------|
| Q1 統合の方式 | B（merge commit にそろえる。Shirube・AUN と同じ） | arc の下書き |
| Q2 薄い一本を先に作るか | A（作る） | arc の下書き |
| Q3 試験をいつ書くか | C（成功の条件の場面の試験を先に、細かい試験は実装の後） | arc の下書き |
| Q4 網羅率の床 | B（床は置かず、要件ごとの試験と場面の試験の 100% で判定） | owner がこの会話で答えた |
| Q5 PostgreSQL の試験の置き場 | C（最初は手元、置き場所の設計が固まったら CI に。その時に owner の exact-head） | owner がこの会話で答えた |
| Q6 展開の進め方 | B（今の形に加え、切り替えの前に戻す手順を試す） | arc の下書き |
| Q7 書式・静的検査の道具 | A（今のまま） | arc の下書き |
| Q8 固い決まり | A, B, C, D | arc の下書き |

- 答えのまとめは owner が「Looks correct」で確かめた（2026-10-22）。
- Q1 は、この会話の勧め（squash）ではなく、arc の下書き（merge commit。Shirube・AUN の進め方にそろえる）を採った。

## 確かでないこと

- 網羅率の床を置かない形が、AI-DLC の既定（この種類の作業は網羅率 80% の床）から外れる。作業の段階で網羅率の床を確かめる所では、この決まり（場面の試験の 100% と要件ごとの試験）で判定する。
- PostgreSQL の試験を CI に入れる時期は「置き場所の設計が固まった所」で、どの段階のどの出力を合図にするかは設計の段階で決める。
- 展開の手順の文書（docs/operations/DEPLOYMENT.md・ENVIRONMENTS.md）は「要記入」のまま。今回の取り組みで新しい置き場所への切り替えの手順を書く時に、どの文書に書くかは設計の段階で決める。
