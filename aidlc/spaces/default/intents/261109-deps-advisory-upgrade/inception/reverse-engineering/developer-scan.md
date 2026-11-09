# 今のコードの読み解き — 依存の版上げの範囲（focused scan）

- 対象: このリポジトリ（agent-memory、パッケージ名 wasurezu 0.3.0）。取り組み 261109-deps-advisory-upgrade（Issue #339 の本番の依存の既知の勧告への版上げだけ）
- 読み方: 前の取り組み（261021-facility-ax-memory）のコードの知識が今のコードと同じと確かめた（CURRENT）。owner の答え（Focused scan）で、版上げに関わる所を足して読んだ。テスト・ビルド・プログラムは動かしていない。
- 読んだ時点のコミット: ee2acff9dcb83b773969d0df9d8a7884728bef67（GitHub の main と同じ）
- 進め方: 別の担当は立てず、この会話が開発者の役として読んだ（この作業場では Agent の道具が使えない設定）。

## Developer Code Scan Results

### Scan Coverage

- **Analyzed deeply**:
  - package-lock.json（依存の木。MCP SDK・zod・SDK の下の部品の版を lock から抜き出して読んだ）
  - src/test-memory-source.ts
  - src/test-recovery-context.ts
  - src/test-recovery-scope.ts
  - 前の取り組みで深く読んだ 18 ファイル（src/index.ts・src/stores/types.ts・src/stores/index.ts・src/stores/knowledge-scope.ts・src/stores/pg-migrations.ts・src/stores/voyage.ts・src/kusabi-partitions.ts・src/kusabi-runtime-identity.ts・src/recovery-context.ts・src/recovery-quality.ts・src/boot.ts・src/memory-source.ts・package.json・tsconfig.json・.github/workflows/ci.yml・docker-compose.yml・.env.example・docs/design/core/SSOT-7_RUNTIME_AGENT_BINDING.md）は、今のコードと同じと確かめて引き継いだ
- **Skimmed only**:
  - src/test.ts（import の行と、試験の中の HTTP の server（`node:http` の fixture、4160〜4200 行付近）だけを読んだ）
  - 前の取り組みで浅く見た所（src/stores/pg-store.ts ほか）
- **Left out**:
  - node_modules/（依存の置き場。.gitignore の対象。この作業場には無い）
  - dist/（ビルドの出力。.gitignore の対象）
  - .claude/・aidlc/（AI-DLC の導入物）

### Packages Found

- wasurezu（別名 kusabi・agent-memory）— MCP サーバーと周辺のコマンド群 — TypeScript（ESM）— 席に、圧縮や再起動を越えて残る記憶を渡す

### Build System

- **Type**: npm と TypeScript コンパイラ（tsc）。依存は package.json の範囲指定（`^`）と package-lock.json（lockfileVersion 3）で決まる
- **Config Files**: package.json、package-lock.json、tsconfig.json
- **Build Dependencies**: 単一パッケージ

### APIs Discovered

- MCP の道具（stdio）— src/index.ts — 本番は `@modelcontextprotocol/sdk/server/mcp.js` の McpServer と `server/stdio.js` の StdioServerTransport だけを使う。HTTP で待ち受ける本番の道のりは無い
- 試験の MCP の client — src/test.ts・src/test-memory-source.ts・src/test-recovery-context.ts・src/test-recovery-scope.ts — `client/index.js` の Client と `client/stdio.js` の StdioClientTransport で `dist/index.js` を起動し、道具を呼ぶ
- 試験の中の HTTP の server — src/test.ts — `node:http` の createServer。外へ通信しないことを確かめる fixture で、SDK の HTTP の部品は使わない

### Frameworks & Libraries

- @modelcontextprotocol/sdk — 宣言 ^1.12.1 / lock 1.28.0 — MCP サーバー（本番）と MCP の client（試験）
- zod — 宣言なし / lock 4.3.6（SDK の依存 `^3.25 || ^4.0`）— src/index.ts が直接読み込む
- SDK の下の HTTP 系の部品 — express 5.2.1・body-parser 2.2.2・proxy-addr 2.0.7・express-rate-limit 8.3.1・hono 4.12.9・@hono/node-server 1.19.11 ほか — どれも本番の依存（dev でない）として入るが、本番の道のりでは使わない
- fast-uri 3.1.2（ajv の依存）、zod-to-json-schema 3.25.2、cross-spawn 7.0.6
- 本番の直接の依存（ほか）: ajv ^8.20.0・ajv-formats ^3.0.1・pg ^8.13.0・sql.js ^1.14.1・uuid ^11.1.0。開発用: @types/*・tsx ^4.19.0・typescript ^5.7.0

### Test Coverage

- **Test Directories**: src/test*.ts、tests/gate0/、tests/spec-enforcement/
- **Test Frameworks**: 専用の枠組みは使わず、tsx で直接動かす自前のスクリプト。MCP の試験は SDK の client で server を起動して確かめる
- **Coverage Config**: 無い（team.md の Testing Posture は行の網羅率 100% を床にする）

### Code Quality Indicators

- **Linting**: 無い。型検査は CI の `tsc --noEmit`
- **CI/CD**: .github/workflows/ci.yml（Node 18・20・22）
- **Documentation**: 前の取り組みの読み解きのまま

### Technical Debt Signals

- 依存を範囲指定（`^`）で宣言し、宣言と lock の版が離れている（SDK ^1.12.1 と lock の 1.28.0）
- zod を直接読み込むのに package.json に宣言が無い（SDK の依存として入るだけ）
- MCP SDK が、本番で使わない HTTP 系の部品を本番の依存に連れてくる（勧告の対象になる）

## Handoff Summary

- **Intent-relevant finding**: Issue #339 の勧告の対象の部品（proxy-addr・body-parser・express-rate-limit・hono・fast-uri ほか、zod）は、MCP SDK 1.28.0 の下の本番の依存として package-lock.json に入っている。本番の server は SDK の stdio の部品だけを使い（src/index.ts 2〜3 行目）、HTTP で待ち受ける道のりは本番に無い。HTTP の server は試験の `node:http` の fixture だけ（src/test.ts 16 行目・4170 行付近）。zod は src/index.ts 4 行目で直接読み込むが宣言が無い。
- **Risks / follow-up**: (1) 直す先の版は、依存を入れた状態で `npm audit fix --dry-run` と各勧告の直った版で決める必要がある。この作業場には node_modules が無く、まだ確かめていない。(2) SDK の版を上げると、MCP の試験（client と server の両方）が変化を確かめる。今の試験が通るかは動かしていないので分からない。(3) zod を宣言に足すかは、範囲指定をやめて固定する方針と合わせて要件の段で決める。(4) 行の網羅率 100%（team.md）は、今の Kusabi では測っていない。
