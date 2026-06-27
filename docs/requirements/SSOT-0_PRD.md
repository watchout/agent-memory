# SSOT-0: PRD - agent-memory (wasurezu)

> 起源: framework retrofit (2026-04-03、placeholder)
> 拡充: AM-010 SSOT 充足 by Arc (2026-04-08)
> ステータス: v0.3.0 現行実装に基づく

---

## §0 Source Set And Provenance

This PRD is part of the active design source set defined in
[`docs/design/SOURCE_ALIGNMENT.md`](../design/SOURCE_ALIGNMENT.md).

Requirement changes must link active in-branch sources for governance, schema,
brand, runtime binding, and operational evidence. Do not treat documents that
exist only in another checkout or unmerged branch as normative unless the exact
branch or commit provenance is included in the requirement delta.

Current source alignment:

- Public-alpha and OSS release scope: this PRD, `SSOT-1`, and
  `docs/OSS_EVALUATION_FRAMEWORK.md`.
- Continuity control-plane and runtime identity: `SSOT-6` and `SSOT-7`.
- API, data-model, and cross-cutting contracts: `SSOT-3`, `SSOT-4`, and
  `SSOT-5`.
- Governance policy/evidence contracts:
  `docs/design/governance/WASUREZU_MEMORY_SAFETY_GOVERNANCE.md`,
  `docs/design/governance/WASUREZU_AUN_GATE_EVIDENCE_REFS.md`,
  `docs/design/governance/WASUREZU_GOVERNED_ACTION_PROFILES.md`, and their
  machine-readable schema/profile files.
- Product naming and compatibility:
  `docs/brand/kusabi-naming-decision.md`.

This provenance section does not rename runtime surfaces, switch package or MCP
defaults, change startup/recovery behavior, or claim full enterprise
enforcement. The #148 requirements-positioning delta is a separate follow-up.

## §1 Product Overview

| Item | Value |
|------|-------|
| Product Name | **wasurezu** (旧 agent-memory) |
| Tagline | "Your context window forgets. Your database doesn't." |
| Tech Stack | TypeScript (ESM), Node.js 18+ |
| Storage | SQLite (sql.js, default) / PostgreSQL (pgvector, optional) |
| Distribution | npm package + MCP server |
| License | MIT |
| Version | v0.3.0 (internal) → v0.1.0-alpha (OSS first public release) |
| Repository | github.com/watchout/agent-memory |
| Status | Path B: 現行 v0.3.0 コードベースで進化、MVP 公開準備中 |

### §1.1 Positioning Ladder And Claim Boundary

Wasurezu adopts staged positioning. The public alpha must not be re-scoped as
the full internal control-plane or enterprise enforcement product.

`Kusabi (wasurezu compatibility name)` may be used in product/positioning prose.
Operational surfaces remain compatibility-first `wasurezu` surfaces until an
explicit follow-up changes and tests a specific surface.

| Lane | Product claim | Current status | Explicit boundary |
|------|---------------|----------------|-------------------|
| **OSS/public alpha** | Local MCP memory and recovery layer for individual technical users, with zero-config SQLite and compatibility-first `wasurezu` package, CLI, MCP server, tool namespace, DB path, env vars, and startup instructions. | Active MVP lane. Release remains gated by AM-012/AM-013/AM-014 and the OSS Evaluation Framework. | Does not claim AUN lifecycle ownership, full enterprise governance enforcement, broad ingest/reveal approval, or silent/default automatic restart authority. |
| **Internal suite/control-plane** | Living Memory Control Plane for IYASAKA multi-agent operation: raw events, memory atoms, recovery/restart packs, restart continuity, runtime binding, and AUN integration evidence. | Internal opt-in lane. SSOT-6/SSOT-7 define ownership boundaries. | Not a public default claim. AUN owns queue/runtime lifecycle in suite mode; Wasurezu supplies memory/recovery evidence and recommendations. |
| **Enterprise/governance** | Audit/evidence/enforcement posture for governed memory, recovery, import, reveal, and restart surfaces. | Future gated lane. Current governance docs and schemas are policy contracts, not live enforcement completion. | Requires machine-readable evidence emission, cross-MCP approval owner consumption, fail-closed behavior for critical actions, and contract tests before any full enforcement claim. |

Standalone OSS/local approval authority is the local operator who owns the
install, config, and local data. Approval must be represented by explicit local
config, install-time opt-in, or local approval/intention evidence. Silent
defaults are not approval. Pure MCP-only hosts may prepare packs, recommend
manual action, or report `missing_evidence`; they must not silently authorize
critical actions or pretend to own a host approval lifecycle.

## §2 Problem Statement

AI コーディングエージェント (Claude Code、Cursor、Codex 等) は **session ごとに記憶を失う**:

1. **context window 圧迫** で古い情報が auto-compaction で消える
2. **session crash** でセッション全体が消失
3. **次のセッション** は前回の続きから始められず、ユーザーが re-explain する必要

実例:
- 「あの API 設計どうしたんだっけ？」→ ユーザーが過去 chat を遡って再説明
- 「このタスクどこまで進んでた？」→ 失われている
- compaction 後に「先ほどの decision 忘れちゃった、もう 1 回教えて」

→ ユーザーの **時間ロス** と **品質劣化** の主要因。

## §3 Target Users

### Primary (MVP)

- **AI コーディングエージェントを日常的に使う個人開発者** (Claude Code がメイン想定)
- **コーディングセッションが crash / compaction する経験を持つ user**
- **「永続記憶」の価値を理解している technical user** (npm install できる)

### Secondary (v0.2.0+)

- **複数 AI エージェントを並行運用するチーム** (multi-agent namespace 利用)
- **agent-comms 系プラットフォームを併用する内部開発組織** (IYASAKA など)
- **bot メンテナを担当する DevOps エンジニア**

### Tertiary (Cloud 版、有料)

- **Enterprise チーム** (shared memory + team dashboard 必要)
- **Cursor / Codex / Gemini CLI の user** (multi-platform 対応後)

## §4 Solution Overview

agent-memory (wasurezu) は **MCP (Model Context Protocol) server** として AI コーディングエージェントに接続し、**永続記憶レイヤー** を提供する:

### コア 5 機能

1. **Session Boot**: bot 起動時に前回セッションの context を自動復元
2. **Decision Log**: 意思決定を構造化保存、supersede chain で履歴追跡
3. **Task State**: タスクライフサイクル (start → in_progress → done/blocked) を永続化
4. **Cross-Session Memory**: 過去セッションで学んだ知識を次セッションが参照
5. **Compaction Recovery**: compaction 後も DB から context を復旧

### 技術アプローチ

- **MCP 標準準拠**: Claude Code がそのまま接続できる
- **DB 永続化**: SQLite default (zero config) / PostgreSQL optional (pgvector で意味的検索)
- **タグ駆動自動蓄積**: Discord メッセージに `[TASK:start]` 等を書くだけで auto-detect
- **agent_id namespace**: 複数 bot の記憶を 1 DB で分離管理
- **plug-and-play**: `npm install` → MCP 設定追記 → 即動作

## §5 Functional Requirements

完全な feature catalog は **SSOT-1** 参照。MVP 必須機能のみ列挙:

| ID | 機能 | 優先度 | 状態 |
|----|------|-------|------|
| FR-001 | Session Boot (boot.ts SessionStart hook) | P0 | ✅ Implemented |
| FR-002 | Decision Log (log_decision / get_decisions / supersede_decision) | P0 | ✅ Implemented |
| FR-003 | Task State (save_task_state / get_task_states / expire) | P0 | ✅ Implemented |
| FR-004 | Cross-Session Memory (save_knowledge / get_knowledge / merge) | P0 | ✅ Implemented |
| FR-005 | Compaction Recovery (recover_context MCP tool) | P0 | ✅ Implemented |
| FR-006 | SQLite store (sql.js, OSS default) | P0 | ⏳ AM-001 PR#46 merge 待ち |
| FR-007 | PostgreSQL store (pg + pgvector, optional) | P0 | ✅ Implemented |
| FR-008 | post-tool-hook タグ自動検出 (MCP tool 経由) | P0 | ✅ Implemented |
| FR-009 | post-tool-hook Bash + curl 経路対応 | P0 | ⏳ AM-016 PR#51 merge 待ち |
| FR-010 | Recovery quality 計測 (recovery_quality_log) | P0 | ⏳ AM-002 PR#48 merge 待ち |
| FR-011 | multi-agent namespace (agent_id WHERE) | P0 | ✅ Implemented |
| FR-012 | search_memory 横断検索 (FTS5/LIKE) | P0 | ✅ Implemented |
| FR-013 | recovery_config bot 別パラメータ | P1 | ✅ Implemented |
| FR-014 | discord_history 統合復元 (PG モード + agent-comms) | P1 | ✅ Implemented |
| FR-015 | Voyage AI embedding 生成 (PG モード) | P2 | ✅ Implemented |
| FR-016 | task auto-expire (7 日超 in_progress) | P1 | ✅ Implemented |

## §6 Non-Functional Requirements

| 観点 | 要件 |
|------|------|
| **インストール時間** | `npm install` から動作確認まで **5 分以内** (MVP 原則) |
| **依存性** | native build なし (sql.js は WASM)、`npm ci` だけで全 OS 動作 |
| **対応 OS** | macOS, Linux (MVP)、Windows (post-MVP、CI 拡張) |
| **対応 Node** | 18.x, 20.x, 22.x (LTS + current) |
| **MCP 互換性** | Claude Code (MVP)、Cursor / Codex / Gemini CLI は v0.2.0+ |
| **DB バックエンド** | SQLite default (zero config)、PG optional (上級者向け) |
| **データ規模** | 単体運用で 100,000 entries まで快適、それ以上は PG mode 推奨 |
| **応答性** | recover_context P95 < 500ms (PG)、< 1s (SQLite) |
| **耐故障性** | DB エラーで bot 起動を block しない (boot.ts non-fatal fallback) |
| **セキュリティ** | secret はログに出さない、parameterized query のみ、agent_id namespace 強制 |

## §7 Success Metrics

### MVP 公開判定 (AM-013、OSS Evaluation Framework)

- **総合スコア ≥ 70%** (66/95)
- **全項目 ≥ 3 点** (致命的欠陥なし)
- 計測カテゴリ:
  - A: コア機能動作 (5 項目、25 点)
  - B: データ健全性 (4 項目、20 点)
  - C: 復旧品質 (3 項目、15 点)
  - D: OSS 配布準備 (4 項目、20 点)
  - E: 実運用信頼性 (3 項目、15 点)

詳細: `docs/OSS_EVALUATION_FRAMEWORK.md`

### Claim-Level Acceptance Gates (#148)

Do not use a single binary "enforcement done" claim. Release and positioning
language must name the strongest completed claim level.

| Claim level | Acceptance criteria | Allowed claim | Not allowed |
|-------------|---------------------|---------------|-------------|
| **Policy contract complete** | Governance docs, schemas, risk inventory, source alignment, and boundary language exist in the active source set. | Wasurezu has documented policy/evidence contracts and governed-action inventory. | Live enforcement, approval ownership, or safe default behavior claims. |
| **Evidence emission complete** | Recovery/restart/memory-pack outputs emit or link `policy_version`, redaction summary, omission counts, source/provenance refs, trust or memory-safety class, promotion evidence for approved memory, and explicit `missing_evidence` where applicable. | Wasurezu emits machine-readable evidence that another control-plane owner can consume. | Claiming AUN/Shirube/Kodama consumed or enforced the evidence unless integration tests prove it. |
| **Live enforcement complete** | The relevant approval/control-plane owner consumes the profiles/evidence, fails closed for critical actions, records approval and execution-attempt evidence, and contract tests prove the behavior. | Full enforcement only for the exact owner/surfaces covered by tests. | A repo-wide or enterprise-wide enforcement claim by Wasurezu alone. |

Minimum acceptance gates for later evidence/live-enforcement cells:

- `set_recovery_config` is critical and requires explicit local operator intent
  or approval evidence before any enterprise-style enforcement claim.
- Broad `ingest_conversation_events` outside current-session or allowlisted
  roots requires explicit local approval evidence; otherwise only bounded
  current-session/import-preview behavior may be claimed.
- High-risk reveal/recovery surfaces such as `search_memory`,
  `recover_context`, `restart_pack`, `restart_pack_fetch`, and
  `restart_prepare` require redaction, provenance, scope, and missing-evidence
  outputs before evidence-emission claims.
- Restart/auto-attach behavior must fail closed. `auto_restart` remains off by
  silent default and degrades to recommendation unless AUN absence, supported
  supervisor or host hook availability, and restart preauthorization evidence
  are all present.

### 公開後の継続指標

- **採用**: GitHub stars / npm weekly downloads / 公開後 1 ヶ月
- **品質**: OSS Evaluation Framework 週次自動実行、スコア推移
- **コミュニティ**: GitHub Issues / Discussions / PRs (応答率 + 解決率)
- **Cloud 版収益**: Phase 3 で評価指標追加

## §8 Scope

### In Scope (v0.1.0-alpha MVP)

- 上記 5 コア機能 + 16 機能要件
- SQLite default + PG optional
- MCP server (stdio transport)
- multi-agent namespace
- 単体ユーザー想定 (single machine)
- Claude Code 動作確認
- OSS/public alpha lane claims only. Internal control-plane and
  enterprise/governance claims require their own gates.

### Out of Scope (v0.1.0-alpha)

- **agent-comms との完全統合** (現状は co-database で連携、receiver pattern は agent-comms v0.2.0 完了後)
- **L1→L2→L3 階層化** (FEAT-016)
- **catch-up: DB→Discord 復元** (FEAT-017)
- **マルチテナント** (Cloud 版で対応)
- **アダプタパターン抽象化** (Slack/Telegram 等)
- **管理ダッシュボード**
- **quality_score 算出ロジック** (Stage 2 = AM-018)
- **full enterprise governance enforcement** (policy contracts may exist, but
  live enforcement requires later evidence/live-enforcement gates)
- **silent/default automatic host restart** (only documented host-adapter
  recommendations or explicitly preauthorized standalone paths may be claimed)

## §9 Milestones

| Phase | 期間 | 内容 |
|-------|------|------|
| **Path B 移行決定** | 2026-04-08 | mvp-spec を strategy/ に退避、現行 v0.3.0 を base に MVP 進行を CEO 承認 |
| **OSS Critical Gap 解消** | 2026-04-08 (本日) | AM-001/002/006/009/015/016 全 PR 完成 + APPROVE |
| **per-bot rollout** | 2026-04-08〜09 | 14 bot に hook 配置、24-48h データ蓄積 |
| **AM-012 OSS 評価再実行** | 2026-04-09〜10 | スコア 70%+ 目標 |
| **AM-013 公開判定** | 2026-04-10 | MVP 到達なら v0.1.0-alpha タグ、未到達なら追加 issue |
| **AM-014 npm publish** | 2026-04-10〜11 | wasurezu npm 公開、内部告知 |
| **v0.2.0+ 拡張** | 2026-04 以降 | L1→L2 階層化、catch-up、Cloud 版検討 |

## §10 Risks

| Risk | 影響 | Mitigation |
|------|------|------------|
| sql.js FTS5 非対応 | SQLite 検索性能低下 | LIKE fallback 実装済み (AM-001) |
| post-tool-hook 全 bot 配置失敗 | B3 multi-agent score 改善せず | AM-006 + AM-016 で installer + Bash 経路対応、per-bot rollout で確認 |
| Recovery quality 計測の意味不明 | C1-C3 スコア改善せず | AM-002 で実装、AM-018 で算出ロジック確定 |
| OSS 公開時に組織固有データ流出 | セキュリティ問題 | AM-015 で watchout seed を strategy/ に退避、scripts/seed-watchout.sql |
| npm 名 wasurezu の commercial 衝突 | 公開不可 | npm namespace 確認 (AM-014 で実施) |
| MCP notification 配信が unstable | recover_context が UX 悪化 | boot.ts non-fatal host fallback。Configured PostgreSQL outages without an explicit local store type must fail closed instead of writing to JSON/SQLite |
| Cloud 版の差別化失敗 | OSS だけで完結し収益化不能 | shared memory / dashboard / degradation alert を Cloud 専用機能化 |

## §11 Dependencies

### npm dependencies (現状)

```json
{
  "@modelcontextprotocol/sdk": "^1.12.1",
  "pg": "^8.13.0",
  "sql.js": "^1.14.1",  // AM-001 で追加
  "uuid": "^11.1.0"
}
```

### 外部依存

- **Voyage AI** (optional): embedding 生成。`VOYAGE_API_KEY` 環境変数で有効化、未設定なら skip
- **PostgreSQL + pgvector** (optional): PG モード時のみ
- **agent-comms** (optional): discord_history 連携時のみ

### Runtime

- Node.js 18+
- npm / yarn / pnpm

### Dev dependencies

- TypeScript 5.7+
- tsx (実行)
- @types/node, @types/pg, @types/uuid, @types/sql.js

## §12 Glossary

| 用語 | 定義 |
|------|------|
| **wasurezu** | 「忘れず」(Japanese)、agent-memory の OSS パッケージ名 |
| **MCP** | Model Context Protocol、Anthropic が提唱した AI tool 接続の標準 |
| **boot.ts** | SessionStart hook で起動される復元 entry point |
| **recover_context** | mid-session の compaction 後に呼ぶ復元 MCP tool |
| **post-tool-hook** | 各 tool 呼出後に発火する hook、タグ自動検出に使用 |
| **agent_id** | bot 識別子 (例: "cto", "arc")、namespace 分離キー |
| **Decision Log** | 意思決定の永続化、supersede chain で履歴追跡 |
| **Task State** | タスクの snapshot、ライフサイクル (in_progress/completed/blocked/expired) |
| **Knowledge** | 知識・洞察・パターン、source_type で manual / messages / decisions を区別 |
| **Recovery Config** | bot 別の復元戦略 (max_tokens / limits) |
| **Recovery Quality Log** | 復旧品質の計測ログ、AM-002 で完全実装 |
| **Compaction** | Claude Code の context 圧縮処理、古いメッセージを忘れる原因 |
| **L1/L2/L3** | 階層化された記憶 (redacted source / summary / consolidated)、v0.2.0+ で実装予定 |
| **agent-comms** | Discord/Slack 等の bot 間通信を担う関連プロジェクト、optional 連携 |
| **Path B** | 2026-04-08 に CEO が決定した進化方針、mvp-spec ではなく現行 v0.3.0 を base に |

---

## 改訂履歴

| 日付 | 内容 | 著者 |
|------|------|------|
| 2026-04-03 | framework retrofit 初版 (placeholder) | framework |
| 2026-04-08 | AM-010 充足: §1-12 全項記入、Path B 採用、wasurezu rename 反映、MVP 公開判定 framework 参照 | Arc |
