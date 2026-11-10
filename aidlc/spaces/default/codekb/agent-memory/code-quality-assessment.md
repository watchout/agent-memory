# コードの質の見立て — Kusabi（agent-memory）

## 試験

- **置き場**: src/test*.ts（約 36 ファイル。最大は src/test.ts の 5,410 行）、tests/gate0/（3 ファイル）、tests/spec-enforcement/（1 ファイル）
- **枠組み**: 専用の試験の枠組みは使わず、tsx で直接動かす自前のスクリプト（package.json の test・test:* の命令）
- **MCP の試験**: `src/test.ts`・`src/test-memory-source.ts`・`src/test-recovery-context.ts`・`src/test-recovery-scope.ts` は、MCP SDK の client（`Client`・`StdioClientTransport`）で `dist/index.js` を起動し、道具を呼んで確かめる。SDK の版を上げると、この試験が server と client の両方の側の変化を確かめる
- **網羅率**: 測っていない（設定が無い）
- **PostgreSQL**: `npm run test:pg` はあるが、CI では回していない
- 今回は試験を動かしていないので、通るかどうかは確かめていない

## 静的検査と書式

- 書式・静的検査（ESLint・Prettier など）の設定ファイルは無い
- 型検査は `tsc --noEmit`（CI）。strict の設定

## CI

- .github/workflows/ci.yml: Node 18・20・22 で型検査・ビルド・試験
- .github/workflows/shirube-rapid-lite-gates-report.yml: Shirube の門の報告

## 文書

- README・CONTRIBUTING・SECURITY・CHANGELOG・LICENSE がある
- 設計の正本は docs/design/core/ の SSOT-2〜7。席の身元と記憶の境目は SSOT-7 が受け持つ
- CLAUDE.md は「SSOT-* が今の正本」と書く。docs/strategy/ の旧い計画は今の実装と食い違う

## 技術的な負債

| 負債 | 場所 | 今回の取り組みへの関わり |
|------|------|------------------------|
| 記憶の文が Voyage AI に送られうる（鍵は AUN と共用の file からも読む） | src/stores/voyage.ts、src/stores/pg-store.ts 92・202 行目付近 | 「自社か顧客の DB の中で完結」と食い違う |
| 別の役割の席への引き継ぎの表・道具が無い | SSOT-7 第 7 節 | 「どの席も続きから」の中心 |
| 顧客の層が無い（「未実装、将来の固い境目」） | SSOT-7 第 2 節 | 顧客ごとの置き場所と読み書きできる者の一覧 |
| 表を既定の場所に作る。共通基盤の登録との結びつきは計画中（#147） | src/stores/pg-migrations.ts、SSOT-7 第 6 節 | 共通基盤の DB に置く形 |
| DB の作りの変更に戻す手順が無い。AM-023 の変更は重複を消し別の表に残す | src/stores/pg-migrations.ts | 戻せる形の決まり、今の記録の移し |
| set_recovery_config が任意の agent_id の設定を書き換えられる | src/index.ts 666 行目付近 | 読み書きできる者の一覧の正しさ |
| 汎用の DATABASE_URL を拾う | src/stores/index.ts | 置き場所の取り違え |
| PostgreSQL に catch_up_log が無い（TODO AM-026 が 4 件） | src/stores/pg-store.ts 1235〜1257 行目 | 会話の取り込みの取りこぼしの拾い |
| 回復の質の記録は件数と続けたかどうかの 2 値。「試験で取り出せる割合」は測らない | src/recovery-quality.ts | 成功の条件の測り方 |
| 800 行を超えるファイルが 7 つ: kusabi-direct-fleet-rollout.ts 2,036、sqlite-store.ts 1,878、kusabi-fleet-rollout.ts 1,846、pg-store.ts 1,533、restart-pack.ts 1,255、codex-session-start.ts 1,056、index.ts 1,013 | src/ | 保存の層を直す時の手間 |
| zod の宣言が無い | package.json | 版の変化で壊れうる |
| 依存を範囲指定（`^`）で宣言し、宣言と lock の版が離れている（SDK ^1.12.1 と 1.28.0） | package.json・package-lock.json | 版上げの時に、直す先の版を固定して宣言する |
| MCP SDK が使わない HTTP 系の部品（express・hono など）を本番の依存に連れてくる | package-lock.json | 本番の道のりで使わなくても勧告の対象になる |
| 書式・静的検査が無い、網羅率を測らない、PostgreSQL の試験を CI で回さない | — | 新しい置き場所の試験の確かさ |
| 会話の保存と取り直しの不具合が開いたまま | agent-memory#330 | 会話の取り込み（P8） |

## まとめ

型検査と CI の型・ビルドは整っている。一方、今回の取り組みの中心（外へ出さない・別の役割の席への引き継ぎ・顧客ごとの区切り・共通基盤の DB に置く形）は、今の版では形になっていない。PostgreSQL の試験が CI に無いので、新しい置き場所で動くことは手元の試験でしか確かめられない。
