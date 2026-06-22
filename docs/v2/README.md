# Kusabi V2 Draft Index

Status: draft; not authoritative until repository owner/domain-designer confirmation.

This directory starts the Kusabi V2 reset without changing runtime behavior. It is intentionally additive and docs-only.

## Draft source set

- `KUSABI_V2_CANONICAL_SPEC.md` — proposed V2 product/design authority.
- `KUSABI_V2_MIGRATION_BOUNDARY.md` — rename, compatibility, repo-split, and implementation boundaries.
- `KUSABI_V2_REPO_AUDIT.md` — current read-coverage notes, known design drift, and cleanup backlog.
- `KUSABI_V2_SOURCE_CLASSIFICATION.md` — draft classification of V1/transitional sources before deletion or rewrite.
- `KUSABI_V2_V1_INTENT_TRACEABILITY.md` — V1 design intent mapped to V2 decisions, evidence contracts, and pre-runtime gaps.
- `KUSABI_V2_NAMING_SURFACE_INVENTORY.md` — first-pass naming inventory for `kusabi`, `wasurezu`, `agent-memory`, package, MCP, env, DB path, schema, and release surfaces.
- `KUSABI_V2_FAST_LANE_POLICY.md` — Lane A / Lane B / Lane C split for continuing V2 docs work without waiting for full Shirube enforcement.
- `KUSABI_V2_FEATURE_PRESERVATION_MATRIX.md` — non-regression matrix that preserves existing Wasurezu / agent-memory capabilities through the V2 reset.
- `KUSABI_V2_API_AND_DATA_BOUNDARY.md` — V2 API/data model boundary that separates compatibility APIs, V2 concepts, future aliases, and evidence requirements.
- `KUSABI_V2_RELEASE_CLAIM_LADDER.md` — claim levels and quality gates from docs reset through major-tech/world-class evaluation readiness.
- `KUSABI_V2_SECURITY_AND_RETENTION_BOUNDARY.md` — security, privacy, redaction, retention, deletion, export, and reveal boundaries.
- `KUSABI_V2_IRRESISTIBLE_ADOPTION_STRATEGY.md` — strategy consolidation for UAMP, safety, compliance, scale, and adopt-vs-build evaluation.
- `KUSABI_V2_PRODUCT_CATEGORY_AND_POSITIONING.md` — product category strategy: agent continuity substrate, with coding agents as the first reference workload.
- `KUSABI_V2_IMPLEMENTATION_READINESS_PLAN.md` — gap-closure plan before V2 runtime, protocol, package, or migration work begins.
- `KUSABI_V2_SUITE_INTEROP_BOUNDARY.md` — suite-level ownership and artifact boundary for UAMP, AUN/A2A, Kodama, Shirube, MCP, and host adapters.
- `KUSABI_V2_UAMP_DRAFT_SPEC.md` — draft UAMP artifact set and current Kusabi/Wasurezu artifact mapping; no conformance claim.

## Rules for this branch

- Product name for V2 planning is `kusabi`.
- Product category for V2 planning is agent continuity substrate; AI coding agents are the first reference workload, not the final product boundary.
- Existing `wasurezu` and `agent-memory` runtime surfaces remain compatibility surfaces until a separate approved runtime migration changes them.
- Existing design documents are not deleted in this branch.
- Existing runtime capabilities are not reduced by this V2 docs reset; feature changes require separate owner-approved implementation work with tests.
- Stale or duplicated documents should first be marked as non-canonical or superseded by a reviewed V2 source.
- Runtime code, package identity, MCP namespace, environment variables, storage paths, workflows, and deployments are out of scope for this draft.
- Lane A docs/source-reset work may proceed while Shirube remains warn-only; enforcement or governance claims wait for Shirube-backed implementation and review evidence.
- Release and enterprise claims must follow the V2 claim ladder and cite evidence, not implementation presence alone.
- V2 runtime work should not start until the readiness gates are accepted for the relevant work package.
- UAMP remains a draft protocol track until schemas, fixtures, runner, reference implementation evidence, and second-adapter evidence exist.

## Relationship to #181

This directory complements the warn-only `.shirube/` scaffold requested by #181. The scaffold defines governance boundaries; these V2 docs define the draft reset direction.
