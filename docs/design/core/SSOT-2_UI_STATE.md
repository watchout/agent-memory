# SSOT-2: UI / State - agent-memory (wasurezu)

> 起源: framework retrofit (2026-04-03、placeholder)
> 拡充: AM-010 SSOT 充足 by Arc (2026-04-08)
> ステータス: **N/A — agent-memory には UI が存在しない**

---

## 概要

agent-memory (wasurezu) は **MCP (Model Context Protocol) server** として動作する CLI / バックエンドツールです。**ユーザー向けの UI は存在しません**。

### Why N/A

- agent-memory はバックエンドサービス: AI コーディングエージェント (Claude Code 等) からの **MCP tool 呼出しを受けて動く**
- ユーザーとの直接対話は **AI エージェント側** が担当する
- データの可視化 / 編集 UI は MVP では提供しない
- DB 直接アクセス (psql / sqlite3 CLI) で運用

### MCP server としての「UI」

MCP server の "UI" に相当するものは:

| 観点 | 実装 |
|------|------|
| Input | MCP tool 呼出 (JSON-RPC over stdio) |
| Output | tool response (JSON) |
| Status | stderr ログ、`AGENT_MEMORY_LOG_CALLS=true` 時は `~/.agent-memory/calls.log` |
| Configuration | 環境変数 (`AGENT_MEMORY_*`) + `~/.agent-memory/config.json` |
| Health | プロセス起動状態 (Claude Code 側で確認) |

これらは標準的な MCP サーバーの設計で、独自の UI ではありません。

---

## 将来的な UI (Out of Scope for v0.1.0-alpha)

### Cloud 版 (有料、Phase 3)

完成版では以下の UI を計画:

| 機能 | 説明 |
|------|------|
| **Web Dashboard** | 各 bot の memory を可視化、検索、編集 |
| **Memory Browser** | decisions / task_states / knowledge をタイムラインで閲覧 |
| **Recovery Quality Graph** | quality_score / task_continued の推移 |
| **Multi-Agent View** | チーム全体の memory を一覧、shared memory 管理 |
| **Degradation Alert** | 復旧品質低下を Slack/Email で通知 |
| **Admin Panel** | recovery_config の bot 別調整、tenant 管理 |

→ 全て **v1.0+ Cloud 版** で対応。OSS core (MVP) には含めない。

### CLI ツール (post-MVP)

OSS core にも将来的に CLI を追加する可能性:

| コマンド | 用途 |
|---------|------|
| `wasurezu list decisions` | 直近 decisions を表示 |
| `wasurezu show <id>` | レコード詳細表示 |
| `wasurezu export --format json` | データエクスポート |
| `wasurezu doctor` | DB / config / hook の health check |

→ MVP では未実装。v0.2.0+ で検討。

---

## 状態管理 (内部 state)

agent-memory 自体は stateless な MCP server として動作する (各 tool 呼出は独立)。状態は **DB に永続化** される。

例外的に **boot.ts のみ** 内部 state を持つ:

```typescript
// boot.ts
let cfg = await store.getRecoveryConfig(AGENT_ID);
if (!cfg) {
  // AM-015: auto-init default
  cfg = await store.upsertRecoveryConfig({...});
}
// ...recovery output 構築
```

これは boot 1 回限りの ephemeral state で、UI とは無関係です。

---

## 結論

**SSOT-2 (UI/State) は agent-memory プロジェクトには適用されません。**

将来 Cloud 版で UI を追加する場合は、本ドキュメントを更新するか、別のプロジェクト (agent-memory-cloud) として SSOT-2 を持たせます。

---

## 改訂履歴

| 日付 | 内容 | 著者 |
|------|------|------|
| 2026-04-03 | framework retrofit 初版 (placeholder、`[要記入]`) | framework |
| 2026-04-08 | AM-010 充足: agent-memory には UI がないことを明示、将来 Cloud 版 / CLI の予定を out-of-scope として記載 | Arc |
