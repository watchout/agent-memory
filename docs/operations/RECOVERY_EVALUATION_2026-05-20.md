# Recovery Evaluation Report

- Date: 2026-05-20
- Evaluator: Codex
- Agent: agent-mem-dev
- Project: agent-memory
- DB backend: PostgreSQL
- Sources ingested: codex, claude_code
- Commit SHA: ea1e633f620821cedcdc0bac4753b3b5b9d09cde
- Fresh session tool: SessionStart-equivalent `npm run boot` with `AGENT_MEMORY_BOOT_MODE=restart_pack`
- restart_pack boot: pass
- recovery_quality_log: 8984863a-08d8-4c0a-9361-a904fbd824bd at 2026-05-20 14:59:33+09

## Ground Truth

- Current objective: Run the restart recovery evaluation defined in `docs/operations/RECOVERY_EVALUATION.md`.
- Latest completed work: AM-031 PRs #81, #82, #83, #84, #85, #86, and #87 are merged on 2026-05-20.
- Next expected action: Evaluate restart_pack recovery, fallback conversation search, PR/status accuracy, safety, and memory extraction classification.
- Known blockers: The live MCP server initially rejected `search_memory` with `scope=conversation` because its loaded schema allowed only decisions/tasks/knowledge/messages/all.
- Safety constraints: Do not paste secrets, raw transcript dumps, or private full transcript content into this report.

## Evidence

- Codex ingest: 18 files scanned, 42,353 lines seen, 21,962 events saved, 260 duplicates, 20,131 skipped.
- Claude Code ingest: 13 files scanned, 9,479 lines seen, 1,384 events saved, 0 duplicates, 8,095 skipped.
- Stored conversation events for project: 23,826.
- Direct DB evidence for current prompt: 58 conversation events matched `RECOVERY_EVALUATION`; 11 matched `リスタート復帰テスト`.
- Boot output contained `SESSION RESTART PACK` and logged `{"source":"restart_pack_boot"}`.
- `npx tsx src/test-boot-recovery.ts`: 16 passed, 0 failed.

## Probe Results

| Probe | Summary | Score Notes |
|-------|---------|-------------|
| R1 | restart_pack did not identify the current recovery-evaluation objective; it said no current objective was found. | Fails current objective recovery without fallback. |
| R2 | restart_pack did not provide a next action; the next action had to be inferred from the evaluation document and local commands. | Weak continuity. |
| R3 | GitHub SSOT verified merged PRs #81-#87 and open PRs #68 and #30. restart_pack itself surfaced stale AM-026/PR#68 context. | Accurate only after Level 3 fallback. |
| R4 | `search_memory scope=conversation` failed in the live MCP session due schema mismatch. `scope=all` worked but top results were stale structured memory; direct SQL proved the conversation events exist. | Main recovery gap. |
| R5 | restart_pack redacted the DB URL in its own output and did not dump full transcripts. The evaluation report avoids secrets/raw dumps. | No automatic safety fail observed in restart_pack output. |
| R6 | Needed structured memory is clear: active task for this evaluation, decision that `restart_pack` is not default-ready, knowledge about MCP schema/reload risk, and blocker for conversation-scope availability. | Reconstructable, but not automatically surfaced. |

## Scorecard

| Dimension | Score |
|-----------|-------|
| S1 Current objective recovery | 2/5 |
| S2 Next action quality | 2/5 |
| S3 Status accuracy | 3/5 |
| S4 Conversation search fallback | 1/5 |
| S5 Structured memory reconstruction | 3/5 |
| S6 Safety and uncertainty handling | 4/5 |
| Total | 15/30 |

## Verdict

- Pass level: fail
- Automatic failure triggered: no
- Required fixes:
  - Ensure the running MCP server exposes `search_memory scope=conversation` after AM-031 builds/deploys.
  - Make restart_pack prefer fresh AM-031 conversation context over stale AM-026 structured records when no active task exists.
  - Add or update active `task_state` during restart evaluation so current objective and next action are recoverable.
- Follow-up issues:
  - Add a regression that compares MCP tool schemas in `dist/index.js` with `src/index.ts`.
  - Add evaluation coverage where `restart_pack` is sparse but conversation_events contain the current task.

---

## Post-Fix Retest

- Retest time: 2026-05-20 15:18 JST
- Commit SHA: ea1e633f620821cedcdc0bac4753b3b5b9d09cde plus local changes
- Fresh session tool: SessionStart-equivalent `npm run boot` with PostgreSQL and `AGENT_MEMORY_BOOT_MODE=restart_pack`
- restart_pack boot: pass
- recovery_quality_log: 3972638a-075d-4ac7-87f8-645f3873a73c at 2026-05-20 15:18:05+09

### Changes Under Test

- `src/restart-pack.ts` now tells the agent to use `search_memory scope=conversation` when structured memory is sparse but recent conversation events exist.
- `src/restart-pack.ts` truncates long decision and knowledge lines and labels stale structured decisions as needing verification when conversation fallback is available.
- `src/test.ts` adds coverage for conversation-only restart packs and a source-vs-built MCP schema regression for the `conversation` scope.

### Verification

- `npm test`: 155 passed, 0 failed
- `npx tsc --noEmit`: passed
- `npx tsx src/test-boot-recovery.ts`: 16 passed, 0 failed
- `npm run build`: passed
- Live MCP `search_memory` accepted `scope=conversation` and returned conversation results.
- `npm run boot` with restart_pack mode returned the active recovery retest objective, active task, next action, relevant files, recent conversation summary, and logged recovery quality.
- GitHub SSOT confirmed PRs #81-#87 merged; open PRs are #68 and #30.

### Probe Results

| Probe | Summary | Score Notes |
|-------|---------|-------------|
| R1 | restart_pack identified the active objective: AM-031 fresh-session recovery retest after MCP schema rebuild. | Good continuity from structured task state. |
| R2 | restart_pack gave a concrete next action: verify conversation search, run probes R1-R6, and record a new scorecard. | Actionable, though the saved task state still mentioned the old-session schema issue before this retest proved it fixed. |
| R3 | GitHub SSOT verified merged PRs #81-#87 and open PRs #68/#30. restart_pack still included stale AM-026 decisions/knowledge. | Accurate with Level 3 verification; stale structured memory remains a relevance issue. |
| R4 | Live MCP `search_memory scope=conversation` now works. Results are searchable, but ranking for the PR-status query was noisy. | Main previous blocker fixed; ranking still needs improvement. |
| R5 | restart_pack and report avoided secrets/raw transcript dumps. Redaction remained active in boot output. | No automatic safety fail observed. |
| R6 | Structured memory was updated with an active task for this retest. Remaining memory extraction needs: record the MCP schema reload lesson and stale-memory relevance gap. | Reconstructable and now represented in task state. |

### Scorecard

| Dimension | Score |
|-----------|-------|
| S1 Current objective recovery | 4/5 |
| S2 Next action quality | 4/5 |
| S3 Status accuracy | 4/5 |
| S4 Conversation search fallback | 4/5 |
| S5 Structured memory reconstruction | 4/5 |
| S6 Safety and uncertainty handling | 5/5 |
| Total | 25/30 |

### Verdict

- Pass level: minimum pass
- Automatic failure triggered: no
- Default-ready candidate: no, because this is one passing retest and the standard requires two consecutive fresh-session runs at 26/30 or higher.
- Required fixes before default promotion:
  - Improve conversation search ranking for status queries so PR/status evidence is not buried under low-signal tool events.
  - Reduce stale AM-026 decision/knowledge prominence in restart_pack when a current active task exists for AM-031.
  - Clean up reference extraction so generic tokens such as `Build/tests`, `155/0`, and local path fragments are not treated as PR/issue refs.

---

## Pre-Audit Hardening Retest

- Retest time: 2026-05-20 15:29 JST
- Commit SHA: ea1e633f620821cedcdc0bac4753b3b5b9d09cde plus local changes
- Fresh session tool: SessionStart-equivalent `npm run boot` with PostgreSQL and `AGENT_MEMORY_BOOT_MODE=restart_pack`
- restart_pack boot: pass
- recovery_quality_log: 85149ba6-3be5-4fc1-88d9-1e10adaed268 at 2026-05-20 15:29:02+09

### Additional Changes Under Test

- `restart_pack` relevance now uses the current task title as the structured-memory anchor.
- When the current task contains an AM/PR/issue anchor, unrelated decision/knowledge items are omitted and counted under `STRUCTURED MEMORY CAUTION`.
- Ref extraction now emits only explicit AM/PR/issue refs and ignores completed-task history, local paths, test counters, and generic slash tokens.
- Conversation search ranking now gives higher score to matching user/assistant content and demotes low-signal `token_count` / `turn_context` events in PostgreSQL, SQLite, and JSON stores.

### Verification

- `npm test`: 159 passed, 0 failed
- `npx tsc --noEmit`: passed
- `npm run build`: passed
- `npx tsx src/test-boot-recovery.ts`: 16 passed, 0 failed
- PostgreSQL restart_pack boot returned:
  - current objective: `AM-031 pre-audit recovery hardening and retest`
  - `STRUCTURED MEMORY CAUTION`: 3 stale decision/knowledge items omitted
  - recent decisions: AM-031 decision only
  - refs: AM-031 only
- Direct built-code PostgreSQL `searchMemory(scope=conversation)` no longer returned `token_count` events at the top for the PR-status query. The result is still not a complete PR status answer, so GitHub SSOT remains the correct Level 3 fallback for R3.

### Probe Results

| Probe | Summary | Score Notes |
|-------|---------|-------------|
| R1 | restart_pack identified the current pre-audit AM-031 hardening task. | Strong continuity. |
| R2 | restart_pack gave the exact next action: boot retest, confirm stale structured memory suppression, update report/audit focus. | Actionable and ordered. |
| R3 | restart_pack no longer overpromotes AM-026, but PR status still requires GitHub SSOT for high confidence. | Accurate with explicit fallback boundary. |
| R4 | conversation search works and ranking demotes low-signal event noise in built code. | Improved; live MCP process must be restarted to load the new ranking code. |
| R5 | restart_pack redaction and report safety remain clean; raw transcript content is not dumped. | No safety failure observed. |
| R6 | Structured memory now records task, decision, and knowledge for the retest. The pack explicitly tells agents when structured memory was omitted. | Good reconstruction and uncertainty signaling. |

### Scorecard

| Dimension | Score |
|-----------|-------|
| S1 Current objective recovery | 5/5 |
| S2 Next action quality | 5/5 |
| S3 Status accuracy | 4/5 |
| S4 Conversation search fallback | 4/5 |
| S5 Structured memory reconstruction | 5/5 |
| S6 Safety and uncertainty handling | 5/5 |
| Total | 28/30 |

### Verdict

- Pass level: default-ready candidate run 1/2
- Automatic failure triggered: no
- Audit-ready: yes
- Required before making restart_pack default:
  - Restart the live MCP server so tool-hosted `search_memory` loads the new conversation ranking code.
  - Run one more fresh-session evaluation at 26/30 or higher.
  - Confirm GitHub/agent-comms-side audit standards agree that the `STRUCTURED MEMORY CAUTION` behavior is acceptable.

## Audit Focus

Ask auditors to specifically review:

- Whether the task-title anchor rule is too strict for non-ticketed work, and whether fallback conversation search compensates enough.
- Whether suppressing unrelated structured memory into `STRUCTURED MEMORY CAUTION` avoids stale-context overconfidence without hiding useful context.
- Whether conversation ranking should exclude low-signal event types entirely or only demote them as implemented.
- Whether PR/status probes should always require GitHub SSOT, rather than accepting memory-only answers.
- Whether the score increase from 25/30 to 28/30 is justified under bot-side recovery standards.

## L1 Audit Result

- Auditor: claude-direct / dev-auditor
- Verdict: PASS with INFO
- Blocking issues: none
- Merge gate: clear
- Default-ready promotion: wait for run 2; add one focused probe set before promotion.

### Audit Conclusions

- Task-title anchor filtering is acceptable for ticketed work. For non-ticketed work, the no-anchor path falls back to token overlap, which is considered graceful enough.
- `STRUCTURED MEMORY CAUTION` is acceptable as a first iteration because it avoids stale-context overconfidence and points agents toward targeted search.
- Conversation event demotion is preferred over hard exclusion because metadata events may occasionally carry useful matching context.
- PR/status probes should use memory as context and GitHub as SSOT. A 4/5 score for memory plus explicit GitHub fallback is structurally correct.
- The 28/30 score is conditionally accepted as default-ready candidate run 1/2, with the caveat that this was implementer-led self-evaluation and used a pre-populated active task.

### INFO Items

- Universal policy/convention knowledge may be hidden during ticketed work if it lacks a matching AM/PR/issue anchor. Future improvement: allow tags such as `convention` or `policy` to bypass anchor filtering.
- `STRUCTURED MEMORY CAUTION` currently shows omitted counts only. Future improvement: add light hints such as top tags or time range.
- Ranking semantics are not perfectly identical across PostgreSQL, SQLite, and JSON backends. Future improvement: add cross-backend ranking parity tests.
- The report should explicitly acknowledge self-evaluation bias from evaluator and implementer being the same agent.

### Run 2 Additions

For the next fresh-session run, include these probes:

1. Active task unrelated to AM-031: verify AM-031 decisions/knowledge are suppressed into `STRUCTURED MEMORY CAUTION`.
2. No active task, conversation events only: verify restart_pack surfaces the `search_memory scope=conversation` fallback hint at boot level.
3. No-anchor task title: verify graceful token-overlap recovery for work such as `Implement caching layer`.
4. Multi-anchor task: verify either-anchor matching works for a title such as `AM-031 + PR #84`.
5. Larger memory set: verify `filterRelevant` remains acceptable with more than 100 decisions/knowledge items.
6. Live MCP post-restart R4: verify hosted `search_memory scope=conversation` uses the new ranking code after MCP reload.
7. Safety probe: seed redacted secret-like transcript content and verify restart_pack does not leak it.
8. Cross-backend ranking parity: compare JSON, SQLite, and PostgreSQL top-N ordering for the same query.

## L2 Audit Result

- Auditor: L2 auditor
- Verdict: PASS with INFO
- Blocking issues: none
- AM-031 status: acceptable as default-ready candidate run 1/2

### Verification

- `npm test`: 159 passed, 0 failed
- `npx tsc --noEmit`: passed
- `npx tsx src/test-boot-recovery.ts`: 16 passed, 0 failed
- `git diff --check`: passed
- `npm run build`: user-side evidence says passed; L2 auditor could not independently rerun because sandbox write permission to `dist/` failed before interruption.

### Audit Conclusions

- Task-title anchor filtering is acceptable. Anchor-based stale structured-memory suppression is appropriate for the AM-026 contamination seen in this evaluation.
- `STRUCTURED MEMORY CAUTION` is acceptable and reduces restart-time overconfidence by keeping stale structured memory out of the main pack while pointing to targeted search.
- Conversation search should demote low-signal events rather than exclude them, because low-level metadata may be useful for future investigations.
- PR/status probe scoring at 4/5 with GitHub SSOT fallback is appropriate. Memory-only PR state should not be treated as authoritative.
- The 28/30 score is not overly generous because S3 and S4 remain capped at 4/5.

### INFO Item

- `collectRefs` currently catches compact refs such as `PR#84`, but not common space-separated forms such as `PR #83` or `issue #12`. This is not a blocker for the 28/30 run 1 score, but it should be probed or fixed before default-ready promotion.

### Run 2 Additions From L2

Add these to the next fresh-session run:

1. Active task contains space-separated refs such as `PR #123` and `issue #456`; verify refs are surfaced or document the limitation.
2. Non-ticket active task: verify important knowledge is not hidden too aggressively.
3. Live MCP server restart: verify hosted `search_memory scope=conversation` ranking uses the new code in the actual process.
4. PR/status answer: require GitHub SSOT usage explicitly in the scoring rule before rescoring.

## L3 Audit Result

- Auditor: L3 auditor
- Verdict: conditional PASS
- Blocking issues for candidate run 1/2: none
- Default-ready candidate run 1/2: maintained
- Default-ready promotion blocker: space-separated refs such as `PR #84` and `issue #12` must be extracted before run 2.

### Verification

- `npm test`: 159 passed, 0 failed
- `npx tsc --noEmit`: passed
- `npm run build`: passed
- `npx tsx src/test-boot-recovery.ts`: 16 passed
- `git diff --check`: passed

### Findings

1. Required before default-ready promotion: `collectRefs` extracted compact refs such as `PR#84` and `PR-84`, but did not extract common space-separated refs such as `PR #84` and `issue #12`. This weakens the R3/status probe foundation and needs a regression before run 2.
2. INFO: SQLite conversation ranking fetches `limit * 5` newest candidate rows before JS ranking, so old highly relevant events may still be missed. This is not a PostgreSQL default-evaluation blocker, but cross-backend parity should not be claimed without a probe.
3. INFO: Anchor filtering is acceptable, but policy/convention/security knowledge may need a future bypass.

### Post-L3 Fix

- Status: fixed locally after L3 audit.
- `src/restart-pack.ts` now normalizes space-separated refs before relevance-token and ref extraction:
  - `PR #84` -> `PR#84`
  - `issue #12` -> `issue#12`
- `src/test.ts` now includes regression assertions that restart_pack emits normalized `PR#84` and `issue#12` from an active task containing `PR #84` and `issue #12`.

### Post-L3 Verification

- `npm test`: 161 passed, 0 failed
- `npx tsc --noEmit`: passed
- `npm run build`: passed
- `npx tsx src/test-boot-recovery.ts`: 16 passed, 0 failed
- `git diff --check`: passed

### Post-L3 Approval

- Verdict: LGTM
- Blocking issues: none
- Score: keep 28/30
- Default-ready candidate: keep run 1/2
- Remaining INFO for run 2:
  - SQLite conversation ranking still ranks after fetching the newest `limit * 5` candidates.
  - Non-ticket active tasks should still be probed to ensure anchor filtering does not hide important knowledge.
