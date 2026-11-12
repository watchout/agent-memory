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

1. `prepareRotationRecovery` は**読むだけ**にする。`getSelectedRestartPack`、`sha256` の突き合わせ、`redactText`、文の組み立てまでを行い、`consumeSelectedRestartPack` は呼ばない。`turn` file の `started` は書くが、`rotation_marker_id` は **null** で書く。戻り値は今の `RotationBlock` のまま（形は変えない）。
2. 新しく `commitRotationRecovery`（名前は下書き）を足す。引数: store、context、marker、`now`（S4: 時刻は呼ぶ側が渡す）。中身: `consumeSelectedRestartPack` を呼び、**戻り値が null でない時だけ** `turn` file の `started` を `rotation_marker_id = marker_id`（claim 経由の時のみ）で書き直す。
3. 呼ぶのは、hook の process 層（`runClaudeSessionStartProcess`）が**出力の書き込みの callback を誤りなしで受けた後**だけ。出力を書けなかった時・degraded の出力の時は呼ばない。
4. commit は新しく store を開いて行う（`loadClaudeRecoveryFromStore` は `finally` で store を閉じるため）。hook 全体の上限は 9 秒（`CLAUDE_SESSION_START_HOOK_TIMEOUT_SECONDS`）、回復の読み込みの上限は 7 秒（`CODEX_SESSION_START_INTERNAL_TIMEOUT_MS`）なので、commit に使える時間は出力の書き込みの後の残り（最大で 2 秒）。commit 自身に短い上限（下書き: 1.5 秒）を置き、超えたら諦める。諦めても席には何も起きない（出力は出ている）。確認の待ち（60 秒）に対して commit は出力の直後に行うので、通常は間に合う。
5. commit が失敗した（例外・上限・消費の競り負け）時: `rotation_marker_id` は書かれない。見張りは確認済みと読まない（`isNewConversationConfirmed` が `turn.rotation_marker_id === marker.marker_id` を必須にしている。`rotation-watcher-core.ts:289-294`）。確認の待ち（`confirm_wait_seconds`、既定 `ROTATION_CONFIRM_WAIT_SECONDS` = 60 秒、2 秒ごとに見る）を過ぎると、claim は `unconfirmed`、台帳に `unconfirmed`、席に HALT（理由 `unconfirmed`）が書かれ、見張りはその席に 2 度目の respawn をしない（`rotation-watcher-attempt.ts:180-210`、`finishAttempt` の `halt`）。respawn の結果が分からない時も、claim は `unknown_quarantined`、HALT は `outcome_unknown`（同 `135-165`）。**安全側に落ちることを読んで確かめた**（T8 は、この読みを試験で固定する項目）。束は `active` のまま残る。次の起動が同じ文をもう 1 度受け取れるのは、起動の種類が `clear`／`compact` で、marker が期限内（`ROTATION_MARKER_TTL_SECONDS` = 1800 秒）かつ pane が一致する時だけ。`startup` の道は claim が `respawning` の間（確認の待ちの中）だけ使える（`decideRotationUse`、`session-rotation-start.ts:113-120`）ので、HALT になった後の人手の startup では受け取らない。**同じ文の二重の配達は許す**（引き継ぎは読むだけの文）。許さないのは「届いていないのに届いたと記録する」こと。
6. 通常の回復の束（`loadRestartPackData`）の経路、出力の形（`additionalContext`・`initialUserMessage`）、証拠の契約（`wasurezu-session-rotation-start/v1`、SessionStart の証拠）は**変えない**。

守る物への触れ方: DB の構造 0（既存の store の 2 つの verb を呼ぶ順を変えるだけ）、権限 0、契約 0（出力・証拠の形を変えない）、資格情報 0、workflow 0。

## 5. 標準への照らし

- S4: commit に `now` を渡す。核は時刻を取らない。
- S5: 確認の印（`rotation_marker_id`）を、宣言でなく**配達の後の事実**に結ぶ。
- S6: code だけの変更。旧い hook（消費が先）と新しい hook（消費が後）は同じ DB で動く。`consumeSelectedRestartPack` は `status = 'active'` の条件付きの UPDATE なので、両方が同じ束を消費しようとしても 1 度だけ効く。戻すのは code を戻すだけ。
- S7: 外への効果は「束の消費」と「`turn` file」。commit は競り負けで null になれば何も書かない（冪等）。 3 つの store（PostgreSQL・SQLite・JSON）の消費は、どれも `status = 'active'` を条件にする（`pg-store.ts:1071-1085`・`sqlite-store.ts:1480-1496`・`json-store.ts:693-699` と `findSelectedRestartPack`）。PostgreSQL と SQLite は 1 回の更新で条件を見るので 1 度だけ効く。JSON の store は読んでから書く（1 つの process の中では 1 度だけ効くが、複数の process が同時に消費する時の原子性は無い）。この席の本番は PostgreSQL なので、この直しの範囲では問題にしない（JSON の store の原子性は直さない）。
- S8: commit の失敗を握りつぶさない。失敗は `rotation_marker_id` が null の `turn` と、`unconfirmed` の claim・HALT として見える（7 の 2）。
- 行の網羅率 100%: 足す code の行はすべて試験で通す。

## 6. 試験の項目（実装の前に決める）

| ID | 場面 | 期待 |
|---|---|---|
| T1 | 3 の例外（`loadRestartPackData` が投げる） | 束は `active` のまま、`turn` の `rotation_marker_id` は null、degraded の出力 |
| T2 | `withTimeout` が超える | 同上。timeout の後に何も消費されない |
| T3 | 出力の書き込みの callback が誤りを返す | commit は呼ばれない。束は `active` |
| T4 | 通常の起動 | 出力の書き込みの後に束が `consumed`、`turn` に `rotation_marker_id` が入る。順序（出力 → 消費 → 印）を記録で確かめる |
| T5 | commit の中で消費が競り負け（null） | `rotation_marker_id` は書かれない。例外にならない |
| T6 | commit が上限を超える | 席の出力に影響なし。束は `active` のまま、印なし |
| T7 | commit の失敗の後の次の起動 | `clear`／`compact` で marker が期限内・pane 一致なら同じ文を受け取る。期限外・pane 不一致・`startup`（claim が `respawning` でない）では受け取らない |
| T8 | 見張りが `rotation_marker_id` なしの `turn` をどう読むか | 確認済みとは読まない（`isNewConversationConfirmed` が false）。確認の待ちを過ぎると claim が `unconfirmed`、席に HALT（`unconfirmed`）、2 度目の respawn なし |
| T9 | 旧い hook と新しい hook を同じ store に対して流す | 1 つの束を両方が消費しようとしても 1 度だけ効く（S6 の同居） |

PostgreSQL の試験は、手元の使い捨て DB で回す（project.md の決まり: socket を切る・`lc_messages=C`・一時の HOME）。

## 7. 決まったこと・範囲に入れないこと

1. 入れ物: 同じ取り組みの construction に戻した（arc の判断。`aidlc engine jump execute --target code-generation --direction backward --scope express`。`reopen` は `--units` が必須で、express の取り組みには単位が無いため、前回（11-11）の backward jump と同じ系統の `execute` を使った）。
2. commit の失敗の見せ方: 新しい項目は足さない。状態の表示（`session-rotation-status.ts:68-70・112・117-119`）が `turn.rotation_marker_id` と `claim.state` を既に出すので、失敗は「`rotation_marker_id` が null で、`claim.state` が `unconfirmed`」として見える。証拠の契約は変えない。
3. 範囲に入れない: `source = compact`／`clear` の起動で引き継ぎをどう扱うか（今のまま）、Codex の SessionStart への同じ直し（Codex の hook は `prepareRotationRecovery` を同じ順で呼ぶ（`codex-session-start.ts:840`）ので同じ誤りを持つ。**共有の経路なので同じ直しで両方に効く形にする**。Codex の席の実機の確かめは別）。
