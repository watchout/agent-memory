# 試験の手順 — 会話の切り直し（261110-session-rotation）

## 試験の道具と設定

- 試験は今の形に合わせる: `src/test-*.ts` を `tsx` で動かす自前の script（自前の `assert`）。試験の枠組みや新しい依存は足さない。
- 型検査は `npx tsc --noEmit`（strict）。build は `npm run build`（`dist/` を作る。hook の試験の一部は `dist/` を起動する）。
- 試験の Store は SQLite か JSON の file にし、`HOME` を一時の folder にして動かす。本番の PostgreSQL には触らない。PostgreSQL の試験（`npm run test:pg`）は CI に無く、この取り組みは表の作りを変えないので動かさない。動かす必要が出たら、手元の使い捨ての DB で動かして PR に結果を載せる（team.md の Testing Posture）。

## この取り組みの試験の命令（この取り組みの file だけを動かす）

この取り組みの試験の code は、全部、設計監査の PASS と作者の受領の後に書く（arc の訂正、Owner の委任 #49 6762288830。前の版は見張りの試験だけを PASS の後としていたが、社内の決まり aidlc-only §2 に合わせて全部に直した）。

成功の場面の試験（Step 4。実装の前に動かして失敗を確かめ、実装の後に通ることを確かめる）:

```bash
HOME=$(mktemp -d) npx tsx src/test-session-rotation-scenario.ts
```

要件ごとの試験（Step 12。作った file。どれも `package.json` の既存の npm script に入っていて CI で回る）:

```bash
HOME=$(mktemp -d) npx tsx src/test-session-rotation-core.ts        # FR1（量の測り）・FR3.2（席の文の取り出し）・FR7.2・FR7.3・state file の形・uid の取り方（21 cases）
HOME=$(mktemp -d) npx tsx src/test-session-rotation-flow.ts        # FR1/FR2 の判定・FR3・FR4.1・FR6・FR7.1、内部期限（NFR1）、transcript の帰属（FR8）、回復の文の上限（FR6.4）、hook の command を別 process で起動する場合、標準入力の読みを含む内部期限（47 cases。Step 16 の hook の入力の直しを含む）
HOME=$(mktemp -d) npx tsx src/test-rotation-hook-registration.ts   # FR2.2・installer の引数と戻し、印の無い compact の決まった文（FR7.1）（13 cases）
HOME=$(mktemp -d) npx tsx src/test-session-rotation-status.ts      # FR4.2 の状態表示と hook_input の節（17 cases）
HOME=$(mktemp -d) npx tsx src/test-claude-transcript-identity.ts   # FR8 の身元の規則 R1〜R9・冪等・3 値の受領（25 cases）
```

`npm run test:session-rotation` は core・flow・hook-registration・status・watcher-units・watcher-flow・scenario を順に流す。`test:claude-hook` の最後がこれを呼び、`test:automatic-receive` が身元の試験を呼ぶ。

見張りの試験（Step 14。設計監査の PASS と作者の受領の後に作った。中身は見張りの設計の記録の版 4 の 13 のとおり: 観測の後の変化で起動し直しが実行されない=F1、入力欄の証明・人の入力の観測、結び（同じ shell の下の別の CLI・起動の command・起動の script の SHA-256・host の起動時刻）=F2、排他の取得と各段の停止、同じ観測の 2 回目の拒否=F3、帳面の旧 session_id=F4、実行できる tmux の命令が閉じた集合だけ（`send-keys` 系が 0 件）と SSOT-6 §9 の差分なし=F5。記録した tmux の呼び出しを全部照らす。単体の試験は本物の tmux を使わない）:

```bash
HOME=$(mktemp -d) npx tsx src/test-rotation-watcher-units.ts   # 設定・画面・tmux・ps・核・帳面の読み取り（83 cases）
HOME=$(mktemp -d) npx tsx src/test-rotation-watcher-flow.ts    # 一度だけ・確認・帳面・HALT・閉じた命令の集合、読めない帳面、確認の記録の失敗、止まる印を返した席の後を回さない（103 cases）
```

1 回目の実装監査（BLOCK、F1〜F6）への直しの試験は、指摘の反例ごとに足した: F1（総予算を超える Store の開始・保存・close）・F2（印の無い compact、Claude と Codex）・F3（回復の文の上限、切り詰めの印を含む）・F4（読めない帳面・照会で確認した起動し直しの回数）・F5（確認の記録の失敗を `confirmed` にしない）・F6（別の会話の transcript から保存しない）。直す前の code で落ちる所を実際に流して残したのは F1・F3・F6 だけ（flow の試験が 1 件・7 件落ちた）。F2・F4・F5 は、直す前に落ちたことの記録を残していない。

2 回目の実装監査（BLOCK、F1・F5 の 2 件）への直しの試験は、直す前に書いて落ちることを確かめた:

- F1（Stop の hook の標準入力の読みが内部期限の外）: flow に 4 件。閉じない標準入力は内部期限で諦めて PASS と理由 `internal_deadline_exceeded`（鍵も印も出さない）／期限の後に届いた入力は使わず何も保存しない／読みに使った時間が同じ予算から引かれる（読み 600 ms + 予算 1,000 ms で 1,300 ms 未満。2 つ目の予算なら約 1,600 ms になる）／実際の command を別 process で起動して標準入力を開けたままにすると自分で終わる（終了コード 0）。直す前の code では、閉じない入力の単体の場合が決着せず、file 全体が終了コード 13 で終わった。前回 push した code（`f30c8ffd…`）で流すと、F1 の残り 3 件は 3 件とも落ちた: 期限の後に届いた入力を使ってしまい（理由が `unmeasured:usage_field_missing`）、読みに使った時間が予算から引かれず 1,602 ms かかり（予算は 1,000 ms）、別 process で起動した hook は 20 秒待っても終わらなかった。
- F5（止まる印を返した席の後も回す）: watcher-flow に 3 件（`src/test-rotation-watcher-world.ts` に 2 席目を足す `addSeat`）。同じ pass で後の席を回さない／loop が止まり pass の一覧が回した席だけ／`once` が止まった席で終わり終了コード 4。直す前の code で 3 件とも落ちた。

`src/test-rotation-watcher-world.ts` は上の 2 つが使う、差し替えの tmux・ps・file の世界（試験の道具で、単独では動かさない）。見張りの正例の確かめ（本物の tmux、使い捨ての server、自分の socket）は手元で行い、結果を `code-summary.md` に書いた。この確かめは CI に入れていない。

## 新しい試行（Step 16、hook の入力の parser）の試験

試験の code は、設計の記録だけの PR の設計監査が PASS し、作者の受領が RECEIPT_ACCEPTED になった後に書く。試験だけの commit を実装の前に作り、直す前の code で落ちることを確かめて出力を記録する。下の `src/test-hook-input.ts`・`src/test-hook-input-diagnostics.ts`・`src/test-hook-node-path.ts` は Step 16.8 の試験だけの commit（`ea19ca16`）で作り、Step 16.9 の実装の commit で全部通した。命令は、`HOME` と `AGENT_MEMORY_HOME` の両方を一時の folder にして動かす（診断の記録がこの Mac の実際の置き場に行を書かないように。project の決まり）。

```bash
HOME=$(mktemp -d) AGENT_MEMORY_HOME=$(mktemp -d) npx tsx src/test-hook-input.ts              # FR10.1・FR10.2: 共通の parser。2.1.321 の実物の key の形の正例（SessionStart・UserPromptSubmit・Stop）、必須の欠け・型の違い・64 KiB 超・JSON でない・配列は拒否の負例、知らない key の値を読まない・残さない
HOME=$(mktemp -d) AGENT_MEMORY_HOME=$(mktemp -d) npx tsx src/test-hook-input-diagnostics.ts  # FR10.3・FR10.4・FR10.5: 診断の記録。名前だけ・安全な文字だけ・64 字・32 個・古い物から捨てる、0700/0600・一時 file + rename、書けない時に hook の答えと証拠が変わらない、壊れた file を読むと「観測できず」、診断の記録に host の版の欄が無い（観測した版は health check が `claude --version` で取る手順で、試験の対象ではなく Deployment Execution の記録で確かめる）、時間の予算（実時間で測る: 遅い書き手・host の残りを超える遅れ・戻らない書き手でも答えの書き込みから 180 ms 以上 1000 ms 未満で終了、速い書き手は完了時に終了、残りが 2000 ms 未満と予算切れで書き手が呼ばれない・境界 2000 ms は呼ぶ／1999 ms は呼ばない、出力の bytes が診断なしと同じ、書き手の例外、証拠と答えの書き込みの後に書き手が呼ばれる。書き手と exit は注入、経過は実際の時計、実際の遅い disk は使わない）
HOME=$(mktemp -d) AGENT_MEMORY_HOME=$(mktemp -d) npx tsx src/test-hook-node-path.ts          # FR10.7: `--node-path` の規則。絶対・正規化済み・basename がちょうど node・実行できる通常 file だけ受け入れ、相対・NUL・親の区間・nodejs などの別名・無い物・folder・実行できない file は拒否、symlink は許可
```

設計監査の指摘（1 回目 F1〜F3、2 回目 F2 の未解消部分・F5）に対応する試験:
- F1: 入口・項目ごとの現行の挙動の固定（設計の記録 3 節の表）。SessionStart の `model: null`・違う `permission_mode`・空の `agent_type` は `MALFORMED_HOOK_INPUT`。取り込みの Stop／UserPromptSubmit（Claude と Codex）と切り直しの Stop は、`model: null`・`permission_mode: "invalid-mode"`・`stop_hook_active: "yes"`・`last_assistant_message: 42`・`agent_id: null`・`agent_type: false`・`prompt: []`・`turn_id: {}` を 1 つずつ足した入力を受理し、返す値にその項目が入らない。この固定は直す前の code でも通る（挙動を変えていないことの回帰の防ぎ）ので、Red の確認の対象ではなく、直した後も通ることを確かめる。
- F2: 上の `test-hook-input-diagnostics.ts` の時間の予算。共有の `finishAfterAnswer` の単体と、入口 3 つ（SessionStart・取り込みの Stop・切り直しの Stop）のそれぞれで、遅い書き手（3000 ms）・host の残りを超える遅れ（4500 ms）・戻らない書き手が答えの書き込みから約 200 ms で終了すること、速い書き手が完了時に終了すること、予算切れ・境界、出力の bytes の不変を、実時間で確かめる。取り込みの Stop は書き込みの callback と明示の終了を足すので、その出力と終了コードが今と同じであることも確かめる（入口の層の試験は、既存の `src/test-claude-session-start.ts`・`src/test-transcript-stop-capture.ts`・`src/test-session-rotation-flow.ts` に足す）。
- 診断の配線: 入口 3 つ（取り込みと切り直しは Claude と Codex）のそれぞれで、知らない key を足した受理される入力から、その入口の adapter id の診断の file に名前と件数が書かれ、拒否される入力では書かれない。入口 3 つとも `on_ignored_names` は、渡した時だけ parse の受理の直後に 1 回呼ばれ（拒否と、SessionStart の `proxyForInputError` の経路では呼ばれず）、渡さない呼び出し元の戻り値は変わらない。切り直しの Stop は `request_diagnostic` が答えと証拠の書き込みの前に呼ばれても、書き手の呼び出しは flush の callback の後であることを、書き込みの callback を遅らせて確かめる。床の境界（2000／1999 ms）は `finishAfterAnswer` の単体で、入口ごとは時計を注入した予算切れと余裕ありの 2 点。`Deadline.remaining_ms` は `cancel()` の後でも値を返す。SessionStart の binding の不正の N+U は直す前でも通る（Red から除く）。`parseClaudeSessionStartInputWithIgnored`・`parseTranscriptStopInputWithIgnored` の `input` が、元の関数の戻り値と同じ（`src/test-claude-session-start.ts`・`src/test-transcript-stop-capture.ts`・`src/test-session-rotation-flow.ts` に足す）。
- F3: installer の試験（`src/test-claude-hook-installer.ts`・`src/test-codex-hook-installer.ts`）に、`nodejs` の名前の symlink の拒否（設定を書かない）、`node` の名前の symlink の許可、3 つの command が同じ node、別名の symlink での入れ直しと同じ指定の再実行で管理中の hook が 1 つ（冪等）、古い installer が書いた任意の絶対 path の SessionStart の hook の置き換え、相対 path・adapter id の違い・flag の並びの違いは管理外、を足す。`parseClaudeHookCommand` の既定の結果と `src/kusabi-fleet-rollout.ts` の試験が今のまま通ることも確かめる。あわせて、先頭の node が `process.execPath` と違う SessionStart の hook を、`parseClaudeHookCommand`・`parseCodexHookCommand` の既定が今までどおり `null` にすること（`--node-path` で入れた別の node の hook が rollout の読み戻しと監査に数えられず、安全側に失敗する形を変えていないこと。設計 8 節・12 節）を固定する。

入口 3 つが同じ parser を通ること（FR10.1）と、反転する既存の負例は、既存の試験の file の中で確かめる（`src/test-claude-session-start.ts`・`src/test-transcript-stop-capture.ts`・`src/test-session-rotation-flow.ts`。`unexpected: true` を拒否していた所は、受理に変わる。1 件ずつ deviation_ledger に「採った判断・採らなかった代替」を書く）。必須の入口の一覧（FR10.6）は `node scripts/test-kusabi-content-addressed-runtime-release.mjs` と `src/test-kusabi-direct-fleet-rollout.ts`、installer の `--node-path`（FR10.7）は `npm run test:claude-hook` と `npm run test:codex-hook` の installer の試験で確かめる。新しい 3 file（`src/test-hook-input.ts`・`src/test-hook-input-diagnostics.ts`・`src/test-hook-node-path.ts`）は `package.json` の `test:claude-hook` の後ろに足して CI で回す（workflow は変えない）。

arc-sec が実装の時に見る 2 点（公開。iyasaka-arc#57 の comment 6792778481、本文の SHA-256 `683847414d37520993afd8de29dced0a4335822d7fe97c6b329039038266bcd6`。arc-sec の設計の読みは止める点 0、devauditor の verdict の代わりではない）を、次の試験と自己点検に必ず入れる:

1. 共有の parser が、入口ごとの型・event・source・身元（FR8.4 の R1〜R9・`verifyBinding`）の確かめを落とさず、知らない key の値を下流に出さない。
   - 3 つの入口（Claude の SessionStart、取り込みの Stop／UserPromptSubmit、切り直しの Stop／UserPromptSubmit。取り込みは Claude と Codex の両方）のそれぞれで、確かめを 1 つずつ失敗させる入力 N（型の違い・`hook_event_name` の違い・`source` の違い・`cwd` が workspace の外・`transcript_path` が置き場の外・binding の不一致。身元の N は入口ごとに今ある規則から選び、Claude の取り込み・切り直しの Stop には cwd の外の拒否が無い = FR8 R1 のまま足さない）に、知らない key U（値は他に現れない目印の文字列）を足した N+U を流し、**N+U の結果が、U を除いた N の結果と同じ**であることを確かめる（差分の oracle。設計の記録 3 節・9 節）。N の理由は U を含まない入力で固定し、U を含む入力に「今までの理由コード」を期待しない（知らない key があっても身元の拒否が受理に変わらず、本来の理由で拒否される）。
   - 受理される入力（知らない key を足しただけ）では、目印の文字列が、返す値・証拠（stdout／stderr の JSON）・hook の答え・診断の file・store の書き込みのどこにも現れない。
2. 反転する既存の負例が、身元の負例を巻き込んでいない。反転するのは「許可リスト外 = `MALFORMED_HOOK_INPUT`」の物だけ（`src/test-claude-session-start.ts` の 211 行と 240 行の `unexpected: true` の 2 件）。試験だけの commit の差分で、既存の試験 file から消える・弱まる確かめがこの 2 件の許可リスト外の確かめだけであり、身元の負例（`cwd` が workspace の外、`transcript_path`、binding、wrong source、必須の欠け、型の違い、64 KiB 超）が 1 件も変わらないことを、差分を 1 行ずつ読んで自己点検に書く。

触る所の今の試験（通ったまま保つ。Step 1 で基準を取る）:

```bash
npx tsx src/test-transcript-stop-capture.ts
npm run test:claude-hook
npm run test:codex-hook
npm run test:automatic-receive
HOME=$(mktemp -d) npx tsx src/test-boot-recovery.ts
HOME=$(mktemp -d) npx tsx src/test-post-tool-hook.ts
HOME=$(mktemp -d) npx tsx tests/gate0/migration-idempotency.ts
```

CI で回すために、新しい試験の file を、CI が呼ぶ npm の script（`test:claude-hook`・`test:codex-hook`・`test:automatic-receive` など）の後ろに足す。workflow の file（`.github/workflows/ci.yml`）は変えない。

## 新しい試行（Step 17、引き継ぎの確定の順番）の試験

試験の code は、設計の記録だけの PR の設計監査が PASS し、作者の受領が RECEIPT_ACCEPTED になった後に書く。試験だけの commit を実装の前に作り、今の code で落ちることを確かめて出力を PR の本文に載せる（T1〜T6 は今の code では束が先に消費されるので落ちる。T7〜T9 は今の動きの固定で、通るものは通る理由を書く）。試験の file 名と npm script への入れ方は下書き（実装の時に `test:session-rotation` に足す）。

```bash
HOME=$(mktemp -d) AGENT_MEMORY_HOME=$(mktemp -d) npx tsx src/test-handoff-commit-order.ts   # FR11.1〜FR11.5: T1〜T9（下の表）
```

| ID | 場面 | 期待 | 要件 |
|---|---|---|---|
| T1 | `loadRestartPackData` が例外を投げる | 束は `active` のまま、`turn` の `rotation_marker_id` は null、degraded の出力 | FR11.1 |
| T2 | 回復の読み込みが期限（`RECOVERY_TIMEOUT`）を超える | 同上。期限の後に消費されない | FR11.1 |
| T3 | 出力の書き込みの callback が誤りを返す | 確定は呼ばれない。束は `active` | FR11.1 |
| T4 | 通常の起動 | 出力の書き込みの後に束が `consumed`、その後に `turn` へ `rotation_marker_id`。順序（出力 → 消費 → 印）を記録で確かめる。出力の bytes は今までと同じ | FR11.1・FR11.2 |
| T5 | 確定の中で消費が競り負け（null） | `rotation_marker_id` は書かれない。例外にならない | FR11.3 |
| T6 | 確定が上限（1.5 秒）を超える | 席の出力に影響なし。束は `active` のまま、印なし | FR11.3 |
| T7 | 確定の失敗の後の次の起動 | `clear`／`compact` で marker が期限内・pane 一致なら同じ文を受け取る。期限外・pane 不一致・`startup`（claim が `respawning` でない）では受け取らない | FR11.3 |
| T8 | 見張りが `rotation_marker_id` なしの `turn` を見る | 確認済みとは読まない。確認の待ちを過ぎると claim が `unconfirmed`、席に HALT（`unconfirmed`）、2 度目の respawn なし | FR11.3 |
| T9 | 同じ束に旧い hook と新しい hook を流す | 1 度だけ効く | FR11.5 |

Claude と Codex の両方の process 層について T1・T3・T4 を流す（FR11.4）。PostgreSQL の試験は手元の使い捨て DB（`project.md` の決まり: socket を切る・`lc_messages=C`・一時の HOME）。既存の `test:session-rotation`・`test:claude-hook` は通ったままにする。

## 基準（Step 1、main `17676d84`、Node v26.12.1、2026-11-11）

| 命令 | main の結果 |
|---|---|
| `npx tsc --noEmit` | 0 で終わる |
| `npm run build` | 0 で終わる |
| `npx tsx src/test-transcript-stop-capture.ts` | 0、「transcript stop capture tests passed」 |
| `npm run test:claude-hook` | 0、「Claude SessionStart tests passed」「claude hook installer tests passed」 |
| `npm run test:codex-hook` | 0、「codex native SessionStart adapter tests passed」「codex native hook installer tests passed」 |
| `npm run test:automatic-receive` | 0、「SessionStart bounded auto-receive tests passed」 |
| `HOME=$(mktemp -d) npx tsx src/test-boot-recovery.ts` | 0、「28 passed, 0 failed」 |
| `HOME=$(mktemp -d) npx tsx src/test-post-tool-hook.ts` | 0 |

## 網羅率

- 床: 変えた行と新しい行の網羅率 100%（team.md）。
- 測り方（作る時に採った形）: Node に組み込みの `NODE_V8_COVERAGE` を、変えた file を読む試験の命令（上の試験と `test:claude-hook`・`test:codex-hook`・`test:gemini-hook`・`test:gemini-conversation-ingest`・`test:antigravity-hook`・`test:automatic-receive`・`test:transcript-stop`・core・SQLite 付きの post-tool-hook・boot recovery）の全部につけて動かし、process をまたいで 0 回の範囲を足し合わせ、新しい module は全部の行、触った file は base から足した行と重ねる。新しい依存は足さない。V8 の範囲は分岐の腕も数えるので行の網羅率より厳しい。子 process として起動する hook の command の分も集まる。測った Node の版を記録する（Node の版で数え方が少し違いうる）。
- 計画の時に書いた `node --test --experimental-test-coverage --test-reporter=lcov` を file ごとに足す形は使わなかった（`code-summary.md` の「計画からの外れ」に採った判断と採らなかった案を書く）。
- 届かない行は数えから外さず、理由を `code-summary.md` と PR に書いて、独立の監査で見る。
- post-tool-hook の試験は `DATABASE_URL` が無いと 0 で先に終わる（main でも同じ）ので、網羅率の時だけ `AGENT_MEMORY_DB_TYPE=sqlite` を足す。

## 差し替えと見本の扱い

- 時刻・乱数・識別子は、試験から渡す（標準 S4）。今の module の `dependencies` 引数（`now`・`createStore`・`loadRecovery` など）の形に合わせる。
- transcript の見本は、試験の中で一時の file に書く。Claude Code は usage を持つ assistant の行、Codex は `token_count` の行（`last_token_usage`）を持つ rollout の行で作る。量が閾値の下・上・usage 無しの 3 種を作る。
- 見張りの tmux の呼び出し（読むだけの物と、条件つきの起動し直し）は、差し替えられる executor にし、試験では本物の tmux を使わず、呼び出しの引数の列を全部記録する偽物で確かめる（`send-keys` 系は 0 件）。
- 秘密の値（DB の URL など）は見本に入れず、証拠や log に出ないことを確かめる。

## 期待する網羅の内訳

- 試験の数（作った後）: 成功の場面 1 file（Claude Code と Codex の 2 つの流れ）、要件ごとの試験 5 file（core 21・flow 47・hook-registration 13・status 17・身元 25。Step 16 の後の数。流して確かめた）、見張り 2 file（units 83・flow 103）。
- 各試験は、正しい場合と、2 つ以上の誤りや境目の場合（usage 無し・閾値ちょうど・文が取れない・束が無い・用意の失敗など）を持つ。
