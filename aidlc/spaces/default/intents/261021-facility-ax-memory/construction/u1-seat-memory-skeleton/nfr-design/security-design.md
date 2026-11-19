# U1 の安全の設計

- 入力: 安全の要件（`construction/u1-seat-memory-skeleton/nfr-requirements/security-requirements.md` の NFR1.1・NFR1.2・NFR2.1・NFR3.1・NFR8.1〜NFR8.3）、取り決め（`inception/contract-design/contract-summary.md` の C4・C5）、共通基盤 0.2 の権限の決まり（onza main 5beb404 の `common/0.2/sql/020_acl.sql`）、共通基盤の設計（`docs/common/0.2/architecture.md` §4）

## 役割と権限

| 役割 | ログイン | 持つ物・許す事 | 許さない事 |
|------|---------|---------------|-----------|
| `kusabi_owner` | しない（NOLOGIN） | Kusabi の置き場（`kusabi`）・決定の表・公開関数の持ち主。共通基盤の `common_verify_caller` を与える（共通基盤の決まり「製品の保存・読み出しの関数の持ち主に与える」） | ログイン |
| 席の DB の利用者（席ごとに 1 つ） | する（SCRAM-SHA-256） | Kusabi の公開関数の実行だけ。共通基盤の `principal_login` で主体と対応する | Kusabi の表・共通基盤の表の読み書き、`common.verify_current_tx` の直接の実行 |
| 共通基盤の役割（`common_owner`・`common_verify_owner`・`common_verify_caller`） | しない | 共通基盤の配布物のとおり（変えない写し） | — |

- Kusabi の置き場と表の権限は、すべての人（PUBLIC）から外す。
- 試験の DB の中では、試験の手順がこれらの役割と、試験の席の DB の利用者を作って消す。本番の DB に作るのは展開の段で owner の決定の後（資格情報の用意は保護面）。

## 確かめの流れ

```text
seat calls kusabi.save_decision(input)        -- 席の DB の利用者として
  -> runs as kusabi_owner (SECURITY DEFINER, search_path = pg_catalog, pg_temp)
  -> common.verify_current_tx(...)            -- session_user = 席の DB の利用者で確かめる
  -> insert into kusabi.decisions (... verified refs ...)
  -> one transaction
```

- 本人の証拠は `session_user`（席の DB の利用者）だけ。引数・環境の値（`AGENT_MEMORY_AGENT_ID` など）を本人の証拠にしない（NFR3.1）。
- 読み出しの関数は、確かめた席と同じ席・同じ所属範囲の決定だけを返す（NFR2.1）。
- 関数の中の名前はすべて置き場つきで書き、探す場所を固定して、ほかの置き場の同じ名前に取り替えられないようにする。

## 秘密と外への送り出し

- DB の資格情報は環境（`AGENT_MEMORY_DATABASE_URL`）から読み、Kusabi は保存しない（NFR8.3）。
- 失敗の文・起動の時の文脈・道具の応答・呼出しの記録は、今の伏せ字の処理（`src/redact.ts` の URL の資格情報・DATABASE_URL・資格情報の環境変数の形）を通してから出す。
- この Mac の外の DB につなぐ時は、確かめつきの TLS（証明書とホスト名を確かめる）を必ず使う。この Mac の中の試験の DB は、手元の接続だけを受け付ける形で立ち上げる（NFR8.1）。
- U1 の共通基盤の形の道のりには、外のサービスを呼ぶコードを置かない。埋め込みの呼出しは共通基盤の形では通らない（NFR1.2）。
- 呼出しの記録は、道具の名前・記録の ID・時刻・結果の 4 つだけを書く（NFR1.1）。
