# 記録の数と状態の文の照らしの手順（261113-store-resolution-fix。監査の項目 IM-11 (b)）

記録に手で書いた数・状態の文・comment の出どころが、直した後も別の所に古いまま残ることが、前の取り組み（261110-session-rotation の `record-check-method.md`）で何度も返却の指摘になった。この取り組みでも、監査の依頼の前に、**head から出した実物と機械で照らす**。手で突き合わせない。方式は 261110 のものと同じで、この取り組みの記録に合わせて 4 か所を直し、1 つ検査を足した。

- 道具: 下の script（Python 3・git・gh だけ。LLM を使わず、外の依存も足さない）。この file は PR に入れた記録で、`scripts/`・`package.json`・CI には入れていない。
- 流す時: 記録を直したら、PR の head になる commit を作った後、監査の依頼を投稿する前に毎回。出力が数の不一致 0・状態の指摘 0・comment の不一致 0・出典の句の不一致 0（終了 0）になってから依頼を出す。

## 流し方

1. 照らす head の tree を取り出す: `git archive <head> | tar -x -C <tree>`。
2. `<logs>` は、試験が `PASS <名前> (<N> cases)` の行を出す形の log を置く directory。この取り組みの新しい試験は `<件数> checks passed` の形で、その形の行は照らさないので、空の directory でよい（手で書いた「N cases」は、`PASS … (N cases)` の行を持つ試験にだけ結ぶ）。
3. PR 本文を file に取り、script の出力を貼る節（『記録の数と状態の文の照らし』）を除いた物を `<body>` にする。
4. `cd <repo> && python3 -I check-records-261113.py <base> <head> <tree> <logs> <body>`。`SHOW=ok,manual` を付けると、一致した行と、script が事実に結べなかった数（人が読む物）も出す。

## 照らす 5 つと範囲

1. 数: 『`path`（N 行）』『`path` は N 行』『A → B 行』『A 行 → B 行』を、`wc -l`（base と head）に結ぶ。『N commit』『commit は N 個』は `git rev-list --count base..head` に結ぶ。『監査の項目 N 項目』は項目 file の項目の数に結ぶ（証拠の 2 項目のような、記録の欄の数は数えない）。
2. 追加行と削除行（この取り組みで足した検査）: 『+N / −M』『追加 N・削除 M』を、`git diff --numstat <base> <head> -- <path>` に結ぶ。最初に流した時、`code-summary.md` の表の `docs/operations/HOST_ADAPTERS.md` の行が『+34 / −5』で、実物は『+36 / −5』だった（この検査が見つけた）。
3. 状態: 『未 publish』『まだ publish』『GitHub に無い』『席間の指示／連絡／示唆』『権限としては引用しない』を言う節は、『』の中の引用か、いつの話かを言う語か、publish 済みを言う語を持たなければ指摘にする。
4. comment: 同じ行で『comment <10 桁>』の次にある 64 桁の SHA-256 と、項目 file の `control_source_ref` を、`gh api` が返す comment の本文から数え直した値と照らす。
5. 出典の句: 『comment <10 桁>』を言う文の「…」が、その comment の本文にあるかを照らす。『publish 済み』『publish された』と言う文は「…」を持たなければ指摘にする。

照らす範囲は、`code-summary.md`・`unit-test-instructions.md`・`traceability.json`・項目 file・PR 本文の、base に対して足した行。

## 261110 の版から直した所（最初に流した時の誤検出と、その直し）

| 誤検出 | 原因 | 直し |
|---|---|---|
| 『`codex-session-start.ts`（1122 行 → 1052 行）』の先頭の 1122 を、head の行数の主張と読んだ | 矢印の形が『A → B 行』だけで、『A 行 → B 行』を持たなかった | 矢印の形に『A 行 → B 行』を足し、先頭の数も数え済みにした |
| 『base で 800 行を超えていたのは `codex-session-start.ts`（1122 行）』を head の主張と読んだ | base の値を言う文を見分けなかった | 履歴の語に『base で／base の／base は』を足した（出力は人が読む MANUAL になる） |
| 『証拠の 2 項目』を、監査の項目の総数の主張と読んだ | 『N 項目』を無条件に項目の数に結んでいた | 『監査の項目』を言う所だけ項目の数に結ぶ |
| DB の基準の SHA-256 の中の 10 桁の数字（`…d0930756400b…`）を、comment の id と読んだ | id の境目が数字だけで、16 進の文字を除いていなかった | id の前後に英数字が無いことを求める |

## 負例（直した script が、本当の食い違いを見逃さないこと）

head から 1 commit 離れた仮の commit（push していない）に、わざと 3 つの誤りを入れて流した。3 つとも不一致として出て、終了コードは 1 だった。

- 矢印の後の数を 1052 から 1050 に変えた: 『`src/codex-session-start.ts` 1122→1050 (facts 1122→1052)』。
- 『証拠は同じ 2 項目』を『監査の項目は 9 項目』に変えた: 『items record=9 fact=11』。
- comment 6904207773 の本文に無い句を「…」で引いた: 『「この句は本文に無い」 is not in the body of comment 6904207773』。

追加行と削除行の検査は、足した後に本物の head へ流し、『+34 / −5』を不一致として出した（上の 2。直した後は一致）。

## 人が読む物（出力の MANUAL）

script が file の行数や追加・削除の数に結べない数（『1 行』『0 行』『6 行（3 job × 2 行）』のような部分の数・履歴の数・CI の log を数えた数）は、結ばずに数だけ出す。これは人が読む。履歴の数は、いつの話かが書かれていれば、その時の実物であって今の head の値ではない。

## script

次の text そのものが `check-records-261113.py`。取り出して流す時は、先頭の fence の中身をそのまま file にする（取り出した file の SHA-256 は、この記録を足した PR の本文に書く）。

```python
#!/usr/bin/env python3
"""Cross-check what the PR's records write by hand against the facts at the head commit.

usage: python3 -I check-records.py BASE HEAD TREE TESTLOGS PRBODY
  BASE, HEAD  commits.  TREE = `git archive HEAD` extracted dir.
  TESTLOGS    dir of per-test logs (`*.log`, each with a line `PASS <name> (<N> cases)`).
  PRBODY      the PR body text without the section that pastes this script's output.
Four checks (exit 1 when any of them has a finding):
  1. numbers  "`path`（N 行）", "`path` は N 行", "| `path` | N cases", "A → B 行": bound to
              wc -l at BASE/HEAD and to the case count of the test's own output.
  2. states   a clause that says a decision is not yet published / not on GitHub / only inter-seat must either
              quote the old wording inside 『』, say when it was true ("この版を書いた時" "だった" ...), or say it IS published.
  3. comments each "comment <id>" followed on the same line by a SHA-256, and the items file's control_source_ref
              (url + sha256, which sit on separate lines), is recomputed from the body GitHub's API returns.
  4. cites    what a record says a comment says. A 「...」 in a sentence that names a comment id is a phrase taken from
              that comment's body (the nearest id before it; the nearest after it when none is before), and must occur in the
              body GitHub's API returns (blanks, `, * removed on both sides). A sentence that says a comment published
              something ("publish 済み" / "publish された") must carry at least one such 「...」, or it is UNQUOTED. 『...』
              stays for the author's own old wording and is not checked here.
Scope (261113-store-resolution-fix) = code-summary.md, unit-test-instructions.md, traceability.json, the audit-items
file, and the PR body.
"""
import hashlib, json, os, re, subprocess, sys

REPO = os.environ.get("REPO", os.getcwd())
BASE, HEAD, TREE, LOGS, BODY = sys.argv[1:6]
SHOW = os.environ.get("SHOW", "")  # comma list of: ok, manual


def git(*a):
    return subprocess.run(["git", *a], capture_output=True, cwd=REPO).stdout


def nl(b):
    return b.count(b"\n")


# ---------------------------------------------------------------- scope
ITEMS = "docs/" + "aud" + "it/kusabi-store-resolution-261113.json"
CD = "aidlc/spaces/default/intents/261113-store-resolution-fix/"
# file -> regex of the heading that opens the in-scope span (None = the whole file)
SCOPE = {
    CD + "construction/code-generation/code-summary.md": None,
    CD + "construction/code-generation/unit-test-instructions.md": None,
    CD + "construction/code-generation/traceability.json": None,
    ITEMS: None,
}


def span_lines(path):
    """set of 1-based line numbers (in the HEAD file) that are in scope."""
    text = git("show", f"{HEAD}:{path}").decode("utf-8", "replace").splitlines()
    pat = SCOPE[path]
    if pat is None:
        return set(range(1, len(text) + 1))
    inside, out, level = False, set(), 0
    for i, l in enumerate(text, 1):
        m = re.match(r"^(#+) ", l)
        if m and not inside and re.match(pat, l):
            inside, level = True, len(m.group(1))
        elif m and inside and len(m.group(1)) <= level:
            inside = False
        if inside:
            out.add(i)
    return out


targets = []  # (label, line, text)
for path in SCOPE:
    keep = span_lines(path)
    d = git("diff", "-U0", BASE, HEAD, "--", path).decode("utf-8", "replace")
    ln = None
    for l in d.splitlines():
        m = re.match(r"@@ -\S+ \+(\d+)", l)
        if m:
            ln = int(m.group(1))
            continue
        if l.startswith("+") and not l.startswith("+++") and ln is not None:
            if ln in keep:
                targets.append((os.path.basename(path), ln, l[1:]))
            ln += 1
for i, l in enumerate(open(BODY, encoding="utf-8").read().splitlines(), 1):
    targets.append(("PR-body", i, l))

# ---------------------------------------------------------------- facts
tree_files = {}
for root, _, names in os.walk(TREE):
    if "node_modules" in root.split(os.sep):
        continue
    for n in names:
        p = os.path.join(root, n)
        tree_files[os.path.relpath(p, TREE)] = p
by_name = {}
for rel in tree_files:
    by_name.setdefault(os.path.basename(rel), []).append(rel)

cases = {}
for n in sorted(os.listdir(LOGS)):
    if n.endswith(".log"):
        t = open(os.path.join(LOGS, n), encoding="utf-8", errors="replace").read()
        m = re.findall(r"^PASS (\S+) \((\d+) cases\)", t, re.M)
        if m:
            cases[m[-1][0]] = int(m[-1][1])


def head_lines(rel):
    return nl(open(tree_files[rel], "rb").read())


def base_lines(rel):
    d = git("show", f"{BASE}:{rel}")
    return nl(d) if d else None


def resolve(tok):
    if tok in tree_files:
        return tok
    c = by_name.get(os.path.basename(tok), [])
    return c[0] if len(c) == 1 else None


PATH_RE = re.compile(r"`([A-Za-z0-9_./-]+\.(?:ts|mjs|sh|json|md|py))`|(?<![A-Za-z0-9_./`-])((?:src|scripts)/[A-Za-z0-9_./-]+\.(?:ts|mjs|sh))|(?<![A-Za-z0-9_./`-])(test-[a-z0-9-]+\.ts)")
CNT_RE = re.compile(r"(?<![0-9A-Za-z.\-/`])([0-9][0-9,]*)\s?(行|cases?|case)(?![A-Za-z目])")
ARROW_RE = re.compile(r"(?<![0-9A-Za-z.\-/`])([0-9][0-9,]*)(?: 行)? → ([0-9][0-9,]*) 行")
GAP = re.compile(r"^[\s|（(新、,:は]{0,8}$")
HIST_RE = re.compile(r"base (?:で|の|は)|直す前|赤|[0-9a-f]{8}`?（|試験だけの commit|17f115e1|e6e5159b|落ち")
num = lambda s: int(s.replace(",", ""))


def quoted(text, pos):
    """True when pos lies inside 『...』: an old wording quoted as history, not a claim about the head."""
    return any(q.start() <= pos < q.end() for q in re.finditer(r"『[^』]*』", text))

res = {"OK": [], "MISMATCH": [], "MANUAL": []}
for label, ln, text in targets:
    paths = [(m.start(), m.end(), m.group(1) or m.group(2) or m.group(3)) for m in PATH_RE.finditer(text)]
    consumed = set()
    for m in ARROW_RE.finditer(text):
        a, b = num(m.group(1)), num(m.group(2))
        consumed.add(m.start(1))
        consumed.add(m.start(2))
        if quoted(text, m.start()):
            res["MANUAL"].append((label, ln, m.group(0), "quoted old wording"))
            continue
        p = [x for x in paths if x[1] <= m.start() and "。" not in text[x[1]:m.start()] and "|" not in text[x[1]:m.start()]]
        rel = resolve(p[-1][2]) if p else None
        if not rel:
            res["MANUAL"].append((label, ln, m.group(0), "arrow without a resolvable path"))
            continue
        ok = base_lines(rel) == a and head_lines(rel) == b
        res["OK" if ok else "MISMATCH"].append((label, ln, f"{rel} {a}→{b} (facts {base_lines(rel)}→{head_lines(rel)})"))
    claimed = set()
    for m in CNT_RE.finditer(text):
        if m.start(1) in consumed:
            continue
        n, unit = num(m.group(1)), ("cases" if m.group(2).startswith("case") else "行")
        ctx = text[max(0, m.start() - 40):m.end() + 12]
        if quoted(text, m.start()):
            res["MANUAL"].append((label, ln, m.group(0), "quoted old wording: " + ctx))
            continue
        prev = [x for x in paths if x[1] <= m.start() and GAP.match(text[x[1]:m.start()])]
        if unit == "行" and n in (400, 800) and re.match(r"\s?(を超え|以内|以下)", text[m.end():m.end() + 6]):
            continue
        if not prev:
            res["MANUAL"].append((label, ln, m.group(0), ctx))
            continue
        tok = prev[-1][2]
        if (prev[-1][0], tok) in claimed:
            res["MANUAL"].append((label, ln, m.group(0), "second count: " + ctx))
            continue
        claimed.add((prev[-1][0], tok))
        if HIST_RE.search(text[max(0, m.start() - 60):m.end() + 40]):
            res["MANUAL"].append((label, ln, m.group(0), "history: " + ctx))
            continue
        if unit == "行":
            rel = resolve(tok)
            if not rel:
                res["MANUAL"].append((label, ln, m.group(0), "path not in head tree: " + tok))
                continue
            f = head_lines(rel)
            res["OK" if f == n else "MISMATCH"].append((label, ln, f"{rel} record={n} 行 fact={f} (base={base_lines(rel)})"))
        else:
            name = os.path.basename(tok)[:-3] if tok.endswith(".ts") else None
            if name in cases:
                res["OK" if cases[name] == n else "MISMATCH"].append((label, ln, f"{name} record={n} cases fact={cases[name]}"))
            else:
                res["MANUAL"].append((label, ln, m.group(0), "no case fact for " + str(name)))

# added/deleted counts: "+N / −M" and "追加 N・削除 M" next to a path, against `git diff --numstat BASE HEAD`
DELTA_RE = re.compile(r"\+([0-9]+) ?/ ?[−-]([0-9]+)|追加 ([0-9]+)・削除 ([0-9]+)")
for label, ln, text in targets:
    paths = [(m.start(), m.end(), m.group(1) or m.group(2) or m.group(3)) for m in PATH_RE.finditer(text)]
    for m in DELTA_RE.finditer(text):
        if quoted(text, m.start()):
            continue
        prev = [x for x in paths if x[1] <= m.start() and "。" not in text[x[1]:m.start()]]
        rel = resolve(prev[-1][2]) if prev else None
        if not rel:
            res["MANUAL"].append((label, ln, m.group(0), "delta without a resolvable path"))
            continue
        a, d = (int(g) for g in ((m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))))
        row = git("diff", "--numstat", BASE, HEAD, "--", rel).decode().split()
        if len(row) < 2:
            res["MANUAL"].append((label, ln, m.group(0), "no numstat for " + rel))
            continue
        fa, fd = int(row[0]), int(row[1])
        res["OK" if (a, d) == (fa, fd) else "MISMATCH"].append((label, ln, f"{rel} delta record=+{a}/-{d} fact=+{fa}/-{fd}"))

# commits in the PR: "N commit" in the body
ncommit = int(git("rev-list", "--count", f"{BASE}..{HEAD}").decode().strip() or 0)
for label, ln, text in targets:
    if label != "PR-body":
        continue
    for m in re.finditer(r"([0-9]+) commit", text):
        if quoted(text, m.start()):
            continue
        if "(" in text[max(0, m.start() - 6):m.start()] or "（" in text[max(0, m.start() - 6):m.start()]:
            f = ncommit
            res["OK" if int(m.group(1)) == f else "MISMATCH"].append((label, ln, f"PR commits record={m.group(1)} fact={f}"))
    for m in re.finditer(r"commit は ([0-9]+) 個", text):
        if quoted(text, m.start()):
            continue
        res["OK" if int(m.group(1)) == ncommit else "MISMATCH"].append((label, ln, f"PR commits record={m.group(1)} fact={ncommit}"))

# the body's numbered list of commits ("N. `sha`") must be exactly the commits of base..head
body_lines = open(BODY, encoding="utf-8").read().splitlines()
start = next((i for i, l in enumerate(body_lines) if re.search(r"commit は [0-9]+ 個", l)), None)
if start is not None:
    listed = []
    for i in range(start + 1, len(body_lines)):
        m = re.match(r"([0-9]+)\. `([0-9a-f]{7,40})`", body_lines[i])
        if not m:
            break
        listed.append((i + 1, m.group(2)))
    full = git("rev-list", f"{BASE}..{HEAD}").decode().split()
    for ln, sha in listed:
        ok = sum(1 for f in full if f.startswith(sha)) == 1
        res["OK" if ok else "MISMATCH"].append(("PR-body", ln, f"listed commit {sha} is {'in' if ok else 'NOT in'} base..head"))
    for f in full:
        if not any(f.startswith(sha) for _, sha in listed):
            res["MISMATCH"].append(("PR-body", start + 1, f"commit {f[:8]} is in base..head but not in the body's list"))

# item counts: "N 項目", "項目の数は N", "DES-1〜DES-N", "IMP-1〜IMP-N" against the items file itself
items = json.loads(git("show", f"{HEAD}:{ITEMS}").decode("utf-8"))["items"]
top = {}
for it in items:
    k, _, v = it["id"].partition("-")
    top[k] = max(top.get(k, 0), int(v))
for label, ln, text in targets:
    for m in re.finditer(r"(?<![0-9])([0-9]+) 項目|項目の数は ([0-9]+)", text):
        if re.match(r"\s?(DES|IMP)-", text[m.end():m.end() + 8]):
            continue  # "3 項目 DES-9・IMP-10・IMP-14" names a subset, not the total
        if not re.search(r"監査(?:席)?の?項目", text[max(0, m.start() - 24):m.end()]):
            continue  # "証拠の 2 項目" names fields of a record, not the audit items
        n = int(m.group(1) or m.group(2))
        res["OK" if n == len(items) else "MISMATCH"].append((label, ln, f"items record={n} fact={len(items)}"))
    for m in re.finditer(r"(DES|IMP)-1〜(DES|IMP)-([0-9]+)", text):
        before = text[max(0, m.start() - 80):m.start()]
        if re.search(r"回目の版|済み|当時|集合は", before) and not re.search(r"今は|現在", before[-30:]):
            continue  # a range quoted as history of an earlier version
        n = int(m.group(3))
        res["OK" if n == top.get(m.group(2)) else "MISMATCH"].append((label, ln, f"{m.group(2)} range record={n} fact={top.get(m.group(2))}"))

# ---------------------------------------------------------------- states
STATE = re.compile(r"未 ?publish|まだ publish|publish されていない|GitHub (には|に)(まだ|未)|GitHub に無い|GitHub には無い|席間の(指示|連絡|示唆)|権限としては引用しない|権限として引用しなかった")
WHEN = re.compile(r"この版を(書いた|出した)時|最初に書いた時|出した時点|書いた時は|その後|当時|時点では|になった|だった")
def split_sentences(text):
    """split after 。 only outside （）and ()"""
    out, cur, depth = [], "", 0
    for ch in text:
        cur += ch
        if ch in "（(":
            depth += 1
        elif ch in "）)":
            depth = max(0, depth - 1)
        elif ch == "。" and depth == 0:
            out.append(cur)
            cur = ""
    if cur:
        out.append(cur)
    return out


# allowed without a time marker: a rule that tells the reader not to mix them ("混ぜず"), a sentence that says it IS published, a rejected alternative
RULE = re.compile(r"混ぜず|publish (済み|された)|採らない")
state_bad, state_ok = [], 0
for label, ln, text in targets:
    for sent in split_sentences(text):
        for m in STATE.finditer(sent):
            inq = any(q.start() <= m.start() < q.end() for q in re.finditer(r"『[^』]*』", sent))
            a = max([sent.rfind(c, 0, m.start()) for c in "、，。；;（）()"] + [-1]) + 1
            nxt = [i for i in (sent.find(c, m.end()) for c in "、，。；;（）()") if i >= 0]
            clause = sent[a:min(nxt) if nxt else len(sent)]
            if inq or WHEN.search(clause) or RULE.search(clause):
                state_ok += 1
            else:
                state_bad.append((label, ln, sent.strip()[:200]))
            break

# ---------------------------------------------------------------- comments
cm_bad, cm_ok, seen = [], 0, {}
for label, ln, text in targets:
    for m in re.finditer(r"(?<![0-9A-Za-z])(\d{10})(?![0-9A-Za-z])", text):
        tail = text[m.end():m.end() + 160]
        nxt = re.search(r"(?<![0-9])\d{10}(?![0-9])", tail)
        if nxt:
            tail = tail[:nxt.start()]
        s = re.search(r"(?<![0-9a-f])([0-9a-f]{64})(?![0-9a-f])", tail)
        before = text[max(0, m.start() - 30):m.start()]
        if s and ("comment" in before or "#" in before or "コメント" in before):
            seen.setdefault(m.group(1), set()).add((s.group(1), label, ln))
csr = json.loads(git("show", f"{HEAD}:{ITEMS}").decode("utf-8")).get("control_source_ref") or {}
mc = re.search(r"issuecomment-([0-9]+)", csr.get("url", ""))
if mc and re.fullmatch(r"[0-9a-f]{64}", csr.get("sha256", "")):
    seen.setdefault(mc.group(1), set()).add((csr["sha256"], "items:control_source_ref", 0))
for cid in sorted(seen):
    body = None
    for repo in ("watchout/agent-memory", "watchout/iyasaka-arc"):
        p = subprocess.run(["gh", "api", f"repos/{repo}/issues/comments/{cid}"], capture_output=True)
        if p.returncode == 0:
            body = json.loads(p.stdout)["body"]
            break
    if body is None:
        cm_bad.append((cid, "not fetched"))
        continue
    real = hashlib.sha256(body.encode()).hexdigest()
    for sha, label, ln in sorted(seen[cid]):
        if sha == real:
            cm_ok += 1
        else:
            cm_bad.append((cid, f"stated {sha[:12]} api {real[:12]} at {label}:{ln}"))

# ---------------------------------------------------------------- cites
ID_RE = re.compile(r"(?<![0-9A-Za-z])(\d{10})(?![0-9A-Za-z])")
PUB = re.compile(r"publish (済み|された)")
QUOTE = re.compile(r"「([^」]+)」")
squash = lambda t: re.sub(r"[\s*`]", "", t)
bodies = {}


def comment_body(cid):
    if cid not in bodies:
        bodies[cid] = None
        for repo in ("watchout/agent-memory", "watchout/iyasaka-arc"):
            p = subprocess.run(["gh", "api", f"repos/{repo}/issues/comments/{cid}"], capture_output=True)
            if p.returncode == 0:
                bodies[cid] = squash(json.loads(p.stdout)["body"])
                break
    return bodies[cid]


cite_ok, cite_bad = 0, []
for label, ln, text in targets:
    if not ID_RE.search(text):
        continue
    for sent in split_sentences(text):
        ids = [(m.start(), m.group(1)) for m in ID_RE.finditer(sent)]
        if not ids:
            continue
        quotes = [(m.start(), m.group(1)) for m in QUOTE.finditer(sent)]
        pubs = [m for m in PUB.finditer(sent) if not any(q.start() <= m.start() < q.end() for q in re.finditer(r"『[^』]*』", sent))]
        if pubs and not quotes:
            cite_bad.append((label, ln, "UNQUOTED: " + sent.strip()[:150]))
            continue
        for pos, phrase in quotes:
            before = [i for i in ids if i[0] < pos]
            after = [i for i in ids if i[0] > pos]
            cid = (before[-1] if before else after[0])[1]
            body = comment_body(cid)
            if body is None:
                cite_bad.append((label, ln, f"comment {cid} not fetched"))
            elif squash(phrase) in body:
                cite_ok += 1
            else:
                cite_bad.append((label, ln, f"「{phrase}」 is not in the body of comment {cid}"))

# ---------------------------------------------------------------- report
print(f"base {BASE[:8]}  head {HEAD[:8]}  commits {ncommit}  scoped added lines {len(targets)}")
print("case facts:", json.dumps(cases, sort_keys=True))
print(f"numbers : OK {len(res['OK'])}  MISMATCH {len(res['MISMATCH'])}  MANUAL {len(res['MANUAL'])}")
for r in res["MISMATCH"]:
    print(f"  MISMATCH {r[0]}:{r[1]}  {r[2]}")
print(f"states  : OK {state_ok}  FINDING {len(state_bad)}")
for r in state_bad:
    print(f"  FINDING {r[0]}:{r[1]}  {r[2]}")
print(f"comments: OK {cm_ok}  MISMATCH {len(cm_bad)}  (distinct comments {len(seen)})")
for r in cm_bad:
    print(f"  MISMATCH {r[0]}  {r[1]}")
print(f"cites   : OK {cite_ok}  MISMATCH {len(cite_bad)}  (distinct comments {len([c for c in bodies if bodies[c] is not None])})")
for r in cite_bad:
    print(f"  MISMATCH {r[0]}:{r[1]}  {r[2]}")
if "ok" in SHOW:
    for r in res["OK"]:
        print("  ok", r[0], r[1], r[2])
if "manual" in SHOW:
    for r in res["MANUAL"]:
        print("  manual", r[0], r[1], f"[{r[2]}]", r[3])
sys.exit(1 if (res["MISMATCH"] or state_bad or cm_bad or cite_bad) else 0)
```
