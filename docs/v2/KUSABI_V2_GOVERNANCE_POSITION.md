# Kusabi V2 Governance Position

Status: current
Scope: single statement of which controls apply to this repository and what
authority each one holds
Control source: watchout/agent-memory#304 (CTO verdict
CH-CTO-KUSABI-V2-DESIGN-VERDICT-20260817-002, finding C3)
Last re-declared: 2026-11-20

This file exists because the V2 design set previously declared that `.shirube/**`
was a removed artifact and that readiness did not depend on Shirube, while `main`
had adopted the Shirube overlay and this repository's own seat was issuing
`shirube-v3` audit requests. Two statements of governance disagreed. This is the
one that is kept current; other V2 documents point here rather than restating it.

## Controls that apply

| control | where it lives | authority it holds |
|---|---|---|
| Repository policy | `AGENTS.md` | Direct-delivery and recovery rules for seats working in this repository. |
| Shirube Rapid/Lite overlay | `.shirube/**` (records and the runtime bundle; no workflow runs it) | **Report-only, and no longer reported.** The report workflow was removed on 2026-11-20 (see below), so nothing in this repository posts `would_block` or `owner_must_not_merge` on a pull request. It was never a required check and never blocked merge on its own. |
| Owner exact-head decision | PR comment carrying `shirube-v3/owner_decision/v1` | Required before merge for any change touching a protected surface. |
| Standing merge rule | watchout/agent-memory#301, owner decision of 2026-08-17 | Permits merge without a pre-merge independent verdict for changes that pass the gates, touch no protected surface, stay inside declared paths, and satisfy test coupling. Post-merge audit remains an obligation with revert authority. |
| Immutable release controls | Clean exact HEAD, immutable CAS readback, independent audit, rollback evidence | Governs releases and fleet rollout. |

## What the overlay is, precisely

Adopted 2026-08-16 by PR #303, merge `809c6896`, from the framework pinned at
`watchout/ai-dev-framework@810981f049311cb2fede4f72fff651b1d4e8e04e`.

The workflow checks out the pull request head as the target and the exact
`pull_request.base.sha` as trusted, then executes only
`trusted/.shirube/runtime/rapid-lite/**` after hashing every manifest entry. A pull
request therefore cannot alter the evaluator that judges it. A missing or corrupt
trusted runtime reports `EVALUATOR_UNAVAILABLE`, which is neither an authority
denial nor a pass.

Adoption status is `RAPID_LITE_REPORT_ONLY`. Promotion to `owner_block`,
`ci_hard_block` or `required_check` is separate owner-approved work and has not been
requested.

Removed 2026-11-20: the report workflow `shirube-rapid-lite-gates-report.yml` was deleted under the owner
decision recorded at watchout/iyasaka-arc#49 (comment 7026768954, clean-up item 4). The
paragraphs above stay as the record of the adoption. The runtime bundle and the `.shirube/**` records
remain as files; no workflow runs them.

## What this file does not do

It does not grant the overlay merge authority, change branch protection or required
checks, alter the owner gate for protected surfaces, or restate the API, data or
release contracts. Those remain in their own canonical documents listed by
`KUSABI_V2_CANONICAL_SPEC.md`.

## Keeping it true

Any change to the controls above is recorded here in the same commit that makes the
change. A V2 document that needs to describe governance links to this file rather
than paraphrasing it, so a future contradiction has only one place to appear.
