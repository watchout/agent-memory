# つなぎの試験の手順 — 本番の依存の版上げ（Issue #339）

- 入力: 試験の手順 `construction/code-generation/unit-test-instructions.md`、作った物のまとめ `construction/code-generation/code-summary.md`
- 試験の量は Minimal（この取り組みの設定）。新しいつなぎの試験は作らない（Owner の決定、要件 FR4.4）。

## 対象

- 版上げで変わる境目は、MCP の SDK（server と client の両方）と、SDK の下の部品。本番の server は SDK の `server/mcp.js` と `server/stdio.js` だけを使う。
- 今ある試験のうち、この境目を通る物: core の試験（T4、`src/test.ts`）。SDK の client（`client/index.js`・`client/stdio.js`）で `dist/index.js` を stdio で起動し、道具を呼ぶ。SDK の版が変わると、client と server の両方の側で動きが確かめられる。

## 動かし方

```bash
npm ci
npm run build
KUSABI_TEST_TMPDIR=$(mktemp -d) KUSABI_INTEGRATED_BUILT_EXECUTION=1 npx tsx src/test.ts
```

- 合格: 0 で終わり、通った数が版上げの前と同じ（1832 passed・0 failed）。
- 試験のデータは試験の中で作る合成のデータで、使い捨ての置き場を使う。外の service には繋がない。

## 動かさない物

- PostgreSQL の試験（`npm run test:pg`）: CI に入っておらず、この取り組みは置き場の扱いを変えないため（試験の手順のとおり）。
