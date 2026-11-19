# 取り決めのまとめ

- 入力: 作業の単位（`inception/units-generation/unit-of-work.md`）、単位の依存（`inception/units-generation/unit-of-work-dependency.md`）、部品の一覧（`inception/domain-design/components.md`）、要件（`inception/requirements-analysis/requirements.md`）、この段階の Q1〜Q3
- 決めたこと: 道具は今の名前と引数を保って足すだけ（Q1 = A）、手元の SQLite の単独の形は別の形として残す（Q2 = A）、DB の Kusabi の置き場は関数だけを席に許す（Q3 = A）

## 取り決めの一覧

| # | Provider Unit | Consumer | Mechanism | Owner |
|---|---------------|----------|-----------|-------|
| C1 | U1 u1-seat-memory-skeleton（ToolSurface。U2・U3・U5・U6 が道具を足す） | External: 席（Claude Code・Codex・Gemini） | MCP の道具（stdio） | U1 |
| C2 | U1・U3（HostAdapters） | External: 席の道具の起動の hook | 起動の口の出力（席の道具ごとの形） | U3 |
| C3 | External: 席を起動する人・配車の席 | U1（Placement）・U3（HostAdapters） | 席の起動の設定（環境変数） | U1 |
| C4 | U1（Kusabi の置き場の作り。U2〜U7 が足す） | Kusabi の実行（全単位）・U5（権限の読み取り） | DB の中の Kusabi の置き場（関数と表） | U2（MemoryRecords） |
| C5 | External: onza の共通基盤 0.2・0.3 | U1・U4・U5（SeatIdentity・AccessReport） | 共通基盤の確かめの関数（同じ transaction） | onza（Kusabi は版を固定して使う） |
| C6 | U1（Placement・SeatIdentity） | U2〜U7 | パッケージの中の関数の口 | U1 |
| C7 | U2（MemoryRecords） | U3・U7 | パッケージの中の関数の口 | U2 |
| C8 | U6（ConversationIngest） | U3・U7 | パッケージの中の関数の口 | U6 |
| C9 | U7（LegacyMigration） | U8・External: owner | 移しのコマンドと、移しの記録の読み出しの口 | U7 |
| C10 | U8（ScenarioHarness） | External: owner・CI | 試験のコマンドと結果の形 | U8 |

## C1 席に出す MCP の道具

- 今の 17 個の道具の名前と引数はそのまま保つ（今の引数は `src/index.ts`）。足すのは下の物だけ。
- 振る舞いの変わり目（版の変わり目として書いて席に知らせる）:
  - 共通基盤の形では、記憶の持ち主は環境の `AGENT_MEMORY_AGENT_ID` ではなく、DB の利用者から確かめた席になる
  - `search_memory` は DB の中の文字の検索だけになる（埋め込みを使わない）
  - 回復の内容に AUN のメッセージが入らない
  - `set_recovery_config` は、自分以外の席の `agent_id` を指すと断る

```yaml
# mcp-tools 差分（足す物と変わる物だけ）
tools:
  log_decision:
    add_inputs:
      work_ref: { type: string, required: false, note: "GitHub の issue か PR の URL、または owner/repo#番号。省けば起動の設定の既定の仕事の ID" }
  save_task_state:
    add_inputs:
      work_ref: { type: string, required: false }
  save_knowledge:
    add_inputs:
      work_ref: { type: string, required: false }
  supersede_decision:
    add_inputs:
      work_ref: { type: string, required: false }
    rule: "ほかの席が書いた決定は置き換えられない（forbidden）"
  supersede_knowledge:
    add_inputs:
      work_ref: { type: string, required: false }
    rule: "ほかの席が書いた学びは置き換えられない（forbidden）"
  set_recovery_config:
    rule: "agent_id が自分の席でなければ forbidden。引数の形は変えない"
  get_work_memory:            # 新しい道具（仕事の ID でまとめて返す）
    inputs:
      work_ref: { type: string, required: true }
    output:
      work_ref: "owner/repo#番号（正規の形）"
      decisions: "[{ id, seat, written_at, text, reason }]、無い時は空と kind_empty: true"
      task_states: "[{ id, seat, written_at, status, content }]（席ごとに別々、時刻の順）"
      knowledge: "[{ id, seat, written_at, title, content }]"
      omitted: "{ decisions, task_states, knowledge } 上限で省いた件数（0 の時は出さない）"
      framing: "記録はデータの枠で出し、命令の形の文を指示として出さない"
    errors: [seat_not_registered, no_membership, binding_closed, invalid_work_ref, placement_unreachable]
    empty_result: "記録が 1 件も無い時は no_records（失敗とは区別）"
  report_placement_access:    # 新しい道具（置き場所と読み書きできる者の一覧）
    inputs: {}
    output:
      placement: "置き場所の DB の名前と場所（資格情報は出さない）"
      observed: "true | false（権限を読めない時は false で、一覧は返さない）"
      access: "[{ db_role, can_read, can_write, registered_seat }]（実際の DB の権限から作る）"
      mismatches:
        not_registered_but_accessible: "[db_role]"
        registered_but_not_accessible: "[seat]"
    rule: "記憶の中身を返さない。画面は作らない"
    errors: [seat_not_registered, placement_unreachable]

errors:                       # 道具の失敗の形（isError の文の先頭に code を置く）
  seat_not_registered: "この席は共通基盤に登録されていない"
  no_membership: "この席は所属範囲に属していない"
  binding_closed: "この席の割り当ては閉じている"
  placement_unset: "Kusabi の置き場所の設定（AGENT_MEMORY_DATABASE_URL）が無い"
  placement_unreachable: "置き場所の DB に届かない（別の置き場所には書いていない）"
  invalid_work_ref: "仕事の ID の形でない（GitHub の issue・PR の URL か owner/repo#番号）"
  forbidden: "ほかの席の記録・設定は変えられない"
  unobservable: "観測できず（成功ではない）"
```

## C2 起動の口の出力

- 席の道具ごとの起動の hook の形は今の版のまま（`src/claude-session-start.ts`・`src/codex-session-start.ts`・`src/gemini-session-start.ts`）。回復の内容の構造は今の `recovery-pack-v1` の形を保ち、足す欄だけを加える。

```yaml
# host-session-start 出力（足す欄）
additions:
  memory_status: "ok | unreachable | skipped_deadline（届かない・期限で省いた時は、その旨を最初の文脈に書く）"
  work_ref: "起動の設定の既定の仕事の ID（あれば）"
  records_framing: "記録はデータの枠で、書いた席・時刻・仕事の ID つき"
  omitted_counts: "上限で省いた件数と、続きの取り出し方（get_work_memory など）"
rules:
  deadline: "native の起動の口では 7 秒。間に合わなければ回復を打ち切り、席の起動を止めない"
  never: "資格情報・接続の文字列を出さない"
```

## C3 席の起動の設定（環境変数）

```yaml
env:
  AGENT_MEMORY_MODE: { values: [common, standalone], note: "新しい。common = 共通基盤の形、standalone = 手元の SQLite の単独の形" }
  AGENT_MEMORY_DATABASE_URL: { note: "共通基盤の形の置き場所の DB（Kusabi 専用の設定）。common の時は必須" }
  AGENT_MEMORY_WORK_REF: { note: "新しい。その会話の既定の仕事の ID。長く動く席は設定せず、道具を呼ぶたびに渡す" }
  AGENT_MEMORY_PROJECT: { note: "今のまま。記録の目印（読める範囲は決めない）" }
  AGENT_MEMORY_AGENT_ID: { note: "standalone の時だけ持ち主に使う。common の時は持ち主にしない" }
  AGENT_MEMORY_DB_TYPE: { note: "今のまま（sqlite・json は standalone の中の選択）" }
  DATABASE_URL: { note: "読まなくなる（版の変わり目）" }
  VOYAGE_API_KEY: { note: "読まなくなる（版の変わり目）" }
  AGENT_MEMORY_DISABLE_EMBEDDINGS: { note: "効き目が無くなる（埋め込みを作らないため）" }
mode_resolution:
  - "AGENT_MEMORY_MODE=common: AGENT_MEMORY_DATABASE_URL が無ければ placement_unset で起動を止める。届かなくても SQLite に逃げない"
  - "AGENT_MEMORY_MODE=standalone: 今の版の単独の形（手元の SQLite）"
  - "AGENT_MEMORY_MODE が無い: AGENT_MEMORY_DATABASE_URL があれば common、無ければ standalone"
  - "社内の席の起動の設定（起動の口を入れるコマンドと展開）は、必ず AGENT_MEMORY_MODE=common を書く"
```

## C4 DB の中の Kusabi の置き場

- 席の DB の利用者には、Kusabi の置き場の関数の実行だけを許し、表の直接の読み書きを許さない（Q3 = A、共通基盤 contract.md §5）。関数の中で共通基盤の確かめを同じ transaction で呼び、所属範囲と読める範囲の決まりを守る。
- 置き場の作りの変更は版をつけ、どの変更にも試した戻し方を付ける（NFR6）。本番の DB に当てるのは展開の段で owner の決定の後。

```yaml
# shared-schema: kusabi（関数の口。表の列は部品の一覧の記録の持ち主の表のとおり）
schema: kusabi
grants:
  seat_runtime_role: "EXECUTE on kusabi の公開関数だけ。kusabi の表への SELECT・INSERT・UPDATE・DELETE は無し"
  migration_role: "移しの関数だけ（owner の決定の後に使う）"
  report_role: "権限の情報の読み取りだけ（記憶の中身の表は読まない）"
functions:
  save_decision:        { in: [decision, reason, tags, project, work_ref], out: decision_id, checks: [common_verify_seat, scope] }
  supersede_decision:   { in: [old_decision_id, decision, reason, tags, project, work_ref], out: decision_id, checks: [common_verify_seat, own_record_only] }
  save_task_state:      { in: [task_key, status, content, project, work_ref], out: task_state_id, checks: [common_verify_seat, scope] }
  save_knowledge:       { in: [title, content, tags, memory_scope, project, work_ref], out: knowledge_id, checks: [common_verify_seat, scope] }
  read_own_memory:      { in: [kinds, limits, project], out: "自分の席の記録", checks: [common_verify_seat] }
  read_work_memory:     { in: [work_ref, limits], out: "同じ所属範囲の席の、その仕事の ID の記録", checks: [common_verify_seat, same_scope] }
  search_text:          { in: [query, limit, project], out: "文字の検索の結果（自分の記録と、同じ所属範囲の仕事の ID つきの記録）", checks: [common_verify_seat, same_scope] }
  save_conversation_event: { in: [source, source_ref_hash, role, content_text, redaction_version, event_at, work_ref], out: event_id, checks: [common_verify_seat, dedupe_by_source_ref_hash] }
  read_recent_conversation: { in: [limit], out: "自分の席の最近の会話", checks: [common_verify_seat] }
  set_recovery_config:  { in: [limits], out: ok, checks: [common_verify_seat, own_config_only] }
rules:
  - "記録には書いた時点の scope_ref・principal_ref・seat_ref・binding_ref を付け、後から書き換えない"
  - "work_ref は owner/repo#番号 の正規の形。形でない値は invalid_work_ref"
  - "仕事の ID の無い記録は書いた席だけが読める。所属範囲をまたいで返さない"
  - "記録は物理的に消さない。置き換えと状態で引退させる"
```

## C5 共通基盤の確かめの関数（使う側）

```yaml
# 共通基盤 0.2・0.3 の使い方（onza が持ち主。Kusabi は使う側）
pin:
  source: "onza main 5beb404 の common/0.2・common/0.3（manifest の digest で固定。自動で最新に追従しない）"
uses:
  - "同じ transaction の中で、session_user から主体・所属範囲・席・割り当てを確かめる確かめの関数（contract.md §5）"
  - "read_principal など読取りの口（contract.md §3）。非所属・権限外は同じ forbidden、DB 不明は unavailable"
never:
  - "共通の表を直接書き換えない"
  - "渡された値（引数・環境変数）を本人の証拠にしない"
```

## C6〜C8 パッケージの中の関数の口

```yaml
# 単位どうしの口（TypeScript の型で決める。ほかの単位は Kusabi の表を直接読み書きしない）
ports:
  Placement:      { provider: U1, consumers: [U2, U3, U4, U5, U6, U7], offers: "置き場所の DB への接続（形 = common | standalone）。届かない時は placement_unreachable" }
  SeatIdentity:   { provider: U1, consumers: [U2, U3, U4, U5, U6, U7], offers: "確かめた席の参照（scope_ref・principal_ref・seat_ref・binding_ref・generation）。standalone の形では agent_id から作る" }
  MemoryRecords:  { provider: U2, consumers: [U3, U7], offers: "記録の保存・読み出し・仕事の ID での読み出し・文字の検索（C4 の関数を呼ぶ）" }
  ConversationIngest: { provider: U6, consumers: [U3, U7], offers: "会話の出来事の保存と、最近の会話の読み出し" }
```

## C9 移しのコマンド

```yaml
# 移しのコマンド（owner が手元で使う。共通基盤の DB への移しは owner の決定の後）
commands:
  inventory: { out: "置き場所ごと・持ち主ごと・種類ごとの件数、読めないファイルの場所と理由", writes: none }
  mapping-draft: { out: "棚卸しから作った対応表の下書き（承認は owner）", writes: "下書きのファイルだけ" }
  migrate: { in: "承認済みの対応表の版", out: "移した件数・つながっていない記録の件数・run_id", rules: ["承認が無ければ何も移さない", "2 回流しても同じ", "元を読むだけ"] }
  rollback-check: { out: "元の置き場所へ戻した席の回復の内容が切り替えの前と同じか" }
exit_codes: { 0: 成功, 1: 失敗, 2: 承認が無い, 3: 観測できず }
read_port_for_U8:
  unlinked_count: "最後の移しの run の、つながっていない記録の件数。移しをまだ流していない時は not_run"
```

## C10 試験のコマンドと結果の形

```yaml
# 試験の結果（JSON）
result:
  scenarios:
    - { id: S1, created: 3, retrieved: 3, observable: true }
    - { id: S5, created: 3, retrieved: 0, observable: false, reason: "使い捨ての Gemini の会話を起こしていない" }
  total: { created: 15, retrieved: 15, ratio: "1.0 | null（観測できない場面がある時は null）" }
  pass: "全場面が observable かつ retrieved == created の時だけ true"
  unlinked_legacy: "数 | not_run（割合に入れない）"
  external_calls: "Kusabi から外への通信の数（0 であること）"
exit_codes: { 0: pass, 1: fail, 3: 観測できず }
```

## 取り決めの持ち主と変え方

- 各取り決めの持ち主は一覧の Owner の単位。持ち主の単位の PR が取り決めを変え、使う側の単位の持ち主（同じ実装の席）が確かめる。独立の監査（devauditor）を通して統合する（team.md の Way of Working）。
- 足す変更（任意の引数・新しい道具・新しい欄）は、使う側が知らない欄を無視できる形で入れる。席の道具やきっかけの文を直さずに済む。
- 壊す変更（道具の名前・必須の引数・出力の欄を外す・意味を変える）は、公開の仕様の変更として owner の決定を取る。C1 の版の変わり目（持ち主の決まり方など）は、この取り決めで owner が決めた（Q1 = A）。
- DB の作りの変更（C4）は、版・戻し方・旧と新が同じ作りで動く期間を付け、本番に当てるのは owner の決定の後。
- 共通基盤（C5）の版を上げる時は、固定の digest を変える PR で行い、Kusabi の試験を通す。

## 未決の問い

| Contract | Question | Blocks |
|----------|----------|--------|
| C1 | 一覧の道具（report_placement_access）を呼べるのは owner の席だけか、どの席でもよいか（中身は返さない） | U5 |
| C1 | 書く道具を席が再送した時に同じ記録が 2 件になるのを防ぐ鍵（任意の request_id）を足すか。足すなら公開の仕様の追加 | U2 |
| C3 | 社内の席で起動の設定が何も無い時、単独の形（SQLite）に落ちるのを防ぐ手立て（起動の口を入れるコマンドで AGENT_MEMORY_MODE=common を必ず書くだけで足りるか） | U1 |
| C4 | 文字の検索の方式（日本語の文の分け方） | U2 |
| C5 | 固定する共通基盤の版（onza main 5beb404 か、0.3 の後の版か） | U1 |
| C2 | 席の道具ごとの起動の hook の新しい版で、出力の形が変わっていないか（本物の席での確かめで見る） | U3 |
