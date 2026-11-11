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
- `[設計監査 2 回目]` 見張りの設計監査（devauditor）の 2 回目の返却、BLOCK、F1・F2 が残り、F3〜F5 は解消（https://github.com/watchout/agent-memory/pull/341#issuecomment-6784766255 、本文の SHA-256 `5d249b3955dc14ff57d64c8cb65449a0d3cbf93ef5ed6f6b1bb1921dc4bf3738`）。F1 = 読み戻しと BSpace では人の入力との競合を安全に戻せない、F2 = 結びを失った後にも BSpace を送る遷移がある。直し方は作者の判断（戻しのキーを全部やめ、確かめられなくなったら追加のキーを送らずに止まる。FR5.2）。arc の提案（席に打たず、席の起動の script で起動し直す形）は、今は採らず、見張りの設計の記録の 11 に理由と将来の選択肢として残した。
- `[AUN の調べ]` Kusabi の席が 2026-11-10 に手元の記録だけで確かめた事実: AUN の Claude の席で、MCP の server の接続に 9,498 ms かかり、その前に席が最初の応答を返していた。server の main は DB の用意（接続と起動のたびの表の変更）を済ませてから接続する（`src/index.ts` の 51 行と 993 行）。
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

- **FR5.1** LLM を使わない script にする。印があり、席が手すき（応答の途中でない）の時にだけ、その席の画面に決まった command を 1 回打つ（Claude Code は `/clear`、Codex は `/new`）。打つのは command だけで、続きの文は打たない。Codex の席は束を読んだ状態で次の入力（中継の行か Owner）を待つ。直す理由: SSOT-6 §9（live TUI への文の送信を通常の回復の道にしない）を優先した（arc の答え、Owner の委任 #49 6762288830。設計監査 1 回目の F5 を受けて、前の版の「Codex では続けて『続きから動く』の 1 行を打つ」を取り下げた）。（`[Q1]` = B、`[arc の材料]` 3・4）
- **FR5.2** 打つ先は、席と画面の対応を明示した設定だけから決める。決まった文字列のほかは打たない。手すきを確かめられない時は打たない（打たないのが安全側）。1 つの印で切るのは 1 回。
  - 入力欄: 画面が静かなことは入力欄が空であることを意味しない。入力欄が空であること（入力の行・カーソルが入力の頭にある）と、人が触っていないこと（tmux の client の最終操作の時刻）を、観測して打つ条件にする。1 つでも観測できない時は打たない。打った後は、Enter の前に、行の中身・カーソル位置・client の最終操作が打った直後の形のままと確かめ、Enter は tmux の中で条件を評価して 1 回だけ送る。（設計監査 1 回目 F1、2 回目 F1）
  - 追加のキーを送らない: 見張りが送るキーは、決まった command の文字と Enter 1 回だけにする。BSpace などの戻しのキーは送らない。打った後に確かめられなくなった時（結びが変わった・画面が読めない・入力欄が変わった）は、追加のキーを 1 つも送らずに止まり、入力欄に残った command の文字は人が消す。人の入力やカーソルの持ち主を証明できないまま、文字数だけ消すことを回復として扱わない。（設計監査 2 回目 F1・F2）
  - 打つ先: 印・手番の session_id と、送り先の pane で今動いている席・会話・host の process が同じと、送る前・打った後・Enter の実行そのもの（tmux の中）で確かめる。確かめられない時は打たず、打った後なら追加のキーを送らない。（設計監査 1 回目 F2、2 回目 F2）
  - 一度だけ: 最初の送信の前に、印に結ぶ排他の永続の取得を済ませる。取得も記録もできない時は送らない。結果が不明な時は照会し、照会できなければ止まり、再送しない。（設計監査 F3、標準 S7）
- **FR5.3** 打った・打たなかったを、理由と一緒に証拠に残す。秘密の値は残さない。送る前に、host・切る前の session_id・席・案件・pane を追記だけの帳面に足し、印が次の会話の物に置き換わっても旧会話を特定できるようにする。（設計監査 F4）
- **FR5.4** 見張りを席に据えることは、この PR には入れない。据える前に arc-sec の確かめと Owner の決定を受ける。（`[Q1]`、`[OD-Q1]` の決定 1 の文面「席に据える前に」）
- **FR5.6** 見張りだけを守る物に触れる部品として扱う。作る段の最初に、見張りの設計の記録（何を見て、いつ・何を打つか・止める条件・失敗した時・戻し方）を取り組みの記録の中に書き、単位の PR を設計の記録だけで先に出して、独立の設計監査（devauditor）を 1 回受ける。見張りの code は、その PASS の後に書く。この単位の code と試験の code は、全部、設計監査の PASS の後に書く（arc の訂正、Owner の委任 #49 6762288830: R-01 の「FR1〜FR4・FR6〜FR8 は設計監査を待たずに作ってよい」は、社内の決まり aidlc-only §2 の「守る物に触れる単位は code を設計監査の PASS の後に書く」と食い違っていたため取り下げた）。設計の段は足さない。（`[arc の直し]` R-01、team.md の「守る物に触れる単位」）
- **FR5.5** 設計の正本 `docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md` の §5・§6（Kusabi は会話を作り直さない、単独の自動の作り直しは 3 条件がそろう時だけ）を、見張りの形に合わせて先に直す。直さずに作らない。（権限と待機の決まり R3「設計と実装を黙って食い違わせない」）

受入:
- Given 印あり・手すき・入力欄が空・結びが合う、Then 決まった command だけを 1 回打つ（Codex も `/new` だけで、続きの文は打たない）。Given 印あり・応答の途中、または手すきを確かめられない、Then 打たない。Given 同じ印、Then 2 回目は打たない（2 つの見張りが同時でも 1 回、途中で止まった後の再起動でも再送しない）。Given 対応の設定に無い画面、Then 打たない。
- Given 静止した書きかけ・入力欄が空と証明できない・人の最終操作が新しい・読めない、Then 打たない。Given 打った後に書きかけが足された・カーソルが動いた・行が置き換わった・結びが変わった・画面が読めなくなった、Then Enter も戻しのキーも送らず（送ったキーは command の文字だけ）、止まって記録する。Given 設定の打つ先が別の会話・別の process・再利用された pane、Then 打たない。Given 帳面と印が次の会話の物に置き換わった後、Then 帳面から旧会話の host と session_id を求められる。

### FR6 次の会話で続きから動く

- **FR6.1** Claude Code の SessionStart（source = `clear`・`compact`）で、hook は FR3 で残した文を頭にして回復の束を additionalContext で返し、initialUserMessage で「続きから動く」を入れる。（`[arc の材料]` 4）
- **FR6.2** Codex の SessionStart（source = `clear`・`compact`）で、hook は同じ形の additionalContext を返す。続きの文は打たない（FR5.1）ので、席は束を読んだ状態で次の入力（中継の行か Owner）を待つ。（`[arc の材料]` 4、設計監査 1 回目の F5 を受けた arc の答え）
- **FR6.3** 準備した回復の束は、ふだんの起動の口（`src/claude-session-start.ts`・`src/codex-session-start.ts`）でも 1 回だけ取り出して使う。束が無い時は、今までどおり DB から作る。（`developer-scan.md` の「起動の口が 2 本ある」）
- **FR6.4** 切り直しで頭に入れる量の上限は、ふだんの起動（1,800 トークン・8,192 バイト）と分けて、10,000 トークンにする。（`[arc の材料]` 5「再開用のまとめは数千〜1 万に収める」）
- **FR6.5** 保存が DB に入ってから印を出すので（FR4.1）、最後の応答の取り込み（非同期）より先に新しい会話が束を作ることは起きない。

受入:
- Given 保存と印のある席、When Claude Code の SessionStart が source = `clear` で動くと、Then additionalContext の頭に残した「次の 1 歩」があり、initialUserMessage がある。Codex では additionalContext の頭に同じ物がある。
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

受入:
- Given 止まった原因を再現する見本、When 直した取り込みを流すと、Then 行が入り、同じ入力の 2 回目は重ねて入れない。

### FR9 席に据えて確かめる

- **FR9.1** Claude Code と Codex の両方で、会話の記録の見本を使う試験で「量を測る → 保存して印を出す → 切った後の新しい会話の頭に、残した次の 1 歩が入る」を確かめる。（`[Q4]` の A）
- **FR9.2** 統合の後、Owner の決定を受けて Kusabi 自身の席に据え、実際に切る。切った後の最初の応答が、残した次の 1 歩に触れるかを確かめる。据え付けの前に見張りの `probe` で入力の行・カーソルが入力の頭に出ること・薄い案内文・tmux の条件つきの実行の対応を確かめ、据え付けの後に、使う host ごとに帳面の旧 session_id から前の会話へ戻せるかを 1 回確かめる。（`[Q4]` の C と X、設計監査 F1・F4）
- **FR9.3** 据えた席で、1 歩あたりの量（据える前と後）・切った後の取り違い・Owner の促しの回数を数える。数え方は arc が決めた次のとおり（`[Q4]`、`[arc の材料]` 6、`[arc の直し]` R-03）:
  - 1 歩 = 席の会話の assistant の API 呼び出し 1 回（usage を持つ応答 1 つ。同じ呼び出しの分かれた行は 1 回と数える）。
  - 前後の期間 = 据える前の同じ席の直近 200 歩と、据えた後の最初の 200 歩。
  - 量 = 1 歩あたりの入力（input + cache read + cache write）の中央値と平均。
  - 取り違い = 切り直しの後の最初の 3 応答のうち、(a) 残した次の 1 歩と違う事を始めた、または (b) DB に答えのある事を Owner に聞いた、の回数（切り直し 1 回ごと）。
  - Owner の促しの回数 = 据えた後 200 歩の間に、Owner が「止まってる」「進めて」の類を席に打った回数。
  - 合否の閾値は、測った後に arc が決めて記録する。

## 非機能の要件

- **NFR1** 席の起動と応答を止めない。SessionStart の hook は失敗しても席を起動させ（fail-open）、理由を証拠に残す。Stop の hook の block は 1 つの会話で最大 1 回。hook の期限は今と同じ 9 秒、内部の期限は 7 秒。
- **NFR2** Stop の hook での量の測りは、末尾 4 MiB の読み出しと純粋な計算だけにし、取り込みの重さを増やさない。
- **NFR3** 安全: 見張りは、明示した画面に決まった文字列しか打たない。秘密の値（DB の URL など）を、process の引数・証拠・log に出さない。記憶の中身を外の API に送らない。
- **NFR4** 試験: 変えた行と新しい行の網羅率 100%（team.md）。新しい試験は今の自前の tsx の形で書き、`package.json` の試験の一覧に入れて CI で回す（workflow の file は変えない）。
- **NFR5** DB の作りを変えない。今ある表と列だけを使う。変えが要ると分かったら、その時に止めて arc に知らせる。
- **NFR6** Claude Code と Codex の両方で同じ働きをする。違うのは FR6.1・FR6.2 の返し方だけ。
- **NFR7** 標準 S2〜S5 に従う: 閾値は 1 か所、核は時刻を読まない、「観測できず」を成功に読み替えない、2 例の写しを早く抽象化しない。

## 制約

- 守る物（Owner が決める）: 見張りを席に据えること、席の起動の設定と hook の据え付け、動いている常駐の差し替え、DB の作りの変更、workflow。この PR はコードと試験と設計の文書だけにする。
- 1 単位 = 1 PR。監査は devauditor、統合は suite-lead。
- 新しい外部の依存を足さない。Node 20 以上。
- 見張りは画面への打ち込みに当たる（セキュリティ）。team.md により、見張りは作る前に設計の記録で設計監査を 1 回受ける（FR5.6）。

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
- ほかの製品の範囲。

## まだ決まっていないこと

1. AUN が持つ席で見張りを使うか（SSOT-6 §5「AUN が席を持つ時、Kusabi は再起動しない」）。FR5.5 で設計を直す時に決める。
2. FR9.3 の合否の閾値。測った後に arc が決めて記録する。
