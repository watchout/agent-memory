# 要件 — 本番の依存の既知の勧告への版上げ（Issue #339）

- 依頼の原文: 「Issue #339 の本番の依存の既知の勧告への版上げだけを行う（@modelcontextprotocol/sdk とその下の HTTP 系の部品・zod）。新しい機能は作らず、DB の構造・workflow・資格情報に触れない。直す先の版は npm audit fix --dry-run と各勧告の直った版で決め、範囲指定（^）をやめて固定する。Owner の決定 OD-KUSABI-DEPS-UPGRADE-ONLY-UNIT-20261109-001」
- 深さ: Minimal（変えるのは依存の宣言と lock だけで、プログラムは変えない）
- 種類: 保守（依存の版上げ）。scope は security-patch
- 勧告の中身（番号・重さ・内容）は書かない。この repo は公開なので、部品の名前と版だけを書く（Issue #339。詳しい判定は arc-sec の非公開の記録 ARCSEC-DEP-AUDIT-RUN-20261109-001）

## 意図の分析

- 目的は、Kusabi の本番の依存から既知の勧告をなくすこと。新しい機能は作らない。（依頼の原文、OD-KUSABI-DEPS-UPGRADE-ONLY-UNIT-20261109-001）
- 勧告の当たる部品の多くは、MCP SDK が連れてくる HTTP 系の部品で、本番の server は読み込まない。本番の server は MCP の stdio だけで動く。（今のコードの読み解き `aidlc/spaces/default/codekb/agent-memory/architecture.md`・`code-structure.md`、`inception/reverse-engineering/developer-scan.md`）
- あわせて、版を範囲ではなく固定で書き、後で依存を入れ直した時に、確かめていない版が紛れ込まないようにする。（依頼の原文、Q3 = B）
- 得をするのは、Kusabi を記憶の置き場に使う社内の席と、点検する arc-sec。席の使い方は変わらない。（`aidlc/spaces/default/codekb/agent-memory/business-overview.md`）
- この取り組みの完了は、この PR が統合されたところまで。席が使う Kusabi の入れ替え（team.md の Deployment の、版を作って席の束に配る流れ）は守る物（展開）なので、統合の後に Owner の手作業として別に扱う。統合だけでは、いま動いている席の依存は古いまま残る。（`[Owner の直し]`）

## 出典

- `[desc]` 依頼の原文（上）
- `[Q1]`〜`[Q6]` 要件の分析の問いへの Owner の答え（`requirements-analysis-questions.md`）
- 今のコードの読み解き: `inception/reverse-engineering/developer-scan.md`、`aidlc/spaces/default/codekb/agent-memory/business-overview.md`・`architecture.md`・`code-structure.md`・`dependencies.md`
- 依存の点検（2026-11-09）: `npm audit --omit=dev` と `npm audit fix --dry-run`。版上げは作業場の外の写しで試し、repo のファイルは変えていない
- Owner の決定: OD-KUSABI-DEPS-UPGRADE-ONLY-UNIT-20261109-001（https://github.com/watchout/agent-memory/issues/339#issuecomment-6729538122）
- `[Owner の直し]` 要件の分析の承認の後に、Owner がこの会話で出した直し（2026-11-09、原文の抜き出し）:
  - 「完了は「PR が統合されたところまで」とし、席が使う Kusabi の入れ替えは守る物なので、統合の後に私の手作業として別に扱うと書いてください。」
  - 「既定の退行の試験を足さないことを、deviation_ledger に「採った判断: 変えたプログラムの行が無いので足さない」「採らなかった案: 足す」の 1 行ずつで書く要件を足してください。」
  - 「CI の Node 18 の回が落ちたら、この PR では直さず、Node 18 を外す workflow の PR を先に出す」
  - ほかの細かい直し（試験の一覧・`npm ci` の合格の条件・勧告の題名と重さの確かめ）も「この段で直してかまいません」
- `[Owner の直し（承認の時）]` 開き直した要件を承認した時に、Owner がこの会話で出した直し（2026-11-09、原文の抜き出し）:
  - 「Node 組み込みの道具で網羅率を測れない時は、この PR では測らず、deviation_ledger に「採った判断: 新しい依存を足さず、この PR では測らない」「採らなかった案: c8 を足して測る」の 1 行ずつで書いてください。c8 を足すかは、別の単位で私が決めます。」
  - ほかの 3 つの細かい直し（lock の先頭の項の engines の変化を差分の条件に数える・試験が落ちた時に伺う範囲・未決の問いの 3 つ目）は「次の段で直してかまいません」

## 機能の要件

### FR1 勧告の当たる部品の版上げ

- **FR1.1** package-lock.json で、本番の依存のうち既知の勧告の当たる部品を、次の版へ上げる。`[desc]` `[Q1]`

  | 部品 | 今の版 | 上げる先 |
  |------|--------|----------|
  | @modelcontextprotocol/sdk | 1.28.0 | 1.32.2 |
  | uuid | 11.1.0 | 11.1.1 |
  | zod | 4.3.6 | 4.6.7 |
  | hono | 4.12.9 | 4.13.17 |
  | @hono/node-server | 1.19.11 | 2.1.6 |
  | express-rate-limit | 8.3.1 | 8.7.3 |
  | ip-address | 10.1.0 | 10.7.6 |
  | body-parser | 2.2.2 | 2.4.0 |
  | proxy-addr | 2.0.7 | 2.0.8 |
  | qs | 6.15.0 | 6.17.1 |
  | fast-uri | 3.1.2 | 3.1.9 |

  合格: 統合する版の package-lock.json で、各部品の版が上の表の「上げる先」と一致する。
- **FR1.2** 版上げに伴って上がる勧告の無い部品（es-object-atoms・hasown・iconv-lite・side-channel・side-channel-list・type-is、content-type の 2 か所）は、`npm audit fix` が選んだ版のまま受け入れる。FR1.1 と FR1.2 の部品、FR2.1 の zod の宣言以外では、package-lock.json の版を変えない。`[desc]`
  合格: 今の main の package-lock.json と比べた差分が、FR1.1・FR1.2 の部品と、FR2 の宣言の変更だけ。
- **FR1.3** 直した後に `npm audit --omit=dev` を回すと、本番の依存の既知の勧告が 0 件になる。`[Q1]` `[Q6]`
  合格: 統合する版で `npm audit --omit=dev` が「found 0 vulnerabilities」を返す。

### FR2 依存の宣言と固定

- **FR2.1** zod を package.json の本番の依存（dependencies）に足し、`4.6.7` で固定する。`[Q2]`
  合格: package.json の dependencies に `"zod": "4.6.7"` がある。
- **FR2.2** 本番の直接の依存すべてで範囲指定（`^`）をやめ、完全な版で書く。上げる物は上げる先、上げない物は今 lock に入っている版にする。`[desc]` `[Q3]`

  | 部品 | 今の宣言 | 固定する版 |
  |------|----------|------------|
  | @modelcontextprotocol/sdk | ^1.12.1 | 1.32.2 |
  | uuid | ^11.1.0 | 11.1.1 |
  | zod | （無し） | 4.6.7 |
  | ajv | ^8.20.0 | 8.20.0 |
  | ajv-formats | ^3.0.1 | 3.0.1 |
  | pg | ^8.13.0 | 8.20.0 |
  | sql.js | ^1.14.1 | 1.14.1 |

  合格: package.json の dependencies のどの値も、`^`・`~`・`>` などの範囲の記号を含まず、上の表の版と一致する。
- **FR2.3** 開発用の依存（devDependencies）の宣言は変えない。`[Q3]`
  合格: package.json の devDependencies が今の main と同じ。
- **FR2.4** package.json と package-lock.json の宣言が食い違わない。`[desc]`
  合格: `npm ci` が 0 で終わり、その後の `git status --porcelain package.json package-lock.json` が何も出さない（`npm ci` は宣言と lock が食い違うと失敗するので、通ることと差分が無いことの 2 つを確かめる）。`[Owner の直し]`

### FR3 動く Node の宣言

- **FR3.1** package.json の engines.node を「Node 20 以上」（`>=20.0.0`）に改める。上げる先の @hono/node-server 2.1.6 が Node 20 以上を求め、1 系のどの版にも勧告が当たるため。`[Q4]`
  合格: package.json の engines.node が `>=20.0.0`。
- **FR3.2** CI の workflow（`.github/workflows/ci.yml`）はこの PR で変えない。CI から Node 18 を外すのは、別の workflow の PR（Owner の exact-head）にする。`[Q4]`
  合格: この PR の差分に `.github/` の変更が無い。Node 18 を外す PR は、範囲の外の項目として後の段に引き継ぐ。
- **FR3.3** この PR の CI の Node 18 の回が落ちたら、この PR では直さず、Node 18 を外す workflow の PR を先に出す（その PR は workflow の変更なので Owner の exact-head を通す）。その PR が統合された後に、この PR の CI を回し直す。`[Owner の直し]`
  合格: Node 18 の回が落ちた時、この PR の差分にその失敗を直すための変更が無く、PR の本文に Node 18 を外す PR への参照がある。

### FR4 確かめと証拠

- **FR4.1** 今の試験がすべて通る。手元では、CI（`.github/workflows/ci.yml`）の step と同じ命令を同じ順で回す。MCP の試験（SDK の client で server を stdio で起動して道具を呼ぶ）もこの中に入る。`[desc]` `[Owner の直し]`

  | CI の step | 命令 |
  |------------|------|
  | Install dependencies | `npm ci` |
  | Type check | `npx tsc --noEmit` |
  | Build | `npm run build` |
  | Run core test suite | `KUSABI_INTEGRATED_BUILT_EXECUTION=1 npx tsx src/test.ts` |
  | Run native recovery and automatic receive tests | `npm run test:codex-hook`・`npm run test:claude-hook`・`npm run test:gemini-hook`・`npm run test:gemini-conversation-ingest`・`npm run test:automatic-receive` |
  | Run immutable publication and direct rollout tests | `npm run test:kusabi-content-addressed-runtime-release`・`npm run test:kusabi-direct-fleet-rollout` |
  | Run spec-enforcement tests | `npx tsx tests/spec-enforcement/anti-regression-am027.ts` |
  | Run SQLite store tests | `HOME=$(mktemp -d) npx tsx src/test-sqlite.ts` |
  | Run boot recovery tests | `HOME=$(mktemp -d) npx tsx src/test-boot-recovery.ts` |
  | Run post-tool-hook tests | `HOME=$(mktemp -d) npx tsx src/test-post-tool-hook.ts` |
  | Run Gate 0 tests | `HOME=$(mktemp -d) npx tsx tests/gate0/no-secret-recovery.ts`・`tests/gate0/migration-idempotency.ts`・`tests/gate0/search-memory-regression.ts`（どれも同じ形） |

  合格: この Mac の Node で上の命令が全部 0 で終わり、PR の CI（Node 18・20・22）の必須の検査が通る。CI の step が変わっていたら、PR を出す時点の ci.yml に合わせる。Node 18 の回が落ちた時は FR3.3 に従う。
- **FR4.2** PR の本文に、直した後の `npm audit --omit=dev` の結果を載せる。勧告の番号・中身は載せない。`[Q6]`
  合格: PR の本文に結果（0 件）がある。勧告の番号・題名・重さが PR・commit・repo のファイルに無い。
- **FR4.3** 手元で全体の行の網羅率を測り、数字を PR の本文に載せる。この PR では試験を足さない。100% に届かない分は、社内の基準（行の網羅率 100%）から外れた所として PR の本文の deviation_ledger に記録し、別の単位で埋める。`[Q5]`
  合格: PR の本文に、測った命令・網羅率の数字・届かない分の記録（採った判断と採らなかった代替を 1 行ずつ）がある。
  - Node に組み込みの道具で網羅率を測れない時は、この PR では測らず、PR の本文の deviation_ledger に次の 2 行を書く。c8 を足すかは、別の単位で Owner が決める。`[Owner の直し（承認の時）]`
    - 採った判断: 新しい依存を足さず、この PR では測らない
    - 採らなかった案: c8 を足して測る

    合格（測れない時）: PR の本文の deviation_ledger に、上の 2 行と、組み込みの道具で測れなかったことを示す命令とその出力の要点がある。
- **FR4.4** scope が security-patch の時の既定（勧告に向けた退行の試験を足す。org.md の Testing Posture）から外れて、この PR では退行の試験を足さない。そのことを PR の本文の deviation_ledger に、次の 2 行で書く。`[Q6]` `[Owner の直し]`
  - 採った判断: 変えたプログラムの行が無いので足さない
  - 採らなかった案: 足す

  合格: PR の本文の deviation_ledger に、上の 2 行がある。

## 非機能の要件

- **NFR1 振る舞いを変えない**: プログラム（`src/`・`scripts/`・`tests/`）の行を変えない。MCP の道具の名前・入力・応答と、PostgreSQL・SQLite の置き場の扱いは今のまま。`[desc]`
  合格: この PR の差分のうち、プログラムと依存に関わる file が package.json と package-lock.json だけ。ほかに入るのは、team.md の進め方が求める物だけ（この取り組みの AI-DLC の記録 `aidlc/spaces/default/intents/261109-deps-advisory-upgrade/` の `inception/`・`construction/` ほか。作業の log の `audit/` と engine の内部の `.aidlc-engine/` は入れない。監査の項目の file `docs/audit/*.json`）。
- **NFR2 勧告の中身を公開しない**: 勧告の番号・題名・重さ・内容を、repo のファイル・commit・PR・AI-DLC の記録に書かない。部品の名前と版だけを書く。`[desc]`
  合格: 統合する版の差分（AI-DLC の記録を含む）と PR の本文・commit の文を、勧告の番号の形（GitHub の勧告の番号と CVE の番号）で探して 0 件。あわせて、題名・重さ・中身は番号の検索では捕まえられないので、独立の監査の席が差分と PR の本文を目で読み、勧告の題名・重さの語・中身が無いことを確かめる。`[Owner の直し]`
- **NFR3 外への通信を増やさない**: 本番の server が外と通信する道のり（Voyage の埋め込みだけ）を増やさない。本番の server は stdio のまま。`[desc]`
  合格: NFR1 の差分の条件で満たす。
- **NFR4 入れる前の確かめ**: 依存を入れる前に、上げる先の部品に既知の勧告が無いことを確かめる。新しく入る部品は `npm audit fix` が選んだ物だけにする。`[desc]`
  合格: FR1.3 の結果と、FR1.2 の差分の条件。
- **NFR5 戻せる**: この PR の統合の commit を戻せば、1 回で今の依存に戻る。`[desc]`
  合格: プログラムと依存に関わる差分が package.json と package-lock.json だけ（NFR1）。

## 制約

- 新しい機能・DB の構造・workflow・資格情報は含まない（OD-KUSABI-DEPS-UPGRADE-ONLY-UNIT-20261109-001）。
- 1 単位 = 1 PR。独立の監査（devauditor）、作者の受領、必須の検査、作者と別の席（suite-lead）の統合は今までどおり（同じ決定、team.md の進め方）。
- 社内の基準の行の網羅率 100% は今の Kusabi では測っておらず、CI にも確かめが無い。CI に足すのは workflow の変更なので、この取り組みに入れられない（`[Q5]`）。
- この Mac の Node は 26。Node 18・20・22 での確かめは CI だけで行う。

## 前提

- 上げる先の版は 2026-11-09 の点検の結果。PR を出す前にもう一度 `npm audit --omit=dev` を回し、結果が変わっていたら（新しい勧告が出ていたら）、版を決め直す前に Owner に伺う。
- CI の Node 18 の回では、依存を入れる時に「Node 20 以上を求める」警告が出るが、npm の既定で入れること自体は止まらない。本番の server は @hono/node-server を読み込まないので、試験は通ると見込む。この Mac では確かめられず、CI の結果で確かめる。落ちた時は FR3.3 のとおり、この PR では直さない。
- SDK 1.28.0 から 1.32.2 への上げは同じ 1 系の中なので、今のプログラムのまま型検査と試験が通ると見込む。通らずプログラムを直す必要が出た時は、直す前に Owner に伺う（NFR1 を外れるため）。
- 網羅率は、Node に組み込みの道具を先に試して測る。それで測れず c8 などの部品を足すことになる時は、新しい部品の追加なので別に Owner に伺う（`[Q5]` の問いの前書き）。

## 範囲の外

- 席が使う Kusabi の入れ替え（統合した main から版を作って席の束に配ること）。守る物（展開）なので、統合の後に Owner の手作業として別に扱う。`[Owner の直し]`
- 開発用の部品の勧告（tsx の下の esbuild）。本番の依存ではないため。
- CI から Node 18 を外す workflow の変更（別の PR、Owner の exact-head。`[Q4]`）。Node 18 の回が落ちた時は、この PR より先に出す（FR3.3）。
- 行の網羅率を 100% に上げるための試験の追加（別の単位。`[Q5]`）。
- CI への網羅率の確かめの追加（workflow の変更）。
- 新しい機能、DB の構造、資格情報、他の製品（Tsumama ほか）の依存。

## 未決の問い

- 網羅率が 100% に届かない分を埋める「別の単位」をどこに置くか（どの取り組み・Issue か）。測った数字が出た後に決める。
- CI から Node 18 を外す workflow の PR を誰が作るか（Node 18 の回が落ちた時は、この PR より先に要る。FR3.3）。
- `test:kusabi-content-addressed-runtime-release` が package.json・package-lock.json の中身に依る値を持つかは、まだ確かめていない。コードを書く段で試験を回して確かめる。

## 追跡

| 要件 | 出どころ |
|------|----------|
| FR1.1 | `[desc]`、`[Q1]`、依存の点検 |
| FR1.2 | `[desc]`、依存の点検 |
| FR1.3 | `[Q1]`、`[Q6]` |
| FR2.1 | `[Q2]` |
| FR2.2 | `[desc]`、`[Q3]` |
| FR2.3 | `[Q3]` |
| FR2.4 | `[desc]`、`[Owner の直し]`（合格の条件） |
| FR3.1・FR3.2 | `[Q4]` |
| FR3.3 | `[Owner の直し]` |
| FR4.1 | `[desc]`、team.md の Testing Posture（今ある試験は通ったまま保つ）、`[Owner の直し]`（ci.yml と同じ一覧） |
| FR4.2 | `[Q6]` |
| FR4.3 | `[Q5]`、team.md の Testing Posture（行の網羅率 100%）。測れない時の扱いは `[Owner の直し（承認の時）]` |
| FR4.4 | `[Q6]`、org.md の Testing Posture（security-patch の既定）、`[Owner の直し]` |
| 完了の境目（意図の分析・範囲の外） | `[Owner の直し]`、team.md の Deployment |
| NFR1〜NFR5 | `[desc]`、OD-KUSABI-DEPS-UPGRADE-ONLY-UNIT-20261109-001。NFR2 の目の確かめは `[Owner の直し]` |
