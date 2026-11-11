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
HOME=$(mktemp -d) npx tsx src/test-session-rotation-flow.ts        # FR1/FR2 の判定・FR3・FR4.1・FR6・FR7.1、内部期限（NFR1）、transcript の帰属（FR8）、回復の文の上限（FR6.4）、hook の command を別 process で起動する場合、標準入力の読みを含む内部期限（40 cases）
HOME=$(mktemp -d) npx tsx src/test-rotation-hook-registration.ts   # FR2.2・installer の引数と戻し、印の無い compact の決まった文（FR7.1）（12 cases）
HOME=$(mktemp -d) npx tsx src/test-session-rotation-status.ts      # FR4.2 の状態表示（8 cases）
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

試験の code は、設計の記録だけの PR の設計監査が PASS し、作者の受領が RECEIPT_ACCEPTED になった後に書く。試験だけの commit を実装の前に作り、直す前の code で落ちることを確かめて出力を記録する。下の 2 file は、今は無い（Step 16.8 で作る）。命令は、`HOME` と `AGENT_MEMORY_HOME` の両方を一時の folder にして動かす（診断の記録がこの Mac の実際の置き場に行を書かないように。project の決まり）。

```bash
HOME=$(mktemp -d) AGENT_MEMORY_HOME=$(mktemp -d) npx tsx src/test-hook-input.ts              # FR10.1・FR10.2: 共通の parser。2.1.321 の実物の key の形の正例（SessionStart・UserPromptSubmit・Stop）、必須の欠け・型の違い・64 KiB 超・JSON でない・配列は拒否の負例、知らない key の値を読まない・残さない
HOME=$(mktemp -d) AGENT_MEMORY_HOME=$(mktemp -d) npx tsx src/test-hook-input-diagnostics.ts  # FR10.3・FR10.4・FR10.5: 診断の記録。名前だけ・安全な文字だけ・64 字・32 個・古い物から捨てる、0700/0600・一時 file + rename、書けない時に hook の答えと証拠が変わらない、壊れた file を読むと「観測できず」、観測した host の版は診断にだけ出る
```

入口 3 つが同じ parser を通ること（FR10.1）と、反転する既存の負例は、既存の試験の file の中で確かめる（`src/test-claude-session-start.ts`・`src/test-transcript-stop-capture.ts`・`src/test-session-rotation-flow.ts`。`unexpected: true` を拒否していた所は、受理に変わる。1 件ずつ deviation_ledger に「採った判断・採らなかった代替」を書く）。必須の入口の一覧（FR10.6）は `node scripts/test-kusabi-content-addressed-runtime-release.mjs` と `src/test-kusabi-direct-fleet-rollout.ts`、installer の `--node-path`（FR10.7）は `npm run test:claude-hook` と `npm run test:codex-hook` の installer の試験で確かめる。新しい 2 file は `package.json` の `test:claude-hook` の後ろに足して CI で回す（workflow は変えない）。

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

- 試験の数（作った後）: 成功の場面 1 file（Claude Code と Codex の 2 つの流れ）、要件ごとの試験 5 file（core 21・flow 40・hook-registration 12・status 8・身元 25）、見張り 2 file（units 83・flow 103）。
- 各試験は、正しい場合と、2 つ以上の誤りや境目の場合（usage 無し・閾値ちょうど・文が取れない・束が無い・用意の失敗など）を持つ。
