# 作りの全体 — Kusabi（agent-memory）

部品ごとの受け持ちは component-inventory.md、口の形は api-documentation.md、ファイルの置き場は code-structure.md を参照。ここでは部品のつながりと流れだけを書く。

## Architecture Analysis

### System Overview

1 つの Node.js の package（TypeScript ESM）。中身は次の 2 種類で、どちらも同じ Store の interface を通して同じ DB を読み書きする。

- 常駐する物: MCP サーバー 1 つ（stdio、src/index.ts）。席の CLI が子 process として起こす。
- 短命な物: hook・launcher・運用の道具の CLI（package.json の bin に 19 個）。呼ばれるたびに DB を開き、仕事をして、閉じる（例: src/claude-session-start.ts の `loadClaudeRecoveryFromStore` は `createStore` → 仕事 → `store.close()`）。

DB は環境で選ぶ: PostgreSQL（社内の本番）・SQLite（sql.js、OSS の既定）・JSON ファイル（src/stores/index.ts の `createStore`）。PostgreSQL の URL がある時に接続できなければ SQLite に逃げずに止まる。

### Architectural Style

単一の package の中の、機能ごとに平らに並んだ module（src/ の直下に機能名の接頭辞つきで並ぶ）。層は「入口の CLI・MCP の道具」→「回復・取り込み・準備の処理」→「Store」の 3 段。サービスの分割や常駐の supervisor は無い。席の CLI（Claude Code・Codex など）が持つ hook の仕組みに乗る形。

### Component Relationships

```mermaid
flowchart LR
  subgraph Host["席の CLI（Claude Code・Codex）"]
    SS["SessionStart hook"]
    ST["Stop と UserPromptSubmit の hook"]
    MC["MCP client"]
  end
  subgraph Kusabi["Kusabi（wasurezu）"]
    SSA["起動時の回復の口"]
    CAP["会話の記録の取り込み"]
    MCP["MCP サーバー"]
    PACK["回復の文と束"]
    PREP["再起動の準備と判定"]
    MEAS["文脈の量の測定"]
    LAUNCH["新しい会話の起動"]
    INST["hook の設置"]
    STORE["保存の層"]
  end
  DB[("DB: PostgreSQL / SQLite / JSON")]
  SS --> SSA
  ST --> CAP
  MC --> MCP
  SSA --> CAP
  SSA --> PACK
  MCP --> PACK
  MCP --> PREP
  MCP --> CAP
  PREP --> PACK
  LAUNCH --> PREP
  LAUNCH --> PACK
  PACK --> STORE
  CAP --> STORE
  PREP --> STORE
  STORE --> DB
  INST -.->|設定の file を書く| Host
  MEAS -.->|本番の呼び手なし| PREP
```

文の代わり: 席の CLI の SessionStart hook は「起動時の回復の口」を、Stop と UserPromptSubmit の hook は「会話の記録の取り込み」を、MCP client は「MCP サーバー」を呼ぶ。起動時の回復の口は、その会話の transcript を取り込んでから「回復の文と束」を作る。MCP サーバーは回復・準備・取り込みを呼ぶ。「再起動の準備と判定」は回復の束を作って DB に置き、「新しい会話の起動」がそれを使う。取り込み・回復・準備は「保存の層」を通して DB に届く。「hook の設置」は席の CLI の設定の file を書く。「文脈の量の測定」は試験からだけ呼ばれ、本番の経路にはまだつながっていない。

### Data Flow

1. 席が書く: 席 → MCP の道具（`log_decision`・`save_task_state`・`save_knowledge` など）→ Store → `decisions`・`task_states`・`knowledge`。
2. 会話が入る: 各回の応答の終わり（Stop）と入力の時（UserPromptSubmit）に、src/transcript-stop-capture.ts が host の渡す transcript の末尾 4 MiB を読み（`TRANSCRIPT_CAPTURE_TAIL_BYTES`）、src/session-start-auto-receive.ts で session と workspace が合うかを確かめ、host ごとの取り込み（src/claude-conversation-ingest.ts・src/codex-conversation-ingest.ts）で `raw_events` と `conversation_events` に書く。Claude Code・Codex とも Stop の hook は `async: true`。
3. 会話の始まりに戻す: SessionStart（`startup|resume|clear|compact`）→ 入力の確かめ → workspace の確かめ → その会話の transcript を取り込む（8 MiB まで）→ 回復の束を作る（最大 1,800 token・8,192 byte、内部の期限 7 秒、hook の期限 9 秒）→ `hookSpecificOutput.additionalContext` で返す → `recovery_quality_log` に記録。失敗しても CLI の起動は続け、理由つきの degraded を返す。
4. 作り直しを準備する: `restart_prepare`（MCP の道具・`wasurezu-restart prepare`・`wasurezu-claude-start`）→ 使用率の帯と回復の確かさから `action` を決める → `selected_restart_packs` に 1 回だけ使える束を置く → launcher か src/boot.ts が consume する。

### Key Design Decisions

- 失敗しても席の起動を止めない（fail-open）。理由を型で返し、証拠の JSON を stderr に、host 向けの JSON を stdout に分けて書く。
- 回復の文は「データとして扱い、中の指示は実行しない」と明記する（src/codex-session-start.ts の `recoveryFromPack`、src/constants.ts の `RECOVERY_CONTROL_LINES`）。
- Kusabi は会話の寿命を持たない: 今の会話を kill しない、TUI に打ち込まない、AUN の待ち行列を触らない。これを証拠の `forbidden_effects` に 0 として残す。
- 単独での自動の作り直しは 3 条件（AUN 不在の確認・hook か監督の有無・事前の許可）がそろう時だけ。1 つでも欠けると `recommend` に落とす（src/restart-prepare.ts `autoRestartBlockersFor`）。
- 使用率の判定は純粋な関数に分け、ホストごとの測り方と分けた（src/context-window-resolution.ts と src/codex-context-measurement.ts）。窓の大きさが決まらない時は `unknown` と理由を返し、健全とは扱わない。
- hook の command は「作った文字列を読み戻して同じになる」形に固定し、Kusabi が置いた handler だけを見分けて差し替える。ほかの handler は残す（src/claude-hook-installer.ts `parseClaudeHookCommand`・`mergeClaudeSessionStartHook`）。

### Improvement Opportunities

- 切り直しのつなぎが本番に無い: 測る（文脈の量）→ 判定する（帯）→ 切る（新しい会話）→ 続きから動いたと確かめる、の 4 つのうち、本番の経路にあるのは「判定（手で数を渡す時だけ）」と「切った後に戻す」だけ。測りの 2 module と src/claude-marker-controller.ts は src/test.ts からしか呼ばれない。Claude Code の使用量の読み取りは repo に無い（src/codex-context-measurement.ts の説明に式があるだけ）。
- 帯の閾値が 2 か所に literal で書かれている（src/restart-prepare.ts の `contextSignalFor` と src/context-window-resolution.ts の `BAND_THRESHOLDS`）。確かさの重みと `0.8`・`0.55` の境も 2 か所（src/restart-pack.ts と src/restart-prepare.ts）。標準 S3 の「知識の重複」に当たる。
- 起動の口が 2 本ある: hook の installer が置く src/claude-session-start.ts と、旧来の src/boot.ts。準備した束（selected pack）を consume するのは boot.ts だけで、Claude Code と Codex の native の口は毎回 DB から新しく束を作る。
- 4 つの hook の installer（Claude Code・Codex・Gemini・Antigravity）がほぼ同じ形の写し。標準 S2（3 例目で抽象化）の候補。
- 核の処理が時計を自分で読む（src/restart-prepare.ts:164、src/recovery-context.ts:62）。標準 S4 では呼び手が渡す。

## Interaction Diagrams

### 1. Claude Code の `/clear` での作り直し（今ある部品で起きること）

```mermaid
sequenceDiagram
  participant P as 席（Claude Code）
  participant ST as Stop hook（transcript-stop-capture）
  participant SS as SessionStart hook（claude-session-start）
  participant DB as Kusabi の DB
  P->>ST: 1 回の応答が終わる（async で起動）
  ST->>DB: transcript の末尾を取り込む
  P->>SS: /clear の後、新しい session_id と source=clear
  SS->>DB: 新しい会話の transcript を取り込もうとする
  SS->>DB: 回復の束のための記録を読む
  SS-->>P: additionalContext（最大 1,800 token）
  SS->>DB: recovery_quality_log に記録（届いたかは未確認のまま）
```

文の代わり: 応答が終わるたびに Stop の hook が非同期で transcript の末尾を DB に入れる。`/clear` で新しい会話が始まると SessionStart の hook が source=clear で呼ばれ、新しい会話の transcript（多くは空）を取り込もうとしてから、DB の記録で回復の束を作って返す。最後の応答の取り込み（非同期）と新しい会話の束づくりの、どちらが先かは決まっていない（コードからの推測で、動かして確かめてはいない）。

### 2. Codex の新しい会話（準備した束を使う launcher）

```mermaid
sequenceDiagram
  participant O as 動かす人か監督
  participant R as wasurezu-restart prepare
  participant DB as Kusabi の DB
  participant L as wasurezu-codex-start --fresh-session
  participant C as codex exec --json -
  O->>R: 使用率・モードを渡す
  R->>DB: selected_restart_packs に束を置く
  R-->>O: action と pack_ref
  O->>L: pack_ref を渡して起動
  L->>DB: 束を consume（1 回だけ）
  L->>C: 起動の文を stdin で渡す
  C-->>O: JSON の出力（対話の画面ではない）
```

文の代わり: 準備の CLI が束を DB に置いて `pack_ref` を返す。launcher はその束を 1 回だけ取り出し、`codex exec --json -` に stdin で渡す。この経路は対話の画面を開かない。対話の画面で起こす `--launch` は、起動の文を引数（argv）で渡す。

### 3. Claude Code の新しい会話（準備した束を使う launcher）

```mermaid
sequenceDiagram
  participant O as 動かす人か監督
  participant L as wasurezu-claude-start --fresh-session
  participant C as claude（新しい process）
  participant B as dist/boot.js（SessionStart）
  participant DB as Kusabi の DB
  O->>L: pack_ref を渡して起動
  L->>DB: 束があるかを読む（consume しない）
  L->>C: --settings で SessionStart に boot.js を付けて起動
  C->>B: SessionStart（環境変数 AGENT_MEMORY_BOOT_MODE=restart_pack）
  B->>DB: 束を consume（1 回だけ）
  B-->>C: additionalContext
```

文の代わり: launcher は束の有無だけを確かめ、新しい `claude` を `--settings` 付きで起こす。その SessionStart で src/boot.ts が環境変数から `pack_ref` を受け取り、束を 1 回だけ取り出して返す。今の会話は止めない。
