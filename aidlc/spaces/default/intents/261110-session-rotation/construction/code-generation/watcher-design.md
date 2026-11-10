# 見張りの設計の記録 — 会話の切り直し（261110-session-rotation、FR5）

- 位置づけ: 要件 FR5.6 により、見張りだけを守る物に触れる部品として扱う。この記録だけで単位の PR を先に出し、独立の設計監査（devauditor）を 1 回受ける。見張りの code は、その PASS の後に書く。
- 要件: `aidlc/spaces/default/intents/261110-session-rotation/inception/requirements-analysis/requirements.md` の FR4・FR5・FR6・NFR1・NFR3・NFR7。Owner の決定 OD-KUSABI-ROTATION-WATCHER-AND-CLAUDE-AUTOCOMPACT-300K-20261110-001（iyasaka-arc#49 6762423093）: 見張り（LLM を使わない script）もこの取り組みで作る。席に据える前に、arc-sec の確かめと Owner の決定を受ける。
- 据え付け（見張りを起こすこと、席の Stop・SessionStart・UserPromptSubmit の hook を新しい版に替えること）は、この PR に入れない。

## 1. 何をするか（一言で）

席の会話が一定量を超え、Kusabi が引き継ぎを DB に保存して「切ってよい」の印を出した後で、席が手すきの時にだけ、その席の画面に決まった command を 1 回打って会話を切る。新しい会話の頭には、Kusabi の SessionStart の hook が残した続きを入れる（FR6。見張りの役ではない）。

## 2. 見張りが見る物

見張りは DB を読まない（DB の資格情報を持たない）。席の hook が書く、手元の小さな状態の file 2 つだけを読む。どちらにも会話の中身・秘密の値は書かない。

### 2.1 印の file（FR4 が書く）

- 置き場: `$AGENT_MEMORY_HOME/rotation/<agent_id>/<project>/marker.json`（`AGENT_MEMORY_HOME` が無い時は `$HOME/.agent-memory`）。folder は 0700、file は 0600。一時の file に書いてから rename で置き換える。
- 中身（`kusabi-rotation-marker/v1`）: `agent_id`・`project`・`host`（`claude_code` か `codex`）・`session_id`（切る会話）・`pack_ref`（DB に置いた回復の束）・`pack_content_sha256`・`measured_tokens`・`threshold_tokens`・`saved_at`（Stop の hook が受け取った時刻を呼び手が渡す）・`handoff_source`（`seat_text` か `existing_records`）・`marker_id`（上の値を正規の JSON にした SHA-256）。
- Stop の hook は、Store への保存が終わった後にだけ印を書く（FR4.1）。保存に失敗したら印を書かない。

### 2.2 手番の file（席の hook が書く）

- 置き場: 同じ folder の `turn.json`（`kusabi-rotation-turn/v1`）。
- UserPromptSubmit の hook が `{session_id, state: "busy", at}` を、Stop の hook（block を返さなかった時）が `{session_id, state: "idle", at}` を、SessionStart の hook が `{session_id: <新しい会話>, state: "started", source, at}` を書く。
- 時刻は hook が受け取った時に adapter が読み、核の判定には引数で渡す（標準 S4）。

### 2.3 画面の確かめ（tmux）

- 打つ先は、見張りの設定の file に明示した `tmux_target`（`session:window.pane`）だけ。
- 打つ前に、tmux の `display-message -p -t <target> '#{pane_id} #{pane_current_command}'` で、pane があることと、動いている command が席の種類に合うこと（Claude Code は `claude`、Codex は `codex`。設定で名前を明示する）を確かめる。
- 静けさの確かめ: `capture-pane -p -t <target>` の出力を読み、その SHA-256 だけを残す（中身は残さない）。間をおいた 2 回の値が同じ時を「画面が動いていない」とする。

## 3. いつ・何を打つか

### 3.1 打つ条件（全部そろった時だけ）

1. 印の file があり、形が正しく、`marker_id` を数え直して合う。
2. 印が新しい: `saved_at` から `marker_ttl_seconds`（既定 1,800 秒）以内。
3. 手番の file の `session_id` が印の `session_id` と同じで、`state` が `idle`、かつ `at` が印の `saved_at` 以後。
4. 手番が `idle` になってから `quiet_seconds`（既定 20 秒）以上たち、その間の画面の SHA-256 が 2 回とも同じ。
5. 設定の file にその席があり、pane があり、動いている command が合う。
6. 同じ `marker_id` で、まだ打っていない（打った記録の帳面で確かめる）。
7. 1 時間あたりに切る回数の上限（既定 席ごとに 4 回）を超えていない。
8. HALT の file が無い。
9. AUN が持つ席として設定された席では、設定に Owner の決定の参照（`owner_decision_ref`）がある（下の 6）。

### 3.2 打つ物（決まった文字列だけ）

- Claude Code: `tmux send-keys -t <target> -l /clear`、続けて `tmux send-keys -t <target> Enter`。続きは、SessionStart（source = `clear`）の hook が additionalContext と initialUserMessage で入れる（FR6.1）。見張りは続きの文を打たない。
- Codex: `tmux send-keys -t <target> -l /new`、続けて `Enter`。その後、手番の file が新しい `session_id` の `started` になるのを `start_wait_seconds`（既定 60 秒）まで待ち、なったら決まった続きの 1 行を `-l` で打って `Enter`。続きの 1 行は code の定数 1 か所に置く（標準 S3）。中身: 「Kusabi の記録から続きを始めてください。曖昧な点は推測で埋めず、Kusabi の DB を当たってください。」
- tmux は引数の配列で起こし、shell を通さない。打つ文字列に、印や設定の値を混ぜない。

## 4. 止める条件（打たない）

- 上の 3.1 のどれかが欠ける。
- 印や手番の file を読めない・形が違う・`marker_id` が合わない。「観測できず」として打たず、理由を残す（標準 S5。観測できないことを手すきと読み替えない）。
- tmux が無い・pane が無い・command が合わない・画面を読めない。
- Codex で、`/new` の後に `started` が待ち時間の中に来ない: 続きの 1 行は打たず、理由を残す（席は新しい会話のまま止まる。Owner が続きを打てる）。
- 設定の file の持ち主が見張りを動かす利用者でない、または他人が書ける（0600 でない）: 見張りは起動しない。

## 5. 失敗した時

- どの失敗も「打たない」に倒す。打ちかけた途中（`/clear` を打った後の `Enter` が失敗など）は、その印を「打った」として帳面に残し、2 回目は打たない。理由を証拠に残す。
- 証拠（`kusabi-rotation-watcher-evidence/v1`、1 行 1 件の JSON）を `$AGENT_MEMORY_HOME/rotation/watcher-ledger.jsonl` に足す: 時刻・席・`marker_id`・判定（`typed` か `skipped`）・理由の型・打った command の名前（`clear`・`new`・`continue_line`）・画面の SHA-256。画面の中身・会話の中身・秘密の値・環境変数は書かない。
- 見張りの loop は、HALT の file（`$AGENT_MEMORY_HOME/rotation/HALT`）があれば何もせずに待つ。連続して読めない・tmux が無いなどの非進捗が `no_progress_halt_limit`（既定 30 回）続いたら、HALT の file を書いて止まる（権限と待機の決まり R2）。解くのは HALT の file を消すことだけ。

## 6. AUN が持つ席

- 設計の正本 SSOT-6 §5 は「Wasurezu は AUN が監督する runtime を独自に作り直さない」と定める。見張りは Kusabi 本体ではなく、Owner の決定で据える別の script とし、§5・§6 をそれに合わせて直す（FR5.5。下の 8）。
- 設定で `aun_supervised: true` とした席は、`owner_decision_ref`（control_source の URL と本文の SHA-256）が無ければ打たない。あっても、AUN の待ち行列には触れない（見張りは画面に打つだけで、AUN の queue の claim・requeue・finalize をしない）。
- 最初に据えるのは Kusabi 自身の席（要件 FR9.2）。

## 7. 戻し方

- 見張りを止める: 見張りの process を止めるか、HALT の file を置く。席の設定・hook・DB には何も残さないので、止めれば元の動き（切らない）に戻る。
- 1 つの席から外す: 設定の file からその席を消す。
- 切った会話に戻る: 証拠に、切る前の `session_id` が残る。Claude Code は `claude --resume <session_id>`、Codex は `codex resume <session_id>` で前の会話を開ける（会話の file は host が残す）。
- 切り直しそのものを止める: Stop の hook の切り直しは、hook の command の引数で席ごとに切れる（`--rotation-threshold-tokens` を外すと既定、`--rotation off` で止める。FR2.2 で決める形）。これは席の hook の据え付けなので、Owner の決定で行う。

## 8. SSOT-6 の直し（FR5.5）

- §5（AUN Suite Boundary）に足す: Kusabi の会話の切り直しの見張りは、Kusabi 本体とは別の、LLM を使わない script で、Owner の決定で据えた席だけで動く。AUN が監督する席では、席ごとの Owner の決定の参照が無ければ動かず、あっても AUN の待ち行列には触れない。
- §6（Standalone Boundary）の 3 条件との対応を足す: 「AUN の不在の確認」= 設定の `aun_supervised` と Owner の決定の参照、「対応する supervisor か hook」= この見張りと Kusabi の hook、「事前の許可」= 据え付けの時の Owner の決定（arc-sec の確かめの後）。
- 「Kusabi 本体（MCP の server・hook）は会話を切らない・画面に打たない」は変えない。hook がするのは、測る・保存する・印を出す・次の会話の頭に入れる、まで。

## 9. 設計の判断（標準と採らなかった案）

- S4: 打つかどうかの判定は純粋な関数 `decideRotationCut({marker, turn, paneProbe, ledger, config, now})` にし、file・tmux・時計は adapter が読んで渡す。
- S5: 読めない・合わない・待ち切れないは、どれも「打たない」と理由で返す。
- S3: 既定の値（TTL・静けさの秒数・回数の上限・続きの 1 行）は code の定数 1 か所に置く。
- S8: 打たなかった理由を必ず証拠に残し、黙って飛ばさない。
- 採った判断: 見張りは DB を読まず、手元の印の file を読む。採らなかった案: 見張りが DB を読んで束の有無を確かめる（見張りに DB の資格情報を渡すことになり、標準 S9 の「資格情報は用途ごとに最小」に反するため）。束が無くても、次の会話は今までどおり DB から回復の束を作るので、切っても続きは失われない（FR6.3）。
- 採った判断: 手すきは hook の手番と画面の静けさの両方で決める。採らなかった案: 画面の文字列（入力の欄の形）を読んで判定する（host の版で形が変わり壊れやすく、画面の中身を扱うことになるため）。
- 採った判断: 入力の欄に人が書きかけている時は、画面が動くので静けさの条件で打たない。採らなかった案: 打つ前に入力の欄を消す（人の書きかけを消すので採らない）。
