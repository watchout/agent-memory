# 記憶の世界の形（Domain Design）— 設計の案と質問

要件（`inception/requirements-analysis/requirements.md`）・利用者の話（`inception/user-stories/stories.md`）・今のコードの読み解き（`aidlc/spaces/default/codekb/agent-memory/`）・共通基盤 0.2 と 0.3 の正本（onza の main `5beb404`: `docs/common/0.2/architecture.md`・`contract.md`、`common/0.2/sql/001_schema.sql`、`common/0.3/`）から、作る部品の案を出し、owner の判断が要る所だけを聞きます。この段階では部品の境目と、記録の持ち主を決めます。置き方（1 つの process か分けるか）・型・速さの工夫は後の段階で決めます。

## 共通基盤 0.2 から分かったこと（設計の前提）

- 1 つの PostgreSQL の DB に、製品ごとの置き場（`common`・`shirube`・`aun`・`kusabi`・`kodama`・`onza`）を置く。（architecture.md §2）
- 共通基盤が持つのは次のとおり。
  - 所属範囲（`common.scope`）と、主体（`common.principal`）のそこへの所属（`common.membership`）
  - 席（`common.seat`）
  - 席の割り当て（`common.seat_binding`。scope・席・主体・世代つき）
  - DB の利用者と主体の対応（`common.principal_login`）
- 製品の記録は、書いた時点の scope・主体・席・割り当ての参照を持ち、後から書き換えない。（contract.md §2）
- 製品は共通の表を直接書き換えず、共通基盤の確かめの関数を、自分の保存と同じ transaction で呼ぶ。（contract.md §5）
- 本人の確かめは、DB の利用者（`session_user`）からで、渡された値を本人の証拠にしない。（architecture.md §4）
- 製品は、ほかの製品の表を読まない。今の Kusabi は AUN の表を読んでいるが、AUN との連動は範囲の外と決めてある（制約 C-04）ので、新しい置き場ではこの読み出しをやめる。

## 部品の案（聞き直さない所）

| 部品 | 受け持ち | 主な要件 |
|------|----------|----------|
| SeatIdentity | DB の利用者から、共通基盤の席・所属範囲・割り当てを確かめる。登録が無ければ断る | FR1 |
| MemoryRecords | 決定・作業の状態・学びを持ち、仕事の ID・読める範囲の決まりを守る | FR2、NFR2・NFR3・NFR7 |
| Recovery | 起動の時・圧縮の後の回復と、仕事の ID 1 回でまとめて返す束 | FR3、NFR4 |
| Placement | どの DB に置くかを決め、届かない時に逃げない。専用の設定だけを読む | FR5 |
| AccessReport | 置き場所と、実際の DB の権限から作る読み書きできる者の一覧と食い違い | FR6 |
| LegacyMigration | 今の記録の棚卸し・対応表に従う移し・戻す手順 | FR7 |
| ConversationIngest | 会話の記録の伏せ字の処理と取り込み | FR8 |
| ToolSurface | 席に出す MCP の道具と、呼出しの記録（中身を書かない） | NFR1・NFR8 |
| HostAdapters | Claude Code・Codex・Gemini の起動の口 | FR3.1、NFR4 |
| ScenarioHarness | 場面 S1〜S5 の試験と、取り出せる割合の数え方 | FR4 |

- 埋め込み（意味検索）は作らない。今の版の Voyage AI の呼出しは新しい置き場では持たない。（要件の Q4 = C）

## Q1. 顧客の DB に置く時、席の身元をどこで確かめるか

置き場所を顧客の DB にした顧客の席について、席が誰かを確かめる場所を決めます。共通基盤の決まりでは、製品は保存と同じ transaction で共通基盤の確かめの関数を呼びます。

A. 顧客の DB を、その顧客のための 1 つの DB（共通基盤の置き場と Kusabi の置き場の両方を持つ）にする。顧客の仕事をする席は、顧客の DB の共通基盤に登録され、身元も記憶もその DB の中で確かめて保つ
B. 席の身元は自社の DB の共通基盤で確かめ、記憶だけを顧客の DB に書く（身元の確かめと記憶の保存が別の DB になる）
C. Not yet defined（まだ決まっていない）
X. Other (please specify)

（勧め: A。身元の確かめと保存が同じ DB の同じ transaction になり、共通基盤の決まり（contract.md §5）をそのまま守れる。顧客の記録・読み書きできる者の一覧・身元が顧客の DB の中で完結する（制約 C-13・C-15）。B は 2 つの DB をまたぐので、共通基盤の決まりから外れ、自社の DB が止まると顧客の席が書けなくなる。A の負の面は、顧客ごとに席の登録が要ること。最初の版の顧客の DB は自社の機械の顧客役の DB で試す（D-18）。そこに共通基盤の置き場を入れるのは DB の作りの変更なので、owner の決定が要る）

（arc の勧め: A。会話の勧めと同じ。身元の確かめと保存が同じ DB の同じ transaction になり、顧客の記録が顧客の DB の中で完結する = iyasaka-arc#49 6327956142。ただし A は、共通基盤（Suite と OmotenasuAI が共に使う、席と所属の台帳）を顧客ごとの DB にも置く形になる。共通基盤の置き方と DB の作りに関わるので、Owner が決める = rules escalation-policy「DB 設計の変更」）

[Answer]: A（owner がこの会話で答えた）

## Q2. どの DB に置くかを、どこで決めるか

A. 席の起動の設定で、Kusabi 専用の DB の設定を渡す。顧客 Z の仕事をする席には顧客 Z の DB を渡す。Kusabi は「顧客 → 置き場所」の表を持たない
B. 自社の共通基盤の DB の Kusabi の置き場に「顧客 → 置き場所」の表を持ち、Kusabi が起動の時にそれを読んで DB を選ぶ
C. Not yet defined（まだ決まっていない）
X. Other (please specify)

（勧め: A（Q1 = A の時）。顧客の席は顧客の DB の共通基盤にしか登録されないので、設定を間違えて自社の DB を渡しても、登録が無いとして断られる（要件 FR1.2）。間違いが記憶の漏れにならない。B は、自社の DB が顧客の置き場所の一覧を持つことになり、自社の DB が止まると顧客の席が起動できない。一覧（FR6）は、その DB の権限から作れば足りる）

[Answer]: A（arc の下書き。Q1 = A の時の形。顧客の席は顧客の DB の共通基盤にしか登録されないので、設定を間違えても登録が無いとして断られ、記憶が漏れない = 要件 FR1.2。Q1 が B になる時は、この問いも選び直す）

## Q3. 仕事の ID を記録にどう付けるか

A. 席が道具を呼ぶ時に、そのつど仕事の ID を渡す
B. 席の起動の時に、仕事の ID を設定で渡せるようにし、Kusabi がその会話で書く記録に自動で付ける。道具を呼ぶ時に別の ID を渡せば、それを優先する
C. Not yet defined（まだ決まっていない）
X. Other (please specify)

（勧め: B。前の担当が付け忘れると、引き継ぐ席が読めない（要件の前提 AS10）。起動の時に 1 回渡せば、その会話の記録すべてに付く。設定を渡すのは、席を起動する人か配車の席で、AUN との連動は作らない（制約 C-04）。1 つの会話で複数の仕事をする時は、道具を呼ぶ時に別の ID を渡す）

[Answer]: B（arc の下書き。付け忘れると引き継ぐ席が読めない = 要件の前提 AS10。ただし、長く動いて仕事を次々に替える席（arc・suite-lead など）では、起動の時の ID がすぐ古くなる。そうした席は道具を呼ぶたびに ID を渡す。起動の時の ID は、1 つの仕事のために起動した席の既定として使う。設定を渡すのは席を起動する人か配車の席で、AUN との連動は作らない = 制約 C-04）

## Q4. 場面 S1〜S5 の試験を、何で回すか

完了の判定（取り出せる割合 100%）を数える試験の形を決めます。取り出した記録を席の LLM が実際に使うかどうかは、LLM の振る舞いで、自社が管理できる範囲の外です（team.md の Mandated「自社が管理できる範囲の指標」）。

A. 試験の手順が、席の起動の口（Claude Code・Codex・Gemini）と MCP の道具の呼出しを、本物の席と同じ形で再現して回す。数えるのは Kusabi が起動の時の回復の内容と道具の応答に記録を入れて返したか。本物の席での確かめは、席の種類ごとに 1 回ずつ別に行い、証拠として残す（数には入れない）
B. 本物の席（Claude Code・Codex の席を試験用に起動し、Gemini は使い捨ての会話）で回し、数える
C. A で数え、本物の席でも同じ場面を回して、両方 100% を完了の条件にする
D. Not yet defined（まだ決まっていない）
X. Other (please specify)

（勧め: A。数えるのは Kusabi が渡したかどうかで、自社が管理できる。毎回同じ結果になり、人の手を入れずに再現できる（要件 FR4.6・NFR10）。本物の席の確かめで、起動の口が実際の席の道具で動くことも残る。B は LLM の振る舞いが数に入り、同じ準備でも結果が揺れうる）

[Answer]: A（arc の下書き。数えるのは Kusabi が記録を入れて返したかで、自社が管理できる = iyasaka-arc#49 6329643565・要件 Q7 = B の「取り出せた」の決まり。毎回同じ結果になり再現できる = 要件 FR4.6・NFR10。本物の席での確かめのうち Gemini は使い捨ての会話を起こすことになり、それは席の起動なので、その時に Owner の決定を取る）

## Consolidated Summary Confirmation

- 顧客の DB は、その顧客のための 1 つの DB にし、共通基盤の置き場と Kusabi の置き場の両方を持つ。顧客の仕事をする席はその DB の共通基盤に登録され、身元の確かめと記憶の保存を同じ DB の同じ transaction で行う。顧客役の DB に共通基盤の置き場を入れるのは owner の決定の後（Q1 = A）
- どの DB に置くかは、席の起動の設定で Kusabi 専用の DB の設定を渡して決める。Kusabi は「顧客 → 置き場所」の表を持たない。設定を間違えても、その DB に登録の無い席は断られる（Q2 = A）
- 仕事の ID は、起動の時に設定で渡せば、その会話で書く記録に自動で付く。道具を呼ぶ時に別の ID を渡せばそれを優先する。仕事を次々に替える長く動く席（arc・suite-lead など）は、道具を呼ぶたびに ID を渡す（Q3 = B）
- 場面 S1〜S5 の試験は、起動の口と MCP の呼出しを本物の席と同じ形で再現して回し、Kusabi が回復の内容と道具の応答に記録を入れて返したかを数える。本物の席での確かめは種類ごとに 1 回ずつ行い、証拠として残す（数には入れない）。Gemini の使い捨ての会話を起こすのは、その時に owner の決定を取る（Q4 = A）
- 部品は 10 個: SeatIdentity・MemoryRecords・Recovery・Placement・AccessReport・LegacyMigration・ConversationIngest・ToolSurface・HostAdapters・ScenarioHarness。埋め込みは作らず、AUN の表は読まない

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
