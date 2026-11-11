# 見張りの設計の記録 — 会話の切り直し（261110-session-rotation、FR5）

- 版: 2（設計監査 1 回目の BLOCK F1〜F5 を受けた改版。版 1 は head `f8a2930`）。
- 位置づけ: 要件 FR5.6 により、見張りを守る物に触れる部品として扱う。この記録だけで単位の PR を先に出し、独立の設計監査（devauditor）を受ける。この単位の code と試験の code は、全部、その PASS と作者の受領の後に書く。
- 要件: `aidlc/spaces/default/intents/261110-session-rotation/inception/requirements-analysis/requirements.md` の FR4・FR5・FR6・NFR1・NFR3・NFR7。Owner の決定 OD-KUSABI-ROTATION-WATCHER-AND-CLAUDE-AUTOCOMPACT-300K-20261110-001（iyasaka-arc#49 6762423093）: 見張り（LLM を使わない script）もこの取り組みで作る。席に据える前に、arc-sec の確かめと Owner の決定を受ける。
- 据え付け（見張りを起こすこと、席の Stop・SessionStart・UserPromptSubmit の hook を新しい版に替えること）は、この PR に入れない。

## 0. 版 2 で直した所

| 指摘 | 直し方 | 節 |
|---|---|---|
| F1 入力欄が空と確かめられない | 静けさだけで判定しない。打った直後に入力欄を読み戻し、打った command と完全に一致する時だけ Enter を打つ。一致しなければ打った文字数だけ BSpace で戻して打たない。Enter の直前にもう一度読み戻す。入力欄を見つけられなければ打たない。 | 2.4・3.2 |
| F2 印・手番の会話と送り先 pane の対応 | hook が `pane_id`・tmux のソケット・host の process 番号を印と手番に書く。見張りは、設定の打つ先がその `pane_id` に引け、process がその pane の子孫で生きており、会話・席・案件が合う時だけ打つ。送る前と Enter の前に再確認する。 | 2.1〜2.3 |
| F3 同じ印で 1 回だけの排他 | 最初の send-keys の前に、`marker_id` に結ぶ排他の claim file を O_EXCL で作って fsync する。作れなければ打たない。段ごとに先に記録してから送る。結果不明なら照会し、照会できなければ止まる。再送しない。 | 5 |
| F4 戻しに要る切る前の session_id | 送る前に、host・切る前の `session_id`・席・案件・`pane_id`・`marker_id` を、追記だけの帳面に足して fsync する。印が置き換わっても旧会話を特定できる。 | 6 |
| F5 SSOT-6 §9 との食い違い | 画面に打つのを `/clear`（Claude Code）と `/new`（Codex）の command だけにする。Codex の「続きの 1 行」は打たない。Claude Code は SessionStart の initialUserMessage で続き、Codex は束を読んだ状態で次の入力を待つ。§9 は変えない。 | 1・3.3・10 |

## 1. 何をするか（一言で）

席の会話が一定量を超え、Kusabi が引き継ぎを DB に保存して「切ってよい」の印を出した後で、席が手すきで、入力欄が空と確かめられ、打つ先が印の会話と合う時にだけ、その席の画面に決まった command を 1 回打って会話を切る。打つのは command だけで、続きの文は打たない。新しい会話の頭には、Kusabi の SessionStart の hook が残した束を入れる（FR6。見張りの役ではない）。Claude Code は initialUserMessage で続きから動く。Codex は束を読んだ状態で、次の入力（中継の行か Owner）を待つ。

直す理由: SSOT-6 §9（live TUI への文の送信を通常の回復の道にしない）を優先した（arc の答え、Owner の委任 #49 6762288830）。回復の中身は構造化した hook の道で入り、画面に打った文には依存しない。打てなかった時は会話が切れないだけで、記録は何も失われない。

## 2. 見張りが見る物

見張りは DB を読まない（DB の資格情報を持たない）。席の hook が書く、手元の小さな状態の file 2 つと、tmux・process の状態だけを読む。file には会話の中身・秘密の値は書かない。

### 2.1 印の file（FR4 が書く）

- 置き場: `$AGENT_MEMORY_HOME/rotation/<agent_id>/<project>/marker.json`（`AGENT_MEMORY_HOME` が無い時は `$HOME/.agent-memory`）。folder は 0700、file は 0600。一時の file に書いてから rename で置き換える。
- 中身（`kusabi-rotation-marker/v1`）: `agent_id`・`project`・`host`（`claude_code` か `codex`）・`session_id`（切る会話）・`pane_id`・`tmux_socket`・`host_pid`（下の 2.2 と同じ取り方）・`pack_ref`（DB に置いた回復の束）・`pack_content_sha256`・`measured_tokens`・`threshold_tokens`・`saved_at`（Stop の hook が受け取った時刻を呼び手が渡す）・`handoff_source`（`seat_text` か `existing_records`）・`marker_id`（上の値を正規の JSON にした SHA-256）。
- Stop の hook は、Store への保存が終わった後にだけ印を書く（FR4.1）。保存に失敗したら印を書かない。

### 2.2 手番の file（席の hook が書く）

- 置き場: 同じ folder の `turn.json`（`kusabi-rotation-turn/v1`）。
- 中身: `agent_id`・`project`・`host`・`session_id`・`state`（`busy`・`idle`・`started`）・`source`（`started` の時）・`at`・`pane_id`・`tmux_socket`・`host_pid`。
- UserPromptSubmit の hook が `busy` を、Stop の hook（block を返さなかった時）が `idle` を、SessionStart の hook が新しい会話の `started` を書く。
- `pane_id` は hook の環境変数 `TMUX_PANE`、`tmux_socket` は `TMUX` の最初の項、`host_pid` は hook の親 process の番号（host の CLI 本体）。tmux の外で動く席は、どれも null にして書く。null の席は見張りが打たない。
- 時刻は hook が受け取った時に adapter が読み、核の判定には引数で渡す（標準 S4）。

### 2.3 席と画面の結び（F2）

見張りは、設定の file の `tmux_target`（`session:window.pane`）を `display-message -p -t <tmux_target> '#{pane_id}'` で `pane_id` に引き、以後の tmux の呼び出しは `-t <pane_id>` だけで行う（番号の入れ替わりに引きずられない）。次が全部そろった時だけ「結びが合う」とする。

1. 印の `pane_id` = 手番の `pane_id` = 引いた `pane_id`。印の `tmux_socket` = 手番の `tmux_socket` = tmux の `#{socket_path}`。
2. 印の `host_pid` = 手番の `host_pid`。その process が生きていて、`#{pane_pid}` と同じか、その子孫（`ps` を引数の配列で呼び、親をたどる。深さの上限あり）で、command の名前が設定の `expected_command`（`claude` か `codex`）に合う。`#{pane_current_command}` も合う。
3. 手番の `session_id` = 印の `session_id`（今も切る会話である）。手番・印の `agent_id`・`project`・`host` が互いに同じで、設定のその席の値とも同じ。

どれかを読めない・合わない時は「観測できず」か「不一致」とし、打たない。結びは、打つ条件の判定、claim の取得の後、V1 の読み戻しの後、Enter の直前の 4 か所で確かめる。

別の会話に置き換わった pane（設定の打つ先が別の pane を指す）、同じ名前の別の会話、pane の再利用（別の process が同じ pane を使う）、別の起動の古い file は、1〜3 のどれかで落ちる。

### 2.4 入力欄の確かめ（F1）

画面が静かなことは、入力欄が空であることを意味しない（書きかけを止めた人がいる）。そこで、静けさだけでは判定せず、打った後の読み戻しで確かめる。

- 画面は `capture-pane -p -t <pane_id>` で読み、メモリの中だけで比べる。中身は帳面にも log にも残さない。残すのは SHA-256 と、見つけた・一致したの真偽だけ。
- 入力欄の見つけ方: 設定の host ごとの `prompt_markers`（入力の行の先頭の印。枠線の文字と空白は読み飛ばす）で始まる、画面の下側の最後の行を入力の行とし、その行の印より後ろの文を「入力欄の文」とする。入力の行から下の枠線までの間に、ほかの文の行があれば、見つからない扱い。見つけられなければ打たない（観測できず）。
- 据え付ける前の確かめとして、見張りに読むだけの `probe` command を持たせる（画面を読み、入力欄を見つけられたか・空かの真偽と SHA-256 だけを出す。何も打たない）。host の版の違いで入力の行が見つからなくなれば、見張りは打たない側に倒れる。
- 判定の核は純粋な関数にし、画面の文・時刻は引数で受ける（標準 S4）。

## 3. いつ・何を打つか

### 3.1 打つ条件（全部そろった時だけ）

1. 印の file があり、形が正しく、`marker_id` を数え直して合う。
2. 印が新しい: `saved_at` から `marker_ttl_seconds`（既定 1,800 秒）以内。
3. 手番が `idle` で、`at` が印の `saved_at` 以後。席と画面の結びが合う（2.3）。
4. 手番が `idle` になってから `quiet_seconds`（既定 20 秒）以上たち、その間の画面の SHA-256 が 2 回とも同じ（動いている席には打たない。これは入力欄が空である証明ではなく、足切りに過ぎない）。
5. 設定の file にその席があり、pane があり、入力の行を見つけられる（2.4）。
6. 同じ `marker_id` の claim が無い（5）。
7. 1 時間あたりに切る回数の上限（既定 席ごとに 4 回）を超えていない。
8. HALT の file（全体、席ごと）が無い。
9. AUN が持つ席として設定された席では、設定に Owner の決定の参照（`owner_decision_ref`）がある（8）。

### 3.2 打つ手順（1 つの印につき 1 回だけ）

1. 条件 3.1 を確かめる（核 `decideRotationCut` が `proceed` を返す）。
2. 排他の claim を取る（5）。取れなければ打たない。
3. 意図の証拠（6 の `intent` 行）を帳面に足して fsync する。足せなければ打たない（claim を `aborted_before_send` にして終える）。
4. 席と画面の結びを確かめ、画面を読んで入力の行を見つけ、「打つ前の入力欄の文」をメモリに持つ。どれかできなければ打たない（claim を `aborted_before_send` にする）。
5. claim を `typing` に更新してから、`tmux send-keys -t <pane_id> -l <command>` を打つ。Enter は付けない。
6. 読み戻し V1: 画面を読み、入力欄の文が command と完全に一致するか確かめる。一致しない（書きかけがある・画面が変わった・読めない）時は、`BSpace` を command の文字数だけ打って戻し、入力欄の文が「打つ前」と同じに戻ったか確かめる。戻っていれば claim を `rolled_back`、帳面に `rolled_back` を足して終える。戻っていなければ、HALT の file を置いて止まる（席の入力欄が人の目で確かめられるまで、見張りは動かない）。
7. `settle_ms`（既定 300 ミリ秒）待ち、読み戻し V2 と、席と画面の結びの確かめをもう一度行う。変わっていれば 6 と同じに戻す。
8. claim を `enter` に更新してから、`tmux send-keys -t <pane_id> Enter` を打つ。
9. 確認: `confirm_wait_seconds`（既定 30 秒）まで手番の file を見て、新しい会話の `started`（`pane_id`・`host_pid`・`agent_id`・`project` が旧会話と同じで、`session_id` が旧と違い、`at` が Enter 以後）が来たら、claim を `done`、帳面に `confirmed` を足す。来なければ claim を `unconfirmed`、帳面に `unconfirmed` を足す。再送しない。

残る窓: V2 から Enter までの間（数十ミリ秒）に人が 1 文字打つと、command の後ろにその文字が付く。付いた文字は未知の command か短い入力になり、席の状態は壊れない。この窓は消せないので、PR の deviation_ledger に書く。

### 3.3 打つ物（決まった文字列だけ）

- Claude Code: `/clear` と `Enter`。続きは、SessionStart（source = `clear`）の hook が additionalContext と initialUserMessage で入れる（FR6.1）。
- Codex: `/new` と `Enter`。続きの文は打たない。新しい会話の SessionStart の hook が束を additionalContext で入れ（FR6.2）、席は束を読んだ状態で次の入力（中継の行か Owner）を待つ。
- 打てる文字列は、この 2 つの command と、戻しに使う `BSpace` と `Enter` のキーだけ。command は code の定数 1 か所に置く（標準 S3）。tmux は引数の配列で起こし、shell を通さない。打つ文字列に、印や設定の値を混ぜない。

## 4. 止める条件（打たない）

- 3.1 のどれかが欠ける。
- 印や手番の file を読めない・形が違う・`marker_id` が合わない。tmux・`ps` が無い、結びが合わない、画面を読めない、入力の行を見つけられない。どれも「観測できず」として打たず、理由を残す（標準 S5。観測できないことを手すきや空と読み替えない）。
- 読み戻しが一致しない（書きかけがある）。戻して打たない。
- 設定の file の持ち主が見張りを動かす利用者でない、または他人が書ける（0600 でない）: 見張りは起動しない。

## 5. 同じ印で 1 回だけ（排他の永続取得、F3）

- claim: `$AGENT_MEMORY_HOME/rotation/<agent_id>/<project>/claims/<marker_id>.json`（folder 0700、file 0600）。最初の `send-keys` より前に、`open(path, 'wx')`（O_EXCL）で作り、中身（`kusabi-rotation-claim/v1`: `marker_id`・`command`・`command_sha256`・`attempt_id`・`watcher_pid`・`claimed_at`・`state: "claimed"`）を書いて、file と folder を fsync する。作れない・書けない・fsync できない時は、打たない。
- 状態は進む向きだけ: `claimed` → `typing` → `enter` → `done` か `unconfirmed`。分かれ道は `rolled_back` と `aborted_before_send`。状態の更新は、一時の file に書いて rename で置き換え、fsync する。送る操作の前に、次の状態を先に記録する（write-ahead）。
- 取れなかった時（claim が既にある）:
  - 同じ `marker_id` で `command` が違う: 衝突として断る（`key_conflict`）。
  - 終わりの状態（`done`・`unconfirmed`・`rolled_back`・`aborted_before_send`）: 打たない（`already_attempted`）。
  - 途中の状態（`claimed`・`typing`・`enter`）で `watcher_pid` が生きている: 別の見張りが動いている。打たない（`in_progress_elsewhere`）。
  - 途中の状態で `watcher_pid` が死んでいる: 結果不明。照会する: 手番の file に新しい会話の `started`（3.2 の 9 と同じ条件で、claim の `claimed_at` 以後）があれば、claim を `done`（照会で確かめた）にする。無ければ claim を `unknown_quarantined` にし、帳面に `outcome_unknown` を足し、その席の HALT の file を置く。再送しない。
- 切る command は 1 つの印につき 1 回だけで、続きの文は無い。段は `typing`（文字を打つ）と `enter` の 2 つに分けて記録する。

## 6. 証拠（F4）

- 帳面: `$AGENT_MEMORY_HOME/rotation/watcher-ledger.jsonl`。追記だけ、1 行 1 件の JSON（`kusabi-rotation-watcher-evidence/v1`）、1 行ごとに fsync する。印のように置き換えない。
- `intent` 行（送る前に必ず足す。足せなければ送らない）: `at`・`attempt_id`・`marker_id`・`host`・`agent_id`・`project`・`old_session_id`（切る前の会話）・`pane_id`・`host_pid`・`command` の名前（`clear` か `new`）。
- 続く行: `typed_verified`・`rolled_back`・`enter_sent`・`confirmed`・`unconfirmed`・`outcome_unknown` のどれか。`attempt_id` と `marker_id` を持つ。打たなかった時は `skipped` と理由の型。画面の SHA-256 は足してよい。
- 画面の中身・会話の中身・秘密の値・環境変数は書かない。
- 印が次の会話の物に置き換わっても、帳面の `intent` 行から、`host` と `old_session_id` と席・案件を一意に求められる。

## 7. 失敗した時

- どの失敗も「打たない」に倒す。打ちかけた途中（文字を打った後、Enter の前）は、V1・V2 の読み戻しと戻し（3.2 の 6）で扱い、戻せなければ止まる。
- 帳面か claim に書けない時は、送らない。
- 見張りの loop は、HALT の file（全体 `$AGENT_MEMORY_HOME/rotation/HALT`、席ごと `.../<agent_id>/<project>/HALT`）があれば何もせずに待つ。連続して読めない・tmux が無い・入力の行を見つけられないなどの非進捗が `no_progress_halt_limit`（既定 30 回）続いたら、全体の HALT の file を書いて止まる（権限と待機の決まり R2）。解くのは HALT の file を消すことだけ。

## 8. AUN が持つ席

- 設計の正本 SSOT-6 §5 は「Wasurezu は AUN が監督する runtime を独自に作り直さない」と定める。見張りは Kusabi 本体ではなく、Owner の決定で据える別の script とし、§5・§6 をそれに合わせて直す（FR5.5。下の 10）。
- 設定で `aun_supervised: true` とした席は、`owner_decision_ref`（control_source の URL と本文の SHA-256）が無ければ打たない。あっても、AUN の待ち行列には触れない（見張りは画面に打つだけで、AUN の queue の claim・requeue・finalize をしない）。
- 最初に据えるのは Kusabi 自身の席（要件 FR9.2）。

## 9. 戻し方

- 見張りを止める: 見張りの process を止めるか、HALT の file を置く。席の設定・hook・DB には何も残らないので、止めれば元の動き（切らない）に戻る。
- 1 つの席から外す: 設定の file からその席を消す。
- 切った会話に戻る: 帳面の `intent` 行の `host` と `old_session_id` を使う。Claude Code は `claude --resume <old_session_id>`、Codex は `codex resume <old_session_id>` で前の会話を開ける（会話の file は host が残す）。据え付けの後に、使う host ごとに 1 回、この戻しを試して確かめる（Owner の決定で行う据え付けの一部。FR9.2）。
- 切り直しそのものを止める: Stop の hook の切り直しは、hook の command の引数で席ごとに切れる（`--rotation-threshold-tokens` を外すと既定、`--rotation off` で止める。FR2.2 で決める形）。これは席の hook の据え付けなので、Owner の決定で行う。
- 入力欄に `/clear` や `/new` が残った時（HALT の理由 `unknown_quarantined` など）: 席の入力欄を人が見て消す。見張りは再送しない。

## 10. SSOT-6 の直し（FR5.5）

- §5（AUN Suite Boundary）に足す: Kusabi の会話の切り直しの見張りは、Kusabi 本体とは別の、LLM を使わない script で、Owner の決定で据えた席だけで動く。AUN が監督する席では、席ごとの Owner の決定の参照が無ければ動かず、あっても AUN の待ち行列には触れない。見張りが画面に打つのは `/clear`（Claude Code）と `/new`（Codex）の command だけで、続きの文は打たない。回復の中身は SessionStart の hook が構造化して入れ、画面に打った文には依存しない（§9 を変えない）。
- §6（Standalone Boundary）の 3 条件との対応を足す: 「AUN の不在の確認」= 設定の `aun_supervised` と Owner の決定の参照、「対応する supervisor か hook」= この見張りと Kusabi の hook、「事前の許可」= 据え付けの時の Owner の決定（arc-sec の確かめの後）。
- 「Kusabi 本体（MCP の server・hook）は会話を切らない・画面に打たない」は変えない。hook がするのは、測る・保存する・印を出す・次の会話の頭に入れる、まで。
- §9（Fallback Rule）は変えない。

## 11. 設計の判断（標準と採らなかった案）

- S4: 打つかどうかの判定は純粋な関数 `decideRotationCut({marker, turn, paneProbe, claim, ledgerSummary, config, now})` にし、file・tmux・`ps`・画面・時計は adapter が読んで渡す。
- S5: 読めない・合わない・待ち切れないは、どれも「打たない」と理由で返す。入力欄が見つからないことを空と読み替えない。
- S3: 既定の値（TTL・静けさの秒数・settle・確認の待ち・回数の上限・command）は code の定数 1 か所に置く。host ごとの `prompt_markers` は設定の file に置き、据え付けの前に `probe` で確かめる。
- S7: 外に出る効果（画面への打ち込み）の前に、`marker_id` に結ぶ冪等キー（claim）を取り、同じキーの再送は効果を重ねず、結果不明は照会してから読み、照会できなければ止まる。盲目的に再送しない。
- S8: 打たなかった理由を必ず帳面に残し、黙って飛ばさない。
- S9: 見張りは DB の資格情報を持たない。読むのは手元の file・tmux・`ps` だけ。
- 採った判断: 見張りは DB を読まず、手元の印の file を読む。採らなかった案: 見張りが DB を読んで束の有無を確かめる（見張りに DB の資格情報を渡すことになり、標準 S9 に反するため）。束が無くても、次の会話は今までどおり DB から回復の束を作るので、切っても続きは失われない（FR6.3）。
- 採った判断: 手すきは hook の手番と画面の静けさで足切りし、入力欄が空かどうかは「打った直後の読み戻しが command と完全に一致する」ことで確かめる。採らなかった案: 静けさだけで判定する（静止した書きかけを拒めない。監査 F1）。画面の入力の行の形を読むので host の版の違いで壊れやすいが、見つけられない時は打たない側に倒し、`probe` で据え付けの前に確かめる。
- 採った判断: 書きかけがあった時は、打った文字数だけ BSpace で戻し、戻ったことを確かめる。採らなかった案: 入力欄を先に消す（人の書きかけを消すため）。
- 採った判断: Codex の続きの 1 行を打たない。採らなかった案: `/new` の後に続きの 1 行を打つ（SSOT-6 §9 の「通常の回復を live TUI への文の送信に頼らない」と食い違い、打ち込みの安全の範囲が広がるため。arc の答えで §9 を優先）。Codex の席は、束を読んだ状態で次の入力を待つ不便を受ける。
- 採った判断: claim は 1 つの印につき 1 つで、途中で止まった結果不明の席は止める。採らなかった案: 結果不明の時に打ち直す（二重に打つおそれがあるため）。

## 12. 試験の計画（設計監査の PASS の後に書く）

試験では本物の tmux を使わない。tmux・`ps`・画面・時計・file は差し替えられる形にする。

- F1: 静止した書きかけ（画面の SHA-256 が 2 回同じ）で、読み戻しが不一致になり、BSpace で戻して打たない。複数行の書きかけ。V1 と V2 の間に入力が足された。戻しが戻らなかった時は HALT。入力の行を見つけられない時は打たない。Codex は `/new` と Enter 以外を打たない（呼び出しの列を完全に照らす）。
- F2: 設定の打つ先が別の pane になった。同じ名前の別の会話（`session_id` 違い）。`host_pid` が死んでいる・pane の子孫でない。pane を別の process が再利用した。tmux のソケットが違う。印か手番の `pane_id` が null。確認の `started` が古い・別の起動・別の pane の物なら受けない（`unconfirmed`）。
- F3: 2 つの見張りが同じ印を同時に取りに行き、送るのは 1 つだけ。claim の取得が最初の send-keys より前。`typing`・`enter` の各段で止めた後の再起動で再送しない（結果不明は照会、照会できなければ HALT）。claim か帳面が書けない時は送らない。同じキーで別の command は断る。
- F4: `intent` 行が最初の send-keys より前にあり、`host`・`old_session_id`・席・案件・`pane_id` を持つ。印が次の会話の物に置き換わった後でも、帳面から旧会話を一意に求められる。帳面に画面の中身・秘密の値が無い。
- F5: 見張りの module が打てる文字列が `/clear`・`/new` と `BSpace`・`Enter` だけである（続きの文の定数が無い）。SSOT-6 の §9 に差分が無い。
- 据え付けの後（Owner の決定で行う。この PR の外）: 使う host ごとに、`probe` の確かめと、帳面の `old_session_id` から前の会話へ戻す確かめを 1 回ずつ行う。
