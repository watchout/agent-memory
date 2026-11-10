# 要件の行き渡りの確かめ — 本番の依存の版上げ（Issue #339）

- 入力: 作る段の追跡表 `construction/code-generation/traceability.json`（計画 `construction/code-generation/code-generation-plan.md`、まとめ `construction/code-generation/code-summary.md`、試験の手順 `construction/code-generation/unit-test-instructions.md`）
- 命令: `aidlc engine sensor-traceability --stage build-and-test`
- 作業の単位は無い（security-patch）。行き先はすべて作る段（code-generation）。

## 判定

- **FAIL**（行き渡っていない ID が 1 つ: NFR2）。NFR2 の子のうち NFR2.2（独立の監査の席が目で確かめる）が「監査待ち」で、まだ作られていない扱い。ほかの ID はすべて作られたか、理由つきで N/A。

## ID ごとの行き先

| ID | 行き渡り | 段 | 行き先の file・理由 |
|----|----------|----|---------------------|
| FR1.1 | 作った | code-generation | package-lock.json |
| FR1.2 | 作った | code-generation | package-lock.json |
| FR1.3 | 作った | code-generation | package-lock.json |
| FR2.1 | 作った | code-generation | package.json |
| FR2.2 | 作った | code-generation | package.json |
| FR2.3 | 作った | code-generation | package.json |
| FR2.4 | 作った | code-generation | package-lock.json |
| FR3.1 | 作った | code-generation | package.json |
| FR3.2 | N/A | code-generation | workflow を変えない要件で、この単位の差分に .github/ の変更は無い |
| FR3.3 | N/A | code-generation | PR #340 の CI の Node 18 の回が通り、Node 18 を外す workflow の PR を先に出す場面が起きなかった |
| FR4.1 | 作った | code-generation | src/test.ts |
| FR4.2 | 作った | code-generation | construction/code-generation/code-summary.md |
| FR4.3 | 作った | code-generation | construction/code-generation/code-summary.md |
| FR4.4 | 作った | code-generation | construction/code-generation/code-summary.md |
| NFR1 | 作った | code-generation | NFR1.1・NFR1.2（N/A: 試験が落ちず package 以外を変える場面が無かった）・NFR1.3 |
| NFR2 | **行き渡っていない** | code-generation | NFR2.1 は作った。NFR2.2 は監査待ち（独立の監査の席の目の確かめ） |
| NFR3 | 作った | code-generation | NFR3.1（src/index.ts） |
| NFR4 | 作った | code-generation | NFR4.1〜NFR4.4 |
| NFR5 | 作った | code-generation | NFR5.1・NFR5.2（N/A: Node 18 の回が通った） |

## 行き渡っていない物

- NFR2（NFR2.2）: 勧告の題名・重さ・中身が差分と PR の本文に無いことを、独立の監査の席（devauditor）が目で確かめる。監査の依頼の後に決まる。この段の承認の場で Owner に示す。
