# agent-memory 実装計画書 v1.0

> 作成日: 2026-04-08
> 起草: Arc (IYASAKA)
> 前提資料:
>   - `docs/OSS_EVALUATION_FRAMEWORK.md` (Arc, 2026-04-08)
>   - `docs/agent-memory-mvp-spec.md` (CTO, 2026-04-07)
>   - `.framework/plan.json`, `.framework/gates.json`, `.framework/retrofit-report.json`
> 目的: OSS 評価結果 (45.3%, MVP未到達) を踏まえ、公開可能な状態に到達するための具体アクションを整理
> 対象期間: 2週間 (mvp-spec の目標日 2026-04-21 を踏まえる)

---

## 0. Executive Summary

### 現状
- agent-memory は **v0.3.0 として本番稼働中** (CTO bot で 7 日間運用、122 task_states / 56 decisions / 11 knowledge の実績)
- OSS 評価 (19項目 / Level B) で **45.3% (43/95)**、MVP未到達
- mvp-spec (2026-04-07 起草) と実装 (v0.3.0) の間に **設計上の乖離** あり
- ADF フレームワーク retrofit は **途中状態** (プロジェクト設定あり、SSOT/hooks/gates 不完全)

### Critical 問題
1. **復旧品質計測が機能していない** (recovery_quality_log NULL)
2. **SQLite store 未実装** (現状 pg 依存、`npm install で5分` 不成立)
3. **LICENSE/CONTRIBUTING 未配置**
4. **ADF framework 半端** (7 hook 中 2 のみ、SSOT 全て placeholder)
5. **mvp-spec と実装の設計乖離** (下記 §2 参照、**公開前に方針決定が必要**)
6. **Codex startup recovery が自動適用されない** (MCP tools は使えるが、Codex は Claude Code の SessionStart stdout injection 相当を持たないため、restart_pack を初回応答で読まない)

### 2026-05-21 優先順位更新

AM-031 / PR #88 と PR #89 により `restart_pack` の relevance / safety は
internal default-ready 水準に近づいた。一方で CTO Codex セッションの実リセットで、
restart_pack は存在していたが初回応答に自動注入されず、ユーザーが明示的に
読み込み指示を出すまで復旧しなかった。

このため公開前の優先順位を次のように更新する:

| Priority | Work | Gate |
|----------|------|------|
| P0 | AM-032 Codex startup restart_pack bridge | Public-alpha / world release blocker |
| P0 | Claude Code SessionStart と Codex bridge の両方で recovery evaluation を再実行 | Public-alpha score evidence |
| P1 | Internal opt-in rollout for dev bots | Default-ready rollout |
| P1 | SQLite ranking parity / non-ticket anchor probes | Follow-up hardening |

AM-032 / AM-036 の方針:

- plain Codex MCP config は `restart_pack` tool を expose するだけで、自動復旧とは呼ばない。
- Codex startup recovery は `wasurezu-codex-start` bridge 経由で、restart_pack を初期プロンプトに埋め込んで開始する。
- 世界公開では「Claude Code は SessionStart hook」「Codex は startup bridge」と互換性の差を明記する。
- `wasurezu-codex-start --launch --cd <workspace>` が public-alpha の Codex run で使う標準起動経路。
- AUN ありでは、runtime restart / requeue / finalization / reply / close は
  AUN が所有する。wasurezu は restart pack、recovery confidence、
  missing-context notes、provenance、continuity signals を提供し、AUN queue
  state や claim lifecycle は変更しない。
- AUN なしでも、supported supervisor / host hook があり install/config 時に
  restart lifecycle が pre-authorized されている場合は、wasurezu standalone
  `auto_restart` として local session refresh を実行できる。
- pure MCP-only mode では restart 推奨と pack prepare までで、host restart は
  強制しない。
- LLM host ごとの差分は adapter として分離する。Claude Code は native
  lifecycle integration、Codex は startup prompt bridge、その他 MCP client は
  verified adapter ができるまで manual MCP recovery として扱う。
- host adapter matrix は `docs/operations/HOST_ADAPTERS.md` を SSOT とする。

### 2026-05-22 優先順位更新

ARC #101 の design correction により、開発順序を次のように更新する:

| Priority | Work | Purpose |
|----------|------|---------|
| P0 | AM-037 / PR #100: install-mode boundary docs/package fix | AUNあり、standalone supervisor、pure MCP-only の lifecycle claim を正しく分ける |
| P0 | AM-038: deterministic `restart_prepare` API/CLI | AUN/supervisor から呼べる pre-exit prepare、confidence、missing_context、provenance、pack ref を提供 |
| P0 | AM-039: selected restart pack fetch + boot consume | AUN が選んだ pack を post-start hook で確実に注入する |
| P1 | AM-040: continuity guard modes | `auto_restart` / `recommend` / `pack_only` / `off` と install-mode validation |
| P1 | AM-041: context metrics + semantic degradation | host metrics がある時だけ context percentage を使い、ない時は semantic signals として扱う |
| P1 | AM-042: AUN integration contract | AUN #502 と接続する event/schema/telemetry contract を固定 |
| P2 | AM-043: public-alpha evidence runs | Claude Code SessionStart + Codex bridge + AUN/standalone path の 27/30+ evidence |

### 推奨アクション
- **Path B (現行コードベースで進化) を採用**し、mvp-spec を現状に合わせて更新
- Phase 1 (1 週間) で OSS Critical Gap 解消
- Phase 2 (1 週間) で ADF フレームワーク完成
- Week 2 末に再評価 → 到達 → v0.1.0-alpha 公開

---

## 1. 前提となる問い

実装計画を立てる前に、**1 つ重大な決断** が必要です。

### 🚨 重大な設計乖離: mvp-spec vs 現行コード

2026-04-07 起草の `agent-memory-mvp-spec.md` と 2026-04-08 時点の `v0.3.0` 実装は、**API とデータモデルが大きく異なります**。

| 観点 | mvp-spec (設計) | v0.3.0 (現行実装) |
|------|----------------|-------------------|
| **セッション管理** | `sessions` テーブルあり、`memory_session_start` で自動作成 | セッション概念なし（session_id = agent-comms の session 流用） |
| **Decision API** | `memory_add_decision` / `memory_get_decisions` / `memory_supersede_decision` | `log_decision` / `get_decisions` / `supersede_decision` (prefix なし) |
| **Task API** | `memory_create_task` / `memory_update_task` / `memory_get_tasks` (3 関数) | `save_task_state` / `get_task_states` (upsert 型、2 関数) |
| **Memory/Knowledge** | `memories` テーブル (type: insight/pattern/warning/preference) | `knowledge` テーブル (source_type: messages/manual、source_ids UUID[]、title + content 分離) |
| **DB バックエンド** | sql.js (WASM SQLite) デフォルト + PostgreSQL オプション | PostgreSQL (pg) + JSON ファイルフォールバック |
| **recover_context** | `memory_session_start(mode='recover')` で統合 | 独立ツール `recover_context` |
| **Recovery quality** | 未定義 | `recovery_quality_log` テーブルあり（ただし計測実装不完全） |
| **実運用データ** | ゼロ (設計段階) | **122 task_states / 56 decisions / 11 knowledge** (CTO 7日間の実績) |

**解釈**:
- mvp-spec は **forward-looking な再設計プラン**（clean slate）
- v0.3.0 は **実運用で進化してきた現行システム**（production tested）
- 両者は同じ目標（AI への永続記憶）を別の設計で達成している
- **どちらを MVP 公開の base にするか** の決断が必要

### Path A: mvp-spec 通りに書き直し

```
メリット:
  - 仕様書が明確
  - 10 ツール体系がクリーン（memory_* prefix）
  - sql.js デフォルトで OSS 配布が楽

デメリット:
  - 現行の 122+56+11 件の本番データが無駄になる（マイグレーション必要）
  - 7 日間の運用実績・バグ修正を捨てる
  - 2週間で完全書き直しは非現実的
  - CTO / agent-com-dev 等の本番 bot が一時的に壊れる
  - 実運用で発見した細かな要件（recovery_quality_log, post-tool-hook 等）を再度発見する必要
```

### Path B: 現行コードベースで進化

```
メリット:
  - 本番データ保持（122+56+11 件）
  - 7 日間の運用実績・バグ修正を維持
  - 既に動いている hook (post-tool-hook, ensure-tags) を活用
  - CTO / agent-com-dev 等の本番 bot に影響なし
  - 2週間の MVP 公開目標に現実的に間に合う

デメリット:
  - mvp-spec を実装に合わせて更新する必要
  - 10 ツールの naming 整理が後回し
  - sql.js への移行は別途必要
```

### Path C: ハイブリッド（Arc 非推奨）

新しい API は mvp-spec 通り、内部データは現行を使う。
→ 2 層の API を維持する負担が OSS としては重すぎる。

### Arc 推奨: **Path B** を採用

理由:
1. **本番データ喪失は最大のリスク** — 現状 CTO が運用に使っているデータを失うことは業務影響が大きい
2. **mvp-spec は 1 日前に起草**されたばかりで、**現行実装と照合せずに書かれた疑い** がある
3. **OSS 評価 E2 (data integrity 4/5)** は現行実装の強み — これを捨てない
4. **2 週間の MVP 目標** を現実的に達成するには現行 base しかない
5. **sql.js 導入は Path A/B どちらでも必要** — この作業は path 選択に非依存

**→ 以降の実装計画は Path B を前提とします。CEO が Path A を選ぶ場合は計画全体を再作成します。**

---

## 2. 現状監査

### 2.1 コードベース現状 (v0.3.0)

```
src/
├── boot.ts (66行)              # SessionStart hook
├── constants.ts (150行)
├── discord-history.ts (68行)   # agent-comms 連携
├── ensure-tags.ts (40行)       # memory-tags.md 自動配置
├── index.ts (632行)            # MCP server エントリポイント、10ツール登録
├── migrate.ts (90行)           # DB マイグレーション runner
├── post-tool-hook.ts (163行)   # PostToolUse hook (タグ自動蓄積)
├── stores/
│   ├── index.ts (27行)         # Factory
│   ├── json-store.ts (369行)   # JSON fallback
│   ├── pg-store.ts (882行)     # PostgreSQL 実装
│   ├── types.ts (201行)        # 型定義
│   └── voyage.ts (110行)       # embedding 生成
├── test.ts (579行)             # テスト
└── test-pg.ts (414行)          # PG 特化テスト
```

### 2.2 MCP ツール (10個)

現状実装:
```
1. log_decision              (Decision)
2. get_decisions             (Decision)
3. supersede_decision        (Decision)
4. save_task_state           (Task)
5. search_memory             (統合検索)
6. recover_context           (Recovery)
7. save_knowledge            (Knowledge)
8. get_knowledge             (Knowledge)
9. update_knowledge_status   (Knowledge)
10. set_recovery_config      (Config)
```

mvp-spec との対応:
- Decision 系 3: ✅ 名前が prefix 違い、機能は同等
- Task: save_task_state が upsert 型、mvp-spec は 3 分割。**統合が必要**
- Knowledge/Memory: カラム設計が異なる（現行の方が豊富）
- Session: **未実装**（agent-comms session 流用）
- Recovery: recover_context 独立（mvp-spec は session_start に統合）

### 2.3 DB 状態

- **PostgreSQL のみ** (`pg` 依存)
- pgvector 利用中（HNSW index）
- sql.js/SQLite 未実装

### 2.4 ADF フレームワーク retrofit 状態

| 項目 | 状態 | Gap |
|------|------|-----|
| `.framework/project.json` | ✅ 存在 | OK |
| `.framework/plan.json` | ✅ 21 features in Wave 1 | plan 自体は古い、MVP 向けに更新必要 |
| `.framework/gates.json` | ⚠️ **Gate A failed** | .env.example, docker-compose.yml, .github/workflows/ が無い |
| `.framework/retrofit-report.json` | ✅ 存在 | gap list あり (SSOT-0〜5, STD-*, IDEA, OPS-*) |
| `.claude/hooks/` | ⚠️ **2/7 のみ** | channel-routing, framework-runner, gate-quality, gate-release, post-task が無い |
| `docs/requirements/SSOT-0_PRD.md` | ❌ placeholder | 全セクション `[要記入]` のまま |
| `docs/requirements/SSOT-1_FEATURE_CATALOG.md` | ❌ placeholder | 空 |
| `docs/design/core/SSOT-2_UI_STATE.md` | ❌ placeholder | agent-memory に UI は不要だが "N/A" で明示が必要 |
| `docs/design/core/SSOT-3_API_CONTRACT.md` | ⚠️ 部分的 | 冒頭に `> Generated by framework retrofit`、下部は記入あり |
| `docs/design/core/SSOT-4_DATA_MODEL.md` | ❌ placeholder | DB スキーマ記入必要 |
| `docs/design/core/SSOT-5_CROSS_CUTTING.md` | ❌ placeholder | 空 |
| `CLAUDE.md` | ❌ **存在しない** | ルート CLAUDE.md がない |
| `LICENSE` | ❌ **存在しない** | OSS 公開に必須 |
| `CONTRIBUTING.md` | ❌ **存在しない** | OSS 公開に必須 |
| `.env.example` | ❌ **存在しない** | Gate A 失敗原因 |
| `.github/workflows/` | ❌ **存在しない** | Gate A 失敗原因 |
| `docker-compose.yml` | ❌ **存在しない** | Gate A 失敗原因 |

---

## 3. 実装計画 — Phase 別

### Phase 1: OSS Critical Gap 解消 (Week 1, P0)

**目標**: OSS 評価の Critical Gap 5 件を全て解消し、B3/D1/D2/C1-C3 を 3 点以上に引き上げる

#### Task 1.1: SQLite store 実装 (sql.js ベース)
- **対応**: OSS eval D1 (1/5 → 4/5)
- **実装**: mvp-spec §2.3 に従う
  - `src/stores/sqlite-store.ts` 新規作成
  - sql.js (WASM) を dependency 追加
  - `Store` インターフェース (types.ts) に準拠
  - factory (`stores/index.ts`) に SQLite 分岐追加
  - FTS5 サポートチェック + LIKE fallback
  - DB パス: `~/.agent-memory/memory.db` デフォルト
- **環境変数**:
  - `AGENT_MEMORY_DB_TYPE=sqlite | postgres` (デフォルト sqlite)
  - `AGENT_MEMORY_DB_PATH` (SQLite 時のみ)
  - `AGENT_MEMORY_DATABASE_URL` (PostgreSQL 時のみ、現状互換)
- **テーブル設計**: 現行 pg-store の schema を SQLite 構文に移植
  - decisions, task_states, knowledge, recovery_config, recovery_quality_log
  - embedding カラムは NULL（sql.js では vector 検索不要、FTS5 or LIKE）
- **影響範囲**:
  - 新規: `sqlite-store.ts` (推定 600-800 行)
  - 変更: `stores/index.ts` (factory 分岐 +20 行)
  - 変更: `package.json` (sql.js 追加)
  - 新規: テスト `test-sqlite.ts`

**Estimate**: 2-3 days

#### Task 1.2: 復旧品質計測の完全実装
- **対応**: OSS eval C1/C2/C3 (0/5 → 3/5)
- **実装**:
  - `boot.ts` を拡張: recovery 完了時に必ず `recovery_quality_log` に INSERT
  - `quality_score` の算出ロジック:
    - recovered_tokens / target_tokens の比率
    - recovered items (decisions + tasks + memories) 数
    - task_continued: bot が次の action を実行できた場合 true
  - `search_memory_count_10min` の計測追加
  - `notes` に restore summary を記録
- **新規メソッド**:
  - `store.logRecoveryQuality(input)` を pg-store / sqlite-store に追加
- **影響範囲**:
  - 変更: `boot.ts` (~30 行追加)
  - 変更: `stores/pg-store.ts` (logRecoveryQuality 実装 +30 行)
  - 変更: `stores/sqlite-store.ts` (同上 +30 行)
  - 変更: `stores/types.ts` (型定義追加 +10 行)

**Estimate**: 1 day

#### Task 1.3: LICENSE + CONTRIBUTING.md 配置
- **対応**: OSS eval D2 (2/5 → 4/5)
- **LICENSE**: MIT (標準テンプレート)
- **CONTRIBUTING.md**:
  - 開発環境セットアップ手順
  - テスト実行方法
  - PR プロセス（レビュー必須、Conventional Commits）
  - Code of Conduct リンク
  - Issue テンプレート参照
- **影響範囲**:
  - 新規: `LICENSE`
  - 新規: `CONTRIBUTING.md`
  - 新規: `.github/ISSUE_TEMPLATE/` (bug/feature)
  - 新規: `.github/PULL_REQUEST_TEMPLATE.md`

**Estimate**: 0.5 days

#### Task 1.4: README.md 改善
- **対応**: OSS eval D2 (+1 point contribution)
- **改善点**:
  - デモ GIF 追加 (asciinema → GIF)
  - Quick Start を 3 ステップに凝縮
  - Problem / Solution / Features の structure
  - 有料プラン言及 (mvp-spec §9 の fair source narrative)
- **影響範囲**:
  - 変更: `README.md` (既存 4891 bytes を再構成)
  - 新規: `docs/demo.gif`

**Estimate**: 0.5 days

#### Task 1.5: multi-agent 偏り解消
- **対応**: OSS eval B3 (1/5 → 3/5)
- **原因**: 現状 CTO にしか post-tool-hook が適用されていない（または agent-com-dev の hook が発火していない）
- **対応**:
  - CTO / agent-com-dev / arc / auditor / 他 dev bot の `.claude/settings.json` に post-tool-hook を登録
  - hook 動作確認: 各 bot で 1 件ずつ log_decision を記録させてテスト
  - 記録されない bot の原因究明 (環境変数不足? DB 接続? tag parser?)
- **影響範囲**:
  - 変更: 各プロジェクトの `.claude/settings.json` (複数リポ)
  - 運用のみ (コード変更なし)

**Estimate**: 0.5 days

---

### Phase 2: ADF Framework 完成 (Week 1-2, 並行、P0)

**目標**: ADF retrofit を完遂し、Gate A/B 全て pass にする

#### Task 2.1: CLAUDE.md 作成
- **理由**: ルート CLAUDE.md がないと Claude Code が agent-memory リポ固有の指示を理解しない
- **内容**:
  - プロジェクト概要 (agent-memory)
  - Tech Stack (TypeScript / pg / sql.js)
  - コードスタイル (ESM, 1ファイル 400行以下)
  - 必読 SSOT (docs/design/core/)
  - テスト実行: `npm test`
  - ビルド: `npm run build`
- **参考**: `iyasaka/CLAUDE.md` の構造を踏襲

**Estimate**: 0.5 days

#### Task 2.2: ADF hooks 配布 (2 → 7)
- **現状**: `pre-code-gate.sh`, `skill-tracker.sh` のみ
- **追加**:
  - `channel-routing.sh`
  - `framework-runner.sh`
  - `gate-quality.sh`
  - `gate-release.sh`
  - `post-task.sh`
- **取得方法**: `iyasaka/.claude/hooks/` から copy、環境変数をプロジェクトに合わせて調整
- **settings.json 更新**:
  - `.claude/settings.json` に新規 hook 登録
  - 環境変数 `AGENT_MEMORY_PROJECT=agent-memory` 等を設定

**Estimate**: 0.5 days

#### Task 2.3: Gate A 要件充足
- **現状**: Gate A failed (3 項目)
- **対応**:
  - `.env.example` 作成 (DATABASE_URL, AGENT_MEMORY_DB_TYPE, AGENT_MEMORY_DB_PATH 等)
  - `docker-compose.yml` 作成 (PostgreSQL + pgvector サービス)
  - `.github/workflows/ci.yml` 作成 (test + build)
- **CI 最小構成**:
  - Node.js 18/20/22 で `npm install && npm test && npm run build`
  - Platform: ubuntu / macos (Windows は後回しで OK)

**Estimate**: 1 day

#### Task 2.4: SSOT ドキュメント充足
- **対象**: SSOT-0〜5 を placeholder から実装に合わせて記入
- **優先順位**:
  1. **SSOT-0 (PRD)** - プロダクト概要、問題、ユーザー、ソリューション（mvp-spec 冒頭を流用）
  2. **SSOT-1 (Feature Catalog)** - 現行 10 ツール + 将来機能
  3. **SSOT-3 (API Contract)** - 10 MCP ツールの入出力仕様（既に部分的に存在、完成させる）
  4. **SSOT-4 (Data Model)** - 現行 DB スキーマ全テーブル
  5. **SSOT-5 (Cross-Cutting)** - Recovery quality 計測方針、post-tool-hook 動作、multi-agent サポート
  6. SSOT-2 (UI/State) - **N/A** で明示 (agent-memory に UI はない)
- **方針**:
  - mvp-spec の内容を **現行実装に合わせて翻訳** (Path B 採用の論理的帰結)
  - mvp-spec 自体は `docs/strategy/` に移動し、forward-looking な目標として残す
- **影響範囲**:
  - 更新: `docs/requirements/SSOT-0_PRD.md`, `SSOT-1_FEATURE_CATALOG.md`
  - 更新: `docs/design/core/SSOT-2〜5_*.md`

**Estimate**: 2 days

#### Task 2.5: mvp-spec の位置付け整理
- **問題**: mvp-spec が現行実装と乖離、どちらが authoritative か不明確
- **対応**:
  - `docs/agent-memory-mvp-spec.md` → `docs/strategy/mvp-spec-v0.1.0-original.md` に rename（移動）
  - 冒頭に注記: 「これは 2026-04-07 時点の forward-looking 設計。v0.3.0 以降は SSOT を参照」
  - SSOT が single source of truth になるように宣言
- **影響範囲**:
  - 移動: `docs/agent-memory-mvp-spec.md` → `docs/strategy/mvp-spec-v0.1.0-original.md`
  - 更新: `docs/SSOT.md` (参照先を SSOT-*に統一)

**Estimate**: 0.5 days

---

### Phase 3: MVP 再評価と公開 (Week 2 末)

#### Task 3.1: OSS 評価フレームワーク再実行
- Phase 1/2 完了後、`OSS_EVALUATION_FRAMEWORK.md` のスコアを再計測
- 目標: 総合 ≥ 70% (66/95), 全項目 ≥ 3 点

#### Task 3.2: 到達判定 → 公開 or 追加作業
- **到達した場合**:
  - `v0.1.0-alpha` タグ付与
  - npm 公開 (`@iyasaka/agent-memory`?)
  - README に公開アナウンス
  - Discord にて内部告知
- **未到達の場合**:
  - 不足項目を特定
  - 追加 Task を起票
  - Phase 4 へ

#### Task 3.3: 公開後 monitoring 設定
- 週次で評価スクリプト実行
- スコア推移グラフ化
- degradation alert

---

## 4. 実装タスク一覧 (Issue 化 proposal)

以下を GitHub Issue として agent-memory リポに起票する前提で整理:

| # | Task | Phase | 優先度 | Estimate | 担当 (仮) |
|---|------|-------|--------|----------|-----------|
| AM-001 | SQLite store (sql.js) 実装 | 1 | P0 | 2-3 days | agent-mem Dev |
| AM-002 | 復旧品質計測の完全実装 | 1 | P0 | 1 day | agent-mem Dev |
| AM-003 | LICENSE (MIT) 配置 | 1 | P0 | 0.1 day | Arc (手動) |
| AM-004 | CONTRIBUTING.md 作成 | 1 | P0 | 0.4 day | Arc |
| AM-005 | README.md 改善 + デモGIF | 1 | P0 | 0.5 day | Arc |
| AM-006 | multi-agent hook 展開 | 1 | P0 | 0.5 day | agent-mem Dev (運用) |
| AM-007 | CLAUDE.md 作成 | 2 | P0 | 0.5 day | Arc |
| AM-008 | ADF hooks 配布 (2→7) | 2 | P0 | 0.5 day | Arc |
| AM-009 | Gate A 要件充足 (.env.example, docker-compose, CI) | 2 | P0 | 1 day | agent-mem Dev |
| AM-010 | SSOT-0/1/3/4/5 完成 | 2 | P0 | 2 days | Arc |
| AM-011 | mvp-spec の位置付け整理 (strategy/ へ移動) | 2 | P1 | 0.5 day | Arc |
| AM-012 | OSS 評価フレームワーク再実行 | 3 | P0 | 0.5 day | Arc |
| AM-013 | v0.1.0-alpha 公開判定 | 3 | P0 | 0.5 day | Arc + CEO |
| AM-014 | npm 公開 + 内部告知 | 3 | P0 | 0.5 day | agent-mem Dev + CEO |

**合計**: 10-13 days (2 人並行で 7-8 日、単独で 14 日)

---

## 5. 担当 bot の割り当て問題

### 現状
- **agent-memory の開発担当 bot が明確でない**
- agent-com Dev が兼任している可能性があるが、v0.2.0-rc2 (agent-comms) の PoC spike 担当もあり、キャパシティ的に厳しい

### 選択肢

**A. agent-com Dev が兼任継続**
- メリット: 新規 bot 不要、既に context あり
- デメリット: agent-comms PoC と衝突、スループット低下

**B. 専用 agent-mem Dev を新規作成**
- メリット: agent-comms / agent-memory を並行進行可能
- デメリット: Bot application 新規作成、tmux session、CLAUDE.md、トークン等のセットアップ必要

**C. Arc が実装を兼任**
- メリット: 設計と実装が同じ手で進む
- デメリット: Arc 本来の責務（設計レビュー + 完了判定）と衝突、単一障害点

**Arc 推奨: B (専用 agent-mem Dev 新規作成)**

理由:
- agent-comms の v0.2.0 作業は並行して続くため、キャパシティ分離が必要
- 本実装計画で agent-mem Dev への明示的な指示が出せるようになる
- 将来 OSS 公開後、コミュニティとの窓口としても機能する

セットアップ手順:
1. Discord Developer Portal で新規 Bot Application 作成 (名前: "Agentmem Dev")
2. tmux session `discord-agent-mem` セットアップ
3. `agent-memory/CLAUDE.md` 作成 (Task 2.1 と統合)
4. `.mcp.json` / settings.json 設定
5. `#agent-mem-dev` チャンネルに招待

---

## 6. Open Questions (CEO 承認事項)

### Q1. Path B (現行コードベース進化) で進めて良いか？
- Path A (書き直し) を選ぶ場合、計画全面見直し + 2週間目標不達成の可能性大
- Arc 推奨: Path B

### Q2. agent-mem Dev bot を新規作成して良いか？
- Arc 推奨: B案 (専用 bot 新規作成)

### Q3. 2 週間の MVP 目標 (2026-04-21) は維持するか？
- Phase 1+2 で 10-13 days 必要、現実的に 2 週間で 66/95 到達は tight
- 延長するなら 3 週間 (2026-04-28) 目標が安全
- Arc 推奨: **3 週間に延長**

### Q4. mvp-spec の扱い
- 現行と乖離しているので、**strategy/ に退避 + 冒頭に注記追加** で良いか
- Arc 推奨: 退避 (更新せず歴史として残す)

### Q5. Gate A 要件 (docker-compose, CI) の優先度
- SQLite デフォルト方針なので docker-compose は「PG ユーザー向けオプション」扱いで良いか
- CI は最小限 (npm test のみ) で OK か
- Arc 推奨: docker-compose はオプション位置付け、CI は最小で OK

### Q6. npm 公開時のスコープ名
- `agent-memory` (既存、package.json 上の名前)
- `@iyasaka/agent-memory` (organization scoped)
- `@watchout/agent-memory` (GitHub org)
- Arc 推奨: `@iyasaka/agent-memory` (ブランド統一)

---

## 7. Risks & Mitigations

| Risk | 影響 | Mitigation |
|------|------|-----------|
| sql.js の FTS5 対応が不完全 | D1 スコア未達成 | LIKE fallback を実装（mvp-spec 既定義）、Day 2 最初に検証 |
| post-tool-hook が他 bot で発火しない | B3 未解消 | 環境変数 (DATABASE_URL, AGENT_MEMORY_PROJECT) を settings.json に直接記載（iyasaka の事例参照） |
| 2 週間で 66/95 到達できない | MVP 公開延期 | 3 週間に延長 (Q3) + Critical Gap を優先 |
| Path 決定が遅れる | Phase 1 着手ブロック | CEO の早期決定を依頼 |
| 現行コードに隠れたバグ | 公開後の事故 | Phase 1 で最低限のテスト拡充、α 版として扱う |
| agent-memory と agent-comms の DB 同居問題 (v0.2.0 receiver) | SQLite モード時に agent-memory が機能しない | OSS eval Q3 の A 案 (別 DB 完全分離) を維持、ADR に明記 |

---

## 8. Timeline (3 週間想定)

```
Week 1 (Apr 8-14):
  Day 1: CEO レビュー + 承認 + Path 決定
  Day 2-3: SQLite store 実装着手 (AM-001, agent-mem Dev)
  Day 2: CLAUDE.md / LICENSE / CONTRIBUTING (AM-003, 004, 007, Arc)
  Day 3: ADF hooks 配布 + Gate A 要件 (AM-008, 009)
  Day 4: 復旧品質計測 (AM-002)
  Day 5: SSOT 充足開始 (AM-010, Arc)
  Day 6-7: SQLite 完成 + テスト / SSOT 継続

Week 2 (Apr 15-21):
  Day 8-9: SSOT 完成 + mvp-spec 整理 (AM-010, 011)
  Day 10: README 改善 + デモGIF (AM-005)
  Day 11: multi-agent hook 展開 (AM-006)
  Day 12: 統合テスト + 全 Gate 通過確認
  Day 13-14: OSS 評価再実行 (AM-012)

Week 3 (Apr 22-28):
  Day 15: 評価結果レビュー、ギャップ対応
  Day 16: 追加改善 (必要なら)
  Day 17: 再々評価
  Day 18: v0.1.0-alpha 公開判定 (AM-013)
  Day 19-21: 公開準備 + 内部告知 (AM-014)
```

---

## 9. 今日のアクション

CEO が本計画に承認した場合、**今日中に以下を実行**:

1. **Path 決定** (CEO 回答)
2. **agent-mem Dev bot 新規作成 or agent-com Dev 兼任決定** (CEO 回答)
3. **GitHub Issues として AM-001〜014 を起票** (Arc or agent-mem Dev)
4. **CLAUDE.md ドラフト作成** (Arc、Task 2.1 先行)
5. **LICENSE (MIT) 配置** (Arc、Task 1.3 先行)

Week 1 Day 1 として最速で Phase 1 着手できる状態にする。

---

## 改訂履歴

| バージョン | 日付 | 内容 |
|-----------|------|------|
| v1.0 | 2026-04-08 | 初版 (Arc 起草)。OSS 評価結果 (45.3%) を踏まえた実装計画。Path B 採用推奨、3 週間 MVP 目標、担当 bot は agent-mem Dev 新規作成推奨 |
