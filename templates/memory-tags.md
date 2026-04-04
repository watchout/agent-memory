# Memory Tags — 自動蓄積ルール

agent-memoryと連携してタスク・判断・知識を自動蓄積するためのタグルールです。
Discord/agent-commsでメッセージを送信する際、以下のタグを含めると自動的にDBに記録されます。

## タグ一覧

| タグ | 用途 | 蓄積先 |
|------|------|--------|
| `[TASK:start]` | タスク開始の宣言 | task_states (in_progress) |
| `[TASK:done]` | タスク完了の報告 | task_states (completed) |
| `[TASK:block]` | タスクブロックの報告 | task_states (blocked) |
| `[DECISION]` | 重要な判断の記録 | decisions |
| `[KNOWLEDGE]` | 学んだ知識・事実の記録 | knowledge |

## 使い方

タグをメッセージの先頭に含めるだけで自動検出されます。

```
[TASK:start] FEAT-025 PostToolUse hook実装
[TASK:done] PR#33 watchdog修正マージ完了
[TASK:block] FEAT-014 DB接続エラーで停止中
[DECISION] Resendをメール送信ライブラリに採用（コスト・API品質のバランス）
[KNOWLEDGE] ConoHa VPSのPM2はenv直渡し必須（.envはNitro本番ビルドで未読み込み）
```

## ルール

- タグは1メッセージに1つ（最初に検出されたタグが使用される）
- タグなしメッセージは蓄積されない（通常の会話はスルー）
- `[TASK:start]`/`[TASK:done]` にチケットID（FEAT-xxx, PR#xx等）がある場合、同名タスクのステータスが更新される
- 蓄積されたデータは `recover_context` でセッション復元時に自動的に読み込まれる
