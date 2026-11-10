# 作りと試験のまとめ — 本番の依存の版上げ（Issue #339）

- 入力: 作る段の計画 `construction/code-generation/code-generation-plan.md`（Testing Contract を含む）、試験の手順 `construction/code-generation/unit-test-instructions.md`、作った物のまとめ `construction/code-generation/code-summary.md`、機能以外の要件 `construction/nfr-requirements/`
- 確かめた head: `baef7ecf653ed9e9aa571d203c133910f9f35302`（PR #340。package.json と package-lock.json は最初の head `2ece55ee` から変わっていない）
- 試験の量: Minimal。scope: security-patch。作業の単位なし。

## 作りの状態

- `npm ci`・`npx tsc --noEmit`・`npm run build` はこの Mac（Node v26.12.1・npm 11.20.0）で 0 で終わった。PR の CI（Node 18・20・22）の必須の検査も 3 つとも success（head `2ece55ee`・`93b7f580`・`baef7ecf`）。

## 作った試験の手順

| file | 中身 |
|------|------|
| `build-instructions.md` | 依存を入れる・型検査・build・作った物の確かめ |
| `integration-test-instructions.md` | MCP の client と server を stdio でつなぐ core の試験（今ある試験。新しい試験は作らない） |
| `performance-test-instructions.md` | 速さの目標は変えない。今の試験が待ち時間を変えずに通ること |
| `security-test-instructions.md` | 本番の依存の点検・lock の 4 つの確かめ・版の固定・勧告の番号の検索・本番の server の通信の道のり |

## 網羅率の見込み

- 目標は行の網羅率 100%（team.md の Testing Posture、Testing Contract）。作る段で測った値は 82.65%（読み込まれた 55 / 68 file）と 66.88%（`src/` の試験でないプログラム全体）。この PR では試験を足さず、届かない分は別の単位で埋める（要件 FR4.3、Owner の答え Q5 = A）。

## Target Verification Matrix

| Target ID | Source | Expected | Actual | Evidence | Owning Stage | Verdict |
|-----------|--------|----------|--------|----------|--------------|---------|
| TC-SUITE | code-generation-plan.md の Testing Contract（scope_floor「Keep the existing test suite green」）、team.md の Testing Posture | 今ある試験がすべて通る | T1〜T11 がすべて 0 で終了（T4 1832 passed・T7 24・T8 206・T9 28・T11 57・16・12、0 failed）。CI の必須の 3 つも success | test-results.md の「試験の結果」 | build-and-test | Met |
| TC-COV | team.md の Testing Posture（行の網羅率 100%）、Testing Contract | 行の網羅率 100% | 82.65%（読み込まれた file）/ 66.88%（全体）。作る段の測り | code-summary.md の「行の網羅率」、PR #340 の本文 | build-and-test | Not Met |
| TC-REG | org.md の Testing Posture（security-patch は勧告に向けた退行の試験を足す）、Testing Contract の scope_floor | 勧告に向けた退行の試験がある | 足していない（Owner の決定。要件 FR4.4。deviation_ledger に 2 行） | requirements.md の FR4.4、PR #340 の deviation_ledger | build-and-test | Not Met |
| TC-STRAT | Testing Contract の strategy_volume（Minimal: 要件ごとに 1 つの試験、部品ごとに 1 つの通る道の試験） | 要件ごとの試験がある | 新しい試験の file は無い。要件は記録した確かめ（点検・lock の 4 つ・試験の結果）で示した（Owner の答え Q6 = A） | code-summary.md、test-results.md | build-and-test | Not Met |
| TC-CI | Testing Contract の notes（CI で試験を回す） | 統合の前に CI で回す | この計画は CI Pipeline の段を動かさない（ci-pipeline は SKIP）。なお repo の CI は PR #340 で回り、必須の 3 つは success | aidlc-state.md の Scope Configuration | ci-pipeline | N/A（the plan runs no CI Pipeline） |
| NFR1.1 | reliability-requirements.md | 差分が package.json・package-lock.json（先頭の項は engines と dependencies の写しだけ）と 7 行と記録だけ | 先頭の項の bin の写しも変わった。ほかは条件どおり（42 file） | code-summary.md の「主な決定」、traceability.json の NFR1.1 の note、PR の deviation_ledger | build-and-test | Not Met |
| NFR1.2 | reliability-requirements.md | 試験が落ちて package 以外を変える時は変える前に伺う | 試験は落ちず、package 以外のプログラムの変更は無い | test-results.md | build-and-test | Met |
| NFR1.3 | performance-requirements.md | 今の試験が待ち時間を変えずに通る | T1〜T11 がすべて 0 で終了、待ち時間の設定は不変 | test-results.md | build-and-test | Met |
| NFR2.1 | security-requirements.md | 差分・commit の文・PR の本文に勧告の番号が 0 | 3 つとも 0 件 | test-results.md の「安全の確かめ」 | build-and-test | Met |
| NFR2.2 | security-requirements.md | 監査の席が目で読み、題名・重さ・中身が無いと確かめる | まだ（独立の監査の前） | security-test-instructions.md の確かめ 4 | 独立の監査（devauditor）。この計画の段ではない | Unverified |
| NFR3.1 | security-requirements.md | 本番の server は stdio だけ、外への道のりを増やさない | 試験でない file が SDK から読むのは server/mcp.js と server/stdio.js だけ。src/ の差分 0 | test-results.md の「安全の確かめ」 | build-and-test | Met |
| NFR4.1 | security-requirements.md | 本番の依存の点検が 0 件 | found 0 vulnerabilities（head baef7ecf） | test-results.md | build-and-test | Met |
| NFR4.2 | security-requirements.md | lock の 4 つの確かめが通る | 4 つとも PASS（増える項は content-type 2.1.0 の 2 つ、変わる項は 17 と先頭の項、取得元はすべて registry.npmjs.org で照合の値あり、install script は esbuild と fsevents だけ） | code-summary.md、test-results.md | build-and-test | Met |
| NFR4.3 | security-requirements.md | 本番の直接の依存を完全な版で固定 | 7 つとも範囲の記号なし | package.json | build-and-test | Met |
| NFR4.4 | observability-requirements.md | 点検の結果と 4 つの確かめを PR の本文に載せる | PR #340 の本文の「入れる前の確かめ」 | PR #340 の本文 | build-and-test | Met |
| NFR5.1 | reliability-requirements.md | 統合の commit を戻せば 1 回で戻る | 統合は merge commit。差分は依存と記録と 7 行で、戻すのは revert 1 回 | team.md の Way of Working、PR #340 | build-and-test | Met |
| NFR5.2 | reliability-requirements.md | Node 18 の回が落ちたらこの PR で直さない | Node 18 の回は通り、その場面は起きなかった | PR #340 の CI | build-and-test | Met |

## 用意の状態

- 作れる: はい（build・型検査が通る）。
- 試験できる: はい（今ある試験がすべて通る）。
- 展開できる: この段の範囲では判断しない。席が使う Kusabi の入れ替えは、統合の後に Owner の手作業として別に扱う（要件の完了の境目）。
- 段の決まりでは、Not Met（TC-COV・TC-REG・TC-STRAT・NFR1.1）と Unverified（NFR2.2）があるので、この段は失敗の扱いになる。どれも Owner の決定による外れか、後の独立の監査で決まる物。Owner は「Accept failure」を選び、失敗を test-results.md に記録してこの段の承認へ進む（test-results.md の「伺いの記録」）。

## 残っていること

- 行の網羅率を 100% に上げる試験（別の単位。Owner の決定）。
- NFR2.2 の目の確かめ（独立の監査）。
- 古い「Shirube Rapid/Lite Gates Report」の失敗は、Owner の決定で統合の条件に数えない（https://github.com/watchout/agent-memory/issues/339#issuecomment-6735790644 ）。
- 監査の依頼は、この段の記録を足した最後の head で、監査の項目 DU-1 (d) の file の数を数え直してから出す。
