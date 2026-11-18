# 統合の試験の手順 — Build and Test（取り組み 261113-store-resolution-fix）

この文書は、保存先を決める共有の関数 `src/store-resolution.ts` を、それを使う入口どうしを組み合わせて確かめる手順を書く。手順の元は `code-generation-plan.md`、作った物は `code-summary.md`、単体の命令は `unit-test-instructions.md` にある。数は、この段（2026-11-17）に版 `fa9f3a2f16255d723b0cb96f0e77958035f7b11e` を清潔な clone で流した出力から機械で取り出した（手で数えていない）。

## 1. 何と何を組み合わせて確かめるか

確かめるのは、**同じ環境の入力で、どの入口も同じ保存先を決め、書いた先から読み戻せること**。入口は次の 5 種類。

| 入口 | 関係する file（`src/`） | 保存先をどう受けるか |
|---|---|---|
| SessionStart（Claude Code・Codex・Gemini CLI・Antigravity CLI の 4 つ） | `claude-session-start.ts`・`codex-session-start.ts`・`gemini-session-start.ts`・`antigravity-session-start.ts` | 共有の関数で決め、結果を束ねて store を開く所へ渡す（環境変数への書き込みをしない） |
| Stop（`session-rotation-stop`・`transcript-stop-capture`。どちらも Claude Code と Codex） | `session-rotation-stop.ts`・`transcript-stop-capture.ts` | 共有の関数で決める。拒否は host を止めず、証拠に `failed_open` と理由の種類を残す |
| `rotation-commit` | `rotation-commit.ts` | 同じ process の SessionStart が決めた結果を引数で受ける（自分では決めない） |
| `restart-cli`（`handoff-source`・`fetch`・`prepare`） | `restart-cli.ts`・`stores/read-only-task-states.ts` | 呼び出しごとに共有の関数で決め、拒否は理由の種類だけを標準エラーに出す |
| emitter の worker | `kusabi-runtime-event-emitter.ts` | 束ねた先と決めた先の digest が違えば store を作らず `binding_drift` |

`createStore()` は結果を任意の引数で受け取り（`stores/index.ts`）、結果を渡さない呼び出し元は今のまま動く。

## 2. 場面ごとの試験と、この段の結果

命令は、環境を `unit-test-instructions.md` の 1 のとおりに組んで（使い捨ての `HOME`・`KUSABI_TEST_TMPDIR`・保存先の環境変数を外す）、1 file ずつ流す。表の件数は、各試験の `ok - <ID>` の行を数えた値。

| 場面 | 組み合わせ | 試験 file | 件数 | PostgreSQL |
|---|---|---|---|---|
| S1 | 設定 file にだけ接続先がある席で、Stop の 2 hook × 2 host。既定の SQLite を開かず、`failed_open`・SQLite の file 0 件 | `test-store-resolution-scenario.ts` | 4 | 不要（閉じた port を指す） |
| S3 | 9 つの入力の組で、SessionStart・Stop 2 種・reader・`restart-cli` が同じ `backend` と `source` を決める | 同上 | 9 | 不要 |
| S4 | `database_url` を持つ設定 file がある時、根拠が `local_default` の SQLite を選ばない（7 つの形） | 同上 | 7 | 不要 |
| S6 | emitter が、束ねた先と別の接続先へ接続しない・別の SQLite の file を作らない。対の正例と、`createQuietStore` を直に呼ぶ形も含む | 同上 | 5 | 不要（接続を数える listener） |
| U5 | Antigravity・Gemini CLI の SessionStart が、1 回だけ決め、決めた所だけを開く | 同上 | 2 | 不要 |
| U7 | Stop の証拠（`store_backend`・`store_source`）: 保存した回だけ値が入り、拒否は成功と数えない | 同上 | 4 | 不要 |
| U8 | `rotation-commit` が、受け取った結果の store を開いて消費する。結果も seam も無ければ開かない | 同上 | 4 | 不要 |
| U9 | `restart-cli` の拒否は理由の種類だけ・終了コード 1。reader は決められなければ読まない | 同上 | 2 | 不要 |
| U10・seam | emitter の拒否と接続先の確かめ・別の backend で開いた store の拒否 | 同上 | 3 | 不要 |
| S2 | Stop が保存した引き継ぎを、`handoff-source` が同じ PostgreSQL から読み戻す（Codex・Claude Code） | `test-store-resolution-pg.ts` | 3 | **要る**（手元でだけ） |
| S5 | 設定 file にだけ接続先がある席の emitter の worker が、その PostgreSQL に書く | 同上 | 1 | **要る** |
| U12 | Stop の保存の経路と `restart-cli` が送る statement が名指す表と列が、migration を流した後に全てある（表 4 つ） | 同上 | 1 | **要る** |
| 隔離 | 公開の命令 5 本を、旧形式の store などを置いた stand-in の `HOME` で流し、何も変わらない | `test-store-resolution-isolation.ts` | 9 | 不要 |

上の表の合計は、`test-store-resolution-scenario.ts` が 40、`test-store-resolution-pg.ts` が 5、`test-store-resolution-isolation.ts` が 9。核と adapter の単体（U1〜U6・U11・U13）は `test-store-resolution.ts` の 57 件。

### 2.1 今ある統合の試験（通ったままであること。FR5.8）

| 試験 | 件数の行 |
|---|---|
| `test-session-rotation-flow.ts`（`session-rotation-stop` の流れ） | 47 cases |
| `test-handoff-commit-order.ts`（`rotation-commit` の順） | 35 cases |
| `test-handoff-source.ts`・`test-handoff-source-cli.ts`（読むだけの reader） | 13 cases・14 cases |
| `test.ts`（core） | 1832 passed, 0 failed |

そのほかの今ある試験（SessionStart 4 種・`transcript-stop-capture`・emitter・切り直しの場面）は、`... tests passed` の行と終了コード 0 で通ったことを読む。結果は `test-results.md` の 2 に表で書いた。

## 3. PostgreSQL を使う場面の手順（手元でだけ。本番にも席の DB にも触れない）

1. 使い捨ての directory に `initdb -D <dir>/data -A trust -U <使い捨ての利用者>` で作る。
2. `pg_ctl ... -o "-c unix_socket_directories= -c listen_addresses=127.0.0.1 -c port=<空き port> -c lc_messages=C" -w start` で起こす（unix socket を切り、127.0.0.1 の TCP だけ。socket の path が長いと起動できない）。
3. 場面ごとに DB を作り、`CREATE EXTENSION vector` を入れる（入れないと `type "vector" does not exist` で終了コード 1。環境の誤り）。
4. 接続先は、その場でコマンドの環境に渡す（`DATABASE_URL`）。**値を記録・log・証拠に書かない**（`security-test-instructions.md` の 2 に、この段の出力を調べた結果を書いた）。
5. `npx tsx src/test-store-resolution-pg.ts` と `npm run test:pg` を流す。終わったら `pg_ctl -m fast stop` で止め、directory を消す。

`DATABASE_URL` が無ければ、`test-store-resolution-pg.ts` は飛ばさずに失敗で終わる（S8）。PostgreSQL の試験は CI に届かない（CI に PostgreSQL が無い）ので、手元の結果が証拠になる。

## 4. 失敗の見分け方

| 症状 | 読み |
|---|---|
| S1 の 4 件が落ちる | Stop が環境変数だけを読んで決めている（設定 file の接続先を見ていない）。この PR が直した不具合の再発 |
| S3 のどれかが落ちる | 入口のどれかが、共有の関数と別の規則を持った |
| S2 が落ちる | 書いた先と読む先が分かれた（Stop は SQLite に書き、reader は PostgreSQL を見て読み戻せない） |
| S6 の `binding_drift` が `ok` にならない | worker が束ねた先と別の所へ接続した |
| U12 が落ちる | Stop の保存の経路が、migration に無い表か列を指した |
| isolation が落ちる | 試験が stand-in の `HOME` を書き換えた（この Mac の実際の保存先を書く恐れ） |
| `KUSABI_TEST_TMPDIR_REQUIRED`・`type "vector" does not exist` | 環境の誤りで、code の失敗ではない |

## 5. この段で確かめないこと（持ち主）

| 確かめない物 | 理由 | 持ち主 |
|---|---|---|
| 席の実機での SessionStart・Stop・回転（本物の hook が本物の保存先を決めること） | 席の設定と DB は守る物。この段は触れない | Deployment Execution（Owner の決定 `OD-KUSABI-STORE-RESOLUTION-RELEASE-PRODCHECK-R1-SELF-SEATS-20261116-001`、arc の script と Owner の入力） |
| 引き継ぎの書き込みの観測（回転の確かめ（b）） | 次に自然に起きる回転の回の、席の手元の証拠でだけ見る。それまで「観測できず」で、成功に数えない | arc（観測は次の自然な回転の回の、席の手元の証拠。記録は席） |
| 本番の表と列の名前の突き合わせ | 本番の DB は読まない（Q2 = A）。突き合わせる一覧（U12 の 4 表）は `unit-test-instructions.md` の 8 にあり、`test-store-resolution-pg.ts` の出力にも出る | Owner と arc |
| Codex の席（tmux）で hook を差し替えた後の挙動 | 差し替えは済んでいるが、起こし直していない | arc（次に自然に起きた会話で） |
| 版（content-addressed release）の作成と配り | `.kusabi-releases` への書き込みは守る物 | Deployment Execution |
