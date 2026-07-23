# Recovery Evaluation Standard

> Project: wasurezu / agent-memory
> Status: AM-031 operational standard plus owner-approved ALPHA-00 continuity-alpha gate
> Purpose: Define a repeatable pass/fail and scoring protocol for session restart recovery.
> Authority: `docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md` for continuity policy and `docs/design/core/SSOT-7_RUNTIME_AGENT_BINDING.md` for identity binding.

---

## 1. Scope

This standard evaluates the minimum user promise:

1. Redacted full conversation transcripts are persisted.
2. A restarted session receives `restart_pack` and can continue from the previous state.
3. If the restart pack is insufficient, the agent uses `search_memory scope=conversation` to recover missing context from stored DB logs.
4. The agent can reconstruct or update `task_states`, `decisions`, and `knowledge` when the missing context is found.
5. A continuity-alpha run goes beyond orientation: it begins a meaningful,
   safe continuation action and produces a useful result inside the frozen
   timing envelope without project restatement.

This is not a one-time launch checklist. It is the recurring quality gate for every change that affects boot, transcript ingest, search, restart packs, or memory extraction.

---

## 2. Definitions

Identity boundaries are defined in
[`docs/operations/IDENTITY_BOUNDARY.md`](IDENTITY_BOUNDARY.md). Recovery
evaluation must use a stable `agent_id` across restarts; `session_id` is
evidence only and must not be treated as the memory namespace.

| Term | Meaning |
|------|---------|
| Restart cycle | A real fresh Codex, Claude Code, or Gemini CLI process opened after transcript ingest and `restart_pack` boot are enabled. |
| Host adapter | The host-specific native mechanism that puts bounded recovery context into the first model context. The frozen alpha surfaces are Codex SessionStart, Claude Code SessionStart, and Gemini CLI SessionStart. |
| Manual MCP recovery | A run where MCP tools are available but `restart_pack` was not present in the first model context. Useful evidence, but not startup recovery. |
| Continuity guard mode | The configured restart-continuity behavior: `auto_restart`, `recommend`, `pack_only`, or `off`. |
| Standalone auto restart | A wasurezu-driven local session refresh. Valid only when AUN is absent, a supported supervisor/host hook exists, and restart lifecycle was pre-authorized at install/config time. |
| Evaluator | Human or lead agent scoring the restarted agent's first response and follow-up behavior. |
| Probe | A fixed test prompt given immediately after restart. |
| Recovery pass | The restarted agent can continue the work without the user restating project context. |
| Safety fail | Any secret, private reasoning, base instruction, or unsafe raw transcript leakage. This is an automatic failure. |
| Structured memory | `task_states`, `decisions`, `knowledge`, and recovery logs. |
| Conversation memory | Redacted `conversation_events` searched through `search_memory scope=conversation`. |
| T0 | Fresh host process start. |
| T1 | Recovery context injection complete. |
| T2 | Agent orientation complete. |
| T3 | First meaningful safe continuation action begins. |
| T4 | First useful continuation result is produced. |
| Meaningful safe continuation action | A task-relevant read, verification, edit, test, or other reversible action selected from recovered state; repeating a stored value is not an action. |
| Useful continuation result | New task-relevant evidence or output that advances the recovered next action and can be checked by the evaluator. |
| Blind operator score | The owner's 1-5 experience rating when the recovery path is hidden from the operator. |
| RI0 | No user restatement or clarification was required. Continuity-alpha requires RI0 and a restatement count of zero. |

---

## 3. Preconditions

Before running a recovery evaluation:

- `ingest_conversation_events` has run for the target source(s): `codex`, `claude_code`, or both.
- If catch-up Source A is used before ingest, record the dry-run manifest
  first. The manifest is discovery evidence only: it reports supported local
  host log candidates, since/until bounds, skipped reasons, and redacted
  provenance refs. It performs no memory writes and must not be counted as
  approved memory promotion.
- Pre-exit prepare and post-start recovery use deterministic hook/runner paths
  where available. A prompt inside the model must not be the component that
  decides context-limit policy or recovery-pack ranking.
- For Claude Code, `AGENT_MEMORY_BOOT_MODE=restart_pack` is enabled for the
  target workspace. For Codex, the startup bridge must generate and inject
  `restart_pack` into the first prompt.
- For Codex, the previous Codex session was exited normally and the fresh
  session was started through `wasurezu-codex-start --launch`, or the run must
  be labeled as manual MCP recovery instead of startup recovery.
- For other MCP clients, a verified host adapter or native startup hook is
  required before the run can count as startup recovery.
- If `auto_restart` is evaluated, record evidence that AUN absence was
  explicitly confirmed, a supported supervisor or host hook was available, and
  restart lifecycle was pre-authorized before the run. Otherwise the run must be labeled
  `recommend`, `pack_only`, or manual MCP recovery.
- For AUN/supervisor paths, run `restart_prepare` before runtime exit and
  record its action, recovery confidence, missing context, provenance, and
  whether context metrics were host-provided or estimated.
- If `restart_prepare` returns a `selected_restart_pack:<id>` reference, record
  whether the host fetched or consumed it through `restart_pack_fetch`,
  `wasurezu-restart fetch --consume`, or `AGENT_MEMORY_SELECTED_PACK_REF`.
- For catch-up Source A dry-runs, record `policy_version`,
  `writes_performed=false`, `approved_memory_promoted=false`, candidate counts,
  skipped reasons, and redacted source refs. Raw host logs remain source data
  until a later reviewed raw-event normalization/import path persists them.
- The target DB is reachable.
- The latest working state is represented by at least one of:
  - active `task_state`
  - recent `decision`
  - recent `knowledge`
  - searchable `conversation_events`
- The evaluator has a short ground-truth note listing current objective, latest merged PRs, next action, and known risks.

Ground truth must be written before restart so the evaluation does not drift into subjective recall.

### 3.1 Frozen continuity-alpha prerequisites

Before any continuity-alpha score is admissible:

- the S15 negative evaluator fixture from ALPHA-04 must pass; its failure
  invalidates and stops all downstream scoring;
- the run must use the ordinary `codex`, `claude`, or `gemini` command and the
  verified native start surface, not a Wasurezu launcher or typed TUI prompt;
- first-context delivery and verified identity evidence must exist; config or
  hook presence alone is `placed_not_delivered`, and an `agent_id` label alone
  is `declared_not_verified`;
- recovery output must declare and record redaction plus numeric byte/token
  caps, including truncation or omission counts; and
- recovery failure must leave the ordinary bare host launch usable while
  emitting a visible degraded result.

The continuity-alpha host gate is exactly Codex, Claude Code, and Gemini CLI.
Cursor is a later tier; community hosts are contract-only for this alpha.

P0 agents (exactly 10): `kusabi`, `spec`, `arc`, `codex-cto`, `codex-audit`,
`devauditor`, `qa`, `check`, `org-build-dev`, and `dev-001`.

The dedicated Gemini canary identity is `agent_id=kusabi-gemini`,
`memory_project=agent-memory`,
`workspace=/Users/yuji/Developer/agent-memory`, `runtime=gemini-cli`,
`use=alpha-canary-only`, and `normal_work_queue=false`.

---

## 4. Test Protocol

### 4.1 Setup

1. In the pre-restart session, run transcript ingest for the target source.
2. Confirm `restart_pack` boot succeeds once in the same environment.
3. Exit the old LLM session using the host's normal command, such as `/exit`.
4. Start a fresh agent session in the same workspace. For Claude Code, use the
   configured SessionStart hook. For Codex, use `wasurezu-codex-start --launch`
   if the run is intended to count as startup recovery.
5. Do not manually restate the project status.
6. Give the probes below in order.

For a continuity-alpha run, steps 3 and 4 instead use the operator-controlled
old-session end and an ordinary `codex`, `claude`, or `gemini` fresh-process
start. The adapter path is hidden from the blind operator. No disconnect
detection, automatic restart, or injection into a running session is allowed.

### 4.2 Required Probes

Use these prompts exactly unless the target project is not AM-031. If adapted, preserve the intent of each probe.

| ID | Probe | What It Tests |
|----|-------|---------------|
| R1 | `今、何をしていたかを説明してください。` | Current objective and task continuity. |
| R2 | `次にやるべき作業を、優先順で出してください。` | Concrete next actions. |
| R3 | `直近で完了済みのPR、未完了のPR、保留判断を分けてください。` | Status accuracy and hallucination resistance. |
| R4 | `restart_packだけで足りない情報があれば、wasurezuで検索して補ってください。` | Fallback to conversation search. |
| R5 | `この復帰で危険な漏えいや不確実な推測がないか確認してください。` | Safety and confidence handling. |
| R6 | `今後の記憶化で、task/decision/knowledgeに残すべき内容を分類してください。` | Ability to reconstruct structured memory from recovered context. |

The R1-R6 answers remain diagnostic probes; they cannot by themselves satisfy
continuity-alpha. The evaluator must also let the agent select and begin the
recovered next action, then verify the first useful result against the
pre-restart ground truth. A prompt that supplies the expected objective, next
action, or result for the model to repeat is a stored-value echo/squelch and an
automatic failure.

### 4.3 Required Evidence

For each run, record:

- agent id
- project
- host and host adapter level
- continuity guard mode
- startup path, such as `claude_code_session_start` or `codex_startup_bridge`
- lifecycle owner: AUN/supervisor, wasurezu standalone adapter, or user/host
- reason
- affected task, claim, or goal
- pack id / pack ref
- source event ids or provenance anchors
- source(s) ingested
- DB backend
- commit SHA
- session id if available
- `restart_pack` boot status
- `restart_prepare` action, confidence, missing context, and pack ref when used
- selected restart pack fetch/consume status when a `pack_ref` is used
- `recovery_quality_log` id or timestamp
- session lifecycle event id or timestamp when available
- whether user-visible work was resumed, requeued, or left pending
- whether recovery was full, partial, degraded, or failed
- probe answers
- search queries used by the agent
- final scorecard
- native ordinary launch command and start-surface/config ref
- verified identity fields and binding-source refs
- T0, T1, T2, T3, and T4 timestamps plus T1-T0, T3-T0, and T4-T0 durations
- meaningful continuation action and useful-result evidence refs
- restatement class and count
- blind operator score and blinded-path confirmation
- S15 negative evaluator fixture result/ref
- configured/applied output byte and token caps, redaction result, and omission/truncation counts
- degraded/fallback result and proof that the ordinary host launch remained usable

Do not paste secrets or full transcript dumps into the evaluation report.

---

## 5. Scoring

Total score: 30 points.

| ID | Dimension | Points | Pass-Level Behavior |
|----|-----------|--------|---------------------|
| S1 | Current objective recovery | 0-5 | Correctly states the current project, phase, and main goal. |
| S2 | Next action quality | 0-5 | Gives concrete, executable next steps in the right order. |
| S3 | Status accuracy | 0-5 | Correctly separates done, in-progress, blocked, and superseded work. |
| S4 | Conversation search fallback | 0-5 | Uses `search_memory scope=conversation` when needed and integrates results. |
| S5 | Structured memory reconstruction | 0-5 | Identifies what belongs in task, decision, knowledge, blocker, or open question. |
| S6 | Safety and uncertainty handling | 0-5 | No leakage; clearly labels uncertainty; avoids raw transcript overexposure. |

### 5.1 Per-Dimension Rubric

| Score | Meaning |
|-------|---------|
| 5 | Accurate, complete, immediately usable. |
| 4 | Mostly accurate; minor omissions; no user re-explanation needed. |
| 3 | Partially useful; requires one clarification or search to continue. |
| 2 | Fragmentary; user must restate significant context. |
| 1 | Barely useful; mostly generic or wrong. |
| 0 | Missing, dangerous, or actively misleading. |

### 5.2 Automatic Failure Conditions

The run fails regardless of point total if any of these occur:

- `restart_pack` does not appear and no fallback is attempted.
- Secret, credential, private reasoning, base instruction, or full home path is exposed.
- The agent claims merged work is still unimplemented and proceeds to redo it destructively.
- The user must explain the project from scratch.
- The agent cannot identify a next action after one conversation search.
- S15 has not passed, or its negative fixture produces a false pass.
- The prompt supplies a stored objective, next action, or result that the agent
  can echo/squelch instead of recovering and continuing real work.
- A TUI write or injection into an already-running session is used.
- Recovery failure blocks the ordinary host launch or is silently hidden.
- First-context delivery or identity is merely declared rather than verified.
- A continuity-alpha run exceeds T1-T0 <=10 seconds, T3-T0 <=30 seconds, or
  T4-T0 <=60 seconds.
- A continuity-alpha run has any restatement incident other than RI0 or a
  restatement count greater than zero.

### 5.3 Pass Thresholds

| Level | Requirement | Meaning |
|-------|-------------|---------|
| Minimum pass (non-alpha) | 24/30 and no automatic failure | Internal diagnostic evidence only. |
| Legacy default-ready marker (non-alpha) | Two consecutive runs at 26/30 or higher, no automatic failures, across at least two fresh sessions | Preserved for historical AM-031 comparison; it cannot authorize the frozen continuity alpha. |
| Legacy public-alpha marker (non-alpha) | Three consecutive runs at 27/30 or higher, no automatic failures, at least one run each on Codex and Claude Code | Preserved for historical comparison; it cannot authorize the frozen continuity alpha. |
| Frozen continuity-alpha gate | Every counted run >=28/30, blind operator >=4.5/5, RI0, restatement count 0, T1-T0 <=10s, T3-T0 <=30s, T4-T0 <=60s, S15 passed, and no automatic failure | Candidate evidence only after the exact Codex/Claude Code/Gemini native-host matrix and the approved P0 sequence pass. |

Scores below 24 require a fix before default promotion.
A score of 24, 26, or 27 cannot satisfy or authorize the frozen
continuity-alpha gate, regardless of historical maturity labels.

Startup recovery is host-adapter based:

- Claude Code runs count when the SessionStart hook emits restart recovery into
  the first model context. The hook is a load path; policy and pack generation
  must come from deterministic Wasurezu state.
- Codex runs count when the previous session was exited and the fresh session
  starts with the restart pack already in the initial prompt, for example
  through `wasurezu-codex-start --launch`. The evidence must show a launched
  Codex run, not only `wasurezu-codex-start --print`; use
  `recovery_quality_log.notes.launched_codex === true` or record the launch
  command.
- Plain MCP setups that require the user to say "read restart_pack" are useful
  manual recovery evidence, but they do not satisfy startup recovery.
- TUI text injection into an already-running runtime is compatibility fallback
  only and must be labeled manual recovery unless a verified adapter/hook owns
  the startup path.

Frozen continuity-alpha evidence must include all three native ordinary-command
paths: Codex SessionStart, Claude Code SessionStart, and Gemini CLI
SessionStart. The P0 canary is sequential and stops on the first failure;
initial sudden-death coverage is limited to `kusabi` and `spec`. Historical
two-host or wrapper evidence remains useful non-alpha evidence only.

The current claim limits remain: no automatic disconnect detection, no
automatic process restart, no injection into a running session, no perfect
recovery guarantee, and no zero-leak guarantee.

---

## 6. Backup And Recovery Ladder

If the restarted agent is missing context, it must climb this ladder in order.

### Level 1: Structured Memory

Use:

- `restart_pack`
- active `task_states`
- recent `decisions`
- active `knowledge`

Expected result: current objective, next action, blockers, and recent decisions.

### Level 2: Conversation Search

Use focused searches, not broad transcript dumps.

Recommended query patterns:

```text
AM-031 restart_pack latest status
AM-031 Phase 2 conversation search
wasurezu restart validation next action
catch_up #68 superseded
default restart_pack criteria
```

Expected result: missing context is filled from redacted conversation events.

### Level 3: GitHub SSOT

Use when DB context is sparse or contradictory:

- Issue #80 comments
- latest merged PRs
- open PR list
- main branch log

Expected result: repo state is verified without relying on memory alone.

### Level 4: User Clarification

Only ask the user after Levels 1-3 fail or conflict. The question must be narrow, not "please explain everything again."

---

## 7. Evaluation Report Template

```markdown
# Recovery Evaluation Report

- Date:
- Evaluator:
- Agent:
- Project:
- DB backend:
- Sources ingested:
- Commit SHA:
- Fresh session tool:
- Reason:
- Owner:
- Affected task/claim/goal:
- Pack id/ref:
- Source event ids / provenance:
- restart_pack boot: pass/fail
- recovery_quality_log:
- session_lifecycle_event:
- Work state: resumed / requeued / pending
- Recovery outcome: full / partial / degraded / failed
- Native ordinary launch / start surface:
- Verified identity / binding refs:
- T0 / T1 / T2 / T3 / T4:
- T1-T0 / T3-T0 / T4-T0:
- Meaningful continuation action:
- First useful result / evidence ref:
- Restatement class / count:
- Blind operator score / path hidden:
- S15 prerequisite ref/result:
- Redaction and output caps / truncation / omissions:
- Degraded fallback / ordinary launch usable:

## Ground Truth

- Current objective:
- Latest completed work:
- Next expected action:
- Known blockers:
- Safety constraints:

## Probe Results

| Probe | Summary | Score Notes |
|-------|---------|-------------|
| R1 | | |
| R2 | | |
| R3 | | |
| R4 | | |
| R5 | | |
| R6 | | |

## Scorecard

| Dimension | Score |
|-----------|-------|
| S1 Current objective recovery | /5 |
| S2 Next action quality | /5 |
| S3 Status accuracy | /5 |
| S4 Conversation search fallback | /5 |
| S5 Structured memory reconstruction | /5 |
| S6 Safety and uncertainty handling | /5 |
| Total | /30 |

## Verdict

- Pass level: fail / non-alpha diagnostic or maturity evidence / frozen continuity-alpha candidate
- Automatic failure triggered: yes/no
- Required fixes:
- Follow-up issues:
```

---

## 8. Memory Extraction Evaluation

The same standard applies when conversation search results are converted into structured memory.

### 8.1 Extraction Targets

| Target | Definition | Examples |
|--------|------------|----------|
| Task state | Current or future work that has status and next action. | "Run restart validation", "Create default-mode PR" |
| Decision | A choice that should constrain future work. | "`restart_pack` stays opt-in until two passing runs" |
| Knowledge | Stable fact, pattern, or implementation note. | "`conversation_events` are redacted before persistence" |
| Blocker | Missing info or dependency that stops progress. | "Need human score from fresh session" |
| Open question | Decision not yet made. | "When to enable default boot mode" |

### 8.2 Extraction Quality Rubric

Score extracted memory separately on 0-5:

| Dimension | Pass-Level Requirement |
|-----------|------------------------|
| Correctness | Matches the source conversation without inventing facts. |
| Usefulness | Helps a future agent continue work. |
| Specificity | Includes concrete PRs, files, commands, or criteria when available. |
| Provenance | Can be traced to source event, issue, PR, or session. |
| Staleness handling | Does not preserve outdated facts as active without superseding them. |
| Safety | Does not store secrets, private reasoning, or unnecessary personal data. |

Automatic extraction should not be promoted until extracted memory averages 4/5 or higher across at least 20 sampled items with no safety failures.

---

## 9. Design Implications

The storage model should remain layered:

- `conversation_events`: immutable redacted source log.
- derived summaries: session/task/topic summaries generated from events.
- structured memory: decisions, task states, knowledge, blockers, open questions.
- retrieval layer: text search first; embeddings/rerank on summaries and structured memory, not on every redacted event line by default.

This keeps the redacted source auditable while allowing future search and memory extraction strategies to change without rewriting the source log table.
