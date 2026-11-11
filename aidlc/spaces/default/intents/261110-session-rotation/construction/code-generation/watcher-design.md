# 見張りの設計の記録 — 会話の切り直し（261110-session-rotation、FR5）

- 版: 3（設計監査 2 回目の BLOCK F1・F2 を受けた改版。版 2 は head `0aa667a`、版 1 は head `f8a2930`）。
- 位置づけ: 要件 FR5.6 により、見張りを守る物に触れる部品として扱う。この記録だけで単位の PR を先に出し、独立の設計監査（devauditor）を受ける。この単位の code と試験の code は、全部、その PASS と作者の受領の後に書く。
- 要件: `aidlc/spaces/default/intents/261110-session-rotation/inception/requirements-analysis/requirements.md` の FR4・FR5・FR6・NFR1・NFR3・NFR7。Owner の決定 OD-KUSABI-ROTATION-WATCHER-AND-CLAUDE-AUTOCOMPACT-300K-20261110-001（iyasaka-arc#49 6762423093）: 見張り（LLM を使わない script）もこの取り組みで作る。席に据える前に、arc-sec の確かめと Owner の決定を受ける。
- 据え付け（見張りを起こすこと、席の Stop・SessionStart・UserPromptSubmit の hook を新しい版に替えること）は、この PR に入れない。

## 0. 直した所

| 指摘 | 直し方 | 節 |
|---|---|---|
| 1 回目 F1・2 回目 F1 入力欄が空と確かめられない・人の入力との競合 | 入力欄が空と**証明できる**ことを、打つ条件にする（見つけられない・薄い案内文と合わない・カーソルが入力の頭に無い、は空と証明できない扱い）。人の入力が無いことを、tmux の client の最終操作の時刻で観測して条件にする。打った後は、Enter を送る前に、行の中身・カーソル位置・client の最終操作の時刻が「自分が打った直後の形」のままかを確かめ、Enter は tmux の中で条件つきに 1 回だけ実行する。 | 2.4・3.1・3.2 |
| 2 回目 F1 戻しの BSpace が人の入力を消す | **戻しのキーを全部やめる。** 見張りが送れるキーは「決まった command の文字」と「Enter 1 回」だけ。打った後に何かが確かめられなくなったら、追加のキーを 1 つも送らずに止める（人の入力やカーソルの持ち主を証明できないまま消すことをしない）。 | 3.2・3.3・4 |
| 1 回目 F2・2 回目 F2 対応を失った後の送信 | 打つ前と Enter の前に、席と画面の結び（pane_id・host の process・会話）を確かめる。打った後に結びが変わった・画面が読めなくなった場合は、**追加のキーを 0 件にして**「結果不明」として記録し、その席を止める。Enter も tmux の中で `pane_id`・`pane_pid`・command 名を確かめてから実行する。 | 2.3・3.2・5 |
| 1 回目 F3・F4・F5（2 回目で解消と確認済み） | 版 2 のまま（排他の claim・送る前の帳面・Codex の続きの文を打たない）。戻しのキーをやめたので、claim の状態から `rolled_back` を外し、`abandoned_after_typing` を足した。 | 5・6 |

## 1. 何をするか（一言で）

席の会話が一定量を超え、Kusabi が引き継ぎを DB に保存して「切ってよい」の印を出した後で、席が手すきで、入力欄が空と**証明でき**、人が触っていないと観測でき、打つ先が印の会話と合う時にだけ、その席の画面に決まった command を打ち、確かめてから Enter を 1 回送って会話を切る。打つのは command だけで、続きの文は打たない。確かめられない時は、何も送らずに止まる（途中で確かめられなくなった時も、追加のキーは送らない）。新しい会話の頭には、Kusabi の SessionStart の hook が残した束を入れる（FR6。見張りの役ではない）。Claude Code は initialUserMessage で続きから動く。Codex は束を読んだ状態で、次の入力（中継の行か Owner）を待つ。

直す理由（続きの文を打たない）: SSOT-6 §9（live TUI への文の送信を通常の回復の道にしない）を優先した（arc の答え、Owner の委任 #49 6762288830）。回復の中身は構造化した hook の道で入り、画面に打った文には依存しない。打てなかった時は会話が切れないだけで、記録は何も失われない。

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

### 2.3 席と画面の結び

見張りは、設定の file の `tmux_target`（`session:window.pane`）を `display-message -p -t <tmux_target> '#{pane_id}'` で `pane_id` に引き、以後の tmux の呼び出しは `-t <pane_id>` だけで行う（番号の入れ替わりに引きずられない）。次が全部そろった時だけ「結びが合う」とする。

1. 印の `pane_id` = 手番の `pane_id` = 引いた `pane_id`。印の `tmux_socket` = 手番の `tmux_socket` = tmux の `#{socket_path}`。
2. 印の `host_pid` = 手番の `host_pid`。その process が生きていて、`#{pane_pid}` と同じか、その子孫（`ps` を引数の配列で呼び、親をたどる。深さの上限あり）で、command の名前が設定の `expected_command`（`claude` か `codex`）に合う。`#{pane_current_command}` も合う。
3. 手番の `session_id` = 印の `session_id`（今も切る会話である）。手番・印の `agent_id`・`project`・`host` が互いに同じで、設定のその席の値とも同じ。

どれかを読めない・合わない時は「観測できず」か「不一致」とする。結びは、①打つ条件の判定、②claim の取得の後、③文字を打つ直前、④文字を打った後の確かめ、⑤Enter の実行そのもの（tmux の中。2.5）の 5 か所で確かめる。①〜④で合わなければ次へ進まない。⑤で合わなければ Enter は送られない。

別の会話に置き換わった pane（設定の打つ先が別の pane を指す）、同じ名前の別の会話、pane の再利用（別の process が同じ pane を使う）、別の起動の古い file は、1〜3 のどれかで落ちる。

### 2.4 入力欄の証明と、人の入力の観測

画面が静かなことは、入力欄が空であることを意味しない。そこで、次の 3 つを**全部**観測できた時だけ「入力欄は空で、人は触っていない」とする。1 つでも観測できない・合わない時は、空と証明できないので打たない。

1. 入力欄の文が空: 画面は `capture-pane -p -t <pane_id>`（見えている範囲だけ）で読み、メモリの中だけで比べる。中身は帳面にも log にも残さない（残すのは SHA-256 と真偽だけ）。設定の host ごとの `prompt_markers`（入力の行の先頭の印。枠線の文字と空白は読み飛ばす）で始まる、画面の下側の最後の行を入力の行とする。その行の印より後ろの文が、空白だけ、または設定の `placeholder_patterns`（host の版が空の入力欄に出す薄い案内文。完全一致）に当たる時だけ「空」とする。入力の行から下の枠線までの間にほかの文の行があれば空と見なさない。見つけられなければ打たない。
2. カーソルが入力の頭にある: tmux の `#{cursor_y}` が入力の行の番号（見えている範囲の上から数えた番号）と同じで、`#{cursor_x}` が印と空白の直後の桁と同じ。カーソルが見えない・別の行にある・桁が違う時は、入力の持ち主を証明できないので打たない。
3. 人が触っていない: その席の tmux の session に付いている client を `list-clients -t <session> -F '#{client_activity}'` で全部読み、最後の操作の時刻（秒）の最大値 `A0` が、`now - human_quiet_seconds`（既定 30 秒）以前である（client が 1 つも付いていなければ `A0` は無しとし、条件は満たす）。`list-clients` が読めない時は打たない。tmux の client を通る人の入力は、client の最終操作の時刻に必ず出る。

据え付ける前の確かめとして、見張りに読むだけの `probe` command を持たせる（上の 3 つを画面から求め、見つけられたかの真偽・桁と行の番号・`A0`・tmux の版・条件つき実行の対応の有無・SHA-256 だけを出す。何も打たない）。host の版の違いで入力の行・カーソル・薄い案内文が合わなくなれば、見張りは打たない側に倒れる。判定の核は純粋な関数にし、画面の文・tmux の値・時刻は引数で受ける（標準 S4）。

### 2.5 条件つきの Enter（見張りの側の隙間を作らない）

Enter は、見張りが確かめた後に別の呼び出しで送るのではなく、tmux の中で条件を評価して送る 1 つの命令にする。

`tmux if-shell -F -t <pane_id> '<条件>' 'send-keys -t <pane_id> Enter' 'display-message -p ENTER_NOT_SENT'`

条件 = `#{pane_id}` が引いた値と同じ、`#{pane_pid}` が打つ前に見た値と同じ、`#{pane_current_command}` が `expected_command` と同じ、`#{cursor_y}` が打つ前と同じ、`#{cursor_x}` が「打つ前の桁 + command の文字数」と同じ、`#{session_attached}`（付いている client の数）が打つ前と同じ。tmux はこの評価と送信を 1 つの命令列として続けて行うので、評価と送信の間に見張りの側の待ち時間が入らない。条件が偽なら Enter は送られず、標準出力に `ENTER_NOT_SENT` が返るので、送られたかが曖昧なままにならない。

tmux の版がこの命令の形に対応しない・`ENTER_NOT_SENT` の印を読めない時は、そもそも打たない（`probe` で据え付けの前に確かめる）。この設計の確かめに使った tmux は 3.6a で、`cursor_x`・`cursor_y` の変化、条件が真の時の送信、偽の時の `display-message -p`、client が無い時の `list-clients` の空の結果を、使い捨ての tmux で確かめた（host の画面での確かめは `probe` と据え付けの後の確かめで行う。FR9.2）。

## 3. いつ・何を打つか

### 3.1 打つ条件（全部そろった時だけ）

1. 印の file があり、形が正しく、`marker_id` を数え直して合う。
2. 印が新しい: `saved_at` から `marker_ttl_seconds`（既定 1,800 秒）以内。
3. 手番が `idle` で、`at` が印の `saved_at` 以後。席と画面の結びが合う（2.3）。
4. 手番が `idle` になってから `quiet_seconds`（既定 20 秒）以上たち、その間の画面の SHA-256 が 2 回とも同じ（足切り。これは入力欄が空である証明ではない）。
5. 入力欄が空と証明でき、人が触っていない（2.4 の 3 つ）。条件つきの Enter に対応している（2.5）。
6. 設定の file にその席があり、pane がある。
7. 同じ `marker_id` の claim が無い（5）。
8. 1 時間あたりに切る回数の上限（既定 席ごとに 4 回）を超えていない。
9. HALT の file（全体、席ごと）が無い。
10. AUN が持つ席として設定された席では、設定に Owner の決定の参照（`owner_decision_ref`）がある（8）。

### 3.2 打つ手順（1 つの印につき 1 回だけ）

見張りが送るキーは、手順 6 の「command の文字」と手順 9 の「Enter」の 2 回だけ。それ以外のキー（BSpace・C-u・Escape・矢印を含む）は、どの失敗の時にも送らない。

1. 条件 3.1 を確かめる（核 `decideRotationCut` が `proceed` を返す）。
2. 排他の claim を取る（5）。取れなければ打たない。
3. 意図の証拠（6 の `intent` 行）を帳面に足して fsync する。足せなければ打たない（claim を `aborted_before_send` にして終える）。
4. 送る直前の確かめ: 席と画面の結び（2.3）、入力欄の証明と人の入力の観測（2.4）、手番がまだ `idle` で `at` が同じ、を全部もう一度行い、打つ前の値（`pane_pid`・カーソルの桁 `x0` と行 `y0`・client の最終操作の最大値 `A0`）をメモリに持つ。1 つでも合わない・読めなければ、何も送らず claim を `aborted_before_send` にして終える。
5. claim を `typing` に更新する（送る操作の前に先に記録する）。
6. `tmux send-keys -t <pane_id> -l <command>` を 1 回だけ打つ（Enter は付けない）。
7. `settle_ms`（既定 300 ミリ秒）待ち、打った後の確かめ V を行う。次が**全部**合う時だけ先へ進む。
   - 席と画面の結び（2.3）が合う（`pane_pid` は `x0` の時と同じ）。
   - 画面の入力の行の文が、印の後ろにちょうど command だけで、ほかの行が無い。
   - カーソルが行 `y0`、桁 `x0 + command の文字数` にある。
   - client の最終操作の最大値が `A0` のまま（新しい操作が無い。client が付いていなかったなら、今も付いていない）。
   - 手番がまだ `idle` で、`at` が同じ。
8. V が 1 つでも合わない・読めない・tmux が応答しない時は、**追加のキーを 1 つも送らない。** claim を `abandoned_after_typing` にし、帳面に `abandoned_after_typing`（合わなかった項目の型だけ。中身は書かない）を足し、その席の HALT の file を置いて止まる。入力欄に残った command の文字は、人が見て消す（9）。見張りは消さない。人の元の入力や、カーソルの持ち主を証明できないまま文字数だけ消すことは、回復として扱わない。
9. V が全部合ったら、claim を `enter` に更新してから、2.5 の条件つきの Enter を 1 回だけ実行する。標準出力に `ENTER_NOT_SENT` が返った・tmux が失敗した時は、追加のキーを送らず、claim を `abandoned_after_typing` にして手順 8 の止まり方をする。
10. 確認: `confirm_wait_seconds`（既定 30 秒）まで手番の file を見て、新しい会話の `started`（`pane_id`・`host_pid`・`agent_id`・`project` が旧会話と同じで、`session_id` が旧と違い、`at` が Enter 以後）が来たら、claim を `done`、帳面に `confirmed` を足す。来なければ claim を `unconfirmed`、帳面に `unconfirmed` を足し、その席の HALT の file を置く。再送しない。

残る窓と、その結果の範囲: 結び・カーソル・付いている client の数は Enter の評価の中で tmux が確かめるので、その確かめと送信の間に見張りの側の待ち時間は無い。一方、client の最終操作の時刻（2.4 の 3）の再確認は、見張りが読んでから条件つきの Enter を起こすまでの数ミリ秒の間にある。その間と、見張りが最後に観測した時点から tmux が Enter を書くまでの間に、まだ画面に出ていない途中の入力（host が入力を画面に出すまでの遅れ）や、tmux の client を通らない別の送り元（中継 script など）の入力が command の行に足されると、その行ごと送られる。この窓は見張りからは排除できない。結果は、command の前後に数文字が付いた 1 行が送られること（未知の command として退けられるか、短い入力として送られる）に限る。入力の削除・席の状態の破壊は起きない（BSpace などを送らないため）。この場合は新しい会話の `started` が来ないので手順 10 の `unconfirmed` になり、席が止まる。PR の deviation_ledger にも書くが、安全の条件はこの節の観測と 5 か所の確かめで満たし、deviation_ledger の記載で代えない。

### 3.3 打つ物（決まった文字列だけ）

- Claude Code: `/clear` と `Enter`。続きは、SessionStart（source = `clear`）の hook が additionalContext と initialUserMessage で入れる（FR6.1）。
- Codex: `/new` と `Enter`。続きの文は打たない。新しい会話の SessionStart の hook が束を additionalContext で入れ（FR6.2）、席は束を読んだ状態で次の入力（中継の行か Owner）を待つ。
- 見張りが送れるキーは、この 2 つの command の文字（手順 6）と `Enter`（手順 9）だけ。BSpace・C-u・Escape・矢印・その他のキーは、送る経路そのものを code に持たない（定数も無い）。command は code の定数 1 か所に置く（標準 S3）。tmux は引数の配列で起こし、shell を通さない。打つ文字列に、印や設定の値を混ぜない。

## 4. 止める条件（打たない・追加で送らない）

- 3.1 のどれかが欠ける。
- 印や手番の file を読めない・形が違う・`marker_id` が合わない。tmux・`ps` が無い、結びが合わない、画面・カーソル・client の一覧を読めない、入力の行を見つけられない、入力欄が空と証明できない、人の入力が観測された。どれも「観測できず」か「不一致」として打たず、理由を残す（標準 S5。観測できないことを手すきや空と読み替えない）。
- 打った後に確かめ V が合わない・読めない: 追加のキーを送らず、止まる（3.2 の 8）。
- 設定の file の持ち主が見張りを動かす利用者でない、または他人が書ける（0600 でない）: 見張りは起動しない。

## 5. 同じ印で 1 回だけ（排他の永続取得）

- claim: `$AGENT_MEMORY_HOME/rotation/<agent_id>/<project>/claims/<marker_id>.json`（folder 0700、file 0600）。最初の `send-keys` より前に、`open(path, 'wx')`（O_EXCL）で作り、中身（`kusabi-rotation-claim/v1`: `marker_id`・`command`・`command_sha256`・`attempt_id`・`watcher_pid`・`claimed_at`・`state: "claimed"`）を書いて、file と folder を fsync する。作れない・書けない・fsync できない時は、打たない。
- 状態は進む向きだけ: `claimed` → `typing` → `enter` → `done` か `unconfirmed`。分かれ道は `aborted_before_send`（何も送る前に止まった）と `abandoned_after_typing`（文字を打った後に確かめられなくなり、追加のキーを送らずに止まった）。状態の更新は、一時の file に書いて rename で置き換え、fsync する。送る操作の前に、次の状態を先に記録する（write-ahead）。
- 取れなかった時（claim が既にある）:
  - 同じ `marker_id` で `command` が違う: 衝突として断る（`key_conflict`）。
  - 終わりの状態（`done`・`unconfirmed`・`abandoned_after_typing`・`aborted_before_send`）: 打たない（`already_attempted`）。次の Stop が新しい印を作れば、その印は別の `marker_id` で別に扱われる。
  - 途中の状態（`claimed`・`typing`・`enter`）で `watcher_pid` が生きている: 別の見張りが動いている。打たない（`in_progress_elsewhere`）。
  - 途中の状態で `watcher_pid` が死んでいる: 結果不明。照会する: 手番の file に新しい会話の `started`（3.2 の 10 と同じ条件で、claim の `claimed_at` 以後）があれば、claim を `done`（照会で確かめた）にする。無ければ claim を `unknown_quarantined` にし、帳面に `outcome_unknown` を足し、その席の HALT の file を置く。再送しない。追加のキーも送らない。
- 切る command は 1 つの印につき 1 回だけで、続きの文は無い。段は `typing`（文字を打つ）と `enter` の 2 つに分けて記録する。

## 6. 証拠

- 帳面: `$AGENT_MEMORY_HOME/rotation/watcher-ledger.jsonl`。追記だけ、1 行 1 件の JSON（`kusabi-rotation-watcher-evidence/v1`）、1 行ごとに fsync する。印のように置き換えない。
- `intent` 行（送る前に必ず足す。足せなければ送らない）: `at`・`attempt_id`・`marker_id`・`host`・`agent_id`・`project`・`old_session_id`（切る前の会話）・`pane_id`・`host_pid`・`command` の名前（`clear` か `new`）。
- 続く行: `typed_verified`・`enter_sent`・`confirmed`・`unconfirmed`・`abandoned_after_typing`・`outcome_unknown` のどれか。`attempt_id` と `marker_id` を持つ。打たなかった時は `skipped` と理由の型。画面の SHA-256 は足してよい。
- 画面の中身・会話の中身・秘密の値・環境変数は書かない。
- 印が次の会話の物に置き換わっても、帳面の `intent` 行から、`host` と `old_session_id` と席・案件を一意に求められる。

## 7. 失敗した時

- どの失敗も「打たない」か、打った後なら「追加のキーを送らずに止まる」に倒す。
- 帳面か claim に書けない時は、送らない。打った後に書けなくなった時も、追加のキーは送らず、止まる。
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
- 入力欄に `/clear` や `/new` が残った時（`abandoned_after_typing`・`unconfirmed`・`unknown_quarantined`）: 見張りは席を止める（その席の HALT の file）。席の入力欄を人が見て、残った command の文字だけを消す。元から人が書いていた文があれば、その文は人が残す。見張りは消さず、再送もしない。消した後に、その席の HALT の file を人が消すと、次の印から再開する。

## 10. SSOT-6 の直し（FR5.5）

- §5（AUN Suite Boundary）に足す: Kusabi の会話の切り直しの見張りは、Kusabi 本体とは別の、LLM を使わない script で、Owner の決定で据えた席だけで動く。AUN が監督する席では、席ごとの Owner の決定の参照が無ければ動かず、あっても AUN の待ち行列には触れない。見張りが画面に送るのは、`/clear`（Claude Code）か `/new`（Codex）の文字と Enter 1 回だけで、続きの文は打たず、戻しのキーも送らない。入力欄が空と証明でき、人が触っていないと観測でき、打つ先が印の会話と合う時にだけ動き、打った後に確かめられなくなったら追加のキーを送らずに止まる。回復の中身は SessionStart の hook が構造化して入れ、画面に打った文には依存しない（§9 を変えない）。
- §6（Standalone Boundary）の 3 条件との対応を足す: 「AUN の不在の確認」= 設定の `aun_supervised` と Owner の決定の参照、「対応する supervisor か hook」= この見張りと Kusabi の hook、「事前の許可」= 据え付けの時の Owner の決定（arc-sec の確かめの後）。
- 「Kusabi 本体（MCP の server・hook）は会話を切らない・画面に打たない」は変えない。hook がするのは、測る・保存する・印を出す・次の会話の頭に入れる、まで。
- §9（Fallback Rule）は変えない。

## 11. 設計の判断（標準と採らなかった案）

- S4: 打つかどうかの判定は純粋な関数 `decideRotationCut({marker, turn, paneProbe, claim, ledgerSummary, config, now})` にし、file・tmux・`ps`・画面・時計は adapter が読んで渡す。
- S5: 読めない・合わない・待ち切れないは、どれも「打たない」と理由で返す。入力の行やカーソルを見つけられないことを空と読み替えない。
- S3: 既定の値（TTL・静けさの秒数・人の静けさの秒数・settle・確認の待ち・回数の上限・command）は code の定数 1 か所に置く。host ごとの `prompt_markers`・`placeholder_patterns` は設定の file に置き、据え付けの前に `probe` で確かめる。
- S7: 外に出る効果（画面への打ち込み）の前に、`marker_id` に結ぶ冪等キー（claim）を取り、同じキーの再送は効果を重ねず、結果不明は照会してから読み、照会できなければ止まる。盲目的に再送しない。
- S8: 打たなかった理由・止まった理由を必ず帳面に残し、黙って飛ばさない。
- S9: 見張りは DB の資格情報を持たない。読むのは手元の file・tmux・`ps` だけ。
- 採った判断: 見張りは DB を読まず、手元の印の file を読む。採らなかった案: 見張りが DB を読んで束の有無を確かめる（見張りに DB の資格情報を渡すことになり、標準 S9 に反するため）。束が無くても、次の会話は今までどおり DB から回復の束を作るので、切っても続きは失われない（FR6.3）。
- 採った判断: 戻しのキーを送らない。打った後に確かめられなくなったら、追加のキーを 0 件にして止まる。採らなかった案: 文字数だけ BSpace で戻す（カーソルや入力の持ち主を証明できないまま人の入力を消すおそれがある。設計監査 2 回目 F1）。採らなかった案: C-u などで行を消す（人の書きかけを消す）。止まる代わりに、入力欄に command の文字が残る不便を人が受ける（9）。
- 採った判断: 人の入力が無いことを、tmux の client の最終操作の時刻で観測して条件にし、Enter の直前にも同じ値が変わっていないことを確かめる。採らなかった案: 画面が静かなことだけを根拠にする（静止した書きかけを拒めない。設計監査 1 回目 F1）。
- 採った判断: Enter は tmux の中で条件を評価して送る 1 つの命令にする（見張りの側の待ち時間を作らない）。採らなかった案: 確かめた後に別の呼び出しで Enter を送る（確かめと送信の間に見張りの側の隙間が入る。設計監査 2 回目 F1 の「V2 の後の置き換え」）。
- 採った判断: 打った後に結びが変わった・画面が読めなくなった時は、追加のキーを送らない。採らなかった案: そこでも BSpace で戻す（別の process に届くおそれ。設計監査 2 回目 F2）。
- 採った判断: Codex の続きの 1 行を打たない。採らなかった案: `/new` の後に続きの 1 行を打つ（SSOT-6 §9 の「通常の回復を live TUI への文の送信に頼らない」と食い違い、打ち込みの安全の範囲が広がるため。arc の答えで §9 を優先）。Codex の席は、束を読んだ状態で次の入力を待つ不便を受ける。
- 採った判断: claim は 1 つの印につき 1 つで、途中で止まった結果不明の席は止める。採らなかった案: 結果不明の時に打ち直す（二重に打つおそれがあるため）。
- 採らなかった案（今は採らない。将来の選択肢として残す）: 席に何も打たず、席の起動の script でその pane の席を起動し直す形（arc-73 の提案）。打たないので、人の入力との競合と違う pane への送信の両方が無くなる利点がある。今は採らない理由: ①起動し直しは process を終わらせるので、未送信の書きかけや実行中の作業を失う別の危険に替わり、空の証明・結びの証明・人の入力の観測は同じだけ要る。②席ごとの起動の script は守る物（席の起動の設定）で、据えるのは Owner の決定であり、FR5 の形と FR6（startup の取り込み）も変わる。この版では、打つキーを command の文字と Enter だけに絞り、確かめられない時は何も足さずに止まる形で F1・F2 を満たす。この監査で収束しない場合は、この案を Owner の判断に出す。

## 12. 試験の計画（設計監査の PASS の後に書く）

試験では本物の tmux を使わない。tmux・`ps`・画面・時計・file は差し替えられる形にし、差し替えの tmux は呼び出しの列（引数の配列）を全部記録する。「送ったキー」は、その列の `send-keys` と条件つきの Enter だけを数える。

- 送るキーの型: どの試験でも、送ったキーの列は次のどれかに完全に一致する。成功 = 〔command の文字、条件つきの Enter〕、打った後に止まった = 〔command の文字〕だけ、打つ前に止まった = 〔〕（空）。BSpace・C-u・Escape・矢印・ほかの文字列が 1 度でも現れたら失敗。
- 入力欄の証明（F1）: 空の入力欄（空白だけ・host ごとの薄い案内文）は打つ。静止した書きかけ、複数行の書きかけ、薄い案内文に合わない文、入力の行を見つけられない、カーソルが入力の頭に無い（別の行・別の桁・見えない）は、〔〕で終わる。
- 人の入力の観測（F1）: client の最終操作が `now - human_quiet_seconds` より新しい、`list-clients` が失敗する、は〔〕。client が 1 つも付いていなければ打つ。
- 打った後の競合（F1）: 打った後に次のそれぞれを起こし、〔command の文字〕だけで止まり、`abandoned_after_typing` と席の HALT を残す: 書きかけが command の前に足された、command の後に足された、行が別の文に置き換わった、カーソルが動いた（桁が `x0 + 文字数` でない）、client の最終操作が新しくなった、手番が `busy` に変わった。人の書きかけの文字数が減る方向のキー（BSpace など）は 0 件。
- 条件つきの Enter（F1）: 条件が偽（桁・行・`pane_pid`・command 名・`pane_id` のどれかが違う）の時、標準出力の `ENTER_NOT_SENT` を読み、Enter は送られず、追加のキーも 0 件で、`abandoned_after_typing` と HALT になる。tmux が条件つきの形に対応しない時は〔〕。
- 結び（F2）: 打つ前に、設定の打つ先が別の pane、同じ名前の別の会話（`session_id` 違い）、`host_pid` が死んでいる・pane の子孫でない、pane を別の process が再利用、tmux のソケット違い、`pane_id` が null は、〔〕。**打った後**に、host が終了して pane の前面が shell や別の CLI になった、`ps` が読めなくなった、`capture-pane` が失敗した、tmux が応答しない、は、どれも〔command の文字〕だけで止まり、`abandoned_after_typing` と HALT を残す。確認の `started` が古い・別の起動・別の pane の物なら受けない（`unconfirmed`）。
- 一度だけ（F3）: 2 つの見張りが同時に同じ印を取りに行き、送るのは 1 つ。claim の取得が最初の `send-keys` より前。`typing`・`enter` の各段で止めた後の再起動で再送せず、追加のキーも送らない（結果不明は照会、照会できなければ HALT）。claim か帳面が書けなければ送らない（打った後に書けなくなっても追加のキーは 0 件）。同じキーで別の command は断る。
- 証拠（F4）: `intent` 行が最初の `send-keys` より前にあり、`host`・`old_session_id`・席・案件・`pane_id` を持つ。印が次の会話の物に置き換わった後でも、帳面から旧会話を一意に求められる。帳面に画面の中身・秘密の値が無い。
- F5: 見張りの module が送れる文字列が `/clear`・`/new` と `Enter` だけである（続きの文の定数も、BSpace などの定数も無い）。SSOT-6 の §9 に差分が無い。
- `probe`: 何も送らない（送るキーの列が空）。見つけられたかの真偽・桁と行の番号・`A0`・tmux の版・条件つき実行の対応の有無・SHA-256 だけを出し、画面の中身を出さない。
- 据え付けの後（Owner の決定で行う。この PR の外）: 使う host ごとに、`probe` の確かめ（入力の行・カーソルが入力の頭に出る・薄い案内文）と、帳面の `old_session_id` から前の会話へ戻す確かめを 1 回ずつ行う。
