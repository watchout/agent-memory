# 作った物のまとめ — 会話の切り直し（261110-session-rotation）

- 計画: `code-generation-plan.md`。試験の手順: `unit-test-instructions.md`。見張りの設計: `watcher-design.md`（版 4）。取り込みの身元の規則: `capture-identity-design.md`
- branch `kusabi/session-rotation-261110`、base `17676d841257cc4ef194e14923cb0458b99cf62f`（main）。PR は watchout/agent-memory#341
- 設計監査（見張り）は 4 回目で PASS（PR #341 の comment 6786115624）、作者の受領は comment 6786349956。この code は、その受領を PR に書いた後に書いた（aidlc-only §2）。見張りが鍵を送らず `tmux respawn-pane` を使う形と、残る危険 R-A〜R-E を受け入れる Owner の決定は OD-KUSABI-ROTATION-WATCHER-RESPAWN-NOT-KEYS-20261111-001（iyasaka-arc#49 comment 6785869798）
- code と試験の code は、この会話が書いた（作る役は呼んでいない）。サブエージェント（AI-DLC の役）を使える範囲は、この取り組みの承認（2026-11-10、人の選択として記録: 「この取り組みの間は呼んでよい」。同時に 1 つ・同じモデル・この作業場の中だけ・GitHub に書かない）。

## 変えた file

差分は base の main に対して、変更 10 file（src）、新しい module 19 file（src、最大 514 行）、試験 9 file の新規と `src/test.ts` の 1 行、`package.json`、`docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md`（+46 / −0、§5・§6 だけ）、`docs/audit/kusabi-session-rotation-261110.json`（監査の項目）、この取り組みの AI-DLC の記録。

| 要件 | file | 内容 |
|------|------|------|
| FR1・FR2 | `src/session-rotation-usage.ts`（新）、`src/constants.ts` | 量を測る純粋な関数（Claude Code と Codex）、閾値の既定 300,000 は `ROTATION_DEFAULT_THRESHOLD_TOKENS` の 1 か所、`ROTATION_*`・`ROTATION_WATCHER_*` の定数 |
| FR2.2 | `src/rotation-hook-registration.ts`（新）、`src/claude-hook-installer.ts`、`src/codex-hook-installer.ts` | 席ごとの閾値を hook の command の引数で渡す。登録は opt-in（`--rotation on|off`、`--rotation-threshold-tokens`）、`off` が戻し |
| FR3・FR4・FR6.5 | `src/session-rotation-stop.ts`（新）、`src/session-rotation-files.ts`（新） | 同期の別の Stop hook。block 1 回、席の文の取り出し、秘匿処理、Store への直接の保存、保存の後だけ印を出す、手番の file |
| FR4.2 | `src/session-rotation-status.ts`（新） | 印・手番・hook の状態・見張りの claim を見る読むだけの command |
| FR6・FR7.1 | `src/session-rotation-start.ts`（新）、`src/claude-session-start.ts`、`src/codex-session-start.ts` | 準備した束を 1 回だけ取り出して頭に入れる。Claude は initialUserMessage も返す。上限 10,000 トークン・120,000 バイト。FR7.1 の決まった文は 1 か所 |
| FR7.2・FR7.3 | `src/mcp-store-readiness.ts`（新）、`src/index.ts`、`src/boot.ts`、`src/post-tool-hook.ts` | tool の一覧を先に返し、呼び出しは Store の用意を待つ。起動で表の変更を流さない（`createStore({ skipPostgresMigrations: true })`） |
| FR8 | `src/claude-transcript-identity.ts`（新）、`src/session-start-auto-receive.ts`、`src/transcript-stop-capture.ts` | 身元の規則 R1〜R9、3 値の受領、cwd の種類の数と席の外の record の数 |
| FR5 | `src/rotation-watcher.ts`（入口）と `rotation-watcher-config` `-screen` `-tmux` `-ps` `-core` `-store` `-observe` `-attempt` `-run` `-probe`（新） | LLM を使わない見張り。設計の版 4 のとおり。tmux の命令は閉じた集合（`display-message -p`・`list-clients -F`・`capture-pane -p`・`if-shell -F` の中の `respawn-pane -k -t <pane_id>`）だけで、`send-keys` 系の経路も定数も無い |
| 試験 | `src/test-session-rotation-{core,flow,scenario,status}.ts`、`src/test-rotation-hook-registration.ts`、`src/test-rotation-watcher-{units,flow,world}.ts`、`src/test-claude-transcript-identity.ts`（すべて新）、`src/test.ts`（hook を起動する試験の環境の変数 1 行） | `package.json` の既存の npm script に入れた（下の「確かめ」） |

- 800 行を超える既存の file（`src/index.ts`・`src/codex-session-start.ts`・`src/restart-pack.ts`・`src/stores/pg-store.ts`）には呼び出しの数行だけを足し、新しい働きは新しい module に置いた（`src/restart-pack.ts`・`src/stores/pg-store.ts` は触っていない）。
- 作業場の仕組みの file（`.claude/`・`.aidlc-version`・`.framework/`・`.gitignore` など）はこの PR に入れない。

## この PR に入れていない物（守る物。Owner の決定が要る）

- 見張りを席に据えること、席ごとの起動 script の登録、席の hook を新しい版に替えること（FR5.4、FR9.2）。
- 動いている raw-capture の常駐の差し替えと停止、席の hook の差し替え（FR8.3。#339 の追記 https://github.com/watchout/agent-memory/issues/339#issuecomment-6786645560 の返事待ち）。
- DB の作りの変更（表・列・migration）は無い。workflow と必須の検査は変えていない。新しい外部の依存は足していない。

## 主な決定

- 切り直しの判定は、今の非同期の取り込みの hook の中に入れず、同期の別の Stop hook にした（block の返事は同期で返す必要があるため）。取り込みの hook の登録は変えない。
- 切り直しの block の文は、Stop hook の出力として別に返し、証拠の schema には混ぜない。証拠は stderr の 1 行（`action`・`reason`・`measured_tokens` など）で、会話の文は入れない。
- block を出した時の量は hook の状態の file に残し、次の Stop の保存では、その量を使う（今の回の測りが違っても、block を出した時の値を保存する）。決定の核 `decideRotationStop` がこの値を持ち回るので、量が無い場合の代わりの値（0）を作る道は無い。
- 切り直しの呼び出し元の登録は opt-in にした。何も渡さなければ今までの hook の登録と同じ文字列になる（戻しは `--rotation off`）。
- `ps -o lstart=` の文は locale で変わるため、hook と見張りは同じ `LC_ALL=C` で `ps` を呼び、同じ形で比べる（監査済みの設計 v4 への補足を `watcher-design.md` に書いた）。
- 見張りの設計に無かった `src/session-rotation-status.ts`（読むだけの状態表示）を足した。FR4.2 の「今の印の状態は command で見られる」を満たすため。書かず、tmux も `ps` も呼ばず、ID・状態・数・時刻だけを出す（会話の文・path・内容の digest は出さない）。読めない file は `none` ではなく `unreadable` と出す（S5）。PR の deviation_ledger に 1 行書く。
- FR8 の身元の規則は `capture-identity-design.md` の R1〜R9（arc-sec の確かめ済み）。Claude の取り込みが 0 件だった原因は、hook の cwd と全 record の cwd が一致するという規則だった。常駐は main に無い古い build（`store.recordRawEvent is not a function`）で、これは #339 に追記した。

## 確かめ

### 成功の場面の試験を先に書いて落ちることを確かめた（計画 Step 4）

- `npx tsx src/test-session-rotation-scenario.ts` は、実装の前に `ERR_MODULE_NOT_FOUND`（`src/session-rotation-stop.js` が無い）で落ちた。実装の後は PASS。

### 試験（この Mac の Node v26.12.1・npm 11.20.0）

| 試験 | 結果 |
|------|------|
| `src/test-session-rotation-core.ts` | 20 cases PASS（FR1・FR2・FR7.2・FR7.3・file の形） |
| `src/test-session-rotation-flow.ts` | 24 cases PASS（FR3・FR4・FR6・FR7.1・hook の command を別 process で起動する場合を含む） |
| `src/test-rotation-hook-registration.ts` | 10 cases PASS（FR2.2・installer の引数・戻し） |
| `src/test-session-rotation-status.ts` | 8 cases PASS（FR4.2） |
| `src/test-rotation-watcher-units.ts` | 82 cases PASS（設定・画面・tmux・ps・核） |
| `src/test-rotation-watcher-flow.ts` | 85 cases PASS（一度だけ・確認・帳面・HALT・閉じた命令の集合） |
| `src/test-session-rotation-scenario.ts` | PASS（Claude Code と Codex で、量を測る → 保存して印 → 新しい会話の頭に次の 1 歩。FR9.1） |
| `src/test-claude-transcript-identity.ts` | 25 cases PASS（FR8 の R1〜R9・冪等・拒否・観測できず） |

- CI の mirror（`.github/workflows/ci.yml` の 18 の手順を手元で順に流した）は 18 / 18 PASS、`failed_steps=0`。内訳: `tsc --noEmit`、`build`、core（1832 passed）、`test:codex-hook`、`test:claude-hook`（切り直しの試験を含む）、`test:gemini-hook`、`test:gemini-conversation-ingest`、`test:automatic-receive`（身元の試験を含む）、`test:transcript-stop`、`test:kusabi-content-addressed-runtime-release`、`test:kusabi-direct-fleet-rollout`、`anti-regression-am027`、`test-sqlite`、`test-boot-recovery`、`test-post-tool-hook`、gate0 の 3 つ。Node 18・20・22 の回は PR の CI で確かめる。
- `test-post-tool-hook` は `DATABASE_URL` が無いと 0 で先に終わる（main でも同じ）。参考に `AGENT_MEMORY_DB_TYPE=sqlite` を足すと 45 passed・0 failed で、変えた 2 行（`createStore({ skipPostgresMigrations: true })`）が動く。
- 見張りの正例として、使い捨ての tmux（自分の socket を持つ別の server、system の一時 folder の下）で確かめた: 登録と違う `pane_pid`・カーソルでは `not_respawned`、合っていれば実行されて `pane_pid` が変わり、`pane_id` と起動の command は同じ。古い `pane_pid` の 2 回目は `not_respawned`。
- Claude の取り込みの正例として、手元の実際の transcript を一時の store に取り込んだ: 約 2,342 行が入り、`cwd_kinds` 5、`records_outside_workspace` 0。

### 行の網羅率（NFR4）

- 計り方: 試験の process 全部を `NODE_V8_COVERAGE` で動かし（上の試験と、変えた file を読む `test:claude-hook`・`test:codex-hook`・`test:gemini-hook`・`test:gemini-conversation-ingest`・`test:antigravity-hook`・`test:automatic-receive`・`test:transcript-stop`・core・sqlite 付きの post-tool-hook・boot recovery）、process をまたいで 0 回の範囲を足し合わせ、新しい file は全行、変えた file は base からの足した行と重ねた。V8 の範囲は分岐の腕も数えるので、行の網羅率より厳しい。`NODE_V8_COVERAGE` は試験が子 process として起動する hook の command の分も集める。`node --test --experimental-test-coverage` の lcov は今回は使っていない（採った判断: V8 の生の網羅率を process をまたいで足す／採らなかった案: file ごとの lcov）。
- 結果: 変えた行と新しい行（約 3,800 行）のうち、動かなかった範囲は次の 4 つだけ（100% に届かない。数えから外さず、理由を書く）:
  1. `src/rotation-watcher.ts` 81 行目 `process.getuid ? process.getuid() : -1` の腕。`getuid` の無い platform の分岐で、この Mac では起きない。
  2. `src/session-start-auto-receive.ts` 175 行目 `process.getuid?.() ?? null` の腕。同じ理由。
  3. `src/rotation-watcher.ts` 132〜135 行目 `main().catch(...)`。`runWatcherCli` が例外を投げた時の最後の網で、投げる道が code の中に無い。
  4. `src/session-rotation-stop.ts` 511〜513 行目 `main().catch(...)`。hook の出力の書き込み自体が失敗した時の最後の網で、PASS を返して席を止めない。
- これ以外の動かなかった範囲は、足した行と重ならなかった（今回触っていない行）。

## 計画からの外れ（PR の deviation_ledger に書く）

- 行の網羅率 100% に、上の 4 つの範囲が届かない（採った判断: 数えから外さず理由を書き、監査で見る／採らなかった案: 届かせるための作り物の試験）。
- 触る大きな file を 800 行以下に分けない（採った判断: 新しい働きは新しい module に置き、呼び出しの数行だけ足す／採らなかった案: 大きな file の分割）。
- FR4.2 の状態表示を、監査済みの見張りの設計に無い file として足した（採った判断: 読むだけの小さな command／採らなかった案: 設計監査をもう 1 回依頼して設計に足す。読むだけで鍵・tmux・書き込みを持たず、守る物に触れないため）。
- 要件 FR8.4〜FR8.6 は設計監査の後に足した（身元の規則）。追跡表と監査の項目に入れた。
- PR の大きさの予算（400 行・20 file）を超える（AI-DLC の単位の作る段の出力。記録の file と新しい module を足すため）。

## 残る危険（見張りの受け入れた R-A〜R-E。「害が無い」とは書かない）

起動し直しは、観測の後に起きたことを見ずに process を終わらせる。自動で文を送るより安全側の失敗だが、損失ゼロではない。

- R-A 最後の観測の後に人が打った未送信の文が消える（送られはしない）。
- R-B 観測の後に届いた入力や中継で始まった作業が途中で切れる。
- R-C 最後の `ps` と tmux の評価の間に前面の process が替わる。
- R-D 動いている取り込み・hook の子 process が切られる。
- R-E 新しい会話が起動しない場合は `unconfirmed` にして、その席を HALT する。

## 公開してよいかの確かめ

- 公開の repo なので、PR に入れる file の足した行を、手元の path（`/Users/`）、DB の URL・資格情報、秘密の値、勧告の番号、メールアドレスで探す。結果は push の前にもう一度流し、この節に書いた数と同じかを確かめる（伏せた所は 0）。
- 非公開の repo（iyasaka-arc）は、Owner の決定の場所として issue とコメントの番号で引くだけで、中身は引用していない。

## 気づいたこと（この PR では直していない）

- 取り込みの `events_saved` が 1,000 件を超える transcript で実際より多く数える（既存の `hasExistingRawEvent` の読み出しの上限 1,000 件のため）。冪等（行は重ならない）は保たれる。
- 切り直しの Stop hook の `readTranscriptTail` は、FR8 の身元の規則を使わない（置き場の内側にあることだけを確かめる）。量を測るだけで取り込まないため。
- `claude-start.ts`・`codex-start.ts`・`kusabi-fleet-status-cli.ts`・`restart-cli.ts` は今も `createStore()` を表の変更つきで呼ぶ（FR7.3 の対象は MCP の server・boot・post-tool-hook の 3 つで、範囲の外）。
- 帯の値（`BAND_THRESHOLDS` と `contextSignalFor` の比率）は 2 か所に literal がある既存の重複で、切り直しは絶対の量で判定するので触れていない（FR2.3、記録だけ）。
- 手元の試験の中で、既定の `createStore()` を使う確かめの script を 1 つ動かしてしまい、この Mac の既定の保存先（JSON の store の `conversation-events.json` と `raw-events.json`）に、試験用の席（`agent_id` が `control-seat`）の行が入った。2 つの file を退避してから、その席の行だけを消して `[]` に戻した（消した時点で他の席の行は無いことを、全行の `agent_id` で確かめた）。2 つの file が試験の前から有ったかは分からない。本番の DB には書いていない。以降の確かめの script は一時の `HOME` を使う。
- `ps` の `lstart` の文は locale で変わる（`LC_ALL=C` で解いた）。tmux 3.6a は `pane_start_command` を二重引用符で包んで返す。`if-shell -F` の中の `%` は 2 重にしなくてよい。
