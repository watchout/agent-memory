# agent-memory SSOT v0.2.0

> Claude Codeの記憶喪失問題を解決するMCPサーバー。
> 単体動作。DB推奨/なしでも動く。OSS（MIT License）。

---

## 変更サマリー: v0.1.0 → v0.2.0

| 項目 | v0.1.0 | v0.2.0 | 変更理由 |
|------|--------|--------|----------|
| compaction対策 | CLAUDE.md Compact Instructions依存 | **CLAUDE.md依存を完全排除** | LLM判断依存は信頼できない。設計原則違反 |
| recoveryモード | boot / recovery の2モード | **bootのみ。recoveryモード廃止** | pull型検索の導入でrecoveryが不要に |
| 新ツール | — | **search_memory 追加** | Adaptive Retrieval。必要時にDBを検索（SELF-RAG研究に基づく） |
| Session Boot内容 | タスク1件 + decisions 5件（~500tok） | **タスク1件のみ（~100tok）** | decisionsはsearch_memoryでpull |
| トリガー方式 | CLAUDE.md + SessionStart hook | **SessionStart hookのみ（決定論的）** | 唯一の決定論的トリガーに一本化 |
| compaction後復元 | recover_context(recovery)を呼ばせる | **search_memoryによる自然なpull** | ツールdescriptionはcompaction耐性あり |
| 防御アーキテクチャ | 単層（CLAUDE.md） | **3層（Hook + ツールdesc + 外部検知）** | 研究に基づく多層防御 |
| ストアインターフェース | searchMemory なし | **searchMemory メソッド追加** | 全文検索の抽象化 |

### 変更なし（v0.1.0から継続）

- データモデル（decisions / task_states テーブル）
- log_decision / get_decisions / supersede_decision / save_task_state の4ツール
- PostgreSQL + JSONフォールバックの二重ストア
- 環境変数（DATABASE_URL, AGENT_MEMORY_AGENT_ID, AGENT_MEMORY_PROJECT）
- トークン推定ロジック（CJK/ASCII対応）
- エージェント分離（agent_idベース）

---

## 1. 解決する問題

### Problem A: Intra-session compaction
- auto-compact（~83%）で会話テキストが消える
- LLMは劣化に気づかず、自信を持って劣化した出力を続ける
- **v0.1.0の問題:** CLAUDE.md Compact Instructionsに依存していた → compaction対象で信頼できない

### Problem B: Cross-session continuity
- セッション終了 → 次回起動時にClaude Codeは白紙
- CLAUDE.mdは静的指示のみ。動的な決定事項は保存不可

---

## 2. 設計原則

1. **LLM判断に依存しない** — 決定論的トリガー（hook）のみを信頼する
2. **CLAUDE.mdに何も書かなくても動く** — ツール定義だけで完結する
3. **全部保存、必要分だけ注入** — DBに全履歴。注入時にフィルタ
4. **pull型を主軸、push型は最小限** — 起動時はタスク1件のみ。残りはLLMが必要時にpull
5. **呼ばれなくても致命的でない設計** — search_memoryが呼ばれなくても外部検知で拾う
6. **DB推奨、なくても動く** — PostgreSQL or JSONフォールバック
7. **agent-comなしで単体動作** — 依存関係を作らない
8. **内部情報を含めない** — IYASAKA固有の設定やトークンはコードに入れない

---

## 3. アーキテクチャ: 3層防御モデル

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: SessionStart hook（決定論的・100%発火）         │
│   → recover_context(boot) を実行                        │
│   → タスク1件のみ注入（~100トークン）                    │
│   → 「何を再開すべきか」だけわかる                       │
├─────────────────────────────────────────────────────────┤
│ Layer 2: search_memory ツール（compaction耐性あり）      │
│   → MCPツール定義はcompaction対象外                      │
│   → descriptionに行動誘導を焼き込み                     │
│   → LLMが判断前に過去のdecisionsを検索                  │
│   → 発火率: 60-80%（研究の示唆に基づく推定）            │
├─────────────────────────────────────────────────────────┤
│ Layer 3: 外部劣化検知 → セッション再起動（決定論的）     │
│   → 10シグナル中7つが決定論的（既存の監視基盤）          │
│   → 劣化検知 → tmux再起動 → Layer 1に戻る              │
│   → Layer 2が失敗してもここで拾う                       │
└─────────────────────────────────────────────────────────┘
```

### 研究根拠

- **Layer 1:** SessionStart hookはClaude Codeの決定論的機能。CTO Botで実績あり
- **Layer 2:** SELF-RAG（ICLR 2024 Oral, Top 1%）が「LLMが自分で検索の必要性を判断 → 必要なら検索」を実証。MCPツールdescriptionはcompactionで消えないため、CLAUDE.mdの指示より堅牢
- **Layer 3:** IYASAKA既存の劣化シグナル監視（discord-bot-communication-rules.md参照）

### なぜCLAUDE.md依存を排除するか

| 制御層 | compaction耐性 | 発火の確実性 | 依存先 |
|--------|---------------|-------------|--------|
| CLAUDE.md Compact Instructions | ❌ compaction対象 | LLM判断依存 | テキスト指示 |
| MCPツール description | ✅ プロトコルレベル | ツール利用時に参照 | MCP仕様 |
| SessionStart hook | ✅ settings.json | 100%発火 | Claude Code機能 |

---

## 4. MCPツール一覧

### 4.1 既存ツール（v0.1.0から変更なし）

#### log_decision
決定事項をDBに保存。

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| decision | string | Yes | 決定内容 |
| context | string | No | 判断の根拠・経緯 |
| tags | string[] | No | 分類タグ |
| project | string | No | プロジェクト名 |

#### get_decisions
有効な決定事項を取得。

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| project | string | No | プロジェクトでフィルタ |
| tags | string[] | No | タグでフィルタ |
| limit | number | No | 取得件数（default: 10） |
| status | string | No | active / superseded / all |

#### supersede_decision
古い決定を新決定で上書き。

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| old_decision_id | string | Yes | 上書きされる決定のID |
| new_decision | string | Yes | 新しい決定内容 |
| context | string | No | 変更理由 |

#### save_task_state
現在の作業状態をDBに保存。

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| task | string | Yes | タスク名 |
| status | string | Yes | in_progress / completed / blocked |
| progress | string | No | 進捗 |
| files_modified | string[] | No | 変更ファイル一覧 |
| next_steps | string | No | 次にやるべきこと |

### 4.2 変更ツール

#### recover_context ← v0.2.0で変更

**変更点:** recoveryモード廃止。boot専用に簡素化。

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| project | string | No | プロジェクトでフィルタ |

**v0.1.0との差分:**
- `mode` パラメータ削除（bootのみなので不要）
- タスク1件のみ返す（in_progressのみ）
- decisions は返さない（search_memoryでpull）
- トークン予算: ~100（v0.1.0 bootの~500から大幅削減）

**返却フォーマット:**
```
⚡ SESSION BOOT — agent-memory (cto-bot)
Project: tech-lead

── CURRENT WORK ──
🔧 [in_progress] Implement auth middleware
  Progress: JWT verification done, RBAC pending
  Next: Add role-based access control
  Files: src/middleware/auth.ts, src/types.ts

Use search_memory to find past decisions when needed.
[~45 tokens injected]
```

**description（v0.2.0）:**
```
"Restore current task at session start. Returns only the most recent
in-progress task (~100 tokens). Called automatically by SessionStart hook.
Use search_memory to look up past decisions as needed during work."
```

### 4.3 新規ツール

#### search_memory ← v0.2.0で新規追加

decisionsとtask_statesをキーワード検索。pull型のAdaptive Retrieval。

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| query | string | Yes | 検索キーワード |
| scope | string | No | "decisions" / "tasks" / "all"（default: all） |
| limit | number | No | 最大件数（default: 5） |
| project | string | No | プロジェクトでフィルタ |

**返却フォーマット:**
```
🔍 search_memory: "認証" — 3 results

── DECISIONS ──
• [active] JWT auth with 7-day refresh token
  ↳ Redis vs DB → DB chosen for MVP simplicity
  Tags: auth, architecture | 2026-03-28

• [superseded] Session cookies for auth → superseded by above
  Tags: auth | 2026-03-25

── TASK STATES ──
• [completed] Implement auth middleware
  Progress: JWT + RBAC fully implemented
  Files: src/middleware/auth.ts, src/middleware/rbac.ts
  2026-03-29
```

**description（重要 — 行動誘導を焼き込む）:**
```
"Search past decisions and task context by keyword. IMPORTANT: Before
making any architectural or design decision, search first to check if a
related decision already exists. Contradicting a past decision without
checking is a common failure mode after compaction or context loss.
Also useful when you encounter unfamiliar project context, file structures,
or naming conventions that may have been established in prior sessions."
```

**設計根拠:**
- SELF-RAG（ICLR 2024）の「必要時だけ検索」思想をMCPツールで実現
- descriptionに「判断前に検索」を焼き込み → CLAUDE.mdなしでも行動誘導
- MCPツールdescriptionはcompaction対象外 → compaction後もLLMの視界に残る

**検索実装:**
- PostgreSQL: `to_tsvector('simple', decision || ' ' || coalesce(context,'') || ' ' || array_to_string(tags,' '))` で全文検索
- JSON fallback: decision + context + tags + task の部分文字列マッチ（大文字小文字無視）
- 両方のストアでtask_statesも同様に検索

---

## 5. データモデル（v0.1.0から変更なし）

```sql
CREATE TABLE decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  project TEXT,
  decision TEXT NOT NULL,
  context TEXT,
  tags TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'active',
  superseded_by UUID REFERENCES decisions(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_decisions_agent ON decisions(agent_id, status, created_at DESC);

CREATE TABLE task_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  project TEXT,
  task TEXT NOT NULL,
  status TEXT NOT NULL,
  progress TEXT,
  files_modified TEXT[] DEFAULT '{}',
  next_steps TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_task_states_agent ON task_states(agent_id, created_at DESC);
```

### v0.2.0で追加するインデックス

```sql
-- search_memory用の全文検索インデックス（PostgreSQLのみ）
CREATE INDEX idx_decisions_search ON decisions
  USING GIN (to_tsvector('simple', decision || ' ' || coalesce(context,'') || ' ' || array_to_string(tags,' ')));

CREATE INDEX idx_task_states_search ON task_states
  USING GIN (to_tsvector('simple', task || ' ' || coalesce(progress,'') || ' ' || coalesce(next_steps,'')));
```

### DBなしモード（変更なし）

- decisions → `~/.agent-memory/decisions.json`
- task_states → `~/.agent-memory/task-states.json`
- search_memory → JSON配列を全件スキャン（小規模なら十分）

---

## 6. ストアインターフェース変更

### v0.2.0で追加するメソッド

```typescript
// types.ts に追加

export interface SearchMemoryInput {
  agent_id: string;
  query: string;
  scope?: "decisions" | "tasks" | "all";
  limit?: number;
  project?: string;
}

export interface SearchMemoryResult {
  decisions: Decision[];
  task_states: TaskState[];
}

export interface Store {
  // ... 既存メソッド（変更なし）...

  /** Search decisions and task_states by keyword (v0.2.0) */
  searchMemory(input: SearchMemoryInput): Promise<SearchMemoryResult>;
}
```

---

## 7. SessionStart hook統合

### settings.json 設定

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "node /path/to/agent-memory/dist/boot.js"
      }
    ]
  },
  "mcpServers": {
    "agent-memory": {
      "command": "node",
      "args": ["/path/to/agent-memory/dist/index.js"],
      "env": {
        "AGENT_MEMORY_AGENT_ID": "cto-bot",
        "AGENT_MEMORY_PROJECT": "tech-lead"
      }
    }
  }
}
```

### boot.js（v0.2.0で新規追加）

SessionStart hookから呼ばれるスクリプト。MCPサーバーとは独立に動作。

```
処理フロー:
  1. DBまたはJSONから直近のin_progressタスク1件を取得
  2. stdoutに出力（hookの出力はセッションコンテキストに注入される）
  3. 終了（常駐しない）
```

**CLAUDE.mdには何も書かない。** hookが決定論的に発火する。

### 将来のcompaction hook対応

Claude CodeにPostCompact hookが追加された場合：

```json
{
  "hooks": {
    "SessionStart": [{ "type": "command", "command": "node .../boot.js" }],
    "PostCompact": [{ "type": "command", "command": "node .../boot.js" }]
  }
}
```

boot.jsをそのまま再利用。コード変更なしで対応可能。

---

## 8. フロー図

### Session Start（決定論的）
```
セッション起動
  ↓ settings.json: SessionStart hook発火（決定論的）
  ↓ boot.js: DB/JSONからin_progressタスク1件取得
  ↓ stdout出力 → セッションコンテキストに注入（~100トークン）
  ↓ LLMは「続きはこれ」を即座に認識
  ↓ 詳細が必要な時 → search_memory でpull
```

### 作業中（Adaptive Retrieval）
```
LLMが作業中に判断を迫られる
  ↓ search_memoryのdescriptionが視界にある（compaction後も）
  ↓ 「判断前に過去の決定を確認しよう」
  ↓ search_memory("認証方式") → 関連するdecisionsが返る
  ↓ 過去の決定と整合する判断を下す
  ↓ 新しい決定を log_decision で保存
```

### Compaction発生
```
compaction発生（~83%）
  ↓ 会話テキスト消失
  ↓ ただしDBのdecisions/task_statesは無傷
  ↓ MCPツール一覧も無傷（search_memoryのdescription含む）
  ↓ LLMが作業を続行 → 必要時にsearch_memoryを呼ぶ（Layer 2）
  ↓ 呼ばなかった場合 → 劣化シグナルを外部検知（Layer 3）
  ↓ セッション再起動 → SessionStart hook → Layer 1に戻る
```

---

## 9. CLAUDE.md方針

### v0.1.0（廃止）
```markdown
## Compact Instructions
After compaction, as your FIRST action:
1. Call recover_context with mode="recovery"
...
```

### v0.2.0（推奨）

**CLAUDE.mdにagent-memory関連の記述は不要。**

ツールdescriptionだけで動作する。ただし、ユーザーが任意で追加したい場合のオプション記述：

```markdown
## Memory（optional, for reference only）
This project uses agent-memory MCP for persistent decisions and task state.
Tools: log_decision, search_memory, save_task_state, supersede_decision
```

これはLLMへの指示ではなく、人間の開発者がCLAUDE.mdを読んだ時の参考情報。

---

## 10. 環境変数

| 変数 | 必須 | 説明 | 変更 |
|------|------|------|------|
| DATABASE_URL | No | PostgreSQL接続文字列 | 変更なし |
| AGENT_MEMORY_AGENT_ID | No | エージェント識別子（default: "default"） | 変更なし |
| AGENT_MEMORY_PROJECT | No | デフォルトプロジェクト名 | 変更なし |

---

## 11. 技術スタック（変更なし）

| レイヤー | 技術 |
|---------|------|
| ランタイム | Bun or Node.js |
| 言語 | TypeScript 5.x |
| DB（オプション） | PostgreSQL 14+ |
| DBなし | JSONファイル（~/.agent-memory/） |
| プロトコル | MCP（Model Context Protocol） |
| SDK | @modelcontextprotocol/sdk |

---

## 12. 開発フェーズ（v0.2.0更新）

### Phase 1: MVP ✅ 完了（v0.1.0）
- [x] プロジェクト骨格
- [x] MCP server基盤
- [x] decisions: DB + JSONフォールバック
- [x] task_states: DB + JSONフォールバック
- [x] log_decision / get_decisions / supersede_decision
- [x] save_task_state
- [x] recover_context（boot/recoveryモード）
- [x] テスト（25→31パス）

### Phase 2: Adaptive Retrieval（v0.2.0 ← 今ここ）
- [ ] search_memory: ストアインターフェース追加
- [ ] search_memory: PostgreSQL全文検索（GINインデックス）
- [ ] search_memory: JSON fallback（部分文字列マッチ）
- [ ] search_memory: MCPツール実装（description焼き込み）
- [ ] recover_context: recoveryモード削除、boot簡素化
- [ ] boot.js: SessionStart hook用スタンドアロンスクリプト
- [ ] 全文検索インデックスのマイグレーション追加
- [ ] テスト追加（search_memory + boot簡素化）

### Phase 3: 実戦検証
- [ ] CTO Botにデプロイ
- [ ] search_memoryの発火率を実測（目標: 60%以上）
- [ ] compaction後の品質維持を確認
- [ ] 劣化シグナルとの連携テスト

### Phase 4: agent-com連携（後回し）
- [ ] 同一DB接続設定
- [ ] タグベースの自動decision抽出
- [ ] 通信履歴からのtask_state自動更新

### Phase 5: OSS公開
- [ ] README更新（Adaptive Retrieval説明追加）
- [ ] GIF撮影（search_memoryのデモ）
- [ ] npm公開
- [ ] GitHub公開

---

## 13. agent-comとの関係（変更なし）

- 別パッケージ。agent-comなしで単体動作する
- 同一PostgreSQLに接続すれば自動連携
- agent-comのagent_messagesテーブルからdecisionを自動抽出可能（Phase 4）

---

## 14. 競合との差別化（v0.2.0更新）

| 機能 | CLAUDE.md | SQLite MCP | Context Mode | agent-memory v0.2.0 |
|------|-----------|------------|--------------|---------------------|
| 永続化 | ファイル | SQLite | セッション内 | PostgreSQL/JSON |
| 起動時注入 | 毎回全文 | LLMがrecall() | — | hook: タスク1件のみ |
| 作業中の検索 | — | LLMがrecall() | — | search_memory（pull型） |
| compaction後 | 指示が消える | LLMがrecall() | スナップショット | ツールdesc残存 + 外部検知 |
| LLM判断依存度 | 高 | 高 | 低 | **最小**（hookは決定論的） |
| クロスセッション | ✅ | ✅ | ❌ | ✅ |
| クロスエージェント | ❌ | ❌ | ❌ | ✅（agent-com連携） |

---

## 15. 研究根拠サマリー

v0.2.0の設計判断を裏付ける主要研究：

| 設計判断 | 根拠 | 参照 |
|---------|------|------|
| pull型（search_memory）の採用 | Adaptive Retrievalは確立された手法 | SELF-RAG (ICLR 2024 Oral), FLARE |
| ツールdescriptionへの行動誘導焼き込み | MCPツール定義はcompaction対象外 | MCP仕様 + Anthropic内省研究 |
| 100%の自己認識は期待しない | 全研究の共通結論 | Nature Comms 2025, Ackerman 2025 |
| 多層防御（3層） | 単一層では不十分 | MetaRAG 2024, 不確実性サーベイ群 |
| 大きいモデルほどメタ認知が改善 | Claude Opus系は最高性能グループ | Kadavath 2022, Anthropic 2025 |

詳細は `llm-metacognition-research.md` を参照。

---

## 改訂履歴

| 日付 | バージョン | 内容 |
|------|-----------|------|
| 2026-03-29 | v0.1.0 | 初版実装。5ツール + boot/recoveryモード |
| 2026-03-30 | v0.2.0 | CLAUDE.md依存排除。search_memory追加。3層防御モデル。研究に基づく再設計 |
