# Shirube Rapid/Lite Overlay

This repository uses a Shirube Rapid/Lite control-plane overlay.

This overlay has graduated from report-only calibration to CI hard-block enforcement for the repository-local Rapid/Lite workflow. It records machine-readable control state under `.shirube/**` and local guidance under `docs/shirube/**`.

## Authority

LLM output is not authority. GitHub Control source evidence, owner decisions, machine reports, and exact-head evidence are the control inputs.

The source mirror at `.shirube/source-mirrors/control-issue.yaml` is a machine-readable snapshot. It is not a second source of truth.

## Merge Discipline

`BLOCKED` or `would_block=true` means the owner must not merge unless an explicit exact-head pilot exception is recorded.

`PASS_WITH_WARN` requires owner acknowledgement before promotion or enforcement graduation.

## Enforcement State

`ci_hard_block` is active for the repository-local Rapid/Lite workflow. A blocking aggregate now fails that workflow. Graduation to a required check still requires separate owner-approved protected-settings work.

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

The Shirube control runtime is versioned under `.shirube/runtime/rapid-lite/**`, verified against its manifest, and executed from the exact base SHA. It is not product runtime and does not require execution-time access to the private ADF repository.
