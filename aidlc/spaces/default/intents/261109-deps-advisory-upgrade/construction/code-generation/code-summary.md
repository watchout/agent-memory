# 作った物のまとめ — 本番の依存の版上げ（Issue #339）

- 計画: `code-generation-plan.md`（Owner が承認）。試験の手順: `unit-test-instructions.md`
- branch `kusabi/deps-advisory-upgrade-339`、base `ee2acff9dcb83b773969d0df9d8a7884728bef67`（main）
- 作る役（aidlc-developer-agent、Owner が 1 回の呼び出しを承認）が手順 1〜10 と手元の commit を行い、push・PR はこの会話が行った（サブエージェントは GitHub に書かない、team.md）。

## 変えた file

| file | 変えた所 |
|------|----------|
| `package.json` | dependencies を完全な版で固定（@modelcontextprotocol/sdk 1.32.2・ajv 8.20.0・ajv-formats 3.0.1・pg 8.20.0・sql.js 1.14.1・uuid 11.1.1）、zod 4.6.7 を足す、engines.node `>=18.0.0` → `>=20.0.0`。devDependencies は同じ |
| `package-lock.json` | 版の変わる 17 項（要件 FR1.1 の 11 と FR1.2 の 6）、増える 2 項（`node_modules/body-parser/node_modules/content-type` と `node_modules/type-is/node_modules/content-type`、どちらも content-type 2.1.0）、先頭の項（engines・dependencies・bin の写し） |
| `README.md` 402 行目、`CONTRIBUTING.md` 54 行目、`CLAUDE.md` 12 行目、`docs/requirements/SSOT-0_PRD.md` 44・287 行目 | `Node.js 18+` → `Node.js 20+` |
| `docs/OSS_EVALUATION_FRAMEWORK.md` 153 行目 | `node:18-alpine` → `node:20-alpine` |
| `aidlc/spaces/default/codekb/agent-memory/`（9 file、新しく足す） | 今のコードの読み解き。`technology-stack.md` 9 行目は「Node.js 20 以上（CI は 18・20・22）」 |
| `aidlc/spaces/default/intents/261109-deps-advisory-upgrade/` の `inception/`・`construction/`（新しく足す） | この単位の AI-DLC の記録。`audit/` と `.aidlc-engine/` は入れない |
| `docs/audit/kusabi-deps-advisory-upgrade-339.json`（新しく足す） | 監査の項目（`sds-audit-items/1`、DU-1〜DU-6） |
| `construction/nfr-requirements/reliability-requirements.md`・`tech-stack-decisions.md` | NFR1.1 を 7 行にそろえ、CLAUDE.md 12 行目と OSS_EVALUATION_FRAMEWORK.md 153 行目を名指しに足した（NFR Requirements の段の承認の時の Owner の直し） |

- `src/`・`scripts/`・`tests/`・`.github/`・`.shirube/` は変えていない。

## 主な決定

- lock の版上げは `npm audit fix --omit=dev` で行い、package.json の固定の後に `npm install --package-lock-only --ignore-scripts` で先頭の項だけを合わせた（計画 Step 3・Step 4）。
- package-lock.json の先頭の項で、`bin` の写しも変わった。main の lock の写しに、main の package.json にある `wasurezu-fleet-conversation-backfill` と `wasurezu-transcript-stop-capture` の 2 つが無く、npm が lock を書き直す時に package.json のとおりに足した。package.json の bin と振る舞いは変わらない。機能以外の要件 NFR1.1 の文言（先頭の項は engines と dependencies の写しだけ）は直さず、外れとして PR の deviation_ledger に書く（Owner の答え: 「文言は直さず外れとして書く」）。

## 確かめ

### lock と点検（機能以外の要件 NFR4.1・NFR4.2、要件 FR1.3・FR2.4）

- `npm audit --omit=dev`: found 0 vulnerabilities（件数だけ）。開発用を含めた全体の点検では 1 件出るが、開発用の部品（tsx の下）で範囲の外。
- main の lock と比べた 4 つの確かめ（作る役と、この会話がそれぞれ node で両方の lock を読んで確かめた）: (1) 増える項は content-type 2.1.0 の 2 つだけで消える項は無い、(2) 中身が変わる項は FR1.1・FR1.2 の 17 と先頭の項だけ、(3) すべての取得元が `registry.npmjs.org` で照合の値が無い項は 0、(4) `hasInstallScript` を持つ項は esbuild と fsevents の 2 つだけで main と同じ。すべて PASS。
- `npm ci` は 0 で終わり、その後の `git status --porcelain package.json package-lock.json` は何も出さない。

### 試験（要件 FR4.1、この Mac の Node v26.12.1・npm 11.20.0）

| # | 前（main の lock） | 後（head） |
|---|---|---|
| T1 `npm ci` | 0 | 0 |
| T2 `npx tsc --noEmit` | 0 | 0 |
| T3 `npm run build` | 0 | 0 |
| T4 core | 0（1832 passed） | 0（1832 passed） |
| T5（5 つの命令） | 5 つとも 0 | 5 つとも 0 |
| T6（2 つの命令） | 0（verdict PASS）・0（157 assertions） | 同じ |
| T7 spec-enforcement | 0（24 passed） | 0（24 passed） |
| T8 SQLite | 0（206 passed） | 0（206 passed） |
| T9 boot recovery | 0（28 passed） | 0（28 passed） |
| T10 post-tool-hook | 0 | 0 |
| T11 Gate 0（3 つ） | 0・0・0（57・16・12 passed） | 同じ |

- T4 は手元では `KUSABI_TEST_TMPDIR=$(mktemp -d)` を足して動かした（`src/test.ts` が CI の `RUNNER_TEMP` か手元の `KUSABI_TEST_TMPDIR` を求める）。プログラムは変えていない。
- T10 は、読み込む `src/post-tool-hook.ts` が `DATABASE_URL` の無い時に 0 で先に終わるため、CI と同じ命令では試験の本体が動かない（main でも同じ。この PR で生じた物ではない）。参考に `AGENT_MEMORY_DB_TYPE=sqlite` を足すと、前も後も 45 passed・0 failed。

### 行の網羅率（要件 FR4.3）

- Node に組み込みの網羅率（`node --test --experimental-test-coverage --test-reporter=lcov --import tsx <試験の file>`）で、T4〜T11 の tsx の試験の file 17 個を CI と同じ環境の変数で動かし、行ごとに足し合わせた。新しい依存は足していない。
- `src/` の試験でないプログラムのうち読み込まれた 55 / 68 file: 82.65%（28277 行のうち 23372 行）。読み込まれない 13 file の 6668 行も分母に入れると 66.88%（34945 行のうち 23372 行）。2 回測って通った行の差は 1 行。
- 数えから外した物: `dist/`（試験が起動する build の写し）、`tests/` の試験の file。
- 100% に届かないので、PR の deviation_ledger に外れとして書き、別の単位で埋める（要件 FR4.3）。測れたので、OD-KUSABI-DEPS-UPGRADE-COVERAGE-NOT-MEASURABLE-DEVIATION-20261109-001 の 2 行は使っていない。

### PR と CI（要件 FR3.3・FR4.1）

- PR: https://github.com/watchout/agent-memory/pull/340 （最初の head `2ece55ee2197935649bd0a6c2f29a95714f7a3f5`）
- 必須の検査（branch の保護の required checks）の `build-and-test (18)`・`build-and-test (20)`・`build-and-test (22)` は、どれも success。Node 18 の回も通ったので、Node 18 を外す workflow の PR を先に出す場面（要件 FR3.3）は起きなかった。
- PR の本文の勧告の番号: 機能以外の要件 NFR2.1 の正規表現で 0 件。
- 必須ではない `Shirube Rapid/Lite Gates Report` は failure（`RAPID_LITE_HARD_BLOCK`）。中身は `gate-contract`・`lifecycle`・`enforcement-policy`・`control-state-completeness` の BLOCKED で、主な理由は `RL-PR-002`（変えた file が、この workflow が読む古い作業指示 `.shirube/control-handoffs/CH-001.yaml` の allowed_paths の外）。この workflow は Shirube V3 の作業指示（control handoff）を前提にした検査で、この単位には作業指示が無い（AI-DLC の単位として作る。作業指示は OD-COMPANY-AIDLC-ONLY-UNIFIED-RULE-LIST-20261105-001 でやめた物）。直すには `.shirube/`（守る物）を変える必要があり、この単位の範囲の外。必須の検査ではないので、扱いは統合の席と Owner が決める（arc に知らせた）。

## 動かしていない試験と理由

- `scripts/test-kusabi-content-addressed-runtime-release.mjs` の網羅率: tsx の file でなく、`node --test` から引数（`--fixture publisher-unit`）を渡せないため測っていない（試験そのものは T6 で動かし、0 で終わった）。
- `npm run test:pg`（PostgreSQL の試験）: CI に入っておらず、この取り組みは置き場の扱いを変えないため動かしていない（試験の手順のとおり）。
- Node 18・20・22 での試験: この Mac に無いので、PR の CI で確かめた（上の「PR と CI」。3 つとも success）。

## 計画からの外れ

- package-lock.json の先頭の項の `bin` の写し（上の「主な決定」）。
- 行の網羅率 100% に届かない（上の「行の網羅率」）。
- security-patch の既定の退行の試験を足さない（要件 FR4.4。採った判断: 変えたプログラムの行が無いので足さない／採らなかった案: 足す）。
- PR の大きさの予算（400 行・20 file）を超える（AI-DLC の単位の作る段の出力。記録の file を足すため）。

## 公開してよいかの確かめ（Owner の答え）

- PR に入れた記録（codekb 9 file・この取り組みの記録）と変えた file を、手元の path・秘密の値・非公開の repo の中身の引用・勧告の番号で探した。伏せた所は 0。足した行に手元の path・秘密の値は無い（計画の文の中の「`/Users/` などで探す」という説明の 1 行だけが当たり、path そのものではない）。
- 非公開の repo（iyasaka-arc）は、Owner の決定の記録の場所として issue とコメントの番号で引くだけで、中身は引用していない。
- 勧告の番号: 差分・commit の文・PR の本文の 3 つで 0 件（機能以外の要件 NFR2.1 の正規表現）。

## 気づいたこと（この PR では直していない）

- codekb の版の事実は、technology-stack.md 9 行目のほかは版上げの前のまま（technology-stack.md 15・16・20 行目、dependencies.md 11・22・64 行目、code-quality-assessment.md 43 行目）。codekb は読んだ時点の commit（ee2acff）の読み解きで、次に読み解きを回す時に直す。
- main の `CLAUDE.md` 215〜218 行目と `README.md` の例に、人の手元の path がある（この PR の差分の外で、もとから公開されている）。扱うかは Owner が別に決める。
- この Mac の npm 11.20 は、esbuild と fsevents のインストールの時の script を動かさず警告を出す（版上げの前も後も同じで、試験には影響しない）。
