# U1 の試験の手順 — 薄い一本（席の記憶の骨組み）

この文書は `code-generation-plan.md` の Step 2・Step 7・Step 11・Step 12 の命令の正本。命令はすべて U1 の試験だけを指す（`npm test` のような全体の命令は書かない）。code を書くのは設計監査の PASS の後なので、この文書の命令は、作る時に file 名を確かめて直す（直したら、この文書を直して記録に書く）。

## 1. 試験の道具と置き方

- 試験は今の版と同じ、`tsx` で動かす自前の script（新しい依存を足さない）。file 名は `src/test-common-seat-*.ts`。
- 偽の SQL の窓口（`SqlClient`）で動く試験は、PostgreSQL なしで動き、CI から届く。使い捨ての PostgreSQL の試験（`src/test-common-seat-pg.ts`）は、手元でだけ流し、結果を PR に証拠として載せる（team.md。CI には入れない）。
- 試験の file（約 9 つ）:

| file | 試すもの | 件数の目安 |
|---|---|---|
| `src/test-common-seat-scenario.ts` | 成功の条件の場面: Codex の形で決定を 1 件書く → 再起動 → Claude Code の形で読み戻す。負の確かめ（登録の無い席・DB 停止・`DATABASE_URL` だけ・呼出しの記録に決定の文が無い） | 場面 1 + 負 4 |
| `src/test-common-placement.ts` | 形の入口（`MODE`・環境・user config の順・`DATABASE_URL` を読まない・`placement_unset`・知らない値） | 6〜8 |
| `src/test-common-seat-errors.ts` | 失敗の名前の表（共通基盤の理由 OC001〜OC011、`store_refused` の理由の写し） | 5〜8 |
| `src/test-common-seat-store.ts` | 確かめと保存、届かない時・戻った時、`not_initialized`、時間の上限、再送しない | 6〜8 |
| `src/test-common-seat-surface.ts` | 道具の面（`log_decision`・`get_decisions`・`not_yet_available`）、呼出しの記録、資格情報の非表示 | 6〜8 |
| `src/test-common-recovery.ts` | 回復（active だけ・データの枠・`memory_status`・席の起動を止めない） | 6〜8 |
| `src/test-common-seat-entries.ts` | 入口の配線（`MODE` の有無で今の振る舞いが変わらない・Gemini・Antigravity・3 つの入口） | 5〜8 |
| `src/test-common-seat-support.ts` | 試験の補助（偽の窓口・使い捨ての HOME の準備）。試験ではない | — |
| `src/test-common-seat-pg.ts` | 使い捨ての PostgreSQL の試験: 席ごとの DB の利用者・表の直読の拒否・取引の巻き戻し・up → down → up・消す物が無いこと・性能（NFR4.4） | 6〜8 |

## 2. 流し方（作業場の根から。命令は 1 本ずつ）

共通の準備（毎回）: 使い捨ての folder を作り（名前は英数字・`/`・`-` だけ。`_` と `.` を含めない）、その中に `home/.agent-memory` を作る。`HOME` をその `home` に、`KUSABI_TEST_TMPDIR` をその folder に向け、`AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`DATABASE_URL`・`AGENT_MEMORY_MODE` を外す。既定の `createStore()` を呼ぶ試験は、この `HOME` が無いと、手元の機械の実際の保存先に試験の行が入る。

1 つの試験（CI から届く）:

```
HOME=<使い捨ての home> KUSABI_TEST_TMPDIR=<使い捨ての folder> npx tsx src/test-common-placement.ts
```

U1 の CI から届く試験をまとめて（`test:claude-hook` の連なりの最後に足す。`package.json` の命令は Step 13 で書く）:

```
npm run test:common-seat
```

使い捨ての PostgreSQL の試験（手元だけ。Owner の決定は要らない = arc の判断、決定 95 による委任で、Owner の言葉ではない）: 試験の file が、`initdb`・`pg_ctl`・`postgres` で席の scratch に立ち上げ、終わりに止めて消し、消した物の一覧を出す。条件は 3 つ: (1) 127.0.0.1 だけで待つ。(2) 既定でない port を使う。(3) 共有の場所に socket を作らない（`unix_socket_directories` を空にする）。`lc_messages=C` を付ける。`CREATE EXTENSION vector` は、今の `test:pg` と同じ DB を使う時だけ入れる。

共通基盤の SQL は、repo に写さない。環境変数 `KUSABI_TEST_ONZA_COMMON_ROOT` が、固定した commit（0.3.1 を含む onza の commit。読んだ時は `7da9af914d0eb484ea8f7ae56e3d086798ee9995`）の onza の作業場の `common/` を指す。試験は、0.3.1 の manifest の `install` の順（001・010・020・030・031 の 5 file）でその bytes を読み、**読んだ bytes から sha256 を計算して**、試験に書いた期待値と比べ（manifest の宣言値を写して比べない。S5）、一致した時だけ使い捨ての DB に当てる。環境変数が無い・作業場が無い・sha256 が違う時は、`OBSERVATION_UNAVAILABLE` と理由を出し、終了コード 3 で終わる（成功の 0 にしない。S5・S8）。

```
npm run test:common-seat-pg
```

型検査と build（CI と同じ）: `npx tsc --noEmit`、`npm run build`。流した設定の内容と対象の file を記録に書く。

## 3. 期待する結果

- 場面の試験（Step 3）は、module が無い状態で**失敗**する（失敗の出力を記録に残す）。実装の後（Step 11）に通る。
- 層ごとの試験は、通る。負の確かめ（名前を挙げて拒否する・何も書かれない・資格情報が出ない）を、正の確かめと同じ数だけ持つ。
- 今ある試験（`npm run test:claude-hook`・`npm run test:codex-hook`・`npx tsx src/test.ts` など）は、通ったまま。単独の形の振る舞いが変わらないことは、`MODE` の無い環境での同じ入力が同じ答えを返す試験（`test-common-seat-entries.ts`）で見張る。
- CI の log に、新しい試験の終わりの件数の行が、3 つの Node の版（18・20・22）で出る。終了コードだけで「流れた」と読まない。

## 4. 網羅率

- 目標: この PR が足した行と変えた行の行の網羅率 100%（team.md の床。承認済みの基盤の記録の 80% より厳しい床を使う = 計画の D4）。
- 測り: 261113 と同じ 3 つの script（`merge-zero.mjs`・`changed-uncovered.py`・`coverage-selftest.mjs`。SHA-256 は計画の Step 12）。全部の試験の命令を**同じ** `NODE_V8_COVERAGE` の folder に流し、合算して判定する。自己試験を本体の測りの前に流す。全部の命令と、CI が届く命令だけの 2 通りを測る。対象が 0 件・報告が途中で切れた・file が読み込まれていない測りは PASS にしない。
- 使い捨ての PostgreSQL の試験は測りに入れない（CI に無い）。PostgreSQL に触れる行は、偽の窓口の試験で実行される形にする。

## 5. 試験のデータと偽の窓口

- 試験のデータは合成（試験の中で作る）。所属範囲・主体・席・割り当て・席ごとの DB の利用者・パスワードは、試験の中で作って消す。実際の席の名前・URL・鍵を試験に書かない（公開 repo）。
- 偽の窓口は、共通基盤の確かめの失敗（OC001〜OC011 の各理由）・接続の失敗・応答の喪失・時間切れを、決めた通りに返せる。`pg` の driver の文は試験の中でも出さず、失敗の種類の code だけにする。
- 呼出しの記録・失敗の文・起動の文脈に、パスワードの文字列と決定の文が無いことを、全部の負の確かめで見張る（NFR1.1・NFR8.3）。user config 由来のパスワードつきの URL でも同じ（差分の記録の NFR-1・NFR-2）。
