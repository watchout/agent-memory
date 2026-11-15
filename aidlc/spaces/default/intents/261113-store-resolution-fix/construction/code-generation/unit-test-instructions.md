# 試験の手順 — 保存先の決め方を 1 つの関数にする（取り組み 261113-store-resolution-fix）

この文書は、`code-generation-plan.md` の試験の計画（S1〜S5・U1〜U12）を、監査の席が同じ命令で流せる形に書いた物。命令は、この取り組みの単位（1 つの PR）に絞った物だけで、`npm test` の全体を 1 回で流す形は使わない（各 file を個別に流す）。書いた時点では code が無いので、結果の欄は空にしてあり、作る段で埋める。

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
| `run npx tsx src/test-store-resolution.ts` | U1〜U6・U11（核・adapter・不透明な接続先・`createStore`・SessionStart の証拠・機械の確かめ）| 不要 |
| `run npx tsx src/test-store-resolution-scenario.ts` | S1・S3・S4・U7〜U10（Stop 2 種 × 2 host・`rotation-commit`・`restart-cli`・emitter の拒否）| 不要。S1 は、閉じた port を指す URL なので CI でも流れる |
| `run env DATABASE_URL=<使い捨ての PostgreSQL> npx tsx src/test-store-resolution-pg.ts` | S2・S5・U12（書いた保存先と読む保存先が同じ・emitter の設定 file だけの形・DDL と表と列の突き合わせ）| 要る（手元でだけ。結果を PR に載せる）。`DATABASE_URL` が無ければ、飛ばさず失敗で終わる（S8）|
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

足す試験の命令は `package.json` に `test:store-resolution` と `test:store-resolution-pg` として置き、`test` の連なりの最後に `npm run test:store-resolution` を足す（CI は `npm test` を流すので workflow は変えない）。今ある試験が通ったまま（FR5.8）であることを、上の表の命令の終了コードで確かめる。

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

## 4. 失敗の確かめ（FR5.6。直す前の code で流した結果をここに書く）

Step 3 で、S1〜S5 を直す前の code（27d7f8f と同じ内容）に対して流し、失敗の出力と、失敗の理由が不具合の理由であること（試験が読み込みで落ちただけではないこと）を書く。

- S1: （結果の欄。直す前は Stop が既定の SQLite を開き、SQLite の file が作られて「保存」になる。直した後は `failed_open` で、SQLite の file が作られない）
- S2: （結果の欄）
- S3・S4: （結果の欄）
- S5: （結果の欄）

## 5. 網羅率（NFR6・R-05）

対象は、この PR が足した行と変えた行（base との差分の追加行）。前の取り組みの `coverage-method.md`（`aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/coverage-method.md`）の `merge-zero.mjs` と `changed-uncovered.py` を、この取り組みの `coverage-method.md` に同じ byte で写して使う（写した file の SHA-256 が元と同じことを確かめる）。全試験の命令（上の 2 の表）を同じ `NODE_V8_COVERAGE` の folder に流し（子 process の分も集まる）、base から変わった src の file（`src/test` で始まる物を除く）の 0 回の範囲を足し合わせて、追加行と重ねる。結果は、命令・Node の版・base の commit・file の数・追加行の数・0 回の範囲（数えから外した行があれば理由）を、`code-summary.md` に書く（時点を添える）。

## 6. DB の確認（FR6）

- DDL の行: `git diff "$BASE" -- src/stores/pg-migrations.ts` の差分が 0 行であることと、差分全体の中の `CREATE`・`ALTER`・`DROP`・`TRUNCATE` の追加行が 0 件であること（`store` の folder に file が増えるかどうかでは確かめない）。
- 表と列: U12 が、使い捨ての PostgreSQL に `pg-migrations` を流し、Stop の保存の経路（`saveTaskState`・`saveSelectedRestartPack`・`consumeSelectedRestartPack`・`saveRawEvent`・`saveConversationEvent`・`getRawEvents`）が流す statement を `pg` の query の記録から取り、名指す表と列が `information_schema` に全てあることを確かめる。構文から取れない statement があれば失敗にする（飛ばさない）。確かめた表と列の一覧は、席へ当てる前の本番の確認（計画の 7 の 3）に渡す。

## 7. 結果の欄（作る段で埋める。手で数えた値は書かず、命令の出力から写す）

- 試験の命令ごとの終了コードと件数: （空）
- 網羅率: （空）
- 型検査の設定の内容と対象 file: （空）
- DB の確認の一覧: （空）
