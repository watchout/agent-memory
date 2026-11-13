# 作り方の手順 — 会話の切り直し（261110-session-rotation）

この取り組みは新しい依存も、DB の作りの変更も、workflow の変更も足さない。作り方は main と同じで、手順は今の `package.json` と `.github/workflows/ci.yml` に従う。

## 前提

- Node: `package.json` の `engines` は 20 以上。CI は Node 18・20・22 で回す（`.github/workflows/ci.yml` の matrix）。手元の確かめは 1 つの版で行い、版を記録する（`test-results.md`）。
- 道具: npm。TypeScript の strict の型検査は `tsc`、試験の実行は `tsx`（どちらも `devDependencies` に既にある）。
- 試験の Store は SQLite か JSON の file。本番の PostgreSQL は使わない（この取り組みは表の作りを変えない。NFR5）。

## 依存の入れ方

```bash
npm ci
```

`package.json` の変更はこの取り組みでは `scripts`（試験の命令）だけで、依存と lock は変わっていない。

## 環境

- build に環境変数は要らない。
- 試験は、すべて `HOME` を使い捨ての folder にして動かす（`HOME=$(mktemp -d) ...`）。既定の `createStore()` は JSON の置き場を `homedir()` から決めるので、`HOME` を指定しないと、この Mac の実際の保存先に試験の行が入る（11-11 の作る段で実際に入った。`project.md`）。`AGENT_MEMORY_HOME` も同じ folder の下にすると、診断の記録（`hook-input-diagnostics`）の置き場も使い捨てになる。
- core の試験の file は `KUSABI_INTEGRATED_BUILT_EXECUTION=1` を付ける（CI と同じ）。`dist/` を起動する試験があるため、先に build する。
- core の試験（`src/test.ts`）は、試験の親 folder を `KUSABI_TEST_TMPDIR`（CI では `RUNNER_TEMP`）で受け取る。無いと `KUSABI_TEST_TMPDIR_REQUIRED` で止まる。使い捨ての folder を渡す。
- 使い捨ての `HOME` の中には、先に `.agent-memory` の folder を作っておく（`mkdir -p "$HOME/.agent-memory"`）。無いと、core の試験の 1 件（`isolation rejects shared memory before any store operation`）が、macOS の `/var` と `/private/var` の綴りの違いで落ちる（2026-11-13 の最初の流しで実際に落ちた）。`coverage-method.md` の `run()` は最初からこの形。
- `src/test-post-tool-hook.ts` は `DATABASE_URL` が無いと 0 で先に終わる（main の CI でも同じ）。網羅率を測る時だけ `AGENT_MEMORY_DB_TYPE=sqlite` を足す。
- PostgreSQL の試験（`npm run test:pg`・`npm run test:handoff-commit-order-pg`）は CI に無く、手元の使い捨ての DB で流す。`DATABASE_URL` は環境変数で渡し、記録にも PR にも書かない。DB には pgvector を入れておく（`CREATE EXTENSION vector`）。起こし方は `project.md` の決まり（Unix socket を切って 127.0.0.1 の TCP だけ・`lc_messages=C`）。流した後に server を止める。`DATABASE_URL` が無いと、どちらの試験も飛ばして 0 で終わる。

## build の命令

```bash
npx tsc --noEmit    # 型検査（strict）。試験の file は tsconfig の対象外
npm run build       # = npm run clean && tsc。dist/ を作り直す
```

試験の file の型は、一時の tsconfig（`extends` は元の `tsconfig.json`、`noEmit` は true、`declaration`・`declarationMap`・`sourceMap` は false、`include` は `src/**/*`、`exclude` は `node_modules` と `dist` だけ。元の設定は `src/test*.ts` を外しているので、外さない形にする）で別に検査できる。CI の命令には無い。2026-11-13 に main `ffe511e5` で流すと 89 件の誤りが出た（14 件がこの取り組みが足した行、75 件が取り組みの前からの行。前回は 78 件で 3 件）。増えた 11 件は、#344 が `RotationBlock` に必須の `commit` を足したため、古い試験の呼び出しが型に合わなくなった物。内訳は `test-results.md` の「試験の file の型検査」。一時の設定の file は repository の外に置く（commit に入れない）。

## build の確かめ

- 2 つの命令がどちらも 0 で終わる。
- `dist/` に hook の入口（`dist/transcript-stop-capture.js`・`dist/claude-session-start.js`・`dist/codex-session-start.js`・`dist/session-rotation-stop.js`・`dist/rotation-watcher.js` ほか）が出来ている。試験のうち、hook の command を別 process で起動する物は、この `dist/` を起動する。
- 足した module は 27（`src/` の 1 file は最大 758 行 = `src/session-rotation-stop.ts`。team.md の「最大 800 行」の内）。前回の記録の 23 に、#344 の `rotation-commit.ts`・`rotation-handoff-source.ts`・`stores/read-only-task-states.ts`・`stores/task-state-normalize.ts` が加わった。
- 触った既存の file のうち 5 つ（`src/codex-session-start.ts` 1122 行・`src/index.ts` 1017 行・`src/kusabi-direct-fleet-rollout.ts` 2038 行・`src/stores/json-store.ts` 907 行・`src/stores/sqlite-store.ts` 1883 行）は 800 行を超える。どれも base `17676d84` の時点で既に超えていた（それぞれ 1056・1013・2036・927・1878 行）。この取り組みで超えた file は無い。`src/codex-session-start.ts` は 66 行増えた。

## よくある失敗

| 症状 | 原因 | 直し方 |
|---|---|---|
| 試験のあとで実際の保存先に行が入る | `HOME` を指定せず `createStore()` を呼んだ | 必ず `HOME=$(mktemp -d)`。入った行は、中身を見てから Owner に知らせる（消さない） |
| `dist/` を起動する試験が「file が無い」で落ちる | build をしていない | 先に `npm run build` |
| post-tool-hook の試験が何もせず 0 で終わる | `DATABASE_URL` が無い（main でも同じ） | 網羅率の時は `AGENT_MEMORY_DB_TYPE=sqlite` |
| `ps` の起動時刻を比べる試験が日本語の環境で落ちる | `ps -o lstart` の表記が環境の言語で変わる | 比べる値を作る時は `LC_ALL=C` を付ける（試験の code は付けてある） |
| PostgreSQL の試験が「duplicate key」の照合で 1 件落ちる | 使い捨ての server の誤りの文が日本語 | server を `lc_messages=C` で起動する |
| 使い捨ての PostgreSQL が起動しない | Unix socket の path が長すぎる | `unix_socket_directories` を空にして 127.0.0.1 の TCP だけにする |
| core の試験が `KUSABI_TEST_TMPDIR_REQUIRED` で 1 秒で止まる | 試験の親 folder を渡していない | 使い捨ての folder を `KUSABI_TEST_TMPDIR` で渡す（CI は `RUNNER_TEMP`） |
| core の試験の 1 件（`isolation rejects shared memory before any store operation`）だけが落ちる | 使い捨ての `HOME` の中に `.agent-memory` が無い | `mkdir -p "$HOME/.agent-memory"` |
| `test:pg` が `type "vector" does not exist` で落ちる | 使い捨ての DB に pgvector を入れていない | その DB で `CREATE EXTENSION vector`（pgvector が入った server で） |
| Node の版で網羅率の数が少し違う | V8 の数え方の差 | 測った Node の版を `test-results.md` に書く |
