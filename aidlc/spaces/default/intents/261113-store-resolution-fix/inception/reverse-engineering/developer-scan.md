# 受け渡しの scan — 保存先の決め方（261113-store-resolution-fix）

読んだ時点: 2026-11-15、commit `aa77b683e135beabb9fc54bd3736b47d288d6f46`（この作業場の branch は古いが、範囲の 43 本は origin/main `27d7f8fc9146e826883b045c1fdca93cc11f93e7` と byte 同一であることを `git show origin/main:<path>` との比較で確かめた）。範囲は Focused scan（Owner の委任 #49 6762288830）。コードを読んだだけで、試験・build・プログラムは動かしていない。`~/.agent-memory/` の下と環境変数の値は開いていない（名前だけをコードから写した）。

## Developer Code Scan Results

### Scan Coverage
- **Analyzed deeply**:
  - `package.json` — 全体
  - `tsconfig.json` — 全体
  - `.github/workflows/ci.yml` — 全体（77 行）
  - `src/stores/index.ts` — 全体（102 行）
  - `src/stores/read-only-task-states.ts` — 全体（165 行）
  - `src/codex-session-start.ts` — 1-130、190-545、790-1030 と grep（545-790 の証拠の組み立ては未読）
  - `src/transcript-stop-capture.ts` — 全体
  - `src/session-rotation-stop.ts` — 1-160、296-759（160-296 は未読）
  - `src/rotation-commit.ts` — 全体
  - `src/post-tool-hook.ts` — 全体
  - `src/claude-hook-installer.ts` — 100-629
  - `src/kusabi-runtime-event-emitter.ts` — 1-130、200-794（130-200 の event の組み立ては未読）
  - `src/test-kusabi-runtime-event-emitter.ts` — 1-70、215-538 と grep（70-215 の補助関数は未読）
- **Skimmed only**（保存先の決め方に関わる所だけ読んだ、または語を数えただけ）:
  - `src/stores/sqlite-store.ts` — `DEFAULT_DB_PATH`・`resolveSqliteDbPath`・constructor・`initialize()` の冒頭（54-58、358-453）
  - `src/stores/pg-store.ts` — constructor と `initialize()`（68-88）
  - `src/stores/json-store.ts` — `DEFAULT_DATA_DIR`・constructor・`initialize()` を grep
  - `src/claude-session-start.ts` — 270-420（`loadClaudeRecoveryFromStore` と呼び出しの前後）と grep
  - `src/gemini-session-start.ts`・`src/antigravity-session-start.ts` — 呼び出しの前後（502-503、213-214）と grep
  - `src/codex-hook-installer.ts` — 170-320 と grep（command の組み立てと Stop の組）
  - `src/boot.ts`（1-80）、`src/index.ts`（30-110）、`src/restart-cli.ts`（240-330）、`src/kusabi-fleet-status-cli.ts`（35-74）、`src/claude-start.ts`（365-385）、`src/codex-start.ts`（250-270） — createStore の呼び出しの前後だけ
  - `.github/workflows/shirube-rapid-lite-gates-report.yml` — 冒頭 60 行と step の名前
  - `src/test.ts` — 保存先を選ぶ試験（1585-1645）と grep
  - `src/test-post-tool-hook.ts`（140-185）、`src/test-transcript-stop-capture.ts`（1-60、105-140）、`src/test-claude-session-start.ts`（352-392） — 環境の渡し方の前後と grep
  - grep だけ（`resolveCodexStoreBinding`・`config.json`・`database_url`・`AGENT_MEMORY_DB_TYPE`・`DATABASE_URL`・`HOME` の件数）: `src/test-antigravity-session-start.ts`、`src/test-boot-recovery.ts`、`src/test-claude-hook-installer.ts`、`src/test-claude-transcript-identity.ts`、`src/test-codex-hook-installer.ts`、`src/test-codex-session-start.ts`、`src/test-gemini-hook-installer.ts`、`src/test-gemini-session-start.ts`、`src/test-handoff-commit-order.ts`、`src/test-handoff-commit-order-pg.ts`、`src/test-kusabi-fleet-status.ts`、`src/test-kusabi-fresh-session-fleet.ts`、`src/test-recovery-context.ts`、`src/test-rotation-hook-registration.ts`、`src/test-session-rotation-flow.ts`、`src/test-session-rotation-scenario.ts`、`src/test-session-rotation-status.ts`
  - 範囲の外だが開いた物（呼び出しの一覧と試験の有無を確かめるため。grep か短い読み）: `src/rotation-hook-registration.ts`（55-115）、`src/test-handoff-source-cli.ts`（355-385）、`src/test-session-rotation-core.ts`（295 の行）、`src/measure-kusabi-functional.ts`・`src/fleet-conversation-backfill.ts`・`src/kusabi-continuity-interruption-e2e.ts`・`src/kusabi-direct-fleet-rollout.ts`・`src/kusabi-fresh-session-fleet.ts`・`src/kusabi-functional-evaluator.ts`・`src/migrate.ts`（store の構築の行を grep）、`src/session-rotation-files.ts`（`AGENT_MEMORY_HOME` の行）
- **Left out**:
  - `src/stores/types.ts`、`src/stores/pg-migrations.ts`、`src/stores/voyage.ts`、`src/stores/knowledge-scope.ts`、`src/stores/raw-events.ts`、`src/stores/task-id.ts`、`src/stores/task-state-normalize.ts` — 開いていない（保存先の決め方に関わらない）
  - `dist/`、`node_modules/`、`.git/` — 手順の「読まない物」
  - `.claude/`、`.codex/`、`.kiro/`、`.cursor/`、`.opencode/`、`.aidlc/`、`aidlc/` — AI-DLC 自身の install（範囲の外）
  - `~/.agent-memory/`（保存先の設定・記録の DB）と環境変数の値 — 指示で開かない

### Packages Found
- `wasurezu`（作業場の名前は agent-memory、版 0.3.0） — 単一の package（`type: module`） — TypeScript（ESM、Node 20 以上） — MCP サーバー（stdio）と、席の CLI の hook・launcher・運用の CLI を 1 つの package に入れた物。`bin` は 19 個（一覧と行き先は api-documentation.md）

### Build System
- **Type**: npm scripts ＋ `tsc`（`npm run build` = `npm run clean && tsc`）。試験と開発の起動は `tsx`。bundler は無い
- **Config Files**: `package.json`、`tsconfig.json`（target ES2022、module ESNext、moduleResolution bundler、strict、outDir `dist`、rootDir `src`、declaration・sourceMap あり。`include` は `src/**/*`、`exclude` は `node_modules`・`dist`・`src/test*.ts`）
- **Build Dependencies**: 単一の package で、package 間の依存は無い。公開の版づくり（`scripts/build-kusabi-content-addressed-runtime-release.mjs`、範囲の外）は `dist` を元にする（名前だけ確認）

### APIs Discovered
- MCP の道具 — `src/index.ts` — 17（前回の読みの数。今回は数え直していない）。store は `createStoreReadiness(() => createStore({ skipPostgresMigrations: true }))`（`src/index.ts:53`）
- 保存先を決める・開く関数（内部の API） — `src/stores/index.ts` の `resolveStoreBackend`（35）・`createStore`（54）、`src/stores/read-only-task-states.ts` の `readTaskStatesReadOnly`（62）・`createReadOnlyTaskStateReader`（58）、`src/stores/sqlite-store.ts` の `resolveSqliteDbPath`（57）、`src/codex-session-start.ts` の `resolveCodexStoreBinding`（305）・`kusabiStoreBindingSha256`（281）
- hook の入口（CLI） — `claude-session-start`・`codex-session-start`・`gemini-session-start`・`antigravity-session-start`・`transcript-stop-capture`（5 つは `package.json` の `bin` にある）。`session-rotation-stop`・`post-tool-hook` は `bin` に無い（`dist/session-rotation-stop.js` を installer の command が path で呼ぶ）
- hook の command の形 — 下の「事実 4」

### Frameworks & Libraries
- `@modelcontextprotocol/sdk` — 1.32.2 — MCP サーバー
- `ajv` — 8.20.0・`ajv-formats` — 3.0.1 — JSON Schema の確かめ
- `pg` — 8.20.0 — PostgreSQL
- `sql.js` — 1.14.1 — SQLite（WASM、file に書き戻す）
- `uuid` — 11.1.1 — 記録の ID
- `zod` — 4.6.7 — MCP の引数の確かめ
- 開発: `typescript` ^5.7.0、`tsx` ^4.19.0、`@types/node` ^22.0.0、`@types/pg` ^8.11.0、`@types/sql.js` ^1.4.11、`@types/uuid` ^10.0.0
- 版は `package.json` の宣言（lockfile は範囲の外で読んでいない）

### Test Coverage
- **Test Directories**: `src/test*.ts`（今回の範囲に入る 22 本は上の Scan Coverage）、`tests/gate0/`・`tests/spec-enforcement/`（範囲の外。`ls` で名前だけ確認）
- **Test Frameworks**: 枠組みは無い。自前の tsx の script と `node:assert`（`src/test.ts` は自前の `assert`）。入口の確かめは `spawnSync` で process を起こす
- **Coverage Config**: 無し（`package.json` に c8・nyc などが無い）

### Code Quality Indicators
- **Linting**: 無し（`package.json` に ESLint・Prettier が無い）。型検査は `tsconfig.json` の `strict`。`tsconfig.json` の `exclude` に `src/test*.ts` があるので、`tsc --noEmit` と build は試験の file を型検査しない
- **CI/CD**: `.github/workflows/ci.yml`（Node 18・20・22 の matrix）と `.github/workflows/shirube-rapid-lite-gates-report.yml`（`pull_request_target` で門の報告）
- **Documentation**: `src/stores/index.ts:25-34` の doc comment が「選び方の順（4 段）」を書き、`resolveStoreBackend` を「The one place this is decided」と呼ぶ。README は範囲の外で読んでいない

### Technical Debt Signals
- 保存先を決める所が複数ある（`src/stores/index.ts:35`・`src/codex-session-start.ts:305`・`src/kusabi-runtime-event-emitter.ts:514`・`src/post-tool-hook.ts:26-45`）。入力・順番・失敗の時の動きがそれぞれ違う（下の「事実 1」の比べ表）。標準 S3（知識の重複）に当たる形
- `createStore` は env を引数に取らず `resolveStoreBackend()` を引数なしで呼ぶ（`src/stores/index.ts:55`）。config を読む `resolveCodexStoreBinding` は `process.env` を書き換えて `createStore` に URL を渡す（`src/codex-session-start.ts:378`）。この順序の依存はコードの中の規則として明記されていない
- Stop 側の証拠（`src/transcript-stop-capture.ts` の evidence、`src/session-rotation-stop.ts`、`src/rotation-commit.ts`）には `store_binding`・`binding_sha256`・`backend` の項目が無い（grep で 0 件）。SessionStart の証拠だけが持つ（`src/codex-session-start.ts:125、723、812、881`、`src/claude-session-start.ts:385`）
- `.github/workflows/ci.yml` の Node の matrix（18）と `package.json` の `engines.node`（20 以上）が食い違う
- 800 行を超える範囲の中のファイル: `src/stores/sqlite-store.ts` 1,883、`src/stores/pg-store.ts` 1,533、`src/codex-session-start.ts` 1,122、`src/index.ts` 1,017、`src/stores/json-store.ts` 907、`src/codex-start.ts` 809
- 既定の SQLite を開くと、無ければ folder と空の DB file を作る（`src/stores/sqlite-store.ts:368-373、446`）。成功と同じ見え方で、止まらない

## 5 つの事実

### 事実 1 — 決める部品の入力・順番・失敗の時（読んだ事実だけ）

| 観点 | `resolveStoreBackend` ＋ `createStore`（`src/stores/index.ts:35-100`） | `resolveCodexStoreBinding`（`src/codex-session-start.ts:305-387`） | `createQuietStore`（`src/kusabi-runtime-event-emitter.ts:514-546`） | post-tool-hook の読み込み（`src/post-tool-hook.ts:26-45`） |
|---|---|---|---|---|
| env の取り方 | `resolveStoreBackend(env = process.env)`。`createStore` は引数なしで呼ぶので常に `process.env`（55） | 引数 `env`（既定 `process.env`） | 引数 `env`（既定は emission の `options.env ?? process.env`。worker では `process.env`、462・617） | `process.env` を直接 |
| config file | 読まない | 読む。`~/.agent-memory/config.json` の `database_url` だけ（引数 `configPath` の既定、307） | 読まない | 読む。`database_url`・`agent_id`・`default_project`（28-36、49-50） |
| 種別 `AGENT_MEMORY_DB_TYPE` | `\|\| ""` を小文字に（36） | `?? ""` を小文字に（309） | `?? ""` を小文字に（516） | `\|\| ""` を小文字に（`DB_TYPE`） |
| URL の順 | `AGENT_MEMORY_DATABASE_URL \|\| DATABASE_URL`（37。空文字は次へ落ちる） | 同じ `\|\|`（324） | `AGENT_MEMORY_DATABASE_URL ?? DATABASE_URL`（517。空文字は次へ落ちない） | `DATABASE_URL` だけ。無ければ config の `database_url` を `DATABASE_URL` に入れる（`AGENT_MEMORY_DATABASE_URL` は見ない） |
| URL の形の判定 | `startsWith("postgres")`（38） | 正規表現 `/^postgres(?:ql)?:\/\//`（`postgresUrl`、278）。env の URL も config の URL も当てる | `startsWith("postgres")`（518） | 判定なし |
| 順番 | json → sqlite → （postgres 指定 または postgres の URL）→ 既定 SQLite | sqlite・json（env の証拠）→ 他の非空の種別は例外 → env の URL → config → 既定 SQLite | json は例外 → sqlite → （postgres 指定 または URL）→ 既定 SQLite | env の `DATABASE_URL` → config の `database_url`。種別が sqlite・json なら URL は要らない |
| 知らない種別（例 `mysql`） | 黙って既定 SQLite（URL が postgres で始まれば postgres）。`src/test-handoff-source-cli.ts` の T17(p) が `{AGENT_MEMORY_DB_TYPE:"mysql"}`→sqlite を表明している | 例外 `HookDegradedError("RECOVERY_UNAVAILABLE")`（320-321）。env の URL が postgres(ql):// でない時も同じ例外（326） | 黙って既定 SQLite（URL が postgres で始まれば postgres） | 種別が sqlite・json 以外なら URL を要求し、無ければ exit 0（43-46） |
| postgres 指定で URL が無い | 例外（43-47、文言 `requires AGENT_MEMORY_DATABASE_URL or DATABASE_URL`） | config が無い（ENOENT）時は例外（341-351）、config に `database_url` が無い時も例外（377） | 例外 `KUSABI_RUNTIME_EVENT_STORE_UNAVAILABLE`（523） | stderr に出して `exit(0)`（44-46） |
| json | `new JsonStore()`（63） | 証拠 `json`（env の出所） | 例外 `KUSABI_RUNTIME_EVENT_JSON_FIXTURE_ONLY`（520） | `needsUrl` が false なので `createStore` に任せる |
| config の URL が postgres でない | （config は読まない） | 例外（377） | （config は読まない） | 判定なし。`DATABASE_URL` に入れて `createStore` に渡る。postgres で始まらなければ既定 SQLite |
| config が壊れている・symlink・非 file | （config は読まない） | 例外（symlink と非 file は 353-354、parse の失敗と非 object は 359-364） | （config は読まない） | 黙って `{}` として進む（`loadConfig` の catch、32-34） |
| 失敗の時の動き | PG の接続が失敗したら再 throw。SQLite に逃げない（75-80） | 例外を hook が受けて degraded を返し、終了コード 0。store は開かない | 開けない・時間切れ・drift は緊急の 1 行（`store_unavailable`・`backend_drift`・`binding_drift`）か `failed`。別の保存先には逃げない | `exit(0)` で何もせず終わる |
| 副作用 | 無し（SQLite・JSON は開くと folder と file を作る） | config の URL を採った時だけ `env.AGENT_MEMORY_DATABASE_URL = configUrl`（378）。値は証拠に出さない | 無し | config の URL を採った時だけ `process.env.DATABASE_URL` に書く（38-40） |
| PG の表の変更 | `skipPostgresMigrations` が true の時は流さない（72） | 開かない | 常に流さない（`run_migrations: false`、536） | 呼び先の `createStore` が skip を true にする |

- 既定の SQLite の path は `AGENT_MEMORY_DB_PATH`、無ければ `~/.agent-memory/memory.db`（`resolveSqliteDbPath`、`src/stores/sqlite-store.ts:57-58`、`??` なので空文字はそのまま path になる）。証拠の `localStoreBindingSha256` は同じ値を `AGENT_MEMORY_DB_PATH || defaultPath` で数える（`src/codex-session-start.ts:288-296`、`||` は 296、空文字は既定に落ちる）。
- JSON の folder は `~/.agent-memory`（`DEFAULT_DATA_DIR`、`src/stores/json-store.ts:54`）。`createStore` は folder を引数に取らない。
- 読み取り専用の読み手 `readTaskStatesReadOnly` は `resolveStoreBackend(env)` と `resolveSqliteDbPath(undefined, env)` を使う（63・66）ので、`createStore` と同じ決め方に従う。config は読まない。SQLite の file が無い時は例外で、file は作らない（120）。
- `AGENT_MEMORY_HOME` は保存先の決め方に関わらない。回転の記録の置き場（`src/session-rotation-files.ts:127-128`）と hook の診断の置き場の決め方に使われる。
- 上の表の読み取り元になった env の名前: `AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`DATABASE_URL`・`AGENT_MEMORY_DB_PATH`。席の身元の既定には `AGENT_MEMORY_AGENT_ID`・`AGENT_MEMORY_PROJECT`・`AGENT_MEMORY_WORKSPACE`・`AGENT_MEMORY_BINDING_SOURCE_REF`、emission の目標には `KUSABI_RUNTIME_EVENT_TARGET_JSON`。

#### emitter の `createQuietStore`（範囲の追加分の事実）
- 3 つの部品のうち、どれも呼ばない。`resolveStoreBackend`・`createStore`・`resolveCodexStoreBinding` を使わず、`SqliteStore`・`PgStore` を直接作る（521-525）。決めるための入力は env の `AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`DATABASE_URL` だけ。config は読まない。
- PG の表の変更は常に流さない（`initialize({ run_migrations: false })`、536）。接続の確かめは残る。SQLite は `initialize()`（既定の path を作りうる）。
- 失敗の時: 開く途中の例外は `emitPreparedEvent` の catch が受け、`store_unavailable` の緊急の 1 行を書いて返す（464-472）。ほかの保存先には逃げない。開いた後に `store.backend` が目標と違えば `backend_drift`（486-491）。開く前にも、SessionStart の証拠の `backend_intent` と目標の `storage.backend`、`binding_sha256` と目標の値を比べ、違えば `backend_drift`・`binding_drift`（436-456）。
- worker の子 process は `{ ...process.env, ...options.env }` を受ける（358-359）。emission は SessionStart が回復の結果を出した後に起こるので、`resolveCodexStoreBinding` が `process.env` に書いた URL を子が受け継ぐ。emission の時間は 500 ms（23）。
- emitter を呼ぶのは 4 つの SessionStart（claude・codex・gemini・antigravity）だけ。Stop 側は呼ばない。

### 事実 2 — 呼び出し元の表

| # | 呼び出し元（file:行） | いつ動くか | 決める部品 | 渡す入力 | config.json を読むか | `skipPostgresMigrations` |
|---|---|---|---|---|---|---|
| 1 | `src/claude-session-start.ts:317-318` | Claude Code の SessionStart | `resolveCodexStoreBinding()` → `createStore` | env ＋ config（env への書き込みで URL が `createStore` に届く） | 読む | true |
| 2 | `src/codex-session-start.ts:832-833` | Codex の SessionStart | 同上 | 同上 | 読む | true |
| 3 | `src/gemini-session-start.ts:502-503` | Gemini の SessionStart | 同上 | 同上 | 読む | true |
| 4 | `src/antigravity-session-start.ts:213-214` | Antigravity の呼び出し前 | 同上 | 同上 | 読む | true |
| 5 | `src/transcript-stop-capture.ts:225` | Claude Code・Codex の Stop と UserPromptSubmit | `createStore` だけ | env のみ | 読まない | true |
| 6 | `src/session-rotation-stop.ts:546`（`withStore`） | Claude Code・Codex の Stop と UserPromptSubmit（保存すると決めた時だけ開く） | `createStore` だけ | env のみ | 読まない | true |
| 7 | `src/rotation-commit.ts:43`（`openDefaultStore`、62 の `consumeWithin` が使う） | Claude Code・Codex の SessionStart の process の中、回答を書いた後（`src/codex-session-start.ts:1085、1091`、`src/claude-session-start.ts:566`） | `createStore` だけ | env のみ。ただし同じ process なので 1・2 が書き換えた env を受ける | 読まない（間接に 1・2 の結果を受ける） | true |
| 8 | `src/kusabi-runtime-event-emitter.ts:514-546`（`createQuietStore`、worker の入口 617） | 4 つの SessionStart の後（emission、500 ms） | 自前の `createQuietStore`（3 つ目の写し） | env のみ（子は親の `process.env` を受ける） | 読まない | 流さない（`run_migrations: false`） |
| 9 | `src/post-tool-hook.ts:275、296` | Claude Code の PostToolUse（2 つの installer は登録しない。grep で 0 件） | 自前の config 読み ＋ `createStore` | env ＋ config の `database_url`（`DATABASE_URL` にだけ入れる） | 読む（`database_url`・`agent_id`・`default_project`） | true |
| 10 | `src/boot.ts:41` | 旧来の SessionStart（`npm run boot`、launcher が `--settings` で付ける） | `createStore` だけ | env のみ | 読まない | true |
| 11 | `src/index.ts:53` | MCP サーバーの起動（接続の後に開く、readiness） | `createStore` だけ | env のみ | 読まない | true |
| 12 | `src/claude-start.ts:379` | `wasurezu-claude-start`（launcher） | `createStore()` | env のみ | 読まない | 渡さない（流す） |
| 13 | `src/codex-start.ts:261` | `wasurezu-codex-start`（launcher） | `createStore()` | env のみ | 読まない | 渡さない（流す） |
| 14 | `src/restart-cli.ts:291` | `wasurezu-restart` の prepare・fetch | `createStore()` | env のみ | 読まない | 渡さない（流す） |
| 15 | `src/restart-cli.ts:249` | `wasurezu-restart` の handoff-source | `createReadOnlyTaskStateReader()` → `resolveStoreBackend(process.env)` | env のみ | 読まない | 該当しない（store を開かない。PG は READ ONLY の 1 回） |
| 16 | `src/kusabi-fleet-status-cli.ts:54` | `wasurezu-kusabi-fleet-status` | `createStore()` | env のみ | 読まない | 渡さない（流す） |

- 範囲の外で grep に出た構築: `src/measure-kusabi-functional.ts:297-299`（試験用の一時の 3 種の store）、`src/fleet-conversation-backfill.ts:264`（`new PgStore(options.database_url)`、引数で受ける URL）、`src/kusabi-continuity-interruption-e2e.ts:366-368`（設定で選ぶ 3 種）。`createStore`・`resolveStoreBackend`・`resolveCodexStoreBinding` を呼ばない。
- 「渡さない（流す）」は `createStore()` に option を渡さない呼び出しで、PostgreSQL の時に `PG_MIGRATIONS` の全部を流す（`src/stores/pg-store.ts:80-84`）。

### 事実 3 — Codex の Stop 側にも同じ食い違いがあるか

- ある。Codex の Stop と UserPromptSubmit に置かれる 2 つの command は、Claude Code と同じ host 共通の入口を呼ぶ。
  - `dist/transcript-stop-capture.js`（adapter `wasurezu-codex-transcript-stop`、`buildCodexTranscriptStopHookGroup`、`src/codex-hook-installer.ts:273`）→ `createStore({ skipPostgresMigrations: true })`（`src/transcript-stop-capture.ts:225`）。env のみ。
  - `dist/session-rotation-stop.js`（`buildRotationHookGroup`、`src/rotation-hook-registration.ts:61`。Codex の installer が `src/codex-hook-installer.ts:428-429` で Stop と UserPromptSubmit の両方に置く。Claude Code の installer も同じ関数で置く（`src/claude-hook-installer.ts:389、427-428`）。置くのは installer に `--rotation on` を渡した時だけで、渡さなければ既にある物をそのままにし、`--rotation off` で外す（`src/rotation-hook-registration.ts:2-8`、`RotationInstall`））→ `withStore`（`src/session-rotation-stop.ts:546`）。env のみ。
- どちらの入口も `resolveCodexStoreBinding` を呼ばず、`~/.agent-memory/config.json` を読まない（`src/transcript-stop-capture.ts`・`src/session-rotation-stop.ts` に config の参照が無い。`resolveCodexStoreBinding` は `src/` で 4 つの SessionStart の file だけが参照する）。
- `post-tool-hook` は Claude Code の PostToolUse の道具で、2 つの installer は登録しない（`PostToolUse` の語が 3 つの installer の file に無い）。自前で `~/.agent-memory/config.json` を読み、`DATABASE_URL` にだけ URL を入れる（上の表）。Codex 側には無い。
- `rotation-commit` は SessionStart の process の中で、回答を書いた後に動く（`src/codex-session-start.ts:1085、1091`、`src/claude-session-start.ts:566`）。それ以前に同じ process が `resolveCodexStoreBinding` を呼んで `process.env.AGENT_MEMORY_DATABASE_URL` を書き換えているので、`createStore` は config の URL を受ける。Gemini・Antigravity の SessionStart は `rotation-commit` を呼ばない。
- Stop 側の証拠は store を名指さない。`wasurezu-transcript-stop-capture/v1` の項目に `store_binding`・`binding_sha256`・`backend` が無い（`src/transcript-stop-capture.ts:240` から始まる evidence の項目。grep で 3 つの Stop 側 file に 0 件）。

### 事実 4 — 2 つの installer が hook に入れる command の形

- 形（Claude Code: `buildClaudeHookCommand`、`src/claude-hook-installer.ts:171-198`。Codex: `buildCodexHookCommand`、`src/codex-hook-installer.ts:173-200`）: `<node の絶対 path> <runtime>/dist/<入口>.js --adapter-id <id> --agent-id <席> --project <案件> --workspace <作業場> --binding-source-ref <参照> --max-tokens <n> --max-bytes <n> --timeout-ms <n> [--runtime-event-manifest <path>]`。回転の Stop は末尾に `[--rotation-threshold-tokens <n>]` が付く（`src/rotation-hook-registration.ts:61-100`）。
- 環境変数の接頭辞も `env` の項目も無い。保存先を指す引数（`--database-url`・`--store` など）も無い。config の path を渡す引数も無い。保存先に関わる値を command で渡す所は無い。
- 入口は `--adapter-id` の種類で決まる: SessionStart、transcript の Stop（`async: true`、`src/claude-hook-installer.ts:308`、`src/codex-hook-installer.ts:309`）、回転の Stop（`async` の指定が無い。installer に `--rotation on` を渡した時だけ置かれる）。待ちの上限は 3 つとも 9 秒（`CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS`・`CODEX_SESSION_START_HOOK_TIMEOUT_SECONDS`・`TRANSCRIPT_STOP_HOOK_TIMEOUT_SECONDS`・`ROTATION_STOP_HOOK_TIMEOUT_SECONDS` の定義）。
- installer は「byte で同じ形」の command だけを自分の物と見分ける（`parseClaudeHookCommand`・`parseCodexHookCommand` は語の数が 18 または 20 のときだけ受ける）。env の接頭辞や追加の引数がある command は、自分の物と見分けられず、そのまま残る。
- 置き場: Claude Code は `<workspace>/.claude/settings.json`、Codex は `<workspace>/.codex/hooks.json`。installer は設定の file に env の項目を足さない（grep で `env:` の書き込みが 0 件）。席が起動する時の環境変数（`AGENT_MEMORY_DB_TYPE` など）は、席の CLI を起こす側（tmux・launcher）が決める。それは今回の範囲の外で読んでいない。

### 事実 5 — 試験と CI

- **今ある試験で「3 つの hook が同じ保存先を使う」を確かめる物**: SessionStart の 3 つを同じ環境で起こして、同じ DB に記録が入ることを確かめる試験は 1 つある。`src/test-kusabi-runtime-event-emitter.ts` の CLI の試験（466-496）が codex・claude・gemini の SessionStart を `AGENT_MEMORY_DB_TYPE=sqlite` と `AGENT_MEMORY_DB_PATH` で起こし、その 1 つの DB に `session_start` の記録が 3 件入ることを見る。env だけで、config.json は使わず、Stop の hook は含まない。
- 次の物は無い（grep と読みで確かめた）:
  - SessionStart と rotation-stop と transcript-stop の 3 つが同じ保存先を選ぶことを確かめる試験
  - `~/.agent-memory/config.json` を作って保存先を確かめる試験（`src/test*.ts` と `tests/` の中で `config.json` が出るのは `src/test-post-tool-hook.ts:163` のコメント「Avoid loading config.json」と、保存先と無関係の名前だけ）
  - `resolveCodexStoreBinding` を名前で参照する試験（`src` と `tests` で参照するのは 4 つの SessionStart の source だけ）。SessionStart の試験は証拠の fixture（`source: "user_config"` の物、`src/test-claude-session-start.ts:84-87`、`src/test-gemini-session-start.ts:75-78`、`src/test-antigravity-session-start.ts:54-55`）を直接渡すか、実体の起動で `AGENT_MEMORY_DB_TYPE=sqlite` を渡して `source: "environment"` と `backend_intent: "sqlite"` を見る（`src/test-claude-session-start.ts:636、650-652`）
- `createStore` の選び方の試験は `src/test.ts:1594-1640`: 既定 SQLite、`AGENT_MEMORY_DB_TYPE=sqlite` が PG の URL に勝つこと、PG の URL で接続に失敗すると SQLite に逃げず止まること（`skipPostgresMigrations: true` の時も）。env だけ。`resolveStoreBackend` の表の試験とレーダーが同じ関数に従う試験は `src/test-handoff-source-cli.ts` の T17(p)（範囲の外）。
- Stop 側の試験: `src/test-transcript-stop-capture.ts` は `fakeStore`（`close` だけの偽物、28）と `JsonStore` の一時 folder を渡す。実体を起こす `realEntry`（111 から、env は 114）は `HOME` と `AGENT_MEMORY_HOME` だけを渡し、`AGENT_MEMORY_DB_TYPE` と URL は渡さない。回転の試験（`src/test-session-rotation-flow.ts:149`）は `createStore` を偽物に差し替える。`src/test-session-rotation-scenario.ts:18` は `AGENT_MEMORY_DB_TYPE=json` と一時の `HOME`。
- CI（`.github/workflows/ci.yml`）が回す物: Node 18・20・22 の matrix、`npm ci`、`npx tsc --noEmit`、`npm run build`、`npx tsx src/test.ts`（`KUSABI_INTEGRATED_BUILT_EXECUTION=1`）、`test:codex-hook`・`test:claude-hook`（回転の `test:session-rotation` 一式を含む）・`test:gemini-hook`・`test:gemini-conversation-ingest`・`test:automatic-receive`、公開の版づくりと direct rollout の試験、spec-enforcement、`test-sqlite.ts`・`test-boot-recovery.ts`・`test-post-tool-hook.ts`（`HOME=$(mktemp -d)`）、gate0 の 3 本。PostgreSQL の試験は CI に無い（ファイル冒頭のコメント）。
- CI で回らない物（`package.json` の script と `ci.yml` を突き合わせた）: `src/test-transcript-stop-capture.ts`（`npm test` と `test:transcript-stop` だけ）、`src/test-kusabi-runtime-event-emitter.ts`（`npm test` だけ）、`src/test-antigravity-session-start.ts`（`npm test` と `test:antigravity-hook`）、`src/test-kusabi-fleet-status.ts`、`src/test-handoff-commit-order-pg.ts`（`test:handoff-commit-order-pg` だけ、手元で回す）、`src/test-kusabi-fresh-session-fleet.ts`（どの script にも名前が無い）。`src/test-recovery-context.ts` は `src/test.ts` から読み込まれるので CI で回る。
- 試験と型検査: `tsconfig.json` の `exclude` に `src/test*.ts` があるので、`npx tsc --noEmit` は試験の file を検査しない。`tests/` は `include`（`src/**/*`）の外。

## Handoff Summary
- **Intent-relevant finding**: Claude Code の席で、PostgreSQL の URL が `~/.agent-memory/config.json` の `database_url` にだけあり env に無い時、SessionStart と Stop が別の保存先を選ぶ形がコードにある。SessionStart は `loadClaudeRecoveryFromStore` の先頭で `resolveCodexStoreBinding()` を呼び（`src/claude-session-start.ts:317`）、config の URL を `process.env.AGENT_MEMORY_DATABASE_URL` に書く（`src/codex-session-start.ts:378`）。その後の `createStore({ skipPostgresMigrations: true })`（`src/claude-session-start.ts:318`）が `resolveStoreBackend()` で env を読み、PostgreSQL を選ぶ（`src/stores/index.ts:35-49`）。Stop の 2 つ（`src/transcript-stop-capture.ts:225`、`src/session-rotation-stop.ts:546`。後者は installer に `--rotation on` を渡した席にだけ置かれる）は `resolveCodexStoreBinding` を呼ばず、command にも env も config も入らない（事実 4）ので、`createStore` が env だけを見て既定の SQLite を選ぶ（`src/stores/index.ts:95-99`）。既定の SQLite は無ければ `~/.agent-memory/memory.db` を黙って作り（`src/stores/sqlite-store.ts:368-373、446`）、Stop は失敗せず成功として終わる（`failed_open` は例外の時だけ）。Stop の証拠は保存先を名指さない（`store_binding` の項目が無い）。Codex の Stop も同じ入口なので同じ形（事実 3）。ほかに、emitter の `createQuietStore` が 3 つ目の env のみの写し（`??` と `||` の違い、json は例外）、`post-tool-hook` が 4 つ目の読み込み（`DATABASE_URL` にだけ入れる、`AGENT_MEMORY_DATABASE_URL` を見ない、config の URL を判定しない）。
- **Risks / follow-up**: 次の段が保つ事実と、確かめていないこと。
  - 保つ事実: (a) `createStore` は env を引数に取らず `process.env` を直接読む。呼び出し元は 16 あり、config を通るのは SessionStart の 4 つだけ（事実 2）。(b) `rotation-commit` が config の URL を受けるのは、同じ process の SessionStart が先に `process.env` を書き換えるから（`src/rotation-commit.ts:43` 自身は env のみ）。(c) 決める 4 つの部品は種別の綴り・URL の `||` と `??`・形の判定・知らない種別・json・失敗の時の動きが違う（事実 1 の表）。同じ入力で同じ答えになる保証は無い。(d) PG の表の変更を流す呼び出しと流さない呼び出しが混在する（SessionStart・Stop・MCP・boot は skip、launcher・restart-cli・fleet-status は流す、emitter は常に流さない）。(e) SessionStart の証拠だけが `store_binding` を持ち、`binding_sha256` は emitter の drift 判定にも使われる（`src/kusabi-runtime-event-emitter.ts:449-456`）。
  - 試験の空白: 3 つの hook が同じ保存先を選ぶ試験、config.json を使う試験、Stop 側の実体の起動で保存先を指定する試験が無い。Stop の試験（`test-transcript-stop-capture.ts`）と emitter の試験は CI で回らない。
  - 確かめていないこと: 席の CLI を起こす側（tmux・launcher・席の起動の設定）が env を渡すかどうか、`post-tool-hook` が実際にどこで登録されるか（`scripts/`・`templates/`、範囲の外）、`src/mcp-store-readiness.ts`・`src/migrate.ts`・`src/session-start-auto-receive.ts` の中身、前回の codekb の本文のうち 2026-11-10 の読みで今の head と違いうる所（回転の統合による変化）。
