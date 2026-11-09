## Summary

- Builds: 本番の依存の版上げ（SDK 1.32.2・uuid 11.1.1・zod 4.6.7 ほか、範囲指定をやめて固定、Node 20 以上）と、Node の前提を書いた 7 行の書き換え
- Touches: package.json・package-lock.json、README.md・CONTRIBUTING.md・CLAUDE.md・docs/requirements/SSOT-0_PRD.md・docs/OSS_EVALUATION_FRAMEWORK.md の各 1〜2 行、codekb と この取り組みの AI-DLC の記録（PR に足す）、監査の項目の file
- Tests: 新しい試験は 0（Owner の決定）。今ある試験 T1〜T11 を版上げの前と後に動かし、網羅率を組み込みの道具で測る

## 入力と範囲

- 要件: `inception/requirements-analysis/requirements.md`（FR1〜FR4、NFR1〜NFR5）
- 機能以外の要件: `construction/nfr-requirements/`（NFR1.1〜NFR5.2、技術の決まり）
- 今のコードの読み解き: `aidlc/spaces/default/codekb/agent-memory/`、`inception/reverse-engineering/developer-scan.md`
- この取り組みには作業の単位が無い（security-patch は Units Generation を通らない）。記録は `construction/code-generation/` に置く。
- 変えないもの: `src/`・`scripts/`・`tests/` のプログラム、`.github/`（workflow）、`.shirube/`、DB の構造、資格情報（要件 NFR1、OD-KUSABI-DEPS-UPGRADE-ONLY-UNIT-20261109-001）
- 勧告の中身（番号・題名・重さ・内容）は、どの file・commit・PR にも書かない（要件 NFR2）。

## Testing Contract

```json
{
  "version": 1,
  "methodology": "custom",
  "source": "team",
  "ordering": "成功の条件の場面（担当交代と再起動の後に取り出せるか）の試験を、その場面を作る実装より先に書いて失敗を確かめ、細かい試験は試験できる層ごとに実装の後に書いて動かす。",
  "scope": "security-patch",
  "test_strategy": "minimal",
  "project_type": "brownfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    },
    {
      "layer": "team",
      "text": "- **Methodology**: custom\n- **Methodology evidence**: 成功の条件は「担当交代と再起動の場面を決めた試験で取り出せる割合 100%」（D-06・D-26・D-27）なので、その場面の試験を先に固めて完了の判定をぶれさせない。細かい試験は、今の自前の tsx のスクリプトの形に合わせて実装の後に書く（面談の Q3 = C）。\n- **Ordering**: 成功の条件の場面（担当交代と再起動の後に取り出せるか）の試験を、その場面を作る実装より先に書いて失敗を確かめ、細かい試験は試験できる層ごとに実装の後に書いて動かす。\n- 網羅率: 行の網羅率 100% を床にし、統合の前に CI で確かめる。Build and Test の段でも 100% を確かめ、段を通すために弱めない（社内基準 100% = Owner の決定 OD-COMPANY-AIDLC-LINE-COVERAGE-FLOOR-100-20261105-001、iyasaka-arc#49 6647418162。org.md の既定 80% より厳しい床をここで定める）。届かない行を数えから外す時は、PR に理由を書いて独立の監査で見る。\n- PostgreSQL の試験は、最初は手元で回し、結果を PR に証拠として載せる。置き場所の設計が固まった所で CI に入れる。CI の workflow を変える時は owner の exact-head を得る（面談の Q5 = C）。\n- CI（.github/workflows/ci.yml）は Node 18・20・22 で型検査・ビルド・試験を回す。今ある試験は通ったまま保つ。"
    }
  ],
  "obligations": {
    "strategy": "minimal",
    "strategy_volume": [
      "One verifiable test per requirement at the narrowest effective level.",
      "At least one happy-path unit test per component.",
      "Unit tests are the default; a bugfix/security scope floor may require an integration or E2E regression when that is the narrowest level that reproduces the defect."
    ],
    "scope_floor": [
      "Include a targeted regression for the bug or vulnerability.",
      "Keep the existing test suite green."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "custom",
    "runner_step": "Verify the existing test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Verify the existing test runner/configuration and record the exact unit-scoped command.",
      "Custom ordering - 成功の条件の場面（担当交代と再起動の後に取り出せるか）の試験を、その場面を作る実装より先に書いて失敗を確かめ、細かい試験は試験できる層ごとに実装の後に書いて動かす。",
      "Implementation and tests - preserve that exact ordering; do not convert it to layer-local TDD.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:e86ba72a931b1f26c724d701c3667d60074aa28e8b85c6bfc0c9e60a1b01d066",
  "contract_sha256": "sha256:46ca5a69b1f1b9bb24c7cc749bc892051dc71dda690be1bd8395e9ec10a9c040"
}
```

### この取り組みでの当て方

- 試験の順（custom）のうち「成功の条件の場面の試験を先に書く」は、この取り組みに当てはまらない。プログラムを変えず、新しい場面が無いため。今ある試験を版上げの前に動かして通ることを確かめ（Step 2）、版上げの後に同じ試験を動かす（Step 7）。
- 試験の量（minimal）の「要件ごとに 1 つの試験」と、scope の床の「勧告に向けた退行の試験を足す」は、Owner の決定で外れる: この PR では試験の file を足さない（要件 FR4.4、Owner の答え Q6 = A と、要件の段の承認の後の直し）。外れたことは PR の本文の deviation_ledger に「採った判断: 変えたプログラムの行が無いので足さない」「採らなかった案: 足す」の 2 行で書く。代わりの証拠は、直した後の `npm audit --omit=dev` の 0 件（要件 FR1.3）と、今ある試験がすべて通ること（要件 FR4.1）。
- 行の網羅率 100% の床は弱めない。測れた時は数字を載せ、届かない分を deviation_ledger に書く。組み込みの道具で測れない時は、Owner の決定 OD-KUSABI-DEPS-UPGRADE-COVERAGE-NOT-MEASURABLE-DEVIATION-20261109-001 の 2 行を書く（要件 FR4.3）。
- 試験の設定の file は足さない（今の試験は設定の file を持たない）。

## 手順

### Step 1: branch を切る（構成）

- [x] GitHub の main を取り直し（`git fetch origin`）、`origin/main` から branch `kusabi/deps-advisory-upgrade-339` を切る。base の commit を記録する（今は `ee2acff9dcb83b773969d0df9d8a7884728bef67`）。
- 追跡: 要件 NFR5（統合の commit を戻せば戻る）、team.md の Way of Working（変更ごとに branch）

### Step 2: 版上げの前の試験（試験の道具の確かめ）

- [x] 今の main の lock のまま `npm ci` で依存を入れ、`unit-test-instructions.md` の T1〜T11 を動かして、もとからの結果（命令ごとの終わり方）を記録する。ここで落ちる物があれば、版上げの前から落ちている物として記録し、Owner に伺う。
- [x] あわせて、Node に組み込みの網羅率の命令（`unit-test-instructions.md` の「網羅率」）が動くかを、T4 の 1 つの file で試す。
- 追跡: 要件 FR4.1（今の試験が通る）、brownfield の決まりの Test Baseline

### Step 3: 本番の依存の版上げ（lock）

- [x] `npm audit fix --omit=dev` で package-lock.json の本番の依存を直る版へ上げる（package.json の範囲の中で上がる）。
- [x] package-lock.json の版が要件 FR1.1 の表の「上げる先」と一致するかを確かめる。一致しない（registry の状態が変わり別の版が入った）時は、先へ進まずに Owner に伺う。
- 追跡: 要件 FR1.1・FR1.2・FR1.3

### Step 4: 依存の宣言と固定（package.json）

- [x] package.json を file の道具で直す: dependencies を要件 FR2.2 の表の版に固定する（範囲の記号を消す）、zod `4.6.7` を dependencies に足す（要件 FR2.1）、engines.node を `>=20.0.0` にする（要件 FR3.1）。devDependencies は変えない（要件 FR2.3）。
- [x] `npm install --package-lock-only --ignore-scripts` で package-lock.json の先頭の項（`packages[""]`）を package.json に合わせる。ほかの項の版が変わらないことを確かめる。
- 追跡: 要件 FR2.1〜FR2.3・FR3.1、機能以外の要件 NFR4.3

### Step 5: lock の確かめ

- [x] `npm ci` が 0 で終わり、その後の `git status --porcelain package.json package-lock.json` が版上げの変更のほかに何も出さない（npm ci が lock を書き換えない）ことを確かめる（要件 FR2.4）。
- [x] 今の main の lock と比べて、(1) 増える項が `node_modules/body-parser/node_modules/content-type` と `node_modules/type-is/node_modules/content-type`（どちらも content-type 2.1.0）の 2 つだけで消える項が無い、(2) 版が変わる項が要件 FR1.1・FR1.2 の部品と先頭の項だけ、(3) すべての `resolved` の取得元が `registry.npmjs.org` で `integrity` の無い項が 0 件、(4) `hasInstallScript` を持つ項が `node_modules/esbuild` と `node_modules/fsevents` の 2 つだけ、を script（node か python で lock を読む）で確かめる（機能以外の要件 NFR4.2）。
- [x] `npm audit --omit=dev` が「found 0 vulnerabilities」を返すことを確かめる。件数だけを記録する（要件 FR1.3、機能以外の要件 NFR4.1）。
- 追跡: 要件 FR1.2・FR1.3・FR2.4、機能以外の要件 NFR4.1・NFR4.2

### Step 6: 動く Node の前提を書いた 7 行の書き換え

- [x] 次の 7 行の「Node 18 以上」を「Node 20 以上」に、file の道具で書き換える（ほかの行は変えない）:
  - `README.md` 402 行目 `- Node.js 18+` → `- Node.js 20+`
  - `CONTRIBUTING.md` 54 行目 `- Node.js 18+` → `- Node.js 20+`
  - `CLAUDE.md` 12 行目 `| ランタイム | Node.js 18+ |` → `| ランタイム | Node.js 20+ |`
  - `docs/requirements/SSOT-0_PRD.md` 44 行目 `| Tech Stack | TypeScript (ESM), Node.js 18+ |` → `Node.js 20+`、287 行目 `- Node.js 18+` → `- Node.js 20+`
  - `docs/OSS_EVALUATION_FRAMEWORK.md` 153 行目の `node:18-alpine` → `node:20-alpine`
  - `aidlc/spaces/default/codekb/agent-memory/technology-stack.md` 9 行目「Node.js 18 以上（CI は 18・20・22）」→「Node.js 20 以上（CI は 18・20・22）」
- [x] 機能以外の要件の文書を Owner の承認の時の直しに合わせる: `construction/nfr-requirements/reliability-requirements.md` の NFR1.1 を「7 行」にして上の 7 行を名指しし、`construction/nfr-requirements/tech-stack-decisions.md` の Consequences と「書き換えない物」から CLAUDE.md と OSS_EVALUATION_FRAMEWORK.md の扱いをそろえる。
- 追跡: 機能以外の要件 NFR1.1、Owner の直し（NFR Requirements の段の差し戻しと承認の時）

### Step 7: 版上げの後の試験

- [x] `unit-test-instructions.md` の T1〜T11 をこの Mac の Node で動かし、命令ごとの終わり方を記録して、Step 2 の結果と比べる。前に通った物が落ちた時、package.json と package-lock.json の中で直せなければ、ほかの file を変える前に Owner に伺う（機能以外の要件 NFR1.2）。
- 追跡: 要件 FR4.1、機能以外の要件 NFR1.2・NFR1.3

### Step 8: 行の網羅率

- [x] Step 2 で試した組み込みの網羅率の命令で、T4〜T11 の tsx の試験の file の行の網羅率を測る。測れた時は全体の数字を記録し、100% に届かない分を deviation_ledger の 1 行ずつにまとめる。測れない時は、Owner の決定の 2 行と、測れなかったことを示す出力の要点を記録する。新しい依存（c8 など）は足さない。
- 追跡: 要件 FR4.3、OD-KUSABI-DEPS-UPGRADE-COVERAGE-NOT-MEASURABLE-DEVIATION-20261109-001

### Step 9: PR に入れる記録の用意と、公開してよいかの確かめ

- [x] PR に入れる記録: codekb の 9 file（`aidlc/spaces/default/codekb/agent-memory/`）と、この取り組みの `inception/`・`construction/`（`audit/` と `.aidlc-engine/` は入れない）。Owner の答え（Code Generation の段の問い、B）。
- [x] 公開の repo に入れる前に、これらの file と変更した file を、手元の path（`/Users/`・`~/Developer` など）・秘密の値（鍵・token・接続の文字列）・非公開の repo の中身の引用で探し、見つかれば消すか伏せる。伏せた所と理由を code-summary に書く（Owner の答え）。
- [x] 勧告の番号を、統合する版の差分・commit の文・PR の本文の 3 つで、機能以外の要件 NFR2.1 の命令と正規表現で探して 0 件にする。
- 追跡: 要件 NFR1・NFR2、機能以外の要件 NFR2.1・NFR2.2、team.md の Way of Working（単位の PR に記録を入れる）

### Step 10: 監査の項目の file

- [x] `docs/audit/kusabi-deps-advisory-upgrade-339.json`（`sds-audit-items/1`）を書く。項目は、範囲（差分の file と行）・版と lock の確かめ（機能以外の要件 NFR4.1〜NFR4.4）・振る舞いの不変（試験の結果）・勧告の中身を公開しない（NFR2.1・NFR2.2）・deviation_ledger の 3 つの外れ（網羅率・退行の試験・ほか）の正直さ。出どころは、この取り組みの要件と機能以外の要件の文書と Owner の決定（#339 の 6729538122・6732638457）。
- 追跡: team.md の Way of Working（監査の項目の file を head に入れる）

### Step 11: commit と PR、CI

- [x] 変更した file と Step 9・10 の file だけを `git add` で名指しして入れ、Conventional commits の文（`fix(deps): ...`）で commit する。`.gitignore` の AI-DLC の追記と `.claude/` は入れない。
- [x] branch を push し、main への PR を出す。本文に: 要件と Owner の決定への参照、base と head、変更の一覧、Step 5 の確かめの結果（件数と 4 つの確かめ）、Step 7 の試験の結果、Step 8 の網羅率、deviation_ledger（網羅率・退行の試験を足さない 2 行・PR の大きさの予算を超える時の「AI-DLC の単位の作る段の出力」）、席が使う Kusabi の入れ替えは統合の後に Owner の手作業として別に扱うこと。勧告の中身は書かない。
- [x] PR の CI（Node 18・20・22）が終わるのを待ち、結果を記録する。Node 18 の回だけが落ちた時は、この PR では直さず、Node 18 を外す workflow の PR を先に出す（Owner の exact-head）ことを PR に書いて止まる（機能以外の要件 NFR5.2）。
- 追跡: 要件 FR3.3・FR4.1・FR4.2、機能以外の要件 NFR5.1・NFR5.2、team.md の Way of Working（1 単位 = 1 PR、段の承認の前に PR を出して CI を流す）

### この段の後（この計画の手順ではない）

- 独立の監査の依頼（`sds-audit-request/1`）は、この段の見直しと承認で記録が決まった後の最後の head で、CI が終わってから出す。依頼の後は結果が返るまで push しない（team.md の Way of Working）。統合は作者と別の席（suite-lead）。
- 席が使う Kusabi の入れ替えは、統合の後に Owner の手作業として別に扱う（要件の完了の境目）。

## 追跡の表

| 要件 | 手順 |
|------|------|
| FR1.1・FR1.2・FR1.3 | Step 3・Step 5 |
| FR2.1・FR2.2・FR2.3・FR2.4 | Step 4・Step 5 |
| FR3.1 | Step 4・Step 6 |
| FR3.2・FR3.3 | Step 11（`.github/` は変えない、Node 18 の回が落ちた時の扱い） |
| FR4.1 | Step 2・Step 7 |
| FR4.2 | Step 5・Step 11 |
| FR4.3 | Step 2・Step 8 |
| FR4.4 | Step 11（deviation_ledger） |
| NFR1.1・NFR1.2・NFR1.3 | Step 6・Step 7 |
| NFR2.1・NFR2.2 | Step 9 |
| NFR3.1 | Step 7（プログラムを変えない。本番の server は stdio のまま） |
| NFR4.1・NFR4.2・NFR4.3・NFR4.4 | Step 4・Step 5・Step 11 |
| NFR5.1・NFR5.2 | Step 1・Step 11 |
