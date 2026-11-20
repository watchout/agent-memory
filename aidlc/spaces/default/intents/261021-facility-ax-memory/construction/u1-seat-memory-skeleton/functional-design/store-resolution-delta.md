# U1 薄い一本の振る舞いの設計 — 10-22 以後の差分の取り直し

- 単位: U1 u1-seat-memory-skeleton
- なぜ書くか: Kusabi の Intent を 1 つに寄せる（決定 132）ために Int1 を再開した。engine の警告（読み解きの file が RE の後に変わった）に対し、arc が functional-design を reopen する道を決めた（arc の判断。決定 95 による委任で、Owner の言葉ではない）。承認済みの `entities.md`・`rules.md`・`functional-spec.md`・`traceability.json` は書き換えず、食い違いはこの記録に書く。
- 比べた相手: origin/main の bd98a10（2026-11-19）。Int1 の RE は 2026-10-22 08:14Z。その後に main へ入った PR は #340・#341・#342・#343・#344・#345・#347・#348 の 8 件。
- 結論: 承認済みの決まりと食い違う所が 3 つ（DL-1〜DL-3）、作り直さずに呼ぶ所が 4 つ（DL-4〜DL-7）。U1 の共通基盤の code は main に 0 件（`AGENT_MEMORY_MODE`・共通基盤の理由の名前とも 0 件）なので、ずれは設計だけで、作り直す code は無い。

## Sources

- 読んだ（全文）: `src/store-resolution.ts`（main の bd98a10、240 行）、U1 の `rules.md`・`functional-spec.md`・質問 file、契約の `contract-summary.md` の設定の節。
- 読んだ（検索だけ）: main の `src` での `AGENT_MEMORY_MODE`・`AGENT_MEMORY_AGENT_ID`・`AGENT_MEMORY_DATABASE_URL` の出現、`store-resolution.js` を取り込む file の一覧、`createStore` を呼ぶ入口。
- 読んでいない: #341・#342・#344（回転・hook の入力の読み・引き継ぎの確定の順）の中身。commit の題名と、取り込み先の file 名だけを見た。

## 食い違い（承認済みの決まりを直す必要がある。直し方は未決）

### DL-1 形の既定（BR1.2・契約の `AGENT_MEMORY_MODE`）

- 承認済み: `AGENT_MEMORY_MODE` が無い時は、`AGENT_MEMORY_DATABASE_URL` があれば共通基盤の形、無ければ単独の形（契約の設定の節）。単独の形は「手元の SQLite」と書いてある。
- main の実際: `AGENT_MEMORY_DATABASE_URL` は、今すでに PostgreSQL の store を指す設定で、`src/stores/index.ts`・`src/codex-start.ts`・`src/kusabi-fresh-session-fleet.ts` が名指しし、`decideStore` も環境の最初の候補にしている。単独の形は sqlite・json・postgres の 3 つで、user config の `database_url` も候補。
- 食い違い: MODE が無い席が今 `AGENT_MEMORY_DATABASE_URL` で動いていると、承認済みの既定では共通基盤の形に切り替わり、共通基盤の置き場を探して not_initialized になる。BR6.1（単独の形は変えない）と同時には成り立たない。
- 案 (a)（席の勧め）: MODE を共通基盤の形に入る唯一の条件にする。MODE が無い時は今の振る舞い（`decideStore` の結果）のまま。社内の席の起動の設定は、契約の定めのとおり `AGENT_MEMORY_MODE=common` を必ず書く。
- 案 (b): 承認済みのとおり。今 `AGENT_MEMORY_DATABASE_URL` で動く席の棚卸しと、全席への MODE の明示が展開の前に要る（契約の段が残した未決 C3 の延長）。
- 持ち越し先: 契約（公開の設定）の変更に当たるので、arc の決め。

### DL-2 専用の設定だけを読む（BR1.1）

- 承認済み: 共通基盤の形は `AGENT_MEMORY_DATABASE_URL` だけを読み、汎用の `DATABASE_URL` は読まない。
- main の実際: `decideStore` は環境の候補を `AGENT_MEMORY_DATABASE_URL || DATABASE_URL` の順で読む。
- 食い違い: 共通基盤の形は `decideStore` をそのまま通せない。
- 案 (a)（席の勧め）: 形の判断を 1 つの入口にまとめる（MODE が common なら共通基盤の置き場の読み手、それ以外は今の `decideStore`）。`decideStore` には触れない（#347 で監査を通した核の契約を動かさず、今の席の振る舞いも変えない = BR6.1）。「どの store を開くか」の判断が 2 つに見える点は、入口を 1 つにして、共通基盤の形の読み手が `decideStore` の結果の型（`StoreResolution`）と資格情報の包み（DL-5）を使う形で抑える。設計・実装の標準 S3 の外れ方として、作る段の記録に「採った判断・採らなかった代替」を 1 行ずつ書く。
- 案 (b): `decideStore` に mode の引数を足す。#347 の核の契約が変わり、全 hook の試験がまた対象になる。席の勧めではない。
- 持ち越し先: 作る段の計画（設計の判断の範囲）。DL-1 の決めに従う。

### DL-3 設定の置き場と、ほかへ逃げないこと（BR1.3・BR1.4・FR5.3・FR5.5）

- 承認済み: 共通基盤の形で専用の設定が無ければ placement_unset で止まり、届かなくても SQLite に書かない。
- main の実際: `decideStore` は、環境にも user config にも無い時、最後に local_default（sqlite）を返す。user config の `database_url` も候補で、読み戻しの記録（#49 6994974235、本文 SHA-256 `7744ede7…`）は、2 席とも「backend = postgres、source = user_config」と書いている（席 B は印が無く、読み戻しは観測できず）。
- 食い違い 1: 共通基盤の形では local_default を選ばせてはならない。入口（DL-2）で、common の時は「専用の設定が無い = placement_unset」にする。
- 未決 DL-3a: 「Kusabi 専用の設定」に user config の `database_url` を含めるか。承認済みの文は環境の `AGENT_MEMORY_DATABASE_URL` だけを名指しする。起こす側（launcher）が環境の値を渡すかは、10-22 の読み解きでも確かめていない（`dependencies.md`）。
  - 案 (a)（席の勧め）: 含める。環境 → user config の読み順を `decideStore` と同じにし、BR1.1 の文を「専用の設定 = 環境の `AGENT_MEMORY_DATABASE_URL` と user config の `database_url`（汎用の `DATABASE_URL` は含めない）」に直す。書き手と読み手を同じ入口に束ねる（2026-11-15 の学び）ためと、今の 2 席が user config で届いているため。
  - 案 (b): 環境だけ。launcher が毎回渡す保証が要る。
- 持ち越し先: 契約（公開の設定）に当たるので、arc の決め。

## 作り直さずに呼ぶ所（設計・実装の標準 S2・S3）

- DL-4 失敗の名前の写し: main の `store_refused` の理由（unknown_db_type・env_url_shape・config_kind・config_read・config_content・target_missing）は、U1 の失敗の名前へ写すだけにする（意味を作り直さない = BR2.5 と同じ形）。写しの案: target_missing → placement_unset、unknown_db_type・env_url_shape・config_content → invalid_input、config_kind・config_read → placement_unreachable。表は NFR・基盤の段か作る段の計画で確定する（案であって決めではない）。
- DL-5 資格情報の包み: `StoreTarget`（`reveal()` のほかは固定の語しか出さない）が、BR5.2 の「URL を失敗の文・応答・記録に出さない」をすでに満たす。U1 は同じ包みを使い、新しい包みを作らない。
- DL-6 置き場所の digest: `storeBindingSha256` は、URL を書かずに「どの置き場所か」を言う証拠を作れる。U1 の呼出しの記録は変えない（BR5.1: 名前・ID・時刻・結果だけ）。起動の口の証拠に使うかは、後の段で決める。
- DL-7 書き手と読み手の入口: #347 の後、SessionStart の口（Claude Code・Codex・Antigravity が `resolveSessionStartStore` 経由。Gemini は読んでいない）・Stop の 2 つの hook（`session-rotation-stop.ts`・`transcript-stop-capture.ts`）・回転の確定（`rotation-commit.ts`、型のみ）・restart-cli・runtime-event の worker が `decideStore` の結果を共有する。MCP サーバーの入口（`src/index.ts` の `createStore`）と `boot.ts`・`claude-start.ts`・`codex-start.ts` は共有の外で、環境だけから決める。共通基盤の形では、道具（W2・W3）と起動の口（W4）が同じ入口を使わないと、書いた先と読む先が食い違う。作る段の計画に、この 3 つの入口を対象 file として入れる（PR の見込みの行数に効く）。

## 変わらない所

- BR2.x（席の確かめ）・BR3.x（決定の記録）・BR4.x（起動の口の回復）・BR5.1・W1 の順序の考え方・W5 は、差分と食い違わない。
- `AGENT_MEMORY_AGENT_ID` は main の多くの入口で今も持ち主の鍵（単独の形）。BR2.7 は共通基盤の形だけを縛るので変わらない。
- 横の変更（#341 回転、#342 hook の入力の読み、#344 引き継ぎの確定の順）は、起動の口と Stop の hook の上に載る。W4 の出力の形は、それらの上に載る形のまま。仕様は食い違わない（読みの深さは「浅い」。作る段の計画の時に main の該当 file を読み直す）。

## 守る物の判断（作る段の前に要る確かめ）

- U1 は、DB の構造（Kusabi の置き場の作成、W6 の手順 2）・権限（席の確かめ、BR2.x）・資格情報（BR5.2）に触れる。team.md の決まりにより、設計の 4 段を終えたら、設計の記録だけの PR を先に出して独立の設計監査を 1 回通し、code はその PASS の後に書く。
- 設計の記録の `deviation_ledger` に、DL-2 の「採った判断・採らなかった代替」を書く（S3）。DB の構造の節は、社内の DB の基準（版 0.10）に従う。

## 決めた文（DL-1・DL-2・DL-3a）

出典: arc の答え。arc の判断（決定 95 による委任、Owner の言葉ではない）。arc から席への連絡で受けた。GitHub にはまだ公開されていないので、権限としては引かず、決めた文の写しとして置く。

- DL-1 は案 (a): `AGENT_MEMORY_MODE` だけを共通基盤の形に入る条件にする。MODE が無い時は、今の `decideStore` のまま動かす（今動いている席の振る舞いを変えず、BR6.1 と両立する）。社内の席の起動の設定には `AGENT_MEMORY_MODE=common` を明示する。これにより、承認済みの BR1.2 の「MODE が無い時は専用の DB の設定の有無で決める」は使わない（承認済みの file は書き換えず、この記録の決めが優先する）。
- DL-2 は DL-1 に従う: 入口は 1 つにして、`MODE=common` の時だけ別の読み手が `StoreResolution`・`StoreTarget` を使う。`decideStore` には触れない。S3 の外れ方は、作る段の記録に「採った判断・採らなかった代替」を 1 行ずつ書く。
- DL-3a は案 (a): 共通基盤の形の「専用の設定」は、環境の `AGENT_MEMORY_DATABASE_URL`、次に user config の `database_url` の順で読む。汎用の `DATABASE_URL` は含めない。共通基盤の形で設定が無ければ `placement_unset` にし、sqlite に逃げない（BR1.3・BR1.4 のまま）。読み戻しの記録（#49 6994974235、2 席とも source = user_config）と合う。
- 承認済みの BR1.1 の文（「専用の設定（AGENT_MEMORY_DATABASE_URL）だけ」）は、上の DL-3a で「環境の `AGENT_MEMORY_DATABASE_URL` と user config の `database_url`」に読み替える。作る段の計画と設計の監査の項目は、この記録の読み替えを正にする。

## nfr・基盤の記録との照らし（NFR-1・NFR-2）

- 読んだ（全文）: nfr-requirements の `security-requirements.md` の NFR3.1・NFR8.1〜NFR8.3 の行、nfr-design の `security-design.md`、infrastructure-design の `infrastructure-specification.md`。
- 読んだ（検索だけ）: nfr-requirements と nfr-design の file 全部を、設定・置き場所の語（`AGENT_MEMORY_DATABASE_URL`・`AGENT_MEMORY_MODE`・`DATABASE_URL`・`database_url`・`placement_unset`・SQLite・`decideStore`）で検索した。当たったのは `reliability-requirements.md`（NFR5.3）・`observability-requirements.md`（NFR5.6）・`reliability-design.md`・`nfr-design-questions.md` と、上の 2 つの security の file だけ。
- 食い違わない: NFR5.3・`reliability-design.md`（届かない時にほかへ書かない = BR1.4 と同じ）、NFR5.6（失敗の名前）、`infrastructure-specification.md`（置き場所の設定の読み先を書いていない）。
- NFR-1 食い違い: NFR8.3 の「資格情報は環境から読む」と、`security-design.md` の「DB の資格情報は環境（`AGENT_MEMORY_DATABASE_URL`）から読み」は、DL-3a（user config の `database_url` も読む）より狭い。読み替え: 「資格情報は、環境の `AGENT_MEMORY_DATABASE_URL`、次に user config の `database_url` から読む。共通基盤の形の読み手は読むだけで、書き換えず保存しない」。URL は `StoreTarget`（DL-5）に入れ、失敗の文・起動の時の文脈・道具の応答・呼出しの記録・証拠に出さない（伏せ字の処理 `src/redact.ts` は残る）。NFR8.3 の確かめに、「user config 由来のパスワードつきの URL で DB を止めても、出力にパスワードの文字列が無い」を足す。試験は使い捨ての HOME に置いた user config で行い、実際の保存先を触らない（project.md の学び）。
- NFR-1 の扱い（決めた）: この記録の読み替えで足りる。承認済みの nfr-requirements と nfr-design の 2 段は開き直さない。設計の PR と独立の監査が同じこの記録を読むので、食い違いは隠れない（arc の判断、決定 95 による委任、Owner の言葉ではない）。
- NFR-2 user config の file に、他者が読めない権限（mode）を U1 で要求するか（決めた）: 要求しない。main の `readUserConfig` は通常の file であること・symlink でないことだけを確かめ、mode は見ない。今動く席の振る舞いを変えず（BR6.1）、新しいセキュリティの選びをしないための答え（arc の判断、決定 95 による委任、Owner の言葉ではない）。次の 2 つを足す。
  - 持ち越し: mode は 600 にそろった（Owner が絞った。arc の知らせ。席が metadata だけを読んで 600 を確かめた。中身は読んでいない）。他者が読める時に断る守りを、Int1 の Unit で足す候補。今の main の振る舞いを変えないので、U1 には入れない。
  - 試験: 「URL が残る記録（file・log・証拠・応答）に出ない」を試験で見張る（NFR-1 の確かめと同じ場面）。
- 作り直す code は無い（共通基盤の形の読み手はまだ main に無い）。
- 守る物の読み: 読み先に user config を足す文は、新しいセキュリティの選びに当たらないと読む。今の main が、この 2 席ですでに user config の `database_url` を読んでおり（#49 6994974235 の読み戻し）、設計を実物に合わせるだけのため（arc の判断、決定 95 による委任）。設計の PR の risk の段は門（sds-gate）の判定に従う。R3 以上なら、統合の前に Owner の exact-head を arc が取る。

## Assumptions & Open Questions

- 決まった: DL-1・DL-2・DL-3a・NFR-1・NFR-2 は上のとおり（arc の判断、決定 95 による委任）。
- 持ち越し（候補）: 他者が読める時に断る守り（上の NFR-2）。U1 には入れない。
- 前提: main の bd98a10 の `src` は、この記録の読みの時点から動かない。作る段の計画の時に、版の元の commit を取り直して突き合わせる。
