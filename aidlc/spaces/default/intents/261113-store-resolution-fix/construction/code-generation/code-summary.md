# 作った物のまとめ — 保存先の決め方を 1 つの関数にする（261113-store-resolution-fix）

- 計画: `code-generation-plan.md`。試験の手順と結果: `unit-test-instructions.md`。網羅率の測り方と結果: `coverage-method.md`。作る段の観察と計画からの変更: `memory.md`。
- base は `origin/main` の `27d7f8fc9146e826883b045c1fdca93cc11f93e7`。設計の PR は watchout/agent-memory#346（設計監査 2 回目が PASS、受領 RECEIPT_ACCEPTED）。実装の PR は watchout/agent-memory#347（branch は `kusabi/store-resolution-261113`、base は `origin/main` の `27d7f8f`。設計の PR #346 の head には push していない）。
- 設計監査の PASS の後に code を書いた（aidlc-only §2「設計がずれていないかの確かめ」）。code と試験の code は、この会話が書いた（作る役〔`aidlc-developer-agent`〕は呼んでいない。この取り組みには Owner のサブエージェントの承認が無い）。
- 数は、命令の出力から写した値（時点は 2026-11-16。`unit-test-instructions.md` の 8）。

## 何が直ったか

Stop の 2 つの hook（`transcript-stop-capture`・`session-rotation-stop`）は、保存先を環境変数だけで決めていた。接続先（`database_url`）が `~/.agent-memory/config.json` にしか無い席では、Stop が既定の SQLite を開いて引き継ぎを書き、SessionStart は同じ設定 file から PostgreSQL を開いて 0 行を読んだ（書いた先と読む先が別）。決め方を 1 つの関数 `src/store-resolution.ts` にし、全部の入口がその結果を使う形にした。DDL は足していない（「機械の確かめ」の DDL の行 0 件）。

## 変えた file

追加行は、`coverage-method.md` の script が base の blob と比べて数えた値（合計 474）。

| 要件 | file | 追加行 | 内容 |
|---|---|---|---|
| FR1・NFR1〜NFR4 | `src/store-resolution.ts`（新） | 240 | 決め方の核 `decideStore`（`env` と設定 file の読み結果だけで答える。時計・乱数なし = S4）、設定 file を読む adapter `readUserConfig`（ENOENT だけが「無い」、symlink・通常でない file・読みの失敗・JSON でない・object でない・`database_url` が文字列でない、はそれぞれ閉じた理由で拒否）、入口 `resolveStore`・`requireStore`、不透明な接続先 `StoreTarget`（`reveal()` を呼ぶ所以外では URL が出ない）、binding の digest を結果から作る `storeBindingSha256`・`kusabiStoreBindingSha256`・`localStoreBindingSha256`、拒否の型 `StoreRefusedError`（文は `store_refused:<種類>`）。順は、`AGENT_MEMORY_DB_TYPE` の `sqlite`・`json` → `postgres` → 環境の URL → 設定 file の `database_url` → 既定の SQLite。環境で決まる時は設定 file を読まない |
| FR2.5・FR3.5・S5 | `src/stores/index.ts` | 41 | `createStore` が任意の `resolution` を受ける。`openResolvedStore`・`requireStoreBackend`: 開いた store の `backend` が決めた `backend` と違えば、store を閉じて拒否する（閉じる処理の失敗は拒否を隠さない）。`backend` を持たない試験用の差し替えは確かめない。`resolveStoreBackend` は持ち越しの入口のために残した |
| FR2.1 | `src/codex-session-start.ts`（1122 行 → 1052 行） | 40 | `resolveSessionStartStore` が `{ binding, resolution }` を返す。`AGENT_MEMORY_DATABASE_URL` への書き込みをやめた（決めた結果は返すだけ）。binding の作り方は結果から 1 か所で作る。SessionStart の証拠の形は変えない。呼び出し元の loader に結果を渡す |
| FR2.1 | `src/claude-session-start.ts`・`src/gemini-session-start.ts`・`src/antigravity-session-start.ts` | 8・4・4 | 3 つの loader が同じ `resolveSessionStartStore` と `openResolvedStore` を使う |
| FR2.2・FR4 | `src/transcript-stop-capture.ts` | 36 | store を開く前に決める。拒否は `failed_open` と `store_refused:<種類>`（出力は「続ける」のまま）。証拠に `store_backend`（決めた値。`requireStoreBackend` で開いた store の `backend` と一致を確かめてから書く。`backend` を持たない差し替えの store は一致の確かめを飛ばす）・`store_source`（決めた結果）を足す。開かなかった回は両方 `null` |
| FR2.2・FR4 | `src/session-rotation-stop.ts` | 29 | 保存の回にだけ決める（busy・none・blocked の回は決めない = 今は成功する回が設定 file の誤りで新しく失敗にならない）。証拠は同じ 2 項目（`transcript-stop-capture` と同じ決め方・同じ一致の確かめ）。この file は結果を `rotation-commit` へ渡さない（渡すのは SessionStart の 2 つの loader の側。下の `src/rotation-commit.ts` の行）。schema の const は動かさない（OQ1） |
| FR2.3 | `src/rotation-commit.ts` | 20 | 同じ process の SessionStart が決めた結果を引数で受け、`openResolvedStore` で開いて `consumeSelectedRestartPack` を走らせる。結果も seam も無ければ開かない（`consume: "unknown"`） |
| FR2.4・FR3.4 | `src/restart-cli.ts`・`src/stores/read-only-task-states.ts` | 17・4 | `fetch`・`prepare` は `resolveStore` で決め、`openResolvedStore` で開く。`handoff-source` の読むだけの reader も同じ決め方を使う。拒否は標準エラーに種類だけ、終了コード 1。`handoff-source` の標準出力は他の読めない保存先と同じ `unreadable` の JSON（`memory.md` の変更の 1） |
| R-01 | `src/kusabi-runtime-event-emitter.ts`（800 行ちょうど） | 31 | worker の `createQuietStore` が、決め方を自分で呼び（環境変数への書き込みに頼らない）、SessionStart が束ねた接続先の digest と比べ、別の場所なら store を作らず `binding_drift`、読めない・拒否は `store_unavailable`（緊急の記録）。JSON は fixture 専用のまま拒否 |
| 試験 | `package.json` | +4 / −2 | scripts `test:store-resolution`・`test:store-resolution-pg`。`npm run test:store-resolution` を `test` と `test:claude-hook` の連なりの最後に足した（`ci.yml` は変えない = 保護面。D10） |
| 文書 | `docs/operations/HOST_ADAPTERS.md` | +36 / −5 | 決め方の順・入口の一覧・拒否の動きと Stop の証拠の 2 項目を、実装に合わせて書き直した（設計に無い挙動を足したら設計にも足す = R3） |

触った file のうち、base で 800 行を超えていたのは `codex-session-start.ts`（1122 行）だけで、行数は 1052 行に減った（触る時に直す。まとめて直す計画は作らない）。`kusabi-runtime-event-emitter.ts` は base の 794 行から 800 行ちょうどになった（上限は 800 行。これ以上増やさない）。新しい file は 800 行以内（最大 `test-store-resolution-scenario.ts` の 731 行）。

## 試験（結果は `unit-test-instructions.md` の 8）

| file | 件数（最後の実行） | 内容 |
|---|---|---|
| `src/test-store-resolution.ts`（新） | 55 | U1〜U6・U11・U13: 核の表・拒否の組・adapter・不透明な接続先・`createStore`・SessionStart の証拠が直す前の表と同じ・literal の数（決め方を持つ file の一覧）・CI への到達（負例 2 つ） |
| `src/test-store-resolution-scenario.ts`（新） | 40 | 場面 S1・S3・S4・S6 と U5（antigravity・gemini）・U7〜U10・seam: Stop 2 種 × 2 host、9 通りの組、`rotation-commit`、`restart-cli`、emitter の拒否と接続先の違い（別の場所へ接続 0 件） |
| `src/test-store-resolution-pg.ts`（新。手元の使い捨ての PostgreSQL でだけ） | 5 | S2（書いた保存先と読む保存先が同じ。2 host）・S5・U12（Stop の保存の経路が流す statement が名指す表と列が、`pg-migrations` の後に全部ある） |
| `src/test-store-resolution-support.ts`・`-sql.ts`（新。試験を持たない） | — | 使い捨ての HOME・閉じた port・席の入力の共通部分、SQL の追跡 |
| 今ある試験 3 file を新しい動きに合わせて直した | — | `test-codex-session-start.ts`・`test-session-rotation-core.ts`・`test-transcript-stop-capture.ts`（理由は `unit-test-instructions.md` の 8） |
| 今ある試験 24 本 | 全部終了コード 0 | core は `1832 passed, 0 failed`（FR5.8） |

直す前の code（`27d7f8f` の `src/`）に新しい試験を当てると、S1 が 4 件・S6 が 3 件・S5 が 1 件失敗し、S2 は「Stop が SQLite に保存し、SessionStart が 0 行を読む」を再現し、S3 は 9 通りのうち 2 通りで入口の決め方が分かれた（`unit-test-instructions.md` の 4）。

## 機械の確かめ

- 網羅率: 全部の命令（13 個）も、CI が届く命令（10 個）だけも、`RESULT PASS changed_files=12 changed_lines=474 uncovered_lines=0 unreadable_files=0`。自己試験 8 件（n1〜n8）が通る（`coverage-method.md`）。数えから外した追加行は無い。
- 型検査: プロジェクトの `tsc --noEmit -p .`（strict）は終了コード 0。試験の file は、その設定が除いているので別に流した（設定と対象は `unit-test-instructions.md` の 8）。新しい試験の型の誤りは 0 件で、残る 2 件は `origin/main` にもある既存の誤り（`test-codex-session-start.ts`）。
- E1（`ci.yml` の step の文字をそのまま流す。故意の失敗は step を終了コード 1 にし、足さない実行は 0）: 最後の版の試験 file で確かめた。C1（PR の CI の log に、3 つの Node の版で新しい試験の終わりの行が出ること）は、PR #347 の最初の head の CI（run 43796115600）で確かめた: 3 つの版すべてで `store-resolution: 55 checks passed` と `store-resolution-scenario: 40 checks passed`（6 行）。build-and-test は 18・20・22 とも success。
- DDL の行 0 件: `src/stores/pg-migrations.ts` は base と byte 同一。追加行 474 のうち `CREATE`・`ALTER`・`DROP`・`TRUNCATE` を含む行は 0 件。U12 も通った。表と列の一覧は、席へ当てる前の本番の確認（計画の 7 の 3）に渡す（`unit-test-instructions.md` の 8）。
- 新しい外部の依存: 0（`package.json` の差分は scripts の 4 行の追加と 2 行の書き換えだけ）。記憶の中身を外の API へ送る経路は足していない。

## 計画から変えた所

`memory.md` の Deviations に全部ある（設計監査 1 回目の SR-BF-01 を受けた CI への接続、作業場の根で書いたこと、作る段で改めた 8 点、作る段の終わりに足した 5 点）。要点は次の 4 つ。

1. `restart-cli handoff-source` は、結果を渡す形ではなく、読むだけの reader が自分で決め方を呼ぶ形のままにした。呼ぶ側が標準出力の `result` を読むので、拒否の時は標準エラーに種類を出し、標準出力は他の読めない保存先と同じ `unreadable` の JSON にした（計画の「標準出力なし」を直した）。
2. 網羅率の script の自己試験は、計画の 6 件に n7（対象が 0 件）と n8（作業場が追跡していない file の追加行）を足した 8 件。最初の測定が、`origin/main` にあって作業場で追跡されていない file を「追加行なし」と読み、2 file を対象から落としたため。
3. CI が届く命令だけで測ると 474 行のうち 8 行が未実行だったので、試験を 2 つ足した（`U5 (gemini)`・`U10 (in process)`）。code は変えていない。
4. 試験の file の型検査を別に流した（プロジェクトの設定は試験を除く）。

## 他の文書（Step 13）

`grep` で、保存先の決め方を書いた文書を取り直した。`HOST_ADAPTERS.md` だけが「どの入口が決めるか」を書いていたので直した。`COMMON_DB_ALIGNMENT.md`（共通 DB の見つけ方の将来の案）・`KUSABI_V2_BACKEND_PARITY_MATRIX.md`（環境変数で保存先を指す形の主張）・`SSOT-5_CROSS_CUTTING.md`（接続文字列の認証）・`MEMORY_BINDING_REMEDIATION_RUNBOOK.md`・`MEMORY_PERSISTENCE_AUDIT_2026-06-22.md`（当時の監査の記録）は、環境変数で指す形か当時の記録で、新しい決め方と食い違う文が無いので触っていない（同じ規則を 2 か所に書かない = S3）。

## 持ち越し（記録だけ。この PR では直さない）

- SQLite の binding の digest（`src/store-resolution.ts` の `localStoreBindingSha256`、226-227 行）は `AGENT_MEMORY_DB_PATH || 既定の path` で作る。store の側（`resolveSqliteDbPath(undefined, env)`、`src/stores/sqlite-store.ts` の 58 行）は `AGENT_MEMORY_DB_PATH ?? 既定の path`。2 つが違う答えを返すのは、`AGENT_MEMORY_DB_PATH` が空文字の時だけ（digest は既定の path、store は空の path）。同じ `||` と `??` の違いは `origin/main`（27d7f8f）の `src/codex-session-start.ts` の `localStoreBindingSha256`（295-296 行）と `src/stores/sqlite-store.ts` の 58 行の間に既にあり、この PR が持ち込んだ物ではない（この PR は digest を作る関数を `src/store-resolution.ts` に移した）。この PR の試験は空文字の場合を流していない（コードを読んで確かめただけ）。席の起動の環境は読んでいないので、`AGENT_MEMORY_DB_PATH` が空文字の席があるかは分からない。次にこの 2 か所を触る時に、どちらかの形にそろえる（見直し役の R-04）。

## この PR に入れていない物（守る物。Owner の決定が要る）

- `.github/workflows/ci.yml`（保護面）。新しい試験は `package.json` の連なりから CI に届く（D10）。
- DB の構造の変更（DDL・migration）。0 件。
- 席の起動・展開・設定の変更、壊れた `memory.db` の扱い、本番の PostgreSQL への接続。この取り組みの中では何も実行していない（計画の 7 は、Owner と arc が別に見る確認の一覧）。
- 作業場の仕組みの file（`.claude/`・`.aidlc-version`・`.framework/`・`.gitignore` など）と、AI-DLC の作業の log（`audit/`）・engine の内部（`.aidlc-engine/`）。

## 次

1. 単位の PR #347（`kusabi/store-resolution-261113`。一時の index から作った。この単位の AI-DLC の記録を入れた）は出した。R3 の PR（DB の書き込みの経路。守る物）なので、CI（Node 18・20・22）と C1 は最初の head で通った。残りは、独立の実装監査 1 回、作者の受領、Owner の exact-head で、通してから作者と別の席が統合する。
2. 後の段: Build and Test → Deployment Pipeline → Deployment Execution（席への配備は保護面。Owner の認可を得てから）。
