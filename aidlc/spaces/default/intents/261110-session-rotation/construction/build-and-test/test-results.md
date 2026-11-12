# 作りと試験の結果 — 会話の切り直し（261110-session-rotation）

## 流した条件

- 日付: 2026-11-12（日本時間）。Node v26.12.1・npm 11.20.0（手元の 1 つの版）。PR の CI は Node 18・20・22（下の「PR の CI」）。
- 対象: 統合された main の `94f1ca6d0042bd970d4cc7c4ab9ce9153b7d5c0d`（PR #342 の統合の commit。#342 の head は `23ddb0cf18f49b94444bf6900fca0155d93887a2`、PR #341 の統合の commit は `aa77b683e135beabb9fc54bd3736b47d288d6f46`）。作業場ではなく、その commit を取り出した何も変えていない使い捨ての clone（detached、`git status` が 0 行）で、`npm ci` の後に流した。前回（2026-11-11）は #341 の head `a8f74ed` を流して記録した。この記録はそれを上書きして main に合わせた。
- base（網羅率の「変えた行」の起点）は、この取り組みの始まりの main `17676d841257cc4ef194e14923cb0458b99cf62f`。
- すべての命令は、使い捨ての `HOME`（と `AGENT_MEMORY_HOME`）で流した。本番の保存先と PostgreSQL には触れていない。
- 命令の一覧は `build-instructions.md` と `construction/code-generation/unit-test-instructions.md`。

## 作り（build）

| 命令 | 結果 |
|---|---|
| `npx tsc --noEmit`（strict） | 0 で終わる |
| `npm run build` | 0 で終わる。`dist/` に hook の入口が出来る |
| 試験の file の型検査（一時の tsconfig、`src` の試験の file をすべて含める） | **終了コード 2（78 件）**。下の「試験の file の型検査」 |

### 試験の file の型検査（`tsc` の対象外の file を、一時の設定で別に見た結果）

- `tsconfig.json` は `src/test*.ts` を対象から外している（今までどおり）。試験は `tsx` で動かすので型は見ない。CI の命令にも無い。
- 一時の設定で `src` の試験の file をすべて含めると 14 file に 78 件の型の誤りが出る。このうち **3 件は、この取り組みが足した行**:
  - `src/test-claude-session-start.ts` 279 行目（TS2345: `string[]` を `never` の引数に渡している）
  - `src/test-session-rotation-flow.ts` 989 行目（TS2352: 型の変換が重ならない）
  - `src/test-session-rotation-status.ts` 166 行目（TS2322: `string` を `HookInputDiagnosticEvent` に入れている）
- 残りの 75 件は、取り組みの前からある行（`src/test.ts`・`src/test-memory-source.ts`・`src/test-recovery-scope.ts` ほか、この取り組みが足した行ではない）。
- 3 件を足したのは commit `ea19ca1`（計画 Step 16.8 の「試験だけ」の commit、PR #342）で、前回の流し直しの head `a8f74ed` には入っていない。前回の記録は「0 で終わる」と書いたが、それは #342 より前の話である。
- 試験の実行（`tsx`）と CI には影響しない（試験はすべて通る）。直すなら型だけの変更で、統合済みの code に触れるので新しい単位と監査になる。この段では直さず、段の承認の場で arc に伺う。

## 試験

CI の命令 15 個（`.github/workflows/ci.yml` の試験の工程が呼ぶ命令を、同じ順で 1 つずつ）と、CI に無い 2 個（`test:transcript-stop`・`test:antigravity-hook`）の計 17 個: **17 / 17 が終了コード 0**（失敗 0）。

| 命令 | 結果 | 数 |
|---|---|---|
| core の試験（`src/test.ts`、`KUSABI_INTEGRATED_BUILT_EXECUTION=1`） | 通った | 1832 passed、0 failed |
| `test:codex-hook` | 通った | Codex の SessionStart と installer の試験 |
| `test:claude-hook` | 通った | Claude の SessionStart・installer・hook の入力の形・診断・node の path の試験、続けて切り直しの試験 7 file（下） |
| `test:gemini-hook` | 通った | Gemini の SessionStart と installer の試験 |
| `test:gemini-conversation-ingest` | 通った | Gemini の取り込みの試験 |
| `test:automatic-receive` | 通った | 自動の受領の試験、Claude の身元の試験 25 cases |
| `test:kusabi-content-addressed-runtime-release` | 通った | 版を作る道具の試験（verdict PASS） |
| `test:kusabi-direct-fleet-rollout` | 通った | 159 assertions |
| `anti-regression-am027` | 通った | 24 passed、0 failed |
| `src/test-sqlite.ts` | 通った | 206 passed、0 failed |
| `src/test-boot-recovery.ts` | 通った | 28 passed、0 failed |
| `src/test-post-tool-hook.ts` | 通った（ただし何も試験せず終わる） | `DATABASE_URL` が無いので「skipping」で 0 終了（main の CI でも同じ）。同じ試験を `AGENT_MEMORY_DB_TYPE=sqlite` で流した網羅率の run では 45 passed、0 failed |
| Gate 0 の `no-secret-recovery` | 通った | 57 passed、0 failed |
| Gate 0 の `migration-idempotency` | 通った | 16 passed、0 failed |
| Gate 0 の `search-memory-regression` | 通った | 12 passed、0 failed |
| `test:transcript-stop`（CI に無い） | 通った | transcript の取り込みの試験 |
| `test:antigravity-hook`（CI に無い） | 通った | Antigravity の取り込み・adapter・installer の試験 |

切り直しの試験 7 file（`npm run test:session-rotation`、`test:claude-hook` の最後）: core 21 cases・flow 47 cases・hook-registration 13 cases・status 17 cases・見張りの単体 83 cases・見張りの流れ 103 cases・成功の場面（scenario）が通った。全部 failed 0。Claude の身元の試験は上のとおり 25 cases。#342 が足した hook の入力の形・診断・node の path の試験 3 file も通った。

- 飛ばした試験: 無い。試験の出力にある `skip` の文字は、通った試験の名前（例: 「Claude marker controller skips non-restart markers」「ingest skips malformed line」）で、飛ばした印ではない。
- 試験の出力の雑音: core の試験の出力に「PostgreSQL connection failed; refusing SQLite fallback」が 4 回出る。PostgreSQL の接続の失敗でも SQLite に黙って落ちないことを確かめる試験（失敗を隠さない）の出力で、失敗ではない。
- `test-post-tool-hook` は CI でも `DATABASE_URL` が無いので同じく何も試験しない（この取り組みの前から）。この取り組みが触れた `src/post-tool-hook.ts`（2 行）は、sqlite で流した網羅率の run の 45 passed で見ている。

## PR の CI

- PR #342（head `23ddb0cf18f49b94444bf6900fca0155d93887a2`）: 必須の検査 `build-and-test (18)`・`(20)`・`(22)` が 3 つとも success（run 43109607794）。必須ではない `Shirube Rapid/Lite Gates Report` は failure のまま（この PR の失敗の理由の文は読んでいない。PR #340 では Owner が統合の条件に数えないと決めた物と同じ検査で、決定は「ほかの PR への当てはめ」を含まない）。
- 統合の後の main（`94f1ca6d`）: run 43113722371 が `build-and-test (18)`・`(20)`・`(22)` の 3 つとも success。
- 独立の監査: 実装監査 2 回目が PASS（返却 comment 6808507295、23 / 23）、作者の受領（comment 6808706214）、Owner の exact-head（comment 6808786916）の後に統合された（2026-11-11T22:40:24Z）。

## PostgreSQL の試験（手元の使い捨ての DB。CI には無い）

team.md の試験の姿勢（PostgreSQL の試験は手元で回し、結果を載せる）に従い、`npm run test:pg` を、この Mac の使い捨ての PostgreSQL 17.11（Homebrew、pgvector 0.8.2 入り。127.0.0.1 の高い番号の port だけで待ち受け、Unix socket を切り、`lc_messages=C`、使い捨ての folder に作り、流した後に止めて消した）に向けて流した。本番の DB には触れていない。この取り組みは表の作りを変えない（NFR5）ので、結果は「今までの PostgreSQL の試験が通ったまま」の確認である。

- 結果: **147 passed、0 failed**（終了コード 0）。1 回目から通った（前回の記録の「日本語の誤り文で 1 件落ちた」は、今回は最初から `lc_messages=C` で起動して避けた）。
- 前回（#341 の head）と同じ 147 passed。#342 は DB の作りに触れない。

## 行の網羅率（変えた行と新しい行）

測り方は `construction/code-generation/coverage-method.md` の手順どおり（`NODE_V8_COVERAGE` を全試験につけて process をまたいで足し、`merge-zero.mjs` と `changed-uncovered.py` を、その file に書いてあるまま使った）。流した試験は、切り直し・Claude・Codex・Gemini・Antigravity・自動の受領・transcript・core・post-tool-hook（sqlite）・boot-recovery・展開・版を作る道具の 12 命令。

- 対象: base `17676d84` から変わった `src/` の 34 file（試験の file を除く。新規 23・変更 11）。変えた行と新しい行は 4,984 行。
- 0 回の範囲は 2 つだけ（合計 5 行）: `src/rotation-watcher.ts` 134〜137 行目と `src/session-rotation-stop.ts` 756 行目。どちらも入口の最後の網 `main().catch(...)` で、試験の中から process の入口を起こさないと通らない。他の 32 file は 0 回の範囲が無い。
- 4,984 行のうち 4,979 行が実行された（99.90%）。V8 の範囲は分岐の腕や無名関数も数えるので、行の網羅率より厳しい数え方である。
- 参考（作る段の Step 16 の範囲）: Step 16 の起点 `1eef773be073b4f6526fe5b70f856cf02a0a7256` からの変えた行 938 行（`src/` 12 file）では、0 回の範囲は `src/session-rotation-stop.ts` 756 行目の 1 行だけ。作る段の記録と同じ結果。
- 前回（#341 の head）の 0 回の範囲は `src/session-rotation-stop.ts` 640〜642 行目（`main().catch(...).finally(...)` の連なり）だった。#342 の commit `b0d1882`（計画 Step 16.9）で入口が 1 行の `main().catch(...)`（答えを書き終えてから終了する形）に変わり、場所が 756 行目に移って、数が 3 行から 1 行になった。同じ種類の「入口の最後の網」である。

| file | 種別 | 変えた行 | 0 回の範囲 |
|---|---|---:|---:|
| `src/boot.ts` | 変更 | 1 | 0 |
| `src/claude-hook-installer.ts` | 変更 | 67 | 0 |
| `src/claude-session-start.ts` | 変更 | 196 | 0 |
| `src/claude-transcript-identity.ts` | 新規 | 149 | 0 |
| `src/codex-hook-installer.ts` | 変更 | 55 | 0 |
| `src/codex-session-start.ts` | 変更 | 46 | 0 |
| `src/constants.ts` | 変更 | 29 | 0 |
| `src/hook-input-diagnostics.ts` | 新規 | 275 | 0 |
| `src/hook-input.ts` | 新規 | 38 | 0 |
| `src/hook-node-path.ts` | 新規 | 49 | 0 |
| `src/index.ts` | 変更 | 6 | 0 |
| `src/kusabi-direct-fleet-rollout.ts` | 変更 | 2 | 0 |
| `src/mcp-store-readiness.ts` | 新規 | 85 | 0 |
| `src/post-tool-hook.ts` | 変更 | 2 | 0 |
| `src/process-uid.ts` | 新規 | 8 | 0 |
| `src/rotation-hook-registration.ts` | 新規 | 130 | 0 |
| `src/rotation-watcher-attempt.ts` | 新規 | 284 | 0 |
| `src/rotation-watcher-config.ts` | 新規 | 197 | 0 |
| `src/rotation-watcher-core.ts` | 新規 | 307 | 0 |
| `src/rotation-watcher-observe.ts` | 新規 | 70 | 0 |
| `src/rotation-watcher-probe.ts` | 新規 | 71 | 0 |
| `src/rotation-watcher-ps.ts` | 新規 | 113 | 0 |
| `src/rotation-watcher-run.ts` | 新規 | 198 | 0 |
| `src/rotation-watcher-screen.ts` | 新規 | 167 | 0 |
| `src/rotation-watcher-store.ts` | 新規 | 282 | 0 |
| `src/rotation-watcher-tmux.ts` | 新規 | 188 | 0 |
| `src/rotation-watcher.ts` | 新規 | 138 | 1（134〜137） |
| `src/session-rotation-files.ts` | 新規 | 252 | 0 |
| `src/session-rotation-start.ts` | 新規 | 265 | 0 |
| `src/session-rotation-status.ts` | 新規 | 211 | 0 |
| `src/session-rotation-stop.ts` | 新規 | 757 | 1（756） |
| `src/session-rotation-usage.ts` | 新規 | 111 | 0 |
| `src/session-start-auto-receive.ts` | 変更 | 73 | 0 |
| `src/transcript-stop-capture.ts` | 変更 | 162 | 0 |
| 合計 | | 4,984 | 2 範囲（5 行） |

## 依存の確かめ

この取り組みは依存も lock も足していない（`package.json` の変更は `scripts` の試験の命令だけ）。版を作った時（2026-11-12、S1 のやり直し）の `npm audit --omit=dev` は 0 件だった。

## NFR2 の一回きりの測り（試験には入れていない）

NFR2（量の測りは末尾 4 MiB だけを読む）に専用の新しい試験は無い。測りは、今ある共有の読み手 `readBoundedTranscriptTailSnapshot` を、`TRANSCRIPT_CAPTURE_TAIL_BYTES`（`src/transcript-stop-capture.ts` の 4 MiB、`src/session-rotation-stop.ts` が使う）で呼んでいる。この読み手の尾の読み方は、今ある `src/test-session-start-auto-receive.ts` の尾の読みの試験（64 KiB の尾、それより大きい transcript）が通っている。実際の定数で確かめるため、2026-11-11 に使い捨ての folder に 6 MiB の transcript を作り、同じ読み手と同じ定数で読んだ（使い捨てで、保存先には触れていない）:

`{"file_bytes":6292440,"tail_limit":4194304,"raw_chars":4193640,"raw_within_limit":true}`

この測りは今回の流し直しでは取り直していない（読み手と定数は #342 で動いていない）。

## 失敗の詳細

命令の失敗は無い。見つかったこと（段の失敗の決まり「命令の失敗、または『達していない』『まだ確かめられない』目標」には当たらない。限界に書いて段の承認の場で知らせる）:

- 試験の file の型検査で、この取り組みが足した行に 3 件の型の誤り（上の「試験の file の型検査」）。
- 要件の追跡で行き先の無い ID が 2 つ（FR9.2・FR9.3）。`cross-unit-traceability.md` に書く。

## 目標の確かめ

`build-and-test-summary.md` の `## Target Verification Matrix` を参照（同じ表。ここに重ねて持たない）。
