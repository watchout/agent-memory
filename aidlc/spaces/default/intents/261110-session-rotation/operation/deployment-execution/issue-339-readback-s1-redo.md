<!-- kusabi-rotation-deploy-readback:s1-redo -->
## 配備の読み戻し — S1 のやり直し（統合された main から版を作り直した）

取り組み 261110-session-rotation の Deployment Execution、第 2 回の S1。決定の出どころ: Owner の決定 `OD-KUSABI-ROTATION-DEPLOY-SELF-SEAT-TRIAL-20261111-001`（iyasaka-arc#49 の comment 6790645694、本文 SHA-256 `6626a95dcafbaac9c6155d2801a466f5fb55090f5200c74ef88083afec5aa5d8`）。版の作り直しは arc の技術の判断（PR #342 の統合の後の席間の連絡。Owner の言葉ではない）。第 1 回の S1（`aa77b683…` から作った版 `1b731f00…`）の記録は、実物の記録として書き換えていない。

この読み戻しは版を作った所までで、席の設定・hook・見張り・DB・作業場のコードは変えていない。S3・S4（hook の差し替え）は、arc-sec の読み直しが済み、Owner が arc の script を打つのを待っている。

### 結果

| 項目 | 値 |
|---|---|
| 版の元（`--expected-head`） | PR #342 の merge commit `94f1ca6d0042bd970d4cc7c4ab9ce9153b7d5c0d`。`origin/main` の先頭と一致（統合の後の main の CI run 43113722371 は build-and-test 18・20・22 すべて success） |
| 作った場所 | 清潔な別の clone（作業場と release の置き場の外）。`git status --porcelain=v1 --untracked-files=all` は作る前も後も 0 行 |
| publish | 終了 0、`FINAL_CAS_PUBLISHED_AND_VERIFIED`、`ATOMIC_RENAME_NEW_CAS`。protected_effects = 版の公開 1・rollout 0・restart 0。source tree `8efc817a3c4799b12c948d897ae437514981e154` |
| 版の SHA-256（`descriptor_sha256`、`release.json` の SHA-256、release の directory 名） | `28596bf0915d16b72bd7b5878aadda6ebe7efd7564b6520d0f938eb668e7cd92`（席が `shasum -a 256 <release>/release.json` で取り直して一致） |
| readback | 終了 0、`PASS_EXACT_READBACK`。`runtime_tree_sha256` = `47f863db99aff4b5f29419e9f1a33b20e97a365abaade5619381a2ccbefa754f`、`dist_tree_sha256` = `5bd7f9af4470da4598a1e0cbc27e5ab166db2041c5e11c32f9ff1fdc9ea19daf`、`conformance_sha256` = `cdd605d0980611c81c8c262e9698d4bcf87d8034c994e38f7d11ccbe7615707a` |
| 必須の入口 | `release.json` の `required_entrypoint_sha256_map` は 12 件。`dist/session-rotation-stop.js` と `dist/rotation-watcher.js` が入っている。席が 12 件すべての SHA-256 を取り直して一致（不一致 0）、どれも通常の file（symlink でない） |
| installer | `<release>/dist/claude-hook-installer.js` の SHA-256 = `422041d19e565e77f1d4e4fbd084e05801a5b573816e3e747c2bf051713dd8f8`（必須の入口の一覧の外の file なので別に取った）。`codex-hook-installer.js` = `57e0452906a15c6a60a241d1fb75e41203ca2aaddc124c956a498cc87f541c4f` |
| 切り直しの 2 つの file | `session-rotation-stop.js` = `27a476eff83dbcdc217dd2215c6254451bb0f5662b7b77e7b331cf183ed333ca`、`rotation-watcher.js` = `d79947366454d4ea96fd6d2aa3418f29d052c12e6120b249d0e607973e82e273`（前の版と同じ） |
| 依存の脆弱性の確かめ | 作った場所での `npm audit --omit=dev` は 0 件。node は v26.12.1、npm は 11.20.0（`release.json` の記録） |

上の値は、`release.json` と `<release>/dist/` の file を席が取り直した物。このあと S3 の前にもう一度、同じ SHA-256 を取り直す（S3 の読み戻しに添える）。

### 副作用の数

| 内容 | 数 |
|---|---|
| 中身の決まった版の公開（`<release>` を 1 つ追加） | 1（古い版は触っていない） |
| rollout | 0 |
| 席の restart | 0 |
| 席の設定・hook・見張りの変更 | 0 |
| DB への書き込み | 0 |

### 次

S3・S4 は、arc-sec が arc の差し替えの script を読み終えた（止める点 0。iyasaka-arc#57 の comment 6811122140、本文 SHA-256 `e84e8b7bc0e672fcea15d03a49d0fe60f0adb79f1b6398b8058251083568787f`。席が GitHub から取り直して数え、arc の値と一致した）。席が手すきの状態で Owner が script を 1 回打つ。その後に席が読み戻しを #339 に出し、arc が席を起こし直して C2 を取り直す。
