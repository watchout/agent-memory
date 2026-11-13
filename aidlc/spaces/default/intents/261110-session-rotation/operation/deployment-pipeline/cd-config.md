# 配備の設定 — 具体の手順（261110-session-rotation）

方針は `deployment-strategy.md`、戻し方は `rollback-runbook.md`。この記録は手順を書くだけで、何も実行していない。agent-memory#339 に出した手順を arc-sec が確かめ、通った（iyasaka-arc#57 6791098364、止める指摘 0。第 1 版の手順に対して）。その指摘への答えは末尾の表。実行は、この段の承認の後の「Deployment Execution」で行う。

**第 2 版（2026-11-12）**: 第 1 版の据え付け（S0〜S4 と C2、実行の記録 `deployment-log.md`）の後、C2 で Claude Code 2.1.321 が hook の入力に足した key のために Kusabi の SessionStart が `MALFORMED_HOOK_INPUT` になる故障が見つかり、PR #342（統合の commit `94f1ca6d0042bd970d4cc7c4ab9ce9153b7d5c0d`）で直った。この第 2 版は、その後の「やり直し」の手順で、第 1 版からの違いは次の 5 点:
1. 版の元が `94f1ca6d…`（#342 の統合の commit）になり、版は `28596bf0915d16b72bd7b5878aadda6ebe7efd7564b6520d0f938eb668e7cd92` を作り直した（S1 は済み。実行の記録の「S1 のやり直し」）。
2. 席の設定には、Kusabi の hook が既に 5 つ入っている（SessionStart 1・Stop 2・UserPromptSubmit 2。すべて旧い版 `1b731f00…` と版つきの node の path を指す）。S3・S4 は「新規の追加」でなく「新しい版への差し替え」になる。
3. Q5（必須の入口の一覧に切り直しの 2 つ）・installer の `--node-path`・`.gitignore` の backup の 1 行は、#342 で入った。「次の PR」とした記述は直した。
4. S5 の前に、C2 を取り直す（SessionStart の証拠が入力を読めていること、診断の記録、`claude --version` の 1 行。下の「C2 の取り直し」）。
5. S0 の Owner の決定・S2（古い常駐を止める）は第 1 版で済みで、やり直さない。再確認は読み取りだけ。

表記の決まり: 絶対 path は書かない。`<作業場>` は Kusabi の席が読む AI-DLC の作業場（この repo の clone）、`<release>` は S1 で作る中身の決まった版の root、`<席の起動の script>` は Kusabi 自身の席の起動の script（作業場の外にある。arc が作った物）。見張りの置き場は `<rotation root>`（切り直しの記録の root。見張りの設定 `watcher-config.json`・停止の印 `HALT`・記録 `watcher-ledger.jsonl` が下にある）。

## S0 前提の確認（書き込みなし。第 2 版は読み取りだけで再確認する）

| 確認 | 期待する値 | 見る方法 |
|---|---|---|
| Owner の決定 | `OD-KUSABI-ROTATION-DEPLOY-SELF-SEAT-TRIAL-20261111-001`、本文 SHA-256 `6626a95dcafbaac9c6155d2801a466f5fb55090f5200c74ef88083afec5aa5d8`。第 2 版も同じ決定の範囲（Q1 = A: Kusabi 自身の席だけ。Q3 = A: 切り直しが入った版 `aa77b683` 以後から作る案で、その席の hook を替える）。`94f1ca6d` は `aa77b683` の後 | GitHub の comment を取り直して数える |
| 版の元 | main の `94f1ca6d0042bd970d4cc7c4ab9ce9153b7d5c0d`（PR #342 の統合の commit。統合の後の main の CI は 3 つとも success）。第 1 版の `aa77b683…` は使わない | `git fetch origin main` の後、`git merge-base --is-ancestor 94f1ca6d0042bd970d4cc7c4ab9ce9153b7d5c0d origin/main` が成り立ち、作る場所の head が 40 桁と一致 |
| 席の設定の今の状態 | Kusabi の hook が 5 つ（SessionStart 1・Stop 2・UserPromptSubmit 2）で、すべて旧い版 `1b731f00…` と版つきの node の path を指す。無関係な hook は SessionStart 1・Stop 1・UserPromptSubmit 1 の 3・3（ほか PreToolUse・PostToolUse・SessionEnd・PreCompact・SubagentStop は数えない）。席がこの会話で読んだ（読み取りのみ） | 実行の時に、同じ数え方で取り直す（command の中身は読み戻しに書かない。版の SHA-256 の先頭 8 桁と node の folder 名だけ） |
| 作る場所 | 作業場とは別の、清潔な checkout。版を作る道具は「作業場が清潔で、head が `--expected-head` と一致」を要求する（`SOURCE_BOUNDARY_FAILED`）。作業場は別の branch にあり、AI-DLC の記録が未コミットなので、ここでは流せない | 作る場所で `git status --porcelain=v1 --untracked-files=all` が空 |
| 起動の script の SHA-256 | `496f71ff046d0f0db5afab0064b9a18da1eb3c853a0f19a66d4ae6df203d4126`（arc が固定の最初の指示を外した版） | `shasum -a 256 <席の起動の script>`。違えば登録せず arc に知らせる |
| 席の画面 | tmux の窓 `aidlc-kusabi`、pane の起動 command が `bash <席の起動の script>; exec zsh -l` の形 | `tmux display-message -p -t aidlc-kusabi:0.0 '#{pane_start_command}'` |
| 古い常駐 | 第 1 版の S2 で止めて無効にした（`launchctl print` は `Could not find service`、`print-disabled` は disabled、誤りの記録の file は止めた時の 110,355,058 byte のまま）。第 2 版は読み戻しだけを取り直す。**戻っていたら（読み込まれている・増えている）止めて、Owner に見せる** | `launchctl print`・`launchctl print-disabled`（読むだけ）と file の大きさ |
| DB | 変えない。この手順は DB へ書かない | 手順のどの段も DB の URL を渡さない |

## S1 中身の決まった版を作る（第 2 版: 済み）

S1 は 2026-11-12 に済んだ（実行の記録 `deployment-log.md` の「S1 のやり直し」）。版は `28596bf0915d16b72bd7b5878aadda6ebe7efd7564b6520d0f938eb668e7cd92`（`94f1ca6d…` から作った。readback は `PASS_EXACT_READBACK`、必須の入口 12 件がすべて一致、作る場所での `npm audit --omit=dev` は 0 件）。手順は第 1 版と同じ形（作る場所を `git clone` して `--detach` → `--mode publish --expected-head <40 桁>` → `--mode readback --release-sha <版>` → 追加の確かめ → 版の SHA-256 を arc に渡す）で、第 1 版からの違いは次の 3 点:
1. 版の元が `94f1ca6d…`（`aa77b683…` ではない）。
2. Q5 は #342 で入り、道具の必須の入口の一覧に切り直しの 2 つ（`dist/session-rotation-stop.js`・`dist/rotation-watcher.js`）が入った（12 件）。readback がこの 2 つも見るので、第 1 版の「別の確かめ」はこの 2 つには要らない。
3. 一覧に無い installer（`dist/claude-hook-installer.js`・`dist/codex-hook-installer.js`）は、FR10.6 のとおり一覧に足していない。この 2 つが通常の file（symlink でない）で実在することと SHA-256 は、引き続き別に読み戻しへ書く。
出来た版は消さず、古い版（`1b731f00…` など、今の hook が指している版）もそのまま残す。

## S2 取り込みの古い常駐を止める（Q4 = A。第 1 版で済み。第 2 版は S0 の再確認だけ）

1. 止める前に、`launchctl print` の出力と plist の SHA-256 を証拠に取る。
2. `launchctl bootout gui/<uid>/com.watchout.wasurezu.raw-capture` で止め、`launchctl disable gui/<uid>/com.watchout.wasurezu.raw-capture` で無効にする。plist・設定の file・古い build は消さない。
3. 読み戻し: job が読み込まれていない・無効、誤りの記録の file の大きさが増えない。
4. 戻し: `launchctl enable …` と `launchctl bootstrap gui/<uid> <plist>`（Owner の決定が要る。`rollback-runbook.md`）。

## S3・S4 席の Kusabi の hook を新しい版に差し替える（第 2 版。1 回の操作。Q3 = A、Q6 = B、Q7 = B）

arc の読み（範囲の読み。Owner の委任 #49 6762288830 の下の arc の答えで、Owner の言葉ではない）: 範囲は tmux `aidlc-kusabi` の席が読む設定、つまり claude_code の AI-DLC の作業場 `<作業場>` の `.claude/` だけ。codex・antigravity_cli の設定は範囲外。

道具の選び直し（第 1 版のまま）: 既存の `kusabi:direct-fleet-rollout` は、この作業場を対象にできない。コードで確かめた事実: 対象は DB の主な結びつきを引く固定の問い合わせの 33 行（数が合わないと止まる）と、登録された Kusabi の作業場の副の 2 行で、R1 の束はその Kusabi の 3 つの host。任意の作業場を渡す引数が無い。`<作業場>` は登録された作業場ではない。そのため、arc の指示（rollout の道具で 1 つに絞れないなら installer を直接当てる）に従い、installer を `<作業場>` に直接当てる。

**第 2 版は「差し替え」**: `<作業場>` の設定には、第 1 版で入れた Kusabi の hook が 5 つ（SessionStart 1・Stop 2・UserPromptSubmit 2）入っている。installer は、管理下の handler を新しい runtime root で作り直す（増えも減りもしない）。切り直しの handler は、`--rotation` を付けると作り直され、付けないと「今あるものをそのまま残す」（`rotationGroupsFor` のコードで確かめた）。arc の答え Q7 = B のとおり、`--rotation on --rotation-threshold-tokens 240000` を付けた 1 回の操作で、5 つを一度に替える。途中に新旧が混ざる状態は作らない。

**第 1 版との効果の違い（O1 の続き）**: 第 1 版の取り込みの hook は、Claude Code 2.1.321 の入力を拒否して動かず、この席の会話の取り込みは実際には始まっていない（`MALFORMED_HOOK_INPUT`）。差し替えで、取り込みが実際に動き始める。入ると、この席の会話（redaction の後の、利用者と AI の見える文と tool の名前）が、席の通常の経路で Kusabi の DB に取り込まれる。ただし O4 のとおり、hook の process に DB の指定が届かなければ取り込みは動かない（第 2 版の C2 の取り直しで、`auto_receive.status` と `store_binding` を読んで確かめる。DB の書き込みは席の通常の経路で、この手順が追加で書かない）。

**書く主体: 席は書かない。Owner が arc の script（`<arc の script>`、作業場の外。第 2 版の SHA-256 は `541b4fef2db5dcc51d8ef4c440e7a0f816facb9de94c1007df45ac011d8dd6a7`、席が本文を読んで下の順と同文であることを確かめた）を 1 回打つ**（O8。arc の判断で、Owner の言葉ではない）。`--apply` を席が流すことはしない。

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
10. 実行の前の条件: Owner の決定の条件「実行の前に arc-sec が具体の手順を確かめる」のため、第 2 版の手順（差し替え・`--node-path`・1 回の操作）を arc-sec が読み終えていること。arc が arc-sec に依頼済みで、読み終えるまで Owner に打つ段を渡さない（arc の判断）。

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

作り方の確かめ（実行の前に席が行った、書き込みなしの確認）: 既存の副の結びつきの文字列を同じ正規化で作り直すと一致する。登録された作業場の `workspace_sha256` は、その path の SHA-256 と一致する。組み立てた値の全文は、path の SHA-256 を含むため、この公開の記録には書かず、arc への連絡にだけ載せた。arc の script は、同じ手順で作るか、載せた値をそのまま使う。

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

**外れ（deviation）— 第 4 回の C2、「取り込みの経路」の行**（2026-11-12。arc の判断。Owner の委任 iyasaka-arc#49 6762288830 の技術の範囲で、Owner の言葉ではない。席は柵が拒んだ読みを回避も代行もしていない）:
- 採った判断: `auto_receive.status` を C2 の合格の条件から外し、「続きの案内（`wasurezu-recovery-pack/v1`）が、この会話の文脈に実際に届いた」事実の観測で置き換える。観測の中身は、案内の pack ref の時刻（11:22:42.288 JST）と診断の記録の SessionStart の更新時刻（11:22:42.333 JST）の一致（差 45 ミリ秒）。
- 採らなかった代替: (1) 本番の DB の品質ログ（`recovery_quality_log`）の 1 行を READ ONLY の SELECT で読む（席の柵が「Production Reads」で拒否した）。(2) Owner に端末で同じ SELECT を流して出力を見せてもらう。
- 出典（control_source_ref）: agent-memory#339 の comment 6812844309 の (1)、本文の SHA-256 `141b188728c12f07e477bc0a65776cf5d328b411915d24f9bf1ad997a9737187`（arc の技術の判断。Owner の決定ではない。作者が GitHub の API が返す本文で数え直して一致を確かめた）。
- 残ること: `auto_receive.status` の値は観測できていない。観測できないものを成功とは読まない（S5）ので、この行は「値を観測した」ではなく「届いた事実で置き換えた」と書く。品質ログの読みは、S5 の見張りの probe を据える時に、その段の手順で改めて扱う。

## S5 見張りの設定への登録と probe

1. `<rotation root>/watcher-config.json` に席を 1 件書く。値（arc-sec の C3）:
   - `agent_id`、`project`、`host` = `claude_code`、`tmux_target` = `aidlc-kusabi:0.0`
   - `launch_command` = S0 で読んだ `#{pane_start_command}` の値そのまま（二重引用符を含む形）
   - `expected_command` = 席の `turn.json` の `host_pid` を `LC_ALL=C ps -o comm= -p <host_pid>` で引いた basename と同じ事を**確かめてから**書く。`claude` の見込み。`node` や `sh` なら hook の `process.ppid` が host ではないので、書かずに止まって設計へ戻す。
   - `drain_commands` = **空**。取り込みの hook は node なので、`node` を書くと MCP server も node で常に `import_running` になり、一度も動かなくなる。Stop の hook の上限（9 秒）が静けさの条件（20 秒）より短いので、空で足りる。
   - `prompt_markers`・`placeholder_patterns` = probe の出力から取る。
   - `launch_script` = `{ path: <席の起動の script>, sha256: 496f71ff…4126 }`
   - `owner_decision_ref` = `{ url: 上の Owner の決定の comment の URL（6790645694）、sha256: 6626a95d…a5d8、names_aun_supervised_relaunch: false }`
   - `aun_supervised: false`
   - file の権限は 0600、置き場の folder は 0700（code は group・other の書き込みだけ拒む）。
   - `AGENT_MEMORY_HOME` は席の hook と見張りの窓で同じにする（どちらも未設定 = 既定の `<rotation root>`）。
2. `rotation-watcher probe` を一時の HOME で流し、tmux の版・pane の解決・条件つき起動し直しの対応・起動 command の文字・入力欄の行が読めることを確かめる。
3. 席が手すきの時の probe は、入力欄が空で、カーソルが先頭にあること（席が作業中だと「空でない」と出るのは正しい）。
4. S5 の前に、人が席を 1 回起こし直して確かめる事（C2）は、上の「C2 の取り直し」の表。`initialUserMessage` が効くかの確かめ（O5）は、その表では取れない（下の O5）。

## S6 見張りを tmux の窓で起こす（Q2 = A）

1. **`aidlc-kusabi` とは別の tmux の session** に窓を作り、見張りを起こす（LLM を使わない script。席の画面にキーを送らない）。同じ session に置くと、見張りの窓を操作する人の client の最終操作が、席の「人が触っている」に数えられ、安全側に倒れて一度も動かない（C4）。
2. 起こす前に、停止の印が置いていないことを確かめる。起こした後、窓が動き、記録（`watcher-ledger.jsonl`）に起動の行が出ること。
3. 停止の確かめを 1 回行う: `<rotation root>/HALT` を置く → 記録に新しい周回の行が出なくなる → 消す → 再開する。この 1 回を省かない。置いた印は次の周回から効く（1 周は、観測・claim・直前の確かめ・respawn の数秒。確認待ちの 60 秒は読むだけ）。claim の後・respawn の前の窓では印を読まない（設計の「次の周回で止まる」のとおり。C7）。
4. 印の種類で、消した後の動きが違う（C4）: **見張り自身が書いた全体の印**（記録できない・非進捗の周回の上限）は process が終わるので、file を消しても再開しない。人が窓で起こし直す。**席の印**（確認できず・結果不明）は loop が続くので、消せば次の印から再開する。
5. 見張りを起こす前の条件（arc の指示）: S3・S4 が済み、SessionStart の initialUserMessage が効くことを確かめるまで起こさない。固定の最初の指示を外したため、新しい会話が続きの指示を受け取れないと、席が止まる（R-E）。

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
