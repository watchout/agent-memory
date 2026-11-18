# 記録だけの PR の覚え書き（取り組み 261113-store-resolution-fix）

この PR は、取り組み 261113-store-resolution-fix（AI-DLC の scope `bugfix`）の、Build and Test・Deployment Pipeline・Deployment Execution の 3 つの段の記録を main に入れる。code・試験・script・workflow・設定・DB の構造は変えない。席・hook・版の置き場・本番の DB・tmux への効果は無い。統合された直し（PR #347、merge commit `fa9f3a2f16255d723b0cb96f0e77958035f7b11e`）の記録を、1 単位 = 1 PR の決まりどおりに、独立の監査にかける。作者の見立ての区分は R1（決めるのは監査席と arc。作者は R2・R3 を決めない）。

## 1. この PR が入れる物・入れない物

入れる物（新しい file 21 個）:

| 場所（この取り組みの record の下） | file |
|---|---|
| `construction/build-and-test/`（8） | build-and-test-summary.md・build-instructions.md・cross-unit-traceability.md・integration-test-instructions.md・memory.md・performance-test-instructions.md・security-test-instructions.md・test-results.md |
| `construction/code-generation/reviews/`（1） | review-03.md（main には review-01・review-02 がある） |
| `operation/deployment-pipeline/`（5） | cd-config.md・deployment-pipeline-questions.md・deployment-strategy.md・memory.md・rollback-runbook.md |
| `operation/deployment-execution/`（5） | deployment-execution-questions.md・deployment-log.md・health-check-report.md・memory.md・smoke-test-results.md |
| この取り組みの根（1） | この file（records-pr-notes.md） |
| `docs/audit/`（1） | kusabi-records-store-resolution-261113.json（監査の項目） |

入れない物: 作業の log（`audit/`）と engine の内部（`.aidlc-engine/`）、`aidlc-state.md`・`project-description.json`・`runtime-graph.json`（チームの決まり）。persist した学びの記録（作業場の `aidlc/spaces/default/memory/`）は、作業場の中で未追跡で、main にも無い（この取り組みより前の学びも同じ）。この PR には入れず、扱いは arc に伝える。

## 2. 承認の後の file の直しと、訂正

承認済みの段の file は、承認の後に書き換えると engine の段の有効性の確かめを動かす（チームの学び）。訂正は、書き換えずに新しい記録へ書く。この PR では、次の 3 つに分けた（2.1 = 書き換えた 4 か所、2.2 = 訂正 1 件、2.3 = 古くなった文と読み方の注記）。

### 2.1 書き換えた 4 か所（公開の repo への漏れと、禁止の語を避けるため。意味は変えていない）

2026-11-19 に、Deployment Execution の承認の後、PR に入れる前の走査で見つけた 4 か所を直した。

| file | 直した所 | 直し方 |
|---|---|---|
| `operation/deployment-execution/deployment-log.md` の 4 の表の見出し | 手元の home の path | 先頭を `~` に直した |
| `operation/deployment-execution/deployment-execution-questions.md` の表の 1 行 | 同上 | 同上 |
| `construction/build-and-test/test-results.md` の 11 行目 | 同上 | 同上 |
| `construction/build-and-test/performance-test-instructions.md` の 16 行目 | 時間に関わる語を並べた説明の中の 1 語 | 「期限を表す識別子」に直した |

採った判断 = 公開の repo に手元の path を入れない・社内の禁止の語を記録に残さない直しだけを、承認済みの file に例外として入れた。採らなかった代替 = PR の commit の中身だけを直し、作業場の file は直さない（PR に入る記録と作業場の記録が食い違い、「写しを作らない」決まりに反する）。engine は、これらの file が承認の後に変わったと警告として出す可能性がある。

### 2.2 書き換えず、ここに訂正を書く 1 件

- 対象: `construction/build-and-test/build-and-test-summary.md` の 5 の表の 1 行目「版（content-addressed release）の作成と `.kusabi-releases` への配置」の状態の欄「まだ作っていない（置き場の stat の digest は、この段の前後で変わらなかった）」。
- 訂正: この文は「この段（席と試験）が作っていない」の意味に限って正しい。版そのものは、この段の試験より前に Owner が arc の script（publish.sh）で公開していた。根拠（2026-11-19 に API で取り直した値）: 差し替えの記録 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6911141083 の投稿は 2026-11-16T08:19:12Z（作成時刻）で、`build-and-test-summary.md` 自身の 5 の表の 74 行目（Kusabi 自身の 2 席の hook の差し替え。Claude の席は適用済み・Codex の席は差し替え済み）と合う。版の公開と表と列の確認の出力は、arc が 2026-11-17T08:58:30Z に https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6943446661 へ写し、deployment-log.md の 2 の経過の表と 4 の表が、公開の log の名前の時刻（`publish-20261116171538`。JST と読むと UTC の 2026-11-16 08:15:38。名前の読みで、log そのものは席が見ていない）と、版の識別子 `eb9bf298…` を書いている。この段の試験は 2026-11-16T21:25:39Z 以後（`test-results.md` の 10 行目）。
- 影響: Build and Test の結論（17 行 `Met`・1 行 `持ち越し`・1 行 `N/A`）と、置き場の stat の digest が試験の前後で変わらなかったこと（BT-07）は変わらない。変わるのは「版がまだ無い」と読める点と、2.3 が足す読み方の注記だけ。
- 同じ型の訂正の先例: deployment-pipeline の記録の「install4.sh が書き込みの前に投稿した記録」を、書き換えずに deployment-log.md の 5 で訂正した（`operation/deployment-execution/memory.md` の 13 行目）。

### 2.3 書き換えず、ここに足す注記（後から出た事実で古くなった文と、読み方の違い）

2.2 と同じ理由（承認の後に書き換えない）で、承認済みの file の次の文は、そのまま残し、読み方をここに書く。どれも結論（Build and Test の matrix、smoke の 3 値、R1 の判定）は変えない。

- (a) `construction/build-and-test/build-and-test-summary.md` の 5 の表の 73 行目「本番の表と列の名前の突き合わせ 本番は読んでいない」と、8 の 105 行目「まだ行っていない配りの作業」は、「この段（席と試験）が行っていない」の意味に限って正しい。72 行目は 2.2 のとおり。本番の表と列の確認（prodcheck.sh）と 2 席の hook の差し替えは、この段の試験（2026-11-16T21:25:39Z 以後）より前に Owner が済ませていた（時刻と出どころの区別は `deployment-log.md` の 2 の表。log の名前の時刻は JST と読んだ推定）。74 行目（差し替え済み）はこの事実と合っている。
- (b) 配りの順: `operation/deployment-pipeline/cd-config.md` の 3 の表は、公開 → 読み戻し → 表と列の確認 → 差し替えの順に書く。実行の log の名前の時刻（`prodcheck-20261116171049`・`publish-20261116171538`、JST と読んだ推定。log そのものは席が見ていない）は、表と列の確認の方が公開より先に出る。表と列の確認は、同じ表の 4 行目の記述（読み取りだけ・名前だけ）から、公開の結果を入力に取らない物と読んだ（script は読んでいない）。止める条件は「差し替えの前に公開・読み戻し・表と列の確認が済んでいる」で、差し替えは設定 file の変更時刻（観測。08:20:38〜39 UTC）が 2 つの log の名前の時刻より後なので、破られていない。設計の表の順は直さない。
- (c) `operation/deployment-pipeline/deployment-strategy.md` の 59 行目「席ごとの期待も、まだ無い」は、承認の時点の状態。その後、arc が期待（A・B とも backend = postgres・source = user_config）を https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6943475955 に出し、`deployment-log.md` の 6 の表の 1 行目がその期待との照らしを書いている（Stop の証拠は無いので、結果は観測できず）。
- (d) `operation/deployment-execution/smoke-test-results.md` の S-16 が書く閾値の数（240000）の出どころは、差し替えの記録 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6911141083 の 7 行目（Claude の席の切り直しの閾値）。S-16 が書く「回転の Stop がまだ起きていない」は、arc の席間の答え（`deployment-pipeline-questions.md` の Q1 の [Answer] の最後の文）で、Owner の言葉でも GitHub の記録でもない。席は、Stop の起きた回数を確かめていない。
- (e) `construction/build-and-test/integration-test-instructions.md` の 12・25 行目の `failed_open`: hook の証拠の動作・状態の値（base の `src/session-rotation-stop.ts` の 97・260 行は `action`、`src/transcript-stop-capture.ts` の 89・194 行は `status`）。host を止めずに通した印で、拒否の理由は別の欄 `reason` の `store_refused:<理由>`。BT-14 が書く `outcome` は、`src/transcript-stop-capture.ts` の 196 行目の別の欄。
- (f) 日付の基準: `build-and-test-summary.md`・`build-instructions.md` などの「この段（2026-11-17）」は JST の日付。`test-results.md` の「2026-11-16T21:25:39Z〜」は同じ時刻の UTC の書き方（JST では 2026-11-17 06:25:39）。
- (g) `operation/deployment-execution/deployment-execution-questions.md` の 27 行目「#49 の comment 33 件を調べた」は、質問を書いた時点の件数で、数え方（API の呼び方・範囲）が記録に無い。再現できない件数として読む。その後の事実（2 つの script の出力が #49 に出た）は `deployment-log.md` の 2・3 のとおり。
- (h) `operation/deployment-pipeline/rollback-runbook.md` の 50・53 行目（install4.sh の戻しは「試していない」）は、設計の段の時点の状態。その後、arc の記録 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6991634288 の結果として、戻しは使い捨ての写しで試された（`smoke-test-results.md` の S-17。写し・一致。限り: 実物の戻しと、席を起こし直しての hook の動作は試していない）。同じ file の 22 行目の別の戻し方（版を差し替える前の版に替えて同じ引数で適用する）は、「書いた直後の file と同じ時だけ」の条件（21 行目）を書いておらず、install4.sh を読んでいないので、守られるかは確かめていない。戻す時は 21 行目の道を使い、`deployment-log.md` の 4 の hash の照らしで事後に検出する。
- (i) `operation/deployment-execution/deployment-execution-questions.md` の Q1〜Q5 の答えは、画面の選びで受けた答え（**Mode:** guided）で、答えた人は書かれていない。1〜3 行目の規則（守る物は Owner の言葉、そうでなければ arc の答え）のどちらかは、答えの欄からは読めない。権限の根拠はこの答えに置かず、Owner の決定 77・95・114 だけに置く（守る物の実行は、この答えに乗っていない）。Q4 の答えは、決定 114 の本文（読み戻しと接続の確かめは arc が script を作り arc-sec が通してから Owner が打つ。出力は接続の道・繋がったか・読み戻せたかだけ）と同じ内容で、作者が本文を取り直して照らした。
- (j) `operation/deployment-execution/deployment-log.md` の 5 の 1（74 行目）は、差し替えの記録（#49 の 6911141083）の 13 行目の読みに合わせ、先に投稿したのは arc で、宣言だったと訂正している。同じ comment の 2 行目は、script が書き込みの前に投稿した物という読みで、comment 自身が食い違っている（`operation/deployment-execution/memory.md` に読みが残る）。どちらの読みでも、その comment は差し替えが成功した証拠ではない。

## 3. 前検査（KY の先回りの点検。arc の指示、AI-DLC の決まり 版 8）

- 役: `aidlc-devsecops-agent`（読むだけ。1 回。席と同じモデル、この作業場の中だけ。書き込み・GitHub・孫への委任なし）。あわせて、項目の file の見直しを `aidlc-architecture-reviewer-agent`（読むだけ。1 回）が行った。どちらも、監査の依頼を出す前に、KY の表（`aidlc-only.md` の 2。致命 × 全部、重大 × 低以上、中 × 中以上、軽 × 高が差し戻す組み合わせ）で行った。
- 対象: base `fa9f3a2f16255d723b0cb96f0e77958035f7b11e` に対する 21 個の新しい file。役が読んだのは作業場の working tree の file で、commit の blob との一致は役は確かめていない（commit は前検査の後に作る）。記録 19 file の blob（`git hash-object` の先頭 12 桁。前検査の後に直していない）は次のとおり。

| file（取り組みの根の下） | blob |
|---|---|
| `construction/build-and-test/build-and-test-summary.md` | `339f953e1808` |
| `construction/build-and-test/build-instructions.md` | `43cfca2805fc` |
| `construction/build-and-test/cross-unit-traceability.md` | `47a69ef454cc` |
| `construction/build-and-test/integration-test-instructions.md` | `97ca6c0a0926` |
| `construction/build-and-test/memory.md` | `df2d58068c1a` |
| `construction/build-and-test/performance-test-instructions.md` | `5e1ee5dc26cc` |
| `construction/build-and-test/security-test-instructions.md` | `ffe414f31ada` |
| `construction/build-and-test/test-results.md` | `7278e80ea69f` |
| `construction/code-generation/reviews/review-03.md` | `1fe1e0507751` |
| `operation/deployment-execution/deployment-execution-questions.md` | `b19416993ec0` |
| `operation/deployment-execution/deployment-log.md` | `0df81b1fe53e` |
| `operation/deployment-execution/health-check-report.md` | `95e7dc19b849` |
| `operation/deployment-execution/memory.md` | `58146a3d8cbc` |
| `operation/deployment-execution/smoke-test-results.md` | `807ce637ea4d` |
| `operation/deployment-pipeline/cd-config.md` | `abda98f89f05` |
| `operation/deployment-pipeline/deployment-pipeline-questions.md` | `3bd1aa606270` |
| `operation/deployment-pipeline/deployment-strategy.md` | `719e7c4ea1ef` |
| `operation/deployment-pipeline/memory.md` | `25aaa6c4024d` |
| `operation/deployment-pipeline/rollback-runbook.md` | `4e399d0d62f2` |

  覚え書き（この file）と項目の file は、前検査の後に直した（覚え書きの 2.3 の h・i・j と 2.2 の指し先・41 行目の言い回し、項目の file の REC-2・3・4・6・7・8・10 の文と件数、この節）。この 2 file の直しは、前検査の役には流し直していない。作者の機械の走査（手元の path・メール・資格情報・hook の引数の値・時間の言葉）と、出典の照らしの script を、直した後の 21 file に流し直した。
- 止める指摘（差し戻す組み合わせ）: 0 件。実際の漏れ（観点 1）・失敗が成功と記録される物（観点 2）・Owner の許可なしの戻せない操作と読める文（観点 3）・監査の記録の欠け（観点 4）は 0 件。
- 役が先に見つけ、点検の途中で直っていた物（件数に数えない）: 項目の file の REC-2 の文自身が、走査に掛かる綴りを書いていた（今は書かない）。覚え書き 2.2 の訂正が表の 1 行目だけだった（今は 2.3 の a が 73・105 行目に足している）。
- 持ち越しの指摘 4 件（どれも差し戻す組み合わせに当たらない）と、作者の扱い:

| ID | 内容 | KY | 扱い |
|---|---|---|---|
| K-1 | rollback-runbook.md の 22・50・53 行目が、後から出た戻しの試しと、条件の書き方で食い違う | 軽 × 中 | 直した（2.3 の h に足した。承認済みの file は書き換えない） |
| K-2 | 覚え書き 2.2 の「変わるのは…だけ」が 2.3 と食い違って読める | 軽 × 低 | 直した（2.2 の言い回し） |
| K-3 | Q1〜Q5 の答えの欄から、答えた人と権限の出どころが読めない | 中 × 低 | 直した（2.3 の i に足した。権限の根拠は決定 77・95・114 だけ） |
| K-4 | (a) 差し替えの記録の 2 行目と 13 行目が食い違う、(b) 公開の repo に Mac の PostgreSQL の窓と接続の向きが出る（DB 名は main の docs に既にあり、悪用には host 上の権限が要り対象外の前提）、(c) hook の node の path と tmux 名が出る（利用者名・設定の中身・command の引数は無い） | 軽 × 低 | (a) は 2.3 の j に足した。(b)(c) は記録だけ（差し戻さない） |

- 役の 6 つの観点のうち、観点 6（項目の file の抜き取りの突き合わせ）で、REC-11・REC-12 は、この節と PR 本文がまだ無かったので確かめていない。この節を書いたのでそのまま次の独立の監査にかかる。

## 4. 持ち越しと、待っている物

- 観測できず（成功に数えない）: R1 の判定（観測 1・観測 2 とも）。Codex の席は差し替えの後に一度も動いていない。2026-11-17 の 10:49〜15:23（JST）の間の保存の欠け（席は DB を読まないので確かめられない）。R2 は開いていない。
- 読み戻しと接続の確かめ: Owner の決定 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6943524026 のとおり、arc が script を作り arc-sec が通してから Owner が打つ。出力は接続の道・繋がったか・読み戻せたか（一致か不一致か）だけ。出力の URL が来たら、新しい取り組みの記録にデータとして書く（この取り組みの段は開き直さない）。席の読みとして、その出力はその窓の行を数えない。確かめが要るなら次の取り組み（arc の席間の答えを含む読み。Owner の言葉でも GitHub の記録でもない）。
- 見直しの持ち越し（記録だけ、差し戻さない）: Code Generation の見直し 3 回目（`reviews/review-03.md`）の Minor の R-05（計画の Summary と C1 の行の、試験 file の数の古さ）・R-06（`src/kusabi-runtime-event-emitter.ts` が上限の 800 行ちょうど）。OBS-1（`AGENT_MEMORY_DB_PATH` が空文字の時の `||` と `??`）。
- arc に渡してある物: BT-OBS-1（`test-session-start-auto-receive.ts` の期待値が temp の名前の `_`・`.` で落ちる。直すのは別の取り組み）、BT-OBS-2（CI の `Run post-tool-hook tests` が試験を 1 件も流さずに成功する。`ci.yml` は守る物なので Owner の判断）。
- 止めてある別の取り組み: `261110-session-rotation`・`261021-facility-ax-memory`（arc の指示）。
