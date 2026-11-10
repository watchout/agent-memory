# 事業の概要 — Kusabi（agent-memory）

## 事業の領域と目的

Kusabi（パッケージ名 wasurezu、リポジトリ名 agent-memory）は、AI のエージェント（席）に、会話の圧縮・中断・再起動を越えて残る記憶を渡す MCP サーバーである。合言葉は「Your context window forgets. Your database doesn't.」（CLAUDE.md）。

- 席が決めたこと・作業の途中の状態・学んだことを DB に残し、次に起動した席が続きから仕事を始められるようにする
- 社内（IYASAKA）の開発の席で動いている。外への公開（MIT のライセンス）も目標にある
- 版は 0.3.0（package.json）

## 主な働き

| 働き | 中身 | 入口 |
|------|------|------|
| 決定の記録 | 決めたことを残し、古い決定を新しい決定で置き換える | log_decision・get_decisions・supersede_decision |
| 作業の状態 | 進めている作業の状態を保存する（同じ作業の名前なら上書き） | save_task_state |
| 知識 | 事実・型・学びを残し、置き換え・保管に回す | save_knowledge・get_knowledge・supersede_knowledge・update_knowledge_status |
| 回復 | 起動した席に、今の作業・有効な決定・知識・最近の会話をまとめて返す | recover_context・restart_pack・restart_prepare・restart_pack_fetch |
| 検索と読み出し | 記録と会話を探し、会話の一部を読み出す | search_memory・read_memory_source |
| 会話の取り込み | 席の道具（Claude Code・Codex など）が手元に残す会話の記録を、伏せ字の処理をして取り込む | ingest_conversation_events・catch_up |
| 起動の口 | 席の種類ごとに、起動の時に回復の内容を最初の文脈へ差し込む | 起動の hook のコマンド群 |

道具の一覧の詳細は api-documentation.md、部品ごとの受け持ちは component-inventory.md を参照。

## 使う人と使われ方

- **席（主な使い手）**: Claude Code・Codex・Gemini・Antigravity の席。席ごとに 1 つの MCP サーバーの process が動き、その process の環境変数で「誰の記憶か」（agent_id）と「どの案件か」（project）が決まる
- **運用する人**: 展開・状態の表示・再起動のコマンドを使う（package.json の bin）
- **連携する製品**: AUN（agent-comms）。同じ DB に AUN の表があれば回復の時に最近のメッセージも読む。無くても動く（CLAUDE.md「独立性の原則」）

## 今回の取り組みから見た位置づけ

今回の取り組み（施設向けの管理の AX システムの記憶を自社か顧客の DB の中で保ち、どの席も続きから再開できる）に対して、今の版は「同じ役割の席が、種類を替えても自分の記憶を続きから読める」所までを持つ。別の役割の席への引き継ぎ・顧客ごとの区切り・外への送り出しを止めることは、まだ形になっていない。詳しくは architecture.md の「改善の余地」と code-quality-assessment.md の「技術的な負債」を参照。
