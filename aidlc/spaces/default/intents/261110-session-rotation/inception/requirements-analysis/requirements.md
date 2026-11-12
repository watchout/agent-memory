# 要件 — 会話の切り直し（261110-session-rotation）

- 依頼の原文: 「会話の切り直し（一定量で会話を切り、Kusabi の記録で同じ席が続きから動く）だけの小さな取り組み。最小の版を Claude Code と Codex の両方で動く形で作り、大きな取り組み（facility-ax-memory）の U3 を作る時に取り込む。設計の材料は arc が渡した物（iyasaka-arc#49 6760833406）。」`[desc]`
- 深さ: Minimal。種類: 機能の追加（今ある回復・取り込み・起動の部品をつなぐ）と、その前提になる直し 2 つ（会話の取り込み、MCP の tool が遅れて届く件）。scope は express。
- この取り組みの完了は、PR が統合され、Owner の決定を受けて Kusabi 自身の席に据え、実際に切って確かめたところまで（`[Q4]`）。

## 意図の分析

- 目的は、席の 1 歩あたりの読み直しの量を減らすこと。会話は使い捨てにし、席と記憶（Kusabi の DB）が続く。会話が一定量になったら切り、次の会話は同じ席として Kusabi の記録から続きを始める。（`[OI-1]` の Owner の言葉 3、`[OI-2]`）
- arc の試算では、まっさらな会話に Kusabi の記録を入れる形（土台 約 7.5 万）で 15 万〜30 万で切ると、今の既定より 42〜44% 減る。切った後に席が file を読み直す分は数えていないので、上限の見込み。（`[OI-2]`、`[arc の材料]` 5）
- Owner の条件: 「曖昧な点はかならずkusabiのDBを当たること」。切り直しの後・要約の後の席は、曖昧な点を推測で埋めず Kusabi の DB を当たる。これを満たすには、DB に会話の中身が入っていて、席が最初の 1 歩から Kusabi の tool を使えることが前提になる。今はどちらも欠けている（取り込みは 10-16 から止まっている、AUN の席では tool が遅れて届いた）。（`[Q1]`、`[OD-Q1]`、`[arc の補い]`）
- 今の部品で足りている所: 起動の hook は `clear`・`compact` でも動く。hook の command に席・案件・作業場が入っているので、作り直した後も同じ席の記録で回復の束を返せる。足りない所: 量を測って切る本番の経路、切る前に残す仕組み、切る見張り、続きから動いたかの確かめ。（`business-overview`、`architecture`、`inception/reverse-engineering/developer-scan.md` の Handoff Summary）
- 得をするのは、Kusabi を記憶に使う社内の席と、席を動かす Owner。最初に据えるのは Kusabi 自身の席。（`[Q4]`）

## 出典

- `[desc]` 依頼の原文（上）。`aidlc engine workspace project-description` の返す原文。
- `[OI-1]` OI-KUSABI-SESSION-ROTATION-SEAT-CONTINUES-20261110-001（https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6760304985 ）。Owner の原文「席の記憶を持って、一定量になったらセッションを切って次のセッションで起動するが、席はひきつぐ」。
- `[OI-2]` OI-KUSABI-SESSION-ROTATION-BUILD-AND-APPLY-20261110-001（https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6760833406 ）。Owner の原文「設計の変更をかけてkusabiをサクッと作って適用しましょう」ほか。
- `[arc の材料]` arc が公式の説明・source・この Mac の記録で確かめた事実（arc から Kusabi の席へのメッセージ、2026-11-10）: 1 量の測り方、2 Stop の hook の block と DB への直接の書き込み、3 hook から会話を切る口が無いこと、4 SessionStart の返せる物、5 数字、6 測る物。
- `[Q1]`〜`[Q4]` この段の問いの答え（`requirements-analysis-questions.md`）。Q1 は Owner の言葉、Q2〜Q4 は arc の答え（Owner の委任 #49 6762288830）。
- `[OD-Q1]` OD-KUSABI-ROTATION-WATCHER-AND-CLAUDE-AUTOCOMPACT-300K-20261110-001（https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6762423093 、本文の SHA-256 `07dc55322e2911f8e8265440edea378f8cc05d25daaa14d32768c5ff45a74670`）。
- `[arc の補い]` arc の答え（Owner の委任 #49 6762288830）、2026-11-10 の Kusabi の席へのメッセージ: 条件を要件と受入に入れる。会話の全文の取り込みの直し（https://github.com/watchout/agent-memory/issues/330#issuecomment-6761345791 ）をこの取り組みに入れる。MCP の server が先に接続して tool の一覧を出し、DB の用意は後にする直しを入れる。
- `[arc の順番]` arc の答え（Owner の委任 #49 6762288830）、2026-11-10 の Kusabi の席へのメッセージ: (1) 先に切り直しの取り組みで server の直し（起動のたびの表の変更の流しをやめ、migrate の command に任せる）を入れる、(2) その上で memory_scope の列と task_state_migration_archive の表を DB の基準で設計の記録にする、(3) Owner の決定を受けてから migrate で当てる。
- `[arc の直し]` arc の答え（Owner の委任 #49 6762288830）、要件の承認の問いへの Request Changes（2026-11-10）: R-01 見張りだけを作る段の最初に設計の記録と設計監査に通す、R-02 FR7.3 に S6 の 1 行、R-03 FR9.3 の数え方。
- `[設計監査 1 回目]` 見張りの設計監査（devauditor）の 1 回目の返却、BLOCK、F1〜F5（https://github.com/watchout/agent-memory/pull/341#issuecomment-6784177636 、本文の SHA-256 `81c165a77021d6c3490c09b8b03716cd918475942ab3a94f455796c6826f20fb`）。F5 の直し方は arc の答え（Owner の委任 #49 6762288830）: Codex は `/new` までで続きの文を打たない。F1〜F4 は作者の判断で直した。
- `[設計監査 2 回目]` 見張りの設計監査（devauditor）の 2 回目の返却、BLOCK、F1・F2 が残り、F3〜F5 は解消（https://github.com/watchout/agent-memory/pull/341#issuecomment-6784766255 、本文の SHA-256 `5d249b3955dc14ff57d64c8cb65449a0d3cbf93ef5ed6f6b1bb1921dc4bf3738`）。F1 = 読み戻しと BSpace では人の入力との競合を安全に戻せない、F2 = 結びを失った後にも BSpace を送る遷移がある。直し方は作者の判断（戻しのキーを全部やめ、確かめられなくなったら追加のキーを送らずに止まる）で版 3 に直したが、3 回目で F1・F2 が残ったため、4 回目の前に向きを変えた（次の行）。
- `[設計監査 3 回目]` 見張りの設計監査（devauditor）の 3 回目の返却、BLOCK、F1・F2 が残り、F3〜F5 は解消（https://github.com/watchout/agent-memory/pull/341#issuecomment-6785277864 、本文の SHA-256 `77541cf6b025ba23f639f1cc938dca9644e186afe53b1bcb9301e850eb3cf389`）。F1 = 条件つきの Enter は、観測の後に行が置き換わってカーソルが戻ると人の未送信の文を送ってしまう、F2 = 結びが `pane_pid` と command 名だけで、同じ pane の同名の CLI への入れ替わりを拒めない。arc の答え（Owner の委任 #49 6762288830）: 人の入力と tmux の pane の間に排他の手段が無いので、画面にキーを打つ限りこの競合は閉じられない。キーを打たず、席が手すきで入力欄が空と観測できた時に、席の起動の script で pane の席を起動し直す形に変える（FR5・FR6 の文と設計をこの形に直す）。残る危険は「観測の後に人が書き始めた未送信の文が消える」こと（文が勝手に送られるより安全な側の失敗）で、設計の記録に明記する。結びの確かめは、host の process の番号・起動の script の path・会話の id で行う。席ごとの起動の script を据えることは、今までどおり守る物（Owner の決定）。4 回目の依頼は、返却の next_action が公開された Owner の判断を求めていたので、それが出るまで出さなかった。
- `[Owner の判断 4 回目の向き]` OD-KUSABI-ROTATION-WATCHER-RESPAWN-NOT-KEYS-20261111-001: https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6785869798 （投稿者 watchout、本文の SHA-256 `f65ca4e11c9f71b3b31d34bdb17c3736f1add64705b9fc827ccb5dcff1f1dd3e`）。Owner の言葉（arc の端末の会話、原文）「1はいい」が、「席の画面にキーを打たずに起動し直す向きで、4 回目の監査に出してよいか」に答えた。決定: (1) 見張りは席の画面にキーを送らず、手すきで入力欄が空と観測できた時に pane の席を起動し直す、(2) 残る危険 R-A〜R-E（FR5.7、設計の記録 3.4）を受け入れて設計を 4 回目の設計監査に出す、(3) 4 回目の依頼は作者が出してよい。含まない: 席ごとの起動の script の登録・見張りの据え付け・席の hook の差し替え（arc-sec の確かめと Owner の決定の後）、DB の作りの変更。
- `[AUN の調べ]` Kusabi の席が 2026-11-10 に手元の記録だけで確かめた事実: AUN の Claude の席で、MCP の server の接続に 9,498 ms かかり、その前に席が最初の応答を返していた。server の main は DB の用意（接続と起動のたびの表の変更）を済ませてから接続する（`src/index.ts` の 51 行と 993 行）。
- `[C2]` Kusabi の席が、arc が席を起こし直した後の最初の会話で取った事実（2026-11-11）。Kusabi の SessionStart の証拠が `MALFORMED_HOOK_INPUT`・`input_valid: false`・`store_binding: unknown`・`emission_status: not_emitted` で、原因は Claude Code 2.1.321 が hook の入力に足した key（SessionStart: `session_title`。UserPromptSubmit: `prompt_id`・`session_title`。Stop: `background_tasks`・`effort`・`prompt_id`・`session_crons`）を、Kusabi の 3 つの入口が許可リストの外として入力ごと拒むこと。デプロイ済みの版 `1b731f00…` の parser に同じ key の組を当てて再現した。読み戻しの本文は `operation/deployment-execution/issue-339-readback-c2.md`（agent-memory#339 に未投稿）。
- `[arc の判断 #339]` arc の技術の判断（Owner の決定ではない）: agent-memory#339 の comment 6791901034（投稿者 watchout、本文の SHA-256 `69ca10d6e8e418ad425e1e9a8f81b73799d49fa8496ad93288dc2882fae59c32`）。知らない key は無視し、必須の key・型・大きさの上限は残す。無視した key の名前は証拠の契約（`claude-session-start-evidence-v1` の schema、`wasurezu-transcript-stop-capture/v1`）に足さず、契約ではない診断の記録に書く。設計の記録だけの PR を先に出して設計監査を 1 回受ける。同じ PR に必須の入口の一覧・installer の `--node-path`・`.gitignore`・記録を入れる。arc-sec の条件（公開。iyasaka-arc#57 の comment 6791886636・6791925065）= 必須の key・型・64 KiB の上限は残す／3 つの入口を 1 か所の parser に／実物の key の形の正例と負例の試験／反転する既存の負例は deviation_ledger に 1 行ずつ／診断の置き場は `$AGENT_MEMORY_HOME` の下・folder 0700・file 0600・一時 file + rename、中身は event 名・key の名前・件数・時刻だけ（名前は 64 字以内、1 件 32 個以内、上限を超えたら古い物から捨てる）、health check は名前と件数だけ報告し読めない時は「観測できず」、診断が書けなくても hook の答えと証拠は変えない。arc-sec の条件 4 は host の契約の版の定数を観測した 2.1.321 に上げることだが、この設計は 2.1.220 のまま保つ（FR10.5。理由は次の `[arc の追記 #339]`）。**#339 の comment 6791901034 には、host の契約の版についての判断は無い。**
- `[arc の追記 #339]` arc の技術の判断・追記（Owner の決定ではない）: agent-memory#339 の comment 6793417308（投稿者 watchout、本文の SHA-256 `af373c531792b58c7fcd7023d99c4e943c5f50cac54a2d5d1f9745779de43e5c`）。host の契約の版の定数は 2.1.220 のまま（意味は「契約を確かめた版」。v1 の schema の const と .v2 は守る物なので上げない）。観測した host の版は、hook の入力にも環境にも無いので、配備の health check の手順の 1 行（`claude --version`、code は足さない）で取り、配備の記録に契約を確かめた版とのずれを 1 行で必ず書く（読めない時は「観測できず」）。共有の parser により Codex の Stop・UserPromptSubmit も同時に緩み、Codex の SessionStart は範囲外。
- `[arc-sec の読み]` arc-sec の技術の読み（公開。iyasaka-arc#57 の comment 6792778481、本文の SHA-256 `683847414d37520993afd8de29dced0a4335822d7fe97c6b329039038266bcd6`）: 設計の PR の head `6cae0d93` を読み、止める点 0。独立の設計監査の verdict の代わりではない。実装の PR で見る点 2 つ（共有の parser が入口ごとの確かめを落とさず知らない key の値を下流に出さない事／配備の記録に版のずれの 1 行を必ず入れる事。反転する負例が身元の負例を巻き込まない事も読む）。
- `[配備の発見]` 配備の途中（第 4 回の C2 の取り直しの準備、2026-11-12）で席がコードを読んで見つけた設計の誤り: 引き継ぎの束の消費と `turn` の `rotation_marker_id` の書き込みが、出力が席に向けて書かれる前に済む（`session-rotation-start.ts`）。出力までの失敗では束が取り戻せず、見張りは届いていないのに「受け取った」と読む。詳細は `construction/code-generation/handoff-commit-order-design.md`。
- `[arc の判断 入れ物]` arc の技術の判断（Owner の委任 iyasaka-arc#49 6762288830 の技術の範囲。Owner の決定ではない）: 直しは同じ取り組みの construction で行い（Code Generation に戻す）、案 A（消費と印を出力の後へ）で進め、設計の記録だけの PR → 独立の設計監査（devauditor）→ PASS の後に試験だけの commit → 実装の順にする。 出典: agent-memory#339 の comment 6812844309（本文の SHA-256 `141b188728c12f07e477bc0a65776cf5d328b411915d24f9bf1ad997a9737187`）。
- `[設計監査 1 回目]` devauditor の 1 回目の設計監査（PR #342 の comment 6793000316、BLOCK、P2 が 4 件 F1〜F4）。直しは設計の記録の 13 節。
- 今のコードの読み解き: `inception/reverse-engineering/developer-scan.md`、`business-overview`、`architecture`、`code-structure`（`aidlc/spaces/default/codekb/agent-memory/`）。

## 機能の要件

### FR1 会話の量を測る

- **FR1.1** Claude Code の席では、Stop の hook の入力の `transcript_path` を読み、最後の応答の usage の `input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens` を、今の会話の量とする。（`[arc の材料]` 1）
- **FR1.2** Codex の席では、Stop の hook の入力の `transcript_path`（rollout）を読み、最後の `token_count` の `last_token_usage` の入力の量を、今の会話の量とする。（`[arc の材料]` 1）
- **FR1.3** transcript は末尾の決まった量だけ読む（今の Stop の取り込みと同じ 4 MiB）。量を読めない・usage が無い時は「観測できず」とし、閾値の下と同じには扱わない。その時は切らず、理由を証拠に残す。（標準 S5）
- **FR1.4** 量を決める核は純粋な関数にし、時刻・環境・file を自分で読まない。transcript の読み出しは adapter が行い、核に渡す。（標準 S4）

受入:
- Given Claude Code と Codex の transcript の見本（量が閾値の下・上・usage 無し）、When 測ると、Then 下と上は量の数を返し、usage 無しは「観測できず」と理由を返す。

### FR2 「一定量」の閾値

- **FR2.1** 既定は 300,000 トークン。値は 1 か所にだけ置く。（`[Q2]`、標準 S3）
- **FR2.2** 席ごとに変えられる。席の値は、その席の hook の command の引数で渡す。渡していない席は既定を使う。DB の作りは変えない。（`[Q2]`）
- **FR2.3** 切り直しの判定が今ある帯の判定（`src/restart-prepare.ts` の `contextSignalFor` と `src/context-window-resolution.ts` の `BAND_THRESHOLDS`）に触れる時は、2 か所に literal で書かれた帯の値を 1 か所に寄せる。（標準 S3「触る時に直す」、`architecture` の改善の機会）

受入:
- Given 引数の無い席と、引数で 200,000 を渡した席、When 量 250,000 を測ると、Then 前の席は切らず、後の席は切る手順に入る。

### FR3 切る前に残す

- **FR3.1** Stop の hook は、量が閾値以上で、その会話でまだ残していない時に、1 回だけ block を返す。理由の文で、席に「済んだこと・次の 1 歩・まだ決まっていないこと」を書いて終えさせる。（`[Q3]`、`[arc の材料]` 2）
- **FR3.2** 次の Stop の hook で、席が書いた文を transcript から取り出し、hook の script が DB に直接書く（MCP は通さない）。書き先は今ある置き場（席の作業の状態と、次の会話で 1 回だけ使う回復の束とその metadata）。（`[Q3]`、`[arc の材料]` 2）
- **FR3.3** 1 つの会話で block は最大 1 回にする。席の文が取れない時（空・形が違う・hook の期限切れ）は、席には何もさせず、既に DB にある会話の記録・決定・作業の状態だけで次の会話の頭を作る形に落とし、落ちた理由を残す。（`[Q3]` = C）
- **FR3.4** DB に書く前に、今ある秘匿処理を通す。記憶の中身を外の API（埋め込みを含む）に送らない。（project.md の Forbidden）

受入:
- Given 閾値以上の Claude Code と Codex の transcript の見本、When 1 回目の Stop の hook が動くと、Then block と理由の文を返す。When 席の文を含む 2 回目の Stop の hook が動くと、Then その文が DB の作業の状態と回復の束に入り、block は返さない。
- Given 席の文が無い 2 回目、When Stop の hook が動くと、Then 既にある記録だけで束を作り、落ちた理由を残す。

### FR4 「切ってよい」の印

- **FR4.1** FR3 の保存（または落ちた形の保存）が DB に入った後にだけ、「切ってよい」の印を出す。印は席（agent_id）・案件（project）・会話（session_id）と、その会話が動いている画面（tmux の pane_id・ソケット・host の process 番号）に結ぶ。（`[arc の材料]` 3、`[arc の直し]` 設計監査 1 回目の F2）
- **FR4.2** 印は、LLM を使わない見張りが決まった形で読める。今の印の状態は command で見られる。

受入:
- Given 保存の前、Then 印は無い。Given 保存の後、Then 印があり、席・案件・会話が合う。

### FR5 会話を切る見張り

- **FR5.1** LLM を使わない script にする。印があり、席が手すき（応答の途中でない）の時にだけ、その席の pane を、その pane を作った時の起動の command（Owner の決定で登録した席の起動の script）で 1 回起動し直す（`tmux respawn-pane -k`）。**席の画面にキーを一切送らない**（`/clear`・`/new`・Enter・戻しのキーのどれも送らない）。新しい会話は、SessionStart の hook が Kusabi の束を入れて続きから始める（FR6）。Codex の席は束を読んだ状態で次の入力（中継の行か Owner）を待つ。直す理由: 版 1〜3 の「画面に command を打つ」形は、3 回の設計監査で、人の入力と pane の間の排他が無いために閉じられないと分かった（上の `[設計監査 3 回目]`）。SSOT-6 §9（live TUI への文の送信を通常の回復の道にしない）とは、キーを送らないので一貫する。（`[Q1]` = B「席が手すきの時に会話を切り、続きから新しい会話で始めさせる」、`[arc の材料]` 3・4、arc の答え、Owner の委任 #49 6762288830）
- **FR5.2** 起動し直す先は、席と pane と起動の script の対応を明示した設定だけから決める。手すきを確かめられない時は何もしない（何もしないのが安全側）。1 つの印で起動し直すのは 1 回。
  - 入力欄: 画面が静かなことは入力欄が空であることを意味しない。入力欄が空であること（入力の行・カーソルが入力の頭にある。許可・問いの画面のように入力の行が無ければ動かさない）と、人が触っていないこと（tmux の client の最終操作の時刻）を、観測して起動し直す条件にする。1 つでも観測できない時は動かさない。これは未送信の文を消す頻度を下げるための条件であり、排他ではない（FR5.7）。（設計監査 1 回目 F1、2 回目 F1、3 回目 F1）
  - キーを送らない: 見張りは、席の入力に届く tmux の命令（`send-keys` など）を呼ぶ経路を持たない。実行する tmux の命令は、読むだけの物と、条件つきの起動し直し 1 回に限る。起動し直す command は見張りが渡さず、pane の起動の command の再実行に任せる。（設計監査 3 回目 F1）
  - 起動し直す先: 印・手番の session_id、pane の起動の command（設定の登録値と同じ）、起動の script の SHA-256、host の process の番号とその起動した時刻、が合うと、起動し直しを起こす直前と、tmux の中の条件（tmux に見える項目）で確かめる。同じ shell の下で別の CLI に替わった pane、再利用された番号を拒む。確かめられない時は何もしない。（設計監査 1 回目 F2、2 回目 F2、3 回目 F2）
  - 一度だけ: 起動し直しの前に、印に結ぶ排他の永続の取得を済ませる。取得も記録もできない時は実行しない。結果が不明な時は照会し、照会できなければ止まり、起動し直しをやり直さない（二度目は新しい会話を終わらせる）。（設計監査 F3、標準 S7）
- **FR5.3** 起動し直した・しなかったを、理由と一緒に証拠に残す。秘密の値は残さない。起動し直す前に、host・切る前の session_id・席・案件・pane・host の process の起動時刻を追記だけの帳面に足し、印が次の会話の物に置き換わっても旧会話を特定できるようにする。（設計監査 F4）
- **FR5.4** 見張りを席に据えること、席ごとの起動の script を設定に登録すること、席の hook を新しい版に替えることは、この PR には入れない。どれも守る物（席の起動の設定）で、据える前に arc-sec の確かめと Owner の決定を受ける。起動の script に求める条件（新しい会話を起こす・script だけで席が起きる・固定の最初の指示と続きの指示が食い違わない）は、設計の記録の 10 に置く。（`[Q1]`、`[OD-Q1]` の決定 1 の文面「席に据える前に」）
- **FR5.7** 残る危険を明記する。起動し直しは、観測の後に起きたことを見ずに process を終わらせるので、次の損失が残る。R-A 観測の後に人が書き始めた未送信の文が消える（送られはしない）、R-B 観測の後に届いた入力で始まった作業が途中で切れる、R-C 確かめと実行の間に pane の前面の process が替わると、その process が終わる、R-D 取り込みの途中の hook が切れる、R-E 新しい会話が起きない（確認が合わず席が止まる）。どれも席に誤った文が届かない側の失敗だが、損失ゼロではなく、観測の条件で頻度を下げるだけで排除できない。設計の記録の 3.4 に書き、PR の deviation_ledger に 1 行ずつ載せ、据え付けの時の Owner の決定で示して受けてもらう。「短い無害な入力」などと断定しない。安全の条件は deviation_ledger の記載で代えない。（設計監査 3 回目、arc の答え）
- **FR5.6** 見張りだけを守る物に触れる部品として扱う。作る段の最初に、見張りの設計の記録（何を見て、いつ・何をするか・止める条件・失敗した時・残る危険・戻し方）を取り組みの記録の中に書き、単位の PR を設計の記録だけで先に出して、独立の設計監査（devauditor）を 1 回受ける。見張りの code は、その PASS の後に書く。この単位の code と試験の code は、全部、設計監査の PASS の後に書く（arc の訂正、Owner の委任 #49 6762288830: R-01 の「FR1〜FR4・FR6〜FR8 は設計監査を待たずに作ってよい」は、社内の決まり aidlc-only §2 の「守る物に触れる単位は code を設計監査の PASS の後に書く」と食い違っていたため取り下げた）。設計の段は足さない。（`[arc の直し]` R-01、team.md の「守る物に触れる単位」）
- **FR5.5** 設計の正本 `docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md` の §5・§6（Kusabi は会話を作り直さない、単独の自動の作り直しは 3 条件がそろう時だけ）を、見張りの形に合わせて先に直す。直さずに作らない。（権限と待機の決まり R3「設計と実装を黙って食い違わせない」）

受入:
- Given 印あり・手すき・入力欄が空・人が触っていない・結びが合う、Then 登録した起動の command で pane を 1 回だけ起動し直し、キーは 1 つも送らない（Codex も同じで、続きの文は打たない）。Given 印あり・応答の途中、または手すきを確かめられない、Then 何もしない。Given 同じ印、Then 2 回目は起動し直さない（2 つの見張りが同時でも 1 回、途中で止まった後の再起動でも、同じ観測の 2 回目の命令でもやり直さない）。Given 対応の設定に無い画面、Then 何もしない。
- Given 静止した書きかけ・入力欄が空と証明できない・許可や問いの画面・人の最終操作が新しい・読めない、Then 何もしない。Given 確かめの後にカーソルが動いた・client が付いた・pane がコピー・モードになった・手番が変わった、Then 起動し直しは実行されない（tmux の条件が偽、または直前の確かめが落ちる）。Given 印を書いた host が終了して同じ shell の下の別の CLI が前面になった・pane の起動の command が登録と違う・起動の script の SHA-256 が違う、Then 何もしない。Given 帳面と印が次の会話の物に置き換わった後、Then 帳面から旧会話の host と session_id を求められる。
- Given 起動し直しの後、Then 新しい会話の `started`（`source = startup`、`rotation_marker_id` が印と同じ、`session_id` と `host_pid` が旧と違う）と `pane_pid` の変化の両方が合った時だけ完了とし、合わなければ未確認として席を止め、やり直さない。

### FR6 次の会話で続きから動く

- **FR6.1** Claude Code の SessionStart（source = `startup`・`clear`・`compact`）で、hook は FR3 で残した文を頭にして回復の束を additionalContext で返し、initialUserMessage で「続きから動く」を入れる。`startup` は、見張りの起動し直しの続きとして使う時に限る: その席の claim が `respawning` で、`pane_id`（環境変数 `TMUX_PANE`）と tmux のソケットが合い、`respawn_started_at` から確認の待ち時間以内の時だけ。合わない `startup` は今までの起動と同じ（FR6.3）。使った時は手番の file の `started` に `source` と `rotation_marker_id` を書く。（`[arc の材料]` 4、設計監査 3 回目を受けた arc の答え）
- **FR6.2** Codex の SessionStart（source = `startup`・`clear`・`compact`）で、hook は同じ形の additionalContext を返す（`startup` の条件は FR6.1 と同じ）。続きの文は打たない（FR5.1）ので、席は束を読んだ状態で次の入力（中継の行か Owner）を待つ。（`[arc の材料]` 4、設計監査 1 回目の F5 を受けた arc の答え）
- **FR6.3** 準備した回復の束は、ふだんの起動の口（`src/claude-session-start.ts`・`src/codex-session-start.ts`）でも 1 回だけ取り出して使う。束が無い時は、今までどおり DB から作る。（`developer-scan.md` の「起動の口が 2 本ある」）
- **FR6.4** 切り直しで頭に入れる量の上限は、ふだんの起動（1,800 トークン・8,192 バイト）と分けて、10,000 トークンにする。（`[arc の材料]` 5「再開用のまとめは数千〜1 万に収める」）
- **FR6.5** 保存が DB に入ってから印を出すので（FR4.1）、最後の応答の取り込み（非同期）より先に新しい会話が束を作ることは起きない。

受入:
- Given 保存と印のある席、When Claude Code の SessionStart が source = `clear` で動くと、Then additionalContext の頭に残した「次の 1 歩」があり、initialUserMessage がある。Codex では additionalContext の頭に同じ物がある。
- Given claim が `respawning` で `pane_id`・tmux のソケットが合う席、When SessionStart が source = `startup` で動くと、Then 同じ形の束（上限 10,000 トークン）が入り、手番の `started` に `rotation_marker_id` が書かれる。Given claim が無い・`pane_id` が違う・待ち時間を過ぎた `startup`、Then 今までの起動と同じで、束を切り直しの物として使わない。
- Given 束が使われた後、When もう一度 SessionStart が動くと、Then 同じ束は使わない。

### FR7 曖昧な点は Kusabi の DB を当たる（Owner の条件）

- **FR7.1** 切り直しの後と要約の後に頭に入れる文に、「曖昧な点は推測で埋めず、Kusabi の DB（回復の束・作業の状態・決定・会話の記録）を当たる」と、当たるための tool の名前を、決まった文として入れる。（`[Q1]`、`[OD-Q1]` 3）
- **FR7.2** MCP の server は、DB の用意より先に接続して tool の一覧を出す。tool の呼び出しは DB の用意が済むのを待つ。（`[arc の補い]`、`[AUN の調べ]`）
- **FR7.3** 起動のたびの表の変更の流しをやめる。MCP の server（`src/index.ts`）・`src/boot.ts`・`src/post-tool-hook.ts` は表の変更を流さず、表の変更は migrate の command だけが流す。これで、新しい版を席で起こしても、まだ本番に入っていない表の変更は入らない。（`[arc の補い]`、`[arc の順番]` (1)）
  - 標準 S6（新旧の同居）: 古い版の席は今までどおり起動の時に表の変更を流すので、新しい版と同じ DB の上で同居できる。本番にまだ入っていない表の変更は、migrate の command と Owner の決定で入れる。（`[arc の直し]` R-02）

受入:
- Given 切り直しの後の SessionStart、Then 頭の文に FR7.1 の決まった文がある。
- Given DB の用意に時間がかかる server、When 起動すると、Then tool の一覧は DB の用意を待たずに返り、用意の前に呼んだ tool は用意の後に答える。
- Given 見本の会話で残した決定と作業の状態、When 曖昧な問いに当たる言葉で DB を探すと、Then 答えに要る記録が返る。

### FR8 会話の取り込みを直す

- **FR8.1** 会話の全文の取り込みが 2026-10-16 から止まっている原因を、Stop の hook の取り込み（`src/transcript-stop-capture.ts`）と、取り込みの常駐（launchd の raw-capture。誤り `store.recordRawEvent is not a function`）の両方で確かめ、直す。（`[arc の補い]`、https://github.com/watchout/agent-memory/issues/330#issuecomment-6761345791 ）
- **FR8.2** 直した後、見本の transcript を取り込むと `conversation_events` と `raw_events` に行が入る。
- **FR8.3** 動いている常駐と席の hook の差し替えは守る物（展開）なので、この PR には入れず、Owner の決定で行う。
- **FR8.4** Claude Code の会話の身元は、hook の入力の `session_id` と `transcript_path` で決める（置き場: projects の直下の 1 つの dir の中の regular file。持ち主は今の uid、symlink でない。file 名 `<session_id>.jsonl`。dir 名は席が宣言した起動の dir の符号化）。record ごとの cwd は身元の条件にしない。規則 R1〜R9 は設計の記録 `construction/code-generation/capture-identity-design.md` に書く。（`[arc の補い]`、arc の答え: Owner の委任 iyasaka-arc#49 6762288830。arc-sec の確かめ: https://github.com/watchout/iyasaka-arc/issues/57#issuecomment-6786650040 、本文の SHA-256 `487b93c6d403593069e0ca4eda945269ad1f97de964863dfff00870203bbf34d`。セキュリティに関わる規則の変更なので、統合の前に Owner の exact-head を通す。）
- **FR8.5** 取り込みの結果は 3 値（取り込んだ／拒んだ + 理由コード／観測できず）で受領に残し、観測できずを成功に数えない。cwd の種類の数と、席の workspace の外の record の数を、数として受領に残す（門ではない）。
- **FR8.6** 取り込みは冪等で、同じ file を 2 回取り込んでも行が重ならない。

受入（FR8.4〜FR8.6）:
- Given cwd が 6 種以上ある本物の形の transcript、When Stop の hook を流すと、Then 取り込まれ、受領の `cwd_kinds` が 6 以上になる。
- Given hook の cwd が起動の dir と違う（cd の後の Stop）、When 流すと、Then 取り込まれる。
- Given 次の 5 つ（file 名が session_id と違う／1 record だけ別の sessionId／別の workspace の dir の下の file／projects の dir の中の symlink が外の file を指す／regular file でない）、When 流すと、Then 取り込まれず、理由コードが受領に出る。
- Given 同じ file を 2 回、Then 2 回目は重ならない。

受入:
- Given 止まった原因を再現する見本、When 直した取り込みを流すと、Then 行が入り、同じ入力の 2 回目は重ねて入れない。

### FR9 席に据えて確かめる

- **FR9.1** Claude Code と Codex の両方で、会話の記録の見本を使う試験で「量を測る → 保存して印を出す → 切った後の新しい会話の頭に、残した次の 1 歩が入る」を確かめる。（`[Q4]` の A）
- **FR9.2** 統合の後、Owner の決定を受けて Kusabi 自身の席に据え、実際に切る。切った後の最初の応答が、残した次の 1 歩に触れるかを確かめる。据え付けの前に見張りの `probe` で入力の行・カーソルが入力の頭に出ること・薄い案内文・tmux の条件つきの起動し直しの対応・`pane_start_command` の値を確かめ、据え付けの後に、Kusabi 自身の席で実際の起動し直しと確認（`pane_pid` の変化と `started`）を 1 回行い、使う host ごとに帳面の旧 session_id から前の会話へ戻せるかを 1 回確かめる。（`[Q4]` の C と X、設計監査 F1・F4、3 回目）
- **FR9.3** 据えた席で、1 歩あたりの量（据える前と後）・切った後の取り違い・Owner の促しの回数を数える。数え方は arc が決めた次のとおり（`[Q4]`、`[arc の材料]` 6、`[arc の直し]` R-03）:
  - 1 歩 = 席の会話の assistant の API 呼び出し 1 回（usage を持つ応答 1 つ。同じ呼び出しの分かれた行は 1 回と数える）。
  - 前後の期間 = 据える前の同じ席の直近 200 歩と、据えた後の最初の 200 歩。
  - 量 = 1 歩あたりの入力（input + cache read + cache write）の中央値と平均。
  - 取り違い = 切り直しの後の最初の 3 応答のうち、(a) 残した次の 1 歩と違う事を始めた、または (b) DB に答えのある事を Owner に聞いた、の回数（切り直し 1 回ごと）。
  - Owner の促しの回数 = 据えた後 200 歩の間に、Owner が「止まってる」「進めて」の類を席に打った回数。
  - 合否の閾値は、測った後に arc が決めて記録する。

### FR10 hook の入力の parser を、host の更新に強くする

- **FR10.1** Claude Code の SessionStart、取り込みの Stop・UserPromptSubmit、切り直しの Stop・UserPromptSubmit の 3 つの入口は、同じ 1 か所の parser で入力を確かめる。（`[C2]`、`[arc の判断 #339]`）
- **FR10.2** parser は、知らない key を無視する。必須の key（SessionStart: `cwd`・`hook_event_name`・`session_id`・`source`・`transcript_path`。Stop・UserPromptSubmit: `cwd`・`hook_event_name`・`session_id`・`transcript_path`）の欠け、必須の値の型・形の違い、JSON でない入力、object でない入力、64 KiB を超える入力は、今までどおり拒否する。任意の key の型の扱いも入口ごとに今のまま変えない（SessionStart の `model`・`permission_mode`・`agent_type` は型の違いを拒否し、Stop・UserPromptSubmit の任意 8 項目は型が違っても拒否せず省略する。設計の記録 3 節の表）。知らない key の値は読まず、どこにも残さない。取り込みの Stop・UserPromptSubmit の parser は Codex の Stop・UserPromptSubmit と共有するので、Codex のこの 2 つにも同じ規則が同時に当たる（Codex の SessionStart の parser は範囲の外）。知らない key を含まない入力の拒否の理由コードは今のまま写す。知らない key を含む入力は、知らない key を除いた同じ入力と同じ結果（拒否か受理か・理由コード）になる。知らない key が他の拒否と重なる入力は、外形の確かめを通った後の確かめ（`hook_event_name`・`source`・身元・下流）まで進むので、理由コードが今の `MALFORMED_HOOK_INPUT`／`malformed_input` から、その入力の本来の理由コードに変わる（拒否は変わらない。Claude Code の Stop・UserPromptSubmit が cwd を見ない現行の規則は変えず、新しい拒否を足さない。設計の記録 3 節の層の分けと表）。
- **FR10.3** 無視した key の名前は、契約ではない診断の記録に書く。置き場は `$AGENT_MEMORY_HOME` の下、folder 0700・file 0600、一時 file + rename で置き換える。中身は event 名・key の名前・件数・時刻だけで、値・本文・path は書かない。名前は 64 字以内の安全な文字だけ（それ以外の名前は名前を書かず件数だけ数える）。1 回の入力から扱う名前は 32 個まで（超えた分は数だけ数える）。file の entries は 32 件までで、上限を超えたら古い物から捨てる。
- **FR10.4** 診断が書けなくても（置き場が書けない・壊れている・上限）、hook の答えと証拠は変えない。診断を読む health check は、名前と件数だけを報告し、読めない時は「観測できず」と返す（0 と読まない）。診断は、hook の答えと証拠を（出力の書き込みが返るまで）書き切った後に、非同期で 1 回だけ試み、hook の終了を、答えを書き終えてから `HOOK_DIAGNOSTIC_MAX_WAIT_MS`（200 ms。1 か所の定数）より遅らせない（診断が先に終われば終わった時、上限が先ならその時に終了する）。答えを書いた時点の残りの予算が `HOOK_DIAGNOSTIC_MIN_REMAINING_MS`（2000 ms。1 か所の定数）未満なら診断を始めない（一部だけ書く形は無い）。診断の I/O は、既存の診断の file の読み 1 回と、一時 file + rename の書き 1 回だけで、再試行は無く、fsync もしない。入口が答えを書いた時点の残りの予算（`remaining_ms`）を渡す（診断の核は時計を読まない）。（設計監査 1 回目の F2、2 回目の F2）
- **FR10.5** host の契約の版の定数（`CLAUDE_SESSION_START_HOST_CONTRACT_VERSION`）は 2.1.220 のまま、意味は「契約を確かめた版」。v1 の証拠の schema の const は動かさない。観測した host の版は診断の記録には書かない（hook の入力にも環境にも版が無い）。配備の health check の手順の 1 行（code ではない。実施者は配備を行う席）が `claude --version` で取り、契約を確かめた版とのずれを配備の記録に 1 行で必ず書く。読めない時は「観測できず」と返す（ずれが無いとは読まない）。版は証拠にも診断の記録にも書かない。（出所: `[arc の追記 #339]` が、定数を保つ理由、手順の 1 行で取ること、ずれを配備の記録に 1 行で必ず書くこと、読めない時は「観測できず」、版を証拠にも診断にも書かないこと、を記録している。作者の選択で `[arc の追記 #339]` には書かれていない点: 実施者を配備を行う席にすること、`session-rotation-status` も版を取らないこと、ずれの 1 行が無い配備の記録を完了としないこと。arc-sec の条件 4 の「2.1.321 に上げる」とは違う）
- **FR10.6** 必須の入口の一覧（版を作る道具の `ENTRYPOINTS` と rollout の `REQUIRED_ENTRYPOINTS`）に、切り直しの 2 つ（`dist/session-rotation-stop.js` と `dist/rotation-watcher.js`）を足す。席の hook の installer（`dist/claude-hook-installer.js`・`dist/codex-hook-installer.js`）も今の一覧に無いが、足すかは arc の指示（2 つ）の外なので設計の記録で確かめる。
- **FR10.7** 席の hook の installer 2 つ（Claude・Codex）に `--node-path`（既定は今の動き = 実行中の node）を足す。受け入れるのは、絶対 path で、basename がちょうど `node`、NUL を含まず、実在する通常 file（symlink は許す）で、実行できる物だけ。それ以外（`nodejs`・`node22` などの別名を含む）は、設定を書かずに止まる。installer が出す 3 つの command（SessionStart・取り込みの Stop・切り直し）は同じ node を使う。installer が管理中の hook を見分ける条件は、node の path に依らない形（先頭が絶対 path で、runner の path・adapter id・引数の並びが canonical に一致）にし、別の node で入れ直しても管理中の hook は 1 つになる。`parseClaudeHookCommand` の既定の結果は変えない。rollout の読み戻し・監査の読みも変えないので、`--node-path` で別の node を入れた席はそれらに数えられず安全側に失敗する（rollout・監査が数える席には使わない）。（設計監査 1 回目の F3、独立の見直しの M2）

受入（FR10.1〜FR10.5・FR10.7）:
- Given 実物の形の入力（SessionStart に `session_title`、UserPromptSubmit に `prompt_id`・`session_title`、Stop に `background_tasks`・`effort`・`prompt_id`・`session_crons`）、When 3 つの入口に流すと、Then 受理され、診断に key の名前と件数が出て、値は出ない。
- Given 必須の key の欠け・型の違い・64 KiB 超・JSON でない入力・配列の入力、When 流すと、Then 今までどおり拒否され、理由が証拠に出る。
- Given 拒否される入力（`hook_event_name`・`source` の違い、binding の不正、cwd が workspace の外など）に知らない key を足した入力、When 流すと、Then 結果（拒否か受理か・理由コード）は、知らない key を足す前の入力と同じ。
- Given 診断の置き場が書けない、When 流すと、Then hook の答えと証拠は書けた時と同じで、席は止まらない。
- Given 診断の書き込みが遅い（実時間で 3000 ms・4500 ms かかる書き手、戻らない書き手）、When 流すと、Then 答えと証拠は診断なしと byte で同じで、終了は答えを書き終えてから 200 ms 前後（書き手の遅れを待たない）。Given 残りの予算が 2000 ms 未満（主処理が使い切った場合を含む）、When 流すと、Then 診断の書き手は呼ばれない。残りがちょうど 2000 ms なら呼ばれる。
- Given Stop・UserPromptSubmit の任意項目の型違い（`model: null` など 8 種）、When 流すと、Then 今までどおり受理され、その項目は返す値に入らない。Given SessionStart の `model: null`・違う `permission_mode`・空の `agent_type`、When 流すと、Then 今までどおり `MALFORMED_HOOK_INPUT`。
- Given `nodejs` の名前の symlink を `--node-path` に渡す、When installer を流すと、Then 設定を書かずに止まる。Given 別の symlink（名前は `node`）で入れ直す、When 流すと、Then 管理中の hook が 1 つで、先頭の node が新しい path。
- Given 診断の file が壊れている、When health check が読むと、Then 「観測できず」を返し、0 件と報告しない。

### FR11 引き継ぎの確定を、出力が書かれた後に行う

- **FR11.1** 引き継ぎの束を消費済みにする操作と、`turn` file の `rotation_marker_id` の書き込みは、SessionStart の hook の出力が席に向けて書き込まれた（書き込みの callback が誤りなしで返った）後に行う。出力を書けなかった時、degraded の出力の時、回復の読み込みが例外・期限（`RECOVERY_TIMEOUT`）で終わった時は、束を消費済みにせず、`rotation_marker_id` を null のままにする。（`[配備の発見]`、`[arc の判断 入れ物]`）
- **FR11.2** 束の取得・SHA-256 の突き合わせ・redaction・文の組み立てまでは出力の前に行い、出力の形（`additionalContext`・`initialUserMessage`）、証拠の契約（`wasurezu-session-rotation-start/v1` と SessionStart の証拠）、DB の構造、store の verb の数は変えない。
- **FR11.3** 確定（消費と印の書き込み）が失敗した時（例外・上限 1.5 秒・消費の競り負け）は、握りつぶさず、`rotation_marker_id` が null の `turn` と `unconfirmed` の claim・席の HALT として見える。見張りの動き（確認の待ちを過ぎたら `unconfirmed` と HALT で止まり、2 度目の respawn をしない）は変えない。同じ文の二重の配達は許す（`clear`／`compact` の起動で、marker が期限内（1800 秒）・pane 一致の時だけ。`startup` は claim が `respawning` の間だけ）。許さないのは、届いていないのに届いたと記録すること。
- **FR11.4** Claude と Codex の SessionStart の process 層が、同じ 1 つの確定の関数を呼ぶ。時刻は呼ぶ側が渡し、核は取らない（S4）。
- **FR11.5** 旧い hook（消費が先）と新しい hook（消費が後）は、同じ DB に対して同居できる（消費は `status = 'active'` の条件つきの更新で 1 度だけ効く）。code だけの変更で、戻すのは code を戻すだけ（S6）。

受入（FR11.1〜FR11.5）:
- Given 回復の読み込みが例外を投げる、または期限を超える、When SessionStart を流すと、Then degraded の出力が出て、束は `active` のまま、`turn` の `rotation_marker_id` は null。
- Given 出力の書き込みの callback が誤りを返す、When 流すと、Then 確定は呼ばれず、束は `active` のまま。
- Given 通常の起動、When 流すと、Then 出力の書き込みの後に束が `consumed` になり、その後に `turn` に `rotation_marker_id` が入る（順序が記録で見える）。
- Given 確定の中で消費が競り負けた（null）、または上限を超えた、When 流すと、Then `rotation_marker_id` は書かれず、席の出力は変わらず、例外にならない。
- Given `rotation_marker_id` が null の `turn`、When 見張りが確認を見ると、Then 確認済みとは読まず、確認の待ちを過ぎたら claim が `unconfirmed`、席に HALT（`unconfirmed`）が書かれる。
- Given 同じ束に対して旧い hook と新しい hook を流す、When 両方が消費しようとすると、Then 1 度だけ効く。

## 非機能の要件

- **NFR1** 席の起動と応答を止めない。SessionStart の hook は失敗しても席を起動させ（fail-open）、理由を証拠に残す。Stop の hook の block は 1 つの会話で最大 1 回。hook の期限は今と同じ 9 秒、内部の期限は 7 秒。
- **NFR2** Stop の hook での量の測りは、末尾 4 MiB の読み出しと純粋な計算だけにし、取り込みの重さを増やさない。
- **NFR3** 安全: 見張りは、席の画面にキーを送らず、明示した pane を登録した起動の command で起動し直すだけにする。秘密の値（DB の URL など）を、process の引数・証拠・log に出さない。記憶の中身を外の API に送らない。
- **NFR4** 試験: 変えた行と新しい行の網羅率 100%（team.md）。新しい試験は今の自前の tsx の形で書き、`package.json` の試験の一覧に入れて CI で回す（workflow の file は変えない）。
- **NFR5** DB の作りを変えない。今ある表と列だけを使う。変えが要ると分かったら、その時に止めて arc に知らせる。
- **NFR6** Claude Code と Codex の両方で同じ働きをする。違うのは FR6.1・FR6.2 の返し方だけ。
- **NFR7** 標準 S2〜S5 に従う: 閾値は 1 か所、核は時刻を読まない、「観測できず」を成功に読み替えない、2 例の写しを早く抽象化しない。

## 制約

- 守る物（Owner が決める）: 見張りを席に据えること、席の起動の設定と hook の据え付け、動いている常駐の差し替え、DB の作りの変更、workflow。この PR はコードと試験と設計の文書だけにする。
- 1 単位 = 1 PR。監査は devauditor、統合は suite-lead。
- 新しい外部の依存を足さない。Node 20 以上。
- 見張りは席の process の終了と再起動に当たる（セキュリティ・席の起動）。team.md により、見張りは作る前に設計の記録で設計監査を 1 回受ける（FR5.6）。

## 前提

- Claude Code と Codex（0.166.0）の Stop の hook は、block を返すと同じターンのまま理由の文を入力にして続ける。（`[arc の材料]` 2。この取り組みでは動かして確かめていない）
- Claude Code の SessionStart は additionalContext と initialUserMessage を返せる。Codex は additionalContext だけ。（`[arc の材料]` 4）
- 取り込みの止まりの原因は、この段では確かめていない。FR8 を作る時に確かめる。原因が DB の作りに当たれば NFR5 で止める。
- 量の試算（42〜44% 減）は過去の伸び方からの見込みで、切った後の読み直しを数えていない。実際の減りは FR9.3 で測る。

## 範囲の外

- 見張りと hook を、Kusabi 自身の席のほかの席へ据えること（据える席を広げるのは別の決定）。
- モデルの切り替え、Claude Code の要約の上限の設定（arc が `[OD-Q1]` 2 で行った）。
- #339 の席の Kusabi の入れ替え（別の手順）。
- main に既にある表の変更（knowledge の memory_scope 列、task_state_migration_archive 表）を本番に入れること。本番にはまだ無い（2026-11-10 に読むだけで確かめた）。順番は、FR7.3 の後に DB の基準（Part B の B1・B3、独立の監査 B5）で設計の記録にし、Owner の決定を受けてから migrate で当てる。（`[arc の順番]` (2)(3)）
- Codex の SessionStart の parser（`parseCodexSessionStartInput`）と、ほかの host の parser（Gemini・Antigravity）。Claude の 3 つの入口と同じ形の脆さがある。直すかは別に決める（arc の判断）。
- 診断の記録を正式な証拠の項目にすること（後で .v2 として別に決める。arc の判断）。
- ほかの製品の範囲。

## まだ決まっていないこと

1. AUN が持つ席で見張りを使うか（SSOT-6 §5「AUN が席を持つ時、Kusabi は再起動しない」）。FR5.5 で設計を直す時に決める。
2. FR9.3 の合否の閾値。測った後に arc が決めて記録する。
