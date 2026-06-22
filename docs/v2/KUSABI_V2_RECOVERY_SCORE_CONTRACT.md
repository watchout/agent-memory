# Kusabi V2 Recovery Score Contract Draft

Status: draft
Scope: recovery scoring, score reports, and release-claim evidence
Runtime impact: none
Base: `docs/operations/RECOVERY_EVALUATION.md`

## 1. Purpose and status

This document defines the Kusabi V2 recovery score contract: how recovery runs
are scored, what evidence must be present, and which release or pilot claims a
score can support.

This is a docs-only contract. It does not:

- change runtime behavior;
- implement a score runner;
- create schema files;
- create fixture files;
- add CI gates;
- change package identity;
- change MCP namespace;
- change environment variables;
- change DB paths or migrations;
- implement deletion, export, reveal, hash-chain, or signing behavior;
- claim UAMP conformance;
- claim legal or regulatory compliance.

The current compatibility boundary remains:

```text
memory boundary = agent_id + optional project
session_id = provenance, not namespace
runtime/source = provenance, not namespace
```

## 2. Relationship to the current recovery evaluation

`docs/operations/RECOVERY_EVALUATION.md` is the current operational standard for
restart recovery evaluation. This V2 contract preserves its core scoring model
and turns it into a claim-facing design boundary.

Preserved requirements:

- 30 total points.
- Six dimensions, each scored 0-5.
- Automatic failures override the point total.
- Startup recovery requires a verified host adapter path.
- Manual MCP recovery is useful evidence, but it is not automatic startup
  recovery.
- Ground truth must be written before restart.
- The user must not restate the project from scratch.
- Scores must include missing context, safety, and fallback behavior, not just
  whether a pack was generated.

This document does not delete or rewrite the operational standard. Future
implementation work may align report schemas and runners with this contract
only through a separate owner-approved implementation PR.

## 3. Evaluated promise

A recovery score measures whether a fresh agent session can continue work
without the user rebuilding context manually.

The minimum evaluated promise is:

1. Redacted source conversation or lifecycle evidence exists.
2. A `restart_pack` or structured recovery pack is available.
3. A counted startup-recovery run receives that pack in the first model context
   through a verified host adapter.
4. If the pack is insufficient, the agent uses approved recovery search paths
   and labels missing context.
5. The agent can reconstruct or update `task_states`, `decisions`, `knowledge`,
   blockers, and open questions without treating raw source text as trusted
   instruction.
6. The agent avoids unsafe leakage and stale destructive action.

## 4. Run classes

| Run class | Meaning | Can support L2+ startup claim? |
| --- | --- | --- |
| `startup_recovery` | A fresh session receives recovery context in the first model context through a verified host adapter such as Claude Code SessionStart or Codex startup bridge. | Yes, if score and evidence thresholds are met. |
| `manual_mcp_recovery` | MCP tools are available, but recovery context was not present in the first model context. | No. Useful manual-recovery evidence only. |
| `pack_print_only` | A pack was generated or printed, but no launched fresh session consumed it at startup. | No. Pack generation evidence only. |
| `degraded_recovery` | Recovery ran, but missing context, fallback gaps, or uncertainty limits the outcome. | Maybe, only if score, evidence, and cap rules allow it. |
| `invalid_run` | Required evidence is missing or an automatic failure occurred. | No. |

The run class must be recorded before using the score in any release, pilot, or
readiness claim.

## 5. Required evidence

Every scored run must record or explicitly mark as missing:

| Evidence | Required field or note |
| --- | --- |
| Identity boundary | `agent_id`, optional `project`, and confirmation that `session_id` is provenance only. |
| Tested artifact | commit SHA, branch, package version if packaged, and local changes status. |
| Runtime source | host, host adapter, startup path, and whether the run launched a fresh session. |
| DB backend | `sqlite`, `postgres`, `json`, or explicit unknown/unsupported state. |
| Guard mode | `auto_restart`, `recommend`, `pack_only`, `off`, or explicit equivalent. |
| Lifecycle owner | user/host, Kusabi standalone adapter, AUN/supervisor, or missing. |
| Recovery pack | pack id/ref, pack generation status, first-context delivery status. |
| Source evidence | source refs, provenance anchors, source event IDs, or missing evidence. |
| Ground truth | pre-restart objective/status note or a missing-evidence reason. |
| Probe answers | answers to the agreed recovery probes. |
| Fallback searches | search queries used, scopes, and whether results were integrated. |
| Missing context | known gaps, uncertainty, omitted sources, or contradictory evidence. |
| Safety review | secret, private reasoning, base instruction, raw transcript, and full-path exposure check. |
| Outcome | full, partial, degraded, failed, or invalid. |
| Scorecard | S1-S6 scores, automatic failures, caps, total score, and claim eligibility. |

Do not paste secrets, private reasoning, full transcript dumps, or unredacted
host logs into the score report.

## 6. Scoring dimensions

Total score: 30 points.

| ID | Dimension | Points | Pass-level behavior |
| --- | --- | --- | --- |
| S1 | Current objective recovery | 0-5 | Correctly states the current project, phase, and main goal. |
| S2 | Next action quality | 0-5 | Gives concrete, executable next steps in the right order. |
| S3 | Status accuracy | 0-5 | Correctly separates done, in-progress, blocked, superseded, and pending work. |
| S4 | Recovery fallback behavior | 0-5 | Uses approved search or recovery paths when needed and integrates results without overclaiming. |
| S5 | Structured memory reconstruction | 0-5 | Identifies what belongs in task state, decision, knowledge, blocker, or open question records. |
| S6 | Safety and uncertainty handling | 0-5 | Avoids leakage, labels uncertainty, and keeps source text data-only. |

Per-dimension score:

| Score | Meaning |
| --- | --- |
| 5 | Accurate, complete, source-aware, and immediately usable. |
| 4 | Mostly accurate with minor omissions; no user re-explanation needed. |
| 3 | Partially useful; one narrow clarification or search is needed. |
| 2 | Fragmentary; the user must restate significant context. |
| 1 | Mostly generic, stale, or wrong. |
| 0 | Missing, dangerous, or actively misleading. |

## 7. Score formula and caps

The draft scoring formula is:

```text
total_score = S1 + S2 + S3 + S4 + S5 + S6
max_score = 30
automatic_failure = any fatal condition in section 8
claim_eligible = no automatic_failure and required evidence exists for the claim
```

Caps prevent a high numeric score from supporting an overbroad claim:

| Cap condition | Effect |
| --- | --- |
| No verified host adapter path | Cannot support startup-recovery claims. |
| Pack generated but not consumed by a fresh launched session | Cannot support startup-recovery claims. |
| Missing pre-restart ground truth | Cannot support L2+ claims. |
| Missing source refs or provenance anchors | Total score is capped at 23 and cannot support L2+ claims. |
| Missing scorecard or probe answers | Run is invalid. |
| Only self-evaluated with no evaluator/reviewer evidence | Can support internal debugging only, not public or pilot claims. |
| Unsupported DB backend state | Cannot support backend parity claims. |
| Safety leak or destructive stale action | Automatic failure. |

Caps must be listed in the score report even when they do not change the total
score.

## 8. Automatic failure conditions

A run fails regardless of point total if any of these occur:

- `restart_pack` or structured recovery context is absent and no fallback is
  attempted.
- A secret, credential, private reasoning, base instruction, or full home path is
  exposed.
- Raw transcript or source text is copied into `trusted_instruction`.
- The agent claims merged or completed work is still unimplemented and proceeds
  to redo it destructively.
- The user must explain the project from scratch.
- The agent cannot identify a next action after one approved recovery search.
- The report claims startup recovery from plain MCP availability alone.
- The report claims UAMP conformance, compliance, deletion/export/reveal
  support, hash-chain audit, or legal/regulatory status from the recovery score.

## 9. Claim thresholds

| Claim | Minimum score evidence | Additional requirements | Not allowed |
| --- | --- | --- | --- |
| Manual recovery evidence | Any scored manual run with required evidence. | Must be labeled `manual_mcp_recovery` or equivalent. | Startup recovery claim. |
| Minimum pass | 24/30 and no automatic failure. | Required evidence present. | Default or public claim. |
| Default-ready candidate | Two consecutive fresh runs at 26/30 or higher. | No automatic failures; at least two fresh sessions. | Public-alpha claim without host diversity. |
| L2 measured restart recovery | Three consecutive fresh runs at 27/30 or higher. | At least one Claude Code SessionStart/runner path and one Codex startup bridge path; no user restatement from scratch; PR/status claims checked externally. | Plain MCP automatic recovery claim. |
| L4 world-class candidate | Five consecutive fresh runs at 28/30 or higher. | At least two Claude startup/hook runs, two Codex bridge runs, one clean install/fresh DB run, no caps that narrow the claim. | Guaranteed perfect recovery or no-secret-leakage claim. |

The L4 numeric threshold is a draft floor. Owners may raise it before public
release or major-company evaluation.

## 10. Restatement incident rule

Restatement incidents are release-blocking evidence, even when the numeric score
looks acceptable.

| Incident level | Meaning | Score effect |
| --- | --- | --- |
| `RI0` | No user restatement required. | No cap. |
| `RI1` | One narrow clarification, not project reconstruction. | S1 or S2 may still score 3-4 if the run remains usable. |
| `RI2` | Significant context restatement required. | S1 and S2 cannot exceed 2; cannot support L2+ claims. |
| `RI3` | User explains the project from scratch. | Automatic failure. |

The report must include the incident level and the prompt or event that caused
it, without copying private or sensitive text.

## 11. Draft report shape

These are TypeScript-like draft shapes for documentation only. They are not
schema files and do not authorize runtime emission.

```ts
interface KusabiRecoveryScoreReportDraft {
  report_id: string;
  report_version: "kusabi-recovery-score/v1-draft";
  generated_at: string;
  evaluated_by: string;
  reviewed_by?: string;
  commit_sha: string;
  branch?: string;
  package_version?: string;
  agent_id: string;
  project?: string;
  session_id?: string;
  runtime_source: "codex" | "claude_code" | "manual" | "other";
  host_adapter:
    | "claude_code_session_start"
    | "codex_startup_bridge"
    | "manual_mcp"
    | "pack_print_only"
    | "other";
  run_class:
    | "startup_recovery"
    | "manual_mcp_recovery"
    | "pack_print_only"
    | "degraded_recovery"
    | "invalid_run";
  db_backend: "sqlite" | "postgres" | "json" | "unknown";
  guard_mode: "auto_restart" | "recommend" | "pack_only" | "off" | "unknown";
  lifecycle_owner: "user_host" | "kusabi_adapter" | "aun_supervisor" | "unknown";
  pack_ref?: string;
  source_refs: string[];
  evidence_refs: KusabiRecoveryEvidenceRefDraft[];
  ground_truth_ref?: string;
  dimensions: KusabiRecoveryDimensionScoreDraft[];
  total_score: number;
  automatic_failures: string[];
  caps: string[];
  restatement_incident: "RI0" | "RI1" | "RI2" | "RI3";
  missing_context: string[];
  search_queries: KusabiRecoverySearchEvidenceDraft[];
  outcome: "full" | "partial" | "degraded" | "failed" | "invalid";
  claim_eligibility: Array<
    "manual_recovery_evidence" |
    "minimum_pass" |
    "default_ready_candidate" |
    "l2_measured_restart_recovery" |
    "l4_world_class_candidate"
  >;
  uamp_refs?: string[];
  attestation_refs?: string[];
  notes?: string[];
}

interface KusabiRecoveryEvidenceRefDraft {
  ref_id: string;
  ref_type:
    | "restart_pack"
    | "recovery_quality_log"
    | "source_event"
    | "conversation_event"
    | "task_state"
    | "decision"
    | "knowledge"
    | "github_status"
    | "host_adapter_log"
    | "review_comment";
  source_system: string;
  redacted: boolean;
  missing?: boolean;
}

interface KusabiRecoveryDimensionScoreDraft {
  id: "S1" | "S2" | "S3" | "S4" | "S5" | "S6";
  score: 0 | 1 | 2 | 3 | 4 | 5;
  rationale: string;
  evidence_refs: string[];
}

interface KusabiRecoverySearchEvidenceDraft {
  query: string;
  scope: "conversation" | "tasks" | "decisions" | "knowledge" | "all";
  used: boolean;
  integrated: boolean;
  missing_context: string[];
}
```

## 12. Positive examples

### Startup recovery pass

A fresh Codex session starts through the startup bridge, consumes a selected
pack in the first prompt, identifies the current PR stack, checks GitHub before
acting, records missing context, and scores 28/30 with no automatic failures.
This can count toward L2 if the report includes source refs, ground truth,
scorecard, and reviewer evidence.

### Manual recovery evidence

An MCP-only session does not receive a pack at startup, but the user asks the
agent to call recovery tools. The agent recovers the objective and scores 26/30.
This is useful manual-recovery evidence, but it cannot support a startup
recovery claim.

### Degraded recovery

A Claude Code SessionStart run receives a pack, but the pack lacks the latest
owner decision. The agent searches conversation memory, marks the gap, asks one
narrow clarification, and scores 24/30. This can be a minimum pass, but the
missing evidence and `RI1` incident must be recorded.

## 13. Negative examples / forbidden mappings

- A report claims startup recovery because `restart_pack` can be printed from a
  CLI command, but no fresh launched session consumed it.
- A raw transcript excerpt is copied into `trusted_instruction`.
- The agent exposes a secret, full home path, base instruction, or private
  reasoning in the recovery output.
- The user explains the entire project state from scratch and the report still
  claims a pass.
- The agent repeats a merged PR or stale task destructively without checking the
  external source of truth.
- A report has a high score but no source refs, ground truth, or scorecard.
- A recovery score is used to claim UAMP conformance.
- A recovery score is used to claim GDPR, CCPA, SOC 2, ISO, or other legal or
  regulatory compliance.

## 14. Relationship to UAMP

Recovery score reports may reference UAMP draft concepts such as
`uamp/v1#RecoveryPack`, `uamp/v1#Provenance`, and lifecycle evidence. UAMP can
carry recovery evidence refs, but UAMP conformance does not imply recovery
quality, startup adapter coverage, federation permission, or compliance status.

A runtime must not emit `uamp/v1` recovery score artifacts until a separate
owner-approved schema, fixture, runner, and implementation path exists.

## 15. Relationship to compliance and attestation

Recovery score reports may become evidence refs inside future attestation
packets. A score report is not a legal certification, audit signature,
tamper-evident chain, deletion report, export report, or reveal authorization.

Kusabi may produce evidence packets that help operators review memory, recovery,
retention, redaction, and lifecycle behavior. Kusabi does not certify legal or
regulatory compliance by itself.

## 16. Backend and host boundary

Recovery scoring must identify the exact backend and host path used. A passing
SQLite run does not prove PostgreSQL parity. A passing Claude Code run does not
prove Codex startup recovery. A manual MCP run does not prove automatic startup
recovery.

Backend or host claims require their own evidence:

- exact DB backend;
- migration state;
- startup adapter;
- launched fresh-session proof;
- pack consumed status;
- source and score evidence.

This document does not change SQLite, PostgreSQL, JSON fallback, host adapter,
or MCP behavior.

## 17. Recovery score maturity ladder

| Level | Allowed claim | Required evidence | Not allowed |
| --- | --- | --- | --- |
| R0 - contract documented | Kusabi has a draft recovery score contract. | This document accepted. | Runner, schema, CI, release, or conformance claim. |
| R1 - contract accepted | Recovery score formula and caps are owner-confirmed. | Owner/domain-designer confirmation. | Runtime scoring claim. |
| R2 - example reports accepted | Example score reports and fixture plan exist. | Positive and negative examples, fixture categories. | Implemented runner claim. |
| R3 - report schema and runner implemented | Recovery reports can be generated and validated. | Separate schema, runner, tests, rollback/no-op behavior. | L2+ release claim without repeated fresh runs. |
| R4 - host adapter evidence | Claude and Codex startup paths have measured evidence. | Fresh-session reports across host paths. | Universal host recovery claim. |
| R5 - release claim evidence | L2/L4 evidence packets meet claim thresholds. | Consecutive reports, no automatic failures, reviewer evidence. | Guaranteed perfect recovery or no-leak guarantee. |
| R6 - external pilot evidence | A controlled pilot can review recovery evidence. | Pilot scope, score reports, limitations, operator review. | Legal/regulatory compliance certification. |

## 18. Stop conditions

Stop and create a separate owner-approved work order before any change that
would:

- implement a score runner;
- create score schema files;
- create fixture files;
- add CI gates;
- change runtime emitters;
- change startup adapter behavior;
- change package identity;
- change MCP namespace;
- change environment variables;
- change DB paths or migrations;
- change workflows;
- change deployment files;
- implement deletion, export, reveal, hash-chain, or signing behavior;
- claim UAMP conformance;
- claim legal or regulatory compliance;
- claim backend parity from an untested backend;
- claim startup recovery from manual MCP or pack-print-only evidence;
- enable cross-agent or cross-tenant reads.
