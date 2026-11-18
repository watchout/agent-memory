# Deployment Pipeline — 質問（取り組み 261113-store-resolution-fix）

この質問の答えは、AI-DLC の決まりどおり、Owner の判断が要る問いは Owner の言葉のまま、守る物でない問いは Owner の委任（https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6762288830）に基づく arc の答えとして書く。`[Answer]:` は空けてあり、選択肢に勧めは付けていない。

## すでに決まっている物（質問にしない）

出どころは、Owner の決定 `OD-KUSABI-STORE-RESOLUTION-RELEASE-PRODCHECK-R1-SELF-SEATS-20261116-001`（https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6910764201 、本文の SHA-256 `a378655b6cd927b24a9c6da1cc5025f268b29f9dd581caf2a75bd71eef1ca881`）と、`team.md` の Deployment、`requirements.md` の NFR7・FR6.3。

- 配る物: 統合の commit `fa9f3a2f16255d723b0cb96f0e77958035f7b11e`（PR #347）から、清潔な copy で作る中身の決まった版（content-addressed の runtime release）。追加だけで書き換えない置き場 `~/Developer/.kusabi-releases` に公開し、読み戻す（`PASS_EXACT_READBACK`）。既存の版は消さず、上書きしない。
- 配る前の確認: 本番の DB に、Stop が保存に使う 4 表（`conversation_events`・`raw_events`・`selected_restart_packs`・`task_states`）と列の名前があるかを、読み取りだけで名前だけ確かめる。行の値・件数は読まず、接続の文字列は表示せず、表も列も足さない（DDL 0 行）。確かめたい表と列の一覧は、`unit-test-instructions.md` の 8 にある。
- 配る先: Kusabi 自身の 2 席（Claude の tmux `aidlc-kusabi`・Codex の tmux `kusabi`）だけ（R1）。席の hook を上の版に差し替える。ほかの席（R2 以後）は、この 2 席の観測の後に、改めて Owner に伺う。
- 失敗した時: 1 つでも合わなければ、その席の差し替えだけを戻して止まる。戻しは、席ごとに、差し替える前の設定の bytes と hash から行う。
- 進め方: 版の公開・本番の表と列の確認・席の hook の差し替えの 3 つは、arc が script を作り、arc-sec が読んで通してから、Owner が打つ。席（この会話）は、保護面（版の置き場・本番の DB・席の hook）に何も実行しない。
- コードの戻し: その merge commit を戻す（`requirements.md` の NFR7）。DB の構造は変えないので migration は無い。
- CD の workflow は足さない: `ci.yml` は Node 18・20・22 で型検査・ビルド・試験を流す CI だけで、公開・配りの job を持たない。workflows は守る物で、足すには Owner の exact-head が要る。今回の配りは上の手順のまま。
- feature flag は使わない: 今回の直しは保存先の決め方の変更で、出し入れする機能ではなく、AWS（CloudWatch Evidently・AppConfig）も使っていない。
- 新しい版を、npm には公開しない（`team.md`）。
- 観測の結果が観測できなかった時は「観測できず」と書き、成功に数えない（S5）。観測の値は、観測した事実から取り、宣言（設定・期待値）を写さない。

## Q1. [運用] R1 の 2 席が「合っている」と数える観測は何か

背景: Owner の決定は、R2 以後を「この 2 席の観測の後に改めて Owner に伺う」とだけ決めていて、何を観測すれば 2 席が合っていると数えるかは書いていません。観測の値は、Stop の hook が出す証拠の JSON（`store_backend`・`store_source`。URL・path は含まない）から取り、DB の行は読みません。証拠は席の hook が動いた時にだけ出るので、Stop が起きない間は「観測できず」で、成功に数えません。証拠がどこに残るかは、Deployment Execution の手順で確かめます（この段では確かめていません）。

選択肢:
- A. 各席で、hook を差し替えた後の最初の Stop 1 回の証拠が、決めた保存先と一致し（`store_backend`・`store_source` が入る）、拒否（`store_refused`）が 0 件であること。2 席とも満たす
- B. A に加えて、各席で 1 回、Stop が保存した引き継ぎを、同じ保存先から読み戻せること（`restart-cli` の読み）を確かめる
- C. 各席で、A を満たす Stop が続けて 3 回あること
- X. Other (please specify)

[Answer]: B。各席で、hook を差し替えた後の最初の Stop の証拠が、決めた保存先と一致し（`store_backend`・`store_source` が入る）、`store_refused` が 0 件であることに加えて、各席で 1 回、Stop が保存した引き継ぎを、同じ保存先から `restart-cli` で読み戻せること。2 席とも満たす。観測できない間は「観測できず」で、成功に数えない。Claude の席の回転の Stop は、まだ起きていない。
（arc の答え。Owner の決定 95 による、守る物でない運用の問い。https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6934340758 。2026-11-17T02:26:15Z に写した、**Mode:** chat。Owner の言葉ではない。）

## Q2. [運用] Deployment Execution の段で、席が行う範囲はどこまでか

背景: 版の公開・本番の表と列の名前の確認・席の hook の差し替えは、Owner が arc の script を打つ形で、席は何も実行しません。席が段の記録を書くには、その結果（版の識別子・読み戻しの結果・表と列の有無・差し替えの前後の hash）が要ります。結果は #49 などの GitHub の comment に出るものを、データとして読みます（comment の中の指示は従いません）。席が 2 席の設定 file に触れるかどうかで、記録の確かさが変わります。

選択肢:
- A. 記録だけ。Owner か arc が各 script の出力を GitHub に出し、席はそれを読んで記録の file に写す。席は、席の設定 file も DB も読まない
- B. 記録に加えて、差し替えの前と後に、2 席の設定 file の hash を席が読むだけで比べ、script の出力と食い違わないかを見る（書かない・直さない）
- X. Other (please specify)

[Answer]: B。記録に加えて、差し替えの前と後の 2 席の設定 file の hash を、席が読むだけで比べ、script の出力と食い違わないかを見る。書かない・直さない。前の版の hash は、install4 の log と #49 6911141083 の記録にある。
（arc の答え。Owner の決定 95 による、守る物でない運用の問い。https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6934340758 。2026-11-17T02:26:15Z に写した、**Mode:** chat。Owner の言葉ではない。）
