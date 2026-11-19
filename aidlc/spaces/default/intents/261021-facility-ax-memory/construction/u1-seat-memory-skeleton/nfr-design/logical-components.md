# U1 の論理の部品

- 入力: 部品の一覧（`inception/domain-design/components.md`）、技術の選び方（`construction/u1-seat-memory-skeleton/nfr-requirements/tech-stack-decisions.md`）、この段階の速さ・安全・信頼・観測の設計

## 部品と、失敗が響く範囲

| 論理の部品 | 中身（部品の一覧の部品） | 失敗が響く範囲 | 隔て方 |
|-----------|------------------------|--------------|--------|
| MCP サーバーの process（席ごとに 1 つ） | ToolSurface・Placement・SeatIdentity の呼出し側・MemoryRecords の呼出し側 | その席だけ | 席ごとの process と接続 1 本 |
| 起動の口の process（席の起動のたび） | HostAdapters（Claude Code・Codex）・Recovery（決定だけ） | その席の起動だけ。起動は止めない | 締め切り 7 秒、失敗でも起動を返す |
| Kusabi の置き場（DB の `kusabi`） | 決定の表・公開関数（保存・読み出し）・`kusabi_owner` | その DB（自社か顧客の DB）を使う席すべて | 席には関数の実行だけ。関数の中で確かめる |
| 共通基盤の置き場（DB の `common`） | 共通基盤 0.2 の変えない写し（`verify_current_tx`・共通の表・役割） | その DB を使う製品すべて | 共通基盤の持ち主の役割と権限のまま。Kusabi は呼ぶだけ |
| 呼出しの記録（手元のファイル） | CallLogEntry | 観測だけ（書けなくても道具は続ける） | 中身を書かない |
| 試験の PostgreSQL（試験のたび） | 一時的な場所の PostgreSQL 17 | その試験だけ | 空いている port・一時的な場所・終われば消す。今の PostgreSQL に触れない |

## 共に使う物

- 置き場所の DB は、自社の場合は共通基盤の DB（suite）を AUN・Shirube・Onza と共に使う。Kusabi は自分の置き場（`kusabi`）だけを持ち、ほかの製品の置き場は読まない（ADR-005）。
- 共通基盤の置き場は製品どうしで共に使う。Kusabi は版を固定した写しの bytes が一致することを試験で確かめ、中身を変えない。
- U1 は本番の DB に入らない。本番に Kusabi の置き場を入れるのは展開の段で owner の決定の後。

## 基盤の段への渡し

- 試験の PostgreSQL の立ち上げと片付けの手順、共通基盤の写しの置き場所と sha256 の試験、CI に PostgreSQL の試験と網羅率の確かめを入れること（workflow の変更、owner の exact-head）。
