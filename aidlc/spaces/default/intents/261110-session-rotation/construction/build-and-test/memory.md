<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-11-11T07:55:22Z — 要件の追跡で行き先が無い FR9.2・FR9.3 は、目標の表（Target Verification Matrix）の目標にせず、cross-unit-traceability.md の未達として書いた; 2 つは統合の後に Owner の決定を受けて行う要件で、作る段の目標（試験の方針・team.md・NFR）ではない。目標にすると Not Met になり段が止まるが、この段で埋められる物ではない。段の承認の場で知らせる。
- 2026-11-11T07:55:22Z — team.md の「PostgreSQL の試験は手元で回し結果を載せる」を、docker が使えないこの Mac では、使い捨ての PostgreSQL（Homebrew の 17 + pgvector、127.0.0.1 だけ、使い捨ての folder）で満たした; 本番の DB には触れない。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-11-11T07:55:22Z — 結合・性能・安全の試験の手順の file を作らなかった; 深さが Minimal の段の決まりで、切り直しの流れと安全（NFR3）は作る段の試験が持つ。まとめの「試験の種類の一覧」に理由を書いた。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-11-11T07:55:22Z — NFR2（末尾 4 MiB だけ読む）は、専用の新しい試験を足さず、今ある共有の読み手の試験と一回きりの測りで書いた; 試験を足すと統合前の PR の head が動いて Owner の exact-head が無効になるため。足すなら統合後の新しい単位になる。限界に正直に書いた。
- 2026-11-11T07:55:22Z — 手元の使い捨ての PostgreSQL は、Unix socket の path が長すぎて起動できなかったので socket を切り（unix_socket_directories を空）TCP の 127.0.0.1 だけにし、試験が英語の誤り文（duplicate key）を照合するので lc_messages=C で起動した。1 回目は日本語の誤り文で 1 件落ちた（環境の原因。code は変えていない）。

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-11-11T07:55:22Z — 統合済みの PR #341 の head に、この段の記録と code-generation-questions.md の直しが入っていない; 記録だけの別の PR にするか、次の単位の PR に入れるかを arc に伺う。
