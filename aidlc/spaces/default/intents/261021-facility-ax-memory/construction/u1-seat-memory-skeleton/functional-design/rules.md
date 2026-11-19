# U1 の決まり

- 入力: 要件（`inception/requirements-analysis/requirements.md` の FR1・FR3・FR5・NFR1・NFR5・NFR8）、利用者の話（`inception/user-stories/stories.md`）、取り決め（`inception/contract-design/contract-summary.md`）、部品の一覧（`inception/domain-design/components.md`）、共通基盤 0.2 の取り決め（onza main 5beb404 の `docs/common/0.2/contract.md`）、この段階の質問の答え

## 決まりの正本

```yaml
rules:
  # BR1 置き場所（Placement）
  - id: BR1.1
    statement: 共通基盤の形の置き場所は、Kusabi 専用の設定（AGENT_MEMORY_DATABASE_URL）だけから読む。汎用の DATABASE_URL は読まない
    category: constraint
    applies_to: PlacementSetting
    trigger: Kusabi の起動・起動の口の起動
    logic: IF Kusabi 専用の設定がある THEN それを置き場所にする。DATABASE_URL の有無は見ない
    violation: —（汎用の設定は読まれないので、その DB には表が作られない）
    source: FR5.5、取り決め C3
  - id: BR1.2
    statement: 形（共通基盤の形か単独の形か）は、設定 AGENT_MEMORY_MODE で決める。無い時は Kusabi 専用の DB の設定の有無で決める
    category: policy
    applies_to: PlacementSetting
    trigger: Kusabi の起動
    logic: IF MODE=common THEN 共通基盤の形。IF MODE=standalone THEN 単独の形。IF MODE が無い THEN 専用の DB の設定があれば共通基盤の形、無ければ単独の形
    violation: MODE に知らない値 → invalid_input で起動を止める
    source: FR5.1、取り決め C3、契約の段の Q2 = A
  - id: BR1.3
    statement: 共通基盤の形なのに専用の DB の設定が無い時は、設定の名前を挙げて止まる
    category: validation
    applies_to: PlacementSetting
    trigger: Kusabi の起動
    logic: IF 共通基盤の形 AND 専用の DB の設定が無い THEN placement_unset（設定の名前 AGENT_MEMORY_DATABASE_URL を示す）で止まり、どの DB にも表を作らない
    violation: placement_unset
    source: FR5.1・FR5.5
  - id: BR1.4
    statement: 置き場所の DB に届かない時は、ほかの置き場所に書かず、書き込みを失敗として返す
    category: constraint
    applies_to: Decision の保存
    trigger: 決定を書く道具の呼出し
    logic: IF 置き場所の DB に届かない THEN placement_unreachable を返し、手元の SQLite・別の DB・手元のファイルに記録を書かない
    violation: placement_unreachable（成功と言わない）
    source: FR5.3、NFR5
  - id: BR1.5
    statement: 置き場所の DB が戻ったら、Kusabi を起動し直さずに書ける
    category: policy
    applies_to: Decision の保存
    trigger: DB が戻った後の、決定を書く道具の呼出し
    logic: IF 前の呼出しが placement_unreachable だった AND 今は届く THEN 新しくつないで保存する
    violation: —
    source: FR5.3（角の一覧「保存先が使えない」）
  - id: BR1.6
    statement: 共通基盤の形で、置き場所の DB に共通基盤の置き場が無い時は、表を作らず理由を返す
    category: validation
    applies_to: PlacementSetting
    trigger: Kusabi の起動・道具の呼出し
    logic: IF 共通基盤の置き場が無い THEN not_initialized（共通基盤が入っていない）を返す
    violation: not_initialized
    source: 取り決め C4・C5

  # BR2 席の確かめ（SeatIdentity）
  - id: BR2.1
    statement: 席は、接続した DB の利用者から、共通基盤の確かめで決める。道具の引数や環境の値を席の証拠にしない
    category: authorization
    applies_to: VerifiedSeat
    trigger: 決定を書く・読む、起動の口の回復
    logic: IF 共通基盤の確かめが active で期限内の割り当てを返す THEN その所属範囲・主体・席・割り当て・世代を VerifiedSeat にする
    violation: 確かめの失敗の名前（BR2.2〜BR2.5）
    source: FR1.1・FR1.3、ADR-004、共通基盤 architecture.md §4
  - id: BR2.2
    statement: 共通基盤に登録の無い席からの読み書きは受け付けない
    category: authorization
    applies_to: Decision の保存と読み出し
    trigger: 道具の呼出し
    logic: IF 共通基盤の確かめが登録の無い主体・席を返す THEN seat_not_registered を返し、記録を増やさず、何も読ませない
    violation: seat_not_registered
    source: FR1.2
  - id: BR2.3
    statement: 所属範囲に属していない席からの読み書きは受け付けない
    category: authorization
    applies_to: Decision の保存と読み出し
    trigger: 道具の呼出し
    logic: IF 共通基盤の確かめが所属の無いことを返す THEN no_membership を返し、記録を増やさない
    violation: no_membership
    source: FR1.4
  - id: BR2.4
    statement: 引き継ぎ中（draining）・期限切れ・閉じた（closed）割り当ては、読み書きに使わない
    category: authorization
    applies_to: VerifiedSeat
    trigger: 道具の呼出し
    logic: IF 共通基盤の確かめが active で期限内の割り当てを返さない THEN binding_closed を返す
    violation: binding_closed
    source: 共通基盤 contract.md §3（draining・期限切れは新規効果に使えない）、FR1.1
  - id: BR2.5
    statement: 共通基盤の確かめが返す理由は、Kusabi の失敗の名前に写すだけで、意味を作り直さない
    category: policy
    applies_to: 確かめの失敗
    trigger: 共通基盤の確かめが失敗を返した時
    logic: IF 理由が unauthenticated・not_found THEN seat_not_registered。IF forbidden THEN no_membership。IF unbound・retired・stale THEN binding_closed。IF not_initialized・incompatible THEN not_initialized。IF unavailable THEN placement_unreachable。IF invalid_input・conflict THEN invalid_input
    violation: —
    source: 設計・実装の標準 S2、共通基盤の manifest の失敗の一覧（OC001〜OC011）
  - id: BR2.6
    statement: 記録の所属範囲（顧客）は、その席の割り当ての所属範囲で決まる。1 つの席は一度に 1 つの所属範囲
    category: constraint
    applies_to: Decision
    trigger: 決定の保存
    logic: IF 席の割り当ての所属範囲が X THEN 決定の scope_ref は X。割り当てが替わった後の新しい決定は新しい所属範囲、前の決定はそのまま
    violation: —
    source: FR1.4、要件の段の Q3 = A
  - id: BR2.7
    statement: 共通基盤の形では、環境の AGENT_MEMORY_AGENT_ID を持ち主に使わない
    category: constraint
    applies_to: VerifiedSeat
    trigger: Kusabi の起動
    logic: IF 共通基盤の形 THEN AGENT_MEMORY_AGENT_ID の値があっても、読み書きの範囲を変えない
    violation: —
    source: 取り決め C1・C3、ADR-004

  # BR3 決定の記録（MemoryRecords）
  - id: BR3.1
    statement: 決定には、書いた時点の所属範囲・主体・席・割り当て・世代の参照を付け、後から書き換えない
    category: constraint
    applies_to: Decision
    trigger: 決定の保存
    logic: IF 決定を保存する THEN VerifiedSeat の 5 つの参照を付ける。保存の後はどの道具からも書き換えない
    violation: —
    source: FR1.1、共通基盤 contract.md §2、NFR7
  - id: BR3.2
    statement: U1 の決定（仕事の ID が無い）は、書いた席だけが読める
    category: authorization
    applies_to: Decision の読み出し
    trigger: 決定を読む道具・回復
    logic: IF 読み手の VerifiedSeat の seat_ref と所属範囲が決定と同じ THEN 返す。ELSE 返さない
    violation: —（返さない）
    source: FR2.4・FR1.3
  - id: BR3.3
    statement: 決定の保存と共通基盤の確かめは、同じ取引の中で行う
    category: constraint
    applies_to: Decision の保存
    trigger: 決定の保存
    logic: IF 確かめと保存のどちらかが失敗する THEN どちらも残さない（決定は増えない）
    violation: 失敗の名前を返し、決定は増えない
    source: 取り決め C4、共通基盤 contract.md §5、ADR-001
  - id: BR3.4
    statement: 回復の内容に入れるのは、その席の有効な（active の）決定だけ
    category: policy
    applies_to: RecoveryContent
    trigger: 起動の口の回復
    logic: IF 決定の status が active AND BR3.2 で読める THEN 回復の内容に入れる
    violation: —
    source: FR3.1
  - id: BR3.5
    statement: 共通基盤の形で U1 にまだ無い記録の道具は、「まだ使えない」と返し、単独の形や今の表に逃げない
    category: policy
    applies_to: 道具の呼出し
    trigger: 共通基盤の形での、作業の状態・学び・置き換え・会話の取り込みなどの道具の呼出し
    logic: IF 共通基盤の形 AND 道具が U1 に無い THEN not_yet_available（後の単位で入る）を返す
    violation: not_yet_available
    source: 単位の分け方（U2・U3・U6）、FR5.2

  # BR4 回復と起動の口（Recovery・HostAdapters）
  - id: BR4.1
    statement: Claude Code と Codex の起動の口は、その席の有効な決定を、最初の文脈の回復の内容に入れる
    category: policy
    applies_to: RecoveryContent
    trigger: 席の起動（Claude Code・Codex の起動の hook）
    logic: IF 席の確かめが通る THEN BR3.4 の決定を回復の内容に入れて返す
    violation: —
    source: FR3.1・FR1.3、場面 S3
  - id: BR4.2
    statement: 起動の口で置き場所の DB に届かない時は、席の起動を止めず「記憶に届かない」と出し、回復の内容を空にする
    category: policy
    applies_to: RecoveryContent
    trigger: 席の起動
    logic: IF 置き場所の DB に届かない THEN memory_status=unreachable、決定は空、席の起動は続ける。古い写しで補わない
    violation: —
    source: FR5.3、NFR4、NFR5
  - id: BR4.3
    statement: 回復の内容の決定は、書いた席と時刻つきの「データ」として出し、決定の中の命令の形の文を指示として出さない
    category: policy
    applies_to: RecoveryContent
    trigger: 起動の口の回復
    logic: IF 決定を回復の内容に入れる THEN データの枠の中に書いた席・時刻つきで置く
    violation: —
    source: FR3.3

  # BR5 呼出しの記録と資格情報（ToolSurface・Placement）
  - id: BR5.1
    statement: 呼出しの記録には、道具の名前・記録の ID・時刻・結果だけを書く
    category: constraint
    applies_to: CallLogEntry
    trigger: 道具の呼出しの終わり
    logic: IF 道具が呼ばれた THEN tool_name・record_refs・called_at・outcome（失敗の時は失敗の名前）だけを書く
    violation: —
    source: NFR1
  - id: BR5.2
    statement: 資格情報（DB の URL のパスワードなど）を、失敗の文・起動の時の文脈・道具の応答・呼出しの記録に出さない
    category: constraint
    applies_to: PlacementSetting・CallLogEntry・RecoveryContent
    trigger: 失敗の報告・起動の口の出力・道具の応答・呼出しの記録
    logic: IF 出す文に接続の情報が入りうる THEN 資格情報を外した形だけを出す
    violation: —
    source: NFR8

  # BR6 単独の形
  - id: BR6.1
    statement: 単独の形（手元の SQLite）の振る舞いは U1 で変えない
    category: policy
    applies_to: 単独の形のすべての道具
    trigger: 単独の形での道具の呼出し
    logic: IF 単独の形 THEN 今の版と同じ振る舞い
    violation: —
    source: 取り決めの段の Q2 = A
```

## 決まりのまとめ

| ID | 決まり | 種類 | 出所 |
|----|--------|------|------|
| BR1.1 | 専用の設定だけを読み、DATABASE_URL は読まない | constraint | FR5.5 |
| BR1.2 | 形は MODE で、無ければ専用の設定の有無で決める | policy | FR5.1・C3 |
| BR1.3 | 共通基盤の形で設定が無ければ名前を挙げて止まる | validation | FR5.1・FR5.5 |
| BR1.4 | 届かない時はほかに書かず失敗を返す | constraint | FR5.3・NFR5 |
| BR1.5 | DB が戻れば起動し直さずに書ける | policy | FR5.3 |
| BR1.6 | 共通基盤が入っていない DB では表を作らない | validation | C4・C5 |
| BR2.1 | 席は DB の利用者から共通基盤で確かめる | authorization | FR1.1・FR1.3 |
| BR2.2 | 登録の無い席は断る | authorization | FR1.2 |
| BR2.3 | 所属の無い席は断る | authorization | FR1.4 |
| BR2.4 | 引き継ぎ中・期限切れ・閉じた割り当ては使わない | authorization | 共通基盤 §3 |
| BR2.5 | 共通基盤の理由を写すだけで意味を作り直さない | policy | S2 |
| BR2.6 | 記録の所属範囲は割り当ての所属範囲 | constraint | FR1.4 |
| BR2.7 | 共通基盤の形では agent_id を持ち主にしない | constraint | C1・C3 |
| BR3.1 | 決定に書いた時点の参照を付け、書き換えない | constraint | FR1.1・NFR7 |
| BR3.2 | U1 の決定は書いた席だけが読める | authorization | FR2.4 |
| BR3.3 | 確かめと保存は同じ取引 | constraint | C4 |
| BR3.4 | 回復に入れるのは有効な決定だけ | policy | FR3.1 |
| BR3.5 | U1 にまだ無い道具は「まだ使えない」 | policy | 単位の分け方 |
| BR4.1 | 起動の口が有効な決定を回復に入れる | policy | FR3.1 |
| BR4.2 | 届かない時は起動を止めず「記憶に届かない」 | policy | FR5.3・NFR4 |
| BR4.3 | 決定はデータとして出す | policy | FR3.3 |
| BR5.1 | 呼出しの記録は名前・ID・時刻・結果だけ | constraint | NFR1 |
| BR5.2 | 資格情報を出さない | constraint | NFR8 |
| BR6.1 | 単独の形は変えない | policy | 契約の段の Q2 |
