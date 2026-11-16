# Code Generation Plan Approval

AI-DLC built this plan without asking because plan approval is off for this
piece of work. This file is the record and asks nothing; to look at a plan
before it is built, ask in chat.

## Plan Approval

Built without asking: plan approval is off for this piece of work (from AIDLC_DISABLE_PLAN_APPROVAL_GUARD in aidlc.settings.local.json).

- **Builds（新しく作る物）**: 保存先を決める共有の関数 `src/store-resolution.ts`（核は入力だけで答える純粋な関数、file を読む所は薄い adapter）と、決めた結果から接続先の binding の digest を作る関数 `storeBindingSha256`（今 `codex-session-start.ts` が持つ digest の作り方を...
- **Touches（直す物）**: `src/stores/index.ts`（`createStore` が任意の `resolution` を受ける。`resolveStoreBackend` は持ち越しの入口のために残し、注釈を直す）、`src/codex-session-start.ts`（環境変数へ URL を書く `resolveCodexStoreBinding` を、結果を返...
- **Tests（試験）**: 成功の条件の場面（設定 file にだけ接続先がある席で、Stop が書いた引き継ぎを同じ保存先から読み戻せる）を先に書いて失敗を確かめる。細かい試験は層ごとに実装の後に書く。DB の構造は変えない（DDL の行 0 件）。使い捨ての PostgreSQL は手元でだけ流し、結果を PR に載せる（team.md の決まり）。PostgreSQL を使わない回帰...
- 道の区分: コードの変更は 100 行を超える見込みで（行数は監査の依頼の前検査が機械で数える。ここでは数えない）、DB の書き込みの経路（守る物）に触れるので、軽い道ではなく今の道（設計の記録だけの PR を先に出して設計監査を 1 回、PASS の後に code）で作る。

Full plan: aidlc/spaces/default/intents/261113-store-resolution-fix/construction/code-generation/code-generation-plan.md
Test instructions: aidlc/spaces/default/intents/261113-store-resolution-fix/construction/code-generation/unit-test-instructions.md

[Approval Fingerprint]: sha256:v3:3cc9a0e68eecc268f83aa6678e2382a9461497a32f61330e45aa61c421f6b3ab
[Planned Source]: 55fc30b34dfccdb64d208645d22b02239e6096ff58cc16b7c7e6751a07b1c265


[Answer]: Plan approval off
