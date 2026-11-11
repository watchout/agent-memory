# 見張りの設計の記録 — 会話の切り直し（261110-session-rotation、FR5）

- 版: 4（設計監査 3 回目の BLOCK F1・F2 を受けた、向きの変更。版 3 は head `adf22e5`、版 2 は `0aa667a`、版 1 は `f8a2930`）。
- 向きの変更: 版 1〜3 は「席の画面に `/clear`・`/new` の文字を打って Enter を送る」形だった。3 回の監査で、人の入力と tmux の pane の間に排他の手段が無い限り、打つ形では「人の未送信の文が送られる」「入れ替わった別の CLI に送られる」が閉じられないと分かった。版 4 は**席の画面にキーを一切送らない**。席が手すきで入力欄が空と観測できた時に、その席の起動の script で pane の席を起動し直す（`tmux respawn-pane -k`）。新しい会話は、SessionStart の hook が Kusabi の束を入れて続きから始める。この向きは arc の答え（Owner の委任 #49 6762288830）で、Owner の決定 Q1 = B（#49 6762423093「席が手すきの時に会話を切り、続きから新しい会話で始めさせる」）の範囲。席ごとの起動の script を据えることは、今までどおり守る物（Owner の決定）で、この PR には入れない。
- 位置づけ: 要件 FR5.6 により、見張りを守る物に触れる部品として扱う。この記録だけで単位の PR を先に出し、独立の設計監査（devauditor）を受ける。この単位の code と試験の code は、全部、その PASS と作者の受領の後に書く。
- 要件: `aidlc/spaces/default/intents/261110-session-rotation/inception/requirements-analysis/requirements.md` の FR4・FR5・FR6・NFR1・NFR3・NFR7。Owner の決定 OD-KUSABI-ROTATION-WATCHER-AND-CLAUDE-AUTOCOMPACT-300K-20261110-001（iyasaka-arc#49 6762423093）: 見張り（LLM を使わない script）もこの取り組みで作る。席に据える前に、arc-sec の確かめと Owner の決定を受ける。
- 据え付け（見張りを起こすこと、席の起動の script を登録すること、席の Stop・SessionStart・UserPromptSubmit の hook を新しい版に替えること）は、この PR に入れない。
- この記録の中の `claim`・`HALT`・`probe` は、見張りの script の内部の状態・command の名前で、権限や工程を表す語ではない。

## 0. 直した所

| 指摘 | 直し方 | 節 |
|---|---|---|
| 3 回目 F1 条件つきの Enter でも、V の後に入力が置き換わると人の未送信の文を送る | **送るキーを無くした。** 見張りは `send-keys` を呼ばない（呼ぶ経路も定数も持たない）。送られる文が存在しないので、「人の文が席に送られる」「置き換えた行が送られる」は起きない。残るのは、観測の後に人が書き始めた未送信の文が起動し直しで消えること。これを消えない形にはできない（排他の手段が無い）ので、残る危険として正直に書く。 | 3.4 |
| 3 回目 F2 結びが `pane_pid` と command 名だけで、同じ pane の同名 CLI への入れ替わりを拒めない | 結びを、host の process の番号と**起動した時刻**（`ps` の lstart）・pane の起動の command（tmux が報告する値と一致）・起動の script の SHA-256・会話の id の全部にした。起動し直す直前に `ps` で読み直す。tmux の中の条件は、tmux に見える物（`pane_id`・`pane_pid`・起動の command・カーソル・client の数・モード）だけを評価し、host の process までは見えないことを書いた。直前の確かめと tmux の評価の間の窓は残る危険 R-C として書く。 | 2.4・2.6・3.4 |
| 1〜2 回目 F1（入力欄が空と確かめられない） | 版 3 の入力欄の証明・人の観測を引き継ぐ（空の入力の行、カーソルが入力の頭、tmux の client の最終操作）。キーを送らないので、この観測は「送る安全」ではなく「未送信の文を消す頻度を下げる」ための条件になる。 | 2.5 |
| F3〜F5（解消と確認済み） | 排他の claim・送る前の帳面・Codex の続きの文を打たない、を引き継ぐ。打つ段（`typing`・`enter`）は無くなり、`respawning` の 1 段になった。tmux 自身も、同じ観測での 2 回目の起動し直しを拒む（`pane_pid` の条件）。 | 5・6 |

## 1. 何をするか（一言で）

席の会話が一定量を超え、Kusabi が引き継ぎを DB に保存して「切ってよい」の印を出した後で、席が手すきで、入力欄が空と観測でき、人が触っていないと観測でき、起動し直す先が印の会話と合うと確かめられた時にだけ、その席の pane を、その pane を作った時の起動の command（Owner の決定で登録した席の起動の script）で 1 回だけ起動し直す。キーは 1 つも送らない。新しい会話の頭には、Kusabi の SessionStart の hook が残した束を入れる（FR6。見張りの役ではない）。Claude Code は initialUserMessage で続きから動く。Codex は束を読んだ状態で、次の入力（中継の行か Owner）を待つ。確かめられない時は、何もせずに止まる。

SSOT-6 §9（live TUI への文の送信を通常の回復の道にしない）とは、キーを送らないので一貫する（§9 は変えない）。回復の中身は構造化した hook の道で入る。起動し直しができなかった時は、会話が切れないだけで、記録は何も失われない。

## 2. 見張りが見る物

見張りは DB を読まない（DB の資格情報を持たない）。席の hook が書く、手元の小さな状態の file 2 つと、設定の file、tmux・process の状態だけを読む。file には会話の中身・秘密の値は書かない。

### 2.1 印の file（FR4 が書く）

- 置き場: `$AGENT_MEMORY_HOME/rotation/<agent_id>/<project>/marker.json`（`AGENT_MEMORY_HOME` が無い時は `$HOME/.agent-memory`）。folder は 0700、file は 0600。一時の file に書いてから rename で置き換える。
- 中身（`kusabi-rotation-marker/v1`）: `agent_id`・`project`・`host`（`claude_code` か `codex`）・`session_id`（切る会話）・`pane_id`・`tmux_socket`・`host_pid`・`host_started_at`（その process の起動した時刻。`ps -o lstart= -p <host_pid>` の値の前後の空白を除き、続く空白を 1 つにした文字列）・`pack_ref`（DB に置いた回復の束）・`pack_content_sha256`・`measured_tokens`・`threshold_tokens`・`saved_at`（Stop の hook が受け取った時刻を呼び手が渡す）・`handoff_source`（`seat_text` か `existing_records`）・`marker_id`（上の値を正規の JSON にした SHA-256）。
- Stop の hook は、Store への保存が終わった後にだけ印を書く（FR4.1）。保存に失敗したら印を書かない。

### 2.2 手番の file（席の hook が書く）

- 置き場: 同じ folder の `turn.json`（`kusabi-rotation-turn/v1`）。
- 中身: `agent_id`・`project`・`host`・`session_id`・`state`（`busy`・`idle`・`started`）・`source`（`started` の時。`startup`・`clear`・`compact`・`resume`）・`rotation_marker_id`（`started` で、SessionStart の hook が起動し直しの注文を使った時の `marker_id`。そうでなければ null）・`at`・`pane_id`・`tmux_socket`・`host_pid`・`host_started_at`。
- UserPromptSubmit の hook が `busy` を、Stop の hook（block を返さなかった時）が `idle` を、SessionStart の hook が新しい会話の `started` を書く。
- `pane_id` は hook の環境変数 `TMUX_PANE`、`tmux_socket` は `TMUX` の最初の項、`host_pid` は hook の親 process の番号（host の CLI 本体）。`host_started_at` は hook が `host_pid` について読む（上の 2.1 と同じ取り方）。tmux の外で動く席は、どれも null にして書く。null の席は見張りが動かさない。
- 時刻は hook が受け取った時に adapter が読み、核の判定には引数で渡す（標準 S4）。

### 2.3 設定の file（据え付けの時に Owner の決定で書く）

- 置き場: `$AGENT_MEMORY_HOME/rotation/watcher-config.json`。folder 0700、file 0600、持ち主は見張りを動かす利用者。他人が書ける時は、見張りは起動しない。
- 席ごとの項目: `agent_id`・`project`・`host`・`tmux_target`（`session:window.pane`）・`expected_command`（`claude` か `codex`）・`launch_command`・`launch_script`（`path` と `sha256`）・`owner_decision_ref`（`url` と本文の `sha256`。この席に見張りと起動の script を据える Owner の決定。**全部の席で必須**）・`aun_supervised`・`prompt_markers`・`placeholder_patterns`・`drain_commands`・`human_quiet_seconds` ほか。
- `launch_command` は、tmux が `#{pane_start_command}` として報告する値**そのまま**（tmux 3.6a は二重引用符で囲んだ形で返す）を登録する。`probe` がその値を出す。使える文字は英数字・空白・`" _ . / : = ; @ + ~ -` に限り、それ以外を含む設定は無効として、その席には何もしない（tmux の条件に埋め込むため。標準 S5 の fail-closed）。
- `launch_script.sha256` は、`launch_command` が起こす script の file の SHA-256。script が読み込む別の file は対象外（据え付けの時の arc-sec の確かめで見る）。script を編集したら SHA-256 が合わなくなり、見張りは動かさない。登録し直すのは Owner の決定。

### 2.4 席と画面の結び

見張りは、設定の `tmux_target` を `display-message -p -t <tmux_target> '#{pane_id}'` で `pane_id` に引き、以後の tmux の呼び出しは `-t <pane_id>` だけで行う（番号の入れ替わりに引きずられない）。次が**全部**そろった時だけ「結びが合う」とする。

1. pane: 印の `pane_id` = 手番の `pane_id` = 引いた `pane_id`。印の `tmux_socket` = 手番の `tmux_socket` = tmux の `#{socket_path}`。
2. 起動の仕方: tmux の `#{pane_start_command}` が設定の `launch_command` と完全に同じ。`launch_script.path` の file の SHA-256 が `launch_script.sha256` と同じ。
3. host の process: 印の `host_pid` = 手番の `host_pid`。その process が生きている。`ps -o lstart=` の値が、印の `host_started_at` と手番の `host_started_at` の両方と同じ（印を書いた時と**同じ process**であり、番号の再利用や、同じ shell の下の別の CLI ではない）。`#{pane_pid}` がその process と同じか、その祖先（`ps` を引数の配列で呼び、親をたどる。深さの上限 8）。command の名前が `expected_command` に合う。
4. 会話: 手番の `session_id` = 印の `session_id`、手番が今も `idle` で `at` が印の `saved_at` 以後。手番・印の `agent_id`・`project`・`host` が互いに同じで、設定のその席の値とも同じ。
5. 取り込みの途中でない: host の子孫に、設定の `drain_commands`（席の Stop・SessionStart の hook の command 名。transcript の取り込みなど）に当たる process が居ない。`ps` を読めない時は、居ないと読み替えない。

どれかを読めない・合わない時は「観測できず」か「不一致」とする（標準 S5）。結びは、①起動し直す条件の判定、②claim を取った後、③起動し直しを起こす直前（`ps`・tmux・画面を読み直す）、④tmux の中の条件（tmux に見える項目だけ。2.6）の 4 か所で確かめる。①〜③で合わなければ起動し直しを起こさない。④で合わなければ起動し直しは実行されない。

別の会話に置き換わった pane、同じ名前の別の会話、pane の再利用、同じ shell の下で別の CLI に替わった pane、別の起動の古い file は、1〜5 のどれかで落ちる。ただし 3 の確かめと tmux が起動し直しを実行する間の窓は、見張りからは無くせない（残る危険 R-C、3.4）。

### 2.5 入力欄の証明と、人の入力の観測

画面が静かなことは、入力欄が空であることを意味しない。次の 3 つを**全部**観測できた時だけ「入力欄は空で、人は触っていない」とする。1 つでも観測できない・合わない時は、空と証明できないので動かさない。キーを送らない版 4 では、これは「未送信の文を消す頻度を下げる」ための条件であり、排他ではない（3.4）。

1. 入力欄の文が空: 画面は `capture-pane -p -t <pane_id>`（見えている範囲だけ）で読み、メモリの中だけで比べる。中身は帳面にも log にも残さない（残すのは SHA-256 と真偽だけ）。設定の host ごとの `prompt_markers`（入力の行の先頭の印。枠線の文字と空白は読み飛ばす）で始まる、画面の下側の最後の行を入力の行とする。その行の印より後ろの文が、空白だけ、または設定の `placeholder_patterns`（host の版が空の入力欄に出す薄い案内文。完全一致）に当たる時だけ「空」とする。入力の行から下の枠線までの間にほかの文の行があれば空と見なさない。許可・問いの画面など、入力の行が無い画面は、見つけられないので動かさない。
2. カーソルが入力の頭にある: tmux の `#{cursor_y}` が入力の行の番号（見えている範囲の上から数えた番号）と同じで、`#{cursor_x}` が印と空白の直後の桁と同じ。カーソルが見えない・別の行にある・桁が違う時は動かさない。
3. 人が触っていない: その席の tmux の session に付いている client を `list-clients -t <session> -F '#{client_activity}'` で全部読み、最後の操作の時刻（秒）の最大値 `A0` が、`now - human_quiet_seconds`（既定 30 秒）以前である（client が 1 つも付いていなければ `A0` は無しとし、条件は満たす）。`list-clients` が読めない時は動かさない。

据え付ける前の確かめとして、見張りに読むだけの `probe` command を持たせる（上の 3 つを画面から求め、見つけられたかの真偽・桁と行の番号・`A0`・tmux の版・`pane_start_command` の値・条件つきの起動し直しの形に対応しているかを出す。何も実行しない）。host の版の違いで入力の行・カーソル・薄い案内文が合わなくなれば、見張りは動かさない側に倒れる。判定の核は純粋な関数にし、画面の文・tmux の値・`ps` の値・時刻は引数で受ける（標準 S4）。

### 2.6 条件つきの起動し直し

起動し直しは、見張りが確かめた後に別の呼び出しで行うのではなく、tmux の中で条件を評価して実行する 1 つの命令にする。

`tmux if-shell -F -t <pane_id> '<条件>' 'respawn-pane -k -t <pane_id>' 'display-message -p NOT_RESPAWNED'`

- 条件 = `#{pane_id}` が引いた値、`#{pane_pid}` が 3.2 の手順 4 で見た値 `pane_pid0`、`#{pane_dead}` が 0、`#{pane_in_mode}` が 0（コピー・モードなど、人が pane を操作していない）、`#{pane_start_command}` が設定の `launch_command`、`#{cursor_y}` が `y0`、`#{cursor_x}` が `x0`、`#{session_attached}`（付いている client の数）が手順 4 で見た値、の全部が真。tmux はこの評価と実行を続けて行う。
- `respawn-pane` に起動する command を渡さない。tmux は、その pane を作った時の起動の command をそのまま再実行する。見張りは command の文字列を一切渡さないので、起動できるのは、2.4 の 2 で設定の `launch_command` と起動の script の SHA-256 に結んだ物だけである（任意の command を起こす経路が無い）。
- 条件が偽なら何も実行されず、標準出力に `NOT_RESPAWNED` が返る。真で実行された時は、標準出力は空で終了コード 0。それ以外（tmux が失敗した・応答しない）は、結果不明として扱う（3.2 の 8）。
- 使い捨ての tmux（3.6a）で確かめた事実: 条件が偽で `NOT_RESPAWNED` が返り何も起きない。真で `pane_pid` が変わり、`pane_id`・起動の command は同じで、新しい process の `TMUX_PANE` も同じ。変わる前の `pane_pid` の条件でもう一度流すと `NOT_RESPAWNED` で拒まれる（同じ観測での 2 回目は tmux 自身が拒む）。`pane_start_command` は二重引用符つきで返る。`pane_last_activity` は 3.6a では空なので使わない。host の画面での確かめと、実際の席の起動の script での起動し直しは、`probe` と据え付けの後の確かめで行う（FR9.2）。
- tmux が見えるのは pane の最初の process（`pane_pid`）までで、host の process（その子孫）は見えない。host の process の確かめ（2.4 の 3・5）は、見張りが起動し直しを起こす直前に `ps` で行う。その直前の確かめと tmux の評価の間の窓は、残る危険 R-C に書く。

## 3. いつ・何をするか

### 3.1 起動し直す条件（全部そろった時だけ）

1. 印の file があり、形が正しく、`marker_id` を数え直して合う。
2. 印が新しい: `saved_at` から `marker_ttl_seconds`（既定 1,800 秒）以内。
3. 席と画面の結びが合う（2.4 の 1〜5）。
4. 手番が `idle` になってから `quiet_seconds`（既定 20 秒）以上たち、その間の画面の SHA-256 が 2 回とも同じ（足切り。これは入力欄が空である証明ではない）。
5. 入力欄が空と観測でき、人が触っていない（2.5 の 3 つ）。tmux が条件つきの起動し直しに対応している（`probe`）。
6. 設定にその席があり、設定が有効（`launch_command` の文字・持ち主と権限・`owner_decision_ref` あり）。
7. 同じ `marker_id` の claim が無い（5）。
8. その席の直近の起動し直しから `min_interval_seconds`（既定 900 秒）以上たち、1 時間あたりの回数の上限（既定 席ごとに 4 回）を超えていない。
9. HALT の file（全体、席ごと）が無い。
10. AUN が持つ席として設定された席では、`owner_decision_ref` が AUN が監督する席の起動し直しを名指している（8）。

### 3.2 手順（1 つの印につき 1 回だけ）

見張りが tmux に実行させるのは、2.6 の条件つきの起動し直し 1 回だけ。キーは送らない。

1. 条件 3.1 を確かめる（核 `decideRotationRelaunch` が `proceed` を返す）。
2. 排他の claim を取る（5）。取れなければ何もしない。
3. 意図の証拠（6 の `intent` 行）を帳面に足して fsync する。足せなければ何もしない（claim を `aborted_before_respawn` にして終える）。
4. 直前の確かめ: 結び（2.4 の 1〜5）、入力欄の証明と人の観測（2.5）、手番がまだ `idle` で `at` が同じ、を全部もう一度、新しく読んで行い、値（`pane_pid0`・カーソルの桁 `x0` と行 `y0`・付いている client の数・client の最終操作の最大値 `A0`・`host_pid0`）をメモリに持つ。1 つでも合わない・読めなければ、何も実行せず claim を `aborted_before_respawn` にして終える。
5. claim を `respawning` に更新する（実行の前に先に記録する。`respawn_started_at` と `pane_pid0` を入れる）。
6. 2.6 の条件つきの起動し直しを、1 回だけ実行する。結果:
   - 標準出力が `NOT_RESPAWNED`: 何も起きていない。claim を `aborted_before_respawn` にし、帳面に `skipped`（理由の型 `tmux_condition_false`）を足して終える。
   - 標準出力が空で終了コード 0: 実行された。手順 7 へ。
   - それ以外（tmux の失敗・応答なし・読めない出力）: 結果不明。手順 8 へ。**起動し直しをもう一度起こさない。**
7. 確認: `confirm_wait_seconds`（既定 60 秒）まで、読むだけで見る。(a) `#{pane_pid}` が `pane_pid0` と違い、`pane_id` は同じ。(b) 手番の file に新しい会話の `started` が来て、`pane_id`・`tmux_socket`・`agent_id`・`project`・`host` が旧会話と同じ、`source` が `startup`、`rotation_marker_id` が `marker_id` と同じ、`session_id` が旧会話と違う、`host_pid` が旧と違い新しい `pane_pid` の子孫、`at` が `respawn_started_at` 以後。(a)(b) が両方合えば claim を `done`、帳面に `confirmed` を足す。時間内に合わなければ claim を `unconfirmed`、帳面に `unconfirmed` を足し、その席の HALT の file を置く。再実行しない。
8. 結果不明の時: 手順 7 と同じ条件を、読むだけで 1 回確かめる。合えば claim を `done`（照会で確かめた）にする。合わなければ claim を `unknown_quarantined` にし、帳面に `outcome_unknown` を足し、その席の HALT の file を置く。再実行しない。

### 3.3 見張りが実行する tmux の命令（閉じた集合）

- 実行する命令は次だけ: `display-message -p`、`list-clients -F`、`capture-pane -p`、`if-shell -F`（then の枝は `respawn-pane -k -t <pane_id>` だけ、else の枝は `display-message -p NOT_RESPAWNED` だけ）。
- `send-keys`・`send-prefix`・`paste-buffer`・`load-buffer`・`pipe-pane`・`run-shell` など、席の入力に届く命令を呼ぶ経路は、code に持たない（定数も無い）。`respawn-pane` に command の文字列を渡す経路も持たない。
- tmux と `ps` は引数の配列で起こし、shell を通さない。`<pane_id>` は `^%[0-9]+$` に合う値だけ。条件に埋め込む値は、設定の検証（2.3）と tmux の値の検証を通った物だけ。

### 3.4 残る危険（無くせないので正直に書く。deviation_ledger にも載せる）

人の入力・別の送り元と、tmux の pane の間には、排他の手段が無い。起動し直しは「観測した後に起きたこと」を見ずに、process を終わらせる。この版は、**勝手に送られる文が存在しない**ことで版 1〜3 の F1 を解くが、次の損失は残る。どれも「安全な側の失敗」（席に誤った文が届かない）だが、損失ゼロではない。観測の条件（2.4・2.5）と tmux の中の条件は、これらが起きる頻度を下げるだけで、起きないことの証明ではない。

- **R-A 未送信の書きかけが消える。** 最後の観測（client の最終操作・カーソル・画面）から tmux が起動し直しを実行するまでの間に、人が書き始めた未送信の文は、新しい会話に引き継がれず消える。窓の中身: 見張りが読んでから tmux に命令を渡すまでの間、host が入力を画面に出すまでの遅れ、tmux の client を通らない別の送り元。画面に出た後の書きかけは、tmux の中の条件（カーソルの桁・行、client の数）で拒む。拒めなかった場合の結果: 書きかけの文が消える（送られはしない）。人が書き直す。
- **R-B 観測の後に始まった作業が切れる。** 観測の後に届いた入力（中継の行など）で host が応答を始めていると、その応答の途中で process が終わる。部分的な作業の結果が残る、中継の配達の記録が「届いた」になっているのに新しい会話では処理されない、がありうる。中継 script の配達の扱いは、据え付けの前の arc-sec の確かめの項目にする。
- **R-C 確かめと実行の間に pane の前面の process が替わる。** 3 の確かめ（`ps`）と tmux の評価の間に、host が終了して別の process が pane を使い、カーソルの位置と client の数が同じままだと、その process が終わる。終わるのは設定の席の pane の process で、そのあとに起きるのは、登録した起動の script による起動である。
- **R-D 取り込みの途中で切れる。** `drain_commands` の確かめで居ないと見た後に始まった hook の process があれば、それも終わる。席の Stop は手すきの後なので始まりにくい。結果: 最後の応答の取り込みが欠けうる。引き継ぎの保存は印より前に DB に入っている（FR4.1）。transcript の file は host が残し、取り込みの常駐（FR8 で直す）が別に取り込める。
- **R-E 新しい会話が起きない。** 起動の script の失敗などで、新しい会話が始まらない。確認が時間内に合わず、`unconfirmed` と席の HALT になる。pane の起動の command の末尾（例: shell）が残るか、pane が終わる。人が席を起こす（9）。

据え付けの時の Owner の決定には、R-A〜R-E を示して受けてもらう。この PR の deviation_ledger にも R-A〜R-E を 1 行ずつ載せる。ただし、安全の条件は 2.4〜2.6 の観測と確かめで満たし、deviation_ledger の記載で代えない。

## 4. 止める条件（何もしない）

- 3.1 のどれかが欠ける。
- 印や手番の file を読めない・形が違う・`marker_id` が合わない。tmux・`ps` が無い、結びが合わない、画面・カーソル・client の一覧を読めない、入力の行を見つけられない（許可・問いの画面を含む）、入力欄が空と証明できない、人の入力が観測された、`drain_commands` に当たる process がある。どれも「観測できず」か「不一致」として何もせず、理由を残す（標準 S5。観測できないことを手すきや空と読み替えない）。
- 設定が無効（`launch_command` に使えない文字、`owner_decision_ref` 無し、持ち主・権限が違う）、`launch_script` の SHA-256 が合わない。
- 起動し直しの命令の結果が `NOT_RESPAWNED`: 何も起きていない（claim は `aborted_before_respawn`）。
- 確認が合わない・結果不明: 再実行せず、止まる（3.2 の 7・8）。

## 5. 同じ印で 1 回だけ（排他の永続取得）

- claim: `$AGENT_MEMORY_HOME/rotation/<agent_id>/<project>/claims/<marker_id>.json`（folder 0700、file 0600）。起動し直しの命令より前に、`open(path, 'wx')`（O_EXCL）で作り、中身（`kusabi-rotation-claim/v1`: `marker_id`・`launch_command_sha256`・`attempt_id`・`watcher_pid`・`claimed_at`・`state: "claimed"`）を書いて、file と folder を fsync する。作れない・書けない・fsync できない時は、何もしない。
- 状態は進む向きだけ: `claimed` → `respawning` → `done` か `unconfirmed`。分かれ道は `aborted_before_respawn`（何も実行する前に止まった、または tmux の条件が偽だった）と `unknown_quarantined`（結果不明で、照会でも確かめられなかった）。状態の更新は、一時の file に書いて rename で置き換え、fsync する。実行の前に、次の状態を先に記録する（write-ahead）。
- 取れなかった時（claim が既にある）:
  - 終わりの状態（`done`・`unconfirmed`・`aborted_before_respawn`・`unknown_quarantined`）: 何もしない（`already_attempted`）。次の Stop が新しい印を作れば、その印は別の `marker_id` で別に扱われる。
  - 途中の状態（`claimed`・`respawning`）で `watcher_pid` が生きている: 別の見張りが動いている。何もしない（`in_progress_elsewhere`）。
  - 途中の状態で `watcher_pid` が死んでいる: 結果不明。照会する（読むだけ）: 3.2 の 7 と同じ条件が合えば claim を `done`（照会で確かめた）にする。合わなければ claim を `unknown_quarantined` にし、帳面に `outcome_unknown` を足し、その席の HALT の file を置く。**起動し直しをもう一度起こさない**（二度目は、新しい会話を終わらせる）。
- 二重の防ぎ: claim に加えて、tmux の条件の `pane_pid` が `pane_pid0` と同じであることが、同じ観測での 2 回目の起動し直しを tmux 自身に拒ませる（2.6）。これは claim の代わりではない。
- 起動し直しは 1 つの印につき 1 回だけ。

## 6. 証拠

- 帳面: `$AGENT_MEMORY_HOME/rotation/watcher-ledger.jsonl`。追記だけ、1 行 1 件の JSON（`kusabi-rotation-watcher-evidence/v1`）、1 行ごとに fsync する。印のように置き換えない。
- `intent` 行（起動し直しの前に必ず足す。足せなければ起動し直さない）: `at`・`attempt_id`・`marker_id`・`host`・`agent_id`・`project`・`old_session_id`（切る前の会話）・`pane_id`・`pane_pid`・`host_pid`・`host_started_at`・`launch_command_sha256`・`launch_script_sha256`・`input_row_sha256`（入力の行の SHA-256。中身は書かない）・`input_empty`（真偽）・`client_activity_max`（`A0`）。
- 続く行: `respawn_issued`・`confirmed`・`unconfirmed`・`outcome_unknown` のどれか。`attempt_id` と `marker_id` を持つ。何もしなかった時は `skipped` と理由の型。画面の SHA-256 は足してよい。
- 画面の中身・会話の中身・秘密の値・環境変数は書かない。
- 印が次の会話の物に置き換わっても、帳面の `intent` 行から、`host` と `old_session_id` と席・案件を一意に求められる。

## 7. 失敗した時

- どの失敗も「何もしない」か、実行した後なら「再実行せずに止まる」に倒す。
- 帳面か claim に書けない時は、実行しない。実行した後に書けなくなった時も、再実行はせず、止まる。
- 見張りの loop は、HALT の file（全体 `$AGENT_MEMORY_HOME/rotation/HALT`、席ごと `.../<agent_id>/<project>/HALT`）があれば何もせずに待つ。連続して読めない・tmux が無い・入力の行を見つけられないなどの非進捗が `no_progress_halt_limit`（既定 30 回）続いたら、全体の HALT の file を書いて止まる（権限と待機の決まり R2）。解くのは HALT の file を消すことだけ。

## 8. AUN が持つ席

- 設計の正本 SSOT-6 §5 は「Wasurezu は AUN が監督する runtime を独自に作り直さない」と定める。見張りは Kusabi 本体ではなく、Owner の決定で据える別の script とし、§5・§6 をそれに合わせて直す（FR5.5。下の 11）。
- 設定で `aun_supervised: true` とした席は、`owner_decision_ref`（control_source の URL と本文の SHA-256）が、AUN が監督する席の起動し直しを名指していなければ動かさない。あっても、AUN の待ち行列には触れない（見張りは pane の起動し直しだけをして、AUN の queue の claim・requeue・finalize をしない）。席の process を AUN が別に起こし直す仕組みとの二重の起動は、据え付けの前の arc-sec の確かめで見る。
- 最初に据えるのは Kusabi 自身の席（要件 FR9.2）。

## 9. 戻し方

- 見張りを止める: 見張りの process を止めるか、HALT の file を置く。席の設定・hook・DB には何も残らないので、止めれば元の動き（切らない）に戻る。
- 1 つの席から外す: 設定の file からその席を消す（据え付けの変更なので Owner の決定で行う）。
- 切った会話に戻る: 帳面の `intent` 行の `host` と `old_session_id` を使う。Claude Code は `claude --resume <old_session_id>`、Codex は `codex resume <old_session_id>` で前の会話を開ける（会話の file は host が残す）。据え付けの後に、使う host ごとに 1 回、この戻しを試して確かめる（FR9.2）。
- 新しい会話が起きなかった時（`unconfirmed`・`unknown_quarantined`）: 見張りは席を止める（その席の HALT の file）。人が pane を見て、席の起動の script を手で流すか、上の「切った会話に戻る」で席を起こす。見張りは再実行しない。起こした後に、その席の HALT の file を人が消すと、次の印から再開する。
- 切り直しそのものを止める: Stop の hook の切り直しは、hook の command の引数で席ごとに切れる（`--rotation-threshold-tokens` を外すと既定、`--rotation off` で止める。FR2.2 で決める形）。これは席の hook の据え付けなので、Owner の決定で行う。

## 10. 起動の script への条件（据え付けの時の Owner の決定の材料。この PR では何も据えない）

起動し直しは、席の起動の script を再実行する。席ごとの起動の script を登録することは守る物（席の起動）で、Owner の決定で行う。登録の前に次を満たすかを、arc-sec の確かめと Owner の決定の前に見る。

- 実行のたびに新しい会話を起こす（前の会話を `--resume` で開かない。会話の id は新しい値）。
- その script だけで席が起きる。起動し直しは tmux の session の環境で動き、旧 host の process の環境変数を引き継がない。
- 最初の指示が script に固定で入っている場合（ある席の script は、1 回きりの切り替えのための固定の最初の指示を持つ）は、切り直しの続きの指示と食い違う。固定の指示を外すか、続きの指示と矛盾しない形にする（Claude Code の続きは SessionStart の initialUserMessage、Codex は additionalContext だけ）。
- `launch_command` と起動の script の SHA-256 を、設定に登録する（2.3）。編集したら登録し直す（Owner の決定）。
- 席の Stop・SessionStart・UserPromptSubmit の hook が、新しい版（印と手番に `host_started_at`・`rotation_marker_id` を書く版。FR4・FR6）に替わっている。

## 11. SSOT-6 の直し（FR5.5）

- §5（AUN Suite Boundary）に足す: Kusabi の会話の切り直しの見張りは、Kusabi 本体とは別の、LLM を使わない script で、Owner の決定で据えた席だけで動く。AUN が監督する席では、席ごとの Owner の決定の参照が無ければ動かず、あっても AUN の待ち行列には触れない。見張りは席の画面にキーを一切送らない。席が手すきで、入力欄が空と観測でき、人が触っていないと観測でき、起動し直す先（pane・起動の command・起動の script の SHA-256・host の process とその起動時刻・会話）が印と合う時にだけ、その pane を登録した起動の command で 1 回だけ起動し直す。回復の中身は SessionStart の hook が構造化して入れ、画面に打った文には依存しない（§9 を変えない）。観測の後に人が書き始めた未送信の文などが消える残る危険は、設計の記録に明記し、据え付けの時に Owner の決定で受ける。
- §6（Standalone Boundary）の 3 条件との対応を足す: 「AUN の不在の確認」= 設定の `aun_supervised` と Owner の決定の参照、「対応する supervisor か hook」= この見張りと Kusabi の hook、「事前の許可」= 据え付けの時の Owner の決定（arc-sec の確かめの後）。
- 「Kusabi 本体（MCP の server・hook）は会話を切らない・画面に打たない」は変えない。hook がするのは、測る・保存する・印を出す・次の会話の頭に入れる、まで。
- §9（Fallback Rule）は変えない。

## 12. 設計の判断（標準と採らなかった案）

- S4: 起動し直すかどうかの判定は純粋な関数 `decideRotationRelaunch({marker, turn, binding, inputProof, config, claim, ledgerSummary, now})` にし、file・tmux・`ps`・画面・時計は adapter が読んで渡す。
- S5: 読めない・合わない・待ち切れないは、どれも「何もしない」と理由で返す。入力の行やカーソルを見つけられないことを空と読み替えない。tmux が結果を返さないことを成功と読み替えない（結果不明として止まる）。
- S3: 既定の値（TTL・静けさの秒数・人の静けさの秒数・確認の待ち・最小の間隔・回数の上限）は code の定数 1 か所に置く。host ごとの `prompt_markers`・`placeholder_patterns`・`drain_commands` は設定の file に置き、据え付けの前に `probe` で確かめる。
- S7: 外に出る効果（process の終了と再起動）の前に、`marker_id` に結ぶ冪等キー（claim）を取り、同じキーの再実行は効果を重ねず、結果不明は照会してから読み、照会できなければ止まる。盲目的に再実行しない。二度目の起動し直しは新しい会話を終わらせるので、再実行の禁止は特に強い。
- S8: 何もしなかった理由・止まった理由を必ず帳面に残し、黙って飛ばさない。
- S9: 見張りは DB の資格情報を持たない。読むのは手元の file・tmux・`ps` だけ。起動する command は、Owner の決定で登録した物（pane の起動の command と起動の script の SHA-256）に限る。
- 採った判断: 席の画面にキーを送らず、pane を登録した起動の command で起動し直す。採らなかった案: `/clear`・`/new` と Enter を打つ形（版 1〜3）。理由: 人の入力と tmux の pane の間に排他の手段が無く、確かめの後の置き換え（設計監査 3 回目 F1）、同じ shell の下の同名 CLI への入れ替わり（同 F2）が、観測を足すたびに別の窓になる。打つ形では、窓の結果が「人の未送信の文が席に送られる」になる。起動し直しでは、同じ窓の結果が「未送信の文が消える」に変わる（誤った文が席に届かない側）。
- 採った判断: 残る危険 R-A〜R-E を正直に書き、「短い無害な入力」などと断定しない。採らなかった案: 窓が閉じたと書く。
- 採った判断: `respawn-pane` に command の文字列を渡さず、pane の起動の command の再実行に任せる。採らなかった案: 見張りが起動する command を渡す（任意の command を起こす経路になり、守る物の範囲が広がる）。
- 採った判断: 結びに、host の process の起動時刻（lstart）と、pane の起動の command・起動の script の SHA-256 を足す。採らなかった案: `pane_pid` と command 名だけで結ぶ（同じ shell の下の同名 CLI に替わっても真のままになる。設計監査 3 回目 F2）。
- 採った判断: tmux の中の条件は、tmux に見える項目だけに限り、host の process の確かめは直前の `ps` で行い、その間の窓を R-C に書く。採らなかった案: tmux の条件だけで結びを確かめたと書く。
- 採った判断: 人が触っていないことを、tmux の client の最終操作の時刻で観測して条件にする。採らなかった案: 画面が静かなことだけを根拠にする（静止した書きかけを拒めない）。
- 採った判断: Codex の続きの 1 行を打たない（版 2 からの arc の答え）。Codex の席は、束を読んだ状態で次の入力を待つ。
- 採った判断: claim は 1 つの印につき 1 つで、結果不明の席は止める。採らなかった案: 結果不明の時に起動し直しをやり直す（新しい会話を終わらせるおそれ）。
- 採らなかった案: host の process に直接終了の信号を送ってから pane を起動し直す。理由: 起動の command の末尾（shell など）が残って pane が生きたままになり、`respawn-pane` が使えない場合がある。信号を送る相手の同一性の確かめも、同じ窓を持つ。
- 採らなかった案: `Ctrl-D` などのキーで host を終わらせる。理由: キーを送らない前提を崩し、版 1〜3 の窓がそのまま戻る。

## 13. 試験の計画（設計監査の PASS の後に書く）

試験では本物の tmux を使わない。tmux・`ps`・画面・時計・file は差し替えられる形にし、差し替えの tmux は呼び出しの列（引数の配列）を全部記録する。

- キーが 0 件の型: どの試験でも、記録した tmux の呼び出しは 3.3 の閉じた集合だけで、`send-keys` 系が 1 件も無い。`respawn-pane` は `if-shell -F` の then の枝の中だけで、command の文字列の引数を持たず、1 つの印につき 0 回か 1 回。`probe` は何も実行しない（`respawn-pane` が 0 回）。
- 設計監査 3 回目 F1: 観測の後に（a）カーソルが動いた、（b）client が付いた・外れた、（c）client の最終操作が新しくなった、（d）pane がコピー・モードになった、（e）手番が `busy` に変わった、のそれぞれで、tmux の条件が偽（`NOT_RESPAWNED`）または直前の確かめが落ちて、`respawn-pane` が 0 回で終わり、claim は `aborted_before_respawn`。「行を別の文に置き換えてカーソルを同じ桁に戻した」場合は、キーを送る経路が無いので、席に届く文が 0 件である（記録した呼び出しに `send-keys` 系が無い）ことを確かめる。この場合に起動し直しが実行されうることは、R-A として帳面の `intent` 行（観測した値）に残り、試験は「防いだ」とは主張せず、「起こりうる窓の結果が未送信の文の消失に限られる」ことを確かめる。
- 設計監査 3 回目 F2: 印を書いた host A が終了し、同じ shell の下で別の CLI B が前面になる（`pane_pid`・コマンド名・カーソルは同じ）。直前の確かめで A の `host_pid` が死んでいる、または `ps` の起動時刻が違うので、`respawn-pane` が 0 回。pane の起動の command が設定と違う、起動の script の SHA-256 が違う、`expected_command` が違う、別の `tmux_socket`・別の `pane_id`、`session_id` 違い、`drain_commands` に当たる process がある、は全部 0 回。確かめた後に host が替わる窓（R-C）は、その窓で `respawn-pane` が 1 回起きること、claim・帳面にその時点の観測が残ることを確かめる。
- 入力欄の証明（版 3 から引き継ぐ）: 空の入力欄（空白だけ・host ごとの薄い案内文）は進む。静止した書きかけ、複数行の書きかけ、薄い案内文に合わない文、入力の行を見つけられない（許可・問いの画面）、カーソルが入力の頭に無い、は 0 回。人の観測: client の最終操作が `now - human_quiet_seconds` より新しい、`list-clients` が失敗する、は 0 回。client が 1 つも付いていなければ進む。
- 一度だけ（F3）: 2 つの見張りが同時に同じ印を取りに行き、実行は 1 つ。claim の取得が起動し直しより前。`claimed`・`respawning` の各段で止めた後の再起動で再実行せず（結果不明は照会、照会できなければ HALT）、tmux の条件の `pane_pid` が古い値のままの 2 回目の命令は `NOT_RESPAWNED`（差し替えの tmux で再現）。claim か帳面が書けなければ実行しない。
- 確認: `started` が古い・別の起動・別の pane・同じ `session_id`・`rotation_marker_id` が違う・`host_pid` が旧と同じ・`source` が `startup` でない、は `unconfirmed` と HALT。`pane_pid` が変わらないのに `started` だけが来る、も合わせない。
- 証拠（F4）: `intent` 行が起動し直しより前にあり、`host`・`old_session_id`・席・案件・`pane_id`・`host_started_at` を持つ。印が次の会話の物に置き換わった後でも、帳面から旧会話を一意に求められる。帳面に画面の中身・秘密の値が無い。
- 設定: `launch_command` に使えない文字、`owner_decision_ref` 無し、持ち主・権限が違う、`launch_script` の SHA-256 違い、は 0 回。
- F5: 見張りの module が実行できる tmux の命令が 3.3 の集合だけである。SSOT-6 の §9 に差分が無い。
- hook 側（FR6、単位の別の部分）: `source = startup` で、claim が `respawning` かつ `pane_id` と `tmux_socket` が合い `respawn_started_at` から `confirm_wait_seconds` 以内の時だけ、起動し直しの続きとして束（10,000 トークンの上限）と、Claude Code では initialUserMessage を返す。合わない時は今までの起動と同じ。同じ束は 2 回使わない。手番の `started` に `rotation_marker_id` を書く。
- 据え付けの後（Owner の決定で行う。この PR の外）: 使う host ごとに、`probe` の確かめ（入力の行・カーソルが入力の頭に出る・薄い案内文・`pane_start_command` の値）、Kusabi 自身の席での実際の起動し直しと確認、帳面の `old_session_id` から前の会話へ戻す確かめを 1 回ずつ行う。
