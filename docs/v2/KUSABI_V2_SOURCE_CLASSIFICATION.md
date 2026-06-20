# Kusabi V2 Source Classification Draft

Status: draft  
Scope: source classification only  
Base dependency: PR #182 (`v2/kusabi-reset`)  
Runtime impact: none

## 1. Purpose

This document classifies existing V1 / transitional design sources before any deletion, large rewrite, runtime rename, or behavior-changing implementation.

It is intentionally additive. It does not modify the classified files. It gives the repository owner/domain-designer a reviewable map for deciding what remains canonical for Kusabi V2, what is supporting evidence, and what should eventually become legacy or archive-only.

## 2. Classification labels

| Label | Meaning | Allowed next action |
| --- | --- | --- |
| `v2-canonical-draft` | Proposed V2 authority, not final until owner-confirmed and merged. | Review, revise, then promote to V2 canonical. |
| `v2-governance-draft` | Warn-only governance source for V2 planning. | Review with Shirube / repository owner. |
| `v2-supporting-evidence` | Useful historical or implementation evidence, but not a V2 authority by itself. | Link from V2 docs where relevant. |
| `legacy-v1` | V1 or transitional source that may be stale, broad, or name-mixed. | Keep until replacement exists; add superseded note later. |
| `superseded-for-v2` | V2 docs should override this source for a specific area. | Do not delete yet; mark as superseded in a later PR. |
| `archive-only-candidate` | Likely historical only after review. | Move/archive only after owner decision. |
| `pending-review` | Not fully read or not classified enough for action. | Read before editing or deleting. |
| `do-not-edit-in-v2-planning` | Non-doc/runtime or operational file outside the V2 planning slice. | Leave untouched until separate work order. |

## 3. Current V2 draft authority

| Path | Classification | V2 authority area | Notes |
| --- | --- | --- | --- |
| `.shirube/repo-spec.yaml` | `v2-governance-draft` | Repository governance, memory/data boundary, allowed scope | Owner confirmed as the draft governance base for PR #182. |
| `.shirube/agent-policy.yaml` | `v2-governance-draft` | Agent path/command/memory policy | Warn-only; not enforcement. |
| `.shirube/cells/CELL-MEMORY-001.yaml` | `v2-governance-draft` | Memory data classification | Draft Cell candidate. |
| `.shirube/cells/CELL-MEMORY-002.yaml` | `v2-governance-draft` | Memory read/write policy | Draft Cell candidate. |
| `.shirube/cells/CELL-MEMORY-003.yaml` | `v2-governance-draft` | User/session/tenant boundary | Draft Cell candidate. |
| `.shirube/cells/CELL-MEMORY-004.yaml` | `v2-governance-draft` | Retention / TTL / deletion | Draft Cell candidate. |
| `.shirube/cells/CELL-MEMORY-005.yaml` | `v2-governance-draft` | Memory audit log | Draft Cell candidate. |
| `.shirube/cells/CELL-MEMORY-006.yaml` | `v2-governance-draft` | Stored source text remains data-only | Draft Cell candidate. |
| `docs/v2/README.md` | `v2-canonical-draft` | V2 draft index | Points to proposed V2 source set. |
| `docs/v2/KUSABI_V2_CANONICAL_SPEC.md` | `v2-canonical-draft` | V2 product/design authority | Primary proposed V2 source. |
| `docs/v2/KUSABI_V2_MIGRATION_BOUNDARY.md` | `v2-canonical-draft` | Compatibility and migration boundary | Keeps runtime/package/MCP/env/DB rename out of initial slice. |
| `docs/v2/KUSABI_V2_REPO_AUDIT.md` | `v2-canonical-draft` | Audit caveats and cleanup backlog | Records incomplete read coverage and known drift. |
| `docs/v2/KUSABI_V2_SOURCE_CLASSIFICATION.md` | `v2-canonical-draft` | Source classification | This file. |

## 4. Reviewed V1 / transitional sources

| Path | Classification | V2 handling | Reason |
| --- | --- | --- | --- |
| `README.md` | `v2-supporting-evidence` | Keep unchanged until package/MCP migration plan exists. | Public docs currently explain `wasurezu` with `Kusabi` alias and compatibility boundary. |
| `docs/design/SOURCE_ALIGNMENT.md` | `superseded-for-v2` for source-set authority; `v2-supporting-evidence` for provenance | Replace source-set authority with `docs/v2` after review; keep as historical provenance. | It lists a broad active source set and preserves `wasurezu` operational compatibility. |
| `docs/brand/kusabi-naming-decision.md` | `v2-supporting-evidence`; partially `superseded-for-v2` for naming authority | Keep as transition history; V2 canonical name lives in `docs/v2/KUSABI_V2_CANONICAL_SPEC.md`. | It introduced Kusabi as alias/working external name, not full V2 product authority. |
| `docs/requirements/SSOT-0_PRD.md` | `legacy-v1` | Do not delete; later mark as legacy or refresh from V2. | Contains old milestones, V1 naming, and stale implementation status in places. |
| `docs/requirements/SSOT-1_FEATURE_CATALOG.md` | `legacy-v1` | Do not delete; later replace with V2 feature inventory. | Contains mixed historical feature table and later additions. |
| `docs/design/core/SSOT-3_API_CONTRACT.md` | `v2-supporting-evidence` | Keep as implementation evidence; V2 API contract should be rewritten after inventory. | Useful API surface inventory but still V1/transitional naming and broad authority. |
| `docs/design/core/SSOT-4_DATA_MODEL.md` | `v2-supporting-evidence` | Keep as implementation/schema evidence; V2 data model should derive from reviewed code and governance. | Useful table descriptions but mixes current, planned, and transitional semantics. |
| `docs/design/core/SSOT-5_CROSS_CUTTING.md` | `v2-supporting-evidence` | Keep for security/error/logging evidence; V2 cross-cutting source should be smaller. | Contains valuable constraints but may conflict with later implementation/defaults. |
| `docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md` | `v2-supporting-evidence` | Preserve core continuity principles in V2, but do not treat as sole V2 authority after reset. | Strong ownership and lifecycle boundary source; still `Wasurezu`-named. |
| `docs/design/core/SSOT-7_RUNTIME_AGENT_BINDING.md` | `v2-supporting-evidence` | Preserve identity principles in V2, especially `agent_id + optional project`. | Strong runtime identity boundary; still V1/transitional. |
| `docs/design/governance/WASUREZU_MEMORY_SAFETY_GOVERNANCE.md` | `v2-supporting-evidence` | Preserve taxonomy and data-only rules; migrate naming later. | Important memory safety source but V1-named. |
| `docs/operations/HOST_ADAPTERS.md` | `v2-supporting-evidence` | Preserve host boundary concepts; V2 host docs need later rewrite. | Useful support matrix and lifecycle boundary; still V1/transitional. |

## 5. Pending review sources

These areas must be read before classification-dependent edits or deletion:

| Path pattern | Classification | Required before action |
| --- | --- | --- |
| `docs/design/schemas/**` | `pending-review` | Read schema IDs, refs, compatibility promises, and generated artifact expectations. |
| `docs/design/governance/**` excluding the memory safety doc above | `pending-review` | Review governed action profiles, evidence refs, and schema/profile relationships. |
| `docs/operations/**` excluding `HOST_ADAPTERS.md` | `pending-review` | Review release gates, recovery evaluation, common DB, identity, and conveyor docs. |
| `docs/OSS_EVALUATION_FRAMEWORK.md` if present | `pending-review` | Decide if it remains V2 release evidence or legacy evaluation. |
| `templates/**` | `pending-review` | Check for operational instructions, hooks, and legacy names before editing. |
| `scripts/**` | `pending-review` | Check host adapter scripts and internal seed/migration utilities before rename. |
| `tests/**` | `pending-review` | Review coverage before claiming behavior or migration readiness. |
| `src/test*.ts` | `pending-review` | Review test expectations before runtime rename or behavior changes. |

## 6. Do-not-edit areas for this classification slice

| Path | Classification | Reason |
| --- | --- | --- |
| `src/**` | `do-not-edit-in-v2-planning` | Runtime behavior is out of scope. |
| `package.json` | `do-not-edit-in-v2-planning` | Package/bin migration requires separate approved plan. |
| `package-lock.json` | `do-not-edit-in-v2-planning` | Lockfile should change only with package/dependency work. |
| `.github/workflows/**` | `do-not-edit-in-v2-planning` | Enforcement/workflow changes are out of scope. |
| `docker-compose.yml` | `do-not-edit-in-v2-planning` | Persistence/deployment behavior is out of scope. |
| `.env`, `.mcp.json`, secrets, local backups | `do-not-edit-in-v2-planning` | Secret/local config boundaries. |

## 7. V2 cleanup order

1. Merge or otherwise accept PR #182 as the V2 scaffold baseline.
2. Review this classification file and revise labels if needed.
3. Add non-invasive superseded/legacy notices to selected V1 docs.
4. Build a complete name/reference inventory for `wasurezu`, `agent-memory`, `AGENT_MEMORY_*`, `~/.agent-memory`, and `mcp__wasurezu__*`.
5. Draft V2 API/data model only after source classification and inventory are complete.
6. Start runtime/package/MCP/env/DB migration only under a separate work order.

## 8. Initial follow-up candidates

| Candidate PR | Scope | Preconditions |
| --- | --- | --- |
| `docs: mark legacy v1 source docs for kusabi v2 reset` | Add short notices to reviewed legacy docs. | Classification accepted. |
| `docs: inventory kusabi v2 naming surfaces` | Add docs-only reference inventory. | Classification accepted; no runtime edits. |
| `docs: draft kusabi v2 api and data model boundary` | Add new V2 API/data docs. | Naming inventory and schema review complete. |
| `docs: plan kusabi compatibility alias migration` | Plan package/CLI/MCP/env/DB compatibility migration. | Full reference inventory complete. |

## 9. Review checklist

- Confirm labels are acceptable for reviewed docs.
- Identify any V1 document that should remain V2 canonical instead of supporting evidence.
- Identify any pending-review area that should be prioritized before legacy notices.
- Confirm no classified source is deleted by this PR.
- Confirm runtime/package/MCP/env/DB migration remains out of scope.
