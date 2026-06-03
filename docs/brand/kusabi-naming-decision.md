# Kusabi Naming Decision and Transition Plan

Date checked: 2026-06-03

Issues: #128, #130, #131

This document is a planning record only. It does not change runtime code,
package identity, MCP server or tool namespaces, database paths, installed
config defaults, or startup recovery instructions.

## Decision

Use `Kusabi` as the working external product name.

Use this transition wording where both the public name and compatibility name
matter:

```text
Kusabi (wasurezu compatibility name)
```

`wasurezu` remains the compatibility identity until explicit follow-up issues
change a specific surface.

`memory governance layer` is category and positioning language. It is not part
of the fixed product name unless separately approved later.

## Compatibility Statement

- Existing `mcp__wasurezu__*` tool namespace remains supported.
- MCP server default remains `wasurezu` during migration.
- CLI `wasurezu` remains supported.
- Existing DB paths remain stable.
- Existing AGENTS.md / Codex / Claude startup recovery instructions remain
  valid.
- AUN/Shirube/Kodama references migrate only through explicit follow-up issues.

## Availability Evidence

These checks are early planning evidence, not legal clearance and not package or
repository ownership proof.

| Surface | Check | Result | Decision impact |
| --- | --- | --- | --- |
| npm unscoped package | `npm view kusabi name version description --json` | Registry returned E404. | Appears unclaimed enough for planning, but unscoped package is not preferred for the first transition because it is harder to tie to organization ownership. |
| npm scoped package | `npm view @iyasaka/kusabi name version description --json` | Registry returned E404. | Preferred future package identity if package ownership and publishing authority are secured. |
| npm scoped package | `npm view @watchout/kusabi name version description --json` | Registry returned E404. | Acceptable fallback if `@iyasaka` publishing authority is unavailable. |
| GitHub target repo | `gh repo view watchout/kusabi` | Repository was not found. | `watchout/kusabi` appears available enough for planning. No repo rename is approved by this document. |
| GitHub public search | `gh search repos kusabi --limit 20` | Several public repos/users already use `Kusabi` or `kusabi`, including unrelated repos and a `kusabi` namespace. | Do not assume global uniqueness. Prefer scoped/package-qualified usage and keep compatibility wording during transition. |
| MCP name collision | Local repo scan for MCP surfaces | Current governed profiles and MCP tools use `wasurezu.*` / `mcp__wasurezu__*`. | Do not introduce a `kusabi` MCP namespace until an explicit alias/default-switch issue installs and tests it. |
| Basic trademark/web check | USPTO public trademark search entry point and web search | No legal clearance performed; only a basic collision screen. | Continue with `Kusabi` as a working product name, but require formal clearance before broad public launch if risk profile changes. |

Useful references for future clearance:

- npm package registry: `https://registry.npmjs.org/kusabi`,
  `https://registry.npmjs.org/@iyasaka%2fkusabi`,
  `https://registry.npmjs.org/@watchout%2fkusabi`
- GitHub search: `https://github.com/search?q=kusabi&type=repositories`
- USPTO trademark search: `https://www.uspto.gov/trademarks/search`
- Cornell Wex trademark search overview:
  `https://www.law.cornell.edu/wex/trademark_search`

## Package Scope Preference

Preferred future package identity: `@iyasaka/kusabi`.

Reasoning:

- `Kusabi` is the external product name, while IYASAKA is the product owner
  language already used in project docs.
- A scoped package is clearer than taking an unscoped generic word.
- A scoped package leaves `wasurezu` compatibility intact while allowing a
  future additive alias package or wrapper if explicitly approved.

Fallback: `@watchout/kusabi` if `@iyasaka` npm organization ownership,
automation, or publishing authority cannot be secured.

Not selected for this phase: unscoped `kusabi`. It appears unclaimed on npm at
the time checked, but it has higher collision and ownership ambiguity.

No package rename, new package publish, npm ownership action, or package default
switch is approved by this document.

## Why Kusabi Fits

`Kusabi` means a wedge or anchor-like fixing point. That maps well to the
product role: it fixes continuity, provenance, recovery packs, and memory
governance boundaries across agent sessions without pretending to own every
runtime lifecycle.

The name is short, distinctive in the current project set, and can carry both
the continuity-control-plane and memory-governance positioning without making
the category phrase part of the product name.

## Why Shiori Is Rejected

`Shiori` is rejected for now due collision risk.

Evidence checked on 2026-06-03:

- npm has an existing `shiori` package.
- npm has related active packages such as `@shiori-sh/cli`.
- GitHub search shows established Shiori projects, including a bookmark manager
  ecosystem and other software projects.

This does not mean `Shiori` is legally unavailable, but it is a poor working
name for this rename path because the collision cost is already visible.

## Cross-Repo Reference Policy

During transition, classify references before editing them:

| Reference class | Examples | Migration recommendation |
| --- | --- | --- |
| Public brand copy | Product overview, external announcement, README prose after alias support exists | Use `Kusabi (wasurezu compatibility name)` until users have tested alias paths. |
| Operational MCP/tool instruction | `mcp__wasurezu__recover_context`, governed action surface IDs, MCP config examples | Keep exact `wasurezu` names unless the new MCP namespace is actually installed and tested. |
| Package/install instruction | `npm install -g wasurezu`, package name, npm bin names | Keep existing instructions until #129 or a later package/config PR adds a tested alias. |
| DB/config/path reference | `~/.agent-memory/memory.db`, `AGENT_MEMORY_DB_PATH`, installed MCP server key | Do not rewrite. Paths and env vars are compatibility surfaces. |
| Internal architecture reference | SSOTs, recovery pack schemas, governance docs, AUN/Shirube/Kodama specs | Prefer compatibility wording and preserve authority boundaries. |

Repos/products to audit before any broad migration:

- `watchout/agent-memory`
- `watchout/agent-comms-mcp` / AUN
- `watchout/ai-dev-framework` / Shirube
- `watchout/kodama`
- `watchout/aun-platform`
- `iyasaka-arc` cross-cutting specs and runbooks
- Installed AGENTS.md templates and examples
- Codex and Claude startup/recovery docs

No operational instruction should be rewritten to an unavailable tool name.
AUN/Shirube/Kodama migration issues should be created only when the target repo
has a concrete reference class that needs changing.

## Package, MCP Server, and Config Transition Plan

This plan defines gates. It does not switch defaults.

Before any default switch:

- `kusabi` and `wasurezu` CLI aliases both work.
- Existing `wasurezu` CLI/bin behavior is unchanged.
- Startup recovery works with documented configs.
- AGENTS.md instructions are updated only when the installed MCP namespace
  exists.
- AUN/Shirube/Kodama references are migrated or compatibility-worded.
- DB path migration is avoided, or handled by an explicit migration command.
- Package ownership is secured.
- Explicit approval is recorded.

Default policy for now:

- npm package name remains `wasurezu`.
- Default MCP server name remains `wasurezu`.
- MCP tool namespace remains `mcp__wasurezu__*`.
- Default DB path remains unchanged.
- Existing startup recovery docs remain authoritative.

Possible future states:

| Surface | Near-term state | Later option | Required gate |
| --- | --- | --- | --- |
| CLI | Additive `kusabi` alias only in #129 if cleanly supported | `kusabi` becomes documented primary command | Smoke tests prove `wasurezu` compatibility and startup docs are updated safely. |
| npm package | `wasurezu` remains package identity | Publish scoped alias/wrapper package | Scoped ownership, approval, install tests, rollback path. |
| MCP server key | `wasurezu` remains recommended default | Optional `kusabi` server key | Installed config migration tooling and host compatibility tests. |
| MCP tool namespace | `mcp__wasurezu__*` remains authoritative | Optional namespace alias | Explicit MCP contract issue, tests, and AUN/Shirube/Kodama reference migration. |
| DB path | Existing path remains stable | Avoid migration unless required | Explicit migration command, backup/rollback, and user approval. |

## Rollback Policy

Any future alias/default-switch PR must be reversible:

- Keep `wasurezu` binaries and MCP namespace available.
- Do not delete or move existing DB files as part of alias rollout.
- Prefer additive docs and aliases before any deprecation.
- If an alias breaks startup recovery, revert alias documentation first and keep
  compatibility commands as the operator path.

## Follow-Up

- #129: alias-only CLI/bin and docs compatibility PR.
- #130: cross-repo changes only after repo-specific issues identify exact
  reference classes.
- #131: package/config/default switch remains planning-only until all gates are
  satisfied and approval is recorded.
