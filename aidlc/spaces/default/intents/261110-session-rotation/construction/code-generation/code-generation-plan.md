# 作る段の計画 — 会話の切り直し（261110-session-rotation）

## Summary

- Builds: 会話の量を測り、閾値で 1 回だけ席に引き継ぎを書かせて DB に残し、「切ってよい」の印を出し、次の会話の頭に続きを入れる経路（Claude Code・Codex）。MCP の server を先に接続させ、起動のたびの表の変更をやめる。会話の取り込みの止まりを直す。見張りも含め、この単位の code は設計の記録と設計監査を先に通し、PASS の後に作る。
- Touches: 新しい module（`src/session-rotation-*.ts`・`src/rotation-watcher.ts`）、`src/transcript-stop-capture.ts`・`src/claude-session-start.ts`・`src/codex-session-start.ts`・`src/index.ts`・`src/boot.ts`・`src/post-tool-hook.ts`・`src/constants.ts`・hook の installer 2 つ・取り込みの直す所、`package.json` の試験の一覧、`docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md`、この取り組みの記録。
- Tests: 成功の場面の試験 1 file（Claude Code と Codex、先に書いて失敗を確かめる）と、要件ごとの試験（FR1〜FR8、約 15）。試験の code も、全部、設計監査の PASS の後に書く。変えた行と新しい行の網羅率 100%。

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
- [ ] 見張りの設計の記録（版 3）・SSOT-6 §5・要件 FR5.2・FR9.2・監査の項目の file・この計画と試験の手順を直し、PR に足す。
- [ ] CI が新しい head で終わるのを待ち、3 回目の `sds-audit-request/1` を同じ PR に出し、前検査を流す。返却が来るまで push しない。

### Step 4: 成功の場面の試験を先に書いて失敗を確かめる（Testing Contract の順番）
- [ ] `src/test-session-rotation-scenario.ts` を書く。Claude Code と Codex の transcript の見本（閾値の上）と、試験用の Store（SQLite か JSON、`HOME` を一時の folder にする）で、次の流れを確かめる: 1 回目の Stop の hook が block と理由の文を返す → 席の引き継ぎの文を含む 2 回目の Stop の hook が、作業の状態と回復の束を DB に書き、印を出す → SessionStart（source = `clear`）が、頭に残した「次の 1 歩」と FR7.1 の決まった文を入れた additionalContext を返す（Claude Code は initialUserMessage も）→ 同じ束は 2 回使わない。
- [ ] 実装の前に動かし、失敗することを確かめて、その出力を `code-summary.md` に残す。

### Step 5: 量を測る（FR1）
- [ ] 新しい module `src/session-rotation-usage.ts`: Claude Code の最後の応答の usage（input + cache_read + cache_creation）と、Codex の最後の `token_count` の `last_token_usage` の入力の量を、transcript の行から求める純粋な関数。時刻・環境・file を読まない（S4）。読めない時は「観測できず」と理由を返す（S5）。今の `src/codex-context-measurement.ts` の Codex の読み方と同じ知識を 2 か所に持たない（S3）。同じ関数を使うか、そちらへ寄せる。
- [ ] adapter: transcript の末尾 4 MiB だけを読む（今の `TRANSCRIPT_CAPTURE_TAIL_BYTES` を使う）。

### Step 6: 閾値（FR2）
- [ ] 既定の 300,000 を `src/constants.ts` の 1 か所に置く。
- [ ] Stop の hook の command に、席ごとの値の引数（`--rotation-threshold-tokens`）を任意で足せるようにする。`src/claude-hook-installer.ts`・`src/codex-hook-installer.ts` の command の組み立てと読み戻し（同じ文字列に戻ること）も、引数の有る形と無い形の両方を受けるように直す。
- [ ] 切り直しの判定が今の帯の判定に触れる時は、`src/restart-prepare.ts` と `src/context-window-resolution.ts` に literal で 2 か所ある帯の値を 1 か所に寄せる（FR2.3）。触れない時は直さず、その旨を `code-summary.md` に書く。

### Step 7: 切る前に残す（FR3）
- [ ] 新しい module `src/session-rotation-stop.ts`: 量が閾値以上で、その会話でまだ残していない時に、block と理由の文（「済んだこと・次の 1 歩・まだ決まっていないこと」を書いて終える）を返す。1 つの会話で block は最大 1 回。
- [ ] 次の Stop で、席の書いた文を transcript から取り出し、秘匿処理を通して、Store に直接書く（作業の状態と、1 回だけ使う回復の束とその metadata）。MCP は通さない。DB の作りは変えない。
- [ ] 席の文が取れない時は、既にある記録だけで束を作り、落ちた理由を残す（FR3.3）。
- [ ] `src/transcript-stop-capture.ts` から呼ぶ。今の取り込み（非同期）とは別に、切り直しの判定は同期で返す必要がある。hook の登録を同期の別の hook にするか、今の hook の中で順を決めるかを決め、決めた理由を `code-summary.md` に書く（席への据え付けは守る物なので、この PR では command の形と installer だけを用意する）。

### Step 8: 「切ってよい」の印（FR4）
- [ ] 保存が Store に入った後にだけ印を出す。印は席・案件・会話と、その会話が動いている画面（`TMUX_PANE` の pane_id・`TMUX` のソケット・hook の親 process の番号）に結ぶ。UserPromptSubmit・Stop・SessionStart の hook が書く手番の file も同じ値を持つ。置き場と形は見張りの設計の記録の版 3（2.1・2.2）で決めた物にする（見張りが LLM を使わずに読める形）。tmux の外の席は pane を null にして書く。
- [ ] 今の印の状態を見る command（例: `wasurezu-restart` の下位の command）を足す。

### Step 9: 次の会話で続きから動く（FR6、FR7.1）
- [ ] 新しい module `src/session-rotation-start.ts`: 準備した束を 1 回だけ取り出し、残した文を頭にした回復の文を作る。上限は 10,000 トークン（FR6.4、既定は `src/constants.ts` の 1 か所）。FR7.1 の決まった文（曖昧な点は推測で埋めず Kusabi の DB を当たる、当たる tool の名前）を入れる。
- [ ] `src/claude-session-start.ts`（source = `clear`・`compact`）は additionalContext と initialUserMessage を返す。`src/codex-session-start.ts` は additionalContext を返す。束が無い時は今までどおり DB から作る（FR6.3）。

### Step 10: MCP の server を先に接続し、起動のたびの表の変更をやめる（FR7.2、FR7.3）
- [ ] `src/index.ts`: transport に先に接続して tool の一覧を返し、Store の用意はその後で行う。tool の呼び出しは用意が済むのを待つ。用意に失敗した時は、tool の呼び出しが理由つきの誤りを返す（黙らない）。新しい働きは新しい module（例: `src/mcp-store-readiness.ts`）に置く。
- [ ] `src/index.ts`・`src/boot.ts`・`src/post-tool-hook.ts` の `createStore()` を、表の変更を流さない形（`skipPostgresMigrations: true`）にする。表の変更は `src/migrate.ts`（`npm run migrate`）だけが流す。今ある Gate 0 の試験（`tests/gate0/migration-idempotency.ts`）が通ったままかを確かめる。

### Step 11: 会話の取り込みを直す（FR8）
- [ ] 2026-10-16 から `conversation_events`・`raw_events` が増えない原因を、Stop の hook の取り込み（`src/transcript-stop-capture.ts` と各 host の ingest）と、取り込みの常駐（`store.recordRawEvent is not a function` を出している古い daemon と、今の `src/raw-capture-service.ts`）の両方で、手元の試験と読み取りだけで確かめる。本番の DB には書かない。
- [ ] 原因を直し、見本の transcript で行が入ること、同じ入力の 2 回目は重ねないことを試験で確かめる。原因が DB の作りの変更を要するなら、そこで止めて arc に知らせる（NFR5）。常駐の差し替えは守る物なので、この PR には入れない。

### Step 12: 層ごとの細かい試験と網羅率
- [ ] Step 4 の成功の場面の試験が通ることを確かめる。
- [ ] 要件ごとの試験を足す（`src/test-session-rotation-*.ts`）: FR1（Claude・Codex・usage 無し）、FR2（既定・席の値・帯の値が 1 か所）、FR3（block 1 回・保存・落ちる形・秘匿処理）、FR4（保存の前は印が無い）、FR6（Claude と Codex の返し方・1 回だけ・上限）、FR7.1（決まった文）、FR7.2（tool の一覧が先に返る・用意の後に答える・用意の失敗）、FR7.3（起動で表の変更を流さない）、FR8（取り込みの直し）。各試験は正しい場合と、2 つ以上の誤りや境目の場合を持つ。
- [ ] 新しい試験を、CI が呼ぶ npm の script（`test:claude-hook`・`test:codex-hook`・`test:automatic-receive` など）に足す。workflow の file は変えない。
- [ ] 変えた行と新しい行の網羅率を、Node に組み込みの網羅率（`node --test --experimental-test-coverage --test-reporter=lcov --import tsx <試験の file>`）で測り、100% を確かめる。届かない行は数えから外さず、理由を `code-summary.md` と PR に書く。

### Step 13: 型・build・今の試験の全体
- [ ] `npx tsc --noEmit`、`npm run build`、CI と同じ試験の一覧を手元で流し、全部通ることを確かめる。

### Step 14: 見張りを作る（設計監査の PASS の後だけ）
- [ ] 設計監査の返却が PASS で、作者の受領を PR に書いた後に始める。返却が BLOCK なら、設計の記録を直して設計監査をもう一度依頼し、PASS まで code を書かない。
- [ ] `src/rotation-watcher.ts`（と CLI の入口、読むだけの `probe`）を、設計の記録の版 3 のとおりに作る。画面に打つ所・`ps`・tmux の読み取り・時計・file は差し替えられる形にし、試験では本物の tmux を使わない（差し替えの tmux は呼び出しの引数の列を全部記録する）。見張りが送れるキーは `/clear`・`/new` の文字と `Enter` だけで、BSpace・C-u・Escape・矢印を送る経路も定数も code に持たない。
- [ ] 試験（設計の記録の版 3 の 12 のとおり。どれも設計監査の指摘 F1〜F5 に対応する）:
  - 送るキーの型: どの試験でも、送ったキーの列が〔command の文字、条件つきの Enter〕（成功）、〔command の文字〕だけ（打った後に止まった）、〔〕（打つ前に止まった）のどれかに完全に一致する。ほかのキーが 1 度でも現れたら失敗。
  - 基本: 印あり・手すき・入力欄が空・人が触っていない・結びが合う時に command を 1 回打つ。応答の途中・手すきを確かめられない・対応に無い画面は打たない。Codex は `/new` と Enter だけ。
  - F1 入力欄と人の入力: 静止した書きかけ、複数行の書きかけ、薄い案内文に合わない文、入力の行を見つけられない、カーソルが入力の頭に無い、client の最終操作が新しい、`list-clients` が失敗する、は打たない。client が付いていなければ打つ。打った後に書きかけが前・後ろに足された、行が置き換わった、カーソルが動いた、client の最終操作が新しくなった、手番が `busy` に変わった、は〔command の文字〕だけで止まり、`abandoned_after_typing` と HALT を残す（人の入力を減らす方向のキーは 0 件）。
  - F1 条件つきの Enter: 条件が偽（桁・行・`pane_pid`・command 名・`pane_id`・client の数のどれかが違う）の時、`ENTER_NOT_SENT` を読み、Enter も追加のキーも 0 件で止まる。tmux が条件つきの形に対応しなければ打たない。
  - F2 結び: 打つ前に、別の pane、同じ名前の別の会話、host の process が死んでいる・pane の子孫でない、pane の再利用、tmux のソケット違い、pane が null は打たない。打った後に、host が終了して前面が shell や別の CLI になった、`ps` が読めなくなった、`capture-pane` が失敗した、tmux が応答しない、は追加のキー 0 件で止まる。古い・別の起動・別の pane の `started` は確認として受けない。
  - F3 一度だけ: 2 つの見張りが同時に同じ印を取りに行き送るのは 1 つ。claim の取得が最初の send-keys より前。`typing`・`enter` の各段で止めた後の再起動で再送せず追加のキーも送らない（結果不明は照会、照会できなければ HALT）。claim か帳面が書けなければ送らない（打った後に書けなくなっても追加のキー 0 件）。同じキーで別の command は断る。
  - F4 証拠: `intent` 行が最初の send-keys より前で、host・旧 session_id・席・案件・pane を持つ。印が次の会話の物に置き換わった後も旧会話を求められる。帳面に画面の中身・秘密の値が無い。
  - F5: 打てる文字列の定数が上の 3 つ（2 つの command と Enter）だけ。SSOT-6 の §9 に差分が無い。
  - `probe`: 送るキーの列が空。真偽・桁と行・`A0`・tmux の版・対応の有無・SHA-256 だけを出す。
  - 網羅率 100%。

### Step 15: 記録と実装監査
- [ ] `code-summary.md`・`traceability.json` を書く。監査の項目の file に実装の項目を足す。
- [ ] code を同じ PR に push し、CI の後に実装監査を依頼する（`audit_stage` は実装の後）。PR の本文に deviation_ledger（大きな file の扱い、届かない網羅率があればその理由）と「AI-DLC の単位の作る段の出力」を書く。
- [ ] 統合の後の席への据え付け（FR9.2・FR9.3）は、arc-sec の確かめと Owner の決定を受けてから、Owner の手作業として別に行う。

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
      "text": "- **Methodology**: custom\n- **Methodology evidence**: 成功の条件は「担当交代と再起動の場面を決めた試験で取り出せる割合 100%」（D-06・D-26・D-27）なので、その場面の試験を先に固めて完了の判定をぶれさせない。細かい試験は、今の自前の tsx のスクリプトの形に合わせて実装の後に書く（面談の Q3 = C）。\n- **Ordering**: 成功の条件の場面（担当交代と再起動の後に取り出せるか）の試験を、その場面を作る実装より先に書いて失敗を確かめ、細かい試験は試験できる層ごとに実装の後に書いて動かす。\n- 網羅率: 行の網羅率 100% を床にし、統合の前に CI で確かめる。Build and Test の段でも 100% を確かめ、段を通すために弱めない（社内基準 100% = Owner の決定 OD-COMPANY-AIDLC-LINE-COVERAGE-FLOOR-100-20261105-001、iyasaka-arc#49 6647418162。org.md の既定 80% より厳しい床をここで定める）。届かない行を数えから外す時は、PR に理由を書いて独立の監査で見る。\n- PostgreSQL の試験は、最初は手元で回し、結果を PR に証拠として載せる。置き場所の設計が固まった所で CI に入れる。CI の workflow を変える時は owner の exact-head を得る（面談の Q5 = C）。\n- CI（.github/workflows/ci.yml）は Node 18・20・22 で型検査・ビルド・試験を回す。今ある試験は通ったまま保つ。"
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
  "input_sha256": "sha256:ab265ccc099d21d57fe2063d086fd2e6d5b3907ce7076321b0efe27e6c67a5bd",
  "contract_sha256": "sha256:7be0fb8b16745403a1534ca445a83b546587998941b071c3ec5ab54a45ac8e2a"
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
| FR8.1〜FR8.3 | Step 11・12 |
| FR9.1 | Step 4・12・14 |
| FR9.2・FR9.3 | Step 15（統合の後、Owner の決定で据える） |
| NFR1〜NFR7 | Step 5〜14 の試験と Step 12・13 |
