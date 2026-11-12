# 配備の実行の問い — 会話の切り直し（261110-session-rotation）

この段は、`operation/deployment-pipeline/` の `cd-config.md` と `deployment-strategy.md` で決めた手順を、Kusabi 自身の席だけに実行する。前の段までに決まっていて、聞き直さないこと:
- 据える範囲・見張りの動かし方・席の hook の入れ方・古い常駐の扱いは、Owner の決定 `OD-KUSABI-ROTATION-DEPLOY-SELF-SEAT-TRIAL-20261111-001`（https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6790645694 、Q1〜Q4 = A）。
- 手順は arc-sec が確かめ済み（iyasaka-arc#57 6791098364、止める指摘 0）。S3・S4 は Owner が arc の script を 1 回打つ。
- DB の表の作りは変えない。DB の移行は無い。

実行前の確かめ（step 2 の 4 項目）の結果:
- 実行前の確かめは合っているか: 合っている（S0 の全項目。`deployment-log.md`）。
- DB の移行は要るか: 要らない（この取り組みは DB を変えない）。
- 依存する物は健全か: 版の元（main）、席の起動の script、tmux の窓、古い常駐を確かめた。AWS は使わないので `aws sts get-caller-identity` は流さない。
- 実行の区切り（時間の指定は使わない。終わりの基準で書く）: S0〜S2 は済み。S3・S4 は Owner が script を打った後。S5 以後は、arc が席を起こし直して C2 が合った後。

聞くのは、まだ決まっていなかった次の 1 つだけです。

---

## Q1. [配備の担当] 版を作る場所と、読み戻しに書く path

背景: 版を作る道具は、作業場が清潔で、head が `--expected-head` と一致することを要求します。席の作業場は別の branch で AI-DLC の記録が未コミットなので、別の清潔な checkout で作る必要があります。arc の指示は、作業場と release の置き場の外の一時の directory に置き、読み戻しに path を書くこと。agent-memory は公開の repo で、GitHub の comment と記録に絶対 path を書かない決まりがあります。

A. 席の一時 directory に `git clone` して `aa77b683…` に detach し、そこで作る。公開の読み戻しと記録には `<一時の clone>` と書き、実際の path は arc にだけ私信で渡す。
B. 実際の path を公開の読み戻しに書く。
X. Other (please specify)

[Answer]: A（置き場の部分は arc の答え。Owner の委任 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6762288830 の下で、Owner の言葉ではない: 作業場と release の置き場の外の一時の directory にし、読み戻しに path を書く。path の書き方の部分は席が公開の決まりに合わせて決めた: 公開の読み戻しと記録には `<一時の clone>`、実際の path は arc への私信に書いた。arc が別の書き方を望めば直す）
**Mode:** chat

---

## 第 2 回の実行で足す確かめ（2026-11-12）

第 1 回の Q1 の答え（版を作る場所と path の書き方）は、第 2 回もそのまま使う。第 2 回の実行前の確かめ（step 2 の 4 項目）は、`deployment-log.md` の「第 2 回の実行」に結果を書いた: 全項目が期待と一致、DB の移行は無し、AWS は使わない。

（第 3 回の問いは、このファイルの末尾の Q2。）

第 2 回に新しく聞く問いは無い。決まっていない点は、O5（`initialUserMessage` の確かめ方）で、arc の答え（Owner の委任 #49 6762288830。Owner の言葉ではない）により、C2 の取り直しでは SessionStart の受理の証拠までを確かめ、続きの引き継ぎは S7 の実際の切り直しで確かめる、と決まっている。S3・S4 の実行は、聞く問いではなく条件（arc-sec の第 2 版の手順の読み直し、席が手すき、Owner が arc の script を打つこと）で、`deployment-log.md` に待ちとして書いた。

---

## 第 3 回の実行で足す問い（2026-11-12）

第 1 回・第 2 回の実行前の確かめ「DB の移行は要るか: 要らない（この取り組みは DB を変えない）」は足りなかった（`deployment-log.md` の第 3 回の「実行前の確かめの訂正」）。取り組みが DB を変えなくても、配備した版は本番に無い構造を読む。この問いは、DB の構造の変更なので保護面で、席は決めない。決まっていて聞き直さないこと: 据える範囲・見張りの動かし方・席の hook の入れ方は Owner の決定 `OD-KUSABI-ROTATION-DEPLOY-SELF-SEAT-TRIAL-20261111-001`（Q1〜Q4 = A）、入力の直しは PR #342 で統合済みで、席の hook は新しい版に入れ替わった。

## Q2. [DB の構造] 本番の記憶の DB に `knowledge.memory_scope` の列を足してよいか

背景: Kusabi の席が起きた時に、前の続きの案内を渡す仕組み（SessionStart）が、本番の記憶の DB を読むところで落ちています。配備した版は `knowledge` 表の `memory_scope` という列を読みますが、本番の DB にはその列がありません（10-05 に code へ入った変更が、本番の DB にはまだ適用されていない）。席の hook は、DB の構造を勝手に変えない作りです。この状態では、席を起こし直しても続きの案内が空のままで始まり、見張りによる会話の切り直しも、続きを渡せません（通常の起動と会話はそのまま使えます）。本番の DB で足りないのは、この列と、空の表 `task_state_migration_archive` の 2 つだけで、ほかの変更はすべて入っています。

場面の例: arc が席を起こし直すと、画面に「Wasurezu startup recovery degraded」と出て、前の作業の案内が付かないまま会話が始まる。

A. 列だけを足す。`ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS memory_scope TEXT` を 1 回流す。追加だけで、既存の行は変わらず、空（NULL）を許し、古い code は無視する。元に戻す時は列を削除する。
B. migration を全部流す（`npm run migrate`）。A の列に加えて、空の表 `task_state_migration_archive` ができる。重複行を消して退避する文が 1 つ含まれるが、本番では対象が 0 行だった（読み取りで確認済み）。
C. DB は変えず、hook の側を直して、列が無くても落ちないようにする。DB の構造と code の食い違いは残り、ほかの読み出しの経路（`recover_context` など）は直らない。
X. Other (please specify)

[Answer]: B（Owner の言葉の原文: 「kusabiはBで」。記録 = arc、`OD-KUSABI-PROD-DB-APPLY-PENDING-MIGRATION-MEMORY-SCOPE-20261112-001`、https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6812189369 、本文 SHA-256 `87e4e8b836b3388309e67253d09e7effdd5cfe3d1b136cb22699b4b672474efb`。席が GitHub の API が返す本文で数え直し、一致した。投稿者 watchout。決定の範囲: 版 `28596bf0…` の未適用の migration を当てる（足すだけ）。含まない: ほかの席・ほかの DB、データの書き換え、見張りの起動）
**Mode:** chat

