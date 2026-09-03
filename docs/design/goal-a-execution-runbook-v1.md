# Goal A Execution Runbook v1

- 正本 control source: https://github.com/watchout/agent-memory/issues/307(body sha256 `cd525676b20f785ee0adf61ee3b079790a97569d0c88761210abc92da229cbb0`)
- 権限: `OD-KUSABI-307-GOAL-A-PREREQUISITES-A1-START-20260826-001`(#307 comment 5422741627、sha256 `e8bd5d5295a596f69eef445f74c2051a74ede37fa4d18a7f2c056b6cebb32bbf`)
- 派生 cell graph(機械可読の正): `docs/design/goal-a-derived-cell-graph-v1.json`
- 対応 DesignPack: `docs/design/goal-a-execution-runbook-v1.design-pack.json`
- generation 3 の権限: `OD-AM307-KUSABI-COMPLETION-CORR1-20260830-001`(#307 comment 5465582876、sha256 `5bada02648337429d425faa134a5b953a1e4071b502f48e2894544d69fb4b9df`)+ handoff `CH-CTO-AM307-ARC-KUSABI-COMPLETION-GEN3-20260903-001`(#307 comment 5516992172、sha256 `f7b481d3b109d7ef6217afdc77027cbb11a3ab57313f256fbaefd72b2fb355a9`)
- 完成定義の正本: `KUSABI-INTERNAL-OPERATION-DONE-V1`(#307 comment 5435912512、sha256 `3cb6543db9532ba75031237b4cd9508686ab56ce3e78fa720fa40eb573740ba6`、上記 CORR1 で amend)。本書 §6 が原子行への写像、DesignPack の `completion_contract` が機械可読の正
- generation 3 base: watchout/agent-memory `b854894abc80b593ff275e5c1fb62ea71ca8320d`(tree `4aa9d8f288f6d917fa8476c1b3aed6d84a796b3c`、owner 凍結。non-force merge で同期)

本 runbook は Goal A(全エージェント内部運用、A1→A11 + A5b の 12 cell・順序凍結)を
**止まらず・壊さず・誤魔化さず**進めるための実行規則を凍結する。実装は認可しない
(各 cell の実装は個別の bounded handoff と、必要な場合 owner decision を別途要する)。

## 1. 進行順序

順序は cell graph の `exact_order` が唯一の正である:

```
A1 → A2 → A3 → A4 → A5 → A5b → A6[owner] → A7[owner] → A8 → A9 → A10[owner] → A11
```

- 先行 cell が CLOSED になるまで次の cell は開始できない(唯一の例外 = #307 への
  owner-decision waiver comment を URL + raw_api_body_sha256 で引用した場合)。
- **A5b は nonterminal**: A5b の完了は A5b 自身しか満たさない。A1 の代替・skip には
  決してならない(owner 決定の sequencing_rule)。
- owner gate cell(A6 / A7 / A10)は、新しい owner decision comment の引用なしに
  PLACED から先へ進めない。A5b は delta に DB schema migration が含まれる場合のみ
  条件付き owner gate になる(amendment F1 手順3)。

## 2. 共通 lifecycle(全 cell 共通、5 状態)

```
BUILT → PLACED → ACTIVATED → EFFECT_PROVEN → CLOSED
```

| 状態 | 入口 predicate(これを満たすと入る) | 出口 predicate(これを満たすと次へ) |
|---|---|---|
| BUILT | 成果物が exact commit に存在し、digest が readback で再導出できる | PLACED の入口を満たす |
| PLACED | 成果物が対象環境の正しい位置に配置され、配置の readback(path + digest)が記録済み | ACTIVATED の入口を満たす |
| ACTIVATED | 成果物が実際に稼働状態(process/設定が読み込まれた machine 証拠)にある | EFFECT_PROVEN の入口を満たす |
| EFFECT_PROVEN | cell graph の `effect_predicate` が機械測定で成立(1 回) | CLOSED の入口を満たす |
| CLOSED | effect が要求期間・要求回数で持続し、閉鎖 evidence(URL + sha256)が #307 に publish 済み | (終端) |

規則:

- **遷移権限**: BUILT/PLACED/ACTIVATED は implementation executor が evidence 付きで
  宣言できる。EFFECT_PROVEN は機械測定のみが根拠(主張・ACK・CI green は不可)。
  CLOSED は maker 外の監査 evidence を要する。owner gate cell はさらに owner decision を要する。
- **invalid transitions(typed 拒否)**: 状態の skip / 逆行 / adapter・queue 状態
  (AUN の ACK・done を含む)による遷移 / 証拠 digest 欠落での遷移。
- **idempotency**: 同一 cell への同一遷移要求は 1 回だけ効果を持つ(遷移記録は
  cell id + 状態 + evidence digest で一意)。
- **並行**: cell は同時に 1 つだけ ACTIVATED 作業を持てる(WIP=1)。graph 上の
  後続 cell の準備作業(BUILT まで)は先行して良い。
- **retry**: 遷移の失敗は同一遷移につき 3 回で typed failed として記録し、#307 に
  1 回だけ escalation を publish して待機する。owner gate 待ちは 1 回通知して停止
  (待機中の成果物量産は禁止)。
- **no-progress halt(gen2 改訂 = F-02 是正)**: 同一 cell・同一操作・同一 subject に
  対する評価が typed 遷移(状態前進、typed failed、typed stop のいずれかの新規記録)を
  生まなかった場合、その評価を no-progress と数える。**証拠 digest が直前の評価と
  同一か否かに関係なく**、連続 no-progress 評価 3 回で typed 停止する(同一 digest の
  無限反復こそ canonical な無限ループであり、必ず 3 で停止に到達する)。counter は
  typed 遷移の新規記録で 0 にリセットされる。同一評価イベント id の再送は 1 回として
  数える(冪等)。counter の scope は cell id + 操作 + subject digest の組。
- **expiry(gen3 改訂 = F-02 是正の完結)**: 非終端状態(BUILT / PLACED / ACTIVATED /
  EFFECT_PROVEN)の記録は expires_at(既定 = 記録時刻 + 7 日、cell の bounded handoff で
  上書き可)を持つ。expires_at 経過時に出口 predicate が未成立なら **typed EXPIRED record**
  を 1 件だけ記録する。**EXPIRED は状態ではない**(lifecycle は 5 状態のみ。状態は
  変わらず、cell は `stalled=true` を伴って現在の状態に留まる)。EXPIRED record の readback =
  typed 記録の URL + raw sha256。回復は次の 3 つの typed 記録のいずれかでのみ行う:
  (a) cited owner decision / waiver(URL + raw sha256)→ 出口 predicate の評価を再開、
  (b) typed failed → §2「typed failed 後の前進範囲」、(c) 再計画 = 新しい bounded
  handoff(expires_at を再設定)。**回復 actor = `codex-cto` / `orchestration_controller`**
  (function catalog の束縛どおり。`arc` / `control_artifact_author` は (c) の handoff /
  construction pack を authoring するが、状態を進める権限は持たない)。escalation は #307
  に 1 回だけ publish して停止(待機中の成果物量産は禁止)。EXPIRED record は状態を
  逆行させず、skip もしない(IT1 と矛盾しない)。
- **typed failed 後の前進範囲(gen2 明確化 = F-02 是正)**: 先行 cell が typed
  failed / typed stop / EXPIRED のまま CLOSED でない間、graph 順序上の後続 cell に
  許されるのは **BUILT までの order-safe な準備のみ**。後続 cell の PLACED 以降は、
  先行 cell が CLOSED になるか、cited waiver または recovery の typed 記録が先行 cell を
  閉じるまで開始できない(§1 の順序規則と矛盾しない)。
- **evidence identity**: すべての遷移 evidence は「URL(不変 comment または
  commit/path)+ raw sha256」で一意化する。**URL + sha256 を欠く引用は権限として
  無効であり、typed 拒否する**(#307 設計チェック C2 の是正。8/16 の 315 tick
  空回り事故の設計側の根の閉鎖)。
- **terminal admission**: CLOSED の判定は本 runbook + graph の predicate に対する
  機械照合のみ。人間の宣言・LLM の作文は判定に入らない。

## 3. adapter 境界(Codex / Claude / Gemini)

- **意味の核は 1 つ**: 上記 lifecycle・遷移権限・evidence identity・terminal
  admission が唯一の意味論であり、3 adapter はこれを共有する。
- **semantic core digest の導出(gen2 追加 = F-04 是正)**: adapter が携行する
  semantic core digest は宣言値ではなく、次の canonical serialization からの再現可能な
  導出値である:
  `semantic_core_digest = sha256("GOAL-A-CORE:" + <本 runbook の sha256:… digest> + ":" + <cell graph の sha256:… digest>)`
  導出コマンド(何にも依存しない 1 行):
  ```sh
  python3 -c "import hashlib,sys; r=lambda p:'sha256:'+hashlib.sha256(open(p,'rb').read()).hexdigest(); print('sha256:'+hashlib.sha256(('GOAL-A-CORE:'+r('docs/design/goal-a-execution-runbook-v1.md')+':'+r('docs/design/goal-a-derived-cell-graph-v1.json')).encode()).hexdigest())"
  ```
  runbook または graph の内容が 1 byte でも変われば digest が変わり、旧 digest を保持した
  adapter 記録は不一致として機械検出される(negative fixture = 入力 digest を 1 つ変えて
  導出値が変わることを測る)。
- adapter が翻訳してよいのは **transport と format のみ**(CLI 呼出形式・session の
  起動方法・出力の包み方)。状態・権限・gate・reason code・evidence 意味論の
  再定義は禁止(検出時 typed 拒否)。
- **AUN 境界**: AUN は仕事と結果の輸送に使える。ただし AUN の queue close・ACK・
  done は product/cell 完了では **ない**。同一の意味契約は AUN 不在時に direct
  executor(Codex/Claude/Gemini の直接起動)でもそのまま使えなければならない。

## 4. 停止規則(owner verbatim の反映)

owner 指示「できるかぎり止まらずに進んでほしいが、破壊的こういや∞ループ次は即停止」:

- **即時停止(typed)**: 破壊的操作の必要が生じた場合(delete/reset/force-kill/
  fleet restart/schema migration/DB mutation/secret)/ 同一操作の無限反復を検出した
  場合(連続非進捗 3 評価)/ subject digest 不一致。
- 停止は #307 への 1 comment(typed reason + 現在地 + 再開条件)で行い、以後
  artifacts を作らない。
- それ以外の障害は typed failed として記録する。その後に進めてよいのは §2 の
  「typed failed 後の前進範囲」のとおり、後続 cell の BUILT までの order-safe な
  準備のみ(先行 cell を CLOSED にする recovery / cited waiver なしに後続の
  PLACED 以降へは進まない)。

## 5. 前提 1-5 と本書の対応

| 前提 | 対応物 |
|---|---|
| 1: Goal A Execution Runbook v1 | 本書 |
| 2: machine-readable derived cell graph(A5b 含む) | `goal-a-derived-cell-graph-v1.json` |
| 3: common lifecycle 5 状態 | 本書 §2 |
| 4: Codex/Claude/Gemini adapter contract | 本書 §3 |
| 5: fresh maker-separated Design Flow v2 gate | DesignPack を maker(arc)外の registered `evidence_audit_gate` が審査。generation 3 の checker は handoff `CH-CTO-AM307-ARC-KUSABI-COMPLETION-GEN3-20260903-001` が `devauditor` に束縛(actor 独立の述語: maker history に含まれない registered evidence_audit_gate であること) |

## 6. 完成定義(KUSABI-INTERNAL-OPERATION-DONE-V1)の原子行への写像(gen3 追加)

owner 凍結の完成定義(#307 comment 5435912512)と、その amendment(CORR1 = alpha 割当
`kusabi-continuity-alpha-assignment/1.0.0`、generation 3 base、決定論の明確化)を、
**誰が評価しても同じ PASS / FAIL / INCOMPLETE になる原子行**に写像する。機械可読の正は
DesignPack の `completion_contract`(row_families / assignment_registry / oracle /
comparison_schema / boundary_table)であり、本節は人間向け要約である。

- **verdict**: `PASS | FAIL | INCOMPLETE`(閉集合)。優先順位 `FAIL > INCOMPLETE > PASS`。
  `FAIL_AND_RESET` は verdict=FAIL + `reset_required=true` に正規化する(別の verdict ではない)。
- **終端式**: `KUSABI_INTERNAL_OPERATION_PASS = AUTHORITY_PASS AND CAPABILITY_PASS AND KBF_V1_PASS AND ALPHA_EXPERIENCE_PASS AND FLEET_OPERATION_PASS AND ASSURANCE_PASS`。
  技術 PASS(TECHNICAL_VERDICT)が owner 閉鎖(FINAL_VERDICT)に先行し、owner 閉鎖は欠けた技術証拠を補えない。
- **行族と join key**(各 instance は正確に 1 verdict): AD-01(packet_id + canonical_bytes_digest)/
  AUTH-01(decision_id + issuecomment_url + raw_body_sha)/ C01-A(subject + tool_id + schema_id + smoke_case_id + run_class)/
  C02-A(subject + memory_kind + item_id + write_operation_id)/ C03-A(subject + entity_id + transition_id + as_of)/
  C04-A(subject + target_key + identity_field + query_id)/ C05-A(subject + query_id + backend + rank)/
  C06-A(subject + host_runtime + run_key + identity_field)/ C07-A(subject + run_key + recovered_field + expected_item_id)/
  C08-A(subject + run_key + fact_id + authority_ref)/ C09-A(subject + run_key + metric_id)/ C10-A(subject + run_key + action_id/result_id)/
  C11-A(subject + fixture_id + scenario_class + hazard_kind)/ C12-A(assignment_manifest_digest + scenario_id + ordinal + actor + host + binding)/
  C13-A(manifest_version/hash + target_key + bucket_index + identity_field)/ C14-A(subject + evidence_item_id + producer_id + receipt_id + audit_id)/
  RESET-A(old subject + trigger_event_id + new manifest/version/hash)。
- **alpha 割当(owner 凍結、分母不変)**: counted 16 行(S1〜S13 各 1、S14 は codex=qa / claude_code=check / gemini_cli=kusabi-gemini の 3)+ S15 負 fixture 1 行 + **P0 順序 10 行(別分母、scenario credit 0)**。
  credit 規則(SCENARIO_ONCE / FIXTURE_SCENARIO_ONCE / S13_DEGRADATION_ONCE / S14_HOST_ONCE / S15_NEGATIVE_ONLY / P0_ONLY / P0_AND_S3_SCOPE_ONLY)と
  「1 receipt は counted 行 1 つだけを満たす」を機械で強制する。Issue #263 の P0-each / 複数担当の記述は分母を拡張しない(SOURCE_MATERIAL_ONLY)。
- **selector B(agent, host, project)**: A6 owner 凍結 manifest の適用行が正確に 1 件。manifest 凍結前 / 値欠落 = INCOMPLETE、0 件 or 複数件 = FAIL、runtime readback 不一致 = FAIL。
  manifest の宣言は runtime readback ではない。`kusabi-gemini`(gemini_cli、alpha-canary-only、normal_work_queue=false)は #180 comment 5054279853 の専用 binding 行を用いる。
- **target key** = `sha256(agent_id + "\n" + project + "\n" + host_runtime + "\n" + workspace_sha256)`。store binding は必須 readback だが key には入れない。
- **時間**: `T0 = soak_start`、bucket `i = 0..95` = `[T0 + i×900000, T0 + (i+1)×900000)` ms に **独立観測 1 件ずつ**。未来の欠落 = INCOMPLETE、期限超過の欠落 = FAIL、95/96 かつ 24h 未完了 = INCOMPLETE(deadline_breached=true)。
  late observation: presence 行は同一 subject の有効証拠なら PASS 可、timeliness 行は observed_at が閉じた deadline より後なら FAIL。
- **reset**: trigger = manifest / subject 変更、分母縮小、mixed semantic revision、無効権限下の protected effect の実効。**証拠欠落だけでは reset しない**。
  reset は verdict を FAIL のまま `reset_required` を別 boolean で立て、reset_scope / 無効化する window と evidence id / late-event 処理 / 新 T0 / retry owner / rollback+readback を凍結する。
- **producer 独立**: manifest 宣言者は expected を作れるが actual running state を証明できない。actual は外部 readback(producer_relation が宣言者と異なる)のみ。
- **false-pass / false-fail 境界**(DesignPack `boundary_table` が閉集合): 行 deadline 前の欠落 = INCOMPLETE、観測値誤り = FAIL / expected-negative fixture は positive-path の errors=0 を破らない / 承認済み maintenance は T0 前に manifest 凍結、分母不変、独自 expected state / 矛盾なし = authority probe 完了時のみ PASS、probe 欠落 = INCOMPLETE / 可視の安全劣化(S13)は劣化 scenario のみ PASS、recovery-success credit 0 / 自己監査 = FAIL、外部監査欠落 = INCOMPLETE、PR/CI/queue/placement のみ = INCOMPLETE / inventory-only や manifest 複写の identity は独立観測ではない / 権限失効後の効果前 = INCOMPLETE、無効権限下の実効 = FAIL / 28/30・4.5・10000/30000/60000 ms・0.80・0.05 の境界値は PASS、1 単位超過は FAIL。

## 7. 運用者の journey と accessibility(gen3 追加 = F-01 L03)

- 運用者(owner / 各席の人間)が触れる面は **#307 の immutable comment・PR #318・CLI 出力**のみで、GUI は無い。
- 全 comment は typed yaml block + 平文 markdown の二層(機械欄と人間欄)で、色・画像・位置だけに意味を持たせない(text-only、screen reader で読める)。
- owner gate は「1 回通知 → 停止」。escalation comment は現在地(cell / 状態 / evidence digest)と再開条件を必ず含む。人間は URL + raw sha256 を引用して裁定する。
- 誤操作の回復: 無効な遷移要求は typed reject と状態不変。人間の裁定ミスは新しい owner decision で前向きに訂正(過去の comment は不変)。

## 8. 予算(gen3 追加 = F-01 L09)

| 予算 | 値 | 枯渇時の挙動(typed) |
|---|---|---|
| 連続非進捗評価 | 3 | halt、通知 1 回 |
| 通知 | 1 / 事象 | 2 回目は artifact として拒否 |
| 遷移 retry | 3 / 遷移 | typed failed |
| 非終端状態の expiry | 7 日(handoff で上書き可) | typed EXPIRED record、回復 actor へ |
| WIP | 1 ACTIVATED / cell | 2 本目は typed reject |
| corrective generation | 1(本 gen3 で消費) | root active のまま owner disposition |
| 評価 1 回の validator 実行 | 60 s 以内(offline、外部 API 呼出 0、金銭費用 0) | 超過は VALIDATOR_UNAVAILABLE |
| 完成定義の時間 SLO | T1−T0 ≤ 10 s、T3−T0 ≤ 30 s、T4−T0 ≤ 60 s、24h/96 bucket | C09-A / C13-A の行で FAIL / INCOMPLETE |

## 9. 版・移行・可逆性(gen3 追加 = F-01 L10)

- **semantic revision**: 本書と graph の digest から導出する semantic core digest(§3)が版。lifecycle record と adapter record は必ずこの digest を携行し、異なる digest を持つ record / adapter は typed reject(GA-31)。
- **rollout 順序**: 設計 merge(owner exact-head)→ validator 実装(最初の消費 cell の handoff)→ 各 cell の bounded handoff。gen2 以前の semantic revision で作られた lifecycle record は **0 件**(IMPLEMENTATION_INACTIVE のまま)であり、移行対象は無い。
- **gen2 → gen3 の差分**: EXPIRED を状態から typed record に戻す(5 状態)、回復 actor を canonical function に束縛、完成定義の原子行を追加。graph は不変(digest `fadaed57…`)。
- **rollback**: 設計 branch の revert(履歴保持)。#307 の comment は不変なので監査履歴は失われない。runtime 効果は存在しない。

