# 網羅率の測り方と結果 — 保存先の決め方を 1 つの関数にする（取り組み 261113-store-resolution-fix）

この文書は、`code-generation-plan.md` の Step 12（R-05・D11・SR-BF-03）の記録。測った時点は 2026-11-16T02:44:46Z、Node は v26.13.1、base は origin/main の `27d7f8fc9146e826883b045c1fdca93cc11f93e7`。数は、この文書の中の命令の出力から写した値で、手で数えていない。

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
| UNKNOWN | 報告が空、または process が何も実行していない（`REPORT_UNKNOWN`） | 全 target を同上 |

PASS は、`RESULT PASS` の 1 行だけ。条件は、対象が 1 つ以上・未実行の追加行が 0・読めなかった file が 0・読める報告があること。対象が 0 件の測定（`NO_TARGETS`）は PASS にしない。行の一部の範囲だけが 0 回の時も、その行を未実行に数える（厳しい側）。

## 2. 手順（作業場の根から）

1. 対象を出す: `python3 -I changed-uncovered.py list 27d7f8f`（`TARGET <path> added_lines=<n>` と、外した file の `EXCLUDED` の行）。
2. 全試験の命令を、**同じ** `NODE_V8_COVERAGE` の folder に流す（子 process の分も集まる）。使い捨ての `HOME`（中に `.agent-memory`）と `KUSABI_TEST_TMPDIR` を渡し、`AGENT_MEMORY_DB_TYPE`・`AGENT_MEMORY_DATABASE_URL`・`DATABASE_URL` を外す。命令は 13 個: `npm run test:claude-hook`・`test:codex-hook`・`test:gemini-hook`・`test:gemini-conversation-ingest`・`test:antigravity-hook`・`test:automatic-receive`・`test:transcript-stop`・`test:kusabi-direct-fleet-rollout`・`test:kusabi-content-addressed-runtime-release`、`npx tsx src/test-kusabi-runtime-event-emitter.ts`、`npx tsx src/test.ts`、`env AGENT_MEMORY_DB_TYPE=sqlite npx tsx src/test-post-tool-hook.ts`、`npx tsx src/test-boot-recovery.ts`。新しい 2 つの試験（`test-store-resolution.ts`・`test-store-resolution-scenario.ts`）は `test:claude-hook` の連なりの最後に入っている。
3. 合算: `node merge-zero.mjs <folder> <対象の path ...> > zero.txt`（process をまたいで、offset ごとに回数の最大を取る）。
4. 判定: `python3 -I changed-uncovered.py check 27d7f8f zero.txt`。終了コードは PASS だけ 0。
5. 自己試験: `node coverage-selftest.mjs <script の folder> <node_modules/.bin/tsx のある根>`（3 に結果）。

## 3. 自己試験（U14。2 つの script が間違った答えを出さないことの確かめ）

使い捨ての git repository に、本物の V8 の報告（tsx）を作って 2 つの script に渡す。n1〜n5・n7 は失敗（終了コード 1）、n6 は PASS（終了コード 0）、n8 は「作業場が追跡していない file の追加行も対象になる」ことの確かめ。コマンドの終了コード 0（8 件とも期待どおり）。

```
ok - n1 empty report exit=1 RESULT FAIL changed_files=2 changed_lines=9 uncovered_lines=9 unreadable_files=2
ok - n2 changed file is in the report but no process ran it exit=1 RESULT FAIL changed_files=1 changed_lines=6 uncovered_lines=6 unreadable_files=1
ok - n3 the report has no section for the changed file exit=1 RESULT FAIL changed_files=1 changed_lines=6 uncovered_lines=6 unreadable_files=1
ok - n4 one of two changed files is not loaded exit=1 RESULT FAIL changed_files=2 changed_lines=9 uncovered_lines=3 unreadable_files=1
ok - n5 loaded, a zero-count range on an added line exit=1 RESULT FAIL changed_files=1 changed_lines=6 uncovered_lines=1 unreadable_files=0
ok - n6 all changed files ran, no zero-count range on an added line exit=0 RESULT PASS changed_files=2 changed_lines=9 uncovered_lines=0 unreadable_files=0
ok - n7 no changed file under src is not a pass exit=1 RESULT FAIL changed_files=0 changed_lines=0 uncovered_lines=0 unreadable_files=0
ok - n8 added lines of a file the working tree does not track but the base has are still targets
coverage-selftest: 8 cases passed
```

## 4. 測定の結果

測定の命令 13 個は、すべて終了コード 0（最後の測定）。報告は 429 個の JSON、source map のある節 17833、そのうち process が実行した節 17833、読めなかった JSON 0。

```
EXCLUDED_UNCHANGED_UNDER_SRC files=84
EXCLUDED_OUTSIDE_SRC files=510 top_dirs=.aidlc-version(1), .claude(333), .framework(1), .gitignore(1), aidlc(169), docs(4), package.json(1)
src/antigravity-session-start.ts: state=LOADED processes=4 added_lines=4 uncovered_lines=0
src/claude-session-start.ts: state=LOADED processes=19 added_lines=8 uncovered_lines=0
src/codex-session-start.ts: state=LOADED processes=44 added_lines=40 uncovered_lines=0
src/gemini-session-start.ts: state=LOADED processes=5 added_lines=4 uncovered_lines=0
src/kusabi-runtime-event-emitter.ts: state=LOADED processes=52 added_lines=31 uncovered_lines=0
src/restart-cli.ts: state=LOADED processes=60 added_lines=17 uncovered_lines=0
src/rotation-commit.ts: state=LOADED processes=45 added_lines=20 uncovered_lines=0
src/session-rotation-stop.ts: state=LOADED processes=19 added_lines=29 uncovered_lines=0
src/store-resolution.ts: state=LOADED processes=112 added_lines=240 uncovered_lines=0
src/stores/index.ts: state=LOADED processes=138 added_lines=41 uncovered_lines=0
src/stores/read-only-task-states.ts: state=LOADED processes=62 added_lines=4 uncovered_lines=0
src/transcript-stop-capture.ts: state=LOADED processes=23 added_lines=36 uncovered_lines=0
RESULT PASS changed_files=12 changed_lines=474 uncovered_lines=0 unreadable_files=0
```

- 対象 12 file、追加行 474、未実行 0、読めなかった file 0。**100% を満たした**（この文書の時点）。数えから外した追加行は無い。
- 測り直しの経緯: 最初の測定は `RESULT FAIL changed_files=12 changed_lines=460 uncovered_lines=3`（`antigravity-session-start.ts` の `loadAntigravityHookDataFromStore` の 2 行が、どの試験も呼ばず未実行。`stores/index.ts` の `requireStoreBackend` の、閉じる処理が失敗した時の分岐 1 行が未実行）。試験を 2 つ足した（`U5 (antigravity)`・`seam`）。次の測定は `RESULT PASS changed_files=12 changed_lines=460 uncovered_lines=0`。その後、`restart-cli handoff-source` が拒否の種類を標準エラーに出すよう直した（FR3.4。`memory.md`）ので追加行が 460 から 474 になり、測り直した（`RESULT PASS`）。さらに、CI が届く命令だけで測ると 474 行のうち 8 行が未実行だった（Gemini の loader の 2 行、emitter の 6 行。CI が流さない試験の側でだけ実行されていた）ので、試験を 2 つ足した（`U5 (gemini)`・`U10 (in process)`）。**この文書の結果は、その後の最後の測定**（全部の命令・CI が届く命令だけの 2 通りとも `RESULT PASS`）。最初の測定の出力（参考）:

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

- 試験の file（`src/test*`）: 61 file（どれも `EXCLUDED ... test_file`）。
- `src/` の中で、base と同じで追加行が無い file: 84。
- `src/` の外の、変えた file・足した file: 510（内訳の上位 .aidlc-version(1), .claude(333), .framework(1), .gitignore(1), aidlc(169), docs(4), package.json(1)）。code ではない文書・記録・設定・AI-DLC の engine の file。`package.json` は、scripts の 2 行（`test:store-resolution`・`test:store-resolution-pg`）を足し、`test` と `test:claude-hook` の 2 行の終わりに `npm run test:store-resolution` を足した（試験の命令。code ではない）。

## 6. 限界と、見つけ方

- この測定は、作った席の手元で流した。CI（`ci.yml`）は網羅率を測らない（workflow は保護面で、変えるには Owner の exact-head が要る）。監査の席は、2 の命令と 3 つの script（下に全文と SHA-256）で、同じ数を出せる。
- 13 個の命令のうち、CI が流さない物がある: `test:antigravity-hook`・`test:transcript-stop`・emitter の試験（`test-kusabi-runtime-event-emitter.ts`）。そこで、CI の `run:` が届く 10 個の命令だけ（`claude-hook`・`codex-hook`・`gemini-hook`・`gemini-conversation-ingest`・`automatic-receive`・`direct-fleet-rollout`・`content-addressed-release`・`core`・`post-tool-hook`・`boot-recovery`）でも同じ判定を流した（同じ script・同じ時点。10 個とも終了コード 0）。結果は次のとおりで、CI が届く試験だけで 100% を満たす:

```
src/antigravity-session-start.ts: state=LOADED processes=2 added_lines=4 uncovered_lines=0
src/claude-session-start.ts: state=LOADED processes=18 added_lines=8 uncovered_lines=0
src/codex-session-start.ts: state=LOADED processes=35 added_lines=40 uncovered_lines=0
src/gemini-session-start.ts: state=LOADED processes=4 added_lines=4 uncovered_lines=0
src/kusabi-runtime-event-emitter.ts: state=LOADED processes=40 added_lines=31 uncovered_lines=0
src/restart-cli.ts: state=LOADED processes=60 added_lines=17 uncovered_lines=0
src/rotation-commit.ts: state=LOADED processes=36 added_lines=20 uncovered_lines=0
src/session-rotation-stop.ts: state=LOADED processes=19 added_lines=29 uncovered_lines=0
src/store-resolution.ts: state=LOADED processes=100 added_lines=240 uncovered_lines=0
src/stores/index.ts: state=LOADED processes=129 added_lines=41 uncovered_lines=0
src/stores/read-only-task-states.ts: state=LOADED processes=62 added_lines=4 uncovered_lines=0
src/transcript-stop-capture.ts: state=LOADED processes=20 added_lines=36 uncovered_lines=0
RESULT PASS changed_files=12 changed_lines=474 uncovered_lines=0 unreadable_files=0
```

- 使い捨ての PostgreSQL の試験（`test-store-resolution-pg.ts`）は、測定に入れていない（CI に PostgreSQL が無く、手元でだけ流す）。PostgreSQL の枝の行は、閉じた port・接続を数える listener を使う試験（`store-resolution-scenario`）で実行される。
- V8 のブロックの網羅率を、source map で原文の行に直している。行の網羅率であり、分岐の網羅率ではない。1 行に複数の分岐がある時、一部の範囲が 0 回なら、その行を未実行に数える。
- `uncovered_lines=0` は、追加行が**実行された**ことだけを言う。正しい結果を確かめたかどうかは、試験の中身（`unit-test-instructions.md`）と監査が見る。

## 7. script 全文

### `merge-zero.mjs`（SHA-256 `2ffcfb23cd8e54e1940b271fd743b087fe0dc2519c981dde45f4053d363df7c2`、125 行）

````javascript
// Usage (from the repository root): node merge-zero.mjs <coverage-dir> <repo-relative path> [more paths...]
// Merges V8 block coverage across every process in the directory (max count per generated offset) and prints, per path:
//   == <path> state=LOADED|NOT_LOADED|MISSING processes=<n>
// LOADED: at least one process ran the file; the ORIGINAL source lines of ranges no process ran follow, as "<from>-<to>  <text>".
// NOT_LOADED: the file is in a report but no process ran it. MISSING: no report has a section for the file.
// The first line is "REPORT json_files=.. entries=.. loading_entries=.. unreadable_json=..": what the reports hold in all.
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
    continue;
  }
  if (processes === 0) {
    console.log(`== ${path} state=NOT_LOADED processes=0`);
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
  for (const row of [...rows.values()].sort((x, y) => x.from - y.from)) console.log(`${row.from}-${row.to}  ${row.text}`);
}
````

### `changed-uncovered.py`（SHA-256 `8c6a09b7e6b83b01eb1f1d0094abfb4ccf0506a94de256c6d7800c465d90f8f4`、171 行）

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
       uncovered and the file is counted as unreadable), UNKNOWN (the report is empty or no process ran anything: every target).
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
    """Returns (header or None, {path: {"state", "processes", "ranges"}})."""
    header, sections, current = None, {}, None
    for row in open(report_path, encoding="utf8").read().split("\n"):
        head = re.match(r"^REPORT json_files=(\d+) entries=(\d+) loading_entries=(\d+) unreadable_json=(\d+)$", row)
        if head:
            header = tuple(int(value) for value in head.groups())
            continue
        section = re.match(r"^== (\S+) state=(\S+) processes=(\d+)$", row)
        if section:
            current = section.group(1)
            sections[current] = {"state": section.group(2), "processes": int(section.group(3)), "ranges": []}
            continue
        zero = re.match(r"^(\d+)-(\d+)\s+(.*)$", row)
        if zero and current:
            sections[current]["ranges"].append((int(zero.group(1)), int(zero.group(2)), zero.group(3)))
    return header, sections


def unknown_reason(header):
    if header is None:
        return "no REPORT line"
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
        header, sections = read_report(report_path)
        unknown = unknown_reason(header)
        print_excluded(base, excluded)
        if unknown:
            print(f"REPORT_UNKNOWN {unknown}")
        changed_lines = uncovered = unreadable = 0
        for path in sorted(targets):
            added = targets[path]
            changed_lines += len(added)
            section = sections.get(path)
            state = "UNKNOWN" if unknown else (section["state"] if section else "MISSING")
            if state not in ("LOADED", "NOT_LOADED", "MISSING", "UNKNOWN"):
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

### `coverage-selftest.mjs`（SHA-256 `cda858ff9edf9e79721fad5deea82dffac012b3d59794539117590634bdd1a7d`、171 行）

````javascript
// Usage: node coverage-selftest.mjs <folder holding merge-zero.mjs and changed-uncovered.py> <repository root that has node_modules/.bin/tsx>
// U14: gives the two measuring scripts six inputs in a throwaway git repository, with real V8 coverage from tsx, and checks the result.
//   n1 empty report -> FAIL     n2 changed file not loaded -> FAIL    n3 changed file has no section -> FAIL
//   n4 one of two changed files not loaded -> FAIL    n5 loaded, zero-count range on an added line -> FAIL    n6 all run -> PASS
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
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`coverage-selftest: ${passed} cases passed`);
````

