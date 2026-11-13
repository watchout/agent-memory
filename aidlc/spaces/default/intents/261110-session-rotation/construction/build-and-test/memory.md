<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-11-11T07:55:22Z — 要件の追跡で行き先が無い FR9.2・FR9.3 は、目標の表（Target Verification Matrix）の目標にせず、cross-unit-traceability.md の未達として書いた; 2 つは統合の後に Owner の決定を受けて行う要件で、作る段の目標（試験の方針・team.md・NFR）ではない。目標にすると Not Met になり段が止まるが、この段で埋められる物ではない。段の承認の場で知らせる。
- 2026-11-11T07:55:22Z — team.md の「PostgreSQL の試験は手元で回し結果を載せる」を、docker が使えないこの Mac では、使い捨ての PostgreSQL（Homebrew の 17 + pgvector、127.0.0.1 だけ、使い捨ての folder）で満たした; 本番の DB には触れない。

- 2026-11-11T23:03:10Z — PR #342 の統合（main `94f1ca6d`）の後に、この段を最初から流し直した（前の記録を上書きして更新。やり直しではなく更新）; 流した先は作業場ではなく、何も変えていない使い捨ての clone。要件が 44 件から 51 件に増え（FR10.1〜FR10.7）、変えた行は 4,071 行 / 30 file から 4,984 行 / 34 file、0 回の範囲は 7 行から 5 行になった。
- 2026-11-11T23:03:10Z — 前回の記録は「試験の file の型検査は 0 で終わる」と書いたが、使った一時の tsconfig の中身と対象 file が記録に無く、今回は同じ結果を再現できなかった（対象を `src` の試験の file すべてにすると 78 件、この取り組みが変えた 18 file だけにしても 54 件）。型検査を別に流す確かめは、流した設定の内容と対象の file を記録に書く。今回は `build-instructions.md` に設定の形を書いた。
- 2026-11-11T23:03:10Z — CI の命令 15 個のほかに、CI に無い `test:transcript-stop`・`test:antigravity-hook` も流した（前回と同じ範囲）。CI の post-tool-hook の工程は `DATABASE_URL` が無く何も試験しないで終わるので、同じ試験を `AGENT_MEMORY_DB_TYPE=sqlite` で網羅率の run に入れて 45 passed を見た。

- 2026-11-13T07:42:18Z — PR #344 の統合（main `ffe511e5`）の後に、この段を最初から流し直した（前の記録を上書きして更新。やり直しではなく更新）。流した先は作業場ではなく、何も変えていない使い捨ての clone。要件は 51 件から 58 件に増え（FR11.1〜FR11.7）、変えた行は 4,984 行 / 34 file から 5,820 行 / 42 file、0 回の範囲は 5 行のまま（入口の最後の網が 756 行目から 757 行目に動いただけ）。
- 2026-11-13T07:42:18Z — 要件の追跡表（58 行）は、`aidlc engine sensor-traceability` の出力から機械で作った。前回までは手で写していた所で、件数の食い違いが返却の指摘になった学び（team.md の訂正）に沿う。FR9.2・FR9.3 は前回と同じく、目標の表の目標にせず、追跡表の未達として書いた。
- 2026-11-13T07:42:18Z — 目標 QT-08（DB の作りを変えない）は、前回の「store の path が 0 件」では成り立たなくなった。#344 が読み取り専用の読み手を `src/stores/` に足したため。実際に守る物は表の作り（DDL）なので、「`src/stores/` の 5 file が変わったが DDL の行は 0」という形で書いた。
- 2026-11-13T07:42:18Z — 配備の前の決め方（見張りと hook を同じ版で同時に差し替える）は、arc から席への連絡で受けた技術の判断で、公開された決定でも Owner の言葉でもない。準備の判定の節に、そう分けて書いた。Owner の R3 の追認は、API で本文を取り、本文の SHA-256 `abe07f18…` が記録のものと一致することを確かめた上で、配備を含まないという範囲の限定ごと引いた。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-11-11T07:55:22Z — 結合・性能・安全の試験の手順の file を作らなかった; 深さが Minimal の段の決まりで、切り直しの流れと安全（NFR3）は作る段の試験が持つ。まとめの「試験の種類の一覧」に理由を書いた。
- 2026-11-11T23:03:10Z — 試験の file の型検査の 78 件の誤りを目標の表の目標にしなかった（Testing Contract・team.md・NFR に、試験の file の型検査という目標が無い）。限界の 3 に書き、段の承認の場で arc に伺う。

- 2026-11-13T07:42:18Z — NFR2 の 6 MiB の測りを取り直さなかった。読み手と定数は `94f1ca6d` から `ffe511e5` で差分が空で、測りの前提が変わっていないため。前回の測りの数字に日付を添えて残した。
- 2026-11-13T07:42:18Z — 試験の file の型検査の 89 件（この取り組みが足した行は 14 件）を目標の表の目標にしなかった。Testing Contract・team.md・NFR に、試験の file の型検査という目標が無いため。限界の 3 に書き、段の承認の場で arc に伺う。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-11-11T07:55:22Z — NFR2（末尾 4 MiB だけ読む）は、専用の新しい試験を足さず、今ある共有の読み手の試験と一回きりの測りで書いた; 試験を足すと統合前の PR の head が動いて Owner の exact-head が無効になるため。足すなら統合後の新しい単位になる。限界に正直に書いた。
- 2026-11-11T07:55:22Z — 手元の使い捨ての PostgreSQL は、Unix socket の path が長すぎて起動できなかったので socket を切り（unix_socket_directories を空）TCP の 127.0.0.1 だけにし、試験が英語の誤り文（duplicate key）を照合するので lc_messages=C で起動した。1 回目は日本語の誤り文で 1 件落ちた（環境の原因。code は変えていない）。

- 2026-11-11T23:03:10Z — 今回の使い捨ての PostgreSQL は、前回の学びを使って最初から socket を切り `lc_messages=C` で起動した（port は高い番号の乱数、folder は使い捨て、流した後に止めて消した）。1 回目から 147 passed。
- 2026-11-11T23:03:10Z — 網羅率の 0 回の範囲は、`src/session-rotation-stop.ts` の入口の最後の網が 640〜642 行目から 756 行目の 1 行に動いた（#342 の Step 16.9 で入口の書き方が変わった）。数え方（`coverage-method.md` の 2 つの script をその file からそのまま取り出して使った）は前回と同じ。

- 2026-11-13T07:42:18Z — 最初の流しで core の試験が終了コード 1 になった。原因は私の環境の作り方（`KUSABI_TEST_TMPDIR` を渡さない、使い捨ての `HOME` に `.agent-memory` が無い）で、code と試験は変えていない。環境を直して 18 命令を全部流し直し、記録には流し直しの 1 回分だけを使った。最初の流しの log は残してある。`build-instructions.md` の環境とよくある失敗に足した。
- 2026-11-13T07:42:18Z — 使い捨ての PostgreSQL の 1 回目の `test:pg` は、pgvector を入れていない DB に向けて `type "vector" does not exist` で終了コード 1 だった。`CREATE EXTENSION vector` を入れた新しい DB を作って流し直し、147 passed。流した後に server を止め、起動の印の file が無く接続もできないことを確かめた。

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-11-11T07:55:22Z — 統合済みの PR #341 の head に、この段の記録と code-generation-questions.md の直しが入っていない; 記録だけの別の PR にするか、次の単位の PR に入れるかを arc に伺う。
- 2026-11-11T23:03:10Z — 上の件は、#342 も統合済みになったので「記録だけの別の PR（一時の index で作る形）」にする方向で arc に伺う。入れる物: この段の記録、code-generation の記録の直し（R-06〜R-08 と計画 16.10）、配備の記録。
- 2026-11-11T23:03:10Z — 試験の file の型検査で、この取り組みが足した 3 行（`ea19ca1` が足した）の型の誤りが出た。型だけの直しだが統合済みの code に触れる。直す単位を立てるか、受け入れて残すかを arc に伺う。

- 2026-11-13T07:42:18Z — 試験の file の型検査で、この取り組みが足した行に 14 件の型の誤りがある（前回の 3 件に、#344 が `RotationBlock` に必須の `commit` を足したことで 11 件が増えた）。試験は `tsx` で動き CI にも影響しない。直す単位を立てるか、受け入れて残すかを arc に伺う。
- 2026-11-13T07:42:18Z — #344 を含む中身の決まった版は、`ffe511e5` から作り直す必要がある（前回の版 `28596bf0…` は `94f1ca6d` から作った物）。作り直し・席への差し替え・旧い見張りの観測・C2 の取り直しは Owner の認可を受けてから行う。認可は、この記録を書いた時点で受けていない。
- 2026-11-13T07:42:18Z — 作る段の見直しの Minor 2 件（`unit-test-instructions.md` の試験の件数 17 / 83 / 103 を 18 / 86 / 109 に直すこと、`code-summary.md` の見出しと網羅率の節の 1 行を直すこと）は、配備の段の記録だけの PR に入れる。その PR にも独立の監査をかけるため、監査を頼む席は、その時に空いている 1 席を名指しする。

