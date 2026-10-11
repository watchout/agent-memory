# HTTP transport（MCP Streamable HTTP）

cell: K-HTTP-1（watchout/agent-memory#334）。設計: iyasaka-arc#57 6050184667。

同じ Kusabi（wasurezu）を、stdio に加えて MCP Streamable HTTP でも起動できる。tool の名前・入出力・store の呼び方は stdio と同じ。stdio の起動（`npm start`、`dist/index.js`、`npm run dev`）は変えていない。

## 起動

```sh
AGENT_MEMORY_HTTP_TOKENS_FILE=/path/to/tokens.json npm run kusabi:http
```

| 環境変数 | 既定 | 意味 |
|---|---|---|
| `AGENT_MEMORY_HTTP_TOKENS_FILE` | なし（必須） | 席ごとの token 表（下記）。無ければ起動しない |
| `AGENT_MEMORY_HTTP_BIND` | `127.0.0.1` | listen する address |
| `AGENT_MEMORY_HTTP_PORT` | `8787` | listen する port |

DB の選び方（`AGENT_MEMORY_DB_TYPE`、`AGENT_MEMORY_DB_PATH`、`AGENT_MEMORY_DATABASE_URL` など）は stdio と同じ。HTTP では `AGENT_MEMORY_AGENT_ID` / `AGENT_MEMORY_PROJECT` を使わない。席は token から決まる。

## token ファイルの形式

JSON 配列。1 要素が 1 席。平文の token はファイルに置かない。

```json
[
  { "token_sha256": "<sha256(token) の 16 進 64 文字>", "agent_id": "arc", "project": "iyasaka-arc" }
]
```

- `token_sha256`: 小文字 16 進 64 文字。重複は起動時に拒否する。
- `agent_id`: 必須。`project`: 省略可（省略時は stdio で `AGENT_MEMORY_PROJECT` を設定しない場合と同じ扱い）。
- 上記以外の鍵（たとえば平文の `token`）があると起動時に拒否する。
- digest の作り方の例: `printf %s "$TOKEN" | sha256sum`
- token の生成・配布・保管先は、この server の範囲外（運用側で決める）。

## 経路

| method / path | 認証 | 動作 |
|---|---|---|
| `POST /mcp` | 要 | JSON-RPC。session なしの要求は `initialize` だけ受け付ける |
| `GET /mcp` | 要 | 既存 session の SSE 続行 |
| `DELETE /mcp` | 要 | session の終了 |
| `GET /healthz` | 不要 | `{"ok":true}` だけを返す（版・席名は出さない） |
| それ以外 | — | `404` |

## 認証と session

- `Authorization: Bearer <token>` を受け、`sha256(token)` を表と定数時間で比較する。
- token が無い、または一致しない: `401` + `WWW-Authenticate: Bearer`。本文に理由は書かない。
- session ごとに server と transport を 1 組作り、initialize 時の token の席（`agent_id` / `project`）に固定する。session id は `Mcp-Session-Id` header で続行する。
- 別の席の token で既存の session id を使うと `404` を返し、その session を捨てる（元の席からも再利用できない）。
- 未知の session id: `404`。session なしで initialize 以外の要求: `400`。
- log に token と Authorization header は出さない。request の log は method・path（query を除く）・status だけで、`redactText` を通す。

## 席の境界（HTTP だけの制限）

HTTP の呼び出し元は、server と同じ host のプロセスとは限らない。stdio では信頼していた次の操作を、HTTP では制限する。tool の一覧（`tools/list`）と入力の形は stdio と同じで、呼んだ時に error を返す。

| tool | HTTP での動作 |
|---|---|
| `set_recovery_config` | `agent_id` が token の席と違えば `SEAT_MISMATCH` の error を返し、何も書かない。自分の席は従来どおり更新できる |
| `ingest_conversation_events` | `HOST_FILES_UNAVAILABLE_OVER_HTTP` の error を返す。server host の transcript（`root` 指定・既定の場所とも）を読まず、何も保存しない |
| `catch_up` | 同上。server host の `~/.claude/projects` を走査せず、何も書かない |

- 拒否の応答は `isError: true` と固定の code（`SEAT_MISMATCH` / `HOST_FILES_UNAVAILABLE_OVER_HTTP`）だけで、host の path や件数は返さない。拒否は host のファイルに触れる前、保存の前に行う。判定は server 側の context（token の席と transport）で決まり、呼ぶ側の引数では変えられない。設計の判断: agent-memory#334 6076984566（ARC）。
- 席の境界は `agent_id`。token の `project` は既定値で、境界ではない。同じ `agent_id` の中では、tool の `project` 引数で別の project を指定でき、stdio と同じく読める。
- HTTP の席の会話を取り込む経路（各席の host 側での ingest）は、この cell の範囲外。

## TLS とネットワーク

- TLS は終端しない。外部に出す場合は前段の reverse proxy で TLS を終端する。
- 既定の bind は `127.0.0.1`。外部 interface に bind する場合は、前段の proxy と firewall を前提にする。
- 置き場所（Mac / VPS）と秘密の配置は、この文書と K-HTTP-1 の範囲外。

## 確認方法

```sh
npm run test:http   # loopback で 401 / tools/list / 席の分離 / 他席の設定変更と host transcript 読み取りの拒否 / session の取り違え 404 を確認
```
