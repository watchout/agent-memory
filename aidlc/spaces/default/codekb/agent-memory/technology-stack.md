# 使っている技術 — Kusabi（agent-memory）

## 言語と実行環境

| 項目 | 中身 | 出所 |
|------|------|------|
| 言語 | TypeScript（ESM、strict） | tsconfig.json |
| 出力の型 | ES2022 | tsconfig.json |
| 実行環境 | Node.js 20 以上（CI は 18・20・22） | package.json の engines、.github/workflows/ci.yml |

## 枠組みとライブラリ

| 名前 | 版（宣言 / lock の解決） | 使い道 |
|------|------------------------|--------|
| @modelcontextprotocol/sdk | ^1.12.1 / 1.28.0 | 本番は MCP サーバー（`server/mcp`・`server/stdio` の stdio だけ）。試験は MCP の client（`client/index`・`client/stdio`）で `dist/index.js` を起動して道具を呼ぶ |
| zod | 宣言なし / 4.3.6（MCP SDK の依存 `^3.25 \|\| ^4.0` で入る） | 道具の入力の検証（`src/index.ts` が直接読み込む） |
| pg | ^8.13.0 | PostgreSQL の接続 |
| sql.js | ^1.14.1 | SQLite（WebAssembly、file に書き出す） |
| ajv・ajv-formats | ^8.20.0・^3.0.1 | JSON Schema の検証（決まった形の出力） |
| uuid | ^11.1.0 | 識別子 |

## 保存の技術

| 技術 | 使い道 |
|------|--------|
| SQLite（sql.js） | 既定の置き場。`~/.agent-memory/memory.db` |
| PostgreSQL | 本番の置き場。docker-compose.yml の手元の環境は pgvector/pgvector:pg16 |
| pgvector | 埋め込みの列（vector(512)）と hnsw の索引 |
| Voyage AI | 埋め込みを作る外の API（voyage-3-lite） |

## 開発とビルドの道具

| 名前 | 版 | 使い道 |
|------|----|--------|
| typescript | ^5.7.0 | 型検査とビルド |
| tsx | ^4.19.0 | 開発と試験の時に TypeScript を直接動かす |
| @types/node・@types/pg・@types/sql.js・@types/uuid | ^22.0.0・^8.11.0・^1.4.11・^10.0.0 | 型の定義 |
| GitHub Actions | — | CI（.github/workflows/ci.yml） |

書式・静的検査の道具は入っていない（code-quality-assessment.md を参照）。
