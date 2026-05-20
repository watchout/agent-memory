# SSOT-5: Cross-Cutting Concerns - agent-memory (wasurezu)

> 起源: framework retrofit (2026-04-03)
> 拡充: AM-010 SSOT 充足 by Arc (2026-04-08)
> ステータス: v0.3.0 現行実装に基づく

---

## 1. 認証・認可 (Authentication & Authorization)

### 1.1 MCP プロトコル層

agent-memory は **MCP (Model Context Protocol) server** として動作する。MCP 仕様上、認証は以下の階層で扱う:

- **transport**: stdio (Claude Code が child process として spawn) → OS プロセス境界が認証
- **MCP tool 呼出**: Claude Code セッション内からの呼出は信頼済みとして扱う (MCP 仕様準拠)
- **agent_id namespace**: 各 bot が起動時に `AGENT_MEMORY_AGENT_ID` を設定し、自身の data を namespace 内で管理。**他の agent_id への access を強制的に防止する mechanism は無い** (LLM が自分の agent_id を信じて使う前提)

### 1.2 DB 層

- **PostgreSQL モード**: DB 接続文字列 (`DATABASE_URL` or `AGENT_MEMORY_DATABASE_URL`) で認証。多くの場合 localhost / unix socket / read-write user
- **SQLite モード**: ファイルシステム権限のみ (`~/.agent-memory/memory.db`)。**ユーザー単一マシン前提**で multi-user 想定なし

### 1.3 Voyage AI (オプション)

embedding 生成時に外部 API を呼ぶ。`VOYAGE_API_KEY` 環境変数で認証。**SQLite モードでは Voyage 不要** (embedding カラム NULL)。

### 1.4 OSS 公開時の制約

- **シークレットを log に出さない**: DATABASE_URL や VOYAGE_API_KEY を error message で reveal しない
- **DB 接続失敗時のメッセージ**: connection string を含めず "Failed to connect to database" のみ
- **multi-user は scope 外**: v0.1.0-alpha は単一ユーザー想定。multi-tenant 化は将来 Cloud 版

---

## 2. エラーハンドリング (Error Handling)

### 2.1 原則

- **try/catch 必須**: 全 MCP tool 呼出を try/catch でラップ、エラーを構造化した結果として返す
- **ユーザーには分かりやすく**: 内部 stack trace ではなく、ユーザーが次の行動を判断できるメッセージ
- **non-fatal は warn ログ**: agent-memory の補助機能 (Voyage embedding 等) の失敗で全体が停止しない
- **fatal は明示**: DB 接続失敗等は明示的に process.exit(1) でクラッシュ → MCP client が再接続を試みる

### 2.2 エラーカテゴリ

| カテゴリ | 例 | 対応 |
|----------|-----|------|
| **validation** | 必須引数欠落、型不一致 | 即座に error response、Zod でバリデーション |
| **not found** | UUID 指定の record が無い | error response with `code: "NOT_FOUND"` |
| **agent isolation** | 他 agent_id の record にアクセス試行 | NOT_FOUND として扱う (existence を漏らさない) |
| **DB error** | 接続切れ、constraint 違反 | retry 1 回 → fail、process.exit(1) |
| **embedding 失敗** | Voyage API timeout / rate limit | warn ログ + embedding=NULL で続行 (non-fatal) |
| **JSON parse 失敗** | tags / source_ids カラムが破損 | warn ログ + 空配列で fallback |

### 2.3 boot.ts のエラー耐性

bot 起動時の `boot.ts` は **絶対に process を kill しない**:

- DB 接続失敗 → JSON store fallback
- Voyage API 失敗 → embedding なしで続行
- recovery_quality_log INSERT 失敗 → warn ログだけ、recovery 自体は完了
- recover_context 自体が失敗 → 空の recovery summary を返して bot は起動を続行

理由: bot の起動を agent-memory のバグでブロックしない。bot は agent-memory なしでも動く設計。

---

## 3. ログ戦略 (Logging)

### 3.1 stderr ログ (MCP server)

agent-memory は MCP server として stdout を MCP プロトコル通信に占有する。**全てのログは stderr に出力**:

```typescript
console.error("[agent-memory] ...");
process.stderr.write("...");
```

stdout への console.log は MCP プロトコルを破壊するので絶対禁止。

### 3.2 ログレベル

| レベル | 使用 |
|--------|------|
| `error` | DB 接続失敗、致命的エラー |
| `warn` | non-fatal: embedding 失敗、parse 失敗、bot data missing |
| `info` | mode 選択、recovery summary |
| `debug` | 開発時のみ、本番無効 |

### 3.3 ファイルログ (オプション)

- `~/.agent-memory/calls.log`: tool 呼出の履歴 (debug 用、optional)
- 上限: 100MB、超過時はローテート
- OSS 配布時はオフ default、`AGENT_MEMORY_LOG_CALLS=true` で有効化

---

## 4. Recovery Quality 計測 (AM-002 で完成)

詳細なリスタート検証手順、プローブ、採点基準、fallback ladder は
[`docs/operations/RECOVERY_EVALUATION.md`](../../operations/RECOVERY_EVALUATION.md)
を正とする。本節は DB 計測フィールドの概要を定義する。

### 4.1 計測対象

**目的**: 「recover_context が呼ばれた時に、bot がどれだけスムーズに作業を再開できたか」を定量化する。

### 4.2 計測タイミング

1. **Session boot 時**: bot 起動直後の boot.ts → recover_context 完了後に必ず 1 件 INSERT
2. **mid-session recover_context 呼出時**: compaction 等で再呼出された場合も毎回 INSERT
3. **session_id**: 1 セッション内に複数の log entry が存在し得る (boot 1 件 + 中間 recover N 件)

### 4.3 計測フィールド (recovery_quality_log)

| フィールド | 計測方法 | 備考 |
|-----------|---------|------|
| `recovered_tokens` | recover_context の出力テキスト総トークン数 | boot 時に計測 |
| `task_continued` | boot 後 10 分以内に bot が次の action (tool call) を実行したか | post-action 観測、初回は false |
| `search_memory_count_10min` | boot 後 10 分以内の search_memory 呼出回数 | 低いほど復元品質が高い (search で補完する必要が無かった証拠) |
| `quality_score` | 0.0-1.0 の総合スコア | **AM-018 (Stage 2) で算出ロジック実装**、現在は default 0.0 or NULL |
| `notes` | recovery summary を JSON 文字列 | 例: `{"decisions": 3, "tasks": 2, "knowledge": 5, "messages": 0}` |

### 4.4 quality_score 算出仕様 (将来 AM-018 で実装)

**仮の算出式 (proposal、AM-018 で確定)**:

```
quality_score =
    (recovered_tokens / target_tokens) × 0.4
  + (restored_items / expected_items) × 0.4
  + (task_continued ? 0.2 : 0)
  + (search_memory_count_10min < 3 ? 0.0 : -0.1)
```

- 各項目の重み: tokens 40% / items 40% / continuation 20%
- search_memory が多発したら penalty (復元が不十分だった証拠)
- 0.0-1.0 にクランプ

### 4.5 OSS 評価 Framework との連携

`docs/OSS_EVALUATION_FRAMEWORK.md` の Category C (復旧品質) は本テーブルのデータを集計する:
- C1 quality_score 平均
- C2 task_continued=true の比率
- C3 recovery success rate

→ AM-002 が完了すれば C1-C3 が計測可能になり、現状 0/15 → 目標 9/15 (3 点 × 3 項目) を目指す。

---

## 5. multi-agent サポート (namespace)

Identity boundary の正本は
[`docs/operations/IDENTITY_BOUNDARY.md`](../../operations/IDENTITY_BOUNDARY.md)
とする。本節は現行実装の namespace 概要を記載する。

### 5.1 agent_id namespace 原則

全テーブルに `agent_id TEXT NOT NULL` カラムが存在し、**全クエリで `WHERE agent_id = ?` を必須とする**。

```typescript
// 正しい:
SELECT * FROM decisions WHERE agent_id = 'cto' AND status = 'active';

// 禁止 (他 agent のデータが混入):
SELECT * FROM decisions WHERE status = 'active';
```

### 5.2 default agent_id

- 未指定時: `'default'`
- multi-bot 運用時: bot ごとに `AGENT_MEMORY_AGENT_ID` を設定 (例: `cto`, `arc`, `agent-mem-dev`)

### 5.3 agent isolation の検証

各 bot 起動時に test として:
```typescript
await store.logDecision({ agent_id: 'test-isolation', decision: 'test' });
const others = await store.getDecisions({ agent_id: 'wrong-agent' });
assert(others.length === 0);  // 他 agent には漏れない
```

→ test-sqlite.ts / test-pg.ts でこれを検証済み。

### 5.4 cross-agent search の不在

agent-memory は**意図的に** cross-agent search を提供しない:
- bot A が bot B の knowledge を読みたければ、明示的に `agent_id: 'bot-b'` を指定する必要がある
- これは内部運用での便利機能ではなく、**多数の独立した user の data を一つの DB で管理する** 将来 Cloud 版の前提

---

## 6. agent-comms との独立性 + 統合時のメリット

### 6.1 独立性の原則

```
mem (agent-memory): com に依存しない
com (agent-comms): mem に依存しない
連携: 両方入っている場合は相互連携で品質向上 (1+1 > 2)
```

- **mem 単体ユーザー**: recover_context のみ使用、com なしで動作 (SQLite default で完結)
- **com 単体ユーザー**: watchdog + メッセージ管理、mem なしで動作
- **両方使うユーザー**: 統合復元 + 定期リフレッシュの最高品質体験

### 6.2 統合時の機能 (PG モードで agent-comms と DB 同居)

- **discord_history 統合復元**: recover_context 出力に直近 Discord メッセージを含める
- **post-tool-hook 自動蓄積**: agent-comms 経由の Discord 投稿から `[TASK:start]` `[DECISION]` `[KNOWLEDGE]` を抽出して agent-memory に自動 INSERT
- **knowledge.source_type='messages'**: 自動抽出された knowledge に元 Discord message_id を保存
- **catch-up**: 切断中に missed messages を Discord REST で取得、agent-memory にも反映 (agent-comms v0.2.0 receiver で完成予定)

### 6.3 独立性の検証

- mem 単体: SQLite モードで全 test 通過、Discord なしで動作
- com 単体: agent-comms-mcp の test suite で確認 (本 SSOT 範囲外)

### 6.4 mutual check (将来 AM-017)

PG モード起動時に agent-comms スキーマの存在を検出し、連携機能を有効/無効化する。実装は MVP 公開後で OK。

---

## 7. post-tool-hook 自動蓄積

### 7.1 動作

`src/post-tool-hook.ts` は Claude Code の PostToolUse hook として登録され、各 tool call 後に呼ばれる:

1. tool call の input/output から Discord 送信内容を抽出
2. 内容の冒頭から `[TASK:start]` `[TASK:done]` `[TASK:block]` `[DECISION]` `[KNOWLEDGE]` タグを検出
3. 該当する agent-memory のテーブルに自動 INSERT

### 7.2 タグ仕様

参照: `~/.claude/rules/memory-tags.md` (各 bot プロジェクトに ensure-tags.ts で自動配置)

| タグ | 蓄積先 |
|------|--------|
| `[TASK:start]` | task_states (status='in_progress') |
| `[TASK:done]` | task_states (status='completed') |
| `[TASK:block]` | task_states (status='blocked') |
| `[DECISION]` | decisions |
| `[KNOWLEDGE]` | knowledge (source_type='messages') |

### 7.3 既知の制約

- **agent-comms tool 経由のみ**: post-tool-hook は MCP tool の input/output を parse する。Discord REST 直叩き (Bash + curl) で送信した場合は **検出されない**
- 該当: 本日の事故対応で agent-comms send バグ回避のため REST 直叩きを使う bot
- → 改善: AM-016 (Arc 起票予定) で Bash tool 経由の curl から tag を検出する拡張

### 7.4 multi-agent 展開

各 bot プロジェクトの `.claude/settings.json` に hook を登録する必要あり。**現状 cto のみ稼働**、AM-006 で 8-10 bot に展開予定。

---

## 8. パフォーマンス特性

### 8.1 PostgreSQL モード

- decisions: pgvector HNSW index で類似検索 P95 < 50ms
- 全文検索: tsvector + GIN index で P95 < 100ms
- bot 起動時の recover_context: P95 < 500ms (Discord 履歴なしの場合)

### 8.2 SQLite モード

- 全クエリ in-memory + WAL なし (sql.js は WASM in-memory DB)
- write のたびに full save → 大量書き込み時はボトルネック
- LIKE 検索は線形 → 数万件で遅くなる
- **想定規模**: 1 ユーザー / 数千エントリ / 100 op/min → 問題なし
- **将来最適化**: debounced save、batch write、FTS5 build (custom sql.js)

---

## 9. 観測可能性 (Observability)

### 9.1 現状 (v0.3.0)

- ファイルログ (calls.log) のみ
- DB クエリ profiling なし
- メトリクス collection なし

### 9.2 将来 (Cloud 版)

- OpenTelemetry instrumentation
- Prometheus メトリクス export
- degradation alert (recovery_quality_log のスコア低下を検知)

→ MVP scope 外。

---

## 10. セキュリティ

### 10.1 OSS 配布での脅威モデル

agent-memory は **ローカル CLI** として動作。脅威モデル:

| 脅威 | 対策 |
|------|------|
| 悪意ある MCP client が偽の tool call | MCP transport の trust boundary に依存 (OS プロセス境界) |
| DB 接続文字列の漏洩 | 環境変数経由、ログに出さない |
| Voyage API キーの漏洩 | 環境変数経由、ログに出さない |
| SQL injection | 全クエリで parameterized query 必須 (raw concatenation 禁止) |
| Path traversal (DB パス指定) | デフォルト `~/.agent-memory/memory.db`、`AGENT_MEMORY_DB_PATH` は trust された設定 |
| 他 agent の data 漏洩 | agent_id WHERE 必須、test で検証 |

### 10.2 NOT in scope

- network attack (agent-memory は外部ネットワーク listener を持たない)
- multi-user RBAC (v0.1.0-alpha は単一ユーザー前提)
- audit log of access (将来 Cloud 版で対応)

---

## 改訂履歴

| 日付 | 内容 | 著者 |
|------|------|------|
| 2026-04-03 | framework retrofit 初版 (placeholder) | framework |
| 2026-04-08 | AM-010 充足: 認証/エラー/ログ/recovery quality 計測仕様/multi-agent/agent-comms 連携/post-tool-hook/パフォーマンス/セキュリティ全項目記述 | Arc |
