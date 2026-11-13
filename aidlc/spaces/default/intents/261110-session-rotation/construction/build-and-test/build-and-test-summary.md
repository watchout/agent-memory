# 作りと試験のまとめ — 会話の切り直し（261110-session-rotation）

## 全体

- 対象: 統合された main `94f1ca6d0042bd970d4cc7c4ab9ce9153b7d5c0d`（PR #342 の統合の commit）を、何も変えていない使い捨ての clone で流した（2026-11-12）。前回（2026-11-11）は #341 の head を流して記録した。この記録はそれを main に合わせて上書きした。
- 作り: 型検査（strict）と build は通った（終了コード 0）。**試験の file の型検査（`tsc` の対象外を別に見る確かめ）は 78 件の誤りで、3 件はこの取り組みが足した行**（残りの 75 件は取り組みの前からの行）。試験の実行と CI には影響しない。限界の 3 に書く。
- 試験: CI の命令 15 個と CI に無い 2 個の計 17 個がすべて終了コード 0（core 1832 passed ほか）。PostgreSQL の試験（手元の使い捨ての DB）も 147 passed・0 failed。失敗 0、飛ばした試験 0。
- 行の網羅率: 変えた行と新しい行 4,984 行（34 file）のうち 0 回の範囲は入口の最後の網 2 つ（5 行）だけ。4,979 行が実行された（99.90%）。
- 統合: PR #342 は head `23ddb0cf18f49b94444bf6900fca0155d93887a2` のまま、2026-11-11T22:40:24Z に統合された（統合の commit `94f1ca6d`）。統合の前に、実装監査 2 回目の PASS（23 / 23）・作者の受領・Owner の exact-head があった。統合の後の main の CI（run 43113722371）は 3 つとも success。その前の PR #341 は `aa77b683`。
- 詳しい結果は `test-results.md`、要件の行き先は `cross-unit-traceability.md`。

## 試験の種類の一覧

試験の深さは Minimal（`aidlc-state.md`）。Minimal は、この段で足す試験の手順の file を作らない。単体の試験は作る段が持つ（`construction/code-generation/unit-test-instructions.md`）。

| 種類 | この段で作ったか | 理由 |
|---|---|---|
| 作り方の手順 | 作った（`build-instructions.md`） | 常に作る |
| 結合の試験の手順 | 作らない | Minimal。切り直しの流れ（hook の command を別 process で起動する場合・成功の場面）は作る段の flow と scenario の試験が持つ |
| 性能の試験の手順 | 作らない | 性能の NFR（nfr-requirements）は無い。hook の期限（NFR1）は作る段の試験が持つ |
| 安全の試験の手順 | 作らない | Minimal。安全の NFR3（キーを送らない・秘密を出さない）は作る段の watcher flow・core・flow の試験が持つ。依存を足していないので、依存の脆弱性の確かめは対象外 |

## 単位ごとの網羅率の見込み

この取り組みは単位が 1 つ（express）。変えた行と新しい行は 4,984 行（34 file）で、実行されなかったのは 5 行（2 範囲）。内訳は `test-results.md` の表。

## Target Verification Matrix

目標の出どころ: 作る段の Testing Contract（`construction/code-generation/code-generation-plan.md`）、team.md の試験の姿勢、要件の NFR1〜NFR7（`inception/requirements-analysis/requirements.md`）。この計画に NFR の段（`nfr-requirements`・`nfr-design`）は無いので、それらの file は無い。

| Target ID | Source | Expected | Actual | Evidence | Owning Stage | Verdict |
|---|---|---|---|---|---|---|
| QT-01 | Testing Contract の scope_floor | 今ある試験が通ったまま | CI の命令 15 個と CI に無い 2 個の計 17 個がすべて終了コード 0（core 1832 passed・sqlite 206 passed・boot-recovery 28 passed・Gate 0 の 3 file 57 / 16 / 12 passed・post-tool-hook は sqlite で流して 45 passed ほか、失敗 0）。CI の post-tool-hook の工程は `DATABASE_URL` が無く何も試験しないで終わる（main の CI でも同じ、この取り組みの前から） | `test-results.md` の「試験」 | build-and-test | Met |
| QT-02 | Testing Contract の strategy_volume 1 | この build に入れた要件ごとに、試験が 1 つ以上ある | FR1〜FR8・FR9.1・FR10.1〜FR10.4・FR10.6・FR10.7・NFR1・NFR3・NFR5〜NFR7 に試験がある（切り直しの 7 file、身元の試験 25 cases、hook の入力の形・診断・node の path の 3 file、展開と版を作る道具の試験。対応は `construction/code-generation/unit-test-instructions.md` の命令の説明）。NFR2 は QT-06、NFR4 は QT-04。試験の対象にならない要件（FR5.5 は設計の正本の直し、FR10.5 は定数と注釈で `claude --version` の 1 行は配備の記録の手順、FR2.3・FR5.4・FR8.3 は N/A の理由つき）は `cross-unit-traceability.md` | `unit-test-instructions.md`、`test-results.md` | build-and-test | Met |
| QT-03 | Testing Contract の strategy_volume 2 | 部品ごとに正常系の試験が 1 つ以上ある | 変えた・足した `src/` の 34 file すべてが試験から読み込まれ（`loaded_by` が 1 以上）、正常系の経路が実行された | `test-results.md` の網羅率の表 | build-and-test | Met |
| QT-04 | team.md「網羅率」・NFR4 | 変えた行と新しい行の網羅率 100% | 4,984 行のうち 4,979 行が実行（99.90%）。実行されなかったのは `src/rotation-watcher.ts` 134〜137 行と `src/session-rotation-stop.ts` 756 行（どちらも入口の最後の網 `main().catch`）の 5 行だけ。前回は `src/session-rotation-stop.ts` 640〜642 行を含む 7 行で、#342 の Step 16.9 で入口の書き方が変わって 3 行が 1 行になった | `test-results.md` の網羅率（`coverage-method.md` の手順で再現） | build-and-test | Met（チームの決まりの除外: 「届かない行を数えから外す時は、PR に理由を書いて独立の監査で見る」。理由は PR 本文と `code-summary.md`、#341 では独立の監査 3 回目の IMP-8 が 7 行の 2 範囲を再現して PASS、#342 は 2 回目の実装監査が PASS（23 / 23）で統合された。756 行目の理由は `code-summary.md` の Step 16 の節。100% ちょうどではない） |
| QT-05 | NFR1 | Stop の hook は 9 秒の期限の中の 7 秒の内部期限で必ず返し、失敗しても席を止めない。block は 1 つの会話で最大 1 回 | flow の試験が通った（内部期限の各場合、閉じない標準入力・期限の後の入力・同じ予算・別 process の実 command。#342 で、答えを書き終えた後に診断の待ちを最大 200 ms 挟む形が加わり、その場合も同じ試験の中にある） | `test-results.md`（flow 47 cases）、`construction/code-generation/unit-test-instructions.md` | build-and-test | Met |
| QT-06 | NFR2 | 量の測りは末尾 4 MiB の読み出しと純粋な計算だけ | 6,292,440 byte の transcript から 4,193,640 文字だけ読んだ（限度 4,194,304）。読み手は今ある共有の関数で、尾の読みは今ある自動の受領の試験が通っている。新しい専用の試験は無い | `test-results.md` の「NFR2 の一回きりの測り」 | build-and-test | Met（専用の新しい試験は無く、今ある共有の試験と一回きりの測りによる。限界に書く） |
| QT-07 | NFR3 | 席の画面にキーを送らない（実行できる tmux の命令は閉じた集合）。秘密の値を引数・証拠・log に出さない | watcher flow が、実行された tmux の呼び出しの全部を閉じた集合（`send-keys` 系が 0 件）と照らして通った。core・flow・registration・watcher flow に秘匿の確かめがある | `test-results.md`（watcher flow 103 cases ほか） | build-and-test | Met |
| QT-08 | NFR5 | DB の作りを変えない | base `17676d84` から main `94f1ca6d` までの差分に、表・migration・store・workflow の path が 0 件（証拠の列の絞り込みで再現。変わった 105 file のうち、その path は 0 件で、`package.json` の変更は `scripts` の試験の命令だけ）。今ある PostgreSQL の試験 147 passed・0 failed、Gate 0 の migration-idempotency（16 passed）が通った | `git diff --name-only` の絞り込み（`src/migrate`・`src/stores/`・`migrations/`・`.github/` が 0 件）、`test-results.md` | build-and-test | Met |
| QT-09 | NFR6 | Claude Code と Codex の両方で同じ働きをする | core・flow・hook-registration・scenario が両方の host の場合を持ち、通った | `test-results.md` | build-and-test | Met |
| QT-10 | NFR7（標準 S2〜S5） | 閾値は 1 か所、核は時刻を読まない、「観測できず」を成功に読み替えない、早い抽象をしない | 閾値は `src/constants.ts` の 1 か所（要件の追跡 FR2.1）、核の試験は時刻を渡して決める、観測できずの場合の試験が通った。#341 では独立の監査 3 回目の IMP-9 が S1〜S9 を PASS、#342 は 2 回目の実装監査が PASS（23 / 23）。この段で標準そのものを読み直してはいない | `cross-unit-traceability.md`、独立の監査の返却 | build-and-test | Met |
| QT-11 | team.md「PostgreSQL の試験は手元で回し、結果を PR に載せる」 | 手元の使い捨ての DB で流した結果がある | `npm run test:pg` が 147 passed・0 failed（PostgreSQL 17.11・pgvector 0.8.2、使い捨て、main `94f1ca6d` に対して）。結果は統合の後の記録（この段の記録を入れる記録だけの PR）に載る。PR #341・#342 は統合済みで、その PR 本文には載っていない | `test-results.md` | build-and-test | Met |
| QT-12 | Testing Contract / team.md の「統合の前に CI で流す」 | CI を統合の前に流す | CI Pipeline の段をこの計画は流さない（`aidlc-state.md` の `ci-pipeline` は SKIP）ので、この目標はこの段では N/A: the plan runs no CI Pipeline。参考: PR #342 の CI は build-and-test (18)・(20)・(22) が success（run 43109607794）、統合の後の main の CI も 3 つとも success（run 43113722371） | `aidlc-state.md`、PR #342 の checks | ci-pipeline（SKIP） | N/A |

## 準備の判定

- build-ready: 通った。
- test-ready: 通った。
- deployment-ready: **まだ**。コードは統合され（`94f1ca6d`）、その main から中身の決まった版 `28596bf0915d16b72bd7b5878aadda6ebe7efd7564b6520d0f938eb668e7cd92` を作って読み戻した（置いただけで、席には入れていない。記録は `operation/deployment-execution/deployment-log.md`）が、席への据え付け（FR9.2）は守る物で、arc の据え付けの script の確かめと arc-sec の確かめ、Owner の 1 回の実行が先にある。この段は据え付けを含まない。

## 限界と残っていること

1. **FR9.2・FR9.3 は作っていない（要件の追跡で行き先が無い）**: 統合の後に Owner の決定を受けて Kusabi 自身の席に据え、実際に切って確かめる要件（FR9.2）と、据えた席で量・取り違い・促しの回数を数える要件（FR9.3）。作る段の承認の場で「この build に入れない」と知らせた。受け持つ段は、FR9.2 が `deployment-execution`、FR9.3 が `observability-setup`（どちらもこの計画の後ろの段）。この段では「確かめていない」のままで、段の承認の場でもう一度知らせる。
2. **網羅率は 100% ちょうどではない**: QT-04 のとおり 5 行をチームの決まりで除外した。除外を認めず試験を足すなら、統合済みの code に触れるので、新しい単位と監査になる。
3. **試験の file の型検査（`tsc` の対象外を別に見る確かめ）が 78 件の誤りで終わる**: 3 件はこの取り組みが足した行（`src/test-claude-session-start.ts` 279、`src/test-session-rotation-flow.ts` 989、`src/test-session-rotation-status.ts` 166。#342 の commit `ea19ca1` が足した）、75 件は取り組みの前からの行。試験の実行と CI には影響しない（`tsc` の設定は試験を対象から外し、試験は `tsx` で動く）。前回の記録の「0 で終わる」は #342 より前の話。直すなら型だけの変更だが統合済みの code に触れるので、新しい単位と監査になる。この段では直さず、段の承認の場で arc に伺う。
4. **NFR2 に専用の新しい試験が無い**: QT-06。今ある共有の読み手の試験と一回きりの測りによる。
5. **見張りの本物の tmux の正例は手元の確かめ 1 回で、CI には無い**（段の見直しの Minor R-03。単体の試験は差し替えた tmux を使う）。据え付けの前の `probe` で確かめ直す（FR9.2）。
6. **必須ではない `Shirube Rapid/Lite Gates Report` は PR #341・#342 とも failure のまま統合された**: 必須の検査（build-and-test の 3 つ）ではない。失敗の理由の文は読んでいない。
7. **FR10.5 の配備の記録の 1 行**: `claude --version` で取った版と契約を確かめた版（2.1.220）とのずれを、配備の健康の確かめ（deployment-execution、計画 Step 16.11）で書く。この build では code の側（定数を動かさない・注釈）だけを確かめた。読めない時は「観測できず」と書く。
8. **この段の記録の置き場**: 統合済みの PR #341・#342 の head には、この段の記録（`construction/build-and-test/`）、計画の段の文言を直した `code-generation-questions.md`、作る段の記録の直し（`unit-test-instructions.md` と `code-summary.md` の古い数、計画 16.1 の base の注記）、配備の記録（`operation/deployment-execution/`）が入っていない。記録だけの別の PR（一時の index で作る形）にする。head を動かさない決まりは統合で済んだ。
9. 試験の出力に「PostgreSQL connection failed; refusing SQLite fallback」が出る。失敗を隠さないことを確かめる試験の出力で、失敗ではない。
10. 手元の確かめは Node v26.12.1 の 1 つの版。PR の CI は Node 18・20・22 で通っている。
