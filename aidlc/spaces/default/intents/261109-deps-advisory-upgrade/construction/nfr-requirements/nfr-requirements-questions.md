# 機能以外の要件 — 質問

承認された要件（`inception/requirements-analysis/requirements.md`）と、今の技術の一覧（`aidlc/spaces/default/codekb/agent-memory/technology-stack.md`）を受けて、機能以外の要件を書きます。この段で Owner に新しく聞くことはありません。決まっていることから書く中身を下にまとめたので、書く前に要約だけ確かめてください。

勧告の中身（番号・題名・重さ・内容）は書きません。部品の名前と版だけを書きます（Issue #339）。

## 決まっていること（聞き直さない）

- 振る舞いを変えない。プログラムと依存に関わる差分は package.json と package-lock.json だけ（要件の NFR1）
- 勧告の中身を公開しない。番号の形の検索と、監査の席の目の確かめ（NFR2）
- 外への通信を増やさない。本番の server は stdio のまま（NFR3）
- 入れる前に確かめる。直した後の本番の依存の点検が 0 件、新しく入る部品は `npm audit fix` が選んだ物だけ（NFR4）
- 統合の commit を戻せば 1 回で戻る（NFR5）
- 網羅率は Node に組み込みの道具で測る。測れない時は測らず、deviation_ledger に 2 行を書く（OD-KUSABI-DEPS-UPGRADE-COVERAGE-NOT-MEASURABLE-DEVIATION-20261109-001、https://github.com/watchout/agent-memory/issues/339#issuecomment-6732638457 、本文の SHA-256 `c14ce4435ce6c2860f5d613f166a3ad19f8306ec4c99fce2c4a07012d1493989`）
- 要件の段の承認の時に Owner が「次の段で直してかまいません」とした 3 つの細かい直しは、この段の文書で扱う（下の要約の最後の 3 行）

## この段で確かめた事実

- 今の package-lock.json と、版上げを試した写しの package-lock.json は、どの部品も `registry.npmjs.org` から取り、どれにも中身の照合の値（integrity）がある（今 145 件・上げた後 147 件、照合の値が無い物 0 件）
- package-lock.json の先頭の項（`packages[""]`）には、package.json の engines（今は `>=18.0.0`）と dependencies の写しがある。engines を Node 20 以上に改めると、ここも変わる
- `scripts/test-kusabi-content-addressed-runtime-release.mjs` は package.json の `name` が `wasurezu` かだけを見て、lock は読まない。`scripts/build-kusabi-content-addressed-runtime-release.mjs` は package.json と package-lock.json の SHA-256 を動かした時に数えて記録し、決まった値を持たない

## Consolidated Summary Confirmation

- 速さ・規模: 版上げで速さや扱える量の目標は変えない。今の試験の時間の決まり（試験の中の待ち時間）のまま通ることを確かめる。新しい目標は作らない
- 安全: 本番の依存の勧告が 0 件・版の固定・新しい部品は `npm audit fix` が選んだ物だけ・どの部品も `registry.npmjs.org` から取り照合の値がある、の 4 つを確かめる。勧告の中身は番号の検索と監査の席の目で確かめて書かない。本番の server は stdio のままで、外への通信を増やさない
- 壊れた時: 統合の commit を戻せば 1 回で戻る。CI の Node 18 の回が落ちたら、この PR では直さず、Node 18 を外す workflow の PR を先に出す
- 見える化: 証拠は PR の本文に載せる（直した後の点検の結果、手元の試験の結果、網羅率の数字か測れなかった時の 2 行、退行の試験を足さない 2 行）。動いている席の見張りは変えない
- 技術の決まり: 上げる先の版と固定する版は要件のとおり。Node は 20 以上。Node 18 のままにする案・範囲指定を残す案・部品を上書きして古い版に留める案は採らない
- 細かい直し（差分の条件）: package-lock.json の先頭の項の engines と dependencies の写しが変わることを、差分の条件に数える
- 細かい直し（伺う範囲）: 版上げの後に型検査・試験のどれかが落ち、package.json と package-lock.json 以外を変えないと通らない時は、部品を限らず、変える前に Owner に伺う
- 細かい直し（未決の問い）: 版の公開の試験が package.json・package-lock.json の中身に依るかの問いは、上の事実で閉じる（名前だけを見て、SHA-256 は動かした時に数える）。コードを書く段の試験の結果でも確かめる

Does this all look correct before I generate the NFR requirements artifacts?

- Looks correct
- Request changes

[Answer]: Looks correct
