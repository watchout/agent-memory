# Code Generation Plan Approval

AI-DLC writes this file when it asks you to approve the plan. To answer here
instead of in chat, write your answer after `[Answer]:` and tell me in chat when you are done.

## Plan Approval

Approve the code plan for u1-seat-memory-skeleton?

- Builds: 共通基盤の形（`AGENT_MEMORY_MODE=common`）の置き場所の決め方・席の確かめ・決定の保存と読み出し・起動の口の回復（Claude Code と Codex）。Kusabi の置き場（DB の `kusabi`）の up/down の SQL 1 対、MCP の入口 2 つ（`log_decision`・`get_decisions`）、U1 に無い道具の...
- Touches: 新しい file 約 8 つ（`src/common-*.ts`・`sql/kusabi/`）、入口の配線（`src/index.ts`・`claude-session-start.ts`・`codex-session-start.ts`・`boot.ts`・`claude-start.ts`・`codex-start.ts`、Gemini・Antigravity の ho...
- Tests: 標準の試験量（部品ごとに 5〜8 件）。成功の条件の場面（Codex の形で決定を 1 件書く → 再起動 → Claude Code の形で読み戻す）を先に書いて失敗を確かめる。偽の SQL の窓口で CI から届く試験と、使い捨ての PostgreSQL の試験（手元だけ）の 2 層。行の網羅率は 100%（追加行）。
- 道の区分: 今の道（軽い道ではない）。DB の構造・権限・資格情報に触れ、変えた行は 100 行を超える。設計の記録だけの PR と独立の設計監査 1 回の PASS の後に code を書く（team.md）。

Full plan: aidlc/spaces/default/intents/261021-facility-ax-memory/construction/u1-seat-memory-skeleton/code-generation/code-generation-plan.md
Test instructions: aidlc/spaces/default/intents/261021-facility-ax-memory/construction/u1-seat-memory-skeleton/code-generation/unit-test-instructions.md

[Approval Fingerprint]: sha256:v3:d55e056bd5e1c5d2ab82a749fbf194a5bb572e46aef587b1c8040690e9373ffa
[Planned Source]: 67ae5cfab661d4af62516bba51a7ccfef1e7a47610a38458b203b664dc0b5679

- A. Approve Plan
- B. Request Changes
- C. I'll edit the files

[Answer]: A. Approve Plan
