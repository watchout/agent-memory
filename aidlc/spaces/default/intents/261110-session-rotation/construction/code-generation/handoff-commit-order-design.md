# 引き継ぎの確定の順番の直し — 設計の記録

状態: 設計の段（Code Generation に戻した後の、設計の記録。express には設計の段が無いので、他の `*-design.md` と同じく Code Generation の中に置く）。この file は設計の記録だけで、code は書いていない。出どころ: arc の指示（2026-11-12、Owner の委任 iyasaka-arc#49 6762288830 の技術の範囲。Owner の言葉ではない）。入れ物は arc の判断で、同じ取り組み 261110-session-rotation の construction を戻して直す（要求 → 設計 → code → 配備の追跡を 1 つに保つため。前例: parser の直し = Code Generation の Step 16、#342）。席の読みは読み取りだけ（DB・設定・展開は触っていない）。

## 1. 今の順番（code を読んだ事実）

Claude の SessionStart（`src/claude-session-start.ts`）の 1 回の起動は、次の順で進む。

| 順 | 何が起きるか | 場所 |
|---|---|---|
| 1 | 会話の取り込み（`receiveCurrentSessionTranscript`） | `claude-session-start.ts:317` |
| 2 | `prepareRotationRecovery`: 引き継ぎを読み、文を作り、**`consumeSelectedRestartPack` で消費済みにする**。続けて `turn` file に `started` を書き、claim 経由なら **`rotation_marker_id` も同時に書く** | `session-rotation-start.ts:229`・`263`・`235-245` |
| 3 | 通常の回復の束の読み込み（`loadRestartPackData`）、上限の適用（`enforceCodexRecoveryCaps`） | `claude-session-start.ts:334-343` |
| 4 | 品質ログの書き込み（失敗しても null で続く） | `claude-session-start.ts:347-377` |
| 5 | 全体が `withTimeout(binding.timeout_ms)` の中。超えると `RECOVERY_TIMEOUT` の degraded 出力（`additionalContext` なし） | `codex-session-start.ts:905-908`・`942-958` |
| 6 | 文の合成（`composeRotationContext`）と出力の書き込み（`process.stdout.write`）、終了 | `codex-session-start.ts:910`・`claude-session-start.ts:604` |

見張りは `turn.rotation_marker_id === marker.marker_id` を「新しい会話が引き継ぎを受け取った」確認として読む（`rotation-watcher-core.ts:294`）。

## 2. 問題

引き継ぎは 2 で**消費済み**と記録され、`turn` file にも**受け取った**と書かれるが、文が席に届くのは 6 の後。3〜6 のどこで失敗しても、次が起きる。

- 束は消費済みなので、次の起動は束を取り直せない（`getSelectedRestartPack` は `status = 'active'` だけを返す。`pg-store.ts:1057-1068`）。引き継ぎは失われる。
- `turn` file は「受け取った」と言うので、見張りは確認済みと読む。届いていないのに成功と記録される（宣言された値が証拠になっている。標準 S5）。

失敗の場面（起きやすさ・困る大きさは**作者の暫定**。独立の設計監査が判定する。表は aidlc-only の KY）:

| 場面 | 何が起きるか | 起きやすさ（暫定） | 困る大きさ（暫定） |
|---|---|---|---|
| F1 | 3〜4 の遅れで `withTimeout` が超える。degraded の出力が出て、束は消費済み。timeout の後も消費は完了しうる | 中（DB の遅れ・再起動の直後） | 重大（失敗が成功と記録され、引き継ぎが失われる） |
| F2 | 3 の読み込み・上限の適用が例外を投げる。catch が degraded を返す | 低 | 重大 |
| F3 | 6 の出力の書き込みが失敗する、または書いた直後に hook が止められる | 低 | 重大 |
| F4 | F1〜F3 の後、`turn` file の確認で見張りが確認済みと読む | F1〜F3 と同じ | 重大 |

## 3. 案

| 案 | 中身 | 判断 |
|---|---|---|
| A. 配達の後に確定 | 読む・文を作るまでを前に、**消費と確認の印を出力の書き込みが済んだ後**に移す | **採る** |
| B. 消費の取り消し | 失敗したら束を `active` に戻す verb を store に足す | 採らない。store の口が増える。timeout の後の消費や hook が止められた場合は取り消す道が走らない |
| C. 列を足して session 単位で冪等 | `selected_restart_packs` に消費した session の列を足し、同じ session の取り直しを許す | 採らない。DB の構造の変更で、Owner の判断が要る保護面。今回の直しの範囲に要らない |
| D. 消費を出力の直前へ寄せる | 3〜4 の後・6 の直前に消費 | 採らない。F3（書き込みの失敗・hook の停止）の窓が残る。A は窓を閉じる |

## 4. 採る案（A）の設計

### 4.1 読む側（`prepareRotationRecovery`）
1. **読むだけ**にする。`getSelectedRestartPack`、`sha256` の突き合わせ、`redactText`、文の組み立てまでを行い、`consumeSelectedRestartPack` は呼ばない。`turn` file の `started` は今と同じく書く（見張りへの射影。引き継ぎの無い起動でも書かれる）が、`rotation_marker_id` は **null** で書く。
2. 戻り値の `RotationBlock` に、確定の計画 `commit` を足す。中身は**データだけ**（関数・store を持たない）: `query`（`agent_id`・`project`・`pack_ref`）、`directory`（`turn` の置き場）、`turn`（今書いた `turn` の中身。`rotation_marker_id` は null、`at` と身元を含む）、`marker_id`、`via`（`"claim"` か `"marker"`）。`text`・`initial_user_message`・`marker_id` は今のまま。

### 4.2 確定の計画が process 層に届く道（内部の型の変更だけ。出力・証拠の形は変えない）
- `RotationBlock.commit` → `LoadedCodexRecovery.rotation`（Claude と Codex の loader は既に `rotation` を返す。`claude-session-start.ts:383`・`codex-session-start.ts:878`）→ `runCodexSessionStart` が `rotation_evidence` を付ける所（`codex-session-start.ts:940`）で `rotation_commit` も付ける → `runClaudeSessionStart` が `rotation_evidence` を写す所（`claude-session-start.ts:472`）で同じく写す。`runClaudeSessionStart` は `runCodexSessionStart` を包むので、結果の型を 2 か所（`CodexSessionStartRunResult`、`codex-session-start.ts:248`／`ClaudeSessionStartRunResult`、`claude-session-start.ts:168`）に足す。
- process 層が書くのは `result.output`（stdout）と `result.evidence`（stderr）だけ（`claude-session-start.ts:537-547`・`codex-session-start.ts:1031-1036`）。`rotation_commit` は書かない。出力の bytes は変わらない（T4 で固定）。
- **確定の対象かどうかは `rotation_commit` があるかで決める**（= 引き継ぎの文が出力の `additionalContext` に入ったか）。結果の `outcome`（full／degraded）では決めない。理由: 品質ログの書き込みが失敗すると `outcome` は degraded（`EVIDENCE_LOG_UNAVAILABLE`）になり `systemMessage` が付くが、`additionalContext` には引き継ぎの文が入る（`codex-session-start.ts:911`・`922-935`）。この場合は文が届くので確定する（T10）。回復の読み込みが例外・期限で終わった時は `loaded` が返らないので `rotation_commit` も付かず、確定しない（F1・F2）。

### 4.3 確定（`commitRotationRecovery`。名前は下書き）
引数: store、確定の計画、`now`（S4: 時刻は呼ぶ側が渡す）。中身: `consumeSelectedRestartPack({ ...query, consumed_at: now.toISOString() })` を呼ぶ。**戻り値が null でなく、かつ `via` が `"claim"` の時だけ**、書く直前に `readTurn` で今の `turn` を読み、**今の `turn` がこの process が書いた物（`session_id`・`state = "started"`・`at` が計画の `turn` と同じ）の時だけ**、計画の `turn` に `rotation_marker_id = marker_id` を足して `writeTurn` で書き直す（`at` は変えない）。違う時（確定の間に別の状態、例えば停止が書かれた）、および `readTurn` が null を返す時（file が無い・壊れている・schema が違う。`session-rotation-files.ts:220-223`）は書かず、印なしのままにする（安全側。新しい状態を古い写しで上書きしない）。読んでから書くまでの間の競りは残る（`writeJsonAtomic` 自体は rename で原子的）が、窓は小さく、失敗側は『印なし → HALT』の安全側。`state = "started"` を書くのは `prepareRotationRecovery` だけなので、同じ `session_id`・`state`・`at` の別の書き込みが起きる経路は無い（`writeTurn` の呼び元は `session-rotation-start.ts:235` と `session-rotation-stop.ts:445`）。`via` が `"marker"`（`clear`／`compact`）の時は、今と同じく `rotation_marker_id` を書かない。例外は外へ出さず、結果（消費した・印を書いた・どちらもしなかった）を返す。

### 4.4 出力の書き込みの成否の検知と、確定を呼ぶ場所（Claude と Codex の process 層に同じ形）
今の書き込みは成否を返さない。Claude の `writeAnswer` は 2 つの書き込みを数えるだけで、callback は誤りを受けない（`claude-session-start.ts:537-547`）。Codex の `writeCliResult` は 2 つの書き込みの後に `process.exit(0)` を直接呼び、注入できる process 層も無い（`codex-session-start.ts:1031-1036`）。

- 新しい共有の小さな module（名前は下書き）に次の 2 つを置く（S3: 「出力が書けた時だけ確定する」という判断は 1 か所）。(a) evidence（stderr）と output（stdout）を書き、output の成否を返す関数。(b) 確定を上限つきで呼ぶ関数。両方の process 層が同じ関数を呼ぶ。
- **成否の基準**: output（stdout）の callback が誤りなしで返り、かつ stdout の `error` event が出ていないこと。evidence（stderr）の失敗は基準に入れない（文が届いたかは stdout だけで決まる）。`error` event は callback の外で出る場合があるので、書く前に一度だけ聞く listener を付ける。
- Claude: `io.write_output`・`io.write_evidence` の callback を、誤りを受ける型にする（IO は注入できるので T3 を書ける）。確定は `await writeAnswer(...)` の後、`ignoredNames` の分岐と `io.exit()` の前に入れる。診断（`finishAfterAnswer`）は確定の後に流す（`remaining_ms` は確定の後の時計で数えるので、確定の分だけ縮む。T11）。
- Codex: `main` の終わりを、Claude と同じ形の IO（`write_evidence`・`write_output`・`exit` に加えて、単調増加の `clock`）を受ける小さな関数に切り出す（挙動は変えない）。経過（4.5）は `main` の最初に読んだ `clock` から数える（Codex の `main` には今は時計が無い）。確定は書き込みの後・`process.exit(0)` の前に入れる。入力が壊れている早い return（`codex-session-start.ts:1048` 以降の catch 側）は、同じ関数で degraded を書くが、確定の計画が付かないので確定しない。最後の `main().catch`（1094-1098 行、`process.exit(0)`）は切り出しの外で、確定を呼ばない（そこへ来るのは例外で、文が出力に入っていない）。**出力の後の挿入点は Claude と Codex で別々に作る**（共有なのは `prepareRotationRecovery` まで。前の版が『共有の経路なので同じ直しで両方に効く』と書いたのは不正確だった）。`codex-session-start.ts` は 1099 行で 800 行を超えるので、足すのは `main` の数行にとどめる（触る時に直す。まとめて直す計画は作らない）。
- 確定は**新しく store を開く**（loader は `finally` で閉じる。`claude-session-start.ts:385-387`）。`createStore({ skipPostgresMigrations: true })` で開き、`finally` で閉じる。

### 4.5 時間の予算
hook 全体の上限は 9 秒（`CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS`、`CODEX_SESSION_START_HOOK_TIMEOUT_SECONDS`）、回復の読み込みの上限は 7 秒（`CODEX_SESSION_START_INTERNAL_TIMEOUT_MS`。`codex-session-start.ts:45-46`）。ただし出力の前の `emit_runtime_event` と書き込み（`claude-session-start.ts:572-573`）には上限が無く、出力の後の残りが 2 秒とは限らない。そこで確定の上限は **`min(ROTATION_COMMIT_BUDGET_MS, 9 秒 − process の開始からの経過)`**。`ROTATION_COMMIT_BUDGET_MS`（下書き 1.5 秒）は `constants.ts` の 1 か所に置く（S3）。経過は process 層が自分の時計で数える（核は時刻を取らない。S4。Claude は `io.clock`、Codex は 4.4 で足す `clock`）。確認の待ち（60 秒、2 秒ごとに見る）に対して、確定は出力の直後に走り上限は最大 1.5 秒なので、通常は間に合う（`ROTATION_CONFIRM_WAIT_SECONDS` との関係。間に合わなければ 4.6 の『印なし → HALT』）。上限が 0 以下なら確定せず（束は `active` のまま）、超えたら諦める。諦めても席には何も起きない（出力は出ている）。

### 4.6 確定が失敗した時
確定の失敗は 3 つ: (1) 例外、(2) 上限（4.5）、(3) 消費が null（他の process に先を越された、または**読んでから消費するまでの間に `expires_at` が切れた**。新しい順では読んでから消費するまでが開くので、この窓は今より少し広がる。結果は同じく印なし）。これとは別に、(4) output が書けなかった／`rotation_commit` が無い時は、確定を呼ばない。どれも `rotation_marker_id` は書かれない。

見張りは確認済みと読まない（`isNewConversationConfirmed` が `turn.rotation_marker_id === marker.marker_id` を必須にしている。`rotation-watcher-core.ts:286-300`）。確認の待ち（`confirm_wait_seconds`、既定 `ROTATION_CONFIRM_WAIT_SECONDS` = 60 秒、2 秒ごとに見る）を過ぎると、claim は `unconfirmed`、台帳に `unconfirmed`、席に HALT（理由 `unconfirmed`）が書かれ、見張りはその席に 2 度目の respawn をしない（`rotation-watcher-attempt.ts:180-210`、`finishAttempt` の `halt`）。respawn の結果が分からない時も、claim は `unknown_quarantined`、HALT は `outcome_unknown`（同 `135-165`）。**安全側に落ちることを読んで確かめた**（T8 は、この読みを試験で固定する項目）。束は `active` のまま残る。

次の起動が同じ文をもう 1 度受け取れる条件は `decideRotationUse`（`session-rotation-start.ts:102-125`）の実装のとおり:
- `resume` は受け取らない（`resume_is_ordinary`）。
- `clear`／`compact`: marker の持ち主が同じ席で、marker が期限内（`ROTATION_MARKER_TTL_SECONDS` = 1800 秒）。pane は、**marker と今の起動の両方に pane id があって一致しない時だけ**拒否する（どちらかが null なら通る。121 行）。
- `startup`: claim が `respawning` で、かつ `respawn_started_at` から `ROTATION_CONFIRM_WAIT_SECONDS`（60 秒）の中で、かつ pane が一致する（両方に pane id があり、tmux socket も同じ）時だけ。HALT になった後の人手の `startup` は受け取らない。

**同じ文の二重の配達は許す**（引き継ぎは読むだけの文）。許さないのは「届いていないのに届いたと記録する」こと（S5）。

### 4.7 この直しが閉じない窓
stdout の callback は「OS の pipe が受け取った」ことしか示さない。host（Claude Code）が pipe を読む前に hook を止めると、確定は走り、文は失われる。配達の確認は host 側でしか取れない。この直しが閉じるのは今の順番の 3〜6 の窓で、この窓は閉じない（今の順番にも同じ窓がある）。host 側の挙動は読んでいない。起きやすさ・困る大きさは作者の暫定を付けず、独立の設計監査の判定に任せる。

### 4.8 触れないもの
通常の回復の束（`loadRestartPackData`）の経路、出力の形（`additionalContext`・`initialUserMessage`）、証拠の契約（`wasurezu-session-rotation-start/v1`、SessionStart の証拠）、DB の構造、store の verb は**変えない**。

守る物への触れ方: DB の構造 0（既存の store の 2 つの verb を呼ぶ順を変えるだけ）、権限 0、契約 0（出力・証拠の形を変えない）、資格情報 0、workflow 0。

## 5. 標準への照らし

- S3: 「出力が書けた時だけ確定する」判断は共有の module の 1 か所。確定の上限の値は `constants.ts` の 1 か所。
- S4: 確定に `now` を渡す。経過の時計は process 層が読む。核は時刻を取らない。
- S5: 確認の印（`rotation_marker_id`）を、宣言でなく**配達の後の事実**（output の書き込みの成功）に結ぶ。成否が分からない時は印を書かない（観測できずを成功にしない）。
- S6: code だけの変更。旧い hook（消費が先）と新しい hook（消費が後）は同じ DB で動く。`consumeSelectedRestartPack` は 3 つの store のどれも `status = 'active'` を条件にする（`pg-store.ts:1071-1085`・`sqlite-store.ts:1480-1496`・`json-store.ts:693-699`）。**PostgreSQL は 1 文の条件つき UPDATE なので、複数の process が競っても 1 度だけ効く。SQLite（sql.js）と JSON の store は、1 つの process の中でだけ 1 度だけ効く**（sql.js は process ごとにメモリ上の DB を持ち、`persist()` で全体を書き出す。JSON の store は読んでから書く）。複数の process が同時に消費する時の原子性は無いが、これは今の store の性質で、この席の本番は PostgreSQL なので、この直しの範囲では直さない。戻すのは code を戻すだけ。
- S7: 外への効果は「束の消費」と「`turn` file」。確定は競り負けで null になれば何も書かない（冪等）。
- S8: 確定の失敗を握りつぶさない。失敗は `rotation_marker_id` が null の `turn` と、`unconfirmed` の claim・HALT として見える（7 の 2）。
- 行の網羅率 100%: 足す code の行はすべて試験で通す。

## 6. 試験の項目（実装の前に決める。Claude と Codex の両方の process 層で T1・T3・T4・T10 を流す）

| ID | 場面 | 期待 |
|---|---|---|
| T1 | 回復の読み込みが例外を投げる（`loadRestartPackData` が投げる） | 束は `active` のまま、`turn` の `rotation_marker_id` は null、degraded の出力、`rotation_commit` なし |
| T2 | `withTimeout` が超える | 同上。timeout の後に読み込みが終わっても、何も消費されない |
| T3 | 出力の書き込みの失敗。(a) stdout の callback が誤りを返す、(b) stdout の `error` event が出る、(c) stderr だけ失敗し stdout は成功 | (a)(b): 確定は呼ばれない、束は `active`、印なし。(c): stdout は成功なので確定する |
| T4 | 通常の起動 | 出力の書き込みの後に束が `consumed`、その後 `turn` に `rotation_marker_id`（claim 経由の時）。順序（出力 → 消費 → 印）を記録で確かめる。出力の bytes（stdout・stderr）は今までと同じ |
| T5 | 確定の中で消費が競り負け（null）。期限切れを含む | `rotation_marker_id` は書かれない。例外にならない |
| T6 | 確定が上限を超える。上限が 0 以下（出力までに 9 秒近く使った） | 席の出力に影響なし。束は `active` のまま、印なし。上限 0 以下では確定を呼ばない |
| T7 | 確定の失敗の後の次の起動 | `decideRotationUse` のとおり。`clear`／`compact`: 期限内で pane id が一致する・どちらかが null なら受け取り、両方にあって不一致・期限外なら受け取らない。`startup`: claim が `respawning` で 60 秒の中・pane 一致なら受け取り、それ以外（claim が違う・60 秒を超えた・pane 不一致）は受け取らない |
| T8 | 見張りが `rotation_marker_id` なしの `turn` をどう読むか | 確認済みとは読まない（`isNewConversationConfirmed` が false）。確認の待ちを過ぎると claim が `unconfirmed`、席に HALT（`unconfirmed`）、2 度目の respawn なし |
| T9 | 旧い hook と新しい hook を同じ store に対して流す | 1 つの束を両方が消費しようとしても 1 度だけ効く（PostgreSQL。S6 の同居）。SQLite・JSON は 1 つの process の中でだけ |
| T10 | 品質ログの書き込みが失敗し、結果が degraded（`EVIDENCE_LOG_UNAVAILABLE`）だが `additionalContext` に引き継ぎの文が入っている | `rotation_commit` が付き、output の書き込みが成功したら確定する（束 `consumed`、印あり） |
| T11 | 無視した key の名前がある起動（`ignoredNames`） | 順序は 出力 → 確定 → 診断。診断の残りの時間は確定の後の時計で数える |
| T12 | 確定の間に `turn` が別の状態（`session_id` か `state` か `at` が違う）に書き換えられた。または `turn` が無い・壊れている（`readTurn` が null） | 印は書かれず、新しい `turn` は上書きされない（無い・壊れた file も作り直さない）。束は消費済み（この場合も印なしなので見張りは `unconfirmed` に落ちる） |

PostgreSQL の試験は、手元の使い捨て DB で回す（project.md の決まり: socket を切る・`lc_messages=C`・一時の HOME）。

## 7. 決まったこと・範囲に入れないこと

1. 入れ物: 同じ取り組みの construction に戻した（arc の判断。`aidlc engine jump execute --target code-generation --direction backward --scope express`。`reopen` は `--units` が必須で、express の取り組みには単位が無いため、前回（11-11）の backward jump と同じ系統の `execute` を使った）。
2. 確定の失敗の見せ方: 新しい項目は足さない。状態の表示（`session-rotation-status.ts:68-70・112・117-119`）が `turn.rotation_marker_id` と `claim.state` を既に出すので、失敗は「`rotation_marker_id` が null で、`claim.state` が `unconfirmed`」として見える。証拠の契約は変えない。
3. 範囲に入れない: `source = compact`／`clear` の起動で引き継ぎをどう扱うか（今のまま）、Codex の席の実機の確かめ（別）、SQLite・JSON の store の複数 process の原子性。Codex の SessionStart は `prepareRotationRecovery` を同じ順で呼ぶ（`codex-session-start.ts:840`）ので同じ誤りを持つ。読む側（4.1）は共有で、出力の後の確定（4.4）は両方の process 層に別々に足す。
4. 設計の見直し（AI-DLC の役 architecture-reviewer、読み取りだけ、2026-11-12。判定 NOT-READY）の指摘を取り込んだ: 止める 2（確定の入力が process 層に届く道 = 4.2、output の書き込みの成否の検知と Codex の挿入点 = 4.4）、直す方がよい 3（degraded の扱い = 4.2、SQLite の書き方 = 5 の S6、二重の配達の条件 = 4.6）、軽い 1（時間の予算 = 4.5、配達の限界 = 4.7）。あわせて作者が見つけた穴（確定の間に別の状態が書かれた `turn` を古い写しで上書きしない = 4.3、T12）を足した。案 A の向きは変えていない。
