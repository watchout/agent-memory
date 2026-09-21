# AUN v2 接続用 Kusabi 入力（既存 2 資料の統合）

準備資料の統合完了。**e49 の private candidate は生成済み**です。共有 final CAS、最終 AUN 版との同版互換、実適用 M、実 QA native receipt / TTL は未確認です。資料完成は TRIAL_READY・USE 受入ではなく、64 工程への加算は 0 です。

目的（既存指示の原文）: 「AUN担当とShirube担当が、Kusabiの必要版・記憶の受渡し・確認方法を使って最初の試運転へ接続できる状態にする。」

## 今回の入力と取込み範囲

- [今回の限定 handoff](https://github.com/watchout/agent-memory/issues/307#issuecomment-5755406406) SHA256 `e789460a407fba892fb4bcab587d2a4e5fd4d09beb46f955147828f88e626ff1`。actor `codex-cto/e3_independent_review`、function `control_artifact_author`、`governed_manual_lane`。実開始 2026-09-21 13:30:11.497271 JST、上限 25 分。
- 統合先: branch `codex/kusabi-memory-connection-e3-20260921`、worktree `/Users/yuji/Developer/.worktrees/kusabi-memory-connection-e3-20260921`。基点は `4b0e35fb74ad4fa82b172dbfed1b0162dc6bfcf3`。今回の最終 commit はこの README と inputs.json を含む返却コメントに固定します。
- 編集は本 README と既存 `inputs.json` の 2 件のみ。製品 source/tests、元枝・元 commit、`candidate-package/` の 6 証拠ファイルは不変。新しい runtime 設定・入力規格・台帳は作っていません。

| 作者・既存成果 | 固定参照 | 今回の取込み |
|---|---|---|
| repo Kusabi (`kusabi` / 当該 CLI の `/root`) | [`f7723c7e2fb07efb57ed55965e8eaeeec4a93130`](https://github.com/watchout/agent-memory/commit/f7723c7e2fb07efb57ed55965e8eaeeec4a93130) / [10:31 返却](https://github.com/watchout/agent-memory/issues/307#issuecomment-5754259676) | 既存 worksheet 形式、`shirube_input_transfer` の全 key、KMC-01〜04、記憶契約、同版の既存試験・独立確認記録、GoalRun / B4 / UNMET を保持 |
| CTO 既存担当 (`codex-cto/e3_independent_review`) | [`6070ea34177d7e2edfca5f7802955c4d5628de14`](https://github.com/watchout/agent-memory/commit/6070ea34177d7e2edfca5f7802955c4d5628de14) / [準備返却](https://github.com/watchout/agent-memory/issues/307#issuecomment-5754291764) | 原証拠と歴史的調査の出典を保持。既存の平坦な `shirube_input_mapping` key も互換入口として保持 |
| 同じ CTO 担当による候補生成 | [`4b0e35fb74ad4fa82b172dbfed1b0162dc6bfcf3`](https://github.com/watchout/agent-memory/commit/4b0e35fb74ad4fa82b172dbfed1b0162dc6bfcf3) / [候補返却](https://github.com/watchout/agent-memory/issues/307#issuecomment-5754387701) | 実際に生成した candidate descriptor、14 entry、runtime/dist/dependency と実行原文の証拠を追加 |

別枝で同じ準備が進んだ事実を上書きで消していません。`inputs.json.author_history` に各作者・元 execution_context・commit/tree・原文 hash を保持しています。今回の作者は候補生成の maker でもあり、独立 checker を名乗りません。既存の独立 source 確認は元 reviewer の記録として引用し、現在候補の独立受入へ読み替えません。

## 1. 必要版・候補の具体値

| 項目 | 観測済み値 |
|---|---|
| product source / tree | `e49abc24838227776dc01be111aeb035ec7c9aad` / `a55dd96fe6a753ea2ab6bcb8134172ca0d086a42` |
| candidate descriptor SHA256 | `811f8e1fde08da746d02ed750cef584bb29c0f6a4e89da597a20cdfafe982023` |
| private stage | `/private/tmp/kusabi-e49-candidate-20260921/.staging/wasurezu-e49abc248382-w5uIce` |
| runtime tree | `3239e8e2c80eff43e3fcdb059875400240b64e22870ed4e233f315f463ecdd95` / 4119 files |
| dist tree | `6bbd76586625ac04e12baa38e8a5af70e69cef5339cf8e7f08f08ac72bafec3d` / 260 files |
| dependency lock | `d184e0a557788da123b091ef02048ea60eb0d9b6bb4fa301e37792d9115721c1` (`node_modules/.package-lock.json`) |
| conformance hash | `891396282782c6b1fde3f4a3016766d1d08415401765c9b4cce64b0da0c4ec37` |
| 生成実行 | 2026-09-21 10:47:04.373378〜10:47:08.239826 JST、3.866 秒、exit 0、1 回 |
| 保存済み stage readback | 2026-09-21 10:48:25.338200 JST、10 required + 4 additional entry = 14 件、各 SHA256 / bytes / 非 symlink を保存 |
| 実行環境 | Darwin arm64、Node v25.6.1、npm 11.9.0 |
| 共有 final CAS / 実 M | `null` / 未確認 |

これは保存済みの candidate 生成・maker readback を消費した記録です。今回、build・harness・製品試験を再実行していません。private stage を現時刻に再観測したとも、GitHub から配布 payload 全体を取得できるとも主張しません。GitHub にあるのは下記 6 証拠ファイルです。共有配布のための全 payload と最終 CAS は別途必要です。

| 不変の証拠ファイル | bytes | SHA256 |
|---|---:|---|
| [README.md](https://github.com/watchout/agent-memory/blob/4b0e35fb74ad4fa82b172dbfed1b0162dc6bfcf3/docs/verify/aun-v2-memory-connection-20260921/candidate-package/README.md) | 7145 | `572af8f5d11e7cd535b528babb3ecf1d9710ff1028211b022ba9106576db70ac` |
| [execution.json](https://github.com/watchout/agent-memory/blob/4b0e35fb74ad4fa82b172dbfed1b0162dc6bfcf3/docs/verify/aun-v2-memory-connection-20260921/candidate-package/execution.json) | 14688 | `c7948fb4efbb052c3f5af5ee1c02778f8a257fcd1cf334f107821605092ad0a7` |
| [stdout.log](https://github.com/watchout/agent-memory/blob/4b0e35fb74ad4fa82b172dbfed1b0162dc6bfcf3/docs/verify/aun-v2-memory-connection-20260921/candidate-package/stdout.log) | 760 | `378097a5f5ad93b5cd2637057825731711e1c9ee725c11ffbf8e8b2516dcf15c` |
| [stderr.log](https://github.com/watchout/agent-memory/blob/4b0e35fb74ad4fa82b172dbfed1b0162dc6bfcf3/docs/verify/aun-v2-memory-connection-20260921/candidate-package/stderr.log) | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| [release.json](https://github.com/watchout/agent-memory/blob/4b0e35fb74ad4fa82b172dbfed1b0162dc6bfcf3/docs/verify/aun-v2-memory-connection-20260921/candidate-package/release.json) | 2327 | `811f8e1fde08da746d02ed750cef584bb29c0f6a4e89da597a20cdfafe982023` |
| [candidate-evidence.json](https://github.com/watchout/agent-memory/blob/4b0e35fb74ad4fa82b172dbfed1b0162dc6bfcf3/docs/verify/aun-v2-memory-connection-20260921/candidate-package/candidate-evidence.json) | 833 | `bb7e00e071a0000d1d1c789255c156c50ad9483005bae0f2ba6da23863732521` |

既存 publisher の import/export/resource/package conformance を示す範囲です。実 QA host の起動・入力・記憶受渡し、製品の全試験、最終 AUN との相互運用は証明していません。harness の forbidden-effect counters は固定値であり動的監視ではありません。内部 npm/harness の stdout は無改造 publisher から公開されないため補完していません。

9/13 の `3d9a67…` と 9/14 の `a26fd9…`、10:25 / 10:30 の古い stage 不在観測は歴史的証拠として残します。現在 candidate の識別子は `811f8e…` です。descriptor に private stage を含む invocation ledger が関与するため、後日の `--mode publish` で同じ descriptor になるとは仮定しません。今回の input は candidate 生成の再依頼ではありません。

## 2. 記憶の受渡し

`inputs.json.memory_contract` は f772 の具体契約を保持します。予定対象は agent/project `qa`、workspace `/Users/yuji/Developer/qa` です。これは予定値で、現 target の identity / tools / provider / capacity を確認した値ではありません。

- 保存: 既存の書込権限を持つ実 task producer が `save_task_state` へ目的・未完・次の行動を記録し、同じ agent/project/store で記録 ID と本文を readback。制限された worker の権限を広げません。
- 回復: `recover_context` / `restart_pack` の同一 namespace と work digest を照合。実行済み・不明の副作用を再実行しません。
- native 受渡し: durable started → 完全な pack と current OS identity / pipe 検証 → 実 write callback 成功と再観測 → durable finished → 最新 attempt の独立 readback。hook と MCP の intended store を同一に束縛します。
- `provider_executable_sha256` は executable path/dev/inode/size/mtime/mode/startTicks の tuple hash で、実行ファイル内容 hash ではありません。版の証拠には別の binary byte digest が必要です。
- 異常拒否: 別 agent/project、旧・再利用・消失 PID、start/executable/session 不一致、最新 pending/failed、start 欠落・曖昧な順序、遅れた旧 completion、切れた履歴/目的/Next、EPIPE/timeout/store failure。
- e49 native receipt 自体に固定 TTL field はありません。AUN 9d7 の既定 1800 秒は旧 source の事実であり今回の有効期間ではありません。selected TTL / completed_at / valid_until / check_at は `null` のままです。

[D1〜D4 の owner 採択](https://github.com/watchout/agent-comms-mcp/issues/940#issuecomment-5755364993)（SHA256 `8414bb149e2a8b9aee4fb62b87f11d6109d5bc9bf9beb67019e282e21bcc1791`）により、AUN 管理下の DB / metadata / audit / outbox / receipt copy へ物理 runtime/provider/port/PID/path/liveness を新規永続化しない境界を維持します。Kusabi が所有する記憶原文の保存は変更しません。f772 の AUN 9d7 binding は旧 interface の比較記録で、最終 AUN に物理 receipt を保存する許可ではありません。最終 R と同版の互換証拠はまだありません。

## 3. 正常・異常の既存試験と、次に不足する互換確認

`reused_tests` / `existing_independent_acceptance` / `source_catalog` は f772 の固定 e49/a55 証拠をそのまま引継ぎます。Mac native 148、SQLite 204、core 1591 と Claude/emitter の既存原文ログを参照します。caller 集計に含まれる同じ 148 件を重複加算しません。Linux は run `34750856136` の Node 18/20/22 と同一 tree の記録です（実 checkout `9d89f2a0abafc296116794897c7e53f32096266d` / a55、trigger e49）。これらを今回再実行したとは扱いません。原ログ hash と実施主体・時刻の詳細は既存 JSON の記録と原 commit を参照してください。

既存の source 独立確認と candidate の maker readback は異なる証拠です。実 QA LLM への回復、最終 AUN consumer、現在のインストール状態の受入は未観測です。AUN の採択済み非永続化修正後、既存 AUN 担当が確定 R/tree と e49/M を束縛し、`proposed_affected_tests` の影響範囲を既存 handoff で実測・独立確認します。現時点で模擬 PASS は置きません。

## 4. 既存 Shirube への転記と残項目

転記先は [789ecf3e の既存 inputs](https://github.com/watchout/ai-dev-framework/blob/789ecf3e2744bf0e1b18b12d5884e82d0f50f576/docs/verify/a2-connection-20260921/inputs.json)（SHA256 `02278f649cccef7a8126cff47eec9652f2349bfc53e0e477eb4c60091e502b01`）。`shirube_input_transfer` を主入口にし、元の pre-apply / post-apply key を変えていません。旧 `shirube_input_mapping` の平坦 key も保持しています。今回の commit にある 2 docs を次の consumer 入力とし、元 f772 / 6070 は作者履歴・歴史的根拠として参照してください。

| ID | 現在の状態 | 担当・次の具体入力 |
|---|---|---|
| KMC-01 | private candidate 生成済み。共有 final CAS・独立受入は未確認 | CTO が後段の exact publication operator/checker と範囲を束縛。実行済み candidate 生成を再依頼しない。後日の publish は既存実装上 rebuild を含み、現在の別権限・結果 readback が必要 |
| KMC-02 | 最終 AUN 互換未確認 | 実装中の既存 AUN maker が final R/tree、同じ R + e49/M の正常・異常試験、別 checker の受入を返す |
| KMC-03 | 現在適用の identity/store/trust/backup/stop/restore/権限/時計が不足 | CTO と既存 operator/checker が後段の具体値を束縛。9/14 の期限・旧 session・旧権限は流用しない |
| KMC-04 | post-apply / pre-Task1 の未来観測 | 認可された operator → 独立 checker → Shirube consumer。実 R/M、PID/start/session、最新 receipt / TTL を実適用後に確認。今回の資料完成の前提にはしない |

`required_was_commit_tree_cas_descriptor` には candidate source/tree、private stage、descriptor、entry evidence を入れます。一方 `actual_cas_root` / `actual_descriptor_sha256` は `null`、全 5 個の post-apply key も `null` のままです。private stage を共有 final CAS や実 M の欄へコピーしないでください。

root GoalRun `GOAL-RUN-CTO-940-QA-USE-20260908-001`、`B4-ACTUAL-USE-EVIDENCE-PENDING`、元 USE-01〜09 の全 UNMET を保持します。B4 は最終 USE-09 完了 blocker であり、今回の資料や AUN2 開始の追加 blocker にはしません。

停止・復旧は `stop_restore_and_independent_check` を参照。source/descriptor/identity/store 不一致、権限失効、現作業不明、receipt 不一致などで当該適用を停止し、正確な preimage と現在認可された手順だけで復旧します。D4 により旧 F522 は自動 fallback にしません。exact stop / restore argv と backup hash は未観測 `null` のままです。

## 今回の完了境界

今回の確認は JSON 構文、既存 key / KMC ID / 未観測値の保持、固定参照 hash、差分 2 files、commit/push と GitHub 原文 readback のみです。製品試験・build・手動 CI・PR・merge・runtime・DB・認証・queue・追加 agent は 0。過去の候補 build 1 回は別 handoff の実績であり、今回の実行数に混ぜません。

`next_action` は既存 CTO / Shirube consumer がこの入力を消費し、AUN の確定版が戻った後に既存担当へ同版互換を接続することです。資料の返却は `blocking: false`。保護された後段だけを KMC-01/03 の未確認として区別し、無関係な通常開発を止めません。
