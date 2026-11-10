# 安全の要件 — 本番の依存の版上げ（Issue #339）

- 入力: 承認された要件（`inception/requirements-analysis/requirements.md` の NFR2・NFR3・NFR4、FR1〜FR2）、今の技術の一覧（`aidlc/spaces/default/codekb/agent-memory/technology-stack.md`）、この段の要約の確かめ（`nfr-requirements-questions.md`）、この段の承認の場での Owner の直し（2026-11-09、原文の抜き出し: 「新しく入る 2 つの部品を、名前と版で要件に書いてください。」「Minor の 3 つも、この段で直してかまいません。」）
- 勧告の中身（番号・題名・重さ・内容）は書かない。部品の名前と版だけを書く（Issue #339。詳しい判定は arc-sec の非公開の記録 ARCSEC-DEP-AUDIT-RUN-20261109-001）

## 守る物と脅威

| 守る物 | 脅威 | この取り組みでの扱い |
|--------|------|----------------------|
| 本番の server（MCP の stdio） | 依存の部品の既知の勧告 | 直る版へ上げ、直した後の本番の依存の点検を 0 件にする（NFR4.1） |
| 依存の入り方 | 確かめていない版や部品が紛れ込む。インストールの時に動く script が持ち込まれる | 版を固定し、新しく入る部品を名指しの 2 つだけにし、取得元・照合の値・インストールの時に動く script を確かめる（NFR4.2・NFR4.3） |
| 勧告の非公開の判定 | 公開の repo・PR への書き込み | 番号の形の検索と、監査の席の目の確かめ（NFR2.1・NFR2.2） |
| 記憶の中身 | 外への送り出しが増える | 本番の server は stdio のまま、HTTP の部品を読み込まない（NFR3.1） |

- 認証・認可・資格情報は変えない（OD-KUSABI-DEPS-UPGRADE-ONLY-UNIT-20261109-001）。この取り組みは守る物（workflow・DB の構造・資格情報・展開）に触れない。

## 要件

| ID | 要件 | 合格の条件 | 出どころ |
|----|------|------------|----------|
| NFR2.1 | 勧告の番号を、repo のファイル・commit の文・PR の本文・AI-DLC の記録に書かない | 次の 3 つの命令がどれも 1 行も出さない（大文字小文字を区別しない拡張正規表現 `GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}\|CVE-[0-9]{4}-[0-9]{4,}`）: 統合する版の差分 `git diff origin/main...HEAD \| grep -iE '<上の正規表現>'`、commit の文 `git log origin/main..HEAD --format=%B \| grep -iE '<上の正規表現>'`、PR の本文 `gh pr view <PR の番号> --json body --jq .body \| grep -iE '<上の正規表現>'` | 要件 NFR2 |
| NFR2.2 | 勧告の題名・重さ・中身も書かない | 独立の監査の席が差分と PR の本文を目で読み、勧告の題名・重さの語・中身が無いと確かめる | 要件 NFR2（Owner の直し） |
| NFR3.1 | 本番の server は MCP の stdio だけで動き、外と通信する道のりを増やさない | 本番のプログラム（`src/` の試験でない file）が SDK から読み込むのは `server/mcp.js` と `server/stdio.js` だけ（今の `src/index.ts` 2〜3 行目）で、この PR でプログラムを変えない（NFR1.1） | 要件 NFR3 |
| NFR4.1 | 直した後に本番の依存の既知の勧告が 0 件 | PR の head で `npm audit --omit=dev` が「found 0 vulnerabilities」を返す。PR を出す直前にもう一度回し、新しい勧告が出ていたら版を決め直す前に Owner に伺う | 要件 NFR4・FR1.3 |
| NFR4.2 | 新しく入る部品は次の 2 つだけ。どの部品も `registry.npmjs.org` から取り、中身の照合の値（integrity）がある。インストールの時に動く script を持つ部品を増やさない | 今の main の package-lock.json と比べて、(1) 増える項が `node_modules/body-parser/node_modules/content-type`（content-type 2.1.0、本番）と `node_modules/type-is/node_modules/content-type`（content-type 2.1.0、本番）の 2 つだけで、消える項が無い。(2) 版が変わる項が要件 FR1.1・FR1.2 の部品と先頭の項だけ。(3) すべての `resolved` の取得元が `registry.npmjs.org` で、`integrity` が無い項が 0 件。(4) `hasInstallScript` を持つ項が今の main と同じ `node_modules/esbuild` と `node_modules/fsevents` の 2 つ（どちらも開発用）だけ | 要件 NFR4・FR1.2、Owner の直し（この段の差し戻し） |
| NFR4.3 | 本番の直接の依存は範囲指定をやめて完全な版で固定する | package.json の dependencies のどの値も範囲の記号を含まない（要件 FR2.2 の表） | 要件 FR2.2 |

## 確かめた事実（2026-11-09）

- 今の package-lock.json: 取得元は 145 件すべて `registry.npmjs.org`、照合の値が無い項は 0 件。
- 版上げを試した写しの package-lock.json: 取得元は 147 件すべて `registry.npmjs.org`、照合の値が無い項は 0 件。直した後の `npm audit --omit=dev` は 0 件。今の lock と比べて増えた項は `node_modules/body-parser/node_modules/content-type` と `node_modules/type-is/node_modules/content-type`（どちらも content-type 2.1.0）の 2 つで、消えた項は無い。
- `hasInstallScript` を持つ項は、今の lock も写しの lock も `node_modules/esbuild` と `node_modules/fsevents`（どちらも開発用）の 2 つだけ。
- 本番のプログラムが読み込む SDK の部品は `server/mcp.js`・`server/stdio.js` の 2 つだけ。express・hono・@hono/node-server を直接読み込む本番のプログラムは無い。

## 範囲の外

- 開発用の部品（tsx の下の esbuild）の勧告。本番の依存ではないため（要件の範囲の外）。
- 資格情報・権限・DB の構造・workflow の変更。
