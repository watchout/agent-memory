## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-11-16 (依頼文に `Date for this review:` の行が無かったため、環境の日付を書く)
**Iteration:** 1
**Verdict Dictated:** no

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Minor | aidlc/spaces/default/intents/261113-store-resolution-fix/construction/code-generation/code-summary.md > 「変えた file」の表の `src/session-rotation-stop.ts` の行 | 行に「決めた結果を `rotation-commit` へ渡す」とあるが、`src/session-rotation-stop.ts` には `store_resolution` も `answerHookAndCommit` も無い（grep で 0 件）。結果を `rotation-commit` へ渡すのは SessionStart 側（`codex-session-start.ts`・`claude-session-start.ts` の実行結果の `store_resolution`）だけで、コードは正しい。誤っているのは記録の文 | 当該の文を削るか、「`rotation-commit` へ結果を渡すのは SessionStart の 2 つの loader」と直す | New |
| R-02 | Minor | aidlc/spaces/default/intents/261113-store-resolution-fix/construction/code-generation/code-generation-plan.md > 1.3 の `restart-cli handoff-source` の行・D5・4 の U9 | 計画は「`runHandoffSource` が先に `resolveStore` し、結果を `createReadOnlyTaskStateReader(env, { resolution })` へ渡す」と書くが、実装は `createReadOnlyTaskStateReader()` に結果を渡さず、`readTaskStatesReadOnly` が `getTaskStates` の呼び出しごとに `requireStore(env)` を呼ぶ（`src/stores/read-only-task-states.ts:63`、`src/restart-cli.ts` の `handoff-source`）。`memory.md` の Deviations 1 は変更を記録し「計画の文は同じ PR で直した」と言うが、直っているのは標準出力の文だけで、決める所と結果の渡し方の文は古いまま（設計と実装を黙って食い違わせない、に触れる）。また 1 回の実行で `getTaskStates` が複数回呼ばれれば設定 file を毎回読み直すため、「1 回の決めを全部の読み手が使う」形ではない（今の呼び出しは 1 回なので、実害は確かめていない） | 計画の 1.3・D5・U9 を実装（reader が自分で決める。結果を受ける引数は無い）に合わせて直す。reader が結果を受けられる形に直す案もある（`restart-cli` が 1 回決めて渡す） | New |
| R-03 | Minor | aidlc/spaces/default/intents/261113-store-resolution-fix/construction/code-generation/code-summary.md > 「変えた file」の表の `src/transcript-stop-capture.ts` の行、および code-generation-plan.md > 1.5 | 「`store_backend`（開いた store の観測）」と書くが、`src/transcript-stop-capture.ts` と `src/session-rotation-stop.ts` は `resolution.backend`（決めた値）を証拠に書く。観測との突き合わせは `requireStoreBackend`（`src/stores/index.ts`）が先に行うので、本物の store では決めた値と開いた値が一致した時だけ書かれて正しい。ただし `backend` を持たない差し替えの store は突き合わせを飛ばし、その場合の `store_backend` は観測ではない | 文を「決めた `backend` を、開いた store の `backend` と一致を確かめてから書く」と直すか、`store.backend` が無い時は `store_backend` を `null` にする | New |
| R-04 | Minor | src/kusabi-runtime-event-emitter.ts > `createQuietStore`（接続先の比べ）と src/store-resolution.ts > `localStoreBindingSha256` | SQLite の binding の digest は `env.AGENT_MEMORY_DB_PATH \|\| 既定` から作るが、store は `resolveSqliteDbPath(undefined, env)`（`??`）で開く。`AGENT_MEMORY_DB_PATH` が空の文字だと、digest は既定の path、store は空の path を指す。27d7f8f にもある食い違いで、この PR が作ったものではなく、実際には流して確かめていない（読みだけ）。digest は宣言された path から作るので、開く path の証拠にはならない | 持ち越しとして記録に 1 行残すか、`localStoreBindingSha256` を `resolveSqliteDbPath` に合わせる（触る時に直す） | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| 読むだけの確かめ（試験・build・DB は動かしていない） | 実行せず | 件数（55・40・5・1832・24 本）は記録の主張で、この見直しでは再実行していない。確かめていない |
| `git show origin/main:<path>` と作業場の file の比較（12 file の追加行の数） | 合計 474。記録の表と file ごとに一致（240・41・40・8・4・4・36・29・20・17・4・31） | `code-summary.md`・`coverage-method.md` の数と合う。`git diff origin/main` は index に無い file を「削除」と読むため、blob 比較で数えた |
| `src/stores/pg-migrations.ts` と base の比較 | byte 同一 | DDL 0 件の主張と合う（DB の基準: 構造は変えない） |
| `reveal()` を呼ぶ所（試験を除く src） | `store-resolution.ts`（`storeBindingSha256`）・`stores/index.ts`・`stores/read-only-task-states.ts`・`kusabi-runtime-event-emitter.ts` の 4 か所 | 計画どおり 4 か所。`StoreTarget` は `toString`・`toJSON`・`inspect` が固定の語 |
| 行数 | `store-resolution.ts` 240・`kusabi-runtime-event-emitter.ts` 800（base 794）・`codex-session-start.ts` 1052（base 1122）・新しい試験 file は最大 731 | 800 行以内（触った 800 超の file は減っている）。絵文字・`\|\| true`・`continue-on-error` は、読んだ範囲で無し |
| 決め方の literal（`AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`database_url`）を持つ src（試験を除く） | `store-resolution.ts` のほか、持ち越しの一覧にある `stores/index.ts`・`codex-start.ts`・`kusabi-fresh-session-fleet.ts`・`post-tool-hook.ts`・`kusabi-direct-fleet-rollout.ts`・`fleet-conversation-backfill.ts`（`codex-session-start.ts` は注釈の 1 語だけ） | emitter と SessionStart から literal が消えている。残りは計画の D7・3 の持ち越しの一覧と合う |
| `package.json` の差分 | scripts の 4 行だけ。`test:claude-hook`（`ci.yml` の step が呼ぶ）の連なりの最後に `npm run test:store-resolution` | workflow は変えていない。CI へ届く形は計画の D10 どおり |

### Summary

設計どおりに実装されている。決める順（環境の種類 → 環境の URL → 設定 file の `database_url` → 既定の SQLite）、環境で決まる時に設定 file を読まない点、設定 file の「無い」が ENOENT だけの点、SessionStart 4 種・Stop 2 種・`rotation-commit`・`restart-cli`・emitter が同じ関数を使う点、emitter が結果から digest を作り直して store を作る前に比べる点を、コードを読んで確かめた。拒否は閉じた集合で、URL・path・値を出さず、DDL は 0 件。残る指摘は記録の文と計画の文が実装と食い違う Minor 4 件で、直さなくても動作は変わらない。

照らした基準の項目: 設計・実装の標準 S1（DDL 0・移行の追加なし）、S3（決め方 1 箇所。持ち越しの一覧の理由は妥当）、S4（`decideStore` は時計・乱数・環境を自分で取らない）、S5（`requireStoreBackend` の突き合わせ。ただし指摘 3）、S6（証拠は足すだけで schema の const は不動）、S8（失敗を隠す書き方は無い。close の失敗が拒否を隠さない）、S9（資格情報は URL の不透明化のみ）、DB の基準の Part A・B（DDL なし・`pg-migrations.ts` は base と同一）、行の網羅率 100%（`coverage-method.md` の数は追加行の数と一致。再実行はしていない）、守る物（席・本番に何も実行していない）、セキュリティ（URL を `StoreTarget` に閉じ込め、`reveal()` は 4 か所）、authority-and-waiting R3（指摘 2）。
