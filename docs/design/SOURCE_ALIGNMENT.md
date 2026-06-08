# Design Source Alignment

> Status: #148 docs provenance / source alignment
> Scope: active design source set, provenance rules, and compatibility boundaries
> Risk: docs-only; no runtime, package, database, MCP namespace, default-behavior,
> or release-claim change

## Purpose

This document defines the source set that Wasurezu requirements and public
positioning docs may rely on in this branch.

Requirements must not depend on documents that are only present in another
checkout or unmerged branch unless the exact branch or commit provenance is
linked in the same requirement delta. When a document becomes normative for the
active line, prefer bringing it into this repository branch and linking it from
the relevant SSOT document.

## Active Source Set

| Area | Source | Notes |
| --- | --- | --- |
| ARC positioning decision | [GitHub issue #148](https://github.com/watchout/agent-memory/issues/148) | Decision driver for staged positioning, enforcement levels, standalone approval boundaries, and brand compatibility. |
| Core PRD / release scope | [`docs/requirements/SSOT-0_PRD.md`](../requirements/SSOT-0_PRD.md), [`docs/requirements/SSOT-1_FEATURE_CATALOG.md`](../requirements/SSOT-1_FEATURE_CATALOG.md) | Public-alpha and feature-catalog source of truth. |
| API, data, and cross-cutting contracts | [`docs/design/core/SSOT-3_API_CONTRACT.md`](core/SSOT-3_API_CONTRACT.md), [`docs/design/core/SSOT-4_DATA_MODEL.md`](core/SSOT-4_DATA_MODEL.md), [`docs/design/core/SSOT-5_CROSS_CUTTING.md`](core/SSOT-5_CROSS_CUTTING.md) | Implementation-facing contract docs. |
| Continuity control plane / runtime binding | [`docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md`](core/SSOT-6_LIVING_MEMORY_CONTROL.md), [`docs/design/core/SSOT-7_RUNTIME_AGENT_BINDING.md`](core/SSOT-7_RUNTIME_AGENT_BINDING.md) | Authority for restart/recovery ownership, lifecycle boundaries, and memory identity. |
| Memory safety governance | [`docs/design/governance/WASUREZU_MEMORY_SAFETY_GOVERNANCE.md`](governance/WASUREZU_MEMORY_SAFETY_GOVERNANCE.md) | Policy contract for memory classes, promotion boundaries, redaction, retention, and enterprise evidence. |
| AUN gate evidence refs | [`docs/design/governance/WASUREZU_AUN_GATE_EVIDENCE_REFS.md`](governance/WASUREZU_AUN_GATE_EVIDENCE_REFS.md), [`docs/design/schemas/aun-gate-evidence-refs-v1.schema.json`](schemas/aun-gate-evidence-refs-v1.schema.json) | Reference bundle contract only; Wasurezu does not authorize AUN execution. |
| Governed action profiles | [`docs/design/governance/WASUREZU_GOVERNED_ACTION_PROFILES.md`](governance/WASUREZU_GOVERNED_ACTION_PROFILES.md), [`docs/design/governance/wasurezu-governed-action-profiles.v1.json`](governance/wasurezu-governed-action-profiles.v1.json), [`docs/design/governance/governed-action-surface-profile.schema.json`](governance/governed-action-surface-profile.schema.json) | Inventory/profile contract for Wasurezu action surfaces before live enforcement. |
| Structured recovery artifacts | [`docs/design/schemas/recovery-pack-v1.schema.json`](schemas/recovery-pack-v1.schema.json), [`docs/design/schemas/host-invocation-context-v1.schema.json`](schemas/host-invocation-context-v1.schema.json) | Stable JSON Schema files for structured recovery and host invocation artifacts. |
| Host and recovery operations | [`docs/operations/HOST_ADAPTERS.md`](../operations/HOST_ADAPTERS.md), [`docs/operations/RECOVERY_EVALUATION.md`](../operations/RECOVERY_EVALUATION.md), [`docs/operations/WORLD_CLASS_RELEASE_CRITERIA.md`](../operations/WORLD_CLASS_RELEASE_CRITERIA.md) | Operational procedures and release evidence gates. |
| Product naming / compatibility | [`docs/brand/kusabi-naming-decision.md`](../brand/kusabi-naming-decision.md) | `Kusabi` is a public-facing product name; `wasurezu` remains the compatibility identity for operational surfaces. |

## Provenance Rules

- Requirements and release docs should link active in-branch source docs rather
  than relying on local memory, private branches, or unreviewed working trees.
- If a future spec needs an unmerged external branch, the requirement delta must
  name the exact branch or commit and either bring the normative content into
  this branch or keep the dependency explicitly non-normative.
- Machine-readable contracts must cite the schema path and the owning SSOT or
  governance document.
- `SSOT-1` feature status means the code surface exists. It does not by itself
  prove public release readiness, enterprise enforcement, AUN approval
  authority, or default behavior safety.
- Public/positioning prose may use `Kusabi (wasurezu compatibility name)`.
  Operational MCP server names, MCP tool namespaces, CLI/package names, database
  paths, environment variables, and startup instructions remain `wasurezu`
  compatibility surfaces until an explicit follow-up PR changes and tests them.

## #148-1 Boundary

This source-alignment cell only establishes reviewable provenance for existing
design documents.

It does not:

- rename the package, CLI, MCP server key, MCP tool namespace, DB path, or env
  vars
- change startup, restart, recovery, ingest, reveal, or approval behavior
- claim full enterprise governance enforcement
- approve public/default product scope changes
- publish or prepare a package release

Follow-up cells from #148 remain separate:

1. Requirements positioning PR.
2. Contract/schema follow-up PR.
3. Standalone approval behavior PR.
