# agent-memory v0.1.0-alpha MVP 実装仕様書

> 作成日: 2026-04-07
> 最終更新: 2026-04-07（CTO botフィードバック8件反映）
> 目的: MVP公開に必要な全実装項目の詳細定義
> 期限: 2週間（2026-04-21 公開目標）
> 原則: 「npm install して5分で動く」を最優先

---

## 0. MVP完了の定義（これを全て満たしたら公開する）

```
✅ テスト全通過（全グリーン）
✅ SQLiteデフォルトで動作（PostgreSQLインストール不要）
✅ npm install → MCP設定追記 → Claude Codeで動作確認 の3ステップが通る
✅ 5つのコア機能が全て動く（Session Boot / Decision Log / Compaction Recovery / Task State / Cross-Session Memory）
✅ README.md 完成（デモGIF付き、有料プラン明記）
✅ LICENSE（MIT）配置
✅ CONTRIBUTING.md 配置
✅ v0.1.0-alpha タグ付与

公開条件に含めないもの（v0.2.0以降）:
❌ PostgreSQL最適化・pgvector対応
❌ PyPI公開（npm優先）
❌ 複数bot同時検証（agent-comの領域）
❌ パフォーマンスベンチマーク
❌ CI/CD パイプライン（GitHub Actionsは後）
❌ Cursor / Codex / Gemini CLIでの検証（Claude Code動作のみでOK）
❌ agent_messagesテーブル（agent-com統合はv0.2.0）
❌ consolidated_atの実際の使用（カラムは予約済み、Layer 2要約パイプラインはv0.2.0）
❌ relevance_scoreによるソート（カラムは存在するがMVPではcreated_at降順）
```

---

## 0.1 CTO botフィードバック反映一覧（8件）

| # | 指摘 | 判断 | 対応 |
|---|------|------|------|
| 1 | agent_messagesテーブルがない | MVPには入れない | `CREATE TABLE IF NOT EXISTS`で既に安全。v0.2.0でcom統合時に追加 |
| 2 | agent_idカラムがない | ✅ 採用 | 全テーブルに追加。デフォルト`'default'`。マルチエージェント対応の布石 |
| 3 | consolidated_atカラムの予約 | ✅ 採用 | decisionsテーブルにNULL許容で追加。MVPでは未使用 |
| 4 | decisionsにupdated_atがない | ✅ 採用 | 追加。supersede時に更新 |
| 5 | ツール数が多い（11個） | ✅ 採用 | session_bootとrecover_contextを統合。modeパラメータで分岐。11→10ツール |
| 6 | relevance_scoreのLLM自己評価は不正確 | ✅ 採用 | デフォルト0.5固定。ソートはcreated_at降順。カラムは残す |
| 7 | better-sqlite3のネイティブビルド問題 | ✅ 採用 | sql.js（WASM版）に変更。全プラットフォームでネイティブビルド不要 |
| 8 | sql.jsのFTS5サポートは要検証 | ✅ 採用 | Day 2最初に検証。非対応ならLIKE検索フォールバック。ブロッカー回避 |

---

## 1. プロジェクト構成

```
agent-memory/
├── package.json
├── tsconfig.json
├── LICENSE                          ← MIT
├── README.md                        ← デモGIF + 有料プラン明記
├── CONTRIBUTING.md                  ← 貢献ガイド
├── .gitignore
├── .env.example                     ← 環境変数テンプレート
│
├── src/
│   ├── index.ts                     ← エントリポイント（MCP Server起動）
│   ├── server.ts                    ← MCP Server定義（ツール登録）
│   │
│   ├── store/                       ← ストレージ抽象層
│   │   ├── interface.ts             ← IMemoryStore インターフェース
│   │   ├── sqlite-store.ts          ← SQLite実装（sql.js / WASM、デフォルト）
│   │   ├── pg-store.ts              ← PostgreSQL実装（オプション）
│   │   └── store-factory.ts         ← 環境変数でストア切り替え
│   │
│   ├── tools/                       ← MCPツール定義
│   │   ├── session.ts               ← セッション起動・復元・終了（boot/recover統合）
│   │   ├── decision-log.ts          ← 意思決定の記録・検索
│   │   ├── task-state.ts            ← タスク状態管理
│   │   └── cross-session.ts         ← クロスセッション記憶
│   │
│   ├── schema/                      ← DBスキーマ
│   │   ├── migrations.ts            ← マイグレーション（自動実行）
│   │   └── tables.ts                ← テーブル定義
│   │
│   └── utils/
│       ├── logger.ts                ← ログ出力
│       ├── config.ts                ← 設定読み込み
│       └── errors.ts                ← エラー定義
│
├── tests/
│   ├── store/
│   │   ├── sqlite-store.test.ts     ← SQLiteストアテスト
│   │   └── pg-store.test.ts         ← PostgreSQLストアテスト（PostgreSQL起動時のみ）
│   ├── tools/
│   │   ├── session.test.ts          ← セッション起動・復元・終了テスト
│   │   ├── decision-log.test.ts
│   │   ├── task-state.test.ts
│   │   └── cross-session.test.ts
│   └── integration/
│       └── full-workflow.test.ts    ← E2Eワークフローテスト
│
└── docs/
    ├── ARCHITECTURE.md              ← 技術アーキテクチャ（後で書いてもOK）
    └── CHANGELOG.md
```

**変更点（前版からの差分）:**
- `tools/session-boot.ts` + `tools/compaction-recovery.ts` → `tools/session.ts` に統合（指摘#5）
- `sqlite-store.ts` の実装をbetter-sqlite3からsql.jsに変更（指摘#7）

---

## 2. ストレージ抽象層

### 2.1 なぜ抽象層が必要か

現在PostgreSQL前提の実装をSQLiteデフォルトに切り替えるために、ストレージ操作をインターフェースで抽象化する。これにより：
- デフォルト: SQLite（インストール不要、ファイル1個）
- オプション: PostgreSQL（環境変数で切り替え）
- 将来: Cloud版のマネージドDB（有料機能）

### 2.2 IMemoryStore インターフェース

```typescript
// src/store/interface.ts

export interface SessionRecord {
  session_id: string;
  agent_id: string;              // ★追加（指摘#2）デフォルト'default'
  project_id: string;
  started_at: string;            // ISO 8601
  ended_at: string | null;
  boot_context: string;          // JSON: 前回セッションからの引き継ぎ情報
  status: 'active' | 'ended' | 'crashed';
}

export interface DecisionRecord {
  id: string;                    // UUID
  session_id: string;
  agent_id: string;              // ★追加（指摘#2）
  project_id: string;
  timestamp: string;             // ISO 8601
  updated_at: string;            // ★追加（指摘#4）
  category: 'architecture' | 'technology' | 'convention' | 'rejection' | 'requirement';
  title: string;
  decision: string;
  reasoning: string;
  alternatives_considered: string | null; // JSON array
  status: 'active' | 'superseded' | 'revoked';
  superseded_by: string | null;
  consolidated_at: string | null; // ★追加（指摘#3）MVPでは未使用。Layer 2要約パイプライン用
}

export interface TaskRecord {
  id: string;                    // UUID
  session_id: string;
  agent_id: string;              // ★追加（指摘#2）
  project_id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
  priority: 'critical' | 'high' | 'medium' | 'low';
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  context: string;               // JSON
  blockers: string | null;       // JSON array
  parent_task_id: string | null;
}

export interface MemoryEntry {
  id: string;                    // UUID
  session_id: string;
  agent_id: string;              // ★追加（指摘#2）
  project_id: string;
  timestamp: string;
  type: 'insight' | 'pattern' | 'warning' | 'preference';
  content: string;
  tags: string;                  // JSON array
  relevance_score: number;       // ★変更（指摘#6）カラムは残すがMVPではデフォルト0.5固定
}

export interface IMemoryStore {
  // ライフサイクル
  initialize(): Promise<void>;
  close(): Promise<void>;

  // Session
  createSession(record: Omit<SessionRecord, 'ended_at'>): Promise<SessionRecord>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
  getLatestSession(projectId: string, agentId?: string): Promise<SessionRecord | null>;
  endSession(sessionId: string): Promise<void>;

  // Decision Log
  addDecision(record: Omit<DecisionRecord, 'id' | 'updated_at' | 'consolidated_at'>): Promise<DecisionRecord>;
  getDecisions(projectId: string, options?: {
    category?: DecisionRecord['category'];
    status?: DecisionRecord['status'];
    agentId?: string;              // ★追加
    limit?: number;
  }): Promise<DecisionRecord[]>;
  supersedeDecision(oldId: string, newDecision: Omit<DecisionRecord, 'id' | 'updated_at' | 'consolidated_at'>): Promise<DecisionRecord>;
  searchDecisions(projectId: string, query: string): Promise<DecisionRecord[]>;

  // Task State
  createTask(record: Omit<TaskRecord, 'id' | 'created_at' | 'updated_at'>): Promise<TaskRecord>;
  updateTask(taskId: string, updates: Partial<TaskRecord>): Promise<TaskRecord>;
  getTasks(projectId: string, options?: {
    status?: TaskRecord['status'];
    sessionId?: string;
    agentId?: string;              // ★追加
  }): Promise<TaskRecord[]>;
  getActiveTasksForSession(sessionId: string): Promise<TaskRecord[]>;

  // Cross-Session Memory
  addMemory(record: Omit<MemoryEntry, 'id'>): Promise<MemoryEntry>;
  getMemories(projectId: string, options?: {
    type?: MemoryEntry['type'];
    tags?: string[];
    agentId?: string;              // ★追加
    limit?: number;
    // ★変更（指摘#6）: minRelevance削除。MVPではcreated_at降順でソート
  }): Promise<MemoryEntry[]>;
  searchMemories(projectId: string, query: string): Promise<MemoryEntry[]>;
}
```

### 2.3 SQLite実装（デフォルト — sql.js / WASM）

```typescript
// src/store/sqlite-store.ts
// ★変更（指摘#7）: better-sqlite3 → sql.js（WASM版）
// 理由: ネイティブビルド不要。Windows / macOS / Linux 全てで動く
// トレードオフ: better-sqlite3より若干遅いが、MVPの規模では問題にならない

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';

export class SqliteStore implements IMemoryStore {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    // デフォルト: ~/.agent-memory/memory.db
    this.dbPath = dbPath || join(homedir(), '.agent-memory', 'memory.db');
  }

  async initialize(): Promise<void> {
    const SQL = await initSqlJs();

    if (existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      ensureDirSync(dirname(this.dbPath));
      this.db = new SQL.Database();
    }

    // テーブル作成（CREATE TABLE IF NOT EXISTS で冪等）
    this.db.run(CREATE_TABLES_SQL);
    this.save(); // 初期化後にファイルに書き込み
  }

  private save(): void {
    if (!this.db) return;
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  // 全てのwrite操作の後にthis.save()を呼ぶ
  // sql.jsはインメモリDBなので、明示的にファイルに書き戻す必要がある

  // searchDecisions / searchMemories:
  // ★注意（CTO bot追加指摘）: sql.jsのWASMビルドにFTS5が含まれない場合がある
  // Day 2最初に CREATE VIRTUAL TABLE ... USING fts5 が通るか検証する
  // → 通る場合: FTS5でキーワード検索
  // → 通らない場合: LIKEフォールバックを使用（下記参照）

  private fts5Available: boolean = false;

  private async checkFts5Support(): Promise<void> {
    try {
      this.db!.run("CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_test USING fts5(test_col)");
      this.db!.run("DROP TABLE IF EXISTS _fts5_test");
      this.fts5Available = true;
    } catch {
      this.fts5Available = false;
      console.warn('[agent-memory] FTS5 not available in this sql.js build. Using LIKE fallback.');
    }
  }

  // FTS5が使える場合:
  //   SELECT * FROM decisions WHERE rowid IN (SELECT rowid FROM decisions_fts WHERE decisions_fts MATCH ?)
  // LIKE フォールバック:
  //   SELECT * FROM decisions WHERE title LIKE ? OR decision LIKE ? OR reasoning LIKE ?
  //   → '%' + query + '%' でワイルドカード検索
  //   → FTS5より遅いがMVP規模（数百〜数千件）では問題にならない

  async close(): Promise<void> {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
    }
  }
}
```

**sql.js vs better-sqlite3 の判断根拠:**

```
better-sqlite3:
  ✅ 高速（ネイティブC++）
  ✅ 同期API
  ❌ node-gypが必要 → Windows/macOSでビルドエラー頻発
  ❌ Apple Silicon + 古いNode.jsで互換性問題
  ❌ 「npm installして5分で動く」の最大リスク

sql.js:
  ✅ 純粋JavaScript（WASM）→ 全プラットフォームで動く
  ✅ node-gyp不要 → ビルドエラーゼロ
  ✅ FTS5サポート済み
  ❌ インメモリDB → write後に明示的にsave()が必要
  ❌ better-sqlite3より遅い（ただしMVP規模では無視できる差）

判断: MVP原則「npm installして5分で動く」を最優先 → sql.js採用
将来: パフォーマンスが問題になったらbetter-sqlite3をオプションで追加
```

**SQLiteのデータ保存場所:**
```
~/.agent-memory/
  └── memory.db          ← メインDB（sql.jsが管理）
```

### 2.4 PostgreSQL実装（オプション）

```typescript
// src/store/pg-store.ts
// 既存実装をIMemoryStoreインターフェースに適合させる
// MVPではリファクタのみ。新機能追加なし
// agent_id, updated_at, consolidated_at カラムを追加
// pgvectorは使わない（将来のCloud版で対応）
```

### 2.5 ストアファクトリ（切り替え）

```typescript
// src/store/store-factory.ts

export function createStore(): IMemoryStore {
  const dbUrl = process.env.AGENT_MEMORY_DATABASE_URL;

  if (dbUrl && dbUrl.startsWith('postgresql://')) {
    return new PgStore(dbUrl);
  }

  // デフォルト: SQLite（sql.js / WASM）
  const dbPath = process.env.AGENT_MEMORY_DB_PATH; // オプション
  return new SqliteStore(dbPath);
}
```

**ユーザーの体験:**
```bash
# SQLite（デフォルト、設定不要）
npx agent-memory

# PostgreSQL（明示的に指定した場合のみ）
AGENT_MEMORY_DATABASE_URL=postgresql://user:pass@localhost/agentmem npx agent-memory
```

---

## 3. MCPツール定義（5機能・10ツール）

### ★変更（指摘#5）: session_bootとrecover_contextを統合

```
旧（11ツール）:
  memory_session_boot      ← セッション作成 + 復元
  memory_recover_context   ← 復元のみ（セッション作成なし）
  → LLM目線では「前の情報を取り戻す」で同じ

新（10ツール）:
  memory_session_start     ← mode: 'boot' | 'recover'
  → bootはセッション作成 + 復元
  → recoverは既存セッション内での復元
```

### 3.1 memory_session_start — セッション起動・復元（統合版）

**目的:** セッション開始時の自動復元（boot）と、compaction後の復旧（recover）を1ツールで提供。

```typescript
// MCPツール名: memory_session_start

// Input
{
  project_id: string;
  agent_id?: string;           // ★追加（指摘#2）デフォルト'default'
  mode: 'boot' | 'recover';   // ★変更（指摘#5）
  session_id?: string;         // boot時: 省略で自動生成。recover時: 現在のセッションID
  scope?: 'decisions' | 'tasks' | 'memories' | 'all';  // recover時のみ有効。デフォルト'all'
}

// Output
{
  session_id: string;
  mode: 'boot' | 'recover';
  previous_session: {          // boot時のみ。recover時はnull
    session_id: string;
    ended_at: string;
    duration_minutes: number;
  } | null;
  restored: {
    decisions: DecisionRecord[];       // statusが'active'のもの
    tasks: TaskRecord[];              // statusが'pending'または'in_progress'
    memories: MemoryEntry[];          // ★変更（指摘#6）created_at降順で直近20件
  };
  summary: string;                     // 復元情報の人間可読サマリ
  items_restored: number;
}
```

**動作詳細:**

```
mode: 'boot' の場合:
  1. 新しいSessionRecordを作成（status: 'active'）
  2. 同じproject_id（+ agent_id）の最新セッションを取得
  3. active状態のDecisionを全取得
  4. 未完了のTaskを全取得
  5. 直近の記憶を20件取得（created_at降順）
  6. summaryを生成

mode: 'recover' の場合:
  1. セッションは作成しない（既存セッション内）
  2. scopeに応じてデータを取得
  3. summaryを生成
  → compaction後にAIが「さっき何を決めたっけ？」で呼ぶ
```

**summaryのテンプレート:**
```
=== Session {mode === 'boot' ? 'Boot' : 'Recovery'} ===
Project: {project_id}
Agent: {agent_id}
{mode === 'boot' ? `Previous session: ${prev_id} (ended ${time_ago})` : `Recovering context for session: ${session_id}`}

Active Decisions ({count}):
- [{category}] {title}: {decision}
  ...（最大10件）

Pending Tasks ({count}):
- [{priority}] {title} ({status})
  ...（最大10件）

Recent Insights ({count}):
- {content}
  ...（最大5件）

Total items restored: {items_restored}
==========================================
```

### 3.2 memory_end_session — セッション終了

```typescript
// MCPツール名: memory_end_session

// Input
{
  session_id: string;
}

// Output
{
  session_id: string;
  ended_at: string;
  duration_minutes: number;
  stats: {
    decisions_made: number;
    tasks_created: number;
    tasks_completed: number;
    memories_added: number;
  };
}
```

### 3.3 memory_add_decision — 意思決定の記録

```typescript
// MCPツール名: memory_add_decision

// Input
{
  project_id: string;
  session_id: string;
  agent_id?: string;                 // ★追加（指摘#2）デフォルト'default'
  category: 'architecture' | 'technology' | 'convention' | 'rejection' | 'requirement';
  title: string;                      // 短い要約（50文字以内推奨）
  decision: string;                   // 何を決めたか
  reasoning: string;                  // なぜそう決めたか
  alternatives_considered?: string[]; // 検討した代替案
}

// Output
DecisionRecord（id, timestamp, updated_at, consolidated_at=null 自動付与）
```

### 3.4 memory_get_decisions — 意思決定の検索

```typescript
// MCPツール名: memory_get_decisions

// Input
{
  project_id: string;
  category?: string;
  status?: 'active' | 'superseded' | 'revoked';
  agent_id?: string;                  // ★追加（指摘#2）
  query?: string;                     // FTS5テキスト検索
  limit?: number;                     // デフォルト50
}

// Output
DecisionRecord[]
```

### 3.5 memory_supersede_decision — 意思決定の上書き

```typescript
// MCPツール名: memory_supersede_decision

// Input
{
  old_decision_id: string;
  project_id: string;
  session_id: string;
  agent_id?: string;                  // ★追加（指摘#2）
  category: string;
  title: string;
  decision: string;
  reasoning: string;                  // なぜ前の判断を覆すか
}

// Output
{
  old_decision: DecisionRecord;       // status → 'superseded', updated_at更新
  new_decision: DecisionRecord;
}
```

### 3.6 memory_create_task — タスク作成

```typescript
// MCPツール名: memory_create_task

// Input
{
  project_id: string;
  session_id: string;
  agent_id?: string;                  // ★追加（指摘#2）
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  context?: object;
  parent_task_id?: string;
}

// Output
TaskRecord
```

### 3.7 memory_update_task — タスク更新

```typescript
// MCPツール名: memory_update_task

// Input
{
  task_id: string;
  status?: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
  context?: object;
  blockers?: string[];
}

// Output
TaskRecord（updated_at自動更新。status='completed'ならcompleted_at自動設定）
```

### 3.8 memory_get_tasks — タスク一覧

```typescript
// MCPツール名: memory_get_tasks

// Input
{
  project_id: string;
  status?: string;
  session_id?: string;
  agent_id?: string;                  // ★追加（指摘#2）
}

// Output
TaskRecord[]
```

### 3.9 memory_add_insight — 記憶追加

```typescript
// MCPツール名: memory_add_insight

// Input
{
  project_id: string;
  session_id: string;
  agent_id?: string;                  // ★追加（指摘#2）
  type: 'insight' | 'pattern' | 'warning' | 'preference';
  content: string;
  tags?: string[];
  // ★変更（指摘#6）: relevance_scoreはInputに含めない。内部でデフォルト0.5固定
}

// Output
MemoryEntry
```

### 3.10 memory_get_insights — 記憶検索

```typescript
// MCPツール名: memory_get_insights

// Input
{
  project_id: string;
  type?: string;
  tags?: string[];                    // AND検索
  agent_id?: string;                  // ★追加（指摘#2）
  query?: string;                     // FTS5テキスト検索
  limit?: number;                     // デフォルト20
  // ★変更（指摘#6）: min_relevance削除。created_at降順でソート
}

// Output
MemoryEntry[]（created_at降順）
```

---

## 4. DBスキーマ（SQLite）

```sql
-- src/schema/tables.ts から生成されるSQL
-- ★全テーブルにagent_idカラム追加（指摘#2）
-- ★decisionsにupdated_at, consolidated_at追加（指摘#3, #4）

-- セッション管理
CREATE TABLE IF NOT EXISTS sessions (
  session_id    TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL DEFAULT 'default',    -- ★追加（指摘#2）
  project_id    TEXT NOT NULL,
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at      TEXT,
  boot_context  TEXT DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'ended', 'crashed'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(project_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(project_id, status);

-- 意思決定ログ
CREATE TABLE IF NOT EXISTS decisions (
  id                      TEXT PRIMARY KEY,
  session_id              TEXT NOT NULL REFERENCES sessions(session_id),
  agent_id                TEXT NOT NULL DEFAULT 'default',    -- ★追加（指摘#2）
  project_id              TEXT NOT NULL,
  timestamp               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),  -- ★追加（指摘#4）
  category                TEXT NOT NULL
                          CHECK (category IN ('architecture', 'technology', 'convention', 'rejection', 'requirement')),
  title                   TEXT NOT NULL,
  decision                TEXT NOT NULL,
  reasoning               TEXT NOT NULL,
  alternatives_considered TEXT,          -- JSON array
  status                  TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'superseded', 'revoked')),
  superseded_by           TEXT REFERENCES decisions(id),
  consolidated_at         TEXT           -- ★追加（指摘#3）NULL許容。MVPでは未使用
);
CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id);
CREATE INDEX IF NOT EXISTS idx_decisions_agent ON decisions(project_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_decisions_category ON decisions(project_id, category);

-- 全文検索（SQLite FTS5）
-- ★CTO bot追加指摘: sql.jsのWASMビルドにFTS5が含まれない場合がある
-- → initialize()内でcheckFts5Support()を先に実行
-- → FTS5が使えない場合、以下のCREATE/TRIGGERは全てスキップし、LIKE検索にフォールバック
-- → FTS5可否はthis.fts5Availableフラグで管理
CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
  title, decision, reasoning,
  content='decisions',
  content_rowid='rowid'
);
-- FTS同期トリガー
CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN
  INSERT INTO decisions_fts(rowid, title, decision, reasoning)
  VALUES (new.rowid, new.title, new.decision, new.reasoning);
END;
CREATE TRIGGER IF NOT EXISTS decisions_ad AFTER DELETE ON decisions BEGIN
  INSERT INTO decisions_fts(decisions_fts, rowid, title, decision, reasoning)
  VALUES ('delete', old.rowid, old.title, old.decision, old.reasoning);
END;
CREATE TRIGGER IF NOT EXISTS decisions_au AFTER UPDATE ON decisions BEGIN
  INSERT INTO decisions_fts(decisions_fts, rowid, title, decision, reasoning)
  VALUES ('delete', old.rowid, old.title, old.decision, old.reasoning);
  INSERT INTO decisions_fts(rowid, title, decision, reasoning)
  VALUES (new.rowid, new.title, new.decision, new.reasoning);
END;

-- タスク状態
CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(session_id),
  agent_id        TEXT NOT NULL DEFAULT 'default',    -- ★追加（指摘#2）
  project_id      TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'in_progress', 'blocked', 'completed', 'cancelled')),
  priority        TEXT NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT,
  context         TEXT DEFAULT '{}',     -- JSON
  blockers        TEXT,                  -- JSON array
  parent_task_id  TEXT REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(project_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);

-- クロスセッション記憶
CREATE TABLE IF NOT EXISTS memories (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(session_id),
  agent_id        TEXT NOT NULL DEFAULT 'default',    -- ★追加（指摘#2）
  project_id      TEXT NOT NULL,
  timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
  type            TEXT NOT NULL
                  CHECK (type IN ('insight', 'pattern', 'warning', 'preference')),
  content         TEXT NOT NULL,
  tags            TEXT DEFAULT '[]',     -- JSON array
  relevance_score REAL NOT NULL DEFAULT 0.5  -- ★変更（指摘#6）常に0.5。将来用に残す
);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(project_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(project_id, type);
CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(project_id, timestamp DESC);
-- ★変更（指摘#6）: relevance_scoreのインデックスを削除。timestampのDESCインデックスに変更

-- 全文検索（記憶）
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content, tags,
  content='memories',
  content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, tags)
  VALUES (new.rowid, new.content, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags)
  VALUES ('delete', old.rowid, old.content, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags)
  VALUES ('delete', old.rowid, old.content, old.tags);
  INSERT INTO memories_fts(rowid, content, tags)
  VALUES (new.rowid, new.content, new.tags);
END;

-- スキーマバージョン管理
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_version (version) VALUES (1);
```

---

## 5. MCP Server定義

### 5.1 起動とツール登録

```typescript
// src/server.ts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStore } from './store/store-factory.js';

const server = new McpServer({
  name: 'agent-memory',
  version: '0.1.0',
});

const store = createStore();

// ツール登録（10ツール — 指摘#5で11→10に削減）
// Session（統合版）
server.tool('memory_session_start', ...);    // boot + recover統合
server.tool('memory_end_session', ...);

// Decision Log
server.tool('memory_add_decision', ...);
server.tool('memory_get_decisions', ...);
server.tool('memory_supersede_decision', ...);

// Task State
server.tool('memory_create_task', ...);
server.tool('memory_update_task', ...);
server.tool('memory_get_tasks', ...);

// Cross-Session Memory
server.tool('memory_add_insight', ...);
server.tool('memory_get_insights', ...);

// 起動
async function main() {
  await store.initialize();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch(console.error);
```

### 5.2 MCPツールのスキーマ（zodで定義）

```typescript
// 例: memory_session_start（統合版）

import { z } from 'zod';

const SessionStartInput = z.object({
  project_id: z.string().describe('プロジェクト識別子'),
  agent_id: z.string().default('default').describe('エージェント識別子'),
  mode: z.enum(['boot', 'recover']).describe('boot: 新セッション作成+復元 / recover: 既存セッション内で復元'),
  session_id: z.string().optional().describe('boot時は省略で自動生成。recover時は現在のセッションID'),
  scope: z.enum(['decisions', 'tasks', 'memories', 'all']).default('all').describe('recover時の復元範囲'),
});
```

---

## 6. ユーザー導入フロー（5分で動く）

### 6.1 インストール

```bash
npm install -g agent-memory
```

**★ sql.js採用により、全プラットフォームでビルドエラーなし（指摘#7）**

### 6.2 Claude Code設定に追記

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "agent-memory",
      "args": []
    }
  }
}
```

### 6.3 Claude Codeを再起動 → 完了

### 6.4 動作確認

```
ユーザー: 「このプロジェクトのセッションを開始して」
AI: memory_session_start({ project_id: "my-project", mode: "boot" })
→ 前回のコンテキストが復元される（初回は空）

--- compactionが発生した場合 ---
ユーザー: 「さっきの決定を思い出して」
AI: memory_session_start({ project_id: "my-project", mode: "recover", session_id: "current-id" })
→ DBからコンテキストが復旧される
```

---

## 7. package.json

```json
{
  "name": "agent-memory",
  "version": "0.1.0-alpha",
  "description": "Persistent memory for AI coding agents. Your context window forgets. Your database doesn't.",
  "main": "dist/index.js",
  "bin": {
    "agent-memory": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "prepublishOnly": "npm run build && npm run test"
  },
  "keywords": [
    "mcp", "ai", "agent", "memory", "claude-code",
    "context", "persistent", "llm"
  ],
  "author": "Yuji Kaneko <yuji@iyasaka.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/iyasaka-dev/agent-memory"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.x",
    "sql.js": "^1.x",
    "uuid": "^10.x",
    "zod": "^3.x"
  },
  "optionalDependencies": {
    "pg": "^8.x"
  },
  "devDependencies": {
    "@types/node": "^22.x",
    "@types/pg": "^8.x",
    "@types/uuid": "^10.x",
    "typescript": "^5.x",
    "tsx": "^4.x",
    "vitest": "^2.x",
    "eslint": "^9.x"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**★変更（指摘#7）:**
- `better-sqlite3` → `sql.js` に変更
- `@types/better-sqlite3` 削除（sql.jsは型定義内蔵）

---

## 8. テスト一覧（全通過が公開条件）

### 8.1 ストアテスト

```
sqlite-store.test.ts（★ sql.jsベースに変更）:
  ✅ initialize: テーブルが作成される
  ✅ initialize: 2回呼んでもエラーにならない（冪等性）
  ✅ initialize: DBファイルが指定パスに作成される
  ✅ initialize: FTS5非対応でもエラーなく起動する（LIKEフォールバック）
  ✅ createSession: セッションが作成できる（agent_id='default'）
  ✅ createSession: agent_idを指定して作成できる
  ✅ getLatestSession: 最新セッションが取得できる
  ✅ getLatestSession: agent_idでフィルタできる
  ✅ endSession: セッションが終了できる
  ✅ addDecision: 意思決定が記録できる（updated_at, consolidated_at=null自動付与）
  ✅ getDecisions: カテゴリでフィルタできる
  ✅ getDecisions: agent_idでフィルタできる
  ✅ supersedeDecision: 旧決定がsuperseded+updated_at更新、新決定が作成される
  ✅ searchDecisions: テキスト検索できる（FTS5 or LIKEフォールバック）
  ✅ createTask: タスクが作成できる（agent_id付き）
  ✅ updateTask: ステータスが更新できる
  ✅ updateTask: status='completed'でcompleted_at自動設定
  ✅ getActiveTasksForSession: セッション別にアクティブタスクが取得できる
  ✅ addMemory: 記憶が追加できる（relevance_score=0.5固定）
  ✅ getMemories: タイプ・タグでフィルタできる
  ✅ getMemories: created_at降順でソートされる（relevance_scoreではない）
  ✅ searchMemories: テキスト検索できる（FTS5 or LIKEフォールバック）
  ✅ close: DB接続が正常に閉じる
  ✅ close: ファイルにデータが永続化されている

pg-store.test.ts:（PostgreSQL起動時のみ実行）
  ✅ 上記と同じテスト群（IMemoryStoreインターフェース準拠）
```

### 8.2 ツールテスト

```
session.test.ts（★ 統合版）:
  ✅ mode='boot' 初回起動: 空のコンテキストが返る
  ✅ mode='boot' 2回目起動: 前回のdecisions/tasks/memoriesが復元される
  ✅ mode='boot' agent_id指定: 該当agentのデータのみ復元される
  ✅ mode='recover': セッションが作成されない（既存セッション内）
  ✅ mode='recover' scope='decisions': decisionsのみ復旧される
  ✅ summaryが正しいフォーマットで生成される

decision-log.test.ts:
  ✅ 意思決定の記録と取得（agent_id付き）
  ✅ supersedeで旧決定のstatus変更 + updated_at更新
  ✅ consolidated_atがnullで作成される
  ✅ 検索で関連する決定が見つかる

task-state.test.ts:
  ✅ タスクの作成・更新・完了フロー（agent_id付き）
  ✅ ブロッカーの追加と解除
  ✅ 親子タスクの関連
  ✅ status='completed'でcompleted_at自動設定

cross-session.test.ts:
  ✅ セッションAで追加した記憶がセッションBで取得できる
  ✅ タグフィルタが機能する
  ✅ created_at降順でソートされる（relevance_scoreではなく）
  ✅ agent_idでフィルタできる
```

### 8.3 統合テスト

```
full-workflow.test.ts:
  ✅ 完全なワークフロー:
     session_start(boot) → add_decision → create_task →
     update_task → add_insight → end_session →
     session_start(boot, 2回目) → 全データが復元される

  ✅ compactionシミュレーション:
     データ投入 → session_start(recover) → 全復旧確認

  ✅ マルチエージェント準備:
     agent_id='bot-1'でデータ投入 → agent_id='bot-2'でデータ投入 →
     agent_id='bot-1'でget → bot-1のデータのみ返る

  ✅ SQLiteファイルが指定パスに作成・永続化される
```

---

## 9. README.md 構成

```markdown
# agent-memory

Persistent memory for AI coding agents.
Your context window forgets. Your database doesn't.

[デモGIF: session_start(boot)で前回のコンテキストが復元される様子]

> ⚠️ **Early Stage (v0.1.0-alpha)** — API may change. Feedback welcome.

## The Problem

- Your AI coding session crashes. All context is gone.
- Compaction wipes your design decisions.
- You spend 15 minutes re-explaining what you already decided.

## The Solution

agent-memory gives your AI agent a database-backed long-term memory
via MCP (Model Context Protocol).

## Quick Start (2 minutes)

```bash
npm install -g agent-memory
```

Add to your Claude Code MCP config:
```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "agent-memory",
      "args": []
    }
  }
}
```

Restart Claude Code. Done.

Works on macOS, Linux, and Windows. No native build required.

## Features

- **Session Boot**: Auto-restore context from previous sessions
- **Decision Log**: Structured record of design decisions that survives compaction
- **Task State**: Persistent task tracking across session crashes
- **Cross-Session Memory**: What one session learns, the next session knows
- **Compaction Recovery**: Restore lost context from your database

## How It Works

[アーキテクチャ図: Claude Code ↔ MCP ↔ SQLite]

agent-memory runs as a local MCP server on your machine.
No external servers. No API keys. No data leaves your machine.

## Storage

SQLite by default (zero config). PostgreSQL optional:

```bash
AGENT_MEMORY_DATABASE_URL=postgresql://... agent-memory
```

## Requirements

- Node.js 18+

## Pricing

agent-memory core is free and open source (MIT) forever.
Self-hosted will always be free.

We plan to offer a hosted cloud version with team features
(shared memory, dashboards, degradation alerts) as a paid service.
This is how we sustain the project.

| | OSS (Free) | Cloud (Coming) |
|---|:---:|:---:|
| Session Boot | ✅ | ✅ |
| Decision Log | ✅ | ✅ |
| Compaction Recovery | ✅ | ✅ |
| Task State | ✅ | ✅ |
| Cross-Session Memory | ✅ | ✅ |
| Local SQLite | ✅ | ✅ |
| Bug fixes & security | ✅ | ✅ |
| Team shared memory | — | ✅ |
| Web dashboard | — | ✅ |
| Degradation alerts | — | ✅ |
| Managed DB & backups | — | ✅ |
| Priority support | — | ✅ |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
All contributions to core are MIT licensed and will remain free forever.

## License

MIT
```

---

## 10. 2週間スケジュール

### Week 1（4/7-4/13）: 技術安定化

| 日 | タスク | 完了条件 |
|----|--------|---------|
| Day 1-2 | IMemoryStoreインターフェース定義（agent_id, updated_at, consolidated_at含む） | interface.ts完成 |
| Day 2-3 | SqliteStore実装（sql.js）— **Day 2最初にFTS5検証**。FTS5非対応ならLIKEフォールバック実装 | sqlite-store.ts完成 |
| Day 3-4 | 既存PgStoreをインターフェースに適合（agent_id等のカラム追加） | pg-store.tsリファクタ完了 |
| Day 4-5 | store-factory.ts + session.ts（boot/recover統合） | SQLiteデフォルト動作確認 |
| Day 5-6 | ストアテスト全通過 | SQLite: 23テスト全グリーン |
| Day 6-7 | ツールテスト全通過 | 全テストグリーン |

### Week 2（4/14-4/20）: 公開準備

| 日 | タスク | 完了条件 |
|----|--------|---------|
| Day 8 | 統合テスト（full-workflow + マルチエージェント準備） | E2Eテスト通過 |
| Day 9 | package.json / npm設定 / bin | npx agent-memory で起動確認 |
| Day 10 | README.md作成 | Quick Start手順が3ステップで通る |
| Day 11 | デモGIF撮影 | session_start(boot)の復元が視覚的にわかる |
| Day 12 | LICENSE / CONTRIBUTING.md | 有料プラン明記確認 |
| Day 13 | GitHub リポ作成・push | v0.1.0-alphaタグ付与 |
| Day 14 | 予備日（バグ修正・最終確認） | — |

### 公開日: 4/21（月）

```
4/21: GitHub公開 + X初投稿
4/22-27: 初期Issueへの対応 + リプライ攻勢
4/28: Hacker News "Show HN" 投稿（初期バグが潰れた状態で）
```

---

## 11. v0.1.0-alphaに含めないもの（明示的に除外）

| 項目 | 理由 | 対応時期 |
|------|------|---------|
| agent_messagesテーブル | agent-com統合の領域 | v0.2.0（com統合時） |
| consolidated_atの使用 | Layer 2要約パイプラインの領域 | v0.2.0 |
| relevance_scoreによるソート | LLM自己評価は不正確（指摘#6） | v0.3.0（別の信頼性指標を検討後） |
| ベクトル検索（pgvector/embeddings） | FTS5で十分 | v0.3.0以降 |
| 自動compaction検知 | AIが手動で呼べば十分 | v0.2.0 |
| 記憶の自動要約 | LLM依存を避ける | v0.3.0 |
| Web UI / ダッシュボード | Cloud版（有料）の領域 | Phase 2 |
| チーム間記憶共有 | Cloud版（有料）の領域 | Phase 2 |
| Cursor / Codex対応テスト | Claude Code動作のみでMVP | v0.2.0 |
| CI/CD（GitHub Actions） | 手動テストで十分 | v0.2.0 |
| npm公開 | GitHub installで十分 | 公開翌週 |
| ドキュメントサイト | READMEで十分 | v0.3.0 |
| ロゴ・ブランディング | テキストで十分 | 5月 |
