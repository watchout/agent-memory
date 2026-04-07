# agent-memory 事業戦略・完全ロードマップ

> 作成日: 2026-04-07
> 対象: CEO 金子裕二
> 目的: agent-memory のOSS公開からスケーリング・バイアウトまでの全体設計

---

## 1. プロダクト定義

### 1.1 何を解決するか

AIコーディングエージェント（Claude Code, Cursor, Codex, Gemini CLI）の**記憶喪失問題**を解決する。

現在の課題:
- セッションが切れるとコンテキストが消える
- compaction（圧縮）で過去の意思決定が失われる
- 5分のアイドルでMCP接続が切断される
- CLAUDE.mdだけでは構造化された記憶にならない
- 複数セッション間で記憶が共有できない

agent-memoryは「AIエージェントの長期記憶」をMCPサーバーとして提供する。

### 1.2 技術アーキテクチャ

```
Claude Code / Cursor / Codex（MCPクライアント）
  ↕ stdio / SSE
agent-memory MCP Server（ユーザーのローカルマシンで動作）
  ↕
ローカルSQLite（デフォルト）or PostgreSQL（オプション）
```

- 外部サーバー不要。ユーザーのマシンで完結
- npm install → 設定ファイルに追記 → 即使用
- IYASAKAのインフラコストはゼロ

### 1.3 コア機能（v0.1.0）

| 機能 | 説明 |
|------|------|
| Session Boot | セッション起動時に過去のコンテキストを自動復元 |
| Decision Log | 意思決定（設計判断・技術選定・却下理由）を構造化して永続保存 |
| Compaction Recovery | compactionで失われた情報をDBから復旧 |
| Task State | 進行中タスクの状態を永続化。セッション落ちても復帰可能 |
| Cross-Session Memory | セッションAで学んだことをセッションBが参照可能 |

---

## 2. ライセンス・有料化設計（公開前に確定）

### 2.1 基本方針

```
無料版（OSS core）: 永久MIT。絶対に変更しない。
有料版（Cloud）: 別リポジトリ。別プロダクト。最初から有料前提。
```

この方針はREADME・LICENSE・CONTRIBUTINGに初日から明記する。

### 2.2 リポジトリ構成

```
agent-memory/              ← MIT License（永久無料）
  ├── src/
  │   ├── session-boot/
  │   ├── decision-log/
  │   ├── compaction-recovery/
  │   ├── task-state/
  │   └── cross-session/
  ├── README.md            ← 有料プランの存在を初日から明記
  ├── LICENSE              ← MIT
  └── CONTRIBUTING.md      ← 「coreへの貢献はMITで永久に残る」と明記

agent-memory-cloud/        ← 別リポ。有料サービスのバックエンド
  ├── dashboard/
  ├── team-sync/
  ├── degradation-detection/
  └── managed-db/
```

### 2.3 無料 vs 有料の機能境界

**判断基準:**
1. 1人の開発者がローカルで使う機能 → 無料
2. なくてもコア機能は動く → 有料候補
3. 提供にインフラコストがかかる → 有料

| 機能 | OSS (Free) | Cloud (Paid) |
|------|:---:|:---:|
| Session Boot | ✅ | ✅ |
| Decision Log | ✅ | ✅ |
| Compaction Recovery | ✅ | ✅ |
| Task State | ✅ | ✅ |
| Cross-Session Memory | ✅ | ✅ |
| ローカルSQLite保存 | ✅ | ✅ |
| CLI操作 | ✅ | ✅ |
| バグ修正・セキュリティパッチ | ✅ | ✅ |
| 基本MCP インターフェース | ✅ | ✅ |
| チーム間の記憶共有・同期 | — | ✅ |
| Webダッシュボード（記憶の可視化・検索） | — | ✅ |
| 劣化シグナル自動検知・アラート | — | ✅ |
| 複数プロジェクト管理 | — | ✅ |
| 監査ログ・エクスポート | — | ✅ |
| マネージドDB（バックアップ・SLA付き） | — | ✅ |
| SSO / チーム管理 | — | ✅ |
| API rate limit 緩和 | — | ✅ |
| 優先サポート | — | ✅ |

### 2.4 鉄則（絶対に守る）

1. **無料版の既存機能を後から有料に移動しない**
2. **セルフホストは永久無料**
3. **バグ修正・セキュリティパッチは常に両方に提供**
4. **新機能の追加のみが有料化の対象**（既存機能の変更はしない）

### 2.5 READMEに記載する文言（v0.1.0初日から）

```markdown
## Pricing

agent-memory core is free and open source (MIT) forever.
Self-hosted will always be free.

We plan to offer a hosted cloud version with team features
(shared memory, dashboards, degradation alerts) as a paid service.
This is how we sustain the project.
```

---

## 3. 収益モデル

### 3.1 収益源の時間軸

```
Phase 1（0-6ヶ月）: コンサル収益
  └→ OSS無料公開で信頼構築 + コンサル案件で収益

Phase 2（6-12ヶ月）: SaaS（サブスク）収益開始
  └→ agent-memory Cloud ローンチ → MRR構築

Phase 3（12-24ヶ月）: SaaS成長 + テンプレート販売
  └→ MRRスケーリング → EXIT対象規模

Phase 4（24-36ヶ月）: EXIT or 自走
  └→ バイアウト or 独立SaaS企業として継続
```

### 3.2 Phase 1: コンサル（月 $10K-25K 目標）

| サービス | 価格 | 月間目標 |
|---------|------|---------|
| Agent Architecture Audit | $5K-8K | 2件 |
| AI開発チーム構築支援 | $30K-100K | 0-1件 |
| Upwork/PeoplePerHour案件 | $3K-5K | 2-3件 |
| 月次リテイナー | $3K-10K/月 | 1-2社 |

### 3.3 Phase 2: SaaS 価格設計

**サブスクベース + 従量ハイブリッド**

| プラン | 月額 | 内容 |
|-------|------|------|
| Solo | $29/月 | 1プロジェクト、ダッシュボード、5,000 API calls/月 |
| Team | $99/月 | 5プロジェクト、チーム共有記憶、劣化検知、25,000 API calls/月 |
| Pro | $299/月 | 無制限プロジェクト、監査ログ、SSO、SLA、100,000 API calls/月 |
| Enterprise | カスタム | オンプレ対応、専用サポート、カスタム統合 |

超過API calls: $0.005/call

**なぜサブスクか:**
- MRR（月次経常収益）がバイアウト評価の基盤
- SaaS標準のMRR倍率: 40-100倍
- MRR $100K = 企業価値 $4M-10M
- 従量のみだとMRRが不安定で評価が下がる

### 3.4 Phase 3: テンプレート販売（追加収益）

| テンプレート | 価格 | 対象 |
|------------|------|------|
| SaaS開発チーム構成 | $499-999 | スタートアップCTO |
| モバイルアプリ開発チーム | $499-999 | アプリ開発チーム |
| ロールプリセット集（CTO/Dev/Auditor/Architect） | $299 | マルチエージェント実践者 |
| ガバナンスルール集（16セクション） | $499 | エンタープライズ |

---

## 4. ロードマップ

### 4.1 Phase 1: 存在証明（2026年4月-6月）

**4月（今月）: OSS公開**

```
Week 1:
  □ ライセンス・リポ構成確定（core MIT / cloud 別リポ）
  □ README作成（有料プランの存在を明記）
  □ CONTRIBUTING.md作成
  □ 機能境界表の確定

Week 2:
  □ agent-memory v0.1.0-alpha をGitHub公開
  □ デモGIF撮影 → READMEに埋め込み
  □ npm / PyPI にパッケージ公開

Week 3:
  □ X（@yuji_agents）開始。初投稿
  □ Osmani / Yegge / swyx へのリプライ開始
  □ 核フレーズ発信:
    「Your context window forgets. Your database doesn't.」
    「9 AI employees on a Mac mini.」

Week 4:
  □ Hacker News "Show HN" 投稿
  □ Dev.to / Medium に技術記事
  □ GitHub Issue テンプレート整備
```

**5月: コミュニティ構築**

```
  □ agent-memory v0.2.0（フィードバック反映）
  □ agent-com v0.1.0-alpha 公開
  □ Discord コミュニティ開設
  □ X フォロワー 1,000+ 目標
  □ GitHub stars 500+ 目標
  □ Upwork/PeoplePerHour で初期案件着手
```

**6月: 初期収益**

```
  □ hotel-kanri 完成（「マルチエージェントで出荷した」実績）
  □ 初回 Audit 案件 1-2件
  □ agent-memory v0.3.0（安定版）
  □ LinkedIn プロフィール最適化 + 記事投稿
  □ GitHub stars 1,000+ 目標
```

### 4.2 Phase 2: SaaS構築（2026年7月-12月）

**7-8月: Cloud版MVP開発**

```
  □ agent-memory Cloud バックエンド設計
  □ チーム共有記憶の実装
  □ Webダッシュボード MVP
  □ Stripe 決済統合
  □ ランディングページ構築
  □ コンサル Audit 月2件ペース
  □ GitHub stars 2,000+ 目標
```

**9-10月: Cloud版ローンチ**

```
  □ agent-memory Cloud β版リリース
  □ Solo + Team プラン提供開始
  □ 初期ユーザー50人目標（β価格で誘引）
  □ 劣化シグナル検知の実装
  □ マルチLLM対応（Auditor=GPT, Advisor=Gemini）
  □ ケーススタディ 2-3本公開
```

**11-12月: MRR構築**

```
  □ Cloud 正式版リリース
  □ Pro プラン追加
  □ ユーザー 200+ 目標
  □ MRR $10K-20K 目標
  □ agent-com Cloud の設計開始
  □ AI Engineer Summit 等の CFP 応募
```

### 4.3 Phase 3: スケーリング（2027年1月-12月）

**Q1（1-3月）: 成長加速**

```
  □ agent-com Cloud ローンチ
  □ Enterprise プラン提供開始
  □ 業種別テンプレート販売開始
  □ ユーザー 500+ 目標
  □ MRR $50K 目標
  □ 1名目の採用（DevRel or エンジニア）
```

**Q2-Q3（4-9月）: 市場拡大**

```
  □ 日本市場本格参入（逆輸入モデル）
  □ SI企業とのパートナーシップ（OEM提供）
  □ Anthropic / LangChain との公式パートナーシップ交渉
  □ ユーザー 2,000+ 目標
  □ MRR $100K 目標
  □ チーム 3-5名
```

**Q4（10-12月）: EXIT準備**

```
  □ 財務の整理（MRR, churn rate, LTV, CAC）
  □ ユーザー 5,000+ 目標
  □ MRR $200K+ 目標
  □ EXIT交渉開始 or Series A 検討
```

### 4.4 Phase 4: EXIT（2028年）

**EXIT候補:**

| 買い手候補 | 理由 | 想定評価額 |
|-----------|------|-----------|
| Anthropic | Claude Codeエコシステム強化 | MRR × 50-100倍 |
| LangChain | LangGraph + 記憶管理の統合 | MRR × 40-60倍 |
| GitLab / GitHub | 開発者ツールチェーンの拡張 | MRR × 50-80倍 |
| ServiceNow | AI Workforce拡張 | 戦略的プレミアム |
| 日本のSI企業 | 日本市場のAIケイパビリティ獲得 | MRR × 30-50倍 |

**EXIT条件の目安:**

```
最低条件:
  MRR: $100K+
  ユーザー: 2,000+
  churn rate: < 5%/月
  成長率: MoM 15%+

理想条件:
  MRR: $200K+
  ユーザー: 5,000+
  churn rate: < 3%/月
  成長率: MoM 20%+
  → 評価額: $8M-20M（MRR × 40-100倍）
```

---

## 5. 海外市場認知戦略

### 5.1 ポジショニング

```
カテゴリ: AI Agent Memory Infrastructure
ワンライナー: Persistent memory for AI coding agents.
             Your context window forgets. Your database doesn't.

競合との違い:
  CLAUDE.md → 静的ファイル。構造化されていない。手動更新
  SQLite memory hack → 個人の実装。標準化されていない
  agent-memory → MCP標準。構造化。自動。クロスセッション
```

### 5.2 チャネル戦略

**Tier 1: 必須チャネル（4月開始）**

| チャネル | 目的 | 頻度 |
|---------|------|------|
| GitHub | OSS公開・stars獲得・信頼構築 | 毎日コミット |
| X（@yuji_agents） | 認知獲得・コミュニティ参加 | 毎日1-3投稿 |
| Hacker News | 初期バースト・技術者へのリーチ | 月1-2回 |

**Tier 2: 拡張チャネル（5-6月開始）**

| チャネル | 目的 | 頻度 |
|---------|------|------|
| LinkedIn | CTO・意思決定者へのリーチ | 週2回 |
| Dev.to / Medium | SEO・長文技術コンテンツ | 月2-3本 |
| Discord | コミュニティ運営・サポート | 常時 |
| YouTube | デモ動画・チュートリアル | 月1-2本 |

**Tier 3: 成長チャネル（7月以降）**

| チャネル | 目的 | 頻度 |
|---------|------|------|
| カンファレンス登壇 | ブランド確立・リード獲得 | 四半期1回 |
| ポッドキャスト出演 | リーチ拡大 | 月1回 |
| パートナー共同発信 | 信頼の借用 | 随時 |

### 5.3 コンテンツ戦略

**刺さるフック（検証済み）:**

```
記憶喪失系:
  「Your context window forgets. Your database doesn't.」
  「Claude Code's memory problem isn't a bug. It's a design gap.」
  「I lost 3 hours of AI pair-programming because of compaction.」

マルチエージェント系:
  「9 AI employees on a Mac mini.」
  「max_turns is not governance.」
  「claude-peers lets bots talk in the dark.
   agent-com lets them talk where everyone can see.」

実績系:
  「I've been running 9 Claude Code bots 24/7 for [X] months.」
  「Here's what breaks when your AI team never sleeps.」
```

**コンテンツカレンダー（月次）:**

```
Week 1: 技術記事（How agent-memory works）
Week 2: 問題提起（Why your AI forgets）
Week 3: 比較・分析（agent-memory vs CLAUDE.md vs custom solutions）
Week 4: ケーススタディ or デモ動画
```

### 5.4 X アカウント運用（@yuji_agents）

```
バイオ:
  Building agent-memory — persistent memory for AI coding agents.
  OSS. MCP. Your context window forgets. Your database doesn't.
  9 AI agents. 24/7. Consulting: AI agent architecture.

戦略:
  70% リプライ（他人のスレッドで成長）
  30% 自分の投稿
  外部リンクはリプライに入れる（アルゴリズム対策）
  ハッシュタグ 0-1個
  X Premium 必須（$8/月）

ターゲットアカウント:
  @addyosmani — 比較表・整理系。リプライで補足情報を提供
  @steveYegge — 意見強め。反論 or 補強で会話に入る
  @swyx — Learn in Public。自分の学びを共有する形で
  @nityeshaga — Applied AI。ビジネス課題の解決文脈で
  @satori_sz9 — 日本発の制約ストーリー
```

---

## 6. 日本市場認知戦略

### 6.1 タイミング: 海外実績の後（2026年7月以降）

```
なぜ後か:
  → 日本企業は海外で認められたものを信頼する
  → 「GitHubで2,000 stars」「海外企業が導入」が日本での最強の営業ツール
  → 日本語での発信は英語圏の10分の1のリーチ
```

### 6.2 日本市場の特殊性

```
追い風:
  → 2040年までに1,100万人の労働力不足
  → AI agent市場 CAGR 49.9%（2026-2033）
  → 政府のSociety 5.0推進
  → エンジニア採用が困難

逆風:
  → 全社的AI導入達成は8%のみ
  → 意思決定が遅い
  → 英語情報へのアクセスの壁
  → 「自社で作る」志向が強い大企業
```

### 6.3 日本向けメッセージ

```
刺さるフレーミング:
  「エンジニア採用できない？ 9人のAI開発チームを構築します」
  「Claude Code × GPT × Gemini、混成AIチームの実運用ノウハウ」
  「AIエージェントの記憶喪失、解決しました（OSS・無料）」
  「海外で2,000+ stars獲得の日本発OSS」
```

### 6.4 日本チャネル

| チャネル | 目的 | 開始時期 |
|---------|------|---------|
| Zenn | 技術記事（日本の開発者コミュニティ） | 7月 |
| note | ビジネス寄り記事（CTO・経営者向け） | 7月 |
| X 日本語アカウント | 認知獲得 | 7月 |
| connpass / Doorkeeper | 勉強会・LT | 9月 |
| 日本のSI企業へのOEM提案 | 収益 | 10月 |

---

## 7. KPI（フェーズ別）

### Phase 1: 存在証明（4-6月）

| 指標 | 目標 |
|------|------|
| GitHub stars | 1,000+ |
| npm downloads/週 | 500+ |
| X followers | 1,000+ |
| Hacker News 最高順位 | フロントページ |
| Audit 案件数 | 2-3件 |
| 月間収益 | $5K-15K（コンサル） |

### Phase 2: SaaS構築（7-12月）

| 指標 | 目標 |
|------|------|
| GitHub stars | 3,000+ |
| Cloud ユーザー数 | 200+ |
| MRR | $10K-20K |
| churn rate | < 5%/月 |
| Audit + 構築案件 | 累計 10件+ |
| 月間収益 | $20K-40K（コンサル + SaaS） |

### Phase 3: スケーリング（2027年）

| 指標 | 目標 |
|------|------|
| GitHub stars | 10,000+ |
| Cloud ユーザー数 | 2,000-5,000 |
| MRR | $100K-200K |
| ARR | $1.2M-2.4M |
| churn rate | < 3%/月 |
| チーム人数 | 3-5名 |
| 日本市場ユーザー | 200+ |

### Phase 4: EXIT（2028年）

| 指標 | 条件 |
|------|------|
| MRR | $200K+（最低 $100K） |
| ARR | $2.4M+（最低 $1.2M） |
| 評価額 | $8M-20M |
| 成長率 | MoM 15%+ |
| churn | < 3% |

---

## 8. リスクマトリクス

| リスク | 確率 | 影響 | 対策 |
|--------|:---:|:---:|------|
| Anthropicが同等機能をリリース | 高 | 高 | ガバナンス層・マルチLLM対応は自前。通信層が公式化されても運用ノウハウは残る。agent-memoryがAnthropicに買収される可能性もある（EXIT機会） |
| compaction問題がAnthropicにより解決 | 中 | 中 | Decision Log / Task State / Cross-Session Memory はcompaction以外でも有用。解決されても記憶の永続化ニーズは残る |
| LangGraph/CrewAIが記憶管理を内蔵 | 中 | 中 | agent-memoryはフレームワーク非依存。どのツールからでも使える汎用性が差別化 |
| OSS→有料化で反発 | 低 | 高 | 初日から有料プランの存在を明記。無料版の機能を絶対に減らさない。セルフホスト永久無料 |
| 案件が取れない | 中 | 高 | OSSのスターが信頼構築。Upworkで種銭確保。無料Auditで実績を買う |
| hotel-kanriが完成しない | 中 | 高 | 最優先で完成。「マルチエージェントで出荷した」実績が全ての起点 |
| 競合OSSの出現 | 中 | 中 | 先に出す。実運用実績で差別化。コミュニティの先行者優位 |

---

## 9. 財務計画

### 9.1 コスト構造（月次）

**Phase 1（4-6月）:**

| 項目 | 月額 |
|------|------|
| Claude Code Max | $200 |
| API費用（OpenAI, Gemini） | $100-300 |
| X Premium | $8 |
| ドメイン・DNS | $5 |
| GitHub（無料枠） | $0 |
| 合計 | ~$500/月 |

**Phase 2（7-12月）:**

| 項目 | 月額 |
|------|------|
| Phase 1 のコスト | $500 |
| クラウドインフラ（Cloud版） | $200-500 |
| Stripe 手数料（2.9%） | MRRの3% |
| ドメイン + LP ホスティング | $50 |
| 合計 | ~$1,000-1,500/月 |

**Phase 3（2027年）:**

| 項目 | 月額 |
|------|------|
| インフラ（スケール） | $2,000-5,000 |
| 人件費（1-2名） | $5,000-15,000 |
| マーケティング | $1,000-3,000 |
| ツール・サービス | $500-1,000 |
| 合計 | ~$10,000-25,000/月 |

### 9.2 収益予測

| 期間 | コンサル | SaaS MRR | 合計月収 | 累計利益 |
|------|---------|----------|---------|---------|
| 2026 Q2 | $5-15K | $0 | $5-15K | $15-45K |
| 2026 Q3 | $10-20K | $2-5K | $12-25K | $50-120K |
| 2026 Q4 | $10-20K | $10-20K | $20-40K | $110-240K |
| 2027 Q1 | $10-15K | $30-50K | $40-65K | $230-435K |
| 2027 Q2 | $10-15K | $50-100K | $60-115K | $410-780K |
| 2027 Q3-Q4 | $10-15K | $100-200K | $110-215K | $740-1,430K |

### 9.3 EXIT シナリオ

```
保守的シナリオ:
  MRR $100K × 40倍 = $4M（約6億円）

標準シナリオ:
  MRR $150K × 60倍 = $9M（約13.5億円）

楽観シナリオ:
  MRR $200K × 80倍 = $16M（約24億円）

戦略的買収（Anthropic等）:
  技術 + ユーザーベースのプレミアム
  = $20M-50M（約30-75億円）も射程内
```

---

## 10. 今週やること

```
□ 1. core / cloud のリポジトリ構成を確定する
□ 2. MIT LICENSE ファイルを作成する
□ 3. README.md を作成する（有料プランの存在を明記）
□ 4. CONTRIBUTING.md を作成する
□ 5. 機能境界表（Free vs Cloud）を確定する
□ 6. agent-memory v0.1.0-alpha を GitHub に公開する
□ 7. デモGIF を撮影して README に埋め込む
□ 8. @yuji_agents の最初のツイートを投稿する
```

---

## 改訂履歴

| 日付 | 内容 |
|------|------|
| 2026-04-07 | 初版: プロダクト定義、ライセンス設計、収益モデル、ロードマップ、認知戦略、KPI、財務計画、EXITシナリオ |
