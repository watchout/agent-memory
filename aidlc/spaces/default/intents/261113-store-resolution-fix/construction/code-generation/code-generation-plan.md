# Code Generation 計画 — 保存先の決め方を 1 つの関数にする（取り組み 261113-store-resolution-fix、bugfix）

この計画は、承認済みの要件（`inception/requirements-analysis/requirements.md`、FR1〜FR7・NFR1〜NFR9・OQ1〜OQ5）と、Requirements Analysis の承認の時に arc から受けた持ち越しの決め（R-01〜R-05。arc の答え = Owner の委任 #49 6762288830。Owner の言葉ではない）を、作る手順に落とす。要件の file は承認済みなので書き換えない。要件に足す・直す所は「3. 要件の補い」に書く。

読んだ版 = 27d7f8f（`origin/main` = `27d7f8fc9146e826883b045c1fdca93cc11f93e7`）。手元の作業場の `src`・`scripts`・`package.json`・`.github`・`docs/operations` が 27d7f8f と byte 単位で同じことは、要件の記録（2026-11-15T23:08:29Z）の突き合わせの後にも、blob の hash で読み直して確かめた（untracked の 15 file を含む 199 file。`git diff` は untracked を「消えた」と数えるので使わない）。code を書く時点で `origin/main` が進んでいたら、関数名と呼び出しを取り直す（要件の AS1）。

## Summary

- **Builds（新しく作る物）**: 保存先を決める共有の関数 `src/store-resolution.ts`（核は入力だけで答える純粋な関数、file を読む所は薄い adapter）と、決めた結果から接続先の binding の digest を作る関数 `storeBindingSha256`（今 `codex-session-start.ts` が持つ digest の作り方を移す。SessionStart の証拠と emitter の worker が同じ 1 つを使う）。結果を受けて store を開き、開いた store の `backend` を決めた `backend` と突き合わせる `openResolvedStore`（`src/stores/index.ts`）。試験 3 file（`src/test-store-resolution.ts`・`src/test-store-resolution-scenario.ts`・`src/test-store-resolution-pg.ts`）。
- **Touches（直す物）**: `src/stores/index.ts`（`createStore` が任意の `resolution` を受ける。`resolveStoreBackend` は持ち越しの入口のために残し、注釈を直す）、`src/codex-session-start.ts`（環境変数へ URL を書く `resolveCodexStoreBinding` を、結果を返す `resolveSessionStartStore` に置き換える）、4 つの SessionStart の loader（`claude-`・`codex-`・`gemini-`・`antigravity-session-start.ts`）、Stop の 2 つの hook（`src/session-rotation-stop.ts`・`src/transcript-stop-capture.ts`）、`src/rotation-commit.ts`、`src/restart-cli.ts`、`src/stores/read-only-task-states.ts`、`src/kusabi-runtime-event-emitter.ts`（arc の R-01）、`package.json`（試験の命令を足すだけ。workflow は変えない。CI が今呼ぶ `npm run test:claude-hook` の連なりに新しい試験を足して、CI から届かせる = 2 の D10）、設計の文書（挙動を変える所だけ。5 の Step 13）。
- **Tests（試験）**: 成功の条件の場面（設定 file にだけ接続先がある席で、Stop が書いた引き継ぎを同じ保存先から読み戻せる）を先に書いて失敗を確かめる。細かい試験は層ごとに実装の後に書く。DB の構造は変えない（DDL の行 0 件）。使い捨ての PostgreSQL は手元でだけ流し、結果を PR に載せる（team.md の決まり）。PostgreSQL を使わない回帰の試験（接続できない PostgreSQL の URL を設定 file にだけ置く S1、接続先の違う 2 つの PostgreSQL の URL の負例 S6）は CI で流れる。新しい試験が CI から本当に届くことは、到達の機械の確かめ（U13）・意図的な失敗の確かめ（E1）・実装の PR の CI の log の確かめ（C1）の 3 つで確かめる。網羅率の測りは、未観測を 0 と数えない形に直して（D11）、負例の自己試験（U14）つきで流す。

道の区分: コードの変更は 100 行を超える見込みで（行数は監査の依頼の前検査が機械で数える。ここでは数えない）、DB の書き込みの経路（守る物）に触れるので、軽い道ではなく今の道（設計の記録だけの PR を先に出して設計監査を 1 回、PASS の後に code）で作る。

## 1. 設計

### 1.1 保存先を決める関数（`src/store-resolution.ts`、新）

- 型（語彙は SessionStart の既存の値のまま。新しい語を作らない = FR1.6）:
  - `StoreBackendName` = `"postgres" | "sqlite" | "json"`、`StoreSource` = `"environment" | "user_config" | "local_default"`。
  - `StoreRefusalReason`（閉じた集合。FR1.3。誤りの種類を指す印で、権限・工程・役割・状態の語ではない）: `unknown_db_type`（未知の種類）・`env_url_shape`（環境変数の URL の形）・`config_kind`（設定 file が symlink か通常の file でない）・`config_read`（設定 file が読めない。不在以外の理由）・`config_content`（JSON として読めない・object でない・`database_url` の中身が誤り）・`target_missing`（`postgres` と明示されたが接続先がどこにも無い）。値・URL・path を含めない。
  - `StoreResolution` = `{ backend, source, target, config_seen, ignores_postgres_url }`。`target` は PostgreSQL の時だけの接続先で、不透明な物（下の「不透明な接続先」）。`config_seen` は設定 file を読んで中身を見たか（SessionStart の既存の証拠 `config_path_sha256` の有無を今のまま作るために要る。値は決めた結果から取り、読み直さない）。`ignores_postgres_url` は `createStore` が今 stderr に出す注意の行を変えないための事実（環境変数が `sqlite`・`json` を名指し、PostgreSQL の URL も環境にある）。
  - `StoreDecision` = `{ ok: true, resolution } | { ok: false, reason }`。
- 核 `decideStore(env, readConfig)`: 時計・乱数・環境の自己取得をしない（S4）。`env` と、設定 file の読み結果を返す関数 `readConfig`（最大 1 回呼ぶ）だけで答えが決まる。決める順は要件の FR1.2 のとおり。**環境変数で決まる時は `readConfig` を呼ばない**（今の SessionStart と同じ。壊れた設定 file が、環境変数で決まる席に新しい失敗を足さない = 採らなかった代替は「先に読む」）。
- 設定 file の読み結果 `StoreConfigRead` = `{ status: "absent" } | { status: "read", content: unknown } | { status: "unreadable", reason: "config_kind" | "config_read" | "config_content" }`。
- adapter `readUserConfig(path)`（R-03）: `lstat` が **ENOENT のときだけ** `absent`。ほかの失敗（権限・ENOTDIR・ELOOP など）は `config_read`。symlink と通常の file でないものは `config_kind`。file の読みの失敗は `config_read`。`JSON.parse` の失敗は `config_content`。
- 核の中身の検査（R-03）: `content` が object でない（配列・`null` を含む）→ `config_content`。`database_url` が **無い（undefined）** → 「`database_url` が無い」として次へ（FR1.5 = Q4 の A）。`database_url` が **ある** のに、文字列でない・空の文字列・`null`・postgres の形でない → `config_content`（宣言されているのに使えない設定を、無いこととして扱わない）。環境変数の URL の空の文字だけは「未設定と同じ」（FR1.2 の 3）。
- `resolveStore(env = process.env, configPath = 既定の path)`: `decideStore(env, () => readUserConfig(configPath))` を呼ぶ入口。既定の path は `homedir()` と `.agent-memory/config.json`。この定数の綴りは `codex-session-start.ts` の `CODEX_USER_CONFIG_RELATIVE_PATH` が今持っているので、`store-resolution.ts` に移し、`codex-session-start.ts` は同じ値を再 export する（literal を 2 か所に置かない = S3）。
- `storeBindingSha256(resolution, env)`（新。S3 = 結果から binding の digest を作る所を 1 つにする）: PostgreSQL は `kusabiStoreBindingSha256("postgres", target.reveal())`、SQLite・JSON は今の `localStoreBindingSha256`（path は `env` の `AGENT_MEMORY_DB_PATH` か home の既定）と同じ値を返す。`KUSABI_STORE_BINDING_HASH_VERSION`・`kusabiStoreBindingSha256`・`localStoreBindingSha256` は `codex-session-start.ts` から `store-resolution.ts` へ移し、`codex-session-start.ts` は同じ名前を再 export する（今の試験が `./codex-session-start.js` から import している = `test-codex-session-start.ts`・`test-kusabi-runtime-event-emitter.ts`。27d7f8f の読み）。SessionStart の証拠（1.4）と emitter の worker（1.6）が、この関数だけで digest を作る。
- 不透明な接続先: URL（資格情報を含みうる）を、`reveal()` を呼んだ時だけ返す物にする。`JSON.stringify`・`util.inspect`・文字列化のどれでも URL が出ない（NFR1）。`reveal()` を呼ぶのは、store を開く所（`createStore`・読むだけの reader・emitter の worker）と `storeBindingSha256`（digest を作る所）だけ。

### 1.2 結果を受けて store を開く（`src/stores/index.ts`）

- `createStore(options)` は任意の `resolution` を受ける。渡された時は `resolveStoreBackend` を呼ばず、結果を今の `StoreBackendChoice` に写して、後ろの処理（stderr の行・各 store の開き方）は変えない。渡さない呼び出し元（`index.ts`・`boot.ts`・`claude-start`・`codex-start`・`kusabi-fleet-status-cli`・`post-tool-hook` = FR7）の動きは変えない（FR2.5）。
- `openResolvedStore(resolution, options)`: `createStore({ ...options, resolution })` の後に、開いた store の `backend` が決めた `backend` と違えば store を閉じて失敗にする（宣言と観測の突き合わせ。FR3.5・S5）。
- `resolveStoreBackend` の「ここで 1 か所に決める」の注釈は、「持ち越しの入口が使う環境変数だけの決め方。共有の決め方は `store-resolution.ts`」に直す（FR2.5）。この関数の中身は変えない（採らなかった代替は 2 の D7）。

### 1.3 入口ごとの渡し方

| 入口 | 決める所 | 結果の渡し方 | 拒否の時 |
|---|---|---|---|
| SessionStart 4 種 | loader の頭で `resolveSessionStartStore()` | 同じ loader が `openResolvedStore(resolution, { skipPostgresMigrations: true })` へ。環境変数へは書かない | `HookDegradedError("RECOVERY_UNAVAILABLE")`（今のまま。FR3.3）|
| Stop 2 種（Claude Code・Codex の両 host） | store が要る時だけ（`session-rotation-stop` は `save` の時の `withStore`、`transcript-stop-capture` は store を開く前）。store の要らない回（busy・none・blocked）は今のまま、決めない | `openResolvedStore` | store を開かず `failed_open`、理由は `store_refused:<閉じた集合の 1 つ>`。host は止めない（FR3.2）|
| `rotation-commit` | 決めない。同じ process の SessionStart が決めた結果を引数で受ける | `answerHookAndCommit` の `answer` に `store_resolution` を足し、`commitRotationRecovery` が `openResolvedStore` で開く | 結果も `open_store` の seam も無ければ開かず `consume: "unknown"`（環境変数だけの `createStore()` に落とさない）|
| `restart-cli handoff-source`（読むだけ） | `runHandoffSource` が `resolveStore(process.env)` | `createReadOnlyTaskStateReader(env, { resolution })`。reader は結果が無い時、自分で `resolveStore(env)` を呼び、拒否なら `unreadable` として読めない扱い | 標準エラーに理由の種類だけを出し、終了コード 1。標準出力は、この口がどの読めない保存先にも出す `unreadable` の JSON のまま（呼ぶ側が標準出力の `result` を読むので空にしない。作る段で改めた。`memory.md`）（FR3.4）|
| `restart-cli fetch`・`prepare` | `main` が `resolveStore(process.env)` | `openResolvedStore(resolution)`（移行は今のまま走らせる = `skipPostgresMigrations` を渡さない）| 同上 |
| emitter（R-01） | worker の `createQuietStore` が `resolveStore(env)` を自分で呼ぶ（2 の D1）| 環境変数の書き込みに頼らない | 今の `store_unavailable` の緊急の記録 |

### 1.4 SessionStart の証拠は変えない（FR2.1）

`resolveSessionStartStore(env, configPath)`（`codex-session-start.ts`）は `{ binding, resolution }` を返す。`binding`（`CodexStoreBindingEvidence`）は結果から作る: `source`・`backend_intent` は結果から、`config_path_sha256` は `config_seen` の時だけ設定 file の path の digest、`binding_sha256` は `storeBindingSha256(resolution, env)`（1.1。PostgreSQL なら `kusabiStoreBindingSha256("postgres", target.reveal())`、SQLite・JSON なら今の `localStoreBindingSha256` と同じ値）。これで 27d7f8f の `resolveCodexStoreBinding` と同じ値になることを、直す前に取った表（Step 3）との突き合わせの試験で確かめる。`LoadedCodexRecovery` に `store_resolution` を足し（`store_binding` の隣）、`CodexSessionStartRunResult`・Claude 側の同じ型にも、`rotation_commit` がある時だけ `store_resolution` を載せる。

### 1.5 Stop の証拠（Q3 = A、FR4）

- 名前を確定する: `store_backend`（`postgres`・`sqlite`・`json`・`null`）と `store_source`（`environment`・`user_config`・`local_default`・`null`）。2 つの証拠の型（`RotationStopEvidence` と、`transcript-stop-capture` の証拠の型）に足す。
- 値は store を開いて観測した時だけ入れる。`store_backend` は開いた store の `backend`（観測）、`store_source` は決めた結果（宣言）。開かなかった回（busy・none・blocked・拒否・malformed）は両方 `null`。`null` を成功の印にしない。URL・path・digest は足さない。
- schema の const（`wasurezu-session-rotation-stop/v1`・`wasurezu-transcript-stop-capture/v1`）は動かさない（OQ1。2 の D2）。
- 拒否の理由の型（27d7f8f を読んだ事実）: `transcript-stop-capture` の証拠の `reason` は閉じた union（`SessionStartAutoReceiveResult["reason"] | "malformed_input" | "identity_binding_invalid"`）で、`failedResult` の引数の `reason` も 3 つの文字（`malformed_input`・`identity_binding_invalid`・`ingest_failed`）だけ。拒否の理由 `store_refused:${StoreRefusalReason}` をこの 2 つの型に足す（足すだけ。D2）。`outcome` は `receiptOutcome` の今の写し（`REFUSED_REASONS` に無い理由は `unobserved`）のままにし、`REFUSED_REASONS` には足さない（保存先の拒否は「観測できず」で、成功でも取り込みの拒否でもない = S5）。`session-rotation-stop` の `reason` は `string` で、既にある `transcript_unverified:<理由>` と同じ形で足せる。接続できない PostgreSQL を開く失敗は、今の `ingest_failed`（`transcript-stop-capture`）・`rotation_stop_failed`（`session-rotation-stop`）のままにし、開く前に決まる拒否と区別する。
- テストの seam: 今の `dependencies.createStore?: () => Promise<Store>` を `(resolution: StoreResolution) => Promise<Store>` に広げる（引数を使わない今の試験はそのまま型が合う）。決める所は seam の外に置くので、seam に偽の store を入れた試験でも、決めた結果（`store_source` と拒否）が試験できる。

### 1.6 emitter（arc の R-01 の実現。2 の D1。設計監査 1 回目の SR-BF-02 を受けて契約を足した）

**27d7f8f の突き合わせが見ていない物**: `emitPreparedEvent` の 2 つの突き合わせ（`backend_intent` と `target.storage.backend`、`store_binding.binding_sha256` と `target.storage.binding_sha256`）は、どちらも SessionStart の証拠から出た値どうしの比べで、worker が実際に開く接続先の digest を一度も見ない（`createQuietStore` が環境変数から開く接続先を、digest にして比べる所が無い）。その後の `store.backend !== target.storage.backend` は `backend` の種類だけを比べる。だから、worker が決めた接続先が、SessionStart が決めた接続先と同じ種類（どちらも PostgreSQL）で別の接続先でも、27d7f8f の突き合わせは通る。この形は、今の「環境変数の URL を worker が読む」形にも、新しい「設定 file を worker が読む」形にもある。設定 file には、2 つの決めの間に `database_url` が書き換わる経路があるので、新しい形で契約として塞ぐ。

**契約**（`createQuietStore(env, expectedBindingSha256, signal)`。`expectedBindingSha256` は `emitPreparedEvent` が証拠の値と等しいことを既に確かめた `target.storage.binding_sha256`）:

1. worker は保存先を **1 回だけ**決める（`resolveStore(env)` を 1 回。設定 file の読みは最大 1 回）。拒否と JSON（今のとおり fixture 専用）は、今の `KUSABI_RUNTIME_EVENT_STORE_UNAVAILABLE` の経路（`store_unavailable`）。
2. 決めた**その結果**から、開こうとする接続先の binding を `storeBindingSha256(resolution, env)`（1.1）で作り直し、`expectedBindingSha256` と、store を作る**前**に比べる。違えば store を作らず（接続を試みず、SQLite の file も作らず）、`binding_drift`（今ある理由の語）にして、成功に数えない。
3. store は、2 で比べた**同じ結果**から作る（`resolveStore` を 2 回目に呼ばない。digest を作った結果と、store を作る結果が同じ 1 つの物）。作った後の `store.backend !== target.storage.backend` の観測は今のまま残す（宣言と観測。S5）。
4. worker の本体は `createQuietStore(process.env, request.target.storage.binding_sha256, signal)` を呼ぶ。公開の差し込み口 `options.createStore?: (signal) => Promise<Store>` の型は変えない。この差し込み口を使う呼び出し元は、27d7f8f の読みでは試験だけで、この道は接続先を観測しない（差し込み口の注釈に「試験の差し込み専用。接続先の確かめは worker の道が持つ」と書く）。

SessionStart は環境変数へ書かないので、設定 file にだけ接続先がある席の SessionStart の決めと worker の決めは、別の process が同じ設定 file を別々に読んだ結果になる。2 つの決めが同じ値を読んだ時だけ書き、違えば 2 の比べが `binding_drift` で止める（同じ PostgreSQL の別の接続先も見つかる）。この file は 794 行（27d7f8f）で、環境変数だけで決めていた所を消し、契約の 1〜3 を足す。足した結果が 800 行を超えそうなら、足した関数を別の file に出す（800 行の上限）。

## 2. 設計の判断と採らなかった代替（deviation ledger）

| ID | 採った判断 | 採らなかった代替 |
|---|---|---|
| D1 | emitter の worker が共有の `resolveStore` を自分で 1 回呼び、その**同じ結果**から実際に開く接続先の binding を作り直して、期待の binding と store を作る前に比べ、同じ結果で store を作る（1.6 の契約）。arc の R-01 の「環境変数への書き込みに頼らない・決め方を 1 つに（S3）」を、結果を渡す代わりに同じ関数を呼ぶ形で満たす。SessionStart の 4 つの呼び出し元と worker の stdin の項目を変えない | (a1) 結果の URL を SessionStart の loader から evidence に載せて emitter に渡し、worker の stdin に新しい項目を足す。URL を持つ物が process の境界を越え、4 つの呼び出し元・worker の request の形・loader の返り値の 3 つが同時に動く。(a2) worker が自分で決めるだけで、27d7f8f の `emitPreparedEvent` の突き合わせに任せる（この計画の最初の版）。その突き合わせは、SessionStart の証拠から出た 2 つの値どうしの比べで、worker が開く接続先を見ないので、同じ PostgreSQL の別の接続先を見つけない（設計監査 1 回目 SR-BF-02。最初の版の「`binding_sha256` の突き合わせで見つかる」という D1 の文は誤りだった） |
| D2 | schema の const を動かさず、証拠の項目を足すだけ（OQ1。S6 の同居: 旧い hook と新しい hook が同じ席の束に同時にいても、証拠は足すだけ） | const を `v2` に上げる。読み手が const で分岐していると新旧の hook の証拠を別々に扱う必要が出る。読み手は試験と監査の項目の記録以外に見つからなかった（検索 2026-11-15T23:37:49Z。作る時に取り直す）ので、上げる利点も無い |
| D3 | Stop の seam を `(resolution) => Promise<Store>` に広げ、決める所は seam の外 | seam を 2 つ（決めを迂回する旧い seam と新しい seam）にする。迂回する seam では「決めた結果」が試験できず、決めを通らない道が残る |
| D4 | `session-rotation-stop` は store が要る時（`save`）にだけ決める | hook の頭で決める。store の要らない回（busy を記録するだけ・何もしない）が、設定 file の誤りで新しく失敗になる（今は成功している回を壊す） |
| D5 | 読むだけの reader は、結果が渡されなければ自分で `resolveStore` を呼ぶ。`runHandoffSource` は先に決め、拒否の理由の種類を標準エラーに出す | reader の中だけで決める。拒否は `unreadable` に潰れ、理由の種類を出せない（FR3.4 に届かない） |
| D6 | 接続先を不透明な物にする | 文字列のまま持つ。証拠・log・誤りの文に URL が入る経路が、型で防げない（NFR1） |
| D7 | `resolveStoreBackend` を残す（持ち越しの入口のため。決め方の literal が 2 か所に残る S3 の例外を、持ち越しとして記録に書き、持ち越しの入口を触る時に直す） | `resolveStoreBackend` を新しい関数へ委ねる。持ち越しの入口（動いている席の MCP サーバーほか）の動きが変わる（未知の `AGENT_MEMORY_DB_TYPE` の拒否・URL の形の検査）。FR2.5・Q5 = A の範囲を超える |
| D8 | 核は `readConfig` を最大 1 回だけ呼ぶ関数として受け取り、環境変数で決まる時は呼ばない | 設定 file を先に読んで核に渡す。環境変数で決まる席が、壊れた設定 file で新しく失敗する |
| D9 | `codex-session-start.ts`（1122 行。27d7f8f の `src` で 800 行を超える file は、試験を除いて 13、試験を含めて 21 〔機械で数えた値。時点 2026-11-16 の `origin/main` = 27d7f8f の blob を `wc -l` で数えた〕。`team.md` の「7 つ」は古い数）は、触る所で行数を減らす（`resolveCodexStoreBinding` の 80 行ほどを、結果を作る数十行に置き換える。`postgresUrl`・`CODEX_USER_CONFIG_RELATIVE_PATH` の綴り・binding の digest の作り方〔`KUSABI_STORE_BINDING_HASH_VERSION`・`kusabiStoreBindingSha256`・`localStoreBindingSha256`〕は `store-resolution.ts` へ移り、`codex-session-start.ts` は同じ名前を再 export する）。この PR で 800 行以下にはしない（標準「触る時に直す。まとめて直す計画は作らない」） | 全体を分割する。この取り組みの範囲を超える |
| D10 | 新しい試験を CI から届かせる: `package.json` の `test:claude-hook`（CI の step「Run native recovery and automatic receive tests」が今呼ぶ `npm run test:claude-hook`）の連なりの最後に `npm run test:store-resolution` を足す。`test` の連なりの最後にも足す（手元の全体の実行用）。workflow は変えない。届くことは、機械の到達の確かめ（U13）、新しい試験の意図的な失敗で CI の step の命令が失敗する確かめ（E1）、実装の PR の CI の log に新しい試験の終わりの行が 3 つの Node の版すべてで出る確かめ（C1）の 3 つで確かめる。U13 は新しい試験が連なりから外れると自分も流れなくなるので、外れたことを見つけるのは E1・C1 の PR の証拠と、監査席が同じ命令で流す再実行になる（限界として記録する） | (a) `test` の連なりの最後だけに足す（この計画の最初の版）: 27d7f8f の `ci.yml` は `npm test` を流さず（core は `npx tsx src/test.ts`、ほかは `npm run test:*`）、新しい試験は CI に届かない（設計監査 1 回目 SR-BF-01）。(b) `ci.yml` に step を足す: workflow は保護面で、Owner の exact-head が別に要る。この PR の目的（保存先の不具合の修正）に不要 |
| D11 | 網羅率の測りは、前の取り組み（261110）の `merge-zero.mjs`・`changed-uncovered.py` を byte 同一で写さず、この取り組みの `coverage-method.md` に、未観測を 0 と数えない形に直した版を書く（変えた file が読み込まれていない・報告に無い・報告が空なら、数えられない = 失敗にし、その file の追加行を未実行に数える。仕様は 5 の Step 12）。負例の自己試験 6 つ（U14）を、本体の測りの前に流して記録する | byte 同一で写す（この計画の最初の版）: 未ロードの file の出力が `uncovered_ranges_in_changed=0` になり、100% と読める（設計監査 1 回目 SR-BF-03）。`c8` の `--all` に任せる: 新しい外部の依存で（Owner の判断）、team.md の学びのとおり子 process の分が別に数えられる罠がある |

## 3. 要件の補い（承認済みの要件は書き換えず、ここで足す・直す）

- **R-01（arc）**: emitter も共有の決め方を使う（1.6）。FR5 に試験を足す: 「設定 file にだけ接続先がある時、SessionStart の emitter の保存先が変わらない」。具体は 4 の S5（SessionStart の決めの後に `process.env.AGENT_MEMORY_DATABASE_URL` が未設定のまま、worker の `createQuietStore` が `postgres` を開く）と S6（SessionStart が決めた接続先と worker が決めた接続先が別なら、worker は開かず `binding_drift`。1.6 の契約）。これに合わせて **FR7 の表を直す**: `src/kusabi-runtime-event-emitter.ts` は持ち越しではなく、この取り組みの対象。FR2 の入口の一覧にも足す。環境変数への書き込みで効いていた読み手の数（c2 の学び）は、27d7f8f の読みで **2**: (i) 4 つの loader の既定の `createStore()`、(ii) emitter の既定の store（`options.env ?? process.env`）。ほかに `AGENT_MEMORY_DATABASE_URL` を読む所（`codex-start`・`fleet-conversation-backfill`・`kusabi-fresh-session-fleet`・`kusabi-direct-fleet-rollout`・`post-tool-hook`・`migrate`）は、別の process で自分の環境を作る道具で、SessionStart の process の書き込みを受けない（grep 2026-11-15T23:37:49Z。作る時に取り直す）。
- **R-02（arc）**: Stop の拒否が依頼の fail-closed の範囲に入る（今は未知の `AGENT_MEMORY_DB_TYPE` と postgres でない `DATABASE_URL` を黙って SQLite にしている。S8 に反する）。席へ当てる前の確認に、「各席の起動の環境を読むだけで、拒否に当たる入力が無いか（名前だけ、値は出さない）」を入れる（7）。確かめるまで **OQ2 は未決のまま**、この計画を設計監査へ渡す。
- **R-03（arc）**: 設定 file の「無い」は ENOENT だけ（1.1 の adapter）。空の文字・`null`・文字列でない `database_url` は、宣言されているのに使えない設定として `config_content` で拒否する。**FR5.4 の拒否の組に足す**: 設定 file の `database_url` が空の文字・`null`・数・postgres でない文字列、設定 file の読みが ENOENT 以外で失敗（権限を外した file）。
- **R-04（arc）**: `requirements-analysis-questions.md` に Q7 を足した（OQ3 の問いと arc の答え。Owner の言葉とは書いていない）。
- **R-05（arc）**: 100% の網羅率の対象は、この PR が足した行と変えた行（base との差分の追加行）。file 全体の網羅率は、この PR では数えない（NFR6 の読みを 1 つに固定する。前の取り組みの `coverage-method.md`〔261110〕と同じ数え方（`NODE_V8_COVERAGE` を全試験に付けて足す）で、変えていない既存の行を床の対象にしない）。ただし測りの script は 261110 の物を byte 同一で写さない: 変えた file が読み込まれていない・報告に無い・報告が空の入力を 0 と数えず失敗にする（設計監査 1 回目 SR-BF-03。D11・U14）。数えから外す行は PR に理由を書く。
- **OQ1** は D2 で決めた。**OQ4**: `restart-cli` の成功の出力は変えない。拒否は新しい失敗の道で、標準エラーの 1 行と終了コード 1 だけ（1.3）。**OQ5**: 27d7f8f を読んで確かめた。Gemini（`gemini-session-start.ts:502-503`）と Antigravity（`antigravity-session-start.ts:213-214`）は Claude と同じ「`resolveCodexStoreBinding()` の後に `createStore({ skipPostgresMigrations: true })`」の 2 行で、同じ置き換えで足りる。`restart-cli` の `prepare` は `main` の `createStore()`（`restart-cli.ts:291`）を `fetch` と共有する。`codex-hook-installer.ts` は `createStore` も binding も持たない（読んだ所では store の code が無い）ので、変更の対象から外す。**OQ2** は上の R-02 のとおり未決。**OQ3** は Q7 のとおり（読んだ版 = 27d7f8f）。
- **機械で数えた事実（時点 2026-11-15T23:37:49Z、27d7f8f の内容。作る時に取り直す）**: `createStore(` の呼び出し（試験を除く src）は 16 行（定義 1 行を含む）。環境変数の名前や `database_url` の literal（探す語 = `AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`database_url` のどれか）を持つ src の file（試験を除く）は 8 つ: `codex-start.ts`・`fleet-conversation-backfill.ts`・`codex-session-start.ts`・`kusabi-direct-fleet-rollout.ts`・`kusabi-fresh-session-fleet.ts`・`kusabi-runtime-event-emitter.ts`・`post-tool-hook.ts`・`stores/index.ts`。このうち `codex-session-start.ts` と `kusabi-runtime-event-emitter.ts` は決め方の literal を消す。`stores/index.ts`（`resolveStoreBackend`）と `post-tool-hook.ts` は持ち越し。`codex-start.ts`・`fleet-conversation-backfill.ts`・`kusabi-direct-fleet-rollout.ts`・`kusabi-fresh-session-fleet.ts` は、子 process や道具のために URL を組む・既定値を持つ物で、hook の保存先を決める入口ではない（FR7 の表には無かったので、ここで持ち越しの一覧に足す。5 の Step 11 の機械の確かめの許す一覧に、理由つきで入れる）。探す語に、環境変数の名前だけの `DATABASE_URL` も足すと、さらに 3 file が当たる（同じ時点・同じ内容の読み）: `src/migrate.ts`（表の移行を流す道具で、`process.env.DATABASE_URL` を直に読む。hook の保存先を決める入口ではないので持ち越しの一覧に足し、理由を書く）、`src/redact.ts`（秘密を伏せる正規表現で、保存先を決めない）、`src/measure-kusabi-functional.ts`（別の環境変数 `KUSABI_G2_DATABASE_URL` を読む測りの道具）。Step 11 の機械の確かめは、この 4 つの語で探し、許す一覧を当たった 11 file 全部について理由つきで持つ。`createStore` を通らずに store を直に組む所（`new PgStore(`・`new SqliteStore(`・`new JsonStore(` の、試験を除く src の呼び出し。同じ時点の読み）は、`src/stores/index.ts`（`createStore` の中）・`src/kusabi-runtime-event-emitter.ts`（この取り組みの対象）・`src/fleet-conversation-backfill.ts`（持ち越しの一覧にある）・`src/measure-kusabi-functional.ts`（測りの道具。上の一覧にある）・`src/kusabi-continuity-interruption-e2e.ts`（引数の `config.backend`・`config.location` で組む確かめの道具で、環境変数や設定 file から保存先を決めない。4 つの語のどれも持たないので、Step 11 の許す一覧には入れず、直さない。見落としでないことを示すために名前だけここに残す）。

## Testing Contract

```json
{
  "version": 1,
  "methodology": "custom",
  "source": "team",
  "ordering": "成功の条件の場面（担当交代と再起動の後に取り出せるか）の試験を、その場面を作る実装より先に書いて失敗を確かめ、細かい試験は試験できる層ごとに実装の後に書いて動かす。",
  "scope": "bugfix",
  "test_strategy": "minimal",
  "project_type": "brownfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    },
    {
      "layer": "team",
      "text": "- **Methodology**: custom\n- **Methodology evidence**: 成功の条件は「担当交代と再起動の場面を決めた試験で取り出せる割合 100%」（D-06・D-26・D-27）なので、その場面の試験を先に固めて完了の判定をぶれさせない。細かい試験は、今の自前の tsx のスクリプトの形に合わせて実装の後に書く（面談の Q3 = C）。\n- **Ordering**: 成功の条件の場面（担当交代と再起動の後に取り出せるか）の試験を、その場面を作る実装より先に書いて失敗を確かめ、細かい試験は試験できる層ごとに実装の後に書いて動かす。\n- 網羅率: 行の網羅率 100% を床にし、統合の前に CI で確かめる。Build and Test の段でも 100% を確かめ、段を通すために弱めない（社内基準 100% = Owner の決定 OD-COMPANY-AIDLC-LINE-COVERAGE-FLOOR-100-20261105-001、iyasaka-arc#49 6647418162。org.md の既定 80% より厳しい床をここで定める）。届かない行を数えから外す時は、PR に理由を書いて独立の監査で見る。\n- PostgreSQL の試験は、最初は手元で回し、結果を PR に証拠として載せる。置き場所の設計が固まった所で CI に入れる。CI の workflow を変える時は owner の exact-head を得る（面談の Q5 = C）。\n- CI（.github/workflows/ci.yml）は Node 18・20・22 で型検査・ビルド・試験を回す。今ある試験は通ったまま保つ。\n\n- 行の網羅率は、組み込みの lcov を file ごとに足す形より、NODE_V8_COVERAGE を全試験につけて process をまたいで足す方が、hook を子 process で起動する場合も数えられる。集計は手作業にせず、監査の席が同じ数字を出せる script にする（OmotenasuAI でも、c8 をそのまま包むと子 process と worker が別に数えられる罠が見つかっている）。 (learned 2026-11-11)"
    },
    {
      "layer": "project",
      "text": "- 試験や確かめの script で既定の createStore() を呼ぶと、JSON の store の置き場が homedir() から決まり、この Mac の実際の保存先に行が入る。必ず一時の HOME を指定して動かす（11-11 の code-generation で conversation-events.json・raw-events.json に試験の行が入った）。 (learned 2026-11-11) \n\n- 手元で使い捨ての PostgreSQL を起動する時は、Unix socket の path が長いと起動できないので socket を切って（unix_socket_directories を空）127.0.0.1 の TCP だけにし、試験が英語の誤り文（duplicate key）を照合するので lc_messages=C を付ける。 (learned 2026-11-11) \n\n- 別に流す型検査は、流した設定の内容と対象の file を記録に書く（前回の記録は設定が無く再現できなかった）。 (learned 2026-11-11) \n\n- core の試験（src/test.ts）を手元で流す時は、試験の親 folder を KUSABI_TEST_TMPDIR（CI は RUNNER_TEMP）で渡し、使い捨ての HOME の中に .agent-memory の folder を先に作る。どちらかが無いと、code の失敗ではなく環境の誤りで止まる（前者は KUSABI_TEST_TMPDIR_REQUIRED、後者は macOS の /var と /private/var の綴りの違いで isolation の 1 件が落ちる）。 (learned 2026-11-13) \n\n- 手元の PostgreSQL の試験（test:pg）は、CREATE EXTENSION vector を入れた DB に向けて流す。入れていないと type \"vector\" does not exist で終了コード 1 になる（環境の誤りで、code の失敗ではない）。 (learned 2026-11-13)"
    }
  ],
  "obligations": {
    "strategy": "minimal",
    "strategy_volume": [
      "One verifiable test per requirement at the narrowest effective level.",
      "At least one happy-path unit test per component.",
      "Unit tests are the default; a bugfix/security scope floor may require an integration or E2E regression when that is the narrowest level that reproduces the defect."
    ],
    "scope_floor": [
      "Include a targeted regression for the bug or vulnerability.",
      "Keep the existing test suite green."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "custom",
    "runner_step": "Verify the existing test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Verify the existing test runner/configuration and record the exact unit-scoped command.",
      "Custom ordering - 成功の条件の場面（担当交代と再起動の後に取り出せるか）の試験を、その場面を作る実装より先に書いて失敗を確かめ、細かい試験は試験できる層ごとに実装の後に書いて動かす。",
      "Implementation and tests - preserve that exact ordering; do not convert it to layer-local TDD.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:95fa886496a1b9c329c61ed3d23f006bbe5c29384df1a2668bb4d961dcf9d4e9",
  "contract_sha256": "sha256:0d4ca0134805e36a2576f7f68e9e643c5e5f9285eef3e520ccd9b6691d8a0d6f"
}
```

## 4. 試験の計画（要件 ID ごと。先に書く「場面」の試験は S で、細かい試験は U）

使い捨ての環境の決まり（要件の FR5.7・project.md の学び）: 一時の `HOME`（中に `.agent-memory` を先に作る）、`KUSABI_TEST_TMPDIR`、`lc_messages=C` と `CREATE EXTENSION vector` を入れた使い捨ての PostgreSQL（socket を切って 127.0.0.1 の TCP だけ）。ほかの保存先に書く試験は書かない。

| ID | 場面・内容 | 要件 | 種別 | PostgreSQL |
|---|---|---|---|---|
| S1 | 設定 file にだけ `database_url`（自分の machine の閉じた port を指す、資格情報の無い postgres の形の URL。接続できない）がある一時の HOME で、Stop の 2 つの hook（`session-rotation-stop` の保存の回・`transcript-stop-capture`）× 2 つの host を既定の store で動かす。直す前は既定の SQLite を開いて「保存」し、SQLite の file が作られる。直した後は PostgreSQL を試みて接続できず `failed_open`、SQLite の file が作られない | FR5.2・FR5.6・FR1.4 | 場面（先） | 不要（CI で流れる）|
| S2 | 書いた保存先と読む保存先が同じ: 設定 file にだけ接続先がある形で、Stop が保存した引き継ぎ（`saveTaskState`）を `handoff-source` が同じ保存先から読み戻す。使い捨ての PostgreSQL に、Stop の保存の後に `readTaskStatesReadOnly` の読み戻しが同じ行を返す。直す前は、Stop は SQLite に書き、reader は PostgreSQL を見て 0 件 | FR5.5・FR2.4 | 場面（先） | 要る（手元）|
| S3 | 同じ環境（9 つの入力の組: 環境変数だけ・設定 file だけ・両方・`sqlite` 明示・`json` 明示・何も無い・`database_url` の無い設定 file・`postgres` 明示+環境変数の URL・`postgres` 明示+設定 file の URL）で、SessionStart・Stop・`restart-cli` の決めが同じ `backend` と `source` を返す | FR5.1・FR2.6 | 場面（先） | 不要 |
| S4 | `database_url` を持つ設定 file がある時、環境変数が `sqlite`・`json` を明示しない限り、根拠が `local_default` の SQLite を選ばない | FR5.3 | 場面（先） | 不要 |
| S5 | emitter（R-01）: 設定 file にだけ接続先がある席で、SessionStart の決めの後も `process.env.AGENT_MEMORY_DATABASE_URL` が未設定のまま、worker の `createQuietStore` が `postgres` の store を開く（`backend` を観測）。直す前は環境変数への書き込みで開く道と、書き込みが無ければ SQLite を開く道が分かれる | R-01・FR5 の足し | 場面（先） | 要る（手元）|
| S6 | emitter の接続先の確かめ（SR-BF-02。1.6 の契約）: 接続先の違う 2 つの PostgreSQL の URL A・B（どちらも 127.0.0.1 の別の port で待ち、接続を受けたら数えてすぐ閉じる listener。PostgreSQL の言葉は話さない）で、SessionStart の証拠と target の binding は A のもの、worker が決める接続先（設定 file か環境変数）は B。worker の道（差し込み口を使わない `emitKusabiRuntimeEvent`）で 1 回と `createQuietStore` を直に 1 回、どちらも結果が `binding_drift`、B の listener への接続が 0 件、成功と数えない。同じ形で SQLite の path A・B（B の path に file が作られない）。正例の対（env = A）は、A の listener に接続が 1 件以上で、`binding_drift` にならない（決めた接続先を開いたことを観測する）。決めが 1 回であること（`resolveStore` の呼び出しが worker の 1 回の実行で 1 回、設定 file の読みが最大 1 回）も数える。直す前は、worker が B を開き（接続が B に 1 件以上）、結果が `binding_drift` でなく `store_unavailable` になる（直す前の code で流せるのは worker の道の 1 回。`createQuietStore` を直に呼ぶ場合は、export を足す Step 10 の後に書く）| R-01・SR-BF-02 | 場面（先） | 不要（CI で流れる）|
| U1 | 核 `decideStore` の表: FR1.2 の 5 つの行の順・環境変数が決める時は `readConfig` を呼ばない・空の環境変数の URL は未設定と同じ・大文字小文字 | FR1.1・FR1.2 | 単体 | 不要 |
| U2 | 拒否の組（FR5.4 + R-03）の全部で、閉じた理由の 1 つを返し、値・URL・path を含まず、store を開かず、SQLite の file も作られない: 未知の `AGENT_MEMORY_DB_TYPE`、postgres でない環境変数の URL、設定 file が symlink・ディレクトリ、権限を外した設定 file（ENOENT 以外の読みの失敗）、JSON でない、object でない（配列・`null`）、`database_url` が空・`null`・数・postgres でない、`postgres` 明示で接続先が無い（設定 file も無い・`database_url` が無い）| FR1.3・FR1.4・FR5.4 | 単体 | 不要 |
| U3 | adapter `readUserConfig`: ENOENT だけが `absent`、それ以外の失敗は `config_read`、`JSON.parse` の失敗は `config_content` | R-03 | 単体 | 不要 |
| U4 | 不透明な接続先: `JSON.stringify`・`util.inspect`・文字列化・誤りの文・証拠のどれにも URL が出ない。`reveal()` だけが返す | NFR1・FR1.3 | 単体 | 不要 |
| U5 | `createStore({ resolution })`: 3 つの `backend` を開き、stderr の行は今のまま（`ignores_postgres_url` の注意の行を含む）。`resolution` を渡さない呼び出しは今のまま。`openResolvedStore` は、開いた store の `backend` が違えば閉じて失敗にする | FR2.5・FR3.5 | 単体 | 一部要る |
| U6 | SessionStart の証拠: 直す前に 27d7f8f の `resolveCodexStoreBinding` で取った表（Step 3。digest は作り方から組んだ期待値）と、新しい `resolveSessionStartStore` の `binding` が 9 つの組で deep equal。環境変数へ書き込まない（`process.env` と渡した `env` の差が 0）。拒否は `HookDegradedError` | FR2.1・FR3.3・R-01 | 単体 | 不要 |
| U7 | Stop の証拠: 保存した回に `store_backend`（観測）と `store_source`、busy・none・blocked・拒否・malformed の回は両方 `null`。URL・path・digest が無い。seam に `backend` が不一致の store を入れると失敗になる。拒否の回は `store_refused:<理由>` で、出力は「続ける」のまま、`transcript-stop-capture` の `outcome` は `unobserved`（成功と数えない）| FR4・FR3.2・FR3.5 | 単体 | 不要 |
| U8 | `rotation-commit`: 結果で store を開いて `consumeSelectedRestartPack` が走る。結果も seam も無ければ開かず `consume: "unknown"`。開いた store の `backend` の不一致で失敗 | FR2.3 | 単体 | 不要 |
| U9 | `restart-cli`: `handoff-source` の拒否は標準エラーに理由の種類だけ・終了コード 1・標準出力は `unreadable` の JSON（他の読めない保存先と同じ）。成功の出力は直す前と同じ。`fetch`・`prepare` の拒否は標準エラーに理由の種類だけ・終了コード 1・標準出力なし。reader が結果なしで呼ばれた時の拒否は `unreadable` | FR2.4・FR3.4・OQ4 | 単体 | 不要 |
| U10 | emitter: 拒否は `store_unavailable`、JSON は fixture 専用として拒否のまま、`backend_drift`・`binding_drift` の今の経路（SessionStart の証拠と target の値どうしの比べ）は変わらない。worker の接続先の比べ（1.6 の契約）: digest が違えば store の構成（`PgStore`・`SqliteStore` の生成）が 0 回、同じ結果から digest と store が作られる（`resolveStore` が 1 回）、公開の差し込み口 `options.createStore` の型は変わらない | R-01 | 単体 | 不要 |
| U11 | 決め方の literal の数（S3、NFR3）: 試験を除く `src` の中で、環境変数の名前と `database_url` と URL の形の検査を持つ file が、`store-resolution.ts` と 5 の Step 11 の許す一覧（持ち越し。理由つき）だけ | NFR3 | 機械の確かめ | 不要 |
| U12 | DB の確認: DDL の行（`CREATE`・`ALTER`・`DROP`・`pg-migrations` の変更）が差分に 0 件。使い捨ての PostgreSQL に `pg-migrations` を流し、Stop の保存の経路が流す statement が名指す表と列（`pg` の query を記録して構文から取る。取れない statement があれば失敗）が `information_schema` に全てある | FR6.1・FR6.2 | 機械の確かめ | 要る（手元）|
| U13 | CI への到達（D10。SR-BF-01）: `.github/workflows/ci.yml` の `run:` の行（`&&` と改行で分ける）から、`npm run <名前>` を `package.json` の scripts でたどった到達の集合（循環は 1 回だけ数える）に、`src/test-store-resolution.ts` と `src/test-store-resolution-scenario.ts` の `tsx` の行が入る。負例の自己試験: 試験の中で組んだ「新しい試験の連なりを外した `package.json` の写し」と「`test` の連なりだけに足した写し（この計画の最初の版）」で、同じ確かめが失敗する。PostgreSQL の試験（`test-store-resolution-pg.ts`）は対象外（CI に PostgreSQL が無い）。限界: 連なりから外れると U13 自身も流れなくなる（D10）| NFR8・FR5.8 | 機械の確かめ | 不要 |
| U14 | 網羅率の測りの負例（D11。SR-BF-03）: 測りの script に、6 つの入力を与えて結果を確かめる。n1 報告が空 → 失敗（数えられない）。n2 変えた file が「読み込まれていない」→ 失敗、その file の追加行の全部が未実行。n3 変えた file の節が報告に無い（別の file だけある）→ 失敗。n4 変えた 2 file のうち 1 つだけ読み込まれていない → 失敗。n5 読み込まれた file で、0 回の範囲が追加行に重なる → 失敗。n6 正例: 全部読み込まれ、0 回の範囲が追加行に重ならない → 成功（終了コード 0）。どの失敗も終了コードが 0 でなく、`uncovered_ranges_in_changed=0` のような「0 件」の行だけを根拠にした成功を出さない | NFR6・R-05 | 機械の確かめ（手元）| 不要 |
| E1 | 意図的な失敗（SR-BF-01。実装の PR を出す前に 1 回）: 作業場で `src/test-store-resolution-scenario.ts` の先頭に失敗を一時的に足し、`ci.yml` の step「Run native recovery and automatic receive tests」の `run:` の文字をそのまま `bash -e` で使い捨ての HOME で流して、step が 0 でない終了コードで終わり、出力が新しい試験の file を指すことを確かめる。戻して、その file の差分が 0 行であることを確かめる。失敗する commit は push しない | NFR8 | CI の確かめ（手元）| 不要 |
| C1 | CI の log（SR-BF-01。実装の PR の CI の後）: `gh run view <run> --log` の 3 つの Node の版の job それぞれに、新しい試験 2 file の終わりの行（`store-resolution: <件数> checks passed`・`store-resolution-scenario: <件数> checks passed`）が出る。1 つでも欠ければ失敗として PR に書く。件数は出力から写す | NFR8 | CI の確かめ | 不要 |

直す前の code に対する S1〜S6 の失敗は、失敗の出力を `unit-test-instructions.md` の「失敗の確かめ」の節に書く（FR5.6）。今ある試験は通ったまま保つ（FR5.8）。

## 5. 作る手順（チェックボックスは、この段で終わった所から付ける）

作る場所は、最新の `origin/main` から切った別の作業場（worktree）。branch の名前は `kusabi/store-resolution-261113`。設計の監査が PASS するまで、Step 1 以降は始めない（この計画と `unit-test-instructions.md` と RE・RA の記録だけを設計の PR に出す）。作る役（`aidlc-developer-agent`）の呼び出しは、この取り組みで受けた Owner のサブエージェントの承認の範囲に入るかを段の始めに確かめ、範囲外ならこの席が自分で書く。

- [x] **Step 1 — 構成と版の取り直し**: worktree を作る。27d7f8f から `origin/main` が進んでいたら、関数名と呼び出し（`createStore(` の行・`resolveCodexStoreBinding` の呼び出し・`postgresUrl`・Stop の証拠を読む所）を取り直し、変わった所を `code-summary.md` に書く。`src/store-resolution.ts` は型と閉じた理由の集合だけの骨を置く。新しい外部の依存は足さない（NFR9）。
- [x] **Step 2 — 試験の命令の確かめと CI への接続**（D10）: 既存の試験の命令を、一時の HOME と `KUSABI_TEST_TMPDIR` で流して今の結果（全部通る）を記録に書く。`package.json` に `test:store-resolution`（`tsx src/test-store-resolution.ts && tsx src/test-store-resolution-scenario.ts`）と `test:store-resolution-pg`（`tsx src/test-store-resolution-pg.ts`）を足し、`npm run test:store-resolution` を **`test:claude-hook` の連なりの最後**（CI の step が今呼ぶ。27d7f8f の `ci.yml` は `npm test` を流さない）と、`test` の連なりの最後（手元の全体の実行用）に足す。workflow は変えない。到達の確かめ U13 を書いて流し、前の版の形（`test` の連なりだけ）で失敗する負例も流す。
- [x] **Step 3 — 直す前の動きを表に取り、場面の試験を先に書いて失敗を確かめる（カスタムの順序）**: (a) 27d7f8f の `resolveCodexStoreBinding` に S3 の 9 つの組を（`env` の写しを渡して）流し、戻り値の `source`・`backend_intent`・`verified`・`credentials_embedded`・`config_path_sha256` の有無を、試験の file に literal の表として書く（U6 の元）。digest は、machine ごとに path が違うので literal にせず、作り方（`kusabiStoreBindingSha256(backend, 接続先か path)`・設定 file の path の `sha256(resolve(path))`）から試験の中で期待値を組む。その期待値が、旧い関数の戻り値そのものと一致することを、この Step で 1 回確かめて記録に書く（表が旧い動きを写している証拠）。(b) S1〜S6 を書き、直す前の code で流して、失敗が不具合の理由（SQLite を開いた・読み手が別の保存先を見た・環境変数の書き込みに頼った・worker が SessionStart と別の接続先を開いた）で起きることを確かめ、出力を記録に残す（試験が読み込みの失敗で落ちているだけの場合は、場面の試験として数えない）。
- [x] **Step 4 — 核と adapter**（FR1）: `decideStore`・`readUserConfig`・`resolveStore`・不透明な接続先。U1〜U4 を書いて流す。
- [x] **Step 5 — 結果を受けて開く**（FR2.5・FR3.5）: `createStore({ resolution })`・`openResolvedStore`・`resolveStoreBackend` の注釈。U5。
- [x] **Step 6 — SessionStart**（FR2.1）: `storeBindingSha256` と、digest の作り方の移し替え（1.1）をここで行う。`resolveSessionStartStore` を作り、4 つの loader を置き換える。`resolveCodexStoreBinding` に残る呼び出しが無ければ消す（残して 0 回の行を作らない）。`LoadedCodexRecovery` と Claude 側の同じ型・実行結果に `store_resolution` を足す。U6。
- [x] **Step 7 — Stop 2 種**（FR2.2・FR3.2・FR4）: 1.3・1.5 のとおり。U7。S1 が通ることを確かめる。
- [x] **Step 8 — `rotation-commit`**（FR2.3）: `answerHookAndCommit` が `store_resolution` を受け、`commitRotationRecovery` が開く。`openDefaultStore`（環境変数だけの `createStore()`）を消す。U8。
- [x] **Step 9 — `restart-cli` と読むだけの reader**（FR2.4・FR3.4）: 1.3 のとおり。U9。S2 が通ることを確かめる（手元の使い捨ての PostgreSQL）。
- [x] **Step 10 — emitter**（R-01・SR-BF-02）: 1.6 の契約のとおり。`createQuietStore` を `(env, expectedBindingSha256, signal)` にして名前つきで export し（S5・S6・U10 が直に呼ぶため）、worker の本体は `request.target.storage.binding_sha256` を渡す。決めた結果から `storeBindingSha256` で digest を作り、store を作る前に比べ、同じ結果で store を作る。公開の `options.createStore` の型は変えず、注釈を直す。U10。S5・S6 が通ることを確かめる（S6 は、B への接続が 0 件であることを数える）。
- [x] **Step 11 — 機械の確かめ**: U11（許す一覧は、3 の「機械で数えた事実」の持ち越し 9 file〔`stores/index.ts`・`post-tool-hook.ts`・`codex-start.ts`・`fleet-conversation-backfill.ts`・`kusabi-direct-fleet-rollout.ts`・`kusabi-fresh-session-fleet.ts`・`migrate.ts`・`redact.ts`・`measure-kusabi-functional.ts`〕と `store-resolution.ts`。作る時に取り直す）と U12 を作って流す。あわせて E1（意図的な失敗。4 の表）を流して、出力を `unit-test-instructions.md` に残す（失敗する commit は push しない）。
- [x] **Step 12 — 網羅率と型検査**（R-05・D11・SR-BF-03）: この取り組みの `coverage-method.md` に、2 つの script（`merge-zero.mjs`・`changed-uncovered.py`）を、前の取り組み（261110）の物を **byte 同一で写さず**、次の仕様で書く。
  - 対象: base（`origin/main` の merge-base）との差分の追加行を持つ file のうち、`src/` の試験でない物（`src/test` で始まる file と `src/` の外は除き、除いた file の名前を出力に出す）。
  - 対象の file ごとに状態を 1 つ付ける: `LOADED`（読み込んだ process が 1 つ以上。0 回の範囲と追加行が重なる行を未実行に数える）・`NOT_LOADED`（どの process も読み込んでいない）・`MISSING`（報告に file の節が無い）。`NOT_LOADED` と `MISSING` は、追加行の全部を未実行に数え、数えられない file として別に数える。
  - 報告が空（節が 0 個）・読み込んだ process が全体で 0 の時は、数えられない（`UNKNOWN`）。
  - 終了コード: 未実行の追加行が 1 行以上、または `NOT_LOADED`・`MISSING`・`UNKNOWN` が 1 つでもあれば 0 でない。最後の 1 行は `RESULT PASS|FAIL changed_files=<数> changed_lines=<数> uncovered_lines=<数> unreadable_files=<数>` の形にする（「0 件」の行だけを根拠にした成功を出さない）。
  - 先に U14 の 6 つの負例（4 の表）を流し、出力を記録に残してから、本体を流す。本体は `NODE_V8_COVERAGE` を全試験（`unit-test-instructions.md` の命令の表の全部）に付けて流し、`RESULT PASS` かつ `uncovered_lines=0` と読めた時だけ、100% を満たしたと書く。
  - 型検査は `tsc` の strict（`npm run build` と同じ設定）で流し、設定の内容と対象 file を記録に書く。
- [x] **Step 13 — 設計の文書**（権限と待機の規則の R3。設計に無い挙動を足したら設計にも足す）: 保存先の決め方を書いた文書（`docs/operations/HOST_ADAPTERS.md` ほか。`grep` で取り直す）を、新しい決め方・Stop の証拠の 2 項目・拒否の動きに合わせて直す。
- [x] **Step 14 — 記録**: `code-summary.md` と `traceability.json`（6 の表の全 ID が、実在する file を指す）。作業の log と engine の内部（`audit/`・`.aidlc-engine/`）は単位の PR に入れない。
- [ ] **Step 15 — 見直し役と報告**: 段の手順の見直し役の後に `report` する。実装の PR の CI が終わったら C1（CI の log に新しい試験の終わりの行が 3 つの Node の版すべてで出ること）を確かめ、PR の本文に書く。

## 6. DB の基準の照らし

この取り組みは表・列・index・migration を足さず、DB の設計の記録を作らない（DDL の行 0 件。U12 で機械で確かめる。FR6.1）。DB の基準（commit `a48602d3fcf70a5b04a07cf70bcf6824ff259818`、file の SHA-256 `048c0062d0930756400b96c5539f1a7850924f454e17fe002c58a6791e655036`）は、書く前に版を固定して読んで SHA-256 が案内の値と一致することを、要件の記録（4）で確かめてある。Part B の B1（入力の表 1〜3）と B3（出力の型）の対象になる新しい設計は無く、`deviation_ledger` に書く規格からの外れも無い（上の 2 の D1〜D11 は DB の規格ではなく設計・実装の標準 S1〜S9 についての判断）。規格 Part A のうち当たる項目は、移行（S6 = A8。migration を足さない）と冪等（S7 = A10。Stop の保存の経路は変えない）。保護面（DB の書き込みの経路を持つ code）に触れるので、設計監査を 1 回受け、実装の後にもう 1 回受ける（`team.md`）。本番の DB には触れない（Q2 = A。Owner の言葉）。

## 7. 席へ当てる前の確認（Owner と arc が別に見る。この取り組みの中では何も実行しない）

読むだけで確かめ、変更しない。名前だけを見て、値（URL・資格情報）は出さない。

1. （R-02。OQ2 を閉じる確認）各席の起動の環境に、拒否に当たる入力が無いか: 未知の `AGENT_MEMORY_DB_TYPE`、postgres の形でない `DATABASE_URL` / `AGENT_MEMORY_DATABASE_URL`。あれば、その席の Stop は今は黙って SQLite に書いていて、直した版では `failed_open` になる。
2. 設定 file にだけ接続先がある席の一覧（今 Stop が既定の SQLite を開いている席）。この席は、直した版で初めて PostgreSQL に書く。
3. 本番の PostgreSQL に、Stop の保存が使う表と列があること（U12 が出す「確かめたい表と列の一覧」を渡す。FR6.3）。
4. 持ち越しの入口（3 の「機械で数えた事実」のとおり）が、どの保存先を開いているか（`createStore()` が標準エラーに出す行を証拠にする）。
5. 壊れた `memory.db` を動かすか。直した版が入った後に、別に Owner が決める（この取り組みでは触れない）。
6. 新旧の hook が同じ席の束に同時にいる間の動き（証拠は足すだけなので旧い読み手は壊れない。D2）。

## 8. 追跡（要件 ID → 手順 → 試験。`traceability.json` の元）

| 要件 | 手順 | 試験 |
|---|---|---|
| FR1.1〜FR1.6 | Step 4 | U1・U2・U3・U4 |
| FR2.1 | Step 6 | U6・S3 |
| FR2.2 | Step 7 | U7・S1 |
| FR2.3 | Step 8 | U8 |
| FR2.4 | Step 9 | U9・S2 |
| FR2.5・FR2.6 | Step 5・Step 6 | U5・S3 |
| FR3.1〜FR3.5 | Step 4・5・6・7・9 | U2・U5・U7・U9 |
| FR4.1〜FR4.4 | Step 7 | U7 |
| FR5.1〜FR5.8 | Step 3・Step 2 | S1〜S6・U2・既存の試験 |
| FR6.1〜FR6.3 | Step 11 | U12 |
| FR7 | Step 11・Step 14 | U11 |
| NFR1 | Step 4 | U4・U7 |
| NFR2 | Step 4・7 | U1・U7 |
| NFR3 | Step 11 | U11 |
| NFR4 | Step 4 | U1（環境で決まる時に file を読まない）|
| NFR5 | Step 7・9 | U7・U9 |
| NFR6 | Step 12 | 網羅率の script・U14（負例）|
| NFR7 | Step 7 | U7（const を動かさない）|
| NFR8・NFR9 | Step 1・Step 2・Step 11・Step 12・Step 15 | CI の Node 18・20・22、依存の差分 0、新しい試験の CI への到達（U13・E1・C1）|
| R-01 | Step 10 | S5・S6・U10 |
| R-02 | 7 の 1 | 席へ当てる前の確認 |
| R-03 | Step 4 | U2・U3 |
| R-05 | Step 12 | 網羅率の script・U14（負例）|

## 9. Sources

- 承認済みの要件: `inception/requirements-analysis/requirements.md`（FR・NFR・AS・OQ）、`requirements-analysis-questions.md`（Q1〜Q7）。Reverse Engineering の記録（codekb）と取り組みの説明（`project-description.json`）は要件の Sources のとおり。
- arc の持ち越しの決め R-01〜R-05（Requirements Analysis の承認の時に受けた。arc の答え = Owner の委任 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6762288830。Owner の言葉ではない）。
- コード（`origin/main` の 27d7f8f）: `src/stores/index.ts`（`resolveStoreBackend`・`createStore`）、`src/codex-session-start.ts`（`resolveCodexStoreBinding`・`postgresUrl`・`kusabiStoreBindingSha256`・`localStoreBindingSha256`）、`src/claude-session-start.ts`・`src/gemini-session-start.ts`・`src/antigravity-session-start.ts`（loader の頭）、`src/session-rotation-stop.ts`（`withStore`・`evidence`・`failedEvidence`）、`src/transcript-stop-capture.ts`（`runTranscriptStopCapture`）、`src/rotation-commit.ts`（`openDefaultStore`・`answerHookAndCommit`）、`src/restart-cli.ts`（`runHandoffSource`・`main`）、`src/stores/read-only-task-states.ts`、`src/rotation-handoff-source.ts`、`src/kusabi-runtime-event-emitter.ts`（`createQuietStore`・`emitPreparedEvent`）、`src/stores/types.ts`（`Store.backend`）、`tsconfig.json`、`package.json`（試験の命令）、`.github/workflows/ci.yml`（CI が呼ぶ命令。D10）。設計監査 1 回目の返却（https://github.com/watchout/agent-memory/pull/346#issuecomment-6904207773。SR-BF-01〜03）で、D1・D10・D11・1.6・Step 2・Step 12 を直した。
- 決まり: 設計・実装の標準 S1〜S9、DB の基準（上の 6）、`team.md` の試験の決まり・網羅率の決まり、`project.md` の学び（一時の HOME・使い捨ての PostgreSQL・型検査の記録・同じ入口に束ねる・環境変数への書き込みの副作用・dirty の作業場）。前の取り組みの網羅率の測り方: `aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/coverage-method.md`。
