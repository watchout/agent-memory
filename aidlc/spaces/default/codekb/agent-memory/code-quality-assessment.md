# コードの質の見立て — Kusabi（agent-memory）

試験・CI・検査・技術の負債はここが持ち主。今回（2026-11-15、取り組み 261113-store-resolution-fix）も、試験も build も動かしていない（コードと設定を読んだだけ）。「前回の読み」と付けた文は 2026-11-10 の読み（commit a4a4d1e）のままで、今回は確かめていない。今回書き直したのは「1. 試験」の保存先に関わる事実、「3. 検査と CI」、「4. 見立て」の表の 2 行、「5. 技術の負債の印」の先頭 5 項目。

## 1. 試験

- 形: 自前の tsx の script。`src/test.ts`（前回の読みで 5,410 行、自前の `assert`）と `src/test-*.ts`、`tests/gate0/*`（3）、`tests/spec-enforcement/*`（1）。試験の枠組み（Jest・Vitest など）は使っていない。個々の試験は `node:assert` を使い、入口の確かめは `spawnSync` で process を起こす（今回読んだ事実）。file の数は code-structure.md の置き場の表。
- CI で回る物（.github/workflows/ci.yml、Node 18・20・22。今回読んだ事実）: `npm ci`、`npx tsc --noEmit`、`npm run build`、`npx tsx src/test.ts`（`KUSABI_INTEGRATED_BUILT_EXECUTION=1`）、`test:codex-hook`・`test:claude-hook`（回転の `test:session-rotation` 一式を含む）・`test:gemini-hook`・`test:gemini-conversation-ingest`・`test:automatic-receive`、公開の版づくりと direct rollout の試験、spec-enforcement、`test-sqlite.ts`・`test-boot-recovery.ts`・`test-post-tool-hook.ts`（`HOME=$(mktemp -d)`）、gate0 の 3 本。
- CI で回らない物（`package.json` の script と `ci.yml` を突き合わせた。今回読んだ事実）:
  - `src/test-transcript-stop-capture.ts`（`npm test` と `test:transcript-stop` だけ）
  - `src/test-kusabi-runtime-event-emitter.ts`（`npm test` だけ）
  - `src/test-antigravity-session-start.ts`（`npm test` と `test:antigravity-hook`）
  - `src/test-kusabi-fleet-status.ts`
  - `src/test-handoff-commit-order-pg.ts`（`test:handoff-commit-order-pg` だけ。手元で回す）
  - `src/test-kusabi-fresh-session-fleet.ts`（どの script にも名前が無い）
  - `src/test-recovery-context.ts` は `src/test.ts` から読み込まれるので CI で回る。
- 前回の読みで、CI で回らない物として挙げた物のうち、今回の突き合わせで再確認していない物: `src/test-kusabi-checkpoint-recovery.ts`、`test-kusabi-continuity-interruption-e2e.ts`・`test-kusabi-one-seat-canary.ts`・`test-kusabi-partitions.ts`・`test-kusabi-runtime-identity.ts`。
- 文脈の量の判定・Codex の測り・Claude Code の marker・作り直しの command の確かめ・`prepareRestart` は `src/test.ts` の中で試験されている（前回の読み。CI で回る）。
- PostgreSQL の試験（`src/test-pg.ts`）は CI に無く、手元で回す（team.md の決まりどおり。`ci.yml` の冒頭の注記でも確認）。
- 試験と型検査: `tsconfig.json` の `exclude` に `src/test*.ts` があるので、`npx tsc --noEmit` と build は試験の file を型検査しない。`tests/` は `include`（`src/**/*`）の外（今回読んだ事実）。

### 保存先の選び方に関わる試験（今回読んだ事実）

- 「3 つの hook（SessionStart・rotation-stop・transcript-stop）が同じ保存先を選ぶ」ことを確かめる試験は無い。1 つだけ近い物がある: `src/test-kusabi-runtime-event-emitter.ts` の CLI の試験（466-498 付近）が、codex・claude・gemini の SessionStart を同じ SQLite の DB（`AGENT_MEMORY_DB_TYPE=sqlite` と `AGENT_MEMORY_DB_PATH`）に向けて起こし、`session_start` の記録がその 1 つの DB に 3 件入ることを見る。env だけで、config.json は使わず、Stop の hook は含まない。この試験は CI で回らない。
- `~/.agent-memory/config.json` を作って保存先を確かめる試験は無い。`src/test*.ts` と `tests/` の中で `config.json` が出るのは `src/test-post-tool-hook.ts:163` のコメント（「Avoid loading config.json」）と、保存先と無関係の名前だけ。
- `resolveCodexStoreBinding` を名前で参照する試験は無い（`src/` と `tests/` で参照するのは 4 つの SessionStart の source だけ）。SessionStart の試験は、証拠の fixture（`source: "user_config"` の物。`src/test-claude-session-start.ts:84-87`、`src/test-gemini-session-start.ts:75-78`、`src/test-antigravity-session-start.ts:54-55`）を直接渡すか、実体の起動で `AGENT_MEMORY_DB_TYPE=sqlite` を渡して `source: "environment"` と `backend_intent: "sqlite"` を見る（`src/test-claude-session-start.ts:636、650-652`）。
- `createStore` の選び方の試験は `src/test.ts:1594-1640`: 既定 SQLite、`AGENT_MEMORY_DB_TYPE=sqlite` が PG の URL に勝つこと、PG の URL で接続に失敗すると SQLite に逃げず止まること（`skipPostgresMigrations: true` の時も）。env だけ。`resolveStoreBackend` の表の試験と、読み取り専用の読み手が同じ関数に従う試験は `src/test-handoff-source-cli.ts` の T17(p)（今回の範囲の外で開いた）で、`{AGENT_MEMORY_DB_TYPE:"mysql"}` が sqlite になることも表明している。
- Stop 側の試験: `src/test-transcript-stop-capture.ts` は `fakeStore`（`close` だけの偽物、28）と `JsonStore` の一時 folder を渡す。実体を起こす `realEntry`（111 から、env は 114）は `HOME` と `AGENT_MEMORY_HOME` だけを渡し、`AGENT_MEMORY_DB_TYPE` と URL は渡さない。回転の試験（`src/test-session-rotation-flow.ts:149`）は `createStore` を偽物に差し替える。`src/test-session-rotation-scenario.ts:18` は `AGENT_MEMORY_DB_TYPE=json` と一時の `HOME`。
- 試験や確かめの script で既定の `createStore()` を呼ぶと、保存先の既定が home の下から決まり、その Mac の実際の保存先に行が入る（project.md の学び。必ず一時の `HOME` を指定する）。

## 2. 網羅率

- 行の網羅率を測る道具が入っていない（c8・nyc などが package.json に無い。今回も確認）。team.md の床（行の網羅率 100%、CI で確かめる）を今の CI では測れない。道具を足すのは新しい外の依存で、CI を変えるのは保護面なので、どちらも Owner の決定が要る。
- 保存先を決める 4 つの部品のうち、どの行が試験に踏まれているかは今回測っていない（試験を動かしていない）。

## 3. 検査と CI

- 型検査: `tsc --noEmit`（strict）。書式・静的検査の道具は無い（team.md の決まり）。
- CI: `ci.yml`（build と試験。Node 18・20・22 の matrix）と `shirube-rapid-lite-gates-report.yml`（`pull_request_target` で PR の門の報告。信頼する base の道具を digest で確かめてから動かす。今回は冒頭 60 行と step の名前だけ読んだ）。
- Node の版: `engines` は 20 以上、CI は 18 も回す（technology-stack.md）。

## 4. 見立て（良・並・弱）

| 観点 | 見立て | 根拠 |
|---|---|---|
| 名前の分かりやすさ | 良 | 機能の接頭辞と、型の付いた理由の名前（`RECOVERY_TIMEOUT` など。前回の読み） |
| 関数の大きさ | 並 | 入口の CLI は大きい関数が多い（src/index.ts の 1 つの `main` に 17 の道具。前回の読み） |
| 失敗の扱い | 良（hook）・並（MCP） | hook は理由つきの degraded を返す。MCP の道具は `${err}` をそのまま文にして返す（前回の読み）。保存先を決める失敗は部品ごとに違う（api-documentation.md の 8）: 例外・緊急の 1 行・黙って既定の SQLite・黙って `{}` |
| 試験の有無 | 並 | 回復の核は試験あり。Stop の取り込みと emitter の試験は CI の外。3 つの hook の保存先が一致する試験と config.json を使う試験が無い（上の 1） |
| 重複 | 弱 | 4 つの installer の写し。閾値と確かさの重みが 2 か所（前回の読み）。保存先を決める部品が 4 つ（下の 5） |
| 使われていない物 | 並（前回の読み） | 本番の呼び手が無い module が 3 つ（測りの 2 つと marker controller）。PR #341 の後の呼び手は今回確かめていない |
| 保存先の一致の確かめ | 弱 | 証拠が保存先を名指すのは SessionStart だけで、Stop 側の証拠に項目が無い（下の 5） |

## 5. 技術の負債の印

- 保存先を決める所が複数ある（`src/stores/index.ts:35`・`src/codex-session-start.ts:305`・`src/kusabi-runtime-event-emitter.ts:514`・`src/post-tool-hook.ts:26-45`）。入力・順番・失敗の時の動きがそれぞれ違う（表は api-documentation.md の 8）。標準 S3（知識の重複）に当たる形（今回読んだ事実）。
- `createStore` は env を引数に取らず `resolveStoreBackend()` を引数なしで呼ぶ（`src/stores/index.ts:55`）。config を読む `resolveCodexStoreBinding` は `process.env` を書き換えて `createStore` に URL を渡す（`src/codex-session-start.ts:378`）。この順序の依存はコードの中の規則として明記されていない（今回読んだ事実）。
- Stop 側の証拠（`src/transcript-stop-capture.ts` の evidence、`src/session-rotation-stop.ts`、`src/rotation-commit.ts`）には `store_binding`・`binding_sha256`・`backend` の項目が無い（grep で 0 件）。SessionStart の証拠だけが持つ（`src/codex-session-start.ts:125、723、812、881`、`src/claude-session-start.ts:385`）（今回読んだ事実）。
- 既定の SQLite を開くと、無ければ folder と空の DB file を作る（`src/stores/sqlite-store.ts:368-373、446`）。成功と同じ見え方で、止まらない（今回読んだ事実）。
- `.github/workflows/ci.yml` の Node の matrix（18）と `package.json` の `engines.node`（20 以上）が食い違う（今回読んだ事実）。
- 800 行を超える file: 前回の読みでは試験でない file が 13（大きい順に src/kusabi-direct-fleet-rollout.ts 2,036、src/stores/sqlite-store.ts 1,878、src/kusabi-fleet-rollout.ts 1,846、src/stores/pg-store.ts 1,533、src/restart-pack.ts 1,255 ほか）。team.md は「7 つ」と書いているが、前回の head で数えると 13。今回の範囲の中で数えた行数は、`src/stores/sqlite-store.ts` 1,883、`src/stores/pg-store.ts` 1,533、`src/codex-session-start.ts` 1,122、`src/index.ts` 1,017、`src/stores/json-store.ts` 907、`src/codex-start.ts` 809。
- 知識の重複（標準 S3、前回の読み）: 使用率の帯の閾値（src/restart-prepare.ts:386-389 と src/context-window-resolution.ts:45 の `BAND_THRESHOLDS`）、確かさの重みと境（src/restart-pack.ts:739・743 と src/restart-prepare.ts:239・353）。
- 時計を核で読む（標準 S4、前回の読み）: src/restart-prepare.ts:164、src/recovery-context.ts:62、src/restart-pack.ts:247（引数が無い時）。回転の 2 つ（`src/session-rotation-stop.ts`・`src/rotation-commit.ts`）は時刻を呼び手が渡す（今回読んだ事実）。
- 環境に固定した値（前回の読み）: 作業者の home の下の絶対 path が src/claude-start.ts:239・279、src/codex-start.ts:107、src/kusabi-fresh-session-fleet.ts（12 席の表）、scripts/post-tool-hook.sh ほかにある。Codex の MCP の束縛は特定の席と DB の URL の digest を定数で持つ（src/codex-start.ts）。
- 資格情報が process の引数に出うる（前回の読み）: src/codex-start.ts:516 は MCP の `DATABASE_URL` を `-c` の引数で codex に渡す。`--launch` は回復の束を引数で渡す（説明の文で既知の危険として明記）。
- 取り込みの重さ（前回の読み）: 1 行ごとに `getRawEvents`（1,000 件まで）と書き込み 2 回（src/claude-conversation-ingest.ts:201-212、src/codex-conversation-ingest.ts:259-270）。Stop の hook は末尾 4 MiB を 9 秒の期限で扱う。
- TODO（前回の読み）: src/stores/pg-store.ts の 4 か所（AM-026、PostgreSQL の `catch_up_log`）。
- 表の変更に「戻す手順」が無い（前回の読み。src/stores/pg-migrations.ts は足すだけ。標準 S6）。
- scripts/codex-memory-start.sh の既定は sandbox `danger-full-access`・承認 `never`（前回の読み）。
