# 技術の組み合わせ — Kusabi（agent-memory）

版は package.json と package-lock.json（lockfileVersion 3）から読んだ。依存のつながりは dependencies.md を参照。

| 種類 | 物 | 版 | 用途 |
|---|---|---|---|
| 言語 | TypeScript（strict、ESM） | 5.9.3（devDependencies `^5.7.0`） | すべての source。target ES2022、module ESNext、moduleResolution bundler |
| 実行の環境 | Node.js | `engines.node >=20.0.0` | CI は 18・20・22 で回す（下の注意） |
| TS をそのまま動かす | tsx | 4.21.0 | 試験と開発の起動（`npm test`・`npm run dev`） |
| MCP | @modelcontextprotocol/sdk | 1.32.2 | MCP サーバー（stdio） |
| 入力の確かめ | zod | 4.6.7 | MCP の道具の引数 |
| JSON Schema | ajv・ajv-formats | 8.20.0・3.0.1 | `recovery-pack/v1`・`host-invocation-context/v1` の確かめ（2020-12） |
| DB（本番） | PostgreSQL 16 ＋ pgvector、pg | pg 8.20.0 | 社内の記憶の DB。docker-compose.yml は `pgvector/pgvector:pg16` |
| DB（OSS の既定） | SQLite（sql.js、WASM） | 1.14.1 | `~/.agent-memory/memory.db` |
| DB（簡易） | JSON ファイル | — | `~/.agent-memory/` |
| ID | uuid | 11.1.1 | 記録の ID |
| 埋め込み（任意） | Voyage AI（`voyage-3-lite`、512 次元） | HTTP を直接 | PostgreSQL の意味検索 |
| 運用の道具 | bash、node の mjs、tmux、git | — | scripts/、Codex の tmux の helper、commit の読み取り |
| 席の CLI（相手） | Claude Code・Codex・Gemini CLI・Antigravity CLI | 契約の版 2.1.220・0.144.2・0.38.2・1.1.12（各 adapter の定数） | hook と MCP の相手 |
| 型 | @types/node・@types/pg・@types/sql.js・@types/uuid | 22.19.15 ほか | 開発だけ |

## 注意

- Node の版の食い違い: `engines` は 20 以上だが、.github/workflows/ci.yml の matrix は 18・20・22 のまま。workflow は保護面なので、直すなら Owner の決定が要る。
- 書式・静的検査の道具（Prettier・ESLint など）は入っていない。型検査（`tsc --noEmit`）だけ（team.md の決まり）。
- 行の網羅率を測る道具（c8・nyc など）は入っていない。
