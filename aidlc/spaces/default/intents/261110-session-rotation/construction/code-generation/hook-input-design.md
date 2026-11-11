# hook の入力の確かめ（FR10）: host が足した key に強くする

この記録は、要件 FR10.1〜FR10.7 の設計です。Claude Code 2.1.321 が hook の入力に足した key のために、Kusabi の SessionStart・取り込みの Stop／UserPromptSubmit・切り直しの Stop／UserPromptSubmit が入力ごと拒否している故障を、「知らない key は無視し、必須の key・型・大きさは今までどおり守る」形に直します。code は、この記録の設計監査（devauditor）の PASS と作者の受領の後に書きます。

「診断の記録」は、この記録で使う新しい語です。意味は「無視した key の名前と件数を残す、証拠の契約の外の file」で、権限・工程・証拠の項目ではありません（3 節）。

## 0. 出典

- 故障の事実: `[C2]`（席が 2026-11-11 に取った読み戻し。`operation/deployment-execution/issue-339-readback-c2.md`、agent-memory#339 に未投稿）。
- [A1] arc の技術の判断（Owner の決定ではない）: agent-memory#339 の comment 6791901034（投稿者 watchout、本文の SHA-256 `69ca10d6e8e418ad425e1e9a8f81b73799d49fa8496ad93288dc2882fae59c32`）。判断は 3 点: (1) 知らない key は無視し、必須の key・型・大きさの上限は残す。(2) 無視した key の名前は証拠の契約に足さず、契約ではない診断の記録に書いて health check が読む。(3) 設計の記録だけの PR を先に出して設計監査を 1 回受け、PASS の後に試験だけの commit、その後に実装。同じ PR に必須の入口の一覧・`--node-path`・`.gitignore` の `.claude/settings.json.bak*`・記録を入れる。**host の契約の版についての判断は A1 に無い。**
- [A2] arc-sec の条件（公開。iyasaka-arc#57 の comment 6791886636（本文の SHA-256 `8e85a30cc886ab34f124d7e97f196c6a819cab6e2dd3ab8f6d10c5acfc89b043`）と 6791925065（`c5f6251a66300b3b2974ff6435ba26f9984f12fa41092b5c8449109ae4967b86`））: 必須の key・型・64 KiB の上限は残す／無視した key は名前だけ（32 個・64 字）／入口 3 つを 1 か所の parser に／**定数 `CLAUDE_SESSION_START_HOST_CONTRACT_VERSION` を観測した 2.1.321 に上げる（条件 4）**／実物の key の形の正例と反転する負例の記録／診断の置き場と中身の 4 点（置き場と権限・中身と上限・health check の 3 値・書けなくても答えと証拠は変えない）。
- [A3] arc の技術の判断・追記（Owner の決定ではない）: agent-memory#339 の comment 6793417308（投稿者 watchout、本文の SHA-256 `af373c531792b58c7fcd7023d99c4e943c5f50cac54a2d5d1f9745779de43e5c`）。host の契約の版の扱い: (1) 定数は `2.1.220` のまま、意味は「契約を確かめた版」（`claude-session-start-evidence-v1` の schema が `adapter.host_contract_version` を const `2.1.220`・additionalProperties: false で持つので、上げるのは v1 の契約の変更で、.v2 は守る物）。(2) 観測した host の版は、hook の入力にも環境にも無いので、配備の health check の手順の 1 行（`claude --version`、code は足さない）で取り、配備の記録に契約を確かめた版とのずれを 1 行で必ず書く。読めない時は「観測できず」。証拠の契約にも診断の記録にも版は書かない。(3) 共有の parser により Codex の Stop・UserPromptSubmit も同時に緩み、Codex の SessionStart の parser は範囲外。
- [A4] arc-sec の技術の読み（公開。iyasaka-arc#57 の comment 6792778481、本文の SHA-256 `683847414d37520993afd8de29dced0a4335822d7fe97c6b329039038266bcd6`）: 設計の PR の head `6cae0d93` を読み、止める点 0。独立の設計監査（devauditor）の verdict の代わりではない。**A4 が読んだのは 1 回目の設計監査の前の head `6cae0d93` で、その後に 3 節の表（Stop 系の任意項目）・5 節の時間の予算・8 節の `--node-path` の限定を直したので、A4 が読んだ設計と今の設計は同じではない**（A4 の「止める点 0」を今の設計への読みとして引かない）。実装の PR で見る点が 2 つ（共有の parser が入口ごとの型・event・source・身元の確かめを落とさず知らない key の値を下流に出さない事／配備の記録に「版のずれの 1 行」を必ず入れる事。反転する負例が身元の負例を巻き込まない事も読む）。
- **作者の設計上の選択（出所を分ける）**: (1) 観測した版の取り方のうち、A3 の 2 が記録しているのは「配備の health check の手順の 1 行で取る（`claude --version`、code は足さない）・ずれを配備の記録に 1 行で必ず書く・読めない時は『観測できず』・証拠の契約にも診断の記録にも版は書かない」までである。**実施者を配備を行う席にすること、`session-rotation-status` も版を取らないこと、この 1 行が無い配備の記録を完了としないこと、は作者の選択で、A3 には書かれていない**（席間の連絡で arc の「良い」を受けたが、公開された記録は無いので権限の根拠に引かない）。(2) 定数を 2.1.220 に保つので、A2 の条件 4（2.1.321 に上げる）と違う。この差の理由は A3 の 1（v1 の schema の const）で、A4 は契約版の扱いを「満たす」と読んだ（verdict ではない）。席間の連絡で先に受けた「観測した版は診断の記録に書く」という形は、GitHub への記録が無いので出典にしない。
- GitHub への記録がまだ無い物（arc の席間の連絡。arc の技術の判断と Owner の委任 #49 6762288830 の範囲で、Owner の言葉ではない。権限の根拠として引かない）: `.gitignore` を `.claude/settings.json.bak*` の 1 行だけにして AI-DLC の出荷した block を入れないこと（8 節。A1 は `.gitignore` の `.claude/settings.json.bak*` を同じ PR に入れると記録している）。R3 は team.md の決まり（守る物を含む PR は統合の前に Owner の exact-head）による（下の「守る物」）。
- 守る物: 入力の確かめ（セキュリティに関わる規則の緩和）に当たるので、この単位の PR は R3 のまま、統合の前に Owner の exact-head を通す（前の取り込みの身元の規則 FR8.4 と同じ扱い）。DB の作り・workflow・資格情報・契約の .v2 は変えない。

## 1. 守る物と限界

- 守る物: hook の入力が「host が渡した、この席のこの会話の入力」であることの確かめのうち、(a) 必須の key があり型が正しい、(b) 大きさが 64 KiB 以下、(c) JSON の object である、(d) 身元の確かめ（cwd が workspace の中、`transcript_path` の置き場、binding）。この記録が緩めるのは「知らない key があれば入力ごと拒否する」の 1 点だけで、(a)〜(d) は変えない。
- 緩めても新しい情報の流れは増えない。知らない key の値は読まず、どこにも残さない（4 節）。残るのは key の名前だけ（5 節）。
- 限界: 全席が同じ macOS の利用者で動くので、同じ uid の悪意ある process は防げない。この確かめは host の更新への耐性と帰属の正しさの確かめで、敵対者への防御ではない。

## 2. 今の拒否が席を止めた理由（事実）と、設計との照らし

- 事実: `parseClaudeSessionStartInput`（`src/claude-session-start.ts`）は、必須 5 つ（`cwd`・`hook_event_name`・`session_id`・`source`・`transcript_path`）と任意 3 つ（`agent_type`・`model`・`permission_mode`）以外の key があると `MALFORMED_HOOK_INPUT`。`parseTranscriptStopInput`（`src/transcript-stop-capture.ts`）も、必須 4 つ（`cwd`・`hook_event_name`・`session_id`・`transcript_path`）と任意 8 つ（`agent_id`・`agent_type`・`last_assistant_message`・`model`・`permission_mode`・`prompt`・`stop_hook_active`・`turn_id`）以外で `malformed_input`。切り直しの Stop（`src/session-rotation-stop.ts`）は同じ関数を通る。
- 2.1.321 が足した key（名前だけを `claude -p` の probe で確かめた。値は残していない）: SessionStart = `session_title`（会話に名前がある時）、UserPromptSubmit = `prompt_id`・`session_title`、Stop = `background_tasks`・`effort`・`prompt_id`・`session_crons`。席の会話は起動の時から名前が付いているので、SessionStart は毎回落ちる。
- 結果: SessionStart は `MALFORMED_HOOK_INPUT`・`input_valid: false`・続きを渡せない。Stop 系は「通す + `malformed_input` の証拠」で席は止まらないが、取り込みも切り直しの判定も行われない（NFR1 のとおり fail-open なので、故障が静かに続く）。
- 設計との照らし（R3）: `docs/operations/HOST_ADAPTERS.md`・`SSOT-3`・`SSOT-5`・`SSOT-6` に「知らない key は拒否する」と定めた所は無い。拒否は code にだけある。設計と実装の食い違いは作らない。HOST_ADAPTERS.md の Claude Code の節に、入力の扱いを 1 段落足す（8 節）。

## 3. 規則

| 規則 | 内容 |
|---|---|
| H1 | 入口 3 つ（Claude の SessionStart、取り込みの Stop／UserPromptSubmit、切り直しの Stop／UserPromptSubmit）は、入力の外形の確かめを 1 か所の関数（4 節）に通す。外形を二重に持たない。 |
| H2 | 今までどおり拒否する: 64 KiB 超、JSON でない、object でない（配列・数・null）、必須の key の欠け、必須の値の型・形の違い（空文字・前後の空白・NUL、`hook_event_name` の違い、`source` の違い）。**任意の key の型の扱いは入口ごとに今のまま変えない**（SessionStart は型の違いを拒否し、Stop／UserPromptSubmit は拒否せず省略する。下の表）。**知らない key を含まない入力**の理由コードは今のまま（`MALFORMED_HOOK_INPUT`・`UNSUPPORTED_HOOK_EVENT`・`UNSUPPORTED_START_SOURCE`・`malformed_input`）。知らない key を含む入力の結果は、下の「層の分けと理由コード」のとおり、知らない key を除いた同じ入力と同じになる。 |
| H3 | 新しく許す: 必須・任意の一覧に無い key。値は読まない。入口の関数にも、入口の中の proxy にも渡さない（拒否の経路でも下流に出さない）。 |
| H4 | 無視した key の名前は、診断の記録（5 節）に書く。証拠の契約（`claude-session-start-evidence-v1` の schema、`wasurezu-transcript-stop-capture/v1`）には足さない。 |
| H5 | 診断が書けなくても、hook の答えと証拠は書けた時と同じ。席は止まらない。診断は、答えと証拠を書き切った後に、残りの予算が床（2000 ms）以上の時だけ非同期で 1 回試み、待つのは上限（200 ms）まで。足りなければ始めない（5 節）。 |
| H6 | host の契約の版の定数は動かさない（7 節）。 |
| H7 | 取り込みの Stop／UserPromptSubmit の外形の確かめ（`parseTranscriptStopInput`）は Claude と Codex が共有するので、H1〜H5 は Codex の Stop／UserPromptSubmit にも同時に当たる（Codex の入力でも、知らない key は無視され、必須の key・型・大きさは今までどおり拒否される）。Codex の SessionStart の parser は H1〜H5 の外のまま。 |

**層の分けと理由コード（F5）**: 拒否の理由は 2 つの層で決まる。**parser の層**は、入口の parser 関数が返す／投げる理由。**入口全体の層**は、hook の答えと証拠に出る理由で、parser の後ろに身元の確かめと下流の確かめが続く。知らない key を無視すると、今まで外形の確かめで先に拒否されていた「知らない key を含む入力」が、その後ろの確かめまで進む。そのため、知らない key を含む入力に「今までと同じ理由コード」を期待せず、**知らない key U を足した入力（N+U）の結果は、U を除いた同じ入力（N）の結果と同じ**と定める（差分の oracle）。結果とは、拒否か受理か、拒否の理由コード、output の decision、evidence の項目。

順番（入口ごと。変えない。`origin/main` の code を読んで確かめた）:
- Claude の SessionStart: Claude の parser（外形 → `hook_event_name` → `source` → 値の型）→ `proxyForInputError` → Codex の runner（binding の正規化 `IDENTITY_BINDING_INVALID` → Codex の parser（キーがちょうど 7 つ揃うこと、続いて `hook_event_name`・`source`・型。`MALFORMED_HOOK_INPUT`・`UNSUPPORTED_HOOK_EVENT`・`UNSUPPORTED_START_SOURCE`）→ `verifyCodexHookWorkspace`（cwd が workspace の外・解決できない = `WORKSPACE_IDENTITY_MISMATCH`）→ 取り出し）。Claude の parser が投げた理由は証拠にならず、**証拠の理由は Codex の parser が見る入力で決まる**: Claude の parser が `UNSUPPORTED_*` を投げた時は元の入力（`permission_mode` が無ければ `default` を足した物）、それ以外は `{}`。元の入力が Codex の 7 つのキー（`model` があり `agent_type` が無い）にちょうど揃う時だけ `UNSUPPORTED_*` が証拠に出て、揃わない入力（`model` が無い、`agent_type` がある）は `MALFORMED_HOOK_INPUT`（今のまま。12 節）。
- 取り込みの Stop／UserPromptSubmit と切り直しの Stop／UserPromptSubmit: `parseTranscriptStopInput`（外形・`hook_event_name`・必須の値の型のすべてが同じ `malformed_input`）→ `verifyBinding`（`identity_binding_invalid`: binding の欄が空、または workspace が解決できない。**host が `codex` の時だけ**、cwd が workspace の外でも `identity_binding_invalid`。**host が `claude_code` の時は cwd を見ない**。FR8 R1: Claude Code は `cd` の後に cwd が workspace の外にあり得る）→ 下流（`transcript_path` の置き場・身元は、取り込みでは `receiveCurrentSessionTranscript`、切り直しでは `readTranscriptTail` が自分の理由で扱う）。切り直しは `off` の時、parse の後・`verifyBinding` の前に `rotation_off` を返す。

**proxy の直し**: `proxyForInputError` は `UNSUPPORTED_*` の時に元の入力をそのまま Codex の parser へ渡す。知らない key を含む入力が `UNSUPPORTED_*` で拒否される新しい経路では、渡された知らない key が Codex の parser のキー数の確かめで `MALFORMED_HOOK_INPUT` に落ち、N の結果と変わってしまう。そこで proxy は、元の入力のうち Claude の parser の必須・任意の key（`REQUIRED_FIELDS`・`OPTIONAL_FIELDS`）だけを写して渡す。N+U を Codex の parser が見る入力は N と同じになり、証拠の理由が N と同じになる。同時に、知らない key の値は拒否の経路でも下流へ出ない（A4 の点 1）。知らない key を含まない N では写す中身が変わらない。

N+U の結果（U は値を読まれない key。「今」は直す前、「後」は直した後）:

| N の失敗 | N の結果（今も後も同じ） | N+U の parser の層 | N+U の入口全体 |
|---|---|---|---|
| 外形（必須の欠け・空文字・JSON でない・object でない・64 KiB 超） | SessionStart `MALFORMED_HOOK_INPUT`／Stop 系 `malformed_input` | 今も後も同じ | 同じ（変わらない） |
| 値の型（SessionStart の `model: null`・違う `permission_mode`・空の `agent_type`、必須の型の違い） | 同上 | 同じ | 同じ |
| `hook_event_name` の違い（SessionStart） | parser は `UNSUPPORTED_HOOK_EVENT`。全体は上の 7 キーの条件で `UNSUPPORTED_HOOK_EVENT` か `MALFORMED_HOOK_INPUT` | `MALFORMED` → `UNSUPPORTED_HOOK_EVENT`（**意図した変更**） | `MALFORMED_HOOK_INPUT` → N と同じ（proxy の直しによる） |
| `source` の違い（SessionStart） | parser は `UNSUPPORTED_START_SOURCE`。全体は同上 | `MALFORMED` → `UNSUPPORTED_START_SOURCE`（**意図した変更**） | `MALFORMED_HOOK_INPUT` → N と同じ |
| `hook_event_name` の違い・必須の型の違い（Stop 系） | `malformed_input` | 同じ | 同じ |
| binding の不正（`agent_id` が空など） | SessionStart `IDENTITY_BINDING_INVALID`（Codex の runner は parse の前に正規化する）／Stop 系 `identity_binding_invalid` | 受理に変わる（binding は parser の外の確かめ） | SessionStart: 変わらない（Codex の runner が parse の前に正規化するため、知らない key があっても同じ `IDENTITY_BINDING_INVALID`）／Stop 系: `malformed_input` → `identity_binding_invalid`（**意図した変更**） |
| cwd が workspace の外 | SessionStart `WORKSPACE_IDENTITY_MISMATCH`／Codex の Stop 系 `identity_binding_invalid`／**Claude の Stop 系は拒否されない（受理。FR8 R1）** | 受理に変わる | SessionStart: `MALFORMED_HOOK_INPUT` → `WORKSPACE_IDENTITY_MISMATCH`／Codex の Stop 系: `malformed_input` → `identity_binding_invalid`／Claude の Stop 系: `malformed_input` → 受理（N が受理だから） |
| `transcript_path` の置き場・身元（下流） | 下流の理由（取り込みの `receiveCurrentSessionTranscript`・切り直しの `readTranscriptTail`・SessionStart の取り出し） | 受理に変わる | `malformed_input` 等 → N の下流の結果 |

理由コードが変わる入力は「知らない key を含み、かつ他の拒否の理由も持つ入力」だけで、変わる先はその入力の本来の理由（N の結果）。**拒否は変わらない**（拒否だった入力は、知らない key でなく本来の理由で拒否される）。新しく受理されるのは、知らない key のほかが全部有効な入力（N が受理の入力）だけで、**新しい拒否は足さない**: Claude の Stop には cwd の確かめを足さない（FR8 R1）。11 節の 12 に deviation_ledger の 1 行を置く。

**入口・項目ごとの今の拒否／省略（`parseClaudeSessionStartInput`・`parseTranscriptStopInput` の code を読んで確かめた。この記録は「直した後」の列を今と同じに保ち、新しい拒否も新しい受理も足さない。F1）**:

| 入口 | 項目 | 条件 | 今 | 直した後 |
|---|---|---|---|---|
| Claude の SessionStart | 必須 `session_id`・`transcript_path`・`cwd` | 空でない・前後の空白なし・NUL なし | 違うと `MALFORMED_HOOK_INPUT` | 同じ |
| 〃 | 必須 `hook_event_name` | `SessionStart` | 違うと `UNSUPPORTED_HOOK_EVENT`（外形の確かめの後） | 同じ。ただし知らない key と重なる入力は、parser の層で `UNSUPPORTED_HOOK_EVENT`（層の分けと理由コード） |
| 〃 | 必須 `source` | 許可リスト（`START_SOURCES`） | 違うと `UNSUPPORTED_START_SOURCE` | 同じ（同上。層の分けと理由コード） |
| 〃 | 任意 `model` | あれば string（`null` は違反） | 違うと `MALFORMED_HOOK_INPUT` | 同じ（拒否） |
| 〃 | 任意 `permission_mode` | あれば列挙の string | 違うと `MALFORMED_HOOK_INPUT` | 同じ（拒否） |
| 〃 | 任意 `agent_type` | あれば空でない string | 違うと `MALFORMED_HOOK_INPUT` | 同じ（拒否） |
| 取り込みの Stop／UserPromptSubmit と切り直しの Stop／UserPromptSubmit（共有の `parseTranscriptStopInput`。Claude も Codex も） | 必須 `cwd`・`session_id`・`transcript_path` | 空でない・前後の空白なし・NUL なし | 違うと `malformed_input` | 同じ |
| 〃 | 必須 `hook_event_name` | `Stop` か `UserPromptSubmit` | 違うと `malformed_input` | 同じ |
| 〃 | 任意 8（`agent_id`・`agent_type`・`last_assistant_message`・`model`・`permission_mode`・`prompt`・`stop_hook_active`・`turn_id`） | 型の確かめは**無い** | 型が違っても拒否しない。`stop_hook_active` が boolean の時と `last_assistant_message` が string の時だけ返し、ほかの 6 つは値を返さない（型が違えば省略） | 同じ（省略。挙動を変えない） |

Stop 系の任意 8 項目に SessionStart と同じ型の拒否を足すと、「知らない key だけを変える」（1 節）の範囲を超え、host が任意項目の形を変えた時に席が止まる故障が Stop 系にも広がる。そのため採らない（11 節の 13）。

## 4. 共通の parser（H1）

新しい module `src/hook-input.ts`（約 60 行）。

```text
parseHookInputShape(raw: string, shape: { required: readonly string[]; optional: readonly string[]; max_bytes: number })
  -> { ok: true; fields: ReadonlyMap<string, unknown>; ignored_names: readonly string[] }
   | { ok: false; reason: "too_large" | "not_json" | "not_object" | "missing_required" }
```

- 純粋な関数。時刻・環境・file を読まない（標準 S4）。
- `fields` は required と optional に載っている key のうち、入力が自分の property として持つ物だけ。知らない key の値は `fields` に入れない（読まない・残さない）。`__proto__` のような key は own property として列挙されるが、`fields` は Map なので prototype を汚さない。
- `ignored_names` は、`Object.keys(input)` のうち required／optional に無い名前を、辞書順に並べた物。
- `max_bytes` は今の定数（`CODEX_SESSION_START_INPUT_MAX_BYTES` = 64 KiB、Claude の SessionStart はその別名 `CLAUDE_SESSION_START_INPUT_MAX_BYTES`）をそのまま渡す。値は 1 か所のまま（S3）。標準入力を読む側の上限（`readStdin` の読み出しの打ち切り）も今のまま。
- 入口は `ok: false` を今の理由コードに写す（`too_large`・`not_json`・`not_object`・`missing_required` は、今と同じ `MALFORMED_HOOK_INPUT`／`malformed_input`）。

各入口は、次の呼び出しだけを差し替える。型の確かめ（`nonEmptyString` など）、`hook_event_name`・`source` の確かめ、返す値の形は今のまま。

| 入口 | file | 差し替える所 |
|---|---|---|
| Claude の SessionStart | `src/claude-session-start.ts` の `parseClaudeSessionStartInput`、入口の呼び出し（426 行） | 大きさ・JSON・object・必須・許可リストの 4 つの確かめを `parseHookInputShape` に置き換える。姉妹の関数 `parseClaudeSessionStartInputWithIgnored(raw)`（`{ input, ignored_names }` を返す）を足し、`parseClaudeSessionStartInput(raw)` はその `input` だけを返す形にする（今の署名と既存の試験は変わらない）。入口は姉妹の関数を呼ぶ。`ignored_names` を診断を呼ぶ層（`main` の中身）へ渡す経路は切り直しの Stop と同じ形にする: `ClaudeSessionStartDependencies` に任意の `on_ignored_names?: (names: readonly string[]) => void` を足し、`runClaudeSessionStart` が Claude の parser の受理の直後に 1 回だけ呼ぶ（拒否の経路と `proxyForInputError` を通る経路では呼ばれない）。`ClaudeSessionStartRunResult` の型は変えない（これを渡さない既存の呼び出し元と試験の結果は変わらない）。`proxyForInputError`（Claude の parser が拒否した時に Codex の parser へ渡す入力を作る関数）は、元の入力のうち Claude の parser の必須・任意の key（この file の `REQUIRED_FIELDS`・`OPTIONAL_FIELDS`。1 か所の定数）だけを写して渡す（3 節の F5。知らない key を Codex の parser と下流へ出さない。知らない key を含まない入力では写す中身が変わらない）。 |
| 取り込みの Stop／UserPromptSubmit | `src/transcript-stop-capture.ts` の `parseTranscriptStopInput`、入口の呼び出し（188 行） | 同上。姉妹の関数 `parseTranscriptStopInputWithIgnored(raw)` を足し、`parseTranscriptStopInput(raw)` は `input` だけを返す。入口は姉妹の関数を呼ぶ。名前を `main` の中身へ渡す経路も同じ形: `TranscriptStopDependencies` に任意の `on_ignored_names` を足し、`runTranscriptStopCapture` が parse の受理の直後に 1 回だけ呼ぶ（拒否では呼ばれない）。`TranscriptStopRunResult` の型は変えず、渡さない既存の呼び出し元と試験の結果は変わらない。 |
| 切り直しの Stop／UserPromptSubmit | `src/session-rotation-stop.ts` の呼び出し（406 行） | `parseTranscriptStopInput` の呼び出し（`runWithin` の中）を `parseTranscriptStopInputWithIgnored` に差し替える。`ignored_names` を `runWithin` の外の `runRotationCli`（答えと証拠を書く層）へ渡す方法は、**`RotationStopResult` の型を変えず**、`RotationStopDependencies`（既に任意の依存 `now`・`env` を持つ）に任意の `on_ignored_names?: (names: readonly string[]) => void` を足し、`runWithin` が parse の受理の直後に 1 回だけ呼ぶ（拒否の経路では呼ばれない）。`runRotationCli` がその callback で名前を手元の変数に受け、`result` が確定した後に、`RotationCliIo` の任意の `request_diagnostic`（5 節）へ依頼を 1 回渡す。**渡すのは依頼だけで、診断の I/O はここでは始めない**。診断は、答えと証拠の書き込みの callback が返った後に、`main` が `finishAfterAnswer` で始める（5 節）。callback は任意なので、これを渡さない既存の呼び出し元と試験の結果は変わらない。外形の確かめの直しは共有の関数で直るが、この配線はこの file に要る。この file は今 647 行で、足すのは数行だけ（800 行に近づけない）。 |

`parseTranscriptStopInput` は Codex の Stop も通す共有の関数なので、Codex の Stop／UserPromptSubmit も同時に「知らない key を無視」になる。host ごとに外形の確かめを二重に持つ（S3 違反）より、1 か所で揃える。Codex の SessionStart の parser（`parseCodexSessionStartInput`、`src/codex-session-start.ts`）は範囲の外: 同じ形の脆さがあるが、直すかは別に決める。

返す値（`TranscriptStopInput`・`ClaudeSessionStartInput`）には `ignored_names` を足さない。入口は姉妹の関数から `ignored_names` を別に受け取り、診断の記録へ渡す（今の 2 つの parser は拒否を例外で返すので、戻り値の型を変えず、姉妹の関数を足すのが、既存の呼び出し元と試験を変えない最小の形）。診断を書くのは**受理された入力についてだけ**で、拒否された入力（例外）では `ignored_names` が得られず、診断を書かない（拒否の理由は今までどおり証拠に出る）。

## 5. 診断の記録（H4・H5）

新しい module `src/hook-input-diagnostics.ts`（約 220 行。核・非同期の読み書き・`finishAfterAnswer`）。arc-sec の条件 (a)〜(d) をそのまま形にする。

- 置き場: `<AGENT_MEMORY_HOME か ~/.agent-memory>/hook-input/<agent_id>/<project>/<adapter_id>.json`。`<home>` の決め方は今の `rotationRoot` の中にあるので、`agentMemoryHome(env)` として取り出し、`rotationRoot` と新しい `hookInputRoot` の両方が使う（S3: 置き場の決め方を 1 か所に）。`<agent_id>`・`<project>` は `ROTATION_SEAT_SEGMENT` で確かめる（通らなければ書かない）。`<adapter_id>` は、各入口が持つ定数の閉じた集合（Claude の SessionStart・Claude と Codex の取り込みの Stop・Claude と Codex の切り直しの Stop）だけで、入力からは作らない。
- 権限: folder 0700、file 0600。書く前に folder を `lstat` し、symlink・持ち主が今の uid でない・group／other の権限がある場合は書かない。file は一時 file に書いて rename する（`node:fs/promises` による自前の小さな書き。`writeJsonAtomic` は同期 I/O と fsync を含み、時間の上限を置けないので使わない。時間の上限は下の「時間の予算」）。
- 中身（`kusabi-hook-input-diagnostics/v1`。契約ではない、診断の記録の形）:

```text
{ schema_version, adapter_id,
  entries: [ { event, name, count, first_seen, last_seen } ],   // 32 件まで
  dropped_names: <捨てた名前の延べ数>, invalid_names: <名前を書けなかった延べ数> }
```

- 診断を書く入口は 3 つ（Claude の SessionStart、取り込みの Stop／UserPromptSubmit、切り直しの Stop／UserPromptSubmit。取り込みと切り直しは Claude と Codex の両方）。どれも 4 節の姉妹の関数から `ignored_names` を受け、答えと証拠を書き終えた後に診断を呼ぶ（下の「時間の予算」）。受理された入力についてだけ書き、拒否された入力では書かない。
- 書く物は event 名・key の名前・件数・時刻だけ。値・本文・path・session id・cwd は書かない。`event` は `SessionStart`／`Stop`／`UserPromptSubmit` のいずれか。時刻は呼び出し側が渡す（S4）。核の関数は `now` を引数に取り、hook の入口の層だけが現在時刻を読む。
- 名前の条件: `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`（64 字以内）。条件に合わない名前は書かず `invalid_names` に数えるだけ（切り詰めて別の名前に見せない）。1 回の入力の `ignored_names` が 32 を超える時は、辞書順の先頭 32 だけを扱い、残りは `dropped_names` に数える。
- 上限: entries は 32 件。満杯の時に新しい名前が来たら、`last_seen` が最も古い物（同じ時刻は count の少ない物、次に名前の辞書順）を捨てて `dropped_names` を 1 増やす。決まった順序なので、同じ入力の列は同じ file になる。file の大きさは（整形した JSON で）10 KiB に収まる。読む側は 64 KiB を超える file を「観測できず」にする（6 節）。
- 同じ入力の列で 1 つの名前が来るたびに count を 1 増やす。1 つの入力で 1 つの名前は 1 回だけ数える。
- 競合: Stop の 2 つの入口は別の file（adapter id ごと）に書くので、同じ入力を二重に数えない。同じ file への同時の書き込みは、後の rename が勝ち、件数が少なく数えられることがある。件数は下限として読む（診断は証拠ではない）。
- 書けない時（H5）: 置き場が作れない・権限の条件を満たさない・書き込みの誤り・seat の名前が条件に合わない、のどれでも、例外は入口の中で受けて捨て、hook の答えと証拠は変えない。一時 file が残った時は取り除きを試みるだけで、失敗しても何もしない。

**時間の予算（F2。診断が hook の終了を遅らせない条件）**: 診断の I/O は、かかる時間が読めない（遅い disk・応答しない disk）。そこで、**答えを先に書き切り、診断は非同期で 1 回だけ試み、待つ時間に固定の上限を置いて、上限で process を終える**。I/O の量や回数で時間を抑える形は採らない（量は時間の上限にならない）。
- 順序（3 つの入口とも）: (1) 主処理が終わり、答えと証拠が確定する。(2) 今ある順に書く（SessionStart は runtime event の記録 → 証拠（stderr）→ 答え（stdout）、取り込みの Stop と切り直しの Stop は証拠 → 答え）。**書き込みの callback が返る（出力が OS へ渡る）まで待つ**。(3) その後に、診断を非同期で 1 回だけ始める（4 節の姉妹の関数から `ignored_names` を受けた、受理された入力の時だけ）。(4) `finishAfterAnswer` が process を終える（下）。診断の結果は答えにも証拠にも入らない。
- 非同期の I/O: 診断の module は `node:fs/promises` だけを使い、`mkdirSync`・`writeFileSync`・`fsyncSync` など同期の呼び出しを持たない。診断の I/O の間も event loop が回るので、上限の timer が必ず鳴る。読みは `lstat`（symlink・持ち主・権限の確かめ）と 64 KiB までの 1 回の読み、書きは一時 file（0600。名前は `<adapter_id>.json.<pid>.<時刻 ms>.tmp`、pid と時刻は入口が渡す）への書き込みと `rename` の 1 回。folder は 0700。再試行も、複数 file も無い。**fsync はしない**: 診断は証拠でなく、途中で切れても、古い file が無傷（rename の前）か新しい file（rename の後）かのどちらかで、壊れた file は残らない。電源断で新しい file が失われても、「記録なし」は見なかった証明ではない（12 節）。
- 待ちの上限: `finishAfterAnswer({ remaining_ms, run_diagnostic, exit })`（診断の module の 1 つの関数）。`remaining_ms` は、答えを書き終えた時点で入口が数える（予算 − 起動からの経過。予算はその入口の `timeout_ms`、上限は内部の期限 7 秒 = `rotationDeadlineMs` と同じ式。切り直しの Stop は既存の `Deadline` に残りの ms を返す関数 `remaining_ms()` を 1 つ足して使う。経過は `startDeadline` が読む単調な時計（任意の引数で注入できる。既定は `performance.now`）から数え、`cancel()` の後でも値を返す。期限の判定は今のまま）。
  - `remaining_ms < HOOK_DIAGNOSTIC_MIN_REMAINING_MS`（2000 ms。床）なら、診断を**始めず**に `exit` を呼ぶ（主処理が予算を使い切った経路を含む。一部だけ書く形は無い。省いたことは記録しない）。
  - 2000 ms 以上なら `run_diagnostic()` を始め、`min(remaining_ms, HOOK_DIAGNOSTIC_MAX_WAIT_MS)`（上限 200 ms。診断の module の 1 か所の定数）を待つ。**診断が先に終わればその時、timer が先に鳴ればその時に `exit` を呼ぶ**（早い方。`exit` は 1 回だけ）。診断の結果（成功・失敗・例外・後からの reject）は見ず、捨てる。
  - 床を満たして始めた時の実際の待ちは常に上限（200 ms）になる（`MIN_REMAINING > MAX_WAIT`。試験で不変条件として確かめる）。`min` にしてあるのは、定数の関係が変わっても残りの予算を超えて待たないため。
  - 内部の期限（7 秒）と host の限度（9 秒）は読み替えず、診断の予算として別の数を作らない。
- 構造から出る上限（見積もりではない部分）: 診断を足したことによる終了の遅れは、**答えを書き終えてから最大 200 ms**。`exit` が呼ばれる限り（カーネルが戻さない I/O で `exit` の後も終了しきらない場合は 12 節）、診断の I/O が何秒かかっても、この上限を超えない。主処理が内部の期限（7 秒）に近くまで使って答えを書いた場合は、残りが 2000 ms 未満なので診断を始めない。予算 7000 ms の席で残りがちょうど 2000 ms（答えを書いた時点で 5 秒経過）なら、終了は 5.2 秒前後で、内部の 7 秒と host の 9 秒の内側に入る。2 回目の設計監査の反例（主処理 5000 ms + 診断の I/O 4500 ms = 9500 ms）は、診断の 4500 ms を待たないので成り立たない。200 ms と 2000 ms は定数の選びで、実測ではない。
- 切れた診断（`exit` が先で I/O が途中）: 古い file は無傷のまま（rename は原子的）か、新しい file になっている。一時 file が残ることがある（値なし・0600・adapter 単位。status は無視する）。切れたことは記録しない。
- 3 つの入口の差（`origin/main` の code を読んで確かめた）: Claude の SessionStart の `writeCliResult` は、stderr と stdout の書き込みの callback が両方返ってから `process.exit(0)` する（この `exit` を `finishAfterAnswer` の呼び出しに替える。runtime event の記録は今もその前）。`ignored_names` は 4 節の `on_ignored_names` で受ける。切り直しの Stop の `main` は `.finally` で `stdout.write("", …)` → `stderr.write("", …)` の後に `process.exit(0)` する（同じく替える。診断の依頼は `runRotationCli` が `RotationCliIo` の任意の `request_diagnostic({ names, remaining_ms })` に 1 回渡す。`remaining_ms` は `Deadline.remaining_ms` を呼ぶ関数で、`main` が flush の後に呼んで値を取る。拒否された入力と主処理が失敗した経路では依頼が無く、すぐ `exit` する）。**取り込みの Stop の `writeResult` は、書き込みの callback も明示の終了も持たない**（今は process が自然に終わる）。callback つきの書き込みと、`finishAfterAnswer` による明示の終了を足す。`main` の中身は `runRotationCli(io)` と同じ形の小さな関数に出し、`io`（引数・環境・読み・証拠と答えの書き込み・診断の書き手・`exit`・時計）を試験から注入できるようにする。SessionStart の `main` も同じ形に出す。**変えない物**: 追加する export は新しい関数 1 つずつで、既存の export の署名・`package.json` の bin・rollout の入口の一覧（`ENTRYPOINTS`・`REQUIRED_ENTRYPOINTS`）・dist の file 名・`invokedPath` で入口を起動する判定は変えない。SessionStart の `main().catch(...)` の経路（degraded の出力を書いて `process.exit`）は、新しい関数の外の今の位置に残し、新しい関数は例外を投げる経路を変えずにそのまま `catch` へ渡す（診断の名前が無いので診断は始めない）。試験で注入する `io` にこの `catch` の経路は含めない（他の 2 入口と同じ形にする挙動の変更。12 節。store は `runTranscriptStopCapture` の中で閉じてから戻るので、終了は store を閉じた後）。

## 6. health check の読み（arc-sec の条件 (c)）

- 読み手は、既に seat の rotation の file を読み取りだけで見せる `src/session-rotation-status.ts`（`kusabi-rotation-status/v1`）に、`hook_input` の節を足して使う（新しい command を増やさない = 必須の入口の一覧を余分に増やさない）。出力は additive で、既存の欄は変えない。
- 読み方は 3 値（S5）: 「記録あり」（名前・event・件数・最後に見た時刻だけを出す）、「記録なし」（file が無い）、「観測できず」（file はあるが信頼できない: JSON が壊れている・schema が違う・型が違う・64 KiB 超・symlink・持ち主が違う・権限が広い）。「観測できず」を 0 件と読まない。今の `session-rotation-status` の `FileState`（`none`／`unreadable`／`valid`）と同じ区別を使う。なお、既存の `readJsonFile` は「無い」と「壊れている」の両方を `null` で返して区別できないので使わず、診断の module が `ENOENT` とそれ以外を分けて読む。
- 「記録なし」は「知らない key を見なかった」の証明ではない。書けなかった場合も同じ状態になる（H5 の代償）。そのため health check は、同じ session の SessionStart の証拠の `input_valid: true` など、別の信号と合わせて読む。この限界は 12 節に書く。
- 出力は名前と件数だけ。value・path・session id は出さない。
- この節の code（`session-rotation-status`）は file を読むだけで、process を起動しない。観測した host の版は取らない（取るのは 7 節の手順）。

## 7. host の契約の版（H6）

- 定数 `CLAUDE_SESSION_START_HOST_CONTRACT_VERSION` は `"2.1.220"` のまま。schema の `const "2.1.220"`（`docs/design/schemas/claude-session-start-evidence-v1.schema.json`）と、`src/test-claude-session-start.ts`・`src/test.ts` の確かめを動かさない。意味は「契約を確かめた版」で、host の今の版ではない。定数の宣言の所に 1 行の注釈でこの意味を書く。
- 出所と差（F4）: 版の扱いを公開で記録しているのは A3（agent-memory#339 の comment 6793417308）だけで、A1 には版の判断が無い。A2 の条件 4（arc-sec）は定数を観測した 2.1.321 に上げる。**この設計は定数を 2.1.220 のまま保つので、A2 の条件 4 と違う**。理由は A3 の 1（v1 の schema の const。上げるのは v1 の契約の変更で .v2 は守る物）。A4（arc-sec の技術の読み）は契約版の扱いを「満たす」と読んだが、devauditor の verdict の代わりではない。
- 観測した host の版: 確かめた事実: hook の入力に版の key は無く（上の probe の key の名前に無い）、hook の process の環境にも版を持つ変数は無い（この席の環境の変数の名前で確かめた。`CLAUDE_CODE_ENTRYPOINT`・`CLAUDE_CODE_EXECPATH` などはあるが版ではない）。hook から `claude --version` を起動するのは、期限と副作用の面で採らない。
- そこで、観測した版は **Deployment Execution の health check の手順**（code ではない）が取る。A3 の 2 がこの取り方（手順の 1 行、`claude --version`、code は足さない、ずれを配備の記録に 1 行で必ず書く、読めない時は「観測できず」）を記録している。A3 の 2 は、証拠の契約にも診断の記録にも版は書かないとも記録している。**実施者を配備を行う席にすることと、`session-rotation-status` も版を取らないことは、作者の設計上の選択**で、A3 には書かれていない（公開された記録が無い。0 節）。配備を行う席が手順の 1 行として `claude --version` を 1 回流し、配備の記録（`operation/deployment-execution/health-check-report.md` の指標の表。計画 Step 16.11）に「契約を確かめた版 2.1.220 と今の版のずれ」として書く。`claude --version` が実行できない・期限内に終わらない・版として読めない時は、版を推測せず「観測できず」と書く（ずれが無いとは読まない）。`host_version` の欄を診断の記録に持たないのは、取れない値を `null` で持つと「版が合っている」と読み違えやすいため。`session-rotation-status` が版を取らないのは、status に process を起動する code を足すと期限・失敗・網羅率の試験が増え、status が読み取りだけでなくなるため。
- この取り方は、この PR の試験の対象ではない（code が無い）。確かめる場所は、配備の記録に「版のずれ」または「観測できず」が書かれていること。この 1 行は必ず書く（A3 の 2。A4 が実装の PR で見る点 2 に挙げた）。この記録では、この 1 行が無い配備の記録を完了としない手順にする（作者の手順の決めで、A3 には書かれていない）。11 節の 5。

## 8. 同じ PR に入れる、ほかの物（arc の指示）

- 必須の入口の一覧（FR10.6）: 版を作る道具 `scripts/build-kusabi-content-addressed-runtime-release.mjs` の `ENTRYPOINTS` と、rollout の `src/kusabi-direct-fleet-rollout.ts` の `REQUIRED_ENTRYPOINTS` に `dist/session-rotation-stop.js` と `dist/rotation-watcher.js` を足す（版 `1b731f00…` を作った時に、道具の一覧に無いため別に実在を確かめた）。一覧の値が 2 か所にあるのは今の形で（S3 の指摘になりうる）、1 か所にまとめるのはこの PR の範囲の外とし、両方に同じ 2 行を足して、試験（`scripts/test-kusabi-content-addressed-runtime-release.mjs`・`src/test-kusabi-direct-fleet-rollout.ts`）で 2 つの一覧が一致することを確かめる。`src/kusabi-direct-fleet-rollout.ts` は 800 行を超える file なので、足すのは 2 行だけ（触る時に直す、まとめて直さない）。
- installer の `--node-path`（FR10.7）: `src/claude-hook-installer.ts`・`src/codex-hook-installer.ts` に、hook の command の先頭の node を指定する任意の引数を足す。既定は今の `process.execPath`（引数が無ければ動きは変わらない）。installer が出す command は 1 つの installer につき 3 つ（SessionStart、取り込みの Stop、切り直しの Stop／UserPromptSubmit。切り直しの command は共有の `src/rotation-hook-registration.ts` が組む）で、**3 つとも同じ node を使う**（1 つの席の hook に別々の node を混ぜない）。確かめは 1 つの関数（`src/hook-node-path.ts`、約 30 行）に置く: **絶対 path で `resolve(value) === value`、basename がちょうど `node`**、NUL を含まない、`statSync` が通常 file、`accessSync(X_OK)` が通る（symlink は許す。`/opt/homebrew/bin/node` のような版に依らない path が symlink だから。symlink 自体の名前も `node`）。`nodejs`・`node22` など別の名前は受け入れない（F3: 受け入れる名前の集合を明示して小さく保つ。要件 FR10.7 に書く）。通らなければ設定を書かずに止まる。
- 管理中の hook を見分ける条件（F3）: 今、**Claude の SessionStart の installer だけ**が、`parseClaudeHookCommand` の `words[0] === process.execPath` を条件にしている（別の node で入れた hook を管理外と見て重ねて足してしまう）。Claude の Stop・切り直し、Codex の 3 つの command の見分けは、すでに adapter id の文字列（`includes`、`isRotationHandler`）で行い、node の path に依らない。直し方: `parseClaudeHookCommand` に省略可能な引数（`interpreter: "current" | "any"`、既定 `"current"` = 今の動き）を足し、installer の `isManagedHandler` だけが `"any"` を渡す。`"any"` の時、`words[0]` は絶対 path であればよく（basename は見ない。古い installer が書いた node の path が何であれ置き換えられる）、残りの canonical の確かめ（flag の並びと数、adapter id、`words[1]` が `<版の root>/dist/claude-session-start.js` の形、値の型と上限）は今のまま。**`parseClaudeHookCommand` のもう 1 つの使い手 `src/kusabi-fleet-rollout.ts` が使う既定（`"current"`）は変えない**（その結果は変わらない。確かめの試験で今の結果のままを確かめる）。`parseCodexHookCommand`（`kusabi-fleet-rollout.ts` と `company-dev-os-recovery-target-audit.ts` が使う）は触らない。これで、`--node-path` の別名の symlink で入れ直しても、同じ指定で再実行しても、管理中の SessionStart の hook は 1 つになる。
- rollout・監査との関係（M2。code を読んで確かめた）: `src/kusabi-fleet-rollout.ts` は installer の関数（`installClaudeSessionStartHook`・`installCodexSessionStartHook`）を自分の `options` で呼ぶだけで、`--node-path` を渡さない。したがって rollout が据えた hook の先頭の node は rollout の process の `process.execPath` で、rollout の読み戻し（`parseClaudeHookCommand`・`parseCodexHookCommand` を既定の `"current"` で使う。`managed.length === expectedCount` を要求）と、`src/company-dev-os-recovery-target-audit.ts` の読み（`parseCodexHookCommand`）は、今までどおり一致する。一方、`--node-path` で別の node を指定して入れた hook は、この 2 つの読み手の `process.execPath` と違えば「管理中」と数えられない（rollout の読み戻しは失敗し、監査は `invalid` を返す）。これは**読み手が安全側（見つからない = 失敗）に倒れる**形で、黙って通ることは無い。この記録は読み手を広げない（rollout・監査の結果が変わるのは配備の読み戻しの意味を変えるので、守る物の側）。`--node-path` は、rollout を通さずに人が据える席の installer の指定として使い、rollout・監査が数える席には使わない（使うなら読み手を同じ node で動かす）。この限界を 12 節に書く。
- 入れ直しで node の path が変わっても、古い管理中の hook を置き換える。これは席の hook の差し替えではなく、installer の code の変更に限る。席への据え付けは守る物で、Owner の決定の後に行う。
- `.gitignore` に `.claude/settings.json.bak*` を 1 行足す（C2 で、backup が git に無視されておらず `git add -A` で載ることを確かめた）。AI-DLC の出荷した block 全体は入れない（A1 が `.gitignore` の `.claude/settings.json.bak*` の追加を記録している。1 行だけにする点は GitHub への記録がまだ無い。13 節）。
- `docs/operations/HOST_ADAPTERS.md` の Claude Code の節に、入力の扱いを 1 段落足す（必須の key・型・大きさは守る、知らない key は無視して名前だけを診断の記録に残す、契約の版の意味）。base にある行は消さない。
- `package.json` の `test:claude-hook` の後ろに新しい試験 2 file を足す（workflow は変えない）。

## 9. 試験（設計監査の PASS の後に先に書き、直す前の code で落ちることを確かめる）

- 正例（実物の key の形。名前は probe で確かめた物、値はダミー）: SessionStart に `session_title`、UserPromptSubmit に `prompt_id`・`session_title`、Stop に `background_tasks`・`effort`・`prompt_id`・`session_crons`。受理され、入口が返す値に知らない key が入らず、診断に名前と件数が出て、値が出ない。
- Codex 側（H7）: 取り込みの Stop と UserPromptSubmit の入力（Codex の必須・任意の key の形）に知らない key を足した正例が受理され、返す値に知らない key が入らず、診断に Codex の adapter id で名前が出る。Codex の同じ入力で、必須の欠け・型の違い・64 KiB 超・JSON でない・object でないが今までどおり拒否される負例。Codex の SessionStart に知らない key を足した入力が今までどおり拒否される（範囲の外で変えていないことの確かめ）。
- 負例（今までどおり拒否）: 必須の欠け（各入口の必須の key を 1 つずつ外す）、必須の値の型・形の違い（空文字・NUL・前後の空白）、64 KiB 超（標準入力側も）、JSON でない、配列・数・null、`hook_event_name`・`source` の違い。**SessionStart だけ**: 任意の `model: null`・`permission_mode` の違う値・`agent_type` の空文字は `MALFORMED_HOOK_INPUT`（3 節の表）。理由コードは今のまま（これは**知らない key を含まない入力**の確かめ。知らない key を含む入力は、下の差分の確かめで見る）。
- 入口ごとの現行の挙動の固定（F1。3 節の表。直す前の code でも通る確かめで、挙動を変えていないことの回帰の防ぎ）: **Stop／UserPromptSubmit の任意 8 項目の型違いは拒否されず省略される**。`model: null`・`permission_mode: "invalid-mode"`・`stop_hook_active: "yes"`・`last_assistant_message: 42`・`agent_id: null`・`agent_type: false`・`prompt: []`・`turn_id: {}` を 1 つずつ足した正常な入力が、取り込みの Stop／UserPromptSubmit（Claude と Codex）と切り直しの Stop で受理され、返す値にその項目が入らない（`stop_hook_active` が boolean の時と `last_assistant_message` が string の時だけ返る）。同じ型違いの SessionStart の任意 3 項目は拒否される（上の SessionStart だけの負例）。
- 診断: 名前の条件（長い・記号・`__proto__`・空）で書かず `invalid_names` に数える／33 個目で最も古い物が捨てられ `dropped_names` が増える／1 回の入力に 40 個の名前／同じ入力の列で file の中身が同じ（決まった順序）／0700・0600／一時 file が残らない／symlink の folder・持ち主が違う・権限が広い場合に書かない。
- H5: 置き場が書けない（読み取り専用の folder）・seat の名前が条件に合わない・file が壊れている、のそれぞれで、hook の答えと証拠が書けた時と同じ。
- 診断の配線（M1。4 節の姉妹の関数）: 入口 3 つ（SessionStart、取り込みの Stop／UserPromptSubmit、切り直しの Stop／UserPromptSubmit。取り込みと切り直しは Claude と Codex の adapter id）のそれぞれで、知らない key を足した受理される入力から、その入口の adapter id の診断の file に名前と件数が書かれる（切り直しの Stop も同じ）。拒否される入力（知らない key と必須の欠けが重なるなど）では診断が書かれない。3 つの入口とも `on_ignored_names` は、渡した時だけ parse の受理の直後に 1 回呼ばれ（拒否では呼ばれない。SessionStart は `proxyForInputError` を通る経路でも呼ばれない）、渡さない呼び出し元（既存の試験）の戻り値（`RotationStopResult`・`TranscriptStopRunResult`・`ClaudeSessionStartRunResult`）は変わらない。姉妹の関数が返す `input` と、元の関数（`parseClaudeSessionStartInput`・`parseTranscriptStopInput`）の戻り値が同じ。
- 時間の予算（F2。5 節。**実時間で測る**。共有の `finishAfterAnswer` の単体と、入口 3 つ（SessionStart・取り込みの Stop・切り直しの Stop）のそれぞれで）: `exit`・診断の書き手・標準出力と標準エラーの書き込みを注入し、経過は実際の時計（`performance.now()`）で測る。`remaining_ms` は `finishAfterAnswer` の入力として渡す（主処理の 5 秒を実際には待たない）。**床の境界（2000／1999 ms）は `finishAfterAnswer` の単体だけで固定する**。入口ごとの試験は、時計を注入して予算を使い切った経路（書き手が呼ばれず `exit` が呼ばれる）と、予算に余裕がある経路（書き手が呼ばれ、約 200 ms で `exit`）の 2 点に絞る。切り直しの Stop の `Deadline.remaining_ms` は、`cancel()` の後でも注入した時計に従う値を返すことを単体で確かめる。診断側の遅れは実際の timer（`unref`）で作り、試験は書き手の遅れを待たずに終わる。(1) **遅い書き手**: `remaining_ms = 2000`、書き手が 3000 ms 後に終わる → `exit` が、答えの書き込みの callback から 180 ms 以上 1000 ms 未満で呼ばれる（下限は、待たずに終わったのではないことを示し、上限は 3000 ms より十分小さいことで書き手を待っていないことを示す。CI の揺れの余裕を含む）。(2) **host の残りを超える遅れ**: 書き手が 4500 ms 後に終わる（2 回目の監査の反例: 主処理 5000 ms + I/O 4500 ms）→ 同じ範囲で `exit`。(3) **戻らない書き手**（解決しない promise）→ 同じ範囲で `exit`。(4) **速い書き手**: 数 ms で終わる → 終わった時に `exit`（200 ms を待たない）。(5) **床**: `remaining_ms = 2000` で書き手が呼ばれ、`1999` で呼ばれず、主処理が予算を使い切った経路（`remaining_ms <= 0`）でも呼ばれない。呼ばれない時も `exit` は呼ばれる。(6) **出力の不変**: (1)〜(5) のどれでも、標準出力・標準エラーに書かれた bytes が、診断なしの場合と同じ。(7) **順序**: 書き手が呼ばれた時点で、証拠と答えの書き込みの callback が両方返っている（書き手の中で確かめる）。SessionStart は runtime event の記録の後。切り直しの Stop は、`request_diagnostic` が答えと証拠の書き込みの前に呼ばれても、書き手の呼び出しは flush の callback の後であること（依頼を渡すだけで診断が始まらないこと）を、書き込みの callback を遅らせて確かめる。(8) **例外**: 書き手が同期に投げる・非同期に reject する・`exit` の後に reject する、のいずれでも、`exit` は 1 回だけ呼ばれ、unhandled rejection が出ない。(9) **不変条件**: `HOOK_DIAGNOSTIC_MIN_REMAINING_MS > HOOK_DIAGNOSTIC_MAX_WAIT_MS`、上限は 1 か所の定数。(10) **取り込みの Stop**: 書き込みの callback が返ってから `exit` する。拒否された入力・失敗の経路でも `exit` が呼ばれ、出力の bytes が今と同じ。(11) **非同期であること**: 診断の module が同期の呼び出し（`mkdirSync`・`writeFileSync`・`fsyncSync` など）を持たないことを、import と呼び出しの静的な確かめで固定する。実際の応答しない disk は試験で作れず、12 節に書く。
- 読み（6 節）: 記録あり／記録なし／壊れた file・symlink・権限が広い・schema が違う・64 KiB 超は「観測できず」で、0 件と出さない。出力に値・path・session id が無い。
- 入口 3 つが同じ関数を通る（`parseHookInputShape` を差し替えた時に 3 つとも結果が変わる）。
- 反転する既存の負例（11 節の 6 に deviation_ledger の 1 行ずつ）: `src/test-claude-session-start.ts` の `unexpected: true` の 2 件（`parseClaudeSessionStartInput` が `MALFORMED_HOOK_INPUT` を投げる確かめと、`runClaudeSessionStart` が `MALFORMED_HOOK_INPUT` を返す確かめ）は、受理に変える。`src/test-transcript-stop-capture.ts`・`src/test-session-rotation-flow.ts`・`src/test-claude-transcript-identity.ts`・`src/test.ts` の `malformed_input`／`MALFORMED_HOOK_INPUT` の確かめは、`{}`・`{`・`not json`・過大な入力などの別の理由で、知らない key の拒否ではないので変わらない（code を読んで確かめた）。
- `--node-path`（F3。両方の installer で）: 既定で動きが同じ（引数なしの出力が今と byte で同じ）、実在しない／相対／通常 file でない／実行できない／NUL を含む path を拒否、**basename が `node` でない path（実際の node への `nodejs`・`node22` の名前の symlink）を拒否して設定を書かない**、basename が `node` の symlink は許す、command が 3 つ（SessionStart・取り込みの Stop・切り直し）とも同じ node になる。**入れ直し**: (a) 別名の symlink `A/node`（実際の node への symlink）で入れた後、別の symlink `B/node` で入れ直すと、SessionStart・取り込みの Stop・切り直しのそれぞれで管理中の hook が 1 つだけで、その先頭の node が `B/node`、(b) 同じ指定で再実行しても hook が 1 つで設定が byte で同じ（冪等）、(c) 古い installer が書いた先頭の node が別の絶対 path（basename が `node` でない path も含む）の Claude の SessionStart の hook が置き換えられて 1 つになる、(d) 先頭が相対 path・adapter id の違い・flag の並びの違いの command は管理外のまま保たれる。`parseClaudeHookCommand` の既定（`"current"`）の結果が変わらず、`src/kusabi-fleet-rollout.ts` の試験が今のまま通る。**rollout・監査との関係の固定（M2。8 節）**: 先頭の node が `process.execPath` と違う Claude の SessionStart の hook・Codex の SessionStart の hook を、`parseClaudeHookCommand`・`parseCodexHookCommand` の既定が今までどおり `null` にする（`--node-path` で入れた別の node の hook が rollout の読み戻しと監査に数えられず、安全側に失敗する形を変えていない確かめ）。
- 知らない key と他の拒否の重なり（F5。A4 が実装の PR で見る点 1。3 節の層の分けと表）: **oracle は差分**。各入口 E と、E の既存の負例 N（知らない key を含まない入力）ごとに、(a) N の結果を固定する（既存の確かめで足りる所は既存を使い、足りない所は N だけの確かめを足す。N は知らない key を含まないので、直す前の code でも通る）、(b) N に知らない key U（値は他に現れない目印の文字列）を足した N+U を**直した後の code で**流し、結果が N の結果と同じであることを確かめる（拒否か受理か・拒否の理由コード・output の decision・evidence の項目。時刻は注入で固定）。U を含む入力に「直す前の理由コード」（`MALFORMED_HOOK_INPUT`／`malformed_input`）を期待する確かめは書かない。N の一覧: 外形（必須の欠け・空文字・JSON でない・配列・64 KiB 超）／値の型（SessionStart の `model: null`・違う `permission_mode`・空の `agent_type`）／`hook_event_name` の違い／`source` の違い（SessionStart）／binding の不正／cwd が workspace の外／`transcript_path` の置き場の外。**身元の N は入口ごとに今ある規則から選ぶ**: Claude の SessionStart = binding の不正（`IDENTITY_BINDING_INVALID`）と cwd の外（`WORKSPACE_IDENTITY_MISMATCH`）、Codex の取り込み・切り直しの Stop = binding の不正と cwd の外（どちらも `identity_binding_invalid`）、**Claude の取り込み・切り直しの Stop = binding の不正だけ**（cwd の外は今も拒否されない = N が受理。受理の N に U を足した N+U が受理のままであることを確かめ、**cwd の確かめは足さない**。FR8 R1）。直す前の code で落ちる（Red）のは、N+U の parser の層が `UNSUPPORTED_*` に変わる物と、N+U が下流の確かめへ進む物（Stop 系の binding・cwd・`transcript_path`、SessionStart の cwd）、SessionStart の入口全体で proxy の直しが要る物。SessionStart の binding の不正の N+U は、Codex の runner が parse の前に正規化するので、直す前の code でも N と同じ結果になり通る（3 節の表。Red から除く）。外形と型の N+U は、直す前の code でも通る（変わらないことの回帰の防ぎ）。さらに、受理される入力（U だけを足した正例）では、目印の文字列が返す値・証拠（stdout／stderr の JSON）・hook の答え・診断の file・store の書き込みのどこにも現れず、拒否される N+U（`UNSUPPORTED_*` の proxy を含む）でも Codex の parser に渡る入力に現れない。A4 の点 2: 反転する既存の負例は `unexpected: true` の 2 件だけで、身元の負例に触れない（試験だけの commit の差分を 1 行ずつ読んだ結果を自己点検に書く）。
- 診断を使う試験は、`HOME` と `AGENT_MEMORY_HOME` の両方を一時の folder にして動かす（この Mac の実際の置き場に行を書かない。project の決まり）。
- 変えた行と新しい行の網羅率 100%（`coverage-method.md` の手順）。

## 10. 標準・基準への照らし（見直し役と監査が項目 ID を書く）

| 項目 | この設計での扱い |
|---|---|
| S3 知識の重複 | 外形の確かめ・大きさの値・置き場の決め方を、それぞれ 1 か所にする。必須の入口の一覧は 2 か所のまま（8 節に理由）。 |
| S4 時刻・乱数・識別子は明示入力 | parser は純粋。診断の核は `now` と `remaining_ms` を引数に取る。時計を読み、残りの予算を計算するのは入口の層だけ（5 節）。待ちの timer を持つのは入口の層の道具 `finishAfterAnswer` だけで、診断の核（名前を数えて file の中身を作る関数）は timer も時計も持たない。 |
| S5 宣言された値は証拠ではない | 読みは 3 値。壊れた file を 0 件と読まない。host の版は宣言ではなく、配備の手順が `claude --version` で観測する（code にしない。7 節）。「記録なし」は証明でないと書く（12 節）。 |
| S6 可逆 | 変更は code だけ。DB・schema・証拠の契約は変えない。戻し方は、前の版（`1b731f00…`、残してある）に配備を戻すこと。診断の file は足すだけで、消しても席の動きは変わらない。旧コードと新コードの同居: 診断の file は旧コードが読まない。Claude の SessionStart の installer の管理中の判定を広げた後に前の版へ戻す時の重なりは 12 節に書き、戻しの手順の読み戻しで確かめる。 |
| S7 外部への効果は冪等 | 外部への効果は無い（local の file を足すだけ）。 |
| S8 失敗を隠さない | 拒否の経路と理由コードは変えない。診断が書けない時に黙るのは arc-sec の条件 (d) による意図した 1 点で、11 節の 11 に「採った判断・採らなかった代替」を書き、限界を 12 節に書き、health check が別の信号と合わせて読む。`|| true`・無条件 PASS は置かない。 |
| S1・S2・S9 | 該当しない（参照される行を消さない／3 例目の抽象は作らない／資格情報を扱わない）。 |
| DB の基準（Part A・B） | DB の作りを変えないので該当しない（NFR5）。 |
| AI-native の規則 7 | 入力の確かめは決定論の script。LLM を enforcement に使わない。 |
| 行の網羅率 100% | 9 節。 |
| 守る物 | 入力の確かめの緩和 = セキュリティに関わる規則。Owner の exact-head を通す前提（0 節）。 |

## 11. 採った判断と採らなかった代替（deviation_ledger に 1 行ずつ）

1. 採った: 知らない key を無視し、名前だけを残す。採らなかった: 見つかった key を名指しで許可リストに足す（host が更新するたびに同じ故障が繰り返される。arc の判断）。
2. 採った: 診断の記録を、証拠の契約の外の file にする。採らなかった: v1 の証拠の schema（`additionalProperties: false`）に欄を足す（契約の .v2 が要り、守る物に当たる。後で別に決める。arc の判断）。
3. 採った: 診断の file を入口（adapter id）ごとに分け、1 つの名前を (event, name) で数える。採らなかった: 1 つの file に全部書く（Stop の 2 つの入口が同じ入力を二重に数え、同じ file への同時の書き込みが増える）。
4. 採った: 診断の読みを、既存の `session-rotation-status` の節にする。採らなかった: 新しい command を足す（必須の入口の一覧がまた増える）。
5. 採った: host の観測した版は、配備の health check の手順（実施者は配備を行う席）が `claude --version` で取って配備の記録に書き、診断の記録に版の欄を持たない。採らなかった: hook が版を診断に書く（hook の入力と環境に版が無い）、hook から `claude --version` を起動する（期限と副作用）、`session-rotation-status` に版を取る code を足す（process を起動する code になり、期限・失敗・網羅率の試験が増え、status が読み取りだけでなくなる）。公開された条件との差を 2 つ明記する: (a) 定数を 2.1.220 のまま保つ点は A2 の条件 4（2.1.321 に上げる）と違い、理由は v1 の schema の const（A3 の 1）。(b) 観測した版の取り方を配備の手順の 1 行にする点は A3 の 2 が記録している。実施者を配備を行う席にすること、`session-rotation-status` が版を取らないことは作者の選択で、A3 には書かれていない（0 節・13 節）。
6. 採った: 反転する既存の負例 2 件（`src/test-claude-session-start.ts` の `unexpected: true`）を受理の確かめに変える。採らなかった: 試験を残して code を拒否のままにする（故障が直らない）。残す負例: `source: "unknown"`・必須の欠け・型の違い・64 KiB 超・JSON でない。
7. 採った: 共有の `parseTranscriptStopInput` を直して Codex の Stop も同時に緩める。`ignored_names` は、戻り値の型を変えない姉妹の関数（`parseTranscriptStopInputWithIgnored`、SessionStart も同じ形）から入口が受ける。採らなかった: host ごとに外形の確かめを二重に持つ（S3 違反）、既存の parser の戻り値に `ignored_names` を足す（既存の呼び出し元と試験の型が変わる）。Codex の SessionStart の parser だけは範囲の外にした。
8. 採った: 条件に合わない名前は書かず `invalid_names` に数える。採らなかった: 切り詰めて保存する（別の名前に見える）、そのまま保存する（長さ・文字の上限を破る）。
9. 採った: `rotationRoot` の中の `<home>` の決め方を `agentMemoryHome` として取り出して 2 か所で使う。採らなかった: 診断の module に同じ決め方を写す（置き場の決め方が 2 か所になる）。
10. 採った: `--node-path` は絶対 path で basename がちょうど `node` の物だけ受け入れ、Claude の SessionStart の installer が管理中の hook を見分ける条件は node の path に依らない形（`words[0]` は絶対 path であればよく、残りの canonical の確かめは今のまま）にする。`parseClaudeHookCommand` の既定は今のままで、installer の判定だけが省略可能な引数で広げる。採らなかった: `--node-path` を足すだけで条件を変えない（別の node で入れた hook を管理外と見て重ねて足す）、`--node-path` で渡した値と一致する時だけ管理中と見る（入れ直しで path が変わった時に古い hook が残る）、受け入れる名前を限らず管理中の判定を「basename が `node`」にする（`nodejs` のような受け入れた別名を再認識できない。F3）、`parseClaudeHookCommand` の既定を変える（`src/kusabi-fleet-rollout.ts` の読み戻しの結果が変わる）。
11. 採った: 診断が書けない時は、hook の答えと証拠を変えずに黙る（H5。arc-sec の条件 (d)）。採らなかった: 書けない時に hook を失敗させる・答えを変える（診断の失敗で席が止まり、今回の故障と同じ形になる）。限界（「記録なし」が証明でない）は 12 節に書き、health check が別の信号と合わせて読む。
12. 採った: 知らない key を含む入力の結果を「知らない key を除いた同じ入力と同じ」と定め（差分の oracle）、知らない key が他の拒否と重なる入力が、外形の確かめを通った後の確かめ（`hook_event_name`・`source`・身元・下流）まで進んで、理由コードが `MALFORMED_HOOK_INPUT`／`malformed_input` からその本来の理由に変わることを受け入れる（拒否は変わらない。3 節の表）。SessionStart の入口全体の理由を N と同じにするため、`proxyForInputError` が Codex の parser へ渡す入力を Claude の既知の key だけにする。Claude の Stop には cwd の確かめを足さない（FR8 R1）。採らなかった: (a) 「知らない key があっても今と同じ理由コード」を保つために、知らない key の確かめを `hook_event_name`・`source`・身元の確かめの後ろに置いて別の経路を作る（外形の確かめが 2 か所になる。S3）、(b) proxy を直さず入口全体の理由を `MALFORMED_HOOK_INPUT` のままにする（N+U が N と違う結果になり、差分の oracle が閉じない。parser の層と入口全体で違う理由が出る）、(c) Claude の Stop に cwd の確かめを足して N+U と N を揃える（新しい拒否の追加で、FR8 R1 を破る）。
13. 採った: Stop／UserPromptSubmit の任意 8 項目の型違いは、今の挙動（拒否せず省略）のまま保つ。SessionStart の任意 3 項目は今のまま拒否する（3 節の表）。採らなかった: Stop 系にも SessionStart と同じ型の拒否を足す（今は受理されている入力を新しく拒否する挙動の変更で、「知らない key だけを変える」の範囲を超え、host が任意項目の形を変えた時に席が止まる故障が Stop 系にも広がる。F1）。A2 の条件 1 の文面との差: 条件 1 は「知っている任意の key の型の確かめも残す（`permission_mode` の列挙、`stop_hook_active` の真偽）」と書く。この設計は「残す」を「今ある確かめを残す」と読む。今の Stop 系は `permission_mode` の列挙も `stop_hook_active` の真偽も拒否の確かめとして持たず、型違いを省略するので、Stop 系ではそれが残る（拒否に変えない）。SessionStart の `permission_mode` の列挙は今のとおり拒否として残る。「Stop 系にも拒否を足す」と読めば条件 1 とこの設計は食い違うので、この読みは監査に見てもらう点（DES-8）。
14. 採った: 答えと証拠を（書き込みの callback まで）書き切ってから、診断を非同期（`node:fs/promises`）で 1 回だけ試み、`min(残りの予算, 200 ms)` で process を終える。残りが 2000 ms 未満なら診断を始めない。I/O は読み 1 回と書き 1 回、fsync はしない。取り込みの Stop には callback つきの書き込みと明示の終了を足す。採らなかった: (a) 同期 I/O のまま始める条件だけで抑える（遅れが I/O の長さ次第で上限が無い。2 回目の設計監査の反例: 主処理 5000 ms + I/O 4500 ms = 9500 ms で host の 9 秒を超える。F2）、(b) 同期 I/O を `Promise.race` や timer で包む（同期 I/O は event loop を止めるので timer が鳴らない）、(c) I/O の量（file の大きさ・回数）で時間を抑える（量は時間の上限にならない）、(d) 診断を先にして答えを後に書く（診断の間、答えが出ない）、(e) 診断を別の process に出す（process が増え、失敗の経路が増える）、(f) 毎回、予算に関係なく書く（主処理が予算を使い切った後に遅れを足す）、(g) 待つ上限を残りの予算そのものにする（残りが大きい時に終了が遅れる）、(h) fsync を残す（診断は証拠でなく、fsync が待ちを伸ばす）。上限 200 ms と床 2000 ms は定数の選びで、実測ではない。内部の期限（7 秒）と host の限度（9 秒）は読み替えない。

## 12. 残る危険

- 診断が書けない時に黙る（arc-sec の条件 (d)）。health check の「記録なし」は「知らない key を見なかった」の証明ではない。別の信号（同じ session の SessionStart の証拠の `input_valid`）と合わせて読む。
- 件数は下限（同時の書き込みで少なく数える）。
- host が既知の key の意味を変えた場合（`session_id` の意味、`transcript_path` の置き場）は、この確かめでは見つからない。身元の確かめ（FR8.4 の R1〜R9）が拒むかどうかに頼る。
- 緩めた後は、host が足す key で席が止まらなくなる代わりに、足した key に気づく手段は診断の名前だけになる。health check で見る手順を Deployment Execution の記録に入れる。
- Codex の SessionStart・Gemini・Antigravity の parser は同じ形の脆さを残す。直すかは別に決める。
- Claude の SessionStart の installer の管理中の判定を node の path に依らない形に広げるので、先頭が絶対 path で、adapter id・引数の並び・runner の path の形（`<版の root>/dist/claude-session-start.js`）が canonical に一致する command は、どの node の path でも Wasurezu の管理中として置き換えの対象になる。canonical の残りの確かめは今のまま。`--node-path` が受け入れるのは basename が `node` の path だけで（別名は受け入れない）、判定の広がりは、古い installer が書いた任意の path の hook を置き換えるためである。Claude の Stop・切り直しと Codex の 3 つの command は、すでに adapter id の文字列で見分けていて、広がらない。
- `--node-path` で入れた hook は、rollout の読み戻しと監査に数えられない（M2。8 節）。広げるのは installer の判定だけで、`src/kusabi-fleet-rollout.ts` の読み戻し（`parseClaudeHookCommand`・`parseCodexHookCommand` を既定の `"current"` で使い、`managed.length === expectedCount` を要求）と `src/company-dev-os-recovery-target-audit.ts` の読み（`parseCodexHookCommand`）は今のまま、先頭の node が自分の `process.execPath` の hook だけを管理中と数える。`--node-path` で別の node を指定して入れた席は、rollout の読み戻しが失敗し、監査は `invalid` を返す。読み手が安全側（見つからない = 失敗）に倒れる形で、黙って通ることは無いが、そういう席を rollout・監査で扱えない。`--node-path` は rollout を通さずに人が据える席にだけ使う（rollout・監査が数える席には使わない）。この限界を残すのは、読み手を広げると配備の読み戻しの意味が変わり、守る物の側になるため。
- 前の版へ配備を戻す時、前の版の Claude の SessionStart の installer は管理中の判定が `words[0] === process.execPath` のままなので、`--node-path` で入れた別の node の hook を管理外と見て、重ねて足すことがある（Codex は adapter id の文字列で見分けるので起きない）。戻しの手順（Deployment Execution）の読み戻しに、同じ event に Wasurezu の hook が 2 つ重なっていないことを入れる。
- 診断の I/O が OS の側で戻らない（応答しない disk など）場合でも、診断は非同期なので、上限の 200 ms で `process.exit` を呼ぶ（待つ時間の上限は I/O の長さに依らない）。ただし、カーネルが戻らない I/O の完了を待つ間は、`process.exit` の後も process が終了しきらないことがある。答えは書き終えているが、host が終了まで待つ作りなら host の期限（9 秒）に頼る。これは同期か非同期かに依らない OS の性質で、防げない。実際の応答しない disk での確かめは行っていない。
- 上限 200 ms と床 2000 ms は定数の選びで、実測ではない。遅い disk で診断が上限を超え続けると、診断は切れ続けて空のまま（または古いまま）になり、切れたことは記録されない。「記録なし」「古い」は「知らない key を見なかった」の証明ではない（1 つ目の危険と同じ形）。切れた時、古い file は無傷だが、一時 file（値なし・0600）が残ることがあり、掃除はしない（診断の folder は消しても席の動きは変わらない）。fsync をしないので、電源断で新しい file が失われることもある。
- 取り込みの Stop の入口には、今は明示の終了が無い。callback つきの書き込みと明示の終了を足すのは挙動の変更で、他の 2 入口と同じ形にするためである。store は `runTranscriptStopCapture` の中で閉じてから戻る（実装の試験で、出力の bytes が今と同じで終了コードが 0 であることを確かめる）。標準出力・標準エラーを host がどう読むかは今と同じ（変えない）。
- binding の `timeout_ms` が 2000 ms 以下の席と、主処理が予算をほぼ使い切った hook では、診断は省かれる。省かれたことは記録されないので、「記録なし」は「知らない key を見なかった」の証明にならない（1 つ目の危険と同じ形）。
- Claude の SessionStart の拒否の理由は、Claude の parser でなく Codex の parser が見る入力で決まる（3 節）。元の入力が Codex の 7 つのキーに揃わない（`model` が無い、`agent_type` がある）`hook_event_name`／`source` の違いは、今も `MALFORMED_HOOK_INPUT` として証拠に出る。この記録はこれを変えない（Codex の parser は範囲の外）。拒否の理由コードで host の変化を細かく見分ける用途には使えない。

## 13. 確かめた点（出所を分けて書く。0 節）と、監査に見てほしい点

出所ごとに、何が公開された記録で、何が作者の選択か:
- 公開された記録（権限の根拠に引ける。ただし arc の技術の判断は Owner の決定ではない）: A1（診断の置き場・知らない key の無視・順）、A2（arc-sec の条件）、A3（host の契約の版の扱い・Codex の Stop の同時の緩み）、A4（arc-sec の技術の読み。verdict ではない。1 回目の設計監査の前の head `6cae0d93` の読みで、今の設計への読みではない）。
- 作者の設計上の選択: 観測した版の取り方の実施者を配備を行う席にすること、`session-rotation-status` も版を取らないこと、版のずれの 1 行が無い配備の記録を完了としないこと（7 節・11 節の 5）。A3 の 2 は「配備の health check の手順の 1 行」「ずれを 1 行で必ず書く」「診断の記録にも版は書かない」までで、これらは A3 に書かれていない（席間の連絡で arc の「良い」を受けたが、公開された記録は無い）。独立の見直し役が「code か手順かが 6 節と 7 節で揃っていない」と指摘したのが、この形にした理由。code を足さないので守る物に近づく変更ではない。2 回目の設計監査の直し（5 節の答えを先に書き切る順序と 200 ms の上限、3 節の差分の oracle、`proxyForInputError` の直し）は、監査の required_change に応じた作者の設計上の選択で、席間の連絡で受けた arc の技術の判断は公開された記録が無く、権限の根拠に引かない。上限の 200 ms と床の 2000 ms は定数の選びで、実測ではない。
- A2 の条件 4（定数を 2.1.321 に上げる）との差: 定数は 2.1.220 のまま。理由は A3 の 1（v1 の schema の const）。差を 7 節と 11 節の 5 に書いた。
- 3 節の H7・4 節・11 節の 7: Codex の Stop／UserPromptSubmit も同時に緩むことは A3 の 3 が記録している。9 節に Codex 側の正例・負例を入れた。Codex の SessionStart は範囲の外のまま。
- GitHub への記録がまだ無い物: `.gitignore` を 1 行だけにすること（8 節。A1 は `.claude/settings.json.bak*` の追加を記録し、A4 は 1 行だけの差分を読んだ）。R3（0 節）は arc の答えではなく team.md の決まり（守る物は統合の前に Owner の exact-head）による。

1 回目の設計監査（devauditor、PR #342 の comment 6793000316、BLOCK、P2 が 4 件）の指摘と直し:
- F1（Stop 系の任意項目の型違い）: 3 節に入口・項目ごとの今の拒否／省略の表を置き、Stop 系は今の挙動（省略）を保つ。H2・9 節の負例・11 節の 13・DES-2・DES-8 を表に合わせた。
- F2（診断の同期 I/O と予算）: 5 節に時間の予算を置いた（答えと証拠の確定の後・残り 2000 ms 以上の時だけ・読み 1 回と書き 1 回・足りなければ省く）。9 節に遅い I/O と予算切れの試験、12 節に防げない場合、11 節の 14。（この直しは上限を置けておらず、2 回目の設計監査で未解消と指摘された。下）
- F3（`--node-path` と管理中の判定）: 8 節で、受け入れるのは basename が `node` の絶対 path だけ、管理中の判定は node の path に依らない形にした（既定の `parseClaudeHookCommand` は変えない）。9 節に両方の installer の入れ直しの試験、11 節の 10、12 節。
- F4（版の判断の出所）: 0 節・7 節・11 節の 5・13 節で、A1・A2・A3・A4・作者の選択を分けた。

2 回目の設計監査（devauditor、PR #342 の comment 6795691349、head `a9e65e6c`、BLOCK、blocking は P2 が 2 件。DES-6・DES-8・DES-11 が FAIL、前回の F1・F3・F4 は解消）の指摘と直し:
- F2（前回の未解消部分。診断の I/O に上限が無く、答えの出力が診断の完了の後にあって、内部の期限 7 秒と host の限度 9 秒を守れない）: 5 節を、答えを書き切ってから診断を非同期で 1 回だけ試み、`min(残りの予算, 200 ms)` で終える形に書き直した。`HOOK_DIAGNOSTIC_MIN_REMAINING_MS`（2000 ms）は床として残し、`HOOK_DIAGNOSTIC_MAX_WAIT_MS`（200 ms）を足した。「I/O が 3 秒遅れても 8 秒」の見積もりは外した。9 節の試験は実時間で測る形に書き直した。11 節の 14・12 節・要件 FR10.4・HOST_ADAPTERS を同じ意味にそろえた。
- F5（知らない key と他の拒否が重なる入力に「今までと同じ理由コード」を期待する oracle が、設計 3 節の意図した理由コードの変更と、下流の身元の拒否へ進む順序と両立しない。Claude の Stop の `verifyBinding` は cwd を見ない）: 3 節を parser の層と入口全体の層に分け、順番と、知らない key を足した入力（N+U）の結果の表を置いた。oracle は「N+U の結果 = N の結果」の差分で定義し、N の理由は知らない key を含まない入力で固定する。Claude の SessionStart の `proxyForInputError` が知らない key を Codex の parser へ渡さない直しを足した（さもないと入口全体の理由が N と変わる）。Claude の Stop には cwd の確かめを足さない（FR8 R1）。9 節・11 節の 12・要件 FR10.2 を合わせた。

見直し役（AI-DLC の architecture-reviewer、読むだけ）の照らし: (1) 項目と設計の最初の見直しは NOT-READY から READY、(2) 1 回目の設計監査の直しの後は NOT-READY（Major 3）から READY、(3) 2 回目の設計監査の直しの後は READY（Major 1・Minor 4）で、直した後の再確認も READY（Minor 2 は `main` の抽出で変えない物の宣言とこの段落の経緯の書き方で、直した）。(3) の Major 1 は、4 節の切り直しの Stop の行が「答えと証拠を書く前に診断を呼ぶ」と書いていて 5 節と食い違っていた点で、依頼を渡すだけにして直した。Minor は、SessionStart と取り込みの Stop の `on_ignored_names` の経路（4 節）、5 節の「何秒かかっても」と 12 節の限界の読み合わせ、SessionStart の binding の N+U は直す前でも通ること（9 節）、床の境界を `finishAfterAnswer` の単体に分けて入口の試験を絞ること（9 節）で、すべて直した。

監査に見てほしい点: 上の変更が arc-sec の条件 (a)〜(d) を弱めていないか、H7 の共有で Codex 側に意図しない緩みが無いか、Stop 系の挙動が変わっていないか（3 節の表）、診断が hook の終了を、答えを書き終えてから 200 ms より遅らせないか（5 節）、知らない key と他の拒否の重なりの oracle が差分で閉じているか（3 節）、`--node-path` と管理中の判定が一致するか（8 節）（項目 DES-1〜DES-11）。
