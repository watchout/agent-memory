# 網羅率の測り方と結果 — 保存先の決め方を 1 つの関数にする（取り組み 261113-store-resolution-fix）

この文書は、`code-generation-plan.md` の Step 12（R-05・D11・SR-BF-03）の記録。最後に測った時点は 2026-11-16T04:34:30Z（全部の命令）と 04:36:02Z（CI が届く命令だけ）、Node は v26.13.1、base は origin/main の `27d7f8fc9146e826883b045c1fdca93cc11f93e7`。数は、この文書の中の命令の出力から写した値で、手で数えていない。

## 1. 何を測るか

- 目標: この PR が足した行と変えた行（base の `27d7f8f` に無い行）の網羅率 100%（team.md の Testing Posture。org.md の既定 80% より厳しい床）。
- 対象の file: `src/` の下の code（拡張子 `.ts`・`.mts`・`.js`・`.mjs`）のうち、名前が `src/test` で始まらず、base の同じ path の blob に無い行を持つ物。`src/` の外（docs・`.claude`・`aidlc`・`package.json` など）と試験の file は対象にしない（数と置き場は 5 に書く）。
- 追加行の取り方: 各 file を、`git show <base>:<path>` の blob と `git diff --no-index -U0` で比べる。作業場の index を通す `git diff <base> -- <path>` は使わない。この作業場は、`origin/main` にある file のいくつかを追跡していない（dirty のまま。`memory.md`）ので、index を通すと「削除された file」と読まれて追加行が 0 件になり、対象から落ちる（自己試験 n8 がこの形を見張る。最初の版が実際に `rotation-commit.ts` と `read-only-task-states.ts` を落とした）。base に無い file は、全行を追加行とする。
- 前の取り組み（261110）の 2 つの script は **byte 同一で写さず**、未観測を 0 と数えない形で書き直した。前の版は、変えた file がどの process にも読み込まれていない時も `uncovered_ranges_in_changed=0` を出し、100% と読めた（設計監査 SR-BF-03）。

### file ごとの状態（`changed-uncovered.py check` が各 target に 1 つ付ける）

| 状態 | 意味 | 数え方 |
|---|---|---|
| LOADED | いずれかの process が file を実行した。0 回の範囲（原文の行に直したもの）が追加行に重なる時、その行は未実行 | 追加行のうち 0 回の範囲に重なる行を未実行に数える |
| NOT_LOADED | 報告に file はあるが、どの process も実行していない | 追加行を全部未実行に数え、読めなかった file にも数える |
| MISSING | どの報告にも file の節が無い | 同上 |
| INCOMPLETE | 節に `== <path> END ranges=<n>` の行が無い、または n が節の中の行の数と違う（IM-BF-02） | 追加行を全部未実行に数え、読めなかった file にも数える |
| UNKNOWN | 報告全体が信用できない（`REPORT_UNKNOWN`）: 空・process が何も実行していない・最後が `COLLECTOR_DONE` の行でない（途中で切れた）・`COLLECTOR_DONE paths=<n>` の n が報告の節の数と違う・`COLLECTOR_DONE` の後に文字がある・最後の改行が無い | 全 target を同上 |

報告の完結の約束（IM-BF-02）: `merge-zero.mjs` は、先頭に `REPORT` の行、節ごとの終わりに `== <path> END ranges=<n>`（n = その節で印字した範囲の行の数）、正常に終わった時の最後に `COLLECTOR_DONE paths=<n>`（n = 渡された path の数）を印字する。collector が途中で失敗した・pipe が閉じた・file が途中で切れた報告には、最後の行が無いので、`changed-uncovered.py check` はどの target も信用せず、`RESULT FAIL` にする。直す前の版は、節の見出しの行（`== <path> state=LOADED`）の直後で切れた報告を、未実行 0 件の `RESULT PASS` と読んだ（監査 1 回目の IM-BF-02。同じ報告を直す前と後の checker に渡した結果は 3 の最後）。

PASS は、`RESULT PASS` の 1 行だけ。条件は、対象が 1 つ以上・未実行の追加行が 0・読めなかった file が 0・完結した報告があること。対象が 0 件の測定（`NO_TARGETS`）は PASS にしない。行の一部の範囲だけが 0 回の時も、その行を未実行に数える（厳しい側）。

## 2. 手順（作業場の根から）

1. 対象を出す: `python3 -I changed-uncovered.py list 27d7f8f`（`TARGET <path> added_lines=<n>` と、外した file の `EXCLUDED` の行）。
2. 全試験の命令を、**同じ** `NODE_V8_COVERAGE` の folder に流す（子 process の分も集まる）。使い捨ての `HOME`（中に `.agent-memory`）と `KUSABI_TEST_TMPDIR` を渡し、`AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`DATABASE_URL` を外す。命令は 13 個: `npm run test:claude-hook`・`test:codex-hook`・`test:gemini-hook`・`test:gemini-conversation-ingest`・`test:antigravity-hook`・`test:automatic-receive`・`test:transcript-stop`・`test:kusabi-direct-fleet-rollout`・`test:kusabi-content-addressed-runtime-release`、`npx tsx src/test-kusabi-runtime-event-emitter.ts`、`npx tsx src/test.ts`、`env AGENT_MEMORY_DB_TYPE=sqlite npx tsx src/test-post-tool-hook.ts`、`npx tsx src/test-boot-recovery.ts`。新しい 2 つの試験（`test-store-resolution.ts`・`test-store-resolution-scenario.ts`）は `test:claude-hook` の連なりの最後に入っている。
3. 合算: `node merge-zero.mjs <folder> <対象の path ...> > zero.txt`（process をまたいで、offset ごとに回数の最大を取る）。
4. 判定: `python3 -I changed-uncovered.py check 27d7f8f zero.txt`。終了コードは PASS だけ 0。3 と 4 は `&&` でつなぐ（collector が 0 で終わらなければ判定に進まない）。つながなくても、途中で切れた報告は 4 が `RESULT FAIL`（`REPORT_UNKNOWN`）にする（IM-BF-02）。
5. 自己試験: `node coverage-selftest.mjs <script の folder> <node_modules/.bin/tsx のある根>`（3 に結果）。

## 3. 自己試験（U14。2 つの script が間違った答えを出さないことの確かめ）

使い捨ての git repository に、本物の V8 の報告（tsx）を作って 2 つの script に渡す。n1〜n5・n7 は失敗（終了コード 1）、n6 は PASS（終了コード 0）、n8 は「作業場が追跡していない file の追加行も対象になる」ことの確かめ。

n9・n10 は、独立の実装監査 1 回目の IM-BF-02（collector が途中で失敗した、または報告が途中で切れても、節の見出しの行まで届いていれば `RESULT PASS` と読めた）を受けて足した。
- n9: 落ちる報告（未実行の追加行がある）と通る報告のそれぞれを、全部の行の境目（先頭の 0 行から最後の 1 つ前の行まで）と全部の行の途中（その行の前半だけ）と最後の改行の前で切り（19 か所・17 か所）、どれも FAIL。節の見出しの行の直後で切れた報告（IM-BF-02 の再現）は、`REPORT_UNKNOWN the report has no COLLECTOR_DONE line` と名指しされる。完結した 2 つの報告は内容で決まる（落ちる報告は未実行の行で FAIL、通る報告は PASS で、どちらも `REPORT_UNKNOWN`・`INCOMPLETE` を出さない）。
- n10: `END` の行が無い節（通る報告から消した）、行が `END` の数より少ない節、節が欠けて `COLLECTOR_DONE paths=<n>` の n と合わない報告、n が違う `COLLECTOR_DONE`、`COLLECTOR_DONE` の後の文字、はどれも FAIL。

コマンドの終了コード 0（16 件とも期待どおり）。

```
ok - n1 empty report exit=1 RESULT FAIL changed_files=2 changed_lines=9 uncovered_lines=9 unreadable_files=2
ok - n2 changed file is in the report but no process ran it exit=1 RESULT FAIL changed_files=1 changed_lines=6 uncovered_lines=6 unreadable_files=1
ok - n3 the report has no section for the changed file exit=1 RESULT FAIL changed_files=1 changed_lines=6 uncovered_lines=6 unreadable_files=1
ok - n4 one of two changed files is not loaded exit=1 RESULT FAIL changed_files=2 changed_lines=9 uncovered_lines=3 unreadable_files=1
ok - n5 loaded, a zero-count range on an added line exit=1 RESULT FAIL changed_files=1 changed_lines=6 uncovered_lines=1 unreadable_files=0
ok - n6 all changed files ran, no zero-count range on an added line exit=0 RESULT PASS changed_files=2 changed_lines=9 uncovered_lines=0 unreadable_files=0
ok - n7 no changed file under src is not a pass exit=1 RESULT FAIL changed_files=0 changed_lines=0 uncovered_lines=0 unreadable_files=0
ok - n8 added lines of a file the working tree does not track but the base has are still targets
ok - n9 a report that would FAIL on its content, cut short in 19 places (every line boundary and the middle of every line): FAIL each time
ok - n9 a report that would PASS, cut short in 17 places (every line boundary and the middle of every line): FAIL each time
ok - n9 a report cut right after the section line is named: REPORT_UNKNOWN the report has no COLLECTOR_DONE line
ok - n10 a section without its END line (it was a PASS report): FAIL
ok - n10 a section with fewer rows than its END count: FAIL
ok - n10 a missing section while COLLECTOR_DONE still counts it: FAIL
ok - n10 a wrong COLLECTOR_DONE count: FAIL
ok - n10 text after COLLECTOR_DONE: FAIL
coverage-selftest: 16 cases passed
```

IM-BF-02 の再現を、直す前の checker（この文書の IM-BF-02 の前の版）と直した checker に同じ報告で流した（使い捨ての git repository、対象 1 つ・追加行 3、報告は `REPORT` の行と `== src/a.ts state=LOADED processes=1` の行だけ）。直す前は PASS、直した後は FAIL になる:

```
直す前: src/a.ts: state=LOADED processes=1 added_lines=3 uncovered_lines=0
        RESULT PASS changed_files=1 changed_lines=3 uncovered_lines=0 unreadable_files=0   （終了コード 0）
直した後: REPORT_UNKNOWN the report has no COLLECTOR_DONE line (it was cut short, or the collector did not finish)
        src/a.ts: state=UNKNOWN added_lines=3 uncovered_lines=3
        RESULT FAIL changed_files=1 changed_lines=3 uncovered_lines=3 unreadable_files=1   （終了コード 1）
```

## 4. 測定の結果

測定の命令 13 個は、すべて終了コード 0（最後の測定、2026-11-16T04:34:30Z。IM-BF-01・IM-BF-02・OBS-2 の直しを入れた code で流した）。報告は 488 個の JSON、source map のある節 20854、そのうち process が実行した節 20854、読めなかった JSON 0。報告は完結していた（`COLLECTOR_DONE paths=12`、節 12 の全部に `END` の行）。

```
EXCLUDED_UNCHANGED_UNDER_SRC files=84
EXCLUDED_OUTSIDE_SRC files=517 top_dirs=.aidlc-version(1), .claude(333), .framework(1), .gitignore(1), aidlc(175), docs(5), package.json(1)
src/antigravity-session-start.ts: state=LOADED processes=5 added_lines=4 uncovered_lines=0
src/claude-session-start.ts: state=LOADED processes=19 added_lines=8 uncovered_lines=0
src/codex-session-start.ts: state=LOADED processes=50 added_lines=40 uncovered_lines=0
src/gemini-session-start.ts: state=LOADED processes=6 added_lines=4 uncovered_lines=0
src/kusabi-runtime-event-emitter.ts: state=LOADED processes=63 added_lines=31 uncovered_lines=0
src/restart-cli.ts: state=LOADED processes=75 added_lines=17 uncovered_lines=0
src/rotation-commit.ts: state=LOADED processes=51 added_lines=20 uncovered_lines=0
src/session-rotation-stop.ts: state=LOADED processes=20 added_lines=29 uncovered_lines=0
src/store-resolution.ts: state=LOADED processes=138 added_lines=240 uncovered_lines=0
src/stores/index.ts: state=LOADED processes=159 added_lines=54 uncovered_lines=0
src/stores/read-only-task-states.ts: state=LOADED processes=78 added_lines=4 uncovered_lines=0
src/transcript-stop-capture.ts: state=LOADED processes=27 added_lines=36 uncovered_lines=0
RESULT PASS changed_files=12 changed_lines=487 uncovered_lines=0 unreadable_files=0
```

- 対象 12 file、追加行 487、未実行 0、読めなかった file 0。**100% を満たした**（この文書の時点）。数えから外した追加行は無い。
- 測り直しの経緯: 最初の測定は `RESULT FAIL changed_files=12 changed_lines=460 uncovered_lines=3`（`antigravity-session-start.ts` の `loadAntigravityHookDataFromStore` の 2 行が、どの試験も呼ばず未実行。`stores/index.ts` の `requireStoreBackend` の、閉じる処理が失敗した時の分岐 1 行が未実行）。試験を 2 つ足した（`U5 (antigravity)`・`seam`）。次の測定は `RESULT PASS changed_files=12 changed_lines=460 uncovered_lines=0`。その後、`restart-cli handoff-source` が拒否の種類を標準エラーに出すよう直した（FR3.4。`memory.md`）ので追加行が 460 から 474 になり、測り直した（`RESULT PASS`）。さらに、CI が届く命令だけで測ると 474 行のうち 8 行が未実行だった（Gemini の loader の 2 行、emitter の 6 行。CI が流さない試験の側でだけ実行されていた）ので、試験を 2 つ足した（`U5 (gemini)`・`U10 (in process)`）。その後、独立の実装監査 1 回目（IM-BF-01・IM-BF-02・OBS-2）の直しで、`stores/index.ts` の追加行が 41 から 54 になり（PostgreSQL の失敗の種類だけを出す `postgresFailureKind` と、投げる誤りの作り直し）、全体が 474 から 487 になったので、script の完結の確かめ（IM-BF-02）を入れて測り直した（全部の命令・CI が届く命令だけの 2 通りとも `RESULT PASS`、追加行 487、未実行 0）。**この文書の結果は、その最後の測定**。最初の測定の出力（参考）:

```
src/antigravity-session-start.ts: state=LOADED processes=3 added_lines=4 uncovered_lines=2
    208-268  export async function loadAntigravityHookDataFromStore(
src/claude-session-start.ts: state=LOADED processes=19 added_lines=8 uncovered_lines=0
src/codex-session-start.ts: state=LOADED processes=44 added_lines=40 uncovered_lines=0
src/gemini-session-start.ts: state=LOADED processes=4 added_lines=4 uncovered_lines=0
src/kusabi-runtime-event-emitter.ts: state=LOADED processes=52 added_lines=31 uncovered_lines=0
src/restart-cli.ts: state=LOADED processes=60 added_lines=3 uncovered_lines=0
src/rotation-commit.ts: state=LOADED processes=45 added_lines=20 uncovered_lines=0
src/session-rotation-stop.ts: state=LOADED processes=19 added_lines=29 uncovered_lines=0
src/store-resolution.ts: state=LOADED processes=112 added_lines=240 uncovered_lines=0
src/stores/index.ts: state=LOADED processes=138 added_lines=41 uncovered_lines=1
    125-125  await store.close().catch(() => undefined);
src/stores/read-only-task-states.ts: state=LOADED processes=62 added_lines=4 uncovered_lines=0
src/transcript-stop-capture.ts: state=LOADED processes=23 added_lines=36 uncovered_lines=0
RESULT FAIL changed_files=12 changed_lines=460 uncovered_lines=3 unreadable_files=0
```

## 5. 数えから外した物

- 試験の file（`src/test*`）: 63 file（どれも `EXCLUDED ... test_file`）。
- `src/` の中で、base と同じで追加行が無い file: 84。
- `src/` の外の、変えた file・足した file: 517（内訳の上位 .aidlc-version(1), .claude(333), .framework(1), .gitignore(1), aidlc(175), docs(5), package.json(1)）。code ではない文書・記録・設定・AI-DLC の engine の file。`package.json` は、scripts の 2 行（`test:store-resolution` = 本体・scenario・isolation の 3 つの試験をつなげた命令、`test:store-resolution-pg`）を足し、`test` と `test:claude-hook` の 2 行の終わりに `npm run test:store-resolution` を足した（試験の命令。code ではない）。

## 6. 限界と、見つけ方

- この測定は、作った席の手元で流した。CI（`ci.yml`）は網羅率を測らない（workflow は保護面で、変えるには Owner の exact-head が要る）。監査の席は、2 の命令と 3 つの script（下に全文と SHA-256）で、同じ数を出せる。
- 13 個の命令のうち、CI が流さない物がある: `test:antigravity-hook`・`test:transcript-stop`・emitter の試験（`test-kusabi-runtime-event-emitter.ts`）。そこで、CI の `run:` が届く 10 個の命令だけ（`claude-hook`・`codex-hook`・`gemini-hook`・`gemini-conversation-ingest`・`automatic-receive`・`direct-fleet-rollout`・`content-addressed-release`・`core`・`post-tool-hook`・`boot-recovery`）でも同じ判定を流した（同じ script・同じ時点。10 個とも終了コード 0。報告は完結していた = `COLLECTOR_DONE paths=12`）。結果は次のとおりで、CI が届く試験だけで 100% を満たす:

```
src/antigravity-session-start.ts: state=LOADED processes=3 added_lines=4 uncovered_lines=0
src/claude-session-start.ts: state=LOADED processes=18 added_lines=8 uncovered_lines=0
src/codex-session-start.ts: state=LOADED processes=41 added_lines=40 uncovered_lines=0
src/gemini-session-start.ts: state=LOADED processes=5 added_lines=4 uncovered_lines=0
src/kusabi-runtime-event-emitter.ts: state=LOADED processes=51 added_lines=31 uncovered_lines=0
src/restart-cli.ts: state=LOADED processes=75 added_lines=17 uncovered_lines=0
src/rotation-commit.ts: state=LOADED processes=42 added_lines=20 uncovered_lines=0
src/session-rotation-stop.ts: state=LOADED processes=20 added_lines=29 uncovered_lines=0
src/store-resolution.ts: state=LOADED processes=126 added_lines=240 uncovered_lines=0
src/stores/index.ts: state=LOADED processes=150 added_lines=54 uncovered_lines=0
src/stores/read-only-task-states.ts: state=LOADED processes=78 added_lines=4 uncovered_lines=0
src/transcript-stop-capture.ts: state=LOADED processes=24 added_lines=36 uncovered_lines=0
RESULT PASS changed_files=12 changed_lines=487 uncovered_lines=0 unreadable_files=0
```

- 使い捨ての PostgreSQL の試験（`test-store-resolution-pg.ts`）は、測定に入れていない（CI に PostgreSQL が無く、手元でだけ流す）。PostgreSQL の枝の行は、閉じた port・接続を数える listener を使う試験（`store-resolution-scenario`）で実行される。`restart-cli` の経由の試験は、親 process の event loop が子の実行の間止まる（spawnSync）ので listener は使えず、接続が拒まれた種類（環境変数の URL = `ECONNREFUSED`、設定の file の URL = `ENOENT`）で、どちらの URL が使われたかを区別する。
- V8 のブロックの網羅率を、source map で原文の行に直している。行の網羅率であり、分岐の網羅率ではない。1 行に複数の分岐がある時、一部の範囲が 0 回なら、その行を未実行に数える。
- `uncovered_lines=0` は、追加行が**実行された**ことだけを言う。正しい結果を確かめたかどうかは、試験の中身（`unit-test-instructions.md`）と監査が見る。

## 7. script 全文

### `merge-zero.mjs`（SHA-256 `ab76f8fc1699343ecb0eefd816ea0a09913495ecabe12fae15ddd9a14b9be701`、133 行）

````javascript
// Usage (from the repository root): node merge-zero.mjs <coverage-dir> <repo-relative path> [more paths...]
// Merges V8 block coverage across every process in the directory (max count per generated offset) and prints, per path:
//   == <path> state=LOADED|NOT_LOADED|MISSING processes=<n>
// LOADED: at least one process ran the file; the ORIGINAL source lines of ranges no process ran follow, as "<from>-<to>  <text>".
// NOT_LOADED: the file is in a report but no process ran it. MISSING: no report has a section for the file.
// The first line is "REPORT json_files=.. entries=.. loading_entries=.. unreadable_json=..": what the reports hold in all.
// Every section ends with "== <path> END ranges=<n>" (n = the range rows printed for it) and the last line of a normal
// run is "COLLECTOR_DONE paths=<n>" (n = the paths asked for): a report cut short has no such line, and the checker
// refuses it (IM-BF-02).
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { SourceMap } from "node:module";
import { fileURLToPath } from "node:url";

const [dir, ...paths] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node merge-zero.mjs <coverage-dir> <repo-relative path> [more paths...]");
  process.exit(2);
}
const root = realpathSync(process.cwd());
const files = [];
let unreadableJson = 0;
for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".json")).sort()) {
  try {
    files.push(JSON.parse(readFileSync(join(dir, name), "utf8")));
  } catch {
    unreadableJson += 1;
  }
}

/** The count of the widest range of the module: whether the module body ran in that process. */
function rootCount(entry) {
  let widest = null;
  for (const fn of entry.functions) {
    for (const range of fn.ranges) {
      const wider = widest === null || range.startOffset < widest.startOffset ||
        (range.startOffset === widest.startOffset && range.endOffset > widest.endOffset);
      if (wider) widest = range;
    }
  }
  return widest === null ? 0 : widest.count;
}

let entries = 0;
let loadingEntries = 0;
for (const json of files) {
  for (const entry of json.result) {
    if (!json["source-map-cache"]?.[entry.url]?.data) continue;
    entries += 1;
    if (rootCount(entry) > 0) loadingEntries += 1;
  }
}
console.log(`REPORT json_files=${files.length} entries=${entries} loading_entries=${loadingEntries} unreadable_json=${unreadableJson}`);

for (const path of paths) {
  const absolute = join(root, path);
  let merged = null;
  let cache = null;
  let processes = 0;
  for (const json of files) {
    for (const entry of json.result) {
      let entryPath;
      try {
        entryPath = fileURLToPath(entry.url);
      } catch {
        continue;
      }
      if (entryPath !== absolute) continue;
      const mapped = json["source-map-cache"]?.[entry.url];
      if (!mapped?.data) continue;
      cache = mapped;
      if (rootCount(entry) > 0) processes += 1;
      const size = mapped.lineLengths.reduce((sum, length) => sum + length + 1, 0);
      const counts = new Int32Array(size).fill(-1);
      const ranges = [];
      for (const fn of entry.functions) for (const range of fn.ranges) ranges.push(range);
      ranges.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
      for (const range of ranges) counts.fill(range.count, range.startOffset, Math.min(range.endOffset, size));
      if (merged === null) merged = counts;
      else for (let index = 0; index < size; index++) if (counts[index] > merged[index]) merged[index] = counts[index];
    }
  }
  if (merged === null) {
    console.log(`== ${path} state=MISSING processes=0`);
    console.log(`== ${path} END ranges=0`);
    continue;
  }
  if (processes === 0) {
    console.log(`== ${path} state=NOT_LOADED processes=0`);
    console.log(`== ${path} END ranges=0`);
    continue;
  }
  console.log(`== ${path} state=LOADED processes=${processes}`);
  const map = new SourceMap(cache.data);
  const original = cache.data.sourcesContent?.[0]?.split("\n") ?? [];
  const lineStarts = [];
  let offset = 0;
  for (const length of cache.lineLengths) {
    lineStarts.push(offset);
    offset += length + 1;
  }
  const locate = (position) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= position) low = mid;
      else high = mid - 1;
    }
    return { line: low, column: position - lineStarts[low] };
  };
  const rows = new Map();
  let start = -1;
  for (let index = 0; index <= merged.length; index++) {
    const zero = index < merged.length && merged[index] === 0;
    if (zero && start < 0) start = index;
    if (!zero && start >= 0) {
      const a = locate(start);
      const b = locate(index - 1);
      const first = map.findEntry(a.line, a.column);
      const last = map.findEntry(b.line, b.column);
      const from = (first.originalLine ?? 0) + 1;
      const to = (last.originalLine ?? 0) + 1;
      const key = `${from}-${to}`;
      if (!rows.has(key)) rows.set(key, { from, to, text: (original[from - 1] ?? "").trim().slice(0, 110) });
      start = -1;
    }
  }
  const printed = [...rows.values()].sort((x, y) => x.from - y.from);
  for (const row of printed) console.log(`${row.from}-${row.to}  ${row.text}`);
  console.log(`== ${path} END ranges=${printed.length}`);
}
console.log(`COLLECTOR_DONE paths=${paths.length}`);
````

### `changed-uncovered.py`（SHA-256 `4c73c560e3940c16e92fd2614623f8bc1aa67be15b6aee59a2370de256c340ce`、201 行）

````python
"""Usage (from the repository root):
  python3 -I changed-uncovered.py list  <base-commit>
  python3 -I changed-uncovered.py check <base-commit> <report-file>

list:  prints TARGET <path> added_lines=<n> for each code file under src/ (not starting with src/test) that has lines the base
       commit does not have, and EXCLUDED <path> <reason> for each other file under src/. Files outside src/ are only counted.
       Every file under src/ is compared with its own blob in the base commit (git show), never through the index: a file this
       working tree does not track but the base has would otherwise read as deleted and its added lines would be lost.
check: recomputes the same targets, reads the report merge-zero.mjs printed, and gives each target one state:
       LOADED (ran; added lines that fall in a zero-count range are uncovered), NOT_LOADED or MISSING (all added lines count as
       uncovered and the file is counted as unreadable), INCOMPLETE (the section has no END line, or its END count differs
       from the rows it holds: counted as unreadable), UNKNOWN (the report cannot be trusted as a whole: every target).
       A report is trusted only when it is complete: a REPORT line first, a "== <path> END ranges=<n>" line closing every
       section, and a last line "COLLECTOR_DONE paths=<n>" with n equal to the sections it holds, followed by a newline and
       nothing else. A report cut short anywhere (the collector failed or the pipe closed) lacks them (IM-BF-02).
       The last line is RESULT PASS|FAIL changed_files=.. changed_lines=.. uncovered_lines=.. unreadable_files=..
       Exit 0 only for PASS: at least one target, no uncovered line, no unreadable file, a report that can be read."""
import os
import re
import subprocess
import sys
import tempfile


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, encoding="utf8", errors="replace")


def in_base(base, path):
    return git("cat-file", "-e", f"{base}:{path}").returncode == 0


def added_lines(base, path):
    blob = git("show", f"{base}:{path}") if in_base(base, path) else None
    if blob is None:
        with open(path, encoding="utf8") as handle:
            return set(range(1, sum(1 for _ in handle) + 1))
    with tempfile.NamedTemporaryFile("w", encoding="utf8", suffix=".base", delete=False) as handle:
        handle.write(blob.stdout)
        old = handle.name
    try:
        out = git("diff", "--no-index", "--no-color", "-U0", "--", old, path).stdout
    finally:
        os.unlink(old)
    lines = set()
    for hunk in re.finditer(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", out, re.M):
        start, count = int(hunk.group(1)), int(hunk.group(2) or 1)
        lines.update(range(start, start + count))
    return lines


CODE = (".ts", ".mts", ".js", ".mjs")


def outside_src(base):
    """How many changed or new files are outside src/, and which top-level folders they are in."""
    tracked = git("diff", "--no-renames", "--name-only", "--diff-filter=AM", base).stdout.split("\n")
    untracked = git("ls-files", "--others", "--exclude-standard").stdout.split("\n")
    names = sorted({p for p in tracked + untracked if p and not p.startswith("src/")})
    tops = {}
    for name in names:
        top = name.split("/")[0]
        tops[top] = tops.get(top, 0) + 1
    return len(names), ", ".join(f"{top}({count})" for top, count in sorted(tops.items()))


def classify(base):
    """Returns (targets: {path: added line set}, excluded: [(path, reason)]) for the files under src/."""
    names = git("ls-files", "--cached", "--others", "--exclude-standard", "--", "src").stdout.split("\n")
    targets, excluded = {}, []
    for path in sorted({n for n in names if n and os.path.isfile(n)}):
        if path.startswith("src/test"):
            excluded.append((path, "test_file"))
        elif not path.endswith(CODE):
            excluded.append((path, "not_code"))
        else:
            lines = added_lines(base, path)
            if lines:
                targets[path] = lines
            elif in_base(base, path):
                excluded.append((path, "no_added_lines"))
            else:
                excluded.append((path, "empty_new_file"))
    return targets, excluded


def print_excluded(base, excluded):
    for path, reason in excluded:
        if reason != "no_added_lines":
            print(f"EXCLUDED {path} {reason}")
    unchanged = sum(1 for _, reason in excluded if reason == "no_added_lines")
    count, tops = outside_src(base)
    print(f"EXCLUDED_UNCHANGED_UNDER_SRC files={unchanged}")
    print(f"EXCLUDED_OUTSIDE_SRC files={count} top_dirs={tops}")


def read_report(report_path):
    """Returns (header or None, {path: {"state", "processes", "ranges", "end"}}, trailer) for the report the collector printed.
    trailer = {"sections": number of section lines, "done": the n of COLLECTOR_DONE or None, "after_done": text after it,
    "final_newline": whether the file ends with a newline}."""
    text = open(report_path, encoding="utf8").read()
    header, sections, current = None, {}, None
    trailer = {"sections": 0, "done": None, "after_done": False, "final_newline": text.endswith("\n")}
    for row in text.split("\n"):
        if trailer["done"] is not None and row != "":
            trailer["after_done"] = True
        head = re.match(r"^REPORT json_files=(\d+) entries=(\d+) loading_entries=(\d+) unreadable_json=(\d+)$", row)
        if head:
            header = tuple(int(value) for value in head.groups())
            continue
        section = re.match(r"^== (\S+) state=(\S+) processes=(\d+)$", row)
        if section:
            current = section.group(1)
            trailer["sections"] += 1
            sections[current] = {"state": section.group(2), "processes": int(section.group(3)), "ranges": [], "end": None}
            continue
        end = re.match(r"^== (\S+) END ranges=(\d+)$", row)
        if end:
            if current == end.group(1) and sections[current]["end"] is None:
                sections[current]["end"] = int(end.group(2))
            current = None
            continue
        done = re.match(r"^COLLECTOR_DONE paths=(\d+)$", row)
        if done:
            trailer["done"] = int(done.group(1))
            continue
        zero = re.match(r"^(\d+)-(\d+)\s+(.*)$", row)
        if zero and current:
            sections[current]["ranges"].append((int(zero.group(1)), int(zero.group(2)), zero.group(3)))
    return header, sections, trailer


def unknown_reason(header, trailer):
    if header is None:
        return "no REPORT line"
    if trailer["done"] is None:
        return "the report has no COLLECTOR_DONE line (it was cut short, or the collector did not finish)"
    if trailer["after_done"] or not trailer["final_newline"]:
        return "the report does not end with COLLECTOR_DONE and a newline"
    if trailer["done"] != trailer["sections"] or trailer["sections"] != trailer["distinct"]:
        return f"COLLECTOR_DONE paths={trailer['done']} but the report holds {trailer['sections']} section line(s)"
    json_files, entries, loading, unreadable = header
    if unreadable > 0:
        return f"{unreadable} report file(s) could not be read"
    if json_files == 0:
        return "the report directory holds no report"
    if entries == 0:
        return "no report has a section with a source map"
    if loading == 0:
        return "no process ran any file"
    return None


def main(argv):
    if len(argv) >= 3 and argv[1] == "list":
        targets, excluded = classify(argv[2])
        for path in sorted(targets):
            print(f"TARGET {path} added_lines={len(targets[path])}")
        print_excluded(argv[2], excluded)
        return 0
    if len(argv) == 4 and argv[1] == "check":
        base, report_path = argv[2], argv[3]
        targets, excluded = classify(base)
        header, sections, trailer = read_report(report_path)
        trailer["distinct"] = len(sections)
        unknown = unknown_reason(header, trailer)
        print_excluded(base, excluded)
        if unknown:
            print(f"REPORT_UNKNOWN {unknown}")
        changed_lines = uncovered = unreadable = 0
        for path in sorted(targets):
            added = targets[path]
            changed_lines += len(added)
            section = sections.get(path)
            state = "UNKNOWN" if unknown else (section["state"] if section else "MISSING")
            if section and not unknown and section["end"] != len(section["ranges"]):
                state = "INCOMPLETE"
            if state not in ("LOADED", "NOT_LOADED", "MISSING", "INCOMPLETE", "UNKNOWN"):
                state = "MISSING"
            if state == "LOADED":
                missed = {n for a, b, _ in section["ranges"] for n in range(a, b + 1) if n in added}
                uncovered += len(missed)
                print(f"{path}: state=LOADED processes={section['processes']} added_lines={len(added)} uncovered_lines={len(missed)}")
                for a, b, text in section["ranges"]:
                    if any(n in added for n in range(a, b + 1)):
                        print(f"    {a}-{b}  {text}")
            else:
                uncovered += len(added)
                unreadable += 1
                print(f"{path}: state={state} added_lines={len(added)} uncovered_lines={len(added)}")
        if not targets:
            print("NO_TARGETS no file with added lines under src/ (a measurement of nothing is not a pass)")
        ok = bool(targets) and uncovered == 0 and unreadable == 0 and not unknown
        print(f"RESULT {'PASS' if ok else 'FAIL'} changed_files={len(targets)} changed_lines={changed_lines} "
              f"uncovered_lines={uncovered} unreadable_files={unreadable}")
        return 0 if ok else 1
    print(__doc__, file=sys.stderr)
    return 2


sys.exit(main(sys.argv))
````

### `coverage-selftest.mjs`（SHA-256 `8db67d66922754ca956273521c6c0a80a13a7e25d682b2b9cc72eada61ca43b8`、246 行）

````javascript
// Usage: node coverage-selftest.mjs <folder holding merge-zero.mjs and changed-uncovered.py> <repository root that has node_modules/.bin/tsx>
// U14: gives the two measuring scripts their inputs in a throwaway git repository, with real V8 coverage from tsx, and checks the result.
//   n1 empty report -> FAIL     n2 changed file not loaded -> FAIL    n3 changed file has no section -> FAIL
//   n4 one of two changed files not loaded -> FAIL    n5 loaded, zero-count range on an added line -> FAIL    n6 all run -> PASS
//   n9 (IM-BF-02) a report cut short at every line boundary and in the middle of every line, of a report that would FAIL and of one
//      that would PASS -> FAIL each time; the two complete reports decide on their content (FAIL with the uncovered line, PASS)
//   n10 (IM-BF-02) a section without its END line, or with fewer rows than its END count, or a missing section, or a wrong
//      COLLECTOR_DONE count, or text after COLLECTOR_DONE -> FAIL, also for a report that was PASS
// Prints one line per case; the last line is "coverage-selftest: <n> cases passed". Any wrong result exits 1.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [scriptsDir, repoRoot] = process.argv.slice(2).map((value) => (value ? resolve(value) : value));
if (!scriptsDir || !repoRoot) {
  console.error("usage: node coverage-selftest.mjs <scripts folder> <repository root>");
  process.exit(2);
}
const tsx = join(repoRoot, "node_modules", ".bin", "tsx");
const work = realpathSync(mkdtempSync(join(tmpdir(), "cov-selftest-")));
const repo = join(work, "repo");
mkdirSync(join(repo, "src"), { recursive: true });
mkdirSync(join(repo, "docs"));

const run = (command, args, options = {}) => spawnSync(command, args, { encoding: "utf8", cwd: repo, ...options });
const git = (...args) => {
  const ran = run("git", args);
  assert.equal(ran.status, 0, `git ${args.join(" ")}: ${ran.stderr}`);
  return ran.stdout.trim();
};

writeFileSync(join(repo, "package.json"), '{"type":"module"}\n');
writeFileSync(join(repo, "src", "a.ts"), "export function a1(): number {\n  return 1;\n}\n");
writeFileSync(join(repo, "src", "b.ts"), "export function b1(): number {\n  return 1;\n}\n");
writeFileSync(join(repo, "src", "c.ts"), "export function c1(): number {\n  return 1;\n}\n");
writeFileSync(join(repo, "docs", "note.md"), "note\n");
git("init", "-q");
git("config", "user.email", "selftest@example.invalid");
git("config", "user.name", "selftest");
git("add", ".");
git("commit", "-q", "-m", "base 0");
const base0 = git("rev-parse", "HEAD");
writeFileSync(join(repo, "src", "b.ts"), "export function b1(): number {\n  return 1;\n}\nexport function b2(): number {\n  return 2;\n}\n");
git("commit", "-q", "-am", "base 1 (b.ts already changed)");
const base1 = git("rev-parse", "HEAD");
writeFileSync(
  join(repo, "src", "a.ts"),
  'export function a1(): number {\n  return 1;\n}\nexport function a2(flag: boolean): string {\n  if (flag) {\n    return "yes";\n  }\n  return "no";\n}\n',
);
writeFileSync(join(repo, "docs", "note.md"), "note changed\n");
const drivers = {
  full: 'import { a2 } from "./a.js";\nimport { b2 } from "./b.js";\na2(true);\na2(false);\nb2();\n',
  partial: 'import { a2 } from "./a.js";\nimport { b2 } from "./b.js";\na2(true);\nb2();\n',
  onlyA: 'import { a2 } from "./a.js";\na2(true);\na2(false);\n',
  onlyB: 'import { b2 } from "./b.js";\nb2();\n',
};

function measure(name) {
  const dir = join(work, `cov-${name}`);
  mkdirSync(dir);
  writeFileSync(join(repo, "src", "test-driver.ts"), drivers[name]);
  const ran = run(tsx, ["src/test-driver.ts"], { env: { ...process.env, NODE_V8_COVERAGE: dir } });
  assert.equal(ran.status, 0, `driver ${name}: ${ran.stderr}`);
  return dir;
}

/** Makes `file` look like a module that a report lists but no process ran: every range count in its entries becomes 0. */
function zeroTheFile(dir, file) {
  const copy = `${dir}-zeroed-${file.replace(/\W/g, "_")}`;
  cpSync(dir, copy, { recursive: true });
  let changed = 0;
  for (const name of readdirSync(copy).filter((entry) => entry.endsWith(".json"))) {
    const path = join(copy, name);
    const json = JSON.parse(readFileSync(path, "utf8"));
    for (const entry of json.result) {
      if (!entry.url.endsWith(`/${file}`)) continue;
      for (const fn of entry.functions) for (const range of fn.ranges) range.count = 0;
      changed += 1;
    }
    writeFileSync(path, JSON.stringify(json));
  }
  assert.ok(changed > 0, `${file} is in a real report, so it can be zeroed`);
  return copy;
}

function judge(base, coverageDir) {
  const targets = run("python3", ["-I", join(scriptsDir, "changed-uncovered.py"), "list", base]);
  assert.equal(targets.status, 0, targets.stderr);
  const paths = targets.stdout.split("\n").filter((row) => row.startsWith("TARGET ")).map((row) => row.split(" ")[1]);
  const merged = run("node", [join(scriptsDir, "merge-zero.mjs"), coverageDir, ...paths]);
  assert.equal(merged.status, 0, merged.stderr);
  const reportPath = join(work, "zero.txt");
  writeFileSync(reportPath, merged.stdout);
  const checked = run("python3", ["-I", join(scriptsDir, "changed-uncovered.py"), "check", base, reportPath]);
  return { targets: targets.stdout, report: merged.stdout, ...checked };
}

const resultLine = (out) => out.trim().split("\n").at(-1);
let passed = 0;
function expectFail(name, answer, pattern) {
  assert.notEqual(answer.status, 0, `${name}: exit code is not 0\n${answer.stdout}`);
  const last = resultLine(answer.stdout);
  assert.match(last, /^RESULT FAIL /, `${name}: last line is RESULT FAIL, got ${last}`);
  assert.match(answer.stdout, pattern, `${name}: ${pattern}\n${answer.stdout}`);
  passed += 1;
  console.log(`ok - ${name} exit=${answer.status} ${last}`);
}

try {
  const full = measure("full");
  const partial = measure("partial");
  const onlyA = measure("onlyA");
  const onlyB = measure("onlyB");

  const listed = judge(base0, full).targets;
  assert.match(listed, /^TARGET src\/a\.ts added_lines=6$/m);
  assert.match(listed, /^TARGET src\/b\.ts added_lines=3$/m);
  assert.match(listed, /^EXCLUDED src\/test-driver\.ts test_file$/m, "the excluded test file is named");
  assert.match(listed, /^EXCLUDED_OUTSIDE_SRC files=1 top_dirs=docs\(1\)$/m, "the files outside src are counted");
  assert.match(listed, /^EXCLUDED_UNCHANGED_UNDER_SRC files=1$/m, "the unchanged file under src is counted");

  const emptyDir = join(work, "cov-empty");
  mkdirSync(emptyDir);
  expectFail("n1 empty report", judge(base0, emptyDir), /REPORT_UNKNOWN the report directory holds no report[\s\S]*state=UNKNOWN[\s\S]*unreadable_files=2/);

  expectFail(
    "n2 changed file is in the report but no process ran it",
    judge(base1, zeroTheFile(full, "src/a.ts")),
    /src\/a\.ts: state=NOT_LOADED added_lines=6 uncovered_lines=6[\s\S]*RESULT FAIL changed_files=1 changed_lines=6 uncovered_lines=6 unreadable_files=1/,
  );

  expectFail(
    "n3 the report has no section for the changed file",
    judge(base1, onlyB),
    /src\/a\.ts: state=MISSING added_lines=6 uncovered_lines=6[\s\S]*unreadable_files=1/,
  );

  const n4 = judge(base0, zeroTheFile(full, "src/b.ts"));
  expectFail("n4 one of two changed files is not loaded", n4, /src\/a\.ts: state=LOADED[\s\S]*src\/b\.ts: state=NOT_LOADED[\s\S]*uncovered_lines=3 unreadable_files=1/);
  assert.match(n4.stdout, /src\/a\.ts: state=LOADED processes=\d+ added_lines=6 uncovered_lines=0/, "n4: the loaded file itself is clean");

  const n5 = judge(base1, partial);
  expectFail("n5 loaded, a zero-count range on an added line", n5, /src\/a\.ts: state=LOADED[\s\S]*uncovered_lines=[1-9]\d*[\s\S]*unreadable_files=0/);
  assert.match(n5.stdout, /^\s+\d+-\d+\s+return "no";/m, "n5: the line that did not run is named");

  const n6 = judge(base0, full);
  assert.equal(n6.status, 0, `n6: exit code is 0\n${n6.stdout}`);
  assert.match(resultLine(n6.stdout), /^RESULT PASS changed_files=2 changed_lines=9 uncovered_lines=0 unreadable_files=0$/);
  assert.match(n6.stdout, /src\/a\.ts: state=LOADED[\s\S]*src\/b\.ts: state=LOADED/);
  assert.match(n6.report, /^REPORT /, "n6: the report starts with REPORT");
  assert.match(n6.report, /\n== src\/a\.ts END ranges=1\n/, "n6: a section ends with its END line, counting the row it holds");
  assert.match(n6.report, /\nCOLLECTOR_DONE paths=2\n$/, "n6: the report ends with COLLECTOR_DONE and a newline");
  passed += 1;
  console.log(`ok - n6 all changed files ran, no zero-count range on an added line exit=${n6.status} ${resultLine(n6.stdout)}`);

  // a measurement of nothing is not a pass either
  git("stash", "-q", "--include-untracked");
  const empty = judge("HEAD", full);
  git("stash", "pop", "-q");
  assert.notEqual(empty.status, 0, "no changed file: not a pass");
  assert.match(empty.stdout, /NO_TARGETS[\s\S]*RESULT FAIL changed_files=0/);
  passed += 1;
  console.log(`ok - n7 no changed file under src is not a pass exit=${empty.status} ${resultLine(empty.stdout)}`);

  // a file the base has but this working tree does not track (the index says "deleted"): its added lines must still be targets
  writeFileSync(join(repo, "src", "c.ts"), "export function c1(): number {\n  return 1;\n}\nexport function c2(): number {\n  return 2;\n}\n");
  git("rm", "--cached", "-q", "src/c.ts");
  const hidden = run("python3", ["-I", join(scriptsDir, "changed-uncovered.py"), "list", base0]);
  assert.match(hidden.stdout, /^TARGET src\/c\.ts added_lines=3$/m, `n8: the added lines of an untracked file the base has are found\n${hidden.stdout}`);
  assert.equal(run("git", ["diff", "-U0", base0, "--", "src/c.ts"]).stdout.includes("deleted file mode"), true, "n8: plain git diff reads that file as deleted (why the script does not use it)");
  passed += 1;
  console.log("ok - n8 added lines of a file the working tree does not track but the base has are still targets");

  // IM-BF-02: a report cut short is not a pass wherever it is cut, and a complete report decides on its content.
  git("checkout", "HEAD", "--", "src/c.ts"); // n8 left c.ts changed and untracked: the two targets of n6 are the targets again
  const checkText = (base, text) => {
    const cutPath = join(work, "cut.txt");
    writeFileSync(cutPath, text);
    return run("python3", ["-I", join(scriptsDir, "changed-uncovered.py"), "check", base, cutPath]);
  };
  const completeUncovered = judge(base0, partial);
  const completePass = n6;
  assert.equal(completeUncovered.status, 1, "n9: the complete report with an uncovered added line fails");
  assert.match(completeUncovered.stdout, /src\/a\.ts: state=LOADED[\s\S]*uncovered_lines=[1-9]/, "n9: it fails because of the line, not because the report is cut");
  assert.doesNotMatch(completeUncovered.stdout, /REPORT_UNKNOWN|INCOMPLETE/, "n9: a complete report is not read as cut short");
  assert.equal(completePass.status, 0, "n9: the complete report with every added line run passes");
  const cuts = (text) => {
    const lines = text.split("\n").slice(0, -1);
    const out = [];
    for (let k = 0; k < lines.length; k++) {
      const head = lines.slice(0, k).join("\n") + (k > 0 ? "\n" : "");
      out.push({ at: `after ${k} line(s)`, text: head });
      out.push({ at: `in the middle of line ${k + 1}`, text: head + lines[k].slice(0, Math.floor(lines[k].length / 2)) });
    }
    out.push({ at: "before the final newline", text: text.slice(0, -1) });
    return out;
  };
  for (const [name, report] of [
    ["a report that would FAIL on its content", completeUncovered.report],
    ["a report that would PASS", completePass.report],
  ]) {
    const all = cuts(report);
    for (const cut of all) {
      const answer = checkText(base0, cut.text);
      assert.notEqual(answer.status, 0, `n9: ${name} cut ${cut.at} is not a pass\n${answer.stdout}`);
      assert.match(resultLine(answer.stdout), /^RESULT FAIL /, `n9: ${name} cut ${cut.at}`);
    }
    passed += 1;
    console.log(`ok - n9 ${name}, cut short in ${all.length} places (every line boundary and the middle of every line): FAIL each time`);
  }
  const afterSectionLine = completePass.report.slice(0, completePass.report.indexOf("\n", completePass.report.indexOf("== src/a.ts state=LOADED")) + 1);
  const named = checkText(base0, afterSectionLine);
  assert.match(named.stdout, /REPORT_UNKNOWN the report has no COLLECTOR_DONE line/, "n9: a report cut right after a section line is named as cut short");
  assert.match(resultLine(named.stdout), /^RESULT FAIL changed_files=2 /);
  passed += 1;
  console.log("ok - n9 a report cut right after the section line is named: REPORT_UNKNOWN the report has no COLLECTOR_DONE line");

  const dropLines = (text, drop) => text.split("\n").filter((row) => !drop(row)).join("\n");
  const dropSection = (text, path) => {
    const rows = text.split("\n");
    const start = rows.findIndex((row) => row.startsWith(`== ${path} state=`));
    const end = rows.findIndex((row) => row.startsWith(`== ${path} END `));
    return rows.filter((_, index) => index < start || index > end).join("\n");
  };
  const firstRow = completeUncovered.report.split("\n").find((row) => /^\d+-\d+ /.test(row));
  assert.ok(firstRow, "n10: the report that fails has a range row to drop");
  const cases10 = [
    ["a section without its END line (it was a PASS report)", checkText(base0, dropLines(completePass.report, (row) => /^== src\/a\.ts END ranges=\d+$/.test(row))), /src\/a\.ts: state=INCOMPLETE/],
    ["a section with fewer rows than its END count", checkText(base0, dropLines(completeUncovered.report, (row) => row === firstRow)), /src\/a\.ts: state=INCOMPLETE/],
    ["a missing section while COLLECTOR_DONE still counts it", checkText(base0, dropSection(completePass.report, "src/b.ts")), /REPORT_UNKNOWN COLLECTOR_DONE paths=2 but the report holds 1 section line/],
    ["a wrong COLLECTOR_DONE count", checkText(base0, completePass.report.replace("COLLECTOR_DONE paths=2", "COLLECTOR_DONE paths=3")), /REPORT_UNKNOWN COLLECTOR_DONE paths=3 but the report holds 2 section line/],
    ["text after COLLECTOR_DONE", checkText(base0, `${completePass.report}== src/a.ts state=LOADED processes=1\n`), /REPORT_UNKNOWN the report does not end with COLLECTOR_DONE and a newline/],
  ];
  for (const [name, answer, pattern] of cases10) {
    assert.notEqual(answer.status, 0, `n10: ${name} is not a pass\n${answer.stdout}`);
    assert.match(resultLine(answer.stdout), /^RESULT FAIL /, `n10: ${name}`);
    assert.match(answer.stdout, pattern, `n10: ${name}\n${answer.stdout}`);
    passed += 1;
    console.log(`ok - n10 ${name}: FAIL`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`coverage-selftest: ${passed} cases passed`);
````
