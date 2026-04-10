# SSOT-4: Data Model - agent-memory (wasurezu)

> 起源: framework retrofit (2026-04-03), quality audit Phase A (2026-04-06)
> 拡充: AM-010 SSOT 充足 by Arc (2026-04-08)
> ステータス: v0.3.0 現行実装に基づく single source of truth (mvp-spec から Path B 移行後)

---

## 0. 概要

agent-memory (wasurezu) は **2 つのストレージモード** を持つ:

| モード | 用途 | バックエンド | 環境変数 |
|--------|------|-------------|---------|
| **PostgreSQL** | 本番 / multi-bot / agent-comms 連携 | `pg` (node-postgres) + pgvector | `DATABASE_URL` or `AGENT_MEMORY_DB_TYPE=postgres` |
| **SQLite** | OSS default / 単体 user / Docker 不要 | `sql.js` (WASM) | `AGENT_MEMORY_DB_TYPE=sqlite` (default) |
| **JSON** | fallback (PG 失敗時) | file system | `AGENT_MEMORY_DB_TYPE=json` |

両モードは **同一の Store interface** (`src/stores/types.ts`) に準拠し、PostgreSQL 専用機能 (pgvector) はモード切替で透過的に無効化される。

---

## 1. テーブル一覧

| テーブル | 用途 | PG 専用機能 | SQLite 制約 |
|----------|------|------------|------------|
| `decisions` | 意思決定の記録、supersede chain | embedding (vector 512) | embedding TEXT NULL |
| `task_states` | タスクライフサイクル | embedding (vector 512) | embedding TEXT NULL |
| `knowledge` | 知識・洞察・パターン | embedding (vector 512), L1→L2 merge | embedding TEXT NULL |
| `recovery_config` | bot 別の復元パラメータ | - | (差分なし) |
| `recovery_quality_log` | 復旧品質の計測 | - | (差分なし) |
| `catch_up_log` | catch-up 抽出イベントの per-event ledger (AM-026) | - | (差分なし、TIMESTAMPTZ → TEXT) |
| `agent_messages` | Discord 履歴 (agent-comms 連携時のみ) | - | **存在しない** (SQLite モードでは getRecentMessages 常に空) |

agent_messages は agent-comms スキーマ。**agent-memory が読み取り専用で連携**する形 (PG モード時のみ)。

---

## 2. テーブル定義 (PostgreSQL)

### 2.1 decisions

```sql
CREATE TABLE decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        TEXT NOT NULL,
  project         TEXT,
  decision        TEXT NOT NULL,
  context         TEXT,
  tags            TEXT[] DEFAULT '{}',
  status          TEXT DEFAULT 'active',  -- active | superseded | revoked
  superseded_by   UUID REFERENCES decisions(id),
  consolidated_at TIMESTAMPTZ,            -- L1→L2 圧縮時刻 (将来用、現在 NULL)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  embedding       vector(512)             -- pgvector、Voyage AI で生成
);

CREATE INDEX idx_decisions_agent ON decisions(agent_id, status, created_at DESC);
CREATE INDEX idx_decisions_embedding ON decisions USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_decisions_search ON decisions USING gin (
  to_tsvector('simple', COALESCE(decision, '') || ' ' || COALESCE(context, ''))
);
```

**制約**:
- `agent_id` namespace で完全に分離
- `superseded_by` で supersede chain を追跡 (循環参照は禁止、将来 trigger で防止)
- `tags` は array (PG native)、検索時は `tags && ARRAY['tag1']`

### 2.2 task_states

```sql
CREATE TABLE task_states (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       TEXT NOT NULL,
  project        TEXT,
  task           TEXT NOT NULL,
  status         TEXT NOT NULL,            -- pending | in_progress | blocked | completed | cancelled | expired
  progress       TEXT,
  files_modified TEXT[] DEFAULT '{}',
  next_steps     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  embedding      vector(512)
);

CREATE INDEX idx_task_states_agent ON task_states(agent_id, created_at DESC);
CREATE INDEX idx_task_states_embedding ON task_states USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_task_states_search ON task_states USING gin (
  to_tsvector('simple', COALESCE(task, '') || ' ' || COALESCE(progress, '') || ' ' || COALESCE(next_steps, ''))
);
```

**ライフサイクル**:
- 7 日超 in_progress → `expired` に自動遷移 (boot.ts の expireStaleTaskStates)
- task は immutable な "snapshot" 設計 (update ではなく新規 INSERT で履歴を残す)
- 同一タスクの最新状態は agent_id + task 文字列マッチで取得

### 2.3 knowledge

```sql
CREATE TABLE knowledge (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         TEXT NOT NULL,
  project          TEXT,
  title            TEXT NOT NULL,
  content          TEXT NOT NULL,
  source_type      TEXT NOT NULL,            -- manual | messages | decisions | tasks
  source_ids       UUID[] DEFAULT '{}',      -- 元データへの参照 (decisions.id 等)
  tags             TEXT[] DEFAULT '{}',
  status           TEXT DEFAULT 'active',    -- active | merged | archived | superseded
  merged_into      UUID REFERENCES knowledge(id),
  supersedes       UUID REFERENCES knowledge(id),  -- AM-024: 新が旧を指す (new → old)
  supersede_reason TEXT,                           -- AM-024: supersede の理由
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  embedding        vector(512)
);

CREATE INDEX idx_knowledge_agent ON knowledge(agent_id, status);
CREATE INDEX idx_knowledge_project ON knowledge(project, status);
CREATE INDEX idx_knowledge_embedding ON knowledge USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_knowledge_search ON knowledge USING gin (
  to_tsvector('simple', COALESCE(title, '') || ' ' || COALESCE(content, ''))
);
```

**特徴**:
- `title` + `content` の 2 階層 (要約 + 詳細)
- `source_type` で出所追跡 (Discord メッセージ自動抽出 / decisions 圧縮 / 手動入力)
- `merged_into` で重複ナレッジの統合履歴
- `supersedes` で矛盾解消 (古い情報を新しい情報で上書き、AM-024)
- 将来 L1→L2 圧縮で `consolidated_at` を導入予定

> **参照方向の注意**: `decisions` の supersede は `superseded_by` (旧→新を指す) だが、
> `knowledge` の supersede は `supersedes` (新→旧を指す)。方向が逆なので注意。
> 両テーブルとも「古いレコードの status が `superseded` になる」点は同じ。

### 2.4 recovery_config

```sql
CREATE TABLE recovery_config (
  agent_id                  TEXT PRIMARY KEY,
  max_tokens                INTEGER NOT NULL DEFAULT 1500,
  task_states_limit         INTEGER NOT NULL DEFAULT 2,
  decisions_limit           INTEGER NOT NULL DEFAULT 3,
  knowledge_limit           INTEGER NOT NULL DEFAULT 3,
  messages_limit            INTEGER NOT NULL DEFAULT 5,
  discord_history_limit     INTEGER NOT NULL DEFAULT 0,
  discord_channels          TEXT[] NOT NULL DEFAULT '{}',
  restart_message_threshold INTEGER NOT NULL DEFAULT 100,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);
```

**運用**:
- bot ごとの復元戦略を細かく制御
- デフォルト値は `src/constants.ts` の `DEFAULT_RECOVERY_CONFIG` と一致
- 未登録 bot は default で初期化される (AM-015 で seed 廃止後の動作)

### 2.5 recovery_quality_log

```sql
CREATE TABLE recovery_quality_log (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id                   TEXT NOT NULL,
  session_id                 TEXT,
  recovered_tokens           INTEGER,
  task_continued             BOOLEAN,
  search_memory_count_10min  INTEGER DEFAULT 0,
  quality_score              DOUBLE PRECISION,
  notes                      TEXT,
  created_at                 TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recovery_quality_agent ON recovery_quality_log(agent_id, created_at DESC);
```

**書き込みタイミング** (AM-002 で完成):
1. **Session boot 時**: bot 起動直後の boot.ts → recover_context 完了後に必ず 1 件 (session_id = 新セッション ID)
2. **mid-session recover_context 呼出時**: compaction 等で recover_context が再実行された場合も毎回 (session_id = 既存セッション ID で複数件)

**フィールド**:
- `recovered_tokens`: 復元出力の総トークン数
- `task_continued`: bot が boot 後 10 分以内に次の action を実行したか
- `search_memory_count_10min`: boot 後 10 分以内の search_memory 呼出回数 (低いほど良い、復元品質が高い証拠)
- `quality_score`: 0.0-1.0 の総合スコア (Stage 2 = AM-018 で算出ロジック実装)
- `notes`: recovery summary を JSON で記録 (例: `{decisions: 3, tasks: 2, knowledge: 5, messages: 0}`)

### 2.6 catch_up_log (AM-026)

```sql
CREATE TABLE catch_up_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        TEXT NOT NULL,
  source          TEXT NOT NULL,            -- conversation | discord
  content_hash    TEXT NOT NULL,            -- SHA-256 hex of extracted event content
  target_table    TEXT NOT NULL,            -- decisions | task_states | knowledge
  target_id       TEXT,                     -- inserted row's id; NULL when status='dry_run'/'skipped'
  status          TEXT NOT NULL,            -- inserted | skipped | dry_run
  content_preview TEXT,                     -- first ~200 chars of content for forensic view
  event_at        TIMESTAMPTZ NOT NULL,     -- source jsonl line's timestamp (truth-of-event)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- when this ledger row was written
);

CREATE INDEX idx_catch_up_log_dedup
  ON catch_up_log (agent_id, content_hash, event_at);
CREATE INDEX idx_catch_up_log_recent
  ON catch_up_log (agent_id, source, event_at DESC);
```

**設計**:
- **per-event ledger** (1 row per extracted event, NOT 1 row per sweep)
- 次回 sweep の `since` 下限 = `getLastCatchUpLog(agent_id, source).event_at`
- dedup window = `event_at ± 60s` AND `agent_id` AND `content_hash` 一致 → ARC 条件 #5 の `content_hash TEXT` 列がここで使われる
- `status='dry_run'` 行は `target_id` が NULL のままで残り、後で実 INSERT に切替えるための痕跡として残る
- `status='skipped'` 行も全件記録 (どの event が dedup で無視されたか forensic 可能)

**運用**:
- catch-up sweep は `~/.claude/projects/.../*.jsonl` を Source A として walk (`CLAUDE_PROJECTS_DIR` env で override 可能)
- 再帰深度は **maxDepth=3** にハードキャップ (ARC 条件 #4)。`~/.claude/projects/{slug}/{file}.jsonl` (depth=2) + 1 階層の余裕
- boot.ts が起動末尾に non-fatal で 1 回呼び出す。MCP tool `catch_up` で手動 trigger も可能
- 失敗は **stderr のみ** に出力、stdout (recovery context) を汚染しない

---

## 3. テーブル定義 (SQLite)

### 3.1 PostgreSQL との差分

| 観点 | PostgreSQL | SQLite |
|------|-----------|--------|
| ID | `UUID DEFAULT gen_random_uuid()` | `TEXT PRIMARY KEY` (アプリ側で UUID 生成) |
| 配列 | `TEXT[]` (PG native) | `TEXT NOT NULL DEFAULT '[]'` (JSON 文字列) |
| 時刻 | `TIMESTAMPTZ` | `TEXT` (ISO 8601 文字列) |
| Boolean | `BOOLEAN` | `INTEGER` (0/1) |
| Vector | `vector(512)` (pgvector) | `TEXT NULL` (常に NULL、検索で使用しない) |
| 外部キー | `REFERENCES table(col)` | (制約なし、アプリ側で整合性チェック) |
| 全文検索 | `tsvector + GIN index` | `LIKE` (FTS5 が使えれば virtual table、デフォルトでは LIKE fallback) |

### 3.2 SQLite モードの機能制約

**重要**: SQLite モードでは以下が無効化される:

1. **embedding ベクトル検索**: pgvector なし → `embedding` カラムは TEXT NULL、search は LIKE のみ
2. **agent_messages 連携**: テーブル自体が存在しない → `getRecentMessages` は常に空配列を返す
3. **searchMemory の messages フィールド**: 上記の理由で常に空 `[]`
4. **Voyage AI 埋め込み生成**: 不要 (どこにも保存しない) → API キー設定を skip
5. **agent-comms との DB 共有**: SQLite と PostgreSQL は別 DB → cross-search 不可、agent-comms 機能は PG モード専用

### 3.3 SQLite モードでも有効な機能

- 全 CRUD 操作 (decisions, task_states, knowledge, recovery_config, recovery_quality_log)
- agent_id namespace 分離
- supersede chain (decisions)
- knowledge merge / status 更新
- LIKE ベース全文検索 (CJK + ASCII boundary tokenization)
- expire stale task states
- recovery quality logging (PG と完全同等)

→ 単体ユーザーにとっては必要十分。

---

## 4. agent-comms との互換性 (CEO 指示 2026-04-08)

CEO 指示: 「DBの構成ですが、並行している agent-com と互換性が必要。同一DBを連携可能にするため、相互チェックが必要になる。MVP完成時でも構わないが、適切なタイミングに組み込んでほしい」

### 4.1 PostgreSQL モード時の同居

agent-memory と agent-comms は **同一 PostgreSQL DB に同居可能** (現状 IYASAKA 内部運用がこの形):

```
postgresql://localhost/agent_comms (DB 名)
├── agent-comms 側
│   ├── agents
│   ├── agent_messages
│   ├── channels
│   ├── threads
│   ├── audit_log
│   ├── ...
└── agent-memory 側
    ├── decisions
    ├── task_states
    ├── knowledge
    ├── recovery_config
    └── recovery_quality_log
```

**衝突検査**:
- テーブル名: 重複なし ✅ (agent-memory は decisions/task_states/knowledge/recovery_*、agent-comms は agents/agent_messages/channels/threads/audit_log/...)
- カラム名: 重複なし ✅
- 共通参照: agent_id (両側で TEXT、namespace 一致) ✅

### 4.2 同居時の利点

- **cross-search**: agent-memory の `recover_context` が agent-comms の agent_messages を JOIN して直近 Discord 履歴を含めて復元できる
- **discord_history**: agent-memory の knowledge 自動抽出が agent-comms メッセージを source として参照
- **agent_id 共有**: 同じ agent_id (例: "cto") が両 DB で同じ意味を持つ

### 4.3 SQLite モード時の独立

SQLite モードでは:
- agent-memory は別 DB (file) に存在
- agent-comms との JOIN 不可
- 機能制限: 上記 §3.2 参照

OSS 利用者の典型ユースケース (Claude Code 単体 + wasurezu) では SQLite で十分。agent-comms 連携は IYASAKA 内部運用 + 上級者向け。

### 4.4 mutual check (将来要件 = AM-017)

agent-memory が PG モードで起動した時、agent-comms スキーマの存在を **オプションで** 検出:

```typescript
// pseudo
async function detectAgentComms(client: pg.Client): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'agents' LIMIT 1`
  );
  return r.rows.length > 0;
}
```

検出結果は:
- `true` → discord_history などの連携機能を有効化
- `false` → 連携機能を無効化、agent-memory 単体動作

→ 実装は MVP 公開後で OK。AM-017 として将来起票予定。

---

## 5. recovery_config defaults と seed (AM-015 後の状態)

### 5.1 defaults (`src/constants.ts`)

新規エージェントに自動適用される:

| カラム | デフォルト値 | 説明 |
|--------|-------------|------|
| max_tokens | 1500 | 復元出力の最大トークン数 |
| task_states_limit | 2 | 復元するタスク数 (in_progress 1 + completed 1) |
| decisions_limit | 3 | 復元する decision 数 |
| knowledge_limit | 3 | 復元する knowledge 数 |
| messages_limit | 5 | 復元するメッセージ数 |
| discord_history_limit | 0 | Discord 履歴取得数 (0=無効) |
| discord_channels | [] | Discord 履歴取得対象チャンネル |
| restart_message_threshold | 100 | 再起動メッセージ閾値 |

### 5.2 watchout 内部 seed (OSS 公開前に除去予定 = AM-015)

旧 `pg-store.ts:115-126` に IYASAKA 内部の bot 設定が hardcode されていた:

| agent_id | max_tokens | task_states | decisions | messages | knowledge | discord_history | discord_channels |
|----------|-----------|-------------|-----------|----------|-----------|----------------|-----------------|
| cto | 3000 | 3 | 5 | 10 | 5 | 20 | 2ch |
| iyasaka-arc | 2000 | 3 | 3 | 10 | 3 | 10 | 1ch |
| hotel-dev | 1000 | 1 | 0 | 5 | 3 | 5 | 1ch |
| adf-dev | 1000 | 1 | 0 | 5 | 3 | 5 | 1ch |
| haishin-dev / wbs-dev / ... | 1000 | 1 | 0 | 5 | 3 | 5 | - |
| agent-com-dev | 1500 | 2 | 3 | 5 | 3 | 5 | - |

**AM-015 で除去**: OSS 公開前に `scripts/seed-watchout.sql` に移動。新規ユーザーは default で初期化される。

---

## 6. データ migration ポリシー

### 6.1 現状 (v0.3.0)

- migration runner: `src/migrate.ts`
- スキーマ追加は MIGRATIONS 配列に追記、起動時に冪等実行 (`IF NOT EXISTS`)
- schema_version 追跡なし

### 6.2 将来 (AM-019、未起票)

- `schema_version` テーブル導入
- migration を順序付けて適用、適用済みは skip
- DOWN migration はサポートしない (forward only)

---

## 7. MVP 公開時の最終形 (AM-013 通過後)

OSS 公開時の DB 状態:

```
SQLite (default):
  ~/.agent-memory/memory.db
  ├── decisions       (空)
  ├── task_states     (空)
  ├── knowledge       (空)
  ├── recovery_config (空、初回 boot 時に default で初期化)
  └── recovery_quality_log (空)

PostgreSQL (オプション):
  postgresql://user:pass@host/dbname
  ├── 同一スキーマ (agent_id namespace で multi-bot 対応)
  ├── pgvector が利用可能ならベクトル検索有効
  └── agent-comms と同居可能 (上級者向け、ドキュメントで案内)
```

---

## 改訂履歴

| 日付 | 内容 | 著者 |
|------|------|------|
| 2026-04-03 | framework retrofit 初版 | framework |
| 2026-04-06 | recovery_config defaults + seed data 追記 | quality audit Phase A |
| 2026-04-08 | AM-010 充足: テーブル全定義 (PG/SQLite両モード)、agent-comms 互換性、機能制約、SQLite getRecentMessages 制約明記 | Arc |
| 2026-04-10 | AM-026: catch_up_log table 追加 (per-event ledger, content_hash dedup, maxDepth=3) | agent-mem-dev |
