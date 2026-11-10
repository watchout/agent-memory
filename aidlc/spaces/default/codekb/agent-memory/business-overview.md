# 業務の概要 — Kusabi（agent-memory、package 名 wasurezu）

読んだ時点: 2026-11-10、commit a4a4d1ea5049d86142c4d065c3b42ce232c99f6b（branch kusabi/deps-advisory-upgrade-339）。読んだ範囲は reverse-engineering-timestamp.md を参照。

## 何のための物か

自社の席（Claude Code・Codex・Gemini CLI・Antigravity CLI の上で動く AI）が、会話が切れても（落ちる・文脈の圧縮・会話の作り直し）、DB に残した記録から続きを取り戻すための記憶の道具。

- MCP サーバーとして、席が自分で記録を書いて読む道具を出す（17 個。一覧は api-documentation.md）。
- 各 CLI の hook として、会話の記録を DB に取り込み、会話の始まりに回復の文を最初の文脈へ差し込む。
- 記憶の持ち主は席（`agent_id`）。案件（`project`）ごとに区切る。

## 主な働き

| 働き | 中身 | 主な部品（component-inventory.md の見出し） |
|---|---|---|
| 記録を書く・読む | 決定・作業の状態・知識を席が MCP の道具で書き、探し、読み戻す | MCP サーバー |
| 会話を取り込む | 各回の応答の終わり（Stop）と入力の時（UserPromptSubmit）に、手元の transcript を読み、隠れた推論と system・developer の指示を外し、秘匿処理をして DB に書く | 会話の記録の取り込み（Claude Code・Codex） |
| 会話の始まりに戻す | 起動・再開・作り直し（clear）・圧縮（compact）の時に、DB から回復の束（restart pack）を作り、最初の文脈に差し込む | 起動時の回復の口（Claude Code・Codex） |
| 作り直しを準備する | 文脈の使用率と回復の確かさから「作り直しを勧めるか」を決め、次の会話で 1 回だけ使う回復の束を DB に置く | 再起動の準備と判定 |
| 新しい会話を立ち上げる | 新しい Claude Code・Codex の process を起こし、置いた束を渡す。今の会話は止めない | 新しい会話の起動 |
| 運用を見る | 複数の席への展開・状態の表示・一部の席での試し | 運用の観測と展開 |

## 今回の取り組み（会話の切り直し）との関係

Owner の言葉: 「会話の切り直し（一定量で会話を切り、Kusabi の記録で同じ席が続きから動く）だけの小さな取り組み。最小の版を Claude Code と Codex の両方で動く形で作り、大きな取り組み（facility-ax-memory）の U3 を作る時に取り込む。」

- 既にある物: 起動の hook は `clear`・`compact` の時も動く。各回の会話は Stop の hook で DB に入る。使用率の帯の判定と、Codex の使用量の読み取りの関数がある。新しい会話の launcher がある。
- 足りない物: 「一定量」を測って、切り直しを起こし、同じ席が続きから動いたと確かめる、本番の経路のつなぎ。詳しくは architecture.md の「改善の機会」と、受け渡しの scan の Handoff Summary。

## 利用者と境界

- 利用者: 自社の席（`agent_id` で区別）と、席を動かす人（Owner）。
- AUN（席の起動と待ち行列を持つ別の製品）が席を持つ時、Kusabi は再起動も待ち行列の操作もしない（docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md §5）。
- 単独で会話を作り直してよいのは、AUN が無いと確かめた・対応する hook か監督がある・事前に許された、の 3 つがそろう時だけ（同 §6、src/restart-prepare.ts の `autoRestartBlockersFor`）。
- DB の作り・展開・workflow・資格情報は Owner の決定が要る保護面。
