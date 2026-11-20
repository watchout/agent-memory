# チームの編成 — 質問

範囲の文書（`ideation/scope-definition/scope-document.md`）、能力の一覧（`ideation/scope-definition/intent-backlog.md`）、実現性の見立て（`ideation/feasibility/feasibility-assessment.md`）を受けて、誰が何を受け持つかを確かめます。人は owner お一人で、作業は自社の席（AI）が受け持つ形なので、場所・時差・外部の協力会社の質問は省きました。

## 役割の案（今ある決まりから）

| 役割 | 受け持つ席 | 根拠 |
|------|-----------|------|
| 決定・承認・保護面（DB・席の立ち上げなど） | owner | 意図の文書（範囲と優先度は owner が決める）、保護面の決まり |
| 設計 | arc | owner の決定（arc の受け持ちに Kusabi を含む = iyasaka-arc#49 6255833484） |
| 実行の配車と統合 | suite-lead | owner の決定（suite-lead は kusabi の配車を受け持つ = iyasaka-arc#49 5756082477、監査済みの PR の統合 = 6288848200） |
| 実装 | kusabi の席 | このリポジトリの席の設定（kusabi = 実装の受け持ち） |
| 独立の監査 | devauditor | 自分の作った物を自分で監査・統合しない決まり |

## Q1. [事業責任者] 役割の割り当て

上の案のとおりでよいか、実装を誰が受け持つかを確認します。

A. 案のとおり
B. 実装を特別実装席（spe-dev）にする
C. 実装を kusabi の席と spe-dev で分ける（どう分けるかは後の計画の段階で決める）
D. Not yet defined（まだ決まっていない）
X. Other (please specify)

[Answer]: A（arc の下書き。Kusabi の修理は既存の担当が行い、suite-lead を通して kusabi の席へつなぐと決めてある = https://github.com/watchout/iyasaka-arc/issues/49#issuecomment-5921465124・5923730247。spe-dev は案件ごとの明示の引き渡しの中だけで実装する席 = 6284423182 で、使う時は改めて決める）

## Q2. [事業責任者] 試験で使う使い捨ての Gemini の会話を誰が起こすか

範囲の段階で、試験の Gemini は使い捨ての会話を席の代わりに動かすと決めました（起こすのは owner の決定）。誰が実際に起こすかを確認します。

A. owner が自分で開く（MC1 の試作で使い捨ての Codex の会話を開いた時と同じ形）
B. owner の決定を受けて CTO が起こす（AI-DLC の評価で使い捨ての Claude の会話を起こした時と同じ形）
C. Not yet defined（まだ決まっていない）
X. Other (please specify)

（arc の勧め: A。MC1 の試作で、Owner が使い捨ての Codex の会話を開いた形と同じ = iyasaka-arc#49 6285657272。今 Owner が AI-DLC の会話を端末で開いているのと同じ手順で済み、間に入る席が要らない。B は AI-DLC の評価の時の形 = 6286735206 で、CTO を通す分だけ手順が増える）

[Answer]: B（owner がこの会話で答えた）

## Q3. [事業責任者] ほかの取り組みとの順番

arc と suite-lead は、Shirube・AUN・Onza・Tsumama の取り組みも受け持っています。Kusabi の実装を、ほかの取り組みとどの順で進めるかを確認します。

A. 決まった順（Shirube・AUN → Onza → Tsumama → Kusabi）のまま。Kusabi は停止（T102）が解け、順番が来てから実装する
B. Kusabi の実装の順を早める（owner の決定が要る）
C. Not yet defined（まだ決まっていない）
X. Other (please specify)

[Answer]: A（arc の下書き。順は Shirube・AUN → Onza → Tsumama → Kusabi と決めてある = iyasaka-arc#49 6328010677、Kusabi の新しい実装は制御系が 1 周するまで止める = 6284653618）

## Consolidated Summary Confirmation

- 答えの扱い: Q1・Q3 は arc の下書きを owner が done で確定したもの、Q2 は owner がこの会話で答えたもの
- 役割の割り当て: 案のとおり。決定・承認・保護面 = owner、設計 = arc、実行の配車と統合 = suite-lead、実装 = kusabi の席、独立の監査 = devauditor。spe-dev は使う時に改めて決める（Q1）
- 試験の使い捨ての Gemini の会話: owner の決定を受けて CTO が起こす（AI-DLC の評価の時と同じ形）（Q2）
- ほかの取り組みとの順番: 決まった順（Shirube・AUN → Onza → Tsumama → Kusabi）のまま。Kusabi の実装は停止（T102）が解け、順番が来てから（Q3）

Does this all look correct before I generate the artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
