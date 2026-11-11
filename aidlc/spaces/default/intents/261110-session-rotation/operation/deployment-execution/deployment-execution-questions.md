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
