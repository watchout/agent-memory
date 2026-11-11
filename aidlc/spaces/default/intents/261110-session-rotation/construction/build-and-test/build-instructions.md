# 作り方の手順 — 会話の切り直し（261110-session-rotation）

この取り組みは新しい依存も、DB の作りの変更も、workflow の変更も足さない。作り方は main と同じで、手順は今の `package.json` と `.github/workflows/ci.yml` に従う。

## 前提

- Node: `package.json` の `engines` は 20 以上。CI は Node 18・20・22 で回す（`.github/workflows/ci.yml` の matrix）。手元の確かめは 1 つの版で行い、版を記録する（`test-results.md`）。
- 道具: npm。TypeScript の strict の型検査は `tsc`、試験の実行は `tsx`（どちらも `devDependencies` に既にある）。
- 試験の Store は SQLite か JSON の file。本番の PostgreSQL は使わない（この取り組みは表の作りを変えない。NFR5）。

## 依存の入れ方

```bash
npm ci
```

`package.json` の変更はこの取り組みでは `scripts`（試験の命令）だけで、依存と lock は変わっていない。

## 環境

- build に環境変数は要らない。
- 試験は、すべて `HOME` を使い捨ての folder にして動かす（`HOME=$(mktemp -d) ...`）。既定の `createStore()` は JSON の置き場を `homedir()` から決めるので、`HOME` を指定しないと、この Mac の実際の保存先に試験の行が入る（11-11 の作る段で実際に入った。`project.md`）。
- core の試験の file は `KUSABI_INTEGRATED_BUILT_EXECUTION=1` を付ける（CI と同じ）。`dist/` を起動する試験があるため、先に build する。
- `src/test-post-tool-hook.ts` は `DATABASE_URL` が無いと 0 で先に終わる（main でも同じ）。網羅率を測る時だけ `AGENT_MEMORY_DB_TYPE=sqlite` を足す。

## build の命令

```bash
npx tsc --noEmit    # 型検査（strict）。試験の file は tsconfig の対象外
npm run build       # = npm run clean && tsc。dist/ を作り直す
```

試験の file の型は、一時の tsconfig（`src` の試験の file を含める）で別に検査する。CI の命令には無いが、この取り組みの作る段で毎回流した。

## build の確かめ

- 2 つの命令がどちらも 0 で終わる。
- `dist/` に hook の入口（`dist/transcript-stop-capture.js`・`dist/claude-session-start.js`・`dist/codex-session-start.js`・`dist/rotation-watcher.js` ほか）が出来ている。試験のうち、hook の command を別 process で起動する物は、この `dist/` を起動する。
- 足した module は 20（`src/` の 1 file は最大 647 行。team.md の「最大 800 行」の内）。

## よくある失敗

| 症状 | 原因 | 直し方 |
|---|---|---|
| 試験のあとで実際の保存先に行が入る | `HOME` を指定せず `createStore()` を呼んだ | 必ず `HOME=$(mktemp -d)`。入った行は、中身を見てから Owner に知らせる（消さない） |
| `dist/` を起動する試験が「file が無い」で落ちる | build をしていない | 先に `npm run build` |
| post-tool-hook の試験が何もせず 0 で終わる | `DATABASE_URL` が無い（main でも同じ） | 網羅率の時は `AGENT_MEMORY_DB_TYPE=sqlite` |
| `ps` の起動時刻を比べる試験が日本語の環境で落ちる | `ps -o lstart` の表記が環境の言語で変わる | 比べる値を作る時は `LC_ALL=C` を付ける（試験の code は付けてある） |
| Node の版で網羅率の数が少し違う | V8 の数え方の差 | 測った Node の版を `test-results.md` に書く |
