# Requirements Analysis — 質問（取り組み 261113-store-resolution-fix）

この質問の答えは、AI-DLC の決まりどおり、Owner の判断が要る問いは Owner の言葉のまま、守る物でない問いは Owner の委任（https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6762288830）に基づく arc の答えとして書く。`[Answer]:` は空けてあり、選択肢に勧めは付けていない。

## すでに決まっている物（質問にしない）

- 直す不具合（依頼の文）: Stop の hook（`session-rotation-stop`・`transcript-stop-capture`）が保存先を環境変数だけで決めるため、設定 file に接続先がある席でも既定の SQLite を開き、壊れた file に当たって保存に失敗する。
- 保存先の決め方は、環境変数、設定 file（`~/.agent-memory/config.json`）の `database_url`、既定の SQLite の順にし、共有の 1 つの関数にする。SessionStart（Claude・Codex・Gemini・Antigravity の 4 種）・rotation-stop・transcript-stop が同じ関数で決める。Codex の席の Stop 側も同じ入口なので同じ直しに入る（コードを読んだ事実。Reverse Engineering の記録）。
- 設定 file が読めない（壊れている・形が違う）時は失敗として扱い、黙って既定の SQLite に落とさない（fail-closed）。
- DB の構造は変えない。壊れた `memory.db` には触れない（動かすかどうかは、直した版が入った後に別に決める）。
- 試験で確かめる 3 つ: (1) 3 つの hook が同じ環境で同じ保存先を決める、(2) 設定 file だけがある時に Stop が PostgreSQL を選ぶ、(3) 設定 file がある時は既定の SQLite を選ばない。
- 席の設定・hook・見張り・本物の DB・tmux には、この取り組みの中で何も実行しない。席への適用は、Owner が arc の script を打つ形のまま。

## Q1. [開発者] 保存先を決める共通の部品に、post-tool-hook と rotation-commit を入れるか

背景: 依頼は、SessionStart・rotation-stop・transcript-stop を共通の部品に載せ替えることまでを決めています。残る 2 つを入れるかは、設計の記録に理由つきで残す約束です。読んだ事実は次のとおりです。
- `post-tool-hook`（応答の後に記録を書く hook。installer は登録しない）は、設定 file の別の項目（`agent_id`・`default_project`）も読み、環境変数 `DATABASE_URL` を書く、別の決め方を持つ。
- `rotation-commit`（SessionStart の回答の後に確定する処理）は、今は自分で `createStore` を呼ぶ。同じ process の SessionStart が環境へ書いた URL を引き継ぐ形で動いている。

選択肢:
- A. 両方を載せ替える（`post-tool-hook` も共通の決め方に変え、`rotation-commit` は SessionStart が決めた結果を引数で受け取る）
- B. `rotation-commit` だけ載せ替える（結果を引数で受け取る）。`post-tool-hook` は入れず、「installer が登録せず、今回の失敗の経路に無い」という理由を設計の記録に 1 行書く
- C. 両方入れない（共通の部品を使うのは SessionStart・rotation-stop・transcript-stop だけ）。理由を 1 行ずつ設計の記録に書く
- X. Other (please specify)

[Answer]: B。rotation-commit だけ共通の決め方に載せ替える。post-tool-hook は「installer が登録せず、今回の失敗の経路に無い」理由を 1 行書いて入れない。同じ判断が 2 か所にある形（標準 S3）は持ち越しとして記録に残し、post-tool-hook を次に触る時に直す。
（arc の答え。Owner の委任 #49 6762288830。Owner の言葉ではない。2026-11-15T23:00:14Z、**Mode:** chat）

## Q2. [Owner・保護面] 本番の PostgreSQL に、Stop が保存に使う表と列があるかを、どう確かめるか

背景: 直した Stop の hook が PostgreSQL に保存する時に使う表と列（引き継ぎの保存と会話の記録）が本番にあることを、DB の基準の形で記録に残す約束です。本番の DB に接続するには資格情報を使うので、保護面（本番・資格情報）にあたり、Owner の許可が要ります。これまでの試みでは、本番の DB を読むだけの SELECT も自動の判定で断られました。

選択肢:
- A. 本番の DB には触れない。repo の表の変更（`pg-migrations`）から必要な表と列を導き、使い捨ての PostgreSQL で保存の経路が通ることを試験で確かめて記録に書く。本番に同じ表があるかは、席へ適用する前の確認として別に Owner と arc が見る
- B. 本番の DB を読むだけで確かめる（`information_schema` の SELECT だけ。書かない・表の変更を流さない）。使う資格情報は名前だけを記録に書き、値は書かない。この資格情報の使用を、Owner がここで許可する
- C. Owner が本番で自分で確かめ、結果（表と列の名前だけ。行の値は含まない）を渡す。渡された名前を記録に写す
- X. Other (please specify)

[Answer]: 「63: Kusabi の store-resolution-fix の Q2 は A（本番に触れない。repo の表の変更から導き、使い捨ての PostgreSQL で保存の経路を試験で確かめて記録に書く。本番にあるかは、席へ当てる前の確認として別に見る）」
（Owner の答え。arc の端末の会話で受けた原文のまま、端末の折り返しの改行だけ外してある。arc 経由、決定 #49 6762150181 の形。2026-11-15T23:04:02Z に写した、**Mode:** chat。この取り組みの中では本番に触れない。本番にあるかの確かめは、席へ当てる前に Owner と arc が別に見る。）

## Q3. [運用] Stop 側の証拠（stderr の JSON）に、決めた保存先の種類と根拠を足すか

背景: 今の Stop の 2 つの hook の証拠は、保存先を名指さない項目しか持たず、別の保存先に書いても成功として終わります（Reverse Engineering の記録）。足すなら、保存先の種類（`postgres`・`sqlite`・`json`）と、決めた根拠（環境変数・設定 file・既定のどれか）だけを足し、URL や file の path は書きません。足すと証拠の形が増えるので、この証拠を読む別の道具（席の状態の表示など）の確かめが 1 つ増えます。

選択肢:
- A. 足す（種類と根拠だけ。URL・path は書かない）
- B. 足さない（証拠の形は今のまま。保存先が同じことは試験だけで確かめる）
- X. Other (please specify)

[Answer]: A。Stop 側の証拠の JSON に、保存先の種類（postgres・sqlite・json）と根拠（環境変数・設定 file・既定）だけを足す。URL・path・値は書かない。実際の動きで正しい保存先を選んだことを確かめる証拠にする（標準 S5）。
（arc の答え。Owner の委任 #49 6762288830。Owner の言葉ではない。2026-11-15T23:00:14Z、**Mode:** chat）

## Q4. [開発者] 設定 file があるが `database_url` が無い時、既定の SQLite を選んでよいか（追加の問い）

背景: 「すでに決まっている物」の試験 (3)（設定 file がある時は既定の SQLite を選ばない）と、今の SessionStart の動きが食い違って読めるため、確かめます。今の SessionStart（`resolveCodexStoreBinding`）は、設定 file があっても `database_url` の項目が無ければ、既定の SQLite を選び、設定 file の path の digest だけを証拠に載せます。設定 file には `agent_id`・`default_project` など別の項目だけを持つ席もあります（`post-tool-hook` がそれらを読む）。環境変数の種類が `postgres` と明示されている時は、この場合は失敗になります。

選択肢:
- A. 今のとおり。`database_url` が無ければ既定の SQLite を選ぶ（根拠は「既定」）。試験 (3) は「`database_url` を持つ設定 file がある時は既定の SQLite を選ばない」と読む
- B. 設定 file があって `database_url` が無い時も、既定の SQLite に落とさず失敗にする（保存先を決められない）。別の項目だけを持つ設定 file の席は、設定を直すまで保存できなくなる
- X. Other (please specify)

[Answer]: A。今のとおり、`database_url` が無ければ既定の SQLite（根拠は「既定」）。試験 (3) は「`database_url` を持つ設定 file がある時は既定の SQLite を選ばない」と読む。この読み方を requirements.md に 1 行書く。
（arc の答え。Owner の委任 #49 6762288830。Owner の言葉ではない。2026-11-15T23:03:22Z、**Mode:** chat）

## Q5. [開発者] `createStore()` を直接呼ぶほかの入口（MCP サーバーなど）を、この取り組みで共有の決め方に入れるか（追加の問い）

背景: 依頼が入れると決めたのは SessionStart（4 種）・rotation-stop・transcript-stop と、Q1 の答えの rotation-commit です。ほかに、環境変数だけで決める `createStore()` を直接呼ぶ入口があります（席の MCP サーバー `src/index.ts`、旧来の起動の口 `src/boot.ts`、launcher の `claude-start`・`codex-start`、`restart-cli`、`kusabi-fleet-status-cli`）。設定 file にだけ接続先がある席では、これらも既定の SQLite を開く形になりえます（席の起動の環境は読んでいないので、実際の席で起きるかは確かめていません）。載せ替えると、動いている席の MCP の道具の保存先が変わりうるので、席への適用は別の確認が要ります。

選択肢:
- A. 入れない。対象は依頼の入口だけにし、ほかの入口は「同じ食い違いがありうる」持ち越しとして、理由と確かめる方法を添えて記録に書く
- B. `createStore()` 自体を共有の決め方に載せ替え、環境変数だけの入口も設定 file を読む（全部の入口が同じ決め方になる）
- C. 席の MCP サーバー（`src/index.ts`）だけ入れる。ほかは持ち越しとして記録に書く
- X. Other (please specify)

[Answer]: A。この取り組みは依頼の入口だけにする。ほかの `createStore()` の入口（`src/index.ts`・`boot.ts`・`claude-start`・`codex-start`・`restart-cli`・`kusabi-fleet-status-cli`）は「同じ食い違いがありうる」持ち越しとして、理由と確かめ方（席の起動の環境を読む・どの保存先を開いたかの証拠）を添えて記録に書く。動いている席の保存先を変える載せ替えは、別の取り組みで席への適用の確かめと一緒に扱う。
（arc の答え。Owner の委任 #49 6762288830。Owner の言葉ではない。2026-11-15T23:03:22Z、**Mode:** chat）

## Q6. [開発者] 直した Stop が保存した引き継ぎを読む側（`restart-cli` の `handoff-source` と、引き継ぎの束を読む枝）を、この取り組みで共有の決め方に入れるか（追加の問い）

背景: Q5 の答えで、`restart-cli` は「持ち越し」の 1 つに入っています。ただ、コードを読み直すと、`restart-cli` の 2 つの口は、rotation-stop が保存した物を読む側でした。
- `handoff-source`（読むだけの口）は、rotation-stop が `saveTaskState` で書いた引き継ぎの文を、保存先から読み戻します。保存先は `src/stores/read-only-task-states.ts` が環境変数だけで決めます。
- `fetch`（引き継ぎの束を読む・使い終わりにする枝）と `prepare` は、`createStore()` を呼び、環境変数だけで保存先を決めます。
今は書く側（Stop）も読む側も環境変数だけで、同じ保存先を見ています（食い違っているのは SessionStart だけ）。直すと、設定 file にだけ接続先がある席では、書く側（Stop）は PostgreSQL、読む側（`handoff-source`）は既定の SQLite を見る形になりえます。直したことで、書く側と読む側が別の保存先になる組が新しくできる、という意味です。席の起動の環境は読んでいないので、実際の席で起きるかは確かめていません。

選択肢:
- A. 入れない（Q5 の答えのまま）。「直したことで書く側と読む側が分かれうる」持ち越しとして、理由と確かめ方（席の起動の環境に接続先があるか・どの保存先を読んだかの証拠）を記録に書き、席へ適用する前の確認に入れる
- B. `restart-cli` の 2 つの口（`handoff-source` の読むだけの口と、`createStore()` を呼ぶ枝）だけを共有の決め方に入れる。ほかの入口は Q5 のまま持ち越す
- C. `handoff-source` の読むだけの口だけ入れる（書き込みを伴う `fetch --consume` と `prepare` は持ち越す）
- X. Other (please specify)

[Answer]: B。`restart-cli` の 2 つの口（`handoff-source` の読むだけの口と、`createStore()` を呼ぶ `fetch`・`prepare` の枝）を、Stop と同じ共有の決め方に入れる。理由: 書く側だけを直すと、設定 file にだけ接続先がある席で、書いた引き継ぎを読む側が別の保存先を見る形になりうる（記録の欠け = 重大）。同じ判断を 1 か所に置く（標準 S3）。ほかの入口（`src/index.ts`・`boot.ts`・`claude-start`・`codex-start`・`kusabi-fleet-status-cli`）は Q5 のまま持ち越す。試験に「書いた保存先と読む保存先が同じ」を 1 つ足す（設定 file にだけ接続先がある形で）。
（arc の答え。Owner の委任 #49 6762288830。Owner の言葉ではない。2026-11-15T23:08:43Z、**Mode:** chat）

## Q7. [開発者] RE の記録（codekb）の「読んだ版」の label と、読んだ file の内容が食い違う時、どちらを正本にするか（追加の問い。要件の OQ3）

背景: RE の知識の置き場（codekb）は、読んだ版を `aa77b683…`（手元の branch の HEAD）と書いています。ところが、読んだ file の内容は 27d7f8f のものです（`rotation-commit.ts`・`read-only-task-states.ts`・`rotation-handoff-source.ts` は `aa77b683…` には無く、27d7f8f にあります）。手元の作業場は dirty で local branch が古いため、HEAD は読んだ file と一致する保証がありません。`src`・`scripts`・`package.json`・`.github`・`docs/operations` が 27d7f8f と byte 単位で同じことは、2026-11-15T23:08:29Z に突き合わせて確かめました。

選択肢:
- A. 承認済みの RE の記録の label は直さない（RE の段へ戻さない）。読んだ版の正本は、要件の AS1 と OQ3（27d7f8f、byte の突き合わせ）とし、作る段の監査の依頼にも「読んだ版 = 27d7f8f」と書く
- B. RE の段へ戻して label を 27d7f8f に直す（承認済みの段のやり直しになる）
- X. Other (please specify)

[Answer]: A。承認済みの RE の記録の label は直さず、読んだ版の正本は要件の AS1 と OQ3（27d7f8f、2026-11-15T23:08:29Z の byte の突き合わせ）とする。作る段の監査の依頼にも「読んだ版 = 27d7f8f」と書く。
（arc の答え。Owner の委任 #49 6762288830。Owner の言葉ではない。要件の承認の時に受けた答えを、2026-11-15T23:33:41Z に写した、**Mode:** chat）
