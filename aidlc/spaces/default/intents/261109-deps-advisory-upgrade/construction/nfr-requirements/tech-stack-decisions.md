# 技術の決まり — 本番の依存の版上げ（Issue #339）

- 入力: 承認された要件（`inception/requirements-analysis/requirements.md` の FR1〜FR3）、今の技術の一覧（`aidlc/spaces/default/codekb/agent-memory/technology-stack.md`）、この段の要約の確かめ（`nfr-requirements-questions.md`）

## 決まった版

| 部品 | 今の宣言 / lock | この取り組みの後（宣言 = lock） | 出どころ |
|------|------------------|--------------------------------|----------|
| @modelcontextprotocol/sdk | ^1.12.1 / 1.28.0 | 1.32.2 | 要件 FR1.1・FR2.2 |
| uuid | ^11.1.0 / 11.1.0 | 11.1.1 | 要件 FR1.1・FR2.2 |
| zod | 宣言なし / 4.3.6 | 4.6.7（本番の依存として宣言） | 要件 FR2.1 |
| ajv | ^8.20.0 / 8.20.0 | 8.20.0 | 要件 FR2.2 |
| ajv-formats | ^3.0.1 / 3.0.1 | 3.0.1 | 要件 FR2.2 |
| pg | ^8.13.0 / 8.20.0 | 8.20.0 | 要件 FR2.2 |
| sql.js | ^1.14.1 / 1.14.1 | 1.14.1 | 要件 FR2.2 |
| Node（engines） | >=18.0.0 | >=20.0.0 | 要件 FR3.1 |

- SDK の下の部品の版は package-lock.json で決まる（要件 FR1.1 の表）。開発用の依存は変えない（要件 FR2.3）。
- package-lock.json の先頭の項（`packages[""]`）には package.json の engines と dependencies の写しがあるので、上の宣言の変更はそこにも出る。差分の条件はこれを数える（壊れにくさの要件 NFR1.1）。

## 決定: Node 20 以上にし、部品を直る版へ上げて固定する

- **Context**: 勧告の直った @hono/node-server（SDK の下の部品）は 2 系にしかなく、2 系は Node 20 以上を求める。1 系はどの版にも勧告が当たる。本番の server はこの部品を読み込まない（安全の要件 NFR3.1）。今の宣言は範囲指定で、宣言と lock の版が離れている（SDK ^1.12.1 と 1.28.0）。zod は src/index.ts が直接読み込むのに宣言が無い。
- **Decision**: 上の表のとおり、直る版へ上げ、本番の直接の依存すべてを完全な版で固定し、zod を宣言し、engines を Node 20 以上にする（要件の問いの答え Q1〜Q4）。
- **Consequences**: CI はこの PR では Node 18 も回し続ける。Node 18 の回が落ちたら、この PR では直さず、Node 18 を外す workflow の PR を先に出す（壊れにくさの要件 NFR5.2）。後で依存を入れ直しても、本番の直接の依存の版は変わらない。動く Node の前提を書いた `README.md` 402 行目・`CONTRIBUTING.md` 54 行目・`CLAUDE.md` 12 行目・`docs/requirements/SSOT-0_PRD.md` 44 行目と 287 行目・`docs/OSS_EVALUATION_FRAMEWORK.md` 153 行目（`node:18-alpine` → `node:20-alpine`）・今の技術の一覧（codekb の `technology-stack.md` 9 行目）の 7 行は、この PR で Node 20 に書き換える（Owner の直しと、コードを書く段の承認された計画の Step 6。差分の条件は壊れにくさの要件 NFR1.1）。
- **書き換えない物**: `docs/strategy/mvp-spec-v0.1.0-original.md` は 2026-04-07 時点の古い計画の写しで、現行の正本ではない（CLAUDE.md）。CI を「Node 18 / 20 / 22」と書く文書（`docs/operations/WORLD_CLASS_RELEASE_CRITERIA.md`、`docs/OSS_EVALUATION_FRAMEWORK.md` 422 行目の「Node.js 18, 20, 22 で動作確認」ほか）は、CI が Node 18 を回し続ける間は今の事実と合う。`CLAUDE.md` 12 行目と `docs/OSS_EVALUATION_FRAMEWORK.md` 153 行目は書き換える側に入れた（上の Consequences）。
- **Alternatives Rejected**:
  - Node 18 以上のままにする: package.json の宣言が上げる先の部品の求めと食い違う（要件の問い Q4 の A を採らなかった）。
  - 範囲指定（`^`）を残す: 依存を入れ直した時に、確かめていない版が紛れ込む（依頼の原文）。
  - npm の overrides で @hono/node-server を 1 系に留める: 1 系はどの版にも勧告が当たるので直らず、SDK が求める範囲の扱いも複雑になる。

## 閉じた問い

- 版の公開の試験（`npm run test:kusabi-content-addressed-runtime-release`）が package.json・package-lock.json の中身に依る値を持つか（要件の未決の問いの 3 つ目）: 持たない。`scripts/test-kusabi-content-addressed-runtime-release.mjs` は package.json の `name` が `wasurezu` かだけを見て lock を読まず（119〜120 行目）、`scripts/build-kusabi-content-addressed-runtime-release.mjs` は package.json と package-lock.json の SHA-256 を動かした時に数えて記録する（293〜294 行目）。決まった SHA-256 の値はどちらの file にも無い。コードを書く段の試験の結果でも確かめる。
