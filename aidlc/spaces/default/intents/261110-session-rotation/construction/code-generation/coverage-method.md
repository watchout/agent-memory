# 行の網羅率の測り方 — 会話の切り直し（261110-session-rotation）

監査の席が、`code-summary.md` の「行の網羅率」と同じ数字を自分で出せるようにする手順と script の全文。新しい依存は足さない（Node の `NODE_V8_COVERAGE`、`node`、`python3`、`git` だけ）。本番の保存先に触れないよう、どの命令も `HOME` を使い捨ての folder にして動かす。

## 手順（repository の root で）

1. 変えた file の一覧と、測る命令を決める。

   ```bash
   BASE=17676d841257cc4ef194e14923cb0458b99cf62f          # PR の base（main）
   COV=$(mktemp -d)                                       # 生の網羅率の置き場（repository の外）
   run() { H=$(mktemp -d); mkdir -p "$H/.agent-memory"; HOME="$H" NODE_V8_COVERAGE="$COV" "$@"; }
   ```

2. 変えた file を読む試験の命令を全部、`run` で動かす（どれも 0 で終わること）:

   ```bash
   run npm run test:claude-hook
   run npm run test:codex-hook
   run npm run test:gemini-hook
   run npm run test:gemini-conversation-ingest
   run npm run test:antigravity-hook
   run npm run test:automatic-receive
   run npm run test:transcript-stop
   run env KUSABI_TEST_TMPDIR=$(mktemp -d) npx tsx src/test.ts
   run env AGENT_MEMORY_DB_TYPE=sqlite npx tsx src/test-post-tool-hook.ts
   run npx tsx src/test-boot-recovery.ts
   ```

   `test:claude-hook` の最後が切り直しの試験（core・flow・registration・status・watcher-units・watcher-flow・scenario）を呼び、`test:automatic-receive` が身元の試験を呼ぶ。`NODE_V8_COVERAGE` は子 process として起動する command の分も集める。

3. 試験の file を除いた、base から変わった src の file の 0 回の範囲を足し合わせ（`merge-zero.mjs`）、足した行と重ねる（`changed-uncovered.py`）:

   ```bash
   FILES=$( (git diff --name-only --diff-filter=AM "$BASE" -- src; git ls-files --others --exclude-standard -- src) | grep -v '^src/test' | sort -u )
   node merge-zero.mjs "$COV" $FILES > zero.txt
   python3 -I changed-uncovered.py "$BASE" zero.txt | grep -v 'uncovered_ranges_in_changed=0'
   ```

   `merge-zero.mjs` と `changed-uncovered.py` は下の全文を、repository の外の folder に置く。

4. 2 回目の監査への直しの後の結果（Node v26.12.1）: 30 file、変えた行と新しい行 4,071 行のうち、0 回の範囲は `src/rotation-watcher.ts` 134〜137 行目と `src/session-rotation-stop.ts` 640〜642 行目（どちらも入口の最後の網 `main().catch(...)`）の 2 つだけ。

V8 の範囲は分岐の腕や無名関数も数えるので、行の網羅率より厳しい。数え方は Node の版で少し違いうる。

## merge-zero.mjs

```js
// Usage: node merge-zero.mjs <coverage-dir> <file suffix> [more suffixes...]
// Merges V8 block coverage across every process in the directory (max count per generated offset),
// then prints the ORIGINAL source lines of ranges that no process ran.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SourceMap } from "node:module";

const [dir, ...suffixes] = process.argv.slice(2);
const files = readdirSync(dir).map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));

for (const suffix of suffixes) {
  let merged = null;
  let cache = null;
  let url = null;
  let processes = 0;
  for (const json of files) {
    for (const entry of json.result) {
      if (!entry.url.endsWith(`/${suffix}`) && entry.url !== suffix) continue;
      const mapped = json["source-map-cache"]?.[entry.url];
      if (!mapped?.data) continue;
      processes += 1;
      cache = mapped;
      url = entry.url;
      const size = mapped.lineLengths.reduce((sum, length) => sum + length + 1, 0);
      const counts = new Int32Array(size).fill(-1);
      const ranges = [];
      for (const fn of entry.functions) for (const range of fn.ranges) ranges.push({ fn: fn.functionName, ...range });
      ranges.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
      for (const range of ranges) counts.fill(range.count, range.startOffset, Math.min(range.endOffset, size));
      if (merged === null) merged = counts;
      else for (let index = 0; index < size; index++) if (counts[index] > merged[index]) merged[index] = counts[index];
    }
  }
  console.log(`== ${suffix} (processes that loaded it: ${processes})`);
  if (merged === null) { console.log("not loaded"); continue; }
  const map = new SourceMap(cache.data);
  const original = cache.data.sourcesContent?.[0]?.split("\n") ?? [];
  const lineStarts = [];
  let offset = 0;
  for (const length of cache.lineLengths) { lineStarts.push(offset); offset += length + 1; }
  const locate = (position) => {
    let low = 0, high = lineStarts.length - 1;
    while (low < high) { const mid = (low + high + 1) >> 1; if (lineStarts[mid] <= position) low = mid; else high = mid - 1; }
    return { line: low, column: position - lineStarts[low] };
  };
  const rows = new Map();
  let start = -1;
  for (let index = 0; index <= merged.length; index++) {
    const zero = index < merged.length && merged[index] === 0;
    if (zero && start < 0) start = index;
    if (!zero && start >= 0) {
      const a = locate(start), b = locate(index - 1);
      const first = map.findEntry(a.line, a.column), last = map.findEntry(b.line, b.column);
      const from = (first.originalLine ?? 0) + 1, to = (last.originalLine ?? 0) + 1;
      const key = `${from}-${to}`;
      if (!rows.has(key)) rows.set(key, { from, to, text: (original[from - 1] ?? "").trim().slice(0, 110) });
      start = -1;
    }
  }
  for (const row of [...rows.values()].sort((x, y) => x.from - y.from)) console.log(`${row.from}-${row.to}  ${row.text}`);
}
```

## changed-uncovered.py

```python
"""Usage: python3 -I changed-uncovered.py <base-commit> <zero-report>

Intersects the zero-count ranges printed by merge-zero.mjs with the lines this change added.
New files (not present in the base commit): every line counts.
Modified files: only the lines added since the base commit (git diff -U0).
Prints, per file, the changed ranges that no test process ran. Run it from the repository root."""
import re
import subprocess
import sys

base, zero_path = sys.argv[1], sys.argv[2]


def in_base(path):
    return subprocess.run(["git", "cat-file", "-e", f"{base}:{path}"], capture_output=True).returncode == 0


def added_lines(path):
    if not in_base(path):
        with open(path, encoding="utf8") as handle:
            return set(range(1, sum(1 for _ in handle) + 1))
    out = subprocess.run(["git", "diff", "-U0", base, "--", path], capture_output=True, text=True).stdout
    lines = set()
    for hunk in re.finditer(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", out, re.M):
        start, count = int(hunk.group(1)), int(hunk.group(2) or 1)
        lines.update(range(start, start + count))
    return lines


zero = {}
current = None
for row in open(zero_path, encoding="utf8"):
    row = row.rstrip("\n")
    head = re.match(r"^== (\S+) \(processes that loaded it: (\d+)\)", row)
    if head:
        current = head.group(1)
        zero[current] = {"loaded": int(head.group(2)), "ranges": []}
        continue
    if row.startswith("not loaded"):
        zero[current]["loaded"] = 0
        continue
    rng = re.match(r"^(\d+)-(\d+)\s+(.*)$", row)
    if rng and current:
        zero[current]["ranges"].append((int(rng.group(1)), int(rng.group(2)), rng.group(3)))

total = 0
for path in sorted(zero):
    changed = added_lines(path)
    missed = [(a, b, text) for a, b, text in zero[path]["ranges"] if any(n in changed for n in range(a, b + 1))]
    total += len(changed)
    flag = "NEW" if not in_base(path) else "MOD"
    print(f"{flag} {path}: loaded_by={zero[path]['loaded']} changed_lines={len(changed)} uncovered_ranges_in_changed={len(missed)}")
    for a, b, text in missed:
        print(f"    {a}-{b}  {text}")
print(f"TOTAL changed_lines={total}")
```
