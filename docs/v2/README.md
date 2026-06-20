# Kusabi V2 Draft Index

Status: draft; not authoritative until repository owner/domain-designer confirmation.

This directory starts the Kusabi V2 reset without changing runtime behavior. It is intentionally additive and docs-only.

## Draft source set

- `KUSABI_V2_CANONICAL_SPEC.md` — proposed V2 product/design authority.
- `KUSABI_V2_MIGRATION_BOUNDARY.md` — rename, compatibility, repo-split, and implementation boundaries.
- `KUSABI_V2_REPO_AUDIT.md` — current read-coverage notes, known design drift, and cleanup backlog.
- `KUSABI_V2_SOURCE_CLASSIFICATION.md` — draft classification of V1/transitional sources before deletion or rewrite.

## Rules for this branch

- Product name for V2 planning is `kusabi`.
- Existing `wasurezu` and `agent-memory` runtime surfaces remain compatibility surfaces until a separate approved runtime migration changes them.
- Existing design documents are not deleted in this branch.
- Stale or duplicated documents should first be marked as non-canonical or superseded by a reviewed V2 source.
- Runtime code, package identity, MCP namespace, environment variables, storage paths, workflows, and deployments are out of scope for this draft.

## Relationship to #181

This directory complements the warn-only `.shirube/` scaffold requested by #181. The scaffold defines governance boundaries; these V2 docs define the draft reset direction.
