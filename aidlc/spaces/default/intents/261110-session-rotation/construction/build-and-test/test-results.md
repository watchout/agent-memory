# 作りと試験の結果 — 会話の切り直し（261110-session-rotation）

## 流した条件

- 日付: 2026-11-11。Node v26.12.1（手元の 1 つの版）。PR の CI は Node 18・20・22（下の「PR の CI」）。
- 対象: base は main `17676d841257cc4ef194e14923cb0458b99cf62f`。流したのは作業場の file で、独立の監査が PASS した head `a8f74ed9433a4f79f52b22d74fc8053b9e32235a` と、`src/`・`package.json`・`docs/audit/`・SSOT-6・取り組みの記録（`inception/` と `construction/code-generation/`）の 156 file が内容まで一致する（git の blob の hash で突き合わせた）。違うのは 1 file だけ: `construction/code-generation/code-generation-questions.md`（計画の段の文言を直した版で、PR の head にはまだ入っていない。この段の記録と一緒に別に入れる）。
- すべての命令は、使い捨ての `HOME` で流した。本番の保存先と PostgreSQL には触れていない。
- 命令の一覧は `build-instructions.md` と `unit-test-instructions.md`。次の「CI と同じ一覧」は `.github/workflows/ci.yml` の工程を、18 の命令に分けて同じ順で流した物（手元の 1 つの Node の版）。

## 作り（build）

| 命令 | 結果 |
|---|---|
| `npx tsc --noEmit`（strict） | 0 で終わる |
| `npm run build` | 0 で終わる。`dist/` に hook の入口が出来る |
| 試験の file の型検査（一時の tsconfig） | 0 で終わる |

## 試験

CI と同じ一覧（18 工程）: **18 / 18 が通った**（失敗 0）。

| 工程 | 結果 | 数 |
|---|---|---|
| core の試験（`src/test.ts`） | 通った | 1832 passed、0 failed |
| `test:codex-hook` | 通った | Codex の SessionStart と installer の試験 |
| `test:claude-hook` | 通った | Claude の SessionStart と installer、続けて切り直しの試験 7 file（下） |
| `test:gemini-hook` | 通った | Gemini の SessionStart と installer の試験 |
| `test:gemini-conversation-ingest` | 通った | Gemini の取り込みの試験 |
| `test:automatic-receive` | 通った | 自動の受領の試験、Claude の身元の試験 25 cases |
| `test:transcript-stop` | 通った | transcript の取り込みの試験 |
| `test:kusabi-content-addressed-runtime-release`・`test:kusabi-direct-fleet-rollout` | 通った | 中身の決まった版と展開の試験（2 工程） |
| `anti-regression-am027` | 通った | 仕様の守りの試験 |
| `src/test-sqlite.ts` | 通った | SQLite の Store の試験 |
| `src/test-boot-recovery.ts` | 通った | 28 passed、0 failed |
| `src/test-post-tool-hook.ts` | 通った | 45 passed、0 failed（網羅率の run、`AGENT_MEMORY_DB_TYPE=sqlite`） |
| Gate 0 の 3 file（no-secret-recovery・migration-idempotency・search-memory-regression） | 通った | 3 工程 |

切り直しの試験 7 file（`npm run test:session-rotation`）: core 21 cases・flow 40 cases・hook-registration 12 cases・status 8 cases・見張りの単体 83 cases・見張りの流れ 103 cases・成功の場面（scenario）が通った。全部 failed 0。Claude の身元の試験は上のとおり 25 cases。

- 飛ばした試験: 無い。試験の出力にある `skip` の文字は、通った試験の名前（例: 「Claude marker controller skips non-restart markers」「ingest skips malformed line」）で、飛ばした印ではない。
- 試験の出力の雑音: core の試験の出力に「PostgreSQL connection failed; refusing SQLite fallback」が出る。PostgreSQL の接続の失敗でも SQLite に黙って落ちないことを確かめる試験（失敗を隠さない）の出力で、失敗ではない。

## PR の CI

PR #341 の head `a8f74ed` で、必須の検査 `build-and-test (18)`・`(20)`・`(22)` が 3 つとも success（run 42977510939）。必須ではない `Shirube Rapid/Lite Gates Report` は failure のまま（項目 RL-PR-002。この PR の失敗の理由の文は読んでいない）。同じ検査の失敗を、PR #340 では Owner が統合の条件に数えないと決めた（#339 の OD-KUSABI-PR340-LEGACY-RAPID-LITE-GATE-NOT-MERGE-CONDITION-20261109-001。決定は「ほかの PR への当てはめ」を含まない）。この PR で数えるかは、統合の席の判断である。

## PostgreSQL の試験（手元の使い捨ての DB。CI には無い）

team.md の試験の姿勢（PostgreSQL の試験は手元で回し、結果を PR に載せる）に従い、`npm run test:pg` を、この Mac の使い捨ての PostgreSQL 17.11（pgvector 入り、127.0.0.1 の高い番号の port だけで待ち受け、`/tmp` 系の使い捨ての folder に作り、流した後に止めた）に向けて流した。本番の DB には触れていない。この取り組みは表の作りを変えない（NFR5）ので、結果は「今までの PostgreSQL の試験が通ったまま」の確認である。

- 結果: **147 passed、0 failed**（終了コード 0）。
- 1 回目は終了コード 1 で、試験の中の「duplicate key」の文字の照合が落ちた。原因は私の使い捨ての server が誤りの文を日本語で返したこと（環境）で、code ではない。server を英語の文（`lc_messages=C`）で起動し直して流し直したら通った。試験の code は変えていない。

## 行の網羅率（変えた行と新しい行）

測り方は `construction/code-generation/coverage-method.md` の手順どおり（`NODE_V8_COVERAGE` を全試験につけて process をまたいで足す）。今回は新しい置き場で流し直し、前回と同じ結果になった。

- 対象: base から変わった `src/` の 30 file（試験の file を除く）。変えた行と新しい行は 4,071 行。
- 0 回の範囲は 2 つだけ（合計 7 行）: `src/rotation-watcher.ts` 134〜137 行目と `src/session-rotation-stop.ts` 640〜642 行目。どちらも入口の最後の網 `main().catch(...)` で、試験の中から process の入口を起こさないと通らない。他の 28 file は 0 回の範囲が無い。
- 4,071 行のうち 4,064 行が実行された（99.83%）。V8 の範囲は分岐の腕や無名関数も数えるので、行の網羅率より厳しい数え方である。

| file | 種別 | 変えた行 | 0 回の範囲 |
|---|---|---:|---:|
| `src/boot.ts` | 変更 | 1 | 0 |
| `src/claude-hook-installer.ts` | 変更 | 37 | 0 |
| `src/claude-session-start.ts` | 変更 | 34 | 0 |
| `src/claude-transcript-identity.ts` | 新規 | 149 | 0 |
| `src/codex-hook-installer.ts` | 変更 | 37 | 0 |
| `src/codex-session-start.ts` | 変更 | 46 | 0 |
| `src/constants.ts` | 変更 | 29 | 0 |
| `src/index.ts` | 変更 | 6 | 0 |
| `src/mcp-store-readiness.ts` | 新規 | 85 | 0 |
| `src/post-tool-hook.ts` | 変更 | 2 | 0 |
| `src/process-uid.ts` | 新規 | 8 | 0 |
| `src/rotation-hook-registration.ts` | 新規 | 128 | 0 |
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
| `src/session-rotation-files.ts` | 新規 | 244 | 0 |
| `src/session-rotation-start.ts` | 新規 | 265 | 0 |
| `src/session-rotation-status.ts` | 新規 | 125 | 0 |
| `src/session-rotation-stop.ts` | 新規 | 647 | 1（640〜642） |
| `src/session-rotation-usage.ts` | 新規 | 111 | 0 |
| `src/session-start-auto-receive.ts` | 変更 | 73 | 0 |
| `src/transcript-stop-capture.ts` | 変更 | 29 | 0 |
| 合計 | | 4,071 | 2 範囲（7 行） |

## NFR2 の一回きりの測り（試験には入れていない）

NFR2（量の測りは末尾 4 MiB だけを読む）に専用の新しい試験は無い。測りは、今ある共有の読み手 `readBoundedTranscriptTailSnapshot` を、`TRANSCRIPT_CAPTURE_TAIL_BYTES`（`src/transcript-stop-capture.ts` の 4 MiB、`src/session-rotation-stop.ts` の 206・213 行目が使う）で呼んでいる。この読み手の尾の読み方は、今ある `src/test-session-start-auto-receive.ts` の尾の読みの試験（64 KiB の尾、それより大きい transcript）が通っている。実際の定数で確かめるため、使い捨ての folder に 6 MiB の transcript を作り、同じ読み手と同じ定数で読んだ（使い捨てで、保存先には触れていない）:

`{"file_bytes":6292440,"tail_limit":4194304,"raw_chars":4193640,"raw_within_limit":true}`

## 失敗の詳細

無い。段の失敗の決まり（命令の失敗、または「達していない」「まだ確かめられない」目標）に当たるのは、次の「目標の確かめ」の表に書いたとおり、この段の目標としては無い。要件の追跡で行き先の無い ID が 2 つ（FR9.2・FR9.3）あり、`cross-unit-traceability.md` に書いて、段の承認の場で知らせる。

## 目標の確かめ

`build-and-test-summary.md` の `## Target Verification Matrix` を参照（同じ表。ここに重ねて持たない）。
