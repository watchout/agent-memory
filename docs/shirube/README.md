# Shirube Rapid/Lite Overlay

This repository uses a Shirube Rapid/Lite control-plane overlay.

## Current State

The repository-local Rapid/Lite workflow (`shirube-rapid-lite-gates-report.yml`) was deleted on 2026-11-20 under the owner decision recorded at watchout/iyasaka-arc#49 (comment 7026768954, clean-up item 4). The "Removed 2026-11-20" paragraph of `docs/v2/KUSABI_V2_GOVERNANCE_POSITION.md` is the record of that removal. Nothing in this repository now runs the overlay's runtime or posts its report on a pull request. The records under `.shirube/**`, including `.shirube/enforcement-policy.yaml` and the runtime bundle under `.shirube/runtime/rapid-lite/**`, remain as files and were not changed by the removal. As read from the branch protection settings of `main` on 2026-11-20, the required checks are the three `build-and-test` jobs of `ci.yml` (Node 18, 20 and 22) and nothing else.

The sections below keep the description of the overlay as adopted. Sentences about the workflow are in the past tense; the rest is unchanged.

Until the removal, this overlay had graduated from report-only calibration to CI hard-block enforcement for the repository-local Rapid/Lite workflow. It records machine-readable control state under `.shirube/**` and local guidance under `docs/shirube/**`.

## Authority

LLM output is not authority. GitHub Control source evidence, owner decisions, machine reports, and exact-head evidence are the control inputs.

The source mirror at `.shirube/source-mirrors/control-issue.yaml` is a machine-readable snapshot. It is not a second source of truth.

## Merge Discipline

While the repository-local Rapid/Lite workflow existed, `BLOCKED` or `would_block=true` failed it, and the owner must not merge. An owner exception alone was insufficient, and this policy permitted no CI-hard-block waiver.

`PASS_WITH_WARN` requires owner acknowledgement before promotion or enforcement graduation.

## Enforcement State

Until the removal, `ci_hard_block` was active for the repository-local Rapid/Lite workflow and a blocking aggregate failed that workflow. Graduation to a required check still requires separate owner-approved protected-settings work.

This overlay does not enable required checks, branch protection, rulesets, production behavior, AUN automation, or external repo mutation.

## Control State Completeness

Full control requires the Control State Completeness gate to pass. A repo with partial metadata must not claim V3 complete, enforced, fully controlled, or required-check protected status.

## Adoption PR Scope

The adoption PR must not mix runtime, API, DB, package, deploy, branch protection, ruleset, or required-check changes.

Allowed adoption paths:

- `.shirube/**`
- `docs/shirube/**`
- `.github/workflows/shirube-rapid-lite-gates-report.yml` and `.shirube/runtime/rapid-lite/**` only when an approved local workflow runtime slice generated them

Forbidden in the adoption PR:

- `scripts/shirube/**`
- `src/**`
- `app/**`
- `api/**`
- `lib/**`
- `db/**`
- `migrations/**`
- package or lock files
- `.env*`
- deploy or production files
- branch protection, ruleset, or required-check changes

The Shirube control runtime is versioned under `.shirube/runtime/rapid-lite/**`. While the workflow existed, it was verified against its manifest and executed from the exact base SHA; no workflow runs it now. It is not product runtime and does not require execution-time access to the private ADF repository.
