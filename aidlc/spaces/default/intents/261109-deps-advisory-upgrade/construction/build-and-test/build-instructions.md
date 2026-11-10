# 作り方の手順 — 本番の依存の版上げ（Issue #339）

- 入力: 作る段の計画 `construction/code-generation/code-generation-plan.md`、試験の手順 `construction/code-generation/unit-test-instructions.md`、作った物のまとめ `construction/code-generation/code-summary.md`
- 対象: PR https://github.com/watchout/agent-memory/pull/340 の branch `kusabi/deps-advisory-upgrade-339`

## 前提

- Node.js 20 以上（package.json の engines.node `>=20.0.0`）。CI は Node 18・20・22 で回す（`.github/workflows/ci.yml`。Node 18 を外すのは別の workflow の PR）。この Mac の確かめは Node v26.12.1・npm 11.20.0。
- 環境の変数は要らない（試験は鍵の無い状態で動く。PostgreSQL の接続の文字列も渡さない）。手元で core の試験を動かす時だけ、CI の `RUNNER_TEMP` の代わりに `KUSABI_TEST_TMPDIR=$(mktemp -d)` を渡す（`src/test.ts` がどちらかを求める）。
- 外の service は要らない（Voyage・PostgreSQL に繋がない）。

## 依存を入れる

```bash
npm ci
```

- package-lock.json のとおりに入れる。lock を書き換えないこと（`npm ci` の後の `git status --porcelain package.json package-lock.json` が何も出さない）を確かめる。
- npm 11 は esbuild と fsevents（どちらも開発用）のインストールの時の script を動かさず警告を出す。版上げの前も後も同じで、build と試験には影響しない。

## 作る

```bash
npx tsc --noEmit
npm run build
```

- 型検査と、`dist/` への build。どちらも 0 で終わることを確かめる。

## 作った物の確かめ

- `npm audit --omit=dev` が「found 0 vulnerabilities」を返す（件数だけを記録する。勧告の中身は書かない）。
- package-lock.json を base（main `ee2acff9dcb83b773969d0df9d8a7884728bef67`）の lock と比べ、機能以外の要件 NFR4.2 の 4 つ（増える項・変わる項・取得元と照合の値・インストールの時の script）を確かめる。

## うまくいかない時

- `npm ci` が「package.json と package-lock.json が合わない」で落ちる: lock を直さずに止まり、どちらかの file が版上げの後に変わっていないかを `git diff` で確かめる。
- Node 18 で `npm ci` が「Node 20 以上を求める」警告を出す: 警告で、入れること自体は止まらない（@hono/node-server 2.1.6 の engines）。CI の Node 18 の回が落ちた時は、この PR では直さず、Node 18 を外す workflow の PR を先に出す（要件 FR3.3）。
- core の試験が「RUNNER_TEMP か KUSABI_TEST_TMPDIR が要る」で落ちる: 手元では `KUSABI_TEST_TMPDIR=$(mktemp -d)` を渡す。
