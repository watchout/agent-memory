# agent-memory プロジェクト CLAUDE.md

agent-memory は AI コーディングエージェントに永続記憶を提供する MCP (Model Context Protocol) サーバーです。セッションの crash / compaction を超えて、意思決定・タスク状態・学習を保持します。

## プロジェクト概要

| 項目 | 値 |
|------|-----|
| プロジェクト名 | agent-memory |
| 種別 | MCP Server (Claude Code / 他 MCP client 対応) |
| 言語 | TypeScript (ESM) |
| ランタイム | Node.js 18+ |
| DB バックエンド | PostgreSQL (本番) / SQLite via sql.js (OSS デフォルト、実装中) |
| ライセンス | MIT |
| 公開目標 | `v0.1.0-alpha` (2026-04-21 頃、3 週間で MVP) |
| リポジトリ | `github.com/watchout/agent-memory` |

## ミッション

> Your context window forgets. Your database doesn't.

AI コーディングセッションが crash しても / compaction で記憶を失っても、DB から復旧できる。何を決めたか、何を学んだか、どこで詰まっているか — 次のセッションが全て引き継げる状態を作る。

---

## 必読ドキュメント

新機能開発・設計判断の前に必ず確認:

1. **`docs/OSS_EVALUATION_FRAMEWORK.md`** — 公開判定の評価フレームワーク (Arc, 2026-04-08)
2. **`docs/IMPLEMENTATION_PLAN.md`** — MVP 到達までの実装計画 (Arc, 2026-04-08)
3. **`docs/design/core/SSOT-3_API_CONTRACT.md`** — MCP ツール仕様
4. **`docs/design/core/SSOT-4_DATA_MODEL.md`** — DB スキーマ
5. **`docs/design/core/SSOT-5_CROSS_CUTTING.md`** — Recovery quality / post-tool-hook / multi-agent

**注意**: `docs/strategy/mvp-spec-v0.1.0-original.md` (旧 `agent-memory-mvp-spec.md`) は **2026-04-07 時点の forward-looking な再設計プラン** であり、現行実装 (v0.3.0) とは API/データモデルが乖離している。**SSOT-* が現行の single source of truth** です。

---

## 現在のステータス (2026-04-08)

- **バージョン**: v0.3.0 (本番稼働中)
- **MVP 到達度**: **45.3% (43/95)**、MVP未到達
- **稼働 bot**: CTO, agent-com-dev 等 (IYASAKA 内部、7 日間実績)
- **Critical Gap**: SQLite store 未実装 / 復旧品質計測未機能 / LICENSE+CONTRIBUTING 不在 / multi-agent 偏り

---

## 実装中の MVP Critical タスク (AM-001〜014)

`docs/IMPLEMENTATION_PLAN.md` を参照。優先順:

### Phase 1 (OSS Critical Gap)
- AM-001: SQLite store (sql.js)
- AM-002: 復旧品質計測完全実装
- AM-003: LICENSE ✅ 配置済み
- AM-004: CONTRIBUTING.md
- AM-005: README 改善 + デモGIF
- AM-006: multi-agent hook 展開

### Phase 2 (ADF Framework 完成)
- AM-007: CLAUDE.md ✅ 本ファイル
- AM-008: ADF hooks 配布 (channel-routing, framework-runner, gate-quality, gate-release, post-task) ✅ 配置済み
- AM-009: Gate A 要件 (.env.example / docker-compose / CI)
- AM-010: SSOT-0/1/3/4/5 充足
- AM-011: mvp-spec を strategy/ に退避

### Phase 3 (再評価 + 公開)
- AM-012: OSS 評価再実行
- AM-013: v0.1.0-alpha 公開判定
- AM-014: npm 公開

---

## コードスタイル

- **TypeScript ESM** (全ファイル `import` 構文)
- **1 ファイル 400 行以内を目安、最大 800 行**
- **絵文字を使わない**（コード / コメント / ドキュメント）
- **イミュータブル**: オブジェクト/配列を直接変更しない
- **try/catch** で適切なエラーハンドリング
- **Zod** でバリデーション
- **コメントは最小限**: コードで表現できるものはコメント不要

## セキュリティ

- シークレット (DATABASE_URL, 外部 API キー) をハードコードしない
- 環境変数経由で渡す
- 全ユーザー入力をバリデーション
- パラメータ化クエリのみ使用 (SQL injection 防止)

## Git ワークフロー

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
- `main` への直接コミット禁止
- PR にはレビュー必須 (CTO + Arc のいずれか)
- マージ前にテスト pass 必須

---

## 主要コマンド

```bash
# 依存インストール
npm install

# ビルド
npm run build

# テスト (PostgreSQL モード)
npm run test:pg

# マイグレーション実行
npm run migrate

# MCP サーバー起動 (開発)
npm run dev

# ブート (SessionStart hook)
npm run boot
```

---

## 独立性の原則 (agent-comms との関係)

```
mem: com に依存しない (discord_history 取得はオプション機能)
com: mem に依存しない (watchdog は mem なしでも動く)
連携: 両方入っている場合は相互連携で品質向上 (1+1 > 2)
```

- **mem 単体ユーザー**: recover_context のみ使用。com なしで動作
- **com 単体ユーザー**: watchdog + メッセージ管理。mem なしで動作
- **両方使うユーザー**: 統合復元 + 定期リフレッシュの最高品質体験

**agent-comms v0.2.0 Receiver 方式との整合**: SQLite モードでは agent-memory は **別 DB 完全分離** (OSS eval Q3 = A 案)。

---

## 禁止事項

```
- mvp-spec (strategy/) に合わせるためだけの大規模書き換え
  → 現行 v0.3.0 が SSOT (Path B, CEO 承認済み 2026-04-08)
- 本番データ (task_states / decisions / knowledge) の破壊的変更
- テスト未実装のまま merge
- LICENSE / NOTICE ヘッダの改変
```

---

## 連絡先

- **CEO**: snsmaster369 (IYASAKA CEO)
- **Arc**: 設計判断 + 完了判定
- **CTO**: 技術判断 + ADR 起票
- **agent-mem Dev / agent-com Dev**: 実装担当

**Remember**: agent-memory は「記憶を失ったエージェントが、DB から人格を取り戻す」ツール。全ての実装は「次のセッションの自分」が感謝する設計であること。
