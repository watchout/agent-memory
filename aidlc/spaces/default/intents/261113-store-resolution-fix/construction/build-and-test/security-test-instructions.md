# 安全の試験の手順 — Build and Test（取り組み 261113-store-resolution-fix）

この文書は、この取り組みに関わる安全の確かめを、命令・結果・流せなかった物に分けて書く。手順の元は `code-generation-plan.md`、作った物は `code-summary.md`、単体の命令は `unit-test-instructions.md` にある。数は、この段（2026-11-17）に取り直した値で、手で数えていない。

## 1. 対象と、守る物に触れていないこと

- 対象: 版 `fa9f3a2f16255d723b0cb96f0e77958035f7b11e`（PR #347 の merge commit）。変えた `src/` の 12 file（追加行 487）。
- この段は、版の作成（`.kusabi-releases`）・本番の DB・席の hook と設定・tmux・workflow（`ci.yml`）に触れていない。流す前後に、席の設定 4 file の SHA-256 と版の置き場の stat の digest を取って比べ、3 つの一式（1 回目・`npm test` の流し直し・網羅率）のどれも変わった物は 0 件だった（`guards_changed` が空）。
- PR の差分に `tests/` と `.github/` は 0 file（workflow は変えていない）。

## 2. 接続先の URL を出さない（NFR1）

| 確かめ | 結果 |
|---|---|
| U4: URL を `JSON.stringify`・`util.inspect`・文字列化・誤りの文・証拠に出すと固定の語になり、`reveal()` だけが値を返す | `test-store-resolution.ts` の 1 件が通った |
| U5: PostgreSQL に繋げない決めは、SQLite に落とさず、出力に URL が出ない | 1 件が通った |
| U5 (OBS-2): 鍵・証明書の path を名指す URL で、標準エラー・誤りの文・stack・`inspect` に path が出ない。出るのは失敗の種類の code だけ（例 `ENOENT`） | 2 件が通った |
| U2: 拒否の全部の組を実際の file system で流し、閉じた理由が 1 つ返り、値・URL・path を含まず、store を開かず、SQLite の file も作られない | 1 件が通った |
| U6: 拒否された設定で SessionStart の hook は degraded になり、何も書かない | 1 件が通った |
| この段の出力を、使い捨ての接続先の利用者名を含む URL の形で調べた（`postgres://` と `postgresql://` の両方） | 出力の file の数: 1 回目 0・`npm test` の流し直し 0・網羅率 0・CI の log 0 |
| 同じ調べを、利用者名を問わず `postgres://`・`postgresql://` の形で行った | 出力の file のうち g2-10-run-gate-0-tests.out の 1 つだけが該当。中身は、今ある Gate 0 の秘密の除去の試験（`tests/gate0/no-secret-recovery.ts`）が、自分の fixture（偽の URL）の名前を出す 1 行。この PR は `tests/` を変えていない |

調べ方: 出力 file のそれぞれに `grep -l -E 'postgres(ql)?://kusabi_test'` を流し、該当した file の数を数えた（値は出さない）。使い捨ての PostgreSQL の接続先は、命令の環境にだけ渡し、出力にも記録にも書いていない。

## 3. 拒否の組（FR5.4）と、失敗を成功と数えないこと（NFR5）

- `test-store-resolution.ts` の `U1/U2: refuses ...` が 17 件通った。対象: 未知の `AGENT_MEMORY_DB_TYPE`（URL がある時も）・postgres でない環境変数の URL（大文字小文字の違いも）・設定 file が通常の file でない（symlink・directory）・読めない・JSON でない・`null`・配列・文字列・数・`database_url` が空・`null`・数・postgres でない・`postgres` と明示して接続先が無い（設定 file が無い・`database_url` が無い）。
- S1 は、拒否・接続できない場合に、SQLite の file が作られないこと（既定の SQLite に黙って落ちないこと）を、Stop の 2 hook × 2 host の 4 件で確かめる。
- U7 は、拒否の回の証拠が `store_refused:<理由>` で、出力は「続ける」のまま、`transcript-stop-capture` の `outcome` は `unobserved`（成功と数えない）であることを確かめる。
- U5 の `openResolvedStore` と seam の確かめは、開いた store の `backend` が決めた `backend` と違えば閉じて失敗にし、閉じる処理が失敗しても拒否を隠さないことを確かめる（宣言と観測の突き合わせ。S5）。

## 4. 依存と設定（NFR9）

| 確かめ | 結果 |
|---|---|
| `package.json` の `dependencies`・`devDependencies`・`optionalDependencies`・`peerDependencies`・`engines`・`bin`・`main`・`type` が base と同じか | dependencies=同じ・devDependencies=同じ・optionalDependencies=同じ・peerDependencies=同じ・engines=同じ・bin=同じ・main=同じ・type=同じ |
| `scripts` が変わった key | test, test:claude-hook, test:store-resolution, test:store-resolution-pg（試験の連なりの足し・書き換えだけ） |
| `package-lock.json` の SHA-256（base と版） | `dafdefe947ad6595…`・`dafdefe947ad6595…`（同じ） |

新しい外部の依存も、書式・静的検査の道具も足していない。依存を入れる前の脆弱性の確かめは、足していないので対象外。

## 5. DB の構造を変えないこと（FR6.1・FR6.3）

| 確かめ | 結果 |
|---|---|
| `src/stores/pg-migrations.ts` の SHA-256（base と版）・差分の行数 | `dbc0546aa79d3c6a…`・`dbc0546aa79d3c6a…`（同じ）・差分 0 行 |
| 追加行 487（試験でない 12 file）のうち `CREATE`・`ALTER`・`DROP`・`TRUNCATE` を含む行 | 0 件 |
| 試験の file の追加行のうち同じ語を含む行 | 3 件。全部 `src/test-store-resolution-pg.ts` の中で、DDL を見つける正規表現 1 件と、使い捨ての PostgreSQL の中に試験ごとの schema を作って消す 2 件（`CREATE SCHEMA`・`DROP SCHEMA`）。表・列・index・migration の追加ではない |
| 本番の DB | この段は本番の接続先を持たず、触れていない。席へ当てる前の「本番の表と列の名前の確認」は、Owner と arc が別に行う（Q2 = A）。確かめたい表と列の一覧（4 表）は `unit-test-instructions.md` の 8 にある |

## 6. 流せなかった物と、既存の指摘

- **`npm audit`**: この端末の PreToolUse hook に 2 回とも止められて流れなかった。回避はしていない。結果は 1 件も取り込んでいない。したがって、依存の脆弱性の詳細は**観測できていない**（成功とは数えない）。
- `npm ci` は `1 low severity vulnerability` を出した。`package-lock.json` が base と同じなので、この PR が入れた物ではない。詳細と扱いは、`npm audit` を流せる席（または Owner の操作）で見る。
- npm 11 が `esbuild` と `fsevents` の install script を走らせないと警告した件は、`test-results.md` の 7（BT-OBS-4）。許可の追加は依存の設定の変更なので、していない。

## 7. 決定性と、決める処理の中身（NFR2。S4・S5）

- `src/store-resolution.ts`（240 行）は、時刻・乱数・識別子を自分で取らない: `Date.now`・`new Date()`・`Math.random`・`randomUUID` の出現 0 件。`process.env` の出現は行 198・206（`resolveStore`・`requireStore` の**引数の既定値**だけ）で、核の `decideStore` は `env` と `readConfig` を引数で受け取る。
- `src/kusabi-runtime-event-emitter.ts` は 800 行（上限 800 行ちょうど。前の段から持ち越した R-06）。
