# Goal A Execution Runbook v1

- 正本 control source: https://github.com/watchout/agent-memory/issues/307(body sha256 `cd525676b20f785ee0adf61ee3b079790a97569d0c88761210abc92da229cbb0`)
- 権限: `OD-KUSABI-307-GOAL-A-PREREQUISITES-A1-START-20260826-001`(#307 comment 5422741627、sha256 `e8bd5d5295a596f69eef445f74c2051a74ede37fa4d18a7f2c056b6cebb32bbf`)
- 派生 cell graph(機械可読の正): `docs/design/goal-a-derived-cell-graph-v1.json`
- 対応 DesignPack: `docs/design/goal-a-execution-runbook-v1.design-pack.json`

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
- **expiry(gen2 追加 = F-02 是正)**: 非終端状態(BUILT / PLACED / ACTIVATED /
  EFFECT_PROVEN)の記録は expires_at(既定 = 記録時刻 + 7 日、cell の bounded handoff で
  上書き可)を持つ。expires_at 経過時に出口 predicate が未成立なら typed EXPIRED を
  記録する。回復 actor は orchestrator(arc)であり、再計画するか #307 に 1 回だけ
  escalation を publish して停止する。EXPIRED の readback = typed 記録の URL + raw
  sha256。expiry は状態を逆行させない(記録が増えるだけで、回復遷移は cited 決定 or
  再計画の typed 記録で行う)。
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
| 5: fresh maker-separated Design Flow v2 gate | DesignPack を maker(arc)外の gate(予約: qa)が審査 |
