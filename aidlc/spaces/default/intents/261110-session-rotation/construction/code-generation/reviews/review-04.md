## Review

**Verdict:** READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-11-13T01:43:19Z
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
| R-06 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/unit-test-instructions.md > 要件ごとの試験の命令（flow・hook-registration の行のコメント）と「期待する網羅の内訳」 | 試験の件数が古いまま残っている。flow は 40 cases、hook-registration は 12 cases、status は 8 cases と書かれているが、実際に流した結果は flow 47、hook-registration 13、status 17 で、code-summary.md の Step 16 の表の数と一致する。同じ file の status の命令の行だけは 17 になっており、file の中でも食い違う。 | flow を 47、hook-registration を 13、「期待する網羅の内訳」の status を 17 に直す。または、その数を 2 回目の実装監査の直しの時点の数だと明記する。 | Accepted risk |
| R-07 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/code-summary.md > 試験（この Mac の Node v26.12.1）の表 | 同じ file の二つの表で同じ試験の件数が違う。上の表は flow 40・hook-registration 12・status 8 のままで、Step 16 の表は 47・13・17。上の表が Step 16 より前の時点の数だと書かれておらず、今の main の結果と読める。 | 上の表に「#341 時点の数。今の数は Step 16 の表」と一言足すか、今の数に直す。 | Accepted risk |
| R-08 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/code-generation-plan.md > Step 16.1 と code-summary.md > Step 16 の base | 計画の 16.1 は branch を origin/main の aa77b683 から切ったと書くが、code-summary.md は base を 1eef773b とする（#343 の統合を含む）。実際に 1eef773b は存在し、PR #342 の差分はそれに対して数えられている。計画に base が動いた経緯が無い。 | 16.1 に「その後 base が 1eef773b（#343 統合後）に動いた」と 1 行足す。 | Accepted risk |
| R-09 | Major | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/code-summary.md > Step 17 > 開いていること（最終行「監査が R3 に上げる場合は Owner の exact-head（arc の判断は R2）」）と 計画 17.9 | Step 17 の PR #344 は、見張りの `rotation-watcher-core` `-attempt` `-store` を変え、claim・台帳・tick に新しい終端の値 `output_written_receipt_unobserved` を足す。見張りは要件 FR5.6 で守る物に触れる部品とされ、同じ取り組みの PR #342 は R3 で Owner の exact-head を受けている。ところが #344 は区分 R2 とされ、その根拠は arc の技術の判断（agent-memory#339 の comment）だけで、Owner の決定の記録が記録の中に見当たらない。R2 の根拠が「見張りの状態の値の意味を変える変更は守る物でない」ことかどうかも書かれていない。 | 統合済みの #344 について、(a) 見張りの claim の状態の値を足す変更が守る物（席の process の終了と再起動に当たる部品）に入らない理由を記録に書く、または (b) Owner の exact-head か追認の記録を足す。配備（計画 17.9）の前に、どちらかを済ませる。 | New |
| R-10 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/unit-test-instructions.md > 要件ごとの試験（status の行）と 見張りの試験（units・flow の行） | 試験の件数が main の実物と食い違う。記録は `test-session-rotation-status.ts` 17 cases、`test-rotation-watcher-units.ts` 83 cases、`test-rotation-watcher-flow.ts` 103 cases。origin/main（ffe511e）で実際に流すと 18・86・109 cases PASS。code-summary.md は 18・86・109 と正しく書いている。同じ file の chain の説明（core・flow・registration・status・watcher-units・watcher-flow・scenario を順に流す）も、package.json の `test:session-rotation` が commit-order・handoff-source などを足した後の形と合わない。 | 3 つの件数を 18・86・109 に直し、chain の説明を package.json の今の並びに合わせる。 | New |
| R-11 | Minor | aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/code-summary.md > 変えた file（冒頭の節）と 行の網羅率（NFR4） | 冒頭の「変えた file」は PR #341 の時点の数（src 変更 10・新規 20・試験 9）のままで、main の累計（#341〜#344。base 17676d84 に対して src の新規 27 と変更 16 ほか）と合わない。網羅率も、単位全体の結果は 100% に届かない 2 範囲（`rotation-watcher.ts` 134〜137 と `session-rotation-stop.ts` 640〜642 の `main().catch`）が残り、Step 17 の「動かなかった範囲 0」は Step 17 の変更行だけの数。数えから外さず理由を書いているので床の扱いは手続き上は足りているが、読む人が累計と読み違えやすい。 | 冒頭の節に「#341 の時点」と明記するか累計に直す。網羅率の節に、単位全体では 2 範囲が残り Step 17 の 0 は変更行だけの数であると 1 行足す。 | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| traceability.json の target 実在確認（OK 53 行を origin/main で `git cat-file -e`） | 欠けた file 0 | OK 行の target は全部実在。N/A 3（FR2.3・FR5.4・FR8.3）と Deferred 2（FR9.2・FR9.3）の理由は、席への据え付け・常駐の差し替え・実機の切り直しが守る物で別工程という扱いで妥当。FR5.6・FR5.7・FR8.1・NFR4 は記録の file を target にしており、要件の性質（設計の記録・原因の確認・測り方）に合う |
| 試験の実行（origin/main の archive を一時の HOME で。status・units・flow・identity・core・flow・registration・handoff-source・source-cli・commit-order・scenario） | 全部 PASS。件数は 18・86・109・25・21・47・13・13・14・35 と code-summary.md の Step 17 の表に一致 | code-summary.md の件数は正しい。食い違いは unit-test-instructions.md だけ |
| 依存・workflow・DB | `package.json` の差分は scripts のみ（dependencies 変更 0）、`package-lock.json` と `.github/` の差分 0、`src/stores/types.ts` と `src/migrate.ts` の差分 0。`send-keys` 系の語は見張りの src に 0 | NFR5（DB の作りを変えない）と FR5.1（キーを送らない）に沿う。新しい外部の依存は無い |

### 照らした社内の基準の項目

- S1: 該当なし（削除経路・外部キーの変更なし）。
- S3: 適合。閾値 `ROTATION_DEFAULT_THRESHOLD_TOKENS`、task_id の `rotationHandoffTaskId`、JSON の整理の `normalizeTaskStates` が 1 か所。必須の入口の一覧は 3 か所に並ぶが、試験が同じ集合を確かめている。
- S4: 適合。純粋な関数 `session-rotation-usage.ts` は時刻・環境を読まない。確定の関数は時計を受け取る形。
- S5: 適合。見張りは受領を観測していないので成功と書かず `output_written_receipt_unobserved` を書く。
- S6: 適合。表・列の変更なし。見張りの旧い値との同居は配備の段 17.9 で観測する扱い。
- S7: 適合。出力 → 出力済みの記録 → 消費の順で、同じ marker の再実行は `exists` を返す。
- S8: 適合。失敗を成功と数えない。stderr の失敗も致命にしない listener を試験で固定している。
- S9: 該当なし（資格情報の配布の変更なし）。読み手は `BEGIN READ ONLY` と SELECT だけ。
- DB の基準 Part A・B: 該当なし。表・列・migration を変えていない。
- 行の網羅率 100%（team.md）: 変更行は 2 範囲を除き 100%。2 範囲は理由つきで記録（上の Minor）。
- 依存を入れる前の脆弱性の確かめ: 該当なし（新しい依存なし）。
- セキュリティ: 記憶の中身を外へ送らない（redactText を通し、外の API なし）。tmux の命令は閉じた集合。守る物の扱いは上の Major。

### Summary

要件 58 行の対応は実在する file を指し、code-summary.md の試験件数は main の実行結果と一致し、依存・workflow・DB の変更はない。残るのは、見張りを変える #344 が R2（arc の判断だけ）で統合された根拠の記録（Major 1 件）と、unit-test-instructions.md の古い件数など記録の食い違い（Minor 2 件）で、READY。なお、記録の「気づいたこと」にある試験が実際の保存先に行を入れた件は、開示と手当てが書かれていて、この見直しでは追加の指摘にしない。
