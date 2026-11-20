# Code Generation 計画 — U1 薄い一本（席の記憶の骨組み）（取り組み 261021-facility-ax-memory、単位 u1-seat-memory-skeleton、feature）

この計画は、承認済みの U1 の記録（`functional-design/` の `rules.md`・`functional-spec.md`・`entities.md`・`traceability.json`、`nfr-requirements/`・`nfr-design/`・`infrastructure-design/`）と、10-22 以後の差分の記録 `functional-design/store-resolution-delta.md`（DL-1〜DL-7、NFR-1・NFR-2）を、作る手順に落とす。承認済みの file は書き換えない。食い違う所は、差分の記録の読み替えを正とし、この計画の「3. 読み替えと持ち越し」に書く。

読んだ版 = origin/main の bd98a10（2026-11-19。手元の作業場は dirty で local branch が古いので、HEAD を根拠にしない）。code を書く時点で origin/main が進んでいたら、関数名と呼び出しを取り直す。

## Summary

- Builds: 共通基盤の形（`AGENT_MEMORY_MODE=common`）の置き場所の決め方・席の確かめ・決定の保存と読み出し・起動の口の回復（Claude Code と Codex）。Kusabi の置き場（DB の `kusabi`）の up/down の SQL 1 対、MCP の入口 2 つ（`log_decision`・`get_decisions`）、U1 に無い道具の `not_yet_available`。
- Touches: 新しい file 約 8 つ（`src/common-*.ts`・`sql/kusabi/`）、入口の配線（`src/index.ts`・`claude-session-start.ts`・`codex-session-start.ts`・`boot.ts`・`claude-start.ts`・`codex-start.ts`、Gemini・Antigravity の hook は common の時に拒否）、`package.json` の試験の命令。今の `decideStore`・単独の形は変えない（BR6.1）。workflow は変えない。
- Tests: 標準の試験量（部品ごとに 5〜8 件）。成功の条件の場面（Codex の形で決定を 1 件書く → 再起動 → Claude Code の形で読み戻す）を先に書いて失敗を確かめる。偽の SQL の窓口で CI から届く試験と、使い捨ての PostgreSQL 17 の試験（手元だけ）の 2 層。行の網羅率は 100%（追加行）。

道の区分: 今の道（軽い道ではない）。DB の構造・権限・資格情報に触れ、変えた行は 100 行を超える。設計の記録だけの PR と独立の設計監査 1 回の PASS の後に code を書く（team.md）。

## 0. code を書く前の門（この計画の承認の後、Step 1 の前）

- G0 計画の承認: arc が決定 95 による委任で答える（私は答えない）。
- G1 DB の基準（版 0.10）の SHA-256 の確かめ: 正本は iyasaka-org の `docs/shirube/db-standard.md`（commit `a48602d3fcf70a5b04a07cf70bcf6824ff259818`、file の SHA-256 `048c0062d0930756400b96c5539f1a7850924f454e17fe002c58a6791e655036`）。読んだ版の SHA-256 が違えば、書かずに arc に知らせる。手元の iyasaka-org の作業場に file が無いので、固定した commit の blob から取って確かめる。
- G2 DB の設計の記録（新しい記録。承認済みの file は書き換えない）: B1（入力の表 1〜3）と B3（出力の型）の形で、`kusabi` の置き場（決定の表・公開関数）を書き、`deviation_ledger` を 1 行ずつ付ける。承認済みの記録には、この形が無い（5 の「見つけた不足」）。
- G3 設計の記録だけの PR（Int1 の記録。公開の repo に出すので、漏れの確かめを流す）と、空いている監査席への設計監査の依頼 1 回。返却を待つ間は、この計画と試験の手順の承認までは進めてよいが、**試験を含む code は書かない**。
- G4 使い捨ての PostgreSQL 17 は、Owner の決定を取らずに使う（arc の判断。決定 95 による委任で、Owner の言葉ではない。AUN の ID-5 と 261113 と同じ形）。条件: (1) 席の scratch に `initdb` で作る。(2) 127.0.0.1 だけで待ち、既定でない port を使い、共有の場所に socket を作らない（`unix_socket_directories` を空にする）。(3) 終わったら止めて消し、消した物の一覧を記録に残す。本物の会話での確かめは、そのつど Owner の判断を取る。workflow の変更は入れない（守る物）。
- 作る役の呼び出し: Owner の決定 134（`aidlc-*-agent` を最大 3 体同時、書く役は 1 単位 1 体、GitHub への書き込み・統合・孫への委任はしない）の範囲で、Code Generation の作る役を使う。

## 1. 設計

### 1.1 形の入口（`src/common-placement.ts`、新。DL-1・DL-2・DL-3a）

- `AGENT_MEMORY_MODE` が `common` の時だけ、共通基盤の形に入る。無い時・`standalone` の時は、今の `decideStore` の結果のまま動かす（`decideStore` には触れない。BR6.1）。知らない値は `invalid_input`（BR1.2 の「知らない値」だけを残す）。
- 共通基盤の形の置き場所は、環境の `AGENT_MEMORY_DATABASE_URL`、次に user config の `database_url` の順で読む。汎用の `DATABASE_URL` は読まない。どちらも無ければ `placement_unset`（設定の名前を示す）で止まり、sqlite・json に逃げない（BR1.1・BR1.3）。
- 入力は `env` と、user config の読み結果を返す関数だけ（時計・乱数を持たない。S4）。user config の読みは、今の `readUserConfig` を呼ぶだけで、作り直さない（S3）。接続先は今の `StoreTarget`（`reveal()` 以外は URL を出さない）に包み、新しい包みを作らない（DL-5）。

### 1.2 失敗の名前の写し（`src/common-seat-errors.ts`、新。BR2.5・DL-4）

- Kusabi の失敗の名前（`seat_not_registered`・`no_membership`・`binding_closed`・`not_initialized`・`placement_unreachable`・`placement_unset`・`invalid_input`・`not_yet_available`）を、**この 1 か所だけ**に持つ。共通基盤の理由（`onza-common:OC001`〜`OC011`）と、今の `store_refused` の理由（`unknown_db_type`・`env_url_shape`・`config_kind`・`config_read`・`config_content`・`target_missing`）を、この表で名前に写す。意味は作り直さない（S2・S3）。
- 写しの表は `rules.md` の BR2.5 と同じ。表の `store_refused` の側の写し（DL-4 の案）は、この計画の Step 4 で確定して記録に書く。

### 1.3 席の確かめと決定（`src/common-seat-store.ts`・`sql/kusabi/`）

- DB の関数（`kusabi.log_decision`・`kusabi.get_decisions`・`kusabi.recover_decisions`）の中で `common.verify_current_tx` を呼び、確かめと保存を 1 つの取引にする（BR3.3）。席の DB の利用者には関数の実行だけを許し、表を直に読み書きさせない（NFR8.2）。関数は持ち主の権限（`kusabi_owner`）で動き、`search_path` を固定する。
- 席は DB の利用者（`session_user`）から決める。引数・`AGENT_MEMORY_AGENT_ID` は席の証拠にしない（BR2.1・BR2.7）。決定の `scope_ref`・`principal_ref`・`seat_ref`・`binding_ref` は確かめた値で、後から書き換える道具も関数も無い（BR3.1・NFR7.1）。決定を消す関数は作らない（S1。引退ではなく、そもそも消す経路を持たない）。
- 窓口（`SqlClient`）を引数で受け、試験では偽の窓口、本番は `pg` を使う（新しい外部の依存は足さない）。置き場所に届かない時は `placement_unreachable` を返し、手元の SQLite・別の DB・file に書かない。届いた後の呼び出しは、つなぎ直して続ける（BR1.4・BR1.5）。共通基盤の置き場が無い DB は `not_initialized` で、表を作らない（BR1.6）。
- 自動の再送はしない（S7 の読み: 3 の D3）。応答を失った（文を送った後に切れた）時は、失敗の名前に「送った後で、書けたか不明。`get_decisions` で確かめてから再送する」を添える。
- 時間の上限: 接続 2 秒・席の確かめと読み出し 3 秒・起動の口の全体 7 秒・道具の DB の処理 5 秒（NFR4.1〜4.3・NFR5.2）。超えたら失敗として返し、成功と言わない。起動の口は止めない。

### 1.4 道具の面と呼出しの記録（`src/common-seat-surface.ts`、新。BR3.5・BR5.1・BR5.2）

- 共通基盤の形では、`log_decision`・`get_decisions` だけが DB につながる。U1 に無い道具は `not_yet_available`（単独の形や今の表に書かない）。
- 呼出しの記録は、道具の名前・記録の ID・時刻・結果だけを書く。今の `logCall` は `decision="${decision}"` を書くので、共通基盤の形では別の記録の関数を使う（今の単独の形の記録は変えない）。失敗の文・応答・起動の文脈に資格情報を出さない（今の `StoreTarget` と失敗の種類の code だけを使う）。

### 1.5 起動の口の回復（`src/common-recovery.ts`、新。BR4.1〜BR4.3）

- Claude Code と Codex の SessionStart が、その席の active の決定だけを、書いた席・時刻つきの「データ」の枠で回復の内容に入れる。決定の中の命令の形の文は指示として出さない。`memory_status` は `ok`・`unreachable`・`not_registered`・`timed_out` の閉じた集合で、観測できなかった時を成功に読み替えない（S5）。席の起動は止めない。
- Gemini・Antigravity の hook は、共通基盤の形の時は回復の内容を空にし `memory_status=not_yet_available` を出す（今の単独の形は変えない。3 の D5。arc に確かめる）。

### 1.6 入口の配線（DL-7）

- 共通基盤の形の入口を 1 つにして、次を同じ入口に通す: MCP サーバー（`src/index.ts`）、SessionStart（Claude Code・Codex）、`boot.ts`・`claude-start.ts`・`codex-start.ts`（今は共有の決め方の外で環境だけから決める入口。BR1.4 の「書いた先と読む先が食い違う」を防ぐ）。単独の形の入口は変えない。

## 2. 手順（Step）と見込みの行数

行数は製品の code と試験の変更行（足した行と消した行の和。lockfile と AI-DLC の記録を除く）の**見込み**で、上限を守るのは実測（各 Step の後に `check.py` で測り、PR ごとに見込みと実際を記録に書く）。

PR の切れ目: PR-1 = Step 1〜7（置き場所・失敗の名前・窓口・SQL とその試験）、PR-2 = Step 8〜11（道具の面・回復・入口の配線・場面の試験）、Step 12〜14 は両方の PR に分けて載せる。見込みは PR-1 が約 1,650 行、PR-2 が約 1,250 行（どちらも 2,000 行未満）。PR-1 が先で、PR-2 は PR-1 の branch の上に積み、統合は計画の順（決定 129・135）。

- [x] **Step 1 構成と設定の骨組み（約 60 行）** — `sql/kusabi/` の置き場、空の module の export、`package.json` の命令の名前（`test:common-seat`・`test:common-seat-pg`）。挙動は足さない。
- [x] **Step 2 試験の道具の確認（コード 0 行）** — 今の試験の命令（`npm run test:store-resolution`）を、使い捨ての HOME・`KUSABI_TEST_TMPDIR` で 1 回流して通ることを確かめ、`unit-test-instructions.md` の命令を確定する。
- [x] **Step 3 成功の条件の場面の試験を先に書いて失敗を確かめる（約 240 行）** — `src/test-common-seat-scenario.ts`: Codex の形で決定を 1 件書く → 新しい process で再起動 → Claude Code の形の起動の口で同じ決定が出る。負の確かめ: 登録の無い席・DB を止めた時（手元に何も書かれない）・`DATABASE_URL` だけの時（表を作らない）・呼出しの記録に決定の文が無い。module が無い状態で流し、失敗の出力を記録に残す。PR-1 には store の層の部分、PR-2 に host の層の部分を載せる。
- [x] **Step 4 失敗の名前の表と置き場所の決め方（約 200 行）** — `common-seat-errors.ts`・`common-placement.ts`（1.1・1.2）。BR1.1〜1.3・BR2.5。
- [x] **Step 5 窓口と席の store（約 230 行）** — `common-seat-store.ts`（1.3）。BR1.4〜1.6・BR2.1〜2.7・BR3.1・BR3.3。
- [x] **Step 6 Kusabi の置き場の SQL の up/down（約 200 行）** — `sql/kusabi/0001_up.sql`・`0001_down.sql`。DB の設計の記録（G2）のとおりに書く。共通基盤は 0.3.1 の `install` の順（5 file）で当てた DB に、up を当てる。当てる → 戻す → 前の試験が通る（S6・NFR6.1）。
- [x] **Step 7 層ごとの試験（置き場所・失敗の名前・store・SQL。約 700 行）** — 実装の後に、偽の窓口の試験（CI から届く）と使い捨ての PostgreSQL の試験（手元。席ごとの DB の利用者・表の直読の拒否・取引の巻き戻し・消す物が無いこと。共通基盤 0.3.1 の 5 file は、固定 commit の onza の作業場から読み、読んだ bytes の sha256 を試験の期待値と比べる。作業場が無ければ「観測できず」= 終了コード 3。D6）を書いて動かす。
- [x] **Step 8 道具の面と呼出しの記録（約 170 行）** — `common-seat-surface.ts`（1.4）。BR3.2・BR3.5・BR5.1・BR5.2。
- [x] **Step 9 起動の口の回復（約 150 行）** — `common-recovery.ts`（1.5）。BR3.4・BR4.1〜4.3。
- [x] **Step 10 入口の配線（約 200 行）** — 1.6 の入口。`src/index.ts` の `createStore` の前に形を決める 1 か所を足す。
- [x] **Step 11 層ごとの試験（道具の面・回復・配線。約 650 行）** — 実装の後に書いて動かす。Step 3 の場面の試験を緑にする。
- [x] **Step 12 行の網羅率の測り（コード 0 行）** — 261113 の 3 つの script（`merge-zero.mjs`・`changed-uncovered.py`・`coverage-selftest.mjs`。SHA-256 は `ab76f8fc…`・`4c73c560…`・`8db67d66…`）を記録から取り出し、自己試験を流してから、全部の命令と CI が届く命令だけの 2 通りで追加行 100% を確かめる。数えから外す行は PR に理由を書く。
- [x] **Step 13 環境・build の設定（約 40 行）** — `package.json` の試験の命令（`test:claude-hook` の連なりに `test:common-seat` を足し、CI が今呼ぶ命令から届かせる。workflow は変えない）。社内の席の起動の設定に `AGENT_MEMORY_MODE=common` を書く手順は、文書（`docs/operations/`）に書くだけで、席には適用しない（席の起動・展開は保護面）。
- [x] **Step 14 文書と追跡（約 80 行）** — `docs/operations/` の記述、`code-summary.md`・`traceability.json`、deviation ledger（3）、PR の本文。

## 3. 設計の判断と採らなかった代替（deviation ledger）と、読み替えと持ち越し

| ID | 採った判断 | 採らなかった代替 |
|---|---|---|
| D1 | 形の判断を 1 つの入口にし、`MODE=common` の時だけ別の読み手（`common-placement.ts`）が `StoreResolution`・`StoreTarget` を使う。`decideStore` は変えない（DL-2。S3 の外れ方: 「どの store を開くか」の判断が 2 か所に見えることを、入口 1 つで抑える） | `decideStore` に mode の引数を足す（#347 で監査を通した核の契約と全 hook の試験が動く） |
| D2 | `MODE=common` だけを共通基盤の形に入る条件にする（DL-1 (a)）。承認済みの BR1.2 の「MODE が無い時は専用の設定の有無で決める」は使わない | 承認済みのまま（MODE が無く `AGENT_MEMORY_DATABASE_URL` で動いている席が、不意に共通基盤の形になり BR6.1 と食い違う） |
| D3 | `log_decision` は自動で再送しない。応答を失った時は、失敗の名前に「書けたか不明。読んで確かめてから再送」を添える（S7 の読み） | 冪等キーの引数を足す（公開の道具の仕様の変更で、契約に当たる。arc に確かめる） |
| D4 | 網羅率は、`NODE_V8_COVERAGE` を全試験に付けて足す script（261113 と同じ。新しい依存なし）で、追加行 100%（team.md の床）を測る | 承認済みの tech-stack-decisions の「Node の組込みの網羅率を先に試す」・床 80%（hook を子 process で起動する試験が数えられず、team.md の学びと床 100% に届かない） |
| D5 | Gemini・Antigravity の hook は、共通基盤の形の時は回復を空にして `not_yet_available` を出す。`not_yet_available` は成功に数えない（試験でも、記録でも） | 共通基盤の形の時も、今の `resolveSessionStartStore` を通す（`MODE=common` なのに sqlite・json へ逃げる） |
| D6 | 共通基盤の SQL（onza の非公開 repo の物）は、公開の agent-memory に写さない。試験は、固定した commit の onza の作業場を環境変数 `KUSABI_TEST_ONZA_COMMON_ROOT` で指して読み、読んだ bytes から sha256 を計算して、試験に書いた期待値と比べる。作業場が無い・版が違う時は「観測できず」を返し、成功に数えない（arc の判断。決定 95） | 承認済みの「変えない写しを repo に置き、CI で sha256 を試験する」（非公開 repo の中身を公開 repo に写す） |
| D7 | 共通基盤の版は 0.3.1 に固定する（承認済みの 0.2 = onza の 5beb404 から 0.3.1 へ。理由 = suite に入る版に合わせる。arc の判断。決定 95）。U1 が使う `common.verify_current_tx` の契約は 0.2 と同じと読んだ（5 の 2） | 0.2 のまま（suite の据付と版がずれる）／0.4（suite に入る版は 0.3・0.3.1。固定しない） |

読み替え（差分の記録のとおり。承認済みの file は書き換えない）: BR1.1 の「専用の設定」= 環境の `AGENT_MEMORY_DATABASE_URL` と user config の `database_url`（DL-3a）。NFR8.3 の「環境から読む」= 同じ 2 つ（NFR-1）。user config の file の mode は U1 では要求しない（NFR-2。次の候補として持ち越し）。基盤の版の固定は 0.2 から 0.3.1 に変える（D7）。承認済みの差分の記録（`store-resolution-delta.md`）は、書き換えると段の有効性の確かめが動くので、書き換えず、この計画に書く。

## 4. 追跡（話・決まり・NFR → Step）

| 話 | 受入 | 決まり・NFR | Step |
|---|---|---|---|
| US1.1 | AC1.1.1〜1.1.3 | BR2.1〜2.2・BR2.5・BR3.1・BR3.3 | 3・5・6・7 |
| US1.2 | AC1.2.1・1.2.2 | BR2.1・BR2.7・BR3.2・NFR2.1・NFR3.1 | 3・5・6・7・8 |
| US1.3 | AC1.3.1〜1.3.3 | BR2.3・BR2.6・BR2.4 | 5・6・7 |
| US3.1 | AC3.1.3 | BR3.4・BR4.1〜4.3 | 9・11 |
| US5.1 | AC5.1.1・5.1.3 | BR1.2・BR1.3 | 4・7 |
| US5.3 | AC5.3.1〜5.3.3 | BR1.4・BR1.5・BR4.2・NFR5.1・NFR5.3・NFR5.5 | 5・7・9・11 |
| US5.4 | AC5.4.1・5.4.2 | BR1.1・BR1.3 | 4・7 |
| US9.1 | AC9.1.2 | BR5.1・NFR1.1 | 8・11 |
| US9.3 | AC9.3.1・9.3.2 | BR5.2・NFR8.3・NFR1.2 | 4・5・8・11 |
| （決まりのみ） | — | BR1.6・BR2.4・BR3.5・BR6.1・NFR6.1・NFR7.1・NFR8.2・NFR4.1〜4.4 | 5・6・7・8・10・11 |

## 5. arc の答え（arc の判断。決定 95 による委任で、Owner の言葉ではない。計画に入れた所を添える）

1. **共通基盤の SQL の置き場** → repo に写さない。onza は非公開の repo で、公開の agent-memory に中身を写さないため。固定した commit の onza の作業場を環境変数で指し、sha256 を確かめ、無ければ「観測できず」にして成功に数えない。入れた所: D6、Step 7、`unit-test-instructions.md` の 2。CI の写しの試験が無くなることは「6. 限界と持ち越し」に書いた。
2. **共通基盤の版** → suite に入る版（0.3・0.3.1）に合わせ、U1 が使う関数の契約が 0.2 と同じなら 0.3.1 に固定する。読んだ結果（onza main `7da9af914d0eb484ea8f7ae56e3d086798ee9995`、2026-11-19）:
   - `common/0.2/sql/001_schema.sql`・`010_verify_current_tx.sql`・`020_acl.sql` の git の blob id は、5beb404 と上の commit で同じ（`8b5145e2…`・`510d2c9c…`・`d7214846…`）。bytes は変わっていない。
   - 0.3.1 の manifest は `required_contract` を `onza-common/0.2.0-draft.1` のままにし、公開する関数を `register_session`・`touch_presence`・`read_presence` の 3 つとする。`verify_current_tx` の名前・引数・返り値・失敗の名前（OC001〜OC011）は 0.2 の file のまま。
   - 0.3 の `030_presence.sql` と 0.3.1 の `031_presence_touch_state_only.sql` は、`common.seat_presence` と presence の関数を足し、`common.verify_current_tx` は呼ぶ側にある。足す権限は関数の持ち主（`common_verify_owner`）への GRANT で、Kusabi の関数はそれに頼らない。
   - 読んだ範囲の限り: 030・031 は、DDL と GRANT の行を grep で読み、全文を 1 行ずつは読んでいない。0.4（`read_principal`）は suite に入る版でないので固定しない。
   - 結論: 同じと読んだので 0.3.1 に固定する（D7）。
3. **DB の基準の B1・B3 の記録** → 足してよい。DB の基準の B1（入力の表 1〜3）と B3（出力の型）の形と `deviation_ledger` を、設計の PR に新しい記録として入れる。基準の SHA-256 は、固定の commit（`a48602d3…`）の blob で確かめてから書く（G1・G2）。
4. **網羅率の CI 化** → 入れない。workflow は守る物なので、手元の測りを記録に載せる（261113 と同じ。Step 12・13）。
5. **log_decision の再送（D3）と Gemini・Antigravity（D5）** → D3 は足さない（自動で再送しないので効果が二重に出ない）。冪等キーの引数は公開の仕様の変更なので持ち越し。D5 は今の形でよい。`not_yet_available` は成功に数えない。
6. **使い捨ての PostgreSQL 17** → Owner の決定は要らない（G4 の条件で使う）。

別件: `stage_validity` の警告（読み解きの file が RE の後に変わった）は、RE をやり直さない（functional-design を開き直して差分の記録で扱う形のまま。arc の判断。決定 95）。

## 6. 限界と持ち越し

- 限界: 共通基盤の SQL の写しを repo に置かないので、CI に「写しの sha256 の試験」は無い。共通基盤の版の確かめは、手元の使い捨ての PostgreSQL の試験（D6）だけで、onza の作業場が無い環境では「観測できず」になる（成功に数えない）。
- 限界: Codex の席の読み戻し、Gemini・Antigravity の共通基盤の形の回復は、この単位では観測しない（D5。`not_yet_available`）。
- 持ち越し: `log_decision` の冪等キーの引数（公開の道具の仕様の変更。D3）。user config の file の mode の確かめ（NFR-2。Int1 の別の単位の候補）。網羅率の CI 化（workflow。守る物）。
- 持ち越し（記録の置き場）: `AGENT_MEMORY_MODE=common` を社内の席の起動の設定に書く手順（Step 13 は文書だけ。席の起動・展開は守る物で、適用は Owner の決定）。

## Testing Contract

```json
{
  "version": 1,
  "methodology": "custom",
  "source": "team",
  "ordering": "成功の条件の場面（担当交代と再起動の後に取り出せるか）の試験を、その場面を作る実装より先に書いて失敗を確かめ、細かい試験は試験できる層ごとに実装の後に書いて動かす。",
  "scope": "feature",
  "test_strategy": "standard",
  "project_type": "brownfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    },
    {
      "layer": "team",
      "text": "- **Methodology**: custom\n- **Methodology evidence**: 成功の条件は「担当交代と再起動の場面を決めた試験で取り出せる割合 100%」（D-06・D-26・D-27）なので、その場面の試験を先に固めて完了の判定をぶれさせない。細かい試験は、今の自前の tsx のスクリプトの形に合わせて実装の後に書く（面談の Q3 = C）。\n- **Ordering**: 成功の条件の場面（担当交代と再起動の後に取り出せるか）の試験を、その場面を作る実装より先に書いて失敗を確かめ、細かい試験は試験できる層ごとに実装の後に書いて動かす。\n- 網羅率: 行の網羅率 100% を床にし、統合の前に CI で確かめる。Build and Test の段でも 100% を確かめ、段を通すために弱めない（社内基準 100% = Owner の決定 OD-COMPANY-AIDLC-LINE-COVERAGE-FLOOR-100-20261105-001、iyasaka-arc#49 6647418162。org.md の既定 80% より厳しい床をここで定める）。届かない行を数えから外す時は、PR に理由を書いて独立の監査で見る。\n- PostgreSQL の試験は、最初は手元で回し、結果を PR に証拠として載せる。置き場所の設計が固まった所で CI に入れる。CI の workflow を変える時は owner の exact-head を得る（面談の Q5 = C）。\n- CI（.github/workflows/ci.yml）は Node 18・20・22 で型検査・ビルド・試験を回す。今ある試験は通ったまま保つ。\n\n- 行の網羅率は、組み込みの lcov を file ごとに足す形より、NODE_V8_COVERAGE を全試験につけて process をまたいで足す方が、hook を子 process で起動する場合も数えられる。集計は手作業にせず、監査の席が同じ数字を出せる script にする（OmotenasuAI でも、c8 をそのまま包むと子 process と worker が別に数えられる罠が見つかっている）。 (learned 2026-11-11)"
    },
    {
      "layer": "project",
      "text": "- 試験や確かめの script で既定の createStore() を呼ぶと、JSON の store の置き場が homedir() から決まり、この Mac の実際の保存先に行が入る。必ず一時の HOME を指定して動かす（11-11 の code-generation で conversation-events.json・raw-events.json に試験の行が入った）。 (learned 2026-11-11) \n\n- 手元で使い捨ての PostgreSQL を起動する時は、Unix socket の path が長いと起動できないので socket を切って（unix_socket_directories を空）127.0.0.1 の TCP だけにし、試験が英語の誤り文（duplicate key）を照合するので lc_messages=C を付ける。 (learned 2026-11-11) \n\n- 別に流す型検査は、流した設定の内容と対象の file を記録に書く（前回の記録は設定が無く再現できなかった）。 (learned 2026-11-11) \n\n- core の試験（src/test.ts）を手元で流す時は、試験の親 folder を KUSABI_TEST_TMPDIR（CI は RUNNER_TEMP）で渡し、使い捨ての HOME の中に .agent-memory の folder を先に作る。どちらかが無いと、code の失敗ではなく環境の誤りで止まる（前者は KUSABI_TEST_TMPDIR_REQUIRED、後者は macOS の /var と /private/var の綴りの違いで isolation の 1 件が落ちる）。 (learned 2026-11-13) \n\n- 手元の PostgreSQL の試験（test:pg）は、CREATE EXTENSION vector を入れた DB に向けて流す。入れていないと type \"vector\" does not exist で終了コード 1 になる（環境の誤りで、code の失敗ではない）。 (learned 2026-11-13) \n\n- 試験の到達は、CI の ci.yml の run: が実際に流す命令から読んで書く（計画の「CI は npm test を流す」は誤りで、ci.yml は npm test を流さない。設計監査 1 回目の指摘）。新しい試験は CI が呼ぶ命令（test:claude-hook の連なりなど）に足し、CI の log に件数の行が出ることを確かめる。 (learned 2026-11-16) \n\n- 網羅率の対象を git diff で作る時は、base にあるが作業場で追跡されていない file を diff が「削除」と読み、追加行なしと数える。base の blob と作業場の file を比べて数え、対象が 0 件の測定を PASS にしない（自己試験の負例で見張る）。 (learned 2026-11-16) \n\n- 行の網羅率は、全部の試験を流した測定に加えて、CI の run: が届く命令だけでも測る。CI が流さない試験の側でだけ実行されていた追加行は、CI が流す試験を足して埋める（この取り組みでは 8 行あり、試験を 2 つ足した）。 (learned 2026-11-16) \n\n- 試験で HOME を切り替えても、store の module が静的 import で先に読み込まれると、JSON store の保存先は切り替えの前に決まり、この Mac の実際の保存先を書き換える。HOME と保存先の環境変数を切り替える bootstrap を、store を読み込む試験の最初の import にし、公開の命令を stand-in の home で流して何も変わらないことを試験で見張る。測定の collector は節ごとの END 行と最後の完了の行を出し、checker は欠け・不一致を失敗にする（見出しの行まで届いただけで PASS と読まない）。PostgreSQL の接続の失敗は、driver の文（TLS の鍵・証明書の path を含みうる）を出さず、失敗の種類の code だけにする。 (learned 2026-11-16) \n\n- 試験を流す temp の名前（TMPDIR の経路）は、英数字・/・- だけにする。_ や . を含むと、test-session-start-auto-receive.ts の期待値（replaceAll(\"/\", \"-\") だけで Claude の project の directory 名を作る）が、code が正しくても落ちる。直しは、期待値を encodeClaudeProjectDir と同じ規則で作る別の取り組み。 (learned 2026-11-17) \n\n- CI の step が試験を流したかは、終了コードだけでなく、log に試験の件数の行が出ているかで確かめる。Run post-tool-hook tests は、AGENT_MEMORY_DB_TYPE が sqlite・json でなく URL も無いと process.exit(0) するので、試験の本体に届かず成功する（run 43812014201 の 3 つの Node の job とも）。 (learned 2026-11-17)"
    }
  ],
  "obligations": {
    "strategy": "standard",
    "strategy_volume": [
      "Five to eight tests per component.",
      "Unit tests plus integration tests for key boundaries.",
      "Add E2E, performance, or security tests when requirements demand them."
    ],
    "scope_floor": [
      "Meet an 80% line-coverage floor.",
      "Run the selected tests in CI before merge."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "custom",
    "runner_step": "Verify the existing test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Verify the existing test runner/configuration and record the exact unit-scoped command.",
      "Custom ordering - 成功の条件の場面（担当交代と再起動の後に取り出せるか）の試験を、その場面を作る実装より先に書いて失敗を確かめ、細かい試験は試験できる層ごとに実装の後に書いて動かす。",
      "Implementation and tests - preserve that exact ordering; do not convert it to layer-local TDD.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:9caf0e0e0eb9d8f64d7250123ad90aefcdba203272a537906ad0da9ddfa40b68",
  "contract_sha256": "sha256:32e06372b1758f93aac03be2b3383452c5e7bc629d2ef98fdc9b8a4d26078771"
}
```
