# 試験の手順 — 保存先の決め方を 1 つの関数にする（取り組み 261113-store-resolution-fix）

この文書は、`code-generation-plan.md` の試験の計画（S1〜S6・U1〜U14・E1・C1）を、監査の席が同じ命令で流せる形に書いた物。命令は、この取り組みの単位（1 つの PR）に絞った物だけで、`npm test` の全体を 1 回で流す形は使わない（各 file を個別に流す）。結果の欄（4・5・8）は、作る段（Code Generation）の最後に、命令の出力から写して埋めた（時点は 8 に書く）。

## 1. 流す環境（この Mac の本物の保存先に行を入れない）

どの命令も、使い捨ての `HOME` で流す。`HOME` の中に `.agent-memory` を先に作り、試験の親の folder を `KUSABI_TEST_TMPDIR` で渡す（project.md の学び。無いと code の失敗ではなく環境の誤りで止まる）。

```bash
cd <作る作業場>                               # 最新の origin/main から切った worktree
BASE=$(git merge-base HEAD origin/main)
H=$(mktemp -d); mkdir -p "$H/.agent-memory"
T=$(mktemp -d)
run() { HOME="$H" AGENT_MEMORY_HOME="$H/.agent-memory" KUSABI_TEST_TMPDIR="$T" "$@"; }
```

- 試験は、環境変数の `AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`DATABASE_URL` を、自分で組んだ値に置き換える（席の起動の環境を引き継がない）。`run` の前に `env -u` で外すか、試験の中で `env` を渡す。
- 接続先の URL は、試験の file の中で組み、記録・log・証拠に書かない。

## 2. 命令（個別に流す）

| 命令 | 内容 | PostgreSQL |
|---|---|---|
| `run npx tsx src/test-store-resolution.ts` | U1〜U6・U11・U13（核・adapter・不透明な接続先・`createStore`・SessionStart の証拠・機械の確かめ・CI への到達）。終わりの行は `store-resolution: <件数> checks passed`（最後の実行は 57 件）| 不要 |
| `run npx tsx src/test-store-resolution-scenario.ts` | S1・S3・S4・S6・U5（antigravity・gemini）・U7〜U10（Stop 2 種 × 2 host・`rotation-commit`・`restart-cli`・emitter の拒否と接続先の確かめ・emitter を同じ process で動かす確かめ）・保存先の seam（別の backend で開いた store を拒否し、閉じる処理の失敗が拒否を隠さない）。終わりの行は `store-resolution-scenario: <件数> checks passed`（最後の実行は 40 件）| 不要。S1 は閉じた port を指す URL、S6 は接続を数える listener なので、CI でも流れる |
| `npx tsx src/test-store-resolution-isolation.ts`（`run` を付けない。自分で使い捨ての home を作る） | 試験の隔離（IM-BF-01）。公開の命令 5 本（`test-store-resolution.ts`・`-scenario.ts`・`test-codex-session-start.ts`・`test-transcript-stop-capture.ts`・`test-session-rotation-core.ts`）を、旧形式の JSON store・database でない `memory.db`・PostgreSQL を指す設定 file を持つ stand-in の home を指す `HOME` と保存先の環境変数で流し、stand-in の全部の名前・大きさ・内容の hash・更新時刻（folder も）が変わらないことを確かめる。対照（store の module を HOME の切り替えの前に読み込むと stand-in が書き換わる）と、bootstrap が最初の import であることの確かめ付き。終わりの行は `store-resolution-isolation: <件数> checks passed`（最後の実行は 9 件）| 不要 |
| `run env DATABASE_URL=<使い捨ての PostgreSQL> npx tsx src/test-store-resolution-pg.ts` | S2・S5・U12（書いた保存先と読む保存先が同じ・emitter の設定 file だけの形・DDL と表と列の突き合わせ。最後の実行は 5 件）| 要る（手元でだけ。結果を PR に載せる）。`DATABASE_URL` が無ければ、飛ばさず失敗で終わる（S8）|
| `run npx tsx src/test-codex-session-start.ts` | 今ある試験（SessionStart の Codex）。通ったまま | 不要 |
| `run npx tsx src/test-claude-session-start.ts` | 同（Claude Code）| 不要 |
| `run npx tsx src/test-gemini-session-start.ts` | 同（Gemini CLI）| 不要 |
| `run npx tsx src/test-antigravity-session-start.ts` | 同（Antigravity CLI）| 不要 |
| `run npx tsx src/test-transcript-stop-capture.ts` | 同（`transcript-stop-capture`）| 不要 |
| `run npx tsx src/test-session-rotation-flow.ts` | 同（`session-rotation-stop` の流れ）| 不要 |
| `run npx tsx src/test-handoff-commit-order.ts` | 同（`rotation-commit` の順）| 不要 |
| `run npx tsx src/test-handoff-source.ts && run npx tsx src/test-handoff-source-cli.ts` | 同（`handoff-source` と読むだけの reader）| 不要 |
| `run npx tsx src/test-kusabi-runtime-event-emitter.ts` | 同（emitter）| 不要 |
| `run npx tsx src/test-session-rotation-scenario.ts` | 同（切り直しの場面）| 不要 |
| `run npx tsx src/test.ts` | 同（core。`KUSABI_TEST_TMPDIR` が要る）| 不要 |

足す試験の命令は `package.json` に `test:store-resolution`（`test-store-resolution.ts`・`-scenario.ts`・`-isolation.ts` の 3 つをつなげた命令）と `test:store-resolution-pg` として置き、`npm run test:store-resolution` を `test:claude-hook` の連なりの最後と `test` の連なりの最後に足す。27d7f8f の `ci.yml` は `npm test` を流さず、step「Run native recovery and automatic receive tests」の `npm run test:claude-hook` から届かせる（workflow は変えない。D10）。今ある試験が通ったまま（FR5.8）であることを、上の表の命令の終了コードで確かめる。

## 3. 使い捨ての PostgreSQL（手元でだけ）

本番にも席の DB にも触れない。socket を切って 127.0.0.1 の TCP だけにし、誤りの文を英語にし、`vector` を入れる（project.md の学び）。

```bash
PGD=$(mktemp -d)
initdb -D "$PGD/data" -A trust -U kusabi_test
pg_ctl -D "$PGD/data" -o "-c unix_socket_directories= -c listen_addresses=127.0.0.1 -c port=<空いている port> -c lc_messages=C" -l "$PGD/log" -w start
createdb -h 127.0.0.1 -p <port> -U kusabi_test kusabi_store_resolution
psql -h 127.0.0.1 -p <port> -U kusabi_test -d kusabi_store_resolution -c 'CREATE EXTENSION vector'
# 終わったら: pg_ctl -D "$PGD/data" -m fast stop; rm -rf "$PGD"
```

PostgreSQL の試験は、既存の `src/test-pg.ts` と同じく、試験ごとの schema を作って流し、終わりに消す（`withPgSearchPath`）。表の作りは `pg-migrations` を流したものだけを使い、DDL を試験が足さない。

## 4. 失敗の確かめ（FR5.6。直す前の code で流した結果）

直す前の code（`origin/main` の `27d7f8f` の `src/` の写し）に、新しい試験を当てて流し、失敗の理由が不具合の理由であること（試験が読み込みで落ちただけではないこと）を確かめた。次は、その時の出力から写した。直した後の code では、同じ試験が全部通る（8 に件数）。

- S1（`red-scenario-2`。当時の S1・S6 の 8 件を、直す前の code に流した。**7 件が失敗**し、終了コード 1）: 設定 file だけが PostgreSQL を指す席の Stop で、`transcript-stop-capture` は `failed_open` を期待したのに `skipped`（既定の SQLite を開いて何も無かった）、`session-rotation-stop` は `failed_open` を期待したのに `saved`（引き継ぎを既定の SQLite に保存した）。これが Codex と Claude Code の 2 host × 2 hook で 4 件。標準エラーに `Using SQLite storage (default)` が出ており、失敗の理由は不具合の理由（保存先の決め間違い）。
- S2（`red-s2s3s4`）: 直す前の Stop は `action=saved sqlite_file_created=true`（既定の SQLite の file ができ、そこに保存した）。同じ席の SessionStart は `postgres/user_config` を開き、`rows_read=0`（保存したはずの引き継ぎが読めない）。これが不具合の再現。PostgreSQL を使う S2 の本体（`test-store-resolution-pg.ts`）は、直した後の code で 2 host とも `ok`。
- S3・S4（`red-s2s3s4`）: 9 通りの組（環境の URL のみ・設定のみ・両方・sqlite 明示 + 設定の URL・json 明示・何も無し・設定に URL なし・postgres 明示 + 環境の URL・postgres 明示 + 設定の URL）で、SessionStart と Stop・restart の入口が別の決め方をした組が **2 通り**: 「設定のみ」（SessionStart は `postgres/user_config`、Stop・restart は `sqlite`）と「postgres 明示 + 設定の URL」（SessionStart は `postgres/user_config`、Stop・restart は拒否）。残り 7 通りは同じ決め方だった。直した後は 9 通りとも同じ決め方になる（`test-store-resolution-scenario.ts` の S3 が、9 通りの組それぞれを確かめる）。
- S5（`red-pg`）: 設定 file だけが PostgreSQL を指す席の emitter の worker が、`durable` を期待したのに `emergency_only`（PostgreSQL に届かず、緊急の記録だけが残った）。`store-resolution-pg: 1 of 1 checks failed`、終了コード 1。
- S6（`red-scenario-2` の残りの 3 件）: worker が、SessionStart の束ねた先と別の PostgreSQL（環境で指した場合・設定で指した場合）へ接続を試み、別の SQLite の file も作った。直した後は、別の場所への接続が 0 件で、結果は `binding_drift`（S6 の対の正例は、直す前も直した後も通る）。

## 5. CI への到達の確かめ（D10。SR-BF-01）

新しい試験が CI から本当に届くことを、3 つの確かめで見る。どれも、PR を出す前の手元か、PR の CI の後に行い、出力を `code-summary.md` に写す。

- **U13（機械の到達の確かめ）**: `src/test-store-resolution.ts` の中。`.github/workflows/ci.yml` の `run:` の行から、`npm run <名前>` を `package.json` の scripts でたどった集合に、新しい試験 3 file の `tsx` の行が入ることを確かめる。負例（試験の中で組んだ `package.json` の写し）: 連なりを外した写し、`test` の連なりだけに足した写し（この計画の最初の版）、script から 3 つのうち 2 つを外した写し、isolation だけを外した写しで、同じ確かめが失敗する。限界: 新しい試験が連なりから外れると、U13 自身も流れなくなる。外れたことは E1・C1 と、監査席が同じ命令で流す再実行で見つける。
- **E1（意図的な失敗。PR を出す前に 1 回）**: 作業場の写し（`src/`・`scripts/`・`.github/`・`docs/`・`package.json`・`tsconfig.json` を使い捨ての folder に写し、`npx tsc` で `dist/` を作る。CI の Build と同じ）を 2 つ作り、片方の `src/test-store-resolution-scenario.ts` の先頭に `throw new Error("intentional failure for E1")` を足す。`ci.yml` の step「Run native recovery and automatic receive tests」の `run:` の文字を機械で取り出し（手で写さない）、2 つの写しで `bash -e` と使い捨ての `HOME` を付けて流す。足さない写しは終了コード 0 で、足した写しは 0 でない終了コードで終わり、出力が `test-store-resolution-scenario.ts` を指すことを確かめる。作業場の file は触らない（写しで流すので、戻す手順も要らず、失敗させた状態が commit にも push にも入らない）。
- **C1（CI の log。PR の CI が終わった後）**: `gh run view <run id> --log` の 3 つの Node の版（18・20・22）の job それぞれで、`store-resolution: <件数> checks passed`・`store-resolution-scenario: <件数> checks passed`・`store-resolution-isolation: <件数> checks passed` の 3 行を数える（3 つの job × 3 行 = 9 行。最初の head の時点では isolation の試験が無く、2 行 × 3 = 6 行だった）。欠けた行があれば失敗として PR の本文に書く。件数は出力から写し、手で数えない。

PostgreSQL の試験（`test-store-resolution-pg.ts`）は CI に届かない（CI に PostgreSQL が無い。`ci.yml` の注記のとおり）。手元の結果を PR の証拠にする。

結果（8 にも写す）:

- U13: `test-store-resolution.ts` の 1 件（`U13: the commands CI runs reach the three new test files, and the check fails on the wrong shapes`）が通った。負例 4 つ（連なりを外した写し・`test` の連なりだけに足した写し・script から 2 つを外した写し・isolation だけを外した写し）で同じ確かめが失敗することを含む。
- E1（最後の版の作業場の写し。`src/test-store-resolution-scenario.ts` の SHA-256 `0705ca5667065f1f5052dbf8bab40af95cec3e5c4f11ac0eadbc20d8781e715b`）: `ci.yml` の step の `run:` の 5 行（`npm run test:codex-hook`・`test:claude-hook`・`test:gemini-hook`・`test:gemini-conversation-ingest`・`test:automatic-receive`）を機械で取り出して流した。足さない写しは終了コード 0 で、出力に `store-resolution: 57 checks passed`・`store-resolution-scenario: 40 checks passed`・`store-resolution-isolation: 9 checks passed` の 3 行。先頭に `throw new Error("intentional failure for E1")` を足した写しは終了コード 1 で、`test:store-resolution` の連なりが scenario の試験で止まり（出力に `Error: intentional failure for E1` と `test-store-resolution-scenario.ts:1`）、isolation の試験は流れない。作業場の file は触っていない（上の SHA-256 は作業場の file のもの。写しの SHA-256 と同じ）。前の版の E1 は、作業場に 1 行を足して戻す形で流した。
- C1: PR #347 の最初の head（`de80f4aa`）の CI（run 43796115600）の log で、3 つの Node の版（18・20・22）の job それぞれに `store-resolution: 55 checks passed` と `store-resolution-scenario: 40 checks passed` の 2 行が出た（3 job × 2 行 = 6 行。`gh run view 43796115600 --log` を grep して数えた）。その後、試験の隔離の試験（`store-resolution-isolation`）を足し、連なりが 3 行になった。実装監査 1 回目の後の head の CI の log の件数（3 job × 3 行 = 9 行になる想定）は、その head が決まって CI が終わった後でないと取れないので、記録には書かず、PR の comment で報告する（監査席は最後の head の CI の log で同じ命令を流して取り直す）。

## 6. 網羅率（NFR6・R-05。D11・SR-BF-03）

対象は、この PR が足した行と変えた行（base との差分の追加行）。前の取り組みの 2 つの script（`aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/coverage-method.md` の `merge-zero.mjs`・`changed-uncovered.py`）は、**byte 同一で写して使わない**: 変えた file が読み込まれていない時に `uncovered_ranges_in_changed=0` を出し、100% と読めてしまう。この取り組みの `coverage-method.md` に、未観測を 0 と数えない版を書く（仕様は計画の Step 12）。

1. 先に、U14 の 16 件（n1 空の報告・n2 未ロード・n3 報告に file が無い・n4 一部だけ未ロード・n5 0 回の範囲が追加行に重なる・n6 正例・n7 対象が 0 件・n8 作業場が追跡していない file の追加行・n9 報告を全部の行の境目と行の途中と最後の改行の前で切った形〔落ちる報告・通る報告のそれぞれ〕・n10 `END` の行と `COLLECTOR_DONE` の欠けと不一致）を流し、出力と終了コードを記録に残す。n1〜n5・n7・n9・n10 が 0 でない終了コード、n6 が 0、n8 は追加行が対象に入ることの確かめ。結果は `coverage-method.md` の 3。
2. 全試験の命令を同じ `NODE_V8_COVERAGE` の folder に流す（子 process の分も集まる）。命令の一覧は `coverage-method.md` の 2（13 個。使い捨ての PostgreSQL の試験は含めない）。あわせて、CI の `run:` が届く 10 個の命令だけでも同じ判定を流す。
3. base から変わった `src/` の試験でない file について、`RESULT PASS` かつ `uncovered_lines=0` と読めた時だけ、100% を満たしたと書く。`RESULT FAIL`・`NOT_LOADED`・`MISSING`・`UNKNOWN` の file が 1 つでもあれば、満たしていない。数えから外した行があれば理由を書く。
4. 結果は、命令・Node の版・base の commit・file の数・追加行の数・未実行の行・数えられなかった file を、`code-summary.md` に書く（時点を添える）。

## 7. DB の確認（FR6）

- DDL の行: `git diff "$BASE" -- src/stores/pg-migrations.ts` の差分が 0 行であることと、差分全体の中の `CREATE`・`ALTER`・`DROP`・`TRUNCATE` の追加行が 0 件であること（`store` の folder に file が増えるかどうかでは確かめない）。
- 表と列: U12 が、使い捨ての PostgreSQL に `pg-migrations` を流し、Stop の保存の経路（`saveTaskState`・`saveSelectedRestartPack`・`consumeSelectedRestartPack`・`saveRawEvent`・`saveConversationEvent`・`getRawEvents`）が流す statement を `pg` の query の記録から取り、名指す表と列が `information_schema` に全てあることを確かめる。構文から取れない statement があれば失敗にする（飛ばさない）。確かめた表と列の一覧は、席へ当てる前の本番の確認（計画の 7 の 3）に渡す（一覧は 8）。

## 8. 結果の欄（命令の出力から写した値。手で数えていない）

時点: 2026-11-16（作る段の最後。Node v26.13.1。CI は Node 18・20・22 で、C1 は PR #347 の最初の head の CI の後に埋めた。実装監査 1 回目の後の直しで 4 つの結果〔試験の件数・E1・型検査・網羅率〕を取り直した）。試験を流した code の対象は、`origin/main` の `27d7f8f` から変えた 12 file（追加行 487）。

- 試験の命令ごとの終了コードと件数（最後の実行）:

  | 命令 | 終了コード | 終わりの行 |
  |---|---|---|
  | `test-store-resolution.ts` | 0 | `store-resolution: 57 checks passed` |
  | `test-store-resolution-scenario.ts` | 0 | `store-resolution-scenario: 40 checks passed` |
  | `test-store-resolution-isolation.ts` | 0 | `store-resolution-isolation: 9 checks passed` |
  | `test-store-resolution-pg.ts`（使い捨ての PostgreSQL） | 0 | `store-resolution-pg: 5 checks passed` |
  | 今ある試験 24 本（下） | 全部 0 | core は `Results: 1832 passed, 0 failed` |

  今ある試験 24 本: `test-codex-session-start`・`test-claude-session-start`・`test-gemini-session-start`・`test-antigravity-session-start`・`test-transcript-stop-capture`・`test-session-rotation-flow`（47 件）・`test-handoff-commit-order`（35 件）・`test-handoff-source`（13 件）・`test-handoff-source-cli`（14 件）・`test-kusabi-runtime-event-emitter`・`test-session-rotation-scenario`・`test`（core）・`test-session-rotation-core`・`test-hook-input`・`test-hook-input-diagnostics`・`test-hook-node-path`・`test-claude-hook-installer`・`test-rotation-hook-registration`（13 件）・`test-session-rotation-status`（18 件）・`test-rotation-watcher-units`・`test-rotation-watcher-flow`（109 件）・`test-codex-hook-installer`・`test-session-start-auto-receive`・`test-claude-transcript-identity`（25 件）。24 本とも終了コード 0（FR5.8）。変えた既存の試験は 3 file: `test-codex-session-start.ts`（追加 17・削除 12 行）、`test-session-rotation-core.ts`（1・1）、`test-transcript-stop-capture.ts`（8・2）。変えた理由: `test-codex-session-start.ts` は、決め方の関数を共有し、環境変数への書き込みをやめた（決めた結果は返すだけ。`memory.md`）ため。`test-session-rotation-core.ts` は、`createStore(` を数える原文の走査が `openResolvedStore(` も数えるようにした 1 行。`test-transcript-stop-capture.ts` は、seam が JSON の store を返すので、渡す決め方も JSON にした（別の backend の store は拒否される）ため。
- CI への到達（U13・E1・C1）: U13 と E1 は 5 に書いた。C1 は 5 の結果のとおり、PR #347 の最初の head の CI で 6 行（3 job × 2 行）が出た。
- 網羅率: `coverage-method.md` のとおり。全部の命令（13 個）も、CI が届く命令（10 個）だけも、`RESULT PASS changed_files=12 changed_lines=487 uncovered_lines=0 unreadable_files=0`。自己試験は `coverage-selftest: 16 cases passed`。
- 型検査の設定の内容と対象 file:
  - プロジェクトの `tsc --noEmit -p .`（`tsconfig.json`: `strict: true`、`target ES2022`、`module ESNext`、`moduleResolution bundler`、`skipLibCheck: true`、`include: src/**/*`、`exclude: node_modules・dist・src/test*.ts`）: 終了コード 0、出力 0 行。**この設定は試験の file を含まない**（`src/test*.ts` を除く）。
  - 試験の file の型検査（別に流した。使い捨ての設定 file で、上の `tsconfig.json` を `extends` し、`noEmit: true`・`declaration: false`・`sourceMap: false` に変え、対象を次の 11 file に絞った）: `src/store-resolution.ts`・`src/test-store-resolution.ts`・`src/test-store-resolution-scenario.ts`・`src/test-store-resolution-pg.ts`・`src/test-store-resolution-support.ts`・`src/test-store-resolution-sql.ts`・`src/test-store-resolution-isolation.ts`・`src/test-isolated-home.ts`・`src/test-codex-session-start.ts`・`src/test-session-rotation-core.ts`・`src/test-transcript-stop-capture.ts`（import で届く file を含め、検査の対象は 57 file。`tsc --listFilesOnly` で数えた）。結果: 新しい試験 file の型の誤りは 0 件（最初に出た 5 件 — `reason` の型 4 件と、環境変数の型 1 件 — は型だけの直しで消した）。残る 2 件は `src/test-codex-session-start.ts(409,7)` と `(423,9)`（`CodexStoreBindingEvidence | undefined` を `CodexStoreBindingEvidence` に渡す）で、`origin/main` の同じ file も同じ 2 件（404・418 行）を出す、この PR より前からの誤り。この PR が触らない行なので直さず、`memory.md` に残す。
- 試験の隔離（IM-BF-01）: `store-resolution-isolation: 9 checks passed`（終了コード 0）。直す前の tree（実装の PR の最初の監査に出した head `6a91e1f3` の `src/`。bootstrap が無い）に、この isolation の試験だけを足して流すと、対照と `test-store-resolution.ts` は通り、`test-store-resolution-scenario.ts` の段で `AssertionError ... changed nothing in the stand-in home` になり、stand-in の `task-states.json`（旧形式の 2 行、296 byte）が書き換えられて 228 byte になった（終了コード 1）。直した後の code では、公開の命令 5 本とも stand-in が変わらない。限界: stand-in の home への読むだけの触れ方（読んで何も書かない）は、書き換え・拒否・試験の失敗という効果としてしか見えない。この Mac の実際の home を指す環境変数・設定は、試験が使い捨ての値に置き換える（読み方はコードで確かめた物）。
- PostgreSQL の失敗の出し方（OBS-2）: `test-store-resolution.ts` の U5 の 2 件（鍵・証明書の path を名指す URL で、標準エラー・message・stack・inspect に path が出ず `code` が `ENOENT`・標準エラーの行が `: kind=ENOENT` で終わる／`postgresFailureKind` が code の形で種類か `unknown` を返す）。直す前の `createStore` の失敗の処理（driver の文をそのまま出して `cause` に持つ）に当てると、この 2 件は失敗した。`test-store-resolution-scenario.ts` の S3 は、環境の URL（接続を拒まれる = `ECONNREFUSED`）と設定 file の URL（鍵の file が無い = `ENOENT`）を、失敗の種類で区別する。
- DB の確認の一覧:
  - DDL: `src/stores/pg-migrations.ts` は base と byte 同一（SHA-256 `dbc0546aa79d3c6afa1244b2956862f4d436a312e8df4d683a18970b3379b939`）で差分 0 行。追加行 487 のうち `CREATE`・`ALTER`・`DROP`・`TRUNCATE` を含む行は 0 件（base の blob と `git diff --no-index -U0` で 12 file を比べた）。U12 の「DDL の行を足さない」確かめも通った。
  - 表と列（U12 が使い捨ての PostgreSQL で `information_schema` と突き合わせた。席へ当てる前の本番の確認に渡す一覧）:
    - `conversation_events`: agent_id, content, content_hash, id, metadata, occurred_at, project, role, source, source_event_id, source_path
    - `raw_events`: agent_id, content, content_hash, content_json, content_text, event_at, event_type, host, id, metadata, occurred_at, private_reasoning, project, redaction_level, role, session_id, source, source_event_id, source_path, source_ref, source_ref_hash
    - `selected_restart_packs`: agent_id, consumed_at, content, content_hash, expires_at, id, metadata, pack_ref, project, source, status
    - `task_states`: agent_id, embedding, files_modified, id, next_steps, progress, project, status, task, task_id, updated_at
