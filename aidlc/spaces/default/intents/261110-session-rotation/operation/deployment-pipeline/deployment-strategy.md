# 配備の方針 — 会話の切り直し（261110-session-rotation）

この記録は、切り直しのコードを Kusabi 自身の席に据える方針を決める。具体の手順は `cd-config.md`、戻し方は `rollback-runbook.md`。この記録を書いた時点で、この段としては何も実行していない（実行の記録は `operation/deployment-execution/deployment-log.md`）。[訂正 2026-11-13] 第 1・2 版の実行（S2〜S4・C2）はその実行の記録にある。第 3 版の手順は、この記録を書いた時点で何も実行していない（S1 の版作りと、読み取りだけの確かめを除く）。

**第 2 版（2026-11-12）**: 第 1 版（PR #341、統合の commit `aa77b683e135beabb9fc54bd3736b47d288d6f46` の版 `1b731f00…`）の据え付けの後、Claude Code 2.1.321 が hook の入力に足した key のために、Kusabi の SessionStart が `MALFORMED_HOOK_INPUT` になる故障が C2 で見つかり、PR #342（統合の commit `94f1ca6d0042bd970d4cc7c4ab9ce9153b7d5c0d`）で直った。第 2 版は、その直しを含む版 `28596bf0915d16b72bd7b5878aadda6ebe7efd7564b6520d0f938eb668e7cd92` へ、席の hook を差し替える方針と順序に改めた。範囲（Kusabi の席だけ）・戻し方つき・DB を変えない点は、第 1 版の Owner の決定のまま。

**第 3 版（2026-11-13）**: 第 2 版の後、PR #344（統合の commit `ffe511e5ec655078dba631997397b371d55131ac`。引き継ぎを確定する順の直し）が入り、Owner が再配備を決めた（下の「第 3 版の決定」）。第 3 版は、版を `5fd29e06bf735432a1186e2bf209eb444aba5413dbb0691d911bbaeaaacf0d8c` に作り直し、**Claude の席**の hook を `28596bf0…` から `5fd29e06…` へ差し替え、**Codex の席**の hook を新しく（今の `dd806dbe…` から）差し替え、見張りを初めて起こす方針と順序に改めた。**この段の方針の違い**: (1) 旧い見張りは存在しない（止める物が無い）。(2) 見張りと hook は同じ版にそろえて、同時に入れ、同時に戻す（arc の判断。席の確かめが支える: `cd-config.md` の「(c) 戻した後の読み」）。(3) arc の決定（技術の判断。Owner の言葉ではない）で、script は **2 本**: 1 本目 = Claude の席の hook（A）＋見張りの設定と起動（S5・S6）＋Codex の席の `hooks.json` だけ（B。見張りには足さない）、2 本目 = Claude の席の実際の切り直しが済んだ後の、Codex の席の起こし直し。席が先に勧めた分け方（Q8 = B）は、arc の分け方で置き換わった。[訂正 2026-11-13] この分けも前の案。今の分け: 1 本目（`install3.sh`）は A → B だけ、Claude の席の起こし直しは arc、関門 O25・S5・停止の印の確かめ・S6 は 2 本目（arc の連絡。`cd-config.md` の「第 3 版の実行の順と関門 O25」）。Codex の席の起こし直しの script の呼び方は arc が決める。(4) 守る物（範囲・DB・戻し方）は、第 1・2 版の Owner の決定と第 3 版の決定のまま。

## 第 3 版の決定

- Owner の決定 `OD-KUSABI-ROTATION-REDEPLOY-A-TO-D-PLUS-CODEX-SEAT-20261113-001`: https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6847683704 （本文の SHA-256 `d2749ed886a695d92f67410057cd2c53888550edd3cfd96a5ab843bf09932e5c`、投稿者 watchout、Owner の原文は「a-dでよい。kusabiだけの影響ならすぐやれ。codexも対応してテストするんだろ？それもやれ」）。
  - 席が進める: (a) #344 の統合の commit から、別の清潔な copy で中身の決まった版を作り直す（済み。`cd-config.md` の S1）、(c) 戻した後に旧い見張りが新しい記録を読めるかを使い捨ての場所で確かめる（済み）。
  - arc が script を作り、arc-sec が読み、Owner が打つ（打つことが承認）: (b) 席の hook を新しい版へ差し替え、新しい見張りを起こす（旧い見張りは無いので止める物が無い）、(d) 席を起こし直し、切り直しを実際に 1 回試す。
  - 範囲は Kusabi の Claude Code の席（tmux `aidlc-kusabi`）に、Kusabi の Codex の席（tmux `kusabi`）を足す。DB の構造・ほかの席・本番には触れない。
- Q8 = B は席の技術の判断（arc の依頼による。守る物ではない）: Claude の席の script と Codex の席の script を分ける（`deployment-pipeline-questions.md`）。[訂正 2026-11-13] arc の分け方（arc の技術の判断で、Owner の言葉ではない）は、1 本目 = Claude の席の hook（A）＋ Codex の席の `hooks.json`（B）＋ Claude の席だけの見張り（S5・S6）、2 本目 = Codex の席の起こし直し。Q8 = B はこの分け方に替わった（`cd-config.md` の前提 8）。[訂正 2026-11-13] この分け方も前の案（上の第 3 版の (3) の訂正と同じ）。
- 以下の「第 1・2 版の決定」の Owner の決定（`OD-KUSABI-ROTATION-DEPLOY-SELF-SEAT-TRIAL-20261111-001`）は、第 3 版でも、据える物の範囲（Claude の席）・戻し方つき・DB を変えない点の根拠として残る。

## 第 1・2 版の決定（出どころ）

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
| 7（第 3 版） | Claude の席の hook 5 つを `28596bf0…` から `5fd29e06…` へ差し替える（3・4 と同じ形・同じ引数。script A） | 展開 |
| 8（第 3 版） | Codex の席の Kusabi の handler 3 つ（版 `dd806dbe…`、存在しない node を指す）を、新しい版の 5 つ（SessionStart 1・Stop 2・UserPromptSubmit 2。先頭は `/opt/homebrew/bin/node`）へ差し替える（script B。Codex の作業場の `.codex/hooks.json` だけ） | 展開 |
| 9（第 3 版） | 見張りを、新しい版で初めて起こす（旧い見張りは無い）。Claude の席だけを登録する（見張りの起動の前に、席の claude の process が新しい hook で起こし直されていることを確かめる関門を置く: O25。(a)(b) の 2 つ。`cd-config.md` の「第 3 版の実行の順と関門 O25」）。Codex の席は、起動の script・確かめの項目（P1〜P4）に加えて、見張りの入力欄の判定が Codex の画面で通ること（O23）が済んだ後に足す | 席の起動 |
| 10（第 3 版） | Codex の席の起動の script を `/tmp` の外に作り直す（arc が作った: `~/Developer/arc/tools/seat-launchers/start-kusabi-codex.sh`、SHA-256 `09f8c869…00b0`、権限 700。席は SHA-256 と権限を読み取りで確かめた。中身は DB の URL を含むので席は写さない）。Codex の席の起こし直しの script（前の記録は「2 本目」と書いた。[訂正 2026-11-13] 呼び方は arc が決める）が起こし直しに使う | 席の起動 |

配り方は `aidlc/spaces/default/memory/team.md` の Deployment のとおり: 席の束ごとに R1 → R2 → R3。各束はすべての席が健全と観測されてから次の束へ進み、失敗した束は設定を元に戻す。今回は R1 の束（Kusabi の席）だけを対象にし、R2 以後には進まない（進むのは結果を見た後の、別の Owner の決定）。

## 順序と関門

どの段も、前の段の「読み戻し」が通ってから次へ進む。読み戻しが通らなければ、その段だけを戻して止まり、Owner に見せる。

| 段 | 内容 | 進んでよい条件（前の関門） | この段の読み戻し |
|---|---|---|---|
| S0 | 前提の確認 | 第 1 版の手順の arc-sec の確かめが通っている（通った: iyasaka-arc#57 6791098364、止める指摘 0。第 2 版の読み直しは S3・S4 の条件 = O12）。起動の script の SHA-256 が登録する値と一致。版の元は #342 の統合の commit `94f1ca6d…`（第 1 版の `aa77b683…` ではない） | `cd-config.md` の S0 の表 |
| S1 | 版を作る（清潔な別の checkout で publish → readback） | S0 | **済み（第 2 版）**: 版 `28596bf0…`、readback が `PASS_EXACT_READBACK`、必須の入口 12 件が一致、`npm audit --omit=dev` が 0 件。版の SHA-256 は arc に渡した。**第 3 版も済み**: 版 `5fd29e06…`（`ffe511e5…` から。同じ確かめ。`cd-config.md` の S1） |
| S2 | 古い常駐を止める | S1 | **第 1 版で済み**。第 2 版は読み戻しだけ取り直す（job が読み込まれていない・無効、誤りの記録の file が増えない） |
| S3・S4 | 席の Kusabi の hook 5 つを新しい版に差し替える（`<作業場>` の claude_code の設定だけ。**Owner が arc の script を 1 回打つ**。席は書かない。rollout の道具は、この作業場を対象にできないため使わない。第 2 版は 1 回の操作） | S2（第 1 版で済み、再確認は読み取りのみ）、S1 の版の SHA-256 が script に入っている、**arc-sec が第 2 版の手順を読み終えている（O12）**、席が手すき、script が書き込みの前に #49 へ投稿する記録の URL と SHA-256 を読み戻しに添えられる | dry-run の数（無関係な hook 3・3）、apply の後の `diff -u` が Kusabi の hook の入れ替えだけ（前後から Kusabi の hook を外すと同じ）、`--check --rotation on --rotation-threshold-tokens 240000` が exact、新しい版を指す Kusabi の hook が 5、前の版を指す hook が 0、5 つの先頭が `/opt/homebrew/bin/node` で実在し実行できる |
| C2 | 席を 1 回起こし直し、SessionStart の証拠・診断の記録・`claude --version` の 1 行を読む（arc が席を起こし直す。この会話は終わる） | S3・S4 | `hook.input_valid: true`、`outcome` が `degraded` でない、`auto_receive.status` と `store_binding`、`forbidden_effects` がすべて 0、診断の記録に無視した key の名前だけ、Claude Code の版の 1 行（`cd-config.md` の「C2 の取り直し」） |
| S5 | 見張りの設定に席を登録し、probe を流す | C2 と、SessionStart の initialUserMessage が効くことの確認（arc の指示。固定の最初の指示を外したため。確かめ方は `cd-config.md` の O5） | probe が読めて、登録の値と一致 |
| S6 | 見張りを tmux の窓で起こす | S5 | 窓が動き、停止の印で止まることを 1 回確かめる |
| S7 | FR9.2 の確かめ（実際に切る） | S6 | `cd-config.md` の S7 の表 |
| 第 3 版 SA | Claude の席の差し替え（script A）。S3・S4 の読み替え: `28596bf0…` → `5fd29e06…` | S1 の版の SHA-256 が script に入っている、GitHub の main の先頭が `ffe511e5…` のまま、**arc-sec が script A を読み終えている**、席が手すき、script が #49 へ投稿する記録の URL と本文の SHA-256 を読み戻しに添えられる | S3・S4 の読み戻し（新しい版を指す 5・前の版 `28596bf0…` を指す 0・先頭が `/opt/homebrew/bin/node`）に、見張りが動いていないことを足す |
| 第 3 版 SB | Codex の席の差し替え（script B）。A の直後に、1 本目の中で行う（Owner の記録の投稿・dry-run・apply・読み戻し） | SA の読み戻しが合う（A が合わなければ B に進まない）、**arc-sec が script を読み終えている**、Codex の閾値の決定（O17 = 200000） | `cd-config.md` の「Codex の席」の順 4・5 |
| 第 3 版 C2 | Claude の席の起こし直し（C2 の取り直し。arc が行う。変わった hook の確認の画面は Owner が押す） | SA・SB | `cd-config.md` の C2 の表 |
| 第 3 版 関門 O25 | 関門 (a) 起動が backup より後、(b) 新しい process の `turn.json`（`host_pid`・`host_started_at`・`at`）が (a) と合う。不一致・観測できずなら止まり、S5 に進まない | C2 と、起こし直した後の最初のターン | `cd-config.md` の「第 3 版の実行の順と関門 O25」 |
| 第 3 版 S5 | Claude の席だけを見張りの設定に登録する（probe は席が先に流した: O22・O23） | 関門 O25 | `cd-config.md` の S5 |
| 第 3 版 停止の印の確かめ | 停止の印を置く → 消す。続けて、印の file が無いこと | S5 | `cd-config.md` の S6 の節の「順の読み替え」 |
| 第 3 版 S6 | 見張りを初めて起こす（席と別の tmux の session、`remain-on-exit on`） | 停止の印の確かめ | `cd-config.md` の S6 |
| 第 3 版 S7 | Claude の席の実際の切り直し（d の 1 回目）。引き継ぎの確定の順（#344）が動くことを読む | S6 | `cd-config.md` の S7 の表（第 3 版で足した 2 行を含む） |
| 第 3 版 C2c | Codex の席の起こし直し（arc の答え: 切り直しは、hook が印を置いたのを席か arc が見て、人（arc）が起動の script で起こし直す。信頼の確認は Owner が画面で行う） | SB、Claude の席の実際の切り直しが済んだこと、新しい起動の script（O13） | `cd-config.md` の C2c の表（`turn.json` の `host_pid` の実体の名前を含む） |
| 第 3 版 S5c〜S7c | Codex の席を見張りの設定に足し（`expected_command` が確かめられた後）、実際に切る。**今は足さない**: 見張りの入力欄の判定が Codex の画面の下の行（モデル名と作業場の行・ショートカットの行）を「空でない」と読み、切り直しが起きない（O23。code の変更は arc の判断） | C2c、O23 の解決 | `cd-config.md` の「見張りへの登録と実際の切り直し」 |

[訂正 2026-11-13] 前の案の表は、SA → C2 → S5・S6 → S7 → SB → C2c の順で、B を S7 の後に置き、SB の条件を「SA〜S7 の読み戻しが合う」と書いた。arc の決めで B は A の直後（1 本目の中）に替わった。上の表の順（SA → SB → C2 → 関門 O25 → S5 → 停止の印の確かめ → S6 → S7 → C2c）が正で、前の案の順は使わない（正本は `cd-config.md` の「第 3 版の実行の順と関門 O25」）。

## 承認の流れ

1. 手順（この記録と `cd-config.md`・`rollback-runbook.md`）を agent-memory#339 に 1 つの comment で出す。arc が arc-sec に確かめを頼む。第 1 版はこの形で出した。
2. 第 1 版の手順は、arc-sec の確かめが通った（iyasaka-arc#57 6791098364、止める指摘 0。直す記録 2・そろえる物 2・S4 以後の条件 9。この記録に反映済み）。**第 2 版は手順の形が変わったので、arc-sec が読み直す**（O12。arc が依頼済み。読み終えるまで Owner に打つ段を渡さない）。それまで、第 2 版の S3・S4 は実行しない。
3. 実行の分担: S0〜S2、S5〜S7 は Kusabi の席が行う。S3 と S4 は、Owner が arc の script を 1 回打つ（席は設定を書かない）。作者が自分の変更を監査・統合しない（次の PR は、独立の監査と suite-lead の統合を通す）。
4. 各段の結果（読み戻し）は #339 に comment で書く。保護面に触れる段（S2〜S6）は、書いた時点の決定の参照（上の Owner の決定）を添える。S3・S4 の読み戻しには、script が #49 に投稿する記録の URL と SHA-256 も添える。
5. S3・S4 の後の最初の人手の起動（C2）は arc が席を起こし直して確かめる。その時この会話は終わるので、それまでに記録と diary を保存する。S5 以後は、その後の会話が行う。第 2 版の C2 は、第 1 版の項目に加えて、診断の記録（無視した key の名前だけ）と `claude --version` の 1 行（FR10.5）を読む。

**第 3 版の承認の流れ**: 席は設定を書かない。この段の記録（`cd-config.md`・`rollback-runbook.md`・この記録）を arc に渡し、script は arc が書く（arc の答え。席が下書きを書こうとしたが、席の柵が、hook の差し替えを扱う script を記録の folder に書くのを拒否した。席は避けていない）。arc の組み: 1 本目の中身 = A（Claude の席）→ B（Codex の席）→ Claude の席を起こし直す（Owner が変わった hook の確認の画面を押す）→ 関門 (a)(b)（O25）→ S5（設定は Claude の席だけ。`prompt_markers` は `❯` と U+00A0 の 2 文字、`placeholder_patterns` は空、`launch_command` は `#{pane_start_command}` と一字一句同じ）→ 停止の印の置く・消すの確かめ → 印の file が無いことの確かめ → S6（別の tmux の session、`remain-on-exit on`）。席が渡す物は、cd-config.md の第 3 版の節と、足りない値（Claude の作業場の `settings.json`・release の root・見張りを起こす command）の読み先。arc-sec が script と、#49 に投稿される記録を読む。Owner が打つ。打つのは席が手すきの時。席が arc に渡す物は、版の SHA-256（`5fd29e06…`）、`cd-config.md` の command の形と引数 A・A-c、戻しの順、Codex の前提 O13〜O17。席は「見張りと hook を同じ版で同時に替える」arc の判断を、確かめの結果（(c)）つきで記録に書いた。S5・S6 は Owner の script の中（arc の決定 O20。probe は席が先に流した: O22・O23）。(d) の切り直しは、閾値に自然に届くのを待つ（arc の決定 O21。閾値を一時に下げる操作は足さない）。[訂正 2026-11-13] script の分け（arc の連絡）: 1 本目の script（`install3.sh`）は A → B だけ。Claude の席の起こし直しは arc が行う。関門 (a)(b)・S5・停止の印の確かめ・印の file が無いことの確かめ・S6 は 2 本目の script（arc が書き、arc-sec が読む）。上の「1 本目の中身 = …」は arc の前の連絡の言い方で、順は変わらず、分けだけが替わった。関門 (a)(b) の入力・取り方・比べ方・不一致で止まることは `cd-config.md` の「第 3 版の実行の順と関門 O25」。

## 止める手段（機能の旗の代わり）

この取り組みに旗の仕組みは使わない。止める手段は 3 つで、どれも設定の変更だけで効く。
- 見張りを止める: 停止の印の file を置く（全体の印、または席ごとの印）。窓を閉じる。
- 席を見張りから外す: 見張りの設定からその席を消す。
- 席の hook の切り直しを止める: hook の引数 `--rotation off`（installer で外す）。

## 範囲の外で、この記録が見つけた点（実行の前に確かめる）

実行の前に、arc と arc-sec に確かめてもらう点を `cd-config.md` の末尾に番号つきで書いた（O1〜O12）。解決した物: O2（範囲は `<作業場>` の claude_code だけ。arc の読み）、O3（rollout の道具はこの作業場を対象にできない。installer を直接当てる）。arc が決めた物（arc の判断で、Owner の言葉ではない）: O1（hook を新しく入れる形で進める。権限は script が #49 へ投稿する記録）、O7（結びつきの値の組み立て方は `cd-config.md`）、O8（席は書かない。arc が、Owner が 1 回だけ打つ script を作った）、O10（閾値は 240000）、O11（この試しは今の node の path のまま、S3 の読み戻しで実在を見る。次の PR で installer に `--node-path` を足す）[訂正: #342 で入り解決済み。下の「第 2 版で足した点」の O11]。arc-sec の確かめは通り（止める指摘 0）、その指摘（D1・D2・E1・E2・C1〜C9）への答えは `cd-config.md` の末尾の表にある。手順の安全に関わる物: O4・O5。

第 3 版で足した点（`cd-config.md` の O13〜O19）: O13（Codex の席の起動の script が無い）、O14（Codex は続きの最初の入力が出ない）、O15（Codex の hook の信頼の確認）、O16（Codex の hook の親 process の実体）、O17（Codex の席の閾値と窓）、O18（Codex の取り込みが始まる効果）、O19（見張りと hook を同じ版で同時に替える）、O20（S5・S6 を誰が行うか）、O21（切り直しを実際に起こす条件）。O13・O14・O17・O20・O21 は arc が決めた（技術の判断。Owner の言葉ではない）: O13 = 起動の script を arc が作った、O14 = 固定の最初の入力を持たせる、O17 = Codex の閾値 200000、O20 = S5・S6 は Owner の script の中、O21 = 自然に届くのを待つ。席の確かめで足した点: O22（Claude の席の入力欄のマーカーは `❯` と NO-BREAK SPACE）、O23（Codex の画面では今の入力欄の判定が通らない）、O24（codex の版の読み違えの訂正）、O25（見張りの起動の前の関門。(a)(b) の 2 つ）。

第 2 版で足した点: O11（第 2 版）は `--node-path` が #342 で入り、版に依らない symlink を指定する形で解決（Q6 = B）。O12 は、手順の形が変わったので arc-sec が読み直す（実行の前の条件。読み終えるまで Owner に打つ段を渡さない）。O5（`initialUserMessage` が効くか）は、印の無い通常の起こし直し（C2）では取れないので、確かめ方を arc に実行の段で伺う（席は決めない。確かめられなければ S6 を始めない）。

#342 で入った物（第 1 版の「次の PR に入れる物」）: 版を作る道具と rollout の必須の入口の一覧への 2 つの追加（Q5）、installer の `--node-path`（既定は今の動きのまま）と試験、`.gitignore` の `.claude/settings.json.bak*`、hook の入力の直し（FR10.1〜FR10.5）。
この取り組みの次の PR（記録の PR）に入れる物（arc の判断）: 統合の後に作った記録（Build and Test・Deployment Pipeline・Deployment Execution の記録と、Code Generation の記録の直し）。[訂正 2026-11-13] 実際の記録の PR は Build and Test・Deployment Pipeline の記録と Code Generation の記録の直しで、Deployment Execution の記録は入れない（席への実行の後に、実行の記録として別に出す）。
