# 要件 — 保存先の決め方を 1 つの関数にする（取り組み 261113-store-resolution-fix）

この文書は、`requirements-analysis-questions.md` の Q1〜Q6 の答えと、依頼の文（取り組みの説明）と、読んだコードの事実から作った。答えの出どころは、Q2 だけが Owner の言葉（arc の端末の会話で受けた原文）、ほかは arc の答え（Owner の委任 #49 6762288830。Owner の言葉ではない）。コードの事実は `origin/main` の 27d7f8f の内容で、手元の作業場の `src`・`scripts`・`package.json`・`.github`・`docs/operations` が 27d7f8f と byte 単位で同じであることを 2026-11-15T23:08:29Z に突き合わせて確かめた（読んだ時点の事実。「読んだ版」の食い違いは 未決の問い OQ3）。

## 1. Intent analysis（何を達成したいか）

- 直す不具合: Stop の hook（`session-rotation-stop`・`transcript-stop-capture`）は保存先を環境変数だけで決める。設定 file（`~/.agent-memory/config.json`）にだけ接続先がある席では、SessionStart は PostgreSQL を開くのに Stop は既定の SQLite を開き、壊れた file に当たって保存に失敗する（読んだ事実: `createStore()` は `resolveStoreBackend()` で `process.env` だけを見る。SessionStart の `resolveCodexStoreBinding` だけが設定 file の `database_url` を読み、`env.AGENT_MEMORY_DATABASE_URL` に書いて `createStore()` に渡す）。
- 目的: 保存先の決め方（環境変数 → 設定 file の `database_url` → 既定の SQLite の順）を共有の 1 つの関数にし、書く側（Stop）と、その結果を読む側（restart-cli）と、SessionStart が同じ関数で決める。
- 成功の見え方（自社が管理できる範囲の指標だけ）: (a) 同じ環境で、入口どうしが同じ保存先を決める。(b) 設定 file にだけ接続先がある席で、Stop が書いた引き継ぎを `handoff-source` が同じ保存先から読み戻せる。(c) 設定 file が読めない時に、黙って既定の SQLite を開く経路が無い。(d) DB の構造は変わらない。
- 守る物の分類: DB の構造は変えず、本番にも資格情報にも触れない。席の設定・hook・見張り・本物の DB・tmux には何も実行しない（席への適用は Owner が arc の script を打つ形のまま）。

## 2. Functional requirements

### FR1 保存先を決める共有の関数（1 つ）

- FR1.1 入力は環境（`AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`DATABASE_URL`）と、設定 file の読み結果（無い・読めた内容・読めない理由）だけにする。時計・乱数・環境の自己取得をしない（S4）。file を読む所は薄い adapter に分け、関数の核は入力だけで答えが決まる。
- FR1.2 決める順（上から最初に当たった行で終わる。今の SessionStart の `resolveCodexStoreBinding` の動きと同じ）:
  1. `AGENT_MEMORY_DB_TYPE`（大文字小文字を区別しない）が `sqlite` か `json` → その種類。根拠は `environment`。URL と設定 file は使わない。
  2. `AGENT_MEMORY_DB_TYPE` が空でも `postgres` でもない → 拒否（未知の種類）。
  3. 環境変数の URL（`AGENT_MEMORY_DATABASE_URL`、無ければ `DATABASE_URL`。空の文字は未設定と同じ）がある → URL の頭の scheme 名が `postgres` か `postgresql` でなければ拒否（今の SessionStart の `postgresUrl` の検査と同じ形）。そうなら `postgres`、根拠は `environment`。
  4. 設定 file（`~/.agent-memory/config.json`）を調べる。無い → 5 へ。あるが symlink か通常の file でない → 拒否。JSON として読めない、または object でない（配列を含む）→ 拒否。`database_url` がある → 形が postgres でなければ拒否、そうなら `postgres`、根拠は `user_config`。`database_url` が無い → 5 へ。
  5. `AGENT_MEMORY_DB_TYPE` が `postgres`（URL がどこにも無い）→ 拒否。そうでなければ既定の `sqlite`、根拠は `local_default`。
- FR1.3 結果は `backend`（`postgres`・`sqlite`・`json`）、`source`（`environment`・`user_config`・`local_default`）、PostgreSQL の時だけの接続先、の 3 つ。接続先は結果を使う所から外（証拠・log・誤りの文）へ出さない。拒否は、閉じた理由の集合（未知の種類・環境変数の URL の形・設定 file の種類・設定 file の読み・設定 file の内容・接続先が無い）の 1 つを返し、値・URL・path を含まない。
- FR1.4 決められない時に黙って SQLite に落とさない（S8。依頼の fail-closed）。
- FR1.5 試験 (3) の読み方（Q4 = A）: 設定 file があっても `database_url` が無ければ、既定の SQLite（根拠 `local_default`）を選ぶ。試験 (3)「設定 file がある時は既定の SQLite を選ばない」は、「`database_url` を持つ設定 file がある時は、環境変数が `sqlite`・`json` を明示しない限り、根拠が `local_default` の SQLite を選ばない」と読む。
- FR1.6 語彙は SessionStart の既存の値（`environment`・`user_config`・`local_default`、`backend_intent` の `postgres`・`sqlite`・`json`）をそのまま使い、新しい語を作らない。

### FR2 同じ関数を使う入口

- FR2.1 SessionStart（Claude Code・Codex・Gemini CLI・Antigravity CLI の 4 つ）。今の「環境変数へ URL を書いて `createStore()` に渡す」形に頼らず、決めた結果を store を開く所へ渡す。SessionStart の証拠（`store_binding`）の形と値は変えない。
- FR2.2 Stop: `session-rotation-stop` と `transcript-stop-capture`、それぞれ Claude Code と Codex（同じ入口なので同じ直しに入る）。
- FR2.3 `rotation-commit`（Q1 = B）: 自分で `createStore` を呼んで決めず、同じ process の SessionStart が決めた結果を引数で受け取る。
- FR2.4 `restart-cli`（Q6 = B）: `handoff-source` の読むだけの口（`src/stores/read-only-task-states.ts` が環境変数だけで決めていた）と、`createStore()` を呼ぶ `fetch`・`prepare` の枝。Stop が書いた引き継ぎを、同じ保存先から読む（記録の欠けを防ぐ。同じ判断を 1 か所に置く。S3）。
- FR2.5 `createStore()` は結果を任意の引数で受け取れる。結果を渡さない呼び出し元（FR7 の持ち越しの入口）の動きは変えない（Q5 = A）。`resolveStoreBackend` の「ここで 1 か所に決める」という注釈は、新しい関数を指すように直す。
- FR2.6 同じ環境の入力で、FR2.1〜FR2.4 の入口が同じ結果（`backend` と `source`）を決める。

### FR3 失敗の時の動き

- FR3.1 拒否の時は、store を開かず、どの保存先にも書かない。
- FR3.2 Stop の 2 つの hook は、拒否でも host を止めない（出力は今のまま「続ける」）。証拠は `failed_open` とし、理由は FR1.3 の閉じた集合から 1 つ（値・URL・path を含まない）。
- FR3.3 SessionStart は今の「回復できない」扱い（`RECOVERY_UNAVAILABLE`）のまま。
- FR3.4 `restart-cli` は、拒否の時に終了コードを 0 以外にし、理由の種類だけを出す。
- FR3.5 store を開いた後、開いた store の `backend` が決めた `backend` と違えば、閉じて失敗にする（宣言と観測の突き合わせ。S5）。読むだけの口（`handoff-source`）は store を開かないので、決めた `backend` の保存先だけを読み、別の保存先を読まない。

### FR4 Stop 側の証拠（Q3 = A）

- FR4.1 `session-rotation-stop` と `transcript-stop-capture` の証拠の JSON に、保存先の種類（`store_backend`）と根拠（`store_source`）を足す。名前は code-generation の計画で確定する。値は FR1.6 の語彙。
- FR4.2 値は store を開いて観測した時だけ入れ、開かなかった時（保存しない回・拒否）は null にし、成功の印にしない。`store_backend` は開いた store の `backend` から、`store_source` は決めた結果から取り、宣言を写さない（S5）。
- FR4.3 URL・path・それらの digest・値は書かない。
- FR4.4 既存の項目は変えない。schema の const は動かさない（足すだけ。OQ1）。

### FR5 試験（成功の条件の場面を先に書き、失敗を確かめる）

- FR5.1 同じ環境で、SessionStart・Stop・`restart-cli` が同じ `backend` と `source` を決める（環境変数だけ・設定 file だけ・両方・`AGENT_MEMORY_DB_TYPE` が `sqlite`・何も無い・`database_url` の無い設定 file の組）。
- FR5.2 設定 file にだけ `database_url` がある時、Stop の 2 つの hook（Claude Code・Codex）が `postgres`・`user_config` を決める。
- FR5.3 `database_url` を持つ設定 file がある時は、根拠が `local_default` の SQLite を選ばない（FR1.5 の読み方）。
- FR5.4 拒否の組（未知の `AGENT_MEMORY_DB_TYPE`・postgres でない環境変数の URL・設定 file が symlink・通常の file でない・JSON でない・object でない・`database_url` の形が違う・`postgres` と明示して URL が無い）で、どの保存先にも書かず、SQLite の file も作らない。
- FR5.5 書いた保存先と読む保存先が同じ: 設定 file にだけ接続先がある形で、Stop が保存した引き継ぎを `handoff-source` が同じ保存先から読み戻す（arc の Q6 の答え）。
- FR5.6 FR5.1〜FR5.5 の試験は、直す前の code では失敗する（不具合を捕まえる試験であることを、失敗を見て確かめる）。
- FR5.7 試験は一時の `HOME`（と、core の試験は `KUSABI_TEST_TMPDIR` と `HOME` の中の `.agent-memory`）で動かし、この Mac の実際の保存先に行を入れない（project.md の学び）。
- FR5.8 今ある試験は通ったまま保つ。

### FR6 DB（構造を変えない）

- FR6.1 表・列・index・migration の追加と変更をしない（`git diff` の DDL の行が 0 件であることで確かめる。store の folder に file が増えるかどうかでは確かめない。project.md の学び）。
- FR6.2 Stop 側の保存が使う表と列が、`pg-migrations` を流した使い捨ての PostgreSQL に全てあることを、保存の経路（`saveTaskState`・`saveSelectedRestartPack`・`consumeSelectedRestartPack`・`saveRawEvent`・`saveConversationEvent`・`getRawEvents`）を動かす試験と、statement が名指す表と列を `information_schema` の結果と突き合わせる script で確かめ、結果を記録に書く（手で数えた値は記録に使わない）。
- FR6.3 本番の DB には触れない（Q2 = A。Owner の言葉）。本番に同じ表と列があるかは、席へ当てる前の確認として Owner と arc が別に見る。記録は、その確認に渡す「確かめたい表と列の一覧」を書く。

### FR7 持ち越しの記録（この取り組みでは直さない入口）

持ち越す入口ごとに、理由と確かめ方を記録に書く（Q5 = A、Q1 = B）。確かめ方は 2 つ: (a) 席の起動の環境（`AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`DATABASE_URL`）の有無を、席の設定を読むだけで確かめる（変更しない）。(b) `createStore()` が stderr に出す開いた保存先の行（PostgreSQL に接続した行、既定の SQLite を使う行）を、どの保存先を開いたかの証拠として読む。

| 入口 | 持ち越しの理由 |
|---|---|
| 席の MCP サーバー `src/index.ts` | 動いている席の道具の保存先が変わりうる。席への適用の確かめと一緒に別の取り組みで扱う |
| `src/boot.ts`・launcher の `claude-start`・`codex-start`・`kusabi-fleet-status-cli` | 同上（環境変数だけで決める入口） |
| `post-tool-hook`（Q1 = B） | installer が登録せず、今回の失敗の経路に無い。同じ判断が 2 か所にある形（S3）は持ち越しとして残し、次に触る時に直す |
| `src/kusabi-runtime-event-emitter.ts`（引数で渡された `createStore`、既定は環境変数だけで決める `createQuietStore`） | 同上（RE が見つけた間接の入口） |

## 3. Non-functional requirements

- NFR1 秘密の扱い: 接続先の URL（資格情報を含みうる）は、証拠・log・誤りの文・記録のどこにも出さない。設定 file の path は出さない（SessionStart の既存の証拠が持つ path の digest も Stop 側には足さない）。
- NFR2 決定性（S4・S5）: 関数の核は入力だけで答えを返し、同じ入力で同じ答え。証拠の値は観測（開いた store の `backend`）から取り、宣言（環境変数や設定）を写さない。結果は「一致・不一致・観測できず」の 3 値で、観測できずを成功に読み替えない。
- NFR3 知識を 1 か所に（S3）: 保存先を決める順と拒否の規則は新しい関数だけが持つ。同じ規則の literal（`AGENT_MEMORY_DB_TYPE` の読み・`database_url` の読み・URL の形の検査）が FR2 の入口と FR7 の持ち越し以外に残らないことを、機械で数えて記録に書く（時点を添える）。
- NFR4 時間: Stop の hook が持つ時間の上限（今の内部の締め切り）を変えない。決める処理は手元の file を 1 つ読むだけで、通信をしない。
- NFR5 失敗を隠さない（S8）: 拒否・不一致・保存の失敗は、成功と数えない証拠として残る。host を止めない（FR3.2）ことと、成功と記録しないことを分ける。
- NFR6 行の網羅率 100%: 変えた行と新しい行について、0 回の範囲を 0 にする。測り方は、全試験に `NODE_V8_COVERAGE` を付けて process をまたいで足す方法（前の取り組みの `coverage-method.md` と同じ形）で、監査の席が同じ数字を出せる script にする。数えから外す行は、理由を PR に書く。
- NFR7 互換と戻し（S6）: DB の構造を変えないので migration は無い。戻しは、その merge commit を戻す。配る時に新旧の hook が同時に動いても、証拠は足すだけ（FR4.4）で、旧い読み手が壊れない。
- NFR8 Node の版: CI は Node 18・20・22 で動く（`engines.node` は 20 以上。食い違いは codekb に記録済みで、workflow は保護面なのでこの取り組みでは触れない）。
- NFR9 新しい外部の依存を足さない。書式・静的検査の道具も足さず、型検査（`tsc` の strict）で進める。

## 4. DB の基準の照らし

- 読んだ版: `watchout/iyasaka-org` の `docs/shirube/db-standard.md`、commit `a48602d3fcf70a5b04a07cf70bcf6824ff259818`。file の SHA-256 は `048c0062d0930756400b96c5539f1a7850924f454e17fe002c58a6791e655036` で、案内の値と一致した（`git show` で版を固定して数えた）。
- この取り組みは、表・migration・DB の設計の記録を作らない（FR6.1）。そのため Part B の B1（入力の表 1〜3）と B3（DB の節）の対象になる新しい設計は無い。規格 Part A のうち当たる項目は、移行（S6 = A8。migration を足さない）と、冪等（S7 = A10。Stop の保存の経路は変えない）。`deviation_ledger` に書く外れは無い。
- 見直し役と段の承認が照らす項目の ID: S3・S4・S5・S6・S8（設計・実装の標準）、行の網羅率 100%（NFR6）、守る物（Q2 = A）、DB の基準の Part A の A8・A10。依存を入れないので、依存の脆弱性の確かめは対象外。

## 5. Constraints

- 守る物（DB の構造・資格情報・本番・workflow と必須の検査・契約の .v2）は Owner が決める。この取り組みの中では変えず、本番にも触れない（Q2 = A）。
- 席の設定・hook・見張り・本物の DB・tmux・壊れた `memory.db` には何も実行せず、触れない。直した版の席への適用と、`memory.db` を動かすかどうかは、別に Owner が決める。
- 試験・確かめの script は、一時の `HOME` と使い捨ての PostgreSQL だけで動かす。使い捨ての PostgreSQL は、socket を切って（`unix_socket_directories` を空にして）127.0.0.1 の TCP だけにし、`lc_messages=C` を付け、`CREATE EXTENSION vector` を入れた DB にする（project.md の学び）。
- 1 単位 = 1 PR。設計の記録（この要件と code-generation の計画）だけの PR を先に出して設計監査を 1 回受け、PASS の後に code を書く。作る branch は、最新の `origin/main` から切った別の作業場で作る（今の手元の branch は古い）。
- 時間の言葉を記録に書かない。件数・範囲・commit の一覧は、依頼を出す head から機械で作り直し、時点を添える。

## 6. Assumptions

- AS1 コードの事実は `origin/main` の 27d7f8f の内容。code-generation の前に、その時の `origin/main` で関数名と呼び出しを取り直す（記録に書いた前提は、統合のたびに事実が変わる）。
- AS2 席の起動の環境（環境変数が設定 file とは別にあるか）は読んでいない。設定 file にだけ接続先がある席が実際にいるか、持ち越しの入口が実際に既定の SQLite を開いているかは、確かめていない（読むだけの範囲）。
- AS3 Stop の証拠 JSON の読み手は、`src`・`scripts`・`docs` の検索では試験と監査の項目の記録以外に見つからなかった（検索の時点の読み。code-generation の計画で、その時の `origin/main` で取り直す）。
- AS4 `Store` の 3 つの実装（PostgreSQL・SQLite・JSON）は、`backend` の項目を持つ（型の定義と各 store の実装を読んだ）。
- AS5 Stop の 2 つの hook も SessionStart と同じ厳しさで拒否する（環境変数の URL が postgres の形でない時、`AGENT_MEMORY_DB_TYPE` が未知の値の時）。今の Stop は、未知の値や postgres でない `DATABASE_URL` を黙って SQLite にしている。これは FR1.4 の fail-closed に当たる意図した変更。OQ2 で、設計の監査と承認の時に確かめる。

## 7. Out of scope

- FR7 の持ち越しの入口を共有の関数に載せ替えること（席への適用の確かめと一緒に別の取り組み）。
- DB の構造の変更、本番の DB の確認（Owner と arc が別に見る）、席への適用と配布、壊れた `memory.db` の扱い。
- 保存先の種類を増やすこと、接続の再試行や切り替えの仕組み、設定 file の書式の変更。
- `restart-cli` の出力の項目を増やすこと（要るかどうかは OQ4）。

## 8. Open questions

- OQ1 Stop の証拠の schema の const（`wasurezu-session-rotation-stop/v1`・`wasurezu-transcript-stop-capture/v1`）を動かさず、足すだけにしてよいか。読み手が足した項目を無視できる前提（AS3）に頼る案と、const を上げる案がある。設計の記録で選び、採らなかった方を書く。
- OQ2 AS5 の厳しい拒否が、今 Stop で動いている席を止めないか。止める入力は「未知の `AGENT_MEMORY_DB_TYPE`」と「postgres の形でない `DATABASE_URL`」だけで、同じ席の SessionStart は今も拒否している（Stop だけが通っていた）。
- OQ3（arc の答えで決まった。Owner の言葉ではない。arc の答え = Owner の委任 #49 6762288830）RE の知識の置き場（codekb）が、読んだ版を `aa77b683…`（手元の branch の HEAD）と書いているが、読んだ file の内容は 27d7f8f のもの（`rotation-commit.ts`・`read-only-task-states.ts`・`rotation-handoff-source.ts` は `aa77b683…` には無く、27d7f8f にある）。承認済みの RE の記録の label は直さず（RE の段へ戻さない）、読んだ版の正本はこの要件の AS1 と OQ3（27d7f8f、2026-11-15T23:08:29Z の byte の突き合わせ）とする。作る段の監査の依頼にも「読んだ版 = 27d7f8f」と書く。
- OQ4 `restart-cli` の口が、どの保存先を読んだか（開いたか）を出力で見せるか。依頼にも Q6 の答えにも無いので、出力は変えない前提で進め、要るなら設計で聞く。
- OQ5 設計で深く読む残り: 浅く見た入口のうち、この取り組みの対象（Gemini CLI と Antigravity CLI の SessionStart、`restart-cli` の `prepare`、`codex-hook-installer`）は、code-generation の計画を書く前に、`createStore` を呼ぶ所と `skipPostgresMigrations` の有無を深く読む。対象でない入口は FR7 の表のとおり持ち越す。

## 9. Sources

- 上流の記録（codekb、`aidlc/spaces/default/codekb/agent-memory/`）: `business-overview`（「保存先の決め方と業務への関わり」の節）、`architecture`、`code-structure`。
- 取り組みの説明と範囲: この取り組み（bugfix）には `intent-statement` と `scope-document` の記録を作る段が無い。そのため、依頼の文（取り組みの記録の `project-description.json`）と、範囲（`aidlc-state.md` の scope = bugfix）を出典にした。
- チームの決まり: `team-practices` の記録は無く、同じ内容は `team.md` と `project.md` の決まり（試験の決まり・学び）から読んだ。
- 質問と答え: `requirements-analysis-questions.md` の Q1〜Q6（Q2 は Owner の言葉、ほかは arc の答え）。
- コード（`origin/main` の 27d7f8f）: `src/stores/index.ts`（`resolveStoreBackend`・`createStore`）、`src/codex-session-start.ts`（`resolveCodexStoreBinding`・`postgresUrl`・`CODEX_USER_CONFIG_RELATIVE_PATH`）、`src/session-rotation-stop.ts`（`withStore`・`evidence`）、`src/transcript-stop-capture.ts`（`runTranscriptStopCapture`）、`src/rotation-commit.ts`（`openDefaultStore`）、`src/restart-cli.ts`（`runHandoffSource`・`main`）、`src/stores/read-only-task-states.ts`（`readTaskStatesReadOnly`）、`src/stores/types.ts`（`Store.backend`）、`src/stores/pg-migrations.ts`。
- 決まり: 設計・実装の標準 S1〜S9、DB の基準（上の 4）、`team.md` の試験の決まり、`project.md` の学び。
