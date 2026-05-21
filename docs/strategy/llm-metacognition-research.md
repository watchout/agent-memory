# LLMは「自分が知らないこと」を認識できるか？

## Deep Research Report — agent-memory設計のための調査

---

## 1. 結論（先に）

**LLMは「ある程度」自分の不確実性を認識できる。ただし信頼性は低く、状況依存的。**

agent-memoryの設計判断として重要な3つのファクト：

1. **ツールdescriptionによる行動誘導は、CLAUDE.mdよりも堅牢** — MCPツール定義はcompaction対象外。LLMの「ツールを使う判断」は、フリーテキスト指示への従順さより信頼性が高い
2. **Adaptive Retrieval（必要時だけ検索）は確立された研究領域** — SELF-RAG, FLARE等、「LLMが自分で検索の必要性を判断する」手法は2023-2025で急速に発展。実用レベルに到達している
3. **完全な決定論的制御は不可能だが、多層防御で実用十分** — 100%の自己認識は原理的に無理。ただしツール誘導 + 外部劣化検知で実運用に十分な信頼性は確保できる

---

## 2. 学術研究の現状

### 2.1 メタ認知の定義と測定

LLMのメタ認知は「自身の推論とパフォーマンスを監視・評価・制御する能力」と定義される（Zhou et al., 2024）。具体的には以下の能力を含む：

- **Self-monitoring** — 回答の正しさの確率を評価する
- **Self-evaluation** — エラーや知識ギャップの原因を診断する
- **Strategic adaptation** — 不確実性に基づいて行動を変える（検索を呼ぶ等）

### 2.2 キャリブレーション研究（LLMの自信度は正確か？）

**NeurIPS 2024: "Large Language Models Must Be Taught to Know What They Don't Know"**

- LLMの出力トークン確率は、オープンエンド生成では不確実性指標として信頼できない
- ただしfine-tuningで「正解かどうかの不確実性」を学習させると、少ないパラメータで実用的なキャリブレーションが可能
- この不確実性推定は新しい質問タイプや他のモデルにも汎化する
- つまり「LLMに自分の不確実性を教える」ことは可能で、サンプル効率も良い

**ICLR 2025: "Do LLMs Estimate Uncertainty Well in Instruction-Following?"**

- 80モデルを評価した最大規模の不確実性研究
- 言語的な不確実性表現（LVU: "I'm not sure"等）が、トークン確率ベースより一貫して優れた性能
- 重要な発見：高い精度は信頼できる不確実性を意味しない。推論タスクでは不確実性推定が良好だが、知識ベースタスクでは悪い
- つまり「知識の欠如」の自己認識は、「推論の不確実性」の自己認識より困難

**KalshiBench (2025): 予測市場での認識テスト**

- 全モデルが過信（ECE 0.12-0.40の大きなキャリブレーション誤差）
- Extended reasoning（思考を深める）はキャリブレーションを改善するどころか悪化させる
- 「自信を持って間違える」問題はfrontierモデルでも未解決

### 2.3 メタ認知能力の証拠（Ackerman, 2025）

**"Evidence for Limited Metacognition in LLMs"**

- 2024年以降のfrontierモデルで、メタ認知能力の証拠が増加
- LLMは自信の高低に基づいて戦略的に行動を変える能力を示す
- ただし能力は「限定的な解像度」で「文脈依存的」に出現
- 人間のメタ認知とは質的に異なる
- post-training（RLHF等）がメタ認知能力の発達に重要な役割

### 2.4 医療領域での失敗例

**Nature Communications (2025): "LLMs lack essential metacognition for reliable medical reasoning"**

- 12モデルを評価。全モデルで重大なメタ認知的欠陥
- 正解選択肢が存在しない場合でも、自信を持って回答を生成
- 知識の限界を認識する能力の一貫した欠如
- 「認識された能力と実際の能力の間の致命的な乖離」

---

## 3. Adaptive Retrieval — 「必要な時だけ検索する」研究

### 3.1 SELF-RAG（ICLR 2024 Oral, Top 1%）

agent-memoryの`search_memory`設計に最も関連する研究。

**核心アイデア：** LLMに「検索が必要かどうか」を判断させるreflection tokenを学習させる

- 各生成セグメントで[Retrieve]トークンを出力 → 必要なら外部検索を実行
- 検索結果の関連性を自己評価するcritiqueトークンも生成
- 検索を完全にスキップすることも、複数回検索することも可能

**結果：** ChatGPTとLlama2-chatを大幅に上回る。事実性と引用精度で顕著な改善。

**agent-memoryへの示唆：** `search_memory`のツールdescriptionに「判断前に検索」を焼き込む方式は、SELF-RAGの思想と同じ。違いはSELF-RAGが特殊トークンで実現する所を、MCPツールで実現する点。

### 3.2 FLARE — 動的トリガーの先駆け

**Forward-Looking Active REtrieval (Jiang et al., 2023)**

- 生成中のトークン確率が閾値を下回ったら自動で外部検索を発動
- 「自信がない → 検索する」をロジット確率で決定論的に制御

**限界：** 単一トークンの確率に依存するため、検索タイミングが遅れることがある

### 3.3 ETC — エントロピー変化トレンドによる改善（2025）

- FLAREの「単一トークン確率」の限界を克服
- トークンレベルのエントロピーの1次・2次差分をモデリング
- 不確実性の「上昇トレンド」を検知して、エラーが伝播する前に早期介入
- 6つのQAベンチマークで一貫した改善

### 3.4 SKR — Self-Knowledge guided Retrieval

- LLM自身に「この質問に外部情報が必要か？」を判断させる
- LLM自体、または小さいプロキシモデルで「ヒューリスティック回答」を生成
- その回答の品質から検索の必要性を評価

**agent-memoryへの示唆：** search_memoryを「判断前の確認ステップ」として位置づけるのは、この研究系譜に合致。

### 3.5 MetaRAG（2024）— メタ認知的RAG

検索拡張をメタ認知システムに拡張：

- **Monitoring:** 類似度ベースの回答チェック
- **Evaluation:** 内部/外部知識の十分性診断、NLIによるエラー診断
- **Planning:** 検索クエリの修正、戦略の修復

---

## 4. Anthropicの内省研究（2025）

### 4.1 "Emergent Introspective Awareness in LLMs"

Anthropic自身の研究。agent-memoryにとって最も重要な参照先。

**手法：** Concept Injection（活性化ステアリング）

- 既知の概念（例：「パン」）の活性化パターンをモデル内部に注入
- 無関係なタスク中に「何か異常を感じますか？」と質問
- モデルが注入された概念を検出・特定できるか評価

**結果：**

- Claude Opus 4/4.1が最も高性能（能力とメタ認知は相関）
- ただし成功率は約20%。失敗が常態で成功が例外
- 注入の強度に「スイートスポット」がある — 弱すぎると気づかない、強すぎるとハルシネーション
- モデルの約2/3の深さのレイヤーで内省的認識がピーク

**重要な知見：**

> "Current language models possess some functional introspective awareness of their own internal states"
> ただし "failures of introspection remain the norm"

### 4.2 追試と批判（2025末）

**"Feeling the Strength but Not the Source: Partial Introspection in LLMs"**

- Anthropicの内省研究を再現。8Bモデルでも一部成功
- ただしタスクの形式を少し変えると能力が崩壊
- 複数の注入を同時に扱うことは不可能
- **「LLMは内部状態の "強度" は検出できるが、"意味内容" は堅牢にアクセスできない」**

---

## 5. 不確実性の言語化（Verbalized Uncertainty）

### 5.1 研究コンセンサス

**Steyvers & Peters (2025, Current Directions in Psychological Science):**

- LLMのメタ認知研究は矛盾する結果が混在
- 一部の研究：LLMは知識の限界を認識できない
- 他の研究：LLMは知識境界を検出し、正解/不正解を識別できる
- 矛盾の原因は「評価方法の多様性」

- 大きいモデルほどキャリブレーションが改善（自信度が実際の正確さに近づく）
- Fine-tuningで「言語化された不確実性」を改善可能
- ただし「あるタイプのメタ認知タスクの改善は、他のタイプに汎化しない」

### 5.2 "Thought Engineering"アプローチ（2025）

- thinking LLMの推論過程から自然言語の確信度スコアを抽出
- 確信度が低い場合に追加コンテキストを提供
- 「確信度が低い → 追加情報を要求する」パターンをエンジニアリング

> "Modern thinking LLMs can be engineered to recognize insufficient reasoning and proactively seek additional context."

---

## 6. agent-memoryへの設計指針

### 6.1 確実に言えること

| ファクト | 信頼度 | ソース |
|---------|--------|--------|
| LLMは不確実性をある程度認識できる | 高 | 多数の研究 |
| 能力は限定的で文脈依存 | 高 | Ackerman 2025, Anthropic 2025 |
| 大きいモデルほどメタ認知が改善 | 高 | Kadavath 2022, Steyvers 2025 |
| Adaptive Retrieval（必要時検索）は実用レベル | 高 | SELF-RAG (ICLR 2024), FLARE |
| 過信（知らないのに自信がある）は未解決 | 高 | Nature Comms 2025, KalshiBench |
| 100%決定論的なメタ認知制御は不可能 | 確定 | 全研究の共通認識 |

### 6.2 search_memoryの設計根拠

**「LLMが自分で検索の必要性を判断する」のはAdaptive Retrievalの中核概念。ただし以下の条件付き：**

1. **ツールdescriptionが「いつ呼ぶか」を明示的に記述** — SELF-RAGのreflection tokenに相当。プロンプトの指示より堅牢
2. **呼び忘れを前提とした多層防御** — 呼ばれなくても致命的でない設計
3. **起動時の最小注入（Session Boot）は維持** — pull型のみに依存しない。最低限のコンテキストはpush

### 6.3 推奨アーキテクチャ

```
Layer 1: SessionStart hook（決定論的）
  → タスク1件のみ注入（~100トークン）
  → 確実に発火。LLM判断に依存しない

Layer 2: search_memory ツール（Adaptive Retrieval層）
  → descriptionに行動誘導を焼き込み
  → compaction後もツール一覧として残る
  → 呼ばれる確率: 60-80%（研究の示唆に基づく推定）

Layer 3: 外部劣化検知 → セッション再起動（決定論的）
  → 既存の10シグナル（7つ決定論的）
  → Layer 2が失敗してもここで拾う
  → セッション再起動 → Layer 1に戻る
```

### 6.4 search_memoryのdescription設計

研究を踏まえた推奨：

```
"Search past decisions and task context by keyword.

Call this tool BEFORE making any architectural or design decision
to check if a related decision already exists. This prevents
contradicting previous decisions — a common failure mode after
compaction or context loss.

Also useful when you encounter unfamiliar project context,
file structures, or naming conventions that may have been
established in prior sessions."
```

**根拠：**
- SELF-RAGの「必要時だけ検索」の思想をdescriptionで実現
- 「判断前の確認ステップ」として位置づけ（MetaRAGのmonitoringに相当）
- compaction後の文脈喪失に明示的に言及（状況認識の手がかり）

### 6.5 AM-035 implementation update (2026-05-21)

AM-035 applies this research to the runtime control surfaces instead of relying
on static project instructions.

Implemented control points:

1. `search_memory` tool description now explicitly frames the tool as the
   adaptive retrieval layer. It tells the agent to search before architectural
   or design decisions, unfamiliar project context, incomplete restart packs,
   memory/SSOT conflicts, or asking the user to restate context.
2. `restart_pack` output now includes a `RECOVERY CONTROL` section. This is a
   small Layer 1 push that reminds the restarted agent when to pull more memory.
3. Claude `boot.ts` fallback output now uses the same recovery-control ladder
   through `buildRecoveryOutput`.
4. `wasurezu-codex-start` uses the same control lines in the initial Codex
   prompt, so Codex bridge startup and Claude hook startup share the same
   adaptive-retrieval policy.
5. Regression tests pin these control surfaces so future prompt or tool
   description edits do not silently remove the retrieval trigger.

Design consequence:

- Deterministic boot/bridge output provides the minimum restart state.
- MCP tool descriptions provide compaction-resistant retrieval triggers.
- The agent is still allowed to ask the user, but only after using focused
  memory search when restart context is incomplete.

---

## 7. 参考文献（主要）

### 学術論文

1. **Kadavath et al. (2022)** — "Language Models (Mostly) Know What They Know" — LLMキャリブレーションの先駆的研究
2. **Asai et al. (2024)** — "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection" — ICLR 2024 Oral. Adaptive Retrievalの代表作
3. **Jiang et al. (2023)** — "Active Retrieval Augmented Generation (FLARE)" — 動的検索トリガーの先駆け
4. **Ackerman (2025)** — "Evidence for Limited Metacognition in LLMs" — frontierモデルのメタ認知能力の体系的評価
5. **Lindsey (2025)** — "Emergent Introspective Awareness in LLMs" — Anthropicの内省研究。Concept Injection手法
6. **Griot et al. (2025)** — Nature Communications. 医療推論でのメタ認知欠陥
7. **Steyvers & Peters (2025)** — "Metacognition and Uncertainty Communication in Humans and LLMs"
8. **Tao et al. (2025)** — 80モデルの不確実性推定の包括的研究
9. **Hahami et al. (2026)** — "Feeling the Strength but Not the Source" — Anthropic内省研究の追試
10. **Zhou et al. (2024)** — MetaRAG: メタ認知的RAG

### サーベイ

11. **Xia et al. (2025)** — ACL Findings. 不確実性推定手法のサーベイ
12. **ACM Computing Surveys (2025)** — LLM不確実性定量化の分類体系
13. **Fan et al. (2024)** — KDD. RAG meets LLMsのサーベイ

### 実装・フレームワーク

14. **LM-Polygraph** — 不確実性定量化のオープンソースフレームワーク（12以上のUQアルゴリズムを統合）
15. **SELF-RAG実装** — github.com/AkariAsai/self-rag

---

*調査日: 2026-03-30*
*調査対象期間: 2022-2026*
*検索キーワード: LLM metacognition, self-knowledge, uncertainty estimation, adaptive retrieval, introspection, SELF-RAG, FLARE*
