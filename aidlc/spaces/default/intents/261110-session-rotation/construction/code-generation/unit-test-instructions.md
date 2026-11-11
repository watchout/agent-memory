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

要件ごとの試験（Step 12。file の名前は作る時に決め、ここに足す）:

```bash
HOME=$(mktemp -d) npx tsx src/test-session-rotation-usage.ts
HOME=$(mktemp -d) npx tsx src/test-session-rotation-stop.ts
HOME=$(mktemp -d) npx tsx src/test-session-rotation-start.ts
HOME=$(mktemp -d) npx tsx src/test-mcp-store-readiness.ts
HOME=$(mktemp -d) npx tsx src/test-conversation-capture-repair.ts
```

見張りの試験（Step 14。設計監査の PASS の後に作る。中身は見張りの設計の記録の版 2 の 12 のとおり: 入力欄の読み戻し=F1、席と画面の結び=F2、排他の取得と各段の停止=F3、帳面の旧 session_id=F4、打てる文字列と SSOT-6 §9 の差分なし=F5。本物の tmux は使わない）:

```bash
HOME=$(mktemp -d) npx tsx src/test-rotation-watcher.ts
```

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
- 測り方: Node に組み込みの網羅率。新しい依存は足さない。

```bash
HOME=$(mktemp -d) node --test --experimental-test-coverage --test-reporter=lcov --test-reporter-destination=<一時の file> --import tsx src/test-session-rotation-scenario.ts
```

  上の命令を、この取り組みの試験の file ごとに流し、lcov を行ごとに足し合わせる。新しい module は全部の行、触った file は変えた行を見る。測った Node の版を記録する（Node の版で数え方が少し違いうる）。
- 届かない行は数えから外さず、理由を `code-summary.md` と PR に書いて、独立の監査で見る。

## 差し替えと見本の扱い

- 時刻・乱数・識別子は、試験から渡す（標準 S4）。今の module の `dependencies` 引数（`now`・`createStore`・`loadRecovery` など）の形に合わせる。
- transcript の見本は、試験の中で一時の file に書く。Claude Code は usage を持つ assistant の行、Codex は `token_count` の行（`last_token_usage`）を持つ rollout の行で作る。量が閾値の下・上・usage 無しの 3 種を作る。
- 見張りの画面への打ち込みは、差し替えられる executor にし、試験では本物の tmux を使わず、打った文字列と回数を記録する偽物で確かめる。
- 秘密の値（DB の URL など）は見本に入れず、証拠や log に出ないことを確かめる。

## 期待する網羅の内訳

- 試験の数の目安: 成功の場面 1 file（Claude Code と Codex の 2 つの流れ）、要件ごとに 1 つ以上（FR1〜FR8 で約 15）、見張り 7 つ。
- 各試験は、正しい場合と、2 つ以上の誤りや境目の場合（usage 無し・閾値ちょうど・文が取れない・束が無い・用意の失敗など）を持つ。
