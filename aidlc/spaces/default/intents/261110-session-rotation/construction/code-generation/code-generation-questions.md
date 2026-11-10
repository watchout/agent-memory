# Code Generation Plan Approval

AI-DLC built this plan without asking because plan approval is off for this
piece of work. This file is the record and asks nothing; to look at a plan
before it is built, ask in chat.

## Plan Approval

Built without asking: plan approval is off for this piece of work (from AIDLC_DISABLE_PLAN_APPROVAL_GUARD in aidlc.settings.local.json).

- Builds: 会話の量を測り、閾値で 1 回だけ席に引き継ぎを書かせて DB に残し、「切ってよい」の印を出し、次の会話の頭に続きを入れる経路（Claude Code・Codex）。MCP の server を先に接続させ、起動のたびの表の変更をやめる。会話の取り込みの止まりを直す。見張りは設計の記録と設計監査を先に通し、PASS の後に作る。
- Touches: 新しい module（`src/session-rotation-*.ts`・`src/rotation-watcher.ts`）、`src/transcript-stop-capture.ts`・`src/claude-session-start.ts`・`src/codex-session-start.ts`・`src/index.ts`・`src/boot.ts`・`...
- Tests: 成功の場面の試験 1 file（Claude Code と Codex、先に書いて失敗を確かめる）と、要件ごとの試験（FR1〜FR8、約 15）。見張りの試験は設計監査の PASS の後。変えた行と新しい行の網羅率 100%。

Full plan: aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/code-generation-plan.md
Test instructions: aidlc/spaces/default/intents/261110-session-rotation/construction/code-generation/unit-test-instructions.md

[Approval Fingerprint]: sha256:v3:aaf2b42a29ce66407c13e0a09acc6308bdee5640f6ec72882d018cfb813b825f
[Planned Source]: a039281a137d863f666778b2af6780cdfd57bb447bce22fbd9b3434f1bcd889d


[Answer]: Plan approval off
