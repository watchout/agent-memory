# U1 薄い一本の非機能の要件（NFR Requirements）— 既定と質問

U1 の振る舞いの設計（`construction/u1-seat-memory-skeleton/functional-design/functional-spec.md`・`rules.md`）・要件（`inception/requirements-analysis/requirements.md` の NFR1〜NFR10）・取り決め（`inception/contract-design/contract-summary.md`）・使っている技術（`aidlc/spaces/default/codekb/agent-memory/technology-stack.md`）・進め方（team.md の Testing Posture）から、U1 の非機能の要件の既定を置き、owner の判断が要る所だけを聞きます。

## 確かめたこと

- onza main 5beb404 の共通基盤 0.2 の SQL 3 つ（`001_schema.sql`・`010_verify_current_tx.sql`・`020_acl.sql`）の sha256 は、AUN が写した物（aun feature/bootstrap 2f9c204d の `tests/integration/vendor/onza-common-0.2`、onza 359f526d の版）と同じ（74a05751…・62aa83da…・53827714…）
- 取り決め C4（席には Kusabi の DB の関数だけを許す）の形なら、共通基盤の確かめ（`common.verify_current_tx`）は Kusabi の DB の関数の中で、同じ取引で呼べる。TS の adapter（Node 22.18 以上を求める）は要らない
- この Mac の PostgreSQL は 17.9（AUN の段 2 で共通基盤 0.2 を入れた所）。共通基盤の配布物は PostgreSQL 18 で試されている

## 既定（owner が後で直せる）

- **共通基盤の取り込み**: AUN と同じ形。共通基盤 0.2 の SQL 3 つを変えない写しで置き、sha256 が上の 3 つと一致することを試験で確かめる。TS の adapter は取り込まない。共通基盤 0.3（在否の表）は U1 では使わないので取り込まない
- **Node の版**: 共通基盤から Node の縛りは来ないので、U1 では Kusabi の今の対応（Node 18 以上、CI は 18・20・22）を変えない
- **時間の上限**: 起動の口の回復は全体で 7 秒の中（NFR4）。うち DB への接続は 2 秒、席の確かめと決定の読み出しは 3 秒を上限にし、超えたら回復を打ち切って起動を続ける。道具の 1 回の呼出しの DB の処理は 5 秒を上限にし、超えたら失敗として返す
- **速さ**: この Mac の DB で、1 つの席の決定が 1 万件までの時、決定を書く・読む道具の 95% が 500 ミリ秒以内
- **安全**: 席ごとの DB の利用者（パスワードは SCRAM-SHA-256）。この Mac の外の DB につなぐ時は確かめつきの TLS。席の DB の利用者には Kusabi の公開関数の実行だけを許す。関数は持ち主の権限で動き、探す場所（search_path）を固定する。資格情報は環境から読み、記録・応答・呼出しの記録に出さない
- **規模**: 社内の開発の席（数十）。1 つの MCP サーバーの process は DB への接続を 1 本だけ持つ
- **観測**: 呼出しの記録（中身なし）と、道具の失敗の名前。外への送り出し（外の監視のサービスなど）はしない

## Q1. 行の網羅率を測る道具

team.md の Testing Posture は「行の網羅率 80% を床にし、統合の前に CI で確かめる」（決定 iyasaka-arc#49 6336689921）。今の試験は tsx で直接動かす自前のスクリプトで、Node の組込みの網羅率（`--experimental-test-coverage`）は node:test の試験にしか効かない。測る道具を決める。

A. c8 を開発用の依存に足す（Node の組込みの V8 の網羅率を、tsx のスクリプトのまま集めて行の網羅率を出す。新しい依存なので owner の決定）
B. 試験を node:test の形に書き直し、Node の組込みの網羅率で測る（依存は足さないが、今の試験の書き直しが大きい）
C. Node の組込みの V8 の網羅率の生の記録（`NODE_V8_COVERAGE`）を、自前の小さな script で集計する（依存は足さないが、測る道具を自前で作る）
D. Not yet defined（まだ決まっていない）
X. Other (please specify)

（勧め: A。今の試験をそのまま測れ、手間が最も小さい。開発用だけで、席に配る物には入らない。C は道具を自前で作ることになり、確立した道具を借りる決まり（baseline ADR v7「規則より道具」）に合わない。どれでも、CI に網羅率の確かめを入れるのは workflow の変更で、その時に owner の exact-head が要る）

（arc の勧め: X「先に、今の tsx の script を書き直さずに `node --test --import tsx --experimental-test-coverage` で動かし、Node の組込みの網羅率で行の網羅率が出るかを試す。出れば依存を足さずにそれを使い、出なければ A（c8 を開発用の依存に足す、Owner の決定）」。理由: node:test の API を使わない script も、node --test の中では「exit 0 で通る試験の file」として動く。出るかどうかは確かめていない（arc は実際には試していない）。Shirube・AUN・Onza は Node の組込みの網羅率で測ると決めてあり = iyasaka-arc#49 6336689921 の 2、そろえられるなら道具が 1 つで済む。新しい依存を足すかは Owner が決める）

[Answer]: X（owner がこの会話で答えた: arc の勧めのとおり。まず今の試験を書き直さずに node --test --import tsx --experimental-test-coverage で動かし、Node の組込みで行の網羅率が出るかを試す。出れば依存を足さずにそれを使い、出なければ c8 を開発用の依存に足す（その時に owner の決定））

## Q2. PostgreSQL の試験に使う使い捨ての DB の置き方

薄い一本の試験と、後の単位の PostgreSQL の試験は、試験の中で共通基盤と Kusabi の置き場を作り、終われば消します。どこに作るかを決めます。

A. 試験のたびに、一時的な場所に専用の PostgreSQL を立ち上げ（この Mac に入っている PostgreSQL 17.9 の道具で、空いている port で動かす）、試験が終われば止めて消す。この Mac の今の PostgreSQL（suite の DB・agent_comms がある所）には触れない
B. この Mac の今の PostgreSQL の中に、試験のたびに使い捨ての DB を作って消す（試験用の管理の利用者が要る）
C. container（docker）で PostgreSQL を立ち上げて使う（今の docker-compose.yml の pgvector/pgvector:pg16）
D. Not yet defined（まだ決まっていない）
X. Other (please specify)

（勧め: A。動いている DB（suite・agent_comms）に一切触れないので、試験が本番の DB を壊すおそれが無い。試験ごとに作って消すので、毎回同じ状態から始まる。この Mac に PostgreSQL の道具はもう入っており、新しい費用も依存も無い。B は動いている DB の中に試験の DB と管理の利用者を作ることになる。C は docker（この Mac に 29.2.1 が入っている）で動かせるが、今の docker-compose.yml の版が 16 で、共通基盤の試された版（18）ともこの Mac の版（17.9）とも違う。AUN の結合の試験も同じ形にそろえると、owner に伺うのが 1 回で済む）

（arc の勧め: A。動いている DB（suite・agent_comms）に一切触れず、毎回同じ状態から始まる。この Mac の PostgreSQL 17.9 の道具で済み、新しい依存も費用も無い。AUN の U1 の結合の試験も使い捨ての PostgreSQL が無くて止まっている（AUN の会話の 10/23 のまとめ）ので、同じ形を AUN にも当てる決定として 1 回で伺う。決まったら arc が #49 に Kusabi と AUN の両方の決定として記録する）

[Answer]: A（owner がこの会話で答えた）

## Consolidated Summary Confirmation

- 既定のとおり: 共通基盤 0.2 の SQL 3 つを変えない写しで取り込み sha256 を試験で確かめる（AUN と同じ。TS の adapter と 0.3 は取り込まない）、Node の対応は今のまま、起動の口は全体 7 秒（接続 2 秒・確かめと読み出し 3 秒）、道具の DB の処理は 5 秒まで、決定 1 万件までで書く・読むの 95% が 500 ミリ秒以内、席ごとの DB の利用者（SCRAM-SHA-256）・外の DB には確かめつきの TLS・関数の実行だけを許す・探す場所を固定・資格情報を出さない、接続は 1 本、外への送り出しはしない
- 行の網羅率 80% は、まず今の試験を書き直さずに `node --test --import tsx --experimental-test-coverage` で動かし、Node の組込みで出るかを試す。出れば依存を足さずにそれを使い、出なければ c8 を開発用の依存に足す（その時に owner の決定）。CI に網羅率の確かめを入れる時は owner の exact-head（Q1 = X）
- PostgreSQL の試験は、試験のたびに一時的な場所に専用の PostgreSQL 17 を立ち上げ、終われば止めて消す。この Mac の今の PostgreSQL（suite・agent_comms）には触れない。AUN の結合の試験にも同じ形を当てる（Q2 = A）

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
