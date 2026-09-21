# 初回試運転へ渡すKusabi記憶連携

判定：**4点の整理は完了。配布物と最終AUN互換性に不足あり（KMC-01/02）。**
この資料は適用前の入力資料であり、実接続・試運転合格・製品全体完成の証拠ではない。
機械可読の値、hash、未観測欄、次の担当は [inputs.json](inputs.json) にまとめた。

目的（指示原文）：「AUN担当とShirube担当が、Kusabiの必要版・記憶の受渡し・確認方法を使って最初の試運転へ接続できる状態にする。」

- 実actor：`kusabi`（native actor `/root`）、`control_artifact_author` / `governed_manual_lane`。
- 着手記録：`2026-09-21T01:18:37.158682+00:00`（10:18:37 JST）、受領後最大30分の今回限りの作業。
- 資料branch：`codex/kusabi-aun-v2-memory-connection-20260921`、base `3399a931aac48462106202b4bb5ded1ab9bdb60e`。製品候補とは別の資料commit。
- control_source_ref：[今回の指示](https://github.com/watchout/agent-memory/issues/307#issuecomment-5754027603)、本文SHA256 `d7983d251592c869742f510f8970a5de528edf9d3a44b11aec4edc9aca3521f8`。
- owner_source_ref：[owner指示](https://github.com/watchout/iyasaka/issues/171#issuecomment-5754017696)、本文SHA256 `f63985be75fdfb7adf6acf9416a2c68ea6353d839e4fecfc263dca88c04468f5`。

完了条件は、必要版・記憶受渡し・既存試験・適用前後の4点を具体値／既存証拠／不足IDへ対応させること。観測は、固定GitHub source/tree・コメント本文・既存試験ログのhash・指定配布先の読取り、JSONと入力欄の対応検査、公開後のbytes照合で行う。

## 1. 必要版と配布物

[PR321](https://github.com/watchout/agent-memory/pull/321) は現在OPEN・未merge。予定する記憶候補は以下で固定する。適用後の実Mは未観測。

|項目|値と証拠の範囲|
|---|---|
|source / tree|`e49abc24838227776dc01be111aeb035ec7c9aad` / `a55dd96fe6a753ea2ab6bcb8134172ca0d086a42`|
|package|`wasurezu@0.3.0`。版番号だけではrelease識別に使わない|
|9/14の候補descriptor|`a26fd913aa73acf403798e28b9e01d09abb1b29954098eef7f08484639d28bb9`。記録されたdescriptorからcanonical JSONのhashを再計算して一致|
|同候補runtime / dist|`3239e8e2c80eff43e3fcdb059875400240b64e22870ed4e233f315f463ecdd95` / `6bbd76586625ac04e12baa38e8a5af70e69cef5339cf8e7f08f08ac72bafec3d`。歴史上4,119 / 260 files|
|package-lock.json|`e479ab7ee951d1fd82d5e5064ca76700be4716f573f6703e60f01f26b6b5ed60`|
|production依存manifest|`node_modules/.package-lock.json`：`d184e0a557788da123b091ef02048ea60eb0d9b6bb4fa301e37792d9115721c1`|
|MCP entry `dist/index.js`|`6b44c1cfdc263a75ed6d845da210e69f96b30f7a0c4cc99e86acb320cab8ec37`|
|native receipt実装entry|`dist/native-context-delivery.js`：`173475580c7475a82e956077100bc9f43bebe8ed2ce8a7b7a801f86935b63dba`|
|Codex SessionStart entry|`dist/codex-session-start.js`：`134a5da77e07aef0d82252cccc2949600ae0204a2fba13b371b855212ae0ea50`|
|必要tool|保存担当：`save_task_state`。復帰：`recover_context` / `restart_pack`。trusted observer：`native_context_delivery`。制限済みworkerへのtool追加は含まない|

この表のartifact hashは**歴史上の候補**に属する。9/21に次の場所を実際に確認した。

- `/Users/yuji/Developer/.kusabi-releases/sha256` の9件のdescriptorに、e49候補を示すものはなかった。旧schemaのsource欄も確認した。
- PR321の既存証拠に結ばれた9/13・9/14の2つの一時stageはディレクトリだけが残り、どちらも通常ファイル0、`release.json` 不在。9/14の予定final pathも不在。
- 削除原因や他の場所での存在は断定しない。指定した場所では、現在使えるe49 CASを確認できない。

**KMC-01：配布物作成が必要。** 既存builderの `--mode candidate --expected-head e49… --release-root <new owned root> --evidence-output <new file>` を、別の現handoffで実行する。正確なargv配列はJSONにある。build・harnessを含むため今回は実行していない。公開は別途認可された `--mode publish` と完全readbackが必要。

9/13の同source候補descriptor `3d9a67a1…` と9/14の `a26fd913…` は異なり、runtime/distは一致している。既存publishは再buildするため、将来のdescriptorをa26と仮定しない。新しい実出力のsource/tree・全file ledger・entry・依存・descriptorを別checkerが束縛する。PR318/323の再実装や全席配布を、この資料の追加条件にはしない。

## 2. 保存から現在hostへの受領まで

対象の予定partitionは `agent_id=qa / project=qa`、workspace `/Users/yuji/Developer/qa`、runtime `codex`。workspace SHA256は `1d372fbefe550bfb59365159876f3eb2975bd6082ee650542f6235c0e1706cde`。これは文字列から得た予定bindingで、現QAの実identity確認ではない。

1. 実際の保存担当が `save_task_state` に実task・owner objective・未完作業・`next_steps`・明示的な `project=qa` を渡す。agent IDは実MCP serverの `AGENT_MEMORY_AGENT_ID` に束縛される。保存IDと同partitionの内容を照合し、完了済み／結果不明の効果を自動再実行しない。
2. 同じpartitionから `recover_context({project:"qa"})`、`restart_pack({project:"qa",format:"host-invocation-context-v1",target_runtime:"codex"})` を取得する。`restart_pack:qa:qa:`、current task、空でないNext、未完文脈とsource refsを照合する。provider/session/workspace交換でnamespaceを変えない。hookとMCPのstore bindingも同じ必要がある。
3. native hookはstarted attemptを保存してから復帰する。full・verifiedなpack、work digest、現在providerのPID/start/executableと相互pipe、実stdout write callback、write後の同identity再確認を経て、accepted receiptを含むfinished eventを永続化する。
4. trusted observerが現在のPID/start/workspace/sessionを使って `native_context_delivery` を実MCPへ問い合わせる。古い成功ではなく、最新started attemptに対応するfinished/acceptedだけを採用する。

契約正本はe49の [SSOT-3 API](https://github.com/watchout/agent-memory/blob/e49abc24838227776dc01be111aeb035ec7c9aad/docs/design/core/SSOT-3_API_CONTRACT.md#L549) と [SSOT-7 binding](https://github.com/watchout/agent-memory/blob/e49abc24838227776dc01be111aeb035ec7c9aad/docs/design/core/SSOT-7_RUNTIME_AGENT_BINDING.md#L138)。新しい保存機構やreceipt生成機構は提案していない。

別席/別project、旧・再利用・消失PID、変わったstart/executable、session不一致・不明、最新attemptのpending/failed、start欠落、遅れて届いた旧completion、history切捨て、EPIPE/timeout、store永続化失敗は受領成功にしない。例：`NATIVE_LATEST_ATTEMPT_PENDING`、`NATIVE_LATEST_ATTEMPT_NOT_ACCEPTED`、`NATIVE_PROVIDER_CHANGED`。AUNやモデルの自己申告も代用できない。

`provider_executable_sha256` はe49実装上、path/dev/inode/size/mtime/mode/startTicksの観測tupleのhash。binary全bytesのhashとは別なので、適用版検証ではentry/binaryのdigestも独立に採る。receiptはnative入力bytesの受領を証明し、モデル理解や仕事の正しさは証明しない。

### AUNとの対応とTTL

固定入力のAUN `9d7e6f5b06b0d9a4b13011760e543cfc8a795e14` では、`core/seat-context-recovery.ts` が実MCPのreceiptを読み、次のように結ぶ。source hashはJSONの `source_catalog` に保存した。

|Kusabi native receipt|AUN seat-context-consumption|
|---|---|
|`input_sha256`|`invocation_digest`|
|`work_sha256`|`work_digest`|
|`pack_ref`|`pack_id`|
|canonical receipt全体のdigest|`response_digest`|
|現在のAUN runtime instance|`runtime_instance_id` と `consumption.runtime_instance_id`|

Wasのnative receiptには固定TTL欄がなく、現在providerと最新attemptを照合する。AUN9d7の `core/runtime-memory-ready.ts:895` は既定 `valid_for_seconds=1800`、`valid_until=completed_at+TTL`、同725–727は `valid_until <= now` を拒否する。1800秒はsourceの既定値であり、現在の適用枠の承認ではない。実選択TTL、completed_at、valid_until、照合時刻は適用後欄にnullで残した。

**KMC-02：最終AUN版との互換性が未確認。** 9d7のmemory-readyは、03/04で変更予定のruntime/endpoint DB観測に依存する。非保存化後も上表のreceipt、永続identity/project、claim/history、現在OS/native検証を保つ必要がある。最終Rのhash・該当差分・同じR+Mの試験・別checker受入をAUNから受け取る。9d7との項目対応だけで最終互換PASSにしない。

## 3. 同版の既存試験を再利用

[e49の独立レビュー](https://github.com/watchout/agent-memory/pull/321#issuecomment-5651852792)（本文SHA256 `2da01fa42c61dfb7bf136b0a74827ee0c7a8329ea91ca4247a3d8b40a18b7795`）と既存ログを確認した。元makerは `codex-cto/restore_inventory`、checkerは `codex-cto/reboot_evidence`。この資料作成者による再監査ではない。

|既存試験|再利用できる観測|
|---|---|
|`src/test-native-context-delivery.ts`|Darwin148 checks。1 storeでcodex→claude→codex、保存objective/Next復帰、隣接partitionのsentinel不在、同一work digest、実pipeと登録MCP lookup。古い成功・pending/failed・曖昧attempt・別agent・異なるstart・EPIPEの拒否|
|`src/test-codex-session-start.ts`|adapter PASS、実childとしてnative148を実行|
|`src/test-claude-session-start.ts`|SessionStart PASS。source/native suiteはresume/fork入力も確認|
|`src/test-kusabi-runtime-event-emitter.ts`|emitter PASS。durable eventとnative受領の順序はnative suiteと対応|
|SQLite / core|204 / 1,591 PASS。current SQLite初期化のno-write、foreign lock下の並行MCP読取り、実write/migrationのlock拒否を保持|

6本の既存ログを再hashして記録値と一致。修正されたsource/specのprecommit bytesがe49と同じことも照合した。正確な既存argv・log hash・結果抜粋はJSONの `reused_tests` にある。

[既存CI 34750856136](https://github.com/watchout/agent-memory/actions/runs/34750856136) はNode18/20/22すべてSUCCESS。実checkout `9d89f2a0abafc296116794897c7e53f32096266d` のtreeがa55と同じことをGitHubで再確認。各Node native165（初期化23、kernel49）、core1591、SQLite204。旧失敗・旧source・旧AUNの結果は履歴として残し、新しいAUN版の合格へ読み替えない。

fixtureは無害なOS parent/pipeを使い、provider分類の注入は試験内だけ。実QAのnative動作・installed LLMへの文脈保持は未観測。SQLiteのcrash-held lockも自動解除されない。今回の製品source編集・試験・build・CI再実行は0。

新AUN接続で影響を受ける既存試験は以下。**今回は未実行**で、現AUNの別handoffに束縛して使う。

```text
bun test --timeout 30000 tests/seat-context-recovery.test.ts
bun test --timeout 30000 tests/runtime-memory-ready-identity.test.ts
bun test --timeout 30000 tests/contract/test_seat_runtime_continuity.test.ts
```

AUN台帳の追加fixture `tests/contract/test_seat_provider_switch_durable_memory.test.ts` は9d7に未作成。予定argvは `bun test --timeout 30000 tests/contract/test_seat_provider_switch_durable_memory.test.ts` だが、現状は実行不可。作成後、隔離された保存ID/内容/Nextをprovider交換後にも回復し、他partition流入0、古いDB観測・旧PID/session・期限切れ・失敗の採用0、永続claim/history保全を確認する。DBが必要ならprivate cluster/socket/roleと明示URLを束縛し、ambient URLや既定socketへ接続しない。既存Was全試験の一律再実行は必要条件に加えない。

## 4. Shirubeへ渡す欄と適用順序

受渡し先は [Shirube既存inputs](https://github.com/watchout/ai-dev-framework/blob/789ecf3e2744bf0e1b18b12d5884e82d0f50f576/docs/verify/a2-connection-20260921/inputs.json)、file SHA256 `02278f649cccef7a8126cff47eec9652f2349bfc53e0e477eb4c60091e502b01`。JSONの `shirube_input_transfer` はこの既存欄名を維持している。

|時点・既存欄|渡す内容|
|---|---|
|適用前 `required_was_commit_tree_cas_descriptor`|予定e49/a55、歴史上のdescriptor・entry・依存hash、実配布物nullとKMC-01|
|適用前 `qa_operator_checker_identity_function_workspace_provider_tools_capacity`|予定qa/qaと役割別tool。現actor/provider/容量はKMC-03|
|適用前 `planned_stop_restore_target_triggers_argv_and_no_work_proof`|下記停止/復旧手順。現preimage・正確argv・no-work証拠はKMC-03|
|適用後・Task1前 `actual_R_and_M_with_PID_start_entry_cwd_plist_helper_artifact_readback`|実R/M・memory child/hostのPID/start/entry/cwdとartifact digest。未観測null|
|適用後・Task1前 `qa_native_memory_receipt_and_validity`|現在のnative receipt/attemptとTTL。未観測null（KMC-04）|
|適用後のconfig/cohort/GoalRun/独立判定欄|現在構成と同じR/Mを結合して別checkerが確認。未観測null|

適用前にoperator/checker・現権限URL+本文hash・有限枠・完全なM/CAS・QAのhook/MCP/store/trust・backup bytes/hash/modeを固定する。既存installerで無関係handlerを保全し、旧releaseとdurable memoryを残す。旧9/14のPID・thread・trust期待hash・manifest期限は現在値に流用しない。

実操作では、正常終了可能性とno-workを確認し、現handoffのexact start/resume/restore argvだけを使う。hostの通常入力でSessionStartが動きreceiptを生む順序を保ち、receiptを生む入力より前にreceiptを要求しない。startup/provider効果を実際の有限枠に含める。source/entry/store/identity不一致、権限失効、trust/receipt不足、pending/failed、TTL切れならENABLE/Task1を始めず、一度通知して停止する。

復旧が認可されている場合だけ、現operatorが採取済みpreimageを既存のatomic復元手順で戻し、別checkerが復元後の版・processを読み戻す。強制kill、記憶DBの書換え、旧PIDの流用、無条件retryは復旧案に含めない。正確な現stop/restore argvは未供給なので、今回実行可能なコマンドを捏造しない（KMC-03）。

既存root `GOAL-RUN-CTO-940-QA-USE-20260908-001`、USE-01..09の原定義とUNMET、`B4-ACTUAL-USE-EVIDENCE-PENDING` を維持する。Task1/2成功とB4除去は開始後の実受入。将来の実ロード・receiptを、今回の準備資料完成条件にはしない。

## 返却と次の担当

`next_action` の主担当は **codex-cto / orchestration_controller**。#307のこの1件を消費し、KMC-01の既存builder作業をKusabiへ、KMC-02の最終AUN互換性をcodex-aunへ現handoffで結ぶ。KMC-03は適用前、KMC-04は認可された適用後・Task1前にoperator→別checker→adf-leadへ渡す。正確なinput refs、scope、deliverable、completion evidenceはJSONの `next_action` にある。

`next_action.blocking: true` は、この2ファイル準備の後に行うbuild・適用への停止を表す。理由は現functionの範囲外の外部依存。今回の指示は製品source/tests/CI再実行・merge・live DB/鍵/認証/runtime/再起動/queue/fleet操作を0と明記している。追加ACK・重複queue依頼・待機記録は生成しない。
