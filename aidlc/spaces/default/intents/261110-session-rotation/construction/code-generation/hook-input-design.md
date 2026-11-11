# hook の入力の確かめ（FR10）: host が足した key に強くする

この記録は、要件 FR10.1〜FR10.7 の設計です。Claude Code 2.1.321 が hook の入力に足した key のために、Kusabi の SessionStart・取り込みの Stop／UserPromptSubmit・切り直しの Stop／UserPromptSubmit が入力ごと拒否している故障を、「知らない key は無視し、必須の key・型・大きさは今までどおり守る」形に直します。code は、この記録の設計監査（devauditor、1 回）の PASS と作者の受領の後に書きます。

「診断の記録」は、この記録で使う新しい語です。意味は「無視した key の名前と件数を残す、証拠の契約の外の file」で、権限・工程・証拠の項目ではありません（3 節）。

## 0. 出典

- 故障の事実: `[C2]`（席が 2026-11-11 に取った読み戻し。`operation/deployment-execution/issue-339-readback-c2.md`、agent-memory#339 に未投稿）。
- arc の技術の判断（Owner の決定ではない）: agent-memory#339 の comment 6791901034（投稿者 watchout、本文の SHA-256 `69ca10d6e8e418ad425e1e9a8f81b73799d49fa8496ad93288dc2882fae59c32`）。
- arc-sec の条件: iyasaka-arc#57 の comment 6791886636・6791925065（診断の置き場と中身、health check、書けない時、入口 3 つを 1 か所の parser に、host の契約の版の定数、実物の key の形の試験、反転する負例の記録）。
- 補い（arc の席間の連絡。GitHub への記録はまだ無い）: host の契約の版の定数は `"2.1.220"` のまま、意味は「契約を確かめた版」。Codex の SessionStart の parser は範囲外。
- この記録の 13 節の 4 点への答え（arc の席間の連絡。arc の技術の判断と Owner の委任 #49 6762288830 の範囲で、Owner の言葉ではない。GitHub への記録はまだ無い）: 観測した版の取り方（7 節）・Codex の Stop の同時の緩み（3・4 節）・`.gitignore` を 1 行だけにすること（8 節）・R3 として Owner の exact-head を通すこと（下の「守る物」）は、どれも「良い」。権限の根拠として引くのは、上の GitHub に記録された物だけにする。
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
| H2 | 今までどおり拒否する: 64 KiB 超、JSON でない、object でない（配列・数・null）、必須の key の欠け、必須の値の型・形の違い（空文字・前後の空白・NUL、`hook_event_name` の違い、`source` の違い、任意の key の型の違い）。理由コードは今のまま（`MALFORMED_HOOK_INPUT`・`UNSUPPORTED_HOOK_EVENT`・`UNSUPPORTED_START_SOURCE`・`malformed_input`）。 |
| H3 | 新しく許す: 必須・任意の一覧に無い key。値は読まない。入口の関数に渡さない。 |
| H4 | 無視した key の名前は、診断の記録（5 節）に書く。証拠の契約（`claude-session-start-evidence-v1` の schema、`wasurezu-transcript-stop-capture/v1`）には足さない。 |
| H5 | 診断が書けなくても、hook の答えと証拠は書けた時と同じ。席は止まらない。 |
| H6 | host の契約の版の定数は動かさない（7 節）。 |
| H7 | 取り込みの Stop／UserPromptSubmit の外形の確かめ（`parseTranscriptStopInput`）は Claude と Codex が共有するので、H1〜H5 は Codex の Stop／UserPromptSubmit にも同時に当たる（Codex の入力でも、知らない key は無視され、必須の key・型・大きさは今までどおり拒否される）。Codex の SessionStart の parser は H1〜H5 の外のまま。 |

H2 の理由コードの順番: 外形の確かめ（H1）が先、続いて `hook_event_name`・`source`・型の確かめ（`parseClaudeSessionStartInput` の今の並びのまま）。理由コードが変わる入力は次の 2 つだけで、ほかの拒否の理由コードは今のまま:
- 知らない key と間違った `hook_event_name` が重なる入力: 今は `MALFORMED_HOOK_INPUT`、直した後は `UNSUPPORTED_HOOK_EVENT`（知らない key が拒否の理由でなくなるため）。
- 知らない key と許可リストに無い `source`（SessionStart）が重なる入力: 今は `MALFORMED_HOOK_INPUT`、直した後は `UNSUPPORTED_START_SOURCE`。

どちらも「拒否される」ことは変わらず、変わるのは理由コードだけ。11 節の 12 に deviation_ledger の 1 行を置く。

Stop／UserPromptSubmit（`parseTranscriptStopInput`）は、知らない key・必須の欠け・`hook_event_name` の違い・型の違いのすべてを同じ `malformed_input` に落とす（`src/transcript-stop-capture.ts` の 1 つの条件式）ので、理由コードは変わらない。変わるのは、知らない key だけを理由に拒否されていた入力が受理されること。

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
| Claude の SessionStart | `src/claude-session-start.ts` の `parseClaudeSessionStartInput` | 大きさ・JSON・object・必須・許可リストの 4 つの確かめを `parseHookInputShape` に置き換える |
| 取り込みの Stop／UserPromptSubmit | `src/transcript-stop-capture.ts` の `parseTranscriptStopInput` | 同上 |
| 切り直しの Stop／UserPromptSubmit | `src/session-rotation-stop.ts` | 変更なし（`parseTranscriptStopInput` を通るので、取り込みの入口の直しで直る） |

`parseTranscriptStopInput` は Codex の Stop も通す共有の関数なので、Codex の Stop／UserPromptSubmit も同時に「知らない key を無視」になる。host ごとに外形の確かめを二重に持つ（S3 違反）より、1 か所で揃える。Codex の SessionStart の parser（`parseCodexSessionStartInput`、`src/codex-session-start.ts`）は範囲の外: 同じ形の脆さがあるが、直すかは別に決める。

返す値（`TranscriptStopInput`・`ClaudeSessionStartInput`）には `ignored_names` を足さない。入口は `ignored_names` を別に受け取り、診断の記録へ渡す。

## 5. 診断の記録（H4・H5）

新しい module `src/hook-input-diagnostics.ts`（約 150 行）。arc-sec の条件 (a)〜(d) をそのまま形にする。

- 置き場: `<AGENT_MEMORY_HOME か ~/.agent-memory>/hook-input/<agent_id>/<project>/<adapter_id>.json`。`<home>` の決め方は今の `rotationRoot` の中にあるので、`agentMemoryHome(env)` として取り出し、`rotationRoot` と新しい `hookInputRoot` の両方が使う（S3: 置き場の決め方を 1 か所に）。`<agent_id>`・`<project>` は `ROTATION_SEAT_SEGMENT` で確かめる（通らなければ書かない）。`<adapter_id>` は、各入口が持つ定数の閉じた集合（Claude の SessionStart・Claude と Codex の取り込みの Stop・Claude と Codex の切り直しの Stop）だけで、入力からは作らない。
- 権限: folder 0700、file 0600。書く前に folder を `lstat` し、symlink・持ち主が今の uid でない・group／other の権限がある場合は書かない。file は一時 file に書いて rename（`writeJsonAtomic` を再利用。fsync と folder の fsync を含む）。
- 中身（`kusabi-hook-input-diagnostics/v1`。契約ではない、診断の記録の形）:

```text
{ schema_version, adapter_id,
  entries: [ { event, name, count, first_seen, last_seen } ],   // 32 件まで
  dropped_names: <捨てた名前の延べ数>, invalid_names: <名前を書けなかった延べ数> }
```

- 書く物は event 名・key の名前・件数・時刻だけ。値・本文・path・session id・cwd は書かない。`event` は `SessionStart`／`Stop`／`UserPromptSubmit` のいずれか。時刻は呼び出し側が渡す（S4）。核の関数は `now` を引数に取り、hook の入口の層だけが現在時刻を読む。
- 名前の条件: `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`（64 字以内）。条件に合わない名前は書かず `invalid_names` に数えるだけ（切り詰めて別の名前に見せない）。1 回の入力の `ignored_names` が 32 を超える時は、辞書順の先頭 32 だけを扱い、残りは `dropped_names` に数える。
- 上限: entries は 32 件。満杯の時に新しい名前が来たら、`last_seen` が最も古い物（同じ時刻は count の少ない物、次に名前の辞書順）を捨てて `dropped_names` を 1 増やす。決まった順序なので、同じ入力の列は同じ file になる。file の大きさは（整形した JSON で）10 KiB に収まる。読む側は 64 KiB を超える file を「観測できず」にする（6 節）。
- 同じ入力の列で 1 つの名前が来るたびに count を 1 増やす。1 つの入力で 1 つの名前は 1 回だけ数える。
- 競合: Stop の 2 つの入口は別の file（adapter id ごと）に書くので、同じ入力を二重に数えない。同じ file への同時の書き込みは、後の rename が勝ち、件数が少なく数えられることがある。件数は下限として読む（診断は証拠ではない）。
- 書けない時（H5）: 置き場が作れない・権限の条件を満たさない・書き込みの誤り・seat の名前が条件に合わない、のどれでも、例外は入口の中で受けて捨て、hook の答えと証拠は変えない。一時 file が残った時は取り除きを試みるだけで、失敗しても何もしない。診断を書く時間は hook の内部の期限（7 秒）の中に収まる小さな同期の書き込み 1 回で、入口は答えを決めた後に呼ぶ。

## 6. health check の読み（arc-sec の条件 (c)）

- 読み手は、既に seat の rotation の file を読み取りだけで見せる `src/session-rotation-status.ts`（`kusabi-rotation-status/v1`）に、`hook_input` の節を足して使う（新しい command を増やさない = 必須の入口の一覧を余分に増やさない）。出力は additive で、既存の欄は変えない。
- 読み方は 3 値（S5）: 「記録あり」（名前・event・件数・最後に見た時刻だけを出す）、「記録なし」（file が無い）、「観測できず」（file はあるが信頼できない: JSON が壊れている・schema が違う・型が違う・64 KiB 超・symlink・持ち主が違う・権限が広い）。「観測できず」を 0 件と読まない。今の `session-rotation-status` の `FileState`（`none`／`unreadable`／`valid`）と同じ区別を使う。なお、既存の `readJsonFile` は「無い」と「壊れている」の両方を `null` で返して区別できないので使わず、診断の module が `ENOENT` とそれ以外を分けて読む。
- 「記録なし」は「知らない key を見なかった」の証明ではない。書けなかった場合も同じ状態になる（H5 の代償）。そのため health check は、同じ session の SessionStart の証拠の `input_valid: true` など、別の信号と合わせて読む。この限界は 12 節に書く。
- 出力は名前と件数だけ。value・path・session id は出さない。
- この節の code（`session-rotation-status`）は file を読むだけで、process を起動しない。観測した host の版は取らない（取るのは 7 節の手順）。

## 7. host の契約の版（H6）

- 定数 `CLAUDE_SESSION_START_HOST_CONTRACT_VERSION` は `"2.1.220"` のまま。schema の `const "2.1.220"`（`docs/design/schemas/claude-session-start-evidence-v1.schema.json`）と、`src/test-claude-session-start.ts`・`src/test.ts` の確かめを動かさない。意味は「契約を確かめた版」で、host の今の版ではない。定数の宣言の所に 1 行の注釈でこの意味を書く。
- 観測した host の版: arc の判断は「診断の記録にだけ書く」。確かめた事実: hook の入力に版の key は無く（上の probe の key の名前に無い）、hook の process の環境にも版を持つ変数は無い（この席の環境の変数の名前で確かめた。`CLAUDE_CODE_ENTRYPOINT`・`CLAUDE_CODE_EXECPATH` などはあるが版ではない）。hook から `claude --version` を起動するのは、期限と副作用の面で採らない。
- そこで、観測した版は **Deployment Execution の health check の手順**（code ではない）が取る。実施者は配備を行う席で、手順の 1 行として `claude --version` を 1 回流し、配備の記録（deployment-log）に「契約を確かめた版 2.1.220 と今の版のずれ」として書く。`claude --version` が実行できない・期限内に終わらない・版として読めない時は、版を推測せず「観測できず」と書く（ずれが無いとは読まない）。診断の記録に `host_version` の欄は持たず、`session-rotation-status` も版を取らない（6 節）: 取れない値を `null` で持つと「版が合っている」と読み違えやすく、status に process を起動する code を足すと期限・失敗・網羅率の試験が増えるため。
- この取り方は、この PR の試験の対象ではない（code が無い）。確かめる場所は、配備の記録（計画 Step 16.11）に「版のずれ」または「観測できず」が書かれていること。
- arc の判断（agent-memory#339 の comment 6791901034）の文面は「版は診断の記録にだけ書く」だが、hook の入力にも環境にも版が無いため、配備の health check の手順が取る（arc の席間の連絡で「良い」。0 節。実施者を手順にしたことは 13 節）。arc の趣旨（証拠の契約に版を足さない、ずれを health check が報告する）は同じ。11 節の 5。

## 8. 同じ PR に入れる、ほかの物（arc の指示）

- 必須の入口の一覧（FR10.6）: 版を作る道具 `scripts/build-kusabi-content-addressed-runtime-release.mjs` の `ENTRYPOINTS` と、rollout の `src/kusabi-direct-fleet-rollout.ts` の `REQUIRED_ENTRYPOINTS` に `dist/session-rotation-stop.js` と `dist/rotation-watcher.js` を足す（版 `1b731f00…` を作った時に、道具の一覧に無いため別に実在を確かめた）。一覧の値が 2 か所にあるのは今の形で（S3 の指摘になりうる）、1 か所にまとめるのはこの PR の範囲の外とし、両方に同じ 2 行を足して、試験（`scripts/test-kusabi-content-addressed-runtime-release.mjs`・`src/test-kusabi-direct-fleet-rollout.ts`）で 2 つの一覧が一致することを確かめる。`src/kusabi-direct-fleet-rollout.ts` は 800 行を超える file なので、足すのは 2 行だけ（触る時に直す、まとめて直さない）。
- installer の `--node-path`（FR10.7）: `src/claude-hook-installer.ts`・`src/codex-hook-installer.ts` に、hook の command の先頭の node を指定する任意の引数を足す。既定は今の `process.execPath`（引数が無ければ動きは変わらない）。確かめは 1 つの関数（`src/hook-node-path.ts`、約 30 行）に置く: 絶対 path で `resolve(value) === value`、NUL を含まない、`statSync` が通常 file、`accessSync(X_OK)` が通る（symlink は許す。`/opt/homebrew/bin/node` のような版に依らない path が symlink だから）。通らなければ設定を書かずに止まる。installer が「管理中の hook」を見分ける条件は、今 `words[0] === process.execPath` なので、別の node で入れた hook を管理外と見て重ねて足してしまう。条件を「絶対 path で basename が `node`」に直す（残りの canonical の確かめ: adapter id・引数の並び・runner の path の形は今のまま）。入れ直しで node の path が変わっても、古い管理中の hook を置き換える。これは席の hook の差し替えではなく、installer の code の変更に限る。席への据え付けは守る物で、Owner の決定の後に行う。
- `.gitignore` に `.claude/settings.json.bak*` を 1 行足す（C2 で、backup が git に無視されておらず `git add -A` で載ることを確かめた）。AI-DLC の出荷した block 全体は入れない（arc が席間の連絡で「良い」。13 節）。
- `docs/operations/HOST_ADAPTERS.md` の Claude Code の節に、入力の扱いを 1 段落足す（必須の key・型・大きさは守る、知らない key は無視して名前だけを診断の記録に残す、契約の版の意味）。base にある行は消さない。
- `package.json` の `test:claude-hook` の後ろに新しい試験 2 file を足す（workflow は変えない）。

## 9. 試験（設計監査の PASS の後に先に書き、直す前の code で落ちることを確かめる）

- 正例（実物の key の形。名前は probe で確かめた物、値はダミー）: SessionStart に `session_title`、UserPromptSubmit に `prompt_id`・`session_title`、Stop に `background_tasks`・`effort`・`prompt_id`・`session_crons`。受理され、入口が返す値に知らない key が入らず、診断に名前と件数が出て、値が出ない。
- Codex 側（H7）: 取り込みの Stop と UserPromptSubmit の入力（Codex の必須・任意の key の形）に知らない key を足した正例が受理され、返す値に知らない key が入らず、診断に Codex の adapter id で名前が出る。Codex の同じ入力で、必須の欠け・型の違い・64 KiB 超・JSON でない・object でないが今までどおり拒否される負例。Codex の SessionStart に知らない key を足した入力が今までどおり拒否される（範囲の外で変えていないことの確かめ）。
- 負例（今までどおり拒否）: 必須の欠け（各入口の必須の key を 1 つずつ外す）、型・形の違い（空文字・NUL・前後の空白、`model: null`、`permission_mode` の違う値）、64 KiB 超（標準入力側も）、JSON でない、配列・数・null、`hook_event_name`・`source` の違い。理由コードは今のまま。
- 診断: 名前の条件（長い・記号・`__proto__`・空）で書かず `invalid_names` に数える／33 個目で最も古い物が捨てられ `dropped_names` が増える／1 回の入力に 40 個の名前／同じ入力の列で file の中身が同じ（決まった順序）／0700・0600／一時 file が残らない／symlink の folder・持ち主が違う・権限が広い場合に書かない。
- H5: 置き場が書けない（読み取り専用の folder）・seat の名前が条件に合わない・file が壊れている、のそれぞれで、hook の答えと証拠が書けた時と同じ。
- 読み（6 節）: 記録あり／記録なし／壊れた file・symlink・権限が広い・schema が違う・64 KiB 超は「観測できず」で、0 件と出さない。出力に値・path・session id が無い。
- 入口 3 つが同じ関数を通る（`parseHookInputShape` を差し替えた時に 3 つとも結果が変わる）。
- 反転する既存の負例（11 節の 6 に deviation_ledger の 1 行ずつ）: `src/test-claude-session-start.ts` の `unexpected: true` の 2 件（`parseClaudeSessionStartInput` が `MALFORMED_HOOK_INPUT` を投げる確かめと、`runClaudeSessionStart` が `MALFORMED_HOOK_INPUT` を返す確かめ）は、受理に変える。`src/test-transcript-stop-capture.ts`・`src/test-session-rotation-flow.ts`・`src/test-claude-transcript-identity.ts`・`src/test.ts` の `malformed_input`／`MALFORMED_HOOK_INPUT` の確かめは、`{}`・`{`・`not json`・過大な入力などの別の理由で、知らない key の拒否ではないので変わらない（code を読んで確かめた）。
- `--node-path`: 既定で動きが同じ、実在しない／相対／通常 file でない／実行できない path を拒否、symlink を許す、別の node で入れた hook を重ねず置き換える、Codex の installer でも同じ。
- 診断を使う試験は、`HOME` と `AGENT_MEMORY_HOME` の両方を一時の folder にして動かす（この Mac の実際の置き場に行を書かない。project の決まり）。
- 変えた行と新しい行の網羅率 100%（`coverage-method.md` の手順）。

## 10. 標準・基準への照らし（見直し役と監査が項目 ID を書く）

| 項目 | この設計での扱い |
|---|---|
| S3 知識の重複 | 外形の確かめ・大きさの値・置き場の決め方を、それぞれ 1 か所にする。必須の入口の一覧は 2 か所のまま（8 節に理由）。 |
| S4 時刻・乱数・識別子は明示入力 | parser は純粋。診断の核は `now` を引数に取る。時計を読むのは入口の層だけ。 |
| S5 宣言された値は証拠ではない | 読みは 3 値。壊れた file を 0 件と読まない。host の版は宣言ではなく、配備の手順が `claude --version` で観測する（code にしない。7 節）。「記録なし」は証明でないと書く（12 節）。 |
| S6 可逆 | 変更は code だけ。DB・schema・証拠の契約は変えない。戻し方は、前の版（`1b731f00…`、残してある）に配備を戻すこと。診断の file は足すだけで、消しても席の動きは変わらない。旧コードと新コードの同居: 診断の file は旧コードが読まない。installer の管理中の hook の条件を広げた後に前の版へ戻す時の重なりは 12 節に書き、戻しの手順の読み戻しで確かめる。 |
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
5. 採った: host の観測した版は、配備の health check の手順（実施者は配備を行う席）が `claude --version` で取って配備の記録に書き、診断の記録に版の欄を持たない。採らなかった: hook が版を診断に書く（hook の入力と環境に版が無い）、hook から `claude --version` を起動する（期限と副作用）、`session-rotation-status` に版を取る code を足す（process を起動する code になり、期限・失敗・網羅率の試験が増え、status が読み取りだけでなくなる）。arc の判断の文面（診断の記録に書く）と違うが、arc が席間の連絡で「良い」と答えた（0 節・13 節）。
6. 採った: 反転する既存の負例 2 件（`src/test-claude-session-start.ts` の `unexpected: true`）を受理の確かめに変える。採らなかった: 試験を残して code を拒否のままにする（故障が直らない）。残す負例: `source: "unknown"`・必須の欠け・型の違い・64 KiB 超・JSON でない。
7. 採った: 共有の `parseTranscriptStopInput` を直して Codex の Stop も同時に緩める。採らなかった: host ごとに外形の確かめを二重に持つ（S3 違反）。Codex の SessionStart の parser だけは範囲の外にした。
8. 採った: 条件に合わない名前は書かず `invalid_names` に数える。採らなかった: 切り詰めて保存する（別の名前に見える）、そのまま保存する（長さ・文字の上限を破る）。
9. 採った: `rotationRoot` の中の `<home>` の決め方を `agentMemoryHome` として取り出して 2 か所で使う。採らなかった: 診断の module に同じ決め方を写す（置き場の決め方が 2 か所になる）。
10. 採った: installer が管理中の hook を見分ける条件を「絶対 path で basename が `node`」に広げる。採らなかった: `--node-path` を足すだけで条件を変えない（別の node で入れた hook を管理外と見て重ねて足す）、`--node-path` で渡した値と一致する時だけ管理中と見る（入れ直しで path が変わった時に古い hook が残る）。
11. 採った: 診断が書けない時は、hook の答えと証拠を変えずに黙る（H5。arc-sec の条件 (d)）。採らなかった: 書けない時に hook を失敗させる・答えを変える（診断の失敗で席が止まり、今回の故障と同じ形になる）。限界（「記録なし」が証明でない）は 12 節に書き、health check が別の信号と合わせて読む。
12. 採った: 知らない key と間違った `hook_event_name`／許可リストに無い `source` が重なる入力の理由コードが、`MALFORMED_HOOK_INPUT` から `UNSUPPORTED_HOOK_EVENT`／`UNSUPPORTED_START_SOURCE` に変わることを受け入れる（拒否は変わらない。3 節）。採らなかった: 理由コードを守るために、知らない key の確かめを `hook_event_name`・`source` の確かめの後に置いて別の経路を作る（外形の確かめが 2 か所になる。S3）。

## 12. 残る危険

- 診断が書けない時に黙る（arc-sec の条件 (d)）。health check の「記録なし」は「知らない key を見なかった」の証明ではない。別の信号（同じ session の SessionStart の証拠の `input_valid`）と合わせて読む。
- 件数は下限（同時の書き込みで少なく数える）。
- host が既知の key の意味を変えた場合（`session_id` の意味、`transcript_path` の置き場）は、この確かめでは見つからない。身元の確かめ（FR8.4 の R1〜R9）が拒むかどうかに頼る。
- 緩めた後は、host が足す key で席が止まらなくなる代わりに、足した key に気づく手段は診断の名前だけになる。health check で見る手順を Deployment Execution の記録に入れる。
- Codex の SessionStart・Gemini・Antigravity の parser は同じ形の脆さを残す。直すかは別に決める。
- installer の管理中の hook を見分ける条件を広げるので、`/some/path/node` で始まり adapter id と引数の並びが canonical に一致する command は、Wasurezu の管理中として置き換えの対象になる。canonical の残りの確かめ（adapter id・引数の並び・runner の path の形）は今のまま。
- 前の版へ配備を戻す時、前の版の installer は管理中の hook の条件が `words[0] === process.execPath` のままなので、`--node-path` で入れた別の node の hook を管理外と見て、重ねて足すことがある。戻しの手順（Deployment Execution）の読み戻しに、同じ event に Wasurezu の hook が 2 つ重なっていないことを入れる。

## 13. 確かめた点（arc の席間の連絡。0 節）と、監査に見てほしい点

arc の技術の判断（Owner の決定ではない）で、4 点とも「良い」。次の形で設計に入れた:
- 7 節・11 節の 5: 観測した host の版は、診断の記録に書かず、配備の health check の手順が `claude --version` で取る。読めない時は「観測できず」。arc が「良い」と答えたのは取り方まで。**実施者を配備の手順（code にしない）に決めたのは作者の絞り込み**で、独立の見直し役が「code か手順かが 6 節と 7 節で揃っていない」と指摘したため。code を足さないので守る物に近づく変更ではないが、arc に監査の依頼と一緒に知らせる。
- 3 節の H7・4 節・11 節の 7: Codex の Stop／UserPromptSubmit も同時に緩むことを明記し、9 節に Codex 側の正例・負例を入れた。Codex の SessionStart は範囲の外のまま。
- 8 節: `.gitignore` は `.claude/settings.json.bak*` の 1 行だけ。
- 0 節: この PR は R3。統合の前に Owner の exact-head（arc が受ける）。

監査に見てほしい点: 上の変更が arc-sec の条件 (a)〜(d) を弱めていないか、H7 の共有で Codex 側に意図しない緩みが無いか（項目 DES-1〜DES-11）。
