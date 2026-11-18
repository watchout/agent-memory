# 横断の追跡 — Build and Test（取り組み 261113-store-resolution-fix）

段の手順の Step 10（Cross-Unit Final Coverage Gate）の結果。`aidlc engine sensor-traceability --stage build-and-test` の出力（2026-11-17 に流した。1 回目と 2 回目の出力は同じ）を元に書き、各 ID を、この段で通った試験の組に結んだ。手順の元は `code-generation-plan.md`、作った物は `code-summary.md`、単体の命令は `unit-test-instructions.md` にある。

## 1. 判定

- **判定: PASS**（`pass: true`）。追跡した要件・受け入れ基準は 42 件。`covered: true` が 42 件、`uncovered` は 0 件。
- この取り組みは scope `bugfix` で単位（Unit）が無い。「作った段」の欄は、この取り組みの要件の全部を `code-generation` が作ったことを表す（単位が無いので、単位の欄は置かない）。
- 「この段の確かめ」の欄の行（`BT-xx`）は、`build-and-test-summary.md` の `## Target Verification Matrix` の行。試験の組の名前（`S1`・`U7` など）は、`code-generation-plan.md` の試験の表の ID で、各組の `ok - ` の行の数は 3 の表に書いた。「計画の試験の組」の列は、計画の試験の表の「参照」の列を機械で引いた物で、手で結んでいない。「—」は、計画の表に直接の参照が無い要件（`BT` の行の確かめで見た）。

## 2. 要件ごとの追跡

| 要件 | 作った段 | 作った file（センサーの出力） | この段の確かめ | 計画の試験の組（`code-generation-plan.md` の参照の列） |
|---|---|---|---|---|
| FR1.1 | code-generation | `src/store-resolution.ts` | BT-04・BT-12 | U1 |
| FR1.2 | code-generation | `src/store-resolution.ts` | BT-04 | U1 |
| FR1.3 | code-generation | `src/store-resolution.ts` | BT-04・BT-11 | U2・U4 |
| FR1.4 | code-generation | `src/store-resolution.ts` | BT-04・BT-14 | S1・U2 |
| FR1.5 | code-generation | `src/store-resolution.ts` | BT-04 | — |
| FR1.6 | code-generation | `src/store-resolution.ts` | BT-04 | — |
| FR2.1 | code-generation | `src/codex-session-start.ts` | BT-04 | U6 |
| FR2.2 | code-generation | `src/session-rotation-stop.ts` | BT-04 | — |
| FR2.3 | code-generation | `src/rotation-commit.ts` | BT-04 | U8 |
| FR2.4 | code-generation | `src/restart-cli.ts` | BT-04・BT-05 | S2・U9 |
| FR2.5 | code-generation | `src/stores/index.ts` | BT-04 | U5 |
| FR7 | code-generation | `src/test-store-resolution.ts` | BT-12 | — |
| FR2.6 | code-generation | `src/test-store-resolution-scenario.ts` | BT-04 | S3 |
| FR3.1 | code-generation | `src/store-resolution.ts` | BT-04・BT-14 | — |
| FR3.2 | code-generation | `src/transcript-stop-capture.ts` | BT-04・BT-14 | U7 |
| FR3.3 | code-generation | `src/codex-session-start.ts` | BT-04 | U6 |
| FR3.4 | code-generation | `src/restart-cli.ts` | BT-04 | U9 |
| FR3.5 | code-generation | `src/stores/index.ts` | BT-04・BT-14 | U5・U7 |
| FR4.1 | code-generation | `src/session-rotation-stop.ts` | BT-04 | U7 |
| FR4.2 | code-generation | `src/transcript-stop-capture.ts` | BT-04 | U7 |
| FR4.3 | code-generation | `src/test-store-resolution-scenario.ts` | BT-04・BT-11 | U7 |
| FR4.4 | code-generation | `src/session-rotation-stop.ts` | BT-15 | U7 |
| FR5.1 | code-generation | `src/test-store-resolution-scenario.ts` | BT-04 | S3 |
| FR5.2 | code-generation | `src/test-store-resolution-scenario.ts` | BT-04 | S1 |
| FR5.3 | code-generation | `src/test-store-resolution-scenario.ts` | BT-04 | S4 |
| FR5.4 | code-generation | `src/test-store-resolution.ts` | BT-04 | U2 |
| FR5.5 | code-generation | `src/test-store-resolution-pg.ts` | BT-05 | S2 |
| FR5.6 | code-generation | `(記録) unit-test-instructions.md` | BT-06 | S1 |
| FR5.7 | code-generation | `src/test-store-resolution-isolation.ts` | BT-07 | — |
| FR5.8 | code-generation | `(記録) unit-test-instructions.md` | BT-08 | U13 |
| FR6.1 | code-generation | `src/test-store-resolution-pg.ts` | BT-10・BT-05 | U12 |
| FR6.2 | code-generation | `src/test-store-resolution-sql.ts` | BT-05 | U12 |
| FR6.3 | code-generation | `(記録) unit-test-instructions.md` | BT-10 | — |
| NFR1 | code-generation | `src/store-resolution.ts` | BT-11 | U4 |
| NFR2 | code-generation | `src/store-resolution.ts` | BT-12・BT-14 | — |
| NFR3 | code-generation | `src/test-store-resolution.ts` | BT-12 | U11 |
| NFR4 | code-generation | `src/store-resolution.ts` | BT-13 | — |
| NFR5 | code-generation | `src/transcript-stop-capture.ts` | BT-14 | — |
| NFR6 | code-generation | `(記録) coverage-method.md` | BT-09 | U14 |
| NFR7 | code-generation | `src/session-rotation-stop.ts` | BT-15 | — |
| NFR8 | code-generation | `src/test-store-resolution-scenario.ts` | BT-16 | U13・E1・C1 |
| NFR9 | code-generation | `package.json` | BT-17 | — |

## 3. 試験の組ごとの `ok - ` の行の数（この段に流した出力から数えた）

| 組 | 行の数 | 組 | 行の数 |
|---|---|---|---|
| S1 | 4 | S2 | 3 |
| S3 | 9 | S4 | 7 |
| S5 | 1 | S6 | 5 |
| U1 | 16 | U1/U2 | 17 |
| U2 | 1 | U3 | 2 |
| U4 | 1 | U5 | 9 |
| U6 | 10 | U7 | 4 |
| U8 | 4 | U9 | 2 |
| U10 | 2 | U11 | 2 |
| U12 | 1 | U13 | 1 |
| seam | 1 | isolation | 9 |

4 つの新しい試験の `ok - ` の行は合計 111（`test-store-resolution.ts` 57・`-scenario` 40・`-isolation` 9・`-pg` 5）。`U1/U2` は、`U1` の表と `U2` の拒否の組を同時に確かめる行（拒否 17 件）。

## 4. 未対応の要素

なし（`uncovered: []`）。計画の試験の組が「—」の要件（12 件: FR1.5・FR1.6・FR2.2・FR7・FR3.1・FR5.7・FR6.3・NFR2・NFR4・NFR5・NFR7・NFR9）は、計画の表に直接の参照が無く、`BT` の行の確かめで見た。計画の組のうち `ok - ` の行の組でない物（C1・E1・U14）は、網羅率・CI・機械の確かめで見た。
