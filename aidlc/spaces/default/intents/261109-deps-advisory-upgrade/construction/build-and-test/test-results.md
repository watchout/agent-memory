# 試験の結果 — 本番の依存の版上げ（Issue #339）

- 入力: 試験の手順 `construction/code-generation/unit-test-instructions.md`（作る段）、この段の `build-instructions.md`・`integration-test-instructions.md`・`performance-test-instructions.md`・`security-test-instructions.md`
- head: `baef7ecf653ed9e9aa571d203c133910f9f35302`。この Mac の Node v26.12.1・npm 11.20.0。2026-11-09 に動かした。
- 同じ命令は 1 回だけ動かした（作る段の試験の手順は 1 つだけ）。

## 作りの結果

| 命令 | 終わり方 |
|------|----------|
| `npm ci` | 0 |
| `npx tsc --noEmit` | 0 |
| `npm run build` | 0 |
| `git status --porcelain package.json package-lock.json`（npm ci の後） | 0 行（lock は書き換えられていない） |

## 試験の結果

| # | 命令 | 終わり方 | 数 |
|---|------|----------|----|
| T4 | `KUSABI_TEST_TMPDIR=$(mktemp -d) KUSABI_INTEGRATED_BUILT_EXECUTION=1 npx tsx src/test.ts` | 0 | 1832 passed, 0 failed |
| T5 | `npm run test:codex-hook` | 0 | passed |
| T5 | `npm run test:claude-hook` | 0 | passed |
| T5 | `npm run test:gemini-hook` | 0 | passed |
| T5 | `npm run test:gemini-conversation-ingest` | 0 | passed |
| T5 | `npm run test:automatic-receive` | 0 | passed |
| T6 | `npm run test:kusabi-content-addressed-runtime-release` | 0 | verdict PASS |
| T6 | `npm run test:kusabi-direct-fleet-rollout` | 0 | 157 assertions |
| T7 | `npx tsx tests/spec-enforcement/anti-regression-am027.ts` | 0 | 24 passed, 0 failed |
| T8 | `HOME=$(mktemp -d) npx tsx src/test-sqlite.ts` | 0 | 206 passed, 0 failed |
| T9 | `HOME=$(mktemp -d) npx tsx src/test-boot-recovery.ts` | 0 | 28 passed, 0 failed |
| T10 | `HOME=$(mktemp -d) npx tsx src/test-post-tool-hook.ts` | 0 | 試験の本体は動かない（`DATABASE_URL` が無いと先に 0 で終わる。main でも同じ） |
| T11 | `HOME=$(mktemp -d) npx tsx tests/gate0/no-secret-recovery.ts` | 0 | 57 passed, 0 failed |
| T11 | `HOME=$(mktemp -d) npx tsx tests/gate0/migration-idempotency.ts` | 0 | 16 passed, 0 failed |
| T11 | `HOME=$(mktemp -d) npx tsx tests/gate0/search-memory-regression.ts` | 0 | 12 passed, 0 failed |

- 合わせて: 命令 15（作り 3 と試験 12）がすべて 0。数の出る試験は 2175 passed、0 failed（T4 の 1832・T7 の 24・T8 の 206・T9 の 28・T11 の 57・16・12 の和）、skip は無い（独立の監査の 1 回目の指摘 OBS-1 で、前に書いた 2375 は足し算の誤りと分かり直した）。作る段の版上げの前と後の結果と同じ。
- PR の CI（必須の build-and-test、Node 18・20・22）: head `2ece55ee`・`93b7f580`・`baef7ecf` で 3 つとも success。

## 網羅率

- 作る段で、Node に組み込みの網羅率で測った: 82.65%（読み込まれた 55 / 68 file、28277 行のうち 23372 行）、66.88%（`src/` の試験でないプログラム全体、34945 行のうち 23372 行）。この段では測り直していない（package.json・package-lock.json・プログラムは作る段の測りの後に変わっていない）。測ったのは Node v26.12.1 で、Node に組み込みの網羅率は Node の版ごとに数え方が少し違いうるので、ほかの Node の版で測ると値が少しずれうる。
- 目標の 100% に届かない（Not Met）。

## 安全の確かめ

| 確かめ | 結果 |
|--------|------|
| `npm audit --omit=dev`（NFR4.1） | found 0 vulnerabilities |
| lock の 4 つの確かめ（NFR4.2） | 4 つとも PASS（作る段で作る役とこの会話がそれぞれ確かめ、package.json と package-lock.json はその後変わっていない） |
| 版の固定（NFR4.3） | 7 つとも範囲の記号なし |
| 勧告の番号の検索（NFR2.1） | 差分・commit の文・PR の本文の 3 つで 0 件 |
| 本番の server の通信の道のり（NFR3.1） | 試験でない file が SDK から読むのは server/mcp.js と server/stdio.js だけ。src/ の差分 0 |
| 勧告の題名・重さ・中身（NFR2.2） | 独立の監査の席の目の確かめを待つ（Unverified） |

## Target Verification Matrix（最終）

| Target ID | Actual | Verdict |
|-----------|--------|---------|
| TC-SUITE | 15 の命令がすべて 0、2175 passed・0 failed、CI の必須の 3 つ success | Met |
| TC-COV | 82.65% / 66.88% | Not Met |
| TC-REG | 退行の試験は足していない（Owner の決定、FR4.4） | Not Met |
| TC-STRAT | 新しい試験の file は無い（Owner の答え Q6 = A） | Not Met |
| TC-CI | この計画は CI Pipeline の段を動かさない | N/A |
| NFR1.1 | 先頭の項の bin の写しも変わった（Owner の答えで外れとして記録） | Not Met |
| NFR1.2 | 試験は落ちず、package 以外のプログラムの変更なし | Met |
| NFR1.3 | すべて 0、待ち時間は不変 | Met |
| NFR2.1 | 3 つとも 0 件 | Met |
| NFR2.2 | 独立の監査の前 | Unverified |
| NFR3.1 | server/mcp.js と server/stdio.js だけ | Met |
| NFR4.1 | 0 件 | Met |
| NFR4.2 | 4 つとも PASS | Met |
| NFR4.3 | 7 つとも固定 | Met |
| NFR4.4 | PR の本文にある | Met |
| NFR5.1 | merge commit を戻せば戻る | Met |
| NFR5.2 | Node 18 の回は通った | Met |

## 失敗の扱い

- 段の決まり（Build and Test の失敗の条件）では、Not Met の TC-COV・TC-REG・TC-STRAT・NFR1.1 と、Unverified の NFR2.2 があるので、この段は失敗になる。命令の失敗は無い。
- 原因の分け方:
  - TC-COV・TC-REG・TC-STRAT: Owner がこの PR では試験を足さないと決めた外れ（要件 FR4.3・FR4.4、Owner の答え Q5 = A・Q6 = A）。直す道は「試験を足して 100% にし、退行の試験を足す」で、この取り組みの範囲（依存の版上げだけ、OD-KUSABI-DEPS-UPGRADE-ONLY-UNIT-20261109-001）を越える。
  - NFR1.1: npm が package.json の bin を lock に写し直した物で、Owner の答えで外れとして記録した。lock を手で直して元に戻すと package.json と食い違う。
  - NFR2.2: 独立の監査で決まる物で、この段では終えられない。
- 扱いは Owner に伺う（下の伺いの記録に足す）。

## 伺いの記録

- Owner の答え（2026-11-09、段の失敗の伺い）: 「Accept failure」。失敗をこの file に記録して、この段の承認へ進む。作る段に戻して試験を足す道（Retry with fix）は採らなかった。行の網羅率は別の単位で埋め（要件 FR4.3）、NFR2.2 は独立の監査で決まる。戻した回数: 0/3。
