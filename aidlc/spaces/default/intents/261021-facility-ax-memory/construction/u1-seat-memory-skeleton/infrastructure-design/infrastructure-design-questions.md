# U1 薄い一本の基盤の設計（Infrastructure Design）— 案と質問

U1 の非機能の設計（`construction/u1-seat-memory-skeleton/nfr-design/` の 6 つ）・振る舞いの仕様（`construction/u1-seat-memory-skeleton/functional-design/functional-spec.md`）・部品の一覧（`inception/domain-design/components.md`）・取り決め（`inception/contract-design/contract-summary.md`）・今の CI（`.github/workflows/ci.yml`）・進め方（team.md の Testing Posture・Deployment）から、U1 の基盤の案を出し、owner の判断が要る所だけを聞きます。

Kusabi は AWS などの外の雲（cloud）を使わない。基盤は、この Mac・GitHub Actions の CI・中身の決まった版を席の束ごとに配る今の展開の仕組み（`docs/operations/KUSABI_ALPHA_OBS05_FLEET_ROLLOUT.md`）だけ。

## 案（聞き直さない所）

- **U1 の置き場所**: U1 は本番に入らない。動かすのは試験の DB（試験のたびに立ち上げる専用の PostgreSQL 17）と、本物の Codex と Claude Code の会話での 1 回ずつの確かめだけ
- **試験の DB**: この Mac の PostgreSQL 17 の道具（initdb・pg_ctl・postgres）で、一時的な場所に、空いている port・手元の接続だけを受け付ける形で立ち上げ、試験の後に止めて消す。この Mac の今の PostgreSQL（suite・agent_comms）には触れない
- **共通基盤の写し**: 共通基盤 0.2 の SQL 3 つを Kusabi の repo の決まった場所に変えない写しで置き、sha256 を確かめる試験を持つ
- **展開**: U1 では席に配らない（中身の決まった版を作らない）。本番の suite の DB に Kusabi の置き場を入れること・席の展開は、すべての Bolt の後の展開の段で owner の決定の後
- **秘密**: DB の資格情報は環境から渡す。CI と試験の DB の資格情報は試験の中で作って消し、保存しない
- **観測**: 手元の呼出しの記録と、道具・起動の口の失敗の名前だけ。外の監視のサービスは使わない

## Q1. CI に、網羅率の確かめと共通基盤の写しの試験を入れる PR の分け方

team.md の Testing Posture は「行の網羅率 80% を床にし、統合の前に CI で確かめる」。U1 を統合する前に、CI に網羅率の確かめ（と、共通基盤の写しの sha256 の試験）を入れる必要がある。CI の workflow を変えるのは保護面で、owner の exact-head が要る。PostgreSQL の試験は、置き場所の設計が固まるまで手元で回す（team.md）。

A. workflow の変更だけの小さな PR を先に出し、owner の exact-head を取って統合する。U1 の PR はコードと試験だけにする
B. U1 の PR に workflow の変更を含め、その PR の head に owner の exact-head を取る
C. Not yet defined（まだ決まっていない）
X. Other (please specify)

（勧め: A。保護面の変更（workflow）を、コードの変更から分けて 1 つの PR で 1 つの関心にできる。owner は workflow の差分だけを見て決められ、U1 のコードの PR が監査で直されても、exact-head を取り直さずに済む。網羅率の測り方（Node の組込みか c8 か）は、コードを書く段の初めに試して決めるので、workflow の PR はその後に出す）

[Answer]: A（arc の下書き。保護面の変更を 1 つの関心の小さな PR に分け、Owner は workflow の差分だけを見て exact-head を決められる。U1 のコードが監査で直されても exact-head を取り直さずに済む = Shirube 開発規格の 1 PR 1 関心、Protected surface = owner gate。あわせて、workflow の PR を出す前に、今の Kusabi の試験の行の網羅率を測る。80% に届かない時は、床を CI で止める形のまま入れると今の全部の PR が止まるので、床をどこに当てるか（repo の全体か、変えた所か）を Owner に伺い、決まり（iyasaka-arc#49 6336689921 の「弱めない」）を緩めずに入れる方法を決めてから PR を出す。Shirube が自分の保護面の変更を 1 本にまとめた形（iyasaka-arc#49 6354019047）とも同じ考え）

## Consolidated Summary Confirmation

- 案のとおり: U1 は本番に入らず、試験の DB（試験のたびに専用の PostgreSQL 17 を立ち上げて消す。手元の接続だけ。今の PostgreSQL に触れない）と本物の会話での 1 回ずつの確かめだけで動く。共通基盤 0.2 の SQL 3 つは変えない写しで置き sha256 を試験で確かめる。U1 では席に配らない。資格情報は環境から渡し、試験の中で作って消す。外の監視は使わない
- CI に網羅率の確かめと写しの試験を入れるのは、workflow の変更だけの小さな PR を先に出して owner の exact-head を取る。U1 の PR はコードと試験だけ。その PR を出す前に今の Kusabi の試験の行の網羅率を測り、80% に届かない時は、床をどこに当てるか（repo の全体か、変えた所か）を owner に伺い、決まりを緩めずに入れる方法を決めてから PR を出す（Q1 = A）

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
