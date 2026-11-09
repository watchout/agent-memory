# 壊れにくさの要件 — 本番の依存の版上げ（Issue #339）

- 入力: 承認された要件（`inception/requirements-analysis/requirements.md` の NFR1・NFR5、FR3.3、前提）、この段の要約の確かめ（`nfr-requirements-questions.md`）、この段の承認の場での Owner の直し（2026-11-09、原文の抜き出し: 「README.md・CONTRIBUTING.md・codekb の「Node 18 以上」の行も、この PR で「Node 20 以上」に直してください。NFR1 の差分の条件に、その行の書き換えを足してください。」、続けて「SSOT-0_PRD.md の 44・287 行目も、この PR で「Node 20 以上」に直し、差分の条件に足してください。」）、コードを書く段の承認された計画での追加（`construction/code-generation/code-generation-plan.md` の Step 6。`CLAUDE.md` 12 行目と `docs/OSS_EVALUATION_FRAMEWORK.md` 153 行目を足した。この段の承認の時の Owner の直し、原文の抜き出し: 「根の CLAUDE.md 12 行目を「Node.js 20+」に、docs/OSS_EVALUATION_FRAMEWORK.md 153 行目を node:20-alpine に直し、差分の条件に足してください。」）

## 要件

| ID | 要件 | 合格の条件 | 出どころ |
|----|------|------------|----------|
| NFR1.1 | 振る舞いを変えない。プログラムと依存に関わる差分は package.json と package-lock.json だけ。文書は、動く Node の前提を書いた 7 行だけを書き換える | 今の main と比べた差分のうち、プログラムと依存に関わる物が package.json と package-lock.json だけ。package-lock.json の差分は、上げる部品（要件 FR1.1・FR1.2）と、先頭の項（`packages[""]`）の engines と dependencies の写しの変更（要件 FR2・FR3.1）だけ。文書の差分は次の 7 行の Node 18 の前提を Node 20 に書き換えることだけ: `README.md` 402 行目（今は `- Node.js 18+`）、`CONTRIBUTING.md` 54 行目（今は `- Node.js 18+`）、`CLAUDE.md` 12 行目（今は `\| ランタイム \| Node.js 18+ \|`）、`docs/requirements/SSOT-0_PRD.md` 44 行目（今は `\| Tech Stack \| TypeScript (ESM), Node.js 18+ \|`）と 287 行目（今は `- Node.js 18+`）、`docs/OSS_EVALUATION_FRAMEWORK.md` 153 行目（今は `node:18-alpine` で入れ直しを確かめる行。`node:20-alpine` にする）、`aidlc/spaces/default/codekb/agent-memory/technology-stack.md` 9 行目（今は「Node.js 18 以上（CI は 18・20・22）」。CI の書き方はそのまま） | 要件 NFR1・FR1.2・FR3.1、Owner の直し（この段の差し戻しと、その後の追加）、コードを書く段の承認された計画の Step 6 |
| NFR1.2 | 版上げの後に型検査・試験のどれかが落ち、package.json と package-lock.json 以外を変えないと通らない時は、部品を限らず、変える前に Owner に伺う | その場合、PR に package.json・package-lock.json 以外のプログラムの変更が無いまま止まり、伺いの記録がある | 要件 NFR1・前提（細かい直し） |
| NFR5.1 | 統合の commit を戻せば、1 回で今の依存に戻る | プログラムと依存に関わる差分が package.json と package-lock.json だけ（NFR1.1）で、統合が merge commit（team.md の Way of Working） | 要件 NFR5 |
| NFR5.2 | CI の Node 18 の回が落ちたら、この PR では直さず、Node 18 を外す workflow の PR を先に出す | Node 18 の回が落ちた時、この PR の差分にその失敗を直す変更が無く、PR の本文に Node 18 を外す PR への参照がある（その PR は Owner の exact-head） | 要件 FR3.3 |

## 壊れ方と扱い

| 壊れ方 | 見つける所 | 扱い |
|--------|------------|------|
| 型検査・試験が落ちる | 手元の試験（要件 FR4.1 の表）と CI | package.json と package-lock.json の中で直せない時は、変える前に Owner に伺う（NFR1.2） |
| CI の Node 18 の回だけが落ちる | CI | この PR では直さない（NFR5.2） |
| 統合の後に問題が見つかる | 監査・統合の後の確かめ | 統合の commit を戻す（NFR5.1） |
| PR を出す直前の点検で新しい勧告が出る | `npm audit --omit=dev` | 版を決め直す前に Owner に伺う（安全の要件 NFR4.1） |

## 範囲の外

- 席が使う Kusabi の入れ替え（版を作って席の束に配る流れ）。守る物（展開）なので、統合の後に Owner の手作業として別に扱う（要件の完了の境目）。動いている席の可用性の目標はこの取り組みで変えない。
