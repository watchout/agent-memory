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
