# 配備の道筋の問い — 会話の切り直し（261110-session-rotation）

切り直しのコードは main に入りました（PR #341、統合の commit `aa77b683e135beabb9fc54bd3736b47d288d6f46`）。まだどの席にも据えていません。この段は、据え方の設計と記録だけを書き、何も実行しません。

前の段までに決まっていて、聞き直さないこと:
- 配り方は、席の束ごとに R1 → R2 → R3 の順で、各束はすべての席が健全と観測されてから次へ進み、失敗した束は設定を元に戻す（`aidlc/spaces/default/memory/team.md` の Deployment）。
- 席の起動・展開・資格情報・本番 DB への書き込みは守る物で、Owner の決定（GitHub に publish）と arc-sec の確かめが先にある。
- 据え付けは、この取り組みの要件 FR9.2（Kusabi 自身の席で実際に切って確かめる）と FR9.3（据えた席の測り）が受け持つ。
- DB の表の作りは変えない。

聞くのは、まだ決まっていない次の 5 つだけです。答えは、問いの文脈を Owner の言葉で聞いた結果を、そのまま `[Answer]:` に写します。

---

## Q1. [Owner] 最初に据える範囲

背景: 据えるのは 4 つです。(1) 席ごとの起動の script を見張りの設定に登録する、(2) 見張りを起こす、(3) 席の hook を切り直しの入った新しい版に替える、(4) 取り込みの古い常駐を止める。どれも席の起動・展開に当たります。一度に全席へ広げず、1 つの席で試して結果を見てから広げることもできます。

A. 最初は Kusabi 自身の席だけに、4 つをそろえて据え、実際に 1 回切り直して確かめる。ほかの席は、その結果を見てから席ごとに決める。
B. 最初から複数の席に据える（席の一覧は Other に書く）。
C. 今は据えない（コードは main に入れたままにする）。
X. Other (please specify)

[Answer]: いい（Owner の言葉、原文。arc の端末の会話。記録は arc の comment https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6790645694 、本文の SHA-256 6626a95dcafbaac9c6155d2801a466f5fb55090f5200c74ef88083afec5aa5d8 。当て方: Q1 = A、最初に据えるのは Kusabi 自身の席（tmux aidlc-kusabi）だけ。ほかの席は結果を見てから席ごとに決める）
**Mode:** chat

---

## Q2. [Owner] 見張りの動かし方と、残る危険

背景: 見張りは LLM を使わない小さな script です。席が手すきで、入力欄が空で、人が触っていないと観測できた時だけ、席の画面にキーを一切送らずに、席の起動し直しを tmux に頼みます。次の損失は、無くせません（席に誤った文が届くことはありません）:
- 書きかけが消える: 席の入力欄に文を打ちかけて送る前に切り直しが起きると、その書きかけは新しい会話に引き継がれません。
- 作業が途中で切れる: 見張りが確かめた後に届いた入力（中継の行など）で席が応答を始めていると、その応答が途中で終わります。
- 別の process が終わる: 確かめと実行の間に、席の前面の process が替わっていると、それが終わります。
- 最後の応答の取り込みが欠ける: 引き継ぎの保存は印より前に DB に入るので失われません。欠けうるのは最後の応答の取り込みだけです。
- 新しい会話が起きない: 起動の script が失敗すると、席が止まります。人が起こします。

A. tmux の窓で見張りを動かす。止め方は、停止の印の file を置く／見張りの設定からその席を消す／hook の引数で切り直しを止める。上の残る危険を受ける。
B. launchd の常駐として動かす。止め方は A と同じに、job の停止を足す。上の残る危険を受ける。
C. 残る危険を受けないので、見張りを使わない（hook が「切ってよい」の印を出すだけにして、起動し直しは人が行う）。
X. Other (please specify)

[Answer]: いい（Owner の言葉、原文。同じ comment。当て方: Q2 = A、見張りは tmux の窓で動かす（LLM なし）。止め方は停止の印の file（ほかに、設定から席を消す・hook の引数で --rotation off）。残る危険 R-A〜R-E を受け入れる）
**Mode:** chat

---

## Q3. [Owner] 席の hook の差し替え

背景: 席の hook は今、古い版を指しています。切り直しの hook（Stop・SessionStart・UserPromptSubmit の新しい版）を使うには、切り直しが入った版を指す必要があります。前に出した案（#339 の `seat-runtime-swap-plan:v1`）は、切り直しが入る前の版（`17676d84`）から作る前提でした。対象は約 35 の作業場の設定、参照 105 か所で、DB は変えません。

A. 切り直しが入った版（統合の commit `aa77b683` 以後）から作り直した案 v2 で、Kusabi 自身の席だけを替える。全体へ広げるかは、結果を見てから決める。
B. 案 v1 のまま（切り直しの入っていない版から）、全席の古い参照を替える。切り直しは使えない。
C. 見送る。
X. Other (please specify)

[Answer]: いい（Owner の言葉、原文。同じ comment。当て方: Q3 = A、切り直しが入った版（aa77b683 以後）から作る案 v2 で、Kusabi の席だけ。戻し方つき、DB は変えない）
**Mode:** chat

---

## Q4. [Owner] 取り込みの古い常駐

背景: 会話の取り込みの常駐（launchd の job）は、main に無い古い build を動かしていて、`recordRawEvent is not a function` を出して落ち続けています。誤りの記録の file は約 110 MB で増え続け、DB の会話の取り込みは DB の再起動（11-02）以後 0 件です。止めるのは展開に当たります。取り込みそのものの直し（席の hook に DB の指定を渡す、溜まった分を取り込む）は、止めるかどうかとは別に決めます。

A. 古い常駐を止めて無効にする（設定の file と古い build は消さない。戻す時は有効に戻す）。誤りの記録の増加が止まったことを読み戻す。
B. 今は止めない。
X. Other (please specify)

[Answer]: いい（Owner の言葉、原文。同じ comment。当て方: Q4 = A、落ち続けている取り込みの古い常駐（launchd）を止める。設定と古い build は残す（消さない））
**Mode:** chat

---

## Q5. [配備の担当] 差し替えの道具と、版の確かめ

背景: 席の hook の差し替えには、2 つの道具の案があります。既にある展開の道具（`kusabi:direct-fleet-rollout`。束ごとに適用して読み戻す）と、前の案 v1 の参照の置き換え（新しい手順の script を作る）。また、中身の決まった版を作る道具の「必須の入口の一覧」に、切り直しの 2 つの入口（`dist/session-rotation-stop.js`・`dist/rotation-watcher.js`）がまだ載っていません。版の中身には入りますが、欠けても読み戻しで気づけません。一覧を直すのは、展開の道具の変更になります。

A. 既にある展開の道具を使い、必須の入口の一覧に 2 つを足す（据え付けの段の PR に入れ、独立の監査を通す）。
B. 前の案 v1 の参照の置き換えを新しい script にして使い、一覧に 2 つを足す（同上）。
C. 道具は今のまま、一覧に足さない（欠けの確かめは据え付けの時の手の確かめにする）。
X. Other (please specify)

[Answer]: A（arc の答え。Owner の委任 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6762288830 。Owner の言葉ではない。守る物ではないので Owner には回さない。既にある kusabi:direct-fleet-rollout を使い、必須の入口の一覧（版を作る道具と rollout の両方）に dist/session-rotation-stop.js と dist/rotation-watcher.js を足す。repo の code の変更なので、この取り組みの次の PR で独立の監査を通す）
**Mode:** chat

---

## 第 2 回の据え付けで足す問い（2026-11-12）

PR #342（統合の commit `94f1ca6d0042bd970d4cc7c4ab9ce9153b7d5c0d`）が入り、版は `28596bf0915d16b72bd7b5878aadda6ebe7efd7564b6520d0f938eb668e7cd92` を作り直しました（実行の記録 `deployment-log.md` の S1 のやり直し）。席の設定には、Kusabi の hook が 5 つ（SessionStart 1・Stop 2・UserPromptSubmit 2）が旧い版 `1b731f00…` と版つきの node の path を指して入っています。第 2 回は「新しく入れる」でなく「新しい版へ差し替える」になります。範囲（Kusabi の席だけ）・戻し方つき・DB を変えない点は、Owner の決定（Q1・Q3 = A、#49 6790645694）のままで、聞き直しません。決まっていない次の 2 点だけを聞きます。守る物ではない技術の問いなので、Owner の委任（#49 6762288830）の下で arc に聞きます。

---

## Q6. [配備の担当] 差し替える hook の node の path

背景: installer は、hook の command の先頭に node の path を書きます。指定が無いと、installer を動かした node の実体の path（版つきの Homebrew の folder）を書くので、node を入れ替えると、その hook は黙って起動できなくなります（登録された作業場の hook は、今それで動いていません）。#342 で installer に `--node-path` が入り（既定は今の動きのまま）、絶対 path・正規化済み・最後の名前が `node`・実行できる通常の file（symlink 可）だけを受け付けます。この Mac の Homebrew の `/opt/homebrew/bin/node` は、今の版つきの node への symlink です。前の回の arc の判断（O11）は、「この試しは今の実体の path のまま。`--node-path` は次の PR で足す」でした。

A. 前の回のまま、`--node-path` を付けない（実体の path を書く。node の入れ替えで壊れる）。
B. 差し替えで `--node-path` に版に依らない symlink（`/opt/homebrew/bin/node`）を指定する（node を入れ替えても hook は壊れない。symlink の先を同じ利用者が付け替えられる点は、同じ利用者の悪意を防げない既存の限界の内）。
X. Other (please specify)

[Answer]: B（arc の答え。Owner の委任 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6762288830 。Owner の言葉ではない。守る物ではないので Owner には回さない。`--node-path /opt/homebrew/bin/node` を使い、#342 で入った FR10.7 で、node の入れ替えで hook が黙って壊れないようにする。arc の席間の連絡。GitHub への記録はまだ無い）
**Mode:** chat

---

## Q7. [配備の担当] 差し替えの操作の分け方

背景: 切り直しの hook は、`--rotation` を付けない適用では「今あるものをそのまま残す」仕様です（コードで確かめた）。取り込みの hook 3 つだけを新しい版へ替えると、切り直しの hook 2 つは旧い版 `1b731f00…` のままです（旧い版は新しい key を拒否して「通す + 診断の証拠」になるだけで、席は止まりません）。前の回は、S3（取り込み）と S4（切り直し）を別々の操作・別々の backup にして、読み戻しが通ってから進めました。

A. 前の回と同じに、2 つの操作にする。S3 の差し替え（`--rotation` なし。取り込みの 3 つ）→ 読み戻し → S4 の差し替え（`--rotation on --rotation-threshold-tokens 240000`。切り直しの 2 つ）→ 読み戻し。backup は 2 つ。途中に、取り込みは新しい版・切り直しは旧い版の状態がある。
B. 1 つの操作にする。`--apply --rotation on --rotation-threshold-tokens 240000` で 5 つを一度に新しい版へ替える。backup は 1 つ。途中の混在がない代わりに、読み戻しの失敗の時は 5 つ全部を戻す。
X. Other (please specify)

[Answer]: B（arc の答え。Owner の委任 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6762288830 。Owner の言葉ではない。1 回で 5 つを替える: `--apply --rotation on --rotation-threshold-tokens 240000`。途中で新旧が混ざらず、backup は 1 つ。arc は Owner が打つ script を、この形に直して席の今の settings.json の写しで流した: dry-run 1 回（`would_change: true`、無関係 3・3）→ apply → 差分は Kusabi の hook の入れ替えだけ → check exact → 5 つとも `/opt/homebrew/bin/node` → 前の版 `1b731f00` を指す hook 0・新しい版 `28596bf0` が 5。席が script の本文を読んで、同文であることを確かめた: script の SHA-256 `541b4fef2db5dcc51d8ef4c440e7a0f816facb9de94c1007df45ac011d8dd6a7`。arc の席間の連絡。GitHub への記録はまだ無い）
**Mode:** chat

---

## 第 3 回の据え付けで足す事項（2026-11-13）

第 2 回の後、取り組みの construction へ戻って #344（統合の commit `ffe511e5ec655078dba631997397b371d55131ac`）が入り、Build and Test が済みました。Owner の新しい決定が出ました。この段の第 3 版は、この決定と arc の依頼に合わせて書き直しました。

### Owner の決定（原文。聞き直さない）

- `OD-KUSABI-ROTATION-REDEPLOY-A-TO-D-PLUS-CODEX-SEAT-20261113-001`: https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6847683704 （投稿者 watchout、2026-11-13T08:12:10Z、本文の SHA-256 `d2749ed886a695d92f67410057cd2c53888550edd3cfd96a5ab843bf09932e5c`。席が GitHub の API が返す本文で数えて一致を確かめた）。
- Owner の言葉（原文）: 「a-dでよい。kusabiだけの影響ならすぐやれ。codexも対応してテストするんだろ？それもやれ」。
- 決定の中身: (a) #344 の統合の commit から、中身の決まった版を別の清潔な copy で作り直す、(c) 戻した後に旧い見張りが新しい記録を読めるかを使い捨ての場所で確かめる、は席が進める。(b) 旧い見張りを止める → 席の hook を新しい版へ差し替える → 新しい見張りを起こす、(d) 席を起こし直して切り直しを実際に 1 回試す、は arc が script を作り、arc-sec が読み、Owner が打つ（打つことが承認）。範囲は Kusabi の Claude Code の席（tmux `aidlc-kusabi`）に、Kusabi の Codex の席（tmux `kusabi`）を足す。DB の構造・ほかの席・本番には触れない。

### Q8. [配備の担当] Codex の席の差し替えを、Claude の席と同じ 1 つの script にするか、2 つにするか

arc の依頼（席間の連絡。arc の技術の依頼で、Owner の言葉ではない。GitHub への記録はまだ無い）は、Codex の席を Claude の席と同じ 1 つの script で当てるか、2 つ目の script にするかを、この段の記録の中で席が決めること。

A. 1 つの script で、Claude の席の設定と Codex の席の設定を続けて替える。
B. 2 つの script にする。Claude の席の script を先に打ち、読み戻しと席の起こし直しの確かめが済んでから、Codex の席の script を打つ。

[Answer]: B（席が決めた技術の判断。arc の依頼による。守る物の判断（Owner の決定）ではないので Owner には回さない。arc が script を作る時に変えてよい。理由は `cd-config.md` の「Codex の席」の節。要点: (1) 書き換える file・席・再起動・信頼の確認が別で、失敗の形が違う。(2) 読み戻しの失敗で戻す範囲を、その席の file だけにできる。(3) Codex には、Claude にない前提（起動の script が無い・続きの最初の入力が無い・hook の信頼の確認・host の process の確かめ）が残っていて、その結果が出る前に Claude の席の確かめを止めたくない。(4) Owner の「打つこと」が承認の単位なので、席ごとに分けた方が、打つ前に読む範囲が小さい）
**Mode:** chat

### arc の答え（第 3 回。arc の技術の判断。Owner の委任 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6762288830 の技術の範囲で、Owner の言葉ではない）

- Q8 の分け方は、arc の分け方で置き換わった: 1 本目の script = Claude の席の hook の差し替え（A）＋見張りの設定の file と起動（S5・S6。Claude の席だけ）＋Codex の席の `hooks.json` だけの差し替え（B。見張りには足さない）。2 本目の script = Claude の席の実際の切り直しが済んだ後の、Codex の席の起こし直し。上の Q8 の [Answer] の本文は、席が先に勧めた形の記録として残す。[訂正 2026-11-13] この分け方も前の案。今の分けは `cd-config.md` の「第 3 版の実行の順と関門 O25」の節: 1 本目（`install3.sh`）は A → B だけ、Claude の席の起こし直しは arc、関門 O25・S5・停止の印の確かめ・S6 は 2 本目。Codex の席の起こし直しの script の呼び方は arc が決める。
- O13: Codex の起動の script は arc が `~/Developer/arc/tools/seat-launchers/start-kusabi-codex.sh` に作った（SHA-256 `09f8c869…00b0`、権限 700）。起こし直しは `tmux respawn-pane -k` の形。見張りの `launch_script` への登録は、Codex の席を足す時。
- O14: 固定の最初の入力を持たせる（現行の文に 1 文を足す）。文面は arc の file の中。
- O17: Codex の閾値は 200000（窓 258400 の約 77%）。Claude の席は 240000 のまま。実際の切り直しの後に見直す。
- O20: S5・S6 は Owner の script の中。probe は席が先に流す（流した: O22・O23）。
- O21: 閾値に自然に届くのを待つ。閾値を一時に下げる操作は足さない。席が観測して記録する。
- 順: 1 本目を打ち、Claude の席の実際の切り直しを確かめた後に 2 本目を打つ。[訂正 2026-11-13] 前の案。今は、1 本目の後に arc が Claude の席を起こし直し、最初のターンの後に 2 本目（関門 O25・S5・S6）を打つ。Codex の席の起こし直しの script は、Claude の席の実際の切り直しの後（呼び方は arc が決める。[訂正 2026-11-14] 答えが出た: Owner が打つ script ではなく、人が行う別の段。`cd-config.md` の「script の分け」）。

### 席から arc への補足（問いではない。事実の報告。第 3 回）

- 旧い見張りは今どこにも動いていない（`ps` に rotation-watcher が無く、見張りの設定・記録・停止の印の file が 1 つも無い。S5・S6 は第 1・2 回で起こしていない）。そのため (b) の「旧い見張りを止める」は、止める物が無い。新しい見張りを初めて起こす形になる。「見張りと hook を同じ版で同時に替える」という arc の判断は、そのまま守れる（hook を新しい版に替えて確かめた後にだけ、見張りに席を登録する）。
- Codex の席の tmux の起動 command が指す script（`/tmp/codex-leads-restart-20261016/` の下）は、今は存在しない。見張りの切り直しは、その起動 command をそのまま流して席を起こし直すので、このままでは Codex の席は切り直しで起きない。席の起動の script を作り直すのは arc の仕事なので、前提として arc に渡す（`cd-config.md` の「Codex の席」）。
- probe の結果（読み取りだけ。第 3 回）: Claude の席の入力欄は `❯` の直後が NO-BREAK SPACE のため、見張りの設定の `prompt_markers` は `❯` と NO-BREAK SPACE の 2 文字にする（O22）。Codex の席の画面では、入力欄の下に枠線でない行が 2 つあり、今の入力欄の判定が通らない（O23）。そのため、Codex の席を見張りに足す手順は 2 本目の script の下書きに入れず、arc の判断を待つ。[訂正 2026-11-13] 「2 本目」の呼び方は替わった（上の Q8 の分けの訂正）。見張りに足さないことは変わらない。
- 訂正: 見張りの非進捗の上限は 30 周（poll 5 秒）で、席が前に送った「既定 3」は誤り。

### arc の答え（2026-11-13、席間の連絡。arc の技術の判断で、Owner の言葉ではない。GitHub への記録はまだ無い） — O23・O25・script の担当

- O23: Codex の席を見張りに足すのは、見張りの入力欄の判定を Codex の画面に合わせる code の変更の後。新しい小さい単位（bugfix、Kusabi の repo の code、守る物には触れない）として、この取り組みの配る段の後に立てる。それまでは B（Codex の `hooks.json` の差し替え、閾値 200000）だけを入れる。Codex の席の切り直しは、hook が印を置いたのを席か arc が見て、人（arc）が起動の script で起こし直す。
- O25: 関門 (a)(b) の形でよい。`changed_hook_requires_operator_review` の確認の画面は Owner が押す、と script の出力に書く。[訂正 2026-11-13] (a)(b) の中身は、`cd-config.md` の「第 3 版の実行の順と関門 O25」に書いた（arc の連絡で決まった）。
- script: arc が書く（席の下書きは、席の柵に拒否されて書けなかった）。1 本目の中身 = A → B → Claude の席を起こし直す（Owner の確認の画面）→ 関門 → S5 → 停止の印の確かめ → 印の file が無いことの確かめ → S6。足りない値は `cd-config.md` から読む。[訂正 2026-11-13] 前の案: 1 本目の中身を A から S6 までの 1 本に書いた。今は 1 本目（`install3.sh`）が A → B だけ、起こし直しは arc、関門・S5・停止の印の確かめ・印の file が無いことの確かめ・S6 は 2 本目（arc の連絡。arc が書き、arc-sec が読む）。順は同じ。
