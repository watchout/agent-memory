# 作りと試験のまとめ — 会話の切り直し（261110-session-rotation）

## 全体

- 対象: 統合された main `ffe511e5ec655078dba631997397b371d55131ac`（PR #344 の統合の commit）を、何も変えていない使い捨ての clone で流した（2026-11-13）。前回（2026-11-12）は main `94f1ca6d`（PR #342 の統合の commit）、その前（2026-11-11）は #341 の head を流して記録した。この記録はそれを main に合わせて上書きした（段のやり直しではなく、段の再実行による更新）。
- 作り: 型検査（strict）と build は通った（終了コード 0）。**試験の file の型検査（`tsc` の対象外を別に見る確かめ）は 89 件の誤りで、14 件はこの取り組みが足した行**（残りの 75 件は取り組みの前からの行）。前回の 78 件・3 件から増えた 11 件は、#344 が `RotationBlock` に必須の `commit` を足したため、古い試験の呼び出しが型に合わなくなった物。試験の実行（`tsx`）と CI には影響しない。限界の 3 に書く。
- 試験: CI の命令 15 個と CI に無い 3 個の計 18 個がすべて終了コード 0（core 1832 passed ほか）。PostgreSQL の試験（手元の使い捨ての DB）も `test:pg` 147 passed・0 failed、#344 が足した `test:handoff-commit-order-pg` 6 cases PASS。失敗 0、飛ばした試験 0。
- 行の網羅率: 変えた行と新しい行 5,820 行（42 file）のうち 0 回の範囲は入口の最後の網 2 つ（5 行）だけ。5,815 行が実行された（99.91%）。#344 の範囲だけ（起点 `94f1ca6d`）では 940 行のうち 0 回の範囲が 0。
- 統合: PR #344 は head `aa671be5677957e7f13c210f41681dfd50b2cd40` のまま、2026-11-13T01:37:39Z に統合された（統合の commit `ffe511e5`）。統合の前に、独立の監査の返却（PASS、33 項目すべて PASS・FAIL 0・止める指摘 0、実装の監査は 7 回目）と作者の受領（`RECEIPT_ACCEPTED`）があった。統合の後の main の CI（run 43346320385）は 3 つとも success。
- 区分: 統合の時は R2 の見立てだった。統合の後に Owner が R3 として追認した（head `aa671be5` だけ。配備は含まない）。出典は `test-results.md` の「PR の CI」。
- 詳しい結果は `test-results.md`、要件の行き先は `cross-unit-traceability.md`。

## 試験の種類の一覧

試験の深さは Minimal（`aidlc-state.md`）。Minimal は、この段で足す試験の手順の file を作らない。単体の試験は作る段が持つ（`construction/code-generation/unit-test-instructions.md`）。

| 種類 | この段で作ったか | 理由 |
|---|---|---|
| 作り方の手順 | 作った（`build-instructions.md`） | 常に作る |
| 結合の試験の手順 | 作らない | Minimal。切り直しの流れ（hook の command を別 process で起動する場合・成功の場面）は作る段の flow と scenario の試験が持つ |
| 性能の試験の手順 | 作らない | 性能の NFR（nfr-requirements）は無い。hook の期限（NFR1）は作る段の試験が持つ |
| 安全の試験の手順 | 作らない | Minimal。安全の NFR3（キーを送らない・秘密を出さない）は作る段の watcher flow・core・flow の試験が持つ。依存を足していないので、依存の脆弱性の確かめは対象外（`npm audit --omit=dev` は 0 件） |

## 単位ごとの網羅率の見込み

この取り組みは単位が 1 つ（express）。変えた行と新しい行は 5,820 行（42 file）で、実行されなかったのは 5 行（2 範囲）。内訳は `test-results.md` の表。

## Target Verification Matrix

目標の出どころ: 作る段の Testing Contract（`construction/code-generation/code-generation-plan.md`）、team.md の試験の姿勢、要件の NFR1〜NFR7（`inception/requirements-analysis/requirements.md`）。この計画に NFR の段（`nfr-requirements`・`nfr-design`）は無いので、それらの file は無い。

| Target ID | Source | Expected | Actual | Evidence | Owning Stage | Verdict |
|---|---|---|---|---|---|---|
| QT-01 | Testing Contract の scope_floor | 今ある試験が通ったまま | CI の命令 15 個と CI に無い 3 個の計 18 個がすべて終了コード 0（core 1832 passed・sqlite 206 passed・boot-recovery 28 passed・Gate 0 の 3 file 57 / 16 / 12 passed・post-tool-hook は sqlite で流して 45 passed ほか、失敗 0）。CI の post-tool-hook の工程は `DATABASE_URL` が無く何も試験しないで終わる（main の CI でも同じ、この取り組みの前から） | `test-results.md` の「試験」 | build-and-test | Met |
| QT-02 | Testing Contract の strategy_volume 1 | この build に入れた要件ごとに、試験が 1 つ以上ある | FR1〜FR8・FR9.1・FR10.1〜FR10.4・FR10.6・FR10.7・FR11.1〜FR11.7（FR11.5 のうち旧い見張りの code の挙動を除く。限界の 8）・NFR1・NFR3・NFR5〜NFR7 に試験がある（切り直しの 10 file、身元の試験 25 cases、hook の入力の形・診断・node の path の 3 file、展開と版を作る道具の試験、PostgreSQL の確定の順序の試験。対応は `construction/code-generation/unit-test-instructions.md` の命令の説明）。NFR2 は QT-06、NFR4 は QT-04。試験の対象にならない要件（FR5.5 は設計の正本の直し、FR10.5 は定数と注釈で `claude --version` の 1 行は配備の記録の手順、FR2.3・FR5.4・FR8.3 は N/A の理由つき）は `cross-unit-traceability.md` | `unit-test-instructions.md`、`test-results.md` | build-and-test | Met |
| QT-03 | Testing Contract の strategy_volume 2 | 部品ごとに正常系の試験が 1 つ以上ある | 変えた・足した `src/` の 42 file すべてが試験から読み込まれ、正常系の経路が実行された（0 回の範囲は 2 つ、入口の最後の網だけ） | `test-results.md` の網羅率の表 | build-and-test | Met |
| QT-04 | team.md「網羅率」・NFR4 | 変えた行と新しい行の網羅率 100% | 5,820 行のうち 5,815 行が実行（99.91%）。実行されなかったのは `src/rotation-watcher.ts` 134〜137 行と `src/session-rotation-stop.ts` 757 行（どちらも入口の最後の網 `main().catch`）の 5 行だけ。#344 の範囲だけ（起点 `94f1ca6d`）は 940 行で 0 回の範囲が 0。前回は `src/session-rotation-stop.ts` が 756 行目で、#344 が 1 行増やして 757 行目に動いた（数は同じ） | `test-results.md` の網羅率（`coverage-method.md` の手順で再現） | build-and-test | Met（チームの決まりの除外: 「届かない行を数えから外す時は、PR に理由を書いて独立の監査で見る」。理由は PR 本文と `code-summary.md`。#341 では独立の監査 3 回目の IMP-8 が 7 行の 2 範囲を再現して PASS、#342 は 2 回目の実装監査が PASS（23 / 23）、#344 は PASS（33 / 33）で統合された。100% ちょうどではない） |
| QT-05 | NFR1 | Stop の hook は 9 秒の期限の中の 7 秒の内部期限で必ず返し、失敗しても席を止めない。block は 1 つの会話で最大 1 回 | flow の試験が通った（内部期限の各場合、閉じない標準入力・期限の後の入力・同じ予算・別 process の実 command。答えを書き終えた後に診断の待ちを最大 200 ms 挟む形も同じ試験の中にある） | `test-results.md`（flow 47 cases）、`construction/code-generation/unit-test-instructions.md` | build-and-test | Met |
| QT-06 | NFR2 | 量の測りは末尾 4 MiB の読み出しと純粋な計算だけ | 6,292,440 byte の transcript から 4,193,640 文字だけ読んだ（限度 4,194,304。2026-11-11 の一回きりの測りで、今回は取り直していない）。読み手と定数は `94f1ca6d` から `ffe511e5` で変わっておらず（差分が空）、尾の読みは今ある自動の受領の試験が通っている。新しい専用の試験は無い | `test-results.md` の「NFR2 の一回きりの測り」 | build-and-test | Met（専用の新しい試験は無く、今ある共有の試験と一回きりの測りによる。限界に書く） |
| QT-07 | NFR3 | 席の画面にキーを送らない（実行できる tmux の命令は閉じた集合）。秘密の値を引数・証拠・log に出さない | watcher flow が、実行された tmux の呼び出しの全部を閉じた集合（`send-keys` 系が 0 件）と照らして通った。core・flow・registration・watcher flow に秘匿の確かめがある | `test-results.md`（watcher flow 109 cases ほか） | build-and-test | Met |
| QT-08 | NFR5 | DB の作りを変えない | base `17676d84` から main `ffe511e5` までの差分は 125 file。表・migration・`.sql`・PostgreSQL の store・`.github/` の path は 0 件。`src/stores/` の 5 file が変わった（新規 `read-only-task-states.ts`・`task-state-normalize.ts`、変更 `index.ts`・`json-store.ts`・`sqlite-store.ts`）が、DDL の行は 0（あるのは「migration」という語の注釈だけ）。`package.json` の変更は `scripts` の試験の命令だけ。今ある PostgreSQL の試験 147 passed・0 failed、Gate 0 の migration-idempotency（16 passed）が通った | `git diff --name-only` と `git diff` の絞り込み、`test-results.md` | build-and-test | Met（前回の「store の path が 0 件」は、#344 が読み取り専用の読み手を `src/stores/` に足したため成り立たない。DDL が 0 という形に直した） |
| QT-09 | NFR6 | Claude Code と Codex の両方で同じ働きをする | core・flow・hook-registration・scenario が両方の host の場合を持ち、通った | `test-results.md` | build-and-test | Met |
| QT-10 | NFR7（標準 S2〜S5） | 閾値は 1 か所、核は時刻を読まない、「観測できず」を成功に読み替えない、早い抽象をしない | 閾値は `src/constants.ts` の 1 か所（要件の追跡 FR2.1）、核の試験は時刻を渡して決める、観測できずの場合の試験が通った。#344 の独立の監査は DES-1〜17・IMP-1〜16 の 33 項目すべて PASS（返却の本文に、標準 S1〜S9 を名指しした項目は無い。前回までのこの記録は、#341 の 3 回目の監査 IMP-9 が S1〜S9 を PASS したと書いている。この段では取り直していない）。読み手と store が同じ整理の規則を持つ所は、1 つの関数を共有して同値の試験を置いた。この段で標準そのものを読み直してはいない | `cross-unit-traceability.md`、独立の監査の返却 | build-and-test | Met |
| QT-11 | team.md「PostgreSQL の試験は手元で回し、結果を PR に載せる」 | 手元の使い捨ての DB で流した結果がある | `npm run test:pg` が 147 passed・0 failed、`npm run test:handoff-commit-order-pg` が 6 cases PASS・飛ばしなし（PostgreSQL 17.11・pgvector 0.8.2、使い捨て、main `ffe511e5` に対して）。流した後に server を止めた。`test-handoff-commit-order-pg` の結果は PR #344 の本文にもある。`test:pg` の結果は統合の後の記録（この段の記録を入れる記録だけの PR）に載る | `test-results.md` | build-and-test | Met |
| QT-12 | Testing Contract / team.md の「統合の前に CI で流す」 | CI を統合の前に流す | CI Pipeline の段をこの計画は流さない（`aidlc-state.md` の `ci-pipeline` は SKIP）ので、この目標はこの段では N/A: the plan runs no CI Pipeline。参考: PR #344 の CI は build-and-test (18)・(20)・(22) が success（run 43343336248）、統合の後の main の CI も 3 つとも success（run 43346320385） | `aidlc-state.md`、PR #344 の checks | ci-pipeline（SKIP） | N/A |

## 準備の判定

- build-ready: 通った。
- test-ready: 通った。
- deployment-ready: **まだ**。コードは統合された（`ffe511e5`）。ただし、前回（2026-11-12）に作った中身の決まった版 `28596bf0915d16b72bd7b5878aadda6ebe7efd7564b6520d0f938eb668e7cd92` は main `94f1ca6d` から作った物で、#344 を含まない。#344 を含む版は、`ffe511e5` から作り直す必要がある（作り直しは配備の段で、Owner の認可を受けてから）。席への据え付け（FR9.2）は守る物で、Owner の 1 回の実行が先にある。この段は版の作り直しも据え付けも含まない。
- 配備の前に残っていること（arc の技術の判断。arc から席への連絡で受けた物で、公開された決定でも Owner の言葉でもない）: 見張りの旧い版と新しい版を同居させず、同じ版で同時に差し替える（見張りを止める → hook を差し替える → 新しい見張りを起こす → 読み戻す。戻しはその逆）。理由として arc が挙げたのは、同居すると旧い見張りが新しい終端の値（`output_written_receipt_unobserved`）を `unreadable` と読む恐れがあること。これは配備の段の計画（17.9）の未決の問いへの答えで、配備の段の記録にも「arc の技術の判断」と書く。Owner への伺い（版の作り直し・差し替え・旧い見張りの観測・C2 の取り直し）は arc が 1 回行う予定で、この記録を書いた時点で認可は受けていない。
- 配備の前にもう一度取り直すこと（`project.md` の決まり）: 版の元の commit・必須の入口の一覧・席の設定の中身。必須の入口の一覧（`scripts/build-kusabi-content-addressed-runtime-release.mjs` の `ENTRYPOINTS`）は、`94f1ca6d` から `ffe511e5` で変わっていない（12 件。`scripts/` の差分が空）。

## 限界と残っていること

1. **FR9.2・FR9.3 は作っていない（要件の追跡で行き先が無い）**: 統合の後に Owner の決定を受けて Kusabi 自身の席に据え、実際に切って確かめる要件（FR9.2）と、据えた席で量・取り違い・促しの回数を数える要件（FR9.3）。作る段の承認の場で「この build に入れない」と知らせた。受け持つ段は、FR9.2 が `deployment-execution`、FR9.3 が `observability-setup`（どちらもこの計画の後ろの段）。この段では「確かめていない」のままで、段の承認の場でもう一度知らせる。
2. **網羅率は 100% ちょうどではない**: QT-04 のとおり 5 行をチームの決まりで除外した。除外を認めず試験を足すなら、統合済みの code に触れるので、新しい単位と監査になる。
3. **試験の file の型検査（`tsc` の対象外を別に見る確かめ）が 89 件の誤りで終わる**: 14 件はこの取り組みが足した行（前回の 3 件に、#344 の型の変更で増えた 11 件。`src/test-rotation-hook-registration.ts` に 3 件、`src/test-session-rotation-flow.ts` に 8 件）、75 件は取り組みの前からの行。試験の実行と CI には影響しない（`tsc` の設定は試験を対象から外し、試験は `tsx` で動く）。直すなら試験の型だけの変更（呼び出しに `commit` を足す）だが統合済みの試験に触れるので、新しい単位と監査になる。この段では直さず、段の承認の場で arc に伺う。
4. **NFR2 に専用の新しい試験が無い**: QT-06。今ある共有の読み手の試験と一回きりの測りによる。
5. **見張りの本物の tmux の正例は手元の確かめ 1 回で、CI には無い**（段の見直しの Minor R-03。単体の試験は差し替えた tmux を使う）。据え付けの前の `probe` で確かめ直す（FR9.2）。
6. **必須ではない `Shirube Rapid/Lite Gates Report` は PR #341・#342・#344 とも failure のまま統合された**: 必須の検査（build-and-test の 3 つ）ではない。失敗の理由の文は読んでいない。
7. **FR10.5 の配備の記録の 1 行**: `claude --version` で取った版と契約を確かめた版（2.1.220）とのずれを、配備の健康の確かめ（deployment-execution、計画 Step 16.11）で書く。この build では code の側（定数を動かさない・注釈）だけを確かめた。読めない時は「観測できず」と書く。
8. **FR11.5 のうち、旧い見張りの code が新しい終端の値を読む挙動は、旧い code を走らせる試験が無いので固定していない**（作る段の試験の命令の T16）。配備の段で確かめる。上の「配備の前に残っていること」の同時の差し替えは、この挙動を避ける形。
9. **この段の記録と、作る段の記録の直しの置き場**: 統合済みの PR #341・#342・#344 の head には、この段の記録（`construction/build-and-test/`）、計画の段の文言を直した `code-generation-questions.md`、配備の記録（`operation/deployment-execution/`）が入っていない。作る段の見直し（2026-11-13）の Minor 2 件（`unit-test-instructions.md` の試験の件数を 17 / 83 / 103 から 18 / 86 / 109 に直すこと、`code-summary.md` の「変えた file」の見出しと網羅率の節の 0 回の範囲の行を直すこと）は、段の見直しの問いへの答え「直す（配備の段の記録だけの PR に一緒に入れる）」（画面の問いで、arc が Owner の委任で答えた）のとおり、この記録だけの別の PR（一時の index で作る形）に入れる。その PR にも独立の監査をかける。
10. **800 行を超える既存の file が 5 つ**（`src/codex-session-start.ts` 1122 行・`src/index.ts` 1017 行・`src/kusabi-direct-fleet-rollout.ts` 2038 行・`src/stores/json-store.ts` 907 行・`src/stores/sqlite-store.ts` 1883 行）: どれも取り組みの前から超えていて、この取り組みで超えた file は無い。大きな file には呼び出しの行だけを足し、分けることは範囲の外とした（作る段の計画の決定）。触る時に直す（team.md）。
11. 試験の出力に「PostgreSQL connection failed; refusing SQLite fallback」が出る。失敗を隠さないことを確かめる試験の出力で、失敗ではない。
12. 手元の確かめは Node v26.13.1 の 1 つの版。PR の CI は Node 18・20・22 で通っている。
