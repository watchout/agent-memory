# Reverse Engineering Timestamp

## Run Record

- Date: 2026-11-15
- Commit: aa77b683e135beabb9fc54bd3736b47d288d6f46
- 作業場の注意: この作業場の branch は古い（`kusabi/hook-input-parser-261111`）。範囲に入れた 43 本の path は、origin/main `27d7f8fc9146e826883b045c1fdca93cc11f93e7` と byte が同じであることを `git show origin/main:<path>` との比較で確かめた。したがって、この回の読みは origin/main の中身に基づく。範囲の外の file は、今の作業場の中身を grep か短く読んだだけで、origin/main との一致は確かめていない。
- 読み方: 取り組み 261113-store-resolution-fix（保存先の決め方をそろえる直し、scope は bugfix、深さは Minimal）のために、保存先を決める部品とその呼び出し元に絞って読み直した（Focused scan、Owner の委任 #49 6762288830）。前の知識の置き場（2026-11-10、取り組み 261110-session-rotation、commit a4a4d1ea5049d86142c4d065c3b42ce232c99f6b）は古い（STALE）ので、9 つの文書を統合した: 今回読んだ所（保存先の決め方・Stop 側の入口・emitter・hook の command の形・試験と CI の確かめ）は書き直し、ほかの本文は前回の読みのまま残した。前回の読みは回転（session-rotation）の統合の前の物なので、今の head と違いうる所は各文書で「前回の読み」と書いて分けた。範囲の記録の `analyzed` はこの回の分だけ、前回の `analyzed` は `shallow` に下げた。`kind: partial` で、`./` は入れていない。
- 読んだ記録: 受け渡しの scan は取り組みの記録の `inception/reverse-engineering/developer-scan.md`（読んだ範囲・呼び出し元の表・試験と CI の事実）。
- 試験・build・program は動かしていない。`~/.agent-memory/` の下（保存先の設定・記録の DB）と環境変数の値は開いていない（名前だけをコードから写した）。
- 読まなかった物: `dist/`・`node_modules/`・`.git/`（build の出力と依存）、AI-DLC の install（`.claude/`・`.codex/`・`.kiro/`・`.cursor/`・`.opencode/`・`.aidlc/`・`aidlc/`）、`src/stores/` の `types.ts`・`pg-migrations.ts`・`voyage.ts`・`knowledge-scope.ts`・`raw-events.ts`・`task-id.ts`・`task-state-normalize.ts` はこの回は開いていない（`types.ts`・`pg-migrations.ts`・`voyage.ts` は前回の `shallow` の記録を引き継いだだけで、今回読み直してはいない）。

## Scope of Analysis

```yaml
scope_version: 1
kind: partial
intent: store-resolution-fix
fingerprint: db7ed4781beffc5069049fb83c7a4fe8792fa2f0
analyzed:
  paths:
    - package.json
    - tsconfig.json
    - .github/workflows/ci.yml
    - src/stores/index.ts
    - src/stores/read-only-task-states.ts
    - src/codex-session-start.ts
    - src/transcript-stop-capture.ts
    - src/session-rotation-stop.ts
    - src/rotation-commit.ts
    - src/post-tool-hook.ts
    - src/claude-hook-installer.ts
    - src/kusabi-runtime-event-emitter.ts
    - src/test-kusabi-runtime-event-emitter.ts
  components:
    - 保存先の決め方
    - 起動時の回復の口（Claude Code・Codex）
    - 会話の記録の取り込み（Claude Code・Codex）
    - hook の設置（Claude Code・Codex）
    - 保存の層
    - 席の実行の身元
    - 印の拾い上げ
    - 会話の切り直しの Stop 側と起動時の受け取り
shallow:
  paths:
    - src/stores/sqlite-store.ts
    - src/stores/pg-store.ts
    - src/stores/json-store.ts
    - src/claude-session-start.ts
    - src/gemini-session-start.ts
    - src/antigravity-session-start.ts
    - src/codex-hook-installer.ts
    - src/boot.ts
    - src/index.ts
    - src/restart-cli.ts
    - src/kusabi-fleet-status-cli.ts
    - src/claude-start.ts
    - src/codex-start.ts
    - .github/workflows/shirube-rapid-lite-gates-report.yml
    - src/test.ts
    - src/test-post-tool-hook.ts
    - src/test-transcript-stop-capture.ts
    - src/test-claude-session-start.ts
    - src/test-antigravity-session-start.ts
    - src/test-boot-recovery.ts
    - src/test-claude-hook-installer.ts
    - src/test-claude-transcript-identity.ts
    - src/test-codex-hook-installer.ts
    - src/test-codex-session-start.ts
    - src/test-gemini-hook-installer.ts
    - src/test-gemini-session-start.ts
    - src/test-handoff-commit-order.ts
    - src/test-handoff-commit-order-pg.ts
    - src/test-kusabi-fleet-status.ts
    - src/test-kusabi-fresh-session-fleet.ts
    - src/test-recovery-context.ts
    - src/test-rotation-hook-registration.ts
    - src/test-session-rotation-flow.ts
    - src/test-session-rotation-scenario.ts
    - src/test-session-rotation-status.ts
    - src/rotation-hook-registration.ts
    - src/session-rotation-files.ts
    - src/test-handoff-source-cli.ts
    - src/test-session-rotation-core.ts
    - src/measure-kusabi-functional.ts
    - src/fleet-conversation-backfill.ts
    - src/kusabi-continuity-interruption-e2e.ts
    - src/kusabi-direct-fleet-rollout.ts
    - src/kusabi-functional-evaluator.ts
    - src/migrate.ts
    - docker-compose.yml
    - src/recovery-quality.ts
    - src/session-start-auto-receive.ts
    - src/claude-conversation-ingest.ts
    - src/codex-conversation-ingest.ts
    - src/recovery-context.ts
    - src/restart-pack.ts
    - src/constants.ts
    - src/continuity-analysis.ts
    - src/restart-prepare.ts
    - src/restart-command-preflight.ts
    - src/claude-marker-controller.ts
    - src/context-window-resolution.ts
    - src/codex-context-measurement.ts
    - scripts/host-adapters/
    - docs/operations/HOST_CONTEXT_HEALTH_DESIGN.md
    - src/gemini-hook-installer.ts
    - src/antigravity-hook-installer.ts
    - src/gemini-conversation-ingest.ts
    - src/antigravity-conversation-ingest.ts
    - src/kusabi-checkpoint-recovery.ts
    - src/kusabi-fresh-session-fleet.ts
    - src/catch-up.ts
    - src/stores/types.ts
    - src/stores/pg-migrations.ts
    - src/stores/voyage.ts
    - src/
    - tests/
    - scripts/
    - templates/
    - docs/
    - .shirube/
    - .framework/
    - .github/
    - .env.example
    - AGENTS.md
    - CLAUDE.md
```
