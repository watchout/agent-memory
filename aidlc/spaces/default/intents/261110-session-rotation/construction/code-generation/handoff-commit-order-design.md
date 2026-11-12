# 引き継ぎの確定の順番の直し — 設計の記録

状態: 設計の段（Code Generation に戻した後の、設計の記録。express には設計の段が無いので、他の `*-design.md` と同じく Code Generation の中に置く）。この file は設計の記録だけで、code は書いていない。出どころ: arc の指示（2026-11-12、Owner の委任 iyasaka-arc#49 6762288830 の技術の範囲。Owner の言葉ではない）。入れ物は arc の判断で、同じ取り組み 261110-session-rotation の construction を戻して直す（要求 → 設計 → code → 配備の追跡を 1 つに保つため。前例: parser の直し = Code Generation の Step 16、#342）。席の読みは読み取りだけ（DB・設定・展開は触っていない）。

版: 2 回目（独立の設計監査の 1 回目 = PR #344 の返却 comment 6814171592、BLOCK、止める指摘 3 件を受けて書き直した）。この文書で「1 回目の F1／F2／F3」は、その返却の指摘 1・2・3 を指す（2 節の F1〜F4 は今の code の失敗の場面で、別の番号）。

## 1. 今の順番（code を読んだ事実）

Claude の SessionStart（`src/claude-session-start.ts`）の 1 回の起動は、次の順で進む。

| 順 | 何が起きるか | 場所 |
|---|---|---|
| 1 | 会話の取り込み（`receiveCurrentSessionTranscript`） | `claude-session-start.ts:317` |
| 2 | `prepareRotationRecovery`: 引き継ぎを読み、文を作り、**`consumeSelectedRestartPack` で消費済みにする**。続けて `turn` file に `started` を書き、claim 経由なら **`rotation_marker_id` も同時に書く** | `session-rotation-start.ts:229`・`263`・`235-245` |
| 3 | 通常の回復の束の読み込み（`loadRestartPackData`）、上限の適用（`enforceCodexRecoveryCaps`） | `claude-session-start.ts:334-343` |
| 4 | 品質ログの書き込み（失敗しても null で続く） | `claude-session-start.ts:347-377` |
| 5 | 全体が `withTimeout(binding.timeout_ms)` の中。超えると `RECOVERY_TIMEOUT` の degraded 出力（`additionalContext` なし） | `codex-session-start.ts:905-908`・`942-958` |
| 6 | 文の合成（`composeRotationContext`）と出力の書き込み（`process.stdout.write`）、終了 | `codex-session-start.ts:910`・`claude-session-start.ts:572-575` |

見張りは `turn.rotation_marker_id === marker.marker_id` を「新しい会話が引き継ぎを受け取った」確認として読む（`rotation-watcher-core.ts:294`）。`turn` file を書くのは `prepareRotationRecovery`（`session-rotation-start.ts:235`）と Stop／UserPromptSubmit の hook の `turn(...)`（`session-rotation-stop.ts:445`・`479`・`515`・`533`）の 2 系統だけ。後者は常に `rotation_marker_id: null` で書く。

## 2. 問題

引き継ぎは 2 で**消費済み**と記録され、`turn` file にも**受け取った**と書かれるが、文が席に届くのは 6 の後。3〜6 のどこで失敗しても、次が起きる。

- 束は消費済みなので、次の起動は束を取り直せない（`getSelectedRestartPack` は `status = 'active'` だけを返す。`stores/pg-store.ts:1057-1068`）。引き継ぎは失われる。
- `turn` file は「受け取った」と言うので、見張りは**確認済みと読む**。届いていないのに成功と記録される（宣言された値が証拠になっている。標準 S5）。確認済みと読むので、`unconfirmed` にも HALT にもならず、失敗は誰にも見えない。

失敗の場面（起きやすさ・困る大きさは**作者の暫定**。独立の設計監査が判定する。表は aidlc-only の KY）:

| 場面 | 何が起きるか | 起きやすさ（暫定） | 困る大きさ（暫定） |
|---|---|---|---|
| F1 | 3〜4 の遅れで `withTimeout` が超える。degraded の出力が出て、束は消費済み。timeout の後も消費は完了しうる | 中（DB の遅れ・再起動の直後） | 重大（失敗が成功と記録され、引き継ぎが失われる） |
| F2 | 3 の読み込み・上限の適用が例外を投げる。catch が degraded を返す | 低 | 重大 |
| F3 | 6 の出力の書き込みが失敗する、または書いた直後に hook が止められる | 低 | 重大 |
| F4 | F1〜F3 の後、`turn` file の確認で見張りが**確認済み**と読む（偽の確認） | F1〜F3 と同じ | 重大 |

## 3. 案

| 案 | 中身 | 判断 |
|---|---|---|
| A. 配達の後に確定、印は最後 | 読む・文を作るまでを前に、**消費と確認の印を出力の書き込みが済んだ後**に移す。印は確定の最後の 1 手で、書いたら何も待たずに終わる | **採る** |
| B. 消費の取り消し | 失敗したら束を `active` に戻す verb を store に足す | 採らない。store の口が増える。timeout の後の消費や hook が止められた場合は取り消す道が走らない |
| C. 列を足して session 単位で冪等 | `selected_restart_packs` に消費した session の列を足し、同じ session の取り直しを許す | 採らない。DB の構造の変更で、Owner の判断が要る保護面。今回の直しの範囲に要らない |
| D. 消費を出力の直前へ寄せる | 3〜4 の後・6 の直前に消費 | 採らない。F3（書き込みの失敗・hook の停止）の窓が残る。A は窓を閉じる |
| E. 印を消費より先に書く | 出力の後、消費の前に印を書く | 採らない。印から終了までの間に消費（最大 1.5 秒）が入り、host に止められた時に『印はあるが文は届いていない』窓（4.8）が広がる |
| F. 出力の後を別の子 process に任せる | 親が終わった後に子が消費と印を書く | 採らない。子は host の受領を観測できず（4.8 の窓は同じ）、親が終わった後に書くので成否を hook の証拠に結べず、起動した子の後始末が増える |
| G. 印の書き手を hook の外に移す（host の受領の証拠を見張りの確認に結ぶ） | 新しい会話の transcript に host が書く hook の結果（`hook_success`・`hook_additional_context`）を、見張りか Stop の hook が読んで確認する | この PR では採らない。見張りの確認の条件（安全の設計）と Stop の hook を変えるので別の決定が要る。Codex の transcript の形は読んでいない。4.8 の OPEN-1 の選択肢 |

## 4. 採る案（A）の設計

### 4.1 読む側（`prepareRotationRecovery`）
1. **読むだけ**にする。`getSelectedRestartPack`、`sha256` の突き合わせ、`redactText`、文の組み立てまでを行い、`consumeSelectedRestartPack` は呼ばない。`turn` file の `started` は今と同じく書く（見張りへの射影。引き継ぎの無い起動でも書かれる。4.6 のとおりロックの中で書く）が、`rotation_marker_id` は **null** で書く。
2. 戻り値の `RotationBlock` に、確定の計画 `commit` を足す。中身は**データだけ**（関数・store を持たない）: `query`（`agent_id`・`project`・`pack_ref`）、`directory`（`turn` の置き場）、`turn`（今書いた `turn` の中身。`rotation_marker_id` は null、`at` と身元を含む。`started` の書き込みが失敗した時は null）、`marker_id`、`via`（`"claim"` か `"marker"`）。`text`・`initial_user_message`・`marker_id` は今のまま。

### 4.2 確定の計画が process 層に届く道（内部の型の変更だけ。出力・証拠の形は変えない）
- `RotationBlock.commit` → `LoadedCodexRecovery.rotation`（Claude と Codex の loader は既に `rotation` を返す。`claude-session-start.ts:383`・`codex-session-start.ts:878`）→ `runCodexSessionStart` が `rotation_evidence` を付ける所（`codex-session-start.ts:940`）で `rotation_commit` も付ける → `runClaudeSessionStart` が `rotation_evidence` を写す所（`claude-session-start.ts:472`）で同じく写す。`runClaudeSessionStart` は `runCodexSessionStart` を包むので、結果の型を 2 か所（`CodexSessionStartRunResult` の `rotation_evidence` の行 `codex-session-start.ts:248`／`ClaudeSessionStartRunResult` の同じ行 `claude-session-start.ts:168`）に足す。
- process 層が書くのは `result.output`（stdout）と `result.evidence`（stderr）だけ（`claude-session-start.ts:537-547`・`codex-session-start.ts:1031-1036`）。`rotation_commit` は書かない。出力の bytes は変わらない（T4 で固定）。
- **確定の対象かどうかは `rotation_commit` があるかで決める**（= 引き継ぎの文が出力の `additionalContext` に入ったか）。結果の `outcome`（full／degraded）では決めない。理由: 品質ログの書き込みが失敗すると `outcome` は degraded（`EVIDENCE_LOG_UNAVAILABLE`）になり `systemMessage` が付くが、`additionalContext` には引き継ぎの文が入る（`codex-session-start.ts:911`・`922-935`）。この場合は文が出力に入るので確定する（T10）。回復の読み込みが例外・期限で終わった時は `loaded` が返らないので `rotation_commit` も付かず、確定しない（F1・F2）。
- 証拠（`wasurezu-session-rotation-start/v1`）は `marker_id`・`token_estimate`・`byte_count`・`truncated`・上限だけで、『消費した』『印を書いた』とは言わない（`session-rotation-start.ts:70-78`）。確定を後ろへ移しても、証拠が事実より先に宣言することは無い。

### 4.3 確定（`commitRotationRecovery`。名前は下書き）と、その順

引数: 確定の計画、store を開く関数、`now`（S4）、`elapsed_ms()`（process の開始からの経過。呼ぶ側の単調時計）、`hook_timeout_ms`（呼ぶ側の hook の期限）。呼ぶのは出力（stdout）の書き込みが成功した後だけ（4.4）。次の順で進み、**どの段の結果も後の段を止めない**（印は消費の結果に依らない）。

| 段 | 何をするか | 失敗・遅れた時 |
|---|---|---|
| 0 | `commit_by = hook_timeout_ms − ROTATION_COMMIT_EXIT_MARGIN_MS`（9 秒 − 2 秒 = process の開始から 7 秒）。残り = `commit_by − elapsed_ms()`。残りが `ROTATION_TURN_LOCK_WAIT_MS` 未満なら、何もせず終わる（消費も印も無い） | 席の出力は出ている。印なし → 4.7 |
| 1 | 消費（記録の整理）。予算 = `min(ROTATION_COMMIT_BUDGET_MS, 残り − ROTATION_TURN_LOCK_WAIT_MS)`。予算が 0 以下なら段 1 を飛ばす。store を開き、`consumeSelectedRestartPack({ ...query, consumed_at })` を 1 回だけ発行する。再送しない | 結果は `consumed`／`lost_race`（null）／`unknown`（例外・予算切れ・応答が来ない）のどれか。**どれでも段 2 へ進む**。`unknown` を『更新されなかった』と読まない |
| 2 | 印（最後の 1 手）。`via` が `"claim"` で、計画に `turn` がある時だけ、4.6 のロックの中で、今の `turn` が計画の `turn` と同じ（`session_id`・`state = "started"`・`at` が同じ、`rotation_marker_id` が null、`readTurn` が null でない）時だけ、`rotation_marker_id = marker_id` を足して書く（`at` は変えない） | 違う時・ロックが取れない時・`readTurn` が null（無い・壊れている・schema が違う。`session-rotation-files.ts:220-223`）の時は書かない（新しい状態を古い写しで上書きしない）。印なし → 4.7 |
| 3 | 戻る。印を書いた後に待つものは無い（4.5）。呼んだ側は次の文で終了する（Claude は `io.exit()`、Codex は `process.exit(0)`） | — |

`via` が `"marker"`（`clear`／`compact`）の時は、今と同じく `rotation_marker_id` を書かない（段 2 を飛ばす。消費は行う）。例外は外へ出さず、結果（`consume`: consumed／lost_race／unknown／skipped、`marker`: written／skipped の理由）を戻り値で返す。結果は試験が読むために返すだけで、stderr の証拠には出さない（証拠の契約を変えない）。

なぜ印を消費の結果に結ばないか: 印が表すのは『この process が引き継ぎの文を出力に書いた』ことで、束の状態ではない。消費は次の起動に同じ文を渡さないための整理で、失敗しても（`unknown` を含む）文は既に出力に入っている。結果に依って印を書くか決めると、応答が失われた更新を『更新されていない』と誤って読む道ができる（1 回目の F1）。依存を無くせば、更新の結果を調べる道（非 active の束を読む verb。store に無く、足すと store の口が増える）は要らない。応答が失われた更新を、別の接続で見たゼロ件から『保存されていない』と結論しない、という考え方は、照会ではなく『結果に依る判断を作らない』で満たす。

### 4.4 出力の書き込みの成否の検知と、確定を呼ぶ場所（Claude と Codex の process 層に同じ形）
今の書き込みは成否を返さない。Claude の `writeAnswer` は 2 つの書き込みを数えるだけで、callback は誤りを受けない（`claude-session-start.ts:537-547`）。Codex の `writeCliResult` は 2 つの書き込みの後に `process.exit(0)` を直接呼び、注入できる process 層も無い（`codex-session-start.ts:1031-1036`）。

- 新しい共有の小さな module（名前は下書き）に次の 2 つを置く（S3: 「出力が書けた時だけ確定する」という判断は 1 か所）。(a) evidence（stderr）と output（stdout）を書き、output の成否を返す関数。(b) 4.3 の確定を呼ぶ関数。両方の process 層が同じ関数を呼ぶ。
- **成否の基準**: output（stdout）の callback が誤りなしで返り、かつ stdout の `error` event が出ていないこと。evidence（stderr）の失敗は基準に入れない。`error` event は callback の外で出る場合があるので、書く前に一度だけ聞く listener を付ける。**この基準が示すのは『OS の pipe が bytes を受け取った』ことだけで、host が受け取ったことではない**（host は hook が期限の前に終わった時にその出力を使い、期限に達した hook は取り消して出力を捨てる。4.8）。
- Claude: `io.write_output`・`io.write_evidence` の callback を、誤りを受ける型にする（IO は注入できるので T3 を書ける）。確定は `await writeAnswer(...)` の後、`ignoredNames` の分岐と `io.exit()` の前に入れる。診断（`finishAfterAnswer`）は確定の後に流す（`remaining_ms` は確定の後の時計で数えるので、確定の分だけ縮む。T11）。
- Codex: `main` の終わりを、Claude と同じ形の IO（`write_evidence`・`write_output`・`exit` に加えて、単調増加の `clock`）を受ける小さな関数に切り出す（挙動は変えない）。経過は `main` の最初に読んだ `clock` から数える（Codex の `main` には今は時計が無い）。確定は書き込みの後・`process.exit(0)` の前に入れる。入力が壊れている早い return（`codex-session-start.ts:1048` 以降の catch 側）は、同じ関数で degraded を書くが、確定の計画が付かないので確定しない。最後の `main().catch`（1094-1098 行、`process.exit(0)`）は切り出しの外で、確定を呼ばない（そこへ来るのは例外で、文が出力に入っていない）。**出力の後の挿入点は Claude と Codex で別々に作る**（共有なのは `prepareRotationRecovery` まで）。`codex-session-start.ts` は 1099 行で 800 行を超えるので、足すのは `main` の数行にとどめる（触る時に直す）。
- hook の期限（9 秒）の定数は Claude と Codex に 1 つずつある（`claude-session-start.ts:68`・`codex-session-start.ts:46`。今ある 2 か所の重複）。この PR は新しい literal を足さず、各 process 層が自分の定数を 4.3 の `hook_timeout_ms` に渡す。

### 4.5 確定の継続を止める線（1 回目の F1 への答え）

確定の中で『待つ可能性のある境目』は 5 つ。**線の引き方は 1 つ: 主の流れ（出力の後の確定を呼んだ側）だけが `turn` に触れ、それ以外の続きは何も書かない。** 主の流れは、段 1 を諦めた時に `abandoned` の旗を立て、以後は待たない。

| 境目 | 起きうること | 取り方 |
|---|---|---|
| store を開く（`createStore`） | 予算の後に開き終わる | 予算で競わせる。予算が切れたら `abandoned` を立てる。後から開き終わった続きは、`abandoned` を見て**消費を発行せず**、store を閉じるだけ（閉じるのを待たない） |
| 消費の発行（更新を送る） | 送った後は、応答が来るまで結果が分からない | 応答が来ない・誤り・予算切れは `unknown`。**再送しない・『更新されなかった』と読まない**。結果を使う判断が無い（4.3） |
| 消費の応答 | 予算の後に応答が来る | 続きは結果を捨てるだけで、`turn` にも store にも何も書かない |
| 印の書き込み | 同期の fs の呼び出し（ロックの待ちは `ROTATION_TURN_LOCK_WAIT_MS` まで、temp は先に書く。4.6） | 主の流れだけが書く。待ちが切れたら書かない。同期の呼び出しの途中は timer で止められない（残る窓は 4.8） |
| store を閉じる | `pool.end()` は戻らないことがある（`stores/pg-store.ts:1318`） | **閉じるのを待たない**（正常でも予算切れでも同じ）。消費は 1 回の更新か書き出しで済んでいて、閉じる事に依らない。process は印の後に `exit` で終わる |

予算は 2 段: 段 0 の `commit_by`（process の開始から 7 秒）が全体の線、段 1 の予算（最大 `ROTATION_COMMIT_BUDGET_MS`）が消費の線。3 つの値は `constants.ts` の 1 か所に置く（S3）: `ROTATION_COMMIT_BUDGET_MS`（下書き 1500）、`ROTATION_COMMIT_EXIT_MARGIN_MS`（下書き 2000）、`ROTATION_TURN_LOCK_WAIT_MS`（下書き 300）。段 0 が『残り ≥ 300』を要り、段 1 の予算は『残り − 300』までなので、確定は `commit_by` の手前で終わる（超えるのは同期の fs の ms 級の分だけ）。

確認の待ち（60 秒、2 秒ごとに見る）との関係: 印が付くのは出力の最大約 1.8 秒後。`turn.at`（`prepareRotationRecovery` が書いた時刻）は変わらないので、確認の条件のうち `turn.at >= respawn_started_ms` には影響しない。**ただし確認の条件はもう 1 つ `turn.state === "started"` を要る**（`rotation-watcher-core.ts:292・294`）。Stop／UserPromptSubmit の書き手は `busy`／`idle` と `rotation_marker_id: null` を書く（`session-rotation-stop.ts:444-455`）ので、`started` かつ印ありの組が見えるのは『印を書いてから、最初の Stop／UserPromptSubmit が書くまで』だけになる。今の順（印を hook の最初に書く）は、これに hook の残りの実行時間の分が足される。この設計はその分だけ窓が短くなる。見張りは 2 秒ごとに見るので、窓が 2 秒より短いと、配達に成功しても組を見ないまま `busy` を見て、確認の待ちを過ぎて `unconfirmed`／HALT になりうる（偽の失敗）。窓の長さは測っていない。以前の版は『`turn.at` が変わらないので影響しない』と書いたが、`state` の条件を見落としていた。OPEN-2（4.8）として残す。

### 4.6 `turn` の書き手の相互排他（1 回目の F2 への答え）

`turn` を書く手は 2 系統・4 か所（1 の末尾）。確定の印は『読んで、同じなら置き換える』ので、読んでから置き換えるまでの間に別の書き手が入ると、新しい状態（`busy`・`idle`・別の session の `started`）を古い写しで潰す。`writeJsonAtomic` は rename が原子的なだけで、条件つきではない。

- **すべての書き手が同じロックの中で書く。** ロックは席の置き場の `turn.lock` file（`openSync(path, "wx", 0o600)` で作る。作れた手だけが持つ。中身は持ち主の pid と時刻で、診断のためだけ）。持つ時間は ms 級: temp（`turn.json.<pid>.<n>.tmp`）は**ロックの外で先に書いて fsync し**、ロックの中は『読む → 比べる → rename → 置き場の fsync』だけ（`writeJsonAtomic` を『temp を作る』と『置き換える』に分ける）。
- 待ちは `ROTATION_TURN_LOCK_WAIT_MS` まで（10 ms 刻みの同期の待ち）。**確定の印**は、取れなければ書かない（印なし → HALT の安全側）。**Stop／UserPromptSubmit の書き手と、`prepareRotationRecovery` の `started` の書き込み**は、取れなければロックなしで書く（状態を落とさない）。ロックの作成が他の理由（権限など）で失敗した時も同じ。ロックを取る場所は共有の `writeTurn`（`session-rotation-files.ts:242`）の中で、Stop／UserPromptSubmit の書き手のファイル（`session-rotation-stop.ts`）には差分を作らない。Stop の書き手に増えるのは最大 `ROTATION_TURN_LOCK_WAIT_MS` の待ちだけで、書く内容・判断・出力は変えない。
- 古いロックは 1 つの規則で外す: file の更新時刻が `ROTATION_TURN_LOCK_STALE_MS`（下書き 30 秒。正当な持ち主は ms 級で、hook の期限 9 秒より十分長い）より古ければ、持ち主は死んでいる（または pid が使い回された）と見て、消して取り直す。pid の生死は見ない（pid の使い回しで永久に外れなくなるのを避ける）。
- 比べる条件（段 2）: 今の `turn` の `session_id`・`state = "started"`・`at` が計画の `turn` と同じで、`rotation_marker_id` が null。1 回目の F2 の反例（`readTurn` の後、rename の前に `busy` が書かれる）は、書き手が同じロックを通るので、`busy` の書き込みはロックの外で待つか、先に入って印の比べが失敗する。どちらの順でも新しい状態は残る（T12）。
- 残る窓（極低と見るが、判定は監査）: (a) ロックの持ち主が ms 級の区間で 300 ms を超えて止まる（fs の停止）と、待った側が諦める。確定の印は書かず（安全側）、Stop の書き手はロックなしで書くので、その時だけ持ち主の『比べる → rename』と交わりうる。(b) 古いロックを外す瞬間に、別の手が新しいロックを作る入れ替わり（stat と消去の間の µs）。(c) 古いロックの外しは、持ち主が 30 秒止まった（端末の休止など）後に再開すると、二重に持つ。(d) 持ち主が ms 級の区間で殺されて `turn.lock` が残ると、`ROTATION_TURN_LOCK_STALE_MS`（30 秒）の間、確定の印が書けず（安全側の印なし）、確認の待ち（60 秒）の前半を使う。Stop の書き手はロックなしで書くので止まらない。pid の生死を見る規則は、pid の使い回しを避けるため置かない。
- `rotation-watcher` と状態の表示は `turn` を読むだけで書かない。読み手は rename で原子的に差し替わる file を読むので、ロックを取らない。

### 4.7 確定が失敗した時と、次の起動

確定の失敗は 5 つ。(1) 段 0 の残りが足りず何もしない、(2) 段 2 の印が書けない（ロックが取れない・`turn` が変わっていた・無い・壊れている・例外）、(3) 出力が書けなかった／`rotation_commit` が無い（確定を呼ばない）、(4) 回復の読み込みが例外・期限で終わった（`rotation_commit` が付かない）、(5) 出力の後、印の前に process が止められた（T13a）。どれも `rotation_marker_id` は書かれない。

**消費の結果は印に影響しない**。段 1 の結果ごとの束と次の起動:

| 段 1 の結果 | 束の状態 | 印 | 次の起動 |
|---|---|---|---|
| `consumed` | `consumed` | 書く（段 2 の条件を満たせば） | 受け取る束が無い（通常の起動） |
| `lost_race`（null。他が先に消費した、または読んでから消費するまでの間に `expires_at` が切れた） | 他が `consumed`、または期限切れ | 書く（この process の出力には文が入っている） | 同上 |
| `unknown`（例外・予算切れ・応答が来ない） | `active` か `consumed`（どちらかは分からない） | 書く | `active` の時だけ、同じ文が再び渡りうる。束の `expires_at`（保存から 1800 秒。`session-rotation-stop.ts:361`）の後は返らない |
| 飛ばした（予算が 0 以下） | `active` | 書く | 同上 |

**消費が済んだ後に印が付かない時は、束は戻らない。** 段 2 が書けない（ロックが取れない・`turn` が変わっていた）、出力の後で印の前に止められた、`unknown` で実は消費されていた、のどれでも、束は `consumed` で、文は host に届いていても届いていなくても、この束からは取り直せない。失敗は HALT（`unconfirmed`）として見え、引き継ぎの文は人手で出すことになる。束の本文が DB の行に残るか、人手で再び渡す経路が今の code にあるかは、読んでいない。偽の確認（失敗が成功と記録される）を避けるために、『束を失う側』へ倒した選択で、案 B（取り消しの verb）を採らないことの費用。

見張りは、印が無い `turn` を確認済みと読まない（`isNewConversationConfirmed` が `turn.rotation_marker_id === marker.marker_id` を必須にしている。`rotation-watcher-core.ts:286-306`）。確認の待ち（`confirm_wait_seconds`、既定 `ROTATION_CONFIRM_WAIT_SECONDS` = 60 秒、2 秒ごとに見る）を過ぎると、claim は `unconfirmed`、台帳に `unconfirmed`、席に HALT（理由 `unconfirmed`）が書かれ、見張りはその席に 2 度目の respawn をしない（`rotation-watcher-attempt.ts:180-210`、`finishAttempt` の `halt`）。respawn の結果が分からない時も、claim は `unknown_quarantined`、HALT は `outcome_unknown`（同 `135-165`）。**安全側に落ちることを読んで確かめた**（T8）。

**2 節の F4（偽の確認）は、今の code では失敗が『確認済み』に見え、この設計では『印なし → `unconfirmed`／HALT』に変わる**（PR 本文と依頼の前の版は、今の失敗を `unconfirmed` と書いていた。今の code は失敗の前に印を書くので正しくは『偽の確認済み』）。

次の起動が同じ文をもう 1 度受け取れる条件は `decideRotationUse`（`session-rotation-start.ts:102-125`）の実装のとおり:
- `resume` は受け取らない（`resume_is_ordinary`）。
- `clear`／`compact`: marker の持ち主が同じ席で、marker が期限内（`ROTATION_MARKER_TTL_SECONDS` = 1800 秒）。pane は、**marker と今の起動の両方に pane id があって一致しない時だけ**拒否する（どちらかが null なら通る。121 行）。
- `startup`: claim が `respawning` で、かつ `respawn_started_at` から `ROTATION_CONFIRM_WAIT_SECONDS`（60 秒）の中で、かつ pane が一致する（両方に pane id があり、tmux socket も同じ）時だけ。HALT になった後の人手の `startup` は受け取らない。

**同じ文の二重の配達は許す**（引き継ぎは席自身の読むだけの文で、期限が束と marker の両方にある）。許さないのは「届いていないのに届いたと記録する」こと（S5）。回転の経路で束の状態を読むのは `session-rotation-start.ts` の 1 か所だけ（`git grep` で確かめた。同じ表を読む別の入口 `boot.ts`・`claude-start.ts` などは範囲外で、読んでいない）。

### 4.8 この直しが閉じない窓 — OPEN-1（1 回目の F3 への答え）と OPEN-2（見直し役の指摘）

**前の版の『stdout の書き込みが成功 = 届いた』は誤りだった。** stdout の callback が示すのは OS の pipe が bytes を受け取ったことだけ。Claude Code の hooks の文書（Exit code output の下の Timeouts の節。作者が 2026-11-12 に読んだ）は、『`timeout` に達した command hook を取り消し、その出力を捨てる』と書く。印を書いた後、process が終わる前に期限（9 秒）に達すると、host は出力を捨て、印と消費だけが残り、文は失われる。取り消しの時に process へどの信号を送るかは、文書に書かれていない。見張りは印だけで『確認済み』と読む（`rotation-watcher-core.ts:294`、`rotation-watcher-attempt.ts:150`）ので、偽の確認が起きる。

この PR が閉じる所と閉じない所:
- 閉じる: 今の順番の 3〜6（印が出力の前にあるので、読み込みの例外・期限・上限の適用・出力の書き込みの失敗のすべてが偽の確認になる）。印は出力の後の最後の 1 手になり、それらの失敗では印が付かない。
- 狭める: 印の後に待つものが無く、印の書き込み（rename と置き場の fsync）から終了までは同期の fs の呼び出しだけ。確定は process の開始から 7 秒（`commit_by`）までに終わるので、host の期限（9 秒）の約 2 秒前に印が付く。偽の確認が起きるのは、印と終了の間に process が約 2 秒止まった時（または host が別の理由で出力を捨てた時）だけ。
- **閉じない（OPEN-1）**: 印から終了までの停止、host が別の理由で出力を捨てる場合は、hook の中からは観測できない。

OPEN-1 の起きやすさ・困る大きさは作者の暫定を付けない。KY の表では『重大 × 低以上』は差し戻しで、監査がここを重大 × 低以上と判定する可能性がある。その時の選択肢（Owner か arc の決定が要る。この PR の範囲を超える）:
- O1: 狭めた残りを受け入れる（監査と Owner の KY の判断を記録する）。
- O2: 見張りの確認に host の受領の証拠を足す（新しい会話の transcript にある `hook_success`／`hook_additional_context`、終了コード 0、marker_id）。見張りか Stop の hook を変える（安全の設計・保護面）。Codex の transcript の形は読んでいない。Claude の transcript の形はこの Mac で確かめた。
- O3: 消費を常駐の見張りが確認の後に行う（hook から DB の手順を外す）。見張りと配備を変える。

**OPEN-2 — 確認の組（`started` かつ印）が見える時間が短くなる**（見直し役の指摘。4.5 の末尾）:
- 事実（code）: `isNewConversationConfirmed` は `turn.state === "started"` と `turn.rotation_marker_id === marker.marker_id` の両方を要る（`rotation-watcher-core.ts:292・294`）。Stop／UserPromptSubmit の書き手は `busy`／`idle` と印 null を書く（`session-rotation-stop.ts:444-455`、UserPromptSubmit の `mark_busy` は判断が `:157`、書き込みが `:478-479`）。見張りは 2 秒ごとに見る（`ROTATION_WATCHER_CONFIRM_POLL_SECONDS`）。
- 変わる所: 今の順は印が hook の最初なので、組は『hook の残りの実行時間 + host が最初に `busy`／`idle` を書くまで』見える。この設計は印が hook の最後なので、後者だけ。
- 分からない所: host が hook の終了から最初に `busy`／`idle` を書くまでの時間（測っていない）。Claude Code の hooks の文書は、`initialUserMessage` が `UserPromptSubmit` を呼ぶかを書かず、`initialUserMessage` の説明は非対話の `-p` の場面で書かれている（作者は WebFetch の抜粋で読んだ。原文の全体は読んでいない）。最初の書き込みが数秒より後なら影響は小さい。2 秒より短ければ、切り直しのたびに、配達に成功しても `unconfirmed`／HALT になりうる。
- 作者が決めないこと: 見張りの確認の条件（`state` を `started` に限る）と Stop の書き手が書く内容は、安全の設計で保護面。
- 選択肢（arc か Owner の決定が要る）: P1 受け入れる（実装の後の C2 の取り直しで、確認が取れた率を見る）。P2 Stop／UserPromptSubmit の書き手が直前の `started` の印を引き継いで書き、見張りが `busy`／`idle` でも同じ `marker_id`・新しい session・`turn.at` の条件を満たせば確認とする（見張りと Stop の書く内容を変える）。P3 見張りの確認の間隔 `ROTATION_WATCHER_CONFIRM_POLL_SECONDS` を短くする（見張りの定数の変更。窓が極短だと足りない）。
- 試験での固定: T8(c)（印の後に `busy` が書かれた `turn` は確認にならない。今の動きの固定）。

読んでいないもの: host が hook の終了から最初の `busy`／`idle` を書くまでの時間（実測なし。この Mac の会話の記録を文言で探したが、切り直された会話の記録は見つからなかった）、Claude Code が期限で hook を取り消す時の process への信号の挙動（文書に無い）、Codex の期限の挙動、Codex の transcript の hook の結果の形、文書の Timeouts の節以外（読んだのは文書の先頭 10 万字まで）。

### 4.9 触れないもの
通常の回復の束（`loadRestartPackData`）の経路、出力の形（`additionalContext`・`initialUserMessage`）、証拠の契約（`wasurezu-session-rotation-start/v1`、SessionStart の証拠）、DB の構造、store の verb、見張りの確認の条件と動き、`turn.json` の schema は**変えない**。足すのは席の置き場の `turn.lock` file だけ（schema を持たない排他の印）。共有の `writeTurn` がロックを取るので、Stop／UserPromptSubmit の書き手のファイル（`session-rotation-stop.ts`）には差分を作らない。Stop の書き手に増えるのは最大 `ROTATION_TURN_LOCK_WAIT_MS` の待ちだけで、書く内容・判断・出力は変えない。

守る物への触れ方: DB の構造 0（既存の store の 2 つの verb を呼ぶ順を変えるだけ）、権限 0、契約 0（出力・証拠の形を変えない）、資格情報 0、workflow 0。見張りの確認の印の書き方（出力の後の最後の 1 手）は安全に関わるので、その点は独立の設計監査に判定を任せ、OPEN-1 と OPEN-2 は別の決定の入口として残す。

## 5. 標準への照らし

- S3: 「出力が書けた時だけ確定する」判断は共有の module の 1 か所。確定の値（`ROTATION_COMMIT_BUDGET_MS`・`ROTATION_COMMIT_EXIT_MARGIN_MS`・`ROTATION_TURN_LOCK_WAIT_MS`・`ROTATION_TURN_LOCK_STALE_MS`）は `constants.ts` の 1 か所。hook の期限 9 秒は今 2 か所にある（4.4）。
- S4: 確定に `now`・`elapsed_ms`・`hook_timeout_ms` を渡す。核は時刻を取らない。ロックの古さは file の更新時刻（呼ぶ側の環境）で見る。
- S5: 確認の印（`rotation_marker_id`）を、宣言でなく**配達の後の事実**（output の書き込みの成功）に結ぶ。成否が分からない時は印を書かない（観測できずを成功にしない）。ただし結ぶ事実は『OS の pipe が受け取った』までで、host の受領ではない（OPEN-1）。確認の組が見える時間が短くなることは OPEN-2。更新の応答が失われた時は『更新されなかった』と読まず `unknown` とし、その結果に依る判断を作らない。
- S6: code だけの変更（`turn.lock` は席の置き場の作業 file で、schema の変更ではない）。旧い hook（消費が先・印も先）と新しい hook（消費が後・印が最後）は同じ DB・同じ `turn.json` で動く。旧い hook は `turn` をロックなしで書くので、旧い書き手が新しい確定の比べと交わる窓が同居の期間だけ残る（旧い hook は新しい版への差し替えで無くなる）。`consumeSelectedRestartPack` は 3 つの store のどれも `status = 'active'` を条件にする（`stores/pg-store.ts:1071-1085`・`stores/sqlite-store.ts:1480-1496`・`stores/json-store.ts:693-699`）。**PostgreSQL は 1 文の条件つき UPDATE なので、複数の process が競っても 1 度だけ効く。SQLite（sql.js）と JSON の store は、1 つの process の中でだけ 1 度だけ効く**（sql.js は process ごとにメモリ上の DB を持ち、`persist()` で全体を書き出す。JSON の store は読んでから書く）。複数の process が同時に消費する時の原子性は無いが、今の store の性質で、この席の本番は PostgreSQL なので、この直しの範囲では直さない。戻すのは code を戻すだけ（残った `turn.lock` は無害な作業 file）。
- S7: 外への効果は「束の消費」と「`turn` file」。消費は条件つきの更新で、再送しても効果は 1 回（再送はしない）。印は『今の `turn` が計画と同じ』の時だけ書く条件つきの書き込みで、二重に書いても同じ内容になる。
- S8: 確定の失敗を握りつぶさない。失敗は `rotation_marker_id` が null の `turn` と、`unconfirmed` の claim・HALT として見える（7 の 2）。
- 行の網羅率 100%: 足す code の行はすべて試験で通す。

## 6. 試験の項目（実装の前に決める。Claude と Codex の両方の process 層で T1・T3・T4・T10・T13 を流す）

| ID | 場面 | 期待 |
|---|---|---|
| T1 | 回復の読み込みが例外を投げる（`loadRestartPackData` が投げる） | 束は `active` のまま、`turn` の `rotation_marker_id` は null、degraded の出力、`rotation_commit` なし |
| T2 | `withTimeout` が超える | 同上。timeout の後に読み込みが終わっても、何も消費されない |
| T3 | 出力の書き込みの失敗。(a) stdout の callback が誤りを返す、(b) stdout の `error` event が出る、(c) stderr だけ失敗し stdout は成功 | (a)(b): 確定は呼ばれない、束は `active`、印なし。(c): stdout は成功なので確定する |
| T4 | 通常の起動 | (a) 順序が 出力 → 消費 → 印（最後）。(b) 出力の bytes（stdout・stderr）は今までと同じ。(c) 印と `exit` の間に待つ処理が無い（順序を記録で確かめる） |
| T5 | 消費の結果。(a) 競り負け（null。期限切れを含む）、(b) 例外、(c) 更新は効いたが応答が来ない（応答が失われた模型）、(d) 予算が 0 以下で飛ばす | どれも例外にならず、印は書かれる（条件を満たす時）。(c) の結果は `unknown` で、束を『更新されなかった』とは扱わない。再送しない（発行は 1 回） |
| T6 | 確定の線。(a) 残りが `ROTATION_TURN_LOCK_WAIT_MS` 未満 → 何もしない、(b) 消費の予算が切れる、(c) 予算の後に store が開き終わる → 消費を発行せず、store を閉じるだけ、(d) 予算の後に消費の応答が来る → `turn` も store も変わらない、(e) store の close が戻らない → 終了に届く | 席の出力に影響なし。遅れた続きは何も書かない。close を待たない |
| T7 | 確定の失敗の後の次の起動 | `decideRotationUse` のとおり。`clear`／`compact`: 期限内で pane id が一致する・どちらかが null なら受け取り、両方にあって不一致・期限外なら受け取らない。`startup`: claim が `respawning` で 60 秒の中・pane 一致なら受け取り、それ以外は受け取らない |
| T8 | 見張りが `turn` をどう読むか。(a) `rotation_marker_id` なし、(b) 確認の待ちを過ぎる、(c) 印の後に `busy`（印 null）が書かれた `turn` | (a) 確認済みとは読まない（`isNewConversationConfirmed` が false）。(b) claim が `unconfirmed`、席に HALT（`unconfirmed`）、2 度目の respawn なし。(c) 確認済みとは読まない（今の動きの固定で、OPEN-2 の依存を表明する。見張りの確認の条件を変える決定が出たら、この期待を決定のとおりに書き直す） |
| T9 | 旧い hook と新しい hook を同じ store に対して流す | 1 つの束を両方が消費しようとしても 1 度だけ効く（PostgreSQL）。SQLite・JSON は 1 つの process の中でだけ |
| T10 | 品質ログの書き込みが失敗し、結果が degraded（`EVIDENCE_LOG_UNAVAILABLE`）だが `additionalContext` に引き継ぎの文が入っている | `rotation_commit` が付き、output の書き込みが成功したら確定する（束 `consumed`、印あり） |
| T11 | 無視した key の名前がある起動（`ignoredNames`） | 順序は 出力 → 確定 → 診断。診断の残りの時間は確定の後の時計で数える |
| T12 | `turn` の条件と排他。(a) 確定の間に `turn` が別の状態（`session_id`・`state`・`at` のどれか）に書き換えられた、(b) `turn` が無い・壊れている（`readTurn` が null）、(c) 2 つの process の順序（実際の 2 process）: 比べる区間の途中に Stop の書き手が来る → 書き手はロックの外で待ち、最後に残るのは新しい状態。先に書き手が書いていた → 印の比べが失敗、(d) 古いロック（更新時刻を古くした file）が外される、(e) ロックが取れない → 印は書かれず、Stop の書き手は書く、(f) `started` の書き込みもロックを通る | (a)(b): 印は書かれず、新しい `turn` は上書きされず、無い・壊れた file も作り直さない。(c)(e): 新しい状態が失われない。(d): 取り直せる。(e): 確定の印は skipped |
| T13 | 確定の途中で process が止められる。(a) 出力の後、印の前 → 印なし、束は `active` か `consumed`、(b) 印の後、終了の前 → 印がある（OPEN-1。文書に書いた挙動をそのまま表明する） | (a): 見張りは確認済みと読まない。束が `consumed` なら戻らないことも表明する（4.7。取り消しの verb は無い）。(b): この挙動は 4.8 の閉じない窓で、試験は『今の設計の挙動』を固定するだけ |

PostgreSQL の試験は、手元の使い捨て DB で回す（project.md の決まり: socket を切る・`lc_messages=C`・一時の HOME）。

## 7. 決まったこと・範囲に入れないこと・開いていること

1. 入れ物: 同じ取り組みの construction に戻した（arc の判断。`aidlc engine jump execute --target code-generation --direction backward --scope express`。`reopen` は `--units` が必須で、express の取り組みには単位が無いため、前回（11-11）の backward jump と同じ系統の `execute` を使った）。
2. 確定の失敗の見せ方: 新しい項目は足さない。状態の表示（`session-rotation-status.ts:68-70・112・117-119`）が `turn.rotation_marker_id` と `claim.state` を既に出すので、失敗は「`rotation_marker_id` が null で、`claim.state` が `unconfirmed`」として見える。証拠の契約は変えない。
3. 範囲に入れない: `source = compact`／`clear` の起動で引き継ぎをどう扱うか（今のまま）、Codex の席の実機の確かめ（別）、SQLite・JSON の store の複数 process の原子性、host の受領の観測（OPEN-1）。Codex の SessionStart は `prepareRotationRecovery` を同じ順で呼ぶ（`codex-session-start.ts:840`）ので同じ誤りを持つ。読む側（4.1）は共有で、出力の後の確定（4.4）は両方の process 層に別々に足す。
4. 設計の見直し（AI-DLC の役 architecture-reviewer、読み取りだけ、2026-11-12）: 1 回目は NOT-READY、2 回目は READY（止める 0）。独立の設計監査の 1 回目（BLOCK、止める 3 件）の後、版 2 を新しく呼んだ見直し役に 1 回見せた。結果は NOT-READY（止める 1 件 = OPEN-2、直す方がよい 5、軽い 4）。指摘はこの版に取り込んだ（結果は PR の本文に書く）。
5. **開いていること — OPEN-1 と OPEN-2**: OPEN-1 は印の後に host が出力を捨てる窓（4.8）。OPEN-2 は確認の組が見える時間が短くなること（4.5・4.8）。選択肢（OPEN-1 は O1〜O3、OPEN-2 は P1〜P3）と、閉じるかどうかは Owner か arc の決定。この PR は、OPEN-1 は『狭める』まで、OPEN-2 は『依存を書いて試験で固定する』までで、設計と PR 本文はそのとおりに書く。
