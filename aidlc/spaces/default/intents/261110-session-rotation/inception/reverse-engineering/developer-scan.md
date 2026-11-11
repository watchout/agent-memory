# 開発者の code scan — 261110-session-rotation

- 対象: repo agent-memory（package wasurezu = Kusabi）、snapshot の paths `./`、head a4a4d1ea5049d86142c4d065c3b42ce232c99f6b（branch kusabi/deps-advisory-upgrade-339）
- 読み方: Owner の選択どおり repo 全体を読み直した（full rescan）。深さは Minimal なので、会話の切り直しに関わる所を深く読み、ほかは浅く見た。試験・build・program は動かしていない。
- 9 つの文書の候補: `aidlc/spaces/default/intents/261110-session-rotation/.aidlc-engine/codekb-stage-agent-memory/`

## Developer Code Scan Results

### Scan Coverage

- **Analyzed deeply**:
  - package.json
  - tsconfig.json
  - .github/workflows/
  - docker-compose.yml
  - src/index.ts
  - src/recovery-quality.ts
  - src/boot.ts
  - src/claude-session-start.ts
  - src/codex-session-start.ts
  - src/session-start-auto-receive.ts
  - src/transcript-stop-capture.ts
  - src/claude-conversation-ingest.ts
  - src/codex-conversation-ingest.ts
  - src/claude-hook-installer.ts
  - src/codex-hook-installer.ts
  - src/recovery-context.ts
  - src/restart-pack.ts（形の確かめの関数 794〜1130 行は浅く）
  - src/constants.ts
  - src/continuity-analysis.ts
  - src/restart-prepare.ts
  - src/restart-cli.ts
  - src/restart-command-preflight.ts
  - src/claude-marker-controller.ts
  - src/context-window-resolution.ts
  - src/codex-context-measurement.ts
  - src/claude-start.ts
  - src/codex-start.ts
  - src/stores/index.ts
  - scripts/host-adapters/
  - docs/operations/HOST_CONTEXT_HEALTH_DESIGN.md
- **Skimmed only**:
  - src/gemini-session-start.ts、src/antigravity-session-start.ts、src/gemini-hook-installer.ts、src/antigravity-hook-installer.ts、src/gemini-conversation-ingest.ts、src/antigravity-conversation-ingest.ts（冒頭と定数）
  - src/kusabi-checkpoint-recovery.ts（型と consume の関数）、src/kusabi-fresh-session-fleet.ts（席の表と起動の関数）
  - src/post-tool-hook.ts、src/catch-up.ts、src/stores/types.ts（interface の一覧）、src/stores/pg-migrations.ts（表の一覧と末尾）、src/stores/pg-store.ts（selected pack の SQL）、src/stores/voyage.ts（冒頭）
  - src/ の残り（運用の観測と展開・席の実行の身元・秘匿処理など。冒頭の説明だけ）
  - tests/、scripts/ の残り（scripts/codex-memory-start.sh と scripts/test-context-health-wrappers.sh は冒頭）、templates/
  - docs/（docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md の §5〜§9、docs/operations/HOST_ADAPTERS.md の clear の記述、一覧）
  - .shirube/（.shirube/control-handoffs/CH-S3A-CODEX-CONTEXT-MEASUREMENT.yaml の冒頭、一覧）、.framework/（一覧）、.github/ の残り、.env.example（鍵の名前だけ）、AGENTS.md（project の部分の冒頭）、CLAUDE.md
- **Left out**:
  - dist/（build の出力）
  - node_modules/（依存）
  - .git/
  - AI-DLC の install と作業場: .claude/、aidlc/、.aidlc-version、.gitignore の AI-DLC の区画（`# BEGIN AI-DLC:gitignore` 〜 `# END AI-DLC:gitignore`）

### Packages Found

- wasurezu（Kusabi、agent-memory）— npm の package 1 つ — TypeScript（ESM）— 席の記憶の MCP サーバーと、各 CLI の hook・launcher・運用の道具の CLI（bin 19、行き先 17）

### Build System

- **Type**: npm ＋ tsc（`npm run build` = `rm -rf dist && tsc`、出力は dist/）。試験と開発は tsx で TS をそのまま動かす
- **Config Files**: package.json、package-lock.json（lockfileVersion 3）、tsconfig.json（strict、ES2022、ESNext、bundler、`src/test*.ts` は build から除く）、docker-compose.yml（PostgreSQL 16 ＋ pgvector を手元で）
- **Build Dependencies**: package は 1 つで、package の間の依存は無い

### APIs Discovered

- MCP（stdio）— src/index.ts — 道具 17
- CLI — package.json の bin — 19（`wasurezu-restart` は prepare・fetch・preflight の 3 つ）
- host の hook — SessionStart 4 種（Claude Code・Codex・Gemini・Antigravity）、Stop と UserPromptSubmit 2 種（Claude Code・Codex）
- 形の決まった成果物 — docs/design/schemas/ — `recovery-pack/v1`・`host-invocation-context/v1` ほか
- 詳細は api-documentation.md

### Frameworks & Libraries

- @modelcontextprotocol/sdk — 1.32.2 — MCP サーバー
- zod — 4.6.7 — 道具の引数の確かめ
- pg — 8.20.0 — PostgreSQL
- sql.js — 1.14.1 — SQLite（WASM、OSS の既定）
- ajv・ajv-formats — 8.20.0・3.0.1 — JSON Schema の確かめ
- uuid — 11.1.1 — ID
- typescript — 5.9.3、tsx — 4.21.0 — build と試験の実行
- Voyage AI（HTTP を直接）— 任意 — PostgreSQL の埋め込み

### Test Coverage

- **Test Directories**: src/test*.ts（39）、tests/gate0/（3）、tests/spec-enforcement/（1）
- **Test Frameworks**: 自前の tsx の script（自前の `assert`）。試験の枠組みは無い
- **Coverage Config**: absent（c8・nyc などが無い）

### Code Quality Indicators

- **Linting**: 無し。`tsc --noEmit`（strict）だけ（team.md の決まり）
- **CI/CD**: .github/workflows/ci.yml（Node 18・20・22 で型検査・build・試験）、.github/workflows/shirube-rapid-lite-gates-report.yml（PR の門）
- **Documentation**: README・CLAUDE.md・AGENTS.md、設計の正本 docs/design/core/SSOT-2〜7、運用の文書 docs/operations/（25）。各 file の冒頭に役目と境界の説明がある

### Technical Debt Signals

- 800 行を超える試験でない file が 13（最大は src/kusabi-direct-fleet-rollout.ts の 2,036 行）。team.md の「7 つ」と数が合わない
- 知識の重複（標準 S3）: 使用率の帯の閾値（src/restart-prepare.ts:386-389 と src/context-window-resolution.ts:45）、確かさの重みと境（src/restart-pack.ts:739・743 と src/restart-prepare.ts:239・353）
- 4 つの hook の installer がほぼ同じ形の写し（標準 S2 の候補）
- 核で時計を読む（標準 S4）: src/restart-prepare.ts:164、src/recovery-context.ts:62
- 作業者の home の下の絶対 path の固定: src/claude-start.ts:239・279、src/codex-start.ts:107、src/kusabi-fresh-session-fleet.ts、scripts/post-tool-hook.sh ほか
- 決定の食い違いの検出（src/continuity-analysis.ts）は英語の語の正規表現だけで、日本語の決定は拾わない
- TODO AM-026 が src/stores/pg-store.ts に 4 か所
- 表の変更に戻す手順が無い（src/stores/pg-migrations.ts、標準 S6）
- Node の版: `engines` は 20 以上、CI は 18 も回す
- 詳細は code-quality-assessment.md

## Handoff Summary

- **Intent-relevant finding**:
  1. 作り直した会話で同じ席が続きから動く経路は、Claude Code・Codex ともに今の部品だけで成り立つ形になっている。SessionStart の口は `clear`・`compact` も受け（src/claude-session-start.ts:56、src/codex-session-start.ts:42）、installer の matcher も `startup|resume|clear|compact`（src/claude-hook-installer.ts:22、src/codex-hook-installer.ts:27）。hook の command に `agent_id`・`project`・`workspace` が固定されるので、作り直した後も同じ席・同じ案件の記録で回復の束（最大 1,800 token・8,192 byte）を返す。
  2. 各回の会話は Stop と UserPromptSubmit の hook で DB に入る（src/transcript-stop-capture.ts、末尾 4 MiB は :32、`async: true` は src/claude-hook-installer.ts:285・src/codex-hook-installer.ts:293）。
  3. 「一定量」を測って切り直しを起こす本番の経路は無い。帯の判定（src/context-window-resolution.ts）と Codex の量の読み取り（src/codex-context-measurement.ts）は src/test.ts からしか呼ばれない。Claude Code の量の読み取りは無い（式が src/codex-context-measurement.ts の説明にあるだけ）。.shirube/control-handoffs/CH-S3A-CODEX-CONTEXT-MEASUREMENT.yaml は、Stop の hook への組み込み（S3b）と `restart_events` の表（OG-CTXR-01）を Owner の門の先に置いている。
  4. 作り直しの判定は src/restart-prepare.ts:368-410 の `contextSignalFor` と `actionFor`（0.70 prepare・0.80 warn・0.90 recommend・0.95 require）。数は呼び手が渡す。自動で作り直すのは AUN 不在の確認・hook か監督・事前の許可の 3 つがそろう時だけ（`autoRestartBlockersFor`、SSOT-6 §6）。
  5. 新しい会話の起動: Claude Code は src/claude-start.ts の `--fresh-session`（`--settings` で SessionStart に dist/boot.js を付け、src/boot.ts:84 が `AGENT_MEMORY_BOOT_MODE=restart_pack` の時に準備した束を consume）。Codex は src/codex-start.ts の `--fresh-session`（`codex exec --json -` に stdin、:648・:465）で対話の画面ではない。対話の画面の Codex は `--launch`（束を引数で渡す）か、tmux の helper（`/exit` を送って起こし直す。scripts/host-adapters/codex-tmux-restart.sh）。コードの中に、動いている会話を作り直す（`/clear` を打つ・kill する）仕組みは無く、証拠にはその効果を 0 と記録する。
- **Risks / follow-up**:
  - 起動の口が 2 本ある: native の口（src/claude-session-start.ts:275、src/codex-session-start.ts:791）は準備した束（selected pack）を使わず、毎回 DB から新しく束を作る。束を consume するのは src/boot.ts だけ。設計の段で「どちらの口で戻すか」を決める必要がある。
  - 非同期の Stop と作り直しの順: 最後の応答の取り込み（async）が終わる前に新しい会話の SessionStart が束を作ると、最後の応答が束に入らない恐れがある（コードからの推測で、動かして確かめていない）。
  - Codex の窓の大きさ: model の表の `gpt-5.6-sol` は空（src/context-window-resolution.ts:41）。transcript の `model_context_window`（host の報せ）か環境変数で渡さないと判定は `unknown`。
  - 閾値と確かさの重みが 2 か所に literal（上の Technical Debt Signals）。切り直しの判定を足すなら 1 か所に寄せる必要がある（標準 S3）。
  - 「続きから動いた」の測り: 続けたかの印は MCP の `recover_context` の後だけ付く（src/index.ts:457）。hook で戻した時は `first_context_delivery_confirmed: false` のまま（src/claude-session-start.ts:324）。成功の判定に使う観測を別に決める必要がある。
  - 既定の path が別の checkout（`~/Developer/agent-memory`）を指す（src/claude-start.ts:239・279、src/codex-start.ts:107）。この作業場で作る版を使うには runtime の根を明示する必要がある。
  - 資格情報と process の引数: src/codex-start.ts:516 は `DATABASE_URL` を `-c` の引数で codex に渡す。`--launch` は束を引数に載せる（既知の危険として説明の文にある）。
  - 取り込みの重さ: 1 行ごとに `getRawEvents`（1,000 件まで）と書き込み 2 回（src/claude-conversation-ingest.ts:201-212、src/codex-conversation-ingest.ts:259-270）。作り直しが要るほど長い会話ほど、Stop の hook（9 秒、fail-open）で黙って取りこぼす恐れがある。
  - 保護面: 作り直しの印の置き場を新しい表や `kusabi_runtime_events.event_type` の追加で作ると DB の作りの変更（Owner の決定）。今ある置き場は `selected_restart_packs.metadata` と `recovery_quality_log.notes`。各席の hook の設定を変えて配るのは席の展開、CI に試験を足すのは workflow の変更で、どちらも保護面。
  - 試験: src/test-transcript-stop-capture.ts は CI に無く、src/test-kusabi-checkpoint-recovery.ts・src/test-kusabi-fresh-session-fleet.ts はどこからも呼ばれない。網羅率の道具も無く、team.md の 100% の床は今の CI では測れない。
  - 外の API: PostgreSQL の時、鍵があれば記録の文を Voyage AI に送る（src/stores/voyage.ts）。project.md の Forbidden と食い違うので、`AGENT_MEMORY_DISABLE_EMBEDDINGS=1` を保つ必要がある。
