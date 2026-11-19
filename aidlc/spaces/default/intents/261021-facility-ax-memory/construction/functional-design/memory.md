<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-23T01:33:37Z — U1: 共通基盤の配布物の取り込み方と Node の版は、この段階の質問にせず後の NFR・基盤の段階に回した; Functional Design は技術に依らない振る舞いの設計で、取り込み方や版は技術の置き方のため。AUN は onza common 0.2 の SQL 3 つを変えない写しで置き sha256 を試験で確かめ、Node 22 以上を求めている（aun feature/bootstrap 2f9c204d）ことを先に確かめた。
- 2026-10-23T01:33:37Z — U1: 割り当ての状態（draining・期限切れ）の扱いを、共通基盤の取り決めの意味のまま使う既定にした; 使う側が判定の意味を作り直さない決まり（設計・実装の標準 S2）と、共通基盤 contract.md の「draining・期限切れは新規効果に使えない」のため。

- 2026-10-23T01:44:43Z — U1: 共通基盤の失敗の理由（OC001〜OC011）を Kusabi の失敗の名前に写す表を決まり BR2.5 に置いた; 共通基盤の manifest に失敗の一覧があり、写し方を 1 か所に置かないと部品ごとに読み替えがばらけるため（設計・実装の標準 S3）。
- 2026-11-19T01:40:00Z — U1（再開）: 10-22 以後の差分は、承認済みの 4 つの file を書き換えず、新しい記録 `store-resolution-delta.md` に書いた; arc が reopen の道と「承認済みの段の file は書き換えない」を決めた（arc の判断。決定 95 による委任で、Owner の言葉ではない）。承認済みの段の file を書き換えると段の有効性の確かめが動くため（2026-11-18 の学び）。
- 2026-11-19T01:40:00Z — U1（再開）: 差分の比べ相手は手元の HEAD でなく origin/main の bd98a10 にした; 作業場は dirty で local branch が古いため（2026-11-15 の学び）。

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-10-23T01:44:43Z — U1: 受入の条件の数を owner に 26 個と伝えたが、数え直すと 25 個だった; 話ごとの条件の数を足し間違えたため。追跡（traceability.json）は 25 個で書き、owner に訂正を伝えた。
- 2026-11-19T01:40:00Z — U1（再開）: 段の手順は entities・rules・functional-spec・traceability を出すが、今回は新しい差分の記録 1 つだけを足し、4 つは再生成しなかった; 食い違い 3 件（DL-1〜DL-3）の直し方が未決で、承認済みの決まりを黙って書き換えないため。traceability.json の対応の表は変えていない（差分の記録は決まりの ID BR1.1〜BR1.4 に当てて書いた）。

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-11-19T01:40:00Z — U1（再開）DL-2: 共通基盤の形の置き場所の読み手を、`decideStore` に mode の引数を足す案でなく、入口を 1 つにして共通基盤の形だけ別の読み手を呼ぶ案（席の勧め）にした; #347 で監査を通した核の契約と全 hook の試験を動かさず、今の席の振る舞いも変えない（BR6.1）ため。採らなかった代替 = `decideStore` への mode の引数（核の契約が変わる）。決めるのは arc（DL-1 に従う）。

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-11-19T01:40:00Z — U1（再開）DL-1: `AGENT_MEMORY_MODE` が無い時の既定（承認済み = `AGENT_MEMORY_DATABASE_URL` があれば共通基盤の形）は、今この設定で PostgreSQL に動く席の単独の形と食い違う。案 (a) MODE を共通基盤の形に入る唯一の条件にする（席の勧め）／(b) 承認済みのまま、棚卸しと全席への MODE の明示。arc の決めを待つ（契約の設定に当たる）。
- 2026-11-19T01:40:00Z — U1（再開）DL-3a: 「Kusabi 専用の設定」に user config の `database_url` を含めるか。読み戻しの記録（#49 6994974235）は 2 席とも source = user_config。案 (a) 含める（席の勧め）／(b) 環境だけ。arc の決めを待つ。
- 2026-11-19T01:40:00Z — U1（再開）: 守る物（DB の構造・権限・資格情報）に触れるので、作る段の前に設計の記録だけの PR と独立の設計監査 1 回が要る（team.md）。#341・#342・#344 の中身は読んでいない（作る段の計画の時に該当 file を読み直す）。
