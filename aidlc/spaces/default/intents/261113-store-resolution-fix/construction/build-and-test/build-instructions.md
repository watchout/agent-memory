# Build の手順 — 保存先の決め方を 1 つの関数にする（取り組み 261113-store-resolution-fix）

この文書は、統合された版（`origin/main` の `fa9f3a2f16255d723b0cb96f0e77958035f7b11e`。PR #347 の merge commit）を、清潔な状態から build する手順と、その確かめを書く。変更の元は `code-generation-plan.md`、作った物は `code-summary.md`、試験の命令は `unit-test-instructions.md` にある。数と終了コードは、この段（2026-11-17）で流した命令の出力から写した値で、手で数えていない。

## 1. 対象と前提

- 対象: `fa9f3a2f16255d723b0cb96f0e77958035f7b11e`。作業場（`~/Developer/aidlc-owner/agent-memory`）は、止めてある別の取り組みの変更が残っていて、統合された版と一致しない。そこで、この段は作業場を使わず、手元の repository から清潔な clone を作って流した。
- Node は `package.json` の `engines` が `>=20.0.0`。CI（`.github/workflows/ci.yml`）は Node 18・20・22 の 3 つで流す。この段の手元の実行は Node v26.13.1・npm 11.20.0 の 1 つだけで、Node 18・20・22 の結果は PR #347 の CI の log を読んで確かめた（`test-results.md`）。`engines` が 20 以上なのに CI の matrix に 18 がある食い違いは、この取り組みの前からあり、触らない。
- 新しい外部の依存は無い。`package.json` の差分は scripts の足し・書き換えだけ（`code-summary.md`）。

## 2. 依存を入れる

```bash
S=<使い捨ての場所>
git clone --local --no-checkout <手元の repository> "$S/bt-clone"
git -C "$S/bt-clone" checkout --detach fa9f3a2f16255d723b0cb96f0e77958035f7b11e
git -C "$S/bt-clone" status --porcelain | wc -l    # 0 であること
cd "$S/bt-clone" && npm ci
```

- 結果: `added 122 packages, and audited 123 packages in 887ms`、終了コード 0（`npm ci` の出力 `bt-npm-ci.log` から写した）。
- npm 11 は、install script を持つ 2 つの package（`esbuild@0.27.4` の postinstall、`fsevents@2.3.3` の install）を、許可が無いので走らせないという警告を出す。tsx・tsc・試験は、その警告のまま動いた（下の 4・5）。許可（`npm install-scripts approve`）は足していない（依存と設定の変更になるため）。
- `npm ci` の最後に `1 low severity vulnerability` と出る。この取り組みは依存を変えていないので既存の物で、扱いは `security-test-instructions.md` に書く。

## 3. 環境と設定

試験を流す命令は、どれも使い捨ての環境で流す（この Mac の実際の保存先・席の設定に触れない）。

| 項目 | 値 |
|---|---|
| `HOME` | 使い捨て。中に `.agent-memory` の folder を先に作る（無いと macOS で `/var` と `/private/var` の綴りの違いから isolation の 1 件が落ちる） |
| `KUSABI_TEST_TMPDIR`・`RUNNER_TEMP`・`TMPDIR` | 使い捨て（`KUSABI_TEST_TMPDIR` が無いと `KUSABI_TEST_TMPDIR_REQUIRED` で止まる） |
| `AGENT_MEMORY_HOME` | 使い捨ての `HOME` の中の `.agent-memory` |
| 外す物 | `AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`DATABASE_URL`・`AGENT_MEMORY_DB_PATH`（席の起動の環境を引き継がない。環境は `env -i` の形で組み直した） |
| PostgreSQL | 使い捨ての server（127.0.0.1 の TCP だけ。unix socket は切る。`lc_messages=C`）。`CREATE EXTENSION vector` を入れた DB に向ける |

## 4. build の命令と結果

| 命令 | 内容 | 結果 |
|---|---|---|
| `npx tsc --noEmit` | 型検査（`tsconfig.json`: `strict: true`・`target ES2022`・`module ESNext`・`moduleResolution bundler`・`skipLibCheck: true`・`include: src/**/*`・`exclude: node_modules・dist・src/test*.ts`）。CI の「Type check」と同じ | 終了コード 0、出力 0 行 |
| `npm run build` | `npm run clean && tsc`。CI の「Build」と同じ | 終了コード 0。`dist/` の直下に 337 件（`ls dist \| wc -l`。再帰では file 384 件）。出力 8 行 |

`tsconfig.json` は `src/test*.ts` を除くので、上の型検査は試験の file を含まない。試験の file の型検査は別に流し、設定と対象を `test-results.md` に書く。

## 5. build の確かめ

1. `git -C <clone> rev-parse HEAD` が `fa9f3a2f16255d723b0cb96f0e77958035f7b11e`、`git status --porcelain` が 0 行。
2. `npx tsc --noEmit` の終了コードが 0 で、出力が 0 行。
3. `npm run build` の終了コードが 0 で、`dist/` ができる（`ls dist | wc -l` が 0 でない）。
4. `npx tsx --version` が動く（install script を許可していなくても tsx が動くことの確かめ）。結果は `tsx v4.21.0`。

## 6. よくある失敗

- `KUSABI_TEST_TMPDIR_REQUIRED`: 試験の親 folder の環境変数が無い。code の失敗ではなく環境の誤り。
- isolation の試験が 1 件落ちる: 使い捨ての `HOME` の中に `.agent-memory` の folder が無い。
- `type "vector" does not exist`（PostgreSQL の試験の終了コード 1）: `CREATE EXTENSION vector` を入れていない DB に向けた。環境の誤り。
- PostgreSQL が起動しない: socket の path が長い。unix socket を切り（`unix_socket_directories` を空に）、127.0.0.1 の TCP だけにする。
- 型検査が通るのに試験の file の型の誤りが残る: プロジェクトの `tsc` は試験の file を含まない。別の設定で流す。
