# 作った物のまとめ — 会話の切り直し（261110-session-rotation）

- 計画: `code-generation-plan.md`。試験の手順: `unit-test-instructions.md`。網羅率の測り方: `coverage-method.md`。見張りの設計: `watcher-design.md`（版 4）。取り込みの身元の規則: `capture-identity-design.md`
- branch `kusabi/session-rotation-261110`、base `17676d841257cc4ef194e14923cb0458b99cf62f`（main）。PR は watchout/agent-memory#341
- 設計監査（見張り）は 4 回目で PASS（PR #341 の comment 6786115624）、作者の受領は comment 6786349956。この code は、その受領を PR に書いた後に書いた（aidlc-only §2）。見張りが鍵を送らず `tmux respawn-pane` を使う形と、残る危険 R-A〜R-E を受け入れる Owner の決定は OD-KUSABI-ROTATION-WATCHER-RESPAWN-NOT-KEYS-20261111-001（iyasaka-arc#49 comment 6785869798）
- code と試験の code は、この会話が書いた（作る役は呼んでいない）。サブエージェント（AI-DLC の役）を使える範囲は、この取り組みの承認（2026-11-10、人の選択として記録: 「この取り組みの間は呼んでよい」。同時に 1 つ・同じモデル・この作業場の中だけ・GitHub に書かない）。

## 変えた file

差分は base の main に対して、変更 10 file（src）、新しい module 20 file（src、最大 647 行、どれも 800 行以内）、試験 9 file の新規と `src/test.ts` の 1 行、`package.json`、`docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md`（+46 / −0、§5・§6 だけ）、`docs/audit/kusabi-session-rotation-261110.json`（監査の項目）、この取り組みの AI-DLC の記録。

| 要件 | file | 内容 |
|------|------|------|
| FR1・FR2 | `src/session-rotation-usage.ts`（新）、`src/constants.ts` | 量を測る純粋な関数（Claude Code と Codex）、閾値の既定 300,000 は `ROTATION_DEFAULT_THRESHOLD_TOKENS` の 1 か所、`ROTATION_*`・`ROTATION_WATCHER_*` の定数。席名と起動の command の文字の規則（`ROTATION_SEAT_SEGMENT`・`ROTATION_LAUNCH_COMMAND_CHARS`）も 1 か所（S3） |
| 共通 | `src/process-uid.ts`（新） | 実行している利用者の uid を取る `currentUid()`。hook 2 か所と見張りが同じ取り方を使い、uid の無い platform の扱い（hook の置き場の確かめは省く／見張りの設定の file は信用しない）は呼び出し側が決める |
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

## 1 回目の実装監査（BLOCK、F1〜F6）への直し

返却は PR #341 の comment 6788119508、作者の受領（成立していない旨）は comment 6788338692。設計の記録（見張りの設計 版 4）は、F4・F5 が設計の最小間隔・回数上限・失敗を隠さない条件の実装であるため改版していない。DB の作り・workflow・資格情報・席への据え付けは変えていない。

| 指摘 | 直し | 試験 |
|------|------|------|
| F1（P2）Stop hook の内部期限 | `src/session-rotation-stop.ts`: `rotationDeadlineMs` = min(`--timeout-ms`, 7 秒)。入口から Store の開始・保存・close までを 1 つの期限で囲み、期限が来たら「失敗しても席を止めない」証拠（理由 `internal_deadline_exceeded`）を返す。期限の後に終わった保存は印・手番の file を書かない。期限の後に開いた Store は使わずに閉じる。保存が終わった後に close が戻らない場合は、保存の結果を取り消さない。hook の command は、答えを出した後に標準出力と標準エラーを流し切って終了する（Store が戻らなくても process が残らない） | flow: Store が開かない・保存が遅れる・後から開く（close も失敗する）・close が戻らない、期限の値の上限 |
| F2（P1）印の無い compact | `src/codex-session-start.ts`: `source=compact` で切り直しの束が無い時、通常の回復の頭に決まった文（`ROTATION_UNCERTAINTY_SENTENCE`、Store を当たる tool の名前入り）を足し、そのうえで既存の上限を当てる。Claude Code も同じ関数を通る | registration: Claude Code・Codex の compact（束なし）で文が 1 回だけ入り、ほかの source は変わらず、通常の回復が大きい時も文が残って上限が保たれる |
| F3（P2）切り詰めの印が上限の外 | `src/session-rotation-start.ts`: 切り詰めの印を、トークンとバイトの両方の枠から引く。`composeRotationContext` は上限を引数に取れる（既定は定数）。試験の `+10` の許容を外した | flow: 上限の際の掃引（ASCII と日本語、通常の回復の長さ 4 通り）、バイトの上限が先に効く場合 |
| F4（P1）読めない帳面・照会で確認した起動し直し | `src/rotation-watcher-store.ts`: `summarizeLedger` は、読めない file・解けない行・時刻や `attempt_id` の無い数える行を「読めない」と返し（空の履歴にしない）、数える種類（`respawn_issued`・`outcome_unknown`・`confirmed`）を `attempt_id` ごとに 1 回、最後の時刻で数える。`src/rotation-watcher-run.ts` は読めない時に `ledger_unreadable`（観測できず）で起動し直さない | units: 帳面の読み取り全般。flow: 読めない帳面で起動し直さない・照会だけで確認された起動し直しが回数と間隔に入る |
| F5（P1）確認の記録の失敗 | `src/rotation-watcher-attempt.ts`: claim の更新と帳面の追記のどちらかが記録できなければ `confirmed` を返さず、その席を HALT する（理由は `<段>_unrecorded`）。HALT も書けない時は見張り全体を止める（`src/rotation-watcher-run.ts` の `runnerMustStop`、`src/rotation-watcher.ts` の終了コード 4） | flow: 起動し直し後の 8 通りの記録の失敗、HALT が書けない場合、`respawn_issued` が書けない場合、loop と CLI の終了コード |
| F6（P1）transcript の帰属 | `src/session-rotation-stop.ts` の `readTranscriptTail`: 保存の前に、FR8 の規則（Claude Code = 置き場・session_id・全 record の sessionId・席の作業場／Codex = rollout の root・session_meta の id と cwd）で、この会話の transcript かを確かめる。確かめられない時は保存せず、印も手番も要約も作らない（理由 `transcript_unverified:<理由>`） | flow: 他の会話・他の作業場・外の置き場・symlink・空の file・壊れた内容（Claude Code と Codex）、確かめられない時に何も書かない |
| S3（参考） | 席名・起動の command の文字の規則を `src/constants.ts` の 1 か所にし、config・tmux・files が使う。uid の取り方は `src/process-uid.ts` の 1 か所 | core: `currentUid` |

- 直した後に分かっている端: F2 は、Store が開けず通常の回復が出せない道（縮退した回復）では決まった文が入らない（compact の通常の回復が出せた場合だけ入る）。F1 は、期限の後に終わる保存の行（pack・作業の状態）自体は Store に残りうる（印が無いので切り直しの根拠にはならない）。
- 直す前に落ちる所を流して残したのは F1・F3・F6 だけ（`unit-test-instructions.md`）。

## 2 回目の実装監査（BLOCK、F1・F5 の 2 件）への直し

依頼は PR #341 の comment 6788925456（head `f30c8ffd0858859a2c0970bfac061f6a2e83d5dd`）、返却は comment 6789232372、作者の受領（成立していない旨）は comment 6789263317。IMP-1・3・4・5・7・10 は PASS、IMP-2・6・8・9 が FAIL で、ブロックしている指摘は次の 2 件だけ。設計の記録（見張りの設計 版 4）・DB の作り・workflow・資格情報・席への据え付けは変えていない。F5 は設計の「失敗を隠さない」条件を実装する順序の直しなので、設計は改版していない。

| 指摘 | 直し | 試験 |
|------|------|------|
| F1（P2）Stop の hook の標準入力の読みが内部期限の外 | `src/session-rotation-stop.ts` の `runRotationCli`: 引数を解いた直後に総予算（`--timeout-ms` と 7 秒の小さい方）を始め、標準入力の読みと予算を競わせる。予算が先に来た時は、席を止めない証拠（理由 `internal_deadline_exceeded`）で PASS を返し、鍵も印も出さない。同じ予算（`Deadline`）を `runSessionRotationStop` に引数で渡し、読みに使った時間はその予算から引かれる（2 つ目の予算を作らない）。予算を始めた `runRotationCli` が最後に取り消す。入力の読みが失敗した時は今までどおり `malformed_input` | flow（4 件）: 閉じない入力は期限で諦める・期限の後に届いた入力は使わず何も保存しない・読みに使った時間が同じ予算から引かれる（読み 600 ms + 予算 1,000 ms で 1,300 ms 未満。2 つ目の予算なら約 1,600 ms になる）・実際の command を別 process で起動して標準入力を開けたままにすると自分で終わる（終了コード 0、PASS、証拠） |
| F5（P1）見張りが止まる印を返した席の後も次の席を回す | `src/rotation-watcher-run.ts` の `runPass`: tick が `stop_runner` を返した席で seat の loop を抜ける。`runnerMustStop`・loop・`once` の終了コード 4 は、回した席だけを見る | watcher-flow（3 件、2 席目を足して）: 同じ pass で後の席を回さない（tmux の呼び出しに後の席が無い）・loop が止まり pass の一覧が回した席だけ・`once` が止まった席で終わり終了コード 4 |

- 試験は直す前に書いた。直す前の code で、F5 の 3 件は 3 件とも落ち（後の席が `seats` に入った）、F1 の閉じない入力の単体の場合は決着せず、試験の file 全体が Node の決着しない top-level await で終了コード 13 になった。前回 push した code（`f30c8ffd…`）で流すと、F1 の残り 3 件は 3 件とも落ちた: 期限の後に届いた入力を使ってしまい（理由が `unmeasured:usage_field_missing`）、読みに使った時間が予算から引かれず 1,602 ms かかり（予算は 1,000 ms）、別 process で起動した hook は 20 秒待っても終わらなかった。（そのために、前回 push した code を `git archive` で作業場の外に取り出し、閉じない入力の単体の 1 件だけを外して流した。監査の席の観測も、標準入力を開けたままで 7,381 ms 残る。）
- F1 の端: 予算が先に来た時に読みの Promise は放置される（process は `main()` の最後で終了する。`src/session-rotation-stop.ts` の hook の command）。読み取り自体は取り消さない。

## 確かめ

### 成功の場面の試験を先に書いて落ちることを確かめた（計画 Step 4）

- `npx tsx src/test-session-rotation-scenario.ts` は、実装の前に `ERR_MODULE_NOT_FOUND`（`src/session-rotation-stop.js` が無い）で落ちた。実装の後は PASS。

### 試験（この Mac の Node v26.12.1・npm 11.20.0）

| 試験 | 結果 |
|------|------|
| `src/test-session-rotation-core.ts` | 21 cases PASS（FR1・FR2・FR7.2・FR7.3・file の形・uid の取り方） |
| `src/test-session-rotation-flow.ts` | 47 cases PASS（FR3・FR4・FR6・FR7.1・内部期限 NFR1（標準入力の読みを含む）・transcript の帰属 FR8・回復の文の上限 FR6.4・hook の command を別 process で起動する場合を含む） |
| `src/test-rotation-hook-registration.ts` | 13 cases PASS（FR2.2・installer の引数・戻し・印の無い compact の決まった文 FR7.1） |
| `src/test-session-rotation-status.ts` | 17 cases PASS（FR4.2・hook_input の節） |
| `src/test-rotation-watcher-units.ts` | 83 cases PASS（設定・画面・tmux・ps・核・帳面の読み取り） |
| `src/test-rotation-watcher-flow.ts` | 103 cases PASS（一度だけ・確認・帳面・HALT・閉じた命令の集合・読めない帳面・確認の記録の失敗・止まる印を返した席の後を回さない） |
| `src/test-session-rotation-scenario.ts` | PASS（Claude Code と Codex で、量を測る → 保存して印 → 新しい会話の頭に次の 1 歩。FR9.1） |
| `src/test-claude-transcript-identity.ts` | 25 cases PASS（FR8 の R1〜R9・冪等・拒否・観測できず） |

- CI の mirror（`.github/workflows/ci.yml` の 18 の手順を、2 回目の監査への直しの後に手元で順に流し直した）は 18 / 18 PASS、`failed_steps=0`。内訳: `tsc --noEmit`、`build`、core（1832 passed）、`test:codex-hook`、`test:claude-hook`（切り直しの試験を含む）、`test:gemini-hook`、`test:gemini-conversation-ingest`、`test:automatic-receive`（身元の試験を含む）、`test:transcript-stop`、`test:kusabi-content-addressed-runtime-release`、`test:kusabi-direct-fleet-rollout`、`anti-regression-am027`、`test-sqlite`、`test-boot-recovery`、`test-post-tool-hook`、gate0 の 3 つ。Node 18・20・22 の回は PR の CI で確かめる。
- `test-post-tool-hook` は `DATABASE_URL` が無いと 0 で先に終わる（main でも同じ）。参考に `AGENT_MEMORY_DB_TYPE=sqlite` を足すと 45 passed・0 failed で、変えた 2 行（`createStore({ skipPostgresMigrations: true })`）が動く。
- 見張りの正例として、使い捨ての tmux（自分の socket を持つ別の server、system の一時 folder の下）で確かめた: 登録と違う `pane_pid`・カーソルでは `not_respawned`、合っていれば実行されて `pane_pid` が変わり、`pane_id` と起動の command は同じ。古い `pane_pid` の 2 回目は `not_respawned`。
- Claude の取り込みの正例として、手元の実際の transcript を一時の store に取り込んだ: 約 2,342 行が入り、`cwd_kinds` 5、`records_outside_workspace` 0。

### 行の網羅率（NFR4）

- 計り方: 試験の process 全部を `NODE_V8_COVERAGE` で動かし（上の試験と、変えた file を読む `test:claude-hook`・`test:codex-hook`・`test:gemini-hook`・`test:gemini-conversation-ingest`・`test:antigravity-hook`・`test:automatic-receive`・`test:transcript-stop`・core・sqlite 付きの post-tool-hook・boot recovery）、process をまたいで 0 回の範囲を足し合わせ、新しい file は全行、変えた file は base からの足した行と重ねた。V8 の範囲は分岐の腕も数えるので、行の網羅率より厳しい。`NODE_V8_COVERAGE` は試験が子 process として起動する hook の command の分も集める。`node --test --experimental-test-coverage` の lcov は今回は使っていない（採った判断: V8 の生の網羅率を process をまたいで足す／採らなかった案: file ごとの lcov）。
- 結果（2 回目の監査への直しの後、Node v26.12.1 でもう一度測った）: 変えた行と新しい行（4,071 行、30 file）のうち、動かなかった範囲は次の 2 つだけ（100% に届かない。数えから外さず、理由を書く）:
  1. `src/rotation-watcher.ts` 134〜137 行目 `main().catch(...)`。`runWatcherCli` が例外を投げた時の最後の網で、投げる道が code の中に無い。
  2. `src/session-rotation-stop.ts` 640〜642 行目 `main().catch(...)`。hook の出力の書き込み自体が失敗した時の最後の網で、PASS を返して席を止めない。
- 前の測りで動かなかった `getuid` の無い platform の腕（3 か所）は、uid の取り方を `src/process-uid.ts` の 1 か所にし、「uid が無い」場合を試験で通すことで無くした。ほかに前の測りで出た 4 か所（読めない帳面の分岐の `?? null` の腕、バイトの上限が効く腕、空の Claude transcript、後から開いた Store の close の失敗）は、構造を直すか試験を足して動かした。
- この 2 つ以外の動かなかった範囲は、足した行と重ならなかった（今回触っていない行）。
- 監査の席が同じ数字を自分で出せるよう、手順と script の全文を `coverage-method.md` に置いた（同じ形の数え直しが 30 file・4,071 行・同じ 2 範囲になることを、この作業場で確かめた）。

## 計画からの外れ（PR の deviation_ledger に書く）

- 行の網羅率 100% に、上の 2 つの範囲（入口の最後の網 `main().catch(...)`）が届かない（採った判断: 数えから外さず理由を書き、監査で見る／採らなかった案: 届かせるための作り物の試験）。
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

## 1 回目の監査の依頼の後に分かったこと（依頼の comment 6787884981 への開示は comment 6787936182）

- 見直しの後に変えた物: 公開の repo に実在の home の path を残さないため、`src/test-claude-transcript-identity.ts` の例の文字列と `capture-identity-design.md` の例 1 か所を `/Users/example/...` の仮の値に置き換えた。見直し役への再依頼はしていない（arc の答え。Owner の委任 #49 6762288830 の範囲で、Owner の言葉ではない）。
- 追跡の確かめ: 段の承認の場の通知に `traceability.json` について 1 件の指摘があるとあったが、本文は出なかった。手で流し直した結果は passed（`aidlc engine sensor fire traceability --stage code-generation --output-path <この取り組みの traceability.json>`、result=passed、detail_path=null）。

## Step 16: hook の入力の parser（PR #342、FR10.1〜FR10.7）

- branch `kusabi/hook-input-parser-261111`、base `1eef773be073b4f6526fe5b70f856cf02a0a7256`（main）。設計は `hook-input-design.md`（設計監査は 3 回目で PASS、依頼 6796476016・返却 6796790683・受領 6796851280）。試験だけの commit は `ea19ca16`（意図して red）。この節は、その後に書いた実装の commit についての記録。
- code と試験の code は、この会話が書いた（作る役は呼んでいない）。

### 変えた file（base の main に対して。新しい module 3 file、変えた src 9 file、scripts 2 file、`package.json` 1 行、試験の新規 3 file と変えた試験 8 file）

| 要件 | file | 内容 |
|------|------|------|
| FR10.1・FR10.2 | `src/hook-input.ts`（新、38 行） | 外形の確かめを 1 か所に置く純粋な関数 `parseHookInputShape`。64 KiB 超・JSON でない・オブジェクトでない・必須の欠けは拒否し、必須と任意の key だけを取り出し、それ以外の key は名前だけを `ignored_names` に返す（値は読まない・残さない）。型・event・source・身元の確かめは入口に残る |
| FR10.1・FR10.2 | `src/claude-session-start.ts`、`src/transcript-stop-capture.ts`、`src/session-rotation-stop.ts` | 入口 3 つが `parseHookInputShape` を通る。戻り値の型を変えない姉妹の関数（`parseClaudeSessionStartInputWithIgnored`・`parseTranscriptStopInputWithIgnored`）を足し、既存の `parseClaudeSessionStartInput`・`parseTranscriptStopInput` の署名と戻り値は変えない。Codex の Stop／UserPromptSubmit も共有の parser を通るので同時に緩む（H7）。Stop 系の任意項目の型違いは今のまま拒否せず省略、SessionStart の任意 3 項目は今のまま拒否 |
| FR10.3・FR10.4 | `src/hook-input-diagnostics.ts`（新、275 行） | 診断の記録（名前・event・件数・時刻だけ）の核（`applyIgnoredNames`、時計を持たない）、読み手の関数（`parseHookInputDiagnostic` は純粋。`isPrivateFolderInfo`・`isPrivateRecordInfo` は `lstat` の結果と期待する uid を引数に取り、process を読まない（uid は書き手 `writeHookInputDiagnostic` と status が I/O の層で `currentUid()` から取って渡す））、非同期の 1 回の書き手（`writeHookInputDiagnostic`）、答えを書き切った後の終了の予算 `finishAfterAnswer`（`HOOK_DIAGNOSTIC_MAX_WAIT_MS` 200 ms、`HOOK_DIAGNOSTIC_MIN_REMAINING_MS` 2000 ms、どちらも 1 か所） |
| FR10.4 | `src/session-rotation-status.ts` | 読むだけの `hook_input` の節（記録あり／記録なし／観測できず の 3 値。壊れた file・schema 違い・64 KiB 超・symlink・持ち主違い・権限が広い file は『観測できず』）。`buildRotationStatus` の戻り値は変えず、CLI の出力に `hook_input` を足す |
| FR10.5 | `src/claude-session-start.ts` | `CLAUDE_SESSION_START_HOST_CONTRACT_VERSION` は `2.1.220` のまま（意味は『契約を確かめた版』と宣言の直前の注釈 2 行）。観測した版は配備の health check の手順（計画 16.11）で取る |
| FR10.6 | `scripts/build-kusabi-content-addressed-runtime-release.mjs`、`src/kusabi-direct-fleet-rollout.ts`、`scripts/test-kusabi-content-addressed-runtime-release.mjs`、`src/test-kusabi-direct-fleet-rollout.ts` | 必須の入口の一覧に `dist/session-rotation-stop.js`・`dist/rotation-watcher.js` を足した（publisher の `ENTRYPOINTS`、試験の道具の `ENTRYPOINTS` と `REQUIRED_EXPORTS`、rollout の `REQUIRED_ENTRYPOINTS` の 3 か所）。試験で 3 か所が同じ集合であることを確かめる |
| FR10.7 | `src/hook-node-path.ts`（新、49 行）、`src/claude-hook-installer.ts`、`src/codex-hook-installer.ts`、`src/rotation-hook-registration.ts` | `--node-path` は絶対・正規化済み・basename がちょうど `node`・実行できる通常 file だけ受け入れる（symlink は許可）。Claude の SessionStart の installer が管理中の hook を見分ける条件は node の path に依らない形。`parseClaudeHookCommand` の既定は変えない |
| FR10.7 | `src/session-rotation-files.ts` | `<home>` の決め方を `agentMemoryHome` として取り出して診断の module と共有（置き場の決め方を 2 か所にしない） |
| 試験 | `src/test-hook-input.ts`・`src/test-hook-input-diagnostics.ts`・`src/test-hook-node-path.ts`（新） | `package.json` の `test:claude-hook` の後ろに足した（workflow は変えない） |
| 試験 | `src/test-claude-session-start.ts`・`src/test-transcript-stop-capture.ts`・`src/test-session-rotation-flow.ts`・`src/test-session-rotation-status.ts`・`src/test-claude-hook-installer.ts`・`src/test-codex-hook-installer.ts`・`src/test-rotation-hook-registration.ts`・`src/test-kusabi-direct-fleet-rollout.ts` | 入口ごとの差分の oracle（N+U）、現行の挙動の固定、時間の予算、診断の配線、installer の node の path の規則 |

- 触った既存の file の行数: `src/session-rotation-stop.ts` 757 行、`src/claude-session-start.ts` 630 行、`src/codex-hook-installer.ts` 630 行、`src/claude-hook-installer.ts` 629 行、`src/transcript-stop-capture.ts` 410 行（どれも 800 行以内）。800 行を超える `src/kusabi-direct-fleet-rollout.ts`（2038 行）には 2 行だけ足した（触る時に直す。まとめて直す計画は作らない）。
- 作業場の仕組みの file（`.claude/`・`.aidlc-version`・`.framework/`・作業場の `.gitignore` など）はこの PR に入れない。

### 試験の結果（この Mac の Node v26.12.1、`HOME` と `AGENT_MEMORY_HOME` は一時の folder）

| 試験 | 結果 |
|------|------|
| `src/test-hook-input.ts` | PASS（共通の parser） |
| `src/test-hook-input-diagnostics.ts` | PASS（診断の記録、時間の予算、読み手） |
| `src/test-hook-node-path.ts` | PASS（`--node-path` の規則） |
| `src/test-claude-session-start.ts`・`src/test-transcript-stop-capture.ts`・`src/test-claude-hook-installer.ts`・`src/test-codex-hook-installer.ts` | PASS |
| `src/test-rotation-hook-registration.ts` | 13 cases PASS |
| `src/test-session-rotation-status.ts` | 17 cases PASS |
| `src/test-session-rotation-flow.ts` | 47 cases PASS |
| `npm run test:kusabi-content-addressed-runtime-release`・`npm run test:kusabi-direct-fleet-rollout` | PASS（入口の一覧が 3 か所で同じ集合） |

- `npx tsc --noEmit -p .` は 0 で終わる。基準（`unit-test-instructions.md`）の既存の試験は全部通ったまま。

### 試験だけの commit（`ea19ca16`）の試験を、実装の commit で直した所（弱めてはいない。どれも正しい実装でも成り立たない試験の側の誤り）

1. `src/test-session-rotation-flow.ts` の差分の oracle: Codex の host に Claude の形の usage 行を渡していて、平常の入力が `unmeasured:no_usage_record` になっていた。Codex の `token_count` の行にした。期待する結果は変えていない。
2. `src/test-hook-node-path.ts`: 『親の区間』の見本を `join()` で作っていて、`..` が正規化されて有効な path になっていた。文字列で作り `..` を残した。
3. `src/test-claude-hook-installer.ts`・`src/test-codex-hook-installer.ts`: 2 と同じ見本の直し。
4. 同じ 2 つ: 『拒否された実行は backup を残さない』が folder 全体を空の一覧と比べていたが、同じ作業場の前の入れ直しが自分の backup を作っていた。拒否の実行の前後の一覧を比べる形にした。
5. `src/test-claude-hook-installer.ts`: 『runner が別の場所』の似せた変異が生の path を置き換えていたが、試験の runtime root に引用符が入るので command は引用符つきの形で、変異が効いていなかった。引用符つきの形を置き換える。
6. `src/test-rotation-hook-registration.ts`: 『最初の語だけが違う』が最初の空白で切っていたが、その空白は node の path（`/opt/n o'de/node`）の中だった。引用符つきの最初の語の後で切る。

### 網羅率のために足した試験（足しただけ。既存の確かめは弱めていない）

- 取り込みの Stop の本物の `main`（別 process で起動。拒否される入力と、知らない key `prompt_id` を含む受理される入力。診断の file に `[["prompt_id",1]]` が出て、目印の値はどこにも出ない）。
- 診断: 古い物の捨て方（件数・名前・event の同点）、オブジェクトでない・重複した entry、不正な pid の値は何も書かない、権限が広い既存の記録は置き換える、閉じた hook-input folder、改名できない時の一時 file の片付け、入れない folder での片付けの失敗。
- status: mode 0o000 の記録は『観測できず』、mode 0o000 の hook-input の root は `{file:"unreadable",adapters:[]}`。
- installer: 管理中の hook の正規の形（引用符なしの node の語、余分な空白）。SessionStart の proxy: 違う event・知らない source に `permission_mode:"default"` を付けた入力。
- 切り直しの Stop: evidence の stream が投げても、output に PASS を書いて process が終わる。

### 行の網羅率（NFR4、Step 16）

- 計り方は `coverage-method.md` の『Step 16』の節。base `1eef773b…`、Node v26.12.1。変えた行と新しい行（src の 12 file、938 行）のうち、動かなかった範囲は次の 1 つだけ（100% に届かない。数えから外さず、理由を書く）:
  1. `src/session-rotation-stop.ts` 756 行目 `main().catch(...)`。`runRotationProcess` が `runRotationCli` の例外を捕まえて PASS を出力し、その後の flush・診断・exit は例外を投げない作りなので、`main` が失敗する道が code の中に無い。入口の最後の網（#341 で受け入れた同じ形の範囲。行番号だけが 640〜642 から 756 に動いた）。
- ほかの 11 file は 0 範囲。前の測りで出た範囲（`claude-hook-installer.ts` 252、`claude-session-start.ts` 270、`hook-input-diagnostics.ts` の 7 か所、`session-rotation-status.ts` 144・158、`session-rotation-stop.ts` 706〜708、`transcript-stop-capture.ts` の本物の `main`）は試験を足して動かした。

### 計画からの外れ（PR の deviation_ledger に書く。設計の記録 11 節の 15〜18 行目）

- `session-rotation-status` が診断の記録を、同期の `lstatSync`／`readFileSync` と診断の module の関数（`parseHookInputDiagnostic` は純粋、権限の確かめは `lstat` の結果と期待する uid を引数に取る）で読む（設計監査が PASS した 6 節の文面からの外れ。採った判断: 読む規則を診断の module の 1 か所に置き、status は同期の署名を保つ／採らなかった案: 非同期の読みを status が使う、診断の module に同期の読みを足す）。
- 権限の確かめ `isPrivateFolderInfo`・`isPrivateRecordInfo` が期待する uid を引数に取る（1 回目の実装監査の F1 への直し。設計の記録 11 節の 18 行目。採った判断: uid は書き手と status が I/O の層で `currentUid()` から取って渡し、確かめは引数だけで決める。規則は診断の module の 1 か所のまま／採らなかった代替: 確かめが `process.getuid` を内で読んだまま、『純粋』の記述の側を直す。同じ引数でも process の uid で結果が変わり、uid を変えた試験ができず、S4 の筋（核は環境を読まない）から外れるため）。
- 必須の入口の一覧は、設計の 8 節が数えた 2 か所ではなく 3 か所（publisher・試験の道具・rollout）。試験で 3 か所が同じ集合であることを確かめる。
- 切り直しの Stop の起動の末尾が、旧の `main().catch(PASS を書く).finally(flush して exit(0))` から、`runRotationProcess` が答えを flush した後に終了を呼び、末尾は `main().catch(PASS を書き、callback で exit(0))` になった（診断の待ちを挟むため。`invokedPath` の判定・export の署名・入口の一覧は同じ。設計の記録 11 節の 17 行目）。
- 型だけの誤り: `tsc`（repo の設定。`src/test*.ts` は対象外）では出ないが、試験 file を含めた型検査では、この PR の試験に 3 件（`test-claude-session-start` 272 行 assert 後の `never`、`test-session-rotation-flow` 989 行の cast、`test-session-rotation-status` 165 行 `event: string`）と、既存の `test-kusabi-direct-fleet-rollout` の host の型の誤り（この PR より前からある）が出る。実行には影響せず、直していない。

### 1 回目の実装監査（BLOCK、F1 の 1 件）への直し

- 返却: PR #342 の comment 6799347841（投稿者 iyasaka-ai）。依頼は comment 6798932751、対象の head は `4c154ce4`。21 件 PASS、IMP-6 と IMP-12 が FAIL で、同じ 1 件（F1、P3）を指す。作者の受領は BLOCKED（comment 6808139002）。
- F1: `isPrivateFolderInfo`・`isPrivateRecordInfo`（`src/hook-input-diagnostics.ts`）が `process.getuid` を内で読むのに、IMP-6(c) と上の表が『純粋な関数』と書いていた。同じ明示の引数でも process の uid で答えが変わる。権限の迂回や情報の漏えいを見つけた指摘ではない。
- 直し（返却の `required_change` の 1 つ目。挙動は同じで、渡し方だけ）: 2 つの確かめは `lstat` の結果と期待する uid（`number | null`）を引数に取り、process を読まない。`null`（uid が無い platform）は何も信頼しない側。uid は I/O の層が取る: 書き手 `writeHookInputDiagnostic(request, uid = currentUid())` と `buildHookInputStatus(env, agentId, project, uid = currentUid())`（`currentUid()` は `src/process-uid.ts` の既存の 1 か所）。規則は診断の module の 1 か所のまま、status には写さない（S3）。設計の記録 11 節の 18 行目に、採った判断と採らなかった代替（確かめが `process.getuid` を読んだまま『純粋』の記述を直す）を書いた。
- 足した試験（足しただけ。既存の確かめは弱めていない）: `src/test-hook-input-diagnostics.ts` に (1) 渡した uid で判定が変わる（501／502／root／`null`、folder・file・mode・大きさの境）と、process が別の uid を名乗る・名乗らない間も同じ引数で同じ答えになること、(2) 書き手に別の uid や `null` を渡すと何も書かず、自分の uid では書くこと、(3) 確かめの本体に `process`・`getuid`・`currentUid` が現れないこと。`src/test-session-rotation-status.ts` に、別の uid や `null` を渡すと本物の記録が『観測できず』になる 1 case（16 → 17 cases）。
- 数の変化: `src/hook-input-diagnostics.ts` 268 → 275 行、`src/session-rotation-status.ts` の変えた行が 87 → 88、変えた行と新しい行は 930 → 938 行。動かなかった範囲は同じ 1 つ（`src/session-rotation-stop.ts` 756 行目）。

### 2 回目の実装監査（PASS）と統合

- 依頼: PR #342 の comment 6808343122（対象の head `23ddb0cf18f49b94444bf6900fca0155d93887a2`、前検査 READY_FOR_REVIEW）。返却: comment 6808507295（devauditor = iyasaka-ai、PASS。固定 23 項目すべて PASS、blocking 0、F1 は解消、新しい指摘 0）。作者の受領: comment 6808706214（`--review` の結果 RECEIPT_ACCEPTED、終了コード 0）。
- 返却が書いている限り: DES-1〜DES-11 は設計監査の判定の再利用で、現在の head に code の差分が無いという判定ではない。`Shirube Rapid/Lite Gates Report` の failure は成功と数えない。今回の PASS は実装監査で、統合・Owner の exact-head・配備の Owner の決定・実環境での受け入れの代わりにならない。新しい試験の型検査の除外は既存の tsconfig どおり。
- Owner の exact-head: OD-KUSABI-PR342-R3-EXACT-HEAD-23DDB0CF-20261112-001（PR #342 の comment 6808786916、記録 = arc）。統合: suite-lead が merge commit `94f1ca6d0042bd970d4cc7c4ab9ce9153b7d5c0d`（読み戻し comment 6808846277）。統合の後の main の CI run 43113722371 は build-and-test 18・20・22 すべて success。席への新しい版の据え直しは、この統合に含まれない。
- この段で実行していない確かめ: 席への配備、障害のあった席・disk での実環境の確かめ、Claude Code 2.1.321 など別の版での動き（手元は Node v26 だけで、Node 18・20・22 は CI の結果）。これらは Build and Test 以後の段（計画 16.11）の仕事。

## 公開してよいかの確かめ

- 公開の repo なので、PR に入れる file の足した行を、手元の path（`/Users/`）、DB の URL・資格情報、秘密の値、勧告の番号、メールアドレスで探す。結果は push の前にもう一度流し、この節に書いた数と同じかを確かめる（伏せた所は 0）。
- 非公開の repo（iyasaka-arc）は、Owner の決定の場所として issue とコメントの番号で引くだけで、中身は引用していない。

## 気づいたこと（この PR では直していない）

- 取り込みの `events_saved` が 1,000 件を超える transcript で実際より多く数える（既存の `hasExistingRawEvent` の読み出しの上限 1,000 件のため）。冪等（行は重ならない）は保たれる。
- （1 回目の監査で直した。F6）切り直しの Stop hook の `readTranscriptTail` は、以前は置き場の内側にあることだけを確かめ、「量を測るだけで取り込まない」と説明していたが、実際は同じ transcript の文を作業の状態と束に保存する。今は保存の前に FR8 の身元の規則で、この会話の transcript かを確かめる。
- `claude-start.ts`・`codex-start.ts`・`kusabi-fleet-status-cli.ts`・`restart-cli.ts` は今も `createStore()` を表の変更つきで呼ぶ（FR7.3 の対象は MCP の server・boot・post-tool-hook の 3 つで、範囲の外）。
- 帯の値（`BAND_THRESHOLDS` と `contextSignalFor` の比率）は 2 か所に literal がある既存の重複で、切り直しは絶対の量で判定するので触れていない（FR2.3、記録だけ）。
- 手元の試験の中で、既定の `createStore()` を使う確かめの script を 1 つ動かしてしまい、この Mac の既定の保存先（JSON の store の `conversation-events.json` と `raw-events.json`）に、試験用の席（`agent_id` が `control-seat`）の行が入った。2 つの file を退避してから、その席の行だけを消して `[]` に戻した（消した時点で他の席の行は無いことを、全行の `agent_id` で確かめた）。2 つの file が試験の前から有ったかは分からない。本番の DB には書いていない。以降の確かめの script は一時の `HOME` を使う。
- `ps` の `lstart` の文は locale で変わる（`LC_ALL=C` で解いた）。tmux 3.6a は `pane_start_command` を二重引用符で包んで返す。`if-shell -F` の中の `%` は 2 重にしなくてよい。

## Step 17: 引き継ぎの確定の順番の直し（設計の段まで。code はまだ書いていない）

配備の途中（2026-11-12）で見つかった設計の誤りを、同じ取り組みの construction で直す（arc の技術の判断。Owner の決定ではない）。今の状態は設計の記録だけ。

| 物 | 状態 |
|---|---|
| 要件 FR11.1〜FR11.5 | `requirements.md` に足した |
| 設計の記録 | `handoff-commit-order-design.md`（失敗の場面 F1〜F4、案 A〜D、採る案 A、S4〜S8、試験 T1〜T9、範囲に入れないこと。設計の中の未読は 0） |
| 試験の手順 | `unit-test-instructions.md` の「Step 17」の節（T1〜T9。試験の code は設計監査の PASS の後） |
| 追跡 | `traceability.json` の FR11.1〜FR11.5 は `Deferred`（実装は設計監査の PASS の後。Step 17.6〜17.8 で `OK` にする） |
| src の変更 | なし |
| 次 | 監査の項目の file → 設計の記録だけの PR → 独立の設計監査（devauditor）。PASS の後に試験だけの commit、その後に実装 |
