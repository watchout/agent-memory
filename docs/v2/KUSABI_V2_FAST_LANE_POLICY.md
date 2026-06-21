# Kusabi V2 Fast Lane Policy Draft

Status: draft
Scope: docs-only Lane A operating policy
Base dependency: PR #182 and PR #183
Runtime impact: none

## 1. Purpose

This document defines how to continue the Kusabi V2 reset without waiting for
full Shirube enforcement and without accidentally changing runtime behavior.

The core split is:

```text
Lane A: V2 docs / source reset / naming inventory
Lane B: Shirube governance scaffold and future enforcement
Lane C: runtime, package, MCP, environment, storage, schema, and release migration
```

Lane A can move now. Lane B can remain warn-only until Shirube is ready. Lane C
waits for inventory, owner approval, and tests.

## 2. Lane definitions

| Lane | Scope | Shirube dependency | Allowed claim |
| --- | --- | --- | --- |
| Lane A — V2 docs reset | `docs/v2/**`, source classification, naming inventory, migration boundary, API/data boundary drafts | No enforcement dependency | Draft Kusabi V2 design direction. |
| Lane B — governance scaffold | `.shirube/**`, risk cells, repo policy, agent policy, future audit packets | Depends on Shirube maturity for enforcement claims | Warn-only governance scaffold until promoted. |
| Lane C — compatibility/runtime migration | package, CLI, MCP namespace, env aliases, DB path, schema IDs, workflows, release assets | Governance method may depend on Shirube; implementation itself requires separate owner-approved PRs | Only claim the exact migrated surfaces after tests. |

## 3. Current fast-lane rule

For the current V2 reset phase, agents may draft and revise only:

- `docs/v2/**`;
- `.shirube/**` when explicitly scoped to warn-only governance drafts;
- a minimal README pointer if separately approved.

Agents must not change:

- `src/**`;
- `package.json` or `package-lock.json`;
- `.github/workflows/**`;
- MCP server names or tool namespaces;
- environment variable behavior;
- database path, schema, or migration behavior;
- deployment, publish, branch-protection, or ruleset configuration.

## 4. Recommended PR sequence

1. **Scaffold baseline** — merge or revise PR #182.
2. **Source classification** — review PR #183 and accept/revise labels.
3. **Naming surface inventory** — enumerate current and future naming surfaces.
4. **Fast lane policy** — keep Lane A independent from Shirube enforcement.
5. **V2 API/data boundary** — derive a smaller V2 API/data model from code,
   schemas, and reviewed V1 docs.
6. **Legacy notices** — add short non-invasive notices to reviewed V1 docs.
7. **Compatibility alias plan** — only after inventory and boundary docs are
   accepted.
8. **Runtime/package migration** — separate implementation cells with tests.

## 5. Shirube relationship

Shirube is not a blocker for Lane A. Lane A documents may proceed as draft design
sources while `.shirube/**` remains warn-only.

Shirube does become relevant for stronger claims, such as:

- enforced repo policy;
- enforced agent path/command policy;
- risk-tier gate execution;
- Cell / Spec / Impl / Audit lifecycle enforcement;
- owner/domain-designer approval workflows;
- governance evidence that a human or policy owner promoted memory or approved a
  sensitive action.

Until those are implemented and tested, V2 docs should say `warn-only scaffold`,
`draft policy`, or `future enforcement`, not `enforced governance`.

## 6. Claim boundaries

Allowed now:

```text
Kusabi V2 planning uses `kusabi` as the canonical product name.
Existing `wasurezu` and `agent-memory` surfaces remain compatibility surfaces.
This PR is docs-only and does not change runtime behavior.
```

Not allowed now:

```text
Kusabi has replaced wasurezu operationally.
Shirube enforcement is active.
The MCP namespace is now mcp__kusabi__*.
KUSABI_* environment variables are supported.
The database path has moved to ~/.kusabi.
Codex/Claude recovery is fully automatic in plain MCP mode.
Secret leakage is impossible.
```

## 7. Review checklist for Lane A PRs

A Lane A PR is safe only if all are true:

- changed files are limited to `docs/v2/**` or explicitly approved docs-only
  paths;
- no runtime, package, lockfile, workflow, deployment, or secret/local files are
  changed;
- every new claim is marked draft unless already supported by merged code and
  reviewed evidence;
- `kusabi` is used as the V2 product name, while compatibility surfaces are
  named explicitly;
- source classification or inventory caveats remain visible;
- validation includes `git diff --check` and a scope check.

Suggested validation commands for stacked Lane A work:

```text
git diff --name-only docs/v2-source-classification...HEAD
git diff --check docs/v2-source-classification...HEAD
git diff --check
```

## 8. Fast-lane stop conditions

Stop the fast lane and open a separate owner-approved work order if a request
requires any of the following:

- source code changes;
- behavior changes;
- package or lockfile identity changes;
- MCP namespace or server-key changes;
- environment-variable aliasing or precedence changes;
- storage path, table, migration, backup, or deletion behavior;
- GitHub Actions enforcement;
- package publishing;
- repository rename;
- cross-agent, cross-tenant, or raw transcript access beyond the current scoped
  policy.

## 9. Next design documents after this slice

The next safe Lane A documents are:

- `KUSABI_V2_API_AND_DATA_BOUNDARY.md`;
- `KUSABI_V2_RELEASE_CLAIM_LADDER.md`;
- `KUSABI_V2_SECURITY_AND_RETENTION_BOUNDARY.md`;
- short legacy notices for accepted V1 source classifications.

Each should remain docs-only until the inventory and owner review are complete.
