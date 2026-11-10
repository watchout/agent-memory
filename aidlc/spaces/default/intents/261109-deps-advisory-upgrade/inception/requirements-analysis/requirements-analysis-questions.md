# 要件の分析 — 質問

今のコードの読み解き（`inception/reverse-engineering/developer-scan.md`、`aidlc/spaces/default/codekb/agent-memory/`）と、依存の点検を受けて、要件を書く前に Owner の判断が要る所だけを聞きます。点検は 2026-11-09 に、`npm audit --omit=dev` と `npm audit fix --dry-run` で行いました。版上げは、この作業場の外に置いた写しの上で試しただけで、repo のファイルは変えていません。

勧告の中身（番号・重さ・内容）は書きません。この repo は公開なので、Issue #339 のとおり、部品の名前と版だけを書きます。詳しい判定は arc-sec の非公開の記録（ARCSEC-DEP-AUDIT-RUN-20261109-001）にあります。

## 決まっていること（聞き直さない）

- この取り組みは、Issue #339 の本番の依存の版上げだけです。新しい機能は作らず、DB の構造・workflow・資格情報には触れません（OD-KUSABI-DEPS-UPGRADE-ONLY-UNIT-20261109-001、#339 の comment 6729538122）。
- 直す先の版は、`npm audit fix --dry-run` と各勧告の直った版で決めます。範囲指定（`^`）はやめて、版を固定します（同じ決定と arc の依頼）。
- 1 単位 = 1 PR です。独立の監査（devauditor）、作者の受領、必須の検査、作者と別の席（suite-lead）の統合は今までどおりです。
- 開発用の部品（tsx の下の esbuild）にも勧告が出ていますが、本番の依存ではないので、この取り組みには入れません。

## 点検で分かったこと

直す版はどれも、今の package.json の範囲の中にあります。`npm audit fix` は package.json を変えず、package-lock.json だけを変えました。直した後の `npm audit --omit=dev` は 0 件でした。

| 部品 | 本番の依存での立場 | 今の版 | 直る版 |
|------|--------------------|--------|--------|
| @modelcontextprotocol/sdk | 直接（宣言 `^1.12.1`） | 1.28.0 | 1.32.2 |
| uuid | 直接（宣言 `^11.1.0`） | 11.1.0 | 11.1.1 |
| zod | 宣言なし（src/index.ts が直接読み込み、SDK の下で入る） | 4.3.6 | 4.6.7 |
| hono | SDK の下 | 4.12.9 | 4.13.17 |
| @hono/node-server | SDK の下 | 1.19.11 | 2.1.6（大きい版の上げ。Node 20 以上が要る） |
| express-rate-limit | SDK の下 | 8.3.1 | 8.7.3 |
| ip-address | express-rate-limit の下 | 10.1.0 | 10.7.6 |
| body-parser | SDK の下の express の下 | 2.2.2 | 2.4.0 |
| proxy-addr | SDK の下の express の下 | 2.0.7 | 2.0.8 |
| qs | express・body-parser の下 | 6.15.0 | 6.17.1 |
| fast-uri | SDK の下の ajv の下 | 3.1.2 | 3.1.9 |

- このほか、勧告の無い小さな部品が 8 つ、同時に上がります（es-object-atoms・hasown・iconv-lite・side-channel・side-channel-list・type-is、content-type の 2 か所）。
- 本番の server は MCP の stdio だけを使います。SDK の HTTP の部品（express・hono など）は、本番では読み込まれません。
- 席を動かすこの Mac の Node は 26 です。package.json には「Node 18 以上で動く」と書いてあり、CI は Node 18・20・22 で型検査・ビルド・試験を回しています。

## Q1. [製品の持ち主] uuid もこの PR で上げるか

Issue #339 の「当たる部品」は、SDK とその下の HTTP 系の部品、そして zod です。点検では、それとは別に、Kusabi が自分で使う uuid（席の状態の写しに ID を付ける所）にも既知の勧告が出ていました。uuid は Issue の一覧に名前がありません。

場面の例: この PR が統合された後に、arc-sec が本番の依存をもう一度点検した時、uuid の勧告が残っているかどうか。

A. uuid もこの PR で上げる（統合の後の点検で、本番の依存の勧告は 0 件になる）
B. Issue に名前がある部品だけを上げ、uuid は別の Issue にする（統合の後の点検で、uuid の分が残る）
X. Other (please specify)

[Answer]: A（uuid もこの PR で上げる）（Owner がこの会話で答えた）

## Q2. [開発者] zod を本番の依存として package.json に書くか

Kusabi の道具は、受け取った入力を zod で確かめています（src/index.ts の 4 行目で直接読み込む）。ところが package.json には zod が書いてなく、SDK が連れてくる zod をそのまま使っています。

場面の例: 後で SDK の版を上げた時、SDK が連れてくる zod の版が変わると、Kusabi の入力の確かめに使う zod の版も、気づかないうちに変わる。書いておけば、Kusabi が使う zod の版は package.json を見れば分かる。

A. zod を本番の依存として package.json に書き、直る版で固定する
B. 書かずに、SDK が連れてくる zod を使い続ける（版は package-lock.json で決まる）
X. Other (please specify)

[Answer]: A（zod を本番の依存として書き、直る版で固定）（Owner がこの会話で答えた）

## Q3. [開発者] どの依存の範囲指定（`^`）をやめて固定するか

今の package.json は、依存の版を「1.12.1 以上の 1 系」のような範囲で書いています（`^`）。実際に入る版は package-lock.json が決めますが、誰かが依存を入れ直して lock を作り直すと、範囲の中の新しい版が、確かめないまま入ります。SDK の下の部品（hono など）は package.json に書く物ではなく、package-lock.json で版が決まります。

場面の例: 次に別の部品を足すために依存を入れ直した時、SDK が 1.33 に上がって lock に入り、PR の差分に SDK の変化が紛れ込む。

A. この PR で版を上げる直接の依存だけを固定する（SDK と、Q2 で書くと決めた時の zod、Q1 で上げると決めた時の uuid）
B. 本番の直接の依存すべてを固定する（A に加えて ajv・ajv-formats・pg・sql.js も。これらの版は、今 lock に入っている版のまま変えない）
C. 本番と開発用の直接の依存すべてを固定する（B に加えて @types の 4 つ・tsx・typescript も。版は今 lock に入っている版のまま変えない）
X. Other (please specify)

[Answer]: B（本番の直接の依存すべてを固定。上げない物は今の版のまま）（Owner がこの会話で答えた）

## Q4. [運用] 「Node 18 以上で動く」をどうするか

勧告が直った @hono/node-server（SDK の下の部品）は 2 系にしかなく、2 系は Node 20 以上を求めます。1 系はどの版にも勧告が当たるので、1 系のまま直すことはできません。

- 本番の server はこの部品を読み込みません（stdio だけを使う）。
- Node 18 で依存を入れると「Node 20 以上を求める部品がある」と警告が出ますが、入れること自体は止まりません（npm の既定）。
- Node 18 で今の試験が通るかは、この Mac に Node 18 が無いので、CI の結果で初めて分かります。
- CI の Node の組み合わせを変えるのは workflow の変更なので、この取り組みには入れられません。

場面の例: CI の Node 18 の回の記録を開くと、毎回「Node 20 以上を求める部品がある」と警告が出ている。

A. 「Node 18 以上で動く」を残す（package.json も CI の Node 18 もそのままにし、警告は受け入れる）
B. package.json を「Node 20 以上で動く」に改める。CI から Node 18 を外すのは、この PR に入れず、別の workflow の PR（Owner の exact-head）にする
X. Other (please specify)

[Answer]: B（package.json を Node 20 以上に改める。CI から Node 18 を外すのは別の workflow の PR にする）（Owner がこの会話で答えた）

## Q5. [品質] 行の網羅率 100% を、この PR ではどう確かめるか

team.md の進め方は「行の網羅率 100% を床にし、統合の前に CI で確かめる」と決めています。ところが今の Kusabi は網羅率を測っておらず、CI にも網羅率の確かめがありません。CI に足すのは workflow の変更なので、この取り組みには入れられません。また、この PR はプログラムの行を 1 行も変えず、部品の版だけを変えます。

測る時は、Node に組み込みの網羅率の道具を先に試します。それで測れず、c8 という部品を足すことになる時は、新しい部品の追加なので別に伺います。

場面の例: 監査（devauditor）が PR を開いた時、網羅率について何が書いてあれば通すか。

A. 手元で全体の行の網羅率を測り、数字を PR に載せる。100% に届かなくても、この PR では試験を足さない（変えた行が無いため）。届かない分は別の取り組みにする
B. 手元で全体の行の網羅率を測り、100% に届くまで、この PR の中で試験を足す（プログラムは変えない）
C. この PR では網羅率を測らない。測る道具と CI の確かめは、施設向けの記憶の取り組みの最初の単位（U1）で入れ、この PR では今の試験が全部通ることだけを確かめる
X. Other (please specify)

[Answer]: A（手元で全体の行の網羅率を測って PR に載せる。100% に届かない分は、社内の基準から外れた所として記録し、別の単位で埋める）（Owner がこの会話で答えた）

## Q6. [品質] 勧告が直ったことを、PR で何によって示すか

場面の例: 監査が PR を開いた時、「本番の依存に既知の勧告が残っていない」ことを、どこを見て確かめるか。

A. 直した後の `npm audit --omit=dev` の結果（0 件）を PR に載せる。試験は足さない
B. A に加えて、今の試験に「lock に入った版が直る版以上か」を確かめる試験を足す（後で誰かが版を下げると、その試験が落ちる）
X. Other (please specify)

[Answer]: A（直した後の npm audit --omit=dev の結果を PR に載せる）（Owner がこの会話で答えた）

## Consolidated Summary Confirmation

- 上げる部品: Issue #339 の部品（SDK とその下の部品、zod）に加え、uuid もこの PR で上げる（Q1 = A）。直した後は、本番の依存の勧告が 0 件になる
- zod: 本番の依存として package.json に書き、直る版 4.6.7 で固定する（Q2 = A）
- 固定: 本番の直接の依存すべての `^` をやめて固定する。上げる物は直る版（SDK 1.32.2・uuid 11.1.1・zod 4.6.7）、上げない物は今 lock に入っている版のまま（ajv 8.20.0・ajv-formats 3.0.1・pg 8.20.0・sql.js 1.14.1）。開発用の依存は変えない（Q3 = B）
- Node: package.json を「Node 20 以上で動く」に改める。CI から Node 18 を外すのは、この PR に入れず、別の workflow の PR（Owner の exact-head）にする（Q4 = B）
- 網羅率: 手元で全体の行の網羅率を測って PR に載せる。100% に届かない分は、社内の基準から外れた所として記録し、別の単位で埋める。この PR では試験を足さない（Q5 = A）
- 直った証拠: 直した後の `npm audit --omit=dev` の結果を PR に載せる。試験は足さない（Q6 = A）
- 完了の境目（承認の後の Owner の直し）: この取り組みの完了は PR が統合されたところまで。席が使う Kusabi の入れ替えは守る物なので、統合の後に Owner の手作業として別に扱う
- 既定の退行の試験（承認の後の Owner の直し）: 足さないことを PR の deviation_ledger に「採った判断: 変えたプログラムの行が無いので足さない」「採らなかった案: 足す」の 2 行で書く
- Node 18 の回（承認の後の Owner の直し）: CI の Node 18 の回が落ちたら、この PR では直さず、Node 18 を外す workflow の PR を先に出す
- 細かい直し（承認の後の Owner の直し）: 手元で回す試験を ci.yml の step と同じ一覧にする。`npm ci` の合格の条件を「0 で終わる」と「package.json・package-lock.json に差分が無い」の 2 つにする。勧告の題名・重さ・中身は、番号の検索に加えて独立の監査の席が目で確かめる

Does this all look correct before I generate the requirements artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
