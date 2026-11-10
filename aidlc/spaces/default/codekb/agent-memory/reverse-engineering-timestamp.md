# Reverse Engineering Timestamp

## Run Record

- Date: 2026-11-10
- Commit: a4a4d1ea5049d86142c4d065c3b42ce232c99f6b
- 読み方: 取り組み 261110-session-rotation（会話の切り直し）のために、repo 全体を読み直した（full rescan、Owner の選択）。前の知識の置き場は古い（STALE）ので、9 つの文書をすべて置き換え、範囲の記録もこの回の分だけで作った。深さは Minimal なので、会話の切り直しに関わる所（起動の hook・Stop の取り込み・回復の束・作り直しの準備・文脈の量の測定・launcher・MCP の道具）を深く読み、ほかは浅く見た。そのため `kind: partial` で、`./` は入れていない。試験・build・program は動かしていない。
- 読まなかった物: `dist/`・`node_modules/`・`.git/`（build の出力と依存）、AI-DLC の install（`.claude/`・`aidlc/`・`.aidlc-version`・`.gitignore` の AI-DLC の区画）。

## Scope of Analysis

```yaml
scope_version: 1
kind: partial
intent: session-rotation
fingerprint: ba12e7cd7af75044a422d6a0a5db82f646910069
analyzed:
  paths:
    - package.json
    - tsconfig.json
    - .github/workflows/
    - docker-compose.yml
    - src/index.ts
    - src/recovery-quality.ts
    - src/boot.ts
    - src/claude-session-start.ts
    - src/codex-session-start.ts
    - src/session-start-auto-receive.ts
    - src/transcript-stop-capture.ts
    - src/claude-conversation-ingest.ts
    - src/codex-conversation-ingest.ts
    - src/claude-hook-installer.ts
    - src/codex-hook-installer.ts
    - src/recovery-context.ts
    - src/restart-pack.ts
    - src/constants.ts
    - src/continuity-analysis.ts
    - src/restart-prepare.ts
    - src/restart-cli.ts
    - src/restart-command-preflight.ts
    - src/claude-marker-controller.ts
    - src/context-window-resolution.ts
    - src/codex-context-measurement.ts
    - src/claude-start.ts
    - src/codex-start.ts
    - src/stores/index.ts
    - scripts/host-adapters/
    - docs/operations/HOST_CONTEXT_HEALTH_DESIGN.md
  components:
    - MCP サーバー
    - 起動時の回復の口（Claude Code・Codex）
    - 会話の記録の取り込み（Claude Code・Codex）
    - hook の設置（Claude Code・Codex）
    - 回復の文と束
    - 再起動の準備と判定
    - 文脈の量の測定
    - 新しい会話の起動
shallow:
  paths:
    - src/gemini-session-start.ts
    - src/antigravity-session-start.ts
    - src/gemini-hook-installer.ts
    - src/antigravity-hook-installer.ts
    - src/gemini-conversation-ingest.ts
    - src/antigravity-conversation-ingest.ts
    - src/kusabi-checkpoint-recovery.ts
    - src/kusabi-fresh-session-fleet.ts
    - src/post-tool-hook.ts
    - src/catch-up.ts
    - src/stores/types.ts
    - src/stores/pg-migrations.ts
    - src/stores/pg-store.ts
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
