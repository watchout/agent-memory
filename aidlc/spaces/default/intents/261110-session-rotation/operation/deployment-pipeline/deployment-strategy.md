# 配備の方針 — 会話の切り直し（261110-session-rotation）

この記録は、切り直しのコード（PR #341、統合の commit `aa77b683e135beabb9fc54bd3736b47d288d6f46`）を、Kusabi 自身の席に据える方針を決める。具体の手順は `cd-config.md`、戻し方は `rollback-runbook.md`。この記録を書いた時点で、何も実行していない。

## 決定の出どころ

- Owner の決定 `OD-KUSABI-ROTATION-DEPLOY-SELF-SEAT-TRIAL-20261111-001`: https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6790645694 （本文の SHA-256 `6626a95dcafbaac9c6155d2801a466f5fb55090f5200c74ef88083afec5aa5d8`、投稿者 watchout、Owner の原文は「いい」）。
  - Q1 = A（据えるのは Kusabi 自身の席だけ）、Q2 = A（見張りは tmux の窓。止め方は停止の印の file）、Q3 = A（席の hook の差し替えは、切り直しの入った版から作る案 v2、Kusabi の席だけ）、Q4 = A（落ち続けている古い取り込みの常駐を止める。設定と古い build は残す）。
  - 決定は「実行の前に arc-sec が具体の手順を確かめる」を条件にしている。
- Q5 = A は arc の答え（Owner の委任 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6762288830 。Owner の言葉ではない）: 既にある `kusabi:direct-fleet-rollout` を使い、必須の入口の一覧（版を作る道具と rollout の両方）に `dist/session-rotation-stop.js` と `dist/rotation-watcher.js` を足す。その後の確かめで、rollout の道具は Kusabi の席が読む作業場を対象にできないと分かり、この席には installer を直接当てる（arc の指示）。Q5 の一覧の変更のうち、版を作る道具の側はこの席に効く。rollout の側はこの席には効かないが、登録された席に広げる時に要るので、arc の決めで、この取り組みの次の PR に残す。
- 含まない物（決定の「含まないもの」）: ほかの席、取り込みの環境の切り分け（案 B）、溜まった分の取り込み（案 C）、#339 の段 2（MCP server・boot・post-tool-hook）。

## 据える物と、前の段までに決まっていた配り方

| 番号 | 据える物 | 区分 |
|---|---|---|
| 1 | 中身の決まった版（`dist/` 全体を内容の SHA-256 で名付けた release） | 展開 |
| 2 | 席の起動の script の登録（見張りの設定に、起動の command と script の SHA-256 を結ぶ） | 席の起動 |
| 3 | Kusabi の席が読む作業場の設定に、取り込みの hook を新しい版で入れる（その作業場だけ） | 展開 |
| 4 | 切り直しの Stop・UserPromptSubmit の hook を有効にする | 席の hook |
| 5 | 見張りを tmux の窓で起こす | 席の起動 |
| 6 | 取り込みの古い常駐を止める（launchd の job） | 展開 |

配り方は `aidlc/spaces/default/memory/team.md` の Deployment のとおり: 席の束ごとに R1 → R2 → R3。各束はすべての席が健全と観測されてから次の束へ進み、失敗した束は設定を元に戻す。今回は R1 の束（Kusabi の席）だけを対象にし、R2 以後には進まない（進むのは結果を見た後の、別の Owner の決定）。

## 順序と関門

どの段も、前の段の「読み戻し」が通ってから次へ進む。読み戻しが通らなければ、その段だけを戻して止まり、Owner に見せる。

| 段 | 内容 | 進んでよい条件（前の関門） | この段の読み戻し |
|---|---|---|---|
| S0 | 前提の確認 | arc-sec の確かめが通っている（通った: iyasaka-arc#57 6791098364、止める指摘 0）。起動の script の SHA-256 が登録する値と一致。版の元は今の main の `aa77b683…`（次の PR の統合は待たない） | `cd-config.md` の S0 の表 |
| S1 | 版を作る（清潔な別の checkout で publish → readback） | S0 | readback が `PASS_EXACT_READBACK`、`dist/` の 3 つの file（切り直しの 2 つと installer）が実在、`npm audit --omit=dev` が 0 件。版の SHA-256 を arc に渡す |
| S2 | 古い常駐を止める | S1 | job が読み込まれていない・無効、誤りの記録の file が増えない |
| S3 | 席の取り込みの hook を入れる（`<作業場>` の claude_code の設定だけ。**Owner が arc の script を 1 回打つ**。席は書かない。rollout の道具は、この作業場を対象にできないため使わない） | S2、S1 の版の SHA-256 が script に入っている、script が書き込みの前に #49 へ投稿する記録の URL と SHA-256 を読み戻しに添えられる | dry-run の数（無関係な hook 3・3）、apply の後の `diff -u` が取り込みの hook の追加だけ、`--check` が exact、hook の node が実在し実行できる、取り込みの hook が S1 の版を指す |
| S4 | 切り直しの hook を有効にする（同じ script が S3 の読み戻しの後に続ける） | S3 | dry-run の数（3・3）、`diff -u` が切り直しの hook の追加だけ、`--check --rotation on` が exact、次の SessionStart の証拠に切り直しの項目が出る |
| S5 | 見張りの設定に席を登録し、probe を流す | S4 と、SessionStart の initialUserMessage が効くことの確認（arc の指示。固定の最初の指示を外したため） | probe が読めて、登録の値と一致 |
| S6 | 見張りを tmux の窓で起こす | S5 | 窓が動き、停止の印で止まることを 1 回確かめる |
| S7 | FR9.2 の確かめ（実際に切る） | S6 | `cd-config.md` の S7 の表 |

## 承認の流れ

1. 手順（この記録と `cd-config.md`・`rollback-runbook.md`）を agent-memory#339 に 1 つの comment で出す。arc が arc-sec に確かめを頼む。
2. arc-sec の確かめは通った（iyasaka-arc#57 6791098364、止める指摘 0。直す記録 2・そろえる物 2・S4 以後の条件 9。この記録に反映済み）。それまでどの段も実行していない。
3. 実行の分担: S0〜S2、S5〜S7 は Kusabi の席が行う。S3 と S4 は、Owner が arc の script を 1 回打つ（席は設定を書かない）。作者が自分の変更を監査・統合しない（次の PR は、独立の監査と suite-lead の統合を通す）。
4. 各段の結果（読み戻し）は #339 に comment で書く。保護面に触れる段（S2〜S6）は、書いた時点の決定の参照（上の Owner の決定）を添える。S3・S4 の読み戻しには、script が #49 に投稿する記録の URL と SHA-256 も添える。
5. S3・S4 の後の最初の人手の起動（C2）は arc が席を起こし直して確かめる。その時この会話は終わるので、それまでに記録と diary を保存する。S5 以後は、その後の会話が行う。

## 止める手段（機能の旗の代わり）

この取り組みに旗の仕組みは使わない。止める手段は 3 つで、どれも設定の変更だけで効く。
- 見張りを止める: 停止の印の file を置く（全体の印、または席ごとの印）。窓を閉じる。
- 席を見張りから外す: 見張りの設定からその席を消す。
- 席の hook の切り直しを止める: hook の引数 `--rotation off`（installer で外す）。

## 範囲の外で、この記録が見つけた点（実行の前に確かめる）

実行の前に、arc と arc-sec に確かめてもらう点を `cd-config.md` の末尾に番号つきで書いた（O1〜O11）。解決した物: O2（範囲は `<作業場>` の claude_code だけ。arc の読み）、O3（rollout の道具はこの作業場を対象にできない。installer を直接当てる）。arc が決めた物（arc の判断で、Owner の言葉ではない）: O1（hook を新しく入れる形で進める。権限は script が #49 へ投稿する記録）、O7（結びつきの値の組み立て方は `cd-config.md`）、O8（席は書かない。arc が、Owner が 1 回だけ打つ script を作った）、O10（閾値は 240000）、O11（この試しは今の node の path のまま、S3 の読み戻しで実在を見る。次の PR で installer に `--node-path` を足す）。arc-sec の確かめは通り（止める指摘 0）、その指摘（D1・D2・E1・E2・C1〜C9）への答えは `cd-config.md` の末尾の表にある。手順の安全に関わる物: O4・O5。

この取り組みの次の PR に入れる物（arc の判断）: 版を作る道具と rollout の必須の入口の一覧への 2 つの追加（Q5、rollout 側も残す）、installer の `--node-path`（既定は今の動きのまま）と試験、統合の後に作った記録（#341 の統合の後に作った記録を含む）。
