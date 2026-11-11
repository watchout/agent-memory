## Review

**Verdict:** READY
**Reviewer:** aidlc-product-lead-agent
**Date:** 2026-11-10T10:46:12Z
**Iteration:** 1
**Verdict Dictated:** no

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | Major | requirements.md > FR5.4 | FR5.4 は「見張りを席に据えることは、このPRには入れない。据える前に arc-sec の確かめとOwnerの決定を受ける」と書き、ゲートを「据える前」(deploy 前) に置いている。[検証済: requirements.md 73行目を読んだ] しかし引用元の `requirements-analysis-questions.md` Q1 の Owner の答え（選択肢 B）は「打つ見張りもこの取り組みで作る。**作る前に**、arc-sec の確かめとあなたの決定を受ける」であり、ゲートを「作る前」(build 前) に置いている。[検証済: requirements-analysis-questions.md 17・21行目を読んだ] 両者は時点が違う（コードを書き始める前か、統合後に席へ適用する前か）。この食い違いは「まだ決まっていないこと」1 で「設計の段を足すか…arc に聞く」として開問のままになっており [検証済: requirements.md 151行目]、FR5.4 自体の文面はこの開問を読まずに見ると「このまま FR5 のコードを書き始めてよい」と読める。Owner が実際に選んだ条件（B = 作る前のゲート）を要件の制約として確定させずに Construction に進むと、FR5 の実装着手が Owner の条件に反する形で始まる恐れがある。 | FR5.4 を Q1 の Owner の答え（「作る前に」arc-sec の確かめと Owner の決定を受ける）と一致する文言に直すか、承認の前に「FR5 の実装着手そのものに pre-build のゲートがかかる」ことを制約として明記する。あわせて「まだ決まっていないこと」1 を、Construction の着手前に解く開問として承認の場で明示する。 | Resolved (reviewer) |
| R-02 | Minor | requirements.md > FR7.3、非機能の要件 | FR7.3 は起動時の自動 migration 流し（`src/index.ts`・`src/boot.ts`・`src/post-tool-hook.ts`）を止め、migrate コマンドだけが表の変更を流す形に変える。[検証済: requirements.md 95行目を読んだ] これは DB の schema 自体の変更ではないが、「schema の適用経路」を変える変更であり、社内標準 S6（schema 変更は可逆で、新旧コードが同じ schema に対して同居できること。[文献確認: ~/.claude/rules/engineering-standards.md の S6 節]）の観点での移行順（旧コード経路が自動 migration に依存したまま新コードが先に展開される期間がないか）に触れていない。 | FR7.3 に、旧い自動 migration 経路に依存するデプロイが残っている間の同居（または戻し方）を一行で明記するか、S6 は適用外である理由（例: 本番にはまだ展開されていない／migrate コマンドは既存の仕組み）を一行添える。 | Resolved (reviewer) |
| R-03 | Minor | requirements.md > FR9.1〜FR9.3、「まだ決まっていないこと」2 | FR9.3 の成功指標（1 歩あたりの量の前後・取り違い・促しの回数）の分母・数え方は、要件の段では意図的に未決（Owner の決定待ち）としている。[検証済: requirements.md 115行目・152行目を読んだ] project.md の学習ルール（分母を動かすのは測度の変更に当たるため Owner が決める。[文献確認: aidlc/active-memory/project.md の Corrections 節「成功の条件の母数…」])には沿っているが、この指標が確定しないまま Construction の試験設計（FR9 の受入）に進むと、試験の合否条件が後から変わるリスクがある。 | 承認の場で、この分母決定を「Construction 着手前に Owner が決める」こととして明示し、未決のまま試験コードを先に固めないよう一行念押しする。 | Resolved (reviewer) |
| R-04 | Minor | requirements.md > FR9.3 | [検証済: requirements.md FR9.3「合否の閾値は、測った後に arc が決めて記録する。」] 測定結果を見てから閾値を決める運用になっている。[文献確認: project.md > Corrections「成功の条件の母数…を動かすことは測度の変更に当たるので、自分では決めず Owner の判断として残す。」] この学びは母数（数え方）を Owner 判断に残す趣旨で、今回は数え方自体は arc の答えとして書き込まれ済みだが、合否の閾値の決定者が arc 止まりで Owner の明示確認が文中に無い。[推測: 今回の委任（#49 6762288830）の範囲内と読めるが、承認の場での Owner の一言確認で解消できる軽微な論点] | 承認の場で、FR9.3 の閾値事後決定を Owner が明示的に妥当と認めているかを一言確認する（既に妥当なら対応不要）。 | New |

> R-01 Reviewer note: [検証済: requirements.md FR5.4 の本文「見張りを席に据えることは、この PR には入れない。据える前に arc-sec の確かめと Owner の決定を受ける。」] 決定の文面どおり「据える前に」（= install する前に）に直っている。[検証済: requirements-analysis-questions.md Q1 の直下の注記「Owner への問いと決定の文面は『席に据える前に』…この file の B の『作る前に』は書き誤り。」] Q&A file にも書き誤りの注記が足された。[検証済: requirements.md FR5.6 の本文] 見張り（FR5）だけを守る物に触れる部品として扱い、作る段の最初に設計の記録と独立の設計監査（devauditor）を 1 回通す build-gate が FR5.6 として追加され、FR1〜FR4・FR6〜FR8 はこの監査を待たずに作れると明記されている。

> R-02 Reviewer note: [検証済: requirements.md FR7.3 の箇条書き「標準 S6（新旧の同居）: 古い版の席は今までどおり起動の時に表の変更を流すので、新しい版と同じ DB の上で同居できる。本番にまだ入っていない表の変更は、migrate の command と Owner の決定で入れる。」] FR7.3 に標準 S6 の対応が足された。

> R-03 Reviewer note: [検証済: requirements.md FR9.3 の箇条書き（1 歩の定義・前後の比較期間・量の算出・取り違いの数え方・Owner の促しの回数）] arc の数え方が具体的に書き込まれた。合否の閾値だけは測定後に arc が決めて記録するとされ、[検証済: requirements.md「まだ決まっていないこと」2] この開放問いとも整合的。

### Summary

3 件の既存指摘（FR5.4 の文言・build-gate の追加、FR7.3 の S6 対応、FR9.3 の数え方）はいずれも直っており、出典・決定に紐づく形で確認できた。新規の重大な欠落や矛盾は見つからず、残る 1 件（FR9.3 の閾値事後決定）は Owner の確認を勧める程度の軽微な論点。
