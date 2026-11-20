# U1 薄い一本の非機能の設計（NFR Design）— 設計の要点

U1 の非機能の要件（`construction/u1-seat-memory-skeleton/nfr-requirements/` の 6 つ）・振る舞いの仕様（`construction/u1-seat-memory-skeleton/functional-design/functional-spec.md`）・取り決め（`inception/contract-design/contract-summary.md`）・共通基盤 0.2 の権限の決まり（onza main 5beb404 の `common/0.2/sql/020_acl.sql`）から、設計を起こします。

## 質問

この段階で owner に聞く問いは無い。設計は、承認済みの要件（NFR1.1〜NFR10.2）と共通基盤の決まりからそのまま決まる。下の要点を確かめていただく。

## 設計の要点

- **権限の形**: Kusabi の置き場（`kusabi`）と関数の持ち主を NOLOGIN の役割 `kusabi_owner` にし、`kusabi_owner` に共通基盤の `common_verify_caller` を与える（共通基盤の決まり「製品の保存・読み出しの関数の持ち主に与える」）。席の DB の利用者（LOGIN、SCRAM-SHA-256）には Kusabi の公開関数の実行だけを与え、Kusabi の表・共通基盤の表への権限は与えない
- **確かめの位置**: Kusabi の公開関数は持ち主の権限で動き（SECURITY DEFINER）、探す場所を `pg_catalog, pg_temp` に固定し、名前は置き場つきで書く。関数の中で `common.verify_current_tx` を呼び、席の DB の利用者（`session_user`）で確かめる。確かめと決定の保存は 1 つの関数の呼出し = 1 つの取引
- **共通基盤の登録**: 試験の中で、試験の所属範囲に Kusabi を使う製品（`common.consumer` の product = kusabi）として登録し、試験の席の主体・席・割り当て・DB の利用者の対応を共通基盤の管理の操作で作る
- **時間**: 取引ごとに `statement_timeout` を 5 秒、`lock_timeout` を 1 秒にする。起動の口は全体 7 秒の締め切りを持ち、接続 2 秒・確かめと読み出し 3 秒を超えたら打ち切る
- **接続**: MCP サーバーの process ごとに接続を 1 本だけ、最初の道具の呼出しでつなぐ。切れたら次の呼出しでつなぎ直す。接続をまとめて持つ仕組みは使わない
- **探しやすさ**: 決定の表に「席・所属範囲・状態・時刻の新しい順」の索引を置く
- **秘密**: 失敗の文・起動の文脈・呼出しの記録は、今の伏せ字の処理（`src/redact.ts` の URL の資格情報・DATABASE_URL の形）を通してから出す
- **呼出しの記録**: 1 行 1 件の JSON（道具の名前・記録の ID・時刻・結果）。今の場所（`~/.agent-memory/calls.log`）のまま
- **失敗の名前**: 共通基盤の失敗の番号（OC001〜OC011）から Kusabi の失敗の名前への写しの表を 1 か所に置く（決まり BR2.5）
- **作りの変更**: Kusabi の置き場に足す変更は、当てる版と戻す版を対で持ち、戻した後に前の試験が通ることを試験で確かめる。消す関数は作らない
- **試験の DB**: 試験のたびに一時的な場所で initdb・pg_ctl で PostgreSQL を空いている port に立ち上げ、共通基盤 0.2 の SQL 3 つ（sha256 を確かめた写し）と Kusabi の置き場を当てて、終われば止めて消す
- **網羅率**: `node --test --import tsx --experimental-test-coverage` で行の網羅率が出るかを、コードを書く段の初めに試す。出なければ c8（その時に owner の決定）

## Consolidated Summary Confirmation

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
