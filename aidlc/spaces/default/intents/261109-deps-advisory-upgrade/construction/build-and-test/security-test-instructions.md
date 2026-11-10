# 安全の確かめの手順 — 本番の依存の版上げ（Issue #339）

- 入力: 機能以外の要件 `construction/nfr-requirements/security-requirements.md`（NFR2.1・NFR2.2・NFR3.1・NFR4.1〜NFR4.3）、作った物のまとめ `construction/code-generation/code-summary.md`
- 試験の量は Minimal だが、scope が security-patch なので、安全の確かめの手順をここに置く。勧告の中身（番号・題名・重さ・内容）はこの file にも、確かめの記録にも書かない。

## 確かめ 1: 本番の依存の勧告（NFR4.1）

```bash
npm audit --omit=dev
```

- 合格: 「found 0 vulnerabilities」。記録は件数だけ。PR の監査の依頼を出す head で回す。

## 確かめ 2: lock の中身（NFR4.2）

node か python で base（main `ee2acff9dcb83b773969d0df9d8a7884728bef67`）の lock（`git show ee2acff:package-lock.json`）と今の lock を読み、次の 4 つを確かめる:

1. 増える項が `node_modules/body-parser/node_modules/content-type` と `node_modules/type-is/node_modules/content-type`（どちらも content-type 2.1.0）の 2 つだけで、消える項が無い
2. 中身が変わる項が要件 FR1.1・FR1.2 の 17 の部品と先頭の項だけ（先頭の項の bin の写しの変化は外れとして PR の deviation_ledger に記録済み）
3. すべての `resolved` の取得元が `registry.npmjs.org` で、`integrity` の無い項が 0
4. `hasInstallScript` を持つ項が `node_modules/esbuild` と `node_modules/fsevents` の 2 つだけ

## 確かめ 3: 版の固定（NFR4.3）

- package.json の dependencies のどの値も範囲の記号（`^`・`~`・`>`・`<`・`*`）を含まない。

## 確かめ 4: 勧告の中身を公開しない（NFR2.1・NFR2.2）

```bash
git diff ee2acff9dcb83b773969d0df9d8a7884728bef67...HEAD | grep -iE 'GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}|CVE-[0-9]{4}-[0-9]{4,}'
git log ee2acff9dcb83b773969d0df9d8a7884728bef67..HEAD --format=%B | grep -iE 'GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}|CVE-[0-9]{4}-[0-9]{4,}'
gh pr view 340 --repo watchout/agent-memory --json body --jq .body | grep -iE 'GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}|CVE-[0-9]{4}-[0-9]{4,}'
```

- 合格: 3 つとも 1 行も出さない（NFR2.1）。
- NFR2.2（勧告の題名・重さの語・中身が無いこと）は、独立の監査の席（devauditor）が差分と PR の本文を目で読んで確かめる。作者の席は終えられない。

## 確かめ 5: 本番の server が外と通信する道のり（NFR3.1）

```bash
grep -rn "@modelcontextprotocol/sdk" src --include='*.ts'
```

- 合格: 試験でない file が読み込むのは `server/mcp.js` と `server/stdio.js` だけ（`src/index.ts`）。`src/`・`scripts/`・`tests/` に差分が無い。

## 静的な解析・動かしての解析

- SAST・DAST の道具は足さない（新しい依存を足さない。team.md の Code Style）。プログラムを変えないため、新しい入力の道のりも無い。
