# 今のコードの読み解き — 開発者の読み取り結果

- 対象: このリポジトリ（agent-memory、パッケージ名 wasurezu 0.3.0、別名 Kusabi）
- 読み方: コードの知識の置き場は空だった（初回）。全体は浅く見て、今回の取り組み（席の記憶を自社か顧客の DB に保ち、どの席も続きから再開できる）に関わる所を深く読んだ。テスト・ビルド・プログラムは動かしていない。
- 読んだ時点のコミット: ee2acff9dcb83b773969d0df9d8a7884728bef67
- 進め方: owner の指示で、別の担当は立てず、この会話が開発者の役として読んだ。

## Developer Code Scan Results

### Scan Coverage

- **Analyzed deeply**:
  - src/index.ts
  - src/stores/types.ts
  - src/stores/index.ts
  - src/stores/knowledge-scope.ts
  - src/stores/pg-migrations.ts
  - src/stores/voyage.ts
  - src/kusabi-partitions.ts
  - src/kusabi-runtime-identity.ts
  - src/recovery-context.ts
  - src/recovery-quality.ts
  - src/boot.ts
  - src/memory-source.ts
  - package.json
  - tsconfig.json
  - .github/workflows/ci.yml
  - docker-compose.yml
  - .env.example
  - docs/design/core/SSOT-7_RUNTIME_AGENT_BINDING.md
- **Skimmed only**:
  - src/stores/pg-store.ts（埋め込みと agent_messages の箇所だけ読んだ）
  - src/stores/sqlite-store.ts・src/stores/json-store.ts（置き場所の既定値だけ読んだ）
  - src/codex-session-start.ts・src/gemini-session-start.ts（冒頭だけ読んだ）
  - src/ のほかのファイル（ファイル名と行数だけ見た。起動の口・会話の取り込み・展開と観測・評価の各ファイル）
  - tests/（ファイル名だけ見た）
  - docs/design/core/SSOT-4_DATA_MODEL.md（見出しだけ読んだ）
  - docs/（フォルダの並びだけ見た）
  - scripts/・templates/・.shirube/・.framework/（ファイル名と行数だけ見た）
- **Left out**:
  - node_modules/（依存の置き場。.gitignore の対象）
  - dist/（ビルドの出力。.gitignore の対象）
  - .claude/・aidlc/（AI-DLC の導入物）

### Packages Found

- wasurezu（別名 kusabi・agent-memory）— MCP サーバーと周辺のコマンド群 — TypeScript（ESM）— 席（AI のエージェント）に、圧縮や再起動を越えて残る記憶を渡す

### Build System

- **Type**: npm と TypeScript コンパイラ（tsc）。開発時は tsx で直接動かす
- **Config Files**: package.json、package-lock.json、tsconfig.json（src/ を dist/ に出す。src/test*.ts はビルドから外す）
- **Build Dependencies**: 単一パッケージ。内部のパッケージ間の依存は無い

### APIs Discovered

- MCP の道具（stdio）— src/index.ts — 17 個: log_decision・get_decisions・supersede_decision・save_task_state・search_memory・read_memory_source・recover_context・restart_pack・restart_pack_fetch・restart_prepare・set_recovery_config・save_knowledge・get_knowledge・supersede_knowledge・update_knowledge_status・ingest_conversation_events・catch_up
- コマンド（bin）— package.json — 19 個: kusabi・wasurezu・agent-memory（MCP サーバー）と、Claude Code・Codex・Gemini・Antigravity ごとの起動の口と hook の入れ方、会話の後追いの取り込み、展開、状態の表示、再起動など
- 席の起動時の hook — src/boot.ts（Claude Code の SessionStart）、src/codex-session-start.ts、src/gemini-session-start.ts、src/antigravity-session-start.ts、src/claude-session-start.ts — 起動した席の最初の文脈に回復の内容を差し込む
- 外への呼び出し — src/stores/voyage.ts — Voyage AI の埋め込みの API（https://api.voyageai.com/v1/embeddings）

### Frameworks & Libraries

- @modelcontextprotocol/sdk — ^1.12.1 — MCP サーバー
- pg — ^8.13.0 — PostgreSQL の接続
- sql.js — ^1.14.1 — SQLite（WebAssembly）
- ajv・ajv-formats — ^8.20.0・^3.0.1 — JSON Schema の検証
- uuid — ^11.1.0 — 識別子
- zod — package.json には無い（MCP SDK の依存として入る）— 道具の入力の検証。src/index.ts が直接読み込む
- 開発用: typescript ^5.7.0、tsx ^4.19.0、@types/*

### Test Coverage

- **Test Directories**: src/test*.ts（約 36 ファイル、最大は src/test.ts の 5,410 行）、tests/gate0/（3 ファイル）、tests/spec-enforcement/（1 ファイル）
- **Test Frameworks**: 専用のテストの枠組みは使っていない。tsx で直接動かす自前のスクリプト
- **Coverage Config**: 無い

### Code Quality Indicators

- **Linting**: 書式・静的検査の設定は無い（ESLint・Prettier などの設定ファイルが無い）。型検査は CI の `tsc --noEmit`
- **CI/CD**: .github/workflows/ci.yml（Node 18・20・22 で型検査・ビルド・テスト。PostgreSQL のテストは CI から外している）、.github/workflows/shirube-rapid-lite-gates-report.yml
- **Documentation**: README・CONTRIBUTING・SECURITY・CHANGELOG がある。設計は docs/design/core/ の SSOT-2〜7 と docs/design/ の契約文書

### Technical Debt Signals

- 外への送り出し: PostgreSQL を使う時、決定・作業の状態・知識を足すたびに、その文を Voyage AI に送って埋め込みを作る（src/stores/pg-store.ts 92 行目・202 行目付近、src/stores/voyage.ts）。鍵は環境変数のほか `~/.agent-com-api-keys` からも読む。止める設定（`AGENT_MEMORY_DISABLE_EMBEDDINGS=1`）はある
- 置き場の名前の区切りが無い: PostgreSQL の表は既定の場所（schema の指定なし）に作る（src/stores/pg-migrations.ts）。共通基盤の DB に製品ごとの置き場を分けて入れる形にはなっていない
- DB の作りの変更は前に進む向きだけ: 戻す手順（down）が無い（src/stores/pg-migrations.ts）。AM-023 の変更は重複した作業の状態を消し、別の表（task_state_migration_archive）に残す
- 席をまたぐ読み書きの確かめが無い道具: set_recovery_config は任意の agent_id の設定を書き換えられる（src/index.ts 666 行目付近）
- ほかの製品の表を読む: 同じ DB に agent-comms の agent_messages 表があれば、回復の時にそれを読む（src/stores/pg-store.ts 595 行目付近）
- 大きいファイル: kusabi-direct-fleet-rollout.ts 2,036 行、sqlite-store.ts 1,878 行、kusabi-fleet-rollout.ts 1,846 行、pg-store.ts 1,533 行、restart-pack.ts 1,255 行、codex-session-start.ts 1,056 行、index.ts 1,013 行。このリポジトリの決まり（最大 800 行）を超える
- 書式・静的検査が無い、テストの網羅率を測っていない、PostgreSQL のテストを CI で回していない
- 宣言の無い直接の依存: zod
- TODO などの印: src/stores/pg-store.ts に 4 件（いずれも AM-026「catch_up_log 表を PostgreSQL 側に作る」。PostgreSQL では catch_up の重複の見張りの記録が無い）

## Handoff Summary

- **Intent-relevant finding**: 今の記憶の境目は「agent_id（席の役割の名前）＋案件（project）」で、すべての読み書きに agent_id の条件が付く（src/stores/knowledge-scope.ts 44 行目「The caller always adds agent_id」、src/memory-source.ts 63〜71 行目）。同じ agent_id のまま Codex から Claude Code に替わる「同じ役割の席の種類の交代」は設計どおりに続きから読める（docs/design/core/SSOT-7_RUNTIME_AGENT_BINDING.md 第 3 節）。一方、別の役割の席が仕事を引き継ぐ形は、設計に「明示の引き継ぎの要約を受け取る側の agent_id か、将来の共有の引き継ぎ表に置く」とあるだけで（同 第 7 節）、引き継ぎの表も道具も無い。共通基盤の登録との結びつきも「計画中（#147）」（同 第 6 節）。
- **Risks / follow-up**: (1) PostgreSQL の時、記憶の文が Voyage AI に送られうる。意図の文書の条件（自社か顧客の DB の中で完結）と食い違うので、要件の段階で扱う必要がある。(2) 表が既定の場所にあり、共通基盤の DB に Kusabi の置き場を分けて入れる作りになっていない。(3) DB の作りの変更に戻す手順が無い（Shirube 開発規格の「戻せる形」と食い違う）。(4) set_recovery_config が任意の席の設定を書き換えられる（読み書きできる者の一覧の正しさに関わる）。(5) 回復の質の記録（recovery_quality_log）はあるが、意図の文書の「試験で取り出せる割合」を測る仕組みではない。(6) 顧客（利用者の組織）の層は「未実装、将来の固い境目」（docs/design/core/SSOT-7_RUNTIME_AGENT_BINDING.md 第 2 節の表）。今は顧客ごとの区切りが agent_id と DB の分け方にしか無い。
