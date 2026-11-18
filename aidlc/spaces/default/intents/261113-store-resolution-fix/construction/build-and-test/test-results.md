# 試験の結果 — Build and Test（取り組み 261113-store-resolution-fix）

この文書は、統合された版 `fa9f3a2f16255d723b0cb96f0e77958035f7b11e`（PR #347 の merge commit）を、清潔な clone で流した試験の結果を書く。流した命令は `unit-test-instructions.md` の表と、`.github/workflows/ci.yml` の `run:` の step、`npm test` で、手順の元は `code-generation-plan.md`、作った物は `code-summary.md` にある。数・終了コード・終わりの行は、命令の出力 file から機械で取り出した値で、手で数えていない（時点は各節に書いた）。

## 1. 流した版と環境

- 版: `fa9f3a2f16255d723b0cb96f0e77958035f7b11e`。手元の repository から作った clone を `git checkout --detach` し、`git status --porcelain` が 0 行であることを確かめてから流した。作業場（止めてある別の取り組みの変更が残る）は使っていない。
- 手元の実行: Node v26.13.1・npm 11.20.0・tsx v4.21.0（1 つの版だけ）。Node 18・20・22 の結果は、4 の CI の log で確かめた。
- 環境: 命令ごとに `env -i` の形で組み直した（`PATH`・`HOME`・`AGENT_MEMORY_HOME`・`KUSABI_TEST_TMPDIR`・`RUNNER_TEMP`・`TMPDIR` などだけ）。`HOME` は使い捨てで、中に `.agent-memory` を先に作った。`AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`DATABASE_URL` は渡していない（PostgreSQL の試験の命令だけ、使い捨ての server への `DATABASE_URL` を内側で組んで渡した。値は出力にも記録にも出していない）。
- 時刻（UTC）: 1 回目の一式 2026-11-16T21:25:39Z〜2026-11-16T21:28:33Z、網羅率の一式 2026-11-16T21:32:45Z〜2026-11-16T21:34:38Z。`npm test` の流し直しは、その後の回。
- 守る物に触れていないことの確かめ: 流す前後に、席の設定の 4 file（`~/.claude/settings.json`・この作業場の `.claude/settings.json`・`~/.codex/hooks.json`・`~/.codex/config.toml`）の SHA-256 と、版の置き場 `~/Developer/.kusabi-releases` の stat の digest を取り、比べた。3 つの一式（1 回目・`npm test` の流し直し・網羅率）のどれも、変わった物は 0 件（`guards_changed` が空）。使い捨ての server と temp の directory は、各一式の終わりに消した。

## 2. 命令ごとの結果

### 2.1 `unit-test-instructions.md` の命令（14 回の実行）

| 実行 | 命令 | 終了コード | 秒 | 出力の行数 | 終わりの結果の行 |
|---|---|---|---|---|---|
| g1-new-store-resolution | `npx tsx src/test-store-resolution.ts` | 0 | 0.7 | 63 | store-resolution: 57 checks passed |
| g1-new-scenario | `npx tsx src/test-store-resolution-scenario.ts` | 0 | 3.5 | 59 | store-resolution-scenario: 40 checks passed |
| g1-new-isolation | `npx tsx src/test-store-resolution-isolation.ts` | 0 | 5.8 | 17 | store-resolution-isolation: 9 checks passed |
| g1-ex-codex-session-start | `npx tsx src/test-codex-session-start.ts` | 0 | 0.7 | 8 | codex native SessionStart adapter tests passed |
| g1-ex-claude-session-start | `npx tsx src/test-claude-session-start.ts` | 0 | 1.9 | 8 | Claude SessionStart tests passed |
| g1-ex-gemini-session-start | `npx tsx src/test-gemini-session-start.ts` | 0 | 0.8 | 8 | gemini native SessionStart adapter tests passed |
| g1-ex-antigravity-session-start | `npx tsx src/test-antigravity-session-start.ts` | 0 | 0.6 | 8 | Antigravity Pre/PostInvocation adapter tests passed |
| g1-ex-transcript-stop-capture | `npx tsx src/test-transcript-stop-capture.ts` | 0 | 1.7 | 8 | transcript stop capture tests passed |
| g1-ex-session-rotation-flow | `npx tsx src/test-session-rotation-flow.ts` | 0 | 8.7 | 55 | PASS test-session-rotation-flow (47 cases) |
| g1-ex-handoff-commit-order | `npx tsx src/test-handoff-commit-order.ts` | 0 | 9.7 | 49 | PASS test-handoff-commit-order (35 cases) |
| g1-ex-handoff-source | `npx tsx src/test-handoff-source.ts && npx tsx src/test-handoff-source-cli.ts` | 0 | 18.6 | 38 | PASS test-handoff-source-cli (14 cases) |
| g1-ex-emitter | `npx tsx src/test-kusabi-runtime-event-emitter.ts` | 0 | 1.9 | 8 | Kusabi OBS-03 runtime-event emitter tests passed |
| g1-ex-session-rotation-scenario | `npx tsx src/test-session-rotation-scenario.ts` | 0 | 0.7 | 20 | PASS test-session-rotation-scenario |
| g1-ex-core | `npx tsx src/test.ts` | 0 | 13.4 | 1962 | ── Results: 1832 passed, 0 failed ── |

`... tests passed` で終わる試験は、件数を出さない（成否は、終了コードと、その行が出ることで読む）。新しい 3 本（`store-resolution` 57・`store-resolution-scenario` 40・`store-resolution-isolation` 9）の件数は、`code-summary.md` と `unit-test-instructions.md` に書いた件数と一致した。

### 2.2 CI の `run:` の step（8 step。`ci.yml` から機械で取り出した）

| 実行 | step の名前 | 命令 | 終了コード | 秒 | 終わりの結果の行 |
|---|---|---|---|---|---|
| g2-03 | Run core test suite | `KUSABI_INTEGRATED_BUILT_EXECUTION=1 npx tsx src/test.ts` | 0 | 12.0 | ── Results: 1832 passed, 0 failed ── |
| g2-04 | Run native recovery and automatic receive tests | `npm run test:codex-hook ; npm run test:claude-hook ; npm run test:gemini-hook ; npm run test:gemini-conversation-ingest ; npm run test:automatic-rece…` | 0 | 63.1 | PASS test-claude-transcript-identity (25 cases) |
| g2-05 | Run immutable publication and direct rollout tests | `npm run test:kusabi-content-addressed-runtime-release ; npm run test:kusabi-direct-fleet-rollout` | 0 | 1.5 | kusabi direct fleet rollout tests passed (159 assertions) |
| g2-06 | Run spec-enforcement tests | `npx tsx tests/spec-enforcement/anti-regression-am027.ts` | 0 | 0.7 | ── Results: 24 passed, 0 failed ── |
| g2-07 | Run SQLite store tests | `HOME=$(mktemp -d) npx tsx src/test-sqlite.ts` | 0 | 1.1 | ── Results: 206 passed, 0 failed ── |
| g2-08 | Run boot recovery tests | `HOME=$(mktemp -d) npx tsx src/test-boot-recovery.ts` | 0 | 1.8 | ── Results: 28 passed, 0 failed ── |
| g2-09 | Run post-tool-hook tests | `HOME=$(mktemp -d) npx tsx src/test-post-tool-hook.ts` | 0 | 0.5 | [agent-memory hook] DATABASE_URL is not set (env nor config.json), skipping |
| g2-10 | Run Gate 0 tests | `HOME=$(mktemp -d) npx tsx tests/gate0/no-secret-recovery.ts ; HOME=$(mktemp -d) npx tsx tests/gate0/migration-idempotency.ts ; HOME=$(mktemp -d) npx …` | 0 | 1.4 | ── Gate 0 search_memory regression: 12 passed, 0 failed ── |

`Run post-tool-hook tests` の step は、終了コード 0 でも試験を 1 件も流さずに終わる（終わりの行は `skipping` の 1 行）。実際の CI の log でも同じで、7 の BT-OBS-2 に書いた。

### 2.3 `npm test`（この repository の `test` の連なり）

| 実行 | 終了コード | 秒 | 出力の行数 | 終わりの結果の行 |
|---|---|---|---|---|
| g3-npm-test（1 回目の一式の回。temp の名前は乱数） | **1** | 17.5 | 2010 | `AssertionError ... 'skipped' / 'captured'`（3 に分類） |
| g3-npm-test-rerun（temp の名前を 16 進の英数字だけにした回） | 0 | 27.9 | 2128 | store-resolution-isolation: 9 checks passed |

流し直しの出力には、`── Results: 1832 passed, 0 failed ──`（core）と、新しい 3 本の件数の行（57・40・9）が出た。

### 2.4 PostgreSQL の試験（使い捨ての server）

使い捨ての PostgreSQL は、`initdb` で temp の directory に作り、`unix_socket_directories` を空にして 127.0.0.1 の TCP だけ（空き port）にし、`lc_messages=C` を付けた。DB を 2 つ作り、どちらにも `CREATE EXTENSION vector` を入れてから流した。server は一式の終わりに止め、directory を消した。

| 実行 | 命令 | 終了コード | 秒 | 終わりの結果の行 |
|---|---|---|---|---|
| g4-pg-store-resolution | `npx tsx src/test-store-resolution-pg.ts` | 0 | 1.4 | store-resolution-pg: 5 checks passed |
| g4-pg-test-pg | `npm run test:pg` | 0 | 0.8 | ── Results: 147 passed, 0 failed ── |

`test-store-resolution-pg.ts` の 5 件には、U12（Stop の保存の経路と `restart-cli` が送る statement が名指す表と列が、migration を流した後の `information_schema` に全てあること）が入る。確かめた表は `conversation_events`・`raw_events`・`selected_restart_packs`・`task_states` の 4 つで、列の一覧は出力に出る（`U12 verified <表>: <列...>`）。PostgreSQL の試験は CI に届かない（`ci.yml` の注記のとおり、CI に PostgreSQL が無い）ので、この手元の結果が証拠になる。

## 3. `npm test` の最初の 1 回の失敗と、その分類

1 回目の一式の `npm test` は終了コード 1 で終わった。落ちたのは `src/test-session-start-auto-receive.ts:173` の `assert.equal(claude.status, "captured")` で、実際の値は `skipped` だった。

**原因**（この段で確かめた）: この試験は、期待する Claude の project の directory 名を `workspace.replaceAll("/", "-")` で作る（base の `27d7f8f` にも同じ行がある）。一方、code の `encodeClaudeProjectDir`（`src/claude-transcript-identity.ts`）は、英数字以外のすべての文字を `-` にする。試験の fixture の置き場は `tmpdir()`（= `TMPDIR`）の下なので、`TMPDIR` の経路に `/` と `-` のほかの英数字以外の文字（`_`・`.`）があると、2 つの名前が食い違い、placement の検査が `projects_dir_mismatch` を返して `skipped` になる。1 回目の一式の temp の名前は、Python の `tempfile.mkdtemp` が付けた乱数の名前で、`_` を含みうる（その回の名前は片付けで消えていて、何だったかは残っていない。原因として確かめたのは、下の `TMPDIR` の名前の影響）。

**確かめ**: 同じ clone・同じ環境で、`TMPDIR` の名前だけを変えて `npx tsx src/test-session-start-auto-receive.ts` を流した。

| `TMPDIR` の最後の名前 | 終了コード | 結果 |
|---|---|---|
| `xplain_under`（`_` あり） | 1 | `actual: 'skipped'`・`expected: 'captured'` |
| `xdot.name`（`.` あり） | 1 | 同じ |
| `xplainname`（英数字だけ） | 0 | `SessionStart bounded auto-receive tests passed` |

**分類**: この PR の変更による失敗ではない。`git diff 27d7f8f fa9f3a2f` に、この試験の file も、対象の `src/session-start-auto-receive.ts`・`src/claude-transcript-identity.ts` も入っていない。この段の流し方（temp の名前）が引いた、試験の前からある脆さ。段の手順の失敗の扱い（段の中の直しは 2 回まで）の 1 回目として、原因が段の中（環境の設定）にあるので、環境を直して同じ命令を流し直した（temp の名前を 16 進の英数字だけにした。2.3 の 2 行目。結果は終了コード 0）。2 回目は使っていない。code・試験の file・設定は変えていない。1 回目の失敗の出力は、消さずに残してある。脆さそのものは 7 の BT-OBS-1 に書いた。

## 4. CI の log（C1・NFR8。2026-11-17 に `gh run view --log` で読んだ）

| run | 起点 | head | 3 つの Node の版（18・20・22）の job | `store-resolution` | `store-resolution-scenario` | `store-resolution-isolation` | 行の数 |
|---|---|---|---|---|---|---|---|
| 43806507709 | pull_request（PR #347 の最後の head） | `83bd8405` | 3 job とも success | 57 checks passed | 40 checks passed | 9 checks passed | 3 job × 3 行 = 9 |
| 43812014201 | push（main。merge commit） | `fa9f3a2f` | 3 job とも success | 57 checks passed | 40 checks passed | 9 checks passed | 3 job × 3 行 = 9 |

行は、log の各 job の中の `store-resolution: <n> checks passed` の形の行を機械で数えた（3 つの Node の版のそれぞれに 3 行）。件数は手元の結果（2.1）と同じ。

## 5. 行の網羅率（NFR6。`coverage-method.md` の手順のとおり）

- script: `coverage-method.md` の 7 から 3 本を取り出し、記録の SHA-256 と一致することを確かめた（`merge-zero.mjs` `ab76f8fc…`・`changed-uncovered.py` `4c73c560…`・`coverage-selftest.mjs` `8db67d66…`）。自己試験は `coverage-selftest: 16 cases passed`。
- 対象: base `27d7f8f` から `fa9f3a2f` までに `src/` の下で足した行・変えた行（`list` の結果）。対象 12 file、追加行 487。`src/` の外と試験の file は対象にしない。対象の外の file は 29 件（`aidlc` 25・`docs` 3・`package.json` 1）。`coverage-method.md` の 4 に書いた 517 件は、別の取り組みの変更が残る作業場（`.claude` など、この PR の差分に無い所を含む）で数えた値で、この段は merge commit の差分で数えたので、数が違う。
- 流し方: 13 個の命令を、命令ごとの `NODE_V8_COVERAGE` の folder に 1 回ずつ流し（temp の名前は英数字だけ、環境は 1 に書いた形）、folder を集めて 3 つの組を作った。

13 個の命令（命令ごとに 1 回）:

| 命令 | CI の `run:` が届く | 終了コード | 秒 | 終わりの結果の行 |
|---|---|---|---|---|
| `npm run test:claude-hook` | 届く | 0 | 65.5 | store-resolution-isolation: 9 checks passed |
| `npm run test:codex-hook` | 届く | 0 | 1.4 | codex native hook installer tests passed |
| `npm run test:gemini-hook` | 届く | 0 | 1.1 | gemini native hook installer tests passed |
| `npm run test:gemini-conversation-ingest` | 届く | 0 | 0.5 | Gemini default-deny raw-capture tests passed |
| `npm run test:antigravity-hook` | 届かない | 0 | 1.1 | Antigravity namespace-preserving hook installer tests passed |
| `npm run test:automatic-receive` | 届く | 0 | 0.9 | PASS test-claude-transcript-identity (25 cases) |
| `npm run test:transcript-stop` | 届かない | 0 | 1.8 | transcript stop capture tests passed |
| `npm run test:kusabi-direct-fleet-rollout` | 届く | 0 | 1.3 | kusabi direct fleet rollout tests passed (159 assertions) |
| `npm run test:kusabi-content-addressed-runtime-release` | 届く | 0 | 0.3 | {"schema_version":"wasurezu-direct-publisher-test/v1","verdict":"PASS","checks":["argument_boun… |
| `npx tsx src/test-kusabi-runtime-event-emitter.ts` | 届かない | 0 | 2.2 | Kusabi OBS-03 runtime-event emitter tests passed |
| `npx tsx src/test.ts` | 届く | 0 | 13.5 | ── Results: 1832 passed, 0 failed ── |
| `env AGENT_MEMORY_DB_TYPE=sqlite npx tsx src/test-post-tool-hook.ts` | 届く | 0 | 3.5 | ── Results: 45 passed, 0 failed ── |
| `npx tsx src/test-boot-recovery.ts` | 届く | 0 | 1.9 | ── Results: 28 passed, 0 failed ── |

| 組 | 命令の数 | 報告の JSON | 判定 |
|---|---|---|---|
| 全部の命令 | 13 | `REPORT json_files=488 entries=20865 loading_entries=20865 unreadable_json=0`・最後の行 `COLLECTOR_DONE paths=12` | `RESULT PASS changed_files=12 changed_lines=487 uncovered_lines=0 unreadable_files=0` |
| CI の `run:` が届く命令 | 10 | `REPORT json_files=454 entries=19387 loading_entries=19387 unreadable_json=0`・最後の行 `COLLECTOR_DONE paths=12` | `RESULT PASS changed_files=12 changed_lines=487 uncovered_lines=0 unreadable_files=0` |
| CI が本当に試験を流す命令（ci10 から post-tool-hook を外した） | 9 | `REPORT json_files=422 entries=18602 loading_entries=18602 unreadable_json=0`・最後の行 `COLLECTOR_DONE paths=12` | `RESULT PASS changed_files=12 changed_lines=487 uncovered_lines=0 unreadable_files=0` |

`ci9` を足した理由: 2.2 のとおり、CI の post-tool-hook の step は試験を流さない。`ci10` の post-tool-hook は `AGENT_MEMORY_DB_TYPE=sqlite` を付けて本当に流した結果なので、それを外しても 100% が保たれるかを見た。保たれた。

組 `all13` の file ごとの結果:

| file | 状態 | 流した process の数 | 追加行 | 未実行 |
|---|---|---|---|---|
| `src/antigravity-session-start.ts` | LOADED | 5 | 4 | 0 |
| `src/claude-session-start.ts` | LOADED | 19 | 8 | 0 |
| `src/codex-session-start.ts` | LOADED | 50 | 40 | 0 |
| `src/gemini-session-start.ts` | LOADED | 6 | 4 | 0 |
| `src/kusabi-runtime-event-emitter.ts` | LOADED | 63 | 31 | 0 |
| `src/restart-cli.ts` | LOADED | 75 | 17 | 0 |
| `src/rotation-commit.ts` | LOADED | 51 | 20 | 0 |
| `src/session-rotation-stop.ts` | LOADED | 20 | 29 | 0 |
| `src/store-resolution.ts` | LOADED | 138 | 240 | 0 |
| `src/stores/index.ts` | LOADED | 159 | 54 | 0 |
| `src/stores/read-only-task-states.ts` | LOADED | 78 | 4 | 0 |
| `src/transcript-stop-capture.ts` | LOADED | 27 | 36 | 0 |

- 数えから外した追加行は 0。`core`（`npx tsx src/test.ts`）は、記録の手順どおり `KUSABI_INTEGRATED_BUILT_EXECUTION` を付けずに流した。CI はこの変数を付けて流す（2.2 の core の step。そちらは `1832 passed, 0 failed`）が、その形での網羅率は測っていない。
- 報告は 3 つの組とも完結していた（最後の行が `COLLECTOR_DONE paths=12`、節 12 個の全部に `END` の行、読めなかった JSON は 0）。`ci9` の 1 回目の判定は、私の命令の誤り（zsh が対象の一覧を 1 つの引数にした。`COLLECTOR_DONE paths=1`）で `RESULT FAIL`（`UNKNOWN`）になった。検査が欠けた報告を PASS にしなかった例で、bash で組み直した結果が上の表の `ci9` の行。

## 6. 試験の file の型検査（別の設定）

`tsconfig.json` は `src/test*.ts` を除くので、`build-instructions.md` の 4 の型検査は試験の file を含まない。そこで、同じ設定を継いで試験の file を含める設定を別に作り、merge commit と base の両方で流した。

```json
{
  "extends": "<clone>/tsconfig.json",
  "compilerOptions": { "noEmit": true },
  "include": ["<clone>/src/**/*"],
  "exclude": ["<clone>/node_modules", "<clone>/dist"]
}
```

- 命令: `npx tsc -p <上の設定>`（`noEmit`）。対象は `src/**/*` の全部の `.ts`（試験の file を含む）。
- 対象の file: `src/` の下の `.ts` 159 件。
- 結果: merge commit は誤り 89 件（15 file）、base は誤り 89 件（15 file）。(file, 誤りの code) ごとの件数は 2 つで完全に同じ（差 0）。
- この取り組みで足した試験 6 file と `src/store-resolution.ts` の誤りは 0 件。試験でない `src/` の file の誤りは 0 件。誤りは、前からある試験の file の中だけにある。
- 型検査の設定と結果の file は、この段の作業の置き場（scratchpad）に置いた: `tsconfig-tests-*.json`・`bt-tsc-tests-new.log`・`bt-tsc-tests-base.log`。

## 7. 観測（この取り組みでは直さず、持ち越す）

番号は、前の段の OBS-1・OBS-2 と混ざらないよう `BT-OBS-` を付けた。

- **BT-OBS-1**（試験の脆さ）: `src/test-session-start-auto-receive.ts` は、期待する Claude の project の directory 名を `replaceAll("/", "-")` だけで作るので、試験を流す `TMPDIR` の経路に英数字・`/`・`-` のほかの文字（`_`・`.`）があると、code の正しい動きでも落ちる。base にもある。CI では通っている（4 の log。CI の run の temp の経路は確かめていない）。持ち越し: 試験の期待値を `encodeClaudeProjectDir` と同じ規則で作る直し（試験の file の変更で、この取り組みの範囲の外。arc が次の取り組みに入れるかを決める）。
- **BT-OBS-2**（CI の step が試験を流さない）: `ci.yml` の `Run post-tool-hook tests`（`HOME=$(mktemp -d) npx tsx src/test-post-tool-hook.ts`）は、`AGENT_MEMORY_DB_TYPE` が `sqlite`・`json` でなく URL も無いと、試験が import する `src/post-tool-hook.ts` の 41〜47 行目が `process.exit(0)` するので、試験の本体に届かない。実際の CI の log（run 43812014201 の 3 つの Node の job）でも、この step の出力は `[agent-memory hook] DATABASE_URL is not set (env nor config.json), skipping` の 1 行だけで、成功と読まれる。`AGENT_MEMORY_DB_TYPE=sqlite` を付けると 45 件が走る（5 の `cov-post-tool-hook`、`Results: 45 passed, 0 failed`）。設計・実装の標準 S8（表明の無い test・無条件の PASS を置かない）に当たる。この PR は、この試験の file にも `src/post-tool-hook.ts` にも触れていない。直すには `ci.yml`（workflow = 守る物）を変えるので、Owner の判断が要る。この取り組みの網羅率は、この step を外した `ci9` でも 100% を保った。
- **BT-OBS-3**（依存の脆弱性の詳細は取れていない）: `npm ci` は `1 low severity vulnerability` を出した。`package-lock.json` は base と byte 同一なので、この PR が入れた物ではない。詳細を見る `npm audit` は、この端末の PreToolUse hook に 2 回とも止められて流れなかった（hook の文は、AI-DLC の監査の記録の dir は framework の道具だけが書く、というもの）。回避はせず、流れなかったと記録する（結果は 1 件も取り込んでいない）。扱いは `security-test-instructions.md` に書いた。
- **BT-OBS-4**（`npm ci` の警告）: npm 11 は、`esbuild@0.27.4` と `fsevents@2.3.3` の install script を、許可が無いので走らせないと警告した。tsx・tsc・build・試験は、その状態のまま動いた。許可を足す（`npm install-scripts approve`）のは依存の設定の変更なので、していない。
- 前の段から持ち越した OBS-1（`AGENT_MEMORY_DB_PATH` が空文字の時の `||` と `??` の違い）・見直し 3 回目の Minor の R-05（計画の試験 file の数の古さ）・R-06（`kusabi-runtime-event-emitter.ts` が 800 行ちょうど）は、この段でも直していない（`code-summary.md` の持ち越し）。R-05・R-06 は `reviews/review-03.md` の番号で、計画の R-05（arc の持ち越しの決め = 網羅率の対象）とは別の物。

## 8. 出力の置き場

この段の命令の出力は、作業の置き場（scratchpad。repository の外）に残してある: 1 回目の一式 `bt-out/`・`bt-results.json`・`bt-driver.log`、`npm test` の流し直し `bt-out-rerun/`・`bt-results-g3-rerun.json`、網羅率 `bt-out-cov/`・`bt-results-cov.json`・`cov-check-*.txt`・`cov-zero-*.txt`・`cov-list.txt`・`cov-selftest.txt`、CI の log `bt-ci-log-43806507709.txt`・`bt-ci-log-43812014201.txt`。これらは記録の PR には入れない（作業の log に当たる）。この文書の表は、それらの file から機械で作った。
