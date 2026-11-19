#!/usr/bin/env python3
"""Machine-built reading-down list for PR 349 (DS-2 (d)). Stdlib only, no network, no clock, no randomness.

usage: yomikae-list-build.py REPO HEAD BASE PREV_LIST_JSON OUT_DIR
       yomikae-list-build.py --selftest

Rule (R1, the whole rule; nothing is judged by hand):
  scope   = every file in `git diff --name-only BASE HEAD` under the intent record dir, except db-design-record.md
            (that file has its own check) and docs/audit/* (item files).
  strip   = from each non-blank line remove: URLs; "onza <hash>" style fixed refs; backtick spans with no non-ASCII
            character (names / identifiers / paths); bare hex hashes (>=7, with a digit); file names with a known
            extension; section marks (§N.N); failure names OC0xx (and OC0xx〜OC0yy).
  WORDS   = PARTY (the common foundation by name) | CONTENT (phrases that state the foundation's rule / contract).
  listed  = a line whose text, AFTER the strip, still matches WORDS.   (anything left of the foundation is listed)
  excluded= a line that matches WORDS only BEFORE the strip (the word sat inside a name / fixed reference).
            Every excluded line is written out in full to excluded.txt so it can be read.
  final   = listed  UNION  every line of the previous list (PREV_LIST_JSON; kept, never removed).
The rule is a floor, not a proof of completeness: a line that states the foundation's content with none of WORDS is not
caught, and the report says so.

Notes. (1) PARTY and CONTENT below are search words, not statements; the same words already occur in the approved record
files. (2) The only outside program is `git`, called read-only (`diff --name-only`, `cat-file blob`); the result depends on
the git objects of HEAD and BASE. (3) yomikae-machine-list.json stores the `head` it was run on, so its SHA-256 changes with
the head; table.md and excluded.txt do not (same input lines give the same bytes).
"""
import hashlib, json, re, subprocess, sys

INT = "aidlc/spaces/default/intents/261021-facility-ax-memory/"
PARTY = r"共通基盤|\b[Cc]ommon\b|[Oo]nza|ONZA|確かめの関数|manifest|配布物|主体|割り当て|[Bb]inding"
CONTENT = (r"本人の証拠|本人の確かめ|本人確認|席の確かめ|身元の確かめ|席を確かめ|席から確かめ|同じ ?transaction|同じ取引|"
           r"同一(?:の)?取引|確かめと保存|保存と同じ|DB の利用者|所属範囲|draining|期限切れ|失効")
WORDS = re.compile(PARTY + "|" + CONTENT)
NON_ASCII = re.compile(r"[^\x00-\x7f]")
RULE_ID = "R1"


def strip(line):
    s = re.sub(r"https?://\S+", " ", line)
    s = re.sub(r"onza\s*(?:main\s*|の固定\s*commit\s*|の\s*commit\s*|commit\s*)?(?=[0-9a-f]*\d)[0-9a-f]{7,64}", " ", s)
    s = re.sub(r"`([^`]*)`", lambda m: " " if not NON_ASCII.search(m.group(1)) else m.group(0), s)
    s = re.sub(r"\b(?=[0-9a-f]*\d)[0-9a-f]{7,64}\b", " ", s)
    s = re.sub(r"[A-Za-z0-9_\-./]+\.(?:md|sql|json|ts|mjs|yml|yaml|sh|py)\b", " ", s)
    s = re.sub(r"§[0-9.]+", " ", s)
    s = re.sub(r"OC0[0-9]{2}(?:〜OC0[0-9]{2})?", " ", s)
    return s


def classify(line):
    """-> 'listed' | 'excluded' | 'none'"""
    if not line.strip() or not WORDS.search(line):
        return "none"
    return "listed" if WORDS.search(strip(line)) else "excluded"


def git(repo, *a):
    return subprocess.run(["git", "-C", repo, *a], capture_output=True, check=True).stdout


def sha(b):
    return hashlib.sha256(b).hexdigest()


def ranges(nums):
    out, i = [], 0
    nums = sorted(nums)
    while i < len(nums):
        j = i
        while j + 1 < len(nums) and nums[j + 1] == nums[j] + 1:
            j += 1
        out.append(str(nums[i]) if i == j else f"{nums[i]}-{nums[j]}")
        i = j + 1
    return ",".join(out)


def build(repo, head, base, prev_json, out_dir):
    prev = json.load(open(prev_json, encoding="utf-8"))
    prev_set = {(r[0], n) for r in prev["rows"] for n in r[1]}
    files = [f for f in git(repo, "diff", "--name-only", base, head).decode().split("\n") if f]
    scope = sorted(f for f in files if f.startswith(INT) and not f.endswith("/db-design-record.md"))
    listed, excluded, texts = {}, {}, {}
    for f in scope:
        p = f[len(INT):]
        lines = git(repo, "cat-file", "blob", f"{head}:{f}").decode("utf-8").split("\n")
        texts[p] = lines
        for i, l in enumerate(lines, 1):
            c = classify(l)
            if c == "listed":
                listed.setdefault(p, []).append(i)
            elif c == "excluded":
                excluded.setdefault(p, []).append(i)
    machine = {(p, n) for p, v in listed.items() for n in v}
    final = machine | prev_set
    for p, n in prev_set:
        assert p in texts, ("previous-list file not in scope", p)
        assert 1 <= n <= len(texts[p]) and texts[p][n - 1].strip(), ("previous-list line missing at head", p, n)
    by_file = {}
    for p, n in final:
        by_file.setdefault(p, []).append(n)
    rows = []
    for p in sorted(by_file):
        m = sorted(n for n in by_file[p] if (p, n) in machine)
        o = sorted(n for n in by_file[p] if (p, n) not in machine)
        rows.append({"path": p, "machine": m, "previous_only": o})
    result = {
        "rule": RULE_ID, "head": head, "base": base, "scope_files": len(scope),
        "parties": PARTY, "content": CONTENT,
        "counts": {"machine_lines": len(machine), "previous_lines": len(prev_set), "previous_not_caught": len(prev_set - machine),
                   "final_lines": len(final), "final_files": len(rows), "excluded_lines": sum(len(v) for v in excluded.values())},
        "rows": rows,
    }
    j = (json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode("utf-8")
    ex = "".join(f"{p}:{n}\t{texts[p][n - 1].strip()}\n" for p in sorted(excluded) for n in excluded[p]).encode("utf-8")
    tbl = ["| file | 行（規則 R1 が拾った行） | 行（前の一覧で足した。規則 R1 は拾わない） |", "|---|---|---|"]
    for r in rows:
        tbl.append(f"| `{r['path']}` | {ranges(r['machine']) or '-'} | {ranges(r['previous_only']) or '-'} |")
    tb = ("\n".join(tbl) + "\n").encode("utf-8")
    import os
    os.makedirs(out_dir, exist_ok=True)
    for name, data in (("yomikae-machine-list.json", j), ("excluded.txt", ex), ("table.md", tb)):
        open(os.path.join(out_dir, name), "wb").write(data)
    return result, {"list": sha(j), "excluded": sha(ex), "table": sha(tb)}


def selftest():
    # made-up sentences: they state nothing about the other party, they only exercise the three outcomes
    must_list = [
        "共通基盤を呼ぶ入口を 1 つにする。",
        "所属範囲ごとに分けて読む。",
        "席の確かめを先に置く。",
        "共通基盤の確かめの関数を呼ぶ接続を受け取る",
    ]
    must_exclude = [
        "関数 `common.example_call` を呼ぶ（notes.md §5）",
        "固定 commit onza 0123456789abcdef0123456789abcdef01234567 を参照する",
        "失敗は OC001〜OC011（`common.example.sql` は変えない写し）",
    ]
    must_none = ["Kusabi の失敗の名前を決める。", "失敗の名前は OC001〜OC011（`example_owner`）", ""]
    for t in must_list:
        assert classify(t) == "listed", ("should be listed", t)
    for t in must_exclude:
        assert classify(t) == "excluded", ("should be excluded", t)
    for t in must_none:
        assert classify(t) == "none", ("should be none", t)
    print("selftest ok:", len(must_list), "listed,", len(must_exclude), "excluded,", len(must_none), "none")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        selftest()
        sys.exit(0)
    repo, head, base, prev, out = sys.argv[1:6]
    selftest()
    res, h = build(repo, head, base, prev, out)
    print(json.dumps({"counts": res["counts"], "scope_files": res["scope_files"], "sha256": h}, ensure_ascii=False))
