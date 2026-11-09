# Reverse Engineering Timestamp

## Run Record

- Date: 2026-11-09
- Commit: ee2acff9dcb83b773969d0df9d8a7884728bef67
- 読み方: 取り組み 261109-deps-advisory-upgrade（依存の版上げ）の範囲を足して読んだ（focused scan）。前の取り組み 261021-facility-ax-memory の知識は今のコードと同じと確かめ（CURRENT）、そのまま残して、依存の木（package-lock.json）と、MCP SDK の client を使う試験の 3 つのファイルを足した。別の担当は立てず、この会話が開発者の役として読んだ
- 前の記録: 2026-10-22（取り組み 261021-facility-ax-memory、同じ commit）

## Scope of Analysis

```yaml
scope_version: 1
kind: partial
intent: deps-advisory-upgrade
fingerprint: 3192bf404638c73c474095bf2282b043c3d942d7
analyzed:
  paths:
    - src/index.ts
    - src/stores/types.ts
    - src/stores/index.ts
    - src/stores/knowledge-scope.ts
    - src/stores/pg-migrations.ts
    - src/stores/voyage.ts
    - src/kusabi-partitions.ts
    - src/kusabi-runtime-identity.ts
    - src/recovery-context.ts
    - src/recovery-quality.ts
    - src/boot.ts
    - src/memory-source.ts
    - package.json
    - tsconfig.json
    - .github/workflows/ci.yml
    - docker-compose.yml
    - .env.example
    - docs/design/core/SSOT-7_RUNTIME_AGENT_BINDING.md
    - package-lock.json
    - src/test-memory-source.ts
    - src/test-recovery-context.ts
    - src/test-recovery-scope.ts
  components:
    - MCP サーバー
    - 保存の層
    - 意味検索
    - 回復
    - 起動の口
    - 記録の読み出し
    - 区画の登録
    - 席の実行の身元
shallow:
  paths:
    - src/stores/pg-store.ts
    - src/stores/sqlite-store.ts
    - src/stores/json-store.ts
    - src/codex-session-start.ts
    - src/gemini-session-start.ts
    - src/test.ts
    - src/
    - tests/
    - docs/design/core/SSOT-4_DATA_MODEL.md
    - docs/
    - scripts/
    - templates/
    - .shirube/
    - .framework/
```
