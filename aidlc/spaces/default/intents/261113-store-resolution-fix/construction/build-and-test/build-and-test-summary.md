# Build and Test の要約（取り組み 261113-store-resolution-fix）

統合された版 `fa9f3a2f16255d723b0cb96f0e77958035f7b11e`（PR #347 の merge commit。base は `27d7f8f`）の build と試験を、清潔な clone で流した結果の要約。手順の元は `code-generation-plan.md`、作った物は `code-summary.md`、単体の命令は `unit-test-instructions.md` にある。数は、この段（2026-11-17）に流した命令の出力から機械で取り出した値。

## 1. 結論

- **build と試験は通り、`Target Verification Matrix` の 19 行のうち 17 行は `Met`、1 行は `持ち越し`（BT-06。この段では流し直していない）、1 行は `N/A`（CI の義務。この計画に CI Pipeline が無い）。`Unverified`・`Not Met`・`Pending` は 0 行。**
- 流した命令 39 回（1 回目の一式 25・`npm test` の流し直し 1・網羅率の一式 13）のうち、終了コードが 0 でなかったのは 1 回だけ（`npm test` の最初の 1 回）。原因は試験の前からある脆さと流し方の環境（temp の名前）で、段の手順の「段の中の直し」の 1 回目（環境を直して流し直し）で通った。code・試験の file は変えていない（`test-results.md` の 3）。
- 準備の状態: build-ready = はい、test-ready = はい、deployment-ready = **Deployment Pipeline へ進める**。実際の配り（版の作成・本番の表と列の確認・席の hook の差し替え）は守る物で、この段では行っていない（5）。
- この段で直していない観測が 4 つ（`BT-OBS-1`〜`BT-OBS-4`。`test-results.md` の 7）と、前の段から持ち越した 3 つ（OBS-1、見直し 3 回目の Minor の R-05・R-06。詳しくは 6）がある。特に **BT-OBS-2（CI の `Run post-tool-hook tests` が試験を 1 件も流さずに成功する）は、`ci.yml`（守る物）を変える話で、Owner の判断が要る**。

## 2. 作った手順書と、試験の種類

| 種類 | file | 内容 |
|---|---|---|
| build | `build-instructions.md` | 清潔な clone から `npm ci`・`tsc --noEmit`・`npm run build` |
| 単体 | `unit-test-instructions.md`（Code Generation が作った物を、この段で流した） | 新しい 3 本と今ある試験の命令 |
| 統合 | `integration-test-instructions.md` | 入口どうしの組み合わせ（S1〜S6・U5〜U10 ほか）と PostgreSQL の手順 |
| 性能 | `performance-test-instructions.md` | **N/A**（性能の数値の要件が無い。NFR4 の「上限を変えない」は代わりの確かめ） |
| 安全 | `security-test-instructions.md` | URL を出さない・拒否の組・依存と設定・DB を変えない・`npm audit` を流せなかったこと |
| 結果 | `test-results.md` | 命令ごとの結果、最初の失敗の分類、CI の log、網羅率、試験の file の型検査、観測 |
| 追跡 | `cross-unit-traceability.md` | 42 件の要件を、この段の確かめに結ぶ |

## 3. 数の要約

| 項目 | 結果 |
|---|---|
| 新しい試験（`test-store-resolution` 系 4 本） | 57・40・9・5（`test-store-resolution.ts`・`-scenario`・`-isolation`・`-pg`）、全部通った |
| 今ある試験（core） | `1832 passed, 0 failed`（CI の形でも同じ） |
| 今ある試験（そのほかの結果の行） | spec-enforcement `24 passed, 0 failed`・SQLite `206 passed, 0 failed`・boot recovery `28 passed, 0 failed`・PostgreSQL（`npm run test:pg`）`147 passed, 0 failed`・post-tool-hook（`AGENT_MEMORY_DB_TYPE=sqlite` を付けた形）`45 passed, 0 failed`・direct fleet rollout 159 assertions |
| `npm test`（全体） | 最初の 1 回は終了コード 1（環境の誤り。3 に分類）、temp の名前を直した流し直しで終了コード 0 |
| 行の網羅率（変えた行・足した行） | 12 file・追加行 487・未実行 0（全部の命令 13 個・CI が届く 10 個・CI が本当に流す 9 個の 3 つの組で同じ）。自己試験 16 件 |
| 型検査 | `tsc --noEmit` 終了コード 0・出力 0 行。試験の file を含む別の設定では 89 件の誤り（base と同じ。新しい file は 0 件） |
| CI（PR #347 の run 43806507709・merge 後の run 43812014201） | どちらの run も 3 つの Node の版（18・20・22）の job が全部 success。run ごとに、新しい 3 本の件数の行が 9 行（3 つの job × 3 行） |

## 4. Target Verification Matrix

対象の洗い出し: `requirements.md` の NFR1〜NFR9 と FR、`code-generation-plan.md` の `## Testing Contract`（方式 `custom`・戦略 `minimal`・scope `bugfix`）、`team.md` の試験の決まり（行の網羅率 100%・PostgreSQL の試験は手元・CI は Node 18・20・22）、`project.md` の学び（型検査の設定を書く・使い捨ての `HOME`）。`nfr-requirements/`・`nfr-design/` の folder はこの取り組みに無い（scope が `bugfix`）。

| Target ID | Source | Expected | Actual | Evidence | Owning Stage | Verdict |
|---|---|---|---|---|---|---|
| BT-01 | `team.md` Code Style・`tsconfig.json` strict | `npx tsc --noEmit` が終了コード 0・出力 0 行 | 終了コード 0・出力 0 行 | `build-instructions.md` の 4 | build-and-test | Met |
| BT-02 | `package.json` の `build` | `npm run build` が終了コード 0 で `dist/` ができる | 終了コード 0・`dist/` 直下 337 件 | `build-instructions.md` の 4 | build-and-test | Met |
| BT-03 | `## Testing Contract`（戦略 `minimal`・scope floor） | 要件ごとに検証できる試験が 1 つ以上・入口（SessionStart 4・Stop 2・`rotation-commit`・`restart-cli`・emitter）ごとに正常系 1 つ以上・不具合の再発を捕まえる試験 | 42 件の要件の全部に、通った試験の組か別の道の確かめが結ばれた（未対応 0）。入口ごとの正常系は U5〜U10 と S3 | `cross-unit-traceability.md` の 2 | build-and-test | Met |
| BT-04 | FR1〜FR4・FR5.1〜FR5.4 | 新しい試験（核・adapter・入口・Stop の証拠・`restart-cli`・emitter）が全部通る | `57` と `40` の `ok -` の行が全部通り、終了コード 0 | `test-results.md` の 2.1 | code-generation（この段で流し直した） | Met |
| BT-05 | FR5.5・FR6.2（S2・S5・U12） | 使い捨ての PostgreSQL で、書いた先と読む先が同じ・表と列が全てある | `5` 件（`store-resolution-pg: 5 checks passed`）。`npm run test:pg` も `147 passed, 0 failed` | `test-results.md` の 2.4 | code-generation（この段で流し直した） | Met |
| BT-06 | FR5.6 | 新しい試験が、直す前の code では失敗する | Code Generation が、直す前の code（base `27d7f8f` の `src/` の写し）に新しい試験を当てて取った結果の写し: S1・S6 の 8 件のうち 7 件が失敗（S1 が 4 件、S6 が 3 件。S6 の正例 1 件は通る）、S2 は不具合の再現（Stop が既定の SQLite に保存し、SessionStart は 0 行を読む）、S3・S4 は 9 通りのうち 2 通りで入口の決め方が分かれた、S5 は `emergency_only`。この写しが、Code Generation の作業の場所に残る元の出力 3 つ（S1・S6、S2・S3・S4、S5）と一致することは、この段で突き合わせた。**ただし持ち越した結果で、この段では流し直していない（直す前の code の stand-in を作り直していない）**。段の承認の入力（Owner の決定 95、https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6934340758）が「Met ではなく『持ち越し』として記録する。出所は Code Generation の結果の写しと #347 の独立の実装監査で、この段では流し直していない」と指示したので、この行は `Met` に数えない | `unit-test-instructions.md` の 4 | code-generation | 持ち越し |
| BT-07 | FR5.7・IM-BF-01 | 試験が、この Mac の実際の保存先・席の設定・版の置き場を書き換えない | isolation 9 件が通り、流す前後の守る物の比べで変わった物は 0 件（3 つの一式） | `test-results.md` の 1 | build-and-test | Met |
| BT-08 | FR5.8・`## Testing Contract` の scope floor | 今ある試験が通ったまま | 単体の命令 14 回・CI の `run:` の step 8 回・`npm test`（流し直し）が終了コード 0。core `1832 passed, 0 failed`。CI の `post-tool-hook` の step が試験を 1 件も流さない件は BT-OBS-2 | `test-results.md` の 2.1〜2.3 | build-and-test | Met |
| BT-09 | NFR6・`team.md`（行の網羅率 100%） | 変えた行・足した行の未実行 0 | 12 file・追加行 487・未実行 0・読めなかった file 0（3 つの組）。自己試験 16 件 | `test-results.md` の 5 | build-and-test | Met |
| BT-10 | FR6.1・FR6.3 | DDL の行 0・本番の DB に触れない | 試験でない 12 file の追加行（487）に `CREATE`・`ALTER`・`DROP`・`TRUNCATE` を含む行 0（試験の file には、使い捨ての schema を作って消す 2 行と正規表現 1 行の 3 行だけ）。`pg-migrations.ts` は SHA-256 が base と同じ。本番の接続先はこの段に無い | `security-test-instructions.md` の 5 | build-and-test | Met |
| BT-11 | NFR1 | 接続先の URL を、証拠・log・誤りの文・記録に出さない | U4・U5（PostgreSQL に繋げない決めと、鍵・証明書の path を名指す URL の 2 件を含む）・U2・U6 が通る。使い捨ての接続先の URL の形を含む出力の file は 0（1 回目・流し直し・網羅率・CI の log）。利用者名を問わない広い調べで 1 file が該当したが、今ある Gate 0 試験の偽の fixture の名前の行で、この PR は `tests/` を変えていない | `security-test-instructions.md` の 2 | build-and-test | Met |
| BT-12 | NFR2・NFR3・FR7 | 核は入力だけで決まる・決め方の literal は 1 か所（と持ち越しの一覧） | `store-resolution.ts` に時刻・乱数・識別子の取得が 0 件、`process.env` は 2 つの adapter の引数の既定値だけ。U11 が通る | `security-test-instructions.md` の 7・`test-results.md` の 2.1 | build-and-test | Met |
| BT-13 | NFR4 | 時間の上限を変えない・決める処理に通信が無い | `src/constants.ts` は差分に無い。時間に関わる語を含む試験でない行 8 は引数の渡しの書き換えだけ。`store-resolution.ts` に通信の import が 0 | `performance-test-instructions.md` の 2 | build-and-test | Met |
| BT-14 | NFR5・FR3.2 | 拒否・不一致・保存の失敗を成功と数えず、host を止めない | U7・S1・seam が通る。拒否の回の証拠の `reason` は `store_refused:<理由>`、出力は「続ける」のまま、`transcript-stop-capture` の `outcome` は `unobserved`（scenario の試験が確かめる）。拒否・接続できない回に SQLite の file は作られない（S1 の 4 件） | `security-test-instructions.md` の 3 | build-and-test | Met |
| BT-15 | NFR7・FR4.4 | 戻しは merge commit の revert で base に戻る。証拠は足すだけで、旧い読み手が壊れない | 使い捨ての clone で merge commit を戻すと、PR が変えた 51 file が戻り、base `27d7f8f` との差が 0 file（tree が base と同じ）。証拠の schema 定数は変えず、項目の足しは `store_backend`・`store_source` の 2 つ、`reason` の取る値に `store_refused:<理由>` が増えた。この repository の `src` に、Stop の証拠の JSON の読み手は試験以外に無い（検索の時点の読み）。**他の repository の読み手は追っていない。旧い hook と新しい hook を同時に流す試験は流していない** | この要約の 6 | build-and-test | Met |
| BT-16 | NFR8・U13・C1 | CI の Node 18・20・22 の job で、新しい試験の件数の行が job ごとに 3 行出て、job が success | run 43806507709・43812014201 のどちらも 3 job が success、run ごとに件数の行 9（3 job × 3 行）。U13 が通る。手元の実行は Node v26.13.1 の 1 つだけ | `test-results.md` の 4 | build-and-test | Met |
| BT-17 | NFR9 | 新しい外部の依存を足さない | `dependencies` ほか 8 つの項目が base と同じ。`package-lock.json` の SHA-256 が同じ。`scripts` の変更は 4 key | `security-test-instructions.md` の 4 | build-and-test | Met |
| BT-18 | `project.md`（型検査の設定と対象の file を記録に書く） | 試験の file を含む型検査の結果が base と同じで、新しい file の誤りが 0 | 誤り 89 件（15 file）が base と同じ。新しい 6 file と `store-resolution.ts` は 0 件 | `test-results.md` の 6 | build-and-test | Met |
| BT-19 | `## Testing Contract` の CI の義務（統合の前に CI で試験を流す） | 統合の前に CI で試験を流す | the plan runs no CI Pipeline（`aidlc-state.md` の `ci-pipeline` は `SKIP`） | `aidlc-state.md` | — | N/A |

`N/A` は BT-19 の 1 行だけで、段の手順が許す形（CI の義務・この計画に CI Pipeline が無い）に当たる。この PR の CI は実際に流れ、結果は BT-16 に書いた。

`持ち越し` は BT-06 の 1 行だけ。段の手順の判定の語（`Met`・`Not Met`・`Unverified`）にない、Owner の入力の言葉をそのまま使った印で、「前の段の結果を引いた行で、この段では流し直していない」を表す（この文書で使う語としての意味）。`Met` には数えない。段の手順は `Unverified` を失敗として扱うが、この行は Owner の承認の入力が「持ち越しとして記録する」と指示した形で残す。流し直す場合は、直す前の code の stand-in（base `27d7f8f` の `src/`）を作り直す。

## 5. この段で確かめていないこと（持ち主つき）

次の物は、この段の対象（`requirements.md` の要件）ではなく、Deployment Execution 以降の作業か、この席が流せなかった確かめ。守る物（版の置き場・本番・席の hook）はこの席は行わない。要件の対象ではないので `Unverified` の行にはしていないが、流せなかった・まだ行っていない事実は成功に数えない。

| 物 | 状態 | 持ち主 |
|---|---|---|
| 版（content-addressed release）の作成と `.kusabi-releases` への配置 | まだ作っていない（置き場の stat の digest は、この段の前後で変わらなかった） | Deployment Execution（Owner の決定 `OD-KUSABI-STORE-RESOLUTION-RELEASE-PRODCHECK-R1-SELF-SEATS-20261116-001`） |
| 本番の表と列の名前の突き合わせ（4 表） | 本番は読んでいない。一覧は `unit-test-instructions.md` の 8 | Owner と arc |
| Kusabi 自身の 2 席の hook の差し替え | Claude の席は適用済み（`settings.json` の hook 5 つ）、Codex の席は差し替え済みで起こし直していない | arc の script と Owner の入力 |
| 引き継ぎの書き込みの観測（回転の確かめ（b）） | **観測できず**（次に自然に起きる回転の回の、席の手元の証拠でだけ見る。成功に数えない） | arc と席 |
| `npm audit` | 流せなかった（hook に 2 回止められた）。`npm ci` は `1 low severity vulnerability` を出し、`package-lock.json` は base と同じ | `npm audit` を流せる席または Owner |

## 6. 観測と限界

- **BT-OBS-1**: `test-session-start-auto-receive.ts` の期待値が `replaceAll("/", "-")` だけで、`TMPDIR` の経路に `_`・`.` があると落ちる（base にもある）。直すのは次の取り組み。
- **BT-OBS-2**: CI の `Run post-tool-hook tests` は、`AGENT_MEMORY_DB_TYPE` が `sqlite`・`json` でなく URL も無いと、`src/post-tool-hook.ts` が `process.exit(0)` するので、試験の本体に届かず成功する（run 43812014201 の 3 つの Node の job とも）。S8 に当たる。`ci.yml` を変える話なので Owner の判断。この PR の網羅率は、この step を外しても 100%。
- **BT-OBS-3・BT-OBS-4**: `npm audit` を流せなかったこと、`npm ci` の install script の警告。
- 持ち越し: OBS-1（`AGENT_MEMORY_DB_PATH` が空文字の時の `||` と `??`）、見直し 3 回目の Minor の R-05（計画の Summary と C1 の行の、試験 file の数の古さ）・R-06（`kusabi-runtime-event-emitter.ts` が上限の 800 行ちょうど。次に触る取り組みで `createQuietStore` を別 file に出す）。R-05・R-06 は `reviews/review-03.md` の番号で、計画の R-05（arc の持ち越しの決め = 網羅率の対象）とは別の物。
- BT-15 の戻しの確かめ（使い捨ての clone。席・DB・版の置き場に触れない）: `git revert -m 1 --no-commit fa9f3a2f16255d723b0cb96f0e77958035f7b11e` が終了コード 0 で、PR が変えた 51 file が戻り、戻した後の index と base `27d7f8f` の差は 0 file、`git write-tree` は base の tree と同じ（yes）。
- 限界: 手元の実行は Node v26.13.1 の 1 つだけ（Node 18・20・22 は CI の log）。BT-15 の「旧い読み手が壊れない」は、この repository の中の読み手だけを追った。旧い hook と新しい hook を同時に流す試験は流しておらず、NFR7 のその文は「証拠の項目が足すだけ」の確かめ（BT-15）で読んだ。BT-06 は Code Generation の記録を引き、この段では流し直していない。

## 7. 社内の基準の項目への照らし（見直し役と段の承認が使う）

`requirements.md` が定めた項目の ID に照らした結果。

| 項目 | この段の照らし |
|---|---|
| S3（知識は 1 か所） | BT-12。U11 が通る。literal は `store-resolution.ts` と持ち越しの一覧だけ |
| S4（時刻・乱数は明示入力） | BT-12。核に取得が 0 件 |
| S5（宣言は証拠でない） | BT-14。証拠の `store_backend` は開いた store の値。不一致は失敗 |
| S6（schema は可逆で同居） | BT-10・BT-15。migration を足さない・revert で base に戻る |
| S8（失敗を隠さない） | BT-14。この PR は隠さない。**既存の CI step が試験を流さない件を BT-OBS-2 に記録**（この PR の外） |
| DB の基準 Part A の A8（S6）・A10（S7） | BT-10。migration を足さず、Stop の保存の経路は変えない |
| 行の網羅率 100%（NFR6） | BT-09 |
| 守る物（Q2 = A） | BT-07・BT-10。この段は版・本番・席の設定・workflow に触れていない |
| 依存を入れる前の脆弱性の確かめ | 依存を入れないので対象外（`requirements.md`）。ただし既存の `npm ci` の低い深刻度の指摘 1 件は、詳細を見られていない（5） |

## 8. 次の段への受け渡し

- 次は Deployment Pipeline（`deployment-pipeline`）。入力: この要約の 5（まだ行っていない配りの作業）。
- 配りは、Owner の決定の範囲（版の作成・本番の表と列の名前の確認・席の hook）で、arc の script と Owner の入力で行う。席は実行しない。
- BT-OBS-2 は Owner の判断待ちで、この取り組みの流れを止めない。
