# Kusabi: 種類付き保護情報の適用設計 v1

Status: DESIGN_REVIEW — ユーザー指示による設計改訂。実装・独立受入・適用は未実施。
Control: [Kusabi #322](https://github.com/watchout/agent-memory/issues/322)
Shared contract: [AUN / Kusabi 種類付き保護情報 v1](https://github.com/watchout/agent-comms-mcp/blob/76fa1267ab398b940dc515a5beb2a7c9638c41ea/docs/design/typed-protected-data-v1.md)
Shared work: [AUN #966](https://github.com/watchout/agent-comms-mcp/issues/966)
Date: 2026-09-20

## 1. 方針と実装順

個人情報は氏名/住所/電話番号/メール/不明の型付き記号にし、必要な原文は暗号化して保存する。
人物/組織との関係、分類の確定/推定/不明、訂正履歴を持ち、原値を必要とする業務は認可後に復号する。
保護を追加する判断と、型の確定、人物同定、保護解除、復号認可を分離する。
記号やmodel confidenceを権限として使わない。

ユーザーの追加指摘により、AUN自身のDB保存も対象とする。Kusabiだけを先に直さない。
現AUN #940/PR963・Shirube #623/PR626の修理/正式受入を継続し、
新しい保護実装はAUNの保存前処理→全保存先→認可付き読取/配送→Kusabiの順に進める。
Shirubeの合成試験・独立受入を接続するが、Kusabi単体のruntime依存にはしない。
Kodama PR73へ本変更を新たな前提として追加しない。

## 2. 共通契約とKusabiの責任

暗号、ID、型/関係、分類段階、認可、失敗、試験PM-01〜28は上記共通契約を参照する。
この文書で独自の第二の共通仕様を作らない。shared contractの採用commitは実装PRで固定する。

| Kusabi surface | 適用する変更 |
| --- | --- |
| 独自のClaude/Codex/Gemini/Antigravity等の取込 | 保存対象外/秘密を除外後、初回永続化前に保護。各adapterの実経路を確認 |
| raw_events / conversation_events | 通常contentは型付き記号。保護値はvault、参照はsidecarで保持 |
| decisions / knowledge / task_states | 元値の再コピーを防ぎ、出典と発行元付き参照を維持 |
| search_memory / recover_context / restart_pack / boot / host bridge | 通常は記号、型・根拠ある関係・未確定状態を保持 |
| embedding / log / exception | 原文と鍵を入れない。未対応surfaceは未検証として明示 |
| AUNからの受領 | issuer + scope + value_idを保持。参照を再暗号化しない |
| 復号service | trusted actor、scope、用途、宛先、source許可/失効を毎回確認 |
| snapshot / selected pack | 保存時の許可を永久の開示権限にせず、復号時に再確認 |

AUNとKusabiは各自の保護値保管領域を持つ。AUN発行の原文保管責任はAUNに残る。
AUN停止時もKusabiは記号付き復旧を継続できるが、AUN由来の元値は取得不能になり得る。
その状態をsource_unavailableとして表示し、必要値を得たと主張しない。
独立した原値復旧が必要な保護値コピーは、許可されたimport/re-encryptを別途設計する。
AUNのDBを直接横断して原文を読むことで穴埋めしない。

## 3. データ・API

共通契約§5〜7のprotected_values / metadata / entity_links / documents /
operations / reveal_auditをKusabi storeへ適用する。
現在のagent_id + optional projectは記憶namespaceであり、実主体の認証ではない。
server-side bindingを確認できないhost adapterでは復号機能を公開しない。
説明用のP01等を実IDとして使わず、発行元付きopaque IDを使う。

通常MCPツール、環境変数、DB path、recovery-pack/v1の意味を本設計だけで変更しない。
型付き表示はtext projection、機械参照は版付きsidecarに保持する。
内部service interfaceの実装・互換性検証を先にし、新MCP公開は接続工程で扱う。

## 4. 現行との差分・移行

基準main: 3399a931aac48462106202b4bb5ded1ab9bdb60e。
現行Claude ingestはredactText後の本文をraw_eventsとconversation_eventsへ保存する。
新モードは暗号化保存前に不可逆なPII置換をかけない。シークレット除外は別責務として残す。
src/redact.tsを全出力から一括除去したり、従来の秘密検出coverageを落としたりしない。

新規取込から明示有効化。旧am031-redaction-v1を同じ版のまま新方式に置換しない。
#298へ保護版/分類版/暗号版の来歴を接続する。
既存REDACTEDの原値は原資料がなければ復元不能。推測で復元しない。
既存DB一括書換え、鍵作成/変更、runtime適用は本設計PRに含めない。
SQLiteを最初の局所検証対象とし、PG/JSONの未検証parityを主張しない。
旧binaryへのdowngradeで新参照を壊さず、書込停止と互換reader/backup/key復元を使う。

## 5. #296 / #307 / PR318への接続

#296の原文破壊・誤分類の既存fixtureを維持し、新モードでは
「通常表示は記号・認可後は元bytesと一致」を追加する。正規表現修正だけで完了にしない。
未導入の暗号化を理由に現行P1を解消済みにしない。

#307の本文は凍結のためamendmentで接続する。
A1の秘匿設計にこの新要件を反映し、A2以降/A5b/復旧採点/対象席の条件は保持する。
PR318の既存の独立PASSは、その設計版の証拠としてのみ保持し、本改訂に流用しない。

## 6. 次の実装と受入

AUN先行実装後、Kusabi K1保存/取込→K2認可/検索/復旧を進める。
Jev/LLMは任意の分類改善。未承認の外部APIに個人情報を送信せず、
使えない場合もunknownを暗号化保存できる設計とする。
正規表現に合わない自由文の氏名/住所を未検査のまま通常公開しない。

PM-01〜24/28をKusabi実経路へ、PM-25〜27をAUN発行元との結合へ対応する。
合成データのbyte一致、越境拒否、鍵不在、transaction失敗、再試行、
原文の通常出力残存0、分類訂正、backup/rollbackを実行証拠で確認する。
検索/復旧成功率と過剰記号化、Jev/LLM呼出率、latency/costはbaselineから測る。
このPRは設計改訂であり、これらの製品試験・独立監査を実施済みとはしない。
