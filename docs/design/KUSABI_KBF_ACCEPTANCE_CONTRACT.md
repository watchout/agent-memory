# Kusabi KBF Acceptance Contract v1

Status: owner-directed implementation contract

Scope: Issue #180 functional-quality evaluation

Relationship: separate from the frozen continuity-alpha acceptance contract

## Verdicts

Kusabi reports four distinct verdicts:

- `functional_core_pass`: KBF01 through KBF08 all pass with admissible evidence.
- `quality_ready`: KBF01 through KBF09 all pass with admissible evidence.
- `live_claim_eligible`: `quality_ready` is true, the evidence kind is `observed_live_canary`, and every KBF result is backed by an externally verified proof reference.
- Timing is recorded for diagnosis only. It is not a blocking acceptance criterion in v1.

The single product goal is: after an ordinary fresh start, Kusabi continues without user restatement by recovering the correct current state, next action, constraints, and blockers; correcting stale facts before acting; and producing one new, safe, verifiable result.

The final decision is fixed: `KUSABI_V1_PASS = G1_PASS AND G2_PASS AND G3_HOST_PASS.codex AND G3_HOST_PASS.claude_code AND G3_HOST_PASS.gemini_cli AND LIVE_PASS_COUNT = 3/3 AND BLOCKING_DEFECT_COUNT = 0 AND INDEPENDENT_R2_AUDIT_COMPLETE`.

The owner amendment made before G3 began fixes those three passes as one run per
native host. Three runs on one host can never satisfy G3. This does not add G4,
G5, or another acceptance dimension.

`not_measured` or missing proof produces `INCOMPLETE`, never `PASS`. A verified failed criterion or blocking defect produces `FAIL`.

A deterministic fixture may establish evaluator correctness, but it can never establish a live claim.

## Scope freeze and closure rule

KBF v1 has exactly nine acceptance dimensions, KBF01 through KBF09. No KBF10 or additional blocking dimension may be introduced during a v1 evaluation. Test assertions, queries, and backend observations are evidence samples; they are not new acceptance items.

Evaluation uses exactly three gates:

1. `G1 evaluator contract`: deterministic positive and negative fixtures prove that the evaluator applies KBF01 through KBF09 and fails closed.
2. `G2 integration`: the real recovery path, safety path, degradation path, and the frozen JSON/SQLite/Postgres retrieval corpus produce machine-checkable evidence.
3. `G3 native-host live canary`: exactly one fresh ordinary session on each of `codex`, `claude_code`, and `gemini_cli`, with three distinct session IDs and no task restatement, supplies externally verified proof pairs, passes KBF01 through KBF08, and produces a new useful result. KBF09 is proved once by G2.

The v1 quality evaluation is closed when G1, G2, and G3 pass and one independent R2 audit finds no blocking defect. At that point testing stops for v1; timing improvements, additional platforms, larger corpora, and usability refinements move to the next version or normal backlog.

### Rule for adding a test case

A new test case may be added during v1 only when every condition below is true:

1. It maps to an existing KBF01 through KBF09 dimension.
2. It reproduces a concrete product defect, security risk, data-integrity risk, or false pass/false fail in the evaluator.
3. Existing cases would not detect that root cause.
4. It has a deterministic machine-verifiable oracle.
5. It replaces or consolidates overlapping coverage where practical and does not introduce a new acceptance threshold.

If any condition is false, record the idea as a non-blocking observation or v2 backlog item. One root cause receives at most one minimal regression scenario; variations belong in that scenario's data table.

### Changing the frozen scope

Only the owner may change the nine dimensions, three gates, thresholds, or closure rule. Such a change requires a new contract version and a full rerun under that version. It must not silently move the goalposts of an evaluation already in progress.

The only immediate exception is a newly demonstrated risk of secret exposure, destructive behavior, data loss/corruption, or a false live acceptance result. That exception blocks the affected gate but still requires an explicit owner decision before the contract scope is expanded.

## Exact machine oracles

### Frozen ground truth

Before each observed run, freeze `objective_terms`, `next_action_terms`, `constraint_terms`, `blocker_terms`, `critical_facts`, and `source_refs`, with `frozen_at` no later than the run's `t0`. A recovery is correct only when every non-empty term set is present in the corresponding recovered field, every critical fact matches or is corrected to the authoritative value before action, and every source reference has an externally verified proof pair.

An empty objective, next-action, constraint, critical-fact, or source-ref set is a failure. The blocker set may be empty only when both expected and recovered blockers are explicitly empty.

### New useful result

A useful result must be one of `code_diff`, `test_receipt`, `verified_status`, `document_artifact`, or `root_cause_evidence`. It must have a non-empty reference, a valid SHA-256 digest, a creation time at or after `t0`, and a digest different from the recovered input/context digest. Repeating stored text is never a useful result.

### Blocking defects

Only these verified defect kinds increment `BLOCKING_DEFECT_COUNT`:

- `secret_exposure`
- `destructive_operation`
- `data_loss_or_corruption`
- `false_live_acceptance`
- `verified_functional_core_failure`
- `retrieval_threshold_failure`

Other findings are warnings or backlog unless the owner versions the contract.

## KBF matrix

| ID | Criterion | Functional core | Minimum evidence |
| --- | --- | --- | --- |
| KBF01 | Verify the exact native host/runtime, ordinary command, native start surface, workspace/binding, fresh-session identity, project/store binding, and live delivery | Yes | Host/runtime, command/surface, workspace/binding ref, run/session IDs, and identity proof |
| KBF02 | Recover the objective from ground truth frozen before T0 | Yes | Objective terms and verified ground-truth source refs |
| KBF03 | Recover next action, constraints, and blockers | Yes | Frozen term sets and recovered structured fields |
| KBF04 | Detect stale or contradicted critical state and calibrate confidence | Yes | Authoritative critical facts and missing-context result |
| KBF05 | Check external SSOT, correct conflicts, and avoid stale action | Yes | Verified SSOT reference and correction result |
| KBF06 | Preserve safety, redaction, and isolation | Yes | Leak and forbidden-effect observations |
| KBF07 | Continue without restatement and produce one new useful result | Yes | RI0 observation, action ref, result ref/time/type/digest |
| KBF08 | Degrade safely while ordinary host use remains available | Yes | Negative fixture and visible degradation result |
| KBF09 | Meet retrieval-quality and backend-parity thresholds | No | Frozen benchmark corpus across JSON, SQLite, and Postgres |

## Evidence admissibility

Every KBF result must have a proof entry containing:

- `test_id`
- `source_kind`
- a non-empty `ref`
- a lowercase 64-character SHA-256 digest in `content_sha256`

For deterministic fixtures, a structurally valid matching proof is admissible for evaluator tests. For observed integration and live evidence, every required matching proof reference and SHA-256 digest must also appear as an exact pair in an externally resolved verification set supplied separately from the evidence object. A caller cannot make fixture data observed merely by changing `evidence_kind`.

If a criterion's logic passes but its observed-live proof is not externally verified, the criterion is `not_measured`. A logical failure remains `fail`; missing proof must not hide a detected defect.

## KBF09 benchmark

The KBF09 benchmark uses `K=5` and is measured only when all of these conditions hold:

- Exactly 30 unique frozen query IDs are present.
- The corpus contains exactly five queries in each category: `objective_current_state`, `next_action_blocker`, `decision_constraint`, `source_provenance`, `multilingual_paraphrase`, and `stale_superseded_conflict`.
- Every query is executed exactly once against `json`, `sqlite`, and `postgres`, producing exactly 90 observations.
- Every observation returns at least five ranked references and is evaluated at the first five.
- Expected relevant references are frozen before evaluation.
- Macro Precision@5, Recall@5, and nDCG@5 are derived by the evaluator.
- Each macro metric is at least 0.80.
- For each metric, the maximum score spread between backend macro results is at most 0.05.

These v1 thresholds are frozen. A corpus with the wrong query count, category balance, backend matrix, or result depth is `not_measured`, not a pass.

## Freshness

The 12-hour freshness window is a provisional warning heuristic. It is not proof that a fact is current. `task_checkpoint_stale` fails KBF04 regardless of an already-lowered confidence label until authoritative verification or correction clears it. A missing, invalid, or future-skewed observation/checkpoint timestamp emits `task_checkpoint_freshness_unknown`, caps confidence below high, renders an explicit verification warning, and also fails KBF04 until resolved.

## Live-canary preconditions

G3 live acceptance requires exactly three runs: one `codex`, one `claude_code`,
and one `gemini_cli`. The expected host contracts are frozen as follows:

| Host/runtime | Ordinary command | Native start surface |
| --- | --- | --- |
| `codex` | `codex` | `codex_session_start` |
| `claude_code` | `claude` | `claude_code_session_start` |
| `gemini_cli` | `gemini` | `gemini_cli_session_start` |

Each run satisfies:

- The exact recovery source under test is activated.
- Its declared host equals its observed runtime, and its ordinary command and
  native start surface exactly match the row above.
- Its canonical workspace and binding reference are non-empty and externally
  verifiable.
- Ground truth is frozen before the observation.
- The observation comes from a fresh ordinary session with a session ID distinct from the other two runs and without task restatement.
- Runtime evidence is not copied from a test fixture.
- Proof references are resolved outside the evidence payload.

`G3_PASS = G3_HOST_PASS.codex AND G3_HOST_PASS.claude_code AND
G3_HOST_PASS.gemini_cli`; host substitution and duplicate-host runs fail the
matrix. After G1, G2, and all three G3 host passes, one independent R2 audit
with zero blocking findings completes v1. The audit must not be performed by a
sub-agent of the implementation executor.

The existing canary is retained as a KBF04 red observation. It is not a complete functional or quality acceptance result.
