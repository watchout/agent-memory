# 作りと試験のまとめ — 会話の切り直し（261110-session-rotation）

## 全体

- 作り: 通った（型検査・build・試験の file の型検査、どれも終了コード 0）。
- 試験: CI と同じ一覧 18 / 18 が通り、PostgreSQL の試験（手元の使い捨ての DB）も 147 passed・0 failed。失敗 0、飛ばした試験 0。
- 行の網羅率: 変えた行と新しい行 4,071 行（30 file）のうち 0 回の範囲は入口の最後の網 2 つ（7 行）だけ。
- 統合: PR #341 は head `a8f74ed9433a4f79f52b22d74fc8053b9e32235a` のまま、2026-11-11T07:47:02Z に統合された（統合の commit `aa77b683e135beabb9fc54bd3736b47d288d6f46`）。統合の前に、実装監査 3 回目の PASS・作者の受領・Owner の exact-head があった。
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

この取り組みは単位が 1 つ（express）。変えた行と新しい行は 4,071 行（30 file）で、実行されなかったのは 7 行（2 範囲）。内訳は `test-results.md` の表。

## Target Verification Matrix

目標の出どころ: 作る段の Testing Contract（`construction/code-generation/code-generation-plan.md`）、team.md の試験の姿勢、要件の NFR1〜NFR7（`inception/requirements-analysis/requirements.md`）。この計画に NFR の段（`nfr-requirements`・`nfr-design`）は無いので、それらの file は無い。

| Target ID | Source | Expected | Actual | Evidence | Owning Stage | Verdict |
|---|---|---|---|---|---|---|
| QT-01 | Testing Contract の scope_floor | 今ある試験が通ったまま | CI と同じ一覧 18 / 18 が通った（core 1832 passed・boot-recovery 28 passed・post-tool-hook 45 passed ほか、失敗 0） | `test-results.md` の「試験」 | build-and-test | Met |
| QT-02 | Testing Contract の strategy_volume 1 | この build に入れた要件ごとに、試験が 1 つ以上ある | FR1〜FR8・FR9.1・NFR1・NFR3・NFR5〜NFR7 に試験がある（切り直しの 7 file と身元の試験 25 cases。対応は `unit-test-instructions.md` の命令の説明）。NFR2 は QT-06、NFR4 は QT-04。試験の対象にならない要件（FR5.5 は設計の正本の直し、FR2.3・FR5.4・FR8.3 は N/A の理由つき）は `cross-unit-traceability.md` | `unit-test-instructions.md`、`test-results.md` | build-and-test | Met |
| QT-03 | Testing Contract の strategy_volume 2 | 部品ごとに正常系の試験が 1 つ以上ある | 変えた・足した `src/` の 30 file すべてが試験から読み込まれ（`loaded_by` が 1 以上）、正常系の経路が実行された | `test-results.md` の網羅率の表 | build-and-test | Met |
| QT-04 | team.md「網羅率」・NFR4 | 変えた行と新しい行の網羅率 100% | 4,071 行のうち 4,064 行が実行（99.83%）。実行されなかったのは `src/rotation-watcher.ts` 134〜137 行と `src/session-rotation-stop.ts` 640〜642 行（どちらも入口の最後の網 `main().catch`）の 7 行だけ | `test-results.md` の網羅率（`coverage-method.md` の手順で再現） | build-and-test | Met（チームの決まりの除外: 「届かない行を数えから外す時は、PR に理由を書いて独立の監査で見る」。理由は PR 本文と `code-summary.md`、独立の監査 3 回目の IMP-8 が同じ 2 範囲を再現して PASS。100% ちょうどではない） |
| QT-05 | NFR1 | Stop の hook は 9 秒の期限の中の 7 秒の内部期限で必ず返し、失敗しても席を止めない。block は 1 つの会話で最大 1 回 | flow の試験が通った（内部期限の各場合、閉じない標準入力・期限の後の入力・同じ予算・別 process の実 command） | `test-results.md`（flow 40 cases）、`unit-test-instructions.md` | build-and-test | Met |
| QT-06 | NFR2 | 量の測りは末尾 4 MiB の読み出しと純粋な計算だけ | 6,292,440 byte の transcript から 4,193,640 文字だけ読んだ（限度 4,194,304）。読み手は今ある共有の関数で、尾の読みは今ある自動の受領の試験が通っている。新しい専用の試験は無い | `test-results.md` の「NFR2 の一回きりの測り」 | build-and-test | Met（専用の新しい試験は無く、今ある共有の試験と一回きりの測りによる。限界に書く） |
| QT-07 | NFR3 | 席の画面にキーを送らない（実行できる tmux の命令は閉じた集合）。秘密の値を引数・証拠・log に出さない | watcher flow が、実行された tmux の呼び出しの全部を閉じた集合（`send-keys` 系が 0 件）と照らして通った。core・flow・registration・watcher flow に秘匿の確かめがある | `test-results.md`（watcher flow 103 cases ほか） | build-and-test | Met |
| QT-08 | NFR5 | DB の作りを変えない | base から統合までの差分に、表・migration・store・workflow の path が 0 件。今ある PostgreSQL の試験 147 passed・0 failed、Gate 0 の migration-idempotency が通った | `git diff --name-only` の絞り込み（`src/migrate`・`src/stores/`・`migrations/`・`.github/` が 0 件）、`test-results.md` | build-and-test | Met |
| QT-09 | NFR6 | Claude Code と Codex の両方で同じ働きをする | core・flow・hook-registration・scenario が両方の host の場合を持ち、通った | `test-results.md` | build-and-test | Met |
| QT-10 | NFR7（標準 S2〜S5） | 閾値は 1 か所、核は時刻を読まない、「観測できず」を成功に読み替えない、早い抽象をしない | 閾値は `src/constants.ts` の 1 か所（要件の追跡 FR2.1）、核の試験は時刻を渡して決める、観測できずの場合の試験が通った。独立の監査 3 回目の IMP-9 が S1〜S9 を PASS | `cross-unit-traceability.md`、独立の監査 3 回目の返却 | build-and-test | Met |
| QT-11 | team.md「PostgreSQL の試験は手元で回し、結果を PR に載せる」 | 手元の使い捨ての DB で流した結果がある | `npm run test:pg` が 147 passed・0 failed（PostgreSQL 17.11・pgvector、使い捨て）。結果は統合の後の記録に載る（PR #341 は統合済みなので、結果の PR への載せ方は arc に伺う） | `test-results.md` | build-and-test | Met |
| QT-12 | Testing Contract / team.md の「統合の前に CI で流す」 | CI を統合の前に流す | CI Pipeline の段をこの計画は流さない（`aidlc-state.md` の `ci-pipeline` は SKIP）ので、この目標はこの段では N/A: the plan runs no CI Pipeline。参考: PR の CI は build-and-test (18)・(20)・(22) が success（run 42977510939） | `aidlc-state.md`、PR #341 の checks | ci-pipeline（SKIP） | N/A |

## 準備の判定

- build-ready: 通った。
- test-ready: 通った。
- deployment-ready: **まだ**。コードは統合されたが、席への据え付け（FR9.2）は守る物で、arc-sec の確かめと Owner の決定が先にある。この段は据え付けを含まない。

## 限界と残っていること

1. **FR9.2・FR9.3 は作っていない（要件の追跡で行き先が無い）**: 統合の後に Owner の決定を受けて Kusabi 自身の席に据え、実際に切って確かめる要件（FR9.2）と、据えた席で量・取り違い・促しの回数を数える要件（FR9.3）。作る段の承認の場で「この build に入れない」と知らせた。受け持つ段は、FR9.2 が `deployment-execution`、FR9.3 が `observability-setup`（どちらもこの計画の後ろの段）。この段では「確かめていない」のままで、段の承認の場でもう一度知らせる。
2. **網羅率は 100% ちょうどではない**: QT-04 のとおり 7 行をチームの決まりで除外した。除外を認めず試験を足すなら、統合済みの code に触れるので、新しい単位と監査になる。
3. **NFR2 に専用の新しい試験が無い**: QT-06。今ある共有の読み手の試験と一回きりの測りによる。
4. **見張りの本物の tmux の正例は手元の確かめ 1 回で、CI には無い**（段の見直しの Minor R-03。単体の試験は差し替えた tmux を使う）。据え付けの前の `probe` で確かめ直す（FR9.2）。
5. **必須ではない `Shirube Rapid/Lite Gates Report` は failure のまま統合された**: 必須の検査（build-and-test の 3 つ）ではない。この PR の失敗の理由の文は読んでいない。
6. **この段の記録の置き場**: 統合済みの PR #341 の head には、この段の記録（`construction/build-and-test/`）と、計画の段の文言を直した `code-generation-questions.md` が入っていない。記録だけの別の PR にするか、次の単位の PR に入れるかは arc に伺う（head を動かさないという arc の指示は、統合で済んだ）。
7. 試験の出力に「PostgreSQL connection failed; refusing SQLite fallback」が出る。失敗を隠さないことを確かめる試験の出力で、失敗ではない。
8. 手元の確かめは Node v26.12.1 の 1 つの版。PR の CI は Node 18・20・22 で通っている。
