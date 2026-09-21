# AUN v2 初回試運転へ渡す Kusabi 接続入力

2026-09-21。指定4項目を、具体値・既存実測・明示した不足へ対応付けた準備資料です。**適用前の情報整理は完了。配布物の現存・新AUNとの接続・qa実受領は未確認で、試運転開始の許可・実接続合格ではありません。** 製品受入数、実案件数、今日の30/64へ加算する増分は0です。

実作者: `codex-cto/e3_independent_review` / `control_artifact_author`。以前の独立確認歴を保持し、今回の自分の資料は独立受入しません。実開始 `2026-09-21 10:23:39 JST`、通算初回1回・最大30分。資料の観測時刻と生ログhashは [inputs.json](inputs.json) に記録。公開終了時刻・commit/tree・自動CIの観測は #307 の結果コメントを参照してください。

- [今回の正本](https://github.com/watchout/agent-memory/issues/307#issuecomment-5754173951): 本文SHA256 `dd9943188b6f0c304ccbc7554d2ebe42c1b49c226764d6c00a0625ed05e6b28e`。
- [元09:54指示](https://github.com/watchout/agent-memory/issues/307#issuecomment-5754027603): 本文SHA256 `d7983d251592c869742f510f8970a5de528edf9d3a44b11aec4edc9aca3521f8`。
- 専用枝 `codex/kusabi-memory-connection-e3-20260921`、worktree `/Users/yuji/Developer/.worktrees/kusabi-memory-connection-e3-20260921`。他のcleanな旧準備枝・dirty作業を上書きしていません。今回追加するのはこのREADMEとinputs.jsonだけです。

## 1. 必要版・CAS・配布物

[PR321](https://github.com/watchout/agent-memory/pull/321) の source **`e49abc24838227776dc01be111aeb035ec7c9aad`**、tree **`a55dd96fe6a753ea2ab6bcb8134172ca0d086a42`** をGit objectとGitHub APIで確認しました。PRはopen・未mergeです。この資料の新commitは文書追加の版であり、製品M候補を置き換えません。将来の実Mを候補commitと同一視しません。

|対象|今回確認できたもの|残るもの|
|---|---|---|
|製品source / package依存定義|固定e49のsource、package.json `c7d4e9bf81daabee994d1a78c5242bd49cac94df0b617f522b55b49234a970ca`、package-lock.json `e479ab7ee951d1fd82d5e5064ca76700be4716f573f6703e60f01f26b6b5ed60`|適用する実Mと実インストール依存物の読戻し|
|旧private candidate|保存receiptにdescriptor `3d9a67a1f90846d93f29289e486f1781a29d19db52ac948bdc7fb942fc59f5cb`、dist tree `6bbd76586625ac04e12baa38e8a5af70e69cef5339cf8e7f08f08ac72bafec3d`、runtime tree `3239e8e2c80eff43e3fcdb059875400240b64e22870ed4e233f315f463ecdd95`|旧stageのディレクトリは残るがrelease.json、package/lock、確認対象entryは現存しない。予定final CAS rootも存在しない。現在利用できる配布物とは扱わない|
|entry|保存済みindex/native/SessionStart/installer/store等のhashをinputsに全件掲載。例: dist/index.js `6b44c1cfdc263a75ed6d845da210e69f96b30f7a0c4cc99e86acb320cab8ec37`|現在のCAS entryを同hashで読めたという主張はしない|
|publisher|[既存publisher](https://github.com/watchout/agent-memory/blob/e49abc24838227776dc01be111aeb035ec7c9aad/scripts/build-kusabi-content-addressed-runtime-release.mjs) のsource hash `5b4f34443473b21d103fb1c4469a41256b69f6289e29f3c6e5e3626738265c6e` を確認|現在権限のあるoperatorが実Mのclean checkoutで実行し、返却したCASを読戻す必要がある。今回は実行0|

不足 **M-CAS-01**: 新規設計は不要です。既存publisherの`--mode publish --expected-head <actual-M> --release-root /Users/yuji/Developer/.kusabi-releases --evidence-output <new-current-operation-receipt.json>`と、その後の`--mode readback --release-sha <actual-descriptor-sha256>`へ具体化できます。完全argvはinputsに掲載しています。publisherはbuild・依存準備・harness実行・公開を伴うため、今回の資料作成権限では実行しません。実Mのsource/tree、runtime/dist全ledger、依存manifest、entrypoint全hash、conformance、immutable descriptorを別checkerが照合してからリンクします。descriptorにはprivate stageを含む実行ledgerのhashが入るため、旧descriptorと同じ最終hash/pathになるとは予測しません。

不足 **M-AUN-COMPAT-01**: AUN基準`9d7e6f5b06b0d9a4b13011760e543cfc8a795e14`は影響箇所の読取りにのみ使用しました。最終v2との同版接続試験は未観測です。旧AUN、Kusabi単体、別commitのPASSを移しません。

## 2. 正しい記憶の受渡し

採択済み[API契約](https://github.com/watchout/agent-memory/blob/e49abc24838227776dc01be111aeb035ec7c9aad/docs/design/core/SSOT-3_API_CONTRACT.md#L549)、[binding契約](https://github.com/watchout/agent-memory/blob/e49abc24838227776dc01be111aeb035ec7c9aad/docs/design/core/SSOT-7_RUNTIME_AGENT_BINDING.md#L138)、[実装](https://github.com/watchout/agent-memory/blob/e49abc24838227776dc01be111aeb035ec7c9aad/src/native-context-delivery.ts#L214)を対応付けました。

1. 同じ永続`agent_id/project`へ作業・決定・次行動を保存する。今回の予定対象は`qa/qa`。workspace/PID/sessionは現在値を観測する。cwd名からprojectを推定しない。
2. native SessionStartが`started` attemptを永続化し、欠落のないactive task/next actionを復元する。実providerのPID/start/executable/workspace/pipeを検証する。
3. 正しいpipeへの出力書込み完了と同じ実processの再観測後、同一attemptの`finished`イベントへreceiptを永続化する。EPIPE、書込み失敗、timeout、identity不足、store失敗は受領にしない。
4. MCP `native_context_delivery`が保存済み証拠を読取り、最新のsource-start attemptと現在providerを照合する。呼出引数にagent_idはなく、MCP serverの`AGENT_MEMORY_AGENT_ID`がnamespaceの根拠となる。自作receiptや呼出者の宣言は証拠にしない。
5. AUNのowned adapterが同じ現在hostとreceiptを結合し、現在のAUN runtime UUID／sealed provider→MCP対応へ束縛した消費証拠を作る。memory-readyはqueue実行前に満たす。新AUNの非保存化後も旧DB observationへfallbackしてはいけない。

receiptが証明するのは**実host入力pipeが受け入れたbytesとdurable workの一致**です。モデルの理解・保持・次の行動、実案件の有用な結果は別途観測します。startupの画面表示やAUN/モデルの宣言で代用しません。

別席・別project・旧PID/start・別workspace/session、複数/欠落session、最新のpending/failed attempt、遅れて完了した古いattempt、不正/切れた履歴は`unavailable`。古い成功を拾いません。具体的な型付き拒否は [lookup実装](https://github.com/watchout/agent-memory/blob/e49abc24838227776dc01be111aeb035ec7c9aad/src/native-context-delivery.ts#L293) を参照。

**期限の担当を混同しません。** Kusabiのnative receipt自体に1800秒のage TTLはありません。最新attempt/current processと`delivered_at`を検査します。1800秒は[AUN既存消費証拠の既定有効期間](https://github.com/watchout/agent-comms-mcp/blob/9d7e6f5b06b0d9a4b13011760e543cfc8a795e14/core/runtime-memory-ready.ts#L895)です。[同consumerはvalid_until <= 現在時刻なら期限切れを拒否](https://github.com/watchout/agent-comms-mcp/blob/9d7e6f5b06b0d9a4b13011760e543cfc8a795e14/core/runtime-memory-ready.ts#L725)し、runtime/identity不一致も拒否します。最終v2のconsumer・実expiry・Task1/2を収める残時間は未観測。旧180分枠や今の資料作成時刻からexpiryを作らず、更新/延長もしません。

## 3. 保存済み実測と契約の突合

新しい製品試験・CI手動起動/再実行は0です。以下は保存済み生ログのSHAを今回読み直し、現在固定sourceのbytes・公開された既存独立受入に結合した結果です。

|実測|同版への結合|保存結果|
|---|---|---|
|Mac native / Codex caller|最終precommitの4変更ファイルhashがe49と一致。残りのsource同一性は既存独立受入に記録。実行後commitした版へのhash結合であり、commit後に再実行したとは言わない|native148 checks（initialization23 / kernel32）、exit0。Codex callerも同148を実行しており合計296種類とは数えない。Darwin Node v25.6.1|
|Mac Claude / runtime-event-emitter|同じ保存実行群と既存独立受入|各exit0、原ログはpassed。数値assertion件数は出力されておらず未測定|
|Mac SQLite / core|同じ保存実行群|SQLite204 PASS / 0 FAIL、core1591 PASS / 0 FAIL|
|[公開CI 34750856136](https://github.com/watchout/agent-memory/actions/runs/34750856136)|trigger e49、実checkout `9d89f2a0abafc296116794897c7e53f32096266d`、tree a55がe49と一致。今回APIでcompleted/successを再確認|Node18.20.8/20.20.2/22.23.2それぞれnative165（initialization23 / kernel49、実UNIX/FIFO）、core1591、SQLite204。12本のcheckout/native/core/SQLiteログhashを保存ZIPの実bytesと照合|

既存独立受入: [PR321 comment5651852792](https://github.com/watchout/agent-memory/pull/321#issuecomment-5651852792)、本文SHA256 `2da01fa42c61dfb7bf136b0a74827ee0c7a8329ea91ca4247a3d8b40a18b7795`、checker `codex-cto/reboot_evidence`。今回はこの受入の再署名/再監査をしていません。source受入はmerge・適用・owner判断を代替しません。

|必要な挙動|同版試験の場所と観測|結論の限界|
|---|---|---|
|正しい文脈・次行動の復帰|[native L287〜336](https://github.com/watchout/agent-memory/blob/e49abc24838227776dc01be111aeb035ec7c9aad/src/test-native-context-delivery.ts#L287): 同じstore、Codex→Claude→Codex、workspace移動、objective/next、同work digest、実stdout hash、registered MCP返却一致|無害なfixture parentの分類だけ注入した実OS pipe試験。qa実host/LLM保持の証明ではない|
|誤席/誤projectを混入させない|同試験L297〜328: foreign sentinel非出力、別server agentのlookup拒否|実qaの現在server identityは適用後に独立確認|
|旧session・旧PID・pending/failedを成功にしない|[同試験L345〜429](https://github.com/watchout/agent-memory/blob/e49abc24838227776dc01be111aeb035ec7c9aad/src/test-native-context-delivery.ts#L345): start不一致、最新pending/failed、遅延した旧完了、欠落/同時刻session、201件境界を拒否|AUNの新観測consumerで同じ拒否を保った実測は未観測|
|通信/保存異常|nativeの実EPIPE・別peer/偽provider拒否、[emitter L340〜428](https://github.com/watchout/agent-memory/blob/e49abc24838227776dc01be111aeb035ec7c9aad/src/test-kusabi-runtime-event-emitter.ts#L340): store unavailable/write failed/timeoutはemergency_onlyまたはfailed、遅着store保存0|fallback表示やemergencyをdurable成功にしない|
|並行store・履歴保全|nativeのforeign lock下同時MCP read、no-op initializationでDB/lock bytes不変、実write/migrationは拒否、stale CAS/closeで新attemptや作業を消さない|新規DB同時作成・独自FTS5・クラッシュlockの無人解除は未測定|
|期限失効|[AUN既存test L479](https://github.com/watchout/agent-comms-mcp/blob/9d7e6f5b06b0d9a4b13011760e543cfc8a795e14/tests/runtime-memory-ready.test.ts#L479)とconsumerの拒否条件を読取り|Kusabi148/165でAUN最終v2の期限拒否が実測済みとはしない|

inputsには6本の元Mac argv/exit/秒数/hash/結果行と、3matrixの元job URL/12raw-log hashを保存しています。ローカルの原ログは元の場所を保全し、portableな公開CI/独立受入のURLへ結合しています。履歴のmachine-evidenceにある「Linux pending」は当時の記録として維持し、後続の同版CI/独立受入を別refで示します。古いAUN5d4のB5失敗も消しません。

新AUN接続に必要な差分確認は `core/runtime-memory-ready.ts`、`bin/aun/memory-ready.ts`、runtime/endpoint selectionとidentity経路です。既存`tests/runtime-memory-ready.test.ts` / `tests/runtime-memory-ready-identity.test.ts` は旧runtime/leaseをseedするため、無変更PASSは非保存化の証拠になりません。既存AUN makerが新OS観測入口・DB観測行なし・旧DB汚染・誤席/旧session・失効/通信失敗を隔離fixtureへ反映し、同版の受渡しを別checkerへ返してください。候補argvは `bun test tests/runtime-memory-ready.test.ts tests/runtime-memory-ready-identity.test.ts`。Kusabi側に影響がある場合だけinputsの正確な既存4argvへ束縛します。private HOME/明示fixture store、ambient PostgreSQLなし、実provider API/qa席/queueなし。未作成fixture・未実行はNOT_RUNです。

## 4. Shirubeへの入力と適用後の確認

受渡し先は [Shirube789ecf3eのinputs.json](https://github.com/watchout/ai-dev-framework/blob/789ecf3e2744bf0e1b18b12d5884e82d0f50f576/docs/verify/a2-connection-20260921/inputs.json)（SHA256 `02278f649cccef7a8126cff47eec9652f2349bfc53e0e477eb4c60091e502b01`）。この資料は既存欄への供給値で、runtime設定ではありません。Shirubeの原USE9・GoalRun・B4を変更しません。可変B/PR626/627を初回既定A2の追加条件にしません。

|Shirube既存欄|今渡す値|後から必要な観測|
|---|---|---|
|required_pre_apply.required_was_commit_tree_cas_descriptor|inputsの同名mapping: e49/a55、未merge、元品質、履歴CAS/entry/依存hash、既存publisherの具体操作、M-CAS-01/M-AUN-COMPAT-01|認可された実M/CASの生成・読戻し。旧descriptorを実適用値へコピーしない|
|required_post_apply_pre_task1.actual_R_and_M_with_PID_start_entry_cwd_plist_helper_artifact_readback|null|実M/tree、CAS/descriptor、実PID/start/entry/cwd/helper/loaded digest、依存manifest|
|required_post_apply_pre_task1.qa_native_memory_receipt_and_validity|null|qa/qaの実native receipt、正しいhost/attempt/input/work digest、AUN実runtime消費receipt、consumed_at/valid_untilと両Taskを収める現在枠|
|required_post_apply_pre_task1.independent_binding_verdict_and_aun_rows_01_through_21|null|maker外checkerの同版/対象/権限/TTL照合結果をadf-leadへ渡す|

不足 **M-LIVE-01** は認可された適用後・Task1前の観測であり、この準備資料作成の停止条件にしていません。**M-AUTH-01** は現在有効な具体的適用・停止・復旧の権限で、資料作成から生成しません。旧C23期限/180分/CI枠、旧Viceのhook/trust/config計画はqaへ流用しません。

停止: 版/hash/identity/namespace不一致、missing/expired/superseded receipt、通信・store失敗、競合・副作用不明なら該当試運転をTask1前に停止し、具体理由を1回返す。実復旧は現operatorが現在のexact target/argv/triggerで許可されたものだけ。履歴削除、lock強奪、queue解除、信頼設定・restartをこの資料で認めません。

next_action: owner=adf-lead / codex-aun既存maker / Kusabi repo責任者; required_function=各repoの現在委任範囲; action=この具体値とnullを既存Shirube入力へ取り込み、最終AUN v2の新入力で影響差分だけを更新; delivery=本固定commitと#307→既存#623接続欄; input_refs=今回正本/元09:54指示/PR321/789ecf3e; scope=初回既定A2記憶接続・製品や保護操作は今回0; deliverable=適用前入力、その後の実M/native/TTLの独立突合; completion_evidence=同版source/CAS/process/receipt/consumer/expiryと別checker返却; blocking=false（通常ACK待ちを追加しない。実適用・開始のみ現在の具体的不足を保持）。
