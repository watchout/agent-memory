# 作る段の計画 — 会話の切り直し（261110-session-rotation）

## Summary

- Builds: 会話の量を測り、閾値で 1 回だけ席に引き継ぎを書かせて DB に残し、「切ってよい」の印を出し、次の会話の頭に続きを入れる経路（Claude Code・Codex）。MCP の server を先に接続させ、起動のたびの表の変更をやめる。会話の取り込みの止まりを直す。見張りも含め、この単位の code は設計の記録と設計監査を先に通し、PASS の後に作る。ここまでは #341 で統合済み。2026-11-11 の新しい試行（Step 16）: Claude Code 2.1.321 が hook の入力に足した key で、Kusabi の 3 つの入口が全部拒否する故障を、知らない key を無視する 1 か所の parser に直す（無視した key の名前は契約ではない診断に書く）。あわせて必須の入口の一覧・installer の `--node-path`・`.gitignore` の 1 行。
- Touches: 前の試行は新しい module（`src/session-rotation-*.ts`・`src/rotation-watcher.ts`）ほか（統合済み）。新しい試行は `src/claude-session-start.ts`・`src/transcript-stop-capture.ts`・`src/session-rotation-stop.ts`（入口 3 つ）、新しい module 2 つ（共通の parser と診断）、`src/claude-hook-installer.ts`・`src/codex-hook-installer.ts`、`scripts/build-kusabi-content-addressed-runtime-release.mjs`・`src/kusabi-direct-fleet-rollout.ts`（必須の入口の一覧）、`.gitignore`、設計の記録と `docs/operations/HOST_ADAPTERS.md`、この取り組みの記録。
- Tests: 前の試行は成功の場面の試験 1 file と要件ごとの試験（FR1〜FR8、約 15。統合済み）。新しい試行は、2.1.321 の実物の key の形の正例と負例の試験を、設計監査の PASS の後に先に書いて失敗を確かめ、反転する既存の負例は deviation_ledger に 1 行ずつ書く。変えた行と新しい行の網羅率 100%。

## 前提と入力

- 要件: `aidlc/spaces/default/intents/261110-session-rotation/inception/requirements-analysis/requirements.md`（FR1〜FR9、NFR1〜NFR7）。この取り組みは express で、単位の分け・機能の設計・機能以外の設計の段は無い。今のコードの読み解きは `aidlc/spaces/default/codekb/agent-memory/` と `inception/reverse-engineering/developer-scan.md`。
- 1 単位 = 1 PR。branch は `origin/main`（`17676d841257cc4ef194e14923cb0458b99cf62f`）から切る。
- 見張り（FR5）が守る物に触れるので、この単位は、設計の記録だけの PR を先に出し、devauditor の設計監査を 1 回受け、PASS の後に code を書く（FR5.6、team.md）。code と試験の code は、見張りも見張り以外も、全部、PASS の後に書く。返却を待つ間に書くのは文書（計画と試験の手順）だけ。設計監査の依頼の後、返却が来るまで PR に push しない（team.md）。（arc の訂正、Owner の委任 #49 6762288830: 前の版の「ほかは設計監査を待たずに作る」は社内の決まり aidlc-only §2 と食い違っていたため取り下げた。）
- 守る物はこの PR に入れない: 席への hook と見張りの据え付け、常駐の差し替え、DB の作りの変更、workflow の変更。新しい外部の依存は足さない。
- 800 行を超える file（`src/index.ts` 1013・`src/codex-session-start.ts` 1056・`src/restart-pack.ts` 1255・`src/stores/pg-store.ts` 1533）は、新しい働きを新しい module に置き、大きな file には呼び出しの数行だけを足す。大きな file を分ける作業はこの PR ではせず、PR の deviation_ledger に「採った判断: 新しい働きは新しい module に置き、大きな file は呼び出しだけ足す」「採らなかった案: 触る大きな file を 800 行以下に分ける」を 1 行ずつ書く（team.md の Code Style、標準の適用の順序 2）。

## 実行の担当

- Step 1〜3・Step 13〜15 の GitHub への書き込み（push・PR・監査の依頼）は、作る段を回す席（この会話）が行う。サブエージェントは GitHub に書かない。
- Step 4〜12 と Step 14 の code と試験は、作る役（aidlc-developer-agent）が行う。ただし Step 4 以降の code と試験の code は、全部、設計監査の PASS と作者の受領の後に始める。それまでは書かない。

## 手順

### Step 1: branch と試験の道具の確かめ
- [x] `origin/main` から branch `kusabi/session-rotation-261110` を切る（手元の codekb の変更と、取り組みの記録はそのまま持ち越す）。
- [x] 今の試験が main で通ることを確かめ、使う命令を記録する: `npx tsc --noEmit`、`npm run build`、`npx tsx src/test-transcript-stop-capture.ts`、`npm run test:claude-hook`、`npm run test:codex-hook`、`npm run test:automatic-receive`、`HOME=$(mktemp -d) npx tsx src/test-boot-recovery.ts`、`HOME=$(mktemp -d) npx tsx src/test-post-tool-hook.ts`。結果は `unit-test-instructions.md` の基準の表に書く。

### Step 2: 見張りの設計の記録（FR5、FR5.5、FR5.6）
- [x] `aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/watcher-design.md` を書く。中身: 何を見るか（FR4 の印・席の手すき）、いつ・何を打つか（`/clear`・`/new` だけ。版 1 にあった Codex の続きの 1 行は、設計監査の F5 を受けて版 2 でやめた）、打つ先の決め方（席と画面の対応の明示の設定）、止める条件（手すきを確かめられない・印が古い・対応が無い・同じ印は 1 回）、失敗した時（打たない側に倒す、証拠に残す）、戻し方（見張りを止める・設定を外す。席には何も残らない）、安全（決まった文字列だけ、秘密を出さない、LLM を使わない）、AUN が持つ席の扱い、標準 S4・S5 の当て方。
- [x] `docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md` の §5・§6 を、見張りの形に合わせて直す（FR5.5）。Kusabi 本体は会話を作り直さないこと、見張りは別の LLM の無い script で、Owner の決定で据えた席だけで動くこと、3 条件（AUN 不在の確認・監督・事前の許可）との対応を書く。
- [x] 監査の項目の file `docs/audit/kusabi-session-rotation-261110.json`（`sds-audit-items/1`）を作る。設計の監査の項目（見張りの設計が要件 FR5 を満たすか、安全、止める条件、戻し方、SSOT-6 との食い違いが無いか、公開してよいか）を入れる。実装の監査の項目は Step 15 で足す。

### Step 3: 設計の記録だけの PR と設計監査の依頼
- [x] PR に入れる物: この取り組みの記録（`inception/`、`construction/code-generation/` の計画・試験の手順・見張りの設計の記録。`audit/` と `.aidlc-engine/` は入れない）、codekb の 9 file、SSOT-6 の直し、監査の項目の file。入れる前に、手元の path・秘密の値・非公開の repo の中身が無いかを探し、あれば伏せる。
- [x] PR を出し、CI（build-and-test 18・20・22）がその head で終わるのを待つ。（PR #341、head `f8a2930`、3 つとも success）
- [x] `sds-audit-request/1`（`audit_stage` は設計）を watchout の名義で投稿し、本文の SHA-256 で前検査を流し、READY_FOR_REVIEW を確かめる。返却が来るまで、この PR に push しない。（依頼 https://github.com/watchout/agent-memory/pull/341#issuecomment-6783981401 、本文の SHA-256 `b7a3a49e94f0b23cb72e132f77e9efcb14bffe47cfdfb72927fd529e240c55bf`、前検査 READY_FOR_REVIEW）

### Step 3b: 設計監査の 1 回目（BLOCK、F1〜F5）を受けた直し
- [x] 返却 https://github.com/watchout/agent-memory/pull/341#issuecomment-6784177636 を `--review` で流した結果は BLOCKED。作者の受領として、その結果をそのまま PR に書いた（https://github.com/watchout/agent-memory/pull/341#issuecomment-6784472221 ）。
- [x] F5 の直し方は arc の答え（Owner の委任 #49 6762288830）の案B: 画面に打つのを `/clear`・`/new` の command だけにし、Codex の続きの 1 行は打たない。§9 は変えない。F1〜F4 は作者の判断で直す。
- [x] 見張りの設計の記録（版 2）・SSOT-6 §5・§6・要件 FR4.1・FR5.1〜FR5.3・FR6.2・FR9.2・監査の項目の file・この計画と試験の手順を直し、PR に足した（head `0aa667a`）。
- [x] CI（build-and-test 18・20・22、run 42941354257）が成功で終わったのを確かめ、2 回目の `sds-audit-request/1` を同じ PR に出した（https://github.com/watchout/agent-memory/pull/341#issuecomment-6784598314 、本文の SHA-256 `d45e5ce830e5ad6a070a26ca860e053847e89c39fb34fb0463af29dc408fc5d2`）。前検査は READY_FOR_REVIEW。返却が来るまで push しない。

### Step 3c: 設計監査の 2 回目（BLOCK、F1・F2 が残り、F3〜F5 は解消）を受けた直し
- [x] 返却 https://github.com/watchout/agent-memory/pull/341#issuecomment-6784766255 （本文の SHA-256 `5d249b3955dc14ff57d64c8cb65449a0d3cbf93ef5ed6f6b1bb1921dc4bf3738`）。F1 = 読み戻しと BSpace では人の入力との競合を安全に戻せない、F2 = 結びを失った後にも BSpace を送る遷移がある。
- [x] 直し方は作者の判断: 戻しのキーを全部やめ、入力欄が空と証明でき人が触っていないと観測できる時だけ打ち、打った後に確かめられなくなったら追加のキーを送らずに止まる。Enter は tmux の中で条件を評価して 1 回だけ送る。arc の提案（席に打たず起動し直す形）は今は採らず、設計の記録の 11 に残した。
- [x] 見張りの設計の記録（版 3）・SSOT-6 §5・要件 FR5.2・FR9.2・監査の項目の file・この計画と試験の手順を直し、PR に足した（head `adf22e5`）。
- [x] 作者の受領（BLOCK のまま。返却を `--review` で流す前に push した手順の順序の誤りも書いた）: https://github.com/watchout/agent-memory/pull/341#issuecomment-6785112981
- [x] CI（build-and-test 18・20・22、run 42945241303）が成功で終わったのを確かめ、3 回目の `sds-audit-request/1` を同じ PR に出した（https://github.com/watchout/agent-memory/pull/341#issuecomment-6785116415 、本文の SHA-256 `6e2a16e0a667ed3fbbceadb8e138397daac24fd485c295d4067cb85f62d84a27`）。前検査は READY_FOR_REVIEW。返却を `--review` で流すまで push しない。

### Step 3d: 設計監査の 3 回目（BLOCK、F1・F2 が残り、F3〜F5 は解消）を受けた向きの変更
- [x] 返却 https://github.com/watchout/agent-memory/pull/341#issuecomment-6785277864 （本文の SHA-256 `77541cf6b025ba23f639f1cc938dca9644e186afe53b1bcb9301e850eb3cf389`）。`--review` の結果は BLOCKED（Open or unspecified blocking findings）。作者の受領として、その結果をそのまま PR に書いた（https://github.com/watchout/agent-memory/pull/341#issuecomment-6785405953 ）。
- [x] F1 = 条件つきの Enter は、観測の後に行が置き換わりカーソルが戻ると人の未送信の文を送る、F2 = 結びが `pane_pid` と command 名だけで同じ pane の同名 CLI への入れ替わりを拒めない。arc の答え（Owner の委任 #49 6762288830）: 画面にキーを打つ限り競合は閉じられない。キーを打たず、手すきで入力欄が空と観測できた時に、席の起動の script で pane を起動し直す形に変える。
- [x] 設計の記録（版 4）・SSOT-6 §5（§9 は変えない）・要件 FR5.1〜FR5.4・FR5.7（新）・FR6.1・FR6.2・FR9.2・NFR3・この計画を直した。使い捨ての tmux（3.6a）で、起動の command の再実行・条件が偽の時の `NOT_RESPAWNED`・同じ観測での 2 回目の拒否・`pane_start_command` が引用符つきで返ることを確かめた。
- [x] 監査の項目の file と試験の手順を版 4 に合わせ、PR に足した（head `7c827db`、CI の run 42949095366 で build-and-test 18・20・22 が success）。arc-73 に、向きの変更・tmux で確かめた事実・残る危険 R-A〜R-E を知らせ、公開された Owner の判断を求めた。
- [x] 公開された Owner の判断: OD-KUSABI-ROTATION-WATCHER-RESPAWN-NOT-KEYS-20261111-001（https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6785869798 、投稿者 watchout、本文の SHA-256 `f65ca4e11c9f71b3b31d34bdb17c3736f1add64705b9fc827ccb5dcff1f1dd3e`、API の本文から数え直して一致を確かめた）。原文「1はいい」。キーを送らず起動し直す向きと、残る危険 R-A〜R-E を受け入れて 4 回目の設計監査に出すこと、依頼を作者が出してよいことが決まった。席ごとの起動の script の登録・据え付け・席の hook の差し替えは含まない。
- [x] CI（build-and-test 18・20・22、run 42951313450、head `8bde7ff`）が成功で終わったのを確かめ、4 回目の `sds-audit-request/1` を同じ PR に出した（https://github.com/watchout/agent-memory/pull/341#issuecomment-6785911824 、本文の SHA-256 `a7a900e88d9f3724ed47205743e41a187aeb5641338f82a5a1ef778c6fa18b68`、item_set の SHA-256 `148d62c1f1f1771b9f72e18eae5d30ab0df7a6ed6f69efafe7fce7788bb596ff`）。前検査は READY_FOR_REVIEW。返却が来るまで push しない。
- [x] 返却を `--review` で流し（push の前に）、結果をそのまま作者の受領として PR に書く（4 回目の返却は PASS、`--request … --sha256 … --review …` は RECEIPT_ACCEPTED、作者の受領 https://github.com/watchout/agent-memory/pull/341#issuecomment-6786349956 ）。PASS で受領が RECEIPT_ACCEPTED になるまで、Step 4 以降の code と試験の code は書かない。BLOCK なら、指摘を受け入れ、直し方が Owner の判断を要するか（向きの変更・守る物）を見てから、続きを決める（4 回目以降の依頼は、Owner の判断を要する扱いのまま）。

### Step 4: 成功の場面の試験を先に書いて失敗を確かめる（Testing Contract の順番）
- [x] `src/test-session-rotation-scenario.ts` を書く。Claude Code と Codex の transcript の見本（閾値の上）と、試験用の Store（SQLite か JSON、`HOME` を一時の folder にする）で、次の流れを確かめる: 1 回目の Stop の hook が block と理由の文を返す → 席の引き継ぎの文を含む 2 回目の Stop の hook が、作業の状態と回復の束を DB に書き、印を出す → SessionStart（source = `clear`）が、頭に残した「次の 1 歩」と FR7.1 の決まった文を入れた additionalContext を返す（Claude Code は initialUserMessage も）→ 同じ束は 2 回使わない。
- [x] 実装の前に動かし、失敗することを確かめて、その出力を `code-summary.md` に残す（`npx tsx src/test-session-rotation-scenario.ts` は `ERR_MODULE_NOT_FOUND`（`src/session-rotation-stop.js` が無い）で落ちた。出力は `code-summary.md` を書く時に載せる）。

### Step 5: 量を測る（FR1）
- [x] 新しい module `src/session-rotation-usage.ts`: Claude Code の最後の応答の usage（input + cache_read + cache_creation）と、Codex の最後の `token_count` の `last_token_usage` の入力の量を、transcript の行から求める純粋な関数。時刻・環境・file を読まない（S4）。読めない時は「観測できず」と理由を返す（S5）。今の `src/codex-context-measurement.ts` の Codex の読み方と同じ知識を 2 か所に持たない（S3）。同じ関数を使うか、そちらへ寄せる。
- [x] adapter: transcript の末尾 4 MiB だけを読む（今の `TRANSCRIPT_CAPTURE_TAIL_BYTES` を使う）。

### Step 6: 閾値（FR2）
- [x] 既定の 300,000 を `src/constants.ts` の 1 か所に置く。
- [x] Stop の hook の command に、席ごとの値の引数（`--rotation-threshold-tokens`）を任意で足せるようにする。`src/claude-hook-installer.ts`・`src/codex-hook-installer.ts` の command の組み立てと読み戻し（同じ文字列に戻ること）も、引数の有る形と無い形の両方を受けるように直す。
- [x] 切り直しの判定が今の帯の判定に触れる時は、`src/restart-prepare.ts` と `src/context-window-resolution.ts` に literal で 2 か所ある帯の値を 1 か所に寄せる（FR2.3）。触れない時は直さず、その旨を `code-summary.md` に書く。

### Step 7: 切る前に残す（FR3）
- [x] 新しい module `src/session-rotation-stop.ts`: 量が閾値以上で、その会話でまだ残していない時に、block と理由の文（「済んだこと・次の 1 歩・まだ決まっていないこと」を書いて終える）を返す。1 つの会話で block は最大 1 回。
- [x] 次の Stop で、席の書いた文を transcript から取り出し、秘匿処理を通して、Store に直接書く（作業の状態と、1 回だけ使う回復の束とその metadata）。MCP は通さない。DB の作りは変えない。
- [x] 席の文が取れない時は、既にある記録だけで束を作り、落ちた理由を残す（FR3.3）。
- [x] `src/transcript-stop-capture.ts` から呼ぶ。今の取り込み（非同期）とは別に、切り直しの判定は同期で返す必要がある。hook の登録を同期の別の hook にするか、今の hook の中で順を決めるかを決め、決めた理由を `code-summary.md` に書く（席への据え付けは守る物なので、この PR では command の形と installer だけを用意する）。

### Step 8: 「切ってよい」の印（FR4）
- [x] 保存が Store に入った後にだけ印を出す。印は席・案件・会話と、その会話が動いている画面（`TMUX_PANE` の pane_id・`TMUX` のソケット・hook の親 process の番号）に結ぶ。UserPromptSubmit・Stop・SessionStart の hook が書く手番の file も同じ値を持つ。置き場と形は見張りの設計の記録の版 4（2.1・2.2）で決めた物にする（見張りが LLM を使わずに読める形）。印と手番には host の process の起動した時刻（`host_started_at`、`ps -o lstart=` の値）も書く。tmux の外の席は pane を null にして書く。
- [x] 今の印の状態を見る command を足す（作った物: 読むだけの `src/session-rotation-status.ts`。`wasurezu-restart` の下位ではなく単独の module。監査済みの見張りの設計には無かったので、PR の deviation_ledger に 1 行書く）。

### Step 9: 次の会話で続きから動く（FR6、FR7.1）
- [x] 新しい module `src/session-rotation-start.ts`: 準備した束を 1 回だけ取り出し、残した文を頭にした回復の文を作る。上限は 10,000 トークン（FR6.4、既定は `src/constants.ts` の 1 か所）。FR7.1 の決まった文（曖昧な点は推測で埋めず Kusabi の DB を当たる、当たる tool の名前）を入れる。
- [x] `src/claude-session-start.ts`（source = `clear`・`compact`、および見張りの起動し直しの続きの `startup`）は additionalContext と initialUserMessage を返す。`src/codex-session-start.ts` は additionalContext を返す。`startup` を切り直しの続きとして使うのは、その席の claim が `respawning` で、`TMUX_PANE` と tmux のソケットが合い、`respawn_started_at` から確認の待ち時間以内の時だけ（FR6.1）。使った時は手番の `started` に `source` と `rotation_marker_id` を書く。合わない `startup` と、束が無い時は今までどおり（FR6.3）。claim の file は読むだけで書かない。

### Step 10: MCP の server を先に接続し、起動のたびの表の変更をやめる（FR7.2、FR7.3）
- [x] `src/index.ts`: transport に先に接続して tool の一覧を返し、Store の用意はその後で行う。tool の呼び出しは用意が済むのを待つ。用意に失敗した時は、tool の呼び出しが理由つきの誤りを返す（黙らない）。新しい働きは新しい module（例: `src/mcp-store-readiness.ts`）に置く。
- [x] `src/index.ts`・`src/boot.ts`・`src/post-tool-hook.ts` の `createStore()` を、表の変更を流さない形（`skipPostgresMigrations: true`）にする。表の変更は `src/migrate.ts`（`npm run migrate`）だけが流す。今ある Gate 0 の試験（`tests/gate0/migration-idempotency.ts`）が通ったままかを確かめる。

### Step 11: 会話の取り込みを直す（FR8）
- [x] 2026-10-16 から `conversation_events`・`raw_events` が増えない原因を、Stop の hook の取り込み（`src/transcript-stop-capture.ts` と各 host の ingest）と、取り込みの常駐（`store.recordRawEvent is not a function` を出している古い daemon と、今の `src/raw-capture-service.ts`）の両方で、手元の試験と読み取りだけで確かめる。本番の DB には書かない。
- [x] 原因を直し、見本の transcript で行が入ること、同じ入力の 2 回目は重ねないことを試験で確かめる。原因が DB の作りの変更を要するなら、そこで止めて arc に知らせる（NFR5）。常駐の差し替えは守る物なので、この PR には入れない。

- [x] 原因の確かめ（読み取り）: Claude の取り込みは身元の規則（hook の cwd と全 record の cwd の一致）で 0 件、Codex の code は動く、常駐は main に無い古い build（#339 に案を追記）。
- [x] 身元の規則 R1〜R9（`capture-identity-design.md`、arc-sec 止める点なし）で Claude の規則を直す: 先に試験（R9 の正例 2・負例 5 ほか）を書いて落ちることを確かめてから、`src/claude-transcript-identity.ts` と `src/session-start-auto-receive.ts`・`src/transcript-stop-capture.ts` を直す。Claude の席の `workspace_mismatch`・`session_mismatch` を前提にしていた今の試験は、新しい理由コードに合わせて直す（直した所を `code-summary.md` に書く）。

### Step 12: 層ごとの細かい試験と網羅率
- [x] Step 4 の成功の場面の試験が通ることを確かめる。
- [x] 要件ごとの試験を足す（`src/test-session-rotation-*.ts`）: FR1（Claude・Codex・usage 無し）、FR2（既定・席の値・帯の値が 1 か所）、FR3（block 1 回・保存・落ちる形・秘匿処理）、FR4（保存の前は印が無い）、FR6（Claude と Codex の返し方・1 回だけ・上限）、FR7.1（決まった文）、FR7.2（tool の一覧が先に返る・用意の後に答える・用意の失敗）、FR7.3（起動で表の変更を流さない）、FR8（取り込みの直し）。各試験は正しい場合と、2 つ以上の誤りや境目の場合を持つ。
- [x] 新しい試験を、CI が呼ぶ npm の script（`test:claude-hook`・`test:codex-hook`・`test:automatic-receive` など）に足す。workflow の file は変えない。
- [x] 変えた行と新しい行の網羅率を測り、100% を確かめる。届かない行は数えから外さず、理由を `code-summary.md` と PR に書く。（測り方は、計画の時の「file ごとの lcov」ではなく、試験の process 全部に `NODE_V8_COVERAGE` を付けて足し合わせる形に変えた。手順と script の全文は `coverage-method.md`。採った判断・採らなかった案は `code-summary.md` の「計画からの外れ」。）

### Step 13: 型・build・今の試験の全体
- [x] `npx tsc --noEmit`、`npm run build`、CI と同じ試験の一覧を手元で流し、全部通ることを確かめる。

### Step 14: 見張りを作る（設計監査の PASS の後だけ）
- [x] 設計監査の返却が PASS で、作者の受領を PR に書いた後に始める。返却が BLOCK なら、設計の記録を直し、公開された Owner の判断を受けてから設計監査をもう一度依頼し、PASS まで code を書かない。
- [x] `src/rotation-watcher.ts`（と CLI の入口、読むだけの `probe`）を、設計の記録の版 4 のとおりに作る。`ps`・tmux の読み取りと起動し直し・画面・時計・file は差し替えられる形にし、試験では本物の tmux を使わない（差し替えの tmux は呼び出しの引数の列を全部記録する）。見張りが実行する tmux の命令は、閉じた集合（`display-message -p`・`list-clients -F`・`capture-pane -p`・`if-shell -F` の then の枝の `respawn-pane -k -t <pane_id>`）だけで、`send-keys` 系を呼ぶ経路も定数も code に持たない。`respawn-pane` に command の文字列を渡す経路も持たない。
- [x] 試験（設計の記録の版 4 の 13 のとおり。どれも設計監査の指摘 F1〜F5 に対応する）:
  - キーが 0 件の型: どの試験でも、記録した tmux の呼び出しは閉じた集合だけで、`send-keys` 系が 0 件。`respawn-pane` は `if-shell -F` の then の枝の中だけで、command の引数を持たず、1 つの印につき 0 回か 1 回。`probe` では 0 回。
  - 基本: 印あり・手すき・入力欄が空・人が触っていない・結びが合う時に、条件つきの起動し直しを 1 回だけ起こす。応答の途中・手すきを確かめられない・対応に無い画面は何もしない。Codex も同じ（続きの文は無い）。
  - 3 回目 F1: 観測の後にカーソルが動いた・client が付いた／外れた・client の最終操作が新しくなった・pane がコピー・モードになった・手番が `busy` に変わった、のそれぞれで `respawn-pane` が 0 回、claim は `aborted_before_respawn`。行が置き換わってカーソルが戻る窓は、起動し直しが起きうること（未送信の文の消失 R-A）と、席に届く文が 0 件であることを確かめ、「防いだ」とは主張しない。
  - 3 回目 F2: 印を書いた host が終了し、同じ shell の下の別の CLI が前面（`pane_pid`・command 名・カーソルが同じ）で、`respawn-pane` が 0 回（host の番号が死んでいる、または起動した時刻が違う）。pane の起動の command が登録と違う、起動の script の SHA-256 が違う、`expected_command` が違う、別のソケット・別の `pane_id`、`session_id` 違い、`drain_commands` に当たる process がある、も 0 回。確かめた後に host が替わる窓（R-C）は、1 回起きること・観測が帳面に残ることを確かめる。
  - 入力欄と人の観測: 静止した書きかけ、複数行の書きかけ、薄い案内文に合わない文、入力の行を見つけられない（許可・問いの画面）、カーソルが入力の頭に無い、client の最終操作が新しい、`list-clients` が失敗する、は 0 回。client が付いていなければ進む。
  - F3 一度だけ: 2 つの見張りが同時に同じ印を取りに行き実行は 1 つ。claim の取得が起動し直しより前。`claimed`・`respawning` の各段で止めた後の再起動で再実行せず（結果不明は照会、照会できなければ HALT）、`pane_pid` が古い値の 2 回目の命令は `NOT_RESPAWNED`。claim か帳面が書けなければ実行しない。
  - 確認: `started` が古い・別の起動・別の pane・同じ `session_id`・`rotation_marker_id` 違い・`host_pid` が旧と同じ・`source` が `startup` でない、は `unconfirmed` と HALT。`pane_pid` が変わらない `started` も合わせない。
  - F4 証拠: `intent` 行が起動し直しより前で、host・旧 session_id・席・案件・pane・`host_started_at` を持つ。印が次の会話の物に置き換わった後も旧会話を求められる。帳面に画面の中身・秘密の値が無い。
  - 設定: `launch_command` に使えない文字、`owner_decision_ref` 無し、持ち主・権限が違う、`launch_script` の SHA-256 違いは 0 回。
  - F5: 見張りの module が実行できる tmux の命令が閉じた集合だけ。SSOT-6 の §9 に差分が無い。
  - `probe`: `respawn-pane` が 0 回。真偽・桁と行・`A0`・tmux の版・`pane_start_command` の値・対応の有無・SHA-256 だけを出す。
  - hook 側（Step 9）: `startup` で claim が合う時だけ切り直しの続きの束と initialUserMessage を返し、合わない時は今までと同じ。同じ束を 2 回使わない。
  - 網羅率 100%。

### Step 15: 記録と実装監査
- [x] `code-summary.md`・`traceability.json` を書く。監査の項目の file に実装の項目を足す。
- [x] code を同じ PR に push し、CI の後に実装監査を依頼した（`audit_stage` は実装の後。1 回目 comment 6787884981、2 回目 comment 6788925456、3 回目は Step 15c）。PR の本文に deviation_ledger（大きな file の扱い、届かない網羅率があればその理由）と「AI-DLC の単位の作る段の出力」を書く。
- [ ] 統合の後の席への据え付け（FR9.2・FR9.3）は、arc-sec の確かめと Owner の決定を受けてから、Owner の手作業として別に行う。

### Step 15b: 実装監査の 1 回目（BLOCK、F1〜F6）を受けた直し
- [x] 返却 https://github.com/watchout/agent-memory/pull/341#issuecomment-6788119508 を `--review` で流した結果は BLOCKED。作者の受領としてその結果をそのまま PR に書いた（https://github.com/watchout/agent-memory/pull/341#issuecomment-6788338692 ）。6 件とも指摘のとおり受け止めた。
- [x] 同じ単位の中で直した（DB の作り・workflow・資格情報・席への据え付けは変えていない。見張りの設計の記録は、F4・F5 が設計の条件の実装なので改版していない）: F1 = Stop の hook の内部期限、F2 = 印の無い compact の決まった文、F3 = 回復の文の上限（切り詰めの印を含む）、F4 = 読めない帳面と照会で確認した起動し直しの数え方、F5 = 確認の記録の失敗を成功にしない、F6 = 保存の前の transcript の帰属の確かめ。参考の S3 は、席名・起動の command の文字の規則と uid の取り方を 1 か所にして解いた。内容は `code-summary.md` の「1 回目の実装監査への直し」。
- [x] 指摘ごとの試験を足した（1 回目の直しの時点の数: core 21・flow 36・registration 12・units 83・watcher-flow 100。今の数は Step 15c）。型検査、CI の mirror 18 / 18、変えた行と新しい行の網羅率（動かなかったのは入口の最後の網 2 範囲だけ）をもう一度確かめた。
- [x] 記録を直した: `code-summary.md`（「量を測るだけ」の説明の訂正、見直しの後の変更と追跡の確かめの開示を含む）、`unit-test-instructions.md`、`coverage-method.md`（新）、`traceability.json`、監査の項目の file。
- [x] 直した head（`f30c8ffd0858859a2c0970bfac061f6a2e83d5dd`）を push し、CI（build-and-test 18・20・22）が通ってから、2 回目の `sds-audit-request/1` を同じ PR に出した（https://github.com/watchout/agent-memory/pull/341#issuecomment-6788925456 ）。返却は BLOCK（https://github.com/watchout/agent-memory/pull/341#issuecomment-6789232372 ）。返却が来るまで push せず、`--review` を push の前に流して BLOCKED を確かめ、作者の受領（成立していない旨）を書いた（https://github.com/watchout/agent-memory/pull/341#issuecomment-6789263317 ）。

### Step 15c: 実装監査の 2 回目（BLOCK、F1・F5 の 2 件）を受けた直し
- [x] 返却の項目の結果: IMP-1・3・4・5・7・10 は PASS、IMP-2・6・8・9 は FAIL。ブロックしている指摘は 2 件だけ（どちらも指摘のとおり受け止めた）。
  - F1（P2）Stop の hook の標準入力の読みが内部期限の外にある。`runRotationCli` が入力を読み終えてから期限を始めていたので、標準入力が閉じない hook は 7 秒を超えて残った。
  - F5（P1）見張りの `runPass` が、ある席の tick が `stop_runner: true` を返しても次の席を続けて回していた。止まるかの確かめは全部の席の後だった。
- [x] 試験を直しより先に書き、直す前の code で落ちることを確かめた: watcher-flow の 3 件（同じ pass で後の席を回さない・loop が止まり pass の一覧に後の席が無い・`once` が止まった席で終わり終了コード 4）は直す前に 3 件とも落ちた。flow の標準入力の試験は、閉じない入力の単体の場合が直す前は決着せず、試験の file 全体が Node の決着しない top-level await で終了コード 13 になった。前回 push した code（`f30c8ffd…`）で流すと、F1 の残り 3 件は 3 件とも落ちた: 期限の後に届いた入力を使ってしまい（理由が `unmeasured:usage_field_missing`）、読みに使った時間が予算から引かれず 1,602 ms かかり（予算は 1,000 ms）、別 process で起動した hook は 20 秒待っても終わらなかった。（監査の席も、実際の command で標準入力を開けたままにして 7,381 ms 残ることを示している。）
- [x] 直した（DB の作り・workflow・資格情報・席への据え付けは変えていない。見張りの設計の記録は改版していない。F5 は設計の「失敗を隠さない」条件の実装の順序の直し）:
  - F5: `src/rotation-watcher-run.ts` の `runPass` は、tick が `stop_runner` を返した席で seat の loop を抜け、後の席を回さない。`runnerMustStop`・loop・`once` の終了コード 4 は、回した席の一覧だけを見る。
  - F1: `src/session-rotation-stop.ts` の `runRotationCli` は、引数を解いた直後に総予算（`--timeout-ms` と 7 秒の小さい方）を始め、標準入力の読みとその予算を競わせる。予算が先に来た時は、席を止めない証拠（理由 `internal_deadline_exceeded`）で PASS を返す。同じ予算を `runSessionRotationStop` に渡し、読みに使った時間は同じ予算から引かれる（2 つ目の予算を作らない）。予算の持ち主（`runRotationCli`）が最後に取り消す。
- [x] 指摘ごとの試験を足した（flow 40・watcher-flow 103。ほかは変わらず core 21・registration 12・status 8・units 83・身元 25）。型検査、CI の mirror 18 / 18、変えた行と新しい行の網羅率をもう一度確かめる。
- [x] この項目（記録を直した head に合わせ、3 回目の依頼を出す）の経過は PR #341 の comment にある。PR #341 は 2026-11-11T07:47:02Z に統合された（merge commit `aa77b683e135beabb9fc54bd3736b47d288d6f46`）。席が確かめたのは統合の事実だけで、監査の返却ごとの結果はこの計画に写さない（写しを作らない）。

### Step 16: hook の入力の parser の直し（2026-11-11 の新しい試行）

出どころ: 席の C2（agent-memory#339 に載せる読み戻しの本文は `operation/deployment-execution/issue-339-readback-c2.md`）と、arc の技術の判断（agent-memory#339 の comment 6791901034、本文 SHA-256 `69ca10d6e8e418ad425e1e9a8f81b73799d49fa8496ad93288dc2882fae59c32`。Owner の決定ではない）。arc-sec の条件（公開。iyasaka-arc#57 の comment 6791886636・6791925065）、host の契約の版の扱いと Codex の Stop の同時の緩みは arc の追記（agent-memory#339 の comment 6793417308、本文 SHA-256 `af373c531792b58c7fcd7023d99c4e943c5f50cac54a2d5d1f9745779de43e5c`。Owner の決定ではない）、arc-sec の技術の読み（iyasaka-arc#57 の comment 6792778481。devauditor の verdict の代わりではない）。1 回目の設計監査（PR #342 の comment 6793000316）は BLOCK（P2 が 4 件 F1〜F4）で、この記録の 16.3・16.7 に直しを入れた。入力の確かめ（安全）と契約に触れるので、team.md のとおり、設計の記録だけの PR を先に出し、独立の設計監査を 1 回受け、PASS の後に試験だけの commit、その後に実装。段は `jump execute --direction backward` で code-generation に戻した（`jump reopen` は単位ごとの command で、単位の無いこの取り組みでは使えなかった）。

- [x] 16.1 branch `kusabi/hook-input-parser-261111` を `origin/main`（`aa77b683e135beabb9fc54bd3736b47d288d6f46`）から切る（作業場の file は動かさない）。作業場の実装は main と同じ内容であることを file ごとの hash で確かめた（違うのは `.gitignore` の AI-DLC の block だけ）。
- [x] 16.2 要件 FR10.1〜FR10.7 を `requirements.md` に足した（出どころ `[C2]`・`[arc の判断 #339]`。Codex ほかの host の parser と診断の正式な証拠化は範囲の外に書いた）。
- [x] 16.3 設計の記録 `hook-input-design.md` を書いた（0〜13 節）。出所は 0 節と 13 節で分けた: 公開された記録 A1〜A4（版の扱いと Codex の同時の緩みは A3）、作者の設計上の選択（観測した版の実施者を配備を行う席にする）、GitHub への記録がまだ無い物（`.gitignore` を 1 行だけにすること）。1 回目の設計監査の直し: 3 節に入口・項目ごとの今の拒否／省略の表（F1）、5 節に診断の時間の予算（F2）、8 節に `--node-path` の受け入れる名前と管理中の判定（F3）、0 節・7 節・13 節に版の出所の分け（F4）。deviation_ledger は 14 行。書く予定だった中身: 入口 3 つ（`parseClaudeSessionStartInput`・`parseTranscriptStopInput` を使う取り込みと切り直しの Stop）を 1 か所の parser に通す形、知らない key を無視し必須の key・型・64 KiB の上限は今までどおり拒否する規則、診断の記録（置き場は `$AGENT_MEMORY_HOME` の下・folder 0700・file 0600・一時 file + rename、中身は event 名・key の名前・件数・時刻だけ、名前は 64 字以内で安全な文字だけ・1 件 32 個以内・上限を超えたら古い物から捨てる、診断が書けなくても hook の答えと証拠は変えない）、health check が読む形（名前と件数だけ、読めない時は「観測できず」で 0 と読まない）、host の契約の版の定数は 2.1.220 のまま（意味は「契約を確かめた版」。観測した版は診断には書かず、配備の health check の手順（code ではない。実施者は配備を行う席）が `claude --version` で取って配備の記録に書く。v1 の証拠の schema の const を動かさない）、Codex の SessionStart の parser は範囲外（同じ形の脆さがある。直すかは別に決める）、標準 S3・S4・S5・S6・S8 の当て方（S7 は外への効果が無いので該当しない）、反転する既存の負例の一覧（deviation_ledger の 1 行ずつ）。設計と実装が食い違う所が無いことの確かめ（HOST_ADAPTERS・SSOT-3/5/6 に「知らない key は拒否」と定めた所は無い）。
- [x] 16.4（済み）`docs/operations/HOST_ADAPTERS.md` に、host の入力の扱い（必須・型・上限は守り、知らない key は無視して名前だけ診断に残す）を 1 段落足す。
- [x] 16.5（済み。DES-1〜DES-11、control_source_ref は arc の #339 の判断）監査の項目の file `docs/audit/kusabi-hook-input-261111.json`（`sds-audit-items/1`）を作る。項目は arc-sec の条件（必須の key・型・64 KiB の上限が残る／入口 3 つが 1 か所の parser／host の契約の版の定数の扱い／実物の key の形の正例と負例／反転した負例の deviation_ledger）と、診断の記録の安全（a〜d）、標準 S4・S5・S8、v1 の契約に触れていないこと。
- [ ] 16.6 設計の記録だけの PR に入れる物: この取り組みの記録（`inception/`・`construction/code-generation/`・`operation/`。`audit/` と `.aidlc-engine/` は入れない）、`HOST_ADAPTERS.md` の段落、監査の項目の file、`.gitignore`（base の内容に `.claude/settings.json.bak*` の 1 行だけを足した版。作業場の `.gitignore` には AI-DLC の block が入っているので、作業場の file を `git add` せず、base の blob に 1 行を足した物を一時の index に置く）。入れる前に、手元の path・秘密の値・非公開の repo の中身が無いかを探し、あれば伏せる。依頼の前の自己確認（古い言い回しの grep、数の出所をたどる、項目の file を見直し役に先に見せる）を流す。
- [ ] 16.7 PR を出し、CI がその head で終わるのを待ち、`sds-audit-request/1`（`audit_stage` は設計）を watchout の名義で投稿し、前検査を流す。PR の URL と head を arc に送る（arc-sec も差分を読む）。返却が来るまで push しない。返却は `--review` を push の前に流し、結果をそのまま作者の受領として PR に書く。BLOCK なら指摘を受け、直し方が Owner の判断を要するか（契約・守る物）を見てから続きを決める。PASS で受領が RECEIPT_ACCEPTED になるまで、16.8 以降は始めない。1 回目: 依頼 6792689252、返却 6793000316（BLOCK、F1〜F4）。受領の command は BLOCKED を返し、返却の next_action に従ってそれを作者の受領の記録として 2 回目の依頼に書く。2 回目: F1〜F4 を直した head で `sds-audit-request/1` を出し直す（新しい head・本文の digest・項目の file の digest）。
- [ ] 16.8 試験だけの commit（設計監査の PASS の後。arc-sec が実装の時に見る 2 点 = 共有の parser が入口ごとの型・event・source・身元の確かめを落とさず知らない key の値を下流に出さない／反転する負例が身元の負例を巻き込まない、を試験に必ず入れる。試験の手順の『arc-sec が実装の時に見る 2 点』）: 2.1.321 の実物の key の形（SessionStart に `session_title`、UserPromptSubmit に `prompt_id`・`session_title`、Stop に `background_tasks`・`effort`・`prompt_id`・`session_crons`）で受理される正例、必須の key の欠け・型の違い・64 KiB 超・JSON でない入力・配列の入力は今までどおり拒否される負例、無視した key の名前が診断に出て値が出ない試験、診断が書けない時（置き場が書けない・壊れている）に hook の答えと証拠が変わらない試験、診断の読みが読めない時に「観測できず」を返す試験、入口 3 つが同じ parser を通る試験、Codex の取り込みの Stop・UserPromptSubmit の正例（知らない key の受理、Codex の adapter id での診断）と負例（必須の欠け・型の違い・64 KiB 超などの拒否、Codex の SessionStart は今までどおり拒否）を書く。反転する既存の負例（`src/test-claude-session-start.ts` の `unexpected: true` の 2 件など）は、直す前の code で落ちることを確かめ、失敗の出力を記録する。設計監査 1 回目の指摘に合わせて次も書く: (F1) 入口・項目ごとの今の拒否／省略の固定（SessionStart の `model: null`・違う `permission_mode`・空の `agent_type` は `MALFORMED_HOOK_INPUT`。Stop・UserPromptSubmit の任意 8 項目の型違いは受理され省略される。この固定は直す前の code でも通る確かめで、挙動を変えていないことの回帰の防ぎ）、(F2) 診断の時間の予算（遅い I/O の注入で答えと証拠が同じ、予算切れで書き手が呼ばれない、境界 2000 ms 通過・1999 ms 省略、書き手の例外、診断が答えと証拠の確定の後に呼ばれる、入口 3 つのそれぞれ）、(F3) `--node-path` の両 installer の試験（`nodejs` の名前の symlink の拒否、`node` の名前の symlink の許可、3 つの command が同じ node、別名の symlink での入れ直しと同じ指定の再実行で管理中の hook が 1 つ、古い installer が書いた任意の絶対 path の hook の置き換え、相対 path・adapter id の違い・flag の並びの違いは管理外、`parseClaudeHookCommand` の既定の結果と `kusabi-fleet-rollout` の試験が今のまま）、(診断の配線) 入口 3 つ（取り込みと切り直しは Claude と Codex）のそれぞれで、受理される入力から診断の file に名前と件数が書かれ、拒否される入力では書かれず、姉妹の関数の `input` が元の関数の戻り値と同じ。実装の前の commit にする（TDD の順）。
- [ ] 16.9 実装（作る役が行う場合は、取り組みごとの Owner の承認が要る。承認が無ければ席が自分で書く）: 共通の parser の module と診断の module を新しく置き、`src/claude-session-start.ts`・`src/transcript-stop-capture.ts` に戻り値の型を変えない姉妹の関数（`parseClaudeSessionStartInputWithIgnored`・`parseTranscriptStopInputWithIgnored`。今の parser はその `input` だけを返す）を足し、3 つの入口の呼び出し（`src/claude-session-start.ts`・`src/transcript-stop-capture.ts`・`src/session-rotation-stop.ts`）は姉妹の関数と診断を呼ぶ数行だけを差し替える・足す（切り直しの Stop は `RotationStopResult` の型を変えず、`RotationStopDependencies` に任意の `on_ignored_names` を足して `runRotationCli` が受ける。設計 4 節）。必須の入口の一覧（`scripts/build-kusabi-content-addressed-runtime-release.mjs` の `ENTRYPOINTS` と `src/kusabi-direct-fleet-rollout.ts` の `REQUIRED_ENTRYPOINTS` と、それぞれの試験）に切り直しの 2 つ（`dist/session-rotation-stop.js` と `dist/rotation-watcher.js`）を足す。installer 2 つに `--node-path`（既定は今の `process.execPath`。絶対 path で basename がちょうど `node`、実在する通常 file（symlink は許す）で実行できる物だけ受け、3 つの command すべてに同じ node を使う）を足し、`parseClaudeHookCommand` に省略可能な `interpreter` 引数（既定 `"current"` = 今の動き）を足して、Claude の SessionStart の installer の管理中の判定だけが `"any"` を渡す（`kusabi-fleet-rollout` と `company-dev-os-recovery-target-audit` の読みは変えない。`--node-path` で別の node を入れた席はその 2 つに数えられず安全側に失敗するので、rollout・監査が数える席には使わない。設計 8 節・12 節）。診断は、入口が起動時に読んだ時刻から残りの予算を計算して `remaining_ms` を診断の核に渡し、答えと証拠の確定の後に `HOOK_DIAGNOSTIC_MIN_REMAINING_MS`（2000 ms）以上の時だけ始める（切り直しの Stop は既存の `Deadline` に残りの ms を返す関数を足し、期限の判定は今のまま）。800 行を超える file（`src/kusabi-direct-fleet-rollout.ts` ほか）は呼び出しの数行だけを足す。DB の作り・workflow・資格情報・席の設定・v1 の証拠の schema は変えない。
- [ ] 16.10 型検査・build・今の試験の全部・変えた行と新しい行の網羅率 100%（`coverage-method.md` の手順）を確かめ、記録（`code-summary.md`・`unit-test-instructions.md`・`traceability.json`・監査の項目の file）を head に合わせる。依頼の前の自己確認（古い言い回しの grep、数の出所、見直し役に項目を見せる）に、arc-sec の 2 点（試験の手順にある 2 点。反転した負例の差分を 1 行ずつ読んだ結果を含む）を入れて流し、実装の `sds-audit-request/1` を同じ PR に出す。返却が来るまで push しない。受領は 16.7 と同じ手順。
- [ ] 16.11 統合の後（統合は作者以外の席 = suite-lead。この PR は R3 なので、統合の前に Owner の exact-head が要る。arc が受ける）: 新しい版を作る（S1）→ S3・S4 のやり直しは Owner が arc の script を打つ → 席を起こし直して C2 を取り直す（SessionStart の証拠が `input_valid: true`、`auto_receive.status` と `store_binding` が読める）→ 診断の記録が空でない事と名前だけが出ることを health check（`session-rotation-status` の `hook_input` の節）が報告し、配備を行う席が手順の 1 行として `claude --version` を流して、配備の記録（`operation/deployment-execution/health-check-report.md` の指標の表）に「観測した版と契約を確かめた版 2.1.220 のずれ」の 1 行を必ず書く（読めない時は「観測できず」。この 1 行が無い記録は完了としない。arc-sec の条件）→ 戻しの手順の読み戻しで、同じ event に Wasurezu の hook が 2 つ重なっていないことを確かめる。これは Build and Test 以後の段の仕事で、この段の完了の条件ではない。

## Testing Contract

```json
{
  "version": 1,
  "methodology": "custom",
  "source": "team",
  "ordering": "成功の条件の場面（担当交代と再起動の後に取り出せるか）の試験を、その場面を作る実装より先に書いて失敗を確かめ、細かい試験は試験できる層ごとに実装の後に書いて動かす。",
  "scope": "express",
  "test_strategy": "minimal",
  "project_type": "brownfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    },
    {
      "layer": "team",
      "text": "- **Methodology**: custom\n- **Methodology evidence**: 成功の条件は「担当交代と再起動の場面を決めた試験で取り出せる割合 100%」（D-06・D-26・D-27）なので、その場面の試験を先に固めて完了の判定をぶれさせない。細かい試験は、今の自前の tsx のスクリプトの形に合わせて実装の後に書く（面談の Q3 = C）。\n- **Ordering**: 成功の条件の場面（担当交代と再起動の後に取り出せるか）の試験を、その場面を作る実装より先に書いて失敗を確かめ、細かい試験は試験できる層ごとに実装の後に書いて動かす。\n- 網羅率: 行の網羅率 100% を床にし、統合の前に CI で確かめる。Build and Test の段でも 100% を確かめ、段を通すために弱めない（社内基準 100% = Owner の決定 OD-COMPANY-AIDLC-LINE-COVERAGE-FLOOR-100-20261105-001、iyasaka-arc#49 6647418162。org.md の既定 80% より厳しい床をここで定める）。届かない行を数えから外す時は、PR に理由を書いて独立の監査で見る。\n- PostgreSQL の試験は、最初は手元で回し、結果を PR に証拠として載せる。置き場所の設計が固まった所で CI に入れる。CI の workflow を変える時は owner の exact-head を得る（面談の Q5 = C）。\n- CI（.github/workflows/ci.yml）は Node 18・20・22 で型検査・ビルド・試験を回す。今ある試験は通ったまま保つ。\n\n- 行の網羅率は、組み込みの lcov を file ごとに足す形より、NODE_V8_COVERAGE を全試験につけて process をまたいで足す方が、hook を子 process で起動する場合も数えられる。集計は手作業にせず、監査の席が同じ数字を出せる script にする（OmotenasuAI でも、c8 をそのまま包むと子 process と worker が別に数えられる罠が見つかっている）。 (learned 2026-11-11)"
    },
    {
      "layer": "project",
      "text": "- 試験や確かめの script で既定の createStore() を呼ぶと、JSON の store の置き場が homedir() から決まり、この Mac の実際の保存先に行が入る。必ず一時の HOME を指定して動かす（11-11 の code-generation で conversation-events.json・raw-events.json に試験の行が入った）。 (learned 2026-11-11) \n\n- 手元で使い捨ての PostgreSQL を起動する時は、Unix socket の path が長いと起動できないので socket を切って（unix_socket_directories を空）127.0.0.1 の TCP だけにし、試験が英語の誤り文（duplicate key）を照合するので lc_messages=C を付ける。 (learned 2026-11-11)"
    }
  ],
  "obligations": {
    "strategy": "minimal",
    "strategy_volume": [
      "One verifiable test per requirement at the narrowest effective level.",
      "At least one happy-path unit test per component.",
      "Unit tests are the default; a bugfix/security scope floor may require an integration or E2E regression when that is the narrowest level that reproduces the defect."
    ],
    "scope_floor": [
      "Keep the existing test suite green.",
      "This scope adds no extra new-test floor beyond the selected test strategy."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "custom",
    "runner_step": "Verify the existing test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Verify the existing test runner/configuration and record the exact unit-scoped command.",
      "Custom ordering - 成功の条件の場面（担当交代と再起動の後に取り出せるか）の試験を、その場面を作る実装より先に書いて失敗を確かめ、細かい試験は試験できる層ごとに実装の後に書いて動かす。",
      "Implementation and tests - preserve that exact ordering; do not convert it to layer-local TDD.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:9ea0e79b5d02dd66f8f6f49dcc9235f9581640877390b41ce18d2c79294e905b",
  "contract_sha256": "sha256:053223c5619a3b28bc20ca968ea8d30f6caff7814b6926f35778cb7fe1824714"
}
```

## 要件と手順の対応

| 要件 | 手順 |
|---|---|
| FR1.1〜FR1.4 | Step 4・5・12 |
| FR2.1〜FR2.3 | Step 6・12 |
| FR3.1〜FR3.4 | Step 4・7・12 |
| FR4.1〜FR4.2 | Step 2・8・12 |
| FR5.1〜FR5.6 | Step 2・3・14 |
| FR6.1〜FR6.5 | Step 4・9・12 |
| FR7.1〜FR7.3 | Step 9・10・12 |
| FR8.1〜FR8.6 | Step 11・12 |
| FR9.1 | Step 4・12・14 |
| FR9.2・FR9.3 | Step 15（統合の後、Owner の決定で据える） |
| NFR1〜NFR7 | Step 5〜14 の試験と Step 12・13 |
| FR10.1〜FR10.5 | Step 16.3〜16.5・16.8・16.9 |
| FR10.6・FR10.7 | Step 16.9・16.10 |
