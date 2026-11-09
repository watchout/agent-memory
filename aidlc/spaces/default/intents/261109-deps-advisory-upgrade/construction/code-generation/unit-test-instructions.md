# 試験の手順 — 本番の依存の版上げ（Issue #339）

- 入力: 承認された要件（`inception/requirements-analysis/requirements.md` の FR4.1〜FR4.4）、機能以外の要件（`construction/nfr-requirements/` の NFR1.1〜NFR5.2）
- この取り組みはプログラムを変えないので、新しい試験の file は作らない（要件 FR4.4、Owner の答え Q6 = A）。今ある試験を、版上げの前と後の 2 回動かして確かめる。

## 試験の枠組み

- 専用の試験の枠組みは使わず、tsx で直接動かす自前の script（`src/test*.ts`・`tests/spec-enforcement/`・`tests/gate0/`）と、node で動かす script（`scripts/test-kusabi-content-addressed-runtime-release.mjs`）。設定の file は無い。
- MCP の試験は、SDK の client（`client/index.js`・`client/stdio.js`）で `dist/index.js` を stdio で起動して道具を呼ぶ。だから SDK の版上げは、client と server の両方の側でこの試験が確かめる。
- 依存を入れる命令: `npm ci`（lock のとおりに入れる）。

## 動かす命令（この単位の分。CI の step と同じ順）

依存を入れた後に、作業場の根で次の命令を 1 つずつ動かす。どれも決まった試験の file を名指しする（`npm run` の名前は package.json で決まった file だけを動かす）。

| # | CI の step | 命令 |
|---|------------|------|
| T1 | Install dependencies | `npm ci` |
| T2 | Type check | `npx tsc --noEmit` |
| T3 | Build | `npm run build` |
| T4 | Run core test suite | `KUSABI_INTEGRATED_BUILT_EXECUTION=1 npx tsx src/test.ts` |
| T5 | Run native recovery and automatic receive tests | `npm run test:codex-hook`（`src/test-codex-session-start.ts`・`src/test-codex-hook-installer.ts`）、`npm run test:claude-hook`（`src/test-claude-session-start.ts`・`src/test-claude-hook-installer.ts`）、`npm run test:gemini-hook`（`src/test-gemini-session-start.ts`・`src/test-gemini-hook-installer.ts`）、`npm run test:gemini-conversation-ingest`（`src/test-gemini-conversation-ingest.ts`）、`npm run test:automatic-receive`（`src/test-session-start-auto-receive.ts`） |
| T6 | Run immutable publication and direct rollout tests | `npm run test:kusabi-content-addressed-runtime-release`（`scripts/test-kusabi-content-addressed-runtime-release.mjs --fixture publisher-unit`）、`npm run test:kusabi-direct-fleet-rollout`（`src/test-kusabi-direct-fleet-rollout.ts`） |
| T7 | Run spec-enforcement tests | `npx tsx tests/spec-enforcement/anti-regression-am027.ts` |
| T8 | Run SQLite store tests | `HOME=$(mktemp -d) npx tsx src/test-sqlite.ts` |
| T9 | Run boot recovery tests | `HOME=$(mktemp -d) npx tsx src/test-boot-recovery.ts` |
| T10 | Run post-tool-hook tests | `HOME=$(mktemp -d) npx tsx src/test-post-tool-hook.ts` |
| T11 | Run Gate 0 tests | `HOME=$(mktemp -d) npx tsx tests/gate0/no-secret-recovery.ts`、`HOME=$(mktemp -d) npx tsx tests/gate0/migration-idempotency.ts`、`HOME=$(mktemp -d) npx tsx tests/gate0/search-memory-regression.ts` |

- 合格: T1〜T11 の命令がすべて 0 で終わる（要件 FR4.1）。PR を出す時点の `.github/workflows/ci.yml` の step が変わっていたら、その時の step に合わせる。
- 版上げの前（今の main の lock）に一度動かして、もとからの結果を記録する（brownfield の決まりの Test Baseline）。版上げの後に同じ命令を動かし、前に通った物が落ちていないかを比べる。
- 版上げの後に落ちる物があり、package.json と package-lock.json の中で直せない時は、ほかの file を変える前に Owner に伺う（機能以外の要件 NFR1.2）。

## 網羅率

- 目標: 行の網羅率 100%（team.md の Testing Posture）。
- 測り方: 新しい依存を足さず、Node に組み込みの網羅率で測れるかを先に試す。試す命令: `node --test --experimental-test-coverage --import tsx <試験の file>`（試験の file ごと。T4〜T11 の tsx の file）。
- 測れた時: 全体の行の網羅率の数字と命令を PR の本文に載せる。100% に届かない分は、PR の本文の deviation_ledger に「採った判断」と「採らなかった代替」を 1 行ずつ書き、別の単位で埋める（要件 FR4.3）。この PR では試験を足さない。
- 測れない時: この PR では測らず、PR の本文の deviation_ledger に「採った判断: 新しい依存を足さず、この PR では測らない」「採らなかった案: c8 を足して測る」の 2 行と、Owner の決定 OD-KUSABI-DEPS-UPGRADE-COVERAGE-NOT-MEASURABLE-DEVIATION-20261109-001（https://github.com/watchout/agent-memory/issues/339#issuecomment-6732638457 、本文の SHA-256 `c14ce4435ce6c2860f5d613f166a3ad19f8306ec4c99fce2c4a07012d1493989`）への参照を書く。測れなかったことを示す命令の出力の要点も載せる。

## 退行の試験

- security-patch の既定（勧告に向けた退行の試験を足す）から外れて、足さない。PR の本文の deviation_ledger に「採った判断: 変えたプログラムの行が無いので足さない」「採らなかった案: 足す」の 2 行を書く（要件 FR4.4）。
- 代わりの証拠は、直した後の `npm audit --omit=dev` が 0 件であること（要件 FR1.3・FR4.2、機能以外の要件 NFR4.1）。

## 試験のデータと mock

- 試験は自前の script の中で合成のデータを作り、`HOME=$(mktemp -d)` の使い捨ての置き場を使う。PostgreSQL の試験（`npm run test:pg`）は CI に入っておらず、この取り組みでは動かさない（置き場の扱いを変えないため。機能以外の要件 NFR1.1）。
- 外の API（Voyage）には繋がない。試験は鍵の無い状態で動く。
