# 戻しの手順書（取り組み 261113-store-resolution-fix）

この文書は、席へ配った後に合わなかった時の戻しを、戻す物の種類ごとに書く。方式と止める条件は `deployment-strategy.md`、配りの手順は `cd-config.md`。戻しの原則は `KUSABI_ALPHA_FLEET_ROLLOUT.md` の 9 に従う: 戻すのは席ごとの、差し替える前の設定の bytes と hash から。`git reset --hard`・force push・広い削除・作業場の置き換えはしない。

## 1. 戻す物は 3 つで、別々に戻す

| 物 | 戻す方法 | 打つ人 | 戻しに要る許可 |
|---|---|---|---|
| 席の hook の設定（2 席） | 2 の手順 | Owner（保護面: 席の hook） | Owner の決定 3 の範囲 |
| 版の置き場（`~/Developer/.kusabi-releases`） | **戻さない。** 版は追加だけで消さず、上書きしない。使われなくなった版は置き場に残る | — | 版を消すなら、別に Owner の決定 |
| コード（統合の merge commit） | 3 の手順 | 作る席が PR を出し、作者と別の席が統合する | 通常の PR の流れ |

DB の構造は変えていない（DDL 0 行）ので、DB の戻しは無い。新しい版の間に保存された行は、戻した後も残る（消さない）。足した証拠の項目（`store_backend`・`store_source`）は足すだけなので、旧い読み手は壊れない（`requirements.md` の FR4.4・NFR7）。

## 2. 席の hook の戻し

戻す印（どれか 1 つで戻す。`deployment-strategy.md` の 4）: 観測 1 か 2 が「不一致」、`store_refused` の証拠、設定 file の hash が script の出力と食い違う、ほかの止める条件。**戻すのは、合わなかった席だけ**（Owner の決定の 3）。

差し替えの記録（https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-6911141083 ）が言う戻し（宣言された値。この席は install4.sh を読んでいない）:

- 各 file の backup（installer が差し替えの前に 1 つずつ取る）を、書いた直後の file と同じ時だけ戻す。
- または、同じ引数で、版を差し替える前の版（`5fd29e06…`。記録は先頭だけ）に替えて `--apply` する。
- 版の置き場の版は消さない。DB の表と列には触れない。

手順（Owner が打つ。席は実行しない）:

1. 止める: これ以上、束を進めない。戻す席・食い違った hash・証拠を、そのまま記録に残す。
2. 戻す席の設定 file を、上のどちらかで戻す。
3. 戻した席の設定 file の hash を、差し替える前の hash（install4 の log と #49 6911141083 の記録にある）と比べる（席が読むだけ。Q2 = B）。合えば戻り、合わなければ戻しが未完で、止めたまま Owner に出す。
4. host の process は、人が普通に閉じて起こし直す。席が自動で再起動しない。端末へ入力しない（`KUSABI_ALPHA_FLEET_ROLLOUT.md` の 9 の 5）。
5. 戻した席が、普通に使えることを確かめる。
6. 食い違いの原因を、小さな試験にして、止まった門を流し直す。再開は新しい Owner の決定が要る。

## 3. コードの戻し

- `team.md` の決まりのとおり、統合の方式は merge commit なので、戻す時は、その merge commit（`fa9f3a2f16255d723b0cb96f0e77958035f7b11e`）を戻す。branch を切り、main へ PR を出し、独立の監査を通し、作者と別の席が統合する。main へ直接 commit しない。
- 確かめた物（`build-and-test-summary.md` の BT-15）: 使い捨ての clone で merge commit を戻すと、PR が変えた file が元に戻り、base `27d7f8f` との差が 0 file になった。
- 席の hook がまだ新しい版を指している間にコードだけ戻しても、置き場の版は変わらない（追加だけ）。席の設定を先に戻してから、コードを戻す。

## 4. 戻しの試験（何を試し、何を試していないか）

「試験していない戻しは、戻しの計画ではない」（AI-DLC の知識 `deployment-strategies.md` の Manual Rollback）。次のとおり、試した物と試していない物を分ける。

| 戻しの部品 | 試したか | 出どころ |
|---|---|---|
| installer が、差し替えの前の設定の backup を、同じ bytes で取る（Claude 側は mode 0600 も確かめた） | 試した | `src/test-claude-hook-installer.ts`・`src/test-codex-hook-installer.ts`（CI の対象かは、この段で確かめていない） |
| 版の公開が失敗した時に、自分が作った場所だけを戻す（持ち主の確認が違えば戻さない） | 試した | `scripts/test-kusabi-content-addressed-runtime-release.mjs`（CI が `npm run test:kusabi-content-addressed-runtime-release` で流す） |
| 配りの道具が、失敗した時に preimage の bytes を全部戻す（`failed_rolled_back`） | 試した。ただし、**今回の差し替えの道（arc の install4.sh）とは別の道具** | `src/test-kusabi-direct-fleet-rollout.ts` |
| merge commit の revert | 試した | BT-15（使い捨ての clone） |
| install4.sh の戻し（backup を、書いた直後の file と同じ時だけ戻す） | **試していない**（この席は script を読んでいない。arc-sec が読むことは、決定の 4 が言う） | — |
| 実際の 2 席での戻し | **試していない**（保護面） | — |

`team.md` の Deployment は、置き場を新しい所へ切り替える前に、元へ戻す手順を一度試しておくことを求める。今回、設定 file にだけ接続先がある席は、Stop の保存先が既定の SQLite から PostgreSQL に変わる。差し替えの前に、install4.sh の戻しを使い捨ての copy で一度試したかを、Deployment Execution の始めに、Owner か arc に確かめる。試していなければ、試してから差し替える（試すのは、保護面に触れない使い捨ての copy）。

## 5. 戻さない物と、限界

- 新しい版の間に保存された行（引き継ぎ・会話の記録）は、戻しても消さない。
- 戻した後に、旧い hook が再び既定の SQLite に落とす席（設定 file にだけ接続先がある席）は、直す前の失敗に戻る（壊れた `memory.db` に当たる）。この取り組みは、壊れた `memory.db` には触れない。
- 手元の確かめは、席の設定 file を hash で読むところまで。中身は読まない・写さない。
- 差し替えが実際に行われたか、戻しが必要かは、この記録を書いた時点では観測していない（`cd-config.md` の 5）。
