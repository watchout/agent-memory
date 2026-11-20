# U1 の基盤の仕様

- 入力: U1 の非機能の設計（`construction/u1-seat-memory-skeleton/nfr-design/` の performance-design・security-design・scalability-design・reliability-design・observability-design・logical-components）、振る舞いの仕様（`construction/u1-seat-memory-skeleton/functional-design/functional-spec.md`）、部品の一覧（`inception/domain-design/components.md`）、取り決め（`inception/contract-design/contract-summary.md`）、この段階の質問の答え
- Kusabi は外の雲（cloud）を使わない。基盤は手元の機械・GitHub Actions の CI・今の展開の仕組みだけ。

## Deployment

| Facet | Choice | Rationale |
|-------|--------|-----------|
| compute model | 席ごとの MCP サーバーの process と、起動の口の process（今の版と同じ）。U1 は席に配らず、試験と本物の会話の確かめでだけ動かす | 今の版の置き方（制約 C-01）。本番に入れるのは展開の段で owner の決定の後（制約 C-07） |
| networking topology | 席の process から DB へ直接つなぐ。試験の DB は手元の接続（手元の機械の中）だけを受け付ける。手元の機械の外の DB には確かめつきの TLS | NFR8.1 |
| storage strategy | 決定は置き場所の DB の Kusabi の置き場（`kusabi`）。呼出しの記録は手元の `~/.agent-memory/calls.log`（中身なし） | NFR1.1・取り決め C4 |
| environments | 試験の DB（試験のたびに立ち上げる専用の PostgreSQL）／本物の会話の確かめ（試験の DB を使う）／本番（自社 = 共通基盤の DB、顧客 = 顧客ごとの DB。U1 では使わない） | NFR10.1、ADR-001 |
| IaC approach | 試験の DB の立ち上げと片付けは、試験の手順（script）が行う。Kusabi の置き場の作りの変更は、当てる版と戻す版の SQL の対 | NFR6.1・NFR10.1 |
| resource sizing | 席は数十、席ごとに接続 1 本、1 席の決定は 1 万件まで | NFR4.5・NFR4.6 |

## Infrastructure Services

| Service | Role | Configuration | Notes |
|---------|------|---------------|-------|
| 試験の PostgreSQL | database | 手元の機械の initdb・pg_ctl・postgres で、一時的な場所に、空いている port・手元の接続だけで立ち上げる。試験の後に止めて場所ごと消す | 手元の機械で動いている今の PostgreSQLには触れない。AUN の結合の試験も同じ形 |
| 共通基盤 0.2 の置き場（試験の DB の `common`） | database | onza の SQL 3 つ（`001_schema.sql`・`010_verify_current_tx.sql`・`020_acl.sql`）の変えない写しを当てる。sha256 は 74a05751…・62aa83da…・53827714… | AUN の写しと同じ bytes |
| Kusabi の置き場（試験の DB の `kusabi`） | database | `kusabi_owner`（NOLOGIN、`common_verify_caller` を与える）・決定の表・索引（席・所属範囲・状態・時刻）・公開関数（保存・読み出し） | 席の DB の利用者には関数の実行だけ |
| 席の DB の利用者（試験の DB の中） | database | 試験の席ごとに 1 つ、SCRAM-SHA-256。共通基盤の `principal_login` で主体と対応させる | 試験の中で作って消す |
| 呼出しの記録 | other | 1 行 1 件の JSON（道具の名前・記録の ID・時刻・結果） | 外へ送らない |

## Shared Infrastructure

| Shared Resource | Owner Unit | Consumer Units | Access Boundary |
|-----------------|-----------|----------------|-----------------|
| Kusabi の置き場（`kusabi`） | U1（作り始め）。U2〜U7 が表と関数を足す | U2〜U8 | 席には公開関数の実行だけ。ほかの単位も表を直接読み書きしない |
| 共通基盤の置き場（`common`） | onza（共通基盤の持ち主） | U1・U4・U5 | 変えない写し。Kusabi は `common_verify_caller` として確かめの関数を呼ぶだけ |
| 試験の PostgreSQL の立ち上げの手順 | U1 | U2〜U8 | 試験のたびに作って消す。ほかの試験と場所・port を共にしない |
