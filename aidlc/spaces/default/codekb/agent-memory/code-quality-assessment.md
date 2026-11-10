# コードの質の見立て — Kusabi（agent-memory）

試験・CI・検査・技術の負債はここが持ち主。今回は試験も build も動かしていない（コードを読んだだけ）。

## 1. 試験

- 形: 自前の tsx の script。`src/test.ts`（5,410 行、自前の `assert`）と、`src/test-*.ts`（38）、`tests/gate0/*`（3）、`tests/spec-enforcement/*`（1）。試験の枠組み（Jest・Vitest など）は使っていない。
- CI で回る物（.github/workflows/ci.yml、Node 18・20・22）: 型検査、build、`src/test.ts`、`test:codex-hook`・`test:claude-hook`・`test:gemini-hook`（各 session-start と installer）、Gemini の取り込み、`test:automatic-receive`、公開の版づくり、direct rollout、spec-enforcement、`test-sqlite.ts`、`test-boot-recovery.ts`、`test-post-tool-hook.ts`、gate0 の 3 本。
- CI で回らない物のうち、会話の切り直しに関わる物:
  - `src/test-transcript-stop-capture.ts`（`npm test` には入るが CI には無い）
  - `src/test-kusabi-checkpoint-recovery.ts`・`src/test-kusabi-fresh-session-fleet.ts`（npm の script にも CI にも名前が無い）
  - ほかに名前がどこにも無い物: `test-kusabi-continuity-interruption-e2e.ts`・`test-kusabi-one-seat-canary.ts`・`test-kusabi-partitions.ts`・`test-kusabi-runtime-identity.ts`
- 文脈の量の判定・Codex の測り・Claude Code の marker・作り直しの command の確かめ・`prepareRestart` は `src/test.ts` の中で試験されている（CI で回る）。
- PostgreSQL の試験（`src/test-pg.ts`）は CI に無く、手元で回す（team.md の決まりどおり）。

## 2. 網羅率

- 行の網羅率を測る道具が入っていない（c8・nyc などが package.json に無い）。team.md の床（行の網羅率 100%、CI で確かめる）を今の CI では測れない。道具を足すのは新しい外の依存で、CI を変えるのは保護面なので、どちらも Owner の決定が要る。

## 3. 検査と CI

- 型検査: `tsc --noEmit`（strict）。書式・静的検査の道具は無い（team.md の決まり）。
- CI: `ci.yml`（build と試験）と `shirube-rapid-lite-gates-report.yml`（PR の門。信頼する base の道具を digest で確かめてから動かす）。
- Node の版: `engines` は 20 以上、CI は 18 も回す（technology-stack.md）。

## 4. 見立て（良・並・弱）

| 観点 | 見立て | 根拠 |
|---|---|---|
| 名前の分かりやすさ | 良 | 機能の接頭辞と、型の付いた理由の名前（`RECOVERY_TIMEOUT` など） |
| 関数の大きさ | 並 | 入口の CLI は大きい関数が多い（src/index.ts の 1 つの `main` に 17 の道具） |
| 失敗の扱い | 良（hook）・並（MCP） | hook は理由つきの degraded を返す。MCP の道具は `${err}` をそのまま文にして返す |
| 試験の有無 | 並 | 回復の核は試験あり。会話の切り直しに要る Stop の取り込みと継続の印は CI の外 |
| 重複 | 弱 | 4 つの installer の写し。閾値と確かさの重みが 2 か所（下の 5） |
| 使われていない物 | 並 | 本番の呼び手が無い module が 3 つ（測りの 2 つと marker controller） |

## 5. 技術の負債の印

- 800 行を超える試験でない file が 13（大きい順に src/kusabi-direct-fleet-rollout.ts 2,036、src/stores/sqlite-store.ts 1,878、src/kusabi-fleet-rollout.ts 1,846、src/stores/pg-store.ts 1,533、src/restart-pack.ts 1,255 ほか）。team.md は「7 つ」と書いているが、今の head で数えると 13。
- 知識の重複（標準 S3）: 使用率の帯の閾値（src/restart-prepare.ts:386-389 と src/context-window-resolution.ts:45 の `BAND_THRESHOLDS`）、確かさの重みと境（src/restart-pack.ts:739・743 と src/restart-prepare.ts:239・353）。
- 時計を核で読む（標準 S4）: src/restart-prepare.ts:164、src/recovery-context.ts:62、src/restart-pack.ts:247（引数が無い時）。
- 環境に固定した値: 作業者の home の下の絶対 path が src/claude-start.ts:239・279、src/codex-start.ts:107、src/kusabi-fresh-session-fleet.ts（12 席の表）、scripts/post-tool-hook.sh ほかにある。Codex の MCP の束縛は特定の席と DB の URL の digest を定数で持つ（src/codex-start.ts）。
- 資格情報が process の引数に出うる: src/codex-start.ts:516 は MCP の `DATABASE_URL` を `-c` の引数で codex に渡す。`--launch` は回復の束を引数で渡す（説明の文で既知の危険として明記）。
- 取り込みの重さ: 1 行ごとに `getRawEvents`（1,000 件まで）と書き込み 2 回（src/claude-conversation-ingest.ts:201-212、src/codex-conversation-ingest.ts:259-270）。Stop の hook は末尾 4 MiB を 9 秒の期限で扱う。
- TODO: src/stores/pg-store.ts の 4 か所（AM-026、PostgreSQL の `catch_up_log`）。
- 表の変更に「戻す手順」が無い（src/stores/pg-migrations.ts は足すだけ。標準 S6）。
- scripts/codex-memory-start.sh の既定は sandbox `danger-full-access`・承認 `never`。
