# U1 の記録の種類

- 入力: 部品の一覧（`inception/domain-design/components.md` の Decision・CallLogEntry）、取り決め（`inception/contract-design/contract-summary.md` の C1・C3・C4）、作業の単位（`inception/units-generation/unit-of-work.md` の U1）、要件（`inception/requirements-analysis/requirements.md`）
- 技術に依らない形で書く。型は論理の型（文字列・時刻・識別子など）。

## 記録の種類の正本

```yaml
entities:
  - name: Decision
    description: 席が決めたことの記録。U1 では共通基盤の形の決定だけを扱う
    owned_by: MemoryRecords
    attributes:
      - { name: decision_id, type: identifier, required: true, unique: true, default: "保存の時に発行" }
      - { name: decision, type: text, required: true, constraints: "空でない" }
      - { name: context, type: text, required: false, note: "決めた理由・前後の事情" }
      - { name: tags, type: list<text>, required: false, default: "空" }
      - { name: project, type: text, required: false, note: "目印。読める範囲は決めない" }
      - { name: status, type: enum, required: true, allowed: [active, superseded], default: active, note: "U1 は active だけを作る。superseded は U2" }
      - { name: scope_ref, type: identifier, required: true, references: "共通基盤の所属範囲（scope）" }
      - { name: principal_ref, type: identifier, required: true, references: "共通基盤の主体（principal）" }
      - { name: seat_ref, type: identifier, required: true, references: "共通基盤の席（seat）" }
      - { name: binding_ref, type: identifier, required: true, references: "共通基盤の割り当て（seat_binding）" }
      - { name: binding_generation, type: integer, required: true, constraints: "1 以上" }
      - { name: created_at, type: instant, required: true, note: "UTC の時刻。保存の時に付ける" }
    constraints:
      - "scope_ref・principal_ref・seat_ref・binding_ref・binding_generation は、保存の時の共通基盤の確かめの結果から付け、後から書き換えない"
      - "保存の後に decision・context・tags・project を書き換えない（直す時は置き換え = U2）"
    relationships:
      - "多くの Decision が 1 つの共通基盤の席に属する（席 1 : 決定 多）"
      - "多くの Decision が 1 つの共通基盤の所属範囲に属する（所属範囲 1 : 決定 多）"

  - name: CallLogEntry
    description: 席が道具を呼んだことの手元の記録。記憶の中身を持たない
    owned_by: ToolSurface
    attributes:
      - { name: entry_ref, type: identifier, required: true, unique: true }
      - { name: tool_name, type: text, required: true }
      - { name: record_refs, type: list<identifier>, required: false, note: "書いた・読んだ記録の ID だけ" }
      - { name: called_at, type: instant, required: true }
      - { name: outcome, type: enum, required: true, allowed: [ok, error], note: "error の時は失敗の名前（seat_not_registered など）だけ" }
    constraints:
      - "決定の文・理由・作業の名前・学びの題・資格情報・接続の文字列を持たない"

value_objects:
  - name: PlacementSetting
    description: 席の起動の設定から決まる置き場所
    attributes:
      - { name: mode, type: enum, allowed: [common, standalone] }
      - { name: database_ref, type: secret-reference, note: "Kusabi 専用の設定の値。記録・応答に出さない" }
    rules: "BR1.1・BR1.2・BR1.3"

  - name: VerifiedSeat
    description: 共通基盤の確かめが返した、今の取引の席の参照。記録に付けるために使い、保たない
    attributes:
      - { name: scope_ref, type: identifier }
      - { name: principal_ref, type: identifier }
      - { name: seat_ref, type: identifier }
      - { name: binding_ref, type: identifier }
      - { name: binding_generation, type: integer }
      - { name: binding_state, type: enum, allowed: [active], note: "active 以外は確かめが失敗を返す" }
    rules: "BR2.1〜BR2.6"

  - name: RecoveryContent
    description: 起動の口が席の最初の文脈に入れる回復の内容（U1 は有効な決定だけ）
    attributes:
      - { name: memory_status, type: enum, allowed: [ok, unreachable, not_registered, not_initialized, skipped_deadline], note: "skipped_deadline は起動の口の期限で回復を打ち切った時（取り決め C2、NFR4.1）" }
      - { name: decisions, type: "list<{decision_id, decision, context, seat_ref, created_at}>" }
      - { name: framing, type: text, note: "記録はデータとして出し、指示として出さない" }
    rules: "BR4.1〜BR4.3"
```

## まとめ

- 保つ記録は 2 種類: 決定（Decision、Kusabi の置き場の DB）と、呼出しの記録（CallLogEntry、手元のファイル）。
- 決定は、書いた時点の共通基盤の参照（所属範囲・主体・席・割り当て・世代）を持ち、後から書き換えない。共通基盤の物は Kusabi の持ち物ではなく、参照の値として持つ。
- 置き場所（PlacementSetting）・確かめた席（VerifiedSeat）・回復の内容（RecoveryContent）は保たない値。
- 作業の状態・学び・仕事の ID・置き換えは後の単位（U2・U3）で足す。
