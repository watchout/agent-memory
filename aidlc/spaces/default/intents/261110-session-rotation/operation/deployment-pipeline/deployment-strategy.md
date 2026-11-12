# 配備の方針 — 会話の切り直し（261110-session-rotation）

この記録は、切り直しのコードを Kusabi 自身の席に据える方針を決める。具体の手順は `cd-config.md`、戻し方は `rollback-runbook.md`。この記録を書いた時点で、この段としては何も実行していない（実行の記録は `operation/deployment-execution/deployment-log.md`）。

**第 2 版（2026-11-12）**: 第 1 版（PR #341、統合の commit `aa77b683e135beabb9fc54bd3736b47d288d6f46` の版 `1b731f00…`）の据え付けの後、Claude Code 2.1.321 が hook の入力に足した key のために、Kusabi の SessionStart が `MALFORMED_HOOK_INPUT` になる故障が C2 で見つかり、PR #342（統合の commit `94f1ca6d0042bd970d4cc7c4ab9ce9153b7d5c0d`）で直った。第 2 版は、その直しを含む版 `28596bf0915d16b72bd7b5878aadda6ebe7efd7564b6520d0f938eb668e7cd92` へ、席の hook を差し替える方針と順序に改めた。範囲（Kusabi の席だけ）・戻し方つき・DB を変えない点は、第 1 版の Owner の決定のまま。

## 決定の出どころ

- Owner の決定 `OD-KUSABI-ROTATION-DEPLOY-SELF-SEAT-TRIAL-20261111-001`: https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6790645694 （本文の SHA-256 `6626a95dcafbaac9c6155d2801a466f5fb55090f5200c74ef88083afec5aa5d8`、投稿者 watchout、Owner の原文は「いい」）。
  - Q1 = A（据えるのは Kusabi 自身の席だけ）、Q2 = A（見張りは tmux の窓。止め方は停止の印の file）、Q3 = A（席の hook の差し替えは、切り直しの入った版から作る案 v2、Kusabi の席だけ）、Q4 = A（落ち続けている古い取り込みの常駐を止める。設定と古い build は残す）。
  - 決定は「実行の前に arc-sec が具体の手順を確かめる」を条件にしている。
- Q5 = A は arc の答え（Owner の委任 https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6762288830 。Owner の言葉ではない）: 既にある `kusabi:direct-fleet-rollout` を使い、必須の入口の一覧（版を作る道具と rollout の両方）に `dist/session-rotation-stop.js` と `dist/rotation-watcher.js` を足す。その後の確かめで、rollout の道具は Kusabi の席が読む作業場を対象にできないと分かり、この席には installer を直接当てる（arc の指示）。一覧の変更は #342 で入った（版を作る道具と rollout の両方。版 `28596bf0…` の必須の入口は 12 件）。
- Q6 = B・Q7 = B は arc の答え（同じ委任。Owner の言葉ではない。第 2 版）: hook の node の path は `--node-path /opt/homebrew/bin/node`（#342 の FR10.7）。差し替えは `--rotation on --rotation-threshold-tokens 240000` を付けた 1 回の操作で 5 つを一度に替える。
- 含まない物（決定の「含まないもの」）: ほかの席、取り込みの環境の切り分け（案 B）、溜まった分の取り込み（案 C）、#339 の段 2（MCP server・boot・post-tool-hook）。

## 据える物と、前の段までに決まっていた配り方

| 番号 | 据える物 | 区分 |
|---|---|---|
| 1 | 中身の決まった版（`dist/` 全体を内容の SHA-256 で名付けた release） | 展開 |
| 2 | 席の起動の script の登録（見張りの設定に、起動の command と script の SHA-256 を結ぶ） | 席の起動 |
| 3 | Kusabi の席が読む作業場の設定の取り込みの hook 3 つ（SessionStart 1・Stop 1・UserPromptSubmit 1）を、新しい版（`28596bf0…`）に差し替える（その作業場だけ。第 1 版で入れた物の差し替え） | 展開 |
| 4 | 切り直しの hook 2 つ（Stop 1・UserPromptSubmit 1）を新しい版に差し替える。3 と 4 は 1 回の操作（Q7 = B）で、hook の command の先頭は `/opt/homebrew/bin/node`（Q6 = B） | 席の hook |
| 5 | 見張りを tmux の窓で起こす | 席の起動 |
| 6 | 取り込みの古い常駐を止める（launchd の job） | 展開 |

配り方は `aidlc/spaces/default/memory/team.md` の Deployment のとおり: 席の束ごとに R1 → R2 → R3。各束はすべての席が健全と観測されてから次の束へ進み、失敗した束は設定を元に戻す。今回は R1 の束（Kusabi の席）だけを対象にし、R2 以後には進まない（進むのは結果を見た後の、別の Owner の決定）。

## 順序と関門

どの段も、前の段の「読み戻し」が通ってから次へ進む。読み戻しが通らなければ、その段だけを戻して止まり、Owner に見せる。

| 段 | 内容 | 進んでよい条件（前の関門） | この段の読み戻し |
|---|---|---|---|
| S0 | 前提の確認 | 第 1 版の手順の arc-sec の確かめが通っている（通った: iyasaka-arc#57 6791098364、止める指摘 0。第 2 版の読み直しは S3・S4 の条件 = O12）。起動の script の SHA-256 が登録する値と一致。版の元は #342 の統合の commit `94f1ca6d…`（第 1 版の `aa77b683…` ではない） | `cd-config.md` の S0 の表 |
| S1 | 版を作る（清潔な別の checkout で publish → readback） | S0 | **済み（第 2 版）**: 版 `28596bf0…`、readback が `PASS_EXACT_READBACK`、必須の入口 12 件が一致、`npm audit --omit=dev` が 0 件。版の SHA-256 は arc に渡した |
| S2 | 古い常駐を止める | S1 | **第 1 版で済み**。第 2 版は読み戻しだけ取り直す（job が読み込まれていない・無効、誤りの記録の file が増えない） |
| S3・S4 | 席の Kusabi の hook 5 つを新しい版に差し替える（`<作業場>` の claude_code の設定だけ。**Owner が arc の script を 1 回打つ**。席は書かない。rollout の道具は、この作業場を対象にできないため使わない。第 2 版は 1 回の操作） | S2（第 1 版で済み、再確認は読み取りのみ）、S1 の版の SHA-256 が script に入っている、**arc-sec が第 2 版の手順を読み終えている（O12）**、席が手すき、script が書き込みの前に #49 へ投稿する記録の URL と SHA-256 を読み戻しに添えられる | dry-run の数（無関係な hook 3・3）、apply の後の `diff -u` が Kusabi の hook の入れ替えだけ（前後から Kusabi の hook を外すと同じ）、`--check --rotation on --rotation-threshold-tokens 240000` が exact、新しい版を指す Kusabi の hook が 5、前の版を指す hook が 0、5 つの先頭が `/opt/homebrew/bin/node` で実在し実行できる |
| C2 | 席を 1 回起こし直し、SessionStart の証拠・診断の記録・`claude --version` の 1 行を読む（arc が席を起こし直す。この会話は終わる） | S3・S4 | `hook.input_valid: true`、`outcome` が `degraded` でない、`auto_receive.status` と `store_binding`、`forbidden_effects` がすべて 0、診断の記録に無視した key の名前だけ、Claude Code の版の 1 行（`cd-config.md` の「C2 の取り直し」） |
| S5 | 見張りの設定に席を登録し、probe を流す | C2 と、SessionStart の initialUserMessage が効くことの確認（arc の指示。固定の最初の指示を外したため。確かめ方は `cd-config.md` の O5） | probe が読めて、登録の値と一致 |
| S6 | 見張りを tmux の窓で起こす | S5 | 窓が動き、停止の印で止まることを 1 回確かめる |
| S7 | FR9.2 の確かめ（実際に切る） | S6 | `cd-config.md` の S7 の表 |

## 承認の流れ

1. 手順（この記録と `cd-config.md`・`rollback-runbook.md`）を agent-memory#339 に 1 つの comment で出す。arc が arc-sec に確かめを頼む。第 1 版はこの形で出した。
2. 第 1 版の手順は、arc-sec の確かめが通った（iyasaka-arc#57 6791098364、止める指摘 0。直す記録 2・そろえる物 2・S4 以後の条件 9。この記録に反映済み）。**第 2 版は手順の形が変わったので、arc-sec が読み直す**（O12。arc が依頼済み。読み終えるまで Owner に打つ段を渡さない）。それまで、第 2 版の S3・S4 は実行しない。
3. 実行の分担: S0〜S2、S5〜S7 は Kusabi の席が行う。S3 と S4 は、Owner が arc の script を 1 回打つ（席は設定を書かない）。作者が自分の変更を監査・統合しない（次の PR は、独立の監査と suite-lead の統合を通す）。
4. 各段の結果（読み戻し）は #339 に comment で書く。保護面に触れる段（S2〜S6）は、書いた時点の決定の参照（上の Owner の決定）を添える。S3・S4 の読み戻しには、script が #49 に投稿する記録の URL と SHA-256 も添える。
5. S3・S4 の後の最初の人手の起動（C2）は arc が席を起こし直して確かめる。その時この会話は終わるので、それまでに記録と diary を保存する。S5 以後は、その後の会話が行う。第 2 版の C2 は、第 1 版の項目に加えて、診断の記録（無視した key の名前だけ）と `claude --version` の 1 行（FR10.5）を読む。

## 止める手段（機能の旗の代わり）

この取り組みに旗の仕組みは使わない。止める手段は 3 つで、どれも設定の変更だけで効く。
- 見張りを止める: 停止の印の file を置く（全体の印、または席ごとの印）。窓を閉じる。
- 席を見張りから外す: 見張りの設定からその席を消す。
- 席の hook の切り直しを止める: hook の引数 `--rotation off`（installer で外す）。

## 範囲の外で、この記録が見つけた点（実行の前に確かめる）

実行の前に、arc と arc-sec に確かめてもらう点を `cd-config.md` の末尾に番号つきで書いた（O1〜O12）。解決した物: O2（範囲は `<作業場>` の claude_code だけ。arc の読み）、O3（rollout の道具はこの作業場を対象にできない。installer を直接当てる）。arc が決めた物（arc の判断で、Owner の言葉ではない）: O1（hook を新しく入れる形で進める。権限は script が #49 へ投稿する記録）、O7（結びつきの値の組み立て方は `cd-config.md`）、O8（席は書かない。arc が、Owner が 1 回だけ打つ script を作った）、O10（閾値は 240000）、O11（この試しは今の node の path のまま、S3 の読み戻しで実在を見る。次の PR で installer に `--node-path` を足す）。arc-sec の確かめは通り（止める指摘 0）、その指摘（D1・D2・E1・E2・C1〜C9）への答えは `cd-config.md` の末尾の表にある。手順の安全に関わる物: O4・O5。

第 2 版で足した点: O11（第 2 版）は `--node-path` が #342 で入り、版に依らない symlink を指定する形で解決（Q6 = B）。O12 は、手順の形が変わったので arc-sec が読み直す（実行の前の条件。読み終えるまで Owner に打つ段を渡さない）。O5（`initialUserMessage` が効くか）は、印の無い通常の起こし直し（C2）では取れないので、確かめ方を arc に実行の段で伺う（席は決めない。確かめられなければ S6 を始めない）。

#342 で入った物（第 1 版の「次の PR に入れる物」）: 版を作る道具と rollout の必須の入口の一覧への 2 つの追加（Q5）、installer の `--node-path`（既定は今の動きのまま）と試験、`.gitignore` の `.claude/settings.json.bak*`、hook の入力の直し（FR10.1〜FR10.5）。
この取り組みの次の PR（記録の PR）に入れる物（arc の判断）: 統合の後に作った記録（Build and Test・Deployment Pipeline・Deployment Execution の記録と、Code Generation の記録の直し）。
