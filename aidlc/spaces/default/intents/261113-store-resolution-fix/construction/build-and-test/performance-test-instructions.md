# 性能の試験の手順 — Build and Test（取り組み 261113-store-resolution-fix）

この文書は、この取り組みが性能の試験を流さないことと、その理由を書く。手順の元は `code-generation-plan.md`、作った物は `code-summary.md`、単体の命令は `unit-test-instructions.md` にある。

## 1. 判定: 性能の試験は対象外（N/A）

- `requirements.md` に、性能の数値の要件（応答時間・件数あたりの時間・資源の上限）は無い。時間に関わる要件は NFR4 の 1 つで、「Stop の hook が持つ時間の上限（今の内部の締め切り）を変えない。決める処理は手元の file を 1 つ読むだけで、通信をしない。」という、変えないことの要件。
- そのため、新しく性能を測る試験は作っていない。試験に所要時間の上限を新しく置くことも、していない。
- この段で流した試験の秒数（`test-results.md` の表の「秒」）は、試験の実行にかかった時間で、hook の応答時間ではない。性能の根拠には使わない。

## 2. 代わりに確かめたこと（NFR4。機械で、この段に取り直した）

| 確かめ | 命令 | 結果 |
|---|---|---|
| 時間の上限の定義の file が差分に無い | `git diff --name-only 27d7f8f fa9f3a2f -- src \| grep -c '^src/constants\.ts$'` | 0 件 |
| 時間に関わる語（timeout・期限を表す識別子・AbortSignal・`_ms` など）を含む追加・削除行のうち、試験でない file の分 | `git diff -U0` を file ごとに数えた | 8 行（src/kusabi-runtime-event-emitter.ts 6件・src/session-rotation-stop.ts 2件）。中身は、`openStore`・`resolution` を引数で渡す形への書き換えで、数値の定数も timer も増減していない |
| 決める処理に通信が無い | `src/store-resolution.ts` の `import` の一覧と、`net`・`http`・`https`・`dns`・`tls`・`dgram`・`fetch(`・`WebSocket` の出現 | import は node:crypto node:fs node:os node:path node:util。出現 0 件 |
| 決める処理が読む物 | 同 file の読み取り | 設定 file 1 つを `lstatSync`・`readFileSync` で読むだけ（`homedir()` は経路を作るためだけ） |

`test-store-resolution-scenario.ts` の S6 は、別の接続先への接続が 0 件であることを、接続を数える listener で見る。これは性能ではなく、不要な接続を作らないことの確かめで、結果は `integration-test-instructions.md` の 2。

## 3. 測っていないこと（持ち主なし。要件が無いので記録だけ）

- Stop の hook 全体の応答時間（変更の前後の比べ）は測っていない。NFR4 が求めるのは「上限を変えない」ことと「通信をしない」ことで、上の確かめで足りると読んだ（根拠: 上限の定義の file が差分に無く、決める処理に通信が無い）。
- 席の実機の hook の遅延は、Deployment Execution の観測（回転の確かめ（b））に出れば読むが、数値の合格の線は無い。
- 性能の要件を後から決めるなら、それは Owner の判断（測度の変更に当たる）。この取り組みでは足していない。
