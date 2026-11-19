# U1 の作って確かめる流れ（CI と統合）

- 入力: 今の CI（`.github/workflows/ci.yml`）、進め方（team.md の Way of Working・Testing Posture・Deployment）、U1 の非機能の設計（`construction/u1-seat-memory-skeleton/nfr-design/logical-components.md`）、この段階の Q1 = A

## 流れ

1. **コードを書く段の初め**: 今の Kusabi の試験を書き直さずに `node --test --import tsx --experimental-test-coverage` で動かし、Node の組込みで行の網羅率が出るかを試す。出なければ c8 を開発用の依存に足すかを owner に伺う。あわせて、今の Kusabi の試験の行の網羅率を測る。
2. **網羅率が 80% に届かない時**: 床をどこに当てるか（repo の全体か、変えた所か）を owner に伺い、決まり（「弱めない」）を緩めずに入れる方法を決める。
3. **workflow の PR（保護面）**: workflow の変更だけの小さな PR を出す。中身は、網羅率の確かめと共通基盤の写しの sha256 の試験を CI に足すこと。独立の監査の後、owner の exact-head を取って統合する。PostgreSQL の試験は、置き場所の設計が固まるまで CI に入れない（手元で回して結果を PR に載せる）。
4. **U1 の PR**: コードと試験だけ。変更ごとに branch を切り、main へ PR を出す。PR には手元の PostgreSQL の試験（試験のたびに立ち上げる専用の PostgreSQL 17）の結果を載せる。
5. **確かめ**: CI（Node 18・20・22 の型検査・ビルド・今の試験・網羅率・写しの試験）が通り、独立の監査（devauditor）が PASS する。
6. **統合**: 作者と別の席（suite-lead）が head の一致を確かめて、merge commit で統合する。
7. **作り終わりの区切り**: owner の前で薄い一本を見せる（試験の命令 1 本）。あわせて、本物の Codex と Claude Code の会話で 1 回ずつ同じ流れを確かめて証拠に残す（本物の会話を開く時に owner の決定）。

## 段階と門

| 段階 | 門 | 決める者 |
|------|----|----------|
| 網羅率の道具 | Node の組込みで出るか。出なければ c8 を足すか | owner（c8 を足す時） |
| 網羅率の床の当て方 | 80% に届かない時の当て方 | owner |
| workflow の PR | 独立の監査の PASS と owner の exact-head | devauditor・owner |
| U1 の PR | CI の PASS と独立の監査の PASS | devauditor |
| 統合 | head の一致 | suite-lead |
| 作り終わりの区切り | 薄い一本が動く | owner |

## 展開と戻し方

- U1 では席に配らない。中身の決まった版（content-addressed の runtime release）を作り、席の束ごとに配るのは、すべての Bolt の後の展開の段（team.md の Deployment）。
- 戻し方: U1 の PR は merge commit を戻せば 1 回で戻る（team.md の Way of Working）。Kusabi の置き場の作りの変更は、戻す版の SQL で戻す（NFR6.1）。
- 秘密: CI と試験の DB の資格情報は試験の中で作って消す。CI に置く秘密は増やさない。
