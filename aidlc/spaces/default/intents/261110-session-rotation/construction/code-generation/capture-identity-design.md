# 取り込みの身元の規則（FR8）: Claude Code の会話

この記録は、要件 FR8.4〜FR8.6 の設計です。Claude Code の席の Stop・SessionStart の hook が、transcript を「この席のこの会話の物」と認めて DB に入れる条件を決めます。Codex・Gemini・Antigravity の規則は変えません。

## 0. 出典

- 判断: arc-sec の確かめ ARCSEC-KUSABI-FR8-TRANSCRIPT-IDENTITY-20261111-001（止める点なし、条件 R1〜R9）。control_source_ref = `https://github.com/watchout/iyasaka-arc/issues/57#issuecomment-6786650040`、本文の SHA-256 = `487b93c6d403593069e0ca4eda945269ad1f97de964863dfff00870203bbf34d`（取り直して数えた値）。
- 決めた席: arc（Owner の委任 iyasaka-arc#49 6762288830）。形は「置き場 + file 名 + 全 record の sessionId」で、record ごとの cwd は身元の条件にしない。
- 守る物（セキュリティの規則）に当たるので、この単位の PR は R3 のまま、統合の前に Owner の exact-head を通す。

## 1. 守る物と限界

- 守る物: ほかの席・ほかの会話の transcript を、この席の記憶（DB）に入れない（席の記憶の混線）。
- 限界: 全席が同じ macOS の利用者で動くので、同じ uid の悪意ある process は防げない。この規則は帰属の正しさの検査で、敵対者への防御ではない。秘密は保存の前の redaction が担う（今のまま）。

## 2. 今の規則が取り込みを止めた理由（事実）

- (a) transcript の全 record の cwd が hook の cwd と一致しないと不一致にする。本物の会話は Bash の cd のたびに record の cwd が変わる（この会話で 6 種）。
- (b) projects の下の dir 名を、hook の cwd から符号化して照らす。Stop の時点の cwd は起動の dir と違いうる。
- 結果: `session_mismatch` で 0 件（2026-11-11 に、据えてある版を本物の transcript に隔離した置き場で流して確かめた）。

## 3. 規則（fail-closed）

| 規則 | 内容 | 実装での形 |
|---|---|---|
| R1 | 正本は hook の入力の `session_id` と `transcript_path`。hook の `cwd` は身元に使わない。path を cwd から組み立て直さない。 | Claude では `cwd` の包含の検査（`workspace_mismatch`）と、binding の cwd の検査を行わない。 |
| R2 | `realpath(transcript_path)` が `realpath(projects)` の直下の 1 つの dir の中の regular file。最後の要素は symlink でない。持ち主は今の uid。file 名は `<session_id>.jsonl`。 | 置き場の判定 `checkClaudeTranscriptPlacement`。symlink・regular file でない = `not_regular_file_or_symlink`。深さが 2 でない（subagent の file など）・projects の外・持ち主が違う = `path_outside_projects`。file 名違い = `basename_mismatch`。 |
| R3 | dir 名は、席が宣言した起動の dir の符号化。宣言は席の設定に 1 か所（hook の command の `--workspace`、起動 script と同じ値）で、hook は読むだけ。推定しない。 | `encodeClaudeProjectDir(workspace)`（英数字以外を `-` にする。実在の dir で確かめた形の例: `/Users/example/.hidden/workspace` → `-Users-example--hidden-workspace`）。違えば `projects_dir_mismatch`。2 か所から起動する席の宣言の一覧は今は作らない（S2。3 例目で）。2 か所目から起動した席は `projects_dir_mismatch` で止まり、受領に理由が残る。 |
| R4 | sessionId を持つ全 record が `session_id` と一致。持たない record は、取り込まない種類の一覧にある物だけ許す。 | 一覧 = `file-history-snapshot`・`file-history-delta`・`summary`。1 件でも違えば `record_session_mismatch`、一覧にない種類で sessionId が無ければ `record_session_missing`（file 全体を取り込まない）。一致する record が 1 件も無い時も `record_session_missing`。 |
| R5 | record の cwd は身元の条件にしない。受領に数として残す。 | 受領に `cwd_kinds`（cwd の種類の数）と `records_outside_workspace`（席の workspace の外の cwd を持つ record の数）を足す。門ではない。 |
| R6 | sidechain／subagent を取り込むかを明示する。 | 取り込む: sessionId が一致する `isSidechain` の record（今の ingest のまま。ほかと同じ R4 で判定）。取り込まない: `<session_id>/subagents/` の下などの別の file（R2 の深さで `path_outside_projects`）。sessionId が違う sidechain の record は不一致として file 全体を拒む。 |
| R7 | 結果は 3 値。 | 下の 4 節。 |
| R8 | 冪等。 | 今の dedup（`source_event_id` = `<sessionId>:<uuid>`）のまま。試験で 2 回流して重ならないことを確かめる。 |
| R9 | 決めた例を試験にする。 | 6 節。 |

## 4. 結果の 3 値

| 値 | `status` と `reason` |
|---|---|
| 取り込んだ | `captured` + `captured` |
| 拒んだ（理由コード） | `skipped` + `path_outside_projects`・`not_regular_file_or_symlink`・`basename_mismatch`・`projects_dir_mismatch`・`record_session_mismatch`・`record_session_missing` |
| 観測できず | `failed_open` + `parse_error`（中身があるのに 1 件も読めない）。読めない・動いている・大きすぎるは今の `skipped` の理由（`transcript_unavailable`・`transcript_unstable`・`transcript_too_large`）のまま。 |

観測できずは成功に数えない（S5）。受領は純粋な `receiptOutcome(result)` で `ingested | refused | unobserved` に分け、stop の hook の証拠に `outcome` として出す。

## 5. 判定の形（S4）

- 純粋な核（`src/claude-transcript-identity.ts`）: 符号化、record の判定 `judgeClaudeRecords(raw, session_id, workspace_roots)`、`receiptOutcome`。時刻・環境・file を読まない。
- 置き場の判定は、file を読む部分（lstat・realpath）に今の uid と projects の根を引数で渡す。
- `src/session-start-auto-receive.ts` は Claude の時だけ新しい流れに入る。ほかの host の流れは変えない。

## 6. 試験（R9）

- 正例 1: 本物の形の transcript（cwd 6 種以上、sessionId は全部同じ、sidechain の record を含む）→ 取り込む。受領に `cwd_kinds` ≥ 6。
- 正例 2: hook の cwd が起動の dir と違う（cd の後の Stop）→ 取り込む。
- 負例 5: file 名が session_id と違う／1 record だけ別の sessionId／別の workspace の dir の下の file／projects の dir の中の symlink が外の file を指す／regular file でない。
- 追加: subagent の file の位置、sessionId の無い record（一覧の種類は許す・一覧にない種類は拒む）、全部読めない file（`parse_error`）、2 回流して重ならない、Stop の hook の証拠に理由と `outcome` が出る。
- 可能なら、この席の実 transcript（redaction 後）を正の対照にする（読み取りの確認のみ。CI には入れない）。

## 7. 採った判断と採らなかった代替（deviation_ledger に 1 行ずつ）

- 採った: 置き場 + file 名 + 全 record の sessionId で帰属を決める。record ごとの cwd は数として残す。
- 採らなかった A: cwd が席の workspace の中にあること（包含）。cd で /tmp・別 repo へ出る正当な会話を弾き、session_id に勝る守りを足さない。
- 採らなかった B: 今のまま。取り込みが 0 のまま（FR8 の目的に反する）。

## 8. 変えない物

席の hook の差し替え（据え付け）、常駐の差し替えや停止、DB の作り、Codex・Gemini・Antigravity の規則、取り込みの dedup。席の hook の差し替えは arc-sec の確かめと Owner の決定を受ける別の段。

## 9. 残る危険

- Claude Code の版が符号化の決まりを変えると、取り込みが `projects_dir_mismatch` で止まる（黙って通さない。受領に理由が残る）。
- 同じ uid の悪意ある process は防げない（1 節）。
- tail の取り込み（Stop の hook）は、先頭 256 KiB と取り込む末尾を判定する。取り込む物は必ず判定に入る。
