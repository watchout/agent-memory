# 作業の単位に分ける（Units Generation）— 分け方の案と質問

部品の一覧（`inception/domain-design/components.md`）・決定の記録（`decisions.md`）・要件・利用者の話から、作業の単位（Unit）に分ける案を出し、owner の判断が要る所だけを聞きます。この段階で決めるのは単位の境目と依存の形まで。どれから作るか（順番）は次の計画の段階（Delivery Planning）で決めます。

## 決まっていること（聞き直さない）

- 最初の単位は「端から端まで通る薄い一本」にする。動くことを owner が確かめてから残りに進む（team.md の Walking Skeleton）。中身は「Codex の席が決定を 1 件書き、再起動の後に Claude Code の席が同じ記憶をその DB から読み戻す」
- 置き方: 今の版と同じく、1 つのパッケージ（wasurezu）の中に作り、席ごとに 1 つの MCP サーバーの process が動く（制約 C-01、今のコードの読み解き）。移しは別のコマンド、試験は試験のコマンドとして同じパッケージに入れる
- DB の作りは、単位ごとに必要な表を足す形にし、どの変更にも試した戻し方を付ける（NFR6）。最初の単位が要る表から作る
- 実装は停止（T102）が解けてから。この段階は設計の段階の続き（D-20）

## 分け方の案

| ID | 単位 | 種類 | 中身 | 主な部品 |
|----|------|------|------|----------|
| U1 | u1-seat-memory-skeleton | service | 薄い一本: 専用の設定で置き場所を決め（届かない時に逃げない）、共通基盤で席を確かめ、決定を 1 件書き、再起動の後に別の種類の席の起動の口で読み戻す。呼出しの記録に中身を書かない | Placement・SeatIdentity・MemoryRecords（決定だけ）・Recovery（起動の時の決定だけ）・ToolSurface・HostAdapters（Claude Code・Codex） |
| U2 | u2-memory-records | service | 作業の状態と学び、仕事の ID、読める範囲（席だけ・同じ所属範囲・所属範囲をまたがない）、書き換えの権限、文字の検索、埋め込みを作らない | MemoryRecords |
| U3 | u3-recovery-and-hosts | service | 回復の内容のすべて（作業・決定・学び・最近の会話）、仕事の ID でまとめて返す束、データとしての出し方と省略の書き方、期限、回復の設定、Gemini の起動の口 | Recovery・HostAdapters |
| U4 | u4-customer-placement | service | 顧客の DB の形（共通基盤と Kusabi の置き場を持つ 1 つの DB）で動くこと、ほかの置き場所に写しを置かないこと、資格情報を出さないこと | Placement・SeatIdentity |
| U5 | u5-access-report | service | 置き場所と読み書きできる者の一覧、共通基盤の登録との食い違い、観測できない時の扱い | AccessReport |
| U6 | u6-conversation-ingest | service | 会話の記録を新しい置き場所に取り込む（伏せ字・隠れた推論を外す・重ねない） | ConversationIngest |
| U7 | u7-legacy-migration | service | 今の記録の棚卸し、対応表に従う移し、つながっていない記録の件数、何度流しても同じ、戻す手順の試し | LegacyMigration |
| U8 | u8-scenario-harness | library | 場面 S1〜S5 の試験と数え方（起動の口と道具の呼出しを再現）、結果の出し方 | ScenarioHarness |

依存の案（「A は B に依存する」）:

- U2 → U1、U3 → U2、U4 → U1、U5 → U4、U6 → U2、U7 → U2・U6、U8 → U1
- U8（試験）は U1 にだけ依存する。場面の試験を実装より先に書く進め方（team.md の Testing Posture）に合わせ、試験は U2・U3 ができる前から書けて、できるまでは失敗する形にする
- 輪は無い

## Q1. 単位の細かさ

A. 上の案の 8 つ
B. もっと粗く 4 つにまとめる（U1 薄い一本／U2+U3 記録と回復／U4+U5 置き場所と一覧／U6+U7+U8 取り込み・移し・試験）
C. Not yet defined（まだ決まっていない）
X. Other (please specify)

（勧め: A。1 つの単位が 1 つか 2 つの部品と、1 つの能力の話の群に揃うので、単位ごとに独立して試せ、PR も小さくなる（独立の監査が見やすい）。B は単位の数が減るが、1 つの単位の中に関心が違う物（移しと試験など）が混ざり、監査の範囲が広くなる）

[Answer]: A（arc の下書き。1 つの単位が 1〜2 個の部品と 1 つの能力にそろい、PR 1〜2 本で監査しやすい大きさ。Shirube（7 つ）・AUN（6 つ）の作業の単位の段も同じ考えで分けた）

## Q2. 薄い一本（U1）を、どの DB で動かして確かめるか

最初の単位の確かめは、実際に端から端まで動くことを owner が見る形にします（team.md の Walking Skeleton）。

A. 自社の機械の試験の DB で確かめる。試験の中で、共通基盤 0.2・0.3 の置き場と Kusabi の置き場を作り、試験の席を登録して、終われば消す（共通基盤 0.2 の配布物も「隔離した合成の試験の DB 用」としている）
B. 手元の機械の共通基盤の DB（自社の本番の DB）で確かめる。Kusabi の置き場を入れるのは DB の作りの変更なので、owner の決定が先に要る
C. Not yet defined（まだ決まっていない）
X. Other (please specify)

（勧め: A。薄い一本は「部品がつながって動くか」を確かめる物で、本番の DB に触れずに確かめられる。本番の DB に Kusabi の置き場を入れるのは、展開の段で owner の決定を受けて行う（制約 C-07）。B だと、確かめる前に保護面の決定が要り、最初の一本が決定待ちで止まる）

[Answer]: A（arc の下書き。薄い一本は部品がつながるかを確かめる物で、本番の DB に触れずに確かめられる。本番の共通基盤の DB に Kusabi の置き場を入れるのは展開の段で Owner の決定 = 制約 C-07。ただし、手元の機械の PostgreSQL に使い捨ての試験の DB を作ること自体も DB の操作なので、作る時に Owner に伺う。AUN の結合の試験も同じ使い捨ての DB を要るので、Suite の試験の DB として 1 回にまとめて伺う）

## Consolidated Summary Confirmation

- 単位は 8 つ: U1 薄い一本（service）、U2 記録（service）、U3 回復と起動の口（service）、U4 顧客の DB の形（service）、U5 一覧（service）、U6 会話の取り込み（service）、U7 今の記録の移し（service）、U8 場面の試験（library）（Q1 = A）
- 依存: U2 → U1、U3 → U2、U4 → U1、U5 → U4、U6 → U2、U7 → U2・U6、U8 → U1。輪は無い。U8 は試験を先に書くため U1 にだけ依存する
- 置き方: 1 つのパッケージ（wasurezu）の中に作り、席ごとに 1 つの MCP サーバーの process。移しと試験は同じパッケージのコマンド。DB の作りは単位ごとに要る表を足し、戻し方を付ける
- 薄い一本（U1）は、自社の機械の使い捨ての試験の DB で確かめる。試験の中で共通基盤 0.2・0.3 と Kusabi の置き場を作り、終われば消す。使い捨ての試験の DB を手元の機械の PostgreSQL に作る時は、AUN の結合の試験の分とまとめて owner に伺う。本番の共通基盤の DB に Kusabi の置き場を入れるのは展開の段で owner の決定の後（Q2 = A）

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
