# 配備の設定 — 具体の手順（261110-session-rotation）

方針は `deployment-strategy.md`、戻し方は `rollback-runbook.md`。この記録は手順を書くだけで、何も実行していない。[訂正 2026-11-13] 第 1・2 版の手順の実行（S2・S3・S4・C2）は `operation/deployment-execution/` の記録にある。第 3 版の手順（S3〜S7 と、Codex の席の B・起こし直し）は、この記録を書いた時点で何も実行していない（S1 の版作りと、読み取りだけの確かめを除く）。agent-memory#339 に出した手順を arc-sec が確かめ、通った（iyasaka-arc#57 6791098364、止める指摘 0。第 1 版の手順に対して）。その指摘への答えは末尾の表。実行は、この段の承認の後の「Deployment Execution」で行う。

**第 2 版（2026-11-12）**: 第 1 版の据え付け（S0〜S4 と C2、実行の記録 `deployment-log.md`）の後、C2 で Claude Code 2.1.321 が hook の入力に足した key のために Kusabi の SessionStart が `MALFORMED_HOOK_INPUT` になる故障が見つかり、PR #342（統合の commit `94f1ca6d0042bd970d4cc7c4ab9ce9153b7d5c0d`）で直った。この第 2 版は、その後の「やり直し」の手順で、第 1 版からの違いは次の 5 点:
1. 版の元が `94f1ca6d…`（#342 の統合の commit）になり、版は `28596bf0915d16b72bd7b5878aadda6ebe7efd7564b6520d0f938eb668e7cd92` を作り直した（S1 は済み。実行の記録の「S1 のやり直し」）。
2. 席の設定には、Kusabi の hook が既に 5 つ入っている（SessionStart 1・Stop 2・UserPromptSubmit 2。すべて旧い版 `1b731f00…` と版つきの node の path を指す）。S3・S4 は「新規の追加」でなく「新しい版への差し替え」になる。
3. Q5（必須の入口の一覧に切り直しの 2 つ）・installer の `--node-path`・`.gitignore` の backup の 1 行は、#342 で入った。「次の PR」とした記述は直した。
4. S5 の前に、C2 を取り直す（SessionStart の証拠が入力を読めていること、診断の記録、`claude --version` の 1 行。下の「C2 の取り直し」）。
5. S0 の Owner の決定・S2（古い常駐を止める）は第 1 版で済みで、やり直さない。再確認は読み取りだけ。

**第 3 版（2026-11-13）**: 第 2 版の据え付け（S3・S4 の差し替えと C2 の取り直し）の後、取り組みの construction へ戻り、PR #344（統合の commit `ffe511e5ec655078dba631997397b371d55131ac`。引き継ぎを「使った」と記録する順の直しなど）が入り、Build and Test が済んだ。Owner の新しい決定 `OD-KUSABI-ROTATION-REDEPLOY-A-TO-D-PLUS-CODEX-SEAT-20261113-001`（https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6847683704 、本文の SHA-256 `d2749ed886a695d92f67410057cd2c53888550edd3cfd96a5ab843bf09932e5c`）が、版の作り直しと再配備と Codex の席への拡張を求めた。第 3 版は第 2 版からの次の 8 点が違う:
1. 版の元が `ffe511e5…`（#344 の統合の commit）になり、版は `5fd29e06bf735432a1186e2bf209eb444aba5413dbb0691d911bbaeaaacf0d8c` を作った（S1 は済み。下の S1）。旧い版 `28596bf0…`（席の hook が今指している版）・`1b731f00…` などは消さない。
2. Claude の席の hook は、今 `28596bf0…` を指す 5 つ（第 2 版で差し替え済み。C2 は第 4 回で合格）。S3・S4 は「`28596bf0…` から `5fd29e06…` への差し替え」になる。戻した時に着く状態は、旧い版 `1b731f00…` でなく、動いている `28596bf0…` の 5 つになる。
3. 旧い見張りは存在しない（第 1・2 回は S5・S6 を起こしていない。`ps` に rotation-watcher が無く、見張りの設定・記録・停止の印の file も無いことを読み取りで確かめた）。(b) の「旧い見張りを止める」は止める物が無く、新しい見張りは初めて起こす。見張りと hook の版をそろえる決まり（arc の判断）は、hook を新しい版へ替えて確かめた後にだけ、見張りへ席を登録して守る。
4. 範囲に Kusabi の Codex の席（tmux `kusabi`）が入った。Codex の席の手順は、下の「Codex の席（第 3 版で足す）」の節に分けて書く。**Claude の席と Codex の席は、2 つの script にする**（Q8 = B）。[訂正 2026-11-13] 下の 8 のとおり、arc の分け方（技術の判断で、Owner の言葉ではない）は、1 本目に Claude の席の hook の差し替え（A）と Codex の席の `hooks.json` の差し替え（B）を入れ、2 本目は Codex の席の起こし直しだけ。この行の「2 つの script」は第 2 版の席の勧めで、今は arc の分け方が正しい。
5. 戻した後に旧い見張りが新しい記録を読めるかの確かめ（(c)）を、使い捨ての場所で行った（下の「(c) 戻した後の読み」）。
6. 切り直しの閾値 240000・`--node-path /opt/homebrew/bin/node`・1 回の操作で 5 つを替える形（Q6 = B・Q7 = B）は、第 2 版のまま。
7. 範囲の外で見つけた点に O13〜O25 を足した（「範囲の外で見つけた点」の表）。O13・O14・O17・O20・O21 は arc の判断で解決した（各行の「（行き先）」）。O22〜O25 は、席が読み取りの probe と code の読みで見つけた点。
8. 2026-11-13、arc が Owner の script の分け方を決めた（O20 の行き先）: 1 本目 = Claude の席の hook の差し替え（A）＋ Codex の席の `hooks.json` の差し替え（B）＋ Claude の席だけの見張り（S5・S6）。2 本目 = Codex の席の起こし直し（`<arc の持ち物>/tools/seat-launchers/start-kusabi-codex.sh`）。席が下書きを同じ記録の directory に置く（`owner-script-1.sh`・`owner-script-2.sh`。席は流さない）。[訂正 2026-11-13] この下書きは作られていない。席の柵が、hook の差し替えを扱う script を記録の folder に書くのを拒否し、arc の答えで、席は下書きを置かず arc が script を書く形に改めた（`memory.md` の同じ日の記録）。第 2 版の Q8 = B（Claude・Codex の 2 本）は、arc の分け方に替わった。[訂正 2026-11-13] この 1 本目・2 本目の分けも前の案。今の分けは、下の「第 3 版の実行の順と関門 O25」の節（arc の連絡）。

表記の決まり: 絶対 path は書かない。`<作業場>` は Kusabi の席が読む AI-DLC の作業場（この repo の clone）、`<release>` は S1 で作る中身の決まった版の root、`<席の起動の script>` は Kusabi 自身の席の起動の script（作業場の外にある。arc が作った物）。見張りの置き場は `<rotation root>`（切り直しの記録の root。見張りの設定 `watcher-config.json`・停止の印 `HALT`・記録 `watcher-ledger.jsonl` が下にある）。

## S0 前提の確認（書き込みなし。第 2 版は読み取りだけで再確認する）

| 確認 | 期待する値 | 見る方法 |
|---|---|---|
| Owner の決定 | `OD-KUSABI-ROTATION-DEPLOY-SELF-SEAT-TRIAL-20261111-001`、本文 SHA-256 `6626a95dcafbaac9c6155d2801a466f5fb55090f5200c74ef88083afec5aa5d8`。第 2 版も同じ決定の範囲（Q1 = A: Kusabi 自身の席だけ。Q3 = A: 切り直しが入った版 `aa77b683` 以後から作る案で、その席の hook を替える）。`94f1ca6d` は `aa77b683` の後。**第 3 版**: 上の新しい決定（`OD-KUSABI-ROTATION-REDEPLOY-A-TO-D-PLUS-CODEX-SEAT-20261113-001`、#49 6847683704、本文 SHA-256 `d2749ed886a695d92f67410057cd2c53888550edd3cfd96a5ab843bf09932e5c`）が範囲を広げた。Kusabi の Claude Code の席に、Codex の席を足す。DB の構造・ほかの席・本番には触れない | GitHub の comment を取り直して数える（両方） |
| 版の元 | **第 3 版**: main の `ffe511e5ec655078dba631997397b371d55131ac`（PR #344 の統合の commit。統合の後の main の CI run 43346320385 は success）。第 2 版の `94f1ca6d…` と第 1 版の `aa77b683…` は使わない。2026-11-13 に GitHub の API で取り直し、GitHub の main の先頭が `ffe511e5…` と同一（compare の `status=identical`）と確かめた | 実行の時に、GitHub の main の先頭を取り直して 40 桁が `ffe511e5…` と同じか確かめる（違えば、新しい統合が入ったので、この版の SHA-256 は使わず席が arc に知らせる）。作る場所の head が 40 桁と一致 |
| 席の設定の今の状態（Claude の席） | **第 3 版**: Kusabi の hook が 5 つ（SessionStart 1・Stop 2・UserPromptSubmit 2）で、すべて版 `28596bf0…` と `/opt/homebrew/bin/node` を指す（第 2 版で差し替え済み。2026-11-13 に席が読み取りで数え直した）。無関係な hook は SessionStart 1・Stop 1・UserPromptSubmit 1 の 3・3（ほか PreToolUse・PostToolUse・SessionEnd・PreCompact・SubagentStop は数えない） | 実行の時に、同じ数え方で取り直す（command の中身は読み戻しに書かない。版の SHA-256 の先頭 8 桁と node の folder 名だけ） |
| 席の設定の今の状態（Codex の席） | 作業場（Codex の席が読む、Kusabi の登録された作業場）の `.codex/hooks.json`（0600）に Kusabi の handler が 3 つ（SessionStart 1・Stop 1・UserPromptSubmit 1）。3 つとも古い版 `dd806dbe…`（2026-08-14 に入れた物）と、**存在しない版つきの node の path**（Homebrew の `node/25.6.1_1`。今あるのは 26.13.1 だけ）を指し、`--runtime-event-manifest` を持つ。つまり今、Codex の席の取り込みの hook は起動できない。無関係な handler は 0。3 つの handler の `--binding-source-ref`・`--runtime-event-manifest`・`--workspace`・`--agent-id`・`--project`・上限 3 つの値は、3 つで同一（値の SHA-256 の先頭 10 桁の集合の大きさが 1 で確かめた。席が 2026-11-13 に読み取りで確かめた） | 実行の時に、同じ数え方で取り直す。`hooks.json` は git の管理外（無視もされていない未追跡）なので、PR に載らないよう、記録・PR に値を貼らない |
| Claude の席の起動の script・画面（第 3 版でも） | script の SHA-256 は `496f71ff046d0f0db5afab0064b9a18da1eb3c853a0f19a66d4ae6df203d4126` のまま（2026-11-13 に取り直して一致）。tmux `aidlc-kusabi:0.0` の起動 command は `bash <席の起動の script>; exec zsh -l` の形のまま。`claude --version` は 2.1.321 | 実行の時に取り直す |
| Codex の席の起動の script・画面（第 3 版） | tmux `kusabi:0.0` の起動 command は `/bin/bash <起動の script>` の形で、指す script は `/tmp/codex-leads-restart-20261016/` の下にあったが、**今は存在しない**（`ls` が「No such file」。2026-11-13 に確かめた）。席の process は 2026-10-16 から動いていて、pane の下の process の木は `bash` → `node`（codex の wrapper）→ `codex`（native の binary）。`codex --version` は 0.166.0。同じ形の起動 script を使う Onza・Totonoe の Codex の席も同じ状態 | 起動の script を、`/tmp` の外に置く新しい物へ arc が作り直す（O13）。作った物の SHA-256 を、見張りの設定に登録する値として使う |
| 作る場所 | 作業場とは別の、清潔な checkout。版を作る道具は「作業場が清潔で、head が `--expected-head` と一致」を要求する（`SOURCE_BOUNDARY_FAILED`）。作業場は別の branch にあり、AI-DLC の記録が未コミットなので、ここでは流せない | 作る場所で `git status --porcelain=v1 --untracked-files=all` が空 |
| 起動の script の SHA-256 | `496f71ff046d0f0db5afab0064b9a18da1eb3c853a0f19a66d4ae6df203d4126`（arc が固定の最初の指示を外した版） | `shasum -a 256 <席の起動の script>`。違えば登録せず arc に知らせる |
| 席の画面 | tmux の窓 `aidlc-kusabi`、pane の起動 command が `bash <席の起動の script>; exec zsh -l` の形 | `tmux display-message -p -t aidlc-kusabi:0.0 '#{pane_start_command}'` |
| 古い常駐 | 第 1 版の S2 で止めて無効にした（`launchctl print` は `Could not find service`、`print-disabled` は disabled、誤りの記録の file は止めた時の 110,355,058 byte のまま）。第 2 版は読み戻しだけを取り直す。**戻っていたら（読み込まれている・増えている）止めて、Owner に見せる** | `launchctl print`・`launchctl print-disabled`（読むだけ）と file の大きさ |
| DB | 変えない。この手順は DB へ書かない | 手順のどの段も DB の URL を渡さない |

## S1 中身の決まった版を作る（第 3 版: 済み。2026-11-13、席が行った。席への効果なし）

S1 は第 3 版の (a) として 2026-11-13 に済んだ（実行の記録は Deployment Execution の段で書く）。版は `5fd29e06bf735432a1186e2bf209eb444aba5413dbb0691d911bbaeaaacf0d8c`。手順は第 2 版と同じ形で、結果は次のとおり:

| 項目 | 値 |
|---|---|
| 作った場所 | 席の一時 directory の清潔な別の clone（GitHub から `git clone` して `ffe511e5…` に `--detach`）。作業場と release の置き場の外。`git status --porcelain=v1 --untracked-files=all` は作る前も後も 0 行 |
| publish | `--mode publish --expected-head ffe511e5ec655078dba631997397b371d55131ac`。終了 0、`FINAL_CAS_PUBLISHED_AND_VERIFIED`、`ATOMIC_RENAME_NEW_CAS`、protected_effects = 版の公開 1・rollout 0・restart 0。source tree `c6429cb71ce3ce5e8caad47c08944d35e668adb0` |
| 版の SHA-256 | `5fd29e06bf735432a1186e2bf209eb444aba5413dbb0691d911bbaeaaacf0d8c`（`descriptor_sha256`。席が `release.json` の SHA-256 を取り直して release の directory 名と一致） |
| readback | `--mode readback --release-sha <版>`。終了 0、`PASS_EXACT_READBACK`。`runtime_tree_sha256` = `d7ff0de11ee0b3cf2d3c6d89bd8018fdbf0c7c49f844feaf10de5e15f4db5eb3`、`dist_tree_sha256` = `e93c1bafcbca487f917e27b946370f24ee60131eac6a344836ce0e072911b2f1`、`conformance_sha256` = `1bcead54f1d43be7d1f4d41af5b214d615f31695515dcf3f3caf871819c8b3b5` |
| 必須の入口 | `release.json` の `required_entrypoint_sha256_map` は 12 件（`dist/session-rotation-stop.js`・`dist/rotation-watcher.js` を含む）。席が 12 件すべての SHA-256 を取り直して一致（不一致 0）、symlink 0 |
| installer | 一覧の外の file なので別に取った。`dist/claude-hook-installer.js` = `422041d19e565e77f1d4e4fbd084e05801a5b573816e3e747c2bf051713dd8f8`、`dist/codex-hook-installer.js` = `57e0452906a15c6a60a241d1fb75e41203ca2aaddc124c956a498cc87f541c4f`。どちらも通常の file（symlink でない） |
| hook の入口の SHA-256 | `dist/session-rotation-stop.js` = `c7b0d097e03a93ff4e57afa617879afad4edbb79a8a2a1ec45305b101eec2fd3`（前の版から変わった）、`dist/rotation-watcher.js` = `d79947366454d4ea96fd6d2aa3418f29d052c12e6120b249d0e607973e82e273`（前の版と同じ。ただし見張りが読み込む `rotation-watcher-core`・`-store`・`-attempt` は #344 で変わっている）、`dist/claude-session-start.js` = `088974cbe53f6fe0d74c6b5eba2bea3e342af06e564ee99886d96e027c27f9dc`、`dist/codex-session-start.js` = `6d5e88fed89ee1cf0b1a1df8b8870f576a79616eda7d4a6525d6d6397cfe2193`、`dist/transcript-stop-capture.js` = `9507790a88efdd5fb9dac6e28a4c7f4f33cf21a69bef80ef856f64217d32a4b1` |
| 依存の脆弱性の確かめ | 作った場所での `npm audit --omit=dev` は 0 件。node は v26.13.1（`release.json` の記録） |

出来た版は消さず、古い版（`28596bf0…`=今の Claude の席の hook が指す版、`1b731f00…`、`dd806dbe…`=今の Codex の席の hook が指す版、ほか）もそのまま残す。この版の SHA-256 は arc に渡す（script に入れる値）。版を作る手順（一時の clone・`--expected-head` の 40 桁・readback）を、実行の時に取り直すのは、GitHub の main の先頭が変わっていた時だけ（S0 の「版の元」）。

## S2 取り込みの古い常駐を止める（Q4 = A。第 1 版で済み。第 2 版は S0 の再確認だけ）

1. 止める前に、`launchctl print` の出力と plist の SHA-256 を証拠に取る。
2. `launchctl bootout gui/<uid>/com.watchout.wasurezu.raw-capture` で止め、`launchctl disable gui/<uid>/com.watchout.wasurezu.raw-capture` で無効にする。plist・設定の file・古い build は消さない。
3. 読み戻し: job が読み込まれていない・無効、誤りの記録の file の大きさが増えない。
4. 戻し: `launchctl enable …` と `launchctl bootstrap gui/<uid> <plist>`（Owner の決定が要る。`rollback-runbook.md`）。

## S3・S4 Claude の席の Kusabi の hook を新しい版に差し替える（第 3 版は `28596bf0…` → `5fd29e06…`。1 回の操作。Q3 = A、Q6 = B、Q7 = B。Codex の席の `hooks.json` の差し替え（B）は下の別の節。arc の分けで 1 本目の中で A の後に続ける）

**第 3 版の読み替え**（この節の第 2 版の文は、次のとおり読み替える。command の形・引数・読み戻しの数は変わらない）: `<release>` は `5fd29e06…`（S1）、「前の版」は `28596bf0…`（第 2 版の差し替えで入れた版。`1b731f00…` ではない）、差し替え前の hook は 5 つとも `28596bf0…` を指す、前の版の root を指す hook は差し替えの後に 0、新しい版を指す hook は 5。script は arc が第 3 版を作り（SHA-256 は arc が決める。第 2 版の `541b4fef…d6a7` は使わない。席は本文を読んで、この節の順と同文であることを確かめる）、arc-sec が読み、Owner が打つ（打つことが承認）。**この差し替えの前後で、見張りは動いていない**（旧い見張りは無い。上の第 3 版の 3）。差し替えの効果は、取り込みと切り直しの hook が、#344 の引き継ぎの確定の順を持つ版に替わるだけで、席の起動・DB・ほかの席には触れない。

arc の読み（範囲の読み。Owner の委任 #49 6762288830 の下の arc の答えで、Owner の言葉ではない）: 範囲は tmux `aidlc-kusabi` の席が読む設定、つまり claude_code の AI-DLC の作業場 `<作業場>` の `.claude/` だけ。codex・antigravity_cli の設定は範囲外。

道具の選び直し（第 1 版のまま）: 既存の `kusabi:direct-fleet-rollout` は、この作業場を対象にできない。コードで確かめた事実: 対象は DB の主な結びつきを引く固定の問い合わせの 33 行（数が合わないと止まる）と、登録された Kusabi の作業場の副の 2 行で、R1 の束はその Kusabi の 3 つの host。任意の作業場を渡す引数が無い。`<作業場>` は登録された作業場ではない。そのため、arc の指示（rollout の道具で 1 つに絞れないなら installer を直接当てる）に従い、installer を `<作業場>` に直接当てる。

**第 2 版は「差し替え」**: `<作業場>` の設定には、第 1 版で入れた Kusabi の hook が 5 つ（SessionStart 1・Stop 2・UserPromptSubmit 2）入っている。installer は、管理下の handler を新しい runtime root で作り直す（増えも減りもしない）。切り直しの handler は、`--rotation` を付けると作り直され、付けないと「今あるものをそのまま残す」（`rotationGroupsFor` のコードで確かめた）。arc の答え Q7 = B のとおり、`--rotation on --rotation-threshold-tokens 240000` を付けた 1 回の操作で、5 つを一度に替える。途中に新旧が混ざる状態は作らない。

**第 1 版との効果の違い（O1 の続き）**: 第 1 版の取り込みの hook は、Claude Code 2.1.321 の入力を拒否して動かず、この席の会話の取り込みは実際には始まっていない（`MALFORMED_HOOK_INPUT`）。差し替えで、取り込みが実際に動き始める。入ると、この席の会話（redaction の後の、利用者と AI の見える文と tool の名前）が、席の通常の経路で Kusabi の DB に取り込まれる。ただし O4 のとおり、hook の process に DB の指定が届かなければ取り込みは動かない（第 2 版の C2 の取り直しで、`auto_receive.status` と `store_binding` を読んで確かめる。DB の書き込みは席の通常の経路で、この手順が追加で書かない）。**第 3 版の Claude の席は、この効果が第 2 版の差し替えで既に始まっている**ので、版が `28596bf0…` から `5fd29e06…` に替わるだけで、取り込みの効果は増えない。**Codex の席は、これが初めて起きる**（下の「Codex の席」。Codex の取り込みの hook は今、存在しない node を指して起動できない）。

**書く主体: 席は書かない。Owner が arc の script（`<arc の script>`、作業場の外。第 2 版の script の SHA-256 は `541b4fef2db5dcc51d8ef4c440e7a0f816facb9de94c1007df45ac011d8dd6a7`で、席が本文を読んで下の順と同文であることを確かめた。**第 3 版は arc が作り直す新しい script で、第 2 版の物は使わない**）を 1 回打つ**（O8。arc の判断で、Owner の言葉ではない）。`--apply` を席が流すことはしない。

script の前提と順（script の中身は arc が置く。席は読んだ内容を次に写すだけで、script を書き換えない）:
0. 前の確かめ: root でない、`<release>` の `release.json` の SHA-256 が S1 の版の値（`28596bf0…cd92`）と一致、node の実体（`/opt/homebrew/bin/node` の実体の path）が実行できる（`--version` を印字）、installer が実在（SHA-256 を印字）、`<作業場>/.claude/settings.json` が実在、**この版の root が設定にまだ無い**（あれば止まる。一度きり）、**前の版の Kusabi の hook が入っている**（無ければ止まる。入れ替えの script）、作業場の path の SHA-256 が結びつきの値の `workspace_sha256` と一致。
1. **書き込みの前に、Owner の記録を #49 に投稿する**（記録は `OD-KUSABI-SELF-SEAT-HOOK-VERSION-SWAP-BY-OWNER-RUN-20261112-001`。Owner がその script を打ったこと自体が、記録の中身への承認。投稿に失敗すれば止まる。本文は script・記録の file・版の SHA-256 を末尾に含む）。**この記録の URL と本文の SHA-256 を読み戻しに添える。無ければ差し替えは始まらない**（E1。arc-sec: arc の連絡だけでは、この席の権限として引けない）。
2. dry-run（書き込みなし）: installer の `--dry-run`（引数は下の A に `--rotation on --rotation-threshold-tokens 240000`）。**dry-run は差分を出さない。見る値は数だけ**: `would_change: true`、無関係な hook の数（前・後）= 3・3、`wrote_settings_file: false`。合わなければ止まる。
3. apply: 同じ引数で `--apply`。`settings.json.bak.wasurezu-<時刻>-<uuid>`（0600）を 1 つ取り、一時 file + rename で書く。
4. 読み戻し（script が行う）: backup の SHA-256 が書く前の file と一致。`diff -u <backup> <settings.json>` を出す。**Kusabi の hook（command に `.kusabi-releases/sha256/` を含む handler）を前後から外すと、前後が同じになる**（= 差分は Kusabi の hook の入れ替えだけ）。`--check`（同じ引数）が exact。hook の command の先頭の node が実在し実行できる。前の版の root を指す hook が 0。合わなければ、今の file が「書いた直後の file」と同じ時だけ backup に戻し、止まる。
5. 読み戻しに席が足す物（C1）: 差分の全文を貼る。**新しい版を指す Kusabi の hook の数が 5**（SessionStart 1・Stop 2・UserPromptSubmit 2。script は数を表明しないので、席が数える）、**5 つの先頭の word が `/opt/homebrew/bin/node`**（Q6 = B）、無関係な hook の数が 3・3 のまま。`git status --porcelain --ignored .claude/` で、settings.json と backup が PR に載らない（無視されている。`.gitignore` の backup の行は #342 で入った）ことを確かめる（結びつきの値と release の path が入るため）。
6. 戻し: `rollback-runbook.md` の S3・S4（installer の backup の復元。backup は 1 つ）。
7. 使わない物（C8）: 古い `scripts/install-hook.sh`（AM-006）は、hook の command に DB の URL を直書きする別物なので、この席には使わない。
8. 注記（C9）: SessionStart の取り込みは transcript 全体を 8 MiB まで読み、超えると `transcript_too_large` で取り込まない。Stop の取り込みは末尾 4 MiB。許容する。
9. 打つ時（script の冒頭の注記）: 席 `aidlc-kusabi` が手すき（入力待ち）の時に打つ。AI-DLC の hook が同じ file を書きうるため。打った後、arc が席を 1 回起こし直して C2 を取り直す。**その時この会話は終わる**ので、それまでに記録と diary を保存する。
10. 実行の前の条件: Owner の決定の条件「実行の前に arc-sec が具体の手順を確かめる」のため、第 3 版の script（Claude の席の分と Codex の席の分）を arc-sec が読み終えていること。読み終えるまで Owner に打つ段を渡さない（arc の判断）。
11. 第 3 版で足す前の確かめ（0 に足す）: 打つ直前に、GitHub の main の先頭が `ffe511e5…` のままか（S0 の「版の元」）、`<release>` の `release.json` の SHA-256 が `5fd29e06…` か、設定の Kusabi の hook が 5 つとも `28596bf0…` を指すか（上の第 3 版の読み替えの前提）を、script が表明する。違えば script は書かずに止まる。
12. 第 3 版で足す後の確かめ: 差し替えの後、見張りが動いていないこと（`ps` に rotation-watcher が無い）を読み戻しに添える。見張りへ席を登録するのは、この読み戻しと C2 の取り直しが合った後（S5）。

## S3・S4 の command と、書く主体（O7・O8 の決まり）

決まり（arc の判断。Owner の委任 #49 6762288830 の下の arc の判断で、Owner の言葉ではない）:
- 書く主体: 席は書かない（AI-DLC の保護のとおり）。installer の書き込み先を変える設計の変更もしない。arc が、Owner が 1 回だけ打つ script を作った。第 1 版の script は arc-sec が確かめ済み。第 2 版の script（差し替え。上の S3・S4）は arc-sec が読み直す。形は、前の確かめ → 記録の投稿（#49）→ dry-run → `--apply`（この作業場だけ）→ 読み戻し → 失敗なら backup に戻す、を 1 回の操作で行う。Owner が打つのは、arc-sec の読み直しが済み、席が手すきの時。
- 結びつきの値（O7）: `binding_source` = `owner_approved_secondary`、Owner の指示の識別子 = `OD-KUSABI-ROTATION-DEPLOY-SELF-SEAT-TRIAL-20261111-001`、`workspace_sha256` = `<作業場>` の path の SHA-256。形は、登録された作業場の Kusabi の副の結びつき（claude_code）と同じ。

### 結びつきの値の組み立て方（再現できる形）

正規化した JSON（キーを昇順、空白なし、`ensure_ascii` なし）で、次の 8 つのキーだけを持つ。
| キー | 値 | 出どころ |
|---|---|---|
| `schema_version` | `kusabi-direct-binding-source-ref/v1` | 既存の副の結びつきと同じ |
| `binding_source` | `owner_approved_secondary` | 同上 |
| `canonical_agent_id` | `kusabi` | 同上 |
| `project` | `agent-memory` | 同上 |
| `host_runtime` | `claude_code` | 同上 |
| `primary_binding_source_ref_sha256` | 既存の副の結びつきの値をそのまま写す（Kusabi の主の結びつきの SHA-256） | 登録された作業場の claude_code の hook の引数から読む |
| `owner_directive` | `OD-KUSABI-ROTATION-DEPLOY-SELF-SEAT-TRIAL-20261111-001` | 今回の Owner の決定（#49 6790645694） |
| `workspace_sha256` | `<作業場>` の path（末尾の区切りなし、実体の path）の SHA-256 | `printf '%s' '<作業場>' \| shasum -a 256` |

作り方の確かめ（実行の前に席が行った、書き込みなしの確認）: 既存の副の結びつきの文字列を同じ正規化で作り直すと一致する。登録された作業場の `workspace_sha256` は、その path の SHA-256 と一致する。組み立てた値の全文は、path の SHA-256 を含むため、この公開の記録には書かず、arc への連絡にだけ載せた。arc の script は、同じ手順で作るか、載せた値をそのまま使う。**第 3 版**: 値は変えない（同じ Owner の指示の識別子）。差し替えの前の設定の Kusabi の hook 5 つが持つ `--binding-source-ref`・`--workspace`・`--agent-id`・`--project`・上限 3 つの値は、5 つで同一（2026-11-13 に、値の SHA-256 の先頭 10 桁の集合の大きさが各 1 で確かめた）。script は、組み立て直さず、今の hook の値を設定から読んで同じ値で渡し、差し替えの後に前後で同一であることを読み戻しに足す（Codex の席の引数 A-c と同じ形）。5 つの handler の形は、取り込みの 3 つ（18 語）と切り直しの 2 つ（Stop・UserPromptSubmit。`--rotation-threshold-tokens` を持つ 20 語）。

### command の形（script が内部で流す物。`<作業場>`・`<release>` は script が実際の path を入れる。席は同じ文になっているかを読むだけ。E2 の (f)）

共通の引数 A: `--workspace <作業場> --runtime-root <release> --agent-id kusabi --project agent-memory --binding-source-ref '<上の値>' --max-tokens 1800 --max-bytes 8192 --timeout-ms 7000 --node-path /opt/homebrew/bin/node`（3 つの上限は、登録された作業場に入っている取り込みの hook と同じ値。`--node-path` は Q6 = B で、版に依らない symlink を hook の command の先頭に書く。installer 自身は、その symlink の実体の node で動かす）。`--runtime-event-manifest` は付けない（登録された作業場の手順で作られた証拠 file で、この作業場には無い）。呼び出しは `HOME=<home> <node の実体> <release>/dist/claude-hook-installer.js <mode> A <追加の引数>`（installer 自身は HOME を読まない。hook が動く時に HOME を使う）。

| 段 | mode と追加の引数 | 読み方 |
|---|---|---|
| 差し替えの前 | `--dry-run --rotation on --rotation-threshold-tokens 240000` | 書き込みなし。見る値は数だけ（`would_change: true`、無関係な hook 3・3）。差分は出ない |
| 差し替え | `--apply --rotation on --rotation-threshold-tokens 240000` | 適用（backup を 1 つ作る）。差分は apply の後に `diff -u` で確かめる |
| 差し替えの後 | `--check --rotation on --rotation-threshold-tokens 240000` | 期待どおり（exact） |
| 切り直しだけ止める | `--apply --rotation off`（A は同じ） | 切り直しの hook だけが外れる。取り込みの hook は新しい版のまま残る |
| 全部戻す | backup の復元 | `rollback-runbook.md` |

閾値は 240000 で入れる（arc の判断。FR2.1 の既定の 300000 より低く指定する。席の自動の圧縮の窓 300000 より先に切り直しが来るようにするため。O10）。`<release>` は S1 で決まった（版の SHA-256 は上の S1）。第 1 版のように S3 と S4 を別々の操作にはしない（Q7 = B）。

## C2 の取り直し（差し替えの後、S5 の前）

arc が席を 1 回起こし直し、起こし直し後の最初の会話が読む。席自身で取り直す物と、記録から読む物を分けて書く（第 1 版の C2 と同じ形）。DB は変えない。

| 見る物 | 期待 | 見る方法 |
|---|---|---|
| AI-DLC の SessionStart の hook | 終了 0、stderr が空、整合性の誤りが出ない（`orchestrate next` が進む） | 会話の記録の hook の結果 |
| Kusabi の SessionStart の結果 | `outcome` が `degraded`／`MALFORMED_HOOK_INPUT` でない。画面の文に `Wasurezu startup recovery degraded` が出ない | 会話の記録の hook の結果（stdout・stderr） |
| 入力が読めている | `hook.input_valid: true`。`session_id`・`source`・`cwd_sha256` が null でない | SessionStart の証拠 |
| DB の結びつき | `store_binding.source` と `backend_intent` が `unknown` でなく、`verified` の値を 1 行ずつ（URL は書かない）。DB が同じ Mac かを 1 行（C2 の元の項目） | 同上 |
| 取り込みの経路 | `auto_receive.status` が証拠にある（`captured` か理由コード）。無い／`unknown` なら、O4（DB の指定が hook の process に届かない）の確認へ進む | 同上 |
| 副作用 | `forbidden_effects` がすべて 0（再起動・kill・TUI 書き込み・tmux send-keys・clipboard・AUN queue・session への注入） | 同上 |
| 診断の記録（名前だけ） | `<AGENT_MEMORY_HOME>`（未設定なら既定の `~/.agent-memory`）の `hook-input/kusabi/agent-memory/` に `wasurezu-claude-session-start.json` ができ、`kusabi-hook-input-diagnostics/v1` の形で、`entries` の名前は SessionStart の `session_title` など（名前・事象・件数・時刻だけ。値・path・session id が無い）。件数 32 以下・file 64 KiB 以下。file は 0600、folder は 0700 | 席が file を読む（読むだけ。値を貼らない。名前と件数だけを記録に書く） |
| Stop 系の入力 | 最初の応答が終わった後、`wasurezu-claude-transcript-stop.json`・`wasurezu-claude-rotation-stop.json` ができ、Stop の新しい key（`background_tasks`・`effort`・`prompt_id`・`session_crons` ほか）の名前が出る。取り込み・切り直しの証拠が `malformed_input` でない | 同上と、証拠 file |
| hook の node | 5 つの先頭の word が `/opt/homebrew/bin/node`（Q6 = B）で、実在し実行できる | 設定の読み戻し |
| Claude Code の版（FR10.5） | `claude --version` で取った版を、契約を確かめた版（`adapter.host_contract_version` = `2.1.220`、動かさない）とのずれと一緒に、`health-check-report.md` に **1 行で必ず書く**（今は 2.1.321）。読めない時は「観測できず」と書く。証拠の契約にも診断の記録にも版は書かない（code は足さない） | 席が `claude --version` を流す。実施者は配備を行う席。この 1 行が無い配備の記録は完了としない |

期待と違った時（`input_valid: false` のまま、`degraded` のまま、`forbidden_effects` に 0 でない項目）は、S5 に進まず、出力をそのまま Owner に見せて止まる。戻し方は `rollback-runbook.md`。

**外れ（deviation）— 第 4 回の C2、取り込みの経路の行**（2026-11-12。arc の判断。Owner の委任 iyasaka-arc#49 6762288830 の技術の範囲で、Owner の言葉ではない。席は柵が拒んだ読みを回避も代行もしていない）:
- 採った判断: `auto_receive.status` を C2 の合格の条件から外し、「続きの案内（`wasurezu-recovery-pack/v1`）が、この会話の文脈に実際に届いた」事実の観測で置き換える。観測の中身は、案内の pack ref の時刻（11:22:42.288 JST）と診断の記録の SessionStart の更新時刻（11:22:42.333 JST）の一致（差 45 ミリ秒）。
- 採らなかった代替: (1) 本番の DB の品質ログ（`recovery_quality_log`）の 1 行を READ ONLY の SELECT で読む（席の柵が「Production Reads」で拒否した）。(2) Owner に端末で同じ SELECT を流して出力を見せてもらう。
- 出典（control_source_ref）: agent-memory#339 の comment 6812844309 の (1)、本文の SHA-256 `141b188728c12f07e477bc0a65776cf5d328b411915d24f9bf1ad997a9737187`（arc の技術の判断。Owner の決定ではない。作者が GitHub の API が返す本文で数え直して一致を確かめた）。
- 残ること: `auto_receive.status` の値は観測できていない。観測できないものを成功とは読まない（S5）ので、この行は「値を観測した」ではなく「届いた事実で置き換えた」と書く。品質ログの読みは、S5 の見張りの probe を据える時に、その段の手順で改めて扱う。

## Codex の席（第 3 版で足す。script B。arc の分けで 1 本目の中で A の後に続ける。席は何も書かない。[訂正 2026-11-13] 前の見出しは「Codex の席の起こし直しは 2 本目」と書いたが、2 本目は関門・S5・S6 の script に替わった。Codex の席の起こし直しの script の呼び方は arc が決める。[訂正 2026-11-14] 答えが出た: Owner が打つ script ではなく、人が行う別の段。下の「script の分け」）

Owner の決定 #49 6847683704 が範囲に入れた Kusabi の Codex の席（tmux `kusabi`）の手順。範囲の読み（席の読み。Owner の言葉ではない）は、Codex の席が読む Kusabi の登録された作業場の `.codex/hooks.json` だけ。`~/.codex/config.toml` のほかの行・ほかの作業場の `hooks.json`・Onza／Totonoe など別の Codex の席には触れない。DB の構造・本番にも触れない。**Claude の席の script（上の S3・S4）とは別の script にする**（Q8 = B）。

### Claude の席と違う点（実行の前に arc が埋める前提）

| 番号 | 違い | 確かめた事実 | 手順への効果 |
|---|---|---|---|
| P1 | 席の起動の script が無い | tmux `kusabi:0.0` の起動 command が指す script（`/tmp/codex-leads-restart-20261016/` の下）は今は存在しない。見張りの切り直しは、この起動 command をそのまま流して席を起こし直す（`tmux respawn-pane` の条件つき）。このままだと、新しい会話が起きず pane が起動の失敗で止まる（R-E） | arc が `/tmp` の外に新しい起動の script を作り、その SHA-256 を見張りの設定へ登録する値にする。Codex の席の登録（S5c）は、その script で席を起こし直した後。**解決（arc の判断）: 新しい起動の script ができた（上の「第 3 版の arc の決定」の O13）** |
| P2 | 続きの最初の入力が無い | Claude の SessionStart は `initialUserMessage` で続きの入力を渡す。Codex の SessionStart は `additionalContext`（引き継ぎの文）だけで、続きの入力は無い（設計の記録 `code-generation-plan.md` の「Codex も同じ（続きの文は無い）」）。起こし直した Codex の会話は、引き継ぎの文を文脈に持つが、誰かが入力するまで動かない形になりうる | arc が、起動の script に固定の最初の入力を持たせるか（Claude の席で外した形の反対）、持たせないで次の入力を待つ席として受け入れるかを決める（O14）。席は決めない。**解決（arc の判断）: 固定の最初の入力を持たせる（同上の O14）** |
| P3 | hook の信頼の確認 | `~/.codex/config.toml` の `[hooks.state]` に、この作業場の handler ごとに信頼の印がある（`session_start:0:0`・`user_prompt_submit:0:0`・`stop:0:0`）。差し替えで handler の中身が変わり、切り直しの handler 2 つは新しい位置に増える（Stop・UserPromptSubmit が各 2 つ）。信頼の確認の画面が起こし直しの時に出ると見込む。席は Codex の文書を読んでおらず、未信頼の handler が実行されないか、実行されて警告だけかは確かめていない | 確認は Owner が席の画面で行う（席・script は `config.toml` を書かない）。確認の前は、hook が動かない前提で C2c を読む（O15） |
| P4 | host の process の特定 | 席の process は `bash` → `node`（codex の wrapper）→ `codex`（native の binary）の木。見張りが使う `host_pid` は hook の親 process の pid で、`expected_command` はその `ps -o comm=` の末尾の名前。Codex では、hook の親が native の `codex` か、`node` か、`sh` かを、席は実機で見ていない | S5c で、新しい hook が書いた `turn.json` の `host_pid` を `LC_ALL=C ps -o comm=` で引き、pane の木の下にあることも確かめる。`codex` 以外なら、書かずに止まって設計へ戻す（O16） |
| P5 | 閾値の根拠 | Codex の席の起動に自動の圧縮の指定は無い（`config.toml` に `model_auto_compact_token_limit`・`model_context_window` が無く、席の起動の引数にも無い）。窓の大きさは、Codex の席の今の会話の記録（rollout）の最後の `token_count` の `model_context_window`（host が報告する値）から読めて、**258400**（2026-11-13 に席が数字だけ読んだ。同じ会話の直近の入力の量は 130015）。切り直しの code は窓を使わず、同じ記録の `last_token_usage.input_tokens`（直近の入力の量）だけを閾値と比べる（`codex-context-measurement`）。Codex 自身の自動の圧縮がどの量で始まるかは、席は確かめていない | 閾値 240000 は窓 258400 の約 93%（余裕 18400）。Claude の席と同じ 240000 から始めてよいかは arc の判断（O17）。S7c で、圧縮が先に来たかを記録して見直す。**解決（arc の判断）: 200000（窓の約 77%）で始める（同上の O17）** |

### 現状（S0 の表の続き。2026-11-13 に席が読み取りで確かめた）

- `.codex/hooks.json`: 0600、Kusabi の handler が 3 つ（SessionStart・Stop・UserPromptSubmit が各 1）、すべて版 `dd806dbe…` を指し、先頭の node の path（`node/25.6.1_1`）は存在しない。`--runtime-event-manifest` を持ち、その file は実在する。値は 3 つの handler で同一。無関係な handler は 0。
- `.codex/` の下に、過去の installer の backup（`hooks.json.bak.wasurezu-*`）が 3 つある。第 3 版の差し替えで増える backup は 1 つ。
- `hooks.json` と backup は git の管理外で無視もされていない（未追跡）。PR・記録に値を載せない。

### 第 3 版の arc の決定（2026-11-13、席間の連絡。arc の技術の判断で、Owner の言葉ではない。権限は #49 6847683704 のまま）

| 番号 | 決定 | 席の下書きでの扱い |
|---|---|---|
| O13 | 起動の script は `/tmp` の外: `~/Developer/arc/tools/seat-launchers/start-kusabi-codex.sh`（arc の持ち物。SHA-256 `09f8c869032c653059eee1e94e3581cd4a207e1b2e368a1761497bbc2ceb00b0`、権限 700。席が読み取りで SHA-256 と権限を確かめた）。中身は動いている席（pid 6792）の argv の写し。変えたのは、先頭の node を絶対 path（`/opt/homebrew/opt/node@24/bin/node`）にしたことと、最初の入力の終わりに O14 の 1 文を足したこと。最初の連絡の path（`kusabi-self-seat/`）は取り下げられ、この path に替わった | Codex の席の起こし直しの script（前の記録は「2 本目」と書いた。[訂正 2026-11-13] 呼び方は arc が決める。[訂正 2026-11-14] 答えが出た: Owner が打つ script ではなく、人が行う別の段。下の「script の分け」）は、この file の SHA-256 と権限を表明してから起こし直す。中身（DB の指定を含む）は席も script も写さない。起こし直しは `tmux respawn-pane -k -t kusabi:0.0 'bash <起動の script>; exec zsh -l'` の形（arc の指定） |
| O14 | 固定の最初の入力を持たせる。今の入力の文のまま、終わりに「SessionStart の引き継ぎ（additionalContext）があれば、それを読み、その続きから動く。」の 1 文を足す | 起動の script の中身（arc の持ち物）。席は文を書かない |
| O17 | Codex の席の閾値は **200000**（窓 258400 の約 77%。Codex 自身の圧縮が先に来て切り直しが観測できない形を避けるため）。Claude の席は 240000 のまま。実際の切り直しの記録で見直す | script の Codex の installer の引数は `--rotation-threshold-tokens 200000` |
| O20 | S5（見張りの設定の file）と S6（見張りの窓）は Owner の script の中。probe（読むだけ）は席が先に流し、`prompt_markers`・`placeholder_patterns` の値を arc に渡す | 1 本目の script が設定の file を書き、窓を起こす。[訂正 2026-11-13] 設定の file と窓は、2 本目の script（関門 O25・停止の印の確かめの後）が行う。1 本目（A → B）は書かない。probe の値は O22・O23 |
| O21 | 自然に届くのを待つ。閾値を一時に下げる操作は足さない。届いたかは席が見て記録する | S7 は席が見て読む。script に閾値を動かす操作は無い |
| 順序 | [訂正 2026-11-13] 前の案（使わない。順は上の「第 3 版の実行の順と関門 O25」の節）: 1 本目 = A ＋ S5・S6（見張りは Claude の席だけ）＋ B（Codex の `hooks.json` だけ。見張りには足さない）。#49 の記録に (i)(ii)(iii) を書く。Claude の席の実際の切り直しを確かめた後に、2 本目 = Codex の起動の script での起こし直し（hook の信頼の画面は Owner）と、見張りへの Codex の席の追加 | O23・O25 の席の指摘を arc が決めるまで、2 本目の見張りへの追加は下書きに入れない。1 本目の S5・S6 には O25 の確かめの関門を入れた |

### 順序（script B。arc の決定で、1 本目の Owner の script の中で、Claude の席の hook の差し替え（A）の後に続けて行う。第 2 版の席の勧め（別の script）は arc の分け方に替わった）

0. 前の確かめ（script が表明する）: root でない。`<release>` の `release.json` の SHA-256 が `5fd29e06…`。node `/opt/homebrew/bin/node` が実行できる（`--version`）。`<release>/dist/codex-hook-installer.js` が実在し通常の file（SHA-256 を印字。期待は `57e04529…1c4f`）。`<Codex の作業場>/.codex/hooks.json` が実在し 0600、適用前の SHA-256 を印字。Kusabi の handler が 3 つで、すべて版 `dd806dbe…` を指す。この版の root が `hooks.json` にまだ無い（あれば止まる。一度きり）。無関係な handler は 0。作業場の path の SHA-256 が、設定の `workspace` と同じ。
1. **書き込みの前に、Owner の記録を #49 に投稿する**（記録の名前は arc が決める。Owner が script を打つことが記録の中身への承認。投稿に失敗すれば止まる）。記録に、(i) Codex の席の会話が Kusabi の DB に取り込まれ始めること（今は hook が起動できず、取り込みは 0 件）、(ii) hook の信頼の確認が席の画面に出ること、(iii) Codex の席の切り直しは起動の script の作り直しが済むまで起きないこと、を書く。記録の URL と本文の SHA-256 を読み戻しに添える。無ければ差し替えは始まらない（E1）。
2. dry-run（書き込みなし）: `codex-hook-installer.js --dry-run <引数 A-c> --rotation on --rotation-threshold-tokens 200000`。見る値は数だけ: `would_change: true`、`unrelated_hook_group_count_before`・`_after` が 0・0、`wrote_hooks_file: false`。合わなければ止まる。
3. apply: 同じ引数で `--apply`。`hooks.json.bak.wasurezu-<時刻>-<uuid>`（0600）を 1 つ取り、一時 file + rename で書く（installer のコードで確かめた）。
4. 読み戻し（script が行う）: backup の SHA-256 が書く前の file と一致。`diff -u <backup> <hooks.json>`。Kusabi の handler（command に `.kusabi-releases/sha256/` を含む）を前後から外すと前後が同じ（= 差分は Kusabi の handler の入れ替えだけ）。`--check`（同じ引数）が exact。先頭の node が実在し実行できる。旧い版 `dd806dbe…` を指す handler が 0。合わなければ、今の file が「書いた直後の file」と同じ時だけ backup に戻し、止まる。
5. 読み戻しに席が足す物: 差分の全文。**新しい版を指す Kusabi の handler が 5**（SessionStart 1・Stop 2・UserPromptSubmit 2）、**5 つの先頭の word が `/opt/homebrew/bin/node`**、`--binding-source-ref`・`--runtime-event-manifest`・`--workspace`・`--agent-id`・`--project`・上限 3 つの値が、差し替えの前後で同一（値の SHA-256 を比べる。値は貼らない）。
6. 戻し: `rollback-runbook.md` の「Codex の席」。
7. 打つ時: Codex の席の起こし直しは、arc が行う。席が手すきの時に打つ。打った後、arc が起動の script（P1）で席を起こし直し、Owner が信頼の確認を画面で行う（P3）。[訂正 2026-11-13] この「打った後」は、script B を打った直後の意味ではない。起こし直す時期は、上の「第 3 版の実行の順と関門 O25」の末尾のとおり、Claude の席の実際の切り直しを確かめた後（C2c）で、この順の外。

引数 A-c（Codex の installer）: `--workspace <Codex の作業場> --runtime-root <release> --agent-id kusabi --project agent-memory --binding-source-ref '<今の handler の値をそのまま>' --max-tokens 1800 --max-bytes 8192 --timeout-ms 7000 --runtime-event-manifest '<今の handler の値をそのまま>' --node-path /opt/homebrew/bin/node`。`--binding-source-ref` と `--runtime-event-manifest` は、Claude の席と違って組み立てない。Codex の作業場は DB に登録された作業場で、今の handler が持つ値（3 つで同一）を、script が `hooks.json` から読んでそのまま渡す。Codex の installer には `--adapter-id` の引数が無く、adapter は installer が固定で持つ（SessionStart と取り込みと切り直しの 3 つ）。呼び出しは `HOME=<home> <node の実体> <release>/dist/codex-hook-installer.js <mode> A-c <追加の引数>`。

### 起こし直しの後に読む物（C2c。Claude の C2 に当たる。arc が Codex の席を起こし直した後、席または arc が読む）

| 見る物 | 期待 | 見る方法 |
|---|---|---|
| hook が動く（P3 の後） | 信頼の確認の後、起動で SessionStart の hook が走る。画面の文に取り込みの失敗が出ない | 席の画面（読むだけ）。信頼の確認が出ないで hook が動かない場合は、出力をそのまま Owner に見せて止まる |
| 入力が読めている | Codex の SessionStart の証拠で、入力が読めている（Claude の C2 と同じ項目: `session_id`・`source`・`cwd_sha256` が null でない） | 証拠 file または診断の記録（名前・件数だけ） |
| DB の結びつき | `store_binding.source` と `backend_intent` が `unknown` でなく、`verified` を 1 行ずつ（URL は書かない） | 同上 |
| 取り込みの経路 | `auto_receive.status` が証拠にある。無ければ、届いた事実の観測で置き換える（Claude の C2 の外れと同じ扱い。外れを新しく書く時は arc の判断を引く） | 同上 |
| 副作用 | `forbidden_effects` がすべて 0 | 同上 |
| hook の node | 5 つの先頭の word が `/opt/homebrew/bin/node` で実在し実行できる | 設定の読み戻し |
| `turn.json` が書かれる | Stop か UserPromptSubmit の後に、切り直しの記録の root の下に (kusabi・agent-memory・codex) の `turn.json` ができる。`host_pid` が pane の木の下にある | 記録 file を読む（pid・時刻・名前だけ） |
| host の process（P4） | `LC_ALL=C ps -o comm=` で `host_pid` を引いた末尾の名前を、`expected_command` の値として記録する。`codex` を見込む。`node` や `sh` なら、見張りに登録せず、設計へ戻す（O16） | 席が読む |
| Codex の版 | 席が使う `codex`（arc の起動の script が起こす、bun の `codex` を node@24 で動かす形）の `--version` を、`health-check-report.md` に 1 行で書く。2026-11-13 に 0.163.0 を読んだ（PATH の `codex` は 0.166.0 の別の install で、席の起動には使われない。第 3 版の最初の記録の「0.166.0」は PATH の方を読んだ誤りで、arc の指摘で直した。O24）。今動いている Codex の process は 2026-10-16 の起動で、その時の版は席は確かめていない。契約を確かめた版とのずれを添える | 席が流す |

### 見張りへの登録と実際の切り直し（S5c・S6c・S7c）

- S5c: Claude の席の S5 と同じ形で、見張りの設定に席を 1 件足す。`host` = `codex`、`tmux_target` = `kusabi:0.0`、`launch_command` = 起こし直した後の `#{pane_start_command}` の値そのまま、`launch_script` = `{ path: <P1 の新しい起動の script>, sha256: <その SHA-256> }`、`expected_command` = P4 で確かめた値、`drain_commands` = 空（Stop の hook の上限 9 秒が静けさの条件 20 秒より短い。Codex の下の process が増えるかは S5c の probe で見る）、`prompt_markers`・`placeholder_patterns` は probe の出力から、`owner_decision_ref` = 上の新しい Owner の決定（URL と本文の SHA-256。`names_aun_supervised_relaunch: false`）、`aun_supervised: false`。
- 見張りは設定を 1 周ごとに読み直す（`runPass` が毎回 `loadConfig`）ので、Codex の席は見張りを止めずに足せる。ただし 1 つの席が観測できない（`unobservable`）と、見張りの「非進捗の周回」が増え、上限（既定 30 周。poll は 5 秒。`ROTATION_WATCHER_NO_PROGRESS_HALT_LIMIT`、2026-11-13 に席が定数を読んで訂正。前の版の記録は「3」と誤っていた）で見張り全体が止まる（`isNonProgress`）。**Codex の席は、probe が通り、起動の script と `expected_command` が確かめられるまで登録しない**。Claude の席の実際の切り直し（S7）が済んでから足すのを勧める（席の順の判断。Owner の言葉ではない）。
- **第 3 版の席の読み（probe の結果。O23）**: Codex の席の画面は、入力欄の行（`›` + 空白 + 文）の下に、枠線でない行（モデル名と作業場の行・ショートカットの行）が 2 行ある。見張りの入力欄の判定（`proveInputRow`）は、入力欄の下に枠線だけの行以外の行があると `text_below_input_row` で「見つかったが空でない」を返し、`input_not_empty`（分類は `waiting`）で切り直しを見送る。席は probe を、マーカー `›` と `› `、placeholder の文を入れた形で流したが、どれも `input_empty: false` だった。つまり**今の見張りの code では、Codex の席は登録しても切り直しが起きない**（失敗側。`waiting` は非進捗に数えないので、見張り全体は止まらない）。切り直しを Codex の席で起こすには、入力欄の判定を Codex の画面に合わせる code の変更（新しい単位。守る物に触れるかは arc が決める）が要る。この判断が付くまで、どの script の下書きにも、Codex の席を見張りへ足す物を入れない。[訂正 2026-11-13] 前の文は「2 本目の下書き」と書いた。「2 本目」の呼び方が替わった（上の「第 3 版の実行の順と関門 O25」）。
- S7c: Claude の席の S7 の表と同じ確かめ（切り直しが 1 回起きる・続きが届く・引き継ぎの保存が DB に入る・圧縮より先に来たか・人が見ている間は触らない・作業中は切らない・席の hook も切れる・停止の印）に、Codex に固有の次を足す: (1) 起動の script が `codex` を新しい会話で起こし、SessionStart の `additionalContext` に引き継ぎの文が入る。(2) P2 で決めた最初の入力の形のとおりに、新しい会話が続きから動く（動かない形を受け入れたなら、その事実を記録して、次の入力で動く）。(3) 前の会話は `codex resume <old_session_id>` で再開できる。

## (c) 戻した後の読み（旧い見張りが新しい記録を読めるか。第 3 版。使い捨ての場所で確かめた。席への効果なし）

Owner の決定の (c)。確かめ方: 新しい版 `5fd29e06…` の `dist/rotation-watcher-store.js` で claim・ledger の記録を書き、旧い版 `28596bf0…` の同じ module で読む（旧い見張りが読む入口の関数そのもの）。使い捨ての directory だけに書き、終わったら消した。tmux・席・DB には触れていない。席の一時 directory の script `check-c-rollback-readability.mjs`（記録の PR には入れない。結果の表をこの記録に写す）。

| 番号 | 確かめた事 | 結果 |
|---|---|---|
| N1・N2 | 新しい module が新しい終わりの値（`output_written_receipt_unobserved`）の claim を書く。旧い module が旧い終わりの値（`done`）の claim を書く（対照） | 期待どおり |
| R1 | **旧い見張りが、新しい終わりの値の claim を読む** | `unreadable`。旧い見張りは `claim_unreadable`（分類は `unobservable`）にして、その印については起動し直しをしない。失敗側に倒れる。分類が `unobservable` なので、その周回は旧い見張りの「非進捗の周回」に数えられ（`isNonProgress`。コードの読みで確かめた。流していない）、連続が上限（既定 30 周。poll は 5 秒。`ROTATION_WATCHER_NO_PROGRESS_HALT_LIMIT`、2026-11-13 に席が定数を読んで訂正。前の版の記録は「3」と誤っていた）に届くと、旧い見張りは全体の停止の印を書いて終わる |
| R2・R3 | 旧い見張りが、旧い module が書いた claim・新しい module が旧い形（`unconfirmed`）で書いた claim を読む | どちらも `found` |
| R4・R5 | 新しい見張りが、旧い claim・新しい claim を読む | どちらも `found`（新しいものは旧い形を読める） |
| L1・L2 | 新しい module が書いた ledger（`intent`・`respawn_issued`・新しい kind の行）を、旧い・新しい見張りが読む | どちらも読める（旧い見張りは知らない kind の行を読み飛ばす。読めない行扱いにしない） |
| L3〜L6 | 直近 1 時間の起動し直しの数と最後の時刻 | 新しい見張りは 3、旧い見張りは 2（新しい kind の行だけを持つ 1 回を数えない）。最後の時刻も旧い見張りは 1 回前 |

13 件すべて期待どおり。読み方:
1. 戻した後の旧い見張りは、新しい終わりの値の印については **何も起動しない**（読めないので skip）。ただし、その印が席の今の印のままの間、周回ごとに「観測できず」が続き、連続が上限（既定 30 周。poll は 5 秒。`ROTATION_WATCHER_NO_PROGRESS_HALT_LIMIT`、2026-11-13 に席が定数を読んで訂正。前の版の記録は「3」と誤っていた）に届くと、見張り全体が止まる（全体の停止の印。印を消しても再開しない。窓で起こし直す。`rollback-runbook.md` の C4 の行）。新しい終わりの値の claim が残っている状態で旧い見張りを動かさない（戻す時は、見張りを先に止める。下の 3）。次の印（新しい marker id）は別の claim として扱える。
2. 旧い見張りが数えない起動し直しが 1 回ある場合、旧い見張りの 1 時間の上限は、その 1 回の分だけ緩く見える。上限は 1 席 1 時間あたりの回数なので、緩むのは最大でも、新しい版が残した新しい kind だけの試みの数。起動し直しの最小の間隔の判定も 1 回分ずれる。許容する範囲（軽）。
3. 新しい hook と旧い見張りの組み合わせは、**読んだだけで流していない**が、旧い見張りの `isNewConversationConfirmed` が `turn.rotation_marker_id` と marker id の一致を要求し、#344 の hook はその欄を claim 経路で常に null にする（設計の記録 `handoff-commit-order-design.md` の 17.7）ため、旧い見張りは新しい会話を確認できず、`unconfirmed` で席の印を置く。失敗側に倒れるが、切り直しは続かない。**このため、見張りと hook の版は同時に替え、戻す時も同時に戻す**（arc の判断を、この確かめが支える）。
4. 新しい見張り（`5fd29e06…`）と旧い hook（`28596bf0…`）の組み合わせは、新しい見張りが output-written の記録を要るため、同じく確認できない形になる見込み（流していない）。新しい見張りを起こすのは、Claude の席の hook が新しい版であることを確かめた後だけ。

## 第 3 版の実行の順と関門 O25（S5 の前。正本）

[訂正 2026-11-13] この節が、第 3 版の実行の順と関門の正本（arc の連絡。席間の連絡で、GitHub への記録はまだ無い。arc の技術の判断で、Owner の言葉ではない。権限の根拠として引かない）。前の案は順を 2 通り書いていた（「A ＋ S5・S6 ＋ B」の順と、`deployment-strategy.md` の表の「SA → C2 → S5・S6 → S7 → SB」の順）。どちらも前の案で、使わない。

### 順（席は何も実行しない。script は arc が書き、arc-sec が読み、Owner が打つ）

1. A: Claude の席の hook の差し替え（閾値 240000）。
2. B: Codex の席の `hooks.json` の差し替え（閾値 200000。見張りには足さない）。
3. Claude の席の起こし直し（arc が行う。変わった hook の確認の画面は Owner が押す）。
4. 関門 O25（下の (a)(b)）。
5. S5: 見張りの設定に Claude の席だけを登録する。
6. 停止の印の確かめ（置く → 消す）。
7. 印の file が無いことの確かめ。
8. S6: 席と別の tmux の session で見張りを起こす（`remain-on-exit on`）。

S7（実際の切り直し）は S6 の後、閾値に自然に届くのを待つ（O21）。Codex の席の起こし直し（C2c）は、Claude の席の実際の切り直しを確かめた後（O23 の arc の答え）で、この順の外。

### script の分け（arc の連絡）

Owner が打つ script は 2 本。1 本目の script（`install3.sh`）は 1・2 だけ（A → B）。3 の起こし直しは arc が行う。4〜8 は 2 本目の script（arc が書き、arc-sec が読む）。2 本目を打つのは、3 の後の最初のターンが済んでから（(b) が、その後の `turn.json` を読むため）。前の記録は「1 本目に A・B・S5・S6 を続ける」「2 本目 = Codex の席の起こし直し」と書いたが、この分けに替わった。Codex の席の起こし直しの script の呼び方は、arc の連絡に無い（arc が決める。席は決めない）。[訂正 2026-11-14] この最後の文は答えが出た（arc の連絡。席間の連絡で、GitHub への記録はまだ無い。arc の技術の判断で、Owner の言葉ではない）: Codex の席の起こし直しは、Owner が打つ script ではない。O23 の code の変更の後に、起動の script（`start-kusabi-codex.sh`。arc の持ち物。記録にはパスと SHA だけを書き、中身は写さない）で人が行う別の段で、上の 1〜8 の順の外。[訂正 2026-11-14] 直前の『O23 の code の変更の後に』は誤りで、arc が直した（arc の記録 https://github.com/watchout/agent-memory/pull/345#issuecomment-6866008348 は「O23 の code の変更を待たない」と書く）。今の分け（arc の技術の判断。Owner の言葉ではない）は 2 つ。(1) 手動の起こし直し（C2c）は、B の後に、人（arc）が起動の script で行う。O23 の code の変更を待たない。変わった hook の信頼の確認の画面は Owner。(2) 見張りへの自動の登録（S5c）は、O23 の code の変更の後の別の段。Owner が打つ script は 2 本のまま。順・閾値・関門・停止・Codex の登録の保留は変えない。

### 関門 O25（(a)(b) の 2 つとも通ること。通らない・読めない（観測できず）のどれでも、そこで止まり、S5・S6 に進まない。成功と記録しない）

**(a) 起動が backup より後**
- 入力: 席の pane（`aidlc-kusabi:0.0`。arc の連絡では pane id `%43`）の claude の process の pid。pane の木から引く（席の読み: pane の最初の process から子を辿り、`ps -o comm=` が `claude` の物）。Claude の席の最新の installer の backup（`.claude/settings.json.bak.wasurezu-<ISO 時刻>-…` の名前の時刻）。[訂正 2026-11-14] 「最新の installer の backup」を置き場の一覧から取る形は前の案で、使わない（この節の最後の「入力の取り方（替わった）」）。
- 取り方: どちらも関門の時点で取り直す（前に取った値を使わない）。起動時刻は `LC_ALL=C ps -o lstart= -p <pid>`。backup の一覧は、A の apply の後に取り直す。A の前の一覧で比べると関門が通ってしまう: 今の process は、今ある最新の backup（名前の時刻 `2026-11-12T01-34-40-344Z`）より後に起きている（席が 2026-11-13 に `ps` と `ls` で読んだ）。[訂正 2026-11-14] この行の「backup の一覧は、A の apply の後に取り直す」も前の案。一覧を取る形をやめ、1 本目の log の A の行から取る（この節の最後の「入力の取り方（替わった）」）。
- 比べ方: `lstart` は現地時間（この Mac は JST）で、時区が付かない。backup の名前は UTC（installer が `toISOString()` の `:` と `.` を `-` に替えて作る）。同じ表し方（epoch 秒）に直し、起動時刻（秒に切り捨て）が最新の backup の時刻より後であること。同じ秒は後に数えず、止める。[訂正 2026-11-14] この行の「最新の backup の時刻」は、最後の「入力の取り方（替わった）」の (iii) の、backup の名前の時刻と backup の file の mtime の両方と読む。
- **入力の取り方（替わった）**（[訂正 2026-11-14] arc の連絡。席間の連絡で、GitHub への記録はまだ無い。arc の技術の判断で、Owner の言葉ではない）: 「置き場の最新の backup」は使わない。2 本目の script は、1 本目の log（`~/Developer/arc/tools/kusabi-self-seat/run3-*.log` の最新）の `backup: <path> <SHA>  前: <SHA>  後: <SHA>` の行（A の行）から backup の path を取り、次の 3 つを確かめる。どれかが合わなければ止まる（成功と記録しない）。(i) その backup がその path にあり、その SHA が「前」と一致する。(ii) 今の `.claude/settings.json` の SHA が「後」と一致する。(iii) claude の process の起動時刻（`lstart` を UTC に直した物）が、backup の名前の時刻と backup の file の mtime の両方より後である。これで、A の前の一覧で比べて関門が通ってしまう穴が塞がる。席は、この log の書式を実物で確かめていない（arc の連絡の書式をそのまま写した。log は arc の script が書く物）。

**(b) 新しい process で hook が動いている**
- 入力: 起こし直した後の最初のターンの後に、`<rotation root>/kusabi/agent-memory/turn.json` を読む（0700 の置き場）。見る欄は `host_pid`・`host_started_at`・`at`（hook の code `session-rotation-files.ts` で確かめた欄の名前）。
- 比べ方: `host_pid` が (a) の pid と同じ。`host_started_at` が (a) の `lstart` の文字と同じ（hook は空白を 1 つにそろえて書くので、(a) の側も同じにそろえる）。`at`（`toISOString()` の UTC）が起動時刻より後。3 つとも成り立つこと。
- 不一致の例: 起こし直しの前から有る `turn.json`（今は `host_started_at` が `Thu Nov 12 11:22:41 2026`）のままなら、`host_pid` か `host_started_at` が (a) と合わず止まる。最初のターンが済んでいない時、変わった hook の確認の画面が承認されず hook が動かない時も、同じく止まる。

**(b) を使う理由**: `turn.json` の有る・無いだけでは、新旧どちらの hook が書いたかを区別できない（`memory.md` の 12:38:45Z）。会話は同じ（同じ session_id）で起こし直すので、session_id でも区別できない。区別には pid と起動時刻を使う。(a) が成り立てば、その process は新しい設定の後に起きている。だからその pid の `turn.json` が (b) の 3 つで合えば、新しい hook が実際に動いた証拠になる。

**席が確かめていない物**: pid の引き方と時刻の変換は arc の script が書く。席は、code（欄の名前と時刻の作り方）と今の実物（`turn.json` の欄・`lstart` の表記・backup の名前の形）を読んだだけで、この関門を実機で流していない。

## S5 見張りの設定への登録と probe

**第 3 版の読み替え**: 見張りは今どこにも動いていない（見張りの設定 `watcher-config.json`・記録 `watcher-ledger.jsonl`・停止の印 `HALT` が無い。2026-11-13 の読み取り）。`<rotation root>`（`~/.agent-memory/rotation`、0700）は実在し、席の旧い hook が `kusabi/agent-memory/` の下に `turn.json`（`host_pid` が席の claude の process）と `hook-state.json` を書いている（前の記録の「folder も無い」は誤りで、書いた後に読み直して訂正した）。S5 の 1 は「設定の file を新しく作る」になり、既にある folder の権限（0700）を確かめる。`owner_decision_ref` は新しい Owner の決定（`#49 6847683704`、本文の SHA-256 `d2749ed886a695d92f67410057cd2c53888550edd3cfd96a5ab843bf09932e5c`、`names_aun_supervised_relaunch: false`）を使う（席の読み。下の値の古い URL `6790645694` は第 1・2 版の決定で、新しい決定が、見張りの起動を含む再配備を述べているため。最終の値は arc が script と見張りの設定の中で決める）。`launch_script` の SHA-256 は Claude の席のものが `496f71ff…4126` のまま（2026-11-13 に取り直して一致）。Claude の席の登録は、S3・S4 の差し替えの読み戻しと C2 の取り直しが合った後。[訂正 2026-11-13] さらに、関門 O25（(a)(b)。上の節）が通った後。前の文は C2 の後と書いたが、関門が間に入る。

1. `<rotation root>/watcher-config.json` に席を 1 件書く。値（arc-sec の C3）:
   - `agent_id`、`project`、`host` = `claude_code`、`tmux_target` = `aidlc-kusabi:0.0`
   - `launch_command` = S0 で読んだ `#{pane_start_command}` の値そのまま（二重引用符を含む形）
   - `expected_command` = 席の `turn.json` の `host_pid` を `LC_ALL=C ps -o comm= -p <host_pid>` で引いた basename と同じ事を**確かめてから**書く。`claude` の見込み。`node` や `sh` なら hook の `process.ppid` が host ではないので、書かずに止まって設計へ戻す。
   - `drain_commands` = **空**。取り込みの hook は node なので、`node` を書くと MCP server も node で常に `import_running` になり、一度も動かなくなる。Stop の hook の上限（9 秒）が静けさの条件（20 秒）より短いので、空で足りる。
   - `prompt_markers` = **`❯`（U+276F）+ NO-BREAK SPACE（U+00A0）の 2 文字の 1 件**。席が probe を新しい版の見張りで流して確かめた（2026-11-13、O22）: この席の入力欄の行は `❯` の直後が U+00A0 で、`❯` だけだと入力欄は「空でない」と読まれ（`input_empty: false`・`cursor_at_input_head: false`）、手すきでも切り直しの条件に通らない。`❯` + U+00A0 だと `input_row_found`・`input_empty`・`cursor_at_input_head` がすべて true。
   - `placeholder_patterns` = 空（この席の画面の入力欄は、空の時に placeholder の文を出さない形で読めた。会話が新しい直後の画面は読んでいない）。
   - `launch_script` = `{ path: <席の起動の script>, sha256: 496f71ff…4126 }`
   - `owner_decision_ref` = `{ url: 上の Owner の決定の comment の URL（6790645694）、sha256: 6626a95d…a5d8、names_aun_supervised_relaunch: false }`
   - `aun_supervised: false`
   - file の権限は 0600、置き場の folder は 0700（code は group・other の書き込みだけ拒む）。
   - `AGENT_MEMORY_HOME` は席の hook と見張りの窓で同じにする（どちらも未設定 = 既定の `<rotation root>`）。
2. `rotation-watcher probe` を一時の HOME で流し、tmux の版・pane の解決・条件つき起動し直しの対応・起動 command の文字・入力欄の行が読めることを確かめる。
3. 席が手すきの時の probe は、入力欄が空で、カーソルが先頭にあること（席が作業中だと「空でない」と出るのは正しい）。
4. S5 の前に、人が席を 1 回起こし直して確かめる事（C2）は、上の「C2 の取り直し」の表。`initialUserMessage` が効くかの確かめ（O5）は、その表では取れない（下の O5）。

## S6 見張りを tmux の窓で起こす（Q2 = A）

[訂正 2026-11-13] 順の読み替え（席の読み。arc の script が正で、違う分け方ならこの読みを直す）: 上の「第 3 版の実行の順」は、S5 の後・S6 の前に「停止の印の確かめ（置く → 消す）」と「印の file が無いことの確かめ」を置く。この節の 2 の「起こす前に、停止の印が置いていないこと」は、後者に当たる。前者は、見張りを起こす前に、印の置き場に印が置けて消せること。見張りが動いている間に印で周回が止まる確かめ（下の 3）は、S6 の後に残す（省かない）。

1. **`aidlc-kusabi` とは別の tmux の session** に窓を作り、見張りを起こす（LLM を使わない script。席の画面にキーを送らない）。同じ session に置くと、見張りの窓を操作する人の client の最終操作が、席の「人が触っている」に数えられ、安全側に倒れて一度も動かない（C4）。
2. 起こす前に、停止の印が置いていないことを確かめる。起こした後、窓が動き、記録（`watcher-ledger.jsonl`）に起動の行が出ること。
3. 停止の確かめを 1 回行う: `<rotation root>/HALT` を置く → 記録に新しい周回の行が出なくなる → 消す → 再開する。この 1 回を省かない。置いた印は次の周回から効く（1 周は、観測・claim・直前の確かめ・respawn の数秒。確認待ちの 60 秒は読むだけ）。claim の後・respawn の前の窓では印を読まない（設計の「次の周回で止まる」のとおり。C7）。
4. 印の種類で、消した後の動きが違う（C4）: **見張り自身が書いた全体の印**（記録できない・非進捗の周回の上限）は process が終わるので、file を消しても再開しない。人が窓で起こし直す。**席の印**（確認できず・結果不明）は loop が続くので、消せば次の印から再開する。
5. 見張りを起こす前の条件（arc の指示）: S3・S4 が済み、SessionStart の initialUserMessage が効くことを確かめるまで起こさない。固定の最初の指示を外したため、新しい会話が続きの指示を受け取れないと、席が止まる（R-E）。
6. **第 3 版**: (b) の「旧い見張りを止める」は、止める物が無い（旧い見張りは 1 度も起こしていない）。見張りの窓は初めて起こす。起こす版は新しい版 `5fd29e06…` の `dist/rotation-watcher.js`（SHA-256 `d79947366454d4ea96fd6d2aa3418f29d052c12e6120b249d0e607973e82e273`）で、見張りと hook は同じ版 `5fd29e06…` にそろえる（上の「(c) 戻した後の読み」の 3・4）。起こす前に、Claude の席の hook が 5 つとも `5fd29e06…` を指すことを読み戻しで確かめる。Codex の席は、起動の script と P1〜P4 が済むまで見張りの設定に入れない（上の S5c）。

## S7 FR9.2 の確かめ（実際に切る）

| 確かめ | 期待 |
|---|---|
| 切り直しが 1 回起きる | 席が手すきの時だけ起動し直しが起き、新しい session id の会話が始まる |
| 続きが届く（O5。C2 では取れず、ここで初めて確かめる） | 新しい会話の最初の入力が SessionStart の initialUserMessage で、前の会話の続きの案内が含まれる |
| 引き継ぎの保存が DB に入っている | 前の会話の決定・状態が読み戻せる（`recover` で確かめる。DB の書き込みは席の通常の経路で、この手順が追加で書かない） |
| 切り直しが圧縮より先に来た（O10） | 閾値 240000 で、席の自動の圧縮（窓 300000）より先に切り直しが来たかを記録する。切り直しの量は、最後の応答の入力・cache 作成・cache 読みの和（= 文脈の大きさ）で、圧縮の窓と同じ量。引き継ぎの 1 ターン分の余裕がある（C5）。**圧縮が先に来た時の形**: 束は圧縮の起動で使われ、その後の respawn は `rotation_marker_id` が合わず「確認できず」になり、席の印が置かれて見張りがその席を止める（データは失われない）。これは失敗でなく、期待される形として証拠に残し、閾値の見直しを arc に伺う |
| 人が見ている間は触らない | 確かめの間、人が tmux の client に 30 秒触らない（触ると「人が触っている」で見張りが切らない。安全側） |
| 作業中は切らない | 席が作業中の時、見張りは切らない（記録に理由） |
| 席の AI-DLC の hook も切れる（C6） | 切り直しの respawn は pane の process 群を終わらせるので、走っている AI-DLC の hook（`continue-workflow` ほか）も切れる。この席では AI-DLC の hook の block で席が続いている間、UserPromptSubmit が来ず turn は `idle` のままになるため、見張りは turn でなく画面の静止 20 秒・入力欄・カーソル・人の静けさで拒む。切れた事実を証拠に残す（R-B・R-D の形） |
| 停止の印 | 置くと止まる |
| **第 3 版で足す**: 引き継ぎを確定する順（#344）が実際に動く | 切り直しの後、引き継ぎが DB に入ったことと、新しい会話の起動の記録が、`output-written/<marker_id>.json` と claim の `output_written_receipt_unobserved` か確認済みの状態のどちらで終わったかを、記録の名前・状態・時刻だけで読む。`output_written_receipt_unobserved` で終わった場合は、見張りが失敗として扱わないかを記録の `resolution` で読む（新しい終わりの値は、新しい版の見張りだけが読める。上の (c)） |
| **第 3 版で足す**: 戻した時に読めること | 実際の切り直しの前に、`rollback-runbook.md` の「見張りと hook を同時に戻す」の順を読み合わせる。戻しの途中で旧い見張りが新しい記録を読んでも、止まるだけで壊さない（上の (c) の R1） |

## 範囲の外で見つけた点（実行の前に確かめる）

| 番号 | 点 | 影響 | 誰に確かめるか |
|---|---|---|---|
| O1 | （第 1 版の時点の事実。第 2 版の時点では、Kusabi の hook が 5 つ入っている）席 `aidlc-kusabi` は `--setting-sources project,local` で、AI-DLC の作業場（`<作業場>`）の設定を読む。この設定には Kusabi の取り込みの hook（`claude-session-start`・`transcript-stop-capture`）が 1 つも入っていない（AI-DLC の hook だけ）。rollout の道具が替える対象は、DB に登録された別の作業場の設定（`.claude/settings.json`）で、`<作業場>` ではない。「古い参照を新しい版に差し替える」だけでは、この席の取り込みも切り直しも動かない | S3 の前提が成り立たない。差し替えではなく、`<作業場>` の設定に installer で hook を新規に入れることになる（無関係な hook は installer が残す）。これは Owner の決定の「席の hook を新しい版に替える」の範囲の読み方に関わる | 状態: 下の「O1（行き先）」の行のとおり解決（権限は、Owner が script を打つ時に #49 へ投稿される記録）。Owner はその記録で、新規に入れることと、入れるとこの席の会話が Kusabi の DB に取り込まれることを知って打つ |
| O1（行き先） | 解決: arc が「Owner は arc が決める範囲とした」と伝え、この席に hook を新しく入れる形で進める（arc の判断。Owner の言葉ではない。席は Owner の言葉を直接は受けていない）。席は `--apply` を流さない（O8）。arc-sec の確かめは通った（iyasaka-arc#57 6791098364、止める指摘 0）。ただし arc-sec は、arc の連絡だけではこの席の権限として引けない（URL と本文の SHA-256 が要る）と指摘した（E1）。そのため権限は、Owner が script を打つ時に script が #49 へ書き込みの前に投稿する記録（Owner が打ったこと自体が承認）の URL と SHA-256 とし、S3 の読み戻しに添える。無ければ S3 は始めない | 取り込みが始まる | arc |
| O2 | rollout の道具の R1 の束（`r1-kusabi`）は、Kusabi の 3 つの host runtime（codex・claude_code・antigravity_cli）の 3 つの設定を替える。決定は「Kusabi 自身の席（tmux aidlc-kusabi）だけ」で、claude_code 以外の 2 つを含むかが読めない | 範囲を超える恐れ | 解決: arc の読み（範囲は `<作業場>` の claude_code の設定だけ。codex・antigravity_cli は範囲外）。rollout の道具は使わず、installer を直接当てる（S3） |
| O3 | rollout の道具は 33 + 2 の 35 target の plan を作る道具で、apply は凍結した plan・認可の file・Owner の決定の ID と参照を要る。1 席だけの plan にしたい場合に道具が対応するか、実装を確かめていない | S3 の道具の選択（Q5 = A）の前提 | 解決: コードの読みで、この作業場を対象にできないと確かめた（固定の 33 行の問い合わせと数の確かめ、任意の作業場を渡す引数が無い）。dry-run は流していない。この席には使わない。Q5 の「必須の入口の一覧」の rollout 側の変更は、この席の据え付けには効かない（版を作る道具の側は効く）。残すかは arc が決める → 解決: arc の判断で残し、#342 で、版を作る道具と rollout の両方の一覧に切り直しの 2 つが入った |
| O4 | 古い常駐を止めると、取り込みの `conversation_events` / `raw_events` は引き続き 0 件のまま（止めるのは誤りの記録の増加を止めるだけ。取り込みの直しは案 B・C で、決定の範囲外）。席の hook が入っても、DB の指定が hook の process に届かなければ取り込みは動かない | 「席の hook を替えたのに取り込みが 0 件」の状態が続く。S7 の「引き継ぎの保存」の確かめが、取り込みの有無に依存しないこと（決定・状態の保存は別の経路）を確かめる必要 | arc-sec / 席（S7 の項目を分ける） |
| O5 | 見張りが席を切るには、SessionStart の initialUserMessage が続きの指示を渡す必要がある。固定の最初の指示を外したので、S4 の後・S6 の前に「新しい会話が続きを受け取る」ことを、見張りを使わずに（人が席を起こし直して）確かめる必要がある | 確かめなしに見張りを起こすと R-E（席が止まる）が起きうる | Kusabi の席が S5 の後に実施。結果を #339 に書く。**第 2 版の追記（2026-11-12）**: SessionStart が `initialUserMessage` を出すのは、切り直しの印（rotation marker）がある時だけで（`claude-session-start.ts` の `loaded.rotation?.initial_user_message`）、印の無い通常の起こし直し（C2）では出ない。そのため「C2 の取り直し」では確かめられない。確かめ方の候補: (a) S7 の実際の切り直し（見張りを起こす必要があり、R-E は Owner が受け入れ済み）、(b) 見張りを使わず、作業場の外の一時 dir で、印つきの SessionStart の hook を別の `claude` の process に当てて見る。arc の答え（Owner の委任 #49 6762288830。Owner の言葉ではない。席間の連絡で、GitHub への記録はまだ無い）: C2 では、SessionStart の hook が受理されて証拠が出ること（`MALFORMED_HOOK_INPUT` が出ない・`auto_receive` の状態・`store_binding`）までを確かめ、続きの引き継ぎが新しい会話の最初の入力に出るかは、FR9.2 の実際の切り直し（S7）で確かめる形でよい。この場合 S5 の前の条件は「C2 の受理の証拠」までで、`initialUserMessage` の確かめは S7 の読み戻しに残る（S7 の表で、新しい会話の最初の入力に引き継ぎの文が出たかを読む） |
| O7 | installer は `--binding-source-ref` を必須の文字列として受けるが、`<作業場>` には DB に登録された結びつき（主）も、Owner が認めた副の結びつきもない。取り込みの記録がこの値を持つ。既存の副の 2 つ（Kusabi の claude_code・antigravity_cli）は、`binding_source: owner_approved_secondary` と、Owner の指示の識別子、作業場の SHA-256 を含む正規化した JSON の形を使っている。同じ形で、`owner_directive` に今回の Owner の決定（`OD-KUSABI-ROTATION-DEPLOY-SELF-SEAT-TRIAL-20261111-001`）、`workspace_sha256` に `<作業場>` の path の SHA-256 を入れる案。結びつきを作ることなので、私は決めない | 値が違うと、取り込みの記録が席に結ばれない、または誤って結ぶ。席を推測で結ばない決まり（project.md Forbidden）に当たる | 解決: arc が上の案で決めた（組み立て方は上の「結びつきの値の組み立て方」）。Owner の言葉ではない |
| O8 | S3・S4 が書く `<作業場>/.claude/settings.json` は、AI-DLC の実行時の保護（runtime integrity）が、席の道具からの書き込みを止める対象に入っている（`.claude/settings.json` を名指しで保護）。席から installer の `--apply` を流しても断られる見込み。席の `.claude/settings.local.json` は保護の名指しになく、現在 hook を持たないが、installer の書き込み先は `.claude/settings.json` 固定で、変えるのは installer の変更（設計の変更）になる | 席が自分では S3・S4 を実行できない。回避しない | 解決: 席は書かない。installer の書き込み先を変える設計の変更もしない。arc が、Owner が 1 回だけ打つ script を作った（記録の投稿 → dry-run → `--apply` → 読み戻し → 失敗なら backup に戻す。S3 と S4 を続けて行う）。arc-sec が E2 で読んだ。打つのは S1 の版の SHA-256 が script に入り、S2 が済んだ後。**第 2 版**: 差し替えの script（SHA-256 `541b4fef2db5dcc51d8ef4c440e7a0f816facb9de94c1007df45ac011d8dd6a7`）は S3 と S4 を 1 回の操作で行う（Q7 = B）。arc が席の今の settings.json の写しで流して確かめ済み。arc-sec の読み直し（O12）は済み |
| O10 | 切り直しの閾値の既定は 300,000 トークン（FR2.1）。席の起動の script は、自動の圧縮の窓も 300000 にしている（`--autocompact 300000` と設定の `autoCompactWindow`）。数えている量の定義（切り直しが読む使用量と、圧縮の窓の量）が同じかは、席の側では確かめていない。同じなら、閾値に届く前後で圧縮が先に始まり、切り直しの前に会話が圧縮される恐れがある | 切り直しが効かない、または圧縮の後に動く | arc（閾値を下げて指定するか、既定のままにして S7 で観測するか。引数は `--rotation-threshold-tokens`）。席は決めない |
| O10（行き先） | 解決: arc の判断で 240000 を指定する（`--rotation-threshold-tokens 240000`）。圧縮の窓 300000 より先に切り直しが来るようにするため。S7 で、切り直しが圧縮より先に来たかを記録する | — | arc |
| O11 | installer は hook の command の先頭に、installer を動かした node の実体の path（`process.execPath`、Homebrew の版つきの path）を書き込む。登録された作業場の Kusabi の既存の hook（claude_code・codex の両方）が指す node の版の path は、今の Mac には存在しない（node は 26.12.1_1 だけが入っている。読むだけで確かめた）。つまり既存の取り込みの hook は、node の入れ替え以後、起動できない状態にある。取り込みが 0 件のままの原因の 1 つとして確からしいが、時期と因果は席では確かめていない。今回入れる hook も、入れた時点の node の版つきの path を指すため、次に node を入れ替えると同じ形で壊れる | S3・S4 の後に node が入れ替わると、取り込みも切り直しも黙って止まる。読み戻しの `--check` は command の文字列は見るが、node の実在までは見ない恐れ | arc / arc-sec（入れる node の path の選び方と、定期の確かめ。installer に node の path の引数を足すのは設計の変更で、席は決めない）。S3 の読み戻しに「指す node が実在し実行できる」を足すことを提案 |
| O11（行き先） | 解決: arc の判断。この試しは、installer が書く今の node の実体の path（Homebrew の node 26.12.1_1）のままにする。S3 の読み戻しで、指す node が実在し実行できることを見る。版つきの path で壊れる件は、次の PR（Q5 と同じ PR）で installer に `--node-path` を足して直す（既定は今の動きのまま、試験を足す）。登録された作業場の既存の hook が、存在しない node の版を指して動かない件は、取り込みが 0 件の原因の候補として #339 に事実だけ 1 回書く。直すのは Owner が後で決める案 B の範囲で、今は直さない | 次の PR の範囲が増える（`--node-path` と試験） | arc |
| O11（第 2 版） | 解決: `--node-path`（FR10.7）は #342 で入った（既定は今の動きのまま。絶対 path・正規化済み・最後の名前が `node`・実行できる通常の file か、それへの symlink だけを受け付ける）。第 2 版は arc の答え Q6 = B で、版に依らない symlink `/opt/homebrew/bin/node`（今は版つきの node 26.12.1_1 への symlink）を指定する。node を入れ替えても hook は壊れない。symlink の先を同じ利用者が付け替えられる点は、同じ uid の悪意を防げない既存の限界の内。登録された作業場の既存の hook が存在しない node を指す件は、今回の範囲の外（案 B）のまま | 範囲外の席の hook は直らない | arc |
| O12 | Owner の決定の条件「実行の前に arc-sec が具体の手順を確かめる」。第 2 版は手順の形が変わった（新規の追加 → 差し替え、`--node-path`、S3 と S4 を 1 回の操作、C2 の取り直しの項目）。第 1 版の確かめ（iyasaka-arc#57 6791098364）は第 1 版の手順に対するもの | 読み直しの前に Owner に script を渡すと、決定の条件を満たさない | **解決（2026-11-12）**: arc-sec が差し替えの script と #49 に投稿する記録を読み、止める点 0（iyasaka-arc#57 の comment 6811122140、本文 SHA-256 `e84e8b7bc0e672fcea15d03a49d0fe60f0adb79f1b6398b8058251083568787f`。席が GitHub の API が返す本文で数えて一致）。Owner が script を打つ段に進んでよい（席が手すきの間） |
| O9 | S6 の窓は tmux の `aidlc-kusabi` とは別の tmux の session に置く（C4）。窓を閉じる・Mac の再起動で見張りが止まる（常駐ではない）。これは Q2 = A の意図どおりで、再起動後に切り直しが止まっても失敗ではない | 運用の期待 | 記録のみ |
| O13 | **第 3 版**: Codex の席の起動の script が無い（P1）。tmux `kusabi:0.0` の起動 command は `/tmp` の下の script を指し、その file は今は存在しない。見張りは、この起動 command をそのまま流して席を起こし直す。このままの Codex の席を見張りに登録して切り直しが起きると、新しい会話が起きない（R-E）。同じ形の Onza・Totonoe の席も同じ（範囲の外。事実だけ arc に伝える） | Codex の席の切り直しが成立しない。Claude の席には影響しない | arc（`/tmp` の外に新しい起動の script を作り、SHA-256 を登録する値にする。作る内容は席が決めない。席の起こし直しは arc が行う） |
| O14 | **第 3 版**: Codex の SessionStart は続きの最初の入力を出さない（P2）。引き継ぎの文は `additionalContext` として文脈に入るが、人が入力しないと動かない形になりうる。起動の script に固定の最初の入力を持たせるか、持たせずに受け入れるかは、Claude の席で「固定の最初の指示を外した」判断（R-E を受け入れた）との整合も含む | 切り直しの後、Codex の席が続きから自動で動かない | arc（起動の script に最初の入力を持たせるか。持たせるなら、その入力の中身は arc が決め、席が決めない。守る物ではない技術の判断。席の読み） |
| O15 | **第 3 版**: Codex の hook の信頼の確認（P3）。差し替えで handler の中身が変わり、切り直しの handler 2 つが新しい位置に増える。席は、Codex が未信頼の handler を止めるのか警告だけなのかを確かめていない。信頼の確認は画面で Owner が行う。確認前は hook が動かない前提で読む。`~/.codex/config.toml` は書かない | Codex の席で、起こし直しの後も hook が動かない時間がありうる | Owner（画面の確認）/ arc。結果が C2c の「hook が動く」の行 |
| O16 | **第 3 版**: Codex の hook の親 process（`host_pid`）の実体の名前を、席は実機で見ていない（P4）。pane の木は `bash` → `node` → `codex` の 3 段で、親が `codex` でなければ `expected_command` の値が変わる。`node`・`sh` だと、見張りが席を誤って特定する、または毎回「観測できず」になる | 見張りの非進捗の周回が増え、見張り全体が止まる（上限は既定 30 周） | 席（S5c の前に、新しい hook が書いた `turn.json` の `host_pid` を引く）。`codex` 以外なら登録せず設計へ戻す |
| O17 | **第 3 版**: Codex の席の切り直しの閾値。Codex の席の起動に自動の圧縮の指定が無い（`config.toml` に `model_auto_compact_token_limit`・`model_context_window` が無い）。窓は Codex の会話の記録に host の報告値として出ており、今の席は 258400（P5）。測る量は、同じ記録の最後の `token_count` の直近の入力の量（`codex-context-measurement`）で、切り直しの code は窓を使わない。Claude の席の 240000 を使うと窓の約 93%（余裕 18400）で、Codex 自身の圧縮が先に始まる量が 240000 より小さければ、切り直しの前に圧縮が来る。席は Codex の圧縮の始まる量を確かめていない | 閾値が圧縮の始まる量より大きいと、切り直しの前に会話が圧縮される。小さすぎると、切り直しが早く来る（軽） | arc（閾値の値。席は 240000 で始め、S7c で圧縮が先に来たかを記録して見直す案を勧める。守る物ではない技術の判断） |
| O18 | **第 3 版**: Codex の取り込みの効果。今の Codex の取り込みの hook は存在しない node を指して起動できず、取り込みは 0 件。差し替えで、Codex の席の会話（redaction の後の、利用者と AI の見える文と tool の名前）が、席の通常の経路で Kusabi の DB に取り込まれ始める（O4 のとおり、hook の process に DB の指定が届くことが前提）。DB の構造は変えない | Owner の記録（script B の前の投稿）で承認される効果。DB の書き込みは席の通常の経路で、この手順が追加で書かない | Owner（記録の投稿を打つことが承認） |
| O20 | **第 3 版**: S5（見張りの設定の file を作る・probe）と S6（見張りの窓を起こす）を誰が行うか。第 1・2 版の記録は「S5〜S7 は席が行う」としたが、第 3 版の Owner の決定は「新しい見張りを起こす」を arc が作り Owner が打つ script の中に置いた（見張りの起動は、席が書かない保護面の動作）。席の読み: 設定の file を書く・見張りを起こす動作は、script の中（Owner が打つ）。probe は書かず席の画面を読むだけなので、席が先に流して `prompt_markers`・`placeholder_patterns` の値を渡せる。席の読みで、決めるのは arc | 席が書く・起こす形にすると、決定の「Owner が打つ」の外になる | arc |
| O21 | **第 3 版**: 切り直しを実際に 1 回起こす条件（(d)）。席の hook の閾値は 240000 で、見張りは席の会話の量がそこに届いた時だけ切る。今の席の会話の量で届くまでに時間がかかるなら、(d) の確かめがいつ起きるかは席の使われ方で決まる。閾値を一時的に下げて確かめる形は、hook の引数の変更（もう 1 回の installer の適用）になり、確かめた後に 240000 へ戻す操作も要る。席は決めない | (d) が実際に起きる時期が読めない／閾値を動かす操作が増える | arc（自然に届くのを待つか、閾値を下げて試すか。守る物ではない技術の判断） |
| O13（行き先） | 解決: arc の判断で、起動の script を `~/Developer/arc/tools/seat-launchers/start-kusabi-codex.sh`（SHA-256 `09f8c869…00b0`、700）に作った（上の「第 3 版の arc の決定」）。席が SHA-256 と権限を読み取りで確かめた。Codex の席の起こし直しの script（前の記録は「2 本目」と書いた。[訂正 2026-11-13] 呼び方は arc が決める。[訂正 2026-11-14] 答えが出た: Owner が打つ script ではなく、人が行う別の段。下の「script の分け」）が、見張りの設定ではなく Codex の席の起こし直しに使う。見張りの `launch_script` への登録は、O23 が解決するまで入れない | — | arc |
| O14（行き先） | 解決: arc の判断で、起動の script に固定の最初の入力を持たせる（終わりに 1 文を足す）。Claude の席で「固定の最初の指示を外した」判断とは別（Codex は SessionStart が続きの入力を出さないため） | — | arc |
| O17（行き先） | 解決: arc の判断で、Codex の席の閾値は 200000。S7c で、圧縮が先に来たかを記録して見直す | — | arc |
| O20（行き先） | 解決: arc の判断で、S5・S6 は Owner の script の中。probe は席が先に流した（O22・O23） | — | arc |
| O21（行き先） | 解決: arc の判断で、自然に届くのを待つ。閾値を一時に下げる操作は足さない。席が S7 を見て記録する | 届くまでの時間は席の使われ方で決まる | arc |
| O22 | **第 3 版（probe）**: Claude の席の入力欄の行は、`❯`（U+276F）の直後が NO-BREAK SPACE（U+00A0）で、通常の空白（U+0020）ではない。見張りの枠線の読み飛ばし（`FRAME`）は U+2500〜U+257F・空白・tab だけで、U+00A0 を含まない。`prompt_markers` に `❯` だけを書くと、手すきでも入力欄が「空でない」と読まれ、切り直しの条件（`input_not_empty`）に通らず、切り直しが起きない（失敗側）。マーカーを `❯` + U+00A0 にすると、`input_row_found`・`input_empty`・`cursor_at_input_head` がすべて true（席が新しい版の見張りの probe で確かめた） | S5 のマーカーの値を間違えると、見張りは動いても切らない。気づきにくい（毎周回「待ち」が続く） | arc。script の設定の file に `prompt_markers` = [U+276F U+00A0] を入れた。ほかの席（Onza・Totonoe の Codex・Claude）のマーカーの値は範囲の外 |
| O23 | **第 3 版（probe）**: Codex の席の画面は、入力欄の下に枠線でない行（モデル名と作業場の行・ショートカットの行）があり、見張りの入力欄の判定が `text_below_input_row` で「空でない」を返す（上の Codex の節の「probe の結果」）。今の code では、Codex の席は登録しても切り直しが起きない。非進捗には数えないので、見張り全体は止まらない | Codex の席の実際の切り直し（Owner の決定の (d) の Codex 分）が、code の変更なしには起きない。席の切り直しの設計が Claude の席の画面の形を前提にしている | arc（判定を Codex の画面に合わせる code の変更を、新しい単位として行うか。守る物に触れるかも arc の判断。席は決めない）。席の勧め: [訂正 2026-11-13: 「1 本目・2 本目」は前の分けの呼び名。今の分けは上の「第 3 版の実行の順と関門 O25」] 1 本目・2 本目の Codex の hook と起こし直しまでは進め、見張りへの追加は code の変更の後 **arc の答え（2026-11-13、席間の連絡。arc の技術の判断で、Owner の言葉ではない。GitHub への記録はまだ無い）**: Codex の席を見張りに足すのは、入力欄の判定を Codex の画面（入力欄の下の 2 行）に合わせる code の変更の後。その変更は新しい小さい単位（bugfix、Kusabi の repo の code、守る物には触れない）として、この取り組みの配る段の後に立てる。それまでは B（Codex の hooks.json の差し替え、閾値 200000）だけを入れ、Codex の席の切り直しは、hook が印を置いたのを席か arc が見て、人（arc）が起動の script で起こし直す（これで「Codex でも続きから動く」を確かめる）。[訂正 2026-11-14] この起こし直しは手動の起こし直し（C2c）で、O23 の code の変更を待たない。見張りへの自動の登録（S5c）が、O23 の code の変更の後の別の段（https://github.com/watchout/agent-memory/pull/345#issuecomment-6866008348 の「O23 の code の変更を待たない」）。 |
| O24 | **第 3 版**: Codex の版。PATH の `codex` は 0.166.0、席が使う bun の `codex`（node@24 で動かす形。arc の起動の script が起こす）は 0.163.0。第 3 版の最初の記録の「0.166.0」は PATH の方を読んだ誤り（arc の指摘で直した）。今動いている Codex の process（2026-10-16 の起動）の版は確かめていない | Codex の hook の契約を確かめた版と席の版がずれると、hook の入力の形が違う恐れ | 席。[訂正 2026-11-13: 「1 本目・2 本目」は前の分けの呼び名。Codex の席の script の前の確かめ] 1 本目・2 本目の前の確かめに「どの codex を読んだか」の 1 行を足した |
| O25 | **第 3 版**: arc の分け方（1 本目に A と S5・S6 を続ける）では、見張りが、まだ新しい hook を読み込んでいない席（今動いている claude の process）を見る恐れがある。席は、Claude Code が設定の hook を起動時の写しで使うのか、変更をその場で読むのかを、文書では確かめていない（席の記憶: 起動時の写しで、外から書き換えた hook は再確認が要る形）。見張りの動き（コードを読んだ）: 席に印（marker）が無い間は `no_marker`（`idle`）で何も起きず、非進捗にも数えない。**席の会話の量が閾値に届いて旧い hook（`28596bf0…`）が印を作った時**に、新しい見張りがそれを見ると、(c) の 4 の形（新しい見張りと旧い hook の組。確認できない形になる見込み。流していない）になる。今のこの席は長い会話で、閾値に届く時期は読めない | 1 回の打鍵で hook を替えて見張りまで起こすと、席を起こし直していない間に、旧い hook の印を新しい見張りが読む恐れ | arc。[訂正 2026-11-13] 前の案（関門は、起動時刻と backup の比較だけ。決めはこの行の末尾）: 席の下書きは、S5・S6 の前に関門を置いた: 席の claude の process の起動時刻が、最後の Kusabi の installer の apply の時刻（`settings.json.bak.wasurezu-<時刻>-<uuid>` の名前の時刻。AI-DLC の hook などが同じ file を書いても動かない）より後であること。`turn.json` は旧い hook も書くので、関門には使わない（`turn.json` の `host_pid` は、`expected_command` = `claude` の確かめだけに使う）。満たさなければ止まり、「席を 1 回起こし直してから同じ script をもう 1 回打つ」と表示する（A・B は済んでいれば飛ばす）。この関門は、席の hook の読み込みの仕組みに依らず成り立つ。[訂正 2026-11-13] ここまでが前の案。 **arc の答え（2026-11-13、席間の連絡。arc の技術の判断で、Owner の言葉ではない。GitHub への記録はまだ無い）**: 関門 (a)(b) の形でよい。changed_hook_requires_operator_review の確認の画面は Owner が押す、と script の出力に書く。[訂正 2026-11-13] arc の決め（席間の連絡。arc の技術の判断で、Owner の言葉ではない。GitHub への記録はまだ無い。権限の根拠として引かない）: 関門は (a)(b) の 2 つとも使う。入力・取り方・比べ方・不一致で止まることは、上の「第 3 版の実行の順と関門 O25」の節（正本）。前の案の「`turn.json` は旧い hook も書くので、関門には使わない」は、(a) が成り立てば、その pid の `turn.json` が新しい hook の動いた証拠になるので、(b) に使う形に替わった（`turn.json` の有る・無いだけでは新旧を区別できない事実は変わらない）。 |
| O19 | **第 3 版**: 見張りと hook の版の同時の入れ替え（arc の判断。arc の席間の連絡で、GitHub への記録はまだ無い）。上の (c) が、その根拠をコードと使い捨ての確かめで支える（旧い見張りは新しい終わりの値を読めず `unreadable`。新しい hook は `rotation_marker_id` を claim 経路で常に null にするので、旧い見張りは確認できない） | 一方だけ戻すと、切り直しが続かない（失敗側に倒れる） | 記録のみ。`rollback-runbook.md` に同時に戻す順を書いた |

## arc-sec の確かめ（iyasaka-arc#57 6791098364、止める指摘 0）への答え

読むだけの確かめで、実装監査の代わりでも、据え付けの許可でも、Owner の決定の代わりでもない（arc-sec の但し書き）。S0〜S2 はこの確かめのとおり進めてよい。

| 番号 | arc-sec の指摘 | この記録での扱い |
|---|---|---|
| D1 | S3 の戻しが rollout の道具の preimage 復元を指している | 直した: `rollback-runbook.md` の S3 の行と、上の S3 の 6 を、installer の backup の復元に（復元の前に SHA-256 を比べ、違えば上書きせず止まる。復元の後の `--check` は `config_match: different`・終了コード 1 が期待。file の SHA-256 が backup と同じ事を読み戻しに書く） |
| D2 | dry-run は差分を出さない | 直した: 上の S3・S4 の 2 と 4。dry-run は数だけ（無関係な hook 3・3）、差分は apply の後の `diff -u` |
| E1 | O1 の Owner の言葉を権限として引けない | 上の O1（行き先）。script が書き込みの前に #49 へ投稿する記録の URL と SHA-256 を S3 の読み戻しに添える。無ければ S3 は始めない |
| E2 | arc の script を S3 の前に読む | 第 1 版の script は済み（arc-sec が読んだ）。第 2 版の script は O12（済み。止める点 0）。席は上の command の形が script の中身と同文かを、本文を読んで確かめた（第 2 版: SHA-256 `541b4fef…d6a7`、`--node-path /opt/homebrew/bin/node`、`--rotation on --rotation-threshold-tokens 240000` の 1 回の操作）。読み戻しでも同じ項目を取り直す |
| C1 | 読み戻しに node の実在と、PR に載せない確かめ | 上の S3 の 4・5 |
| C2 | S3・S4 の後の最初の人手の起動で、AI-DLC の hook が整合性の誤りを出さずに動く事と、Kusabi の SessionStart の証拠 | arc が席を起こし直して確かめる。確かめる値: AI-DLC の hook（session-start・guard-tool-call）が誤りを出さない、`auto_receive.status`（captured か理由コード）、`store_binding.source` と `backend_intent` を 1 行ずつ（URL は書かない）、DB が同じ Mac かを 1 行。この確かめで今の会話は終わるので、その前に記録と diary を保存する |
| C3 | S5 の設定の値 | 上の S5 の 1 |
| C4 | 見張りの窓は別の tmux の session。全体の印と席の印の消した後の違い | 上の S6 の 1・4。`rollback-runbook.md` にも 2 行 |
| C5 | 閾値 240000 は可。圧縮が先に来た時の形 | 上の S7 の表 |
| C6 | 席の AI-DLC の hook も respawn で切れる | 上の S7 の表。#339 に 1 行。`rollback-runbook.md` の失敗の形 |
| C7 | HALT は次の周回から効く | 上の S6 の 3 |
| C8 | 古い `scripts/install-hook.sh` は使わない | 上の S3 の 7 |
| C9 | 取り込みは transcript を 8 MiB まで（Stop は末尾 4 MiB） | 上の S3 の 8。許容 |
| 版を作る場所 | （arc-sec の指摘ではない。席が見つけた） | 上の S0・S1。作業場は清潔でなく、道具は清潔な checkout と head の一致を要求するため、別の checkout で作る |
