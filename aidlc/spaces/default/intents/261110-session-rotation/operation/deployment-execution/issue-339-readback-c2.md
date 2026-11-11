<!-- kusabi-rotation-deploy-readback:c2 -->
## 配備の読み戻し — S3・S4 と C2（席を起こし直した後の最初の会話）

取り組み 261110-session-rotation の Deployment Execution。決定の出どころ: Owner の決定 `OD-KUSABI-ROTATION-DEPLOY-SELF-SEAT-TRIAL-20261111-001`（iyasaka-arc#49 の comment 6790645694）。S3・S4 は Owner が arc の script を打った（arc の記録: #49 の comment 6791486407、本文 SHA-256 `b2daee56532e93503dadddb7c9a64c3de44e79912d4eb83774e5101681796732`。席が GitHub から取り直して数え、一致した）。

この会話は読み取りと、key の名前の確かめだけを行った。席の設定・DB・作業場のコードは変えていない。arc の指示により S5・S6（見張り）は起こしていない。

### 結論

| 項目 | 結果 |
|---|---|
| S3・S4 の読み戻し | 合格（`--check` は exact。ただし backup が git に無視されていない。下の表） |
| C2: AI-DLC の SessionStart の hook | 合格。整合性の誤りなし |
| C2: Kusabi の SessionStart の hook | **不合格**。`MALFORMED_HOOK_INPUT` で続きを渡せない |
| Kusabi の Stop・UserPromptSubmit（取り込み・切り直し）の hook | 同じ parser が 2.1.321 の入力の新しい key を拒否する（probe の key の組で再現）。席の実際の入力は未取得 |
| 切り直し（閾値 240000） | この状態では始まらない |

### S3・S4（席が取り直した物。差分だけは arc の script の log を読んだ）

| 項目 | 結果 |
|---|---|
| settings.json の SHA-256 | `2917ed97146e3221771074f2399541625c5b864c3bde43c1cfb9314aefd61145`（arc の記録の「S4 後」と一致） |
| `--check --rotation on --rotation-threshold-tokens 240000` | `config_match: exact`、`would_change: false`、`wrote_settings_file: false`、無関係な hook 3・3 |
| 結びつきの値の `workspace_sha256` | 作業場の実体の path の SHA-256 と一致 |
| hook の node | 実在し、実際に動いた |
| `diff -u` | S3 は取り込みの hook の追加だけ、S4 は切り直しの hook の追加だけ（arc の script の log を読んだ。席は取り直していない） |
| PR に載らないか（S3 の 5） | settings.json は `.gitignore` で無視されている。**backup 3 つ（今回の 2 つと 11-09 の 1 つ）は無視されていない**。S4 の前の backup には結びつきの値と版の path が入る。席は PR に記録を入れる時に path を指定するので今は載らないが、`git add -A` では載る。直すのは `.gitignore` に `.claude/settings.json.bak*` を足す 1 行（Step 16 の PR） |

### C2: AI-DLC の SessionStart の hook

`SessionStart:startup`、終了 0、所要 664 ms、stderr は空。案内（`AIDLC WORKFLOW ACTIVE`、段 `deployment-execution`）が `additionalContext` として会話に入った。その後の `orchestrate next`・`continue` も整合性の誤りなく進んだ。

### C2: Kusabi の SessionStart の hook

席の会話の記録に残った hook の結果（stdout・stderr）を読んだ。

| 見る物 | 結果 |
|---|---|
| 画面の文 | `Wasurezu startup recovery degraded (MALFORMED_HOOK_INPUT); Claude Code continued with ordinary startup.` |
| `outcome` / `degraded_reason` | `degraded` / `MALFORMED_HOOK_INPUT` |
| `hook.input_valid` | `false`（`session_id`・`source`・`cwd_sha256` はすべて null） |
| `store_binding` | `source: unknown`、`backend_intent: unknown`、`verified: false` |
| `auto_receive.status` | **証拠に無い**（parse が先に落ち、その項目まで進まない） |
| `delivery` | `status: degraded`、`emission_status: not_emitted` |
| `forbidden_effects` | すべて 0 |
| `adapter.host_contract_version` | `2.1.220`（今の Claude Code は `2.1.321`） |

C2 の期待（`auto_receive.status`・`store_binding` が読める）は満たされなかった。DB には何も書いていない。

### 原因（再現した）

`claude-session-start` の parse は、必須 5 つ（`cwd`・`hook_event_name`・`session_id`・`source`・`transcript_path`）と任意 3 つ（`agent_type`・`model`・`permission_mode`）以外の key があると `MALFORMED_HOOK_INPUT` にする。Claude Code 2.1.321 は、会話に名前があると SessionStart の入力に `session_title` を足す。席の会話は起動の時から名前（`aidlc-kusabi`）が付いている。

key の名前の確かめ（作業場の外の一時 dir で `claude -p` を 3 回。設定は `--settings` の 1 つだけで、席の設定・ユーザーの設定は読まない。hook は key の名前・値の型・文字列の長さ・許可リストとの突き合わせの真偽だけを書き、値は残していない。モデルを呼んだのは Stop の key を取る 1 回だけ、haiku で 1 往復、約 0.0033 USD）:

| 事象 | 許可リストに無い key |
|---|---|
| SessionStart（名前なし） | なし（受理される） |
| SessionStart（名前あり） | `session_title` |
| UserPromptSubmit | `prompt_id`・`session_title` |
| Stop | `background_tasks`・`effort`・`prompt_id`・`session_crons` |

デプロイ済みの版（`1b731f00…`）の parser に、この key の組（値はダミー。環境変数を空にして、DB に触れない純粋な関数だけ）を当てた結果: SessionStart に `session_title` あり → `MALFORMED_HOOK_INPUT`（画面の誤りと同じ）、なし → 受理。UserPromptSubmit・Stop も、新しい key ありで `malformed_input`、なしで受理。

### 取り込みと切り直しの Stop・UserPromptSubmit の hook

コードを読んだ。取り込み（`transcript-stop-capture`）と切り直し（`session-rotation-stop`）は同じ `parseTranscriptStopInput` を通り、許可リストに無い key で拒否する（SessionStart と同じ厳しさ）。拒否の時は「通す（PASS）+ `malformed_input` の証拠」で、席は止まらない。probe の key の組が席の対話の起動でも同じなら、これらの hook は起動して通すだけで、取り込みも切り直しの判定も行われない。

### 登録された作業場の Claude の席（事実）

`transcript-stop-capture.js` を持つ版は、`.kusabi-releases` の 10 のうち 2 つ（`1b731f00` と `dd806dbe`）で、どちらも新しい key を知らない。Claude Code 2.1.321 の席でこの取り込みの hook を使えば、同じ理由で落ちる可能性がある。実際にその席で落ちているかは取り直していない。直すのは案 B の範囲。

### 確かめていないこと

- 席の対話の SessionStart・Stop・UserPromptSubmit の入力そのもの（parse が落ちた時の証拠は全項目 null、会話の記録は入力を残さない）。probe は `-p` の起動。対話の起動だけに入る別の key が無いとは言い切れない。
- S3・S4 の `diff -u` の取り直し（arc の script の log を読んだだけ）。

### 次

- 直しは次の PR（Q5・`--node-path` と同じ PR）。設計の記録だけの PR が先で、設計監査を 1 回受けてから試験、実装の順。arc の判断（この issue の comment 6791901034）: 知らない key を無視し、必須の key・型・64 KiB の上限は残す。無視した key の名前は、証拠の契約ではなく、契約ではない診断の記録に残す。
- 直しの後: 新しい版を作る（S1）→ S3・S4 をやり直す → 席を起こし直して C2 を取り直す → S5 以後。
- 記録: 作業場の `aidlc/spaces/default/intents/261110-session-rotation/operation/deployment-execution/` の `deployment-log.md`・`smoke-test-results.md`・`health-check-report.md`（未コミット）。
