# 配備の実行の記録 — 会話の切り直し（261110-session-rotation）

この記録は、`operation/deployment-pipeline/` の `cd-config.md`（具体の手順）と `deployment-strategy.md`（方針と順序）、`construction/build-and-test/` の `test-results.md`（試験の結果、build-test-results）に沿って、Kusabi 自身の席だけに会話の切り直しを据えた実行の記録。環境の一覧（environment-inventory）は、express の取り組みで環境の用意の段を省いたため無い。据える先は、この Mac の Kusabi の席 1 つ（tmux `aidlc-kusabi`）で、新しい環境は作らない。

表記の決まりは設計の記録と同じ: 絶対 path は書かない（`<作業場>`・`<release>`・`<席の起動の script>`・`<rotation root>`・`<一時の clone>`）。

## 決定の出どころと確かめ

- Owner の決定 `OD-KUSABI-ROTATION-DEPLOY-SELF-SEAT-TRIAL-20261111-001`: https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6790645694 （本文 SHA-256 `6626a95dcafbaac9c6155d2801a466f5fb55090f5200c74ef88083afec5aa5d8`、Owner の原文は「いい」）。Q1〜Q4 = A。
- 手順の確かめ（arc-sec）: iyasaka-arc#57 6791098364（止める指摘 0）。手順と変更: agent-memory#339 の comment 6790768518・6790842393・6790913312・6790957409・6791290367。
- 段の承認: Deployment Pipeline は承認済み（arc の答え。Owner の委任 #49 6762288830 の下で、Owner の言葉ではない）。
- 読み戻しの投稿: agent-memory#339 の comment 6791386957（本文 SHA-256 `6c5db16b94584715d72959b58b8b7bd7e42b494335703bf4a94fef52deb7ab2e`）。

## 実行の状態

| 段 | 内容 | 実行者 | 状態 |
|---|---|---|---|
| S0 | 前提の確認（書き込みなし） | Kusabi の席 | 済み（全項目が合った） |
| S1 | 中身の決まった版を作る | Kusabi の席 | 済み |
| S2 | 取り込みの古い常駐を止める | Kusabi の席 | 済み |
| S3 | 席の取り込みの hook を入れる | Owner が arc の script を 1 回打つ | 済み（arc の記録 #49 6791486407。席が取り直した読み戻しは「C2 の節」） |
| S4 | 切り直しの hook を有効にする | 同じ script が続ける | 済み（同上） |
| （C2） | S3・S4 の後の最初の人手の起動 | arc が席を起こし直して確かめる | 実施した。**期待は満たされなかった**: Kusabi の SessionStart が `MALFORMED_HOOK_INPUT` で続きを渡せない（「C2 の節」） |
| S5 | 見張りの設定への登録と probe | Kusabi の席（次の会話） | **起こさない**（arc の指示。SessionStart が続きを渡せない間は切り直しの試しが成り立たない） |
| S6 | 見張りを tmux の別の session の窓で起こす | 同上 | **起こさない**（同上） |
| S7 | FR9.2 の確かめ（実際に切る） | 同上 | 未実施 |

この段は、S7 の読み戻しが済むまで開いたままにする。S3・S4 の後に arc が席を起こし直し、この会話（起こし直し後の最初の会話）が C2 を取った。直しは Code Generation の Step 16（設計の記録だけの PR → 設計監査 → 試験 → 実装）で行い、直した後に新しい版・S3/S4 のやり直し・C2 の取り直しが要る（「C2 の節」の最後）。

## S0 前提の確認（書き込みなし）

| 確認 | 結果 |
|---|---|
| Owner の決定 | 取り直して数えた本文の SHA-256 が `6626a95d…a5d8` と一致（投稿者 watchout） |
| 版の元 | `origin/main` の head = `aa77b683e135beabb9fc54bd3736b47d288d6f46`（取り直し直後。PR #341 の統合の commit） |
| 席の起動の script | SHA-256 `496f71ff046d0f0db5afab0064b9a18da1eb3c853a0f19a66d4ae6df203d4126` が登録する値と一致 |
| 席の画面 | tmux の窓 `aidlc-kusabi` の pane の起動 command が `bash <席の起動の script>; exec zsh -l` の形 |
| 古い常駐 | `com.watchout.wasurezu.raw-capture`: 読み込み済み、状態 `spawn scheduled`、前回の終了 1、起動の回数 248110、誤りの記録 110,355,058 byte で増加中（`store.recordRawEvent is not a function`）。plist の SHA-256 `f66fea0e4de71bf66673189f95eb27f37e29bc657e94361ac57de9ed679302fc` |
| DB | 触っていない |
| node | Homebrew の node 26.12.1_1（`v26.12.1`）のみ |

## S1 中身の決まった版を作る

- 作る場所: `<一時の clone>`（席の一時 directory。作業場と release の置き場の外。arc の指示）。作業場は別の branch で記録が未コミットのため、版を作る道具（清潔な作業場と head の一致を要求する）はここで流せない。`git clone` して `aa77b683…` に detach。`git status --porcelain=v1 --untracked-files=all` は作る前も後も 0 行。
- `node scripts/build-kusabi-content-addressed-runtime-release.mjs --mode publish --expected-head aa77b683e135beabb9fc54bd3736b47d288d6f46`: `FINAL_CAS_PUBLISHED_AND_VERIFIED`、`ATOMIC_RENAME_NEW_CAS`、protected_effects = 版の公開 1・rollout 0・restart 0。source tree `34914d35e6f066b89f36a665b2f41f5ccc4672b3`。
- **版の SHA-256（`descriptor_sha256`、`release.json` の SHA-256、release の directory 名）= `1b731f0091a93dd875f1903e1866f21b38eaf518fc39ac406819fec229fad784`**。
- `--mode readback --release-sha 1b731f00…ad784`: `PASS_EXACT_READBACK`。`runtime_tree_sha256` = `5718869c45e16e7c07f8453bfe193f4639721e81d25639cbb21d3241c2c82fe2`、`dist_tree_sha256` = `33c5476b094e24e32c504705d22a0d8c99db0c337a3e60beafa05537e252de65`。
- 別の確かめ（道具の必須の入口の一覧に切り直しの 2 つが無いため）: `<release>/dist/` の `session-rotation-stop.js` = `8cb018f3579e902054426d450c3db8fb1e610e1f4f5f313690627bfffcf0cccd`、`rotation-watcher.js` = `d79947366454d4ea96fd6d2aa3418f29d052c12e6120b249d0e607973e82e273`、`claude-hook-installer.js` = `f5825903fcf105c2aed01de34b6a14a8e5f0a29cddd664d80b9a0a08f507d829`。どれも通常の file（symlink でない）。
- `npm audit --omit=dev`: 0 件。古い版 6 つは触っていない。

## S2 取り込みの古い常駐を止める（Q4 = A）

- 止める前の証拠: `launchctl print` の出力（席の手元に保存）、plist の SHA-256（上の S0）、誤りの記録の大きさ（上の S0）。
- `launchctl bootout gui/<uid>/com.watchout.wasurezu.raw-capture` の終了 0。`launchctl disable gui/<uid>/com.watchout.wasurezu.raw-capture` の終了 0。
- 読み戻し: `launchctl print` は `Could not find service`、`launchctl print-disabled` は `"com.watchout.wasurezu.raw-capture" => disabled`、該当の process なし、誤りの記録は止めた直前と読み戻しの時とその後の確認で同じ 110,355,058 byte。
- 消していない物: plist（SHA-256 不変）、設定の file、古い build。
- 戻し（必要な時だけ。Owner の決定が要る）: `launchctl enable gui/<uid>/com.watchout.wasurezu.raw-capture` と `launchctl bootstrap gui/<uid> <plist>`。戻すと同じ誤りで落ち続ける。

## S3・S4 の読み戻し（席が取り直した分）と C2（席を起こし直した後の最初の起動）

arc が S3・S4 の script を Owner の操作で流し、席を起こし直した（arc の記録: #49 6791486407、本文 SHA-256 `b2daee56…6732`）。起こし直し後の最初の会話が、席自身で取り直した物と、記録から読んだ物を分けて書く。path は `<作業場>`・`<release>` と書く。

### S3・S4

| 項目 | 結果 | 取り方 |
|---|---|---|
| settings.json の SHA-256 | `2917ed97146e3221771074f2399541625c5b864c3bde43c1cfb9314aefd61145`。arc の記録の「S4 後」と一致 | 席が取り直した |
| `--check --rotation on --rotation-threshold-tokens 240000` | `config_match: exact`、`would_change: false`、`wrote_settings_file: false`、無関係な hook 3・3 | 席が取り直した（読み取りのみ。書き込みは apply の時だけだとコードで確かめた） |
| 結びつきの値の `workspace_sha256` | 作業場の実体の path の SHA-256 と一致 | 席が取り直した |
| hook の node | 実在し、実際に動いた（SessionStart の hook がその node で JSON を返した） | 席が取り直した |
| 差分（`diff -u`） | S3 は取り込みの hook の追加だけ、S4 は切り直しの hook の追加だけ | **arc の script の log を読んだだけ。席は差分を取り直していない** |
| settings.json と backup が PR に載らないか（S3 の 5） | settings.json は無視されている（`.gitignore` の 12 行目）。**backup 3 つ（今回の 2 つと 11-09 の 1 つ）は無視されていない（`??`）** | 席が `git check-ignore` で取り直した |

backup が無視されていない件: S4 の前の backup（S3 の後の状態）には、結びつきの値と版の path が入る。席は単位の PR に記録を入れる時に path を指定して足すので、今は PR に載らない。ただ `git add -A` や `git add .claude` では載る。直すのは `.gitignore` に `.claude/settings.json.bak*` を足す 1 行（次の PR）。

### C2: AI-DLC の SessionStart の hook

| 見る物 | 結果 |
|---|---|
| hook の結果 | `SessionStart:startup`、終了 0、所要 664 ms、stderr は空 |
| 届いた物 | 案内（`AIDLC WORKFLOW ACTIVE`、段 `deployment-execution`、Status `Running`）が `additionalContext` として会話に入った |
| その後の engine の呼び出し | `orchestrate next` と `continue` の 4 回が、整合性の誤りなく進んだ（規則の読み込み 3 部 → run-stage の指示） |

整合性の誤りは出ていない。期待（AI-DLC の hook が誤りを出さない）は満たされた。

### C2: Kusabi の SessionStart の hook

席の会話の記録に残った hook の結果（stdout と stderr）を読んだ。

| 見る物 | 結果 |
|---|---|
| 画面の文 | `Wasurezu startup recovery degraded (MALFORMED_HOOK_INPUT); Claude Code continued with ordinary startup.` |
| `outcome` / `degraded_reason` | `degraded` / `MALFORMED_HOOK_INPUT` |
| `hook.input_valid` | `false`。`session_id`・`source`・`cwd_sha256` はすべて null（入力を 1 つも読めていない） |
| `store_binding` | `source: unknown`、`backend_intent: unknown`、`verified: false`（DB の結びつきまで進んでいない） |
| `auto_receive.status` | **証拠に無い**。parse が先に落ち、その項目まで進まない |
| `delivery` | `status: degraded`、`emission_status: not_emitted`（会話に入れた物は 0） |
| `forbidden_effects` | すべて 0（再起動・kill・TUI 書き込み・tmux send-keys・clipboard・AUN queue・session への注入） |
| `adapter.host_contract_version` | `2.1.220`。今の Claude Code は `2.1.321` |

C2 の期待（Kusabi の SessionStart の証拠の `auto_receive.status`・`store_binding` が読める）は**満たされなかった**。DB には何も書いていない。

原因（再現した）: `claude-session-start` の parse は、必須 5 つ（`cwd`・`hook_event_name`・`session_id`・`source`・`transcript_path`）と任意 3 つ（`agent_type`・`model`・`permission_mode`）以外の key があると `MALFORMED_HOOK_INPUT` にする。Claude Code 2.1.321 は、会話に名前があると SessionStart の入力に `session_title` を足す。席の会話は起動の時から名前（`aidlc-kusabi`）が付いている（会話の記録の 1 行目。SessionStart の hook の結果は 8 行目）。

### key の名前の probe（値は残していない）

作業場の外の一時 dir で、`claude -p` を 3 回（設定は `--setting-sources project` と `--settings` の 1 つだけ。席の設定・ユーザーの設定は読まない）。hook は key の名前・値の型・文字列の長さ・許可リストとの突き合わせの真偽だけを書く。1 回目と 2 回目は UserPromptSubmit の hook で入力を止めたので、モデルは呼んでいない。3 回目は Stop の key を取るため haiku で 1 往復（費用 約 0.0033 USD）。

| 事象 | 観測した key | 許可リストに無い key |
|---|---|---|
| SessionStart（名前なし） | 必須 5 つだけ | なし（受理される） |
| SessionStart（名前あり） | 必須 5 つ + `session_title` | `session_title` |
| UserPromptSubmit | `cwd`・`hook_event_name`・`permission_mode`・`prompt`・`prompt_id`・`session_id`・`session_title`・`transcript_path` | `prompt_id`・`session_title` |
| Stop | `background_tasks`（空の配列）・`cwd`・`effort`（object）・`hook_event_name`・`last_assistant_message`・`permission_mode`・`prompt_id`・`session_crons`（空の配列）・`session_id`・`stop_hook_active`・`transcript_path` | `background_tasks`・`effort`・`prompt_id`・`session_crons` |

デプロイ済みの版（`<release>/dist/`）の parser に、この key の組（値はダミー）を当てて再現した（環境変数を空にして、DB には触れない純粋な関数だけ）:
- SessionStart に `session_title` あり → `MALFORMED_HOOK_INPUT`（画面で見た誤りと同じ）。なし → 受理。
- UserPromptSubmit に `prompt_id`・`session_title` あり → `malformed_input`。なし → 受理。
- Stop に新しい 4 つあり → `malformed_input`。なし → 受理。

### 取り込みと切り直しの Stop・UserPromptSubmit の hook

コードを読んだ。取り込み（`transcript-stop-capture`）と切り直し（`session-rotation-stop`）は同じ `parseTranscriptStopInput` を通り、許可リストに無い key で同じく拒否する（SessionStart と同じ厳しさ）。拒否の時の挙動は、どちらも「通す（PASS）+ `malformed_input` の証拠」で、席は止まらない。probe で観測した key の組が席の対話の起動でも同じなら、**この席の Stop・UserPromptSubmit の hook は起動して通すだけで、取り込みも切り直しの判定も行われない**。その場合、閾値 240000 に届いても切り直しは始まらない。席の実際の Stop の入力は取れていないので、これは「同じなら」の話（下の「確かめていないこと」）。

### 確かめていないこと

- 席の対話の SessionStart・Stop の入力そのものは取れていない（parse が落ちた時の証拠は全項目 null、会話の記録は入力を残さない）。probe は `-p` の起動。`session_title` が原因という説明は、名前の有無の再現と、席の名前が起動の時から付いている事実から導いた。**対話の起動だけに入る別の key が無いとは言い切れない**。そのため、直しは名指しで足す形より、知らない key を無視する形の方が、この不確かさに強い。
- 登録された作業場の Claude の席: 版の parser が同じなので、Claude Code 2.1.321 の席で同じ取り込みの hook を使えば、同じ理由で落ちる。`transcript-stop-capture.js` を持つ版は 10 のうち 2 つ（今回の版 `1b731f00` と `dd806dbe`）で、どちらも新しい key を知らない。登録された作業場の hook は、別に、存在しない node の版を指している（前の記録）。実際にその席で落ちているかは取り直していない。

### 直しに要る手順（arc の判断で決まった。2026-11-11 09:30 に更新）

parser の直し（Code Generation の Step 16。Q5・`--node-path` と同じ PR。arc の判断は agent-memory#339 の comment 6791901034）→ 新しい版を作る（S1）→ S3・S4 をやり直す（hook の command の版の path が変わるため、Owner が arc の script を打つ）→ 席を起こし直して C2 を取り直す → S5 以後。

## 段を戻した記録（2026-11-11T09:16:06Z）

parser の直し（#339 の arc の技術の判断 comment 6791901034、本文 SHA-256 `69ca10d6e8e418ad425e1e9a8f81b73799d49fa8496ad93288dc2882fae59c32`）のため、arc の指示で `aidlc engine jump execute --target code-generation --direction backward --scope express` を 1 回流した。`jump reopen` は単位ごとの command で、単位の無いこの取り組みでは `--units` を満たせず断られた（state は動いていない）。engine の返答: `stages_reset` = `code-generation`・`build-and-test`・`deployment-pipeline`・`deployment-execution`、`stages_skipped` は空、`completed_count` 5、`workflow_stopped` false。Current Stage は `code-generation`、Next Stage は `build-and-test`、Phase は Construction が Active・Operation が Pending。

S0〜S4 は前の回に実際に行った（S3・S4 は Owner の script、iyasaka-arc#49 の comment 6791486407）。この節より上の S0〜S4 と C2 の記録は、その時点の実物の記録で、state が戻っても書き換えない。直しの版の後に S1・S3・S4 をやり直し、S0・S2 の結果は再利用の問いで扱う。戻した段の承認は、やり直しの時に arc が出す。

## 起きた効果の一覧

| 効果 | 数 |
|---|---|
| 中身の決まった版の公開（`<release>` を 1 つ追加） | 1 |
| launchd の job の停止と無効化 | 1 |
| 席の設定（`.claude/settings.json`・`settings.local.json`）の変更 | 0（S3・S4 は Owner の script。この会話は読み取りと `--check` だけ） |
| 見張りの設定・起動 | 0 |
| DB への書き込み | 0 |
| 作業場のコードの変更 | 0 |
| 別の `claude` の起動（key の名前の probe。作業場の外の一時 dir） | 3（モデルを呼んだのは 1 回、約 0.0033 USD） |

## #339 への読み戻しの投稿（未投稿）

席の権限の判定（外部への書き込み）が `gh issue comment` を拒否した。回避せず、arc に代わりの投稿も頼んでいない（arc は「急ぎではない。次に投稿できる時にまとめて」と返した）。本文は同じ directory の `issue-339-readback-c2.md`（先頭に `<!-- kusabi-rotation-deploy-readback:c2 -->`）。投稿できる時に: 投稿 → GitHub の API が返す本文で SHA-256 を数えて記録 → この節を更新する。直しの後の C2 の取り直しの結果は、別の comment として足す。

## 次の会話への引き継ぎ

1. S3・S4・C2 は済み（上の節）。C2 の期待は満たされていない。原因は、Claude Code 2.1.321 の hook の入力に、Kusabi の parser の許可リストに無い key が増えた事（SessionStart: `session_title`。UserPromptSubmit: `prompt_id`・`session_title`。Stop: `background_tasks`・`effort`・`prompt_id`・`session_crons`）。
2. S5・S6 は起こさない（直しの版が入るまで止める）。直し方は arc の判断（2026-11-11 09:11 ごろ、arc-73 の席間の連絡。技術の直し方として arc が決める範囲で、Owner の言葉ではない。GitHub への記録はまだ無い）: **A = 知らない key は無視する**。必須の key と型の確かめは残し、無視した key の名前だけを証拠に記録する（値は読まない・残さない）。SessionStart・UserPromptSubmit・Stop の 3 つの parser を同じ形にする。入力の検証を変えるので、PR の差分は arc-sec も読む。
   - 次の PR の中身（arc の指示。この PR は Step 16 で、設計の記録だけの PR が先）: (1) parser の直し（試験: 2.1.321 の key の組で受理、必須の key が欠ける・型が違う時は今までどおり拒否、無視した key の名前が診断の記録に出る。下の「解決」を参照）、(2) Q5（必須の入口の一覧に切り直しの 2 つ。版を作る道具と rollout の両方）、(3) installer の `--node-path`（既定は今の動き）、(4) `.gitignore` に `.claude/settings.json.bak*`、(5) #341 の統合の後に作った記録と、Deployment Pipeline・Execution の記録。1 単位 = 1 PR、試験だけの commit を最初に、監査の前の自己点検（指摘の項目と試験の対応表）。
   - 解決（arc の判断、agent-memory#339 の comment 6791901034）: 名前は証拠の契約に足さず、契約ではない診断の記録（`$AGENT_MEMORY_HOME` の下、名前・件数・時刻だけ）に書く。正式な証拠の項目にするのは後で .v2 として別に決める。設計は `construction/code-generation/hook-input-design.md`。
   - 席が決められない点だった物（arc に聞いた。上の「解決」で決まった）: 「無視した key の名前を証拠に記録する」には、`docs/design/schemas/claude-session-start-evidence-v1.schema.json`（top-level と `hook` が `additionalProperties: false`）に項目を足す必要がある。足すと v1 の契約の変更になり、古い schema で検証する側は新しい証拠を拒否する。契約の .v2 は保護面。取り込み・切り直しの Stop 系の証拠（`wasurezu-transcript-stop-capture/v1`）には schema の file が無く、コードの中だけで決まっている。
   - 設計の記録に「知らない key は拒否する」と定めた所は無い（`HOST_ADAPTERS.md`・SSOT-3/5/6 を確かめた。入力の許可リストはコードだけにある）。直しで設計と実装が食い違う所は無いが、入力の扱いを SSOT か HOST_ADAPTERS に 1 段落足す。
   - 守る物（セキュリティの入力検証・契約）に触れるので、team.md のとおり設計の記録だけの PR を先に出して設計監査を 1 回受け、code は PASS の後に書く。
3. 直しの後: 新しい版を作る（S1）→ S3・S4 をやり直す（Owner が arc の script を打つ）→ 席を起こし直して C2 を取り直す（SessionStart の証拠が `input_valid: true`・`auto_receive.status` と `store_binding` を出すこと）→ S5〜S7。
4. S5〜S7 は `cd-config.md` の S5〜S7 のとおり。値は arc-sec の C3〜C7（`expected_command` は `turn.json` の `host_pid` の comm で確かめてから、`drain_commands` は空、見張りの窓は `aidlc-kusabi` と別の tmux の session、閾値は 240000 で圧縮より先に切れたかを記録）。保護面に触れる段（S5・S6）は決定の参照（上の Owner の決定）を添える。
5. 次の PR で一緒に直す小さな点: `.gitignore` に `.claude/settings.json.bak*`（backup が PR に載らないように）。
