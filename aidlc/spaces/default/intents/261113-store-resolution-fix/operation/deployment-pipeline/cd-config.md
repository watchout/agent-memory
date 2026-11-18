# CD の構成（取り組み 261113-store-resolution-fix）

この文書は、統合された版 `fa9f3a2f16255d723b0cb96f0e77958035f7b11e`（PR #347 の merge commit。base は `27d7f8f`）を、どの道で、誰が、どの門を通して席へ配るかを書く。配る道は新しく作らず、既にある物と Owner の決定の手順のまま使う。方式の選びは `deployment-strategy.md`、戻しは `rollback-runbook.md`、問いと答えは `deployment-pipeline-questions.md`。

## 1. 結論

- この取り組みの CD は、**CI からの自動の配りではなく、Owner が打つ 3 つの script の連なり**（版の公開、本番の表と列の名前の確認、席の hook の差し替え）。根拠は、Owner の決定 `OD-KUSABI-STORE-RESOLUTION-RELEASE-PRODCHECK-R1-SELF-SEATS-20261116-001`（https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6910764201 、本文の SHA-256 `a378655b6cd927b24a9c6da1cc5025f268b29f9dd581caf2a75bd71eef1ca881`）の 4。
- 席（この会話）は、保護面（版の置き場・本番の DB・席の hook）に何も実行しない。Owner と arc の script の結果を、データとして読んで記録する（`deployment-pipeline-questions.md` の Q2 = B）。
- CD の workflow は足さない。`ci.yml` の job は `build-and-test` の 1 つで、公開・配りの step は 0 件（この段で数えた）。workflows は守る物で、足すには Owner の exact-head が要る。
- feature flag は使わない（保存先の決め方の変更で、出し入れする機能ではない。AWS も使っていない）。

## 2. 入力（上流の記録）と、無い物

段の手順が入力に挙げる 4 つの記録（`ci-config`・`quality-gates`・`infrastructure-specification`・`cicd-pipeline`）は、**存在しない**。bugfix の scope は CI Pipeline と Infrastructure Design の段を行わないので、段の手順の Step 1 のとおり、無い物を作らず、既にある物に当たった。

| 当てた物 | 中身 | 出どころ |
|---|---|---|
| 版の作り手 | 候補・公開・読み戻しの 3 つの mode を持つ script | `scripts/build-kusabi-content-addressed-runtime-release.mjs`（`package.json` の `build:`・`publish:`・`readback:kusabi-content-addressed-runtime-release`） |
| 席への配りの runbook | 段（R0〜R4）・止める条件・戻し | `docs/operations/KUSABI_ALPHA_FLEET_ROLLOUT.md` の 6・8・9 |
| CI | Node 18・20・22 の `build-and-test` の 1 job。push と PR（main 向け） | `.github/workflows/ci.yml` |
| 試験と網羅率の結果 | 17 行 `Met`・1 行 `持ち越し`・1 行 `N/A` | `construction/build-and-test/build-and-test-summary.md` |
| 本番に確かめたい表と列の一覧 | 4 表と列の名前 | `construction/code-generation/unit-test-instructions.md` の 8 |
| 配りの決定 | 3 つの手順と、配る先 | 上の Owner の決定 |
| 差し替えの記録 | install4.sh が書き込みの前に投稿した記録（本文の SHA-256 `aa2486f6e93f92d7dbfda81a099d8eb1f4ae5934db8f342848e3a4729abb48c2`） | https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6911141083 |

`docs/operations/DEPLOYMENT.md` は枠だけで、中身は「[要記入]」の 1 行。この取り組みでは埋めない（repo の文書の変更で、別の取り組み）。

## 3. 配りの手順

| # | 手順 | 道具 | 打つ人 | 効果 | 通る条件・出力 |
|---|---|---|---|---|---|
| 1 | 候補の版を作る | `--mode candidate` | Owner の許可の範囲（置き場の中に書くため） | 置き場の `.staging` に、読み取り専用の候補を 1 つ作って残す。最終の場所（`sha256/`）には出さず、席の設定には触れない | `CANDIDATE_VERIFIED`。証拠の `protected_effects` の 3 項目（`final_cas_publication`・`fleet_rollout`・`restart`）が 0 |
| 2 | 版を置き場に公開する | `--mode publish --expected-head <40 桁>`（arc の publish.sh） | Owner | `~/Developer/.kusabi-releases` に追加だけ。既存の版は消さず、上書きしない | `FINAL_CAS_PUBLISHED_AND_VERIFIED`。`publication` は `ATOMIC_RENAME_NEW_CAS` か `IDEMPOTENT_SUCCESS_NO_WRITE`。同じ場所に別の中身があれば `CAS_FINAL_COLLISION` で止まる |
| 3 | 公開した版を読み戻す | `--mode readback --release-sha <64 桁>` | Owner | 読むだけ | `PASS_EXACT_READBACK` |
| 4 | 本番の DB に表と列の名前があるかを確かめる | arc の prodcheck.sh | Owner | 読み取りだけ（名前だけ。行の値・件数・接続の文字列は読まない・出さない。DDL 0 行） | 4 表すべてに、一覧の列がある |
| 5 | Kusabi 自身の 2 席の hook を、手順 2 の版に差し替える | arc の install4.sh | Owner | 席の設定を書く（installer が backup を 1 つずつ取る） | 2 席の設定 file の hash が、差し替えの前後で記録と合う |
| 6 | 観測する | 席が読む（Q1 = B・Q2 = B） | 席（読むだけ） | 無し | `deployment-strategy.md` の 2 |
| 7 | R2 以後に進むか決める | Owner への問い | Owner | — | 6 が「一致」の時だけ、改めて伺う |

手順 2〜5 の script は、arc が作り、arc-sec が読んで通してから、Owner が打つ（決定の 4）。**この席は arc の script（publish.sh・prodcheck.sh・install4.sh）を読んでいない。** 上の表のうち、script の名前と「何をするか」は、決定と差し替えの記録の文から取った。手順 1〜3 の mode・出力名・条件は、repo の script のコードを読んで書いた。

版の作り手（repo の script）の性質（コードを読んだ事実）:

- 公開には、清潔な worktree と、HEAD が `--expected-head` と一致することが要る（`SOURCE_BOUNDARY_FAILED`）。公開の途中で HEAD・tree・worktree が変われば止まる。
- 作り方は `npm ci --ignore-scripts` と `npm run build`。置く物は `dist/` の入口 12 個と、schema 10 個、依存（`npm ci --omit=dev --ignore-scripts --no-bin-links`）。
- まず置き場の `.staging` に作り、0555 の読み取り専用にして、1 回の rename で置き場の `sha256/<記述子の SHA-256>` に出す。公開した後に読み戻しか最終の確かめが合わなければ、自分が作った場所だけを、持ち主の確認（device・inode・記述子の digest）を通して戻す（`rollbackOwnedFinal`）。

## 4. 環境の昇格の表

環境は「席の束」で、AWS の環境（dev・staging・prod）はこの取り組みに無い。

| 束 | 席 | 配る手段 | 次へ進む門 | 今回の許可 |
|---|---|---|---|---|
| R1 | Kusabi 自身の 2 席（Claude の tmux `aidlc-kusabi`・Codex の tmux `kusabi`） | 手順 5 | 手順 6 が、2 席とも「一致」（`deployment-strategy.md` の 2） | あり（決定の 3） |
| R2 以後 | ほかの席 | 今回は決めない | R1 の観測の後に、改めて Owner に伺う | **なし** |

## 5. 品質の門と、Owner の許可

| 門 | 条件 | 状態（この記録を書いた時） |
|---|---|---|
| 統合した版の確かめ | PR #347 が、CI（Node 18・20・22）と独立の監査を通って統合された | `build-and-test-summary.md` の BT-16 と、決定の前提（Owner の exact-head https://github.com/watchout/agent-memory/pull/347#issuecomment-6908400201 ） |
| 版と統合の一致 | 手順 2 が `--expected-head fa9f3a2f…` を要求し、一致しなければ止まる | コードを読んだ。公開が実際に通ったかは、この段で観測していない |
| 本番に表と列がある | 手順 4 | 観測していない（Owner が打つ） |
| 席の差し替え | 手順 5 | **宣言のみ。** 差し替えの記録は、script が書き込みの前に投稿した物（API の `created_at` は 2026-11-16T08:19:12Z）で、差し替えが成功した証拠ではない。成功したかは、席が設定 file の hash を読んで確かめる（Q2 = B。Deployment Execution） |
| 保護面 | 版の置き場・本番の DB・席の hook は Owner の許可 | Owner の決定の範囲（Kusabi 自身の 2 席）だけ。ほかの席・壊れた `memory.db` の扱い・表と列の追加・G6 は許可に入らない |

## 6. 確かめたことと、確かめていないこと

- 確かめた: `ci.yml` の job の数と公開 step の有無、版の作り手の mode・出力名・条件（コード）、installer が差し替えの前の設定の backup を取ること（`test-claude-hook-installer.ts`・`test-codex-hook-installer.ts`）。
- 確かめていない: arc の 3 つの script の中身、手順 2〜5 が実際に通ったか、席の設定 file の中身と hash、置き場にある版の一覧。これらは Deployment Execution で、記録と突き合わせる（`project.md` の決まり: 記録の前提は、実行の前に取り直す）。
- 数の出どころ: 入口 12 個と schema 10 個は、script の `ENTRYPOINTS`・`RUNTIME_RESOURCES` の配列から数えた。
