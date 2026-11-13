# 作りと試験の結果 — 会話の切り直し（261110-session-rotation）

## 流した条件

- 日付: 2026-11-13（日本時間）。Node v26.13.1・npm 11.20.0（手元の 1 つの版。前回は v26.12.1）。PR の CI は Node 18・20・22（下の「PR の CI」）。
- 対象: 統合された main の `ffe511e5ec655078dba631997397b371d55131ac`（PR #344 の統合の commit。親は `94f1ca6d`（PR #342 の統合の commit）と #344 の head `aa671be5677957e7f13c210f41681dfd50b2cd40`）。作業場ではなく、その commit を取り出した何も変えていない使い捨ての clone（detached、`git status` が 0 行）で、`npm ci` の後に流した。前回（2026-11-12）は main `94f1ca6d`、その前（2026-11-11）は #341 の head を流して記録した。この記録はそれを上書きして main に合わせた（段のやり直しではなく更新）。
- base（網羅率の「変えた行」の起点）は、この取り組みの始まりの main `17676d841257cc4ef194e14923cb0458b99cf62f`。
- すべての命令は、使い捨ての `HOME`・`AGENT_MEMORY_HOME`・`KUSABI_TEST_TMPDIR`（どれも一時の folder。`HOME` の中に `.agent-memory` の folder を作っておく）で流した。本番の保存先と本番の PostgreSQL には触れていない。
- 命令の一覧は `build-instructions.md` と `construction/code-generation/unit-test-instructions.md`。

### 最初の流しの誤り（環境の作り方。code と試験は変えていない）

同じ日の最初の流しで、core の試験が終了コード 1 で終わった。命令の失敗ではなく、私の環境の作り方の足りなさだった。

1. `KUSABI_TEST_TMPDIR` を渡さず、`KUSABI_TEST_TMPDIR_REQUIRED` で止まった（CI は `RUNNER_TEMP` を渡している）。
2. 渡した後の流しで、`isolation rejects shared memory before any store operation` の 1 件が落ちた（1831 passed・1 failed）。使い捨ての `HOME` の中に `.agent-memory` の folder が無いと、macOS の `/var` と `/private/var` の綴りの違いで、試験が確かめる「共有の保存先を試験の root にしない」の判定より先に realpath が失敗するため。`coverage-method.md` の `run()` は最初から `mkdir -p "$H/.agent-memory"` をしていた。

環境を直し（`build-instructions.md` の「環境」と「よくある失敗」に書いた）、18 命令を全部流し直した。下の結果はその流し直しの 1 回分で、最初の流しの結果は使っていない。

## 作り（build）

| 命令 | 結果 |
|---|---|
| `npx tsc --noEmit`（strict） | 0 で終わる |
| `npm run build` | 0 で終わる。`dist/` に hook の入口（`transcript-stop-capture`・`claude-session-start`・`codex-session-start`・`session-rotation-stop`・`rotation-watcher` ほか）が出来る |
| 試験の file の型検査（一時の tsconfig、`src` の試験の file をすべて含める） | **終了コード 2（89 件、15 file）**。下の「試験の file の型検査」 |

### 試験の file の型検査（`tsc` の対象外の file を、一時の設定で別に見た結果）

- 設定の形: 元の `tsconfig.json` を `extends` し、`noEmit: true`・`declaration`／`declarationMap`／`sourceMap` を false、`include` は `src/**/*`、`exclude` は `node_modules` と `dist` だけにした（元の設定は `src/test*.ts` を外している。外さない形にした）。設定の file は使い捨ての場所に置き、repository には入れていない。
- `tsconfig.json` は `src/test*.ts` を対象から外している（今までどおり）。試験は `tsx` で動かすので型は見ない。CI の命令にも無い。
- 89 件の内訳（base `17676d84` からの差分で、誤りの行が「この取り組みが足した行」か「取り組みの前からの行」かを機械で分けた）:
  - **14 件は、この取り組みが足した行**:
    - 前回までの 3 件（行は動いた）: `src/test-claude-session-start.ts` 279 行目（TS2345: `string[]` を `never` の引数に渡している）、`src/test-session-rotation-flow.ts` 1012 行目（TS2352: 型の変換が重ならない。前回は 989 行目）、`src/test-session-rotation-status.ts` 193 行目（TS2322: `string` を `HookInputDiagnosticEvent` に入れている。前回は 166 行目）。
    - **今回増えた 11 件**（TS2345）: `src/test-rotation-hook-registration.ts` の 3 件（222・236・271 行目）と `src/test-session-rotation-flow.ts` の 8 件（759・763・769・772・782・798・806・808 行目）。どれも、`{ text, initial_user_message, marker_id }` を `RotationBlock` の引数に渡している所で、「Property 'commit' is missing」。
  - 残りの 75 件は、取り組みの前からある行（`src/test.ts` 21・`src/test-memory-source.ts` 14・`src/test-kusabi-runtime-event-emitter.ts` 11・`src/test-recovery-scope.ts` 8・`src/test-kusabi-direct-fleet-rollout.ts` 8 ほか）。前回も 75 件で、同じ。
- 増えた 11 件の原因: #344 が `src/session-rotation-start.ts` の `RotationBlock` に必須の `commit`（確定の計画）を足した。その 11 件の試験の行は、#344 が変えた行ではない（base ではなく `94f1ca6d` から数えると、足された行の上の誤りは 0 件）。#344 が型を変えたことで、古い試験の呼び出しが型に合わなくなった。試験の実行（`tsx`）はこの引数に `commit` が無い場合でも通る（下の試験は全部通る）。
- 試験の実行（`tsx`）と CI には影響しない。直すなら試験の型だけの変更（呼び出しに `commit` を足す）だが、統合済みの試験の file に触れるので新しい単位と監査になる。この段では直さず、段の承認の場で arc に伺う。

## 試験

CI の命令 15 個（`.github/workflows/ci.yml` の試験の工程が呼ぶ命令を、同じ順で 1 つずつ）と、CI に無い 3 個（`test:transcript-stop`・`test:antigravity-hook`・sqlite 指定の `src/test-post-tool-hook.ts`）の計 18 個: **18 / 18 が終了コード 0**（失敗 0）。数は、各命令のログの合格の行から機械で取った。

| 命令 | 結果 | 数 |
|---|---|---|
| core の試験（`src/test.ts`、`KUSABI_INTEGRATED_BUILT_EXECUTION=1`） | 通った | 1832 passed、0 failed |
| `test:codex-hook` | 通った | Codex の SessionStart と installer の試験（2 file） |
| `test:claude-hook` | 通った | Claude の SessionStart・installer・hook の入力の形・診断・node の path の試験（5 file）、続けて切り直しの試験（下） |
| `test:gemini-hook` | 通った | Gemini の SessionStart と installer の試験 |
| `test:gemini-conversation-ingest` | 通った | Gemini の取り込みの試験 |
| `test:automatic-receive` | 通った | 自動の受領の試験、Claude の身元の試験 25 cases |
| `test:kusabi-content-addressed-runtime-release` | 通った | 版を作る道具の試験（verdict PASS） |
| `test:kusabi-direct-fleet-rollout` | 通った | 159 assertions |
| `anti-regression-am027` | 通った | 24 passed、0 failed |
| `src/test-sqlite.ts` | 通った | 206 passed、0 failed |
| `src/test-boot-recovery.ts` | 通った | 28 passed、0 failed |
| `src/test-post-tool-hook.ts` | 通った（ただし何も試験せず終わる） | `DATABASE_URL` が無いので「skipping」で 0 終了（main の CI でも同じ）。同じ試験を `AGENT_MEMORY_DB_TYPE=sqlite` で流した物は下の 18 番目 |
| Gate 0 の `no-secret-recovery` | 通った | 57 passed、0 failed |
| Gate 0 の `migration-idempotency` | 通った | 16 passed、0 failed |
| Gate 0 の `search-memory-regression` | 通った | 12 passed、0 failed |
| `test:transcript-stop`（CI に無い） | 通った | transcript の取り込みの試験 |
| `test:antigravity-hook`（CI に無い） | 通った | Antigravity の取り込み・adapter・installer の試験（3 file） |
| `src/test-post-tool-hook.ts`（`AGENT_MEMORY_DB_TYPE=sqlite`。CI に無い） | 通った | 45 passed、0 failed |

切り直しの試験（`npm run test:session-rotation`、`test:claude-hook` の最後。ログの「PASS <file>（N cases）」の行）: core 21 cases・flow 47 cases・**handoff-commit-order 35 cases**・**handoff-source 13 cases**・**handoff-source-cli 14 cases**・hook-registration 13 cases・status 18 cases・見張りの単体 86 cases・見張りの流れ 109 cases・成功の場面（scenario）が通った。太字の 3 file は #344 が足した試験。全部 failed 0。Claude の身元の試験は上のとおり 25 cases。#342 が足した hook の入力の形・診断・node の path の試験 3 file も通った。

- 前回の記録（`94f1ca6d`）との違い: status 17 → 18、見張りの単体 83 → 86、見張りの流れ 103 → 109（`construction/code-generation/unit-test-instructions.md` の件数は、段の見直しで食い違いが見つかっていた。この件数が実物）。
- 飛ばした試験: 無い。ログに `SKIP` の語は無い。試験の出力にある `skip` の文字は、通った試験の名前で、飛ばした印ではない。失敗の印（`❌`）も、18 本のログに 0 件。
- 試験の出力の雑音: core の試験の出力に「PostgreSQL connection failed; refusing SQLite fallback」が 4 回出る。PostgreSQL の接続の失敗でも SQLite に黙って落ちないことを確かめる試験（失敗を隠さない）の出力で、失敗ではない。
- `test-post-tool-hook` は CI でも `DATABASE_URL` が無いので同じく何も試験しない（この取り組みの前から）。この取り組みが触れた `src/post-tool-hook.ts`（2 行）は、sqlite で流した 18 番目の命令の 45 passed で見ている。

## PR の CI

- PR #344（head `aa671be5677957e7f13c210f41681dfd50b2cd40`）: 必須の検査 `build-and-test (18)`・`(20)`・`(22)` が 3 つとも success（run 43343336248、pull_request）。必須ではない `Shirube Rapid/Lite Gates Report` は failure のまま（2 件。失敗の理由の文は私は読んでいない。作者の受領は、項目 RL-PR-002・RL-PR-003 を「保護面のため触っていない」と書いた）。
- 統合の後の main（`ffe511e5`）: run 43346320385（push）が `build-and-test (18)`・`(20)`・`(22)` の 3 つとも success。
- 独立の監査: 設計と実装をまとめた依頼 https://github.com/watchout/agent-memory/pull/344#issuecomment-6840868292 への返却 https://github.com/watchout/agent-memory/pull/344#issuecomment-6841093206（devauditor、本文の SHA-256 `846372c71b12e9cae116c659380919444d3ae6e4eb49053be0a284ab88e6a393`）が PASS（33 項目すべて PASS・FAIL 0・UNKNOWN 0、止める指摘 0）。作者の受領 https://github.com/watchout/agent-memory/pull/344#issuecomment-6841157572（`RECEIPT_ACCEPTED`）の後、suite-lead が 2026-11-13T01:37:39Z に統合した（読み戻し https://github.com/watchout/agent-memory/pull/344#issuecomment-6841257919）。
- 区分: 作者の見立ては R2 で、arc の技術の判断も R2（Owner の決定ではない）で統合された。統合の後に Owner が R3 として追認した（https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6842000444、本文の SHA-256 `abe07f18e33e85fe2310f513ea988ae2587b3d5cf42d80e6fb89fd7d3f2a4591`。私が API で本文を取って再計算し、投稿者 watchout・2026-11-13T02:27:47Z と確かめた）。本文は「を R3 として追認する」と言い、「配備（新しい版の作り直し・席への差し替え・旧い見張りの観測・C2 の取り直し）は、この追認に含まず」と書いている。追認は head `aa671be5` だけに当たり、配備を認可していない。

## PostgreSQL の試験（手元の使い捨ての DB。CI には無い）

team.md の試験の姿勢（PostgreSQL の試験は手元で回し、結果を載せる）に従い、この Mac の使い捨ての PostgreSQL 17.11（Homebrew、pgvector 0.8.2 入り。127.0.0.1 の高い番号の port だけで待ち受け、Unix socket を切り、`lc_messages=C`、使い捨ての folder に作った）に向けて流した。`DATABASE_URL` は環境変数で渡しただけで、記録にも log にも出ていない（ログに接続文字列の形の語と `password` の文字は 0 件）。流した後に server を止め、起動の印の file が無いことと接続できないことを確かめた。本番の DB には触れていない。この取り組みは表の作りを変えない（NFR5）ので、結果は「今までの PostgreSQL の試験が通ったまま」の確認と、#344 が足した PostgreSQL の試験の確認である。

- `npm run test:pg`: **147 passed、0 failed**（終了コード 0）。前回（`94f1ca6d`）と同じ数。
- `npm run test:handoff-commit-order-pg`（#344 が足した。T9(a)〜(f)）: **6 cases が PASS**（終了コード 0、飛ばしなし）。一時の schema と一時の role 2 つを作り、終わりに消す。
- 最初の `test:pg` は `type "vector" does not exist` で終了コード 1 だった。使い捨ての server の中に pgvector を入れた DB が無かったため（環境の用意の誤り。code は変えていない）。`CREATE EXTENSION vector` を入れた新しい DB を作って流し直した結果が上の 147 passed。
- PR #344 の本文には `test-handoff-commit-order-pg` の 6 cases が載っている。`test:pg` の 147 passed は今回の run の結果で、PR #344 の本文には載っていない。

## 行の網羅率（変えた行と新しい行）

測り方は `construction/code-generation/coverage-method.md` の手順どおり（`NODE_V8_COVERAGE` を全試験につけて process をまたいで足し、`merge-zero.mjs` と `changed-uncovered.py` を、その file に書いてあるまま取り出して使った）。流した試験は、切り直し・Claude・Codex・Gemini・Antigravity・自動の受領・transcript・core・post-tool-hook（sqlite）・boot-recovery・展開・版を作る道具の 12 命令（全部終了コード 0）。PostgreSQL の試験は測りに入れていない（`coverage-method.md` の 6 の (d) のとおり）。

- 対象: base `17676d84` から変わった `src/` の 42 file（試験の file を除く。新規 27・変更 15）。変えた行と新しい行は 5,820 行。
- 0 回の範囲は 2 つだけ（合計 5 行）: `src/rotation-watcher.ts` 134〜137 行目と `src/session-rotation-stop.ts` 757 行目。どちらも入口の最後の網 `main().catch(...)` で、試験の中から process の入口を起こさないと通らない。他の 40 file は 0 回の範囲が無い。
- 5,820 行のうち 5,815 行が実行された（99.91%）。V8 の範囲は分岐の腕や無名関数も数えるので、行の網羅率より厳しい数え方である。
- #344 の範囲だけ（起点 `94f1ca6d`）: 変えた行 940 行（`src/` 18 file。新規 4・変更 14）で、0 回の範囲は **0**。作る段の記録（Step 17）と同じ結果。同じ測りを `94f1ca6d` から数え直したので、手で足した数ではない。
- 前回（main `94f1ca6d`）は 4,984 行（34 file）で、0 回の範囲は `src/rotation-watcher.ts` 134〜137 行目と `src/session-rotation-stop.ts` 756 行目の 5 行だった。#344 が `src/session-rotation-stop.ts` を前の部分で 1 行増やしたので、入口の最後の網の場所が 756 行目から 757 行目に動いた。数は同じ。
- 数え方は Node の版で少し違いうる（今回は v26.13.1。作る段の記録は v26.12.1）。

| file | 種別 | 変えた行 | 0 回の範囲 |
|---|---|---:|---:|
| `src/boot.ts` | 変更 | 1 | 0 |
| `src/claude-hook-installer.ts` | 変更 | 67 | 0 |
| `src/claude-session-start.ts` | 変更 | 189 | 0 |
| `src/claude-transcript-identity.ts` | 新規 | 149 | 0 |
| `src/codex-hook-installer.ts` | 変更 | 55 | 0 |
| `src/codex-session-start.ts` | 変更 | 93 | 0 |
| `src/constants.ts` | 変更 | 49 | 0 |
| `src/hook-input-diagnostics.ts` | 新規 | 275 | 0 |
| `src/hook-input.ts` | 新規 | 38 | 0 |
| `src/hook-node-path.ts` | 新規 | 49 | 0 |
| `src/index.ts` | 変更 | 6 | 0 |
| `src/kusabi-direct-fleet-rollout.ts` | 変更 | 2 | 0 |
| `src/mcp-store-readiness.ts` | 新規 | 85 | 0 |
| `src/post-tool-hook.ts` | 変更 | 2 | 0 |
| `src/process-uid.ts` | 新規 | 8 | 0 |
| `src/restart-cli.ts` | 変更 | 43 | 0 |
| `src/rotation-commit.ts` | 新規 | 198 | 0 |
| `src/rotation-handoff-source.ts` | 新規 | 85 | 0 |
| `src/rotation-hook-registration.ts` | 新規 | 130 | 0 |
| `src/rotation-watcher-attempt.ts` | 新規 | 288 | 0 |
| `src/rotation-watcher-config.ts` | 新規 | 197 | 0 |
| `src/rotation-watcher-core.ts` | 新規 | 335 | 0 |
| `src/rotation-watcher-observe.ts` | 新規 | 70 | 0 |
| `src/rotation-watcher-probe.ts` | 新規 | 71 | 0 |
| `src/rotation-watcher-ps.ts` | 新規 | 113 | 0 |
| `src/rotation-watcher-run.ts` | 新規 | 198 | 0 |
| `src/rotation-watcher-screen.ts` | 新規 | 167 | 0 |
| `src/rotation-watcher-store.ts` | 新規 | 303 | 0 |
| `src/rotation-watcher-tmux.ts` | 新規 | 188 | 0 |
| `src/rotation-watcher.ts` | 新規 | 138 | 1（134〜137） |
| `src/session-rotation-files.ts` | 新規 | 333 | 0 |
| `src/session-rotation-start.ts` | 新規 | 298 | 0 |
| `src/session-rotation-status.ts` | 新規 | 221 | 0 |
| `src/session-rotation-stop.ts` | 新規 | 758 | 1（757） |
| `src/session-rotation-usage.ts` | 新規 | 111 | 0 |
| `src/session-start-auto-receive.ts` | 変更 | 73 | 0 |
| `src/stores/index.ts` | 変更 | 47 | 0 |
| `src/stores/json-store.ts` | 変更 | 12 | 0 |
| `src/stores/read-only-task-states.ts` | 新規 | 165 | 0 |
| `src/stores/sqlite-store.ts` | 変更 | 6 | 0 |
| `src/stores/task-state-normalize.ts` | 新規 | 42 | 0 |
| `src/transcript-stop-capture.ts` | 変更 | 162 | 0 |
| 合計 | | 5,820 | 2 範囲（5 行） |

## 依存の確かめ

この取り組みは依存も lock も足していない（`package.json` の変更は `scripts` の試験の命令だけ。base から main への差分で、`"test:` を含む行を除くと `package.json` の差は 0 行）。`npm audit --omit=dev`（main `ffe511e5` の clone、2026-11-13）は **0 件の脆弱性**（終了コード 0）。

## NFR2 の一回きりの測り（試験には入れていない）

NFR2（量の測りは末尾 4 MiB だけを読む）に専用の新しい試験は無い。測りは、今ある共有の読み手 `readBoundedTranscriptTailSnapshot` を、`TRANSCRIPT_CAPTURE_TAIL_BYTES`（`src/transcript-stop-capture.ts` の 4 MiB、`src/session-rotation-stop.ts` が使う）で呼んでいる。この読み手の尾の読み方は、今ある `src/test-session-start-auto-receive.ts` の尾の読みの試験（64 KiB の尾、それより大きい transcript）が通っている。実際の定数で確かめるため、2026-11-11 に使い捨ての folder に 6 MiB の transcript を作り、同じ読み手と同じ定数で読んだ（使い捨てで、保存先には触れていない）:

`{"file_bytes":6292440,"tail_limit":4194304,"raw_chars":4193640,"raw_within_limit":true}`

この測りは今回の流し直しでは取り直していない。理由: 読み手（`src/session-start-auto-receive.ts`）と定数（`src/transcript-stop-capture.ts`）は、`94f1ca6d` から `ffe511e5` の差分で変わっていない（`git diff --stat` が空）。`src/session-rotation-stop.ts` の中の呼び出し 2 か所（claude_code と codex）も、前後で同じ引数のまま行が 1 つ動いただけ。

## 失敗の詳細

命令の失敗は無い（最初の流しの環境の誤りは、上の「最初の流しの誤り」のとおり直して流し直した）。見つかったこと（段の失敗の決まり「命令の失敗、または『達していない』『まだ確かめられない』目標」には当たらない。限界に書いて段の承認の場で知らせる）:

- 試験の file の型検査で、この取り組みが足した行に 14 件の型の誤り（上の「試験の file の型検査」。前回の 3 件から、#344 の型の変更で 11 件増えた）。
- 要件の追跡で行き先の無い ID が 2 つ（FR9.2・FR9.3）。`cross-unit-traceability.md` に書く。

## 目標の確かめ

`build-and-test-summary.md` の `## Target Verification Matrix` を参照（同じ表。ここに重ねて持たない）。
