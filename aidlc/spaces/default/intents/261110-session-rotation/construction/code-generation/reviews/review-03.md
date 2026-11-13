## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-11-11T22:44:56Z
**Iteration:** 1
**Verdict Dictated:** no

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/code-summary.md > 行の網羅率（NFR4） | 行の網羅率 100% の床に届かない範囲が 4 つ残っている（getuid の腕 2 か所、main().catch 2 か所）。理由は書かれているが、計り方は NODE_V8_COVERAGE を process をまたいで足し合わせる手作業で、再現する script がこの PR に無い。監査の席が同じ数字を自分で出せない。 | 網羅率の集計手順（対象の試験の一覧と足し合わせ方）を試験の手順か PR 本文に書くか、小さな script として足す。4 つの範囲は PR 本文の deviation_ledger に残し、監査で見てもらう。 | Resolved (reviewer) |
| R-02 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/code-summary.md > 気づいたこと（既定の store に試験の行が入った件） | 既定の `createStore()` を動かしてしまい、この Mac の既定の保存先（`conversation-events.json`・`raw-events.json`）に `control-seat` の行が入り、手で消して `[]` に戻した。2 つの file が試験の前から有ったかは分からないと書かれており、消した結果が元の状態と同じだったか確かめられない。 | 実害の有無を Owner に 1 行で知らせる。消した行数と退避した file の場所を記録に残す。以後の確かめは一時の HOME だけを使う（既に書かれている）。 | Resolved (reviewer) |
| R-03 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/unit-test-instructions.md > 見張りの正例の確かめ | 本物の tmux での正例（`pane_pid` の変化、条件が偽の時の `not_respawned`、2 回目の拒否）は手元で 1 回行った結果で、CI にも再実行できる試験にも入っていない。CI の試験は差し替えた tmux の模型だけを見る。 | 使い捨ての tmux を使う確かめを、環境変数などで選べる opt-in の試験か手順書として足す。据え付けの前の `probe` の確かめ（FR9.2）で必ず再確認する。 | Accepted risk |
| R-04 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/code-summary.md > 1 回目の実装監査への直し（F2 の端） | 印の無い compact で決まった不確かさの文を足す処理（F2）は、Store が開けず通常の回復が出せない縮退の道では入らない。記録には書いてあるが、FR7.1 の「曖昧な時は kusabi の DB を当たる」という文がその道で席に届かない。 | 承認の場でこの端を受け入れるか決める。受け入れるなら、縮退の道の回復の文面に同じ文を足すのを次の取り組みの候補として残す。 | Accepted risk |
| R-05 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/code-summary.md > 1 回目の実装監査への直し（F1 の端） | Stop hook の内部期限（7 秒）の後に終わる保存の行（pack・作業の状態）は Store に残りうる。印と手番の file は書かれないので切り直しの根拠にはならないが、残った行が次の回復に混ざらないかは記録に書かれていない。 | 残った行が回復で読まれても害が無い（印が無いので切り直しは起きない）ことを 1 行で書き足す。 | Accepted risk |
| R-06 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/unit-test-instructions.md > 要件ごとの試験の命令（flow・hook-registration の行のコメント）と「期待する網羅の内訳」 | 試験の件数が古いまま残っている。flow は 40 cases、hook-registration は 12 cases、status は 8 cases と書かれているが、実際に流した結果は flow 47、hook-registration 13、status 17 で、code-summary.md の Step 16 の表の数と一致する。同じ file の status の命令の行だけは 17 になっており、file の中でも食い違う。 | flow を 47、hook-registration を 13、「期待する網羅の内訳」の status を 17 に直す。または、その数を 2 回目の実装監査の直しの時点の数だと明記する。 | New |
| R-07 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/code-summary.md > 試験（この Mac の Node v26.12.1）の表 | 同じ file の二つの表で同じ試験の件数が違う。上の表は flow 40・hook-registration 12・status 8 のままで、Step 16 の表は 47・13・17。上の表が Step 16 より前の時点の数だと書かれておらず、今の main の結果と読める。 | 上の表に「#341 時点の数。今の数は Step 16 の表」と一言足すか、今の数に直す。 | New |
| R-08 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/code-generation-plan.md > Step 16.1 と code-summary.md > Step 16 の base | 計画の 16.1 は branch を origin/main の aa77b683 から切ったと書くが、code-summary.md は base を 1eef773b とする（#343 の統合を含む）。実際に 1eef773b は存在し、PR #342 の差分はそれに対して数えられている。計画に base が動いた経緯が無い。 | 16.1 に「その後 base が 1eef773b（#343 統合後）に動いた」と 1 行足す。 | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| `npx tsc --noEmit -p .` | 終了コード 0 | 型検査は通る。code-summary.md の記述と一致。 |
| `src/test-hook-input.ts`（一時の HOME と AGENT_MEMORY_HOME） | 失敗なしで終了 | FR10.1・FR10.2 の試験は通る。 |
| `src/test-session-rotation-flow.ts` | PASS 47 cases | Step 16 の表の数と一致（unit-test-instructions.md の 40 とは不一致、上の Minor）。 |
| `src/test-session-rotation-status.ts` | PASS 17 cases | Step 16 の表と一致。 |
| `src/test-rotation-hook-registration.ts` | PASS 13 cases | Step 16 の表と一致。 |
| `wc -l`（新 module と触った file） | hook-input.ts 38、hook-input-diagnostics.ts 275、hook-node-path.ts 49、session-rotation-stop.ts 757、claude-session-start.ts 630、codex-hook-installer.ts 630、claude-hook-installer.ts 629、transcript-stop-capture.ts 410、kusabi-direct-fleet-rollout.ts 2038 | code-summary.md の行数の主張と全部一致。 |
| `git diff 1eef773 94f1ca6 --stat` | src 新規 3 file、変更 9 file、scripts 2 file、新規試験 3 file、変更試験 8 file、`.gitignore` +3 行（コメントと 1 行の追加）、`package.json` 1 行 | 変更 file の数と内容は code-summary.md の表と一致。workflow と DB の作り（`src/migrate.ts`・`src/stores/`）は差分に無い。 |
| FR10.x の対応先の確認 | `src/hook-input.ts`・`src/hook-input-diagnostics.ts`（定数 200 ms・2000 ms・32 個・64 KiB）・`src/hook-node-path.ts`（絶対・正規化・basename が node・実行できる通常 file）・必須の入口の一覧（`session-rotation-stop.js` が publisher・rollout・試験の道具に存在）・`CLAUDE_SESSION_START_HOST_CONTRACT_VERSION = "2.1.220"` | traceability.json の FR10.1〜FR10.7 は、すべて実在する実装と試験に対応し、記述の中身も code と一致する。 |

### Summary

計画・試験の手順・code-summary・traceability は、マージ済みの code と要件に対して、おおむね正確で内部も整合している。FR10.1〜FR10.7 はそれぞれ実在する実装 file と試験に結ばれており、未実施の物（席への配備、FR9.2・FR9.3、Step 16.11、Node 18・20・22、Claude Code 2.1.321 での実環境）は未実施と明記されている。指摘は記録の古い数と base の経緯だけで、どれも設計や実装の判断を変えない。行の網羅率 938 行は、この review では再計測していない（coverage-method.md の手順の存在までを確認した）。
