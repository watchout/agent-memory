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
| S0 | 前提の確認（書き込みなし） | Kusabi の席 | 済み（全項目が合った）。第 2 回の再確認も済み（「第 2 回の実行」） |
| S1 | 中身の決まった版を作る | Kusabi の席 | 済み |
| S2 | 取り込みの古い常駐を止める | Kusabi の席 | 済み。第 2 回の読み戻しの取り直しも済み |
| S3 | 席の取り込みの hook を入れる | Owner が arc の script を 1 回打つ | 第 1 回は済み（arc の記録 #49 6791486407。席が取り直した読み戻しは「C2 の節」）。**第 2 回は S3・S4 の 1 回の差し替え（下の行）** |
| S4 | 切り直しの hook を有効にする | 同じ script が続ける | 第 1 回は済み（同上）。**第 2 回は S3・S4 の 1 回の差し替え（下の行）** |
| S3・S4（第 2 回の差し替え） | Kusabi の hook 5 つを新しい版 `28596bf0…` に替える（`--node-path /opt/homebrew/bin/node`、`--rotation on --rotation-threshold-tokens 240000`、1 回の操作） | Owner が arc の script（SHA-256 `541b4fef…d6a7`）を 1 回打つ | **未実施。O12（arc-sec の読み直し）は済み（#57 6811122140、止める点 0）。待ち: Owner が script を打つこと（席は手すき）** |
| C2 の取り直し | 差し替えの後の最初の人手の起動 | arc が席を起こし直し、次の会話が取る | 未実施（この会話は、起こし直しで終わる） |
| （C2） | S3・S4 の後の最初の人手の起動 | arc が席を起こし直して確かめる | 実施した。**期待は満たされなかった**: Kusabi の SessionStart が `MALFORMED_HOOK_INPUT` で続きを渡せない（「C2 の節」） |
| S5 | 見張りの設定への登録と probe | Kusabi の席（次の会話） | 未実施。第 2 回の C2 の取り直しが合ってから（SessionStart が続きを渡せない間は切り直しの試しが成り立たない） |
| S6 | 見張りを tmux の別の session の窓で起こす | 同上 | 未実施（同上） |
| S7 | FR9.2 の確かめ（実際に切る） | 同上 | 未実施。`initialUserMessage` の確かめ（O5）はここで行う |

この段は、S7 の読み戻しが済むまで開いたままにする。第 1 回は、S3・S4 の後に arc が席を起こし直し、その会話が C2 を取って、期待が満たされなかった（「C2 の節」）。直しは Code Generation の Step 16 で行い、PR #342 で統合された。その後の新しい版（S1 のやり直し）までは済み、第 2 回の S3・S4（差し替え）と C2 の取り直しが残っている（「第 2 回の実行」）。

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

## S1 のやり直し: 統合された main の `94f1ca6d` から新しい版を作る（2026-11-12）

arc の指示（PR #342 の統合の後、席間の連絡。arc の技術の判断で、Owner の言葉ではない）。上の S1（`aa77b683` から作った `1b731f00…`）の記録は、その時点の実物の記録なので書き換えない。

- 作る場所: `<一時の clone>`（席の一時 directory。作業場と release の置き場の外）。`git clone` して `94f1ca6d0042bd970d4cc7c4ab9ce9153b7d5c0d`（PR #342 の merge commit。統合の後の main の CI run 43113722371 は build-and-test 18・20・22 すべて success）に detach。`git status --porcelain=v1 --untracked-files=all` は作る前も後も 0 行。
- `node scripts/build-kusabi-content-addressed-runtime-release.mjs --mode publish --expected-head 94f1ca6d0042bd970d4cc7c4ab9ce9153b7d5c0d`: 終了 0、`FINAL_CAS_PUBLISHED_AND_VERIFIED`、`ATOMIC_RENAME_NEW_CAS`、protected_effects = 版の公開 1・rollout 0・restart 0。source tree `8efc817a3c4799b12c948d897ae437514981e154`。
- **版の SHA-256（`descriptor_sha256`、`release.json` の SHA-256、release の directory 名）= `28596bf0915d16b72bd7b5878aadda6ebe7efd7564b6520d0f938eb668e7cd92`**。席が `shasum -a 256 <release>/release.json` で取り直して一致。
- `--mode readback --release-sha 28596bf0…cd92`: 終了 0、`PASS_EXACT_READBACK`。`runtime_tree_sha256` = `47f863db99aff4b5f29419e9f1a33b20e97a365abaade5619381a2ccbefa754f`（publish の出力と同じ）、`dist_tree_sha256` = `5bd7f9af4470da4598a1e0cbc27e5ab166db2041c5e11c32f9ff1fdc9ea19daf`（`release.json` の値と publish の出力が同じ）、`conformance_sha256` = `cdd605d0980611c81c8c262e9698d4bcf87d8034c994e38f7d11ccbe7615707a`。
- 必須の入口の一覧（Q5 は PR #342 で入った）: `release.json` の `required_entrypoint_sha256_map` は 12 件で、`dist/session-rotation-stop.js` と `dist/rotation-watcher.js` が入っている。席が全 12 件の file の SHA-256 を取り直して、すべて一致（不一致 0）、どれも通常の file（symlink でない）。
- `<release>/dist/` の SHA-256: `session-rotation-stop.js` = `27a476eff83dbcdc217dd2215c6254451bb0f5662b7b77e7b331cf183ed333ca`、`rotation-watcher.js` = `d79947366454d4ea96fd6d2aa3418f29d052c12e6120b249d0e607973e82e273`（前の版と同じ）、`claude-hook-installer.js` = `422041d19e565e77f1d4e4fbd084e05801a5b573816e3e747c2bf051713dd8f8`、`codex-hook-installer.js` = `57e0452906a15c6a60a241d1fb75e41203ca2aaddc124c956a498cc87f541c4f`。`claude-hook-installer.js` は必須の入口の一覧には入っていない（installer の file）ので、別に取った。
- 作る場所での `npm audit --omit=dev`: 0 件。node は v26.12.1、npm は 11.20.0（`release.json` の記録）。
- 古い版は触っていない（新しい物を足しただけ）。席の設定・hook・見張りの変更は 0。この版を hook の command に入れる S3・S4 は、arc が版の入れ替えに対応させた script を Owner が 1 回打つ。席は `--apply` を流さない。

## 第 2 回の実行（2026-11-12）

第 2 回は、第 1 回の記録（上の S0〜S4・C2・段を戻した記録・S1 のやり直し）を書き換えず、そこから先を足す。手順は `operation/deployment-pipeline/cd-config.md` の第 2 版（承認済み。arc の答え、Owner の委任 #49 6762288830 の下で、Owner の言葉ではない）。

### S0 の再確認（読み取りだけ。席は何も書いていない）

| 確認 | 結果 |
|---|---|
| Owner の決定 | 取り直して数えた本文の SHA-256 が `6626a95d…a5d8` と一致（投稿者 watchout） |
| 版の元 | `git fetch origin main` の後、`origin/main` の head = `94f1ca6d0042bd970d4cc7c4ab9ce9153b7d5c0d`（PR #342 の merge commit）。`git merge-base --is-ancestor` が成り立つ |
| 版 | `<release>/release.json` の SHA-256 = `28596bf0915d16b72bd7b5878aadda6ebe7efd7564b6520d0f938eb668e7cd92`（S1 のやり直しの値と一致） |
| 席の設定の今の状態 | settings.json の SHA-256 = `2917ed97146e3221771074f2399541625c5b864c3bde43c1cfb9314aefd61145`（C2 を取った時と同じ。第 1 回の S4 の後から変わっていない）。Kusabi の hook は 5 つ（SessionStart 1・Stop 2・UserPromptSubmit 2）で、すべて旧い版 `1b731f00…` と、版つきの node（Homebrew の Cellar の folder）を指す。無関係な hook は SessionStart 1・Stop 1・UserPromptSubmit 1 の 3・3 |
| 席の起動の script | SHA-256 `496f71ff046d0f0db5afab0064b9a18da1eb3c853a0f19a66d4ae6df203d4126`（登録する値と一致） |
| 席の画面 | tmux の窓 `aidlc-kusabi` の pane の起動 command が `bash <席の起動の script>; exec zsh -l` の形 |
| node | `/opt/homebrew/bin/node` は `../Cellar/node/26.12.1_1/bin/node` への symlink。実行でき、`v26.12.1` |
| 差し替えの script（arc） | `install2.sh` の SHA-256 = `541b4fef2db5dcc51d8ef4c440e7a0f816facb9de94c1007df45ac011d8dd6a7`（席が本文を読んだ時と同じ。arc の値と一致）、`record2.md` の SHA-256 = `52919ab49a0a492b650a1bf07f3d0f62531662396ea108851022919511e70ad3` |
| DB | 触っていない |

### S2 の読み戻しの取り直し（読み取りだけ）

- `launchctl print gui/<uid>/com.watchout.wasurezu.raw-capture`: `Could not find service`。`launchctl print-disabled`: `"com.watchout.wasurezu.raw-capture" => disabled`。
- plist の SHA-256 = `f66fea0e4de71bf66673189f95eb27f37e29bc657e94361ac57de9ed679302fc`（止めた時と同じ。消していない）。誤りの記録の file は 110,355,058 byte（止めた時と同じ。増えていない）。
- 常駐の process は無い（`ps` の command の文字列で絞った一致は、この確かめ自身の shell の command だけだった）。

### 実行前の確かめ（step 2 の 4 項目）の第 2 回

- 実行前の確かめは合っているか: 合っている（上の表。全項目が期待と一致）。
- DB の移行は要るか: 要らない（この取り組みは DB を変えない）。
- 依存する物は健全か: 版の元（main）、版、席の起動の script、tmux の窓、node、arc の script、古い常駐を確かめた。AWS は使わないので `aws sts get-caller-identity` は流さない。
- 実行の区切り（時間の指定は使わない。終わりの基準で書く）: S3・S4 は、arc-sec が第 2 版の手順を読み終え、席が手すきで、Owner が arc の script を打った後。C2 の取り直しは、arc が席を起こし直した後。S5 以後は、C2 の取り直しが合った後。

### 実行に入れない理由と、待っていること

S3・S4 は、まだ実行していない。条件のうち、満たされていないのは次の 1 つ（`cd-config.md` の O12）: Owner の決定の条件「実行の前に arc-sec が具体の手順を確かめる」。第 2 版は手順の形が変わった（新規の追加 → 差し替え、`--node-path`、1 回の操作、C2 の取り直しの項目）ので、arc-sec が読み直す。arc が依頼済みで、arc-sec の席は止まっていて Owner の `/clear` 待ち（arc の連絡）。読み終わるまで、Owner に打つ段を渡さない。席は設定を書かず、`--apply` を流さない。

### O12 の結果と、S1 のやり直しの読み戻し（2026-11-12、arc の連絡の後）

- **O12 は済み**: arc-sec が arc の差し替えの script（`install2.sh`）と、script が #49 に投稿する記録を読み、止める点 0（iyasaka-arc#57 の comment 6811122140、本文 SHA-256 `e84e8b7bc0e672fcea15d03a49d0fe60f0adb79f1b6398b8058251083568787f`。席が GitHub の API が返す本文で数え、arc の値と一致）。arc の連絡で、Owner はこれから打つ。
- arc の注記 3: S1 のやり直しの読み戻し（expected-head `94f1ca6d`・`PASS_EXACT_READBACK`・installer の SHA-256）が #339 にまだ無い。Owner が打つ前に #339 に 1 つ出す（投稿が止められたら、S3 の読み戻しと一緒でよい。arc の指示）。
- 席は、release の `release.json`・`dist/claude-hook-installer.js`・`dist/session-rotation-stop.js`・`dist/rotation-watcher.js` の SHA-256 を取り直し、S1 のやり直しの記録（上）の値と一致を確かめた（版 `28596bf0…cd92`、必須の入口 12 件、切り直しの 2 つが入っている）。本文を `issue-339-readback-s1-redo.md`（先頭に `<!-- kusabi-rotation-deploy-readback:s1-redo -->`）に書いた。時間の言葉・絶対 path・email の grep は 0 件。
- **投稿の状態: 未投稿**。#339 への投稿は、前に席の権限の判定が拒否した（下の「#339 への読み戻しの投稿」）。同じ種類の外部への書き込みを、回避せず繰り返さない。arc の指示の代わりの手順（S3 の読み戻しと一緒に出す）に従う。ユーザーが `!` を付けて端末で投稿してもよい: `gh issue comment 339 -R watchout/agent-memory --body-file <この file>`。投稿したら、GitHub の API が返す本文の SHA-256 をこの節に足す。
- 席は手すき（何も始めていない）。arc に「手すき」と 1 行返す。

### 今の効果の一覧（第 2 回の分）

| 効果 | 数 |
|---|---|
| 席の設定の変更 | 0 |
| 見張りの設定・起動 | 0 |
| DB への書き込み | 0 |
| 版の公開 | 0（新しい版は作っていない） |
| 古い常駐 | 変更 0（止めたまま） |

## 起きた効果の一覧

| 効果 | 数 |
|---|---|
| 中身の決まった版の公開（`<release>` を 1 つ追加） | 2（S1 の最初の回 `1b731f00…` と、S1 のやり直し `28596bf0…`） |
| launchd の job の停止と無効化 | 1 |
| 席の設定（`.claude/settings.json`・`settings.local.json`）の変更 | 0（S3・S4 は Owner の script。この会話は読み取りと `--check` だけ） |
| 見張りの設定・起動 | 0 |
| DB への書き込み | 0 |
| 作業場のコードの変更 | 0 |
| 別の `claude` の起動（key の名前の probe。作業場の外の一時 dir） | 3（モデルを呼んだのは 1 回、約 0.0033 USD） |
| DB の読み取り（第 3 回。SELECT のみ。書き込み・構造の変更は 0） | 5 回の接続（うち 1 回は私の再現の側の誤りで接続に失敗）。件数・列名だけを出した（下の「第 3 回の実行」） |

## #339 への読み戻しの投稿（未投稿）

席の権限の判定（外部への書き込み）が `gh issue comment` を拒否した。回避せず、arc に代わりの投稿も頼んでいない（arc は「急ぎではない。次に投稿できる時にまとめて」と返した）。本文は同じ directory の `issue-339-readback-c2.md`（先頭に `<!-- kusabi-rotation-deploy-readback:c2 -->`）。投稿できる時に: 投稿 → GitHub の API が返す本文で SHA-256 を数えて記録 → この節を更新する。直しの後の C2 の取り直しの結果は、別の comment として足す。

## 次の会話への引き継ぎ（第 1 回の時点。第 2 回の引き継ぎは末尾）

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

## 次の会話への引き継ぎ（第 2 回）

1. 上の「第 2 回の実行」のとおり、S0・S2 の再確認は済み。S3・S4 の差し替えは未実施。arc-sec の読み直し（O12）は済み（止める点 0）。残る条件は、席が手すきであることと Owner の操作。
2. Owner が `<arc の script>` を 1 回打つ。script は #49 に権限の記録 `OD-KUSABI-SELF-SEAT-HOOK-VERSION-SWAP-BY-OWNER-RUN-20261112-001` を投稿してから書く。席はその URL と本文の SHA-256 を、読み戻しに添える。
3. 差し替えの後に席が取り直す読み戻し（script が表明しない物を含む）: 差分の全文、新しい版を指す Kusabi の hook が 5、前の版を指す hook が 0、5 つの先頭が `/opt/homebrew/bin/node`、無関係な hook が 3・3、`--check --rotation on --rotation-threshold-tokens 240000` が exact、settings.json と backup が `.gitignore` で無視されている。
4. arc が席を起こし直して C2 を取り直す。次の会話は、`cd-config.md` の「C2 の取り直し」の表を取る: `hook.input_valid: true`、`outcome` が `degraded` でない、`auto_receive.status`、`store_binding`、`forbidden_effects` がすべて 0、診断の記録（名前だけ）、Stop 側の記録、`claude --version` の 1 行（FR10.5）、`initialUserMessage` は印の無い起こし直しでは出ないので S7 で確かめる（O5。arc の答え）。期待と違えば、出力をそのまま Owner に見せて止まる。
5. C2 の取り直しが合ったら S5〜S7（`cd-config.md`）。S7 の読み戻しが済むまでこの段は開いたままにする。
6. #339 への読み戻しの投稿（上の節。S1 のやり直しの分は `issue-339-readback-s1-redo.md`）は、投稿できる時に。S3 の読み戻しと一緒に出してもよい（arc の指示）。第 1 回の C2 の読み戻し（`issue-339-readback-c2.md`）は、実物の記録として書き換えない。第 2 回の C2 の取り直しの結果は、別の file に書いて別の comment とする。

## 第 3 回の実行（2026-11-12、arc が差し替えの後に席を起こし直した最初の会話）

arc の連絡（私信。Owner の答えではない）: Owner が arc の `install2.sh` を打ち、Kusabi の hook 5 つを新しい版 `28596bf0…` に入れ替えた。arc の記録は iyasaka-arc#49 の comment 6811763971（本文 SHA-256 `35419f99…2e84`。席が GitHub の API が返す本文で数え直し、一致）。席は arc が起こし直した（session `50ff43a8…`）。この会話は読み取りと切り分けだけを行った。席の設定・DB・コードは変えていない。

### 実行した順

1. AI-DLC の engine で段を取り直した（`deployment-execution`、run-stage）。
2. C2 の取り直し: 会話の記録の hook の結果から SessionStart の証拠を読んだ。`claude --version` は `2.1.321 (Claude Code)`。
3. `RECOVERY_UNAVAILABLE` の原因を、(a) コード（`claude-session-start.ts`・`codex-session-start.ts`・`restart-pack.ts`・`session-rotation-start.ts`・`stores/`）、(b) 配備済みの版の hook を使い捨ての SQLite・一時の HOME で動かす、(c) 同じ版の関数を実 HOME の `user_config` の結びつきで段ごとに読み取りだけで流す、(d) 情報スキーマの読み取りと件数の集計、の順で特定した。
4. S3 の読み戻し（#49 の記録の SHA-256、settings.json、hook の数、先頭の語、`--check`）を取り直した。
5. 読み戻しの本文を `issue-339-readback-c2-retake.md`（先頭に `<!-- kusabi-rotation-deploy-readback:c2-retake -->`）に書いた。時間の言葉・絶対 path・email・URL の grep は 0 件。

### C2 の取り直しの結果（要点。全文は `issue-339-readback-c2-retake.md`）

| 項目 | 結果 |
|---|---|
| 入力 | **合格**。`hook.input_valid: true`、`session_id`・`source`・`cwd_sha256` あり。前回の `MALFORMED_HOOK_INPUT` は消えた |
| Kusabi の SessionStart の結果 | **不合格**。`outcome: degraded`／`degraded_reason: RECOVERY_UNAVAILABLE`、`delivery.emission_status: not_emitted` |
| `store_binding`（証拠） | `unknown`（失敗の時は書かない作り）。取り直して読んだ値は `user_config`／`postgres`／`verified: true` |
| `auto_receive.status` | 証拠に無い（復旧の読み出しが先に落ちた） |
| `forbidden_effects` | すべて 0 |
| 診断の記録 | 合格。3 つの file（0600、folder 0700）、`session_title`・`scratchpad_dir`（SessionStart）、`prompt_id`・`scratchpad_dir`・`session_title`（UserPromptSubmit）。落とした名前 0・不正な名前 0 |
| Stop の入力 | 未取得（この会話の最初の応答が終わるまで出ない） |
| `claude --version`（FR10.5） | `2.1.321 (Claude Code)`。契約を確かめた版 `2.1.220` より新しい（ずれあり）。`health-check-report.md` に 1 行書いた |

新しい key `scratchpad_dir` は、前回の `-p` の probe に出ず、対話の起動の入力にだけ入っていた。parser は無視して受理した（前回「確かめていないこと」に残した点が当たった）。

### 原因

本番の PostgreSQL の `knowledge` 表に `memory_scope` の列が無い。復旧の読み出し `loadRestartPackData` が `42703: column "memory_scope" does not exist` で落ち、`catch` が `RECOVERY_UNAVAILABLE` に丸める（例外の中身は証拠に残らない）。列を足す migration は commit `80f2273`（2026-10-05）で入ったが、hook は `skipPostgresMigrations: true` で動くため列を足さない。配備した版の migration 76 文のうち、本番に無いのは `knowledge.memory_scope`（列）と `task_state_migration_archive`（表）の 2 つだけ。後者の migration の DELETE が触る行は 0 件。空の SQLite では同じ版の hook が `outcome: full` になる（`RECOVERY_UNAVAILABLE` は「引き継ぐ物が無い普通の形」ではない）。

### 実行前の確かめの訂正

第 1 回・第 2 回の実行前の確かめ「DB の移行は要るか: 要らない（この取り組みは DB を変えない）」は足りなかった。取り組みが DB を変えなくても、配備する版は本番に無い構造を読む。確かめるべきだったのは「版が要求する DB の構造と、本番の DB の構造が合うか」。第 1 回の C2 は parse で落ちて DB に届かなかったので、今回まで表に出なかった。学びの記録（段の終わりの学び）に残す候補: 配備の前に、版の migration の一覧と本番の情報スキーマを読み取りで突き合わせる。

### 止まっている理由

C2 が「引き継ぎが渡せる」と言える所まで来ていない。直すには本番の DB の構造の変更（`knowledge.memory_scope` の追加）が要り、これは保護面（Owner の決定）で、`escalation-policy.md` のとおり席は決めない。S5・S6 は起こしていない。さらに、`prepareRotationRecovery` は引き継ぎの bundle を読み出しの前に消費済みにするため、この状態で切り直しを起こすと引き継ぎが渡されないまま消費される（`issue-339-readback-c2-retake.md` の「設計上の気になる点」。S7 の前に直す）。

### 今の効果の一覧（第 3 回の分）

| 効果 | 数 |
|---|---|
| 席の設定の変更 | 0（settings.json の SHA-256 は `1e464644…07c4` のまま） |
| 見張りの設定・起動 | 0 |
| DB への書き込み・構造の変更 | 0 |
| DB の読み取り | SELECT のみ。件数・列名だけ。結果: `knowledge` の列 15（`memory_scope` なし）、migration の不足 2、`task_states` 17,354 行・DELETE が触る行 0、`conversation_events`（kusabi）16,583 行・この会話の開始以降の増加 0 |
| 版の公開 | 0 |
| 作業場のコードの変更 | 0 |

## 次の会話への引き継ぎ（第 3 回）

1. 【判断待ち】本番の DB に `knowledge.memory_scope` を足すか（選択肢 1: 列だけ、2: migration を全部、3: DB は変えず hook を直す。席の見立ては 1 か 2）。arc を通して Owner の判断を受ける。受けるまで DB の構造・S5・S6 に触れない。
2. 判断の後（列が入った後）: 席が情報スキーマを読み取りで確かめる（列が在る）→ arc が席を起こし直す → C2 を取り直す（`outcome` が `full`、または `RECOVERY_UNAVAILABLE` でない。`store_binding` が `unknown` でない。`auto_receive.status` が証拠にある）。`initialUserMessage` は S7 で確かめる（O5）。
3. Stop の入力と取り込み: この会話の最初の応答が終わった後、`wasurezu-claude-transcript-stop.json`・`wasurezu-claude-rotation-stop.json` の Stop の名前と、`conversation_events` の増加（読み取りの件数）を取り直す。
4. #339 への読み戻しの投稿: `issue-339-readback-s1-redo.md`・`issue-339-readback-c2-retake.md`（第 1 回の `issue-339-readback-c2.md` は実物の記録として書き換えない）。前に席の権限の判定が `gh issue comment` を拒否したので、回避せず、ユーザーが `!` を付けて端末で投稿する。投稿したら、GitHub の API が返す本文の SHA-256 をここに足す。
5. S5・S6・S7 は、2 の C2 が合うまで起こさない。その前に、引き継ぎの bundle の消費の順番（読み出しが成功した後に消費する）を設計の記録から直す（次の取り組みか、単位の PR）。

## 第 4 回の実行（2026-11-12、Owner の判断「B」を受けて。本番の DB への適用は席の柵が止めた）

### 権限

Owner の判断: 「kusabiはBで」（原文）。記録 = arc、`OD-KUSABI-PROD-DB-APPLY-PENDING-MIGRATION-MEMORY-SCOPE-20261112-001`、`control_source_ref{url: https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6812189369, sha256: 87e4e8b836b3388309e67253d09e7effdd5cfe3d1b136cb22699b4b672474efb}`。席が GitHub の API が返す本文で SHA-256 を数え直し、一致した（投稿者 watchout、2026-11-12T02:02:24Z）。決定の範囲: 版 `28596bf0…` の未適用の migration を当てる（足すだけ）。含まない: ほかの席・ほかの DB、データの書き換え、見張りの起動。戻し方: 足した列と空の表の削除。

### 当てる前の読み取り（席が実行。READ ONLY のトランザクション。名前と件数だけ）

「正規の道」`dist/migrate.js`（SHA-256 `dfc4f1a6…c7e9`）は migration 76 文を順に流す。列・表・索引・拡張の追加だけでなく、行を書き換える文が 6 つある（24・25・27・61・62・63。`task_states` の更新と削除、`raw_events` の `source_event_id`・`metadata` の更新）。Owner の決定は「足すだけ」「データの書き換えは含まない」なので、全 76 文を本番と突き合わせた。前回の突き合わせは列と表だけだったので、これで索引・制約・拡張・行を埋めた。

| 項目 | 結果 |
|---|---|
| 本番に無い列 | `knowledge.memory_scope` の 1 つだけ（31 文の列の追加のうち） |
| 本番に無い表 | `task_state_migration_archive` の 1 つだけ（11 文の表の作成のうち） |
| 本番に無い索引 | 0（22 文の索引の作成のすべてが在る） |
| 拡張 `vector` | 導入済み（`CREATE EXTENSION IF NOT EXISTS` は何もしない。新しい依存は入らない） |
| `raw_events` の列と制約（53・58・60・64・65） | すでに最終の形（`content_hash` は NULL 可、`occurred_at` は NOT NULL・default `now()`、制約 `raw_events_occurred_at_not_null` は在って検証済み）。何もしない |
| 行を書き換える文の対象 | 24 = 0、25 = 0、27（重複の DELETE と退避）= 0、62 = 0、61 = 0、63 = 0 |
| 行数（適用の前後で変わらないことを読み戻しで見る） | `raw_events` 914,265／`task_states` 17,354／`knowledge` 4,819／`decisions` 758 |

読み取りの結論: 正規の `migrate.js` を流しても、実効は「`knowledge.memory_scope TEXT`（NULL 可）の追加」と「空の表 `task_state_migration_archive` の作成」だけで、Owner の決定の範囲に収まる。ほかの 74 文は、何も変えない（すでに在る）か、対象 0 行の文。

### 当てる

席が起動用の script（結びつきを解決して `DATABASE_URL` に写し、版の `migrate.js` を変えずに読み込むだけ）で適用しようとしたところ、席の柵（auto mode の判定）が「Production Deploy」として拒否した。**回避せず、再試行もしていない**。本番の DB への書き込みは 0。`escalation-policy.md` と arc の指示のとおり、Owner が端末で打つ形にした。

Owner が打つ command（arc に私信で渡した。絶対 path は公開の記録に書かない）: 作業場の外の一時の directory にある `owner-apply-memory-scope.mjs`（最終の版の SHA-256 は `ee918392fa32d637aceaf668e8b245b48dd0667b983294f9e02a943370497f6e`。版は 3 つあった: 最初の `20240258…`、2 番目の `6b42622e…`、最終の `ee918392…`。経緯は下の「適用の失敗と直し」。最初の版は、呼び出し側の shell の環境を信じる作りで、arc の shell では結びつきが `environment`／`sqlite` になって止まったので直した）を `--apply` つきで流す。結びつきは、席の hook と同じ `~/.agent-memory/config.json` の `database_url` から読む（席の環境には `AGENT_MEMORY_*`・`DATABASE_URL` の変数が無く、`.mcp.json` も無い）。呼び出し側の `AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`DATABASE_URL`・`AGENT_MEMORY_DB_PATH` は捨て（名前だけ出す）、`user_config`／`postgres` でなければ何も触らず止まる。意図的に `AGENT_MEMORY_DB_TYPE=sqlite` と偽の `DATABASE_URL` を入れた環境でも、`--apply` なしの形で結びつきが通ることを席が確かめた。出力に出るのは file の path・mode・key の名前・path の SHA-256 だけで、URL の値は出ない。この script は、(1) 前の確かめが決定と完全に一致する時だけ（上の表: 不足が列 1・表 1 だけ、索引の不足 0、`vector` 導入済み、書き換えの対象 0）版の `migrate.js` を流し、1 つでも違えば何も当てずに終わる、(2) 当てた後に情報スキーマで読み戻し（`memory_scope` が `text`・NULL 可、表が在って 0 行、不足 0、行数が前と同じ）、(3) 復旧の読み出し `loadRestartPackData` が通ることを確かめる。`--apply` を付けない形は読み取りだけで、席が流して「前の確かめが決定と一致」まで確かめた。URL は出力に出ない（伏せる）。

### 適用の失敗と直し

1. **最初の版（`20240258…`）**: Owner が打つのは arc の会話の shell で、そこに `AGENT_MEMORY_DB_TYPE=sqlite` が入っていたと見られる（コードでは `source: environment`／`sqlite` になる道はそれ 1 つ。arc の shell の環境は席には見えないので推定）。結びつきの解決が `environment`／`sqlite` になって `ok: false` で止まった。何も当たっていない。席の値は、環境ではなく `~/.agent-memory/config.json` の `database_url` から来ている（席の環境に `AGENT_MEMORY_*`・`DATABASE_URL` は無く、`.mcp.json` も無い）。
2. **2 番目の版（`6b42622e…`）**: 呼び出し側の環境を捨て、席の hook と同じ file だけから結びつきを読む形に直した（`user_config`／`postgres` でなければ止まる）。席で `--apply` なしに、わざと `AGENT_MEMORY_DB_TYPE=sqlite` と偽の `DATABASE_URL` を入れた環境で確かめ、通った。**ところが、版の `migrate.js` を流す子 process の環境を `PATH`・`HOME`・`DATABASE_URL` だけに絞ったことが席の誤りだった**: DB の URL が利用者名を持たない形で、`pg` の既定が `USER` に頼るため、Owner が `--apply` で打つと接続の段で `no PostgreSQL user name specified in startup packet` になり、exit 1 で止まった。何も当たっていない（接続の前の失敗）。同じ誤りは、この会話の前半に `env -i` で `USER` を消して再現した時にも出ていた。子の環境を絞る時に、それを活かせていなかった。
3. **最終の版（`ee918392…`）**: arc が、子の環境に `USER` と `LOGNAME` を足した（1 行だけ）。席の手元の版も同じ行にし、arc の写し（`arc/tools/kusabi-db/apply.mjs`）と**バイトで同一**であること（SHA-256 が `ee918392…` で一致、`cmp` で同一）を確かめた。直しの診断は書き込みなしで確かめた: 子と同じ形の環境で `SELECT 1` だけを READ ONLY で流すと、`USER`・`LOGNAME` ありは「接続できた」、無しは `no PostgreSQL user name specified in startup packet`（失敗の再現）。席は `migrate.js` 自体を流していない。

### 適用の結果（Owner が最終の版を `--apply` で打った）

打ったのは Owner（`!`）。席の DB への書き込みは 0。下の「Owner の実行の出力」は arc が伝えた写し（席が見た出力ではない）で、その下に席が書き込みなしで取り直した読み戻しを並べる。

| 項目 | Owner の実行の出力（arc 経由の写し） | 席の読み戻し（READ ONLY、名前と件数だけ） |
|---|---|---|
| `migrate.js` | exit 0、`✅` が 77 行（76 文＋終わりの 1 行） | — |
| 不足（列・表・索引） | 0 | 0（76 文の全部を本番と突き合わせ直した） |
| `knowledge.memory_scope` | `text`・NULL 可・既定なし | `text`・NULL 可・既定なし。NULL でない行 0 |
| `task_state_migration_archive` | 0 行 | 0 行。列 `id`・`record`・`archived_at`・`reason` |
| 行数（`raw_events`／`task_states`／`knowledge`／`decisions`） | 914,265／17,354／4,819／758（前と同じ） | 914,265／17,354／4,819／758（前と同じ） |
| 復旧の読み出し `loadRestartPackData` | ok（active 2・decisions 5・knowledge 5・conversation 8） | ok（active 2・decisions 5・knowledge 5・conversation 8） |
| script の判定 | `readback_matches_decision` が ok | — |
| 結びつき | — | `user_config`／`postgres` |

結論: Owner の決定（`OD-KUSABI-PROD-DB-APPLY-PENDING-MIGRATION-MEMORY-SCOPE-20261112-001`）の範囲どおり、足したのは列 1 つと空の表 1 つだけで、行は 1 つも動いていない。戻し方は、足した列と空の表の削除（決定のとおり）。`rollback-runbook.md` への追記は、この後の記録の PR に含める。

### 状態

本番の DB の構造の不足は 0。席の hook の復旧の読み出しは、同じ版の関数で通るところまで読み取りで確かめた。**C2 はまだ取り直していない**（席の SessionStart の `outcome`・`store_binding`・`auto_receive.status` は、arc が席を起こし直した後に読む）。待ち: arc が席を起こし直すこと。

### 効果の一覧（第 4 回の分）

| 効果 | 数 |
|---|---|
| 本番の DB の構造の変更 | 2（`knowledge.memory_scope` の列、空の表 `task_state_migration_archive`。Owner の実行。決定の範囲） |
| 本番の DB の行の書き換え | 0（行数は前と同じ、書き換える文の対象も 0 行だった） |
| 席の DB への書き込み | 0（席の読み取りは SELECT のみ、READ ONLY のトランザクション） |
| 席の設定の変更 | 0 |
| 見張りの設定・起動 | 0 |
| 作業場のコードの変更 | 0 |

### 学びの記録の候補（段の終わりに §13 の手順で。直接は書かない）

- 配備の前に、版の migration と本番の情報スキーマを読み取りで突き合わせる。列・表だけでなく、索引・拡張・制約・行を書き換える文の対象まで。「この取り組みは DB を変えない」だけでは、版が要求する構造との食い違いを見落とす。
- 子 process の環境を絞る時は、`USER`・`LOGNAME` を残す（URL に利用者名が無いと、`pg` の既定が `USER` に頼る）。絞った環境での接続は、本番に書く前に `SELECT 1` で確かめる。
- Owner や別の席が打つ script は、呼び出し側の shell の環境を信じず、席の hook と同じ file から結びつきを読み、`user_config`／`postgres` でなければ止まる形にする。

### 次の会話への引き継ぎ（第 4 回。第 3 回の 1・2 を置き換える）

1. arc が席を起こし直した後、C2 を取り直す: `outcome` が `full`（または `RECOVERY_UNAVAILABLE` でない）、`store_binding` が `unknown` でない、`auto_receive.status` が証拠にある。Stop 系の証拠（`wasurezu-claude-transcript-stop.json`・`wasurezu-claude-rotation-stop.json` の Stop の key の名前、取り込みが `malformed_input` でない、`conversation_events` の増減）も、最初の応答が終わった後に取り直す。
2. S5・S6・S7 は、C2 が合い、引き継ぎの bundle の消費の順番の直し（引き継ぎを使ったと記録してから読む順の見直し。設計の記録を先に出す別の PR）が済むまで起こさない。
3. #339 への読み戻しの投稿（`issue-339-readback-s1-redo.md`・`issue-339-readback-c2-retake.md`）。さらに、第 4 回の適用の結果を足した読み戻しが要る（`issue-339-readback-apply-memory-scope.md` を書く）。投稿は、席の権限の判定が拒否した経緯があるため、席からは出さず、出せなければ記録の PR に載せる。
4. `rollback-runbook.md` に、足した列と空の表の削除の手順を足す（記録の PR）。

## 第 4 回の C2 の取り直し（2026-11-12、本番の DB の migration の後、arc が席を起こし直した最初の会話）

arc の連絡（席間の私信。Owner の答えではない）で、arc が席を起こし直した（session `7ff6519c…`、SessionStart は 11:22:42 JST）。読んだのは、この会話に hook が渡した SessionStart の結果と、hook が書いた診断の記録の 3 file、設定の file、`claude --version` だけ。会話の記録の jsonl は読まず、DB には繋いでいない。全文は `issue-339-readback-c2-retake-4.md`（先頭に `<!-- kusabi-rotation-deploy-readback:c2-retake-4 -->`。時間の言葉・URL・email・`/Users/` の grep は 0 件）。

### 結果（要点）

| 項目 | 結果 |
|---|---|
| `RECOVERY_UNAVAILABLE`／`MALFORMED_HOOK_INPUT` | **消えた**（推論）。続きの案内（`wasurezu-recovery-pack/v1`、`Confidence: medium`、`Missing context: task_checkpoint_stale`）が SessionStart で届いた。degraded の出力は `additionalContext` を持たないので、届いたなら成功の道を通っている |
| `hook.input_valid` | true と読める（推論）。診断の記録の SessionStart が 11:22:42 に更新され、案内の pack ref の時刻と一致する。値そのものは見ていない |
| `outcome` が `full` か | **`full` と記録する**。arc が読んだ tmux の画面の履歴で、11:22 の起動より後に `SessionStart:startup says:` の行が 0 件（前の起動の degraded の行と同じ描き方）。コードでは、`EVIDENCE_LOG_UNAVAILABLE` を作る箇所は 1 つだけで、その時は必ず `systemMessage` が出る。hook の証拠の値そのものは見ていない（arc の読み先の判断。Owner の言葉ではない） |
| `store_binding` の値 | **別の道の観測**。arc が同じ版の `resolveCodexStoreBinding` で `user_config`／`postgres`／`verified: true` を取った（DB の migration の script の出力）。hook の証拠の値ではない。席は見ていない |
| `auto_receive.status` | **値は観測できず。arc の判断で、届いた事実の観測に置き換えた**。証拠の JSON は stderr だけに出る作りで、席に見える file が無い。品質ログの 1 行（`recovery_quality_log`）を READ ONLY の SELECT で読む案（arc の指示）は、席の柵（auto mode の判定「Production Reads」）が拒否した。回避せず、再試行もしていない。置き換えの観測: 案内の pack ref の時刻 11:22:42.288 JST と、診断の記録の SessionStart の更新時刻 11:22:42.333 JST の一致（差 45 ミリ秒）。外れは `cd-config.md` の C2 の表の直下 |
| `forbidden_effects` | **実測ではない**。0 を返す定数で、読めても「宣言された値は証拠でない」（S5）。S5 で扱う |
| 診断の記録 | 合格（直接）。3 file、0600・folder 0700、`dropped_names: 0`・`invalid_names: 0`。SessionStart の新しい名前 `prompt_id`（1 件）。Stop の 5 件（`background_tasks`・`effort`・`prompt_id`・`scratchpad_dir`・`session_crons`）は受理されている（件数 6。5 件はこの会話より前の会話、6 件目は 11:28:59 JST のこの会話の最初の応答の後。2 つの adapter とも、落とした名前 0・不正な名前 0） |
| hook の node・設定 | 合格（直接）。Kusabi の hook 5 つがすべて新しい版 `28596bf0…` と `/opt/homebrew/bin/node`（v26.12.1、実行できる）を指す。settings.json の SHA-256 は `1e464644…07c4` のまま |
| `claude --version`（FR10.5） | `2.1.321 (Claude Code)`。契約を確かめた版 `2.1.220` よりずれあり（第 3 回と同じ版）。`health-check-report.md` に 1 行書いた |

### 判定（第 4 回の C2）

**合格と記録する。** 条件を 1 つ置き換えた合格: C2 の主な目的（`RECOVERY_UNAVAILABLE` が消え、続きが渡る）は達した。`outcome` は arc の画面の観測とコードで `full` と記録し、`store_binding` は arc の別の道の観測を足した。`auto_receive.status` の値は観測できていない。品質ログの 1 行を READ ONLY で読む案（arc の指示）を席の柵（auto mode の判定「Production Reads」）が拒否したので、回避も再試行もせず、arc に代わりに流してもらうこともしなかった。arc の判断（Owner の委任 iyasaka-arc#49 6762288830 の技術の範囲。Owner の言葉ではない）で、`auto_receive.status` を合格の条件から外し、「続きの案内が会話の文脈に実際に届いた」事実の観測（pack ref の時刻と診断の記録の時刻の一致）で置き換えた。外れは `cd-config.md` の C2 の表の直下に書いた（採った判断・採らなかった代替を 1 行ずつ）。観測できないものを成功と読まない（S5）ので、記録は「値を観測した」と書かない。`forbidden_effects` は定数なので実測として扱わない。品質ログの読みは、S5 の見張りの probe を据える時に、その段の手順で改めて扱う。S5・S6・S7 は起こしていない。

### 効果の一覧（第 4 回の C2 の分）

| 効果 | 数 |
|---|---|
| 席の設定の変更 | 0 |
| DB への接続・書き込み・構造の変更 | 0 |
| 見張りの設定・起動 | 0 |
| 作業場のコードの変更 | 0 |
| 別の `claude` の起動 | 0 |

### 次の会話への引き継ぎ（第 4 回の C2 の後。第 4 回の引き継ぎの 1 を置き換える）

1. C2（第 4 回）は合格と記録済み（上の「判定」）。arc の読み先の判断（Owner の言葉ではない）: 会話の記録の jsonl を script で読む案は取らない（11-11 に Shirube の席が柵で止まった前例）。`outcome` は arc の画面の観測で `full`、`store_binding` は arc の別の道の観測。`auto_receive.status` は合格の条件から外し、届いた事実の観測で置き換えた（外れは `cd-config.md`）。拒否された SELECT は誰も流さない。
2. 取り込みの件数の増減は、DB を読む許可が要る。品質ログの読みと一緒に、S5 の見張りの probe を据える時に、その段の手順で改めて扱う（arc の判断）。この会話の Stop の診断は取れた（11:28:59 JST に Stop が 6 件目、2 つの adapter とも受理）。
3. S5・S6・S7 は、引き継ぎの bundle の消費の順番の直し（arc の指示: 「引き継ぎを使ったと記録してから読む」順の直し。設計の記録を先に出す別の PR）が済むまで起こさない。arc の順番は、消費の順番の直し（設計の記録を先に出す別の PR）、その後に S5・S6。
4. #339 への読み戻しの投稿: `issue-339-readback-s1-redo.md`・`issue-339-readback-c2-retake.md`・`issue-339-readback-c2-retake-4.md`、第 4 回の適用の結果（`issue-339-readback-apply-memory-scope.md` は未作成）。席の権限の判定が拒否した経緯があるので、席からは出さない。
5. `rollback-runbook.md` に、足した列と空の表の削除の手順を足す（記録の PR）。

### 戻した事実（2026-11-12）
Deployment Execution から Code Generation へ戻した（`aidlc engine jump execute --target code-generation --direction backward --scope express`。reset した段: code-generation・build-and-test・deployment-pipeline・deployment-execution）。理由: 配備の途中で、引き継ぎを「使った」と記録してから届ける順の設計の誤りが見つかった（`handoff-commit-order-design-draft.md`）。arc の判断（Owner の委任 iyasaka-arc#49 6762288830 の技術の範囲。Owner の言葉ではない）で、要求 → 設計 → code → 配備の追跡を 1 つに保つため、同じ取り組みの construction で直す。この段の記録は、上の第 4 回までを書き換えていない。
