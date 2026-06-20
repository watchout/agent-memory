# Kusabi V2 Repository Audit Draft

Status: draft  
Scope: repository read-through and cleanup planning  
Runtime impact: none

## 1. Audit position

This document records the initial V2 read-through state. It is intentionally conservative: it does not claim that every file in the repository has been read. It identifies the files and areas reviewed enough to start a safe docs-only V2 reset.

## 2. Confirmed constraints

- Issue #181 requests a warn-only Shirube scaffold.
- Runtime code, persistence behavior, package rename, MCP namespace rename, workflow enforcement, branch protection, and deployment changes are out of scope for the first slice.
- V2 planning may use `kusabi` as the product name.
- Existing `wasurezu` and `agent-memory` operational surfaces remain compatibility surfaces until a separate approved migration changes them.

## 3. Reviewed areas

Initial review covered the following representative files and source areas:

- root docs and metadata: `README.md`, `package.json`, `tsconfig.json`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `.gitignore`, `docker-compose.yml`;
- GitHub workflow: `.github/workflows/ci.yml`;
- brand/source alignment: `docs/design/SOURCE_ALIGNMENT.md`, `docs/brand/kusabi-naming-decision.md`;
- requirements/design SSOTs: `SSOT-0_PRD.md`, `SSOT-1_FEATURE_CATALOG.md`, `SSOT-3_API_CONTRACT.md`, `SSOT-4_DATA_MODEL.md`, `SSOT-5_CROSS_CUTTING.md`, `SSOT-6_LIVING_MEMORY_CONTROL.md`, `SSOT-7_RUNTIME_AGENT_BINDING.md`;
- governance and operations samples: memory safety governance and host adapter docs;
- core runtime source: MCP entrypoint, constants, sanitizer, boot, host adapters, restart pack, restart prepare, catch-up, redaction, conversation ingest, store interfaces, SQLite/JSON/PostgreSQL stores, migrations, and restart CLI.

## 4. Known read-coverage gaps

The following classes still need full pass before behavior-changing work:

- all remaining tests under `src/test*.ts` and `tests/**`;
- all JSON schemas under `docs/design/schemas/**`;
- all governance profile JSON/schema files under `docs/design/governance/**`;
- all operations docs under `docs/operations/**`;
- all scripts under `scripts/**`;
- any hidden or unlisted files not reachable through reviewed imports/docs.

## 5. Initial findings

### 5.1 Product naming is split

The current repository uses `wasurezu` as package/runtime identity while `Kusabi` is introduced as a public-facing alias. V2 should use `kusabi` as the canonical product name in new docs, but operational rename must wait for an explicit migration plan.

### 5.2 Design sources are too broad

The active source set lists many documents. Several contain overlapping authority for continuity, recovery, governance, release readiness, and naming. V2 should reduce the canonical source set and classify old docs as supporting evidence, legacy, superseded, or archive-only.

### 5.3 Some docs appear stale relative to implementation

Examples observed during initial review:

- requirement docs still describe some features as pending even though related code exists;
- feature catalog tables and later additions can disagree;
- older milestone dates and public-alpha plans remain in active docs;
- old name and transition wording appears in multiple places.

These are cleanup targets, not proof of runtime defects.

### 5.4 Catch-up semantics need separation

The catch-up area mixes dry-run/source inspection, extraction, and write behavior. V2 should separate preview, source ingest, candidate extraction, and approved promotion.

### 5.5 PostgreSQL catch-up support appears incomplete

The PostgreSQL store contains TODO/stub behavior for catch-up log operations. V2 should not claim complete cross-backend catch-up behavior until this is reviewed and tested.

### 5.6 Recovery artifact design is valuable but still named for V1

`recovery-pack` and `host-invocation-context` concepts appear useful for V2. Schema refs and policy IDs still use `wasurezu` naming and should be migrated only after compatibility planning.

### 5.7 Redaction and data-only boundaries should be retained

Current ingest and recovery docs/code already contain important safeguards: visible-context ingestion, redaction, private reasoning exclusion, and data-only treatment of stored external text. These should survive the V2 reset.

## 6. Do-not-change list before full audit

Do not change these until full read-through and owner/domain-designer confirmation:

- `src/**` runtime behavior;
- `package.json` package name or bin defaults;
- lockfile package identity;
- MCP server name or tool namespace;
- database path or migration behavior;
- environment variables;
- GitHub Actions workflows;
- deployment files;
- release or public-readiness claims.

## 7. Safe next actions

1. Complete remaining file inventory.
2. Mark V2 docs as draft source set.
3. Add owner review checklist.
4. Create a stale-doc classification table.
5. Decide whether to update README with a short V2 planning pointer.
6. Only then begin source-alignment cleanup.

## 8. Owner confirmation checklist

- Confirm `kusabi` as V2 canonical product name.
- Confirm compatibility treatment for `wasurezu` operational surfaces.
- Confirm memory data classes.
- Confirm agent/session/project/tenant boundary.
- Confirm retention, deletion, and supersession expectations.
- Confirm data-only handling of stored external text.
- Confirm whether V2 stays in this repository or moves to a new repository.
