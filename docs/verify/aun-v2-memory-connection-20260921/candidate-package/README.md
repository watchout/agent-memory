# Kusabi e49 private candidate package

**CANDIDATE_VERIFIED**。欠落していた e49 の配布候補実体を既存publisherのcandidateモードで初回1回生成しました。共有final CASの公開、実Mの適用、qa native受渡し、製品全体受入は未実施です。これはM-CAS-01の「候補実物の欠落」の解消であり、M-CAS-01の共有配布・適用までの完了ではありません。30/64・実案件受入への加算0。

## 固定入力と実行

- [原handoff](https://github.com/watchout/agent-memory/issues/307#issuecomment-5754323496)、本文SHA256 `2639d539237205fbb67d56e2e543292112d64d41ebe899914cdc5add766cbdc0`。
- [CTOによる追加誤条件の訂正](https://github.com/watchout/agent-memory/issues/307#issuecomment-5754347862)、本文SHA256 `662d37f73979164742f46c3b43f12137abb9be19b1d227d4ed2ffbbc059f73cb`。
- actor `codex-cto/e3_independent_review`、function `implementation_executor`（隔離build/evidenceのみ）。自己独立受入なし。
- build source `e49abc24838227776dc01be111aeb035ec7c9aad` / tree `a55dd96fe6a753ea2ab6bcb8134172ca0d086a42`。
- 専用clean worktree `/private/tmp/kusabi-e49-source-20260921`。実行前後のtracked/untracked statusは空、dist非symlinkを事前確認。証拠保存側6070eaをbuild対象にしていません。
- 元時計開始 `2026-09-21 10:42:02.504214 JST`、締切 `11:02:02 JST`。初回candidate実行 **10:47:04.373378〜10:47:08.239826 JST / 3.866秒 / exit 0**、timeoutなし、再試行0。
- Node `v25.6.1`、npm `11.9.0`、Darwin `25.6.0 arm64`。明示PATH/LANG/TMPDIRと隔離npm cache/userconfig/globalconfig等8変数のみを子へ渡しました。HOMEを別用途に再定義せず、ambient DB/provider/auth環境とNODE_OPTIONSを継承していません。

```sh
node scripts/build-kusabi-content-addressed-runtime-release.mjs --mode candidate --expected-head e49abc24838227776dc01be111aeb035ec7c9aad --release-root /private/tmp/kusabi-e49-candidate-20260921 --evidence-output /private/tmp/kusabi-e49-candidate-20260921/candidate-evidence.json
```

既存publisher内の通常 `npm ci --ignore-scripts` → `npm run build`（専用checkoutの`npm run clean && tsc`）→ stage production dependencies → candidate harness → exactReadbackが完了しました。実行回数はpublisher1回、その通常経路だけです。

## 候補実体と読戻し

現在hostのstageは `/private/tmp/kusabi-e49-candidate-20260921/.staging/wasurezu-e49abc248382-w5uIce`。このpathは今回の実観測であり製品固定仕様ではありません。手動削除や共有リンクはしていません。別環境でこのMac pathが直接取得できるとは主張せず、GitHubには指定6証拠fileを公開します。製品バイナリやnode_modulesのGitHub公開は今回の6file scopeに含みません。

|証拠|実値|
|---|---|
|descriptor / 保存release.json|SHA256 `811f8e1fde08da746d02ed750cef584bb29c0f6a4e89da597a20cdfafe982023`|
|runtime full ledger|4,119 files / `3239e8e2c80eff43e3fcdb059875400240b64e22870ed4e233f315f463ecdd95`|
|dist full ledger|260 files / `6bbd76586625ac04e12baa38e8a5af70e69cef5339cf8e7f08f08ac72bafec3d`|
|候補harness ledger|`e3a471e802b088d4e772539e61f718dd80b2637163fb23a0473de04df95d1b57`|
|harness conformance|`891396282782c6b1fde3f4a3016766d1d08415401765c9b4cce64b0da0c4ec37`|
|package.json / package-lock.json|`c7d4e9bf81daabee994d1a78c5242bd49cac94df0b617f522b55b49234a970ca` / `e479ab7ee951d1fd82d5e5064ca76700be4716f573f6703e60f01f26b6b5ed60`|
|installed node_modules/.package-lock.json|`d184e0a557788da123b091ef02048ea60eb0d9b6bb4fa301e37792d9115721c1`|

同じ無変更publisherのexported `exactReadback` をstageへ1回だけread-onlyで適用し、descriptor・immutable modes・全runtime/dist ledger・required entrypoint mapを照合しました。final対象のmode readbackやharnessの再実行ではありません。加えて元記録のrequired/追加entry計14件を現在bytesと比較し、全件一致。runtime/dist hashとconformanceも以前の同source記録と一致しました。新descriptor hashは今回のstage/invocation ledgerを含むため旧private descriptorと異なります。差分を製品変更と誤認せず、旧hashを流用しません。

詳細の14entry ledger、正確argv/環境/version/時刻、readback結果は[execution.json](execution.json)。[release.json](release.json)、[candidate-evidence.json](candidate-evidence.json)、[stdout.log](stdout.log)、[stderr.log](stderr.log)は実fileのbytesをそのまま保存しました。stdoutは760bytes、stderrは0bytesです。

publisherは子npm/harnessのstdoutを内部captureするため、親原文logに詳細npmログや完全child ledgerは出力しません。完全child ledgerの原文は欠測で、そのhash/conformanceと正常経路の実exitを保存しています。原文を作るためのharness再実行はしていません。harnessの範囲はimport/export/resource/package確認で、`forbidden_effect_counts=0`は定数です。動的な副作用監視、実native受渡し、LLMの文脈保持や有用な作業完了の証明にはしません。

## 事前確認の誤停止も保持

初めにexecutorが原handoffにない `build == 'tsc'` のassertionを追加し、実際の `npm run clean && tsc` に対してexit1で停止しました。その時点のcandidate実行は0回、候補rootも未作成でした。製品失敗やCAS build失敗ではありません。CTOがcleanの作用が専用worktree dist内でpre/post hookなしと確認し、上記dispositionで余計な条件だけを訂正しました。当初時計・1回上限をリセットしていません。

原エラー全文と表示stdoutはexecution.jsonの`prior_executor_precheck`へ保持。失敗の厳密な発生時刻は欠測でnull、原エラーの保存時刻は10:45:34.609325 JSTです。元toolのcombined outputからの転記であり、その事前確認の分離raw streamは未保存と明記しました。後続candidateのstdout/stderrは実原文fileです。

## 残る境界

共有.kusabi-releasesへの公開・link・merge・runtime/DB/profile/queue/認証・実provider/fleet操作・CI手動起動は0。source/tests/schema/config編集0。最終AUN v2との互換（M-AUN-COMPAT-01）、現在の操作権限（M-AUTH-01）、認可された適用後の実M/qa native receipt/TTL（M-LIVE-01）は未完です。旧C23の期限・枠は流用しません。

next_action: owner=codex-cto / Kusabi repo責任者 / adf-lead; required_function=現在の調整・接続入力function; action=今回の候補実体とhashを消費し、残る共有配布・AUN v2互換・実接続入力を元契約のまま扱う; delivery=#307固定結果commit→既存Shirube接続欄; input_refs=原handoff/訂正disposition/本6files/6070ea; scope=候補実物のみ、保護操作や全体受入へ昇格しない; deliverable=同版の再照合可能なprivate candidate; completion_evidence=e49/a55・初回exit0・descriptor/全stage/14entry読戻し・別途必要な独立判断を保持; blocking=false。
