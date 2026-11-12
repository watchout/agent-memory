# 単位をまたぐ最後の行き先の確かめ — 会話の切り直し（261110-session-rotation）

`aidlc engine sensor-traceability --stage build-and-test` の出力から書いた（2026-11-12、統合された main `94f1ca6d` の記録に対して。要件と受け入れ基準 51 件）。この取り組みは単位が 1 つ（express）で、行き先はすべて作る段（code-generation）。前回（2026-11-11）の 44 件に、PR #342 で足された FR10.1〜FR10.7 の 7 件が加わった。

## 判定

**FAIL** — 行き先の無い ID が 2 件（FR9.2, FR9.3）。作った 46 件、N/A（理由つき）3 件。

未達の 2 件は、作る段の承認の場で「この build に入れない」と知らせた物と同じで、統合の後に Owner の決定を受けて行う要件である。FR10.1〜FR10.7 は 7 件とも行き先がある（FR10.5 の配備の記録の 1 行は、下の「限界」に書く）。

| ID | 状態 | 受け持ち | 行き先の file / N/A の理由 |
|---|---|---|---|
| FR1.1 | 作った | code-generation（単位は 1 つ、express） | src/session-rotation-usage.ts |
| FR1.2 | 作った | code-generation（単位は 1 つ、express） | src/session-rotation-usage.ts |
| FR1.3 | 作った | code-generation（単位は 1 つ、express） | src/session-rotation-stop.ts |
| FR1.4 | 作った | code-generation（単位は 1 つ、express） | src/session-rotation-usage.ts |
| FR2.1 | 作った | code-generation（単位は 1 つ、express） | src/constants.ts |
| FR2.2 | 作った | code-generation（単位は 1 つ、express） | src/rotation-hook-registration.ts |
| FR2.3 | N/A | code-generation | 帯の値（BAND_THRESHOLDS と contextSignalFor の比率）は比率で、切り直しは絶対の量で判定するので帯の判定に触れない。帯の値は直していない（既存の 2 か所の literal は残る。code-summary.md に注記） |
| FR3.1 | 作った | code-generation（単位は 1 つ、express） | src/session-rotation-stop.ts |
| FR3.2 | 作った | code-generation（単位は 1 つ、express） | src/session-rotation-stop.ts |
| FR3.3 | 作った | code-generation（単位は 1 つ、express） | src/session-rotation-stop.ts |
| FR3.4 | 作った | code-generation（単位は 1 つ、express） | src/session-rotation-stop.ts |
| FR4.1 | 作った | code-generation（単位は 1 つ、express） | src/session-rotation-files.ts |
| FR4.2 | 作った | code-generation（単位は 1 つ、express） | src/session-rotation-status.ts |
| FR5.1 | 作った | code-generation（単位は 1 つ、express） | src/rotation-watcher-attempt.ts |
| FR5.2 | 作った | code-generation（単位は 1 つ、express） | src/rotation-watcher-config.ts |
| FR5.3 | 作った | code-generation（単位は 1 つ、express） | src/rotation-watcher-store.ts |
| FR5.4 | N/A | code-generation | 席への据え付け・席ごとの起動 script の登録・席の hook の差し替えは、この PR に入れない要件（守る物）。入れていないことは差分で確かめられる（code-summary.md の「この PR に入れていない物」） |
| FR5.5 | 作った | code-generation（単位は 1 つ、express） | docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md |
| FR5.6 | 作った | code-generation（単位は 1 つ、express） | construction/code-generation/watcher-design.md |
| FR5.7 | 作った | code-generation（単位は 1 つ、express） | construction/code-generation/watcher-design.md |
| FR6.1 | 作った | code-generation（単位は 1 つ、express） | src/claude-session-start.ts |
| FR6.2 | 作った | code-generation（単位は 1 つ、express） | src/codex-session-start.ts |
| FR6.3 | 作った | code-generation（単位は 1 つ、express） | src/session-rotation-start.ts |
| FR6.4 | 作った | code-generation（単位は 1 つ、express） | src/constants.ts |
| FR6.5 | 作った | code-generation（単位は 1 つ、express） | src/session-rotation-stop.ts |
| FR7.1 | 作った | code-generation（単位は 1 つ、express） | src/session-rotation-start.ts |
| FR7.2 | 作った | code-generation（単位は 1 つ、express） | src/mcp-store-readiness.ts |
| FR7.3 | 作った | code-generation（単位は 1 つ、express） | src/index.ts |
| FR8.1 | 作った | code-generation（単位は 1 つ、express） | construction/code-generation/capture-identity-design.md |
| FR8.2 | 作った | code-generation（単位は 1 つ、express） | src/session-start-auto-receive.ts |
| FR8.3 | N/A | code-generation | 動いている常駐と席の hook の差し替えは守る物（展開）で、この PR に入れない。Owner の決定は #339 の追記の返事待ち |
| FR8.4 | 作った | code-generation（単位は 1 つ、express） | src/claude-transcript-identity.ts |
| FR8.5 | 作った | code-generation（単位は 1 つ、express） | src/transcript-stop-capture.ts |
| FR8.6 | 作った | code-generation（単位は 1 つ、express） | src/test-claude-transcript-identity.ts |
| FR9.1 | 作った | code-generation（単位は 1 つ、express） | src/test-session-rotation-scenario.ts |
| FR9.2 | 未達 | — | — |
| FR9.3 | 未達 | — | — |
| FR10.1 | 作った | code-generation（単位は 1 つ、express） | src/hook-input.ts |
| FR10.2 | 作った | code-generation（単位は 1 つ、express） | src/hook-input.ts |
| FR10.3 | 作った | code-generation（単位は 1 つ、express） | src/hook-input-diagnostics.ts |
| FR10.4 | 作った | code-generation（単位は 1 つ、express） | src/hook-input-diagnostics.ts |
| FR10.5 | 作った | code-generation（単位は 1 つ、express） | src/claude-session-start.ts（定数と注釈。`claude --version` の 1 行は配備の記録の手順で、code ではない） |
| FR10.6 | 作った | code-generation（単位は 1 つ、express） | scripts/build-kusabi-content-addressed-runtime-release.mjs |
| FR10.7 | 作った | code-generation（単位は 1 つ、express） | src/hook-node-path.ts |
| NFR1 | 作った | code-generation（単位は 1 つ、express） | src/session-rotation-stop.ts |
| NFR2 | 作った | code-generation（単位は 1 つ、express） | src/session-rotation-stop.ts |
| NFR3 | 作った | code-generation（単位は 1 つ、express） | src/rotation-watcher-tmux.ts |
| NFR4 | 作った | code-generation（単位は 1 つ、express） | construction/code-generation/code-summary.md |
| NFR5 | 作った | code-generation（単位は 1 つ、express） | docs/audit/kusabi-session-rotation-261110.json |
| NFR6 | 作った | code-generation（単位は 1 つ、express） | src/rotation-hook-registration.ts |
| NFR7 | 作った | code-generation（単位は 1 つ、express） | src/constants.ts |

## 行き先の無い要素（段の承認の場で知らせる）

| ID | 内容 | 受け持つ段 | 出る証拠の場所 | 前提 |
|---|---|---|---|---|
| FR9.2 | 統合の後、Owner の決定を受けて Kusabi 自身の席に据え、実際に切り、切った後の最初の応答が残した次の 1 歩に触れるかを確かめる（据え付けの前の `probe`・据え付けの後の実際の起動し直しと確認・host ごとの旧 session_id からの戻し） | deployment-execution（この計画の後ろの段） | 据え付けの記録と読み戻し（その段の出力） | arc-sec の確かめと Owner の決定（守る物）。FR5.4 |
| FR9.3 | 据えた席で、1 歩あたりの量・切った後の取り違い・Owner の促しの回数を数える（数え方は arc が決めた次のとおり。合否の閾値は測った後に arc が決める） | observability-setup（この計画の後ろの段） | 据えた席の測りの記録 | FR9.2 が済んでいること |

どちらも、この build の外の要件で、`確かめていない` のまま次の段に渡る。この段の失敗の決まり（目標が `Not Met`・`Unverified`）には当たらない: 目標の表（`build-and-test-summary.md`）は、作る段の Testing Contract・team.md・要件の NFR から作った物で、FR9.2・FR9.3 は目標ではなく要件であり、ここで未達として表れる。

## 限界（行き先はあるが、この build では確かめていない物）

- FR10.5 の「`claude --version` で取った版と、契約を確かめた版（2.1.220）とのずれを、配備の記録に 1 行で必ず書く」は、配備の健康の確かめの手順（deployment-execution、計画 Step 16.11）で行う。この build では code の側（定数を動かさない・注釈）だけを確かめた。読めない時は「観測できず」と書く。
- FR10.6 の必須の入口の一覧は 12 件（切り直しの 2 つを足した形）で、席の hook の installer 2 つ（`dist/claude-hook-installer.js`・`dist/codex-hook-installer.js`）は今も入っていない。FR10.6 は、これを足すかを arc の指示の外として設計の記録で確かめる、としていた。足していないことは版を作る道具の読み戻し（`required_entrypoint_sha256_map` 12 件）で見える。この build では、足していないという事実を記録するだけで、足すかどうかは決めない。
