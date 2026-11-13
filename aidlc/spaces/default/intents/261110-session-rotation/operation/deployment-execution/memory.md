<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->

- 2026-11-11T08:50:00Z — 版を作る場所を作業場でなく、席の一時 directory の清潔な clone（`aa77b683…` に detach）にした; 版を作る道具が「作業場が清潔で head が `--expected-head` と一致」を要求し、席の作業場は別の branch で記録が未コミットのため。公開の読み戻しには path を書かず `<一時の clone>` とし、実際の path は arc にだけ私信で渡した（公開の repo に絶対 path を書かない決まりと、arc の「path を書く」指示の両立）。
- 2026-11-11T08:50:00Z — 道具の必須の入口の一覧に切り直しの 2 つがまだ無いので、readback の合格に加えて、`dist/` の 3 つの file の実在と SHA-256 を別に確かめた; readback が 2 つを見ないため、合格だけでは欠けに気づけない。
- 2026-11-11T08:50:00Z — arc が写しで S3・S4 の script を試して通った事は、席が自分で再現していないので、smoke-test-results では「arc の報告」として分け、本物の読み戻しが通るまで期待が満たされた証拠に数えない; 完了の根拠を他の席の報告だけにしない決まりのため。
- 2026-11-11T08:50:00Z — この段は S7 まで開いたままにし、S3・S4 の後に席を起こし直す時に今の会話が終わるので、記録と引き継ぎ（`deployment-log.md` の末尾）を先に保存した; 次の会話が `/aidlc --resume` で S5 から続けられるように。
- 2026-11-11T09:08:17Z — Claude Code が hook に渡す入力の key は、会話の起動の仕方（名前の有無・`-p` か対話か・イベント）で変わるので、「2.1.321 の SessionStart の key」を 1 通りに決めず、イベントごとに、名前あり・なしで取り分けた; arc が画面で見た失敗は、名前なしの `-p` では再現せず、名前ありで初めて再現した。席の会話の名前は記録の 1 行目（SessionStart の結果は 8 行目）にあり、起動の時から付いている。
- 2026-11-11T09:08:17Z — key の名前を取る probe は、値を一切書かない形（key の名前・型・文字列の長さ・許可リストとの突き合わせの真偽だけ）にし、UserPromptSubmit の hook で入力を止めてモデルを呼ばない回を先に流した; arc の「値は残さない」の指示と、費用を最小にするため。Stop の key を取る 3 回目だけ、止めずに haiku で 1 往復した（約 0.0033 USD）。
- 2026-11-11T09:08:17Z — 「Stop の hook は今も動いている」という arc の連絡は、起動して終了 0 になる事の観測と読み、parse が受理しているかの観測とは別に扱った; 同じ parser が probe の key の組を拒否し、拒否の時は通す（PASS）作りなので、起動していても何も評価されない形があり得る。席の実際の入力は取れていないので、「同じなら」と限定して書いた。
- 2026-11-11T09:12:52Z — arc の「A で進める」を、席の判断でなく arc の判断（Owner の言葉ではなく、GitHub にも未記録）として記録に書き、評価の元にしない; 入力検証・契約に触れる決定は、公開された決定だけを権限とする決まりと、escalation-policy の「セキュリティに関わる設計変更」のため。Owner/arc-sec の確認と GitHub への記録は arc が持つ。
- 2026-11-11T09:12:52Z — 「証拠に無視した key の名前を記録する」は v1 の証拠 schema（`additionalProperties: false`）に触れると見て、実装に入る前に arc に聞いた; 契約の .v2 は保護面で、席が決めない。
- 2026-11-11T09:16:06Z — 段を戻すのに、team.md の `jump reopen` でなく `jump execute --direction backward` を使った（arc の指示）; reopen は単位ごとの command で、単位の無い express の取り組みでは満たせず、Operation から Construction への phase をまたぐ戻りには使えないため。席が単位の名前を作って流すことはしなかった。team.md の「止まった時の手順」は、単位の無い取り組みの時は `jump execute` と書き足す必要がある（次に team.md を直す時の候補。席は直接直さない）。
- 2026-11-11T23:20:43Z — 第 2 回の実行では、S0・S2 を読み取りだけで再確認し（書き込み 0）、第 1 回の実物の記録は書き換えず「第 2 回の実行」の節を足した; 第 1 回の S0 の Owner の決定・S2 の停止は有効なままで、やり直しは不要なため。
- 2026-11-11T23:20:43Z — S3・S4 の差し替えは、条件（arc-sec の第 2 版の手順の読み直し O12）が満たされるまで、席が実行も準備の書き込みもしない; 席は設定を書かない決まりで、実行の主体は Owner が打つ arc の script。待ち中に成果物を作らず、記録と diary を保存して止まる。
- 2026-11-12T02:28:14Z — arc の依頼の「hook が書いた証拠の file」を、診断の記録の 3 file と読み、SessionStart の証拠の JSON（`input_valid`・`store_binding`・`auto_receive`・`forbidden_effects`）は file でなく stderr だけに出る作りだと確かめた（runtime event はこの席の hook の引数に manifest が無く無効）; 依頼は「会話の記録の jsonl から抜き出さない」と読み先を絞っていたので、席が読み先を広げず（jsonl も DB も読まず）、取れた物を「直接」「推論」「観測できず」に分けて書いた。
- 2026-11-12T02:28:14Z — `RECOVERY_UNAVAILABLE` が消えたことを、届いた `additionalContext` から推論で言った; degraded の出力は `systemMessage` だけで `hookSpecificOutput` を持たないコードを読んで根拠にした。ただし `full` と `degraded`／`EVIDENCE_LOG_UNAVAILABLE` は区別できないので、`outcome: full` とは書かなかった。
- 2026-11-12T02:28:14Z — SessionStart の証拠の `forbidden_effects` は `forbiddenEffects()` が 0 を固定で返す定数なので、読めても実測にならない。C2 の表の「副作用」を証拠の値だけで合格にしない（S5）。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-11-11T08:50:00Z — 段の手順の AWS の身元の確かめ（`aws sts get-caller-identity`）と環境の一覧（environment-inventory）の読み込みを行わなかった; この配備は AWS を使わず、新しい環境も作らず（この Mac の Kusabi の席 1 つ）、express の取り組みで環境の用意の段を省いているため。
- 2026-11-11T09:08:17Z — arc の依頼 1 の「別の claude を 1 回起こす」を 3 回にした; 1 回目（名前なし）では失敗が再現せず、名前ありの 2 回目で `session_title` が出て、Stop の key は入力を止めない 3 回目でしか取れなかったため。3 回とも作業場の外の一時 dir で、席の設定・ユーザーの設定は読まず、費用は 3 回目だけ（約 0.0033 USD）。
- 2026-11-11T09:08:17Z — S5・S6 を起こさず、S7 に進まなかった（段の手順の「配備を実行する」より優先した）; arc の指示（SessionStart が続きを渡せない間は切り直しの試しが成り立たない）に従い、直しの決定を待つ。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-11-11T09:08:17Z — parser の直しの 2 案（知らない key を無視する／名指しで足す）のうち、無視する案を勧める; 名指しは今回すでに 2.1.220 から 2.1.321 の間に 1 回外れた形で、次の更新で同じ事が起きる。対して無視する案は、必須の key と型の確かめを残す限り、読む値が増えない。ただし入力の検証を緩める設計の変更なので、決めるのは席ではない（escalation-policy）。

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-11-11T09:30:26Z — 解決: 下の「無視した key の名前の置き場」は、arc の判断（agent-memory#339 の comment 6791901034）で、証拠の契約に足さず、契約ではない診断の記録（`$AGENT_MEMORY_HOME` の下、名前・件数・時刻だけ）に決まった。段は `jump execute` で code-generation に戻した（`stages_reset` = code-generation・build-and-test・deployment-pipeline・deployment-execution）。直しの設計は code-generation の `hook-input-design.md`。
- 2026-11-11T09:12:52Z — 無視した key の名前の置き場: 既存の v1 の証拠 schema に optional 項目を足すか、.v2 にするか、証拠には足さず別の場所（試験の中でだけ確かめる、または件数だけ）にするか。arc に聞いた。
- 2026-11-11T09:08:17Z — 席の対話の起動での SessionStart・Stop・UserPromptSubmit の入力の key の全部は、まだ取れていない（`-p` の probe だけ）。直しの後の C2 の取り直しで、証拠が `input_valid: true` になるかで確かめる。
- 2026-11-11T09:08:17Z — Stop の取り込みの hook が付く設定は `async: true`。拒否されて通した時に、証拠はどこにも残らないのか（stderr は非同期の hook では見えない）。直しの後に、取り込みの件数が 0 から増えるかで確かめる。
- 2026-11-11T23:20:43Z — arc-sec の読み直し（O12）の完了と、Owner が script を打つ時機（席が手すきの時）。打った後、arc が席を起こし直し、この会話は終わる。次の会話が C2 の取り直しと S5〜S7 を行う。
- 2026-11-12T00:57:35Z — 解決: arc-sec の読み直し（O12）は済み（iyasaka-arc#57 の comment 6811122140、止める点 0、本文 SHA-256 e84e8b7b…8787f を席が取り直して一致）。残る条件は席が手すきであることと Owner の操作。arc の注記 3 により S1 のやり直しの読み戻しを #339 に出す必要があるが、投稿は前に権限の判定が拒否したので繰り返さず、本文（issue-339-readback-s1-redo.md）を用意して S3 の読み戻しと一緒に出す（arc の指示）。
- 2026-11-12T02:28:14Z — C2 の表の 4 項目（`outcome` が `full` か、`auto_receive.status`、`store_binding` の値、SessionStart の `forbidden_effects`）の読み先: (a) 会話の記録の SessionStart の hook の結果 1 行を、残す key を決めた script で読む（席の勧め。第 3 回と同じ道）、(b) 人が画面の文を見て答える（`outcome` の区別だけ）、(c) 品質ログ（`recovery_quality_log`）の 1 行を READ ONLY で読む（`store_binding` は入らない）。arc に伺う。将来、証拠を file にも書く設計にする案は、契約（証拠の .v2）に触れるので席は決めない。
- 2026-11-12T02:28:14Z — 取り込みの件数の増減は、DB を読む許可が要る（arc に伺う項目と一緒に）。
- 2026-11-12T02:38:00Z — arc の (c)（品質ログの 1 行を READ ONLY で読む）を流したところ、席の柵（auto mode の判定「Production Reads」）が拒否した; 回避せず、再試行せず、arc に代わりに流してもらうこともしない（拒否された操作を他の席に頼むと、柵の判断を迂回する）。`auto_receive.status` は観測できないまま記録し、Owner の判断に回したが、その後 arc が合格の条件から外す判断をした（次の行）。arc が済ませた画面の観測（`outcome`）と別の道の結びつきの値（`store_binding`）は、「arc の観測」と書いて足し、席が見た値とは書いていない。
- 2026-11-12T02:55:00Z — arc の指示で、引き継ぎの確定の順番の直しの設計の記録の下書きを `handoff-commit-order-design-draft.md` に書いた（code は書いていない）; 採った案 = 消費と確認の印を出力の書き込みの後へ移す（A）。採らなかった代替 = 消費の取り消しの verb を足す（B）、DB に列を足す（C。保護面）、消費を出力の直前に寄せる（D。窓が残る）。出す入れ物（reopen か新しい bugfix の取り組みか）は engine と arc の判断を待つ（席が順を決めない）。commit・push・PR は出していない。
- 2026-11-12T02:40:00Z — arc の判断（Owner の委任 iyasaka-arc#49 6762288830 の技術の範囲。Owner の言葉ではない）で、`auto_receive.status` を C2 の合格の条件から外した; 採った判断 = 「続きの案内（`wasurezu-recovery-pack/v1`）が会話の文脈に実際に届いた」事実の観測で置き換える（pack ref の時刻 11:22:42.288 JST と診断の記録の更新 11:22:42.333 JST の一致、差 45 ミリ秒）。採らなかった代替 = 本番の DB の品質ログを読む／Owner に端末で流してもらう。値は観測できていないので、「値を観測した」とは書かず、「置き換えた合格」と書く（S5）。外れは `cd-config.md` の C2 の表の直下に 1 行ずつ書いた。C2（第 4 回）は合格と記録。
- 2026-11-12T02:38:00Z — `outcome: full` の記録は、コードで「`EVIDENCE_LOG_UNAVAILABLE` を作る箇所が 1 つで、必ず `systemMessage` を足す」ことを確かめたうえでの推論（arc の画面の観測 + コード）。hook の証拠の値を読めていないので、読めたとは書かない。
- 2026-11-12T02:30:00Z — この会話の Stop の診断は、最初の応答が終わった後に取り直した: 11:28:59 JST に 2 つの Stop の file が更新され、Stop の件数が 6 になった（落とした名前 0・不正な名前 0）。arc には 1 通で送った後なので、追加の連絡はせず、arc の返事への答えに含める。
