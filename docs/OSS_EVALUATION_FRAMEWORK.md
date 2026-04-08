# agent-memory OSS Evaluation Framework v1.0

> 作成日: 2026-04-08
> 起草: Arc (IYASAKA)
> 目的: agent-memory を OSS として公開可能な水準か定量評価する
> 対象バージョン: v0.3.0 (現行実装) → v0.1.0-alpha (MVP 公開目標)
> 評価対象 bot: CTO, agent-com-dev (本番稼働 数日間のデータ)

---

## 0. このフレームワークの目的

`agent-memory` を OSS として世界に公開する前に、**「実運用で使える」状態になっているか** を定量評価する。スコア化することで:

1. 現状の成熟度を客観的に把握
2. MVP到達点を明示（クリアしたら公開）
3. 不足項目を優先順位付きで可視化
4. 公開後の品質改善指標としても継続利用

**前提**: agent-memory は既に本番環境で IYASAKA 内部 bot 群（CTO、agent-com-dev 他）に適用され、数日間の稼働実績がある。評価はその実運用データを元に行う。

---

## 1. 評価対象の範囲

### 1.1 In Scope
- agent-memory コア5機能（Session Boot / Decision Log / Task State / Cross-Session Memory / Compaction Recovery）
- DB スキーマと実運用データの健全性
- OSS 配布に必要な付帯要件（README / LICENSE / 依存性 / プラットフォーム互換）
- 実際の crash recovery / context restore 品質

### 1.2 Out of Scope（v0.2.0+ で扱う）
- パフォーマンスベンチマーク（数千 bot 同時運用等）
- Cloud 版（有料プラン）機能
- agent-comms との統合（v0.2.0）
- Cursor / Codex / Gemini CLI 互換性（MVP は Claude Code のみ）

---

## 2. 評価次元（19項目、5カテゴリ、Level B 中粒度）

### Category A: コア機能動作（5項目、各 0-5 点、合計 25 点）

| # | 項目 | 評価内容 | 計測方法 |
|---|------|---------|---------|
| A1 | Session Boot | 前回セッションからの context 復元が成功するか | `recovery_quality_log.task_continued` 成功率 / `boot.ts` 動作確認 |
| A2 | Decision Log | 意思決定の store / retrieve / supersede が動作するか | `decisions` テーブル読み書きテスト + supersede chain 検証 |
| A3 | Task State | タスクライフサイクル (pending→in_progress→completed) が追跡できるか | `task_states.status` 分布 + 遷移追跡 |
| A4 | Cross-Session Memory | セッション間での知識共有 | `knowledge` テーブル read/write + tag filter 動作 |
| A5 | Compaction Recovery | compaction後の復旧機能 | `boot.ts` mode='recover' 動作 + recovered_tokens 計測 |

### Category B: 実運用データ健全性（4項目、合計 20 点）

| # | 項目 | 評価内容 | Threshold（3点基準） |
|---|------|---------|---------------------|
| B1 | Data volume | 十分な実データが蓄積されているか | task_states ≥ 50件、decisions ≥ 20件、knowledge ≥ 10件 |
| B2 | Data diversity | 全テーブルにデータが存在するか | task_states + decisions + knowledge の3テーブル全てで count > 0 |
| B3 | Multi-agent distribution | 複数 bot の運用データがあるか | agent_id が 2 種類以上、偏り率 < 90% |
| B4 | Status/tag coverage | 適切にステータス遷移・タグ付けされているか | completed / blocked / in_progress の3ステータスが存在、tags カバー率 > 50% |

### Category C: 復旧品質（3項目、合計 15 点）

| # | 項目 | 評価内容 | Threshold |
|---|------|---------|-----------|
| C1 | Recovery quality score | `recovery_quality_log.quality_score` の平均 | ≥ 0.7 |
| C2 | Context recovery success rate | 成功した recovery の割合 | ≥ 80% |
| C3 | Task continuation rate | `task_continued=true` の割合 | ≥ 70% |

### Category D: OSS 配布準備（4項目、合計 20 点）

| # | 項目 | 評価内容 | Threshold |
|---|------|---------|-----------|
| D1 | Installation simplicity | `npm install` → MCP 設定 → 動作、の3ステップで完結するか | 3ステップ以内、5分以内 |
| D2 | Documentation | README / LICENSE / CONTRIBUTING が揃っているか | 3ファイル全存在、README にデモGIFと Quick Start |
| D3 | Dependency purity | ネイティブビルド不要（node-gyp なし） | `package.json` に native dep なし、全 OS で `npm install` が通る |
| D4 | Platform compatibility | macOS / Linux / Windows で動作 | 3OS すべて |

### Category E: 実運用信頼性（3項目、合計 15 点）

| # | 項目 | 評価内容 | Threshold |
|---|------|---------|-----------|
| E1 | Crash recovery | 実際に crash → 再起動 → 正常復旧した実績 | 実績 ≥ 1 回、データロスなし |
| E2 | Data integrity | NULL率 / 孤児レコード率 | 孤児 < 1%、NULL率 < 15%（embedding を除く） |
| E3 | Query performance | 主要 SELECT クエリの応答時間 | P95 < 500ms（ローカル DB） |

---

## 3. スコアリング方法

### 3.1 項目別スコア（0-5点）

| スコア | 意味 |
|--------|------|
| 0 | 未実装 / 完全に壊れている |
| 1 | 基本動作のみ、エラー多発 |
| 2 | 限定的に動作、制約多い |
| 3 | 平常運用可能 ← **MVP per-item threshold** |
| 4 | 運用実績あり、安定動作 |
| 5 | 完全成熟、エッジケースも対応 |

### 3.2 総合スコア

- 最大: 19項目 × 5点 = **95点**
- MVP到達条件: **両方を満たす**
  1. **全項目 ≥ 3点**（致命的欠陥なし）
  2. **総合スコア ≥ 70%**（66/95）

### 3.3 MVP未到達時の処遇

総合スコア < 70% または一部項目 < 3 の場合:
- 項目ごとに gap を明示
- 優先度順に改善タスクを issue 化
- 次回評価でクリアしたら MVP 公開

---

## 4. データ取得項目リスト（OSS 化前提）

実運用データから以下を抽出し、各評価項目にマッピングする。

### 4.1 DB からの取得（PostgreSQL 現行 / SQLite MVP 両対応）

| 取得項目 | SQL | 対応評価項目 |
|---------|-----|------------|
| task_states 総数 / agent | `SELECT agent_id, COUNT(*) FROM task_states GROUP BY agent_id` | A3, B1, B3 |
| task_states ステータス分布 | `SELECT status, COUNT(*) FROM task_states` | A3, B4 |
| decisions 総数 / supersede chain | `SELECT COUNT(*), COUNT(superseded_by) FROM decisions` | A2, B1 |
| knowledge 総数 / tag coverage | `SELECT COUNT(*), AVG(array_length(tags, 1)) FROM knowledge` | A4, B1, B4 |
| recovery_quality_log 集計 | `SELECT AVG(quality_score), COUNT(*) FROM recovery_quality_log` | A1, C1, C2, C3 |
| embedding NULL 率 | `SELECT COUNT(*) FILTER(WHERE embedding IS NULL)::float / COUNT(*) FROM task_states` | E2 |
| 孤児レコード | `SELECT COUNT(*) FROM decisions WHERE superseded_by IS NOT NULL AND superseded_by NOT IN (SELECT id FROM decisions)` | E2 |
| データ存在期間 | `SELECT MAX(created_at) - MIN(created_at) FROM task_states` | B1 |

### 4.2 コードベース検査

| 項目 | 検査方法 | 対応 |
|------|---------|------|
| package.json 依存 | native build 必要なパッケージの有無 | D3 |
| README.md 有無と品質 | `ls README.md && wc -l README.md` | D2 |
| LICENSE 有無 | `ls LICENSE` | D2 |
| CONTRIBUTING.md 有無 | `ls CONTRIBUTING.md` | D2 |
| tests 網羅率 | `find tests -name '*.test.ts' \| wc -l` | A1-A5 |
| SQLite store 実装 | `ls src/stores/sqlite-store.ts` | D1, D3 |

### 4.3 動作検証（機能テスト）

| 項目 | 方法 | 対応 |
|------|------|------|
| クリーン環境で npm install | Docker `node:18-alpine` + `npm install` | D1, D3, D4 |
| Claude Code 設定後の起動 | 新規 project で MCP 設定して起動 | D1 |
| session_start(boot) 動作 | 空 DB → data 投入 → boot で復元確認 | A1 |
| Decision supersede chain | addDecision → supersede → 両方取得 | A2 |
| Task lifecycle | create → update(in_progress) → update(completed) → completed_at 確認 | A3 |
| Cross-session memory | session1 で add → session2 で get | A4 |
| Compaction recovery | recover mode で過去 decisions/tasks 取得 | A5 |

### 4.4 Query performance 計測

```bash
# P95 response time 計測
psql agent_comms -c "EXPLAIN ANALYZE SELECT * FROM task_states WHERE agent_id = 'cto' ORDER BY created_at DESC LIMIT 10"
# 5回実行して平均
```

---

## 5. 検証フォーマット（テンプレート）

### 5.1 評価レポートテンプレート

```markdown
# agent-memory OSS Evaluation Report

- 評価日: YYYY-MM-DD
- 評価者: <bot_id>
- 対象 version: v<x.y.z>
- 評価対象 agent: <agent_id>
- 総合スコア: <XX>/95 (<XX.X>%)
- MVP到達: ✅ / ❌

## Category A: コア機能動作
| # | 項目 | スコア | 根拠 | 改善必要? |
|---|------|-------|------|-----------|
| A1 | Session Boot | 4/5 | quality_score 0.82, 5/5 成功 | - |
...

## Category B: データ健全性
...

## 総括

- 致命的 gap: <項目番号>
- 推奨アクション:
  1. ...
  2. ...

## スコア推移（過去評価との比較）
| 項目 | 前回 | 今回 | Δ |
|------|------|------|---|
```

### 5.2 スコアカードフォーマット（sparse でも記録可能）

各項目を以下の形式で記録:

```yaml
- id: A1
  name: Session Boot
  score: 4
  evidence: |
    recovery_quality_log で agent=cto の quality_score 平均 0.82、
    task_continued=true が 4/5 = 80%。1 件のみ notes なしで不明。
  raw_data:
    total_recoveries: 5
    avg_quality_score: 0.82
    task_continued_rate: 0.8
  gap_to_5: |
    quality_score ≥ 0.9 を目指すには context_restored 時の
    agent-memory 読み込みを増やす必要。現状は 1610 tokens で不十分。
  improvement_priority: medium
```

---

## 6. 初期分析 — CTO + agent-com-dev（2026-04-08 時点）

### 6.1 生データ

```sql
-- task_states
cto:           122 件 (in_progress=53, completed=65, blocked=4)
agent-com-dev:   1 件 (in_progress=1)

-- decisions
cto:            56 件 (all active)
agent-com-dev:   1 件 (active)

-- knowledge
cto:            11 件 (all active, source_type=messages)
agent-com-dev:   0 件

-- recovery_quality_log
cto:             1 件 (recovered_tokens=1610, quality_score=NULL, task_continued=NULL)
agent-com-dev:   0 件

-- データ期間
cto:    2026-04-01 〜 2026-04-07 (7日間)
        活動ピーク: 2026-04-06 (58件)

-- embedding 生成率
task_states (cto): 106/122 = 86.9%
```

### 6.2 Category A: コア機能動作

| # | 項目 | スコア | 根拠 |
|---|------|-------|------|
| A1 | Session Boot | **2/5** | recovery_quality_log が 1 件のみ、quality_score は NULL で計測できず。実装自体は動いているが計測基盤が不完全 |
| A2 | Decision Log | **3/5** | decisions 56 件記録、supersede 未使用（superseded_by=NULL のみ）。CRUD は動作、supersede chain 未検証 |
| A3 | Task State | **4/5** | task_states 122 件、in_progress/completed/blocked の 3 ステータス遷移を確認。データ豊富 |
| A4 | Cross-Session Memory | **3/5** | knowledge 11 件、source_type='messages' のみ（他の source_type 未使用）、tag coverage 未確認 |
| A5 | Compaction Recovery | **1/5** | recovery_quality_log 1 件、quality_score NULL、task_continued NULL → 計測されていない。boot.ts の recover mode が未検証 |
| **A計** | | **13/25 (52%)** | |

### 6.3 Category B: データ健全性

| # | 項目 | スコア | 根拠 |
|---|------|-------|------|
| B1 | Data volume | **3/5** | task_states 122 ✅ / decisions 56 ✅ / knowledge 11 ✅ 全て threshold 超 |
| B2 | Data diversity | **3/5** | 3テーブル全てで count > 0、ただし recovery_quality_log が実質 empty |
| B3 | Multi-agent distribution | **1/5** | cto がほぼ独占（task_states 99%、decisions 98%、knowledge 100%）。agent-com-dev は 1 件のみ、偏り率 > 90% |
| B4 | Status/tag coverage | **3/5** | task_states は 3 ステータス OK、decisions は supersede 未使用、knowledge の tags 未確認 |
| **B計** | | **10/20 (50%)** | |

### 6.4 Category C: 復旧品質

| # | 項目 | スコア | 根拠 |
|---|------|-------|------|
| C1 | Recovery quality score 平均 | **0/5** | NULL のため計測不能、実質未実装 |
| C2 | Context recovery success rate | **0/5** | サンプル 1 件、task_continued NULL のため判定不能 |
| C3 | Task continuation rate | **0/5** | 同上 |
| **C計** | | **0/15 (0%)** | 🚨 致命的 |

### 6.5 Category D: OSS 配布準備

| # | 項目 | スコア | 根拠 |
|---|------|-------|------|
| D1 | Installation simplicity | **1/5** | 現状 `pg` 依存のみ、SQLite store 未実装。PostgreSQL 必須なので「3ステップ5分」不成立 |
| D2 | Documentation | **2/5** | README.md あり ✅、LICENSE なし ❌、CONTRIBUTING.md なし ❌、デモGIF なし |
| D3 | Dependency purity | **4/5** | `pg` は pure JS、native build 不要 ✅。sql.js 未導入だが現状でもビルド問題なし |
| D4 | Platform compatibility | **3/5** | PostgreSQL があれば全 OS で動く。ただし PostgreSQL セットアップが OS 依存 |
| **D計** | | **10/20 (50%)** | |

### 6.6 Category E: 実運用信頼性

| # | 項目 | スコア | 根拠 |
|---|------|-------|------|
| E1 | Crash recovery | **2/5** | 本日 (2026-04-08) の事故で再起動発生、データロスなしで復旧したが recovery_quality_log に記録なし |
| E2 | Data integrity | **4/5** | embedding NULL 13% は許容範囲、他の NULL/孤児なし |
| E3 | Query performance | **4/5** | pgvector HNSW index あり、P95 推定 < 100ms（本番稼働で体感遅延なし） |
| **E計** | | **10/15 (67%)** | |

### 6.7 総合スコア

| Category | Score | Max | % |
|----------|-------|-----|---|
| A. コア機能動作 | 13 | 25 | 52% |
| B. データ健全性 | 10 | 20 | 50% |
| C. 復旧品質 | 0 | 15 | 0% 🚨 |
| D. OSS 配布準備 | 10 | 20 | 50% |
| E. 実運用信頼性 | 10 | 15 | 67% |
| **総合** | **43** | **95** | **45.3%** |

### 6.8 MVP到達判定

❌ **MVP未到達**

- 総合スコア 45.3% < 70% threshold
- C カテゴリ全項目が 0 点（致命的）
- B3, C1-C3, D1, D2 が < 3 点（per-item threshold 違反）

---

## 7. Gap 分析 — MVP到達に必要な改善

### 7.1 Critical Gap（公開前に必須）

| Gap | 影響 | 対応 | 優先度 |
|-----|------|------|--------|
| **C1-C3 復旧品質計測未実装** | recovery_quality_log が NULL で埋まり、A1/A5 も正しく評価できない | `boot.ts` / `recover_context` で quality_score と task_continued を必ず記録する実装追加 | **P0** |
| **D1 SQLite store 未実装** | `npm install して5分で動く` が成立しない、現状 PostgreSQL 必須 | mvp-spec §2.3 通り `sql.js` ベースの sqlite-store.ts 実装 | **P0** |
| **D2 LICENSE 未配置** | OSS 公開に法的に不可 | LICENSE ファイル (MIT) 追加 | **P0** |
| **D2 CONTRIBUTING.md 未作成** | 貢献受付不可 | mvp-spec §9 のテンプレートで作成 | **P0** |
| **B3 Multi-agent 偏り** | cto のみで 99% のデータ、他 bot の運用実績が無い | agent-com-dev 含む他 bot で hook を実行する運用改善 | **P1** |

### 7.2 Important Gap（公開前に望ましい）

| Gap | 影響 | 対応 | 優先度 |
|-----|------|------|--------|
| A2 decisions.supersede chain 未検証 | 設計変更時の履歴追跡が機能するか不明 | 意識的に supersede を使うユースケース作成 + テスト | P1 |
| A4 knowledge.tags 未確認 | タグフィルタが機能するか不明 | tag filter テスト追加 | P1 |
| D2 README デモGIF 未整備 | 初見ユーザーへの訴求力 | asciinema 録画 → GIF 化 | P1 |
| E1 crash recovery log 未記録 | 実運用の信頼性エビデンス不足 | crash 時に自動で recovery_quality_log に記録する hook 追加 | P1 |

### 7.3 Nice-to-have（公開後でよい）

| Gap | 対応 | 優先度 |
|-----|------|-------|
| B4 tag coverage 向上 | post-tool-hook のタグ抽出精度改善 | P2 |
| A5 compaction recovery 詳細計測 | `recovered_tokens` だけでなく `recovered_decisions/tasks/memories` を個別計測 | P2 |
| D3 CI/CD で全 OS 検証 | GitHub Actions で macos/ubuntu/windows テスト | P2 |

---

## 8. MVP到達までのロードマップ（推定）

### Phase 1: Critical Gap 解消（最優先）

```
Week 1:
  - sql.js ベース SQLite store 実装（mvp-spec §2.3）
  - recovery_quality_log 計測の完全実装
  - LICENSE (MIT) + CONTRIBUTING.md 配置

Week 2:
  - 全 bot の post-tool-hook 適用（multi-agent 偏り解消）
  - 全テスト通過（mvp-spec §8）
  - README デモGIF 作成
```

### Phase 2: 再評価 → 公開判定

```
Week 2 末:
  - 本フレームワークで再評価
  - MVP 到達 → v0.1.0-alpha タグ付与 → npm 公開
  - 未到達 → gap を再 issue 化 → Phase 3
```

### Phase 3: 公開後の継続評価

```
公開後:
  - 週次で本フレームワーク実行
  - スコア推移グラフ化
  - degradation alert（スコア低下時）
```

---

## 9. OSS 化特有の検査項目

OSS 公開に特有の観点。Category D を補強する形で確認する:

### 9.1 法的・ライセンス

- [ ] LICENSE (MIT) 配置
- [ ] 全 dependencies のライセンス互換性（MIT/Apache2/BSD 系のみ）
- [ ] Copyright ヘッダー不要（MIT の慣習）
- [ ] ハードコード secrets なし（token/API key/DB password）

### 9.2 配布準備

- [ ] `package.json` の `files` フィールドで公開ファイル限定
- [ ] `.gitignore` で不要ファイル除外
- [ ] `.npmignore` または `files` フィールド
- [ ] npm 用の scoped name 検討（`@iyasaka/agent-memory` 等）

### 9.3 ユーザー体験

- [ ] `npm install -g agent-memory` でグローバルインストール可能
- [ ] `agent-memory --version` でバージョン表示
- [ ] `agent-memory --help` で使用方法表示
- [ ] 初回起動時に `~/.agent-memory/memory.db` を自動作成

### 9.4 互換性

- [ ] Node.js 18, 20, 22 で動作確認
- [ ] macOS (ARM/x86) で動作
- [ ] Ubuntu で動作
- [ ] Windows で動作
- [ ] Node_modules サイズ < 50MB

### 9.5 ドキュメント

- [ ] README.md: Problem → Solution → Quick Start → Features → License の構成
- [ ] Quick Start は 3 ステップ以内
- [ ] デモGIF or 動画
- [ ] 有料プランの明記（OSS サステナビリティ）
- [ ] CONTRIBUTING.md: 開発環境セットアップ + PR プロセス
- [ ] CHANGELOG.md: semver 準拠

### 9.6 コミュニティ準備

- [ ] GitHub Issues テンプレート（bug report / feature request）
- [ ] GitHub PR テンプレート
- [ ] CODE_OF_CONDUCT.md（コミュニティ規範）
- [ ] Discussions 有効化

---

## 10. 継続評価の運用

### 10.1 評価タイミング

- **マイルストーン評価**: 新機能リリース前、major version bump 時
- **定期評価**: 週次 cron で自動実行、レポート生成
- **事故後評価**: 本番障害発生後、改善効果を測定

### 10.2 自動化の設計

```bash
# 評価スクリプトの実行例（将来実装）
agent-memory evaluate \
  --target cto,agent-com-dev \
  --output reports/eval-$(date +%Y%m%d).md \
  --compare-with reports/eval-previous.md
```

出力:
- 現在スコア
- 前回との差分（改善/悪化項目）
- MVP到達判定
- 改善提案

### 10.3 評価結果の保管

- `docs/evaluations/` ディレクトリに md 形式で蓄積
- Git 管理することで履歴が残る
- スコア推移を README にグラフで表示可能

---

## 11. 次のアクション

### Arc (起草者)
1. ✅ 本フレームワーク v1.0 を作成
2. 本ドキュメントを Google Drive (`IYASAKA/開発/agent-mem/`) にもアップロード
3. CEO レビューを受ける
4. agent-memory Dev / CTO のフィードバックを受けて v1.1 へ

### CEO
1. 本フレームワークの妥当性レビュー
2. MVP threshold (70% + 全項目 ≥ 3) の承認 or 調整
3. Phase 1 作業の承認と担当 bot 割り当て

### agent-memory Dev（担当不明、agent-com Dev と同一？）
1. Critical Gap (C1-C3, D1, D2) の実装
2. multi-agent 偏り解消のための post-tool-hook 展開

### CTO
1. Phase 1 の実装レビュー
2. ADR-042 (仮): OSS 公開判定フレームワーク採用 を起草（v1.0 確定後）

---

## 改訂履歴

| バージョン | 日付 | 内容 |
|-----------|------|------|
| v1.0 | 2026-04-08 | 初版（Arc 起草）。CTO + agent-com-dev 実データを用いた初回評価を含む。総合スコア 45.3%、MVP未到達と判定。Critical Gap 5件を抽出 |
