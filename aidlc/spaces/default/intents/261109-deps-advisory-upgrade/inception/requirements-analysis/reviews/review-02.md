## Review

**Verdict:** READY
**Reviewer:** aidlc-product-lead-agent
**Date:** 2026-11-09T04:25:22Z
**Iteration:** 1
**Verdict Dictated:** no

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | aidlc/spaces/default/intents/261109-deps-advisory-upgrade/inception/requirements-analysis/requirements.md > 意図の分析・範囲の外 | 目的は「Kusabi の本番の依存から既知の勧告をなくす」だが、統合した後に席へ配る（team.md の Deployment の R1 → R2 → R3 の版の配布）かどうかが、要件にも範囲の外にも書いていない [文献確認: requirements.md の「範囲の外」に配布の項目が無い。team.md Deployment]。統合だけでは、いま動いている席の依存は古いまま残る。配布は保護面（展開）で Owner の認可が要るため、黙っていると「済んだ」の意味が統合なのか配布なのか読み手で割れる。 | 席への配布をこの取り組みに入れるか（入れるなら Owner の認可を得る段と合格の条件）、範囲の外として後の取り組みに渡すかを 1 行で書く。どちらでも、「この取り組みの完了 = 統合まで」か「配布まで」かを明記する。 | Resolved (reviewer) |
| R-02 | Major | aidlc/spaces/default/intents/261109-deps-advisory-upgrade/inception/requirements-analysis/requirements.md > FR4.2・FR4.3（試験の扱い） | org.md の Testing Posture は scope が security-patch の時に「その勧告に向けた退行の試験を足す」を既定にしている [文献確認: org.md Testing Posture「bugfix, security-patch add a targeted regression」]。要件は Q6 = A に従い試験を足さず `npm audit --omit=dev` の結果で示すとしているが、これが既定から外れることを書いていない。網羅率の外れは FR4.3 で deviation_ledger に記録すると書いてあるのに、こちらには記録の要件が無い。監査の席が既定との差を指摘しうる。 | 「security-patch の既定の退行の試験は足さず、`npm audit --omit=dev` の 0 件を代わりの証拠にする」ことを、FR4.3 と同じく PR の deviation_ledger に採った判断・採らなかった代替（Q6 の B）で 1 行ずつ記録する要件を足す。 | Resolved (reviewer) |
| R-03 | Minor | aidlc/spaces/default/intents/261109-deps-advisory-upgrade/inception/requirements-analysis/requirements.md > FR4.1 | 「CI が回す試験」として並べた命令が、ci.yml の一部だけになっている [検証済: `.github/workflows/ci.yml` を読んだ]。CI にある `tests/spec-enforcement/anti-regression-am027.ts`、`src/test-sqlite.ts`、`src/test-boot-recovery.ts`、`src/test-post-tool-hook.ts`、`tests/gate0/` の 3 つが手元の確かめの一覧に無く、CI の core の回は `npm test` でなく `KUSABI_INTEGRATED_BUILT_EXECUTION=1 npx tsx src/test.ts` で回っている。 | 手元で回す命令を ci.yml の step と同じ一覧にする（または「ci.yml の全 step を手元で同じ命令で回す」と書く）。 | Resolved (reviewer) |
| R-04 | Minor | aidlc/spaces/default/intents/261109-deps-advisory-upgrade/inception/requirements-analysis/requirements.md > 前提（CI の Node 18 の回）・FR3.1 | engines.node を `>=20.0.0` にした後も CI は Node 18 で回り、その回が通ることを合格の条件（FR4.1）にしている。Node 18 の回が落ちた時にどうするか（CI の workflow はこの PR で変えられない）が書いていない。上げる先で Node 20 以上を求めるのは @hono/node-server 2.1.6 だけだった [検証済: `npm view <部品>@<版> engines` を FR1.1 の上げる先の版で回した]。Node 18 の回が通るかは [推測: CI で初めて分かる]。 | Node 18 の回が落ちた時は、この PR を止めて Owner に伺う（例: Node 18 を外す workflow の PR を先に出す）と、前提か未決の問いに 1 行書く。 | Resolved (reviewer) |
| R-05 | Minor | aidlc/spaces/default/intents/261109-deps-advisory-upgrade/inception/requirements-analysis/requirements.md > FR2.4 | 合格の条件「`npm ci` が lock を書き換えずに通る」は、`npm ci` がもともと lock を書き換えない命令なので条件として弱い（食い違いがあれば失敗する、が本当の確かめ）[文献確認: npm ci の公式の説明]。 | 「`npm ci` が成功で終わり、その後 `git status` で package-lock.json に変更が無い」のように、通る・差分が無いの 2 つを確かめる形に書き直す。 | Resolved (reviewer) |
| R-06 | Minor | aidlc/spaces/default/intents/261109-deps-advisory-upgrade/inception/requirements-analysis/requirements.md > NFR2 | 守る物は「番号・題名・重さ・内容」だが、合格の条件は番号の形の検索だけで、題名・重さの書き込みは捕まえられない [文献確認: requirements.md NFR2]。 | 番号の形の検索に加え、PR・commit・記録の差分を監査の席が目で見て題名・重さの語が無いことを確かめる、と合格の条件に足す。 | Resolved (reviewer) |
| R-07 | Minor | aidlc/spaces/default/intents/261109-deps-advisory-upgrade/inception/requirements-analysis/requirements.md > FR1.2 の合格 | [検証済: package-lock.json の `packages[""]` に `"engines":{"node":">=18.0.0"}` と dependencies の写しがある] FR3.1 で engines を改めると lock のこの項も変わるが、FR1.2 の合格は「差分が FR1.1・FR1.2 の部品と、FR2 の宣言の変更だけ」で FR3.1 を数えていない。監査が文面どおりに読むと、正しい差分が条件を外れる。 | FR1.2 の合格に「FR3.1 の engines の変更（lock の先頭の項を含む）」を足す。 | New |
| R-08 | Minor | aidlc/spaces/default/intents/261109-deps-advisory-upgrade/inception/requirements-analysis/requirements.md > 前提（SDK の上げ）・NFR1 | [文献確認: requirements.md 前提の 3 つ目] 「通らずプログラムを直す必要が出た時は、直す前に Owner に伺う」が SDK の上げの前提にだけ書いてある。@hono/node-server の大きい版の上げや zod の上げで型検査・試験（`scripts/`・`tests/` の fixture を含む）が落ちた時の扱いは書いていない。 | 「版上げの後に型検査・試験のどれかが落ち、package.json と package-lock.json 以外を変えないと通らない時は、変える前に Owner に伺う」と、部品を限らない 1 行にする。 | New |
| R-09 | Minor | aidlc/spaces/default/intents/261109-deps-advisory-upgrade/inception/requirements-analysis/requirements.md > FR4.3・前提（網羅率の道具） | [推測: 今の試験は tsx の自前のスクリプトで、Node に組み込みの網羅率（`node:test` 向け）でそのまま測れるかは試していない] 組み込みで測れず、c8 の追加も Owner が認めない時、FR4.3 の合格（数字を PR に載せる）を満たせない。その時の扱いが無い。 | 「組み込みで測れず部品も足さない時は、測れなかったことと理由を deviation_ledger に 1 行ずつ書き、それを FR4.3 の合格とする」のように、測れない時の終わり方を 1 行書く（Owner の判断として残してもよい）。 | New |
| R-10 | Minor | aidlc/spaces/default/intents/261109-deps-advisory-upgrade/inception/requirements-analysis/requirements.md > 未決の問い（3 つ目） | [検証済: scripts/test-kusabi-content-addressed-runtime-release.mjs 119〜120 行目] package.json は `name` が `wasurezu` かを見るだけで、lock は読まず、sha256 は実行の時に数えている。この問いは今の読みでほぼ閉じられる。 | 読んだ結果（`name` だけを見る）を書き、問いを閉じるか、「コードを書く段で試験の結果で確かめる」の確かめだけに縮める。 | New |

> R-01 Reviewer note: [文献確認: requirements.md 意図の分析の最後の項・範囲の外の最初の項] 完了 = 統合まで、席への入れ替えは統合の後の Owner の手作業と書かれた。

> R-01 Earlier decision: Accepted risk

> R-02 Reviewer note: [文献確認: requirements.md FR4.4] 既定から外れることと deviation_ledger の 2 行（採った判断・採らなかった案）が合格の条件つきで書かれた。

> R-02 Earlier decision: Accepted risk

> R-03 Reviewer note: [検証済: FR4.1 の表を .github/workflows/ci.yml の step と 1 行ずつ照らした] core の回の `KUSABI_INTEGRATED_BUILT_EXECUTION=1` を含め一致する。

> R-03 Earlier decision: Accepted risk

> R-04 Reviewer note: [文献確認: requirements.md FR3.3・前提] Node 18 の回が落ちた時の扱いが書かれた。

> R-04 Earlier decision: Accepted risk

> R-05 Reviewer note: [文献確認: requirements.md FR2.4] 合格が「`npm ci` が 0 で終わる」と「`git status --porcelain` が何も出さない」の 2 つになった。

> R-05 Earlier decision: Accepted risk

> R-06 Reviewer note: [文献確認: requirements.md NFR2] 独立の監査の席が目で確かめることが合格に足された。

> R-06 Earlier decision: Accepted risk

### Summary

[検証済: 上の照らし] 前の見直しの 6 件はどれも直っていて、要件は package.json・package-lock.json だけを変える版上げとして、作る側が問い返さずに進められる形になっている。残るのは Minor 4 件（lock の先頭の項の engines の差分、版上げで試験が落ちた時の扱いを SDK に限らないこと、網羅率が測れない時の終わり方、閉じられる未決の問い）で、どれも承認を止めるものではない。
