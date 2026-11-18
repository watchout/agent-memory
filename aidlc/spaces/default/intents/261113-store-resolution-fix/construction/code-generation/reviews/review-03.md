## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-11-16T08:42:39Z
**Iteration:** 1
**Verdict Dictated:** no

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Minor | aidlc/spaces/default/intents/261113-store-resolution-fix/construction/code-generation/code-summary.md > 「変えた file」の表の `src/session-rotation-stop.ts` の行 | 行に「決めた結果を `rotation-commit` へ渡す」とあるが、`src/session-rotation-stop.ts` には `store_resolution` も `answerHookAndCommit` も無い（grep で 0 件）。結果を `rotation-commit` へ渡すのは SessionStart 側（`codex-session-start.ts`・`claude-session-start.ts` の実行結果の `store_resolution`）だけで、コードは正しい。誤っているのは記録の文 | 当該の文を削るか、「`rotation-commit` へ結果を渡すのは SessionStart の 2 つの loader」と直す | Resolved (reviewer) |
| R-02 | Minor | aidlc/spaces/default/intents/261113-store-resolution-fix/construction/code-generation/code-generation-plan.md > 1.3 の `restart-cli handoff-source` の行・D5・4 の U9 | 計画は「`runHandoffSource` が先に `resolveStore` し、結果を `createReadOnlyTaskStateReader(env, { resolution })` へ渡す」と書くが、実装は `createReadOnlyTaskStateReader()` に結果を渡さず、`readTaskStatesReadOnly` が `getTaskStates` の呼び出しごとに `requireStore(env)` を呼ぶ（`src/stores/read-only-task-states.ts:63`、`src/restart-cli.ts` の `handoff-source`）。`memory.md` の Deviations 1 は変更を記録し「計画の文は同じ PR で直した」と言うが、直っているのは標準出力の文だけで、決める所と結果の渡し方の文は古いまま（設計と実装を黙って食い違わせない、に触れる）。また 1 回の実行で `getTaskStates` が複数回呼ばれれば設定 file を毎回読み直すため、「1 回の決めを全部の読み手が使う」形ではない（今の呼び出しは 1 回なので、実害は確かめていない） | 計画の 1.3・D5・U9 を実装（reader が自分で決める。結果を受ける引数は無い）に合わせて直す。reader が結果を受けられる形に直す案もある（`restart-cli` が 1 回決めて渡す） | Resolved (reviewer) |
| R-03 | Minor | aidlc/spaces/default/intents/261113-store-resolution-fix/construction/code-generation/code-summary.md > 「変えた file」の表の `src/transcript-stop-capture.ts` の行、および code-generation-plan.md > 1.5 | 「`store_backend`（開いた store の観測）」と書くが、`src/transcript-stop-capture.ts` と `src/session-rotation-stop.ts` は `resolution.backend`（決めた値）を証拠に書く。観測との突き合わせは `requireStoreBackend`（`src/stores/index.ts`）が先に行うので、本物の store では決めた値と開いた値が一致した時だけ書かれて正しい。ただし `backend` を持たない差し替えの store は突き合わせを飛ばし、その場合の `store_backend` は観測ではない | 文を「決めた `backend` を、開いた store の `backend` と一致を確かめてから書く」と直すか、`store.backend` が無い時は `store_backend` を `null` にする | Resolved (reviewer) |
| R-04 | Minor | src/kusabi-runtime-event-emitter.ts > `createQuietStore`（接続先の比べ）と src/store-resolution.ts > `localStoreBindingSha256` | SQLite の binding の digest は `env.AGENT_MEMORY_DB_PATH \|\| 既定` から作るが、store は `resolveSqliteDbPath(undefined, env)`（`??`）で開く。`AGENT_MEMORY_DB_PATH` が空の文字だと、digest は既定の path、store は空の path を指す。27d7f8f にもある食い違いで、この PR が作ったものではなく、実際には流して確かめていない（読みだけ）。digest は宣言された path から作るので、開く path の証拠にはならない | 持ち越しとして記録に 1 行残すか、`localStoreBindingSha256` を `resolveSqliteDbPath` に合わせる（触る時に直す） | Resolved (reviewer) |
| R-05 | Minor | aidlc/spaces/default/intents/261113-store-resolution-fix/construction/code-generation/code-generation-plan.md > Summary の Tests の行 と 4 の C1 の行 | 試験の file 数が古いまま残っている。Summary は試験 3 file（store-resolution・scenario・pg）と書くが、Step 16 で isolation が足され 4 file になった。C1 の行は終わりの行を「2 file」と書くが、Step 15 と U13 は 3 file（isolation を含む）と書く。同じ計画の中で件数が食い違う。 | Summary と C1 の行の件数を、実装の head の package.json の test:store-resolution の連なりから数え直して揃え、時点を添える。 | New |
| R-06 | Minor | aidlc/spaces/default/intents/261113-store-resolution-fix/construction/code-generation/code-generation-plan.md > 1.6 の末尾（800 行の上限） | origin/main の src/kusabi-runtime-event-emitter.ts は `wc -l` で 800 行ちょうどで、team.md の最大 800 行に余白が無い。計画は「超えそうなら別 file に出す」と条件つきで書くだけで、次にこの file を触る時に必ず超える。 | 次にこの file を触る取り組みで createQuietStore を別 file に出す、と持ち越しとして記録に 1 行残す。この取り組みの差し戻しには当たらない。 | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| traceability の参照の実在確認（`git cat-file -e origin/main:<path>`、traceability.json が挙げる path 全部） | MISSING 0 件 | 追跡表の対象は全部 origin/main に実在する。 |
| CI への到達の読み（origin/main の package.json と ci.yml） | `test:claude-hook` の連なりの最後に `npm run test:store-resolution` があり、その命令は store-resolution・scenario・isolation の 3 file を流す | D10 の主張と一致。ci.yml は npm test を流さないので、test:claude-hook への接続が到達の根拠になる。 |
| createQuietStore の読み（origin/main の src/kusabi-runtime-event-emitter.ts） | 決めを 1 回、store を作る前に digest を比べ、違えば `StoreBindingDriftError`、同じ結果で PgStore か SqliteStore を作る | 1.6 の契約（SR-BF-02）の 1〜3 と一致。JSON は fixture 専用として拒否。 |
| 検査の道具 required-sections・traceability | この見直しでは流していない | 段の承認の前の blocking の検査で別に走る。 |

### Summary

保存先の決め方を核（`decideStore`）と薄い adapter に分け、拒否を閉じた理由の集合にして、読み手と書き手を同じ入口に束ね、emitter の worker にも store を作る前の接続先の比べを入れてあり、実装（origin/main）とも一致している。ブロックする指摘は無く、指摘は記録の件数の食い違いと 800 行の余白のみ（Minor 2 件）。

照らした項目: 設計・実装の標準 S1（削除経路を足さない）・S3（決め方・digest を 1 箇所に）・S4（核は env と reader を引数で受ける）・S5（開いた store の backend と決めた backend の突き合わせ、worker の digest の再計算）・S6（証拠は足すだけ、schema の const は動かさない）・S8（拒否を失敗にし、成功に数えない）・S9（URL を不透明な型に閉じる）。DB の基準は Part A の A8・A10 に当たる範囲で DDL 0 件（計画 6）。行の網羅率 100%（R-05 と測りの負例 U14）。守る物（DB の書き込みの経路。設計監査と実装監査が計画にある）。依存を入れる前の脆弱性の確かめ（新しい外部の依存 0 件、NFR9）。セキュリティ（URL を値に出さない NFR1）。
