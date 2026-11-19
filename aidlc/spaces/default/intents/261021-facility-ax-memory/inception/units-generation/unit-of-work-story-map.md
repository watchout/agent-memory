# 単位と利用者の話の対応

- 1 行が 1 つの話（`stories.md` の US）。行に名を挙げた単位は、その話の一部を作る。名を挙げた単位は、その行のすべての受入の条件を、自分の Functional Design で扱う（自分の受け持ちでない条件は、どの単位が受け持つかを書く）。

## 対応

| Story | Unit ID | Directory |
|-------|---------|-----------|
| US1.1 | U1 | u1-seat-memory-skeleton |
| US1.2 | U1 | u1-seat-memory-skeleton |
| US1.3 | U1 | u1-seat-memory-skeleton |
| US2.1 | U2 | u2-memory-records |
| US2.2 | U2 | u2-memory-records |
| US2.3 | U2 | u2-memory-records |
| US2.4 | U2; U3; U6 | u2-memory-records; u3-recovery-and-hosts; u6-conversation-ingest |
| US3.1 | U1; U3; U4 | u1-seat-memory-skeleton; u3-recovery-and-hosts; u4-customer-placement |
| US3.2 | U3 | u3-recovery-and-hosts |
| US3.3 | U3 | u3-recovery-and-hosts |
| US3.4 | U3 | u3-recovery-and-hosts |
| US4.1 | U8 | u8-scenario-harness |
| US4.2 | U7; U8 | u7-legacy-migration; u8-scenario-harness |
| US4.3 | U8 | u8-scenario-harness |
| US5.1 | U1; U4 | u1-seat-memory-skeleton; u4-customer-placement |
| US5.2 | U4 | u4-customer-placement |
| US5.3 | U1 | u1-seat-memory-skeleton |
| US5.4 | U1 | u1-seat-memory-skeleton |
| US6.1 | U5 | u5-access-report |
| US6.2 | U5 | u5-access-report |
| US7.1 | U7 | u7-legacy-migration |
| US7.2 | U7 | u7-legacy-migration |
| US7.3 | U7 | u7-legacy-migration |
| US7.4 | U7 | u7-legacy-migration |
| US8.1 | U6 | u6-conversation-ingest |
| US9.1 | U1; U2 | u1-seat-memory-skeleton; u2-memory-records |
| US9.2 | U2; U3 | u2-memory-records; u3-recovery-and-hosts |
| US9.3 | U1; U4 | u1-seat-memory-skeleton; u4-customer-placement |

## 複数の単位にまたがる話

| Story | 単位ごとの受け持ち |
|-------|-------------------|
| US2.4 | U2 = 記録の読み出し・検索で所属範囲をまたがない。U3 = 回復の内容で所属範囲をまたがない。U6 = 会話の読み出しで所属範囲をまたがない |
| US3.1 | U1 = 場面 S3（AC3.1.3）の最小の形（決定だけ）。U3 = 場面 S1・S2（AC3.1.1・AC3.1.2）と、S3 の作業の状態・学びまで。U4 = 顧客の DB からの回復（AC3.1.4） |
| US4.2 | U7 = 結べなかった古い記録の件数を持ち、読み出しの口を出す。U8 = 試験の結果に割合とは別の行で出す |
| US5.1 | U1 = 自社の置き場所（AC5.1.1）と、置き場所が決まらない時の失敗（AC5.1.3）。U4 = 顧客役の DB（AC5.1.2） |
| US9.1 | U1 = 呼出しの記録に中身を書かない（AC9.1.2）。U2 = 埋め込みを作らず外へ送らない、文字の検索（AC9.1.1・AC9.1.3） |
| US9.2 | U2 = ほかの席の決定を置き換えさせない（AC9.2.3）。U3 = 回復の設定は自分の物だけ（AC9.2.1・AC9.2.2） |
| US9.3 | U1 = 自社の DB の資格情報（AC9.3.1・AC9.3.2）。U4 = 顧客の DB の資格情報 |

## 単位の中の作る順（案）

| 単位 | 中の順 |
|------|--------|
| U1 | 場面 S3 の最小の試験を先に書く → Placement → SeatIdentity → 決定の表と道具 → Codex の席で書く → Claude Code の起動の口で読む |
| U2 | 仕事の ID と読める範囲の受入の条件の試験を先に書く → 作業の状態・学び → 仕事の ID → 読める範囲 → 書き換えの権限 → 文字の検索 |
| U3 | 場面 S1・S2 の試験を先に書く → 回復の内容 → 仕事の束 → データとしての出し方・省略 → 期限 → Gemini の起動の口 |
| U4 | 顧客役の DB の試験を先に書く → 顧客の DB での確かめと保存 → 写しが無いこと → 資格情報 |
| U5 | 食い違いの試験を先に書く → 権限の読み取り → 登録との並べ → 観測できず |
| U6 | 重ならない取り込みの試験を先に書く → 伏せ字 → 置き場所への取り込み → 最近の会話の読み出し |
| U7 | 元を変えないことの試験を先に書く → 棚卸し → 対応表 → 移し → 何度流しても同じ → 戻す手順 |
| U8 | 数え方の決まりの試験を先に書く → 場面 S1〜S5 → 結果の出し方 → 本物の席での確かめの証拠の置き場 |

（どの単位から作るかは計画の段階で決める）

## 対応の確かめ

- 話 28 個のすべてが、1 つ以上の単位に結ばれている。
- 単位 8 つのすべてに、1 つ以上の話がある（U1 = 9 行、U2 = 6 行、U3 = 6 行、U4 = 4 行、U5 = 2 行、U6 = 2 行、U7 = 5 行、U8 = 3 行）。
