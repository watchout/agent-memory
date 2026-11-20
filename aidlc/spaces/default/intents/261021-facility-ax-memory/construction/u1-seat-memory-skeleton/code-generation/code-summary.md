# Code Generation 要約 — U1 薄い一本（席の記憶の骨組み）

取り組み 261021-facility-ax-memory（Int1）、単位 u1-seat-memory-skeleton。この文書は結果の要約で、設計の中身は写さず、番号と場所で参照する（決定 152）。

上流（参照だけ）: unit-of-work（`inception/units-generation/`）、requirements（`inception/requirements-analysis/requirements.md` の FR・NFR）、`functional-design/`（BR・AC）、`nfr-design/`・`nfr-requirements/`（NFR）、`infrastructure-design/`、計画 `code-generation-plan.md`（Step・D1〜D7）、DB の設計の記録 `db-design-record.md`。

## 1. Step と PR の対応

行数は、各 PR の範囲で `python3 -I ~/Developer/arc/tools/pr-precheck/check.py <repo> <base> <head>`（SHA-256 `1c7a2276…`）を流した値。コード = 製品の code と試験と項目の file、設計の文書 = AI-DLC の記録と .md（別に数える。決定 152）。

| PR | 状態 | 計画の Step | コード | 設計の文書 |
|---|---|---|---|---|
| #349 | 統合済み | 計画の 0（code の前の門）。DB の設計の記録と設計監査の項目 | 328 | 6400 |
| #350（PR-1a） | 統合済み | 3・4・5・7（CI から届く層）・13 を前倒し | 1782 | 0 |
| #351（PR-1b） | 統合済み | 1 の命令の名前・6・7（使い捨ての DB の層） | 979 | 0 |
| #352（PR-2） | 開いている。独立の監査 3 回目 PASS、受領済み。待ち = Owner の exact-head と作者以外の統合 | 8・9・10・11・13・14 のうち `docs/operations/` | 1626 | 58 |
| この PR | 記録だけ | 12 の記録・14 の `code-summary.md`・`traceability.json` | 0 | 本文書と計画の印 |

関連の PR（Step ではない）: #353（CI を base の枝に関わらず流す。統合済み）、#354（Shirube の Gates Report workflow を外す。開いている。PASS、受領済み。その carry-over SW-6〜SW-9 は #354 の本文のまま、ここに写さない）。見込みと実際の行数は各 PR の本文に書いた（決定 127）。

## 2. 試験・網羅率・CI（作者の測定と CI の別を分ける）

- 行の網羅率の床 100%（team.md）: 測定の script 3 つ（`merge-zero.mjs` `ab76f8fc…`、`changed-uncovered.py` `4c73c560…`、`coverage-selftest.mjs` `8db67d66…`）。#350 は追加した製品の code 546 行・未実行 0、#352 は 576 行・未実行 0（CI が届く命令だけでも測った）、#351 は SQL と試験だけで測る対象なし（SQL の分岐の網羅は測っていない）。
- 試験の件数: `test:common-seat` 84 checks（scenario 5・placement 13・errors 12・store 16・surface 15・recovery 14・host 9）、`test:common-seat-pg` 17 checks（手で流す。CI は流さない）、核の試験 1832 passed・0 failed（作者が #352 の code の commit で流した値で、CI の結果ではない）。
- CI: #352 の head `9d512e59` で build-and-test の 18・20・22 が success（run 44664125362、`pull_request` の event）。
- 成功の条件の場面の試験（Step 3）は、後から実装の無い木に当てて失敗を確かめた結果で、実装より先に書いた順の記録ではない（#350 の本文）。

## 3. 計画との食い違いと持ち越し（ID は 1 か所で定義し、ほかは ID で参照する）

承認済みの file は書き換えない。食い違いの決めは arc の答え（Owner の委任 #49 6762288830。11-20 の連絡）で、Owner の決定ではない。

| ID | 設計の場所 | code の事実 | 扱い |
|---|---|---|---|
| DV-1 | NFR4.6（`nfr-design/scalability-design.md` 7 行目・`nfr-design-questions.md` 15 行目）: process ごとに接続 1 本 | `src/common-seat-store.ts` の先頭の説明と取引: 呼出しごとにつないで閉じる | 設計を改める（4 の追補 NFR4.6-A1）。根拠 = 4 の測り |
| DV-2 | NFR5.2: 取引ごとに statement_timeout 5 秒と lock_timeout 1 秒 | statement_timeout だけ。lock_timeout は src・sql・試験に無い（head の grep）。statement_timeout の 5 秒が lock の待ちも含めた上限なので、止まらずに待ち続ける形ではない | code を足す。U2 の最初の code の PR で `SET LOCAL lock_timeout` と試験 |
| DV-3 | NFR8.1（`nfr-design/security-design.md` 34 行目・`infrastructure-design/infrastructure-specification.md` 11 行目）: 外の DB には確かめつきの TLS を必ず使う | 接続先の URL をそのまま driver に渡し、TLS を要求・確認する code は無い。試験が sslmode を使うのは URL の伏せ字の確かめだけで、強制の確かめではない（head の src 全体の grep）。今は手元の使い捨ての DB だけで動き、席の設定に `AGENT_MEMORY_MODE=common` を書くのは Owner の手 | code を足す。U2 の最初の code の PR（DV-2 と同じ PR）。**ゲート**: `AGENT_MEMORY_MODE=common` を外の DB（127.0.0.1・::1・localhost・unix socket 以外）に向ける前に、外の host に `sslmode=verify-full`（と CA の指定）が無ければ接続の前に拒む code と、外の host で sslmode 無し・require・verify-ca は拒み verify-full だけ通る負例の試験が main に入っている事。その PR は重い門 |
| DV-4 | NFR8.3・`security-design.md` 33 行目: 伏せ字を通すのは失敗の文・起動の時の文脈・道具の応答・呼出しの記録 | 決定の本文・文脈・tag を出す回復の文と `get_decisions` の返答にも、決定ごとの全部の欄にかける（#352 の 1・2 回目の止める指摘 BF-1・BF-2 の直し） | 範囲を広げた（安全側）。4 の追補 NFR8.3-A2 |

持ち越し:

- **C-1 開き口**: `post-tool-hook` = U2、`restart-cli`・`session-rotation-stop`・`rotation-commit` = U3、`transcript-stop-capture` = U6 の範囲で、共通基盤の形は配線していない。単位の一覧に無い `kusabi-fleet-status-cli`・`kusabi-runtime-event-emitter` は、「`AGENT_MEMORY_MODE=common` を席の起動の設定に書く前に、この 2 つを配線する単位を Unit 分けの段で足す」を前提にする。
- **C-2（O-2。3 回目の返却 7029272139）**: `src/claude-start.ts:405`・`src/restart-cli.ts:328` の `redactText(JSON.stringify(...))`（JSON にして改行が `\n` になった後にかける形）。U3 の範囲。本物の情報に有効にする前に、生の欄での消去を実測する。その経路の秘密保持を PASS にしたものではない。
- **C-3（O-3）**: 単独の形の `get_decisions`（`src/index.ts:178`）は全文の変換のまま。単独の形が安全になったとは言わない。直す Unit は arc が決める。
- **C-4（S3）**: `get_decisions` の上限の既定 10 が `src/index.ts:144`・`:781`（道具の説明の文）と `src/common-seat-surface.ts:17`（`DEFAULT_GET_LIMIT`）にある。U2 で道具の定義を触る時に 1 か所へ寄せる。
- **C-5**: 外の DB への接続時間（TLS の握手・往復）と、席の数 × 同時の呼出し数が接続の上限（NFR4.5。数十席）に収まるかは測っていない（未観測）。U4（所属範囲の置き場）で測り直す。
- **C-6（O-1）**: 呼出しの記録の 1 行（`src/common-seat-surface.ts:55-57` の `callRecordLine`）は空白区切りで、設計の「1 行 1 件の JSON」と違う（NFR1.1 を Deferred にした）。U2 の最初の code の PR で JSON にそろえる。
- **C-7（版 21 の整理。arc の判断待ち）**: #349 には見直しの記録・覚え書き 371 行が入り、`inception/practices-discovery/discovered-rules.md` は今の前検査で写し 36%（上限 30%）。承認済みの記録を書き換えると段の承認の印が外れるので、この PR では直さない。
- **C-9（BR1.6）**: 共通基盤の役割 `common_verify_caller` が無い DB で `0001_roles.up.sql` が止まり、表が 1 つもできないことは、SQL の読み（`GRANT common_verify_caller` が先にある）だけで、使い捨ての DB でこの場面を流した試験は無い（未実行）。失敗の名前への写し（3F000・42883 → `not_initialized`）は偽の窓口の試験にある（`src/test-common-seat-errors.ts:75-76`・`src/test-common-seat-store.ts:93`）。U2 の最初の code の PR で、PG の試験に 1 題足すか、U2 の SQL の試験に含める。
- **C-8（公開の衛生。arc の判断待ち）**: この取り組みの記録（head `9d512e59`）に、バージョン番号つきの製品名・手元の環境名の文字列が 42 行・17 file ある（公開の repo の規則の対象。機械で数えた値）。C-7 と同じ理由でこの PR では直さない。

## 4. 設計の追補（承認済みの file は書き換えず、ここ 1 か所に書く）

**NFR4.6-A1（DV-1）**: 道具の呼出しごとに DB へ接続し、取引の後に閉じる（pool なし・接続を持ち越さない）。理由は、BR1.5（DB が戻ったら起動し直さずに書ける）と NFR5.3（次の呼出しでつなぎ直す）を、切れた接続の状態を持たずに満たすため。席ごとの DB の利用者と席ごとの接続は変わらない。同時の呼出しがあればその数だけ接続が立つ（MCP の呼出しが 1 つずつ来るかは確かめていない。C-5）。

根拠 = 測った値: 使い捨ての DB・127.0.0.1・TLS なし・呼出しごとに接続する今の store・各 300 回。単位は ms で、p50 / p95 / 最大。

| 操作 | 決定が少ない席 | 決定 1 万件の席 |
|---|---|---|
| 接続だけ | 3.7 / 7.1 / 37 | 3.3 / 6.5 / 22.5 |
| log_decision | 7.3 / 10.0 / 16 | 8.3 / 24 / 31 |
| recover_decisions | 7.9 / 11 / 34 | 18 / 32 / 70 |
| get_decisions | 7.9 / 11 / 22 | 16 / 25 / 42 |

線は、接続 2,000・確かめと読み出し 3,000・道具の書き 5,000・起動全体 7,000（`COMMON_LIMITS`、`src/common-placement.ts`）。いちばん遅い 1 回（70）でも、読み出しの線 3,000 の約 1/43 で、1/40 以下。限り: 手元の loopback の値で、外の DB と TLS は測っていない（C-5）。script は `src/test-common-seat-pg.ts` の起動部分 224 行と測りの 36 行を使った手元の物で PR に入れない（SHA-256 `37a0fe4e…`、出力の SHA-256 `a2e1a9dd…`、`npx tsx` で #352 の code の commit `2bede5a7` の写しに対して使い捨ての HOME・TMPDIR で流した。作者の測定で CI の結果ではない）。NFR4.4 の別の測りは #351 の本文。

**NFR8.3-A2（DV-4）**: 伏せ字の処理（`redactText`）は変えていない。かける範囲を、失敗の文・起動の時の文脈・道具の応答・呼出しの記録に加えて、決定を取り出す 2 つの出力（回復の文・`get_decisions` の返答）の決定ごとの全部の欄（`redactDecisionFields`。#352 の本文の deviation 4）にした。つないで読むので、秘密でない決定を伏せることがある（安全側。運用の文書 `docs/operations/COMMON_FORM.md` に書いた）。

## 5. 追跡

`traceability.json`: 74 行（AC 25・NFR 25・BR 24）。OK 64・N/A 7・Deferred 3（NFR1.1 = C-6、NFR5.2 = DV-2、NFR8.1 = DV-3）。N/A の 7 つは、functional-design の表と同じく他の単位の範囲（AC3.1.1・3.1.2・3.1.4・5.1.2・9.1.1・9.1.3）と、NFR10.2（D4 で置き換え）。engine の `sensor-traceability` を作業場で流して `pass: true`。
