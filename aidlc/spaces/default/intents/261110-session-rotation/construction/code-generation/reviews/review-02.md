## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-11-11T06:26:32Z
**Iteration:** 1
**Verdict Dictated:** no

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/code-summary.md > 行の網羅率（NFR4） | 行の網羅率 100% の床に届かない範囲が 4 つ残っている（getuid の腕 2 か所、main().catch 2 か所）。理由は書かれているが、計り方は NODE_V8_COVERAGE を process をまたいで足し合わせる手作業で、再現する script がこの PR に無い。監査の席が同じ数字を自分で出せない。 | 網羅率の集計手順（対象の試験の一覧と足し合わせ方）を試験の手順か PR 本文に書くか、小さな script として足す。4 つの範囲は PR 本文の deviation_ledger に残し、監査で見てもらう。 | Resolved (reviewer) |
| R-02 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/code-summary.md > 気づいたこと（既定の store に試験の行が入った件） | 既定の `createStore()` を動かしてしまい、この Mac の既定の保存先（`conversation-events.json`・`raw-events.json`）に `control-seat` の行が入り、手で消して `[]` に戻した。2 つの file が試験の前から有ったかは分からないと書かれており、消した結果が元の状態と同じだったか確かめられない。 | 実害の有無を Owner に 1 行で知らせる。消した行数と退避した file の場所を記録に残す。以後の確かめは一時の HOME だけを使う（既に書かれている）。 | Resolved (reviewer) |
| R-03 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/unit-test-instructions.md > 見張りの正例の確かめ | 本物の tmux での正例（`pane_pid` の変化、条件が偽の時の `not_respawned`、2 回目の拒否）は手元で 1 回行った結果で、CI にも再実行できる試験にも入っていない。CI の試験は差し替えた tmux の模型だけを見る。 | 使い捨ての tmux を使う確かめを、環境変数などで選べる opt-in の試験か手順書として足す。据え付けの前の `probe` の確かめ（FR9.2）で必ず再確認する。 | Unresolved |
| R-04 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/code-summary.md > 1 回目の実装監査への直し（F2 の端） | 印の無い compact で決まった不確かさの文を足す処理（F2）は、Store が開けず通常の回復が出せない縮退の道では入らない。記録には書いてあるが、FR7.1 の「曖昧な時は kusabi の DB を当たる」という文がその道で席に届かない。 | 承認の場でこの端を受け入れるか決める。受け入れるなら、縮退の道の回復の文面に同じ文を足すのを次の取り組みの候補として残す。 | New |
| R-05 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/code-summary.md > 1 回目の実装監査への直し（F1 の端） | Stop hook の内部期限（7 秒）の後に終わる保存の行（pack・作業の状態）は Store に残りうる。印と手番の file は書かれないので切り直しの根拠にはならないが、残った行が次の回復に混ざらないかは記録に書かれていない。 | 残った行が回復で読まれても害が無い（印が無いので切り直しは起きない）ことを 1 行で書き足す。 | New |

> R-01 Reviewer note: coverage-method.md に手順と script（merge-zero.mjs・changed-uncovered.py）の全文があり、NODE_V8_COVERAGE を全試験に付けて足す形になった。届かない範囲は 2 つ（rotation-watcher.ts 134〜137 行、session-rotation-stop.ts 629〜631 行）で、どちらも入口の最後の網 main().catch。数字を再計算はしていない（記録の整合のみ確認）。

> R-02 Reviewer note: code-summary.md に開示（2 file を退避して control-seat の行だけ消し、他の席の行が無いことを確認、試験の前から file があったかは不明）がある。project.md にも一時の HOME の決まりが入った。退避先の path と消した行数の記録は薄いが、実害を判断する材料としては足りる。以後の試験は一時の HOME で動く。

> R-03 Reviewer note: 本物の tmux での正例は手元の 1 回の結果で、CI にも再実行できる試験にも入っていない（unit-test-instructions.md にも「CI に入れていない」とある）。据え付けの前の probe の確かめ（FR9.2）で再確認する前提のままでよい。

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| npx tsc --noEmit | PASS（出力なし） | 型検査は clean。 |
| test-session-rotation-core | PASS 21 cases | 記録の数と一致。 |
| test-session-rotation-flow | PASS 36 cases | 記録の数と一致。F1・F3 の掃引を含む。 |
| test-rotation-hook-registration | PASS 12 cases | 記録の数と一致。compact の文の入り方（F2）を含む。 |
| test-session-rotation-status | PASS 8 cases | 記録の数と一致。 |
| test-claude-transcript-identity | PASS 25 cases | 記録の数と一致。FR8 の身元の規則。 |
| test-rotation-watcher-units | PASS 83 cases | 記録の数と一致。帳面の読み取り（F4）を含む。 |
| test-rotation-watcher-flow | PASS 100 cases | 記録の数と一致。起動し直し後の記録の失敗（F5）・S4 のソース検査を含む。 |

すべて使い捨ての HOME で実行し、本番の store・DB には触れていない。

### Summary

F1〜F6 の直しは、要件（FR3・FR5・FR7.1・FR8）、見張りの設計の版 4、標準 S3・S5・S8 と食い違わず、記録（まとめ・試験の手順・監査の項目）の試験の数も実測と一致した。残るのは Minor だけ（据え付けの前に再確認する本物の tmux の正例、縮退時の文の欠け、期限後の保存行の扱いの一文）で、承認を止める根拠はない。
